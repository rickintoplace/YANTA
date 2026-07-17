// ============================================================
// YANTA Semantic — main-thread orchestrator
//
// Decides WHAT gets indexed (chunking needs the Y.Docs, which live
// here); the worker owns everything heavy (model, vectors, search).
//
// Design rules, in order:
// 1. The UI must never notice us: all inference in the worker, the
//    crawl only runs in idle time, one note per idle slice.
// 2. Never pin memory we didn't own: docs loaded only for indexing
//    are unloaded afterwards (guarded — see maybeUnloadDoc).
// 3. Everything degrades silently: if the worker dies or the model
//    can't load, YANTA behaves exactly like before.
// ============================================================

import {
  state,
  isSpaceMountedNote,
} from '../core.js';

import {
  getNoteDoc,
  isNoteDocLoaded,
  unloadNoteDoc,
  drawingsTextForNote,
} from '../yjs.js';

import {
  isNoteInTrash,
} from '../trash.js';

import {
  isSystemItem,
} from '../ai/brain.js';

import {
  getSemanticConfig,
  saveSemanticConfig,
  semanticModelById,
} from './semantic-config.js';

// ---------------- status -------------------------------------------

const status = {
  state: 'off',        // off | starting | downloading | indexing | ready | error
  downloadPct: 0,
  indexedDone: 0,
  indexedTotal: 0,
  chunks: 0,
  notes: 0,
  device: null,
  error: null,
};

export function semanticStatus() {
  return { ...status };
}

export function semanticEnabled() {
  return getSemanticConfig().enabled;
}

export function semanticReady() {
  return status.state === 'ready' || status.state === 'indexing';
}

function setStatus(patch) {
  Object.assign(status, patch);

  window.dispatchEvent(new CustomEvent('yanta-semantic-status', {
    detail: semanticStatus(),
  }));
}

// ---------------- worker plumbing -----------------------------------

let worker = null;
let reqCounter = 0;
const pending = new Map();
const downloadProgress = new Map();   // file -> { loaded, total }

function ensureWorker() {
  if (worker) return worker;

  worker = new Worker(
    new URL('./semantic-worker.js', import.meta.url),
    { type: 'module' }
  );

  worker.onmessage = (e) => {
    const msg = e.data || {};

    if (msg.type === 'progress' && msg.phase === 'download') {
      downloadProgress.set(msg.file, {
        loaded: msg.loaded,
        total: msg.total,
      });

      let loaded = 0;
      let total = 0;

      for (const p of downloadProgress.values()) {
        loaded += p.loaded;
        total += p.total;
      }

      setStatus({
        state: 'downloading',
        downloadPct: total ? Math.round((loaded / total) * 100) : 0,
      });

      return;
    }

    if (msg.reqId && pending.has(msg.reqId)) {
      const { resolve, reject } = pending.get(msg.reqId);
      pending.delete(msg.reqId);

      if (msg.ok) {
        resolve(msg);
      } else {
        const err = new Error(msg.error || 'semantic worker error');
        err.deviceTried = msg.deviceTried || null;
        reject(err);
      }
    }
  };

  worker.onerror = (err) => {
    console.error('[YANTA Semantic] worker crashed', err);

    for (const { reject } of pending.values()) {
      reject(new Error('semantic worker crashed'));
    }

    pending.clear();
    setStatus({ state: 'error', error: 'Worker crashed' });
  };

  return worker;
}

function request(msg) {
  const w = ensureWorker();
  const reqId = ++reqCounter;

  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    w.postMessage({ ...msg, reqId });
  });
}

// ---------------- chunking ------------------------------------------

const CHUNK_TARGET_CHARS = 900;
const MAX_CHUNKS_PER_NOTE = 60;

function djb2(text) {
  let h = 5381;

  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }

  return (h >>> 0).toString(36) + ':' + text.length;
}

/** Collapse immediate repeats of 3..12-word phrases ("a b c a b c" → "a b c"). */
function dedupeRepeatedPhrases(s) {
  let out = String(s || '');
  let prev;

  do {
    prev = out;
    out = out.replace(/\b(\S+(?:\s+\S+){2,11})\s+\1\b/g, '$1');
  } while (out !== prev);

  return out;
}

function previewOf(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

/**
 * Title-prefixed chunks (~900 chars, split on paragraph boundaries).
 * The title on every chunk gives short paragraphs enough context to
 * embed meaningfully on their own.
 */
export function chunkNoteContent(title, body, drawingsText = '') {
  const chunks = [];
  const cleanTitle = String(title || '').trim();

  const push = (part) => {
    const text = `${cleanTitle}\n\n${part}`.trim();
    if (!text) return;

    chunks.push({
      ix: chunks.length,
      hash: djb2(text),
      text,
      preview: previewOf(part) || previewOf(cleanTitle),
    });
  };

  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  let acc = '';

  for (const p of paragraphs) {
    if (acc && acc.length + p.length > CHUNK_TARGET_CHARS) {
      push(acc);
      acc = '';
    }

    // A single huge paragraph still gets split hard.
    if (p.length > CHUNK_TARGET_CHARS * 1.6) {
      for (let i = 0; i < p.length; i += CHUNK_TARGET_CHARS) {
        push(p.slice(i, i + CHUNK_TARGET_CHARS + 100));
      }
      continue;
    }

    acc = acc ? `${acc}\n\n${p}` : p;
  }

  if (acc) push(acc);

  /*
    Drawing-Text-Hygiene: Excalidraw-Elemente liefern text +
    originalText + rawText — identischer Inhalt dreifach. Solche
    Wiederholungs-Chunks embedden zu "ähnlich zu allem" und machten
    jede Drawing-Note zum Dauertreffer. Deshalb: Phrasen-Dedupe und
    ein Mindestgehalt, sonst wird das Drawing gar nicht indexiert.
  */
  const draw = dedupeRepeatedPhrases(
    String(drawingsText || '').replace(/\s+/g, ' ').trim()
  );

  const uniqueWords = new Set(draw.toLowerCase().split(/\W+/).filter((w) => w.length > 2));

  if (draw.length >= 40 && uniqueWords.size >= 6) {
    for (let i = 0; i < draw.length && chunks.length < MAX_CHUNKS_PER_NOTE; i += CHUNK_TARGET_CHARS) {
      push(`Drawing: ${draw.slice(i, i + CHUNK_TARGET_CHARS)}`);
    }
  }

  // Empty note: index at least the title so it's findable.
  if (!chunks.length && cleanTitle) push(cleanTitle);

  return chunks.slice(0, MAX_CHUNKS_PER_NOTE);
}

// ---------------- doc access with memory hygiene --------------------

/*
  Warum System-Notes raus: AI-Sessions und Brain-Notes sind interne
  Gesprächs-/Gedächtnisdumps — semantisch "ähnlich zu allem" und als
  Related-Treffer immer falsch. Der Crawl räumt bereits indexierte
  System-Notes automatisch wieder aus dem Index.
*/
function inSystemTree(note) {
  if (isSystemItem(note)) return true;

  let folder = note.folderId ? state.folders.get(note.folderId) : null;
  const seen = new Set();

  while (folder && !seen.has(folder.id)) {
    if (isSystemItem(folder)) return true;

    seen.add(folder.id);
    folder = folder.parentId ? state.folders.get(folder.parentId) : null;
  }

  return false;
}

function indexableNote(note) {
  return note &&
    !isNoteInTrash(note) &&
    !isSpaceMountedNote(note) &&
    !inSystemTree(note);
}

function maybeUnloadDoc(noteId, wasLoaded) {
  if (wasLoaded) return;
  if (noteId === state.currentNoteId) return;
  if (state.liveShares?.has?.(noteId)) return;

  // Sync engine observers hold the doc — unloading would silently
  // detach them and edits to that note would stop syncing.
  if (window.yantaSync2?.engine?.noteObservers?.has?.(noteId)) return;

  unloadNoteDoc(noteId);
}

async function readNoteContent(noteId) {
  const wasLoaded = isNoteDocLoaded(noteId);

  const entry = getNoteDoc(noteId);
  await entry.ready;

  const body = entry.doc.getText('markdown').toString();
  const drawings = drawingsTextForNote(noteId);

  return {
    body,
    drawings,
    release: () => maybeUnloadDoc(noteId, wasLoaded),
  };
}

// ---------------- indexing ------------------------------------------

async function indexNote(noteId) {
  const note = state.notes.get(noteId);

  if (!indexableNote(note)) {
    await request({ type: 'remove-notes', noteIds: [noteId] }).catch(() => {});
    return;
  }

  const { body, drawings, release } = await readNoteContent(noteId);

  try {
    const chunks = chunkNoteContent(note.title, body, drawings);

    await request({
      type: 'sync-note',
      noteId,
      updated: note.updated || 0,
      title: note.title || '',
      chunks,
    });
  } finally {
    release();
  }
}

// ---- idle crawl ----

let crawlRunning = false;
let crawlGeneration = 0;

function idle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 4000 });
  } else {
    setTimeout(() => fn({ timeRemaining: () => 8 }), 250);
  }
}

async function crawlAll() {
  if (crawlRunning) return;

  crawlRunning = true;
  const generation = ++crawlGeneration;

  try {
    const { stamps } = await request({ type: 'stamps' });
    const stampMap = new Map(Object.entries(stamps || {}));

    const queue = [];

    for (const note of state.notes.values()) {
      if (!indexableNote(note)) continue;

      if (stampMap.get(note.id) !== (note.updated || 0)) {
        queue.push(note.id);
      }

      stampMap.delete(note.id);
    }

    // Whatever is left in the stamp map no longer exists (or moved to
    // trash / a shared space) — drop its vectors.
    const gone = [...stampMap.keys()];

    if (gone.length) {
      await request({ type: 'remove-notes', noteIds: gone }).catch(() => {});
    }

    if (!queue.length) {
      const st = await request({ type: 'status' });
      setStatus({
        state: 'ready',
        indexedDone: 0,
        indexedTotal: 0,
        chunks: st.chunks,
        notes: st.notes,
      });
      return;
    }

    setStatus({
      state: 'indexing',
      indexedDone: 0,
      indexedTotal: queue.length,
    });

    let done = 0;

    await new Promise((resolve) => {
      const step = async () => {
        if (generation !== crawlGeneration) {
          resolve();
          return;
        }

        const noteId = queue.shift();

        if (!noteId) {
          resolve();
          return;
        }

        try {
          await indexNote(noteId);
        } catch (err) {
          console.warn('[YANTA Semantic] indexing failed for note', noteId, err);
        }

        done++;
        setStatus({ indexedDone: done });

        idle(step);
      };

      idle(step);
    });

    const st = await request({ type: 'status' }).catch(() => null);

    if (generation === crawlGeneration) {
      setStatus({
        state: 'ready',
        chunks: st?.chunks ?? status.chunks,
        notes: st?.notes ?? status.notes,
        device: st?.device ?? status.device,
      });
    }
  } finally {
    crawlRunning = false;
  }
}

// ---- live updates ----

const pendingNotes = new Map();   // noteId -> timeout id
let listenersBound = false;

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;

  window.addEventListener('yanta-note-updated', (e) => {
    if (!semanticEnabled() || !semanticReady()) return;

    const noteId = e.detail?.noteId;
    if (!noteId) return;

    clearTimeout(pendingNotes.get(noteId));

    pendingNotes.set(noteId, setTimeout(() => {
      pendingNotes.delete(noteId);

      indexNote(noteId)
        .then(() => request({ type: 'status' }))
        .then((st) => setStatus({ chunks: st.chunks, notes: st.notes }))
        .catch((err) => console.warn('[YANTA Semantic] live index failed', err));
    }, 2500));
  });
}

// ---------------- lifecycle -----------------------------------------

let startPromise = null;

async function start() {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const config = getSemanticConfig();
    const model = semanticModelById(config.modelId);

    setStatus({ state: 'starting', error: null });
    bindListeners();

    const initOnce = (forceDevice = null) => request({
      type: 'init',
      model,
      forceDevice,
    });

    try {
      let st;

      try {
        st = await initOnce();
      } catch (err) {
        if (err?.deviceTried !== 'webgpu') throw err;

        /*
          WebGPU sah verfügbar aus, der Init scheiterte trotzdem
          (Treiber, Adapter-Limits). Der Kontext ist danach vergiftet
          (siehe semantic-worker.js) — frischer Worker, WASM erzwungen.
        */
        console.warn('[YANTA Semantic] WebGPU init failed — restarting worker on WASM');

        worker?.terminate();
        worker = null;
        pending.clear();
        downloadProgress.clear();

        st = await initOnce('wasm');
      }

      setStatus({
        state: 'ready',
        device: st.device,
        chunks: st.chunks,
        notes: st.notes,
        downloadPct: 100,
      });

      await crawlAll();
    } catch (err) {
      console.error('[YANTA Semantic] start failed', err);
      setStatus({ state: 'error', error: String(err?.message || err) });
      throw err;
    }
  })();

  try {
    await startPromise;
  } finally {
    if (status.state === 'error') startPromise = null;
  }
}

export async function enableSemantic() {
  saveSemanticConfig({ enabled: true });
  await start();
}

export async function disableSemantic({ wipe = false } = {}) {
  saveSemanticConfig({ enabled: false });

  if (wipe && worker) {
    await request({ type: 'wipe' }).catch(() => {});
  }

  crawlGeneration++;
  startPromise = null;

  worker?.terminate();
  worker = null;
  pending.clear();
  downloadProgress.clear();

  if (wipe && !worker) {
    // Worker already gone — delete the database directly.
    try { indexedDB.deleteDatabase('yanta-semantic'); } catch {}
  }

  setStatus({
    state: 'off',
    downloadPct: 0,
    indexedDone: 0,
    indexedTotal: 0,
    chunks: 0,
    notes: 0,
    device: null,
    error: null,
  });
}

export async function reindexSemantic() {
  if (!semanticEnabled()) return;

  await request({ type: 'wipe' });
  setStatus({ chunks: 0, notes: 0 });
  await crawlAll();
}

/** Boot hook: cheap no-op unless the user enabled the feature. */
export function bootSemanticIfEnabled() {
  if (!semanticEnabled()) return;

  idle(() => {
    start().catch(() => {});
  });
}

// ---------------- search --------------------------------------------

export async function semanticSearch(query, {
  topK = 8,
  minScore = 0.78,
} = {}) {
  const q = String(query || '').trim();

  if (!q || !semanticEnabled() || !semanticReady()) return [];

  const { results } = await request({
    type: 'search',
    query: q,
    topK,
    minScore,
  });

  return results || [];
}

/** Related notes for one note, from its stored chunk vectors. */
export async function semanticSimilarNotes(noteId, {
  topK = 4,
  minScore = 0.8,
} = {}) {
  if (!noteId || !semanticEnabled() || !semanticReady()) return [];

  const { results } = await request({
    type: 'similar-notes',
    noteId,
    topK,
    minScore,
  });

  return results || [];
}

/**
 * Note-level link suggestions for the graph. Returns null when the
 * feature is off/not ready OR the vault exceeds the worker's cap —
 * callers keep their existing (TF) behavior in that case.
 */
export async function semanticNoteLinks({
  maxPerNote = 3,
  minScore = 0.8,
} = {}) {
  if (!semanticEnabled() || !semanticReady()) return null;

  const { links } = await request({
    type: 'note-links',
    maxPerNote,
    minScore,
  });

  return links;
}

/**
 * AI tool action: lets the assistant retrieve notes by meaning.
 * Returns a hint instead of failing when the feature is disabled, so
 * the model can fall back to keyword search gracefully.
 */
export async function semanticSearchNotesAction({
  query,
  limit = 8,
} = {}) {
  const q = String(query || '').trim();

  if (!q) throw new Error('query is required');

  if (!semanticEnabled()) {
    return {
      available: false,
      hint: 'Semantic search is not enabled (Settings → Semantic search). Use search_notes instead.',
      results: [],
    };
  }

  if (!semanticReady()) {
    return {
      available: false,
      hint: 'Semantic index is still starting up. Use search_notes instead.',
      results: [],
    };
  }

  const results = await semanticSearch(q, {
    topK: Math.min(20, Math.max(1, limit)),
    minScore: 0.72,
  });

  return {
    available: true,
    results: results.map((r) => {
      const note = state.notes.get(r.noteId);

      return {
        noteId: r.noteId,
        title: note?.title || 'Untitled',
        score: Math.round(r.score * 1000) / 1000,
        preview: r.preview || '',
      };
    }).filter((r) => state.notes.has(r.noteId)),
  };
}

// Debug/automation handle (window.yantaSync2 precedent) — also the
// stable probe for tests: Vite-HMR can duplicate this module under
// ?t= URLs, but the app's live instance always owns this global.
if (typeof window !== 'undefined') {
  window.yantaSemanticDebug = {
    status: semanticStatus,
    search: (q, opts) => semanticSearch(q, opts),
    similar: (noteId, opts) => semanticSimilarNotes(noteId, opts),
    noteLinks: (opts) => semanticNoteLinks(opts),
    aiAction: (args) => semanticSearchNotesAction(args),
  };
}

/*
  Debounced variant for type-ahead callers (sidebar search): rapid
  re-renders share one in-flight request; only the newest query wins.
*/
let debounceTimer = null;
let debounceResolvers = [];

export function semanticSearchDebounced(query, options = {}) {
  return new Promise((resolve) => {
    debounceResolvers.push({ query, resolve });

    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
      const batch = debounceResolvers;
      debounceResolvers = [];

      const newest = batch[batch.length - 1];
      let results = [];

      try {
        results = await semanticSearch(newest.query, options);
      } catch {}

      for (const r of batch) {
        r.resolve(r.query === newest.query ? results : []);
      }
    }, 280);
  });
}
