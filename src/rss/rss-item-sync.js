// ============================================================
// YANTA Sources / RSS — what you read, starred and saved, on every device
//
// Subscriptions already sync (rss-feed-sync.js); the articles themselves
// stay a local cache that each device fetches. What was missing is the
// part the user did: an article read on the phone stayed unread on the
// laptop, a star or "saved as note" existed on one device only — and
// Pulse, which asks for unread items, reported the same articles again
// on whichever device ran next.
//
// Item ids are stable across devices (a hash of the synced feed id and
// the article's guid), so the state travels keyed by item id, without
// the article: { r, s, a, n, u } = read, starred, archived, saved note,
// time of the change. It lives in a Y.Map on one system note, like the
// Pulse inbox — not in the VaultDoc, which every sync re-reads and which
// a few thousand read marks would bloat.
//
// Last change wins per item (`u` against the local `stateUpdatedAt`).
// Read-only marks are dropped after RETAIN_DAYS — by then the article has
// left its feed and no device will fetch it as new again. Stars and saved
// notes are kept for as long as they exist.
// ============================================================

import { state, store } from '../core.js';
import { getNoteDoc } from '../yjs.js';
import { ensureAiBrain, AI_BRAIN_IDS } from '../ai/brain.js';
import { getRssItem, patchRssItem } from './rss-store.js';

export const RSS_STATE_NOTE_ID = 'system_rss_state';

const RETAIN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const BODY = `# Sources

Which articles you have read, starred, archived or saved as a note, so
every device shows the same. The articles themselves are fetched by each
device and are not stored here.

Editing this text does nothing.
`;

let ensured = null;

async function ensureStateNote() {
  if (ensured) return ensured;

  ensured = (async () => {
    await ensureAiBrain();

    const existing = state.notes.get(RSS_STATE_NOTE_ID);

    const note = {
      ...(existing || {}),
      id: RSS_STATE_NOTE_ID,
      title: 'Sources state',
      type: 'markdown',
      folderId: AI_BRAIN_IDS.rootFolder,
      tags: existing?.tags || ['ai-brain', 'sources'],
      pinned: false,
      icon: 'rss',
      color: '#f59e0b',
      created: existing?.created || Date.now(),
      updated: existing?.updated || Date.now(),
      system: true,
      aiBrain: true,
      dashboardHidden: true,
      hiddenFromDashboard: true,
    };

    if (!existing) {
      state.notes.set(RSS_STATE_NOTE_ID, note);
      await store.notes.put(note);
    }

    const entry = getNoteDoc(RSS_STATE_NOTE_ID);
    await entry.ready;

    const text = entry.doc.getText('markdown');
    if (text.length === 0) text.insert(0, BODY);

    return entry;
  })().catch((err) => {
    ensured = null;
    throw err;
  });

  return ensured;
}

async function stateMap() {
  const entry = await ensureStateNote();
  return { doc: entry.doc, map: entry.doc.getMap('rssItemState') };
}

async function touchStateNote() {
  const note = state.notes.get(RSS_STATE_NOTE_ID);
  if (!note) return;

  note.updated = Date.now();
  await store.notes.put(note);
}

function recordOf(item) {
  return {
    r: item.read ? 1 : 0,
    s: item.starred ? 1 : 0,
    a: item.archived ? 1 : 0,
    ...(item.savedNoteId ? { n: String(item.savedNoteId) } : {}),
    u: Number(item.stateUpdatedAt) || Date.now(),
  };
}

function sameState(item, record) {
  return !!item.read === !!record.r &&
    !!item.starred === !!record.s &&
    !!item.archived === !!record.a &&
    String(item.savedNoteId || '') === String(record.n || '');
}

const SYNC_ORIGIN = 'yanta-rss-item-sync';

/** Publishes one item's state after the user changed it on this device. */
export async function publishRssItemState(item) {
  if (!item?.id) return;

  try {
    const { doc, map } = await stateMap();
    const record = recordOf(item);
    const stored = map.get(item.id);

    if (stored && sameState(item, stored) && Number(stored.u) >= record.u) return;

    doc.transact(() => map.set(item.id, record), SYNC_ORIGIN);
    await touchStateNote();
  } catch (err) {
    console.warn('[YANTA Sources] could not publish article state', err);
  }
}

/**
 * Applies the synced state to this device's cached articles. Returns the
 * number of articles that changed. Cheap enough to run after every fetch:
 * one map walk and an IndexedDB read per synced record.
 */
export async function applyRssItemStateFromVault() {
  let changed = 0;

  try {
    const { map } = await stateMap();

    for (const [id, record] of map) {
      if (!record) continue;

      const item = await getRssItem(id);
      if (!item) continue;

      if (Number(record.u) <= Number(item.stateUpdatedAt || 0)) continue;
      if (sameState(item, record)) continue;

      await patchRssItem(id, {
        read: !!record.r,
        starred: !!record.s,
        archived: !!record.a,
        savedNoteId: record.n || null,
        stateUpdatedAt: Number(record.u),
      }, { fromSync: true });

      changed++;
    }
  } catch (err) {
    console.warn('[YANTA Sources] could not apply synced article state', err);
  }

  if (changed) {
    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: { localOnly: true, syncedState: changed },
    }));
  }

  return changed;
}

/** Drops read-only marks old enough that no feed still carries the article. */
async function pruneOldMarks() {
  try {
    const { doc, map } = await stateMap();
    const cutoff = Date.now() - RETAIN_DAYS * DAY_MS;
    const stale = [...map].filter(([, r]) => r && !r.s && !r.n && Number(r.u) < cutoff).map(([id]) => id);

    if (!stale.length) return;

    doc.transact(() => {
      for (const id of stale) map.delete(id);
    }, SYNC_ORIGIN);

    await touchStateNote();
  } catch {}
}

let installed = false;

export function setupRssItemSync() {
  if (installed) return;
  installed = true;

  // This device changed an article: publish it.
  window.addEventListener('yanta-rss-item-state', (e) => {
    publishRssItemState(e.detail?.item);
  });

  let pending = null;
  const apply = () => {
    pending ||= applyRssItemStateFromVault().finally(() => { pending = null; });
    return pending;
  };

  // New articles fetched here may already be read elsewhere.
  window.addEventListener('yanta-rss-updated', (e) => {
    if (e.detail?.syncedState) return;
    if (e.detail?.count || e.detail?.loadedMore) apply();
  });

  window.addEventListener('yanta-vault-hydrated', apply);

  // Another device's marks arriving through sync.
  stateMap()
    .then(({ doc }) => {
      doc.on('update', (_update, origin) => {
        if (origin !== SYNC_ORIGIN) apply();
      });
      apply();
      pruneOldMarks();
    })
    .catch((err) => console.warn('[YANTA Sources] article state sync unavailable', err));
}
