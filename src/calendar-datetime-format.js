// ============================================================
// YANTA — Calendar editor date/time text layer
//
// Single source of truth for the *textual* representation of event
// dates in the editor: formatting a Date/ISO into what the user sees,
// and parsing what the user typed back into an ISO string.
//
// Kept free of DOM so both the editor fields
// (calendar-datetime-field.js) and calendar.js can share it.
// ============================================================

import { getCalendarPreferences } from './calendar-preferences.js';
import { isDateOnlyString } from './calendar-recurrence.js';

export { isDateOnlyString };

export function localDateOnlyToDate(value) {
  if (!isDateOnlyString(value)) return null;

  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateLikeToLocalDate(value) {
  if (!value) return null;

  if (isDateOnlyString(value)) {
    return localDateOnlyToDate(value);
  }

  const d = value instanceof Date
    ? value
    : new Date(value);

  return Number.isNaN(d.getTime()) ? null : d;
}

// ------------------------------------------------------------
// Date format description
// ------------------------------------------------------------

const DATE_FORMAT_SEPARATORS = {
  'DD.MM.YYYY': '.',
  'YYYY-MM-DD': '-',
  'MM/DD/YYYY': '/',
  'DD/MM/YYYY': '/',
};

export function calendarEditorDateFormat(prefs = getCalendarPreferences()) {
  return DATE_FORMAT_SEPARATORS[prefs.dateFormat]
    ? prefs.dateFormat
    : 'DD/MM/YYYY';
}

export function calendarEditorDateSeparator(prefs = getCalendarPreferences()) {
  return DATE_FORMAT_SEPARATORS[calendarEditorDateFormat(prefs)];
}

/**
 * Digit group widths of the configured date format, e.g. [2, 2, 4].
 * Drives the typing mask so mobile number keyboards never need a
 * separator key.
 */
export function calendarEditorDateGroups(prefs = getCalendarPreferences()) {
  return calendarEditorDateFormat(prefs) === 'YYYY-MM-DD'
    ? [4, 2, 2]
    : [2, 2, 4];
}

export function calendarEditorDatePlaceholder(allDay = false) {
  const prefs = getCalendarPreferences();
  const date = calendarEditorDateFormat(prefs);

  if (allDay) return date;

  return prefs.timeFormat === '12'
    ? `${date} 2:30 PM`
    : `${date} 14:30`;
}

/**
 * Inserts the format separators while the user types digits.
 * Trailing separators are never added, so the caret can always sit
 * right behind the last typed digit.
 */
export function maskCalendarEditorDatePart(raw, prefs = getCalendarPreferences()) {
  const groups = calendarEditorDateGroups(prefs);
  const separator = calendarEditorDateSeparator(prefs);

  const digits = String(raw || '')
    .replace(/\D/g, '')
    .slice(0, groups.reduce((sum, n) => sum + n, 0));

  const out = [];
  let rest = digits;

  for (const size of groups) {
    if (!rest) break;

    out.push(rest.slice(0, size));
    rest = rest.slice(size);
  }

  return out.join(separator);
}

export function formatCalendarEditorDatePart(date, prefs = getCalendarPreferences()) {
  const d = dateLikeToLocalDate(date);
  if (!d) return '';

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear());

  switch (calendarEditorDateFormat(prefs)) {
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

export function formatCalendarEditorTimePart(date, prefs = getCalendarPreferences()) {
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

export function calendarEditorInputValue(iso, allDay = false) {
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

export function parseCalendarEditorDatePart(raw, prefs = getCalendarPreferences()) {
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

  if (calendarEditorDateFormat(prefs) === 'MM/DD/YYYY') {
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

export function parseCalendarEditorTimePart(raw, prefs = getCalendarPreferences()) {
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

export function splitCalendarEditorDateTime(raw, allDay = false) {
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

export function parseCalendarEditorInput(value, allDay = false) {
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

/**
 * Joins editor segments back into the canonical editor text.
 * Empty segments produce an empty value so "half typed" never
 * looks like a valid date.
 */
export function joinCalendarEditorSegments({
  datePart = '',
  hour = '',
  minute = '',
  meridiem = '',
  allDay = false,
} = {}) {
  const date = String(datePart || '').trim();

  if (!date) return '';
  if (allDay) return date;

  const h = String(hour || '').trim();
  const m = String(minute || '').trim();

  if (!h && !m) return date;

  const time = `${h || '0'}:${(m || '0').padStart(2, '0')}`;

  return meridiem
    ? `${date} ${time} ${meridiem.toUpperCase()}`
    : `${date} ${time}`;
}

/**
 * Splits canonical editor text into the segments the editor fields show.
 * Falls back to raw text for the date part so a half typed value survives.
 */
export function splitCalendarEditorSegments(value, {
  allDay = false,
  prefs = getCalendarPreferences(),
} = {}) {
  const { datePart, timePart } = splitCalendarEditorDateTime(value, allDay);
  const hour12 = prefs.timeFormat === '12';

  const empty = {
    datePart,
    hour: '',
    minute: '',
    meridiem: hour12 ? 'AM' : '',
  };

  if (allDay || !timePart) return empty;

  const parsed = parseCalendarEditorTimePart(timePart, prefs);
  if (!parsed) return empty;

  const h24 = parsed.h;

  return {
    datePart,
    hour: hour12
      ? String(h24 % 12 || 12)
      : String(h24).padStart(2, '0'),
    minute: String(parsed.min).padStart(2, '0'),
    meridiem: hour12 ? (h24 >= 12 ? 'PM' : 'AM') : '',
  };
}
