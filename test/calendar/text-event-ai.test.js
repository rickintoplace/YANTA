import { describe, it, expect } from 'vitest';

import { draftEventFromText } from '../../src/calendar-text-event.js';
import {
  buildDecision,
  applyDecision,
  refineEventDraft,
  needsRefinement,
  titleFromMessage,
  parseTitleReply,
} from '../../src/calendar-text-ai.js';

import { NOW } from './text-event-corpus.js';

const pad = (n) => String(n).padStart(2, '0');
const local = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const draft = (text) => draftEventFromText(text, { now: NOW });
const choice = (choice, p) => ({ choice, probabilities: { [choice]: p }, confidence: p });

describe('second look at a drafted event', () => {
  it('leaves a clear message alone', () => {
    expect(needsRefinement(draft('Termin beim Zahnarzt 3.12. um 17:15 Uhr'))).toBe(false);
    expect(needsRefinement(draft('Die Party ist nächsten Samstag um 8'))).toBe(true);
  });

  it('asks only what is open, every option written out', () => {
    const d = draft('Die Party ist nächsten Samstag um 8, bring was zu trinken mit');
    const { state, questions } = buildDecision('…', d, { now: NOW, locale: 'de' });
    expect(Object.keys(questions).sort()).toEqual(['half', 'kind', 'tentative', 'title', 'week'].sort());
    expect(questions.half.criteria.afternoon).toMatch(/^20:00/);
    expect(state.today).toMatch(/2026/);
    expect(Object.keys(questions).length).toBeLessThanOrEqual(8);
  });

  it('moves the hour and the week only when the model is sure', () => {
    const d = draft('Die Party ist nächsten Samstag um 8');
    const sure = applyDecision(d, { half: choice('afternoon', 0.93), week: choice('next_week', 0.81) });
    expect(local(sure.start)).toBe('2026-11-14 20:00');
    expect(sure.flags).not.toContain('meridiem-guessed');

    const unsure = applyDecision(d, { half: choice('afternoon', 0.55) });
    expect(local(unsure.start)).toBe('2026-11-07 08:00');
    expect(unsure.choices.map((c) => c.kind)).toContain('half');
  });

  it('switches to another date of the message', () => {
    const text = 'Sportfest 20.11., Elternabend 12.11. 19 Uhr';
    const d = draft(text);
    expect(local(d.start)).toBe('2026-11-12 19:00');
    const { questions } = buildDecision(text, d, { now: NOW });
    const key = Object.entries(questions.moment.criteria).find(([, v]) => v.includes('20.11.'))[0];
    const next = applyDecision(d, { moment: choice(key, 0.9) });
    expect(next.allDay).toBe(true);
    expect(next.source.text).toBe('20.11.');
  });

  it('keeps a title from a recognised phrase unless the pick is very sure', () => {
    const d = draft('Ich habe dir einen Termin beim Zahnarzt gemacht. Nur kontrolle. 3.12. Um 17:15 uhr, ok?');
    const combined = `t${d.titleOptions.indexOf('Zahnarzt – Kontrolle') + 1}`;
    expect(applyDecision(d, { title: choice(combined, 0.6) }).title).toBe('Zahnarzt');
    expect(applyDecision(d, { title: choice(combined, 0.9) }).title).toBe('Zahnarzt – Kontrolle');
  });

  it('accepts a written title only in the sender\'s words', () => {
    const text = 'Am 3.12. habe ich keine Zeit, aber am 4.12. um 15 Uhr könnten wir den Umzug besprechen';
    expect(titleFromMessage('Umzug besprechen', text)).toBe('Umzug besprechen');
    expect(titleFromMessage('Umzugsplanung', text)).toBe('Umzugsplanung'); // "Umzug" + -splanung shares the stem
    expect(titleFromMessage('Projektmeeting', text)).toBe('');
    expect(parseTitleReply('Sure: {"title": "Umzug besprechen"}', text)).toBe('Umzug besprechen');
    expect(parseTitleReply('no json', text)).toBe('');
  });

  it('writes a title when no option convinces, and survives failures', async () => {
    const text = 'Am 3.12. habe ich keine Zeit, aber am 4.12. um 15 Uhr könnten wir den Umzug besprechen';
    const d = draft(text);

    const refined = await refineEventDraft(text, d, {
      now: NOW,
      decide: async () => ({ answers: { title: choice('t1', 0.2), tentative: { noul: 0.9 } } }),
      complete: async () => ({ content: '{"title": "Umzug besprechen"}' }),
    });
    expect(refined.title).toBe('Umzug besprechen');
    expect(refined.status).toBe('tentative');
    expect(local(refined.start)).toBe('2026-12-04 15:00');

    const failed = await refineEventDraft(text, d, {
      now: NOW,
      decide: async () => { throw new Error('offline'); },
      complete: async () => { throw new Error('offline'); },
    });
    expect(failed.title).toBe(d.title);
    expect(failed.start).toBe(d.start);
  });
});
