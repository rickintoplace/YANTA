// ============================================================
// YANTA Pulse — library: install, share, import
//
// A routine is markdown, so sharing one is sharing text. The whole
// routine travels inside the link fragment — nothing is uploaded, no
// server sees it, and a link keeps working whether or not YANTA ever
// hosts a gallery.
//
//   https://yanta.page/#pulse-routine=d.<base64url(deflate(markdown))>
//
// Fragments are never sent to the server by the browser, which is the
// property that makes this safe to paste into a chat and cheap to
// operate. It also means the growth loop costs nothing to run.
//
// Everything arriving this way is untrusted: it is an instruction file
// for an agent that holds tools. See sanitizeSharedRoutine.
// ============================================================

import { t } from '../i18n/index.js';

import { skillManageAction } from '../ai/skills.js';
import { parseSkillFrontmatter } from '../ai/skills.js';

import {
  listRoutines,
  routineFromSkill,
} from './pulse-routines.js';

import {
  PULSE_EVENTS,
  PULSE_OUTPUTS,
  PULSE_TOOL_PROFILES,
} from './pulse-config.js';

/** Decoded payloads above this are refused rather than parsed. */
const MAX_ROUTINE_BYTES = 16 * 1024;

const PREFIX_DEFLATE = 'd.';
const PREFIX_PLAIN = 'p.';

// ---------------- encoding ----------------------------------------

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4));

  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read compressed routine links.');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeRoutinePayload(markdown) {
  const raw = new TextEncoder().encode(String(markdown || ''));

  try {
    const packed = await deflate(raw);

    if (packed && packed.length < raw.length) {
      return PREFIX_DEFLATE + bytesToBase64Url(packed);
    }
  } catch {
    // Fall through to the uncompressed form.
  }

  return PREFIX_PLAIN + bytesToBase64Url(raw);
}

export async function decodeRoutinePayload(payload) {
  const value = String(payload || '').trim();

  if (!value) throw new Error('Empty routine link.');

  const body = value.slice(2);
  const bytes = base64UrlToBytes(body);

  if (value.startsWith(PREFIX_DEFLATE)) {
    const raw = await inflate(bytes);

    if (raw.length > MAX_ROUTINE_BYTES) throw new Error('Routine is too large.');

    return new TextDecoder().decode(raw);
  }

  if (value.startsWith(PREFIX_PLAIN)) {
    if (bytes.length > MAX_ROUTINE_BYTES) throw new Error('Routine is too large.');

    return new TextDecoder().decode(bytes);
  }

  throw new Error('Unrecognised routine link.');
}

/** Shareable link carrying the whole routine in its fragment. */
export async function routineShareLink(markdown) {
  const payload = await encodeRoutinePayload(markdown);

  return `${location.origin}${location.pathname}#pulse-routine=${payload}`;
}

/** Reads the routine payload out of a URL or bare hash, or ''. */
export function routinePayloadFrom(input = location.href) {
  let hash = '';
  let search = '';

  try {
    const url = new URL(input, location.href);
    hash = url.hash;
    search = url.search;
  } catch {
    hash = String(input || '');
  }

  const fromHash = new URLSearchParams(String(hash).replace(/^#/, '')).get('pulse-routine');
  const fromSearch = new URLSearchParams(String(search).replace(/^\?/, '')).get('pulse-routine');

  return String(fromHash || fromSearch || '');
}

// ---------------- import safety -----------------------------------

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const VALID_EVENTS = new Set(Object.values(PULSE_EVENTS));
const VALID_OUTPUTS = new Set(Object.values(PULSE_OUTPUTS));

/**
 * Rebuilds a shared routine from only the fields we understand.
 *
 * A shared routine is an instruction file for an agent that holds tools,
 * written by someone the importer may not know. So the frontmatter is
 * discarded and reconstructed from validated values, with two rules that
 * are not negotiable at import time:
 *
 *   - the tool profile is forced to `read`
 *   - the routine arrives disabled
 *
 * Both are one deliberate tap away afterwards, which is the point: the
 * decision to let a stranger's routine write should be the importer's,
 * made while looking at what it says. The body is kept verbatim —
 * rewriting the instructions would defeat the review the user is about
 * to do.
 */
export function sanitizeSharedRoutine(markdown, { fallbackName = 'shared-routine' } = {}) {
  const text = String(markdown || '');

  if (text.length > MAX_ROUTINE_BYTES) {
    throw new Error('Routine is too large.');
  }

  const parsed = parseSkillFrontmatter(text);
  const preview = routineFromSkill(
    { name: slug(parsed.meta?.name) || fallbackName, noteId: '', title: '', description: '' },
    text
  );

  if (!preview) {
    throw new Error('This link does not contain a Pulse routine.');
  }

  const name = slug(parsed.meta?.name) || fallbackName;

  const description = String(parsed.meta?.description || '')
    .replace(/\n/g, ' ')
    .slice(0, 160);

  const events = preview.events.filter((event) => VALID_EVENTS.has(event));
  const outputs = preview.outputs.filter((output) => VALID_OUTPUTS.has(output));

  const lines = [
    '  enabled: false',
    preview.when ? `  when: "${preview.when}"` : '',
    events.length ? `  on: [${events.join(', ')}]` : '',
    `  output: [${(outputs.length ? outputs : [PULSE_OUTPUTS.INBOX]).join(', ')}]`,
    `  tools: ${PULSE_TOOL_PROFILES.READ}`,
    `  cooldown: ${Math.max(5, Math.round(preview.cooldownMs / 60000))}m`,
    `  maxPerDay: ${preview.maxPerDay}`,
    preview.language ? `  language: ${preview.language}` : '',
  ].filter(Boolean);

  const rebuilt = [
    '---',
    `name: ${name}`,
    `description: ${description || 'Shared YANTA Pulse routine'}`,
    'version: 1.0.0',
    'metadata:',
    '  yanta:',
    '    category: pulse',
    'pulse:',
    ...lines,
    '---',
    '',
    parsed.body.trim(),
  ].join('\n');

  return {
    name,
    description,
    markdown: rebuilt,
    body: parsed.body.trim(),

    // What the sender asked for, so the review screen can be honest
    // about what was turned down.
    requestedTools: preview.toolProfile,
    clampedTools: preview.toolProfile !== PULSE_TOOL_PROFILES.READ,
    when: preview.when,
    events,
    outputs,
    problems: preview.invalid,
  };
}

// ---------------- installing --------------------------------------

async function uniqueName(name) {
  const existing = new Set((await listRoutines()).map((routine) => routine.name));

  if (!existing.has(name)) return name;

  for (let i = 2; i < 50; i++) {
    const candidate = `${name}-${i}`.slice(0, 60);
    if (!existing.has(candidate)) return candidate;
  }

  return `${name}-${Date.now().toString(36)}`.slice(0, 60);
}

/**
 * Creates the routine note. Never enables it: installing and running are
 * separate decisions, and the second one belongs to the user.
 */
export async function installRoutine(markdown, { name = '' } = {}) {
  const parsed = parseSkillFrontmatter(markdown);
  const wanted = slug(name || parsed.meta?.name) || 'routine';
  const finalName = await uniqueName(wanted);

  const content = finalName === wanted
    ? markdown
    : markdown.replace(/^name:\s*.+$/m, `name: ${finalName}`);

  const created = await skillManageAction({
    action: 'create',
    name: finalName,
    content,
  });

  window.dispatchEvent(new CustomEvent('yanta-pulse-routines-changed', {
    detail: { name: finalName, installed: true },
  }));

  return { name: finalName, noteId: created.noteId };
}

/** Copies a share link, falling back to a prompt when the API is blocked. */
export async function copyRoutineLink(markdown) {
  const link = await routineShareLink(markdown);

  try {
    await navigator.clipboard.writeText(link);
    return { ok: true, link };
  } catch {
    return { ok: false, link, message: t('pulse.library.copyFailed') };
  }
}
