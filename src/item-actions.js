// ============================================================
// YANTA — Shared item actions
// Centralized note/folder actions used by Tree, Dashboard, Graph, etc.
// ============================================================

import {
  $,
  state,
  store,
  toast,
} from './core.js';

export async function refreshSearchIndexForNote(note) {
  if (!note) return;

  try {
    const {
      noteMarkdown,
      drawingsTextForNote,
      citationsTextForNote,
    } = await import('./yjs.js');

    let body = '';

    try {
      body = noteMarkdown(note.id);
    } catch {}

    state.searchIndex.set(
      note.id,
      [
        note.title || '',
        (note.tags || []).join(' '),
        body || '',
        drawingsTextForNote(note.id) || '',
        citationsTextForNote(note.id) || '',
      ].join(' ').toLowerCase()
    );
  } catch {
    state.searchIndex.set(
      note.id,
      [
        note.title || '',
        (note.tags || []).join(' '),
      ].join(' ').toLowerCase()
    );
  }
}

export async function openFolderInDashboard(folderId, {
  push = true,
  replace = false,
} = {}) {
  const { showDashboard } = await import('./dashboard.js');

  showDashboard({
    folderId: folderId || null,
    push,
    replace,
  });
}

export async function renameNoteById(noteId, value, {
  silent = false,
} = {}) {
  const note = state.notes.get(noteId);
  if (!note) return false;

  const clean = String(value || '').trim() || 'Untitled';

  if (note.title === clean) {
    return note.title;
  }

  note.title = clean;
  note.updated = Date.now();

  await store.notes.put(note);
  await refreshSearchIndexForNote(note);

  if (state.currentNoteId === note.id) {
    const titleInput = $('noteTitle');

    if (titleInput) {
      titleInput.value = note.title;
    }
  }

  try {
    const { rebuildWikilinkIndex } = await import('./notes.js');
    rebuildWikilinkIndex();
  } catch {}

  try {
    const { renderTree } = await import('./tree.js');
    renderTree();
  } catch {}

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: { noteId: note.id },
  }));

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));

  if (!silent) {
    toast('Note renamed', 'success');
  }

  return note.title;
}

export async function renameFolderById(folderId, value, {
  silent = false,
  refreshTree = true,
  refreshDashboard = true,
} = {}) {
  const folder = state.folders.get(folderId);
  if (!folder) return false;

  const clean = String(value || '').trim() || 'Folder';

  if (folder.name === clean) {
    return folder.name;
  }

  folder.name = clean;
  folder.updated = Date.now();

  await store.folders.put(folder);

  if (refreshTree) {
    try {
      const { renderTree } = await import('./tree.js');
      renderTree();
    } catch {}
  }
  
  window.dispatchEvent(new CustomEvent('yanta-folder-updated', {
    detail: {
      folderId: folder.id,
      name: folder.name,
      refreshDashboard,
    },
  }));
  
  if (refreshDashboard) {
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
      detail: {
        reason: 'folder-renamed',
        folderId: folder.id,
        source: 'item-actions',
      },
    }));
  }

  if (!silent) {
    toast('Folder renamed', 'success');
  }

  return folder.name;
}