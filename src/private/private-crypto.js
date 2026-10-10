// ============================================================
// YANTA — private folders: keys
//
// Each private folder has its own Folder Key (32 random bytes). It is
// never stored or synced in the clear — only wrapped (AES-GCM) by:
//   - the folder password: PBKDF2-SHA256, 600 000 rounds, random salt
//   - the folder's recovery code: 20 random bytes shown once, printed or
//     saved by the user, stored nowhere by YANTA (HKDF)
//
// Deliberately NOT by the workspace keys (sync key, app lock): whoever
// can use the unlocked app — or read the Recovery Kit in Settings —
// must still not get into a private folder.
//
// The folder's content travels as entries sealed with the Folder Key
// (sealEntry/openEntry), bound to the folder id.
// ============================================================

import { base64UrlDecode, base64UrlEncode, randomBytes, utf8Decode, utf8Encode } from '../sync2/crypto.js';

const PBKDF2_ROUNDS = 600_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ---- Recovery code: 20 bytes as 32 Crockford base32 characters, groups of 4

export function generateRecoveryCode() {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }

  return out.match(/.{4}/g).join('-');
}

/** Bytes of a typed recovery code (case, spaces, dashes and O/I/L mix-ups forgiven); null if malformed. */
export function recoveryCodeBytes(text) {
  const clean = String(text || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

  if (clean.length !== 32) return null;

  const out = new Uint8Array(20);
  let bits = 0;
  let value = 0;
  let i = 0;

  for (const char of clean) {
    const v = CROCKFORD.indexOf(char);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }

  return out;
}

// ---- Key wrapping

async function passwordKek(password, salt, rounds = PBKDF2_ROUNDS) {
  const base = await crypto.subtle.importKey('raw', utf8Encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function recoveryKek(codeBytes, salt) {
  const base = await crypto.subtle.importKey('raw', codeBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8Encode('yanta-private-recovery-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function wrapWith(kek, folderKey, label) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8Encode(label) }, kek, folderKey);
  return { iv: base64UrlEncode(iv), ct: base64UrlEncode(new Uint8Array(ct)) };
}

async function unwrapWith(kek, wrapped, label) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(wrapped.iv), additionalData: utf8Encode(label) },
    kek,
    base64UrlDecode(wrapped.ct)
  );
  return new Uint8Array(plain);
}

export function generateFolderKey() {
  return randomBytes(32);
}

/** The password wrapper of a folder key (stored in the folder's header). */
export async function wrapWithPassword(folderKey, password, folderId) {
  const salt = randomBytes(16);
  return {
    salt: base64UrlEncode(salt),
    rounds: PBKDF2_ROUNDS,
    ...(await wrapWith(await passwordKek(password, salt), folderKey, `password:${folderId}`)),
  };
}

/** The recovery-code wrapper of a folder key. */
export async function wrapWithRecoveryCode(folderKey, code, folderId) {
  const bytes = recoveryCodeBytes(code);
  if (!bytes) throw new Error('Malformed recovery code');
  const salt = randomBytes(16);
  return {
    salt: base64UrlEncode(salt),
    ...(await wrapWith(await recoveryKek(bytes, salt), folderKey, `recovery:${folderId}`)),
  };
}

/** Folder key from the password, or null when it does not fit. */
export async function unwrapWithPassword(wrapped, password, folderId) {
  if (!wrapped?.salt) return null;
  try {
    const kek = await passwordKek(password, base64UrlDecode(wrapped.salt), wrapped.rounds || PBKDF2_ROUNDS);
    return await unwrapWith(kek, wrapped, `password:${folderId}`);
  } catch {
    return null;
  }
}

/** Folder key from the recovery code, or null when it does not fit. */
export async function unwrapWithRecoveryCode(wrapped, code, folderId) {
  const bytes = recoveryCodeBytes(code);
  if (!bytes || !wrapped?.salt) return null;
  try {
    return await unwrapWith(await recoveryKek(bytes, base64UrlDecode(wrapped.salt)), wrapped, `recovery:${folderId}`);
  } catch {
    return null;
  }
}

// ---- Content entries: { docName, update } sealed under the folder key

async function contentKey(folderKey) {
  return crypto.subtle.importKey('raw', folderKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const keyCache = new WeakMap();

async function cachedContentKey(folderKey) {
  if (!keyCache.has(folderKey)) keyCache.set(folderKey, contentKey(folderKey));
  return keyCache.get(folderKey);
}

/**
 * Seals one entry. The doc name travels inside the ciphertext, so the
 * synced log shows neither which note changed nor how many there are.
 */
export async function sealEntry(folderKey, folderId, docName, update) {
  const name = utf8Encode(docName);
  const plain = new Uint8Array(2 + name.length + update.length);
  plain[0] = name.length >> 8;
  plain[1] = name.length & 255;
  plain.set(name, 2);
  plain.set(update, 2 + name.length);

  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8Encode(`private:${folderId}`) },
    await cachedContentKey(folderKey),
    plain
  ));

  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

/** Opens an entry; null when it does not belong to this folder key. */
export async function openEntry(folderKey, folderId, bytes) {
  try {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: utf8Encode(`private:${folderId}`) },
      await cachedContentKey(folderKey),
      data.subarray(12)
    ));
    const length = (plain[0] << 8) | plain[1];
    return {
      docName: utf8Decode(plain.subarray(2, 2 + length)),
      update: plain.subarray(2 + length),
    };
  } catch {
    return null;
  }
}
