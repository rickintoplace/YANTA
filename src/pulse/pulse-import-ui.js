// ============================================================
// YANTA Pulse — importing a shared routine
//
// A routine link is an instruction file for an agent that holds tools.
// So it is never installed on arrival: this screen shows what it will
// do, in full, and the user decides.
//
// The two guarantees are stated on the screen because they are what
// makes accepting a stranger's routine reasonable — it arrives disabled
// and read-only, whatever the sender asked for.
// ============================================================

import {
  el,
  lucide,
  escapeHtml,
  toast,
} from '../core.js';

import { t } from '../i18n/index.js';
import { openBoundOverlay } from '../overlay-history.js';

import {
  decodeRoutinePayload,
  sanitizeSharedRoutine,
  installRoutine,
} from './pulse-library.js';

import { injectPulseCss } from './pulse-styles.js';
import { describeTrigger } from './pulse-routines.js';

const CSS_ID = 'yanta-pulse-import-css';

let active = null;

function injectCss() {
  injectPulseCss();

  if (document.getElementById(CSS_ID)) return;

  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
.yanta-pulse-import-card {
  width: min(560px, 92vw);
  max-height: 86vh;

  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.yanta-pulse-import-head {
  flex: 0 0 auto;

  display: flex;
  align-items: center;
  gap: 10px;

  padding: 15px 18px 13px;
  border-bottom: 1px solid var(--border);
}

.yanta-pulse-import-head > svg { color: var(--accent); }

.yanta-pulse-import-head h2 {
  flex: 1;
  margin: 0;

  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}

.yanta-pulse-import-body {
  flex: 1;
  min-height: 0;

  padding: 16px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.yanta-pulse-import-name {
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}

.yanta-pulse-import-desc {
  margin-top: 4px;

  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.55;
}

.yanta-pulse-import-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  margin: 12px 0 14px;
}

.yanta-pulse-import-guards {
  display: flex;
  flex-direction: column;
  gap: 7px;

  padding: 12px 13px;
  margin-bottom: 14px;

  border-radius: 10px;
  background: var(--bg-elev);
}

.yanta-pulse-import-guard {
  display: flex;
  align-items: flex-start;
  gap: 8px;

  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.yanta-pulse-import-guard > svg { flex: 0 0 auto; margin-top: 2px; color: var(--accent); }

.yanta-pulse-import-label {
  margin-bottom: 6px;

  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.yanta-pulse-import-source {
  margin: 0;
  padding: 12px 13px;

  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev);

  color: var(--text-dim);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.6;

  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.yanta-pulse-import-foot {
  flex: 0 0 auto;

  display: flex;
  align-items: center;
  gap: 8px;

  padding: 13px 18px;
  border-top: 1px solid var(--border);
}

.yanta-pulse-import-foot .yanta-pulse-spacer { flex: 1; }

@media (max-width: 720px) {
  .yanta-pulse-import-modal { padding: 0; }

  .yanta-pulse-import-card {
    width: 100%;
    height: 100dvh;
    max-height: none;

    border: 0;
    border-radius: 0;
  }

  .yanta-pulse-import-head { padding-top: max(15px, env(safe-area-inset-top)); }
  .yanta-pulse-import-foot { padding-bottom: max(13px, env(safe-area-inset-bottom)); }
  .yanta-pulse-import-foot .yanta-pulse-btn { flex: 1; padding: 11px 14px; }
}
`;

  document.head.append(style);
}

function chip(icon, text) {
  return `<span class="yanta-pulse-chip">${lucide(icon, 11)} ${escapeHtml(text)}</span>`;
}

function close() {
  if (!active) return;

  active.modal.remove();
  active.release?.();
  active = null;
}

/**
 * Shows the review screen for a shared routine payload.
 * Resolves once the user has installed or dismissed it.
 */
export async function openRoutineImport(payload) {
  injectCss();

  // One review at a time; a deep link can arrive through several channels.
  if (active) return;

  let routine;

  try {
    routine = sanitizeSharedRoutine(await decodeRoutinePayload(payload));
  } catch (err) {
    toast(err?.message || t('pulse.library.importFailed'), 'error');
    return;
  }

  const modal = el('div', {
    class: 'modal yanta-pulse-import-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('pulse.library.importTitle'),
  });

  const card = el('div', { class: 'modal-card yanta-pulse-import-card' });

  const head = el('div', { class: 'yanta-pulse-import-head' });
  head.innerHTML = `${lucide('download', 16)}<h2>${escapeHtml(t('pulse.library.importTitle'))}</h2>`;

  const closeButton = el('button', {
    type: 'button',
    class: 'yanta-pulse-icon-btn',
    title: t('pulse.close'),
    'aria-label': t('pulse.close'),
  });

  closeButton.innerHTML = lucide('x', 16);
  closeButton.addEventListener('click', () => close());
  head.append(closeButton);

  const body = el('div', { class: 'yanta-pulse-import-body' });

  body.append(el('div', { class: 'yanta-pulse-import-name' }, routine.name));

  if (routine.description) {
    body.append(el('div', { class: 'yanta-pulse-import-desc' }, routine.description));
  }

  const chips = [];

  // Plain English, never cron — the same rule the rest of Pulse follows.
  const trigger = describeTrigger(
    { when: routine.when, events: routine.events },
    { t }
  );

  if (trigger) chips.push(chip('clock', trigger));

  for (const output of routine.outputs) {
    chips.push(chip('inbox', t(`pulse.output.${output}`)));
  }

  if (chips.length) {
    const row = el('div', { class: 'yanta-pulse-import-chips' });
    row.innerHTML = chips.join('');
    body.append(row);
  }

  // The guarantees, stated where the decision is made.
  const guards = el('div', { class: 'yanta-pulse-import-guards' });

  const guardLines = [
    ['eye', t('pulse.library.guardReadOnly')],
    ['pause', t('pulse.library.guardDisabled')],
    ['shield', t('pulse.library.guardLocal')],
  ];

  if (routine.clampedTools) {
    guardLines.unshift(['triangle-alert', t('pulse.library.guardClamped', { tools: routine.requestedTools })]);
  }

  for (const [icon, text] of guardLines) {
    const line = el('div', { class: 'yanta-pulse-import-guard' });
    line.innerHTML = lucide(icon, 13);
    line.append(el('span', {}, text));
    guards.append(line);
  }

  body.append(guards);

  // The instructions themselves, verbatim. Installing something you
  // cannot read is exactly what this screen exists to prevent.
  body.append(el('div', { class: 'yanta-pulse-import-label' }, t('pulse.library.instructions')));
  body.append(el('pre', { class: 'yanta-pulse-import-source' }, routine.body));

  const foot = el('div', { class: 'yanta-pulse-import-foot' });

  const cancel = el('button', { type: 'button', class: 'yanta-pulse-btn' }, t('pulse.library.cancel'));
  cancel.addEventListener('click', () => close());

  const install = el('button', { type: 'button', class: 'yanta-pulse-btn primary' }, t('pulse.library.install'));

  install.addEventListener('click', async () => {
    install.disabled = true;

    try {
      const created = await installRoutine(routine.markdown, { name: routine.name });

      close();
      toast(t('pulse.library.installed', { name: created.name }), 'success');

      const { openPulseOverview } = await import('./pulse-overview.js');
      openPulseOverview({ tab: 'routines' });
    } catch (err) {
      install.disabled = false;
      toast(err?.message || String(err), 'error');
    }
  });

  foot.append(cancel, el('span', { class: 'yanta-pulse-spacer' }), install);

  card.append(head, body, foot);
  modal.append(card);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });

  document.body.append(modal);

  active = {
    modal,
    release: openBoundOverlay('pulse-import', {
      close: () => close(),
      isOpen: () => !!active,
    }),
  };
}
