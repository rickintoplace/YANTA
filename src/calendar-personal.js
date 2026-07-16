// ============================================================
// YANTA — Personal calendar preferences (never synced into a share)
//
// A shared calendar syncs *what* happens; how it looks and when it
// nags each participant stays personal, exactly like Google/Apple:
//
// - per-category color + visibility override (recipients pick their
//   own color for a mounted shared calendar; the shared record only
//   carries the name)
// - per-category personal default reminders, applied (deduplicated)
//   to every event of that category
// - per-event personal reminders for events living in a shared
//   calendar (their shared record never carries reminders)
//
// Everything lives in local settings under one key and is loaded once
// into memory so render paths can stay synchronous.
// ============================================================

import { store } from './core.js';

const SETTINGS_KEY = 'calendar.personal.v1';

let cache = null;
let loadPromise = null;
let saveTimer = null;

function emptyState() {
  return {
    categories: {}, // catId -> { color?, visible?, defaultReminders? }
    eventReminders: {}, // eventId -> [reminder]
  };
}

export async function loadCalendarPersonal() {
  if (cache) return cache;

  if (!loadPromise) {
    loadPromise = (async () => {
      const raw = await store.settings.get(SETTINGS_KEY, null).catch(() => null);

      cache = raw && typeof raw === 'object'
        ? {
            categories: raw.categories && typeof raw.categories === 'object'
              ? raw.categories
              : {},
            eventReminders: raw.eventReminders && typeof raw.eventReminders === 'object'
              ? raw.eventReminders
              : {},
          }
        : emptyState();

      return cache;
    })();
  }

  return loadPromise;
}

function persistSoon() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    if (!cache) return;
    store.settings.set(SETTINGS_KEY, cache).catch(() => {});
  }, 400);
}

function ensureLoadedSync() {
  if (!cache) {
    // Callers run after loadCalendarPersonal() during app setup; if one
    // sneaks in earlier, start with an empty state and hydrate async.
    cache = emptyState();
    loadCalendarPersonal().catch(() => {});
  }

  return cache;
}

// ---------------- category overlay -------------------------------

export function categoryPersonalPrefs(categoryId) {
  const s = ensureLoadedSync();
  return s.categories[String(categoryId || '')] || null;
}

export function setCategoryPersonalPrefs(categoryId, patch) {
  const id = String(categoryId || '');
  if (!id) return;

  const s = ensureLoadedSync();
  const next = { ...(s.categories[id] || {}), ...patch };

  // Drop keys explicitly reset to undefined/null so the overlay stays
  // "no opinion" wherever the user hasn't chosen anything.
  for (const key of Object.keys(next)) {
    if (next[key] === undefined || next[key] === null) delete next[key];
  }

  if (Object.keys(next).length) {
    s.categories[id] = next;
  } else {
    delete s.categories[id];
  }

  persistSoon();
}

export function forgetCategoryPersonalPrefs(categoryId) {
  const s = ensureLoadedSync();
  delete s.categories[String(categoryId || '')];
  persistSoon();
}

/**
 * Apply the personal overlay onto a (usually shared) category record.
 * Returns a new object; the input is not mutated.
 */
export function applyCategoryOverlay(cat) {
  if (!cat) return cat;

  const prefs = categoryPersonalPrefs(cat.id);
  if (!prefs) return cat;

  const out = { ...cat };

  if (prefs.color) out.color = prefs.color;
  if (typeof prefs.visible === 'boolean') out.visible = prefs.visible;

  return out;
}

// ---------------- reminders --------------------------------------

function reminderMinutes(reminder) {
  const n = Number(reminder?.minutesBefore);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * Union of reminder lists, deduplicated by minutesBefore (first list
 * wins on conflicts, so explicit event reminders beat category
 * defaults with the same offset).
 */
export function dedupReminders(...lists) {
  const seen = new Set();
  const out = [];

  for (const list of lists) {
    for (const reminder of Array.isArray(list) ? list : []) {
      const minutes = reminderMinutes(reminder);
      if (minutes === null || seen.has(minutes)) continue;

      seen.add(minutes);
      out.push({ ...reminder, minutesBefore: minutes });
    }
  }

  return out;
}

export function defaultRemindersForCategory(categoryId) {
  const prefs = categoryPersonalPrefs(categoryId);
  return Array.isArray(prefs?.defaultReminders) ? prefs.defaultReminders : [];
}

export function setDefaultRemindersForCategory(categoryId, reminders) {
  setCategoryPersonalPrefs(categoryId, {
    defaultReminders: Array.isArray(reminders) && reminders.length
      ? dedupReminders(reminders)
      : undefined,
  });
}

export function personalEventReminders(eventId) {
  const s = ensureLoadedSync();
  const list = s.eventReminders[String(eventId || '')];
  return Array.isArray(list) ? list : [];
}

export function setPersonalEventReminders(eventId, reminders) {
  const id = String(eventId || '');
  if (!id) return;

  const s = ensureLoadedSync();

  if (Array.isArray(reminders) && reminders.length) {
    s.eventReminders[id] = dedupReminders(reminders);
  } else {
    delete s.eventReminders[id];
  }

  persistSoon();
}

export function forgetPersonalEventReminders(eventId) {
  setPersonalEventReminders(eventId, []);
}

/**
 * The reminders that actually fire for this user, for any event:
 * shared events read the personal per-event list (their record carries
 * none); own events read the record. Category default reminders are
 * merged in on top, deduplicated by offset.
 */
export function effectiveRemindersForEvent(ev) {
  if (!ev) return [];

  const base = ev.spaceId
    ? personalEventReminders(ev.id)
    : Array.isArray(ev.reminders) ? ev.reminders : [];

  return dedupReminders(base, defaultRemindersForCategory(ev.categoryId));
}
