// ============================================================
// YANTA — Yjs document registry.
// One Y.Doc per note. Markdown notes use a Y.Text named 'markdown'.
// Shopping-list notes use a Y.Array named 'items'.
// Persistence: y-indexeddb (per-doc keyed by 'yanta-note-<id>').
// ============================================================

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { state, store } from './core.js';

const docs = new Map();       // noteId -> { doc, persistence, ready }
const subscribers = new Map();// noteId -> Set<callback>

const KEY_PREFIX = 'yanta-note-';

export function docKey(id) { return KEY_PREFIX + id; }

// Get or create the Y.Doc + IndexedDB persistence for a note.
export function getNoteDoc(noteId) {
  if (docs.has(noteId)) return docs.get(noteId);
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docKey(noteId), doc);
  const ready = new Promise((res) => persistence.once('synced', () => res()));
  const entry = { doc, persistence, ready };
  docs.set(noteId, entry);
  return entry;
}

export function getMarkdownText(noteId) {
  return getNoteDoc(noteId).doc.getText('markdown');
}

export function getListArray(noteId) {
  return getNoteDoc(noteId).doc.getArray('items');
}

// Convenience: full markdown as JS string.
export function noteMarkdown(noteId) {
  return getMarkdownText(noteId).toString();
}

// Subscribe to any change in a note's Y.Doc (debounced upstream).
export function onDocChange(noteId, fn) {
  const { doc } = getNoteDoc(noteId);

  const handler = (update, origin) => fn(update, origin);

  doc.on('update', handler);

  if (!subscribers.has(noteId)) subscribers.set(noteId, new Set());
  subscribers.get(noteId).add(handler);

  return () => {
    doc.off('update', handler);
    subscribers.get(noteId)?.delete(handler);
  };
}

// Migration: if a note has a legacy `body` string and the Y.Text is empty,
// seed the Y.Text from the body. Called once per note on first access.
export async function migrateBodyIfNeeded(note) {
  if (!note || note.bodyMigrated) return;
  const entry = getNoteDoc(note.id);
  await entry.ready;
  const ytext = entry.doc.getText('markdown');
  if (ytext.length === 0 && note.body) {
    ytext.insert(0, note.body);
  }
  // Strip legacy body from metadata going forward.
  note.bodyMigrated = true;
  delete note.body;
  await store.notes.put(note);
}

// Encode the current state of a note's doc as a binary update (for snapshots).
export function encodeNoteState(noteId) {
  return Y.encodeStateAsUpdate(getNoteDoc(noteId).doc);
}

// Apply a binary Yjs update to a note's doc (used by sync-folder import).
export function applyNoteUpdate(noteId, update) {
  Y.applyUpdate(getNoteDoc(noteId).doc, update, 'sync-folder');
}

// Compute the state vector of a note's doc (used to request only deltas).
export function encodeNoteStateVector(noteId) {
  return Y.encodeStateVector(getNoteDoc(noteId).doc);
}

// Encode just the delta between a state vector and current state.
export function encodeNoteUpdateFrom(noteId, stateVector) {
  return Y.encodeStateAsUpdate(getNoteDoc(noteId).doc, stateVector);
}

// Release a doc when a note is deleted.
export async function destroyNoteDoc(noteId) {
  const entry = docs.get(noteId);

  // If the doc is open in memory, clear its y-indexeddb data directly.
  if (entry) {
    try {
      await entry.persistence.clearData();
    } catch {}

    entry.doc.destroy();
    docs.delete(noteId);
    return;
  }

  // If the doc was never opened in this session, still clear its
  // y-indexeddb database by opening a temporary doc/persistence pair.
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docKey(noteId), doc);

  try {
    await new Promise((res) => persistence.once('synced', res));
    await persistence.clearData();
  } catch {
    // ignore cleanup errors
  } finally {
    doc.destroy();
  }
}

// ---------------- Excalidraw drawings inside note Y.Doc ---------

export function getDrawingsMap(noteId) {
  return getNoteDoc(noteId).doc.getMap('drawings');
}

function cloneJson(v) {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v ?? null));
  }
}

// YANTA Drawing extension fields.
// These are not native Excalidraw scene fields, but they belong to a YANTA drawing.
// Important: setDrawing() must preserve these fields on every scene save.
const DRAWING_EXTENSION_KEYS = [
  'slides',
  'slideDecks',
  'defaultSlideDeckId',
  'presentationSettings',
];

function drawingExtensionPatch(raw = {}) {
  const out = {};
  const yanta = raw?.yanta && typeof raw.yanta === 'object'
    ? raw.yanta
    : {};

  for (const key of DRAWING_EXTENSION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw || {}, key)) {
      out[key] = cloneJson(raw[key]);
    } else if (Object.prototype.hasOwnProperty.call(yanta, key)) {
      out[key] = cloneJson(yanta[key]);
    }
  }

  return out;
}

function preserveDrawingExtensionFields(scene = {}, prev = {}) {
  const out = {};

  for (const key of DRAWING_EXTENSION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(scene || {}, key)) {
      out[key] = cloneJson(scene[key]);
    } else if (Object.prototype.hasOwnProperty.call(prev || {}, key)) {
      out[key] = cloneJson(prev[key]);
    }
  }

  return out;
}

function noteIdFromYantaLink(link = '') {
  const s = String(link || '').trim();

  if (s.startsWith('yanta-note://')) {
    return s.slice('yanta-note://'.length);
  }

  if (s.startsWith('#note=')) {
    try {
      return decodeURIComponent(s.slice('#note='.length));
    } catch {
      return s.slice('#note='.length);
    }
  }

  return null;
}

function wikiTargetFromDrawingElement(el) {
  const custom = el?.customData?.yanta?.wikilink;

  if (custom?.noteId && state.notes.has(custom.noteId)) {
    return state.notes.get(custom.noteId)?.title || custom.target || '';
  }

  if (custom?.target) {
    return custom.target;
  }

  const linkId = noteIdFromYantaLink(el?.link);

  if (linkId && state.notes.has(linkId)) {
    return state.notes.get(linkId)?.title || '';
  }

  return '';
}

function normalizeCanvasSize(raw = {}) {
  const w = parseInt(raw.width ?? raw.w ?? raw.canvasWidth ?? 760, 10);
  const h = parseInt(raw.height ?? raw.h ?? raw.canvasHeight ?? 420, 10);

  return {
    width: Math.max(240, Math.min(5000, Number.isFinite(w) ? w : 760)),
    height: Math.max(180, Math.min(5000, Number.isFinite(h) ? h : 420)),
  };
}

export function normalizeDrawingScene(raw = {}) {
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  const appState = raw.appState && typeof raw.appState === 'object' ? raw.appState : {};
  const files = raw.files && typeof raw.files === 'object' ? raw.files : {};

  return {
    elements: cloneJson(elements),
    appState: cloneJson(appState),
    files: cloneJson(files),
    canvas: normalizeCanvasSize(raw.canvas || raw.yanta?.canvas || raw),
    text: extractTextFromDrawingScene({ elements }),

    // Preserve YANTA-specific drawing extensions when importing/loading.
    ...drawingExtensionPatch(raw),
  };
}

export function extractTextFromDrawingScene(scene = {}) {
  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  const chunks = [];

  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;

    const wikiTarget = wikiTargetFromDrawingElement(el);
    if (wikiTarget) chunks.push(wikiTarget, `[[${wikiTarget}]]`);

    if (typeof el.text === 'string') chunks.push(el.text);
    if (typeof el.originalText === 'string') chunks.push(el.originalText);
    if (typeof el.rawText === 'string') chunks.push(el.rawText);
    if (typeof el.link === 'string') chunks.push(el.link);

    const customTarget = el.customData?.yanta?.wikilink?.target;
    if (typeof customTarget === 'string') chunks.push(customTarget);
  }

  return chunks
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getDrawing(noteId, drawingId) {
  if (!noteId || !drawingId) return null;

  const d = getDrawingsMap(noteId).get(drawingId);
  return d ? cloneJson(d) : null;
}

/**
 * Note-übergreifende Drawing-Auflösung.
 *
 * Wichtig für:
 * - Note A enthält das Drawing.
 * - Note B referenziert nur draw://<id>.
 */
export function findDrawing(drawingId, preferredNoteId = state.currentNoteId) {
  if (!drawingId) return null;

  const ids = [];

  if (preferredNoteId) ids.push(preferredNoteId);

  for (const noteId of state.notes.keys()) {
    if (!ids.includes(noteId)) ids.push(noteId);
  }

  for (const noteId of ids) {
    try {
      const d = getDrawing(noteId, drawingId);
      if (d) return { noteId, drawingId, drawing: d };
    } catch {}
  }

  return null;
}

export function listDrawingsForNote(noteId) {
  const map = getDrawingsMap(noteId);

  return [...map.values()]
    .filter(Boolean)
    .map((d) => cloneJson(d))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export function listAllDrawings() {
  const out = [];

  for (const note of state.notes.values()) {
    try {
      for (const d of listDrawingsForNote(note.id)) {
        out.push({
          ...d,
          noteId: note.id,
          noteTitle: note.title || 'Untitled',
        });
      }
    } catch {}
  }

  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export function setDrawing(noteId, drawingId, scene, origin = 'draw') {
  if (!noteId || !drawingId) return;

  const { doc } = getNoteDoc(noteId);
  const map = doc.getMap('drawings');
  const prev = map.get(drawingId) || {};

  const normalized = normalizeDrawingScene({
    ...prev,
    ...scene,
    canvas: scene?.canvas || prev.canvas || scene,
  });

  const extensions = preserveDrawingExtensionFields(scene, prev);

  doc.transact(() => {
    map.set(drawingId, {
      ...cloneJson(prev),

      id: drawingId,
      title: scene?.title ?? prev.title ?? 'Drawing',
      version: 2,
      updated: Date.now(),

      ...normalized,

      // Critical: scene saves from Excalidraw must not delete slides.
      ...extensions,
    });
  }, origin);
}

export function updateDrawingMeta(noteId, drawingId, patch = {}, origin = 'draw-meta') {
  if (!noteId || !drawingId) return;

  const { doc } = getNoteDoc(noteId);
  const map = doc.getMap('drawings');
  const prev = map.get(drawingId);

  if (!prev) return;

  const next = {
    ...cloneJson(prev),
    ...cloneJson(patch),
    updated: Date.now(),
  };

  if (patch.canvas || patch.width || patch.height) {
    next.canvas = normalizeCanvasSize(patch.canvas || {
      width: patch.width ?? prev.canvas?.width,
      height: patch.height ?? prev.canvas?.height,
    });
  }

  doc.transact(() => {
    map.set(drawingId, next);
  }, origin);
}

export function deleteDrawing(noteId, drawingId, origin = 'draw-delete') {
  if (!noteId || !drawingId) return;

  const { doc } = getNoteDoc(noteId);
  const map = doc.getMap('drawings');

  doc.transact(() => {
    map.delete(drawingId);
  }, origin);
}

export function drawingsTextForNote(noteId) {
  try {
    return listDrawingsForNote(noteId)
      .map((d) => [d.title || '', d.text || ''].join(' '))
      .join(' ')
      .toLowerCase();
  } catch {
    return '';
  }
}

function noteIdFromDrawingLink(link = '') {
  const s = String(link || '').trim();

  if (s.startsWith('yanta-note://')) {
    return s.slice('yanta-note://'.length);
  }

  if (s.startsWith('#note=')) {
    try {
      return decodeURIComponent(s.slice('#note='.length));
    } catch {
      return s.slice('#note='.length);
    }
  }

  return null;
}

function addWikiTargetsFromText(text, out, seen) {
  const re = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;
  let m;

  while ((m = re.exec(String(text || ''))) !== null) {
    const target = m[1].trim();
    const key = target.toLowerCase();

    if (target && !seen.has(key)) {
      seen.add(key);
      out.push(target);
    }
  }
}

function drawingElementTextSources(el) {
  const sources = [];

  // Aktuelle Felder bevorzugen.
  if (typeof el?.text === 'string') sources.push(el.text);
  if (typeof el?.rawText === 'string' && el.rawText !== el.text) sources.push(el.rawText);

  // originalText nur als Fallback, weil es sonst alte Wikilinks konservieren kann.
  if (!sources.length && typeof el?.originalText === 'string') {
    sources.push(el.originalText);
  }

  return sources;
}

export function drawingWikilinksForNote(noteId) {
  const out = [];
  const seen = new Set();

  const add = (target) => {
    const clean = String(target || '').trim();
    const key = clean.toLowerCase();

    if (clean && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  };

  try {
    for (const d of listDrawingsForNote(noteId)) {
      for (const el of d.elements || []) {
        if (!el || typeof el !== 'object' || el.isDeleted) continue;

        // Aktiver Excalidraw-Link zählt.
        const linkNoteId = noteIdFromDrawingLink(el.link);
        if (linkNoteId && state.notes.has(linkNoteId)) {
          add(state.notes.get(linkNoteId)?.title || 'Untitled');
        }

        // Aktuelle Textfelder zählen.
        for (const text of drawingElementTextSources(el)) {
          addWikiTargetsFromText(text, out, seen);
        }

        // customData NICHT blind zählen.
      }
    }
  } catch {}

  return out;
}

// ---------------- Citations inside note Y.Doc -------------------

export function getCitationsMap(noteId) {
  return getNoteDoc(noteId).doc.getMap('citations');
}

export function setCitation(noteId, key, citation, origin = 'citation') {
  if (!noteId || !key || !citation) return;

  const { doc } = getNoteDoc(noteId);
  const map = doc.getMap('citations');

  doc.transact(() => {
    map.set(String(key), {
      ...cloneJson(citation),
      key: String(key),
      updated: Date.now(),
    });
  }, origin);
}

export function getCitation(noteId, key) {
  if (!noteId || !key) return null;

  const c = getCitationsMap(noteId).get(String(key));
  return c ? cloneJson(c) : null;
}

export function deleteCitation(noteId, key, origin = 'citation-delete') {
  if (!noteId || !key) return;

  const { doc } = getNoteDoc(noteId);
  const map = doc.getMap('citations');

  doc.transact(() => {
    map.delete(String(key));
  }, origin);
}

export function listCitationsForNote(noteId) {
  try {
    return [...getCitationsMap(noteId).values()]
      .filter(Boolean)
      .map((c) => cloneJson(c))
      .sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')));
  } catch {
    return [];
  }
}

export function citationsTextForNote(noteId) {
  try {
    return listCitationsForNote(noteId)
      .map((c) => {
        const csl = c.csl || {};
        const authors = (csl.author || [])
          .map((a) => [a.family, a.given, a.literal].filter(Boolean).join(' '))
          .join(' ');

        return [
          c.key,
          c.formatted || '',
          csl.title || '',
          csl.DOI || '',
          csl.URL || '',
          csl.ISBN || '',
          csl['container-title'] || '',
          csl.publisher || '',
          authors,
        ].join(' ');
      })
      .join(' ')
      .toLowerCase();
  } catch {
    return '';
  }
}

// Re-export Y for callers that need it.
export { Y };

export function vaultHeadPath(deviceId) {
  return joinRemotePath(
    SYNC_ROOT,
    'vault',
    'heads',
    `${deviceId}.yhead.enc`
  );
}

export function vaultHeadsPrefix() {
  return joinRemotePath(SYNC_ROOT, 'vault', 'heads') + '/';
}

export async function docHeadPath(nameKey, noteId, deviceId) {
  const id = await remoteDocId(nameKey, noteId);

  return joinRemotePath(
    SYNC_ROOT,
    'docs',
    id,
    'heads',
    `${deviceId}.yhead.enc`
  );
}

export async function docHeadsPrefix(nameKey, noteId) {
  const id = await remoteDocId(nameKey, noteId);

  return joinRemotePath(SYNC_ROOT, 'docs', id, 'heads') + '/';
}