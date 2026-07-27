// ============================================================
// YANTA — Shared text-search primitives.
//
// One scoring vocabulary for every "type it and find it" surface
// (command palette, chat search). Two scorers, deliberately kept apart:
//
//   scoreFuzzy  short labels — titles, commands, folder names.
//               Subsequence matching, so "opdash" finds "Open dashboard".
//   scoreText   long bodies — note markdown, chat messages.
//               Token matching, because a subsequence match against 10 KB
//               of prose matches everything and therefore means nothing.
//
// Every function is pure and stateless; callers own their indexes.
// ============================================================

const MAX_TOKENS = 8;

/**
 * Split a raw query into lowercased tokens.
 * Capped so a pasted paragraph cannot turn one keystroke into 500 scans.
 */
export function tokenizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
}

/**
 * Subsequence score for SHORT text. Consecutive hits are worth more than
 * scattered ones, and shorter candidates win ties. Returns 0 for "no match".
 *
 * `text` is lowercased internally; `query` must already be lowercase.
 */
export function scoreFuzzy(text, query) {
  if (!query) return 1;

  const t = String(text || '').toLowerCase();

  let q = 0;
  let score = 0;
  let streak = 0;

  for (let i = 0; i < t.length && q < query.length; i++) {
    if (t[i] === query[q]) {
      q++;
      score += 1 + streak;
      streak += 1;
    } else {
      streak = 0;
    }
  }

  if (q < query.length) return 0;

  return score + 10 / (1 + t.length);
}

/**
 * Token score for LONG text. Every token must occur (AND semantics), with
 * bonuses for the full phrase, word-boundary hits and matches at the start.
 * Returns 0 for "no match".
 *
 * Both `text` and `query` must already be lowercased — callers keep
 * pre-lowercased indexes, and lowercasing 10 KB per keystroke is not free.
 */
export function scoreText(text, query, tokens = tokenizeQuery(query)) {
  if (!query || !text) return 0;

  let score = 0;

  if (text.includes(query)) score += 1000;

  for (const token of tokens) {
    const idx = text.indexOf(token);

    if (idx < 0) return 0;

    score += 40;

    const before = idx === 0 ? ' ' : text[idx - 1];

    if (!before || /[\s.,;:!?()[\]{}"'`*_/#>-]/.test(before)) {
      score += 80;
    }

    if (idx === 0) score += 30;
  }

  return score;
}

/**
 * Excerpt of `body` around the first hit, ellipsed on both sides.
 * Case is preserved — only the search is case-insensitive.
 *
 * `before` sets how much leading context to keep. Give a single-line row
 * (a palette result) a small value so the match itself stays visible once
 * the text is clipped; a wrapping result card can afford more.
 */
export function snippetFor(body = '', query = '', { before = 90, after = 130 } = {}) {
  const raw = String(body || '');
  const lower = raw.toLowerCase();
  const q = String(query || '').toLowerCase();

  let idx = q ? lower.indexOf(q) : -1;

  if (idx < 0) {
    const token = tokenizeQuery(query)[0] || '';
    idx = token ? lower.indexOf(token) : 0;
  }

  if (idx < 0) idx = 0;

  const start = Math.max(0, idx - before);
  const end = Math.min(raw.length, idx + q.length + after);

  return `${start > 0 ? '…' : ''}${raw.slice(start, end)}${end < raw.length ? '…' : ''}`;
}
