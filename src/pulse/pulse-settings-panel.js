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
  state,
  toast,
} from '../core.js';

import {
  t,
  getLocale,
  LOCALES,
} from '../i18n/index.js';

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

import {
  getPulseOutputLocale,
  setPulseOutputLocale,
  getPulseOutputFolderId,
  setPulseOutputFolderId,
} from './pulse-store.js';

import { findPulseOutputFolder } from './pulse-output.js';

import { folderPathIds, folderPathNames, isFolderInTrash } from '../trash.js';

const AUTO_FOLDER_VALUE = '';

/**
 * Every folder a routine could file into, deepest path spelled out so two
 * folders called "Reading" are told apart.
 *
 * System folders are left out: the AI Brain and its Skills folder steer
 * every later run, and a reading list dropped in there would be read back
 * as instructions. Shared folders are out too — a background run must not
 * publish to other people without anyone having said so.
 */
function isSelectableOutputFolder(folder) {
  return !!folder &&
    !isFolderInTrash(folder) &&
    !folder.spaceId &&
    folder.system !== true &&
    folder.aiBrain !== true &&
    !folderPathIds(folder.id).some((id) => {
      const ancestor = state.folders.get(id);
      return ancestor?.system === true || ancestor?.aiBrain === true;
    });
}

function outputFolderOptions() {
  return [...state.folders.values()]
    .filter(isSelectableOutputFolder)
    .map((folder) => ({
      value: folder.id,
      label: folderPathNames(folder.id).join(' / '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

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

function countField(value, { min, max }, onChange) {
  const input = el('input', {
    type: 'number',
    class: 'yanta-settings-input',
    min: String(min),
    max: String(max),
    value: String(value),
  });

  input.style.maxWidth = '90px';

  input.addEventListener('change', () => {
    const next = Math.max(min, Math.min(max, Number(input.value) || min));

    input.value = String(next);
    onChange(next);
  });

  return input;
}

function selectField(value, options, onChange) {
  const select = el('select', { class: 'yanta-settings-input' });

  select.style.maxWidth = '200px';

  for (const option of options) {
    select.append(el('option', { value: option.value }, option.label));
  }

  select.value = value;
  select.addEventListener('change', () => onChange(select.value));

  return select;
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
    const outputLocale = await getPulseOutputLocale().catch(() => '');
    const outputFolderId = await getPulseOutputFolderId().catch(() => '');
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

    // ---- result language ----
    //
    // Deliberately not the display language: results land in one shared
    // Inbox, so they need one language across devices even when the
    // devices themselves are set differently.
    const language = group(t('pulse.settings.language'));

    const languageRow = el('div');
    languageRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

    languageRow.append(
      el('span', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.languageLabel')),
      selectField(
        LOCALES.some((locale) => locale.code === outputLocale) ? outputLocale : getLocale(),
        LOCALES.map((locale) => ({ value: locale.code, label: locale.native })),
        (value) => setPulseOutputLocale(value),
      ),
    );

    language.append(languageRow);
    language.append(el('div', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.languageHint')));

    fragment.append(language);

    // ---- where notes a routine creates are filed ----
    //
    // Only notes. `output: [journal]` means "today's note" by definition,
    // and pointing that somewhere else would make the output meaningless —
    // those entries carry the Pulse marker instead.
    const output = group(t('pulse.settings.outputFolder'));

    const outputRow = el('div');
    outputRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

    const currentFolder = await findPulseOutputFolder();

    outputRow.append(
      el('span', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.outputFolderLabel')),
      selectField(
        currentFolder && outputFolderId ? currentFolder.id : AUTO_FOLDER_VALUE,
        [
          { value: AUTO_FOLDER_VALUE, label: t('pulse.settings.outputFolderAuto') },
          ...outputFolderOptions(),
        ],
        async (value) => {
          await setPulseOutputFolderId(value);
          onChange();
        },
      ),
    );

    output.append(outputRow);
    output.append(el('div', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.outputFolderHint')));

    fragment.append(output);

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

    // ---- attention budget ----
    const budget = group(t('pulse.settings.budget'));

    const budgetRow = el('div');
    budgetRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

    budgetRow.append(
      el('span', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.budgetLabel')),
      countField(settings.maxDeliveriesPerDay, { min: 1, max: 12 }, (value) =>
        setPulseSettings({ maxDeliveriesPerDay: value })
      ),
    );

    budget.append(budgetRow);
    budget.append(el('div', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.budgetHint')));

    fragment.append(budget);

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
      const { swapOverlay } = await import('../overlay-history.js');

      swapOverlay('pulse-overview', {
        from: closeSettings,
        to: openPulseOverview,
      });
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
