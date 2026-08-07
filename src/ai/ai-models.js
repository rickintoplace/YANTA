// ============================================================
// YANTA AI — Model catalog
//
// Dependency-free.
// Important: keep this file free of imports from ai-settings/access-policy
// to avoid circular initialization.
// ============================================================

export const INCLUDED_AI_MODELS = Object.freeze([
  {
    id: 'deepseek/deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash 0731',
    hint: 'Ultra-Efficient Workhorse',
  },
  {
    id: 'tencent/hy3-preview',
    label: 'Tencent Hunyuan Preview',
    hint: 'Deep-Thinking Agent & Coder. Good with tools',
  },
  {
    id: 'google/gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    hint: 'The ADHD Golden Retriever',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT OSS 20B',
    hint: 'Probably fails a lot',
  },
]);

export const DEFAULT_INCLUDED_AI_MODEL = 'deepseek/deepseek-v4-flash-0731';

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