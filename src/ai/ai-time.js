// ============================================================
// YANTA AI — time as the user experiences it
//
// Single source of truth for every moment that reaches a model.
//
// The problem this module exists to prevent: YANTA stores instants as
// UTC ISO strings ("2026-08-10T14:30:00.000Z"). Handed that string, a
// model reads the digits it sees and reports "14:30" — for a user in
// Berlin the meeting is at 16:30, and the same string misleads by a
// different amount in every other zone. A calendar entry *means* its
// wall clock, so the wall clock is what we send: offset-carrying local
// ISO ("2026-08-10T16:30:00+02:00"), which is both unambiguous as an
// instant and correct to read literally.
//
// All-day entries carry no clock at all. They travel as plain local
// dates ("2026-08-10"), because a UTC instant for an all-day event is
// off by a whole day for half the world.
// ============================================================

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(value, size = 2) {
  return String(Math.abs(Math.trunc(value))).padStart(size, '0');
}

/** True for the bare "YYYY-MM-DD" form, which has no time and no zone. */
function isDateOnly(value) {
  return typeof value === 'string' && DATE_ONLY_RE.test(value.trim());
}

/**
 * Any of our stored shapes → Date, or null.
 *
 * Date-only strings become local midnight, matching how the calendar UI
 * places them. Everything else goes through the platform parser, which
 * reads an explicit offset when present and assumes local time when not.
 */
function toDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value) : null;
  }

  const raw = String(value ?? '').trim();

  if (!raw) return null;

  const d = new Date(isDateOnly(raw) ? `${raw}T00:00:00` : raw);

  return Number.isFinite(d.getTime()) ? d : null;
}

/** The device's IANA zone, e.g. "Europe/Berlin". */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** UTC offset in ISO form for that instant, e.g. "+02:00" — DST included. */
function utcOffsetLabel(value = new Date()) {
  const d = toDate(value) || new Date();
  const minutes = -d.getTimezoneOffset();

  return `${minutes < 0 ? '-' : '+'}${pad(minutes / 60)}:${pad(minutes % 60)}`;
}

/** Local calendar date of an instant, "YYYY-MM-DD". */
export function toLocalDate(value) {
  const d = toDate(value);

  if (!d) return '';

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local wall clock with offset, "2026-08-10T16:30:00+02:00". */
export function toLocalIso(value) {
  const d = toDate(value);

  if (!d) return '';

  return [
    toLocalDate(d),
    'T',
    pad(d.getHours()), ':', pad(d.getMinutes()), ':', pad(d.getSeconds()),
    utcOffsetLabel(d),
  ].join('');
}

/** Readable local rendering in the device's own locale. */
export function formatLocalDateTime(value, { weekday = false } = {}) {
  const d = toDate(value);

  if (!d) return '';

  return d.toLocaleString(undefined, {
    ...(weekday ? { weekday: 'long' } : {}),
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Everything a run or a turn needs to know about "now", in one object.
 * `iso` is machine-readable, `readable` is what the user would say.
 */
export function describeLocalNow(now = Date.now()) {
  const d = toDate(now) || new Date();
  const timeZone = localTimeZone();
  const utcOffset = utcOffsetLabel(d);

  return {
    iso: toLocalIso(d),
    timeZone,
    utcOffset,
    readable: `${formatLocalDateTime(d, { weekday: true })} (${timeZone}, UTC${utcOffset})`,
  };
}

/**
 * The rule that keeps a model from re-deriving times we already got
 * right. Included in the assistant and Pulse system prompts.
 *
 * Built per call, not once at import: a session open across a DST
 * change would otherwise keep quoting the offset it started with.
 */
export function aiTimeRules() {
  return [
    '# Time',
    '',
    `The user's timezone is ${localTimeZone()} (currently UTC${utcOffsetLabel()}).`,
    'Every timestamp YANTA gives you is already local: an ISO datetime carries the user\'s UTC offset, and an all-day value is a plain local date.',
    '- Read and report those wall-clock times exactly as given. Never shift them into UTC or any other zone.',
    '- When you write a datetime back (creating or updating an event), use the same local ISO form with offset.',
    '- Timestamps from outside YANTA (articles, web pages) may be in any zone. Convert them to the user\'s local time before mentioning a clock time.',
  ].join('\n');
}
