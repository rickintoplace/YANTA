// ============================================================
// YANTA — cycle calendar panel
//
// Opened from the line above the calendar or from the calendar list. In
// reading order it answers: where in the cycle is it now and when is the
// next period likely; then a month to tap days in — people think "today
// I'm bleeding", not "a period from … to …". Below: the numbers it is
// based on, the history (with gaps it suspects), and the few settings.
//
// Copy is neutral on purpose: the person reading may be the one whose
// cycle it is, or a partner the calendar is shared with.
// ============================================================

import { state, escapeHtml, escapeAttr, lucide, toast } from '../core.js';
import { t, getLocale } from '../i18n/index.js';
import { openSurface } from '../ui/surface.js';
import { categoryPersonalPrefs, setCategoryPersonalPrefs } from '../calendar-personal.js';
import { getCalendarPreferences } from '../calendar-preferences.js';
import { cycleViewFor, cycleDayMarks, togglePeriodDay, storedAllDay, todayKey, localKey, CYCLE_PERIOD_COLOR } from './cycle-calendar.js';
import { dayOf } from './cycle-model.js';

let panel = null;
let currentId = null;
let picking = null; // 'pause' | 'ovulation' | null
let pauseReason = 'pregnancy';
let month = null; // 'YYYY-MM' shown in the panel's month

const calendarApi = () => import('../calendar.js');

// ---------------- formatting -----------------------------------------

function fmt(key, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!key) return '';
  return new Date(`${key}T00:00:00`).toLocaleDateString(getLocale(), opts);
}

function fmtShort(key) {
  return fmt(key, { day: 'numeric', month: 'short' });
}

function days(n) {
  return t('cycle.days', { count: n });
}

// ---------------- data -----------------------------------------------

function category() {
  return state.calendarCategories.get(currentId) || null;
}

function entryEvent(id) {
  return state.calendarEvents.get(id) || null;
}

function recurringPlaceholders() {
  return [...state.calendarEvents.values()].filter((ev) =>
    ev.categoryId === currentId && (ev.recurrence?.rrule || ev.recurrence?.freq));
}

// ---------------- writes ---------------------------------------------

async function put(patch) {
  const { putCalendarEvent } = await calendarApi();
  return putCalendarEvent({ allDay: true, categoryId: currentId, reminders: [], ...patch });
}

/** A day tapped in the month: a period day now, or not any more. */
async function toggleDay(key) {
  const api = await calendarApi();
  const a = api.cycleCalendarAnalysis(currentId);
  if (!a) return;
  const plan = togglePeriodDay((a.entries || []).filter((e) => e.kind === 'period'), key, {
    today: todayKey(),
    periodLength: a.stats?.period,
  });
  const at = (k) => (k ? storedAllDay(k) : null);
  for (const u of plan.updates) {
    const ev = entryEvent(u.id);
    if (!ev) continue;
    await put({ ...ev, id: ev.id, start: at(u.start), end: at(u.end), cycle: { ...(ev.cycle || {}), kind: 'period' } });
  }
  for (const c of plan.creates) {
    await put({ title: t('cycle.entry.period'), start: at(c.start), end: at(c.end), cycle: { kind: 'period' } });
  }
  for (const id of plan.deletes) api.deleteCalendarEvent(id);
}

/** "It ended today": the running period gets today as its last day. */
async function endToday() {
  const a = (await calendarApi()).cycleCalendarAnalysis(currentId);
  const last = a?.periods?.at(-1);
  if (!last) return;
  const ev = entryEvent(last.ids.at(-1)) || entryEvent(last.ids[0]);
  if (!ev) return;
  const today = todayKey();
  await put({ ...ev, id: ev.id, start: storedAllDay(last.start), end: storedAllDay(today), cycle: { ...(ev.cycle || {}), kind: 'period' } });
  toast(t('cycle.toast.ended', { count: dayOf(today) - dayOf(last.start) + 1 }), 'success');
}

async function confirmLong(periodId) {
  const ev = entryEvent(periodId);
  if (!ev) return;
  await put({ ...ev, id: ev.id, cycle: { kind: 'period', confirmed: true } });
}

async function startPause(key, reason) {
  await put({ title: t(`cycle.entry.pause.${reason}`), start: storedAllDay(key), end: null, cycle: { kind: 'pause', reason, open: true } });
}

async function endPause(pauseId, key) {
  const ev = entryEvent(pauseId);
  if (!ev) return;
  const end = dayOf(key) > dayOf(localKey(ev.start)) ? storedAllDay(key) : null;
  await put({ ...ev, id: ev.id, end, cycle: { kind: 'pause', reason: ev.cycle?.reason || 'other' } });
}

async function logOvulation(key) {
  await put({ title: t('cycle.entry.ovulation'), start: storedAllDay(key), end: null, cycle: { kind: 'ovulation' } });
}

async function removePlaceholders() {
  const { deleteCalendarEvent } = await calendarApi();
  for (const ev of recurringPlaceholders()) deleteCalendarEvent(ev.id);
}

async function setView(patch) {
  const cat = category();
  if (!cat) return;
  const view = cycleViewFor(cat, categoryPersonalPrefs(cat.id));
  const api = await calendarApi();
  // A setting chosen here wins over a quick show/hide from the menu.
  api.setCycleLayerOverride(null);
  if (view.member) {
    const prev = categoryPersonalPrefs(cat.id)?.cycleView || {};
    setCategoryPersonalPrefs(cat.id, { cycleView: { ...prev, ...patch } });
    api.refreshCalendarSoon();
  } else {
    api.putCalendarCategory({ ...cat, cycle: { ...(cat.cycle || {}), ...patch } });
  }
}

// ---------------- render ---------------------------------------------

function heroHtml(a, cat) {
  const c = a.current;
  const range = c ? t('cycle.hero.range', { from: fmtShort(c.nextRange[0]), to: fmtShort(c.nextRange[1]) }) : '';

  if (a.status === 'paused') {
    return `
      <p class="ycy-big">${escapeHtml(t(`cycle.hero.paused.${a.pause.reason}`))}</p>
      <p class="ycy-line">${escapeHtml(t('cycle.hero.pausedSince', { date: fmt(a.pause.since) }))}</p>`;
  }
  if (a.status === 'after-pause') {
    return `
      <p class="ycy-big">${escapeHtml(t('cycle.hero.afterPause'))}</p>
      <p class="ycy-line">${escapeHtml(t('cycle.hero.afterPauseHint'))}</p>`;
  }
  if (a.status === 'empty' || !c) {
    return `
      <p class="ycy-big">${escapeHtml(t('cycle.hero.emptyTitle'))}</p>
      <p class="ycy-line">${escapeHtml(t('cycle.hero.emptyHint'))}</p>`;
  }

  const big = c.inPeriod
    ? t('cycle.hero.periodDay', { day: c.periodDay })
    : c.lateBy > 0
      ? t('cycle.hero.late', { count: c.lateBy })
      : t('cycle.hero.cycleDay', { day: c.day });

  const next = c.inPeriod
    ? t('cycle.hero.periodUntil', { date: fmt(c.periodEnd) })
    : t('cycle.hero.next', { date: fmt(c.nextLikely) });

  const sure = a.stats.regularity === 'irregular'
    ? t('cycle.hero.irregular')
    : a.status === 'learning' ? t('cycle.hero.learning') : '';

  return `
    <p class="ycy-big">${escapeHtml(big)}</p>
    <p class="ycy-line">${escapeHtml(next)}</p>
    ${c.inPeriod ? '' : `<p class="ycy-dim">${escapeHtml(range)}${sure ? ` · ${escapeHtml(sure)}` : ''}</p>`}`;
}

/*
  A month to tap days in. Logged period days are filled, expected ones
  dashed, fertile days tinted, the likely ovulation ringed. Days after
  today only show the forecast; nobody logs tomorrow.
*/
function monthHtml(a, cat) {
  const view = cycleViewFor(cat, categoryPersonalPrefs(cat.id));
  const today = todayKey();
  const marks = cycleDayMarks(a, view, { today });
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysIn = new Date(y, m, 0).getDate();
  const weekStart = Number(getCalendarPreferences()?.weekStart ?? 1) || 0;
  const lead = (first.getDay() - weekStart + 7) % 7;
  const locale = getLocale();
  const canLog = !cat.readonly;

  const weekdays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(2026, 0, 4 + ((weekStart + i) % 7)); // 2026-01-04 is a Sunday
    weekdays.push(`<span>${escapeHtml(d.toLocaleDateString(locale, { weekday: 'narrow' }))}</span>`);
  }

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="ycy-day is-blank"></span>');
  for (let d = 1; d <= daysIn; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const mk = marks.get(key) || {};
    const future = key > today;
    const cls = ['ycy-day'];
    if (mk.period === 'logged') cls.push('is-period');
    if (mk.period === 'expected') cls.push('is-expected', (mk.strength || 0) >= 0.6 ? 'is-likely' : 'is-maybe');
    if (mk.period && mk.runStart) cls.push('run-start');
    if (mk.period && mk.runEnd) cls.push('run-end');
    if (mk.fertile && !mk.period) cls.push('is-fertile');
    if (mk.ovulation) cls.push(mk.ovulationConfirmed ? 'is-ovulation-confirmed' : 'is-ovulation');
    if (key === today) cls.push('is-today');
    const what = mk.period === 'logged' ? t('cycle.legend.period')
      : mk.period === 'expected' ? t('cycle.legend.expected')
        : mk.fertile ? t('cycle.legend.fertile') : '';
    const label = `${fmt(key, { weekday: 'long', day: 'numeric', month: 'long' })}${what ? `: ${what}` : ''}`;
    const tappable = canLog && !future;
    cells.push(`<button type="button" class="${cls.join(' ')}" ${tappable ? `data-day="${key}" aria-pressed="${mk.period === 'logged'}"` : 'disabled'} aria-label="${escapeAttr(label)}"><span>${d}</span></button>`);
  }

  const title = first.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const thisMonth = today.slice(0, 7);
  const legend = [
    `<span><i class="is-period"></i>${escapeHtml(t('cycle.legend.period'))}</span>`,
    `<span><i class="is-expected"></i>${escapeHtml(t('cycle.legend.expected'))}</span>`,
    view.showFertile ? `<span><i class="is-fertile"></i>${escapeHtml(t('cycle.legend.fertile'))}</span>` : '',
    view.showOvulation ? `<span><i class="is-ovulation"></i>${escapeHtml(t('cycle.legend.ovulationShort'))}</span>` : '',
  ].join('');

  return `
    <section class="ycy-month" aria-label="${escapeAttr(title)}">
      <div class="ycy-month-head">
        <h3>${escapeHtml(title)}</h3>
        ${month !== thisMonth ? `<button type="button" class="ycy-link" data-month="today">${escapeHtml(t('cycle.month.today'))}</button>` : ''}
        <button type="button" class="icon-btn" data-month="-1" aria-label="${escapeAttr(t('cycle.month.prev'))}">${lucide('chevron-left', 16)}</button>
        <button type="button" class="icon-btn" data-month="1" aria-label="${escapeAttr(t('cycle.month.next'))}">${lucide('chevron-right', 16)}</button>
      </div>
      <div class="ycy-weekdays" aria-hidden="true">${weekdays.join('')}</div>
      <div class="ycy-days">${cells.join('')}</div>
      <div class="ycy-legend">${legend}</div>
      ${canLog ? `<p class="ycy-dim ycy-hint">${escapeHtml(t('cycle.month.hint'))}</p>` : ''}
    </section>`;
}

function actionsHtml(a, cat) {
  if (cat.readonly) return `<p class="ycy-dim ycy-note">${escapeHtml(t('cycle.readOnly'))}</p>`;

  if (a.status === 'paused') {
    return `
      <div class="ycy-actions">
        <button type="button" class="btn primary" data-act="end-pause">${escapeHtml(t('cycle.pause.end'))}</button>
      </div>`;
  }

  // Ending a running period today is the one thing a tap cannot say
  // (its days up to today are already marked); everything else is a tap
  // in the month.
  const c = a.current;
  if (c?.inPeriod && !c.periodEndLogged) {
    return `
      <div class="ycy-actions">
        <button type="button" class="btn ${c.periodDay > 2 ? 'primary' : ''}" data-act="end-today">${escapeHtml(t('cycle.act.endedToday'))}</button>
      </div>`;
  }
  // Starting a period is a tap on today in the month below.
  return '';
}

function factsHtml(a) {
  if (a.status === 'empty') return '';
  const s = a.stats;
  const reg = t(`cycle.regularity.${s.regularity}`);
  return `
    <dl class="ycy-facts">
      <div><dt>${escapeHtml(t('cycle.facts.cycle'))}</dt><dd>${escapeHtml(days(Math.round(s.cycle)))}<small>${escapeHtml(t('cycle.facts.usually', { from: s.usual[0], to: s.usual[1] }))}</small></dd></div>
      <div><dt>${escapeHtml(t('cycle.facts.period'))}</dt><dd>${escapeHtml(days(s.period))}</dd></div>
      <div><dt>${escapeHtml(t('cycle.facts.regularity'))}</dt><dd>${escapeHtml(reg)}${s.counted ? `<small>${escapeHtml(t('cycle.facts.basedOn', { count: s.counted }))}</small>` : ''}</dd></div>
    </dl>`;
}

function historyHtml(a, cat) {
  if (!a.periods.length) return '';
  // One row per cycle, by its first day: how long the period was, how
  // long the cycle (the running one: which day it is on).
  const cyclesByStart = new Map(a.cycles.map((c) => [c.start, c]));
  const rows = [...a.periods].reverse().slice(0, 8).map((p, i) => {
    const cycle = cyclesByStart.get(p.start);
    const len = p.end ? dayOf(p.end) - dayOf(p.start) + 1 : null;
    const running = i === 0 && a.current?.start === p.start;
    const flag = cycle?.flag === 'missed'
      ? `<span class="ycy-flag">${escapeHtml(t('cycle.history.missed'))}${cat.readonly ? '' : ` <button type="button" class="ycy-link" data-confirm-long="${escapeAttr(cycle.periodId)}">${escapeHtml(t('cycle.history.itWasLong'))}</button>`}</span>`
      : cycle?.flag === 'pause' ? `<span class="ycy-flag">${escapeHtml(t('cycle.history.pause'))}</span>`
        : cycle?.flag === 'short' || cycle?.flag === 'gap' ? `<span class="ycy-flag">${escapeHtml(t('cycle.history.notCounted'))}</span>` : '';
    const cycleText = running ? t('cycle.history.running', { day: a.current.day }) : cycle ? t('cycle.history.cycleLength', { count: cycle.length }) : '';
    return `
      <li>
        <button type="button" data-entry="${escapeAttr(p.ids[0])}">
          <span class="ycy-h-date">${escapeHtml(fmt(p.start, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
          <span class="ycy-h-len">${len ? escapeHtml(t('cycle.history.periodLength', { count: len })) : ''}</span>
          <span class="ycy-h-cycle">${escapeHtml(cycleText)}</span>
        </button>
        ${flag}
      </li>`;
  }).join('');

  return `
    <h4>${escapeHtml(t('cycle.history.title'))}</h4>
    <ul class="ycy-history">${rows}</ul>`;
}

function settingsHtml(a, cat, shareInfo) {
  const view = cycleViewFor(cat, categoryPersonalPrefs(cat.id));
  const toggle = (key, on, label, disabled = false) => `
    <label class="ycy-toggle ${disabled ? 'is-disabled' : ''}">
      <span>${escapeHtml(label)}</span>
      <input type="checkbox" data-view="${key}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
    </label>`;
  const seg = (name, options, value, label) => `
    <div class="ycy-setting">
      <span>${escapeHtml(label)}</span>
      <div class="ycy-seg" role="radiogroup" aria-label="${escapeAttr(label)}">
        ${options.map(([v, l]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-seg="${name}" data-value="${escapeAttr(v)}">${escapeHtml(l)}</button>`).join('')}
      </div>
    </div>`;

  const owner = !view.member;
  const shared = !!shareInfo?.shared;

  // Fertile days and ovulation: nowhere, only in this overview, or also
  // in the calendar.
  const where = [['off', t('cycle.settings.whereOff')], ['here', t('cycle.settings.whereHere')], ['calendar', t('cycle.settings.whereCalendar')]];
  const whereValue = (show, inCalendar) => (!show ? 'off' : inCalendar ? 'calendar' : 'here');

  const placeholders = recurringPlaceholders();

  return `
    <h4>${escapeHtml(t('cycle.settings.title'))}</h4>
    ${view.periodsOnly ? `<p class="ycy-dim">${escapeHtml(t('cycle.settings.periodsOnlyShared'))}</p>` : `
      ${seg('fertile', where, whereValue(view.showFertile, view.calFertile), t('cycle.settings.fertile'))}
      ${seg('ovulation', where, whereValue(view.showOvulation, view.calOvulation), t('cycle.settings.ovulation'))}`}
    ${toggle('calPeriods', view.calPeriods, t('cycle.settings.calPeriods'))}
    ${toggle('statusLine', view.statusLine, t('cycle.settings.statusLine'))}
    ${seg('remindDays', [[0, t('cycle.settings.remindOff')], [1, t('cycle.settings.remind1')], [2, t('cycle.settings.remind2')], [3, t('cycle.settings.remind3')]], view.remindDays, t('cycle.settings.remind'))}
    ${view.remindDays ? toggle('discreet', view.discreet, t('cycle.settings.discreet')) : ''}
    ${view.remindDays ? `<p class="ycy-dim ycy-note">${escapeHtml(view.discreet ? t('cycle.settings.discreetOn') : t('cycle.settings.discreetOff'))}</p>` : ''}
    ${owner && shared ? seg('partnerSees', [['all', t('cycle.settings.partnerAll')], ['periods', t('cycle.settings.partnerPeriods')]], cat.cycle?.partnerSees || 'all', t('cycle.settings.partnerSees')) : ''}
    ${owner && shared ? `<p class="ycy-dim ycy-note">${escapeHtml(t('cycle.settings.partnerHint'))}</p>` : ''}
    ${owner && a.stats.counted < 3 ? `
      <label class="ycy-setting">
        <span>${escapeHtml(t('cycle.settings.typicalLength'))}</span>
        <input type="number" class="ycy-num" min="18" max="60" placeholder="29" value="${escapeAttr(cat.cycle?.typicalLength || '')}" data-typical>
      </label>` : ''}
    ${cat.readonly ? '' : `
      <div class="ycy-more-actions">
        ${a.status === 'paused' ? '' : `<button type="button" class="ycy-link" data-pick="pause">${lucide('pause', 14)} ${escapeHtml(t('cycle.pause.start'))}</button>`}
        ${a.status === 'paused' || a.status === 'empty' ? '' : `<button type="button" class="ycy-link" data-pick="ovulation">${lucide('circle-dot', 14)} ${escapeHtml(t('cycle.act.ovulation'))}</button>`}
        ${owner && !shared ? `<button type="button" class="ycy-link" data-share>${lucide('share-2', 14)} ${escapeHtml(t('cycle.act.share'))}</button>` : ''}
      </div>
      ${picking === 'pause' || picking === 'ovulation' ? actionsPickHtml() : ''}`}
    ${placeholders.length && !cat.readonly ? `
      <p class="ycy-dim ycy-note">${escapeHtml(t('cycle.settings.placeholders', { count: placeholders.length }))}
        <button type="button" class="ycy-link" data-remove-placeholders>${escapeHtml(t('cycle.settings.removePlaceholders'))}</button></p>` : ''}`;
}

function actionsPickHtml() {
  const today = todayKey();
  const what = picking;
  return `
    <form class="ycy-pick" data-pick-form="${what}">
      ${what === 'pause' ? `
        <div class="ycy-seg" role="radiogroup" aria-label="${escapeAttr(t('cycle.pause.reason'))}">
          ${['pregnancy', 'hormonal', 'other'].map((r) => `<button type="button" role="radio" aria-checked="${pauseReason === r}" data-reason="${r}">${escapeHtml(t(`cycle.pause.${r}`))}</button>`).join('')}
        </div>` : ''}
      <label><span>${escapeHtml(what === 'pause' ? t('cycle.pick.pause') : t('cycle.pick.ovulation'))}</span><input type="date" name="day" value="${today}" max="${today}" required></label>
      ${what === 'ovulation' ? `<p class="ycy-dim">${escapeHtml(t('cycle.pick.ovulationHint'))}</p>` : ''}
      <button type="submit" class="btn primary">${escapeHtml(t('cycle.save'))}</button>
      <button type="button" class="ycy-link" data-cancel-pick>${escapeHtml(t('common.cancel'))}</button>
    </form>`;
}

async function render() {
  if (!panel) return;
  const cat = category();
  if (!cat?.cycle) return close();
  const api = await calendarApi();
  const a = api.cycleCalendarAnalysis(currentId);
  if (!a || !panel) return;

  panel.setTitle(cat.name || t('cycle.defaultName'));
  panel.root.style.setProperty('--cyc-color', CYCLE_PERIOD_COLOR);

  const body = panel.body;
  const scroll = body.scrollTop;
  body.innerHTML = `
    <section class="ycy-hero" aria-live="polite">${heroHtml(a, cat)}</section>
    ${actionsHtml(a, cat)}
    ${monthHtml(a, cat)}
    ${factsHtml(a)}
    ${historyHtml(a, cat)}
    ${settingsHtml(a, cat, api.calendarCategoryShareInfo(cat.id))}
    <p class="ycy-disclaimer">${escapeHtml(t('cycle.disclaimer'))}</p>`;
  body.scrollTop = scroll;

  const focusDate = body.querySelector('.ycy-pick input[type="date"]');
  if (focusDate && document.activeElement?.closest?.('.ycy-pick') == null) focusDate.focus({ preventScroll: false });
}

// ---------------- open / close ---------------------------------------

function close() {
  panel?.close();
}

/** What has to stop when the surface goes, however it was closed. */
function closed() {
  panel = null;
  picking = null;
  window.removeEventListener('yanta-calendar-updated', onChange);
  window.removeEventListener('yanta-calendar-space-applied', onChange);
}

let changeTimer = null;
function onChange() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => render(), 60);
}

async function onClick(e) {
  const cat = category();
  if (!cat) return;

  const act = e.target.closest('[data-act]')?.dataset.act;
  const today = todayKey();
  if (act === 'end-today') { picking = null; return endToday(); }

  const day = e.target.closest('[data-day]')?.dataset.day;
  if (day) return toggleDay(day);

  const nav = e.target.closest('[data-month]')?.dataset.month;
  if (nav) {
    if (nav === 'today') month = today.slice(0, 7);
    else {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(nav), 1);
      month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    return render();
  }
  if (act === 'end-pause') {
    const a = (await calendarApi()).cycleCalendarAnalysis(currentId);
    if (a?.pause?.id) await endPause(a.pause.id, today);
    return;
  }

  const pick = e.target.closest('[data-pick]')?.dataset.pick;
  if (pick) { picking = picking === pick ? null : pick; return render(); }
  if (e.target.closest('[data-cancel-pick]')) { picking = null; return render(); }

  const reason = e.target.closest('[data-reason]')?.dataset.reason;
  if (reason) {
    pauseReason = reason;
    for (const b of panel.querySelectorAll('[data-reason]')) b.setAttribute('aria-checked', String(b.dataset.reason === reason));
    return;
  }

  const seg = e.target.closest('[data-seg]');
  if (seg) {
    const value = seg.dataset.seg === 'remindDays' ? Number(seg.dataset.value) : seg.dataset.value;
    if (seg.dataset.seg === 'partnerSees') {
      const api = await calendarApi();
      api.putCalendarCategory({ ...cat, cycle: { ...(cat.cycle || {}), partnerSees: value } });
    } else if (seg.dataset.seg === 'fertile' || seg.dataset.seg === 'ovulation') {
      const name = seg.dataset.seg === 'fertile' ? 'Fertile' : 'Ovulation';
      await setView({ [`show${name}`]: value !== 'off', [`cal${name}`]: value === 'calendar' });
    } else {
      await setView({ [seg.dataset.seg]: value });
    }
    return render();
  }

  const confirmId = e.target.closest('[data-confirm-long]')?.dataset.confirmLong;
  if (confirmId) return confirmLong(confirmId);

  if (e.target.closest('[data-remove-placeholders]')) return removePlaceholders();

  if (e.target.closest('[data-share]')) {
    const { openUnifiedShareModal } = await import('../public-share/public-share-ui.js');
    close();
    requestAnimationFrame(() => openUnifiedShareModal({ calendarCategoryId: cat.id }));
    return;
  }

  const entry = e.target.closest('[data-entry]')?.dataset.entry;
  if (entry && state.calendarEvents.has(entry)) {
    close();
    const { openCalendarEvent } = await calendarApi();
    requestAnimationFrame(() => openCalendarEvent(entry));
  }
}

async function onChangeInput(e) {
  const view = e.target.closest('[data-view]');
  if (view) return setView({ [view.dataset.view]: view.checked });
  if (e.target.matches('[data-typical]')) {
    const cat = category();
    const n = Math.round(Number(e.target.value));
    const api = await calendarApi();
    api.putCalendarCategory({ ...cat, cycle: { ...(cat.cycle || {}), typicalLength: n >= 18 && n <= 60 ? n : undefined } });
  }
}

async function onSubmit(e) {
  const form = e.target.closest('[data-pick-form]');
  if (!form) return;
  e.preventDefault();
  const key = form.querySelector('input[name="day"]')?.value;
  if (!key) return;
  const what = form.dataset.pickForm;
  picking = null;
  if (what === 'pause') await startPause(key, pauseReason);
  else if (what === 'ovulation') await logOvulation(key);
  render();
}

export async function openCyclePanel(categoryId) {
  if (panel && currentId === categoryId) return;
  if (panel) close();
  currentId = categoryId;
  picking = null;
  month = todayKey().slice(0, 7);

  panel = openSurface({
    kind: 'dialog',
    title: category()?.name || t('cycle.defaultName'),
    width: 440,
    className: 'ycy',
    historyId: 'cycle-panel',
    onClose: closed,
  });

  panel.body.addEventListener('click', (e) => { onClick(e).catch((err) => console.warn('[Cycle]', err)); });
  panel.body.addEventListener('change', (e) => { onChangeInput(e).catch((err) => console.warn('[Cycle]', err)); });
  panel.body.addEventListener('submit', (e) => { onSubmit(e).catch((err) => console.warn('[Cycle]', err)); });
  window.addEventListener('yanta-calendar-updated', onChange);
  window.addEventListener('yanta-calendar-space-applied', onChange);

  await render();
}
