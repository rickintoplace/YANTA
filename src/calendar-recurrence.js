// ============================================================
// YANTA — Calendar recurrence domain helpers
// ============================================================

import { rrulestr } from 'rrule';

const OCCURRENCE_ID_SEP = '::';
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

export function isDateOnlyString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function localDateKey(value) {
  if (!value) return '';

  if (isDateOnlyString(value)) {
    return value.trim();
  }

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function utcDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dateKeyToLocalDate(dateKey) {
  if (!isDateOnlyString(dateKey)) return null;

  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);

  return Number.isNaN(date.getTime()) ? null : date;
}

function addDaysToDateKey(dateKey, days) {
  const d = dateKeyToLocalDate(dateKey);
  if (!d) return dateKey;

  d.setDate(d.getDate() + days);

  return localDateKey(d);
}

export function dateLikeToDate(value, {
  allDay = false,
} = {}) {
  if (!value) return null;

  if (allDay && isDateOnlyString(value)) {
    return dateKeyToLocalDate(value);
  }

  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toRRuleDate(value) {
  const d = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(d.getTime())) return '';

  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/**
 * All-day RRULEs must not use local midnight converted to UTC.
 *
 * Example Europe/Berlin:
 * local Friday 00:00 === Thursday 22:00Z
 * RRULE BYDAY=FR would then visually drift.
 *
 * We anchor all-day recurrence at 12:00 UTC on the local date.
 * The visible occurrence key is derived from UTC date components.
 */
function toAllDayRRuleDtStart(value) {
  const key = localDateKey(value);
  if (!key) return '';

  return `${key.replace(/-/g, '')}T120000Z`;
}

export function normalizeRecurrence(raw) {
  if (!raw) return null;

  if (typeof raw === 'string') {
    const rrule = raw.replace(/^RRULE:/i, '').trim().toUpperCase();
    return rrule ? { rrule } : null;
  }

  if (typeof raw !== 'object') return null;

  if (raw.rrule) {
    const rrule = String(raw.rrule)
      .replace(/^RRULE:/i, '')
      .trim()
      .toUpperCase();

    return rrule ? { rrule } : null;
  }

  return null;
}

export function hasRecurrence(ev) {
  return !!normalizeRecurrence(ev?.recurrence)?.rrule;
}

export function parseOccurrenceId(id = '') {
  const s = String(id || '');
  const idx = s.indexOf(OCCURRENCE_ID_SEP);

  if (idx < 0) {
    return {
      masterId: s,
      occurrenceKey: '',
      isOccurrence: false,
    };
  }

  return {
    masterId: s.slice(0, idx),
    occurrenceKey: decodeURIComponent(s.slice(idx + OCCURRENCE_ID_SEP.length)),
    isOccurrence: true,
  };
}

export function occurrenceId(masterId, occurrenceKey) {
  return `${masterId}${OCCURRENCE_ID_SEP}${encodeURIComponent(occurrenceKey)}`;
}

export function occurrenceKeyForStart(start, {
  allDay = false,
  fromRRule = false,
} = {}) {
  if (allDay) {
    if (fromRRule) return utcDateKey(start);
    return localDateKey(start);
  }

  const d = dateLikeToDate(start);
  if (!d) return '';

  return d.toISOString();
}

function recurrenceRuleForEvent(ev) {
  const recurrence = normalizeRecurrence(ev?.recurrence);
  if (!recurrence?.rrule) return null;

  const dtstart = dateLikeToDate(ev.start, {
    allDay: !!ev.allDay,
  });

  if (!dtstart) return null;

  const dtstartLine = ev.allDay
    ? `DTSTART:${toAllDayRRuleDtStart(ev.start)}`
    : `DTSTART:${toRRuleDate(dtstart)}`;

  try {
    return rrulestr(
      [
        dtstartLine,
        `RRULE:${recurrence.rrule}`,
      ].join('\n')
    );
  } catch (err) {
    console.warn('[YANTA Calendar] Invalid RRULE', recurrence.rrule, err);
    return null;
  }
}

function allDayInclusiveDurationDays(ev) {
  if (!ev?.allDay) return 0;

  const startKey = localDateKey(ev.start);
  if (!startKey) return 1;

  if (!ev.end) return 1;

  const endKey = localDateKey(ev.end);
  if (!endKey) return 1;

  const start = dateKeyToLocalDate(startKey);
  const end = dateKeyToLocalDate(endKey);

  if (!start || !end) return 1;

  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

function eventDurationMs(ev) {
  const start = dateLikeToDate(ev.start, {
    allDay: !!ev.allDay,
  });

  if (!start) return 0;

  if (ev.allDay) {
    return allDayInclusiveDurationDays(ev) * DAY_MS;
  }

  if (!ev.end) return 0;

  const end = dateLikeToDate(ev.end);
  if (!end) return 0;

  return Math.max(0, end.getTime() - start.getTime());
}

function endForOccurrence(ev, occurrenceStart) {
  if (!ev.end) return null;

  if (ev.allDay) {
    const startKey = utcDateKey(occurrenceStart);
    const days = allDayInclusiveDurationDays(ev);

    if (days <= 1) return null;

    // Stored all-day end in YANTA is inclusive.
    return addDaysToDateKey(startKey, days - 1);
  }

  const duration = eventDurationMs(ev);
  const end = new Date(occurrenceStart.getTime() + duration);

  return end.toISOString();
}

function occurrenceIntersectsRange(ev, rangeStartMs, rangeEndMs) {
  const start = dateLikeToDate(ev.start, {
    allDay: !!ev.allDay,
  });

  if (!start) return false;

  const startMs = start.getTime();

  let endMs = startMs + (ev.allDay ? DAY_MS : 1);

  if (ev.end) {
    const end = dateLikeToDate(ev.end, {
      allDay: !!ev.allDay,
    });

    if (end) {
      // YANTA all-day stored end is inclusive.
      endMs = end.getTime() + (ev.allDay ? DAY_MS : 0);
    }
  }

  return endMs > rangeStartMs && startMs < rangeEndMs;
}

function cleanOverridePatch(raw = {}) {
  const {
    id,
    recurrence,
    recurrenceExceptions,
    recurrenceOverrides,
    recurrenceMasterId,
    occurrenceKey,
    recurrenceOccurrence,
    generated,
    ...patch
  } = raw || {};

  return patch;
}

export function makeOccurrenceFromMaster(master, occurrenceStart) {
  const allDay = !!master.allDay;

  const start = allDay
    ? utcDateKey(occurrenceStart)
    : occurrenceStart.toISOString();

  const key = occurrenceKeyForStart(occurrenceStart, {
    allDay,
    fromRRule: allDay,
  });

  const override = master.recurrenceOverrides?.[key] || null;

  const base = {
    ...master,
    id: occurrenceId(master.id, key),
    start,
    end: endForOccurrence(master, occurrenceStart),
    recurrenceMasterId: master.id,
    occurrenceKey: key,
    recurrenceOccurrence: true,
    generated: true,
  };

  if (!override) return base;

  return {
    ...base,
    ...cleanOverridePatch(override),
    id: base.id,
    recurrenceMasterId: master.id,
    occurrenceKey: key,
    recurrenceOccurrence: true,
    generated: true,
  };
}

export function expandRecurringEvent(master, rangeStart, rangeEnd, {
  maxOccurrences = 800,
} = {}) {
  if (!hasRecurrence(master)) return [];

  const start = dateLikeToDate(rangeStart) || new Date(rangeStart);
  const end = dateLikeToDate(rangeEnd) || new Date(rangeEnd);

  const rangeStartMs = start.getTime();
  const rangeEndMs = end.getTime();

  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) {
    return [];
  }

  const rule = recurrenceRuleForEvent(master);
  if (!rule) return [];

  const duration = eventDurationMs(master);

  const queryStart = new Date(rangeStartMs - Math.max(duration, DAY_MS));
  const queryEnd = end;

  const exceptionSet = new Set(
    Array.isArray(master.recurrenceExceptions)
      ? master.recurrenceExceptions.map(String)
      : []
  );

  const occurrences = [];
  const seenKeys = new Set();

  let starts = [];

  try {
    starts = rule.between(queryStart, queryEnd, true).slice(0, maxOccurrences);
  } catch (err) {
    console.warn('[YANTA Calendar] Could not expand recurrence', master.id, err);
    return [];
  }

  for (const occurrenceStart of starts) {
    const key = occurrenceKeyForStart(occurrenceStart, {
      allDay: !!master.allDay,
      fromRRule: !!master.allDay,
    });

    if (!key) continue;
    if (exceptionSet.has(key)) continue;

    seenKeys.add(key);

    const occurrence = makeOccurrenceFromMaster(master, occurrenceStart);

    if (occurrenceIntersectsRange(occurrence, rangeStartMs, rangeEndMs)) {
      occurrences.push(occurrence);
    }
  }

  for (const [key, override] of Object.entries(master.recurrenceOverrides || {})) {
    if (seenKeys.has(key)) continue;
    if (exceptionSet.has(key)) continue;

    const originalStart = dateLikeToDate(key, {
      allDay: !!master.allDay,
    });

    if (!originalStart) continue;

    const occurrence = {
      ...makeOccurrenceFromMaster(master, originalStart),
      ...cleanOverridePatch(override),
    };

    if (occurrenceIntersectsRange(occurrence, rangeStartMs, rangeEndMs)) {
      occurrences.push(occurrence);
    }
  }

  return occurrences.sort((a, b) => {
    const ad = dateLikeToDate(a.start, { allDay: !!a.allDay })?.getTime() || 0;
    const bd = dateLikeToDate(b.start, { allDay: !!b.allDay })?.getTime() || 0;
    return ad - bd;
  });
}

export function addOccurrenceException(master, occurrenceKey) {
  const key = String(occurrenceKey || '');
  if (!key) return master;

  const exceptions = new Set(
    Array.isArray(master.recurrenceExceptions)
      ? master.recurrenceExceptions.map(String)
      : []
  );

  exceptions.add(key);

  const overrides = {
    ...(master.recurrenceOverrides || {}),
  };

  delete overrides[key];

  return {
    ...master,
    recurrenceExceptions: [...exceptions],
    recurrenceOverrides: overrides,
  };
}

export function addOccurrenceOverride(master, occurrenceKey, patch) {
  const key = String(occurrenceKey || '');
  if (!key) return master;

  return {
    ...master,
    recurrenceOverrides: {
      ...(master.recurrenceOverrides || {}),
      [key]: {
        ...(master.recurrenceOverrides?.[key] || {}),
        ...cleanOverridePatch(patch),
      },
    },
  };
}

export function buildRRuleString({
  freq = '',
  interval = 1,
  byday = [],
  bymonthday = null,
  bysetpos = null,
  count = null,
  until = null,
} = {}) {
  const parts = [];

  const f = String(freq || '').toUpperCase();

  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(f)) {
    return '';
  }

  parts.push(`FREQ=${f}`);

  const i = Math.max(1, Math.min(999, Number(interval || 1)));

  if (i !== 1) {
    parts.push(`INTERVAL=${i}`);
  }

  const days = Array.isArray(byday)
    ? byday.map((x) => String(x).toUpperCase()).filter(Boolean)
    : [];

  if (days.length) {
    parts.push(`BYDAY=${days.join(',')}`);
  }

  if (bymonthday != null && bymonthday !== '') {
    const day = Number(bymonthday);

    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      parts.push(`BYMONTHDAY=${day}`);
    }
  }

  if (bysetpos != null && bysetpos !== '') {
    const pos = Number(bysetpos);

    if (Number.isInteger(pos) && pos >= -5 && pos <= 5 && pos !== 0) {
      parts.push(`BYSETPOS=${pos}`);
    }
  }

  if (count) {
    parts.push(`COUNT=${Math.max(1, Math.min(9999, Number(count)))}`);
  } else if (until) {
    const d = dateLikeToDate(until);

    if (d) {
      parts.push(`UNTIL=${toRRuleDate(d)}`);
    }
  }

  return parts.join(';');
}