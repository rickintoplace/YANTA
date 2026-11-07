// ============================================================
// YANTA AI — Model catalog
//
// Dependency-free.
// Important: keep this file free of imports from ai-settings/access-policy
// to avoid circular initialization.
// ============================================================

/*
  Included models (checked 2026-11-07; see yanta-cloud-worker INCLUDED_AI_MODELS,
  which holds the prices and must list the same ids). All open-weight except
  Gemini, all served with zero data retention.
*/
export const INCLUDED_AI_MODELS = Object.freeze([
  {
    id: 'deepseek/deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
    hint: 'Fast and reliable with tools. Recommended.',
    vision: true,
  },
  {
    id: 'xiaomi/mimo-v2.6-flash',
    label: 'Xiaomi MiMo V2.6 Flash',
    hint: 'Cheapest, reads images. Less exact when editing notes.',
    vision: true,
  },
  {
    id: 'z-ai/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    hint: 'Strong and the most economical. Thinks briefly before it answers.',
    vision: true,
    // OpenRouter rejects reasoning off for it; "off" is sent as minimal.
    reasoningRequired: true,
  },
  {
    id: 'xiaomi/mimo-v2.6-pro',
    label: 'Xiaomi MiMo V2.6 Pro',
    hint: 'Strongest open model. Uses about 3× the credits.',
    vision: true,
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    hint: 'Best for PDFs and images.',
    vision: true,
  },
]);

export const DEFAULT_INCLUDED_AI_MODEL = 'deepseek/deepseek-v4.1-flash';

/*
  The worker serves the current menu (/api/ai/models), cached by
  model-capabilities.js under this key. Read straight from storage so
  this file keeps no imports: a model added or retired on the server
  shows up here without an app release. The list above is the fallback
  for a first start or an offline device.
*/
const MODEL_CAPS_CACHE_KEY = 'yanta.ai.modelCaps.v1';

function serverMenu() {
  try {
    const menu = JSON.parse(localStorage.getItem(MODEL_CAPS_CACHE_KEY) || 'null')?.menu;
    return Array.isArray(menu?.models) && menu.models.length ? menu : null;
  } catch {
    return null;
  }
}

/** The included models offered right now. */
export function includedAiModels() {
  const menu = serverMenu();
  if (!menu) return INCLUDED_AI_MODELS;

  return menu.models.map((m) => ({
    ...(INCLUDED_AI_MODELS.find((known) => known.id === m.id) || {}),
    ...m,
  }));
}

function defaultIncludedModel() {
  const menu = serverMenu();
  return menu?.default && menu.models.some((m) => m.id === menu.default)
    ? menu.default
    : DEFAULT_INCLUDED_AI_MODEL;
}

/*
  Decider checkpoints get retired without notice; the worker names the
  one that still has a host. BYOK requests go straight to OpenRouter and
  use the same answer.
*/
export const DEFAULT_DECISION_MODEL = 'perplexity/pplx-decider-v1.2';

// The quick one, for a person waiting (share sheet): as exact on text →
// event, half the latency (scripts/text-event-eval.mjs, 2026-11-07).
export const FAST_DECISION_MODEL = 'perplexity/pplx-decider-flash-v1.2';

const DECISION_ID = /^(perplexity\/pplx-decider|liquid\/d1)/;

export function decisionModel({ fast = false } = {}) {
  const id = serverMenu()?.decisionModel;
  const fallback = typeof id === 'string' && DECISION_ID.test(id) ? id : DEFAULT_DECISION_MODEL;
  // The worker swaps in a hosted one when the fast checkpoint has none.
  return fast ? FAST_DECISION_MODEL : fallback;
}

export function includedAiModelInfo(model) {
  return includedAiModels().find((m) => m.id === String(model || '').trim()) || null;
}

export function normalizeIncludedAiModel(model) {
  const clean = String(model || '').trim();

  if (includedAiModels().some((m) => m.id === clean)) {
    return clean;
  }

  return defaultIncludedModel();
}

export function includedAiModelLabel(model) {
  const clean = normalizeIncludedAiModel(model);

  return includedAiModels().find((m) => m.id === clean)?.label || clean;
}