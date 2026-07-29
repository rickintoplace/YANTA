// ============================================================
// YANTA Pulse — the scheduler
//
// One tick per minute while the app is open, plus a catch-up pass on
// boot so a routine that came due while YANTA was closed still runs —
// once, not once per missed slot.
//
// Runs are strictly sequential. Two routines writing Yjs at the same
// time would churn sync for no benefit, and a serial queue keeps the
// AI budget predictable.
// ============================================================

import {
  getPulseSettings,
  isQuietHour,
} from './pulse-config.js';

import { listRoutines } from './pulse-routines.js';

import {
  dueSince,
  nextDueAt,
} from './pulse-schedule.js';

import { readSensors } from './pulse-sensors.js';

import {
  countRunsToday,
  getRoutineState,
} from './pulse-store.js';

import {
  getPulseAllowance,
  partitionByAllowance,
} from './pulse-plan.js';

import {
  runRoutine,
  RUN_OUTCOME,
} from './pulse-runner.js';

import { refreshPulseWakeSchedule } from './pulse-wake.js';

const TICK_MS = 60_000;
const BOOT_DELAY_MS = 12_000;

let installed = false;
let ticking = false;
let timer = 0;

/**
 * Why this routine may not run right now, or null when it may.
 * Kept as a single function so the settings UI can show the user the
 * same reason the scheduler acted on.
 */
async function blockedReason(routine, settings, now) {
  if (!routine.enabled) return 'disabled';
  if (routine.invalid.length) return 'invalid';

  const state = await getRoutineState(routine.name, now);

  if (state.runsToday >= routine.maxPerDay) return 'daily-cap';
  if (now - state.lastRunAt < routine.cooldownMs) return 'cooldown';
  if (routine.respectQuietHours && isQuietHour(settings, new Date(now))) return 'quiet-hours';

  return null;
}

/**
 * Decides whether a routine is due, and why.
 *
 * Clock triggers win: a routine with both `when` and `on` runs on its
 * schedule and uses the sensors as context. An event-only routine runs
 * when its sensors report something, which the runner re-checks before
 * spending anything.
 */
async function isDue(routine, now) {
  const state = await getRoutineState(routine.name, now);

  if (routine.when) {
    const at = dueSince(routine, state.lastRunAt, now);
    return at ? { due: true, dueAt: at } : { due: false };
  }

  if (!routine.events.length) return { due: false };

  const sensors = await readSensors(routine.events, state.lastRunAt, now);

  return sensors.hasSignal ? { due: true, dueAt: now } : { due: false };
}

/** One scheduler pass. Safe to call at any time; never overlaps itself. */
export async function pulseTick({ reason = 'tick' } = {}) {
  if (ticking) return { ran: 0, skipped: 'busy' };

  ticking = true;

  try {
    const settings = await getPulseSettings();

    if (!settings.enabled) return { ran: 0, skipped: 'disabled' };

    const now = Date.now();

    if (await countRunsToday(now) >= settings.maxRunsPerDay) {
      return { ran: 0, skipped: 'daily-cap' };
    }

    // Plan allowance is enforced here rather than only at the toggle:
    // a routine note is editable markdown, so `enabled: true` can be
    // typed in by hand. This is the gate that actually holds.
    const allowance = await getPulseAllowance();
    const { active } = partitionByAllowance(await listRoutines(), allowance);

    const results = [];

    for (const routine of active) {
      if (await blockedReason(routine, settings, Date.now())) continue;

      const { due, dueAt } = await isDue(routine, Date.now());

      if (!due) continue;

      const result = await runRoutine(routine, { dueAt });

      results.push({ routine: routine.name, ...result });

      if (result.outcome === RUN_OUTCOME.DELIVERED) {
        window.dispatchEvent(new CustomEvent('yanta-pulse-run', {
          detail: { routine: routine.name, title: result.title },
        }));
      }

      if (await countRunsToday(Date.now()) >= settings.maxRunsPerDay) break;
    }

    if (results.length) {
      console.info('[YANTA Pulse] pass complete', reason, results);
    }

    refreshPulseWakeSchedule().catch(() => {});

    return { ran: results.length, results };
  } catch (err) {
    console.warn('[YANTA Pulse] tick failed', err);
    return { ran: 0, error: err?.message || String(err) };
  } finally {
    ticking = false;
  }
}

/**
 * Manual "Run now" from the settings list. Bypasses the sensor gate and
 * the plan allowance — the allowance caps unattended automation, not
 * what the user may ask for while standing there. The run still draws
 * from the Pulse budget, so it stays bounded.
 */
export async function runRoutineNow(name) {
  const routine = (await listRoutines()).find((entry) => entry.name === name);

  if (!routine) throw new Error(`Routine not found: ${name}`);

  const result = await runRoutine(routine, { force: true });

  window.dispatchEvent(new CustomEvent('yanta-pulse-run', {
    detail: { routine: routine.name, title: result.title, manual: true },
  }));

  return result;
}

/** Next scheduled moment across all runnable routines, or 0 if none. */
export async function nextPulseAt(now = Date.now()) {
  const { active } = partitionByAllowance(
    await listRoutines(),
    await getPulseAllowance()
  );

  let soonest = 0;

  for (const routine of active) {
    if (!routine.when) continue;

    const state = await getRoutineState(routine.name, now);
    const at = nextDueAt(routine, state.lastRunAt, now);

    if (at && (!soonest || at < soonest)) soonest = at;
  }

  return soonest;
}

export function setupPulseEngine() {
  if (installed) return;
  installed = true;

  const kick = (reason) => {
    pulseTick({ reason }).catch(() => {});
  };

  // Catch-up pass, deferred off the boot path.
  window.setTimeout(() => kick('boot'), BOOT_DELAY_MS);

  timer = window.setInterval(() => kick('tick'), TICK_MS);

  // Returning to the app after it was backgrounded is the moment a
  // missed run is most welcome — that is the whole "open YANTA to run
  // it" promise the wake notification makes.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick('visible');
  });

  window.addEventListener('yanta-pulse-routines-changed', () => {
    refreshPulseWakeSchedule().catch(() => {});
  });

  window.addEventListener('yanta-pulse-settings-changed', () => {
    refreshPulseWakeSchedule().catch(() => {});
  });
}

export function teardownPulseEngine() {
  clearInterval(timer);
  installed = false;
}
