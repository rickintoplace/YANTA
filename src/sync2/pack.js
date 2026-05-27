// ============================================================
// YANTA Sync2 — Update pack format
//
// A pack is plaintext before encryption.
// Remote stores only encrypted pack bytes.
//
// This format intentionally does NOT know the provider.
// ============================================================

import { base64UrlEncode, base64UrlDecode, utf8Encode, utf8Decode } from './crypto.js';

export const PACK_FORMAT = 'yanta-sync-pack';
export const PACK_VERSION = 1;

export function createUpdatePack({
  kind,
  deviceId,
  seq,
  docId = null,
  updates = [],
  created = Date.now(),
  meta = {},
}) {
  if (!kind) throw new Error('Pack kind required');
  if (!deviceId) throw new Error('Pack deviceId required');
  if (!Number.isFinite(seq)) throw new Error('Pack seq required');

  const normalizedUpdates = updates.map((u) => {
    if (!(u instanceof Uint8Array)) {
      u = new Uint8Array(u);
    }

    return base64UrlEncode(u);
  });

  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    kind,
    deviceId,
    seq,
    docId,
    created,
    meta,
    updates: normalizedUpdates,
  };
}

export function encodePack(pack) {
  if (!pack || pack.format !== PACK_FORMAT || pack.version !== PACK_VERSION) {
    throw new Error('Invalid YANTA sync pack');
  }

  return utf8Encode(JSON.stringify(pack));
}

export function decodePack(bytes) {
  const pack = JSON.parse(utf8Decode(bytes));

  if (!pack || pack.format !== PACK_FORMAT || pack.version !== PACK_VERSION) {
    throw new Error('Unsupported YANTA sync pack');
  }

  return {
    ...pack,
    updates: (pack.updates || []).map(base64UrlDecode),
  };
}

export function createAndEncodeUpdatePack(opts) {
  return encodePack(createUpdatePack(opts));
}