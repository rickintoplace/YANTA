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
*/

import {
  el,
  lucide,
  state,
  store,
} from './core.js';
import { findTodayNote } from './journal.js';
import { WELCOME_IDS } from './notes.js';

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

.yanta-fc-steps li {
  display: inline-flex;
  align-items: center;
  gap: 7px;

  font-size: 13px;
  color: var(--text-dim);
}

.yanta-fc-steps li[data-done="1"] {
  color: var(--text);
}

.yanta-fc-steps li[data-done="1"] .yanta-fc-step-mark {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.yanta-fc-step-mark {
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

function stepMarkup(label, done) {
  return `
    <li data-done="${done ? '1' : '0'}">
      <span class="yanta-fc-step-mark">${lucide('check', 11)}</span>
      <span>${label}</span>
    </li>
  `;
}

/**
 * Three first steps, shown only while they are unfinished. Disappears by
 * itself once everything is done, and can be dismissed before that.
 */
export async function renderFirstStepsInto(host) {
  if (!host || readFlag(STEPS_DISMISSED_KEY)) return;

  const notes = userNoteCount();
  if (notes === 0) return;

  const [today, settled] = await Promise.all([
    findTodayNote().catch(() => null),
    syncSettled(),
  ]);

  // All done — nothing to nudge about, and no card to look at.
  if (notes > 0 && today && settled) return;

  if (host.isConnected === false) return;

  injectCss();

  const card = el('div', { class: 'yanta-fc' });

  card.innerHTML = `
    <div class="yanta-fc-icon">${lucide('sparkles', 19)}</div>

    <div class="yanta-fc-main">
      <div class="yanta-fc-title">You are one step in</div>
      <div class="yanta-fc-sub">Two more and YANTA is yours.</div>

      <ul class="yanta-fc-steps">
        ${stepMarkup('Your workspace has a note', notes > 0)}
        ${stepMarkup('Capture a thought of your own', !!today)}
        ${stepMarkup('Keep it across your devices', settled)}
      </ul>
    </div>

    <div class="yanta-fc-actions">
      <button class="yanta-fc-dismiss" type="button" data-fc-dismiss-steps
        title="Hide this" aria-label="Hide this">
        ${lucide('x', 16)}
      </button>
    </div>
  `;

  card.querySelector('[data-fc-dismiss-steps]')?.addEventListener('click', () => {
    writeFlag(STEPS_DISMISSED_KEY);
    card.remove();
  });

  host.append(card);
}

/**
 * The honest durability notice: local-only data survives everything except
 * the user clearing it or losing the device.
 *
 * Timing is the whole point — it appears once there is enough to lose, not on
 * an empty first screen where it would be an unearned scare.
 */
export async function renderDurabilityNoticeInto(host, { onSetUpSync } = {}) {
  if (!host || readFlag(DURABILITY_DISMISSED_KEY)) return;

  const notes = userNoteCount();
  const hasEvents = (state.calendarEvents?.size || 0) > 0;

  if (notes < DURABILITY_NOTE_THRESHOLD && !hasEvents) return;

  if (await syncSettled()) return;
  if (host.isConnected === false) return;

  injectCss();

  const card = el('div', { class: 'yanta-fc' });

  /*
    Deliberately not "your data can vanish at any time". main.js already calls
    navigator.storage.persist(), so the browser does not evict this on its own.
    The real exposure is narrower — and overstating it would cost more trust
    than the extra urgency is worth.
  */
  card.innerHTML = `
    <div class="yanta-fc-icon">${lucide('hard-drive', 19)}</div>

    <div class="yanta-fc-main">
      <div class="yanta-fc-title">This all lives on this device only</div>
      <div class="yanta-fc-sub">
        Nothing here is uploaded, which is the point — but it also means that
        clearing your browser data, or losing this device, takes it with it.
        Sync keeps an encrypted copy that only you can read, and puts your
        notes on your other devices.
      </div>
    </div>

    <div class="yanta-fc-actions">
      <button class="btn primary" type="button" data-fc-sync>Set up sync</button>
      <button class="yanta-fc-dismiss" type="button" data-fc-dismiss
        title="Not now" aria-label="Not now">
        ${lucide('x', 16)}
      </button>
    </div>
  `;

  card.querySelector('[data-fc-dismiss]')?.addEventListener('click', () => {
    writeFlag(DURABILITY_DISMISSED_KEY);
    card.remove();
  });

  card.querySelector('[data-fc-sync]')?.addEventListener('click', () => {
    onSetUpSync?.();
  });

  host.append(card);
}
