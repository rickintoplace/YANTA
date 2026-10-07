import { describe, it, expect, vi, beforeEach } from 'vitest';

const requests = [];
let reply = null;
let available = true;

vi.mock('../../src/ai/openrouter-client.js', () => ({
  decisionsAvailable: () => available,
  openRouterDecide: vi.fn(async (req) => {
    requests.push(req);
    if (reply instanceof Error) throw reply;
    return reply;
  }),
}));

vi.mock('../../src/core.js', () => ({ state: {}, store: {} }));
vi.mock('../../src/yjs.js', () => ({ destroyNoteDoc: () => {} }));
vi.mock('../../src/tree.js', () => ({ renderTree: () => {} }));
vi.mock('../../src/ai/brain.js', () => ({
  ensureAiBrain: async () => {},
  AI_BRAIN_IDS: {},
  isAiBrainNote: () => false,
  writeBrainNote: async () => {},
}));
vi.mock('../../src/ai/skills.js', () => ({
  // Just enough of the real parser: the raw frontmatter text.
  parseSkillFrontmatter: (md) => ({ rawFrontmatter: (/^---\n([\s\S]*?)\n---/.exec(md) || [])[1] || '' }),
  listInstalledSkills: async () => [],
}));

const { routineFromSkill } = await import('../../src/pulse/pulse-routines.js');
const { runCheck, rankResult } = await import('../../src/pulse/pulse-decider.js');

const routine = (pulseLines) => routineFromSkill(
  { name: 'watch', noteId: 'n1' },
  ['---', 'name: watch', 'pulse:', '  on: [rss-new]', ...pulseLines.map((l) => `  ${l}`), '---', '', '# watch', '', '## Goal', 'Local politics.'].join('\n')
);

const sensors = {
  hasSignal: true,
  signals: { 'rss-new': { summary: '2 new', detail: [{ title: 'Council votes on bike lanes', feed: 'City', text: '' }] } },
};

beforeEach(() => {
  requests.length = 0;
  reply = null;
  available = true;
});

describe('routine decision keys', () => {
  it('are off unless set', () => {
    const r = routine([]);
    expect(r.check).toBe('');
    expect(r.rank).toBe('');
    expect(r.checkMin).toBe(0.5);
    expect(r.inboxMin).toBe(2);
  });

  it('read a condition, true, false and clamped thresholds', () => {
    const r = routine(['check: "an article is about the city council"', 'checkMin: 1.7', 'rank: true', 'inboxMin: 1']);
    expect(r.check).toBe('an article is about the city council');
    expect(r.checkMin).toBe(1);
    expect(r.rank).toBe(true);
    expect(r.inboxMin).toBe(1);
    expect(routine(['check: off']).check).toBe('');
  });

  it('flag a check without sensor triggers', () => {
    const r = routineFromSkill({ name: 'x' }, '---\nname: x\npulse:\n  when: "0 7 * * *"\n  check: true\n---\n');
    expect(r.invalid.join(' ')).toMatch(/check/);
  });
});

describe('check before the run', () => {
  it('skips below checkMin and sends the routine goal plus what the sensors saw', async () => {
    reply = { answers: { check: { type: 'noul', noul: 0.12 } } };
    const result = await runCheck(routine(['check: "an article is about the city council"']), sensors);

    expect(result).toEqual({ probability: 0.12, run: false });
    expect(requests[0].questions.check.type).toBe('noul');
    expect(requests[0].questions.check.instructions).toMatch(/city council/);
    expect(requests[0].state.routine.instructions).toMatch(/Local politics/);
    expect(requests[0].state.routine.instructions).not.toMatch(/^---/);
    expect(requests[0].state.newSinceLastRun['rss-new'].items[0].title).toMatch(/bike lanes/);
  });

  it('runs at or above checkMin', async () => {
    reply = { answers: { check: { type: 'noul', noul: 0.5 } } };
    expect((await runCheck(routine(['check: true']), sensors)).run).toBe(true);
  });

  it('fails open: no check, no decider, or an error all mean "just run"', async () => {
    expect(await runCheck(routine([]), sensors)).toBeNull();

    available = false;
    expect(await runCheck(routine(['check: true']), sensors)).toBeNull();

    available = true;
    reply = new Error('HTTP 503');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await runCheck(routine(['check: true']), sensors)).toBeNull();
    expect(requests).toHaveLength(1);
  });
});

describe('rank after the run', () => {
  it('grades the card on four levels and compares against inboxMin', async () => {
    reply = { answers: { rank: { type: 'score', score: 1.3 } } };
    const result = await rankResult(routine(['rank: "Does this affect my commute?"']), { title: 'Bike lanes', body: 'Vote on Friday.' });

    expect(result).toEqual({ score: 1.3, inbox: false });
    expect(requests[0].questions.rank).toMatchObject({ type: 'score', instructions: 'Does this affect my commute?' });
    expect(requests[0].questions.rank.criteria).toHaveLength(4);
    expect(requests[0].state.card.title).toBe('Bike lanes');
  });

  it('is off without rank', async () => {
    expect(await rankResult(routine([]), { title: 'x', body: '' })).toBeNull();
    expect(requests).toHaveLength(0);
  });
});
