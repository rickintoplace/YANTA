// ============================================================
// YANTA Semantic — "Related notes" under the note preview
//
// Sits right below the backlinks section and reuses its visual
// language. schedulePreview() re-renders on every keystroke, so
// this module renders instantly from a per-note cache and only
// refreshes the cache through the worker on a slow throttle —
// no flicker, no per-keystroke inference.
// ============================================================

import {
  $,
  el,
  state,
} from '../core.js';

import {
  openNote,
} from '../notes.js';

import {
  semanticEnabled,
  semanticReady,
  semanticSimilarNotes,
} from './semantic-index.js';

const CACHE = new Map();          // noteId -> { results, fetchedAt }
const REFRESH_MS = 20000;
const inFlight = new Set();

function renderSection(noteId, results) {
  const pv = $('preview');
  if (!pv || state.currentNoteId !== noteId) return;

  pv.querySelector('.semantic-related')?.remove();

  const rows = (results || [])
    .map((r) => ({ note: state.notes.get(r.noteId), preview: r.preview }))
    .filter((r) => r.note && r.note.trashed !== true);

  if (!rows.length) return;

  const wrap = el('div', {
    class: 'backlinks semantic-related',
    contenteditable: 'false',
  });

  wrap.append(
    el('div', { class: 'backlinks-title' },
      'Related notes',
      el('span', { class: 'badge' }, String(rows.length))
    )
  );

  for (const { note, preview } of rows) {
    const item = el('div', {
      class: 'backlink',
      onclick: () => openNote(note.id),
    });

    item.append(el('div', { class: 'bl-title' }, note.title || 'Untitled'));

    if (preview) {
      const ctx = el('div', { class: 'bl-context' });
      ctx.textContent = preview.length > 200 ? preview.slice(0, 200) + '…' : preview;
      item.append(ctx);
    }

    wrap.append(item);
  }

  pv.append(wrap);
}

/** Called from schedulePreview — must be cheap on the hot path. */
export function renderRelatedNotes(noteId) {
  if (!noteId || !semanticEnabled() || !semanticReady()) return;

  const cached = CACHE.get(noteId);

  if (cached) {
    renderSection(noteId, cached.results);
  }

  const fresh = cached && Date.now() - cached.fetchedAt < REFRESH_MS;

  if (fresh || inFlight.has(noteId)) return;

  inFlight.add(noteId);

  semanticSimilarNotes(noteId, { topK: 4, minScore: 0.8 })
    .then((results) => {
      CACHE.set(noteId, {
        results,
        fetchedAt: Date.now(),
      });

      renderSection(noteId, results);
    })
    .catch(() => {})
    .finally(() => inFlight.delete(noteId));
}
