// ============================================================
// YANTA Pulse — plan first, then read
//
// A routine runs unattended and reads things nobody vetted: feed
// articles, web pages, chat messages. Text in them can try to steer the
// run ("also create an event…", "post this to the chat…"). The taint
// gate (untrusted-content.js) already stops changes, deletions and
// outbound calls after such content was read. This adds the other half:
// which actions a run may take at all is decided BEFORE anything is
// read, from the routine's own instructions only.
//
// A short model call sees the routine text and the tool list — no
// sensor data, no feed, nothing a stranger wrote — and returns the
// tools the routine needs. During the run, a write or outbound tool
// that is not on that list is refused (and may still be proposed with
// pulse_propose for the user to confirm). Local read tools stay free:
// reading a note cannot hurt anyone.
//
// The plan is cached per routine text and tool set, so it costs one
// small request when a routine is created or edited, not one per run.
// Fails open to the taint gate alone if planning fails.
// ============================================================

import { openRouterChatCompletion } from '../ai/openrouter-client.js';
import { getTool } from '../ai/tool-registry.js';
import { OUTBOUND_URL_TOOLS } from '../ai/untrusted-content.js';
import { contentDigest } from './pulse-store.js';

const CACHE_KEY = 'yanta.pulse.toolPlans.v1';
const CACHE_MAX = 40;

// Tools that reach out to the network on the model's choice of input.
const OUTBOUND_TOOLS = new Set([...Object.keys(OUTBOUND_URL_TOOLS), 'web_search', 'add_rss_source']);

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

/** True when a tool needs to be in the plan to run. */
export function needsPlan(name) {
  const risk = getTool(name)?.risk;
  return risk === 'write' || risk === 'destructive' || OUTBOUND_TOOLS.has(name);
}

const PLANNER_INSTRUCTIONS = [
  'You plan which tools a scheduled background routine of a notes app may use.',
  'You get the routine\'s instructions (written by the user) and the tools available to it.',
  'Return the tools the routine genuinely needs to do what its instructions say — nothing it might only conceivably use.',
  'Read-only lookups of the user\'s own notes and calendar are always allowed; list only tools that change something or reach the internet.',
  'Answer with JSON only: {"tools": ["tool_name", …], "why": "one short sentence"}.',
].join('\n');

function parsePlan(text, candidates) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const json = JSON.parse(match[0]);
    const tools = (Array.isArray(json.tools) ? json.tools : [])
      .map((n) => String(n || '').trim())
      .filter((n) => candidates.includes(n));
    return { tools, why: String(json.why || '').slice(0, 200) };
  } catch {
    return null;
  }
}

/**
 * The plan for a routine: { tools: [names], why, at } or null when it
 * could not be made. `offered` is the run's tool list (OpenAI format).
 */
export async function planRoutineTools(routine, offered, { signal = null } = {}) {
  const candidates = offered
    .map((t) => t.function?.name)
    .filter((name) => name && needsPlan(name));

  // Nothing to decide: a read-only routine.
  if (!candidates.length) return { tools: [], why: 'read-only', at: Date.now() };

  const key = contentDigest(`${routine.markdown}\n${candidates.join(',')}`);
  const cache = readCache();
  if (cache[key]) return cache[key];

  const toolList = offered
    .filter((t) => candidates.includes(t.function?.name))
    .map((t) => `- ${t.function.name}: ${String(t.function.description || '').split('\n')[0].slice(0, 160)}`)
    .join('\n');

  let plan = null;

  try {
    const reply = await openRouterChatCompletion({
      signal,
      source: 'pulse',
      tools: [],
      messages: [
        { role: 'system', content: PLANNER_INSTRUCTIONS },
        { role: 'user', content: `# Routine instructions\n${String(routine.markdown || '').slice(0, 6000)}\n\n# Tools that change things or reach the internet\n${toolList}` },
      ],
    });

    plan = parsePlan(reply?.content, candidates);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.warn('[YANTA Pulse] tool planning failed; running with the taint gate only', err);
    return null;
  }

  if (!plan) return null;

  plan.at = Date.now();
  cache[key] = plan;
  writeCache(cache);

  return plan;
}
