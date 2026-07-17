// ============================================================
// YANTA Semantic — configuration + model registry
//
// Device-local on purpose (localStorage, not synced settings):
// the model download and the vector index live per device, so a
// phone can stay lean while the desktop runs semantic search.
// Vectors are content approximations — they must never sync.
// ============================================================

const CONFIG_KEY = 'yanta.semantic.v1';

/*
  Model registry. Adding a model here is all future language/quality
  options need: every stored vector carries the model id, a switch
  triggers a clean re-index instead of silently mixing spaces.

  Warum Präfixe pro Modell: E5-Modelle brauchen "query:"/"passage:"
  beim Embedden — ohne sie bricht die Retrieval-Qualität messbar ein.
*/
export const SEMANTIC_MODELS = [
  {
    id: 'multilingual-e5-small-q8',
    hf: 'Xenova/multilingual-e5-small',
    label: 'Multilingual · compact',
    languages: 'English, German, Spanish, Chinese + ~90 more',
    dims: 384,
    dtype: 'q8',
    prefixes: { query: 'query: ', passage: 'passage: ' },
    sizeHint: '~120 MB',
  },
];

export const DEFAULT_SEMANTIC_MODEL_ID = SEMANTIC_MODELS[0].id;

export function semanticModelById(id) {
  return SEMANTIC_MODELS.find((m) => m.id === id) || SEMANTIC_MODELS[0];
}

export function getSemanticConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');

    return {
      enabled: raw.enabled === true,
      modelId: typeof raw.modelId === 'string' ? raw.modelId : DEFAULT_SEMANTIC_MODEL_ID,
    };
  } catch {
    return {
      enabled: false,
      modelId: DEFAULT_SEMANTIC_MODEL_ID,
    };
  }
}

export function saveSemanticConfig(patch = {}) {
  const next = {
    ...getSemanticConfig(),
    ...patch,
  };

  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  } catch {}

  return next;
}
