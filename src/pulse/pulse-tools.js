// ============================================================
// YANTA Pulse — tool surface for unattended runs
//
// Two jobs:
//   1. Narrow the registry to a routine's declared profile, minus the
//      tools that must never run with nobody watching.
//   2. Add the two Pulse-only tools a run needs to report back:
//      `pulse_emit` writes a card, `pulse_propose` parks an action the
//      user confirms with one tap.
//
// Both are synthetic: they resolve inside the run context and are never
// registered globally, so they cannot leak into the chat surface.
// ============================================================

import {
  openAiToolsForModel,
  getTool,
} from '../ai/tool-registry.js';

import {
  PULSE_TOOL_DENYLIST,
  PULSE_TOOL_PROFILES,
} from './pulse-config.js';

const RISK_BY_PROFILE = {
  [PULSE_TOOL_PROFILES.READ]: new Set(['read']),
  [PULSE_TOOL_PROFILES.WRITE]: new Set(['read', 'write']),
  [PULSE_TOOL_PROFILES.FULL]: new Set(['read', 'write', 'destructive']),
};

export const PULSE_TOOL_NAMES = Object.freeze({
  EMIT: 'pulse_emit',
  PROPOSE: 'pulse_propose',
});

const PULSE_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: PULSE_TOOL_NAMES.EMIT,
      description: [
        'Deliver the result of this routine to the user.',
        'Call this exactly once, at the end, and only when there is something worth the interruption.',
        'If nothing meaningful happened, do not call it — say so in your final message instead and the run stays silent.',
        'Keep the title under 60 characters. Keep the body short and scannable; markdown is supported.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short headline, under 60 characters.',
          },
          body: {
            type: 'string',
            description: 'Markdown body. A few lines or bullets.',
          },
        },
        required: ['title', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: PULSE_TOOL_NAMES.PROPOSE,
      description: [
        'Park an action for the user to confirm with one tap.',
        'Use this for anything that leaves YANTA or is hard to undo — sending a chat message, deleting, publishing.',
        'You do not execute the action; the user does, from the Inbox card.',
        'Call pulse_emit as well so the card has context explaining why you propose it.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Button text, e.g. "Send Anna the umbrella reminder".',
          },
          tool: {
            type: 'string',
            description: 'Name of the YANTA tool to run when the user confirms.',
          },
          args: {
            type: 'object',
            description: 'Exact arguments for that tool.',
          },
        },
        required: ['label', 'tool', 'args'],
      },
    },
  },
];

/**
 * The tools a routine may call directly, plus the Pulse reporting
 * tools. Anything filtered out simply is not offered — an unattended
 * model should not spend rounds discovering it is not allowed.
 */
export function toolsForProfile(profile) {
  const allowedRisks = RISK_BY_PROFILE[profile] || RISK_BY_PROFILE[PULSE_TOOL_PROFILES.READ];

  const registryTools = openAiToolsForModel().filter((entry) => {
    const name = entry.function?.name || '';

    if (PULSE_TOOL_DENYLIST.includes(name)) return false;

    const meta = getTool(name);

    return !!meta && allowedRisks.has(meta.risk);
  });

  return [...registryTools, ...PULSE_TOOL_DEFINITIONS];
}

export function isPulseTool(name) {
  return name === PULSE_TOOL_NAMES.EMIT || name === PULSE_TOOL_NAMES.PROPOSE;
}

/**
 * Resolves a Pulse-only tool against the run context. Returns null when
 * `name` is not one of ours, so callers can fall through.
 */
export function handlePulseTool({ name, args = {}, run }) {
  if (name === PULSE_TOOL_NAMES.EMIT) {
    const title = String(args.title || '').trim();
    const body = String(args.body || '').trim();

    if (!title && !body) {
      return { error: 'title or body is required.' };
    }

    run.emitted = { title: title.slice(0, 160), body };

    return { ok: true, delivered: 'queued' };
  }

  if (name === PULSE_TOOL_NAMES.PROPOSE) {
    const tool = String(args.tool || '').trim();

    if (!getTool(tool)) {
      return { error: `Unknown tool: ${tool}` };
    }

    if (run.proposals.length >= 4) {
      return { error: 'Too many proposals in one run. Keep it to the few that matter.' };
    }

    run.proposals.push({
      label: String(args.label || 'Run').trim().slice(0, 120),
      tool,
      args: args.args && typeof args.args === 'object' ? args.args : {},
    });

    return { ok: true, proposed: tool };
  }

  return null;
}
