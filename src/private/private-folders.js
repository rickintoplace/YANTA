// ============================================================
// YANTA — private folders
//
// A private folder keeps its notes, subfolders and their names behind a
// password of its own (keys: private-crypto.js). Locked, it shows as
// "Private folder" and nothing of it exists in the app: not in the tree,
// search, graph, backlinks, dashboard, AI, Pulse or exports.
//
// Where the content lives: one hidden carrier note per folder
// (`private_<folderId>`, in the AI Brain system tree) holds
//   - a header map with the wrapped folder keys, and
//   - an append-only log of entries sealed with the folder key, each one
//     a Yjs update for the folder's container doc (names, metadata) or
//     for one of its notes' bodies.
// The carrier is an ordinary note to sync: every provider carries it,
// offline works, and the sync engine never sees anything readable.
//
// Unlocked, a session decrypts the log into in-memory Y.Docs and puts
// the items into app state, marked `privateFolderId`. Edits are sealed
// and appended to the log; entries from other devices are applied as
// they arrive. Nothing of it is written to this device in the clear.
//
// The app's writes reach the session through a router around
// store.notes/folders: a note saved inside a private folder goes to its
// container, never to IndexedDB or the vault. Moving a note in or out
// copies it under a new id and deletes the old one for good — so other
// devices drop their readable copy, and a vault tombstone can never hit
// a private item.
// ============================================================

import * as Y from 'yjs';

import { isPrivateCarrier, isPrivateItem, state, store, toast, uid } from '../core.js';
import { t } from '../i18n/index.js';
import { sanitizeFolderMeta, sanitizeNoteMeta } from '../sync2/meta-sanitize.js';
import { getVaultEntry, vaultNotesMap, vaultTombstonesMap } from '../sync2/vault-doc.js';
import { storeState } from '../sync2/y-idb-persistence.js';
import { adoptExternalNoteDoc, getNoteDoc, releaseExternalNoteDoc } from '../yjs.js';

import {
  generateFolderKey,
  openEntry,
  sealEntry,
  unwrapWithPassword,
  unwrapWithRecoveryCode,
  wrapWithPassword,
  wrapWithRecoveryCode,
} from './private-crypto.js';

export const CARRIER_PREFIX = 'private_';

const LOG = 'privateLog';
const HEADER = 'privateHeader';
const CONTAINER = 'c';
const FLUSH_MS = 250;
const COMPACT_AT = 200;
const AUTO_LOCK_MS = 10 * 60 * 1000;

// Transaction origins: entries applied from the log (never re-sealed),
// the session's own metadata writes (state is already up to date), and
// entries this session appended (already applied here).
const APPLY = Symbol('private-apply');
const LOCAL = Symbol('private-local');
const APPEND = Symbol('private-append');

const noteDocName = (id) => `n:${id}`;

const sessions = new Map();

function lockedError() {
  return Object.assign(new Error(t('private.lockedError')), { code: 'EPRIVATELOCKED' });
}

// ---------------------------------------------------------------- lookups

export { isPrivateCarrier, isPrivateItem };

export function carrierIdFor(privateFolderId) {
  return CARRIER_PREFIX + privateFolderId;
}

/** The carrier's metadata (from the vault — carriers never enter app state). */
function carrierFor(privateFolderId) {
  const id = carrierIdFor(privateFolderId);
  if (vaultTombstonesMap().has(id)) return null;
  const raw = vaultNotesMap().get(id);
  return raw ? sanitizeNoteMeta(raw) : null;
}

function allCarriers() {
  const tombstones = vaultTombstonesMap();
  const out = [];
  for (const [id, raw] of vaultNotesMap()) {
    if (!tombstones.has(id) && raw?.privateCarrierFor) out.push(sanitizeNoteMeta(raw));
  }
  return out;
}

/** The private folder a folder belongs to (walking up), or null. */
export function privateFolderIdOfFolder(folderId) {
  const seen = new Set();
  let id = folderId;

  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = state.folders.get(id);
    if (!folder) return null;
    if (folder.privateFolderId) return folder.privateFolderId;
    id = folder.parentId;
  }

  return null;
}

export function isPrivateFolderUnlocked(privateFolderId) {
  return sessions.has(privateFolderId);
}

export function unlockedPrivateFolderIds() {
  return [...sessions.keys()];
}

// ---------------------------------------------------------------- placeholders

function lockedPlaceholder(privateFolderId, parentId) {
  return {
    id: privateFolderId,
    name: t('private.lockedName'),
    parentId: parentId || null,
    icon: 'lock',
    privateFolderId,
    privateRoot: true,
    privateLocked: true,
    aiHidden: true,
    created: 0,
    updated: 0,
  };
}

/**
 * One "Private folder" entry per carrier note, where the folder sits in
 * the tree. Folders whose carrier is gone (deleted on another device)
 * disappear, unlocked or not.
 */
export function syncPrivatePlaceholders() {
  const live = new Set();
  let changed = false;

  for (const note of allCarriers()) {
    const id = note.privateCarrierFor;
    const parentId = note.privateParentId || null;
    live.add(id);

    const existing = state.folders.get(id);

    if (sessions.has(id)) {
      if (existing && (existing.parentId || null) !== parentId) {
        existing.parentId = parentId;
        changed = true;
      }
      continue;
    }

    if (!existing || !existing.privateLocked || (existing.parentId || null) !== parentId) {
      state.folders.set(id, lockedPlaceholder(id, parentId));
      changed = true;
    }
  }

  for (const folder of [...state.folders.values()]) {
    if (!folder.privateRoot || live.has(folder.privateFolderId)) continue;

    sessions.get(folder.privateFolderId)?.discard();
    state.folders.delete(folder.id);
    changed = true;
  }

  return changed;
}

// ---------------------------------------------------------------- session

class PrivateSession {
  constructor(privateFolderId, folderKey, carrierDoc) {
    this.id = privateFolderId;
    this.key = folderKey;
    this.carrierDoc = carrierDoc;
    this.log = carrierDoc.getArray(LOG);
    this.docs = new Map();
    this.applied = new Set();
    this.queues = new Map();
    this.flushTimer = null;
    this.applying = Promise.resolve();
    this.materialized = { notes: new Set(), folders: new Set() };
    this.lastUsed = Date.now();

    this.onLog = (event, tr) => {
      if (tr.origin === APPEND) return;
      const added = [];
      for (const item of event.changes.added) {
        for (const content of item.content.getContent()) added.push(content);
      }
      if (added.length) this.applyEntries(added);
    };

    this.docListeners = new Map();
  }

  // ---- docs

  doc(name) {
    let doc = this.docs.get(name);
    if (doc) return doc;

    doc = new Y.Doc();
    this.docs.set(name, doc);

    const listener = (update, origin) => {
      if (origin === APPLY) return;
      this.queue(name, update);
    };
    doc.on('update', listener);
    this.docListeners.set(name, listener);

    if (name === CONTAINER) {
      doc.on('afterTransaction', (tr) => {
        if (tr.origin === APPLY) this.scheduleMaterialize();
      });
    }

    return doc;
  }

  get container() {
    return this.doc(CONTAINER);
  }

  bodyDoc(noteId) {
    return this.doc(noteDocName(noteId));
  }

  // ---- reading the log

  async load() {
    await this.applyEntries(this.log.toArray());
    this.log.observe(this.onLog);
  }

  applyEntries(entries) {
    this.applying = this.applying.catch(() => {}).then(async () => {
      const opened = await Promise.all(entries.map((bytes) => openEntry(this.key, this.id, bytes)));

      opened.forEach((entry, i) => {
        if (!entry) return;
        try {
          Y.applyUpdate(this.doc(entry.docName), entry.update, APPLY);
          this.applied.add(entries[i]);
        } catch (err) {
          console.warn('[YANTA] Private entry skipped', err);
        }
      });

      // A note body that arrived after its metadata: show it.
      for (const entry of opened) {
        if (entry?.docName.startsWith('n:')) {
          const noteId = entry.docName.slice(2);
          if (this.materialized.notes.has(noteId)) {
            window.dispatchEvent(new CustomEvent('yanta-space-doc-applied', { detail: { docKey: noteId } }));
          }
        }
      }
    });

    return this.applying;
  }

  // ---- writing to the log

  queue(name, update) {
    this.lastUsed = Date.now();
    if (!this.queues.has(name)) this.queues.set(name, []);
    this.queues.get(name).push(update);

    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushNow().catch((err) => console.error('[YANTA] Private folder: saving failed', err));
    }, FLUSH_MS);
  }

  async flushNow() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.queues.size) return;

    const batches = [...this.queues.entries()];
    this.queues.clear();

    const sealed = await Promise.all(batches.map(([name, updates]) =>
      sealEntry(this.key, this.id, name, updates.length === 1 ? updates[0] : Y.mergeUpdates(updates))
    ));

    // Yjs stores a copy of each pushed array: remember the stored ones.
    this.carrierDoc.transact(() => {
      const start = this.log.length;
      this.log.push(sealed);
      for (const stored of this.log.slice(start)) this.applied.add(stored);
    }, APPEND);

    if (this.log.length > COMPACT_AT) await this.compact();
  }

  /**
   * Rewrites the log as one entry per live doc. Deletes only entries
   * this session has applied — an entry another device appended
   * meanwhile stays, whatever position the merge gives it.
   */
  async compact() {
    await this.applying;

    const covered = new Set(this.applied);
    const notes = this.container.getMap('notes');
    const live = [CONTAINER, ...[...notes.keys()].map(noteDocName)].filter((name) => this.docs.has(name));
    const states = live.map((name) => [name, Y.encodeStateAsUpdate(this.docs.get(name))]);

    const sealed = await Promise.all(states.map(([name, update]) => sealEntry(this.key, this.id, name, update)));

    this.carrierDoc.transact(() => {
      const all = this.log.toArray();
      for (let i = all.length - 1; i >= 0; i--) {
        if (covered.has(all[i])) this.log.delete(i, 1);
      }
      for (const bytes of covered) this.applied.delete(bytes);

      const start = this.log.length;
      this.log.push(sealed);
      for (const stored of this.log.slice(start)) this.applied.add(stored);
    }, APPEND);

    // Bodies of deleted notes are gone with their entries.
    for (const name of [...this.docs.keys()]) {
      if (name !== CONTAINER && !live.includes(name)) this.dropDoc(name);
    }
  }

  dropDoc(name) {
    const doc = this.docs.get(name);
    if (!doc) return;
    doc.off('update', this.docListeners.get(name));
    this.docListeners.delete(name);
    this.docs.delete(name);
    doc.destroy();
  }

  // ---- metadata

  rootMeta() {
    return this.container.getMap('root').toJSON();
  }

  setRoot(patch) {
    const root = this.container.getMap('root');
    this.container.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === null) root.delete(key);
        else root.set(key, value);
      }
    }, LOCAL);
  }

  putNote(note) {
    const meta = sanitizeNoteMeta(note);
    this.container.transact(() => this.container.getMap('notes').set(note.id, meta), LOCAL);
    this.materialized.notes.add(note.id);
    adoptExternalNoteDoc(note.id, this.bodyDoc(note.id));
  }

  deleteNote(noteId) {
    this.container.transact(() => this.container.getMap('notes').delete(noteId), LOCAL);
    this.materialized.notes.delete(noteId);
    releaseExternalNoteDoc(noteId);
  }

  putFolder(folder) {
    const meta = sanitizeFolderMeta(folder);
    this.container.transact(() => this.container.getMap('folders').set(folder.id, meta), LOCAL);
    this.materialized.folders.add(folder.id);
  }

  deleteFolder(folderId) {
    this.container.transact(() => this.container.getMap('folders').delete(folderId), LOCAL);
    this.materialized.folders.delete(folderId);
  }

  // ---- app state

  rootFolder() {
    const meta = this.rootMeta();
    const carrier = carrierFor(this.id);
    return {
      ...meta,
      id: this.id,
      name: meta.name || t('private.unnamed'),
      parentId: carrier?.privateParentId || null,
      privateFolderId: this.id,
      privateRoot: true,
      aiHidden: true,
    };
  }

  /** Puts the folder's items into app state (and takes out what is gone). */
  materialize() {
    state.folders.set(this.id, this.rootFolder());

    const folders = this.container.getMap('folders');
    const notes = this.container.getMap('notes');

    for (const id of [...this.materialized.folders]) {
      if (!folders.has(id)) {
        state.folders.delete(id);
        this.materialized.folders.delete(id);
      }
    }

    for (const id of [...this.materialized.notes]) {
      if (!notes.has(id)) {
        this.removeNoteFromState(id);
        this.materialized.notes.delete(id);
      }
    }

    for (const [id, meta] of folders) {
      state.folders.set(id, { ...meta, id, privateFolderId: this.id });
      this.materialized.folders.add(id);
    }

    for (const [id, meta] of notes) {
      const note = { ...meta, id, privateFolderId: this.id };
      state.notes.set(id, note);
      this.materialized.notes.add(id);
      adoptExternalNoteDoc(id, this.bodyDoc(id));
      indexForSearch(note, this.bodyDoc(id));
    }
  }

  scheduleMaterialize() {
    if (this.materializeQueued) return;
    this.materializeQueued = true;

    queueMicrotask(() => {
      this.materializeQueued = false;
      if (!sessions.has(this.id)) return;
      this.materialize();
      refreshUi();
    });
  }

  removeNoteFromState(noteId) {
    releaseExternalNoteDoc(noteId);
    state.notes.delete(noteId);
    state.searchIndex.delete(noteId);
  }

  /** Takes everything out of app state and memory. */
  dematerialize() {
    for (const id of this.materialized.notes) this.removeNoteFromState(id);
    for (const id of this.materialized.folders) {
      state.folders.delete(id);
      state.expandedFolders.delete(id);
    }
    this.materialized.notes.clear();
    this.materialized.folders.clear();
  }

  async close({ flush = true } = {}) {
    if (flush) {
      await this.flushNow();
      await this.applying;
    }

    this.log.unobserve(this.onLog);
    this.dematerialize();

    for (const name of [...this.docs.keys()]) this.dropDoc(name);
    this.key.fill(0);
  }

  /** The carrier is gone (deleted elsewhere): drop without writing. */
  discard() {
    const visible = visibleParts(this);
    sessions.delete(this.id);
    this.close({ flush: false }).then(() => leaveVisibleParts(visible, null)).catch(() => {});
  }
}

/*
  The vault keeps its update log on this device. Notes that went private
  left their titles and folder names in older entries of it; rewriting
  the log as the current state drops them (the doc collects deleted
  content). Same trim y-indexeddb does on its own every 500 updates.
*/
async function scrubVaultHistory() {
  try {
    const entry = getVaultEntry();
    await entry.ready;
    if (entry.persistence?.db && !entry.persistence._destroyed) await storeState(entry.persistence, true);
  } catch (err) {
    console.warn('[YANTA] Vault history not rewritten', err);
  }
}

// ---------------------------------------------------------------- search, UI

function indexForSearch(note, bodyDoc) {
  import('../notes.js').then(({ searchHaystack }) => {
    if (!state.notes.has(note.id)) return;
    state.searchIndex.set(note.id, searchHaystack(note, bodyDoc.getText('markdown').toString()));
  }).catch(() => {});
}

function refreshUi() {
  Promise.all([import('../tree.js'), import('../notes.js')]).then(([{ renderTree }, { rebuildWikilinkIndex }]) => {
    rebuildWikilinkIndex();
    renderTree();
  }).catch(() => {});

  window.dispatchEvent(new CustomEvent('yanta-private-folders-changed'));
  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', { detail: { source: 'private' } }));
}

// ---------------------------------------------------------------- unlock / lock

async function carrierDocFor(privateFolderId) {
  const carrier = carrierFor(privateFolderId);
  if (!carrier) return null;
  const entry = getNoteDoc(carrier.id);
  await entry.ready;
  return entry.doc;
}

function headerWraps(carrierDoc) {
  return carrierDoc.getMap(HEADER).get('wraps') || null;
}

async function startSession(privateFolderId, folderKey, carrierDoc) {
  const session = new PrivateSession(privateFolderId, folderKey, carrierDoc);
  await session.load();
  sessions.set(privateFolderId, session);
  session.materialize();
  state.expandedFolders.add(privateFolderId);
  refreshUi();
  ensureAutoLock();
  return session;
}

/**
 * Unlocks with the folder password. Resolves 'ok', 'wrong', or
 * 'missing' (the folder's data has not arrived on this device yet).
 */
export async function unlockPrivateFolder(privateFolderId, password) {
  if (sessions.has(privateFolderId)) return 'ok';

  const carrierDoc = await carrierDocFor(privateFolderId);
  const wraps = carrierDoc && headerWraps(carrierDoc);
  if (!wraps?.password) return 'missing';

  const folderKey = await unwrapWithPassword(wraps.password, password, privateFolderId);
  if (!folderKey) return 'wrong';

  await startSession(privateFolderId, folderKey, carrierDoc);
  return 'ok';
}

/** Unlocks with the recovery code and sets a new password right away. */
export async function recoverPrivateFolder(privateFolderId, recoveryCode, newPassword) {
  const carrierDoc = await carrierDocFor(privateFolderId);
  const wraps = carrierDoc && headerWraps(carrierDoc);
  if (!wraps?.recovery) return 'missing';

  const folderKey = await unwrapWithRecoveryCode(wraps.recovery, recoveryCode, privateFolderId);
  if (!folderKey) return 'wrong';

  const password = await wrapWithPassword(folderKey, newPassword, privateFolderId);
  carrierDoc.transact(() => carrierDoc.getMap(HEADER).set('wraps', { ...wraps, password }));

  if (!sessions.has(privateFolderId)) await startSession(privateFolderId, folderKey, carrierDoc);
  return 'ok';
}

/** Changes the password of an unlocked private folder. */
export async function changePrivateFolderPassword(privateFolderId, newPassword) {
  const session = sessions.get(privateFolderId);
  if (!session) throw lockedError();

  const wraps = headerWraps(session.carrierDoc) || {};
  const password = await wrapWithPassword(session.key, newPassword, privateFolderId);
  session.carrierDoc.transact(() => session.carrierDoc.getMap(HEADER).set('wraps', { ...wraps, password }));
}

/** Replaces the recovery code of an unlocked private folder. */
export async function replacePrivateFolderRecoveryCode(privateFolderId, recoveryCode) {
  const session = sessions.get(privateFolderId);
  if (!session) throw lockedError();

  const wraps = headerWraps(session.carrierDoc) || {};
  const recovery = await wrapWithRecoveryCode(session.key, recoveryCode, privateFolderId);
  session.carrierDoc.transact(() => session.carrierDoc.getMap(HEADER).set('wraps', { ...wraps, recovery }));
}

/** What of a folder is on screen right now (before it goes away). */
function visibleParts(session) {
  const folderId = state.surface === 'dashboard' ? state.dashboardFolderId : null;
  return {
    note: session.materialized.notes.has(state.currentNoteId),
    folder: !!folderId && (folderId === session.id || session.materialized.folders.has(folderId)),
  };
}

/** Nothing of a folder that just locked (or went away) may stay on screen. */
async function leaveVisibleParts(visible, folderId) {
  if (visible.note) {
    const { clearEditor } = await import('../notes.js');
    clearEditor();
  }
  if (visible.note || visible.folder) {
    const { showDashboard } = await import('../dashboard.js');
    showDashboard({ folderId: state.folders.has(folderId) ? folderId : null, replace: true });
  }
}

export async function lockPrivateFolder(privateFolderId) {
  const session = sessions.get(privateFolderId);
  if (!session) return;

  const visible = visibleParts(session);

  sessions.delete(privateFolderId);
  await session.close();
  syncPrivatePlaceholders();

  await leaveVisibleParts(visible, privateFolderId);
  refreshUi();
}

export async function lockAllPrivateFolders() {
  for (const id of [...sessions.keys()]) await lockPrivateFolder(id);
}

let autoLockInstalled = false;

function ensureAutoLock() {
  if (autoLockInstalled) return;
  autoLockInstalled = true;

  let lastActivity = Date.now();
  const activity = () => { lastActivity = Date.now(); };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, activity, { passive: true, capture: true });
  }

  // Locked with the app (or its shortcut, also when the app lock is off);
  // and after a while without input.
  window.addEventListener('yanta-app-locked', () => lockAllPrivateFolders());
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') lockAllPrivateFolders();
  }, true);
  setInterval(() => {
    if (sessions.size && Date.now() - lastActivity >= AUTO_LOCK_MS) lockAllPrivateFolders();
  }, 30_000);

  // Leaving the page: what is still queued goes out now.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      for (const session of sessions.values()) session.flushNow().catch(() => {});
    }
  });
}

// ---------------------------------------------------------------- create / dissolve

const CARRIER_BODY = `# Private folder

This note holds a private folder, encrypted with the folder's own
password. Its content is not readable here. Do not edit or delete it.
`;

async function createCarrier(privateFolderId, parentId) {
  const { ensureAiBrain, AI_BRAIN_IDS } = await import('../ai/brain.js');
  await ensureAiBrain();

  const now = Date.now();
  const carrier = {
    id: carrierIdFor(privateFolderId),
    title: 'Private folder',
    type: 'markdown',
    folderId: AI_BRAIN_IDS.rootFolder,
    tags: [],
    pinned: false,
    created: now,
    updated: now,
    system: true,
    aiBrain: true,
    aiHidden: true,
    dashboardHidden: true,
    hiddenFromDashboard: true,
    privateCarrierFor: privateFolderId,
    privateParentId: parentId || null,
  };

  await store.notes.put(carrier);

  const entry = getNoteDoc(carrier.id);
  await entry.ready;
  entry.doc.getText('markdown').insert(0, CARRIER_BODY);

  // Like a new note: the engine uploads it from now on.
  try { await window.yantaSync2?.engine?.observeNote?.(carrier.id); } catch {}
  return { carrier, carrierDoc: entry.doc, persistence: entry.persistence };
}

/** Why a folder cannot become private, or null. */
export function privateConversionBlocker(folderId) {
  const folder = state.folders.get(folderId);
  if (!folder) return t('private.blocker.missing');
  if (folder.system || folder.aiBrain || folder.privateFolderId) return t('private.blocker.system');
  if (folder.spaceId) return t('private.blocker.shared');

  const { folderIds, noteIds } = subtree(folderId);

  for (const space of state.spaces.values()) {
    const rec = space.record || {};
    if (folderIds.has(rec.rootFolderId) || noteIds.has(rec.noteId) || noteIds.has(rec.sourceId)) {
      return t('private.blocker.shared');
    }
  }

  for (const id of noteIds) {
    const note = state.notes.get(id);
    if (note?.spaceId || (note?.publicShare && !note.publicShare.revokedAt)) return t('private.blocker.public');
  }

  for (const id of folderIds) {
    if (state.folders.get(id)?.system) return t('private.blocker.system');
  }

  return null;
}

function subtree(folderId) {
  const folderIds = new Set();
  const noteIds = new Set();
  const stack = [folderId];

  while (stack.length) {
    const id = stack.pop();
    if (!id || folderIds.has(id)) continue;
    folderIds.add(id);
    for (const f of state.folders.values()) if (f.parentId === id) stack.push(f.id);
    for (const n of state.notes.values()) if (n.folderId === id) noteIds.add(n.id);
  }

  return { folderIds, noteIds };
}

/**
 * Turns a folder (with everything inside) into a private folder. The
 * content is copied into the encrypted container under new ids first;
 * only once that is stored are the readable originals deleted for good.
 */
export async function makeFolderPrivate(folderId, { password, recoveryCode }) {
  const folder = state.folders.get(folderId);
  const blocker = privateConversionBlocker(folderId);
  if (blocker) throw new Error(blocker);

  const privateFolderId = uid();
  const folderKey = generateFolderKey();
  const { carrierDoc, persistence } = await createCarrier(privateFolderId, folder.parentId);

  const wraps = {
    v: 1,
    password: await wrapWithPassword(folderKey, password, privateFolderId),
    recovery: await wrapWithRecoveryCode(folderKey, recoveryCode, privateFolderId),
  };
  carrierDoc.transact(() => carrierDoc.getMap(HEADER).set('wraps', wraps));

  const session = new PrivateSession(privateFolderId, new Uint8Array(folderKey), carrierDoc);
  await session.load();

  session.setRoot({
    name: folder.name || t('private.unnamed'),
    icon: folder.icon,
    color: folder.color,
    created: folder.created || Date.now(),
  });

  const { folderIds, noteIds } = subtree(folderId);
  const idMap = new Map([[folderId, privateFolderId]]);
  for (const id of folderIds) if (id !== folderId) idMap.set(id, uid());
  for (const id of noteIds) idMap.set(id, uid());

  for (const id of folderIds) {
    if (id === folderId) continue;
    const sub = state.folders.get(id);
    session.putFolder({ ...sub, id: idMap.get(id), parentId: idMap.get(sub.parentId) || privateFolderId });
  }

  for (const id of noteIds) {
    const note = state.notes.get(id);
    const source = getNoteDoc(id);
    await source.ready;
    const body = Y.encodeStateAsUpdate(source.doc);

    const newId = idMap.get(id);
    Y.applyUpdate(session.bodyDoc(newId), body);
    session.putNote({ ...note, id: newId, folderId: idMap.get(note.folderId) || privateFolderId });
  }

  await session.flushNow();
  await persistence.whenWritten?.();

  sessions.set(privateFolderId, session);

  // The readable originals go — here and, through tombstones, everywhere.
  // Tombstones keep a title for "deleted on another device": not these.
  for (const id of noteIds) {
    const note = state.notes.get(id);
    if (note) note.title = '';
  }
  for (const id of folderIds) {
    const sub = state.folders.get(id);
    if (sub) sub.name = '';
  }

  const openNote = state.currentNoteId;
  const { permanentlyDeleteFolder } = await import('../trash.js');
  await permanentlyDeleteFolder(folderId, { source: 'private-folder' });

  await scrubVaultHistory();

  session.materialize();
  state.expandedFolders.add(privateFolderId);
  if (state.dashboardFolderId === folderId) state.dashboardFolderId = privateFolderId;
  refreshUi();
  ensureAutoLock();

  if (openNote && idMap.has(openNote)) {
    const { openNote: open } = await import('../notes.js');
    await open(idMap.get(openNote));
  }

  return privateFolderId;
}

/**
 * Turns an unlocked private folder back into a normal one: copies out
 * under new ids, then deletes the carrier (everywhere).
 */
export async function makeFolderNormal(privateFolderId) {
  const session = sessions.get(privateFolderId);
  if (!session) throw lockedError();

  await session.flushNow();
  await session.applying;

  const root = session.rootFolder();
  const now = Date.now();
  const newRootId = uid();

  const rootFolder = {
    id: newRootId,
    name: root.name,
    parentId: root.parentId || null,
    icon: root.icon,
    color: root.color,
    created: root.created || now,
    updated: now,
  };
  state.folders.set(newRootId, rootFolder);
  await store.folders.put(rootFolder);

  const folders = session.container.getMap('folders').toJSON();
  const notes = session.container.getMap('notes').toJSON();
  const idMap = new Map([[privateFolderId, newRootId]]);
  for (const id of Object.keys(folders)) idMap.set(id, uid());
  for (const id of Object.keys(notes)) idMap.set(id, uid());

  // Parents before children.
  const pending = Object.values(folders);
  const placed = new Set([privateFolderId]);
  while (pending.length) {
    const index = pending.findIndex((f) => placed.has(f.parentId) || !idMap.has(f.parentId));
    const folder = pending.splice(index < 0 ? 0 : index, 1)[0];
    const copy = { ...folder, id: idMap.get(folder.id), parentId: idMap.get(folder.parentId) || newRootId };
    delete copy.aiHidden;
    state.folders.set(copy.id, copy);
    await store.folders.put(copy);
    placed.add(folder.id);
  }

  const openNote = state.currentNoteId;

  for (const [id, meta] of Object.entries(notes)) {
    const copy = { ...meta, id: idMap.get(id), folderId: idMap.get(meta.folderId) || newRootId };
    state.notes.set(copy.id, copy);
    await store.notes.put(copy);

    const target = getNoteDoc(copy.id);
    await target.ready;
    Y.applyUpdate(target.doc, Y.encodeStateAsUpdate(session.bodyDoc(id)));
    await target.persistence.whenWritten?.();
  }

  sessions.delete(privateFolderId);
  await session.close({ flush: false });
  await deleteCarrier(privateFolderId);

  if (state.dashboardFolderId === privateFolderId) state.dashboardFolderId = newRootId;
  refreshUi();

  if (openNote && idMap.has(openNote)) {
    const { openNote: open } = await import('../notes.js');
    await open(idMap.get(openNote));
  }

  return newRootId;
}

async function deleteCarrier(privateFolderId) {
  const id = carrierIdFor(privateFolderId);
  const { destroyNoteDoc } = await import('../yjs.js');

  await store.notes.del(id);
  try { await destroyNoteDoc(id); } catch {}

  state.folders.delete(privateFolderId);
  state.expandedFolders.delete(privateFolderId);
}

/** Deletes a private folder with everything in it, on every device. */
export async function deletePrivateFolder(privateFolderId) {
  const session = sessions.get(privateFolderId);
  const visible = session ? visibleParts(session) : { note: false, folder: state.dashboardFolderId === privateFolderId };

  if (session) {
    sessions.delete(privateFolderId);
    await session.close({ flush: false });
  }

  await deleteCarrier(privateFolderId);
  await leaveVisibleParts(visible, null);
  refreshUi();
}

// ---------------------------------------------------------------- router

function requireSession(privateFolderId) {
  const session = sessions.get(privateFolderId);
  if (!session) throw lockedError();
  return session;
}

/**
 * Wraps store.notes / store.folders so the app's ordinary writes land
 * where the item belongs. Installed after the vault bridge, so private
 * items never reach the bridge, IndexedDB or the vault.
 */
export async function installPrivateFolderRouter() {
  if (store.__privateRouter) return;
  store.__privateRouter = true;

  const { vaultFoldersMap, vaultNotesMap } = await import('../sync2/vault-doc.js');
  const vaultHas = (id) => vaultNotesMap().has(id);
  const vaultHasFolder = (id) => vaultFoldersMap().has(id);

  const original = {
    notesPut: store.notes.put,
    notesDel: store.notes.del,
    foldersPut: store.folders.put,
    foldersDel: store.folders.del,
  };

  store.notes.put = async (note) => {
    if (!note || isPrivateCarrier(note)) return original.notesPut(note);

    const target = note.folderId ? privateFolderIdOfFolder(note.folderId) : null;
    const current = note.privateFolderId || null;

    if (!target && !current) return original.notesPut(note);

    if (target && target === current) {
      requireSession(target).putNote(note);
      return note.id;
    }

    // Brand new here (never stored as a normal note): it starts out private.
    if (target && !current && !vaultHas(note.id)) {
      note.privateFolderId = target;
      requireSession(target).putNote(note);
      return note.id;
    }

    try {
      return await moveNoteAcross(note, { from: current, to: target, original });
    } catch (err) {
      // Not moved: the note goes back where it was, and the user hears why.
      const before = current
        ? sessions.get(current)?.container.getMap('notes').get(note.id)
        : vaultNotesMap().get(note.id);
      if (before) note.folderId = before.folderId || null;
      if (err?.code !== 'EPRIVATELOCKED') throw err;
      toast(err.message, 'error');
      return undefined;
    }
  };

  store.notes.del = async (id) => {
    const note = state.notes.get(id);
    if (note?.privateFolderId && !isPrivateCarrier(note)) {
      requireSession(note.privateFolderId).deleteNote(id);
      return undefined;
    }
    return original.notesDel(id);
  };

  store.folders.put = async (folder) => {
    if (!folder) return original.foldersPut(folder);

    if (folder.privateRoot) {
      // Locked, it can still move in the tree — nothing else about it is known.
      const session = sessions.get(folder.privateFolderId);
      if (session) session.setRoot({
        name: folder.name,
        icon: folder.icon,
        color: folder.color,
        trashed: folder.trashed === true ? true : undefined,
        deletedAt: folder.deletedAt,
        dashboardOrder: folder.dashboardOrder,
        dashboardHeightPx: folder.dashboardHeightPx,
      });

      const carrier = carrierFor(folder.privateFolderId);
      if (carrier && (carrier.privateParentId || null) !== (folder.parentId || null)) {
        if (folder.parentId && privateFolderIdOfFolder(folder.parentId)) {
          folder.parentId = carrier.privateParentId || null;
          toast(t('private.blocker.nested'), 'error');
          return undefined;
        }
        carrier.privateParentId = folder.parentId || null;
        carrier.updated = Date.now();
        await original.notesPut(carrier);
      }
      return folder.id;
    }

    const target = folder.parentId ? privateFolderIdOfFolder(folder.parentId) : null;
    const current = folder.privateFolderId || null;

    if (!target && !current) return original.foldersPut(folder);

    if (target && target === current) {
      requireSession(target).putFolder(folder);
      return folder.id;
    }

    if (target && !current && !vaultHasFolder(folder.id)) {
      folder.privateFolderId = target;
      requireSession(target).putFolder(folder);
      return folder.id;
    }

    // Whole folders do not move in or out (yet): their notes do, one by one.
    // The folder goes back where it was.
    const before = current
      ? sessions.get(current)?.container.getMap('folders').get(folder.id)
      : vaultFoldersMap().get(folder.id);
    if (before) folder.parentId = before.parentId || (current || null);
    toast(t('private.blocker.folderMove'), 'error');
    return undefined;
  };

  store.folders.del = async (id) => {
    const folder = state.folders.get(id);
    if (folder?.privateRoot) return deletePrivateFolder(folder.privateFolderId);
    if (folder?.privateFolderId) {
      requireSession(folder.privateFolderId).deleteFolder(id);
      return undefined;
    }
    return original.foldersDel(id);
  };
}

/**
 * A note moved into, out of, or between private folders: a copy under a
 * new id where it goes, then the old one is deleted for good.
 */
async function moveNoteAcross(note, { from, to, original }) {
  const targetSession = to ? requireSession(to) : null;
  const sourceSession = from ? requireSession(from) : null;

  const oldId = note.id;
  const newId = uid();

  const sourceDoc = sourceSession ? sourceSession.bodyDoc(oldId) : (await readyDoc(oldId));
  const body = Y.encodeStateAsUpdate(sourceDoc);

  const copy = { ...note, id: newId, updated: Date.now() };
  delete copy.privateFolderId;
  if (from) delete copy.aiHidden;

  if (targetSession) {
    copy.privateFolderId = to;
    Y.applyUpdate(targetSession.bodyDoc(newId), body);
    state.notes.set(newId, copy);
    targetSession.putNote(copy);
    indexForSearch(copy, targetSession.bodyDoc(newId));
  } else {
    state.notes.set(newId, copy);
    await original.notesPut(copy);
    const target = getNoteDoc(newId);
    await target.ready;
    Y.applyUpdate(target.doc, body);
    await target.persistence.whenWritten?.();
  }

  // The old one goes for good: a readable copy must not stay behind.
  const wasOpen = state.currentNoteId === oldId;
  if (sourceSession) {
    sourceSession.deleteNote(oldId);
    state.notes.delete(oldId);
    state.searchIndex.delete(oldId);
  } else {
    // Its tombstone must not keep the title (it went private).
    state.notes.set(oldId, { ...note, id: oldId, title: '' });
    const { permanentlyDeleteNote } = await import('../trash.js');
    await permanentlyDeleteNote(oldId, { source: 'private-folder' });
    await scrubVaultHistory();
  }

  refreshUi();

  if (wasOpen) {
    const { openNote } = await import('../notes.js');
    await openNote(newId);
  }

  return newId;
}

async function readyDoc(noteId) {
  const entry = getNoteDoc(noteId);
  await entry.ready;
  return entry.doc;
}

// ---------------------------------------------------------------- boot

/** At start: placeholders for the private folders, and keep them current. */
export async function setupPrivateFolders() {
  await installPrivateFolderRouter();
  syncPrivatePlaceholders();

  window.addEventListener('yanta-vault-hydrated', () => {
    if (syncPrivatePlaceholders()) refreshUi();
  });
}

// For tests: the session without the app around it.
export { PrivateSession as PrivateSessionForTests };
