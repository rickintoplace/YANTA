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
  const handler = () => fn();
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
  if (!entry) return;
  try { await entry.persistence.clearData(); } catch {}
  entry.doc.destroy();
  docs.delete(noteId);
}

// Re-export Y for callers that need it.
export { Y };
