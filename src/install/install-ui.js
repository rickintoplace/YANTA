// ============================================================
// YANTA — Install UI
//
// Renders computeInstallRecommendation() into a polished, self-updating
// card. The same card powers the Settings → "Install app" section and
// the standalone install modal opened from the dashboard hint, so the
// experience is identical wherever it appears.
// ============================================================

import {
  el,
  lucide,
  escapeHtml,
  toast,
} from '../core.js';

import { BRAND_LOGO_SVG } from '../brand-logo.js';

import { renderBrandedQrSvg } from '../qr.js';
import { openBoundOverlay } from '../overlay-history.js';

import {
  computeInstallRecommendation,
  promptInstall,
  requestWebNotificationPermission,
  browserInstallGuide,
  onInstallStateChange,
} from './install-manager.js';

function injectCss() {
  if (document.getElementById('yanta-install-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-install-css';
  style.textContent = `
.yanta-install {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-install-status {
  display: flex;
  align-items: center;
  gap: 10px;

  padding: 12px 14px;

  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);

  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-install-status.ok {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev));
  color: var(--text);
}

.yanta-install-status > svg { flex: 0 0 auto; color: var(--accent); }

.yanta-install-rec {
  display: flex;
  flex-direction: column;
  gap: 10px;

  padding: 16px;

  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev);
}

.yanta-install-rec.primary {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 7%, var(--bg-elev));
}

.yanta-install-rec-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.yanta-install-rec-head > svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--accent);
}

.yanta-install-rec-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.yanta-install-rec-text strong { color: var(--text); font-size: 14px; font-weight: 650; line-height: 1.35; }
.yanta-install-rec-text small { color: var(--text-dim); font-size: 12.5px; line-height: 1.5; }

.yanta-install-rec-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.yanta-install-guide {
  margin: 0;
  padding: 12px 12px 12px 30px;

  border-radius: 10px;
  border: 1px dashed var(--border);
  background: var(--bg);

  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.6;
}

.yanta-install-guide li { margin: 2px 0; }
.yanta-install-guide-note { margin-top: 8px; padding-left: 0; list-style: none; color: var(--text-dim); font-style: italic; }

.yanta-install-qr {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;

  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.yanta-install-qr-code {
  flex: 0 0 auto;
  padding: 8px;
  background: #fff;
  border-radius: 10px;
  line-height: 0;
}

.yanta-install-qr-body { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 6px; }
.yanta-install-qr-body strong { color: var(--text); font-size: 13px; }
.yanta-install-qr-body small { color: var(--text-dim); font-size: 12px; line-height: 1.45; word-break: break-all; }

.yanta-install-perfect {
  display: flex;
  align-items: center;
  gap: 12px;

  padding: 16px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev));
}

.yanta-install-perfect > svg { flex: 0 0 auto; color: var(--accent); }
.yanta-install-perfect strong { display: block; color: var(--text); font-size: 14px; }
.yanta-install-perfect small { color: var(--text-dim); font-size: 12.5px; line-height: 1.5; }

.yanta-install-modal .modal-card { max-width: 560px; }
`;

  document.head.append(style);
}

const PERFECT_COPY = {
  'android-app': {
    title: 'You’re all set',
    body: 'You’re using the YANTA Android app — reminders and chat arrive as reliable system notifications.',
  },
  'desktop-pwa': {
    title: 'Great setup',
    body: 'YANTA is installed and notifications are on. Everything will reach you as system notifications.',
  },
  'ios-pwa': {
    title: 'You’re all set',
    body: 'YANTA is on your Home Screen with notifications enabled.',
  },
  default: {
    title: 'You’re all set',
    body: 'Nothing to do here — your setup already delivers reliable notifications.',
  },
};

function notificationStatusRow(rec) {
  const { notifications } = rec;
  if (!notifications.applicable) return null;

  if (!notifications.supported) {
    return el('div', { class: 'yanta-install-status' },
      lucideEl('bell-off'),
      el('span', {}, 'This browser can’t show notifications. Install YANTA or use a different browser.'));
  }

  if (notifications.permission === 'denied') {
    return el('div', { class: 'yanta-install-status' },
      lucideEl('bell-off'),
      el('span', {}, 'Notifications are blocked. Re-enable them in your browser’s site settings for YANTA.'));
  }

  if (notifications.permission === 'granted') {
    // Test / per-category controls live in Settings → Notifications; keep
    // this a simple confirmation so the two surfaces don't duplicate.
    return el('div', { class: 'yanta-install-status ok' },
      lucideEl('bell-ring'),
      el('span', {}, 'Notifications are enabled on this device.'));
  }

  return null;
}

// core.js `lucide()` returns an HTML string; wrap it as a node.
function lucideEl(name, size = 18) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = lucide(name, size);
  return span.firstElementChild || span;
}

function guideElement(env) {
  const guide = browserInstallGuide(env);

  const list = el('ol', { class: 'yanta-install-guide' });
  for (const step of guide.steps) {
    list.append(el('li', {}, step));
  }
  if (guide.note) {
    list.append(el('li', { class: 'yanta-install-guide-note' }, guide.note));
  }

  return list;
}

function qrElement(url) {
  const wrap = el('div', { class: 'yanta-install-qr' });

  const code = el('div', { class: 'yanta-install-qr-code' });
  try {
    code.append(renderBrandedQrSvg(url, { size: 148, logo: BRAND_LOGO_SVG }));
  } catch {
    code.textContent = '';
  }

  const body = el('div', { class: 'yanta-install-qr-body' });
  body.append(
    el('strong', {}, 'Scan with your phone'),
    el('small', {}, 'Point your camera at the code to open the install page on your phone.'),
    el('small', {}, url),
  );

  wrap.append(code, body);
  return wrap;
}

/**
 * Builds one recommendation row with its CTA wired. `expanded` is a Set
 * of rec ids whose guide/QR panel is currently open, shared with the
 * parent so state survives re-renders.
 */
function recRow(rec, { env, isPrimary, expanded, rerender }) {
  const row = el('div', {
    class: `yanta-install-rec ${isPrimary ? 'primary' : ''}`,
  });

  const head = el('div', { class: 'yanta-install-rec-head' },
    lucideEl(rec.icon || 'download', 20),
    el('div', { class: 'yanta-install-rec-text' },
      el('strong', {}, rec.title),
      el('small', {}, rec.body)));

  row.append(head);

  const actions = el('div', { class: 'yanta-install-rec-actions' });
  const cta = rec.cta;

  if (cta) {
    const btn = el('button', {
      class: `btn ${isPrimary ? 'primary' : ''}`,
      type: 'button',
    });
    btn.innerHTML = `${lucide(ctaIcon(cta.kind), 14)} ${escapeHtml(cta.label)}`;
    btn.addEventListener('click', () => runCta(cta, { rec, env, expanded, rerender, btn }));
    actions.append(btn);
  }

  row.append(actions);

  // Expandable panel (guide steps or add-phone QR).
  if (expanded.has(rec.id)) {
    if (rec.cta?.kind === 'open-get-app' && !env.mobile) {
      row.append(qrElement(rec.cta.url));
    } else {
      row.append(guideElement(env));
    }
  }

  return row;
}

function ctaIcon(kind) {
  switch (kind) {
    case 'prompt-install': return 'download';
    case 'show-guide': return 'list-checks';
    case 'open-get-app': return 'smartphone';
    case 'enable-notifications': return 'bell';
    default: return 'arrow-right';
  }
}

async function runCta(cta, ctx) {
  const { rec, env, expanded, rerender } = ctx;

  switch (cta.kind) {
    case 'prompt-install': {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        toast('Installing YANTA…', 'success');
      } else if (outcome === 'unavailable') {
        // No programmatic prompt (or already used) — show manual steps.
        expanded.add(rec.id);
        toast('Follow the steps to finish installing.');
      }
      rerender();
      return;
    }

    case 'show-guide': {
      if (expanded.has(rec.id)) expanded.delete(rec.id);
      else expanded.add(rec.id);
      rerender();
      return;
    }

    case 'open-get-app': {
      if (env.mobile) {
        location.href = cta.url;
      } else {
        // On a computer, reveal a QR so the phone can open it directly.
        if (expanded.has(rec.id)) expanded.delete(rec.id);
        else expanded.add(rec.id);
        rerender();
      }
      return;
    }

    case 'enable-notifications': {
      const result = await requestWebNotificationPermission();
      if (result === 'granted') toast('Notifications enabled.', 'success');
      else if (result === 'denied') toast('Notifications are blocked in your browser settings.', 'error');
      rerender();
      return;
    }

    default:
      return;
  }
}

/**
 * A self-updating install card. Re-computes and re-renders itself when
 * install availability or notification permission changes.
 *
 * @param {object} [opts]
 * @param {() => void} [opts.onResolved] Called whenever the card becomes
 *   "perfect" (nothing to recommend) — lets a host modal auto-dismiss.
 * @returns {HTMLElement}
 */
export function installCardElement({ onResolved } = {}) {
  injectCss();

  const card = el('div', { class: 'yanta-install' });
  const expanded = new Set();

  const render = () => {
    const rec = computeInstallRecommendation();
    card.replaceChildren();

    const statusRow = notificationStatusRow(rec);

    if (rec.perfect) {
      const copy = PERFECT_COPY[rec.context] || PERFECT_COPY.default;
      card.append(el('div', { class: 'yanta-install-perfect' },
        lucideEl('check-circle-2', 22),
        el('div', {},
          el('strong', {}, copy.title),
          el('small', {}, copy.body))));

      if (statusRow) card.append(statusRow);
      onResolved?.();
      return;
    }

    if (rec.primary) {
      card.append(recRow(rec.primary, { env: rec.env, isPrimary: true, expanded, rerender: render }));
    }
    if (rec.secondary) {
      card.append(recRow(rec.secondary, { env: rec.env, isPrimary: false, expanded, rerender: render }));
    }
    if (statusRow) card.append(statusRow);
  };

  render();

  const unsubscribe = onInstallStateChange(() => {
    if (!card.isConnected) {
      unsubscribe();
      return;
    }
    render();
  });

  return card;
}

// ---- Standalone modal (opened from the dashboard hint) --------------------

let modal = null;
let releaseInstallModal = null;

export function openInstallModal() {
  injectCss();

  if (!modal) {
    modal = el('div', { class: 'modal yanta-install-modal', hidden: true });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeInstallModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.hidden) closeInstallModal();
    });
    document.body.append(modal);
  }

  const card = el('div', { class: 'modal-card' });

  const head = el('header', { class: 'modal-head' },
    el('h3', {}, 'Install YANTA'),
    el('button', { class: 'icon-btn', title: 'Close', onclick: closeInstallModal }, '✕'));

  const body = el('div', { class: 'modal-body' });
  body.append(installCardElement({
    onResolved: () => {
      // Nothing left to recommend — no reason to keep the modal open.
    },
  }));

  card.append(head, body);
  modal.replaceChildren(card);
  modal.hidden = false;

  releaseInstallModal = openBoundOverlay('install', {
    close: closeInstallModal,
    isOpen: () => !!modal?.isConnected && !modal.hidden,
  });
}

export function closeInstallModal() {
  if (modal) modal.hidden = true;

  const release = releaseInstallModal;
  releaseInstallModal = null;
  release?.();
}
