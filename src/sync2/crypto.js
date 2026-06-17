// ============================================================
// YANTA Sync2 — Crypto layer
//
// Goals:
// - Client-side encryption before upload.
// - Remote provider/broker sees only encrypted blobs.
// - Remote object IDs do not contain titles/names.
// - Browser-native WebCrypto only.
// ============================================================

const te = new TextEncoder();
const td = new TextDecoder();

export function utf8Encode(s) {
  return te.encode(String(s ?? ''));
}

export function utf8Decode(bytes) {
  return td.decode(bytes);
}

export function randomBytes(n = 32) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function base64UrlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';

  // Avoid call-stack issues for large arrays.
  const chunk = 0x8000;

  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  }

  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function base64UrlDecode(s) {
  let b64 = String(s || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  while (b64.length % 4) b64 += '=';

  const bin = atob(b64);
  const out = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }

  return out;
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  );

  return new Uint8Array(digest);
}

/**
 * Generate a random 256-bit sync key encoded as base64url.
 *
 * This is the root secret for a YANTA vault. In production this should be:
 * - stored locally
 * - optionally transferred via Add Device
 * - optionally shown as a recovery key
 */
export function generateSyncKey() {
  return base64UrlEncode(randomBytes(32));
}

export function syncKeyToBytes(syncKey) {
  if (syncKey instanceof Uint8Array) {
    if (syncKey.byteLength !== 32) {
      throw new Error('Sync key Uint8Array must be 32 bytes');
    }

    return syncKey;
  }

  const bytes = base64UrlDecode(syncKey);

  if (bytes.byteLength !== 32) {
    throw new Error('Sync key must decode to 32 bytes');
  }

  return bytes;
}

/**
 * Derive keys from the raw sync key.
 *
 * - contentKey: AES-GCM key for object encryption
 * - nameKey:    HMAC key for remote object names/IDs
 */
export async function deriveKeys(syncKey) {
  const raw = syncKeyToBytes(syncKey);

  const ikm = await crypto.subtle.importKey(
    'raw',
    raw,
    'HKDF',
    false,
    ['deriveKey']
  );

  const salt = utf8Encode('yanta-sync-v1');

  const contentKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: utf8Encode('content-encryption'),
    },
    ikm,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );

  const nameKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: utf8Encode('remote-name-hmac'),
    },
    ikm,
    {
      name: 'HMAC',
      hash: 'SHA-256',
      length: 256,
    },
    false,
    ['sign']
  );

  return {
    contentKey,
    nameKey,
  };
}

export async function hmacBytes(nameKey, text) {
  const sig = await crypto.subtle.sign(
    'HMAC',
    nameKey,
    utf8Encode(text)
  );

  return new Uint8Array(sig);
}

/**
 * Create an opaque provider-safe ID.
 *
 * Default length 32 base64url chars gives enough uniqueness while keeping
 * paths short. The full HMAC is still available by increasing length.
 */
export async function hmacId(nameKey, text, length = 32) {
  const sig = await hmacBytes(nameKey, text);
  return base64UrlEncode(sig).slice(0, length);
}

/**
 * Encrypt bytes into a small JSON envelope.
 *
 * aad should usually be the remote path. This binds ciphertext to its path:
 * moving encrypted data to a different path fails to decrypt.
 */
export async function encryptBytes(contentKey, plaintext, aad = '') {
  const plain = plaintext instanceof Uint8Array
    ? plaintext
    : new Uint8Array(plaintext);

  const iv = randomBytes(12);

  const ct = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: utf8Encode(aad),
    },
    contentKey,
    plain
  );

  const envelope = {
    v: 1,
    alg: 'AES-GCM',
    iv: base64UrlEncode(iv),
    ct: base64UrlEncode(new Uint8Array(ct)),
  };

  return utf8Encode(JSON.stringify(envelope));
}

export async function decryptBytes(contentKey, envelopeBytes, aad = '') {
  const envelopeText = utf8Decode(envelopeBytes);
  const envelope = JSON.parse(envelopeText);

  if (!envelope || envelope.v !== 1 || envelope.alg !== 'AES-GCM') {
    throw new Error('Unsupported encrypted object envelope');
  }

  const iv = base64UrlDecode(envelope.iv);
  const ct = base64UrlDecode(envelope.ct);

  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: utf8Encode(aad),
    },
    contentKey,
    ct
  );

  return new Uint8Array(plain);
}

export async function encryptJson(contentKey, obj, aad = '') {
  return encryptBytes(
    contentKey,
    utf8Encode(JSON.stringify(obj)),
    aad
  );
}

export async function decryptJson(contentKey, envelopeBytes, aad = '') {
  const plain = await decryptBytes(contentKey, envelopeBytes, aad);
  return JSON.parse(utf8Decode(plain));
}

// ============================================================
// Generic raw AES-GCM helpers for Asset Keys / Share Keys
// ============================================================

export async function importAesGcmKey(rawKeyBytes, usages = ['encrypt', 'decrypt']) {
  const raw =
    rawKeyBytes instanceof Uint8Array
      ? rawKeyBytes
      : new Uint8Array(rawKeyBytes);

  if (raw.byteLength !== 32) {
    throw new Error('AES-256 key must be 32 bytes');
  }

  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    usages
  );
}

export async function exportRawKeyBytes(cryptoKey) {
  const raw = await crypto.subtle.exportKey('raw', cryptoKey);
  return new Uint8Array(raw);
}

export function encryptedEnvelopeToString(envelopeBytes) {
  return utf8Decode(envelopeBytes);
}

export function encryptedEnvelopeFromString(envelopeString) {
  return utf8Encode(String(envelopeString || ''));
}