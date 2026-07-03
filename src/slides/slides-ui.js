// ============================================================
// YANTA Slides — UI, Slideshow, Laser, Remote QR
//
// Model:
// - A Drawing is an infinite board.
// - Slides are named rectangular camera targets on that board.
// - A slideshow smoothly moves the Excalidraw camera between targets.
//
// UX principles (SaaS-grade):
// - The slide toolbar is ONE compact row: a Slides toggle + count on the
//   left, a primary "Present" action and a single "⋯" menu on the right.
//   Everything else (create actions, connect, PDF) lives in that menu, so
//   there is never a wall of buttons — on desktop or mobile.
// - "Present" enters the Drawing's fullscreen stage, NOT browser fullscreen.
//   Browser fullscreen is an explicit opt-in inside the slideshow toolbar.
// - "Connect" bundles remote-control + present-on-another-screen with plain,
//   human wording ("this device" vs "another device (your phone)").
// - Modals participate in the app's overlay-history router, so browser /
//   Android Back closes them instead of navigating away.
// - Errors explain the cause and the fix (e.g. sign in to YANTA Cloud).
// ============================================================

import {
  state,
  toast,
  lucide,
  escapeHtml,
  escapeAttr,
  uid,
  store,
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
  reorderSlides,
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
  runDrawingApiUpdateWithoutSaving,
  openDrawModal,
} from '../draw.js';

import {
  openPresentationSessionModal,
} from '../presentation/presentation-ui.js';

import {
  openPresentationPairingInputModal,
} from '../presentation/presentation-pairing.js';

import {
  registerOverlayRoute,
  pushOverlayState,
  closeTopOverlay,
} from '../overlay-history.js';

import {
  showMenu,
} from '../tree.js';

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

// Tracks slide-frame opacity/lock state hidden during presentation so it can
// be restored afterwards. One entry per Excalidraw API instance.
const hiddenSlideFrameSnapshots = [];

// Bound middle-mouse-pan handlers, keyed by container to avoid double binding.
const middleMousePanBindings = new WeakSet();

const pendingPanelRefreshes = new Set();
let panelRefreshRaf = 0;
let cameraAnimationRaf = 0;

const DRAW_MOBILE_MQ = window.matchMedia?.('(pointer: coarse), (max-width: 760px)');

function isMobileSlidesUx() {
  return !!DRAW_MOBILE_MQ?.matches;
}

// ============================================================
// Overlay-history-aware modal helper
//
// Every transient slides modal (Connect chooser, Remote QR) registers an
// overlay route and pushes an overlay history entry, so the browser / Android
// Back button closes it instead of navigating the app. Esc is handled by the
// central overlay router too.
// ============================================================

const slidesOverlayHandles = new Map();

function openSlidesOverlay(id, buildEl, { onClose } = {}) {
  // Close any existing instance of the same overlay first.
  closeSlidesOverlay(id, { fromHistory: true });

  const node = buildEl();
  if (!node) return null;

  document.body.append(node);

  const handle = {
    node,
    onClose: typeof onClose === 'function' ? onClose : null,
  };

  slidesOverlayHandles.set(id, handle);

  // Register (idempotent) the overlay route so Back/Esc close it.
  registerOverlayRoute(id, {
    open: () => {
      // History restored directly onto this overlay while it isn't mounted:
      // nothing to reopen (transient modals aren't reconstructable), so no-op.
    },
    close: ({ fromHistory = false } = {}) => {
      closeSlidesOverlay(id, { fromHistory });
    },
    isOpen: () => slidesOverlayHandles.has(id),
  });

  pushOverlayState(id, {});

  return node;
}

function closeSlidesOverlay(id, { fromHistory = false } = {}) {
  const handle = slidesOverlayHandles.get(id);
  if (!handle) return;

  slidesOverlayHandles.delete(id);

  try {
    handle.node.remove();
  } catch {}

  handle.onClose?.();

  // If the user closed via UI (not Back), pop the overlay history entry so the
  // URL/state stays consistent.
  if (!fromHistory) {
    closeTopOverlay();
  }
}

function injectCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-slides-css';
  style.textContent = `
/* ============================================================
   Slide toolbar — ONE compact row
   ============================================================ */

.yanta-slides-panel {
  border-top: 1px solid var(--border);
  background: var(--bg-elev-2);
  padding: 7px 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.yanta-slides-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.yanta-slides-bar .grow {
  flex: 1;
  min-width: 0;
}

.yanta-slides-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elev);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex: 0 0 auto;
}

.yanta-slides-toggle:hover {
  border-color: var(--accent);
}

.yanta-slides-toggle.is-open {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev));
}

.yanta-slides-toggle .yanta-slides-count {
  color: var(--text-faint);
  font-weight: 750;
  font-size: 11px;
}

.yanta-slides-toggle.is-open .yanta-slides-count {
  color: inherit;
}

.yanta-slides-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
  flex: 0 0 auto;
}

.yanta-slides-primary:hover {
  filter: brightness(1.05);
}

.yanta-slides-primary:disabled {
  opacity: .5;
  cursor: not-allowed;
  filter: none;
}

.yanta-slides-more {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elev);
  color: var(--text);
  cursor: pointer;
  flex: 0 0 auto;
}

.yanta-slides-more:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* Slide thumbnail strip */

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
  grid-template-columns: 52px minmax(0, 1fr) auto;
  gap: 7px;
  align-items: center;
  cursor: grab;
  text-align: left;
  user-select: none;
  -webkit-user-select: none;
}

.yanta-slide-chip:active {
  cursor: grabbing;
}

.yanta-slide-chip.is-dragging {
  opacity: .42;
  transform: scale(.985);
}

.yanta-slides-strip.is-reordering {
  cursor: grabbing;
}

.yanta-slides-strip.is-reordering .yanta-slide-chip:not(.is-dragging) {
  transition:
    transform 120ms ease,
    border-color 120ms ease,
    background-color 120ms ease;
}

.yanta-slide-chip.is-drop-before {
  border-left-color: var(--accent);
  box-shadow: -3px 0 0 var(--accent);
}

.yanta-slide-chip.is-drop-after {
  border-right-color: var(--accent);
  box-shadow: 3px 0 0 var(--accent);
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

.yanta-slides-empty-hint {
  color: var(--text-faint);
  font-size: 12px;
  padding: 4px 2px;
}

/* Slide draw overlay */

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

/* ============================================================
   Slideshow overlay
   ============================================================ */

.yanta-slideshow {
  position: fixed;
  inset: 0;
  z-index: 620;
  pointer-events: none;
}

.yanta-slideshow-progress {
  position: fixed;
  left: 0;
  top: 0;
  height: 3px;
  width: 0%;
  z-index: 624;
  pointer-events: none;
  background: var(--accent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 70%, transparent);
  transition: width 320ms cubic-bezier(.4, 0, .2, 1);
}

.yanta-slideshow-toolbar {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 622;
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
  max-width: calc(100vw - 20px);
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
  min-width: 76px;
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
  cursor: move;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.yanta-slideshow-notes-head button,
.yanta-slideshow-notes-head input,
.yanta-slideshow-notes-head textarea {
  cursor: pointer;
}

.yanta-slideshow-notes.is-dragging {
  user-select: none;
  -webkit-user-select: none;
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
  cursor: text;
}

.yanta-laser-layer {
  position: fixed;
  inset: 0;
  z-index: 621;
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

/* ============================================================
   Remote control + Connect chooser modals
   ============================================================ */

.yanta-slides-remote-modal,
.yanta-slides-remote-screen,
.yanta-slides-connect-modal {
  position: fixed;
  inset: 0;
  z-index: 560;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0,0,0,.58);
  backdrop-filter: blur(8px);
}

.yanta-slides-remote-card,
.yanta-slides-remote-phone,
.yanta-slides-connect-card {
  width: min(500px, 94vw);
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: 0 28px 90px rgba(0,0,0,.48);
  overflow: hidden;
}

.yanta-slides-remote-card header,
.yanta-slides-remote-phone header,
.yanta-slides-connect-card header {
  min-height: 52px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-elev-2);
  border-bottom: 1px solid var(--border);
}

.yanta-slides-remote-card header h3,
.yanta-slides-remote-phone header h3,
.yanta-slides-connect-card header h3 {
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

.yanta-slides-connect-body {
  padding: 16px;
  display: grid;
  gap: 10px;
}

.yanta-slides-connect-option {
  width: 100%;
  min-height: 74px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev-2);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.yanta-slides-connect-option:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
}

.yanta-slides-connect-icon {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  flex: 0 0 auto;
}

.yanta-slides-connect-text strong {
  display: block;
  font-size: 14px;
}

.yanta-slides-connect-text small {
  display: block;
  margin-top: 3px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.4;
}

/* ============================================================
   slides:// embed
   ============================================================ */

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

/* ============================================================
   Fullscreen dock
   ============================================================ */

.yanta-slides-fullscreen-dock {
  position: fixed;
  left: max(14px, env(safe-area-inset-left));
  bottom: max(14px, env(safe-area-inset-bottom));
  z-index: 392;
  width: min(720px, calc(100vw - 28px));
  max-height: min(46vh, 380px);
  overflow: auto;

  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-elev) 94%, transparent);
  color: var(--text);

  box-shadow: 0 18px 60px rgba(0,0,0,.38);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  /* Hidden until opened from the fullscreen "Slides" header button. */
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.yanta-slides-fullscreen-dock.is-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
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

body.yanta-slideshow-active .yanta-slides-fullscreen-dock,
.yanta-slides-fullscreen-dock.is-hidden-during-slideshow {
  display: none !important;
}

@media (max-width: 680px) {
  .yanta-slides-remote-controls {
    grid-template-columns: 1fr;
  }
}

/* ============================================================
   Immersive Slideshow Mode
   ============================================================ */

/*
  On DESKTOP immersive mode hides all controls (clean stage, Esc reveals).
  On MOBILE we always keep the slideshow toolbar reachable, because there is
  no reliable Esc key and users otherwise get stuck.
*/
body.yanta-slideshow-active.yanta-slideshow-immersive .yanta-draw-head,
body.yanta-slideshow-active.yanta-slideshow-immersive .yanta-slides-fullscreen-dock,
body.yanta-slideshow-active.yanta-slideshow-immersive .yanta-slideshow-notes {
  display: none !important;
}

@media (min-width: 761px) and (pointer: fine) {
  body.yanta-slideshow-active.yanta-slideshow-immersive .yanta-slideshow-toolbar {
    display: none !important;
  }
}

body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .App-toolbar,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .FixedSideContainer,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .HintViewer,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .help-icon,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .layer-ui__wrapper__top-right,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .layer-ui__wrapper__footer-right,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .layer-ui__wrapper__footer-left,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .Island,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .App-menu,
body.yanta-slideshow-active.yanta-slideshow-immersive .excalidraw .Stack_vertical {
  display: none !important;
  pointer-events: none !important;
}

.yanta-slideshow-immersive-hint {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 623;

  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;

  background: color-mix(in srgb, var(--bg-elev) 88%, transparent);
  color: var(--text-dim);

  font-size: 12px;
  font-weight: 750;

  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  opacity: 0;
  pointer-events: none;

  animation: yanta-slideshow-immersive-hint 3.2s ease forwards;
}

.yanta-slides-context-separator {
  height: 1px;
  margin: 5px 6px;
  background: var(--border);
  opacity: 0.8;
}

.yanta-slides-context-item {
  width: 100%;
  min-width: 200px;
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

.yanta-slides-context-item:hover {
  background: var(--bg-elev-2);
  color: var(--accent);
}

body:not(.yanta-slideshow-immersive) .yanta-slideshow-immersive-hint {
  display: none !important;
}

@keyframes yanta-slideshow-immersive-hint {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }

  12% {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  72% {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  100% {
    opacity: 0;
    transform: translateX(-50%) translateY(-6px);
  }
}

/* Standalone remote page: self-contained button/input styles, because the
   global app stylesheet is not loaded on the /#slides-remote route. */
.yanta-slides-remote-screen .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev-2);
  color: var(--text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  padding: 12px 16px;
}
.yanta-slides-remote-screen .btn:hover {
  border-color: var(--accent);
}
.yanta-slides-remote-screen .btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.yanta-slides-remote-screen .text-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
  color: var(--text);
  font: inherit;
  padding: 10px 12px;
  box-sizing: border-box;
  resize: vertical;
}
.yanta-slides-remote-screen .icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
  color: var(--text);
  cursor: pointer;
}
  `;

  document.head.append(style);
}

// ============================================================
// Slide toolbar — ONE compact row + overflow menu
//
// Layout:
//   [ Slides · N ]        [ Present ▸ ] [ ⋯ ]
//   [ thumbnail strip ......................... ]   (only when open)
//
// The overflow menu (⋯) holds every secondary action, grouped:
//   Create slide  → Draw slide / Current view / Selection
//   Present        → Connect a device / Export PDF
//
// Both the inline embed panel and the fullscreen dock render the same
// toolbar. The only difference is the data-attribute name so existing
// querySelectors stay scoped.
// ============================================================

const SLIDE_CREATE_ACTIONS = [
  { action: 'draw', icon: 'scan', label: 'Draw a slide frame' },
  { action: 'current-view', icon: 'focus', label: 'Use current view' },
  { action: 'selection', icon: 'scan-check', label: 'Use selected objects' },
];

function slidesActionAttr(fullscreen) {
  return fullscreen ? 'data-fs-slides-action' : 'data-slides-action';
}

function renderSlidesBarHtml(slides, { open, fullscreen }) {
  const attr = slidesActionAttr(fullscreen);
  const hasSlides = slides.length > 0;

  return `
    <div class="yanta-slides-bar">
      <button class="yanta-slides-toggle ${open ? 'is-open' : ''}" ${attr}="toggle" type="button" aria-expanded="${open ? 'true' : 'false'}">
        ${lucide('presentation', 14)}
        <span>Slides</span>
        <span class="yanta-slides-count">· ${slides.length}</span>
      </button>

      <span class="grow"></span>

      <button class="yanta-slides-primary" ${attr}="present" type="button" ${hasSlides ? '' : 'disabled'} title="${hasSlides ? 'Present slideshow' : 'Create a slide first'}">
        ${lucide('play', 13)}
        <span>Present</span>
      </button>

      <button class="yanta-slides-more" ${attr}="more" type="button" title="More slide actions" aria-label="More slide actions">
        ${lucide('ellipsis', 16)}
      </button>
    </div>
  `;
}

function renderSlidesStripHtml(slides) {
  if (!slides.length) {
    return `
      <div class="yanta-slides-strip">
        <div class="yanta-slides-empty-hint">
          No slides yet. Open the ⋯ menu → “Create slide” to capture part of the board.
        </div>
      </div>
    `;
  }

  return `
    <div class="yanta-slides-strip">
      ${slides.map((slide, index) => `
        <button class="yanta-slide-chip" draggable="true" data-slide-id="${escapeAttr(slide.id)}">
          <span class="yanta-slide-chip-thumb" data-slide-thumb="${escapeAttr(slide.id)}">
            ${lucide('presentation', 13)}
          </span>
          <span class="yanta-slide-chip-title">
            <span class="yanta-slide-chip-num">${index + 1}</span>
            ${escapeHtml(slide.title)}
          </span>
          <span class="yanta-slide-chip-menu">${lucide('chevron-right', 13)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

/**
 * The single ⋯ menu. Groups create + present-adjacent actions with dividers.
 *
 * We keep to the widely-supported showMenu item shape ({label, icon, action}
 * plus 'hr' separators). Actions that require slides guard themselves with an
 * explanatory toast rather than relying on a disabled-item feature.
 */
function openSlidesOverflowMenu(anchor, ctx, { getApi, refresh, hasSlides } = {}) {
  const rect = anchor.getBoundingClientRect();

  const api = () => (typeof getApi === 'function' ? getApi() : ctx.api);
  const done = () => refresh?.();

  const requireSlides = (fn) => () => {
    if (!hasSlides) {
      toast('Create at least one slide first', 'error');
      return;
    }
    fn();
  };

  const items = [
    {
      label: 'Draw a slide frame',
      icon: 'scan',
      action: () => {
        const liveApi = api();
        if (!liveApi) {
          toast('Drawing is still loading — try again in a moment', 'error');
          return;
        }
        startSlideDrawMode({
          noteId: ctx.noteId,
          drawingId: ctx.drawingId,
          api: liveApi,
          container: ctx.container,
          onDone: done,
        });
      },
    },
    {
      label: 'Slide from current view',
      icon: 'focus',
      action: () => createSlideFromCurrentView({
        noteId: ctx.noteId,
        drawingId: ctx.drawingId,
        api: api(),
        container: ctx.container,
        onDone: done,
      }),
    },
    {
      label: 'Slide from selection',
      icon: 'scan-check',
      action: () => createSlideFromSelection({
        noteId: ctx.noteId,
        drawingId: ctx.drawingId,
        api: api(),
        onDone: done,
      }),
    },
    'hr',
    {
      label: 'Connect a device…',
      icon: 'screen-share',
      action: requireSlides(() => openConnectDeviceModal({
        ...ctx,
        api: api(),
      })),
    },
    {
      label: 'Export as PDF',
      icon: 'file-down',
      action: requireSlides(() => exportDrawingSlidesToPdf(ctx.noteId, ctx.drawingId)),
    },
  ];

  showMenu(rect.right, rect.bottom + 6, items, {
    align: 'end',
  });
}

/**
 * Wire the compact toolbar. `getApi()` re-reads the live API (inline embeds
 * may re-mount). `refresh()` re-renders the owning panel/dock.
 */
function wireSlidesBar(root, ctx, {
  fullscreen = false,
  getApi,
  refresh,
  onToggle,
  hasSlides,
} = {}) {
  const attr = slidesActionAttr(fullscreen);
  const q = (action) => root.querySelector(`[${attr}="${action}"]`);

  q('toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle?.();
  });

  q('present')?.addEventListener('click', () => {
    presentSlides(ctx, {
      fromFullscreen: fullscreen,
      getApi,
    });
  });

  q('more')?.addEventListener('click', (e) => {
    openSlidesOverflowMenu(e.currentTarget, ctx, {
      getApi,
      refresh,
      hasSlides,
    });
  });
}

// ============================================================
// Connect a device — merged remote + present-on-another-screen
// ============================================================

const CONNECT_OVERLAY_ID = 'slides-connect';

function openConnectDeviceModal(ctx) {
  injectCss();

  openSlidesOverlay(CONNECT_OVERLAY_ID, () => {
    const modal = document.createElement('div');
    modal.className = 'yanta-slides-connect-modal';

    modal.innerHTML = `
      <div class="yanta-slides-connect-card">
        <header>
          ${lucide('screen-share', 18)}
          <h3>Connect a device</h3>
          <button class="icon-btn" data-connect-close>${lucide('x', 16)}</button>
        </header>

        <div class="yanta-slides-connect-body">
          <button class="yanta-slides-connect-option" data-connect-option="phone-remote">
            <span class="yanta-slides-connect-icon">${lucide('smartphone', 20)}</span>
            <span class="yanta-slides-connect-text">
              <strong>Use your phone as a remote</strong>
              <small>Slides stay on this screen. Scan a QR with your phone to flip slides and point a laser.</small>
            </span>
            ${lucide('chevron-right', 16)}
          </button>

          <button class="yanta-slides-connect-option" data-connect-option="send-to-screen">
            <span class="yanta-slides-connect-icon">${lucide('cast', 20)}</span>
            <span class="yanta-slides-connect-text">
              <strong>Send the slides to another screen</strong>
              <small>Open yanta.page/present on a TV or projector, then scan or paste its code to hand off the presentation.</small>
            </span>
            ${lucide('chevron-right', 16)}
          </button>

          <button class="yanta-slides-connect-option" data-connect-option="share-link">
            <span class="yanta-slides-connect-icon">${lucide('link', 20)}</span>
            <span class="yanta-slides-connect-text">
              <strong>Get a shareable display link</strong>
              <small>Generate an encrypted link or QR to open on any other device yourself.</small>
            </span>
            ${lucide('chevron-right', 16)}
          </button>
        </div>
      </div>
    `;

    const close = () => closeSlidesOverlay(CONNECT_OVERLAY_ID);

    modal.querySelector('[data-connect-close]')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    modal.querySelector('[data-connect-option="phone-remote"]')?.addEventListener('click', () => {
      close();
      ensureSlideshowForRemote({
        ...ctx,
        api: ctx.api || currentApiForDrawing(ctx.noteId, ctx.drawingId),
      });
      openRemoteQrModal();
    });

    modal.querySelector('[data-connect-option="send-to-screen"]')?.addEventListener('click', () => {
      close();
      // Join a waiting display (scan/paste its pairing code).
      openPresentationPairingInputModal();
    });

    modal.querySelector('[data-connect-option="share-link"]')?.addEventListener('click', async () => {
      close();
      // Host: generate a link/QR. This requires YANTA Cloud — guard with a
      // clear, actionable error instead of a cryptic failure.
      await openShareDisplayLinkGuarded(ctx);
    });

    return modal;
  });
}

/**
 * "Share a display link" needs a configured YANTA Cloud vault (the encrypted
 * session is stored there). If it isn't set up, explain why and offer to open
 * the setup instead of throwing a vague error deep inside the session code.
 */
async function openShareDisplayLinkGuarded(ctx) {
  let vaultId = '';

  try {
    vaultId = await store.settings.get('sync2.yantaCloud.vaultId', '');
  } catch {}

  if (!vaultId) {
    const setup = await yantaConfirm({
      title: 'YANTA Cloud needed for display links',
      message: [
        'Sending slides to another device uses an end-to-end-encrypted session that lives in your YANTA Cloud vault.',
        '',
        'You are not signed in to YANTA Cloud yet, so there is nowhere to store the session.',
        '',
        'Set up YANTA Cloud now? It only takes a moment, and “Use your phone as a remote” works without it.',
      ].join('\n'),
      confirmLabel: 'Set up YANTA Cloud',
      cancelLabel: 'Not now',
      icon: 'cloud',
    });

    if (setup) {
      try {
        const { openYantaCloudSetup } = await import('../sync2/yanta-cloud-setup-ui.js');
        await openYantaCloudSetup();
      } catch (err) {
        console.error('[YANTA Slides] could not open cloud setup', err);
        toast('Could not open YANTA Cloud setup', 'error');
      }
    }

    return;
  }

  openPresentationSessionModal({
    noteId: ctx.noteId,
    drawingId: ctx.drawingId,
  });
}

// ============================================================
// Present entry point
//
// Present does NOT enter browser fullscreen. It ensures the drawing is shown
// on its big fullscreen stage (opening it if we started from an inline embed
// or the read-only preview), then starts the slideshow there. Browser
// fullscreen remains an explicit toggle in the slideshow toolbar.
// ============================================================

async function presentSlides(ctx, { fromFullscreen = false, getApi } = {}) {
  const slides = listSlides(ctx.noteId, ctx.drawingId).filter((s) => !s.hidden);

  if (!slides.length) {
    toast('Create at least one slide before presenting', 'error');
    return;
  }

  if (fromFullscreen) {
    startSlideshow({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: (typeof getApi === 'function' ? getApi() : ctx.api),
      container: ctx.container,
    });
    return;
  }

  try {
    await openDrawModal(ctx.drawingId, ctx.noteId, {
      transition: true,
    });
  } catch (err) {
    console.warn('[YANTA Slides] could not open fullscreen for presentation', err);
    startSlideshow({
      noteId: ctx.noteId,
      drawingId: ctx.drawingId,
      api: (typeof getApi === 'function' ? getApi() : ctx.api),
      container: ctx.container,
    });
    return;
  }

  waitForFullscreenApiThenPresent(ctx.noteId, ctx.drawingId);
}

function waitForFullscreenApiThenPresent(noteId, drawingId, attempts = 0) {
  const api = getActiveDrawingApi?.();
  const container = getActiveDrawingHost?.();

  if (api && container) {
    startSlideshow({
      noteId,
      drawingId,
      api,
      container,
    });
    return;
  }

  if (attempts > 40) {
    startSlideshow({ noteId, drawingId });
    return;
  }

  requestAnimationFrame(() => {
    waitForFullscreenApiThenPresent(noteId, drawingId, attempts + 1);
  });
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

function isTextInputTarget(target) {
  const el = target instanceof Element ? target : null;
  if (!el) return false;

  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return true;
  }

  return !!el.closest?.(
    [
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="textbox"]',
    ].join(',')
  );
}

function clampPanelPosition(panel, left, top) {
  const rect = panel.getBoundingClientRect();
  const margin = 10;

  return {
    left: clamp(
      left,
      margin,
      Math.max(margin, window.innerWidth - rect.width - margin)
    ),
    top: clamp(
      top,
      margin,
      Math.max(margin, window.innerHeight - rect.height - margin)
    ),
  };
}

function sceneElementsForApi(api) {
  try {
    return (
      api?.getSceneElementsIncludingDeleted?.() ||
      api?.getSceneElements?.() ||
      []
    );
  } catch {
    return [];
  }
}

function hideSlideFramesForPresentation(api) {
  if (!api) return;

  const elements = sceneElementsForApi(api);
  if (!Array.isArray(elements) || !elements.length) return;

  const frames = elements.filter((el) =>
    el &&
    !el.isDeleted &&
    isSlideFrameElement(el)
  );

  if (!frames.length) return;

  const alreadyHidden = hiddenSlideFrameSnapshots.some((entry) => entry.api === api);
  if (alreadyHidden) return;

  const originals = new Map(
    frames.map((frame) => [
      frame.id,
      {
        opacity: frame.opacity,
        locked: frame.locked,
      },
    ])
  );

  hiddenSlideFrameSnapshots.push({
    api,
    originals,
  });

  const nextElements = elements.map((el) =>
    originals.has(el.id)
      ? {
          ...el,
          opacity: 0,
          locked: true,
        }
      : el
  );

  runDrawingApiUpdateWithoutSaving(api, {
    elements: nextElements,
  });
}

function restoreSlideFramesAfterPresentation() {
  while (hiddenSlideFrameSnapshots.length) {
    const entry = hiddenSlideFrameSnapshots.pop();
    const api = entry?.api;
    const originals = entry?.originals;

    if (!api || !originals?.size) continue;

    const elements = sceneElementsForApi(api);
    if (!Array.isArray(elements) || !elements.length) continue;

    const nextElements = elements.map((el) => {
      const original = originals.get(el?.id);
      if (!original) return el;

      return {
        ...el,
        opacity: original.opacity ?? 100,
        locked: original.locked ?? false,
      };
    });

    runDrawingApiUpdateWithoutSaving(api, {
      elements: nextElements,
    });
  }
}

function pointInBounds(point, bounds, pad = 8) {
  return (
    point.x >= bounds.x - pad &&
    point.x <= bounds.x + bounds.width + pad &&
    point.y >= bounds.y - pad &&
    point.y <= bounds.y + bounds.height + pad
  );
}

function slideFrameAtScreenPoint(api, container, clientX, clientY) {
  if (!api) return null;

  const scene = screenToScene({
    api,
    container,
    clientX,
    clientY,
  });

  if (scene.invalid) return null;

  const elements = sceneElementsForApi(api);

  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];

    if (!el || el.isDeleted) continue;
    if (!isSlideFrameElement(el)) continue;

    const bounds = elementBounds(el);

    if (pointInBounds(scene, bounds, 10)) {
      return el;
    }
  }

  return null;
}

function excalidrawFrameAtScreenPoint(api, container, clientX, clientY) {
  if (!api) return null;

  const scene = screenToScene({
    api,
    container,
    clientX,
    clientY,
  });

  if (scene.invalid) return null;

  const elements = sceneElementsForApi(api);

  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];

    if (!el || el.isDeleted) continue;
    if (el.type !== 'frame') continue;
    if (isSlideFrameElement(el)) continue;

    if (pointInBounds(scene, elementBounds(el), 6)) {
      return el;
    }
  }

  return null;
}

function slideBoundsFromFrameElement(frame) {
  return normalizeSlideBounds(elementBounds(frame));
}

function createSlideFromExcalidrawFrame({
  noteId,
  drawingId,
  api,
  frame,
  onDone,
} = {}) {
  if (!api || !frame) {
    toast('Drawing is not ready yet', 'error');
    return null;
  }

  const bounds = slideBoundsFromFrameElement(frame);

  if (bounds.width < 40 || bounds.height < 40) {
    toast('Frame is too small for a slide', 'error');
    return null;
  }

  const slide = createSlide(noteId, drawingId, {
    title: frame.name || '',
    bounds,
    api,
  });

  if (slide) {
    toast(`Created ${slide.title}`, 'success');
    onDone?.(slide);
  }

  return slide;
}

function withoutSelectedId(selectedElementIds, id) {
  if (!selectedElementIds || !id) return selectedElementIds || {};

  if (Array.isArray(selectedElementIds)) {
    return selectedElementIds.filter((x) => x !== id);
  }

  if (selectedElementIds instanceof Set) {
    const next = new Set(selectedElementIds);
    next.delete(id);
    return next;
  }

  if (typeof selectedElementIds === 'object') {
    const next = { ...selectedElementIds };
    delete next[id];
    return next;
  }

  return selectedElementIds;
}

function bindSlideFrameMiddleMousePan(container, api) {
  if (!container || !api || middleMousePanBindings.has(container)) return;

  middleMousePanBindings.add(container);

  container.addEventListener('pointerdown', (e) => {
    // Middle mouse only. Left mouse should still move/resize slide frames.
    if (e.button !== 1) return;

    const frame = slideFrameAtScreenPoint(
      api,
      container,
      e.clientX,
      e.clientY
    );

    if (!frame) return;

    /*
      Do not stop propagation:
      Excalidraw must still receive middle mouse and start native panning.
      We only remove the slide frame from selection before drag evaluation.
    */
    e.preventDefault();

    const appState = api.getAppState?.() || {};

    runDrawingApiUpdateWithoutSaving(api, {
      appState: {
        selectedElementIds: withoutSelectedId(
          appState.selectedElementIds,
          frame.id
        ),
      },
    });
  }, true);
}

/**
 * Browser client coords -> Excalidraw infinite-board scene coords.
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
    currentApiForDrawing(slideshow.noteId, slideshow.drawingId) ||
    slideshow.api;

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
    currentApiForDrawing(slideshow.noteId, slideshow.drawingId) ||
    slideshow.api;

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

  return {
    scrollX: rect.width / (2 * zoom) - centerX,
    scrollY: rect.height / (2 * zoom) - centerY,
    zoom,
  };
}

function updateCamera(api, camera) {
  if (!api || !camera) return;

  runDrawingApiUpdateWithoutSaving(api, {
    appState: {
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: {
        value: camera.zoom,
      },
    },
  }, {
    releaseMs: 260,
  });
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

function slideChipFromEventTarget(target) {
  return target?.closest?.('.yanta-slide-chip[data-slide-id]') || null;
}

function orderedSlideIdsFromStrip(strip) {
  return [...strip.querySelectorAll('.yanta-slide-chip[data-slide-id]')]
    .map((node) => node.dataset.slideId)
    .filter(Boolean);
}

function clearSlideDropIndicators(strip) {
  strip
    ?.querySelectorAll?.('.is-drop-before, .is-drop-after')
    ?.forEach((node) => {
      node.classList.remove('is-drop-before', 'is-drop-after');
    });
}

function slideDragInsertTarget(strip, clientX) {
  const chips = [
    ...strip.querySelectorAll('.yanta-slide-chip[data-slide-id]:not(.is-dragging)'),
  ];

  for (const chip of chips) {
    const rect = chip.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;

    if (clientX < midpoint) {
      return {
        chip,
        position: 'before',
      };
    }
  }

  const last = chips.at(-1) || null;

  return {
    chip: last,
    position: 'after',
  };
}

function moveDraggedSlideChip(strip, draggedChip, clientX) {
  if (!strip || !draggedChip) return;

  const target = slideDragInsertTarget(strip, clientX);

  clearSlideDropIndicators(strip);

  if (!target.chip) {
    strip.append(draggedChip);
    return;
  }

  if (target.position === 'before') {
    target.chip.classList.add('is-drop-before');

    if (target.chip !== draggedChip.nextElementSibling) {
      strip.insertBefore(draggedChip, target.chip);
    }

    return;
  }

  target.chip.classList.add('is-drop-after');

  if (target.chip.nextSibling !== draggedChip) {
    strip.insertBefore(draggedChip, target.chip.nextSibling);
  }
}

function bindSlideStripReorder(strip, {
  noteId,
  drawingId,
  refresh,
} = {}) {
  if (!strip || strip.dataset.reorderBound === '1') return;

  strip.dataset.reorderBound = '1';

  let draggedChip = null;
  let draggedId = '';
  let originalOrder = [];

  const suppressNextClick = () => {
    strip.dataset.suppressClick = '1';

    window.setTimeout(() => {
      delete strip.dataset.suppressClick;
    }, 180);
  };

  const cleanup = () => {
    draggedChip?.classList.remove('is-dragging');
    draggedChip = null;
    draggedId = '';
    originalOrder = [];

    strip.classList.remove('is-reordering');
    clearSlideDropIndicators(strip);

    suppressNextClick();
  };

  strip.addEventListener('dragstart', (e) => {
    const chip = slideChipFromEventTarget(e.target);
    if (!chip) return;

    draggedChip = chip;
    draggedId = chip.dataset.slideId || '';
    originalOrder = orderedSlideIdsFromStrip(strip);

    if (!draggedId) return;

    strip.classList.add('is-reordering');
    chip.classList.add('is-dragging');

    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId);
    } catch {}
  });

  strip.addEventListener('dragover', (e) => {
    if (!draggedChip) return;

    e.preventDefault();

    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {}

    moveDraggedSlideChip(strip, draggedChip, e.clientX);
  });

  strip.addEventListener('drop', (e) => {
    if (!draggedChip || !draggedId) return;

    e.preventDefault();
    e.stopPropagation();

    const nextOrder = orderedSlideIdsFromStrip(strip);

    const hasSameSlides =
      originalOrder.length === nextOrder.length &&
      originalOrder.every((id) => nextOrder.includes(id));

    const changed =
      hasSameSlides &&
      originalOrder.some((id, index) => nextOrder[index] !== id);

    cleanup();

    if (!changed) return;

    reorderSlides(noteId, drawingId, nextOrder);
    refresh?.();
  });

  strip.addEventListener('dragend', cleanup);
  strip.addEventListener('dragcancel', cleanup);

  strip.addEventListener('click', (e) => {
    if (strip.dataset.suppressClick !== '1') return;

    e.preventDefault();
    e.stopPropagation();
  }, true);
}

function bindSlideChipInteractions(root, ctx, {
  getApi,
  refresh,
} = {}) {
  const api = () => (typeof getApi === 'function' ? getApi() : ctx.api);

  root.querySelectorAll('[data-slide-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.closest('.yanta-slides-strip')?.dataset.suppressClick === '1') {
        return;
      }

      const slide = listSlides(ctx.noteId, ctx.drawingId)
        .find((s) => s.id === btn.dataset.slideId);

      scrollToSlide(api(), slide, ctx.container);
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      openSlideMiniMenu(e.clientX, e.clientY, {
        noteId: ctx.noteId,
        drawingId: ctx.drawingId,
        slideId: btn.dataset.slideId,
        api: api(),
        refresh,
      });
    });
  });
}


// ============================================================
// Inline embed panel + fullscreen dock
// ============================================================

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
  const slides = syncSlidesFromScene(ctx.noteId, ctx.drawingId, ctx.api);

  panel.innerHTML = `
    ${renderSlidesBarHtml(slides, { open, fullscreen: false })}
    ${open ? renderSlidesStripHtml(slides) : ''}
  `;

  const getApi = () => getDrawingApiForEmbed(embed);
  const refresh = () => {
    setSlidesPanelOpen(embed, true);
    refreshSlidesPanel(embed);
  };

  wireSlidesBar(panel, ctx, {
    fullscreen: false,
    getApi,
    refresh,
    hasSlides: slides.length > 0,
    onToggle: () => {
      setSlidesPanelOpen(embed, !open);
      refreshSlidesPanel(embed);
    },
  });

  if (!open) return;

  hydrateSlideThumbnails(panel, ctx.drawing, slides).catch((err) => {
    console.warn('[YANTA Slides] could not hydrate thumbnails', err);
  });

  bindSlideStripReorder(panel.querySelector('.yanta-slides-strip'), {
    noteId: ctx.noteId,
    drawingId: ctx.drawingId,
    refresh,
  });

  bindSlideChipInteractions(panel, ctx, {
    getApi,
    refresh,
  });
}

function removeFullscreenSlidesDock() {
  fullscreenSlidesDock?.remove();
  fullscreenSlidesDock = null;
  fullscreenSlidesCtx = null;

  window.dispatchEvent(new CustomEvent('yanta-fullscreen-slides-visibility', {
    detail: { open: false },
  }));
}

function ensureFullscreenSlidesDock() {
  injectCss();

  if (fullscreenSlidesDock?.isConnected) {
    if (slideshow) {
      fullscreenSlidesDock.classList.add('is-hidden-during-slideshow');
    }

    return fullscreenSlidesDock;
  }

  fullscreenSlidesDock = document.createElement('div');
  fullscreenSlidesDock.className = 'yanta-slides-fullscreen-dock';
  fullscreenSlidesDock.dataset.slidesFullscreenDock = '1';

  // Hidden until the user opens Slides from the fullscreen header.
  fullscreenSlidesDock.dataset.docked = '0';

  if (slideshow) {
    fullscreenSlidesDock.classList.add('is-hidden-during-slideshow');
  }

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
    <div class="yanta-slides-panel">
      ${renderSlidesBarHtml(slides, { open, fullscreen: true })}
      ${open ? renderSlidesStripHtml(slides) : ''}
    </div>
  `;

  const refresh = () => {
    dock.dataset.open = '1';
    renderFullscreenSlidesDock(ctx);
  };

  wireSlidesBar(dock, ctx, {
    fullscreen: true,
    getApi: () => ctx.api,
    refresh,
    hasSlides: slides.length > 0,
    onToggle: () => {
      dock.dataset.open = open ? '0' : '1';
      renderFullscreenSlidesDock(ctx);
    },
  });

  if (!open) return;

  hydrateSlideThumbnails(dock, drawing, slides).catch((err) => {
    console.warn('[YANTA Slides] fullscreen thumbnails failed', err);
  });

  bindSlideStripReorder(dock.querySelector('.yanta-slides-strip'), {
    noteId: ctx.noteId,
    drawingId: ctx.drawingId,
    refresh,
  });

  bindSlideChipInteractions(dock, ctx, {
    getApi: () => ctx.api,
    refresh,
  });
}

// ============================================================
// Native Excalidraw context menu — YANTA Slides entries
//
// Adds "YANTA: Make slide from frame" on real Excalidraw frames and
// "YANTA: Slide from selection" when objects are selected. Uses a
// MutationObserver to inject into Excalidraw's own context menu, so the
// native menu behavior (positioning, Esc, outside-click) is preserved.
// ============================================================

const slidesContextState = new WeakMap();

function isElementVisible(el) {
  if (!el || !(el instanceof Element)) return false;

  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function distanceFromRectToPoint(rect, x, y) {
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
    if (el.closest('.yanta-slides-panel')) return false;
    if (el.closest('.ctx-menu')) return false;
    return true;
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) =>
    distanceFromRectToPoint(a.getBoundingClientRect(), ctx.clientX, ctx.clientY) -
    distanceFromRectToPoint(b.getBoundingClientRect(), ctx.clientX, ctx.clientY)
  );

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

function makeSlidesContextButton({ icon, label, onClick }) {
  const btn = document.createElement('button');

  btn.type = 'button';
  btn.className = 'context-menu-option yanta-slides-context-item';
  btn.setAttribute('role', 'menuitem');
  btn.setAttribute('data-yanta-slides-context-item', '1');
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
      console.error('[YANTA Slides] context action failed', err);
      toast('Slide action failed', 'error');
    }
  }, true);

  return btn;
}

function injectSlidesItemsIntoNativeContextMenu(container) {
  const ctx = slidesContextState.get(container);
  if (!ctx?.api) return;
  if (!ctx.frame && !ctx.hasSelection) return;

  const menu = findOpenExcalidrawContextMenu(ctx);
  if (!menu) return;
  if (menu.querySelector('[data-yanta-slides-context-item="1"]')) return;

  const separator = document.createElement('div');
  separator.className = 'yanta-slides-context-separator';
  separator.setAttribute('data-yanta-slides-context-item', '1');

  menu.append(separator);

  const refresh = () => {
    if (isFullscreenSlidesDockVisible() && fullscreenSlidesCtx) {
      renderFullscreenSlidesDock(fullscreenSlidesCtx);
    }

    document
      .querySelectorAll('.yanta-draw-embed[data-draw-id]')
      .forEach(scheduleSlidesPanelRefresh);
  };

  if (ctx.frame) {
    menu.append(makeSlidesContextButton({
      icon: 'presentation',
      label: 'YANTA: Make slide from frame',
      onClick: () => {
        createSlideFromExcalidrawFrame({
          noteId: ctx.noteId,
          drawingId: ctx.drawingId,
          api: ctx.api,
          frame: ctx.frame,
          onDone: refresh,
        });
      },
    }));
  }

  if (ctx.hasSelection) {
    menu.append(makeSlidesContextButton({
      icon: 'scan-check',
      label: 'YANTA: Slide from selection',
      onClick: () => {
        createSlideFromSelection({
          noteId: ctx.noteId,
          drawingId: ctx.drawingId,
          api: ctx.api,
          onDone: refresh,
        });
      },
    }));
  }
}

function bindSlidesNativeContextMenu(container, {
  noteId,
  drawingId,
  api,
} = {}) {
  if (!container || !api) return;
  if (container.dataset.slidesCtxBound === '1') return;

  container.dataset.slidesCtxBound = '1';

  const ctx = {
    api,
    noteId,
    drawingId,
    frame: null,
    hasSelection: false,
    clientX: 0,
    clientY: 0,
    observer: null,
    observerStopTimer: 0,
  };

  slidesContextState.set(container, ctx);

  const stopObserving = () => {
    if (ctx.observer) {
      try {
        ctx.observer.disconnect();
      } catch {}
      ctx.observer = null;
    }
    clearTimeout(ctx.observerStopTimer);
    ctx.observerStopTimer = 0;
  };

  const startObserving = () => {
    // Only observe briefly, while Excalidraw is about to open its menu.
    // A permanent document-wide subtree observer is a serious perf drain.
    if (ctx.observer) return;

    ctx.observer = new MutationObserver(() => {
      injectSlidesItemsIntoNativeContextMenu(container);
    });

    ctx.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Auto-stop shortly after; the menu appears within a frame or two.
    ctx.observerStopTimer = window.setTimeout(stopObserving, 1200);
  };

  container.addEventListener('contextmenu', (e) => {
    ctx.api = api;
    ctx.clientX = e.clientX;
    ctx.clientY = e.clientY;

    ctx.frame = excalidrawFrameAtScreenPoint(api, container, e.clientX, e.clientY);

    const selected = normalizeSelectedIds(
      api.getAppState?.().selectedElementIds
    );

    const elements = sceneElementsForApi(api);
    ctx.hasSelection = elements.some((el) =>
      el &&
      !el.isDeleted &&
      selected.has(el.id) &&
      !isSlideFrameElement(el)
    );

    // Nothing YANTA-specific to add: don't spin up the observer at all.
    if (!ctx.frame && !ctx.hasSelection) {
      return;
    }

    startObserving();

    setTimeout(() => injectSlidesItemsIntoNativeContextMenu(container), 0);
    setTimeout(() => injectSlidesItemsIntoNativeContextMenu(container), 40);
    setTimeout(() => injectSlidesItemsIntoNativeContextMenu(container), 120);
  }, true);

  // Stop observing once a menu item was injected or the menu closed.
  document.addEventListener('pointerdown', () => {
    if (ctx.observer) {
      // Give the click a moment to resolve, then stop.
      clearTimeout(ctx.observerStopTimer);
      ctx.observerStopTimer = window.setTimeout(stopObserving, 300);
    }
  }, true);
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

    bindSlideFrameMiddleMousePan(container, api);
    bindSlidesNativeContextMenu(container, {
      noteId,
      drawingId,
      api,
    });
  
    // Remember context so the header toggle can open the dock on demand.
    fullscreenSlidesCtx = {
      noteId,
      drawingId,
      api,
      container,
    };

  // If the dock is already open (e.g. re-mount after API swap), re-render it.
  if (isFullscreenSlidesDockVisible()) {
    renderFullscreenSlidesDock(fullscreenSlidesCtx);
  }

  /*
    Critical:
    If user starts Present in inline mode and then opens Full screen,
    the slideshow must switch to the new fullscreen Excalidraw API.
  */
  if (
    slideshow &&
    slideshow.noteId === noteId &&
    slideshow.drawingId === drawingId
  ) {
    slideshow.api = api;
    slideshow.container = container;

    hideSlideFramesForPresentation(api);

    requestAnimationFrame(() => {
      goToSlide(slideshow.index, {
        notifyRemote: false,
      });
    });
  }
}

function isFullscreenSlidesDockVisible() {
  return (
    fullscreenSlidesDock?.isConnected &&
    fullscreenSlidesDock.dataset.docked === '1'
  );
}

function setFullscreenSlidesDockVisible(visible) {
  const dock = ensureFullscreenSlidesDock();

  dock.dataset.docked = visible ? '1' : '0';
  dock.classList.toggle('is-visible', !!visible);

  window.dispatchEvent(new CustomEvent('yanta-fullscreen-slides-visibility', {
    detail: { open: !!visible },
  }));

  if (visible && fullscreenSlidesCtx) {
    dock.dataset.open = '1';
    renderFullscreenSlidesDock(fullscreenSlidesCtx);
  }
}

function toggleFullscreenSlidesDock(ctx) {
  const noteId = ctx?.noteId || fullscreenSlidesCtx?.noteId || '';
  const drawingId = ctx?.drawingId || fullscreenSlidesCtx?.drawingId || '';
  if (!noteId || !drawingId) return;
  fullscreenSlidesCtx = {
    noteId,
    drawingId,
    api:
      getActiveDrawingApi?.() ||
      fullscreenSlidesCtx?.api ||
      currentApiForDrawing(noteId, drawingId) ||
      null,
    container:
      getActiveDrawingHost?.() ||
      fullscreenSlidesCtx?.container ||
      null,
  };
  setFullscreenSlidesDockVisible(!isFullscreenSlidesDockVisible());
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


// ============================================================
// Slideshow
// ============================================================

function requestSlideshowFullscreen() {
  const target =
    getActiveDrawingHost?.() ||
    document.querySelector('.yanta-draw-modal') ||
    document.documentElement;

  try {
    if (!document.fullscreenElement) {
      target.requestFullscreen?.();
    }
  } catch {}
}

function exitSlideshowFullscreen() {
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    }
  } catch {}
}

function setSlideshowImmersive(active) {
  if (!slideshow) return;

  slideshow.immersive = !!active;

  document.body.classList.toggle(
    'yanta-slideshow-immersive',
    slideshow.immersive
  );

  const immersiveBtn = slideshow.toolbar?.querySelector?.('[data-slide-immersive]');
  immersiveBtn?.classList.toggle('active', slideshow.immersive);

  if (slideshow.immersive) {
    ensureSlideshowImmersiveHint();
  } else {
    document
      .querySelectorAll('.yanta-slideshow-immersive-hint')
      .forEach((node) => node.remove());
  }

  requestAnimationFrame(() => {
    try {
      slideshow.api?.refresh?.();
    } catch {}
  });
}

function ensureSlideshowImmersiveHint() {
  document
    .querySelectorAll('.yanta-slideshow-immersive-hint')
    .forEach((node) => node.remove());

  // On mobile there is no reliable Esc key, so the hint would be misleading.
  if (isMobileSlidesUx()) return;

  const hint = document.createElement('div');
  hint.className = 'yanta-slideshow-immersive-hint';
  hint.textContent = 'Press Esc for controls';

  document.body.append(hint);

  window.setTimeout(() => {
    hint.remove();
  }, 3600);
}

function slideshowFullscreenChangeHandler() {
  if (!slideshow) return;

  if (!document.fullscreenElement && slideshow.immersive) {
    setSlideshowImmersive(false);
  }
}

function updateSlideshowProgress() {
  if (!slideshow?.progressEl) return;

  const total = slideshow.slides.length;
  const pct = total <= 1
    ? 100
    : (slideshow.index / (total - 1)) * 100;

  slideshow.progressEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
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

  const progressEl = document.createElement('div');
  progressEl.className = 'yanta-slideshow-progress';

  const toolbar = document.createElement('div');
  toolbar.className = 'yanta-slideshow-toolbar';

  toolbar.innerHTML = `
    <button class="icon-btn" data-slide-prev title="Previous (←)">${lucide('chevron-left', 18)}</button>
    <span class="yanta-slideshow-count" data-slide-count></span>
    <button class="icon-btn" data-slide-next title="Next (→)">${lucide('chevron-right', 18)}</button>
    <button class="icon-btn" data-slide-laser title="Laser pointer (L)">${lucide('mouse-pointer-2', 17)}</button>
    <button class="icon-btn" data-slide-notes title="Speaker notes (N)">${lucide('notebook-text', 17)}</button>
    <button class="icon-btn" data-slide-connect title="Connect a device">${lucide('screen-share', 17)}</button>
    <button class="icon-btn" data-slide-immersive title="Browser fullscreen">${lucide('maximize', 17)}</button>
    <button class="icon-btn" data-slide-exit title="Exit slideshow (Esc)">${lucide('x', 17)}</button>
  `;

  const laserLayer = document.createElement('div');
  laserLayer.className = 'yanta-laser-layer';
  laserLayer.innerHTML = `<div class="yanta-laser-dot" data-laser-dot></div>`;

  root.append(progressEl, toolbar, laserLayer);
  document.body.append(root);

  slideshow = {
    noteId,
    drawingId,
    api: api || currentApiForDrawing(noteId, drawingId),
    container,
    slides,
    index: Math.max(0, Math.min(slides.length - 1, startIndex)),
    root,
    toolbar,
    progressEl,
    laserLayer,
    laserEnabled: false,
    notesOpen: false,
    notesEl: null,
    laserHideTimer: 0,
    immersive: true,
  };

  document.body.classList.add('yanta-slideshow-active');
  fullscreenSlidesDock?.classList.add('is-hidden-during-slideshow');

  document.body.classList.add('yanta-slideshow-immersive');
  document.addEventListener('fullscreenchange', slideshowFullscreenChangeHandler);

  /*
    Present no longer forces browser fullscreen. The drawing is already shown
    on its big fullscreen stage (see presentSlides). Immersive mode only hides
    the app/Excalidraw chrome; browser fullscreen stays an explicit toggle.
  */

  hideSlideFramesForPresentation(slideshow.api);

  toolbar.querySelector('[data-slide-prev]')?.addEventListener('click', previousSlide);
  toolbar.querySelector('[data-slide-next]')?.addEventListener('click', nextSlide);
  toolbar.querySelector('[data-slide-exit]')?.addEventListener('click', stopSlideshow);
  toolbar.querySelector('[data-slide-laser]')?.addEventListener('click', toggleLaser);
  toolbar.querySelector('[data-slide-notes]')?.addEventListener('click', toggleNotes);

  toolbar.querySelector('[data-slide-connect]')?.addEventListener('click', () => {
    openConnectDeviceModal({
      noteId,
      drawingId,
      api: slideshow.api,
      container: slideshow.container,
    });
  });

  toolbar.querySelector('[data-slide-immersive]')?.addEventListener('click', () => {
    if (document.fullscreenElement) {
      exitSlideshowFullscreen();
    } else {
      requestSlideshowFullscreen();
      setSlideshowImmersive(true);
    }
  });

  document.addEventListener('keydown', slideshowKeyHandler, true);
  document.addEventListener('pointermove', laserPointerMove, true);

  goToSlide(slideshow.index, {
    notifyRemote: false,
  });

  return slideshow;
}

function goToSlide(index, {
  notifyRemote = true,
} = {}) {
  if (!slideshow) return;

  slideshow.index = Math.max(0, Math.min(slideshow.slides.length - 1, index));

  const slide = slideshow.slides[slideshow.index];

  const liveApi =
    currentApiForDrawing(slideshow.noteId, slideshow.drawingId) ||
    slideshow.api;

  const liveContainer =
    getActiveDrawingHost?.() ||
    slideshow.container;

  slideshow.api = liveApi;
  slideshow.container = liveContainer;

  hideSlideFramesForPresentation(liveApi);

  scrollToSlide(liveApi, slide, liveContainer);

  const count = slideshow.toolbar.querySelector('[data-slide-count]');

  if (count) {
    count.textContent = `${slideshow.index + 1} / ${slideshow.slides.length}`;
  }

  updateSlideshowProgress();
  updateNotesPanel();

  if (notifyRemote) {
    publishRemoteState();
  }
}
export function stopSlideshow() {
  if (!slideshow) return;

  document.removeEventListener('keydown', slideshowKeyHandler, true);
  document.removeEventListener('pointermove', laserPointerMove, true);

  slideshow.notesEl?.remove();
  slideshow.root?.remove();

  closeRemoteSocket();

  restoreSlideFramesAfterPresentation();

  document.body.classList.remove('yanta-slideshow-active');
  document.body.classList.remove('yanta-slideshow-immersive');
  fullscreenSlidesDock?.classList.remove('is-hidden-during-slideshow');

  document.removeEventListener('fullscreenchange', slideshowFullscreenChangeHandler);

  document
    .querySelectorAll('.yanta-slideshow-immersive-hint')
    .forEach((node) => node.remove());

  cancelAnimationFrame(cameraAnimationRaf);
  cameraAnimationRaf = 0;

  exitSlideshowFullscreen();

  slideshow = null;
}

function slideshowKeyHandler(e) {
  if (!slideshow) return;

  /*
    Critical UX:
    Presenter Notes contain a textarea. Slideshow shortcuts must not steal
    normal typing, arrows, Space, N/L etc. from native inputs.
  */
  if (isTextInputTarget(e.target)) {
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();

    /*
      Escape ladder:
      1) exit browser fullscreen if active
      2) reveal controls if immersive (desktop)
      3) exit slideshow
    */
    if (document.fullscreenElement) {
      exitSlideshowFullscreen();
      setSlideshowImmersive(false);
      return;
    }

    if (slideshow.immersive && !isMobileSlidesUx()) {
      setSlideshowImmersive(false);
      return;
    }

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

function makePresenterNotesDraggable(panel) {
  const handle = panel?.querySelector('.yanta-slideshow-notes-head');
  if (!panel || !handle || panel.dataset.dragBound === '1') return;

  panel.dataset.dragBound = '1';

  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const stop = () => {
    if (!dragging) return;

    dragging = false;
    pointerId = null;

    panel.classList.remove('is-dragging');

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  };

  const onMove = (e) => {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    e.preventDefault();

    const next = clampPanelPosition(
      panel,
      startLeft + (e.clientX - startX),
      startTop + (e.clientY - startY)
    );

    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    panel.style.right = 'auto';
  };

  const onUp = (e) => {
    if (pointerId != null && e.pointerId !== pointerId) return;
    stop();
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;

    if (
      e.target.closest?.(
        'button, input, textarea, select, a, [contenteditable="true"]'
      )
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const rect = panel.getBoundingClientRect();

    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    panel.classList.add('is-dragging');

    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {}

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }, true);
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

  makePresenterNotesDraggable(panel);

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
  document.body.innerHTML = '';
  injectCss();

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

      // Route through presentSlides so slides://-embeds also open the big
      // fullscreen stage instead of driving a tiny inline surface.
      presentSlides({
        noteId: ref.noteId,
        drawingId,
        api: embed ? getDrawingApiForEmbed(embed) : getActiveDrawingApi(),
        container: embed || getActiveDrawingHost(),
      }, {
        fromFullscreen: false,
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
      requestAnimationFrame(() => {
        const container =
          getActiveDrawingHost?.() ||
          document.querySelector('.yanta-draw-fullscreen-host') ||
          null;
        // Middle-mouse pan and native-context-menu binding both happen inside
        // mountFullscreenSlidesDockFromApiReady; no need to bind pan twice.
        mountFullscreenSlidesDockFromApiReady({
          ...detail,
          container,
        });
      });
      return;
    }

    if (detail.embed) {
      requestAnimationFrame(() => {
        const container =
          detail.embed.querySelector('.yanta-draw-inline-host') ||
          detail.embed;

        bindSlideFrameMiddleMousePan(container, detail.api);

        bindSlidesNativeContextMenu(container, {
          noteId: detail.noteId,
          drawingId: detail.drawingId,
          api: detail.api,
        });

        enhanceDrawingEmbed(detail.embed);
      });
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

  window.addEventListener('yanta-toggle-fullscreen-slides', (e) => {
    toggleFullscreenSlidesDock(e.detail || {});
  });
}