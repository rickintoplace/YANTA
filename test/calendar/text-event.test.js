import { describe, it, expect } from 'vitest';

import { draftEventFromText } from '../../src/calendar-text-event.js';
import { findWhen, dateOrderForLocale } from '../../src/calendar-text-parse.js';

// Tuesday, 3 Nov 2026, 10:00 local time.
const NOW = new Date(2026, 10, 3, 10, 0).getTime();

const pad = (n) => String(n).padStart(2, '0');
const local = (iso, allDay) => {
  if (!iso) return null;
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/*
  The corpus. Each case: text, then what must hold — start (local
  "YYYY-MM-DD HH:MM", or "YYYY-MM-DD" for all-day), and optionally end,
  title, location, status and flags. `null` = no event in this text.
*/
const CASES = [
  // --- the motivating message
  ['Ich habe dir einen Termin beim Zahnarzt gemacht. Nur kontrolle. 3.12. Um 17:15 uhr, ok?',
    { start: '2026-12-03 17:15', end: '2026-12-03 18:15', title: 'Zahnarzt', status: 'tentative' }],

  // --- relative days and weekdays
  ['morgen um 9 Bäcker', { start: '2026-11-04 09:00', title: 'Bäcker' }],
  ['übermorgen früh Ölwechsel', { start: '2026-11-05', title: 'Ölwechsel', flags: ['time-missing'] }],
  ['morgen früh um 7 Abflug', { start: '2026-11-04 07:00', title: 'Abflug' }],
  ['nächsten Dienstag 14 Uhr Teammeeting', { start: '2026-11-10 14:00', title: 'Teammeeting' }],
  ['Freitag 10 Uhr Bewerbungsgespräch', { start: '2026-11-06 10:00', title: 'Bewerbungsgespräch' }],
  ['heute Abend 19:30 Yoga', { start: '2026-11-03 19:30', title: 'Yoga' }],
  ['Donnerstagabend Volleyball', { start: '2026-11-05', title: 'Volleyball', flags: ['time-missing'] }],
  ['in 2 Wochen Reifenwechsel', { start: '2026-11-17', title: 'Reifenwechsel' }],
  ['Hast du am Sonntag um 15 Uhr Zeit für Kaffee?', { start: '2026-11-08 15:00', title: 'Kaffee', status: 'tentative' }],

  // --- explicit dates
  ['Physio am 1.4. um 8', { start: '2027-04-01 08:00', title: 'Physio' }],
  ['Ihr Termin am 03.12.2026 um 17:15 Uhr bei Dr. Müller, Hauptstr. 5, 37073 Göttingen',
    { start: '2026-12-03 17:15', title: 'Dr. Müller', location: 'Hauptstr. 5, 37073 Göttingen' }],
  ['Elternabend am Donnerstag, den 3. Dezember um 17 Uhr', { start: '2026-12-03 17:00', title: 'Elternabend' }],
  ['Geburtstag Oma 12. Mai', { start: '2027-05-12', title: 'Geburtstag Oma' }],
  ['Weihnachtsfeier 18.12. ab 18 Uhr', { start: '2026-12-18 18:00', title: 'Weihnachtsfeier' }],
  ['Do., 3.12., 17:15 Zahnarzt', { start: '2026-12-03 17:15', title: 'Zahnarzt' }],
  ['Sa 7.11. 20 Uhr Konzert', { start: '2026-11-07 20:00', title: 'Konzert' }],
  ['Mo, 3.12. 9 Uhr Kontrolle', { start: '2026-12-03 09:00', flags: ['weekday-mismatch'] }],
  ['Zahnarzttermin 3.12. 17:15', { start: '2026-12-03 17:15', title: 'Zahnarzt' }],
  ['Abgabe Hausarbeit 15.01.27', { start: '2027-01-15', title: 'Abgabe Hausarbeit' }],

  // --- clock times, German style
  ['Treffen 17.15 Uhr', { start: '2026-11-03 17:15', title: 'Treffen', flags: ['date-assumed'] }],
  ['Kino um halb 8?', { start: '2026-11-03 19:30', title: 'Kino', status: 'tentative' }],
  ['Friseur viertel nach 3 am Freitag', { start: '2026-11-06 15:15', title: 'Friseur' }],
  ['Abendessen bei Oma, Samstag dreiviertel 7', { start: '2026-11-07 18:45', title: 'Abendessen bei Oma' }],
  ['Um 5 beim Bäcker', { start: '2026-11-03 17:00', flags: ['meridiem-guessed'] }],
  ['Mittagessen um 12', { start: '2026-11-03 12:00', title: 'Mittagessen' }],
  ['Anruf 10 vor 4 morgen', { start: '2026-11-04 15:50', title: 'Anruf' }],

  // --- ranges
  ['Do 14-16 Uhr Elternsprechtag', { start: '2026-11-05 14:00', end: '2026-11-05 16:00', title: 'Elternsprechtag' }],
  ['Probe morgen von 10 bis 12 Uhr', { start: '2026-11-04 10:00', end: '2026-11-04 12:00', title: 'Probe' }],
  ['Paket-Abholung morgen zwischen 14 und 18 Uhr', { start: '2026-11-04 14:00', end: '2026-11-04 18:00', title: 'Paket-Abholung' }],
  ['vom 24.-28.12. Urlaub', { start: '2026-12-24', end: '2026-12-28', title: 'Urlaub' }],
  ['Skifreizeit 2. bis 6. Februar', { start: '2027-02-02', end: '2027-02-06', title: 'Skifreizeit' }],

  // --- past context is not the event
  ['Letztes Mal am 3.11. war alles gut, nächster Termin 3.12. um 10', { start: '2026-12-03 10:00' }],

  // --- places
  ['Zoom https://zoom.us/j/123456 morgen 14 Uhr Projekt-Update',
    { start: '2026-11-04 14:00', location: 'https://zoom.us/j/123456', title: 'Projekt-Update' }],

  // --- English
  ['Call at 3pm tomorrow', { start: '2026-11-04 15:00', title: 'Call' }],
  ['Dentist appointment on Dec 3rd at 5:15pm', { start: '2026-12-03 17:15', title: 'Dentist' }],
  ['Lunch next Friday at noon', { start: '2026-11-06 12:00', title: 'Lunch', flags: ['next-weekday-ambiguous'] }],
  ['Team sync Thursday 10-11am', { start: '2026-11-05 10:00', end: '2026-11-05 11:00', title: 'Team sync' }],
  ['Flight on 2026-12-20 06:40', { start: '2026-12-20 06:40', title: 'Flight' }],
  ['Dinner tonight at 8?', { start: '2026-11-03 20:00', title: 'Dinner', status: 'tentative' }],
  ['Parents evening on 3 December, 6:30 pm', { start: '2026-12-03 18:30', title: 'Parents evening' }],
  ['Pick-up half past 4 on Saturday', { start: '2026-11-07 16:30', title: 'Pick-up' }],

  // --- real-world messages
  ['Hallo Frau Schmidt, wir bestätigen Ihren Tisch für 4 Personen am Samstag, 14.11.2026 um 19:30 Uhr. Restaurant Lindenhof, Marktplatz 3',
    { start: '2026-11-14 19:30', title: 'Restaurant Lindenhof', location: 'Restaurant Lindenhof, Marktplatz 3' }],
  ['Erinnerung: Ihre Impfung ist am 10.11. zwischen 8:00 und 8:15 Uhr in der Praxis Dr. Weber.',
    { start: '2026-11-10 08:00', end: '2026-11-10 08:15', title: 'Impfung', location: 'Praxis Dr. Weber' }],
  ['Kita geschlossen am 23.12. und 24.12.', { start: '2026-12-23', end: '2026-12-24', title: 'Kita geschlossen' }],
  ['Kannst du morgen die Kinder um viertel vor 3 abholen?', { start: '2026-11-04 14:45', title: 'Kinder abholen', status: 'tentative' }],
  ['Wir sehen uns Mittwoch! Gegen 18 Uhr bei mir', { start: '2026-11-04 18:00', title: 'Treffen' }],
  ['Hey! Spieleabend am 21. um 19 Uhr?', { start: '2026-11-21 19:00', title: 'Spieleabend', status: 'tentative', flags: ['month-assumed'] }],
  ['Am 3.12. habe ich keine Zeit, aber am 4.12. um 15 Uhr', { start: '2026-12-04 15:00' }],
  ['Meeting moved to Friday 3pm', { start: '2026-11-06 15:00', title: 'Meeting', flags: ['reschedule'] }],
  ['Yoga fällt am Donnerstag aus', { start: '2026-11-05', title: 'Yoga', flags: ['cancel'] }],
  ['Sprechstunde jeden Dienstag 14-15 Uhr', { start: '2026-11-03 14:00', end: '2026-11-03 15:00', title: 'Sprechstunde', rrule: 'FREQ=WEEKLY;BYDAY=TU' }],
  ['Chor donnerstags 19:30', { start: '2026-11-05 19:30', title: 'Chor', rrule: 'FREQ=WEEKLY;BYDAY=TH' }],
  ['Training jeden zweiten Mittwoch um 18 Uhr', { start: '2026-11-04 18:00', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE' }],
  ['Ich bin vom 2. bis zum 9. Januar im Urlaub', { start: '2027-01-02', end: '2027-01-09', title: 'Urlaub' }],
  ['Mama Geburtstag 70!!! 28.11. Feier ab 15 Uhr im Gemeindehaus', { start: '2026-11-28 15:00', location: 'Gemeindehaus' }],
  ['Termin: 3.12.2026, 17:15–17:45 Uhr, Kontrolle', { start: '2026-12-03 17:15', end: '2026-12-03 17:45', title: 'Kontrolle' }],
  ['Der Zug fährt um 8:12 ab Gleis 7', { start: '2026-11-04 08:12', flags: ['date-assumed'] }],
  ['Treffen 12.1. 9:30', { start: '2027-01-12 09:30', title: 'Treffen' }],
  ['Präsentation nächste Woche Mittwoch 10 Uhr', { start: '2026-11-11 10:00', title: 'Präsentation' }],
  ['Präsentation Mittwoch nächste Woche um 10', { start: '2026-11-11 10:00', title: 'Präsentation' }],
  ['Kontrolle um vierzehn Uhr am Freitag', { start: '2026-11-06 14:00', title: 'Kontrolle' }],
  ['morgen zwölf uhr dreißig Mittagspause', { start: '2026-11-04 12:30', title: 'Mittagspause' }],
  ['um 8 morgens Laufen', { start: '2026-11-04 08:00', title: 'Laufen' }],
  ['Regional: Bus um viertel 8', { start: '2026-11-03 19:15', flags: ['regional-time'] }],
  ['Elternbrief: der morgige Wandertag beginnt um 8 Uhr', { start: '2026-11-04 08:00' }],

  // --- no event in here
  ['Kein Datum hier, nur Text.', null],
  ['Die Rechnung über 17.50 Euro ist bezahlt', null],
  ['Version 1.2.3 ist draußen', null],
  ['Ich komme in 5 Minuten', null],
  ['Ruf mich an: 0551 39 12345', null],
  ['so ein Mist', null],
];

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
