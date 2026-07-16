// ============================================================
// YANTA — Notification sync status
//
// Event reminders only fire on Android devices running the YANTA
// app, and only after that device has opened the app and handed the
// current reminder snapshot to the native alarm scheduler.
//
// This module makes that state visible and shareable:
// - Android devices write an acknowledgment ("these event versions
//   are scheduled natively") into the synced vault device record.
// - Any device can then report which reminders are already covered
//   by a notification-capable device and which are still waiting
//   for the user to open YANTA on their phone.
//
// No imports from calendar.js — keeps the dependency graph one-way
// (calendar.js and the dashboard consume this module).
// ============================================================

import {
  hasRecurrence,
  expandRecurringEvent,
} from './calendar-recurrence.js';

import {
  getVaultDoc,
  vaultEventsMap,
  vaultTombstonesMap,
  vaultDevicesMap,
  safeJsonClone,
} from './sync2/vault-doc.js';

/*
  Same horizon the Android bridge uses for its native snapshot —
  the ack must describe exactly what the native side was given.
*/
const REMINDER_WINDOW_MS = 420 * 24 * 60 * 60 * 1000;
const REMINDER_GRACE_MS = 5 * 60 * 1000;

const ACK_ORIGIN = 'native-notification-ack';

function enabledReminderCount(ev) {
  if (!Array.isArray(ev?.reminders)) return 0;

  return ev.reminders.filter((r) => {
    if (!r || typeof r !== 'object') return false;
    if (r.enabled === false) return false;

    const minutes = Number(r.minutesBefore);
    return Number.isFinite(minutes) && minutes >= 0;
  }).length;
}

function eventStartMs(ev) {
  if (!ev?.start) return NaN;

  const raw = String(ev.start);

  // All-day events store date keys — parse as local midnight.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())
    ? new Date(`${raw.trim()}T00:00:00`)
    : new Date(raw);

  return d.getTime();
}

function hasUpcomingOccurrence(ev, now) {
  const windowStart = new Date(now - REMINDER_GRACE_MS);
  const windowEnd = new Date(now + REMINDER_WINDOW_MS);

  if (hasRecurrence(ev)) {
    /*
      Small cap keeps this cheap; not 1, because leading occurrences
      may be swallowed by recurrence exceptions.
    */
    return expandRecurringEvent(ev, windowStart, windowEnd, {
      maxOccurrences: 25,
    }).length > 0;
  }

  const startMs = eventStartMs(ev);

  return Number.isFinite(startMs) &&
    startMs >= windowStart.getTime() &&
    startMs <= windowEnd.getTime();
}

/**
 * Stored events whose reminders still need a device to deliver them:
 * at least one enabled reminder and an upcoming occurrence.
 *
 * Reads the vault directly so the answer does not depend on the
 * calendar surface having hydrated its in-memory state yet.
 */
export function upcomingReminderEvents(now = Date.now()) {
  const tombstones = vaultTombstonesMap();
  const out = [];

  for (const [id, raw] of vaultEventsMap()) {
    if (!raw || typeof raw !== 'object') continue;
    if (tombstones.has(id)) continue;
    if (raw.status === 'cancelled') continue;
    if (!enabledReminderCount(raw)) continue;
    if (!hasUpcomingOccurrence(raw, now)) continue;

    out.push(safeJsonClone(raw));
  }

  return out.sort((a, b) => eventStartMs(a) - eventStartMs(b));
}

/**
 * { [eventId]: updatedTimestamp } for every upcoming reminder event.
 * Both the Android ack and the pending-report compare against this,
 * so "synced" always means "knows the current version of the event".
 */
export function reminderEventVersions(now = Date.now()) {
  const versions = {};

  for (const ev of upcomingReminderEvents(now)) {
    versions[String(ev.id)] = Number(ev.updated || 0);
  }

  return versions;
}

function currentDeviceId() {
  return window.yantaSync2?.deviceId || '';
}

/**
 * Called by the Android bridge after the native snapshot was handed
 * to the app. Persists "this device's alarm scheduler knows these
 * event versions" into the synced device record, so every other
 * device can tell whether its reminders will actually fire somewhere.
 *
 * Skips the write when nothing changed — device-record churn would
 * otherwise queue a remote sync cycle for every heartbeat.
 */
export function recordNativeNotificationAck(status = {}) {
  const deviceId = currentDeviceId();
  if (!deviceId) return null;

  const devices = vaultDevicesMap();
  const existing = devices.get(deviceId);

  /*
    Without a device record there is no sync engine writing one —
    a standalone (unsynced) app has no other devices to inform.
  */
  if (!existing) return null;

  const ack = {
    isAndroidApp: true,
    notificationsGranted: status.notificationsGranted !== false,
    exactAlarmAllowed: status.exactAlarmAllowed !== false,
    eventVersions: reminderEventVersions(),
  };

  const prev = existing.notificationSync || null;

  const unchanged =
    prev &&
    JSON.stringify({ ...prev, updatedAt: 0 }) ===
    JSON.stringify({ ...ack, updatedAt: 0 });

  if (unchanged) return prev;

  const next = {
    ...ack,
    updatedAt: Date.now(),
  };

  getVaultDoc().transact(() => {
    devices.set(deviceId, {
      ...safeJsonClone(existing),
      notificationSync: next,
    });
  }, ACK_ORIGIN);

  return next;
}

/**
 * All devices that ever reported native notification capability,
 * newest activity first.
 */
export function notificationCapableDevices() {
  const current = currentDeviceId();
  const out = [];

  try {
    for (const record of vaultDevicesMap().values()) {
      const ack = record?.notificationSync;
      if (!ack?.isAndroidApp) continue;

      out.push({
        id: String(record.id || ''),
        name: String(record.name || record.id || 'Android device'),
        current: record.id === current,
        notificationsGranted: ack.notificationsGranted !== false,
        exactAlarmAllowed: ack.exactAlarmAllowed !== false,
        eventVersions: ack.eventVersions || {},
        updatedAt: Number(ack.updatedAt || 0),
      });
    }
  } catch {
    return [];
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function deviceKnowsEvent(device, eventId, updated) {
  const acked = Number(device.eventVersions?.[String(eventId)] || 0);
  return acked > 0 && acked >= Number(updated || 0);
}

function deviceCanNotify(device) {
  return device.notificationsGranted && device.exactAlarmAllowed;
}

/**
 * Per-event device coverage for the event editor.
 *
 * `state` per device:
 * - 'synced'      — current version scheduled natively
 * - 'pending'     — device must open YANTA to pick this up
 * - 'permissions' — device knows it but cannot notify
 */
export function notificationSyncStatusForEvent(ev = {}) {
  const devices = notificationCapableDevices();
  const updated = Number(ev.updated || 0);

  // Acks track stored events — occurrences resolve to their master.
  const id = String(ev.recurrenceMasterId || ev.id || '');

  return {
    hasNotificationDevices: devices.length > 0,
    devices: devices.map((device) => {
      const synced = id && deviceKnowsEvent(device, id, updated);

      return {
        ...device,
        synced,
        state: !deviceCanNotify(device)
          ? 'permissions'
          : synced
            ? 'synced'
            : 'pending',
      };
    }),
  };
}

/**
 * Vault-wide report for the dashboard information panel.
 */
export function notificationSyncReport(now = Date.now()) {
  const events = upcomingReminderEvents(now);
  const devices = notificationCapableDevices();
  const notifyingDevices = devices.filter(deviceCanNotify);

  const pendingEvents = [];

  for (const ev of events) {
    const covered = notifyingDevices.some((device) =>
      deviceKnowsEvent(device, ev.id, ev.updated));

    if (!covered) {
      pendingEvents.push({
        id: String(ev.id),
        title: String(ev.title || 'Untitled event'),
        start: ev.start,
        reminderCount: enabledReminderCount(ev),
      });
    }
  }

  const staleDevices = notifyingDevices.filter((device) =>
    events.some((ev) => !deviceKnowsEvent(device, ev.id, ev.updated)));

  return {
    reminderEventCount: events.length,
    devices,
    hasNotificationDevices: devices.length > 0,
    permissionIssueDevices: devices.filter((d) => !deviceCanNotify(d)),
    staleDevices,
    pendingEvents,
  };
}

/**
 * Re-render hook: fires `handler` whenever device acks change, and
 * stops itself once `isAlive()` reports the consumer is gone.
 */
export function observeNotificationSyncStatus(handler, isAlive = () => true) {
  let map = null;

  const onChange = () => {
    if (!isAlive()) {
      unobserve();
      return;
    }

    try {
      handler();
    } catch {}
  };

  const unobserve = () => {
    try {
      map?.unobserve(onChange);
    } catch {}
  };

  try {
    map = vaultDevicesMap();
    map.observe(onChange);
  } catch {
    return () => {};
  }

  return unobserve;
}
