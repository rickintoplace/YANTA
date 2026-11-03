// ============================================================
// YANTA — a calendar event drafted from shared text
//
// The "when" comes from calendar-text-parse.js; this adds the rest of
// what an iCalendar VEVENT carries — title (SUMMARY), place (LOCATION),
// the original text (DESCRIPTION) and whether it is only proposed
// (STATUS:TENTATIVE, "…, ok?") — and returns the shape the event editor
// takes, so a shared message and a shared .ics end in the same place.
//
// Heuristics, not understanding: the title rules cover the common
// shapes ("Termin beim Zahnarzt", "Zahnarzttermin", "Zeit für Kaffee",
// "Dentist appointment") and otherwise take what is left of the
// sentence once the date and filler words are gone. The draft is always
// shown before it is saved.
// ============================================================

import { findWhen } from './calendar-text-parse.js';

const DEFAULT_DURATION_MIN = 60;
const TITLE_MAX = 60;

const ONLINE_MEETING_RX = /https?:\/\/(?:[\w-]+\.)*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si|jitsi\.[\w.]+|bigbluebutton\.[\w.]+)\/\S*/i;

const STREET_RX = /(?<![\p{L}])((?:[A-ZÄÖÜ][\p{L}ß.-]*\s)?[A-ZÄÖÜ]?[\p{L}ß-]*(?:straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee|steig|pfad|markt|street|st\.|avenue|ave\.|road|rd\.|lane|boulevard|blvd\.))\s+(\d{1,4}\s?[a-zA-Z]?)(?:\s*,\s*|\s+)?((?:\d{5}\s+)?[A-ZÄÖÜ][\p{L}-]+(?:\s[A-ZÄÖÜ][\p{L}-]+)?)?/u;

// Phrases that carry the question, not the subject.
const FILLER_RX = /\b(?:aber|but|ok(?:ay)?|passt(?:\s+(?:das|dir|euch))?|geht(?:\s+das)?|einverstanden|ja|nein|hi|hallo|hey|moin|servus|lg|vg|liebe\s+grüße|viele\s+grüße|grüße|bis\s+dann|bitte|danke|thanks|thank\s+you|please|cheers|see\s+you|does\s+that\s+work(?:\s+for\s+you)?|works\s+for\s+you|ok\s+for\s+you|sounds\s+good|hast\s+du\s+(?:da\s+)?zeit|haben\s+sie\s+(?:da\s+)?zeit|are\s+you\s+free|nur)\b/giu;

// Words a leftover title should not start with.
const LEADING_RX = /^(?:(?:am|um|ab|bis|vom|von|den|dem|der|die|das|ein|eine|einen|einem|im|und|dann|also|noch|wir|ich|du|sie|es|uns|haben|habe|hab|hast|hat|ist|sind|bin|bist|wäre|kannst|könntest|kann|lass|lasst|wollen|sollen|on|at|the|a|an|and|then|we|i|you|is|are|am|have|has|let's|lets|let|us|can|could|shall|ihr|ihre|ihren|your|my|mein|meine|dein|deine|unser|unsere|next|nächster|nächste|neuer|neue|findet|gibt|beginnt|startet|steht|folgende|folgender)\s+)+/iu;

// "Erinnerung: …", "Re: …" — a label, not the subject.
const LABEL_RX = /^\s*(?:(?:erinnerung|reminder|termin|betreff|subject|re|aw|fwd|wg|info|hinweis)\s*:\s*)+/iu;

// A clause that only greets.
const GREETING_RX = /^\s*(?:hallo|hi|hey|liebe[rs]?|dear|sehr\s+geehrte[rs]?|guten\s+(?:morgen|tag|abend)|moin|servus|grüß\s+dich|hello)\b/iu;

// Prepositions a removed date leaves behind: "Impfung ist am ⎵ in der Praxis".
const DATE_GLUE_RX = /(?:(?<![\p{L}])(?:am|um|ab|bis|vom|von|zum|den|gegen|zwischen|jeden|jede|on|at|by|from|until|every|this|next|nächsten|kommenden)\s+)+$/iu;

const VENUE_RX = /(?<![\p{L}])(?:(?:in\s+der|im|in|bei|at\s+the|at)\s+)?((?:Praxis|Restaurant|Café|Cafe|Kanzlei|Klinik|Krankenhaus|Hotel|Gemeindehaus|Mensa|Bar|Kneipe|Turnhalle|Aula|Saal|Raum|Room|Studio)(?:\s+(?:(?:Dr|Prof)\.\s*)?[\p{Lu}\d][\p{L}\d\-.]*){0,3})/u;

// "verschoben vom 3.12. auf den 10.12." splits the phrase like German does.
const RESCHEDULE_RX = /\b(?:(?:verschoben|verlegt)\b[^!?\n]{0,40}?\b(?:auf|nach|zu)\b|(?:auf|nach)\b[^!?\n]{0,40}?\b(?:verschoben|verlegt)\b|neuer\s+termin|moved\s+to|rescheduled\s+(?:to|for)|postponed\s+to)\b/iu;
// German splits the verb: "fällt am Donnerstag aus".
const CANCEL_RX = /\b(?:abgesagt|(?:fällt|faellt)\b[^!?\n]{0,40}?\baus|entfällt|storniert|cancell?ed|called\s+off)\b/iu;

// "Termin beim Zahnarzt", "appointment with Dr. Lee" …
const TITLE_PATTERNS = [
  /\btermin(?:\s+\S+){0,3}?\s+(?:beim|bei\s+der|bei\s+dem|bei|im|in\s+der|zum|zur|für)\s+((?:(?:Dr|Prof|Fr|Hr)\.\s*)?[\p{L}][\p{L}\-]*(?:\s+[\p{Lu}][\p{L}\-]*)?)/iu,
  /\b(?:appointment|meeting|call)\s+(?:with|at)\s+((?:(?:Dr|Prof|Mr|Mrs|Ms)\.\s*)?[\p{L}][\p{L}\-]*(?:\s+[\p{Lu}][\p{L}\-]*)?)/iu,
  /\b(?:zeit|lust)\s+(?:für|auf)\s+(?:einen?\s+|eine\s+|ein\s+)?([\p{L}][\p{L}\-]*)/iu,
  /\b(?:time|free)\s+for\s+(?:a\s+|an\s+)?([\p{L}][\p{L}\-]*)/iu,
];

const COMPOUND_RX = /\b([\p{Lu}][\p{L}]{2,})(?:termin|appointment)\b/u;
const ENGLISH_COMPOUND_RX = /\b([\p{L}][\p{L}\-]{2,})\s+appointment\b/iu;

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function clean(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

/** The text with these spans blanked out, offsets kept. */
function blank(text, spans) {
  let out = text;
  for (const [from, to] of spans) {
    out = out.slice(0, from) + ' '.repeat(to - from) + out.slice(to);
  }
  return out;
}

function findLocation(text) {
  const online = ONLINE_MEETING_RX.exec(text);
  if (online) return { value: online[0], span: [online.index, online.index + online[0].length] };

  const street = STREET_RX.exec(text);
  const venue = VENUE_RX.exec(text);
  const venueEnd = venue ? venue.index + venue[0].length : -1;

  // "Restaurant Lindenhof, Marktplatz 3" is one place.
  if (venue && street && street.index >= venueEnd && street.index - venueEnd <= 3) {
    return {
      value: clean(`${venue[1]}, ${clean(street[0]).replace(/[,.;]$/, '')}`),
      venue: venue[1],
      span: [venue.index, street.index + street[0].length],
    };
  }

  if (street) {
    const value = clean(street[0]).replace(/[,.;]$/, '');
    return { value, span: [street.index, street.index + street[0].length] };
  }

  if (venue) return { value: clean(venue[1]).replace(/[,.;]$/, ''), venue: venue[1], span: [venue.index, venueEnd] };

  return null;
}

/** Spans plus the prepositions right before them ("am", "um", "jeden"). */
function withGlue(text, spans) {
  return spans.map(([from, to]) => {
    const glue = DATE_GLUE_RX.exec(text.slice(Math.max(0, from - 30), from));
    return [glue ? from - glue[0].length : from, to];
  });
}

/*
  Leading phrases like "Ihr Termin", "einen Termin gemacht" are glue,
  and so are the prepositions a date left behind ("am", "um").
*/
function tidyTitle(raw) {
  let t = clean(raw)
    .replace(LABEL_RX, ' ')
    .replace(RESCHEDULE_RX, ' ')
    .replace(CANCEL_RX, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(FILLER_RX, ' ')
    .replace(/[?!]+/g, ' ');
  t = clean(t).replace(/^[,.;:–\-\s]+|[,.;:–\-\s]+$/g, '');
  t = t.replace(/\s*\((?:ganztägig|ganztags|all[- ]day)\)/giu, '');
  t = t.replace(/(?:\s+(?:am|um|ab|bis|vom|von|den|on|at|from|by|zum|zur|auf|for|für|und|and|oder|or|ist|is|statt))+$/iu, '');
  t = t.replace(LEADING_RX, '');
  t = t.replace(/\b(?:termin|appointment)\b\s*/iu, (m, offset) => (offset === 0 ? '' : m));
  t = clean(t).replace(/^[,.;:–\-\s]+|[,.;:–\-\s]+$/g, '');
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t;
}

/*
  The patterns match case-insensitively, so their second word may be the
  verb that follows ("beim Zahnarzt gemacht"). A name continues only
  with a capitalised word ("bei Dr. Müller", "bei Oma Erna").
*/
function nameOnly(capture) {
  const words = clean(capture).split(' ');
  if (words.length < 2) return words[0] || '';
  const second = words[1];
  return second[0] === second[0].toUpperCase() && /\p{L}/u.test(second[0]) ? words.slice(0, 2).join(' ') : words[0];
}

// Words that start sentences in German or carry no subject of their own.
const NOT_A_TITLE = new Set([
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'hallo', 'hi', 'hey', 'liebe', 'lieber', 'termin', 'erinnerung',
  'bitte', 'danke', 'ok', 'okay', 'nur', 'aber', 'und', 'oder', 'dann', 'am', 'um', 'ab', 'bis', 'von', 'vom',
  'the', 'a', 'an', 'and', 'or', 'but', 'please', 'thanks', 'hello', 'dear', 'reminder', 'appointment',
  'sorry', 'leider', 'gleiche', 'selbe', 'zeit', 'uhrzeit', 'same', 'time', 'raum', 'room',
  'kannst', 'können', 'lass', 'hast', 'habe', 'haben', 'sind', 'ist', 'wird', 'gibt', 'mal', 'noch', 'schon',
]);

/*
  Every plausible title, best first, and where the first one came from.
  The share sheet uses the first; a decision model may pick another —
  but only from this list, so a title is always words from the message.
*/
function titleOptions(text, when, location, allWhen = []) {
  // Every date the text names goes, not only the chosen one.
  const spans = [
    ...withGlue(text, allWhen.flatMap((c) => c.spans)),
    ...(location ? [location.span] : []),
  ];

  // "Zoom: https://…" — the platform's name is part of the place.
  if (location && /^https?:/.test(location.value)) {
    const lead = /(?:zoom|teams|meet|google meet|webex|jitsi|whereby)(?:-?(?:link|call|meeting))?\s*:?\s*$/iu.exec(text.slice(0, location.span[0]));
    if (lead) spans.push([lead.index, location.span[0]]);
  }
  const rest = blank(text, spans);

  const options = [];
  const add = (title, source) => {
    const t = capitalize(clean(title));
    if (/[\p{L}]{2,}/u.test(t) && !options.some((o) => o.title.toLowerCase() === t.toLowerCase())) {
      options.push({ title: t, source });
    }
  };

  for (const rx of TITLE_PATTERNS) {
    const m = rx.exec(clean(rest));
    if (m) add(tidyTitle(nameOnly(m[1])), 'pattern');
  }

  // "Ihre Impfung ist am …", "your flight is on …"
  const subject = /\b(?:ihre?|ihren|deine?|dein|your)\s+([\p{L}][\p{L}\-]+)\s+(?:ist|findet|beginnt|startet|is|starts|begins)\b/iu.exec(clean(rest));
  if (subject) add(subject[1], 'pattern');

  // A table booked at a place: the place is what the user will look for.
  if (location?.venue && /\b(?:tisch|reservierung|reserviert|table|reservation|booking|gebucht|booked)\b/iu.test(text)) {
    add(location.venue, 'pattern');
  }

  // "Wir sehen uns Mittwoch!" names no subject — it is a meeting.
  if (/\b(?:sehen\s+uns|treffen\s+uns|see\s+you|meet\s+up)\b/iu.test(rest)) {
    add(/\b(?:see|meet)\b/i.test(rest) ? 'Meet-up' : 'Treffen', 'pattern');
  }

  // "Zahnarzttermin" → "Zahnarzt"; "Gesprächstermin" → "Gespräch" (the
  // linking s goes after -ch, -ung, -heit, -keit, -ion, -tät).
  // "Gesprächstermin mit Frau Dr. Klein" → "Gespräch mit Dr. Klein"
  const withName = /([\p{Lu}][\p{L}]{2,}?)(?:s)?(?:termin|treffen)\s+mit\s+(?:(?:Frau|Herrn?|Mr|Mrs|Ms)\.?\s+)?((?:(?:Dr|Prof)\.\s*)?[\p{Lu}][\p{L}\-]+)/u.exec(rest);
  if (withName) add(`${withName[1]} mit ${withName[2]}`, 'pattern');

  const compound = COMPOUND_RX.exec(rest);
  if (compound) add(compound[1].replace(/(ch|ung|heit|keit|ion|tät)s$/u, '$1'), 'pattern');

  const english = ENGLISH_COMPOUND_RX.exec(rest);
  if (english && !/^(?:an?|the|my|your|our)$/i.test(english[1])) add(english[1], 'pattern');

  /*
    Otherwise the sentence the date sits in, minus the date: "Abendessen
    bei Oma, Samstag dreiviertel 7" → "Abendessen bei Oma". Then the
    other sentences, in order.
  */
  const sentences = [];
  const sentenceRx = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
  for (const m of rest.matchAll(sentenceRx)) {
    sentences.push({ from: m.index, to: m.index + m[0].length, text: m[0] });
  }

  const own = when ? sentences.filter((s) => s.from <= when.to && when.from <= s.to) : [];
  const ordered = [...own, ...sentences.filter((s) => !own.includes(s))];

  for (const s of ordered) {
    let offset = s.from;
    const clauses = s.text.split(/([,;]|\s[–-]\s)/).filter((part, i) => i % 2 === 0).map((part) => {
      const c = { text: part, from: s.text.indexOf(part, offset - s.from) + s.from };
      offset = c.from + part.length;
      return c;
    });
    // The clause holding the date first: "…, aber am 4.12. um 15 Uhr".
    const mine = when ? clauses.filter((c) => c.from <= when.to && when.from <= c.from + c.text.length) : [];
    for (const clause of [...mine, ...clauses.filter((c) => !mine.includes(c))]) {
      if (GREETING_RX.test(clause.text)) continue;
      add(tidyTitle(clause.text), 'clause');
    }
  }

  // German nouns are capitalised: single nouns make short candidates
  // ("Zahnarzt", "Kontrolle"). Lower-case words after a sentence start
  // are often nouns typed in a hurry ("nur kontrolle"), so they count too.
  for (const m of rest.matchAll(/(?<![\p{L}\d])([\p{L}][\p{L}\-]{3,})(?![\p{L}])/gu)) {
    const word = m[1];
    if (NOT_A_TITLE.has(word.toLowerCase())) continue;
    if (/^[\p{Lu}]/u.test(word) || /^(?:nur|kurz|zur|zum)\s+$/iu.test(rest.slice(Math.max(0, m.index - 5), m.index))) {
      add(word, 'word');
    }
  }

  // A short combination of the first two candidates ("Zahnarzt – Kontrolle"),
  // only when the first one comes from a recognised phrase.
  const [a, b] = options.filter((o) => o.title.split(' ').length <= 2);
  if (a?.source === 'pattern' && b && !a.title.toLowerCase().includes(b.title.toLowerCase()) && !b.title.toLowerCase().includes(a.title.toLowerCase())) {
    add(`${a.title} – ${b.title}`, 'combined');
  }

  return options.slice(0, 10);
}

function isTentative(text, when) {
  if (/\b(?:ok(?:ay)?|passt\s+(?:das|dir|euch)|geht\s+das|einverstanden|does\s+that\s+work|works\s+for\s+you|ok\s+for\s+you|sounds\s+good)\s*\?/iu.test(text)) return true;

  // The sentence with the date asks a question.
  if (!when) return false;
  const tail = text.slice(when.to);
  const end = tail.search(/[.!?\n]/);
  return end >= 0 && tail[end] === '?';
}

/**
 * Drafts an event from shared text, or returns null when the text names
 * no usable moment.
 *
 * @returns {null | {
 *   title: string, start: string, end: string|null, allDay: boolean,
 *   location: string, description: string, status: 'confirmed'|'tentative',
 *   source: { text: string, from: number, to: number, spans: number[][] },
 *   flags: string[], alternatives: object[], others: object[]
 * }}
 */
export function draftEventFromText(text, options = {}) {
  const source = String(text || '').trim();
  const found = findWhen(source, options);
  const when = found.find((c) => !c.past) || null;
  if (!when) return null;

  const location = findLocation(source);
  const titles = titleOptions(source, when, location, found);
  const title = titles[0]?.title || '';
  const flags = [...when.flags];
  if (RESCHEDULE_RX.test(source)) flags.push('reschedule');
  if (CANCEL_RX.test(source)) flags.push('cancel');

  let { start, end } = when;
  if (!when.allDay && !end) end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);

  return {
    title,
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    allDay: when.allDay,
    recurrence: when.recurrence,
    location: location?.value || '',
    description: source,
    status: isTentative(source, when) ? 'tentative' : 'confirmed',
    // How the title was found: 'pattern' is a recognised phrase ("Termin
    // beim …"); 'clause' and 'word' are leftovers worth a second look.
    titleSource: titles[0]?.source || 'none',
    titleOptions: titles.map((o) => o.title),
    source: { text: when.text, from: when.from, to: when.to, spans: when.spans },
    flags,
    alternatives: when.alternatives,
    // Further moments in the same text (a school letter with five dates).
    others: found.filter((c) => c !== when && !c.past),
  };
}

/*
  Where one moment's part of the text ends: the last clause break
  (comma, semicolon, full stop, line break) between it and the next
  moment. "Elternabend 12.11. 19 Uhr, Sportfest 20.11." splits after
  "19 Uhr"; "Am 12.11. ist Elternabend. Am 20.11. Sportfest." after
  "Elternabend.".
*/
function segmentBounds(text, moments) {
  // A list: each moment on its own line owns that line.
  const lineOf = (pos) => [text.lastIndexOf('\n', pos - 1) + 1, (text.indexOf('\n', pos) + 1 || text.length + 1) - 1];
  const lines = moments.map((m) => lineOf(m.from));
  if (new Set(lines.map(([a]) => a)).size === moments.length) return lines;

  const bounds = [];
  let from = 0;

  moments.forEach((m, i) => {
    const next = moments[i + 1];
    let to = text.length;

    if (next) {
      const gap = text.slice(m.to, next.from);
      const breaks = [...gap.matchAll(/[,;.!?]\s|\n/g)];
      to = breaks.length ? m.to + breaks[breaks.length - 1].index + 1 : next.from;
    }

    bounds.push([from, to]);
    from = to;
  });

  return bounds;
}

/**
 * One draft per moment the text names, in text order, each titled from
 * its own part of the text — for a message that lists several events
 * (a school letter, a match schedule). Moments said as past or ruled
 * out are left out, as in draftEventFromText.
 */
export function draftEventsFromText(text, options = {}) {
  const source = String(text || '').trim();
  const moments = findWhen(source, options)
    .filter((c) => !c.past)
    .sort((a, b) => a.from - b.from);

  if (moments.length < 2) {
    const single = draftEventFromText(source, options);
    return single ? [single] : [];
  }

  return segmentBounds(source, moments).map(([from, to], i) => {
    const m = moments[i];
    const part = source.slice(from, to).trim();
    const offset = from + (source.slice(from, to).length - source.slice(from, to).trimStart().length);
    const local = {
      ...m,
      from: m.from - offset,
      to: m.to - offset,
      spans: m.spans.map(([a, b]) => [a - offset, b - offset]),
    };
    const location = findLocation(part);
    const titles = titleOptions(part, local, location, [local]);

    let end = m.end;
    if (!m.allDay && !end) end = new Date(m.start.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);

    return {
      title: titles[0]?.title || '',
      start: m.start.toISOString(),
      end: end ? end.toISOString() : null,
      allDay: m.allDay,
      recurrence: m.recurrence,
      location: location?.value || '',
      description: source,
      status: isTentative(part, local) ? 'tentative' : 'confirmed',
      titleSource: titles[0]?.source || 'none',
      titleOptions: titles.map((o) => o.title),
      source: { text: m.text, from: m.from, to: m.to, spans: m.spans },
      flags: [...m.flags],
      alternatives: m.alternatives,
      others: [],
    };
  });
}

/*
  Several separate events, not one event and its alternatives: every
  part has a title of its own and they differ, and the text does not
  weigh one against another ("nicht … lieber", "oder", "instead") or
  move or cancel one.
*/
const ALTERNATIVES_RX = /\b(?:oder|lieber|stattdessen|alternativ|anstatt|nicht|kein(?:e|en)?|or|instead|rather|alternatively|not|can't|cannot)\b/iu;

export function looksLikeSeveral(drafts, text) {
  if (!Array.isArray(drafts) || drafts.length < 2) return false;
  if (RESCHEDULE_RX.test(text) || CANCEL_RX.test(text)) return false;

  const titles = drafts.map((d) => d.title.toLowerCase());
  if (titles.some((t) => !t) || new Set(titles).size < titles.length) return false;

  // A list, one event per line, is several whatever its words.
  const lines = String(text || '').split(/\n/).filter((l) => l.trim());
  if (lines.length >= drafts.length && drafts.every((d) => lines.some((l) => l.includes(d.source.text)))) return true;

  return !ALTERNATIVES_RX.test(text);
}
