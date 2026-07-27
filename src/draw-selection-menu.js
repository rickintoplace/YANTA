// ============================================================
// YANTA — Excalidraw selection quick actions.
//
// Selecting something in a drawing pops a compact, mobile-first icon rail
// next to the selection: copy (with a format flyout), duplicate, add to the
// personal library, link a note, and a hand-off into Excalidraw's own context
// menu for everything else.
//
// Design notes:
// - ONE overlay for the whole app. The drawing surface that last reported a
//   selection owns it, so several inline drawings can never fight over it.
// - Positioned from a freshly measured canvas rect (never from the possibly
//   stale appState offsets), so the rail stays glued to the selection while
//   panning, zooming, resizing and page-scrolling.
// - Hidden during every transient interaction — dragging, resizing, text
//   editing, and whenever Excalidraw's own context menu opens — so the two
//   menus never overlap.
// ============================================================

import {
  lucide,
  toast,
  uid,
  escapeHtml,
  structuredCloneSafe,
} from './core.js';

import { t } from './i18n/index.js';
import { loadExcalidraw, currentExcalidrawTheme } from './draw-runtime.js';

// Clears Excalidraw's own selection outline and its resize handles.
const RAIL_GAP = 18;
const FLYOUT_GAP = 8;
const EDGE_PAD = 10;
const LONG_PRESS_MS = 420;
const DONE_FEEDBACK_MS = 1100;

/*
  Excalidraw refuses these element types in the library (they carry binary or
  remote payloads a library item cannot own). Mirrored here so the button can
  be disabled up front instead of failing after the tap.
*/
const LIBRARY_BLOCKED_TYPES = new Set(['image', 'embeddable', 'iframe']);

// Tools for which a selection is meaningful; drawing tools clear it anyway.
const SELECTION_TOOLS = new Set(['selection', 'lasso']);

/*
  Copy formats, most useful first:
  - json  Excalidraw's own clipboard payload — pastes back into any drawing
          (this one, another YANTA drawing, excalidraw.com) fully editable.
  - png   A real image on the clipboard — pastes into YANTA Chat, Slack, docs.
  - svg   Vector markup as text — for code, Markdown and design tools.
*/
const COPY_FORMATS = [
  { format: 'json', icon: 'shapes', label: 'copyElements' },
  { format: 'png', icon: 'image', label: 'copyPng' },
  { format: 'svg', icon: 'file-code', label: 'copySvg' },
];

const controllers = new WeakMap();

let overlay = null;
let owner = null;
let excalidrawLib = null;
let injectedCss = false;

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

/**
 * Attaches the quick action rail to one mounted Excalidraw instance.
 * Call from the `excalidrawAPI` callback (the API is guaranteed there);
 * re-binding the same container just re-points it at the new API.
 */
export function bindDrawSelectionMenu(container, api, {
  editable = true,
  onLinkNote = null,
} = {}) {
  if (!container || !api) return;

  const existing = controllers.get(container);

  if (existing) {
    existing.api = api;
    existing.editable = editable;
    existing.onLinkNote = onLinkNote;
    return;
  }

  const ctx = {
    container,
    api,
    editable,
    onLinkNote,
    suspended: false,
    frame: 0,
    lastElements: null,
    lastSignature: '',
    side: 'right',
    unsubscribe: null,
  };

  ctx.unsubscribe = api.onChange?.((elements, appState) => {
    const signature = stateSignature(appState);

    if (elements === ctx.lastElements && signature === ctx.lastSignature) return;

    ctx.lastElements = elements;
    ctx.lastSignature = signature;

    scheduleUpdate(ctx);
  });

  controllers.set(container, ctx);

  // The library is already in memory by the time a drawing is mounted; this
  // only hands us the reference for the (synchronous) positioning math.
  loadExcalidraw().then((mod) => {
    excalidrawLib = mod;
  }).catch(() => {});
}

/**
 * Detaches a surface. Called from the React unmount cleanup of every drawing,
 * so a closed drawing can never leave its rail behind.
 */
export function destroyDrawSelectionMenu(container) {
  const ctx = container && controllers.get(container);
  if (!ctx) return;

  controllers.delete(container);
  cancelAnimationFrame(ctx.frame);

  try {
    ctx.unsubscribe?.();
  } catch {}

  hide(ctx);
}

// ------------------------------------------------------------
// Selection state
// ------------------------------------------------------------

function stateSignature(appState = {}) {
  return [
    Object.keys(appState.selectedElementIds || {}).join(','),
    appState.scrollX,
    appState.scrollY,
    appState.zoom?.value,
    appState.activeTool?.type,
    isBlocked(appState) ? 1 : 0,
  ].join('|');
}

function isBlocked(appState = {}) {
  return !!(
    appState.viewModeEnabled ||
    appState.contextMenu ||
    appState.openDialog ||
    appState.newElement ||
    appState.multiElement ||
    appState.selectionElement ||
    appState.resizingElement ||
    appState.isResizing ||
    appState.isRotating ||
    appState.selectedElementsAreBeingDragged ||
    appState.editingTextElement ||
    appState.editingLinearElement ||
    appState.editingFrame ||
    appState.croppingElementId ||
    !SELECTION_TOOLS.has(appState.activeTool?.type)
  );
}

/**
 * Splits the current selection into
 *   direct — exactly what Excalidraw considers selected (drives the selection
 *            box, so it drives our placement and hit anchor), and
 *   full   — plus bound labels and frame children, which every content action
 *            (copy, library) has to carry along.
 */
function readSelection(api, appState) {
  const ids = appState.selectedElementIds || {};
  const elements = api.getSceneElements?.() || [];

  const direct = elements.filter((el) => ids[el.id]);
  if (!direct.length) return null;

  const frameIds = new Set(
    direct.filter((el) => el.type === 'frame' || el.type === 'magicframe')
      .map((el) => el.id)
  );

  const full = elements.filter((el) =>
    ids[el.id] ||
    (el.containerId && ids[el.containerId]) ||
    (el.frameId && frameIds.has(el.frameId))
  );

  return { direct, full };
}

// ------------------------------------------------------------
// Geometry
// ------------------------------------------------------------

function canvasRect(container) {
  const el = container.querySelector?.('.excalidraw');
  return (el || container).getBoundingClientRect();
}

/**
 * Scene → client coordinates, relative to a canvas origin.
 *
 * For placement we pass a live rect rather than appState.offsetLeft/offsetTop,
 * which Excalidraw only refreshes on its own schedule and which lags behind
 * page scrolling. Coordinates we hand *back* to Excalidraw use its own offsets
 * instead, so its inverse conversion lands on exactly the point we meant.
 */
function sceneToClient(origin, appState) {
  const zoom = Number(appState.zoom?.value ?? 1) || 1;
  const scrollX = Number(appState.scrollX || 0);
  const scrollY = Number(appState.scrollY || 0);

  return (sceneX, sceneY) => ({
    x: (sceneX + scrollX) * zoom + origin.left,
    y: (sceneY + scrollY) * zoom + origin.top,
  });
}

function safeArea() {
  const vv = window.visualViewport;

  const left = (vv?.offsetLeft || 0) + EDGE_PAD;
  const top = (vv?.offsetTop || 0) + EDGE_PAD;

  return {
    left,
    top,
    right: left + (vv?.width || window.innerWidth) - EDGE_PAD * 2,
    bottom: top + (vv?.height || window.innerHeight) - EDGE_PAD * 2,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max < min ? min : max));
}

function intersects(a, b) {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

function rotatePoint(x, y, cx, cy, angle) {
  if (!angle) return { x, y };

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;

  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

/**
 * A scene point that actually *hits* the selection, so a synthetic right-click
 * opens Excalidraw's element menu instead of its canvas menu.
 *
 * Excalidraw only falls back to the common bounding box for 2+ selected
 * elements; a single element has to be hit for real. Hollow shapes are only
 * hit near their stroke and linear/freedraw elements barely touch their own
 * bounding box, so both get a point on their geometry.
 */
function hitAnchor(direct) {
  const [x1, y1, x2, y2] = excalidrawLib.getCommonBounds(direct);

  if (direct.length !== 1) {
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }

  const el = direct[0];
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const points = Array.isArray(el.points) ? el.points : null;

  if (points?.length >= 2) {
    const [ax, ay] = points[Math.floor((points.length - 1) / 2)];
    const [bx, by] = points[Math.ceil((points.length - 1) / 2)];

    return rotatePoint(
      el.x + (ax + bx) / 2,
      el.y + (ay + by) / 2,
      cx,
      cy,
      el.angle
    );
  }

  const hollow =
    !el.backgroundColor ||
    el.backgroundColor === 'transparent';

  return hollow
    ? rotatePoint(cx, el.y, cx, cy, el.angle)
    : { x: cx, y: cy };
}

// ------------------------------------------------------------
// Update loop
// ------------------------------------------------------------

function scheduleUpdate(ctx) {
  if (ctx.frame) return;

  ctx.frame = requestAnimationFrame(() => {
    ctx.frame = 0;
    update(ctx);
  });
}

function update(ctx) {
  const api = ctx.api;

  if (!api || !ctx.editable || ctx.suspended || !excalidrawLib) return hide(ctx);
  if (!ctx.container.isConnected) return destroyDrawSelectionMenu(ctx.container);

  const appState = api.getAppState?.() || {};
  if (isBlocked(appState)) return hide(ctx);

  const selection = readSelection(api, appState);
  if (!selection) return hide(ctx);

  const rect = canvasRect(ctx.container);
  const toClient = sceneToClient(rect, appState);
  const [x1, y1, x2, y2] = excalidrawLib.getCommonBounds(selection.direct);
  const a = toClient(x1, y1);
  const b = toClient(x2, y2);

  const box = { left: a.x, top: a.y, right: b.x, bottom: b.y };

  // Selection scrolled out of the canvas viewport: nothing to point at.
  if (!intersects(box, rect)) return hide(ctx);

  ctx.selection = selection;
  show(ctx, box, rect);
}

// ------------------------------------------------------------
// Overlay
// ------------------------------------------------------------

function ensureOverlay() {
  if (overlay) return overlay;

  injectCss();

  const root = document.createElement('div');
  root.className = 'yanta-draw-selmenu';
  root.hidden = true;

  const rail = document.createElement('div');
  rail.className = 'yanta-draw-selmenu-rail';
  rail.setAttribute('role', 'toolbar');
  rail.setAttribute('aria-label', t('draw.selection.label'));

  const flyout = document.createElement('div');
  flyout.className = 'yanta-draw-selmenu-flyout';
  flyout.setAttribute('role', 'menu');
  flyout.setAttribute('aria-label', t('draw.selection.copyFormats'));
  flyout.hidden = true;

  root.append(rail, flyout);
  document.body.append(root);

  overlay = { root, rail, flyout, size: null, variant: '' };
  bindOverlayInteractions(overlay);

  return overlay;
}

function makeButton({ id, icon, label, hasFlyout = false }) {
  const btn = document.createElement('button');

  btn.type = 'button';
  btn.className = 'yanta-draw-selmenu-btn';
  btn.dataset.action = id;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = lucide(icon, 18);

  if (hasFlyout) {
    btn.dataset.more = '1';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
  }

  return btn;
}

function buildRail(ov, ctx) {
  const variant = ctx.onLinkNote ? 'linkable' : 'plain';
  if (ov.variant === variant) return;

  ov.variant = variant;
  ov.size = null;

  const items = [
    { id: 'copy', icon: 'copy', label: t('draw.selection.copy'), hasFlyout: true },
    { id: 'duplicate', icon: 'copy-plus', label: t('draw.selection.duplicate') },
    { id: 'library', icon: 'sticker', label: t('draw.selection.addToLibrary') },
  ];

  if (ctx.onLinkNote) {
    items.push({ id: 'link', icon: 'link', label: t('draw.selection.linkNote') });
  }

  const separator = document.createElement('div');
  separator.className = 'yanta-draw-selmenu-sep';

  ov.rail.replaceChildren(
    ...items.map(makeButton),
    separator,
    makeButton({ id: 'more', icon: 'ellipsis', label: t('draw.selection.more') })
  );

  ov.flyout.replaceChildren(...COPY_FORMATS.map(({ format, icon, label }) => {
    const item = document.createElement('button');

    item.type = 'button';
    item.className = 'yanta-draw-selmenu-item';
    item.dataset.format = format;
    item.setAttribute('role', 'menuitem');
    item.innerHTML = `${lucide(icon, 16)}<span>${escapeHtml(t(`draw.selection.${label}`))}</span>`;

    return item;
  }));
}

function show(ctx, box, rect) {
  const ov = ensureOverlay();

  buildRail(ov, ctx);

  if (owner !== ctx) {
    closeFlyout();
    owner = ctx;
  }

  ov.root.hidden = false;

  syncDisabledState(ctx, ov);

  // offsetWidth/Height, not getBoundingClientRect: the rail carries the
  // pop-in scale transform, which would skew a measured rect.
  if (!ov.size) {
    ov.size = {
      width: ov.rail.offsetWidth,
      height: ov.rail.offsetHeight,
    };
  }

  placeRail(ctx, ov, box, rect);

  // Fade in only on the first frame the rail is up — later repositions must
  // track the selection instantly.
  if (!ov.root.classList.contains('is-visible')) {
    requestAnimationFrame(() => ov.root.classList.add('is-visible'));
    attachViewportListeners();
  }

  if (!ov.flyout.hidden) placeFlyout(ctx, ov);
}

/**
 * Where the rail may live: inside the canvas when it fits there, so it reads
 * as part of the drawing — otherwise anywhere on screen, because a small
 * inline embed must never clip it.
 */
function placementBounds(rect, size) {
  const safe = safeArea();

  const inner = {
    left: Math.max(safe.left, rect.left + EDGE_PAD),
    top: Math.max(safe.top, rect.top + EDGE_PAD),
    right: Math.min(safe.right, rect.right - EDGE_PAD),
    bottom: Math.min(safe.bottom, rect.bottom - EDGE_PAD),
  };

  const fitsX = inner.right - inner.left >= size.width;
  const fitsY = inner.bottom - inner.top >= size.height;

  return {
    left: fitsX ? inner.left : safe.left,
    right: fitsX ? inner.right : safe.right,
    top: fitsY ? inner.top : safe.top,
    bottom: fitsY ? inner.bottom : safe.bottom,
  };
}

function placeRail(ctx, ov, box, rect) {
  const { width, height } = ov.size;
  const safe = placementBounds(rect, ov.size);

  const roomRight = safe.right - box.right - RAIL_GAP;
  const roomLeft = box.left - safe.left - RAIL_GAP;

  let left;

  if (roomRight >= width) {
    left = box.right + RAIL_GAP;
    ctx.side = 'right';
  } else if (roomLeft >= width) {
    left = box.left - RAIL_GAP - width;
    ctx.side = 'left';
  } else {
    // Selection fills the viewport: hug the roomier edge and accept the overlap.
    ctx.side = roomRight >= roomLeft ? 'right' : 'left';
    left = ctx.side === 'right' ? safe.right - width : safe.left;
  }

  // Centred on the *visible* part of the selection, so a partly scrolled-out
  // selection still gets its rail next to what the user can actually see.
  const visibleTop = Math.max(box.top, safe.top);
  const visibleBottom = Math.min(box.bottom, safe.bottom);
  const top = (visibleTop + visibleBottom) / 2 - height / 2;

  ctx.railBox = {
    left: Math.round(clamp(left, safe.left, safe.right - width)),
    top: Math.round(clamp(top, safe.top, safe.bottom - height)),
    width,
    height,
  };

  ov.rail.style.left = `${ctx.railBox.left}px`;
  ov.rail.style.top = `${ctx.railBox.top}px`;

  // Grow out of the selection, not out of thin air.
  ov.rail.style.transformOrigin = ctx.side === 'right' ? 'left center' : 'right center';
}

function placeFlyout(ctx, ov) {
  const safe = safeArea();
  const rail = ctx.railBox;
  const width = ov.flyout.offsetWidth;
  const height = ov.flyout.offsetHeight;

  // Continue outwards, away from the selection — and fold back over the rail
  // if that would leave the viewport.
  const outward = ctx.side === 'right'
    ? rail.left + rail.width + FLYOUT_GAP
    : rail.left - FLYOUT_GAP - width;

  const fits = outward >= safe.left && outward + width <= safe.right;

  const left = fits
    ? outward
    : ctx.side === 'right'
      ? rail.left - FLYOUT_GAP - width
      : rail.left + rail.width + FLYOUT_GAP;

  ov.flyout.style.left = `${Math.round(clamp(left, safe.left, safe.right - width))}px`;
  ov.flyout.style.top = `${Math.round(clamp(rail.top, safe.top, safe.bottom - height))}px`;
}

function syncDisabledState(ctx, ov) {
  const blocked = ctx.selection.full.some((el) => LIBRARY_BLOCKED_TYPES.has(el.type));
  const libraryBtn = ov.rail.querySelector('[data-action="library"]');

  if (!libraryBtn) return;

  const label = blocked
    ? t('draw.selection.libraryUnsupported')
    : t('draw.selection.addToLibrary');

  libraryBtn.disabled = blocked;
  libraryBtn.title = label;
  libraryBtn.setAttribute('aria-label', label);
}

function hide(ctx) {
  if (!overlay || (ctx && owner !== ctx)) return;

  owner = null;
  closeFlyout();
  detachViewportListeners();

  overlay.root.classList.remove('is-visible');
  overlay.root.hidden = true;
}

/**
 * Hides the rail while another surface owns the screen (e.g. the note picker
 * modal) and brings it back afterwards.
 */
function withSuspended(ctx, run) {
  ctx.suspended = true;
  hide(ctx);

  return Promise.resolve()
    .then(run)
    .finally(() => {
      ctx.suspended = false;
      scheduleUpdate(ctx);
    });
}

// ------------------------------------------------------------
// Viewport tracking (only while the rail is up)
// ------------------------------------------------------------

let viewportBound = false;

function onViewportChange() {
  if (owner) scheduleUpdate(owner);
}

function attachViewportListeners() {
  if (viewportBound) return;
  viewportBound = true;

  // Capture: inline drawings live inside scrollable editor panes, whose scroll
  // events never reach window in the bubble phase.
  window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
  window.addEventListener('resize', onViewportChange, { passive: true });
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
}

function detachViewportListeners() {
  if (!viewportBound) return;
  viewportBound = false;

  window.removeEventListener('scroll', onViewportChange, { capture: true });
  window.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('scroll', onViewportChange);
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

function excalidrawContainerEl(container) {
  return container.querySelector?.('.excalidraw-container') || null;
}

function exportAppState(api) {
  const dark = currentExcalidrawTheme() === 'dark';

  return {
    ...(api.getAppState?.() || {}),
    exportBackground: true,
    exportWithDarkMode: dark,
    viewBackgroundColor: dark ? '#121212' : '#ffffff',
    exportScale: 2,
  };
}

async function copySelection(ctx, format) {
  const { full } = ctx.selection;
  const { exportToClipboard } = await loadExcalidraw();

  await exportToClipboard({
    type: format,
    elements: full,
    files: ctx.api.getFiles?.() || null,
    appState: exportAppState(ctx.api),
  });

  toast(
    format === 'json'
      ? t('draw.selection.copiedElements', { count: ctx.selection.direct.length })
      : t(format === 'png' ? 'draw.selection.copiedPng' : 'draw.selection.copiedSvg'),
    'success'
  );
}

/*
  Excalidraw exposes no imperative "duplicate" — and re-implementing it would
  mean re-implementing group, binding and frame remapping, which would silently
  drift from upstream. Replaying its own shortcut keeps the semantics exact.
  The event goes to the Excalidraw container, whose React onKeyDown handler
  runs the registered action.
*/
function duplicateSelection(ctx) {
  const el = excalidrawContainerEl(ctx.container);
  if (!el) return;

  const isApple = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  el.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'd',
    code: 'KeyD',
    ctrlKey: !isApple,
    metaKey: isApple,
    bubbles: true,
    cancelable: true,
  }));
}

async function addSelectionToLibrary(ctx) {
  const elements = structuredCloneSafe(ctx.selection.full);

  await ctx.api.updateLibrary({
    libraryItems: (current) => [
      {
        id: uid(),
        status: 'unpublished',
        created: Date.now(),
        elements,
      },
      ...current,
    ],
    openLibraryMenu: false,
  });

  toast(t('draw.selection.addedToLibrary'), 'success');
}

/*
  Hands over to Excalidraw's real context menu (which YANTA already extends
  with its note actions) by replaying a right-click on the selection. Doing it
  this way keeps exactly one big menu in the app — and Excalidraw setting
  `appState.contextMenu` is what makes this rail step aside.
*/
function openNativeContextMenu(ctx) {
  const canvas = ctx.container.querySelector?.('.excalidraw__canvas.interactive');
  if (!canvas) return;

  const appState = ctx.api.getAppState?.() || {};
  const rect = canvasRect(ctx.container);

  const toClient = sceneToClient({
    left: Number.isFinite(appState.offsetLeft) ? appState.offsetLeft : rect.left,
    top: Number.isFinite(appState.offsetTop) ? appState.offsetTop : rect.top,
  }, appState);

  const anchor = hitAnchor(ctx.selection.direct);
  const point = toClient(anchor.x, anchor.y);

  const inside =
    point.x >= rect.left && point.x <= rect.right &&
    point.y >= rect.top && point.y <= rect.bottom;

  // Anchor scrolled out of view: aim at the visible middle of the selection
  // instead of firing a right-click nobody could see the result of.
  if (!inside) {
    const [x1, y1, x2, y2] = excalidrawLib.getCommonBounds(ctx.selection.direct);
    const a = toClient(x1, y1);
    const b = toClient(x2, y2);

    point.x = clamp((Math.max(a.x, rect.left) + Math.min(b.x, rect.right)) / 2, rect.left, rect.right);
    point.y = clamp((Math.max(a.y, rect.top) + Math.min(b.y, rect.bottom)) / 2, rect.top, rect.bottom);
  }

  hide(ctx);

  canvas.dispatchEvent(new MouseEvent('contextmenu', {
    clientX: point.x,
    clientY: point.y,
    button: 2,
    buttons: 2,
    bubbles: true,
    cancelable: true,
  }));
}

async function runAction(ctx, action, btn) {
  switch (action) {
    case 'copy':
      await copySelection(ctx, 'json');
      flashDone(btn);
      refocusCanvas(ctx);
      break;

    case 'duplicate':
      duplicateSelection(ctx);
      refocusCanvas(ctx);
      break;

    case 'library':
      await addSelectionToLibrary(ctx);
      flashDone(btn);
      refocusCanvas(ctx);
      break;

    case 'link':
      await withSuspended(ctx, () => ctx.onLinkNote?.(ctx.api));
      break;

    case 'more':
      openNativeContextMenu(ctx);
      break;
  }
}

function refocusCanvas(ctx) {
  const el = excalidrawContainerEl(ctx.container);

  if (el && !el.contains(document.activeElement)) {
    el.focus({ preventScroll: true });
  }
}

function flashDone(btn) {
  if (!btn) return;

  clearTimeout(btn._doneTimer);

  const original = btn._originalIcon || (btn._originalIcon = btn.innerHTML);

  btn.classList.add('is-done');
  btn.innerHTML = lucide('check', 18);

  btn._doneTimer = setTimeout(() => {
    btn.classList.remove('is-done');
    btn.innerHTML = original;
  }, DONE_FEEDBACK_MS);
}

// ------------------------------------------------------------
// Interaction
// ------------------------------------------------------------

function openFlyout(ctx) {
  const ov = ensureOverlay();
  if (!ov.flyout.hidden) return;

  ov.flyout.hidden = false;
  ov.rail.querySelector('[data-action="copy"]')?.setAttribute('aria-expanded', 'true');

  placeFlyout(ctx, ov);

  document.addEventListener('pointerdown', onDocumentPointerDown, true);
}

function closeFlyout() {
  if (!overlay || overlay.flyout.hidden) return;

  overlay.flyout.hidden = true;
  overlay.rail.querySelector('[data-action="copy"]')?.setAttribute('aria-expanded', 'false');

  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
}

function onDocumentPointerDown(e) {
  if (!overlay || overlay.root.contains(e.target)) return;
  closeFlyout();
}

function bindOverlayInteractions(ov) {
  let longPressTimer = 0;
  let swallowClick = false;

  const cancelLongPress = () => {
    clearTimeout(longPressTimer);
    longPressTimer = 0;
  };

  ov.root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest?.('.yanta-draw-selmenu-btn, .yanta-draw-selmenu-item');
    if (!btn) return;

    // A long press that never produced a click (finger dragged off) must not
    // swallow the *next* one.
    swallowClick = false;

    // Keep focus (and therefore Excalidraw's keyboard shortcuts) on the canvas.
    e.preventDefault();
    e.stopPropagation();

    if (btn.dataset.action !== 'copy' || btn.disabled) return;

    longPressTimer = setTimeout(() => {
      longPressTimer = 0;
      swallowClick = true;

      if (owner) openFlyout(owner);
    }, LONG_PRESS_MS);
  }, true);

  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    ov.root.addEventListener(type, cancelLongPress, true);
  }

  ov.root.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    if (e.target.closest?.('[data-action="copy"]') && owner) openFlyout(owner);
  });

  ov.root.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('.yanta-draw-selmenu-btn, .yanta-draw-selmenu-item');
    if (!btn || btn.disabled) return;

    e.preventDefault();
    e.stopPropagation();

    cancelLongPress();

    if (swallowClick) {
      swallowClick = false;
      return;
    }

    const ctx = owner;
    if (!ctx?.selection) return;

    const format = btn.dataset.format;
    closeFlyout();

    try {
      if (format) {
        await copySelection(ctx, format);
        flashDone(ov.rail.querySelector('[data-action="copy"]'));
        refocusCanvas(ctx);
        return;
      }

      await runAction(ctx, btn.dataset.action, btn);
    } catch (err) {
      console.error('[YANTA Draw] selection action failed', err);
      toast(t('draw.selection.actionFailed'), 'error');
    }
  });

  ov.root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ov.flyout.hidden) {
      e.stopPropagation();
      closeFlyout();
      return;
    }

    // Keyboard equivalent of the long press.
    const onCopy = e.target.closest?.('[data-action="copy"]');

    if (onCopy && (e.key === 'ArrowRight' || (e.altKey && e.key === 'ArrowDown'))) {
      e.preventDefault();

      if (owner) {
        openFlyout(owner);
        ov.flyout.querySelector('.yanta-draw-selmenu-item')?.focus();
      }
    }
  });
}

// ------------------------------------------------------------
// Styles
// ------------------------------------------------------------

function injectCss() {
  if (injectedCss) return;
  injectedCss = true;

  const style = document.createElement('style');
  style.id = 'yanta-draw-selection-menu-css';
  style.textContent = `
.yanta-draw-selmenu {
  position: fixed;
  inset: 0;
  z-index: 300;
  pointer-events: none;
}

.yanta-draw-selmenu[hidden] {
  display: none !important;
}

.yanta-draw-selmenu-rail,
.yanta-draw-selmenu-flyout {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  font-family: var(--font);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

@supports (backdrop-filter: blur(1px)) {
  .yanta-draw-selmenu-rail,
  .yanta-draw-selmenu-flyout {
    background: color-mix(in srgb, var(--bg-elev) 88%, transparent);
    backdrop-filter: blur(14px) saturate(1.3);
  }
}

.yanta-draw-selmenu-rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px;
  opacity: 0;
  transform: scale(0.94);
  transition: opacity 0.13s ease, transform 0.13s cubic-bezier(0.2, 0.9, 0.3, 1.15);
}

.yanta-draw-selmenu.is-visible .yanta-draw-selmenu-rail {
  opacity: 1;
  transform: scale(1);
}

.yanta-draw-selmenu-flyout[hidden] {
  display: none !important;
}

.yanta-draw-selmenu-flyout {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px;
  min-width: 168px;
}

.yanta-draw-selmenu-btn,
.yanta-draw-selmenu-item {
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  position: relative;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.yanta-draw-selmenu-btn {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.yanta-draw-selmenu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 9px;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
}

.yanta-draw-selmenu-btn:hover,
.yanta-draw-selmenu-item:hover {
  background: var(--bg-elev-2);
  color: var(--accent);
}

.yanta-draw-selmenu-btn:active:not([disabled]) {
  transform: scale(0.92);
}

.yanta-draw-selmenu-btn:focus-visible,
.yanta-draw-selmenu-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.yanta-draw-selmenu-btn[disabled] {
  opacity: 0.35;
  cursor: default;
}

.yanta-draw-selmenu-btn.is-done,
.yanta-draw-selmenu-btn.is-done:hover {
  color: var(--green);
}

/* Corner marker: "hold for more options" */
.yanta-draw-selmenu-btn[data-more]::after {
  content: '';
  position: absolute;
  right: 5px;
  bottom: 5px;
  border-left: 4px solid transparent;
  border-bottom: 4px solid currentColor;
  opacity: 0.45;
}

.yanta-draw-selmenu-btn.is-done[data-more]::after {
  display: none;
}

.yanta-draw-selmenu-sep {
  height: 1px;
  margin: 3px 6px;
  background: var(--border);
}

@media (pointer: fine) {
  .yanta-draw-selmenu-btn {
    width: 34px;
    height: 34px;
    border-radius: 9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .yanta-draw-selmenu-rail {
    transition: none;
    transform: none;
  }

  .yanta-draw-selmenu-btn:active:not([disabled]) {
    transform: none;
  }
}
`;

  document.head.append(style);
}
