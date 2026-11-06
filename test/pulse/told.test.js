import { describe, it, expect } from 'vitest';

import {
  toldCards,
  toldIndex,
  describeTold,
  markAlreadyReported,
  noteSeenEvents,
  onlyRepeatsEvents,
} from '../../src/pulse/pulse-told.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-02T09:00:00+01:00');

const card = (routineName, ageDays, title, body, extra = {}) => ({
  id: `${routineName}-${ageDays}`,
  routineName,
  createdAt: NOW - ageDays * DAY,
  title,
  body,
  ...extra,
});

const inbox = [
  card('birthday-watch', 1, 'Steinerne Hochzeit deiner Großeltern am Freitag', 'Fr 06.11. – Großeltern: steinerne Hochzeit (65 Jahre, ganztägig). Karte oder Anruf.'),
  card('morning-brief', 0.1, 'Dein Tag', 'Levis Zahnarzttermin am Mittwoch.'),
  card('morning-brief', 2, 'Gestern', 'Nichts.'),
  card('birthday-watch', 12, 'Alt', 'Geburtstag Oma'),
];

const events = {
  events: [
    { id: 'e1', title: 'Großeltern steinerne Hochzeit', start: '2026-11-06' },
    { id: 'e2', title: 'Geburtstag Anna', start: '2026-11-07' },
    { id: 'e3', title: 'Zahnarzt', start: '2026-11-04T10:00:00+01:00' },
  ],
};

describe('what a run is told it already said', () => {
  it('shows a routine its own recent cards, and other routines\' from today', () => {
    const told = toldCards(inbox, 'birthday-watch', NOW);

    expect(told.own.map((c) => c.title)).toEqual(['Steinerne Hochzeit deiner Großeltern am Freitag']);
    expect(told.others.map((c) => c.title)).toEqual(['Dein Tag']);

    const prompt = describeTold(told);
    expect(prompt).toContain('# Already told the user by this routine');
    expect(prompt).toContain('steinerne Hochzeit');
    expect(prompt).toContain('# Already told the user today (by other routines)');
  });

  it('is empty when nothing was told', () => {
    expect(describeTold(toldCards([], 'birthday-watch', NOW))).toBe('');
  });

  it('marks calendar events an earlier card named, by whole words', () => {
    const told = toldIndex(toldCards(inbox, 'birthday-watch', NOW));
    const marked = markAlreadyReported('search_events', events, told).events;

    expect(marked[0].alreadyReported).toBe('birthday-watch, 2026-11-01');
    expect(marked[1].alreadyReported).toBeUndefined();
    // "Zahnarzttermin" in a card is not the event "Zahnarzt".
    expect(marked[2].alreadyReported).toBeUndefined();
  });

  it('marks cited feed items, from the routine\'s own earlier cards too', () => {
    const own = card('feed-digest', 3, 'Digest', 'Bike lanes approved [1].', {
      sources: [{ n: 1, id: 'rss-42', url: 'https://example.org/a' }],
    });
    const told = toldIndex(toldCards([own], 'feed-digest', NOW));
    const result = markAlreadyReported('rss_search_items', { items: [{ id: 'rss-42' }, { id: 'rss-43' }] }, told);

    expect(result.items[0].alreadyReported).toBe('feed-digest, 2026-10-30');
    expect(result.items[1].alreadyReported).toBeUndefined();
  });
});

describe('a card that only repeats reported events', () => {
  const told = toldIndex(toldCards(inbox, 'birthday-watch', NOW));
  const seen = new Map();
  noteSeenEvents(seen, 'search_events', markAlreadyReported('search_events', {
    events: [
      { id: 'e1', title: 'Großeltern steinerne Hochzeit', start: '2026-11-06' },
      { id: 'e4', title: 'Max', start: '2026-11-10' },
    ],
  }, told));

  it('is a repeat when every event it names was reported', () => {
    expect(onlyRepeatsEvents({ title: 'Steinerne Hochzeit am Freitag', body: 'Großeltern: steinerne Hochzeit, Karte schreiben!' }, seen))
      .toEqual(['Großeltern steinerne Hochzeit']);
  });

  it('is new as soon as it names one unreported event', () => {
    expect(onlyRepeatsEvents({ title: 'Max am Dienstag', body: 'Großeltern steinerne Hochzeit war schon dran.' }, seen)).toBeNull();
  });
});
