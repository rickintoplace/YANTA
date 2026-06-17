import {
  base64UrlEncode,
  base64UrlDecode,
  randomBytes,
  importAesGcmKey,
  encryptBytes,
  decryptBytes,
  utf8Encode,
  utf8Decode,
} from '../sync2/crypto.js';

export function generateShareKeyString() {
  return base64UrlEncode(randomBytes(32));
}

export async function shareKeyFromString(shareKeyString) {
  const raw = base64UrlDecode(shareKeyString);
  return importAesGcmKey(raw);
}

export function shareKeyBytesFromString(shareKeyString) {
  const raw = base64UrlDecode(shareKeyString);
  if (raw.byteLength !== 32) {
    throw new Error('Share key must decode to 32 bytes');
  }
  return raw;
}

export async function encryptSharePayload(shareKeyString, payload) {
  const key = await shareKeyFromString(shareKeyString);

  return utf8Decode(
    await encryptBytes(
      key,
      utf8Encode(JSON.stringify(payload)),
      'yanta-public-share-payload-v1'
    )
  );
}

export async function decryptSharePayload(shareKeyString, encryptedPayloadString) {
  const key = await shareKeyFromString(shareKeyString);

  const plain = await decryptBytes(
    key,
    utf8Encode(encryptedPayloadString),
    'yanta-public-share-payload-v1'
  );

  return JSON.parse(utf8Decode(plain));
}

export async function wrapAssetKeyForShare(shareKeyString, assetId, assetKeyBytes) {
  const key = await shareKeyFromString(shareKeyString);

  return utf8Decode(
    await encryptBytes(
      key,
      assetKeyBytes,
      `asset-key-for-share:${assetId}`
    )
  );
}

export async function unwrapAssetKeyForShare(shareKeyString, assetId, encryptedAssetKeyForShare) {
  const key = await shareKeyFromString(shareKeyString);

  return decryptBytes(
    key,
    utf8Encode(encryptedAssetKeyForShare),
    `asset-key-for-share:${assetId}`
  );
}

export function parseShareKeyFromLocationHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const params = new URLSearchParams(raw);
  const key = params.get('k') || '';

  if (!key) {
    throw new Error('Missing share key. The full link must include #k=...');
  }

  return key;
}

export function makePublicShareUrl(shareId, shareKeyString) {
  return `${location.origin}/share/${encodeURIComponent(shareId)}#k=${encodeURIComponent(shareKeyString)}`;
}