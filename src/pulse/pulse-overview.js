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

import { swapOverlay } from '../overlay-history.js';
import { openSurface } from '../ui/surface.js';

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

let dialog = null; // the open overview, a surface (src/ui/surface.js)
let activeTab = 'routines';
let refresh = () => {};

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
    /*
      Overlay → app route, so the overlay must NOT call history.back():
      that fires asynchronously and would land after openNote() has
      routed, dragging the user straight back off the note. Hide it
      directly instead — pushAppRoute replaces a current overlay entry
      on its own, so Back from the note returns to the surface behind
      the overview, which is what the user means by Back here.
    */
    closePulseOverview({ fromHistory: true });

    await openNote(routine.noteId);
  });

  // Sharing is a link, not an upload — the routine travels in the
  // fragment, so nothing leaves the device on the way out either.
  const share = el('button', {
    type: 'button',
    class: 'yanta-pulse-mini',
    title: t('pulse.library.shareRoutine'),
    'aria-label': t('pulse.library.shareRoutine'),
  });

  share.innerHTML = lucide('share-2', 12);

  share.addEventListener('click', async () => {
    const { copyRoutineLink } = await import('./pulse-library.js');
    const result = await copyRoutineLink(routine.markdown);

    if (result.ok) {
      toast(t('pulse.library.linkCopied'), 'success');
      return;
    }

    if (navigator.share) {
      await navigator.share({ title: routine.name, url: result.link }).catch(() => {});
      return;
    }

    toast(result.message, 'error');
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

  side.append(run, share, open, toggle);
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
    host.append(emptyState('activity', t('pulse.settings.noRoutines')));
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
  'near-repeat': ['copy', ''],
  failed: ['triangle-alert', 'err'],
  'check-skipped': ['funnel', ''],
  filed: ['notebook-pen', 'ok'],
};

async function renderHistoryTab(host, onChange) {
  const entries = await listRunHistory({ limit: 80 });

  host.replaceChildren();

  if (!entries.length) {
    host.append(emptyState('history', t('pulse.history.empty')));
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
        entry.note || '',
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

function emptyState(icon, text) {
  const wrap = el('div', { class: 'yanta-pulse-ov-empty' });

  wrap.innerHTML = lucide(icon, 22);
  wrap.append(el('span', {}, text));

  return wrap;
}

/**
 * Ready-made routines, plus the way in for one somebody sent you.
 *
 * The catalog is a lazy import so none of its prose sits in the boot
 * bundle — nobody needs it until this tab is opened.
 */
async function renderLibraryTab(host, onChange) {
  const [{ catalogFor }, routines] = await Promise.all([
    import('./pulse-catalog.js'),
    listRoutines(),
  ]);

  const installed = new Set(routines.map((routine) => routine.name));
  const items = catalogFor(installed);

  host.replaceChildren();

  host.append(el('div', { class: 'yanta-pulse-ov-soon' }, t('pulse.library.intro')));

  const grid = el('div', { class: 'yanta-pulse-lib-grid' });

  for (const item of items) {
    grid.append(catalogCard(item, onChange));
  }

  host.append(grid);
  host.append(pasteLinkRow(onChange));
}

// Catalog descriptions are shown in the app language; the English text
// stays the routine's own description once installed (it is note data).
function catalogDescription(item) {
  const id = String(item.name || '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const key = `pulse.library.desc.${id}`;
  const text = t(key);
  return text === key ? item.description : text;
}

function catalogCard(item, onChange) {
  const card = el('div', {
    class: `yanta-pulse-lib-card${item.installed ? ' is-installed' : ''}`,
  });

  const head = el('div', { class: 'yanta-pulse-lib-head' });
  head.innerHTML = `${lucide(item.icon, 15)}<strong>${escapeHtml(item.name)}</strong>`;
  card.append(head);

  card.append(el('p', {}, catalogDescription(item)));

  const action = el('button', {
    type: 'button',
    class: `yanta-pulse-mini${item.installed ? '' : ' primary-ghost'}`,
  });

  action.textContent = item.installed
    ? t('pulse.library.alreadyInstalled')
    : t('pulse.library.add');

  action.disabled = item.installed;

  action.addEventListener('click', async () => {
    action.disabled = true;

    try {
      const { installRoutine } = await import('./pulse-library.js');
      const created = await installRoutine(item.markdown, { name: item.name });

      toast(t('pulse.library.added', { name: created.name }), 'success');
      onChange();
    } catch (err) {
      action.disabled = false;
      toast(err?.message || String(err), 'error');
    }
  });

  card.append(action);

  return card;
}

/**
 * A pasted link, for when the routine arrived somewhere that will not
 * hand YANTA a deep link — an email, a screenshot's caption, a laptop.
 */
function pasteLinkRow(onChange) {
  const wrap = el('div', { class: 'yanta-pulse-lib-paste' });

  wrap.append(el('h3', { class: 'ys-section-title' }, t('pulse.library.pasteLabel')));

  const row = el('div', { class: 'yanta-pulse-actions' });

  const input = el('input', {
    type: 'text',
    class: 'yanta-settings-input',
    placeholder: t('pulse.library.pastePlaceholder'),
  });

  const go = el('button', { type: 'button', class: 'yanta-pulse-mini' }, t('pulse.library.open'));

  const submit = async () => {
    const value = input.value.trim();
    if (!value) return;

    const { routinePayloadFrom } = await import('./pulse-library.js');
    const payload = routinePayloadFrom(value) || value;

    const { openRoutineImport } = await import('./pulse-import-ui.js');

    input.value = '';
    await openRoutineImport(payload);

    onChange();
  };

  go.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  row.append(input, go);
  wrap.append(row);

  return wrap;
}

// ---------------- shell -------------------------------------------

const CHANGE_EVENTS = [
  'yanta-pulse-routines-changed',
  'yanta-pulse-history-changed',
  'yanta-pulse-inbox-changed',
];

/*
  `adoptHistory`: Settings handed its history entry over (swapOverlay),
  so the overview binds to that entry instead of pushing another — Back
  then returns to where Settings was opened from.
*/
function openDialog({ adoptHistory = false } = {}) {
  injectPulseCss();

  const gearLabel = escapeHtml(t('pulse.openSettings'));

  dialog = openSurface({
    kind: 'dialog',
    title: t('pulse.overviewTitle'),
    width: 760,
    className: 'ypo',
    historyId: 'pulse-overview',
    adoptHistory,
    headerExtra: `<button type="button" class="icon-btn" data-gear title="${gearLabel}" aria-label="${gearLabel}">${lucide('settings', 16)}</button>`,
    onClose: () => {
      dialog = null;
      refresh = () => {};
      for (const event of CHANGE_EVENTS) window.removeEventListener(event, onChange);
    },
  });

  dialog.root.querySelector('[data-gear]').addEventListener('click', async () => {
    const { openSettings } = await import('../settings.js');

    swapOverlay('settings', {
      from: closePulseOverview,
      to: () => openSettings({ fromHistory: true, section: 'pulse' }),
    });
  });

  // Subtitle and tabs stay put above the scrolling body.
  const top = el('div', { class: 'ypo-top' });
  top.append(el('p', { class: 'ys-dim' }, t('pulse.overviewSubtitle')));

  const tabs = el('div', { class: 'ypo-tabs', role: 'tablist' });
  const body = dialog.body;

  /*
    Renders are async and clear the body before they fill it, so two
    overlapping passes append into the same host and every row shows up
    twice. Serialize instead: one pass at a time, and if a change lands
    mid-pass, run exactly one more afterwards.
  */
  let rendering = false;
  let dirty = false;

  const render = async () => {
    for (const button of tabs.querySelectorAll('.ypo-tab')) {
      const on = button.dataset.tab === activeTab;
      button.classList.toggle('active', on);
      button.setAttribute('aria-selected', String(on));
    }

    if (activeTab === 'history') return renderHistoryTab(body, refresh);
    if (activeTab === 'library') return renderLibraryTab(body, refresh);

    return renderRoutinesTab(body, refresh);
  };

  refresh = () => {
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

  for (const [id, key, icon] of [
    ['routines', 'pulse.tabs.routines', 'activity'],
    ['history', 'pulse.tabs.history', 'history'],
    ['library', 'pulse.tabs.library', 'library'],
  ]) {
    const button = el('button', {
      type: 'button',
      class: 'ypo-tab',
      role: 'tab',
      dataset: { tab: id },
    });

    button.innerHTML = lucide(icon, 14);
    button.append(el('span', {}, t(key)));

    button.addEventListener('click', () => {
      activeTab = id;
      refresh();
    });

    tabs.append(button);
  }

  top.append(tabs);
  dialog.surface.insertBefore(top, body);

  for (const event of CHANGE_EVENTS) window.addEventListener(event, onChange);
}

function onChange() {
  refresh();
}

export function pulseOverviewIsOpen() {
  return !!dialog && !dialog.closed;
}

export function openPulseOverview({
  fromHistory = false,
  tab = '',
} = {}) {
  if (tab) activeTab = tab;

  if (!pulseOverviewIsOpen()) openDialog({ adoptHistory: fromHistory });

  refresh();
}

export function closePulseOverview({ fromHistory = false } = {}) {
  dialog?.close({ fromHistory });
}

/** Plan-paused routines, for the "you should know" surfaces. */
export async function pausedByPlanRoutines() {
  const settings = await getPulseSettings();

  if (!settings.enabled) return [];

  const allowance = await getPulseAllowance();

  /*
    Only claim the PLAN paused something when the server actually told us
    what the plan is. With an expired session or no network the allowance
    is a remembered guess, and announcing "your plan paused 4 routines"
    off a guess is how a paying customer gets told they were downgraded.
  */
  if (allowance.confirmed === false) return [];

  return partitionByAllowance(await listRoutines(), allowance).overCap;
}
