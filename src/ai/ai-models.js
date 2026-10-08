// ============================================================
// YANTA AI — Model catalog
//
// Dependency-free.
// Important: keep this file free of imports from ai-settings/access-policy
// to avoid circular initialization.
// ============================================================

/*
  Included models (checked 2026-10-07; see yanta-cloud-worker INCLUDED_AI_MODELS,
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
    hint: 'Best tool use in its class, reads images. Slower.',
    vision: true,
  },
  {
    id: 'z-ai/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    hint: 'Strong and very economical. Always thinks first, so replies take a few seconds.',
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