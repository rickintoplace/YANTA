// ============================================================
// YANTA Pulse — what the user has already been told
//
// Each run starts from scratch, so without help it cannot know what it
// said yesterday: birthday-watch looks seven days ahead every morning
// and reported the same anniversary daily, in fresh words each time,
// which also slipped past the near-repeat check. Its routine text says
// "stay silent if the occasion was already reported" — but the run had
// never seen its own earlier cards.
//
// Two things go into a run:
//   - the cards in front of the user: this routine's own from the last
//     days, and other routines' from today (they overlap by nature);
//   - a marker on the data itself. Search results the cards already
//     covered — cited feed items and pages, calendar events they name —
//     carry `alreadyReported`. A marker on the item is followed far more
//     reliably than a summary in the prompt.
// ============================================================

import { stripForDisplay } from 'veriquote';

// Long enough to cover a daily routine's look-ahead week and the
// previous run of a weekly one.
export const OWN_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const OWN_MAX_CARDS = 6;

export const OTHERS_WINDOW_MS = 24 * 60 * 60 * 1000;
const OTHERS_MAX_CARDS = 5;

/** Newest first; `items` as listInboxItems() returns them. */
export function toldCards(items, routineName, now = Date.now()) {
  const age = (item) => now - Number(item.createdAt || 0);

  return {
    own: items
      .filter((item) => item.routineName === routineName && age(item) < OWN_WINDOW_MS)
      .slice(0, OWN_MAX_CARDS),
    others: items
      .filter((item) => item.routineName !== routineName && age(item) < OTHERS_WINDOW_MS)
      .slice(0, OTHERS_MAX_CARDS),
  };
}

function cardDay(card) {
  return new Date(Number(card.createdAt)).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function cardTime(card) {
  return new Date(Number(card.createdAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function plainBody(card, max) {
  return stripForDisplay(String(card.body || ''))
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** The prompt section, or '' when nothing was told. */
export function describeTold({ own, others }) {
  const sections = [];

  if (own.length) {
    sections.push([
      '# Already told the user by this routine',
      'These are your own earlier cards. Do not report the same occasion, item or suggestion again, and leave out search results marked `alreadyReported`. Mention one again only if something about it changed — then say what changed — or if the routine above explicitly asks for a second reminder. If nothing new is left, stay silent.',
      ...own.map((card) => `- ${cardDay(card)} — "${card.title}": ${plainBody(card, 600)}`),
    ].join('\n'));
  }

  if (others.length) {
    sections.push([
      '# Already told the user today (by other routines)',
      'Do not repeat these points, and leave out search results marked `alreadyReported`. Mention one only if something about it changed, and then say what changed. If nothing new is left after removing them, stay silent.',
      ...others.map((card) => `- ${card.routineName}, ${cardTime(card)} — "${card.title}": ${plainBody(card, 500)}`),
    ].join('\n'));
  }

  return sections.join('\n\n');
}

function words(text) {
  return String(text || '')
    .normalize('NFC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
}

/*
  An event counts as mentioned when every word of its title appears as a
  whole word in the card — "Großeltern steinerne Hochzeit" in "Fr 06.11. –
  Großeltern: steinerne Hochzeit (65 Jahre)". Whole words, so a card
  about "Zahnarzttermin" does not claim an event called "Zahnarzt".
*/
function mentions(cardWords, title) {
  const titleWords = words(title).filter((w) => w.length >= 3 || /\d/.test(w));
  return titleWords.length > 0 && titleWords.every((w) => cardWords.has(w));
}

function localDate(ms) {
  const d = new Date(Number(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * What the cards covered, for marking search results. Labels say who
 * told it and when, which is what the run needs to judge "changed since".
 */
export function toldIndex({ own, others }) {
  const keys = new Map();
  const cards = [];

  for (const card of [...own, ...others]) {
    const label = `${card.routineName}, ${localDate(card.createdAt)}`;
    const body = String(card.body || '');

    for (const source of card.sources || []) {
      if (!body.includes(`[${source.n}]`)) continue;
      if (source.id && !keys.has(`id:${source.id}`)) keys.set(`id:${source.id}`, label);
      if (source.url && !keys.has(`url:${source.url}`)) keys.set(`url:${source.url}`, label);
    }

    cards.push({ label, words: new Set(words(`${card.title}\n${stripForDisplay(body)}`)) });
  }

  return { keys, cards, size: keys.size + cards.length };
}

export function markAlreadyReported(name, result, told) {
  if (!told?.size || !result || typeof result !== 'object') return result;

  const mark = (item) => {
    const by = told.keys.get(`id:${item?.id}`) || told.keys.get(`url:${item?.url}`);
    return by ? { ...item, alreadyReported: by } : item;
  };

  if (name === 'rss_search_items' && Array.isArray(result.items)) {
    return { ...result, items: result.items.map(mark) };
  }

  if (name === 'web_search' && Array.isArray(result.results)) {
    return { ...result, results: result.results.map(mark) };
  }

  if (name === 'search_events' && Array.isArray(result.events)) {
    return {
      ...result,
      events: result.events.map((event) => {
        const by = told.cards.find((card) => mentions(card.words, event?.title));
        return by ? { ...event, alreadyReported: by.label } : event;
      }),
    };
  }

  return result;
}

/*
  Calendar events a run saw, and whether an earlier card already named
  them. Collected from search_events results after marking.
*/
export function noteSeenEvents(seen, name, result) {
  if (name !== 'search_events' || !Array.isArray(result?.events)) return;
  for (const event of result.events) {
    const title = String(event?.title || '').trim();
    if (!title) continue;
    // Reported if any sighting carried the mark.
    seen.set(title, !!seen.get(title) || !!event.alreadyReported);
  }
}

/**
 * A card that only talks about events earlier cards already reported
 * says nothing new, however it is worded. Returns the titles it repeats
 * when that is all it does, else null. Words are compared whole, like
 * the marking itself.
 */
export function onlyRepeatsEvents(card, seen) {
  if (!seen?.size) return null;

  const cardWords = new Set(words(`${card.title}\n${stripForDisplay(String(card.body || ''))}`));
  const mentioned = [...seen.entries()].filter(([title]) => mentions(cardWords, title));
  if (!mentioned.length) return null;

  return mentioned.every(([, reported]) => reported) ? mentioned.map(([title]) => title) : null;
}
