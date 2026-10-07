// ============================================================
// YANTA Sync2 — VaultDoc
//
// VaultDoc is the CRDT source for vault-wide metadata:
// - notes metadata
// - folders metadata
// - images metadata
// - tombstones
//
// Existing IndexedDB metadata remains the local cache / legacy store.
// This module does not change UI behavior by itself.
// ============================================================

import * as Y from 'yjs';
import { IndexeddbPersistence, fetchUpdates } from 'y-indexeddb';

const VAULT_DOC_KEY = 'yanta-vault-v1';

/*
  All synced root maps of the VaultDoc. Used by the local history-compaction
  rebuild to copy every live value into a fresh doc. If a new synced vault map
  is ever added, it MUST be listed here or it would be lost on compaction.
*/
const VAULT_MAP_NAMES = [
  'notes',
  'folders',
  'images',
  'events',
  'calendarCategories',
  'rssFeeds',
  'spaces',
  'settings',
  'devices',
  'tombstones',
];

// A VaultDoc is considered bloated when its encoded update is much larger than
// its live compact state and past a floor where the load cost actually matters.
const VAULT_BLOAT_MIN_BYTES = 512 * 1024;
const VAULT_BLOAT_FACTOR = 4;

let vaultEntry = null;

export const VAULT_ORIGINS = {
  LOCAL_SEED: 'sync2-vault-local-seed',
  STORE_BRIDGE: 'sync2-store-bridge',
  REMOTE: 'sync2-remote',
};

export function vaultDevicesMap() {
  return vaultMap('devices');
}

function newVaultDoc() {
  /*
    gc:true drops the CONTENT of deleted/overwritten structs. It does not remove
    the struct markers from the encoding, so gc alone cannot undo an already
    bloated history — that is what prepareVaultDoc()'s rebuild is for — but it
    keeps ongoing churn cheaper.
  */
  return new Y.Doc({ gc: true });
}

function whenPersistenceSynced(persistence) {
  return new Promise((resolve) => {
    persistence.once('synced', () => resolve());
  });
}

export function getVaultEntry() {
  if (vaultEntry) return vaultEntry;

  const doc = newVaultDoc();
  const persistence = new IndexeddbPersistence(VAULT_DOC_KEY, doc);
  const ready = whenPersistenceSynced(persistence);

  vaultEntry = {
    doc,
    persistence,
    ready,
  };

  return vaultEntry;
}

/*
  Copy only the current (live) values of every vault map into a brand-new gc doc
  and encode it. The result carries the full semantic state with ZERO history —
  this is the only way to actually shrink a VaultDoc whose struct history has
  ballooned (e.g. from device-presence churn). Tombstones are copied too, so
  deletions are preserved and cannot resurrect on the next merge.
*/
function encodeCompactFromDoc(sourceDoc) {
  const compact = newVaultDoc();

  for (const name of VAULT_MAP_NAMES) {
    const src = sourceDoc.getMap(name);
    const tgt = compact.getMap(name);

    for (const [id, value] of src) {
      if (!id || value == null) continue;
      tgt.set(String(id), safeJsonClone(value));
    }
  }

  const update = Y.encodeStateAsUpdate(compact);
  compact.destroy();

  return update;
}

/**
 * Create the VaultDoc, healing a bloated local history first.
 *
 * MUST be awaited once during app startup BEFORE anything else touches the
 * VaultDoc (so the rebuild can replace the persistence without any live doc
 * references dangling). If the doc was already created, this is a no-op and the
 * rebuild is skipped.
 *
 * Why a rebuild and not gc/storeState: y-indexeddb replays the whole update log
 * synchronously on boot. A VaultDoc with a huge struct history (device presence
 * was written on every sync cycle) took ~17s to apply even though the live data
 * was ~48KB. Rebuilding from a fresh compact doc drops that history entirely.
 */
export async function prepareVaultDoc() {
  if (vaultEntry) return vaultEntry;

  let doc = newVaultDoc();
  let persistence = new IndexeddbPersistence(VAULT_DOC_KEY, doc);
  await whenPersistenceSynced(persistence);

  await withVaultAccess(async (exclusive) => {
    /*
      Another tab has the VaultDoc open: its in-memory doc keeps writing
      updates that build on the old history, which a rebuild throws away.
      Leave the history alone; the next boot without other tabs heals it.
    */
    if (!exclusive) return;

    let compact;
    let beforeBytes = 0;

    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      compact = encodeCompactFromDoc(doc);
      beforeBytes = encoded.length;

      const bloated =
        encoded.length > VAULT_BLOAT_MIN_BYTES &&
        encoded.length > compact.length * VAULT_BLOAT_FACTOR;

      if (!bloated) return;

      // One transaction: a crash leaves either the old log or the compact
      // state, never an empty vault (it holds events, tombstones, settings
      // and the only copy of shared-space keys).
      await replacePersistedUpdates(persistence, compact);
    } catch (err) {
      console.warn('[YANTA Sync2] VaultDoc compaction skipped', err);
      return;
    }

    // The store now holds the compact state; reload the doc from it.
    await persistence.destroy();
    doc.destroy();

    doc = newVaultDoc();
    persistence = new IndexeddbPersistence(VAULT_DOC_KEY, doc);
    await whenPersistenceSynced(persistence);

    console.info('[YANTA Sync2] VaultDoc history compacted', {
      beforeBytes,
      afterBytes: compact.length,
    });
  });

  vaultEntry = {
    doc,
    persistence,
    ready: Promise.resolve(),
  };

  return vaultEntry;
}

function replacePersistedUpdates(persistence, update) {
  return new Promise((resolve, reject) => {
    const tx = persistence.db.transaction(['updates'], 'readwrite');
    const updates = tx.objectStore('updates');

    updates.clear();
    updates.add(update);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('VaultDoc compaction aborted'));
  });
}

/*
  Every tab holds a shared lock on the VaultDoc for its lifetime. Only a
  tab that gets it exclusively — no other tab open — may rewrite the
  persisted history. Without Web Locks the old behaviour stays.
*/
const VAULT_ACCESS_LOCK = 'yanta-vault-doc';

async function withVaultAccess(fn) {
  const locks = globalThis.navigator?.locks;

  if (typeof locks?.request !== 'function') {
    return fn(true);
  }

  return locks.request(VAULT_ACCESS_LOCK, { ifAvailable: true }, async (lock) => {
    try {
      return await fn(!!lock);
    } finally {
      // Queued while still holding the exclusive lock, so no other tab can
      // slip in between and rewrite the history under this one.
      locks.request(VAULT_ACCESS_LOCK, { mode: 'shared' }, () => new Promise(() => {}));
    }
  });
}

/*
  Pull VaultDoc updates other tabs of this origin persisted since this tab
  last read the store. y-indexeddb does not sync live between tabs, so
  without this a tab works on — and uploads heads of — a stale copy.
  Applied with the persistence as origin, which the sync engine ignores.
*/
export async function refreshVaultDocFromStorage() {
  const entry = getVaultEntry();
  await entry.ready;

  if (!entry.persistence?.db || entry.persistence._destroyed) return;

  await fetchUpdates(entry.persistence);
}

export function isVaultPersistenceOrigin(origin) {
  return !!origin && origin === vaultEntry?.persistence;
}

export function getVaultDoc() {
  return getVaultEntry().doc;
}

export async function waitForVaultDoc() {
  const entry = getVaultEntry();
  await entry.ready;
  return entry.doc;
}

export function vaultMap(name) {
  return getVaultDoc().getMap(name);
}

export function vaultNotesMap() {
  return vaultMap('notes');
}

export function vaultFoldersMap() {
  return vaultMap('folders');
}

export function vaultImagesMap() {
  return vaultMap('images');
}

export function vaultEventsMap() {
  return vaultMap('events');
}

export function vaultCalendarCategoriesMap() {
  return vaultMap('calendarCategories');
}

/*
  Feed subscriptions, keyed by feed id.

  A map rather than one array under `settings`: two devices adding a source
  at the same time have to end up with both, and last-writer-wins on a single
  array value silently drops one of them. Unsubscribing writes a soft-deleted
  record instead of removing the key, so a device that still has the source
  locally cannot resurrect it on the next merge.
*/
export function vaultRssFeedsMap() {
  return vaultMap('rssFeeds');
}

/*
  Shared-space memberships, keyed by spaceId.

  These records carry the space's encryption keys, and they are the only
  copy that exists: a space is zero-knowledge, so the server can never
  hand them back. Before they lived here, losing local browser storage
  silently and permanently orphaned every share the device owned — the
  category kept working locally while nothing reached the other side.

  Storing share secrets in the VaultDoc follows what public shares already
  do (`sanitizePublicShareMeta` mirrors shareKey the same way): the vault
  is end-to-end encrypted with the user's sync key, so this stays
  zero-knowledge towards the server while surviving device loss.

  Soft-deleted rather than removed on unshare, for the same reason as
  rssFeeds: a device that still holds the record locally must not be able
  to resurrect a share that another device stopped.
*/
export function vaultSpacesMap() {
  return vaultMap('spaces');
}

export function vaultSettingsMap() {
  return vaultMap('settings');
}

export function vaultTombstonesMap() {
  return vaultMap('tombstones');
}

export function encodeVaultState() {
  return Y.encodeStateAsUpdate(getVaultDoc());
}

export function encodeVaultStateVector() {
  return Y.encodeStateVector(getVaultDoc());
}

export function encodeVaultUpdateFrom(stateVector) {
  return Y.encodeStateAsUpdate(getVaultDoc(), stateVector);
}

export function applyVaultUpdate(update, origin = VAULT_ORIGINS.REMOTE) {
  Y.applyUpdate(getVaultDoc(), update, origin);
}

export function onVaultUpdate(fn) {
  const doc = getVaultDoc();

  const handler = (update, origin) => {
    fn(update, origin);
  };

  doc.on('update', handler);

  return () => {
    doc.off('update', handler);
  };
}

export function addVaultTombstone(id, type, extra = {}, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  if (!id || !type) return;

  const doc = getVaultDoc();
  const tombstones = vaultTombstonesMap();

  doc.transact(() => {
    tombstones.set(String(id), {
      id: String(id),
      type: String(type),
      deletedAt: Date.now(),
      ...safeJsonClone(extra),
    });
  }, origin);
}

export function safeJsonClone(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

export function isPlainJsonValue(value) {
  if (value == null) return true;

  const t = typeof value;

  if (t === 'string' || t === 'number' || t === 'boolean') return true;

  if (Array.isArray(value)) {
    return value.every(isPlainJsonValue);
  }

  if (t === 'object') {
    if (value instanceof Date) return false;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return false;
    if (value instanceof ArrayBuffer) return false;
    if (ArrayBuffer.isView(value)) return false;

    // Avoid FileSystemHandle / custom browser objects.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;

    return Object.values(value).every(isPlainJsonValue);
  }

  return false;
}

export function jsonOnly(value, fallback = null) {
  if (isPlainJsonValue(value)) return safeJsonClone(value);
  return fallback;
}

export function vaultJsonSnapshot() {
  const notes = Object.fromEntries(vaultNotesMap());
  const folders = Object.fromEntries(vaultFoldersMap());
  const images = Object.fromEntries(vaultImagesMap());
  const events = Object.fromEntries(vaultEventsMap());
  const calendarCategories = Object.fromEntries(vaultCalendarCategoriesMap());
  const rssFeeds = Object.fromEntries(vaultRssFeedsMap());
  const settings = Object.fromEntries(vaultSettingsMap());
  const devices = Object.fromEntries(vaultDevicesMap());
  const tombstones = Object.fromEntries(vaultTombstonesMap());

  /*
    Deliberately redacted: this snapshot hangs off a window debug handle
    and ends up pasted into bug reports. Which shares exist is the useful
    part; their keys are not, and a share secret must never leave the app
    through a diagnostic surface.
  */
  const spaces = Object.fromEntries(
    [...vaultSpacesMap()].map(([id, raw]) => [id, {
      spaceId: raw?.spaceId || id,
      role: raw?.role || '',
      sourceType: raw?.sourceType || '',
      deleted: !!raw?.deleted,
      keys: '[redacted]',
    }])
  );

  return safeJsonClone({
    notes,
    folders,
    images,
    events,
    calendarCategories,
    rssFeeds,
    spaces,
    settings,
    devices,
    tombstones,
  });
}

function copyVaultMapToCompactDoc(targetDoc, targetName, sourceMap) {
  const target = targetDoc.getMap(targetName);

  for (const [id, value] of sourceMap()) {
    if (!id || value == null) continue;

    target.set(String(id), safeJsonClone(value));
  }
}

/**
 * Encode a fresh compact VaultDoc update from the current semantic maps.
 *
 * Why this exists:
 * Y.encodeStateAsUpdate(getVaultDoc()) can become huge because Yjs preserves
 * CRDT history/structs. For vault metadata we do not need that historical
 * struct graph remotely. Remote clients need the current semantic maps.
 *
 * This produces a small canonical full-state update from a fresh Y.Doc.
 */
export function encodeCompactVaultState({
  includeDevices = false,
  includeSettings = true,
} = {}) {
  const compact = new Y.Doc({
    gc: true,
  });

  copyVaultMapToCompactDoc(compact, 'notes', vaultNotesMap);
  copyVaultMapToCompactDoc(compact, 'folders', vaultFoldersMap);
  copyVaultMapToCompactDoc(compact, 'images', vaultImagesMap);
  copyVaultMapToCompactDoc(compact, 'events', vaultEventsMap);
  copyVaultMapToCompactDoc(compact, 'calendarCategories', vaultCalendarCategoriesMap);
  copyVaultMapToCompactDoc(compact, 'rssFeeds', vaultRssFeedsMap);
  copyVaultMapToCompactDoc(compact, 'spaces', vaultSpacesMap);
  copyVaultMapToCompactDoc(compact, 'tombstones', vaultTombstonesMap);

  if (includeDevices) {
    copyVaultMapToCompactDoc(compact, 'devices', vaultDevicesMap);
  }

  if (includeSettings) {
    copyVaultSettingsToCompactDoc(compact);
  }

  const update = Y.encodeStateAsUpdate(compact);

  compact.destroy();

  return update;
}

export async function clearVaultDocDataForDebugOnly() {
  const entry = getVaultEntry();
  await entry.ready;

  try {
    await entry.persistence.clearData();
  } catch {}

  entry.doc.destroy();
  vaultEntry = null;
}

export const VAULT_SYNCED_SETTING_KEYS = new Set([
  /*
    Only explicitly synced, JSON-safe Vault settings.

    Why:
    store.settings may contain browser/native handles or local-only state.
    VaultDoc.settings is reserved for intentionally synced encrypted app
    secrets/config. Chat uses encrypted values only.
  */
  'chatAccount',
  'chatRecovery',
  'chatRoomKeys',
]);

function copyVaultSettingsToCompactDoc(targetDoc) {
  const target = targetDoc.getMap('settings');

  for (const [key, value] of vaultSettingsMap()) {
    if (!VAULT_SYNCED_SETTING_KEYS.has(String(key))) continue;
    if (value == null) continue;

    target.set(String(key), safeJsonClone(value));
  }
}