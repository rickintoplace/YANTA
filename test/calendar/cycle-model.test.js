import { describe, it, expect } from 'vitest';

import { analyzeCycle, dayOf, keyOf } from '../../src/cycle/cycle-model.js';

const add = (key, days) => keyOf(dayOf(key) + days);

/** Period starts from a first day and a list of cycle lengths. */
function history(first, lengths, extra = {}) {
  const out = [{ id: 'p0', kind: 'period', start: first, ...extra }];
  let day = first;
  lengths.forEach((l, i) => {
    day = add(day, l);
    out.push({ id: `p${i + 1}`, kind: 'period', start: day, ...extra });
  });
  return out;
}

const span = (f) => dayOf(f.end) - dayOf(f.start) + 1;
const rangeSpan = (f) => dayOf(f.range[1]) - dayOf(f.range[0]) + 1;

describe('cycle arithmetic', () => {
  it('learns a regular cycle and predicts a narrow window around it', () => {
    const entries = history('2026-03-01', [28, 29, 28, 28, 29, 28]);
    const last = entries.at(-1).start;
    const a = analyzeCycle(entries, { today: add(last, 10) });

    expect(a.status).toBe('tracking');
    expect(a.stats.regularity).toBe('regular');
    expect(a.stats.cycle).toBeGreaterThan(27.9);
    expect(a.stats.cycle).toBeLessThan(29.2);

    const next = a.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    expect(Math.abs(dayOf(next.likely) - dayOf(add(last, 28)))).toBeLessThanOrEqual(1);
    // a regular history gives a window of a few days, not a fortnight
    expect(span(next)).toBeLessThanOrEqual(9);

    const ov = a.forecasts.find((f) => f.kind === 'ovulation' && f.cycle === 1);
    expect(dayOf(next.likely) - dayOf(ov.likely)).toBeGreaterThanOrEqual(11);
    expect(dayOf(next.likely) - dayOf(ov.likely)).toBeLessThanOrEqual(13);

    const fertile = a.forecasts.find((f) => f.kind === 'fertile' && f.cycle === 1);
    expect(dayOf(fertile.start)).toBeLessThan(dayOf(ov.likely));
    expect(dayOf(fertile.end)).toBeGreaterThanOrEqual(dayOf(ov.likely));
  });

  it('is less sure about irregular cycles and says so', () => {
    const entries = history('2026-01-01', [24, 38, 27, 45, 22, 35, 30]);
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 5) });
    expect(a.stats.regularity).toBe('irregular');

    const regular = analyzeCycle(history('2026-01-01', [28, 28, 29, 28, 28, 28, 29]), { today: add('2026-01-01', 200) });
    const wide = a.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    const narrow = regular.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    // Drawn as one usual period either way; the doubt is in the range
    // and in how strong it is drawn.
    expect(span(wide)).toBe(span(narrow));
    expect(rangeSpan(wide)).toBeGreaterThan(rangeSpan(narrow));
    expect(wide.prob).toBeLessThan(narrow.prob);
  });

  it('gets less certain the further ahead it looks', () => {
    const entries = history('2026-03-01', [29, 31, 28, 30, 29]);
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 3) });
    const periods = a.forecasts.filter((f) => f.kind === 'period');
    expect(periods.length).toBeGreaterThan(10);
    expect(rangeSpan(periods[5])).toBeGreaterThan(rangeSpan(periods[0]));
    expect(periods[5].prob).toBeLessThan(periods[0].prob);
  });

  it('treats a gap of two cycles as a missed entry, not a 57-day cycle', () => {
    const entries = history('2026-01-01', [28, 29, 57, 28, 29]);
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 2) });
    const gap = a.cycles.find((c) => c.length === 57);
    expect(gap.flag).toBe('missed');
    expect(a.stats.cycle).toBeLessThan(30);
  });

  it('keeps a long cycle someone confirmed', () => {
    const entries = history('2026-01-01', [28, 29, 28]);
    entries.push({ id: 'long', kind: 'period', start: add(entries.at(-1).start, 56), confirmed: true });
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 2) });
    expect(a.cycles.at(-1).flag).toBeNull();
  });

  it('keeps a merely long cycle (not two) in the statistics', () => {
    const entries = history('2026-01-01', [28, 29, 28, 41, 28]);
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 2) });
    expect(a.cycles.find((c) => c.length === 41).flag).toBeNull();
  });

  it('merges one period logged twice (two people, two devices)', () => {
    const entries = history('2026-01-01', [28, 28, 28]);
    entries.push({ id: 'dup', kind: 'period', start: add(entries.at(-1).start, 1), by: 'partner' });
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 3) });
    expect(a.periods).toHaveLength(4);
    expect(a.periods.at(-1).ids).toEqual(['p3', 'dup']);
    expect(a.cycles.every((c) => c.length === 28)).toBe(true);
  });

  it('moves the forecast when the period is late instead of keeping it in the past', () => {
    const entries = history('2026-01-01', [28, 28, 29, 28, 28]);
    const last = entries.at(-1).start;
    const late = analyzeCycle(entries, { today: add(last, 36) });

    expect(late.current.lateBy).toBeGreaterThan(5);
    const next = late.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    expect(dayOf(next.start)).toBeGreaterThanOrEqual(dayOf(add(last, 36)));
  });

  it('starts over from a newly logged period', () => {
    const entries = history('2026-01-01', [28, 28, 28, 28]);
    const early = [...entries, { id: 'early', kind: 'period', start: add(entries.at(-1).start, 24) }];
    const a = analyzeCycle(early, { today: add(entries.at(-1).start, 25) });
    expect(a.current.start).toBe(add(entries.at(-1).start, 24));
    expect(a.current.inPeriod).toBe(true);
    expect(a.current.periodDay).toBe(2);
    const next = a.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    expect(dayOf(next.likely)).toBeGreaterThan(dayOf(add(entries.at(-1).start, 45)));
  });

  it('fills in the rest of a running period that has no end yet', () => {
    const entries = history('2026-01-01', [28, 28]);
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 1) });
    const ongoing = a.forecasts.find((f) => f.kind === 'period-ongoing');
    expect(ongoing.start).toBe(add(entries.at(-1).start, 1));
    expect(span(ongoing)).toBe(4);
  });

  it('uses the logged period length', () => {
    const entries = history('2026-01-01', [28, 28, 28]).map((e) => ({ ...e, end: add(e.start, 6) }));
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 10) });
    expect(a.stats.period).toBe(7);
  });

  it('predicts from one logged period with the prior (or the length she gave)', () => {
    const one = [{ id: 'p', kind: 'period', start: '2026-10-01' }];
    const a = analyzeCycle(one, { today: '2026-10-05' });
    expect(a.status).toBe('learning');
    const next = a.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    expect(Math.abs(dayOf(next.likely) - dayOf('2026-10-30'))).toBeLessThanOrEqual(1);

    const told = analyzeCycle(one, { today: '2026-10-05', typicalLength: 33 });
    const toldNext = told.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    expect(Math.abs(dayOf(toldNext.likely) - dayOf('2026-11-03'))).toBeLessThanOrEqual(1);
  });

  it('predicts nothing without entries', () => {
    const a = analyzeCycle([], { today: '2026-10-05' });
    expect(a.status).toBe('empty');
    expect(a.forecasts).toEqual([]);
  });

  it('pauses during a pregnancy or hormonal contraception', () => {
    const entries = history('2026-01-01', [28, 28, 28]);
    entries.push({ id: 'preg', kind: 'pause', start: add(entries.at(-1).start, 30), open: true, reason: 'pregnancy' });
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 60) });
    expect(a.status).toBe('paused');
    expect(a.pause.reason).toBe('pregnancy');
    expect(a.forecasts).toEqual([]);
  });

  it('waits for the first period after a pause, then leaves the pause out', () => {
    const entries = history('2026-01-01', [28, 28, 28]);
    const last = entries.at(-1).start;
    entries.push({ id: 'pill', kind: 'pause', start: add(last, 5), end: add(last, 200), reason: 'hormonal' });
    const waiting = analyzeCycle(entries, { today: add(last, 210) });
    expect(waiting.status).toBe('after-pause');

    entries.push({ id: 'back', kind: 'period', start: add(last, 230) });
    const back = analyzeCycle(entries, { today: add(last, 232) });
    expect(back.status).toBe('tracking');
    expect(back.cycles.at(-1).flag).toBe('pause');
    expect(back.stats.cycle).toBeLessThan(29.5);
  });

  it('counts back from a confirmed ovulation', () => {
    const entries = history('2026-01-01', [30, 30, 30]);
    const last = entries.at(-1).start;
    // LH peak late this cycle: the next period follows ~12 days later.
    entries.push({ id: 'lh', kind: 'ovulation', start: add(last, 22) });
    const a = analyzeCycle(entries, { today: add(last, 23) });
    expect(a.current.confirmedOvulation).toBe(add(last, 22));
    const next = a.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    expect(Math.abs(dayOf(next.likely) - dayOf(add(last, 34)))).toBeLessThanOrEqual(1);
    expect(a.forecasts.some((f) => f.kind === 'ovulation' && f.cycle === 1)).toBe(false);
  });

  it('ignores spotting', () => {
    const entries = history('2026-01-01', [28, 28, 28]);
    entries.push({ id: 's', kind: 'spotting', start: add(entries.at(-1).start, 14) });
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 16) });
    expect(a.current.start).toBe(entries[3].start);
  });
});

import { looksLikePeriodText } from '../../src/cycle/cycle-calendar.js';

describe('period text', () => {
  it('recognises a period note, in the app languages', () => {
    for (const s of ['Periode heute', 'Periode hat heute begonnen', 'Meine Tage seit heute', 'period started today', 'Regla hoy', 'Règles aujourd’hui', '生理 今日']) {
      expect(looksLikePeriodText(s), s).toBe(true);
    }
  });

  it('leaves appointments alone', () => {
    for (const s of ['Zahnarzt morgen 10 Uhr', 'Elternabend am 12.11.', 'Periodensystem lernen Freitag', 'Regelmäßiges Meeting Montag', 'Probezeit endet am 1.12.']) {
      expect(looksLikePeriodText(s), s).toBe(false);
    }
  });
});

describe('what the forecasts look like', () => {
  it('draws one usual period and a six-day fertile window ending on ovulation, even with one logged period', () => {
    const a = analyzeCycle([{ id: 'a', kind: 'period', start: '2026-10-29', end: '2026-11-02' }], { today: '2026-11-09' });
    for (const f of a.forecasts.filter((x) => x.kind === 'period')) expect(span(f)).toBe(a.stats.period);
    for (const f of a.forecasts.filter((x) => x.kind === 'fertile')) {
      expect(span(f)).toBeLessThanOrEqual(6);
      expect(f.end).toBe(f.likely);
    }
  });

  it('puts ovulation about 12–13 days before the next period, not on day 14', () => {
    const entries = history('2026-03-01', [29, 30, 29, 30, 29, 30]);
    const a = analyzeCycle(entries, { today: add(entries.at(-1).start, 5) });
    const ov = a.forecasts.find((f) => f.kind === 'ovulation' && f.cycle === 1);
    const next = a.forecasts.find((f) => f.kind === 'period' && f.cycle === 1);
    const gap = dayOf(next.likely) - dayOf(ov.likely);
    expect(gap).toBeGreaterThanOrEqual(12);
    expect(gap).toBeLessThanOrEqual(14);
  });
});
