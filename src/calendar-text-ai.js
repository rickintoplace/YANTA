// ============================================================
// YANTA — a second look at an event drafted from text
//
// The local parser (calendar-text-parse.js) decides WHEN; it is exact,
// free and never leaves the device. What rules do badly is judgement:
// which of three dates in a message is the appointment, whether "um 5"
// is morning, whether "nächsten Freitag" means this week, which words
// make the title. Those are choices, and a decision model answers
// choices with probabilities, at a few thousandths of a cent per call
// (Perplexity Decider via OpenRouter's Decisions API).
//
// The model only ever picks among options built here from the message
// and the parser's spans. It never writes a date, so it cannot compute
// one wrong, and a title it picks is words the sender wrote. Only when
// no title option convinces it does a chat model (the user's own, e.g.
// DeepSeek Flash) write one, and that title must reuse the message's
// words or it is dropped.
//
// Pure: the network calls come in as `decide` and `complete`, so the
// app and scripts/text-event-eval.mjs run the same code.
// ============================================================

// Below this, a pick is shown as a choice instead of applied silently.
export const CONFIDENT = 0.7;

// A title pick this sure replaces a title from a recognised phrase.
const OVERRIDE_PATTERN_TITLE = 0.8;

const DAY_MS = 24 * 60 * 60 * 1000;

function describeMoment(c, locale) {
  const start = new Date(c.start);
  const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const day = start.toLocaleDateString(locale, opts);
  const time = c.allDay ? 'all day' : start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time} (written as “${c.text}”)`;
}

/**
 * Whether the draft is worth a decision call at all. A single date with
 * no guesses and a title from a recognised phrase is left alone.
 */
export function needsRefinement(draft) {
  if (!draft) return false;
  return draft.others.length > 0 ||
    draft.titleSource !== 'pattern' ||
    draft.flags.some((f) => ['meridiem-guessed', 'next-weekday-ambiguous', 'reschedule', 'cancel'].includes(f));
}

/**
 * The Decisions API request for a draft, and how to read the answers.
 * At most eight questions; every option is described in plain words.
 */
export function buildDecision(text, draft, { now = Date.now(), locale = 'en' } = {}) {
  const questions = {};
  const moments = [draft, ...draft.others];

  questions.kind = {
    type: 'choice',
    instructions: 'What does the message do about an appointment or event?',
    criteria: {
      new_event: 'It sets up, confirms or proposes an appointment or event',
      reschedule: 'It moves an existing appointment to another time',
      cancel: 'It cancels an appointment',
      no_event: 'It contains no appointment; dates are only mentioned in passing (a deadline, a past day, a price)',
    },
  };

  if (moments.length > 1) {
    questions.moment = {
      type: 'choice',
      instructions: 'Which of these is the appointment the message sets up or proposes? Not a day that is ruled out or already past.',
      criteria: Object.fromEntries(moments.slice(0, 8).map((m, i) => [
        `m${i + 1}`,
        describeMoment(m.source ? { ...m, text: m.source.text } : m, locale),
      ])),
    };
  }

  if (draft.titleOptions.length > 1) {
    questions.title = {
      type: 'choice',
      instructions: 'Which is the best short calendar title for the appointment — what the user will look for in their calendar?',
      criteria: Object.fromEntries(draft.titleOptions.slice(0, 10).map((t, i) => [`t${i + 1}`, t])),
    };
  }

  if (draft.flags.includes('meridiem-guessed')) {
    const start = new Date(draft.start);
    const h = start.getHours();
    const fmt = (hour) => `${String(hour).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    questions.half = {
      type: 'choice',
      instructions: 'At which time of day is the appointment meant?',
      criteria: {
        morning: `${fmt(h % 12)} in the morning`,
        afternoon: `${fmt(h % 12 + 12)} in the afternoon or evening`,
      },
    };
  }

  if (draft.flags.includes('next-weekday-ambiguous')) {
    const start = new Date(draft.start);
    const later = new Date(start.getTime() + 7 * DAY_MS);
    const day = (d) => d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    questions.week = {
      type: 'choice',
      instructions: 'Which day does the message mean?',
      criteria: { this_week: `${day(start)}, this week`, next_week: `${day(later)}, the week after` },
    };
  }

  questions.tentative = {
    type: 'noul',
    instructions: 'Is the appointment only proposed and still waiting for the recipient to agree?',
  };

  const today = new Date(now).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return {
    state: {
      message: text.slice(0, 4000),
      today,
    },
    questions,
  };
}

function shiftDraft(draft, ms) {
  const move = (iso) => (iso ? new Date(new Date(iso).getTime() + ms).toISOString() : iso);
  return { ...draft, start: move(draft.start), end: move(draft.end) };
}

function pick(answer) {
  if (!answer?.choice) return null;
  const p = Number(answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0);
  return { choice: answer.choice, p, probabilities: answer.probabilities || {} };
}

/**
 * Applies the answers. Confident picks change the draft; unsure ones are
 * kept in `choices` for the confirmation sheet to ask about.
 */
export function applyDecision(draft, answers = {}) {
  let next = { ...draft, choices: [], ai: { model: 'decision' } };
  const moments = [draft, ...draft.others];

  const kind = pick(answers.kind);
  if (kind) {
    next.kind = kind.choice;
    next.ai.kind = kind.p;
    if (kind.choice === 'reschedule' && !next.flags.includes('reschedule')) next.flags = [...next.flags, 'reschedule'];
    if (kind.choice === 'cancel' && !next.flags.includes('cancel')) next.flags = [...next.flags, 'cancel'];
  }

  const moment = pick(answers.moment);
  if (moment) {
    const index = Number(moment.choice.slice(1)) - 1;
    const chosen = moments[index];
    if (chosen && chosen !== draft && moment.p >= CONFIDENT) {
      const start = chosen.start instanceof Date ? chosen.start : new Date(chosen.start);
      let end = chosen.end ? (chosen.end instanceof Date ? chosen.end : new Date(chosen.end)) : null;
      if (!chosen.allDay && !end) end = new Date(start.getTime() + 60 * 60 * 1000);
      next = {
        ...next,
        start: start.toISOString(),
        end: end ? end.toISOString() : null,
        allDay: chosen.allDay,
        recurrence: chosen.recurrence || null,
        source: { text: chosen.text, from: chosen.from, to: chosen.to, spans: chosen.spans },
        flags: [...chosen.flags, ...next.flags.filter((f) => f === 'reschedule' || f === 'cancel')],
        others: moments.filter((m) => m !== chosen && m !== draft).concat([{ ...draft, start: new Date(draft.start), end: draft.end ? new Date(draft.end) : null, text: draft.source.text }]),
      };
    } else if (moment.p < CONFIDENT) {
      next.choices.push({ kind: 'moment', probabilities: moment.probabilities });
    }
  }

  const half = pick(answers.half);
  if (half) {
    const isAfternoon = new Date(next.start).getHours() >= 12;
    const wantAfternoon = half.choice === 'afternoon';
    if (half.p >= CONFIDENT) {
      if (isAfternoon !== wantAfternoon) next = shiftDraft(next, (wantAfternoon ? 12 : -12) * 60 * 60 * 1000);
      next.flags = next.flags.filter((f) => f !== 'meridiem-guessed');
    } else {
      next.choices.push({ kind: 'half', probabilities: half.probabilities });
    }
  }

  const week = pick(answers.week);
  if (week) {
    if (week.p >= CONFIDENT) {
      if (week.choice === 'next_week') next = shiftDraft(next, 7 * DAY_MS);
      next.flags = next.flags.filter((f) => f !== 'next-weekday-ambiguous');
    } else {
      next.choices.push({ kind: 'week', probabilities: week.probabilities });
    }
  }

  const title = pick(answers.title);
  if (title) {
    const chosen = draft.titleOptions[Number(title.choice.slice(1)) - 1];
    const bar = draft.titleSource === 'pattern' ? OVERRIDE_PATTERN_TITLE : 0.4;
    next.ai.title = title.p;
    if (chosen && title.p >= bar) next.title = chosen;
    if (title.p < 0.4) next.titleUnsure = true;
  } else if (draft.titleSource !== 'pattern') {
    next.titleUnsure = true;
  }

  const tentative = Number(answers.tentative?.noul);
  if (Number.isFinite(tentative)) {
    next.ai.tentative = tentative;
    if (tentative >= 0.8) next.status = 'tentative';
    if (tentative <= 0.2) next.status = 'confirmed';
  }

  return next;
}

/*
  A written title must be the sender's words: every word of four letters
  or more appears in the message (compared on its first five letters, so
  "Kontrolltermin" may come from "Kontrolle").
*/
export function titleFromMessage(title, text) {
  const clean = String(title || '').replace(/["„“”]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 60) return '';
  const haystack = String(text || '').toLowerCase();
  const words = clean.toLowerCase().match(/[\p{L}]{4,}/gu) || [];
  if (!words.length) return '';
  return words.every((w) => haystack.includes(w.slice(0, 5))) ? clean : '';
}

export function titlePrompt(text, locale = 'en') {
  return [
    {
      role: 'system',
      content: [
        'You write the title of a calendar event from a message.',
        'Reply with JSON only: {"title": "…"}.',
        'At most five words, in the language of the message, made from words that appear in it.',
        'No date, no time, no greeting, no names of weekdays or months.',
      ].join(' '),
    },
    { role: 'user', content: `Message:\n${text.slice(0, 2000)}\n\nUI language: ${locale}` },
  ];
}

export function parseTitleReply(content, text) {
  const raw = String(content || '');
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  try {
    return titleFromMessage(JSON.parse(json).title, text);
  } catch {
    return '';
  }
}

/**
 * The whole second look. `decide({state, questions})` resolves to
 * `{answers}`; `complete(messages)` to `{content}`. Either may be null
 * (not available), and any failure leaves the draft as it was.
 */
export async function refineEventDraft(text, draft, {
  decide = null,
  complete = null,
  now = Date.now(),
  locale = 'en',
  force = false,
} = {}) {
  if (!draft || (!force && !needsRefinement(draft))) return draft;

  let next = draft;

  if (decide) {
    try {
      const { answers } = await decide(buildDecision(text, draft, { now, locale }));
      next = applyDecision(draft, answers);
    } catch (err) {
      console.warn('[YANTA] event decision failed, keeping the local draft', err?.message || err);
    }
  }

  if (complete && (next.titleUnsure || !next.title)) {
    try {
      const reply = await complete(titlePrompt(text, locale));
      const title = parseTitleReply(reply?.content, text);
      if (title) next = { ...next, title, titleUnsure: false, ai: { ...(next.ai || {}), titleWritten: true } };
    } catch (err) {
      console.warn('[YANTA] event title request failed', err?.message || err);
    }
  }

  return next;
}
