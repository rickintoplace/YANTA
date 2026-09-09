// ============================================================
// YANTA Pulse — is our copy of the run log current?
//
// Pulse dedupes across devices through the shared Pulse document: the
// laptop writes "morning-brief ran at 07:00" and the phone reads it.
// That only works once the write has arrived. A device that was closed
// overnight boots with yesterday's run log, sees this morning's 07:00
// slot as missed, and delivers the brief a second time — in whatever
// language that device happens to be set to.
//
// So catching up is gated on freshness. Freshness means one of:
//   - no sync is configured here, so there is no other device whose
//     runs this one could be missing; or
//   - a sync cycle has completed since the app loaded.
//
// Until then the scheduler still fires slots that come due right now
// (see `dueSince`'s `catchUp` option) — it just refuses to reach back
// in time on evidence it knows is stale. Nothing is lost by waiting: a
// routine reasons through the model over the network, so a device that
// cannot sync could not have run it anyway.
// ============================================================

import { store } from '../core.js';

const SYNC_PROVIDER_KEY = 'sync2.provider';

/**
 * How long a catch-up pass waits for a first sync before proceeding
 * with current-minute slots only. Generous on purpose: a brief that
 * arrives a minute late is invisible, one that arrives twice is not.
 */
const WAIT_MS = 90_000;

let completedAt = 0;

/*
  Resolvers of everyone currently blocked in isPulseStateFresh({wait:true}),
  drained by the sync listener below. `waitOnce` is the single shared
  promise they are all waiting on — one bounded wait per session, not one
  per caller.
*/
const waiting = new Set();
let waitOnce = null;

// Installed at module load, not on first ask: the sync cycle that makes
// this device fresh can complete before the scheduler first runs.
window.addEventListener('yanta-sync2-progress', (event) => {
  if (event.detail?.phase !== 'complete') return;

  completedAt = Date.now();

  for (const resolve of waiting) resolve();
  waiting.clear();
});

let configured = null;

async function syncConfigured() {
  if (configured === null) {
    configured = !!await store.settings
      .get(SYNC_PROVIDER_KEY, null)
      .catch(() => null);
  }

  return configured || !!window.yantaSync2?.engine;
}

/**
 * Whether the shared run log may be used for a catch-up decision.
 *
 * @param {object} options
 * @param {boolean} options.wait  Block (bounded) for a first sync rather
 *   than answering immediately. Used by the boot and back-to-foreground
 *   passes, which are exactly the ones with stale state.
 * @returns {Promise<boolean>}
 */
export async function isPulseStateFresh({ wait = false } = {}) {
  if (!await syncConfigured()) return true;
  if (completedAt > 0) return true;
  if (!wait) return false;

  // At most one wait per session, shared by every caller. Once it has
  // elapsed without a sync, waiting again would only keep an offline
  // device from running the slots it *can* run — and the moment sync
  // does land, the check above answers without blocking anyone.
  //
  // The pending resolver goes into `waiting`, which the sync listener at
  // the top of this file drains: that Set is the handoff between the two.
  if (!waitOnce) {
    waitOnce = new Promise((resolve) => {
      const settle = () => {
        waiting.delete(settle);
        resolve();
      };

      waiting.add(settle);
      window.setTimeout(settle, WAIT_MS);
    });
  }

  await waitOnce;

  return completedAt > 0;
}
