// ============================================================
// YANTA Sync2 — Asset sync
//
// Syncs image/blob assets separately from Yjs documents.
//
// Metadata:
//   VaultDoc.images / state.imagesMeta
//
// Blob storage:
//   local IndexedDB store.images
//
// Remote encrypted storage:
//   yanta-sync-v1/assets/<remoteAssetId>.blob.enc
//
// Notes reference images as:
//   yanta-img://<assetId>
// ============================================================

import {
  state,
  store,
} from '../core.js';

import {
  vaultImagesMap,
  vaultTombstonesMap,
  safeJsonClone,
} from './vault-doc.js';

import {
  assetBlobPath,
} from './ids.js';

import {
  encryptBytes,
  decryptBytes,
} from './crypto.js';

function cleanUndefined(obj) {
  const out = {};

  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }

  return out;
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

async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function hasLocalAssetBlob(assetId) {
  try {
    const rec = await store.images.get(assetId);
    return !!rec?.blob;
  } catch {
    return false;
  }
}

async function getLocalAssetRecord(assetId) {
  try {
    return await store.images.get(assetId);
  } catch {
    return null;
  }
}

function collectKnownAssetIds() {
  const ids = new Set();

  for (const id of state.imagesMeta.keys()) ids.add(id);
  for (const id of vaultImagesMap().keys()) ids.add(id);

  return ids;
}

/**
 * Upload all local asset blobs that are missing remotely.
 */
export async function uploadMissingAssets(engine) {
  const ids = collectKnownAssetIds();

  let checked = 0;
  let uploaded = 0;
  let skipped = 0;
  let missingLocal = 0;
  let bytesPlain = 0;
  let bytesEncrypted = 0;

  for (const assetId of ids) {
    checked++;

    if (!assetId) {
      skipped++;
      continue;
    }

    if (vaultTombstonesMap().has(assetId)) {
      skipped++;
      continue;
    }

    const path = await assetBlobPath(engine.keys.nameKey, assetId);
    const remoteStat =
      typeof engine.statRemote === 'function'
        ? await engine.statRemote(path)
        : await engine.remote.stat(path);

    if (remoteStat) {
      await engine.markSeen(path, {
        type: 'asset-blob',
        assetId,
        alreadyRemote: true,
        size: remoteStat.size,
        etag: remoteStat.etag,
      });

      skipped++;
      continue;
    }

    const rec = await getLocalAssetRecord(assetId);

    if (!rec?.blob) {
      missingLocal++;
      continue;
    }

    const plain = await blobToBytes(rec.blob);

    const encrypted = await encryptBytes(
      engine.keys.contentKey,
      plain,
      path
    );

    await engine.remote.put(path, encrypted, { ifAbsent: true });
    engine.clearRemoteIndex?.();

    await engine.markSeen(path, {
      type: 'asset-blob',
      assetId,
      own: true,
      plainSize: plain.byteLength,
      encryptedSize: encrypted.byteLength,
    });

    uploaded++;
    bytesPlain += plain.byteLength;
    bytesEncrypted += encrypted.byteLength;
  }

  return {
    checked,
    uploaded,
    skipped,
    missingLocal,
    bytesPlain,
    bytesEncrypted,
  };
}

/**
 * Download assets described by VaultDoc.images when the local blob is missing.
 */
export async function downloadMissingAssets(engine) {
  const ids = collectKnownAssetIds();

  let checked = 0;
  let downloaded = 0;
  let alreadyLocal = 0;
  let missingRemote = 0;
  let skipped = 0;
  let bytesPlain = 0;
  let bytesEncrypted = 0;

  for (const assetId of ids) {
    checked++;

    if (!assetId) {
      skipped++;
      continue;
    }

    if (vaultTombstonesMap().has(assetId)) {
      skipped++;
      continue;
    }

    const localHasBlob = await hasLocalAssetBlob(assetId);

    if (localHasBlob) {
      alreadyLocal++;
      continue;
    }

    const path = await assetBlobPath(engine.keys.nameKey, assetId);
    const stat =
      typeof engine.statRemote === 'function'
        ? await engine.statRemote(path)
        : await engine.remote.stat(path);

    if (!stat) {
      missingRemote++;
      continue;
    }

    const encrypted = await engine.remote.get(path);

    const plain = await decryptBytes(
      engine.keys.contentKey,
      encrypted,
      path
    );

    const meta =
      sanitizeImageMeta(vaultImagesMap().get(assetId)) ||
      sanitizeImageMeta(state.imagesMeta.get(assetId)) ||
      {
        id: assetId,
        name: assetId,
        size: plain.byteLength,
        type: 'application/octet-stream',
        ts: Date.now(),
        updated: Date.now(),
      };

    const blob = new Blob([plain], {
      type: meta.type || 'application/octet-stream',
    });

    const nextMeta = {
      ...safeJsonClone(meta),
      id: assetId,
      size: blob.size,
      type: blob.type || meta.type || 'application/octet-stream',
      ts: meta.ts || Date.now(),
      updated: meta.updated || meta.ts || Date.now(),
    };

    await store.images.put({
      ...nextMeta,
      blob,
    });

    state.imagesMeta.set(assetId, nextMeta);

    // Drop stale object URL if any.
    const oldUrl = state.imageBlobs.get(assetId);

    if (oldUrl) {
      try {
        URL.revokeObjectURL(oldUrl);
      } catch {}
    }

    state.imageBlobs.set(assetId, URL.createObjectURL(blob));

    await engine.markSeen(path, {
      type: 'asset-blob',
      assetId,
      downloaded: true,
      size: stat.size,
      etag: stat.etag,
    });

    downloaded++;
    bytesPlain += plain.byteLength;
    bytesEncrypted += encrypted.byteLength;
  }

  return {
    checked,
    downloaded,
    alreadyLocal,
    missingRemote,
    skipped,
    bytesPlain,
    bytesEncrypted,
  };
}

/**
 * Debug helper: inspect asset state.
 */
export async function assetSyncDebugSnapshot(engine = null) {
  const ids = collectKnownAssetIds();
  const out = [];

  for (const assetId of ids) {
    const meta = sanitizeImageMeta(vaultImagesMap().get(assetId)) ||
      sanitizeImageMeta(state.imagesMeta.get(assetId));

    const localHasBlob = await hasLocalAssetBlob(assetId);

    let remote = null;

    if (engine) {
      const path = await assetBlobPath(engine.keys.nameKey, assetId);
      remote = await engine.remote.stat(path);
    }

    out.push({
      assetId,
      meta,
      tombstoned: vaultTombstonesMap().has(assetId),
      localHasBlob,
      remote,
    });
  }

  return out;
}