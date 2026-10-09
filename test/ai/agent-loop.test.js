import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let script = [];

vi.mock('../../src/ai/openrouter-client.js', () => ({
  openRouterChatCompletion: vi.fn(async (req) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    const next = script.shift();
    if (!next) throw new Error('script exhausted');
    return next;
  }),
}));

const executed = [];
vi.mock('../../src/ai/tool-registry.js', () => ({
  executeToolCall: vi.fn(async (call) => {
    const args = JSON.parse(call.function.arguments || '{}');
    executed.push({ name: call.function.name, args });
    return { name: call.function.name, args, result: { ok: true, big: 'x'.repeat(args.size || 0) } };
  }),
}));

const { runAgentLoop, AGENT_STOP } = await import('../../src/ai/agent-loop.js');
const { TOOL_RESULT_MAX_CHARS } = await import('../../src/ai/agent-runtime.js');

const toolCall = (name, args, id = 'c1') => ({
  id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
});

beforeEach(() => {
  calls.length = 0;
  executed.length = 0;
  script = [];
});

describe('headless agent loop', () => {
  it('asks once more after an empty reply instead of ending with nothing', async () => {
    script = [
      { content: '', tool_calls: [] },
      { content: 'Here it is.', tool_calls: [] },
    ];

    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], tools: [] });

    expect(res.finalText).toBe('Here it is.');
    expect(calls[1].messages.at(-1)).toMatchObject({ role: 'user' });
    expect(calls[1].messages.at(-1).content).toMatch(/empty/i);
  });

  it('gives up after the one retry', async () => {
    script = [
      { content: '', tool_calls: [] },
      { content: '', tool_calls: [] },
    ];

    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], tools: [] });

    expect(calls).toHaveLength(2);
    expect(res.stop).toBe(AGENT_STOP.COMPLETE);
    expect(res.finalText).toBe('');
  });

  it('does not run a tool whose arguments were cut off, and says why', async () => {
    script = [
      { content: '', finish_reason: 'length', tool_calls: [toolCall('create_note', '{"title":"Digest","body":"## Long')] },
      { content: 'ok, smaller', tool_calls: [] },
    ];

    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], tools: [] });

    expect(executed).toEqual([]);
    const toolMsg = calls[1].messages.find((m) => m.role === 'tool');
    expect(toolMsg.content).toContain('EAI_TOOL_ARGS_TRUNCATED');
    expect(res.stop).toBe(AGENT_STOP.COMPLETE);
  });

  it('echoes reasoning_details back with the tool turn', async () => {
    const details = [{ type: 'reasoning.text', text: 'think', index: 0 }];
    script = [
      { content: '', reasoning_details: details, tool_calls: [toolCall('search_notes', { q: 'x' })] },
      { content: 'done', tool_calls: [] },
    ];

    await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], tools: [] });

    const assistantTurn = calls[1].messages.find((m) => m.role === 'assistant');
    expect(assistantTurn.reasoning_details).toEqual(details);
  });

  it('caps oversized tool results', async () => {
    script = [
      { content: '', tool_calls: [toolCall('read_notes', { size: 100_000 })] },
      { content: 'done', tool_calls: [] },
    ];

    await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], tools: [] });

    const toolMsg = calls[1].messages.find((m) => m.role === 'tool');
    expect(toolMsg.content.length).toBeLessThan(TOOL_RESULT_MAX_CHARS + 400);
    expect(toolMsg.content).toContain('characters omitted');
  });

  it('ends with a decision round when the budget is spent', async () => {
    script = [
      { content: '', tool_calls: [toolCall('search_notes', { q: 'a' }, 'a')] },
      { content: '', tool_calls: [toolCall('search_notes', { q: 'b' }, 'b')] },
      { content: '', tool_calls: [toolCall('pulse_emit', { title: 'T', body: 'B' }, 'e')] },
    ];

    const emitted = [];
    const res = await runAgentLoop({
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      maxRounds: 2,
      finalTools: [{ type: 'function', function: { name: 'pulse_emit' } }],
      finalInstruction: 'decide now',
      beforeToolCall: async ({ name, args }) => {
        if (name === 'pulse_emit') { emitted.push(args); return { result: { ok: true } }; }
        return undefined;
      },
    });

    expect(res.stop).toBe(AGENT_STOP.MAX_ROUNDS);
    expect(calls).toHaveLength(3);
    expect(calls[2].tools.map((t) => t.function.name)).toEqual(['pulse_emit']);
    expect(calls[2].messages.at(-1)).toEqual({ role: 'user', content: 'decide now' });
    expect(emitted).toEqual([{ title: 'T', body: 'B' }]);
  });

  it('runs the chat through requestRound: refusals, synthetic results and the wrap-up text', async () => {
    const rounds = [];
    const seen = [];
    const replies = [
      { content: 'Looking.', tool_calls: [toolCall('tools_load', { groups: ['notes'] }, 'l'), toolCall('delete_note', { noteId: 'n1' }, 'd')] },
      { content: '', tool_calls: [toolCall('search_notes', { q: 'x' }, 's')] },
      { content: 'Here is what I found.', tool_calls: [] },
    ];

    let toolsRound = 0;
    const res = await runAgentLoop({
      messages: [{ role: 'user', content: 'go' }],
      tools: () => [{ type: 'function', function: { name: `round${toolsRound++}` } }],
      maxRounds: 2,
      requestRound: async ({ messages, tools, round, final }) => {
        rounds.push({ round, final, tools: tools.map((t) => t.function.name), last: messages.at(-1) });
        return replies.shift();
      },
      beforeToolCall: async ({ name }) => {
        if (name === 'tools_load') return { result: { loaded: ['notes'] } };
        if (name === 'delete_note') return { allowed: false, reason: 'Blocked by user', code: 'EAI_HUMAN_BLOCKED' };
        return undefined;
      },
      onToolResult: (r) => seen.push({ name: r.name, ran: r.ran, error: r.result?.error || null }),
    });

    // No provider call of its own: everything went through requestRound.
    expect(calls).toHaveLength(0);
    expect(rounds.map((r) => [r.round, r.final])).toEqual([[0, false], [1, false], [2, true]]);
    // The tool list is re-read each round (tools_load widens it).
    expect(rounds[0].tools).toEqual(['round0']);
    expect(rounds[1].tools).toEqual(['round1']);
    expect(rounds[2].tools).toEqual([]);
    expect(rounds[2].last.role).toBe('user');

    expect(seen).toEqual([
      { name: 'tools_load', ran: false, error: null },
      { name: 'delete_note', ran: false, error: 'Blocked by user' },
      { name: 'search_notes', ran: true, error: null },
    ]);
    expect(executed.map((e) => e.name)).toEqual(['search_notes']);

    expect(res.stop).toBe(AGENT_STOP.MAX_ROUNDS);
    expect(res.finalText).toBe('Here is what I found.');
  });

  it('lets an abort in the wrap-up round reach the caller', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(runAgentLoop({
      messages: [{ role: 'user', content: 'go' }],
      maxRounds: 1,
      requestRound: async ({ final }) => {
        if (final) throw abort;
        return { content: '', tool_calls: [toolCall('search_notes', {})] };
      },
    })).rejects.toBe(abort);
  });

  it('notes the second identical call, refuses the third and stops a loop', async () => {
    const same = () => toolCall('search_notes', { q: 'x', limit: 5 });
    const sameReordered = () => toolCall('search_notes', '{"limit":5,"q":"x"}');
    script = [
      { content: '', tool_calls: [same()] },
      { content: '', tool_calls: [sameReordered()] },
      { content: '', tool_calls: [same()] },
      { content: '', tool_calls: [same()] },
      { content: '', tool_calls: [same()] },
      { content: 'Stopped.', tool_calls: [] },
    ];

    const results = [];
    const res = await runAgentLoop({
      messages: [{ role: 'user', content: 'go' }],
      maxRounds: 10,
      onToolResult: (r) => results.push(r),
    });

    expect(executed).toHaveLength(2);
    expect(results[1].result.harnessNote).toMatch(/already made this exact call/);
    expect(results.slice(2).every((r) => r.result.code === 'EAI_REPEATED_CALL')).toBe(true);
    expect(res.stop).toBe(AGENT_STOP.LOOP);
    expect(res.finalText).toBe('Stopped.');
    expect(calls).toHaveLength(6);
  });
});
