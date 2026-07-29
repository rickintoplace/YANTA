// ============================================================
// YANTA Pulse — the pulse_manage tool
//
// Lets YANTA AI author and adjust routines from a normal conversation:
// "every weekday at 7, summarise my unread feeds" becomes a routine
// without the user ever meeting cron syntax.
//
// Everything is delegated to skill_manage, because a routine *is* a
// skill. This module only owns the `pulse:` frontmatter block.
// ============================================================

import {
  PULSE_EVENTS,
  PULSE_OUTPUTS,
  PULSE_TOOL_PROFILES,
  PULSE_TOOL_PROFILE_ORDER,
  getPulseSettings,
  clampToolProfile,
} from './pulse-config.js';

import {
  listRoutines,
  getRoutine,
  setRoutineEnabled,
  patchPulseBlock,
} from './pulse-routines.js';

import { skillManageAction } from '../ai/skills.js';
import { writeBrainNote } from '../ai/brain.js';
import { getRoutineState } from './pulse-store.js';

import {
  getPulseAllowance,
  wouldExceedAllowance,
} from './pulse-plan.js';

const PULSE_KEYS = [
  'enabled',
  'when',
  'on',
  'output',
  'tools',
  'notify',
  'quietHours',
  'cooldown',
  'maxPerDay',
  'language',
];

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function listValue(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  const clean = parts.map((part) => String(part).trim()).filter(Boolean);

  return clean.length ? `[${clean.join(', ')}]` : '';
}

function pulseBlockLines(args) {
  const lines = [];

  const push = (key, value) => {
    if (value !== '' && value !== undefined && value !== null) {
      lines.push(`  ${key}: ${value}`);
    }
  };

  push('enabled', args.enabled === false ? 'false' : 'true');
  push('when', args.when ? `"${String(args.when).trim()}"` : '');
  push('on', listValue(args.on));
  push('output', listValue(args.output) || `[${PULSE_OUTPUTS.INBOX}]`);
  push('tools', String(args.tools || PULSE_TOOL_PROFILES.READ).trim());
  push('notify', args.notify === false ? 'false' : 'true');
  push('cooldown', args.cooldown ? String(args.cooldown).trim() : '');
  push('language', args.language ? String(args.language).trim() : '');
  push('maxPerDay', Number(args.maxPerDay) > 0 ? String(Math.round(args.maxPerDay)) : '');

  return lines;
}

function buildRoutineMarkdown(args) {
  const name = slug(args.name);

  return [
    '---',
    `name: ${name}`,
    `description: ${String(args.description || 'YANTA Pulse routine').replace(/\n/g, ' ').slice(0, 160)}`,
    'version: 1.0.0',
    'metadata:',
    '  yanta:',
    '    category: pulse',
    'pulse:',
    ...pulseBlockLines(args),
    '---',
    '',
    `# ${name}`,
    '',
    '## Goal',
    '',
    String(args.goal || args.description || 'Describe what this routine achieves for the user.').trim(),
    '',
    '## Procedure',
    '',
    String(args.procedure || [
      '1. Gather the relevant data with read tools.',
      '2. Decide whether anything is worth the user\'s attention.',
      '3. If yes, call pulse_emit with a short headline and a scannable body.',
      '4. If no, stay silent.',
    ].join('\n')).trim(),
    '',
    '## Stay silent when',
    '',
    String(args.silentWhen || '- Nothing changed since the last run.\n- The result would repeat what the user already saw.').trim(),
  ].join('\n');
}

function routineSummary(routine, state = null) {
  return {
    name: routine.name,
    description: routine.description,
    enabled: routine.enabled,
    when: routine.when || null,
    on: routine.events,
    output: routine.outputs,
    tools: routine.toolProfile,
    cooldownMinutes: Math.round(routine.cooldownMs / 60000),
    maxPerDay: routine.maxPerDay,
    problems: routine.invalid,
    lastRunAt: state ? state.lastRunAt || null : undefined,
    runsToday: state ? state.runsToday : undefined,
  };
}

/**
 * Single entry point for the tool. Kept as one action with a verb so
 * the model has one thing to learn instead of six.
 */
export async function pulseManageAction(args = {}) {
  const action = String(args.action || '').trim().toLowerCase();
  const name = slug(args.name);

  if (action === 'list') {
    const routines = await listRoutines();
    const now = Date.now();

    const detailed = [];

    for (const routine of routines) {
      detailed.push(routineSummary(routine, await getRoutineState(routine.name, now)));
    }

    return { count: detailed.length, routines: detailed };
  }

  if (!name) {
    throw new Error('name is required.');
  }

  if (action === 'create') {
    if (await getRoutine(name)) {
      throw new Error(`Routine already exists: ${name}. Use action "update".`);
    }

    if (!args.when && !args.on) {
      throw new Error('A routine needs "when" (a schedule) or "on" (a trigger).');
    }

    const requested = String(args.tools || PULSE_TOOL_PROFILES.READ).trim();

    if (!PULSE_TOOL_PROFILE_ORDER.includes(requested)) {
      throw new Error(`tools must be one of: ${PULSE_TOOL_PROFILE_ORDER.join(', ')}`);
    }

    // At the cap, create it paused rather than refusing. The user gets
    // the routine they asked for and one decision to make, instead of a
    // dead end and a re-dictation.
    const allowance = await getPulseAllowance();
    const capped = args.enabled !== false && await wouldExceedAllowance(await listRoutines());

    const created = await skillManageAction({
      action: 'create',
      name,
      content: buildRoutineMarkdown({
        ...args,
        name,
        enabled: capped ? false : args.enabled,
      }),
    });

    const settings = await getPulseSettings();
    const effective = clampToolProfile(requested, settings);

    window.dispatchEvent(new CustomEvent('yanta-pulse-routines-changed', {
      detail: { name, created: true },
    }));

    return {
      ok: true,
      action,
      name,
      noteId: created.noteId,
      effectiveTools: effective,
      enabled: !capped,
      // Surfaced so the model can tell the user what it cannot do yet
      // instead of silently producing a routine that under-delivers.
      clamped: effective !== requested
        ? `Requested "${requested}" but Pulse settings currently allow at most "${effective}". Ask the user to raise it in Settings → Pulse.`
        : null,
      pausedByPlan: capped
        ? `Created but paused: the current plan runs ${allowance.routines} routine${allowance.routines === 1 ? '' : 's'} at a time. ` +
          'Tell the user plainly, and offer to pause a different routine so this one can run.'
        : null,
    };
  }

  const routine = await getRoutine(name);

  if (!routine) {
    throw new Error(`Routine not found: ${name}`);
  }

  if (action === 'enable' || action === 'disable') {
    if (action === 'enable' && !routine.enabled) {
      const allowance = await getPulseAllowance();

      if (await wouldExceedAllowance(await listRoutines())) {
        throw new Error(
          `The current plan runs ${allowance.routines} routine${allowance.routines === 1 ? '' : 's'} at a time. ` +
          'Ask the user which routine to pause first, or tell them YANTA Plus raises the limit.'
        );
      }
    }

    return setRoutineEnabled(name, action === 'enable');
  }

  if (action === 'inspect') {
    return {
      ...routineSummary(routine, await getRoutineState(name)),
      markdown: routine.markdown,
    };
  }

  if (action === 'update') {
    let markdown = routine.markdown;

    for (const key of PULSE_KEYS) {
      if (args[key] === undefined) continue;

      const value = key === 'on' || key === 'output'
        ? listValue(args[key])
        : key === 'when'
          ? `"${String(args[key]).trim()}"`
          : String(args[key]).trim();

      if (value) markdown = patchPulseBlock(markdown, key, value);
    }

    if (args.procedure) {
      markdown = markdown.replace(
        /## Procedure\n\n[\s\S]*?(?=\n## |$)/,
        `## Procedure\n\n${String(args.procedure).trim()}\n`
      );
    }

    await writeBrainNote({
      noteId: routine.noteId,
      body: markdown,
      mode: 'replace',
      target: 'skill',
    });

    window.dispatchEvent(new CustomEvent('yanta-pulse-routines-changed', {
      detail: { name },
    }));

    return { ok: true, action, name };
  }

  if (action === 'delete') {
    const result = await skillManageAction({ action: 'delete', name });

    window.dispatchEvent(new CustomEvent('yanta-pulse-routines-changed', {
      detail: { name, deleted: true },
    }));

    return result;
  }

  if (action === 'run') {
    const { runRoutineNow } = await import('./pulse-engine.js');

    return runRoutineNow(name);
  }

  throw new Error(`Unsupported pulse_manage action: ${action}`);
}

export const PULSE_MANAGE_TOOL = {
  name: 'pulse_manage',
  permission: 'allowWriteAiBrain',
  risk: 'write',
  description: [
    'Create and manage YANTA Pulse routines — recurring work that runs on its own and reports into the Pulse Inbox.',
    '',
    'Use this whenever the user describes something recurring: "every morning…", "when new articles arrive…", "remind me if…", "each Friday…".',
    'Also offer it proactively when you notice the user repeating the same request — ask first, then create it.',
    '',
    'A routine runs unattended, so its procedure must be self-contained: no questions, no assumptions about what is on screen.',
    'A routine reports by calling pulse_emit, and parks anything outward-facing (messages, deletions) with pulse_propose for the user to confirm.',
    '',
    'Triggers:',
    '- when: 5-field cron in local time ("0 7 * * 1-5") or an interval ("45m", "2h").',
    `- on: sensor triggers — ${Object.values(PULSE_EVENTS).join(', ')}. These fire only when something actually changed, which costs nothing on a quiet day.`,
    'Give a routine both when it should run on a clock but needs the sensors for context.',
    '',
    `Outputs: ${Object.values(PULSE_OUTPUTS).join(', ')}. Default is inbox. Add journal to also append the result to today's note.`,
    `Tool profiles: ${PULSE_TOOL_PROFILE_ORDER.join(', ')}. Default and preferred is read. Only ask for more when the routine genuinely must write.`,
    '',
    'After creating a routine, tell the user in plain language when it will run and what it will do. Never show them the cron string.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'inspect', 'create', 'update', 'enable', 'disable', 'delete', 'run'],
      },
      name: {
        type: 'string',
        description: 'Short kebab-case routine id, e.g. "morning-feed-digest".',
      },
      description: {
        type: 'string',
        description: 'One line the user will read in settings and on every card.',
      },
      goal: {
        type: 'string',
        description: 'What the routine achieves for the user.',
      },
      procedure: {
        type: 'string',
        description: 'Numbered steps the run follows. Be concrete and tool-aware.',
      },
      silentWhen: {
        type: 'string',
        description: 'Conditions under which the run must produce nothing at all.',
      },
      when: {
        type: 'string',
        description: 'Cron ("0 9 * * *") or interval ("2h"). Local time.',
      },
      on: {
        type: 'array',
        items: { type: 'string', enum: Object.values(PULSE_EVENTS) },
        description: 'Sensor triggers.',
      },
      output: {
        type: 'array',
        items: { type: 'string', enum: Object.values(PULSE_OUTPUTS) },
      },
      tools: {
        type: 'string',
        enum: PULSE_TOOL_PROFILE_ORDER,
        default: PULSE_TOOL_PROFILES.READ,
      },
      cooldown: {
        type: 'string',
        description: 'Minimum gap between runs, e.g. "30m", "4h".',
      },
      maxPerDay: {
        type: 'number',
        description: 'Hard cap on runs per day for this routine.',
      },
      notify: {
        type: 'boolean',
        description: 'Send a reminder to open YANTA if the run is missed while the app is closed.',
      },
      language: {
        type: 'string',
        description:
          'Language for this routine\'s output. Omit to follow the app language, which is almost always right. ' +
          'Set it only when the user explicitly wants this routine in a different language.',
      },
      enabled: { type: 'boolean' },
    },
    required: ['action'],
  },
  execute: pulseManageAction,
};
