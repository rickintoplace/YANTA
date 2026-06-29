// ============================================================
// YANTA Slides — UI, Slideshow, Laser, Remote QR
//
// Model:
// - A Drawing is an infinite board.
// - Slides are named rectangular camera targets on that board.
// - A slideshow smoothly moves the Excalidraw camera between targets.
// ============================================================

import {
  state,
  toast,
  lucide,
  escapeHtml,
  escapeAttr,
  uid,
} from '../core.js';

import {
  yantaPrompt,
  yantaConfirm,
} from '../dialogs.js';

import {
  renderBrandedQrSvg,
} from '../qr.js';

import {
  BRAND_LOGO_SVG,
} from '../brand-logo.js';

import {
  getDrawing,
} from '../yjs.js';

import {
  listSlides,
  createSlide,
  updateSlide,
  deleteSlide,
  setSlideNotes,
  syncSlidesFromScene,
  drawingRef,
} from './slides-store.js';

import {
  makeVirtualElementForSlide,
  normalizeSlideBounds,
  elementBounds,
  isSlideFrameElement,
  visibleElementsInSlide,
} from './slides-model.js';

import {
  exportDrawingSlidesToPdf,
} from './slides-export.js';

import {
  getDrawingApiForEmbed,
  getActiveDrawingApi,
  getActiveDrawingHost,
} from '../draw.js';

const SIGNALING_URL =
  import.meta.env.VITE_YANTA_SIGNALING_URL ||
  'wss://yanta-signaling-932960946294.europe-west1.run.app';

let cssInjected = false;
let slideshow = null;
let remoteSocket = null;
let remoteTopic = '';
let remoteToken = '';

let fullscreenSlidesDock = null;
let fullscreenSlidesCtx = null;

const slidePreviewCache = new Map();
const REMOTE_PREVIEW_MAX_CHARS = 650_000;

const pendingPanelRefreshes = new Set();
let panelRefreshRaf = 0;
let cameraAnimationRaf = 0;

function injectCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-slides-css';
  style.textContent = `
.yanta-slides-panel {
  border-top: 1px solid var(--border);
  background: var(--bg-elev-2);
  padding: 7px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.yanta-slides-panel:not(.is-open) {
  padding-block: 6px;
}

.yanta-slides-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.yanta-slides-actions .btn {
  min-height: 28px;
  padding: 4px 8px;
  font-size: 11px;
}

.yanta-slides-actions small {
  color: var(--text-faint);
  font-size: 11px;
}

.yanta-slides-strip {
  display: flex;
  align-items: stretch;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.yanta-slide-chip {
  min-width: 116px;
  max-width: 180px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev);
  color: var(--text);
  padding: 7px 8px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 7px;
  align-items: center;
  cursor: pointer;
  text-align: left;
}

.yanta-slide-chip:hover,
.yanta-slide-chip.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev));
}

.yanta-slide-chip-num {
  width: 21px;
  height: 21px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  font-size: 11px;
  font-weight: 850;
}

.yanta-slide-chip-title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 750;
}

.yanta-slide-chip-menu {
  opacity: .72;
}

.yanta-slide-draw-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  cursor: crosshair;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  outline: none;
}

.yanta-slide-draw-overlay::after {
  content: "Drag to create a slide · Esc to cancel";
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  padding: 7px 11px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 750;
  pointer-events: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.yanta-slide-draw-rect {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  border: 2px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-radius: 10px;
  box-shadow: 0 0 0 1px rgba(255,255,255,.14) inset;
}

.yanta-slideshow {
  position: fixed;
  inset: 0;
  z-index: 390;
  pointer-events: none;
}

.yanta-slideshow-toolbar {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 16px 50px rgba(0,0,0,.34);
}

.yanta-slideshow-toolbar .btn,
.yanta-slideshow-toolbar .icon-btn {
  pointer-events: auto;
}

.yanta-slideshow-toolbar .icon-btn.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.yanta-slideshow-count {
  min-width: 88px;
  color: var(--text-dim);
  font-size: 12px;
  text-align: center;
  font-weight: 750;
}

.yanta-slideshow-notes {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  top: max(16px, env(safe-area-inset-top));
  width: min(360px, calc(100vw - 32px));
  max-height: min(60vh, 540px);
  pointer-events: auto;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-elev) 94%, transparent);
  color: var(--text);
  backdrop-filter: blur(12px);
  overflow: hidden;
  box-shadow: 0 20px 70px rgba(0,0,0,.38);
}

.yanta-slideshow-notes-head {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-slideshow-notes-head strong {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.yanta-slideshow-notes textarea {
  width: 100%;
  min-height: 180px;
  max-height: 48vh;
  resize: vertical;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.55;
  padding: 12px;
  box-sizing: border-box;
}

.yanta-laser-layer {
  position: fixed;
  inset: 0;
  z-index: 391;
  pointer-events: none;
}

.yanta-laser-dot {
  position: fixed;
  width: 18px;
  height: 18px;
  margin-left: -9px;
  margin-top: -9px;
  border-radius: 999px;
  background: #ff3b30;
  box-shadow:
    0 0 0 4px rgba(255,59,48,.18),
    0 0 24px rgba(255,59,48,.72);
  opacity: 0;
  transform: scale(.8);
  transition: opacity 80ms ease, transform 80ms ease;
}

.yanta-laser-dot.visible {
  opacity: 1;
  transform: scale(1);
}

.yanta-slides-remote-modal,
.yanta-slides-remote-screen {
  position: fixed;
  inset: 0;
  z-index: 530;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0,0,0,.58);
  backdrop-filter: blur(8px);
}

.yanta-slides-remote-card,
.yanta-slides-remote-phone {
  width: min(460px, 94vw);
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: 0 28px 90px rgba(0,0,0,.48);
  overflow: hidden;
}

.yanta-slides-remote-card header,
.yanta-slides-remote-phone header {
  min-height: 52px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-elev-2);
  border-bottom: 1px solid var(--border);
}

.yanta-slides-remote-card header h3,
.yanta-slides-remote-phone header h3 {
  flex: 1;
  margin: 0;
  font-size: 15px;
}

.yanta-slides-remote-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-slides-remote-qr {
  display: flex;
  justify-content: center;
  padding: 16px;
  border-radius: 16px;
  background: white;
}

.yanta-slides-remote-controls {
  padding: 18px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.yanta-slides-remote-controls button {
  min-height: 92px;
  border-radius: 18px;
  font-size: 18px;
  font-weight: 850;
}

.yanta-slides-remote-laserpad {
  grid-column: 1 / -1;
  min-height: 220px;
  border: 1px dashed var(--border-strong);
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  touch-action: none;
  user-select: none;
}

.yanta-slides-embed {
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev-2);
}

.yanta-slides-embed-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.yanta-slides-embed-head strong {
  flex: 1;
  min-width: 0;
}

.yanta-slide-chip {
  grid-template-columns: 52px minmax(0, 1fr) auto;
}

.yanta-slide-chip-thumb {
  width: 52px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
}

.yanta-slide-chip-thumb svg {
  display: block;
  width: 100%;
  height: 100%;
}

.yanta-slide-chip-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.yanta-slides-fullscreen-dock {
  position: fixed;
  left: max(14px, env(safe-area-inset-left));
  bottom: max(14px, env(safe-area-inset-bottom));
  z-index: 392;
  width: min(720px, calc(100vw - 28px));
  max-height: min(44vh, 360px);
  overflow: auto;

  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-elev) 94%, transparent);
  color: var(--text);

  box-shadow: 0 18px 60px rgba(0,0,0,.38);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.yanta-slides-fullscreen-dock .yanta-slides-panel {
  border-top: 0;
  background: transparent;
}

.yanta-slideshow .yanta-slides-fullscreen-dock {
  display: none !important;
}

.yanta-slides-remote-preview {
  grid-column: 1 / -1;
  position: relative;
  min-height: 260px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--bg);
  overflow: hidden;
  touch-action: none;
  user-select: none;

  display: flex;
  align-items: center;
  justify-content: center;
}

.yanta-slides-remote-preview svg {
  display: block;
  max-width: 100%;
  max-height: 100%;
}

.yanta-slides-remote-preview-empty {
  color: var(--text-faint);
  font-size: 13px;
  text-align: center;
  padding: 18px;
}

.yanta-slides-remote-laser-dot {
  position: absolute;
  width: 18px;
  height: 18px;
  margin-left: -9px;
  margin-top: -9px;
  border-radius: 999px;
  background: #ff3b30;
  box-shadow:
    0 0 0 4px rgba(255,59,48,.18),
    0 0 24px rgba(255,59,48,.72);
  opacity: 0;
  transform: scale(.8);
  transition: opacity 80ms ease, transform 80ms ease;
  pointer-events: none;
}

.yanta-slides-remote-laser-dot.visible {
  opacity: 1;
  transform: scale(1);
}

.yanta-slides-fullscreen-dock.is-hidden-during-slideshow {
  display: none !important;
}

@media (max-width: 680px) {
  .yanta-slideshow-toolbar {
    max-width: calc(100vw - 20px);
    overflow-x: auto;
  }

  .yanta-slides-remote-controls {
    grid-template-columns: 1fr;
  }
}
  `;

  document.head.append(style);
}

function scheduleSlidesPanelRefresh(embed) {
  if (!embed) return;

  pendingPanelRefreshes.add(embed);

  if (panelRefreshRaf) return;

  panelRefreshRaf = requestAnimationFrame(() => {
    panelRefreshRaf = 0;

    const targets = [...pendingPanelRefreshes];
    pendingPanelRefreshes.clear();

    for (const node of targets) {
      if (node.isConnected) {
        refreshSlidesPanel(node);
      }
    }
  });
}

function slidesPanelOpen(embed) {
  return embed?.dataset?.slidesPanelOpen === '1';
}

function setSlidesPanelOpen(embed, open) {
  if (!embed) return;
  embed.dataset.slidesPanelOpen = open ? '1' : '0';
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);

  return x < 0.5
    ? 4 * x * x * x
    : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function drawingViewportRect(container = null) {
  const rect =
    container?.querySelector?.('.excalidraw')?.getBoundingClientRect?.() ||
    container?.getBoundingClientRect?.() ||
    null;

  if (rect && rect.width > 0 && rect.height > 0) {
    return rect;
  }

  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function zoomValue(appState = {}) {
  return finiteNumber(appState.zoom?.value ?? appState.zoom, 1) || 1;
}

/**
 * Browser client coords -> Excalidraw infinite-board scene coords.
 *
 * Same coordinate model as draw.js:
 *
 *   sceneX = (clientX - rect.left) / zoom - scrollX
 *   sceneY = (clientY - rect.top) / zoom - scrollY
 *
 * Uses object params intentionally, so wrong argument order cannot silently
 * create NaN slide bounds.
 */
function screenToScene({
  api,
  container,
  clientX,
  clientY,
}) {
  if (!Number.isFinite(Number(clientX)) || !Number.isFinite(Number(clientY))) {
    console.warn('[YANTA Slides] invalid screenToScene input', {
      clientX,
      clientY,
      container,
    });

    return {
      x: 0,
      y: 0,
      invalid: true,
    };
  }

  // Prefer Excalidraw's own conversion if available.
  // This matches draw.js behavior and should be the source of truth.
  try {
    if (api?.screenToSceneCoords) {
      const p = api.screenToSceneCoords({
        clientX,
        clientY,
      });

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

      const p2 = api.screenToSceneCoords({
        x: clientX,
        y: clientY,
      });

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

  const rect = drawingViewportRect(container);
  const appState = api?.getAppState?.() || {};
  const zoom = zoomValue(appState);
  const scrollX = finiteNumber(appState.scrollX, 0);
  const scrollY = finiteNumber(appState.scrollY, 0);

  return {
    x: (clientX - rect.left) / zoom - scrollX,
    y: (clientY - rect.top) / zoom - scrollY,
  };
}

/**
 * Exact same coordinate model as draw.js.
 *
 * This uses object params intentionally, so old/wrong call order cannot
 * silently turn clientY into undefined and create NaN slide bounds.
 */
function sceneToScreen({
  api,
  container,
  sceneX,
  sceneY,
}) {
  const rect = drawingViewportRect(container);
  const appState = api?.getAppState?.() || {};
  const zoom = zoomValue(appState);
  const scrollX = finiteNumber(appState.scrollX, 0);
  const scrollY = finiteNumber(appState.scrollY, 0);

  return {
    x: rect.left + (sceneX + scrollX) * zoom,
    y: rect.top + (sceneY + scrollY) * zoom,
  };
}

function slideUnitToScreen(data = {}) {
  if (!slideshow) return null;

  const slide = slideshow.slides[slideshow.index];
  const api =
    slideshow.api ||
    currentApiForDrawing(slideshow.noteId, slideshow.drawingId);

  if (!slide || !api) return null;

  const bounds = normalizeSlideBounds(slide.bounds);

  const sceneX = bounds.x + clamp(Number(data.x || 0), 0, 1) * bounds.width;
  const sceneY = bounds.y + clamp(Number(data.y || 0), 0, 1) * bounds.height;

  return sceneToScreen({
    api,
    container: slideshow.container,
    sceneX,
    sceneY,
  });
}

function screenToSlideUnit(clientX, clientY) {
  if (!slideshow) return null;

  const slide = slideshow.slides[slideshow.index];
  const api =
    slideshow.api ||
    currentApiForDrawing(slideshow.noteId, slideshow.drawingId);

  if (!slide || !api) return null;

  const scene = screenToScene({
    api,
    container: slideshow.container,
    clientX,
    clientY,
  });

  const bounds = normalizeSlideBounds(slide.bounds);

  return {
    x: clamp((scene.x - bounds.x) / Math.max(1, bounds.width), 0, 1),
    y: clamp((scene.y - bounds.y) / Math.max(1, bounds.height), 0, 1),
  };
}

function slideCameraTarget(api, container, slide, {
  viewportZoomFactor = 0.84,
} = {}) {
  const rect = drawingViewportRect(container);
  const bounds = normalizeSlideBounds(slide.bounds);

  const safeWidth = Math.max(1, bounds.width);
  const safeHeight = Math.max(1, bounds.height);

  const zoom = clamp(
    Math.min(
      (rect.width * viewportZoomFactor) / safeWidth,
      (rect.height * viewportZoomFactor) / safeHeight
    ),
    0.04,
    4
  );

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  /*
    Inverse of fallback transform:
      sceneX = (clientX - rect.left) / zoom - scrollX
      clientX - rect.left = (sceneX + scrollX) * zoom

    Want slide center at viewport center:
      rect.width / 2 = (centerX + scrollX) * zoom

    Therefore:
      scrollX = rect.width / (2 * zoom) - centerX
  */
  return {
    scrollX: rect.width / (2 * zoom) - centerX,
    scrollY: rect.height / (2 * zoom) - centerY,
    zoom,
  };
}

function updateCamera(api, camera) {
  if (!api || !camera) return;

  api.updateScene({
    appState: {
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: {
        value: camera.zoom,
      },
    },
  });

  try {
    api.refresh?.();
  } catch {}
}

function animateCameraToSlide(api, container, slide, {
  duration = 520,
} = {}) {
  if (!api || !slide) return;

  cancelAnimationFrame(cameraAnimationRaf);
  cameraAnimationRaf = 0;

  const appState = api.getAppState?.() || {};

  const from = {
    scrollX: finiteNumber(appState.scrollX, 0),
    scrollY: finiteNumber(appState.scrollY, 0),
    zoom: zoomValue(appState),
  };

  const to = slideCameraTarget(api, container, slide);

  if (prefersReducedMotion() || duration <= 0) {
    updateCamera(api, to);
    return;
  }

  const start = performance.now();

  const tick = () => {
    const t = clamp((performance.now() - start) / duration, 0, 1);
    const k = easeInOutCubic(t);

    updateCamera(api, {
      scrollX: from.scrollX + (to.scrollX - from.scrollX) * k,
      scrollY: from.scrollY + (to.scrollY - from.scrollY) * k,
      zoom: from.zoom + (to.zoom - from.zoom) * k,
    });

    if (t < 1) {
      cameraAnimationRaf = requestAnimationFrame(tick);
    } else {
      cameraAnimationRaf = 0;
      updateCamera(api, to);
    }
  };

  cameraAnimationRaf = requestAnimationFrame(tick);
}

function scrollToSlide(api, slide, container = null) {
  if (!api || !slide) return;

  animateCameraToSlide(api, container, slide);
}

function currentApiForDrawing(noteId, drawingId) {
  const fullscreenApi = getActiveDrawingApi?.();

  if (
    fullscreenApi &&
    slideshow?.drawingId === drawingId &&
    slideshow?.noteId === noteId
  ) {
    return fullscreenApi;
  }

  const embed = document.querySelector(
    `.yanta-draw-embed[data-draw-id="${CSS.escape(drawingId)}"][data-note-id="${CSS.escape(noteId)}"]`
  );

  return embed ? getDrawingApiForEmbed(embed) : null;
}

function contextFromEmbed(embed) {
  const drawingId = embed?.dataset?.drawId || '';
  const preferredNoteId = embed?.dataset?.noteId || state.currentNoteId || '';
  const ref = drawingRef(preferredNoteId, drawingId);

  if (!ref) return null;

  return {
    noteId: ref.noteId,
    drawingId,
    drawing: ref.drawing,
    api: getDrawingApiForEmbed(embed),
    container: embed.querySelector('.yanta-draw-inline-host') || embed,
  };
}

async function loadExcalidrawExport() {
  const mod = await import('@excalidraw/excalidraw');

  if (typeof mod.exportToSvg !== 'function') {
    throw new Error('Excalidraw SVG export unavailable');
  }

  return mod;
}

function slidePreviewBackground() {
  return document.documentElement.dataset.theme === 'dark'
    ? '#121212'
    : '#ffffff';
}

function slidePreviewCacheKey(drawing, slide, {
  background = slidePreviewBackground(),
} = {}) {
  return [
    drawing?.id || '',
    slide?.id || '',
    slide?.updated || '',
    drawing?.updated || '',
    background,
    JSON.stringify(slide?.bounds || {}),
    Array.isArray(drawing?.elements) ? drawing.elements.length : 0,
  ].join(':');
}

/**
 * Render the exact slide viewport by adding a transparent virtual element
 * with the slide bounds. This forces Excalidraw export bounds to match the
 * slide frame, so remote laser mapping can use normalized slide coords.
 */
async function renderSlideSvgString(drawing, slide, {
  background = slidePreviewBackground(),
} = {}) {
  const key = slidePreviewCacheKey(drawing, slide, {
    background,
  });

  if (slidePreviewCache.has(key)) {
    return slidePreviewCache.get(key);
  }

  const { exportToSvg } = await loadExcalidrawExport();

  const content = visibleElementsInSlide(drawing?.elements || [], slide);
  const virtualBounds = makeVirtualElementForSlide(slide);

  const svg = await exportToSvg({
    elements: [
      ...content,
      virtualBounds,
    ],
    appState: {
      ...(drawing?.appState || {}),
      exportBackground: true,
      viewBackgroundColor: background,
    },
    files: drawing?.files || {},
  });

  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const text = new XMLSerializer().serializeToString(svg);

  slidePreviewCache.set(key, text);

  return text;
}

function svgStringToDataUrl(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

async function hydrateSlideThumbnails(root, drawing, slides = []) {
  if (!root || !drawing || !Array.isArray(slides)) return;

  const tasks = slides.map(async (slide) => {
    const host = root.querySelector(`[data-slide-thumb="${CSS.escape(slide.id)}"]`);
    if (!host) return;

    try {
      const svg = await renderSlideSvgString(drawing, slide);
      if (!host.isConnected) return;

      host.replaceChildren();

      const img = document.createElement('img');
      img.src = svgStringToDataUrl(svg);
      img.alt = slide.title || 'Slide thumbnail';
      img.draggable = false;

      host.append(img);
    } catch (err) {
      console.warn('[YANTA Slides] thumbnail render failed', err);

      if (!host.isConnected) return;

      host.innerHTML = lucide('presentation', 14);
    }
  });

  await Promise.allSettled(tasks);
}

function enhanceDrawingEmbed(embed) {
  injectCss();

  if (!embed) return;

  if (embed.dataset.slidesEnhanced === '1') {
    scheduleSlidesPanelRefresh(embed);
    return;
  }

  embed.dataset.slidesEnhanced = '1';

  const panel = document.createElement('div');
  panel.className = 'yanta-slides-panel';
  panel.dataset.slidesPanel = '1';

  const host = embed.querySelector('.yanta-draw-inline-host');

  if (host) {
    embed.insertBefore(panel, host);
  } else {
    embed.append(panel);
  }

  refreshSlidesPanel(embed);
}

function refreshSlidesPanel(embed) {
  if (!embed) return;

  const panel = embed.querySelector('[data-slides-panel]');
  if (!panel) return;

  const ctx = contextFromEmbed(embed);

  if (!ctx) {
    panel.innerHTML = '';
    return;
  }

  const open = slidesPanelOpen(embed);

  const slides = open
    ? syncSlidesFromScene(ctx.noteId, ctx.drawingId, ctx.api)
    : listSlides(ctx.noteId, ctx.drawingId);

  panel.classList.toggle('is-open', open);

  panel.innerHTML = `
    <div class="yanta-slides-actions">
      <button class="btn ${open ? 'primary' : ''}" data-slides-action="toggle">
        ${lucide('presentation', 13)}
        Slides
      </button>

      <small>
        ${slides.length} slide${slides.length === 1 ? '' : 's'}
      </small>
    </div>

    ${
      open
        ? `
          <div class="yanta-slides-actions">
            <button class="btn" data-slides-action="draw">
              ${lucide('scan', 13)}
              Draw slide
            </button>

            <button class="btn" data-slides-action="current-view">
              ${lucide('focus', 13)}
              Current view
            </button>

            <button class="btn" data-slides-action="selection">
              ${lucide('scan-check', 13)}
              Selection
            </button>

            <button class="btn primary" data-slides-action="present">
              ${lucide('play', 13)}
              Present
            </button>

            <button class="btn" data-slides-action="pdf">
              ${lucide('file-down', 13)}
              PDF
            </button>

            <button class="btn" data-slides-action="remote">
              ${lucide('qr-code', 13)}
              Remote
            </button>
          </div>

          <div class="yanta-slides-strip">
            ${
              slides.length
                ? slides.map((slide, index) => `
                  <button class="yanta-slide-chip" data-slide-id="${escapeAttr(slide.id)}">
                    <span class="yanta-slide-chip-thumb" data-slide-thumb="${escapeAttr(slide.id)}">
                      ${lucide('presentation', 13)}
                    </span>
                    <span class="yanta-slide-chip-title">
                      <span class="yanta-slide-chip-num">${index + 1}</span>
                      ${escapeHtml(slide.title)}
                    </span>
                    <span class="yanta-slide-chip-menu">${lucide('chevron-right', 13)}</span>
                  </button>
                  `).join('')
                : `<div style="color:var(--text-faint);font-size:12px;padding:4px 2px">
                    Create slides from the infinite board: draw a frame, use the current view, or use selected objects.
                  </div>`
            }
          </div>
        `
        : ''
    }
  `;

  if (open) {
    hydrateSlideThumbnails(panel, ctx.drawing, slides).catch((err) => {
      console.warn('[YANTA Slides] could not hydrate thumbnails', err);
    });
  }

  panel.querySelector('[data-slides-action="toggle"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    setSlidesPanelOpen(embed, !open);
    refreshSlidesPanel(embed);
  });

  if (!open) return;

  panel.querySelector('[data-slides-action="draw"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const api = getDrawingApiForEmbed(embed);

    if (!api) {
      toast('Drawing is not ready yet', 'error');
      return;
    }

    startSlideDrawMode({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api,
      container: ctx.container,
      onDone: () => {
        setSlidesPanelOpen(embed, true);
        refreshSlidesPanel(embed);
      },
    });
  });

  panel.querySelector('[data-slides-action="current-view"]')?.addEventListener('click', () => {
    createSlideFromCurrentView({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: getDrawingApiForEmbed(embed),
      container: ctx.container,
      onDone: () => {
        setSlidesPanelOpen(embed, true);
        refreshSlidesPanel(embed);
      },
    });
  });

  panel.querySelector('[data-slides-action="selection"]')?.addEventListener('click', () => {
    createSlideFromSelection({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: getDrawingApiForEmbed(embed),
      onDone: () => {
        setSlidesPanelOpen(embed, true);
        refreshSlidesPanel(embed);
      },
    });
  });

  panel.querySelector('[data-slides-action="present"]')?.addEventListener('click', () => {
    startSlideshow({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: getDrawingApiForEmbed(embed),
      container: ctx.container,
    });
  });

  panel.querySelector('[data-slides-action="pdf"]')?.addEventListener('click', () => {
    exportDrawingSlidesToPdf(ctx.noteId, ctx.drawingId);
  });

  panel.querySelector('[data-slides-action="remote"]')?.addEventListener('click', () => {
    ensureSlideshowForRemote({
      ...ctx,
      api: getDrawingApiForEmbed(embed),
    });

    openRemoteQrModal();
  });

  panel.querySelectorAll('[data-slide-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slide = listSlides(ctx.noteId, ctx.drawingId)
        .find((s) => s.id === btn.dataset.slideId);

      scrollToSlide(getDrawingApiForEmbed(embed), slide, ctx.container);
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      openSlideMiniMenu(e.clientX, e.clientY, {
        noteId: ctx.noteId,
        drawingId: ctx.drawingId,
        slideId: btn.dataset.slideId,
        api: getDrawingApiForEmbed(embed),
        refresh: () => refreshSlidesPanel(embed),
      });
    });
  });
}

function removeFullscreenSlidesDock() {
  fullscreenSlidesDock?.remove();
  fullscreenSlidesDock = null;
  fullscreenSlidesCtx = null;
}

function ensureFullscreenSlidesDock() {
  injectCss();

  if (fullscreenSlidesDock?.isConnected) {
    return fullscreenSlidesDock;
  }

  fullscreenSlidesDock = document.createElement('div');
  fullscreenSlidesDock.className = 'yanta-slides-fullscreen-dock';
  fullscreenSlidesDock.dataset.slidesFullscreenDock = '1';

  document.body.append(fullscreenSlidesDock);

  return fullscreenSlidesDock;
}

function renderFullscreenSlidesDock(ctx) {
  if (!ctx?.noteId || !ctx?.drawingId) return;

  const dock = ensureFullscreenSlidesDock();
  fullscreenSlidesCtx = ctx;

  const drawing = getDrawing(ctx.noteId, ctx.drawingId);
  if (!drawing) {
    dock.innerHTML = '';
    return;
  }

  const slides = syncSlidesFromScene(ctx.noteId, ctx.drawingId, ctx.api);
  const open = dock.dataset.open !== '0';

  dock.innerHTML = `
    <div class="yanta-slides-panel is-open">
      <div class="yanta-slides-actions">
        <button class="btn ${open ? 'primary' : ''}" data-fs-slides-action="toggle">
          ${lucide('presentation', 13)}
          Slides
        </button>

        <small>
          ${slides.length} slide${slides.length === 1 ? '' : 's'}
        </small>

        <span style="flex:1"></span>

        <button class="icon-btn" data-fs-slides-action="close" title="Hide slides">
          ${lucide('x', 14)}
        </button>
      </div>

      ${
        open
          ? `
            <div class="yanta-slides-actions">
              <button class="btn" data-fs-slides-action="draw">
                ${lucide('scan', 13)}
                Draw slide
              </button>

              <button class="btn" data-fs-slides-action="current-view">
                ${lucide('focus', 13)}
                Current view
              </button>

              <button class="btn" data-fs-slides-action="selection">
                ${lucide('scan-check', 13)}
                Selection
              </button>

              <button class="btn primary" data-fs-slides-action="present">
                ${lucide('play', 13)}
                Present
              </button>

              <button class="btn" data-fs-slides-action="pdf">
                ${lucide('file-down', 13)}
                PDF
              </button>

              <button class="btn" data-fs-slides-action="remote">
                ${lucide('qr-code', 13)}
                Remote
              </button>
            </div>

            <div class="yanta-slides-strip">
              ${
                slides.length
                  ? slides.map((slide, index) => `
                      <button class="yanta-slide-chip" data-slide-id="${escapeAttr(slide.id)}">
                        <span class="yanta-slide-chip-thumb" data-slide-thumb="${escapeAttr(slide.id)}">
                          ${lucide('presentation', 13)}
                        </span>
                        <span class="yanta-slide-chip-title">
                          <span class="yanta-slide-chip-num">${index + 1}</span>
                          ${escapeHtml(slide.title)}
                        </span>
                        <span class="yanta-slide-chip-menu">${lucide('chevron-right', 13)}</span>
                      </button>
                    `).join('')
                  : `<div style="color:var(--text-faint);font-size:12px;padding:4px 2px">
                      Create slides from the infinite board: draw a frame, use the current view, or use selected objects.
                    </div>`
              }
            </div>
          `
          : ''
      }
    </div>
  `;

  dock.querySelector('[data-fs-slides-action="toggle"]')?.addEventListener('click', () => {
    dock.dataset.open = open ? '0' : '1';
    renderFullscreenSlidesDock(ctx);
  });

  dock.querySelector('[data-fs-slides-action="close"]')?.addEventListener('click', () => {
    dock.dataset.open = '0';
    renderFullscreenSlidesDock(ctx);
  });

  if (!open) return;

  hydrateSlideThumbnails(dock, drawing, slides).catch((err) => {
    console.warn('[YANTA Slides] fullscreen thumbnails failed', err);
  });

  dock.querySelector('[data-fs-slides-action="draw"]')?.addEventListener('click', () => {
    startSlideDrawMode({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: ctx.api,
      container: ctx.container,
      onDone: () => {
        dock.dataset.open = '1';
        renderFullscreenSlidesDock(ctx);
      },
    });
  });

  dock.querySelector('[data-fs-slides-action="current-view"]')?.addEventListener('click', () => {
    createSlideFromCurrentView({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: ctx.api,
      container: ctx.container,
      onDone: () => {
        dock.dataset.open = '1';
        renderFullscreenSlidesDock(ctx);
      },
    });
  });

  dock.querySelector('[data-fs-slides-action="selection"]')?.addEventListener('click', () => {
    createSlideFromSelection({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: ctx.api,
      onDone: () => {
        dock.dataset.open = '1';
        renderFullscreenSlidesDock(ctx);
      },
    });
  });

  dock.querySelector('[data-fs-slides-action="present"]')?.addEventListener('click', () => {
    startSlideshow({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: ctx.api,
      container: ctx.container,
    });
  });

  dock.querySelector('[data-fs-slides-action="pdf"]')?.addEventListener('click', () => {
    exportDrawingSlidesToPdf(ctx.noteId, ctx.drawingId);
  });

  dock.querySelector('[data-fs-slides-action="remote"]')?.addEventListener('click', () => {
    ensureSlideshowForRemote(ctx);
    openRemoteQrModal();
  });

  dock.querySelectorAll('[data-slide-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slide = listSlides(ctx.noteId, ctx.drawingId)
        .find((s) => s.id === btn.dataset.slideId);

      scrollToSlide(ctx.api, slide, ctx.container);
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      openSlideMiniMenu(e.clientX, e.clientY, {
        noteId: ctx.noteId,
        drawingId: ctx.drawingId,
        slideId: btn.dataset.slideId,
        api: ctx.api,
        refresh: () => renderFullscreenSlidesDock(ctx),
      });
    });
  });
}

function mountFullscreenSlidesDockFromApiReady(detail = {}) {
  const noteId = detail.noteId || '';
  const drawingId = detail.drawingId || '';
  const api = detail.api || null;
  const container =
    getActiveDrawingHost?.() ||
    document.querySelector('.yanta-draw-fullscreen-host') ||
    null;

  if (!noteId || !drawingId || !api || !container) return;

  renderFullscreenSlidesDock({
    noteId,
    drawingId,
    api,
    container,
  });
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

function createSlideFromSelection({
  noteId,
  drawingId,
  api,
  onDone,
} = {}) {
  if (!api) {
    toast('Drawing is not ready yet', 'error');
    return null;
  }

  const appState = api.getAppState?.() || {};
  const selected = normalizeSelectedIds(appState.selectedElementIds);

  if (!selected.size) {
    toast('Select objects first', 'error');
    return null;
  }

  const elements =
    api.getSceneElementsIncludingDeleted?.() ||
    api.getSceneElements?.() ||
    [];

  const boxes = elements
    .filter((el) => el && !el.isDeleted)
    .filter((el) => selected.has(el.id))
    .filter((el) => !isSlideFrameElement(el))
    .map(elementBounds);

  if (!boxes.length) {
    toast('No selectable objects found', 'error');
    return null;
  }

  const pad = 48;

  const x1 = Math.min(...boxes.map((b) => b.x)) - pad;
  const y1 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x2 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const y2 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;

  const slide = createSlide(noteId, drawingId, {
    bounds: normalizeSlideBounds({
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
    }),
    api,
  });

  if (slide) {
    toast(`Created ${slide.title}`, 'success');
    onDone?.(slide);
  }

  return slide;
}

function createSlideFromCurrentView({
  noteId,
  drawingId,
  api,
  container,
  onDone,
} = {}) {
  if (!api || !container) {
    toast('Drawing is not ready yet', 'error');
    return null;
  }

  const rect =
    container.querySelector?.('.excalidraw')?.getBoundingClientRect?.() ||
    container.getBoundingClientRect?.();

  if (!rect || rect.width < 20 || rect.height < 20) {
    toast('Could not read current view', 'error');
    return null;
  }

  const a = screenToScene({
    api,
    container,
    clientX: rect.left,
    clientY: rect.top,
  });

  const b = screenToScene({
    api,
    container,
    clientX: rect.right,
    clientY: rect.bottom,
  });

  const bounds = normalizeSlideBounds({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  });

  const slide = createSlide(noteId, drawingId, {
    bounds,
    api,
  });

  if (slide) {
    toast(`Created ${slide.title}`, 'success');
    onDone?.(slide);
  }

  return slide;
}

function openSlideMiniMenu(x, y, {
  noteId,
  drawingId,
  slideId,
  api,
  refresh,
}) {
  const slide = listSlides(noteId, drawingId).find((s) => s.id === slideId);
  if (!slide) return;

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.zIndex = '540';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  menu.innerHTML = `
    <button data-action="rename">${lucide('pencil', 14)} Rename</button>
    <button data-action="notes">${lucide('notebook-text', 14)} Speaker notes</button>
    <hr>
    <button class="danger" data-action="delete">${lucide('trash', 14)} Delete slide</button>
  `;

  document.body.append(menu);

  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
  };

  const outside = (e) => {
    if (menu.contains(e.target)) return;
    close();
  };

  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
  });

  menu.querySelector('[data-action="rename"]')?.addEventListener('click', async () => {
    close();

    const title = await yantaPrompt({
      title: 'Rename slide',
      label: 'Slide title',
      initial: slide.title,
      placeholder: 'Slide title',
      confirmLabel: 'Rename',
      icon: 'presentation',
    });

    if (title != null) {
      updateSlide(noteId, drawingId, slideId, {
        title: title.trim() || slide.title,
      });

      refresh?.();
    }
  });

  menu.querySelector('[data-action="notes"]')?.addEventListener('click', async () => {
    close();

    const notes = await yantaPrompt({
      title: 'Speaker notes',
      label: 'Notes',
      initial: slide.notes?.markdown || '',
      placeholder: 'Presenter notes for this slide…',
      multiline: true,
      confirmLabel: 'Save notes',
      icon: 'notebook-text',
      select: false,
    });

    if (notes != null) {
      setSlideNotes(noteId, drawingId, slideId, notes);
      refresh?.();
    }
  });

  menu.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    close();

    const ok = await yantaConfirm({
      title: 'Delete slide?',
      message: `Delete "${slide.title}"?\n\nThe slide frame on the board will also be deleted.`,
      confirmLabel: 'Delete slide',
      danger: true,
      icon: 'trash',
    });

    if (!ok) return;

    deleteSlide(noteId, drawingId, slideId, {
      deleteFrame: true,
      api,
    });

    refresh?.();
  });
}

function startSlideDrawMode({
  noteId,
  drawingId,
  api,
  container,
  onDone,
}) {
  injectCss();

  if (!container || !api) {
    toast('Drawing is not ready yet', 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'yanta-slide-draw-overlay';
  overlay.title = 'Drag to create a slide';
  overlay.tabIndex = 0;

  const rect = document.createElement('div');
  rect.className = 'yanta-slide-draw-rect';
  rect.hidden = true;

  document.body.append(rect);
  container.append(overlay);

  let start = null;
  let latest = null;

  const cleanup = () => {
    overlay.remove();
    rect.remove();
  };

  const pointFromEvent = (e) => ({
    clientX: e.clientX,
    clientY: e.clientY,
    scene: screenToScene({
      api,
      container,
      clientX: e.clientX,
      clientY: e.clientY,
    }),
  });

  overlay.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    start = pointFromEvent(e);
    latest = start;

    rect.hidden = false;

    try {
      overlay.setPointerCapture?.(e.pointerId);
    } catch {}
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!start) return;

    e.preventDefault();
    e.stopPropagation();

    latest = pointFromEvent(e);

    const left = Math.min(start.clientX, latest.clientX);
    const top = Math.min(start.clientY, latest.clientY);
    const width = Math.abs(latest.clientX - start.clientX);
    const height = Math.abs(latest.clientY - start.clientY);

    Object.assign(rect.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  });

  overlay.addEventListener('pointercancel', cleanup);

  overlay.addEventListener('pointerup', (e) => {
    if (!start || !latest) {
      cleanup();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (start.scene?.invalid || latest.scene?.invalid) {
      cleanup();
      toast('Could not read drawing coordinates', 'error');

      console.warn('[YANTA Slides] invalid slide drag coordinates', {
        start,
        latest,
        appState: api?.getAppState?.(),
      });

      return;
    }

    const x1 = Math.min(start.scene.x, latest.scene.x);
    const y1 = Math.min(start.scene.y, latest.scene.y);
    const x2 = Math.max(start.scene.x, latest.scene.x);
    const y2 = Math.max(start.scene.y, latest.scene.y);

    const bounds = normalizeSlideBounds({
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
    });

    console.log('[YANTA Slides] created bounds', {
      startScene: start.scene,
      latestScene: latest.scene,
      bounds,
      appState: api?.getAppState?.(),
    });

    cleanup();

    if (bounds.width < 80 || bounds.height < 60) {
      toast('Slide is too small', 'error');
      return;
    }

    const slide = createSlide(noteId, drawingId, {
      bounds,
      api,
    });

    if (slide) {
      toast(`Created ${slide.title}`, 'success');
      onDone?.(slide);
    }
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  });

  requestAnimationFrame(() => overlay.focus());
}

function ensureSlideshowForRemote(ctx) {
  if (!slideshow || slideshow.noteId !== ctx.noteId || slideshow.drawingId !== ctx.drawingId) {
    startSlideshow({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: ctx.api,
      container: ctx.container,
      silent: true,
    });
  }
}

export function startSlideshow({
  noteId,
  drawingId,
  api = null,
  container = null,
  startIndex = 0,
  silent = false,
} = {}) {
  injectCss();

  const slides = listSlides(noteId, drawingId).filter((s) => !s.hidden);
  const drawing = getDrawing(noteId, drawingId);

  if (!drawing || !slides.length) {
    if (!silent) toast('No slides defined yet', 'error');
    return null;
  }

  stopSlideshow();

  const root = document.createElement('div');
  root.className = 'yanta-slideshow';

  const toolbar = document.createElement('div');
  toolbar.className = 'yanta-slideshow-toolbar';

  toolbar.innerHTML = `
    <button class="icon-btn" data-slide-prev title="Previous">${lucide('chevron-left', 18)}</button>
    <span class="yanta-slideshow-count" data-slide-count></span>
    <button class="icon-btn" data-slide-next title="Next">${lucide('chevron-right', 18)}</button>
    <button class="icon-btn" data-slide-laser title="Laser">${lucide('mouse-pointer-2', 17)}</button>
    <button class="icon-btn" data-slide-notes title="Notes">${lucide('notebook-text', 17)}</button>
    <button class="icon-btn" data-slide-remote title="Remote">${lucide('qr-code', 17)}</button>
    <button class="icon-btn" data-slide-exit title="Exit">${lucide('x', 17)}</button>
  `;

  const laserLayer = document.createElement('div');
  laserLayer.className = 'yanta-laser-layer';
  laserLayer.innerHTML = `<div class="yanta-laser-dot" data-laser-dot></div>`;

  root.append(toolbar, laserLayer);
  document.body.append(root);

  fullscreenSlidesDock?.classList.add('is-hidden-during-slideshow');

  slideshow = {
    noteId,
    drawingId,
    api: api || currentApiForDrawing(noteId, drawingId),
    container,
    slides,
    index: Math.max(0, Math.min(slides.length - 1, startIndex)),
    root,
    toolbar,
    laserLayer,
    laserEnabled: false,
    notesOpen: false,
    notesEl: null,
    laserHideTimer: 0,
  };

  toolbar.querySelector('[data-slide-prev]')?.addEventListener('click', previousSlide);
  toolbar.querySelector('[data-slide-next]')?.addEventListener('click', nextSlide);
  toolbar.querySelector('[data-slide-exit]')?.addEventListener('click', stopSlideshow);
  toolbar.querySelector('[data-slide-laser]')?.addEventListener('click', toggleLaser);
  toolbar.querySelector('[data-slide-notes]')?.addEventListener('click', toggleNotes);
  toolbar.querySelector('[data-slide-remote]')?.addEventListener('click', openRemoteQrModal);

  document.addEventListener('keydown', slideshowKeyHandler, true);
  document.addEventListener('pointermove', laserPointerMove, true);

  goToSlide(slideshow.index, {
    notifyRemote: false,
  });

  return slideshow;
}

export function stopSlideshow() {
  if (!slideshow) return;

  document.removeEventListener('keydown', slideshowKeyHandler, true);
  document.removeEventListener('pointermove', laserPointerMove, true);

  slideshow.notesEl?.remove();
  slideshow.root?.remove();

  closeRemoteSocket();

  fullscreenSlidesDock?.classList.remove('is-hidden-during-slideshow');

  slideshow = null;
}

function slideshowKeyHandler(e) {
  if (!slideshow) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    stopSlideshow();
    return;
  }

  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault();
    nextSlide();
    return;
  }

  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault();
    previousSlide();
    return;
  }

  if (e.key.toLowerCase() === 'l') {
    e.preventDefault();
    toggleLaser();
    return;
  }

  if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    toggleNotes();
  }
}

function goToSlide(index, {
  notifyRemote = true,
} = {}) {
  if (!slideshow) return;

  slideshow.index = Math.max(0, Math.min(slideshow.slides.length - 1, index));

  const slide = slideshow.slides[slideshow.index];

  const api =
    slideshow.api ||
    currentApiForDrawing(slideshow.noteId, slideshow.drawingId);

  slideshow.api = api;

  scrollToSlide(api, slide, slideshow.container);

  const count = slideshow.toolbar.querySelector('[data-slide-count]');

  if (count) {
    count.textContent = `${slideshow.index + 1} / ${slideshow.slides.length}`;
  }

  updateNotesPanel();

  if (notifyRemote) {
    publishRemoteState();
  }
}

function nextSlide() {
  if (!slideshow) return;
  goToSlide(slideshow.index + 1);
}

function previousSlide() {
  if (!slideshow) return;
  goToSlide(slideshow.index - 1);
}

function toggleLaser() {
  if (!slideshow) return;

  slideshow.laserEnabled = !slideshow.laserEnabled;

  const btn = slideshow.toolbar.querySelector('[data-slide-laser]');
  btn?.classList.toggle('active', slideshow.laserEnabled);

  if (!slideshow.laserEnabled) {
    const dot = slideshow.root.querySelector('[data-laser-dot]');
    dot?.classList.remove('visible');
  }
}

function showLaserDot(x, y) {
  if (!slideshow) return;

  const dot = slideshow.root.querySelector('[data-laser-dot]');
  if (!dot) return;

  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  dot.classList.add('visible');

  clearTimeout(slideshow.laserHideTimer);
  slideshow.laserHideTimer = window.setTimeout(() => {
    dot.classList.remove('visible');
  }, 850);
}

function showLaserDotFromRemote(data = {}) {
  if (data.unit === 'slide') {
    const p = slideUnitToScreen(data);

    if (p) {
      showLaserDot(p.x, p.y);
      return;
    }
  }

  let x = Number(data.x || 0);
  let y = Number(data.y || 0);

  if (data.unit === 'viewport') {
    x = Math.max(0, Math.min(1, x)) * window.innerWidth;
    y = Math.max(0, Math.min(1, y)) * window.innerHeight;
  }

  showLaserDot(x, y);
}

function laserPointerMove(e) {
  if (!slideshow?.laserEnabled) return;

  showLaserDot(e.clientX, e.clientY);

  const unit = screenToSlideUnit(e.clientX, e.clientY);

  if (unit) {
    publishRemote({
      kind: 'laser',
      unit: 'slide',
      x: unit.x,
      y: unit.y,
      ts: Date.now(),
    });
  }
}

function toggleNotes() {
  if (!slideshow) return;

  slideshow.notesOpen = !slideshow.notesOpen;

  if (!slideshow.notesOpen) {
    slideshow.notesEl?.remove();
    slideshow.notesEl = null;
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'yanta-slideshow-notes';
  panel.innerHTML = `
    <div class="yanta-slideshow-notes-head">
      ${lucide('notebook-text', 15)}
      <strong data-notes-title>Speaker notes</strong>
      <button class="icon-btn" data-close-notes>${lucide('x', 14)}</button>
    </div>
    <textarea data-notes-input placeholder="Presenter notes for this slide…"></textarea>
  `;

  panel.querySelector('[data-close-notes]')?.addEventListener('click', toggleNotes);

  panel.querySelector('[data-notes-input]')?.addEventListener('input', (e) => {
    const slide = slideshow.slides[slideshow.index];
    if (!slide) return;

    setSlideNotes(
      slideshow.noteId,
      slideshow.drawingId,
      slide.id,
      e.target.value
    );

    slideshow.slides = listSlides(slideshow.noteId, slideshow.drawingId)
      .filter((s) => !s.hidden);

    publishRemoteState();
  });

  slideshow.root.append(panel);
  slideshow.notesEl = panel;

  updateNotesPanel();
}

function updateNotesPanel() {
  if (!slideshow?.notesEl) return;

  const slide = slideshow.slides[slideshow.index];
  const title = slideshow.notesEl.querySelector('[data-notes-title]');
  const input = slideshow.notesEl.querySelector('[data-notes-input]');

  if (title) title.textContent = slide?.title || 'Speaker notes';

  if (input && document.activeElement !== input) {
    input.value = slide?.notes?.markdown || '';
  }
}

// ------------------------------------------------------------
// Remote QR via signaling server
// ------------------------------------------------------------

function remotePayload() {
  return {
    v: 1,
    kind: 'yanta-slides-remote',
    topic: `slides-${uid()}-${Date.now()}`,
    token: uid() + uid(),
    origin: location.origin,
  };
}

function remoteUrl(payload) {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${location.origin}${location.pathname}${location.search}#slides-remote=${encoded}`;
}

function decodeRemoteHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#/, '');

  if (!raw.startsWith('slides-remote=')) return null;

  let b64 = raw.slice('slides-remote='.length)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  while (b64.length % 4) b64 += '=';

  try {
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export function isSlidesRemoteHash(hash = location.hash) {
  const payload = decodeRemoteHash(hash);
  return payload?.kind === 'yanta-slides-remote';
}

export function mountSlidesRemoteFromHash(hash = location.hash) {
  const payload = decodeRemoteHash(hash);

  if (payload?.kind !== 'yanta-slides-remote') {
    return false;
  }

  mountRemoteControl(payload);
  return true;
}

function openRemoteQrModal() {
  if (!slideshow) {
    toast('Start a slideshow first', 'error');
    return;
  }

  const payload = remotePayload();

  remoteTopic = payload.topic;
  remoteToken = payload.token;

  openRemotePresenterSocket();

  const modal = document.createElement('div');
  modal.className = 'yanta-slides-remote-modal';

  const url = remoteUrl(payload);

  modal.innerHTML = `
    <div class="yanta-slides-remote-card">
      <header>
        <h3>Remote Control</h3>
        <button class="icon-btn" data-close>${lucide('x', 16)}</button>
      </header>

      <div class="yanta-slides-remote-body">
        <div class="yanta-slides-remote-qr" data-qr></div>
        <input class="text-input" readonly value="${escapeAttr(url)}">

        <p style="margin:0;color:var(--text-dim);font-size:13px;line-height:1.45">
          Scan with your phone to control slide navigation and laser pointer.
        </p>
      </div>
    </div>
  `;

  modal.querySelector('[data-qr]')?.append(renderBrandedQrSvg(url, {
    size: 240,
    logo: BRAND_LOGO_SVG,
  }));

  modal.querySelector('[data-close]')?.addEventListener('click', () => modal.remove());

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.body.append(modal);
}

function openRemotePresenterSocket() {
  closeRemoteSocket();

  remoteSocket = new WebSocket(SIGNALING_URL);

  remoteSocket.addEventListener('open', () => {
    remoteSocket.send(JSON.stringify({
      type: 'subscribe',
      topics: [remoteTopic],
    }));

    publishRemoteState();
  });

  remoteSocket.addEventListener('message', (event) => {
    let msg = null;

    try {
      msg = JSON.parse(event.data);
    } catch {}

    const data = msg?.data;

    if (!data || data.token !== remoteToken) return;

    if (data.kind === 'next') nextSlide();
    if (data.kind === 'prev') previousSlide();

    if (data.kind === 'laser') {
      showLaserDotFromRemote(data);
    }
  });
}

function publishRemote(data) {
  if (!remoteSocket || remoteSocket.readyState !== WebSocket.OPEN || !remoteTopic) return;

  remoteSocket.send(JSON.stringify({
    type: 'publish',
    topic: remoteTopic,
    data: {
      ...data,
      token: remoteToken,
    },
  }));
}

async function publishRemoteState() {
  if (!slideshow) return;

  const slide = slideshow.slides[slideshow.index];
  const drawing = getDrawing(slideshow.noteId, slideshow.drawingId);

  let previewSvg = '';

  if (drawing && slide) {
    try {
      const svg = await renderSlideSvgString(drawing, slide);

      if (svg.length <= REMOTE_PREVIEW_MAX_CHARS) {
        previewSvg = svg;
      }
    } catch (err) {
      console.warn('[YANTA Slides] could not render remote preview', err);
    }
  }

  publishRemote({
    kind: 'state',
    index: slideshow.index,
    total: slideshow.slides.length,
    title: slide?.title || '',
    notes: slide?.notes?.markdown || '',
    previewSvg,
    slideId: slide?.id || '',
  });
}

function closeRemoteSocket() {
  if (!remoteSocket) return;

  try {
    remoteSocket.close();
  } catch {}

  remoteSocket = null;
  remoteTopic = '';
  remoteToken = '';
}

function remotePreviewSvgRect(screen) {
  const preview = screen.querySelector('[data-remote-slide-preview]');
  const svg = preview?.querySelector('svg');

  return svg?.getBoundingClientRect?.() || preview?.getBoundingClientRect?.() || null;
}

function showRemoteLaserDot(screen, x, y) {
  const pad = screen.querySelector('[data-laserpad]');
  const dot = screen.querySelector('[data-remote-laser-dot]');
  const svgRect = remotePreviewSvgRect(screen);
  const padRect = pad?.getBoundingClientRect?.();

  if (!dot || !svgRect || !padRect) return;

  dot.style.left = `${svgRect.left - padRect.left + clamp(x, 0, 1) * svgRect.width}px`;
  dot.style.top = `${svgRect.top - padRect.top + clamp(y, 0, 1) * svgRect.height}px`;
  dot.classList.add('visible');

  clearTimeout(dot._hideTimer);
  dot._hideTimer = window.setTimeout(() => {
    dot.classList.remove('visible');
  }, 850);
}

function mountRemoteControl(payload) {
  injectCss();

  document.body.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'yanta-slides-remote-screen';

  screen.innerHTML = `
    <div class="yanta-slides-remote-phone">
      <header>
        <h3 data-title>YANTA Remote</h3>
      </header>

      <div class="yanta-slides-remote-controls">
        <div class="yanta-slides-remote-preview" data-laserpad>
          <div class="yanta-slides-remote-preview-empty" data-remote-slide-preview>
            Waiting for slide…
          </div>
          <div class="yanta-slides-remote-laser-dot" data-remote-laser-dot></div>
        </div>

        <button class="btn" data-prev>${lucide('chevron-left', 26)} Prev</button>
        <button class="btn primary" data-next>Next ${lucide('chevron-right', 26)}</button>

        <textarea class="text-input" data-notes rows="7" readonly placeholder="Presenter notes"></textarea>
      </div>
    </div>
  `;

  document.body.append(screen);

  const ws = new WebSocket(SIGNALING_URL);

  const send = (kind, extra = {}) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'publish',
      topic: payload.topic,
      data: {
        kind,
        token: payload.token,
        ...extra,
      },
    }));
  };

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      type: 'subscribe',
      topics: [payload.topic],
    }));
  });

  ws.addEventListener('message', (event) => {
    let msg = null;

    try {
      msg = JSON.parse(event.data);
    } catch {}

    const data = msg?.data;
    if (!data || data.token !== payload.token) return;

    if (data.kind === 'state') {
      screen.querySelector('[data-title]').textContent =
        `${data.index + 1}/${data.total} · ${data.title || 'Slide'}`;

      screen.querySelector('[data-notes]').value = data.notes || '';

      const preview = screen.querySelector('[data-remote-slide-preview]');

      if (preview) {
        if (data.previewSvg) {
          preview.classList.remove('yanta-slides-remote-preview-empty');
          preview.innerHTML = data.previewSvg;
        } else {
          preview.classList.add('yanta-slides-remote-preview-empty');
          preview.textContent = 'Slide preview unavailable';
        }
      }
    }

    if (data.kind === 'laser' && data.unit === 'slide') {
      showRemoteLaserDot(
        screen,
        Number(data.x || 0),
        Number(data.y || 0)
      );
    }
  });

  screen.querySelector('[data-prev]')?.addEventListener('click', () => send('prev'));
  screen.querySelector('[data-next]')?.addEventListener('click', () => send('next'));

  const pad = screen.querySelector('[data-laserpad]');

  const sendLaserFromPointer = (e) => {
    const svgRect = remotePreviewSvgRect(screen);

    if (!svgRect || svgRect.width <= 0 || svgRect.height <= 0) return;

    const x = clamp((e.clientX - svgRect.left) / svgRect.width, 0, 1);
    const y = clamp((e.clientY - svgRect.top) / svgRect.height, 0, 1);

    showRemoteLaserDot(screen, x, y);

    send('laser', {
      unit: 'slide',
      x,
      y,
      ts: Date.now(),
    });
  };

  pad?.addEventListener('pointermove', (e) => {
    if (!(e.buttons & 1)) return;
    sendLaserFromPointer(e);
  });

  pad?.addEventListener('pointerdown', (e) => {
    try {
      pad.setPointerCapture?.(e.pointerId);
    } catch {}

    sendLaserFromPointer(e);
  });
}

// ------------------------------------------------------------
// slides:// embeds
// ------------------------------------------------------------

function hydrateSlidesEmbeds(root = document) {
  injectCss();

  root.querySelectorAll?.('.yanta-slides-embed[data-slides-draw-id]').forEach((node) => {
    const drawingId = node.dataset.slidesDrawId;
    const ref = drawingRef(state.currentNoteId, drawingId);

    if (!ref) {
      node.innerHTML = `<div class="tree-empty">Slideshow unavailable</div>`;
      return;
    }

    const slides = listSlides(ref.noteId, drawingId);

    node.innerHTML = `
      <div class="yanta-slides-embed-head">
        ${lucide('presentation', 18)}
        <strong>${escapeHtml(ref.drawing.title || 'Slideshow')}</strong>
        <span style="color:var(--text-faint);font-size:12px">${slides.length} slide${slides.length === 1 ? '' : 's'}</span>
        <button class="btn primary" data-start>${lucide('play', 13)} Start</button>
      </div>
    `;

    node.querySelector('[data-start]')?.addEventListener('click', () => {
      const embed = document.querySelector(`.yanta-draw-embed[data-draw-id="${CSS.escape(drawingId)}"]`);
      const api = embed ? getDrawingApiForEmbed(embed) : getActiveDrawingApi();

      startSlideshow({
        noteId: ref.noteId,
        drawingId,
        api,
        container: embed || getActiveDrawingHost(),
      });
    });
  });
}

export function setupSlides() {
  injectCss();

  window.addEventListener('yanta-preview-rendered', () => {
    document
      .querySelectorAll('.yanta-draw-embed[data-draw-id]')
      .forEach(enhanceDrawingEmbed);

    hydrateSlidesEmbeds(document);
  });

  window.addEventListener('yanta-draw-hydrate', (e) => {
    const root = e.detail?.root || document;

    root
      .querySelectorAll?.('.yanta-draw-embed[data-draw-id]')
      .forEach(enhanceDrawingEmbed);

    hydrateSlidesEmbeds(root);
  });

  window.addEventListener('yanta-draw-api-ready', (e) => {
    const detail = e.detail || {};

    if (detail.surface === 'fullscreen') {
      mountFullscreenSlidesDockFromApiReady(detail);
      return;
    }

    if (detail.embed) {
      enhanceDrawingEmbed(detail.embed);
    }
  });

  window.addEventListener('yanta-slides-updated', () => {
    document
      .querySelectorAll('.yanta-draw-embed[data-draw-id]')
      .forEach(scheduleSlidesPanelRefresh);

    hydrateSlidesEmbeds(document);

    if (fullscreenSlidesCtx) {
      renderFullscreenSlidesDock(fullscreenSlidesCtx);
    }
  });

  window.addEventListener('yanta-drawing-updated', () => {
    document
      .querySelectorAll('.yanta-draw-embed[data-draw-id]')
      .forEach(scheduleSlidesPanelRefresh);

    if (fullscreenSlidesCtx) {
      renderFullscreenSlidesDock(fullscreenSlidesCtx);
    }
  });

  window.addEventListener('yanta-draw-fullscreen-closed', () => {
    removeFullscreenSlidesDock();
  });
}