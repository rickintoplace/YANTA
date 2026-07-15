// ============================================================
// YANTA Shared Spaces — workspace doc
//
// A folder space shares a subtree, so it needs its own metadata CRDT
// alongside the per-note content docs. The workspace doc mirrors the
// vault-doc shape (notes / folders / tombstones maps holding the same
// record objects), which lets recipients materialize it as ordinary
// local notes and folders — the existing tree, editor and dashboard
// then work unchanged.
//
// Ownership rules:
// - The OWNER decides membership: a note/folder is in the space iff it
//   sits inside the shared root folder in the owner's vault.
// - WRITERS own the content and may create, edit and delete items
//   inside the workspace; those changes flow back to the owner's vault.
// ============================================================

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export const WORKSPACE_REMOTE_KEY = 'workspace';

// Applied when incoming remote state is merged in, so bridges can
// distinguish "someone else changed this" from local edits.
export const WORKSPACE_ORIGINS = {
  BRIDGE: 'space-workspace-bridge',
};

const entries = new Map();

export function getWorkspaceEntry(spaceId) {
  const existing = entries.get(spaceId);
  if (existing) return existing;

  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`yanta-space-workspace-${spaceId}`, doc);

  const ready = new Promise((resolve) => {
    persistence.once('synced', () => resolve());
  });

  const entry = { doc, persistence, ready };
  entries.set(spaceId, entry);

  return entry;
}

export function getWorkspaceDoc(spaceId) {
  return getWorkspaceEntry(spaceId).doc;
}

export async function waitForWorkspaceDoc(spaceId) {
  const entry = getWorkspaceEntry(spaceId);
  await entry.ready;
  return entry.doc;
}

export function workspaceNotesMap(spaceId) {
  return getWorkspaceDoc(spaceId).getMap('notes');
}

export function workspaceFoldersMap(spaceId) {
  return getWorkspaceDoc(spaceId).getMap('folders');
}

export function workspaceTombstonesMap(spaceId) {
  return getWorkspaceDoc(spaceId).getMap('tombstones');
}

export function workspaceRootMap(spaceId) {
  return getWorkspaceDoc(spaceId).getMap('root');
}

export async function destroyWorkspaceDoc(spaceId) {
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

// Only fields that make sense across vaults — no local-only state.
export function workspaceNoteMeta(note) {
  return {
    id: note.id,
    title: note.title || '',
    type: note.type || 'markdown',
    folderId: note.folderId || null,
    tags: Array.isArray(note.tags) ? [...note.tags] : [],
    icon: note.icon || undefined,
    color: note.color || undefined,
    created: note.created || Date.now(),
    updated: note.updated || Date.now(),
  };
}

export function workspaceFolderMeta(folder) {
  return {
    id: folder.id,
    name: folder.name || '',
    parentId: folder.parentId || null,
    icon: folder.icon || undefined,
    color: folder.color || undefined,
    created: folder.created || Date.now(),
    updated: folder.updated || Date.now(),
  };
}

export function addWorkspaceTombstone(spaceId, kind, id, origin) {
  const doc = getWorkspaceDoc(spaceId);

  doc.transact(() => {
    workspaceTombstonesMap(spaceId).set(`${kind}:${id}`, {
      kind,
      id,
      deleted: Date.now(),
    });

    if (kind === 'note') workspaceNotesMap(spaceId).delete(id);
    if (kind === 'folder') workspaceFoldersMap(spaceId).delete(id);
  }, origin);
}

export function isWorkspaceTombstoned(spaceId, kind, id) {
  return workspaceTombstonesMap(spaceId).has(`${kind}:${id}`);
}
