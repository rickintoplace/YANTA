// ============================================================
// YANTA — Empty draft notes
//
// Eine frisch erstellte Note ist ein Entwurf, solange der User nichts
// beigetragen hat: Standardtitel, kein Text, keine Zeichnung, keine Tags.
// Verlässt er sie in diesem Zustand, wird sie still verworfen, statt als
// leere "Note" in Vault, Suche, Graph und Sync zu landen.
//
// Entwurf ist ausschließlich, was in dieser Session über newNote() entstanden
// ist. Bestehende Notes werden nie automatisch entfernt.
// ============================================================

import {
  $,
  state,
} from './core.js';

import {
  noteMarkdown,
  listDrawingsForNote,
} from './yjs.js';

import {
  permanentlyDeleteNote,
} from './trash.js';

// noteId -> normalisierter Titel, mit dem die Note erstellt wurde.
const draftTitles = new Map();

let surfaceObserver = null;
let discarding = false;

/*
  Reine Markdown-Gerüstzeilen ohne Inhalt: "- ", "- [ ]", "1.", "#", ">".
  Eine neue Checkliste startet mit genau so einer Zeile und bleibt damit leer.
*/
const SCAFFOLD_LINE_RE = /^\s*(?:[-*+]\s*(?:\[[ xX]\])?|\d+[.)]|#{1,6}|>)\s*$/;

const PLACEHOLDER_TITLES = new Set(['', 'untitled', 'untitled note']);

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

export function trackDraftNote(noteId, {
  title = '',
} = {}) {
  const id = String(noteId || '');
  if (!id) return;

  draftTitles.set(id, normalizeTitle(title));
}

export function forgetDraftNote(noteId) {
  draftTitles.delete(String(noteId || ''));
}

/*
  Solange die Note offen ist, ist das Titelfeld die Wahrheit:
  note.title folgt der Eingabe erst nach dem Autosave-Debounce.
*/
function currentTitle(noteId, note) {
  if (state.currentNoteId === noteId) {
    const input = $('noteTitle');

    if (input) return normalizeTitle(input.value);
  }

  return normalizeTitle(note.title);
}

function hasBodyContent(noteId) {
  let markdown = '';

  try {
    markdown = noteMarkdown(noteId) || '';
  } catch {
    // Doc nicht lesbar => im Zweifel behalten.
    return true;
  }

  return markdown
    .split('\n')
    .some((line) => line.trim() && !SCAFFOLD_LINE_RE.test(line));
}

function hasDrawings(noteId) {
  try {
    return listDrawingsForNote(noteId).length > 0;
  } catch {
    return true;
  }
}

function hasLinkedCalendarEvent(noteId) {
  for (const event of state.calendarEvents.values()) {
    if (event?.noteId === noteId) return true;
  }

  return false;
}

function isAbandonedDraft(noteId) {
  const createdTitle = draftTitles.get(noteId);
  if (createdTitle === undefined) return false;

  const note = state.notes.get(noteId);

  if (!note) {
    draftTitles.delete(noteId);
    return false;
  }

  // Bewusste Nutzeraktionen bleiben unangetastet.
  if (note.trashed === true) return false;
  if (note.pinned) return false;
  if (note.tags?.length) return false;

  const title = currentTitle(noteId, note);

  if (!PLACEHOLDER_TITLES.has(title) && title !== createdTitle) return false;

  if (hasBodyContent(noteId)) return false;
  if (hasDrawings(noteId)) return false;
  if (hasLinkedCalendarEvent(noteId)) return false;

  return true;
}

/**
 * Verwirft alle verlassenen, leeren Entwürfe.
 *
 * Entwürfe, die inzwischen Inhalt haben, gelten ab dem Verlassen als normale
 * Notes und werden nicht weiter beobachtet.
 */
export async function discardAbandonedDraftNotes({
  keepNoteId = null,
  reason = 'unknown',
} = {}) {
  if (discarding || !draftTitles.size) return 0;

  const keep = String(keepNoteId || '');
  const abandoned = [];

  for (const noteId of [...draftTitles.keys()]) {
    if (noteId === keep) continue;

    if (isAbandonedDraft(noteId)) {
      abandoned.push(noteId);
    } else {
      draftTitles.delete(noteId);
    }
  }

  if (!abandoned.length) return 0;

  discarding = true;

  try {
    for (const noteId of abandoned) {
      draftTitles.delete(noteId);

      try {
        await permanentlyDeleteNote(noteId, {
          source: `empty-draft:${reason}`,
        });
      } catch (err) {
        console.warn('[YANTA Notes] Could not discard empty draft note', err);
      }
    }
  } finally {
    discarding = false;
  }

  return abandoned.length;
}

function scheduleDiscard(options) {
  discardAbandonedDraftNotes(options).catch((err) => {
    console.warn('[YANTA Notes] Draft cleanup failed', err);
  });
}

export function setupEmptyDraftNoteCleanup() {
  if (surfaceObserver) return;

  window.addEventListener('yanta-note-opened', (e) => {
    scheduleDiscard({
      keepNoteId: e.detail?.noteId || null,
      reason: 'note-opened',
    });
  });

  /*
    Surface-Wechsel (Dashboard, Kalender, Chat, Deep Links, Geräte-Back) kommen
    aus vielen Modulen, setzen aber alle #app[data-surface]. Ein Observer darauf
    ist der eine Punkt, an dem "Note verlassen" zuverlässig sichtbar wird.
  */
  const app = $('app');
  if (!app) return;

  surfaceObserver = new MutationObserver(() => {
    scheduleDiscard({
      keepNoteId: state.surface === 'note' ? state.currentNoteId : null,
      reason: 'surface-change',
    });
  });

  surfaceObserver.observe(app, {
    attributes: true,
    attributeFilter: ['data-surface'],
  });
}
