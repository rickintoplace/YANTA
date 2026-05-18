/* ============================================================
   YANTA — wikilinks (index, autocomplete, backlinks, hover
   preview, outline) + command palette + quick switcher.
   ============================================================ */
'use strict';

/* ================================================================
   Wikilinks — [[Target]] / [[Target|alias]]
================================================================ */
const wikilinkIndex = new Map(); // titleLower -> noteId

function rebuildWikilinkIndex() {
  wikilinkIndex.clear();
  for (const n of state.notes.values()) {
    if (n.title) wikilinkIndex.set(n.title.toLowerCase(), n.id);
  }
}

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;

// All notes that link to `noteId`, with one example line each.
function getBacklinks(noteId) {
  const note = state.notes.get(noteId);
  if (!note) return [];
  const target = note.title.trim().toLowerCase();
  const out = [];
  for (const n of state.notes.values()) {
    if (n.id === noteId) continue;
    WIKILINK_RE.lastIndex = 0;
    let m;
    let foundLine = null;
    while ((m = WIKILINK_RE.exec(n.body || '')) !== null) {
      if (m[1].trim().toLowerCase() === target) {
        const before = n.body.slice(0, m.index);
        const lineIdx = before.split('\n').length - 1;
        foundLine = (n.body.split('\n')[lineIdx] || '').trim();
        break;
      }
    }
    if (foundLine != null) out.push({ note: n, line: foundLine });
  }
  return out.sort((a, b) => b.note.updated - a.note.updated);
}

// Render an Outline / Table of Contents at the top of preview when the
// current note has 2+ headings. Clicking a heading scrolls to it.
function renderOutline() {
  const pv = $('preview');
  const old = pv.querySelector('.pv-outline');
  if (old) old.remove();
  const lines = lastMarkdown.split('\n');
  const headings = [];
  const ctx = { inFence: false };
  for (const line of lines) {
    const info = classifyLine(line, ctx);
    if (info.type === 'fence') { ctx.inFence = info.opens ? true : false; continue; }
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), slug: headingSlug(m[2].trim()) });
  }
  if (headings.length < 2) return;
  const minLvl = Math.min(...headings.map((h) => h.level));
  const wrap = el('div', { class: 'pv-outline', contenteditable: 'false' });
  const head = el('div', { class: 'pv-outline-head', onclick: () => wrap.classList.toggle('collapsed') });
  const chev = el('span', { class: 'pv-outline-chev' });
  chev.innerHTML = lucide('chevron-down', 12);
  head.append(chev, el('span', {}, `Outline · ${headings.length} headings`));
  wrap.append(head);
  const list = el('div', { class: 'pv-outline-list' });
  for (const h of headings) {
    const item = el('a', {
      class: 'pv-outline-item',
      style: { paddingLeft: (8 + (h.level - minLvl) * 14) + 'px' },
      onclick: (e) => {
        e.preventDefault();
        const target = pv.querySelector(`#h-${CSS.escape(h.slug)}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, h.text);
    list.append(item);
  }
  wrap.append(list);
  // Insert as first preview child
  pv.insertBefore(wrap, pv.firstChild);
}

function renderBacklinks() {
  const pv = $('preview');
  const old = pv.querySelector('.backlinks');
  if (old) old.remove();
  if (!state.currentNoteId) return;
  const back = getBacklinks(state.currentNoteId);
  const wrap = el('div', { class: 'backlinks', contenteditable: 'false' });
  const title = el('div', { class: 'backlinks-title' }, 'Linked from',
    el('span', { class: 'badge' }, String(back.length)));
  wrap.append(title);
  if (!back.length) {
    wrap.append(el('div', { class: 'backlinks-empty' }, 'No backlinks yet. Reference this note from another with [[' + (state.notes.get(state.currentNoteId)?.title || '') + ']].'));
  } else {
    for (const { note, line } of back) {
      const item = el('div', { class: 'backlink', onclick: () => openNote(note.id) });
      item.append(el('div', { class: 'bl-title' }, note.title || 'Untitled'));
      // highlight the [[link]] in the context
      const tname = state.notes.get(state.currentNoteId).title;
      const ctx = line.replace(new RegExp('\\[\\[' + tname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\|[^\\]]+)?\\]\\]', 'gi'), `<span class="bl-mark">[[${escapeHtml(tname)}$1]]</span>`);
      const ctxDiv = el('div', { class: 'bl-context' });
      ctxDiv.innerHTML = ctx.length > 200 ? ctx.slice(0, 200) + '…' : ctx;
      item.append(ctxDiv);
      wrap.append(item);
    }
  }
  pv.append(wrap);
}

/* ================================================================
   Wikilink hover preview — peek at the linked note without leaving.
================================================================ */
let _hoverShowTimer = null, _hoverHideTimer = null;
function setupWikilinkHover() {
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest('a.wiki-link');
    if (!a || a.classList.contains('missing')) return;
    clearTimeout(_hoverHideTimer);
    clearTimeout(_hoverShowTimer);
    _hoverShowTimer = setTimeout(() => showHoverPreview(a), 280);
  });
  document.addEventListener('mouseout', (e) => {
    const a = e.target.closest('a.wiki-link');
    const hp = $('hoverPreview');
    const toHp = e.relatedTarget && hp.contains(e.relatedTarget);
    if (!a && !toHp) return;
    clearTimeout(_hoverShowTimer);
    _hoverHideTimer = setTimeout(hideHoverPreview, 250);
  });
  $('hoverPreview').addEventListener('mouseenter', () => clearTimeout(_hoverHideTimer));
  $('hoverPreview').addEventListener('mouseleave', () => hideHoverPreview());
}
function showHoverPreview(a) {
  const id = a.dataset.noteId;
  if (!id) return;
  const note = state.notes.get(id);
  if (!note) return;
  const hp = $('hoverPreview');
  // Render up to 600 chars of the body for context, plus title
  const snippet = (note.body || '').slice(0, 600);
  hp.innerHTML =
    `<div class="hp-title">${escapeHtml(note.title || 'Untitled')}</div>` +
    `<div class="hp-body">${renderBlocksInline(snippet)}</div>` +
    ((note.body || '').length > 600 ? '<div class="hp-more">…click to open</div>' : '');
  hp.hidden = false;
  const r = a.getBoundingClientRect();
  const hw = hp.offsetWidth || 380;
  const hh = hp.offsetHeight || 120;
  let x = r.left;
  let y = r.bottom + 6;
  if (x + hw > window.innerWidth - 8) x = window.innerWidth - hw - 8;
  if (y + hh > window.innerHeight - 8) y = r.top - hh - 6;
  hp.style.left = Math.max(8, x) + 'px';
  hp.style.top = Math.max(8, y) + 'px';
}
function hideHoverPreview() {
  $('hoverPreview').hidden = true;
}

/* ================================================================
   Wikilink click / create flow
================================================================ */
function handleWikilinkClick(e) {
  const a = e.target.closest('a.wiki-link');
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  const target = a.dataset.wiki;
  const id = a.dataset.noteId;
  if (id && state.notes.get(id)) {
    openNote(id);
  } else {
    if (confirm(`Note "${target}" doesn't exist yet. Create it?`)) {
      createNoteWithTitle(target);
    }
  }
}
async function createNoteWithTitle(title) {
  const note = {
    id: uid(),
    title: title.trim() || 'Untitled',
    body: '',
    folderId: state.currentNoteId ? state.notes.get(state.currentNoteId)?.folderId || null : null,
    tags: [],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };
  state.notes.set(note.id, note);
  await store.notes.put(note);
  rebuildWikilinkIndex();
  openNote(note.id);
  renderTree();
}

/* ================================================================
   Autocomplete popup — used for [[ wikilinks
================================================================ */
const ac = {
  el: null, items: [], active: 0,
  triggerStart: -1, lineDiv: null, mode: 'wiki', // 'wiki'
};
function acHide() {
  const e = $('autocomplete');
  if (e) e.hidden = true;
  ac.items = []; ac.triggerStart = -1; ac.active = 0;
}
function acShowWiki(query, anchorRect) {
  const e = $('autocomplete');
  if (!e) return;
  const q = query.toLowerCase();
  // Score notes by title containing query
  const all = [...state.notes.values()]
    .filter((n) => n.id !== state.currentNoteId)
    .map((n) => ({ n, score: scoreMatch(n.title || '', q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  ac.items = all.map(({ n }) => ({ kind: 'note', id: n.id, label: n.title || 'Untitled', meta: 'note' }));
  // Always offer "Create" if query is non-empty and no exact match
  if (query.trim() && !state.notes.has(wikilinkIndex.get(query.trim().toLowerCase()))) {
    ac.items.push({ kind: 'create', label: 'Create "' + query.trim() + '"', meta: 'new', value: query.trim() });
  }
  if (!ac.items.length) { acHide(); return; }
  ac.active = 0;
  e.replaceChildren();
  for (let i = 0; i < ac.items.length; i++) {
    const it = ac.items[i];
    const row = el('div', {
      class: 'ac-item' + (i === ac.active ? ' active' : ''),
      dataset: { i: String(i) },
      onclick: () => acAccept(i),
    });
    if (it.kind === 'create') row.classList.add('create');
    const ico = el('span', { class: 'ac-icon' });
    ico.innerHTML = lucide(it.kind === 'create' ? 'plus' : 'file', 14);
    row.append(ico);
    row.append(el('span', { class: 'ac-label' }, it.label));
    row.append(el('span', { class: 'ac-meta' }, it.meta));
    e.append(row);
  }
  e.hidden = false;
  // position below the cursor; anchorRect is the caret bounding rect
  const ew = e.offsetWidth || 240, eh = e.offsetHeight || 160;
  let x = anchorRect.left;
  let y = anchorRect.bottom + 4;
  if (x + ew > window.innerWidth - 8) x = window.innerWidth - ew - 8;
  if (y + eh > window.innerHeight - 8) y = anchorRect.top - eh - 4;
  e.style.left = x + 'px';
  e.style.top = y + 'px';
}
function acMove(delta) {
  if (!ac.items.length) return;
  ac.active = (ac.active + delta + ac.items.length) % ac.items.length;
  const e = $('autocomplete');
  for (const child of e.children) child.classList.toggle('active', parseInt(child.dataset.i, 10) === ac.active);
  const sel = e.children[ac.active];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
async function acAccept(i) {
  if (i == null) i = ac.active;
  const item = ac.items[i];
  if (!item) { acHide(); return; }
  let inserted;
  if (item.kind === 'create') {
    inserted = item.value;
  } else {
    inserted = item.label;
  }
  // Replace the partial text from `[[<query>` with `[[<inserted>]]`
  replaceWikiTrigger(inserted);
  acHide();
}
function replaceWikiTrigger(insertText) {
  const pos = getCursorPos();
  if (!pos) return;
  const lines = lastMarkdown.split('\n');
  const line = lines[pos.lineIndex] || '';
  // Find the `[[` to the left of cursor (within this line)
  const before = line.slice(0, pos.offset);
  const open = before.lastIndexOf('[[');
  if (open < 0) return;
  const after = line.slice(pos.offset);
  // Replace from `[[` to cursor with [[insertText]]
  const newLine = line.slice(0, open) + '[[' + insertText + ']]' + after;
  lines[pos.lineIndex] = newLine;
  lastMarkdown = lines.join('\n');
  renderEditor(lastMarkdown);
  const newOffset = open + 2 + insertText.length + 2;
  setCursorPos({ lineIndex: pos.lineIndex, offset: newOffset });
  schedulePreview();
  setTimeout(renderBacklinks, 200);
  markDirty(); scheduleSave();
}

// Detect [[ trigger after each input event in the editor.
function checkWikiAutocomplete() {
  const pos = getCursorPos();
  if (!pos) { acHide(); return; }
  const lines = lastMarkdown.split('\n');
  const line = lines[pos.lineIndex] || '';
  const before = line.slice(0, pos.offset);
  const open = before.lastIndexOf('[[');
  const close = before.lastIndexOf(']]');
  if (open < 0 || close > open) { acHide(); return; }
  // We're inside an unclosed [[
  const query = before.slice(open + 2);
  if (query.length > 40 || /\n/.test(query)) { acHide(); return; }
  // Get caret rect
  const sel = window.getSelection();
  if (!sel.rangeCount) { acHide(); return; }
  const rng = sel.getRangeAt(0).cloneRange();
  let rect = rng.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    // collapsed at end — use the parent line's rect end
    const blocks = [...editor.children];
    const lineEl = blocks[pos.lineIndex];
    if (lineEl) rect = lineEl.getBoundingClientRect();
  }
  acShowWiki(query, rect);
}

/* ================================================================
   Command palette + Quick switcher
================================================================ */
const palette = {
  mode: 'commands', // 'commands' | 'notes'
  items: [],
  active: 0,
  filter: '',
};
function openPalette(mode = 'commands') {
  palette.mode = mode;
  palette.filter = '';
  palette.active = 0;
  $('paletteInput').value = '';
  $('paletteInput').placeholder = mode === 'commands'
    ? 'Type a command…'
    : 'Type to switch to a note…';
  $('paletteMode').textContent = mode === 'commands' ? 'Command palette' : 'Quick switcher';
  buildPaletteItems();
  $('palette').hidden = false;
  $('paletteInput').focus();
}
function closePalette() {
  $('palette').hidden = true;
  palette.items = [];
}
function buildPaletteItems() {
  const q = palette.filter.trim().toLowerCase();
  if (palette.mode === 'commands') {
    palette.items = commandList
      .map((c) => ({ ...c, score: q ? scoreMatch(c.label, q) + (c.label.toLowerCase().startsWith(q) ? 50 : 0) : 1 }))
      .filter((c) => !q || c.score > 0)
      .sort((a, b) => b.score - a.score);
  } else {
    palette.items = [...state.notes.values()]
      .map((n) => ({ id: n.id, label: n.title || 'Untitled', folder: state.folders.get(n.folderId)?.name || '', score: q ? scoreMatch(n.title || '', q) : (Date.now() - n.updated) * -1 / 1e9 + 1 }))
      .filter((n) => !q || n.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 80);
  }
  palette.active = 0;
  renderPaletteList();
}
function renderPaletteList() {
  const list = $('paletteList');
  list.replaceChildren();
  if (!palette.items.length) {
    list.append(el('div', { class: 'palette-empty' }, palette.mode === 'commands' ? 'No matching command' : 'No matching note'));
    return;
  }
  for (let i = 0; i < palette.items.length; i++) {
    const it = palette.items[i];
    const row = el('div', {
      class: 'palette-item' + (i === palette.active ? ' active' : ''),
      dataset: { i: String(i) },
      onclick: () => paletteAccept(i),
      onmouseenter: () => { palette.active = i; for (const c of list.children) c.classList.toggle('active', parseInt(c.dataset.i, 10) === i); },
    });
    const icoSpan = el('span', { class: 'pi-icon' });
    if (palette.mode === 'commands') {
      icoSpan.innerHTML = lucide(it.icon || 'square', 14);
      row.append(icoSpan);
      row.append(el('span', { class: 'pi-label' }, it.label));
      if (it.hint) row.append(el('span', { class: 'pi-hint' }, it.hint));
    } else {
      icoSpan.innerHTML = lucide('file', 14);
      row.append(icoSpan);
      row.append(el('span', { class: 'pi-label' }, it.label));
      if (it.folder) row.append(el('span', { class: 'pi-meta' }, it.folder));
    }
    list.append(row);
  }
  // ensure active is visible
  const a = list.children[palette.active];
  if (a) a.scrollIntoView({ block: 'nearest' });
}
function paletteMove(delta) {
  if (!palette.items.length) return;
  palette.active = (palette.active + delta + palette.items.length) % palette.items.length;
  renderPaletteList();
}
function paletteAccept(i) {
  if (i == null) i = palette.active;
  const it = palette.items[i];
  if (!it) return;
  closePalette();
  if (palette.mode === 'commands') {
    if (it.action) it.action();
  } else {
    openNote(it.id);
  }
}

let commandList = [];
function buildCommandList() {
  commandList = [
    { label: 'New note', icon: 'plus', hint: 'Ctrl+N', action: () => newNote(currentFolderForNew()) },
    { label: 'New folder', icon: 'folder-plus', action: () => newFolder(null) },
    { label: 'Quick switcher (jump to note)', icon: 'file', hint: 'Ctrl+O', action: () => openPalette('notes') },
    { label: 'Open graph view', icon: 'network', hint: 'Ctrl+G', action: openGraph },
    { label: 'Search notes', icon: 'search', hint: 'Ctrl+K', action: () => $('search').focus() },
    { label: 'Toggle preview/edit/split', icon: 'eye', hint: 'Ctrl+/', action: () => setView(state.view === 'split' ? 'preview' : (state.view === 'preview' ? 'edit' : 'split')) },
    { label: 'Insert image', icon: 'image', hint: 'Ctrl+I', action: openImageModal },
    { label: 'Insert wikilink', icon: 'link', action: () => insertAtCursor('[[') },
    { label: 'Toggle pin', icon: 'pin', action: togglePin },
    { label: 'Cycle theme (auto/dark/light)', icon: 'moon', hint: 'T', action: toggleTheme },
    { label: 'Export as folder ZIP', icon: 'download', action: exportAsZip },
    { label: 'Export current note (.md)', icon: 'download', hint: 'Ctrl+E', action: () => { const n = state.currentNoteId ? state.notes.get(state.currentNoteId) : null; if (n) exportNoteAsMd(n); } },
    { label: 'Export full bundle (.json)', icon: 'download', action: exportBundle },
    { label: 'Export every note as .md', icon: 'download', action: exportEveryNoteMd },
    { label: 'Import files (md/json/zip)…', icon: 'upload', action: () => $('importFile').click() },
    { label: 'Import folder…', icon: 'upload', action: () => $('importFolder').click() },
    { label: 'Delete current note', icon: 'trash', action: deleteCurrentNote },
    { label: 'Vault: connect folder…', icon: 'git-branch', action: () => vaultConnect() },
    { label: 'Vault: sync everything now', icon: 'refresh', action: () => vaultSyncAll() },
    { label: 'Vault: pull external changes', icon: 'download', action: () => vaultPull() },
    { label: 'Vault: disconnect', icon: 'x', action: () => vaultDisconnect() },
  ];
}

// Simple fuzzy-ish scorer. Higher is better. 0 means no match.
function scoreMatch(text, query) {
  if (!query) return 1;
  const t = text.toLowerCase();
  let q = 0; let score = 0; let streak = 0;
  for (let i = 0; i < t.length && q < query.length; i++) {
    if (t[i] === query[q]) { q++; score += 1 + streak; streak += 1; }
    else { streak = 0; }
  }
  if (q < query.length) return 0;
  // prefer shorter matches
  return score + 10 / (1 + t.length);
}
