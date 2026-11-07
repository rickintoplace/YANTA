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
