// ============================================================
// YANTA — Notification preferences (device-local)
//
// Per-device switches for what THIS device shows: chat messages and
// calendar reminders. Kept in localStorage (not synced) because each
// device decides for itself what it surfaces — a desktop and a phone
// legitimately want different delivery.
//
// Native Android has its own OS-level channels, so these gates apply to
// the web delivery paths (chat web notifications + the desktop calendar
// reminder scheduler).
// ============================================================

const CHAT_KEY = 'yanta.notifications.chat.enabled.v1';
const CALENDAR_KEY = 'yanta.notifications.calendar.enabled.v1';

const CHANGED_EVENT = 'yanta-notification-prefs-changed';

function readBool(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {}

  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

export function chatNotificationsEnabled() {
  return readBool(CHAT_KEY, true);
}

export function calendarNotificationsEnabled() {
  return readBool(CALENDAR_KEY, true);
}

export function setChatNotificationsEnabled(value) {
  writeBool(CHAT_KEY, value);
}

export function setCalendarNotificationsEnabled(value) {
  writeBool(CALENDAR_KEY, value);
}

/**
 * Subscribe to preference changes. Returns an unsubscribe function.
 */
export function onNotificationPrefsChange(handler) {
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}
