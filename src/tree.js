// ============================================================
// YANTA — Sidebar tree (folders + notes), tag cloud, context
// menus, drag-and-drop reorganisation, multi-select + bulk ops.
// ============================================================

import { $, el, uid, state, store, lucide, safeCssColor, toast } from './core.js';
import {
  openNote,
  newNote,
  newFolder,
  rebuildWikilinkIndex,
  clearEditor,
} from './notes.js';
import { syncDeleteNoteFile } from './sync.js';
import { getNoteDoc, noteMarkdown, destroyNoteDoc } from './yjs.js';
import { updateStorageMeter } from './core.js';

function safeItemColor(c) {
  return safeCssColor(c);
}

function itemIcon(name, color) {
  const span = el('span', { class: 'tree-item-icon' });
  span.innerHTML = lucide(name || 'square', 14);

  const c = safeItemColor(color);
  if (c) span.style.color = c;

  return span;
}

function applyItemColor(row, color) {
  const c = safeItemColor(color);
  if (!c) return;

  row.classList.add('has-color');
  row.style.setProperty('--item-color', c);
}

/**
 * Aktiver Marker für Notes.
 *
 * Warum nicht der normale border-left?
 * Der normale Border sitzt am linken Rand der kompletten .tree-row.
 * Bei Notes in Ordnern/Subordnern ist aber der Inhalt eingerückt.
 * Dadurch wirkt der Border auf der falschen Ebene.
 *
 * Dieser Marker sitzt relativ zur Note-Ebene kurz vor dem Icon/Text.
 */
function activeNoteMarker(depth = 0) {
  return el('span', {
    class: 'tree-active-note-marker',
    'aria-hidden': 'true',
    style: {
      position: 'absolute',
      left: (12 + depth * 14) + 'px',
      top: '4px',
      bottom: '4px',
      width: '2px',
      borderRadius: '999px',
      background: 'var(--accent)',
      pointerEvents: 'none',
    },
  });
}

// ============================================================
// Multi-selection state
// Keys:
//   note:<id>
//   folder:<id>
// ============================================================

const selection = {
  keys: new Set(),
  anchorKey: null,
};

let visibleTreeOrder = [];

function noteKey(id) {
  return `note:${id}`;
}

function folderKey(id) {
  return `folder:${id}`;
}

function parseTreeKey(key) {
  const [kind, ...rest] = String(key || '').split(':');
  return {
    kind,
    id: rest.join(':'),
  };
}

function treeKeyExists(key) {
  const { kind, id } = parseTreeKey(key);
  if (kind === 'note') return state.notes.has(id);
  if (kind === 'folder') return state.folders.has(id);
  return false;
}

function pruneDeadSelection() {
  for (const key of [...selection.keys]) {
    if (!treeKeyExists(key)) selection.keys.delete(key);
  }

  if (selection.anchorKey && !treeKeyExists(selection.anchorKey)) {
    selection.anchorKey = selection.keys.values().next().value || null;
  }
}

function isSelected(key) {
  return selection.keys.has(key);
}

function setOnlySelection(key) {
  selection.keys.clear();
  selection.keys.add(key);
  selection.anchorKey = key;
}

function toggleSelection(key) {
  if (selection.keys.has(key)) {
    selection.keys.delete(key);
    if (selection.anchorKey === key) {
      selection.anchorKey = selection.keys.values().next().value || null;
    }
  } else {
    selection.keys.add(key);
    selection.anchorKey = key;
  }

  if (!selection.keys.size) {
    selection.anchorKey = null;
  }
}

function selectRange(anchorKey, targetKey) {
  const order = visibleTreeOrder;
  const a = order.indexOf(anchorKey);
  const b = order.indexOf(targetKey);

  if (a < 0 || b < 0) {
    setOnlySelection(targetKey);
    return;
  }

  const from = Math.min(a, b);
  const to = Math.max(a, b);

  selection.keys.clear();

  for (let i = from; i <= to; i++) {
    selection.keys.add(order[i]);
  }

  selection.anchorKey = anchorKey;
}

function getSelectedItems() {
  const out = [];

  for (const key of selection.keys) {
    const { kind, id } = parseTreeKey(key);

    if (kind === 'note') {
      const note = state.notes.get(id);
      if (note) out.push({ key, kind, id, note });
    } else if (kind === 'folder') {
      const folder = state.folders.get(id);
      if (folder) out.push({ key, kind, id, folder });
    }
  }

  return out;
}

function selectedNotes(items = getSelectedItems()) {
  return items.filter((x) => x.kind === 'note').map((x) => x.note);
}

function selectedFolders(items = getSelectedItems()) {
  return items.filter((x) => x.kind === 'folder').map((x) => x.folder);
}

function handleTreeSelectionClick(e, key, normalAction) {
  // Ctrl/Cmd toggles individual rows.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    e.stopPropagation();

    toggleSelection(key);
    renderTree();

    return;
  }

  // Shift selects visible range from anchor to target.
  if (e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();

    selectRange(selection.anchorKey || key, key);
    renderTree();

    return;
  }

  // Normal click behaves like common tree UIs:
  // select row + perform normal action.
  setOnlySelection(key);
  normalAction?.();
}

function openTreeContextMenu(e, key, singleMenuFn) {
  e.preventDefault();
  e.stopPropagation();

  if (!isSelected(key)) {
    setOnlySelection(key);
    renderTree();
  }

  const items = getSelectedItems();

  if (items.length > 1) {
    bulkMenu(e, items);
  } else {
    singleMenuFn();
  }
}

// ============================================================
// Render
// ============================================================

export function renderTree() {
  const root = $('tree');
  if (!root) return;

  pruneDeadSelection();

  visibleTreeOrder = [];
  root.replaceChildren();

  const q = state.searchQuery.toLowerCase();
  const filterTag = state.activeTagFilter;

  const visible = [...state.notes.values()].filter((n) => {
    if (filterTag && !(n.tags || []).includes(filterTag)) return false;

    if (q) {
      const fallbackHay = [
        n.title || '',
        (n.tags || []).join(' '),
      ].join(' ').toLowerCase();

      const hay = state.searchIndex.get(n.id) || fallbackHay;

      if (!hay.includes(q)) return false;
    }

    return true;
  });

  const pinned = visible
    .filter((n) => n.pinned)
    .sort((a, b) => b.updated - a.updated);

  if (pinned.length) {
    const sec = el('div', { class: 'tree-section' });
    sec.append(el('div', { class: 'tree-section-title' }, 'Pinned'));

    for (const n of pinned) {
      sec.append(noteRow(n));
    }

    root.append(sec);
  }

  const folderSec = el('div', { class: 'tree-section' });

  const ftitle = el(
    'div',
    { class: 'tree-section-title' },
    'Folders',
    el('button', {
      class: 'icon-btn',
      title: 'New folder',
      onclick: () => newFolder(null),
      style: { width: '20px', height: '20px' },
    }, '+')
  );

  ftitle.addEventListener('dragover', (e) => {
    const types = [...(e.dataTransfer.types || [])];
    if (!types.includes('text/yanta-note') && !types.includes('text/yanta-folder')) return;

    e.preventDefault();
    ftitle.classList.add('drop-target');
  });

  ftitle.addEventListener('dragleave', () => {
    ftitle.classList.remove('drop-target');
  });

  ftitle.addEventListener('drop', async (e) => {
    ftitle.classList.remove('drop-target');
    e.preventDefault();

    const noteId = e.dataTransfer.getData('text/yanta-note');
    const folderId = e.dataTransfer.getData('text/yanta-folder');

    if (noteId) {
      const noteIds = draggedNoteIds(noteId);

      for (const id of noteIds) {
        const note = state.notes.get(id);
        if (!note) continue;

        note.folderId = null;
        note.updated = Date.now();

        await store.notes.put(note);
      }
    } else if (folderId) {
      const folderIds = draggedFolderIds(folderId);

      for (const id of folderIds) {
        const folder = state.folders.get(id);
        if (!folder) continue;

        folder.parentId = null;

        await store.folders.put(folder);
      }
    }

    renderTree();
  });

  folderSec.append(ftitle);

  const orphanNotes = visible
    .filter((n) => !n.folderId && !n.pinned)
    .sort((a, b) => b.updated - a.updated);

  for (const n of orphanNotes) {
    folderSec.append(noteRow(n));
  }

  const topFolders = [...state.folders.values()]
    .filter((f) => !f.parentId || !state.folders.has(f.parentId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  for (const f of topFolders) {
    folderSec.append(folderRow(f, visible, 0));
  }

  if (!topFolders.length && !orphanNotes.length) {
    folderSec.append(el('div', { class: 'tree-empty' }, q || filterTag ? 'No matches' : 'No notes yet'));
  }

  root.append(folderSec);

  renderTagCloud();
  updateStorageMeter();
}

function isAncestor(ancestorId, descendantId) {
  let cur = state.folders.get(descendantId);
  const seen = new Set();

  while (cur && !seen.has(cur.id)) {
    if (cur.id === ancestorId) return true;

    seen.add(cur.id);
    cur = cur.parentId ? state.folders.get(cur.parentId) : null;
  }

  return false;
}

function folderRow(f, visibleNotes, depth) {
  const key = folderKey(f.id);
  visibleTreeOrder.push(key);

  const wrap = el('div');
  const expanded = state.expandedFolders.has(f.id);
  const selected = isSelected(key);
  const isAnchor = selection.anchorKey === key;

  const childFolders = [...state.folders.values()]
    .filter((x) => x.parentId === f.id)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const childNotes = visibleNotes
    .filter((n) => n.folderId === f.id && !n.pinned)
    .sort((a, b) => b.updated - a.updated);

  const row = el('div', {
    class:
      'tree-row folder' +
      (selected ? ' selected' : '') +
      (isAnchor ? ' selection-anchor' : ''),
    style: { paddingLeft: (12 + depth * 14) + 'px' },
    onclick: (e) => handleTreeSelectionClick(e, key, () => {
      if (expanded) state.expandedFolders.delete(f.id);
      else state.expandedFolders.add(f.id);

      renderTree();
    }),
    oncontextmenu: (e) => openTreeContextMenu(e, key, () => folderMenu(e, f)),
    ondragover: (e) => {
      const types = [...(e.dataTransfer.types || [])];
      if (!types.includes('text/yanta-note') && !types.includes('text/yanta-folder')) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    },
    ondragleave: () => row.classList.remove('drop-target'),
    ondrop: async (e) => {
      row.classList.remove('drop-target');
      e.preventDefault();

      const noteId = e.dataTransfer.getData('text/yanta-note');
      const folderId = e.dataTransfer.getData('text/yanta-folder');

      if (noteId) {
        const noteIds = draggedNoteIds(noteId);

        for (const id of noteIds) {
          const note = state.notes.get(id);
          if (!note) continue;

          note.folderId = f.id;
          note.updated = Date.now();

          await store.notes.put(note);
        }
      } else if (folderId) {
        const folderIds = draggedFolderIds(folderId);

        for (const id of folderIds) {
          if (id === f.id) continue;
          if (isAncestor(id, f.id)) continue;

          const folder = state.folders.get(id);
          if (!folder) continue;

          folder.parentId = f.id;

          await store.folders.put(folder);
        }
      }

      state.expandedFolders.add(f.id);
      renderTree();
    },
  });

  applyItemColor(row, f.color);

  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    if (!isSelected(key)) setOnlySelection(key);

    e.dataTransfer.setData('text/yanta-folder', f.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  row.append(el('span', { class: 'twist' }, expanded ? '▾' : '▸'));
  row.append(itemIcon(f.icon || 'folder', f.color));
  row.append(el('span', { class: 'label' }, f.name || 'Folder'));

  row.append(el('span', {
    class: 'menu-trigger',
    title: 'Add note',
    onclick: (e) => {
      e.stopPropagation();
      newNote(f.id);
    },
  }, '+'));

  wrap.append(row);

  if (expanded) {
    const kids = el('div', { class: 'tree-children' });

    for (const sf of childFolders) {
      kids.append(folderRow(sf, visibleNotes, depth + 1));
    }

    for (const n of childNotes) {
      kids.append(noteRow(n, depth + 1));
    }

    if (!childFolders.length && !childNotes.length) {
      kids.append(el('div', { class: 'tree-empty' }, 'Empty'));
    }

    wrap.append(kids);
  }

  return wrap;
}

function noteRow(n, depth = 0) {
  const key = noteKey(n.id);
  visibleTreeOrder.push(key);

  const isActive = state.currentNoteId === n.id;
  const selected = isSelected(key);
  const isAnchor = selection.anchorKey === key;

  const rowStyle = {
    paddingLeft: (24 + depth * 14) + 'px',
  };

  // Wichtig:
  // Der globale CSS-Border `.tree-row.active { border-left-color: ... }`
  // sitzt bei verschachtelten Notes optisch auf der falschen Ebene.
  // Für aktive Notes deaktivieren wir ihn inline und zeichnen stattdessen
  // einen korrekt eingerückten Marker.
  if (isActive) {
    rowStyle.borderLeftColor = 'transparent';
  }

  const row = el('div', {
    class:
      'tree-row note' +
      (isActive ? ' active' : '') +
      (selected ? ' selected' : '') +
      (isAnchor ? ' selection-anchor' : ''),
    style: rowStyle,
    draggable: 'true',
    onclick: (e) => handleTreeSelectionClick(e, key, () => openNote(n.id)),
    oncontextmenu: (e) => openTreeContextMenu(e, key, () => noteMenu(e, n)),
    ondragstart: (e) => {
      if (!isSelected(key)) setOnlySelection(key);

      // text/yanta-note enables intra-app folder moves & wikilink-on-drop;
      // text/plain so a drop onto a foreign target still gets the title.
      e.dataTransfer.setData('text/yanta-note', n.id);
      e.dataTransfer.setData('text/plain', n.title || 'Untitled');
      e.dataTransfer.effectAllowed = 'copyMove';
    },
    ondragover: (e) => {
      const types = [...(e.dataTransfer.types || [])];
      if (!types.includes('text/yanta-note')) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    },
    ondragleave: () => row.classList.remove('drop-target'),
    ondrop: async (e) => {
      row.classList.remove('drop-target');

      const draggedId = e.dataTransfer.getData('text/yanta-note');
      if (!draggedId) return;

      e.preventDefault();

      const ids = draggedNoteIds(draggedId);

      // Dropping note(s) onto another note → move into that note's folder.
      for (const id of ids) {
        if (id === n.id) continue;

        const dropped = state.notes.get(id);
        if (!dropped) continue;

        dropped.folderId = n.folderId || null;
        dropped.updated = Date.now();

        await store.notes.put(dropped);
      }

      renderTree();
    },
  });

  applyItemColor(row, n.color);

  if (isActive) {
    row.append(activeNoteMarker(depth));
  }

  row.append(itemIcon(n.icon || (n.type === 'list' ? 'list' : 'file'), n.color));
  row.append(el('span', { class: 'label' }, n.title || 'Untitled'));

  // Per-note sync status dot
  const status = state.noteSyncStatus.get(n.id);
  if (status && status !== 'synced') {
    const dot = el('span', {
      class: 'sync-dot sync-dot-' + status,
      title: statusLabel(status),
    });

    row.append(dot);
  }

  if (state.liveShares.has(n.id)) {
    row.append(el('span', { class: 'live-dot', title: 'Live shared' }));
  }

  if (n.pinned) {
    row.append(el('span', { class: 'pin', title: 'Pinned' }, '●'));
  }

  return row;
}

function draggedNoteIds(draggedId) {
  const key = noteKey(draggedId);

  if (isSelected(key)) {
    const ids = selectedNotes().map((n) => n.id);
    if (ids.length > 1) return ids;
  }

  return [draggedId];
}

function draggedFolderIds(draggedId) {
  const key = folderKey(draggedId);

  if (isSelected(key)) {
    const ids = selectedFolders().map((f) => f.id);
    if (ids.length > 1) return ids;
  }

  return [draggedId];
}

function statusLabel(s) {
  return {
    local: 'Local changes',
    remote: 'Remote changes',
    syncing: 'Syncing…',
    conflict: 'Conflict',
  }[s] || s;
}

// ============================================================
// Tags
// ============================================================

export function renderTagCloud() {
  const c = $('tagCloud');
  if (!c) return;

  c.replaceChildren();

  const counts = new Map();

  for (const n of state.notes.values()) {
    for (const t of n.tags || []) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  for (const [t, n] of sorted) {
    const p = el('span', {
      class: 'tag-pill' + (state.activeTagFilter === t ? ' active' : ''),
      onclick: () => {
        state.activeTagFilter = state.activeTagFilter === t ? null : t;
        renderTree();
      },
    }, '#' + t, el('span', { class: 'count' }, String(n)));

    c.append(p);
  }
}

// ============================================================
// Context menus
// ============================================================

let activeMenu = null;

function _menuOutsideClose(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}

export function showMenu(x, y, items) {
  closeMenu();

  const m = el('div', {
    class: 'ctx-menu',
    style: {
      left: x + 'px',
      top: y + 'px',
    },
  });

  for (const it of items) {
    if (it === 'hr') {
      m.append(el('hr'));
      continue;
    }

    const btn = el('button', {
      class: [
        it.danger ? 'danger' : '',
        it.disabled ? 'disabled' : '',
        it.meta ? 'meta' : '',
      ].filter(Boolean).join(' '),
      disabled: !!it.disabled,
      onclick: () => {
        if (it.disabled) return;
        closeMenu();
        it.action?.();
      },
    }, it.label);

    m.append(btn);
  }

  document.body.append(m);
  activeMenu = m;

  setTimeout(() => {
    document.addEventListener('mousedown', _menuOutsideClose, true);
  }, 0);

  const r = m.getBoundingClientRect();

  if (r.right > window.innerWidth) {
    m.style.left = (x - r.width) + 'px';
  }

  if (r.bottom > window.innerHeight) {
    m.style.top = (y - r.height) + 'px';
  }
}

export function closeMenu() {
  if (!activeMenu) return;

  document.removeEventListener('mousedown', _menuOutsideClose, true);
  activeMenu.remove();
  activeMenu = null;
}

function noteMenu(e, n) {
  showMenu(e.clientX, e.clientY, [
    {
      label: n.pinned ? 'Unpin' : 'Pin',
      action: async () => {
        n.pinned = !n.pinned;
        n.updated = Date.now();

        await store.notes.put(n);
        renderTree();
      },
    },
    {
      label: 'Icon & color…',
      action: () => editItemsIconColor([noteKey(n.id)]),
    },
    {
      label: 'Rename…',
      action: async () => {
        const t = prompt('Title:', n.title);
        if (!t) return;

        n.title = t.trim() || 'Untitled';
        n.updated = Date.now();

        await store.notes.put(n);

        if (state.currentNoteId === n.id) {
          $('noteTitle').value = n.title;
        }

        rebuildWikilinkIndex();
        renderTree();
      },
    },
    {
      label: 'Move to folder…',
      action: () => moveSelectedToFolder([noteKey(n.id)]),
    },
    {
      label: 'Duplicate',
      action: () => duplicateNote(n),
    },
    'hr',
    {
      label: 'Delete',
      danger: true,
      action: async () => {
        if (!confirm(`Delete "${n.title || 'Untitled'}"?`)) return;

        await deleteNotesAndFolders({
          noteIds: new Set([n.id]),
          folderIds: new Set(),
          recursiveFolders: false,
        });
      },
    },
  ]);
}

function folderMenu(e, f) {
  showMenu(e.clientX, e.clientY, [
    {
      label: 'New note here',
      action: () => newNote(f.id),
    },
    {
      label: 'New sub-folder',
      action: () => newFolder(f.id),
    },
    {
      label: 'Select folder contents',
      action: () => selectFolderSubtree(f.id),
    },
    {
      label: 'Icon & color…',
      action: () => editItemsIconColor([folderKey(f.id)]),
    },
    {
      label: 'Rename…',
      action: async () => {
        const t = prompt('Folder name:', f.name);
        if (!t) return;

        f.name = t.trim() || 'Folder';

        await store.folders.put(f);
        renderTree();
      },
    },
    {
      label: 'Move to folder…',
      action: () => moveSelectedToFolder([folderKey(f.id)]),
    },
    'hr',
    {
      label: 'Delete folder',
      danger: true,
      action: async () => {
        const directNotes = [...state.notes.values()].filter((n) => n.folderId === f.id);
        const directFolders = [...state.folders.values()].filter((x) => x.parentId === f.id);

        const msg = directNotes.length || directFolders.length
          ? `Delete "${f.name || 'Folder'}" and move ${directNotes.length} note(s), ${directFolders.length} sub-folder(s) out of it?`
          : `Delete "${f.name || 'Folder'}"?`;

        if (!confirm(msg)) return;

        for (const n of directNotes) {
          n.folderId = f.parentId || null;
          n.updated = Date.now();
          await store.notes.put(n);
        }

        for (const child of directFolders) {
          child.parentId = f.parentId || null;
          await store.folders.put(child);
        }

        await store.folders.del(f.id);
        state.folders.delete(f.id);
        state.expandedFolders.delete(f.id);

        selection.keys.delete(folderKey(f.id));

        renderTree();
      },
    },
  ]);
}

function bulkMenu(e, items) {
  const notes = selectedNotes(items);
  const folders = selectedFolders(items);

  const count = items.length;
  const noteCount = notes.length;
  const folderCount = folders.length;

  const anyUnpinned = notes.some((n) => !n.pinned);
  const anyPinned = notes.some((n) => n.pinned);

  const menu = [
    {
      label: `${count} selected · ${noteCount} note${noteCount === 1 ? '' : 's'} · ${folderCount} folder${folderCount === 1 ? '' : 's'}`,
      disabled: true,
      meta: true,
    },
    'hr',
  ];

  if (noteCount) {
    menu.push({
      label: anyUnpinned ? `Pin selected note${noteCount === 1 ? '' : 's'}` : 'Pin selected notes',
      disabled: !anyUnpinned,
      action: () => bulkSetPinned(notes, true),
    });

    menu.push({
      label: anyPinned ? `Unpin selected note${noteCount === 1 ? '' : 's'}` : 'Unpin selected notes',
      disabled: !anyPinned,
      action: () => bulkSetPinned(notes, false),
    });
  }

  menu.push({
    label: 'Icon & color for selected…',
    action: () => editItemsIconColor(items.map((x) => x.key)),
  });

  menu.push({
    label: 'Move selected to folder…',
    action: () => moveSelectedToFolder(items.map((x) => x.key)),
  });

  if (noteCount) {
    menu.push({
      label: `Duplicate selected note${noteCount === 1 ? '' : 's'}`,
      action: () => duplicateNotes(notes),
    });
  }

  menu.push('hr');

  menu.push({
    label: 'Clear selection',
    action: () => {
      selection.keys.clear();
      selection.anchorKey = null;
      renderTree();
    },
  });

  menu.push({
    label: 'Delete selected items',
    danger: true,
    action: () => deleteSelectedItems(items),
  });

  showMenu(e.clientX, e.clientY, menu);
}

// ============================================================
// Bulk operations
// ============================================================

async function bulkSetPinned(notes, pinned) {
  for (const n of notes) {
    n.pinned = pinned;
    n.updated = Date.now();

    await store.notes.put(n);
  }

  renderTree();

  toast(
    `${pinned ? 'Pinned' : 'Unpinned'} ${notes.length} note${notes.length === 1 ? '' : 's'}`,
    'success'
  );
}

async function editItemsIconColor(keys) {
  const cleanKeys = [...new Set(keys || [])]
    .map((key) => {
      const { kind, id } = parseTreeKey(key);

      if (kind === 'note' && state.notes.has(id)) return noteKey(id);
      if (kind === 'folder' && state.folders.has(id)) return folderKey(id);

      return null;
    })
    .filter(Boolean);

  if (!cleanKeys.length) {
    toast('Nothing selected', 'info');
    return;
  }

  const {
    editNoteAppearance,
    editFolderAppearance,
    editTreeAppearanceTargets,
  } = await import('./graph.js');

  // Single note/folder: use exactly the same Graph picker/scopes.
  if (cleanKeys.length === 1) {
    const { kind, id } = parseTreeKey(cleanKeys[0]);

    if (kind === 'note') {
      const note = state.notes.get(id);
      if (note) editNoteAppearance(note);
      return;
    }

    if (kind === 'folder') {
      const folder = state.folders.get(id);
      if (folder) editFolderAppearance(folder);
      return;
    }
  }

  // Multi-selection: use the shared Graph appearance picker with Tree scopes.
  editTreeAppearanceTargets(cleanKeys, {
    title: `Icon & color for ${cleanKeys.length} selected items`,
  });
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

function chooseFolderPrompt({ title = 'Move to folder:' } = {}) {
  const folders = [...state.folders.values()]
    .sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)));

  const opts = ['(no folder)', ...folders.map((f) => folderPath(f.id) || f.name || 'Folder')];

  const choice = prompt(
    `${title}\n\n${opts.map((o, i) => `${i}. ${o}`).join('\n')}\n\nEnter number:`
  );

  if (choice === null) return undefined;

  const idx = parseInt(choice, 10);

  if (Number.isNaN(idx) || idx < 0 || idx >= opts.length) {
    toast('Invalid folder selection', 'error');
    return undefined;
  }

  return idx === 0 ? null : folders[idx - 1].id;
}

async function moveSelectedToFolder(keys = [...selection.keys]) {
  const targetFolderId = chooseFolderPrompt();
  if (targetFolderId === undefined) return;

  let moved = 0;
  let skipped = 0;

  for (const key of keys) {
    const { kind, id } = parseTreeKey(key);

    if (kind === 'note') {
      const n = state.notes.get(id);
      if (!n) continue;

      n.folderId = targetFolderId || null;
      n.updated = Date.now();

      await store.notes.put(n);
      moved++;
    } else if (kind === 'folder') {
      const f = state.folders.get(id);
      if (!f) continue;

      // Avoid cycles.
      if (targetFolderId && (targetFolderId === f.id || isAncestor(f.id, targetFolderId))) {
        skipped++;
        continue;
      }

      f.parentId = targetFolderId || null;

      await store.folders.put(f);
      moved++;
    }
  }

  if (targetFolderId) {
    state.expandedFolders.add(targetFolderId);
  }

  renderTree();

  if (skipped) {
    toast(`Moved ${moved}; skipped ${skipped} invalid folder move${skipped === 1 ? '' : 's'}`, 'error');
  } else {
    toast(`Moved ${moved} item${moved === 1 ? '' : 's'}`, 'success');
  }
}

async function duplicateNotes(notes) {
  let created = 0;

  for (const n of notes) {
    await duplicateNote(n, { openCreated: false });
    created++;
  }

  renderTree();

  toast(`Duplicated ${created} note${created === 1 ? '' : 's'}`, 'success');
}

async function duplicateNote(src, { openCreated = true } = {}) {
  const id = uid();

  const n = {
    ...src,
    id,
    title: (src.title || 'Untitled') + ' (copy)',
    created: Date.now(),
    updated: Date.now(),
  };

  delete n.body;
  delete n.bodyMigrated;

  await store.notes.put(n);
  state.notes.set(n.id, n);

  // Ensure source Y.Doc is loaded before reading.
  try {
    const srcEntry = getNoteDoc(src.id);
    await srcEntry.ready;

    const dstEntry = getNoteDoc(id);
    await dstEntry.ready;

    const body = noteMarkdown(src.id);

    if (body) {
      dstEntry.doc.getText('markdown').insert(0, body);
    }

    state.searchIndex.set(
      id,
      [n.title || '', (n.tags || []).join(' '), body].join(' ').toLowerCase()
    );
  } catch {}

  rebuildWikilinkIndex();

  if (openCreated) {
    renderTree();
    openNote(n.id);
  }

  return n;
}

function selectFolderSubtree(folderId) {
  const keys = new Set();
  keys.add(folderKey(folderId));

  const folders = collectFolderIdsRecursive(folderId);

  for (const id of folders) {
    keys.add(folderKey(id));
  }

  for (const n of state.notes.values()) {
    if (n.folderId && folders.has(n.folderId)) {
      keys.add(noteKey(n.id));
    }
  }

  selection.keys = keys;
  selection.anchorKey = folderKey(folderId);

  renderTree();
}

function collectFolderIdsRecursive(rootId) {
  const out = new Set([rootId]);
  const stack = [rootId];

  while (stack.length) {
    const cur = stack.pop();

    for (const f of state.folders.values()) {
      if (f.parentId === cur && !out.has(f.id)) {
        out.add(f.id);
        stack.push(f.id);
      }
    }
  }

  return out;
}

async function deleteSelectedItems(items = getSelectedItems()) {
  const selectedFolderIds = new Set(
    selectedFolders(items).map((f) => f.id)
  );

  const selectedNoteIds = new Set(
    selectedNotes(items).map((n) => n.id)
  );

  const allFolderIds = new Set();

  for (const folderId of selectedFolderIds) {
    for (const id of collectFolderIdsRecursive(folderId)) {
      allFolderIds.add(id);
    }
  }

  const allNoteIds = new Set(selectedNoteIds);

  for (const n of state.notes.values()) {
    if (n.folderId && allFolderIds.has(n.folderId)) {
      allNoteIds.add(n.id);
    }
  }

  const msgParts = [];

  if (allNoteIds.size) {
    msgParts.push(`${allNoteIds.size} note${allNoteIds.size === 1 ? '' : 's'}`);
  }

  if (allFolderIds.size) {
    msgParts.push(`${allFolderIds.size} folder${allFolderIds.size === 1 ? '' : 's'}`);
  }

  if (!msgParts.length) return;

  const recursiveWarning = allFolderIds.size
    ? '\n\nFolders are deleted together with all notes and sub-folders inside them.'
    : '';

  if (!confirm(`Delete ${msgParts.join(' and ')}? This cannot be undone.${recursiveWarning}`)) {
    return;
  }

  await deleteNotesAndFolders({
    noteIds: allNoteIds,
    folderIds: allFolderIds,
    recursiveFolders: true,
  });
}

async function deleteNotesAndFolders({ noteIds, folderIds, recursiveFolders = true }) {
  const deletedCurrent = noteIds.has(state.currentNoteId);

  for (const noteId of noteIds) {
    const n = state.notes.get(noteId);
    if (!n) continue;

    await store.notes.del(noteId);
    state.notes.delete(noteId);
    state.searchIndex.delete(noteId);

    await destroyNoteDoc(noteId);

    syncDeleteNoteFile(n).catch(() => {});
  }

  if (recursiveFolders) {
    for (const folderId of folderIds) {
      await store.folders.del(folderId);
      state.folders.delete(folderId);
      state.expandedFolders.delete(folderId);
    }
  }

  for (const key of [...selection.keys]) {
    if (!treeKeyExists(key)) {
      selection.keys.delete(key);
    }
  }

  if (selection.anchorKey && !treeKeyExists(selection.anchorKey)) {
    selection.anchorKey = selection.keys.values().next().value || null;
  }

  rebuildWikilinkIndex();

  if (deletedCurrent) {
    state.currentNoteId = null;

    const next = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];

    if (next) {
      await openNote(next.id);
    } else {
      clearEditor();
    }
  }

  renderTree();

  toast('Deleted selected item(s)', 'success');
}

// ============================================================
// Public helper
// ============================================================

export function currentFolderForNew() {
  if (state.currentNoteId) {
    const n = state.notes.get(state.currentNoteId);
    return n?.folderId || null;
  }

  return null;
}