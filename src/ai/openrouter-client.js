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
  };
}

function buildRequestBody({ messages, tools = [], stream = false } = {}) {
  const settings = getEffectiveAiRuntimeSettings();

  if (isIncludedAiMode(settings)) {
    return {
      model: settings.includedModel || settings.model,
      messages,
      temperature: Number(settings.temperature ?? 0.2),
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      max_tokens: Number(settings.maxOutputTokens || 768),
      provider: openRouterProviderPreferences(),
      stream,
    };
  }

  return {
    model: settings.model,
    messages,
    temperature: Number(settings.temperature ?? 0.2),
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? 'auto' : undefined,
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
} = {}) {
  const settings = getEffectiveAiRuntimeSettings();

  const res = await fetch(endpointForSettings(settings), {
    method: 'POST',
    signal,
    credentials: isIncludedAiMode(settings) ? 'include' : 'omit',
    headers: headersForSettings(settings),
    body: JSON.stringify(buildRequestBody({
      messages,
      tools,
      stream: false,
    })),
  });

  if (!res.ok) {
    const msg = await parseErrorResponse(
      res,
      `${isIncludedAiMode(settings) ? 'YANTA Included AI' : 'OpenRouter'} request failed: HTTP ${res.status}`
    );

    throw new Error(msg);
  }

  const json = await res.json();
  const message = json?.choices?.[0]?.message;

  if (!message) {
    throw new Error('AI provider returned no assistant message.');
  }

  return message;
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
  const parts = [
    delta.reasoning,
    delta.reasoning_content,
    delta.thinking,
    delta.thinking_content,
  ].filter((x) => typeof x === 'string' && x);

  if (Array.isArray(delta.reasoning_details)) {
    for (const detail of delta.reasoning_details) {
      if (typeof detail?.text === 'string') parts.push(detail.text);
      if (typeof detail?.content === 'string') parts.push(detail.content);
      if (typeof detail?.summary === 'string') parts.push(detail.summary);
    }
  }

  return parts.join('');
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

  const res = await fetch(endpointForSettings(settings), {
    method: 'POST',
    signal,
    credentials: isIncludedAiMode(settings) ? 'include' : 'omit',
    headers: headersForSettings(settings),
    body: JSON.stringify(buildRequestBody({
      messages,
      tools,
      stream: true,
    })),
  });

  if (!res.ok) {
    const msg = await parseErrorResponse(
      res,
      `${isIncludedAiMode(settings) ? 'YANTA Included AI' : 'OpenRouter'} streaming request failed: HTTP ${res.status}`
    );

    throw new Error(msg);
  }

  const contentParts = [];
  const reasoningParts = [];
  const toolCalls = [];

  await readSseStream(res, {
    signal,
    onEvent: ({ json }) => {
      if (!json) return;

      const choice = json.choices?.[0];
      const delta = choice?.delta || {};

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

  return {
    role: 'assistant',
    content: contentParts.join(''),
    reasoning: reasoningParts.join(''),
    tool_calls: toolCalls.filter((call) => call?.function?.name),
  };
}