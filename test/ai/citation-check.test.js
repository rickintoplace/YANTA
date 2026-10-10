import { describe, it, expect, vi, beforeEach } from 'vitest';

let decideReply = null;
const decideCalls = [];

vi.mock('../../src/ai/openrouter-client.js', () => ({
  decisionsAvailable: () => true,
  openRouterDecide: vi.fn(async (req) => {
    decideCalls.push(req);
    return decideReply(req);
  }),
}));

const { createSourceRegistry } = await import('../../src/ai/citation-sources.js');
const { checkCitations, hasCitations } = await import('../../src/ai/citation-check.js');

const PAGE = 'The ozone layer absorbs 97 to 99 percent of the Sun\'s medium-frequency ultraviolet light, which otherwise would potentially damage exposed life forms near the surface. It was discovered in 1913 by the French physicists Charles Fabry and Henri Buisson.';

beforeEach(() => {
  decideCalls.length = 0;
  decideReply = () => ({ answers: { support: { type: 'choice', choice: 'entailed', probabilities: { entailed: 1 } } } });
});

describe('source registry', () => {
  it('numbers sources, keeps the number on a re-read and adds cite fields', () => {
    const reg = createSourceRegistry();
    const search = reg.register('web_search', { results: [{ title: 'Ozone', url: 'https://x/ozone', description: 'Layer' }, { title: 'B', url: 'https://x/b', description: 'b' }] });
    const page = reg.register('web_read', { url: 'https://x/ozone', title: 'Ozone layer', text: PAGE });
    const note = reg.register('read_note', { id: 'n1', title: 'Mine', markdown: '# Notes' });

    expect(search.results.map((r) => r.cite)).toEqual([1, 2]);
    expect(page.cite).toBe(1);
    expect(note.cite).toBe(3);
    expect(reg.documents()[0].text).toBe(PAGE);
    expect(reg.register('create_note', { ok: true })).toBeUndefined();
  });
});

describe('checkCitations', () => {
  const answer = [
    'The ozone layer absorbs most medium-frequency UV light.[1]{c1}',
    'It was discovered in 1913 by G. M. B. Dobson.[1]{c2}',
    '',
    'EVI1',
    'c1|1|"The ozone layer absorbs 97 to 99 percent of the Sun\'s medium-frequency ultraviolet light"',
    'c2|1|"It was discovered in 1913 by the French physicists Charles Fabry and Henri Buisson."',
    'END_EVI1',
  ].join('\n');

  it('passes supported quotes and flags the judge\'s contradictions', async () => {
    const reg = createSourceRegistry();
    reg.register('web_read', { url: 'https://x/ozone', title: 'Ozone layer', text: PAGE });

    decideReply = (req) => ({
      answers: {
        support: /Dobson/.test(req.state.claim)
          ? { type: 'choice', choice: 'contradicted', probabilities: { contradicted: 0.9, entailed: 0.1 } }
          : { type: 'choice', choice: 'entailed', probabilities: { entailed: 0.95, partially_entailed: 0.05 } },
      },
    });

    expect(hasCitations(answer)).toBe(true);
    const check = await checkCitations(answer, reg);

    expect(decideCalls).toHaveLength(2);
    expect(check.total).toBe(2);
    expect(check.passed).toBe(1);
    expect(check.verdict).toBe('revise');
    expect(check.items[1].problems).toContain('contradicted_by_source');
    expect(check.items[0].source.url).toBe('https://x/ozone');
    expect(check.instructionsForModel).toBeTruthy();
  });

  it('catches a made-up quote even when the judge says supported', async () => {
    const reg = createSourceRegistry();
    reg.register('web_read', { url: 'https://x/ozone', title: 'Ozone layer', text: PAGE });

    const fake = answer.replace('It was discovered in 1913 by the French physicists Charles Fabry and Henri Buisson.', 'Dobson discovered the ozone layer in 1913 while working at Oxford University in England.');
    const check = await checkCitations(fake, reg);

    expect(check.items[1].matched).toBe(false);
    expect(check.items[1].ok).toBe(false);
    expect(check.items[1].problems).toContain('quote_not_in_source');
  });

  it('ignores answers without citations', async () => {
    const reg = createSourceRegistry();
    reg.register('web_read', { url: 'u', title: 't', text: PAGE });
    expect(await checkCitations('Just an answer.', reg)).toBeNull();
  });
});

describe('citation number repair', () => {
  it('moves a quote cited under the wrong number to the one source that holds it', async () => {
    const reg = createSourceRegistry();
    reg.register('rss_search_items', { items: [
      { id: 'a', title: 'iPad mini', summary: 'Apple hat ein neues iPad mini vorgestellt.' },
      { id: 'b', title: 'Ticket', summary: 'Das Deutschlandticket kostet ab Januar 2027 63 Euro pro Monat.' },
    ] });

    const answer = [
      'Das Ticket kostet ab 2027 63 Euro.[1]{c1}',
      '',
      'EVI1',
      'c1|1|"Das Deutschlandticket kostet ab Januar 2027 63 Euro pro Monat."',
      'END_EVI1',
    ].join('\n');

    const check = await checkCitations(answer, reg);

    expect(check.renumbered).toBe(1);
    expect(check.text).toContain('63 Euro.[2]{c1}');
    expect(check.text).toContain('c1|2|');
    expect(check.items[0]).toMatchObject({ n: 2, matched: true, ok: true });
  });

  it('leaves a quote found nowhere alone', async () => {
    const reg = createSourceRegistry();
    reg.register('web_read', { url: 'https://x', title: 'X', text: PAGE });

    const answer = 'Made up.[1]{c1}\n\nEVI1\nc1|1|"This sentence is not in any source at all."\nEND_EVI1';
    const check = await checkCitations(answer, reg);

    expect(check.text).toBeNull();
    expect(check.items[0].matched).toBe(false);
  });
});
