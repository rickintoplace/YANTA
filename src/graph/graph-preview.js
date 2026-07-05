// ============================================================
// YANTA — Graph note preview popover.
//
// Reuses the app's real Markdown renderer instead of a stripped
// re-implementation, so everything a note can contain works here:
// - Drawings render as real static thumbnails (Excalidraw → SVG)
// - Media timestamps (12:34) are clickable and seek the embed
// - Task checkboxes toggle the underlying note
// - Wikilinks navigate inside the graph
//
// graph.js provides navigation handlers; this module owns the DOM.
// ============================================================

import {
  state,
  lucide,
  escapeHtml,
  escapeAttr,
  safeCssColor,
  toast,
} from '../core.js';
import { noteMarkdown } from '../yjs.js';
import { renderPreviewWithContext } from '../markdown.js';
import { bindMediaTimestampClicks } from '../media/media-timestamps.js';
import { toggleTaskLineInNote } from '../notes.js';
import { injectGraphCss } from './graph-css.js';

let popEl = null;
let outsideBound = false;
let currentNoteId = null;
let currentHandlers = {};
let renderToken = 0;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function folderPathLabel(folderId) {
  if (!folderId) return 'No folder';
  const out = [];
  const seen = new Set();
  let f = state.folders.get(folderId);
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    out.unshift(f.name || 'Folder');
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }
  return out.length ? out.join(' / ') : 'No folder';
}

function documentIsDark() {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg')
    .trim();
  const m =
    /^#([0-9a-f]{6})$/i.exec(bg) ||
    /^#([0-9a-f]{3})$/i.exec(bg);
  if (!m) return true;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

function positionFloating(elm, x, y) {
  elm.hidden = false;
  requestAnimationFrame(() => {
    const r = elm.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > window.innerWidth - 10) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - r.height - 10);
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    elm.style.left = left + 'px';
    elm.style.top = top + 'px';
  });
}

function ensurePopover() {
  injectGraphCss();
  if (popEl) return popEl;
  popEl = document.createElement('div');
  popEl.className = 'yanta-graph-note-preview';
  popEl.hidden = true;
  document.body.append(popEl);
  if (!outsideBound) {
    outsideBound = true;
    document.addEventListener('mousedown', (e) => {
      if (!popEl || popEl.hidden) return;
      if (popEl.contains(e.target)) return;
      if (e.target.closest?.('.graph-canvas')) return;
      hideGraphNotePreview();
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popEl && !popEl.hidden) {
        hideGraphNotePreview();
      }
    });
  }
  return popEl;
}

export function isGraphNotePreviewOpen() {
  return !!popEl && !popEl.hidden;
}

export function hideGraphNotePreview() {
  if (popEl) popEl.hidden = true;
  currentNoteId = null;
  renderToken++;
}

// ------------------------------------------------------------
// Drawing thumbnails (real Excalidraw content, static SVG)
// ------------------------------------------------------------
function drawThumbPlaceholderHtml(id, label) {
  return `<div class="yanta-graph-draw-thumb" data-graph-draw-id="${escapeAttr(id)}" title="Open note to edit this drawing">
    <div class="yanta-graph-draw-canvas">
      <span class="yanta-graph-draw-spinner" aria-hidden="true">${lucide('loader-circle', 16)}</span>
    </div>
    <div class="yanta-graph-draw-caption">
      ${lucide('line-squiggle', 12)}
      <span>${escapeHtml(label || 'Drawing')}</span>
    </div>
  </div>`;
}

async function readDrawingData(noteId, drawId) {
  try {
    const yjs = await import('../yjs.js');
    const getter =
      yjs.getDrawing ||
      yjs.getDrawingData ||
      yjs.drawingData ||
      null;
    if (typeof getter === 'function') {
      const data = getter(noteId, drawId);
      if (data?.elements) return data;
    }
    if (typeof yjs.drawingsForNote === 'function') {
      const all = yjs.drawingsForNote(noteId);
      const hit = all?.get?.(drawId) ?? all?.[drawId];
      if (hit?.elements) return hit;
    }
  } catch {}
  return null;
}

async function hydrateDrawingThumbs(bodyEl, noteId, token) {
  const hosts = bodyEl.querySelectorAll('[data-graph-draw-id]');
  if (!hosts.length) return;
  const dark = documentIsDark();
  for (const host of hosts) {
    if (token !== renderToken) return;
    const drawId = host.dataset.graphDrawId;
    const canvas = host.querySelector('.yanta-graph-draw-canvas');
    try {
      const data = await readDrawingData(noteId, drawId);
      if (token !== renderToken) return;
      const elements = (data?.elements || []).filter((el) => !el.isDeleted);
      if (!elements.length) {
        canvas.innerHTML = `<span class="yanta-graph-draw-empty">${lucide('line-squiggle', 14)} Empty drawing</span>`;
        continue;
      }
      const { exportToSvg } = await import('@excalidraw/excalidraw');
      if (token !== renderToken) return;
      const svg = await exportToSvg({
        elements,
        appState: {
          ...(data.appState || {}),
          exportBackground: false,
          exportWithDarkMode: dark,
          viewBackgroundColor: 'transparent',
        },
        files: data.files || {},
      });
      if (token !== renderToken) return;
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = '100%';
      svg.style.height = 'auto';
      svg.style.maxHeight = '300px';
      canvas.replaceChildren(svg);
    } catch (err) {
      console.warn('[YANTA graph] drawing thumbnail failed', err);
      canvas.innerHTML = `<span class="yanta-graph-draw-empty">${lucide('line-squiggle', 14)} Open the note to view this drawing</span>`;
    }
  }
}

// ------------------------------------------------------------
// Body rendering + interactivity
// ------------------------------------------------------------
function renderBody(bodyEl, note) {
  const token = ++renderToken;
  let md = '';
  try {
    md = noteMarkdown(note.id) || '';
  } catch {}
  const html = md.trim()
    ? `<article class="preview">${renderPreviewWithContext(md, {
        // Static thumbnails instead of the interactive editor embed.
        renderDrawEmbedHtml: (id, label) => drawThumbPlaceholderHtml(id, label),
      })}</article>`
    : `<div class="yanta-graph-empty-preview">${lucide('feather', 16)} This note is still empty.</div>`;
  bodyEl.innerHTML = html;

  // Clickable media timestamps (12:34) — same binding as the main preview.
  bindMediaTimestampClicks(bodyEl, {
    onError: (message) => toast(message, 'error'),
  });

  // Real drawing content, hydrated asynchronously.
  hydrateDrawingThumbs(bodyEl, note.id, token);
}

function bindBodyInteractions(bodyEl, note) {
  bodyEl.addEventListener('click', async (e) => {
    // Wikilinks navigate inside the graph (or open missing-note toast).
    const wiki = e.target.closest?.('a.wiki-link');
    if (wiki) {
      e.preventDefault();
      e.stopPropagation();
      const nid = wiki.dataset.noteId;
      if (nid && state.notes.has(nid)) {
        currentHandlers.onNavigate?.(nid);
      } else {
        toast(`"${wiki.dataset.wiki || 'Note'}" not found`, 'error');
      }
      return;
    }
    // Drawing thumbnails open the note.
    const thumb = e.target.closest?.('[data-graph-draw-id]');
    if (thumb) {
      e.preventDefault();
      currentHandlers.onOpen?.(note.id);
      return;
    }
    // Task checkboxes toggle the underlying note line.
    const task = e.target.closest?.('.task[data-line]');
    if (task && !e.target.closest('a, button')) {
      const line = parseInt(task.dataset.line, 10);
      if (Number.isNaN(line)) return;
      const cb = task.querySelector('input[type=checkbox]');
      if (!cb) return;
      const checked = e.target.matches('input[type=checkbox]')
        ? e.target.checked
        : !cb.checked;
      const ok = await toggleTaskLineInNote(note.id, line, checked, {
        source: 'graph-preview',
      });
      if (ok) renderBody(bodyEl, note);
    }
  });
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------
/**
 * Show the note preview popover.
 *
 * handlers:
 *   onOpen(noteId)            open the note in the editor
 *   onNavigate(noteId)        jump to another note inside the graph
 *   onEditAppearance(note)    open the icon & color editor
 */
export function showGraphNotePreview(note, clientX, clientY, handlers = {}) {
  if (!note) return;
  const pop = ensurePopover();
  currentNoteId = note.id;
  currentHandlers = handlers;

  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#6ea8fe';
  const noteColor = safeCssColor(note.color) ||
    (note.type === 'list'
      ? getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || accent
      : accent);
  const iconName = note.icon || (note.type === 'list' ? 'list' : 'file');
  const meta = folderPathLabel(note.folderId);
  const tagCount = (note.tags || []).length;

  pop.innerHTML = `
    <div class="yanta-graph-note-preview-head">
      <span class="yanta-graph-note-preview-icon" role="button" tabindex="0"
            title="Edit icon &amp; color" data-gnp-appearance
            style="--note-icon-color:${escapeAttr(noteColor)}">${lucide(iconName, 18)}</span>
      <div class="yanta-graph-note-preview-headings">
        <div class="yanta-graph-note-preview-title">${escapeHtml(note.title || 'Untitled')}</div>
        <div class="yanta-graph-note-preview-meta">
          <span>${escapeHtml(meta)}</span>
          ${tagCount ? `<span class="gnp-dot">·</span><span>${tagCount} tag${tagCount === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>
      <div class="yanta-graph-note-preview-actions">
        <button class="btn" data-gnp-open>${lucide('file-text', 13)} Open</button>
        <button class="icon-btn" data-gnp-close title="Close">${lucide('x', 14)}</button>
      </div>
    </div>
    <div class="yanta-graph-note-preview-body"></div>
  `;

  const bodyEl = pop.querySelector('.yanta-graph-note-preview-body');
  renderBody(bodyEl, note);
  bindBodyInteractions(bodyEl, note);

  pop.querySelector('[data-gnp-open]')?.addEventListener('click', () => {
    handlers.onOpen?.(note.id);
  });
  pop.querySelector('[data-gnp-close]')?.addEventListener('click', hideGraphNotePreview);

  const iconBtn = pop.querySelector('[data-gnp-appearance]');
  const openEditor = (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideGraphNotePreview();
    handlers.onEditAppearance?.(note);
  };
  iconBtn?.addEventListener('click', openEditor);
  iconBtn?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') openEditor(e);
  });

  positionFloating(pop, clientX, clientY);
}

/** Re-render the body if the popover currently shows this note. */
export function refreshGraphNotePreview(noteId) {
  if (!isGraphNotePreviewOpen() || currentNoteId !== noteId) return;
  const note = state.notes.get(noteId);
  const bodyEl = popEl?.querySelector('.yanta-graph-note-preview-body');
  if (note && bodyEl) renderBody(bodyEl, note);
}