// ============================================================
// YANTA — FullCalendar integration
//
// Storage:
// - Calendar events live in Sync2 VaultDoc map: events
// - Categories live in Sync2 VaultDoc map: calendarCategories
//
// FullCalendar is UI only. VaultDoc is source of truth.
// ============================================================

import { Calendar } from '@fullcalendar/core';
import allLocales from '@fullcalendar/core/locales-all';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';

import {
  $,
  uid,
  state,
  store,
  toast,
  escapeHtml,
  escapeAttr,
  safeFilename,
  lucide,
  cssColorToHex,
} from './core.js';

import {
  getNoteDoc,
  getMarkdownText,
  noteMarkdown,
  destroyNoteDoc,
} from './yjs.js';

import {
  openNote,
  clearEditor,
  rebuildWikilinkIndex,
} from './notes.js';

import {
  renderTree,
  showMenu,
} from './tree.js';

import {
  calendarState,
  calendarUrl,
} from './navigation.js';

import {
  parseMarkdownCalendarRefs,
  serializeMarkdownCalendarRef,
  markdownLineForCalendarEvent,
  updateMarkdownCalendarRef,
} from './calendar-markdown.js';

import {
  getVaultDoc,
  vaultEventsMap,
  vaultCalendarCategoriesMap,
  vaultTombstonesMap,
  safeJsonClone,
} from './sync2/vault-doc.js';

import {
  parseIcsEvents,
  exportEventsAsIcs,
  eventsToIcs,
} from './calendar-ics.js';

import {
  DE_HOLIDAY_SOURCES,
  makeHolidayCategoryPatch,
  sanitizeCalendarCategorySource,
  calendarCategorySourceDescription,
  sourceEventsForRange,
  parseCustomDatesJson,
  exampleCustomDatesJson,
} from './calendar-sources.js';

import {
  getCalendarPreferences,
  fullCalendarLocale,
  fullCalendarWeekText,
  fullCalendarTimeFormat,
  fullCalendarSlotLabelFormat,
  formatCalendarDateTime,
  formatCalendarTime,
} from './calendar-preferences.js';

import {
  openSidePane,
  closeSidePane,
  isSidePaneOpen,
} from './side-pane.js';

import {
  yantaConfirm,
  yantaPrompt,
  yantaChoice,
} from './dialogs.js';

import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
} from './overlay-history.js';

import {
  moveNoteToTrash,
} from './trash.js';

const ORIGIN = 'calendar';
const DEFAULT_CATEGORY_ID = 'cal_default';

const CALENDAR_SWIPE_EDGE_GUARD_PX = 24;

/*
  Muss kleiner sein als selectLongPressDelay.
  Bis dahin entscheidet YANTA:
  - horizontal => Galerie-Swipe
  - vertikal => manueller Scroll
  - keine Bewegung => FullCalendar darf Long-Press machen

  Mobile UX:
  niedriger als vorher, damit der Kalender früher "am Finger klebt".
*/
const CALENDAR_SWIPE_DECISION_TIMEOUT_MS = 420;

const CALENDAR_SWIPE_CLAIM_PX = 2;
const CALENDAR_SWIPE_CLAIM_RATIO = 0.95;

/*
  Mobile Event-DnD:
  Events sollen nicht versehentlich beim Wischen verschoben werden.
  Drag&Drop wird erst nach kurzem Halten + Mindestbewegung aktiv.
*/
const CALENDAR_MOBILE_EVENT_LONG_PRESS_MS = 420;
const CALENDAR_MOBILE_EVENT_DRAG_MIN_DISTANCE_PX = 14;

/*
  Long-Press auf leere Zellen:
  Danach darf FullCalendar die Range-Selection übernehmen
  (Tag halten und über weitere Tage ziehen).
*/
const CALENDAR_CELL_SELECT_LONG_PRESS_MS = 600;

let calendarSuppressSelectUntil = 0;
let calendarSwipeSelectionSuppressed = false;

let fc = null;
let initialized = false;

let eventModal = null;
let calendarEventOverlayRegistered = false;
let categoriesModal = null;
let calendarSourcesModal = null;
let calendarImportModal = null;
let calendarCategoryDeleteModal = null;
let calendarDateTimePickerModal = null;
let calendarNotePickerModal = null;

function calendarEventEditorIsOpen() {
  return !!eventModal && eventModal.hidden === false;
}

function registerCalendarEventOverlayRoute() {
  if (calendarEventOverlayRegistered) return;

  calendarEventOverlayRegistered = true;

  registerOverlayRoute('calendar-event-editor', {
    open: ({ data, state } = {}) => {
      const eventId =
        data?.eventId ||
        state?.eventId ||
        '';

      const input =
        data?.input ||
        state?.input ||
        null;

      if (eventId) {
        openEventEditor({
          id: eventId,
          _fromHistory: true,
        });

        return;
      }

      if (input && typeof input === 'object') {
        openEventEditor({
          ...input,
          _fromHistory: true,
        });
      }
    },

    close: () => {
      closeEventModal({
        fromHistory: true,
      });
    },

    isOpen: calendarEventEditorIsOpen,
  });
}

let calendarMode = 'surface'; // 'surface' | 'pane'
let calendarOriginalParent = null;

let calendarHydrated = false;
let renderScheduled = false;
let batchDepth = 0;

let calendarResizeObserver = null;
let calendarResizeScheduled = false;
let lastCalendarHeight = 0;

let calendarThemePaintScheduled = false;
let lastThemeSignature = '';

const CALENDAR_MOBILE_MQ = window.matchMedia('(max-width: 880px)');

let lastCalendarMobileMode = null;

let smoothCalendarNavInstalled = false;
let calendarSwipeInstalled = false;
let calendarNavAnimating = false;

let calendarExternalEventDragInstalled = false;
let calendarExternalEventDrag = null;
let calendarExternalEventSuppressClickUntil = 0;

let calendarSwipeCache = null;
let calendarSwipeCacheBuilding = null;
let calendarSwipePrewarmScheduled = false;
let calendarSwipeDataVersion = 0;

let calendarSwipePointer = null;
let calendarSwipeToken = 0;
let calendarInteractiveSwipeState = null;

let calendarReturnSurface = 'note';

function calendarMobile() {
  return CALENDAR_MOBILE_MQ.matches;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

// ============================================================
// Native YANTA calendar chrome / routing / pane mode
// ============================================================

function calendarToolbarEl() {
  if (calendarMode === 'pane') {
    return document.querySelector('.yanta-calendar-side-pane .yanta-calendar-topbar') || null;
  }

  return $('calendarSurface')?.querySelector('.yanta-calendar-topbar') || null;
}

function setCalendarToolbarTitle(title = '') {
  const el = calendarToolbarEl()?.querySelector('[data-cal-title]');
  if (el) el.textContent = title || fc?.view?.title || 'Calendar';
}

function setCalendarToolbarView(viewType = '') {
  const sel = calendarToolbarEl()?.querySelector('[data-cal-view]');
  if (sel && viewType) sel.value = viewType;
}

function openCalendarMenu(anchor) {
  if (!anchor) return;

  const r = anchor.getBoundingClientRect();

  showMenu(r.left, r.bottom + 6, [
    {
      label: 'Categories',
      icon: 'calendar-fold',
      action: renderCategoriesModal,
    },
    {
      label: 'Import .ics / JSON',
      icon: 'calendar-arrow-up',
      action: openCalendarImportPicker,
    },
    'hr',
    {
      label: 'Export all .ics',
      icon: 'calendar-arrow-down',
      action: () => {
        exportEventsAsIcs(currentEventsForCategory(null), {
          filename: 'yanta-calendar.ics',
          calendarName: 'YANTA',
        });
      },
    },
    {
      label: 'Export all JSON',
      icon: 'calendar-arrow-down',
      action: () => {
        exportCalendarJson({
          filename: 'yanta-calendar.calendar.json',
        });
      },
    },
  ]);
}

function closeCalendarViaHistory() {
  if (calendarMode === 'pane') {
    closeCalendarPane();
    return;
  }

  const targetSurface = calendarReturnSurface || 'note';

  closeCalendar({
    surface: targetSurface,
  });

  if (history.state?.surface === 'calendar') {
    history.back();
    return;
  }
}

function renderCalendarTopbar() {
  const bar = calendarToolbarEl();
  if (!bar) return;

  bar.innerHTML = `
    <button class="icon-btn" data-cal-nav="prev" title="Previous">
      ${lucide('chevron-left', 18)}
    </button>

    <button class="btn" data-cal-nav="today" title="Today">Today</button>

    <button class="icon-btn" data-cal-nav="next" title="Next">
      ${lucide('chevron-right', 18)}
    </button>

    <div class="yanta-calendar-title" data-cal-title>
      ${escapeHtml(fc?.view?.title || 'Calendar')}
    </div>

    <span class="grow"></span>

    <select class="text-input yanta-calendar-view-select" data-cal-view title="Calendar view">
      <option value="dayGridMonth">Month</option>
      <option value="timeGridWeek">Week</option>
      <option value="timeGridDay">Day</option>
      <option value="listWeek">List</option>
    </select>

    <button class="icon-btn" data-cal-menu title="Calendar menu">
      ${lucide('more-vertical', 18)}
    </button>

    <button class="icon-btn" data-cal-close title="${calendarMode === 'pane' ? 'Close calendar pane' : 'Close calendar'}">
      ${lucide('x', 18)}
    </button>
  `;

  const viewSelect = bar.querySelector('[data-cal-view]');
  if (viewSelect && fc?.view?.type) {
    viewSelect.value = fc.view.type;
  }

  bar.querySelector('[data-cal-nav="prev"]')?.addEventListener('click', () => {
    smoothCalendarNavigate('prev');
  });

  bar.querySelector('[data-cal-nav="next"]')?.addEventListener('click', () => {
    smoothCalendarNavigate('next');
  });

  bar.querySelector('[data-cal-nav="today"]')?.addEventListener('click', () => {
    if (!fc) return;

    fc.today();

    invalidateCalendarSwipeCache();
    scheduleCalendarResize({ render: true });
  });

  viewSelect?.addEventListener('change', (e) => {
    if (!fc) return;

    fc.changeView(e.target.value);
    state.currentCalendarView = e.target.value;

    invalidateCalendarSwipeCache();
    scheduleCalendarResize({ render: true });
  });

  bar.querySelector('[data-cal-menu]')?.addEventListener('click', (e) => {
    openCalendarMenu(e.currentTarget);
  });

  bar.querySelector('[data-cal-close]')?.addEventListener('click', closeCalendarViaHistory);
}

export function openCalendarPane() {
  const calendarEl = $('calendar');

  if (!calendarEl) return;

  if (calendarMobile()) {
    openCalendar({ push: true });
    return;
  }

  closeCalendar({ surface: 'note' });

  calendarOriginalParent ||= calendarEl.parentElement;

  const body = openSidePane({
    kind: 'calendar',
    title: 'Calendar',
    icon: 'calendar-days',
    className: 'yanta-calendar-side-pane',
    onClose: () => {
      const cal = $('calendar');

      if (calendarOriginalParent && cal && cal.parentElement !== calendarOriginalParent) {
        calendarOriginalParent.append(cal);
      }

      calendarMode = 'surface';

      requestAnimationFrame(() => {
        renderCalendarTopbar();
        fc?.updateSize?.();
      });
    },
  });

  if (!body) return;

  body.innerHTML = `
    <div class="yanta-calendar-pane-body">
      <div class="yanta-calendar-topbar"></div>
      <div class="yanta-calendar-pane-calendar-host"></div>
    </div>
  `;

  body
    .querySelector('.yanta-calendar-pane-calendar-host')
    ?.append(calendarEl);

  calendarMode = 'pane';

  if (!calendarHydrated) {
    hydrateCalendarStateFromVault();
  }

  if (!fc) {
    setupCalendar();
  }

  renderCalendarTopbar();

  applyCalendarThemeIfChanged();
  applyCalendarThemeToDom();

  resizeCalendarNow({ render: true });

  requestAnimationFrame(() => {
    resizeCalendarNow();
    fc?.updateSize?.();
    applyMountedCalendarEventsTheme();
    scheduleCalendarSwipePrewarm();
  });
}

export function closeCalendarPane({ silent = false } = {}) {
  if (!isSidePaneOpen('calendar')) return;

  closeSidePane({ silent });
}

// ============================================================
// Basic helpers
// ============================================================

function now() {
  return Date.now();
}

function cssVar(name, fallback = '') {
  try {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim() || fallback;
  } catch {
    return fallback;
  }
}

function resolveCssColor(color, fallback = '#6ea8fe') {
  const raw = String(color || '').trim();

  if (!raw) return fallback;

  if (raw.startsWith('var(')) {
    const m = raw.match(/var\((--[^,\s)]+)(?:,\s*([^)]+))?\)/);

    if (m) {
      return cssVar(m[1], m[2] || fallback);
    }
  }

  try {
    const canvas = resolveCssColor._canvas ||
      (resolveCssColor._canvas = document.createElement('canvas'));

    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillStyle = raw;

    return ctx.fillStyle || fallback;
  } catch {
    return fallback;
  }
}

function rgbFromCssColor(color) {
  const resolved = resolveCssColor(color, '#6ea8fe');

  if (/^#[0-9a-f]{6}$/i.test(resolved)) {
    return {
      r: parseInt(resolved.slice(1, 3), 16),
      g: parseInt(resolved.slice(3, 5), 16),
      b: parseInt(resolved.slice(5, 7), 16),
    };
  }

  if (/^#[0-9a-f]{3}$/i.test(resolved)) {
    return {
      r: parseInt(resolved[1] + resolved[1], 16),
      g: parseInt(resolved[2] + resolved[2], 16),
      b: parseInt(resolved[3] + resolved[3], 16),
    };
  }

  const m = resolved.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);

  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
    };
  }

  return {
    r: 110,
    g: 168,
    b: 254,
  };
}

function relativeLuminance({ r, g, b }) {
  const channel = (v) => {
    const x = v / 255;

    return x <= 0.03928
      ? x / 12.92
      : Math.pow((x + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * channel(r) +
    0.7152 * channel(g) +
    0.0722 * channel(b)
  );
}

function readableTextColor(backgroundColor) {
  const lum = relativeLuminance(rgbFromCssColor(backgroundColor));

  return lum > 0.52
    ? '#111827'
    : '#ffffff';
}

function defaultEventColorForCategory(cat) {
  const accent = cssVar('--accent', '#6ea8fe');
  const color = String(cat?.color || '').trim().toLowerCase();

  // Alle Kategorien, die noch YANTA-MVP-Blau haben, folgen dem aktuellen Accent.
  // So sehen importierte Kategorien direkt theme-nativ aus.
  if (!color || color === '#6ea8fe' || color === 'rgb(110, 168, 254)' || color === 'var(--accent)') {
    return accent;
  }

  return cat.color || accent;
}

function linkedNoteForEvent(ev) {
  return ev?.noteId ? state.notes.get(ev.noteId) : null;
}

function calendarIconForEvent(ev) {
  const note = linkedNoteForEvent(ev);

  return (
    note?.icon ||
    ev?.icon ||
    'calendar-days'
  );
}

function calendarEventColors(ev) {
  const note = linkedNoteForEvent(ev);
  const cat = categoryForEvent(ev);

  const rawColor =
    note?.color ||
    ev?.color ||
    defaultEventColorForCategory(cat);

  const background = resolveCssColor(rawColor, cssVar('--accent', '#6ea8fe'));

  return {
    background,
    border: background,
    text: readableTextColor(background),
  };
}

function calendarEventAttachmentColor(ev) {
  const note = ev?.noteId
    ? state.notes.get(ev.noteId)
    : null;

  const cat = categoryForEvent(ev);

  /*
    Virtuelle Event-Card in einer Note:
    - Wenn die Note eine eigene Farbe hat, soll die Card zur Note passen.
    - Sonst Event-Farbe.
    - Sonst Kategorie-Farbe.
    - Sonst Accent-Fallback.
  */
  const rawColor = String(
    note?.color ||
    ev?.color ||
    cat?.color ||
    ''
  ).trim();

  return resolveCssColor(
    rawColor,
    cssVar('--accent', '#6ea8fe')
  );
}

function calendarThemeVars() {
  return {
    '--fc-page-bg-color': cssVar('--bg-elev', '#1c1c1c'),
    '--fc-neutral-bg-color': cssVar('--bg-elev-2', '#242424'),
    '--fc-neutral-text-color': cssVar('--text-dim', '#9a9794'),
    '--fc-border-color': cssVar('--border', '#333333'),

    '--fc-button-text-color': cssVar('--text', '#e8e6e3'),
    '--fc-button-bg-color': cssVar('--bg-elev-2', '#242424'),
    '--fc-button-border-color': cssVar('--border', '#333333'),
    '--fc-button-hover-bg-color': cssVar('--bg-elev-3', '#2e2e2e'),
    '--fc-button-hover-border-color': cssVar('--border-strong', '#454545'),
    '--fc-button-active-bg-color': cssVar('--accent', '#6ea8fe'),
    '--fc-button-active-border-color': cssVar('--accent', '#6ea8fe'),

    '--fc-event-bg-color': cssVar('--accent', '#6ea8fe'),
    '--fc-event-border-color': cssVar('--accent', '#6ea8fe'),
    '--fc-event-text-color': readableTextColor(cssVar('--accent', '#6ea8fe')),

    '--fc-event-selected-overlay-color': 'color-mix(in srgb, var(--accent) 24%, transparent)',
    '--fc-more-link-bg-color': cssVar('--bg-elev-3', '#2e2e2e'),
    '--fc-more-link-text-color': cssVar('--accent', '#6ea8fe'),

    '--fc-non-business-color': 'color-mix(in srgb, var(--text-faint) 10%, transparent)',
    '--fc-bg-event-color': cssVar('--accent-2', '#a78bfa'),
    '--fc-bg-event-opacity': '0.22',
    '--fc-highlight-color': 'color-mix(in srgb, var(--accent) 22%, transparent)',
    '--fc-today-bg-color': 'color-mix(in srgb, var(--accent) 13%, transparent)',
    '--fc-now-indicator-color': cssVar('--red', '#f87171'),
  };
}

function applyCalendarThemeVarsTo(node) {
  if (!node) return;

  const vars = calendarThemeVars();

  for (const [key, value] of Object.entries(vars)) {
    node.style.setProperty(key, value);
  }
}

function applyCalendarThemeToDom() {
  const host = $('calendar');

  if (!host) return;

  applyCalendarThemeVarsTo(host);

  const roots = [
    fc?.el,
    host.querySelector?.('.fc'),
  ].filter(Boolean);

  for (const root of roots) {
    applyCalendarThemeVarsTo(root);
  }
}

function calendarThemeSignature() {
  return [
    cssVar('--bg', ''),
    cssVar('--bg-elev', ''),
    cssVar('--bg-elev-2', ''),
    cssVar('--bg-elev-3', ''),
    cssVar('--border', ''),
    cssVar('--border-strong', ''),
    cssVar('--text', ''),
    cssVar('--text-dim', ''),
    cssVar('--text-faint', ''),
    cssVar('--accent', ''),
    cssVar('--accent-2', ''),
    cssVar('--red', ''),
  ].join('|');
}

function applyMountedCalendarEventsTheme() {
  if (!fc) return;

  const root =
    fc.el ||
    $('calendar') ||
    null;

  if (!root) return;

  const nodes = root.querySelectorAll('.fc-event[data-yanta-event-id]');

  for (const node of nodes) {
    const id = node.dataset.yantaEventId;
    if (!id) continue;

    const event = fc.getEventById(id);
    if (!event) continue;

    applyThemeToMountedEvent({
      el: node,
      event,
    });
  }
}

function scheduleCalendarThemePaint() {
  if (!fc) return;

  if (calendarThemePaintScheduled) return;
  calendarThemePaintScheduled = true;

  requestAnimationFrame(() => {
    calendarThemePaintScheduled = false;

    applyCalendarThemeToDom();
    applyMountedCalendarEventsTheme();
  });
}

function applyCalendarThemeIfChanged() {
  const sig = calendarThemeSignature();

  if (sig === lastThemeSignature) return false;

  lastThemeSignature = sig;

  applyCalendarThemeToDom();
  applyMountedCalendarEventsTheme();

  return true;
}

function applyThemeToMountedEvent(info) {
  if (!info?.el) return;

  if (info.event?.id) {
    info.el.dataset.yantaEventId = info.event.id;
  }

  const kind = info.event.extendedProps?.yantaKind;
  const raw = info.event.extendedProps?.raw;

  let background =
    info.event.backgroundColor ||
    cssVar('--accent', '#6ea8fe');

  let border =
    info.event.borderColor ||
    background;

  let text =
    info.event.textColor ||
    readableTextColor(background);

  if (
    (kind === 'event' || kind === 'holiday' || kind === 'calendar-source') &&
    raw
  ) {
    const colors = calendarEventColors(raw);

    background = colors.background;
    border = colors.border;
    text = colors.text;
  }

  if (kind === 'task') {
    background = info.event.backgroundColor || cssVar('--accent-2', '#a78bfa');
    border = info.event.borderColor || background;
    text = readableTextColor(background);
  }

  // Block events, e.g. month all-day blocks.
  info.el.style.setProperty('border-color', border, 'important');

  if (!info.el.classList.contains('fc-daygrid-dot-event')) {
    info.el.style.setProperty('background-color', background, 'important');
  }

  // Dot events, e.g. timed events in month view.
  const dot = info.el.querySelector('.fc-daygrid-event-dot, .fc-list-event-dot');

  if (dot) {
    dot.style.setProperty('border-color', border, 'important');
  }

  // Text color for block event inner wrapper.
  const main = info.el.querySelector('.fc-event-main');

  if (main) {
    main.style.setProperty('color', text, 'important');
  }

  // Dot events should use normal text color, not white.
  if (info.el.classList.contains('fc-daygrid-dot-event')) {
    info.el.style.setProperty('color', cssVar('--text', '#e8e6e3'), 'important');
    info.el.style.setProperty('background-color', 'transparent', 'important');
  }

  // List rows.
  if (info.el.classList.contains('fc-list-event')) {
    info.el.style.setProperty('color', cssVar('--text', '#e8e6e3'), 'important');
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// ============================================================
// Smooth + interactive Apple-like calendar navigation
// ============================================================

function calendarViewSupportsHorizontalAnimation() {
  const type = fc?.view?.type;

  return [
    'dayGridMonth',
    'timeGridWeek',
    'timeGridDay',
  ].includes(type);
}

function currentCalendarHarness() {
  return fc?.el?.querySelector('.fc-view-harness-active') ||
    fc?.el?.querySelector('.fc-view-harness') ||
    null;
}

function currentCalendarViewEl(harness = currentCalendarHarness()) {
  if (!harness) return null;

  return harness.querySelector(':scope > .fc-view:not(.yanta-fc-view-clone)') ||
    harness.querySelector('.fc-view:not(.yanta-fc-view-clone)');
}

function calendarAdjacentDate(dir) {
  const type = fc?.view?.type;
  const base = new Date(fc?.view?.currentStart || fc?.getDate?.() || Date.now());

  if (type === 'dayGridMonth') {
    return new Date(
      base.getFullYear(),
      base.getMonth() + dir,
      1,
      12,
      0,
      0,
      0
    );
  }

  if (type === 'timeGridWeek') {
    const d = new Date(base);
    d.setDate(d.getDate() + dir * 7);
    return d;
  }

  if (type === 'timeGridDay') {
    const d = new Date(base);
    d.setDate(d.getDate() + dir);
    return d;
  }

  const d = new Date(base);
  d.setDate(d.getDate() + dir);
  return d;
}

function calendarSwipeCacheKey() {
  if (!fc) return '';

  const harness = currentCalendarHarness();
  const rect = harness?.getBoundingClientRect?.();

  return [
    fc.view?.type || '',
    fc.view?.currentStart?.toISOString?.() || '',
    Math.round(rect?.width || 0),
    Math.round(rect?.height || 0),
    calendarSwipeDataVersion,
    calendarMobile() ? 'm' : 'd',
  ].join('|');
}

function invalidateCalendarSwipeCache() {
  calendarSwipeDataVersion++;
  calendarSwipeCache = null;
}

function scheduleCalendarSwipePrewarm() {
  if (!fc) return;
  if (!calendarSurfaceVisible()) return;
  if (!calendarMobile()) return;
  if (!calendarViewSupportsHorizontalAnimation()) return;
  if (calendarSwipePrewarmScheduled) return;

  /*
    Wichtig:
    Kein teures Snapshot-Rendering starten, während der Finger gerade aktiv ist.
    Sonst konkurriert FullCalendar-Renderarbeit mit touchmove/pointermove.
  */
  if (calendarSwipePointer || calendarInteractiveSwipeState) return;

  calendarSwipePrewarmScheduled = true;

  const run = () => {
    calendarSwipePrewarmScheduled = false;

    if (!fc || !calendarSurfaceVisible()) return;
    if (!calendarMobile()) return;
    if (!calendarViewSupportsHorizontalAnimation()) return;
    if (calendarSwipePointer || calendarInteractiveSwipeState) return;

    buildCalendarSwipeCache().catch((err) => {
      console.warn('[YANTA Calendar] swipe prewarm failed', err);
    });
  };

  /*
    Prev/current/next Snapshot-Building ist relativ teuer.
    Deshalb im Idle ausführen, nicht direkt nach Paint oder während Input.
  */
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, {
      timeout: 900,
    });
  } else {
    window.setTimeout(run, 120);
  }
}

function cloneCalendarHarnessForSwipe(sourceHarness, {
  width = 0,
  height = 0,
} = {}) {
  if (!sourceHarness) return null;

  const clone = sourceHarness.cloneNode(true);

  clone.classList.add('yanta-fc-harness-clone');
  clone.classList.remove('yanta-cal-animating');

  /*
    Falls ein Clone von einem laufenden Swipe stammt, niemals die alte
    Swipe-Stage oder Hidden-Klassen mitkopieren.
  */
  clone
    .querySelectorAll('.yanta-cal-swipe-stage, .yanta-cal-swipe-placeholder')
    .forEach((node) => node.remove());

  clone
    .querySelectorAll('.yanta-cal-real-hidden, .yanta-cal-animating')
    .forEach((node) => {
      node.classList.remove('yanta-cal-real-hidden');
      node.classList.remove('yanta-cal-animating');
    });

  /*
    Doppelte IDs in DOM-Clones vermeiden.
    FullCalendar braucht sie für den Snapshot nicht.
  */
  clone
    .querySelectorAll('[id]')
    .forEach((node) => node.removeAttribute('id'));

  /*
    Komplett inert machen.
    Der Swipe-Snapshot ist nur Bild/DOM-Snapshot, keine echte UI.
  */
  clone.setAttribute('aria-hidden', 'true');

  clone
    .querySelectorAll('button, a, input, textarea, select, [tabindex]')
    .forEach((node) => {
      node.setAttribute('tabindex', '-1');
      node.setAttribute('aria-hidden', 'true');
    });

  applyCalendarThemeVarsTo(clone);

  const w = Math.max(1, Math.round(width || sourceHarness.getBoundingClientRect?.().width || 1));
  const h = Math.max(1, Math.round(height || sourceHarness.getBoundingClientRect?.().height || 1));

  /*
    Kritisch:
    Der Clone muss selbst wieder ein echter FullCalendar-Harness sein.
    Viele FC-Regeln erwarten:
      .fc-view-harness > .fc-view
    und nicht:
      .some-custom-panel > .fc-view
  */
  clone.style.position = 'relative';
  clone.style.inset = 'auto';
  clone.style.width = '100%';
  clone.style.height = '100%';
  clone.style.minWidth = '0';
  clone.style.minHeight = '0';
  clone.style.maxWidth = '100%';
  clone.style.overflow = 'hidden';
  clone.style.visibility = 'visible';
  clone.style.pointerEvents = 'none';
  clone.style.contain = 'layout paint';
  clone.style.transform = 'translateZ(0)';
  clone.style.backfaceVisibility = 'hidden';

  /*
    Pixelgrößen als CSS-Variablen für Debug/Overrides.
    Nicht direkt width/height in px setzen, weil der Panel-Container 100%
    kontrollieren soll.
  */
  clone.style.setProperty('--yanta-swipe-w', `${w}px`);
  clone.style.setProperty('--yanta-swipe-h', `${h}px`);

  const view =
    clone.querySelector(':scope > .fc-view') ||
    clone.querySelector('.fc-view');

  if (view) {
    view.classList.add('yanta-fc-view-clone');
    view.classList.remove('yanta-cal-real-hidden');

    view.style.position = 'absolute';
    view.style.inset = '0';
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.minWidth = '0';
    view.style.minHeight = '0';
    view.style.maxWidth = '100%';
    view.style.pointerEvents = 'none';
    view.style.visibility = 'visible';
    view.style.transform = 'translateZ(0)';
    view.style.backfaceVisibility = 'hidden';
  }

  /*
    FullCalendar Liquid-Layout explizit stabilisieren.
    Das ist der Teil, der bei dir aktuell kaputt geht, wenn nur .fc-view
    geklont wird.
  */
  clone
    .querySelectorAll('.fc-scrollgrid')
    .forEach((node) => {
      node.style.width = '100%';
      node.style.height = '100%';
      node.style.maxWidth = '100%';
    });

  clone
    .querySelectorAll('.fc-scroller-harness')
    .forEach((node) => {
      node.style.position = node.style.position || 'relative';
      node.style.minHeight = '0';
      node.style.overflow = 'hidden';
    });

  clone
    .querySelectorAll('.fc-scroller-liquid-absolute')
    .forEach((node) => {
      node.style.position = 'absolute';
      node.style.inset = '0';
      node.style.minHeight = '0';
    });

  clone
    .querySelectorAll('.fc-scroller')
    .forEach((node) => {
      node.style.minHeight = '0';
    });

  return clone;
}

async function createAdjacentCalendarViewSnapshot(dir, {
  width,
  height,
} = {}) {
  if (!fc) return null;

  const viewType = fc.view?.type;
  if (!viewType) return null;

  const w = Math.max(1, Math.round(width || 1));
  const h = Math.max(1, Math.round(height || 1));

  const host = document.createElement('div');
  host.className = 'yanta-fc-snapshot-host';

  host.style.width = `${w}px`;
  host.style.height = `${h}px`;

  document.body.append(host);

  applyCalendarThemeVarsTo(host);

  const prefs = getCalendarPreferences();

  const snapshotCalendar = new Calendar(host, {
    plugins: [
      dayGridPlugin,
      timeGridPlugin,
      listPlugin,
      interactionPlugin,
    ],

    locales: allLocales,
    locale: fullCalendarLocale(prefs),
    firstDay: Number(prefs.weekStart),
    weekNumbers: !!prefs.weekNumbers,
    weekNumberCalculation: 'ISO',
    weekText: fullCalendarWeekText(prefs),
    eventTimeFormat: fullCalendarTimeFormat(prefs),
    slotLabelFormat: fullCalendarSlotLabelFormat(prefs),

    initialView: viewType,
    initialDate: calendarAdjacentDate(dir),

    headerToolbar: false,
    footerToolbar: false,

    height: h,
    contentHeight: h,
    expandRows: true,

    stickyHeaderDates: true,
    handleWindowResize: false,

    nowIndicator: true,
    selectable: false,
    editable: false,
    dayMaxEvents: true,

    events(fetchInfo, successCallback) {
      const events = buildFullCalendarEventsForRange(
        fetchInfo.start,
        fetchInfo.end
      );

      successCallback(events);
    },

    eventContent: calendarEventContent,

    eventDidMount(info) {
      applyThemeToMountedEvent(info);
    },
  });

  try {
    snapshotCalendar.render();

    applyCalendarThemeVarsTo(snapshotCalendar.el);

    /*
      Zwei Frames warten:
      FullCalendar setzt innere absolute Scroller/Layoutgrößen teils erst
      nach dem ersten Layout-Pass vollständig.
    */
    await nextFrame();
    await nextFrame();

    const snapshotHarness =
      host.querySelector('.fc-view-harness-active') ||
      host.querySelector('.fc-view-harness');

    if (!snapshotHarness) return null;

    const clone = cloneCalendarHarnessForSwipe(snapshotHarness, {
      width: w,
      height: h,
    });

    return clone;
  } finally {
    try {
      snapshotCalendar.destroy();
    } catch {}

    host.remove();
  }
}

async function buildCalendarSwipeCache({
  force = false,
} = {}) {
  if (!fc) return null;
  if (!calendarSurfaceVisible()) return null;
  if (!calendarViewSupportsHorizontalAnimation()) return null;

  /*
    Während einer aktiven Geste niemals Cache bauen.
    Das ist einer der wichtigsten Performance-Fixes.
  */
  if (calendarSwipePointer || calendarInteractiveSwipeState) {
    return calendarSwipeCache;
  }

  const key = calendarSwipeCacheKey();

  if (!force && calendarSwipeCache?.key === key) {
    return calendarSwipeCache;
  }

  if (!force && calendarSwipeCacheBuilding?.key === key) {
    return calendarSwipeCacheBuilding.promise;
  }

  const harness = currentCalendarHarness();
  const viewEl = currentCalendarViewEl(harness);

  if (!harness || !viewEl) return null;

  const rect = harness.getBoundingClientRect();

  const width = Math.max(1, Math.round(rect.width || viewEl.scrollWidth || 1));
  const height = Math.max(1, Math.round(rect.height || viewEl.scrollHeight || 1));

  const promise = (async () => {
    /*
      Current ebenfalls vorwärmen.
      Dadurch muss beim ersten Swipe idealerweise nicht mehr der echte
      FullCalendar-Harness synchron geklont werden.
    */
    const current = cloneCalendarHarnessForSwipe(harness, {
      width,
      height,
    });

    const [prev, next] = await Promise.all([
      createAdjacentCalendarViewSnapshot(-1, { width, height }),
      createAdjacentCalendarViewSnapshot(1, { width, height }),
    ]);

    if (!current || !prev || !next) return null;

    const cache = {
      key,
      width,
      height,
      current,
      prev,
      next,
    };

    if (calendarSwipeCacheKey() === key) {
      calendarSwipeCache = cache;
    }

    return cache;
  })();

  calendarSwipeCacheBuilding = {
    key,
    promise,
  };

  try {
    return await promise;
  } finally {
    if (calendarSwipeCacheBuilding?.key === key) {
      calendarSwipeCacheBuilding = null;
    }
  }
}

async function smoothCalendarNavigate(action) {
  if (!fc) return;

  const fn = fc[action];

  if (typeof fn !== 'function') return;

  if (
    calendarNavAnimating ||
    prefersReducedMotion() ||
    !calendarViewSupportsHorizontalAnimation()
  ) {
    try {
      fn.call(fc);
    } catch {}

    scheduleCalendarResize();
    return;
  }

  const oldHarness = currentCalendarHarness();
  const oldView = currentCalendarViewEl(oldHarness);

  if (!oldHarness || !oldView) {
    try {
      fn.call(fc);
    } catch {}

    scheduleCalendarResize();
    return;
  }

  const dir = action === 'next' ? 1 : -1;
  const oldRect = oldView.getBoundingClientRect();

  const oldClone = oldView.cloneNode(true);
  oldClone.classList.add('yanta-fc-view-clone');

  oldClone.style.height = `${Math.max(1, oldRect.height || oldView.scrollHeight || 1)}px`;
  oldClone.style.transform = 'translate3d(0,0,0)';
  oldClone.style.opacity = '1';

  calendarNavAnimating = true;

  try {
    fn.call(fc);

    invalidateCalendarSwipeCache();

    const harness = currentCalendarHarness() || oldHarness;
    const newView = currentCalendarViewEl(harness);

    if (!harness || !newView) {
      oldClone.remove();
      calendarNavAnimating = false;
      scheduleCalendarResize();
      scheduleCalendarSwipePrewarm();
      return;
    }

    const previousMinHeight = harness.style.minHeight;
    const previousOverflow = harness.style.overflow;

    const stableHeight = Math.max(
      1,
      oldRect.height || oldView.scrollHeight || newView.scrollHeight || 1
    );

    harness.classList.add('yanta-cal-animating');
    harness.style.minHeight = `${stableHeight}px`;
    harness.style.overflow = 'hidden';

    harness.append(oldClone);

    newView.style.willChange = 'transform, opacity';
    newView.style.transform = `translate3d(${dir * 100}%,0,0)`;
    newView.style.opacity = '0.98';

    newView.getBoundingClientRect();

    const duration = calendarMobile() ? 280 : 230;
    const easing = 'cubic-bezier(.2,.8,.2,1)';

    const oldAnim = oldClone.animate(
      [
        {
          transform: 'translate3d(0,0,0)',
          opacity: 1,
        },
        {
          transform: `translate3d(${-dir * 100}%,0,0)`,
          opacity: 0.55,
        },
      ],
      {
        duration,
        easing,
        fill: 'forwards',
      }
    );

    const newAnim = newView.animate(
      [
        {
          transform: `translate3d(${dir * 100}%,0,0)`,
          opacity: 0.98,
        },
        {
          transform: 'translate3d(0,0,0)',
          opacity: 1,
        },
      ],
      {
        duration,
        easing,
        fill: 'forwards',
      }
    );

    await Promise.allSettled([
      oldAnim.finished,
      newAnim.finished,
    ]);

    oldClone.remove();

    newView.style.willChange = '';
    newView.style.transform = '';
    newView.style.opacity = '';

    harness.classList.remove('yanta-cal-animating');
    harness.style.minHeight = previousMinHeight;
    harness.style.overflow = previousOverflow;

    calendarNavAnimating = false;

    resizeCalendarNow();
    applyMountedCalendarEventsTheme();
    scheduleCalendarSwipePrewarm();
  } catch (err) {
    console.warn('[YANTA Calendar] smooth navigation failed', err);

    try {
      oldClone.remove();
    } catch {}

    try {
      currentCalendarHarness()?.classList.remove('yanta-cal-animating');
    } catch {}

    calendarNavAnimating = false;
    scheduleCalendarResize();
    scheduleCalendarSwipePrewarm();
  }
}

function setupSmoothCalendarNavigation() {
  if (!fc || smoothCalendarNavInstalled) return;

  smoothCalendarNavInstalled = true;

  const root = fc.el || $('calendar');
  if (!root) return;

  root.addEventListener('click', (e) => {
    const nextBtn = e.target.closest?.('.fc-next-button');
    const prevBtn = e.target.closest?.('.fc-prev-button');

    if (!nextBtn && !prevBtn) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    smoothCalendarNavigate(nextBtn ? 'next' : 'prev');
  }, true);
}

function suppressCalendarSelectionFor(ms = 900) {
  calendarSuppressSelectUntil = Math.max(
    calendarSuppressSelectUntil,
    performance.now() + ms
  );

  try {
    fc?.unselect?.();
  } catch {}

  try {
    const root = $('calendar');
    root
      ?.querySelectorAll('.fc-highlight')
      ?.forEach((node) => node.remove());
  } catch {}
}

function beginSwipeSelectionSuppression() {
  if (calendarSwipeSelectionSuppressed) {
    suppressCalendarSelectionFor(900);
    return;
  }

  calendarSwipeSelectionSuppressed = true;
  suppressCalendarSelectionFor(1400);
}

function endSwipeSelectionSuppression() {
  calendarSwipeSelectionSuppressed = false;
  suppressCalendarSelectionFor(250);
}

function cleanupFullCalendarDragArtifacts() {
  const root = $('calendar');

  try {
    /*
      FullCalendar erzeugt bei Event-Drag Mirror/Helper-Elemente.
      Wenn YANTA währenddessen einen Swipe übernimmt, können diese sonst
      sichtbar im DOM hängenbleiben.
    */
    document
      .querySelectorAll(
        [
          '.fc-event-mirror',
          '.fc-event.fc-event-mirror',
          '.fc-event-dragging',
          '.fc-event-resizing',
          '.fc-dragging',
        ].join(',')
      )
      .forEach((node) => {
        /*
          Echte gemountete Events haben bei uns data-yanta-event-id.
          Mirror dürfen komplett weg; echte Events nur Klassen/Styles säubern.
        */
        if (
          node.classList.contains('fc-event-mirror') ||
          !node.dataset?.yantaEventId
        ) {
          node.remove();
          return;
        }

        node.classList.remove(
          'fc-event-dragging',
          'fc-event-resizing',
          'fc-dragging',
          'fc-event-selected'
        );

        node.style.transform = '';
        node.style.inset = '';
        node.style.left = '';
        node.style.top = '';
      });

    root
      ?.querySelectorAll('.fc-highlight, .fc-select-helper')
      ?.forEach((node) => node.remove());
  } catch {}
}

function cleanupInteractiveCalendarSwipe({
  reveal = true,
} = {}) {
  const st = calendarInteractiveSwipeState;

  try {
    $('calendar')?.classList.remove('yanta-cal-swiping');
    $('calendar')?.classList.remove('yanta-cal-manual-scrolling');
    document.documentElement.classList.remove('yanta-cal-swipe-priming');
  } catch {}

  if (!st) {
    cleanupFullCalendarDragArtifacts();
    return;
  }

  cleanupFullCalendarDragArtifacts();

  try {
    if (st.raf) {
      cancelAnimationFrame(st.raf);
    }
  } catch {}

  try {
    st.stage?.remove();
  } catch {}

  try {
    st.harness?.classList.remove('yanta-cal-animating');
  } catch {}

  if (reveal) {
    try {
      st.realView?.classList.remove('yanta-cal-real-hidden');
    } catch {}

    try {
      currentCalendarViewEl()?.classList.remove('yanta-cal-real-hidden');
    } catch {}
  }

  cleanupFullCalendarDragArtifacts();
  
  calendarInteractiveSwipeState = null;
}

function createCalendarSwipePlaceholder() {
  const node = document.createElement('div');
  node.className = 'yanta-cal-swipe-placeholder';
  return node;
}

function currentSwipeGeometry() {
  const harness = currentCalendarHarness();
  const viewEl = currentCalendarViewEl(harness);

  if (!harness || !viewEl) return null;

  const rect = harness.getBoundingClientRect();

  return {
    harness,
    viewEl,
    width: Math.max(1, Math.round(rect.width || viewEl.scrollWidth || 1)),
    height: Math.max(1, Math.round(rect.height || viewEl.scrollHeight || 1)),
  };
}

function fillInteractiveCalendarSwipeStageFromCache(cache, token) {
  const st = calendarInteractiveSwipeState;

  if (!st) return false;
  if (st.token !== token) return false;
  if (!cache) return false;

  try {
    const prev = cache.prev?.cloneNode(true);
    const next = cache.next?.cloneNode(true);

    if (!prev || !next) return false;

    st.prevPanel.replaceChildren(prev);
    st.nextPanel.replaceChildren(next);

    st.width = cache.width || st.width;
    st.height = cache.height || st.height;
    st.hasAdjacent = true;

    st.stage.style.height = `${st.height}px`;

    return true;
  } catch {
    return false;
  }
}

function createInteractiveCalendarSwipeStageImmediate(token) {
  if (!fc) return null;
  if (calendarInteractiveSwipeState) return calendarInteractiveSwipeState;
  if (!calendarSwipePointer || calendarSwipePointer.token !== token) return null;

  const geom = currentSwipeGeometry();

  if (!geom) return null;

  const {
    harness,
    viewEl: realView,
    width,
    height,
  } = geom;

  const key = calendarSwipeCacheKey();
  const warmCache = calendarSwipeCache?.key === key
    ? calendarSwipeCache
    : null;

  /*
    Best case:
    current ist bereits vorgewärmt und wird nur noch geklont.

    Cold cache:
    current muss einmal synchron aus dem echten Harness geklont werden.
    Prev/next werden aber NICHT während der Geste gebaut.
  */
  const currentClone = warmCache?.current
    ? warmCache.current.cloneNode(true)
    : cloneCalendarHarnessForSwipe(harness, {
        width,
        height,
      });

  if (!currentClone) return null;

  const stage = document.createElement('div');
  stage.className = 'yanta-cal-swipe-stage';
  stage.style.height = `${warmCache?.height || height}px`;
  stage.style.transform = 'translate3d(0,0,0)';

  const prevPanel = document.createElement('div');
  prevPanel.className = 'yanta-cal-swipe-panel yanta-cal-swipe-panel-prev';

  const currentPanel = document.createElement('div');
  currentPanel.className = 'yanta-cal-swipe-panel yanta-cal-swipe-panel-current';

  const nextPanel = document.createElement('div');
  nextPanel.className = 'yanta-cal-swipe-panel yanta-cal-swipe-panel-next';

  if (warmCache?.prev) {
    prevPanel.append(warmCache.prev.cloneNode(true));
  } else {
    prevPanel.append(createCalendarSwipePlaceholder());
  }

  currentPanel.append(currentClone);

  if (warmCache?.next) {
    nextPanel.append(warmCache.next.cloneNode(true));
  } else {
    nextPanel.append(createCalendarSwipePlaceholder());
  }

  stage.append(prevPanel, currentPanel, nextPanel);

  harness.classList.add('yanta-cal-animating');
  realView.classList.add('yanta-cal-real-hidden');

  harness.append(stage);

  calendarInteractiveSwipeState = {
    token,
    harness,
    realView,
    stage,

    prevPanel,
    currentPanel,
    nextPanel,

    width: warmCache?.width || width,
    height: warmCache?.height || height,
    hasAdjacent: !!warmCache,

    dx: 0,
    pendingDx: 0,
    raf: 0,

    lastDx: 0,
    lastT: performance.now(),
    velocity: 0,
  };

  return calendarInteractiveSwipeState;
}

async function ensureInteractiveCalendarSwipeStage(token) {
  if (!fc) return null;

  if (calendarInteractiveSwipeState) {
    return calendarInteractiveSwipeState;
  }

  if (!calendarSwipePointer || calendarSwipePointer.token !== token) {
    return null;
  }

  /*
    Wichtig:
    Stage wird synchron erzeugt.
    Es wird hier bewusst KEIN prev/next Snapshot gebaut.
    Der aktuelle Monat muss sofort unter dem Finger kleben.
  */
  const st = createInteractiveCalendarSwipeStageImmediate(token);

  if (!st) return null;

  const key = calendarSwipeCacheKey();

  if (calendarSwipeCache?.key === key) {
    fillInteractiveCalendarSwipeStageFromCache(calendarSwipeCache, token);
  }

  /*
    Kein buildCalendarSwipeCache() während aktiver Geste.
    Cold-cache prev/next bleiben Placeholder.
    Nach Ende des Swipes wird wieder pregewärmt.
  */
  return st;
}

function commitInteractiveCalendarSwipeDelta(dx) {
  const st = calendarInteractiveSwipeState;
  if (!st?.stage) return;

  const width = Math.max(1, st.width);

  const hardLimit = width;
  const softLimit = width * 0.92;

  let x = dx;

  if (Math.abs(x) > softLimit) {
    const sign = Math.sign(x);
    const extra = Math.abs(x) - softLimit;

    x = sign * Math.min(
      hardLimit,
      softLimit + extra * 0.22
    );
  }

  const t = performance.now();
  const dt = Math.max(1, t - st.lastT);

  st.velocity = (x - st.lastDx) / dt;
  st.lastDx = x;
  st.lastT = t;
  st.dx = x;

  st.stage.style.transition = 'none';
  st.stage.style.transform = `translate3d(${x}px,0,0)`;
}

function applyInteractiveCalendarSwipeDelta(dx) {
  const st = calendarInteractiveSwipeState;
  if (!st?.stage) return;

  /*
    PointerEvents können schneller feuern als Frames gerendert werden.
    Deshalb nur den letzten Wert merken und pro Frame genau einmal transformen.
  */
  st.pendingDx = dx;

  if (st.raf) return;

  st.raf = requestAnimationFrame(() => {
    st.raf = 0;
    commitInteractiveCalendarSwipeDelta(st.pendingDx || 0);
  });
}

async function animateInteractiveSwipeStageTo(targetX, {
  duration = 240,
} = {}) {
  const st = calendarInteractiveSwipeState;
  if (!st?.stage) return;

  const fromX = st.dx || 0;
  const easing = 'cubic-bezier(.2,.8,.2,1)';

  const anim = st.stage.animate(
    [
      {
        transform: `translate3d(${fromX}px,0,0)`,
      },
      {
        transform: `translate3d(${targetX}px,0,0)`,
      },
    ],
    {
      duration,
      easing,
      fill: 'forwards',
    }
  );

  await anim.finished.catch(() => {});

  if (st.stage) {
    st.stage.style.transform = `translate3d(${targetX}px,0,0)`;
    st.dx = targetX;
  }
}

async function finishInteractiveCalendarSwipe({
  cancelled = false,
} = {}) {
  const st = calendarInteractiveSwipeState;

  if (!st || !fc) {
    cleanupInteractiveCalendarSwipe();
    endSwipeSelectionSuppression();
    return;
  }

  /*
    Falls der letzte pointermove nur im rAF gepuffert wurde,
    vor der Commit-Entscheidung synchron flushen.
  */
  if (st.pendingDx != null) {
    commitInteractiveCalendarSwipeDelta(st.pendingDx);
  }

  const width = Math.max(1, st.width);
  const dx = st.dx || 0;
  const velocity = st.velocity || 0;

  const distanceCommit = Math.abs(dx) > Math.min(120, width * 0.24);
  const velocityCommit = Math.abs(velocity) > 0.38 && Math.abs(dx) > 28;

  const shouldCommit =
    !cancelled &&
    (distanceCommit || velocityCommit);

  if (!shouldCommit) {
    await animateInteractiveSwipeStageTo(0, {
      duration: 190,
    });

    cleanupInteractiveCalendarSwipe();
    endSwipeSelectionSuppression();
    scheduleCalendarSwipePrewarm();
    return;
  }

  const action = dx < 0 ? 'next' : 'prev';
  const targetX = dx < 0 ? -width : width;

  await animateInteractiveSwipeStageTo(targetX, {
    duration: Math.abs(dx) > width * 0.75 ? 110 : 170,
  });

  try {
    fc[action]?.();
  } catch {}

  invalidateCalendarSwipeCache();

  cleanupInteractiveCalendarSwipe();
  endSwipeSelectionSuppression();

  cleanupFullCalendarDragArtifacts();

  resizeCalendarNow();
  applyMountedCalendarEventsTheme();
  scheduleCalendarSwipePrewarm();

  /*
    Manche FC-Mirror werden erst nach pointerup/touchend async aufgeräumt
    oder bleiben hängen, weil YANTA den Swipe übernommen hat.
  */
  requestAnimationFrame(() => {
    cleanupFullCalendarDragArtifacts();
    applyMountedCalendarEventsTheme();
  });

  window.setTimeout(() => {
    cleanupFullCalendarDragArtifacts();
  }, 80);
}

function setupCalendarSwipeNavigation() {
  if (!fc || calendarSwipeInstalled) return;

  const root = $('calendar');
  if (!root) return;

  calendarSwipeInstalled = true;

  function interactiveTargetBlocked(target) {
    if (!target) return true;

    /*
      Wichtig:
      FullCalendar Events sind häufig <a class="fc-event">.
      Deshalb darf ein .fc-event NICHT durch den generischen "a"-Block
      blockiert werden. Sonst sieht YANTA Swipes, die auf Events starten,
      überhaupt nicht.
    */
    if (target.closest?.('.fc-event')) {
      return false;
    }

    /*
      Alles innerhalb des FullCalendar View-Harness ist Kalenderfläche.
      Auch day-number anchors sollen hier nicht blocken, weil Tap auf Tag
      von YANTA selbst verarbeitet wird.
    */
    const inCalendarView = !!target.closest?.(
      '.fc-view-harness, .fc-view-harness-active'
    );

    if (inCalendarView) {
      return !!target.closest?.(
        [
          'button',
          'input',
          'textarea',
          'select',
          '.fc-popover',
          '.modal',
          '.yanta-calendar-event-modal',
          '.yanta-calendar-categories-modal',
        ].join(',')
      );
    }

    return !!target.closest?.(
      [
        'button',
        'a',
        'input',
        'textarea',
        'select',
        '.fc-popover',
        '.modal',
        '.yanta-calendar-event-modal',
        '.yanta-calendar-categories-modal',
      ].join(',')
    );
  }

  function safePreventDefault(e) {
    if (!e) return;
    if (e.defaultPrevented) return;
    if (e.cancelable === true) {
      e.preventDefault();
    }
  }

  function cleanupPointerClasses() {
    root.classList.remove('yanta-cal-swiping');
    root.classList.remove('yanta-cal-manual-scrolling');
    document.documentElement.classList.remove('yanta-cal-swipe-priming');
  }

  function calendarScrollHost() {
    return root.closest?.('.yanta-calendar-host') ||
      root.parentElement ||
      null;
  }

  function clearCalendarCellLongPressTimer(p) {
    if (!p?.cellLongPressTimer) return;

    clearTimeout(p.cellLongPressTimer);
    p.cellLongPressTimer = null;
  }

  function dateFromTimeGridX(clientX) {
    if (!fc?.el) return null;

    const cols = [
      ...fc.el.querySelectorAll('.fc-timegrid-col[data-date]'),
    ];

    for (const col of cols) {
      const rect = col.getBoundingClientRect();

      if (clientX >= rect.left && clientX <= rect.right) {
        return col.dataset.date || null;
      }
    }

    return null;
  }

  function clearMobileEventDragTimer(p) {
    if (!p?.eventDragTimer) return;

    clearTimeout(p.eventDragTimer);
    p.eventDragTimer = null;
  }

  function mobileCalendarEventFromTarget(target) {
    const eventEl = target?.closest?.('.fc-event');

    if (!eventEl) return null;

    const id =
      eventEl.dataset?.yantaEventId ||
      eventEl.getAttribute?.('data-event-id') ||
      null;

    if (!id) return null;

    const fcEvent = fc?.getEventById?.(id);
    const raw = fcEvent?.extendedProps?.raw || state.calendarEvents.get(id);

    if (!fcEvent || !raw) return null;

    if (fcEvent.extendedProps?.yantaKind !== 'event') return null;

    return {
      id,
      eventEl,
      fcEvent,
      raw,
    };
  }

  function mobileEventDurationMs(raw) {
    const startMs = new Date(raw.start).getTime();

    if (!Number.isFinite(startMs)) {
      return raw.allDay ? 86400000 : 60 * 60 * 1000;
    }

    const endMs = raw.end
      ? new Date(raw.end).getTime()
      : startMs + (raw.allDay ? 86400000 : 60 * 60 * 1000);

    if (!Number.isFinite(endMs)) {
      return raw.allDay ? 86400000 : 60 * 60 * 1000;
    }

    return Math.max(
      raw.allDay ? 86400000 : 15 * 60 * 1000,
      endMs - startMs
    );
  }

  function calendarDropHitFromPoint(clientX, clientY) {
    if (!fc?.el) return null;

    const viewType = fc.view?.type || '';
    const elements = document.elementsFromPoint(clientX, clientY) || [];

    const closestFromPoint = (selector) => {
      for (const el of elements) {
        const found = el?.closest?.(selector);

        if (found && fc.el.contains(found)) {
          return found;
        }
      }

      return null;
    };

    if (viewType.startsWith('timeGrid')) {
      const timeEl = closestFromPoint('[data-time]');
      const date =
        closestFromPoint('.fc-timegrid-col[data-date], [data-date]')?.dataset?.date ||
        dateFromTimeGridX(clientX);

      if (!date) return null;

      if (timeEl?.dataset?.time) {
        const start = new Date(`${date}T${timeEl.dataset.time}`);

        if (Number.isNaN(start.getTime())) return null;

        return {
          start,
          allDay: false,
        };
      }

      /*
        All-day area in timeGrid.
      */
      const allDayDateEl = closestFromPoint('[data-date]');

      if (allDayDateEl?.dataset?.date) {
        const start = new Date(`${allDayDateEl.dataset.date}T00:00:00`);

        if (Number.isNaN(start.getTime())) return null;

        return {
          start,
          allDay: true,
        };
      }

      return null;
    }

    /*
      Month/dayGrid.
      Events live inside the day cell, so closest([data-date]) works even
      when dragging over another event.
    */
    const dateEl = closestFromPoint('.fc-daygrid-day[data-date], [data-date]');
    const date = dateEl?.dataset?.date;

    if (!date) return null;

    const start = new Date(`${date}T00:00:00`);

    if (Number.isNaN(start.getTime())) return null;

    return {
      start,
      allDay: true,
    };
  }

  function createMobileEventDragGhost(p) {
    const d = p?.eventDrag;
    if (!d?.eventEl) return null;

    const rect = d.eventEl.getBoundingClientRect();
    const ghost = d.eventEl.cloneNode(true);

    ghost.classList.add('yanta-cal-event-drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');

    ghost.style.position = 'fixed';
    ghost.style.left = '0';
    ghost.style.top = '0';
    ghost.style.width = `${Math.max(1, rect.width)}px`;
    ghost.style.height = `${Math.max(1, rect.height)}px`;
    ghost.style.zIndex = '99999';
    ghost.style.pointerEvents = 'none';
    ghost.style.margin = '0';
    ghost.style.opacity = '0.92';
    ghost.style.transform = `translate3d(${p.lastX - rect.width / 2}px, ${p.lastY - rect.height / 2}px, 0)`;
    ghost.style.willChange = 'transform';

    document.body.append(ghost);

    d.ghost = ghost;
    d.ghostWidth = Math.max(1, rect.width);
    d.ghostHeight = Math.max(1, rect.height);

    return ghost;
  }

  function updateMobileEventDragGhost(p, clientX, clientY) {
    const d = p?.eventDrag;

    if (!d?.ghost) return;

    const w = d.ghostWidth || 1;
    const h = d.ghostHeight || 1;

    d.ghost.style.transform = `translate3d(${clientX - w / 2}px, ${clientY - h / 2}px, 0)`;
  }

  function cleanupMobileEventDrag(p) {
    clearMobileEventDragTimer(p);

    try {
      p?.eventDrag?.ghost?.remove();
    } catch {}

    try {
      $('calendar')?.classList.remove('yanta-cal-event-dragging');
    } catch {}

    if (p?.eventDrag) {
      p.eventDrag.ghost = null;
      p.eventDrag.hit = null;
    }
  }

  function beginMobileEventDrag(p) {
    if (!p?.eventDrag) return false;
    if (p.mode !== 'pending') return false;

    p.mode = 'event-drag';

    root.classList.add('yanta-cal-event-dragging');

    /*
      Während custom DnD läuft, darf FC keine Selection/Click-Artefakte erzeugen.
    */
    suppressCalendarSelectionFor(1000);

    try {
      fc?.unselect?.();
    } catch {}

    cleanupFullCalendarDragArtifacts();

    createMobileEventDragGhost(p);

    p.eventDrag.hit = calendarDropHitFromPoint(p.lastX, p.lastY);

    updateMobileEventDragGhost(p, p.lastX, p.lastY);

    return true;
  }

  function armMobileEventDrag(p, target) {
    if (!p) return;
    if (!calendarMobile()) return;
    if (!p.startedOnEvent) return;

    const eventDrag = mobileCalendarEventFromTarget(target);

    if (!eventDrag) return;

    p.eventDrag = {
      ...eventDrag,
      ghost: null,
      ghostWidth: 0,
      ghostHeight: 0,
      hit: null,
    };

    clearMobileEventDragTimer(p);

    p.eventDragTimer = window.setTimeout(() => {
      const active = calendarSwipePointer;

      if (!active) return;
      if (active.token !== p.token) return;
      if (active.mode !== 'pending') return;
      if (!active.startedOnEvent) return;

      const movedX = Math.abs(active.lastX - active.startX);
      const movedY = Math.abs(active.lastY - active.startY);

      /*
        Nur echter Hold. Wenn vorher horizontal bewegt wurde, übernimmt Swipe.
      */
      if (movedX > 6 || movedY > 6) return;

      beginMobileEventDrag(active);
    }, CALENDAR_MOBILE_EVENT_LONG_PRESS_MS);
  }

  function updateMobileEventDrag(p, clientX, clientY, originalEvent) {
    if (!p?.eventDrag) return;

    safePreventDefault(originalEvent);
    originalEvent?.stopImmediatePropagation?.();

    suppressCalendarSelectionFor(350);

    p.lastX = clientX;
    p.lastY = clientY;

    updateMobileEventDragGhost(p, clientX, clientY);

    p.eventDrag.hit = calendarDropHitFromPoint(clientX, clientY);
  }

  function finishMobileEventDrag(p, {
    cancelled = false,
  } = {}) {
    const d = p?.eventDrag;
    const hit = d?.hit;
    const raw = d?.raw;

    try {
      if (!cancelled && raw && hit?.start) {
        const duration = mobileEventDurationMs(raw);
        const nextStart = hit.start;
        const nextEnd = new Date(nextStart.getTime() + duration);

        const keepExplicitEnd = !!raw.end;

        putCalendarEvent({
          ...raw,
          start: nextStart.toISOString(),
          end: keepExplicitEnd ? nextEnd.toISOString() : null,
          allDay: !!hit.allDay,
        });
      }
    } finally {
      cleanupMobileEventDrag(p);
      cleanupFullCalendarDragArtifacts();

      suppressCalendarSelectionFor(500);

      requestAnimationFrame(() => {
        cleanupFullCalendarDragArtifacts();
        applyMountedCalendarEventsTheme();
      });
    }
  }

  function calendarLongPressEventInputFromTarget(target, clientX) {
    if (!target || !fc) return null;

    /*
      Events selbst nicht als "leerer Tag" behandeln.
      Long-Press auf Event bleibt für FullCalendar-DnD reserviert.
      Event bearbeiten geht per Tap.
    */
    if (target.closest?.('.fc-event')) {
      return null;
    }

    const viewType = fc.view?.type || '';

    const dateEl = target.closest?.('[data-date]');
    const timeEl = target.closest?.('[data-time]');

    const date =
      dateEl?.dataset?.date ||
      (
        viewType.startsWith('timeGrid')
          ? dateFromTimeGridX(clientX)
          : null
      );

    if (!date) return null;

    /*
      TimeGrid:
      Long-Press auf einen Zeitslot erzeugt ein einstündiges Event.
    */
    if (viewType.startsWith('timeGrid') && timeEl?.dataset?.time) {
      const time = String(timeEl.dataset.time || '').trim();

      const startDate = new Date(`${date}T${time}`);

      if (Number.isNaN(startDate.getTime())) return null;

      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      return {
        title: '',
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        allDay: false,
      };
    }

    /*
      Month/Grid:
      Long-Press auf einen Tag erzeugt ein All-Day-Event.
      Lokale Mitternacht verwenden, nicht Date.parse("YYYY-MM-DD") UTC.
    */
    const startDate = new Date(`${date}T00:00:00`);

    if (Number.isNaN(startDate.getTime())) return null;

    return {
      title: '',
      start: startDate.toISOString(),
      end: null,
      allDay: true,
    };
  }

  function armCalendarCellLongPress(p, target, clientX) {
    if (!p) return;
    if (!calendarMobile()) return;

    const input = calendarLongPressEventInputFromTarget(target, clientX);

    if (!input) return;

    clearCalendarCellLongPressTimer(p);

    p.cellLongPressInput = input;

    p.cellLongPressTimer = window.setTimeout(() => {
      const active = calendarSwipePointer;

      if (!active) return;
      if (active.token !== p.token) return;
      if (active.mode !== 'pending') return;

      const movedX = Math.abs(active.lastX - active.startX);
      const movedY = Math.abs(active.lastY - active.startY);

      /*
        Nur echter Long-Press ohne relevante Bewegung.
      */
      if (movedX > 5 || movedY > 5) return;

      active.mode = 'cell-longpress';

      try {
        root.releasePointerCapture?.(active.pointerId);
      } catch {}

      suppressCalendarSelectionFor(900);

      calendarSwipePointer = null;
      calendarSwipeToken++;

      cleanupInteractiveCalendarSwipe();
      cleanupPointerClasses();

      try {
        fc?.unselect?.();
      } catch {}

      openEventEditor(input);
    }, 680);
  }

  function applyManualCalendarScroll(p, clientY) {
    if (!p?.scrollEl) return;

    const dy = clientY - p.startY;
    p.scrollEl.scrollTop = p.startScrollTop - dy;
  }

  function pointerTypeSupportedForCalendarSwipe(e) {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  function startStageForPointer(p) {
    if (!p) return;

    /*
      ensureInteractiveCalendarSwipeStage() erzeugt die Stage synchron,
      bevor prev/next async gebaut werden.
    */
    if (!p.stagePromise) {
      p.stagePromise = ensureInteractiveCalendarSwipeStage(p.token)
        .then((st) => {
          if (!st) return null;
          if (!calendarSwipePointer || calendarSwipePointer.token !== p.token) return null;

          const latestDx = calendarSwipePointer.lastX - calendarSwipePointer.startX;
          applyInteractiveCalendarSwipeDelta(latestDx);

          return st;
        })
        .catch((err) => {
          console.warn('[YANTA Calendar] swipe stage failed', err);
          return null;
        });
    }

    if (calendarInteractiveSwipeState) {
      const latestDx = p.lastX - p.startX;
      applyInteractiveCalendarSwipeDelta(latestDx);
    }
  }

  function beginGesture({
    clientX,
    clientY,
    pointerId,
    pointerType = '',
    target,
  }) {
    if (!fc) return;
    if (!calendarMobile()) return;
    if (!calendarViewSupportsHorizontalAnimation()) return;
    if (calendarNavAnimating) return;
    if (calendarInteractiveSwipeState) return;

    if (pointerType === 'mouse') return;

    if (
      pointerType === 'touch' &&
      (
        clientX <= CALENDAR_SWIPE_EDGE_GUARD_PX ||
        clientX >= window.innerWidth - CALENDAR_SWIPE_EDGE_GUARD_PX
      )
    ) {
      return;
    }

    if (!target || interactiveTargetBlocked(target)) {
      calendarSwipePointer = null;
      return;
    }

    const viewHarness = target.closest?.('.fc-view-harness, .fc-view-harness-active');

    if (!viewHarness) {
      calendarSwipePointer = null;
      return;
    }

    const scrollEl = calendarScrollHost();

    calendarSwipeToken++;

    const startedOnEvent = !!target.closest?.('.fc-event');
    const cellTapInput = startedOnEvent
      ? null
      : calendarLongPressEventInputFromTarget(target, clientX);

    calendarSwipePointer = {
      token: calendarSwipeToken,
      pointerId,
      pointerType,

      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastY: clientY,

      scrollEl,
      startScrollTop: scrollEl?.scrollTop || 0,

      startT: performance.now(),

      /*
        pending:
          Noch nicht entschieden.

        swipe:
          YANTA besitzt horizontale Geste.

        manual-scroll:
          YANTA scrollt vertikal.

        cell-longpress:
          legacy mode, aktuell nicht aktiv.
      */
      mode: 'pending',

      stagePromise: null,

      /*
        Event-start:
        - schneller horizontaler Move vor eventLongPressDelay => Kalender-Swipe
        - nach eventLongPressDelay => FullCalendar darf DnD übernehmen
      */
      startedOnEvent,

      /*
        Tap auf leere Zelle wird im pointerup selbst verarbeitet.
        Dadurch sind wir nicht von FullCalendar dateClick abhängig.
      */
      cellTapInput,

      cellLongPressTimer: null,
      cellLongPressInput: null,
    };

    /*
      Kein Cell-LongPress mehr:
      - Tap auf leere Zelle öffnet Editor.
      - Long-Press auf leerer Zelle bleibt FullCalendar Range-Select.
      - Long-Press auf Event startet YANTA Mobile Event-DnD.
    */
    // armCalendarCellLongPress(calendarSwipePointer, target, clientX);

    armMobileEventDrag(calendarSwipePointer, target);
  }

  function moveGesture({
    clientX,
    clientY,
    pointerId,
    originalEvent,
  }) {
    const p = calendarSwipePointer;

    if (!p) return;
    if (p.pointerId !== pointerId) return;

    const dx = clientX - p.startX;
    const dy = clientY - p.startY;

    p.lastX = clientX;
    p.lastY = clientY;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (p.mode === 'event-drag') {
      updateMobileEventDrag(p, clientX, clientY, originalEvent);
      return;
    }

    /*
      Sobald der Finger relevant bewegt wird, ist es kein Tap/Long-Press
      auf eine leere Zelle mehr.
    */
    if (absX > 5 || absY > 5) {
      clearCalendarCellLongPressTimer(p);
    }

    if (p.mode === 'pending') {
      const age = performance.now() - p.startT;

      /*
        Finger fast ruhig:
        Nichts blockieren.
        - Event: YANTA startet nach CALENDAR_MOBILE_EVENT_LONG_PRESS_MS custom DnD.
        - leere Zelle: pointerup öffnet per Tap den Editor.
      */
      if (absX < 4 && absY < 4) {
        return;
      }

      /*
        Wenn auf Event gestartet wurde und vor dem Hold bewegt wird:
        Event-DnD-Timer abbrechen. Danach entscheidet Swipe/Scroll.
      */
      if (p.startedOnEvent && (absX > 6 || absY > 6)) {
        clearMobileEventDragTimer(p);
      }

      /*
        Wenn auf einem Event gestartet wurde und der Hold bereits erreicht ist,
        aber der Timer noch nicht lief, starten wir custom DnD hier defensiv.
      */
      if (
        p.startedOnEvent &&
        age >= CALENDAR_MOBILE_EVENT_LONG_PRESS_MS &&
        absX <= 10 &&
        absY <= 10
      ) {
        if (beginMobileEventDrag(p)) {
          updateMobileEventDrag(p, clientX, clientY, originalEvent);
          return;
        }
      }

      /*
        Long-Press auf leerer Zelle:
        Ab hier gehört die Geste FullCalendar für Range-Selection.
        Das stellt wieder her:
          Tag halten -> über weitere Tage ziehen -> beim Loslassen Editor öffnen.
      */
      if (
        !p.startedOnEvent &&
        age >= CALENDAR_CELL_SELECT_LONG_PRESS_MS
      ) {
        clearCalendarCellLongPressTimer(p);

        try {
          root.releasePointerCapture?.(p.pointerId);
        } catch {}

        calendarSwipePointer = null;
        cleanupInteractiveCalendarSwipe();
        cleanupPointerClasses();

        return;
      }

      /*
        Horizontale Absicht:
        Vor Timeout-Fallbacks claimen, damit schneller Swipe ab Event
        zuverlässig den Kalender blättert.
      */
      if (
        absX >= CALENDAR_SWIPE_CLAIM_PX &&
        absX > absY * CALENDAR_SWIPE_CLAIM_RATIO
      ) {
        clearCalendarCellLongPressTimer(p);
        clearMobileEventDragTimer(p);

        p.mode = 'swipe';

        root.classList.add('yanta-cal-swiping');
        document.documentElement.classList.add('yanta-cal-swipe-priming');

        cleanupFullCalendarDragArtifacts();
        beginSwipeSelectionSuppression();

        startStageForPointer(p);

        safePreventDefault(originalEvent);
        originalEvent?.stopImmediatePropagation?.();

        applyInteractiveCalendarSwipeDelta(dx);
        return;
      }

      /*
        Vertikale Absicht.
      */
      if (absY >= 8 && absY > absX * 1.08) {
        clearCalendarCellLongPressTimer(p);
        clearMobileEventDragTimer(p);

        p.mode = 'manual-scroll';

        root.classList.add('yanta-cal-manual-scrolling');

        suppressCalendarSelectionFor(350);

        safePreventDefault(originalEvent);
        originalEvent?.stopImmediatePropagation?.();

        applyManualCalendarScroll(p, clientY);
        return;
      }

      /*
        Ambige Bewegung nach Entscheidungsfenster:
        Nur loslassen, wenn es KEIN potenzieller Long-Press-Select mehr ist.
        Für leere Zellen halten wir bis CALENDAR_CELL_SELECT_LONG_PRESS_MS offen.
      */
      if (
        age > CALENDAR_SWIPE_DECISION_TIMEOUT_MS &&
        (
          p.startedOnEvent ||
          age >= CALENDAR_CELL_SELECT_LONG_PRESS_MS
        )
      ) {
        clearCalendarCellLongPressTimer(p);
        clearMobileEventDragTimer(p);

        try {
          root.releasePointerCapture?.(p.pointerId);
        } catch {}

        calendarSwipePointer = null;
        cleanupInteractiveCalendarSwipe();
        cleanupPointerClasses();
        return;
      }

      return;
    }

    if (p.mode === 'manual-scroll') {
      suppressCalendarSelectionFor(350);

      safePreventDefault(originalEvent);
      originalEvent?.stopImmediatePropagation?.();

      applyManualCalendarScroll(p, clientY);
      return;
    }

    if (p.mode === 'swipe') {
      beginSwipeSelectionSuppression();
      cleanupFullCalendarDragArtifacts();

      safePreventDefault(originalEvent);
      originalEvent?.stopImmediatePropagation?.();

      applyInteractiveCalendarSwipeDelta(dx);
    }
  }

  function endGesture({
    clientX,
    clientY,
    pointerId,
    originalEvent,
    cancelled = false,
  }) {
    const p = calendarSwipePointer;

    if (!p) return;
    if (p.pointerId !== pointerId) return;

    clearCalendarCellLongPressTimer(p);
    clearMobileEventDragTimer(p);

    const mode = p.mode;
    const age = performance.now() - p.startT;
    const movedX = Math.abs((clientX ?? p.lastX) - p.startX);
    const movedY = Math.abs((clientY ?? p.lastY) - p.startY);

    calendarSwipePointer = null;
    calendarSwipeToken++;

    cleanupPointerClasses();

    if (cancelled) {
      if (mode === 'event-drag') {
        safePreventDefault(originalEvent);
        originalEvent?.stopImmediatePropagation?.();

        finishMobileEventDrag(p, {
          cancelled: true,
        });

        return;
      }

      finishInteractiveCalendarSwipe({
        cancelled: true,
      }).catch(() => {
        cleanupInteractiveCalendarSwipe();
        endSwipeSelectionSuppression();
      });

      return;
    }

    if (mode === 'event-drag') {
      safePreventDefault(originalEvent);
      originalEvent?.stopImmediatePropagation?.();

      finishMobileEventDrag(p, {
        cancelled: false,
      });

      scheduleCalendarSwipePrewarm();
      return;
    }

    /*
      Tap auf gespeichertes Event:
      Mobile öffnet den Event-Editor selbst.

      Hintergrund:
      Wenn wir hier später pauschal endSwipeSelectionSuppression() aufrufen,
      setzt das calendarSuppressSelectUntil. Der danach kommende
      FullCalendar eventClick wird dann geblockt und das Event öffnet nicht.
    */
    const eventTapId = p.eventDrag?.id || '';

    const isCleanStoredEventTap =
      mode === 'pending' &&
      p.startedOnEvent &&
      !!eventTapId &&
      movedX <= 6 &&
      movedY <= 6 &&
      age <= 650;

    if (isCleanStoredEventTap) {
      cleanupInteractiveCalendarSwipe();
      cleanupMobileEventDrag(p);

      suppressCalendarSelectionFor(500);

      safePreventDefault(originalEvent);
      originalEvent?.stopImmediatePropagation?.();

      try {
        fc?.unselect?.();
      } catch {}

      openEventEditor({
        id: eventTapId,
      });

      scheduleCalendarSwipePrewarm();
      return;
    }

    /*
      Tap auf leeren Tag/Slot:
      Wir machen das selbst, weil FullCalendar dateClick mit unserer
      mobile Gesture-Schicht nicht zuverlässig genug ist.
    */
    const isCleanTap =
      mode === 'pending' &&
      !p.startedOnEvent &&
      !!p.cellTapInput &&
      movedX <= 6 &&
      movedY <= 6 &&
      age <= 550;

    if (isCleanTap) {
      cleanupInteractiveCalendarSwipe();

      suppressCalendarSelectionFor(500);

      safePreventDefault(originalEvent);
      originalEvent?.stopImmediatePropagation?.();

      try {
        fc?.unselect?.();
      } catch {}

      openEventEditor(p.cellTapInput);
      return;
    }

    /*
      Kein Fallback-Navigate.
      Wenn nicht interaktiv geclaimt wurde, darf der Monat nicht springen.

      Wichtig:
      Bei einem normalen pending Event-Tap NICHT pauschal
      endSwipeSelectionSuppression() ausführen. Sonst wird der anschließende
      FullCalendar eventClick unterdrückt.
    */
    if (mode !== 'swipe') {
      cleanupInteractiveCalendarSwipe();
      cleanupMobileEventDrag(p);

      if (
        mode === 'manual-scroll' ||
        mode === 'cell-longpress' ||
        calendarSwipeSelectionSuppressed
      ) {
        endSwipeSelectionSuppression();
      }

      scheduleCalendarSwipePrewarm();
      return;
    }

    beginSwipeSelectionSuppression();

    safePreventDefault(originalEvent);
    originalEvent?.stopImmediatePropagation?.();

    cleanupFullCalendarDragArtifacts();
    cleanupMobileEventDrag(p);

    if (!calendarInteractiveSwipeState) {
      cleanupInteractiveCalendarSwipe();
      endSwipeSelectionSuppression();
      scheduleCalendarSwipePrewarm();
      return;
    }

    finishInteractiveCalendarSwipe().catch((err) => {
      console.warn('[YANTA Calendar] interactive swipe finish failed', err);
      cleanupInteractiveCalendarSwipe();
      endSwipeSelectionSuppression();
    });
  }

  /*
    Pointer Events sind die Hauptstrecke.
    Wichtig: pointerdown wird NICHT verhindert, damit FullCalendar
    Long-Press weiterhin starten kann.
  */
  root.addEventListener('pointerdown', (e) => {
    if (!pointerTypeSupportedForCalendarSwipe(e)) return;
    if (e.isPrimary === false) return;

    beginGesture({
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      target: e.target,
    });

    if (calendarSwipePointer?.pointerId === e.pointerId) {
      try {
        root.setPointerCapture?.(e.pointerId);
      } catch {}
    }
  }, {
    capture: true,
    passive: false,
  });

  document.addEventListener('pointermove', (e) => {
    if (!pointerTypeSupportedForCalendarSwipe(e)) return;

    moveGesture({
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
      originalEvent: e,
    });
  }, {
    capture: true,
    passive: false,
  });

  document.addEventListener('pointerup', (e) => {
    if (!pointerTypeSupportedForCalendarSwipe(e)) return;

    try {
      root.releasePointerCapture?.(e.pointerId);
    } catch {}

    endGesture({
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
      originalEvent: e,
    });
  }, {
    capture: true,
    passive: false,
  });

  document.addEventListener('pointercancel', (e) => {
    if (!pointerTypeSupportedForCalendarSwipe(e)) return;

    try {
      root.releasePointerCapture?.(e.pointerId);
    } catch {}

    endGesture({
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
      originalEvent: e,
      cancelled: true,
    });
  }, {
    capture: true,
    passive: false,
  });

  /*
    FullCalendar kann intern zusätzlich TouchEvents hören.
    Sobald YANTA die Geste übernommen hat, blocken wir diese Events.
    Wichtig: nur nach Claim, nie bei ruhigem Long-Press.
  */
  if (window.PointerEvent) {
    const blockClaimedNativeTouch = (e) => {
      if (!root.contains(e.target)) return;

      const claimed =
        calendarInteractiveSwipeState ||
        calendarSwipePointer?.mode === 'swipe' ||
        calendarSwipePointer?.mode === 'manual-scroll' ||
        calendarSwipeSelectionSuppressed;

      if (!claimed) return;

      safePreventDefault(e);
      e.stopImmediatePropagation?.();
    };

    document.addEventListener('touchmove', blockClaimedNativeTouch, {
      capture: true,
      passive: false,
    });

    document.addEventListener('touchend', blockClaimedNativeTouch, {
      capture: true,
      passive: false,
    });

    document.addEventListener('touchcancel', blockClaimedNativeTouch, {
      capture: true,
      passive: false,
    });
  }
}

function calendarSurfaceVisible() {
  if (calendarMode === 'pane') {
    return isSidePaneOpen('calendar') && !!$('calendar')?.isConnected;
  }

  const surface = $('calendarSurface');
  return !!surface && !surface.hidden && state.surface === 'calendar';
}

function calendarHeightHost() {
  const calendarEl = $('calendar');
  return calendarEl?.parentElement || calendarEl || null;
}

function measuredCalendarHeight() {
  const host = calendarHeightHost();

  if (!host) return 650;

  const rect = host.getBoundingClientRect();
  const h = Math.floor(rect.height || 0);

  return Math.max(360, h || 650);
}

function resizeCalendarNow({
  render = false,
} = {}) {
  if (!fc) return;
  if (!calendarSurfaceVisible()) return;

  const mobile = calendarMobile();

  /*
    Mobile:
    FullCalendar darf natürlich wachsen. Der Parent .yanta-calendar-host scrollt.

    UX-Policy:
    - Long-Press Select bleibt möglich.
    - Event-DnD ist auf Mobile erlaubt, aber erst nach Long-Press.
    - YANTA übernimmt horizontale Swipes früh.
    - selectMinDistance verhindert accidental drag-select.
  */
  if (mobile) {
    if (lastCalendarMobileMode !== true) {
      lastCalendarMobileMode = true;
      lastCalendarHeight = 0;

      try {
        fc.setOption('selectable', true);

        /*
          Mobile-DnD bleibt über YANTA custom logic,
          FullCalendar-DnD bleibt aus.
        */
        fc.setOption('editable', false);
        fc.setOption('eventDragMinDistance', CALENDAR_MOBILE_EVENT_DRAG_MIN_DISTANCE_PX);
        fc.setOption('selectMinDistance', 18);

        fc.setOption('longPressDelay', 650);
        fc.setOption('selectLongPressDelay', 650);
        fc.setOption('eventLongPressDelay', CALENDAR_MOBILE_EVENT_LONG_PRESS_MS);

        /*
          Wichtig: nicht auto, sondern verfügbare Host-Höhe nutzen.
        */
        fc.setOption('expandRows', true);
      } catch {}
    }

    const h = measuredCalendarHeight();

    if (Math.abs(h - lastCalendarHeight) > 2) {
      lastCalendarHeight = h;

      try {
        fc.setOption('height', h);
        fc.setOption('contentHeight', h);
        fc.setOption('expandRows', true);
      } catch {}
    }

    try {
      fc.updateSize();
    } catch {}

    if (render) {
      renderCalendarEvents();
    }

    return;
  }

  /*
    Desktop/tablet:
    Fixed-height hardened behavior.
  */
  if (lastCalendarMobileMode !== false) {
    lastCalendarMobileMode = false;
    lastCalendarHeight = 0;

    try {
      fc.setOption('height', measuredCalendarHeight());
      fc.setOption('contentHeight', measuredCalendarHeight());
      fc.setOption('expandRows', true);

      fc.setOption('selectable', true);
      fc.setOption('editable', true);
      fc.setOption('eventDragMinDistance', 5);

      fc.setOption('selectMinDistance', 0);

      fc.setOption('longPressDelay', 1000);
      fc.setOption('selectLongPressDelay', 1000);
      fc.setOption('eventLongPressDelay', 1000);
    } catch {}
  }

  const h = measuredCalendarHeight();

  if (Math.abs(h - lastCalendarHeight) > 2) {
    lastCalendarHeight = h;

    try {
      fc.setOption('height', h);
      fc.setOption('contentHeight', h);
    } catch {}
  }

  try {
    fc.updateSize();
  } catch {}

  if (render) {
    renderCalendarEvents();
  }
}

function scheduleCalendarResize({
  render = false,
} = {}) {
  if (!fc) return;
  if (!calendarSurfaceVisible()) return;

  if (calendarResizeScheduled) return;
  calendarResizeScheduled = true;

  requestAnimationFrame(() => {
    calendarResizeScheduled = false;

    resizeCalendarNow({ render });

    requestAnimationFrame(() => {
      resizeCalendarNow({ render });
    });
  });
}

function setupCalendarResizeObserver() {
  if (calendarResizeObserver) return;

  const host = calendarHeightHost();
  if (!host) return;

  if (typeof ResizeObserver !== 'undefined') {
    calendarResizeObserver = new ResizeObserver(() => {
      scheduleCalendarResize();
    });

    calendarResizeObserver.observe(host);
  }

  CALENDAR_MOBILE_MQ.addEventListener?.('change', () => {
    lastCalendarMobileMode = null;
    lastCalendarHeight = 0;

    scheduleCalendarResize({ render: true });
  });

  window.addEventListener('resize', () => {
    invalidateCalendarSwipeCache();
    scheduleCalendarResize();
    scheduleCalendarSwipePrewarm();
  });

  window.addEventListener('yanta-sidebar-resized', () => {
    invalidateCalendarSwipeCache();
    scheduleCalendarResize();
    scheduleCalendarSwipePrewarm();
  });

  window.addEventListener('yanta-theme-change', () => {
    if (!fc) return;

    scheduleCalendarThemePaint();
  });

  window.addEventListener('yanta-appearance-changed', () => {
    if (!fc) return;

    scheduleCalendarThemePaint();
  });
}

function scheduleCalendarRender() {
  if (batchDepth > 0) return;
  if (!fc) return;
  if (!calendarSurfaceVisible()) return;

  if (renderScheduled) return;
  renderScheduled = true;

  requestAnimationFrame(() => {
    renderScheduled = false;

    if (!fc || !calendarSurfaceVisible()) return;

    resizeCalendarNow();
    renderCalendarEvents();
  });
}

async function withCalendarBatch(fn) {
  batchDepth++;

  try {
    return await fn();
  } finally {
    batchDepth--;
    scheduleCalendarRender();
  }
}

function isoOrNull(v) {
  if (!v) return null;

  const d = v instanceof Date
    ? v
    : new Date(v);

  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
}

function localInputValue(iso, allDay = false) {
  if (!iso) return '';

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const pad = (n) => String(n).padStart(2, '0');

  if (allDay) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value, allDay = false) {
  if (!value) return null;

  if (allDay) {
    return new Date(value + 'T00:00:00').toISOString();
  }

  return new Date(value).toISOString();
}

function isDateOnlyString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function localDateOnlyToDate(value) {
  if (!isDateOnlyString(value)) return null;

  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);

  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLikeToLocalDate(value) {
  if (!value) return null;

  if (isDateOnlyString(value)) {
    return localDateOnlyToDate(value);
  }

  const d = value instanceof Date
    ? value
    : new Date(value);

  return Number.isNaN(d.getTime()) ? null : d;
}

function sameLocalDay(a, b) {
  const da = dateLikeToLocalDate(a);
  const db = dateLikeToLocalDate(b);

  if (!da || !db) return false;

  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function normalizeCalendarEventEnd({ start, end, allDay }) {
  if (!end) return null;

  if (allDay && sameLocalDay(start, end)) {
    return null;
  }

  return end;
}

function calendarEditorRangeIsValid({
  start,
  end,
  allDay = false,
}) {
  if (!start) {
    return {
      ok: false,
      message: 'Start date required',
    };
  }

  // Empty end is valid.
  if (!end) {
    return {
      ok: true,
    };
  }

  const startDate = dateLikeToLocalDate(start);
  const endDate = dateLikeToLocalDate(end);

  if (!startDate || !endDate) {
    return {
      ok: false,
      message: 'Invalid date range',
    };
  }

  if (allDay) {
    const s = startOfLocalDay(startDate).getTime();
    const e = startOfLocalDay(endDate).getTime();

    if (e < s) {
      return {
        ok: false,
        message: 'End date must be on or after start date',
      };
    }

    return {
      ok: true,
    };
  }

  if (endDate.getTime() <= startDate.getTime()) {
    return {
      ok: false,
      message: 'End time must be after start time',
    };
  }

  return {
    ok: true,
  };
}

function calendarEditorDatePlaceholder(allDay = false) {
  const prefs = getCalendarPreferences();
  const date = prefs.dateFormat || 'DD/MM/YYYY';

  if (allDay) return date;

  return prefs.timeFormat === '12'
    ? `${date} 2:30 PM`
    : `${date} 14:30`;
}

function formatCalendarEditorDatePart(date, prefs = getCalendarPreferences()) {
  const d = dateLikeToLocalDate(date);
  if (!d) return '';

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear());

  switch (prefs.dateFormat) {
    case 'DD.MM.YYYY':
      return `${day}.${month}.${year}`;

    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;

    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;

    case 'DD/MM/YYYY':
    default:
      return `${day}/${month}/${year}`;
  }
}

function formatCalendarEditorTimePart(date, prefs = getCalendarPreferences()) {
  const d = dateLikeToLocalDate(date);
  if (!d) return '';

  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');

  if (prefs.timeFormat === '12') {
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${m} ${suffix}`;
  }

  return `${String(h).padStart(2, '0')}:${m}`;
}

function calendarEditorInputValue(iso, allDay = false) {
  if (!iso) return '';

  const d = dateLikeToLocalDate(iso);
  if (!d) return '';

  const datePart = formatCalendarEditorDatePart(d);

  if (allDay) return datePart;

  return `${datePart} ${formatCalendarEditorTimePart(d)}`;
}

function normalizeTwoDigitYear(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return NaN;

  if (String(y).length <= 2) {
    return n >= 70 ? 1900 + n : 2000 + n;
  }

  return n;
}

function parseCalendarEditorDatePart(raw, prefs = getCalendarPreferences()) {
  let s = String(raw || '').trim();

  if (!s) return null;

  // Allows copy/paste like "Sunday, 30/05/2026"
  // but deliberately does not attempt full natural-language month parsing.
  s = s.replace(/^[^\d]+,\s*/, '').trim();

  // Always accept ISO.
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);

    return validYmd(y, mo, d) ? { y, mo, d } : null;
  }

  // Accept numeric separators: 30/05/2026, 30.05.2026, 05-30-2026
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);

  if (!m) return null;

  let a = Number(m[1]);
  let b = Number(m[2]);
  const y = normalizeTwoDigitYear(m[3]);

  let d;
  let mo;

  if (prefs.dateFormat === 'MM/DD/YYYY') {
    mo = a;
    d = b;
  } else {
    // Default and ISO-ish European behavior:
    // DD/MM/YYYY, DD.MM.YYYY
    d = a;
    mo = b;
  }

  // Safety: if the configured interpretation is impossible but the
  // reverse is possible, accept the reverse. Example: 13/05 in MM/DD.
  if (!validYmd(y, mo, d) && validYmd(y, d, mo)) {
    const tmp = d;
    d = mo;
    mo = tmp;
  }

  return validYmd(y, mo, d) ? { y, mo, d } : null;
}

function validYmd(y, mo, d) {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return false;
  if (y < 1000 || y > 9999) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;

  const dt = new Date(y, mo - 1, d);

  return (
    dt.getFullYear() === y &&
    dt.getMonth() === mo - 1 &&
    dt.getDate() === d
  );
}

function parseCalendarEditorTimePart(raw, prefs = getCalendarPreferences()) {
  const s = String(raw || '').trim().toLowerCase();

  if (!s) return null;

  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
  if (!m) return null;

  let h = Number(m[1]);
  const min = m[2] == null ? 0 : Number(m[2]);
  const ampm = (m[3] || '').replace(/\./g, '').toLowerCase();

  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (min < 0 || min > 59) return null;

  if (ampm) {
    if (h < 1 || h > 12) return null;

    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  } else {
    if (h < 0 || h > 23) return null;
  }

  return {
    h,
    min,
  };
}

function splitCalendarEditorDateTime(raw, allDay = false) {
  const s = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace('T', ' ');

  if (!s) {
    return {
      datePart: '',
      timePart: '',
    };
  }

  if (allDay) {
    return {
      datePart: s,
      timePart: '',
    };
  }

  // Match a time at the end:
  // 30/05/2026 14:30
  // 30/05/2026, 14:30
  // 30/05/2026 2:30 PM
  // 30/05/2026 2 PM
  const m = s.match(/^(.*?)(?:,?\s+)(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)$/i);

  if (!m) {
    return {
      datePart: s,
      timePart: '',
    };
  }

  return {
    datePart: m[1].trim(),
    timePart: m[2].trim(),
  };
}

function parseCalendarEditorInput(value, allDay = false) {
  const prefs = getCalendarPreferences();
  const parts = splitCalendarEditorDateTime(value, allDay);

  const date = parseCalendarEditorDatePart(parts.datePart, prefs);
  if (!date) return null;

  let time = {
    h: 0,
    min: 0,
  };

  if (!allDay) {
    time = parseCalendarEditorTimePart(parts.timePart, prefs);

    if (!time) {
      return null;
    }
  }

  const d = new Date(
    date.y,
    date.mo - 1,
    date.d,
    time.h,
    time.min,
    0,
    0
  );

  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
}

// ============================================================
// Modern YANTA Date/Time Picker
// Mobile-first replacement for native browser date inputs.
// ============================================================

function localDateKeyFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(d.getTime())) return '';

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function cloneDate(d) {
  return new Date(d.getTime());
}

function startOfLocalDay(d) {
  const x = cloneDate(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addLocalDays(d, days) {
  const x = cloneDate(d);
  x.setDate(x.getDate() + days);
  return x;
}

function sameLocalDate(a, b) {
  if (!a || !b) return false;

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthLabel(year, month) {
  const prefs = getCalendarPreferences();

  try {
    return new Intl.DateTimeFormat(fullCalendarLocale(prefs), {
      month: 'long',
      year: 'numeric',
    }).format(new Date(year, month, 1));
  } catch {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }
}

function weekdayLabelsForPicker() {
  const prefs = getCalendarPreferences();
  const weekStart = Number(prefs.weekStart ?? 1);
  const base = new Date(2026, 4, 3); // Sunday 2026-05-03

  const out = [];

  for (let i = 0; i < 7; i++) {
    const day = (weekStart + i) % 7;
    const d = addLocalDays(base, day);

    try {
      out.push(new Intl.DateTimeFormat(fullCalendarLocale(prefs), {
        weekday: 'short',
      }).format(d));
    } catch {
      out.push(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]);
    }
  }

  return out;
}

function ensureCalendarDateTimePickerModal() {
  if (calendarDateTimePickerModal) return calendarDateTimePickerModal;

  calendarDateTimePickerModal = document.createElement('div');
  calendarDateTimePickerModal.className = 'modal yanta-calendar-datetime-picker-modal';
  calendarDateTimePickerModal.hidden = true;

  calendarDateTimePickerModal.addEventListener('click', (e) => {
    if (e.target === calendarDateTimePickerModal) {
      closeCalendarDateTimePicker();
    }

    if (e.target.closest?.('[data-ydtp-close]')) {
      closeCalendarDateTimePicker();
    }
  });

  document.body.append(calendarDateTimePickerModal);

  return calendarDateTimePickerModal;
}

function closeCalendarDateTimePicker() {
  if (calendarDateTimePickerModal) {
    calendarDateTimePickerModal.hidden = true;
  }
}

function openCalendarDateTimePicker({
  title = 'Pick date',
  value = null,
  allDay = false,
  allowClear = false,
  onPick = null,
} = {}) {
  const modal = ensureCalendarDateTimePickerModal();

  const prefs = getCalendarPreferences();

  let selected =
    dateLikeToLocalDate(value) ||
    new Date();

  selected = cloneDate(selected);
  selected.setSeconds(0, 0);

  if (allDay) {
    selected.setHours(0, 0, 0, 0);
  }

  let viewYear = selected.getFullYear();
  let viewMonth = selected.getMonth();

  let mode = 'date'; // date | time

  const render = () => {
    const currentPrefs = getCalendarPreferences();
    const hour12 = currentPrefs.timeFormat === '12';

    const selectedHour = selected.getHours();
    const selectedMinute = selected.getMinutes();

    const hour12Value = selectedHour % 12 || 12;
    const isPm = selectedHour >= 12;

    const weekdays = weekdayLabelsForPicker();

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const weekStart = Number(currentPrefs.weekStart ?? 1);
    const offset = (firstOfMonth.getDay() - weekStart + 7) % 7;
    const gridStart = addLocalDays(firstOfMonth, -offset);

    const today = startOfLocalDay(new Date());

    const daysHtml = [];

    for (let i = 0; i < 42; i++) {
      const d = addLocalDays(gridStart, i);
      const inMonth = d.getMonth() === viewMonth;
      const selectedDay = sameLocalDate(d, selected);
      const todayDay = sameLocalDate(d, today);

      daysHtml.push(`
        <button
          type="button"
          class="yanta-dtp-day ${inMonth ? '' : 'is-out'} ${selectedDay ? 'selected' : ''} ${todayDay ? 'today' : ''}"
          data-ydtp-day="${escapeAttr(localDateKeyFromDate(d))}">
          <span>${d.getDate()}</span>
        </button>
      `);
    }

    const minuteSet = new Set();

    for (let m = 0; m < 60; m += 5) {
      minuteSet.add(m);
    }

    minuteSet.add(selectedMinute);

    const minutes = [...minuteSet].sort((a, b) => a - b);

    const hoursHtml = hour12
      ? Array.from({ length: 12 }, (_, i) => i + 1).map((h) => `
          <button
            type="button"
            class="yanta-dtp-wheel-item ${h === hour12Value ? 'selected' : ''}"
            data-ydtp-hour12="${h}">
            ${h}
          </button>
        `).join('')
      : Array.from({ length: 24 }, (_, h) => `
          <button
            type="button"
            class="yanta-dtp-wheel-item ${h === selectedHour ? 'selected' : ''}"
            data-ydtp-hour="${h}">
            ${String(h).padStart(2, '0')}
          </button>
        `).join('');

    const minutesHtml = minutes.map((m) => `
      <button
        type="button"
        class="yanta-dtp-wheel-item ${m === selectedMinute ? 'selected' : ''}"
        data-ydtp-minute="${m}">
        ${String(m).padStart(2, '0')}
      </button>
    `).join('');

    modal.innerHTML = `
      <div class="modal-card yanta-calendar-datetime-card">
        <header class="yanta-dtp-head">
          <div>
            <div class="yanta-dtp-kicker">${escapeHtml(title)}</div>
            <div class="yanta-dtp-value">
              ${escapeHtml(formatCalendarDateTime(selected, {
                allDay,
                editor: true,
                includeWeekday: true,
              }))}
            </div>
          </div>

          <button class="icon-btn" data-ydtp-close title="Close">${lucide('x', 16)}</button>
        </header>

        <div class="yanta-dtp-tabs">
          <button class="${mode === 'date' ? 'active' : ''}" data-ydtp-mode="date">
            ${lucide('calendar-days', 14)} Date
          </button>
          <button class="${mode === 'time' ? 'active' : ''}" data-ydtp-mode="time" ${allDay ? 'disabled' : ''}>
            ${lucide('clock', 14)} Time
          </button>
        </div>

        <div class="yanta-dtp-body">
          <section class="yanta-dtp-panel ${mode === 'date' ? 'active' : ''}" data-ydtp-panel="date">
            <div class="yanta-dtp-month-row">
              <button type="button" class="icon-btn" data-ydtp-month="-1">${lucide('chevron-left', 17)}</button>
              <strong>${escapeHtml(monthLabel(viewYear, viewMonth))}</strong>
              <button type="button" class="icon-btn" data-ydtp-month="1">${lucide('chevron-right', 17)}</button>
            </div>

            <div class="yanta-dtp-weekdays">
              ${weekdays.map((w) => `<span>${escapeHtml(w)}</span>`).join('')}
            </div>

            <div class="yanta-dtp-grid">
              ${daysHtml.join('')}
            </div>
          </section>

          <section class="yanta-dtp-panel ${mode === 'time' ? 'active' : ''}" data-ydtp-panel="time">
            <div class="yanta-dtp-time-display">
              ${escapeHtml(formatCalendarEditorTimePart(selected))}
            </div>

            <div class="yanta-dtp-time-wheels ${hour12 ? 'is-12h' : ''}">
              <div class="yanta-dtp-wheel" data-wheel="hour">
                <div class="yanta-dtp-wheel-label">Hour</div>
                ${hoursHtml}
              </div>

              <div class="yanta-dtp-wheel" data-wheel="minute">
                <div class="yanta-dtp-wheel-label">Minute</div>
                ${minutesHtml}
              </div>

              ${hour12 ? `
                <div class="yanta-dtp-ampm">
                  <button type="button" class="${!isPm ? 'selected' : ''}" data-ydtp-ampm="am">AM</button>
                  <button type="button" class="${isPm ? 'selected' : ''}" data-ydtp-ampm="pm">PM</button>
                </div>
              ` : ''}
            </div>
          </section>
        </div>

        <footer class="yanta-dtp-foot">
          ${allowClear ? `<button type="button" class="btn" data-ydtp-clear>Clear</button>` : ''}
          <button type="button" class="btn" data-ydtp-today>${allDay ? 'Today' : 'Now'}</button>
          <span class="grow"></span>
          <button type="button" class="btn" data-ydtp-close>Cancel</button>
          <button type="button" class="btn primary" data-ydtp-ok>OK</button>
        </footer>
      </div>
    `;

    modal.querySelectorAll('[data-ydtp-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        mode = btn.dataset.ydtpMode || 'date';
        render();
      });
    });

    modal.querySelectorAll('[data-ydtp-month]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.dataset.ydtpMonth || 0);
        const next = new Date(viewYear, viewMonth + delta, 1);

        viewYear = next.getFullYear();
        viewMonth = next.getMonth();

        render();
      });
    });

    modal.querySelectorAll('[data-ydtp-day]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const date = localDateOnlyToDate(btn.dataset.ydtpDay);
        if (!date) return;

        const h = selected.getHours();
        const m = selected.getMinutes();

        selected = date;
        selected.setHours(allDay ? 0 : h, allDay ? 0 : m, 0, 0);

        if (!allDay) {
          mode = 'time';
        }

        render();
      });
    });

    modal.querySelectorAll('[data-ydtp-hour]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected.setHours(Number(btn.dataset.ydtpHour || 0), selected.getMinutes(), 0, 0);
        render();
      });
    });

    modal.querySelectorAll('[data-ydtp-hour12]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const h12 = Number(btn.dataset.ydtpHour12 || 12);
        const currentlyPm = selected.getHours() >= 12;

        let h = h12 % 12;
        if (currentlyPm) h += 12;

        selected.setHours(h, selected.getMinutes(), 0, 0);
        render();
      });
    });

    modal.querySelectorAll('[data-ydtp-minute]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected.setMinutes(Number(btn.dataset.ydtpMinute || 0), 0, 0);
        render();
      });
    });

    modal.querySelectorAll('[data-ydtp-ampm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wantPm = btn.dataset.ydtpAmpm === 'pm';
        let h = selected.getHours();

        if (wantPm && h < 12) h += 12;
        if (!wantPm && h >= 12) h -= 12;

        selected.setHours(h, selected.getMinutes(), 0, 0);
        render();
      });
    });

    modal.querySelector('[data-ydtp-today]')?.addEventListener('click', () => {
      const n = new Date();
      selected = allDay ? startOfLocalDay(n) : n;
      selected.setSeconds(0, 0);
      viewYear = selected.getFullYear();
      viewMonth = selected.getMonth();
      render();
    });

    modal.querySelector('[data-ydtp-clear]')?.addEventListener('click', () => {
      onPick?.(null);
      closeCalendarDateTimePicker();
    });

    modal.querySelector('[data-ydtp-ok]')?.addEventListener('click', () => {
      const picked = cloneDate(selected);

      if (allDay) {
        picked.setHours(0, 0, 0, 0);
      }

      onPick?.(picked.toISOString());
      closeCalendarDateTimePicker();
    });

    requestAnimationFrame(() => {
      modal
        .querySelector('.yanta-dtp-wheel-item.selected')
        ?.scrollIntoView({
          block: 'center',
          inline: 'nearest',
        });
    });
  };

  modal.hidden = false;
  render();
}

function cleanUndefined(obj) {
  const out = {};

  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ============================================================
// Calendar native dialogs + default time helpers
// ============================================================

export function calendarChoiceDialog({
  title = 'Confirm',
  message = '',
  choices = [],
} = {}) {
  const safeChoices = choices.length
    ? choices
    : [
        {
          id: 'ok',
          label: 'OK',
          primary: true,
          icon: 'check',
        },
        {
          id: 'cancel',
          label: 'Cancel',
          icon: 'x',
        },
      ];

  return yantaChoice({
    title,
    message,
    icon: safeChoices.some((choice) => choice.danger)
      ? 'triangle-alert'
      : 'calendar-days',
    danger: safeChoices.some((choice) => choice.danger),
    choices: safeChoices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      hint: choice.hint || '',
      icon:
        choice.icon ||
        (
          choice.danger
            ? 'triangle-alert'
            : choice.primary
              ? 'check'
              : 'circle'
        ),
      primary: !!choice.primary,
      danger: !!choice.danger,
      disabled: !!choice.disabled,
    })),
    cancelLabel: 'Cancel',
  });
}

function nextHalfHourDate(base = new Date()) {
  const d = new Date(base);
  d.setSeconds(0, 0);

  const minutes = d.getMinutes();

  if (minutes === 0) {
    d.setMinutes(30);
  } else if (minutes <= 30) {
    d.setMinutes(30);
  } else {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }

  return d;
}

function applyCurrentDefaultTimeToDate(dateLike) {
  const date = dateLikeToLocalDate(dateLike) || new Date();
  const slot = nextHalfHourDate();

  date.setHours(slot.getHours(), slot.getMinutes(), 0, 0);

  return date.toISOString();
}

function addMinutesIso(iso, minutes) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  return new Date(d.getTime() + minutes * 60000).toISOString();
}

// ============================================================
// Data model
// ============================================================

export function defaultCalendarCategory() {
  return {
    id: DEFAULT_CATEGORY_ID,
    name: 'General',
    color: '#6ea8fe',
    visible: true,

    // Future-proof sharing metadata.
    share: {
      enabled: false,
      mode: 'private',
      shareId: null,
      encrypted: true,
      members: [],
      role: 'owner',
      provider: null,
    },

    created: now(),
    updated: now(),
  };
}

export function sanitizeCalendarCategory(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id || '').trim();
  if (!id) return null;

  return cleanUndefined({
    id,
    name: String(raw.name || 'Calendar'),
    color: raw.color || '#6ea8fe',
    visible: raw.visible !== false,

    readonly: raw.readonly === true,
    source: sanitizeCalendarCategorySource(raw.source),

    share: {
      enabled: raw.share?.enabled === true,
      mode: raw.share?.mode || 'private',
      shareId: raw.share?.shareId || null,
      encrypted: raw.share?.encrypted !== false,
      members: Array.isArray(raw.share?.members)
        ? raw.share.members.map((m) => ({
            id: String(m.id || ''),
            name: String(m.name || ''),
            role: m.role || 'editor',
          }))
        : [],
      role: raw.share?.role || 'owner',
      provider: raw.share?.provider || null,
    },

    created: Number(raw.created || now()),
    updated: Number(raw.updated || now()),
  });
}

export function sanitizeCalendarEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id || '').trim();
  if (!id) return null;

  const start = isoOrNull(raw.start);
  if (!start) return null;

  return cleanUndefined({
    id,
    title: String(raw.title || 'Untitled event'),

    start,
    end: isoOrNull(raw.end),
    allDay: !!raw.allDay,

    categoryId: raw.categoryId || DEFAULT_CATEGORY_ID,
    color: raw.color || undefined,
    icon: raw.icon || undefined,

    location: raw.location || '',
    description: raw.description || '',

    noteId: raw.noteId || null,
    relatedNoteIds: Array.isArray(raw.relatedNoteIds)
      ? raw.relatedNoteIds.map(String)
      : [],

    tags: Array.isArray(raw.tags)
      ? raw.tags.map(String)
      : [],

    status: raw.status || 'confirmed',
    recurrence: raw.recurrence || null,

    reminders: Array.isArray(raw.reminders)
      ? raw.reminders
      : [],

    externalUid: raw.externalUid || '',

    created: Number(raw.created || now()),
    updated: Number(raw.updated || now()),
    createdBy: raw.createdBy || null,
    updatedBy: raw.updatedBy || null,
  });
}

export function ensureDefaultCalendarCategory() {
  if (state.calendarCategories.has(DEFAULT_CATEGORY_ID)) {
    return state.calendarCategories.get(DEFAULT_CATEGORY_ID);
  }

  const cat = defaultCalendarCategory();
  const doc = getVaultDoc();

  doc.transact(() => {
    vaultCalendarCategoriesMap().set(cat.id, safeJsonClone(cat));
    vaultTombstonesMap().delete(cat.id);
  }, ORIGIN);

  state.calendarCategories.set(cat.id, safeJsonClone(cat));

  return cat;
}

export function hydrateCalendarStateFromVault({
  silent = false,
} = {}) {
  const tombstones = vaultTombstonesMap();

  state.calendarEvents.clear();
  state.calendarCategories.clear();

  for (const [id, t] of tombstones) {
    if (t?.type === 'calendar-event') {
      state.calendarEvents.delete(id);
    }

    if (t?.type === 'calendar-category') {
      state.calendarCategories.delete(id);
    }
  }

  for (const [id, raw] of vaultCalendarCategoriesMap()) {
    if (tombstones.has(id)) continue;

    const cat = sanitizeCalendarCategory(raw);
    if (!cat) continue;

    state.calendarCategories.set(cat.id, safeJsonClone(cat));
  }

  ensureDefaultCalendarCategory();

  for (const [id, raw] of vaultEventsMap()) {
    if (tombstones.has(id)) continue;

    const ev = sanitizeCalendarEvent(raw);
    if (!ev) continue;

    state.calendarEvents.set(ev.id, safeJsonClone(ev));
  }

  calendarHydrated = true;

  if (!silent) {
    scheduleCalendarRender();

    window.dispatchEvent(new CustomEvent('yanta-calendar-updated'));
  }

  return {
    events: state.calendarEvents.size,
    categories: state.calendarCategories.size,
  };
}

// ============================================================
// Category CRUD
// ============================================================

export function putCalendarCategory(patch) {
  const existing = patch.id
    ? state.calendarCategories.get(patch.id)
    : null;

  const cat = sanitizeCalendarCategory({
    ...existing,
    ...patch,
    id: patch.id || 'cal_' + uid(),
    created: existing?.created || patch.created || now(),
    updated: now(),
  });

  if (!cat) return null;

  const doc = getVaultDoc();

  doc.transact(() => {
    vaultCalendarCategoriesMap().set(cat.id, safeJsonClone(cat));
    vaultTombstonesMap().delete(cat.id);
  }, ORIGIN);

  state.calendarCategories.set(cat.id, safeJsonClone(cat));

  scheduleCalendarRender();

  window.dispatchEvent(new CustomEvent('yanta-calendar-updated'));

  return cat;
}

export function deleteCalendarCategory(categoryId, {
  eventAction = 'move',
  targetCategoryId = DEFAULT_CATEGORY_ID,
} = {}) {
  const id = String(categoryId || '');

  if (!id || id === DEFAULT_CATEGORY_ID) return;

  const existing = state.calendarCategories.get(id);
  if (!existing) return;

  const eventsInCategory = [...state.calendarEvents.values()]
    .filter((ev) => ev.categoryId === id);

  const safeTargetId =
    targetCategoryId &&
    targetCategoryId !== id &&
    state.calendarCategories.has(targetCategoryId)
      ? targetCategoryId
      : DEFAULT_CATEGORY_ID;

  const doc = getVaultDoc();

  doc.transact(() => {
    if (eventAction === 'delete') {
      for (const ev of eventsInCategory) {
        vaultEventsMap().delete(ev.id);

        vaultTombstonesMap().set(ev.id, {
          id: ev.id,
          type: 'calendar-event',
          title: ev.title || '',
          deletedAt: now(),
        });
      }
    } else {
      for (const ev of eventsInCategory) {
        vaultEventsMap().set(ev.id, {
          ...safeJsonClone(ev),
          categoryId: safeTargetId,
          updated: now(),
        });
      }
    }

    vaultCalendarCategoriesMap().delete(id);

    vaultTombstonesMap().set(id, {
      id,
      type: 'calendar-category',
      name: existing.name || '',
      deletedAt: now(),
    });
  }, ORIGIN);

  state.calendarCategories.delete(id);

  if (eventAction === 'delete') {
    for (const ev of eventsInCategory) {
      state.calendarEvents.delete(ev.id);
    }
  } else {
    for (const ev of eventsInCategory) {
      ev.categoryId = safeTargetId;
      ev.updated = now();
      state.calendarEvents.set(ev.id, safeJsonClone(ev));
    }
  }

  scheduleCalendarRender();

  window.dispatchEvent(new CustomEvent('yanta-calendar-updated', {
    detail: {
      categoryId: id,
      categoryDeleted: true,
      eventAction,
      movedToCategoryId: eventAction === 'move' ? safeTargetId : null,
      count: eventsInCategory.length,
    },
  }));
}

function ensureCalendarCategoryDeleteModal() {
  if (calendarCategoryDeleteModal) return calendarCategoryDeleteModal;

  calendarCategoryDeleteModal = document.createElement('div');
  calendarCategoryDeleteModal.className = 'modal yanta-calendar-category-delete-modal';
  calendarCategoryDeleteModal.hidden = true;

  calendarCategoryDeleteModal.addEventListener('click', (e) => {
    if (e.target === calendarCategoryDeleteModal) {
      calendarCategoryDeleteModal.hidden = true;
    }

    if (e.target.closest?.('[data-category-delete-cancel]')) {
      calendarCategoryDeleteModal.hidden = true;
    }
  });

  document.body.append(calendarCategoryDeleteModal);

  return calendarCategoryDeleteModal;
}

function categoryMoveTargetOptionsHtml(deletedCategoryId, selectedId = DEFAULT_CATEGORY_ID) {
  return [...state.calendarCategories.values()]
    .filter((cat) => cat.id !== deletedCategoryId)
    .sort((a, b) => {
      if (a.id === DEFAULT_CATEGORY_ID) return -1;
      if (b.id === DEFAULT_CATEGORY_ID) return 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .map((cat) => `
      <option value="${escapeAttr(cat.id)}" ${cat.id === selectedId ? 'selected' : ''}>
        ${escapeHtml(cat.name || 'Calendar')}
      </option>
    `)
    .join('');
}

function openDeleteCalendarCategoryDialog(categoryId) {
  const cat = state.calendarCategories.get(categoryId);

  if (!cat || cat.id === DEFAULT_CATEGORY_ID) return Promise.resolve(null);

  const count = [...state.calendarEvents.values()]
    .filter((ev) => ev.categoryId === categoryId)
    .length;

  const fallbackTarget =
    state.calendarCategories.has(DEFAULT_CATEGORY_ID)
      ? DEFAULT_CATEGORY_ID
      : [...state.calendarCategories.keys()].find((id) => id !== categoryId) || '';

  let mode = count ? 'move' : 'delete';
  let targetCategoryId = fallbackTarget;

  const modal = ensureCalendarCategoryDeleteModal();

  return new Promise((resolve) => {
    const close = (value = null) => {
      modal.hidden = true;
      resolve(value);
    };

    const render = () => {
      const hasMoveTarget =
        [...state.calendarCategories.keys()].some((id) => id !== categoryId);

      modal.innerHTML = `
        <div class="modal-card yanta-calendar-category-delete-card">
          <header class="modal-head">
            <h3>Delete category</h3>
            <button class="icon-btn" data-category-delete-cancel>&times;</button>
          </header>

          <div class="modal-body yanta-calendar-category-delete-body">
            <div class="yanta-calendar-delete-warning">
              <strong>${escapeHtml(cat.name || 'Calendar')}</strong>
              contains ${count} event${count === 1 ? '' : 's'}.
            </div>

            ${
              count
                ? `
                  <label class="yanta-calendar-delete-choice">
                    <input
                      type="radio"
                      name="category-delete-mode"
                      value="move"
                      ${mode === 'move' ? 'checked' : ''}
                      ${hasMoveTarget ? '' : 'disabled'} />
                    <span>
                      <strong>Move events to another category</strong>
                      <small>Recommended. Events stay in your calendar.</small>
                    </span>
                  </label>

                  <label class="yanta-calendar-delete-choice">
                    <input
                      type="radio"
                      name="category-delete-mode"
                      value="delete"
                      ${mode === 'delete' ? 'checked' : ''} />
                    <span>
                      <strong>Delete all events in this category</strong>
                      <small>This moves the category’s events into calendar tombstones for sync.</small>
                    </span>
                  </label>

                  <label class="yanta-calendar-import-field ${mode !== 'move' ? 'is-disabled' : ''}">
                    <span>Target category</span>
                    <select
                      class="text-input"
                      data-category-delete-target
                      ${mode === 'move' && hasMoveTarget ? '' : 'disabled'}>
                      ${categoryMoveTargetOptionsHtml(categoryId, targetCategoryId)}
                    </select>
                  </label>
                `
                : `
                  <div class="yanta-calendar-import-note">
                    This category has no events. It can be deleted safely.
                  </div>
                `
            }

            <div class="compress-actions">
              <button class="btn" data-category-delete-cancel>Cancel</button>

              <button class="btn danger" data-category-delete-confirm>
                ${lucide('trash', 14)}
                Delete category
              </button>
            </div>
          </div>
        </div>
      `;

      modal.hidden = false;

      modal.querySelectorAll('input[name="category-delete-mode"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          mode = radio.value === 'delete' ? 'delete' : 'move';
          render();
        });
      });

      modal.querySelector('[data-category-delete-target]')?.addEventListener('change', (e) => {
        targetCategoryId = e.target.value || DEFAULT_CATEGORY_ID;
      });

      modal.querySelector('[data-category-delete-confirm]')?.addEventListener('click', () => {
        close({
          eventAction: count ? mode : 'delete',
          targetCategoryId,
        });
      });
    };

    render();
  });
}

// ============================================================
// Event CRUD
// ============================================================

export function putCalendarEvent(patch) {
  const existing = patch.id
    ? state.calendarEvents.get(patch.id)
    : null;

  const ev = sanitizeCalendarEvent({
    ...existing,
    ...patch,
    id: patch.id || 'evt_' + uid(),
    categoryId: patch.categoryId || existing?.categoryId || DEFAULT_CATEGORY_ID,
    created: existing?.created || patch.created || now(),
    updated: now(),
  });

  if (!ev) return null;

  const doc = getVaultDoc();

  doc.transact(() => {
    vaultEventsMap().set(ev.id, safeJsonClone(ev));
    vaultTombstonesMap().delete(ev.id);
  }, ORIGIN);

  state.calendarEvents.set(ev.id, safeJsonClone(ev));

if (ev.noteId && state.notes.has(ev.noteId)) {
  removeLegacyManagedEventBlocksFromNote(ev.noteId);

  if (state.currentNoteId === ev.noteId) {
    requestAnimationFrame(() => {
      renderCalendarNoteAttachments(ev.noteId);
    });
  }
}

if (existing?.noteId && existing.noteId !== ev.noteId && state.currentNoteId === existing.noteId) {
  requestAnimationFrame(() => {
    renderCalendarNoteAttachments(existing.noteId);
  });
}

  scheduleCalendarRender();

  if (calendarMode === 'pane') {
    requestAnimationFrame(() => {
      renderCalendarEvents();
    });
  }

  window.dispatchEvent(new CustomEvent('yanta-calendar-updated', {
    detail: { eventId: ev.id },
  }));

  return ev;
}

export function deleteCalendarEvent(eventId) {
  const id = String(eventId || '');
  if (!id) return;

  const existing = state.calendarEvents.get(id);
  const oldNoteId = existing?.noteId || null;

  const doc = getVaultDoc();

  doc.transact(() => {
    vaultEventsMap().delete(id);
    vaultTombstonesMap().set(id, {
      id,
      type: 'calendar-event',
      title: existing?.title || '',
      deletedAt: now(),
    });
  }, ORIGIN);

  state.calendarEvents.delete(id);

  if (oldNoteId && state.currentNoteId === oldNoteId) {
    requestAnimationFrame(() => {
      renderCalendarNoteAttachments(oldNoteId);
    });
  }

  scheduleCalendarRender();

  if (calendarMode === 'pane') {
    requestAnimationFrame(() => {
      renderCalendarEvents();
    });
  }

  window.dispatchEvent(new CustomEvent('yanta-calendar-updated', {
    detail: { eventId: id, deleted: true },
  }));
}

export async function putCalendarEventsBulk(rawEvents, {
  categoryId = DEFAULT_CATEGORY_ID,
  chunkSize = 300,
  onProgress = null,
} = {}) {
  const list = Array.isArray(rawEvents) ? rawEvents : [];

  if (!list.length) return 0;

  ensureDefaultCalendarCategory();

  let saved = 0;

  await withCalendarBatch(async () => {
    for (let i = 0; i < list.length; i += chunkSize) {
      const chunk = list.slice(i, i + chunkSize);
      const doc = getVaultDoc();

      doc.transact(() => {
        for (const raw of chunk) {
          const ev = sanitizeCalendarEvent({
            ...raw,
            id: raw.id && !state.calendarEvents.has(raw.id)
              ? raw.id
              : 'evt_' + uid(),
            categoryId: raw.categoryId || categoryId || DEFAULT_CATEGORY_ID,
            created: raw.created || now(),
            updated: now(),
          });

          if (!ev) continue;

          vaultEventsMap().set(ev.id, safeJsonClone(ev));
          vaultTombstonesMap().delete(ev.id);

          state.calendarEvents.set(ev.id, safeJsonClone(ev));
          saved++;
        }
      }, ORIGIN);

      onProgress?.({
        done: Math.min(i + chunk.length, list.length),
        total: list.length,
        saved,
      });

      await nextFrame();
    }
  });

  scheduleCalendarRender();

  window.dispatchEvent(new CustomEvent('yanta-calendar-updated', {
    detail: {
      bulk: true,
      count: saved,
    },
  }));

  return saved;
}

// ============================================================
// FullCalendar event conversion
// ============================================================

function categoryForEvent(ev) {
  return state.calendarCategories.get(ev.categoryId) ||
    state.calendarCategories.get(DEFAULT_CATEGORY_ID) ||
    defaultCalendarCategory();
}

function fullCalendarEventFromYanta(ev) {
  const colors = calendarEventColors(ev);

  return {
    id: ev.id,
    title: ev.title,
    start: ev.start,
    end: ev.end || undefined,
    allDay: !!ev.allDay,

    backgroundColor: colors.background,
    borderColor: colors.border,
    textColor: colors.text,

    editable: !calendarMobile(),
    startEditable: !calendarMobile(),
    durationEditable: !calendarMobile(),

    extendedProps: {
      yantaKind: 'event',
      raw: ev,
      noteId: ev.noteId || null,
      categoryId: ev.categoryId,
      eventIcon: calendarIconForEvent(ev),
    },
  };
}

function fullCalendarEventFromSourceEvent(ev) {
  const colors = calendarEventColors(ev);
  const kind = ev.source?.type === 'holidays'
    ? 'holiday'
    : 'calendar-source';

  return {
    id: ev.id,
    title: ev.title,
    start: ev.start,
    end: ev.end || undefined,
    allDay: !!ev.allDay,

    backgroundColor: colors.background,
    borderColor: colors.border,
    textColor: colors.text,

    editable: false,
    startEditable: false,
    durationEditable: false,

    classNames: [
      'yanta-cal-source-event',
      kind === 'holiday' ? 'yanta-cal-holiday-event' : '',
    ].filter(Boolean),

    extendedProps: {
      yantaKind: kind,
      raw: ev,
      categoryId: ev.categoryId,
      readonly: true,
      generated: true,
    },
  };
}

function fullCalendarEventFromMarkdownEvent(ev) {
  const note = ev.noteId ? state.notes.get(ev.noteId) : null;

  const rawColor =
    note?.color ||
    ev.color ||
    defaultEventColorForCategory(categoryForEvent(ev));

  const background = resolveCssColor(rawColor, cssVar('--accent', '#6ea8fe'));

  const text = readableTextColor(background);

  return {
    id: ev.id,
    title: ev.title,
    start: ev.start,
    end: ev.end || undefined,
    allDay: !!ev.allDay,

    backgroundColor: background,
    borderColor: background,
    textColor: text,

    editable: !calendarMobile(),
    startEditable: !calendarMobile(),
    durationEditable: !calendarMobile(),

    classNames: [
      'yanta-cal-markdown-event',
    ],

    extendedProps: {
      yantaKind: 'markdown-event',
      raw: ev,
      noteId: ev.noteId || null,
      noteIcon: note?.icon || (note?.type === 'list' ? 'list' : 'file-text'),
      noteColor: note?.color || '',
      sourceLine: ev.sourceLine,
      markdownRef: ev.markdownRef,
      derived: true,
    },
  };
}

function calendarEventContent(info) {
  const kind = info.event.extendedProps?.yantaKind;
  const raw = info.event.extendedProps?.raw;

  const wrap = document.createElement('span');
  wrap.className = 'yanta-cal-event-content';

  let dotColor =
    info.event.borderColor ||
    info.event.backgroundColor ||
    cssVar('--accent', '#6ea8fe');

  if (
    raw &&
    (
      kind === 'event' ||
      kind === 'markdown-event' ||
      kind === 'holiday' ||
      kind === 'calendar-source'
    )
  ) {
    if (kind === 'markdown-event') {
      const note = raw.noteId ? state.notes.get(raw.noteId) : null;

      dotColor =
        note?.color ||
        raw.color ||
        defaultEventColorForCategory(categoryForEvent(raw));
    } else {
      dotColor = calendarEventColors(raw).background;
    }
  }

  dotColor = resolveCssColor(dotColor, cssVar('--accent', '#6ea8fe'));

  wrap.style.setProperty('--yanta-cal-dot-color', dotColor);

  if (!info.event.allDay) {
    const dot = document.createElement('span');
    dot.className = 'yanta-cal-event-color-dot';
    dot.setAttribute('aria-hidden', 'true');
    wrap.append(dot);
  }

  if (info.timeText) {
    const timeSpan = document.createElement('span');
    timeSpan.className = 'yanta-cal-event-time';
    timeSpan.textContent = info.timeText;
    wrap.append(timeSpan);
  }

  if (kind === 'event' || kind === 'markdown-event') {
    const icon =
      kind === 'event'
        ? calendarIconForEvent(raw)
        : info.event.extendedProps?.noteIcon || 'file-text';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'yanta-cal-event-icon';
    iconSpan.innerHTML = lucide(icon, 12);

    wrap.append(iconSpan);
  }

  const titleSpan = document.createElement('span');
  titleSpan.className = 'yanta-cal-event-title';
  titleSpan.textContent = info.event.title || '(untitled)';

  wrap.append(titleSpan);

  return {
    domNodes: [wrap],
  };
}

function markdownForCalendarEvent(raw, fcEvent = null) {
  const allDay = !!(raw?.allDay ?? fcEvent?.allDay);

  const start = allDay
    ? (
        raw?.start
          ? localInputValue(raw.start, true)
          : localInputValue(fcEvent?.start, true)
      )
    : (
        raw?.start ||
        fcEvent?.start?.toISOString?.() ||
        new Date().toISOString()
      );

  const end = allDay
    ? (
        raw?.end
          ? localInputValue(raw.end, true)
          : null
      )
    : (
        raw?.end ||
        fcEvent?.end?.toISOString?.() ||
        null
      );

  const normalizedEnd = normalizeCalendarEventEnd({
    start,
    end,
    allDay,
  });

  const ev = {
    id: raw?.id || fcEvent?.id || '',
    title: raw?.title || fcEvent?.title || 'Untitled event',
    start,
    end: normalizedEnd,
    allDay,
    categoryId: raw?.categoryId || DEFAULT_CATEGORY_ID,
    location: raw?.location || '',
    description: raw?.description || '',
    status: raw?.status || 'confirmed',
    recurrence: raw?.recurrence || null,
    reminders: raw?.reminders || [],
    noteId: null,
  };

  return markdownLineForCalendarEvent(ev);
}

function bindCalendarEventDragToMarkdown(info) {
  if (!info?.el) return;

  const id = info.event?.id || '';

  if (id) {
    info.el.dataset.yantaEventId = id;
  }

  info.el.setAttribute('draggable', 'true');

  const startDrag = (e) => {
    const raw = info.event.extendedProps?.raw || state.calendarEvents.get(id) || {
      id,
      title: info.event.title,
      start: info.event.start?.toISOString?.(),
      end: info.event.end?.toISOString?.() || null,
      allDay: info.event.allDay,
      categoryId: info.event.extendedProps?.categoryId || DEFAULT_CATEGORY_ID,
      noteId: info.event.extendedProps?.noteId || null,
    };

    try {
      e.dataTransfer.setData('text/yanta-calendar-event', JSON.stringify({
        eventId: id,
        noteId: raw.noteId || info.event.extendedProps?.noteId || null,
        title: raw.title || info.event.title,
        start: raw.start || info.event.start?.toISOString?.() || null,
        end: raw.end || info.event.end?.toISOString?.() || null,
        allDay: !!(raw.allDay ?? info.event.allDay),
      }));

      /*
        Kein @due/@date Markdown mehr als text/plain.
        Der Editor verlinkt über text/yanta-calendar-event.
      */
      e.dataTransfer.setData('text/plain', raw.title || info.event.title || 'Calendar event');
      e.dataTransfer.effectAllowed = 'link';
    } catch (err) {
      console.warn('[YANTA Calendar] Could not prepare event drag', err);
    }
  };

  if (info.el.dataset.yantaDragBound !== '1') {
    info.el.dataset.yantaDragBound = '1';
    info.el.addEventListener('dragstart', startDrag, true);
  }
}

function installDelegatedCalendarEventDrag() {
  const root = $('calendar');
  if (!root || root.dataset.yantaCalDelegatedDrag === '1') return;

  root.dataset.yantaCalDelegatedDrag = '1';

  root.addEventListener('dragstart', (e) => {
    const eventEl = e.target?.closest?.('.fc-event[data-yanta-event-id], .fc-event');
    if (!eventEl || !root.contains(eventEl)) return;

    let id =
      eventEl.dataset?.yantaEventId ||
      eventEl.getAttribute?.('data-yanta-event-id') ||
      '';

    // Fallback: look upward/downward for our event id.
    if (!id) {
      id =
        eventEl.querySelector?.('[data-yanta-event-id]')?.dataset?.yantaEventId ||
        '';
    }

    if (!id || !fc) return;

    const fcEvent = fc.getEventById(id);
    if (!fcEvent) return;

    const raw = fcEvent.extendedProps?.raw || state.calendarEvents.get(id) || {
      id,
      title: fcEvent.title,
      start: fcEvent.start?.toISOString?.(),
      end: fcEvent.end?.toISOString?.() || null,
      allDay: fcEvent.allDay,
      categoryId: fcEvent.extendedProps?.categoryId || DEFAULT_CATEGORY_ID,
      noteId: fcEvent.extendedProps?.noteId || null,
    };

    try {
      e.dataTransfer.setData('text/yanta-calendar-event', JSON.stringify({
        eventId: id,
        noteId: raw.noteId || fcEvent.extendedProps?.noteId || null,
        title: raw.title || fcEvent.title,
        start: raw.start || fcEvent.start?.toISOString?.() || null,
        end: raw.end || fcEvent.end?.toISOString?.() || null,
        allDay: !!(raw.allDay ?? fcEvent.allDay),
      }));

      e.dataTransfer.setData('text/plain', raw.title || fcEvent.title || 'Calendar event');
      e.dataTransfer.effectAllowed = 'link';
    } catch (err) {
      console.warn('[YANTA Calendar] Could not start event drag', err);
    }
  }, true);
}

function calendarEventRawForDrag(fcEvent) {
  if (!fcEvent) return null;

  return fcEvent.extendedProps?.raw ||
    state.calendarEvents.get(fcEvent.id) ||
    {
      id: fcEvent.id,
      title: fcEvent.title || 'Untitled event',
      start: fcEvent.start?.toISOString?.() || new Date().toISOString(),
      end: fcEvent.end?.toISOString?.() || null,
      allDay: !!fcEvent.allDay,
      categoryId: fcEvent.extendedProps?.categoryId || DEFAULT_CATEGORY_ID,
      noteId: fcEvent.extendedProps?.noteId || null,
      location: '',
      description: '',
      status: 'confirmed',
      recurrence: null,
      reminders: [],
    };
}

function nearestCalendarEventElement(target) {
  const el = target?.closest?.('.fc-event[data-yanta-event-id], .fc-event');

  if (!el) return null;

  // Ignore FullCalendar mirror/helper artifacts.
  if (
    el.classList.contains('fc-event-mirror') ||
    el.classList.contains('fc-event-dragging') ||
    el.closest('.fc-event-mirror')
  ) {
    return null;
  }

  return el;
}

function eventIdFromCalendarEventElement(eventEl) {
  if (!eventEl) return '';

  return (
    eventEl.dataset?.yantaEventId ||
    eventEl.getAttribute?.('data-yanta-event-id') ||
    eventEl.querySelector?.('[data-yanta-event-id]')?.dataset?.yantaEventId ||
    ''
  );
}

function pointInsideRect(x, y, rect, pad = 0) {
  return (
    x >= rect.left - pad &&
    x <= rect.right + pad &&
    y >= rect.top - pad &&
    y <= rect.bottom + pad
  );
}

function pointOverEditor(clientX, clientY) {
  const paneEdit = $('paneEdit');
  if (!paneEdit) return false;

  const hit = document.elementFromPoint(clientX, clientY);

  return !!hit && paneEdit.contains(hit);
}

function createCalendarExternalDragGhost(d) {
  const rect = d.eventEl.getBoundingClientRect();
  const ghost = d.eventEl.cloneNode(true);

  ghost.classList.add('yanta-cal-external-drag-ghost');
  ghost.setAttribute('aria-hidden', 'true');

  ghost.style.position = 'fixed';
  ghost.style.left = '0';
  ghost.style.top = '0';
  ghost.style.width = `${Math.max(1, rect.width)}px`;
  ghost.style.height = `${Math.max(1, rect.height)}px`;
  ghost.style.margin = '0';
  ghost.style.zIndex = '99999';
  ghost.style.pointerEvents = 'none';
  ghost.style.opacity = '0.94';
  ghost.style.willChange = 'transform';
  ghost.style.transform = `translate3d(${d.lastX - rect.width / 2}px, ${d.lastY - rect.height / 2}px, 0)`;

  document.body.append(ghost);

  d.ghost = ghost;
  d.ghostWidth = Math.max(1, rect.width);
  d.ghostHeight = Math.max(1, rect.height);
}

function updateCalendarExternalDragGhost(d, clientX, clientY) {
  if (!d?.ghost) return;

  const w = d.ghostWidth || 1;
  const h = d.ghostHeight || 1;

  d.ghost.style.transform = `translate3d(${clientX - w / 2}px, ${clientY - h / 2}px, 0)`;
}

function beginCalendarExternalEventDrag(d, originalEvent) {
  if (!d || d.mode !== 'pending') return;

  d.mode = 'external';

  calendarExternalEventSuppressClickUntil = performance.now() + 1200;

  // Hide original FullCalendar event while our external ghost is active.
  // Otherwise users see the source event + our ghost + sometimes FC mirror.
  try {
    d.eventEl?.classList.add('yanta-cal-external-source');
  } catch {}

  cleanupFullCalendarDragArtifacts();

  document.documentElement.classList.add('yanta-cal-external-dragging');

  try {
    fc?.unselect?.();
  } catch {}

  suppressCalendarSelectionFor(1200);

  createCalendarExternalDragGhost(d);
  updateCalendarExternalDragGhost(d, d.lastX, d.lastY);

  if (originalEvent?.cancelable) {
    originalEvent.preventDefault();
  }

  originalEvent?.stopPropagation?.();
  originalEvent?.stopImmediatePropagation?.();
}

async function finishCalendarExternalEventDrag(d, originalEvent, {
  cancelled = false,
} = {}) {
  try {
    if (d?.mode === 'external') {
      if (originalEvent?.cancelable) {
        originalEvent.preventDefault();
      }

      originalEvent?.stopPropagation?.();
      originalEvent?.stopImmediatePropagation?.();

      let linked = false;

      if (
        !cancelled &&
        d.raw?.id &&
        state.currentNoteId &&
        pointOverEditor(d.lastX, d.lastY)
      ) {
        linked = await linkCalendarEventToNote(d.raw.id, state.currentNoteId, {
          ask: true,
        });
      }

      if (linked) {
        window.dispatchEvent(new CustomEvent('yanta-calendar-event-linked-to-note', {
          detail: {
            eventId: d.raw.id,
            noteId: state.currentNoteId,
          },
        }));

        scheduleCalendarRender();
      }
    }
  } finally {
    try {
      d?.ghost?.remove();
    } catch {}

    try {
      d?.eventEl?.classList.remove('yanta-cal-external-source');
    } catch {}

    document.documentElement.classList.remove('yanta-cal-external-dragging');

    calendarExternalEventDrag = null;

    cleanupFullCalendarDragArtifacts();

    requestAnimationFrame(() => {
      cleanupFullCalendarDragArtifacts();
    });
  }
}

function installPointerCalendarEventExternalDrag() {
  const root = $('calendar');

  if (!root || calendarExternalEventDragInstalled) return;

  calendarExternalEventDragInstalled = true;

  root.addEventListener('pointerdown', (e) => {
    if (!fc) return;
    if (e.button != null && e.button !== 0) return;

    // This is desktop/mouse behavior. Touch has separate mobile calendar logic.
    if (e.pointerType && e.pointerType !== 'mouse') return;

    const eventEl = nearestCalendarEventElement(e.target);
    if (!eventEl || !root.contains(eventEl)) return;

    const eventId = eventIdFromCalendarEventElement(eventEl);
    if (!eventId) return;

    const fcEvent = fc.getEventById(eventId);
    if (!fcEvent) return;

    if (fcEvent.extendedProps?.yantaKind !== 'event') return;

    const raw = calendarEventRawForDrag(fcEvent);
    if (!raw?.id) return;

    calendarExternalEventDrag = {
      pointerId: e.pointerId,
      mode: 'pending',

      eventEl,
      eventId,
      fcEvent,
      raw,

      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,

      ghost: null,
      ghostWidth: 0,
      ghostHeight: 0,

      startedAt: performance.now(),
    };

    // Do NOT preventDefault here.
    // This allows normal click and FullCalendar internal drag to still work.
  }, true);

  document.addEventListener('pointermove', (e) => {
    const d = calendarExternalEventDrag;
    if (!d) return;
    if (d.pointerId !== e.pointerId) return;

    d.lastX = e.clientX;
    d.lastY = e.clientY;

    const moved = Math.hypot(
      e.clientX - d.startX,
      e.clientY - d.startY
    );

    if (d.mode === 'pending') {
      if (moved < 7) return;

      const rect = root.getBoundingClientRect();

      const outsideCalendar = !pointInsideRect(e.clientX, e.clientY, rect, 4);
      const overEditor = pointOverEditor(e.clientX, e.clientY);

      // While still inside the calendar, let FullCalendar handle normal
      // event drag/drop. YANTA only takes over once the user drags outward.
      if (!outsideCalendar && !overEditor) {
        return;
      }

      beginCalendarExternalEventDrag(d, e);
    }

    if (d.mode === 'external') {
      if (e.cancelable) {
        e.preventDefault();
      }

      e.stopPropagation();
      e.stopImmediatePropagation();

      updateCalendarExternalDragGhost(d, e.clientX, e.clientY);
    }
  }, {
    capture: true,
    passive: false,
  });

  document.addEventListener('pointerup', (e) => {
    const d = calendarExternalEventDrag;
    if (!d) return;
    if (d.pointerId !== e.pointerId) return;

    d.lastX = e.clientX;
    d.lastY = e.clientY;

    if (d.mode === 'external') {
      finishCalendarExternalEventDrag(d, e);
      return;
    }

    calendarExternalEventDrag = null;
  }, {
    capture: true,
    passive: false,
  });

  document.addEventListener('pointercancel', (e) => {
    const d = calendarExternalEventDrag;
    if (!d) return;
    if (d.pointerId !== e.pointerId) return;

    finishCalendarExternalEventDrag(d, e, {
      cancelled: true,
    });
  }, {
    capture: true,
    passive: false,
  });
}

// ============================================================
// Derived calendar events from Markdown
// ============================================================

export function derivedEventsFromTasksAndNotes() {
  const out = [];

  for (const note of state.notes.values()) {
    let md = '';

    try {
      md = noteMarkdown(note.id);
    } catch {
      continue;
    }

    const refs = parseMarkdownCalendarRefs(md, note);

    for (const ev of refs) {
      out.push(fullCalendarEventFromMarkdownEvent(ev));
    }
  }

  return out;
}

// ============================================================
// Rendering
// ============================================================

function eventIntersectsRange(raw, rangeStart, rangeEnd) {
  if (!raw?.start) return false;

  const startDate = dateLikeToLocalDate(raw.start);
  if (!startDate) return false;

  const startMs = startDate.getTime();

  let endMs;

  if (raw.end) {
    const endDate = dateLikeToLocalDate(raw.end);
    endMs = endDate?.getTime();
  } else {
    endMs = startMs + (raw.allDay ? 86400000 : 1);
  }

  if (!Number.isFinite(endMs)) {
    endMs = startMs + (raw.allDay ? 86400000 : 1);
  }

  return endMs > rangeStart && startMs < rangeEnd;
}

function fcEventIntersectsRange(ev, rangeStart, rangeEnd) {
  if (!ev?.start) return false;

  const startDate = dateLikeToLocalDate(ev.start);
  if (!startDate) return false;

  const startMs = startDate.getTime();

  let endMs;

  if (ev.end) {
    const endDate = dateLikeToLocalDate(ev.end);
    endMs = endDate?.getTime();
  } else {
    endMs = startMs + (ev.allDay ? 86400000 : 1);
  }

  if (!Number.isFinite(endMs)) {
    endMs = startMs + (ev.allDay ? 86400000 : 1);
  }

  return endMs > rangeStart && startMs < rangeEnd;
}

function buildFullCalendarEventsForRange(start, end) {
  const rangeStart = start instanceof Date
    ? start.getTime()
    : new Date(start).getTime();

  const rangeEnd = end instanceof Date
    ? end.getTime()
    : new Date(end).getTime();

  const out = [];

  for (const ev of state.calendarEvents.values()) {
    const cat = categoryForEvent(ev);

    if (cat.visible === false) continue;
    if (ev.status === 'cancelled') continue;
    if (!eventIntersectsRange(ev, rangeStart, rangeEnd)) continue;

    out.push(fullCalendarEventFromYanta(ev));
  }

  for (const ev of sourceEventsForRange(
    [...state.calendarCategories.values()],
    start,
    end
  )) {
    out.push(fullCalendarEventFromSourceEvent(ev));
  }

  for (const ev of derivedEventsFromTasksAndNotes()) {
    if (!fcEventIntersectsRange(ev, rangeStart, rangeEnd)) continue;

    out.push(ev);
  }

  return out;
}

export function renderCalendarEvents() {
  if (!fc) return;
  if (!calendarSurfaceVisible()) return;

  applyCalendarThemeIfChanged();

  invalidateCalendarSwipeCache();

  try {
    fc.refetchEvents();
  } catch {}

  scheduleCalendarSwipePrewarm();
}

function currentEventsForCategory(categoryId = null) {
  return [...state.calendarEvents.values()]
    .filter((ev) => !categoryId || ev.categoryId === categoryId)
    .filter((ev) => ev.status !== 'cancelled');
}

// ============================================================
// Import / Export
// ============================================================

// ============================================================
// Calendar import UX — category selection, date filter, storage estimate,
// dedupe into existing category.
// ============================================================

const CALENDAR_IMPORT_DEFAULT_COLOR = '#6ea8fe';

function calendarJsonEventsFromPayload(json) {
  return Array.isArray(json)
    ? json
    : Array.isArray(json?.events)
      ? json.events
      : [];
}

function calendarImportEventStartMs(ev) {
  if (!ev?.start) return NaN;

  const d = dateLikeToLocalDate(ev.start);
  return d ? d.getTime() : NaN;
}

function parseCalendarImportCutoffInput(value) {
  const raw = String(value || '').trim();

  if (!raw) return null;

  // datetime-local gives YYYY-MM-DDTHH:mm
  // text fallback also accepts YYYY-MM-DD HH:mm
  const normalized = raw.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/,
    '$1T$2'
  );

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const d = new Date(`${normalized}T00:00:00`);
    const t = d.getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  const d = new Date(normalized);
  const t = d.getTime();

  return Number.isFinite(t) ? t : NaN;
}

function filterCalendarEventsByImportCutoff(events, cutoffMs) {
  if (cutoffMs == null) return events || [];

  return (events || []).filter((ev) => {
    const startMs = calendarImportEventStartMs(ev);
    return Number.isFinite(startMs) && startMs >= cutoffMs;
  });
}

function formatCalendarImportBytes(bytes) {
  const n = Number(bytes || 0);

  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;

  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function estimateCalendarImportBytes(events = [], {
  category = null,
} = {}) {
  /*
    Approximation:
    - JSON representation is close to VaultDoc metadata size.
    - Add a small overhead factor for Yjs update encoding/encryption/sync metadata.
    - This intentionally errs slightly high for SaaS UX.
  */
  const payload = {
    events,
    category,
  };

  const raw = new TextEncoder().encode(JSON.stringify(payload)).byteLength;

  return Math.ceil(raw * 1.35 + 2048);
}

async function getCalendarImportStorageInfo() {
  let browser = null;

  try {
    const est = await navigator.storage?.estimate?.();

    if (est?.quota) {
      const quota = Number(est.quota || 0);
      const used = Number(est.usage || 0);
      browser = {
        source: 'Browser storage',
        quota,
        used,
        available: Math.max(0, quota - used),
      };
    }
  } catch {}

  let cloud = null;

  try {
    const provider = await store.settings.get('sync2.provider', null);

    if (provider === 'yanta-cloud') {
      const { cloudMe } = await import('./cloud/cloud-api.js');
      const me = await cloudMe();

      const used = Number(me?.usage?.storage_bytes || 0);
      const quota = Number(me?.limits?.storageBytes || 0);

      if (quota > 0) {
        cloud = {
          source: 'YANTA Cloud storage',
          quota,
          used,
          available: Math.max(0, quota - used),
        };
      }
    }
  } catch {}

  /*
    If YANTA Cloud is active, the cloud plan is usually the stricter quota.
    If both exist, enforce the smaller free space.
  */
  if (browser && cloud) {
    return cloud.available <= browser.available ? cloud : browser;
  }

  return cloud || browser || {
    source: 'Storage',
    quota: 0,
    used: 0,
    available: Infinity,
  };
}

function storageBarHtml({ used = 0, quota = 0, importBytes = 0 } = {}) {
  const q = Number(quota || 0);
  const u = Math.max(0, Number(used || 0));
  const imp = Math.max(0, Number(importBytes || 0));

  if (!q || !Number.isFinite(q)) {
    return `
      <div class="yanta-calendar-import-storage-unknown">
        Storage quota unavailable in this browser.
      </div>
    `;
  }

  const usedPct = Math.max(0, Math.min(100, (u / q) * 100));
  const importPct = Math.max(0, Math.min(100, (imp / q) * 100));
  const overPct = Math.max(0, usedPct + importPct - 100);
  const remainingPct = Math.max(0, 100 - usedPct - importPct);

  return `
    <div
      class="yanta-calendar-import-storage-bar ${overPct > 0 ? 'over' : ''}"
      aria-label="Storage usage">
      <span
        class="used"
        style="--segment-pct:${usedPct}%"
        title="Currently used: ${escapeAttr(formatCalendarImportBytes(u))}">
      </span>

      <span
        class="import"
        style="--segment-pct:${Math.max(0, importPct - overPct)}%"
        title="Estimated import: ${escapeAttr(formatCalendarImportBytes(imp))}">
      </span>

      ${
        overPct > 0
          ? `
            <span
              class="over"
              style="--segment-pct:${overPct}%"
              title="Exceeds available storage">
            </span>
          `
          : ''
      }

      <span
        class="remaining"
        style="--segment-pct:${remainingPct}%"
        title="Remaining after import">
      </span>
    </div>
  `;
}

function calendarImportDedupeKey(ev) {
  const uid = String(ev?.externalUid || '').trim().toLowerCase();

  if (uid) {
    return `uid:${uid}`;
  }

  const title = String(ev?.title || '').trim().toLowerCase();
  const start = String(ev?.start || '').trim();
  const end = String(ev?.end || '').trim();
  const allDay = ev?.allDay ? '1' : '0';
  const location = String(ev?.location || '').trim().toLowerCase();

  return [
    'sig',
    title,
    start,
    end,
    allDay,
    location,
  ].join('|');
}

function dedupeCalendarImportEvents(events, categoryId) {
  const existingKeys = new Set();

  for (const ev of state.calendarEvents.values()) {
    if (!ev || ev.status === 'cancelled') continue;
    if (categoryId && ev.categoryId !== categoryId) continue;

    existingKeys.add(calendarImportDedupeKey(ev));
  }

  const batchKeys = new Set();
  const out = [];

  let skippedExisting = 0;
  let skippedBatch = 0;

  for (const raw of events || []) {
    const key = calendarImportDedupeKey(raw);

    if (existingKeys.has(key)) {
      skippedExisting++;
      continue;
    }

    if (batchKeys.has(key)) {
      skippedBatch++;
      continue;
    }

    batchKeys.add(key);
    out.push(raw);
  }

  return {
    events: out,
    skippedExisting,
    skippedBatch,
    skippedTotal: skippedExisting + skippedBatch,
  };
}

function findCalendarCategoryByName(name) {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean) return null;

  return [...state.calendarCategories.values()]
    .find((cat) => String(cat.name || '').trim().toLowerCase() === clean) || null;
}

function categoryOptionsHtmlForImport(selectedId) {
  ensureDefaultCalendarCategory();

  return [...state.calendarCategories.values()]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .map((cat) => `
      <option value="${escapeAttr(cat.id)}" ${cat.id === selectedId ? 'selected' : ''}>
        ${escapeHtml(cat.name || 'Calendar')}
      </option>
    `)
    .join('');
}

function ensureCalendarImportModal() {
  if (calendarImportModal) return calendarImportModal;

  calendarImportModal = document.createElement('div');
  calendarImportModal.className = 'modal yanta-calendar-import-modal';
  calendarImportModal.hidden = true;

  calendarImportModal.addEventListener('click', (e) => {
    if (e.target === calendarImportModal) {
      calendarImportModal.hidden = true;
    }

    if (e.target.closest?.('[data-calendar-import-cancel]')) {
      calendarImportModal.hidden = true;
    }
  });

  document.body.append(calendarImportModal);

  return calendarImportModal;
}

function localTodayDateInputValue() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function openCalendarImportOptions({
  filename = '',
  fileSize = 0,
  rawEvents = [],
  forcedCategoryId = null,
} = {}) {
  ensureDefaultCalendarCategory();

  const modal = ensureCalendarImportModal();
  const storage = await getCalendarImportStorageInfo();

  const initialCategoryId =
    forcedCategoryId ||
    state.calendarCategories.get(DEFAULT_CATEGORY_ID)?.id ||
    [...state.calendarCategories.keys()][0] ||
    DEFAULT_CATEGORY_ID;

  const importName = filename
    .replace(/\.calendar\.json$/i, '')
    .replace(/\.(ics|json)$/i, '')
    .trim() || 'Imported calendar';

  let ui = {
    categoryMode: forcedCategoryId ? 'existing' : 'existing',
    categoryId: initialCategoryId,
    newCategoryName: importName,
    newCategoryColor: CALENDAR_IMPORT_DEFAULT_COLOR,
    cutoffValue: '',
  };

  return new Promise((resolve) => {
    const close = (value = null) => {
      modal.hidden = true;
      resolve(value);
    };

    const computePlan = () => {
      const cutoffMs = parseCalendarImportCutoffInput(ui.cutoffValue);

      const cutoffInvalid =
        String(ui.cutoffValue || '').trim() &&
        !Number.isFinite(cutoffMs);

      const filtered = cutoffInvalid
        ? []
        : filterCalendarEventsByImportCutoff(
            rawEvents,
            cutoffMs == null ? null : cutoffMs
          );

      let targetCategoryId = ui.categoryId || DEFAULT_CATEGORY_ID;
      let categoryPatch = null;
      let sameNameCategory = null;

      if (ui.categoryMode === 'new') {
        sameNameCategory = findCalendarCategoryByName(ui.newCategoryName);

        if (sameNameCategory) {
          targetCategoryId = sameNameCategory.id;
        } else {
          targetCategoryId = '';
          categoryPatch = {
            name: String(ui.newCategoryName || '').trim() || importName || 'Imported calendar',
            color: ui.newCategoryColor || CALENDAR_IMPORT_DEFAULT_COLOR,
            visible: true,
          };
        }
      }

      const dedupeTargetId = targetCategoryId || null;

      const deduped = dedupeTargetId
        ? dedupeCalendarImportEvents(filtered, dedupeTargetId)
        : dedupeCalendarImportEvents(filtered, null);

      const estimatedBytes = estimateCalendarImportBytes(deduped.events, {
        category: categoryPatch,
      });

      const exceedsStorage =
        Number.isFinite(storage.available) &&
        estimatedBytes > storage.available;

      const canImport =
        !cutoffInvalid &&
        deduped.events.length > 0 &&
        !exceedsStorage;

      return {
        cutoffMs,
        cutoffInvalid,
        filtered,
        deduped,
        targetCategoryId,
        categoryPatch,
        sameNameCategory,
        estimatedBytes,
        exceedsStorage,
        canImport,
      };
    };

    const render = () => {
      const plan = computePlan();

      const quotaKnown =
        storage.quota &&
        Number.isFinite(storage.quota);

      modal.innerHTML = `
        <div class="modal-card yanta-calendar-import-card">
          <header class="modal-head">
            <h3>Import calendar</h3>
            <button class="icon-btn" data-calendar-import-cancel>&times;</button>
          </header>

          <div class="modal-body yanta-calendar-import-body">
            <div class="yanta-calendar-import-hero">
              <span class="yanta-calendar-import-hero-icon">
                ${lucide('calendar-plus', 24)}
              </span>

              <div>
                <strong>${escapeHtml(filename || 'Calendar file')}</strong>
                <p>
                  ${rawEvents.length} event${rawEvents.length === 1 ? '' : 's'} found
                  ${fileSize ? ` · source file ${escapeHtml(formatCalendarImportBytes(fileSize))}` : ''}
                </p>
              </div>
            </div>

            <section class="yanta-calendar-import-section">
              <h4>Import range</h4>

              <label class="yanta-calendar-import-field">
                <span>Only import events from</span>

                <div class="yanta-calendar-import-date-row">
                  <input
                    class="text-input"
                    data-import-cutoff
                    type="datetime-local"
                    value="${escapeAttr(ui.cutoffValue)}" />

                  <button class="btn" type="button" data-import-today>
                    Today
                  </button>

                  <button class="btn" type="button" data-import-clear-date>
                    All
                  </button>
                </div>

                <small>
                  Leave empty to import all events. Events before this date/time are skipped.
                </small>

                ${
                  plan.cutoffInvalid
                    ? `<div class="yanta-calendar-import-error">Invalid date/time.</div>`
                    : ''
                }
              </label>
            </section>

            <section class="yanta-calendar-import-section">
              <h4>Category</h4>

              <div class="yanta-calendar-import-tabs" role="tablist">
                <button
                  type="button"
                  class="${ui.categoryMode === 'existing' ? 'active' : ''}"
                  data-import-category-mode="existing">
                  Existing category
                </button>

                <button
                  type="button"
                  class="${ui.categoryMode === 'new' ? 'active' : ''}"
                  data-import-category-mode="new">
                  New category
                </button>
              </div>

              ${
                ui.categoryMode === 'existing'
                  ? `
                    <label class="yanta-calendar-import-field">
                      <span>Import into</span>
                      <select class="text-input" data-import-category>
                        ${categoryOptionsHtmlForImport(ui.categoryId)}
                      </select>
                      <small>Matching events already in this category are skipped.</small>
                    </label>
                  `
                  : `
                    <div class="yanta-calendar-import-new-category">
                      <label class="yanta-calendar-import-field">
                        <span>Category name</span>
                        <input
                          class="text-input"
                          data-import-new-category-name
                          value="${escapeAttr(ui.newCategoryName)}"
                          placeholder="Imported calendar" />
                      </label>

                      <label class="yanta-calendar-import-color-field">
                        <span>Color</span>
                        <input
                          type="color"
                          data-import-new-category-color
                          value="${escapeAttr(ui.newCategoryColor || CALENDAR_IMPORT_DEFAULT_COLOR)}" />
                      </label>
                    </div>

                    ${
                      plan.sameNameCategory
                        ? `
                          <div class="yanta-calendar-import-note">
                            A category named “${escapeHtml(plan.sameNameCategory.name)}” already exists.
                            YANTA will import into that existing category and deduplicate there.
                          </div>
                        `
                        : ''
                    }
                  `
              }
            </section>

            <section class="yanta-calendar-import-section">
              <h4>Storage estimate</h4>

              <div class="yanta-calendar-import-storage-head">
                <span>
                  Estimated import:
                  <strong>${escapeHtml(formatCalendarImportBytes(plan.estimatedBytes))}</strong>
                </span>

                <span>
                  ${escapeHtml(storage.source)}
                  ${
                    quotaKnown
                      ? ` · free ${escapeHtml(formatCalendarImportBytes(storage.available))}`
                      : ''
                  }
                </span>
              </div>

              ${storageBarHtml({
                used: storage.used,
                quota: storage.quota,
                importBytes: plan.estimatedBytes,
              })}

              <div class="yanta-calendar-import-summary">
                <span>
                  ${plan.filtered.length}/${rawEvents.length}
                  event${plan.filtered.length === 1 ? '' : 's'} after date filter
                </span>

                <span>
                  ${plan.deduped.skippedTotal}
                  duplicate${plan.deduped.skippedTotal === 1 ? '' : 's'} skipped
                </span>

                <span>
                  <strong>${plan.deduped.events.length}</strong>
                  will be imported
                </span>
              </div>

              ${
                plan.exceedsStorage
                  ? `
                    <div class="yanta-calendar-import-error">
                      Import is larger than available ${escapeHtml(storage.source.toLowerCase())}.
                      Free up storage or choose a later import date.
                    </div>
                  `
                  : ''
              }
            </section>

            <div class="compress-actions yanta-calendar-import-actions">
              <button class="btn" data-calendar-import-cancel>Cancel</button>

              <button
                class="btn primary"
                data-calendar-import-confirm
                ${plan.canImport ? '' : 'disabled'}>
                ${lucide('upload', 14)}
                Import ${plan.deduped.events.length} event${plan.deduped.events.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      `;

      modal.hidden = false;

      modal.querySelector('[data-import-cutoff]')?.addEventListener('change', (e) => {
        ui.cutoffValue = e.target.value || '';
        render();
      });

      modal.querySelector('[data-import-today]')?.addEventListener('click', () => {
        ui.cutoffValue = `${localTodayDateInputValue()}T00:00`;
        render();
      });

      modal.querySelector('[data-import-clear-date]')?.addEventListener('click', () => {
        ui.cutoffValue = '';
        render();
      });

      modal.querySelectorAll('[data-import-category-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          ui.categoryMode = btn.dataset.importCategoryMode || 'existing';
          render();
        });
      });

      modal.querySelector('[data-import-category]')?.addEventListener('change', (e) => {
        ui.categoryId = e.target.value || DEFAULT_CATEGORY_ID;
        render();
      });

      modal.querySelector('[data-import-new-category-name]')?.addEventListener('input', (e) => {
        ui.newCategoryName = e.target.value || '';
        render();
      });

      modal.querySelector('[data-import-new-category-color]')?.addEventListener('input', (e) => {
        ui.newCategoryColor = e.target.value || CALENDAR_IMPORT_DEFAULT_COLOR;
        render();
      });

      modal.querySelector('[data-calendar-import-confirm]')?.addEventListener('click', () => {
        const finalPlan = computePlan();

        if (!finalPlan.canImport) return;

        let categoryId = finalPlan.targetCategoryId;

        if (!categoryId && finalPlan.categoryPatch) {
          const cat = putCalendarCategory(finalPlan.categoryPatch);
          categoryId = cat?.id || DEFAULT_CATEGORY_ID;
        }

        const eventsToImport = finalPlan.deduped.events.map((ev) => ({
          ...ev,
          categoryId,
        }));

        close({
          categoryId,
          eventsToImport,
          skippedDuplicates: finalPlan.deduped.skippedTotal,
          estimatedBytes: finalPlan.estimatedBytes,
        });
      });
    };

    render();
  });
}

function openCalendarImportPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ics,.json,.calendar.json,text/calendar,application/json';
  input.multiple = true;

  input.onchange = async () => {
    const files = [...(input.files || [])];

    for (const file of files) {
      try {
        await importCalendarFile(file);
      } catch (err) {
        console.error(err);
        toast(`Calendar import failed: ${err?.message || file.name}`, 'error');
      }
    }
  };

  input.click();
}

export async function importCalendarFile(file, {
  categoryId = null,
} = {}) {
  if (!file) return;

  const lower = file.name.toLowerCase();

  if (lower.endsWith('.ics')) {
    toast('Reading ICS…');

    const text = await file.text();
    const parsedEvents = parseIcsEvents(text);

    if (!parsedEvents.length) {
      toast('No VEVENT entries found', 'error');
      return;
    }

    const plan = await openCalendarImportOptions({
      filename: file.name,
      fileSize: file.size || text.length || 0,
      rawEvents: parsedEvents,
      forcedCategoryId: categoryId,
    });

    if (!plan) return;

    const count = await putCalendarEventsBulk(plan.eventsToImport, {
      categoryId: plan.categoryId,
      chunkSize: 300,
      onProgress: ({ done, total }) => {
        if (done === total || done % 900 === 0) {
          toast(`Importing calendar… ${done}/${total}`, 'success');
        }
      },
    });

    toast(
      `Imported ${count} event${count === 1 ? '' : 's'}${
        plan.skippedDuplicates
          ? ` · ${plan.skippedDuplicates} duplicate${plan.skippedDuplicates === 1 ? '' : 's'} skipped`
          : ''
      }`,
      'success'
    );

    return;
  }

  if (lower.endsWith('.json')) {
    const text = await file.text();
    const json = JSON.parse(text);

    await importCalendarJson(json, {
      categoryId,
      filename: file.name,
      fileSize: file.size || text.length || 0,
    });

    return;
  }

  throw new Error('Unsupported calendar file');
}

export async function importCalendarJson(json, {
  categoryId = null,
  filename = 'calendar.json',
  fileSize = 0,
} = {}) {
  const events = calendarJsonEventsFromPayload(json);

  if (!events.length) {
    toast('No calendar events found in JSON', 'error');
    return;
  }

  const plan = await openCalendarImportOptions({
    filename,
    fileSize,
    rawEvents: events,
    forcedCategoryId: categoryId,
  });

  if (!plan) return;

  const count = await putCalendarEventsBulk(plan.eventsToImport, {
    categoryId: plan.categoryId,
    chunkSize: 300,
  });

  toast(
    `Imported ${count} event${count === 1 ? '' : 's'}${
      plan.skippedDuplicates
        ? ` · ${plan.skippedDuplicates} duplicate${plan.skippedDuplicates === 1 ? '' : 's'} skipped`
        : ''
    }`,
    'success'
  );
}

export function exportCalendarJson({
  categoryId = null,
  filename = 'yanta-calendar.calendar.json',
} = {}) {
  const events = currentEventsForCategory(categoryId);
  const categories = categoryId
    ? [state.calendarCategories.get(categoryId)].filter(Boolean)
    : [...state.calendarCategories.values()];

  const payload = {
    yantaCalendar: 1,
    exported: new Date().toISOString(),
    categories,
    events,
  };

  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    safeFilename(filename)
  );
}

// ============================================================
// Event notes — virtual note attachments
// ============================================================

const LEGACY_EVENT_NOTE_BLOCK_RE =
  /<!-- yanta:event-note v1 eventId=[^\n]* -->[\s\S]*?<!-- \/yanta:event-note -->/g;

function formatEventRangeForAttachment(ev) {
  if (!ev?.start) return '';

  const start = formatCalendarDateTime(ev.start, {
    allDay: !!ev.allDay,
    editor: true,
    includeWeekday: true,
  });

  if (!ev.end) return start;

  const sameDay = sameLocalDay(ev.start, ev.end);

  /*
    Same day with explicit times:
    Samstag, 30. Mai 2026 14:00 – 15:00
  */
  if (!ev.allDay && sameDay) {
    return `${start} – ${formatCalendarTime(ev.end)}`;
  }

  const end = formatCalendarDateTime(ev.end, {
    allDay: !!ev.allDay,
    editor: true,
    includeWeekday: true,
  });

  /*
    Multi-day:
    Samstag, 30. Mai 2026
    Sonntag, 31. Mai 2026

    Kein Gedankenstrich, damit es überall kompakter/lesbarer umbrechen kann.
  */
  return `${start}\n${end}`;
}

export function calendarEventForNoteId(noteId) {
  if (!noteId) return null;

  if (!calendarHydrated || state.calendarEvents.size === 0) {
    hydrateCalendarStateFromVault({
      silent: true,
    });
  }

  return [...state.calendarEvents.values()]
    .find((ev) => ev.noteId === noteId) || null;
}

export function removeLegacyManagedEventBlocksFromNote(noteId) {
  if (!noteId) return false;

  /*
    Safety:
    Alte Managed Blocks nur entfernen, wenn für diese Note auch wirklich
    ein Calendar-Event existiert. Sonst würde ein Refresh alte Infos löschen,
    ohne dass eine virtuelle Karte zurückkommt.
  */
  const linkedEvent = [...state.calendarEvents.values()]
    .find((ev) => ev.noteId === noteId);

  if (!linkedEvent) return false;

  let removed = false;

  try {
    const ytext = getMarkdownText(noteId);
    let md = ytext.toString();

    while (true) {
      LEGACY_EVENT_NOTE_BLOCK_RE.lastIndex = 0;
      const m = LEGACY_EVENT_NOTE_BLOCK_RE.exec(md);

      if (!m) break;

      let from = m.index;
      let to = m.index + m[0].length;

      // Clean surrounding blank lines.
      if (md.slice(to, to + 2) === '\n\n') {
        to += 1;
      } else if (from > 0 && md.slice(from - 2, from) === '\n\n') {
        from -= 1;
      }

      ytext.delete(from, to - from);
      removed = true;

      md = ytext.toString();
    }
  } catch (err) {
    console.warn('[YANTA Calendar] Could not remove legacy event note block', err);
  }

  return removed;
}

function createCalendarEventAttachmentNode(ev, {
  surface = 'preview',
} = {}) {
  const node = document.createElement('div');
  node.className = `yanta-event-note-card yanta-event-note-card-${surface}`;
  node.dataset.calendarEventAttachment = ev.id;
  node.contentEditable = 'false';

  const cat = categoryForEvent(ev);
  const eventColor = calendarEventAttachmentColor(ev);
  const when = formatEventRangeForAttachment(ev);

  node.style.setProperty('--event-color', eventColor);

  node.innerHTML = `
    <div class="yanta-event-note-card-icon">
      ${lucide(calendarIconForEvent(ev), 20)}
    </div>

    <div class="yanta-event-note-card-main">
      <div class="yanta-event-note-card-title">
        ${escapeHtml(ev.title || 'Untitled event')}
      </div>

      ${when ? `
        <div class="yanta-event-note-card-meta">
          ${escapeHtml(when).replace(/\n/g, '<br>')}
        </div>
      ` : ''}

      ${ev.location ? `
        <div class="yanta-event-note-card-location">
          ${lucide('map-pin', 13)}
          <span>${escapeHtml(ev.location)}</span>
        </div>
      ` : ''}

      ${ev.description ? `
        <div class="yanta-event-note-card-description">
          ${escapeHtml(ev.description).replace(/\n/g, '<br>')}
        </div>
      ` : ''}

      ${cat?.name ? `
        <div class="yanta-event-note-card-calendar">
          ${escapeHtml(cat.name)}
        </div>
      ` : ''}
    </div>

    <div class="yanta-event-note-card-actions">
      <button class="btn ${surface === 'editor' ? 'primary' : ''}" data-event-attachment-action="open">
        ${lucide('calendar-clock', 13)}
        Open event
      </button>

      ${surface === 'editor' ? `
        <button class="btn" data-event-attachment-action="unlink">
          ${lucide('unlink', 13)}
          Unlink
        </button>
      ` : ''}
    </div>
  `;

  node.querySelector('[data-event-attachment-action="open"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    openCalendarEvent(ev.id, {
      push: true,
    });
  });

  node.querySelector('[data-event-attachment-action="unlink"]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const choice = await calendarChoiceDialog({
      title: 'Unlink calendar event',
      message: `Unlink this note from "${ev.title || 'Untitled event'}"?`,
      choices: [
        { id: 'unlink', label: 'Unlink', primary: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    });

    if (choice !== 'unlink') return;

    unlinkEventNote(ev.id);
    toast('Event unlinked from note', 'success');
  });

  return node;
}

export function createLinkedCalendarEventDashboardHeader(noteId, {
  fields = {},
} = {}) {
  if (!noteId) return null;

  if (!calendarHydrated || state.calendarEvents.size === 0) {
    hydrateCalendarStateFromVault({
      silent: true,
    });
  }

  const ev = calendarEventForNoteId(noteId);
  if (!ev) return null;

  const show = {
    icon: true,
    title: true,
    time: true,
    location: true,
    description: true,
    ...fields,
  };

  if (
    !show.icon &&
    !show.title &&
    !show.time &&
    !show.location &&
    !show.description
  ) {
    return null;
  }

  const eventColor = calendarEventAttachmentColor(ev);
  const when = formatEventRangeForAttachment(ev);

  const titleHtml = show.title
    ? `
      <strong class="yanta-dash-event-header-title">
        ${escapeHtml(ev.title || 'Untitled event')}
      </strong>
    `
    : '';

  const timeHtml = show.time && when
    ? `
      <span class="yanta-dash-event-header-time">
        ${escapeHtml(when).replace(/\n/g, '<br>')}
      </span>
    `
    : '';

  const locationHtml = show.location && ev.location
    ? `
      <span class="yanta-dash-event-header-location">
        ${lucide('map-pin', 11)}
        <span>${escapeHtml(ev.location)}</span>
      </span>
    `
    : '';

  const descriptionHtml = show.description && ev.description
    ? `
      <span class="yanta-dash-event-header-description">
        ${escapeHtml(ev.description).replace(/\n/g, '<br>')}
      </span>
    `
    : '';

  /*
    Reihenfolge:
    - Erste sichtbare Information kommt in die kompakte Topline neben das Icon.
    - Weitere Informationen stehen darunter über die volle Breite.
    Beispiele:
      Icon + Titel
      Time
      Location
      Description

    Wenn Titel deaktiviert ist:
      Icon + Time
      Location
      Description
  */
  const visibleParts = [
    titleHtml,
    timeHtml,
    locationHtml,
    descriptionHtml,
  ].filter(Boolean);

  if (!visibleParts.length && !show.icon) {
    return null;
  }

  const primaryHtml =
    visibleParts[0] ||
    '<span class="yanta-dash-event-header-title">Calendar event</span>';

  const secondaryHtml = visibleParts
    .slice(1)
    .join('');

  const node = document.createElement('div');
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', `Open calendar event: ${ev.title || 'Untitled event'}`);
  node.tabIndex = -1;

  node.className =
    'yanta-dash-event-header' +
    (!show.icon ? ' no-icon' : '');

  node.dataset.calendarEventId = ev.id;
  node.style.setProperty('--event-color', eventColor);

  node.innerHTML = `
    <span class="yanta-dash-event-header-main">
      ${
        show.icon
          ? `
            <span class="yanta-dash-event-header-icon">
              ${lucide(calendarIconForEvent(ev), 12)}
            </span>
          `
          : ''
      }

      ${primaryHtml}
    </span>

    ${secondaryHtml}
  `;

  return node;
}

function renderEditorEventAttachment(noteId) {
  const pane = $('paneEdit');
  const editor = $('editor');

  if (!pane || !editor) return;

  // Alte/überflüssige Karten sowohl aus dem Pane als auch aus dem Scroller entfernen
  pane
    .querySelectorAll(':scope > .yanta-event-note-card')
    .forEach((n) => n.remove());

  editor
    .querySelectorAll('.cm-scroller > .yanta-event-note-card')
    .forEach((n) => n.remove());

  const ev = calendarEventForNoteId(noteId);
  if (!ev) return;

  const node = createCalendarEventAttachmentNode(ev, {
    surface: 'editor',
  });

  const scroller = editor.querySelector('.cm-scroller');
  if (scroller) {
    // Fügt die Karte ganz oben im Scroller ein, vor dem restlichen Inhalt
    scroller.prepend(node);
  } else {
    // Fallback, falls der CodeMirror-Scroller noch nicht bereit ist
    pane.insertBefore(node, editor);
  }
}

function renderPreviewEventAttachment(noteId) {
  const pane = $('panePreview');
  const preview = $('preview');

  if (!pane || !preview) return;

  pane
    .querySelectorAll(':scope > .yanta-event-note-card')
    .forEach((n) => n.remove());

  const ev = calendarEventForNoteId(noteId);
  if (!ev) return;

  const node = createCalendarEventAttachmentNode(ev, {
    surface: 'preview',
  });

  /*
    Wichtig:
    Der Preview-Pane-Switcher soll immer oberhalb der virtuellen Event-Card stehen.
    Falls er existiert: Event-Card direkt danach einfügen.
    Falls nicht: vor dem Preview-Article einfügen.
  */
  const switcher = pane.querySelector('[data-preview-pane-switcher]');

  if (switcher) {
    switcher.insertAdjacentElement('afterend', node);
  } else {
    pane.insertBefore(node, preview);
  }
}

export function renderCalendarNoteAttachments(noteId = state.currentNoteId) {
  if (!noteId) {
    $('paneEdit')
      ?.querySelectorAll(':scope > .yanta-event-note-card')
      ?.forEach((n) => n.remove());

    $('editor')
      ?.querySelectorAll('.cm-scroller > .yanta-event-note-card')
      ?.forEach((n) => n.remove());

    $('panePreview')
      ?.querySelectorAll(':scope > .yanta-event-note-card')
      ?.forEach((n) => n.remove());

    return;
  }

  /*
    Wichtig:
    Nach Page Refresh ist state.calendarEvents leer, solange der Kalender
    noch nicht geöffnet wurde. Die virtuellen Event-Attachments brauchen
    aber die Event-Daten aus VaultDoc.
  */
  if (!calendarHydrated || state.calendarEvents.size === 0) {
    hydrateCalendarStateFromVault({
      silent: true,
    });
  }

  // Migration cleanup from the earlier managed-Markdown-block approach.
  // Erst NACH Hydration ausführen, damit die virtuelle Karte direkt wieder
  // gerendert werden kann.
  removeLegacyManagedEventBlocksFromNote(noteId);

  renderEditorEventAttachment(noteId);
  renderPreviewEventAttachment(noteId);
}

export function unlinkEventNote(eventId) {
  const ev = state.calendarEvents.get(String(eventId || ''));
  if (!ev) return null;

  const saved = putCalendarEvent({
    ...ev,
    noteId: null,
  });

  if (state.currentNoteId === ev.noteId) {
    requestAnimationFrame(() => {
      renderCalendarNoteAttachments(state.currentNoteId);
    });
  }

  return saved;
}

async function applyCalendarEventAppearanceSideEffects(patch) {
  if (!patch?._appearanceTouched) return;

  const noteId = patch.noteId || null;

  /*
    Wenn ein Event mit einer Note verlinkt ist, ist die Note die visuelle
    Quelle für Icon/Farbe. Deshalb muss der Picker in diesem Fall die Note
    ändern, nicht nur das Event.
  */
  if (!noteId) return;

  const note = state.notes.get(noteId);
  if (!note) return;

  let changed = false;

  if (patch.icon && note.icon !== patch.icon) {
    note.icon = patch.icon;
    changed = true;
  }

  if (patch.color && note.color !== patch.color) {
    note.color = patch.color;
    changed = true;
  }

  if (!changed) return;

  note.updated = now();

  await store.notes.put(note);

  try {
    renderTree();
  } catch {}

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: note.id,
      reason: 'appearance-change',
      source: 'calendar',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
    detail: {
      noteId: note.id,
      reason: 'appearance-change',
      source: 'calendar',
    },
  }));
}

function calendarEventForNoteIdExcept(noteId, exceptEventId = null) {
  if (!noteId) return null;

  if (!calendarHydrated || state.calendarEvents.size === 0) {
    hydrateCalendarStateFromVault({
      silent: true,
    });
  }

  return [...state.calendarEvents.values()]
    .find((ev) => ev.noteId === noteId && ev.id !== exceptEventId) || null;
}

export async function linkCalendarEventToNote(eventId, noteId, {
  ask = true,
} = {}) {
  const event = state.calendarEvents.get(String(eventId || ''));
  const note = state.notes.get(String(noteId || ''));

  if (!event || !note) {
    toast('Could not link event to note', 'error');
    return false;
  }

  if (event.noteId === note.id) {
    toast('Event is already linked to this note', 'success');
    renderCalendarNoteAttachments(note.id);
    return true;
  }

  const noteExistingEvent = calendarEventForNoteIdExcept(note.id, event.id);
  const oldNote = event.noteId ? state.notes.get(event.noteId) : null;

  if (ask && (noteExistingEvent || oldNote)) {
    const parts = [];

    if (oldNote) {
      parts.push(`This event is currently linked to "${oldNote.title || 'Untitled'}".`);
    }

    if (noteExistingEvent) {
      parts.push(`This note is already linked to "${noteExistingEvent.title || 'Untitled event'}".`);
    }

    parts.push(`Link "${event.title || 'Untitled event'}" to "${note.title || 'Untitled'}"?`);

    const choice = await calendarChoiceDialog({
      title: 'Link calendar event',
      message: parts.join('\n\n'),
      choices: [
        {
          id: 'replace',
          label: noteExistingEvent ? 'Replace link' : 'Move link',
          primary: true,
          icon: 'link',
        },
        {
          id: 'cancel',
          label: 'Cancel',
        },
      ],
    });

    if (choice !== 'replace') {
      return false;
    }
  }

  if (noteExistingEvent) {
    putCalendarEvent({
      ...noteExistingEvent,
      noteId: null,
    });
  }

  putCalendarEvent({
    ...event,
    noteId: note.id,
    color: event.color || note.color || undefined,
    icon: event.icon || note.icon || 'calendar-days',
  });

  renderCalendarNoteAttachments(note.id);

  if (oldNote?.id && oldNote.id !== note.id) {
    renderCalendarNoteAttachments(oldNote.id);
  }

  toast('Calendar event linked to note', 'success');

  return true;
}

async function deleteLinkedNoteById(noteId) {
  const note = state.notes.get(noteId);
  if (!note) return false;

  await moveNoteToTrash(noteId, {
    source: 'calendar',
    toastMessage: 'Moved linked note to Trash',
  });

  return true;
}

async function createLinkedNoteForEvent(ev) {
  const noteId = uid();
  const cat = categoryForEvent(ev);
  const noteColor =
    ev.color ||
    defaultEventColorForCategory(cat) ||
    cssVar('--accent', '#6ea8fe');
    
  const note = {
    id: noteId,
    title: ev.title || 'Event note',
    type: 'markdown',
    folderId: null,
    tags: ['calendar'],
    icon: ev.icon || 'calendar-days',
    color: noteColor,
    pinned: false,
    created: now(),
    updated: now(),
  };

  state.notes.set(noteId, note);
  await store.notes.put(note);

  const entry = getNoteDoc(noteId);
  await entry.ready;

  // Important:
  // Event attachment is virtual. No event block is written to Markdown.
  // The note body stays user-owned.
  const ytext = entry.doc.getText('markdown');
  if (ytext.length === 0) {
    ytext.insert(0, '');
  }

  state.searchIndex.set(
    noteId,
    [
      note.title || '',
      (note.tags || []).join(' '),
    ].join(' ').toLowerCase()
  );

  rebuildWikilinkIndex();
  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId,
      reason: 'calendar-note-created',
      source: 'calendar',
    },
  }));

  return noteId;
}

// ============================================================
// Calendar note picker
// ============================================================

function noteFolderPathForPicker(folderId) {
  if (!folderId) return '';

  const parts = [];
  const seen = new Set();
  let f = state.folders.get(folderId);

  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    parts.unshift(f.name || 'Folder');
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return parts.join(' / ');
}

function notesForPicker(query = '') {
  const q = String(query || '').trim().toLowerCase();

  return [...state.notes.values()]
    .filter((note) => {
      if (!q) return true;

      const hay = [
        note.title || '',
        note.id,
        noteFolderPathForPicker(note.folderId),
        (note.tags || []).join(' '),
      ].join(' ').toLowerCase();

      return hay.includes(q);
    })
    .sort((a, b) => {
      const at = (a.title || '').toLowerCase();
      const bt = (b.title || '').toLowerCase();

      const aStarts = q && at.startsWith(q) ? 1 : 0;
      const bStarts = q && bt.startsWith(q) ? 1 : 0;

      return bStarts - aStarts || (b.updated || 0) - (a.updated || 0);
    });
}

function ensureCalendarNotePickerModal() {
  if (calendarNotePickerModal) return calendarNotePickerModal;

  calendarNotePickerModal = document.createElement('div');
  calendarNotePickerModal.className = 'modal yanta-calendar-note-picker-modal';
  calendarNotePickerModal.hidden = true;
  document.body.append(calendarNotePickerModal);

  return calendarNotePickerModal;
}

function openCalendarNotePicker({
  title = 'Link existing note',
} = {}) {
  return new Promise((resolve) => {
    const modal = ensureCalendarNotePickerModal();

    let query = '';
    let activeIndex = 0;

    const close = (value) => {
      modal.hidden = true;
      resolve(value || null);
    };

    const render = () => {
      const notes = notesForPicker(query);
      activeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, notes.length - 1)));

      modal.innerHTML = `
        <div class="modal-card yanta-calendar-note-picker-card">
          <header class="modal-head">
            <h3>${escapeHtml(title)}</h3>
            <button class="icon-btn" data-picker-cancel>&times;</button>
          </header>

          <div class="modal-body yanta-calendar-note-picker-body">
            <div class="yanta-calendar-note-picker-search-row">
              ${lucide('search', 15)}
              <input
                class="text-input"
                data-picker-search
                value="${escapeAttr(query)}"
                placeholder="Search notes by title, folder, tag…"
                autocomplete="off"
                spellcheck="false" />
            </div>

            <div class="yanta-calendar-note-picker-list">
              ${
                notes.length
                  ? notes.map((note, index) => {
                      const folder = noteFolderPathForPicker(note.folderId);
                      const icon = note.icon || (note.type === 'list' ? 'list' : 'file-text');
                      const color = safeNotePickerColor(note.color);

                      return `
                        <button
                          class="yanta-calendar-note-picker-item ${index === activeIndex ? 'active' : ''}"
                          data-note-id="${escapeAttr(note.id)}"
                          data-index="${index}"
                          type="button"
                          style="${color ? `--note-color:${escapeAttr(color)}` : ''}">
                          <span class="yanta-calendar-note-picker-icon">${lucide(icon, 15)}</span>
                          <span class="yanta-calendar-note-picker-text">
                            <strong>${escapeHtml(note.title || 'Untitled')}</strong>
                            <small>${escapeHtml(folder || 'No folder')}</small>
                          </span>
                        </button>
                      `;
                    }).join('')
                  : `<div class="tree-empty">No notes found.</div>`
              }
            </div>

            <div class="compress-actions">
              <button class="btn" data-picker-cancel>Cancel</button>
              <button class="btn primary" data-picker-choose ${notes.length ? '' : 'disabled'}>
                ${lucide('link', 14)}
                Link selected note
              </button>
            </div>
          </div>
        </div>
      `;

      const input = modal.querySelector('[data-picker-search]');

      input?.addEventListener('input', () => {
        query = input.value || '';
        activeIndex = 0;
        render();
      });

      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIndex = Math.min(notes.length - 1, activeIndex + 1);
          render();
          return;
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = Math.max(0, activeIndex - 1);
          render();
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          close(notes[activeIndex] || null);
        }
      });

      modal.querySelectorAll('[data-picker-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => close(null));
      });

      modal.querySelectorAll('[data-note-id]').forEach((btn) => {
        btn.addEventListener('mouseenter', () => {
          activeIndex = Number(btn.dataset.index || 0);
          modal.querySelectorAll('[data-note-id]').forEach((x) => {
            x.classList.toggle('active', x === btn);
          });
        });

        btn.addEventListener('click', () => {
          const note = state.notes.get(btn.dataset.noteId);
          close(note || null);
        });
      });

      modal.querySelector('[data-picker-choose]')?.addEventListener('click', () => {
        close(notes[activeIndex] || null);
      });

      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(query.length, query.length);
      });
    };

    modal.addEventListener('click', function onBackdrop(e) {
      if (e.target !== modal) return;
      modal.removeEventListener('click', onBackdrop);
      close(null);
    }, { once: true });

    modal.hidden = false;
    render();
  });
}

function safeNotePickerColor(color) {
  const s = String(color || '').trim();

  if (!s) return '';

  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;

  return '';
}

// ============================================================
// Event modal
// ============================================================

function ensureEventModal() {
  registerCalendarEventOverlayRoute();

  if (eventModal) return eventModal;

  eventModal = document.createElement('div');
  eventModal.className = 'modal yanta-calendar-event-modal';
  eventModal.hidden = true;

  document.body.append(eventModal);

  eventModal.addEventListener('click', (e) => {
    if (e.target === eventModal) closeEventModal();
    if (e.target.matches('[data-cal-close]')) closeEventModal();
  });

  return eventModal;
}

function closeEventModal({
  fromHistory = false,
} = {}) {
  if (!eventModal) return;

  if (!fromHistory && eventModal.hidden === false) {
    closeTopOverlay(() => {
      closeEventModal({
        fromHistory: true,
      });
    });

    return;
  }

  eventModal.hidden = true;
}

export function openNewCalendarEvent(input = {}) {
  if (!calendarHydrated) {
    hydrateCalendarStateFromVault();
  }

  ensureDefaultCalendarCategory();

  const allDay = input.allDay === true;

  let start = input.start
    ? new Date(input.start)
    : allDay
      ? new Date()
      : nextHalfHourDate();

  if (Number.isNaN(start.getTime())) {
    start = allDay ? new Date() : nextHalfHourDate();
  }

  start.setSeconds(0, 0);

  const end = input.end
    ? new Date(input.end)
    : allDay
      ? null
      : new Date(start.getTime() + 30 * 60 * 1000);

  openEventEditor({
    ...input,
    title: input.title && input.title !== 'Untitled event'
      ? input.title
      : '',
    start: start.toISOString(),
    end: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
    allDay,
  });
}

function categoryOptionsHtml(selectedId) {
  ensureDefaultCalendarCategory();

  return [...state.calendarCategories.values()]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((cat) => `
      <option value="${escapeAttr(cat.id)}" ${cat.id === selectedId ? 'selected' : ''}>
        ${escapeHtml(cat.name || 'Calendar')}
      </option>
    `)
    .join('');
}

function openEventEditor(input = {}) {
  registerCalendarEventOverlayRoute();

  const fromHistory = input._fromHistory === true;
  const shouldPushOverlay = input._pushOverlay !== false;

  const markdownRef = input.markdownRef || null;
  const isMarkdownEvent = !!markdownRef;

  const existing = !isMarkdownEvent && input.id
    ? state.calendarEvents.get(input.id)
    : null;

  const editingExisting = !!existing || isMarkdownEvent;

  const rawTitle =
    existing
      ? existing.title || ''
      : input.title && input.title !== 'Untitled event'
        ? input.title
        : '';

  const ev = sanitizeCalendarEvent({
    id: existing?.id || input.id || 'evt_' + uid(),
    title: rawTitle || 'Untitled event',
    start: existing?.start || input.start || new Date().toISOString(),
    end: existing?.end || input.end || null,
    allDay: existing?.allDay ?? input.allDay ?? false,
    categoryId: existing?.categoryId || input.categoryId || DEFAULT_CATEGORY_ID,

    /*
      Wichtig:
      Bisher wurden color/icon hier verloren. Dadurch hatte der Picker
      später scheinbar keinen Effekt bzw. alte Werte wurden überschrieben.
    */
    color: existing?.color || input.color || undefined,
    icon: existing?.icon || input.icon || undefined,

    location: existing?.location || input.location || '',
    description: existing?.description || input.description || '',
    noteId: existing?.noteId || input.noteId || null,
    status: existing?.status || input.status || 'confirmed',
    recurrence: existing?.recurrence || input.recurrence || null,
    created: existing?.created || now(),
    updated: existing?.updated || now(),
  });

  if (!ev) return;

  let linkedNote = ev.noteId ? state.notes.get(ev.noteId) : null;

  /*
    Anzeige im Event-Editor:
    - Wenn verlinkte Note existiert: Note-Appearance anzeigen.
    - Sonst Event-Appearance.
    - Sonst Kategorie/Accent-Fallback.
  */
  const initialAppearanceIcon =
    linkedNote?.icon ||
    ev.icon ||
    'calendar-days';

  const initialAppearanceColor =
    cssColorToHex(
      linkedNote?.color ||
      ev.color ||
      defaultEventColorForCategory(categoryForEvent(ev)) ||
      cssVar('--accent', '#6ea8fe')
    ) ||
    cssColorToHex(cssVar('--accent', '#6ea8fe')) ||
    '#6ea8fe';

  const modal = ensureEventModal();

  const renderNoteSection = () => {
    linkedNote = modal.querySelector('[data-field="noteId"]')?.value
      ? state.notes.get(modal.querySelector('[data-field="noteId"]').value)
      : null;

    const host = modal.querySelector('[data-note-section]');
    if (!host) return;

    const creating = !editingExisting && !markdownRef;

    host.innerHTML = `
      <div class="yanta-calendar-note-link-head">
        <strong>${lucide('file-text', 14)} Notes</strong>
      </div>

      ${
        linkedNote
          ? `
            <div class="yanta-calendar-linked-note">
              <span class="yanta-calendar-linked-note-icon">${lucide(linkedNote.icon || 'file-text', 15)}</span>
              <span class="yanta-calendar-linked-note-title">${escapeHtml(linkedNote.title || 'Untitled')}</span>
            </div>

            <div class="compress-actions" style="justify-content:flex-start;margin-top:8px">
              ${editingExisting ? `<button class="btn" data-action="open-note">${lucide('corner-down-right', 14)} Open note</button>` : ''}
              <button class="btn" data-action="unlink-note">${lucide('unlink', 14)} Unlink</button>
            </div>
          `
          : creating
            ? `
              <label class="switch yanta-calendar-switch" style="margin-bottom:8px">
                <input type="checkbox" data-field="createNote" checked />
                <span>Create linked note</span>
              </label>

              <div class="compress-actions" style="justify-content:flex-start">
                <button class="btn" data-action="link-existing-note">${lucide('link', 14)} Link existing note…</button>
              </div>
            `
            : `
              <div class="hint" style="color:var(--text-dim);font-size:12px;margin-bottom:8px">
                No note is linked to this event yet.
              </div>

              <div class="compress-actions" style="justify-content:flex-start">
                <button class="btn primary" data-action="add-note">${lucide('calendar-plus', 14)} Add to notes</button>
                <button class="btn" data-action="link-existing-note">${lucide('link', 14)} Link existing note…</button>
              </div>
            `
      }
    `;

    host.querySelector('[data-action="link-existing-note"]')?.addEventListener('click', async () => {
      const note = await openCalendarNotePicker({
        title: 'Link existing note',
      });

      if (!note) return;

      modal.querySelector('[data-field="noteId"]').value = note.id;

      const createCb = modal.querySelector('[data-field="createNote"]');
      if (createCb) createCb.checked = false;

      /*
        Wenn noch keine Appearance-Änderung im Event-Editor gemacht wurde,
        zeigt der Picker ab jetzt die verlinkte Note als Quelle.
      */
      const touched =
        modal.querySelector('[data-field="appearanceTouched"]')?.value === '1';

      if (!touched) {
        const previewIcon = modal.querySelector('[data-icon-preview]');
        const previewText = modal.querySelector('[data-appearance-preview-text]');
        const pickerButton = modal.querySelector('.yanta-calendar-appearance-picker');

        const noteIcon = note.icon || 'calendar-days';
        const noteColor =
          cssColorToHex(note.color) ||
          cssColorToHex(cssVar('--accent', '#6ea8fe')) ||
          '#6ea8fe';

        if (previewIcon) {
          previewIcon.innerHTML = lucide(noteIcon, 17);
        }

        if (pickerButton) {
          pickerButton.style.setProperty('--appearance-color', noteColor);
        }

        if (previewText) {
          previewText.textContent = 'Uses linked note appearance';
        }
      }

      renderNoteSection();
    });

    host.querySelector('[data-action="unlink-note"]')?.addEventListener('click', async () => {
      const currentNoteId = modal.querySelector('[data-field="noteId"]').value || '';

      const choice = await calendarChoiceDialog({
        title: 'Unlink note',
        message: currentNoteId && state.notes.has(currentNoteId)
          ? `Unlink this event from "${state.notes.get(currentNoteId).title || 'Untitled'}"?`
          : 'Unlink this event from the note?',
        choices: [
          { id: 'unlink', label: 'Unlink', primary: true },
          { id: 'cancel', label: 'Cancel' },
        ],
      });

      if (choice !== 'unlink') return;

      modal.querySelector('[data-field="noteId"]').value = '';

      if (editingExisting && existing) {
        const patch = readPatchFromModal();
        const saved = putCalendarEvent(patch);

        if (saved) {
          toast('Event unlinked from note', 'success');
        }
      }

      renderNoteSection();
    });

    host.querySelector('[data-action="add-note"]')?.addEventListener('click', async () => {
      if (!existing) return;

      const patch = readPatchFromModal();
      if (!validatePatch(patch)) return;

      const noteId = await createLinkedNoteForEvent(patch);

      const saved = putCalendarEvent({
        ...patch,
        noteId,
      });

      closeEventModal();

      if (saved) {
        toast('Event note created', 'success');
      }
    });

    host.querySelector('[data-action="open-note"]')?.addEventListener('click', async () => {
      const noteId = modal.querySelector('[data-field="noteId"]')?.value || '';

      if (noteId && state.notes.has(noteId)) {
        closeEventModal();

        if (calendarMode === 'surface') {
          leaveCalendarSurface();
        }

        await openNote(noteId);
      }
    });
  };

  modal.innerHTML = `
    <div class="modal-card yanta-calendar-event-card">
      <header class="modal-head">
        <h3>${editingExisting ? 'Edit event' : 'New event'}</h3>
        <button class="icon-btn" data-cal-close>&times;</button>
      </header>

      <div class="modal-body yanta-calendar-event-body">
        <label>
          Title
          <input class="text-input" data-field="title" value="${escapeAttr(rawTitle)}" placeholder="Event title" />
        </label>

        <label>
          Category
          <select class="text-input" data-field="categoryId">
            ${categoryOptionsHtml(ev.categoryId)}
          </select>
        </label>

        <div class="yanta-calendar-appearance-box">
          <input type="hidden" data-field="color" value="${escapeAttr(ev.color || '')}" />
          <input type="hidden" data-field="icon" value="${escapeAttr(ev.icon || '')}" />
          <input type="hidden" data-field="appearanceTouched" value="0" />

          <button
            type="button"
            class="yanta-calendar-appearance-picker"
            data-action="pick-icon"
            style="--appearance-color:${escapeAttr(initialAppearanceColor)}">
            <span class="yanta-calendar-appearance-picker-icon" data-icon-preview>
              ${lucide(initialAppearanceIcon, 17)}
            </span>

            <span class="yanta-calendar-appearance-picker-text">
              <strong>Icon & color</strong>
              <small data-appearance-preview-text>
                ${
                  linkedNote
                    ? 'Uses linked note appearance'
                    : ev.icon || ev.color
                      ? 'Custom event appearance'
                      : 'Default event appearance'
                }
              </small>
            </span>
          </button>
        </div>

        <label class="switch yanta-calendar-switch">
          <input type="checkbox" data-field="allDay" ${ev.allDay ? 'checked' : ''} />
          <span>All day</span>
        </label>

        <div class="yanta-calendar-date-grid">
          <label>
            Start
            <div class="yanta-calendar-date-input-row">
              <input
                class="text-input"
                data-field="start"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                spellcheck="false"
                placeholder="${escapeAttr(calendarEditorDatePlaceholder(ev.allDay))}"
                value="${escapeAttr(calendarEditorInputValue(ev.start, ev.allDay))}" />
              <button type="button" class="icon-btn" data-date-picker="start" title="Pick start date/time">
                ${lucide('calendar-clock', 16)}
              </button>
            </div>
            <div class="yanta-calendar-date-preview" data-date-preview="start"></div>
          </label>

          <label>
            End
            <div class="yanta-calendar-date-input-row">
              <input
                class="text-input"
                data-field="end"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                spellcheck="false"
                placeholder="${escapeAttr(calendarEditorDatePlaceholder(ev.allDay))}"
                value="${escapeAttr(calendarEditorInputValue(ev.end, ev.allDay))}" />
              <button type="button" class="icon-btn" data-date-picker="end" title="Pick end date/time">
                ${lucide('calendar-clock', 16)}
              </button>
            </div>
            <div class="yanta-calendar-date-preview" data-date-preview="end"></div>
          </label>
        </div>

        <label>
          Location
          <input class="text-input" data-field="location" value="${escapeAttr(ev.location || '')}" placeholder="Room, address, link…" />
        </label>

        <label>
          Description
          <textarea class="text-input" data-field="description" rows="4" placeholder="Description, agenda, notes…">${escapeHtml(ev.description || '')}</textarea>
        </label>

        <input type="hidden" data-field="noteId" value="${escapeAttr(ev.noteId || '')}" />

        <section class="yanta-calendar-note-link-box" data-note-section></section>

        <div class="compress-actions">
          ${editingExisting ? `<button class="btn danger" data-action="delete">${lucide('trash', 14)} Delete</button>` : ''}
          <span class="grow"></span>
          <button class="btn" data-cal-close>Cancel</button>
          <button class="btn primary" data-action="save">${lucide('check', 14)} Save</button>
        </div>
      </div>
    </div>
  `;

  const allDayInput = modal.querySelector('[data-field="allDay"]');
  const startInput = modal.querySelector('[data-field="start"]');
  const endInput = modal.querySelector('[data-field="end"]');

  modal.querySelector('[data-action="pick-icon"]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const iconInput = modal.querySelector('[data-field="icon"]');
    const colorInput = modal.querySelector('[data-field="color"]');
    const touchedInput = modal.querySelector('[data-field="appearanceTouched"]');

    const previewIcon = modal.querySelector('[data-icon-preview]');
    const previewText = modal.querySelector('[data-appearance-preview-text]');
    const pickerButton = modal.querySelector('.yanta-calendar-appearance-picker');

    const linkedNoteId = modal.querySelector('[data-field="noteId"]')?.value || '';
    const linked = linkedNoteId ? state.notes.get(linkedNoteId) : null;

    const currentIcon =
      iconInput?.value ||
      linked?.icon ||
      ev.icon ||
      'calendar-days';

    const currentColor =
      cssColorToHex(
        colorInput?.value ||
        linked?.color ||
        ev.color ||
        defaultEventColorForCategory(categoryForEvent(ev)) ||
        cssVar('--accent', '#6ea8fe')
      ) ||
      cssColorToHex(cssVar('--accent', '#6ea8fe')) ||
      '#6ea8fe';

    const { openIconPicker } = await import('./icon-picker.js');

    openIconPicker({
      title: linked
        ? 'Icon & color for linked note'
        : 'Icon & color for event',
      initialIcon: currentIcon,
      initialColor: currentColor,
      allowReset: false,
      applyLabel: 'Apply',
      onApply: ({ icon, color }) => {
        const nextIcon = icon || currentIcon;
        const nextColor =
          cssColorToHex(color) ||
          cssColorToHex(currentColor) ||
          currentColor;

        if (iconInput) iconInput.value = nextIcon;
        if (colorInput) colorInput.value = nextColor;
        if (touchedInput) touchedInput.value = '1';

        if (previewIcon) {
          previewIcon.innerHTML = lucide(nextIcon, 17);
        }

        if (pickerButton) {
          pickerButton.style.setProperty('--appearance-color', nextColor);
        }

        if (previewText) {
          previewText.textContent = linked
            ? 'Will update linked note appearance'
            : 'Will update event appearance';
        }
      },
    });
  });

  let endTouched = !!endInput?.value?.trim();

  const updateDatePreviews = () => {
    const allDay = !!allDayInput?.checked;

    const startIso = parseCalendarEditorInput(startInput?.value, allDay);
    const endIso = parseCalendarEditorInput(endInput?.value, allDay);

    const startPreview = modal.querySelector('[data-date-preview="start"]');
    const endPreview = modal.querySelector('[data-date-preview="end"]');

    if (startPreview) {
      startPreview.textContent = startInput?.value && !startIso
        ? `Invalid date · expected ${calendarEditorDatePlaceholder(allDay)}`
        : startIso
          ? formatCalendarDateTime(startIso, {
              allDay,
              editor: true,
              includeWeekday: true,
            })
          : '';
    }

    if (endPreview) {
      endPreview.textContent = endInput?.value && !endIso
        ? `Invalid date · expected ${calendarEditorDatePlaceholder(allDay)}`
        : endIso
          ? formatCalendarDateTime(endIso, {
              allDay,
              editor: true,
              includeWeekday: true,
            })
          : '';
    }

    const rangeValidation = calendarEditorRangeIsValid({
      start: startIso,
      end: endIso,
      allDay,
    });

    const endHasValue = !!endInput?.value?.trim();
    const startInvalid = !!startInput?.value && !startIso;
    const endInvalid = endHasValue && (!endIso || !rangeValidation.ok);

    startPreview?.classList.toggle('invalid', startInvalid);
    endPreview?.classList.toggle('invalid', endInvalid);

    if (endPreview && endHasValue && endIso && !rangeValidation.ok) {
      endPreview.textContent = rangeValidation.message || 'Invalid date range';
    }
  };

  const autoFillEndFromStart = () => {
    const allDay = !!allDayInput?.checked;
    if (allDay) return;
    if (endTouched) return;

    const startIso = parseCalendarEditorInput(startInput.value, false);
    if (!startIso) return;

    const endIso = addMinutesIso(startIso, 30);
    if (!endIso) return;

    endInput.value = calendarEditorInputValue(endIso, false);
    updateDatePreviews();
  };

  const readPatchFromModal = () => {
    const allDay = !!modal.querySelector('[data-field="allDay"]')?.checked;

    const parsedStart = parseCalendarEditorInput(
      modal.querySelector('[data-field="start"]').value,
      allDay
    );

    const parsedEnd = parseCalendarEditorInput(
      modal.querySelector('[data-field="end"]').value,
      allDay
    );

    const appearanceTouched =
      modal.querySelector('[data-field="appearanceTouched"]')?.value === '1';

    const nextColor =
      modal.querySelector('[data-field="color"]')?.value?.trim() || '';

    const nextIcon =
      modal.querySelector('[data-field="icon"]')?.value?.trim() || '';

    return {
      ...ev,
      title: modal.querySelector('[data-field="title"]').value.trim() || 'Untitled event',
      categoryId: modal.querySelector('[data-field="categoryId"]').value || DEFAULT_CATEGORY_ID,

      /*
        Nur explizit speichern, wenn der Picker benutzt wurde.
        Sonst überschreiben wir nicht versehentlich Kategorie/Accent-Fallbacks
        oder Linked-Note-Appearance.
      */
      color: appearanceTouched ? (nextColor || undefined) : (ev.color || undefined),
      icon: appearanceTouched ? (nextIcon || undefined) : (ev.icon || undefined),
      _appearanceTouched: appearanceTouched,

      allDay,
      start: parsedStart,
      end: normalizeCalendarEventEnd({
        start: parsedStart,
        end: parsedEnd,
        allDay,
      }),
      location: modal.querySelector('[data-field="location"]').value.trim(),
      description: modal.querySelector('[data-field="description"]').value.trim(),
      noteId: modal.querySelector('[data-field="noteId"]').value.trim() || null,
    };
  };

  const validatePatch = (patch) => {
    const allDay = !!patch.allDay;

    if (!patch.start) {
      toast(`Start date required · expected ${calendarEditorDatePlaceholder(allDay)}`, 'error');
      updateDatePreviews();
      return false;
    }

    const endInputRaw = modal.querySelector('[data-field="end"]').value.trim();
    const parsedEnd = parseCalendarEditorInput(endInputRaw, allDay);

    if (endInputRaw && !parsedEnd) {
      toast(`End date invalid · expected ${calendarEditorDatePlaceholder(allDay)}`, 'error');
      updateDatePreviews();
      return false;
    }

    const rangeValidation = calendarEditorRangeIsValid({
      start: patch.start,
      end: parsedEnd,
      allDay,
    });

    if (!rangeValidation.ok) {
      toast(rangeValidation.message || 'Invalid date range', 'error');
      updateDatePreviews();
      return false;
    }

    return true;
  };

  const openPickerForInput = (which) => {
    const inputEl = which === 'start' ? startInput : endInput;
    const allDay = !!allDayInput?.checked;

    const parsed =
      parseCalendarEditorInput(inputEl.value, allDay) ||
      (which === 'start' ? ev.start : ev.end) ||
      ev.start ||
      new Date().toISOString();

    openCalendarDateTimePicker({
      title: which === 'start' ? 'Start' : 'End',
      value: parsed,
      allDay,
      allowClear: which === 'end',
      onPick: (iso) => {
        if (which === 'end') {
          endTouched = !!iso;
        }

        inputEl.value = iso
          ? calendarEditorInputValue(iso, allDay)
          : '';

        if (which === 'start') {
          autoFillEndFromStart();
        }

        updateDatePreviews();
      },
    });
  };

  modal.querySelector('[data-date-picker="start"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPickerForInput('start');
  });

  modal.querySelector('[data-date-picker="end"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPickerForInput('end');
  });

  startInput?.addEventListener('input', updateDatePreviews);
  startInput?.addEventListener('change', () => {
    autoFillEndFromStart();
    updateDatePreviews();
  });

  endInput?.addEventListener('input', () => {
    endTouched = !!endInput.value.trim();
    updateDatePreviews();
  });

  endInput?.addEventListener('change', () => {
    endTouched = !!endInput.value.trim();
    updateDatePreviews();
  });

  allDayInput?.addEventListener('change', () => {
    const allDay = allDayInput.checked;
    const previousAllDay = !allDay;

    const startIso =
      parseCalendarEditorInput(startInput.value, previousAllDay) ||
      ev.start;

    const endIso =
      parseCalendarEditorInput(endInput.value, previousAllDay) ||
      ev.end;

    startInput.placeholder = calendarEditorDatePlaceholder(allDay);
    endInput.placeholder = calendarEditorDatePlaceholder(allDay);

    if (!allDay) {
      const nextStartIso = applyCurrentDefaultTimeToDate(startIso);
      const nextEndIso = addMinutesIso(nextStartIso, 30);

      startInput.value = calendarEditorInputValue(nextStartIso, false);

      if (!endTouched && nextEndIso) {
        endInput.value = calendarEditorInputValue(nextEndIso, false);
      }
    } else {
      startInput.value = calendarEditorInputValue(startIso, true);
      endInput.value = endIso ? calendarEditorInputValue(endIso, true) : '';
    }

    updateDatePreviews();
  });

  modal.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
    const patch = readPatchFromModal();
    if (!validatePatch(patch)) return;

    if (!editingExisting && !markdownRef) {
      const createNote = !!modal.querySelector('[data-field="createNote"]')?.checked;

      if (!patch.noteId && createNote) {
        patch.noteId = await createLinkedNoteForEvent(patch);
      }
    }

    if (markdownRef) {
      const nextToken = serializeMarkdownCalendarRef({
        ...patch,
        markdownRef,
      }, markdownRef.kind);

      const ok = updateMarkdownCalendarRef({
        ...markdownRef,
        nextToken,
      });

      closeEventModal();

      if (ok) {
        toast('Calendar link updated', 'success');

        window.dispatchEvent(new CustomEvent('yanta-calendar-markdown-changed', {
          detail: {
            noteId: markdownRef.noteId,
            eventId: ev.id,
          },
        }));

        scheduleCalendarRender();
      } else {
        toast('Could not update calendar link', 'error');
      }

      return;
    }

    await applyCalendarEventAppearanceSideEffects(patch);

    const saved = putCalendarEvent(patch);

    closeEventModal();

    if (saved) {
      toast('Event saved', 'success');
    }
  });

  modal.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    const noteId = ev.noteId || '';
    const note = noteId ? state.notes.get(noteId) : null;

    const choice = await calendarChoiceDialog({
      title: 'Delete event',
      message: note
        ? `This event is linked to the note "${note.title || 'Untitled'}".`
        : `Delete "${ev.title || 'Untitled event'}"?`,
      choices: note
        ? [
            { id: 'event-only', label: 'Delete event only', primary: true, danger: true },
            { id: 'event-and-note', label: 'Delete event and note', danger: true },
            { id: 'cancel', label: 'Cancel' },
          ]
        : [
            { id: 'event-only', label: 'Delete event', primary: true, danger: true },
            { id: 'cancel', label: 'Cancel' },
          ],
    });

    if (choice === 'cancel') return;

    if (choice === 'event-and-note' && noteId) {
      await deleteLinkedNoteById(noteId);
      deleteCalendarEvent(ev.id);
    } else {
      deleteCalendarEvent(ev.id);
    }

    closeEventModal();

    toast('Event deleted', 'success');
  });

  renderNoteSection();
  updateDatePreviews();

  const wasClosed = modal.hidden !== false;

  modal.hidden = false;

  if (!fromHistory && shouldPushOverlay && wasClosed) {
    const overlayData =
      editingExisting && !isMarkdownEvent
        ? {
            eventId: ev.id,
          }
        : {
            input: {
              title: rawTitle || '',
              start: ev.start,
              end: ev.end || null,
              allDay: !!ev.allDay,
              categoryId: ev.categoryId || DEFAULT_CATEGORY_ID,
              noteId: ev.noteId || null,
              location: ev.location || '',
              description: ev.description || '',
            },
          };

    pushOverlayState('calendar-event-editor', overlayData);
  }

  setTimeout(() => {
    modal.querySelector('[data-field="title"]')?.focus();
  }, 0);
}

// ============================================================
// Calendar source modal
// ============================================================

function sourceKey(source = {}) {
  return [
    source.type || '',
    source.country || '',
    source.state || '',
    source.region || '',
    source.builtinId || '',
  ].join(':');
}

function categoryWithSourceExists(source) {
  const key = sourceKey(source);

  return [...state.calendarCategories.values()].some((cat) =>
    sourceKey(cat.source) === key
  );
}

function closeCalendarSourcesModal() {
  if (calendarSourcesModal) {
    calendarSourcesModal.hidden = true;
  }
}

function ensureCalendarSourcesModal() {
  if (calendarSourcesModal) return calendarSourcesModal;

  calendarSourcesModal = document.createElement('div');
  calendarSourcesModal.className = 'modal yanta-calendar-sources-modal';
  calendarSourcesModal.hidden = true;

  calendarSourcesModal.addEventListener('click', (e) => {
    if (e.target === calendarSourcesModal) closeCalendarSourcesModal();
    if (e.target.matches('[data-cal-source-close]')) closeCalendarSourcesModal();
  });

  document.body.append(calendarSourcesModal);

  return calendarSourcesModal;
}

function addHolidaySourceCategory(source) {
  const patch = makeHolidayCategoryPatch(source);

  const existing = [...state.calendarCategories.values()]
    .find((cat) => sourceKey(cat.source) === sourceKey(patch.source));

  if (existing) {
    putCalendarCategory({
      ...existing,
      visible: true,
      readonly: true,
      source: patch.source,
      name: existing.name || patch.name,
      color: existing.color || patch.color,
    });

    return {
      added: false,
      category: existing,
    };
  }

  const cat = putCalendarCategory(patch);

  return {
    added: true,
    category: cat,
  };
}

function renderCalendarSourcesModal() {
  const modal = ensureCalendarSourcesModal();

  const sourceButtons = DE_HOLIDAY_SOURCES
    .map((source, index) => {
      const exists = categoryWithSourceExists({
        type: 'holidays',
        country: source.country,
        state: source.state || null,
        region: source.region || null,
        builtinId: source.id || null,
      });

      return `
        <button class="btn ${exists ? '' : 'primary'}" data-add-de-source="${index}" ${exists ? 'data-existing="1"' : ''}>
          ${lucide(exists ? 'check' : 'calendar-plus', 14)}
          ${escapeHtml(source.label)}
        </button>
      `;
    })
    .join('');

  modal.innerHTML = `
    <div class="modal-card yanta-calendar-categories-card">
      <header class="modal-head">
        <h3>Add calendar data source</h3>
        <button class="icon-btn" data-cal-source-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-calendar-share-hint">
          <strong>Dynamic source categories:</strong>
          YANTA stores only the category/source definition. Events are generated for the visible date range.
          These events are read-only and do not clutter your stored calendar events.
        </div>

        <section style="margin-top:14px">
          <h4 style="margin:0 0 8px;font-size:13px">German public holidays</h4>

          <div class="compress-actions" style="justify-content:flex-start;margin-bottom:10px">
            <button class="btn primary" data-add-all-de-holidays>
              ${lucide('calendar-plus', 14)} Add all German holiday categories
            </button>
          </div>

          <div style="
            display:grid;
            grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
            gap:8px;
          ">
            ${sourceButtons}
          </div>
        </section>

        <section style="margin-top:20px">
          <h4 style="margin:0 0 8px;font-size:13px">Custom date ranges</h4>

          <p class="hint" style="margin:0 0 8px;color:var(--text-dim);font-size:12px">
            Use this for school holidays, institution-specific closing days, conferences, semester breaks, etc.
            End dates are interpreted as inclusive.
          </p>

          <label style="display:block;margin-bottom:8px;font-size:12px;color:var(--text-dim)">
            Category name
            <input class="text-input" data-custom-source-name value="Schulferien Niedersachsen" />
          </label>

          <label style="display:block;margin-bottom:8px;font-size:12px;color:var(--text-dim)">
            Color
            <input type="color" data-custom-source-color value="#4ade80" />
          </label>

          <label style="display:block;font-size:12px;color:var(--text-dim)">
            JSON date entries
            <textarea class="text-input" data-custom-source-json rows="10" spellcheck="false">${escapeHtml(exampleCustomDatesJson())}</textarea>
          </label>

          <div class="compress-actions" style="margin-top:10px">
            <button class="btn primary" data-add-custom-source>
              ${lucide('plus', 14)} Add custom source
            </button>
          </div>
        </section>
      </div>
    </div>
  `;

  modal.querySelector('[data-add-all-de-holidays]')?.addEventListener('click', () => {
    let added = 0;
    let existing = 0;

    for (const source of DE_HOLIDAY_SOURCES) {
      const res = addHolidaySourceCategory(source);

      if (res.added) added++;
      else existing++;
    }

    renderCalendarSourcesModal();
    renderCategoriesModal();

    toast(
      `Holiday sources: ${added} added${existing ? ` · ${existing} already existed` : ''}`,
      'success'
    );
  });

  for (const btn of modal.querySelectorAll('[data-add-de-source]')) {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.addDeSource || '-1', 10);
      const source = DE_HOLIDAY_SOURCES[index];

      if (!source) return;

      const res = addHolidaySourceCategory(source);

      renderCalendarSourcesModal();
      renderCategoriesModal();

      toast(
        res.added
          ? `Added ${source.name || source.label}`
          : `${source.name || source.label} already exists`,
        'success'
      );
    });
  }

  modal.querySelector('[data-add-custom-source]')?.addEventListener('click', () => {
    const name = modal.querySelector('[data-custom-source-name]')?.value?.trim() ||
      'Custom calendar source';

    const color = modal.querySelector('[data-custom-source-color]')?.value ||
      '#4ade80';

    const jsonText = modal.querySelector('[data-custom-source-json]')?.value || '';

    let entries;

    try {
      entries = parseCustomDatesJson(jsonText);
    } catch (err) {
      toast(err?.message || 'Invalid custom source JSON', 'error');
      return;
    }

    putCalendarCategory({
      name,
      color,
      visible: true,
      readonly: true,
      source: {
        type: 'custom-dates',
        title: name,
        entries,
      },
    });

    renderCategoriesModal();

    toast(`Added custom source: ${name}`, 'success');
  });

  modal.hidden = false;
}

// ============================================================
// Categories modal
// ============================================================

function ensureCategoriesModal() {
  if (categoriesModal) return categoriesModal;

  categoriesModal = document.createElement('div');
  categoriesModal.className = 'modal yanta-calendar-categories-modal';
  categoriesModal.hidden = true;

  categoriesModal.addEventListener('click', (e) => {
    if (e.target === categoriesModal) closeCategoriesModal();
    if (e.target.matches('[data-cal-cat-close]')) closeCategoriesModal();
  });

  document.body.append(categoriesModal);

  return categoriesModal;
}

function closeCategoriesModal() {
  if (categoriesModal) categoriesModal.hidden = true;
}

function renderCategoriesModal() {
  const modal = ensureCategoriesModal();

  ensureDefaultCalendarCategory();

  const rows = [...state.calendarCategories.values()]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((cat) => {
      const count = [...state.calendarEvents.values()]
        .filter((ev) => ev.categoryId === cat.id)
        .length;

      const sourceDesc = calendarCategorySourceDescription(cat.source);

      return `
        <div class="yanta-calendar-cat-row" data-cat-id="${escapeAttr(cat.id)}">          <input type="checkbox" data-cat-visible ${cat.visible !== false ? 'checked' : ''} title="Visible" />
          <input type="color" data-cat-color value="${escapeAttr(cat.color || '#6ea8fe')}" />
          <input class="text-input" data-cat-name value="${escapeAttr(cat.name || '')}" />
          <span class="yanta-calendar-cat-count" title="${escapeAttr(sourceDesc || `${count} stored event(s)`)}">
            ${sourceDesc ? 'source' : count}
          </span>
          <button class="icon-btn" data-cat-export-ics title="Export category as .ics">${lucide('calendar-arrow-down', 15)}</button>
          <button class="icon-btn" data-cat-export-json title="Export category as JSON">${lucide('download', 15)}</button>
          <button class="icon-btn danger" data-cat-delete title="Delete category" ${cat.id === DEFAULT_CATEGORY_ID ? 'disabled' : ''}>${lucide('trash', 15)}</button>
        </div>

        <div class="yanta-calendar-cat-share" data-cat-id="${escapeAttr(cat.id)}">
          <span>
            ${
              sourceDesc
                ? `${lucide('calendar-days', 13)} ${escapeHtml(sourceDesc)}`
                : `${lucide('lock', 13)} Sharing prepared but not active`
            }
          </span>
          <small>Category ID: ${escapeHtml(cat.id)}</small>
        </div>
      `;
    })
    .join('');

  modal.innerHTML = `
    <div class="modal-card yanta-calendar-categories-card">
      <header class="modal-head">
        <h3>Calendar categories</h3>
        <button class="icon-btn" data-cal-cat-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-calendar-cat-toolbar">
          <button class="btn primary" data-action="add-category">${lucide('plus', 14)} Add category</button>
          <button class="btn" data-action="sources">${lucide('calendar-plus', 14)} Add data source</button>
          <button class="btn" data-action="import">${lucide('calendar-arrow-up', 14)} Import .ics / JSON</button>
          <button class="btn" data-action="export-all-ics">${lucide('calendar-arrow-down', 14)} Export all .ics</button>
          <button class="btn" data-action="export-all-json">${lucide('download', 14)} Export all JSON</button>
        </div>

        <div class="yanta-calendar-cat-list">
          ${rows || '<div class="tree-empty">No categories yet.</div>'}
        </div>
      </div>
    </div>
  `;

  modal.querySelector('[data-action="add-category"]')?.addEventListener('click', () => {
    const name = prompt('Category name:', 'New calendar');
    if (!name) return;

    putCalendarCategory({
      name: name.trim(),
      color: '#6ea8fe',
      visible: true,
    });

    renderCategoriesModal();
  });

  modal.querySelector('[data-action="sources"]')?.addEventListener('click', () => {
    renderCalendarSourcesModal();
  });

  modal.querySelector('[data-action="import"]')?.addEventListener('click', openCalendarImportPicker);

  modal.querySelector('[data-action="export-all-ics"]')?.addEventListener('click', () => {
    exportEventsAsIcs(currentEventsForCategory(null), {
      filename: 'yanta-calendar.ics',
      calendarName: 'YANTA',
    });
  });

  modal.querySelector('[data-action="export-all-json"]')?.addEventListener('click', () => {
    exportCalendarJson({
      filename: 'yanta-calendar.calendar.json',
    });
  });

  for (const row of modal.querySelectorAll('.yanta-calendar-cat-row')) {
    const catId = row.dataset.catId;

    const save = () => {
      const cat = state.calendarCategories.get(catId);
      if (!cat) return;

      putCalendarCategory({
        ...cat,
        visible: !!row.querySelector('[data-cat-visible]').checked,
        color: row.querySelector('[data-cat-color]').value || cat.color,
        name: row.querySelector('[data-cat-name]').value.trim() || 'Calendar',
      });
    };

    row.querySelector('[data-cat-visible]')?.addEventListener('change', save);
    row.querySelector('[data-cat-color]')?.addEventListener('input', save);
    row.querySelector('[data-cat-name]')?.addEventListener('change', save);

    row.querySelector('[data-cat-export-ics]')?.addEventListener('click', () => {
      const cat = state.calendarCategories.get(catId);
      exportEventsAsIcs(currentEventsForCategory(catId), {
        filename: `${cat?.name || 'calendar'}.ics`,
        calendarName: cat?.name || 'YANTA',
      });
    });

    row.querySelector('[data-cat-export-json]')?.addEventListener('click', () => {
      const cat = state.calendarCategories.get(catId);
      exportCalendarJson({
        categoryId: catId,
        filename: `${cat?.name || 'calendar'}.calendar.json`,
      });
    });

    row.querySelector('[data-cat-delete]')?.addEventListener('click', async () => {
      const cat = state.calendarCategories.get(catId);
      if (!cat || cat.id === DEFAULT_CATEGORY_ID) return;

      const choice = await openDeleteCalendarCategoryDialog(catId);

      if (!choice) return;

      deleteCalendarCategory(catId, {
        eventAction: choice.eventAction,
        targetCategoryId: choice.targetCategoryId,
      });

      renderCategoriesModal();

      toast(
        choice.eventAction === 'delete'
          ? 'Category and events deleted'
          : 'Category deleted and events moved',
        'success'
      );
    });
  }

  modal.hidden = false;
}

// ============================================================
// Calendar surface
// ============================================================

function subtractOneDayKey(dateKey) {
  const d = localDateOnlyToDate(dateKey);
  if (!d) return dateKey;

  d.setDate(d.getDate() - 1);

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${y}-${m}-${day}`;
}

function toNewEventInputFromSelect(info) {
  if (info.allDay) {
    const start = String(info.startStr || '').slice(0, 10);
    const rawEnd = String(info.endStr || '').slice(0, 10);

    const inclusiveEnd =
      rawEnd && rawEnd !== start
        ? subtractOneDayKey(rawEnd)
        : null;

    return {
      title: '',
      start,
      end: inclusiveEnd && inclusiveEnd !== start ? inclusiveEnd : null,
      allDay: true,
    };
  }

  return {
    title: '',
    start: info.start?.toISOString?.() || info.startStr,
    end: info.end?.toISOString?.() || null,
    allDay: false,
  };
}

function toNewEventInputFromDateClick(info) {
  if (!info) return null;

  /*
    Month/dayGrid:
    dateStr ist typischerweise YYYY-MM-DD.
    Wir speichern lokale Mitternacht als ISO, passend zum restlichen Code.
  */
  if (info.allDay) {
    const date = String(info.dateStr || '').slice(0, 10);
    const start = date
      ? new Date(`${date}T00:00:00`).toISOString()
      : info.date?.toISOString?.();

    if (!start) return null;

    return {
      title: '',
      start,
      end: null,
      allDay: true,
    };
  }

  /*
    TimeGrid:
    Tap auf Slot erzeugt standardmäßig ein 1h-Event.
  */
  const startDate = info.date instanceof Date
    ? info.date
    : new Date(info.dateStr || Date.now());

  if (Number.isNaN(startDate.getTime())) return null;

  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  return {
    title: '',
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    allDay: false,
  };
}

export function closeCalendar({
  surface = calendarReturnSurface || 'note',
} = {}) {
  if (calendarMode === 'pane') {
    return;
  }

  const calendarSurface = $('calendarSurface');

  // No-op, wenn der fullscreen calendar gar nicht offen ist.
  // Verhindert unbeabsichtigte Surface-Mutationen durch defensive Aufrufe.
  if (calendarSurface?.hidden !== false && state.surface !== 'calendar') {
    closeEventModal();
    closeCategoriesModal();
    closeCalendarSourcesModal();
    return;
  }

  if (calendarSurface) {
    calendarSurface.hidden = true;
  }
  const targetSurface = surface || 'note';

  state.surface = targetSurface;

  const app = $('app');

  if (app) {
    app.dataset.surface = targetSurface;
  }

  const dash = $('dashboard');

  if (dash) {
    dash.hidden = targetSurface !== 'dashboard';
  }

  closeEventModal();
  closeCategoriesModal();
  closeCalendarSourcesModal();
}

function leaveCalendarSurface() {
  closeCalendar({ surface: 'note' });
}

export function openCalendar({
  push = true,
  replace = false,
} = {}) {
  const surface = $('calendarSurface');

  if (!surface) {
    toast('Calendar surface missing in index.html', 'error');
    return;
  }

  /*
    Idempotenz:
    Wenn der Kalender bereits als Fullscreen-Surface offen ist, darf ein
    erneuter Klick nicht noch einmal einen History-Eintrag pushen.
    Das war die Ursache für "Kalender mehrfach öffnen".
  */
  const alreadySurfaceOpen =
    calendarMode === 'surface' &&
    state.surface === 'calendar' &&
    surface.hidden === false;

  if (calendarMode === 'pane') {
    closeCalendarPane({ silent: true });
  }

  const stillAlreadySurfaceOpen =
    calendarMode === 'surface' &&
    state.surface === 'calendar' &&
    surface.hidden === false;

  if (!stillAlreadySurfaceOpen) {
    calendarReturnSurface =
      state.surface && state.surface !== 'calendar'
        ? state.surface
        : location.hash === '#dashboard'
          ? 'dashboard'
          : 'note';
  }

  state.surface = 'calendar';

  /*
    Nur beim ersten Öffnen pushen.
    Wenn der Kalender schon offen ist, nur Layout/Render aktualisieren.
  */
  if (push && !stillAlreadySurfaceOpen) {
    const method = replace ? 'replaceState' : 'pushState';
    history[method](calendarState(), '', calendarUrl());
  } else if (
    push &&
    replace &&
    history.state?.surface !== 'calendar'
  ) {
    history.replaceState(calendarState(), '', calendarUrl());
  }

  const app = $('app');
  if (app) app.dataset.surface = 'calendar';

  const dash = $('dashboard');
  if (dash) dash.hidden = true;

  surface.hidden = false;

  calendarMode = 'surface';

  if (!calendarOriginalParent) {
    const calendarEl = $('calendar');
    calendarOriginalParent = calendarEl?.parentElement || null;
  }

  const calendarEl = $('calendar');

  if (
    calendarOriginalParent &&
    calendarEl &&
    calendarEl.parentElement !== calendarOriginalParent
  ) {
    calendarOriginalParent.append(calendarEl);
  }

  if (!calendarHydrated) {
    hydrateCalendarStateFromVault();
  }

  if (!fc) {
    setupCalendar();
  }

  renderCalendarTopbar();

  setupCalendarResizeObserver();

  applyCalendarThemeIfChanged();
  applyCalendarThemeToDom();

  resizeCalendarNow({ render: true });

  requestAnimationFrame(() => {
    resizeCalendarNow();
    applyMountedCalendarEventsTheme();
    scheduleCalendarSwipePrewarm();
  });
}

export function openCalendarFromHistory() {
  openCalendar({
    push: false,
    replace: false,
  });
}

// ============================================================
// Setup
// ============================================================

function fcEventDateToStoredValue(date, allDay = false) {
  if (!date) return null;

  if (allDay) {
    return localInputValue(date, true);
  }

  return date.toISOString();
}

function updateMarkdownEventFromFullCalendarInfo(info) {
  const raw = info.event.extendedProps?.raw;
  const markdownRef = raw?.markdownRef || info.event.extendedProps?.markdownRef;

  if (!raw || !markdownRef) {
    info.revert?.();
    return false;
  }

  const next = {
    ...raw,
    start: fcEventDateToStoredValue(info.event.start, info.event.allDay),
    end: raw.end || info.event.end
      ? fcEventDateToStoredValue(info.event.end, info.event.allDay)
      : null,
    allDay: !!info.event.allDay,
    markdownRef,
  };

  if (!next.start) {
    info.revert?.();
    return false;
  }

  const preferredKind =
    markdownRef.kind === 'due' && !next.allDay
      ? 'date'
      : markdownRef.kind;

  const nextToken = serializeMarkdownCalendarRef(
    next,
    preferredKind
  );

  const ok = updateMarkdownCalendarRef({
    ...markdownRef,
    nextToken,
  });

  if (!ok) {
    info.revert?.();
    toast('Could not update linked calendar event', 'error');
    return false;
  }

  window.dispatchEvent(new CustomEvent('yanta-calendar-markdown-changed', {
    detail: {
      noteId: markdownRef.noteId,
      eventId: raw.id,
    },
  }));

  scheduleCalendarRender();

  return true;
}

function applyCalendarPreferencesToFullCalendar() {
  if (!fc) return;

  const prefs = getCalendarPreferences();

  try {
    fc.setOption('locale', fullCalendarLocale(prefs));
    fc.setOption('firstDay', Number(prefs.weekStart));
    fc.setOption('weekNumbers', !!prefs.weekNumbers);
    fc.setOption('weekNumberCalculation', 'ISO');
    fc.setOption('weekText', fullCalendarWeekText(prefs));
    fc.setOption('eventTimeFormat', fullCalendarTimeFormat(prefs));
    fc.setOption('slotLabelFormat', fullCalendarSlotLabelFormat(prefs));
  } catch (err) {
    console.warn('[YANTA Calendar] Could not apply preferences', err);
  }

  renderCalendarTopbar();
  scheduleCalendarResize({ render: true });
}

export function openCalendarEvent(eventId, {
  push = true,
  replace = false,
} = {}) {
  const id = String(eventId || '').trim();
  if (!id) {
    openCalendar({ push, replace });
    return;
  }

  if (push) {
    const method = replace ? 'replaceState' : 'pushState';

    history[method](
      {
        surface: 'calendar',
        eventId: id,
      },
      '',
      `#calendar/${encodeURIComponent(id)}`
    );
  }

  openCalendar({
    push: false,
    replace: false,
  });

  requestAnimationFrame(() => {
    if (!calendarHydrated) {
      hydrateCalendarStateFromVault();
    }

    const ev = state.calendarEvents.get(id);

    if (!ev) {
      toast('Calendar event not found', 'error');
      return;
    }

    try {
      fc?.gotoDate?.(ev.start);
    } catch {}

    requestAnimationFrame(() => {
      openEventEditor({
        id,
        _fromHistory: !push,
      });
    });
  });
}

export function setupCalendar() {
  if (initialized) return;
  initialized = true;

  ensureDefaultCalendarCategory();

  if (!calendarHydrated) {
    hydrateCalendarStateFromVault();
  }

  const host = $('calendar');

  if (!host) {
    console.warn('[YANTA Calendar] #calendar host missing');
    return;
  }

  applyCalendarThemeVarsTo(host);

  fc = new Calendar(host, {
    plugins: [
      dayGridPlugin,
      timeGridPlugin,
      listPlugin,
      interactionPlugin,
    ],

    locales: allLocales,
    locale: fullCalendarLocale(getCalendarPreferences()),
    firstDay: Number(getCalendarPreferences().weekStart),
    weekNumbers: !!getCalendarPreferences().weekNumbers,
    weekNumberCalculation: 'ISO',
    weekText: fullCalendarWeekText(getCalendarPreferences()),
    eventTimeFormat: fullCalendarTimeFormat(getCalendarPreferences()),
    slotLabelFormat: fullCalendarSlotLabelFormat(getCalendarPreferences()),

    initialView: state.currentCalendarView || 'dayGridMonth',

    height: measuredCalendarHeight(),
    contentHeight: measuredCalendarHeight(),
    expandRows: true,
    stickyHeaderDates: true,
    handleWindowResize: true,
    windowResizeDelay: 80,

    nowIndicator: true,

    /*
      FullCalendar long-press selection stays enabled.
      YANTA only suppresses it after a horizontal swipe has been claimed.
    */
    selectable: true,

    /*
      Desktop:
      FullCalendar-DnD bleibt aktiv.

      Mobile:
      FullCalendar-DnD ist aus, damit keine FC-Drag-Mirror entstehen.
      Mobile-DnD läuft über YANTA custom gesture.
    */
    editable: !calendarMobile(),
    selectMirror: true,

    selectMinDistance: calendarMobile() ? 18 : 0,
    eventDragMinDistance: calendarMobile()
      ? CALENDAR_MOBILE_EVENT_DRAG_MIN_DISTANCE_PX
      : 5,

    longPressDelay: calendarMobile() ? 650 : 1000,
    selectLongPressDelay: calendarMobile() ? 650 : 1000,
    eventLongPressDelay: calendarMobile()
      ? CALENDAR_MOBILE_EVENT_LONG_PRESS_MS
      : 1000,
      

    selectAllow() {
      const t = performance.now();
      const p = calendarSwipePointer;

      if (calendarInteractiveSwipeState) return false;
      if (calendarSwipeSelectionSuppressed) return false;
      if (t < calendarSuppressSelectUntil) return false;

      /*
        Während früher Bewegung keine versehentliche Drag-Selection.
        Nach Long-Press darf FullCalendar normal selektieren.
      */
      if (
        calendarMobile() &&
        p?.pointerType === 'touch' &&
        p.mode === 'pending'
      ) {
        /*
          Frühe Bewegung soll keine versehentliche Selection starten.
          Nach Long-Press auf leerer Zelle muss FullCalendar aber wieder
          Range-Selection erlauben.
        */
        if (!p.startedOnEvent && performance.now() - p.startT >= CALENDAR_CELL_SELECT_LONG_PRESS_MS) {
          return true;
        }

        return false;
      }

      if (
        calendarMobile() &&
        p?.pointerType === 'touch' &&
        p.mode === 'cell-longpress'
      ) {
        return false;
      }

      return true;
    },

    dayMaxEvents: true,

    events(fetchInfo, successCallback) {
      const events = buildFullCalendarEventsForRange(
        fetchInfo.start,
        fetchInfo.end
      );

      successCallback(events);
    },

    eventContent: calendarEventContent,

    eventDidMount(info) {
      applyThemeToMountedEvent(info);
      bindCalendarEventDragToMarkdown(info);
    },

    buttonText: {
      today: 'Today',
      month: 'Month',
      week: 'Week',
      day: 'Day',
      list: 'List',
    },

    headerToolbar: false,

    customButtons: {
      categories: {
        text: 'Categories',
        click: renderCategoriesModal,
      },

      import: {
        text: 'Import',
        click: openCalendarImportPicker,
      },

      exportIcs: {
        text: 'Export ICS',
        click: () => {
          exportEventsAsIcs(currentEventsForCategory(null), {
            filename: 'yanta-calendar.ics',
            calendarName: 'YANTA',
          });
        },
      },
    },

    datesSet(info) {
      state.currentCalendarView = info.view.type;

      setCalendarToolbarTitle(info.view.title);
      setCalendarToolbarView(info.view.type);

      invalidateCalendarSwipeCache();
      scheduleCalendarSwipePrewarm();
    },

    dateClick(info) {
      /*
        Mobile wird über YANTA pointerup gehandhabt, weil FullCalendar dateClick
        mit unserer custom Swipe-Schicht nicht zuverlässig genug ist.
        Desktop kann dateClick optional ignorieren; Select bleibt dort aktiv.
      */
      if (calendarMobile()) return;
    },

    select(info) {
      if (
        performance.now() < calendarSuppressSelectUntil ||
        calendarSwipeSelectionSuppressed ||
        calendarInteractiveSwipeState ||
        calendarSwipePointer?.mode === 'swipe' ||
        calendarSwipePointer?.mode === 'manual-scroll'
      ) {
        try {
          fc.unselect();
        } catch {}

        return;
      }

      openEventEditor(toNewEventInputFromSelect(info));

      try {
        fc.unselect();
      } catch {}
    },

    eventClick(info) {
      if (performance.now() < calendarExternalEventSuppressClickUntil) {
        info.jsEvent?.preventDefault?.();
        return;
      }
      /*
        Wenn gerade ein Swipe/Scroll geclaimed wurde, darf ein synthetischer
        Click danach nicht noch den Event-Editor öffnen.
      */
      if (
        calendarInteractiveSwipeState ||
        calendarSwipePointer?.mode === 'swipe' ||
        calendarSwipePointer?.mode === 'manual-scroll' ||
        performance.now() < calendarSuppressSelectUntil
      ) {
        info.jsEvent?.preventDefault?.();
        return;
      }

      const kind = info.event.extendedProps?.yantaKind;

      if (kind === 'markdown-event') {
        info.jsEvent?.preventDefault?.();

        const raw = info.event.extendedProps?.raw;

        if (raw?.markdownRef) {
          openEventEditor({
            ...raw,
            markdownRef: raw.markdownRef,
          });
        }

        return;
      }

      if (kind === 'holiday' || kind === 'calendar-source') {
        info.jsEvent?.preventDefault?.();

        const raw = info.event.extendedProps?.raw;
        const sourceText = raw?.source?.type === 'holidays'
          ? 'Holiday'
          : 'Calendar source';

        toast(`${sourceText}: ${info.event.title}`, 'success');

        return;
      }

      if (kind === 'task') {
        const noteId = info.event.extendedProps?.noteId;

        if (noteId && state.notes.has(noteId)) {
          leaveCalendarSurface();
          openNote(noteId);
        }

        return;
      }

      openEventEditor({
        id: info.event.id,
      });
    },

    eventDrop(info) {
      const kind = info.event.extendedProps?.yantaKind;

      if (kind === 'markdown-event') {
        updateMarkdownEventFromFullCalendarInfo(info);
        return;
      }

      const raw = info.event.extendedProps?.raw;
      if (!raw) return;

      if (raw.readonly || info.event.extendedProps?.readonly) {
        info.revert?.();
        return;
      }

      putCalendarEvent({
        ...raw,
        start: info.event.start?.toISOString(),
        end: info.event.end?.toISOString() || null,
        allDay: info.event.allDay,
      });
    },

    eventResize(info) {
      const kind = info.event.extendedProps?.yantaKind;

      if (kind === 'markdown-event') {
        updateMarkdownEventFromFullCalendarInfo(info);
        return;
      }

      const raw = info.event.extendedProps?.raw;
      if (!raw) return;

      if (raw.readonly || info.event.extendedProps?.readonly) {
        info.revert?.();
        return;
      }

      putCalendarEvent({
        ...raw,
        start: info.event.start?.toISOString(),
        end: info.event.end?.toISOString() || null,
        allDay: info.event.allDay,
      });
    },

  });

  fc.render();

  setupSmoothCalendarNavigation();
  setupCalendarSwipeNavigation();
  installDelegatedCalendarEventDrag();
  installPointerCalendarEventExternalDrag();

  applyCalendarThemeToDom();
  applyMountedCalendarEventsTheme();

  setupCalendarResizeObserver();
  resizeCalendarNow();

  requestAnimationFrame(() => {
    scheduleCalendarSwipePrewarm();
  });

  window.addEventListener('yanta-calendar-updated', () => {
    scheduleCalendarRender();
  });

  window.addEventListener('yanta-vault-hydrated', (e) => {
    /*
      Wenn Sync sagt "nichts geändert", darf Calendar nicht indirekt
      yanta-calendar-updated feuern, sonst rendert das Dashboard trotzdem.
    */
    if (e.detail?.source === 'sync' && e.detail?.changed === false) {
      return;
    }

    hydrateCalendarStateFromVault({
      silent: e.detail?.source === 'sync',
    });

    if (state.currentNoteId) {
      requestAnimationFrame(() => {
        renderCalendarNoteAttachments(state.currentNoteId);
      });
    }
  });

  window.addEventListener('yanta-note-updated', (e) => {
    scheduleCalendarRender();

    const noteId = e.detail?.noteId;

    if (noteId && noteId === state.currentNoteId) {
      requestAnimationFrame(() => {
        renderCalendarNoteAttachments(noteId);
      });
    }
  });

  window.addEventListener('yanta-preview-rendered', () => {
    scheduleCalendarRender();
  });

  window.addEventListener('yanta-calendar-markdown-changed', () => {
    scheduleCalendarRender();
  });

  window.addEventListener('yanta-calendar-preferences-changed', () => {
    applyCalendarPreferencesToFullCalendar();
  });
}

// ============================================================
// ZIP export integration
// ============================================================

export function exportCalendarZipEntries(enc = new TextEncoder()) {
  const events = [...state.calendarEvents.values()];
  const categories = [...state.calendarCategories.values()];

  const entries = [];

  entries.push({
    path: 'calendar/events.calendar.json',
    data: enc.encode(JSON.stringify({
      yantaCalendar: 1,
      exported: new Date().toISOString(),
      categories,
      events,
    }, null, 2)),
  });

  entries.push({
    path: 'calendar/yanta-calendar.ics',
    data: enc.encode(eventsToIcs(events, {
      calendarName: 'YANTA',
    })),
  });

  for (const cat of categories) {
    const catEvents = events.filter((ev) => ev.categoryId === cat.id);

    entries.push({
      path: `calendar/categories/${safeFilename(cat.name || cat.id)}.ics`,
      data: enc.encode(eventsToIcs(catEvents, {
        calendarName: cat.name || 'YANTA',
      })),
    });
  }

  return entries;
}