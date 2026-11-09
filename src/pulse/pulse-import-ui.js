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
import { openSurface } from '../ui/surface.js';

import {
  decodeRoutinePayload,
  sanitizeSharedRoutine,
  installRoutine,
} from './pulse-library.js';

import { injectPulseCss } from './pulse-styles.js';
import { describeTrigger } from './pulse-routines.js';

let active = null; // the open review, a surface (src/ui/surface.js)

function chip(icon, text) {
  return `<span class="yanta-pulse-chip">${lucide(icon, 11)} ${escapeHtml(text)}</span>`;
}

/**
 * Shows the review screen for a shared routine payload.
 * Resolves once the user has installed or dismissed it.
 */
export async function openRoutineImport(payload) {
  injectPulseCss();

  // One review at a time; a deep link can arrive through several channels.
  if (active) return;

  let routine;

  try {
    routine = sanitizeSharedRoutine(await decodeRoutinePayload(payload));
  } catch (err) {
    toast(err?.message || t('pulse.library.importFailed'), 'error');
    return;
  }

  const review = openSurface({
    kind: 'dialog',
    title: t('pulse.library.importTitle'),
    width: 560,
    className: 'ypi',
    historyId: 'pulse-import',
    footer: true,
    onClose: () => { active = null; },
  });
  active = review;

  const { body, foot } = review;

  body.append(el('div', { class: 'ypi-name' }, routine.name));

  if (routine.description) {
    body.append(el('p', { class: 'ys-dim' }, routine.description));
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
    const row = el('div', { class: 'ypi-chips' });
    row.innerHTML = chips.join('');
    body.append(row);
  }

  // The guarantees, stated where the decision is made.
  const guards = el('ul', { class: 'ypi-guards' });

  const guardLines = [
    ['eye', t('pulse.library.guardReadOnly')],
    ['pause', t('pulse.library.guardDisabled')],
    ['shield', t('pulse.library.guardLocal')],
  ];

  if (routine.clampedTools) {
    guardLines.unshift(['triangle-alert', t('pulse.library.guardClamped', { tools: routine.requestedTools })]);
  }

  for (const [icon, text] of guardLines) {
    const line = el('li', {});
    line.innerHTML = lucide(icon, 14);
    line.append(el('span', {}, text));
    guards.append(line);
  }

  body.append(guards);

  // The instructions themselves, verbatim. Installing something you
  // cannot read is exactly what this screen exists to prevent.
  const source = el('section', { class: 'ys-section' });
  source.append(el('h3', { class: 'ys-section-title' }, t('pulse.library.instructions')));
  source.append(el('pre', { class: 'ypi-source' }, routine.body));
  body.append(source);

  const cancel = el('button', { type: 'button', class: 'btn' }, t('pulse.library.cancel'));
  cancel.addEventListener('click', () => review.close());

  const install = el('button', { type: 'button', class: 'btn primary' }, t('pulse.library.install'));

  install.addEventListener('click', async () => {
    install.disabled = true;

    try {
      const created = await installRoutine(routine.markdown, { name: routine.name });

      toast(t('pulse.library.installed', { name: created.name }), 'success');

      // The overview pushes its own entry: only after this one is gone.
      await review.closeThen(async () => {
        const { openPulseOverview } = await import('./pulse-overview.js');
        openPulseOverview({ tab: 'routines' });
      });
    } catch (err) {
      install.disabled = false;
      toast(err?.message || String(err), 'error');
    }
  });

  foot.append(el('span', { class: 'ys-grow' }), cancel, install);
}
