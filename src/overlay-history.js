// ============================================================
// YANTA — Central Overlay History Router
//
// Browser/Android Back should close the top-most transient UI first.
// Feature modules can register overlay open/close handlers by stable id.
//
// Supports stacked overlays:
//
//   App route
//   -> mobile-sidebar
//   -> settings
//
//   App route
//   -> ai-fullscreen
//   -> ai-settings
//   -> ai-context-picker
//
// Compatible with existing RSS implementation:
// - still dispatches "yanta-overlay-route"
// - pushOverlayState / closeTopOverlay keep their existing names
// ============================================================

const registry = new Map();

let initialized = false;
let syncing = false;

function cleanOverlayStack(stack = []) {
  return [...new Set(
    (Array.isArray(stack) ? stack : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  )];
}

function stackFromState(state = history.state) {
  const id = overlayIdFromState(state);

  if (!id) return [];

  const stack = cleanOverlayStack(state?.yantaOverlayStack || []);

  if (!stack.length) return [id];

  if (stack[stack.length - 1] !== id) {
    return [...stack.filter((x) => x !== id), id];
  }

  return stack;
}

export function overlayIdFromState(state = history.state) {
  return state?.yantaOverlay || null;
}

export function overlayStackFromState(state = history.state) {
  return stackFromState(state);
}

export function isOverlayState(state = history.state) {
  return !!overlayIdFromState(state);
}

export function registerOverlayRoute(id, handlers = {}) {
  if (!id) throw new Error('registerOverlayRoute: id required');

  registry.set(id, {
    open: handlers.open || null,
    close: handlers.close || null,
    isOpen: handlers.isOpen || null,
  });

  return () => {
    registry.delete(id);
  };
}

export function pushOverlayState(id, data = {}, {
  replace = false,
} = {}) {
  if (!id) throw new Error('pushOverlayState: id required');

  const currentId = overlayIdFromState();
  const currentStack = stackFromState();

  /*
    Important mobile UX:
    If an overlay is launched from the mobile sidebar, the sidebar entry
    must not stay underneath it. Otherwise Back from Settings/AI/Sources
    would reopen the sidebar instead of returning to the underlying app route.

    So:
      Dashboard -> mobile-sidebar
      click Settings
    becomes:
      Dashboard -> settings
    not:
      Dashboard -> mobile-sidebar -> settings
  */
  const launchedFromMobileSidebar =
    currentId === 'mobile-sidebar' &&
    id !== 'mobile-sidebar';

  let nextStack;

  if (!currentId || launchedFromMobileSidebar) {
    nextStack = [id];
  } else if (currentId === id) {
    nextStack = currentStack.length
      ? currentStack
      : [id];
  } else {
    nextStack = [
      ...currentStack.filter((x) => x !== id),
      id,
    ];
  }

  nextStack = cleanOverlayStack(nextStack);

  const parentId =
    nextStack.length > 1
      ? nextStack[nextStack.length - 2]
      : null;

  const state = {
    ...data,
    yantaOverlay: id,
    yantaOverlayData: data,
    yantaOverlayParent: parentId,
    yantaOverlayStack: nextStack,
  };

  const method = replace || currentId === id || launchedFromMobileSidebar
    ? 'replaceState'
    : 'pushState';

  history[method](state, '', location.href);
}

export function replaceOverlayState(id, data = {}) {
  pushOverlayState(id, data, {
    replace: true,
  });
}

/**
 * Request closing the current overlay.
 *
 * If current history state is an overlay:
 *   -> use history.back()
 *
 * Otherwise:
 *   -> run fallbackClose immediately
 */
export function closeTopOverlay(fallbackClose = null) {
  if (overlayIdFromState()) {
    history.back();
    return true;
  }

  if (typeof fallbackClose === 'function') {
    fallbackClose();
  }

  return false;
}

/**
 * One-call binding for self-contained overlays (modals, sheets, panels):
 * pushes the history entry and routes device-back/ESC into `close`.
 *
 * Only for overlays that a direct user action opens. One that a route
 * restores (the chat onboarding modal, for instance) must go through
 * registerOverlayRoute instead — it would otherwise re-push its entry
 * while the route reopens it, and Back would appear to do nothing.
 *
 * Returns a release function to call at the END of the overlay's own
 * close path, once the element is gone. It only drops a history entry
 * that is still this overlay's, which makes it a no-op both when the
 * router closed the overlay and when something was stacked on top —
 * so a single line inside `close` keeps every dismiss path in sync.
 */
export function openBoundOverlay(id, { close, isOpen }) {
  if (typeof close !== 'function') throw new Error('openBoundOverlay: close required');

  registerOverlayRoute(id, {
    /*
      Dismissed modals are not restorable on Forward — their callbacks
      and promise resolvers are gone. Reopening stays the module's call.
    */
    open: () => {},
    close: () => close({ fromHistory: true }),
    isOpen: isOpen || null,
  });

  pushOverlayState(id);

  return function releaseOverlayEntry() {
    if (overlayIdFromState() === id) history.back();
  };
}

async function closeOverlaysNotInStack(keepStack, targetId, state) {
  const keep = new Set(keepStack);

  for (const [id, handlers] of registry.entries()) {
    if (keep.has(id)) continue;

    const open = handlers.isOpen
      ? !!handlers.isOpen()
      : false;

    if (open && handlers.close) {
      await handlers.close({
        fromHistory: true,
        targetId,
        state,
      });
    }
  }
}

async function openOverlayStack(keepStack, targetId, state) {
  for (const id of keepStack) {
    if (!registry.has(id)) continue;

    const handlers = registry.get(id);

    const alreadyOpen = handlers.isOpen
      ? !!handlers.isOpen()
      : false;

    if (!alreadyOpen && handlers.open) {
      await handlers.open({
        fromHistory: true,
        targetId,
        state,
        data: state?.yantaOverlayData || state || {},
      });
    }
  }
}

async function syncOverlayRoute(targetId, state) {
  if (syncing) return;

  syncing = true;

  try {
    const keepStack = targetId
      ? stackFromState(state)
      : [];

    // Backward compatible event route for RSS and old integrations.
    window.dispatchEvent(new CustomEvent('yanta-overlay-route', {
      detail: {
        id: targetId,
        state,
        stack: keepStack,
      },
    }));

    /*
      Stacked overlay semantics:
      - Target stack entries stay open.
      - Anything above/outside the stack closes.
      - If a history state is restored directly, registered stack entries
        are opened in parent -> child order.
    */
    await closeOverlaysNotInStack(keepStack, targetId, state);
    await openOverlayStack(keepStack, targetId, state);
  } finally {
    syncing = false;
  }
}

export function setupOverlayHistoryRouter() {
  if (initialized) return;
  initialized = true;

  window.addEventListener('popstate', (event) => {
    const targetId = overlayIdFromState(event.state);

    syncOverlayRoute(targetId, event.state).catch((err) => {
      console.warn('[YANTA overlay-history] route sync failed', err);
    });
  });

  document.addEventListener('keydown', (e) => {
    // Synthetische Escape-Dispatches (etwa an Excalidraw) dürfen keine
    // History-Navigation auslösen — nur echte Nutzereingaben.
    if (e.key !== 'Escape' || !e.isTrusted) return;

    if (overlayIdFromState()) {
      e.preventDefault();

      /*
        Wichtig: window-Level-Handler (main.js handleGlobalKey) dürfen dieses
        ESC nicht zusätzlich interpretieren. Sonst schließt ESC auf einem
        Overlay (z. B. Chat-Settings) gleichzeitig die darunterliegende
        Surface — doppelte Navigation.
      */
      e.stopPropagation();
      history.back();
    }
  });
}