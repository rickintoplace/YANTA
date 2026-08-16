// ============================================================
// YANTA — Menu positioning.
//
// Every popup menu has the same job: appear at the pointer and stay fully on
// screen. Right-clicking near the bottom edge is the common case, and a menu
// that runs off the viewport there is simply unusable — especially on a phone,
// where there is nothing to scroll it back into view.
// ============================================================

const MARGIN = 8;

let contextMenuWatcher = null;

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

  let rect = menu.getBoundingClientRect();

  /*
    A menu taller than the screen cannot be nudged into view — Excalidraw's
    element menu plus YANTA's own entries is around 830px, which does not fit
    a laptop window. Cap it and let it scroll, instead of dropping its last
    entries off the bottom edge.
  */
  const available = window.innerHeight - margin * 2;

  if (rect.height > available) {
    menu.style.maxHeight = `${Math.round(available)}px`;
    menu.style.overflowY = 'auto';
    menu.style.overscrollBehavior = 'contain';

    rect = menu.getBoundingClientRect();
  }

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

  /*
    Derived from the host's measured box rather than from its `top`/`left`
    style: the popup may be placed with `bottom`, with `auto`, or via a
    transform, and parsing the wrong one moves it somewhere random instead of
    nudging it.
  */
  const hostRect = host.getBoundingClientRect();
  const parent = host.offsetParent;
  const parentRect = parent
    ? parent.getBoundingClientRect()
    : { top: 0, left: 0 };

  host.style.top = `${Math.round(hostRect.top + dy - parentRect.top)}px`;
  host.style.left = `${Math.round(hostRect.left + dx - parentRect.left)}px`;
  host.style.bottom = 'auto';
  host.style.right = 'auto';
}

/**
 * Fits every Excalidraw context menu that opens anywhere in the app.
 *
 * Deliberately global rather than hooked into the code that adds YANTA's own
 * entries: those injectors only run for certain selections, so menus opened in
 * other situations were left unfitted — which is why the *first* right-click
 * near the bottom edge still lost the end of the menu.
 */
export function watchExcalidrawContextMenus() {
  if (contextMenuWatcher) return;

  const SELECTOR = '.context-menu, [data-testid="context-menu"]';

  const fitAll = (root) => {
    if (!(root instanceof Element)) return;

    if (root.matches?.(SELECTOR)) {
      keepMenuInViewportWhileOpen(root);
      return;
    }

    root.querySelectorAll?.(SELECTOR).forEach((menu) => {
      keepMenuInViewportWhileOpen(menu);
    });
  };

  contextMenuWatcher = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) fitAll(node);
    }
  });

  contextMenuWatcher.observe(document.body, {
    childList: true,
    subtree: true,
  });
}


/**
 * Keeps a third-party menu inside the viewport for as long as it is open.
 *
 * A single correction is not enough: the menu is measured the moment it
 * appears, but React is often still filling it in — and anything appended
 * afterwards (our own entries) makes it taller again. Excalidraw may also
 * re-apply its own position after mounting. So the fit is re-checked over the
 * next few frames and on every size change until the menu is gone.
 *
 * Symptom without this: the first right-click near the bottom edge showed a
 * clipped menu, the second one was fine because the menu was already sized.
 */
export function keepMenuInViewportWhileOpen(menu, { margin = MARGIN } = {}) {
  if (!menu?.isConnected) return;

  const fit = () => {
    if (!menu.isConnected) return false;

    keepMenuInViewport(menu, { margin });

    return true;
  };

  if (menu.dataset.yantaMenuFitted === '1') {
    fit();
    return;
  }

  menu.dataset.yantaMenuFitted = '1';

  fit();
  requestAnimationFrame(fit);

  /*
    A short poll on top of the ResizeObserver: the menu can be *moved* by its
    owner after mounting (Excalidraw sets the popover position itself), and a
    size observer never sees that. Bounded to under a second, so it costs
    nothing once the menu has settled.
  */
  let ticks = 0;

  const poll = window.setInterval(() => {
    ticks++;

    if (!fit() || ticks > 10) window.clearInterval(poll);
  }, 80);

  if (typeof ResizeObserver !== 'function') return;

  const observer = new ResizeObserver(() => {
    if (!fit()) observer.disconnect();
  });

  observer.observe(menu);

  // Stop watching once the menu is detached; nothing else disposes of it.
  const stopWhenGone = () => {
    if (menu.isConnected) {
      window.setTimeout(stopWhenGone, 400);
      return;
    }

    observer.disconnect();
    window.clearInterval(poll);
  };

  window.setTimeout(stopWhenGone, 400);
}

/**
 * A container pinned to the top of a third-party menu, for the app's own
 * entries.
 *
 * Appending was the obvious thing and the wrong one: Excalidraw's element
 * menu is long enough to need scrolling, so entries added at the end sat
 * below the fold and were, in practice, unreachable. Several injectors share
 * one section so their order stays stable.
 */
export function menuTopSection(menu, { className = 'yanta-menu-section' } = {}) {
  const existing = menu.querySelector(`:scope > .${className}`);
  if (existing) return existing;

  const section = document.createElement('div');
  section.className = className;

  // Styled inline: the host menu is third-party markup with its own theme
  // variables, and this is the whole of the styling it needs.
  section.style.paddingBottom = '.5rem';
  section.style.marginBottom = '.25rem';
  section.style.borderBottom = '1px solid var(--button-gray-3, rgba(0, 0, 0, 0.12))';

  menu.prepend(section);

  return section;
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
