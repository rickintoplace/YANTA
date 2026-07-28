// ============================================================
// YANTA — Storage onboarding (non-blocking)
//
// YANTA is local-first, so choosing where notes live (this device /
// YANTA Cloud / your own Drive) is reversible and must never gate the
// first use. There is no takeover screen: the app is fully usable the
// instant it loads.
//
// Instead, local-only users see one dismissible nudge on the dashboard.
// The Local/Cloud/BYO chooser opens only when *they* ask for it — a
// user-triggered dialog, never an unsolicited wall.
// ============================================================

import {
  el,
  lucide,
  toast,
  store,
  escapeHtml,
} from './core.js';
import { t } from './i18n/index.js';
import { openBoundOverlay } from './overlay-history.js';

// Marks the storage decision as settled — set when the user picks a
// destination or dismisses the nudge. Once set, the nudge stays gone.
const DECIDED_FLAG = 'onboarding.storageChoice.v1';

/**
 * True once the user has made (or dismissed) the storage choice, OR sync
 * is already configured — i.e. the nudge should not appear.
 */
async function storageChoiceSettled() {
  try {
    const [decided, provider] = await Promise.all([
      store.settings.get(DECIDED_FLAG, null),
      store.settings.get('sync2.provider', null),
    ]);

    return decided === 'done' || !!provider;
  } catch {
    // On read failure, stay quiet rather than nag.
    return true;
  }
}

async function markDecided() {
  try {
    await store.settings.set(DECIDED_FLAG, 'done');
  } catch (err) {
    console.warn('[YANTA onboarding] could not persist storage choice', err);
  }
}

function injectCss() {
  if (document.getElementById('yanta-onboarding-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-onboarding-css';
  style.textContent = `
/* ---- Dashboard nudge (inline, dismissible, non-blocking) ---- */

/* Match the widgets container's centered max-width so the nudge lines up. */
.yanta-dashboard-nudge-host:not(:empty) {
  width: min(1120px, 100%);
  margin: 0 auto 14px;
}

.yanta-sync-nudge {
  display: flex;
  align-items: center;
  gap: 14px;

  padding: 14px 14px 14px 16px;

  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, var(--bg-elev)), var(--bg-elev));
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: 14px;

  animation: yanta-sync-nudge-in 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

.yanta-sync-nudge-icon {
  flex: 0 0 auto;

  width: 40px;
  height: 40px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 12px;
}

.yanta-sync-nudge-main {
  flex: 1;
  min-width: 0;
}

.yanta-sync-nudge-title {
  color: var(--text);
  font-size: 13.5px;
  font-weight: 700;
}

.yanta-sync-nudge-sub {
  margin-top: 2px;

  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.4;
}

.yanta-sync-nudge-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.yanta-sync-nudge-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  padding: 8px 13px;

  color: white;
  background: var(--accent);
  border: none;
  border-radius: 9px;

  font: inherit;
  font-size: 12.5px;
  font-weight: 650;

  cursor: pointer;
  transition: transform 120ms ease;
  white-space: nowrap;
}

.yanta-sync-nudge-cta:hover {
  transform: translateY(-1px);
}

.yanta-sync-nudge-dismiss {
  flex: 0 0 auto;

  width: 30px;
  height: 30px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: var(--text-faint);
  background: none;
  border: none;
  border-radius: 8px;

  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}

.yanta-sync-nudge-dismiss:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

@media (max-width: 560px) {
  .yanta-sync-nudge {
    flex-wrap: wrap;
  }

  .yanta-sync-nudge-main {
    flex-basis: calc(100% - 54px);
  }

  .yanta-sync-nudge-actions {
    flex-basis: 100%;
    justify-content: flex-end;
  }
}

/* ---- Chooser dialog (user-triggered only) ---- */

.yanta-onb-card {
  width: min(500px, 94vw);
  max-height: 90vh;
  overflow-y: auto;

  padding: 26px 24px 20px;

  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: var(--shadow);

  animation: yanta-onb-rise 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.yanta-onb-title {
  margin: 0 0 4px;

  color: var(--text);
  font-size: 19px;
  font-weight: 750;
  letter-spacing: -0.01em;
}

.yanta-onb-sub {
  margin: 0;

  color: var(--text-dim);
  font-size: 13.5px;
  line-height: 1.5;
}

.yanta-onb-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;

  margin: 18px 0 14px;
}

.yanta-onb-choice {
  display: flex;
  align-items: flex-start;
  gap: 13px;

  width: 100%;
  padding: 13px 14px;
  text-align: left;

  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: 13px;

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

  width: 36px;
  height: 36px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 10px;
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
  font-size: 14px;
  font-weight: 700;
}

.yanta-onb-badge {
  padding: 2px 7px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 999px;

  font-size: 10px;
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
  font-size: 12px;
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

  margin: 0 0 16px;

  color: var(--text-faint);
  font-size: 11.5px;
  line-height: 1.45;
}

.yanta-onb-footnote svg {
  flex: 0 0 auto;
  margin-top: 1px;
}

.yanta-onb-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.yanta-onb-spacer {
  flex: 1;
}

.yanta-onb-primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;

  padding: 9px 17px;

  color: white;
  background: var(--accent);
  border: none;
  border-radius: 10px;

  font: inherit;
  font-size: 13.5px;
  font-weight: 650;

  cursor: pointer;
  transition: transform 120ms ease;
}

.yanta-onb-primary:hover {
  transform: translateY(-1px);
}

@keyframes yanta-sync-nudge-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: none; }
}

@keyframes yanta-onb-rise {
  from { opacity: 0; transform: translateY(10px) scale(0.99); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .yanta-sync-nudge,
  .yanta-onb-card {
    animation: none;
  }

  .yanta-sync-nudge-cta:hover,
  .yanta-onb-primary:hover {
    transform: none;
  }
}
`;

  document.head.append(style);
}

// ---------------- Chooser dialog (user-triggered) ----------------

// Static shape only — all copy is resolved from the catalog at render time
// (onboarding.choices.<id>.* and onboarding.badge.<badge>) so it follows the
// active locale.
const STORAGE_CHOICES = [
  { id: 'local', icon: 'hard-drive',  badge: 'default',     badgeMuted: true },
  { id: 'cloud', icon: 'cloud',       badge: 'recommended', badgeMuted: false },
  { id: 'byo',   icon: 'folder-sync', badge: 'advanced',    badgeMuted: true },
];

let chooserModal = null;
let releaseChooser = null;

function closeChooser() {
  if (chooserModal) {
    chooserModal.hidden = true;
    chooserModal.replaceChildren();
  }

  const release = releaseChooser;
  releaseChooser = null;
  release?.();
}

async function applyChoice(choice, { onSettled } = {}) {
  await markDecided();
  closeChooser();

  try {
    if (choice === 'cloud') {
      const { openYantaCloudSetup } = await import('./sync2/yanta-cloud-setup-ui.js');
      await openYantaCloudSetup();
    } else if (choice === 'byo') {
      const { openGoogleDriveSyncSetup } = await import('./sync2/sync-setup-ui.js');
      openGoogleDriveSyncSetup();
    } else {
      toast(t('onboarding.localToast'), 'info');
    }
  } catch (err) {
    console.warn('[YANTA onboarding] could not open storage setup', err);
    toast(t('onboarding.openError'), 'error');
  }

  if (typeof onSettled === 'function') onSettled();
}

/**
 * Opens the storage chooser. Only ever called from an explicit user
 * action (the dashboard nudge, or Settings) — never on load.
 */
export function openStorageChooser({ onSettled } = {}) {
  injectCss();

  if (!chooserModal) {
    chooserModal = el('div', { class: 'modal', hidden: true });

    chooserModal.addEventListener('click', (e) => {
      if (e.target === chooserModal || e.target.closest?.('[data-onb-close]')) {
        closeChooser();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (chooserModal?.hidden === false && e.key === 'Escape') {
        e.preventDefault();
        closeChooser();
      }
    });

    document.body.append(chooserModal);
  }

  const cardsHtml = STORAGE_CHOICES.map((c, i) => `
    <div
      class="yanta-onb-choice"
      role="radio"
      tabindex="${i === 0 ? '0' : '-1'}"
      aria-checked="${i === 0 ? 'true' : 'false'}"
      data-onb-choice="${c.id}">
      <div class="yanta-onb-choice-icon">${lucide(c.icon, 18)}</div>

      <div class="yanta-onb-choice-main">
        <div class="yanta-onb-choice-head">
          <span class="yanta-onb-choice-title">${escapeHtml(t(`onboarding.choices.${c.id}.title`))}</span>
          <span class="yanta-onb-badge${c.badgeMuted ? ' muted' : ''}">${escapeHtml(t(`onboarding.badge.${c.badge}`))}</span>
        </div>
        <p class="yanta-onb-choice-desc">${escapeHtml(t(`onboarding.choices.${c.id}.desc`))}</p>
      </div>

      <span class="yanta-onb-choice-check">${lucide('check-circle-2', 18)}</span>
    </div>
  `).join('');

  chooserModal.innerHTML = `
    <div class="yanta-onb-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('onboarding.chooser.ariaLabel'))}">
      <h2 class="yanta-onb-title">${escapeHtml(t('onboarding.chooser.title'))}</h2>
      <p class="yanta-onb-sub">${escapeHtml(t('onboarding.chooser.subtitle'))}</p>

      <div class="yanta-onb-cards" role="radiogroup" aria-label="${escapeHtml(t('onboarding.chooser.groupLabel'))}">
        ${cardsHtml}
      </div>

      <p class="yanta-onb-footnote">
        ${lucide('shield-check', 14)}
        <span>${escapeHtml(t('onboarding.chooser.footnote'))}</span>
      </p>

      <div class="yanta-onb-actions">
        <button class="yanta-sync-nudge-dismiss" data-onb-close type="button" title="${escapeHtml(t('common.close'))}" style="width:auto;padding:8px 4px;font-size:13px;">${escapeHtml(t('common.cancel'))}</button>
        <span class="yanta-onb-spacer"></span>
        <button class="yanta-onb-primary" data-onb-continue type="button">
          ${escapeHtml(t('common.continue'))}
          ${lucide('arrow-right', 16)}
        </button>
      </div>
    </div>
  `;

  chooserModal.hidden = false;

  // Device-back dismisses the chooser instead of closing the app.
  releaseChooser = openBoundOverlay('storage-chooser', {
    close: closeChooser,
    isOpen: () => chooserModal?.hidden === false,
  });

  const card = chooserModal.querySelector('.yanta-onb-card');
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

      let next = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % choices.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + choices.length) % choices.length;

      if (next >= 0) {
        e.preventDefault();
        select(choices[next].dataset.onbChoice);
        choices[next].focus();
      }
    });
  });

  card.querySelector('[data-onb-continue]')?.addEventListener('click', () => {
    applyChoice(selected, { onSettled });
  });

  setTimeout(() => choices[0]?.focus(), 40);
}

// ---------------- Dashboard nudge (inline, dismissible) ----------------

/**
 * Appends the dismissible "set up sync" nudge to `host` — but only for
 * local-only users who haven't settled the choice yet. A no-op otherwise,
 * so it is safe to call on every dashboard render.
 */
export async function renderSyncNudgeInto(host) {
  if (!host) return;

  if (await storageChoiceSettled()) return;

  // The dashboard may have re-rendered while we were awaiting; bail if the
  // host we were handed is gone.
  if (host.isConnected === false) return;

  injectCss();

  const nudge = el('div', { class: 'yanta-sync-nudge' });

  nudge.innerHTML = `
    <div class="yanta-sync-nudge-icon">${lucide('cloud', 20)}</div>

    <div class="yanta-sync-nudge-main">
      <div class="yanta-sync-nudge-title">${escapeHtml(t('onboarding.nudge.title'))}</div>
      <div class="yanta-sync-nudge-sub">${escapeHtml(t('onboarding.nudge.subtitle'))}</div>
    </div>

    <div class="yanta-sync-nudge-actions">
      <button class="yanta-sync-nudge-cta" data-nudge-setup type="button">
        ${lucide('arrow-right', 14)}
        ${escapeHtml(t('onboarding.nudge.cta'))}
      </button>
      <button class="yanta-sync-nudge-dismiss" data-nudge-dismiss type="button" title="${escapeHtml(t('onboarding.nudge.dismiss'))}" aria-label="${escapeHtml(t('onboarding.nudge.dismiss'))}">
        ${lucide('x', 16)}
      </button>
    </div>
  `;

  nudge.querySelector('[data-nudge-setup]')?.addEventListener('click', () => {
    openStorageChooser({
      onSettled: () => nudge.remove(),
    });
  });

  nudge.querySelector('[data-nudge-dismiss]')?.addEventListener('click', async () => {
    nudge.remove();
    await markDecided();
  });

  host.append(nudge);
}
