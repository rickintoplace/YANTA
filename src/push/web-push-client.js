// ============================================================
// YANTA — Web Push client
//
// Subscribes this browser/PWA to Web Push and registers the subscription
// with the Cloud Worker so chat messages and calendar reminders can be
// delivered even when the app is closed.
//
// Requires a YANTA Cloud login (the Worker is cookie-session authed).
// Calendar reminder content is protected by a device-held AES-GCM key
// (see the calendar key helpers) so the Worker only ever stores/forwards
// ciphertext — it never learns event titles.
// ============================================================

import { apiFetch, YANTA_CLOUD_BASE_URL } from '../cloud/cloud-api.js';

const DEVICE_ID_KEY = 'yanta.push.deviceId.v1';
const PUSHKEY_KEY = 'yanta.push.pushkey.v1';
const ACTIVE_KEY = 'yanta.push.active.v1';

const PUSH_DB = 'yanta-push';
const PUSH_STORE = 'keys';
const CAL_KEY_ID = 'calendarKey';

const STATE_EVENT = 'yanta-push-state-changed';

let cachedConfig = null;

// ---- small utils ----------------------------------------------------------

function b64urlToBytes(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function persisted(key, factory) {
  try {
    let v = localStorage.getItem(key);
    if (!v) {
      v = factory();
      localStorage.setItem(key, v);
    }
    return v;
  } catch {
    return factory();
  }
}

function randomId() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return bytesToB64url(b);
}

/**
 * Stable per-browser id used to key the subscription server-side. Must be
 * independent of sync2 (whose deviceId may be undefined early and defined
 * later) so subscribe + schedule always agree — otherwise the cron's JOIN
 * between scheduled_pushes and push_subscriptions finds nothing.
 */
export function pushDeviceId() {
  return persisted(DEVICE_ID_KEY, randomId);
}

/** Stable opaque pushkey the Matrix web pusher uses. */
export function pushKey() {
  return persisted(PUSHKEY_KEY, randomId);
}

function setActive(active) {
  try {
    if (active) localStorage.setItem(ACTIVE_KEY, '1');
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent(STATE_EVENT));
}

/** Fast, synchronous gate used by the foreground calendar scheduler. */
export function isPushActive() {
  try {
    return localStorage.getItem(ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function onPushStateChange(handler) {
  window.addEventListener(STATE_EVENT, handler);
  return () => window.removeEventListener(STATE_EVENT, handler);
}

// ---- server config --------------------------------------------------------

async function getPushConfig() {
  if (cachedConfig) return cachedConfig;

  const res = await apiFetch('/api/push/config').catch(() => null);
  cachedConfig = {
    vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY || res?.vapidPublicKey || '',
    gatewayUrl: res?.gatewayUrl || '',
  };
  return cachedConfig;
}

export async function getVapidPublicKey() {
  return (await getPushConfig()).vapidPublicKey;
}

/** Matrix push gateway URL the web chat pusher points at. */
export async function getPushGatewayUrl() {
  return (await getPushConfig()).gatewayUrl;
}

/** True once the Worker has a VAPID key configured (push is available). */
export async function isPushConfigured() {
  try {
    return !!(await getVapidPublicKey());
  } catch {
    return false;
  }
}

// ---- calendar E2E key (shared with the Service Worker via IndexedDB) -------

function openPushDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PUSH_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PUSH_STORE)) {
        req.result.createObjectStore(PUSH_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openPushDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STORE, 'readonly');
    const r = tx.objectStore(PUSH_STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(key, value) {
  const db = await openPushDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STORE, 'readwrite');
    tx.objectStore(PUSH_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Ensures a device-local AES-GCM key exists (stored as raw bytes so the
 * Service Worker can read it too) and returns it as a CryptoKey.
 */
export async function ensureCalendarPushKey() {
  let raw = await idbGet(CAL_KEY_ID);

  if (!raw) {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    await idbPut(CAL_KEY_ID, raw);
  }

  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypts a reminder payload object with the device key. Returns a compact
 * `iv.ciphertext` (both base64url) string the Worker stores opaquely.
 */
export async function encryptReminderPayload(obj) {
  const key = await ensureCalendarPushKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return `${bytesToB64url(iv)}.${bytesToB64url(ct)}`;
}

// ---- subscribe / unsubscribe ----------------------------------------------

/**
 * Resolves a service worker registration with an ACTIVE worker — the hard
 * requirement for pushManager.subscribe(). More robust than relying on
 * navigator.serviceWorker.ready (which hangs forever if a worker never
 * activates): it registers if needed and waits for activation explicitly.
 */
async function ensureActiveRegistration(timeoutMs = 10000) {
  if (!('serviceWorker' in navigator)) return null;

  let reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
  if (!reg) return null;
  if (reg.active) return reg;

  await new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };

    const watch = (worker) => {
      if (!worker) return;
      if (worker.state === 'activated') return done();
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') done();
      });
    };

    watch(reg.installing);
    watch(reg.waiting);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    navigator.serviceWorker.ready.then(done).catch(() => {});
    setTimeout(done, timeoutMs);
  });

  reg = await navigator.serviceWorker.getRegistration().catch(() => reg);
  return reg || null;
}

async function existingSubscription() {
  const reg = await ensureActiveRegistration();
  if (!reg?.pushManager) return { reg: null, sub: null };
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return { reg, sub };
}

/**
 * Subscribes to Web Push and registers with the Worker. Requires a granted
 * notification permission and a signed-in Cloud session.
 * Resolves to true on success; throws with a helpful message otherwise.
 */
export async function subscribeWebPush() {
  if (!isPushSupported()) throw new Error('Web Push is not supported in this browser.');

  const vapid = await getVapidPublicKey();
  if (!vapid) throw new Error('Background notifications are not configured on the server yet.');

  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notification permission is required.');
  }

  const reg = await ensureActiveRegistration();
  if (!reg) throw new Error('Service worker could not be registered.');
  if (!reg.active) throw new Error('Service worker did not activate — reload the page and try again.');
  if (!reg.pushManager) throw new Error('Push is not available in this browser.');

  let sub = await reg.pushManager.getSubscription().catch(() => null);

  // Re-subscribe if the applicationServerKey changed (VAPID rotation).
  const appKey = b64urlToBytes(vapid);
  if (sub) {
    const current = new Uint8Array(sub.options?.applicationServerKey || []);
    if (current.length && !bytesEqual(current, appKey)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appKey,
    });
  }

  await ensureCalendarPushKey();

  // Stash meta so the Service Worker can re-subscribe on its own
  // (pushsubscriptionchange) — it can't read localStorage.
  await idbPut('meta', {
    vapidKey: vapid,
    deviceId: pushDeviceId(),
    pushkey: pushKey(),
    apiBase: YANTA_CLOUD_BASE_URL,
  });

  await apiFetch('/api/push/subscribe', {
    method: 'POST',
    body: {
      deviceId: pushDeviceId(),
      pushkey: pushKey(),
      subscription: sub.toJSON(),
    },
  });

  setActive(true);
  return true;
}

export async function unsubscribeWebPush() {
  try {
    const { sub } = await existingSubscription();
    await sub?.unsubscribe?.().catch(() => {});
  } catch {}

  try {
    await apiFetch('/api/push/unsubscribe', {
      method: 'POST',
      body: { deviceId: pushDeviceId() },
    });
  } catch {}

  setActive(false);
  return true;
}

/** Verifies the browser still holds a subscription; syncs the active flag. */
export async function refreshPushActiveState() {
  if (!isPushSupported()) {
    setActive(false);
    return false;
  }

  const { sub } = await existingSubscription();
  const active = !!sub;
  if (active !== isPushActive()) setActive(active);

  // Re-register with the server so it always has the current device id +
  // endpoint (heals stale rows from earlier deviceId schemes / rotations).
  if (sub) {
    apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: { deviceId: pushDeviceId(), pushkey: pushKey(), subscription: sub.toJSON() },
    }).catch(() => {});
  }

  return active;
}

/**
 * Asks the Worker to push a test notification to this user's stored
 * subscription(s) — the decisive check that the full server→push-service
 * path works. Returns { count, results:[{ok,status,reason}], vapidConfigured }.
 */
export async function sendBackgroundTest() {
  return apiFetch('/api/push/test', { method: 'POST' });
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
