// ============================================================
// YANTA — encryption at rest: what this device stores, sealed
//
// With the app lock on, everything personal YANTA writes to this
// browser — note metadata and bodies, folders, images, settings, the
// sync key, space keys, thumbnails, the semantic index — is sealed with
// AES-GCM under a key derived from the Local Data Key (lock-keys.js).
// Without the password (or a passkey, or the recovery key) a copy of the
// browser profile shows ciphertext.
//
// Sealed values carry a marker, so readers accept both shapes: data
// written before the lock was turned on stays readable until the
// migration (at-rest-migrate.js) has sealed it too, and a crash halfway
// through loses nothing.
//
// Worker-safe on purpose (no window, no DOM): the semantic worker
// imports this module and receives the key by postMessage.
// ============================================================

const MARK = '__yse';
const TYPE = '\u0000t';

const te = new TextEncoder();
const td = new TextDecoder();

let atRestKey = null;

/** Derives the at-rest key from the Local Data Key and makes it current. */
export async function setAtRestKeyFromLdk(ldk) {
  const base = await crypto.subtle.importKey('raw', ldk, 'HKDF', false, ['deriveKey']);
  atRestKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode('yanta-at-rest-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return atRestKey;
}

/** For a worker: adopt a key the page derived (CryptoKey is structured-cloneable). */
export function adoptAtRestKey(key) {
  atRestKey = key || null;
}

export function currentAtRestKey() {
  return atRestKey;
}

export function clearAtRestKey() {
  atRestKey = null;
}

/** True while new writes are sealed. */
export function atRestActive() {
  return !!atRestKey;
}

export function isSealed(value) {
  return !!value && typeof value === 'object' && value[MARK] === 1;
}

function lockedError() {
  return Object.assign(new Error('YANTA is locked: sealed data cannot be read yet'), { code: 'ELOCKED' });
}

// ---- Bytes

async function encrypt(plain, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, atRestKey, plain);
  return { iv, ct: new Uint8Array(ct) };
}

async function decrypt(sealed, aad) {
  if (!atRestKey) throw lockedError();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: te.encode(aad) }, atRestKey, sealed.ct);
  return new Uint8Array(plain);
}

/** Seals raw bytes (a Yjs update, a blob's contents). Passes through when inactive. */
export async function sealBytes(bytes, aad = '') {
  if (!atRestKey) return bytes;
  const plain = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { [MARK]: 1, k: 'b', ...(await encrypt(plain, aad)) };
}

/** Opens what sealBytes stored; plain bytes come back unchanged. */
export async function openBytes(stored, aad = '') {
  if (!isSealed(stored)) return stored;
  return decrypt(stored, aad);
}

// ---- Values: a JSON encoding that keeps bytes, dates, maps, sets and blobs

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function unsealable(what) {
  return Object.assign(new Error(`Cannot seal ${what}`), { code: 'EUNSEALABLE' });
}

async function encodeTree(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') throw unsealable(typeof value);
    if (typeof value === 'bigint') return { [TYPE]: 'n', v: String(value) };
    if (value === undefined) return { [TYPE]: 'u' };
    return value;
  }

  if (Array.isArray(value)) return Promise.all(value.map(encodeTree));
  if (value instanceof Date) return { [TYPE]: 'd', v: value.getTime() };
  if (value instanceof ArrayBuffer) return { [TYPE]: 'ab', v: bytesToB64(new Uint8Array(value)) };
  if (value instanceof Uint8Array) return { [TYPE]: 'u8', v: bytesToB64(value) };
  if (value instanceof Float32Array) return { [TYPE]: 'f32', v: bytesToB64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      [TYPE]: 'blob',
      type: value.type || '',
      name: typeof File !== 'undefined' && value instanceof File ? value.name : undefined,
      v: bytesToB64(new Uint8Array(await value.arrayBuffer())),
    };
  }
  if (value instanceof Map) return { [TYPE]: 'map', v: await encodeTree([...value.entries()]) };
  if (value instanceof Set) return { [TYPE]: 'set', v: await encodeTree([...value]) };

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw unsealable(proto?.constructor?.name || 'object');

  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = await encodeTree(v);
  return out;
}

function decodeTree(node) {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(decodeTree);

  const type = node[TYPE];
  if (type) {
    if (type === 'u') return undefined;
    if (type === 'n') return BigInt(node.v);
    if (type === 'd') return new Date(node.v);
    if (type === 'ab') return b64ToBytes(node.v).buffer;
    if (type === 'u8') return b64ToBytes(node.v);
    if (type === 'f32') return new Float32Array(b64ToBytes(node.v).buffer);
    if (type === 'blob') {
      const bytes = b64ToBytes(node.v);
      return node.name !== undefined && typeof File !== 'undefined'
        ? new File([bytes], node.name, { type: node.type })
        : new Blob([bytes], { type: node.type });
    }
    if (type === 'map') return new Map(decodeTree(node.v));
    if (type === 'set') return new Set(decodeTree(node.v));
  }

  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = decodeTree(v);
  return out;
}

/** Seals any storable value. Passes through when inactive. */
export async function sealValue(value, aad = '') {
  if (!atRestKey) return value;
  const json = JSON.stringify(await encodeTree(value));
  return { [MARK]: 1, k: 'v', ...(await encrypt(te.encode(json), aad)) };
}

/** Opens what sealValue stored; anything unsealed comes back unchanged. */
export async function openValue(stored, aad = '') {
  if (!isSealed(stored)) return stored;
  return decodeTree(JSON.parse(td.decode(await decrypt(stored, aad))));
}

// ---- Records: sealed, with the fields IndexedDB needs (keys, indexes) left readable

/**
 * Seals a record but keeps `keep` fields (key path, index fields) in the
 * clear. Throws EUNSEALABLE for values JSON cannot carry (callers decide).
 */
export async function sealRecord(record, keep = [], aad = '') {
  if (!atRestKey || !record || typeof record !== 'object' || isSealed(record)) return record;

  const out = await sealValue(record, aad);
  for (const field of keep) {
    if (record[field] !== undefined) out[field] = record[field];
  }
  return out;
}

/** Opens a record sealed by sealRecord; plain records come back unchanged. */
export async function openRecord(stored, aad = '') {
  if (!isSealed(stored)) return stored;
  return openValue({ [MARK]: 1, k: stored.k, iv: stored.iv, ct: stored.ct }, aad);
}

// ---- Strings (localStorage holds only strings)

const STRING_PREFIX = 'yse1:';

export function isSealedString(text) {
  return typeof text === 'string' && text.startsWith(STRING_PREFIX);
}

/** Seals a string into a string. Passes through when inactive. */
export async function sealString(text, aad = '') {
  if (!atRestKey) return text;
  const { iv, ct } = await encrypt(te.encode(String(text)), aad);
  return `${STRING_PREFIX}${bytesToB64(iv)}.${bytesToB64(ct)}`;
}

/** Opens what sealString made; other strings come back unchanged. */
export async function openString(text, aad = '') {
  if (!isSealedString(text)) return text;
  const [iv, ct] = text.slice(STRING_PREFIX.length).split('.');
  return td.decode(await decrypt({ iv: b64ToBytes(iv), ct: b64ToBytes(ct) }, aad));
}
