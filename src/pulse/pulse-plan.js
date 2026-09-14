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

import { store } from '../core.js';
import { cloudMe } from '../cloud/cloud-api.js';

import {
  isIncludedAiMode,
} from '../ai/ai-access-policy.js';

/** Matches the Worker's free-plan value; used when it cannot be asked. */
const FREE_ROUTINE_ALLOWANCE = 2;

/*
  The last allowance the SERVER actually confirmed, kept across reloads.

  Why this exists: a paying user whose cloud session had expired was told
  "4 routines are paused by your plan". Nothing was wrong with their plan
  — the app simply could not ask, treated "unknown" as "free", and then
  reported that guess as fact. An expired cookie must never look like a
  downgrade.
*/
const LAST_KNOWN_KEY = 'pulse.lastKnownAllowance.v1';

const CACHE_MS = 5 * 60 * 1000;

let cache = null;
let cachedAt = 0;

export const PULSE_ALLOWANCE_SOURCE = Object.freeze({
  BYOK: 'byok',
  PLAN: 'plan',
  /** Server confirmed this earlier; we cannot reach it right now. */
  STALE: 'stale',
  /** Never confirmed anything — offline or signed out on a fresh device. */
  UNKNOWN: 'unknown',
});

async function readLastKnown() {
  try {
    const raw = await store.settings.get(LAST_KNOWN_KEY, null);
    const routines = Number(raw?.routines);

    if (!Number.isFinite(routines) || routines < 0) return null;

    return { routines, plan: String(raw?.plan || '') };
  } catch {
    return null;
  }
}

async function writeLastKnown(routines, plan) {
  try {
    await store.settings.set(LAST_KNOWN_KEY, { routines, plan, at: Date.now() });
  } catch {}
}

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

  if (limits) {
    const routines = Number(limits.pulseRoutines ?? FREE_ROUTINE_ALLOWANCE);
    const plan = me.user?.plan || 'free';

    await writeLastKnown(routines, plan);

    cache = {
      routines,
      unlimited: false,
      source: PULSE_ALLOWANCE_SOURCE.PLAN,
      plan,
      pulseRequestsDay: Number(limits.aiPulseRequestsDay ?? 0) || null,
      confirmed: true,
    };

    cachedAt = Date.now();
    return cache;
  }

  /*
    We could not ask — offline, or the cloud session expired. Fall back to
    what the server last told us rather than to "free": the entitlement
    did not change just because this browser lost its cookie.

    `confirmed: false` is what the UI must check before it blames the
    user's plan for anything.
  */
  const remembered = await readLastKnown();

  cache = remembered
    ? {
        routines: remembered.routines,
        unlimited: false,
        source: PULSE_ALLOWANCE_SOURCE.STALE,
        plan: remembered.plan || 'unknown',
        pulseRequestsDay: null,
        confirmed: false,
      }
    : {
        routines: FREE_ROUTINE_ALLOWANCE,
        unlimited: false,
        source: PULSE_ALLOWANCE_SOURCE.UNKNOWN,
        plan: 'unknown',
        pulseRequestsDay: null,
        confirmed: false,
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
