import { describe, it, expect } from 'vitest';

import { draftEventFromText, draftEventsFromText, looksLikeSeveral } from '../../src/calendar-text-event.js';
import { findEventToChange, rescheduleTarget, movedTimes } from '../../src/calendar-text-match.js';
import { NOW } from './text-event-corpus.js';

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();
const pad = (n) => String(n).padStart(2, '0');
const local = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const EVENTS = [
  { id: 'zahn', title: 'Zahnarzt – Kontrolle', start: at(2026, 12, 3, 17, 15), end: at(2026, 12, 3, 18, 0) },
  { id: 'zahn2', title: 'Zahnarzt', start: at(2027, 3, 3, 9, 0), end: at(2027, 3, 3, 10, 0) },
  { id: 'yoga', title: 'Yoga', start: at(2026, 11, 5, 19, 0), end: at(2026, 11, 5, 20, 0) },
  { id: 'yoga-weekly', title: 'Yoga', start: at(2026, 11, 12, 19, 0), recurrence: { rrule: 'FREQ=WEEKLY' } },
  { id: 'call', title: 'Call with Sarah', start: at(2026, 11, 4, 15, 0), end: at(2026, 11, 4, 15, 30) },
  { id: 'old', title: 'Zahnarzt', start: at(2026, 10, 1, 9, 0) },
];

const draft = (text) => draftEventFromText(text, { now: NOW });

describe('moving and cancelling an existing event', () => {
  it('finds the event a move is about, by title and the old day', () => {
    const d = draft('Zahnarzt verschoben vom 3.12. auf den 10.12., gleiche Uhrzeit 17:15');
    const match = findEventToChange(d, EVENTS, { now: NOW });
    expect(match.kind).toBe('reschedule');
    expect(match.event.id).toBe('zahn');
    const moved = movedTimes(match.event, rescheduleTarget(d, match.event));
    expect(local(moved.start)).toBe('2026-12-10 17:15');
    expect(local(moved.end)).toBe('2026-12-10 18:00');
  });

  it('keeps the time of day when the message only names the new day', () => {
    const d = draft('Der Zahnarzttermin wurde auf Freitag verlegt');
    const match = findEventToChange(d, EVENTS, { now: NOW });
    expect(match.event.id).toBe('zahn');
    expect(local(movedTimes(match.event, rescheduleTarget(d, match.event)).start)).toBe('2026-11-06 17:15');
  });

  it('finds a cancelled event by its day', () => {
    const d = draft('Yoga fällt am Donnerstag aus');
    const match = findEventToChange(d, EVENTS, { now: NOW });
    expect(match).toMatchObject({ kind: 'cancel', event: { id: 'yoga' } });
  });

  it('leaves recurring and past events, and unrelated titles, alone', () => {
    expect(findEventToChange(draft('Yoga fällt am 12.11. aus'), EVENTS, { now: NOW })).toBeNull();
    expect(findEventToChange(draft('Friseur abgesagt, Freitag'), EVENTS, { now: NOW })).toBeNull();
    expect(findEventToChange(draft('Kino am Freitag 20 Uhr'), EVENTS, { now: NOW })).toBeNull();
  });

  it('uses an AI verdict as the kind', () => {
    const d = { ...draft('Can we push our call to Thursday 4pm?'), kind: 'reschedule' };
    const match = findEventToChange(d, EVENTS, { now: NOW });
    expect(match.event.id).toBe('call');
    expect(local(movedTimes(match.event, rescheduleTarget(d, match.event)).start)).toBe('2026-11-05 16:00');
  });
});

describe('several events in one text', () => {
  it('splits a school letter into one event per line, each with its own title', () => {
    const text = 'Liebe Eltern,\nbitte vormerken:\n- 12.11. 19:30 Elternabend im Musiksaal\n- 20.11. Sportfest (ganztägig)\n- 18.12. 16 Uhr Weihnachtsfeier\nViele Grüße';
    const drafts = draftEventsFromText(text, { now: NOW });
    expect(drafts.map((d) => d.title)).toEqual(['Elternabend im Musiksaal', 'Sportfest', 'Weihnachtsfeier']);
    expect(local(drafts[0].start)).toBe('2026-11-12 19:30');
    expect(drafts[1].allDay).toBe(true);
    expect(looksLikeSeveral(drafts, text)).toBe(true);
  });

  it('splits a sentence list at its clause breaks', () => {
    const text = 'Am 12.11. ist Elternabend. Am 20.11. findet das Sportfest statt.';
    const drafts = draftEventsFromText(text, { now: NOW });
    expect(drafts.map((d) => d.title)).toEqual(['Elternabend', 'Sportfest']);
    expect(looksLikeSeveral(drafts, text)).toBe(true);
  });

  it('is not several when the text weighs one day against another, or moves one', () => {
    for (const text of [
      'Sorry, schaffe es heute nicht um 18 Uhr, lieber morgen gleiche Zeit?',
      'Zahnarzt verschoben vom 3.12. auf den 10.12.',
      'Donnerstag oder Freitag 19 Uhr Kino?',
    ]) {
      expect(looksLikeSeveral(draftEventsFromText(text, { now: NOW }), text)).toBe(false);
    }
  });
});

describe('moving — either named day may be the old one', () => {
  it('works when the parser picked the old day as the event', () => {
    const d = draftEventFromText('Hallo, der Zahnarzt hat angerufen: Termin verschoben vom 3.12. auf den 10.12., gleiche Uhrzeit.', { now: NOW });
    const match = findEventToChange(d, EVENTS, { now: NOW });
    expect(match?.event.id).toBe('zahn');
    const moved = movedTimes(match.event, rescheduleTarget(d, match.event));
    expect(new Date(moved.start).getDate()).toBe(10);
    expect(new Date(moved.start).getHours()).toBe(17);
  });
});
