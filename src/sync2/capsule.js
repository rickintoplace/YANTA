// ============================================================
// YANTA Sync2 — Sync Capsule
//
// A Sync Capsule is an encrypted, provider-independent backup/transfer file.
//
// File extension:
//   .yanta
//
// Container:
//   ZIP with STORED entries
//
// Contents:
//   manifest.json                         unencrypted, no titles/content
//   objects/yanta-sync-v1/bootstrap.json  unencrypted bootstrap
//   objects/.../*.enc                      encrypted Vault/Note/Asset objects
//
// Security model:
// - Note contents, drawings, metadata, images/assets are encrypted.
// - Manifest reveals object count, object sizes, timestamps, internal random IDs.
// - No note titles, folder names, tags, markdown, drawings, image contents in plaintext.
// ============================================================

import * as Y from 'yjs';

import {
  state,
  store,
  toast,
  downloadBlob,
} from '../core.js';

import {
  getNoteDoc,
  encodeNoteState,
} from '../yjs.js';

import {
  rebuildWikilinkIndex,
  removePristineWelcomeVaultIfPresent,
} from '../notes.js';

import {
  renderTree,
} from '../tree.js';

import {
  getVaultDoc,
  encodeVaultState,
  applyVaultUpdate,
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultEventsMap,
  vaultCalendarCategoriesMap,
  vaultTombstonesMap,
  vaultJsonSnapshot,
  safeJsonClone,
} from './vault-doc.js';

import {
  generateSyncKey,
  deriveKeys,
  encryptBytes,
  decryptBytes,
  sha256,
  base64UrlEncode,
  utf8Encode,
  utf8Decode,
} from './crypto.js';

import {
  bootstrapPath,
  vaultSnapshotPath,
  docSnapshotPath,
  assetBlobPath,
  createVaultId,
} from './ids.js';

const CAPSULE_FORMAT = 'yanta-sync-capsule';
const CAPSULE_VERSION = 1;

const SYNC_KEY_SETTING = 'sync2.syncKey';
const LEGACY_DEBUG_SYNC_KEY_SETTING = 'sync2.debug.syncKey';
const DEVICE_ID_SETTING = 'sync2.deviceId';

const te = new TextEncoder();
const td = new TextDecoder();

function nowIso() {
  return new Date().toISOString();
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function cleanUndefined(obj) {
  const out = {};

  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }

  return out;
}

function sanitizeNoteMeta(note) {
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
  });
}

function sanitizeFolderMeta(folder) {
  if (!folder || typeof folder !== 'object') return null;

  return cleanUndefined({
    id: String(folder.id || ''),
    name: String(folder.name || 'Folder'),
    parentId: folder.parentId || null,
    icon: folder.icon || undefined,
    color: folder.color || undefined,
    created: Number(folder.created || Date.now()),
    updated: Number(folder.updated || folder.created || Date.now()),
  });
}

function sanitizeImageMeta(image) {
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

function preferIncoming(existing, incoming) {
  if (!existing) return true;

  const exUpdated = Number(existing.updated || existing.ts || existing.created || 0);
  const inUpdated = Number(incoming.updated || incoming.ts || incoming.created || 0);

  return inUpdated >= exUpdated;
}

async function getOrCreateSyncKey() {
  let key = await store.settings.get(SYNC_KEY_SETTING, null);

  if (!key) {
    // Compatibility with the debug runtime from PR 2b.
    key = await store.settings.get(LEGACY_DEBUG_SYNC_KEY_SETTING, null);
  }

  if (!key) {
    key = generateSyncKey();
  }

  // Keep both keys aligned for now while app-engine still uses debug setting.
  await store.settings.set(SYNC_KEY_SETTING, key);
  await store.settings.set(LEGACY_DEBUG_SYNC_KEY_SETTING, key);

  return key;
}

async function getOrCreateDeviceId() {
  let id = await store.settings.get(DEVICE_ID_SETTING, null);

  if (!id) {
    id = 'app_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
    await store.settings.set(DEVICE_ID_SETTING, id);
  }

  return id;
}

async function objectSha256Base64Url(bytes) {
  return base64UrlEncode(await sha256(bytes));
}

function zipObjectPath(remotePath) {
  return 'objects/' + String(remotePath || '').replace(/^\/+/, '');
}

function remotePathFromZipObjectPath(path) {
  return String(path || '').replace(/^objects\//, '');
}

async function makeEncryptedObject({
  type,
  path,
  plaintext,
  keys,
  extra = {},
}) {
  const encrypted = await encryptBytes(keys.contentKey, plaintext, path);

  return {
    descriptor: {
      type,
      path,
      zipPath: zipObjectPath(path),
      size: encrypted.byteLength,
      sha256: await objectSha256Base64Url(encrypted),
      ...extra,
    },
    entry: {
      path: zipObjectPath(path),
      data: encrypted,
    },
  };
}

function blobToBytes(blob) {
  return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
}

/**
 * Export encrypted Sync Capsule.
 */
export async function exportSyncCapsule({
  filename = `yanta-sync-${dateStamp()}.yanta`,
  includeAssets = true,
} = {}) {
  const syncKey = await getOrCreateSyncKey();
  const deviceId = await getOrCreateDeviceId();
  const keys = await deriveKeys(syncKey);

  const created = nowIso();
  const vaultId = createVaultId();

  const objects = [];
  const entries = [];

  // ----------------------------------------------------------------
  // Bootstrap object — intentionally unencrypted, no content.
  // ----------------------------------------------------------------
  const bootstrap = {
    format: 'yanta-sync',
    version: 1,
    vaultId,
    created,
    encryption: {
      alg: 'AES-GCM',
      kdf: 'raw-256',
    },
  };

  const bootstrapBytes = utf8Encode(JSON.stringify(bootstrap, null, 2));
  const bootstrapRemotePath = bootstrapPath();

  const bootstrapDesc = {
    type: 'bootstrap',
    path: bootstrapRemotePath,
    zipPath: zipObjectPath(bootstrapRemotePath),
    size: bootstrapBytes.byteLength,
    sha256: await objectSha256Base64Url(bootstrapBytes),
  };

  objects.push(bootstrapDesc);
  entries.push({
    path: bootstrapDesc.zipPath,
    data: bootstrapBytes,
  });

  // ----------------------------------------------------------------
  // Vault snapshot — contains notes/folders/images/tombstones metadata.
  // Encrypted.
  // ----------------------------------------------------------------
  const vaultPath = vaultSnapshotPath(deviceId, 1);

  const vaultObj = await makeEncryptedObject({
    type: 'vault-snapshot',
    path: vaultPath,
    plaintext: encodeVaultState(),
    keys,
    extra: {
      docId: 'vault',
    },
  });

  objects.push(vaultObj.descriptor);
  entries.push(vaultObj.entry);

  // ----------------------------------------------------------------
  // Note snapshots — markdown + drawings live inside each Note Y.Doc.
  // Encrypted.
  // ----------------------------------------------------------------
  const noteIds = new Set();

  for (const id of state.notes.keys()) noteIds.add(id);
  for (const id of vaultNotesMap().keys()) noteIds.add(id);

  for (const noteId of noteIds) {
    if (vaultTombstonesMap().has(noteId)) continue;

    const entry = getNoteDoc(noteId);
    await entry.ready;

    const notePath = await docSnapshotPath(keys.nameKey, noteId, deviceId, 1);

    const noteObj = await makeEncryptedObject({
      type: 'note-snapshot',
      path: notePath,
      plaintext: encodeNoteState(noteId),
      keys,
      extra: {
        noteId,
      },
    });

    objects.push(noteObj.descriptor);
    entries.push(noteObj.entry);
  }

  // ----------------------------------------------------------------
  // Assets/images — blobs are encrypted separately.
  // ----------------------------------------------------------------
  let assetCount = 0;
  let assetBytes = 0;

  if (includeAssets) {
    const assetIds = new Set();

    for (const id of state.imagesMeta.keys()) assetIds.add(id);
    for (const id of vaultImagesMap().keys()) assetIds.add(id);

    for (const assetId of assetIds) {
      if (vaultTombstonesMap().has(assetId)) continue;

      const rec = await store.images.get(assetId).catch(() => null);

      if (!rec?.blob) continue;

      const plain = await blobToBytes(rec.blob);
      const assetPath = await assetBlobPath(keys.nameKey, assetId);

      const assetObj = await makeEncryptedObject({
        type: 'asset-blob',
        path: assetPath,
        plaintext: plain,
        keys,
        extra: {
          assetId,
          mime: rec.type || rec.blob.type || state.imagesMeta.get(assetId)?.type || 'application/octet-stream',
        },
      });

      objects.push(assetObj.descriptor);
      entries.push(assetObj.entry);

      assetCount++;
      assetBytes += plain.byteLength;
    }
  }

  // ----------------------------------------------------------------
  // Key check — encrypted known plaintext to detect wrong recovery key.
  // ----------------------------------------------------------------
  const keyCheckAad = 'yanta-sync-capsule-key-check-v1';
  const keyCheckBytes = await encryptBytes(
    keys.contentKey,
    utf8Encode('yanta-sync-capsule-key-ok'),
    keyCheckAad
  );

  const manifest = {
    format: CAPSULE_FORMAT,
    version: CAPSULE_VERSION,
    created,
    app: {
      name: 'YANTA',
    },
    encryption: {
      alg: 'AES-GCM',
      key: 'sync-key-v1',
      keyCheckAad,
      keyCheck: utf8Decode(keyCheckBytes),
    },
    stats: {
      notes: noteIds.size,
      folders: vaultFoldersMap().size,
      images: vaultImagesMap().size,
      events: vaultEventsMap().size,
      calendarCategories: vaultCalendarCategoriesMap().size,
      assetsIncluded: assetCount,
      assetBytes,
      tombstones: vaultTombstonesMap().size,
      objects: objects.length,
    },
    objects,
  };

  const manifestBytes = utf8Encode(JSON.stringify(manifest, null, 2));

  entries.unshift({
    path: 'manifest.json',
    data: manifestBytes,
  });

  const blob = makeZip(entries);

  downloadBlob(blob, filename);

  toast(`Sync Capsule exported: ${filename}`, 'success');

  return {
    filename,
    manifest,
    blob,
  };
}

/**
 * Import/merge encrypted Sync Capsule.
 */
export async function importSyncCapsuleFile(file, {
  syncKey = null,
  askForKey = true,
} = {}) {
  if (!file) throw new Error('No capsule file selected');

  const entries = await readZip(file);
  const byPath = new Map(entries.filter((e) => !e.isDir).map((e) => [e.path, e]));

  const manifestEntry = byPath.get('manifest.json');

  if (!manifestEntry) {
    throw new Error('Capsule manifest missing');
  }

  const manifest = JSON.parse(utf8Decode(manifestEntry.data));

  if (
    manifest?.format !== CAPSULE_FORMAT ||
    manifest?.version !== CAPSULE_VERSION ||
    !Array.isArray(manifest.objects)
  ) {
    throw new Error('Not a supported YANTA Sync Capsule');
  }

  let key = syncKey || await getOrCreateSyncKey();
  let keys = await deriveKeys(key);

  // Verify key.
  try {
    await verifyCapsuleKey(manifest, keys);
  } catch (err) {
    if (!askForKey) throw err;

    const entered = prompt(
      'This Sync Capsule was encrypted with a different Sync Key.\n\nPaste the recovery/sync key for this capsule:'
    );

    if (!entered) {
      throw new Error('Import cancelled: sync key required');
    }

    key = entered.trim();
    keys = await deriveKeys(key);

    await verifyCapsuleKey(manifest, keys);

    await store.settings.set(SYNC_KEY_SETTING, key);
    await store.settings.set(LEGACY_DEBUG_SYNC_KEY_SETTING, key);
  }

  // Verify checksums before applying anything.
  for (const obj of manifest.objects) {
    const entry = byPath.get(obj.zipPath);

    if (!entry) {
      throw new Error(`Capsule object missing: ${obj.zipPath}`);
    }

    const got = await objectSha256Base64Url(entry.data);

    if (got !== obj.sha256) {
      throw new Error(`Capsule object checksum mismatch: ${obj.zipPath}`);
    }
  }

  // Fresh installs create a built-in Welcome Vault automatically.
  // If it is still untouched, remove it before importing a capsule so
  // Welcome content from the capsule does not get duplicated.
  await removePristineWelcomeVaultIfPresent({
    reason: 'sync-capsule-import',
  });

  let vaultApplied = 0;
  let notesApplied = 0;
  let assetsApplied = 0;

  // Apply Vault first.
  for (const obj of manifest.objects) {
    if (obj.type !== 'vault-snapshot') continue;

    const entry = byPath.get(obj.zipPath);
    const plain = await decryptBytes(keys.contentKey, entry.data, obj.path);

    applyVaultUpdate(plain, 'sync2-remote');

    vaultApplied++;
  }

  // Persist metadata to local IndexedDB cache before note docs.
  await persistVaultMetadataToLocalCache();

  // Apply note snapshots.
  for (const obj of manifest.objects) {
    if (obj.type !== 'note-snapshot') continue;
    if (!obj.noteId) continue;

    // If the capsule's vault contains a tombstone for this note, skip note body.
    if (vaultTombstonesMap().has(obj.noteId)) continue;

    const entry = byPath.get(obj.zipPath);
    const plain = await decryptBytes(keys.contentKey, entry.data, obj.path);

    const noteEntry = getNoteDoc(obj.noteId);
    await noteEntry.ready;

    Y.applyUpdate(noteEntry.doc, plain, 'sync2-remote');

    notesApplied++;
  }

  // Apply assets after Vault metadata.
  for (const obj of manifest.objects) {
    if (obj.type !== 'asset-blob') continue;
    if (!obj.assetId) continue;

    if (vaultTombstonesMap().has(obj.assetId)) continue;

    const entry = byPath.get(obj.zipPath);
    const plain = await decryptBytes(keys.contentKey, entry.data, obj.path);

    const meta =
      sanitizeImageMeta(vaultImagesMap().get(obj.assetId)) ||
      sanitizeImageMeta(state.imagesMeta.get(obj.assetId)) ||
      {
        id: obj.assetId,
        name: obj.assetId,
        size: plain.byteLength,
        type: obj.mime || 'application/octet-stream',
        ts: Date.now(),
      };

    const blob = new Blob([plain], {
      type: obj.mime || meta.type || 'application/octet-stream',
    });

    await store.images.put({
      ...meta,
      size: blob.size,
      type: blob.type || meta.type,
      blob,
    });

    state.imagesMeta.set(meta.id, {
      ...meta,
      size: blob.size,
      type: blob.type || meta.type,
    });

    assetsApplied++;
  }

  await persistVaultMetadataToLocalCache();

  rebuildWikilinkIndex();
  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-vault-hydrated'));

  toast(
    `Sync Capsule imported: ${notesApplied} note snapshot${notesApplied === 1 ? '' : 's'}, ${assetsApplied} asset${assetsApplied === 1 ? '' : 's'}`,
    'success'
  );

  window.dispatchEvent(new CustomEvent('yanta-sync-capsule-imported', {
    detail: {
      manifest,
      vaultApplied,
      notesApplied,
      assetsApplied,
    },
  }));

  return {
    manifest,
    vaultApplied,
    notesApplied,
    assetsApplied,
  };
}

async function verifyCapsuleKey(manifest, keys) {
  const enc = manifest?.encryption;

  if (!enc?.keyCheck || !enc?.keyCheckAad) {
    throw new Error('Capsule key check missing');
  }

  const plain = await decryptBytes(
    keys.contentKey,
    utf8Encode(enc.keyCheck),
    enc.keyCheckAad
  );

  const txt = utf8Decode(plain);

  if (txt !== 'yanta-sync-capsule-key-ok') {
    throw new Error('Wrong Sync Key');
  }
}

async function persistVaultMetadataToLocalCache() {
  const tombstones = vaultTombstonesMap();

  // Deletes/tombstones.
  for (const [id, t] of tombstones) {
    if (t?.type === 'note') {
      state.notes.delete(id);
      state.searchIndex.delete(id);

      try {
        await store.notes.del(id);
      } catch {}
    }

    if (t?.type === 'folder') {
      state.folders.delete(id);
      state.expandedFolders.delete(id);

      try {
        await store.folders.del(id);
      } catch {}
    }

    if (t?.type === 'image') {
      state.imagesMeta.delete(id);

      const url = state.imageBlobs.get(id);

      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }

      state.imageBlobs.delete(id);

      try {
        await store.images.del(id);
      } catch {}
    }
  }

  // Notes.
  for (const [id, raw] of vaultNotesMap()) {
    if (tombstones.has(id)) continue;

    const incoming = sanitizeNoteMeta(raw);
    if (!incoming?.id) continue;

    const existing = state.notes.get(id);

    if (preferIncoming(existing, incoming)) {
      state.notes.set(id, safeJsonClone(incoming));
      await store.notes.put(safeJsonClone(incoming));
    }
  }

  // Folders.
  for (const [id, raw] of vaultFoldersMap()) {
    if (tombstones.has(id)) continue;

    const incoming = sanitizeFolderMeta(raw);
    if (!incoming?.id) continue;

    const existing = state.folders.get(id);

    if (preferIncoming(existing, incoming)) {
      state.folders.set(id, safeJsonClone(incoming));
      await store.folders.put(safeJsonClone(incoming));
    }
  }

  // Images metadata only; actual blobs are handled separately.
  for (const [id, raw] of vaultImagesMap()) {
    if (tombstones.has(id)) continue;

    const incoming = sanitizeImageMeta(raw);
    if (!incoming?.id) continue;

    const existing = state.imagesMeta.get(id);

    if (preferIncoming(existing, incoming)) {
      state.imagesMeta.set(id, safeJsonClone(incoming));
      // Do not store an image record without blob if one doesn't exist.
      // store.images contains blob records; metadata is reconstructed via allMeta().
    }
  }
}

export async function pickAndImportSyncCapsule() {
  const input = document.createElement('input');

  input.type = 'file';
  input.accept = '.yanta,application/zip,application/octet-stream';

  return new Promise((resolve, reject) => {
    input.onchange = async () => {
      const file = input.files?.[0];

      if (!file) {
        resolve(null);
        return;
      }

      try {
        const res = await importSyncCapsuleFile(file);
        resolve(res);
      } catch (err) {
        console.error(err);
        toast('Sync Capsule import failed: ' + (err?.message || String(err)), 'error');
        reject(err);
      }
    };

    input.click();
  });
}

export async function copySyncCapsuleRecoveryKey() {
  const key = await getOrCreateSyncKey();

  try {
    await navigator.clipboard.writeText(key);
    toast('Sync key copied. Keep it private.', 'success');
  } catch {
    prompt('Copy your Sync Key and keep it private:', key);
  }

  return key;
}

export function capsuleDebugSnapshot() {
  return {
    vault: vaultJsonSnapshot(),
    notes: [...state.notes.keys()],
    folders: [...state.folders.keys()],
    images: [...state.imagesMeta.keys()],
  };
}

// ============================================================
// ZIP write/read helpers
// STORED writer + STORED/DEFLATE reader.
// ============================================================

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let c = i;

    for (let j = 0; j < 8; j++) {
      c = (c & 1)
        ? (0xedb88320 ^ (c >>> 1))
        : (c >>> 1);
    }

    t[i] = c;
  }

  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;

  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const now = new Date();

  const dosTime = (
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    (now.getSeconds() >> 1)
  ) & 0xffff;

  const dosDate = (
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate()
  ) & 0xffff;

  const chunks = [];
  const cd = [];

  let offset = 0;

  for (const e of entries) {
    const name = te.encode(e.path);
    const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);
    const crc = crc32(data);

    const lfh = new Uint8Array(30 + name.length);
    const dv = new DataView(lfh.buffer);

    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);

    lfh.set(name, 30);

    chunks.push(lfh, data);

    cd.push({
      name,
      dataLen: data.length,
      crc,
      offset,
    });

    offset += lfh.length + data.length;
  }

  const cdStart = offset;

  for (const ent of cd) {
    const h = new Uint8Array(46 + ent.name.length);
    const dv = new DataView(h.buffer);

    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, dosTime, true);
    dv.setUint16(14, dosDate, true);
    dv.setUint32(16, ent.crc, true);
    dv.setUint32(20, ent.dataLen, true);
    dv.setUint32(24, ent.dataLen, true);
    dv.setUint16(28, ent.name.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, ent.offset, true);

    h.set(ent.name, 46);

    chunks.push(h);

    offset += h.length;
  }

  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);

  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(4, 0, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, cd.length, true);
  dv.setUint16(10, cd.length, true);
  dv.setUint32(12, offset - cdStart, true);
  dv.setUint32(16, cdStart, true);
  dv.setUint16(20, 0, true);

  chunks.push(eocd);

  return new Blob(chunks, {
    type: 'application/octet-stream',
  });
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read compressed ZIP entries');
  }

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));

  const reader = stream.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);

  let o = 0;

  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }

  return out;
}

async function readZip(blob) {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);

  let eocd = -1;

  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }

  if (eocd < 0) {
    throw new Error('Not a valid ZIP/YANTA capsule');
  }

  const numEntries = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  const entries = [];

  let p = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) {
      throw new Error('Bad ZIP central directory entry');
    }

    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lfhOffset = dv.getUint32(p + 42, true);

    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));

    p += 46 + nameLen + extraLen + commentLen;

    if (dv.getUint32(lfhOffset, true) !== 0x04034b50) {
      throw new Error('Bad ZIP local file header');
    }

    const lfhNameLen = dv.getUint16(lfhOffset + 26, true);
    const lfhExtraLen = dv.getUint16(lfhOffset + 28, true);
    const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    const raw = u8.subarray(dataStart, dataStart + compSize);

    let data;

    if (method === 0) {
      data = new Uint8Array(raw);
    } else if (method === 8) {
      data = await inflateRaw(raw);
    } else {
      throw new Error('Unsupported ZIP compression method: ' + method);
    }

    entries.push({
      path: name,
      data,
      isDir: name.endsWith('/'),
    });
  }

  return entries;
}