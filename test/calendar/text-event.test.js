import { describe, it, expect } from 'vitest';

import { draftEventFromText } from '../../src/calendar-text-event.js';
import { findWhen, dateOrderForLocale } from '../../src/calendar-text-parse.js';

import { NOW, CASES } from './text-event-corpus.js';

const pad = (n) => String(n).padStart(2, '0');
const local = (iso, allDay) => {
  if (!iso) return null;
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

describe('event from shared text — corpus', () => {
  for (const [text, want] of CASES) {
    it(text, () => {
      const draft = draftEventFromText(text, { now: NOW });

      if (want === null) {
        expect(draft).toBeNull();
        return;
      }

      expect(draft).not.toBeNull();
      const allDay = !/\d:\d/.test(want.start);
      expect(draft.allDay).toBe(allDay);
      expect(local(draft.start, allDay)).toBe(want.start);
      if (want.end) expect(local(draft.end, allDay)).toBe(want.end);
      if (want.title !== undefined) expect(draft.title).toBe(want.title);
      if (want.location !== undefined) expect(draft.location).toBe(want.location);
      expect(draft.status).toBe(want.status || 'confirmed');
      for (const flag of want.flags || []) expect(draft.flags).toContain(flag);
      if (want.rrule) expect(draft.recurrence?.rrule).toBe(want.rrule);
    });
  }
});

describe('event from shared text — details', () => {
  it('reads 12/3 by the locale\'s date order', () => {
    expect(local(findWhen('Meeting 12/3 at 2pm', { now: NOW, dateOrder: 'mdy' })[0].start)).toBe('2026-12-03 14:00');
    expect(local(findWhen('Meeting 12/3 at 2pm', { now: NOW, dateOrder: 'dmy' })[0].start)).toBe('2027-03-12 14:00');
    expect(dateOrderForLocale('en-US')).toBe('mdy');
    expect(dateOrderForLocale('de-DE')).toBe('dmy');
  });

  it('keeps the spans the date came from, and the original text', () => {
    const text = 'Termin beim Zahnarzt 3.12. Um 17:15 uhr';
    const draft = draftEventFromText(text, { now: NOW });
    expect(draft.source.text).toBe('3.12. Um 17:15 uhr');
    expect(draft.description).toBe(text);
  });

  it('offers the other half of the day when the hour was a guess', () => {
    const draft = draftEventFromText('um 5 beim Bäcker', { now: NOW });
    expect(draft.alternatives).toContainEqual({ shiftHours: -12 });
  });

  it('lists further moments of the same text', () => {
    const draft = draftEventFromText('Elternabend 12.11. 19 Uhr, Sportfest 20.11., Weihnachtsfeier 18.12. 16 Uhr', { now: NOW });
    expect(local(draft.start)).toBe('2026-11-12 19:00');
    expect(draft.others.map((o) => o.text)).toEqual(['18.12. 16 Uhr', '20.11.']);
  });
});
