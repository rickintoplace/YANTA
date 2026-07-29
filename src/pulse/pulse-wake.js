// ============================================================
// YANTA Pulse — background wake-ups
//
// A routine that comes due while YANTA is closed cannot run: the
// reasoning needs the decrypted vault, which only exists on this
// device with the app open. So instead of running it somewhere it
// cannot run, we send a reminder to open YANTA — and the boot pass in
// pulse-engine.js runs it immediately on return.
//
// That is the honest version of a background agent for an end-to-end
// encrypted workspace: the Cloud Worker learns a wake time and nothing
// else. The routine's name, its instructions and its result never
// leave the device in readable form.
// ============================================================

import { t } from '../i18n/index.js';

import {
  isPushActive,
  encryptReminderPayload,
} from '../push/web-push-client.js';

import {
  registerPushScheduleProvider,
  schedulePushRefresh,
} from '../push/push-schedule.js';

import {
  getPulseSettings,
  isQuietHour,
  nextQuietWindowEnd,
} from './pulse-config.js';

import { listRoutines } from './pulse-routines.js';
import { nextDueAt } from './pulse-schedule.js';
import { getRoutineState } from './pulse-store.js';

/** Cap on wake-ups per upload — one nudge per routine is plenty. */
const MAX_WAKES = 12;

/** Distinct wakes closer together than this collapse into one. */
const COALESCE_MS = 15 * 60 * 1000;

let installed = false;

function wakeUrl() {
  return `${location.origin}${location.pathname}${location.search}#dashboard`;
}

/**
 * Encrypted wake items for the shared background schedule.
 *
 * Only clock-triggered routines produce one: an event-triggered
 * routine has nothing to wake for until its sensor sees something,
 * and its sensor only runs on this device anyway.
 */
async function collectPulseWakeItems() {
  if (!isPushActive()) return [];

  const settings = await getPulseSettings();

  if (!settings.enabled || !settings.notifyMissed) return [];

  const now = Date.now();
  const routines = await listRoutines();
  const wakes = [];

  for (const routine of routines) {
    if (!routine.enabled || routine.invalid.length || !routine.when) continue;
    if (!routine.notify) continue;

    const state = await getRoutineState(routine.name, now);

    let at = nextDueAt(routine, state.lastRunAt, now);

    if (!at) continue;

    // Never buzz during quiet hours — defer the nudge to the end of it.
    if (routine.respectQuietHours && isQuietHour(settings, new Date(at))) {
      at = nextQuietWindowEnd(settings, new Date(at));
    }

    wakes.push({ at, routine });
  }

  wakes.sort((a, b) => a.at - b.at);

  const items = [];
  let lastAt = 0;

  for (const wake of wakes) {
    if (items.length >= MAX_WAKES) break;

    // Two routines due minutes apart do not deserve two notifications.
    if (lastAt && wake.at - lastAt < COALESCE_MS) continue;

    try {
      items.push({
        fireAt: Math.round(wake.at),
        enc: await encryptReminderPayload({
          kind: 'pulse-wake',
          id: `pulse-${wake.routine.name}-${wake.at}`,
          title: t('pulse.wake.title'),
          body: t('pulse.wake.body', { routine: wake.routine.description || wake.routine.name }),
          url: wakeUrl(),
        }),
      });

      lastAt = wake.at;
    } catch (err) {
      console.warn('[YANTA Pulse] wake encrypt failed', err);
    }
  }

  return items;
}

export async function refreshPulseWakeSchedule() {
  schedulePushRefresh(1200);
}

export function setupPulseWake() {
  if (installed) return;
  installed = true;

  registerPushScheduleProvider('pulse', collectPulseWakeItems);

  window.addEventListener('yanta-push-state-changed', () => {
    schedulePushRefresh(800);
  });
}
