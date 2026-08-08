// ============================================================
// YANTA — Trash / Soft Delete
//
// Normal delete = move to Trash.
// Permanent delete = real IndexedDB/Yjs/Vault tombstone deletion.
//
// Important:
// - Soft-delete NEVER calls store.notes.del()/store.folders.del()
// - Soft-delete NEVER destroys Y.Doc
// - Permanent delete is only used from Trash
// ============================================================

import {
    state,
    store,
    toast,
    actionToast,
  } from './core.js';

  import { t } from './i18n/index.js';

  import {
    destroyNoteDoc,
    noteMarkdown,
    drawingsTextForNote,
    citationsTextForNote,
  } from './yjs.js';
  
  const NOW = () => Date.now();
  
  function cleanUndefined(obj = {}) {
    const out = {};
  
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) out[key] = value;
    }
  
    return out;
  }
  
  async function deviceIdBestEffort() {
    try {
      let id = await store.settings.get('deviceId', null);
  
      if (!id) {
        id =
          'dev_' +
          Math.random().toString(36).slice(2, 10) +
          Date.now().toString(36).slice(-4);
  
        await store.settings.set('deviceId', id);
      }
  
      return id;
    } catch {
      return 'dev_unknown';
    }
  }
  
  export function folderPathIds(folderId) {
    const out = [];
    const seen = new Set();
  
    let f = folderId ? state.folders.get(folderId) : null;
  
    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      out.unshift(f.id);
      f = f.parentId ? state.folders.get(f.parentId) : null;
    }
  
    return out;
  }
  
  export function folderPathNames(folderId) {
    return folderPathIds(folderId)
      .map((id) => state.folders.get(id)?.name || t('items.folderFallback'));
  }
  
  export function folderHasTrashedAncestor(folderId) {
    const seen = new Set();
    let f = folderId ? state.folders.get(folderId) : null;
  
    while (f && !seen.has(f.id)) {
      if (f.trashed === true) return true;
  
      seen.add(f.id);
      f = f.parentId ? state.folders.get(f.parentId) : null;
    }
  
    return false;
  }
  
  export function isFolderInTrash(folder) {
    if (!folder) return false;
  
    return (
      folder.trashed === true ||
      folderHasTrashedAncestor(folder.parentId)
    );
  }
  
  export function isNoteInTrash(note) {
    if (!note) return false;
  
    return (
      note.trashed === true ||
      folderHasTrashedAncestor(note.folderId)
    );
  }
  
  export function trashCount() {
    let count = 0;
  
    for (const note of state.notes.values()) {
      if (isNoteInTrash(note)) count++;
    }
  
    for (const folder of state.folders.values()) {
      if (isFolderInTrash(folder)) count++;
    }
  
    return count;
  }
  
  export function collectTrashedRootItems() {
    const folders = [...state.folders.values()]
      .filter((folder) => folder.trashed === true)
      .filter((folder) => !folderHasTrashedAncestor(folder.parentId))
      .sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
  
    const notes = [...state.notes.values()]
      .filter((note) => note.trashed === true)
      .filter((note) => !folderHasTrashedAncestor(note.folderId))
      .sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
  
    return {
      folders,
      notes,
    };
  }
  
  function folderIsAncestor(ancestorId, descendantId) {
    if (!ancestorId || !descendantId) return false;
  
    let cur = state.folders.get(descendantId);
    const seen = new Set();
  
    while (cur && !seen.has(cur.id)) {
      if (cur.id === ancestorId) return true;
  
      seen.add(cur.id);
      cur = cur.parentId ? state.folders.get(cur.parentId) : null;
    }
  
    return false;
  }
  
  function validRestoreFolder(folderId) {
    if (!folderId) return false;
  
    const folder = state.folders.get(folderId);
  
    return !!folder && !isFolderInTrash(folder);
  }
  
  function updateSearchIndexForNote(note) {
    if (!note) return;
  
    if (isNoteInTrash(note)) {
      state.searchIndex.delete(note.id);
      return;
    }
  
    let md = '';
  
    try {
      md = noteMarkdown(note.id);
    } catch {}
  
    state.searchIndex.set(
      note.id,
      [
        note.title || '',
        (note.tags || []).join(' '),
        md,
        drawingsTextForNote(note.id) || '',
        citationsTextForNote(note.id) || '',
      ].join(' ').toLowerCase()
    );
  }
  
  async function clearEditorIfCurrentWasMovedToTrash(noteIds = new Set(), folderIds = new Set()) {
    if (!state.currentNoteId) return;
  
    if (noteIds.has(state.currentNoteId)) {
      try {
        const { clearEditor } = await import('./notes.js');
        clearEditor();
      } catch {}
  
      return;
    }
  
    const current = state.notes.get(state.currentNoteId);
  
    if (!current) return;
  
    if (current.folderId) {
      for (const folderId of folderIds) {
        if (
          current.folderId === folderId ||
          folderIsAncestor(folderId, current.folderId)
        ) {
          try {
            const { clearEditor } = await import('./notes.js');
            clearEditor();
          } catch {}
  
          return;
        }
      }
    }
  }
  
  async function emitTrashChanged(detail = {}) {
    try {
      const { rebuildWikilinkIndex } = await import('./notes.js');
      rebuildWikilinkIndex();
    } catch {}
  
    try {
      const { renderTree } = await import('./tree.js');
      renderTree();
    } catch {}
  
    window.dispatchEvent(new CustomEvent('yanta-trash-changed', {
      detail,
    }));
  
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
      detail: {
        reason: 'trash-changed',
        source: 'trash',
        ...detail,
      },
    }));
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: {
        reason: 'trash-changed',
        source: 'trash',
        ...detail,
      },
    }));
  }
  
  /*
    A note and its calendar event are two separate objects, and only the note
    is covered by the Undo toast. So the link is ALWAYS cut when the note goes
    to trash — a trashed note that still owns a date left the calendar showing
    an entry pointing at something the user believes they deleted.

    Whether the event itself goes too is a decision only the user can make, and
    it is asked once, at the UI entry point, not per note inside a bulk loop.

    calendar.js is imported lazily: it pulls in FullCalendar, and trashing a
    note must not drag that in for the majority of notes that have no date.
  */
  async function detachLinkedCalendarEvent(noteId, { deleteEvent = false } = {}) {
    try {
      const calendar = await import('./calendar.js');
      const ev = calendar.calendarEventForNoteId(noteId);

      if (!ev) return null;

      if (deleteEvent) {
        calendar.deleteCalendarEvent(ev.id);
      } else {
        calendar.unlinkEventNote(ev.id);
      }

      return ev;
    } catch (err) {
      console.warn('[YANTA trash] could not detach the linked event', err);
      return null;
    }
  }

  /**
   * The event linked to a note, or null. Used by the UI to decide whether the
   * "delete the date as well?" question is worth asking at all.
   */
  export async function linkedCalendarEventForNote(noteId) {
    try {
      const calendar = await import('./calendar.js');
      return calendar.calendarEventForNoteId(noteId);
    } catch {
      return null;
    }
  }

  export async function moveNoteToTrash(noteId, {
    source = 'user',
    toastMessage = '',
    deleteLinkedEvent = false,
  } = {}) {
    const note = state.notes.get(String(noteId || ''));
  
    if (!note) return false;
    if (note.aiSession === true || note.type === 'ai-session') {
      toast(t('trash.aiSessionsDirect'), 'error');
      return false;
    }
    if (note.trashed === true) return true;
  
    const deletedAt = NOW();
  
    Object.assign(note, cleanUndefined({
      trashed: true,
      deletedAt,
      deletedBy: await deviceIdBestEffort(),
      trashOriginalFolderId: note.folderId || null,
      trashOriginalFolderPath: folderPathNames(note.folderId),
      updated: deletedAt,
    }));
  
    await store.notes.put(note);

    state.searchIndex.delete(note.id);

    await detachLinkedCalendarEvent(note.id, { deleteEvent: deleteLinkedEvent });

    await clearEditorIfCurrentWasMovedToTrash(new Set([note.id]), new Set());

    await emitTrashChanged({
      action: 'trash-note',
      noteId: note.id,
      source,
    });
  
    if (toastMessage) {
      toast(toastMessage, 'success');
    }
  
    return true;
  }
  
  export async function moveFolderToTrash(folderId, {
    source = 'user',
    toastMessage = '',
  } = {}) {
    const folder = state.folders.get(String(folderId || ''));
  
    if (!folder) return false;
    if (folder.aiSessionRoot === true) {
      toast(t('trash.aiSessionsFolderDirect'), 'error');
      return false;
    }
    if (folder.trashed === true) return true;
  
    const deletedAt = NOW();
  
    Object.assign(folder, cleanUndefined({
      trashed: true,
      deletedAt,
      deletedBy: await deviceIdBestEffort(),
      trashOriginalParentId: folder.parentId || null,
      trashOriginalParentPath: folderPathNames(folder.parentId),
      updated: deletedAt,
    }));
  
    await store.folders.put(folder);
  
    await clearEditorIfCurrentWasMovedToTrash(new Set(), new Set([folder.id]));
  
    await emitTrashChanged({
      action: 'trash-folder',
      folderId: folder.id,
      source,
    });
  
    if (toastMessage) {
      toast(toastMessage, 'success');
    }
  
    return true;
  }
  
  export async function moveItemsToTrash({
    noteIds = [],
    folderIds = [],
    source = 'user',
    silent = false,
    deleteLinkedEvent = false,
  } = {}) {
    const folderSet = new Set([...folderIds].map(String).filter(Boolean));
  
    // Skip notes that are already inside a folder that is moved to trash.
    const effectiveNoteIds = [...new Set([...noteIds].map(String).filter(Boolean))]
      .filter((noteId) => {
        const note = state.notes.get(noteId);
        if (!note?.folderId) return true;
  
        for (const folderId of folderSet) {
          if (
            note.folderId === folderId ||
            folderIsAncestor(folderId, note.folderId)
          ) {
            return false;
          }
        }
  
        return true;
      });
  
    // Skip folders whose ancestor is already moved to trash.
    const effectiveFolderIds = [...folderSet].filter((folderId) => {
      const folder = state.folders.get(folderId);
      if (!folder) return false;
  
      for (const otherId of folderSet) {
        if (otherId !== folderId && folderIsAncestor(otherId, folderId)) {
          return false;
        }
      }
  
      return true;
    });
  
    const trashedNoteIds = [];
    const trashedFolderIds = [];

    for (const noteId of effectiveNoteIds) {
      if (await moveNoteToTrash(noteId, { source, deleteLinkedEvent })) trashedNoteIds.push(noteId);
    }

    for (const folderId of effectiveFolderIds) {
      if (await moveFolderToTrash(folderId, { source })) trashedFolderIds.push(folderId);
    }

    const changed = trashedNoteIds.length + trashedFolderIds.length;

    if (changed && !silent) {
      toast(t('trash.movedToTrash', { count: changed }), 'success');
    }

    return {
      changed,
      noteIds: trashedNoteIds,
      folderIds: trashedFolderIds,
    };
  }

  // Move to trash, then surface a non-blocking Undo toast. This is the
  // entry point UI call sites should use instead of a confirm() dialog:
  // the action is reversible from Trash, so we execute immediately and
  // let the user reverse it, rather than blocking on a prompt first.
  export async function trashItemsWithUndo({
    noteIds = [],
    folderIds = [],
    source = 'user',
  } = {}) {
    /*
      The one place a question is warranted in a flow that otherwise refuses to
      ask: the linked event is a second object, and Undo does not bring it back.

      Only for a single note, and only when a date is actually attached — a
      dialog per note during a bulk delete would be worse than the problem it
      solves. In the bulk case the link is still cut; the events simply survive.
    */
    let deleteLinkedEvent = false;

    if (noteIds.length === 1 && !folderIds.length) {
      const ev = await linkedCalendarEventForNote(String(noteIds[0]));

      if (ev) {
        const { yantaConfirm } = await import('./dialogs.js');

        deleteLinkedEvent = await yantaConfirm({
          title: t('trash.linkedEvent.title'),
          message: t('trash.linkedEvent.message', { title: ev.title || '' }),
          confirmLabel: t('trash.linkedEvent.delete'),
          cancelLabel: t('trash.linkedEvent.keep'),
          icon: 'calendar-x',
        });
      }
    }

    const result = await moveItemsToTrash({
      noteIds,
      folderIds,
      source,
      silent: true,
      deleteLinkedEvent,
    });

    if (!result.changed) return result;

    const noteCount = result.noteIds.length;
    const folderCount = result.folderIds.length;

    const parts = [];
    if (noteCount) parts.push(t('tree.bulk.notesLabel', { count: noteCount }));
    if (folderCount) parts.push(t('tree.bulk.foldersLabel', { count: folderCount }));

    actionToast(t('trash.movedSummary', { summary: parts.join(t('trash.summarySep')) }), {
      actionLabel: t('common.undo'),
      onAction: async () => {
        for (const noteId of result.noteIds) {
          await restoreNoteFromTrash(noteId, { source: `${source}-undo`, silent: true });
        }

        for (const folderId of result.folderIds) {
          await restoreFolderFromTrash(folderId, { source: `${source}-undo`, silent: true });
        }

        toast(
          t('trash.restoredCount', { count: result.changed }),
          'success'
        );
      },
    });

    return result;
  }
  
  export async function restoreNoteFromTrash(noteId, {
    targetFolderId = undefined,
    source = 'user',
    silent = false,
  } = {}) {
    const note = state.notes.get(String(noteId || ''));
  
    if (!note) return false;
  
    const restoreFolderId =
      targetFolderId !== undefined
        ? targetFolderId || null
        : validRestoreFolder(note.trashOriginalFolderId)
          ? note.trashOriginalFolderId
          : null;
  
    note.trashed = false;
    delete note.deletedAt;
    delete note.deletedBy;
    delete note.trashOriginalFolderId;
    delete note.trashOriginalFolderPath;
  
    note.folderId = restoreFolderId;
    note.updated = NOW();
  
    await store.notes.put(note);
  
    updateSearchIndexForNote(note);
  
    if (restoreFolderId) {
      state.expandedFolders.add(restoreFolderId);
    }
  
    await emitTrashChanged({
      action: 'restore-note',
      noteId: note.id,
      targetFolderId: restoreFolderId,
      source,
    });

    if (!silent) {
      toast(t('trash.noteRestored'), 'success');
    }

    return true;
  }
  
  export async function restoreFolderFromTrash(folderId, {
    targetParentId = undefined,
    source = 'user',
    silent = false,
  } = {}) {
    const folder = state.folders.get(String(folderId || ''));
  
    if (!folder) return false;
  
    const restoreParentId =
      targetParentId !== undefined
        ? targetParentId || null
        : validRestoreFolder(folder.trashOriginalParentId)
          ? folder.trashOriginalParentId
          : null;
  
    if (
      restoreParentId &&
      (
        restoreParentId === folder.id ||
        folderIsAncestor(folder.id, restoreParentId)
      )
    ) {
      throw new Error('Cannot restore folder into itself.');
    }
  
    folder.trashed = false;
    delete folder.deletedAt;
    delete folder.deletedBy;
    delete folder.trashOriginalParentId;
    delete folder.trashOriginalParentPath;
  
    folder.parentId = restoreParentId;
    folder.updated = NOW();
  
    await store.folders.put(folder);
  
    if (restoreParentId) {
      state.expandedFolders.add(restoreParentId);
    }
  
    // Re-index notes inside restored subtree.
    const { noteIds } = collectFolderSubtree(folder.id);
  
    for (const noteId of noteIds) {
      const note = state.notes.get(noteId);
      if (note && !isNoteInTrash(note)) {
        updateSearchIndexForNote(note);
      }
    }
  
    await emitTrashChanged({
      action: 'restore-folder',
      folderId: folder.id,
      targetParentId: restoreParentId,
      source,
    });

    if (!silent) {
      toast(t('trash.folderRestored'), 'success');
    }

    return true;
  }
  
  export function collectFolderSubtree(folderId) {
    const folderIds = new Set();
    const noteIds = new Set();
    const stack = [String(folderId || '')].filter(Boolean);
  
    while (stack.length) {
      const id = stack.pop();
  
      if (!id || folderIds.has(id)) continue;
  
      folderIds.add(id);
  
      for (const folder of state.folders.values()) {
        if (folder.parentId === id) {
          stack.push(folder.id);
        }
      }
  
      for (const note of state.notes.values()) {
        if (note.folderId === id) {
          noteIds.add(note.id);
        }
      }
    }
  
    return {
      folderIds,
      noteIds,
    };
  }
  
  export async function permanentlyDeleteNote(noteId, {
    source = 'trash',
  } = {}) {
    const id = String(noteId || '');
    const note = state.notes.get(id);
  
    if (!note) return false;

    /*
      Defensive: notes trashed before the link was cut on the way in still own
      a date. Purging the note without this would leave a calendar entry
      pointing at an id that no longer resolves to anything.
    */
    await detachLinkedCalendarEvent(id);

    await store.notes.del(id);

    state.notes.delete(id);
    state.searchIndex.delete(id);
  
    try {
      await destroyNoteDoc(id);
    } catch {}
  
    if (state.currentNoteId === id) {
      try {
        const { clearEditor } = await import('./notes.js');
        clearEditor();
      } catch {}
    }
  
    await emitTrashChanged({
      action: 'purge-note',
      noteId: id,
      source,
    });
  
    return true;
  }
  
  export async function permanentlyDeleteFolder(folderId, {
    source = 'trash',
  } = {}) {
    const id = String(folderId || '');
    const folder = state.folders.get(id);
  
    if (!folder) return false;
  
    const { folderIds, noteIds } = collectFolderSubtree(id);
  
    for (const noteId of noteIds) {
      await permanentlyDeleteNote(noteId, { source });
    }
  
    for (const fid of folderIds) {
      await store.folders.del(fid);
      state.folders.delete(fid);
      state.expandedFolders.delete(fid);
    }
  
    await emitTrashChanged({
      action: 'purge-folder',
      folderId: id,
      source,
    });
  
    return true;
  }
  
  export async function emptyTrash() {
    const { folders, notes } = collectTrashedRootItems();
  
    let count = 0;
  
    for (const note of notes) {
      if (await permanentlyDeleteNote(note.id, { source: 'empty-trash' })) {
        count++;
      }
    }
  
    for (const folder of folders) {
      if (await permanentlyDeleteFolder(folder.id, { source: 'empty-trash' })) {
        count++;
      }
    }
  
    toast(count ? t('trash.emptiedWithCount', { count }) : t('trash.emptied'), 'success');
  
    await emitTrashChanged({
      action: 'empty-trash',
      count,
    });
  }