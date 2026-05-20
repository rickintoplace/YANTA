// ============================================================
// YANTA — Native inline Excalidraw integration.
// Editor surface: editable.
// Preview surface: read-only view mode with pan/zoom, no write UI.
// Supports:
// - persisted resize via explicit resize handle
// - note wikilinks inside drawings
// - drag/drop notes from tree into drawing
// - yanta-note:// links on Excalidraw elements
// - note preview popover from drawing elements
// - drawing thumbnails for Image/Drawings library
// ============================================================

import {
  uid,
  state,
  toast,
  escapeHtml,
  escapeAttr,
  downloadBlob,
  safeFilename,
  store,
  lucide,
  debounce,
} from './core.js';

import { insertAtCursor } from './editor.js';
import { openNote } from './notes.js';
import { renderPreview } from './markdown.js';
import { inlineTextEdit, inlineConfirm } from './inline-ui.js';

import {
  getNoteDoc,
  getDrawing,
  findDrawing,
  setDrawing,
  updateDrawingMeta,
  deleteDrawing,
  listDrawingsForNote,
  listAllDrawings,
  normalizeDrawingScene,
  noteMarkdown,
} from './yjs.js';

let modal = null;
let host = null;
let titleEl = null;
let reactRoot = null;

let active = {
  noteId: null,
  drawingId: null,
  api: null,
  unobserve: null,
};

let excalidrawLibPromise = null;
let reactLibPromise = null;
let injectedCss = false;
let activeEmbedCloseBound = false;

const inlineRoots = new WeakMap();
const inlineApis = new WeakMap();
const thumbnailCache = new Map();

const DRAW_LIBRARY_SETTINGS_KEY = 'drawLibraryItems.v1';

let drawLibraryItems = [];
let drawLibraryLoaded = false;

const saveDrawLibraryItemsDebounced = debounce(async () => {
  try {
    await store.settings.set(DRAW_LIBRARY_SETTINGS_KEY, drawLibraryItems);
  } catch {}
}, 250);

function normalizeDrawLibraryItem(item, index = 0) {
  if (!item || typeof item !== 'object') return null;

  const elements = Array.isArray(item.elements)
    ? item.elements
    : Array.isArray(item.libraryItems)
      ? item.libraryItems
      : [];

  if (!elements.length) return null;

  const id = String(item.id || item.name || `lib-${index}-${uid()}`);

  const firstText = elements.find((el) =>
    typeof el?.text === 'string' && el.text.trim()
  )?.text?.trim();

  return {
    ...structuredCloneSafe(item),
    id,
    status: item.status || 'published',
    created: item.created || Date.now(),
    name: item.name || firstText || `Library item ${index + 1}`,
    elements: structuredCloneSafe(elements),
    files: structuredCloneSafe(item.files || {}),
  };
}

function normalizeDrawLibraryItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, i) => normalizeDrawLibraryItem(item, i))
    .filter(Boolean);
}

function libraryItemsFromChangePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.libraryItems)) return payload.libraryItems;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function loadDrawLibraryItemsFromSettings() {
  if (drawLibraryLoaded) return drawLibraryItems;

  drawLibraryLoaded = true;

  try {
    drawLibraryItems = normalizeDrawLibraryItems(
      await store.settings.get(DRAW_LIBRARY_SETTINGS_KEY, [])
    );
  } catch {
    drawLibraryItems = [];
  }

  window.dispatchEvent(new CustomEvent('yanta-draw-library-updated'));

  return drawLibraryItems;
}

function persistDrawLibraryItems(payload) {
  const items = normalizeDrawLibraryItems(libraryItemsFromChangePayload(payload));

  drawLibraryItems = items;
  saveDrawLibraryItemsDebounced();

  window.dispatchEvent(new CustomEvent('yanta-draw-library-updated', {
    detail: { items: listDrawLibraryItems() },
  }));
}

function excalidrawLibraryInitialData(extra = {}) {
  return {
    ...extra,
    libraryItems: drawLibraryItems,
  };
}

export function listDrawLibraryItems() {
  return normalizeDrawLibraryItems(drawLibraryItems).map(structuredCloneSafe);
}

export async function insertDrawLibraryItemIntoCurrent(itemId) {
  if (!state.currentNoteId) {
    toast('Open a note first', 'error');
    return;
  }

  await loadDrawLibraryItemsFromSettings();

  const item = drawLibraryItems.find((x) => String(x.id) === String(itemId));

  if (!item) {
    toast('Library item not found', 'error');
    return;
  }

  const drawingId = uid();
  const theme = currentExcalidrawTheme();

  const elements = structuredCloneSafe(item.elements || []).map((el, i) => ({
    ...el,
    id: uid(),
    x: Number(el.x || 0) + 40,
    y: Number(el.y || 0) + 40,
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now() + i,
    isDeleted: false,
    selected: false,
  }));

  setDrawing(state.currentNoteId, drawingId, {
    id: drawingId,
    title: item.name || 'Library drawing',
    canvas: { width: 760, height: 420 },
    elements,
    appState: {
      theme,
      viewBackgroundColor: theme === 'dark' ? '#121212' : '#ffffff',
    },
    files: structuredCloneSafe(item.files || {}),
  }, 'draw-library-insert');

  insertAtCursor(`\n\ndraw://${drawingId}\n\n`);

  toast('Library item inserted as drawing', 'success');

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: { noteId: state.currentNoteId, drawingId },
  }));
}

export async function drawLibraryItemThumbnailUrl(itemId) {
  await loadDrawLibraryItemsFromSettings();

  const key = `lib:${itemId}`;
  const cached = thumbnailCache.get(key);
  if (cached) return cached;

  const item = drawLibraryItems.find((x) => String(x.id) === String(itemId));
  if (!item) return '';

  try {
    const { exportToSvg } = await loadExcalidraw();

    const svg = await exportToSvg({
      elements: item.elements || [],
      appState: {
        exportBackground: true,
        viewBackgroundColor:
          currentExcalidrawTheme() === 'dark' ? '#121212' : '#ffffff',
      },
      files: item.files || {},
    });

    svg.setAttribute('width', '360');
    svg.setAttribute('height', '220');

    const data = new XMLSerializer().serializeToString(svg);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;

    thumbnailCache.set(key, url);
    return url;
  } catch {
    return '';
  }
}

function unmountInlineHost(inlineHost) {
  if (!inlineHost) return;

  const existing = inlineRoots.get(inlineHost);

  if (existing) {
    try {
      existing.unmount();
    } catch {}
    inlineRoots.delete(inlineHost);
  }
}

function unmountDrawEmbeds(root = document) {
  for (const inlineHost of root.querySelectorAll?.('.yanta-draw-inline-host') || []) {
    unmountInlineHost(inlineHost);
  }
}

function injectDrawCss() {
  if (injectedCss) return;
  injectedCss = true;

  const style = document.createElement('style');
  style.id = 'yanta-draw-runtime-css';
  style.textContent = `
.yanta-draw-modal {
  position: fixed;
  inset: 0;
  z-index: 220;
  background: rgba(0,0,0,0.62);
  display: flex;
  flex-direction: column;
  animation: fade-in 0.12s ease;
}

.yanta-draw-modal[hidden] {
  display: none !important;
}

.yanta-draw-head {
  height: 48px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.yanta-draw-title {
  font-weight: 700;
  font-size: 14px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-draw-body {
  flex: 1 1 auto;
  min-height: 0;
  height: calc(100vh - 48px);
  background: var(--bg);
  position: relative;
  display: flex;
}

.yanta-draw-fullscreen-host {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  position: relative;
}

.yanta-draw-fullscreen-host .excalidraw {
  width: 100%;
  height: 100%;
}

.yanta-draw-body .excalidraw,
.yanta-draw-inline-host .excalidraw {
  --color-primary: var(--accent);
  --color-primary-darker: var(--accent);
  --color-primary-darkest: var(--accent);
  width: 100%;
  height: 100%;
}

.yanta-draw-embed {
  margin: 10px 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-elev);
  box-shadow: 0 1px 0 rgba(255,255,255,0.02) inset;
  display: flex;
  flex-direction: column;
  max-width: 100%;
}

.yanta-draw-embed.missing {
  border-style: dashed;
}

.yanta-draw-embed-head {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-draw-embed-icon {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  background: rgba(110,168,254,0.10);
  flex: 0 0 auto;
}

.yanta-draw-embed-title {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: text;
}

.yanta-draw-embed-meta {
  font-size: 11px;
  color: var(--text-faint);
  margin-left: 6px;
  white-space: nowrap;
}

.yanta-draw-embed-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  opacity: 1;
  transition: opacity 0.12s ease;
}

.yanta-draw-embed-actions .icon-btn {
  width: 26px;
  height: 26px;
}

.yanta-draw-inline-host {
  width: 100%;
  height: 420px;
  min-height: 180px;
  max-height: 5000px;
  background: var(--bg);
  overflow: hidden;
  position: relative;
}

/* Preview: keine Excalidraw-Write-UI, aber Canvas bleibt pointerfähig für Pan/Zoom. */
.yanta-draw-embed.preview-surface .excalidraw .App-toolbar,
.yanta-draw-embed.preview-surface .excalidraw .FixedSideContainer,
.yanta-draw-embed.preview-surface .excalidraw .HintViewer,
.yanta-draw-embed.preview-surface .excalidraw .help-icon,
.yanta-draw-embed.preview-surface .excalidraw .layer-ui__wrapper__top-right,
.yanta-draw-embed.preview-surface .excalidraw .layer-ui__wrapper__footer-right,
.yanta-draw-embed.preview-surface .excalidraw .layer-ui__wrapper__footer-left,
.yanta-draw-embed.preview-surface .excalidraw .Island,
.yanta-draw-embed.preview-surface .excalidraw .App-menu,
.yanta-draw-embed.preview-surface .excalidraw .Stack_vertical {
  display: none !important;
  pointer-events: none !important;
}

/* Preview: YANTA-Actions dezent, aber keine Schreib-UI */
.yanta-draw-embed.preview-surface:not(:hover):not(:focus-within):not(.is-active) .yanta-draw-embed-actions {
  opacity: 0;
  pointer-events: none;
}

.yanta-draw-embed.preview-surface [data-draw-action="link-note"],
.yanta-draw-embed.preview-surface [data-draw-action="rename"],
.yanta-draw-embed.preview-surface [data-draw-action="delete"] {
  display: none !important;
}

/* Editor-only explicit resize handle */
.yanta-draw-resize-handle {
  height: 12px;
  flex: 0 0 auto;
  border-top: 1px solid var(--border);
  background:
    linear-gradient(90deg, transparent, var(--border), transparent) center/60px 1px no-repeat,
    var(--bg-elev-2);
  cursor: ns-resize;
}

.yanta-draw-embed.preview-surface .yanta-draw-resize-handle {
  display: none;
}

.yanta-draw-resize-handle:hover {
  background:
    linear-gradient(90deg, transparent, var(--accent), transparent) center/70px 2px no-repeat,
    rgba(110,168,254,0.08);
}

.yanta-draw-missing-body {
  padding: 18px;
  color: var(--text-faint);
  text-align: center;
  font-style: italic;
  background: var(--bg);
}

.yanta-draw-links {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 7px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
  min-height: 34px;
}

.yanta-draw-links:empty {
  display: none;
}

.yanta-draw-link-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elev-2);
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  max-width: 240px;
}

.yanta-draw-link-pill:hover {
  border-color: var(--accent);
  background: rgba(110,168,254,0.10);
}

.yanta-draw-link-pill.missing {
  color: var(--text-faint);
  border-style: dashed;
}

.yanta-draw-link-pill span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-draw-editor-embed {
  display: block;
  max-width: none;
  margin: 8px auto;
}

/* Note picker */
.yanta-draw-note-picker {
  position: fixed;
  z-index: 260;
  inset: 0;
  background: rgba(0,0,0,0.42);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}

.yanta-draw-note-picker-card {
  width: min(520px, calc(100vw - 24px));
  max-height: 70vh;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.yanta-draw-note-picker-head {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
}

.yanta-draw-note-picker-head strong {
  flex: 1;
}

.yanta-draw-note-picker-search {
  margin: 10px 12px 8px;
}

.yanta-draw-note-picker-list {
  overflow: auto;
  padding: 4px 8px 10px;
}

.yanta-draw-note-picker-item {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}

.yanta-draw-note-picker-item:hover,
.yanta-draw-note-picker-item.active {
  background: var(--bg-elev-2);
  color: var(--accent);
}

.yanta-draw-note-picker-meta {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 11px;
}

/* Native Excalidraw context menu extension */
.yanta-excalidraw-context-separator {
  height: 1px;
  margin: 5px 6px;
  background: var(--border);
  opacity: 0.8;
}

.yanta-excalidraw-context-item {
  width: 100%;
  min-width: 180px;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  font-family: var(--font);
}

.yanta-excalidraw-context-item:hover {
  background: var(--bg-elev-2);
}

.yanta-excalidraw-context-item.danger {
  color: var(--red);
}

/* [[...]] autocomplete while editing Excalidraw text */
.yanta-draw-autocomplete {
  position: fixed;
  z-index: 320;
  min-width: 240px;
  max-width: min(420px, calc(100vw - 20px));
  max-height: 280px;
  overflow: auto;
  padding: 4px;
  background: var(--bg-elev-3);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  animation: fade-in 0.08s ease;
}

.yanta-draw-autocomplete[hidden] {
  display: none !important;
}

.yanta-draw-autocomplete-item {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.yanta-draw-autocomplete-item:hover,
.yanta-draw-autocomplete-item.active {
  background: var(--bg-elev-2);
  color: var(--accent);
}

.yanta-draw-autocomplete-item .meta {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 11px;
}

/* Drawing note preview popover */
.yanta-draw-note-preview {
  position: fixed;
  z-index: 270;
  width: min(620px, calc(100vw - 24px));
  max-height: min(72vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,0.42);
  animation: fade-in 0.12s ease;
}

.yanta-draw-note-preview[hidden] {
  display: none !important;
}

.yanta-draw-note-preview-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-draw-note-preview-title {
  min-width: 0;
  flex: 1;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-draw-note-preview-body {
  padding: 18px 20px 26px;
  overflow: auto;
  background: var(--bg);
}

.yanta-draw-note-preview-body .preview {
  max-width: none;
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
}

.yanta-draw-note-preview-body .backlinks,
.yanta-draw-note-preview-body .pv-outline {
  display: none !important;
}
  `;

  document.head.append(style);
}

async function loadReact() {
  if (!reactLibPromise) {
    reactLibPromise = Promise.all([
      import('react'),
      import('react-dom/client'),
    ]).then(([React, ReactDOM]) => ({ React, ReactDOM }));
  }

  return reactLibPromise;
}

async function loadExcalidraw() {
  if (!excalidrawLibPromise) {
    excalidrawLibPromise = Promise.all([
      import('@excalidraw/excalidraw'),
      import('@excalidraw/excalidraw/index.css'),
    ]).then(([mod]) => mod);
  }

  return excalidrawLibPromise;
}

function cleanAppState(appState = {}) {
  const {
    collaborators,
    selectedElementIds,
    selectedGroupIds,
    editingElement,
    resizingElement,
    draggingElement,
    suggestedBindings,
    startBoundElement,
    cursorButton,
    name,
    offsetTop,
    offsetLeft,
    width,
    height,
    theme,
    openMenu,
    openPopup,
    contextMenu,
    activeTool,
    pendingImageElementId,
    frameToHighlight,
    editingLinearElement,
    multiElement,
    resizingLinearElement,
    selectionElement,
    isBindingEnabled,
    errorMessage,
    ...rest
  } = appState || {};

  const cleaned = { ...rest };

  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === undefined) delete cleaned[key];
  }

  return cleaned;
}

function sceneSignature(elements, appState, files) {
  try {
    return JSON.stringify({
      elements: elements || [],
      appState: cleanAppState(appState || {}),
      files: files || {},
    });
  } catch {
    return String(Date.now());
  }
}

function drawingSignature(drawing) {
  return sceneSignature(
    drawing?.elements || [],
    drawing?.appState || {},
    drawing?.files || {}
  );
}

function cssColorToRgb(color) {
  const s = String(color || '').trim();

  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const hex = m[1].split('').map((x) => x + x).join('');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const hex = m[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s);
  if (m) {
    return {
      r: Math.max(0, Math.min(255, parseInt(m[1], 10))),
      g: Math.max(0, Math.min(255, parseInt(m[2], 10))),
      b: Math.max(0, Math.min(255, parseInt(m[3], 10))),
    };
  }

  return null;
}

function relativeLuminance(r, g, b) {
  const toLinear = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * toLinear(r) +
    0.7152 * toLinear(g) +
    0.0722 * toLinear(b)
  );
}

function currentExcalidrawTheme() {
  if (state.theme === 'dark') return 'dark';
  if (state.theme === 'light') return 'light';

  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const rgb = cssColorToRgb(bg);
    if (rgb) return relativeLuminance(rgb.r, rgb.g, rgb.b) < 0.5 ? 'dark' : 'light';
  } catch {}

  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
      ? 'dark'
      : 'light';
  } catch {
    return 'dark';
  }
}

function canvasSizeOf(drawing) {
  const w = parseInt(drawing?.canvas?.width ?? 760, 10);
  const h = parseInt(drawing?.canvas?.height ?? 420, 10);

  return {
    width: Math.max(240, Math.min(5000, Number.isFinite(w) ? w : 760)),
    height: Math.max(180, Math.min(5000, Number.isFinite(h) ? h : 420)),
  };
}

function initialDataForDrawing(drawing, extra = {}) {
  const appState = cleanAppState(drawing?.appState || {});
  const theme = currentExcalidrawTheme();

  return {
    elements: drawing?.elements || [],
    appState: {
      ...appState,
      theme,
      viewBackgroundColor:
        appState.viewBackgroundColor ||
        (theme === 'dark' ? '#121212' : '#ffffff'),
    },
    files: drawing?.files || {},
    ...extra,
  };
}

function noteLink(noteId) {
  return `yanta-note://${noteId}`;
}

function noteIdFromLink(link = '') {
  const s = String(link || '').trim();

  if (s.startsWith('yanta-note://')) return s.slice('yanta-note://'.length);
  if (s.startsWith('#note=')) return decodeURIComponent(s.slice('#note='.length));

  return null;
}

function noteByWikiTarget(target) {
  const key = String(target || '').trim().toLowerCase();
  if (!key) return null;

  return [...state.notes.values()].find((n) =>
    (n.title || '').trim().toLowerCase() === key
  ) || null;
}

function wikiDataForNote(note, alias = null) {
  if (!note) return null;

  return {
    noteId: note.id,
    target: note.title || 'Untitled',
    alias: alias || null,
    href: noteLink(note.id),
    updated: Date.now(),
  };
}

function noteIdFromElement(el) {
  const linkId = noteIdFromLink(el?.link);
  if (linkId && state.notes.has(linkId)) return linkId;

  return null;
}

function wikiTargetFromElement(el) {
  const linkId = noteIdFromLink(el?.link);

  if (linkId && state.notes.has(linkId)) {
    return state.notes.get(linkId)?.title || null;
  }

  // customData nur noch als aktiv behandeln, wenn der Excalidraw-Link
  // selbst noch existiert. Wenn der User den Link löscht, ist customData stale.
  const custom = el?.customData?.yanta?.wikilink;

  if (linkId && custom?.target) {
    return custom.target;
  }

  return null;
}

function extractWikiTargetsFromScene(scene = {}) {
  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  const found = new Map();

  for (const el of elements) {
    if (!el || typeof el !== 'object' || el.isDeleted) continue;

    const customTarget = wikiTargetFromElement(el);
    if (customTarget) {
      found.set(customTarget.trim().toLowerCase(), customTarget.trim());
    }

    const linkNoteId = noteIdFromLink(el.link);
    if (linkNoteId && state.notes.has(linkNoteId)) {
      const n = state.notes.get(linkNoteId);
      const title = n.title || 'Untitled';
      found.set(title.toLowerCase(), title);
    }

    for (const target of wikiMarkupTargetsFromElement(el)) {
      found.set(target.toLowerCase(), target);
    }
  }

  return [...found.values()];
}

function wikiMarkupTargetsFromElement(el) {
  if (!el || typeof el !== 'object') return [];

  // Wichtig: current text/rawText bevorzugen. originalText nur als Fallback,
  // sonst bleiben alte Referenzen hängen.
  const sources = [];

  if (typeof el.text === 'string') sources.push(el.text);
  if (typeof el.rawText === 'string' && el.rawText !== el.text) sources.push(el.rawText);

  if (!sources.length && typeof el.originalText === 'string') {
    sources.push(el.originalText);
  }

  const out = [];
  const seen = new Set();

  for (const text of sources) {
    const re = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;
    let m;

    while ((m = re.exec(text)) !== null) {
      const target = m[1].trim();
      const key = target.toLowerCase();

      if (target && !seen.has(key)) {
        seen.add(key);
        out.push(target);
      }
    }
  }

  return out;
}

function elementHasWikiMarkup(el) {
  return wikiMarkupTargetsFromElement(el).length > 0;
}

function cleanStaleElementWikiData(el) {
  if (!el?.customData?.yanta?.wikilink) return el;

  // Wikilink ist nur aktiv, wenn entweder:
  // - der Excalidraw-Link noch ein yanta-note:// ist
  // - oder sichtbarer/aktueller Text noch [[...]] enthält.
  const hasActiveYantaLink = !!noteIdFromLink(el.link);
  const hasActiveWikiText = elementHasWikiMarkup(el);

  if (hasActiveYantaLink || hasActiveWikiText) return el;

  const customData = structuredCloneSafe(el.customData || {});

  delete customData.yanta.wikilink;

  if (customData.yanta && Object.keys(customData.yanta).length === 0) {
    delete customData.yanta;
  }

  return {
    ...el,
    customData,
  };
}

function cleanStaleSceneWikiData(elements = []) {
  return (Array.isArray(elements) ? elements : []).map(cleanStaleElementWikiData);
}

function updateEmbedHeader(embed, drawing) {
  const title = embed.querySelector('[data-draw-title]');
  const info = embed.querySelector('[data-draw-info]');

  if (title) title.textContent = drawing?.title || 'Drawing';

  if (info) {
    if (!drawing) {
      info.textContent = 'missing';
    } else {
      const count = (drawing.elements || []).filter((x) => !x?.isDeleted).length;
      const links = extractWikiTargetsFromScene(drawing).length;
      const { width, height } = canvasSizeOf(drawing);
      info.textContent = `${width}×${height} · ${count} element${count === 1 ? '' : 's'}${links ? ` · ${links} wiki link${links === 1 ? '' : 's'}` : ''}`;
    }
  }
}

function applyCanvasSize(embed, drawing) {
  const inlineHost = embed.querySelector('.yanta-draw-inline-host');
  if (!inlineHost || !drawing) return;

  const { width, height } = canvasSizeOf(drawing);

  embed.style.width = width + 'px';
  embed.style.maxWidth = '100%';
  inlineHost.style.height = height + 'px';
}

function renderLinkPills(host, targets) {
  host.replaceChildren();

  for (const target of targets) {
    const note = noteByWikiTarget(target);

    const btn = document.createElement('button');
    btn.className = 'yanta-draw-link-pill' + (note ? '' : ' missing');
    btn.type = 'button';
    btn.title = note ? `Preview ${target}` : `Create ${target}`;
    btn.innerHTML = `${lucide(note ? 'link' : 'file-plus', 12)} <span>${escapeHtml(target)}</span>`;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (note) showNotePreview(note.id, e.clientX, e.clientY);
      else {
        window.dispatchEvent(new CustomEvent('yanta-follow-wiki', {
          detail: { target },
        }));
      }
    });

    host.append(btn);
  }
}

async function resolveDrawingRefAsync(drawingId, preferredNoteId = state.currentNoteId) {
  let hit = findDrawing(drawingId, preferredNoteId);
  if (hit) return hit;

  for (const noteId of state.notes.keys()) {
    try {
      const entry = getNoteDoc(noteId);
      await entry.ready;
    } catch {}
  }

  return findDrawing(drawingId, preferredNoteId);
}

function sceneCoordsForClient(api, container, clientX, clientY) {
  try {
    if (api?.screenToSceneCoords) {
      return api.screenToSceneCoords({ clientX, clientY });
    }
  } catch {}

  const rect = container.getBoundingClientRect();
  const appState = api?.getAppState?.() || {};
  const zoom = appState.zoom?.value || appState.zoom || 1;

  return {
    x: (clientX - rect.left - (appState.offsetLeft || 0)) / zoom - (appState.scrollX || 0),
    y: (clientY - rect.top - (appState.offsetTop || 0)) / zoom - (appState.scrollY || 0),
  };
}

function elementBounds(el) {
  const x = Number(el?.x || 0);
  const y = Number(el?.y || 0);
  const w = Number(el?.width || 0);
  const h = Number(el?.height || 0);

  return {
    x1: Math.min(x, x + w),
    y1: Math.min(y, y + h),
    x2: Math.max(x, x + w),
    y2: Math.max(y, y + h),
  };
}

function pointInElementApprox(el, x, y, pad = 8) {
  if (!el || el.isDeleted) return false;

  const ex = Number(el.x || 0);
  const ey = Number(el.y || 0);
  const w = Math.max(1, Math.abs(Number(el.width || 0)));
  const h = Math.max(1, Math.abs(Number(el.height || 0)));
  const angle = Number(el.angle || 0);

  // Unrotated fallback / quick path.
  if (!angle) {
    const b = elementBounds(el);

    return (
      x >= b.x1 - pad &&
      x <= b.x2 + pad &&
      y >= b.y1 - pad &&
      y <= b.y2 + pad
    );
  }

  // Rotate point back into element-local coordinates around center.
  const cx = ex + w / 2;
  const cy = ey + h / 2;

  const dx = x - cx;
  const dy = y - cy;

  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);

  const localX = dx * cos - dy * sin + w / 2;
  const localY = dx * sin + dy * cos + h / 2;

  return (
    localX >= -pad &&
    localX <= w + pad &&
    localY >= -pad &&
    localY <= h + pad
  );
}

function elementAt(api, x, y) {
  const elements =
    api?.getSceneElementsIncludingDeleted?.() ||
    api?.getSceneElements?.() ||
    [];

  // Topmost first.
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];

    if (!el || el.isDeleted) continue;
    if (el.locked) continue;

    if (pointInElementApprox(el, x, y, 8)) {
      return el;
    }
  }

  return null;
}

function makeFallbackTextElement(text, x, y, linkedNoteId = null) {
  const id = uid();
  const seed = Math.floor(Math.random() * 2 ** 31);
  const versionNonce = Math.floor(Math.random() * 2 ** 31);
  const theme = currentExcalidrawTheme();

  const fontSize = 22;
  const width = Math.max(120, Math.min(560, text.length * 11));
  const height = 34;

  return {
    id,
    type: 'text',
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: theme === 'dark' ? '#f8f9fa' : '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed,
    version: 1,
    versionNonce,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: linkedNoteId ? noteLink(linkedNoteId) : null,
    locked: false,

    text,
    rawText: text,
    originalText: text,
    fontSize,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    baseline: 24,
    containerId: null,
    lineHeight: 1.25,
    customData: {},
  };
}

function patchElementWithWikiLink(el, note, {
  forceText = false,
  preserveText = false,
} = {}) {
  if (!el || !note) return el;

  const title = note.title || 'Untitled';
  const wikiText = `[[${title}]]`;

  const next = {
    ...el,
    link: noteLink(note.id),
    customData: {
      ...(el.customData || {}),
      yanta: {
        ...(el.customData?.yanta || {}),
        wikilink: wikiDataForNote(note),
      },
    },
    version: (el.version || 1) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };

  if ((forceText || el.type === 'text') && !preserveText) {
    next.text = wikiText;
    next.rawText = wikiText;
    next.originalText = wikiText;
    next.width = Math.max(el.width || 120, Math.min(560, wikiText.length * 11));
    next.height = Math.max(el.height || 34, 34);
  }

  return next;
}

function stripWikiMarkupFromText(text) {
  return String(text || '').replace(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
    (_full, target, alias) => (alias || target || '').trim()
  );
}

function unlinkElementFromWiki(el) {
  if (!el) return el;

  const customData = structuredCloneSafe(el.customData || {});

  if (customData.yanta?.wikilink) {
    delete customData.yanta.wikilink;
  }

  if (customData.yanta && Object.keys(customData.yanta).length === 0) {
    delete customData.yanta;
  }

  const next = {
    ...el,
    link: noteIdFromLink(el.link) ? null : el.link,
    customData,
    version: (el.version || 1) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };

  // Wenn der Wikilink als Text eingefügt wurde, auch die sichtbare
  // Markdown-Syntax entfernen: [[Note]] -> Note, [[Note|Alias]] -> Alias.
  if (el.type === 'text') {
    const source =
      typeof el.text === 'string'
        ? el.text
        : typeof el.rawText === 'string'
          ? el.rawText
          : typeof el.originalText === 'string'
            ? el.originalText
            : '';

    const plain = stripWikiMarkupFromText(source);

    next.text = plain;
    next.rawText = plain;
    next.originalText = plain;
    next.width = Math.max(80, Math.min(900, plain.length * 11 || 120));
    next.height = Math.max(el.height || 34, 34);
  }

  return next;
}

function structuredCloneSafe(v) {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v ?? null));
  }
}

async function makeWikiTextElement(note, x, y) {
  const title = note.title || 'Untitled';
  const text = `[[${title}]]`;

  try {
    const mod = await loadExcalidraw();
    const convert = mod.convertToExcalidrawElements;

    if (typeof convert === 'function') {
      const [el] = convert([
        {
          type: 'text',
          x,
          y,
          text,
          fontSize: 22,
        },
      ]);

      return patchElementWithWikiLink(el, note, {
        forceText: true,
      });
    }
  } catch {}

  return patchElementWithWikiLink(
    makeFallbackTextElement(text, x, y, note.id),
    note,
    { forceText: true }
  );
}

function firstWikiTargetInElement(el) {
  if (!el) return null;

  const directTarget = wikiTargetFromElement(el);
  if (directTarget) return directTarget;

  const texts = [
    el.text,
    el.rawText,
    el.originalText,
  ].filter((x) => typeof x === 'string');

  for (const text of texts) {
    const m = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/.exec(text);
    if (m?.[1]) return m[1].trim();
  }

  return null;
}

function patchTextElementWithWiki(el, title, noteId) {
  const text = `[[${title}]]`;

  return {
    ...el,
    text,
    rawText: text,
    originalText: text,
    link: noteLink(noteId),
    width: Math.max(el.width || 120, Math.min(560, text.length * 11)),
    height: Math.max(el.height || 34, 34),
    version: (el.version || 1) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
}

function patchElementLink(el, title, noteId) {
  if (el.type === 'text') return patchTextElementWithWiki(el, title, noteId);

  return {
    ...el,
    link: noteLink(noteId),
    version: (el.version || 1) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
}

function normalizeSelectedIds(value) {
  if (!value) return new Set();

  if (Array.isArray(value)) {
    return new Set(value.filter(Boolean));
  }

  if (value instanceof Set) {
    return new Set([...value].filter(Boolean));
  }

  if (typeof value === 'object') {
    return new Set(Object.keys(value).filter((id) => value[id]));
  }

  return new Set();
}

function selectedElementAndGroupIds(api) {
  const appState = api?.getAppState?.() || {};

  return {
    elementIds: normalizeSelectedIds(appState.selectedElementIds),
    groupIds: normalizeSelectedIds(appState.selectedGroupIds),
  };
}

function selectionTargetElements(api, hitEl = null) {
  const elements =
    api?.getSceneElementsIncludingDeleted?.() ||
    api?.getSceneElements?.() ||
    [];

  const { elementIds, groupIds } = selectedElementAndGroupIds(api);

  if (!elementIds.size && !groupIds.size && hitEl) {
    elementIds.add(hitEl.id);
  }

  return elements.filter((el) => {
    if (!el || el.isDeleted) return false;
    if (elementIds.has(el.id)) return true;
    if ((el.groupIds || []).some((gid) => groupIds.has(gid))) return true;
    return false;
  });
}

function selectedElementIds(api) {
  return [...selectedElementAndGroupIds(api).elementIds];
}

async function addOrLinkNoteAt(api, container, note, clientX, clientY) {
  if (!api || !container || !note) return false;

  const p = sceneCoordsForClient(api, container, clientX, clientY);

  const elements =
    api.getSceneElementsIncludingDeleted?.() ||
    api.getSceneElements?.() ||
    [];

  const hit = elementAt(api, p.x, p.y);
  const targets = selectionTargetElements(api, hit);

  let nextElements;
  let selectedId = null;

  if (targets.length) {
    const targetIds = new Set(targets.map((el) => el.id));
    selectedId = targets[0].id;

    nextElements = elements.map((el) =>
      targetIds.has(el.id)
        ? patchElementWithWikiLink(el, note)
        : el
    );
  } else {
    const el = await makeWikiTextElement(note, p.x, p.y);
    selectedId = el.id;
    nextElements = [...elements, el];
  }

  api.updateScene({
    elements: nextElements,
    appState: selectedId
      ? {
          selectedElementIds: { [selectedId]: true },
        }
      : undefined,
  });

  api.refresh?.();
  return true;
}

async function linkSelectedElementsToNote(api, note) {
  if (!api || !note) return false;

  const elements =
    api.getSceneElementsIncludingDeleted?.() ||
    api.getSceneElements?.() ||
    [];

  const targets = selectionTargetElements(api, null);

  if (!targets.length) {
    const appState = api.getAppState?.() || {};
    const x = -(appState.scrollX || 0) + 40;
    const y = -(appState.scrollY || 0) + 40;

    const el = await makeWikiTextElement(note, x, y);

    api.updateScene({
      elements: [...elements, el],
      appState: {
        selectedElementIds: { [el.id]: true },
      },
    });

    api.refresh?.();
    return true;
  }

  const targetIds = new Set(targets.map((el) => el.id));

  api.updateScene({
    elements: elements.map((el) =>
      targetIds.has(el.id)
        ? patchElementWithWikiLink(el, note)
        : el
    ),
  });

  api.refresh?.();
  return true;
}

function linkSpecificElementsToNote(api, targets, note) {
  if (!api || !targets?.length || !note) return false;

  const elements =
    api.getSceneElementsIncludingDeleted?.() ||
    api.getSceneElements?.() ||
    [];

  const targetIds = new Set(targets.map((el) => el.id));

  api.updateScene({
    elements: elements.map((el) =>
      targetIds.has(el.id)
        ? patchElementWithWikiLink(el, note)
        : el
    ),
  });

  api.refresh?.();
  return true;
}

function unlinkSpecificElements(api, targets) {
  if (!api || !targets?.length) return false;

  const elements =
    api.getSceneElementsIncludingDeleted?.() ||
    api.getSceneElements?.() ||
    [];

  const targetIds = new Set(targets.map((el) => el.id));

  api.updateScene({
    elements: elements.map((el) =>
      targetIds.has(el.id)
        ? unlinkElementFromWiki(el)
        : el
    ),
  });

  api.refresh?.();
  return true;
}

function bindNoteDropToDrawing(container, apiRef, enabled = true) {
  if (!container || container.dataset.drawDropBound === '1') return;
  container.dataset.drawDropBound = '1';

  container.addEventListener('dragover', (e) => {
    if (!enabled) return;

    const types = [...(e.dataTransfer?.types || [])];
    if (!types.includes('text/yanta-note')) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });

  container.addEventListener('drop', async (e) => {
    if (!enabled) return;

    const noteId = e.dataTransfer?.getData('text/yanta-note');
    if (!noteId) return;

    const note = state.notes.get(noteId);
    if (!note) return;

    e.preventDefault();
    e.stopPropagation();

    const api = apiRef?.current || apiRef;
    const ok = await addOrLinkNoteAt(api, container, note, e.clientX, e.clientY);

    if (ok) toast(`Linked [[${note.title || 'Untitled'}]]`, 'success');
  }, true);
}

const drawNativeContextState = new WeakMap();

function firstLinkedNoteId(targets = []) {
  for (const el of targets) {
    const id = noteIdFromElement(el);
    if (id && state.notes.has(id)) return id;
  }

  return null;
}

function elementHasWikiLink(el) {
  return !!noteIdFromElement(el) || elementHasWikiMarkup(el);
}

function isElementVisible(el) {
  if (!el || !(el instanceof Element)) return false;

  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function distanceToPoint(rect, x, y) {
  const cx = Math.max(rect.left, Math.min(x, rect.right));
  const cy = Math.max(rect.top, Math.min(y, rect.bottom));
  return Math.hypot(cx - x, cy - y);
}

function findOpenExcalidrawContextMenu(ctx) {
  const candidates = [
    ...document.querySelectorAll(
      [
        '.context-menu',
        '.excalidraw .context-menu',
        '[data-testid="context-menu"]',
        '[role="menu"]',
      ].join(',')
    ),
  ].filter((el) => {
    if (!isElementVisible(el)) return false;
    if (el.closest('.yanta-draw-note-picker')) return false;
    if (el.closest('.yanta-draw-autocomplete')) return false;
    if (el.closest('.yanta-draw-context-menu')) return false;
    return true;
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();

    return (
      distanceToPoint(ar, ctx.clientX, ctx.clientY) -
      distanceToPoint(br, ctx.clientX, ctx.clientY)
    );
  });

  return candidates[0];
}

function closeNativeExcalidrawContextMenu() {
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
    }));
  } catch {}
}

function makeNativeContextButton({ icon, label, danger = false, onClick }) {
  const btn = document.createElement('button');

  btn.type = 'button';
  btn.className = 'context-menu-option yanta-excalidraw-context-item' + (danger ? ' danger' : '');
  btn.setAttribute('role', 'menuitem');
  btn.setAttribute('data-yanta-draw-context-item', '1');
  btn.innerHTML = `${lucide(icon, 14)} <span>${escapeHtml(label)}</span>`;

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, true);

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    closeNativeExcalidrawContextMenu();

    try {
      await onClick?.();
    } catch (err) {
      console.error(err);
      toast('Drawing action failed', 'error');
    }
  }, true);

  return btn;
}

function injectYantaItemsIntoNativeContextMenu(container) {
  const ctx = drawNativeContextState.get(container);
  if (!ctx?.api || !ctx.targets?.length) return;

  const menu = findOpenExcalidrawContextMenu(ctx);
  if (!menu) return;

  if (menu.querySelector('[data-yanta-draw-context-item="1"]')) return;

  const separator = document.createElement('div');
  separator.className = 'yanta-excalidraw-context-separator';
  separator.setAttribute('data-yanta-draw-context-item', '1');

  const linkedNoteId = firstLinkedNoteId(ctx.targets);
  const hasAnyWikiLink = ctx.targets.some(elementHasWikiLink);

  const linkBtn = makeNativeContextButton({
    icon: 'link',
    label: 'YANTA: Link note…',
    onClick: async () => {
      const note = await openNoteReferencePicker();
      if (!note) return;

      if (linkSpecificElementsToNote(ctx.api, ctx.targets, note)) {
        toast(`Linked [[${note.title || 'Untitled'}]]`, 'success');
      }
    },
  });

  menu.append(separator, linkBtn);

  if (linkedNoteId && state.notes.has(linkedNoteId)) {
    const openBtn = makeNativeContextButton({
      icon: 'file-text',
      label: 'YANTA: Open linked note',
      onClick: async () => {
        await openNote(linkedNoteId);
      },
    });

    menu.append(openBtn);
  }

  if (hasAnyWikiLink) {
    const removeBtn = makeNativeContextButton({
      icon: 'unlink',
      label: 'YANTA: Remove wikilink',
      danger: true,
      onClick: async () => {
        if (unlinkSpecificElements(ctx.api, ctx.targets)) {
          toast('Wikilink removed', 'success');
        }
      },
    });

    menu.append(removeBtn);
  }
}

function bindNativeExcalidrawContextMenuPatch(container, apiRef, editable) {
  if (!container || container.dataset.drawNativeCtxBound === '1') return;
  container.dataset.drawNativeCtxBound = '1';

  const ctx = {
    api: null,
    targets: [],
    clientX: 0,
    clientY: 0,
    observer: null,
  };

  drawNativeContextState.set(container, ctx);

  container.addEventListener('contextmenu', (e) => {
    if (!editable) return;

    const api = apiRef?.current || apiRef;
    if (!api) return;

    const p = sceneCoordsForClient(api, container, e.clientX, e.clientY);
    const hit = elementAt(api, p.x, p.y);
    const targets = selectionTargetElements(api, hit);

    if (!targets.length) {
      ctx.api = null;
      ctx.targets = [];
      return;
    }

    ctx.api = api;
    ctx.targets = targets;
    ctx.clientX = e.clientX;
    ctx.clientY = e.clientY;

    // Do NOT prevent default. Excalidraw should open its native menu.
    setTimeout(() => injectYantaItemsIntoNativeContextMenu(container), 0);
    setTimeout(() => injectYantaItemsIntoNativeContextMenu(container), 40);
    setTimeout(() => injectYantaItemsIntoNativeContextMenu(container), 120);
  }, true);

  ctx.observer = new MutationObserver(() => {
    injectYantaItemsIntoNativeContextMenu(container);
  });

  ctx.observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

let drawAutocompleteEl = null;
let drawAutocompleteState = null;

function ensureDrawAutocomplete() {
  injectDrawCss();

  if (drawAutocompleteEl) return drawAutocompleteEl;

  drawAutocompleteEl = document.createElement('div');
  drawAutocompleteEl.className = 'yanta-draw-autocomplete';
  drawAutocompleteEl.hidden = true;
  document.body.append(drawAutocompleteEl);

  document.addEventListener('mousedown', (e) => {
    if (drawAutocompleteEl.hidden) return;
    if (drawAutocompleteEl.contains(e.target)) return;
    closeDrawAutocomplete();
  }, true);

  return drawAutocompleteEl;
}

function closeDrawAutocomplete() {
  if (drawAutocompleteEl) {
    drawAutocompleteEl.hidden = true;
    drawAutocompleteEl.replaceChildren();
  }

  drawAutocompleteState = null;
}

function drawAutocompleteOptions(query) {
  const q = String(query || '').trim().toLowerCase();

  return [...state.notes.values()]
    .filter((n) => !q || (n.title || '').toLowerCase().includes(q))
    .sort((a, b) => {
      const at = (a.title || '').toLowerCase();
      const bt = (b.title || '').toLowerCase();

      const as = at.startsWith(q) ? 1 : 0;
      const bs = bt.startsWith(q) ? 1 : 0;

      return bs - as || (b.updated || 0) - (a.updated || 0);
    })
    .slice(0, 12);
}

function patchEditingTextElementLink(api, note) {
  if (!api || !note) return;

  const appState = api.getAppState?.() || {};
  const editingId = appState.editingElement?.id;

  if (!editingId) return;

  const elements =
    api.getSceneElementsIncludingDeleted?.() ||
    api.getSceneElements?.() ||
    [];

  api.updateScene({
    elements: elements.map((el) =>
      el.id === editingId
        ? patchElementWithWikiLink(el, note, { preserveText: true })
        : el
    ),
  });

  api.refresh?.();
}

function applyDrawAutocomplete(note) {
  const st = drawAutocompleteState;
  if (!st?.input || !note) return;

  const input = st.input;
  const title = note.title || 'Untitled';
  const value = input.value || '';

  const insert = `${title}]]`;
  const nextValue = value.slice(0, st.from) + insert + value.slice(st.to);

  input.value = nextValue;
  input.selectionStart = input.selectionEnd = st.from + insert.length;

  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: insert,
  }));

  patchEditingTextElementLink(st.api, note);
  closeDrawAutocomplete();
}

function renderDrawAutocomplete() {
  const st = drawAutocompleteState;
  const pop = ensureDrawAutocomplete();

  if (!st?.input) {
    closeDrawAutocomplete();
    return;
  }

  const options = drawAutocompleteOptions(st.query);
  pop.replaceChildren();

  if (!options.length) {
    closeDrawAutocomplete();
    return;
  }

  st.active = Math.max(0, Math.min(st.active || 0, options.length - 1));
  st.options = options;

  for (let i = 0; i < options.length; i++) {
    const note = options[i];

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yanta-draw-autocomplete-item' + (i === st.active ? ' active' : '');
    btn.innerHTML = `
      ${lucide(note.icon || (note.type === 'list' ? 'list' : 'file'), 14)}
      <span>${escapeHtml(note.title || 'Untitled')}</span>
      <span class="meta">${escapeHtml(state.folders.get(note.folderId)?.name || '')}</span>
    `;

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyDrawAutocomplete(note);
    });

    pop.append(btn);
  }

  const r = st.input.getBoundingClientRect();
  pop.hidden = false;

  requestAnimationFrame(() => {
    const pr = pop.getBoundingClientRect();

    let left = r.left;
    let top = r.bottom + 6;

    if (left + pr.width > window.innerWidth - 10) {
      left = window.innerWidth - pr.width - 10;
    }

    if (top + pr.height > window.innerHeight - 10) {
      top = r.top - pr.height - 6;
    }

    pop.style.left = Math.max(10, left) + 'px';
    pop.style.top = Math.max(10, top) + 'px';
  });
}

function updateDrawAutocompleteFromInput(input, api) {
  const value = input.value || '';
  const pos = input.selectionStart ?? value.length;

  const before = value.slice(0, pos);
  const open = before.lastIndexOf('[[');
  const close = before.lastIndexOf(']]');

  if (open < 0 || close > open) {
    closeDrawAutocomplete();
    return;
  }

  const query = before.slice(open + 2);

  if (query.includes('\n') || query.includes(']')) {
    closeDrawAutocomplete();
    return;
  }

  drawAutocompleteState = {
    input,
    api,
    query,
    from: open + 2,
    to: pos,
    active: drawAutocompleteState?.input === input ? drawAutocompleteState.active || 0 : 0,
    options: [],
  };

  renderDrawAutocomplete();
}

function bindDrawWikiAutocomplete(container, apiRef, editable) {
  if (!container || container.dataset.drawWikiAutocompleteBound === '1') return;
  container.dataset.drawWikiAutocompleteBound = '1';

  container.addEventListener('input', (e) => {
    if (!editable) return;

    const input = e.target;

    if (
      !(input instanceof HTMLTextAreaElement) &&
      !(input instanceof HTMLInputElement)
    ) {
      return;
    }

    const api = apiRef?.current || apiRef;
    updateDrawAutocompleteFromInput(input, api);
  }, true);

  container.addEventListener('keydown', (e) => {
    if (!editable) return;
    if (!drawAutocompleteState || !drawAutocompleteEl || drawAutocompleteEl.hidden) return;

    const st = drawAutocompleteState;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDrawAutocomplete();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      st.active = Math.min((st.options?.length || 1) - 1, (st.active || 0) + 1);
      renderDrawAutocomplete();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      st.active = Math.max(0, (st.active || 0) - 1);
      renderDrawAutocomplete();
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      const note = st.options?.[st.active || 0];

      if (note) {
        e.preventDefault();
        e.stopPropagation();
        applyDrawAutocomplete(note);
      }
    }
  }, true);
}

function bindWikiPreviewInteractions(container, apiRef, editable) {
  if (!container || container.dataset.drawWikiBound === '1') return;
  container.dataset.drawWikiBound = '1';

  container.addEventListener('click', (e) => {
    const api = apiRef?.current || apiRef;
    if (!api) return;

    if (editable && !(e.ctrlKey || e.metaKey)) return;

    const p = sceneCoordsForClient(api, container, e.clientX, e.clientY);
    const el = elementAt(api, p.x, p.y);
    const target = firstWikiTargetInElement(el);

    if (!target) return;

    const note = noteByWikiTarget(target);
    if (!note) {
      window.dispatchEvent(new CustomEvent('yanta-follow-wiki', {
        detail: { target },
      }));
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    showNotePreview(note.id, e.clientX, e.clientY);
  }, true);
}

let notePreviewEl = null;

function ensureNotePreviewPopover() {
  injectDrawCss();

  if (notePreviewEl) return notePreviewEl;

  notePreviewEl = document.createElement('div');
  notePreviewEl.className = 'yanta-draw-note-preview';
  notePreviewEl.hidden = true;
  document.body.append(notePreviewEl);

  document.addEventListener('mousedown', (e) => {
    if (notePreviewEl.hidden) return;
    if (notePreviewEl.contains(e.target)) return;
    notePreviewEl.hidden = true;
  }, true);

  return notePreviewEl;
}

function positionFloatingElement(elm, x, y) {
  elm.hidden = false;

  requestAnimationFrame(() => {
    const r = elm.getBoundingClientRect();

    let left = x + 14;
    let top = y + 14;

    if (left + r.width > window.innerWidth - 10) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 10) top = Math.max(10, window.innerHeight - r.height - 10);
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    elm.style.left = left + 'px';
    elm.style.top = top + 'px';
  });
}

function showNotePreview(noteId, clientX, clientY) {
  const note = state.notes.get(noteId);
  if (!note) return;

  const pop = ensureNotePreviewPopover();

  let body = '';
  try {
    body = noteMarkdown(noteId) || '';
  } catch {}

  pop.innerHTML = `
    <div class="yanta-draw-note-preview-head">
      <span>${lucide(note.icon || (note.type === 'list' ? 'list' : 'file'), 16)}</span>
      <div class="yanta-draw-note-preview-title">${escapeHtml(note.title || 'Untitled')}</div>
      <button class="btn" data-open>${lucide('file-text', 13)} Open</button>
      <button class="icon-btn" data-close>${lucide('x', 15)}</button>
    </div>
    <div class="yanta-draw-note-preview-body">
      ${body.trim()
        ? `<article class="preview">${renderPreview(body)}</article>`
        : `<div class="tree-empty">Empty note.</div>`
      }
    </div>
  `;

  pop.querySelector('[data-close]')?.addEventListener('click', () => {
    pop.hidden = true;
  });

  pop.querySelector('[data-open]')?.addEventListener('click', async () => {
    pop.hidden = true;
    await openNote(noteId);
  });

  positionFloatingElement(pop, clientX, clientY);
}

async function openNoteReferencePicker() {
  return new Promise((resolve) => {
    injectDrawCss();

    const overlay = document.createElement('div');
    overlay.className = 'yanta-draw-note-picker';

    const card = document.createElement('div');
    card.className = 'yanta-draw-note-picker-card';

    const head = document.createElement('div');
    head.className = 'yanta-draw-note-picker-head';
    head.innerHTML = `<strong>Link note</strong>`;

    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.innerHTML = lucide('x', 15);
    close.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    head.append(close);

    const search = document.createElement('input');
    search.className = 'text-input yanta-draw-note-picker-search';
    search.placeholder = 'Search note…';
    search.autocomplete = 'off';

    const list = document.createElement('div');
    list.className = 'yanta-draw-note-picker-list';

    let active = 0;
    let items = [];

    const render = () => {
      const q = search.value.trim().toLowerCase();

      items = [...state.notes.values()]
        .filter((n) => !q || (n.title || '').toLowerCase().includes(q))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0))
        .slice(0, 80);

      active = Math.min(active, Math.max(0, items.length - 1));
      list.replaceChildren();

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'tree-empty';
        empty.textContent = 'No notes found.';
        list.append(empty);
        return;
      }

      items.forEach((note, i) => {
        const btn = document.createElement('button');
        btn.className = 'yanta-draw-note-picker-item' + (i === active ? ' active' : '');
        btn.innerHTML = `
          ${lucide(note.icon || (note.type === 'list' ? 'list' : 'file'), 14)}
          <span>${escapeHtml(note.title || 'Untitled')}</span>
          <span class="yanta-draw-note-picker-meta">${escapeHtml(state.folders.get(note.folderId)?.name || '')}</span>
        `;

        const accept = (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (!overlay.isConnected) return;

          overlay.remove();
          resolve(note);
        };

        btn.addEventListener('mouseenter', () => {
          active = i;

          for (const child of list.children) {
            child.classList?.toggle(
              'active',
              parseInt(child.dataset.index || '-1', 10) === active
            );
          }
        });

        btn.dataset.index = String(i);
        btn.addEventListener('pointerdown', accept, true);
        btn.addEventListener('click', accept, true);

        list.append(btn);
      });
    };

    search.addEventListener('input', render);

    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        overlay.remove();
        resolve(null);
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        active = Math.min(items.length - 1, active + 1);
        render();
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.max(0, active - 1);
        render();
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const note = items[active];
        overlay.remove();
        resolve(note || null);
      }
    });

    card.append(head, search, list);
    overlay.append(card);
    document.body.append(overlay);

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });

    render();
    setTimeout(() => search.focus(), 0);
  });
}

function setModalDrawingTitle(drawingId, drawing) {
  if (!titleEl) return;
  titleEl.textContent = `Drawing · ${drawing?.title || drawingId || 'Drawing'}`;
  titleEl.title = 'Click to rename drawing';
}

async function commitDrawingTitle(noteId, drawingId, title) {
  const clean = String(title || '').trim() || 'Drawing';

  updateDrawingMeta(noteId, drawingId, { title: clean }, 'draw-rename');

  toast('Drawing renamed', 'success');

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: { noteId, drawingId },
  }));

  return clean;
}

async function renameDrawing(noteId, drawingId, { anchor = null, prefix = '' } = {}) {
  const d = getDrawing(noteId, drawingId);
  if (!d) return;

  const target = anchor || titleEl;
  if (!target) return;

  inlineTextEdit(target, {
    initial: d.title || 'Drawing',
    placeholder: 'Drawing title',
    emptyFallback: 'Drawing',
    displayValue: (value) => prefix + value,
    onCommit: async (value) => {
      await commitDrawingTitle(noteId, drawingId, value);
      return prefix + value;
    },
  });
}

function confirmDeleteDrawing(noteId, drawingId, {
  anchor,
  onDeleted,
} = {}) {
  if (!noteId || !drawingId || !anchor) return;

  inlineConfirm(anchor, {
    message: 'Delete drawing?',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    danger: true,
    onConfirm: async () => {
      deleteDrawing(noteId, drawingId);
      toast('Drawing deleted');

      window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
        detail: { noteId, drawingId },
      }));

      await onDeleted?.();
    },
  });
}

function ensureModal() {
  injectDrawCss();

  if (modal) return;

  modal = document.createElement('div');
  modal.className = 'yanta-draw-modal';
  modal.hidden = true;

  const head = document.createElement('div');
  head.className = 'yanta-draw-head';

titleEl = document.createElement('div');
titleEl.className = 'yanta-draw-title';
titleEl.textContent = 'Drawing';
titleEl.title = 'Click to rename drawing';
titleEl.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (!active.noteId || !active.drawingId) return;

  await renameDrawing(active.noteId, active.drawingId, {
    anchor: titleEl,
    prefix: 'Drawing · ',
  });
});

  const spacer = document.createElement('span');
  spacer.style.flex = '1';

  const linkNoteBtn = document.createElement('button');
  linkNoteBtn.className = 'btn';
  linkNoteBtn.innerHTML = `${lucide('file-plus', 14)} Link note`;
  linkNoteBtn.addEventListener('click', async () => {
    if (!active.api) return;
    const note = await openNoteReferencePicker();
    if (!note) return;

    if (await linkSelectedElementsToNote(active.api, note)) {
    toast(`Linked [[${note.title || 'Untitled'}]]`, 'success');
    }
  });

  const renameBtn = document.createElement('button');
  renameBtn.className = 'btn';
  renameBtn.innerHTML = `${lucide('pencil', 14)} Rename`;
renameBtn.addEventListener('click', async () => {
  if (!active.noteId || !active.drawingId) return;

  await renameDrawing(active.noteId, active.drawingId, {
    anchor: titleEl,
    prefix: 'Drawing · ',
  });
});

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn';
  exportBtn.innerHTML = `${lucide('download', 14)} Export`;
  exportBtn.addEventListener('click', () => {
    if (active.noteId && active.drawingId) exportDrawing(active.noteId, active.drawingId);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn danger';
  deleteBtn.innerHTML = `${lucide('trash', 14)} Delete`;
deleteBtn.addEventListener('click', async () => {
  if (!active.noteId || !active.drawingId) return;

  confirmDeleteDrawing(active.noteId, active.drawingId, {
    anchor: deleteBtn,
    onDeleted: async () => {
      closeDrawModal();
    },
  });
});

  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = lucide('x', 16);
  closeBtn.addEventListener('click', closeDrawModal);

  host = document.createElement('div');
  host.className = 'yanta-draw-body';

  head.append(titleEl, spacer, linkNoteBtn, renameBtn, exportBtn, deleteBtn, closeBtn);
  modal.append(head, host);
  document.body.append(modal);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) closeDrawModal();
  });
}

export async function createDrawingAndInsert() {
  if (!state.currentNoteId) {
    toast('Open a note first', 'error');
    return;
  }

  const noteId = state.currentNoteId;
  const drawingId = uid();
  const theme = currentExcalidrawTheme();

  const emptyScene = {
    id: drawingId,
    title: 'Drawing',
    canvas: {
      width: 760,
      height: 420,
    },
    elements: [],
    appState: {
      theme,
      viewBackgroundColor: theme === 'dark' ? '#121212' : '#ffffff',
      currentItemStrokeColor: theme === 'dark' ? '#f8f9fa' : '#1e1e1e',
      currentItemBackgroundColor: 'transparent',
    },
    files: {},
  };

  setDrawing(noteId, drawingId, emptyScene, 'draw-create');
  insertAtCursor(`\n\ndraw://${drawingId}\n\n`);

  toast('Drawing inserted', 'success');

  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
      detail: { noteId, drawingId },
    }));
  });
}

function updateEmbedFromDrawing(embed, drawing) {
  updateEmbedHeader(embed, drawing);
  applyCanvasSize(embed, drawing);

  const linksHost = embed.querySelector('.yanta-draw-links');
  if (linksHost && drawing) {
    renderLinkPills(linksHost, extractWikiTargetsFromScene(drawing));
  }
}

function bindResizeHandle(embed, sourceNoteId, drawingId) {
  const surface = embed.getAttribute('data-draw-surface') || 'preview';
  if (surface !== 'editor') return;

  const handle = embed.querySelector('.yanta-draw-resize-handle');
  const inlineHost = embed.querySelector('.yanta-draw-inline-host');
  if (!handle || !inlineHost || handle.dataset.bound === '1') return;

  handle.dataset.bound = '1';

  let startY = 0;
  let startH = 0;
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;

    const nextH = Math.max(180, Math.min(5000, startH + (e.clientY - startY)));
    inlineHost.style.height = Math.round(nextH) + 'px';

    const api = inlineApis.get(embed);
    try {
      api?.refresh?.();
    } catch {}
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);

    const current = getDrawing(sourceNoteId, drawingId);
    if (!current) return;

    const oldSize = canvasSizeOf(current);
    const nextHeight = Math.round(inlineHost.getBoundingClientRect().height);

    if (Math.abs(nextHeight - oldSize.height) < 3) return;

    updateDrawingMeta(sourceNoteId, drawingId, {
      canvas: {
        width: oldSize.width,
        height: nextHeight,
      },
    }, 'draw-resize');

    window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
      detail: { noteId: sourceNoteId, drawingId },
    }));

    toast(`Drawing height: ${nextHeight}px`, 'success');
  };

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    dragging = true;
    startY = e.clientY;
    startH = inlineHost.getBoundingClientRect().height;

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
  });
}

async function mountInlineDrawing(embed, sourceNoteId, drawingId, drawing) {
  const inlineHost = embed.querySelector('.yanta-draw-inline-host');
  const linksHost = embed.querySelector('.yanta-draw-links');

  if (!inlineHost) return;

  const surface = embed.getAttribute('data-draw-surface') || 'preview';
  const editable = surface === 'editor';

  embed.setAttribute('data-note-id', sourceNoteId);

  updateEmbedFromDrawing(embed, drawing);
  bindResizeHandle(embed, sourceNoteId, drawingId);

  const { React, ReactDOM } = await loadReact();
  const { Excalidraw } = await loadExcalidraw();

  if (inlineRoots.has(inlineHost)) {
    updateEmbedFromDrawing(embed, drawing);
    return;
  }

  const root = ReactDOM.createRoot(inlineHost);
  inlineRoots.set(inlineHost, root);

  function InlineDrawing() {
    const apiRef = React.useRef(null);
    const saveTimerRef = React.useRef(0);
    const suppressChangeRef = React.useRef(false);
    const didInitialChangeRef = React.useRef(false);
    const lastSigRef = React.useRef(drawingSignature(drawing));

    const localOriginRef = React.useRef(`draw-inline-local-${uid()}`);

    const [theme, setTheme] = React.useState(currentExcalidrawTheme());
    const [links, setLinks] = React.useState(extractWikiTargetsFromScene(drawing));

    React.useEffect(() => {
      const entry = getNoteDoc(sourceNoteId);
      const drawings = entry.doc.getMap('drawings');

      const observer = (event) => {
        if (!event.keysChanged.has(drawingId)) return;
        if (event.transaction.origin === localOriginRef.current) return;

        const next = getDrawing(sourceNoteId, drawingId);
        if (!next) return;

        updateEmbedFromDrawing(embed, next);
        setLinks(extractWikiTargetsFromScene(next));
        lastSigRef.current = drawingSignature(next);

        if (apiRef.current) {
          try {
            suppressChangeRef.current = true;
            apiRef.current.updateScene(initialDataForDrawing(next));

            requestAnimationFrame(() => {
              suppressChangeRef.current = false;
              apiRef.current?.refresh?.();
            });
          } catch {
            suppressChangeRef.current = false;
          }
        }
      };

      drawings.observe(observer);

      return () => {
        try {
          drawings.unobserve(observer);
        } catch {}
      };
    }, []);

    React.useEffect(() => {
      const update = () => {
        const nextTheme = currentExcalidrawTheme();
        setTheme(nextTheme);

        try {
          apiRef.current?.updateScene({
            appState: {
              ...cleanAppState(apiRef.current?.getAppState?.() || {}),
              theme: nextTheme,
            },
          });
          apiRef.current?.refresh?.();
        } catch {}
      };

      window.addEventListener('yanta-theme-change', update);

      const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
      mq?.addEventListener?.('change', update);

      const mo = new MutationObserver(update);
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      return () => {
        window.removeEventListener('yanta-theme-change', update);
        mq?.removeEventListener?.('change', update);
        mo.disconnect();
      };
    }, []);

    React.useEffect(() => {
      if (linksHost) renderLinkPills(linksHost, links);
    }, [links.join('\n')]);

    React.useEffect(() => {
      const ro = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          try {
            apiRef.current?.refresh?.();
          } catch {}
        });
      });

      ro.observe(inlineHost);

      return () => ro.disconnect();
    }, []);

    React.useEffect(() => {
    bindWikiPreviewInteractions(inlineHost, apiRef, editable);

    if (editable) {
        bindNoteDropToDrawing(inlineHost, apiRef, true);
        bindNativeExcalidrawContextMenuPatch(inlineHost, apiRef, true);
        bindDrawWikiAutocomplete(inlineHost, apiRef, true);
    }
    }, []);

    const saveScene = (elements, appState, files) => {
      if (!editable) return;
      if (suppressChangeRef.current) return;

      if (!didInitialChangeRef.current) {
        didInitialChangeRef.current = true;
        return;
      }

    const cleanedAppState = cleanAppState(appState);
    const cleanedElements = cleanStaleSceneWikiData(elements || []);
    const sig = sceneSignature(cleanedElements, cleanedAppState, files);

      if (sig === lastSigRef.current) return;

      clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {
        const prev = getDrawing(sourceNoteId, drawingId) || drawing;

        const nextScene = {
          id: drawingId,
          title: prev.title || drawing.title || 'Drawing',
          canvas: prev.canvas || drawing.canvas,
          elements: cleanedElements,
          appState: cleanedAppState,
          files: files || {},
        };

        const nextSig = sceneSignature(
          nextScene.elements,
          nextScene.appState,
          nextScene.files
        );

        if (nextSig === lastSigRef.current) return;

        lastSigRef.current = nextSig;

        setDrawing(sourceNoteId, drawingId, nextScene, localOriginRef.current);

        updateEmbedFromDrawing(embed, nextScene);
        setLinks(extractWikiTargetsFromScene(nextScene));

        window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
          detail: { noteId: sourceNoteId, drawingId },
        }));
      }, 250);
    };

    const onLinkOpen = (element, event) => {
      const noteId = noteIdFromLink(element?.link);
      if (noteId && state.notes.has(noteId)) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        showNotePreview(noteId, event?.clientX || window.innerWidth / 2, event?.clientY || window.innerHeight / 2);
        return;
      }
    };

    return React.createElement(Excalidraw, {
      initialData: initialDataForDrawing(
        drawing,
        excalidrawLibraryInitialData()
      ),
      theme,
      name: drawing.title || 'Drawing',

      excalidrawAPI: (api) => {
        apiRef.current = api;
        inlineApis.set(embed, api);

        setTimeout(() => {
          try {
            api.refresh?.();
          } catch {}
        }, 60);
      },

      viewModeEnabled: !editable,
      zenModeEnabled: false,
      gridModeEnabled: false,

      UIOptions: {
        canvasActions: editable
          ? {
              loadScene: false,
              saveAsImage: false,
              export: false,
              clearCanvas: true,
              toggleTheme: false,
            }
          : {
              loadScene: false,
              saveAsImage: false,
              export: false,
              clearCanvas: false,
              toggleTheme: false,
            },
      },

      detectScroll: true,
      autoFocus: false,
      onChange: editable ? saveScene : undefined,
      onLibraryChange: persistDrawLibraryItems,
      onLinkOpen,
    });
  }

  root.render(React.createElement(InlineDrawing));
}

function refreshDrawEmbeds(root = document) {
  const nodes = [...root.querySelectorAll?.('.yanta-draw-embed[data-draw-id]') || []];

  for (const embed of nodes) {
    const preferredNoteId = embed.getAttribute('data-note-id') || state.currentNoteId;
    const drawingId = embed.getAttribute('data-draw-id');
    if (!drawingId) continue;

    const hit = findDrawing(drawingId, preferredNoteId);
    const inlineHost = embed.querySelector('.yanta-draw-inline-host');
    const linksHost = embed.querySelector('.yanta-draw-links');

    if (!hit) {
      embed.classList.add('missing');
      updateEmbedHeader(embed, null);
      if (linksHost) linksHost.replaceChildren();

      if (inlineHost) {
        unmountInlineHost(inlineHost);
        inlineHost.innerHTML = `<div class="yanta-draw-missing-body">Drawing not found: draw://${escapeHtml(drawingId)}</div>`;
      }

      continue;
    }

    embed.classList.remove('missing');
    embed.setAttribute('data-note-id', hit.noteId);
    updateEmbedFromDrawing(embed, hit.drawing);
    bindResizeHandle(embed, hit.noteId, drawingId);
  }
}

export async function hydrateDrawEmbeds(root = document) {
  injectDrawCss();

  const nodes = [...root.querySelectorAll?.('.yanta-draw-embed[data-draw-id]') || []];

  for (const embed of nodes) {
    const preferredNoteId = embed.getAttribute('data-note-id') || state.currentNoteId;
    const drawingId = embed.getAttribute('data-draw-id');
    if (!drawingId) continue;

    const inlineHost = embed.querySelector('.yanta-draw-inline-host');
    const linksHost = embed.querySelector('.yanta-draw-links');

    bindEmbedActions(embed);

    const hit = await resolveDrawingRefAsync(drawingId, preferredNoteId);

    if (!hit) {
      embed.classList.add('missing');
      updateEmbedHeader(embed, null);

      if (linksHost) linksHost.replaceChildren();

      if (inlineHost) {
        unmountInlineHost(inlineHost);
        inlineHost.innerHTML = `<div class="yanta-draw-missing-body">Drawing not found: draw://${escapeHtml(drawingId)}</div>`;
      }

      continue;
    }

    embed.classList.remove('missing');
    embed.setAttribute('data-note-id', hit.noteId);
    updateEmbedFromDrawing(embed, hit.drawing);
    bindResizeHandle(embed, hit.noteId, drawingId);

    if (!inlineHost) continue;
    if (inlineRoots.has(inlineHost)) continue;

    await mountInlineDrawing(embed, hit.noteId, drawingId, hit.drawing);
  }
}

function bindEmbedActions(embed) {
  if (embed.dataset.drawBound === '1') return;
  embed.dataset.drawBound = '1';

  embed.addEventListener('pointerdown', () => {
    document.querySelectorAll('.yanta-draw-embed.is-active').forEach((n) => {
      if (n !== embed) n.classList.remove('is-active');
    });

    embed.classList.add('is-active');
  });

  if (!activeEmbedCloseBound) {
    activeEmbedCloseBound = true;

    document.addEventListener('pointerdown', (e) => {
      document.querySelectorAll('.yanta-draw-embed.is-active').forEach((n) => {
        if (!n.contains(e.target)) n.classList.remove('is-active');
      });
    }, true);
  }

  embed.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('[data-draw-action]');
    const title = e.target.closest?.('[data-draw-title]');
    if (!btn && !title) return;

    e.preventDefault();
    e.stopPropagation();

    const drawingId = embed.getAttribute('data-draw-id');
    const preferredNoteId = embed.getAttribute('data-note-id') || state.currentNoteId;
    const hit = await resolveDrawingRefAsync(drawingId, preferredNoteId);

    if (!hit) {
      toast(`Drawing not found: draw://${drawingId}`, 'error');
      return;
    }

if (title && !btn) {
  await renameDrawing(hit.noteId, drawingId, {
    anchor: title,
  });
  return;
}

    const action = btn.getAttribute('data-draw-action');

    if (action === 'link-note') {
      const api = inlineApis.get(embed);
      const note = await openNoteReferencePicker();

      if (!note) return;

      if (!api) {
        toast('Drawing is not ready yet', 'error');
        return;
      }

if (await linkSelectedElementsToNote(api, note)) {
  toast(`Linked [[${note.title || 'Untitled'}]]`, 'success');
}

      return;
    }

if (action === 'rename') {
  const titleAnchor = embed.querySelector('[data-draw-title]') || btn;
  await renameDrawing(hit.noteId, drawingId, {
    anchor: titleAnchor,
  });
  return;
}

    if (action === 'fullscreen') {
      openDrawModal(drawingId, hit.noteId);
      return;
    }

    if (action === 'export') {
      exportDrawing(hit.noteId, drawingId);
      return;
    }

if (action === 'delete') {
  confirmDeleteDrawing(hit.noteId, drawingId, {
    anchor: btn,
  });
}
  });
}

export async function openDrawModal(drawingId, noteId = state.currentNoteId) {
  if (!drawingId) return;

  ensureModal();

  const hit = await resolveDrawingRefAsync(drawingId, noteId);

  if (!hit) {
    toast(`Drawing not found: draw://${drawingId}`, 'error');
    return;
  }

  const sourceNoteId = hit.noteId;
  const current = hit.drawing;

  const entry = getNoteDoc(sourceNoteId);
  await entry.ready;

  if (active.unobserve) {
    active.unobserve();
    active.unobserve = null;
  }

  if (reactRoot) {
    try {
      reactRoot.unmount();
    } catch {}
    reactRoot = null;
  }

  if (host) {
    unmountDrawEmbeds(host);
    host.replaceChildren();
  }

  active = {
    noteId: sourceNoteId,
    drawingId,
    api: null,
    unobserve: null,
  };

  setModalDrawingTitle(drawingId, current);
  modal.hidden = false;

  const { React, ReactDOM } = await loadReact();
  const { Excalidraw } = await loadExcalidraw();

  const fullscreenHost = document.createElement('div');
  fullscreenHost.className = 'yanta-draw-fullscreen-host';
  host.append(fullscreenHost);

  const drawings = entry.doc.getMap('drawings');

  function FullscreenDrawing() {
    const apiRef = React.useRef(null);
    const saveTimerRef = React.useRef(0);
    const suppressChangeRef = React.useRef(false);
    const didInitialChangeRef = React.useRef(false);
    const lastSigRef = React.useRef(drawingSignature(current));
    const localOriginRef = React.useRef(`draw-modal-local-${uid()}`);

    const [theme, setTheme] = React.useState(currentExcalidrawTheme());

    React.useEffect(() => {
      const observer = (event) => {
        if (!event.keysChanged.has(drawingId)) return;
        if (event.transaction.origin === localOriginRef.current) return;

        const next = getDrawing(sourceNoteId, drawingId);
        if (!next) return;

        setModalDrawingTitle(drawingId, next);
        lastSigRef.current = drawingSignature(next);

        if (apiRef.current) {
          try {
            suppressChangeRef.current = true;
            apiRef.current.updateScene(initialDataForDrawing(next));

            requestAnimationFrame(() => {
              suppressChangeRef.current = false;
              apiRef.current?.refresh?.();
            });
          } catch {
            suppressChangeRef.current = false;
          }
        }
      };

      drawings.observe(observer);

      active.unobserve = () => {
        try {
          drawings.unobserve(observer);
        } catch {}
      };

      return () => {
        try {
          drawings.unobserve(observer);
        } catch {}
      };
    }, []);

    React.useEffect(() => {
      const update = () => {
        const nextTheme = currentExcalidrawTheme();
        setTheme(nextTheme);

        try {
          apiRef.current?.updateScene({
            appState: {
              ...cleanAppState(apiRef.current?.getAppState?.() || {}),
              theme: nextTheme,
            },
          });
          apiRef.current?.refresh?.();
        } catch {}
      };

      window.addEventListener('yanta-theme-change', update);

      const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
      mq?.addEventListener?.('change', update);

      const mo = new MutationObserver(update);
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      return () => {
        window.removeEventListener('yanta-theme-change', update);
        mq?.removeEventListener?.('change', update);
        mo.disconnect();
      };
    }, []);

React.useEffect(() => {
  bindNoteDropToDrawing(fullscreenHost, apiRef, true);
  bindWikiPreviewInteractions(fullscreenHost, apiRef, true);
  bindNativeExcalidrawContextMenuPatch(fullscreenHost, apiRef, true);
  bindDrawWikiAutocomplete(fullscreenHost, apiRef, true);
}, []);

    React.useEffect(() => {
      const ro = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          try {
            apiRef.current?.refresh?.();
          } catch {}
        });
      });

      ro.observe(fullscreenHost);

      const timers = [
        setTimeout(() => apiRef.current?.refresh?.(), 0),
        setTimeout(() => apiRef.current?.refresh?.(), 50),
        setTimeout(() => apiRef.current?.refresh?.(), 180),
      ];

      return () => {
        ro.disconnect();
        timers.forEach(clearTimeout);
      };
    }, []);

    const onChange = (elements, appState, files) => {
      if (suppressChangeRef.current) return;

      if (!didInitialChangeRef.current) {
        didInitialChangeRef.current = true;
        return;
      }

    const cleanedAppState = cleanAppState(appState);
    const cleanedElements = cleanStaleSceneWikiData(elements || []);
    const sig = sceneSignature(cleanedElements, cleanedAppState, files);

      if (sig === lastSigRef.current) return;

      clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {
        const prev = getDrawing(sourceNoteId, drawingId) || current;

        const nextScene = {
          id: drawingId,
          title: prev.title || current.title || 'Drawing',
          canvas: prev.canvas || current.canvas,
          elements: cleanedElements,
          appState: cleanedAppState,
          files: files || {},
        };

        const nextSig = sceneSignature(
          nextScene.elements,
          nextScene.appState,
          nextScene.files
        );

        if (nextSig === lastSigRef.current) return;

        lastSigRef.current = nextSig;

        setDrawing(sourceNoteId, drawingId, nextScene, localOriginRef.current);

        window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
          detail: { noteId: sourceNoteId, drawingId },
        }));
      }, 250);
    };

    const onLinkOpen = (element, event) => {
      const noteId = noteIdFromLink(element?.link);
      if (noteId && state.notes.has(noteId)) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        showNotePreview(noteId, event?.clientX || window.innerWidth / 2, event?.clientY || window.innerHeight / 2);
      }
    };

    return React.createElement(Excalidraw, {
      initialData: initialDataForDrawing(
        current,
        excalidrawLibraryInitialData()
      ),
      theme,
      name: current.title || 'Drawing',

      excalidrawAPI: (api) => {
        apiRef.current = api;
        active.api = api;

        requestAnimationFrame(() => {
          try {
            api.refresh?.();
          } catch {}
        });

        setTimeout(() => {
          try {
            api.refresh?.();
          } catch {}
        }, 80);
      },

      UIOptions: {
        canvasActions: {
          loadScene: false,
          saveAsImage: false,
          export: false,
          clearCanvas: true,
          toggleTheme: false,
        },
      },

      detectScroll: true,
      autoFocus: true,
      onChange,
      onLibraryChange: persistDrawLibraryItems,
      onLinkOpen,
    });
  }

  reactRoot = ReactDOM.createRoot(fullscreenHost);
  reactRoot.render(React.createElement(FullscreenDrawing));
}

export function closeDrawModal() {
  if (!modal) return;

  modal.hidden = true;

  if (active.unobserve) {
    active.unobserve();
    active.unobserve = null;
  }

  if (reactRoot) {
    try {
      reactRoot.unmount();
    } catch {}
    reactRoot = null;
  }

  if (host) {
    unmountDrawEmbeds(host);
    host.replaceChildren();
  }

  active = {
    noteId: null,
    drawingId: null,
    api: null,
    unobserve: null,
  };
}

export function drawingToExcalidrawJson(noteId, drawingId) {
  const d = getDrawing(noteId, drawingId);
  if (!d) return null;

  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://yanta.local/draw',
    elements: d.elements || [],
    appState: cleanAppState(d.appState || {}),
    files: d.files || {},
    yanta: {
      title: d.title || 'Drawing',
      canvas: d.canvas || { width: 760, height: 420 },
    },
  };
}

export function exportDrawing(noteId, drawingId) {
  const json = drawingToExcalidrawJson(noteId, drawingId);

  if (!json) {
    toast('Drawing not found', 'error');
    return;
  }

  const note = state.notes.get(noteId);
  const d = getDrawing(noteId, drawingId);
  const name = `${safeFilename(d?.title || note?.title || 'drawing')}-${drawingId}.excalidraw`;

  downloadBlob(
    new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
    name
  );
}

export async function drawingThumbnailUrl(noteId, drawingId) {
  const key = `${noteId}:${drawingId}`;
  const cached = thumbnailCache.get(key);
  if (cached) return cached;

  const d = getDrawing(noteId, drawingId);

  if (!d) return '';

  if (!d.elements?.length) {
    const fallback = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220">
        <rect width="360" height="220" rx="14" fill="#121212"/>
        <text x="180" y="112" dominant-baseline="middle" text-anchor="middle" fill="#6ea8fe" font-family="system-ui" font-size="20">Drawing</text>
      </svg>
    `)}`;
    thumbnailCache.set(key, fallback);
    return fallback;
  }

  try {
    const { exportToSvg } = await loadExcalidraw();

    const svg = await exportToSvg({
      elements: d.elements || [],
      appState: {
        ...cleanAppState(d.appState || {}),
        exportBackground: true,
        viewBackgroundColor:
          d.appState?.viewBackgroundColor ||
          (currentExcalidrawTheme() === 'dark' ? '#121212' : '#ffffff'),
      },
      files: d.files || {},
    });

    svg.setAttribute('width', '360');
    svg.setAttribute('height', '220');

    const data = new XMLSerializer().serializeToString(svg);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;

    thumbnailCache.set(key, url);
    return url;
  } catch {
    return '';
  }
}

export async function importExcalidrawFileIntoCurrent(file) {
  if (!state.currentNoteId) {
    await importExcalidrawFileAsNote(file);
    return;
  }

  const data = JSON.parse(await file.text());
  const scene = normalizeDrawingScene(data);
  const drawingId = uid();

  setDrawing(state.currentNoteId, drawingId, {
    id: drawingId,
    title: file.name.replace(/\.excalidraw(\.json)?$/i, '') || 'Drawing',
    canvas: scene.canvas || { width: 760, height: 420 },
    ...scene,
  }, 'draw-import');

  insertAtCursor(`\n\ndraw://${drawingId}\n\n`);
  toast('Drawing imported', 'success');

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: { noteId: state.currentNoteId, drawingId },
  }));
}

export async function importSvgFileAsDrawing(file) {
  if (!state.currentNoteId) {
    toast('Open a note first', 'error');
    return;
  }

  if (!file || file.type !== 'image/svg+xml') {
    toast('Pick an SVG file', 'error');
    return;
  }

  const text = await file.text();
  const dataURL = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;

  const drawingId = uid();
  const fileId = uid();

  const imageElement = {
    id: uid(),
    type: 'image',
    x: 0,
    y: 0,
    width: 760,
    height: 420,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    fileId,
    scale: [1, 1],
    status: 'saved',
  };

  setDrawing(state.currentNoteId, drawingId, {
    id: drawingId,
    title: file.name.replace(/\.svg$/i, '') || 'SVG drawing',
    canvas: { width: 760, height: 420 },
    elements: [imageElement],
    appState: {
      theme: currentExcalidrawTheme(),
      viewBackgroundColor: currentExcalidrawTheme() === 'dark' ? '#121212' : '#ffffff',
    },
    files: {
      [fileId]: {
        id: fileId,
        dataURL,
        mimeType: 'image/svg+xml',
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    },
  }, 'draw-svg-import');

  insertAtCursor(`\n\ndraw://${drawingId}\n\n`);
  toast('SVG imported as drawing', 'success');

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: { noteId: state.currentNoteId, drawingId },
  }));
}

export async function importExcalidrawFileAsNote(file) {
  const data = JSON.parse(await file.text());

  return importExcalidrawDataAsNote(
    data,
    file.name.replace(/\.excalidraw(\.json)?$/i, '') || 'Drawing'
  );
}

export async function importExcalidrawDataAsNote(data, title = 'Drawing') {
  const scene = normalizeDrawingScene(data);
  const noteId = uid();
  const drawingId = uid();

  const note = {
    id: noteId,
    title,
    type: 'markdown',
    folderId: state.currentNoteId ? state.notes.get(state.currentNoteId)?.folderId || null : null,
    tags: ['drawing'],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };

  state.notes.set(noteId, note);
  await store.notes.put(note);

  const entry = getNoteDoc(noteId);
  await entry.ready;

  entry.doc.getText('markdown').insert(0, `draw://${drawingId}\n`);

  setDrawing(noteId, drawingId, {
    id: drawingId,
    title,
    canvas: scene.canvas || { width: 760, height: 420 },
    ...scene,
  }, 'draw-import');

  state.searchIndex.set(noteId, [title, scene.text || ''].join(' ').toLowerCase());

  toast('Drawing imported as note', 'success');

  return { noteId, drawingId };
}

export function setupDraw() {
  injectDrawCss();
  loadDrawLibraryItemsFromSettings().catch(() => {});

  window.addEventListener('yanta-create-drawing', () => createDrawingAndInsert());

  window.addEventListener('yanta-open-drawing', (e) => {
    const drawingId = e.detail?.drawingId || e.detail?.id;
    const noteId = e.detail?.noteId || state.currentNoteId;

    if (drawingId) openDrawModal(drawingId, noteId);
  });

  window.addEventListener('yanta-preview-rendered', () => hydrateDrawEmbeds(document));

  window.addEventListener('yanta-draw-hydrate', (e) => {
    hydrateDrawEmbeds(e.detail?.root || document);
  });

  window.addEventListener('yanta-draw-unmount', (e) => {
    unmountDrawEmbeds(e.detail?.root || document);
  });

  window.addEventListener('yanta-drawing-updated', () => {
    thumbnailCache.clear();
    refreshDrawEmbeds(document);
  });
}

export function drawingsAsZipEntries(noteId, enc = new TextEncoder()) {
  const out = [];

  for (const d of listDrawingsForNote(noteId)) {
    const json = drawingToExcalidrawJson(noteId, d.id);
    if (!json) continue;

    out.push({
      path: `drawings/${noteId}/${d.id}.excalidraw`,
      data: enc.encode(JSON.stringify(json, null, 2)),
    });
  }

  return out;
}