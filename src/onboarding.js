// ============================================================
// YANTA — First-run onboarding
//
// A calm, capture-first welcome. The very first screen asks for
// exactly one thing: a thought. Only after that first capture —
// the aha moment — do we surface the storage choice
// (Local / YANTA Cloud / Bring-your-own).
//
// Design intent: YANTA is local-first, so the storage decision is
// non-destructive and reversible. It must never block the first
// use. Local is the default; Cloud/BYO are opt-in upgrades that
// layer sync on top and can be enabled here or anytime in Settings.
// ============================================================

import {
  el,
  lucide,
  toast,
  store,
  escapeHtml,
} from './core.js';

import { captureToJournal } from './journal.js';

const ONBOARDING_FLAG = 'onboarding.v1';

let overlay = null;
let resolveRun = null;
let prevBodyOverflow = '';

function injectCss() {
  if (document.getElementById('yanta-onboarding-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-onboarding-css';
  style.textContent = `
.yanta-onb {
  position: fixed;
  inset: 0;
  z-index: 400;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 24px;

  background:
    radial-gradient(circle at 50% -10%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 55%),
    color-mix(in srgb, var(--bg) 82%, black);
  backdrop-filter: blur(6px);

  animation: yanta-onb-fade 200ms ease;
}

.yanta-onb[hidden] {
  display: none !important;
}

.yanta-onb-card {
  width: min(560px, 100%);
  max-height: 92vh;
  overflow-y: auto;

  padding: 32px 28px 24px;

  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 22px;
  box-shadow: var(--shadow);

  animation: yanta-onb-rise 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

.yanta-onb-hero-icon {
  width: 52px;
  height: 52px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 18px;
}

.yanta-onb-title {
  margin: 18px 0 6px;

  color: var(--text);
  font-size: 22px;
  font-weight: 760;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.yanta-onb-sub {
  margin: 0;

  color: var(--text-dim);
  font-size: 14.5px;
  line-height: 1.5;
}

/* ---- Step 1: capture ---- */

.yanta-onb-capture {
  display: flex;
  align-items: center;
  gap: 8px;

  margin-top: 22px;
  padding: 6px 6px 6px 16px;

  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: 14px;

  transition: border-color 140ms ease;
}

.yanta-onb-capture:focus-within {
  border-color: var(--accent);
}

.yanta-onb-capture input {
  flex: 1;
  min-width: 0;

  padding: 10px 0;

  background: none;
  border: none;
  outline: none;

  color: var(--text);
  font: inherit;
  font-size: 15.5px;
}

.yanta-onb-send {
  flex: 0 0 auto;

  width: 40px;
  height: 40px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: white;
  background: var(--accent);
  border: none;
  border-radius: 10px;

  cursor: pointer;
  transition: opacity 140ms ease, transform 120ms ease;
}

.yanta-onb-send:hover {
  transform: translateY(-1px);
}

.yanta-onb-send:disabled {
  opacity: 0.45;
  cursor: default;
  transform: none;
}

/* ---- Step 2: storage chooser ---- */

.yanta-onb-saved {
  display: inline-flex;
  align-items: center;
  gap: 7px;

  margin-bottom: 4px;

  color: var(--green);
  font-size: 13px;
  font-weight: 650;
}

.yanta-onb-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;

  margin: 20px 0 16px;
}

.yanta-onb-choice {
  display: flex;
  align-items: flex-start;
  gap: 13px;

  width: 100%;
  padding: 14px 15px;
  text-align: left;

  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: 14px;

  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}

.yanta-onb-choice:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.yanta-onb-choice[aria-checked="true"] {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}

.yanta-onb-choice-icon {
  flex: 0 0 auto;

  width: 38px;
  height: 38px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 11px;
}

.yanta-onb-choice-main {
  flex: 1;
  min-width: 0;
}

.yanta-onb-choice-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.yanta-onb-choice-title {
  color: var(--text);
  font-size: 14.5px;
  font-weight: 700;
}

.yanta-onb-badge {
  padding: 2px 7px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 999px;

  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.yanta-onb-badge.muted {
  color: var(--text-faint);
  background: var(--bg-elev-2);
}

.yanta-onb-choice-desc {
  margin: 3px 0 0;

  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.45;
}

.yanta-onb-choice-check {
  flex: 0 0 auto;

  align-self: center;

  color: var(--accent);
  opacity: 0;
  transition: opacity 120ms ease;
}

.yanta-onb-choice[aria-checked="true"] .yanta-onb-choice-check {
  opacity: 1;
}

.yanta-onb-footnote {
  display: flex;
  align-items: flex-start;
  gap: 7px;

  margin: 0 0 18px;

  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-onb-footnote svg {
  flex: 0 0 auto;
  margin-top: 1px;
}

/* ---- shared actions ---- */

.yanta-onb-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.yanta-onb-skip {
  padding: 8px 4px;

  background: none;
  border: none;

  color: var(--text-faint);
  font: inherit;
  font-size: 13px;

  cursor: pointer;
}

.yanta-onb-skip:hover {
  color: var(--text-dim);
}

.yanta-onb-spacer {
  flex: 1;
}

.yanta-onb-primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;

  padding: 10px 18px;

  color: white;
  background: var(--accent);
  border: none;
  border-radius: 11px;

  font: inherit;
  font-size: 14px;
  font-weight: 650;

  cursor: pointer;
  transition: transform 120ms ease, opacity 140ms ease;
}

.yanta-onb-primary:hover {
  transform: translateY(-1px);
}

@keyframes yanta-onb-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes yanta-onb-rise {
  from { opacity: 0; transform: translateY(12px) scale(0.985); }
  to { opacity: 1; transform: none; }
}

@media (max-width: 520px) {
  .yanta-onb-card {
    padding: 26px 20px 20px;
  }

  .yanta-onb-title {
    font-size: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .yanta-onb,
  .yanta-onb-card {
    animation: none;
  }

  .yanta-onb-send:hover,
  .yanta-onb-primary:hover {
    transform: none;
  }
}
`;

  document.head.append(style);
}

function ensureOverlay() {
  if (overlay) return overlay;

  injectCss();

  overlay = el('div', {
    class: 'yanta-onb',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Welcome to YANTA',
    hidden: true,
  });

  // Escape skips onboarding entirely (Local default) — never a trap.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish('skip');
    }
  });

  document.body.append(overlay);

  return overlay;
}

function open() {
  const m = ensureOverlay();

  prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  m.hidden = false;
}

async function finish(choice) {
  // Idempotent: the first resolve wins; later calls (e.g. a stray
  // Escape after Continue) are ignored.
  const resolve = resolveRun;
  resolveRun = null;

  try {
    await store.settings.set(ONBOARDING_FLAG, 'done');
  } catch (err) {
    console.warn('[YANTA onboarding] could not persist flag', err);
  }

  if (overlay) {
    overlay.hidden = true;
    overlay.replaceChildren();
  }

  document.body.style.overflow = prevBodyOverflow;

  // Cloud / BYO setup opens on the next tick, so the dashboard the
  // caller renders after we resolve is already underneath it.
  if (choice === 'cloud' || choice === 'byo') {
    setTimeout(() => openStorageSetup(choice), 0);
  }

  if (typeof resolve === 'function') resolve({ choice });
}

async function openStorageSetup(choice) {
  try {
    if (choice === 'cloud') {
      const { openYantaCloudSetup } = await import('./sync2/yanta-cloud-setup-ui.js');
      await openYantaCloudSetup();
    } else if (choice === 'byo') {
      const { openGoogleDriveSyncSetup } = await import('./sync2/sync-setup-ui.js');
      openGoogleDriveSyncSetup();
    }
  } catch (err) {
    console.warn('[YANTA onboarding] could not open storage setup', err);
    toast('Could not open sync setup. You can enable it anytime in Settings.', 'error');
  }
}

function renderCaptureStep() {
  const card = el('div', { class: 'yanta-onb-card' });

  card.innerHTML = `
    <div class="yanta-onb-hero-icon">${lucide('feather', 26)}</div>

    <h2 class="yanta-onb-title">Think out loud.<br>YANTA keeps it in order.</h2>
    <p class="yanta-onb-sub">
      Every quick thought lands in today’s note — searchable, linkable, yours.
      Start with just one.
    </p>

    <div class="yanta-onb-capture">
      <input
        type="text"
        data-onb-input
        placeholder="What’s on your mind right now?"
        autocomplete="off"
        autocapitalize="sentences"
        spellcheck="false"
        maxlength="280" />

      <button class="yanta-onb-send" data-onb-capture type="button" title="Capture" disabled>
        ${lucide('arrow-right', 18)}
      </button>
    </div>

    <div class="yanta-onb-actions" style="margin-top: 18px;">
      <button class="yanta-onb-skip" data-onb-skip type="button">Skip for now</button>
      <span class="yanta-onb-spacer"></span>
    </div>
  `;

  overlay.replaceChildren(card);

  const input = card.querySelector('[data-onb-input]');
  const sendBtn = card.querySelector('[data-onb-capture]');

  const refresh = () => {
    sendBtn.disabled = !input.value.trim();
  };

  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;

    sendBtn.disabled = true;
    input.disabled = true;

    try {
      await captureToJournal(text, { source: 'onboarding' });
    } catch (err) {
      console.warn('[YANTA onboarding] first capture failed', err);
      input.disabled = false;
      refresh();
      toast('Could not save that just now — try again.', 'error');
      input.focus();
      return;
    }

    renderChooseStep({ captured: true });
  };

  input.addEventListener('input', refresh);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  sendBtn.addEventListener('click', submit);

  card.querySelector('[data-onb-skip]')?.addEventListener('click', () => finish('skip'));

  setTimeout(() => input.focus(), 60);
}

const STORAGE_CHOICES = [
  {
    id: 'local',
    icon: 'hard-drive',
    title: 'On this device',
    badge: { label: 'Default', muted: true },
    desc: 'No account, nothing to set up. Private by default — your notes never leave this device.',
  },
  {
    id: 'cloud',
    icon: 'cloud',
    title: 'YANTA Cloud',
    badge: { label: 'Recommended', muted: false },
    desc: 'Sync across all your devices, end-to-end encrypted. We only ever store encrypted objects.',
  },
  {
    id: 'byo',
    icon: 'folder-sync',
    title: 'Your own Google Drive',
    badge: { label: 'Advanced', muted: true },
    desc: 'Bring your own storage. Encrypted sync runs through a Drive folder you fully control.',
  },
];

function renderChooseStep({ captured = false } = {}) {
  const card = el('div', { class: 'yanta-onb-card' });

  const savedBanner = captured
    ? `<div class="yanta-onb-saved">${lucide('check-circle-2', 15)} Saved to today’s note</div>`
    : '';

  const cardsHtml = STORAGE_CHOICES.map((c, i) => `
    <div
      class="yanta-onb-choice"
      role="radio"
      tabindex="${i === 0 ? '0' : '-1'}"
      aria-checked="${i === 0 ? 'true' : 'false'}"
      data-onb-choice="${c.id}">
      <div class="yanta-onb-choice-icon">${lucide(c.icon, 19)}</div>

      <div class="yanta-onb-choice-main">
        <div class="yanta-onb-choice-head">
          <span class="yanta-onb-choice-title">${escapeHtml(c.title)}</span>
          <span class="yanta-onb-badge${c.badge.muted ? ' muted' : ''}">${escapeHtml(c.badge.label)}</span>
        </div>
        <p class="yanta-onb-choice-desc">${escapeHtml(c.desc)}</p>
      </div>

      <span class="yanta-onb-choice-check">${lucide('check-circle-2', 18)}</span>
    </div>
  `).join('');

  card.innerHTML = `
    ${savedBanner}

    <h2 class="yanta-onb-title">Where should your notes live?</h2>
    <p class="yanta-onb-sub">Pick a starting point — this isn’t permanent.</p>

    <div class="yanta-onb-cards" role="radiogroup" aria-label="Storage location">
      ${cardsHtml}
    </div>

    <p class="yanta-onb-footnote">
      ${lucide('shield-check', 14)}
      <span>You can change this anytime in Settings — your notes stay put when you do.</span>
    </p>

    <div class="yanta-onb-actions">
      <button class="yanta-onb-skip" data-onb-later type="button">Not now</button>
      <span class="yanta-onb-spacer"></span>
      <button class="yanta-onb-primary" data-onb-continue type="button">
        Continue
        ${lucide('arrow-right', 16)}
      </button>
    </div>
  `;

  overlay.replaceChildren(card);

  const choices = [...card.querySelectorAll('[data-onb-choice]')];
  let selected = 'local';

  const select = (id) => {
    selected = id;

    for (const node of choices) {
      const isMatch = node.dataset.onbChoice === id;
      node.setAttribute('aria-checked', isMatch ? 'true' : 'false');
      node.tabIndex = isMatch ? 0 : -1;
    }
  };

  choices.forEach((node, i) => {
    node.addEventListener('click', () => select(node.dataset.onbChoice));

    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(node.dataset.onbChoice);
        return;
      }

      // Roving focus within the radio group.
      let next = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % choices.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + choices.length) % choices.length;

      if (next >= 0) {
        e.preventDefault();
        const node2 = choices[next];
        select(node2.dataset.onbChoice);
        node2.focus();
      }
    });
  });

  card.querySelector('[data-onb-continue]')?.addEventListener('click', () => finish(selected));
  card.querySelector('[data-onb-later]')?.addEventListener('click', () => finish('local'));
}

/**
 * Runs the first-run onboarding overlay. Resolves once the user has
 * finished or skipped — the caller then renders the dashboard, with any
 * Cloud/BYO setup layering on top.
 *
 * Resolves to `{ choice }` where choice is one of
 * 'local' | 'cloud' | 'byo' | 'skip'.
 */
export function runFirstRunOnboarding() {
  return new Promise((resolve) => {
    resolveRun = resolve;
    open();
    renderCaptureStep();
  });
}

/** Whether the first-run onboarding has already been completed/skipped. */
export async function hasCompletedOnboarding() {
  try {
    return (await store.settings.get(ONBOARDING_FLAG, null)) === 'done';
  } catch {
    return false;
  }
}
