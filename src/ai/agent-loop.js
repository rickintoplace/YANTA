// ============================================================
// YANTA AI — the agent loop
//
// The provider round-trip + tool-execution cycle without any UI. Both
// agents run on it: the chat (assistant-ui.js) streams each round
// through `requestRound` and asks for approvals in `beforeToolCall`;
// Pulse routines run headless with a policy gate in the same hook.
// One loop, so a fix to argument handling, result budgets or the
// wrap-up round reaches both.
// ============================================================

import {
  openRouterChatCompletion,
} from './openrouter-client.js';

import {
  executeToolCall,
} from './tool-registry.js';

import {
  serializeToolResult,
  parseToolArguments,
  assistantToolTurn,
  compactThread,
  ROUND_BUDGET_SPENT_INSTRUCTION,
} from './agent-runtime.js';

export const AGENT_STOP = Object.freeze({
  COMPLETE: 'complete',
  MAX_ROUNDS: 'max-rounds',
  ABORTED: 'aborted',
});

function toolErrorPayload(err) {
  return {
    error: err?.message || String(err),
    code: err?.code || null,
    permission: err?.permission || null,
  };
}

/**
 * Runs an agent until the model answers without tool calls, the round
 * budget is spent, or the signal aborts.
 *
 * `beforeToolCall` is the policy gate: return `{ allowed: false, reason }`
 * to feed the model a refusal instead of executing, or `{ result }` to
 * short-circuit with a synthetic result. Returning nothing allows the call.
 *
 * `tools` may be a function, which is re-read before every round. That is
 * what lets a `tools_load` call widen the toolset mid-run: the gate
 * records the request, and the next round sees the larger set.
 *
 * `source` labels tool calls for the app; `budgetSource` labels the
 * provider request for server-side budgeting. They are separate because
 * the server must not learn the routine name.
 *
 * `requestRound({ messages, tools, round, final, signal })` replaces the
 * plain provider call — the chat streams and renders there. It must
 * return the assistant message ({ content, tool_calls, finish_reason,
 * reasoning_details }).
 *
 * @returns {Promise<{text: string, finalText: string, rounds: number, stop: string, toolCalls: Array}>}
 */
export async function runAgentLoop({
  messages,
  tools = [],
  maxRounds = 4,
  signal = null,
  permissions = null,
  source = 'agent',
  budgetSource = '',
  beforeToolCall = null,
  onToolResult = null,
  onRound = null,
  // When the rounds run out: one more request with only these tools (e.g.
  // Pulse's pulse_emit) or none, so the run ends with a decision instead
  // of being dropped mid-research.
  finalTools = [],
  finalInstruction = ROUND_BUDGET_SPENT_INSTRUCTION,
  requestRound = null,
} = {}) {
  const thread = [...messages];
  const executed = [];

  // The final round sends one extra instruction after the thread.
  const request = (toolList, round, final = null) => {
    compactThread(thread);

    const msgs = final ? [...thread, final] : thread;

    return requestRound
      ? requestRound({ messages: msgs, tools: toolList, round, final: !!final, signal })
      : openRouterChatCompletion({ messages: msgs, tools: toolList, signal, source: budgetSource });
  };

  let text = '';
  let round = 0;

  for (; round < maxRounds; round++) {
    if (signal?.aborted) {
      return { text, finalText: '', rounds: round, stop: AGENT_STOP.ABORTED, toolCalls: executed };
    }

    await onRound?.({ round, maxRounds });

    const message = await request(typeof tools === 'function' ? tools() : tools, round);

    const content = String(message.content || '').trim();
    const toolCalls = message.tool_calls || [];

    if (content) text = content;

    if (!toolCalls.length) {
      return { text, finalText: content, rounds: round + 1, stop: AGENT_STOP.COMPLETE, toolCalls: executed };
    }

    thread.push(assistantToolTurn(message));

    for (const call of toolCalls) {
      const name = call?.function?.name || '';
      const parsed = parseToolArguments(call, { finishReason: message.finish_reason });

      /*
        Unparseable arguments used to become {} and run anyway — a cut-off
        create_note became an empty "Untitled" note. Now nothing runs and
        the model is told why.
      */
      if (!parsed.ok) {
        await onToolResult?.({ name, args: {}, result: parsed.error });
        thread.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: serializeToolResult(parsed.error),
        });
        continue;
      }

      const args = parsed.args;

      let payload;
      let ran = false;

      try {
        const gate = await beforeToolCall?.({ name, args, call });

        if (gate && gate.allowed === false) {
          payload = {
            error: gate.reason || `Tool "${name}" is not available in this run.`,
            code: gate.code || 'EAI_POLICY_BLOCKED',
          };
        } else if (gate && 'result' in gate) {
          payload = gate.result;
          executed.push({ name, args, result: payload, synthetic: true });
        } else {
          const done = await executeToolCall(call, { permissions, source });
          payload = done.result;
          ran = true;
          executed.push({ name, args, result: payload });
        }
      } catch (err) {
        payload = toolErrorPayload(err);
      }

      // `ran`: the registry executed it (not refused, short-circuited or failed).
      await onToolResult?.({ name, args, result: payload, ran });

      thread.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: serializeToolResult(payload),
      });
    }
  }

  if (signal?.aborted) {
    return { text, finalText: '', rounds: round, stop: AGENT_STOP.ABORTED, toolCalls: executed };
  }

  const finalToolList = typeof finalTools === 'function' ? finalTools() : finalTools;
  let finalText = '';

  try {
    const final = await request(finalToolList || [], round, { role: 'user', content: finalInstruction });

    finalText = String(final.content || '').trim();
    if (finalText) text = finalText;

    for (const call of final.tool_calls || []) {
      const name = call?.function?.name || '';
      const parsed = parseToolArguments(call, { finishReason: final.finish_reason });
      if (!parsed.ok) continue;

      const gate = await beforeToolCall?.({ name, args: parsed.args, call });

      // Only short-circuited (synthetic) results are taken here: the final
      // round exists to report, not to start new work.
      if (gate && 'result' in gate) {
        executed.push({ name, args: parsed.args, result: gate.result, synthetic: true });
        await onToolResult?.({ name, args: parsed.args, result: gate.result });
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.warn('[YANTA AI] final round failed', err);
  }

  return { text, finalText, rounds: round + 1, stop: AGENT_STOP.MAX_ROUNDS, toolCalls: executed };
}
