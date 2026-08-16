// ============================================================
// YANTA — Draggable floating panels.
//
// Presenter notes, the layers panel and the slide-animation panel are all
// windows the user drags out of the way of their own drawing. One
// implementation, one feel: grab the header, never leave the viewport, and
// remember where it was put.
// ============================================================

const MARGIN = 8;

// panel key -> { left, top }, so a panel reopens where the user left it.
const rememberedPositions = new Map();

/** Keeps a panel fully inside the viewport, leaving a small margin. */
export function clampPanelPosition(panel, left, top, { margin = MARGIN } = {}) {
  const rect = panel.getBoundingClientRect();

  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

  return {
    left: Math.round(Math.min(Math.max(margin, left), maxLeft)),
    top: Math.round(Math.min(Math.max(margin, top), maxTop)),
  };
}

function place(panel, left, top) {
  const next = clampPanelPosition(panel, left, top);

  panel.style.left = `${next.left}px`;
  panel.style.top = `${next.top}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';

  return next;
}

/**
 * Makes `panel` draggable by `handle`.
 *
 * @param {HTMLElement} panel
 * @param {HTMLElement} handle   the grab area, usually the panel header
 * @param {object}      [options]
 * @param {string}      [options.key]  remembers the position under this name
 */
export function makePanelDraggable(panel, handle, { key = '' } = {}) {
  if (!panel || !handle || panel.dataset.dragBound === '1') return;

  panel.dataset.dragBound = '1';
  handle.style.touchAction = 'none';
  handle.style.cursor = 'grab';

  const remembered = key ? rememberedPositions.get(key) : null;

  if (remembered) {
    // Re-clamp on restore: the window may have been resized since.
    requestAnimationFrame(() => place(panel, remembered.left, remembered.top));
  }

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMove = (e) => {
    if (pointerId == null || e.pointerId !== pointerId) return;

    e.preventDefault();

    const next = place(
      panel,
      startLeft + (e.clientX - startX),
      startTop + (e.clientY - startY)
    );

    if (key) rememberedPositions.set(key, next);
  };

  const stop = (e) => {
    if (pointerId == null || (e && e.pointerId !== pointerId)) return;

    pointerId = null;
    panel.classList.remove('is-dragging');
    handle.style.cursor = 'grab';

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', stop, true);
    document.removeEventListener('pointercancel', stop, true);
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;

    // Controls in the header stay controls.
    if (e.target.closest?.('button, input, textarea, select, a, [contenteditable="true"]')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const rect = panel.getBoundingClientRect();

    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    panel.classList.add('is-dragging');
    handle.style.cursor = 'grabbing';

    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {}

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', stop, true);
    document.addEventListener('pointercancel', stop, true);
  }, true);
}
