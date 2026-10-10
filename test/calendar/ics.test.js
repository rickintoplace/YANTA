import { describe, it, expect } from 'vitest';

const { parseIcsEvents, eventsToIcs } = await import('../../src/calendar-ics.js');

const cal = (...vevents) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...vevents.flat(), 'END:VCALENDAR'].join('\r\n');

describe('ICS import', () => {
  it('takes the end from DURATION when there is no DTEND', () => {
    const [ev] = parseIcsEvents(cal([
      'BEGIN:VEVENT', 'UID:d1', 'DTSTART:20261014T090000Z', 'DURATION:PT1H30M', 'SUMMARY:Call', 'END:VEVENT',
    ]));
    expect(ev.end).toBe('2026-10-14T10:30:00.000Z');
  });

  it('turns relative VALARM triggers into reminders, not the alarm\'s own fields into the event', () => {
    const [ev] = parseIcsEvents(cal([
      'BEGIN:VEVENT', 'UID:a1', 'DTSTART:20261014T090000Z', 'SUMMARY:Dentist',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT15M', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;RELATED=START:-P1D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;VALUE=DATE-TIME:20261013T080000Z', 'END:VALARM',
      'END:VEVENT',
    ]));
    expect(ev.title).toBe('Dentist');
    expect(ev.description).toBe('');
    expect(ev.reminders).toEqual([{ minutesBefore: 15 }, { minutesBefore: 1440 }]);
  });

  it('keeps the URL in the description', () => {
    const [ev] = parseIcsEvents(cal([
      'BEGIN:VEVENT', 'UID:u1', 'DTSTART:20261014T090000Z', 'SUMMARY:Webinar', 'DESCRIPTION:Join us', 'URL:https://meet.example.org/abc', 'END:VEVENT',
    ]));
    expect(ev.description).toBe('Join us\n\nhttps://meet.example.org/abc');
  });

  it('folds a moved and a cancelled occurrence into their series', () => {
    const events = parseIcsEvents(cal(
      ['BEGIN:VEVENT', 'UID:s1', 'DTSTART:20261012T080000Z', 'DTEND:20261012T083000Z', 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Standup', 'END:VEVENT'],
      ['BEGIN:VEVENT', 'UID:s1', 'RECURRENCE-ID:20261019T080000Z', 'DTSTART:20261019T100000Z', 'DTEND:20261019T103000Z', 'SUMMARY:Standup (moved)', 'END:VEVENT'],
      ['BEGIN:VEVENT', 'UID:s1', 'RECURRENCE-ID:20261026T080000Z', 'DTSTART:20261026T080000Z', 'STATUS:CANCELLED', 'SUMMARY:Standup', 'END:VEVENT'],
    ));

    expect(events).toHaveLength(1);
    const [series] = events;
    expect(series.recurrenceOverrides['2026-10-19T08:00:00.000Z']).toMatchObject({
      start: '2026-10-19T10:00:00.000Z',
      title: 'Standup (moved)',
    });
    expect(series.recurrenceExceptions).toContain('2026-10-26T08:00:00.000Z');
    expect(series.recurrenceId).toBeUndefined();
  });

  it('round-trips an override through export and import, with the original UID', () => {
    const ics = eventsToIcs([{
      id: 'local1',
      externalUid: 'series-42@example.org',
      title: 'Standup',
      start: '2026-10-12T08:00:00.000Z',
      end: '2026-10-12T08:30:00.000Z',
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=4' },
      recurrenceOverrides: {
        '2026-10-19T08:00:00.000Z': { start: '2026-10-19T10:00:00.000Z', end: '2026-10-19T10:30:00.000Z', title: 'Moved' },
      },
    }]);

    expect(ics).toContain('UID:series-42@example.org\r\n');
    expect(ics).not.toContain('@example.org@yanta');

    const [back] = parseIcsEvents(ics);
    expect(back.externalUid).toBe('series-42@example.org');
    expect(back.recurrenceOverrides['2026-10-19T08:00:00.000Z']).toMatchObject({ title: 'Moved', start: '2026-10-19T10:00:00.000Z' });
  });
});
