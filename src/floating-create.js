// ============================================================
// YANTA — Floating Quick Create Button
//
// Shows on Dashboard, Calendar and Graph.
// UX:
// - tap/click "+" => staggered icon bubbles
// - hold "+" => bubbles open, drag toward bubble, release executes action
// - gooey visual blob layer for smooth merge effect
// ============================================================

import {
  state,
  lucide,
  toast,
} from './core.js';

import {
  newNote,
} from './notes.js';

import {
  insertAtCursor,
} from './editor.js';

import {
  getMarkdownText,
} from './yjs.js';

import {
  createDrawingAndInsert,
} from './draw.js';

import {
  openImageModal,
} from './image.js';

import {
  openCalendar,
  openNewCalendarEvent,
} from './calendar.js';

import {
  closeGraph,
} from './graph.js';

import {
  currentFolderForNew,
} from './tree.js';

let initialized = false;
let root = null;
let graphObserver = null;

const HOLD_MS = 260;
const DRAG_MOVE_PX = 4;

const ACTIONS = [
  {
    id: 'note',
    label: 'New text note',
    icon: 'file-text',
    x: -76,
    y: 0,
  },
  {
    id: 'list',
    label: 'New list',
    icon: 'list-checks',
    x: -128,
    y: -44,
  },
  {
    id: 'drawing',
    label: 'New drawing',
    icon: 'pencil',
    x: -142,
    y: -104,
  },
  {
    id: 'image',
    label: 'New image',
    icon: 'image',
    x: -104,
    y: -164,
  },
  {
    id: 'event',
    label: 'New calendar event',
    icon: 'calendar-plus',
    x: -36,
    y: -192,
  },
];

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function isGraphVisible() {
  const graph = document.getElementById('graphOverlay');
  return !!graph && graph.hidden === false;
}

function shouldShowFloatingCreate() {
  return (
    state.surface === 'dashboard' ||
    state.surface === 'calendar' ||
    isGraphVisible()
  );
}

function folderForNewNote() {
  if (state.surface === 'dashboard') {
    return state.dashboardFolderId || null;
  }

  return currentFolderForNew?.() || null;
}

function setOpen(open) {
  if (!root) return;

  root.classList.toggle('is-open', !!open);
  root.querySelector('[data-qc-trigger]')?.setAttribute('aria-expanded', open ? 'true' : 'false');

  if (!open) {
    clearHotBubble();
    resetDragOffset();
  }
}

function isOpen() {
  return !!root?.classList.contains('is-open');
}

function toggleOpen() {
  setOpen(!isOpen());
}

function clearHotBubble() {
  if (!root) return;

  root.classList.remove('is-targeting');

  root
    .querySelectorAll('.yanta-qc-bubble.is-hot, .yanta-qc-blob.is-hot')
    .forEach((node) => node.classList.remove('is-hot'));
}

function resetDragOffset() {
  if (!root) return;

  root.style.setProperty('--qc-drag-x', '0px');
  root.style.setProperty('--qc-drag-y', '0px');
}

function setDragOffset(dx, dy) {
  if (!root) return;

  root.style.setProperty('--qc-drag-x', `${dx}px`);
  root.style.setProperty('--qc-drag-y', `${dy}px`);
}

function vibrate(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

async function createTextNote() {
  await closeGraphIfOpen();
  await newNote(folderForNewNote(), 'markdown');
}

async function createListNote() {
  await closeGraphIfOpen();

  await newNote(folderForNewNote(), 'list');

  await nextFrame();

  const noteId = state.currentNoteId;
  if (!noteId) return;

  try {
    const ytext = getMarkdownText(noteId);

    if (ytext.length === 0) {
      insertAtCursor('- [ ] ');
    }
  } catch {
    insertAtCursor('- [ ] ');
  }
}

async function createDrawingNote() {
  await closeGraphIfOpen();

  await newNote(folderForNewNote(), 'markdown');

  await nextFrame();

  await createDrawingAndInsert();
}

async function createImageNote() {
  await closeGraphIfOpen();

  await newNote(folderForNewNote(), 'markdown');

  await nextFrame();

  openImageModal();
}

async function createCalendarEvent() {
  await closeGraphIfOpen();

  if (state.surface !== 'calendar') {
    openCalendar({
      push: true,
    });

    await nextFrame();
    await nextFrame();
  }

  openNewCalendarEvent();
}

async function closeGraphIfOpen() {
  if (!isGraphVisible()) return;

  try {
    closeGraph();
  } catch {}
}

async function runAction(id) {
  setOpen(false);

  try {
    if (id === 'note') {
      await createTextNote();
      return;
    }

    if (id === 'list') {
      await createListNote();
      return;
    }

    if (id === 'drawing') {
      await createDrawingNote();
      return;
    }

    if (id === 'image') {
      await createImageNote();
      return;
    }

    if (id === 'event') {
      await createCalendarEvent();
      return;
    }
  } catch (err) {
    console.error('[YANTA Quick Create] action failed', err);
    toast('Quick create failed', 'error');
  }
}

function bubbleAtPoint(clientX, clientY) {
  if (!root || !isOpen()) return null;

  const bubbles = [...root.querySelectorAll('.yanta-qc-bubble[data-action]')];

  let best = null;
  let bestDistance = Infinity;

  for (const bubble of bubbles) {
    const rect = bubble.getBoundingClientRect();
    const pad = 14;

    const inside =
      clientX >= rect.left - pad &&
      clientX <= rect.right + pad &&
      clientY >= rect.top - pad &&
      clientY <= rect.bottom + pad;

    if (!inside) continue;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(clientX - cx, clientY - cy);

    if (dist < bestDistance) {
      bestDistance = dist;
      best = bubble;
    }
  }

  return best;
}

function updateHotBubble(clientX, clientY) {
  if (!root) return null;

  const hit = bubbleAtPoint(clientX, clientY);
  const id = hit?.dataset?.action || '';

  root.classList.toggle('is-targeting', !!id);

  root
    .querySelectorAll('.yanta-qc-bubble[data-action], .yanta-qc-blob[data-action]')
    .forEach((node) => {
      node.classList.toggle('is-hot', !!id && node.dataset.action === id);
    });

  /*
    Homogeneous gooey highlight:
    the main blob must light up with the target blob, otherwise the
    goo bridge visually looks like two different materials.
  */
  const triggerBlob = root.querySelector('.yanta-qc-trigger-blob');
  triggerBlob?.classList.toggle('is-hot', !!id);

  return id || null;
}

function updateVisibility() {
  if (!root) return;

  const visible = shouldShowFloatingCreate();

  root.hidden = !visible;

  if (!visible) {
    setOpen(false);
  }
}

function injectCss() {
  const css = `
/* ============================================================
   YANTA Floating Quick Create
   refined flat gooey version v3
   ============================================================ */

.yanta-qc {
  position: fixed;
  right: max(18px, env(safe-area-inset-right));
  bottom: max(18px, env(safe-area-inset-bottom));

  z-index: 185;

  width: 56px;
  height: 56px;

  pointer-events: none;

  --qc-size: 54px;
  --qc-bubble-size: 46px;
  --qc-drag-x: 0px;
  --qc-drag-y: 0px;
  --qc-main: var(--accent);
  --qc-hot: var(--accent-2);
}

.yanta-qc[hidden] {
  display: none !important;
}

.yanta-qc-shell {
  position: absolute;
  right: 0;
  bottom: 0;

  width: 56px;
  height: 56px;

  overflow: visible;
  pointer-events: none;
}

/*
  Gooey layer:
  same origin as buttons. The filter creates the merge.
*/
.yanta-qc-blob-layer {
  position: absolute;
  right: 0;
  bottom: 0;

  width: 280px;
  height: 280px;

  overflow: visible;
  pointer-events: none;

  filter: url(#yanta-qc-goo);

  transform: translateZ(0);
}

.yanta-qc-blob {
  position: absolute;
  right: 0;
  bottom: 0;

  width: var(--qc-size);
  height: var(--qc-size);

  border-radius: 999px;

  background: var(--qc-main);
  box-shadow: none;

  transform: translate3d(0, 0, 0) scale(1);
  transform-origin: center;

  transition:
    transform 360ms cubic-bezier(.2,.8,.2,1),
    opacity 240ms ease,
    background-color 180ms ease;
}

.yanta-qc-trigger-blob {
  transform:
    translate3d(var(--qc-drag-x), var(--qc-drag-y), 0)
    scale(1);
}

.yanta-qc-bubble-blob {
  width: var(--qc-bubble-size);
  height: var(--qc-bubble-size);

  opacity: 0;

  transform:
    translate3d(0, 0, 0)
    scale(0.22);

  transition:
    transform 420ms cubic-bezier(.16,1,.3,1),
    opacity 260ms ease,
    background-color 170ms ease;

  transition-delay: calc(var(--qc-i, 0) * 34ms);
}

.yanta-qc.is-open .yanta-qc-bubble-blob {
  opacity: 1;

  transform:
    translate3d(var(--qc-x), var(--qc-y), 0)
    scale(1);
}

/*
  Homogeneous hot state:
  target blob + main blob use the same material color.
*/
.yanta-qc-blob.is-hot {
  background: var(--qc-hot);
}

.yanta-qc-trigger,
.yanta-qc-bubble {
  position: absolute;
  right: 0;
  bottom: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 0;
  border-radius: 999px;

  background: transparent;
  color: white;

  cursor: pointer;
  pointer-events: auto;

  -webkit-tap-highlight-color: transparent;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;

  transform-origin: center;
}

.yanta-qc-trigger {
  width: var(--qc-size);
  height: var(--qc-size);

  transform:
    translate3d(var(--qc-drag-x), var(--qc-drag-y), 0)
    rotate(0deg)
    scale(1);

  /*
    Floating shadow on the interactive main button layer.
    The blob itself stays clean for the gooey illusion.
  */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);

  transition:
    transform 300ms cubic-bezier(.2,.8,.2,1),
    opacity 150ms ease,
    box-shadow 160ms ease,
    color 120ms ease;
}

.yanta-qc.is-open .yanta-qc-trigger {
  transform:
    translate3d(var(--qc-drag-x), var(--qc-drag-y), 0)
    rotate(45deg)
    scale(1.02);
}

/*
  During drag/hold action picking:
  - no X rotation
  - plus icon disappears so it does not overlap bubble icons
*/
.yanta-qc.is-open.is-dragging .yanta-qc-trigger {
  transform:
    translate3d(var(--qc-drag-x), var(--qc-drag-y), 0)
    rotate(0deg)
    scale(1.03);

  box-shadow: none;
}

.yanta-qc-trigger svg {
  width: 25px;
  height: 25px;
  stroke-width: 2.6;

  opacity: 1;

  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.22));

  transition:
    opacity 110ms ease,
    transform 160ms cubic-bezier(.2,.8,.2,1);
}

.yanta-qc.is-dragging .yanta-qc-trigger svg {
  opacity: 0;
  transform: scale(0.72);
}

.yanta-qc-bubble {
  width: var(--qc-bubble-size);
  height: var(--qc-bubble-size);

  opacity: 0;

  /*
    Requested floating shadow for bubbles.
    Applied to the icon/button layer, not the gooey material layer.
  */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);

  transform:
    translate3d(0, 0, 0)
    scale(0.35);

  transition:
    transform 420ms cubic-bezier(.16,1,.3,1),
    opacity 240ms ease,
    box-shadow 160ms ease,
    color 120ms ease;

  transition-delay: calc(var(--qc-i, 0) * 34ms);
}

.yanta-qc.is-open .yanta-qc-bubble {
  opacity: 1;

  transform:
    translate3d(var(--qc-x), var(--qc-y), 0)
    scale(1);
}

.yanta-qc-bubble svg {
  width: 21px;
  height: 21px;
  stroke-width: 2.35;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.24));
}

.yanta-qc-bubble:hover,
.yanta-qc-bubble.is-hot {
  color: white;

  transform:
    translate3d(var(--qc-x), var(--qc-y), 0)
    scale(1.12);
}

.yanta-qc-bubble.is-hot {
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
}

.yanta-qc.is-dragging .yanta-qc-trigger,
.yanta-qc.is-dragging .yanta-qc-trigger-blob {
  transition:
    opacity 110ms ease,
    transform 0ms linear,
    background-color 180ms ease !important;
}

/*
  Avoid the occasional bright flash when entering drag mode:
  background color keeps a real transition, but transform follows finger.
*/
.yanta-qc.is-dragging .yanta-qc-trigger-blob {
  transition:
    background-color 180ms ease,
    opacity 160ms ease !important;
}

.yanta-qc.is-dragging .yanta-qc-bubble,
.yanta-qc.is-dragging .yanta-qc-bubble-blob {
  transition-duration: 220ms;
}

.yanta-qc:not(.is-open) .yanta-qc-bubble {
  pointer-events: none;
}

/*
  Close/retract should feel calmer than the snap-open action.
*/
.yanta-qc:not(.is-open) .yanta-qc-bubble,
.yanta-qc:not(.is-open) .yanta-qc-bubble-blob {
  transition-duration: 460ms;
  transition-timing-function: cubic-bezier(.22,.75,.18,1);
}

.yanta-qc-tooltip {
  position: absolute;
  right: 62px;
  bottom: 13px;

  padding: 5px 8px;
  border-radius: 999px;

  background: color-mix(in srgb, var(--bg-elev-3) 94%, transparent);
  border: 1px solid var(--border);

  color: var(--text-dim);
  font-size: 11px;
  line-height: 1;

  opacity: 0;
  transform: translateX(4px);
  pointer-events: none;

  white-space: nowrap;

  transition:
    opacity 130ms ease,
    transform 160ms cubic-bezier(.2,.8,.2,1);
}

.yanta-qc:hover .yanta-qc-tooltip,
.yanta-qc:focus-within .yanta-qc-tooltip {
  opacity: 1;
  transform: translateX(0);
}

.yanta-qc.is-open .yanta-qc-tooltip,
.yanta-qc.is-dragging .yanta-qc-tooltip {
  opacity: 0;
}

@media (max-width: 760px) {
  .yanta-qc {
    right: max(14px, env(safe-area-inset-right));
    bottom: calc(74px + env(safe-area-inset-bottom));
  }

  .app[data-surface="dashboard"] .yanta-qc,
  .app[data-surface="calendar"] .yanta-qc {
    bottom: max(18px, env(safe-area-inset-bottom));
  }

  .yanta-qc-tooltip {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .yanta-qc *,
  .yanta-qc *::before,
  .yanta-qc *::after {
    transition: none !important;
    animation: none !important;
  }
}
`;

  const existing = document.getElementById('yanta-floating-create-css');

  if (existing) {
    existing.textContent = css;
    return;
  }

  const style = document.createElement('style');
  style.id = 'yanta-floating-create-css';
  style.textContent = css;
  document.head.append(style);
}

function createSvgFilter() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('yanta-qc-filter-svg');

  svg.innerHTML = `
    <defs>
      <filter
        id="yanta-qc-goo"
        x="-400%"
        y="-400%"
        width="900%"
        height="900%"
        color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur"/>
        <feColorMatrix
          in="blur"
          mode="matrix"
          values="
            1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            0 0 0 20 -9"
          result="goo"/>
        <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
      </filter>
    </defs>
  `;

  return svg;
}

function buildDom() {
  root = document.createElement('div');
  root.id = 'yantaQuickCreate';
  root.className = 'yanta-qc';
  root.hidden = true;

  const shell = document.createElement('div');
  shell.className = 'yanta-qc-shell';

  const blobLayer = document.createElement('div');
  blobLayer.className = 'yanta-qc-blob-layer';

  const triggerBlob = document.createElement('span');
  triggerBlob.className = 'yanta-qc-blob yanta-qc-trigger-blob';

  blobLayer.append(triggerBlob);

  for (let i = 0; i < ACTIONS.length; i++) {
    const action = ACTIONS[i];

    const blob = document.createElement('span');
    blob.className = 'yanta-qc-blob yanta-qc-bubble-blob';
    blob.dataset.action = action.id;
    blob.style.setProperty('--qc-x', `${action.x}px`);
    blob.style.setProperty('--qc-y', `${action.y}px`);
    blob.style.setProperty('--qc-i', String(i));

    blobLayer.append(blob);
  }

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'yanta-qc-trigger';
  trigger.dataset.qcTrigger = '1';
  trigger.title = 'Quick create';
  trigger.setAttribute('aria-label', 'Quick create');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = lucide('plus', 26);

  const tooltip = document.createElement('div');
  tooltip.className = 'yanta-qc-tooltip';
  tooltip.textContent = 'Quick create';

  shell.append(blobLayer, trigger, tooltip);

  for (let i = 0; i < ACTIONS.length; i++) {
    const action = ACTIONS[i];

    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'yanta-qc-bubble';
    bubble.dataset.action = action.id;
    bubble.title = action.label;
    bubble.setAttribute('aria-label', action.label);
    bubble.style.setProperty('--qc-x', `${action.x}px`);
    bubble.style.setProperty('--qc-y', `${action.y}px`);
    bubble.style.setProperty('--qc-i', String(i));
    bubble.innerHTML = lucide(action.icon, 21);

    bubble.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runAction(action.id);
    });

    shell.append(bubble);
  }

  root.append(createSvgFilter(), shell);
  document.body.append(root);

  bindPointerInteractions(trigger);
}

function bindPointerInteractions(trigger) {
  let pointer = null;
  let holdTimer = 0;
  let suppressClickUntil = 0;

  const cleanup = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;

    root?.classList.remove('is-dragging');

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);

    pointer = null;
  };

    const beginDragOpen = () => {
    if (!pointer) return;

    pointer.openedByHold = true;
    pointer.draggingActive = true;
    pointer.hotAction = null;

    /*
        Important order:
        - enter dragging state before opening
        - clear hot state before first paint
        This avoids the occasional bright flash on the main blob.
    */
    root.classList.add('is-dragging');
    clearHotBubble();
    resetDragOffset();

    setOpen(true);

    vibrate(8);

    /*
        Do not call updateHotBubble immediately here.
        At hold start the pointer is still on the main blob, and depending on
        layout timing this can briefly create a false hot color.
        The hot state starts with the first actual pointermove.
    */
    };

  function onMove(e) {
    if (!pointer || e.pointerId !== pointer.pointerId) return;

    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;

    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;
    const moved = Math.hypot(dx, dy);

    pointer.moved = moved > DRAG_MOVE_PX;

    if (isOpen() && pointer.moved) {
      pointer.draggingActive = true;
      root.classList.add('is-dragging');

      e.preventDefault();
      e.stopPropagation();

      setDragOffset(dx, dy);

      pointer.hotAction = updateHotBubble(e.clientX, e.clientY);
    }
  }

  async function onUp(e) {
    if (!pointer || e.pointerId !== pointer.pointerId) return;

    const snapshot = {
      openedByHold: !!pointer.openedByHold,
      draggingActive: !!pointer.draggingActive,
      hotAction: pointer.hotAction || updateHotBubble(e.clientX, e.clientY),
    };

    const wasDragHold =
      snapshot.openedByHold ||
      snapshot.draggingActive;

    try {
      trigger.releasePointerCapture?.(e.pointerId);
    } catch {}

    if (wasDragHold) {
      e.preventDefault();
      e.stopPropagation();

      suppressClickUntil = performance.now() + 320;

      cleanup();

      if (snapshot.hotAction) {
        await runAction(snapshot.hotAction);
        return;
      }

      /*
        Important:
        If the user holds, drags toward a bubble, drags back and releases
        without choosing anything, reset to a normal tappable state.
        Before this fix, pointer was nulled before checking openedByHold.
      */
      if (snapshot.openedByHold) {
        setOpen(false);
        return;
      }

      resetDragOffset();
      clearHotBubble();
      return;
    }

    cleanup();
  }

  function onCancel(e) {
    if (!pointer || e.pointerId !== pointer.pointerId) return;

    try {
      trigger.releasePointerCapture?.(e.pointerId);
    } catch {}

    cleanup();
    setOpen(false);
  }

  trigger.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;

    pointer = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      openedByHold: false,
      draggingActive: false,
      hotAction: null,
    };

    try {
      trigger.setPointerCapture?.(e.pointerId);
    } catch {}

    clearTimeout(holdTimer);

    if (isOpen()) {
      // If already open, a movement can quickly become drag-to-action.
      holdTimer = window.setTimeout(beginDragOpen, 80);
    } else {
      holdTimer = window.setTimeout(beginDragOpen, HOLD_MS);
    }

    document.addEventListener('pointermove', onMove, {
      capture: true,
      passive: false,
    });

    document.addEventListener('pointerup', onUp, {
      capture: true,
      passive: false,
    });

    document.addEventListener('pointercancel', onCancel, {
      capture: true,
      passive: false,
    });
  }, {
    passive: true,
  });

  trigger.addEventListener('click', (e) => {
    if (performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    toggleOpen();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!root || root.hidden || !isOpen()) return;
    if (root.contains(e.target)) return;

    setOpen(false);
  }, {
    capture: true,
    passive: true,
  });
}

function bindVisibilityObservers() {
  const graph = document.getElementById('graphOverlay');

  if (graph && !graphObserver) {
    graphObserver = new MutationObserver(updateVisibility);
    graphObserver.observe(graph, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
  }

  const events = [
    'popstate',
    'hashchange',
    'resize',
    'yanta-note-opened',
    'yanta-dashboard-refresh',
    'yanta-calendar-updated',
    'yanta-side-pane-opened',
    'yanta-side-pane-closed',
  ];

  for (const ev of events) {
    window.addEventListener(ev, () => {
      requestAnimationFrame(updateVisibility);
    });
  }

  document.addEventListener('visibilitychange', updateVisibility);

  // Lightweight periodic fallback for graph open/close paths that do not emit events.
  window.setInterval(updateVisibility, 650);
}

export function setupFloatingCreate() {
  if (initialized) return;
  initialized = true;

  injectCss();
  buildDom();
  bindVisibilityObservers();

  requestAnimationFrame(updateVisibility);
}