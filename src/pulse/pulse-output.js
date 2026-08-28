// ============================================================
// YANTA Pulse — where results land, and how they are marked
//
// Two problems, one module.
//
// 1. Placement. A routine that saves articles used to drop them wherever
//    the tool defaulted to — the feed's folder, or the vault root next to
//    the user's own notes. Reading queue after reading queue, the root
//    silted up. Everything a background run creates now goes into one
//    folder the user can point somewhere else, or open and empty in one
//    gesture.
//
// 2. Provenance. A note the user wrote and a note a routine wrote looked
//    identical. They carry `aiGenerated` now, which the dashboard and the
//    tree render as a badge, so "who wrote this" is answered by looking
//    rather than by remembering.
//
// The journal is deliberately not covered here: `output: [journal]` means
// "today's note", and filing it anywhere else would make the output mean
// nothing. Journal entries are marked instead — see journal.js.
// ============================================================

import { state, store } from '../core.js';

import {
  getPulseOutputFolderId,
  setPulseOutputFolderId,
} from './pulse-store.js';

const DEFAULT_FOLDER_NAME = 'Pulse';
const DEFAULT_FOLDER_ICON = 'activity';

/** Tools whose result is a note that should be filed and marked. */
export const PULSE_NOTE_CREATING_TOOLS = Object.freeze([
  'create_note',
  'create_drawing_note',
  'rss_save_item_as_note',
]);

/**
 * Whether a folder may hold the output of a background run.
 *
 * The AI Brain and its Skills folder are excluded on purpose, and so is
 * anything nested under them: a run reads feeds, the web and messages, and
 * a note it writes into the Brain would come back as instructions to a
 * later run. Shared folders are excluded because a routine must not
 * publish to other people unprompted. Enforced here rather than only in
 * the settings picker, so a synced or hand-edited id cannot get past it.
 */
function usableFolder(folder) {
  if (!folder || folder.trashed === true || folder.spaceId) return null;

  const seen = new Set();
  let current = folder;

  while (current && !seen.has(current.id)) {
    if (current.system === true || current.aiBrain === true) return null;

    seen.add(current.id);
    current = current.parentId ? state.folders.get(current.parentId) : null;
  }

  return folder;
}

/**
 * The configured output folder, or null when it was never set, was
 * trashed, or has not synced to this device yet. Never creates.
 */
export async function findPulseOutputFolder() {
  const configured = await getPulseOutputFolderId().catch(() => '');

  if (configured) {
    const folder = usableFolder(state.folders.get(configured));
    if (folder) return folder;
  }

  // Adopt a top-level "Pulse" folder another device made before its id
  // reached us — otherwise both devices create one and the user ends up
  // with two.
  return [...state.folders.values()].find((folder) =>
    usableFolder(folder) && !folder.parentId && folder.name === DEFAULT_FOLDER_NAME
  ) || null;
}

/**
 * The output folder, creating the default one on first use.
 *
 * Lazy on purpose: a user who never switches a routine on never gets an
 * empty "Pulse" folder in their sidebar.
 */
export async function ensurePulseOutputFolder() {
  const existing = await findPulseOutputFolder();

  if (existing) {
    const configured = await getPulseOutputFolderId().catch(() => '');
    if (configured !== existing.id) {
      await setPulseOutputFolderId(existing.id).catch(() => {});
    }

    return existing;
  }

  const { newFolder } = await import('../notes.js');

  const folder = await newFolder(null, {
    name: DEFAULT_FOLDER_NAME,
    focusRename: false,
    source: 'pulse',
  });

  folder.icon = DEFAULT_FOLDER_ICON;
  folder.updated = Date.now();

  state.folders.set(folder.id, folder);
  await store.folders.put(folder);

  await setPulseOutputFolderId(folder.id).catch(() => {});

  return folder;
}

/**
 * Marks a note as written by a background run.
 *
 * Best-effort: a note that cannot be marked is still a note the user has,
 * and failing the run over a badge would be the wrong trade.
 *
 * @param {string} noteId
 * @param {string} source  e.g. "pulse:reading-queue"
 */
export async function markNoteAiGenerated(noteId, source = 'pulse') {
  const note = state.notes.get(String(noteId || ''));

  if (!note || note.aiGenerated === true) return note || null;

  note.aiGenerated = true;
  note.aiSource = String(source || 'pulse');
  note.updated = Date.now();

  state.notes.set(note.id, note);

  try {
    await store.notes.put(note);
  } catch (err) {
    console.warn('[YANTA Pulse] could not mark note as AI-generated', noteId, err);
  }

  /*
    The creating tool already rendered the note — unmarked. Without this
    the badge only appears at the next unrelated render, which for a run
    that happened overnight means the user meets the note without it.
  */
  try {
    const { renderTree } = await import('../tree.js');
    renderTree();
  } catch {}

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
    detail: { reason: 'pulse-ai-generated', noteId: note.id },
  }));

  return note;
}

/** Note ids a tool result refers to. Shapes differ per tool. */
export function noteIdsFromToolResult(result) {
  if (!result || typeof result !== 'object') return [];

  const ids = [
    result.id,
    result.noteId,
    result.note?.id,
  ];

  if (Array.isArray(result.notes)) {
    ids.push(...result.notes.map((note) => note?.id));
  }

  return [...new Set(ids.filter((id) => typeof id === 'string' && id))];
}
