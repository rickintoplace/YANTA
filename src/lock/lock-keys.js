// ============================================================
// YANTA — app lock: the key hierarchy
//
// The lock is built the way an encrypted store needs it, so the later
// step — encrypting what this device keeps — sits on the same keys:
//
//   Local Data Key (LDK), 32 random bytes, never stored in the clear.
//   It is wrapped (AES-GCM) by:
//     - the password:   PBKDF2-SHA256, 600 000 rounds, random salt
//     - the recovery key (the Sync Key from the Recovery Kit): HKDF
//     - optionally passkeys: HKDF of the passkey's PRF output
//
// Unlocking means unwrapping the LDK. A wrong password fails the GCM
// tag, so there is no separate hash to attack. Forgetting the password
// costs nothing as long as the Recovery Kit exists: the recovery key
// unwraps the LDK and a new password re-wraps it.
//
// The LDK also seals what this device stores (at-rest.js).
//
// Device-local on purpose (store.settings, not the vault): a lock is
// "this device asks before showing anything", and a work laptop may
// want one while the phone does not.
// ============================================================

import { store } from '../core.js';
import { clearAtRestKey, setAtRestKeyFromLdk } from './at-rest.js';

import {
  base64UrlDecode,
  base64UrlEncode,
  randomBytes,
  syncKeyToBytes,
  utf8Encode,
} from '../sync2/crypto.js';

const CONFIG_KEY = 'lock.v1';
const PBKDF2_ROUNDS = 600_000;

export const DEFAULT_LOCK_CONFIG = {
  enabled: false,
  // Minutes without input before locking; 0 = never.
  idleMinutes: 10,
  // Minutes in the background (other tab/app) before locking; -1 = never.
  hiddenMinutes: 5,
};

export async function getLockConfig() {
  const raw = await store.settings.get(CONFIG_KEY, null).catch(() => null);
  return { ...DEFAULT_LOCK_CONFIG, ...(raw || {}) };
}

async function saveLockConfig(config) {
  await store.settings.set(CONFIG_KEY, config);
  window.dispatchEvent(new CustomEvent('yanta-lock-config-changed', { detail: { enabled: !!config.enabled } }));
  return config;
}

export async function setLockTimers({ idleMinutes, hiddenMinutes }) {
  const config = await getLockConfig();
  return saveLockConfig({
    ...config,
    ...(idleMinutes !== undefined ? { idleMinutes: Number(idleMinutes) } : {}),
    ...(hiddenMinutes !== undefined ? { hiddenMinutes: Number(hiddenMinutes) } : {}),
  });
}

async function passwordKek(password, salt) {
  const base = await crypto.subtle.importKey('raw', utf8Encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function recoveryKek(syncKey, salt) {
  const base = await crypto.subtle.importKey('raw', syncKeyToBytes(syncKey), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8Encode('yanta-lock-recovery-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function wrap(kek, ldk, label) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8Encode(label) }, kek, ldk);
  return { iv: base64UrlEncode(iv), ct: base64UrlEncode(new Uint8Array(ct)) };
}

async function unwrap(kek, wrapped, label) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(wrapped.iv), additionalData: utf8Encode(label) },
    kek,
    base64UrlDecode(wrapped.ct)
  );
  return new Uint8Array(plain);
}

// The unwrapped key, once unlocked. Never written anywhere (unless the
// lock is turned off, see disableLock). It stays in memory while the tab
// is open, also while the lock screen shows: sync, Pulse and reminders
// keep reading and writing the sealed data in the background.
let unlockedLdk = null;

async function adoptLdk(ldk) {
  const first = !unlockedLdk;
  unlockedLdk = ldk;
  await setAtRestKeyFromLdk(ldk);
  if (first) window.dispatchEvent(new CustomEvent('yanta-at-rest-key'));
}

export function isUnlocked() {
  return !!unlockedLdk;
}

/** The Local Data Key while unlocked, else null (for the encrypted store). */
export function localDataKey() {
  return unlockedLdk;
}

/** Takes the key from another open tab (app-lock.js). */
export async function adoptUnlockedKey(ldk) {
  if (!(ldk instanceof Uint8Array) || ldk.length !== 32) return false;
  await adoptLdk(ldk);
  return true;
}

/** A copy of the key, for another open tab; null while none is known. */
export function exportUnlockedKey() {
  return unlockedLdk ? new Uint8Array(unlockedLdk) : null;
}

/** Drops the key from memory (wipe, guest end): sealed data is unreadable afterwards. */
export function forgetUnlockedKey() {
  if (unlockedLdk) unlockedLdk.fill(0);
  unlockedLdk = null;
  clearAtRestKey();
}

/**
 * With the lock off but data sealed earlier, the key is kept in the clear
 * (see disableLock): load it at start so the workspace reads as before.
 */
export async function loadStoredAtRestKey() {
  const config = await getLockConfig();
  if (config.enabled || !config.atRest?.rawKey) return false;
  await adoptLdk(base64UrlDecode(config.atRest.rawKey));
  return true;
}

// ---- Guest mode: a foreign device keeps nothing past the browser session
//
// The key lives only in this tab's sessionStorage (and other open tabs'
// memory). The browser closed, the key is gone: the next start finds
// sealed data it cannot read and removes all of it (app-lock.js).

const GUEST_SESSION_KEY = 'yanta.guest.key';

export async function startGuestMode() {
  const config = await getLockConfig();
  if (config.enabled) throw new Error('lock-on');

  // Lock off with data sealed earlier: keep that key, but no longer stored.
  const ldk = unlockedLdk ? new Uint8Array(unlockedLdk) : randomBytes(32);
  await adoptLdk(ldk);
  rememberGuestKey();

  const { rawKey, ...atRest } = config.atRest || {};
  return saveLockConfig({
    ...config,
    guest: { since: Date.now() },
    atRest: { ...atRest, on: true, since: atRest.since || Date.now() },
  });
}

/** Keeps the key for reloads of this tab (sessionStorage dies with the browser session). */
export function rememberGuestKey() {
  if (!unlockedLdk) return;
  try { sessionStorage.setItem(GUEST_SESSION_KEY, base64UrlEncode(unlockedLdk)); } catch {}
}

export async function loadGuestKey() {
  let stored = null;
  try { stored = sessionStorage.getItem(GUEST_SESSION_KEY); } catch {}
  if (!stored) return false;
  await adoptLdk(base64UrlDecode(stored));
  return true;
}

function forgetGuestKey() {
  try { sessionStorage.removeItem(GUEST_SESSION_KEY); } catch {}
}

/** Whether data written before the lock was turned on still waits to be sealed. */
export function atRestMigrationPending(config) {
  // A lock turned on before sealing existed counts as on.
  return !!(config?.enabled || config?.atRest?.on) && !config.atRest?.migratedAt;
}

export async function markAtRestMigrated() {
  const config = await getLockConfig();
  return saveLockConfig({ ...config, atRest: { since: Date.now(), ...config.atRest, on: true, migratedAt: Date.now() } });
}

/**
 * Turns the lock on (or changes the password): a new LDK when none
 * exists, wrapped by the password and the recovery key.
 */
export async function setLockPassword(password, { syncKey } = {}) {
  if (String(password || '').length < 6) throw Object.assign(new Error('weak'), { code: 'EWEAK' });

  const config = await getLockConfig();
  const ldk = unlockedLdk ? new Uint8Array(unlockedLdk) : randomBytes(32);

  const passwordSalt = randomBytes(16);
  const recoverySalt = randomBytes(16);

  const { rawKey, ...atRest } = config.atRest || {};

  // A password makes this the user's own device: guest mode ends, the data stays.
  const { guest, ...rest } = config;

  const next = {
    ...rest,
    enabled: true,
    v: 1,
    // The lock seals what this device stores (at-rest.js); a key kept in
    // the clear while the lock was off is dropped now.
    atRest: { ...atRest, on: true, since: atRest.since || Date.now() },
    password: {
      salt: base64UrlEncode(passwordSalt),
      rounds: PBKDF2_ROUNDS,
      ...(await wrap(await passwordKek(password, passwordSalt), ldk, 'password')),
    },
    recovery: syncKey
      ? { salt: base64UrlEncode(recoverySalt), ...(await wrap(await recoveryKek(syncKey, recoverySalt), ldk, 'recovery')) }
      : config.recovery || null,
    updatedAt: Date.now(),
  };

  await adoptLdk(ldk);
  await saveLockConfig(next);
  forgetGuestKey();
  return next;
}

/** Unlocks with the password. Resolves true/false. */
export async function unlockWithPassword(password) {
  const config = await getLockConfig();
  if (!config.enabled || !config.password) return true;

  try {
    const kek = await passwordKek(password, base64UrlDecode(config.password.salt));
    await adoptLdk(await unwrap(kek, config.password, 'password'));
    return true;
  } catch {
    return false;
  }
}

/** Unlocks with the recovery key (Recovery Kit). Resolves true/false. */
export async function unlockWithRecoveryKey(syncKey) {
  const config = await getLockConfig();
  if (!config.recovery) return false;

  try {
    const kek = await recoveryKek(syncKey, base64UrlDecode(config.recovery.salt));
    await adoptLdk(await unwrap(kek, config.recovery, 'recovery'));
    return true;
  } catch {
    return false;
  }
}

// ---- Passkeys: a third wrapper of the same LDK
//
// The authenticator's PRF output (WebAuthn "prf" extension) is a secret
// only that passkey can produce for this salt; HKDF turns it into the key
// that wraps the LDK. No server checks the assertion — nothing to check:
// whoever cannot produce the PRF output cannot unwrap.

async function passkeyKek(prfOutput) {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8Encode('yanta-lock-passkey-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Adds a passkey wrapper. Requires the device to be unlocked. */
export async function addPasskeyWrap({ credentialId, prfSalt, prfOutput, attachment = '' }) {
  if (!unlockedLdk) throw new Error('locked');
  const config = await getLockConfig();

  const entry = {
    id: credentialId,
    prfSalt: base64UrlEncode(prfSalt),
    attachment,
    createdAt: Date.now(),
    ...(await wrap(await passkeyKek(prfOutput), unlockedLdk, 'passkey')),
  };

  const passkeys = (config.passkeys || []).filter((p) => p.id !== credentialId);
  return saveLockConfig({ ...config, passkeys: [...passkeys, entry] });
}

export async function removePasskeyWrap(credentialId) {
  const config = await getLockConfig();
  return saveLockConfig({ ...config, passkeys: (config.passkeys || []).filter((p) => p.id !== credentialId) });
}

/** Unlocks with a passkey's PRF output. Resolves true/false. */
export async function unlockWithPasskeyOutput(credentialId, prfOutput) {
  const config = await getLockConfig();
  const entry = (config.passkeys || []).find((p) => p.id === credentialId);
  if (!entry) return false;

  try {
    await adoptLdk(await unwrap(await passkeyKek(prfOutput), entry, 'passkey'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Turns the lock off. Requires the device to be unlocked.
 *
 * What is sealed stays sealed, but the key is now kept in the clear next
 * to it — no protection any more, as the settings say — so nothing has to
 * be rewritten, and turning the lock on again only wraps the same key.
 */
export async function disableLock() {
  if (!unlockedLdk) throw new Error('locked');
  const config = await getLockConfig();
  const atRest = config.atRest?.on ? { ...config.atRest, rawKey: base64UrlEncode(unlockedLdk) } : null;

  return saveLockConfig({
    ...DEFAULT_LOCK_CONFIG,
    idleMinutes: config.idleMinutes,
    hiddenMinutes: config.hiddenMinutes,
    enabled: false,
    ...(atRest ? { atRest } : {}),
  });
}
