import { describe, it, expect } from 'vitest';
import { expandRecurringEvent } from '../../src/calendar-recurrence.js';

const local = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('repeating events longer than a day', () => {
  it('a weekend trip (all-day, Fri–Sun) repeats with its length', () => {
    const occ = expandRecurringEvent(
      { id: 'trip', title: 'Wochenende', allDay: true, start: '2026-11-06', end: '2026-11-08', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=FR' } },
      new Date(2026, 10, 1), new Date(2026, 10, 30)
    );
    expect(occ.map((o) => `${o.start}..${o.end}`)).toEqual([
      '2026-11-06..2026-11-08', '2026-11-13..2026-11-15', '2026-11-20..2026-11-22', '2026-11-27..2026-11-29',
    ]);
  });

  it('a timed night shift (22:00–06:00) repeats with its length', () => {
    const occ = expandRecurringEvent(
      { id: 'shift', allDay: false, start: new Date(2026, 10, 2, 22).toISOString(), end: new Date(2026, 10, 3, 6).toISOString(), recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO' } },
      new Date(2026, 10, 1), new Date(2026, 10, 17)
    );
    expect(occ.map((o) => `${local(o.start)}–${local(o.end)}`)).toEqual(['11/2 22:00–11/3 06:00', '11/9 22:00–11/10 06:00', '11/16 22:00–11/17 06:00']);
  });

  it('an occurrence that began before the visible range still shows', () => {
    const occ = expandRecurringEvent(
      { id: 'trip', allDay: true, start: '2026-11-06', end: '2026-11-08', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=FR' } },
      new Date(2026, 10, 15), new Date(2026, 10, 16)
    );
    expect(occ.map((o) => o.start)).toEqual(['2026-11-13']);
  });
});
