// ============================================================
// YANTA — Calendar ICS import/export helpers
// VEVENT import/export. Supports:
// - DTSTART / DTEND or DURATION, all-day VALUE=DATE, TZID + VTIMEZONE
// - SUMMARY, DESCRIPTION, LOCATION, GEO, STATUS, UID, URL
// - RRULE, EXDATE, and RECURRENCE-ID (moved or cancelled single
//   occurrences become overrides/exceptions of their series)
// - VALARM (relative triggers become reminders)
// - ORGANIZER / ATTENDEE and METHOD (REQUEST / REPLY / CANCEL)
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

/* ============================================================
   Time zones

   A `DTSTART;TZID=Europe/Berlin:20260928T150000` is a wall time in that
   zone, not in the reader's zone. Treating it as local — which is what
   a naive parser does — silently shifts every imported invitation for
   anyone whose device is not in the sender's zone.

   Two resolution paths, in the order real clients use them:

   1. The TZID is an IANA name: ask Intl. That covers historic rules and
      every DST change without us shipping a rule table.
   2. It is not (Outlook writes "W. Europe Standard Time"): fall back to
      the VTIMEZONE component the file carries with it, evaluating its
      STANDARD/DAYLIGHT observances for the date in question.
   ============================================================ */

const zoneOffsetCache = new Map();

function isKnownTimeZone(tz) {
  const name = String(tz || '').trim();
  if (!name) return false;

  if (zoneOffsetCache.has(name)) return zoneOffsetCache.get(name);

  let ok = false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    ok = true;
  } catch {
    ok = false;
  }

  zoneOffsetCache.set(name, ok);

  return ok;
}

/*
  Offset of `timeZone` at a given absolute instant, in minutes east of UTC.
  Derived by formatting the instant in that zone and diffing against the
  same wall-clock read as UTC — the standard trick, and exact because
  Intl owns the rules.
*/
function zoneOffsetMinutesAt(instantMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = {};

  for (const p of dtf.formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return Math.round((asUtc - instantMs) / 60000);
}

/*
  Wall time in a zone -> absolute instant.

  Two passes: the first offset guess can be wrong when the wall time sits
  on the far side of a DST transition, so we re-derive the offset at the
  candidate instant and correct once. A third pass never changes anything
  for real zones.
*/
function wallTimeToInstant(y, mo, d, h, mi, s, timeZone) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);

  let offset = zoneOffsetMinutesAt(naive, timeZone);
  let instant = naive - offset * 60000;

  const corrected = zoneOffsetMinutesAt(instant, timeZone);

  if (corrected !== offset) {
    offset = corrected;
    instant = naive - offset * 60000;
  }

  return instant;
}

function parseUtcOffset(raw) {
  const m = String(raw || '').trim().match(/^([+-])(\d{2})(\d{2})(\d{2})?$/);
  if (!m) return null;

  const sign = m[1] === '-' ? -1 : 1;
  const minutes = Number(m[2]) * 60 + Number(m[3]);

  return sign * minutes;
}

/*
  Nth weekday of a month, e.g. BYDAY=-1SU (last Sunday). Returns the day
  of month. n < 0 counts back from the end.
*/
function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();

  return lastDay - ((last - weekday + 7) % 7) + (n + 1) * 7;
}

const ICS_WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/*
  The UTC instant at which an observance takes effect in `year`.
  Transitions are given in the wall time of the offset being left, so the
  switch instant is that wall time minus TZOFFSETFROM.
*/
function observanceTransitionMs(observance, year) {
  const rule = observance.rrule || {};

  let month = Number(rule.BYMONTH || 0);
  let day = 0;

  const start = observance.dtstart || {};

  if (!month) month = start.month || 0;
  if (!month) return null;

  const byday = String(rule.BYDAY || '').trim();
  const m = byday.match(/^(-?\d)?([A-Z]{2})$/);

  if (m && ICS_WEEKDAYS[m[2]] !== undefined) {
    day = nthWeekdayOfMonth(year, month, ICS_WEEKDAYS[m[2]], Number(m[1] || 1));
  } else {
    day = start.day || 1;
  }

  const wall = Date.UTC(
    year,
    month - 1,
    day,
    start.hour || 0,
    start.minute || 0,
    start.second || 0
  );

  return wall - (observance.offsetFrom || 0) * 60000;
}

/*
  Resolve a wall time using the file's own VTIMEZONE: pick the observance
  whose most recent transition precedes the instant. Checks the previous
  year too, so January dates land on the observance that started in
  October.
*/
function wallTimeViaVtimezone(y, mo, d, h, mi, s, vtimezone) {
  const observances = vtimezone?.observances || [];
  if (!observances.length) return null;

  const naive = Date.UTC(y, mo - 1, d, h, mi, s);

  let best = null;

  for (const year of [y - 1, y]) {
    for (const obs of observances) {
      const at = observanceTransitionMs(obs, year);
      if (at == null) continue;

      // Compare in the same frame: the naive wall time minus this
      // observance's offset is the instant it would represent.
      const candidate = naive - (obs.offsetTo || 0) * 60000;

      if (candidate >= at && (!best || at > best.at)) {
        best = { at, offset: obs.offsetTo || 0 };
      }
    }
  }

  if (!best) {
    const fallback = observances.find((o) => o.type === 'STANDARD') || observances[0];
    return naive - (fallback.offsetTo || 0) * 60000;
  }

  return naive - best.offset * 60000;
}

function parseIcsDate(value, params = {}, vtimezones = null) {
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

  // Zoned or floating: 20260103T120000
  m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);

  if (m) {
    const [, ys, mos, ds, hs, mis, ss] = m;
    const y = Number(ys);
    const mo = Number(mos);
    const d = Number(ds);
    const h = Number(hs);
    const mi = Number(mis);
    const s = Number(ss);

    const tzid = String(params.TZID || '').trim();

    if (tzid) {
      if (isKnownTimeZone(tzid)) {
        return {
          iso: new Date(wallTimeToInstant(y, mo, d, h, mi, s, tzid)).toISOString(),
          allDay: false,
          tzid,
        };
      }

      /*
        Not an IANA name (Outlook and friends). The file has to carry a
        VTIMEZONE for it — that is what it is for.
      */
      const viaFile = wallTimeViaVtimezone(y, mo, d, h, mi, s, vtimezones?.get(tzid));

      if (viaFile != null) {
        return {
          iso: new Date(viaFile).toISOString(),
          allDay: false,
          tzid,
        };
      }
    }

    // Genuinely floating: RFC 5545 says interpret in the local zone.
    const date = new Date(y, mo - 1, d, h, mi, s);

    return {
      iso: date.toISOString(),
      allDay: false,
    };
  }

  return null;
}

/*
  Collect VTIMEZONE components so a non-IANA TZID can still be resolved.
  Only what the fallback needs: each observance's offsets and its yearly
  transition rule.
*/
function parseVtimezones(lines) {
  const zones = new Map();

  let zone = null;
  let observance = null;

  for (const line of lines) {
    const prop = parseProperty(line);
    const upper = String(prop.value || '').toUpperCase();

    if (prop.name === 'BEGIN' && upper === 'VTIMEZONE') {
      zone = { tzid: '', observances: [] };
      continue;
    }

    if (prop.name === 'END' && upper === 'VTIMEZONE') {
      if (zone?.tzid) zones.set(zone.tzid, zone);
      zone = null;
      continue;
    }

    if (!zone) continue;

    if (prop.name === 'BEGIN' && (upper === 'STANDARD' || upper === 'DAYLIGHT')) {
      observance = { type: upper, rrule: {}, dtstart: null, offsetFrom: 0, offsetTo: 0 };
      continue;
    }

    if (prop.name === 'END' && (upper === 'STANDARD' || upper === 'DAYLIGHT')) {
      if (observance) zone.observances.push(observance);
      observance = null;
      continue;
    }

    if (!observance) {
      if (prop.name === 'TZID') zone.tzid = String(prop.value || '').trim();
      continue;
    }

    if (prop.name === 'TZOFFSETFROM') {
      observance.offsetFrom = parseUtcOffset(prop.value) ?? 0;
    } else if (prop.name === 'TZOFFSETTO') {
      observance.offsetTo = parseUtcOffset(prop.value) ?? 0;
    } else if (prop.name === 'DTSTART') {
      const m = String(prop.value || '').match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/
      );

      if (m) {
        observance.dtstart = {
          year: Number(m[1]),
          month: Number(m[2]),
          day: Number(m[3]),
          hour: Number(m[4]),
          minute: Number(m[5]),
          second: Number(m[6]),
        };
      }
    } else if (prop.name === 'RRULE') {
      for (const part of String(prop.value || '').split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;

        observance.rrule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
      }
    }
  }

  return zones;
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

function parseIcsExdates(values = [], allDay = false, vtimezones = null) {
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
      const parsed = parseIcsDate(raw, prop?.params || {}, vtimezones);

      if (!parsed?.iso) continue;

      out.push(allDay ? localDateKey(parsed.iso) : parsed.iso);
    }
  }

  return out;
}

/* ============================================================
   Scheduling participants (RFC 5545 / iTIP)

   ORGANIZER and ATTENDEE carry who was invited and how each of them
   answered. PARTSTAT is the answer; without it an invitation looks like
   a plain appointment and the whole point of receiving it is lost.
   ============================================================ */

const PARTSTAT_TO_STATUS = {
  'NEEDS-ACTION': 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  DELEGATED: 'delegated',
  COMPLETED: 'accepted',
  'IN-PROCESS': 'pending',
};

const ROLE_TO_ROLE = {
  CHAIR: 'chair',
  'REQ-PARTICIPANT': 'required',
  'OPT-PARTICIPANT': 'optional',
  'NON-PARTICIPANT': 'observer',
};

/*
  CAL-ADDRESS values are URIs — "mailto:a@b.c" in practice, but the
  scheme is not guaranteed, so keep the raw value alongside the address.
*/
function parseCalAddress(prop) {
  if (!prop) return null;

  const raw = String(prop.value || '').trim();
  if (!raw) return null;

  const params = prop.params || {};
  const email = /^mailto:/i.test(raw) ? raw.slice(7).trim() : '';

  const name = unescapeIcsText(String(params.CN || '').trim());

  return {
    email,
    uri: raw,
    name: name || email || raw,
    status: PARTSTAT_TO_STATUS[String(params.PARTSTAT || '').toUpperCase()] || 'pending',
    role: ROLE_TO_ROLE[String(params.ROLE || '').toUpperCase()] || 'required',
    rsvp: String(params.RSVP || '').toUpperCase() === 'TRUE',
    type: String(params.CUTYPE || 'INDIVIDUAL').toUpperCase() === 'RESOURCE'
      ? 'resource'
      : 'individual',
  };
}

/**
 * Full parse: calendar-level METHOD plus the events it carries.
 *
 * METHOD decides what the file MEANS — REQUEST is an invitation, REPLY is
 * somebody answering one, CANCEL withdraws it. Importing all three as
 * "a new event" is the classic way to end up with duplicates and with
 * cancelled meetings still sitting in the calendar.
 */
export function parseIcsCalendar(text) {
  const lines = unfoldIcs(text);
  const vtimezones = parseVtimezones(lines);

  let method = '';

  for (const line of lines) {
    const prop = parseProperty(line);

    if (prop.name === 'METHOD') {
      method = String(prop.value || '').trim().toUpperCase();
      break;
    }

    if (prop.name === 'BEGIN' && String(prop.value).toUpperCase() === 'VEVENT') break;
  }

  return {
    method: method || 'PUBLISH',
    events: parseIcsEvents(text, { vtimezones }),
  };
}

/** RFC 5545 DURATION ("PT1H30M", "-P1D", "P2W") in milliseconds, or null. */
function parseIcsDuration(raw) {
  const m = String(raw || '').trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m || m[0].length <= 2) return null;

  const [, sign, w, d, h, mi, sec] = m;
  const ms = ((Number(w || 0) * 7 + Number(d || 0)) * 86400 +
    Number(h || 0) * 3600 + Number(mi || 0) * 60 + Number(sec || 0)) * 1000;

  return sign === '-' ? -ms : ms;
}

/*
  A VALARM with a relative TRIGGER ("-PT15M", "-P1D") is a reminder YANTA
  understands: minutes before the start. Alarms relative to the end, or
  at an absolute time, have no equivalent and are left out.
*/
function remindersFromAlarms(alarms = []) {
  const out = [];

  for (const alarm of alarms) {
    const trigger = alarm.TRIGGER;
    if (!trigger) continue;
    if (String(trigger.params?.VALUE || '').toUpperCase() === 'DATE-TIME') continue;
    if (String(trigger.params?.RELATED || 'START').toUpperCase() !== 'START') continue;

    const ms = parseIcsDuration(trigger.value);
    if (ms == null || ms > 0) continue;

    const minutesBefore = Math.round(-ms / 60000);
    if (!out.some((r) => r.minutesBefore === minutesBefore)) out.push({ minutesBefore });
  }

  return out.slice(0, 12);
}

export function parseIcsEvents(text, { vtimezones: providedZones = null } = {}) {
  const lines = unfoldIcs(text);
  const vtimezones = providedZones || parseVtimezones(lines);
  const events = [];

  let current = null;
  let inVevent = false;

  for (const line of lines) {
    const prop = parseProperty(line);

    /*
      Skip nested components (VALARM, and VTIMEZONE handled separately):
      their DTSTART must never be mistaken for the event's.
    */
    if (prop.name === 'BEGIN' && prop.value.toUpperCase() === 'VEVENT') {
      current = {};
      inVevent = true;
      continue;
    }

    if (inVevent && prop.name === 'BEGIN' && prop.value.toUpperCase() !== 'VEVENT') {
      inVevent = false;
      // An alarm's TRIGGER is kept; everything else nested is skipped.
      if (prop.value.toUpperCase() === 'VALARM' && current) {
        current.__alarm = {};
        (current.__alarms ||= []).push(current.__alarm);
      }
      continue;
    }

    if (!inVevent && prop.name === 'END' && current &&
        prop.value.toUpperCase() !== 'VEVENT') {
      inVevent = true;
      current.__alarm = null;
      continue;
    }

    if (!inVevent && current?.__alarm && prop.name === 'TRIGGER') {
      current.__alarm.TRIGGER = { value: prop.value, params: prop.params };
      continue;
    }

    if (prop.name === 'END' && prop.value.toUpperCase() === 'VEVENT') {
      if (current) {
        const startProp = firstProp(current.DTSTART);
        const endProp = firstProp(current.DTEND);

        const start = startProp
          ? parseIcsDate(startProp.value, startProp.params, vtimezones)
          : null;

        let end = endProp
          ? parseIcsDate(endProp.value, endProp.params, vtimezones)
          : null;

        // No DTEND: RFC 5545 allows a DURATION instead.
        const durationMs = !end ? parseIcsDuration(firstProp(current.DURATION)?.value) : null;

        if (start?.iso && durationMs > 0) {
          if (start.allDay) {
            const days = Math.max(1, Math.round(durationMs / 86400000));
            end = { iso: addDaysKey(start.iso, days), allDay: true };
          } else {
            end = { iso: new Date(new Date(start.iso).getTime() + durationMs).toISOString(), allDay: false };
          }
        }

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
          const sequenceProp = firstProp(current.SEQUENCE);
          const urlProp = firstProp(current.URL);
          const recurrenceIdProp = firstProp(current['RECURRENCE-ID']);

          // YANTA has no URL field; the link goes where people will see it.
          const url = String(urlProp?.value || '').trim();
          let description = unescapeIcsText(descriptionProp?.value || '');
          if (/^https?:\/\//i.test(url) && !description.includes(url)) {
            description = description ? `${description}\n\n${url}` : url;
          }

          const organizer = parseCalAddress(firstProp(current.ORGANIZER));

          const attendees = (Array.isArray(current.ATTENDEE)
            ? current.ATTENDEE
            : current.ATTENDEE ? [current.ATTENDEE] : []
          )
            .map(parseCalAddress)
            .filter(Boolean);

          events.push({
            externalUid: uidProp?.value || '',
            sequence: Number.isFinite(Number(sequenceProp?.value))
              ? Number(sequenceProp.value)
              : 0,
            organizer,
            attendees,
            startTzid: start.tzid || '',
            title: unescapeIcsText(summaryProp?.value || 'Imported event'),
            description,
            location: unescapeIcsText(locationProp?.value || ''),
            place: parseIcsGeo(geoProp?.value, locationProp?.value),
            status: String(statusProp?.value || 'confirmed').toLowerCase(),
            start: start.iso,
            end: storedEnd,
            allDay: !!start.allDay,
            recurrence: rruleProp?.value
              ? { rrule: rruleProp.value }
              : null,
            recurrenceExceptions: parseIcsExdates(
              current.EXDATE || [],
              !!start.allDay,
              vtimezones
            ),
            recurrenceOverrides: {},
            reminders: remindersFromAlarms(current.__alarms),
            // Set on a single changed occurrence of a series; folded into
            // its master below.
            recurrenceId: recurrenceIdProp
              ? parseIcsExdates([recurrenceIdProp], !!start.allDay, vtimezones)[0] || ''
              : '',
          });
        }
      }

      current = null;
      continue;
    }

    // Inside a nested component (VALARM …): its DESCRIPTION, DTSTART and
    // so on belong to it, not to the event. They used to leak through.
    if (!current || !inVevent) continue;

    // Properties that may legitimately repeat.
    if (prop.name === 'EXDATE' || prop.name === 'ATTENDEE') {
      if (!current[prop.name]) current[prop.name] = [];
      current[prop.name].push({
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

  return foldRecurrenceInstances(events);
}

/*
  RECURRENCE-ID: Outlook, Google and Apple export a moved or edited
  occurrence as its own VEVENT with the series' UID. Imported as is, the
  series shows the occurrence at its old time *and* the copy at the new
  one. Folded into the master, it becomes what YANTA's own editor makes:
  an override for that occurrence, or an exception when it is cancelled.
*/
function foldRecurrenceInstances(events) {
  const masters = new Map();

  for (const ev of events) {
    if (ev.recurrence && !ev.recurrenceId && ev.externalUid) masters.set(ev.externalUid, ev);
  }

  const out = [];

  for (const ev of events) {
    const master = ev.recurrenceId ? masters.get(ev.externalUid) : null;

    if (!master) {
      delete ev.recurrenceId;
      out.push(ev);
      continue;
    }

    const key = ev.recurrenceId;

    if (ev.status === 'cancelled') {
      if (!master.recurrenceExceptions.includes(key)) master.recurrenceExceptions.push(key);
      continue;
    }

    master.recurrenceOverrides[key] = {
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      title: ev.title,
      description: ev.description,
      location: ev.location,
      ...(ev.place ? { place: ev.place } : {}),
      status: ev.status,
    };
  }

  return out;
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

    // An imported event keeps its original UID, so the other calendar
    // recognises it as the same event; YANTA's own events get a stable one.
    const uid = e.externalUid || `${e.id || crypto.randomUUID()}@yanta`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(uid)}`);

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

    // Moved or edited single occurrences: one VEVENT each, tied to the
    // series by UID and RECURRENCE-ID (what the importer folds back).
    if (e.recurrence?.rrule) {
      for (const [key, o] of Object.entries(e.recurrenceOverrides || {})) {
        if (!o) continue;
        const allDay = o.allDay ?? !!e.allDay;
        const start = o.start || key;

        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${escapeIcsText(uid)}`);
        lines.push(`RECURRENCE-ID${e.allDay ? ';VALUE=DATE' : ''}:${toIcsDate(key, !!e.allDay)}`);
        lines.push(`SUMMARY:${escapeIcsText(o.title || e.title || 'Untitled event')}`);
        if (allDay) {
          lines.push(`DTSTART;VALUE=DATE:${toIcsDate(start, true)}`);
          if (o.end) lines.push(`DTEND;VALUE=DATE:${toIcsDate(addDaysKey(localDateKey(o.end), 1), true)}`);
        } else {
          lines.push(`DTSTART:${toIcsDate(start)}`);
          if (o.end) lines.push(`DTEND:${toIcsDate(o.end)}`);
        }
        const location = o.location ?? e.location;
        if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
        const description = o.description ?? e.description;
        if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
        if (o.status) lines.push(`STATUS:${String(o.status).toUpperCase()}`);
        lines.push(`DTSTAMP:${toIcsDate(Date.now())}`);
        lines.push('END:VEVENT');
      }
    }
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