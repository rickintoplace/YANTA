// ============================================================
// YANTA Pulse — plan entitlement
//
// How many routines may run unattended, and where the ceiling comes
// from. Three cases, and only one of them costs the operator anything:
//
//   BYOK     — the user pays their own provider bill. Unlimited.
//   Included — YANTA Cloud pays. The server's pulseRoutines applies.
//   Offline  — fall back to the free ceiling rather than blocking a
//              user whose network happens to be down.
//
// The engine treats the returned allowance as authoritative, so editing
// `enabled: true` into a routine note by hand cannot get past it. The
// settings UI reads the same numbers, so what the user is told and what
// actually happens can never drift apart.
// ============================================================

import { cloudMe } from '../cloud/cloud-api.js';

import {
  isIncludedAiMode,
} from '../ai/ai-access-policy.js';

/** Matches the Worker's free-plan value; used when it cannot be asked. */
const FREE_ROUTINE_ALLOWANCE = 2;

const CACHE_MS = 5 * 60 * 1000;

let cache = null;
let cachedAt = 0;

export const PULSE_ALLOWANCE_SOURCE = Object.freeze({
  BYOK: 'byok',
  PLAN: 'plan',
  FALLBACK: 'fallback',
});

/**
 * @returns {Promise<{routines: number, source: string, plan: string,
 *                    unlimited: boolean, pulseRequestsDay: number|null}>}
 */
export async function getPulseAllowance({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < CACHE_MS) return cache;

  // BYOK runs never touch YANTA Cloud, so there is nothing to meter and
  // no honest reason to cap it.
  if (!isIncludedAiMode()) {
    cache = {
      routines: Infinity,
      unlimited: true,
      source: PULSE_ALLOWANCE_SOURCE.BYOK,
      plan: 'byok',
      pulseRequestsDay: null,
    };
    cachedAt = Date.now();
    return cache;
  }

  let me = null;

  try {
    me = await cloudMe();
  } catch {
    me = null;
  }

  const limits = me?.authenticated ? me.limits || {} : null;

  cache = limits
    ? {
        routines: Number(limits.pulseRoutines ?? FREE_ROUTINE_ALLOWANCE),
        unlimited: false,
        source: PULSE_ALLOWANCE_SOURCE.PLAN,
        plan: me.user?.plan || 'free',
        pulseRequestsDay: Number(limits.aiPulseRequestsDay ?? 0) || null,
      }
    : {
        routines: FREE_ROUTINE_ALLOWANCE,
        unlimited: false,
        source: PULSE_ALLOWANCE_SOURCE.FALLBACK,
        plan: 'free',
        pulseRequestsDay: null,
      };

  cachedAt = Date.now();

  return cache;
}

export function invalidatePulseAllowance() {
  cache = null;
  cachedAt = 0;
}

/*
  Upgrading, or switching between Included AI and BYOK, changes the
  allowance immediately. Without this the settings panel would keep
  showing the old ceiling until the cache expired — the one moment a
  user is most likely to be watching it.
*/
window.addEventListener('yanta:billing-updated', invalidatePulseAllowance);
window.addEventListener('yanta-ai-settings-changed', invalidatePulseAllowance);

/**
 * Splits enabled routines into the ones within allowance and the ones
 * over it.
 *
 * Oldest wins. Creation order is the one ordering a user can predict
 * and never loses to a rename — and it means hitting the cap pauses the
 * routine you just added, not the one you have relied on for months.
 */
export function partitionByAllowance(routines, allowance) {
  const enabled = routines
    .filter((routine) => routine.enabled && !routine.invalid.length)
    .sort((a, b) => (a.created || 0) - (b.created || 0) || a.name.localeCompare(b.name));

  if (allowance.unlimited) return { active: enabled, overCap: [] };

  const max = Math.max(0, allowance.routines);

  return {
    active: enabled.slice(0, max),
    overCap: enabled.slice(max),
  };
}

/** True when enabling one more routine would exceed the allowance. */
export async function wouldExceedAllowance(routines) {
  const allowance = await getPulseAllowance();

  if (allowance.unlimited) return false;

  const enabled = routines.filter((r) => r.enabled && !r.invalid.length).length;

  return enabled >= allowance.routines;
}
