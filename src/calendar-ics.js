// ============================================================
// YANTA — Calendar ICS import/export helpers
// Minimal VEVENT-compatible iCalendar support.
// Supports:
// - DTSTART / DTEND
// - all-day VALUE=DATE
// - SUMMARY, DESCRIPTION, LOCATION, GEO, STATUS, UID
// - RRULE preserved
// ============================================================

import {
  state,
  downloadBlob,
  safeFilename,
} from './core.js';

import { normalizePlace } from './places/place.js';

function escapeIcsText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function unescapeIcsText(s) {
  return String(s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function foldLine(line) {
  const max = 75;
  const s = String(line || '');

  if (s.length <= max) return s;

  const out = [];
  let rest = s;

  while (rest.length > max) {
    out.push(rest.slice(0, max));
    rest = ' ' + rest.slice(max);
  }

  out.push(rest);

  return out.join('\r\n');
}

export function toIcsDate(value, allDay = false) {
  if (!value) return '';

  const d = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(d.getTime())) return '';

  if (allDay) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  return d.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateKey(value) {
  if (!value) return '';

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysKey(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;

  d.setDate(d.getDate() + days);

  return localDateKey(d);
}

function subtractOneDayKey(dateKey) {
  return addDaysKey(dateKey, -1);
}

function parseIcsDate(value, params = {}) {
  const raw = String(value || '').trim();

  if (!raw) return null;

  const isDate =
    params.VALUE === 'DATE' ||
    /^\d{8}$/.test(raw);

  if (isDate) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);

    return {
      iso: `${y}-${m}-${d}`,
      allDay: true,
    };
  }

  // UTC: 20260103T120000Z
  let m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);

  if (m) {
    const date = new Date(Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    ));

    return {
      iso: date.toISOString(),
      allDay: false,
    };
  }

  // Floating/local: 20260103T120000
  m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);

  if (m) {
    const date = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    );

    return {
      iso: date.toISOString(),
      allDay: false,
    };
  }

  return null;
}

function unfoldIcs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .reduce((out, line) => {
      if (/^[ \t]/.test(line) && out.length) {
        out[out.length - 1] += line.slice(1);
      } else {
        out.push(line);
      }

      return out;
    }, []);
}

function parseProperty(line) {
  const idx = line.indexOf(':');

  if (idx < 0) {
    return {
      name: line.trim().toUpperCase(),
      params: {},
      value: '',
    };
  }

  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);

  const parts = left.split(';');
  const name = parts.shift().toUpperCase();

  const params = {};

  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;

    const k = p.slice(0, eq).toUpperCase();
    const v = p.slice(eq + 1).replace(/^"|"$/g, '');

    params[k] = v;
  }

  return {
    name,
    params,
    value,
  };
}

function firstProp(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * RFC 5545 `GEO:<lat>;<lon>` into YANTA's place object.
 * Returns undefined for anything unparsable — an imported event keeps its
 * LOCATION string either way.
 */
function parseIcsGeo(raw, locationRaw = '') {
  const [lat, lon] = String(raw || '').split(';').map(Number);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  return normalizePlace({
    latitude: lat,
    longitude: lon,
    label: unescapeIcsText(locationRaw || ''),
    address: unescapeIcsText(locationRaw || ''),
    source: 'ics-import',
  }) || undefined;
}

function parseIcsExdates(values = [], allDay = false) {
  const list = Array.isArray(values)
    ? values
    : values
      ? [values]
      : [];

  const out = [];

  for (const prop of list) {
    const rawValues = String(prop?.value || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

    for (const raw of rawValues) {
      const parsed = parseIcsDate(raw, prop?.params || {});

      if (!parsed?.iso) continue;

      out.push(allDay ? localDateKey(parsed.iso) : parsed.iso);
    }
  }

  return out;
}

export function parseIcsEvents(text) {
  const lines = unfoldIcs(text);
  const events = [];

  let current = null;

  for (const line of lines) {
    const prop = parseProperty(line);

    if (prop.name === 'BEGIN' && prop.value.toUpperCase() === 'VEVENT') {
      current = {};
      continue;
    }

    if (prop.name === 'END' && prop.value.toUpperCase() === 'VEVENT') {
      if (current) {
        const startProp = firstProp(current.DTSTART);
        const endProp = firstProp(current.DTEND);

        const start = startProp
          ? parseIcsDate(startProp.value, startProp.params)
          : null;

        const end = endProp
          ? parseIcsDate(endProp.value, endProp.params)
          : null;

        if (start?.iso) {
          let storedEnd = end?.iso || null;

          // ICS all-day DTEND is exclusive. YANTA stores inclusive.
          if (start.allDay && storedEnd) {
            storedEnd = subtractOneDayKey(localDateKey(storedEnd));

            if (storedEnd === localDateKey(start.iso)) {
              storedEnd = null;
            }
          }

          const rruleProp = firstProp(current.RRULE);
          const uidProp = firstProp(current.UID);
          const summaryProp = firstProp(current.SUMMARY);
          const descriptionProp = firstProp(current.DESCRIPTION);
          const locationProp = firstProp(current.LOCATION);
          const statusProp = firstProp(current.STATUS);
          const geoProp = firstProp(current.GEO);

          events.push({
            externalUid: uidProp?.value || '',
            title: unescapeIcsText(summaryProp?.value || 'Imported event'),
            description: unescapeIcsText(descriptionProp?.value || ''),
            location: unescapeIcsText(locationProp?.value || ''),
            place: parseIcsGeo(geoProp?.value, locationProp?.value),
            status: String(statusProp?.value || 'confirmed').toLowerCase(),
            start: start.iso,
            end: storedEnd,
            allDay: !!start.allDay,
            recurrence: rruleProp?.value
              ? { rrule: rruleProp.value }
              : null,
            recurrenceExceptions: parseIcsExdates(current.EXDATE || [], !!start.allDay),
            recurrenceOverrides: {},
          });
        }
      }

      current = null;
      continue;
    }

    if (!current) continue;

    if (prop.name === 'EXDATE') {
      if (!current.EXDATE) current.EXDATE = [];
      current.EXDATE.push({
        value: prop.value,
        params: prop.params,
      });
      continue;
    }

    if (!current[prop.name]) {
      current[prop.name] = {
        value: prop.value,
        params: prop.params,
      };
    }
  }

  return events;
}

function icsAlarmTrigger(reminder) {
  if (!reminder || reminder.enabled === false) return null;

  const minutes = Math.round(Number(reminder.minutesBefore));
  if (!Number.isFinite(minutes) || minutes < 0) return null;

  if (minutes === 0) return 'PT0S';
  if (minutes % 1440 === 0) return `-P${minutes / 1440}D`;
  if (minutes % 60 === 0) return `-PT${minutes / 60}H`;

  return `-PT${minutes}M`;
}

/*
  "Add to calendar" links for third-party calendars.

  All-day handling mirrors eventsToIcs: YANTA stores inclusive end
  dates, the providers expect exclusive ones.
*/
function allDayEndKeyExclusive(e) {
  return addDaysKey(localDateKey(e.end || e.start), 1);
}

function timedEndIso(e) {
  if (e.end) return e.end;

  // Providers require an end — default to the app's 30-minute slot.
  const d = new Date(e.start);
  if (Number.isNaN(d.getTime())) return e.start;

  return new Date(d.getTime() + 30 * 60 * 1000).toISOString();
}

export function googleCalendarEventUrl(e = {}) {
  if (!e.start) return '';

  const dates = e.allDay
    ? `${toIcsDate(e.start, true)}/${toIcsDate(allDayEndKeyExclusive(e), true)}`
    : `${toIcsDate(e.start)}/${toIcsDate(timedEndIso(e))}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title || 'Untitled event',
    dates,
  });

  if (e.location) params.set('location', e.location);
  if (e.description) params.set('details', e.description);
  if (e.recurrence?.rrule) params.set('recur', `RRULE:${e.recurrence.rrule}`);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarEventUrl(e = {}, {
  office = false,
} = {}) {
  if (!e.start) return '';

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title || 'Untitled event',
  });

  if (e.allDay) {
    params.set('startdt', localDateKey(e.start));
    params.set('enddt', allDayEndKeyExclusive(e));
    params.set('allday', 'true');
  } else {
    params.set('startdt', new Date(e.start).toISOString());
    params.set('enddt', new Date(timedEndIso(e)).toISOString());
  }

  if (e.location) params.set('location', e.location);
  if (e.description) params.set('body', e.description);

  const host = office
    ? 'https://outlook.office.com'
    : 'https://outlook.live.com';

  return `${host}/calendar/0/deeplink/compose?${params.toString()}`;
}

export function eventsToIcs(events, {
  calendarName = 'YANTA',
} = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YANTA//Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  for (const e of events || []) {
    if (!e?.start) continue;
    if (e.status === 'cancelled') continue;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(e.externalUid || e.id || crypto.randomUUID())}@yanta`);

    lines.push(`SUMMARY:${escapeIcsText(e.title || 'Untitled event')}`);

    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toIcsDate(e.start, true)}`);

      if (e.end) {
        // ICS all-day DTEND is exclusive. YANTA stores inclusive.
        lines.push(`DTEND;VALUE=DATE:${toIcsDate(addDaysKey(localDateKey(e.end), 1), true)}`);
      }
    } else {
      lines.push(`DTSTART:${toIcsDate(e.start)}`);

      if (e.end) {
        lines.push(`DTEND:${toIcsDate(e.end)}`);
      }
    }

    if (e.location) {
      lines.push(`LOCATION:${escapeIcsText(e.location)}`);
    }

    // RFC 5545 GEO — lets any calendar app place the event on a map without
    // re-geocoding the LOCATION string.
    if (Number.isFinite(e.place?.latitude) && Number.isFinite(e.place?.longitude)) {
      lines.push(`GEO:${e.place.latitude};${e.place.longitude}`);
    }

    if (e.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    }

    if (e.status) {
      lines.push(`STATUS:${String(e.status).toUpperCase()}`);
    }

    if (e.recurrence?.rrule) {
      lines.push(`RRULE:${e.recurrence.rrule}`);
    }

    for (const reminder of e.reminders || []) {
      const trigger = icsAlarmTrigger(reminder);
      if (!trigger) continue;

      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeIcsText(e.title || 'Reminder')}`);
      lines.push(`TRIGGER:${trigger}`);
      lines.push('END:VALARM');
    }

    for (const ex of e.recurrenceExceptions || []) {
      lines.push(`EXDATE${e.allDay ? ';VALUE=DATE' : ''}:${toIcsDate(ex, !!e.allDay)}`);
    }

    lines.push(`DTSTAMP:${toIcsDate(Date.now())}`);

    if (e.updated) {
      lines.push(`LAST-MODIFIED:${toIcsDate(e.updated)}`);
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function exportEventsAsIcs(events, {
  filename = 'yanta-calendar.ics',
  calendarName = 'YANTA',
} = {}) {
  const ics = eventsToIcs(events, { calendarName });

  downloadBlob(
    new Blob([ics], { type: 'text/calendar;charset=utf-8' }),
    safeFilename(filename)
  );
}

export function exportAllCalendarIcs() {
  exportEventsAsIcs([...state.calendarEvents.values()], {
    filename: 'yanta-calendar.ics',
    calendarName: 'YANTA',
  });
}