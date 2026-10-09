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
  // Kept repeating calls it already had the results of; wrapped up early.
  LOOP: 'loop',
});

/*
  Doom loops: a model that calls the same tool with the same arguments
  again rarely learns anything new, and cheap models do it until the
  budget is gone. The second identical call runs but carries a note; the
  third and later are not run; after three refusals the run wraps up.
*/
const REPEAT_NOTE_AT = 2;
const REPEAT_BLOCK_AT = 3;
const REPEAT_STOP_AFTER = 3;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function withRepeatNote(payload) {
  const note = 'You already made this exact call earlier in this run; this is the same result. Use it, change the arguments, or answer.';
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...payload, harnessNote: note }
    : { result: payload, harnessNote: note };
}

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
 * @returns {Promise<{text: string, finalText: string, rounds: number, stop: string, toolCalls: Array, thread: Array}>}
 */
// Sent after an empty reply. Model-facing, so English.
const EMPTY_REPLY_INSTRUCTION =
  'Your last reply was empty. Answer the user now, in their language, using what you already have; call a tool only if you truly need one.';

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
  const callCounts = new Map();
  let repeatBlocks = 0;
  let stop = AGENT_STOP.MAX_ROUNDS;

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
  let emptyRetried = false;

  for (; round < maxRounds; round++) {
    if (signal?.aborted) {
      return { text, finalText: '', rounds: round, stop: AGENT_STOP.ABORTED, toolCalls: executed };
    }

    await onRound?.({ round, maxRounds });

    const message = await request(typeof tools === 'function' ? tools() : tools, round);

    const content = String(message.content || '').trim();
    const toolCalls = message.tool_calls || [];

    if (content) text = content;

    /*
      An empty reply — no text, no tool call — happens now and then (a
      model that spent its output on thinking, a provider hiccup). Asking
      once more with the thread as it is usually gets the answer; showing
      the user "no response" never helps.
    */
    if (!toolCalls.length && !content && !emptyRetried && !signal?.aborted) {
      emptyRetried = true;
      thread.push({ role: 'user', content: EMPTY_REPLY_INSTRUCTION });
      continue;
    }

    if (!toolCalls.length) {
      return { text, finalText: content, rounds: round + 1, stop: AGENT_STOP.COMPLETE, toolCalls: executed, thread };
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

      const signature = `${name}:${stableStringify(args)}`;
      const repeat = (callCounts.get(signature) || 0) + 1;
      callCounts.set(signature, repeat);

      if (repeat >= REPEAT_BLOCK_AT) {
        repeatBlocks++;
        payload = {
          error: `Not run: you have made this exact call ${repeat - 1} times already and have its result. Use it, try different arguments, or answer.`,
          code: 'EAI_REPEATED_CALL',
        };

        await onToolResult?.({ name, args, result: payload, ran: false });
        thread.push({ role: 'tool', tool_call_id: call.id, name, content: serializeToolResult(payload) });
        continue;
      }

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

      if (repeat >= REPEAT_NOTE_AT) payload = withRepeatNote(payload);

      // `ran`: the registry executed it (not refused, short-circuited or failed).
      // A hook may return a replacement for what the model sees (e.g. the
      // same result with citation numbers added).
      const replaced = await onToolResult?.({ name, args, result: payload, ran });
      if (replaced !== undefined) payload = replaced;

      thread.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: serializeToolResult(payload),
      });
    }

    if (repeatBlocks >= REPEAT_STOP_AFTER) {
      stop = AGENT_STOP.LOOP;
      round++;
      break;
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

  return { text, finalText, rounds: round + 1, stop, toolCalls: executed, thread };
}
