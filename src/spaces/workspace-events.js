// ============================================================
// YANTA Shared Spaces — events of a folder workspace
//
// A note that is due on Thursday is not fully shared if Thursday stays
// behind. So a folder space carries the calendar events linked to the
// notes inside it, next to the notes themselves.
//
// Ownership model (v1):
// - The OWNER's vault stays the source of truth. What travels is a
//   pure function of "vault events × notes currently in the subtree",
//   minus the events the owner opted out of, so membership changes
//   (a note moves in or out) are just another refresh.
// - RECIPIENTS read. Their copies live in the space doc and are folded
//   into the in-memory calendar with a spaceId mark — never into their
//   own vault, exactly like a mounted shared calendar.
//
// Write access for members is deliberately NOT part of this: it needs
// the conflict and attribution machinery of a full calendar space. The
// provider contract below is the seam where it would plug in.
// ============================================================

import { store } from '../core.js';

import {
  waitForVaultDoc,
  vaultCalendarCategoriesMap,
  vaultEventsMap,
  vaultTombstonesMap,
  safeJsonClone,
} from '../sync2/vault-doc.js';

import {
  WORKSPACE_ORIGINS,
  waitForWorkspaceDoc,
  workspaceEventsMap,
  workspaceCategoriesMap,
  workspaceNotesMap,
  workspaceTombstonesMap,
  isWorkspaceTombstoned,
} from './workspace-doc.js';

import {
  sharedEventRecord,
  sharedCategoryMeta,
  linkedVaultEvents,
  scopeEventNoteLinks,
} from './shared-events.js';

import {
  registerSpaceEventProvider,
  unregisterSpaceEventProvider,
} from './calendar-registry.js';

import { SPACE_REMOTE_ORIGIN } from './space-engine.js';

const REFRESH_DEBOUNCE_MS = 250;

/** The calendar module re-folds mounted spaces on this. */
function emitCalendarChanged() {
  window.dispatchEvent(new CustomEvent('yanta-calendar-space-applied'));
}

export class WorkspaceEvents {
  constructor(session) {
    this.session = session;
    this.spaceId = session.spaceId;
    this.role = session.role;
    this.isOwner = session.role === 'owner';
    this.canWrite = session.role === 'owner' || session.role === 'write';

    this.doc = null;
    this.refreshTimer = null;
    this.vaultUnsubs = [];
    this.docObservers = [];
  }

  // ---------------- install / uninstall ---------------------------

  async install() {
    this.doc = await waitForWorkspaceDoc(this.spaceId);

    if (this.isOwner) {
      await waitForVaultDoc();
      this.refresh();
      this.observeVault();
    }

    this.observeDoc();

    registerSpaceEventProvider(this);

    // Recipients may already have events from IndexedDB — tell the
    // calendar before the first pull even starts.
    if (!this.isOwner && this.events().length) emitCalendarChanged();
  }

  uninstall() {
    clearTimeout(this.refreshTimer);

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

    unregisterSpaceEventProvider(this.spaceId);

    // Whatever this space contributed to the calendar has to go.
    if (!this.isOwner) emitCalendarChanged();
  }

  // ---------------- membership ------------------------------------

  /** Notes currently shared through this space. */
  sharedNoteIds() {
    const ids = new Set();

    for (const [id] of workspaceNotesMap(this.spaceId)) {
      if (isWorkspaceTombstoned(this.spaceId, 'note', id)) continue;
      ids.add(String(id));
    }

    return ids;
  }

  excludedEventIds() {
    return new Set(this.session.record.excludedEventIds || []);
  }

  /** Owner-only: the share dialog toggled which linked events travel. */
  async setExcludedEventIds(eventIds) {
    if (!this.isOwner) return;

    this.session.record.excludedEventIds = [...new Set((eventIds || []).map(String))];

    await store.spaces.put(this.session.record);

    this.refresh();
  }

  /** Linked events the owner could share, whether they do or not. */
  linkableEvents() {
    if (!this.isOwner) return [];

    return [...linkedVaultEvents(this.sharedNoteIds()).values()]
      .map((raw) => safeJsonClone(raw));
  }

  // ---------------- owner: vault → doc ----------------------------

  scheduleRefresh() {
    if (!this.isOwner) return;

    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  /**
   * Bring the doc in line with the vault. Everything here is derived,
   * so the doc is rewritten wherever it differs — no last-writer-wins
   * needed while the owner is the only writer.
   */
  refresh() {
    if (!this.isOwner || !this.doc) return;

    const noteIds = this.sharedNoteIds();
    const excluded = this.excludedEventIds();
    const linked = linkedVaultEvents(noteIds);

    const events = workspaceEventsMap(this.spaceId);
    const categories = workspaceCategoriesMap(this.spaceId);
    const tombstones = workspaceTombstonesMap(this.spaceId);

    const next = new Map();

    for (const [id, raw] of linked) {
      if (excluded.has(id)) continue;

      next.set(id, scopeEventNoteLinks(sharedEventRecord(safeJsonClone(raw)), noteIds));
    }

    const gone = [...events.keys()].filter((id) => !next.has(id));

    const referenced = new Set(
      [...next.values()].map((record) => record.categoryId).filter(Boolean)
    );

    const staleCategories = [...categories.keys()].filter((id) => !referenced.has(id));

    this.doc.transact(() => {
      for (const [id, record] of next) {
        const existing = events.get(id);

        if (existing && JSON.stringify(existing) === JSON.stringify(record)) continue;

        events.set(id, record);
        tombstones.delete(`event:${id}`);
      }

      for (const id of gone) {
        events.delete(id);
        tombstones.set(`event:${id}`, { kind: 'event', id, deleted: Date.now() });
      }

      // Category names travel so a recipient sees "Work", not an
      // orphaned event. Color and visibility stay personal.
      for (const categoryId of referenced) {
        const cat = vaultCalendarCategoriesMap().get(categoryId);
        if (!cat) continue;

        const meta = sharedCategoryMeta(cat);
        const existing = categories.get(categoryId);

        if (existing && JSON.stringify(existing) === JSON.stringify(meta)) continue;

        categories.set(categoryId, meta);
      }

      for (const id of staleCategories) {
        categories.delete(id);
      }
    }, WORKSPACE_ORIGINS.BRIDGE);
  }

  observeVault() {
    const handler = () => this.scheduleRefresh();

    const maps = [vaultEventsMap(), vaultTombstonesMap(), vaultCalendarCategoriesMap()];

    for (const map of maps) {
      map.observe(handler);
      this.vaultUnsubs.push(() => map.unobserve(handler));
    }
  }

  // ---------------- doc → calendar (recipients) -------------------

  observeDoc() {
    const handler = (_e, tx) => {
      if (tx.origin !== SPACE_REMOTE_ORIGIN) return;

      emitCalendarChanged();
    };

    const maps = [
      workspaceEventsMap(this.spaceId),
      workspaceCategoriesMap(this.spaceId),
      workspaceTombstonesMap(this.spaceId),
    ];

    for (const map of maps) {
      map.observe(handler);
      this.docObservers.push({ map, handler });
    }
  }

  // ---------------- provider view (calendar hydration) ------------

  events() {
    const out = [];

    for (const [id, raw] of workspaceEventsMap(this.spaceId)) {
      if (isWorkspaceTombstoned(this.spaceId, 'event', id)) continue;

      out.push(safeJsonClone(raw));
    }

    return out;
  }

  categories() {
    const out = [];

    for (const [, raw] of workspaceCategoriesMap(this.spaceId)) {
      out.push(safeJsonClone(raw));
    }

    return out;
  }

  get title() {
    return this.session.record.title || '';
  }
}
