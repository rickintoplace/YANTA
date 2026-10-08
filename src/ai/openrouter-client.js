// ============================================================
// YANTA AI — OpenRouter client
// Modes:
// - BYOK: direct browser request with user key
// - Included: YANTA Cloud AI proxy, server-side OpenRouter key
//
// Privacy:
// - OpenRouter ZDR is requested for all OpenRouter calls.
// - Included AI server also enforces ZDR and does not store prompts.
// ============================================================

import {
  getAiApiKey,
} from './ai-settings.js';

import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

import {
  getEffectiveAiRuntimeSettings,
  isIncludedAiMode,
} from './ai-access-policy.js';

import {
  reasoningFor,
  learnFromModelError,
  refreshModelCapabilities,
} from './model-capabilities.js';

import { recordAiUsage } from './ai-usage-stats.js';

function apiUrl(path) {
  const base = String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');

  return `${base}/${cleanPath}`;
}

async function parseErrorResponse(res, fallback) {
  let msg = fallback;

  try {
    const json = await res.json();
    msg = json?.error?.message || json?.message || json?.error || msg;
  } catch {
    try {
      msg = await res.text();
    } catch {}
  }

  return msg;
}

function openRouterProviderPreferences() {
  return {
    zdr: true,
    data_collection: 'deny',
  };
}

/*
  Thinking stays off unless the user picks an effort: unmanaged reasoning
  ate the output budget before a tool call was written. When on, the tool
  loops echo reasoning_details back each round (see agent-runtime.js).
  Models that cannot switch it off get their cheapest effort — what each
  model allows comes from model-capabilities.js, not from this file.
*/
function reasoningParam(settings, model = '') {
  return reasoningFor(model, settings.reasoningEffort || 'off');
}

function requestModel(settings) {
  return isIncludedAiMode(settings) ? (settings.includedModel || settings.model) : settings.model;
}

/** Keeps model metadata fresh in the background; see model-capabilities.js. */
export function refreshModelCapabilitiesForSettings(settings = getEffectiveAiRuntimeSettings(), { force = false } = {}) {
  if (isIncludedAiMode(settings)) {
    return refreshModelCapabilities({ source: 'included', url: apiUrl('/api/ai/models'), credentials: 'include', force });
  }

  const baseUrl = String(settings.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  if (!/^https:\/\/openrouter\.ai\//.test(baseUrl)) return Promise.resolve(false);

  return refreshModelCapabilities({ source: 'openrouter', url: `${baseUrl}/models`, force });
}

/*
  Transient failures (network, 429, 5xx) are retried twice with backoff
  before the user sees an error; a 400 the model metadata can explain
  (e.g. "reasoning is mandatory") is learned and retried once with the
  corrected request. Nothing is retried once a response has started:
  a half-streamed answer is not repeatable.
*/
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
const MAX_TRANSIENT_RETRIES = 2;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function retryDelayMs(attempt, res) {
  const header = Number(res?.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header >= 0) return header * 1000;
  return 700 * 2 ** attempt + Math.floor(Math.random() * 400);
}

async function sendAiRequest({ settings, signal, buildBody, label }) {
  const model = requestModel(settings);
  let learnedRetry = false;

  for (let attempt = 0; ; attempt++) {
    let res;

    try {
      res = await fetch(endpointForSettings(settings), {
        method: 'POST',
        signal,
        credentials: isIncludedAiMode(settings) ? 'include' : 'omit',
        headers: headersForSettings(settings),
        body: JSON.stringify(buildBody()),
      });
    } catch (err) {
      if (err?.name === 'AbortError' || attempt >= MAX_TRANSIENT_RETRIES) throw err;
      await sleep(retryDelayMs(attempt), signal);
      continue;
    }

    if (res.ok) return res;

    const msg = await parseErrorResponse(res, `${label} failed: HTTP ${res.status}`);

    // The server's own "come back tomorrow" or a long rate-limit window is
    // an answer, not a hiccup.
    const delay = retryDelayMs(attempt, res);
    const transient = RETRY_STATUSES.has(res.status) && !/capacity|credits/i.test(msg) && delay <= 10_000;

    if (transient && attempt < MAX_TRANSIENT_RETRIES) {
      await sleep(delay, signal);
      continue;
    }

    if (res.status === 400 && !learnedRetry && learnFromModelError(model, msg)) {
      learnedRetry = true;
      continue;
    }

    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
}

function buildRequestBody({ messages, tools = [], stream = false, source = '' } = {}) {
  const settings = getEffectiveAiRuntimeSettings();

  if (isIncludedAiMode(settings)) {
    return {
      model: settings.includedModel || settings.model,
      messages,
      temperature: Number(settings.temperature ?? 0.2),
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      max_tokens: Number(settings.maxOutputTokens || 4096),
      reasoning: reasoningParam(settings, settings.includedModel || settings.model),
      provider: openRouterProviderPreferences(),
      stream,

      // Draws from the Pulse sub-budget instead of the interactive one.
      // Server-side concern only; BYOK never sends it.
      source: source || undefined,
    };
  }

  return {
    model: settings.model,
    messages,
    temperature: Number(settings.temperature ?? 0.2),
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? 'auto' : undefined,
    reasoning: reasoningParam(settings, settings.model),
    provider: openRouterProviderPreferences(),
    stream,
  };
}

function endpointForSettings(settings = getEffectiveAiRuntimeSettings()) {
  if (isIncludedAiMode(settings)) {
    return apiUrl('/api/ai/chat/completions');
  }

  const baseUrl = String(settings.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  return `${baseUrl}/chat/completions`;
}

function headersForSettings(settings = getEffectiveAiRuntimeSettings()) {
  if (isIncludedAiMode(settings)) {
    return {
      'Content-Type': 'application/json',
    };
  }

  const apiKey = getAiApiKey();

  if (!apiKey) {
    throw new Error('OpenRouter API key missing. Open AI settings and paste your key.');
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': location.origin,
    'X-Title': 'YANTA',
  };
}

export async function openRouterChatCompletion({
  messages,
  tools = [],
  signal = null,
  source = '',
} = {}) {
  const settings = getEffectiveAiRuntimeSettings();
  refreshModelCapabilitiesForSettings(settings);

  const res = await sendAiRequest({
    settings,
    signal,
    label: `${isIncludedAiMode(settings) ? 'YANTA Included AI' : 'OpenRouter'} request`,
    buildBody: () => buildRequestBody({ messages, tools, stream: false, source }),
  });

  const json = await res.json();
  recordAiUsage(json?.model || requestModel(settings), json?.usage, { source });
  const message = json?.choices?.[0]?.message;

  if (!message) {
    throw new Error(json?.error?.message || 'AI provider returned no assistant message.');
  }

  return {
    ...message,
    finish_reason: json.choices[0].finish_reason || '',
  };
}

/*
  Streamed reasoning_details arrive in pieces, keyed by index. Rebuild each
  entry as one object (text concatenated, last signature kept) so it can be
  sent back unchanged in the next tool round.
*/
function mergeReasoningDetails(target, deltas = []) {
  for (const delta of deltas) {
    if (!delta || typeof delta !== 'object') continue;

    const idx = Number.isInteger(delta.index) ? delta.index : target.length;
    const entry = target[idx] || (target[idx] = {});

    for (const [key, value] of Object.entries(delta)) {
      if ((key === 'text' || key === 'summary' || key === 'data') && typeof value === 'string') {
        entry[key] = (entry[key] || '') + value;
      } else if (value != null) {
        entry[key] = value;
      }
    }
  }
}

function mergeToolCallDelta(target, delta = {}) {
  const idx = Number(delta.index || 0);

  if (!target[idx]) {
    target[idx] = {
      id: delta.id || '',
      type: delta.type || 'function',
      function: {
        name: '',
        arguments: '',
      },
    };
  }

  const call = target[idx];

  if (delta.id) call.id = delta.id;
  if (delta.type) call.type = delta.type;

  if (delta.function?.name) {
    call.function.name += delta.function.name;
  }

  if (delta.function?.arguments) {
    call.function.arguments += delta.function.arguments;
  }
}

function normalizeReasoningDelta(delta = {}) {
  /*
    Providers/OpenRouter can expose reasoning under multiple fields.
    Some models send the same delta duplicated across aliases.
    Prefer the first explicit string field instead of concatenating aliases.
  */
  const direct = [
    delta.reasoning,
    delta.reasoning_content,
    delta.thinking,
    delta.thinking_content,
  ].find((x) => typeof x === 'string' && x);

  if (direct) return direct;

  if (Array.isArray(delta.reasoning_details)) {
    const first = delta.reasoning_details.find((detail) =>
      typeof detail?.text === 'string' ||
      typeof detail?.content === 'string' ||
      typeof detail?.summary === 'string'
    );

    return (
      first?.text ||
      first?.content ||
      first?.summary ||
      ''
    );
  }

  return '';
}

async function readSseStream(res, {
  signal = null,
  onEvent,
} = {}) {
  if (!res.body) {
    throw new Error('Streaming response has no body.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';

  while (true) {
    if (signal?.aborted) {
      try {
        await reader.cancel();
      } catch {}

      throw new DOMException('Aborted', 'AbortError');
    }

    const { value, done } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, {
      stream: true,
    });

    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const lines = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());

      for (const line of lines) {
        if (!line) continue;
        if (line === '[DONE]') {
          onEvent?.({
            done: true,
          });

          continue;
        }

        let json = null;

        try {
          json = JSON.parse(line);
        } catch {
          continue;
        }

        onEvent?.({
          json,
        });
      }
    }
  }
}

/**
 * Streams assistant content/reasoning/tool-call deltas.
 *
 * onDelta receives:
 * - { type: 'content', text }
 * - { type: 'reasoning', text }
 *
 * Returns final assistant message shape compatible with OpenAI/OpenRouter:
 * { role:'assistant', content, reasoning, tool_calls }
 */
export async function openRouterChatCompletionStream({
  messages,
  tools = [],
  signal = null,
  onDelta = null,
} = {}) {
  const settings = getEffectiveAiRuntimeSettings();
  refreshModelCapabilitiesForSettings(settings);

  const res = await sendAiRequest({
    settings,
    signal,
    label: `${isIncludedAiMode(settings) ? 'YANTA Included AI' : 'OpenRouter'} streaming request`,
    buildBody: () => buildRequestBody({ messages, tools, stream: true }),
  });

  let usage = null;
  let servedModel = '';
  const contentParts = [];
  const reasoningParts = [];
  const reasoningDetails = [];
  const toolCalls = [];
  let finishReason = '';

  await readSseStream(res, {
    signal,
    onEvent: ({ json }) => {
      if (!json) return;

      // A provider failure after the stream started arrives as an event.
      if (json.error) {
        throw new Error(json.error.message || 'The AI provider failed mid-response.');
      }

      if (json.usage) usage = json.usage;
      if (json.model) servedModel = json.model;

      const choice = json.choices?.[0];
      const delta = choice?.delta || {};

      if (choice?.finish_reason) finishReason = choice.finish_reason;

      if (Array.isArray(delta.reasoning_details)) {
        mergeReasoningDetails(reasoningDetails, delta.reasoning_details);
      }

      const content = typeof delta.content === 'string'
        ? delta.content
        : '';

      if (content) {
        contentParts.push(content);
        onDelta?.({
          type: 'content',
          text: content,
        });
      }

      const reasoning = normalizeReasoningDelta(delta);

      if (reasoning) {
        reasoningParts.push(reasoning);
        onDelta?.({
          type: 'reasoning',
          text: reasoning,
        });
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          mergeToolCallDelta(toolCalls, tc);
        }
      }
    },
  });

  recordAiUsage(servedModel || requestModel(settings), usage);

  return {
    role: 'assistant',
    content: contentParts.join(''),
    reasoning: reasoningParts.join(''),
    reasoning_details: reasoningDetails.filter(Boolean),
    tool_calls: toolCalls.filter((call) => call?.function?.name),
    finish_reason: finishReason,
  };
}

/*
  Decision models (OpenRouter Decisions API): typed answers with
  probabilities instead of text. Questions are { key: { type, instructions,
  criteria? } } with type noul (P(yes)), choice or score. Only OpenRouter
  serves this, so a BYOK setup pointed elsewhere has no decider.
*/
export const DECISION_MODEL = 'perplexity/pplx-decider-v1.1-27b';

function decisionEndpoint(settings) {
  if (isIncludedAiMode(settings)) return apiUrl('/api/ai/decide');

  const baseUrl = String(settings.baseUrl || 'https://openrouter.ai/api/v1');
  if (!/^https:\/\/openrouter\.ai\//.test(baseUrl)) return '';

  return 'https://openrouter.ai/api/alpha/decisions';
}

export function decisionsAvailable(settings = getEffectiveAiRuntimeSettings()) {
  return !!decisionEndpoint(settings);
}

/** Returns { answers, model, cost }. Throws when unavailable or on failure. */
export async function openRouterDecide({ state, questions, signal = null } = {}) {
  const settings = getEffectiveAiRuntimeSettings();
  const endpoint = decisionEndpoint(settings);

  if (!endpoint) {
    throw new Error('Decision models need OpenRouter or YANTA Included AI.');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    credentials: isIncludedAiMode(settings) ? 'include' : 'omit',
    headers: headersForSettings(settings),
    body: JSON.stringify({
      model: DECISION_MODEL,
      state,
      questions,
      provider: openRouterProviderPreferences(),
    }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res, `Decision request failed: HTTP ${res.status}`));
  }

  const json = await res.json();

  if (!json?.answers) throw new Error('Decision model returned no answers.');

  return {
    answers: json.answers,
    model: json.model || DECISION_MODEL,
    cost: Number(json.usage?.cost || 0),
  };
}
