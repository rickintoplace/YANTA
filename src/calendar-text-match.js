// ============================================================
// YANTA — which existing event a message moves or cancels
//
// "Zahnarzt verschoben vom 3.12. auf den 10.12." or "Yoga fällt am
// Donnerstag aus" is about an event that is already in the calendar.
// Making a second one would leave the old one standing, so this finds
// it: an upcoming, single (not recurring) event whose title words the
// message uses, preferably on a day the message names.
//
// Pure: the events come in, the result is a proposal. Nothing changes
// until the user confirms it.
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

const STOPWORDS = new Set([
  'termin', 'appointment', 'meeting', 'event', 'with', 'mit', 'beim', 'bei', 'für', 'from', 'this', 'that',
  'heute', 'morgen', 'today', 'tomorrow', 'woche', 'week', 'uhr', 'ganztägig',
]);

// First five letters of each real word: "Zahnarzttermin" meets "Zahnarzt".
function stems(text) {
  return [...new Set(
    (String(text || '').toLowerCase().match(/[\p{L}]{4,}/gu) || [])
      .filter((w) => !STOPWORDS.has(w))
      .map((w) => w.slice(0, 5))
  )];
}

function localDayKey(value) {
  if (!value) return '';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startMs(ev) {
  const raw = String(ev?.start || '');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  return d.getTime();
}

/** 'reschedule', 'cancel' or '' — what the draft says it does. */
export function changeKind(draft) {
  if (draft?.kind === 'reschedule' || draft?.flags?.includes('reschedule')) return 'reschedule';
  if (draft?.kind === 'cancel' || draft?.flags?.includes('cancel')) return 'cancel';
  return '';
}

/*
  The new start and end for a moved event. A day without a time keeps
  the event's own time of day ("auf Freitag verschoben"), and the
  length always stays.
*/
export function movedTimes(event, draft) {
  const oldStart = startMs(event);
  const oldEnd = event.end ? startMs({ start: event.end }) : NaN;
  const length = Number.isFinite(oldEnd) && oldEnd > oldStart ? oldEnd - oldStart : (event.allDay ? 0 : 60 * 60 * 1000);

  const target = new Date(draft.start);

  // All-day events are stored from local midnight, like the editor does.
  if (event.allDay) {
    const day = new Date(target);
    day.setHours(0, 0, 0, 0);
    const days = Math.round(length / DAY_MS);
    const end = days > 0 ? new Date(day.getTime() + days * DAY_MS) : null;
    return { start: day.toISOString(), end: end ? end.toISOString() : null, allDay: true };
  }

  if (draft.allDay) {
    const old = new Date(oldStart);
    target.setHours(old.getHours(), old.getMinutes(), 0, 0);
  }

  return {
    start: target.toISOString(),
    end: new Date(target.getTime() + length).toISOString(),
    allDay: false,
  };
}

/*
  Where a moved event goes: the draft's moment, unless that is the day
  the event is already on ("vom 3.12. auf den 10.12." read the wrong way
  round) — then the message's other day.
*/
export function rescheduleTarget(draft, event) {
  const eventDay = localDayKey(event.start);
  if (localDayKey(draft.start) !== eventDay) return draft;

  const other = (draft.others || []).find((o) => localDayKey(o.start instanceof Date ? o.start.toISOString() : o.start) !== eventDay);
  if (!other) return draft;

  return {
    start: (other.start instanceof Date ? other.start : new Date(other.start)).toISOString(),
    allDay: !!other.allDay,
  };
}

/**
 * The event the draft moves or cancels, or null.
 *
 * @param {object} draft  from draftEventFromText (flags, others, title…)
 * @param {object[]} events  stored calendar events
 * @returns {null | { kind: string, event: object, score: number }}
 */
export function findEventToChange(draft, events, { now = Date.now() } = {}) {
  const kind = changeKind(draft);
  if (!kind) return null;

  const message = stems(`${draft.description || ''} ${draft.title || ''}`);
  if (!message.length) return null;

  // Days the message names. For a move the old day may be either one —
  // the parser does not know which of "vom 3.12. auf den 10.12." is
  // the old; rescheduleTarget sorts that out once the event is known.
  const namedDays = new Set([
    localDayKey(draft.start),
    ...(kind === 'reschedule' ? (draft.others || []).map((o) => localDayKey(o.start instanceof Date ? o.start.toISOString() : o.start)) : []),
  ].filter(Boolean));

  const scored = [];

  for (const ev of events || []) {
    if (!ev?.id || ev.status === 'cancelled' || ev.recurrence?.rrule) continue;

    const at = startMs(ev);
    if (!Number.isFinite(at) || at < now - DAY_MS || at > now + 400 * DAY_MS) continue;

    const titleStems = stems(ev.title);
    if (!titleStems.length) continue;

    const hits = titleStems.filter((s) => message.includes(s)).length;
    if (!hits || hits / titleStems.length < 0.5) continue;

    const dayHit = namedDays.has(localDayKey(ev.start));
    scored.push({ ev, at, score: hits * 2 + (dayHit ? 3 : 0), dayHit });
  }

  if (!scored.length) return null;

  // Best score; among equals the soonest — "der Zahnarzt" is the next one.
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  const [best] = scored;

  /*
    A day the message names must be the event's day: "Yoga fällt am
    12.11. aus" is not about the Yoga on the 5th. Without a named day
    the soonest match is the one meant ("der Zahnarzt") — the user
    confirms before anything changes.
  */
  // A move that names one day names only where it goes.
  const dayRequired = kind === 'cancel' ? namedDays.size > 0 : namedDays.size > 1;
  if (dayRequired && !best.dayHit) return null;

  // A move to the day and time the event already has is no move.
  if (kind === 'reschedule') {
    const target = rescheduleTarget(draft, best.ev);
    const moved = movedTimes(best.ev, target);
    if (moved.start === best.ev.start || startMs({ start: moved.start }) === startMs(best.ev)) return null;
  }

  return { kind, event: best.ev, score: best.score };
}
