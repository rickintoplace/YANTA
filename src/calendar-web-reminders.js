// ============================================================
// YANTA — Calendar reminders on the web (foreground desktop delivery)
//
// The phone (native Android app) remains the reliable, always-on
// reminder channel. This adds an *additional* channel: while YANTA is
// open in a browser/PWA, event reminders also fire as system
// notifications on the desktop.
//
// It only covers "app is open" — closed-tab delivery on the web needs
// Web Push infrastructure. That's why the phone stays the primary path.
//
// Strategy: a periodic scan expands upcoming occurrences and schedules
// an exact setTimeout for every reminder due within the next window.
// Fired reminders are remembered (localStorage, TTL-pruned) so a reload
// or a second scan never double-fires the same one.
// ============================================================

import { swRegistrationReady } from './core.js';

import {
  calendarNotificationsEnabled,
} from './notification-preferences.js';

import { isAndroidApp } from './install/install-environment.js';

import { isPushActive } from './push/web-push-client.js';

const RESCAN_MS = 5 * 60 * 1000;              // rebuild timers every 5 minutes
const SCHEDULE_WINDOW_MS = 20 * 60 * 1000;    // schedule exact timers up to 20 min out
const SCAN_HORIZON_MS = 8 * 24 * 60 * 60 * 1000; // look ahead far enough for week-long lead times
const GRACE_MS = 60 * 1000;                   // still fire a reminder we missed by < 1 min
const FIRED_TTL_MS = 24 * 60 * 60 * 1000;     // forget fired reminders after a day

const FIRED_KEY = 'yanta.notifications.calendar.fired.v1';

let installed = false;
let rescanInterval = 0;
let rescanDebounce = 0;
const timers = new Map(); // reminderKey -> timeoutId

function eventStartMs(ev) {
  const raw = String(ev?.start || '').trim();
  if (!raw) return NaN;

  // All-day events store date keys — parse as local midnight.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00`)
    : new Date(raw);

  return d.getTime();
}

function loadFired() {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(FIRED_KEY) || '{}')));
  } catch {
    return new Map();
  }
}

function saveFired(map) {
  try {
    const now = Date.now();
    const obj = {};
    for (const [k, ts] of map) {
      if (now - Number(ts) < FIRED_TTL_MS) obj[k] = ts;
    }
    localStorage.setItem(FIRED_KEY, JSON.stringify(obj));
  } catch {}
}

function clearTimers() {
  for (const id of timers.values()) clearTimeout(id);
  timers.clear();
}

function canDeliver() {
  // Native app schedules exact alarms itself — don't double up there.
  if (isAndroidApp()) return false;
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  return calendarNotificationsEnabled();
}

export function reminderBody(ev, minutesBefore) {
  const startMs = eventStartMs(ev);
  const lead =
    minutesBefore <= 0 ? 'now'
      : minutesBefore < 60 ? `in ${minutesBefore} min`
        : minutesBefore < 1440 ? `in ${Math.round(minutesBefore / 60)} h`
          : `in ${Math.round(minutesBefore / 1440)} d`;

  if (ev.allDay) return `All-day event · ${lead === 'now' ? 'today' : lead}`;

  const time = Number.isFinite(startMs)
    ? new Date(startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return time ? `${lead} · ${time}` : lead;
}

async function fireReminder(ev, minutesBefore, key) {
  timers.delete(key);

  if (!canDeliver()) return;

  const fired = loadFired();
  if (fired.has(key)) return;
  fired.set(key, Date.now());
  saveFired(fired);

  const title = ev.title || 'Event reminder';
  const options = {
    body: reminderBody(ev, minutesBefore),
    tag: `yanta-reminder-${key}`,
    icon: '/android-chrome-192x192.png',
    badge: '/android-chrome-192x192.png',
    renotify: true,
    requireInteraction: true,
    data: {
      kind: 'calendar-reminder',
      url: `${location.origin}${location.pathname}${location.search}#calendar`,
    },
  };

  try {
    const reg = await swRegistrationReady();
    if (reg?.showNotification) {
      await reg.showNotification(title, options);
      return;
    }
  } catch (err) {
    console.warn('[YANTA Calendar Reminders] SW notification failed', err);
  }

  try {
    // eslint-disable-next-line no-new
    new Notification(title, options);
  } catch (err) {
    console.warn('[YANTA Calendar Reminders] Web notification failed', err);
  }
}

/**
 * Expands calendar occurrences and returns every enabled reminder that
 * fires within `horizonMs`, as `{ ev, minutesBefore, startMs, fireAt, key }`.
 *
 * Single source of truth for "what reminders exist", shared by the
 * foreground scheduler here and the background push scheduler
 * (calendar-push-scheduler.js). Mirrors the Android bridge's reminder path.
 */
export async function collectUpcomingReminders({ now = Date.now(), horizonMs = SCAN_HORIZON_MS } = {}) {
  let occurrences;
  try {
    const { expandedCalendarRawEventsForRange } = await import('./calendar.js');
    occurrences = expandedCalendarRawEventsForRange(
      new Date(now - GRACE_MS),
      new Date(now + horizonMs),
      { includeStored: true, includeMarkdownDerived: true, includeSources: false },
    );
  } catch (err) {
    console.warn('[YANTA Calendar Reminders] Could not read calendar', err);
    return [];
  }

  const { effectiveRemindersForEvent } = await import('./calendar-personal.js');
  const out = [];

  for (const ev of occurrences) {
    if (!ev || ev.status === 'cancelled') continue;

    const startMs = eventStartMs(ev);
    if (!Number.isFinite(startMs)) continue;

    const masterId = ev.recurrenceMasterId || ev.id;
    const reminders = effectiveRemindersForEvent(ev).filter((r) => {
      if (!r || r.enabled === false) return false;
      const m = Number(r.minutesBefore);
      return Number.isFinite(m) && m >= 0;
    });

    for (const r of reminders) {
      const minutesBefore = Math.round(Number(r.minutesBefore));
      out.push({
        ev,
        minutesBefore,
        startMs,
        fireAt: startMs - minutesBefore * 60000,
        key: `${masterId}|${startMs}|${minutesBefore}`,
      });
    }
  }

  return out;
}

async function rescan() {
  clearTimers();

  if (!canDeliver()) return;

  // When background Web Push is active it covers reminders whether the app is
  // open or closed — running the foreground timers too would double-fire.
  if (isPushActive()) return;

  const now = Date.now();
  const reminders = await collectUpcomingReminders({ now });
  const fired = loadFired();

  for (const rem of reminders) {
    if (fired.has(rem.key) || timers.has(rem.key)) continue;

    const delay = rem.fireAt - now;
    if (delay < -GRACE_MS) continue;         // too old — skip
    if (delay > SCHEDULE_WINDOW_MS) continue; // a later rescan will pick it up

    timers.set(rem.key, setTimeout(() => {
      fireReminder(rem.ev, rem.minutesBefore, rem.key).catch(() => {});
    }, Math.max(0, delay)));
  }
}

function scheduleRescan(delay = 400) {
  clearTimeout(rescanDebounce);
  rescanDebounce = window.setTimeout(() => {
    rescan().catch((err) => console.warn('[YANTA Calendar Reminders] rescan failed', err));
  }, delay);
}

/**
 * Starts the desktop reminder scheduler. Idempotent and cheap until the
 * first trigger — the heavy calendar module is imported lazily inside
 * rescan(), off the boot path.
 */
export function setupCalendarWebReminders() {
  if (installed) return;
  installed = true;

  const kick = () => scheduleRescan(400);

  window.addEventListener('yanta-vault-hydrated', kick);
  window.addEventListener('yanta-calendar-updated', kick);
  window.addEventListener('yanta-notification-prefs-changed', kick);
  // Permission grant/revoke dispatches this.
  window.addEventListener('yanta-install-state-changed', kick);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRescan(600);
  });

  rescanInterval = window.setInterval(() => {
    rescan().catch(() => {});
  }, RESCAN_MS);

  // First pass deferred so it never competes with boot.
  window.setTimeout(kick, 5000);
}

/**
 * Stops the scheduler (used rarely; mainly for completeness/tests).
 */
export function teardownCalendarWebReminders() {
  clearTimers();
  clearInterval(rescanInterval);
  installed = false;
}
