// ============================================================
// YANTA AI — OpenRouter client
// Modes:
// - BYOK: direct browser request with user key
// - Included: YANTA Cloud AI proxy, server-side OpenRouter key
// ============================================================

import {
  getAiSettings,
  getAiApiKey,
} from './ai-settings.js';

import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

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

export async function openRouterChatCompletion({
  messages,
  tools = [],
  signal = null,
} = {}) {
  const settings = getAiSettings();

  if (settings.billingMode === 'included') {
    const body = {
      model: settings.model,
      messages,
      temperature: Number(settings.temperature ?? 0.2),
      tools: tools.length ? tools : undefined,
      max_tokens: 2048,
    };

    const res = await fetch(apiUrl('/api/ai/chat/completions'), {
      method: 'POST',
      signal,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = await parseErrorResponse(
        res,
        `YANTA Included AI request failed: HTTP ${res.status}`
      );

      throw new Error(msg);
    }

    const json = await res.json();
    const message = json?.choices?.[0]?.message;

    if (!message) {
      throw new Error('YANTA Included AI returned no assistant message.');
    }

    return message;
  }

  const apiKey = getAiApiKey();

  if (!apiKey) {
    throw new Error('OpenRouter API key missing. Open AI settings and paste your key.');
  }

  const baseUrl = String(settings.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');

  const body = {
    model: settings.model,
    messages,
    temperature: Number(settings.temperature ?? 0.2),
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? 'auto' : undefined,
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin,
      'X-Title': 'YANTA',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const msg = await parseErrorResponse(
      res,
      `OpenRouter request failed: HTTP ${res.status}`
    );

    throw new Error(msg);
  }

  const json = await res.json();
  const message = json?.choices?.[0]?.message;

  if (!message) {
    throw new Error('OpenRouter returned no assistant message.');
  }

  return message;
}