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
import { IndexeddbPersistence } from 'y-indexeddb';

const VAULT_DOC_KEY = 'yanta-vault-v1';

let vaultEntry = null;

export const VAULT_ORIGINS = {
  LOCAL_SEED: 'sync2-vault-local-seed',
  STORE_BRIDGE: 'sync2-store-bridge',
  REMOTE: 'sync2-remote',
};

export function vaultDevicesMap() {
  return vaultMap('devices');
}

export function getVaultEntry() {
  if (vaultEntry) return vaultEntry;

  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(VAULT_DOC_KEY, doc);

  const ready = new Promise((resolve) => {
    persistence.once('synced', () => resolve());
  });

  vaultEntry = {
    doc,
    persistence,
    ready,
  };

  return vaultEntry;
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
  const settings = Object.fromEntries(vaultSettingsMap());
  const devices = Object.fromEntries(vaultDevicesMap());
  const tombstones = Object.fromEntries(vaultTombstonesMap());

  return safeJsonClone({
    notes,
    folders,
    images,
    events,
    calendarCategories,
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