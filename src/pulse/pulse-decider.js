// ============================================================
// YANTA Pulse — decision-model checks
//
// A decision model answers typed questions with probabilities instead
// of text, for a fraction of a cent and in well under a second. A
// routine opts in per step in its `pulse:` block:
//
//   check: "a new article is about local politics"   before the run
//   checkMin: 0.5
//   rank: true                                         after the run
//   inboxMin: 2
//
// `check` asks whether what the sensors saw matches a condition; below
// checkMin the run is skipped before the agent costs anything. `rank`
// grades the finished card 0–3 (irrelevant … urgent); below inboxMin it
// goes to today's journal instead of the Inbox. A separate judge is
// better calibrated than the agent grading its own output.
//
// Both fail open: no decider or an error means the run goes ahead and
// the card is delivered as configured.
// ============================================================

import {
  openRouterDecide,
  decisionsAvailable,
} from '../ai/openrouter-client.js';

import { describeLocalNow } from '../ai/ai-time.js';

const DEFAULT_CHECK =
  'Does the new data contain something this routine\'s goal asks to report?';

const DEFAULT_RANK =
  'How much does this card deserve the user\'s attention today?';

export const RANK_LEVELS = Object.freeze([
  'irrelevant: noise, nothing new or nothing the user asked for',
  'minor: mildly interesting, fine to read later',
  'notable: worth seeing today',
  'urgent: needs attention or action soon',
]);

/** The routine's instructions without frontmatter, capped. */
function routineGoal(routine) {
  return String(routine.markdown || '')
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .trim()
    .slice(0, 3000);
}

function signalsState(sensors) {
  const out = {};

  for (const [event, signal] of Object.entries(sensors?.signals || {})) {
    out[event] = {
      summary: signal.summary,
      items: signal.detail || signal.sample || [],
    };
  }

  return out;
}

/**
 * Before the run. Returns null when there is nothing to decide (no
 * check, no decider, error), else { probability, run }.
 */
export async function runCheck(routine, sensors, { now = Date.now(), signal = null } = {}) {
  if (!routine.check || !routine.events?.length || !decisionsAvailable()) return null;

  const condition = routine.check === true ? DEFAULT_CHECK : routine.check;

  try {
    const { answers } = await openRouterDecide({
      signal,
      state: {
        localTime: describeLocalNow(now).readable,
        routine: { name: routine.name, instructions: routineGoal(routine) },
        newSinceLastRun: signalsState(sensors),
      },
      questions: {
        check: {
          type: 'noul',
          instructions: routine.check === true
            ? condition
            : `Is this true for the new data: ${condition}`,
        },
      },
    });

    const probability = Number(answers?.check?.noul);
    if (!Number.isFinite(probability)) return null;

    return { probability, run: probability >= routine.checkMin };
  } catch (err) {
    console.warn('[YANTA Pulse] check failed, running anyway', routine.name, err);
    return null;
  }
}

/**
 * After the run. Returns null or { score, inbox } where score is the
 * expected level on RANK_LEVELS (0–3, fractional).
 */
export async function rankResult(routine, { title, body }, { now = Date.now(), signal = null } = {}) {
  if (!routine.rank || !decisionsAvailable()) return null;

  try {
    const { answers } = await openRouterDecide({
      signal,
      state: {
        localTime: describeLocalNow(now).readable,
        routine: { name: routine.name, instructions: routineGoal(routine) },
        card: { title, body: String(body || '').slice(0, 4000) },
      },
      questions: {
        rank: {
          type: 'score',
          instructions: routine.rank === true ? DEFAULT_RANK : routine.rank,
          criteria: [...RANK_LEVELS],
        },
      },
    });

    const score = Number(answers?.rank?.score);
    if (!Number.isFinite(score)) return null;

    return { score, inbox: score >= routine.inboxMin };
  } catch (err) {
    console.warn('[YANTA Pulse] rank failed, delivering as configured', routine.name, err);
    return null;
  }
}
