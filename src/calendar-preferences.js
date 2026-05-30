// ============================================================
// YANTA — Calendar preferences
//
// Centralized user-configurable calendar display behavior:
// - locale
// - date format
// - event editor preview style
// - time format
// - week start
// - week numbers
// ============================================================

import {
  store,
} from './core.js';

export const CALENDAR_PREFS_KEY = 'calendar.preferences.v1';

export const CALENDAR_DATE_FORMATS = [
  {
    id: 'DD/MM/YYYY',
    label: 'DD/MM/YYYY',
    example: '30/05/2026',
  },
  {
    id: 'DD.MM.YYYY',
    label: 'DD.MM.YYYY',
    example: '30.05.2026',
  },
  {
    id: 'YYYY-MM-DD',
    label: 'YYYY-MM-DD',
    example: '2026-05-30',
  },
  {
    id: 'MM/DD/YYYY',
    label: 'MM/DD/YYYY',
    example: '05/30/2026',
  },
];

export const CALENDAR_EDITOR_DATE_STYLES = [
  {
    id: 'long',
    label: 'Long localized',
    exampleDe: 'Samstag, 30. Mai 2026 14:00',
    exampleEn: 'Saturday, 30 May 2026 14:00',
  },
  {
    id: 'compact',
    label: 'Compact',
    exampleDe: '30/05/2026 14:00',
    exampleEn: '30/05/2026 14:00',
  },
];

export const CALENDAR_LOCALES = [
  {
    id: 'auto',
    label: 'Auto',
  },
  {
    id: 'de',
    label: 'Deutsch',
  },
  {
    id: 'en-GB',
    label: 'English UK',
  },
  {
    id: 'en-US',
    label: 'English US',
  },
  {
    id: 'fr',
    label: 'Français',
  },
  {
    id: 'es',
    label: 'Español',
  },
  {
    id: 'it',
    label: 'Italiano',
  },
  {
    id: 'nl',
    label: 'Nederlands',
  },
];

export const CALENDAR_WEEK_STARTS = [
  {
    id: 1,
    label: 'Monday',
  },
  {
    id: 0,
    label: 'Sunday',
  },
  {
    id: 6,
    label: 'Saturday',
  },
];

export const CALENDAR_TIME_FORMATS = [
  {
    id: '24',
    label: '24-hour',
    example: '14:30',
  },
  {
    id: '12',
    label: '12-hour',
    example: '2:30 PM',
  },
];

export const DEFAULT_CALENDAR_PREFERENCES = {
  locale: 'auto',

  // Compact numeric display default requested by user.
  dateFormat: 'DD/MM/YYYY',

  // Event editor helper display.
  editorDateStyle: 'long',

  // ISO-ish default.
  timeFormat: '24',
  weekStart: 1,

  // Less visual clutter by default; user can enable.
  weekNumbers: false,
};

let calendarPreferences = {
  ...DEFAULT_CALENDAR_PREFERENCES,
};

function cleanPrefs(raw = {}) {
  const next = {
    ...DEFAULT_CALENDAR_PREFERENCES,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  if (!CALENDAR_DATE_FORMATS.some((x) => x.id === next.dateFormat)) {
    next.dateFormat = DEFAULT_CALENDAR_PREFERENCES.dateFormat;
  }

  if (!CALENDAR_EDITOR_DATE_STYLES.some((x) => x.id === next.editorDateStyle)) {
    next.editorDateStyle = DEFAULT_CALENDAR_PREFERENCES.editorDateStyle;
  }

  if (!CALENDAR_LOCALES.some((x) => x.id === next.locale)) {
    next.locale = DEFAULT_CALENDAR_PREFERENCES.locale;
  }

  if (!CALENDAR_TIME_FORMATS.some((x) => x.id === next.timeFormat)) {
    next.timeFormat = DEFAULT_CALENDAR_PREFERENCES.timeFormat;
  }

  const weekStartNumber = Number(next.weekStart);

  next.weekStart = CALENDAR_WEEK_STARTS.some((x) => x.id === weekStartNumber)
    ? weekStartNumber
    : DEFAULT_CALENDAR_PREFERENCES.weekStart;

  next.weekNumbers = next.weekNumbers === true;

  return next;
}

export async function loadCalendarPreferences() {
  try {
    calendarPreferences = cleanPrefs(
      await store.settings.get(CALENDAR_PREFS_KEY, DEFAULT_CALENDAR_PREFERENCES)
    );
  } catch {
    calendarPreferences = {
      ...DEFAULT_CALENDAR_PREFERENCES,
    };
  }

  return getCalendarPreferences();
}

export function getCalendarPreferences() {
  return {
    ...calendarPreferences,
  };
}

export async function saveCalendarPreferences(patch = {}) {
  calendarPreferences = cleanPrefs({
    ...calendarPreferences,
    ...patch,
  });

  await store.settings.set(CALENDAR_PREFS_KEY, calendarPreferences);

  window.dispatchEvent(new CustomEvent('yanta-calendar-preferences-changed', {
    detail: {
      preferences: getCalendarPreferences(),
    },
  }));

  return getCalendarPreferences();
}

export function resetCalendarPreferences() {
  return saveCalendarPreferences({
    ...DEFAULT_CALENDAR_PREFERENCES,
  });
}

export function resolvedCalendarLocale(prefs = getCalendarPreferences()) {
  if (prefs.locale && prefs.locale !== 'auto') {
    return prefs.locale;
  }

  return navigator.language || 'en-GB';
}

export function fullCalendarLocale(prefs = getCalendarPreferences()) {
  const loc = resolvedCalendarLocale(prefs);

  if (loc.toLowerCase().startsWith('de')) return 'de';
  if (loc.toLowerCase().startsWith('fr')) return 'fr';
  if (loc.toLowerCase().startsWith('es')) return 'es';
  if (loc.toLowerCase().startsWith('it')) return 'it';
  if (loc.toLowerCase().startsWith('nl')) return 'nl';

  if (loc === 'en-US') return 'en';
  if (loc.toLowerCase().startsWith('en')) return 'en-gb';

  return loc;
}

export function calendarHour12(prefs = getCalendarPreferences()) {
  return prefs.timeFormat === '12';
}

export function fullCalendarWeekText(prefs = getCalendarPreferences()) {
  const loc = resolvedCalendarLocale(prefs).toLowerCase();

  if (loc.startsWith('de')) return 'W';
  if (loc.startsWith('fr')) return 'S';
  if (loc.startsWith('nl')) return 'W';

  return 'W';
}

export function fullCalendarTimeFormat(prefs = getCalendarPreferences()) {
  return {
    hour: '2-digit',
    minute: '2-digit',
    hour12: calendarHour12(prefs),
  };
}

export function fullCalendarSlotLabelFormat(prefs = getCalendarPreferences()) {
  return {
    hour: '2-digit',
    minute: '2-digit',
    hour12: calendarHour12(prefs),
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toDate(value) {
  if (!value) return null;

  const d = value instanceof Date
    ? value
    : new Date(value);

  return Number.isNaN(d.getTime()) ? null : d;
}

function numericDate(d, prefs = getCalendarPreferences()) {
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
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

export function formatCalendarTime(value, prefs = getCalendarPreferences()) {
  const d = toDate(value);
  if (!d) return '';

  try {
    return new Intl.DateTimeFormat(resolvedCalendarLocale(prefs), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: calendarHour12(prefs),
    }).format(d);
  } catch {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

export function formatCalendarDate(value, {
  weekday = false,
  long = false,
  prefs = getCalendarPreferences(),
} = {}) {
  const d = toDate(value);
  if (!d) return '';

  if (!long) {
    if (!weekday) return numericDate(d, prefs);

    try {
      const wd = new Intl.DateTimeFormat(resolvedCalendarLocale(prefs), {
        weekday: 'short',
      }).format(d);

      return `${wd}, ${numericDate(d, prefs)}`;
    } catch {
      return numericDate(d, prefs);
    }
  }

  try {
    return new Intl.DateTimeFormat(resolvedCalendarLocale(prefs), {
      weekday: weekday ? 'long' : undefined,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return numericDate(d, prefs);
  }
}

export function formatCalendarDateTime(value, {
  allDay = false,
  editor = false,
  includeWeekday = true,
  prefs = getCalendarPreferences(),
} = {}) {
  const d = toDate(value);
  if (!d) return '';

  const useLong =
    editor &&
    prefs.editorDateStyle === 'long';

  const date = formatCalendarDate(d, {
    weekday: includeWeekday,
    long: useLong,
    prefs,
  });

  if (allDay) return date;

  return `${date} ${formatCalendarTime(d, prefs)}`;
}

export function compactCalendarDateTime(value, {
  allDay = false,
  prefs = getCalendarPreferences(),
} = {}) {
  return formatCalendarDateTime(value, {
    allDay,
    editor: false,
    includeWeekday: false,
    prefs,
  });
}