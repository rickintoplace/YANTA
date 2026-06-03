// ============================================================
// YANTA Sync2 — Store Bridge
//
// Bridges existing IndexedDB metadata writes into VaultDoc.
//
// Why this exists:
// The current app writes metadata directly through core.store.* from many
// files. Replacing all call sites at once is risky.
// This bridge wraps store.notes/folders/images methods so future writes
// are mirrored into VaultDoc automatically.
//
// This is intentionally conservative:
// - notes/folders/images metadata are mirrored
// - image blobs are stripped
// - settings are NOT mirrored globally yet because some settings contain
//   browser-native objects such as FileSystemDirectoryHandle
// ============================================================

import { state, store } from '../core.js';

import {
  waitForVaultDoc,
  getVaultDoc,
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultTombstonesMap,
  addVaultTombstone,
  safeJsonClone,
  VAULT_ORIGINS,
} from './vault-doc.js';

let installed = false;
let originals = null;

function cleanUndefined(obj) {
  const out = {};

  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }

  return out;
}

export function sanitizeNoteMeta(note) {
  if (!note || typeof note !== 'object') return null;

  return cleanUndefined({
    id: String(note.id || ''),
    title: String(note.title || 'Untitled'),
    type: String(note.type || 'markdown'),
    folderId: note.folderId || null,
    tags: Array.isArray(note.tags) ? [...note.tags].map(String) : [],
    pinned: !!note.pinned,
    icon: note.icon || undefined,
    color: note.color || undefined,
    created: Number(note.created || Date.now()),
    updated: Number(note.updated || Date.now()),
    bodyMigrated: note.bodyMigrated === true ? true : undefined,

    hidden: note.hidden === true ? true : undefined,
    archived: note.archived === true ? true : undefined,
    system: note.system === true ? true : undefined,
    aiBrain: note.aiBrain === true ? true : undefined,
    dashboardHidden: note.dashboardHidden === true ? true : undefined,
    hiddenFromDashboard: note.hiddenFromDashboard === true ? true : undefined,
  });
}

export function sanitizeFolderMeta(folder) {
  if (!folder || typeof folder !== 'object') return null;

  return cleanUndefined({
    id: String(folder.id || ''),
    name: String(folder.name || 'Folder'),
    parentId: folder.parentId || null,
    icon: folder.icon || undefined,
    color: folder.color || undefined,
    created: Number(folder.created || Date.now()),
    updated: Number(folder.updated || folder.created || Date.now()),

    hidden: folder.hidden === true ? true : undefined,
    archived: folder.archived === true ? true : undefined,
    system: folder.system === true ? true : undefined,
    aiBrain: folder.aiBrain === true ? true : undefined,
    dashboardHidden: folder.dashboardHidden === true ? true : undefined,
    hiddenFromDashboard: folder.hiddenFromDashboard === true ? true : undefined,
  });
}

export function sanitizeImageMeta(image) {
  if (!image || typeof image !== 'object') return null;

  const { blob, data, ...rest } = image;

  return cleanUndefined({
    id: String(rest.id || ''),
    name: rest.name ? String(rest.name) : undefined,
    size: Number(rest.size || 0),
    type: rest.type ? String(rest.type) : undefined,
    ts: Number(rest.ts || rest.updated || Date.now()),
    updated: Number(rest.updated || rest.ts || Date.now()),
  });
}

function stableJsonStringify(value) {
  if (value == null) return String(value);

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(stableJsonStringify).join(',') + ']';
  }

  const keys = Object.keys(value).sort();

  return '{' + keys
    .map((key) => JSON.stringify(key) + ':' + stableJsonStringify(value[key]))
    .join(',') + '}';
}

function jsonEqual(a, b) {
  try {
    return stableJsonStringify(a) === stableJsonStringify(b);
  } catch {
    return false;
  }
}

function shouldKeepExistingByUpdated(existing, incoming) {
  if (!existing) return false;

  const exUpdated = Number(existing.updated || existing.ts || existing.created || 0);
  const inUpdated = Number(incoming.updated || incoming.ts || incoming.created || 0);

  return exUpdated > inUpdated;
}

export function putVaultNoteMeta(note, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  const meta = sanitizeNoteMeta(note);
  if (!meta?.id) return;

  const doc = getVaultDoc();
  const notes = vaultNotesMap();

  doc.transact(() => {
    const existing = notes.get(meta.id);

    if (jsonEqual(existing, meta)) return;
    if (shouldKeepExistingByUpdated(existing, meta)) return;

    notes.set(meta.id, safeJsonClone(meta));
    vaultTombstonesMap().delete(meta.id);
  }, origin);
}

export function putVaultFolderMeta(folder, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  const meta = sanitizeFolderMeta(folder);
  if (!meta?.id) return;

  const doc = getVaultDoc();
  const folders = vaultFoldersMap();

  doc.transact(() => {
    const existing = folders.get(meta.id);

    if (jsonEqual(existing, meta)) return;
    if (shouldKeepExistingByUpdated(existing, meta)) return;

    folders.set(meta.id, safeJsonClone(meta));
    vaultTombstonesMap().delete(meta.id);
  }, origin);
}

export function putVaultImageMeta(image, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  const meta = sanitizeImageMeta(image);
  if (!meta?.id) return;

  const doc = getVaultDoc();
  const images = vaultImagesMap();

  doc.transact(() => {
    const existing = images.get(meta.id);

    if (jsonEqual(existing, meta)) return;
    if (shouldKeepExistingByUpdated(existing, meta)) return;

    images.set(meta.id, safeJsonClone(meta));
    vaultTombstonesMap().delete(meta.id);
  }, origin);
}

export function deleteVaultNoteMeta(noteId, extra = {}, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  if (!noteId) return;

  const id = String(noteId);
  const doc = getVaultDoc();

  doc.transact(() => {
    vaultNotesMap().delete(id);
    addVaultTombstone(id, 'note', extra, origin);
  }, origin);
}

export function deleteVaultFolderMeta(folderId, extra = {}, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  if (!folderId) return;

  const id = String(folderId);
  const doc = getVaultDoc();

  doc.transact(() => {
    vaultFoldersMap().delete(id);
    addVaultTombstone(id, 'folder', extra, origin);
  }, origin);
}

export function deleteVaultImageMeta(imageId, extra = {}, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  if (!imageId) return;

  const id = String(imageId);
  const doc = getVaultDoc();

  doc.transact(() => {
    vaultImagesMap().delete(id);
    addVaultTombstone(id, 'image', extra, origin);
  }, origin);
}

/**
 * Seed VaultDoc from currently loaded app state.
 *
 * This is safe to call during startup after:
 * - state.notes has been populated
 * - state.folders has been populated
 * - state.imagesMeta has been populated
 */
export async function seedVaultFromLocalState() {
  await waitForVaultDoc();

  const doc = getVaultDoc();

  doc.transact(() => {
    for (const note of state.notes.values()) {
      putVaultNoteMeta(note, VAULT_ORIGINS.LOCAL_SEED);
    }

    for (const folder of state.folders.values()) {
      putVaultFolderMeta(folder, VAULT_ORIGINS.LOCAL_SEED);
    }

    for (const image of state.imagesMeta.values()) {
      putVaultImageMeta(image, VAULT_ORIGINS.LOCAL_SEED);
    }
  }, VAULT_ORIGINS.LOCAL_SEED);
}

/**
 * Install bridge wrappers.
 *
 * Call once after openDB().
 */
export async function installVaultStoreBridge() {
  if (installed) return;
  installed = true;

  await waitForVaultDoc();

  originals = {
    notes: {
      put: store.notes.put.bind(store.notes),
      del: store.notes.del.bind(store.notes),
    },
    folders: {
      put: store.folders.put.bind(store.folders),
      del: store.folders.del.bind(store.folders),
    },
    images: {
      put: store.images.put.bind(store.images),
      del: store.images.del.bind(store.images),
    },
  };

  store.notes.put = async (note) => {
    const res = await originals.notes.put(note);
    putVaultNoteMeta(note);
    return res;
  };

  store.notes.del = async (id) => {
    const existing = state.notes.get(id);

    const res = await originals.notes.del(id);

    deleteVaultNoteMeta(id, {
      title: existing?.title || '',
      deletedBy: await getDeviceIdBestEffort(),
    });

    return res;
  };

  store.folders.put = async (folder) => {
    const res = await originals.folders.put(folder);
    putVaultFolderMeta(folder);
    return res;
  };

  store.folders.del = async (id) => {
    const existing = state.folders.get(id);

    const res = await originals.folders.del(id);

    deleteVaultFolderMeta(id, {
      name: existing?.name || '',
      deletedBy: await getDeviceIdBestEffort(),
    });

    return res;
  };

  store.images.put = async (image) => {
    const res = await originals.images.put(image);
    putVaultImageMeta(image);
    return res;
  };

  store.images.del = async (id) => {
    const existing = state.imagesMeta.get(id);

    const res = await originals.images.del(id);

    deleteVaultImageMeta(id, {
      name: existing?.name || '',
      deletedBy: await getDeviceIdBestEffort(),
    });

    return res;
  };
}

async function getDeviceIdBestEffort() {
  try {
    let id = await store.settings.get('deviceId', null);

    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      await store.settings.set('deviceId', id);
    }

    return id;
  } catch {
    return 'dev_unknown';
  }
}

export function isVaultStoreBridgeInstalled() {
  return installed;
}

export function uninstallVaultStoreBridgeForDebugOnly() {
  if (!installed || !originals) return;

  store.notes.put = originals.notes.put;
  store.notes.del = originals.notes.del;

  store.folders.put = originals.folders.put;
  store.folders.del = originals.folders.del;

  store.images.put = originals.images.put;
  store.images.del = originals.images.del;

  installed = false;
  originals = null;
}