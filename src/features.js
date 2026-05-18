// ============================================================
// YANTA — Backlinks, outline, command palette, quick switcher,
// wikilink hover preview, wikilink click handler.
// ============================================================

import { $, el, state, escapeHtml, lucide, toast, toggleTheme } from './core.js';
import { wikilinkIndex } from './features-state.js';
import { openNote, createNoteWithTitle, deleteCurrentNote, newNote, newFolder, togglePin } from './notes.js';
import { renderBlocksInline, classifyLine, headingSlug } from './markdown.js';
import { noteMarkdown } from './yjs.js';
import { currentFolderForNew } from './tree.js';
import { insertAtCursor } from './editor.js';

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;

// -------- Backlinks --------------------------------------------
export function getBacklinks(noteId) {
  const note = state.notes.get(noteId);
  if (!note) return [];
  const target = (note.title || '').trim().toLowerCase();
  const out = [];
  for (const n of state.notes.values()) {
    if (n.id === noteId) continue;
    let body = '';
    try { body = noteMarkdown(n.id); } catch { continue; }
    WIKILINK_RE.lastIndex = 0;
    let m, found = null;
    while ((m = WIKILINK_RE.exec(body)) !== null) {
      if (m[1].trim().toLowerCase() === target) {
        const before = body.slice(0, m.index);
        const lineIdx = before.split('\n').length - 1;
        found = (body.split('\n')[lineIdx] || '').trim();
        break;
      }
    }
    if (found != null) out.push({ note: n, line: found });
  }
  return out.sort((a, b) => b.note.updated - a.note.updated);
}

export function renderBacklinks(noteId) {
  const pv = $('preview');
  if (!pv) return;
  const old = pv.querySelector('.backlinks');
  if (old) old.remove();
  if (!noteId) return;
  const back = getBacklinks(noteId);
  const wrap = el('div', { class: 'backlinks', contenteditable: 'false' });
  wrap.append(el('div', { class: 'backlinks-title' }, 'Linked from',
    el('span', { class: 'badge' }, String(back.length))));
  if (!back.length) {
    wrap.append(el('div', { class: 'backlinks-empty' }, 'No backlinks yet.'));
  } else {
    for (const { note, line } of back) {
      const item = el('div', { class: 'backlink', onclick: () => openNote(note.id) });
      item.append(el('div', { class: 'bl-title' }, note.title || 'Untitled'));
      const tname = state.notes.get(noteId).title || '';
      const safe = tname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ctx = line.replace(new RegExp('\\[\\[' + safe + '(\\|[^\\]]+)?\\]\\]', 'gi'), `<span class="bl-mark">[[${escapeHtml(tname)}$1]]</span>`);
      const ctxDiv = el('div', { class: 'bl-context' });
      ctxDiv.innerHTML = ctx.length > 200 ? ctx.slice(0, 200) + '…' : ctx;
      item.append(ctxDiv);
      wrap.append(item);
    }
  }
  pv.append(wrap);
}

// -------- Outline ----------------------------------------------
export function renderOutline(md) {
  const pv = $('preview');
  const pane = $('panePreview');
  if (!pv || !pane) return;

  // Alte TOCs entfernen — auch falls vorher einer ins article.preview gerutscht ist.
  pane.querySelector(':scope > .pv-outline')?.remove();
  pv.querySelector(':scope > .pv-outline')?.remove();

  const lines = md.split('\n');
  const headings = [];
  const ctx = { inFence: false };

  for (const line of lines) {
    const info = classifyLine(line, ctx);
    if (info.type === 'fence') {
      ctx.inFence = !!info.opens;
      continue;
    }

    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      headings.push({
        level: m[1].length,
        text: m[2].trim(),
        slug: headingSlug(m[2].trim()),
      });
    }
  }

  if (headings.length < 2) return;

  const minLvl = Math.min(...headings.map((h) => h.level));
  const wrap = el('div', { class: 'pv-outline', contenteditable: 'false' });

  const head = el('div', {
    class: 'pv-outline-head',
    onclick: () => wrap.classList.toggle('collapsed'),
  });

  const chev = el('span', { class: 'pv-outline-chev' });
  chev.innerHTML = lucide('chevron-down', 12);

  head.append(chev, el('span', {}, `Outline · ${headings.length} headings`));
  wrap.append(head);

  const list = el('div', { class: 'pv-outline-list' });

  for (const h of headings) {
    list.append(el('a', {
      class: 'pv-outline-item',
      style: { paddingLeft: (8 + (h.level - minLvl) * 14) + 'px' },
      onclick: (e) => {
        e.preventDefault();
        const t = pv.querySelector(`#h-${CSS.escape(h.slug)}`);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, h.text));
  }

  wrap.append(list);

  pane.insertBefore(wrap, pv);
}

// -------- Wikilink click + hover preview -----------------------
export function handleWikilinkClick(e) {
  const a = e.target.closest('a.wiki-link');
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  const target = a.dataset.wiki;
  const id = a.dataset.noteId;
  if (id && state.notes.get(id)) openNote(id);
  else if (confirm(`Note "${target}" doesn't exist yet. Create it?`)) createNoteWithTitle(target);
}

let _hoverShowTimer, _hoverHideTimer;
export function setupWikilinkHover() {
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest('a.wiki-link');
    if (!a || a.classList.contains('missing')) return;
    clearTimeout(_hoverHideTimer); clearTimeout(_hoverShowTimer);
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
  let body = '';
  try { body = noteMarkdown(id); } catch {}
  const snippet = body.slice(0, 600);
  hp.innerHTML =
    `<div class="hp-title">${escapeHtml(note.title || 'Untitled')}</div>` +
    `<div class="hp-body">${renderBlocksInline(snippet)}</div>` +
    (body.length > 600 ? '<div class="hp-more">…click to open</div>' : '');
  hp.hidden = false;
  const r = a.getBoundingClientRect();
  const hw = hp.offsetWidth || 380;
  const hh = hp.offsetHeight || 120;
  let x = r.left, y = r.bottom + 6;
  if (x + hw > window.innerWidth - 8) x = window.innerWidth - hw - 8;
  if (y + hh > window.innerHeight - 8) y = r.top - hh - 6;
  hp.style.left = Math.max(8, x) + 'px';
  hp.style.top = Math.max(8, y) + 'px';
}
function hideHoverPreview() { $('hoverPreview').hidden = true; }

// -------- Command palette + Quick switcher ---------------------
const palette = { mode: 'commands', items: [], active: 0, filter: '' };

export function openPalette(mode = 'commands') {
  palette.mode = mode;
  palette.filter = '';
  palette.active = 0;
  $('paletteInput').value = '';
  $('paletteInput').placeholder = mode === 'commands' ? 'Type a command…' : 'Type to switch to a note…';
  $('paletteMode').textContent = mode === 'commands' ? 'Command palette' : 'Quick switcher';
  buildPaletteItems();
  $('palette').hidden = false;
  $('paletteInput').focus();
}
export function closePalette() { $('palette').hidden = true; palette.items = []; }

let commandList = [];
export function buildCommandList({ openImageModal, openGraph, exportAsZip, exportNoteAsMd, exportBundle, exportEveryNoteMd, openSyncSetup, syncFull, syncDisconnect, cleanupUnusedImages, openShareModal, stopSharing, importFiles, importFolder }) {
  commandList = [
    { label: 'New note', icon: 'plus', hint: 'Ctrl+N', action: () => newNote(currentFolderForNew()) },
    { label: 'New shopping/checklist (live-friendly)', icon: 'shopping-cart', action: () => newNote(currentFolderForNew(), 'list') },
    { label: 'New folder', icon: 'folder-plus', action: () => newFolder(null) },
    { label: 'Quick switcher (jump to note)', icon: 'file', hint: 'Ctrl+O', action: () => openPalette('notes') },
    { label: 'Open graph view', icon: 'network', hint: 'Ctrl+G', action: openGraph },
    { label: 'Search notes', icon: 'search', hint: 'Ctrl+K', action: () => $('search').focus() },
    { label: 'Toggle preview/edit/split', icon: 'eye', hint: 'Ctrl+/', action: () => window.dispatchEvent(new CustomEvent('yanta-cycle-view')) },
    { label: 'Insert image', icon: 'image', hint: 'Ctrl+I', action: openImageModal },
    { label: 'Insert wikilink', icon: 'link', action: () => insertAtCursor('[[') },
    { label: 'Toggle pin', icon: 'pin', action: togglePin },
    { label: 'Cycle theme (auto/dark/light)', icon: 'moon', hint: 'T', action: toggleTheme },
    'hr',
    { label: 'Share this note live…', icon: 'share', action: openShareModal },
    { label: 'Stop sharing this note', icon: 'x', action: stopSharing },
    'hr',
    { label: 'Sync: set up folder…', icon: 'refresh', action: openSyncSetup },
    { label: 'Sync: pull + push now', icon: 'refresh', action: () => syncFull(true) },
    { label: 'Sync: disconnect folder', icon: 'x', action: syncDisconnect },
    'hr',
    { label: 'Export as folder ZIP', icon: 'download', action: exportAsZip },
    { label: 'Export current note (.md)', icon: 'download', hint: 'Ctrl+E', action: () => { const n = state.notes.get(state.currentNoteId); if (n) exportNoteAsMd(n); } },
    { label: 'Export full bundle (.json)', icon: 'download', action: exportBundle },
    { label: 'Export every note as .md', icon: 'download', action: exportEveryNoteMd },
    { label: 'Import files (md/json/zip)…', icon: 'upload', action: () => $('importFile').click() },
    { label: 'Import folder…', icon: 'upload', action: () => $('importFolder').click() },
    'hr',
    { label: 'Find unused images…', icon: 'image', action: cleanupUnusedImages },
    { label: 'Delete current note', icon: 'trash', action: deleteCurrentNote },
  ].filter((c) => c !== 'hr' || true);
}

function buildPaletteItems() {
  const q = palette.filter.trim().toLowerCase();
  if (palette.mode === 'commands') {
    palette.items = commandList.filter((c) => c !== 'hr')
      .map((c) => ({ ...c, score: q ? scoreMatch(c.label, q) + (c.label.toLowerCase().startsWith(q) ? 50 : 0) : 1 }))
      .filter((c) => !q || c.score > 0)
      .sort((a, b) => b.score - a.score);
  } else {
    palette.items = [...state.notes.values()]
      .map((n) => ({ id: n.id, label: n.title || 'Untitled', folder: state.folders.get(n.folderId)?.name || '', score: q ? scoreMatch(n.title || '', q) : 1 + (Date.now() - n.updated) * -1 / 1e9 }))
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
    const ico = el('span', { class: 'pi-icon' });
    if (palette.mode === 'commands') {
      ico.innerHTML = lucide(it.icon || 'square', 14);
      row.append(ico);
      row.append(el('span', { class: 'pi-label' }, it.label));
      if (it.hint) row.append(el('span', { class: 'pi-hint' }, it.hint));
    } else {
      ico.innerHTML = lucide('file', 14);
      row.append(ico);
      row.append(el('span', { class: 'pi-label' }, it.label));
      if (it.folder) row.append(el('span', { class: 'pi-meta' }, it.folder));
    }
    list.append(row);
  }
  const a = list.children[palette.active];
  if (a) a.scrollIntoView({ block: 'nearest' });
}
export function paletteMove(delta) {
  if (!palette.items.length) return;
  palette.active = (palette.active + delta + palette.items.length) % palette.items.length;
  renderPaletteList();
}
export function paletteAccept(i) {
  if (i == null) i = palette.active;
  const it = palette.items[i];
  if (!it) return;
  closePalette();
  if (palette.mode === 'commands') it.action?.();
  else openNote(it.id);
}
export function paletteFilter(s) { palette.filter = s; buildPaletteItems(); }

export function scoreMatch(text, query) {
  if (!query) return 1;
  const t = text.toLowerCase();
  let q = 0, score = 0, streak = 0;
  for (let i = 0; i < t.length && q < query.length; i++) {
    if (t[i] === query[q]) { q++; score += 1 + streak; streak += 1; }
    else streak = 0;
  }
  if (q < query.length) return 0;
  return score + 10 / (1 + t.length);
}
