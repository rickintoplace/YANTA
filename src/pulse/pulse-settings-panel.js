// ============================================================
// YANTA Pulse — settings panel
//
// The control room: what Pulse is allowed to do, when it must stay
// quiet, and one row per routine showing in plain language when it
// runs and how many Inbox cards it has produced.
//
// Every routine row can be switched off in one tap, from the same
// place the user learns it exists.
// ============================================================

import {
  el,
  lucide,
  escapeHtml,
  toast,
} from '../core.js';

import { t } from '../i18n/index.js';
import { openNote } from '../notes.js';

import {
  getPulseSettings,
  setPulseSettings,
  PULSE_TOOL_PROFILES,
} from './pulse-config.js';

import {
  listRoutines,
  setRoutineEnabled,
  describeTrigger,
} from './pulse-routines.js';

import {
  getRoutineState,
  inboxCountByRoutine,
} from './pulse-store.js';

import { runRoutineNow } from './pulse-engine.js';

const CSS_ID = 'yanta-pulse-settings-css';

function injectCss() {
  if (document.getElementById(CSS_ID)) return;

  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
.yanta-pulse-routines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-pulse-routine {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  padding: 11px 13px;

  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev);
}

.yanta-pulse-routine.is-off { opacity: .62; }

.yanta-pulse-routine-meta {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yanta-pulse-routine-name {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.yanta-pulse-routine-desc,
.yanta-pulse-routine-when {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-pulse-routine-when {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.yanta-pulse-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  padding: 1px 7px;

  border-radius: 999px;
  background: var(--bg);

  font-size: 11px;
}

.yanta-pulse-chip.warn {
  background: color-mix(in srgb, var(--yellow, #eab308) 18%, transparent);
  color: var(--yellow, #eab308);
}

.yanta-pulse-routine-side {
  display: flex;
  align-items: center;
  gap: 6px;
}

.yanta-pulse-mini {
  padding: 4px 9px;

  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;

  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.yanta-pulse-mini:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg);
}

.yanta-pulse-mini:disabled { opacity: .5; cursor: default; }

/* A real switch: the row already carries a "Run now" button, and a bare
   checkbox there reads as a selection box rather than an on/off state. */
.yanta-pulse-switch {
  appearance: none;
  -webkit-appearance: none;

  flex: 0 0 auto;
  position: relative;

  width: 36px;
  height: 21px;
  margin: 0;

  border: 0;
  border-radius: 999px;
  background: var(--border);

  cursor: pointer;
  transition: background .16s ease;
}

.yanta-pulse-switch::after {
  content: '';

  position: absolute;
  top: 2px;
  left: 2px;

  width: 17px;
  height: 17px;

  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / .3);

  transition: transform .16s ease;
}

.yanta-pulse-switch:checked {
  background: var(--accent);
}

.yanta-pulse-switch:checked::after {
  transform: translateX(15px);
}

.yanta-pulse-switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.yanta-pulse-empty {
  padding: 14px;

  border: 1px dashed var(--border);
  border-radius: 10px;

  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}
`;

  document.head.append(style);
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

function routineRow(routine, { inboxCount, state, onChange }) {
  const row = el('div', {
    class: `yanta-pulse-routine${routine.enabled ? '' : ' is-off'}`,
  });

  const meta = el('div', { class: 'yanta-pulse-routine-meta' });

  meta.append(el('div', { class: 'yanta-pulse-routine-name' }, routine.name));

  if (routine.description) {
    meta.append(el('div', { class: 'yanta-pulse-routine-desc' }, routine.description));
  }

  const when = el('div', { class: 'yanta-pulse-routine-when' });

  const chips = [];

  if (routine.invalid.length) {
    chips.push(`<span class="yanta-pulse-chip warn">${lucide('triangle-alert', 11)} ${escapeHtml(routine.invalid[0])}</span>`);
  } else {
    chips.push(`<span class="yanta-pulse-chip">${lucide('clock', 11)} ${escapeHtml(describeTrigger(routine, { t }))}</span>`);
  }

  if (routine.toolProfile !== PULSE_TOOL_PROFILES.READ) {
    chips.push(`<span class="yanta-pulse-chip">${lucide('pencil', 11)} ${escapeHtml(t(`pulse.profile.${routine.toolProfile}`))}</span>`);
  }

  // The number the user actually cares about when a routine feels noisy.
  if (inboxCount) {
    chips.push(`<span class="yanta-pulse-chip">${lucide('inbox', 11)} ${escapeHtml(t('pulse.cardsInInbox', { count: inboxCount }))}</span>`);
  }

  if (state.lastRunAt) {
    chips.push(`<span class="yanta-pulse-chip">${lucide('check', 11)} ${escapeHtml(t('pulse.lastRun', {
      when: new Date(state.lastRunAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }),
    }))}</span>`);
  }

  when.innerHTML = chips.join('');
  meta.append(when);

  const side = el('div', { class: 'yanta-pulse-routine-side' });

  const run = el('button', { type: 'button', class: 'yanta-pulse-mini' });
  run.textContent = t('pulse.runNow');

  run.addEventListener('click', async () => {
    run.disabled = true;
    run.textContent = t('pulse.running');

    try {
      const result = await runRoutineNow(routine.name);

      toast(t(`pulse.outcome.${result.outcome.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`), 'success');
    } catch (err) {
      toast(err?.message || String(err), 'error');
    }

    run.disabled = false;
    run.textContent = t('pulse.runNow');
    onChange();
  });

  const open = el('button', {
    type: 'button',
    class: 'yanta-pulse-mini',
    title: t('pulse.openRoutineNote'),
    'aria-label': t('pulse.openRoutineNote'),
  });

  open.innerHTML = lucide('file-text', 12);

  open.addEventListener('click', async () => {
    // Imported lazily: settings.js hosts this panel, so a static import
    // would close the module graph into a cycle.
    const { closeSettings } = await import('../settings.js');

    closeSettings();
    await openNote(routine.noteId);
  });

  const toggle = el('input', {
    type: 'checkbox',
    class: 'yanta-pulse-switch',
    title: t('pulse.toggleRoutine'),
    'aria-label': t('pulse.toggleRoutine'),
  });

  toggle.checked = routine.enabled;

  toggle.addEventListener('change', async () => {
    try {
      await setRoutineEnabled(routine.name, toggle.checked);
      onChange();
    } catch (err) {
      toggle.checked = !toggle.checked;
      toast(err?.message || String(err), 'error');
    }
  });

  side.append(run, open, toggle);
  row.append(meta, side);

  return row;
}

/**
 * The whole Pulse panel. Re-renders itself in place whenever a routine
 * or a setting changes, so counters stay honest.
 */
export function pulseSettingsElement() {
  injectCss();

  const host = el('div');

  const render = async () => {
    const settings = await getPulseSettings();
    const routines = await listRoutines();
    const counts = await inboxCountByRoutine();
    const now = Date.now();

    const onChange = () => { render().catch(() => {}); };

    const fragment = document.createDocumentFragment();

    // ---- master ----
    const master = group(t('pulse.settings.general'));

    master.append(toggleRow({
      checked: settings.enabled,
      label: t('pulse.settings.enabledLabel'),
      hint: t('pulse.settings.enabledHint'),
      onChange: async (value) => {
        await setPulseSettings({ enabled: value });
        onChange();
      },
    }));

    master.append(toggleRow({
      checked: settings.notifyMissed,
      label: t('pulse.settings.notifyMissedLabel'),
      hint: t('pulse.settings.notifyMissedHint'),
      onChange: (value) => setPulseSettings({ notifyMissed: value }),
    }));

    fragment.append(master);

    // ---- quiet hours ----
    const quiet = group(t('pulse.settings.quietHours'));

    const quietRow = el('div', { class: 'yanta-settings-row' });
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

    // ---- routines ----
    const active = routines.filter((routine) => routine.enabled);
    const suggested = routines.filter((routine) => !routine.enabled);

    const list = group(t('pulse.settings.routines'));

    if (!routines.length) {
      list.append(el('div', { class: 'yanta-pulse-empty' }, t('pulse.settings.noRoutines')));
    } else {
      const wrap = el('div', { class: 'yanta-pulse-routines' });

      for (const routine of [...active, ...suggested]) {
        wrap.append(routineRow(routine, {
          inboxCount: counts.get(routine.name) || 0,
          state: await getRoutineState(routine.name, now),
          onChange,
        }));
      }

      list.append(wrap);
    }

    list.append(el('div', { class: 'yanta-settings-toggle-hint' }, t('pulse.settings.askAiHint')));

    fragment.append(list);

    host.replaceChildren(fragment);
  };

  render().catch((err) => {
    console.warn('[YANTA Pulse] settings render failed', err);
    host.replaceChildren(el('div', { class: 'yanta-pulse-empty' }, t('pulse.settings.loadError')));
  });

  return host;
}
