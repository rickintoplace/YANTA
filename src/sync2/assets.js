// ============================================================
// YANTA Sync2 — Asset sync v2
//
// v2 model:
// - each asset blob encrypted with random assetKey
// - assetKey wrapped with vault contentKey in Vault metadata
// - public shares can wrap same assetKey with shareKey
//
// v1 compatibility exists only for one-time migration:
// - old asset blob path: HMAC(assetId)
// - old blob encrypted with engine.keys.contentKey
// - on upload/download, v1 is migrated to v2 when possible
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
  assetObjectBlobPath,
  createAssetObjectId,
} from './ids.js';

import {
  encryptBytes,
  decryptBytes,
  randomBytes,
  importAesGcmKey,
  utf8Encode,
  utf8Decode,
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

    encryptionVersion: Number(rest.encryptionVersion || 1),
    objectId: rest.objectId ? String(rest.objectId) : undefined,
    objectPath: rest.objectPath ? String(rest.objectPath) : undefined,
    keyVersion: Number(rest.keyVersion || 1),
    keyAlg: rest.keyAlg ? String(rest.keyAlg) : undefined,
    encryptedAssetKeyForVault: rest.encryptedAssetKeyForVault
      ? String(rest.encryptedAssetKeyForVault)
      : undefined,
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

function metaForAsset(assetId) {
  return (
    sanitizeImageMeta(vaultImagesMap().get(assetId)) ||
    sanitizeImageMeta(state.imagesMeta.get(assetId)) ||
    null
  );
}

async function remoteStat(engine, path) {
  return typeof engine.statRemote === 'function'
    ? engine.statRemote(path)
    : engine.remote.stat(path);
}

async function readRemote(engine, path) {
  return engine.remote.get(path);
}

async function writeRemote(engine, path, bytes, options = {}) {
  await engine.remote.put(path, bytes, options);
  engine.clearRemoteIndex?.();
}

function assetKeyAad(assetId, keyVersion = 1) {
  return `asset-key:${assetId}:v${keyVersion}`;
}

export async function unwrapAssetKeyForVault(engine, meta) {
  if (!meta?.encryptedAssetKeyForVault) {
    throw new Error(`Missing wrapped asset key for ${meta?.id || 'asset'}`);
  }

  return decryptBytes(
    engine.keys.contentKey,
    utf8Encode(meta.encryptedAssetKeyForVault),
    assetKeyAad(meta.id, meta.keyVersion || 1)
  );
}

export async function encryptAssetBlobWithRawKey(assetKeyBytes, rawBytes, aad = '') {
  const key = await importAesGcmKey(assetKeyBytes);
  return encryptBytes(key, rawBytes, aad);
}

export async function decryptAssetBlobWithRawKey(assetKeyBytes, encryptedBytes, aad = '') {
  const key = await importAesGcmKey(assetKeyBytes);
  return decryptBytes(key, encryptedBytes, aad);
}

/**
 * Ensure local/remote asset is v2 and return v2 metadata.
 *
 * Migration is idempotent:
 * - existing v2 metadata is reused
 * - assetKey belongs to asset, not share
 */
export async function ensureAssetV2(engine, assetId) {
  if (!assetId) {
    throw new Error('assetId required');
  }

  if (vaultTombstonesMap().has(assetId)) {
    throw new Error(`Asset is deleted: ${assetId}`);
  }

  let meta =
    metaForAsset(assetId) ||
    {
      id: assetId,
      name: assetId,
      size: 0,
      type: 'application/octet-stream',
      ts: Date.now(),
      updated: Date.now(),
    };

  if (
    meta.encryptionVersion === 2 &&
    meta.objectId &&
    meta.objectPath &&
    meta.encryptedAssetKeyForVault
  ) {
    return meta;
  }

  let rec = await getLocalAssetRecord(assetId);
  let plain = null;

  if (rec?.blob) {
    plain = await blobToBytes(rec.blob);
  } else {
    // One-time v1 fallback: download old contentKey-encrypted blob.
    const oldPath = await assetBlobPath(engine.keys.nameKey, assetId);
    const stat = await remoteStat(engine, oldPath);

    if (!stat) {
      const err = new Error(`Asset missing: ${assetId}`);
      err.code = 'EASSET_MISSING';
      throw err;
    }

    const encryptedOld = await readRemote(engine, oldPath);

    plain = await decryptBytes(
      engine.keys.contentKey,
      encryptedOld,
      oldPath
    );

    const blob = new Blob([plain], {
      type: meta.type || 'application/octet-stream',
    });

    rec = {
      ...meta,
      blob,
    };

    await store.images.put(rec);
  }

  const assetKeyBytes = randomBytes(32);
  const objectId = createAssetObjectId();
  const objectPath = assetObjectBlobPath(objectId);
  const keyVersion = 1;

  const encryptedBlob = await encryptAssetBlobWithRawKey(
    assetKeyBytes,
    plain,
    objectPath
  );

  await writeRemote(engine, objectPath, encryptedBlob, {
    ifAbsent: true,
  }).catch(async (err) => {
    if (err?.code !== 'EEXIST') throw err;
  });

  const encryptedAssetKeyForVault = utf8Decode(
    await encryptBytes(
      engine.keys.contentKey,
      assetKeyBytes,
      assetKeyAad(assetId, keyVersion)
    )
  );

  const blob = rec?.blob || new Blob([plain], {
    type: meta.type || 'application/octet-stream',
  });

  const nextMeta = {
    ...safeJsonClone(meta),
    id: assetId,
    name: meta.name || rec?.name || assetId,
    size: blob.size || plain.byteLength,
    type: blob.type || meta.type || 'application/octet-stream',
    ts: meta.ts || Date.now(),
    updated: Date.now(),

    encryptionVersion: 2,
    objectId,
    objectPath,
    keyVersion,
    keyAlg: 'AES-GCM-256',
    encryptedAssetKeyForVault,
  };

  await store.images.put({
    ...nextMeta,
    blob,
  });

  state.imagesMeta.set(assetId, nextMeta);

  await engine.markSeen(objectPath, {
    type: 'asset-blob-v2',
    assetId,
    objectId,
    own: true,
    plainSize: plain.byteLength,
    encryptedSize: encryptedBlob.byteLength,
  });

  return nextMeta;
}

/**
 * Upload all local/migratable assets that are missing remotely.
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

    if (!assetId || vaultTombstonesMap().has(assetId)) {
      skipped++;
      continue;
    }

    let meta;

    try {
      meta = await ensureAssetV2(engine, assetId);
    } catch (err) {
      if (err?.code === 'EASSET_MISSING') {
        missingLocal++;
        continue;
      }

      console.warn('[YANTA Sync2] asset migration/upload failed', assetId, err);
      missingLocal++;
      continue;
    }

    const stat = await remoteStat(engine, meta.objectPath);

    if (stat) {
      await engine.markSeen(meta.objectPath, {
        type: 'asset-blob-v2',
        assetId,
        objectId: meta.objectId,
        alreadyRemote: true,
        size: stat.size,
        etag: stat.etag,
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
    const assetKeyBytes = await unwrapAssetKeyForVault(engine, meta);

    const encrypted = await encryptAssetBlobWithRawKey(
      assetKeyBytes,
      plain,
      meta.objectPath
    );

    await writeRemote(engine, meta.objectPath, encrypted, {
      ifAbsent: true,
    }).catch((err) => {
      if (err?.code !== 'EEXIST') throw err;
    });

    await engine.markSeen(meta.objectPath, {
      type: 'asset-blob-v2',
      assetId,
      objectId: meta.objectId,
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
 * Download v2 assets described by VaultDoc.images when local blob is missing.
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

    if (!assetId || vaultTombstonesMap().has(assetId)) {
      skipped++;
      continue;
    }

    if (await hasLocalAssetBlob(assetId)) {
      alreadyLocal++;
      continue;
    }

    const meta = metaForAsset(assetId);

    if (
      !meta ||
      meta.encryptionVersion !== 2 ||
      !meta.objectPath ||
      !meta.encryptedAssetKeyForVault
    ) {
      // Opportunistic migration from old remote blob if possible.
      try {
        await ensureAssetV2(engine, assetId);
        alreadyLocal++;
      } catch {
        missingRemote++;
      }

      continue;
    }

    const stat = await remoteStat(engine, meta.objectPath);

    if (!stat) {
      missingRemote++;
      continue;
    }

    const encrypted = await readRemote(engine, meta.objectPath);
    const assetKeyBytes = await unwrapAssetKeyForVault(engine, meta);

    const plain = await decryptAssetBlobWithRawKey(
      assetKeyBytes,
      encrypted,
      meta.objectPath
    );

    const blob = new Blob([plain], {
      type: meta.type || 'application/octet-stream',
    });

    const nextMeta = {
      ...safeJsonClone(meta),
      id: assetId,
      size: blob.size,
      type: blob.type || meta.type || 'application/octet-stream',
      updated: meta.updated || meta.ts || Date.now(),
    };

    await store.images.put({
      ...nextMeta,
      blob,
    });

    state.imagesMeta.set(assetId, nextMeta);

    const oldUrl = state.imageBlobs.get(assetId);

    if (oldUrl) {
      try {
        URL.revokeObjectURL(oldUrl);
      } catch {}
    }

    state.imageBlobs.set(assetId, URL.createObjectURL(blob));

    await engine.markSeen(meta.objectPath, {
      type: 'asset-blob-v2',
      assetId,
      objectId: meta.objectId,
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

export async function assetSyncDebugSnapshot(engine = null) {
  const ids = collectKnownAssetIds();
  const out = [];

  for (const assetId of ids) {
    const meta = metaForAsset(assetId);
    const localHasBlob = await hasLocalAssetBlob(assetId);

    let remote = null;

    if (engine && meta?.objectPath) {
      remote = await remoteStat(engine, meta.objectPath);
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