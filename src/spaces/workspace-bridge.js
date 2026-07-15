// ============================================================
// YANTA Shared Spaces — workspace bridge
//
// Keeps a folder space's workspace doc and the local vault in sync,
// in both directions, for owner and recipients alike.
//
// Item IDs are shared: the owner's note/folder IDs are canonical and
// recipients materialize items under the same IDs, so per-note content
// docs (`yanta-note-<id>`) line up on every participant without any
// mapping table.
//
// Marking differs by role, and it matters:
// - Recipients mark materialized items with `spaceId`, which keeps them
//   out of their private vault sync (see isSpaceMountedNote).
// - The owner marks nothing: those are their own notes in their own
//   folder and must keep syncing to their own vault as usual.
// ============================================================

import { state, store, uid } from '../core.js';
import { renderTree } from '../tree.js';
import { getNoteDoc } from '../yjs.js';

import {
  WORKSPACE_ORIGINS,
  waitForWorkspaceDoc,
  workspaceNotesMap,
  workspaceFoldersMap,
  workspaceTombstonesMap,
  workspaceRootMap,
  workspaceNoteMeta,
  workspaceFolderMeta,
  addWorkspaceTombstone,
  isWorkspaceTombstoned,
} from './workspace-doc.js';

const bridges = new Map();

// ---------------- store hooks (installed once) -------------------
//
// Several folder spaces can be mounted at the same time, so the store
// wrappers are installed once and fan out to every live bridge rather
// than each bridge wrapping (and un-wrapping) the store itself.

let storeHooksInstalled = false;
let suppressDepth = 0;

/** Local vault writes caused BY the workspace must not bounce back into it. */
async function withoutWorkspaceHooks(fn) {
  suppressDepth += 1;

  try {
    return await fn();
  } finally {
    suppressDepth -= 1;
  }
}

function installStoreHooks() {
  if (storeHooksInstalled) return;
  storeHooksInstalled = true;

  const original = {
    notePut: store.notes.put.bind(store.notes),
    noteDel: store.notes.del.bind(store.notes),
    folderPut: store.folders.put.bind(store.folders),
    folderDel: store.folders.del.bind(store.folders),
  };

  store.notes.put = async (note) => {
    const res = await original.notePut(note);

    if (!suppressDepth) {
      for (const bridge of bridges.values()) {
        if (bridge.canWrite) await bridge.syncNoteOut(note);
      }
    }

    return res;
  };

  store.notes.del = async (id) => {
    const existing = state.notes.get(id);
    const res = await original.noteDel(id);

    if (!suppressDepth) {
      for (const bridge of bridges.values()) {
        if (bridge.canWrite) await bridge.removeNoteOut(id, existing);
      }
    }

    return res;
  };

  store.folders.put = async (folder) => {
    const res = await original.folderPut(folder);

    if (!suppressDepth) {
      for (const bridge of bridges.values()) {
        if (bridge.canWrite) await bridge.syncFolderOut(folder);
      }
    }

    return res;
  };

  store.folders.del = async (id) => {
    const existing = state.folders.get(id);
    const res = await original.folderDel(id);

    if (!suppressDepth) {
      for (const bridge of bridges.values()) {
        if (bridge.canWrite) await bridge.removeFolderOut(id, existing);
      }
    }

    return res;
  };
}

// ---------------- vault helpers ---------------------------------

function folderAncestors(folderId) {
  const chain = [];
  const seen = new Set();

  let current = folderId;

  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = state.folders.get(current)?.parentId || null;
  }

  return chain;
}

function isInSubtree(folderId, rootFolderId) {
  if (!folderId) return false;
  return folderAncestors(folderId).includes(rootFolderId);
}

function subtreeFolders(rootFolderId) {
  return [...state.folders.values()].filter(
    (f) => f.id === rootFolderId || isInSubtree(f.parentId, rootFolderId)
  );
}

function subtreeNotes(rootFolderId) {
  return [...state.notes.values()].filter((n) => isInSubtree(n.folderId, rootFolderId));
}

// ---------------- bridge ----------------------------------------

class WorkspaceBridge {
  constructor(session) {
    this.session = session;
    this.spaceId = session.spaceId;
    this.role = session.role;
    this.isOwner = session.role === 'owner';
    this.canWrite = session.role === 'owner' || session.role === 'write';

    // Owner: the shared root folder in their own vault.
    // Recipient: the local folder the workspace is materialized into.
    this.rootFolderId = session.record.rootFolderId || '';

    this.observer = null;
    this.attachedNotes = new Set();
    this.applying = false;
  }

  async install() {
    await waitForWorkspaceDoc(this.spaceId);

    installStoreHooks();

    if (this.isOwner) {
      await this.seedFromVault();
    }

    this.observeWorkspace();

    // Recipients may already have workspace state from a previous
    // session (IndexedDB) or from the first pull.
    if (!this.isOwner) {
      await this.materializeAll();
    }

    await this.attachAllNoteDocs();
  }

  uninstall() {
    if (this.observer) {
      try {
        this.session.workspaceDoc?.off('update', this.observer);
      } catch {}
      this.observer = null;
    }
  }

  // ---------- owner: vault → workspace (initial seed) ----------

  async seedFromVault() {
    const root = state.folders.get(this.rootFolderId);
    if (!root) return;

    const doc = await waitForWorkspaceDoc(this.spaceId);

    doc.transact(() => {
      workspaceRootMap(this.spaceId).set('folderId', this.rootFolderId);
      workspaceRootMap(this.spaceId).set('name', root.name || 'Shared folder');

      for (const folder of subtreeFolders(this.rootFolderId)) {
        workspaceFoldersMap(this.spaceId).set(folder.id, workspaceFolderMeta(folder));
      }

      for (const note of subtreeNotes(this.rootFolderId)) {
        workspaceNotesMap(this.spaceId).set(note.id, workspaceNoteMeta(note));
      }
    }, WORKSPACE_ORIGINS.BRIDGE);
  }

  // ---------- workspace → vault ----------

  observeWorkspace() {
    this.observer = (_update, origin) => {
      // Ignore our own writes; react to everything that came from a
      // remote participant (applied by the SpaceEngine).
      if (origin === WORKSPACE_ORIGINS.BRIDGE) return;

      this.materializeAll().catch((err) => {
        console.warn('[YANTA Spaces] workspace materialize failed', err);
      });
    };

    this.session.workspaceDoc.on('update', this.observer);
  }

  /**
   * Reconcile the local vault with the workspace doc: create/update
   * folders and notes, apply tombstones, attach new note docs.
   */
  async materializeAll() {
    if (this.applying) return;
    this.applying = true;

    try {
      // Recipients can only materialize once the workspace root has
      // arrived (it ships in the same head as the notes). Acting before
      // that would coin a fallback root-folder ID that then diverges
      // from the owner's, orphaning anything created against it.
      if (!this.isOwner && !this.workspaceRootFolderId()) {
        return;
      }

      const notes = workspaceNotesMap(this.spaceId);
      const folders = workspaceFoldersMap(this.spaceId);
      const tombstones = workspaceTombstonesMap(this.spaceId);

      let changed = false;

      if (!this.isOwner && !this.rootFolderId) {
        await this.ensureRecipientRootFolder();
        changed = true;
      }

      // Folders first, so notes always find their parent.
      for (const [id, meta] of folders) {
        if (id === this.workspaceRootFolderId()) continue;
        if (await this.applyFolder(id, meta)) changed = true;
      }

      for (const [id, meta] of notes) {
        if (await this.applyNote(id, meta)) changed = true;
      }

      for (const [, stone] of tombstones) {
        if (await this.applyTombstone(stone)) changed = true;
      }

      const attached = await this.attachAllNoteDocs();

      // Newly attached content docs weren't part of the pull that just
      // finished — pull again so their bodies arrive without waiting for
      // the next poke or poll tick.
      if (attached > 0) {
        this.session.engine?.pull().catch(() => {});
      }

      if (changed) renderTree();
    } finally {
      this.applying = false;
    }
  }

  workspaceRootFolderId() {
    return String(workspaceRootMap(this.spaceId).get('folderId') || '');
  }

  async ensureRecipientRootFolder() {
    const name = String(workspaceRootMap(this.spaceId).get('name') || 'Shared folder');

    // The root folder ID is the owner's, shared through the workspace
    // doc, so recipients and owner agree on it. (materializeAll only
    // calls this once that ID is present.)
    const folder = {
      id: this.workspaceRootFolderId(),
      name,
      parentId: null,
      created: Date.now(),
      updated: Date.now(),
      spaceId: this.spaceId,
      spaceRole: this.role,
    };

    this.rootFolderId = folder.id;
    this.session.record.rootFolderId = folder.id;

    state.folders.set(folder.id, folder);
    await this.withoutHooks(() => store.folders.put(folder));
    await store.spaces.put(this.session.record);
  }

  async withoutHooks(fn) {
    return withoutWorkspaceHooks(fn);
  }

  async applyFolder(id, meta) {
    if (isWorkspaceTombstoned(this.spaceId, 'folder', id)) return false;

    const existing = state.folders.get(id);

    // Last-writer-wins on the CRDT record's own timestamp.
    if (existing && Number(existing.updated || 0) >= Number(meta.updated || 0)) {
      return false;
    }

    const parentId =
      meta.parentId && meta.parentId !== this.workspaceRootFolderId()
        ? meta.parentId
        : this.rootFolderId;

    const folder = {
      ...(existing || {}),
      id,
      name: meta.name || '',
      parentId: id === this.rootFolderId ? (existing?.parentId ?? null) : parentId,
      icon: meta.icon,
      color: meta.color,
      created: meta.created || Date.now(),
      updated: meta.updated || Date.now(),
    };

    if (!this.isOwner) {
      folder.spaceId = this.spaceId;
      folder.spaceRole = this.role;
    }

    state.folders.set(id, folder);
    await this.withoutHooks(() => store.folders.put(folder));

    return true;
  }

  async applyNote(id, meta) {
    if (isWorkspaceTombstoned(this.spaceId, 'note', id)) return false;

    const existing = state.notes.get(id);

    if (existing && Number(existing.updated || 0) >= Number(meta.updated || 0)) {
      return false;
    }

    const folderId =
      meta.folderId && meta.folderId !== this.workspaceRootFolderId()
        ? meta.folderId
        : this.rootFolderId;

    const note = {
      ...(existing || {}),
      id,
      title: meta.title || 'Untitled',
      type: meta.type || 'markdown',
      folderId,
      tags: Array.isArray(meta.tags) ? [...meta.tags] : [],
      icon: meta.icon,
      color: meta.color,
      pinned: existing?.pinned || false,
      created: meta.created || Date.now(),
      updated: meta.updated || Date.now(),
    };

    if (!this.isOwner) {
      note.spaceId = this.spaceId;
      note.spaceRole = this.role;
    }

    state.notes.set(id, note);
    await this.withoutHooks(() => store.notes.put(note));

    return true;
  }

  async applyTombstone(stone) {
    const { kind, id } = stone || {};
    if (!kind || !id) return false;

    if (kind === 'note' && state.notes.has(id)) {
      this.session.engine?.detachDoc(id);
      this.attachedNotes.delete(id);

      state.notes.delete(id);
      await this.withoutHooks(() => store.notes.del(id));

      if (state.currentNoteId === id) state.currentNoteId = null;

      return true;
    }

    if (kind === 'folder' && state.folders.has(id) && id !== this.rootFolderId) {
      state.folders.delete(id);
      await this.withoutHooks(() => store.folders.del(id));
      return true;
    }

    return false;
  }

  // ---------- vault → workspace (live) ----------

  belongsToSpace(item) {
    if (!item) return false;

    if (this.isOwner) {
      const folderId = item.folderId ?? item.parentId ?? null;
      return item.id === this.rootFolderId || isInSubtree(folderId, this.rootFolderId);
    }

    return item.spaceId === this.spaceId;
  }

  async removeNoteOut(id, existing) {
    if (!this.belongsToSpace(existing)) return;

    addWorkspaceTombstone(this.spaceId, 'note', id, WORKSPACE_ORIGINS.BRIDGE);
    this.session.engine?.detachDoc(id);
    this.attachedNotes.delete(id);
  }

  async removeFolderOut(id, existing) {
    if (!this.belongsToSpace(existing)) return;
    if (id === this.rootFolderId) return;

    addWorkspaceTombstone(this.spaceId, 'folder', id, WORKSPACE_ORIGINS.BRIDGE);
  }

  async syncNoteOut(note) {
    const inSpace = this.belongsToSpace(note);
    const known = workspaceNotesMap(this.spaceId).has(note.id);

    if (!inSpace) {
      // The owner moved a note out of the shared folder — it leaves
      // the space (content already uploaded stays until compaction).
      if (known && this.isOwner) {
        addWorkspaceTombstone(this.spaceId, 'note', note.id, WORKSPACE_ORIGINS.BRIDGE);
        this.session.engine?.detachDoc(note.id);
        this.attachedNotes.delete(note.id);
      }

      return;
    }

    getNoteDoc(note.id);

    this.session.workspaceDoc.transact(() => {
      workspaceNotesMap(this.spaceId).set(note.id, workspaceNoteMeta(note));
    }, WORKSPACE_ORIGINS.BRIDGE);

    await this.attachNoteDoc(note.id);
  }

  async syncFolderOut(folder) {
    const inSpace = this.belongsToSpace(folder);
    const known = workspaceFoldersMap(this.spaceId).has(folder.id);

    if (!inSpace) {
      if (known && this.isOwner) {
        addWorkspaceTombstone(this.spaceId, 'folder', folder.id, WORKSPACE_ORIGINS.BRIDGE);
      }

      return;
    }

    this.session.workspaceDoc.transact(() => {
      workspaceFoldersMap(this.spaceId).set(folder.id, workspaceFolderMeta(folder));
    }, WORKSPACE_ORIGINS.BRIDGE);
  }

  // ---------- note content docs ----------

  async attachNoteDoc(noteId) {
    if (this.attachedNotes.has(noteId)) return false;

    this.attachedNotes.add(noteId);

    // Remote key = the shared item ID, identical on every participant.
    await this.session.engine.attachDoc(noteId, noteId);
    return true;
  }

  async attachAllNoteDocs() {
    let attached = 0;

    for (const id of workspaceNotesMap(this.spaceId).keys()) {
      if (isWorkspaceTombstoned(this.spaceId, 'note', id)) continue;
      if (await this.attachNoteDoc(id)) attached += 1;
    }

    return attached;
  }
}

export async function installWorkspaceBridge(session) {
  if (bridges.has(session.spaceId)) return bridges.get(session.spaceId);

  const bridge = new WorkspaceBridge(session);
  bridges.set(session.spaceId, bridge);

  await bridge.install();

  return bridge;
}

export function uninstallWorkspaceBridge(spaceId) {
  const bridge = bridges.get(spaceId);
  if (!bridge) return;

  bridge.uninstall();
  bridges.delete(spaceId);
}

/**
 * Local IDs for a brand-new item created inside a workspace by a
 * recipient — kept identical in shape to vault IDs so nothing else
 * needs to know the difference.
 */
export function newWorkspaceItemId() {
  return uid();
}
