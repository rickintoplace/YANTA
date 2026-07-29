// ============================================================
// YANTA Pulse — vocabulary, policy constants, user settings
//
// Wording contract (keep this consistent across UI and code):
//   Pulse    — the feature as a whole ("YANTA Pulse")
//   Routine  — one configured unit of recurring work
//   Run      — one execution of a routine
//   Inbox    — where results wait for the user
//   beat     — internal only: one scheduler tick. Never user-facing.
//   heartbeat— documentation/marketing only. Never user-facing.
// ============================================================

import { store } from '../core.js';

const SETTINGS_KEY = 'yanta.pulse.settings.v1';

/** Where a run may deliver its result. */
export const PULSE_OUTPUTS = Object.freeze({
  INBOX: 'inbox',
  JOURNAL: 'journal',
  CHAT: 'chat',
});

/**
 * Tool profiles, ordered by blast radius. A routine declares one; the
 * effective profile is additionally clamped by user settings, so a
 * self-authored routine can never widen its own reach past what the
 * user allowed.
 */
export const PULSE_TOOL_PROFILES = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  FULL: 'full',
});

export const PULSE_TOOL_PROFILE_ORDER = [
  PULSE_TOOL_PROFILES.READ,
  PULSE_TOOL_PROFILES.WRITE,
  PULSE_TOOL_PROFILES.FULL,
];

/**
 * Tools an unattended run may never call, whatever its profile. These
 * either block on a modal (deadlock with nobody watching) or reach a
 * third party without review. Routines route them through
 * `pulse_propose` instead, which parks a one-tap card in the Inbox.
 */
export const PULSE_TOOL_DENYLIST = Object.freeze([
  'chat_send_message',
  'replace_current_selection',

  // A routine that can create routines is a routine that can multiply
  // unattended. Authoring stays a conversation the user is present for.
  'pulse_manage',
]);

/** Sensor-backed event triggers a routine can subscribe to. */
export const PULSE_EVENTS = Object.freeze({
  RSS_NEW: 'rss-new',
  CALENDAR_SOON: 'calendar-soon',
  CALENDAR_CHANGED: 'calendar-changed',
  NOTES_CHANGED: 'notes-changed',
  CHAT_UNREAD: 'chat-unread',
});

export const DEFAULT_PULSE_SETTINGS = Object.freeze({
  enabled: true,

  // Nothing is delivered inside this window; due runs wait for the end
  // of it rather than being dropped.
  quietFrom: '22:00',
  quietTo: '07:00',

  // Hard ceiling across all routines. The scheduler stops running once
  // it is hit, so a misconfigured routine cannot flood the Inbox.
  maxRunsPerDay: 12,

  // Missed-run reminder while the app was closed. Needs Web Push.
  notifyMissed: true,

  // Opt-in gates. Routines are clamped to these no matter what their
  // own frontmatter asks for.
  allowWrite: true,
  allowDestructive: false,
});

let cache = null;

export async function getPulseSettings() {
  if (cache) return cache;

  const raw = await store.settings.get(SETTINGS_KEY, null).catch(() => null);

  cache = {
    ...DEFAULT_PULSE_SETTINGS,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  return cache;
}

export async function setPulseSettings(patch = {}) {
  const next = {
    ...(await getPulseSettings()),
    ...patch,
  };

  cache = next;
  await store.settings.set(SETTINGS_KEY, next);

  window.dispatchEvent(new CustomEvent('yanta-pulse-settings-changed', {
    detail: { settings: next },
  }));

  return next;
}

/** Highest profile the user currently permits. */
export function maxAllowedProfile(settings = DEFAULT_PULSE_SETTINGS) {
  if (settings.allowDestructive) return PULSE_TOOL_PROFILES.FULL;
  if (settings.allowWrite) return PULSE_TOOL_PROFILES.WRITE;
  return PULSE_TOOL_PROFILES.READ;
}

/** Narrows `requested` to what settings allow. Never widens. */
export function clampToolProfile(requested, settings = DEFAULT_PULSE_SETTINGS) {
  const ceiling = maxAllowedProfile(settings);

  const wantIndex = PULSE_TOOL_PROFILE_ORDER.indexOf(requested);
  const ceilingIndex = PULSE_TOOL_PROFILE_ORDER.indexOf(ceiling);

  if (wantIndex < 0) return PULSE_TOOL_PROFILES.READ;

  return PULSE_TOOL_PROFILE_ORDER[Math.min(wantIndex, ceilingIndex)];
}

function parseClock(value, fallbackMinutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());

  if (!m) return fallbackMinutes;

  const minutes = Number(m[1]) * 60 + Number(m[2]);

  return Number.isFinite(minutes) && minutes >= 0 && minutes < 1440
    ? minutes
    : fallbackMinutes;
}

/**
 * Quiet hours wrap midnight when `from > to` (the common 22:00–07:00
 * case), so the check is an OR rather than a range test.
 */
export function isQuietHour(settings, at = new Date()) {
  const from = parseClock(settings.quietFrom, 22 * 60);
  const to = parseClock(settings.quietTo, 7 * 60);

  if (from === to) return false;

  const minutes = at.getHours() * 60 + at.getMinutes();

  return from < to
    ? minutes >= from && minutes < to
    : minutes >= from || minutes < to;
}

/** Next moment delivery is allowed again, or `at` when already allowed. */
export function nextQuietWindowEnd(settings, at = new Date()) {
  if (!isQuietHour(settings, at)) return at.getTime();

  const to = parseClock(settings.quietTo, 7 * 60);
  const end = new Date(at);

  end.setHours(Math.floor(to / 60), to % 60, 0, 0);

  if (end.getTime() <= at.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  return end.getTime();
}
