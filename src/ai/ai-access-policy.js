// ============================================================
// YANTA AI — Access Policy
//
// Client-side UX policy only.
// Server remains authoritative for Included AI limits/model allowlist.
// ============================================================

import {
  store,
} from '../core.js';

import {
  getAiSettings,
} from './ai-settings.js';

import {
  cloudMe,
} from '../cloud/cloud-api.js';

export const AI_BILLING_MODES = Object.freeze({
  BYOK: 'byok',
  INCLUDED: 'included',
});

import {
  INCLUDED_AI_MODELS,
  DEFAULT_INCLUDED_AI_MODEL,
  normalizeIncludedAiModel,
  includedAiModelLabel,
} from './ai-models.js';

export {
  INCLUDED_AI_MODELS,
  DEFAULT_INCLUDED_AI_MODEL,
  normalizeIncludedAiModel,
  includedAiModelLabel,
};

export const INCLUDED_AI_CLIENT_POLICY = Object.freeze({
  modelLabel: 'YANTA Cloud credits',

  // Client-side UX/safety clamp.
  // Server enforces authoritative limits.
  maxContextChars: 10000,
  maxToolRounds: 3,
  maxOutputTokens: 768,
});

export const OPENROUTER_ZDR_POLICY = Object.freeze({
  enabled: true,
  label: 'OpenRouter ZDR',
  description:
    'YANTA requests Zero Data Retention routing from OpenRouter. Prompts are routed only to endpoints with a Zero Data Retention policy.',
});

export function isIncludedAiMode(settings = getAiSettings()) {
  return settings.billingMode === AI_BILLING_MODES.INCLUDED;
}

export function getEffectiveAiRuntimeSettings(settings = getAiSettings()) {
  if (!isIncludedAiMode(settings)) {
    // BYOK: user owns key/cost/model/limits.
    return settings;
  }

  const includedModel = normalizeIncludedAiModel(
    settings.includedModel || settings.model
  );

  return {
    ...settings,

    // Included AI is managed by YANTA Cloud, but user may choose from
    // the server allowlist. Server validates this again.
    model: includedModel,
    includedModel,
    baseUrl: '',

    maxContextChars: Math.min(
      Number(settings.maxContextChars || INCLUDED_AI_CLIENT_POLICY.maxContextChars),
      INCLUDED_AI_CLIENT_POLICY.maxContextChars
    ),

    maxToolRounds: Math.min(
      Number(settings.maxToolRounds || INCLUDED_AI_CLIENT_POLICY.maxToolRounds),
      INCLUDED_AI_CLIENT_POLICY.maxToolRounds
    ),

    maxOutputTokens: Math.min(
      Number(settings.maxOutputTokens || INCLUDED_AI_CLIENT_POLICY.maxOutputTokens),
      INCLUDED_AI_CLIENT_POLICY.maxOutputTokens
    ),
  };
}

export async function hasConfiguredYantaCloudSync() {
  const provider = await store.settings.get('sync2.provider', '').catch(() => '');
  const vaultId = await store.settings.get('sync2.yantaCloud.vaultId', '').catch(() => '');

  return provider === 'yanta-cloud' && !!vaultId;
}

export async function canUseIncludedAi() {
  if (!(await hasConfiguredYantaCloudSync())) {
    return {
      ok: false,
      reason: 'YANTA Cloud Sync is not active on this device.',
    };
  }

  try {
    const me = await cloudMe();

    if (!me?.authenticated) {
      return {
        ok: false,
        reason: 'Sign in to YANTA Cloud first.',
      };
    }

    if (me?.limits?.includedAi === false) {
      return {
        ok: false,
        reason: 'Included AI is not available on your current plan.',
      };
    }

    return {
      ok: true,
      me,
    };
  } catch {
    return {
      ok: false,
      reason: 'Could not verify YANTA Cloud status.',
    };
  }
}