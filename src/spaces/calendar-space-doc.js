// ============================================================
// YANTA Shared Spaces — calendar doc
//
// A calendar space shares one calendar category. It gets its own
// metadata CRDT next to the per-note content docs of linked notes,
// mirroring the workspace-doc pattern:
//
//   meta:       { id, name, icon?, updated }   (the category, minus
//                everything personal — color/visibility/reminders
//                stay per-participant, see calendar-personal.js)
//   events:     eventId -> shared event record (reminders stripped,
//                createdBy/updatedBy carried for attribution)
//   notes:      noteId  -> linked-note meta (same shape as
//                workspaceNoteMeta) so recipients can materialize
//                placeholders and attach the content docs
//   tombstones: 'event:<id>' / 'note:<id>' -> { kind, id, deleted }
//
// The category ID is the owner's and is canonical for everyone, like
// item IDs in folder spaces — recipients mount the category under the
// same ID, so events and links line up without a mapping table.
// ============================================================

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export const CALENDAR_REMOTE_KEY = 'calendar';

// Origin used for writes this client makes into a calendar space doc.
// Remote state arrives via the SpaceEngine with 'space-remote'.
export const CALENDAR_DOC_ORIGINS = {
  BRIDGE: 'space-calendar-bridge',
};

const entries = new Map();

export function getCalendarDocEntry(spaceId) {
  const existing = entries.get(spaceId);
  if (existing) return existing;

  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`yanta-space-calendar-${spaceId}`, doc);

  const ready = new Promise((resolve) => {
    persistence.once('synced', () => resolve());
  });

  const entry = { doc, persistence, ready };
  entries.set(spaceId, entry);

  return entry;
}

export function getCalendarDoc(spaceId) {
  return getCalendarDocEntry(spaceId).doc;
}

export async function waitForCalendarDoc(spaceId) {
  const entry = getCalendarDocEntry(spaceId);
  await entry.ready;
  return entry.doc;
}

export function calendarMetaMap(spaceId) {
  return getCalendarDoc(spaceId).getMap('meta');
}

export function calendarEventsMap(spaceId) {
  return getCalendarDoc(spaceId).getMap('events');
}

export function calendarNotesMap(spaceId) {
  return getCalendarDoc(spaceId).getMap('notes');
}

export function calendarTombstonesMap(spaceId) {
  return getCalendarDoc(spaceId).getMap('tombstones');
}

export async function destroyCalendarDoc(spaceId) {
  const entry = entries.get(spaceId);
  if (!entry) return;

  entries.delete(spaceId);

  try {
    await entry.persistence.clearData();
  } catch {}

  try {
    entry.doc.destroy();
  } catch {}
}

// ---------------- record shapes ----------------------------------

export function sharedNoteMeta(note) {
  return {
    id: note.id,
    title: note.title || '',
    type: note.type || 'markdown',
    tags: Array.isArray(note.tags) ? [...note.tags] : [],
    icon: note.icon || undefined,
    color: note.color || undefined,
    created: note.created || Date.now(),
    updated: note.updated || Date.now(),
  };
}

// ---------------- tombstones --------------------------------------

export function addCalendarTombstone(spaceId, kind, id, origin) {
  const doc = getCalendarDoc(spaceId);

  doc.transact(() => {
    calendarTombstonesMap(spaceId).set(`${kind}:${id}`, {
      kind,
      id,
      deleted: Date.now(),
    });

    if (kind === 'event') calendarEventsMap(spaceId).delete(id);
    if (kind === 'note') calendarNotesMap(spaceId).delete(id);
  }, origin);
}

export function isCalendarTombstoned(spaceId, kind, id) {
  return calendarTombstonesMap(spaceId).has(`${kind}:${id}`);
}
