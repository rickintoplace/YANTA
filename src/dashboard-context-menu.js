// ============================================================
// YANTA — Dashboard Context Menu
//
// Right-click UX for:
// - Notes
// - Folders
// - Blank dashboard space
// - Existing dashboard multi-selection
//
// Design:
// - Delegated single contextmenu listener for performance
// - Uses dashboard-multiselect selection API
// - Uses shared create-actions/item-actions where possible
// - Small native popovers for confirm/folder picking
// ============================================================

import {
    state,
    store,
    uid,
    toast,
    lucide,
    escapeHtml,
  } from './core.js';
  
  import {
    openNote,
    rebuildWikilinkIndex,
    clearEditor,
  } from './notes.js';
  
  import {
    getNoteDoc,
    noteMarkdown,
    destroyNoteDoc,
  } from './yjs.js';
  
  import {
    renderTree,
    showMenu,
  } from './tree.js';
  
  import {
    runCreateAction,
  } from './create-actions.js';
  
  import {
    openFolderInDashboard,
  } from './item-actions.js';
  
  import {
    getDashboardSelectedKeys,
    setDashboardSelectedKeys,
    clearDashboardSelection,
    isDashboardKeySelected,
    selectAllVisibleDashboardItems,
  } from './dashboard-multiselect.js';
  
  import {
    moveItemsToTrash,
  } from './trash.js';

  let initialized = false;
  
  function dashboardRoot() {
    return document.getElementById('dashboard');
  }
  
  function dashboardVisible() {
    const root = dashboardRoot();
  
    if (!root || root.hidden === true) return false;
  
    if (state.surface === 'dashboard') return true;
  
    if (root.closest?.('[data-side-pane-host="dashboard"], .yanta-dashboard-side-pane')) {
      return true;
    }
  
    return false;
  }
  
  function cardFromTarget(target) {
    return target?.closest?.('.yanta-dash-card[data-key]') || null;
  }
  
  function interactiveTarget(target) {
    const node = target instanceof Element ? target : null;
  
    return !!node?.closest?.(
      [
        'button',
        'input',
        'textarea',
        'select',
        'a',
        'iframe',
        '[contenteditable="true"]',
        '.yanta-inline-edit',
        '.yanta-dash-resize-handle',
        '.yanta-dash-card-actions',
        '.yanta-dashboard-selection-tray',
        '.yanta-dashboard-popover',
        '.modal',
        '.ctx-menu',
      ].join(',')
    );
  }
  
  function parseKey(key = '') {
    const [kind, ...rest] = String(key || '').split(':');
  
    return {
      kind,
      id: rest.join(':'),
    };
  }
  
  function noteKey(id) {
    return `note:${id}`;
  }
  
  function folderKey(id) {
    return `folder:${id}`;
  }
  
  function keyExists(key) {
    const { kind, id } = parseKey(key);
  
    if (kind === 'note') return state.notes.has(id);
    if (kind === 'folder') return state.folders.has(id);
  
    return false;
  }
  
  function selectedItemsFromKeys(keys = []) {
    const out = [];
  
    for (const key of keys) {
      const { kind, id } = parseKey(key);
  
      if (kind === 'note') {
        const note = state.notes.get(id);
        if (note) out.push({ key, kind, id, note });
      }
  
      if (kind === 'folder') {
        const folder = state.folders.get(id);
        if (folder) out.push({ key, kind, id, folder });
      }
    }
  
    return out;
  }
  
  function selectedNotes(items) {
    return items
      .filter((item) => item.kind === 'note')
      .map((item) => item.note);
  }
  
  function selectedFolders(items) {
    return items
      .filter((item) => item.kind === 'folder')
      .map((item) => item.folder);
  }
  
  function folderPath(folderId) {
    if (!folderId) return '';
  
    const parts = [];
    const seen = new Set();
    let f = state.folders.get(folderId);
  
    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      parts.unshift(f.name || 'Folder');
      f = f.parentId ? state.folders.get(f.parentId) : null;
    }
  
    return parts.join(' / ');
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
  
  function collectFolderIdsRecursive(folderId) {
    const out = new Set();
    const stack = [folderId];
  
    while (stack.length) {
      const id = stack.pop();
  
      if (!id || out.has(id)) continue;
  
      out.add(id);
  
      for (const folder of state.folders.values()) {
        if (folder.parentId === id) {
          stack.push(folder.id);
        }
      }
    }
  
    return out;
  }
  
  function emitDashboardRefresh(detail = {}) {
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
      detail: {
        source: 'dashboard-context-menu',
        ...detail,
      },
    }));
  }
  
  function menuAt(e, items) {
    showMenu(e.clientX, e.clientY, items);
  }
  
  async function copyText(text, success = 'Copied') {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      toast(success, 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  }
  
  // ============================================================
  // Small native popovers
  // ============================================================
  
  function popoverCard({
    className = '',
    html = '',
  } = {}) {
    const host = document.createElement('div');
  
    host.className = `yanta-dashboard-popover ${className}`;
    host.innerHTML = html;
  
    document.body.append(host);
  
    return host;
  }
  
  function positionPopover(host) {
    requestAnimationFrame(() => {
      const r = host.getBoundingClientRect();
  
      let left = Math.round((window.innerWidth - r.width) / 2);
      let top = Math.round((window.innerHeight - r.height) / 2);
  
      left = Math.max(10, Math.min(window.innerWidth - r.width - 10, left));
      top = Math.max(10, Math.min(window.innerHeight - r.height - 10, top));
  
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    });
  }
  
  function confirmPopover({
    title = 'Confirm',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
  } = {}) {
    return new Promise((resolve) => {
      const host = popoverCard({
        className: 'yanta-dashboard-confirm-popover',
        html: `
          <div class="yanta-dashboard-popover-head">
            <strong>${escapeHtml(title)}</strong>
            <button class="icon-btn" data-cancel>&times;</button>
          </div>
  
          <div class="yanta-dashboard-popover-body">
            <div class="yanta-dashboard-popover-message">
              ${escapeHtml(message).replace(/\n/g, '<br>')}
            </div>
  
            <div class="compress-actions">
              <button class="btn" data-cancel>${escapeHtml(cancelLabel)}</button>
              <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>
                ${escapeHtml(confirmLabel)}
              </button>
            </div>
          </div>
        `,
      });
  
      const finish = (value) => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(value);
      };
  
      const outside = (e) => {
        if (!host.contains(e.target)) finish(false);
      };
  
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      };
  
      host.querySelectorAll('[data-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => finish(false));
      });
  
      host.querySelector('[data-confirm]')?.addEventListener('click', () => {
        finish(true);
      });
  
      positionPopover(host);
  
      setTimeout(() => {
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', onKey, true);
        host.querySelector('[data-confirm]')?.focus?.();
      }, 0);
    });
  }
  
  function folderPickerPopover({
    title = 'Choose folder',
    keys = [],
  } = {}) {
    return new Promise((resolve) => {
      const selectedFolderIds = new Set(
        keys
          .map(parseKey)
          .filter((x) => x.kind === 'folder')
          .map((x) => x.id)
      );
  
      const folders = [...state.folders.values()]
        .sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)));
  
      const canMoveTo = (folderId) => {
        if (!folderId) return true;
  
        for (const selectedId of selectedFolderIds) {
          if (folderId === selectedId) return false;
          if (folderIsAncestor(selectedId, folderId)) return false;
        }
  
        return true;
      };
  
      const host = popoverCard({
        className: 'yanta-dashboard-folder-popover',
        html: `
          <div class="yanta-dashboard-popover-head">
            <strong>${escapeHtml(title)}</strong>
            <button class="icon-btn" data-cancel>&times;</button>
          </div>
  
          <div class="yanta-dashboard-popover-body">
            <div class="yanta-dashboard-folder-list">
              <button class="yanta-dashboard-folder-option" data-folder-id="">
                ${lucide('home', 15)}
                <span>Home / no folder</span>
              </button>
  
              ${folders.map((folder) => {
                const disabled = !canMoveTo(folder.id);
  
                return `
                  <button
                    class="yanta-dashboard-folder-option"
                    data-folder-id="${escapeHtml(folder.id)}"
                    ${disabled ? 'disabled' : ''}>
                    ${lucide(folder.icon || 'folder', 15)}
                    <span>${escapeHtml(folderPath(folder.id) || folder.name || 'Folder')}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        `,
      });
  
      const finish = (value) => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(value);
      };
  
      const outside = (e) => {
        if (!host.contains(e.target)) finish(undefined);
      };
  
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(undefined);
        }
      };
  
      host.querySelectorAll('[data-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => finish(undefined));
      });
  
      host.querySelectorAll('[data-folder-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          finish(btn.dataset.folderId || null);
        });
      });
  
      positionPopover(host);
  
      setTimeout(() => {
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
    });
  }
  
  // ============================================================
  // Item actions
  // ============================================================
  
  async function setPinned(keys, pinned) {
    let count = 0;
  
    for (const key of keys) {
      const { kind, id } = parseKey(key);
      if (kind !== 'note') continue;
  
      const note = state.notes.get(id);
      if (!note) continue;
  
      note.pinned = !!pinned;
      note.updated = Date.now();
  
      if (pinned && note.dashboardPinnedOrder == null) {
        note.dashboardPinnedOrder = Date.now();
      }
  
      await store.notes.put(note);
      count++;
    }
  
    emitDashboardRefresh({
      reason: pinned ? 'context-pin' : 'context-unpin',
    });
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: {
        reason: pinned ? 'context-pin' : 'context-unpin',
        source: 'dashboard-context-menu',
      },
    }));
  
    toast(
      `${pinned ? 'Pinned' : 'Unpinned'} ${count} note${count === 1 ? '' : 's'}`,
      'success'
    );
  }
  
  async function archiveKeys(keys, archived) {
    let count = 0;
  
    for (const key of keys) {
      const { kind, id } = parseKey(key);
  
      if (kind === 'note') {
        const note = state.notes.get(id);
        if (!note) continue;
  
        note.archived = !!archived;
        note.updated = Date.now();
  
        await store.notes.put(note);
        count++;
  
        window.dispatchEvent(new CustomEvent('yanta-note-updated', {
          detail: {
            noteId: id,
            reason: archived ? 'archived' : 'unarchived',
            source: 'dashboard-context-menu',
          },
        }));
      }
  
      if (kind === 'folder') {
        const folder = state.folders.get(id);
        if (!folder) continue;
  
        folder.archived = !!archived;
        folder.updated = Date.now();
  
        await store.folders.put(folder);
        count++;
  
        window.dispatchEvent(new CustomEvent('yanta-folder-updated', {
          detail: {
            folderId: id,
            reason: archived ? 'archived' : 'unarchived',
            source: 'dashboard-context-menu',
          },
        }));
      }
    }
  
    renderTree();
    emitDashboardRefresh({
      reason: archived ? 'context-archive' : 'context-unarchive',
    });
  
    toast(
      `${archived ? 'Archived' : 'Unarchived'} ${count} item${count === 1 ? '' : 's'}`,
      'success'
    );
  }
  
  async function duplicateNote(note) {
    const id = uid();
  
    const copy = {
      ...note,
      id,
      title: `${note.title || 'Untitled'} (copy)`,
      pinned: false,
      dashboardOrder: Date.now(),
      dashboardPinnedOrder: undefined,
      created: Date.now(),
      updated: Date.now(),
    };
  
    delete copy.body;
    delete copy.bodyMigrated;
  
    state.notes.set(id, copy);
    await store.notes.put(copy);
  
    try {
      const srcEntry = getNoteDoc(note.id);
      await srcEntry.ready;
  
      const dstEntry = getNoteDoc(id);
      await dstEntry.ready;
  
      const body = noteMarkdown(note.id);
  
      if (body) {
        dstEntry.doc.getText('markdown').insert(0, body);
      }
  
      state.searchIndex.set(
        id,
        [
          copy.title || '',
          (copy.tags || []).join(' '),
          body || '',
        ].join(' ').toLowerCase()
      );
    } catch {}
  
    return copy;
  }
  
  async function duplicateNotes(keys) {
    const notes = selectedNotes(selectedItemsFromKeys(keys));
  
    let count = 0;
  
    for (const note of notes) {
      await duplicateNote(note);
      count++;
    }
  
    rebuildWikilinkIndex();
    renderTree();
    emitDashboardRefresh({
      reason: 'context-duplicate',
    });
  
    toast(`Duplicated ${count} note${count === 1 ? '' : 's'}`, 'success');
  }
  
  async function moveKeysToFolder(keys) {
    const targetFolderId = await folderPickerPopover({
      title: 'Move items',
      keys,
    });
  
    if (targetFolderId === undefined) return;
  
    let moved = 0;
    let skipped = 0;
  
    for (const key of keys) {
      const { kind, id } = parseKey(key);
  
      if (kind === 'note') {
        const note = state.notes.get(id);
        if (!note) continue;
  
        note.folderId = targetFolderId || null;
        note.pinned = false;
        note.updated = Date.now();
  
        await store.notes.put(note);
        moved++;
      }
  
      if (kind === 'folder') {
        const folder = state.folders.get(id);
        if (!folder) continue;
  
        if (
          targetFolderId &&
          (
            targetFolderId === folder.id ||
            folderIsAncestor(folder.id, targetFolderId)
          )
        ) {
          skipped++;
          continue;
        }
  
        folder.parentId = targetFolderId || null;
        folder.updated = Date.now();
  
        await store.folders.put(folder);
        moved++;
      }
    }
  
    if (targetFolderId) {
      state.expandedFolders.add(targetFolderId);
    }
  
    renderTree();
    emitDashboardRefresh({
      reason: 'context-move',
    });
  
    toast(
      skipped
        ? `Moved ${moved}; skipped ${skipped} invalid folder move${skipped === 1 ? '' : 's'}`
        : `Moved ${moved} item${moved === 1 ? '' : 's'}`,
      skipped ? 'error' : 'success'
    );
  }
  
  function collectDeletePlan(keys) {
    const folderIds = new Set(
      keys
        .map(parseKey)
        .filter((x) => x.kind === 'folder')
        .map((x) => x.id)
    );
  
    const allFolderIds = new Set();
  
    for (const folderId of folderIds) {
      for (const id of collectFolderIdsRecursive(folderId)) {
        allFolderIds.add(id);
      }
    }
  
    const noteIds = new Set(
      keys
        .map(parseKey)
        .filter((x) => x.kind === 'note')
        .map((x) => x.id)
    );
  
    for (const note of state.notes.values()) {
      if (note.folderId && allFolderIds.has(note.folderId)) {
        noteIds.add(note.id);
      }
    }
  
    return {
      noteIds,
      folderIds: allFolderIds,
    };
  }
  
  async function deleteKeys(keys) {
    const directNoteIds = new Set();
    const directFolderIds = new Set();

    for (const key of keys) {
      const { kind, id } = parseKey(key);

      if (kind === 'note' && state.notes.has(id)) {
        directNoteIds.add(id);
      }

      if (kind === 'folder' && state.folders.has(id)) {
        directFolderIds.add(id);
      }
    }

    if (!directNoteIds.size && !directFolderIds.size) return;

    let descendantFolderCount = 0;
    let descendantNoteCount = 0;

    for (const folderId of directFolderIds) {
      const folderIds = collectFolderIdsRecursive(folderId);

      descendantFolderCount += Math.max(0, folderIds.size - 1);

      for (const note of state.notes.values()) {
        if (note.folderId && folderIds.has(note.folderId)) {
          descendantNoteCount++;
        }
      }
    }

    const parts = [
      directNoteIds.size
        ? `${directNoteIds.size} note${directNoteIds.size === 1 ? '' : 's'}`
        : '',
      directFolderIds.size
        ? `${directFolderIds.size} folder${directFolderIds.size === 1 ? '' : 's'}`
        : '',
    ].filter(Boolean);

    const extra =
      descendantFolderCount || descendantNoteCount
        ? `\n\nSelected folders include ${descendantFolderCount} sub-folder${descendantFolderCount === 1 ? '' : 's'} and ${descendantNoteCount} note${descendantNoteCount === 1 ? '' : 's'}.`
        : '';

    const ok = await confirmPopover({
      title: 'Move selected items to Trash',
      message: `Move ${parts.join(' and ')} to Trash?${extra}\n\nYou can restore them later from Trash.`,
      confirmLabel: 'Move to Trash',
      danger: true,
    });

    if (!ok) return;

    await moveItemsToTrash({
      noteIds: [...directNoteIds],
      folderIds: [...directFolderIds],
      source: 'dashboard-context-menu',
    });

    clearDashboardSelection({
      sync: false,
    });

    renderTree();

    emitDashboardRefresh({
      reason: 'context-trash',
    });
  }
  
  async function editAppearance(keys) {
    const clean = keys.filter(keyExists);
  
    if (!clean.length) {
      toast('Nothing selected', 'error');
      return;
    }
  
    const {
      editTreeAppearanceTargets,
    } = await import('./graph.js');
  
    editTreeAppearanceTargets(clean, {
      title: clean.length === 1
        ? 'Icon & color'
        : `Icon & color for ${clean.length} selected items`,
    });
  }
  
  async function openLinkedEvent(eventId) {
    try {
      const calendar = await import('./calendar.js');
  
      calendar.openCalendarEvent?.(eventId, {
        push: true,
      });
    } catch {
      toast('Could not open calendar event', 'error');
    }
  }
  
  async function unlinkLinkedEvent(eventId) {
    try {
      const calendar = await import('./calendar.js');
  
      calendar.unlinkEventNote?.(eventId);
      toast('Event unlinked from note', 'success');
    } catch {
      toast('Could not unlink calendar event', 'error');
    }
  }
  
  async function linkedEventForNote(noteId) {
    try {
      const calendar = await import('./calendar.js');
  
      calendar.hydrateCalendarStateFromVault?.({
        silent: true,
      });
  
      return calendar.calendarEventForNoteId?.(noteId) || null;
    } catch {
      return null;
    }
  }
  
  // ============================================================
  // Menu builders
  // ============================================================
  
  async function buildNoteMenu(note) {
    const key = noteKey(note.id);
    const ev = await linkedEventForNote(note.id);
  
    const items = [
      {
        label: 'Open',
        // icon: 'file-text', <-- still possible, but handled centrally
        // danger: true, <-- would give it danger color
        action: () => openNote(note.id),
      },
      {
        label: 'Rename…',
        action: () => {
          window.dispatchEvent(new CustomEvent('yanta-dashboard-rename-note', {
            detail: {
              noteId: note.id,
            },
          }));
        },
      },
      {
        label: 'Icon & color…',
        action: () => editAppearance([key]),
      },
      {
        label: note.pinned ? 'Unpin' : 'Pin',
        action: () => setPinned([key], !note.pinned),
      },
      'hr',
      {
        label: 'Move to folder…',
        action: () => moveKeysToFolder([key]),
      },
      {
        label: 'Duplicate',
        action: () => duplicateNotes([key]),
      },
      {
        label: 'Copy wikilink',
        action: () => copyText(`[[${note.title || 'Untitled'}]]`, 'Wikilink copied'),
      },
      {
        label: 'Copy note ID',
        action: () => copyText(note.id, 'Note ID copied'),
      },
    ];
  
    if (ev) {
      items.push(
        'hr',
        {
          label: 'Open linked calendar event',
          action: () => openLinkedEvent(ev.id),
        },
        {
          label: 'Unlink calendar event',
          action: () => unlinkLinkedEvent(ev.id),
        }
      );
    }
  
    items.push(
      'hr',
      {
        label: note.archived ? 'Unarchive' : 'Archive',
        action: () => archiveKeys([key], !note.archived),
      },
      {
        label: 'Delete…',
        danger: true,
        action: () => deleteKeys([key]),
      }
    );
  
    return items;
  }
  
  function buildFolderMenu(folder) {
    const key = folderKey(folder.id);
  
    return [
      {
        label: 'Open folder',
        action: () => openFolderInDashboard(folder.id, {
          push: true,
        }),
      },
      'hr',
      {
        label: 'New note here',
        action: () => runCreateAction('note', {
          folderId: folder.id,
          source: 'dashboard-context-menu',
        }),
      },
      {
        label: 'New checklist here',
        action: () => runCreateAction('list', {
          folderId: folder.id,
          source: 'dashboard-context-menu',
        }),
      },
      {
        label: 'New drawing here',
        action: () => runCreateAction('drawing', {
          folderId: folder.id,
          source: 'dashboard-context-menu',
        }),
      },
      {
        label: 'New subfolder',
        action: () => runCreateAction('folder', {
          folderId: folder.id,
          source: 'dashboard-context-menu',
        }),
      },
      'hr',
      {
        label: 'Rename…',
        action: () => {
          window.dispatchEvent(new CustomEvent('yanta-dashboard-rename-folder', {
            detail: {
              folderId: folder.id,
            },
          }));
        },
      },
      {
        label: 'Icon & color…',
        action: () => editAppearance([key]),
      },
      {
        label: 'Move to folder…',
        action: () => moveKeysToFolder([key]),
      },
      {
        label: 'Select contents',
        action: () => {
          const keys = [key];
  
          for (const folderId of collectFolderIdsRecursive(folder.id)) {
            keys.push(folderKey(folderId));
          }
  
          for (const note of state.notes.values()) {
            if (note.folderId && collectFolderIdsRecursive(folder.id).has(note.folderId)) {
              keys.push(noteKey(note.id));
            }
          }
  
          setDashboardSelectedKeys(keys);
        },
      },
      'hr',
      {
        label: folder.archived ? 'Unarchive folder' : 'Archive folder',
        action: () => archiveKeys([key], !folder.archived),
      },
      {
        label: 'Delete folder…',
        danger: true,
        action: () => deleteKeys([key]),
      },
    ];
  }
  
  function buildBlankMenu() {
    const folderId = state.dashboardFolderId || null;
    const hasSelection = getDashboardSelectedKeys().length > 0;
  
    const items = [
      {
        label: folderId ? 'New note in this folder' : 'New note',
        action: () => runCreateAction('note', {
          folderId,
          source: 'dashboard-context-menu-empty',
        }),
      },
      {
        label: folderId ? 'New checklist in this folder' : 'New checklist',
        action: () => runCreateAction('list', {
          folderId,
          source: 'dashboard-context-menu-empty',
        }),
      },
      {
        label: folderId ? 'New drawing in this folder' : 'New drawing',
        action: () => runCreateAction('drawing', {
          folderId,
          source: 'dashboard-context-menu-empty',
        }),
      },
      {
        label: folderId ? 'New folder here' : 'New folder',
        action: () => runCreateAction('folder', {
          folderId,
          source: 'dashboard-context-menu-empty',
        }),
      },
      {
        label: 'New event',
        action: () => runCreateAction('event', {
          folderId,
          source: 'dashboard-context-menu-empty',
        }),
      },
      'hr',
      {
        label: 'Search notes',
        action: () => {
          window.dispatchEvent(new CustomEvent('yanta-expand-sidebar-search'));
        },
      },
      {
        label: 'Select all visible',
        action: () => selectAllVisibleDashboardItems(),
      },
    ];
  
    if (hasSelection) {
      items.push({
        label: 'Clear selection',
        action: () => clearDashboardSelection(),
      });
    }
  
    return items;
  }
  
  function buildBulkMenu(keys) {
    const items = selectedItemsFromKeys(keys);
    const notes = selectedNotes(items);
  
    const anyUnpinned = notes.some((n) => !n.pinned);
    const anyPinned = notes.some((n) => n.pinned);
    const anyArchived = items.some((item) => {
      if (item.kind === 'note') return !!item.note.archived;
      if (item.kind === 'folder') return !!item.folder.archived;
      return false;
    });
  
    return [
      {
        label: `${items.length} selected`,
        disabled: true,
        meta: true,
      },
      'hr',
      {
        label: 'Icon & color…',
        action: () => editAppearance(keys),
      },
      {
        label: 'Pin selected notes',
        disabled: !anyUnpinned,
        action: () => setPinned(keys, true),
      },
      {
        label: 'Unpin selected notes',
        disabled: !anyPinned,
        action: () => setPinned(keys, false),
      },
      {
        label: 'Move selected to folder…',
        action: () => moveKeysToFolder(keys),
      },
      {
        label: 'Duplicate selected notes',
        disabled: notes.length === 0,
        action: () => duplicateNotes(keys),
      },
      {
        label: anyArchived ? 'Unarchive selected' : 'Archive selected',
        action: () => archiveKeys(keys, !anyArchived),
      },
      'hr',
      {
        label: 'Clear selection',
        action: () => clearDashboardSelection(),
      },
      {
        label: 'Delete selected…',
        danger: true,
        action: () => deleteKeys(keys),
      },
    ];
  }
  
  // ============================================================
  // Main event handler
  // ============================================================
  
  async function handleDashboardContextMenu(e) {
    if (!dashboardVisible()) return;
  
    const root = dashboardRoot();
    if (!root || !root.contains(e.target)) return;
  
    // Keep browser context menu inside modals/inputs/menus.
    if (interactiveTarget(e.target)) return;
  
    const card = cardFromTarget(e.target);
  
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  
    if (card) {
      const key = card.dataset.key || '';
  
      if (!keyExists(key)) return;
  
      const selectedKeys = getDashboardSelectedKeys();
  
      if (
        selectedKeys.length > 1 &&
        isDashboardKeySelected(key)
      ) {
        menuAt(e, buildBulkMenu(selectedKeys));
        return;
      }
  
      setDashboardSelectedKeys([key]);
  
      const { kind, id } = parseKey(key);
  
      if (kind === 'note') {
        const note = state.notes.get(id);
        if (!note) return;
  
        menuAt(e, await buildNoteMenu(note));
        return;
      }
  
      if (kind === 'folder') {
        const folder = state.folders.get(id);
        if (!folder) return;
  
        menuAt(e, buildFolderMenu(folder));
        return;
      }
  
      return;
    }
  
    menuAt(e, buildBlankMenu());
  }
  
  export function setupDashboardContextMenu() {
    if (initialized) return;
    initialized = true;
  
    document.addEventListener('contextmenu', (e) => {
      handleDashboardContextMenu(e).catch((err) => {
        console.error('[YANTA Dashboard Context Menu] failed', err);
        toast('Context menu failed', 'error');
      });
    }, true);
  }