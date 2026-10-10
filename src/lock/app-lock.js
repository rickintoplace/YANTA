// ============================================================
// YANTA — app lock: the lock screen, auto-lock and "remove from this device"
//
// With the lock on, this device shows nothing of the workspace until the
// password (or the recovery key) is entered: at start, after a stretch
// without input, after a while in the background, or when the user locks
// on purpose (sidebar button, Ctrl+Shift+L). Every open tab locks
// together.
//
// What it is today: a lock on the app. The workspace is still stored on
// this device unencrypted (the next step encrypts it with the key the
// password unwraps, lock-keys.js). Settings › Security says so plainly.
// ============================================================

import { el, lucide } from '../core.js';
import { t } from '../i18n/index.js';
import { BRAND_LOGO_SVG } from '../brand-logo.js';
import { extractSyncKeyFromRecoveryInput } from '../sync2/recovery-kit.js';

import {
  forgetUnlockedKey,
  getLockConfig,
  setLockPassword,
  unlockWithPassword,
  unlockWithRecoveryKey,
} from './lock-keys.js';

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('yanta-lock') : null;

let screen = null;
let unlockedWaiters = [];
let failures = 0;
let blockedUntil = 0;
let savedTitle = '';

export function isAppLocked() {
  return !!screen;
}

function setLockedDom(locked) {
  document.documentElement.toggleAttribute('data-locked', locked);
  if (locked) {
    savedTitle = document.title;
    document.title = 'YANTA';
  } else if (savedTitle) {
    document.title = savedTitle;
  }
}

function ensureCss() {
  if (document.getElementById('yanta-lock-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-lock-css';
  style.textContent = `
/* Locked: nothing of the workspace stays visible behind the screen. */
html[data-locked] body > *:not(.yanta-lock-screen) {
  visibility: hidden !important;
}

.yanta-lock-screen {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg, #fff8ef);
  color: var(--text, #29251d);
  font-family: var(--font, system-ui, sans-serif);
}

.yanta-lock-card {
  display: grid;
  gap: 14px;
  width: min(360px, 100%);
  text-align: center;
}

.yanta-lock-logo svg {
  width: 52px;
  height: 52px;
}

.yanta-lock-card h1 {
  margin: 0;
  font-size: 20px;
}

.yanta-lock-card p {
  margin: 0;
  color: var(--text-dim, #625a49);
  font-size: 14px;
  line-height: 1.5;
}

.yanta-lock-card input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 12px;
  background: var(--bg-elev, #f7efd8);
  color: var(--text, #29251d);
  font: inherit;
  font-size: 16px;
}

.yanta-lock-card input:focus {
  outline: 2px solid var(--accent, #8fa31e);
  outline-offset: 1px;
}

.yanta-lock-card .btn.primary {
  justify-content: center;
  min-height: 44px;
  font-size: 15px;
}

.yanta-lock-error {
  min-height: 20px;
  color: var(--red, #c44d48) !important;
}

.yanta-lock-link {
  justify-self: center;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--text-dim, #625a49);
  font: inherit;
  font-size: 13px;
  text-decoration: underline;
  cursor: pointer;
}

.yanta-lock-danger {
  color: var(--red, #c44d48);
}
`;
  document.head.append(style);
}

function waitForUnlock() {
  return new Promise((resolve) => unlockedWaiters.push(resolve));
}

function finishUnlock({ broadcast = true } = {}) {
  screen?.remove();
  screen = null;
  setLockedDom(false);
  failures = 0;

  if (broadcast) channel?.postMessage({ type: 'unlocked' });

  const waiters = unlockedWaiters;
  unlockedWaiters = [];
  waiters.forEach((resolve) => resolve());

  window.dispatchEvent(new CustomEvent('yanta-app-unlocked'));
}

function field(type, label, autocomplete) {
  return el('input', { type, 'aria-label': label, placeholder: label, autocomplete });
}

function renderPasswordStep(card) {
  const input = field('password', t('lock.password'), 'current-password');
  const error = el('p', { class: 'yanta-lock-error', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'btn primary' }, t('lock.unlock'));
  const forgot = el('button', { type: 'button', class: 'yanta-lock-link' }, t('lock.forgot'));

  const form = el('form', { class: 'yanta-lock-card' },
    el('div', { class: 'yanta-lock-logo' }),
    el('h1', {}, t('lock.title')),
    el('p', {}, t('lock.hint')),
    input,
    error,
    submit,
    forgot
  );
  form.querySelector('.yanta-lock-logo').innerHTML = BRAND_LOGO_SVG;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const wait = blockedUntil - Date.now();
    if (wait > 0) {
      error.textContent = t('lock.wait', { seconds: Math.ceil(wait / 1000) });
      return;
    }

    submit.disabled = true;
    error.textContent = '';

    const ok = await unlockWithPassword(input.value);
    submit.disabled = false;

    if (ok) {
      finishUnlock();
      return;
    }

    failures++;
    // A few tries are free; after that each one waits longer (up to a minute).
    if (failures >= 5) blockedUntil = Date.now() + Math.min(60_000, 1000 * 2 ** (failures - 5));
    error.textContent = t('lock.wrong');
    input.select();
  });

  forgot.addEventListener('click', () => renderRecoveryStep(card));

  card.replaceChildren(form);
  requestAnimationFrame(() => input.focus());
}

function renderRecoveryStep(card) {
  const input = el('textarea', { rows: 3, 'aria-label': t('lock.recoveryKey'), placeholder: t('lock.recoveryKey'), autocomplete: 'off', spellcheck: 'false' });
  input.style.cssText = 'width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--bg-elev);color:var(--text);font:inherit;font-family:var(--font-mono, monospace);font-size:14px;resize:none';
  const error = el('p', { class: 'yanta-lock-error', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'btn primary' }, t('lock.useRecovery'));
  const back = el('button', { type: 'button', class: 'yanta-lock-link' }, t('common.back'));
  const wipe = el('button', { type: 'button', class: 'yanta-lock-link yanta-lock-danger' }, t('lock.wipeInstead'));

  const form = el('form', { class: 'yanta-lock-card' },
    el('h1', {}, t('lock.recoveryTitle')),
    el('p', {}, t('lock.recoveryHint')),
    input,
    error,
    submit,
    back,
    wipe
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = extractSyncKeyFromRecoveryInput(input.value);
    submit.disabled = true;

    const ok = await unlockWithRecoveryKey(key);
    submit.disabled = false;

    if (!ok) {
      error.textContent = t('lock.recoveryWrong');
      return;
    }

    renderNewPasswordStep(card, key);
  });

  back.addEventListener('click', () => renderPasswordStep(card));
  wipe.addEventListener('click', () => renderWipeStep(card));

  card.replaceChildren(form);
  requestAnimationFrame(() => input.focus());
}

/*
  The last way out when neither the password nor the recovery key is at
  hand. Rendered inside the lock screen: nothing behind it may show, not
  even a confirmation dialog.
*/
function renderWipeStep(card) {
  const synced = !!window.yantaSync2?.engine;
  const confirm = el('button', { type: 'button', class: 'btn primary', style: { background: 'var(--red, #c44d48)', borderColor: 'transparent' } }, t('lock.wipeConfirm'));
  const back = el('button', { type: 'button', class: 'yanta-lock-link' }, t('common.back'));

  const box = el('div', { class: 'yanta-lock-card' },
    el('h1', {}, t('lock.wipeTitle')),
    el('p', {}, synced ? t('lock.wipeMessageSynced') : t('lock.wipeMessageLocal')),
    confirm,
    back
  );

  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    confirm.textContent = t('lock.wiping');
    const { wipeThisDevice } = await import('./wipe-device.js');
    // Locked means no one proved they may push this device's changes: no final sync.
    await wipeThisDevice({ syncFirst: false });
  });

  back.addEventListener('click', () => renderRecoveryStep(card));
  card.replaceChildren(box);
}

function renderNewPasswordStep(card, syncKey) {
  const first = field('password', t('lock.newPassword'), 'new-password');
  const second = field('password', t('lock.repeatPassword'), 'new-password');
  const error = el('p', { class: 'yanta-lock-error', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'btn primary' }, t('lock.saveAndUnlock'));

  const form = el('form', { class: 'yanta-lock-card' },
    el('h1', {}, t('lock.newPasswordTitle')),
    first,
    second,
    error,
    submit
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (first.value.length < 6) { error.textContent = t('lock.tooShort'); return; }
    if (first.value !== second.value) { error.textContent = t('lock.mismatch'); return; }

    submit.disabled = true;
    await setLockPassword(first.value, { syncKey });
    finishUnlock();
  });

  card.replaceChildren(form);
  requestAnimationFrame(() => first.focus());
}

/** Shows the lock screen (if not already) and resolves once unlocked. */
export function showLockScreen() {
  if (screen) return waitForUnlock();

  ensureCss();
  forgetUnlockedKey();

  screen = el('div', { class: 'yanta-lock-screen', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('lock.title') });
  const card = el('div');
  screen.append(card);
  document.body.append(screen);
  setLockedDom(true);

  // Whatever had focus behind the screen must not keep taking keys.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();

  renderPasswordStep(card);
  window.dispatchEvent(new CustomEvent('yanta-app-locked'));

  return waitForUnlock();
}

/** At boot, before anything of the workspace is read: wait for the password when the lock is on. */
export async function ensureUnlockedAtBoot() {
  const config = await getLockConfig();
  if (!config.enabled || !config.password) return;

  await showLockScreen();
}

/** Locks every tab of YANTA on this device. */
export async function lockNow() {
  const config = await getLockConfig();
  if (!config.enabled) return false;

  channel?.postMessage({ type: 'lock' });
  showLockScreen();
  return true;
}

let autoLockInstalled = false;

export function setupAutoLock() {
  if (autoLockInstalled) return;
  autoLockInstalled = true;

  let lastActivity = Date.now();
  let hiddenSince = 0;
  let config = null;

  const refresh = async () => { config = await getLockConfig(); };
  refresh();
  window.addEventListener('yanta-lock-config-changed', refresh);

  const activity = () => { lastActivity = Date.now(); };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, activity, { passive: true, capture: true });
  }

  const lockIfDue = () => {
    if (!config?.enabled || screen) return;

    const idle = Number(config.idleMinutes) || 0;
    if (idle > 0 && Date.now() - lastActivity >= idle * 60_000) {
      lockNow();
      return;
    }

    const hidden = Number(config.hiddenMinutes);
    if (hiddenSince && hidden >= 0 && Date.now() - hiddenSince >= hidden * 60_000) {
      lockNow();
    }
  };

  // Background tabs throttle timers, so time is measured, not counted down.
  setInterval(lockIfDue, 15_000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
      // "Lock right away when I leave" is the setting 0.
      if (config?.enabled && Number(config.hiddenMinutes) === 0) lockNow();
    } else {
      lockIfDue();
      hiddenSince = 0;
      lastActivity = Date.now();
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      lockNow();
    }
  }, true);

  channel?.addEventListener('message', (e) => {
    if (e.data?.type === 'lock') showLockScreen();
    if (e.data?.type === 'unlocked' && screen) finishUnlock({ broadcast: false });
    if (e.data?.type === 'wiped') location.replace('/');
  });
}
