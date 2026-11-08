// ============================================================
// YANTA Sync2 — YANTA Cloud setup UI
// ============================================================

import { t, getLocale } from '../i18n/index.js';
import {
  el,
  store,
  toast,
  lucide,
  escapeHtml,
} from '../core.js';

import {
  cloudMe,
  cloudSendCode,
  cloudVerifyCode,
  cloudVerifyMfa,
  cloudCreateVault,
  cloudListVaultDevices,
  cloudRemoveVaultDevice,
  cloudStorageBreakdown,
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

import {
  createSync2YantaCloudAppRuntime,
  getSync2SyncKey,
  setSync2SyncKey,
  verifyYantaCloudSyncKey,
  hasDifferentStoredSync2SyncKey,
} from './app-engine.js';

import {
  createSync2PairingPayload,
  createSync2PairingUrl,
  renderSync2QrSvg,
  applySync2PairingPayload,
  parseSync2PairingPayload,
  scanQrWithCamera,
} from './pairing.js';

import {
  syncKeyToBytes,
} from './crypto.js';

import {
  printRecoveryKit,
  extractSyncKeyFromRecoveryInput,
} from './recovery-kit.js';

import {
  removePristineWelcomeVaultIfPresent,
} from '../notes.js';

import {
  yantaConfirm,
} from '../dialogs.js';

import {
  describeBillingState,
  reconciledBillingSummary,
} from '../billing/billing-ui.js';

import {
  registerOverlayRoute,
  pushOverlayState,
  closeTopOverlay,
  overlayIdFromState,
} from '../overlay-history.js';

let modal = null;
let statusEl = null;
let turnstileToken = '';
let turnstileWidgetId = null;

const YANTA_CLOUD_SETUP_OVERLAY_ID = 'yanta-cloud-setup';

let yantaCloudOverlayRegistered = false;
let lastPairingTextForHistory = '';

function yantaCloudSetupIsOpen() {
  return !!modal && modal.hidden === false;
}

function registerYantaCloudSetupOverlayRoute() {
  if (yantaCloudOverlayRegistered) return;

  yantaCloudOverlayRegistered = true;

  registerOverlayRoute(YANTA_CLOUD_SETUP_OVERLAY_ID, {
    open: async () => {
      if (lastPairingTextForHistory) {
        await openYantaCloudSetupWithPayload(lastPairingTextForHistory, {
          fromHistory: true,
        });
        return;
      }

      await openYantaCloudSetup({
        fromHistory: true,
      });
    },

    close: () => {
      close({
        fromHistory: true,
      });
    },

    isOpen: yantaCloudSetupIsOpen,
  });
}

function markYantaCloudSetupOverlayOpen({
  fromHistory = false,
} = {}) {
  registerYantaCloudSetupOverlayRoute();

  if (
    !fromHistory &&
    overlayIdFromState() !== YANTA_CLOUD_SETUP_OVERLAY_ID
  ) {
    pushOverlayState(YANTA_CLOUD_SETUP_OVERLAY_ID);
  }
}

let cloudUsageTooltipEl = null;

function ensureCloudUsageTooltip() {
  if (cloudUsageTooltipEl) return cloudUsageTooltipEl;

  cloudUsageTooltipEl = document.createElement('div');
  cloudUsageTooltipEl.className = 'yanta-cloud-usage-floating-tooltip';
  cloudUsageTooltipEl.hidden = true;

  document.body.append(cloudUsageTooltipEl);

  return cloudUsageTooltipEl;
}

function hideCloudUsageTooltip() {
  if (!cloudUsageTooltipEl) return;

  cloudUsageTooltipEl.hidden = true;
  cloudUsageTooltipEl.textContent = '';
}

function positionCloudUsageTooltip(anchor, {
  clientX = null,
  clientY = null,
} = {}) {
  const tooltip = ensureCloudUsageTooltip();

  if (!anchor || tooltip.hidden) return;

  const anchorRect = anchor.getBoundingClientRect();

  const preferredX =
    Number.isFinite(clientX)
      ? clientX
      : anchorRect.left + anchorRect.width / 2;

  const preferredY =
    Number.isFinite(clientY)
      ? clientY
      : anchorRect.top;

  const margin = 10;
  const gap = 10;

  const tooltipRect = tooltip.getBoundingClientRect();

  let left = preferredX - tooltipRect.width / 2;
  let top = preferredY - tooltipRect.height - gap;

  if (top < margin) {
    top = anchorRect.bottom + gap;
  }

  if (left < margin) {
    left = margin;
  }

  if (left + tooltipRect.width > window.innerWidth - margin) {
    left = window.innerWidth - tooltipRect.width - margin;
  }

  if (top + tooltipRect.height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - tooltipRect.height - margin);
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function showCloudUsageTooltip(anchor, {
  clientX = null,
  clientY = null,
} = {}) {
  const text =
    anchor?.dataset?.cloudUsageTip ||
    anchor?.dataset?.tip ||
    anchor?.getAttribute?.('title') ||
    '';

  if (!text) return;

  const tooltip = ensureCloudUsageTooltip();

  tooltip.textContent = text;
  tooltip.hidden = false;

  positionCloudUsageTooltip(anchor, {
    clientX,
    clientY,
  });
}

function bindCloudUsageTooltips(root = modal) {
  if (!root || root.dataset.cloudUsageTooltipBound === '1') return;

  root.dataset.cloudUsageTooltipBound = '1';

  root.addEventListener('pointerenter', (e) => {
    const target = e.target?.closest?.('[data-cloud-usage-tip]');
    if (!target || !root.contains(target)) return;

    showCloudUsageTooltip(target, {
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, true);

  root.addEventListener('pointermove', (e) => {
    const target = e.target?.closest?.('[data-cloud-usage-tip]');
    if (!target || !root.contains(target)) return;

    positionCloudUsageTooltip(target, {
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, true);

  root.addEventListener('pointerleave', (e) => {
    const target = e.target?.closest?.('[data-cloud-usage-tip]');
    if (!target || !root.contains(target)) return;

    hideCloudUsageTooltip();
  }, true);

  root.addEventListener('focusin', (e) => {
    const target = e.target?.closest?.('[data-cloud-usage-tip]');
    if (!target || !root.contains(target)) return;

    showCloudUsageTooltip(target);
  });

  root.addEventListener('focusout', (e) => {
    const target = e.target?.closest?.('[data-cloud-usage-tip]');
    if (!target || !root.contains(target)) return;

    hideCloudUsageTooltip();
  });

  window.addEventListener('scroll', hideCloudUsageTooltip, true);
  window.addEventListener('resize', hideCloudUsageTooltip);
}

const TURNSTILE_SITE_KEY =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

function setStatus(msg = '', type = '') {
  if (!statusEl) return;

  statusEl.textContent = msg;
  statusEl.className = 'yanta-cloud-status' + (type ? ` ${type}` : '');
}

function close({
  fromHistory = false,
} = {}) {
  hideCloudUsageTooltip();

  if (
    !fromHistory &&
    overlayIdFromState() === YANTA_CLOUD_SETUP_OVERLAY_ID
  ) {
    closeTopOverlay(() => {
      if (modal) modal.hidden = true;
    });

    return;
  }

  if (modal) modal.hidden = true;
}

function ensureCss() {
  if (document.getElementById('yanta-cloud-setup-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-cloud-setup-css';
  style.textContent = `
.yanta-cloud-card {
  width: min(680px, 94vw);
}

.yanta-cloud-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-cloud-hero {
  display: flex;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
}

.yanta-cloud-hero-icon {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.yanta-cloud-hero strong {
  color: var(--text);
  font-size: 15px;
}

.yanta-cloud-hero p {
  margin: 4px 0 0;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-cloud-warning {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--yellow) 45%, var(--border));
  background: color-mix(in srgb, var(--yellow) 10%, transparent);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-cloud-section {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);
}

.yanta-cloud-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--text);
}

.yanta-cloud-section p {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.45;
}

.yanta-cloud-guest-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.4;
  cursor: pointer;
}

.yanta-cloud-guest-option input { margin-top: 2px; }

.yanta-cloud-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.yanta-cloud-status {
  min-height: 18px;
  white-space: pre-wrap;
  color: var(--text-faint);
  font-size: 12px;
}

.yanta-cloud-status.error {
  color: var(--red);
}

.yanta-cloud-status.success {
  color: var(--green);
}

.yanta-cloud-recovery {
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
}

.yanta-cloud-qr {
  display: flex;
  justify-content: center;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: white;
}

.yanta-cloud-usage-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yanta-cloud-usage-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.yanta-cloud-usage-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.yanta-cloud-usage-label {
  color: var(--text);
  font-weight: 700;
}

.yanta-cloud-usage-value {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.yanta-cloud-usage-bar {
  position: relative;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-faint) 16%, transparent);
}

.yanta-cloud-usage-bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--usage-pct, 0%);
  min-width: var(--usage-min, 0px);
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    var(--accent),
    color-mix(in srgb, var(--accent) 65%, white)
  );
}

.yanta-cloud-usage-row.warn .yanta-cloud-usage-bar > span {
  background: var(--yellow);
}

.yanta-cloud-usage-row.danger .yanta-cloud-usage-bar > span {
  background: var(--red);
}

.yanta-cloud-usage-caption {
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.35;
}

/* Devices */
.yanta-cloud-device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-cloud-device-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg-elev-2);
}

.yanta-cloud-device-row.current {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev-2));
}

.yanta-cloud-device-row.revoked {
  opacity: 0.58;
}

.yanta-cloud-device-row > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-cloud-device-row strong {
  color: var(--text);
  font-size: 13px;
}

.yanta-cloud-device-row small {
  color: var(--text-faint);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.yanta-cloud-device-row small.warn {
  color: var(--yellow);
}

.yanta-cloud-device-current {
  color: var(--accent);
  font-size: 11px;
  font-weight: 800;
}

@media (max-width: 680px) {
  .yanta-cloud-device-row {
    align-items: stretch;
    flex-direction: column;
  }

  .yanta-cloud-device-row .btn {
    justify-content: center;
  }
}
.yanta-cloud-advanced {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
}

.yanta-cloud-advanced summary {
  cursor: pointer;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 700;
  user-select: none;
}

.yanta-cloud-advanced summary:hover {
  color: var(--text);
}

.yanta-cloud-advanced-body {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yanta-cloud-advanced-body p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-cloud-limit-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;

  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg-elev-2);
  color: var(--text-dim);

  font-size: 12px;
  line-height: 1.45;
}

.yanta-cloud-limit-note svg {
  flex: 0 0 auto;
  color: var(--accent);
  margin-top: 1px;
}

.yanta-cloud-plan-fineprint {
  margin: 9px 2px 0;
  color: var(--text-faint);
  font-size: 11.5px;
  line-height: 1.45;
}

.yanta-cloud-usage-bar.segmented {
  display: flex;
  align-items: stretch;
  overflow: visible;
  height: 9px;
}

.yanta-cloud-usage-bar.segmented > span {
  position: relative;
  inset: auto;
  min-width: 0;
  width: var(--segment-pct, 0%);
  height: 100%;
  flex: 0 0 var(--segment-pct, 0%);
  background: var(--segment-color, var(--accent));
  border-radius: 0;
}

.yanta-cloud-usage-bar.segmented > span:first-child {
  border-top-left-radius: 999px;
  border-bottom-left-radius: 999px;
}

.yanta-cloud-usage-bar.segmented > span:last-child {
  border-top-right-radius: 999px;
  border-bottom-right-radius: 999px;
}

.yanta-cloud-usage-segment {
  cursor: help;
}

.yanta-cloud-usage-segment::before {
  content: "";

  position: absolute;
  inset: -5px 0;

  border-radius: 999px;

  opacity: 0;
  background: color-mix(in srgb, white 24%, transparent);

  transition: opacity 100ms ease;
}

.yanta-cloud-usage-segment:hover::before {
  opacity: 1;
}

@media (hover: none), (pointer: coarse) {
  .yanta-cloud-usage-segment::after {
    display: none;
  }
}

/* Old in-bar pseudo tooltip disabled.
   Tooltips are rendered in document.body so they are not clipped by modal overflow. */
.yanta-cloud-usage-segment::after {
  display: none !important;
}

.yanta-cloud-usage-segment {
  cursor: help;
  outline: none;
}

.yanta-cloud-usage-segment::before {
  content: "";

  position: absolute;
  inset: -5px 0;

  border-radius: 999px;

  opacity: 0;
  background: color-mix(in srgb, white 24%, transparent);

  transition: opacity 100ms ease;
}

.yanta-cloud-usage-segment:hover::before,
.yanta-cloud-usage-segment:focus-visible::before {
  opacity: 1;
}

.yanta-cloud-usage-segment:focus-visible {
  box-shadow:
    0 0 0 2px var(--bg-elev),
    0 0 0 4px var(--accent);
  z-index: 2;
}

.yanta-cloud-usage-floating-tooltip {
  position: fixed;
  z-index: 2000;

  max-width: min(340px, calc(100vw - 24px));
  padding: 8px 10px;

  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg-elev-3);
  color: var(--text);

  box-shadow:
    0 16px 48px rgba(0,0,0,0.42),
    0 1px 0 rgba(255,255,255,0.05) inset;

  font-size: 11px;
  line-height: 1.4;
  white-space: normal;

  pointer-events: none;

  opacity: 1;
  transform: translateZ(0);

  animation: yanta-cloud-usage-tooltip-in 100ms ease;
}

.yanta-cloud-usage-floating-tooltip[hidden] {
  display: none !important;
}

@keyframes yanta-cloud-usage-tooltip-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (hover: none), (pointer: coarse) {
  .yanta-cloud-usage-floating-tooltip {
    display: none;
  }
}
`;
  document.head.append(style);
}

function ensureModal() {
  if (modal) return modal;

  ensureCss();

  modal = el('div', {
    class: 'modal yanta-cloud-modal',
    hidden: true,
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
    if (e.target.closest?.('[data-yanta-cloud-close]')) close();
  });

  document.body.append(modal);

  return modal;
}

function renderShell(title, bodyHtml) {
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-cloud-card">
      <header class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn" data-yanta-cloud-close aria-label="${escapeHtml(t('common.close'))}">&times;</button>
      </header>

      <div class="modal-body yanta-cloud-body">
        ${bodyHtml}
        <div class="yanta-cloud-status" data-status></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');
  m.hidden = false;
}

function publishYantaCloudRuntime(runtime, {
  catchUp = false,
  syncNow = false,
  reason = 'yanta-cloud-setup',
} = {}) {
  if (!runtime?.engine) return null;

  window.yantaSync2 = runtime;

  if (typeof window.yantaRegisterSync2Runtime === 'function') {
    try {
      window.yantaRegisterSync2Runtime(runtime, {
        catchUp,
        syncNow,
        reason,
      });

      return runtime;
    } catch (err) {
      console.warn('[YANTA Cloud] direct runtime registration failed', err);
    }
  }

  window.dispatchEvent(new CustomEvent('yanta-sync2-runtime-ready', {
    detail: {
      runtime,
      catchUp,
      syncNow,
      reason,
    },
  }));

  return runtime;
}

function renderTurnstile(container) {
  turnstileToken = '';

  if (!TURNSTILE_SITE_KEY) return;

  const host = document.createElement('div');
  host.className = 'yanta-cloud-turnstile';
  container.append(host);

  const ensureScript = () => new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }

    const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');

    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });

  ensureScript().then(() => {
    turnstileWidgetId = window.turnstile.render(host, {
      sitekey: TURNSTILE_SITE_KEY,
      callback(token) {
        turnstileToken = token;
      },
    });
  }).catch(() => {
    setStatus(t('sync.cloudSetup.turnstileFailed'), 'error');
  });
}

export async function openYantaCloudSetup({
  fromHistory = false,
  focus = '',
} = {}) {
  lastPairingTextForHistory = '';

  markYantaCloudSetupOverlayOpen({
    fromHistory,
  });

  try {
    const me = await cloudMe();

    if (me.authenticated) {
      await renderCloudHome(me);

      // Deep link, e.g. Settings › Security › "Manage devices".
      if (focus === 'devices') {
        requestAnimationFrame(() => document.getElementById('yanta-cloud-devices')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      }
    } else {
      renderLogin();
    }
  } catch {
    renderLogin();
  }
}

// "Not my device": guest mode starts right after signing in, before the
// workspace arrives, so all of it is stored sealed (lock/lock-keys.js).
let guestRequested = false;

function guestOptionHtml() {
  return `
    <label class="yanta-cloud-guest-option" data-guest-option>
      <input type="checkbox" data-guest ${guestRequested ? 'checked' : ''} />
      <span>${escapeHtml(t('lock.guest.loginOption'))}</span>
    </label>`;
}

async function hideGuestOptionOnOwnDevice() {
  const { getLockConfig } = await import('../lock/lock-keys.js');
  const config = await getLockConfig();
  if (config.enabled || config.guest) modal?.querySelector('[data-guest-option]')?.remove();
}

async function enterGuestMode() {
  const { getLockConfig, startGuestMode } = await import('../lock/lock-keys.js');
  const config = await getLockConfig();
  if (config.enabled || config.guest) return;

  await startGuestMode();
  const { shareKeyWithOpenTabs } = await import('../lock/app-lock.js');
  shareKeyWithOpenTabs();
  const { migrateAtRest } = await import('../lock/at-rest-migrate.js');
  migrateAtRest().catch((err) => console.warn('[YANTA] Sealing stored data paused', err));
}

function renderLogin() {
  renderShell(t('sync.cloudSetup.login.title'), `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('cloud', 28)}</div>
      <div>
        <strong>${escapeHtml(t('sync.cloudSetup.login.heading'))}</strong>
        <p>${escapeHtml(t('sync.cloudSetup.login.lead'))}</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.login.email'))}</h4>
      <div class="yanta-cloud-grid">
        <input class="text-input" data-email placeholder="${escapeHtml(t('sync.cloudSetup.login.emailPlaceholder'))}" autocomplete="email" />
        <div data-turnstile></div>
        ${guestOptionHtml()}
        <button class="btn primary" data-send-code>${lucide('mail', 14)} ${escapeHtml(t('sync.cloudSetup.login.sendCode'))}</button>
      </div>
    </section>
  `);

  renderTurnstile(modal.querySelector('[data-turnstile]'));
  hideGuestOptionOnOwnDevice();

  modal.querySelector('[data-send-code]')?.addEventListener('click', async () => {
    const email = modal.querySelector('[data-email]')?.value?.trim();

    if (!email) {
      setStatus(t('sync.cloudSetup.login.enterEmail'), 'error');
      return;
    }

    try {
      setStatus(t('sync.cloudSetup.login.sending'));

      guestRequested = !!modal.querySelector('[data-guest]')?.checked;
      await cloudSendCode(email, turnstileToken);

      renderCode(email);
    } catch (err) {
      setStatus(err?.message || t('sync.cloudSetup.login.sendFailed'), 'error');
    }
  });
}

function renderCode(email) {
  renderShell(t('sync.cloudSetup.code.title'), `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('key-round', 28)}</div>
      <div>
        <strong>${escapeHtml(t('sync.cloudSetup.code.heading'))}</strong>
        <p>${escapeHtml(t('sync.cloudSetup.code.lead'))}</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.code.label'))}</h4>
      <input class="text-input" data-code placeholder="XXXXXX" inputmode="numeric" maxlength="6" />
      <div class="compress-actions" style="margin-top:10px">
        <button class="btn" data-back>${escapeHtml(t('common.back'))}</button>
        <span class="grow"></span>
        <button class="btn primary" data-verify>${lucide('check', 14)} ${escapeHtml(t('common.continue'))}</button>
      </div>
    </section>
  `);

  modal.querySelector('[data-back]')?.addEventListener('click', renderLogin);

  modal.querySelector('[data-code]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      modal.querySelector('[data-verify]')?.click();
    }
  });

  modal.querySelector('[data-verify]')?.addEventListener('click', async () => {
    const code = modal.querySelector('[data-code]')?.value?.trim();

    if (!code) {
      setStatus(t('sync.cloudSetup.code.enter'), 'error');
      return;
    }

    try {
      setStatus(t('sync.cloudSetup.code.verifying'));

      const verified = await cloudVerifyCode(email, code);
      if (verified?.mfaRequired) {
        renderMfaLogin(verified.mfaToken, async () => {
          if (guestRequested) await enterGuestMode();
          await renderCloudHome(await cloudMe());
        });
        return;
      }
      if (guestRequested) await enterGuestMode();

      const me = await cloudMe();
      await renderCloudHome(me);
    } catch (err) {
      setStatus(err?.message || t('sync.cloudSetup.code.failed'), 'error');
    }
  });

  setTimeout(() => modal.querySelector('[data-code]')?.focus(), 0);
}

/*
  Second step of a sign-in with two-factor sign-in on: the email code was
  right, now the authenticator code (or a backup code). `onSignedIn` runs
  once the session exists.
*/
function renderMfaLogin(mfaToken, onSignedIn) {
  renderShell(t('mfa.login.title'), `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('shield-check', 28)}</div>
      <div>
        <strong>${escapeHtml(t('mfa.login.title'))}</strong>
        <p>${escapeHtml(t('mfa.login.hint'))}</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('mfa.login.code'))}</h4>
      <input class="text-input" data-mfa-code placeholder="123456" inputmode="text" autocomplete="one-time-code" maxlength="16" />
      <div class="compress-actions" style="margin-top:10px">
        <span class="grow"></span>
        <button class="btn primary" data-mfa-verify>${lucide('check', 14)} ${escapeHtml(t('mfa.login.submit'))}</button>
      </div>
    </section>
  `);

  const input = modal.querySelector('[data-mfa-code]');
  const submit = modal.querySelector('[data-mfa-verify]');

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit?.click();
  });

  submit?.addEventListener('click', async () => {
    const code = input?.value?.trim();
    if (!code) return;

    submit.disabled = true;
    try {
      setStatus(t('mfa.login.checking'));
      const result = await cloudVerifyMfa(mfaToken, code);
      if (Number.isFinite(result?.backupRemaining)) {
        toast(t('mfa.login.backupLeft', { count: result.backupRemaining }), 'success');
      }
      await onSignedIn();
    } catch (err) {
      const expired = err?.response?.code === 'mfa_expired';
      setStatus(expired ? t('mfa.login.expired') : t('mfa.login.invalid'), 'error');
      if (expired) renderLogin();
    } finally {
      submit.disabled = false;
    }
  });

  setTimeout(() => input?.focus(), 0);
}

/** A magic link that needs the second factor lands on #cloud-login-mfa=<token>. */
export async function resumeCloudLoginFromHash() {
  const match = String(location.hash || '').match(/^#cloud-login-mfa=([^&]+)/);
  if (!match) return false;

  history.replaceState(history.state, '', location.pathname + location.search);
  await openYantaCloudSetup();
  renderMfaLogin(decodeURIComponent(match[1]), async () => {
    await renderCloudHome(await cloudMe());
  });
  return true;
}

function fmtBytesCompact(n) {
  const value = Number(n || 0);

  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;

  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function pctClass(pct) {
  if (pct >= 98) return 'danger';
  if (pct >= 85) return 'warn';
  return '';
}

function storageBreakdownLabel(group) {
  const map = {
    'vault heads': t('sync.cloudSetup.storage.vaultHeads'),
    'vault updates': t('sync.cloudSetup.storage.vaultUpdates'),
    'vault snapshots': t('sync.cloudSetup.storage.vaultSnapshots'),

    'note heads': t('sync.cloudSetup.storage.noteHeads'),
    'note updates': t('sync.cloudSetup.storage.noteUpdates'),
    'note snapshots': t('sync.cloudSetup.storage.noteSnapshots'),

    'ai sessions': t('sync.cloudSetup.storage.aiSessions'),
    assets: t('sync.cloudSetup.storage.assets'),
    other: t('sync.cloudSetup.storage.other'),
  };

  return map[group] || group || t('sync.cloudSetup.storage.other');
}

function storageBreakdownCaption(group) {
  const map = {
    'vault heads':
      t('sync.cloudSetup.storage.vaultHeadsCaption'),

    'vault updates':
      t('sync.cloudSetup.storage.vaultUpdatesCaption'),

    'vault snapshots':
      t('sync.cloudSetup.storage.snapshotsCaption'),

    'note heads':
      t('sync.cloudSetup.storage.noteHeadsCaption'),

    'note updates':
      t('sync.cloudSetup.storage.noteUpdatesCaption'),

    'note snapshots':
      t('sync.cloudSetup.storage.snapshotsCaption'),

    'ai sessions':
      t('sync.cloudSetup.storage.aiSessionsCaption'),

    assets:
      t('sync.cloudSetup.storage.assetsCaption'),

    other:
      t('sync.cloudSetup.storage.otherCaption'),
  };

  return map[group] || '';
}

function storageBreakdownColor(group) {
  const map = {
    'vault heads': 'var(--green)',
    'vault updates': 'var(--yellow)',
    'vault snapshots': 'var(--accent)',

    'note heads': 'var(--green)',
    'note updates': 'var(--accent-2)',
    'note snapshots': 'var(--green)',

    'ai sessions': 'var(--accent-2)',
    assets: 'var(--red)',
    other: 'var(--text-faint)',
  };

  return map[group] || 'var(--text-faint)';
}

function normalizedStorageBreakdownSegments(breakdown, storageLimitBytes, {
  aiSessionsBytes = 0,
  aiSessionsCount = 0,
} = {}) {
  const groups = Array.isArray(breakdown?.groups)
    ? breakdown.groups
    : [];

  const limit = Number(storageLimitBytes || 0);

  if (!groups.length || limit <= 0) return [];

  const extra = [];

  if (Number(aiSessionsBytes || 0) > 0 && limit > 0) {
    extra.push({
      group: 'ai sessions',
      count: Number(aiSessionsCount || 0),
      bytes: Number(aiSessionsBytes || 0),
    });
  }

  return [...groups, ...extra]
    .filter((group) => Number(group.bytes || 0) > 0)
    .map((group) => {
      const bytes = Number(group.bytes || 0);
      const count = Number(group.count || 0);
      const pct = Math.max(0, Math.min(100, (bytes / limit) * 100));

      return {
        group: group.group || 'other',
        label: storageBreakdownLabel(group.group),
        caption: storageBreakdownCaption(group.group),
        bytes,
        count,
        pct,
        color: storageBreakdownColor(group.group),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

function usageBarHtml({
  label,
  used,
  limit,
  formatter = fmtBytesCompact,
  caption = '',
  segments = null,
}) {
  const u = Number(used || 0);
  const l = Number(limit || 0);
  const pct = l > 0 ? Math.max(0, Math.min(100, Math.round((u / l) * 100))) : 0;

  const hasSegments = Array.isArray(segments) && segments.length > 0;

  const barHtml = hasSegments
    ? `
      <div
        class="yanta-cloud-usage-bar segmented"
        style="--usage-pct:${pct}%;--usage-min:${u > 0 ? '4px' : '0px'}"
        aria-label="${escapeHtml(t('sync.cloudSetup.usage.breakdownAria', { label }))}">
        ${segments.map((segment) => {
          const objects = t('sync.cloudSetup.usage.objectCount', { count: segment.count });
          const title = [
            segment.label,
            `${formatter(segment.bytes)} · ${objects}`,
            segment.caption,
          ].filter(Boolean).join('\n');

          return `
            <span
              class="yanta-cloud-usage-segment"
              tabindex="0"
              role="img"
              aria-label="${escapeHtml(`${segment.label}: ${formatter(segment.bytes)} · ${objects}`)}"
              style="--segment-pct:${segment.pct}%;--segment-color:${segment.color}"
              data-cloud-usage-tip="${escapeHtml(`${segment.label}: ${formatter(segment.bytes)} · ${objects}${segment.caption ? ` · ${segment.caption}` : ''}`)}">
            </span>
          `;
        }).join('')}
      </div>
    `
    : `
      <div class="yanta-cloud-usage-bar" style="--usage-pct:${pct}%;--usage-min:${u > 0 ? '4px' : '0px'}">
        <span></span>
      </div>
    `;

  return `
    <div class="yanta-cloud-usage-row ${pctClass(pct)}">
      <div class="yanta-cloud-usage-head">
        <span class="yanta-cloud-usage-label">${escapeHtml(label)}</span>
        <span class="yanta-cloud-usage-value">
          ${escapeHtml(formatter(u))} / ${escapeHtml(formatter(l))}
        </span>
      </div>

      ${barHtml}

      ${
        caption
          ? `<div class="yanta-cloud-usage-caption">${escapeHtml(caption)}</div>`
          : ''
      }
    </div>
  `;
}

function usageBarsHtml(me, storageBreakdown = null, {
  aiSessionsBytes = 0,
  aiSessionsCount = 0,
} = {}) {
  const usage = me.usage || {};
  const limits = me.limits || {};
  const plan = me.user?.plan || 'free';
  const countFmt = (n) => String(Number(n || 0).toLocaleString(getLocale()));

  const storageSegments = normalizedStorageBreakdownSegments(
    storageBreakdown,
    limits.storageBytes,
    {
      aiSessionsBytes,
      aiSessionsCount,
    }
  );

  const storageCaption = storageSegments.length
    ? t('sync.cloudSetup.usage.storageCaptionSegments')
    : t('sync.cloudSetup.usage.storageCaption');

      // Plan-Name transformieren oder Fallback nutzen
  let displayPlan = plan;
  if (plan === 'free') {
    displayPlan = t('sync.cloudSetup.plan.free');
  } else if (plan === 'premium') {
    displayPlan = 'Plus';
  }

  return `
    <div class="yanta-cloud-usage-list">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:2px">
        <strong style="color:var(--text)">${escapeHtml(t('sync.cloudSetup.plan.title'))}</strong>
        <span style="color:var(--accent);font-weight:800;text-transform:capitalize">${escapeHtml(displayPlan)}</span>
      </div>

      ${usageBarHtml({
        label: t('sync.cloudSetup.usage.storage'),
        used: usage.storage_bytes,
        limit: limits.storageBytes,
        caption: storageCaption,
        segments: storageSegments,
      })}

      ${usageBarHtml({
        label: t('sync.cloudSetup.usage.objects'),
        used: usage.object_count,
        limit: limits.objects,
        formatter: countFmt,
        caption: t('sync.cloudSetup.usage.objectsCaption'),
      })}

      ${usageBarHtml({
        label: t('sync.cloudSetup.usage.downloadMonth'),
        used: usage.download_bytes_month,
        limit: limits.downloadBytesMonth,
      })}

      ${usageBarHtml({
        label: t('sync.cloudSetup.usage.uploadToday'),
        used: usage.upload_bytes_day,
        limit: limits.uploadBytesDay,
      })}

      ${usageBarHtml({
        label: t('sync.cloudSetup.usage.writesToday'),
        used: usage.writes_today,
        limit: limits.writesDay,
        formatter: countFmt,
      })}
    </div>
  `;
}

function cloudPlanSectionHtml(me = {}) {
  const state = describeBillingState({
    plan: me.user?.plan || 'free',
    billing: me.billing || null,
  });

  return `
    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.plan.title'))}</h4>

      <div class="yanta-cloud-limit-note">
        ${lucide(state.isPlus ? 'sparkles' : 'info', 14)}
        <span data-yanta-plus-status>${state.html}</span>
      </div>

      <div class="compress-actions" style="margin-top:10px;justify-content:flex-start;flex-wrap:wrap">
        <button class="btn primary" data-yanta-plus-upgrade ${state.showUpgrade ? '' : 'hidden'}>
          ${lucide('sparkles', 14)}
          ${escapeHtml(t('settings.billing.upgrade'))}
        </button>

        <button class="btn" data-yanta-plus-manage ${state.showManage ? '' : 'hidden'}>
          ${lucide('credit-card', 14)}
          ${escapeHtml(t('settings.billing.manage'))}
        </button>

        <a class="btn" href="/pricing" target="_blank" rel="noopener">
          ${lucide('external-link', 14)}
          ${escapeHtml(t('settings.billing.pricing'))}
        </a>
      </div>

      <p class="yanta-cloud-plan-fineprint" data-yanta-plus-fineprint ${state.isPlus ? '' : 'hidden'}>
        ${escapeHtml(t('settings.billing.fineprint'))}
      </p>
    </section>
  `;
}

/*
  Fast render uses the DB-cached plan; if the renewal date sits in the past
  a webhook was missed, so reconcile against Paddle and patch the section.
*/
async function reconcileCloudPlanSectionIfStale(modal, me = {}) {
  const initial = describeBillingState({
    plan: me.user?.plan || 'free',
    billing: me.billing || null,
  });

  if (!initial.stale) return;

  const statusEl = modal?.querySelector('[data-yanta-plus-status]');
  const upgradeEl = modal?.querySelector('[data-yanta-plus-upgrade]');
  const manageEl = modal?.querySelector('[data-yanta-plus-manage]');
  const fineprintEl = modal?.querySelector('[data-yanta-plus-fineprint]');
  if (!statusEl) return;

  let fresh;
  try {
    fresh = await reconciledBillingSummary();
  } catch (err) {
    console.warn('[YANTA Billing] Reconcile failed', err);
    fresh = { plan: me.user?.plan || 'free', billing: me.billing || null };
  }

  if (!statusEl.isConnected) return;

  const state = describeBillingState(fresh, { afterReconcile: true });
  statusEl.innerHTML = state.html;
  if (upgradeEl) upgradeEl.hidden = !state.showUpgrade;
  if (manageEl) manageEl.hidden = !state.showManage;
  if (fineprintEl) fineprintEl.hidden = !state.isPlus;
}

async function hydrateUsageWithStorageBreakdown({
  me,
  vaultId,
  currentDeviceId,
} = {}) {
  const host = modal?.querySelector('[data-cloud-usage-section]');
  if (!host) return;

  if (!vaultId || !currentDeviceId) {
    host.innerHTML = usageBarsHtml(me, null);
    return;
  }

  try {
    const breakdown = await cloudStorageBreakdown(vaultId, {
      deviceId: currentDeviceId,
    });

    let aiSessionsEstimate = {
      bytes: 0,
      count: 0,
    };

    try {
      const mod = await import('../ai/ai-sessions.js');
      aiSessionsEstimate = await mod.estimateAiSessionsStorageBytes();
    } catch {}

    if (!host.isConnected) return;

    host.innerHTML = usageBarsHtml(me, breakdown, {
      aiSessionsBytes: aiSessionsEstimate.bytes,
      aiSessionsCount: aiSessionsEstimate.count,
    });
  } catch (err) {
    console.warn('[YANTA Cloud] storage breakdown failed', err);

    if (!host.isConnected) return;

    host.innerHTML = usageBarsHtml(me, null);
  }
}

function storageBreakdownHtml(breakdown) {
  const groups = breakdown?.groups || [];
  const total = Number(breakdown?.totalBytes || 0);

  if (!groups.length) {
    return `
      <div class="yanta-cloud-limit-note">
        ${lucide('info', 14)}
        <span>${escapeHtml(t('sync.cloudSetup.breakdown.empty'))}</span>
      </div>
    `;
  }

  return `
    <div class="yanta-cloud-usage-list">
      ${groups.map((group) => {
        const bytes = Number(group.bytes || 0);
        const pct = total > 0
          ? Math.max(0, Math.min(100, Math.round((bytes / total) * 100)))
          : 0;

        return `
          <div class="yanta-cloud-usage-row ${pctClass(pct)}">
            <div class="yanta-cloud-usage-head">
              <span class="yanta-cloud-usage-label">${escapeHtml(storageBreakdownLabel(group.group))}</span>
              <span class="yanta-cloud-usage-value">
                ${escapeHtml(fmtBytesCompact(bytes))}
                · ${escapeHtml(t('sync.cloudSetup.usage.objectCount', { count: Number(group.count || 0) }))}
              </span>
            </div>

            <div class="yanta-cloud-usage-bar" style="--usage-pct:${pct}%;--usage-min:${bytes > 0 ? '4px' : '0px'}">
              <span></span>
            </div>

            <div class="yanta-cloud-usage-caption">
              ${escapeHtml(storageBreakdownCaption(group.group))}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function hydrateStorageBreakdown({
  vaultId,
  currentDeviceId,
} = {}) {
  const host = modal?.querySelector('[data-storage-breakdown]');
  if (!host) return;

  if (!vaultId || !currentDeviceId) {
    host.innerHTML = `
      <div class="yanta-cloud-limit-note">
        ${lucide('info', 14)}
        <span>${escapeHtml(t('sync.cloudSetup.breakdown.connectFirst'))}</span>
      </div>
    `;
    return;
  }

  try {
    host.innerHTML = `
      <div class="tree-empty">${escapeHtml(t('sync.cloudSetup.breakdown.loading'))}</div>
    `;

    const breakdown = await cloudStorageBreakdown(vaultId, {
      deviceId: currentDeviceId,
    });

    if (!host.isConnected) return;

    host.innerHTML = storageBreakdownHtml(breakdown);
  } catch (err) {
    host.innerHTML = `
      <div class="yanta-cloud-warning">
        <strong>${escapeHtml(t('sync.cloudSetup.breakdown.failed'))}</strong><br>
        ${escapeHtml(err?.message || String(err))}
      </div>
    `;
  }
}

async function configuredYantaCloudVaultId() {
  try {
    return await store.settings.get('sync2.yantaCloud.vaultId', '');
  } catch {
    return '';
  }
}

async function configuredYantaCloudBaseUrl() {
  try {
    return await store.settings.get('sync2.yantaCloud.baseUrl', YANTA_CLOUD_BASE_URL);
  } catch {
    return YANTA_CLOUD_BASE_URL;
  }
}

async function prepareFreshYantaCloudDeviceIdentity({
  reason = 'reconnect',
} = {}) {
  /*
    Wenn ein Gerät aus dem Vault entfernt wurde, ist seine bisherige
    sync2.deviceId serverseitig revoked.

    Reconnect darf NICHT dieselbe deviceId wiederverwenden, sonst würde
    der Worker korrekt "Device revoked" werfen.

    Deshalb erzeugen wir beim expliziten Connect/Reconnect eine neue lokale
    Cloud-Device-Identität. Die alte bleibt revoked.
  */

  try {
    window.yantaSync2?.engine?.stop?.();
  } catch {}

  try {
    await store.settings.set('sync2.deviceId', null);
  } catch {}

  /*
    Optional aber sinnvoll:
    Der Seq-State ist an sich provider-lokal und nicht deviceId-spezifisch.
    Wir lassen ihn absichtlich stehen. Neue deviceId + alte seq ist okay:
    Pfade enthalten deviceId + seq und kollidieren dadurch nicht.
  */

  console.info('[YANTA Cloud] prepared fresh cloud device identity', {
    reason,
  });
}

function currentCloudDeviceId() {
  return (
    window.yantaSync2?.deviceId ||
    window.yantaSync2?.engine?.deviceId ||
    ''
  );
}

function hasActiveCloudDevices(devices = []) {
  return devices.some((d) => d.active !== false);
}

/*
  Two very different situations used to arrive here as one:

    a) this browser has no running sync runtime — usually because the
       cloud session expired, so the runtime could not start;
    b) the server actually revoked this device.

  Only (b) is "Device removed". Reporting (a) the same way told people
  their device had been removed when nothing had been, and pushed them
  into re-pairing with the Recovery Key — which mints a NEW device id and
  leaves the old one behind. That is where duplicate device entries come
  from, and why the list slowly fills up.
*/
async function loadVaultDevicesForHome(vaultId, currentDeviceId) {
  if (!vaultId) {
    return { devices: [], accessError: '', blockReason: '' };
  }

  if (!currentDeviceId) {
    return {
      devices: [],
      accessError: t('sync.cloudSetup.devices.notConnected'),
      blockReason: 'no-local-session',
    };
  }

  try {
    const res = await cloudListVaultDevices(vaultId, {
      deviceId: currentDeviceId,
    });

    return { devices: res.devices || [], accessError: '', blockReason: '' };
  } catch (err) {
    const revoked =
      err?.code === 'EDEVICE_REVOKED' ||
      /revoked|removed/i.test(String(err?.message || ''));

    return {
      devices: [],
      accessError: err?.message || t('sync.cloudSetup.devices.accessDenied'),
      blockReason: revoked ? 'revoked' : 'unreachable',
    };
  }
}

async function isLocalYantaCloudVault(vaultId) {
  const provider = await store.settings.get('sync2.provider', '').catch(() => '');
  const configuredVaultId = await configuredYantaCloudVaultId();

  return provider === 'yanta-cloud' && configuredVaultId === vaultId;
}

function fmtDeviceTime(ts) {
  if (!ts) return t('sync.cloudSetup.devices.never');

  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return t('sync.cloudSetup.devices.never');

  return d.toLocaleString(getLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function deviceInfoLine(d = {}) {
  return [
    d.deviceType || '',
    d.browser || '',
    d.os || d.platform || '',
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .join(' · ') || t('sync.cloudSetup.devices.unknown');
}

function cloudDevicesHtml({
  devices = [],
  limits = {},
  currentDeviceId = '',
  accessError = '',
  blockReason = '',
  vaultId = '',
} = {}) {
  if (accessError) {
    /*
      Say which of the two it is. "Your device was removed" sends people
      to the Recovery Key, which creates a second device entry — the
      wrong cure for an expired session, and the reason device lists
      collect duplicates.
    */
    const revoked = blockReason === 'revoked';

    return `
      <section class="yanta-cloud-section">
        <h4>${escapeHtml(t('sync.cloudSetup.devices.title'))}</h4>

        <div class="yanta-cloud-warning">
          <strong>${escapeHtml(
            revoked
              ? t('sync.cloudSetup.devices.revokedTitle')
              : t('sync.cloudSetup.devices.notConnected')
          )}</strong><br>
          ${escapeHtml(accessError)}
          <br><br>
          ${escapeHtml(
            revoked
              ? t('sync.cloudSetup.devices.revokedHint')
              : t('sync.cloudSetup.devices.notConnectedHint')
          )}
        </div>

        ${
          vaultId
            ? `
              <div class="compress-actions" style="margin-top:10px;justify-content:flex-start;flex-wrap:wrap">
                <button class="btn primary" data-reconnect-current-device="${escapeHtml(vaultId)}">
                  ${lucide('key-round', 14)}
                  ${escapeHtml(revoked ? t('sync.cloudSetup.devices.reconnect') : t('sync.cloudSetup.devices.connect'))}
                </button>
              </div>
            `
            : ''
        }
      </section>
    `;
  }

  const active = devices.filter((d) => d.active !== false);
  const max = Number(limits.devices || 0);

  if (!devices.length) {
    return `
      <section class="yanta-cloud-section">
        <h4>${escapeHtml(t('sync.cloudSetup.devices.title'))}</h4>

        <p>${escapeHtml(t('sync.cloudSetup.devices.none'))}</p>

        ${
          vaultId
            ? `
              <div class="yanta-cloud-warning" style="margin-top:10px">
                <strong>${escapeHtml(t('sync.cloudSetup.devices.noneActive'))}</strong><br>
                ${escapeHtml(t('sync.cloudSetup.devices.noneActiveHint'))}
              </div>

              <div class="compress-actions" style="margin-top:10px;justify-content:flex-start;flex-wrap:wrap">
                <button class="btn primary" data-reconnect-current-device="${escapeHtml(vaultId)}">
                  ${lucide('key-round', 14)}
                  ${escapeHtml(t('sync.cloudSetup.devices.reconnect'))}
                </button>
              </div>
            `
            : ''
        }
      </section>
    `;
  }

  return `
    <section class="yanta-cloud-section" id="yanta-cloud-devices">
      <h4>${escapeHtml(t('sync.cloudSetup.devices.title'))}</h4>
      <p>
        ${escapeHtml(max
          ? t('sync.cloudSetup.devices.activeOfMax', { count: active.length, max })
          : t('sync.cloudSetup.devices.active', { count: active.length }))}
      </p>

      <div class="yanta-cloud-device-list">
        ${devices.map((d) => {
          const current = d.deviceId === currentDeviceId;
          const revoked = d.active === false;

          return `
            <div class="yanta-cloud-device-row ${current ? 'current' : ''} ${revoked ? 'revoked' : ''}">
              <div>
                <strong>${escapeHtml(d.name || deviceInfoLine(d) || d.deviceId || t('sync.cloudSetup.devices.device'))}</strong>
                <small>${escapeHtml(deviceInfoLine(d))}</small>
                <small>ID: ${escapeHtml(d.deviceId || '')}</small>
                <small>${escapeHtml(t('sync.cloudSetup.devices.lastSeen', { time: fmtDeviceTime(d.lastSeenAt) }))}</small>
                ${revoked ? `<small class="warn">${escapeHtml(t('sync.cloudSetup.devices.removed'))}</small>` : ''}
              </div>

              ${
                current
                  ? `<span class="yanta-cloud-device-current">${escapeHtml(t('sync.cloudSetup.devices.current'))}</span>`
                  : revoked
                    ? `
                      <button class="btn" data-remove-cloud-device="${escapeHtml(d.deviceId)}" data-device-already-revoked="1">
                        ${lucide('x', 14)}
                        ${escapeHtml(t('sync.cloudSetup.devices.clear'))}
                      </button>
                    `
                    : `
                      <button class="btn danger" data-remove-cloud-device="${escapeHtml(d.deviceId)}">
                        ${lucide('trash', 14)}
                        ${escapeHtml(t('sync.cloudSetup.devices.remove'))}
                      </button>
                    `
              }
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

async function runRepairCloudSync() {
  try {
    const ok = await yantaConfirm({
      title: t('sync.cloudSetup.repair.title'),
      message: t('sync.cloudSetup.repair.message'),
      confirmLabel: t('sync.cloudSetup.repair.confirm'),
      cancelLabel: t('common.cancel'),
      icon: 'wrench',
    });

    if (!ok) return;

    setStatus(t('sync.cloudSetup.repair.running'));

    if (typeof window.yantaSync2CatchupNow === 'function') {
      await window.yantaSync2CatchupNow({
        interactive: true,
      });
    } else {
      await window.yantaSync2?.pushFullStateNow?.({
        includeSnapshots: true,
        verbose: false,
      });

      await window.yantaSync2?.syncNow?.({
        verbose: false,
        pullSnapshots: true,
      });
    }

    setStatus(t('sync.cloudSetup.repair.done'), 'success');
    toast(t('sync.cloudSetup.repair.done'), 'success');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || t('sync.cloudSetup.repair.failed'), 'error');
  }
}

async function renderCloudHome(me) {
  const vaults = me.vaults || [];
  const configuredVaultId = await configuredYantaCloudVaultId();
  const currentDeviceId = window.yantaSync2?.deviceId || window.yantaSync2?.engine?.deviceId || '';

  const {
    devices: activeDevices,
    accessError: deviceAccessError,
    blockReason: deviceBlockReason,
  } = await loadVaultDevicesForHome(configuredVaultId, currentDeviceId);

  const canManageActiveVault =
    !!configuredVaultId &&
    !!currentDeviceId &&
    !deviceAccessError;

    const plan = me.user?.plan || 'free';
    const limits = me.limits || {};
    const maxVaults = Number(limits.vaults || 1);
    const canCreateAnotherVault = vaults.length < maxVaults;
    const hasAnyVault = vaults.length > 0;

  renderShell('YANTA Cloud', `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('cloud-check', 28)}</div>
      <div>
        <strong>${escapeHtml(t('sync.cloudSetup.home.signedInAs', { email: me.user?.email || '' }))}</strong>
        <p>${escapeHtml(t('sync.cloudSetup.home.lead'))}</p>
      </div>
    </div>

    <div class="yanta-cloud-warning">
      <strong>${escapeHtml(t('sync.cloudSetup.home.importantLabel'))}</strong> ${escapeHtml(t('sync.cloudSetup.home.important'))}
    </div>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.home.usage'))}</h4>
      <div data-cloud-usage-section>
        ${usageBarsHtml(me)}
      </div>
    </section>

    ${cloudPlanSectionHtml(me)}

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.home.howTitle'))}</h4>

      <div class="yanta-cloud-limit-note">
        ${lucide('info', 14)}
        <span>
          ${escapeHtml(t('sync.cloudSetup.home.howJournal'))}
          <br><br>
          ${escapeHtml(t('sync.cloudSetup.home.howDevices'))}
        </span>
      </div>
    </section>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.vaults.title'))}</h4>
      <p>${escapeHtml(
        vaults.length
          ? t('sync.cloudSetup.vaults.lead')
          : t('sync.cloudSetup.vaults.none')
      )}</p>

      <div class="yanta-cloud-grid">
        ${
          vaults.map((v) => {
            const active = v.id === configuredVaultId;
            const activeButBlocked = active && !canManageActiveVault;

            return `
              <div class="yanta-cloud-vault-card" data-vault-card="${escapeHtml(v.id)}"
                style="
                  padding:12px;
                  border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
                  border-radius:12px;
                  background:${active ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-elev))' : 'var(--bg-elev-2)'};
                  display:flex;
                  flex-direction:column;
                  gap:9px;
                ">
                <div style="display:flex;align-items:center;gap:8px;min-width:0">
                  <span style="display:inline-flex;color:${active ? 'var(--accent)' : 'var(--text-dim)'}">
                    ${lucide(active ? 'cloud-check' : 'database', 16)}
                  </span>
                  <strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${escapeHtml(v.name || v.id)}
                  </strong>
                  ${
                    active
                      ? `<span style="font-size:11px;color:${activeButBlocked ? 'var(--yellow)' : 'var(--accent)'};font-weight:800">
                          ${escapeHtml(
                            !activeButBlocked
                              ? t('sync.cloudSetup.vaults.active')
                              : deviceBlockReason === 'revoked'
                                ? t('sync.cloudSetup.vaults.blocked')
                                : t('sync.cloudSetup.vaults.notHere')
                          )}
                        </span>`
                      : ''
                  }
                </div>

                <div style="font-size:11px;color:var(--text-faint);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${escapeHtml(v.id)}
                </div>

                <div class="compress-actions" style="justify-content:flex-start;flex-wrap:wrap">
                  ${
                  active && canManageActiveVault
                    ? `
                      <button class="btn primary" data-vault-action="connect-device" data-vault-id="${escapeHtml(v.id)}">
                        ${lucide('qr-code', 14)}
                        ${escapeHtml(t('sync.cloudSetup.vaults.connectAnother'))}
                      </button>

                      <button class="btn" data-vault-action="sync-now" data-vault-id="${escapeHtml(v.id)}">
                        ${lucide('refresh-cw', 14)}
                        ${escapeHtml(t('settings.sync.syncNow'))}
                      </button>

                      <button class="btn" data-vault-action="repair-sync" data-vault-id="${escapeHtml(v.id)}">
                        ${lucide('wrench', 14)}
                        ${escapeHtml(t('sync.cloudSetup.vaults.repair'))}
                      </button>

                      <button class="btn" data-vault-action="compact-sync" data-vault-id="${escapeHtml(v.id)}">
                        ${lucide('archive', 14)}
                        ${escapeHtml(t('sync.cloudSetup.vaults.optimize'))}
                      </button>

                    `
                      : active && activeButBlocked && deviceBlockReason === 'revoked'
                        ? `
                          <button class="btn" disabled>
                            ${lucide('ban', 14)}
                            ${escapeHtml(t('sync.cloudSetup.devices.removedButton'))}
                          </button>

                          <button class="btn primary" data-vault-action="connect-this-device" data-vault-id="${escapeHtml(v.id)}">
                            ${lucide('key', 14)}
                            ${escapeHtml(t('sync.cloudSetup.devices.reconnect'))}
                          </button>
                        `
                        : `
                          <button class="btn primary" data-vault-action="connect-this-device" data-vault-id="${escapeHtml(v.id)}">
                            ${lucide('key', 14)}
                            ${escapeHtml(t('sync.cloudSetup.devices.connect'))}
                          </button>
                        `
                  }
                </div>
              </div>
            `;
          }).join('')
        }

${
  !hasAnyVault
    ? `
      <button class="btn primary" data-create-vault>
        ${lucide('plus', 14)}
        ${escapeHtml(t('sync.cloudSetup.vaults.create'))}
      </button>
    `
    : canCreateAnotherVault
      ? `
        <details class="yanta-cloud-advanced">
          <summary>${escapeHtml(t('sync.cloudSetup.vaults.advanced'))}</summary>

          <div class="yanta-cloud-advanced-body">
            <p>
              ${escapeHtml(t('sync.cloudSetup.vaults.advancedHint'))}
            </p>

            <button class="btn" data-create-vault>
              ${lucide('plus', 14)}
              ${escapeHtml(t('sync.cloudSetup.vaults.createAnother'))}
            </button>
          </div>
        </details>
      `
      : `

      `
}
      </div>
    </section>

    ${
      configuredVaultId
        ? cloudDevicesHtml({
            devices: activeDevices,
            limits: me.limits || {},
            currentDeviceId,
            accessError: deviceAccessError,
            blockReason: deviceBlockReason,
            vaultId: configuredVaultId,
          })
        : ''
    }
  `);

  statusEl = modal.querySelector('[data-status]');

  bindCloudUsageTooltips(modal);

  hydrateUsageWithStorageBreakdown({
    me,
    vaultId: configuredVaultId,
    currentDeviceId,
  }).catch(() => {});

  modal.querySelector('[data-create-vault]')?.addEventListener('click', async () => {
    try {
      setStatus(t('sync.cloudSetup.vaults.creating'));

      const res = await cloudCreateVault({
        name: t('sync.cloudSetup.vaults.defaultName'),
      });

      renderRecoveryStep(res.vault.id, {
        mode: 'new',
      });
    } catch (err) {
      setStatus(err?.message || t('sync.cloudSetup.vaults.createFailed'), 'error');
    }
  });

  modal.querySelector('[data-yanta-plus-upgrade]')?.addEventListener('click', async () => {
    try {
      setStatus(t('sync.cloudSetup.plan.openingCheckout'));

      const { openYantaPlusUpgrade } = await import('../billing/billing-ui.js');

      await openYantaPlusUpgrade({
        interval: 'yearly',
      });
    } catch (err) {
      console.error(err);
      setStatus(err?.message || t('settings.billing.checkoutError'), 'error');
    }
  });

  modal.querySelector('[data-yanta-plus-manage]')?.addEventListener('click', async () => {
    try {
      setStatus(t('sync.cloudSetup.plan.openingPortal'));

      const { openYantaBillingPortal } = await import('../billing/billing-ui.js');

      await openYantaBillingPortal();
    } catch (err) {
      console.error(err);
      setStatus(err?.message || t('settings.billing.portalError'), 'error');
    }
  });

  reconcileCloudPlanSectionIfStale(modal, me);

  modal.querySelectorAll('[data-vault-action="connect-this-device"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      connectThisDeviceToVault(btn.dataset.vaultId);
    });
  });

  modal.querySelectorAll('[data-vault-action="connect-device"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openConnectAnotherDeviceForVault(btn.dataset.vaultId);
    });
  });

  modal.querySelectorAll('[data-vault-action="sync-now"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        setStatus(t('settings.sync.synchronizing'));

        if (typeof window.yantaSync2Now === 'function') {
          await window.yantaSync2Now({
            interactive: true,
            catchUp: false,
          });
        } else {
          await window.yantaSync2?.syncNow?.({
            verbose: false,
            pullSnapshots: false,
          });
        }

        setStatus(t('settings.sync.syncCompleteToast'), 'success');
        toast(t('settings.sync.syncCompleteToast'), 'success');
      } catch (err) {
        setStatus(err?.message || t('settings.sync.syncFailedToast'), 'error');
      }
    });
  });

  modal.querySelectorAll('[data-vault-action="repair-sync"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await runRepairCloudSync();
    });
  });

  modal.querySelectorAll('[data-vault-action="compact-sync"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const ok = await yantaConfirm({
          title: t('sync.cloudSetup.compact.title'),
          message: t('sync.cloudSetup.compact.message'),
          confirmLabel: t('sync.cloudSetup.compact.confirm'),
          cancelLabel: t('common.cancel'),
          icon: 'archive',
        });

        if (!ok) return;

        setStatus(t('sync.cloudSetup.compact.running'));

        const result = await window.yantaSync2CompactNow?.({
          emergencyHeadroom: true,
          keepSnapshotsPerDoc: 2,
        });

        setStatus(
          t('sync.cloudSetup.compact.done', { mb: Math.round(Number(result?.freedBytes || 0) / 1024 / 1024 * 100) / 100 }),
          'success'
        );

        toast(t('sync.cloudSetup.compact.doneToast'), 'success');

        await renderCloudHome(await cloudMe());
      } catch (err) {
        console.error(err);
        setStatus(err?.message || t('sync.cloudSetup.compact.failed'), 'error');
        toast(t('sync.cloudSetup.compact.failed'), 'error');
      }
    });
  });

  async function revokeChatAccessAfterDeviceRemoval() {
    try {
      const mod = await import('../chat/matrix-session.js');
      await mod.rotateChatPasswordForDeviceRemoval();
    } catch (err) {
      console.warn('[YANTA Cloud] Chat access rotation after device removal failed', err);
      toast(t('sync.cloudSetup.devices.chatRevokeFailed'), 'error');
    }
  }

  modal.querySelectorAll('[data-remove-cloud-device]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const deviceId = btn.dataset.removeCloudDevice || '';

      if (!configuredVaultId || !deviceId) return;

      /*
        Clearing an entry that was already removed only tidies the list —
        access was cut when it was revoked. Asking the full scary
        question again would be theatre.
      */
      const alreadyRevoked = btn.dataset.deviceAlreadyRevoked === '1';

      const ok = alreadyRevoked
        ? await yantaConfirm({
            title: t('sync.cloudSetup.devices.clearTitle'),
            message: t('sync.cloudSetup.devices.clearMessage', { id: deviceId }),
            confirmLabel: t('sync.cloudSetup.devices.clearConfirm'),
            cancelLabel: t('common.cancel'),
            icon: 'x',
          })
        : await yantaConfirm({
        title: t('sync.cloudSetup.devices.removeTitle'),
        message: t('sync.cloudSetup.devices.removeMessage', { id: deviceId }),
        confirmLabel: t('sync.cloudSetup.devices.removeConfirm'),
        cancelLabel: t('common.cancel'),
        danger: true,
        icon: 'trash',
      });

      if (!ok) return;

      try {
        setStatus(alreadyRevoked ? t('sync.cloudSetup.devices.clearing') : t('sync.cloudSetup.devices.removing'));

        await cloudRemoveVaultDevice(configuredVaultId, deviceId, {
          currentDeviceId,
        });

        /*
          Cut the removed device off from Chat too. Revoking the cloud
          device alone leaves its independent Matrix session intact, so we
          rotate the shared Chat password (revokes all other Matrix
          devices; remaining trusted devices silently re-login from the
          synced Vault).

          Skipped when only tidying an already-revoked row: its Chat access
          was cut at the time, and rotating again would sign every other
          device out for nothing.
        */
        if (!alreadyRevoked) {
          await revokeChatAccessAfterDeviceRemoval();
        }

        setStatus(alreadyRevoked ? t('sync.cloudSetup.devices.cleared') : t('sync.cloudSetup.devices.removedToast'), 'success');
        toast(alreadyRevoked ? t('sync.cloudSetup.devices.clearedToast') : t('sync.cloudSetup.devices.removedToast'), 'success');

        await renderCloudHome(await cloudMe());
      } catch (err) {
        console.error(err);
        setStatus(err?.message || t('sync.cloudSetup.devices.removeFailed'), 'error');
      }
    });
  });
  modal.querySelectorAll('[data-reconnect-current-device]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vaultId = btn.dataset.reconnectCurrentDevice || configuredVaultId;
  
      if (!vaultId) {
        setStatus(t('sync.cloudSetup.vaults.noneSelected'), 'error');
        return;
      }
  
      renderExistingVaultStep(vaultId, {
        reconnect: true,
      });
    });
  });
}

async function openConnectAnotherDeviceForVault(vaultId) {
  if (!vaultId) {
    setStatus(t('sync.cloudSetup.vaults.noneSelected'), 'error');
    return;
  }

  const local = await isLocalYantaCloudVault(vaultId);

  if (!local) {
    setStatus(
      t('sync.cloudSetup.vaults.notLocal'),
      'error'
    );
    return;
  }

  const syncKey = await getSync2SyncKey();

  renderConnected(vaultId, syncKey);
}

async function connectThisDeviceToVault(vaultId) {
  if (!vaultId) {
    setStatus(t('sync.cloudSetup.vaults.noneSelected'), 'error');
    return;
  }

  renderExistingVaultStep(vaultId, {
    reconnect: false,
  });
}

function renderExistingVaultStep(vaultId, {
  reconnect = false,
} = {}) {
  renderShell(
    reconnect ? t('sync.cloudSetup.devices.reconnect') : t('sync.cloudSetup.existing.title'),
    `
      <div class="yanta-cloud-hero">
        <div class="yanta-cloud-hero-icon">${lucide(reconnect ? 'rotate-ccw-key' : 'key', 28)}</div>
        <div>
          <strong>${escapeHtml(reconnect ? t('sync.cloudSetup.existing.reconnectHeading') : t('sync.cloudSetup.existing.heading'))}</strong>
          <p>
            ${escapeHtml(reconnect ? t('sync.cloudSetup.existing.reconnectLead') : t('sync.cloudSetup.existing.lead'))}
          </p>
        </div>
      </div>

      ${
        reconnect
          ? `
            <div class="yanta-cloud-warning">
              <strong>${escapeHtml(t('sync.cloudSetup.existing.whyLabel'))}</strong>
              ${escapeHtml(t('sync.cloudSetup.existing.why'))}
            </div>
          `
          : ''
      }

      <section class="yanta-cloud-section">
        <h4>${escapeHtml(t('sync.cloudSetup.existing.inputTitle'))}</h4>
        <textarea class="text-input" data-recovery rows="6" placeholder="${escapeHtml(t('sync.cloudSetup.existing.inputPlaceholder'))}"></textarea>

        <div class="compress-actions" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn" data-back>${escapeHtml(t('common.back'))}</button>

          <button class="btn" data-scan-qr>
            ${lucide('qr-code', 14)}
            ${escapeHtml(t('sync.cloudSetup.existing.scanQr'))}
          </button>

          <span class="grow"></span>

          <button class="btn primary" data-connect>
            ${lucide('cloud-download', 14)}
            ${escapeHtml(reconnect ? t('sync.cloudSetup.existing.reconnectPull') : t('sync.cloudSetup.existing.connectPull'))}
          </button>
        </div>
      </section>
    `
  );

  modal.querySelector('[data-back]')?.addEventListener('click', async () => {
    await renderCloudHome(await cloudMe());
  });

  modal.querySelector('[data-scan-qr]')?.addEventListener('click', async () => {
    try {
      setStatus(t('sync.cloudSetup.existing.openingCamera'));

      const text = await scanQrWithCamera();

      const input = modal.querySelector('[data-recovery]');
      if (input) input.value = text || '';

      setStatus(t('sync.cloudSetup.existing.scanned'), 'success');
    } catch (err) {
      console.error(err);
      setStatus(err?.message || t('sync.cloudSetup.existing.scanFailed'), 'error');
    }
  });

  modal.querySelector('[data-connect]')?.addEventListener('click', async () => {
    const raw = modal.querySelector('[data-recovery]')?.value?.trim();

    if (!raw) {
      setStatus(t('sync.cloudSetup.existing.inputMissing'), 'error');
      return;
    }

    try {
      setStatus(t('sync.cloudSetup.existing.reading'));

      let payload = null;
      let key = '';

      if (raw.startsWith('yanta-sync2:') || raw.includes('#sync2=')) {
        payload = parseSync2PairingPayload(raw);

        if (payload.provider !== 'yanta-cloud') {
          throw new Error(t('sync.cloudSetup.pairing.notCloud'));
        }

        if (payload.cloud?.vaultId && payload.cloud.vaultId !== vaultId) {
          throw new Error(t('sync.cloudSetup.pairing.otherVault'));
        }

        key = payload.syncKey;
      } else {
        // Tolerates the printed Recovery Kit form (grouped with spaces)
        // and a pasted recovery JSON file, not just the bare key.
        key = extractSyncKeyFromRecoveryInput(raw);

        syncKeyToBytes(key);
      }

      const baseUrl =
        payload?.cloud?.baseUrl ||
        YANTA_CLOUD_BASE_URL;

      /*
        This is the key part:
        If this browser/device was removed before, the old sync2.deviceId
        is revoked on the server. Reconnect must use a new device id.
      */
      await prepareFreshYantaCloudDeviceIdentity({
        reason: reconnect
          ? 'reconnect-existing-vault'
          : 'connect-existing-vault',
      });

      // Verify before storing: storing replaces this device's key.
      setStatus(t('sync.cloudSetup.existing.checkingKey'));

      await verifyYantaCloudSyncKey({
        baseUrl,
        vaultId,
        syncKey: key,
      });

      if (payload) {
        await applySync2PairingPayload(payload);
      } else {
        await setSync2SyncKey(key);
      }

      await store.settings.set('sync2.provider', 'yanta-cloud');
      await store.settings.set('sync2.yantaCloud.vaultId', vaultId);
      await store.settings.set('sync2.yantaCloud.baseUrl', baseUrl);

      setStatus(t('sync.cloudSetup.existing.removingWelcome'));

      await removePristineWelcomeVaultIfPresent({
        reason: reconnect
          ? 'yanta-cloud-reconnect'
          : 'yanta-cloud-connect-existing',
      });

      setStatus(t('sync.cloudSetup.connecting'));

      const runtime = await createSync2YantaCloudAppRuntime({
        baseUrl,
        vaultId,
      });

      publishYantaCloudRuntime(runtime, {
        catchUp: false,
        syncNow: false,
        reason: reconnect
          ? 'yanta-cloud-reconnect'
          : 'yanta-cloud-connect-existing',
      });

      setStatus(t('sync.cloudSetup.pulling'));

      await runtime.syncNow({
        verbose: false,
        pullSnapshots: true,
      });

      toast(
        reconnect
          ? t('sync.cloudSetup.existing.reconnected')
          : t('sync.cloudSetup.connected'),
        'success'
      );

      renderConnected(vaultId, runtime.syncKey);
    } catch (err) {
      console.error(err);
      setStatus(
        err?.code === 'EWRONGKEY'
          ? t('sync.cloudSetup.wrongKey')
          : err?.message ||
            (reconnect ? t('sync.cloudSetup.existing.reconnectFailed') : t('sync.cloudSetup.existing.connectFailed')),
        'error'
      );
      toast(
        reconnect ? t('sync.cloudSetup.existing.reconnectFailedToast') : t('sync.cloudSetup.existing.connectFailedToast'),
        'error'
      );
    }
  });
}

async function renderRecoveryStep(vaultId, { mode = 'new' } = {}) {
  const syncKey = await getSync2SyncKey();

  renderShell(t('sync.cloudSetup.recovery.title'), `
    <div class="yanta-cloud-warning">
      <strong>${escapeHtml(t('sync.cloudSetup.recovery.warningTitle'))}</strong><br>
      ${escapeHtml(t('sync.cloudSetup.recovery.warning'))}
    </div>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.recovery.key'))}</h4>
      <textarea class="text-input yanta-cloud-recovery" data-key rows="5" readonly>${escapeHtml(syncKey)}</textarea>

      <div class="compress-actions" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn" data-copy>${lucide('copy', 14)} ${escapeHtml(t('common.copy'))}</button>
        <button class="btn" data-download>${lucide('download', 14)} ${escapeHtml(t('sync.cloudSetup.recovery.download'))}</button>
        <button class="btn" data-print-kit>${lucide('printer', 14)} ${escapeHtml(t('sync.cloudSetup.printKit'))}</button>
      </div>

      <label class="yanta-cloud-warning" style="display:flex;gap:8px;align-items:flex-start;margin-top:12px">
        <input type="checkbox" data-confirm />
        <span>${escapeHtml(t('sync.cloudSetup.recovery.understand'))}</span>
      </label>

      <div class="compress-actions" style="margin-top:10px">
        <span class="grow"></span>
        <button class="btn primary" data-enable>${lucide('cloud-upload', 14)} ${escapeHtml(t('sync.cloudSetup.recovery.enable'))}</button>
      </div>
    </section>
  `);

  modal.querySelector('[data-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(syncKey);
      toast(t('sync.cloudSetup.recovery.copied'), 'success');
    } catch {
      toast(t('sync.cloudSetup.copyFailed'), 'error');
    }
  });

  modal.querySelector('[data-download]')?.addEventListener('click', () => {
    const payload = {
      app: 'YANTA',
      type: 'yanta-recovery-key',
      version: 1,
      provider: 'yanta-cloud',
      vaultId,
      created: new Date().toISOString(),
      syncKey,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yanta-recovery-${vaultId}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  modal.querySelector('[data-print-kit]')?.addEventListener('click', async () => {
    try {
      let accountEmail = '';

      try {
        accountEmail = (await cloudMe())?.user?.email || '';
      } catch {}

      await printRecoveryKit({
        provider: 'yanta-cloud',
        vaultId,
        syncKey,
        accountEmail,
      });
    } catch (err) {
      console.error(err);
      setStatus(err?.message || t('sync.cloudSetup.printKitFailed'), 'error');
    }
  });

  modal.querySelector('[data-enable]')?.addEventListener('click', async () => {
    if (!modal.querySelector('[data-confirm]')?.checked) {
      setStatus(t('sync.cloudSetup.recovery.confirmSaved'), 'error');
      return;
    }

    try {
      setStatus(t('sync.cloudSetup.connecting'));

      await store.settings.set('sync2.provider', 'yanta-cloud');
      await store.settings.set('sync2.yantaCloud.vaultId', vaultId);
      await store.settings.set('sync2.yantaCloud.baseUrl', YANTA_CLOUD_BASE_URL);

      const runtime = await createSync2YantaCloudAppRuntime({
        baseUrl: YANTA_CLOUD_BASE_URL,
        vaultId,
      });

      publishYantaCloudRuntime(runtime, {
        catchUp: false,
        syncNow: false,
        reason: 'yanta-cloud-create-vault',
      });

      setStatus(t('sync.cloudSetup.recovery.uploading'));

      await runtime.pushFullStateNow({
        includeSnapshots: true,
        verbose: false,
      });

      setStatus(t('sync.cloudSetup.recovery.finalizing'));

      await runtime.engine?.uploadOutbox?.();

      toast(t('sync.cloudSetup.recovery.enabled'), 'success');

      renderConnected(vaultId, syncKey);
    } catch (err) {
      console.error(err);
      setStatus(err?.message || t('sync.cloudSetup.recovery.enableFailed'), 'error');
    }
  });
}

async function renderConnected(vaultId, syncKey) {
  const baseUrl = await configuredYantaCloudBaseUrl();

  const pairingUrl = await createSync2PairingUrl({
    provider: 'yanta-cloud',
    cloud: {
      vaultId,
      baseUrl,
    },
  });

  const rawPayload = await createSync2PairingPayload({
    provider: 'yanta-cloud',
    cloud: {
      vaultId,
      baseUrl,
    },
  });

  renderShell(t('sync.cloudSetup.vaults.connectAnother'), `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('qr-code', 28)}</div>
      <div>
        <strong>${escapeHtml(t('sync.cloudSetup.pair.heading'))}</strong>
        <p>${escapeHtml(t('sync.cloudSetup.pair.lead'))}</p>
      </div>
    </div>

    <div class="yanta-cloud-warning">
      <strong>${escapeHtml(t('sync.cloudSetup.pair.privateLabel'))}</strong> ${escapeHtml(t('sync.cloudSetup.pair.private'))}
    </div>

    <div class="yanta-cloud-qr" data-qr></div>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.pair.link'))}</h4>
      <textarea class="text-input" data-pairing-link rows="4" readonly>${escapeHtml(pairingUrl)}</textarea>

      <h4 style="margin-top:14px">${escapeHtml(t('sync.cloudSetup.pair.raw'))}</h4>
      <textarea class="text-input" data-pairing rows="4" readonly>${escapeHtml(rawPayload)}</textarea>

      <div class="compress-actions" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn" data-copy-link>${lucide('copy', 14)} ${escapeHtml(t('sync.cloudSetup.pair.copyLink'))}</button>
        <button class="btn" data-copy-pairing>${lucide('copy', 14)} ${escapeHtml(t('sync.cloudSetup.pair.copyRaw'))}</button>
        <button class="btn" data-print-kit>${lucide('printer', 14)} ${escapeHtml(t('sync.cloudSetup.printKit'))}</button>
        <button class="btn" data-sync-now>${lucide('refresh-cw', 14)} ${escapeHtml(t('settings.sync.syncNow'))}</button>
        <button class="btn" data-repair-sync>${lucide('wrench', 14)} ${escapeHtml(t('sync.cloudSetup.vaults.repair'))}</button>
        <button class="btn" data-compact-sync>${lucide('archive', 14)} ${escapeHtml(t('sync.cloudSetup.vaults.optimize'))}</button>
        <span class="grow"></span>
        <button class="btn" data-back-cloud-home>${escapeHtml(t('common.back'))}</button>
        <button class="btn primary" data-yanta-cloud-close>${escapeHtml(t('common.done'))}</button>
      </div>
    </section>
  `);

  statusEl = modal.querySelector('[data-status]');

  modal.querySelector('[data-qr]')?.append(renderSync2QrSvg(pairingUrl, 240));

  modal.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pairingUrl);
      toast(t('sync.cloudSetup.pair.linkCopied'), 'success');
    } catch {
      toast(t('sync.cloudSetup.copyFailed'), 'error');
    }
  });

  modal.querySelector('[data-copy-pairing]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(rawPayload);
      toast(t('sync.cloudSetup.pair.rawCopied'), 'success');
    } catch {
      toast(t('sync.cloudSetup.copyFailed'), 'error');
    }
  });

  modal.querySelector('[data-print-kit]')?.addEventListener('click', async () => {
    try {
      let accountEmail = '';

      try {
        accountEmail = (await cloudMe())?.user?.email || '';
      } catch {}

      await printRecoveryKit({
        provider: 'yanta-cloud',
        vaultId,
        syncKey,
        accountEmail,
      });
    } catch (err) {
      console.error(err);
      setStatus(err?.message || t('sync.cloudSetup.printKitFailed'), 'error');
    }
  });

  modal.querySelector('[data-sync-now]')?.addEventListener('click', async () => {
    try {
      setStatus(t('settings.sync.synchronizing'));

      if (typeof window.yantaSync2Now === 'function') {
        await window.yantaSync2Now({
          interactive: true,
          catchUp: false,
        });
      } else {
        await window.yantaSync2?.syncNow?.({
          verbose: false,
          pullSnapshots: false,
        });
      }

      setStatus(t('settings.sync.syncCompleteToast'), 'success');
      toast(t('settings.sync.syncCompleteToast'), 'success');
    } catch (err) {
      setStatus(err?.message || t('settings.sync.syncFailedToast'), 'error');
    }
  });

  modal.querySelector('[data-repair-sync]')?.addEventListener('click', async () => {
    await runRepairCloudSync();
  });

  modal.querySelector('[data-compact-sync]')?.addEventListener('click', async () => {
    try {
      const ok = await yantaConfirm({
        title: t('sync.cloudSetup.compact.title'),
        message: t('sync.cloudSetup.compact.messageSnapshots'),
        confirmLabel: t('sync.cloudSetup.compact.confirm'),
        cancelLabel: t('common.cancel'),
        icon: 'archive',
      });

      if (!ok) return;

      setStatus(t('sync.cloudSetup.compact.running'));

      const result = await window.yantaSync2CompactNow?.({
        emergencyHeadroom: true,
        keepSnapshotsPerDoc: 2,
      });

      setStatus(
        t('sync.cloudSetup.compact.done', { mb: Math.round(Number(result?.freedBytes || 0) / 1024 / 1024 * 100) / 100 }),
        'success'
      );

      toast(t('sync.cloudSetup.compact.doneToast'), 'success');
    } catch (err) {
      console.error(err);
      setStatus(err?.message || t('sync.cloudSetup.compact.failed'), 'error');
      toast(t('sync.cloudSetup.compact.failed'), 'error');
    }
  });

  modal.querySelector('[data-back-cloud-home]')?.addEventListener('click', async () => {
    await renderCloudHome(await cloudMe());
  });
}

export async function openYantaCloudSetupWithPayload(pairingText, {
  fromHistory = false,
} = {}) {
  lastPairingTextForHistory = String(pairingText || '');

  markYantaCloudSetupOverlayOpen({
    fromHistory,
  });

  ensureModal();
  modal.hidden = false;

  let payload = null;

  try {
    payload = parseSync2PairingPayload(pairingText);
  } catch (err) {
    renderLogin();
    setStatus(err?.message || t('sync.cloudSetup.pairing.invalid'), 'error');
    return;
  }

  if (payload.provider !== 'yanta-cloud') {
    renderLogin();
    setStatus(t('sync.cloudSetup.pairing.notCloud'), 'error');
    return;
  }

  const me = await cloudMe().catch(() => null);

  if (!me?.authenticated) {
    renderLoginForPendingPairing(pairingText);
    return;
  }

  await connectYantaCloudFromPairing(pairingText);
}

function renderLoginForPendingPairing(pairingText) {
  renderShell(t('sync.cloudSetup.pairing.loginTitle'), `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('smartphone', 28)}</div>
      <div>
        <strong>${escapeHtml(t('sync.cloudSetup.pairing.loginHeading'))}</strong>
        <p>${escapeHtml(t('sync.cloudSetup.pairing.loginLead'))}</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.login.email'))}</h4>
      <div class="yanta-cloud-grid">
        <input class="text-input" data-email placeholder="${escapeHtml(t('sync.cloudSetup.login.emailPlaceholder'))}" autocomplete="email" />
        <div data-turnstile></div>
        ${guestOptionHtml()}
        <button class="btn primary" data-send-code>${lucide('mail', 14)} ${escapeHtml(t('sync.cloudSetup.login.sendCode'))}</button>
      </div>
    </section>
  `);

  renderTurnstile(modal.querySelector('[data-turnstile]'));
  hideGuestOptionOnOwnDevice();

  modal.querySelector('[data-send-code]')?.addEventListener('click', async () => {
    const email = modal.querySelector('[data-email]')?.value?.trim();

    if (!email) {
      setStatus(t('sync.cloudSetup.login.enterEmail'), 'error');
      return;
    }

    try {
      setStatus(t('sync.cloudSetup.login.sending'));

      guestRequested = !!modal.querySelector('[data-guest]')?.checked;
      await cloudSendCode(email, turnstileToken);

      renderCodeForPendingPairing(email, pairingText);
    } catch (err) {
      setStatus(err?.message || t('sync.cloudSetup.login.sendFailed'), 'error');
    }
  });
}

function renderCodeForPendingPairing(email, pairingText) {
  renderShell(t('sync.cloudSetup.code.title'), `
    <div class="yanta-cloud-hero">
      <div class="yanta-cloud-hero-icon">${lucide('key-round', 28)}</div>
      <div>
        <strong>${escapeHtml(t('sync.cloudSetup.code.heading'))}</strong>
        <p>${escapeHtml(t('sync.cloudSetup.pairing.codeLead'))}</p>
      </div>
    </div>

    <section class="yanta-cloud-section">
      <h4>${escapeHtml(t('sync.cloudSetup.code.label'))}</h4>
      <input class="text-input" data-code placeholder="123456" inputmode="numeric" maxlength="6" />
      <div class="compress-actions" style="margin-top:10px">
        <button class="btn" data-back>${escapeHtml(t('common.back'))}</button>
        <span class="grow"></span>
        <button class="btn primary" data-verify>${lucide('check', 14)} ${escapeHtml(t('common.continue'))}</button>
      </div>
    </section>
  `);

  modal.querySelector('[data-back]')?.addEventListener('click', () => {
    renderLoginForPendingPairing(pairingText);
  });

  modal.querySelector('[data-code]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      modal.querySelector('[data-verify]')?.click();
    }
  });

  modal.querySelector('[data-verify]')?.addEventListener('click', async () => {
    const code = modal.querySelector('[data-code]')?.value?.trim();

    if (!code) {
      setStatus(t('sync.cloudSetup.code.enter'), 'error');
      return;
    }

    try {
      setStatus(t('sync.cloudSetup.code.verifying'));

      const verified = await cloudVerifyCode(email, code);
      if (verified?.mfaRequired) {
        renderMfaLogin(verified.mfaToken, async () => {
          if (guestRequested) await enterGuestMode();
          await connectYantaCloudFromPairing(pairingText);
        });
        return;
      }
      if (guestRequested) await enterGuestMode();

      await connectYantaCloudFromPairing(pairingText);
    } catch (err) {
      setStatus(err?.message || t('sync.cloudSetup.code.failed'), 'error');
    }
  });

  setTimeout(() => modal.querySelector('[data-code]')?.focus(), 0);
}

async function connectYantaCloudFromPairing(pairingText) {
  try {
    setStatus(t('sync.cloudSetup.pairing.reading'));

    const payload = parseSync2PairingPayload(pairingText);

    if (payload.provider !== 'yanta-cloud') {
      throw new Error(t('sync.cloudSetup.pairing.notCloud'));
    }

    const vaultId = payload.cloud?.vaultId;

    if (!vaultId) {
      throw new Error(t('sync.cloudSetup.pairing.noVault'));
    }

    const baseUrl = payload.cloud?.baseUrl || YANTA_CLOUD_BASE_URL;

    /*
      A pairing link replaces this device's sync key. Opening one must
      never silently swap out the key of a device that already syncs.
    */
    const alreadySyncing = !!(await store.settings.get('sync2.provider', null));

    if (alreadySyncing && await hasDifferentStoredSync2SyncKey(payload.syncKey)) {
      const replace = await yantaConfirm({
        title: t('sync.cloudSetup.pairing.replaceTitle'),
        message: t('sync.cloudSetup.pairing.replaceMessage'),
        confirmLabel: t('sync.cloudSetup.pairing.replaceConfirm'),
        danger: true,
      });

      if (!replace) {
        setStatus(t('sync.cloudSetup.pairing.cancelled'));
        return;
      }
    }

    setStatus(t('sync.cloudSetup.existing.checkingKey'));

    await verifyYantaCloudSyncKey({
      baseUrl,
      vaultId,
      syncKey: payload.syncKey,
    });

    await applySync2PairingPayload(payload);

    await store.settings.set('sync2.provider', 'yanta-cloud');
    await store.settings.set('sync2.yantaCloud.vaultId', vaultId);
    await store.settings.set('sync2.yantaCloud.baseUrl', baseUrl);

    setStatus(t('sync.cloudSetup.existing.removingWelcome'));

    await removePristineWelcomeVaultIfPresent({
      reason: 'yanta-cloud-pairing',
    });

    setStatus(t('sync.cloudSetup.connecting'));

    const runtime = await createSync2YantaCloudAppRuntime({
      baseUrl,
      vaultId,
    });

    publishYantaCloudRuntime(runtime, {
      catchUp: false,
      syncNow: false,
      reason: 'yanta-cloud-pairing',
    });

    setStatus(t('sync.cloudSetup.pulling'));

    await runtime.syncNow({
      verbose: false,
      pullSnapshots: true,
    });

    toast(t('sync.cloudSetup.pairing.connected'), 'success');

    renderConnected(vaultId, runtime.syncKey);
  } catch (err) {
    console.error(err);
    setStatus(
      err?.code === 'EWRONGKEY'
        ? t('sync.cloudSetup.pairing.wrongKey')
        : err?.message || t('sync.cloudSetup.pairing.failed'),
      'error'
    );
    toast(t('sync.cloudSetup.pairing.failedToast'), 'error');
  }
}