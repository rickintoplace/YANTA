// ============================================================
// YANTA — Semantic link suggestions for the graph (pure module).
//
// TF vectors + cosine similarity, but with an inverted-index
// candidate stage so large vaults never pay the O(n²) all-pairs
// cost: only note pairs that actually share at least one
// discriminative token are compared.
// ============================================================

const MIN_SCORE = 0.23;
const MAX_LINKS_PER_NOTE = 3;
const MAX_BODY_CHARS = 16000;
const ALL_PAIRS_LIMIT = 150;      // below this, brute force is cheaper
const MAX_POSTING_LENGTH = 40;    // tokens shared by more notes are too generic

const STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'onto', 'over',
  'under', 'then', 'than', 'when', 'where', 'what', 'which', 'while', 'about',
  'also', 'because', 'there', 'their', 'these', 'those', 'they', 'them', 'were',
  'been', 'being', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
  'will', 'may', 'might', 'must', 'not', 'are', 'was', 'is', 'it', 'as', 'at',
  'by', 'on', 'in', 'of', 'to', 'a', 'an', 'or', 'if', 'we', 'you', 'i',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem',
  'einen', 'und', 'oder', 'aber', 'auch', 'mit', 'für', 'von', 'aus', 'auf',
  'über', 'unter', 'nach', 'vor', 'bei', 'ist', 'sind', 'war', 'waren', 'sein',
  'hat', 'haben', 'hatte', 'hatten', 'wird', 'werden', 'wurde', 'wurden',
  'kann', 'könnte', 'soll', 'sollte', 'muss', 'müssen', 'nicht', 'nur', 'wie',
  'was', 'wenn', 'dann', 'weil', 'dass', 'dies', 'diese', 'dieser', 'dieses',
  'diesen', 'als', 'im', 'am', 'an', 'zu', 'in', 'es', 'ich', 'du', 'wir',
  'sie', 'er',
  // Markdown / note-system noise
  'http', 'https', 'www', 'com', 'org', 'net', 'markdown', 'yanta', 'img',
  'png', 'jpg', 'jpeg', 'webp', 'svg', 'todo', 'done',
]);

function normalize(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function stem(tok) {
  if (tok.length > 7 && tok.endsWith('ungen')) return tok.slice(0, -5);
  if (tok.length > 6 && tok.endsWith('tion')) return tok.slice(0, -4);
  if (tok.length > 6 && tok.endsWith('ing')) return tok.slice(0, -3);
  if (tok.length > 6 && tok.endsWith('lich')) return tok.slice(0, -4);
  if (tok.length > 5 && tok.endsWith('en')) return tok.slice(0, -2);
  if (tok.length > 5 && tok.endsWith('er')) return tok.slice(0, -2);
  if (tok.length > 5 && tok.endsWith('es')) return tok.slice(0, -2);
  if (tok.length > 5 && tok.endsWith('s')) return tok.slice(0, -1);
  return tok;
}

function tokenize(text) {
  const norm = normalize(text)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/yanta-img:\/\/[a-z0-9]+/gi, ' ')
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, ' ');
  const matches = norm.match(/[\p{L}\p{N}]{3,}/gu) || [];
  const out = [];
  for (const tok of matches) {
    if (STOPWORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue;
    out.push(stem(tok));
  }
  return out;
}

function vectorFor(note, getBody) {
  let body = '';
  try {
    body = getBody(note.id) || '';
  } catch {
    body = '';
  }
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS);
  }
  const title = note.title || '';
  const tags = (note.tags || []).join(' ');
  // Title/tags carry 3x weight over body content.
  const text = [title, title, title, tags, tags, tags, body].join('\n');
  const vec = new Map();
  for (const tok of tokenize(text)) {
    vec.set(tok, Math.min(10, (vec.get(tok) || 0) + 1));
  }
  let norm = 0;
  for (const v of vec.values()) {
    norm += v * v;
  }
  return { vec, norm: Math.sqrt(norm) || 1 };
}

function cosine(a, b) {
  let small = a.vec;
  let large = b.vec;
  if (large.size < small.size) {
    small = b.vec;
    large = a.vec;
  }
  let dot = 0;
  for (const [tok, av] of small) {
    const bv = large.get(tok);
    if (bv) dot += av * bv;
  }
  return dot / (a.norm * b.norm);
}

function layoutParams(score) {
  const closeness = Math.max(0, Math.min(1, (score - MIN_SCORE) / (0.62 - MIN_SCORE)));
  return {
    closeness,
    distance: 185 - closeness * (185 - 44),
  };
}

/**
 * Compute semantic suggestion links between notes.
 *
 * @param {Array} notes    note metadata objects ({ id, title, tags })
 * @param {Function} getBody  (noteId) => markdown string
 * @param {Set<string>} excludePairs  "min::max" note-gid pairs (explicit wikilinks)
 * @param {Function} pairKeyOf  (idA, idB) => canonical pair key
 * @returns Array<{ aId, bId, score, distance, closeness }>
 */
export function computeSemanticLinks(notes, getBody, excludePairs, pairKeyOf) {
  if (notes.length < 2) return [];

  const prepared = [];
  for (const note of notes) {
    const vector = vectorFor(note, getBody);
    if (vector.vec.size < 4) continue;
    prepared.push({ note, vector });
  }
  if (prepared.length < 2) return [];

  // --- Candidate pair generation -----------------------------------
  const candidatePairs = new Set();
  if (prepared.length <= ALL_PAIRS_LIMIT) {
    for (let i = 0; i < prepared.length; i++) {
      for (let j = i + 1; j < prepared.length; j++) {
        candidatePairs.add(i * 100000 + j);
      }
    }
  } else {
    // Inverted index: only compare notes that share a discriminative token.
    const postings = new Map();
    for (let i = 0; i < prepared.length; i++) {
      for (const tok of prepared[i].vector.vec.keys()) {
        let list = postings.get(tok);
        if (!list) {
          list = [];
          postings.set(tok, list);
        }
        if (list.length <= MAX_POSTING_LENGTH) {
          list.push(i);
        }
      }
    }
    for (const list of postings.values()) {
      if (list.length < 2 || list.length > MAX_POSTING_LENGTH) continue;
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const i = Math.min(list[x], list[y]);
          const j = Math.max(list[x], list[y]);
          candidatePairs.add(i * 100000 + j);
        }
      }
    }
  }

  // --- Scoring -------------------------------------------------------
  const scored = [];
  for (const packed of candidatePairs) {
    const i = Math.floor(packed / 100000);
    const j = packed % 100000;
    const a = prepared[i];
    const b = prepared[j];
    if (excludePairs?.has(pairKeyOf(a.note.id, b.note.id))) continue;
    const score = cosine(a.vector, b.vector);
    if (score >= MIN_SCORE) {
      scored.push({ a, b, score });
    }
  }
  scored.sort((x, y) => y.score - x.score);

  // --- Cap links per note and globally --------------------------------
  const countByNote = new Map();
  const maxGlobal = Math.max(12, notes.length * 2);
  const out = [];
  for (const c of scored) {
    if (out.length >= maxGlobal) break;
    const ca = countByNote.get(c.a.note.id) || 0;
    const cb = countByNote.get(c.b.note.id) || 0;
    if (ca >= MAX_LINKS_PER_NOTE || cb >= MAX_LINKS_PER_NOTE) continue;
    const layout = layoutParams(c.score);
    out.push({
      aId: c.a.note.id,
      bId: c.b.note.id,
      score: c.score,
      distance: layout.distance,
      closeness: layout.closeness,
    });
    countByNote.set(c.a.note.id, ca + 1);
    countByNote.set(c.b.note.id, cb + 1);
  }
  return out;
}