// ============================================================
// YANTA — Sidebar tree (folders + notes), tag cloud, context
// menus, drag-and-drop reorganisation.
// ============================================================

import { $, el, uid, state, store, lucide, safeCssColor } from './core.js';
import { openIconPicker } from './icon-picker.js';
import { openNote, newNote, newFolder, deleteCurrentNote, togglePin, rebuildWikilinkIndex, clearEditor, createNoteWithTitle } from './notes.js';
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

export function renderTree() {
  const root = $('tree');
  if (!root) return;
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

  const pinned = visible.filter((n) => n.pinned).sort((a, b) => b.updated - a.updated);
  if (pinned.length) {
    const sec = el('div', { class: 'tree-section' });
    sec.append(el('div', { class: 'tree-section-title' }, 'Pinned'));
    for (const n of pinned) sec.append(noteRow(n));
    root.append(sec);
  }

  const folderSec = el('div', { class: 'tree-section' });
  const ftitle = el('div', { class: 'tree-section-title' }, 'Folders',
    el('button', { class: 'icon-btn', title: 'New folder', onclick: () => newFolder(null), style: { width: '20px', height: '20px' } }, '+'));
  ftitle.addEventListener('dragover', (e) => {
    const types = [...(e.dataTransfer.types || [])];
    if (!types.includes('text/yanta-note') && !types.includes('text/yanta-folder')) return;
    e.preventDefault(); ftitle.classList.add('drop-target');
  });
  ftitle.addEventListener('dragleave', () => ftitle.classList.remove('drop-target'));
  ftitle.addEventListener('drop', async (e) => {
    ftitle.classList.remove('drop-target');
    const noteId = e.dataTransfer.getData('text/yanta-note');
    const folderId = e.dataTransfer.getData('text/yanta-folder');
    e.preventDefault();
    if (noteId) {
      const note = state.notes.get(noteId);
      if (note) { note.folderId = null; note.updated = Date.now(); await store.notes.put(note); }
    } else if (folderId) {
      const folder = state.folders.get(folderId);
      if (folder) { folder.parentId = null; await store.folders.put(folder); }
    }
    renderTree();
  });
  folderSec.append(ftitle);

  const orphanNotes = visible.filter((n) => !n.folderId && !n.pinned).sort((a, b) => b.updated - a.updated);
  for (const n of orphanNotes) folderSec.append(noteRow(n));
  const topFolders = [...state.folders.values()].filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name));
  for (const f of topFolders) folderSec.append(folderRow(f, visible, 0));
  if (!topFolders.length && !orphanNotes.length) folderSec.append(el('div', { class: 'tree-empty' }, q || filterTag ? 'No matches' : 'No notes yet'));
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
  const wrap = el('div');
  const expanded = state.expandedFolders.has(f.id);
  const isActive = state.activeTagFilter === f.id;
  const childFolders = [...state.folders.values()].filter((x) => x.parentId === f.id).sort((a, b) => a.name.localeCompare(b.name));
  const childNotes = visibleNotes.filter((n) => n.folderId === f.id && !n.pinned).sort((a, b) => b.updated - a.updated);
  const row = el('div', {
    class: 'tree-row folder' + (isActive ? ' active' : ''),
    style: { paddingLeft: (12 + depth * 14) + 'px' },
    onclick: () => {
      if (expanded) state.expandedFolders.delete(f.id);
      else state.expandedFolders.add(f.id);
      renderTree();
    },
    oncontextmenu: (e) => { e.preventDefault(); folderMenu(e, f); },
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
      const noteId = e.dataTransfer.getData('text/yanta-note');
      const folderId = e.dataTransfer.getData('text/yanta-folder');
      e.preventDefault();
      if (noteId) {
        const note = state.notes.get(noteId);
        if (!note) return;
        note.folderId = f.id; note.updated = Date.now(); await store.notes.put(note);
      } else if (folderId && folderId !== f.id && !isAncestor(folderId, f.id)) {
        const folder = state.folders.get(folderId);
        if (!folder) return;
        folder.parentId = f.id; await store.folders.put(folder);
      }
      state.expandedFolders.add(f.id);
      renderTree();
    },
  });
  applyItemColor(row, f.color);
  row.draggable = true;
  row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/yanta-folder', f.id); e.dataTransfer.effectAllowed = 'move'; });
  row.append(el('span', { class: 'twist' }, expanded ? '▾' : '▸'));
  row.append(itemIcon(f.icon || 'folder', f.color));
  row.append(el('span', { class: 'label' }, f.name));
  row.append(el('span', { class: 'menu-trigger', title: 'Add note', onclick: (e) => { e.stopPropagation(); newNote(f.id); } }, '+'));
  wrap.append(row);
  if (expanded) {
    const kids = el('div', { class: 'tree-children' });
    for (const sf of childFolders) kids.append(folderRow(sf, visibleNotes, depth + 1));
    for (const n of childNotes) kids.append(noteRow(n, depth + 1));
    if (!childFolders.length && !childNotes.length) kids.append(el('div', { class: 'tree-empty' }, 'Empty'));
    wrap.append(kids);
  }
  return wrap;
}

function noteRow(n, depth = 0) {
  const isActive = state.currentNoteId === n.id;

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
    class: 'tree-row note' + (isActive ? ' active' : ''),
    style: rowStyle,
    draggable: 'true',
    onclick: () => openNote(n.id),
    oncontextmenu: (e) => { e.preventDefault(); noteMenu(e, n); },
    ondragstart: (e) => {
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
      if (!draggedId || draggedId === n.id) return;
      e.preventDefault();
      // Dropping a note onto another note → move it into that note's folder.
      const dropped = state.notes.get(draggedId);
      if (!dropped) return;
      dropped.folderId = n.folderId;
      dropped.updated = Date.now();
      await store.notes.put(dropped);
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
    const dot = el('span', { class: 'sync-dot sync-dot-' + status, title: statusLabel(status) });
    row.append(dot);
  }

  if (state.liveShares.has(n.id)) row.append(el('span', { class: 'live-dot', title: 'Live shared' }));
  if (n.pinned) row.append(el('span', { class: 'pin', title: 'Pinned' }, '●'));
  return row;
}

function statusLabel(s) {
  return { local: 'Local changes', remote: 'Remote changes', syncing: 'Syncing…', conflict: 'Conflict' }[s] || s;
}

function svgIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  let path;
  if (name === 'folder') path = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
  else if (name === 'list') path = 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01';
  else path = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6';
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export function renderTagCloud() {
  const c = $('tagCloud');
  if (!c) return;
  c.replaceChildren();
  const counts = new Map();
  for (const n of state.notes.values()) for (const t of n.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [t, n] of sorted) {
    const p = el('span', {
      class: 'tag-pill' + (state.activeTagFilter === t ? ' active' : ''),
      onclick: () => { state.activeTagFilter = state.activeTagFilter === t ? null : t; renderTree(); },
    }, '#' + t, el('span', { class: 'count' }, String(n)));
    c.append(p);
  }
}

// ---------------- Context menus -------------------------------
let activeMenu = null;
function _menuOutsideClose(e) { if (activeMenu && !activeMenu.contains(e.target)) closeMenu(); }
export function showMenu(x, y, items) {
  closeMenu();
  const m = el('div', { class: 'ctx-menu', style: { left: x + 'px', top: y + 'px' } });
  for (const it of items) {
    if (it === 'hr') { m.append(el('hr')); continue; }
    m.append(el('button', { class: it.danger ? 'danger' : '', onclick: () => { closeMenu(); it.action(); } }, it.label));
  }
  document.body.append(m);
  activeMenu = m;
  setTimeout(() => document.addEventListener('mousedown', _menuOutsideClose, true), 0);
  const r = m.getBoundingClientRect();
  if (r.right > window.innerWidth) m.style.left = (x - r.width) + 'px';
  if (r.bottom > window.innerHeight) m.style.top = (y - r.height) + 'px';
}
export function closeMenu() {
  if (!activeMenu) return;
  document.removeEventListener('mousedown', _menuOutsideClose, true);
  activeMenu.remove();
  activeMenu = null;
}

function noteMenu(e, n) {
  showMenu(e.clientX, e.clientY, [
    { label: n.pinned ? 'Unpin' : 'Pin', action: () => { n.pinned = !n.pinned; n.updated = Date.now(); store.notes.put(n); renderTree(); } },
    { label: 'Icon & color…', action: () => editNoteIconColor(n) },
    { label: 'Rename…', action: () => { const t = prompt('Title:', n.title); if (t) { n.title = t; n.updated = Date.now(); store.notes.put(n); if (state.currentNoteId === n.id) $('noteTitle').value = t; rebuildWikilinkIndex(); renderTree(); } } },
    { label: 'Move to folder…', action: () => moveNoteDialog(n) },
    { label: 'Duplicate', action: () => duplicateNote(n) },
    'hr',
    { label: 'Delete', danger: true, action: async () => {
      if (!confirm(`Delete "${n.title}"?`)) return;
      await store.notes.del(n.id);
      state.notes.delete(n.id);
      await destroyNoteDoc(n.id);
      syncDeleteNoteFile(n).catch(() => {});
      rebuildWikilinkIndex();
      if (state.currentNoteId === n.id) clearEditor();
      renderTree();
    } },
  ]);
}

function folderMenu(e, f) {
  showMenu(e.clientX, e.clientY, [
    { label: 'New note here', action: () => newNote(f.id) },
    { label: 'New sub-folder', action: () => newFolder(f.id) },
    { label: 'Icon & color…', action: () => editFolderIconColor(f) },
    { label: 'Rename…', action: () => { const t = prompt('Folder name:', f.name); if (t) { f.name = t; store.folders.put(f); renderTree(); } } },
    'hr',
    { label: 'Delete folder', danger: true, action: async () => {
      const childNotes = [...state.notes.values()].filter((n) => n.folderId === f.id);
      const msg = childNotes.length ? `Delete "${f.name}" and move ${childNotes.length} note(s) out of it?` : `Delete "${f.name}"?`;
      if (!confirm(msg)) return;
      for (const n of childNotes) { n.folderId = null; await store.notes.put(n); }
      await store.folders.del(f.id);
      state.folders.delete(f.id);
      renderTree();
    } },
  ]);
}

function moveNoteDialog(n) {
  const folders = [...state.folders.values()];
  const opts = ['(no folder)', ...folders.map((f) => f.name)];
  const choice = prompt(`Move to folder:\n${opts.map((o, i) => `${i}. ${o}`).join('\n')}\n\nEnter number:`);
  if (choice === null) return;
  const idx = parseInt(choice, 10);
  if (isNaN(idx) || idx < 0 || idx > folders.length) return;
  n.folderId = idx === 0 ? null : folders[idx - 1].id;
  n.updated = Date.now();
  store.notes.put(n);
  renderTree();
}

async function duplicateNote(src) {
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
    if (body) dstEntry.doc.getText('markdown').insert(0, body);

    state.searchIndex.set(
      id,
      [n.title || '', (n.tags || []).join(' '), body].join(' ').toLowerCase()
    );
  } catch {}

  rebuildWikilinkIndex();
  renderTree();
  openNote(n.id);
}

export function currentFolderForNew() {
  if (state.currentNoteId) {
    const n = state.notes.get(state.currentNoteId);
    return n?.folderId || null;
  }
  return null;
}

function editNoteIconColor(n) {
  openIconPicker({
    title: `Icon & color: ${n.title || 'Untitled'}`,
    initialIcon: n.icon || (n.type === 'list' ? 'list' : 'file'),
    initialColor: n.color || '#6ea8fe',
    onApply: async ({ icon, color }) => {
      if (icon === null && color === null) {
        delete n.icon;
        delete n.color;
      } else {
        n.icon = icon;
        n.color = color;
      }

      n.updated = Date.now();
      await store.notes.put(n);
      renderTree();
    },
  });
}

function editFolderIconColor(f) {
  openIconPicker({
    title: `Icon & color: ${f.name || 'Folder'}`,
    initialIcon: f.icon || 'folder',
    initialColor: f.color || '#6ea8fe',
    onApply: async ({ icon, color }) => {
      if (icon === null && color === null) {
        delete f.icon;
        delete f.color;
      } else {
        f.icon = icon;
        f.color = color;
      }

      await store.folders.put(f);
      renderTree();
    },
  });
}