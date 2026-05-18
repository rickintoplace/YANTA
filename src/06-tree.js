/* ============================================================
   YANTA — sidebar tree, folder/note rows, context menus,
   drag-and-drop reorganisation, tag cloud.
   ============================================================ */
'use strict';

/* ----------------------------------------------------------------
   tree (sidebar) — folders + notes + filters
---------------------------------------------------------------- */
function renderTree() {
  const root = $('tree');
  root.replaceChildren();

  const q = state.searchQuery.toLowerCase();
  const filterTag = state.activeTagFilter;
  const filterFolder = state.activeFolderFilter;

  // Filtered set of notes (after search + tag)
  const visible = [...state.notes.values()].filter((n) => {
    if (filterTag && !n.tags.includes(filterTag)) return false;
    if (q && !(n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.join(' ').toLowerCase().includes(q))) return false;
    return true;
  });

  // Pinned section
  const pinned = visible.filter((n) => n.pinned).sort((a, b) => b.updated - a.updated);
  if (pinned.length) {
    const sec = el('div', { class: 'tree-section' });
    sec.append(el('div', { class: 'tree-section-title' }, 'Pinned'));
    for (const n of pinned) sec.append(noteRow(n));
    root.append(sec);
  }

  // Folder tree
  const folderSec = el('div', { class: 'tree-section' });
  const ftitle = el('div', { class: 'tree-section-title' }, 'Folders',
    el('button', { class: 'icon-btn', title: 'New folder', onclick: () => newFolder(null), style: { width: '20px', height: '20px' } }, '+'));
  // Drop on the "Folders" header → move to root (out of any folder)
  ftitle.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer.types || [])].includes('text/yanta-note') &&
        ![...(e.dataTransfer.types || [])].includes('text/yanta-folder')) return;
    e.preventDefault();
    ftitle.classList.add('drop-target');
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
  // root-level pseudo: notes without folder
  const orphanNotes = visible.filter((n) => !n.folderId && !n.pinned).sort((a, b) => b.updated - a.updated);
  for (const n of orphanNotes) folderSec.append(noteRow(n));
  // top-level folders
  const topFolders = [...state.folders.values()].filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name));
  for (const f of topFolders) folderSec.append(folderRow(f, visible, 0));
  if (!topFolders.length && !orphanNotes.length) {
    folderSec.append(el('div', { class: 'tree-empty' }, q || filterTag ? 'No matches' : 'No notes yet'));
  }
  root.append(folderSec);

  renderTagCloud();
  updateStorageMeter();
}

// True if `ancestorId` is an ancestor of `descendantId` (so we don't
// allow a folder to be dropped into one of its own descendants).
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
  const isActive = state.activeFolderFilter === f.id;
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
      if (![...(e.dataTransfer.types || [])].includes('text/yanta-note') &&
          ![...(e.dataTransfer.types || [])].includes('text/yanta-folder')) return;
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
        note.folderId = f.id;
        note.updated = Date.now();
        await store.notes.put(note);
      } else if (folderId && folderId !== f.id && !isAncestor(folderId, f.id)) {
        const folder = state.folders.get(folderId);
        if (!folder) return;
        folder.parentId = f.id;
        await store.folders.put(folder);
      }
      state.expandedFolders.add(f.id);
      renderTree();
    },
  });
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/yanta-folder', f.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  row.append(el('span', { class: 'twist' }, expanded ? '▾' : '▸'));
  row.append(svgIcon('folder'));
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
  const row = el('div', {
    class: 'tree-row note' + (isActive ? ' active' : ''),
    style: { paddingLeft: (24 + depth * 14) + 'px' },
    draggable: 'true',
    onclick: () => openNote(n.id),
    oncontextmenu: (e) => { e.preventDefault(); noteMenu(e, n); },
    ondragstart: (e) => { e.dataTransfer.setData('text/yanta-note', n.id); },
  });
  row.append(svgIcon('doc'));
  row.append(el('span', { class: 'label' }, n.title || 'Untitled'));
  if (n.pinned) row.append(el('span', { class: 'pin', title: 'Pinned' }, '●'));
  return row;
}

function svgIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  let path;
  if (name === 'folder') {
    path = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
  } else {
    path = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6';
  }
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

function renderTagCloud() {
  const c = $('tagCloud');
  c.replaceChildren();
  const counts = new Map();
  for (const n of state.notes.values()) {
    for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return;
  for (const [t, n] of sorted) {
    const p = el('span', {
      class: 'tag-pill' + (state.activeTagFilter === t ? ' active' : ''),
      onclick: () => { state.activeTagFilter = state.activeTagFilter === t ? null : t; renderTree(); },
    }, '#' + t, el('span', { class: 'count' }, String(n)));
    c.append(p);
  }
}

/* ----------------------------------------------------------------
   context menus
---------------------------------------------------------------- */
let activeMenu = null;
function _menuOutsideClose(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}
function showMenu(x, y, items) {
  closeMenu();
  const m = el('div', { class: 'ctx-menu', style: { left: x + 'px', top: y + 'px' } });
  for (const it of items) {
    if (it === 'hr') { m.append(el('hr')); continue; }
    m.append(el('button', { class: it.danger ? 'danger' : '', onclick: () => { closeMenu(); it.action(); } }, it.label));
  }
  document.body.append(m);
  activeMenu = m;
  // Install outside-click on next tick so the click that opened the menu
  // doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', _menuOutsideClose, true);
  }, 0);
  // adjust if off screen
  const r = m.getBoundingClientRect();
  if (r.right > window.innerWidth) m.style.left = (x - r.width) + 'px';
  if (r.bottom > window.innerHeight) m.style.top = (y - r.height) + 'px';
}
function closeMenu() {
  if (!activeMenu) return;
  document.removeEventListener('mousedown', _menuOutsideClose, true);
  activeMenu.remove();
  activeMenu = null;
}

function noteMenu(e, n) {
  showMenu(e.clientX, e.clientY, [
    { label: n.pinned ? 'Unpin' : 'Pin', action: () => { n.pinned = !n.pinned; n.updated = Date.now(); store.notes.put(n); renderTree(); updatePinIcon(); } },
    { label: 'Rename…', action: () => { const t = prompt('Title:', n.title); if (t) { n.title = t; n.updated = Date.now(); store.notes.put(n); if (state.currentNoteId === n.id) $('noteTitle').value = t; renderTree(); } } },
    { label: 'Move to folder…', action: () => moveNoteDialog(n) },
    { label: 'Duplicate', action: () => duplicateNote(n) },
    { label: 'Export as .md', action: () => exportNoteAsMd(n) },
    'hr',
    { label: 'Delete', danger: true, action: async () => { if (confirm(`Delete "${n.title}"?`)) { await store.notes.del(n.id); state.notes.delete(n.id); if (state.currentNoteId === n.id) clearEditor(); renderTree(); } } },
  ]);
}
function folderMenu(e, f) {
  showMenu(e.clientX, e.clientY, [
    { label: 'New note here', action: () => newNote(f.id) },
    { label: 'New sub-folder', action: () => newFolder(f.id) },
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
  const n = { ...src, id: uid(), title: src.title + ' (copy)', created: Date.now(), updated: Date.now() };
  await store.notes.put(n);
  state.notes.set(n.id, n);
  rebuildWikilinkIndex();
  renderTree();
  openNote(n.id);
}
