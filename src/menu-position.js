// ============================================================
// YANTA — Menu positioning.
//
// Every popup menu has the same job: appear at the pointer and stay fully on
// screen. Right-clicking near the bottom edge is the common case, and a menu
// that runs off the viewport there is simply unusable — especially on a phone,
// where there is nothing to scroll it back into view.
// ============================================================

const MARGIN = 8;

/**
 * Positions a fixed/absolute menu at (x, y) and flips or nudges it so the
 * whole menu stays inside the viewport.
 *
 * @param {HTMLElement} menu   must already be in the DOM and measurable
 * @param {number} x
 * @param {number} y
 * @param {object} [options]
 * @param {'start'|'end'} [options.align]  horizontal anchor of x
 */
export function positionMenuAt(menu, x, y, { align = 'start', margin = MARGIN } = {}) {
  const rect = menu.getBoundingClientRect();

  let left = align === 'end' ? x - rect.width : x;
  let top = y;

  if (left + rect.width > window.innerWidth - margin) {
    left = window.innerWidth - rect.width - margin;
  }

  if (left < margin) left = margin;

  // Prefer flipping above the pointer; only clamp when it does not fit either
  // way, so the menu never covers the thing it was opened on.
  if (top + rect.height > window.innerHeight - margin) {
    const flipped = y - rect.height - 6;

    top = flipped >= margin
      ? flipped
      : Math.max(margin, window.innerHeight - rect.height - margin);
  }

  if (top < margin) top = margin;

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;

  return { left, top };
}

/**
 * Nudges an already-positioned menu back into the viewport.
 *
 * For third-party menus (Excalidraw's context menu) the offsets live on a
 * positioned ancestor, not on the menu element itself — so the correction is
 * measured on the menu and applied to whichever ancestor actually carries the
 * offset.
 */
export function keepMenuInViewport(menu, { margin = MARGIN } = {}) {
  if (!menu?.isConnected) return;

  const host = positionedHost(menu);
  if (!host) return;

  const rect = menu.getBoundingClientRect();

  let dx = 0;
  let dy = 0;

  if (rect.bottom > window.innerHeight - margin) {
    dy = (window.innerHeight - margin) - rect.bottom;
  }

  if (rect.top + dy < margin) {
    dy = margin - rect.top;
  }

  if (rect.right > window.innerWidth - margin) {
    dx = (window.innerWidth - margin) - rect.right;
  }

  if (rect.left + dx < margin) {
    dx = margin - rect.left;
  }

  if (!dx && !dy) return;

  const style = getComputedStyle(host);
  const top = parseFloat(host.style.top || style.top) || 0;
  const left = parseFloat(host.style.left || style.left) || 0;

  host.style.top = `${Math.round(top + dy)}px`;
  host.style.left = `${Math.round(left + dx)}px`;
}

function positionedHost(node) {
  let current = node;

  while (current && current !== document.body) {
    const position = getComputedStyle(current).position;

    if (position === 'absolute' || position === 'fixed') return current;

    current = current.parentElement;
  }

  return null;
}
