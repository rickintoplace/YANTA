// ============================================================
// YANTA Calendar — dashboard widget
//
// Compact calendar on the dashboard root, togglable between
// Month / Week / Day / List. Rendering is custom-built (no
// FullCalendar instance) so the widget stays light; clicking
// anything opens the real calendar.
// ============================================================

import {
  el,
  lucide,
  store,
  state,
  escapeHtml,
} from './core.js';

import { registerDashboardWidget } from './dashboard-widgets.js';
import { categoryIsShared } from './spaces/calendar-registry.js';

import {
  dateLikeToDate,
  hasRecurrence,
} from './calendar-recurrence.js';

const WIDGET_SETTING = 'calendar.dashboardWidget.v1';
const VIEWS = ['month', 'week', 'day', 'list'];

// Views the user can page through (List is always "now forward").
const PAGED_VIEWS = new Set(['month', 'week', 'day']);

// Anchor date the paged views render around. Lives in module scope so it
// survives widget re-renders within a session; resets to today on reload.
let navRef = null;

function navAnchor() {
  if (!navRef) navRef = startOfDay(new Date());
  return navRef;
}

async function getWidgetConfig() {
  const raw = await store.settings.get(WIDGET_SETTING, {});

  return {
    view: VIEWS.includes(raw?.view) ? raw.view : 'list',
  };
}

async function saveWidgetConfig(patch = {}) {
  const current = await getWidgetConfig();

  await store.settings.set(WIDGET_SETTING, {
    ...current,
    ...patch,
  });
}

// ---------------- date helpers -----------------------------------

function startOfDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Month arithmetic that clamps overflow (Jan 31 → Feb 28), like calendars do. */
function addMonths(d, months) {
  const out = new Date(d);
  const targetMonth = out.getMonth() + months;
  out.setDate(1);
  out.setMonth(targetMonth);
  out.setDate(Math.min(d.getDate(), daysInMonth(out)));
  return out;
}

function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Monday-based week start (matches the app's FullCalendar config). */
function startOfWeek(d) {
  const out = startOfDay(d);
  const day = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - day);
  return out;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function eventStartDate(ev) {
  return dateLikeToDate(ev.start, { allDay: !!ev.allDay });
}

function timeLabel(ev) {
  if (ev.allDay) return 'All day';

  const d = eventStartDate(ev);
  if (!d) return '';

  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function eventColor(ev) {
  if (ev.color) return ev.color;

  const cat = ev.categoryId
    ? state.calendarCategories?.get?.(ev.categoryId)
    : null;

  return cat?.color || 'var(--accent)';
}

// ---------------- data -------------------------------------------

async function eventsForRange(rangeStart, rangeEnd) {
  const { expandedCalendarRawEventsForRange } = await import('./calendar.js');

  const events = expandedCalendarRawEventsForRange(rangeStart, rangeEnd)
    .map((ev) => ({
      ...ev,
      _start: eventStartDate(ev),
    }))
    .filter((ev) =>
      ev._start &&
      ev._start >= rangeStart &&
      ev._start < rangeEnd &&
      // Unexpanded recurring masters outside the range would duplicate
      // their own occurrences.
      !hasRecurrence(ev)
    );

  return events.sort((a, b) => {
    // Chronological first — the nearest event must lead, whether it is
    // all-day or timed. All-day only wins as a same-day tiebreak so it
    // sits atop that day's timed events.
    const diff = a._start - b._start;
    if (diff) return diff;
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
    return 0;
  });
}

async function openCalendarApp() {
  const { openCalendar } = await import('./calendar.js');
  openCalendar({ push: true });
}

// ---------------- period navigation ------------------------------

/** Move the anchor one unit forward/back for the active view. */
function stepNav(view, dir) {
  const ref = navAnchor();

  if (view === 'month') navRef = addMonths(ref, dir);
  else if (view === 'week') navRef = addDays(ref, dir * 7);
  else if (view === 'day') navRef = addDays(ref, dir);
}

/** Whether the currently shown period contains today (hides "Today"). */
function viewingToday(view) {
  const ref = navAnchor();
  const today = new Date();

  if (view === 'month') {
    return ref.getFullYear() === today.getFullYear() &&
      ref.getMonth() === today.getMonth();
  }

  if (view === 'week') {
    return sameDay(startOfWeek(ref), startOfWeek(today));
  }

  return sameDay(ref, today);
}

/** Human label for the shown period, e.g. "July 2026" / "14–20 Jul". */
function periodLabel(view) {
  const ref = navAnchor();

  if (view === 'month') {
    return ref.toLocaleDateString([], { month: 'long', year: 'numeric' });
  }

  if (view === 'day') {
    return ref.toLocaleDateString([], {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  // Week: a locale-aware range that collapses shared parts on its own,
  // e.g. "Jul 14 – 20, 2026" (en) or "14.–20. Juli 2026" (de).
  const start = startOfWeek(ref);
  const end = addDays(start, 6);

  const fmt = new Intl.DateTimeFormat([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  try {
    return fmt.formatRange(start, end);
  } catch {
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  }
}

// ---------------- css --------------------------------------------

function injectCss() {
  if (document.getElementById('yanta-cal-dash-widget-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-cal-dash-widget-css';
  style.textContent = `
.yanta-cal-dash-views {
  display: inline-flex;
  gap: 2px;

  padding: 2px;

  border: 1px solid var(--border);
  border-radius: 8px;

  background: var(--bg);
}

.yanta-cal-dash-views button {
  min-height: 22px;
  padding: 1px 8px;

  border: 0;
  border-radius: 6px;

  background: transparent;
  color: var(--text-dim);

  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.yanta-cal-dash-views button.active {
  color: var(--text);
  background: var(--bg-elev-2, var(--bg-elev));
}

.yanta-cal-dash-body {
  padding: 10px 12px 12px;
}

/* Period navigation (Month / Week / Day) */

.yanta-cal-dash-nav {
  display: flex;
  align-items: center;
  gap: 4px;

  padding: 8px 10px 0;
}

.yanta-cal-dash-nav .icon-btn {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  color: var(--text-dim);
}

.yanta-cal-dash-period {
  flex: 1;
  min-width: 0;

  color: var(--text);
  font-size: 12.5px;
  font-weight: 700;
  text-align: center;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-cal-dash-today {
  flex: 0 0 auto;

  margin-left: 2px;
  padding: 3px 10px;

  border: 1px solid var(--border);
  border-radius: 999px;

  background: transparent;
  color: var(--accent, #6ea8fe);

  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.yanta-cal-dash-today:hover {
  background: var(--bg-elev-2, var(--bg-elev));
}

@keyframes yanta-cal-dash-slide-next {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes yanta-cal-dash-slide-prev {
  from { opacity: 0; transform: translateX(-16px); }
  to   { opacity: 1; transform: translateX(0); }
}

.yanta-cal-dash-body.slide-next { animation: yanta-cal-dash-slide-next 0.18s ease; }
.yanta-cal-dash-body.slide-prev { animation: yanta-cal-dash-slide-prev 0.18s ease; }

@media (prefers-reduced-motion: reduce) {
  .yanta-cal-dash-body.slide-next,
  .yanta-cal-dash-body.slide-prev { animation: none; }
}

.yanta-cal-dash-empty {
  padding: 14px 4px;

  color: var(--text-faint);
  font-size: 12.5px;
  text-align: center;
}

/* List / Day rows */

.yanta-cal-dash-rows {
  display: flex;
  flex-direction: column;

  max-height: 264px;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: thin;
}

.yanta-cal-dash-row {
  display: grid;
  grid-template-columns: minmax(64px, max-content) minmax(0, 1fr);
  align-items: center;
  gap: 10px;

  padding: 6px 8px;
  border-radius: 9px;

  cursor: pointer;
}

.yanta-cal-dash-row:hover {
  background: var(--bg-elev-2, var(--bg-elev));
}

.yanta-cal-dash-when {
  display: flex;
  flex-direction: column;

  color: var(--text-dim);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.35;
  white-space: nowrap;
}

.yanta-cal-dash-when strong {
  color: var(--text);
  font-size: 12px;
}

.yanta-cal-dash-what {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.yanta-cal-dash-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 999px;
}

.yanta-cal-dash-title {
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-cal-dash-shared {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  color: var(--accent, #6ea8fe);
  opacity: 0.9;
}

/* Week strip */

.yanta-cal-dash-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.yanta-cal-dash-weekday {
  display: flex;
  flex-direction: column;
  gap: 4px;

  min-height: 86px;
  padding: 6px;

  border: 1px solid var(--border);
  border-radius: 9px;

  cursor: pointer;
}

.yanta-cal-dash-weekday:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

.yanta-cal-dash-weekday.today {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.yanta-cal-dash-weekday-head {
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 750;
  text-transform: uppercase;
}

.yanta-cal-dash-weekday-head strong {
  display: block;
  color: var(--text);
  font-size: 13px;
}

.yanta-cal-dash-chip {
  max-width: 100%;
  padding: 1px 5px;

  border-radius: 5px;

  color: var(--text);
  background: color-mix(in srgb, var(--chip-color, var(--accent)) 16%, transparent);
  border-left: 2px solid var(--chip-color, var(--accent));

  font-size: 10px;
  line-height: 1.5;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-cal-dash-more {
  color: var(--text-faint);
  font-size: 10px;
}

/* Month mini-grid */

.yanta-cal-dash-month {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.yanta-cal-dash-month-head {
  padding: 2px 0 4px;

  color: var(--text-faint);
  font-size: 10px;
  font-weight: 750;
  text-align: center;
  text-transform: uppercase;
}

.yanta-cal-dash-month-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;

  min-height: 34px;
  padding: 3px 0;

  border-radius: 7px;

  color: var(--text);
  font-size: 11.5px;

  cursor: pointer;
}

.yanta-cal-dash-month-day:hover {
  background: var(--bg-elev-2, var(--bg-elev));
}

.yanta-cal-dash-month-day.dim {
  color: var(--text-faint);
}

.yanta-cal-dash-month-day.today {
  color: var(--accent);
  font-weight: 800;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.yanta-cal-dash-month-dots {
  display: flex;
  gap: 2px;
  min-height: 4px;
}

.yanta-cal-dash-month-dots i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--dot-color, var(--accent));
}
`;

  document.head.append(style);
}

// ---------------- view renderers ----------------------------------

function eventRow(ev, { showDate = true } = {}) {
  const row = el('div', { class: 'yanta-cal-dash-row', role: 'button', tabindex: '0' });

  const when = el('div', { class: 'yanta-cal-dash-when' });

  if (showDate) {
    // Weekday + day alone was ambiguous across month boundaries — the
    // month short-name keeps "Sat 18" from meaning two different days.
    when.append(el('strong', {},
      ev._start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
    ));
  }

  when.append(el('span', {}, timeLabel(ev)));

  const what = el('div', { class: 'yanta-cal-dash-what' });
  const dot = el('span', { class: 'yanta-cal-dash-dot' });
  dot.style.background = eventColor(ev);

  what.append(dot, el('span', { class: 'yanta-cal-dash-title' }, ev.title || 'Untitled event'));

  // Shared calendars stay recognizable in the widget too.
  const cat = ev.categoryId ? state.calendarCategories?.get?.(ev.categoryId) : null;

  if (cat?.spaceId || ev.spaceId || categoryIsShared(ev.categoryId)) {
    const shared = el('span', {
      class: 'yanta-cal-dash-shared',
      title: `Shared calendar "${cat?.name || ''}"`,
    });
    shared.innerHTML = lucide('users', 11);
    what.append(shared);
  }

  row.append(when, what);

  const open = openFromGrid;
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  return row;
}

async function renderListView(body) {
  const now = new Date();
  const events = (await eventsForRange(now, addDays(startOfDay(now), 31))).slice(0, 8);

  if (!events.length) {
    body.append(el('div', { class: 'yanta-cal-dash-empty' }, 'No upcoming events in the next 30 days.'));
    return;
  }

  const rows = el('div', { class: 'yanta-cal-dash-rows' });

  for (const ev of events) {
    rows.append(eventRow(ev, { showDate: true }));
  }

  body.append(rows);
}

async function renderDayView(body, ref = navAnchor()) {
  const day = startOfDay(ref);
  const events = await eventsForRange(day, addDays(day, 1));

  if (!events.length) {
    body.append(el('div', { class: 'yanta-cal-dash-empty' },
      sameDay(day, new Date()) ? 'Nothing scheduled today.' : 'Nothing scheduled.'));
    return;
  }

  const rows = el('div', { class: 'yanta-cal-dash-rows' });

  for (const ev of events) {
    rows.append(eventRow(ev, { showDate: false }));
  }

  body.append(rows);
}

async function renderWeekView(body, ref = navAnchor()) {
  const weekStart = startOfWeek(ref);
  const events = await eventsForRange(weekStart, addDays(weekStart, 7));
  const today = new Date();

  const grid = el('div', { class: 'yanta-cal-dash-week' });

  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const dayEvents = events.filter((ev) => sameDay(ev._start, day));

    const cell = el('div', {
      class: 'yanta-cal-dash-weekday' + (sameDay(day, today) ? ' today' : ''),
      role: 'button',
      tabindex: '0',
    });

    const head = el('div', { class: 'yanta-cal-dash-weekday-head' });
    head.innerHTML = `${escapeHtml(day.toLocaleDateString([], { weekday: 'short' }))}<strong>${day.getDate()}</strong>`;
    cell.append(head);

    for (const ev of dayEvents.slice(0, 3)) {
      const chip = el('div', {
        class: 'yanta-cal-dash-chip',
        title: `${timeLabel(ev)} ${ev.title || ''}`.trim(),
      }, ev.title || 'Untitled');

      chip.style.setProperty('--chip-color', eventColor(ev));
      cell.append(chip);
    }

    if (dayEvents.length > 3) {
      cell.append(el('span', { class: 'yanta-cal-dash-more' }, `+${dayEvents.length - 3} more`));
    }

    cell.addEventListener('click', openFromGrid);
    grid.append(cell);
  }

  body.append(grid);
}

async function renderMonthView(body, ref = navAnchor()) {
  const now = new Date();
  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(gridStart, 42);

  const events = await eventsForRange(gridStart, gridEnd);

  const byDay = new Map();

  for (const ev of events) {
    const key = ev._start.toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(ev);
  }

  const grid = el('div', { class: 'yanta-cal-dash-month' });

  const monday = startOfWeek(new Date());

  for (let i = 0; i < 7; i++) {
    grid.append(el('div', { class: 'yanta-cal-dash-month-head' },
      addDays(monday, i).toLocaleDateString([], { weekday: 'narrow' })
    ));
  }

  for (let i = 0; i < 42; i++) {
    const day = addDays(gridStart, i);
    const dayEvents = byDay.get(day.toDateString()) || [];

    const cell = el('div', {
      class: [
        'yanta-cal-dash-month-day',
        day.getMonth() !== monthStart.getMonth() ? 'dim' : '',
        sameDay(day, now) ? 'today' : '',
      ].filter(Boolean).join(' '),
      role: 'button',
      tabindex: '0',
      title: dayEvents.length
        ? `${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`
        : '',
    });

    cell.append(el('span', {}, String(day.getDate())));

    const dots = el('span', { class: 'yanta-cal-dash-month-dots' });

    for (const ev of dayEvents.slice(0, 3)) {
      const dot = document.createElement('i');
      dot.style.setProperty('--dot-color', eventColor(ev));
      dots.append(dot);
    }

    cell.append(dots);
    cell.addEventListener('click', openFromGrid);

    grid.append(cell);
  }

  body.append(grid);
}

// ---------------- widget shell ------------------------------------

const VIEW_LABELS = {
  month: 'Month',
  week: 'Week',
  day: 'Day',
  list: 'List',
};

// A grid/row tap opens the full calendar — but a horizontal swipe ends
// on the same element, so we suppress the tap that a swipe would emit.
let swipeGuardUntil = 0;

function openFromGrid() {
  if (Date.now() < swipeGuardUntil) return;
  openCalendarApp().catch(() => {});
}

async function renderBody(body, view) {
  if (view === 'month') await renderMonthView(body);
  else if (view === 'week') await renderWeekView(body);
  else if (view === 'day') await renderDayView(body);
  else await renderListView(body);
}

function navigateWidget(section, view, dir) {
  stepNav(view, dir);
  renderWidgetContent(section, { dir }).catch(() => {});
}

/** Prev · Period · Next (+ Today when off the current period). */
function buildNavRow(section, view) {
  const row = el('div', { class: 'yanta-cal-dash-nav' });

  const prev = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous' });
  prev.innerHTML = lucide('chevron-left', 16);

  const label = el('span', { class: 'yanta-cal-dash-period' }, periodLabel(view));

  const next = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next' });
  next.innerHTML = lucide('chevron-right', 16);

  prev.addEventListener('click', () => navigateWidget(section, view, -1));
  next.addEventListener('click', () => navigateWidget(section, view, 1));

  row.append(prev, label, next);

  if (!viewingToday(view)) {
    const today = el('button', { class: 'yanta-cal-dash-today', type: 'button' }, 'Today');
    today.addEventListener('click', () => {
      navRef = startOfDay(new Date());
      renderWidgetContent(section).catch(() => {});
    });
    row.append(today);
  }

  return row;
}

/** Touch-swipe left/right pages the period, mirroring the full calendar. */
function attachSwipe(target, section, view) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  target.addEventListener('touchstart', (e) => {
    tracking = e.touches.length === 1;
    if (!tracking) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  target.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    // Horizontal intent only — vertical scrolls (day list) stay untouched.
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    swipeGuardUntil = Date.now() + 400;
    navigateWidget(section, view, dx < 0 ? 1 : -1);
  }, { passive: true });
}

async function renderWidgetContent(section, { dir = 0 } = {}) {
  const config = await getWidgetConfig();
  const view = config.view;

  const head = el('div', { class: 'yanta-dash-widget-head' });

  head.innerHTML = `
    ${lucide('calendar-days', 15)}
    <span class="yanta-dash-widget-title">Calendar</span>
    <span class="yanta-dash-widget-spacer"></span>
    <span class="yanta-cal-dash-views" role="tablist" aria-label="Calendar widget view"></span>
    <button class="icon-btn" data-widget-open title="Open Calendar">${lucide('arrow-right', 15)}</button>
  `;

  const viewsHost = head.querySelector('.yanta-cal-dash-views');

  for (const v of VIEWS) {
    const btn = el('button', {
      type: 'button',
      class: v === view ? 'active' : '',
      role: 'tab',
    }, VIEW_LABELS[v]);

    btn.addEventListener('click', async () => {
      if (v === view) return;

      await saveWidgetConfig({ view: v });
      await renderWidgetContent(section);
    });

    viewsHost.append(btn);
  }

  head.querySelector('[data-widget-open]')?.addEventListener('click', () => {
    openCalendarApp().catch(() => {});
  });

  const paged = PAGED_VIEWS.has(view);

  const body = el('div', { class: 'yanta-cal-dash-body' });
  await renderBody(body, view);

  if (paged) {
    attachSwipe(body, section, view);
    if (dir) body.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
  }

  const parts = paged
    ? [head, buildNavRow(section, view), body]
    : [head, body];

  section.replaceChildren(...parts);
}

async function renderCalendarWidget() {
  injectCss();

  const section = el('section', {
    class: 'yanta-dash-widget yanta-dash-widget-calendar',
  });

  const onCalendarUpdated = () => {
    if (!section.isConnected) {
      window.removeEventListener('yanta-calendar-updated', onCalendarUpdated);
      return;
    }

    renderWidgetContent(section).catch(() => {});
  };

  window.addEventListener('yanta-calendar-updated', onCalendarUpdated);

  await renderWidgetContent(section);

  return section;
}

registerDashboardWidget({
  id: 'calendar',
  title: 'Calendar',
  icon: 'calendar-days',
  order: 10,
  render: renderCalendarWidget,
});
