import { describe, it, expect } from 'vitest';

import { analyzeCycle } from '../../src/cycle/cycle-model.js';
import { togglePeriodDay, periodRanges, cycleDayMarks } from '../../src/cycle/cycle-calendar.js';

const P = (id, start, end = null) => ({ id, kind: 'period', start, end });
const opts = { today: '2026-11-07', periodLength: 5 };

describe('tapping period days', () => {
  it('a lone day starts a period of the usual length, running when it is today', () => {
    expect(togglePeriodDay([], '2026-11-07', opts)).toEqual({ updates: [], creates: [{ start: '2026-11-07', end: null }], deletes: [] });
    const past = togglePeriodDay([], '2026-10-10', opts);
    expect(past.creates).toEqual([{ start: '2026-10-10', end: null }]);
    const [r] = periodRanges([P('a', '2026-10-10')], opts);
    expect(r.e - r.s).toBe(4);
  });

  it('never logs the future', () => {
    expect(togglePeriodDay([], '2026-11-08', opts)).toEqual({ updates: [], creates: [], deletes: [] });
  });

  it('a running period shows up to today, not beyond', () => {
    const [r] = periodRanges([P('a', '2026-11-06')], opts);
    expect(r.e - r.s).toBe(1);
  });

  it('untapping today ends a running period yesterday', () => {
    const out = togglePeriodDay([P('a', '2026-11-05')], '2026-11-07', opts);
    expect(out.updates).toEqual([{ id: 'a', start: '2026-11-05', end: '2026-11-06' }]);
  });

  it('extends a closed period by the next day, and closes the gap between two', () => {
    expect(togglePeriodDay([P('a', '2026-10-01', '2026-10-03')], '2026-10-04', opts).updates)
      .toEqual([{ id: 'a', start: '2026-10-01', end: '2026-10-04' }]);
    const merged = togglePeriodDay([P('a', '2026-10-01', '2026-10-02'), P('b', '2026-10-04', '2026-10-05')], '2026-10-03', opts);
    expect(merged.updates).toEqual([{ id: 'a', start: '2026-10-01', end: '2026-10-05' }]);
    expect(merged.deletes).toEqual(['b']);
  });

  it('splits a period when a day in the middle is untapped, and removes a lone day', () => {
    const split = togglePeriodDay([P('a', '2026-10-01', '2026-10-05')], '2026-10-03', opts);
    expect(split.updates).toEqual([{ id: 'a', start: '2026-10-01', end: '2026-10-02' }]);
    expect(split.creates).toEqual([{ start: '2026-10-04', end: '2026-10-05' }]);
    expect(togglePeriodDay([P('a', '2026-10-01', '2026-10-01')], '2026-10-01', opts).deletes).toEqual(['a']);
  });

  it('keeps "ended today" when an earlier day is added', () => {
    const out = togglePeriodDay([P('a', '2026-11-05', '2026-11-07')], '2026-11-04', opts);
    expect(out.updates).toEqual([{ id: 'a', start: '2026-11-04', end: '2026-11-07' }]);
  });

  it('moves the start of a period that began a few days earlier', () => {
    const out = togglePeriodDay([P('a', '2026-10-10', '2026-10-13')], '2026-10-07', opts);
    expect(out).toEqual({ updates: [{ id: 'a', start: '2026-10-07', end: '2026-10-13' }], creates: [], deletes: [] });
  });
});

describe('day marks', () => {
  it('marks logged days, expected days and fertile days without overlap', () => {
    const entries = [P('a', '2026-08-15', '2026-08-19'), P('b', '2026-09-12', '2026-09-16'), P('c', '2026-10-10', '2026-10-14')];
    const a = analyzeCycle(entries, { today: '2026-10-20' });
    a.entries = entries;
    const marks = cycleDayMarks(a, { showFertile: true, showOvulation: true }, { today: '2026-10-20' });
    expect(marks.get('2026-10-12')).toMatchObject({ period: 'logged' });
    expect(marks.get('2026-10-10').runStart).toBe(true);
    expect(marks.get('2026-10-14').runEnd).toBe(true);
    const expected = [...marks.values()].filter((m) => m.period === 'expected');
    expect(expected.length).toBeGreaterThan(3);
    expect(expected.every((m) => m.key > '2026-10-20')).toBe(true);
    expect([...marks.values()].some((m) => m.fertile)).toBe(true);
    expect([...marks.values()].some((m) => m.ovulation)).toBe(true);

    const quiet = cycleDayMarks(a, { showFertile: false, showOvulation: false }, { today: '2026-10-20' });
    expect([...quiet.values()].some((m) => m.fertile || m.ovulation)).toBe(false);
  });
});
