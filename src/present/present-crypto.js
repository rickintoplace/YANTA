// ============================================================
// YANTA Present — crypto
//
// Everything a presentation sends through the relay is sealed with
// AES-GCM. Two kinds of keys:
//
// - A session key (32 random bytes) shared by every device of one
//   presentation. It never travels in the clear: devices get it inside a
//   "welcome", sealed with a key only that device and the presenter know.
// - Pairing keys. A QR code carries a random ticket key. A short code a
//   person types is too weak to be a key by itself, so the two devices run
//   an ECDH exchange over it and the presenter approves the device before it
//   learns anything.
//
// The relay sees topics and ciphertext only.
// ============================================================

import { base64UrlDecode, base64UrlEncode, randomBytes, sha256, utf8Decode, utf8Encode } from '../sync2/crypto.js';

const te = new TextEncoder();

// Readable on a TV across the room: no 0/O, 1/I/L or U/V to mix up.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
export const CODE_LENGTH = 6;

export function randomKeyString() {
  return base64UrlEncode(randomBytes(32));
}

export function randomId(bytes = 9) {
  return base64UrlEncode(randomBytes(bytes));
}

export function randomCode() {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = '';

  while (out.length < CODE_LENGTH) {
    for (const v of randomBytes(16)) {
      if (v >= limit) continue;

      out += CODE_ALPHABET[v % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }

  return out;
}

/** What a person typed → the canonical code, or '' when it cannot be one. */
export function normalizeCode(input) {
  const clean = String(input || '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');

  if (clean.length !== CODE_LENGTH) return '';

  return [...clean].every((c) => CODE_ALPHABET.includes(c)) ? clean : '';
}

export function formatCode(code) {
  const c = String(code || '');
  return c.length === CODE_LENGTH ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

/** A relay topic that reveals nothing about the secret it is derived from. */
export async function topicFor(kind, secret) {
  const digest = await sha256(utf8Encode(`yanta-present:${kind}:${secret}`));
  return `yp-${kind}-${base64UrlEncode(digest.subarray(0, 18))}`;
}

export async function importKeyString(keyString) {
  const raw = base64UrlDecode(keyString);

  if (raw.byteLength !== 32) throw new Error('Presentation key must be 32 bytes');

  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** A key both sides of a short code can derive. Weak on its own — see ECDH below. */
export async function keyFromCode(code) {
  const base = await crypto.subtle.importKey('raw', te.encode(normalizeCode(code)), 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('yanta-present-code-v1'), info: te.encode('rendezvous') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') return null;

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const COMPRESS_FROM = 2048;

/**
 * Seals a JSON value. Large values (a deck) are gzipped first; the first
 * plaintext byte says which (0 = raw, 1 = gzip).
 */
export async function sealJson(key, value, aad = 'yanta-present-v1') {
  const json = utf8Encode(JSON.stringify(value));
  let body = json;
  let flag = 0;

  if (json.length >= COMPRESS_FROM) {
    const packed = await gzip(json).catch(() => null);

    if (packed && packed.length < json.length) {
      body = packed;
      flag = 1;
    }
  }

  const plain = new Uint8Array(body.length + 1);
  plain[0] = flag;
  plain.set(body, 1);

  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(aad) },
    key,
    plain
  ));

  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);

  return base64UrlEncode(out);
}

export async function openJson(key, sealed, aad = 'yanta-present-v1') {
  const bytes = base64UrlDecode(sealed);
  if (bytes.length < 13) throw new Error('Sealed message too short');

  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: te.encode(aad) },
    key,
    bytes.subarray(12)
  ));

  const body = plain[0] === 1 ? await gunzip(plain.subarray(1)) : plain.subarray(1);
  return JSON.parse(utf8Decode(body));
}

// ---- ECDH pairing

export async function createEcdhPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

  return { privateKey: pair.privateKey, publicKey: base64UrlEncode(pub) };
}

/**
 * The key two paired devices share, as a key string: it is stored with the
 * session (sessionStorage) so a reloaded page can still reach the device.
 */
export async function deriveSharedKeyString(privateKey, peerPublicKey) {
  const peer = await crypto.subtle.importKey(
    'raw',
    base64UrlDecode(peerPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256));
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
  const key = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('yanta-present-pair-v1'), info: te.encode('pair') },
    base,
    256
  );

  return base64UrlEncode(new Uint8Array(key));
}

/**
 * Four digits both screens show while a code pairing waits for approval: if
 * they match, nobody sits in between. Derived from both public keys.
 */
export async function pairingCheck(publicA, publicB) {
  const [a, b] = [publicA, publicB].sort();
  const digest = await sha256(utf8Encode(`${a}.${b}`));
  return String(((digest[0] << 8) | digest[1]) % 10000).padStart(4, '0');
}
