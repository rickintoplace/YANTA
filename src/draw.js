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
  safeCssColor,
} from './core.js';

import { insertAtCursor } from './editor.js';
import { openNote } from './notes.js';
import { renderPreview } from './markdown.js';
import { inlineTextEdit, inlineConfirm } from './inline-ui.js';
import { showMenu } from './tree.js';

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

import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
} from './overlay-history.js';

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
let drawOverlayRegistered = false;

function drawFullscreenIsOpen() {
  return !!modal && modal.hidden === false && !!active.drawingId;
}

function registerDrawOverlayRoute() {
  if (drawOverlayRegistered) return;

  drawOverlayRegistered = true;

  registerOverlayRoute('draw-fullscreen', {
    open: ({ data, state } = {}) => {
      const drawingId =
        data?.drawingId ||
        state?.drawingId ||
        '';

      const noteId =
        data?.noteId ||
        state?.noteId ||
        undefined;

      if (!drawingId) return;

      return openDrawModal(drawingId, noteId, {
        fromHistory: true,
        transition: false,
      });
    },

    close: () => {
      return closeDrawModal({
        fromHistory: true,
        transition: true,
      });
    },

    isOpen: drawFullscreenIsOpen,
  });
}

const inlineRoots = new WeakMap();
const inlineApis = new WeakMap();
const thumbnailCache = new Map();

export function getDrawingApiForEmbed(embed) {
  return embed ? inlineApis.get(embed) || null : null;
}


export function getActiveDrawingApi() {
  return active.api || null;
}

export function getActiveDrawingHost() {
  return (
    host?.querySelector?.('.yanta-draw-fullscreen-host') ||
    host ||
    null
  );
}

function dispatchDrawApiReadyDeferred(detail) {
  /*
    Excalidraw calls excalidrawAPI while its class component can still be
    completing mount. Dispatching app-level listeners synchronously can cause
    those listeners to call api.updateScene(), which triggers React warnings:
      "Can't call setState on a component that is not yet mounted."
      
    Defer one frame so consumers receive a mounted, measurable API.
  */
  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('yanta-draw-api-ready', {
      detail,
    }));
  });
}

const DRAW_LIBRARY_SETTINGS_KEY = 'drawLibraryItems.v1';

const DRAW_MOBILE_MQ = window.matchMedia?.('(pointer: coarse), (max-width: 760px)');

function isMobileDrawUx() {
  return !!DRAW_MOBILE_MQ?.matches;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function drawTransitionName(drawingId) {
  return `draw-${String(drawingId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function drawSelector(drawingId) {
  try {
    return `.yanta-draw-embed[data-draw-id="${CSS.escape(drawingId)}"]`;
  } catch {
    return `.yanta-draw-embed[data-draw-id="${String(drawingId).replace(/"/g, '\\"')}"]`;
  }
}

function findInlineDrawEmbed(drawingId) {
  if (!drawingId) return null;

  const nodes = [...document.querySelectorAll(drawSelector(drawingId))];

  if (!nodes.length) return null;

  // Bevorzugt sichtbare Editor-Embeds, weil die meistens die Quelle sind.
  return (
    nodes.find((node) => {
      if (!node.isConnected) return false;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && node.classList.contains('editor-surface');
    }) ||
    nodes.find((node) => {
      if (!node.isConnected) return false;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) ||
    nodes[0]
  );
}

function clearDrawingViewTransitionNames(drawingId, except = null) {
  if (!drawingId) return;

  const name = drawTransitionName(drawingId);

  const candidates = [
    ...document.querySelectorAll(drawSelector(drawingId)),
    ...document.querySelectorAll('.yanta-draw-fullscreen-host'),
  ];

  for (const node of candidates) {
    if (!node || node === except) continue;

    if (node.style.viewTransitionName === name) {
      node.style.viewTransitionName = '';
    }

    if (node.dataset?.yantaDrawVtName === name) {
      node.style.viewTransitionName = '';
      node.style.contain = '';
      delete node.dataset.yantaDrawVtName;
    }
  }
}

function markDrawingTransitionElement(node, name) {
  if (!node || !name) return null;

  const token = {
    node,
    oldViewTransitionName: node.style.viewTransitionName || '',
    oldContain: node.style.contain || '',
    name,
  };

  node.style.viewTransitionName = name;
  node.style.contain = 'layout paint';
  node.dataset.yantaDrawVtName = name;

  return token;
}

function restoreDrawingTransitionElement(token) {
  if (!token?.node) return;

  const node = token.node;

  // Wichtig:
  // Wenn vorher schon derselbe draw-* Name stale gesetzt war, NICHT wiederherstellen.
  // Genau das erzeugt sonst später duplicate view-transition-name.
  node.style.viewTransitionName =
    token.oldViewTransitionName === token.name
      ? ''
      : token.oldViewTransitionName;

  node.style.contain = token.oldContain || '';

  if (node.dataset?.yantaDrawVtName === token.name) {
    delete node.dataset.yantaDrawVtName;
  }
}

async function withDrawingViewTransition(drawingId, mutate, {
  source = null,
  targetGetter = null,
} = {}) {
  if (
    !drawingId ||
    !document.startViewTransition ||
    prefersReducedMotion()
  ) {
    await mutate?.();
    return;
  }

  const name = drawTransitionName(drawingId);

  // Vor jedem neuen Transition-Versuch stale Namen aufräumen.
  clearDrawingViewTransitionNames(drawingId);

  const sourceEl = source || findInlineDrawEmbed(drawingId);
  const sourceToken = sourceEl
    ? markDrawingTransitionElement(sourceEl, name)
    : null;

  let targetToken = null;
  let mutatePromise = null;
  let mutateError = null;

  let vt = null;

  try {
    /*
      Wichtig:
      Die update-callback von startViewTransition MUSS synchron/kurz bleiben.
      Nicht awaiten. Keine nextFrame() darin. Keine langen React-/Import-Promises.
    */
    vt = document.startViewTransition(() => {
      try {
        const result = mutate?.();

        if (result && typeof result.then === 'function') {
          mutatePromise = result.catch((err) => {
            mutateError = err;
            console.warn('[YANTA Draw] async transition mutation failed', err);
          });
        }
      } catch (err) {
        mutateError = err;
        console.warn('[YANTA Draw] transition mutation failed', err);
      }

      /*
        Kritisch:
        Beim Öffnen des Fullscreens bleibt das Inline-Embed im DOM.
        Für den NEUEN Snapshot darf aber nur das Target den Namen haben.
      */
      if (sourceEl?.isConnected) {
        sourceEl.style.viewTransitionName = '';
        sourceEl.style.contain = sourceToken?.oldContain || '';

        if (sourceEl.dataset?.yantaDrawVtName === name) {
          delete sourceEl.dataset.yantaDrawVtName;
        }
      }

      const targetEl = targetGetter?.() || null;

      if (targetEl) {
        clearDrawingViewTransitionNames(drawingId, targetEl);
        targetToken = markDrawingTransitionElement(targetEl, name);
      }
    });

    /*
      Alle Transition-Promises defensiv schlucken.
      Browser können ready/updateCallbackDone/finished unterschiedlich rejecten,
      z.B. bei Timeout, duplicate names, user navigation, display changes.
    */
    await Promise.allSettled([
      vt.ready,
      vt.updateCallbackDone,
      vt.finished,
    ].filter(Boolean));

    if (mutatePromise) {
      await mutatePromise.catch(() => {});
    }

    if (mutateError) {
      throw mutateError;
    }
  } catch (err) {
    console.warn('[YANTA Draw] view transition skipped', err);

    /*
      Fallback nur ausführen, wenn mutate noch nicht gestartet wurde.
      Wenn mutatePromise existiert, lief mutate bereits.
    */
    if (!mutatePromise) {
      await mutate?.();
    }
  } finally {
    restoreDrawingTransitionElement(sourceToken);
    restoreDrawingTransitionElement(targetToken);

    // Finale Sicherheit: niemals draw-* transition names im DOM liegen lassen.
    clearDrawingViewTransitionNames(drawingId);
  }
}

function ensureInlineReactMount(inlineHost) {
  let mount = inlineHost.querySelector(':scope > .yanta-draw-react-mount');

  if (!mount) {
    inlineHost.replaceChildren();

    mount = document.createElement('div');
    mount.className = 'yanta-draw-react-mount';

    inlineHost.append(mount);
  }

  return mount;
}

function activateMobileDrawing(embed, { announce = true } = {}) {
  if (!embed || !isMobileDrawUx()) return;

  document.querySelectorAll('.yanta-draw-embed.is-mobile-interactive').forEach((n) => {
    if (n !== embed) n.classList.remove('is-mobile-interactive');
  });

  embed.classList.add('is-active');
  embed.classList.add('is-mobile-interactive');

  const api = inlineApis.get(embed);

  requestAnimationFrame(() => {
    try {
      api?.refresh?.();
    } catch {}
  });

  if (announce) {
    toast('Drawing edit mode · tap Done to scroll normally', 'success');
  }
}

function deactivateMobileDrawing(embed) {
  if (!embed) return;

  embed.classList.remove('is-mobile-interactive');

  const api = inlineApis.get(embed);

  requestAnimationFrame(() => {
    try {
      api?.refresh?.();
    } catch {}
  });
}

function ensureMobileDrawingGate(embed, inlineHost, editable) {
  if (!embed || !inlineHost || inlineHost.dataset.mobileGateBound === '1') return;

  inlineHost.dataset.mobileGateBound = '1';

  const shield = document.createElement('div');
  shield.className = 'yanta-draw-mobile-shield';
  shield.innerHTML = `
    <div class="yanta-draw-mobile-shield-card">
      <div class="yanta-draw-mobile-shield-icon">${lucide(editable ? 'pencil' : 'hand', 18)}</div>
      <div class="yanta-draw-mobile-shield-title">
        ${editable ? 'Tap to edit drawing' : 'Tap to interact'}
      </div>
      <div class="yanta-draw-mobile-shield-hint">
        Swipe here to keep scrolling
      </div>
    </div>
  `;

  let downX = 0;
  let downY = 0;
  let downT = 0;
  let pointerId = null;

  shield.addEventListener('pointerdown', (e) => {
    if (!isMobileDrawUx()) return;

    downX = e.clientX;
    downY = e.clientY;
    downT = performance.now();
    pointerId = e.pointerId;

    // Wichtig:
    // Kein preventDefault() hier.
    // Dadurch bleibt normales vertikales Scrollen möglich.
  }, { passive: true });

  shield.addEventListener('pointerup', (e) => {
    if (!isMobileDrawUx()) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    const dt = performance.now() - downT;

    pointerId = null;

    // Nur echter Tap aktiviert. Scroll-Gesten nicht.
    if (dist > 8 || dt > 450) return;

    e.preventDefault();
    e.stopPropagation();

    activateMobileDrawing(embed);
  }, true);

  shield.addEventListener('click', (e) => {
    if (!isMobileDrawUx()) return;

    e.preventDefault();
    e.stopPropagation();
  }, true);

  inlineHost.append(shield);
}

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
    appState: {},
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

  width: 100%;
  max-width: 100%;
  min-width: 0;
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
  display: none;
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

.yanta-draw-react-mount {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.yanta-draw-mobile-shield,
.yanta-draw-mobile-done {
  display: none;
}

.yanta-draw-is-resizing,
.yanta-draw-is-resizing * {
  cursor: ns-resize !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}

@keyframes yanta-draw-mobile-hint {
  0% {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
    visibility: visible;
  }

  12% {
    opacity: 1;
    transform: translateY(0) scale(1);
    visibility: visible;
  }

  72% {
    opacity: 1;
    transform: translateY(0) scale(1);
    visibility: visible;
  }

  100% {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
    visibility: hidden;
  }
}

@media (pointer: coarse), (max-width: 760px) {
  .yanta-draw-inline-host {
    position: relative;
    touch-action: pan-y;
  }

  /*
    Unsichtbare Tap-Schicht:
    - blockiert nicht die Sicht
    - erlaubt vertikales Scrollen
    - erkennt Tap zum Aktivieren des Drawing-Modus
  */
  .yanta-draw-mobile-shield {
    position: absolute;
    inset: 0;
    z-index: 8;

    display: block;

    background: transparent;
    touch-action: pan-y;

    user-select: none;
    -webkit-user-select: none;
  }

  /*
    Nur der Hinweis ist sichtbar — und nur kurz.
    Danach bleibt die Shield-Fläche transparent aktiv.
  */
  .yanta-draw-mobile-shield-card {
    position: absolute;
    left: 50%;
    bottom: 14px;

    width: max-content;
    max-width: calc(100% - 28px);

    display: flex;
    align-items: center;
    gap: 8px;

    padding: 8px 11px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border));

    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    color: var(--text);

    box-shadow:
      0 10px 28px rgba(0,0,0,0.28),
      0 0 0 1px rgba(255,255,255,0.03) inset;

    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);

    text-align: left;
    pointer-events: none;

    animation: yanta-draw-mobile-hint 1.8s ease forwards;
  }

  .yanta-draw-mobile-shield-icon {
    color: var(--accent);
    width: 22px;
    height: 22px;
    flex: 0 0 22px;

    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .yanta-draw-mobile-shield-title {
    font-size: 12px;
    font-weight: 700;
    line-height: 1.15;
    white-space: nowrap;
  }

  .yanta-draw-mobile-shield-hint {
    display: none;
  }

  .yanta-draw-embed.is-mobile-interactive {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .yanta-draw-embed.is-mobile-interactive .yanta-draw-mobile-shield {
    display: none;
  }

  .yanta-draw-embed.is-mobile-interactive .yanta-draw-inline-host {
    touch-action: none;
  }

  .yanta-draw-mobile-done {
    display: none;
    min-height: 26px;
    padding: 0 10px;
    flex: 0 0 auto;
  }

  .yanta-draw-embed.is-mobile-interactive .yanta-draw-mobile-done {
    display: inline-flex;
  }

  /*
    Auf Mobile: Resize nur bewusst im aktiven Drawing-Modus.
    Sonst bleibt Scrollen zuverlässig.
  */
  .yanta-draw-embed:not(.is-mobile-interactive) .yanta-draw-resize-handle {
    display: none;
  }

  .yanta-draw-resize-handle {
    height: 30px;
    min-height: 30px;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: ns-resize;
  }

  .yanta-draw-resize-handle::before {
    content: "";
    display: block;
    height: 100%;
    margin: 0 auto;
    width: 72px;
    background:
      radial-gradient(circle, var(--text-faint) 1.5px, transparent 2px)
      center / 10px 10px repeat-x;
    opacity: 0.75;
  }
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
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 8px 0;
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
  z-index: 980;
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

.yanta-draw-note-preview.is-dragging {
  user-select: none;
}

.yanta-draw-note-preview-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
  cursor: move;
  touch-action: none;
}

.yanta-draw-note-preview-head button,
.yanta-draw-note-preview-head a,
.yanta-draw-note-preview-head input,
.yanta-draw-note-preview-head textarea,
.yanta-draw-note-preview-head select {
  cursor: pointer;
}

.yanta-draw-note-preview-title {
  min-width: 0;
  flex: 1;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
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

.yanta-draw-note-preview-body .preview .yanta-draw-embed {
  margin: 12px 0;
}

.yanta-draw-note-preview-body .backlinks,
.yanta-draw-note-preview-body .pv-outline {
  display: none !important;
}

/*
  Der normale Wiki-Hover-Tooltip muss über dem Drawing-Note-Preview liegen,
  sonst wird er vom Popover verdeckt.
*/
body > .hover-preview {
  z-index: 1200 !important;
}
/* ============================================================
   Drawing fullscreen toolbar — modern responsive
   ============================================================ */

.yanta-draw-head {
  container-type: inline-size;
}

.yanta-draw-head-btn {
  flex: 0 0 auto;
  min-width: 0;
}

.yanta-draw-head-btn.is-active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-elev));
}

.yanta-draw-btn-label {
  display: inline;
}

.yanta-draw-title {
  flex: 1 1 auto;
  min-width: 0;
  cursor: text;
}

@container (max-width: 560px) {
  .yanta-draw-head {
    gap: 6px;
  }

  .yanta-draw-head-btn {
    width: 40px;
    height: 40px;
    padding: 0 !important;
    justify-content: center;
  }

  .yanta-draw-btn-label {
    display: none !important;
  }

  .yanta-draw-title {
    font-size: 13px;
  }
}

@media (max-width: 760px) {
  .yanta-draw-modal {
    inset: 0;
    background: var(--bg);
  }

  .yanta-draw-head {
    min-height: 52px;
    height: auto;
    gap: 6px;

    padding:
      max(6px, env(safe-area-inset-top))
      max(8px, env(safe-area-inset-right))
      6px
      max(8px, env(safe-area-inset-left));

    border-bottom: 1px solid var(--border);
  }

  .yanta-draw-head-btn {
    width: 40px;
    height: 40px;
    padding: 0 !important;
    justify-content: center;
  }

  .yanta-draw-btn-label {
    display: none !important;
  }

  .yanta-draw-title {
    font-size: 13px;
    font-weight: 850;
  }

  .yanta-draw-body {
    height: auto;
    flex: 1 1 auto;
    min-height: 0;
  }

  .yanta-draw-fullscreen-host {
    height: 100%;
    min-height: 0;
  }
}
/* Drawing export menu must appear above fullscreen drawing modal */
.ctx-menu.yanta-draw-export-menu {
  z-index: 420 !important;
  min-width: 180px;
}

.ctx-menu.yanta-draw-export-menu button {
  min-height: 34px;
}

@media (max-width: 760px) {
  .ctx-menu.yanta-draw-export-menu {
    z-index: 1000 !important;
    min-width: 190px;
  }

  .ctx-menu.yanta-draw-export-menu button {
    min-height: 42px;
    font-size: 14px;
  }
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

function ensureExcalidrawAssetPath() {
  if (!window.EXCALIDRAW_ASSET_PATH) {
    window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
  }
}

async function loadExcalidraw() {
  ensureExcalidrawAssetPath();

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
    viewBackgroundColor,
    currentItemStrokeColor,
    currentItemBackgroundColor,
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

function liveDrawingElements(drawingOrElements) {
  const elements = Array.isArray(drawingOrElements)
    ? drawingOrElements
    : drawingOrElements?.elements || [];

  return elements.filter((el) =>
    el &&
    typeof el === 'object' &&
    el.isDeleted !== true
  );
}

function currentExcalidrawTheme() {
  return document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'light';
}

function canvasSizeOf(drawing) {
  const w = parseInt(drawing?.canvas?.width ?? 760, 10);
  const h = parseInt(drawing?.canvas?.height ?? 420, 10);

  return {
    width: Math.max(240, Math.min(5000, Number.isFinite(w) ? w : 760)),
    height: Math.max(180, Math.min(5000, Number.isFinite(h) ? h : 420)),
  };
}

function drawingWidthMode(drawing) {
  return drawing?.widthMode === 'wide' || drawing?.wide === true
    ? 'wide'
    : 'normal';
}

function initialDataForDrawing(drawing, extra = {}) {
  return {
    elements: drawing?.elements || [],
    appState: cleanAppState(drawing?.appState || {}),
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
      const wide = drawingWidthMode(drawing) === 'wide';

      info.textContent =
        `${width}×${height}` +
        (wide ? ' · wide' : '') +
        ` · ${count} element${count === 1 ? '' : 's'}` +
        (links ? ` · ${links} wiki link${links === 1 ? '' : 's'}` : '');
    }
  }

  const widthBtn = embed.querySelector('[data-draw-action="toggle-width"]');

  if (widthBtn) {
    const wide = drawingWidthMode(drawing) === 'wide';

    widthBtn.title = wide
      ? 'Shrink drawing to text width'
      : 'Expand drawing to pane width';

    widthBtn.setAttribute('aria-pressed', wide ? 'true' : 'false');

    widthBtn.innerHTML = lucide(wide ? 'fold-horizontal' : 'unfold-horizontal', 14);
  }
}

function applyCanvasSize(embed, drawing) {
  const inlineHost = embed.querySelector('.yanta-draw-inline-host');
  if (!inlineHost || !drawing) return;

  const { height } = canvasSizeOf(drawing);
  const wide = drawingWidthMode(drawing) === 'wide';

  // Default: Drawing füllt nur die normale Textspalte.
  // Wide mode: CSS bricht es aus der Textspalte heraus.
  embed.style.width = '100%';
  embed.style.maxWidth = '100%';

  embed.classList.toggle('is-wide', wide);

  // Für Editor-Widget-Wrapper ebenfalls markieren.
  const editorWrap = embed.closest('.yanta-draw-editor-embed');
  if (editorWrap) {
    editorWrap.classList.toggle('is-wide', wide);
  }

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
  // Excalidraw API bevorzugen, falls verfügbar.
  try {
    if (api?.screenToSceneCoords) {
      const p = api.screenToSceneCoords({ clientX, clientY });

      if (
        p &&
        Number.isFinite(Number(p.x)) &&
        Number.isFinite(Number(p.y))
      ) {
        return {
          x: Number(p.x),
          y: Number(p.y),
        };
      }

      // Kompatibilitätsfallback für Builds, die { x, y } erwarten.
      const p2 = api.screenToSceneCoords({ x: clientX, y: clientY });

      if (
        p2 &&
        Number.isFinite(Number(p2.x)) &&
        Number.isFinite(Number(p2.y))
      ) {
        return {
          x: Number(p2.x),
          y: Number(p2.y),
        };
      }
    }
  } catch {}

  /*
    Fallback:
    Wichtig: appState.offsetLeft/offsetTop NICHT zusätzlich zu rect.left/top
    abziehen. Bei Inline-Embeds entspricht offsetLeft/Top oft bereits der
    Canvas-Position; doppeltes Abziehen verschiebt Drops nach oben links.
  */
  const rect =
    container.querySelector?.('.excalidraw')?.getBoundingClientRect?.() ||
    container.getBoundingClientRect();

  const appState = api?.getAppState?.() || {};
  const zoom = Number(appState.zoom?.value ?? appState.zoom ?? 1) || 1;
  const scrollX = Number(appState.scrollX || 0);
  const scrollY = Number(appState.scrollY || 0);

  return {
    x: (clientX - rect.left) / zoom - scrollX,
    y: (clientY - rect.top) / zoom - scrollY,
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

  if (forceText && !preserveText) {
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

function addFilesToExcalidrawApi(api, files = {}) {
  if (!api?.addFiles || !files) return;

  const list = Array.isArray(files)
    ? files
    : Object.values(files);

  const clean = list.filter(Boolean);

  if (!clean.length) return;

  try {
    api.addFiles(clean);
  } catch {}
}

// ------------------------------------------------------------
// Excalidraw scene persistence guards
//
// Excalidraw fires onChange for both real user edits and many programmatic
// updateScene() calls. Programmatic UI-only updates must never be persisted,
// otherwise old snapshots, camera moves or presentation-only changes can
// overwrite user edits.
// ------------------------------------------------------------

const DRAW_API_SAVE_SUPPRESSION = new WeakMap();

function isDrawingApiSaveSuppressed(api) {
  return !!api && DRAW_API_SAVE_SUPPRESSION.has(api);
}

function suppressDrawingApiSave(api, {
  releaseMs = 220,
} = {}) {
  if (!api) return () => {};

  const token = {};
  let released = false;

  DRAW_API_SAVE_SUPPRESSION.set(api, token);

  const release = () => {
    if (released) return;
    released = true;

    if (DRAW_API_SAVE_SUPPRESSION.get(api) === token) {
      DRAW_API_SAVE_SUPPRESSION.delete(api);
    }
  };

  // Excalidraw can emit onChange synchronously, next frame, or shortly after
  // updateScene(). Keep suppression briefly active, but never permanently.
  requestAnimationFrame(() => {
    requestAnimationFrame(release);
  });

  window.setTimeout(release, releaseMs);

  return release;
}

/**
 * Run api.updateScene() without letting the Drawing autosave persist it.
 *
 * Use this for:
 * - Yjs/remote scene hydration
 * - camera moves
 * - selection-only changes
 * - presentation-only visual changes
 *
 * Do NOT use for user-intended mutations unless you persist via setDrawing()
 * yourself in the same code path.
 */
export function runDrawingApiUpdateWithoutSaving(api, updateOrFn, {
  refresh = true,
  releaseMs = 220,
} = {}) {
  if (!api) return false;

  suppressDrawingApiSave(api, {
    releaseMs,
  });

  try {
    if (typeof updateOrFn === 'function') {
      updateOrFn(api);
    } else {
      api.updateScene?.(updateOrFn);
    }

    if (refresh) {
      api.refresh?.();
    }

    return true;
  } catch (err) {
    console.warn('[YANTA Draw] programmatic Excalidraw update failed', err);
    return false;
  }
}

/**
 * Apply persisted/remote Drawing content to an existing Excalidraw instance.
 *
 * Important:
 * We intentionally do NOT replay persisted appState here. appState contains
 * volatile UI state such as activeTool, selectedElementIds, editingElement, etc.
 * Replaying it is what causes tool-button flicker / wrong active-tool display.
 */
function applyPersistedDrawingToApi(api, drawing) {
  if (!api || !drawing) return false;

  // During an active slideshow, slide frames are intentionally hidden
  // (opacity 0, locked). Re-applying the persisted scene would restore their
  // original opacity and make them reappear mid-presentation. Preserve the
  // live hidden state for slide-frame elements in that case.
  const slideshowActive =
    document.body.classList.contains('yanta-slideshow-active');

  let elements = drawing.elements || [];

  if (slideshowActive) {
    let liveById = null;
    try {
      const live =
        api.getSceneElementsIncludingDeleted?.() ||
        api.getSceneElements?.() ||
        [];
      liveById = new Map(live.map((el) => [el.id, el]));
    } catch {}

    if (liveById) {
      elements = elements.map((el) => {
        const live = liveById.get(el?.id);
        // A slide frame currently hidden for presentation stays hidden.
        if (live && live.opacity === 0 && live.locked === true) {
          return {
            ...el,
            opacity: 0,
            locked: true,
          };
        }
        return el;
      });
    }
  }

  return runDrawingApiUpdateWithoutSaving(api, () => {
    addFilesToExcalidrawApi(api, drawing.files);
    api.updateScene({
      elements,
      files: drawing.files || {},
    });
  });
}

function readElementsFromApi(api, fallback = []) {
  try {
    const elements =
      api?.getSceneElementsIncludingDeleted?.() ||
      api?.getSceneElements?.();

    if (Array.isArray(elements)) return elements;
  } catch {}

  return Array.isArray(fallback) ? fallback : [];
}

function readAppStateFromApi(api, fallback = {}) {
  try {
    const appState = api?.getAppState?.();

    if (appState && typeof appState === 'object') {
      return appState;
    }
  } catch {}

  return fallback && typeof fallback === 'object' ? fallback : {};
}

function readFilesFromApi(api, fallback = {}) {
  try {
    const files = api?.getFiles?.();

    if (files && typeof files === 'object') {
      return files;
    }
  } catch {}

  return fallback && typeof fallback === 'object' ? fallback : {};
}

function buildPersistedDrawingSceneFromApi(api, {
  drawingId,
  previous = {},
  fallback = {},
} = {}) {
  const base = previous || fallback || {};

  const elements = readElementsFromApi(api, base.elements || fallback.elements || []);
  const appState = readAppStateFromApi(api, base.appState || fallback.appState || {});
  const files = readFilesFromApi(api, base.files || fallback.files || {});

  return {
    id: drawingId,
    title: base.title || fallback.title || 'Drawing',
    canvas: base.canvas || fallback.canvas || { width: 760, height: 420 },
    elements: cleanStaleSceneWikiData(elements),
    appState: cleanAppState(appState),
    files,
  };
}

function persistCurrentDrawingApiScene({
  api,
  noteId,
  drawingId,
  previous,
  fallback,
  origin,
  lastSigRef,
  afterPersist = null,
} = {}) {
  if (!api || isDrawingApiSaveSuppressed(api)) return false;

  const nextScene = buildPersistedDrawingSceneFromApi(api, {
    drawingId,
    previous,
    fallback,
  });

  const nextSig = sceneSignature(
    nextScene.elements,
    nextScene.appState,
    nextScene.files
  );

  if (lastSigRef && nextSig === lastSigRef.current) {
    return false;
  }

  if (lastSigRef) {
    lastSigRef.current = nextSig;
  }

  setDrawing(noteId, drawingId, nextScene, origin);

  afterPersist?.(nextScene);

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: {
      noteId,
      drawingId,
      reason: 'scene-persisted',
    },
  }));

  return true;
}

function noteVisualColor(note) {
  return safeCssColor(note?.color) ||
    (note?.type === 'list' ? '#a78bfa' : '#6ea8fe');
}

function noteVisualIcon(note) {
  return note?.icon || (note?.type === 'list' ? 'list' : 'file');
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function lucideDataUrl(name, color, size = 24) {
  let svg = lucide(name || 'file', size);

  // SVG soll im Excalidraw-Image die Note-Farbe nutzen.
  svg = svg.replace(
    /<svg /,
    `<svg color="${escapeAttr(color)}" `
  );

  return svgToDataUrl(svg);
}

function makeLinkedElementData(note) {
  return {
    link: noteLink(note.id),
    customData: {
      yanta: {
        wikilink: wikiDataForNote(note),
      },
    },
  };
}

function makeRectElement({
  id = uid(),
  x,
  y,
  width,
  height,
  strokeColor,
  backgroundColor,
  opacity = 18,
  groupIds = [],
  note = null,
}) {
  const linked = note ? makeLinkedElementData(note) : {};

  return {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity,
    groupIds,
    frameId: null,
    roundness: { type: 3 },
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    locked: false,
    ...linked,
  };
}

function makeImageElement({
  id = uid(),
  fileId,
  x,
  y,
  width,
  height,
  groupIds = [],
}) {
  return {
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds,
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    locked: false,
    fileId,
    scale: [1, 1],
    status: 'saved',
    link: null,
    customData: {},
  };
}

function makeLinkedTitleElement({
  note,
  text,
  x,
  y,
  width,
  color,
  groupIds = [],
}) {
  const el = makeFallbackTextElement(text, x, y, null);

  return {
    ...el,
    text,
    rawText: text,
    originalText: text,
    width,
    height: 30,
    fontSize: 20,
    strokeColor: color,
    textAlign: 'left',
    verticalAlign: 'top',
    groupIds,

    // Wichtig: Text selbst ist NICHT verlinkt.
    link: null,
    customData: {},
  };
}

async function makeNoteCardElements(note, x, y) {
  const title = note.title || 'Untitled';
  const color = noteVisualColor(note);
  const icon = noteVisualIcon(note);

  const groupId = uid();
  const fileId = uid();

  const cardW = Math.max(180, Math.min(420, title.length * 12 + 86));
  const cardH = 58;

  const iconSize = 22;

  const iconFile = {
    id: fileId,
    dataURL: lucideDataUrl(icon, color, 24),
    mimeType: 'image/svg+xml',
    created: Date.now(),
    lastRetrieved: Date.now(),
  };

  const card = makeRectElement({
    x,
    y,
    width: cardW,
    height: cardH,
    strokeColor: color,
    backgroundColor: color,
    opacity: 16,
    groupIds: [groupId],
    note,
  });

  const iconEl = makeImageElement({
    fileId,
    x: x + 16,
    y: y + 18,
    width: iconSize,
    height: iconSize,
    groupIds: [groupId],
    note,
  });

  const titleEl = makeLinkedTitleElement({
    note,
    text: title,
    x: x + 50,
    y: y + 17,
    width: cardW - 66,
    color,
    groupIds: [groupId],
  });

  return {
    elements: [card, iconEl, titleEl],
    files: {
      [fileId]: iconFile,
    },
    selectedId: card.id,
    groupId,
    elementIds: [card.id, iconEl.id, titleEl.id],
  };
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

function directWikiTargetInElement(el) {
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

function firstWikiTargetInElement(el, api = null) {
  const direct = directWikiTargetInElement(el);
  if (direct) return direct;

  const gid = groupIdForElement(el);
  if (!gid || !api) return null;

  const elements =
    api.getSceneElementsIncludingDeleted?.() ||
    api.getSceneElements?.() ||
    [];

  // Wenn Text/Icon getroffen wurde, suche in derselben Gruppe nach dem
  // eigentlichen Link-Träger, also normalerweise dem Hintergrund-Rectangle.
  for (const candidate of elements) {
    if (!candidate || candidate.isDeleted) continue;

    const ids = Array.isArray(candidate.groupIds)
      ? candidate.groupIds
      : [];

    if (!ids.includes(gid)) continue;

    const target = directWikiTargetInElement(candidate);
    if (target) return target;
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

function elementFromLinkTarget(target) {
  return target?.el || target;
}

function groupIdForElement(el) {
  const ids = Array.isArray(el?.groupIds) ? el.groupIds : [];
  if (!ids.length) return null;

  // Bei verschachtelten Gruppen nehmen wir die äußerste/letzte Gruppe.
  return ids[ids.length - 1];
}

function representativeElementForGroup(elements, groupId) {
  const members = elements.filter((el) =>
    el &&
    !el.isDeleted &&
    Array.isArray(el.groupIds) &&
    el.groupIds.includes(groupId)
  );

  if (!members.length) return null;

  // Topmost zuerst prüfen.
  const topFirst = [...members].reverse();

  // Bevorzugt ein „Container“-Element statt Text,
  // damit Text nicht zu [[Note]] überschrieben wird.
  const preferredTypes = new Set([
    'rectangle',
    'ellipse',
    'diamond',
    'image',
    'frame',
    'embeddable',
    'freedraw',
  ]);

  return (
    topFirst.find((el) => preferredTypes.has(el.type)) ||
    topFirst.find((el) => el.type !== 'text') ||
    topFirst[0]
  );
}

/**
 * Link-Targets sind gruppenbewusst:
 * - einzelne Elemente -> das Element
 * - ausgewählte Gruppe -> genau EIN Träger-Element der Gruppe
 *
 * Excalidraw hat kein echtes Group-Element, daher speichern wir den Link
 * auf einem Repräsentanten der Gruppe.
 */
function selectionLinkTargets(api, hitEl = null) {
  const elements =
    api?.getSceneElementsIncludingDeleted?.() ||
    api?.getSceneElements?.() ||
    [];

  const byId = new Map(
    elements
      .filter((el) => el && !el.isDeleted)
      .map((el) => [el.id, el])
  );

  const { elementIds, groupIds } = selectedElementAndGroupIds(api);
  const out = new Map();

  const add = (el, opts = {}) => {
    if (!el || el.isDeleted) return;

    const prev = out.get(el.id);

    // Group-carrier gewinnt gegenüber normalem Elementtarget.
    if (!prev || opts.isGroupCarrier) {
      out.set(el.id, {
        el,
        isGroupCarrier: !!opts.isGroupCarrier,
        groupId: opts.groupId || null,
      });
    }
  };

  // Keine aktive Selection: Hit-Element verwenden.
  // Wenn das Hit-Element Teil einer Gruppe ist, linke die Gruppe über
  // ein repräsentatives Element, nicht das konkrete Kind.
  if (!elementIds.size && !groupIds.size && hitEl) {
    const gid = groupIdForElement(hitEl);

    if (gid) {
      add(representativeElementForGroup(elements, gid), {
        isGroupCarrier: true,
        groupId: gid,
      });
    } else {
      add(hitEl);
    }

    return [...out.values()];
  }

  // Ausgewählte Gruppen: je Gruppe genau ein Träger-Element.
  for (const gid of groupIds) {
    add(representativeElementForGroup(elements, gid), {
      isGroupCarrier: true,
      groupId: gid,
    });
  }

  // Einzelne ausgewählte Elemente, aber nicht nochmal Kinder bereits
  // ausgewählter Gruppen aufnehmen.
  for (const id of elementIds) {
    const el = byId.get(id);
    if (!el || el.isDeleted) continue;

    const belongsToSelectedGroup =
      Array.isArray(el.groupIds) &&
      el.groupIds.some((gid) => groupIds.has(gid));

    if (belongsToSelectedGroup) continue;

    add(el);
  }

  return [...out.values()];
}

// Kompatibel halten für Stellen, die weiterhin reine Elemente brauchen.
function selectionTargetElements(api, hitEl = null) {
  return selectionLinkTargets(api, hitEl).map((target) => target.el);
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
  const targets = selectionLinkTargets(api, hit);

  let nextElements;
  let selectedId = null;

  if (targets.length) {
    const targetById = new Map(targets.map((target) => [target.el.id, target]));
    selectedId = targets[0].el.id;

    nextElements = elements.map((el) => {
      const target = targetById.get(el.id);

      return target
        ? patchElementWithWikiLink(el, note, {
            // Gruppen-Link niemals sichtbaren Text zu [[Note]] überschreiben.
            preserveText: target.isGroupCarrier,
          })
        : el;
    });
  } else {
    const card = await makeNoteCardElements(note, p.x, p.y);

    selectedId = card.selectedId;

    addFilesToExcalidrawApi(api, card.files);

    nextElements = [...elements, ...card.elements];

    const existingFiles = api.getFiles?.() || {};

    api.updateScene({
      elements: nextElements,
      files: {
        ...existingFiles,
        ...card.files,
      },
      appState: selectedId
        ? {
            selectedElementIds: Object.fromEntries(
              (card.elementIds || [selectedId]).map((id) => [id, true])
            ),
            selectedGroupIds: card.groupId
              ? { [card.groupId]: true }
              : undefined,
          }
        : undefined,
    });

    api.refresh?.();
    return true;
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

  const targets = selectionLinkTargets(api, null);

  if (!targets.length) {
    const appState = api.getAppState?.() || {};
    const x = -(appState.scrollX || 0) + 40;
    const y = -(appState.scrollY || 0) + 40;

    const card = await makeNoteCardElements(note, x, y);

    addFilesToExcalidrawApi(api, card.files);

    const existingFiles = api.getFiles?.() || {};

    api.updateScene({
      elements: [...elements, ...card.elements],
      files: {
        ...existingFiles,
        ...card.files,
      },
      appState: {
        selectedElementIds: Object.fromEntries(
          (card.elementIds || [card.selectedId]).map((id) => [id, true])
        ),
        selectedGroupIds: card.groupId
          ? { [card.groupId]: true }
          : undefined,
      },
    });

    api.refresh?.();
    return true;
  }

  const targetById = new Map(targets.map((target) => [target.el.id, target]));

  api.updateScene({
    elements: elements.map((el) => {
      const target = targetById.get(el.id);

      return target
        ? patchElementWithWikiLink(el, note, {
            preserveText: target.isGroupCarrier,
          })
        : el;
    }),
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

  const targetById = new Map();

  for (const target of targets) {
    const el = elementFromLinkTarget(target);
    if (!el) continue;

    targetById.set(el.id, {
      el,
      isGroupCarrier: !!target?.isGroupCarrier,
    });
  }

  api.updateScene({
    elements: elements.map((el) => {
      const target = targetById.get(el.id);

      return target
        ? patchElementWithWikiLink(el, note, {
            preserveText: target.isGroupCarrier,
          })
        : el;
    }),
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

  const targetIds = new Set(
    targets
      .map(elementFromLinkTarget)
      .filter(Boolean)
      .map((el) => el.id)
  );

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

    if (ok) toast(`Linked ${note.title || 'Untitled'}`, 'success');
  }, true);
}

const drawNativeContextState = new WeakMap();

function firstLinkedNoteId(targets = []) {
  for (const target of targets) {
    const el = elementFromLinkTarget(target);
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
  const hasAnyWikiLink = ctx.targets.some((target) =>
    elementHasWikiLink(elementFromLinkTarget(target))
  );

  const linkBtn = makeNativeContextButton({
    icon: 'link',
    label: 'YANTA: Link note…',
    onClick: async () => {
      const note = await openNoteReferencePicker();
      if (!note) return;

      if (linkSpecificElementsToNote(ctx.api, ctx.targets, note)) {
        toast(`Linked ${note.title || 'Untitled'}`, 'success');
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
    const targets = selectionLinkTargets(api, hit);

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
    const target = firstWikiTargetInElement(el, api);

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

function clampFixedPosition(elm, left, top) {
  const r = elm.getBoundingClientRect();
  const margin = 10;

  const maxLeft = Math.max(margin, window.innerWidth - r.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - r.height - margin);

  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top)),
  };
}

function hideNotePreviewPopover({ unmount = true } = {}) {
  if (!notePreviewEl) return;

  if (unmount) {
    try {
      unmountDrawEmbeds(notePreviewEl);
    } catch {}
  }

  notePreviewEl.hidden = true;
}

function bindNotePreviewDrag(pop) {
  if (!pop || pop.dataset.dragBound === '1') return;
  pop.dataset.dragBound = '1';

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let pointerId = null;

  const stopDrag = () => {
    if (!dragging) return;

    dragging = false;
    pointerId = null;
    pop.classList.remove('is-dragging');

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  };

  const onMove = (e) => {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    e.preventDefault();

    const next = clampFixedPosition(
      pop,
      startLeft + (e.clientX - startX),
      startTop + (e.clientY - startY)
    );

    pop.style.left = next.left + 'px';
    pop.style.top = next.top + 'px';
  };

  const onUp = (e) => {
    if (pointerId != null && e.pointerId !== pointerId) return;
    stopDrag();
  };

  pop.addEventListener('pointerdown', (e) => {
    const head = e.target.closest?.('.yanta-draw-note-preview-head');
    if (!head || !pop.contains(head)) return;

    // Buttons/Inputs im Header sollen klickbar bleiben.
    if (e.target.closest?.('button, a, input, textarea, select, [contenteditable="true"]')) {
      return;
    }

    if (e.button != null && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const r = pop.getBoundingClientRect();

    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = r.left;
    startTop = r.top;

    pop.classList.add('is-dragging');

    try {
      pop.setPointerCapture?.(e.pointerId);
    } catch {}

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }, true);
}

function bindNotePreviewContentInteractions(pop) {
  if (!pop || pop.dataset.contentBound === '1') return;
  pop.dataset.contentBound = '1';

  pop.addEventListener('click', async (e) => {
    const wiki = e.target.closest?.('a.wiki-link');

    if (wiki && pop.contains(wiki)) {
      e.preventDefault();
      e.stopPropagation();

      const target = wiki.dataset.wiki || wiki.textContent || '';
      const noteId = wiki.dataset.noteId || '';

      hideNotePreviewPopover();

      if (noteId && state.notes.has(noteId)) {
        await openNote(noteId);
        return;
      }

      if (target.trim()) {
        window.dispatchEvent(new CustomEvent('yanta-follow-wiki', {
          detail: { target: target.trim() },
        }));
      }

      return;
    }

    // Normale externe Markdown-Links dürfen normal funktionieren.
  }, true);
}

function ensureNotePreviewPopover() {
  injectDrawCss();

  if (notePreviewEl) return notePreviewEl;

  notePreviewEl = document.createElement('div');
  notePreviewEl.className = 'yanta-draw-note-preview';
  notePreviewEl.hidden = true;
  document.body.append(notePreviewEl);

  bindNotePreviewDrag(notePreviewEl);
  bindNotePreviewContentInteractions(notePreviewEl);

  document.addEventListener('mousedown', (e) => {
    if (!notePreviewEl || notePreviewEl.hidden) return;

    if (notePreviewEl.contains(e.target)) return;

    // Der normale Wikilink-Hover-Tooltip soll benutzbar bleiben.
    const hp = document.getElementById('hoverPreview');
    if (hp && hp.contains(e.target)) return;

    // Andere Drawing-UI nicht sofort schließen.
    if (e.target.closest?.('.yanta-draw-note-picker, .yanta-draw-autocomplete')) return;

    hideNotePreviewPopover();
  }, true);

  window.addEventListener('resize', () => {
    if (!notePreviewEl || notePreviewEl.hidden) return;

    const r = notePreviewEl.getBoundingClientRect();
    const next = clampFixedPosition(notePreviewEl, r.left, r.top);

    notePreviewEl.style.left = next.left + 'px';
    notePreviewEl.style.top = next.top + 'px';
  });

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

    const next = clampFixedPosition(elm, left, top);

    elm.style.left = next.left + 'px';
    elm.style.top = next.top + 'px';
  });
}

function showNotePreview(noteId, clientX, clientY) {
  const note = state.notes.get(noteId);
  if (!note) return;

  const pop = ensureNotePreviewPopover();

  // Wichtig: vorherige React/Excalidraw-Embeds sauber entfernen.
  try {
    unmountDrawEmbeds(pop);
  } catch {}

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

  // Nach innerHTML erneut binden, weil DOM neu aufgebaut wurde.
  bindNotePreviewDrag(pop);
  bindNotePreviewContentInteractions(pop);

  pop.querySelector('[data-close]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideNotePreviewPopover();
  });

  pop.querySelector('[data-open]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    hideNotePreviewPopover();

    await openNote(noteId);
  });

  /*
    Kritisch:
    renderPreview() erzeugt draw:// Embeds mit state.currentNoteId.
    Im Note-Preview-Popover soll aber die angezeigte Note der Kontext sein.
    Sonst werden Drawings aus der Preview-Note falsch oder gar nicht gefunden.
  */
  for (const embed of pop.querySelectorAll('.yanta-draw-embed[data-draw-id]')) {
    embed.setAttribute('data-note-id', noteId);
    embed.setAttribute('data-draw-surface', 'preview');
    embed.classList.remove('editor-surface');
    embed.classList.add('preview-surface');
  }

  positionFloatingElement(pop, clientX, clientY);

  /*
    Drawings im Popover hydrieren.
    Das muss nach dem Einfügen in den DOM passieren, sonst bleibt
    .yanta-draw-inline-host leer bzw. Excalidraw misst falsche Größen.
  */
  requestAnimationFrame(() => {
    hydrateDrawEmbeds(pop).then(() => {
      requestAnimationFrame(() => {
        refreshDrawEmbeds(pop);
      });
    }).catch((err) => {
      console.warn('Could not hydrate drawings in note preview', err);
    });
  });
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

    let pointerDown = null;
    let suppressPickerClickUntil = 0;

    list.addEventListener('pointerdown', (e) => {
      pointerDown = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
    }, {
      passive: true,
    });

    list.addEventListener('pointermove', (e) => {
      if (!pointerDown || pointerDown.id !== e.pointerId) return;

      const dist = Math.hypot(
        e.clientX - pointerDown.x,
        e.clientY - pointerDown.y
      );

      if (dist > 8) {
        pointerDown.moved = true;
        suppressPickerClickUntil = performance.now() + 450;
      }
    }, {
      passive: true,
    });

    list.addEventListener('pointerup', (e) => {
      if (!pointerDown || pointerDown.id !== e.pointerId) return;

      const dist = Math.hypot(
        e.clientX - pointerDown.x,
        e.clientY - pointerDown.y
      );

      if (dist > 8 || pointerDown.moved) {
        suppressPickerClickUntil = performance.now() + 450;
      }

      pointerDown = null;
    }, {
      passive: true,
    });

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
        btn.dataset.index = String(i);

        btn.innerHTML = `
          ${lucide(note.icon || (note.type === 'list' ? 'list' : 'file'), 14)}
          <span>${escapeHtml(note.title || 'Untitled')}</span>
          <span class="yanta-draw-note-picker-meta">${escapeHtml(state.folders.get(note.folderId)?.name || '')}</span>
        `;

        const accept = (e) => {
          if (performance.now() < suppressPickerClickUntil) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }

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

        /*
          Wichtig:
          Kein pointerdown-accept mehr.
          Sonst wird beim Touch-Scroll direkt eine Note ausgewählt.
        */
        btn.addEventListener('click', accept, true);

        list.append(btn);
      });
    };

    search.addEventListener('input', () => {
      active = 0;
      render();
    });

    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        overlay.remove();
        resolve(null);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        active = Math.min(items.length - 1, active + 1);
        render();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.max(0, active - 1);
        render();
        return;
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

    setTimeout(() => {
      search.focus();
    }, 0);
  });
}

function setModalDrawingTitle(drawingId, drawing) {
  if (!titleEl) return;

  const title = drawing?.title || 'Drawing';

  titleEl.textContent = title;
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
      deletePersistedThumb(`${noteId}:${drawingId}`);
      thumbnailCache.delete(`${noteId}:${drawingId}`);
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
    });
  });

  const spacer = document.createElement('span');
  spacer.style.flex = '1';

  const slidesBtn = document.createElement('button');
    slidesBtn.className = 'btn yanta-draw-head-btn';
    slidesBtn.title = 'Slides';
    slidesBtn.setAttribute('data-draw-head-slides', '1');
    slidesBtn.setAttribute('aria-pressed', 'false');
    slidesBtn.innerHTML = `
      ${lucide('presentation', 14)}
      <span class="yanta-draw-btn-label">Slides</span>
    `;

    slidesBtn.addEventListener('click', () => {
      if (!active.noteId || !active.drawingId) return;

      window.dispatchEvent(new CustomEvent('yanta-toggle-fullscreen-slides', {
        detail: {
          noteId: active.noteId,
          drawingId: active.drawingId,
        },
      }));
    });

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn yanta-draw-head-btn';
  exportBtn.title = 'Download drawing';
  exportBtn.innerHTML = `
    ${lucide('download', 14)}
    <span class="yanta-draw-btn-label">Download</span>
  `;

  exportBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!active.noteId || !active.drawingId) return;

    clearDrawingViewTransitionNames(active.drawingId);

    openDrawingExportMenu(exportBtn, active.noteId, active.drawingId);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn danger yanta-draw-head-btn';
  deleteBtn.title = 'Delete drawing';
  deleteBtn.innerHTML = `
    ${lucide('trash', 14)}
    <span class="yanta-draw-btn-label">Delete</span>
  `;

  deleteBtn.addEventListener('click', async () => {
    if (!active.noteId || !active.drawingId) return;

    confirmDeleteDrawing(active.noteId, active.drawingId, {
      anchor: deleteBtn,
      onDeleted: async () => {
        await closeDrawModal({
          transition: true,
        });
      },
    });
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = lucide('x', 16);

  closeBtn.addEventListener('click', () => {
    closeDrawModal({
      transition: true,
    });
  });

  host = document.createElement('div');
  host.className = 'yanta-draw-body';

  head.append(titleEl, spacer, slidesBtn, exportBtn, deleteBtn, closeBtn);
  modal.append(head, host);
  document.body.append(modal);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) {
      closeDrawModal({
        transition: true,
      });
    }
  });
}

export async function createDrawingAndInsert({
  openFullscreen = isMobileDrawUx(),
} = {}) {
  if (!state.currentNoteId) {
    toast('Open a note first', 'error');
    return;
  }

  const noteId = state.currentNoteId;
  const drawingId = uid();

  const emptyScene = {
    id: drawingId,
    title: 'Drawing',
    canvas: {
      width: 760,
      height: 420,
    },
    elements: [],
    appState: {},
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

  if (openFullscreen) {
    await nextFrame();
    await nextFrame();

    await Promise.allSettled([
      loadReact(),
      loadExcalidraw(),
    ]);

    openDrawModal(drawingId, noteId, {
      initialTool: 'freedraw',
      transition: false,
    }).catch((err) => {
      console.error('[YANTA Draw] could not open new drawing fullscreen', err);
      toast('Could not open drawing', 'error');
    });
  }
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
  let pointerId = null;

  const cleanupDrag = () => {
    dragging = false;
    pointerId = null;

    document.documentElement.classList.remove('yanta-draw-is-resizing');

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  };

  const onMove = (e) => {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    e.preventDefault();
    e.stopPropagation();

    const nextH = Math.max(180, Math.min(5000, startH + (e.clientY - startY)));

    inlineHost.style.height = Math.round(nextH) + 'px';

    const api = inlineApis.get(embed);

    try {
      api?.refresh?.();
    } catch {}
  };

  const onUp = (e) => {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    e?.preventDefault?.();
    e?.stopPropagation?.();

    try {
      handle.releasePointerCapture?.(pointerId);
    } catch {}

    cleanupDrag();

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

    if (isMobileDrawUx()) {
      activateMobileDrawing(embed, { announce: false });
    }

    dragging = true;
    pointerId = e.pointerId;
    startY = e.clientY;
    startH = inlineHost.getBoundingClientRect().height;

    document.documentElement.classList.add('yanta-draw-is-resizing');

    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {}

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }, true);

  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const current = getDrawing(sourceNoteId, drawingId);
    if (!current) return;

    const oldSize = canvasSizeOf(current);
    const nextHeight = 420;

    inlineHost.style.height = nextHeight + 'px';

    updateDrawingMeta(sourceNoteId, drawingId, {
      canvas: {
        width: oldSize.width,
        height: nextHeight,
      },
    }, 'draw-resize-reset');

    window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
      detail: { noteId: sourceNoteId, drawingId },
    }));

    toast('Drawing height reset', 'success');
  });
}

async function mountInlineDrawing(embed, sourceNoteId, drawingId, drawing) {
  const inlineHost = embed.querySelector('.yanta-draw-inline-host');
  const linksHost = embed.querySelector('.yanta-draw-links');

  if (!inlineHost) return;

  const reactMount = ensureInlineReactMount(inlineHost);

  const surface = embed.getAttribute('data-draw-surface') || 'preview';
  const editable = surface === 'editor';

  ensureMobileDrawingGate(embed, inlineHost, editable);

  embed.setAttribute('data-note-id', sourceNoteId);

  updateEmbedFromDrawing(embed, drawing);
  bindResizeHandle(embed, sourceNoteId, drawingId);

  const { React, ReactDOM } = await loadReact();
  const { Excalidraw } = await loadExcalidraw();

  if (inlineRoots.has(inlineHost)) {
    updateEmbedFromDrawing(embed, drawing);
    return;
  }

  const root = ReactDOM.createRoot(reactMount);
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
      return () => {
        clearTimeout(saveTimerRef.current);
      };
    }, []);

    React.useEffect(() => {
      const entry = getNoteDoc(sourceNoteId);
      const drawings = entry.doc.getMap('drawings');

      const observer = (event) => {
        if (!event.keysChanged.has(drawingId)) return;
        if (event.transaction.origin === localOriginRef.current) return;

        const next = getDrawing(sourceNoteId, drawingId);
        if (!next) return;

        // A remote/external scene arrived. Any pending local debounced save was
        // based on older data and must not be allowed to write back afterwards.
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = 0;

        updateEmbedFromDrawing(embed, next);
        setLinks(extractWikiTargetsFromScene(next));
        lastSigRef.current = drawingSignature(next);

        if (apiRef.current) {
          applyPersistedDrawingToApi(apiRef.current, next);
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
        setTheme(currentExcalidrawTheme());

        requestAnimationFrame(() => {
          try {
            apiRef.current?.refresh?.();
          } catch {}
        });
      };

      window.addEventListener('yanta-theme-change', update);

      return () => {
        window.removeEventListener('yanta-theme-change', update);
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

      const api = apiRef.current;

      if (suppressChangeRef.current || isDrawingApiSaveSuppressed(api)) {
        return;
      }

      if (!didInitialChangeRef.current) {
        didInitialChangeRef.current = true;
        return;
      }

      const incomingElements = cleanStaleSceneWikiData(elements || []);
      const incomingAppState = cleanAppState(appState);
      const incomingSig = sceneSignature(incomingElements, incomingAppState, files);

      if (incomingSig === lastSigRef.current) return;

      clearTimeout(saveTimerRef.current);

      saveTimerRef.current = window.setTimeout(() => {
        const liveApi = apiRef.current;

        if (!liveApi || isDrawingApiSaveSuppressed(liveApi)) {
          return;
        }

        const prev = getDrawing(sourceNoteId, drawingId) || drawing;

        persistCurrentDrawingApiScene({
          api: liveApi,
          noteId: sourceNoteId,
          drawingId,
          previous: prev,
          fallback: drawing,
          origin: localOriginRef.current,
          lastSigRef,
          afterPersist: (nextScene) => {
            updateEmbedFromDrawing(embed, nextScene);
            setLinks(extractWikiTargetsFromScene(nextScene));
          },
        });
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

        dispatchDrawApiReadyDeferred({
          noteId: sourceNoteId,
          drawingId,
          api,
          embed,
          surface,
        });

        addFilesToExcalidrawApi(api, drawing.files);

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
        if (!n.contains(e.target)) {
          n.classList.remove('is-active');
          n.classList.remove('is-mobile-interactive');
        }
      });
    }, true);

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;

      document.querySelectorAll('.yanta-draw-embed.is-mobile-interactive').forEach((n) => {
        deactivateMobileDrawing(n);
      });
    });
  }

  embed.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('[data-draw-action]');
    const title = e.target.closest?.('[data-draw-title]');

    if (!btn && !title) return;

    const action = btn?.getAttribute('data-draw-action') || '';

    if (action === 'mobile-done') {
      e.preventDefault();
      e.stopPropagation();

      deactivateMobileDrawing(embed);
      return;
    }

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

    if (action === 'link-note') {
      const api = inlineApis.get(embed);
      const note = await openNoteReferencePicker();

      if (!note) return;

      if (!api) {
        toast('Drawing is not ready yet', 'error');
        return;
      }

      if (await linkSelectedElementsToNote(api, note)) {
        toast(`Linked ${note.title || 'Untitled'}`, 'success');
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

    if (action === 'toggle-width') {
      const current = hit.drawing;
      const wide = drawingWidthMode(current) === 'wide';

      updateDrawingMeta(hit.noteId, drawingId, {
        widthMode: wide ? 'normal' : 'wide',
      }, 'draw-width-mode');

      window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
        detail: { noteId: hit.noteId, drawingId },
      }));

      toast(
        wide
          ? 'Drawing width: text column'
          : 'Drawing width: full pane',
        'success'
      );

      return;
    }

    if (action === 'fullscreen') {
      /*
        Vorladen vor der Transition.
        Dadurch ist openDrawModal() im Transition-Callback schnell
        und kann den Fullscreen-Host synchron erzeugen.
      */
      await Promise.allSettled([
        loadReact(),
        loadExcalidraw(),
        getNoteDoc(hit.noteId).ready,
      ]);

      await withDrawingViewTransition(
        drawingId,
        () => {
          openDrawModal(drawingId, hit.noteId, {
            transition: false,
            preparedHit: hit,
          }).catch((err) => {
            console.error('[YANTA Draw] could not open fullscreen drawing', err);
            toast('Could not open drawing', 'error');
          });
        },
        {
          source: embed,
          targetGetter: () => document.querySelector('.yanta-draw-fullscreen-host'),
        }
      );

      return;
    }

    if (action === 'export') {
      openDrawingExportMenu(btn, hit.noteId, drawingId);
      return;
    }

    if (action === 'delete') {
      confirmDeleteDrawing(hit.noteId, drawingId, {
        anchor: btn,
      });
    }
  });
}

function setFullscreenSlidesButtonActive(open) {
  const btn = document.querySelector('[data-draw-head-slides]');
  if (!btn) return;

  btn.setAttribute('aria-pressed', open ? 'true' : 'false');
  btn.classList.toggle('is-active', !!open);
}

window.addEventListener('yanta-fullscreen-slides-visibility', (e) => {
  setFullscreenSlidesButtonActive(e.detail?.open === true);
});

export async function openDrawModal(
  drawingId,
  noteId = state.currentNoteId,
  {
    initialTool = null,
    transition = true,
    transitionFrom = null,
    preparedHit = null,
    fromHistory = false,
  } = {}
) {
  if (!drawingId) return;

  ensureModal();

  /*
    Wichtig für View Transition:
    Wenn preparedHit übergeben wird, darf hier vor dem Erzeugen des
    Fullscreen-Hosts KEIN await passieren. Sonst existiert das Target
    im startViewTransition-updateCallback noch nicht.
  */
  const hit = preparedHit || await resolveDrawingRefAsync(drawingId, noteId);

  if (!hit) {
    toast(`Drawing not found: draw://${drawingId}`, 'error');
    return;
  }

  const sourceNoteId = hit.noteId;
  const current = hit.drawing;

  const shouldSelectInitialTool =
    initialTool &&
    Array.isArray(current.elements) &&
    current.elements.filter((el) => el && !el.isDeleted).length === 0;

  const entry = getNoteDoc(sourceNoteId);

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

  const wasClosed = modal.hidden !== false;

  modal.hidden = false;

  registerDrawOverlayRoute();

  if (!fromHistory && wasClosed) {
    pushOverlayState('draw-fullscreen', {
      drawingId,
      noteId: sourceNoteId,
    });
  }

  /*
    Fullscreen-Host SYNCHRON erzeugen.
    Genau dieses Element braucht die View Transition als neues Target.
  */
  const fullscreenHost = document.createElement('div');
  fullscreenHost.className = 'yanta-draw-fullscreen-host';
  host.append(fullscreenHost);

  try {
    fullscreenHost.getBoundingClientRect();
  } catch {}

  /*
    Ab hier sind awaits okay, weil das Transition-Target bereits im DOM ist.
  */
  await entry.ready;

  const [
    { React, ReactDOM },
    { Excalidraw },
  ] = await Promise.all([
    loadReact(),
    loadExcalidraw(),
  ]);

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
      return () => {
        clearTimeout(saveTimerRef.current);
      };
    }, []);

    React.useEffect(() => {
      const observer = (event) => {
        if (!event.keysChanged.has(drawingId)) return;
        if (event.transaction.origin === localOriginRef.current) return;

        const next = getDrawing(sourceNoteId, drawingId);
        if (!next) return;

        // External scene wins. Cancel stale local debounced writes.
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = 0;

        setModalDrawingTitle(drawingId, next);
        lastSigRef.current = drawingSignature(next);

        if (apiRef.current) {
          applyPersistedDrawingToApi(apiRef.current, next);
        }
      };

      drawings.observe(observer);

      let unobserved = false;

      const cleanupObserver = () => {
        if (unobserved) return;

        unobserved = true;

        try {
          drawings.unobserve(observer);
        } catch {}
      };

      active.unobserve = cleanupObserver;

      return cleanupObserver;
    }, []);

    React.useEffect(() => {
      const update = () => {
        setTheme(currentExcalidrawTheme());

        requestAnimationFrame(() => {
          try {
            apiRef.current?.refresh?.();
          } catch {}
        });
      };

      window.addEventListener('yanta-theme-change', update);

      return () => {
        window.removeEventListener('yanta-theme-change', update);
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
      const api = apiRef.current;

      if (suppressChangeRef.current || isDrawingApiSaveSuppressed(api)) {
        return;
      }

      if (!didInitialChangeRef.current) {
        didInitialChangeRef.current = true;
        return;
      }

      const incomingElements = cleanStaleSceneWikiData(elements || []);
      const incomingAppState = cleanAppState(appState);
      const incomingSig = sceneSignature(incomingElements, incomingAppState, files);

      if (incomingSig === lastSigRef.current) return;

      clearTimeout(saveTimerRef.current);

      saveTimerRef.current = window.setTimeout(() => {
        const liveApi = apiRef.current;

        if (!liveApi || isDrawingApiSaveSuppressed(liveApi)) {
          return;
        }

        const prev = getDrawing(sourceNoteId, drawingId) || current;

        persistCurrentDrawingApiScene({
          api: liveApi,
          noteId: sourceNoteId,
          drawingId,
          previous: prev,
          fallback: current,
          origin: localOriginRef.current,
          lastSigRef,
        });
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
        {
          ...excalidrawLibraryInitialData(),

          appState: {
            ...cleanAppState(current.appState || {}),

            ...(shouldSelectInitialTool
              ? {
                  activeTool: {
                    type: initialTool,
                    locked: false,
                  },
                }
              : {}),
          },
        }
      ),
      theme,
      name: current.title || 'Drawing',

      excalidrawAPI: (api) => {
        apiRef.current = api;
        active.api = api;

        dispatchDrawApiReadyDeferred({
          noteId: sourceNoteId,
          drawingId,
          api,
          embed: null,
          surface: 'fullscreen',
        });
        
        addFilesToExcalidrawApi(api, current.files);

        if (shouldSelectInitialTool) {
          requestAnimationFrame(() => {
            try {
              api.setActiveTool?.({
                type: initialTool,
                locked: false,
              });
            } catch {}
          });
        }

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

function closeDrawModalRaw() {
  if (!modal) return;

  const closingDrawingId = active.drawingId;
  const closingNoteId = active.noteId;

  hideNotePreviewPopover();

  modal.hidden = true;

  if (active.unobserve) {
    const unobserve = active.unobserve;
    active.unobserve = null;
    unobserve();
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

  window.dispatchEvent(new CustomEvent('yanta-draw-fullscreen-closed', {
    detail: {
      noteId: closingNoteId,
      drawingId: closingDrawingId,
    },
  }));

  active = {
    noteId: null,
    drawingId: null,
    api: null,
    unobserve: null,
  };
}

export async function closeDrawModal({
  transition = true,
  fromHistory = false,
} = {}) {
  if (!modal) return;

  if (!fromHistory && drawFullscreenIsOpen()) {
    closeTopOverlay(() => {
      closeDrawModal({
        transition,
        fromHistory: true,
      });
    });

    return;
  }

  const drawingId = active.drawingId;
  const source = document.querySelector('.yanta-draw-fullscreen-host');

  if (!transition || !drawingId) {
    clearDrawingViewTransitionNames(drawingId);
    closeDrawModalRaw();
    return;
  }

  /*
    Wichtig:
    Innerhalb der View-Transition nur synchron den DOM-Zustand wechseln.
    Kein await nextFrame() im startViewTransition update callback.
  */
  await withDrawingViewTransition(
    drawingId,
    () => {
      closeDrawModalRaw();
    },
    {
      source,
      targetGetter: () => findInlineDrawEmbed(drawingId),
    }
  );

  /*
    Async Nacharbeiten NACH der Transition.
  */
  await nextFrame();

  refreshDrawEmbeds(document);
  clearDrawingViewTransitionNames(drawingId);
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

      // YANTA Slides extension.
      // Kept under yanta.* so ordinary Excalidraw importers can ignore it.
      slides: Array.isArray(d.slides) ? d.slides : [],
      slideDecks: Array.isArray(d.slideDecks) ? d.slideDecks : [],
      defaultSlideDeckId: d.defaultSlideDeckId || null,
      presentationSettings: d.presentationSettings || null,
    },
  };
}

function drawingExportBaseName(noteId, drawingId) {
  const note = state.notes.get(noteId);
  const d = getDrawing(noteId, drawingId);

  return `${safeFilename(d?.title || note?.title || 'drawing')}-${drawingId}`;
}

function markLatestDrawingExportMenu() {
  const menus = [...document.querySelectorAll('body > .ctx-menu')];
  const menu = menus.at(-1);

  if (!menu) return;

  menu.classList.add('yanta-draw-export-menu');

  /*
    Inline-Fallback, falls CSS noch nicht geladen ist oder von anderer
    Runtime-CSS-Reihenfolge überstimmt wird.
  */
  menu.style.zIndex = '1000';
}

function openDrawingExportMenu(anchor, noteId, drawingId) {
  if (!anchor) return;

  /*
    Wichtig:
    Der Download-Button selbst startet keine View Transition.
    Wenn aber von einer vorherigen Drawing-Transition stale
    view-transition-name Styles im DOM liegen, kann die nächste
    startViewTransition irgendwo in der App mit duplicate-name crashen.
    Daher hier defensiv bereinigen.
  */
  clearDrawingViewTransitionNames(drawingId);

  const r = anchor.getBoundingClientRect();

  showMenu(r.left, r.bottom + 6, [
    {
      label: 'Excalidraw',
      action: () => {
        clearDrawingViewTransitionNames(drawingId);

        exportDrawing(noteId, drawingId, {
          format: 'excalidraw',
        });
      },
    },
    {
      label: 'WEBP',
      action: () => {
        clearDrawingViewTransitionNames(drawingId);

        exportDrawing(noteId, drawingId, {
          format: 'webp',
        });
      },
    },
    {
      label: 'SVG',
      action: () => {
        clearDrawingViewTransitionNames(drawingId);

        exportDrawing(noteId, drawingId, {
          format: 'svg',
        });
      },
    },
    {
      label: 'PDF',
      action: () => {
        clearDrawingViewTransitionNames(drawingId);

        exportDrawing(noteId, drawingId, {
          format: 'pdf',
        });
      },
    },
  ]);

  /*
    showMenu() kommt aus tree.js und gibt das Menü nicht zurück.
    Deshalb markieren wir direkt danach das zuletzt erzeugte .ctx-menu.
  */
  markLatestDrawingExportMenu();

  /*
    showMenu() korrigiert die Position synchron, aber falls Layout/Fonts
    minimal später messen, setzen wir die Klasse nochmal im nächsten Frame.
  */
  requestAnimationFrame(() => {
    markLatestDrawingExportMenu();
  });
}

function exportDrawingExcalidraw(noteId, drawingId) {
  const json = drawingToExcalidrawJson(noteId, drawingId);

  if (!json) {
    toast('Drawing not found', 'error');
    return;
  }

  const name = `${drawingExportBaseName(noteId, drawingId)}.excalidraw`;

  downloadBlob(
    new Blob([JSON.stringify(json, null, 2)], {
      type: 'application/json',
    }),
    name
  );
}

async function exportDrawingSvg(noteId, drawingId) {
  const d = getDrawing(noteId, drawingId);

  if (!d) {
    toast('Drawing not found', 'error');
    return;
  }

  const { exportToSvg } = await loadExcalidraw();

  if (typeof exportToSvg !== 'function') {
    toast('SVG export unavailable in this Excalidraw build', 'error');
    return;
  }

  const svg = await exportToSvg({
    elements: liveDrawingElements(d),
    appState: {
      ...cleanAppState(d.appState || {}),
      exportBackground: true,
      viewBackgroundColor:
        currentExcalidrawTheme() === 'dark'
          ? '#121212'
          : '#ffffff',
    },
    files: d.files || {},
  });

  const data = new XMLSerializer().serializeToString(svg);
  const name = `${drawingExportBaseName(noteId, drawingId)}.svg`;

  downloadBlob(
    new Blob([data], {
      type: 'image/svg+xml;charset=utf-8',
    }),
    name
  );
}

async function exportDrawingWebp(noteId, drawingId) {
  const d = getDrawing(noteId, drawingId);

  if (!d) {
    toast('Drawing not found', 'error');
    return;
  }

  const { exportToBlob } = await loadExcalidraw();

  if (typeof exportToBlob !== 'function') {
    toast('WEBP export unavailable in this Excalidraw build', 'error');
    return;
  }

  const elements = liveDrawingElements(d);

  const blob = await exportToBlob({
    /*
      Wichtig:
      Excalidraw behält gelöschte Elemente als { isDeleted: true } in der Scene.
      exportToBlob() rendert diese in manchen Versionen trotzdem.
      Deshalb hier explizit nur live/non-deleted elements exportieren.
    */
    elements,

    appState: {
      ...cleanAppState(d.appState || {}),
      exportBackground: true,
      viewBackgroundColor:
        currentExcalidrawTheme() === 'dark'
          ? '#121212'
          : '#ffffff',
    },

    files: d.files || {},
    mimeType: 'image/webp',
    quality: 0.92,
  });

  const name = `${drawingExportBaseName(noteId, drawingId)}.webp`;

  downloadBlob(blob, name);
}

async function exportDrawingPdf(noteId, drawingId) {
  const d = getDrawing(noteId, drawingId);

  if (!d) {
    toast('Drawing not found', 'error');
    return;
  }

  const { exportToSvg } = await loadExcalidraw();

  if (typeof exportToSvg !== 'function') {
    toast('PDF export unavailable because SVG export is unavailable', 'error');
    return;
  }

  const svg = await exportToSvg({
    elements: liveDrawingElements(d),
    appState: {
      ...cleanAppState(d.appState || {}),
      exportBackground: true,
      viewBackgroundColor: '#ffffff',
    },
    files: d.files || {},
  });

  const data = new XMLSerializer().serializeToString(svg);

  const win = window.open('', '_blank');

  if (!win) {
    toast('Popup blocked · allow popups to print PDF', 'error');
    return;
  }

  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(d.title || 'Drawing')}</title>
        <style>
          @page {
            size: auto;
            margin: 12mm;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            background: white;
          }

          body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          svg {
            max-width: 100%;
            max-height: 100vh;
          }
        </style>
      </head>
      <body>
        ${data}
      </body>
    </html>
  `);

  win.document.close();

  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {}
  }, 200);

  toast('Use print dialog to save as PDF', 'success');
}

export async function exportDrawing(noteId, drawingId, {
  format = 'excalidraw',
} = {}) {
  try {
    if (format === 'excalidraw') {
      exportDrawingExcalidraw(noteId, drawingId);
      return;
    }

    if (format === 'svg') {
      await exportDrawingSvg(noteId, drawingId);
      return;
    }

    if (format === 'webp') {
      await exportDrawingWebp(noteId, drawingId);
      return;
    }

    if (format === 'pdf') {
      await exportDrawingPdf(noteId, drawingId);
      return;
    }

    exportDrawingExcalidraw(noteId, drawingId);
  } catch (err) {
    console.error('[YANTA Draw] export failed', err);
    toast('Drawing export failed', 'error');
  }
}

// ------------------------------------------------------------
// Persistenter Drawing-Thumbnail-Cache (eigene Mini-IndexedDB).
//
// Warum:
// Dashboard-Thumbnails dürfen NICHT das komplette Excalidraw-Bundle
// erzwingen. Nach dem ersten Rendern liegt das Thumbnail als Data-URL
// persistiert vor und wird über eine Content-Signatur invalidiert.
// Bewusst eine eigene DB: kein Versions-Bump der Haupt-DB, keine
// Kopplung an Vault-Sync, verlustfrei löschbar.
// ------------------------------------------------------------
const THUMB_DB_NAME = 'yanta-thumbs';
let thumbDbPromise = null;

function thumbDb() {
  thumbDbPromise ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open(THUMB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('thumbs', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return thumbDbPromise;
}

async function readPersistedThumb(key) {
  const db = await thumbDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction('thumbs').objectStore('thumbs').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writePersistedThumb(entry) {
  thumbDb().then((db) => {
    if (!db) return;
    try {
      db.transaction('thumbs', 'readwrite').objectStore('thumbs').put(entry);
    } catch {}
  });
}

function deletePersistedThumb(key) {
  thumbDb().then((db) => {
    if (!db) return;
    try {
      db.transaction('thumbs', 'readwrite').objectStore('thumbs').delete(key);
    } catch {}
  });
}

function drawingThumbSignature(d) {
  const els = liveDrawingElements(d);
  let maxUpdated = 0;
  let versionSum = 0;
  for (const el of els) {
    maxUpdated = Math.max(maxUpdated, Number(el.updated || 0));
    versionSum += Number(el.version || 0);
  }
  return [
    'v1',
    els.length,
    versionSum,
    maxUpdated,
    currentExcalidrawTheme(),
  ].join(':');
}

export async function drawingThumbnailUrl(noteId, drawingId) {
  const key = `${noteId}:${drawingId}`;
  const d = getDrawing(noteId, drawingId);
  if (!d) {
    return thumbnailCache.get(key)?.url || '';
  }
  if (!liveDrawingElements(d).length) {
    const sig = 'empty:' + currentExcalidrawTheme();
    const memo = thumbnailCache.get(key);
    if (memo?.sig === sig) return memo.url;
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220">
        <rect width="360" height="220" rx="14" fill="#121212"/>
        <text x="180" y="112" dominant-baseline="middle" text-anchor="middle" fill="#6ea8fe" font-family="system-ui" font-size="20">Drawing</text>
      </svg>
    `)}`;
    thumbnailCache.set(key, { sig, url });
    return url;
  }
  const sig = drawingThumbSignature(d);
  /*
    1. In-Memory-Memo (wird bei yanta-drawing-updated geleert).
  */
  const memo = thumbnailCache.get(key);
  if (memo?.sig === sig) return memo.url;
  /*
    2. Persistenter Cache — der eigentliche Performance-Fix:
    Nach Reload KEIN Excalidraw-Load, solange sich das Drawing
    inhaltlich nicht geändert hat.
  */
  const persisted = await readPersistedThumb(key);
  if (persisted?.sig === sig && persisted.url) {
    thumbnailCache.set(key, { sig, url: persisted.url });
    return persisted.url;
  }
  /*
    3. Nur jetzt wirklich rendern (lädt Excalidraw lazy).
  */
  try {
    const { exportToSvg } = await loadExcalidraw();
    const svg = await exportToSvg({
      elements: liveDrawingElements(d),
      appState: {
        ...cleanAppState(d.appState || {}),
        exportBackground: true,
        viewBackgroundColor:
          currentExcalidrawTheme() === 'dark' ? '#121212' : '#ffffff',
      },
      files: d.files || {},
    });
    svg.setAttribute('width', '360');
    svg.setAttribute('height', '220');
    const data = new XMLSerializer().serializeToString(svg);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
    thumbnailCache.set(key, { sig, url });
    writePersistedThumb({ key, sig, url, updated: Date.now() });
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
    appState: {},
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
  registerDrawOverlayRoute();
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