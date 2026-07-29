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
  swapOverlay,
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
/*
  Built on the app's .modal / .modal-card so the backdrop, fade-in,
  z-index and [hidden] behaviour match Settings exactly.

  The card's height is fixed rather than content-driven: the tabs hold
  very different amounts of content, and a panel that resizes under the
  pointer on every tab switch feels broken. The body scrolls instead.
*/
.yanta-pulse-ov-card {
  width: min(760px, 92vw);
  height: min(660px, 86vh);

  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.yanta-pulse-ov-head {
  display: flex;
  align-items: center;
  gap: 10px;

  flex: 0 0 auto;
  padding: 15px 18px 13px;
  border-bottom: 1px solid var(--border);
}

.yanta-pulse-ov-head > svg { color: var(--accent); }

.yanta-pulse-ov-head h2 {
  flex: 1;
  min-width: 0;
  margin: 0;

  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}

.yanta-pulse-ov-sub {
  flex: 0 0 auto;
  padding: 12px 18px 0;

  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.yanta-pulse-ov-tabs {
  flex: 0 0 auto;

  display: flex;
  gap: 3px;

  margin: 12px 18px 0;
  padding: 3px;

  border-radius: 10px;
  background: var(--bg-elev-2, var(--bg-elev));
}

.yanta-pulse-ov-tab {
  flex: 1;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  padding: 7px 10px;

  border: 0;
  border-radius: 8px;
  background: transparent;

  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;

  transition: background .14s ease, color .14s ease;
}

.yanta-pulse-ov-tab > svg { flex: 0 0 auto; opacity: .8; }
.yanta-pulse-ov-tab.active > svg { opacity: 1; color: var(--accent); }

.yanta-pulse-ov-tab:hover { color: var(--text); }

.yanta-pulse-ov-tab.active {
  background: var(--bg-elev-3, var(--bg));
  color: var(--text);
  font-weight: 600;
}

.yanta-pulse-ov-body {
  flex: 1;
  min-height: 0;

  display: flex;
  flex-direction: column;

  padding: 14px 18px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* A fixed-height panel leaves real space when a tab has little to show.
   Empty states take the middle of it rather than clinging to the top,
   which is what makes the height read as deliberate instead of broken. */
.yanta-pulse-ov-empty {
  margin: auto 0;
  padding: 24px 14px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;

  text-align: center;
}

/* Lists keep their natural height at the top of the flex column. */
.yanta-pulse-ov-body > .yanta-pulse-routines,
.yanta-pulse-ov-body > .yanta-pulse-hist {
  flex: 0 0 auto;
}

.yanta-pulse-ov-empty > svg {
  color: var(--text-dim);
  opacity: .5;
}

.yanta-pulse-ov-empty span {
  max-width: 32ch;

  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.6;
}

/* Phones: a sheet that owns the screen, like Settings — not a window
   floating on a backdrop nobody can reach around. */
@media (max-width: 720px) {
  .yanta-pulse-modal { padding: 0; }

  .yanta-pulse-ov-card {
    width: 100%;
    height: 100dvh;
    max-height: none;

    border: 0;
    border-radius: 0;
  }

  .yanta-pulse-ov-head {
    padding-top: max(15px, env(safe-area-inset-top));
  }

  .yanta-pulse-ov-tab { font-size: 13.5px; padding: 9px 10px; }

  .yanta-pulse-ov-body {
    padding: 14px 16px calc(24px + env(safe-area-inset-bottom));
  }

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

.yanta-pulse-lib-grid {
  flex: 0 0 auto;

  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(216px, 1fr));
  gap: 10px;
}

.yanta-pulse-lib-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;

  padding: 13px;

  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg-elev);
}

.yanta-pulse-lib-card.is-installed { opacity: .6; }

.yanta-pulse-lib-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.yanta-pulse-lib-head > svg { flex: 0 0 auto; color: var(--accent); }

.yanta-pulse-lib-head strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.yanta-pulse-lib-card p {
  flex: 1;
  margin: 0;

  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.yanta-pulse-mini.primary-ghost {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  color: var(--accent);
}

.yanta-pulse-lib-paste {
  flex: 0 0 auto;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.yanta-pulse-lib-paste .yanta-settings-input { flex: 1; min-width: 0; }

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
  failed: ['triangle-alert', 'err'],
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

function catalogCard(item, onChange) {
  const card = el('div', {
    class: `yanta-pulse-lib-card${item.installed ? ' is-installed' : ''}`,
  });

  const head = el('div', { class: 'yanta-pulse-lib-head' });
  head.innerHTML = `${lucide(item.icon, 15)}<strong>${escapeHtml(item.name)}</strong>`;
  card.append(head);

  card.append(el('p', {}, item.description));

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

  wrap.append(el('div', { class: 'yanta-pulse-import-label' }, t('pulse.library.pasteLabel')));

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

function ensureModal() {
  if (modal) return modal;

  injectCss();

  /*
    An HMR reload gives this module a second instance with its own
    `modal` variable, while the previous instance's element is still in
    the document. Two overlays then answer the same clicks. Claim the
    DOM for the live instance rather than stacking ghosts on it.
  */
  for (const stale of document.querySelectorAll('.yanta-pulse-overview')) {
    stale.remove();
  }

  modal = el('div', {
    class: 'modal yanta-pulse-modal yanta-pulse-overview',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('pulse.overviewTitle'),
  });

  modal.hidden = true;

  const panel = el('div', { class: 'modal-card yanta-pulse-ov-card' });

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

    swapOverlay('settings', {
      from: closePulseOverview,
      to: () => openSettings({ fromHistory: true, section: 'pulse' }),
    });
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
    if (activeTab === 'library') return renderLibraryTab(body, refresh);

    return renderRoutinesTab(body, refresh);
  };

  for (const [id, key, icon] of [
    ['routines', 'pulse.tabs.routines', 'activity'],
    ['history', 'pulse.tabs.history', 'history'],
    ['library', 'pulse.tabs.library', 'library'],
  ]) {
    const button = el('button', {
      type: 'button',
      class: 'yanta-pulse-ov-tab',
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
