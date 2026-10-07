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
});
