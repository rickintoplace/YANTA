import { describe, it, expect, vi, beforeEach } from 'vitest';

let inbox = [];
let decide = null;
const decideCalls = [];
let chatReply = null;
const chatCalls = [];

vi.mock('../../src/pulse/pulse-store.js', () => ({
  listInboxItems: async () => inbox,
  contentDigest: (t) => `d${String(t).length}:${String(t).slice(0, 20)}`,
}));
vi.mock('../../src/ai/openrouter-client.js', () => ({
  decisionsAvailable: () => true,
  openRouterDecide: async (req) => { decideCalls.push(req); return decide(req); },
  openRouterChatCompletion: async (req) => { chatCalls.push(req); return chatReply; },
}));
vi.mock('../../src/ai/tool-registry.js', () => ({
  getTool: (name) => ({ search_notes: { risk: 'read' }, read_note: { risk: 'read' }, create_note: { risk: 'write' }, create_event: { risk: 'write' }, delete_note: { risk: 'destructive' }, web_read: { risk: 'read' }, web_search: { risk: 'read' } }[name]),
}));
vi.mock('../../src/ai/untrusted-content.js', () => ({ OUTBOUND_URL_TOOLS: { web_read: 'url' } }));

const { findNearDuplicate, comparableText } = await import('../../src/pulse/pulse-novelty.js');
const { planRoutineTools, needsPlan } = await import('../../src/pulse/pulse-tool-plan.js');

const card = (title, body, ago = 3600e3) => ({ id: title, routineName: 'feeds', title, body, createdAt: Date.now() - ago });

beforeEach(() => {
  inbox = [];
  decideCalls.length = 0;
  chatCalls.length = 0;
  decide = () => ({ answers: { novel: { noul: 0.9 } } });
  localStorage.clear();
});

describe('near-duplicate cards', () => {
  it('treats a reworded, reordered card as a repeat without asking a model', async () => {
    inbox = [card('Three new articles', '- Council votes on bike lanes\n- New tram line\n- Library opens Sundays')];
    const dup = await findNearDuplicate('feeds', { title: 'Three new articles', body: '- New tram line\n- Council votes on bike lanes\n- Library opens Sundays' });
    expect(dup?.reason).toBe('similar');
    expect(decideCalls).toHaveLength(0);
  });

  it('asks the decision model in the grey zone and respects "nothing new"', async () => {
    inbox = [card('Council update', 'The council voted for new bike lanes along the river, construction from March.')];
    decide = () => ({ answers: { novel: { noul: 0.1 } } });
    const dup = await findNearDuplicate('feeds', { title: 'Bike lanes approved', body: 'New bike lanes along the river were approved by the council; building starts in March.' });
    expect(decideCalls).toHaveLength(1);
    expect(dup?.reason).toBe('nothing-new');
  });

  it('delivers new content, other routines\' cards and old cards', async () => {
    inbox = [card('Weather', 'Rain all week'), { ...card('x', 'Totally different topic about tax deadlines'), routineName: 'other' }, card('Old', 'Rain all week', 30 * 24 * 3600e3)];
    expect(await findNearDuplicate('feeds', { title: 'Tax deadline', body: 'Your tax return is due on Friday.' })).toBeNull();
  });

  it('ignores citation markup when comparing', () => {
    expect(comparableText('T', 'Text.[1]{c1}\n\nEVI1\nc1|1|"quote"\nEND_EVI1')).toBe('t text.');
  });
});

describe('tool plan', () => {
  const offered = ['search_notes', 'read_note', 'create_note', 'create_event', 'delete_note', 'web_read']
    .map((name) => ({ type: 'function', function: { name, description: `${name} does things` } }));

  it('only writes and outbound calls need to be planned', () => {
    expect(needsPlan('read_note')).toBe(false);
    expect(needsPlan('create_note')).toBe(true);
    expect(needsPlan('delete_note')).toBe(true);
    expect(needsPlan('web_read')).toBe(true);
  });

  it('plans from the routine text only, keeps known tools, and caches', async () => {
    chatReply = { content: 'Sure: {"tools": ["create_note", "made_up_tool"], "why": "saves a digest"}' };
    const routine = { name: 'digest', markdown: '# digest\nSave a weekly digest note of my reading.' };

    const plan = await planRoutineTools(routine, offered);
    expect(plan.tools).toEqual(['create_note']);
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0].tools).toEqual([]);
    expect(chatCalls[0].messages[1].content).toMatch(/weekly digest/);
    expect(chatCalls[0].messages[1].content).toMatch(/create_event/);
    expect(chatCalls[0].messages[1].content).not.toMatch(/read_note/);

    await planRoutineTools(routine, offered);
    expect(chatCalls).toHaveLength(1);
  });

  it('a read-only toolset needs no planning call; a failed plan returns null', async () => {
    const readOnly = offered.filter((t) => ['search_notes', 'read_note'].includes(t.function.name));
    expect((await planRoutineTools({ markdown: 'x' }, readOnly)).tools).toEqual([]);
    expect(chatCalls).toHaveLength(0);

    chatReply = { content: 'no json here' };
    expect(await planRoutineTools({ markdown: 'other' }, offered)).toBeNull();
  });
});
