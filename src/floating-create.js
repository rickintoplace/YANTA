// ============================================================
// YANTA — Floating Quick Create Button
//
// Shows on Dashboard, Calendar, Graph and Notes.
// UX:
// - tap/click "+" => staggered icon bubbles
// - hold "+" => bubbles open, drag toward bubble, release executes action
// - bubble layout is user configurable via floating-create-settings.js
// ============================================================

import {
  state,
  lucide,
  toast,
} from './core.js';

import {
  defaultCreateFolderId,
  runCreateAction,
} from './create-actions.js';

import {
  getFloatingCreateSettings,
  floatingCreateActionsForRuntime,
} from './floating-create-settings.js';

let initialized = false;
let root = null;
let graphObserver = null;
let actions = [];
let iconAnim = null;

let globalKeyBound = false;
let globalOutsidePointerBound = false;

const HOLD_MS = 260;
const DRAG_MOVE_PX = 4;

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function isGraphVisible() {
  const graph = document.getElementById('graphOverlay');
  return !!graph && graph.hidden === false;
}

function shouldShowFloatingCreate() {
  return (
    actions.length > 0 &&
    (
      state.surface === 'dashboard' ||
      state.surface === 'calendar' ||
      (
        state.surface === 'note' &&
        !!state.currentNoteId
      ) ||
      isGraphVisible()
    )
  );
}

/**
 * Best UX rule:
 * - If Dashboard is the active surface or open in the side pane, create inside
 *   the currently opened dashboard folder.
 * - Otherwise create in the current note's folder.
 */

function loadActions() {
  actions = floatingCreateActionsForRuntime(getFloatingCreateSettings());
}

function setOpen(open) {
  if (!root) return;

  root.classList.toggle('is-open', !!open);
  root.querySelector('[data-qc-trigger]')?.setAttribute('aria-expanded', open ? 'true' : 'false');

  iconAnim?.animateTo(open ? 1 : 0);

  if (!open) {
    clearHotBubble();
    resetDragOffset();
  }
}

function isOpen() {
  return !!root?.classList.contains('is-open');
}

function toggleOpen() {
  if (!actions.length) {
    toast('No Quick Create actions enabled', 'error');
    return;
  }

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

async function runAction(id) {
  setOpen(false);

  try {
    await runCreateAction(id, {
      folderId: defaultCreateFolderId(),
      source: 'floating-create',
    });
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
   user-configurable free layout
   ============================================================ */

.yanta-qc {
  position: fixed;
  right: max(18px, env(safe-area-inset-right));
  bottom: max(18px, env(safe-area-inset-bottom));

  z-index: 80;

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

.yanta-qc-blob-layer {
  position: absolute;
  right: 0;
  bottom: 0;

  width: 430px;
  height: 430px;

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
    rotate(0deg)
    scale(1.02);
}

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
  stroke-width: 2;

  opacity: 1;

  overflow: visible;

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

function bubbleXSvgMarkup() {
  // Quick-access icon: three bubbles that merge (goo filter) and pop into an X.
  // Driven by initBubbleXIcon() — see setProgress() there for the phases.
  return `
    <svg
      class="yanta-qc-bubblex"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false">
      <defs>
        <filter id="qc-stroke-goo" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.75" result="blur"/>
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
            result="goo"/>
        </filter>
      </defs>

      <g data-qc-bubble-group filter="url(#qc-stroke-goo)" fill="none">
        <circle data-qc-bubble="big" cx="7.5" cy="16.5" r="5.5"/>
        <circle data-qc-bubble="right" cx="18.5" cy="8.5" r="3.5"/>
        <circle data-qc-bubble="small" cx="7.5" cy="4.5" r="2.5"/>
        <path data-qc-bubble-arc d="M7.001 15.085A1.5 1.5 0 0 1 9 16.5"/>
      </g>

      <g data-qc-burst-group fill="none">
        <line x1="12" y1="5.2" x2="12" y2="2.2"/>
        <line x1="17" y1="7" x2="19.2" y2="4.8"/>
        <line x1="18.8" y1="12" x2="21.8" y2="12"/>
        <line x1="17" y1="17" x2="19.2" y2="19.2"/>
        <line x1="7" y1="17" x2="4.8" y2="19.2"/>
        <line x1="5.2" y1="12" x2="2.2" y2="12"/>
      </g>

      <g data-qc-x-group fill="none">
        <path data-qc-x-line d="M18 6 6 18"/>
        <path data-qc-x-line d="m6 6 12 12"/>
      </g>
    </svg>
  `;
}

function initBubbleXIcon(svg) {
  if (!svg) return null;

  const bubbleGroup = svg.querySelector('[data-qc-bubble-group]');
  const bubbleArc = svg.querySelector('[data-qc-bubble-arc]');
  const burstGroup = svg.querySelector('[data-qc-burst-group]');
  const burstLines = [...burstGroup.querySelectorAll('line')];
  const xLines = [...svg.querySelectorAll('[data-qc-x-line]')];
  const xLengths = xLines.map((line) => line.getTotalLength());

  const bubbles = [
    { el: svg.querySelector('[data-qc-bubble="big"]'), cx: 7.5, cy: 16.5, r: 5.5, mergedR: 6.2 },
    { el: svg.querySelector('[data-qc-bubble="right"]'), cx: 18.5, cy: 8.5, r: 3.5, mergedR: 5.7 },
    { el: svg.querySelector('[data-qc-bubble="small"]'), cx: 7.5, cy: 4.5, r: 2.5, mergedR: 5.2 },
  ];

  const DURATION = 420;

  let progress = 0;
  let raf = null;

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => {
    t = clamp(t);
    return t * t * (3 - 2 * t);
  };

  function setProgress(p) {
    progress = clamp(p);

    const merge = smooth(progress / 0.62);
    const pop = smooth((progress - 0.58) / 0.18);
    const xDraw = smooth((progress - 0.68) / 0.28);

    const bubbleOpacity = 1 - pop;
    const gooStroke = lerp(2, 4.6, merge) * bubbleOpacity;

    bubbleGroup.setAttribute('opacity', bubbleOpacity);
    bubbleGroup.setAttribute('stroke-width', Math.max(0.01, gooStroke));

    bubbles.forEach(({ el, cx, cy, r, mergedR }) => {
      const wobble = Math.sin(progress * Math.PI * 2) * 0.15 * (1 - pop);

      el.setAttribute('cx', lerp(cx, 12, merge));
      el.setAttribute('cy', lerp(cy, 12, merge));
      el.setAttribute('r', Math.max(0.01, lerp(r, mergedR + wobble, merge) * bubbleOpacity));
    });

    bubbleArc.setAttribute('opacity', Math.max(0, 1 - merge * 1.4));
    bubbleArc.setAttribute(
      'transform',
      `translate(${lerp(0, 4.1, merge)} ${lerp(0, -3.5, merge)}) scale(${lerp(1, 0.15, merge)})`
    );

    // Burst erscheint beim Poppen, auch rückwärts.
    const burstPhase = clamp((progress - 0.58) / 0.34);
    const burstOpacity = Math.sin(burstPhase * Math.PI);

    burstGroup.setAttribute('opacity', burstOpacity);
    burstGroup.setAttribute('stroke-width', 1.5);

    burstLines.forEach((line, i) => {
      const offset = burstPhase * 2.8;

      line.setAttribute('stroke-dasharray', '3');
      line.setAttribute('stroke-dashoffset', 3 - offset - i * 0.12);
    });

    // X zeichnen — Stagger normalisieren, damit die zweite Linie 100% erreicht.
    xLines.forEach((line, i) => {
      const stagger = i * 0.12;
      const localDraw = clamp((xDraw - stagger) / (1 - stagger));
      const len = xLengths[i];

      line.setAttribute('stroke-width', 2);
      line.setAttribute('opacity', localDraw);
      line.setAttribute('stroke-dasharray', len);
      line.setAttribute('stroke-dashoffset', len * (1 - localDraw));
    });
  }

  function animateTo(nextTarget) {
    const end = clamp(nextTarget);

    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      setProgress(end);
      return;
    }

    const start = progress;
    const startTime = performance.now();

    function frame(now) {
      const t = clamp((now - startTime) / DURATION);
      const eased = smooth(t);

      setProgress(lerp(start, end, eased));

      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        setProgress(end);
        raf = null;
      }
    }

    raf = requestAnimationFrame(frame);
  }

  setProgress(0);

  return { setProgress, animateTo };
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
  if (root) return root;

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

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

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
  trigger.innerHTML = bubbleXSvgMarkup();

  const tooltip = document.createElement('div');
  tooltip.className = 'yanta-qc-tooltip';
  tooltip.textContent = 'Tap or hold';

  shell.append(blobLayer, trigger, tooltip);

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

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

  iconAnim = initBubbleXIcon(trigger.querySelector('svg'));

  bindPointerInteractions(trigger);

  return root;
}

function rebuildDomFromSettings() {
  const wasOpen = isOpen();

  if (root) {
    root.remove();
    root = null;
  }

  loadActions();
  buildDom();

  if (wasOpen && actions.length) {
    setOpen(true);
  }

  updateVisibility();
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
    if (!pointer || !actions.length || !root) return;

    pointer.openedByHold = true;
    pointer.draggingActive = true;
    pointer.hotAction = null;

    root.classList.add('is-dragging');
    clearHotBubble();
    resetDragOffset();

    setOpen(true);

    vibrate(8);
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
      root?.classList.add('is-dragging');

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

  if (!globalKeyBound) {
    globalKeyBound = true;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        setOpen(false);
      }
    });
  }

  if (!globalOutsidePointerBound) {
    globalOutsidePointerBound = true;

    document.addEventListener('pointerdown', (e) => {
      if (!root || root.hidden || !isOpen()) return;
      if (root.contains(e.target)) return;

      setOpen(false);
    }, {
      capture: true,
      passive: true,
    });
  }
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
    'yanta-note-updated',
    'yanta-folder-updated',
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

  window.setInterval(updateVisibility, 650);
}

export function setupFloatingCreate() {
  if (initialized) return;
  initialized = true;

  loadActions();
  injectCss();
  buildDom();
  bindVisibilityObservers();

  window.addEventListener('yanta-floating-create-settings-changed', () => {
    rebuildDomFromSettings();
  });

  requestAnimationFrame(updateVisibility);
}