// ============================================================
// YANTA — Calendar push scheduler (background delivery)
//
// While the app is open, this registers the upcoming reminders with the
// Cloud Worker so they fire as Web Push notifications even after every tab
// is closed. Each reminder's text is encrypted with the device key
// (encryptReminderPayload) before it leaves the browser — the Worker only
// stores ciphertext + a fire time.
//
// The Worker's per-minute cron sends due pushes; the Service Worker
// decrypts and shows them. Complements calendar-web-reminders.js, which
// stays the fallback when push is not active.
// ============================================================

import { calendarNotificationsEnabled } from '../notification-preferences.js';
import { isAndroidApp } from '../install/install-environment.js';
import { apiFetch } from '../cloud/cloud-api.js';

import {
  isPushActive,
  pushDeviceId,
  encryptReminderPayload,
} from './web-push-client.js';

import {
  collectUpcomingReminders,
  reminderBody,
} from '../calendar-web-reminders.js';

const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_MS = 30 * 60 * 1000; // re-register periodically while open
const GRACE_MS = 60 * 1000;

let installed = false;
let refreshInterval = 0;
let debounce = 0;

function shouldSchedule() {
  return (
    !isAndroidApp() &&
    isPushActive() &&
    calendarNotificationsEnabled() &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  );
}

function reminderUrl() {
  return `${location.origin}${location.pathname}${location.search}#calendar`;
}

/**
 * Rebuilds and uploads this device's background reminder schedule. No-op
 * unless push is active. Safe to call often (debounced by callers).
 */
export async function refreshCalendarPushSchedule() {
  if (!shouldSchedule()) return;

  const now = Date.now();

  let reminders;
  try {
    reminders = await collectUpcomingReminders({ now, horizonMs: HORIZON_MS });
  } catch (err) {
    console.warn('[YANTA Calendar Push] collect failed', err);
    return;
  }

  const items = [];
  for (const rem of reminders) {
    // Only future reminders — the cron fires at minute granularity.
    if (rem.fireAt < now - GRACE_MS) continue;

    try {
      const enc = await encryptReminderPayload({
        kind: 'calendar-reminder',
        id: rem.key,
        title: rem.ev.title || 'Event reminder',
        body: reminderBody(rem.ev, rem.minutesBefore),
        url: reminderUrl(),
      });
      items.push({ fireAt: Math.round(rem.fireAt), enc });
    } catch (err) {
      console.warn('[YANTA Calendar Push] encrypt failed', err);
    }
  }

  try {
    await apiFetch('/api/push/schedule', {
      method: 'POST',
      body: { deviceId: pushDeviceId(), items },
    });
  } catch (err) {
    // Not signed into Cloud, offline, etc. — the foreground path still covers
    // the "app open" case, so this is non-fatal.
    console.warn('[YANTA Calendar Push] schedule upload failed', err);
  }
}

function scheduleRefresh(delay = 800) {
  clearTimeout(debounce);
  debounce = window.setTimeout(() => {
    refreshCalendarPushSchedule().catch(() => {});
  }, delay);
}

export function setupCalendarPushScheduler() {
  if (installed) return;
  installed = true;

  const kick = () => scheduleRefresh(800);

  window.addEventListener('yanta-vault-hydrated', kick);
  window.addEventListener('yanta-calendar-updated', kick);
  window.addEventListener('yanta-notification-prefs-changed', kick);
  window.addEventListener('yanta-push-state-changed', kick);

  refreshInterval = window.setInterval(() => {
    refreshCalendarPushSchedule().catch(() => {});
  }, REFRESH_MS);

  // Deferred first pass, off the boot path.
  window.setTimeout(kick, 6000);
}
