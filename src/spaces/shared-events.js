// ============================================================
// YANTA Shared Spaces — events that travel with a space
//
// Two kinds of space put calendar events on the wire:
// - a CALENDAR space shares one whole category,
// - a FOLDER space shares the events linked to the notes inside it.
//
// What a "shared event" is stays the same in both cases, so the record
// shape and the note-linkage rule live here rather than in either
// bridge. The linkage rule is the one the public-share pack already
// uses: an event travels with a note it points at.
//
// Personal fields never travel: reminders are per-participant (see
// calendar-personal.js), and so are category color and visibility.
// ============================================================

import {
  vaultEventsMap,
  vaultTombstonesMap,
  safeJsonClone,
} from '../sync2/vault-doc.js';

/**
 * The event as everyone shares it: reminders are personal and never
 * leave the device; createdBy/updatedBy travel for attribution.
 */
export function sharedEventRecord(ev) {
  const out = { ...ev };

  delete out.reminders;
  delete out.spaceId;
  delete out.spaceRole;

  return out;
}

/**
 * A category as everyone shares it. Presentation (color, visibility)
 * and dynamic-source config are deliberately absent — each participant
 * styles a shared calendar for themselves.
 */
export function sharedCategoryMeta(cat) {
  return {
    id: cat.id,
    name: cat.name || 'Calendar',
    icon: cat.icon || undefined,
    created: cat.created || Date.now(),
    updated: cat.updated || Date.now(),
  };
}

/** Every note this event points at, deduplicated. */
export function eventNoteLinks(ev) {
  const ids = new Set();

  if (ev?.noteId) ids.add(String(ev.noteId));

  for (const id of ev?.relatedNoteIds || []) {
    if (id) ids.add(String(id));
  }

  return ids;
}

export function eventLinksToNote(ev, noteId) {
  if (!ev || !noteId) return false;

  return ev.noteId === noteId ||
    (Array.isArray(ev.relatedNoteIds) && ev.relatedNoteIds.includes(noteId));
}

/**
 * Vault events linked to any of `noteIds`, as raw records. This is the
 * owner-side source of truth — recipients read the space doc instead.
 */
export function linkedVaultEvents(noteIds) {
  const wanted = noteIds instanceof Set ? noteIds : new Set(noteIds || []);
  const out = new Map();

  if (!wanted.size) return out;

  const tombstones = vaultTombstonesMap();

  for (const [id, raw] of vaultEventsMap()) {
    if (tombstones.has(id)) continue;

    for (const noteId of eventNoteLinks(raw)) {
      if (!wanted.has(noteId)) continue;

      out.set(id, raw);
      break;
    }
  }

  return out;
}

/**
 * Strip note references that do NOT travel with the space. An event
 * linked to five notes may reach a recipient through one of them; the
 * other four are none of their business and would render as links to
 * notes they cannot open.
 */
export function scopeEventNoteLinks(record, allowedNoteIds) {
  const allowed = allowedNoteIds instanceof Set
    ? allowedNoteIds
    : new Set(allowedNoteIds || []);

  const out = safeJsonClone(record);

  if (out.noteId && !allowed.has(String(out.noteId))) {
    out.noteId = null;
  }

  if (Array.isArray(out.relatedNoteIds)) {
    out.relatedNoteIds = out.relatedNoteIds.filter((id) => allowed.has(String(id)));
  }

  // A shared event always keeps ONE primary link when it has any, so
  // "open the note" works on the recipient's side too.
  if (!out.noteId && out.relatedNoteIds?.length) {
    out.noteId = out.relatedNoteIds[0];
  }

  return out;
}
