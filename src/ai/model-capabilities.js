// ============================================================
// YANTA AI — model capabilities
//
// What a model can do and what it insists on: context size, image
// input, whether thinking can be switched off and which efforts it
// accepts, and when it shuts down. Read from live metadata instead of
// hard-coded per model, so a new model — included or BYOK — works the
// day it ships, and a model that changes its rules does not break the
// assistant until the next release:
//
//   - Included AI: the worker's /api/ai/models (its catalog, enriched
//     with OpenRouter's metadata by a cron).
//   - BYOK on OpenRouter: OpenRouter's public model list, reduced to
//     the fields below.
//   - Otherwise, or offline: the built-in catalog in ai-models.js.
//
// On top of that, provider errors teach it (`learnFromModelError`): an
// HTTP 400 "reasoning is mandatory" flips that model's rule, and the
// request is retried once.
//
// Dependency-free apart from ai-models.js; the caller passes how to
// fetch, which keeps this module out of the settings import cycle.
// ============================================================

import { includedAiModelInfo } from './ai-models.js';

const CACHE_KEY = 'yanta.ai.modelCaps.v1';
const TTL_MS = 24 * 60 * 60 * 1000;

let cache = loadCache();
let refreshing = null;

function loadCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (parsed && typeof parsed === 'object' && parsed.models) return parsed;
  } catch {}

  return { at: 0, source: '', models: {}, learned: {}, menu: null };
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function reduceOpenRouterModel(m) {
  const perM = (v) => (Number.isFinite(Number(v)) ? Number(v) * 1e6 : null);

  return {
    contextTokens: Number(m.context_length || m.top_provider?.context_length || 0) || null,
    maxOutputTokens: Number(m.top_provider?.max_completion_tokens || 0) || null,
    vision: Array.isArray(m.architecture?.input_modalities)
      ? m.architecture.input_modalities.includes('image')
      : null,
    tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : null,
    reasoning: {
      mandatory: m.reasoning?.mandatory === true,
      efforts: Array.isArray(m.reasoning?.supported_efforts) ? m.reasoning.supported_efforts : [],
    },
    price: {
      prompt: perM(m.pricing?.prompt),
      completion: perM(m.pricing?.completion),
      cacheRead: perM(m.pricing?.input_cache_read),
    },
    expiresAt: m.expiration_date || null,
  };
}

function reduceWorkerModel(m) {
  return {
    contextTokens: m.contextTokens || null,
    maxOutputTokens: m.maxOutputTokens || null,
    vision: typeof m.vision === 'boolean' ? m.vision : null,
    tools: true,
    reasoning: {
      mandatory: m.reasoning?.mandatory === true,
      efforts: Array.isArray(m.reasoning?.efforts) ? m.reasoning.efforts : [],
    },
    price: null,
    expiresAt: m.expiresAt || null,
  };
}

/**
 * Refreshes the cache when it is older than a day (or `force`).
 * `source` is 'included' or 'openrouter'; `url` and `credentials` are
 * how to fetch it. Never throws: stale data beats no assistant.
 */
export function refreshModelCapabilities({ source, url, credentials = 'omit', force = false } = {}) {
  if (!url) return Promise.resolve(false);
  if (!force && cache.source === source && Date.now() - cache.at < TTL_MS) return Promise.resolve(false);
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const res = await fetch(url, { credentials });
      if (!res.ok) return false;

      const json = await res.json();
      const models = {};
      let menu = null;

      if (source === 'included') {
        for (const m of json?.models || []) {
          if (m?.id) models[m.id] = reduceWorkerModel(m);
        }

        menu = {
          default: json?.default || '',
          models: (json?.models || []).map((m) => ({
            id: m.id,
            label: m.label || m.id,
            hint: m.hint || '',
            vision: m.vision !== false,
          })),
        };
      } else {
        for (const m of json?.data || []) {
          // Only models that can call tools are any use to the assistant.
          if (m?.id && Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools')) {
            models[m.id] = reduceOpenRouterModel(m);
          }
        }
      }

      if (!Object.keys(models).length) return false;

      cache = { ...cache, at: Date.now(), source, models, menu: menu || cache.menu };
      saveCache();

      window.dispatchEvent(new CustomEvent('yanta-ai-models-updated'));

      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/**
 * Everything known about a model. Fields are null when unknown; callers
 * treat null as "assume the common case".
 */
export function modelCapabilities(model) {
  const id = String(model || '').trim();
  const live = cache.models[id] || null;
  const builtin = includedAiModelInfo(id);
  const learned = cache.learned[id] || {};

  return {
    id,
    known: !!(live || builtin),
    contextTokens: live?.contextTokens || null,
    maxOutputTokens: live?.maxOutputTokens || null,
    vision: live?.vision ?? (builtin ? builtin.vision === true : null),
    tools: learned.tools ?? live?.tools ?? null,
    reasoning: {
      mandatory: learned.reasoningMandatory ?? live?.reasoning?.mandatory ?? builtin?.reasoningRequired === true,
      efforts: live?.reasoning?.efforts || [],
    },
    price: live?.price || null,
    expiresAt: live?.expiresAt || null,
  };
}

/** The included-model menu from the worker, when it has been fetched. */
export function includedModelMenu() {
  return cache.menu?.models?.length ? cache.menu : null;
}

const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'max'];

/**
 * The `reasoning` request field for a model and the user's choice
 * ('off' | 'low' | 'medium' | …). A model that cannot think "off" gets
 * its cheapest effort; an effort it does not offer becomes the nearest
 * one it does.
 */
export function reasoningFor(model, requested = 'off') {
  const caps = modelCapabilities(model);
  const want = String(requested || 'off').toLowerCase();
  const offered = caps.reasoning.efforts.map((e) => String(e).toLowerCase());

  if (!EFFORT_ORDER.includes(want)) {
    if (!caps.reasoning.mandatory) return { enabled: false };
    return { effort: EFFORT_ORDER.find((e) => offered.includes(e)) || 'minimal' };
  }

  if (!offered.length || offered.includes(want)) return { effort: want };

  // Nearest offered effort, ties toward the cheaper one.
  const wantAt = EFFORT_ORDER.indexOf(want);
  const nearest = offered
    .filter((e) => EFFORT_ORDER.includes(e))
    .sort((a, b) =>
      Math.abs(EFFORT_ORDER.indexOf(a) - wantAt) - Math.abs(EFFORT_ORDER.indexOf(b) - wantAt) ||
      EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b)
    )[0];

  return { effort: nearest || want };
}

/**
 * Learns from a provider error. Returns true when the request is worth
 * retrying with what was learned.
 */
export function learnFromModelError(model, message) {
  const id = String(model || '').trim();
  const text = String(message || '');

  if (!id) return false;

  const learned = { ...(cache.learned[id] || {}) };
  let changed = false;

  if (/reasoning (is )?mandatory|reasoning.*cannot be disabled|requires? reasoning/i.test(text) && learned.reasoningMandatory !== true) {
    learned.reasoningMandatory = true;
    changed = true;
  }

  if (/(does not|doesn't) support (tool|function)|tool use is not supported|no endpoints found that support tool/i.test(text) && learned.tools !== false) {
    learned.tools = false;
    changed = true;
  }

  if (!changed) return false;

  cache.learned = { ...cache.learned, [id]: learned };
  saveCache();

  return true;
}

/** Characters of prompt a model can take, with room for the answer. */
export function promptBudgetChars(model, { fallback = 120_000, cap = 400_000 } = {}) {
  const tokens = modelCapabilities(model).contextTokens;
  if (!tokens) return fallback;

  // ~3.5 characters per token across the languages YANTA supports;
  // half the window, because the answer and tool results need the rest.
  return Math.max(16_000, Math.min(cap, Math.floor(tokens * 3.5 * 0.5)));
}
