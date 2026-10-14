// ============================================================
// YANTA — unlock with fingerprint or face (Android app)
//
// The app's Keystore holds an AES key that only works right after a
// strong biometric check and never leaves the phone's secure hardware
// (android/…/NativeBiometric.kt). It wraps the Local Data Key; the
// wrapped bytes live in lock.v1.biometric. No passkey, no account, no
// sync: it opens only on this phone. Password and recovery key keep
// working; a newly enrolled fingerprint invalidates the key, and the
// password is asked once to set it up again.
// ============================================================

import { t } from '../i18n/index.js';
import { adoptUnlockedKey, exportUnlockedKey, getLockConfig, setBiometricWrap } from './lock-keys.js';

function bridge() {
  const native = window.YantaAndroid;
  return native && typeof native.getBiometricStatus === 'function' ? native : null;
}

const pending = new Map();
let counter = 0;

function installResultHook() {
  if (window.__yantaNativeResultInstalled) return;
  window.__yantaNativeResultInstalled = true;
  const previous = window.__yantaNativeResult;
  window.__yantaNativeResult = (id, json) => {
    const resolve = pending.get(id);
    if (!resolve) return previous?.(id, json);
    pending.delete(id);
    let result = null;
    try { result = JSON.parse(json); } catch { result = { error: 'parse' }; }
    resolve(result);
  };
}

function callNative(method, ...args) {
  installResultHook();
  const id = `bio${Date.now()}${counter++}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    bridge()[method](id, ...args);
  });
}

function toBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text) {
  const bin = atob(String(text || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** { native, available } — native: inside the Android app at all. */
export function biometricStatus() {
  const native = bridge();
  if (!native) return { native: false, available: false };
  try {
    return { native: true, ...JSON.parse(native.getBiometricStatus()) };
  } catch {
    return { native: true, available: false };
  }
}

export async function biometricUnlockConfigured() {
  const config = await getLockConfig();
  return !!(config.biometric?.ct && bridge());
}

/** Wraps the (unlocked) key with the biometric Keystore key. Resolves 'ok' | 'cancelled' | 'failed'. */
export async function enableBiometricUnlock() {
  const ldk = exportUnlockedKey();
  if (!ldk || !bridge()) return 'failed';

  const result = await callNative(
    'biometricEnroll',
    toBase64(ldk),
    t('lock.biometric.enrollTitle'),
    t('lock.biometric.promptSubtitle'),
    t('common.cancel')
  );

  if (result?.iv && result?.ct) {
    await setBiometricWrap({ iv: result.iv, ct: result.ct });
    return 'ok';
  }
  return result?.error === 'cancelled' ? 'cancelled' : 'failed';
}

/** Resolves 'ok' | 'cancelled' | 'invalidated' | 'failed'. */
export async function unlockWithBiometric() {
  const config = await getLockConfig();
  if (!config.biometric?.ct || !bridge()) return 'failed';

  const result = await callNative(
    'biometricUnlock',
    config.biometric.iv,
    config.biometric.ct,
    t('lock.biometric.promptTitle'),
    t('lock.biometric.promptSubtitle'),
    t('common.cancel')
  );

  if (result?.secret) {
    const ldk = fromBase64(result.secret);
    return (await adoptUnlockedKey(ldk)) ? 'ok' : 'failed';
  }

  if (result?.error === 'invalidated' || result?.error === 'nokey') {
    await setBiometricWrap(null);
    return 'invalidated';
  }

  return result?.error === 'cancelled' ? 'cancelled' : 'failed';
}

export async function disableBiometricUnlock() {
  try { bridge()?.biometricRemove(); } catch {}
  await setBiometricWrap(null);
}
