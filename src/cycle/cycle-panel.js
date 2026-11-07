// ============================================================
// YANTA — cycle calendar panel
//
// Opened from a forecast in the calendar or from the calendar list. In
// reading order it answers: where in the cycle is it now, when is the
// next period likely (as a range, with how sure), and what can be
// logged right now — one tap for the common case ("started today"),
// one more for another day. Below: the numbers it is based on, the
// history (with gaps it suspects), and the few settings there are.
//
// Copy is neutral on purpose: the person reading may be the one whose
// cycle it is, or a partner the calendar is shared with.
// ============================================================

import { state, escapeHtml, escapeAttr, lucide, toast } from '../core.js';
import { t, getLocale } from '../i18n/index.js';
import { openBoundOverlay } from '../overlay-history.js';
import { categoryPersonalPrefs, setCategoryPersonalPrefs } from '../calendar-personal.js';
import { cycleViewFor, storedAllDay, todayKey, localKey } from './cycle-calendar.js';
import { dayOf } from './cycle-model.js';

const PHONE = '(max-width: 640px)';

let panel = null;
let currentId = null;
let releaseOverlay = null;
let picking = null; // 'start' | 'end' | 'pause' | 'ovulation' | null
let pauseReason = 'pregnancy';

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

async function logStart(key) {
  const a = (await calendarApi()).cycleCalendarAnalysis(currentId);
  const same = a?.periods?.find((p) => Math.abs(dayOf(p.start) - dayOf(key)) < 1);
  if (same) {
    toast(t('cycle.toast.alreadyLogged'), 'info');
    return;
  }
  const ev = await put({ title: t('cycle.entry.period'), start: storedAllDay(key), end: null, cycle: { kind: 'period' } });
  if (ev) toast(t('cycle.toast.started', { date: fmt(key) }), 'success');
}

async function logEnd(key) {
  const a = (await calendarApi()).cycleCalendarAnalysis(currentId);
  const last = a?.periods?.at(-1);
  if (!last) return;
  const ev = entryEvent(last.ids[0]);
  if (!ev) return;
  const end = dayOf(key) > dayOf(last.start) ? storedAllDay(key) : null;
  const saved = await put({ ...ev, id: ev.id, end });
  if (saved) toast(t('cycle.toast.ended', { count: dayOf(key) - dayOf(last.start) + 1 }), 'success');
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
    ${c.inPeriod ? '' : `<p class="ycy-dim">${escapeHtml(range)}${sure ? ` · ${escapeHtml(sure)}` : ''}</p>`}
    ${stripHtml(a, cat)}`;
}

/*
  The running cycle as a row of days: period, fertile days, the likely
  ovulation, today, and where the next period is likely to start.
*/
function stripHtml(a, cat) {
  const c = a.current;
  if (!c) return '';
  const view = cycleViewFor(cat, categoryPersonalPrefs(cat.id));
  const start = dayOf(c.start);
  const nextTo = dayOf(c.nextRange[1]);
  const total = Math.max(c.day, Math.min(60, nextTo - start + 1));
  const fertile = view.showFertile ? a.forecasts.find((f) => f.kind === 'fertile' && f.cycle === 1) : null;
  const ov = view.showOvulation ? a.forecasts.find((f) => f.kind === 'ovulation' && f.cycle === 1) : null;
  const nextFrom = dayOf(c.nextRange[0]);
  const periodEnd = dayOf(c.periodEnd);
  const today = dayOf(todayKey());

  const cells = [];
  for (let i = 0; i < total; i++) {
    const d = start + i;
    const cls = [];
    if (d <= periodEnd) cls.push('is-period');
    else if (d >= nextFrom) cls.push('is-next');
    else if (fertile && d >= dayOf(fertile.start) && d <= dayOf(fertile.end)) cls.push('is-fertile');
    if (ov && d === dayOf(ov.likely)) cls.push('is-ovulation');
    if (d === today) cls.push('is-today');
    if (d > today) cls.push('is-future');
    cells.push(`<span class="${cls.join(' ')}"></span>`);
  }

  const legend = [
    `<span><i class="is-period"></i>${escapeHtml(t('cycle.legend.period'))}</span>`,
    fertile ? `<span><i class="is-fertile"></i>${escapeHtml(t('cycle.legend.fertile'))}</span>` : '',
    ov ? `<span><i class="is-ovulation"></i>${escapeHtml(t('cycle.legend.ovulation', { date: fmtShort(ov.likely) }))}</span>` : '',
    `<span><i class="is-next"></i>${escapeHtml(t('cycle.legend.next'))}</span>`,
  ].join('');

  return `
    <div class="ycy-strip" style="--n:${total}" role="img" aria-label="${escapeAttr(t('cycle.stripLabel', { day: c.day, total }))}">${cells.join('')}</div>
    <div class="ycy-legend">${legend}</div>`;
}

function actionsHtml(a, cat) {
  if (cat.readonly) return `<p class="ycy-dim">${escapeHtml(t('cycle.readOnly'))}</p>`;

  const today = todayKey();
  const pick = (what, label) => picking === what
    ? `<form class="ycy-pick" data-pick-form="${what}">
        <label><span>${escapeHtml(label)}</span><input type="date" name="day" value="${today}" max="${today}" required></label>
        <button type="submit" class="btn primary">${escapeHtml(t('cycle.save'))}</button>
        <button type="button" class="ycy-link" data-cancel-pick>${escapeHtml(t('common.cancel'))}</button>
      </form>`
    : '';

  if (a.status === 'paused') {
    return `
      <div class="ycy-actions">
        <button type="button" class="btn primary" data-act="end-pause">${escapeHtml(t('cycle.pause.end'))}</button>
      </div>`;
  }

  const c = a.current;
  const running = c?.inPeriod && !c.periodEndLogged;
  const primary = running
    ? `<button type="button" class="btn ${c.periodDay > 2 ? 'primary' : ''}" data-act="end-today">${escapeHtml(t('cycle.act.endedToday'))}</button>
       <button type="button" class="ycy-link" data-pick="end">${escapeHtml(t('cycle.act.otherDay'))}</button>`
    : `<button type="button" class="btn primary" data-act="start-today">${lucide('droplet', 15)} ${escapeHtml(t('cycle.act.startedToday'))}</button>
       <button type="button" class="ycy-link" data-pick="start">${escapeHtml(a.status === 'empty' ? t('cycle.act.lastStart') : t('cycle.act.otherDay'))}</button>`;

  return `
    <div class="ycy-actions">${primary}</div>
    ${pick('start', t('cycle.pick.start'))}
    ${pick('end', t('cycle.pick.end'))}`;
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

  const placeholders = recurringPlaceholders();

  return `
    <h4>${escapeHtml(t('cycle.settings.title'))}</h4>
    ${view.periodsOnly ? `<p class="ycy-dim">${escapeHtml(t('cycle.settings.periodsOnlyShared'))}</p>` : `
      ${toggle('showFertile', view.showFertile, t('cycle.settings.showFertile'))}
      ${toggle('showOvulation', view.showOvulation, t('cycle.settings.showOvulation'))}`}
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

  panel.querySelector('.ycy-title').textContent = cat.name || t('cycle.defaultName');
  panel.querySelector('.ycy-dot').style.background = cat.color || 'var(--accent)';
  panel.style.setProperty('--cyc-color', cat.color || '#d6336c');

  const body = panel.querySelector('.ycy-body');
  const scroll = body.scrollTop;
  body.innerHTML = `
    <section class="ycy-hero" aria-live="polite">${heroHtml(a, cat)}</section>
    ${actionsHtml(a, cat)}
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
  if (!panel) return;
  const el = panel;
  panel = null;
  picking = null;
  window.removeEventListener('yanta-calendar-updated', onChange);
  window.removeEventListener('yanta-calendar-space-applied', onChange);
  document.removeEventListener('keydown', onKey, true);
  releaseOverlay?.();
  releaseOverlay = null;
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 150);
}

let changeTimer = null;
function onChange() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => render(), 60);
}

function onKey(e) {
  if (e.key === 'Escape' && panel && e.isTrusted) {
    e.stopPropagation();
    if (picking) {
      picking = null;
      render();
    } else close();
  }
}

async function onClick(e) {
  const cat = category();
  if (!cat) return;
  if (e.target.closest('[data-close]')) return close();

  const act = e.target.closest('[data-act]')?.dataset.act;
  const today = todayKey();
  if (act === 'start-today') { picking = null; return logStart(today); }
  if (act === 'end-today') { picking = null; return logEnd(today); }
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
  if (what === 'start') await logStart(key);
  else if (what === 'end') await logEnd(key);
  else if (what === 'pause') await startPause(key, pauseReason);
  else if (what === 'ovulation') await logOvulation(key);
  render();
}

export async function openCyclePanel(categoryId) {
  if (panel && currentId === categoryId) return;
  if (panel) close();
  currentId = categoryId;
  picking = null;
  ensureCss();

  const phone = window.matchMedia(PHONE).matches;
  panel = document.createElement('div');
  panel.className = `ycy ${phone ? 'is-sheet' : 'is-dialog'}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `
    <div class="ycy-scrim" data-close></div>
    <div class="ycy-surface">
      ${phone ? '<div class="ycy-grip" aria-hidden="true"></div>' : ''}
      <header class="ycy-head">
        <span class="ycy-dot" aria-hidden="true"></span>
        <h2 class="ycy-title"></h2>
        <button type="button" class="icon-btn" data-close aria-label="${escapeAttr(t('common.close'))}">${lucide('x', 16)}</button>
      </header>
      <div class="ycy-body"></div>
    </div>`;
  panel.setAttribute('aria-label', category()?.name || t('cycle.defaultName'));
  document.body.append(panel);

  panel.addEventListener('click', (e) => { onClick(e).catch((err) => console.warn('[Cycle]', err)); });
  panel.addEventListener('change', (e) => { onChangeInput(e).catch((err) => console.warn('[Cycle]', err)); });
  panel.addEventListener('submit', (e) => { onSubmit(e).catch((err) => console.warn('[Cycle]', err)); });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('yanta-calendar-updated', onChange);
  window.addEventListener('yanta-calendar-space-applied', onChange);
  releaseOverlay = openBoundOverlay('cycle-panel', { close, isOpen: () => !!panel });

  await render();
}

function ensureCss() {
  if (document.getElementById('ycy-css')) return;
  const style = document.createElement('style');
  style.id = 'ycy-css';
  style.textContent = `
.ycy { position: fixed; inset: 0; z-index: 1300; display: grid; }
.ycy-scrim { position: absolute; inset: 0; background: rgba(0,0,0,.36); animation: ycy-fade .18s ease-out; }
.ycy-surface {
  position: relative; display: flex; flex-direction: column;
  background: var(--bg-elev); color: var(--text);
  box-shadow: 0 24px 64px -16px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.06);
}
.ycy.is-dialog { place-items: center; padding: 24px; }
.ycy.is-dialog .ycy-surface {
  width: min(440px, 100%); max-height: min(760px, calc(100vh - 48px));
  border-radius: 16px; animation: ycy-pop .2s cubic-bezier(.16,1,.3,1);
}
.ycy.is-sheet { align-items: end; }
.ycy.is-sheet .ycy-surface {
  max-height: 90vh; border-radius: 18px 18px 0 0;
  padding-bottom: env(safe-area-inset-bottom);
  animation: ycy-rise .26s cubic-bezier(.16,1,.3,1);
}
.ycy-grip { width: 36px; height: 4px; border-radius: 2px; background: var(--border-strong, var(--border)); margin: 8px auto 0; }
.ycy.is-leaving .ycy-surface, .ycy.is-leaving .ycy-scrim { opacity: 0; transition: opacity .14s ease-in; }
@keyframes ycy-pop { from { opacity: 0; transform: translateY(6px) scale(.985); } }
@keyframes ycy-rise { from { transform: translateY(28px); opacity: .5; } }
@keyframes ycy-fade { from { opacity: 0; } }

.ycy-head { display: flex; align-items: center; gap: 10px; padding: 14px 12px 2px 22px; }
.ycy-head h2 { margin: 0; flex: 1; min-width: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ycy-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.ycy-body { overflow: auto; overscroll-behavior: contain; padding: 4px 22px 20px; }

.ycy-hero { padding: 10px 0 4px; }
.ycy-big { margin: 0; font-size: 30px; line-height: 1.1; font-weight: 700; letter-spacing: -0.025em; }
.ycy-line { margin: 8px 0 0; font-size: 15px; line-height: 1.4; }
.ycy-dim { margin: 4px 0 0; font-size: 13px; line-height: 1.45; color: var(--text-dim); }
.ycy-note { margin-top: 8px; }

.ycy-strip {
  --c: var(--cyc-color, #d6336c);
  display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 2px;
  margin: 18px 0 0; height: 14px;
}
.ycy-strip span { border-radius: 3px; background: color-mix(in srgb, var(--text) 8%, transparent); position: relative; }
.ycy-strip span.is-future { background: color-mix(in srgb, var(--text) 5%, transparent); }
.ycy-strip span.is-period { background: color-mix(in srgb, var(--c) 78%, var(--bg-elev)); }
.ycy-strip span.is-fertile { background: color-mix(in srgb, #3b9b8f 34%, var(--bg-elev)); }
.ycy-strip span.is-ovulation { background: #3b9b8f; }
.ycy-strip span.is-next { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--c) 40%, var(--bg-elev)) 0 3px, transparent 3px 6px); }
.ycy-strip span.is-today { outline: 2px solid var(--text); outline-offset: 1px; z-index: 1; }
.ycy-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; font-size: 12px; color: var(--text-dim); }
.ycy-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ycy-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.ycy-legend i.is-period { background: color-mix(in srgb, var(--cyc-color, #d6336c) 78%, var(--bg-elev)); }
.ycy-legend i.is-fertile { background: color-mix(in srgb, #3b9b8f 34%, var(--bg-elev)); }
.ycy-legend i.is-ovulation { background: #3b9b8f; }
.ycy-legend i.is-next { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--cyc-color, #d6336c) 40%, var(--bg-elev)) 0 3px, transparent 3px 6px); }

.ycy-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; margin: 20px 0 0; }
.ycy-actions .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; font-size: 14px; border-radius: 10px; }
.ycy-link {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 2px; border: 0; background: none;
  color: var(--accent); font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; border-radius: 6px;
}
.ycy-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.ycy-link:focus-visible, .ycy-history button:focus-visible, .ycy-seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.ycy-pick { display: flex; flex-wrap: wrap; align-items: end; gap: 10px 12px; margin: 14px 0 0; padding: 12px 0 2px; }
.ycy-pick label { display: grid; gap: 4px; font-size: 12px; color: var(--text-dim); }
.ycy-pick input[type="date"] { font: inherit; font-size: 14px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
.ycy-pick .ycy-seg { flex-basis: 100%; }
.ycy-pick .ycy-dim { flex-basis: 100%; margin: 0; }

.ycy-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 26px 0 0; padding: 14px 0 0; border-top: 1px solid var(--border); }
.ycy-facts div { min-width: 0; }
.ycy-facts dt { font-size: 12px; color: var(--text-dim); }
.ycy-facts dd { margin: 3px 0 0; font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ycy-facts small { display: block; margin-top: 2px; font-size: 12px; font-weight: 400; color: var(--text-dim); }

.ycy-body h4 { margin: 26px 0 6px; font-size: 13px; font-weight: 650; }
.ycy-history { list-style: none; margin: 0; padding: 0; }
.ycy-history li { padding: 2px 0; }
.ycy-history li + li { border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
.ycy-history button {
  width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto 8.5em; gap: 12px; align-items: baseline;
  padding: 7px 0; border: 0; background: none; color: var(--text); font: inherit; font-size: 14px; text-align: left; cursor: pointer; border-radius: 6px;
}
.ycy-history button:hover .ycy-h-date { text-decoration: underline; text-underline-offset: 3px; }
.ycy-h-len, .ycy-h-cycle { font-size: 13px; color: var(--text-dim); font-variant-numeric: tabular-nums; text-align: right; }
.ycy-flag { display: block; margin: -2px 0 6px; font-size: 12px; color: color-mix(in srgb, var(--yellow, #b7791f) 70%, var(--text)); }
.ycy-flag .ycy-link { font-size: 12px; padding: 0 2px; }

.ycy-toggle, .ycy-setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; font-size: 14px; }
.ycy-toggle input { width: 18px; height: 18px; accent-color: var(--accent); }
.ycy-toggle.is-disabled { color: var(--text-dim); }
.ycy-setting { flex-wrap: wrap; }
.ycy-seg { display: inline-flex; padding: 2px; border-radius: 9px; background: color-mix(in srgb, var(--text) 7%, transparent); }
.ycy-seg button { border: 0; background: none; color: var(--text-dim); font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
.ycy-seg button[aria-checked="true"] { background: var(--bg-elev); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.ycy-num { width: 5em; font: inherit; font-size: 14px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; text-align: right; }
.ycy-more-actions { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 8px; }

.ycy-disclaimer { margin: 26px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-dim); }
@media (prefers-reduced-motion: reduce) { .ycy * { animation: none !important; } }
`;
  document.head.append(style);
}
