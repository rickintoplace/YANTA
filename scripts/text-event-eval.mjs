#!/usr/bin/env node
// ============================================================
// YANTA — text → event eval
//
// Compares ways of turning a shared message into an event, on the
// corpus in test/calendar/text-event-corpus.js:
//
//   parser          local parser only (free, what ships without AI)
//   decide:<model>  parser + one decision-model call (calendar-text-ai.js)
//   hybrid:<model>  parser + decision + chat-model title when unsure
//   llm:<model>     a chat model alone: it reads the message and writes
//                   date, time and title itself (the approach we avoid —
//                   measured, not assumed)
//
// Reports start/title/status accuracy, cost (OpenRouter usage.cost) and
// median latency per variant.
//
//   TZ=Europe/Berlin node scripts/text-event-eval.mjs
//   … --decide perplexity/pplx-decider-v1.2,liquid/d1 --llm deepseek/deepseek-v4.1-flash --set hard --runs 1
//
// The key comes from OPENROUTER_API_KEY or .env.local. Same provider
// shape as the app: zero data retention, no data collection.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { draftEventFromText } from '../src/calendar-text-event.js';
import { refineEventDraft, needsRefinement } from '../src/calendar-text-ai.js';
import { NOW, CASES, HARD_CASES } from '../test/calendar/text-event-corpus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
      .split('\n').find((l) => /^\s*OPENROUTER_API_KEY\s*=/.test(l));
    return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

const KEY = readKey();

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

const DECIDERS = list(arg('decide', 'perplexity/pplx-decider-v1.2,perplexity/pplx-decider-flash-v1.2,liquid/d1.1'));
const HYBRID = list(arg('hybrid', 'perplexity/pplx-decider-v1.2'));
const TITLE_MODEL = arg('title-model', 'deepseek/deepseek-v4.1-flash');
const LLMS = list(arg('llm', 'deepseek/deepseek-v4.1-flash,google/gemini-3.1-flash-lite'));
const SET = arg('set', 'all');
const FORCE = process.argv.includes('--force');

if (process.env.TZ !== 'Europe/Berlin') {
  console.error('Run with TZ=Europe/Berlin — the corpus is written in that local time.');
  process.exit(1);
}

const cases = [
  ...(SET === 'hard' ? [] : CASES.filter(([, want]) => want).map(([text, want]) => [text, { ...want, set: 'corpus' }])),
  ...(SET === 'corpus' ? [] : HARD_CASES.map(([text, want]) => [text, { ...want, set: 'hard' }])),
];

const PROVIDER = { zdr: true, data_collection: 'deny' };

async function post(url, body, attempt = 0) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Title': 'YANTA eval' },
    body: JSON.stringify(body),
  });
  // Rate limits are the eval's problem, not the model's.
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return post(url, body, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  const ms = performance.now() - t0;
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || `HTTP ${res.status}`), { ms });
  return { json, ms, cost: Number(json?.usage?.cost || 0) };
}

function decider(model, meter) {
  return async ({ state, questions }) => {
    const { json, ms, cost } = await post('https://openrouter.ai/api/alpha/decisions', { model, state, questions, provider: PROVIDER });
    meter.ms += ms; meter.cost += cost; meter.calls++;
    return { answers: json.answers };
  };
}

function chat(model, meter) {
  return async (messages) => {
    const { json, ms, cost } = await post('https://openrouter.ai/api/v1/chat/completions', {
      model, messages, temperature: 0, max_tokens: 200,
      reasoning: { enabled: false }, provider: { ...PROVIDER, require_parameters: false }, usage: { include: true },
    });
    meter.ms += ms; meter.cost += cost; meter.calls++;
    return { content: json?.choices?.[0]?.message?.content || '' };
  };
}

// The approach we avoid, done properly: reference time given, JSON out.
async function llmOnly(model, text, meter) {
  const { content } = await chat(model, meter)([
    {
      role: 'system',
      content: 'Extract the calendar event from the message. Current local time: Tuesday, 2026-11-03 10:00 (Europe/Berlin). '
        + 'Reply with JSON only: {"start": "YYYY-MM-DD HH:MM" or "YYYY-MM-DD" for all-day, "end": same format or null, '
        + '"title": "short title in the message language", "tentative": true|false}. If there is no event, reply {"start": null}.',
    },
    { role: 'user', content: text },
  ]);
  const json = JSON.parse(String(content).match(/\{[\s\S]*\}/)?.[0] || '{}');
  return { start: json.start || null, end: json.end || null, title: json.title || '', status: json.tentative ? 'tentative' : 'confirmed', localTimes: true };
}

const pad = (n) => String(n).padStart(2, '0');
function local(iso, allDay) {
  if (!iso) return null;
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function grade(result, want) {
  const starts = [].concat(want.start);
  const allDay = !/\d:\d/.test(starts[0]);
  const got = result?.localTimes ? result.start : local(result?.start, result?.allDay ?? allDay);
  const startOk = !!got && starts.includes(got);
  let titleOk = null;
  if (want.titleHas) titleOk = !!result?.title && want.titleHas.every((w) => result.title.toLowerCase().includes(w.toLowerCase())) && result.title.split(/\s+/).length <= 7;
  else if (want.title !== undefined) titleOk = (result?.title || '').toLowerCase() === want.title.toLowerCase();
  const statusOk = want.status ? result?.status === want.status : null;
  return { startOk, titleOk, statusOk, got, title: result?.title };
}

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

async function runVariant(name, fn) {
  const rows = [];
  const lat = [];
  let cost = 0;
  let calls = 0;
  for (const [text, want] of cases) {
    const meter = { ms: 0, cost: 0, calls: 0 };
    let result = null;
    try {
      result = await fn(text, meter);
    } catch (err) {
      result = { error: err.message };
    }
    if (meter.calls) lat.push(meter.ms);
    cost += meter.cost;
    calls += meter.calls;
    rows.push({ text, want, ...grade(result, want), error: result?.error });
  }
  const rate = (key, set) => {
    const xs = rows.filter((r) => r[key] !== null && (!set || r.want.set === set));
    return xs.length ? `${xs.filter((r) => r[key]).length}/${xs.length}` : '–';
  };
  return {
    name,
    start: `${rate('startOk', 'corpus')} | ${rate('startOk', 'hard')}`,
    title: `${rate('titleOk', 'corpus')} | ${rate('titleOk', 'hard')}`,
    status: rate('statusOk'),
    calls,
    costPer1k: calls ? `$${(cost / cases.length * 1000).toFixed(4)}` : '$0',
    medianMs: lat.length ? Math.round(median(lat)) : 0,
    misses: rows.filter((r) => !r.startOk || r.titleOk === false || r.error),
  };
}

const variants = [['parser', async (text) => draftEventFromText(text, { now: NOW })]];

if (KEY) {
  for (const model of DECIDERS) {
    variants.push([`decide:${model}`, async (text, meter) => {
      const draft = draftEventFromText(text, { now: NOW });
      return refineEventDraft(text, draft, { decide: decider(model, meter), now: NOW, locale: 'de', force: FORCE });
    }]);
  }
  for (const model of HYBRID) {
    variants.push([`hybrid:${model}+${TITLE_MODEL.split('/')[1]}`, async (text, meter) => {
      const draft = draftEventFromText(text, { now: NOW });
      return refineEventDraft(text, draft, { decide: decider(model, meter), complete: chat(TITLE_MODEL, meter), now: NOW, locale: 'de', force: FORCE });
    }]);
  }
  for (const model of LLMS) variants.push([`llm:${model}`, (text, meter) => llmOnly(model, text, meter)]);
} else {
  console.warn('No OPENROUTER_API_KEY (env or .env.local) — running the parser only.\n');
}

const refined = cases.filter(([text]) => needsRefinement(draftEventFromText(text, { now: NOW }))).length;
console.log(`${cases.length} messages, ${refined} would get an AI call in the app.  start/title: corpus | hard\n`);

const results = [];
for (const [name, fn] of variants) results.push(await runVariant(name, fn));

console.table(results.map(({ misses, ...r }) => r));

if (process.argv.includes('--misses')) {
  for (const r of results) {
    console.log(`\n## ${r.name}`);
    for (const m of r.misses) {
      console.log(`- ${m.text}\n    got ${m.got} “${m.title}”${m.error ? ` ERROR ${m.error}` : ''}  want ${[].concat(m.want.start).join(' / ')} ${m.want.titleHas ? `[${m.want.titleHas}]` : m.want.title ? `“${m.want.title}”` : ''}`);
    }
  }
}
