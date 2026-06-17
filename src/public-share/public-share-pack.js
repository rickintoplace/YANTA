import {
  state,
} from '../core.js';

import {
  noteMarkdown,
  listDrawingsForNote,
  listCitationsForNote,
} from '../yjs.js';

import {
  ensureAssetV2,
  unwrapAssetKeyForVault,
} from '../sync2/assets.js';

import {
  wrapAssetKeyForShare,
} from './public-share-crypto.js';

import {
  vaultEventsMap,
  vaultCalendarCategoriesMap,
} from '../sync2/vault-doc.js';

import {
  parseMarkdownCalendarRefs,
} from '../calendar-markdown.js';

const YANTA_IMAGE_RE = /yanta-img:\/\/([a-z0-9_:-]+)/gi;

function collectMarkdownAssetIds(markdown = '') {
  const ids = new Set();
  let m;

  YANTA_IMAGE_RE.lastIndex = 0;

  while ((m = YANTA_IMAGE_RE.exec(String(markdown || ''))) !== null) {
    if (m[1]) ids.add(m[1]);
  }

  return ids;
}

const CALENDAR_EVENT_WIKI_RE =
  /\[\[(?:cal|calendar|event):([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/gi;

function cleanUndefined(obj) {
  const out = {};

  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== undefined) out[key] = value;
  }

  return out;
}

function eventKey(ev = {}) {
  return String(ev.id || ev.externalUid || `${ev.title || ''}|${ev.start || ''}|${ev.end || ''}`);
}

function sanitizePublicCalendarEvent(raw = {}, {
  linkedToSharedNote = false,
  mentionedInSharedNote = false,
  markdownDerived = false,
} = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.start) return null;

  return cleanUndefined({
    id: String(raw.id || raw.externalUid || `shared-event-${stableStringify(raw).slice(0, 32)}`),
    title: String(raw.title || raw.summary || 'Untitled event'),

    start: raw.start,
    end: raw.end || null,
    allDay: !!raw.allDay,

    categoryId: raw.categoryId || undefined,
    color: raw.color || undefined,
    icon: raw.icon || undefined,

    location: raw.location || '',
    description: raw.description || '',

    status: raw.status || 'confirmed',
    recurrence: raw.recurrence || null,

    reminders: Array.isArray(raw.reminders)
      ? raw.reminders.map(String)
      : [],

    externalUid: raw.externalUid || '',

    linkedToSharedNote,
    mentionedInSharedNote,
    markdownDerived,
  });
}

function collectCalendarEventMentionKeys(markdown = '') {
  const keys = new Set();

  CALENDAR_EVENT_WIKI_RE.lastIndex = 0;

  let m;

  while ((m = CALENDAR_EVENT_WIKI_RE.exec(String(markdown || ''))) !== null) {
    const value = String(m[1] || '').trim();
    if (value) keys.add(value);
  }

  return keys;
}

function eventsFromVaultAndState() {
  const byId = new Map();

  try {
    for (const [id, ev] of vaultEventsMap()) {
      if (ev?.id || id) {
        byId.set(String(ev.id || id), {
          ...ev,
          id: String(ev.id || id),
        });
      }
    }
  } catch {}

  try {
    for (const ev of state.calendarEvents?.values?.() || []) {
      if (ev?.id) {
        byId.set(String(ev.id), ev);
      }
    }
  } catch {}

  return [...byId.values()];
}

function categoriesFromVaultAndState() {
  const byId = new Map();

  try {
    for (const [id, cat] of vaultCalendarCategoriesMap()) {
      if (cat?.id || id) {
        byId.set(String(cat.id || id), {
          ...cat,
          id: String(cat.id || id),
        });
      }
    }
  } catch {}

  try {
    for (const cat of state.calendarCategories?.values?.() || []) {
      if (cat?.id) {
        byId.set(String(cat.id), cat);
      }
    }
  } catch {}

  return [...byId.values()];
}

function collectPublicShareCalendarData(note, markdown) {
  const events = [];
  const seen = new Set();

  const pushEvent = (raw, flags = {}) => {
    const clean = sanitizePublicCalendarEvent(raw, flags);
    if (!clean) return;

    const key = eventKey(clean);
    if (seen.has(key)) return;

    seen.add(key);
    events.push(clean);
  };

  const allEvents = eventsFromVaultAndState();

  const mentionKeys = collectCalendarEventMentionKeys(markdown);
  const mentionKeysLower = new Set([...mentionKeys].map((x) => x.toLowerCase()));

  for (const ev of allEvents) {
    const linked =
      ev.noteId === note.id ||
      (Array.isArray(ev.relatedNoteIds) && ev.relatedNoteIds.includes(note.id));

    const mentioned =
      mentionKeys.has(String(ev.id || '')) ||
      mentionKeysLower.has(String(ev.title || '').trim().toLowerCase()) ||
      mentionKeysLower.has(String(ev.externalUid || '').trim().toLowerCase());

    if (linked || mentioned) {
      pushEvent(ev, {
        linkedToSharedNote: linked,
        mentionedInSharedNote: mentioned,
      });
    }
  }

  try {
    const derived = parseMarkdownCalendarRefs(markdown, note);

    for (const ev of derived) {
      pushEvent(ev, {
        markdownDerived: true,
        mentionedInSharedNote: true,
      });
    }
  } catch (err) {
    console.warn('[YANTA Public Share] could not parse markdown calendar refs', err);
  }

  const categoryIds = new Set(events.map((ev) => ev.categoryId).filter(Boolean));
  const categories = categoriesFromVaultAndState()
    .filter((cat) => categoryIds.has(cat.id))
    .map((cat) => cleanUndefined({
      id: cat.id,
      name: cat.name || 'Calendar',
      color: cat.color || undefined,
      readonly: cat.readonly === true,
    }));

  return {
    events,
    categories,
  };
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }

  return '{' + Object.keys(value).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
    .join(',') + '}';
}

async function sha256B64url(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const u8 = new Uint8Array(digest);

  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);

  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function packPublicNoteShare({
  noteId,
  shareKey,
  engine,
} = {}) {
  if (!noteId) throw new Error('noteId required');
  if (!shareKey) throw new Error('shareKey required');
  if (!engine) throw new Error('YANTA Cloud Sync engine is not running');

  const note = state.notes.get(noteId);

  if (!note) {
    throw new Error('Note not found');
  }

  const markdown = noteMarkdown(noteId);
  const assetIds = collectMarkdownAssetIds(markdown);

  const drawings = listDrawingsForNote(noteId);
  const citations = listCitationsForNote(noteId);

  const assets = [];
  const assetGrants = [];
  const missingAssets = [];

  for (const assetId of assetIds) {
    try {
      const meta = await ensureAssetV2(engine, assetId);
      const assetKeyBytes = await unwrapAssetKeyForVault(engine, meta);

      const encryptedAssetKeyForShare = await wrapAssetKeyForShare(
        shareKey,
        assetId,
        assetKeyBytes
      );

      assets.push({
        logicalId: assetId,
        objectId: meta.objectId,
        objectPath: meta.objectPath,
        mime: meta.type || 'application/octet-stream',
        size: Number(meta.size || 0),
        encryptedAssetKeyForShare,
        usedBy: ['markdown'],
      });

      assetGrants.push({
        assetObjectId: meta.objectId,
        objectPath: meta.objectPath,
        sizeBytes: Number(meta.size || 0),
        mime: meta.type || 'application/octet-stream',
      });
    } catch (err) {
      console.warn('[YANTA Public Share] missing asset', assetId, err);

      missingAssets.push({
        assetId,
        reason: err?.message || String(err),
      });
    }
  }

  const calendar = collectPublicShareCalendarData(note, markdown);
  
  const payload = {
    v: 1,
    kind: 'yanta-public-note-share',
    exportedAt: new Date().toISOString(),

    note: {
      id: note.id,
      title: note.title || 'Untitled',
      icon: note.icon || null,
      color: note.color || null,
      tags: note.tags || [],
      markdown,
      updated: note.updated || null,
    },

    calendar,

    drawings: drawings.map((d) => ({
      id: d.id,
      title: d.title || 'Drawing',
      canvas: d.canvas || null,
      elements: d.elements || [],
      appState: d.appState || {},
      files: d.files || {},
      updated: d.updated || null,
    })),

    citations,

    assets,

    warnings: {
      missingAssets,
    },
  };

  const payloadHash = await sha256B64url(stableStringify(payload));

  return {
    payload,
    payloadHash,
    assetGrants,
    missingAssets,
  };
}