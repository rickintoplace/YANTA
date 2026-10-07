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

import { state, store, isSpaceMountedNote, isSpaceMountedFolder } from '../core.js';

import {
  waitForVaultDoc,
  getVaultDoc,
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultSpacesMap,
  vaultTombstonesMap,
  addVaultTombstone,
  safeJsonClone,
  VAULT_ORIGINS,
} from './vault-doc.js';

import {
  cleanUndefined,
  sanitizeNoteMeta,
  sanitizeFolderMeta,
  sanitizeImageMeta,
  jsonEqual,
} from './meta-sanitize.js';

export { sanitizeNoteMeta, sanitizeFolderMeta };

let installed = false;
let originals = null;

// Fields that are useful for local UI/cache freshness but must not create
// durable VaultDoc history by themselves.
//
// Note body edits update note.updated very frequently. The note body itself is
// synced through the per-note Y.Doc update stream. If we mirror updated-only
// changes into VaultDoc, every keystroke can become Vault update history.
const VAULT_META_VOLATILE_KEYS = new Set([
  'updated',
]);

function omitVolatileVaultMetaKeys(value = {}) {
  if (!value || typeof value !== 'object') return value;

  const out = {};

  for (const [key, val] of Object.entries(value || {})) {
    if (VAULT_META_VOLATILE_KEYS.has(key)) continue;
    out[key] = val;
  }

  return out;
}

function onlyVolatileVaultMetaChanged(existing, incoming) {
  if (!existing || !incoming) return false;

  return jsonEqual(
    omitVolatileVaultMetaKeys(existing),
    omitVolatileVaultMetaKeys(incoming)
  );
}

/*
  A permanent delete is final. Any write to a tombstoned id used to clear
  the tombstone, so an incidental metadata write — pin, dashboard layout,
  a late title autosave on a device that had not pulled the delete yet —
  brought the note back, without its body (body edits to tombstoned notes
  are not synced). Work done after a delete is rescued into a new note by
  the sync engine instead; imports re-add deleted items under new ids
  (isVaultTombstoned).
*/
function isPermanentlyDeleted(id) {
  return vaultTombstonesMap().has(String(id));
}

/**
 * Is this id permanently deleted in the vault? Importers re-adding items
 * under their original ids (backups, frontmatter ids) must use a new id
 * for those: a tombstone cannot be lifted reliably — every older head
 * still carries it and re-applies it on the next pull.
 */
export function isVaultTombstoned(id) {
  return isPermanentlyDeleted(id);
}

export function putVaultNoteMeta(note, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  const meta = sanitizeNoteMeta(note);
  if (!meta?.id) return;

  const doc = getVaultDoc();
  const notes = vaultNotesMap();

  doc.transact(() => {
    if (isPermanentlyDeleted(meta.id)) return;

    const existing = notes.get(meta.id);

    if (jsonEqual(existing, meta)) return;

    /*
      Critical storage fix:
      Body edits update note.updated, but note bodies sync via per-note Y.Doc
      updates. Do not mirror updated-only changes into VaultDoc, otherwise
      ordinary typing creates append-only Vault update history.
    */
    if (onlyVolatileVaultMetaChanged(existing, meta)) return;

    /*
      Important:
      Do NOT reject real local semantic metadata changes because existing.updated
      is newer. Device clocks can differ and body edits used to bump updated.
      If title/folder/tags/icon/color/etc. actually changed, the explicit local
      store write must reach VaultDoc.
    */
    notes.set(meta.id, safeJsonClone(meta));
  }, origin);
}

export function putVaultFolderMeta(folder, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  const meta = sanitizeFolderMeta(folder);
  if (!meta?.id) return;

  const doc = getVaultDoc();
  const folders = vaultFoldersMap();

  doc.transact(() => {
    if (isPermanentlyDeleted(meta.id)) return;

    const existing = folders.get(meta.id);

    if (jsonEqual(existing, meta)) return;

    /*
      updated-only folder cache refreshes should not create Vault history.
      Real folder changes still sync because fields like name, parentId,
      dashboardOrder, color, icon, trash flags, etc. differ.
    */
    if (onlyVolatileVaultMetaChanged(existing, meta)) return;

    /*
      Same reasoning as notes: explicit local semantic folder changes should
      not be blocked by a newer timestamp from another device.
    */
    folders.set(meta.id, safeJsonClone(meta));
  }, origin);
}

export function putVaultImageMeta(image, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  const meta = sanitizeImageMeta(image);
  if (!meta?.id) return;

  const doc = getVaultDoc();
  const images = vaultImagesMap();

  doc.transact(() => {
    if (isPermanentlyDeleted(meta.id)) return;

    const existing = images.get(meta.id);

    if (jsonEqual(existing, meta)) return;

    /*
      Asset metadata changes such as objectPath/encryptedAssetKeyForVault still
      sync. updated-only cache refreshes do not need durable Vault history.
    */
    if (onlyVolatileVaultMetaChanged(existing, meta)) return;

    /*
      No newer-timestamp veto, same as notes/folders: a device whose clock
      runs ahead used to block asset migrations (objectPath, encrypted
      asset key) from every other device without a trace. Recency across
      devices is settled on pull by the vault version guard.
    */
    images.set(meta.id, safeJsonClone(meta));
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

/*
  Shared-space records.

  Unlike notes/folders/images there is no allowlist of fields here: a
  space record is opaque session state (keys, tokens, epoch, source ids,
  per-type extras), and a record restored with fields missing would mount
  a share that then misbehaves in ways that are very hard to trace. So we
  keep whatever the space layer wrote, minus anything not JSON-safe.
*/
export function sanitizeSpaceRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const spaceId = String(record.spaceId || '').trim();
  if (!spaceId) return null;

  const clone = safeJsonClone(record);
  if (!clone || typeof clone !== 'object') return null;

  return cleanUndefined({
    ...clone,
    spaceId,
  });
}

export function putVaultSpaceRecord(record, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  const meta = sanitizeSpaceRecord(record);
  if (!meta?.spaceId) return;

  const doc = getVaultDoc();
  const spaces = vaultSpacesMap();

  doc.transact(() => {
    /*
      A stopped share must never come back. Mounted sessions re-put their
      record routinely, so without this a device that had not yet seen
      the unshare would resurrect it.
    */
    if (vaultTombstonesMap().has(meta.spaceId)) return;

    const existing = spaces.get(meta.spaceId);

    if (jsonEqual(existing, meta)) return;

    spaces.set(meta.spaceId, meta);
  }, origin);
}

/*
  Local-only removal, for cleanup that must NOT reach other devices.

  Pruning a mount whose local source is missing is a decision about this
  device, not an unshare. If it wrote a vault tombstone, a single device
  with incomplete local state would stop the share everywhere — and since
  the keys exist nowhere else, nothing could undo it. Stopping or leaving
  a share goes through the wrapped store.spaces.del and does propagate.
*/
export async function removeLocalSpaceRecordOnly(spaceId) {
  const id = String(spaceId || '').trim();
  if (!id) return;

  const del = originals?.spaces?.del || store.spaces.del.bind(store.spaces);

  await del(id);
}

/*
  Stopping a share is a tombstone, not a value in the spaces map.

  A "deleted: true" record under the same key loses a concurrent merge:
  any device that still has the space mounted re-puts its live record
  routinely, and if it had not seen the unshare yet, last-writer-wins
  hands the key back to the live value — the share silently resurrects.
  A tombstone is only ever added, so it cannot be overwritten, which is
  exactly why notes, folders and images already work this way.
*/
export function deleteVaultSpaceRecord(spaceId, extra = {}, origin = VAULT_ORIGINS.STORE_BRIDGE) {
  const id = String(spaceId || '').trim();
  if (!id) return;

  const doc = getVaultDoc();

  doc.transact(() => {
    const existing = vaultSpacesMap().get(id);

    vaultSpacesMap().delete(id);

    addVaultTombstone(id, 'space', {
      role: existing?.role || '',
      sourceType: existing?.sourceType || '',
      ...extra,
    }, origin);
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

  /*
    Read before the transaction: store.spaces is IndexedDB-backed and the
    Yjs transaction body has to stay synchronous.
  */
  let spaceRecords = [];

  try {
    spaceRecords = await store.spaces.all();
  } catch {
    spaceRecords = [];
  }

  /*
    Additive only: the seed carries cache entries the VaultDoc has never
    seen (data from before the bridge existed) into it. It must never
    overwrite an existing entry or clear a tombstone — the cache can lag
    behind the VaultDoc (a sync that stopped before refreshing it), and a
    stale cache written back here would revert remote renames, undo a
    trash or resurrect a deleted note, then propagate that everywhere.
    Startup hydration refreshes the cache from the VaultDoc right after.
  */
  const isNewToVault = (map, id) =>
    !!id && !map.has(id) && !vaultTombstonesMap().has(id);

  doc.transact(() => {
    for (const note of state.notes.values()) {
      if (isNewToVault(vaultNotesMap(), note?.id) && !isSpaceMountedNote(note)) {
        putVaultNoteMeta(note, VAULT_ORIGINS.LOCAL_SEED);
      }
    }

    for (const folder of state.folders.values()) {
      if (isNewToVault(vaultFoldersMap(), folder?.id) && !isSpaceMountedFolder(folder)) {
        putVaultFolderMeta(folder, VAULT_ORIGINS.LOCAL_SEED);
      }
    }

    for (const image of state.imagesMeta.values()) {
      if (isNewToVault(vaultImagesMap(), image?.id)) {
        putVaultImageMeta(image, VAULT_ORIGINS.LOCAL_SEED);
      }
    }

    /*
      Existing shares created before space records were durable: seeding
      them here is what carries them into the cloud on this device's next
      sync, so the next device to pair inherits them.
    */
    for (const record of spaceRecords) {
      putVaultSpaceRecord(record, VAULT_ORIGINS.LOCAL_SEED);
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
    spaces: {
      put: store.spaces.put.bind(store.spaces),
      del: store.spaces.del.bind(store.spaces),
    },
  };

  store.spaces.put = async (record) => {
    const res = await originals.spaces.put(record);
    putVaultSpaceRecord(record);
    return res;
  };

  store.spaces.del = async (spaceId) => {
    const res = await originals.spaces.del(spaceId);
    deleteVaultSpaceRecord(spaceId);
    return res;
  };

  store.notes.put = async (note) => {
    const res = await originals.notes.put(note);

    // Notes mounted from someone else's shared space stay out of the
    // private vault CRDT — their metadata/content belong to the space.
    if (!isSpaceMountedNote(note)) {
      putVaultNoteMeta(note);
    }

    return res;
  };

  store.notes.del = async (id) => {
    const existing = state.notes.get(id);

    const res = await originals.notes.del(id);

    if (!isSpaceMountedNote(existing)) {
      deleteVaultNoteMeta(id, {
        title: existing?.title || '',
        deletedBy: await getDeviceIdBestEffort(),
      });
    }

    return res;
  };

  store.folders.put = async (folder) => {
    const res = await originals.folders.put(folder);

    if (!isSpaceMountedFolder(folder)) {
      putVaultFolderMeta(folder);
    }

    return res;
  };

  store.folders.del = async (id) => {
    const existing = state.folders.get(id);

    const res = await originals.folders.del(id);

    if (!isSpaceMountedFolder(existing)) {
      deleteVaultFolderMeta(id, {
        name: existing?.name || '',
        deletedBy: await getDeviceIdBestEffort(),
      });
    }

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