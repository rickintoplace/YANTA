// ============================================================
// YANTA Shared Spaces — calendar bridge
//
// Keeps one shared calendar category in sync between the local data
// model and the space's calendar doc, for owner and recipients alike.
//
// Ownership model (mirrors the folder-space rules):
// - The OWNER's vault stays the source of truth for their own data:
//   events of the shared category live in the VaultDoc as always and
//   keep syncing to their private vault. The bridge mirrors them into
//   the calendar doc (personal fields stripped) and applies inbound
//   member edits back into the vault.
// - RECIPIENTS never touch their vault: the mounted category and its
//   events live only in the calendar doc; hydration merges them into
//   the in-memory calendar state with a spaceId mark (the calendar
//   CRUD routes their writes back into the doc).
//
// Membership is geometry, not marking: an event is in the space iff
// event.categoryId === the shared category's ID. Moving an event out
// tombstones it in the space and keeps it local.
//
// Personal fields never enter the doc: reminders are stripped from
// every shared record (see calendar-personal.js), category color and
// visibility are per-participant overlays.
// ============================================================

import { state, store } from '../core.js';

import {
  getVaultDoc,
  waitForVaultDoc,
  vaultEventsMap,
  vaultCalendarCategoriesMap,
  vaultNotesMap,
  vaultTombstonesMap,
  safeJsonClone,
} from '../sync2/vault-doc.js';

import {
  CALENDAR_REMOTE_KEY,
  CALENDAR_DOC_ORIGINS,
  waitForCalendarDoc,
  calendarMetaMap,
  calendarEventsMap,
  calendarNotesMap,
  calendarTombstonesMap,
  sharedCategoryMeta,
  sharedEventRecord,
  sharedNoteMeta,
  addCalendarTombstone,
  isCalendarTombstoned,
} from './calendar-space-doc.js';

import {
  registerCalendarBridge,
  unregisterCalendarBridge,
  calendarBridgeForSpace,
} from './calendar-registry.js';

import {
  setPersonalEventReminders,
  forgetPersonalEventReminders,
} from '../calendar-personal.js';

import { appendCalendarFeed } from './calendar-feed.js';
import { resolveOwnIdentity } from './space-identity.js';

import { SPACE_REMOTE_ORIGIN } from './space-engine.js';

// Origin for writes this bridge makes INTO the VaultDoc (owner side),
// so its own vault observers can tell echo from real changes.
export const CALENDAR_VAULT_ORIGIN = 'space-calendar-bridge';

function nowTs() {
  return Date.now();
}

function emitCalendarSpaceApplied(spaceId) {
  window.dispatchEvent(new CustomEvent('yanta-calendar-space-applied', {
    detail: { spaceId },
  }));
}

export class CalendarBridge {
  constructor(session) {
    this.session = session;
    this.spaceId = session.spaceId;
    this.role = session.role;
    this.isOwner = session.role === 'owner';
    this.canWrite = session.role === 'owner' || session.role === 'write';
    this.categoryId = session.record.categoryId || '';

    this.identity = '';
    this.doc = null;

    this.vaultUnsubs = [];
    this.docObservers = [];
    this.noteUpdatedHandler = null;

    this.attachedNotes = new Set();
    this.applying = false;

    // The first pull after a mount replays the whole doc — that is
    // hydration, not news. The feed arms after it settles.
    this.feedArmed = false;
  }

  excludedNoteIds() {
    return new Set(this.session.record.excludedNoteIds || []);
  }

  // ---------------- install / uninstall ---------------------------

  /**
   * Recipients learn the canonical category ID from the doc's meta on
   * the first pull (the owner's ID is canonical for everyone, exactly
   * like item IDs in folder spaces).
   */
  ensureCategoryId() {
    if (this.categoryId) return;

    const meta = calendarMetaMap(this.spaceId).get('category');
    if (!meta?.id) return;

    this.categoryId = String(meta.id);
    this.session.record.categoryId = this.categoryId;
    store.spaces.put(this.session.record).catch(() => {});
  }

  async install() {
    this.doc = await waitForCalendarDoc(this.spaceId);
    this.identity = await resolveOwnIdentity();

    this.ensureCategoryId();

    if (this.isOwner) {
      await waitForVaultDoc();
      this.seedFromVault();
      this.applyDocToVault();
      this.observeVault();
    }

    this.observeDoc();
    await this.materializeNotes();
    await this.attachAllNoteDocs();

    setTimeout(() => {
      this.feedArmed = true;
    }, 4000);

    registerCalendarBridge(this);
    emitCalendarSpaceApplied(this.spaceId);
  }

  uninstall() {
    for (const unsub of this.vaultUnsubs) {
      try {
        unsub();
      } catch {}
    }
    this.vaultUnsubs = [];

    for (const { map, handler } of this.docObservers) {
      try {
        map.unobserve(handler);
      } catch {}
    }
    this.docObservers = [];

    if (this.noteUpdatedHandler) {
      window.removeEventListener('yanta-note-updated', this.noteUpdatedHandler);
      this.noteUpdatedHandler = null;
    }

    unregisterCalendarBridge(this.spaceId);
  }

  // ---------------- shared views (used by calendar hydration) -----

  category() {
    this.ensureCategoryId();

    const meta = calendarMetaMap(this.spaceId).get('category');
    if (!meta || !this.categoryId) return null;

    return {
      ...safeJsonClone(meta),
      id: this.categoryId,
    };
  }

  events() {
    const out = [];

    for (const [id, raw] of calendarEventsMap(this.spaceId)) {
      if (isCalendarTombstoned(this.spaceId, 'event', id)) continue;
      out.push(safeJsonClone(raw));
    }

    return out;
  }

  linkedNoteMetas() {
    const out = [];

    for (const [id, raw] of calendarNotesMap(this.spaceId)) {
      if (isCalendarTombstoned(this.spaceId, 'note', id)) continue;
      out.push(safeJsonClone(raw));
    }

    return out;
  }

  // ---------------- owner: vault → doc -----------------------------

  vaultEventBelongsToSpace(record) {
    return record && record.categoryId === this.categoryId;
  }

  /** Reconcile the doc with the vault on mount, without losing member
   *  edits made while this device was away (LWW on `updated`). */
  seedFromVault() {
    const cat = vaultCalendarCategoriesMap().get(this.categoryId);
    const docEvents = calendarEventsMap(this.spaceId);
    const vaultTombstones = vaultTombstonesMap();

    this.doc.transact(() => {
      if (cat) {
        const existingMeta = calendarMetaMap(this.spaceId).get('category');
        const meta = sharedCategoryMeta(cat);

        if (!existingMeta || Number(existingMeta.updated || 0) < Number(meta.updated || 0)) {
          calendarMetaMap(this.spaceId).set('category', safeJsonClone(meta));
        }
      }

      for (const [id, raw] of vaultEventsMap()) {
        if (!this.vaultEventBelongsToSpace(raw)) continue;
        if (vaultTombstones.has(id)) continue;

        this.writeEventToDoc(id, raw, { stamp: false });
      }

      for (const [id] of docEvents) {
        const vaultRecord = vaultEventsMap().get(id);
        const gone =
          (!vaultRecord && vaultTombstones.get(id)?.type === 'calendar-event') ||
          (vaultRecord && !this.vaultEventBelongsToSpace(vaultRecord));

        if (gone && !isCalendarTombstoned(this.spaceId, 'event', id)) {
          calendarTombstonesMap(this.spaceId).set(`event:${id}`, {
            kind: 'event',
            id,
            deleted: nowTs(),
          });
          docEvents.delete(id);
        }
      }
    }, CALENDAR_DOC_ORIGINS.BRIDGE);

    this.syncLinkedNotesOut();
  }

  /** Write one vault event into the doc if newer (callers wrap in a
   *  transaction). Stamps attribution for genuinely local changes. */
  writeEventToDoc(id, raw, { stamp = true } = {}) {
    const events = calendarEventsMap(this.spaceId);
    const existing = events.get(id);

    const record = sharedEventRecord(safeJsonClone(raw));

    if (existing && Number(existing.updated || 0) >= Number(record.updated || 0)) {
      return false;
    }

    if (stamp) {
      record.updatedBy = this.identity;
      if (!record.createdBy) {
        record.createdBy = existing?.createdBy || this.identity;
      }
    } else if (!record.createdBy && existing?.createdBy) {
      record.createdBy = existing.createdBy;
    }

    events.set(id, record);
    calendarTombstonesMap(this.spaceId).delete(`event:${id}`);

    return true;
  }

  observeVault() {
    const eventsHandler = (e, tx) => {
      if (tx.origin === CALENDAR_VAULT_ORIGIN) return;

      let notesDirty = false;

      this.doc.transact(() => {
        for (const [id, change] of e.changes.keys) {
          const record = vaultEventsMap().get(id);

          if (change.action === 'delete' || !record) continue;

          if (this.vaultEventBelongsToSpace(record)) {
            this.writeEventToDoc(id, record, { stamp: tx.origin !== 'sync2-remote' });
            notesDirty = true;
          } else if (calendarEventsMap(this.spaceId).has(id)) {
            // Moved out of the shared category — leaves the space.
            calendarTombstonesMap(this.spaceId).set(`event:${id}`, {
              kind: 'event',
              id,
              deleted: nowTs(),
            });
            calendarEventsMap(this.spaceId).delete(id);
          }
        }
      }, CALENDAR_DOC_ORIGINS.BRIDGE);

      if (notesDirty) this.syncLinkedNotesOut();
    };

    const tombstonesHandler = (e, tx) => {
      if (tx.origin === CALENDAR_VAULT_ORIGIN) return;

      this.doc.transact(() => {
        for (const [id, change] of e.changes.keys) {
          if (change.action === 'delete') continue;

          const stone = vaultTombstonesMap().get(id);

          if (stone?.type === 'calendar-event' && calendarEventsMap(this.spaceId).has(id)) {
            calendarTombstonesMap(this.spaceId).set(`event:${id}`, {
              kind: 'event',
              id,
              deleted: nowTs(),
            });
            calendarEventsMap(this.spaceId).delete(id);
          }
        }
      }, CALENDAR_DOC_ORIGINS.BRIDGE);
    };

    const categoriesHandler = (e, tx) => {
      if (tx.origin === CALENDAR_VAULT_ORIGIN) return;
      if (!e.changes.keys.has(this.categoryId)) return;

      const cat = vaultCalendarCategoriesMap().get(this.categoryId);
      if (!cat) return;

      const meta = sharedCategoryMeta(cat);
      const existing = calendarMetaMap(this.spaceId).get('category');

      if (existing && Number(existing.updated || 0) >= Number(meta.updated || 0)) return;

      this.doc.transact(() => {
        calendarMetaMap(this.spaceId).set('category', safeJsonClone(meta));
      }, CALENDAR_DOC_ORIGINS.BRIDGE);
    };

    const events = vaultEventsMap();
    const tombstones = vaultTombstonesMap();
    const categories = vaultCalendarCategoriesMap();

    events.observe(eventsHandler);
    tombstones.observe(tombstonesHandler);
    categories.observe(categoriesHandler);

    this.vaultUnsubs.push(
      () => events.unobserve(eventsHandler),
      () => tombstones.unobserve(tombstonesHandler),
      () => categories.unobserve(categoriesHandler)
    );

    // Keep linked-note titles/icons fresh in the shared metas.
    this.noteUpdatedHandler = (e) => {
      const noteId = e.detail?.noteId;
      if (!noteId || !calendarNotesMap(this.spaceId).has(noteId)) return;

      const note = state.notes.get(noteId);
      if (!note) return;

      this.doc.transact(() => {
        calendarNotesMap(this.spaceId).set(noteId, sharedNoteMeta(note));
      }, CALENDAR_DOC_ORIGINS.BRIDGE);
    };

    window.addEventListener('yanta-note-updated', this.noteUpdatedHandler);
  }

  /** All note IDs referenced by the shared events right now. */
  referencedNoteIds() {
    const ids = new Set();

    for (const [, record] of calendarEventsMap(this.spaceId)) {
      if (record?.noteId) ids.add(String(record.noteId));

      for (const rel of record?.relatedNoteIds || []) {
        if (rel) ids.add(String(rel));
      }
    }

    return ids;
  }

  /** Owner: publish/unpublish linked-note metas as links change. */
  syncLinkedNotesOut() {
    if (!this.isOwner) return;

    const referenced = this.referencedNoteIds();
    const excluded = this.excludedNoteIds();
    const notes = calendarNotesMap(this.spaceId);

    this.doc.transact(() => {
      for (const id of referenced) {
        if (excluded.has(id)) continue;

        const note = state.notes.get(id) || vaultNotesMap().get(id);
        if (!note) continue;

        const meta = sharedNoteMeta(note);
        const existing = notes.get(id);

        if (!existing || Number(existing.updated || 0) < Number(meta.updated || 0)) {
          notes.set(id, safeJsonClone(meta));
        }

        calendarTombstonesMap(this.spaceId).delete(`note:${id}`);
      }

      for (const [id] of notes) {
        if (referenced.has(id) && !excluded.has(id)) continue;

        calendarTombstonesMap(this.spaceId).set(`note:${id}`, {
          kind: 'note',
          id,
          deleted: nowTs(),
        });
        notes.delete(id);
      }
    }, CALENDAR_DOC_ORIGINS.BRIDGE);

    this.materializeNotes().then(() => this.attachAllNoteDocs()).catch(() => {});
  }

  /** Owner-only: the share dialog toggled which linked notes travel. */
  async setExcludedNoteIds(noteIds) {
    if (!this.isOwner) return;

    this.session.record.excludedNoteIds = [...new Set(noteIds.map(String))];
    await store.spaces.put(this.session.record);

    this.syncLinkedNotesOut();
  }

  // ---------------- doc → local (both roles) ----------------------

  observeDoc() {
    const eventsHandler = (e, tx) => {
      if (tx.origin !== SPACE_REMOTE_ORIGIN) return;

      this.ensureCategoryId();

      const feed = [];

      for (const [id, change] of e.changes.keys) {
        const record = calendarEventsMap(this.spaceId).get(id);

        if (this.feedArmed) {
          const title = record?.title || change.oldValue?.title || 'Untitled event';
          const actor = record?.updatedBy || 'Someone';

          feed.push({
            ts: nowTs(),
            actor,
            action: change.action === 'add'
              ? 'added'
              : change.action === 'delete' ? 'removed' : 'updated',
            eventId: id,
            title,
            start: record?.start || change.oldValue?.start || null,
          });
        }
      }

      if (feed.length) {
        appendCalendarFeed(this.spaceId, feed).catch(() => {});
      }

      if (this.isOwner) {
        this.applyDocToVault();
      }

      this.materializeNotes().then(() => this.attachAllNoteDocs()).catch(() => {});
      emitCalendarSpaceApplied(this.spaceId);
    };

    const tombstonesHandler = (e, tx) => {
      if (tx.origin !== SPACE_REMOTE_ORIGIN) return;

      if (this.isOwner) {
        this.applyDocToVault();
      }

      this.materializeNotes().then(() => this.attachAllNoteDocs()).catch(() => {});
      emitCalendarSpaceApplied(this.spaceId);
    };

    const metaHandler = (e, tx) => {
      if (tx.origin !== SPACE_REMOTE_ORIGIN) return;

      this.ensureCategoryId();

      if (this.isOwner) {
        this.applyDocToVault();
      }

      emitCalendarSpaceApplied(this.spaceId);
    };

    const notesHandler = (e, tx) => {
      if (tx.origin !== SPACE_REMOTE_ORIGIN) return;

      this.materializeNotes().then(() => this.attachAllNoteDocs()).catch(() => {});
    };

    const events = calendarEventsMap(this.spaceId);
    const tombstones = calendarTombstonesMap(this.spaceId);
    const meta = calendarMetaMap(this.spaceId);
    const notes = calendarNotesMap(this.spaceId);

    events.observe(eventsHandler);
    tombstones.observe(tombstonesHandler);
    meta.observe(metaHandler);
    notes.observe(notesHandler);

    this.docObservers.push(
      { map: events, handler: eventsHandler },
      { map: tombstones, handler: tombstonesHandler },
      { map: meta, handler: metaHandler },
      { map: notes, handler: notesHandler }
    );
  }

  /** Owner: fold the doc's current state into the vault (LWW per
   *  record, local reminders always preserved). */
  applyDocToVault() {
    if (!this.isOwner || this.applying) return;
    this.applying = true;

    try {
      const vaultDoc = getVaultDoc();
      const vaultEvents = vaultEventsMap();
      const vaultTombstones = vaultTombstonesMap();

      vaultDoc.transact(() => {
        for (const [id, record] of calendarEventsMap(this.spaceId)) {
          if (isCalendarTombstoned(this.spaceId, 'event', id)) continue;

          const existing = vaultEvents.get(id);

          if (existing && Number(existing.updated || 0) >= Number(record.updated || 0)) {
            continue;
          }

          // A member "deleted" it locally? Vault tombstone wins unless
          // the record is newer than the deletion.
          const stone = vaultTombstones.get(id);
          if (stone && Number(stone.deletedAt || 0) >= Number(record.updated || 0)) {
            continue;
          }

          const merged = {
            ...safeJsonClone(record),
            categoryId: this.categoryId,
            // Reminders are personal — inbound records never carry any;
            // whatever the owner configured locally stays.
            reminders: existing?.reminders || [],
          };

          vaultEvents.set(id, merged);
          vaultTombstones.delete(id);
        }

        for (const [key, stone] of calendarTombstonesMap(this.spaceId)) {
          if (stone?.kind !== 'event') continue;

          const id = stone.id || String(key).slice('event:'.length);
          const existing = vaultEvents.get(id);

          if (!existing) continue;
          if (existing.categoryId !== this.categoryId) continue;
          if (Number(existing.updated || 0) > Number(stone.deleted || 0)) continue;

          vaultEvents.delete(id);
          vaultTombstones.set(id, {
            id,
            type: 'calendar-event',
            title: existing.title || '',
            deletedAt: Number(stone.deleted || nowTs()),
          });
        }

        const meta = calendarMetaMap(this.spaceId).get('category');
        const cat = vaultCalendarCategoriesMap().get(this.categoryId);

        if (meta && !cat && !vaultTombstones.has(this.categoryId)) {
          // Owner mounting on a second device before their private vault
          // sync delivered the category: create it from the shared meta.
          vaultCalendarCategoriesMap().set(this.categoryId, {
            id: this.categoryId,
            name: meta.name || 'Calendar',
            icon: meta.icon,
            color: '#6ea8fe',
            visible: true,
            created: Number(meta.created || nowTs()),
            updated: Number(meta.updated || nowTs()),
          });
          vaultTombstones.delete(this.categoryId);
        } else if (meta && cat && Number(cat.updated || 0) < Number(meta.updated || 0)) {
          vaultCalendarCategoriesMap().set(this.categoryId, {
            ...safeJsonClone(cat),
            name: meta.name || cat.name,
            icon: meta.icon,
            updated: Number(meta.updated || nowTs()),
          });
        }
      }, CALENDAR_VAULT_ORIGIN);
    } finally {
      this.applying = false;
    }
  }

  // ---------------- recipient / member writes ---------------------

  /**
   * Route a local save of an event living in this shared category into
   * the calendar doc. `fullEvent` is the sanitized record including
   * personal reminders — those are split off to local storage here.
   */
  putEventFromLocal(fullEvent) {
    if (!this.canWrite || !fullEvent?.id) return null;

    setPersonalEventReminders(fullEvent.id, fullEvent.reminders || []);

    const record = sharedEventRecord(safeJsonClone(fullEvent));
    const existing = calendarEventsMap(this.spaceId).get(fullEvent.id);

    record.categoryId = this.categoryId;
    record.updatedBy = this.identity;
    record.createdBy = existing?.createdBy || record.createdBy || this.identity;

    this.doc.transact(() => {
      calendarEventsMap(this.spaceId).set(record.id, record);
      calendarTombstonesMap(this.spaceId).delete(`event:${record.id}`);
    }, CALENDAR_DOC_ORIGINS.BRIDGE);

    if (this.isOwner) return record;

    // Members may link their own notes — publish the meta and attach
    // the content doc so the note travels with the event.
    this.syncMemberLinkedNotes(record);

    return record;
  }

  deleteEventFromLocal(eventId) {
    if (!this.canWrite || !eventId) return;

    addCalendarTombstone(this.spaceId, 'event', eventId, CALENDAR_DOC_ORIGINS.BRIDGE);
    forgetPersonalEventReminders(eventId);
  }

  /** Rename/icon change of the shared category by a writer. */
  putCategoryMetaFromLocal({ name, icon }) {
    if (!this.canWrite) return;

    const existing = calendarMetaMap(this.spaceId).get('category') || {};

    this.doc.transact(() => {
      calendarMetaMap(this.spaceId).set('category', {
        ...safeJsonClone(existing),
        id: this.categoryId,
        name: name || existing.name || 'Calendar',
        icon: icon === undefined ? existing.icon : icon,
        updated: nowTs(),
      });
    }, CALENDAR_DOC_ORIGINS.BRIDGE);
  }

  syncMemberLinkedNotes(record) {
    const ids = [record.noteId, ...(record.relatedNoteIds || [])].filter(Boolean);
    if (!ids.length) return;

    this.doc.transact(() => {
      for (const id of ids) {
        const note = state.notes.get(id);
        if (!note) continue;

        calendarNotesMap(this.spaceId).set(id, sharedNoteMeta(note));
        calendarTombstonesMap(this.spaceId).delete(`note:${id}`);
      }
    }, CALENDAR_DOC_ORIGINS.BRIDGE);

    this.attachAllNoteDocs().catch(() => {});
  }

  // ---------------- linked notes: placeholders + content docs -----

  /**
   * Make every shared linked note openable locally: notes that are not
   * ours get a placeholder carrying the spaceId mark (which keeps them
   * out of the private vault sync); tombstoned ones disappear again.
   */
  async materializeNotes() {
    let changed = false;

    for (const [id, meta] of calendarNotesMap(this.spaceId)) {
      if (isCalendarTombstoned(this.spaceId, 'note', id)) continue;

      const existing = state.notes.get(id);

      if (existing) {
        // Someone else's placeholder gets meta refreshes; own notes are
        // already maintained by their owner.
        if (
          existing.spaceId === this.spaceId &&
          Number(existing.updated || 0) < Number(meta.updated || 0)
        ) {
          const next = {
            ...existing,
            title: meta.title || existing.title,
            icon: meta.icon,
            color: meta.color,
            updated: meta.updated || nowTs(),
          };

          state.notes.set(id, next);
          await store.notes.put(next);
          changed = true;
        }

        continue;
      }

      const note = {
        id,
        title: meta.title || 'Shared note',
        type: meta.type || 'markdown',
        folderId: null,
        tags: Array.isArray(meta.tags) ? [...meta.tags] : ['shared'],
        icon: meta.icon,
        color: meta.color,
        pinned: false,
        created: meta.created || nowTs(),
        updated: meta.updated || nowTs(),
        spaceId: this.spaceId,
        spaceRole: this.role,
      };

      state.notes.set(id, note);
      await store.notes.put(note);
      changed = true;
    }

    for (const [, stone] of calendarTombstonesMap(this.spaceId)) {
      if (stone?.kind !== 'note') continue;

      const note = state.notes.get(stone.id);
      if (!note || note.spaceId !== this.spaceId) continue;

      this.session.engine?.detachDoc(stone.id);
      this.attachedNotes.delete(stone.id);

      state.notes.delete(stone.id);
      await store.notes.del(stone.id);

      if (state.currentNoteId === stone.id) state.currentNoteId = null;
      changed = true;
    }

    if (changed) {
      window.dispatchEvent(new CustomEvent('yanta-calendar-space-notes-changed', {
        detail: { spaceId: this.spaceId },
      }));
    }

    return changed;
  }

  async attachNoteDoc(noteId) {
    if (this.attachedNotes.has(noteId)) return false;

    this.attachedNotes.add(noteId);
    await this.session.engine.attachDoc(noteId, noteId);
    return true;
  }

  async attachAllNoteDocs() {
    let attached = 0;

    for (const [id] of calendarNotesMap(this.spaceId)) {
      if (isCalendarTombstoned(this.spaceId, 'note', id)) continue;
      if (await this.attachNoteDoc(id)) attached += 1;
    }

    // Content of freshly attached docs wasn't part of the last pull.
    if (attached > 0) {
      this.session.engine?.pull().catch(() => {});
    }

    return attached;
  }
}

export async function installCalendarBridge(session) {
  const existing = calendarBridgeForSpace(session.spaceId);
  if (existing) return existing;

  const bridge = new CalendarBridge(session);
  await bridge.install();

  return bridge;
}

export function uninstallCalendarBridge(spaceId) {
  const bridge = calendarBridgeForSpace(spaceId);
  if (!bridge) return;

  bridge.uninstall();
}
