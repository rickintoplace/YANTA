// ============================================================
// YANTA Dashboard — personal greeting
//
// Replaces the static "Notes" title on the dashboard root with a
// time-aware greeting. The name comes from the user's own setting
// first, then falls back to their Matrix profile; without either,
// nameless variants are used. One greeting is picked per session so
// the title doesn't shuffle on every re-render.
// ============================================================

import { isChatEnabled } from './chat/chat-enabled.js';
import { store } from './core.js';
import { yantaPrompt } from './dialogs.js';
import { getLocale, tList } from './i18n/index.js';

export const DISPLAY_NAME_SETTING = 'user.displayName';

/*
  Warum ein Cache: Die Matrix-Session startet erst Sekunden nach dem ersten
  Dashboard-Render (idle auto-resume + sync). Ohne Cache bliebe das Greeting
  bei jedem Boot namenlos, obwohl der Matrix-Name bekannt ist.
*/
const MATRIX_NAME_CACHE_SETTING = 'chat.displayNameCache';

// The greetings live in the locale catalogs (src/i18n/locales/greeting/):
// each language has its own lists, with its own wordplay. "{name}" is
// optional in every entry; without a known name the name segment is
// stripped, punctuation intact.

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function timeOfDayKey(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 13) return 'midday';
  if (hour >= 13 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function localWeekday(date) {
  try {
    return date.toLocaleDateString(getLocale(), { weekday: 'long' });
  } catch {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }
}

function fillName(template, name) {
  if (name) {
    return template.replace('{name}', name);
  }

  // Strip the name segment but keep trailing punctuation:
  // "Back at it, {name}" -> "Back at it" · "…oil, {name}?" -> "…oil?"
  return template
    // Japanese: "…、{name}さん" loses the honorific along with the name.
    .replace(/[,、\s]*\{name\}(さん)?/, '')
    .replace(/\s+([?!.])/, '$1');
}

// One template per session; the resolved name may still arrive async.
let sessionTemplate = '';

function pickTemplate() {
  if (sessionTemplate) return sessionTemplate;

  const now = new Date();

  const pool = [
    ...tList(`greeting.${timeOfDayKey(now.getHours())}`),
    ...tList('greeting.generic'),
    ...tList('greeting.puns'),
    ...tList('greeting.weekdayGeneric'),
    ...tList(`greeting.${WEEKDAY_KEYS[now.getDay()]}`),
  ];

  if (!pool.length) return 'YANTA';

  sessionTemplate = pool[Math.floor(Math.random() * pool.length)]
    .replaceAll('{weekday}', localWeekday(now));

  return sessionTemplate;
}

async function matrixDisplayName() {
  // Chat is off: don't load the chat stack (and the Matrix SDK) for a name.
  if (!isChatEnabled()) return '';

  try {
    const { resolveMatrixClient } = await import('./chat/chat-actions.js');
    const client = await resolveMatrixClient();
    const userId = client?.getUserId?.();

    if (!userId) return '';

    const user = client.getUser?.(userId);
    const display = user?.displayName || user?.rawDisplayName || '';

    if (display && display !== userId) return display;

    return userId.replace(/^@/, '').split(':')[0] || '';
  } catch {
    return '';
  }
}

/**
 * Name priority: user-chosen display name > Matrix profile name
 * (live, falling back to the cached value from an earlier session) > none.
 */
export async function resolveGreetingName() {
  try {
    const custom = String(await store.settings.get(DISPLAY_NAME_SETTING, '') || '').trim();
    if (custom) return custom;
  } catch {}

  const live = await matrixDisplayName();

  if (live) {
    store.settings.set(MATRIX_NAME_CACHE_SETTING, live).catch(() => {});
    return live;
  }

  try {
    return String(await store.settings.get(MATRIX_NAME_CACHE_SETTING, '') || '').trim();
  } catch {
    return '';
  }
}

let cachedGreeting = '';
let lastOnUpdate = null;
let chatReadyHooked = false;

function refreshGreeting() {
  const template = pickTemplate();

  resolveGreetingName()
    .then((name) => {
      const next = fillName(template, name);

      if (next !== cachedGreeting) {
        cachedGreeting = next;
        lastOnUpdate?.(next);
      }
    })
    .catch(() => {});
}

/**
 * Synchronous accessor for render paths: returns the last resolved
 * greeting immediately (a nameless one on first call) and refreshes
 * it in the background via onUpdate.
 */
export function currentGreeting({ onUpdate = null } = {}) {
  const template = pickTemplate();

  if (!cachedGreeting) {
    cachedGreeting = fillName(template, '');
  }

  if (onUpdate) lastOnUpdate = onUpdate;

  if (!chatReadyHooked) {
    chatReadyHooked = true;

    // First Matrix sync mid-session: the profile name just became known.
    window.addEventListener('yanta-chat-ready', refreshGreeting);

    // Chat removed from this device: the Matrix name is no longer known.
    window.addEventListener('yanta-chat-deprovisioned', () => {
      store.settings.set(MATRIX_NAME_CACHE_SETTING, '').catch(() => {});
      refreshGreeting();
    });
  }

  refreshGreeting();

  return cachedGreeting;
}

/**
 * Let the user pick the name greetings address them by.
 * Returns true when the setting changed.
 */
export async function editGreetingDisplayName() {
  const current = String(await store.settings.get(DISPLAY_NAME_SETTING, '') || '');

  const next = await yantaPrompt({
    title: 'Display name',
    message: 'Used for the dashboard greeting. Leave empty to use your chat profile name.',
    label: 'Name',
    initial: current,
    placeholder: 'e.g. Rick',
  });

  if (next === null || next === current) return false;

  await store.settings.set(DISPLAY_NAME_SETTING, String(next).trim());

  // Re-resolve with the new name on the next render.
  cachedGreeting = '';

  return true;
}
