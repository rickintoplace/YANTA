// ============================================================
// YANTA Pulse — the overview
//
// One place that answers the three questions the Inbox cannot: what is
// running, what did it do, and what else could I run.
//
// Settings deliberately stay in Settings — this surface links to them
// the way the assistant links to its own, so there is one home for
// preferences and one home for activity.
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
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
} from '../overlay-history.js';

import {
  listRoutines,
  setRoutineEnabled,
  describeTrigger,
  findDuplicateRoutineNotes,
  removeDuplicateRoutineNotes,
} from './pulse-routines.js';

import {
  getRoutineState,
  listRunHistory,
  clearRunHistory,
  inboxCountByRoutine,
} from './pulse-store.js';

import {
  getPulseAllowance,
  partitionByAllowance,
  PULSE_ALLOWANCE_SOURCE,
} from './pulse-plan.js';

import {
  runRoutineNow,
  nextPulseAt,
} from './pulse-engine.js';

import { getPulseSettings } from './pulse-config.js';
import { injectPulseCss } from './pulse-styles.js';

const CSS_ID = 'yanta-pulse-overview-css';

let modal = null;
let registered = false;
let activeTab = 'routines';

function injectCss() {
  injectPulseCss();

  if (document.getElementById(CSS_ID)) return;

  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
.yanta-pulse-overview {
  position: fixed;
  inset: 0;
  z-index: 1200;

  display: grid;
  place-items: center;

  padding: 16px;
  background: rgb(0 0 0 / .45);
}

.yanta-pulse-overview[hidden] { display: none !important; }

.yanta-pulse-ov-panel {
  display: flex;
  flex-direction: column;

  width: min(760px, 100%);
  max-height: min(82vh, 900px);

  border-radius: 16px;
  background: var(--bg);
  box-shadow: 0 24px 64px rgb(0 0 0 / .35);
  overflow: hidden;
}

.yanta-pulse-ov-head {
  display: flex;
  align-items: center;
  gap: 10px;

  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.yanta-pulse-ov-head h2 {
  flex: 1;
  margin: 0;

  color: var(--text);
  font-size: 15px;
  font-weight: 700;
}

.yanta-pulse-ov-sub {
  padding: 0 16px 12px;

  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
  border-bottom: 1px solid var(--border);
}

.yanta-pulse-ov-tabs {
  display: flex;
  gap: 4px;

  padding: 10px 16px 0;
}

.yanta-pulse-ov-tab {
  padding: 6px 12px;

  border: 0;
  border-radius: 8px 8px 0 0;
  background: transparent;

  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.yanta-pulse-ov-tab.active {
  color: var(--text);
  background: var(--bg-elev);
}

.yanta-pulse-ov-body {
  flex: 1;
  min-height: 0;

  padding: 14px 16px 18px;
  overflow-y: auto;
}

.yanta-pulse-hist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.yanta-pulse-hist-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  padding: 9px 12px;

  border-radius: 9px;
  background: var(--bg-elev);
}

.yanta-pulse-hist-row > svg { flex: 0 0 auto; margin-top: 2px; color: var(--text-dim); }
.yanta-pulse-hist-row.ok > svg { color: var(--accent); }
.yanta-pulse-hist-row.err > svg { color: var(--red, #ef4444); }

.yanta-pulse-hist-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.yanta-pulse-hist-title {
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
}

.yanta-pulse-hist-line,
.yanta-pulse-hist-tools {
  color: var(--text-dim);
  font-size: 11.5px;
  line-height: 1.45;
}

.yanta-pulse-hist-tools code {
  padding: 1px 5px;
  margin-right: 4px;

  border-radius: 5px;
  background: var(--bg);
  font-size: 11px;
}

.yanta-pulse-hist-when {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 11px;
  white-space: nowrap;
}

.yanta-pulse-ov-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;

  margin-bottom: 10px;
  padding: 10px 12px;

  border-radius: 9px;
  background: color-mix(in srgb, var(--yellow, #eab308) 14%, transparent);

  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.yanta-pulse-ov-note > svg { flex: 0 0 auto; margin-top: 2px; color: var(--yellow, #eab308); }
.yanta-pulse-ov-note-body { flex: 1; min-width: 0; }

.yanta-pulse-ov-soon {
  margin-bottom: 12px;
  color: var(--text-dim);
  font-size: 12px;
}

.yanta-pulse-ov-empty {
  padding: 22px 14px;
  text-align: center;

  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}
`;

  document.head.append(style);
}

// ---------------- rendering ---------------------------------------

function relativeTime(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);

  if (minutes < 1) return t('pulse.time.justNow');
  if (minutes < 60) return t('pulse.time.minutesAgo', { count: minutes });

  const hours = Math.round(minutes / 60);

  if (hours < 24) return t('pulse.time.hoursAgo', { count: hours });

  return t('pulse.time.daysAgo', { count: Math.round(hours / 24) });
}

function routineRow(routine, { overCap, inboxCount, state, onChange }) {
  const row = el('div', {
    class: `yanta-pulse-routine${routine.enabled && !overCap ? '' : ' is-off'}`,
  });

  const meta = el('div', { class: 'yanta-pulse-routine-meta' });
  meta.append(el('div', { class: 'yanta-pulse-routine-name' }, routine.name));

  if (routine.description) {
    meta.append(el('div', { class: 'yanta-pulse-routine-desc' }, routine.description));
  }

  const chips = [];

  if (overCap) {
    chips.push(`<span class="yanta-pulse-chip warn">${lucide('pause', 11)} ${escapeHtml(t('pulse.pausedByPlan'))}</span>`);
  }

  if (routine.invalid.length) {
    chips.push(`<span class="yanta-pulse-chip warn">${lucide('triangle-alert', 11)} ${escapeHtml(routine.invalid[0])}</span>`);
  } else {
    chips.push(`<span class="yanta-pulse-chip">${lucide('clock', 11)} ${escapeHtml(describeTrigger(routine, { t }))}</span>`);
  }

  if (inboxCount) {
    chips.push(`<span class="yanta-pulse-chip">${lucide('inbox', 11)} ${escapeHtml(t('pulse.cardsInInbox', { count: inboxCount }))}</span>`);
  }

  if (state.lastRunAt) {
    chips.push(`<span class="yanta-pulse-chip">${lucide('check', 11)} ${escapeHtml(relativeTime(state.lastRunAt))}</span>`);
  }

  const when = el('div', { class: 'yanta-pulse-routine-when' });
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
    closePulseOverview();
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

async function renderRoutinesTab(host, onChange) {
  const routines = await listRoutines();
  const allowance = await getPulseAllowance();
  const { active } = partitionByAllowance(routines, allowance);
  const overCapNames = new Set(
    partitionByAllowance(routines, allowance).overCap.map((r) => r.name)
  );
  const counts = await inboxCountByRoutine();
  const duplicates = await findDuplicateRoutineNotes();

  host.replaceChildren();

  // Duplicate routine notes are the visible symptom of a device having
  // seeded before its vault arrived. Offer the repair rather than
  // deleting notes silently.
  if (duplicates.length) {
    const note = el('div', { class: 'yanta-pulse-ov-note' });
    note.innerHTML = `${lucide('copy', 13)}<div class="yanta-pulse-ov-note-body">${
      escapeHtml(t('pulse.duplicates.body', { count: duplicates.length }))
    }</div>`;

    const fix = el('button', { type: 'button', class: 'yanta-pulse-mini' });
    fix.textContent = t('pulse.duplicates.cleanUp');

    fix.addEventListener('click', async () => {
      const removed = await removeDuplicateRoutineNotes();
      toast(t('pulse.duplicates.removed', { count: removed }), 'success');
      onChange();
    });

    note.querySelector('.yanta-pulse-ov-note-body').append(el('div', {}, fix));
    host.append(note);
  }

  const soon = await nextPulseAt();

  host.append(el('div', { class: 'yanta-pulse-ov-soon' },
    allowance.source === PULSE_ALLOWANCE_SOURCE.BYOK
      ? t('pulse.allowance.byok')
      : t('pulse.allowance.plan', { used: active.length, max: allowance.routines })
  ));

  if (soon) {
    host.append(el('div', { class: 'yanta-pulse-ov-soon' },
      t('pulse.nextRun', {
        when: new Date(soon).toLocaleString(undefined, {
          weekday: 'short', hour: '2-digit', minute: '2-digit',
        }),
      })
    ));
  }

  if (!routines.length) {
    host.append(el('div', { class: 'yanta-pulse-ov-empty' }, t('pulse.settings.noRoutines')));
    return;
  }

  const wrap = el('div', { class: 'yanta-pulse-routines' });

  const ordered = [
    ...routines.filter((r) => r.enabled),
    ...routines.filter((r) => !r.enabled),
  ];

  for (const routine of ordered) {
    wrap.append(routineRow(routine, {
      overCap: overCapNames.has(routine.name),
      inboxCount: counts.get(routine.name) || 0,
      state: await getRoutineState(routine.name),
      onChange,
    }));
  }

  host.append(wrap);
}

const OUTCOME_ICON = {
  delivered: ['check-check', 'ok'],
  silent: ['minus', ''],
  'no-signal': ['moon', ''],
  repeat: ['repeat', ''],
  failed: ['triangle-alert', 'err'],
};

async function renderHistoryTab(host, onChange) {
  const entries = await listRunHistory({ limit: 80 });

  host.replaceChildren();

  if (!entries.length) {
    host.append(el('div', { class: 'yanta-pulse-ov-empty' }, t('pulse.history.empty')));
    return;
  }

  const list = el('div', { class: 'yanta-pulse-hist' });

  for (const entry of entries) {
    const [icon, tone] = OUTCOME_ICON[entry.outcome] || ['dot', ''];
    const row = el('div', { class: `yanta-pulse-hist-row ${tone}`.trim() });

    const meta = el('div', { class: 'yanta-pulse-hist-meta' });

    meta.append(el('div', { class: 'yanta-pulse-hist-title' },
      entry.title || entry.routineName || t('pulse.unknownRoutine')));

    const outcomeKey = entry.outcome.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    meta.append(el('div', { class: 'yanta-pulse-hist-line' },
      [
        entry.routineName,
        t(`pulse.outcome.${outcomeKey}`),
        entry.manual ? t('pulse.history.manual') : '',
        entry.error || '',
      ].filter(Boolean).join(' · ')
    ));

    // The point of the history: what it actually did, not just that it ran.
    if (entry.tools?.length) {
      const tools = el('div', { class: 'yanta-pulse-hist-tools' });
      tools.innerHTML = `${escapeHtml(t('pulse.history.used'))} ${
        entry.tools.map((name) => `<code>${escapeHtml(name)}</code>`).join('')
      }`;
      meta.append(tools);
    }

    row.innerHTML = lucide(icon, 14);
    row.append(meta, el('div', { class: 'yanta-pulse-hist-when' }, relativeTime(entry.at)));

    list.append(row);
  }

  host.append(list);

  const clear = el('button', { type: 'button', class: 'yanta-pulse-mini' });
  clear.style.marginTop = '12px';
  clear.textContent = t('pulse.history.clear');

  clear.addEventListener('click', async () => {
    await clearRunHistory();
    onChange();
  });

  host.append(clear);
}

function renderLibraryTab(host) {
  host.replaceChildren(el('div', { class: 'yanta-pulse-ov-empty' }, t('pulse.library.soon')));
}

// ---------------- shell -------------------------------------------

function ensureModal() {
  if (modal) return modal;

  injectCss();

  modal = el('div', {
    class: 'yanta-pulse-overview',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('pulse.overviewTitle'),
  });

  modal.hidden = true;

  const panel = el('div', { class: 'yanta-pulse-ov-panel' });

  const head = el('div', { class: 'yanta-pulse-ov-head' });
  head.innerHTML = `${lucide('activity', 16)}<h2>${escapeHtml(t('pulse.overviewTitle'))}</h2>`;

  const gear = el('button', {
    type: 'button',
    class: 'yanta-pulse-icon-btn',
    title: t('pulse.openSettings'),
    'aria-label': t('pulse.openSettings'),
  });

  gear.innerHTML = lucide('settings', 15);

  gear.addEventListener('click', async () => {
    const { openSettings } = await import('../settings.js');

    closePulseOverview();
    openSettings({ section: 'pulse' });
  });

  const close = el('button', {
    type: 'button',
    class: 'yanta-pulse-icon-btn',
    title: t('pulse.close'),
    'aria-label': t('pulse.close'),
  });

  close.innerHTML = lucide('x', 16);
  close.addEventListener('click', () => closePulseOverview());

  head.append(gear, close);

  const sub = el('div', { class: 'yanta-pulse-ov-sub' }, t('pulse.overviewSubtitle'));

  const tabs = el('div', { class: 'yanta-pulse-ov-tabs' });
  const body = el('div', { class: 'yanta-pulse-ov-body' });

  /*
    Renders are async and clear the body before they fill it, so two
    overlapping passes append into the same host and every row shows up
    twice. Serialize instead: one pass at a time, and if a change lands
    mid-pass, run exactly one more afterwards.
  */
  let rendering = false;
  let dirty = false;

  const refresh = () => {
    if (rendering) {
      dirty = true;
      return;
    }

    rendering = true;

    render()
      .catch(() => {})
      .finally(() => {
        rendering = false;

        if (dirty) {
          dirty = false;
          refresh();
        }
      });
  };

  const render = async () => {
    for (const button of tabs.querySelectorAll('.yanta-pulse-ov-tab')) {
      button.classList.toggle('active', button.dataset.tab === activeTab);
    }

    if (activeTab === 'history') return renderHistoryTab(body, refresh);
    if (activeTab === 'library') return renderLibraryTab(body);

    return renderRoutinesTab(body, refresh);
  };

  for (const [id, key] of [
    ['routines', 'pulse.tabs.routines'],
    ['history', 'pulse.tabs.history'],
    ['library', 'pulse.tabs.library'],
  ]) {
    const button = el('button', {
      type: 'button',
      class: 'yanta-pulse-ov-tab',
      dataset: { tab: id },
    }, t(key));

    button.addEventListener('click', () => {
      activeTab = id;
      refresh();
    });

    tabs.append(button);
  }

  panel.append(head, sub, tabs, body);
  modal.append(panel);

  // Backdrop click closes; clicks inside must not.
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closePulseOverview();
  });

  document.body.append(modal);

  modal._refresh = refresh;

  for (const event of [
    'yanta-pulse-routines-changed',
    'yanta-pulse-history-changed',
    'yanta-pulse-inbox-changed',
  ]) {
    window.addEventListener(event, () => {
      if (modal.hidden === false) refresh();
    });
  }

  return modal;
}

export function pulseOverviewIsOpen() {
  return !!modal && modal.hidden === false;
}

function registerRoute() {
  if (registered) return;
  registered = true;

  registerOverlayRoute('pulse-overview', {
    open: () => openPulseOverview({ fromHistory: true }),
    close: () => closePulseOverview({ fromHistory: true }),
    isOpen: pulseOverviewIsOpen,
  });
}

export function openPulseOverview({
  fromHistory = false,
  tab = '',
} = {}) {
  ensureModal();
  registerRoute();

  if (tab) activeTab = tab;

  const wasClosed = modal.hidden !== false;

  modal.hidden = false;
  modal._refresh();

  if (!fromHistory && wasClosed) pushOverlayState('pulse-overview');
}

export function closePulseOverview({ fromHistory = false } = {}) {
  if (!modal || modal.hidden !== false) return;

  if (!fromHistory) {
    closeTopOverlay(() => closePulseOverview({ fromHistory: true }));
    return;
  }

  modal.hidden = true;
}

/** Plan-paused routines, for the "you should know" surfaces. */
export async function pausedByPlanRoutines() {
  const settings = await getPulseSettings();

  if (!settings.enabled) return [];

  const allowance = await getPulseAllowance();

  return partitionByAllowance(await listRoutines(), allowance).overCap;
}
