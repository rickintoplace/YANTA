// ============================================================
// YANTA Pulse — vocabulary, policy constants, user settings
//
// Wording contract (keep this consistent across UI and code):
//   Pulse    — the feature as a whole ("YANTA Pulse")
//   Routine  — one configured unit of recurring work
//   Run      — one execution of a routine
//   Inbox    — where results wait for the user
//   beat     — internal only: one scheduler tick. Never user-facing.
//   heartbeat— documentation only. Never user-facing.
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

  // The Brain and Skills steer every later run and every later chat, and
  // a background run is exactly where a change to them goes unnoticed: a
  // routine reads feeds, the web and messages — none of it trustworthy —
  // and would then be able to write what it "learned" into the same
  // instructions it is later given. That is a durable compromise made
  // while nobody is watching, and it survives long after the run.
  //
  // A routine that wants to change them proposes the exact call with
  // `pulse_propose`; the user applies it from the Inbox card, having seen
  // it. Self-improvement is not blocked, only made visible.
  'ai_brain_write',
  'skill_manage',
]);

/**
 * Denylisted tools a run may not even park for confirmation.
 *
 * One tap is enough review for "send Anna this message" — the user reads
 * the message on the card. It is not enough for routine authoring, where
 * the label describes the button and the schedule hides in the arguments.
 */
export const PULSE_PROPOSE_DENYLIST = Object.freeze([
  'pulse_manage',
]);

/**
 * Tools whose results a run may read but never act on unreviewed.
 *
 * Not a denylist — a routine that cannot read feeds is useless. This is
 * what marks a run as having consumed untrusted input, which the run log
 * records so a later review can tell which conclusions to trust.
 */
export const PULSE_UNTRUSTED_INPUT_TOOLS = Object.freeze([
  'web_search',
  'web_read',
  'rss_search_items',
  'rss_read_item',
  'chat_read_recent_messages',
  'chat_search_messages',
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

  // The other ceiling, and the one that decides whether Pulse survives
  // contact with the user. Runs are cheap and most stay silent; what is
  // scarce is attention, and a proactive feature that spends more of it
  // than it returns gets switched off within a couple of weeks rather
  // than tuned. Deliveries that actually interrupt — Inbox, chat — are
  // capped well below the run cap. Journal-only output is not counted:
  // it waits in today's note instead of asking for anything.
  maxDeliveriesPerDay: 4,

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
