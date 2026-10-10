// ============================================================
// YANTA AI — what the assistant may not see
//
// Notes, folders and calendar categories can be marked "hidden from YANTA
// AI" (`aiHidden`). A folder's mark covers everything inside it. Locked
// content (workspace lock, later private folders) counts as hidden too.
//
// Enforced in one place — executeToolCall (tool-registry.js) — rather
// than in each of fifty tools: arguments that name a hidden item are
// refused before the tool runs, and whatever a tool returns is scrubbed
// of hidden notes and events before the model sees it. Search, semantic
// search, calendar queries, Pulse and the external agent bridge all go
// through there. The chat's own context (current note, attachments)
// checks with the same helpers.
// ============================================================

import { state } from '../core.js';

export const AI_PRIVATE_CODE = 'EAI_PRIVATE';

function folderHidden(folderId, seen = new Set()) {
  let id = folderId;

  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = state.folders.get(id);
    if (!folder) return false;
    if (folder.aiHidden) return true;
    id = folder.parentId;
  }

  return false;
}

export function isFolderHiddenFromAi(folderId) {
  return folderHidden(String(folderId || ''));
}

export function isNoteHiddenFromAi(noteOrId) {
  const note = typeof noteOrId === 'object' && noteOrId
    ? noteOrId
    : state.notes.get(String(noteOrId || ''));

  if (!note) return false;
  return !!note.aiHidden || folderHidden(note.folderId);
}

export function isCalendarCategoryHiddenFromAi(categoryId) {
  return !!state.calendarCategories?.get?.(String(categoryId || ''))?.aiHidden;
}

export function isEventHiddenFromAi(eventOrId) {
  const ev = typeof eventOrId === 'object' && eventOrId
    ? eventOrId
    : state.calendarEvents?.get?.(String(eventOrId || ''));

  if (!ev) return false;
  if (ev.aiHidden) return true;
  if (isCalendarCategoryHiddenFromAi(ev.categoryId)) return true;

  // An occurrence of a series inherits from its master.
  const master = ev.recurrenceMasterId ? state.calendarEvents?.get?.(ev.recurrenceMasterId) : null;
  return master ? isEventHiddenFromAi(master) : false;
}

/** True when anything at all is hidden — lets the scrub skip work in the common case. */
export function aiPrivacyActive() {
  for (const f of state.folders.values()) if (f?.aiHidden) return true;
  for (const n of state.notes.values()) if (n?.aiHidden) return true;
  for (const c of state.calendarCategories?.values?.() || []) if (c?.aiHidden) return true;
  for (const e of state.calendarEvents?.values?.() || []) if (e?.aiHidden) return true;
  return false;
}

function idHidden(id) {
  const key = String(id || '');
  if (!key) return false;
  if (state.notes.has(key)) return isNoteHiddenFromAi(key);
  if (state.folders.has(key)) return isFolderHiddenFromAi(key);
  if (state.calendarEvents?.has?.(key)) return isEventHiddenFromAi(key);
  // Occurrence ids are "<master>::<key>".
  const master = key.split('::')[0];
  if (master !== key && state.calendarEvents?.has?.(master)) return isEventHiddenFromAi(master);
  return false;
}

const ID_ARGS = ['noteId', 'folderId', 'parentId', 'targetFolderId', 'eventId', 'id', 'drawingNoteId', 'sourceNoteId'];
const ID_LIST_ARGS = ['noteIds', 'folderIds', 'eventIds', 'ids'];

export class AiPrivateError extends Error {
  constructor() {
    // Read by the model, so English.
    super('This item is private: the user has hidden it from YANTA AI ("Hide from YANTA AI" in its context menu). Do not try to reach it another way; if it matters, tell the user it is hidden from you and that "Show to YANTA AI again" lifts it.');
    this.code = AI_PRIVATE_CODE;
  }
}

// Tools that act on whatever note is open, without naming it.
const CURRENT_NOTE_TOOLS = new Set(['replace_current_selection']);

/** Throws AiPrivateError when a tool's arguments name a hidden note, folder or event. */
export function assertArgsVisible(args = {}, toolName = '') {
  if (CURRENT_NOTE_TOOLS.has(toolName) && state.currentNoteId && isNoteHiddenFromAi(state.currentNoteId)) {
    throw new AiPrivateError();
  }

  if (!args || typeof args !== 'object') return;

  for (const key of ID_ARGS) {
    if (args[key] != null && idHidden(args[key])) throw new AiPrivateError();
  }

  for (const key of ID_LIST_ARGS) {
    if (Array.isArray(args[key]) && args[key].some(idHidden)) throw new AiPrivateError();
  }

  // An event's category decides too (create_event into a hidden calendar).
  if (args.categoryId && isCalendarCategoryHiddenFromAi(args.categoryId)) throw new AiPrivateError();
}

function objectHidden(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (obj.id != null && idHidden(obj.id)) return true;
  if (obj.noteId != null && idHidden(obj.noteId)) return true;
  if (obj.eventId != null && idHidden(obj.eventId)) return true;
  if (obj.recurrenceMasterId != null && idHidden(obj.recurrenceMasterId)) return true;
  if (obj.categoryId != null && (obj.start || obj.title) && isCalendarCategoryHiddenFromAi(obj.categoryId)) return true;
  // A note listing (id + folderId) in a hidden folder.
  if (obj.folderId != null && (obj.title != null || obj.markdown != null) && isFolderHiddenFromAi(obj.folderId)) return true;
  return false;
}

function scrub(value, depth) {
  if (depth > 8 || !value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.filter((item) => !objectHidden(item)).map((item) => scrub(item, depth + 1));
  }

  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = scrub(child, depth + 1);
  return out;
}

/**
 * The tool result as the model may see it: hidden notes, folders and
 * events removed from every list; a result that *is* a hidden item
 * becomes a refusal.
 */
export function scrubResultForAi(result) {
  if (!aiPrivacyActive()) return result;
  if (objectHidden(result)) return { error: new AiPrivateError().message, code: AI_PRIVATE_CODE };
  return scrub(result, 0);
}
