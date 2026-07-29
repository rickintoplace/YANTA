// ============================================================
// YANTA Pulse — settings panel
//
// Preferences only: whether Pulse runs at all, when it must stay quiet,
// and what routines are allowed to do.
//
// Managing individual routines and reading what they did lives in the
// Pulse overview, reachable from here and from the Inbox widget. One
// home for preferences, one home for activity — the same split the
// assistant uses.
// ============================================================

import {
  el,
  toast,
} from '../core.js';

import { t } from '../i18n/index.js';

import {
  getPulseSettings,
  setPulseSettings,
} from './pulse-config.js';

import { injectPulseCss } from './pulse-styles.js';
import { openPulseOverview } from './pulse-overview.js';

import {
  getPulseAllowance,
  partitionByAllowance,
  PULSE_ALLOWANCE_SOURCE,
} from './pulse-plan.js';

import { listRoutines } from './pulse-routines.js';

function group(title) {
  const wrap = el('div', { class: 'yanta-settings-group' });
  wrap.append(el('div', { class: 'yanta-settings-group-title' }, title));
  return wrap;
}

function toggleRow({ checked, label, hint, onChange }) {
  const row = el('label', { class: 'yanta-settings-toggle' });
  const cb = el('input', { type: 'checkbox' });

  cb.checked = !!checked;

  cb.addEventListener('change', async () => {
    try {
      await onChange?.(cb.checked);
    } catch (err) {
      cb.checked = !cb.checked;
      toast(err?.message || String(err), 'error');
    }
  });

  row.append(cb, el('div', { class: 'yanta-settings-toggle-meta' },
    el('div', { class: 'yanta-settings-toggle-label' }, label),
    el('div', { class: 'yanta-settings-toggle-hint' }, hint),
  ));

  return row;
}

function clockField(value, onChange) {
  const input = el('input', {
    type: 'time',
    class: 'yanta-settings-input',
    value,
  });

  input.style.maxWidth = '120px';
  input.addEventListener('change', () => onChange(input.value));

  return input;
}

/**
 * Preferences pane. Re-renders in place when a setting changes, so the
 * routine count stays honest after an upgrade or a BYOK switch.
 */
export function pulseSettingsElement() {
  injectPulseCss();

  const host = el('div');

  const render = async () => {
    const settings = await getPulseSettings();
    const allowance = await getPulseAllowance();
    const { active } = partitionByAllowance(await listRoutines(), allowance);

    const onChange = () => { render().catch(() => {}); };

    const fragment = document.createDocumentFragment();

    // ---- general ----
    const general = group(t('pulse.settings.general'));

    general.append(toggleRow({
      checked: settings.enabled,
      label: t('pulse.settings.enabledLabel'),
      hint: t('pulse.settings.enabledHint'),
      onChange: async (value) => {
        await setPulseSettings({ enabled: value });
        onChange();
      },
    }));

    general.append(toggleRow({
      checked: settings.notifyMissed,
      label: t('pulse.settings.notifyMissedLabel'),
      hint: t('pulse.settings.notifyMissedHint'),
      onChange: (value) => setPulseSettings({ notifyMissed: value }),
    }));

    fragment.append(general);

    // ---- quiet hours ----
    const quiet = group(t('pulse.settings.quietHours'));

    const quietRow = el('div');
    quietRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

    quietRow.append(
      el('span', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.quietFrom')),
      clockField(settings.quietFrom, (value) => setPulseSettings({ quietFrom: value })),
      el('span', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.quietTo')),
      clockField(settings.quietTo, (value) => setPulseSettings({ quietTo: value })),
    );

    quiet.append(quietRow);
    quiet.append(el('div', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.quietHint')));

    fragment.append(quiet);

    // ---- permissions ----
    const permissions = group(t('pulse.settings.permissions'));

    permissions.append(toggleRow({
      checked: settings.allowWrite,
      label: t('pulse.settings.allowWriteLabel'),
      hint: t('pulse.settings.allowWriteHint'),
      onChange: (value) => setPulseSettings({ allowWrite: value }),
    }));

    permissions.append(toggleRow({
      checked: settings.allowDestructive,
      label: t('pulse.settings.allowDestructiveLabel'),
      hint: t('pulse.settings.allowDestructiveHint'),
      onChange: (value) => setPulseSettings({ allowDestructive: value }),
    }));

    permissions.append(el('div', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.proposalNote')));

    fragment.append(permissions);

    // ---- routines live in the overview ----
    const routines = group(t('pulse.settings.routines'));

    routines.append(el('div', { class: 'yanta-settings-toggle-hint' },
      allowance.source === PULSE_ALLOWANCE_SOURCE.BYOK
        ? t('pulse.allowance.byok')
        : t('pulse.allowance.plan', { used: active.length, max: allowance.routines })
    ));

    const openButton = el('button', { type: 'button', class: 'yanta-pulse-mini' });
    openButton.style.marginTop = '8px';
    openButton.textContent = t('pulse.settings.manageRoutines');

    openButton.addEventListener('click', async () => {
      const { closeSettings } = await import('../settings.js');

      closeSettings();
      openPulseOverview();
    });

    routines.append(openButton);
    routines.append(el('div', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.askAiHint')));

    fragment.append(routines);

    host.replaceChildren(fragment);
  };

  render().catch((err) => {
    console.warn('[YANTA Pulse] settings render failed', err);
    host.replaceChildren(el('div', { class: 'yanta-pulse-empty' }, t('pulse.settings.loadError')));
  });

  return host;
}
