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

export function includedAiModelInfo(model) {
  return INCLUDED_AI_MODELS.find((m) => m.id === String(model || '').trim()) || null;
}

export function normalizeIncludedAiModel(model) {
  const clean = String(model || '').trim();

  if (INCLUDED_AI_MODELS.some((m) => m.id === clean)) {
    return clean;
  }

  return DEFAULT_INCLUDED_AI_MODEL;
}

export function includedAiModelLabel(model) {
  const clean = normalizeIncludedAiModel(model);

  return INCLUDED_AI_MODELS.find((m) => m.id === clean)?.label || clean;
}