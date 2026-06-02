// ============================================================
// YANTA AI — OpenRouter client, OpenAI-compatible chat + tools
// ============================================================

import {
  getAiSettings,
  getAiApiKey,
} from './ai-settings.js';

export async function openRouterChatCompletion({
  messages,
  tools = [],
  signal = null,
} = {}) {
  const settings = getAiSettings();
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
    let msg = `OpenRouter request failed: HTTP ${res.status}`;

    try {
      const json = await res.json();
      msg = json?.error?.message || json?.message || msg;
    } catch {
      try {
        msg = await res.text();
      } catch {}
    }

    throw new Error(msg);
  }

  const json = await res.json();
  const message = json?.choices?.[0]?.message;

  if (!message) {
    throw new Error('OpenRouter returned no assistant message.');
  }

  return message;
}