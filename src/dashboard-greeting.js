// ============================================================
// YANTA Dashboard — personal greeting
//
// Replaces the static "Notes" title on the dashboard root with a
// time-aware greeting. The name comes from the user's own setting
// first, then falls back to their Matrix profile; without either,
// nameless variants are used. One greeting is picked per session so
// the title doesn't shuffle on every re-render.
// ============================================================

import { store } from './core.js';
import { yantaPrompt } from './dialogs.js';

export const DISPLAY_NAME_SETTING = 'user.displayName';

/*
  Warum ein Cache: Die Matrix-Session startet erst Sekunden nach dem ersten
  Dashboard-Render (idle auto-resume + sync). Ohne Cache bliebe das Greeting
  bei jedem Boot namenlos, obwohl der Matrix-Name bekannt ist.
*/
const MATRIX_NAME_CACHE_SETTING = 'chat.displayNameCache';

// "{name}" is optional in every template: without a known name the
// ", {name}" (or " {name}") segment is stripped, punctuation intact.
const GREETINGS = {
  morning: [
    'Good morning, {name}',
    'Morning, {name}',
    'Rise and write, {name}',
    'Fresh page, fresh day, {name}',
    'Morning, {name} — coffee and notes?',
    'Sun’s up, notes out',
    'Fresh page energy',
    'Fresh brew, fresh view',
    'Early bird vibes, {name}?',
    'Awake and aware, {name}',
    'A calm start, {name}',
    'Soft start, clear mind',
    'Morning stillness, {name}',
  ],

  midday: [
    'Good day, {name}',
    'Midday check-in',
    'Pause and breathe, {name}',
    'Midday mindfulness',
  ],
 
  afternoon: [
    'Good afternoon, {name}',
    'Afternoon, {name}',
    'Coffee and YANTA time?',
  ],

  evening: [
    'Good evening, {name}',
    'Evening, {name}',
    'Evening thoughts, {name}?',
    'Wind down and write down',
    'Letting the day settle',
  ],

  night: [
    'Late-night ideas, {name}?',
    'The best notes happen after dark',
    'Midnight muse reporting for duty',
    'Moonlit mindfulness',
    'Rest in stillness, {name}',
  ],

  generic: [
    'Hey there, {name}',
    'Welcome back, {name}',
    'What’s on your mind, {name}?',
    'Good to see you, {name}',
    'It’s note-orious {name}',
    'Notably glad to see you, {name}',
    "Let's get textual",
    'What’s the plan, {name}?',
    'Let’s get down to business',
    'Decrypted and ready',
    'Only you can see this, {name}',
    'Back at it, {name}',
    'Be here now, {name}',
    'A calm mind begins',
    'Present and ready',
    'Mindful {weekday}, {name}',
    'Clarity starts here',
  ],

  puns: [
    'Ready to take note, {name}?',
    'Let’s make today noteworthy, {name}',
    'Your notes missed you, {name}',
    'Duly noted, {name}',
    'Yet another great idea, {name}?',
    'Note bad, huh?',
    'Safe and sound, {name}',
    'Encrypted with love',
    'The cloud can’t read this',
    'Note the moment',
  ],
};

const WEEKDAY_GREETINGS = {
  monday: [
    'Fresh week, fresh notes, {name}',
    'Monday momentum',
    'Start the week strong, {name}',
    'One calm step into the week',
  ],

  tuesday: [
    'Tuesday tune-up',
    'Tiny wins Tuesday',
    'Tuesday is for tidy notes',
  ],

  wednesday: [
    'Midweek momentum',
    'Wednesday check-in',
    'Midweek notes, fresh thoughts',
  ],

  thursday: [
    'Thursday thoughts',
    'One more push before Friday',
    'Make Thursday count',
  ],

  friday: [
    'That Friday feeling',
    'Friday focus, {name}',
    'Finish-line Friday',
    'End the week on a note',
    'Friday notes, weekend loading',
  ],

  saturday: [
    'Happy weekend, {name}',
    'Saturday reset',
    'Weekend mode, {name}',
    'Make space for ideas this Saturday',
  ],

  sunday: [
    'Happy weekend, {name}',
    'Soft landing Sunday',
    'Plan the week gently, {name}',
  ],
};

const WEEKDAY_GENERIC_GREETINGS = [
  'Happy {weekday}, {name}',
  'Make this {weekday} count',
  'Own this {weekday}',
  'A good {weekday} for good notes',
  'Small steps this {weekday}',
  'Make room for ideas this {weekday}',
  'What does this {weekday} need?',
  'Fresh notes for {weekday}',
  'Let’s make {weekday} noteworthy',
  'New thoughts for this {weekday}?',
];

function timeOfDayPool(hour) {
  if (hour >= 5 && hour < 11) return GREETINGS.morning;
  if (hour >= 11 && hour < 13) return GREETINGS.midday;
  if (hour >= 13 && hour < 17) return GREETINGS.afternoon;
  if (hour >= 17 && hour < 22) return GREETINGS.evening;
  return GREETINGS.night;
}

function weekdayGreetingPool(date) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const key = weekday.toLowerCase();

  return [
    ...WEEKDAY_GENERIC_GREETINGS.map((template) =>
      template.replaceAll('{weekday}', weekday)
    ),
    ...(WEEKDAY_GREETINGS[key] || []),
  ];
}

function fillName(template, name) {
  if (name) {
    return template.replace('{name}', name);
  }

  // Strip the name segment but keep trailing punctuation:
  // "Back at it, {name}" -> "Back at it" · "…oil, {name}?" -> "…oil?"
  return template
    .replace(/[,\s]*\{name\}/, '')
    .replace(/\s+([?!.])/, '$1');
}

// One template per session; the resolved name may still arrive async.
let sessionTemplate = '';

function pickTemplate() {
  if (sessionTemplate) return sessionTemplate;

  const now = new Date();

  const pool = [
    ...timeOfDayPool(now.getHours()),
    ...GREETINGS.generic,
    ...GREETINGS.puns,
    ...weekdayGreetingPool(now),
  ];

  // Templates outside the weekday pools may use {weekday} too.
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  sessionTemplate = pool[Math.floor(Math.random() * pool.length)]
    .replaceAll('{weekday}', weekday);

  return sessionTemplate;
}

async function matrixDisplayName() {
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
