// ============================================================
// YANTA Pulse — the routine model
//
// A routine is a Skill note carrying a `pulse:` frontmatter block.
// There is deliberately no separate routine store: routines inherit
// E2E sync, versioning, the tree UI and skill_manage for free, and
// YANTA AI can author one with the tools it already has.
//
//   ---
//   name: morning-brief
//   description: Weekday overview before the first meeting
//   pulse:
//     when: "0 7 * * 1-5"
//     on: [calendar-soon]
//     output: [inbox, journal]
//     tools: read
//     cooldown: 4h
//     maxPerDay: 2
//   ---
// ============================================================

import { state } from '../core.js';

import {
  ensureAiBrain,
  AI_BRAIN_IDS,
  isAiBrainNote,
  writeBrainNote,
} from '../ai/brain.js';

import {
  parseSkillFrontmatter,
  listInstalledSkills,
} from '../ai/skills.js';

import {
  PULSE_EVENTS,
  PULSE_OUTPUTS,
  PULSE_TOOL_PROFILES,
  PULSE_TOOL_PROFILE_ORDER,
} from './pulse-config.js';

import { parseDuration } from './pulse-schedule.js';

const VALID_EVENTS = new Set(Object.values(PULSE_EVENTS));
const VALID_OUTPUTS = new Set(Object.values(PULSE_OUTPUTS));

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;
const MIN_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_MAX_PER_DAY = 4;

// ---------------- frontmatter -------------------------------------

/**
 * Reads the indented block under `key:` out of raw frontmatter.
 * Deliberately not a YAML parser — the schema is one level deep and a
 * predictable subset beats a dependency plus surprising coercions.
 */
function readIndentedBlock(rawFrontmatter, key) {
  const lines = String(rawFrontmatter || '').split('\n');
  const start = lines.findIndex((line) => new RegExp(`^${key}\\s*:\\s*$`).test(line));

  if (start < 0) return null;

  const out = {};

  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break;

    const m = /^\s+([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }

  return out;
}

function coerceBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !/^(false|0|no|off)$/i.test(String(value).trim());
}

function coerceList(value) {
  const raw = String(value ?? '').trim();

  if (!raw) return [];

  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function stripQuotes(value) {
  return String(value ?? '').trim().replace(/^["']|["']$/g, '');
}

// ---------------- model -------------------------------------------

/**
 * Builds a routine from a skill's markdown, or null when the skill
 * carries no `pulse:` block. `invalid` collects human-readable reasons
 * a routine will never fire, so the settings UI can explain itself
 * instead of silently doing nothing.
 */
export function routineFromSkill(skill, markdown = skill?.markdown || '') {
  const parsed = parseSkillFrontmatter(markdown);
  const block = readIndentedBlock(parsed.rawFrontmatter, 'pulse');

  if (!block) return null;

  const invalid = [];

  const when = stripQuotes(block.when);
  const events = coerceList(block.on).filter((name) => {
    if (VALID_EVENTS.has(name)) return true;
    invalid.push(`Unknown trigger "${name}"`);
    return false;
  });

  if (!when && !events.length) {
    invalid.push('No schedule and no trigger');
  }

  const outputs = coerceList(block.output).filter((name) => {
    if (VALID_OUTPUTS.has(name)) return true;
    invalid.push(`Unknown output "${name}"`);
    return false;
  });

  const requestedProfile = String(block.tools || '').trim().toLowerCase();

  if (requestedProfile && !PULSE_TOOL_PROFILE_ORDER.includes(requestedProfile)) {
    invalid.push(`Unknown tool profile "${requestedProfile}"`);
  }

  const cooldownMs = block.cooldown
    ? Math.max(MIN_COOLDOWN_MS, parseDuration(block.cooldown) || DEFAULT_COOLDOWN_MS)
    : DEFAULT_COOLDOWN_MS;

  const maxPerDay = Math.max(1, Math.min(24, Number(block.maxPerDay) || DEFAULT_MAX_PER_DAY));

  return {
    name: skill.name,
    noteId: skill.noteId,
    title: skill.title || `Skill: ${skill.name}`,
    description: skill.description || '',
    markdown,

    enabled: coerceBool(block.enabled, true),
    when,
    events,
    outputs: outputs.length ? outputs : [PULSE_OUTPUTS.INBOX],
    toolProfile: PULSE_TOOL_PROFILE_ORDER.includes(requestedProfile)
      ? requestedProfile
      : PULSE_TOOL_PROFILES.READ,
    notify: coerceBool(block.notify, true),
    respectQuietHours: coerceBool(block.quietHours, true),
    cooldownMs,
    maxPerDay,
    invalid,
  };
}

/** Every routine in the vault, including disabled and invalid ones. */
export async function listRoutines() {
  await ensureAiBrain();

  const skills = await listInstalledSkills({ includeMarkdown: true });
  const routines = [];

  for (const skill of skills) {
    const routine = routineFromSkill(skill);
    if (routine) routines.push(routine);
  }

  return routines.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRoutine(name) {
  const clean = String(name || '').trim().toLowerCase();
  const routines = await listRoutines();

  return routines.find((routine) => routine.name === clean) || null;
}

// ---------------- mutation ----------------------------------------

/**
 * Rewrites one key inside the `pulse:` block, preserving everything
 * else in the note. Used by the Inbox "pause this routine" action, so
 * a user can silence a noisy routine from the card that annoyed them.
 */
export function patchPulseBlock(markdown, key, value) {
  const parsed = parseSkillFrontmatter(markdown);

  if (!parsed.rawFrontmatter) return markdown;

  const lines = parsed.rawFrontmatter.split('\n');
  const start = lines.findIndex((line) => /^pulse\s*:\s*$/.test(line));

  if (start < 0) return markdown;

  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end++;

  const indent = /^(\s+)/.exec(lines[start + 1] || '  ')?.[1] || '  ';
  const existing = lines
    .slice(start + 1, end)
    .findIndex((line) => new RegExp(`^\\s+${key}\\s*:`).test(line));

  const entry = `${indent}${key}: ${value}`;

  if (existing >= 0) lines[start + 1 + existing] = entry;
  else lines.splice(end, 0, entry);

  return markdown.replace(parsed.rawFrontmatter, lines.join('\n'));
}

export async function setRoutineEnabled(name, enabled) {
  const routine = await getRoutine(name);

  if (!routine) throw new Error(`Routine not found: ${name}`);

  await writeBrainNote({
    noteId: routine.noteId,
    body: patchPulseBlock(routine.markdown, 'enabled', enabled ? 'true' : 'false'),
    mode: 'replace',
    target: 'skill',
  });

  window.dispatchEvent(new CustomEvent('yanta-pulse-routines-changed', {
    detail: { name: routine.name, enabled: !!enabled },
  }));

  return { ok: true, name: routine.name, enabled: !!enabled };
}

/** True when the note is a Skill note (routines live in AI Brain / Skills). */
export function isRoutineNote(noteId) {
  const note = state.notes.get(String(noteId || ''));

  return !!note &&
    isAiBrainNote(note) &&
    note.folderId === AI_BRAIN_IDS.skillsFolder;
}

/**
 * Plain-English restatement of a routine's trigger. The settings and
 * Inbox UIs show this instead of cron syntax — the markdown stays the
 * power-user surface, this is the one everyone else reads.
 */
export function describeTrigger(routine, { t }) {
  const parts = [];

  if (routine.when) {
    parts.push(describeWhen(routine.when, { t }));
  }

  for (const event of routine.events) {
    parts.push(t(`pulse.events.${camel(event)}`));
  }

  return parts.filter(Boolean).join(' · ');
}

function camel(value) {
  return String(value).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function describeWhen(when, { t }) {
  const interval = parseDuration(when);

  if (interval) {
    return t('pulse.trigger.every', { duration: when });
  }

  const fields = String(when).trim().split(/\s+/);

  if (fields.length !== 5) return when;

  const [minute, hour, dom, month, dow] = fields;

  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return when;

  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  if (dom === '*' && month === '*' && dow === '*') {
    return t('pulse.trigger.daily', { time });
  }

  if (dow === '1-5') {
    return t('pulse.trigger.weekdays', { time });
  }

  if (/^\d$/.test(dow)) {
    return t('pulse.trigger.weekly', {
      day: t(`pulse.weekday.${WEEKDAY_KEYS[Number(dow) % 7]}`),
      time,
    });
  }

  return t('pulse.trigger.at', { time });
}
