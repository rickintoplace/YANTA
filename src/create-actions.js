// ============================================================
// YANTA — Shared Create Actions
//
// Single source of truth for:
// - Floating Create
// - Dashboard New menu
// - Sidebar New menu
// ============================================================

import {
    state,
    toast,
  } from './core.js';
  
  import {
    newNote,
    newFolder,
  } from './notes.js';
  
  import {
    insertAtCursor,
  } from './editor.js';
  
  import {
    getMarkdownText,
  } from './yjs.js';
  
  import {
    createDrawingAndInsert,
  } from './draw.js';
  
  import {
    openImageModal,
  } from './image.js';
  
  import {
    openCalendar,
    openNewCalendarEvent,
  } from './calendar.js';
  
  import {
    closeGraph,
  } from './graph.js';
  
  import {
    currentFolderForNew,
    showMenu,
  } from './tree.js';
  
  import {
    closeMobileSidebar,
  } from './mobile-sidebar.js';
  
  export const CREATE_ACTIONS = [
    {
      id: 'folder',
      label: 'New folder',
      icon: 'folder-plus',
      resultType: 'folder',
    },
    {
      id: 'note',
      label: 'New text note',
      icon: 'file-text',
      resultType: 'note',
    },
    {
      id: 'list',
      label: 'New list',
      icon: 'list-checks',
      resultType: 'note',
    },
    {
      id: 'drawing',
      label: 'New drawing',
      icon: 'line-squiggle',
      resultType: 'note',
    },
    {
      id: 'image',
      label: 'New image',
      icon: 'image',
      resultType: 'note',
    },
    {
      id: 'event',
      label: 'New calendar event',
      icon: 'calendar-plus',
      resultType: 'calendar-event',
    },
  ];
  
  export function isGraphVisible() {
    const graph = document.getElementById('graphOverlay');
    return !!graph && graph.hidden === false;
  }
  
  export function dashboardSidePaneOpen() {
    return !!document.querySelector('[data-side-pane-host="dashboard"]');
  }
  
  export function defaultCreateFolderId({
    folderId,
  } = {}) {
    if (folderId !== undefined) {
      return folderId || null;
    }
  
    if (state.surface === 'dashboard' || dashboardSidePaneOpen()) {
      return state.dashboardFolderId || null;
    }
  
    return currentFolderForNew?.() || null;
  }
  
  async function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }
  
  async function closeGraphIfOpen() {
    if (!isGraphVisible()) return;
  
    try {
      closeGraph();
    } catch {}
  }
  
  async function createTextNote(folderId) {
    await closeGraphIfOpen();
    await newNote(folderId || null, 'markdown');
  
    return {
      id: 'note',
      type: 'note',
      noteId: state.currentNoteId || null,
    };
  }
  
  async function createFolder(folderId, {
    source = 'unknown',
  } = {}) {
    await closeGraphIfOpen();
  
    const renameInDashboard =
      state.surface === 'dashboard' ||
      dashboardSidePaneOpen();
  
    const folder = await newFolder(folderId || null, {
      name: 'New folder',
      focusRename: !renameInDashboard,
      source,
    });
  
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
      detail: {
        reason: 'folder-created',
        source: 'create-actions',
        folderId: folderId || null,
        createdFolderId: folder?.id || null,
      },
    }));
  
    if (renameInDashboard && folder?.id) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('yanta-dashboard-rename-folder', {
          detail: {
            folderId: folder.id,
          },
        }));
      });
    }
  
    return {
      id: 'folder',
      type: 'folder',
      folderId: folder?.id || null,
    };
  }
  
  async function createListNote(folderId) {
    await closeGraphIfOpen();
    await newNote(folderId || null, 'list');
  
    await nextFrame();
  
    const noteId = state.currentNoteId;
    if (!noteId) {
      return {
        id: 'list',
        type: 'note',
        noteId: null,
      };
    }
  
    try {
      const ytext = getMarkdownText(noteId);
  
      if (ytext.length === 0) {
        insertAtCursor('- [ ] ');
      }
    } catch {
      insertAtCursor('- [ ] ');
    }
  
    return {
      id: 'list',
      type: 'note',
      noteId,
    };
  }
  
  async function createDrawingNote(folderId) {
    await closeGraphIfOpen();
    await newNote(folderId || null, 'markdown');
  
    await nextFrame();
  
    await createDrawingAndInsert();
  
    return {
      id: 'drawing',
      type: 'note',
      noteId: state.currentNoteId || null,
    };
  }
  
  async function createImageNote(folderId) {
    await closeGraphIfOpen();
    await newNote(folderId || null, 'markdown');
  
    await nextFrame();
  
    openImageModal();
  
    return {
      id: 'image',
      type: 'note',
      noteId: state.currentNoteId || null,
    };
  }
  
  async function createCalendarEvent() {
    await closeGraphIfOpen();
  
    if (state.surface !== 'calendar') {
      openCalendar({
        push: true,
      });
  
      await nextFrame();
      await nextFrame();
    }
  
    openNewCalendarEvent();
  
    return {
      id: 'event',
      type: 'calendar-event',
    };
  }
  
  export async function runCreateAction(actionId, {
    folderId,
    source = 'unknown',
  } = {}) {
    const targetFolderId = defaultCreateFolderId({
      folderId,
    });
  
    try {
        if (actionId === 'folder') {
            return await createFolder(targetFolderId, {
              source,
            });
          }
  
      if (actionId === 'note') {
        return await createTextNote(targetFolderId);
      }
  
      if (actionId === 'list') {
        return await createListNote(targetFolderId);
      }
  
      if (actionId === 'drawing') {
        return await createDrawingNote(targetFolderId);
      }
  
      if (actionId === 'image') {
        return await createImageNote(targetFolderId);
      }
  
      if (actionId === 'event') {
        return await createCalendarEvent();
      }
  
      if (actionId === 'ai') {
        window.dispatchEvent(new CustomEvent('yanta-open-ai-assistant'));
  
        return {
          id: 'ai',
          type: 'assistant',
        };
      }
  
      throw new Error(`Unknown create action: ${actionId}`);
    } catch (err) {
      console.error('[YANTA Create Actions] failed', {
        actionId,
        source,
        err,
      });
  
      toast('Create action failed', 'error');
  
      throw err;
    }
  }
  
  export function openCreateMenu(anchor, {
    folderId,
    source = 'menu',
    closeMobile = false,
    align = 'start',
    onAfterAction = null,
  } = {}) {
    if (!anchor) return;
  
    const rect = anchor.getBoundingClientRect();
  
    const x = align === 'end'
      ? rect.right
      : rect.left;
  
    showMenu(
      x,
      rect.bottom + 6,
      CREATE_ACTIONS.map((action) => ({
        label: action.label,
        icon: action.icon,
        action: async () => {
          const result = await runCreateAction(action.id, {
            folderId,
            source,
          });
      
          if (closeMobile) {
            closeMobileSidebar();
          }
      
          await onAfterAction?.(result);
      
          return result;
        },
      })),
      {
        align,
      }
    );
  }