// ============================================================
// YANTA — Central Overlay History Router
//
// Browser/Android Back should close the top-most transient UI first.
// Feature modules can register overlay open/close handlers by stable id.
//
// Compatible with existing RSS implementation:
// - still dispatches "yanta-overlay-route"
// - pushOverlayState / closeTopOverlay keep their existing names
// ============================================================

const registry = new Map();

let initialized = false;
let syncing = false;

export function overlayIdFromState(state = history.state) {
  return state?.yantaOverlay || null;
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

  const state = {
    yantaOverlay: id,
    yantaOverlayData: data,
    ...data,
  };

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

async function syncOverlayRoute(targetId, state) {
  if (syncing) return;

  syncing = true;

  try {
    // Backward compatible event route for RSS and any old integrations.
    window.dispatchEvent(new CustomEvent('yanta-overlay-route', {
      detail: {
        id: targetId,
        state,
      },
    }));

    // Close every registered overlay except the target overlay.
    for (const [id, handlers] of registry.entries()) {
      if (id === targetId) continue;

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

    // Open/restore target overlay if needed.
    if (targetId && registry.has(targetId)) {
      const handlers = registry.get(targetId);

      const alreadyOpen = handlers.isOpen
        ? !!handlers.isOpen()
        : false;

      if (!alreadyOpen && handlers.open) {
        await handlers.open({
          fromHistory: true,
          state,
          data: state?.yantaOverlayData || state || {},
        });
      }
    }
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
    if (e.key !== 'Escape') return;

    if (overlayIdFromState()) {
      e.preventDefault();
      history.back();
    }
  });
}