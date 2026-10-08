// ============================================================
// YANTA — background push schedule (shared upload)
//
// The Worker stores one pending schedule per device and replaces it
// wholesale on every upload. So everything that wants a background
// wake-up has to be uploaded together: calendar reminders and Pulse
// wake-ups register as providers here, and this module merges them
// into the single POST the Worker expects.
//
// Every item is encrypted on this device before upload. The Worker
// only ever sees a fire time and ciphertext.
// ============================================================

import { apiFetch } from '../cloud/cloud-api.js';

import {
  isPushActive,
  pushDeviceId,
} from './web-push-client.js';

/** Worker-side cap per device — keep the merged set under it. */
const MAX_ITEMS = 500;

const providers = new Map();

/*
  The schedule is re-collected every 30 minutes and on every calendar
  change, but usually nothing changed — and each upload deletes and
  re-inserts every row on the server. Items carry a local fingerprint
  (`fp`, never uploaded); an identical set is not sent again, except
  every few hours so a server that lost it gets it back.
*/
const FP_KEY = 'yanta.push.scheduleFp.v1';
const FP_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function scheduleFingerprint(deviceId, items) {
  if (items.some((item) => !item.fp)) return '';

  const text = `${deviceId}\n${items.map((item) => `${item.fireAt}:${item.fp}`).join('\n')}`;

  // FNV-1a; collisions only cost a skipped upload until FP_MAX_AGE_MS.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return `${items.length}:${(h >>> 0).toString(36)}`;
}

function lastUpload() {
  try {
    return JSON.parse(localStorage.getItem(FP_KEY) || 'null') || {};
  } catch {
    return {};
  }
}

let debounce = 0;
let inFlight = null;

/**
 * Registers a source of scheduled pushes.
 *
 * @param {string} id       stable provider id, e.g. 'calendar'
 * @param {Function} collect  async () => [{ fireAt, enc }]
 */
export function registerPushScheduleProvider(id, collect) {
  if (!id || typeof collect !== 'function') return;

  providers.set(id, collect);
}

async function collectAll() {
  const items = [];

  for (const [id, collect] of providers) {
    try {
      const produced = await collect();

      if (Array.isArray(produced)) items.push(...produced);
    } catch (err) {
      console.warn('[YANTA Push] schedule provider failed', id, err);
    }
  }

  // Soonest first, so the cap drops the most distant items rather than
  // whichever provider happened to run last.
  return items
    .filter((item) => Number.isFinite(item?.fireAt) && item?.enc)
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, MAX_ITEMS);
}

/**
 * Rebuilds and uploads the merged schedule. Concurrent callers share
 * one upload; the result is non-fatal on failure because every feature
 * keeps a foreground fallback for the "app is open" case.
 */
export async function refreshPushSchedule() {
  if (!isPushActive()) return { ok: false, reason: 'push-inactive' };

  if (inFlight) return inFlight;

  inFlight = (async () => {
    const items = await collectAll();
    const deviceId = pushDeviceId();
    const fp = scheduleFingerprint(deviceId, items);
    const last = lastUpload();

    if (fp && last.fp === fp && Date.now() - Number(last.at || 0) < FP_MAX_AGE_MS) {
      return { ok: true, count: items.length, unchanged: true };
    }

    try {
      await apiFetch('/api/push/schedule', {
        method: 'POST',
        body: { deviceId, items: items.map(({ fireAt, enc }) => ({ fireAt, enc })) },
      });

      try {
        localStorage.setItem(FP_KEY, JSON.stringify({ fp, at: Date.now() }));
      } catch {}

      return { ok: true, count: items.length };
    } catch (err) {
      console.warn('[YANTA Push] schedule upload failed', err);
      return { ok: false, reason: err?.message || String(err) };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function schedulePushRefresh(delay = 800) {
  clearTimeout(debounce);

  debounce = window.setTimeout(() => {
    refreshPushSchedule().catch(() => {});
  }, delay);
}
