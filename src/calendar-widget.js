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
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
    return a._start - b._start;
  });
}

async function openCalendarApp() {
  const { openCalendar } = await import('./calendar.js');
  openCalendar({ push: true });
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
  grid-template-columns: 72px minmax(0, 1fr);
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
    when.append(el('strong', {},
      ev._start.toLocaleDateString([], { weekday: 'short', day: 'numeric' })
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

  const open = () => openCalendarApp().catch(() => {});
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

async function renderDayView(body) {
  const today = startOfDay(new Date());
  const events = await eventsForRange(today, addDays(today, 1));

  if (!events.length) {
    body.append(el('div', { class: 'yanta-cal-dash-empty' }, 'Nothing scheduled today.'));
    return;
  }

  const rows = el('div', { class: 'yanta-cal-dash-rows' });

  for (const ev of events) {
    rows.append(eventRow(ev, { showDate: false }));
  }

  body.append(rows);
}

async function renderWeekView(body) {
  const weekStart = startOfWeek(new Date());
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

    cell.addEventListener('click', () => openCalendarApp().catch(() => {}));
    grid.append(cell);
  }

  body.append(grid);
}

async function renderMonthView(body) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
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
        day.getMonth() !== now.getMonth() ? 'dim' : '',
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
    cell.addEventListener('click', () => openCalendarApp().catch(() => {}));

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

async function renderWidgetContent(section) {
  const config = await getWidgetConfig();

  const head = el('div', { class: 'yanta-dash-widget-head' });

  head.innerHTML = `
    ${lucide('calendar-days', 15)}
    <span class="yanta-dash-widget-title">Calendar</span>
    <span class="yanta-dash-widget-spacer"></span>
    <span class="yanta-cal-dash-views" role="tablist" aria-label="Calendar widget view"></span>
    <button class="icon-btn" data-widget-open title="Open Calendar">${lucide('arrow-right', 15)}</button>
  `;

  const viewsHost = head.querySelector('.yanta-cal-dash-views');

  for (const view of VIEWS) {
    const btn = el('button', {
      type: 'button',
      class: view === config.view ? 'active' : '',
      role: 'tab',
    }, VIEW_LABELS[view]);

    btn.addEventListener('click', async () => {
      if (view === config.view) return;

      await saveWidgetConfig({ view });
      await renderWidgetContent(section);
    });

    viewsHost.append(btn);
  }

  head.querySelector('[data-widget-open]')?.addEventListener('click', () => {
    openCalendarApp().catch(() => {});
  });

  const body = el('div', { class: 'yanta-cal-dash-body' });

  if (config.view === 'month') await renderMonthView(body);
  else if (config.view === 'week') await renderWeekView(body);
  else if (config.view === 'day') await renderDayView(body);
  else await renderListView(body);

  section.replaceChildren(head, body);
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
