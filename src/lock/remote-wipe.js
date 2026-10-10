// ============================================================
// YANTA — remote wipe: delete this device's copy when it was removed
//
// Removing a device elsewhere (YANTA Cloud › devices) ends its session
// and marks it for wiping. The removed device can no longer ask through
// the signed-in API, so each device registers a random secret while it
// still can (only its hash goes to the server). With that secret it asks
// "was I removed?" at start and every half hour, and if so deletes every
// trace of the workspace (wipe-device.js) — even while locked.
//
// YANTA Cloud only: a workspace synced through Google Drive or a folder
// has no device list to remove anything from.
// ============================================================

import { store } from '../core.js';
import { base64UrlEncode, randomBytes } from '../sync2/crypto.js';

const RECORD_KEY = 'wipe.v1';
const CHECK_EVERY_MS = 30 * 60 * 1000;

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cloudContext() {
  const provider = await store.settings.get('sync2.provider', '').catch(() => '');
  const vaultId = await store.settings.get('sync2.yantaCloud.vaultId', '').catch(() => '');
  const deviceId = window.yantaSync2?.deviceId || window.yantaSync2?.engine?.deviceId || '';

  if (provider && provider !== 'yanta-cloud') return null;
  return vaultId && deviceId ? { vaultId, deviceId } : null;
}

/** Registers this device's wipe secret once per vault (needs a signed-in session). */
export async function ensureWipeSecret() {
  const ctx = await cloudContext();
  if (!ctx) return false;

  const stored = await store.settings.get(RECORD_KEY, null).catch(() => null);
  if (stored?.registered && stored.vaultId === ctx.vaultId && stored.deviceId === ctx.deviceId) return true;

  const secret = base64UrlEncode(randomBytes(32));
  const { apiFetch } = await import('../cloud/cloud-api.js');

  try {
    await apiFetch('/api/devices/wipe-secret', {
      method: 'POST',
      body: { vaultId: ctx.vaultId, secretHash: await sha256Hex(secret) },
      headers: { 'x-yanta-device-id': ctx.deviceId, 'x-yanta-vault-id': ctx.vaultId },
    });
  } catch {
    return false;
  }

  await store.settings.set(RECORD_KEY, { ...ctx, secret, registered: true, at: Date.now() });
  return true;
}

/** Asks whether this device was removed; wipes it if so. */
export async function checkRemoteWipe() {
  const stored = await store.settings.get(RECORD_KEY, null).catch(() => null);
  if (!stored?.secret || !navigator.onLine) return false;

  const { apiFetch } = await import('../cloud/cloud-api.js');
  const creds = { vaultId: stored.vaultId, deviceId: stored.deviceId, secret: stored.secret };

  let answer = null;
  try {
    answer = await apiFetch('/api/devices/wipe-check', { method: 'POST', body: creds });
  } catch {
    return false;
  }

  if (!answer?.wipe) return false;

  // Confirm first: once the data is gone, so is the secret to confirm with.
  try {
    await apiFetch('/api/devices/wipe-done', { method: 'POST', body: creds });
  } catch {}

  const { wipeThisDevice } = await import('./wipe-device.js');
  // Removed means this device may not push anything any more: no final sync.
  await wipeThisDevice({ syncFirst: false, leave: false });
  return true;
}

let installed = false;

/** Check at start (also when locked), register once sync runs, re-check every half hour. */
export function setupRemoteWipe() {
  if (installed) return;
  installed = true;

  checkRemoteWipe().catch(() => {});

  const tick = async () => {
    await ensureWipeSecret().catch(() => {});
    await checkRemoteWipe().catch(() => {});
  };

  setTimeout(tick, 20_000);
  setInterval(tick, CHECK_EVERY_MS);
  window.addEventListener('online', () => checkRemoteWipe().catch(() => {}));
}
