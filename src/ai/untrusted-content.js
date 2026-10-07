// ============================================================
// YANTA AI — policy for runs that have read untrusted content
//
// Web pages, feed items and other people's messages can carry
// instructions ("prompt injection"). A model that has read them must
// not be able to turn them into actions the user did not ask for:
//
//   - change or delete existing data,
//   - send private data out (a URL it builds itself, with notes appended),
//   - reach a third party (subscribing to an attacker's feed fetches it).
//
// After untrusted input, a run may still read, and still *create* new
// things — a digest note is the whole point of most routines — but
// everything else needs the user: Pulse parks it with pulse_propose,
// the chat asks before running it.
// ============================================================

/** Tools whose results are written by someone other than the user. */
export const UNTRUSTED_INPUT_TOOLS = Object.freeze([
  'web_search',
  'web_read',
  'rss_search_items',
  'rss_read_item',
  'chat_read_recent_messages',
  'chat_search_messages',
  // Returns what the feed says about itself (title, items).
  'add_rss_source',
]);

/**
 * Writes that only add something new and send nothing out. Everything
 * else with risk write/destructive is gated once the run is tainted.
 */
export const ADDITIVE_WRITE_TOOLS = Object.freeze([
  'create_note',
  'create_drawing_note',
  'create_excalidraw_slideshow',
  'create_event',
  'rss_save_item_as_note',
  'rss_mark_item_read',
]);

/** Read tools that make an outbound request to a URL the model chose. */
export const OUTBOUND_URL_TOOLS = Object.freeze({
  web_read: 'url',
});

const URL_RE = /https?:\/\/[^\s"'<>\\)\]}`]+/gi;

function normalizeUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** Every http(s) URL in a value (strings, or anything JSON-serializable). */
export function collectUrls(value, into = new Set()) {
  let text = '';

  try {
    text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  } catch {
    return into;
  }

  for (const match of text.matchAll(URL_RE)) {
    const url = normalizeUrl(match[0].replace(/[.,;:!?]+$/, ''));
    if (url) into.add(url);
  }

  return into;
}

export function createTaintTracker(seedTexts = []) {
  const tracker = {
    tainted: false,
    taintedBy: new Set(),
    knownUrls: new Set(),
  };

  for (const text of seedTexts) collectUrls(text, tracker.knownUrls);

  return tracker;
}

/** Feed a finished tool call into the tracker. */
export function noteToolResult(tracker, name, result) {
  collectUrls(result, tracker.knownUrls);

  if (UNTRUSTED_INPUT_TOOLS.includes(name)) {
    tracker.tainted = true;
    tracker.taintedBy.add(name);
  }
}

/**
 * Should this call need the user? Returns null when it may run, else a
 * short reason. `risk` is the registry risk of the tool.
 */
export function untrustedContentGate(tracker, { name, args = {}, risk = 'read' } = {}) {
  if (!tracker?.tainted) return null;

  const urlArg = OUTBOUND_URL_TOOLS[name];

  if (urlArg) {
    const url = normalizeUrl(args?.[urlArg]);

    // A link that was in the material (an article's own URL) carries
    // nothing private; a URL the model composed itself might.
    if (url && tracker.knownUrls.has(url)) return null;

    return 'opens a web address that did not come from your request or from content already read';
  }

  if (risk === 'read') return null;

  if (ADDITIVE_WRITE_TOOLS.includes(name)) return null;

  return risk === 'destructive'
    ? 'deletes data after reading untrusted content'
    : 'changes existing data after reading untrusted content';
}
