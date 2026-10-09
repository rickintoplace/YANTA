/*
  First contact — what a brand-new workspace shows, and when it starts asking
  for things.

  The rule this module enforces: nothing is requested before something has been
  delivered. An empty workspace gets no sync nudge and no install hint; both
  only become reachable once there is content worth keeping. That is the same
  principle the permission-timing literature keeps finding — a prompt fired
  without a preceding user action is granted far less often than the identical
  prompt raised at a moment that makes it make sense.

  What an empty workspace does get instead is three steps with the first one
  already done. Nunes & Drèze (JCR 2006) measured 34% vs 19% task completion
  for the same real effort when a goal is framed as begun-and-unfinished rather
  than not-yet-started; here the head start is genuine rather than staged,
  because a workspace that exists at all already cleared step one.

  Both cards here compete for the dashboard's single ask slot rather than
  rendering themselves — see dashboard-nudges.js. An unfinished step is a
  button, not a status line: a checklist you cannot act on is a report, and a
  report is one more thing to read on a screen that already has too many.
*/

import {
  el,
  lucide,
  state,
  store,
} from './core.js';
import { hasAnyDailyNote } from './journal.js';
import { WELCOME_IDS } from './notes.js';
import { t } from './i18n/index.js';

import {
  dismissDashboardNudge,
  registerDashboardNudge,
} from './dashboard-nudges.js';

const WELCOME_NOTE_IDS = new Set(Object.values(WELCOME_IDS.notes));

const DURABILITY_DISMISSED_KEY = 'yanta.firstContact.durabilityNoticeDismissed.v1';
const STEPS_DISMISSED_KEY = 'yanta.firstContact.stepsDismissed.v1';

// Enough content that losing it would actually hurt.
const DURABILITY_NOTE_THRESHOLD = 3;

let cssInjected = false;

function injectCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-first-contact-css';
  style.textContent = `
.yanta-fc {
  display: flex;
  align-items: flex-start;
  gap: 14px;

  padding: 14px 16px;
  margin-bottom: 14px;

  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);
}

.yanta-fc-icon {
  flex: none;
  display: grid;
  place-items: center;

  width: 36px;
  height: 36px;
  border-radius: 10px;

  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.yanta-fc-main { flex: 1 1 auto; min-width: 0; }

.yanta-fc-title {
  font-weight: 600;
  margin-bottom: 3px;
}

.yanta-fc-sub {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.5;
}

.yanta-fc-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 11px;
  padding: 0;
  list-style: none;
}

/*
  Rows are <span> when done and <button> when actionable, so the shared
  box model lives on the li and only the affordances differ.
*/
.yanta-fc-steps li > * {
  display: inline-flex;
  align-items: center;
  gap: 7px;

  margin: -4px -8px;
  padding: 4px 8px;

  border: 0;
  border-radius: 8px;
  background: transparent;

  font: inherit;
  font-size: 13px;
  color: var(--text-dim);
  text-align: left;
}

.yanta-fc-steps li[data-done="1"] > * {
  color: var(--text);
}

.yanta-fc-steps li[data-done="1"] .yanta-fc-step-mark {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast, #fff);
}

.yanta-fc-steps li > button {
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.yanta-fc-steps li > button:hover,
.yanta-fc-steps li > button:focus-visible {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yanta-fc-steps li > button:hover .yanta-fc-step-mark,
.yanta-fc-steps li > button:focus-visible .yanta-fc-step-mark {
  border-color: var(--accent);
}

/* Points at the action, and only on the rows that have one. */
.yanta-fc-step-go {
  color: var(--accent);
  opacity: 0;
  transition: opacity 120ms ease;
}

.yanta-fc-steps li > button:hover .yanta-fc-step-go,
.yanta-fc-steps li > button:focus-visible .yanta-fc-step-go {
  opacity: 1;
}

.yanta-fc-step-mark {
  flex: none;
  display: grid;
  place-items: center;

  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  color: transparent;
}

.yanta-fc-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.yanta-fc-dismiss {
  display: grid;
  place-items: center;

  width: 30px;
  height: 30px;

  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}

.yanta-fc-dismiss:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}

@media (max-width: 620px) {
  .yanta-fc { flex-wrap: wrap; }
}
  `;

  document.head.appendChild(style);
}

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {}
}

/*
  What counts as the user's own content.

  A brand-new YANTA is NOT empty — it seeds a Welcome folder with two demo
  notes and a whole AI Brain tree of system notes. Measured, not assumed: a
  fresh profile already reports six notes, so a plain note count would report
  "has content" to every first-time visitor and this whole gate would be
  decorative.

  So: untrashed, not a Welcome seed, and not living under the system tree.
*/
function userNoteCount() {
  let n = 0;

  for (const note of state.notes.values()) {
    if (!note || note.trashed) continue;
    if (WELCOME_NOTE_IDS.has(note.id)) continue;
    if (String(note.id || '').startsWith('system_')) continue;
    if (String(note.folderId || '').startsWith('system_')) continue;

    n += 1;
  }

  return n;
}

/**
 * True once the workspace holds something the user put there. Everything that
 * asks for a commitment — sync, install — must wait for this.
 */
export function workspaceHasContent() {
  return userNoteCount() > 0;
}

async function syncSettled() {
  try {
    const [decided, provider] = await Promise.all([
      store.settings.get('onboarding.storageChoice.v1', null),
      store.settings.get('sync2.provider', null),
    ]);

    return decided === 'done' || !!provider;
  } catch {
    return true;
  }
}

/**
 * One checklist row. Done rows are inert text; an open row with an action
 * is a button, so the checklist is the way forward rather than a report
 * about one.
 */
function stepRow({ label, done, onClick }) {
  const li = el('li', { dataset: { done: done ? '1' : '0' } });

  const mark = el('span', { class: 'yanta-fc-step-mark' });
  mark.innerHTML = lucide('check', 11);

  const text = el('span', {}, label);

  if (done || !onClick) {
    li.append(el('span', {}, mark, text));
    return li;
  }

  const go = el('span', { class: 'yanta-fc-step-go' });
  go.innerHTML = lucide('arrow-right', 13);

  li.append(el('button', { type: 'button', onclick: onClick }, mark, text, go));

  return li;
}

/**
 * Three first steps, shown only while they are unfinished. Disappears by
 * itself once everything is done, and can be dismissed before that.
 *
 * While this card is up it is the *only* ask on the dashboard: its third
 * step is the sync question, so the sync cards below it in the priority
 * order would only repeat what it already says.
 *
 * Every step is a one-way door. The capture step in particular asks whether
 * the user has *ever* captured, not whether they captured today — the daily
 * question un-ticked itself at midnight and brought the whole card back to
 * someone who had been using quick capture for a week. And completing the
 * last step writes the dismissed flag, so no later state change can make
 * a finished checklist reappear.
 */
async function buildFirstSteps({ onSetUpSync, onCapture } = {}) {
  if (readFlag(STEPS_DISMISSED_KEY)) return null;

  const notes = userNoteCount();
  if (notes === 0) return null;

  const [captured, settled] = await Promise.all([
    hasAnyDailyNote().catch(() => false),
    syncSettled(),
  ]);

  const done = [notes > 0, captured, settled];
  const doneCount = done.filter(Boolean).length;

  // All done — retire the card for good rather than leaving it eligible.
  if (doneCount === done.length) {
    writeFlag(STEPS_DISMISSED_KEY);
    return null;
  }

  injectCss();

  const card = el('div', { class: 'yanta-fc' });

  const icon = el('div', { class: 'yanta-fc-icon' });
  icon.innerHTML = lucide('sparkles', 19);

  const steps = el('ul', { class: 'yanta-fc-steps' });

  steps.append(
    stepRow({ label: t('firstContact.steps.hasNote'), done: done[0] }),
    stepRow({ label: t('firstContact.steps.capture'), done: done[1], onClick: onCapture }),
    stepRow({ label: t('firstContact.steps.sync'), done: done[2], onClick: onSetUpSync }),
  );

  const main = el('div', { class: 'yanta-fc-main' });

  main.append(
    el('div', { class: 'yanta-fc-title' }, t('firstContact.steps.title', { count: doneCount })),
    el('div', { class: 'yanta-fc-sub' }, t('firstContact.steps.subtitle', { count: done.length - doneCount })),
    steps,
  );

  const dismiss = el('button', {
    class: 'yanta-fc-dismiss',
    type: 'button',
    title: t('firstContact.steps.hide'),
    'aria-label': t('firstContact.steps.hide'),
    onclick: () => {
      writeFlag(STEPS_DISMISSED_KEY);
      dismissDashboardNudge(card);
    },
  });

  dismiss.innerHTML = lucide('x', 16);

  card.append(icon, main, el('div', { class: 'yanta-fc-actions' }, dismiss));

  return card;
}

/**
 * The honest durability notice: local-only data survives everything except
 * the user clearing it or losing the device.
 *
 * Timing is the whole point — it appears once there is enough to lose, not on
 * an empty first screen where it would be an unearned scare.
 */
async function buildDurabilityNotice({ onSetUpSync } = {}) {
  if (readFlag(DURABILITY_DISMISSED_KEY)) return null;

  const notes = userNoteCount();
  const hasEvents = (state.calendarEvents?.size || 0) > 0;

  if (notes < DURABILITY_NOTE_THRESHOLD && !hasEvents) return null;

  if (await syncSettled()) return null;

  injectCss();

  const card = el('div', { class: 'yanta-fc' });

  /*
    Deliberately not "your data can vanish at any time". main.js already calls
    navigator.storage.persist(), so the browser does not evict this on its own.
    The real exposure is narrower — and overstating it would cost more trust
    than the extra urgency is worth.
  */
  const icon = el('div', { class: 'yanta-fc-icon' });
  icon.innerHTML = lucide('hard-drive', 19);

  const main = el('div', { class: 'yanta-fc-main' });

  main.append(
    el('div', { class: 'yanta-fc-title' }, t('firstContact.durability.title')),
    el('div', { class: 'yanta-fc-sub' }, t('firstContact.durability.body')),
  );

  const cta = el('button', {
    class: 'btn primary',
    type: 'button',
    onclick: () => onSetUpSync?.(),
  }, t('firstContact.durability.cta'));

  const dismiss = el('button', {
    class: 'yanta-fc-dismiss',
    type: 'button',
    title: t('firstContact.durability.dismiss'),
    'aria-label': t('firstContact.durability.dismiss'),
    onclick: () => {
      writeFlag(DURABILITY_DISMISSED_KEY);
      dismissDashboardNudge(card);
    },
  });

  dismiss.innerHTML = lucide('x', 16);

  card.append(icon, main, el('div', { class: 'yanta-fc-actions' }, cta, dismiss));

  return card;
}

/*
  Priority in the shared ask slot. The checklist outranks both sync cards
  because it already contains the sync question as its third step; the
  longer durability copy outranks the short nudge because it only becomes
  eligible once there is genuinely enough to lose.
*/
registerDashboardNudge({
  id: 'first-steps',
  order: 10,
  build: buildFirstSteps,
});

registerDashboardNudge({
  id: 'durability',
  order: 20,
  build: buildDurabilityNotice,
});
