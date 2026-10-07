// ============================================================
// YANTA AI — shared agent-loop helpers
//
// Used by the agent loop (agent-loop.js), which the chat and Pulse both
// run on, and by anything else that talks tools with a model:
//
//   - serialize tool results within a size budget,
//   - parse tool arguments with errors a model can recover from,
//   - carry reasoning state between tool rounds,
//   - wrap up when the round budget is spent.
// ============================================================

/*
  One tool result may not crowd out the rest of the conversation. A
  read_notes of twenty long notes, or a drawing with embedded images, used
  to go in whole and push requests past the server's size limit mid-turn.
*/
export const TOOL_RESULT_MAX_CHARS = 16_000;

export function serializeToolResult(result, { maxChars = TOOL_RESULT_MAX_CHARS } = {}) {
  let text;

  try {
    text = JSON.stringify(result ?? null);
  } catch {
    text = JSON.stringify({ error: 'Tool result could not be serialized.' });
  }

  if (text.length <= maxChars) return text;

  const head = text.slice(0, Math.floor(maxChars * 0.8));
  const tail = text.slice(-Math.floor(maxChars * 0.1));

  return [
    head,
    `\n…[${text.length - head.length - tail.length} characters omitted. `,
    'Ask for less at once, e.g. read one note at a time or search more narrowly.]…\n',
    tail,
  ].join('');
}

/**
 * Parse a tool call's arguments. Returns { ok: true, args } or
 * { ok: false, error } with an error payload to send back as the tool result.
 * finishReason 'length' means the model ran out of output budget while
 * writing the call — say so, or it will just retry the same oversized call.
 */
export function parseToolArguments(call, { finishReason = '' } = {}) {
  const raw = String(call?.function?.arguments ?? '').trim();

  if (!raw) return { ok: true, args: {} };

  try {
    const args = JSON.parse(raw);

    if (args && typeof args === 'object' && !Array.isArray(args)) {
      return { ok: true, args };
    }

    throw new Error('arguments must be a JSON object');
  } catch (err) {
    const truncated = finishReason === 'length';

    return {
      ok: false,
      error: {
        error: truncated
          ? 'Your tool call was cut off: the output limit was reached while writing its arguments. Nothing was executed. Split the work into smaller calls (e.g. create the note with a short body, then append the rest in parts).'
          : `The arguments were not valid JSON (${err?.message || 'parse error'}). Nothing was executed. Call the tool again with a valid JSON object.`,
        code: truncated ? 'EAI_TOOL_ARGS_TRUNCATED' : 'EAI_TOOL_ARGS_INVALID',
        received: raw.slice(0, 300),
      },
    };
  }
}

/**
 * The assistant message to append to the thread after a tool-calling
 * round. Thinking-mode models (DeepSeek V4.x, Gemini 3) reject the next
 * request unless the round's reasoning_details come back unchanged.
 */
export function assistantToolTurn(message = {}) {
  const turn = {
    role: 'assistant',
    content: message.content || null,
    tool_calls: message.tool_calls || [],
  };

  if (Array.isArray(message.reasoning_details) && message.reasoning_details.length) {
    turn.reasoning_details = message.reasoning_details;
  }

  return turn;
}

/** Appended when the round budget is spent, before a final tool-less call. */
export const ROUND_BUDGET_SPENT_INSTRUCTION = [
  'The tool round budget for this request is used up; no more tools can be called.',
  'Reply to the user now: say what you found or did so far, what is still open,',
  'and what they could ask next. Do not pretend unfinished steps were done.',
].join(' ');

/*
  A run's thread grows by every tool result. Past a budget the oldest
  results are swapped for a one-line stub the model can act on ("call
  it again"), in one batch down to 60 % so the cached prefix only breaks
  now and then rather than every round. The latest results stay whole:
  they are what the model is working with.
*/
export const THREAD_MAX_CHARS = 80_000;

function messageChars(message) {
  let n = String(message?.content ?? '').length;

  for (const call of message?.tool_calls || []) {
    n += String(call?.function?.arguments ?? '').length + 40;
  }

  return n;
}

/** Compacts `thread` in place. Returns how many results were stubbed. */
export function compactThread(thread, { maxChars = THREAD_MAX_CHARS, keepRecent = 4 } = {}) {
  let total = thread.reduce((n, m) => n + messageChars(m), 0);

  if (total <= maxChars) return 0;

  const target = maxChars * 0.6;
  const toolIndexes = thread.flatMap((m, i) => (m?.role === 'tool' ? [i] : []));
  const candidates = toolIndexes.slice(0, Math.max(0, toolIndexes.length - keepRecent));

  let compacted = 0;

  for (const i of candidates) {
    if (total <= target) break;

    const message = thread[i];
    const length = String(message.content ?? '').length;

    if (length < 600) continue;

    const stub = `[Earlier ${message.name || 'tool'} result (${length} characters) removed to save space. Call the tool again if you still need it.]`;

    thread[i] = { ...message, content: stub };
    total -= length - stub.length;
    compacted++;
  }

  return compacted;
}

/*
  Across turns the chat resends the conversation. Without a cap it grew
  until the server answered 413 and the chat was stuck. Keep the newest
  messages that fit, starting at a user turn, and say that more came
  before so the model does not treat the cut as the beginning.
*/
export const HISTORY_MAX_CHARS = 40_000;
export const HISTORY_MAX_MESSAGES = 40;

export function fitHistory(history, {
  maxChars = HISTORY_MAX_CHARS,
  maxMessages = HISTORY_MAX_MESSAGES,
} = {}) {
  let chars = 0;
  let start = history.length;

  while (start > 0 && history.length - start < maxMessages) {
    const next = messageChars(history[start - 1]);
    // The newest message always goes in, however long.
    if (start < history.length && chars + next > maxChars) break;
    chars += next;
    start--;
  }

  while (start < history.length - 1 && history[start]?.role !== 'user') start++;

  if (start === 0) return history;

  return [
    { role: 'user', content: `[${start} earlier message${start === 1 ? '' : 's'} of this conversation omitted to save space.]` },
    { role: 'assistant', content: 'Understood.' },
    ...history.slice(start),
  ];
}
