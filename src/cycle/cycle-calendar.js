// ============================================================
// YANTA — cycle calendar: between the calendar and the arithmetic
//
// A cycle calendar is an ordinary calendar category with a `cycle`
// block. What people log in it are ordinary all-day events (so sharing,
// sync, write access for a partner, export and AI visibility all work
// as for any calendar); `ev.cycle.kind` says what an entry is. An
// all-day entry without it counts as a period — that is what someone
// adds through the normal event editor.
//
// Forecasts are never stored. They are generated per device from the
// entries, like holidays, and carry the category so every filter that
// applies to the calendar (hidden, hidden from AI) applies to them.
//
// What travels with a shared cycle calendar: the entries and the
// owner's `partnerSees` choice. How each person looks at it (fertile
// days on or off, reminders) stays with them.
// ============================================================

import { analyzeCycle, dayOf, keyOf } from './cycle-model.js';
import { t } from '../i18n/index.js';

export const CYCLE_ENTRY_KINDS = ['period', 'spotting', 'ovulation', 'pause'];

/*
  The cycle's own colors, whatever color the calendar has in the list: a
  period drawn sky blue because the calendar once was blue reads wrong.
  Fertile days and ovulation keep their teal (calendar.css, cycle panel).
*/
export const CYCLE_PERIOD_COLOR = '#d6336c';
const PAUSE_REASONS = ['pregnancy', 'hormonal', 'other'];

// ---------------- records --------------------------------------------

export function sanitizeCycleSettings(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const num = (v, lo, hi) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
  };
  return {
    v: 1,
    partnerSees: raw.partnerSees === 'periods' ? 'periods' : 'all',
    showOvulation: raw.showOvulation !== false,
    showFertile: raw.showFertile !== false,
    discreet: raw.discreet !== false,
    remindDays: num(raw.remindDays, 0, 7) ?? 0,
    // What the big calendar shows (the panel always shows everything
    // allowed). Fertile days are off there by default: a band over a
    // third of every month made the whole calendar look tinted.
    calPeriods: raw.calPeriods !== false,
    calFertile: raw.calFertile === true,
    calOvulation: raw.calOvulation !== false,
    statusLine: raw.statusLine !== false,
    typicalLength: num(raw.typicalLength, 18, 60),
    typicalPeriod: num(raw.typicalPeriod, 1, 12),
  };
}

/** The part of the settings everyone in a share works with. */
export function sharedCycleSettings(cycle) {
  const s = sanitizeCycleSettings(cycle);
  if (!s) return undefined;
  return {
    v: 1,
    partnerSees: s.partnerSees,
    typicalLength: s.typicalLength,
    typicalPeriod: s.typicalPeriod,
  };
}

export function sanitizeCycleEntry(raw) {
  if (!raw || typeof raw !== 'object' || !CYCLE_ENTRY_KINDS.includes(raw.kind)) return undefined;
  const out = { kind: raw.kind };
  if (raw.kind === 'pause') {
    out.reason = PAUSE_REASONS.includes(raw.reason) ? raw.reason : 'other';
    if (raw.open === true) out.open = true;
  }
  if (raw.kind === 'period' && raw.confirmed === true) out.confirmed = true;
  return out;
}

/*
  Text that is about a period ("Periode heute", "Tage bekommen", "period
  started"), in the app's languages. Deliberately narrow: a false match
  would file an appointment as a period.
*/
const PERIOD_TEXT = /(?:^|[^\p{L}])(?:periode|menstruation|meine\s+tage|tage\s+bekommen|regelblutung|period(?:\s+(?:started|came|began))?|my\s+period|regla|menstruaci[oó]n|r[eè]gles|生理)(?:$|[^\p{L}])/iu;

export function looksLikePeriodText(text) {
  const s = String(text || '').trim();
  return s.length > 0 && s.length < 120 && PERIOD_TEXT.test(s);
}

export function isCycleCategory(cat) {
  return !!cat?.cycle;
}

// ---------------- dates ----------------------------------------------

export function localKey(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** How all-day dates are stored on events: local midnight as ISO. */
export function storedAllDay(key) {
  return new Date(`${key}T00:00:00`).toISOString();
}

export function todayKey(now = new Date()) {
  return localKey(now);
}

export function addDays(key, days) {
  return keyOf(dayOf(key) + days);
}

// ---------------- entries --------------------------------------------

/** What the arithmetic needs from the events of one cycle calendar. */
export function cycleEntriesFromEvents(categoryId, events) {
  const out = [];
  for (const ev of events) {
    if (!ev || ev.categoryId !== categoryId || ev.status === 'cancelled') continue;
    if (ev.recurrence?.rrule || ev.recurrence?.freq) continue; // "monthly" is not a cycle
    const kind = ev.cycle?.kind || (ev.allDay ? 'period' : null);
    if (!kind) continue;
    const start = localKey(ev.start);
    if (!start) continue;
    out.push({
      id: ev.id,
      kind,
      start,
      end: ev.end ? localKey(ev.end) : null,
      open: ev.cycle?.open === true,
      reason: ev.cycle?.reason,
      confirmed: ev.cycle?.confirmed === true,
      by: ev.createdBy || null,
    });
  }
  return out;
}

// ---------------- the view of one person -----------------------------

/**
 * @param cat       the category as this device sees it
 * @param personal  this person's prefs for it (calendar-personal.js)
 */
export function cycleViewFor(cat, personal = null) {
  const s = sanitizeCycleSettings(cat?.cycle) || sanitizeCycleSettings({});
  const member = !!cat?.spaceId && cat?.spaceRole !== 'owner';
  const mine = member ? (personal?.cycleView || {}) : s;
  const periodsOnly = member && s.partnerSees === 'periods';
  return {
    member,
    periodsOnly,
    showOvulation: !periodsOnly && mine.showOvulation !== false,
    showFertile: !periodsOnly && mine.showFertile !== false,
    remindDays: Number(mine.remindDays) || 0,
    // What a reminder says on the lock screen: nothing telling, by default.
    discreet: mine.discreet !== false,
    calPeriods: mine.calPeriods !== false,
    calFertile: !periodsOnly && mine.showFertile !== false && mine.calFertile === true,
    calOvulation: !periodsOnly && mine.showOvulation !== false && mine.calOvulation !== false,
    statusLine: mine.statusLine !== false,
    typicalLength: s.typicalLength,
    typicalPeriod: s.typicalPeriod,
  };
}

// ---------------- analysis, memoized ---------------------------------

const memo = new Map(); // catId -> { sig, analysis }

export function cycleAnalysisFor(cat, events, { today = todayKey() } = {}) {
  const entries = cycleEntriesFromEvents(cat.id, events);
  const s = sanitizeCycleSettings(cat.cycle) || {};
  const sig = `${today}|${s.typicalLength || ''}|${s.typicalPeriod || ''}|${entries.map((e) => `${e.id}:${e.kind}:${e.start}:${e.end || ''}:${e.open ? 1 : 0}:${e.confirmed ? 1 : 0}`).join(',')}`;
  const hit = memo.get(cat.id);
  if (hit?.sig === sig) return hit.analysis;
  const analysis = analyzeCycle(entries, { today, typicalLength: s.typicalLength, typicalPeriod: s.typicalPeriod });
  analysis.entries = entries;
  memo.set(cat.id, { sig, analysis });
  return analysis;
}

// ---------------- forecast events ------------------------------------

function title(kind) {
  if (kind === 'period-ongoing') return t('cycle.forecast.ongoing');
  if (kind === 'period') return t('cycle.forecast.period');
  if (kind === 'fertile') return t('cycle.forecast.fertile');
  return t('cycle.forecast.ovulation');
}

/**
 * Generated events for [rangeStart, rangeEnd). Shaped like the other
 * generated (source) events: all-day date keys, end exclusive.
 */
export function cycleForecastEvents(cat, analysis, view, rangeStart, rangeEnd, { forReminders = false } = {}) {
  if (!analysis?.forecasts?.length || cat?.visible === false) return [];
  const from = localKey(rangeStart);
  const to = localKey(rangeEnd);
  const anchor = analysis.current?.start || '';
  const out = [];

  for (const f of analysis.forecasts) {
    // The safety margin is for the calendar layer and the panel, not an entry.
    if (f.kind === 'fertile-possible') continue;
    if (f.kind === 'fertile' && !view.showFertile) continue;
    if (f.kind === 'ovulation' && !view.showOvulation) continue;
    if (f.end < from || f.start > to) continue;

    const remind = f.kind === 'period' && view.remindDays > 0 && f.cycle <= 2;
    out.push({
      id: `cyc:${cat.id}:${f.kind}:${f.cycle}:${anchor}`,
      // Reminders are shown outside the app (lock screen, other devices).
      title: forReminders && view.discreet ? t('cycle.forecast.discreet') : title(f.kind),
      start: f.start,
      end: addDays(f.end, 1),
      allDay: true,
      categoryId: cat.id,
      color: cat.color || undefined,
      description: '',
      status: 'tentative',
      readonly: true,
      generated: true,
      reminders: remind
        ? [{ id: `cyc-remind-${view.remindDays}`, label: '', minutesBefore: view.remindDays * 1440 - 9 * 60, enabled: true }]
        : [],
      cycleForecast: {
        kind: f.kind,
        cycle: f.cycle,
        likely: f.likely,
        range: f.range || null,
        prob: f.prob,
        confirmed: !!f.confirmed,
      },
      source: { type: 'cycle' },
    });
  }

  return out;
}

// ---------------- days -----------------------------------------------
//
// People think in days ("today I'm bleeding"), the calendar stores runs
// of days. These two functions translate between the two.

/**
 * The days a logged period covers, as day numbers [s, e]. A period
 * without a logged end runs for the usual length, but never past today:
 * what comes after today is a forecast, not an entry.
 */
export function periodRanges(entries, { today = todayKey(), periodLength = 5 } = {}) {
  const T = dayOf(today);
  const L = Math.max(1, Math.round(periodLength) || 5);
  const out = [];
  for (const e of entries || []) {
    if (e.kind !== 'period') continue;
    const s = dayOf(e.start);
    if (!Number.isFinite(s)) continue;
    const logged = e.end ? dayOf(e.end) : null;
    const end = Number.isFinite(logged) && logged >= s ? logged : Math.max(s, Math.min(T, s + L - 1));
    out.push({ id: e.id, s, e: end, open: !e.end });
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * Marks or unmarks one day as a period day. Returns the changes to the
 * stored entries — `updates` and `creates` as { start, end } date keys
 * (end null: running), `deletes` as ids. Only entries next to the day
 * are touched; the rest of the history stays as it was logged.
 *
 * A day on its own starts a period of the usual length (its end not yet
 * logged); a run that reaches today stays open (running) unless someone
 * said it ended today, so the forecast keeps counting its days.
 */
export function togglePeriodDay(entries, dayKey, { today = todayKey(), periodLength = 5 } = {}) {
  const d = dayOf(dayKey);
  const T = dayOf(today);
  const L = Math.max(1, Math.round(periodLength) || 5);
  const result = { updates: [], creates: [], deletes: [] };
  if (!Number.isFinite(d) || d > T) return result;

  const all = periodRanges(entries, { today, periodLength: L });
  const touching = all.filter((r) => r.s <= d + 1 && r.e >= d - 1);

  if (!touching.length) {
    // A period begins a few days earlier than the one logged after it.
    const later = all.find((r) => r.s > d && r.s - d < L);
    if (later) {
      result.updates.push({ id: later.id, start: keyOf(d), end: later.open ? null : keyOf(later.e) });
      return result;
    }
    // A first day on its own: the period lasts the usual length until
    // someone marks where it ended.
    result.creates.push({ start: keyOf(d), end: null });
    return result;
  }

  const days = new Set();
  for (const r of touching) for (let x = r.s; x <= r.e; x++) days.add(x);
  if (days.has(d)) days.delete(d);
  else days.add(d);

  const runs = [];
  for (const x of [...days].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && x === last.e + 1) last.e = x;
    else runs.push({ s: x, e: x });
  }

  const endedToday = touching.some((r) => !r.open && r.e === T);
  runs.forEach((run, i) => {
    const open = run.e === T && run.e - run.s + 1 <= L && !endedToday;
    const next = { start: keyOf(run.s), end: open ? null : keyOf(run.e) };
    const was = touching[i];
    if (!was) return result.creates.push(next);
    const wasEnd = was.open ? null : keyOf(was.e);
    if (was.s !== run.s || wasEnd !== next.end) result.updates.push({ id: was.id, ...next });
  });
  for (const r of touching.slice(runs.length)) result.deletes.push(r.id);
  return result;
}

/**
 * What each day shows in the calendar, by date key:
 *   { period: 'logged'|'expected', strength (0..1, for expected),
 *     fertile, ovulation, ovulationConfirmed, runStart, runEnd }
 * Nothing here is an event: the calendar draws it as a quiet layer on
 * the days, so it never pushes an appointment aside.
 */
export function cycleDayMarks(analysis, view, { today = todayKey() } = {}) {
  const marks = new Map();
  if (!analysis) return marks;
  const get = (day) => {
    const key = keyOf(day);
    let m = marks.get(key);
    if (!m) marks.set(key, (m = { key }));
    return m;
  };
  const entries = analysis.entries || [];

  for (const r of periodRanges(entries, { today, periodLength: analysis.stats?.period })) {
    for (let x = r.s; x <= r.e; x++) {
      const m = get(x);
      m.period = 'logged';
      delete m.strength;
    }
  }
  for (const e of entries) {
    if (e.kind === 'ovulation' && !view?.periodsOnly && view?.showOvulation !== false) {
      const m = get(dayOf(e.start));
      m.ovulation = true;
      m.ovulationConfirmed = true;
    }
  }

  for (const f of analysis.forecasts || []) {
    const from = dayOf(f.start);
    const to = dayOf(f.end);
    if (f.kind === 'period' || f.kind === 'period-ongoing') {
      const strength = f.kind === 'period-ongoing' ? 1 : Math.max(0.25, Math.min(1, f.prob || 0.5));
      for (let x = from; x <= to; x++) {
        const m = get(x);
        if (m.period === 'logged') continue;
        m.period = 'expected';
        m.strength = Math.max(m.strength || 0, strength);
      }
    } else if (f.kind === 'fertile' && view?.showFertile) {
      for (let x = from; x <= to; x++) get(x).fertile = true;
    } else if (f.kind === 'fertile-possible' && view?.showFertile) {
      // Days around the window with a ≥ 10 % chance of being fertile.
      for (let x = from; x <= to; x++) get(x).fertileMaybe = true;
    } else if (f.kind === 'ovulation' && view?.showOvulation) {
      get(dayOf(f.likely)).ovulation = true;
    }
  }

  for (const m of marks.values()) if (m.fertile || m.period) delete m.fertileMaybe;

  // Where a run of period days begins and ends, for rounded ends.
  for (const m of marks.values()) {
    if (!m.period) continue;
    const d = dayOf(m.key);
    m.runStart = marks.get(keyOf(d - 1))?.period !== m.period;
    m.runEnd = marks.get(keyOf(d + 1))?.period !== m.period;
  }
  return marks;
}

/**
 * One line for the top of the calendar: where in the cycle today is and
 * what comes next. `{ lead, rest }`, or null when there is nothing to say.
 */
export function cycleStatusLine(analysis, view, { today = todayKey() } = {}) {
  if (!analysis) return null;
  if (analysis.status === 'paused') return { lead: t('cycle.line.paused'), rest: '' };
  if (analysis.status === 'after-pause') return { lead: t('cycle.line.afterPause'), rest: '' };
  const c = analysis.current;
  if (analysis.status === 'empty' || !c) return { lead: t('cycle.line.empty'), rest: '' };

  if (c.inPeriod) return { lead: t('cycle.line.periodDay', { day: c.periodDay }), rest: '' };

  const lead = t('cycle.line.cycleDay', { day: c.day });
  const until = dayOf(c.nextLikely) - dayOf(today);
  let rest = c.lateBy > 0
    ? t('cycle.line.late', { count: c.lateBy })
    : until <= 0 ? t('cycle.line.today') : t('cycle.line.nextIn', { count: until });

  const T = dayOf(today);
  const covers = (kind) => (analysis.forecasts || []).some((f) =>
    f.kind === kind && dayOf(f.start) <= T && dayOf(f.end) >= T);
  if (view?.showFertile && covers('fertile')) rest = `${t('cycle.line.fertile')} · ${rest}`;
  else if (view?.showFertile && covers('fertile-possible')) rest = `${t('cycle.line.fertileMaybe')} · ${rest}`;
  return { lead, rest };
}
