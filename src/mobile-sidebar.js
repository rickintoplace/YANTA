// ============================================================
// YANTA — Mobile Sidebar Controller
//
// History-aware:
// - opening mobile sidebar pushes overlay state
// - browser/Android Back closes sidebar
// - CSS owns animation
// ============================================================

import {
  $,
} from './core.js';

import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
} from './overlay-history.js';

const MOBILE_MQ = window.matchMedia('(max-width: 880px)');
const SIDEBAR_ANIM_MS = 220;
const CLOSE_FALLBACK_MS = SIDEBAR_ANIM_MS + 90;

let initialized = false;
let closeTimer = 0;
let transitionToken = 0;
let onMobileLayout = null;
let mobileSidebarOverlayRegistered = false;

function isMobileViewport() {
  return MOBILE_MQ.matches;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function elements() {
  const app = $('app');
  const sidebar = $('sidebar');

  if (!app || !sidebar) {
    return {
      app: null,
      sidebar: null,
      toggle: null,
      backdrop: null,
    };
  }

  const toggle =
    $('btn-sidebar-toggle') ||
    document.querySelector('[data-mobile-sidebar-toggle]') ||
    null;

  let backdrop = $('sidebarBackdrop');

  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'sidebar-backdrop';
    backdrop.hidden = true;
    app.append(backdrop);
  }

  return {
    app,
    sidebar,
    toggle,
    backdrop,
  };
}

function clearCloseTimer() {
  window.clearTimeout(closeTimer);
  closeTimer = 0;
}

export function isMobileSidebarOpen() {
  const { app } = elements();
  return !!app?.classList.contains('sidebar-open');
}

function registerMobileSidebarOverlayRoute() {
  if (mobileSidebarOverlayRegistered) return;

  mobileSidebarOverlayRegistered = true;

  registerOverlayRoute('mobile-sidebar', {
    open: () => {
      openMobileSidebar({
        fromHistory: true,
      });
    },

    close: () => {
      closeMobileSidebar({
        fromHistory: true,
      });
    },

    isOpen: isMobileSidebarOpen,
  });
}

export function openMobileSidebar({
  fromHistory = false,
} = {}) {
  if (!isMobileViewport()) return;

  registerMobileSidebarOverlayRoute();

  const {
    app,
    sidebar,
    toggle,
    backdrop,
  } = elements();

  if (!app || !sidebar || !backdrop) return;

  clearCloseTimer();

  const token = ++transitionToken;
  const wasClosed = !app.classList.contains('sidebar-open');

  backdrop.hidden = false;
  toggle?.setAttribute('aria-expanded', 'true');

  if (!fromHistory && wasClosed) {
    pushOverlayState('mobile-sidebar');
  }

  if (!wasClosed) return;

  /*
    Force layout with backdrop visible and sidebar closed.
    Then class change can animate reliably.
  */
  try {
    sidebar.getBoundingClientRect();
    backdrop.getBoundingClientRect();
  } catch {}

  requestAnimationFrame(() => {
    if (token !== transitionToken) return;
    app.classList.add('sidebar-open');
  });
}

export function closeMobileSidebar({
  animated = true,
  fromHistory = false,
} = {}) {
  const {
    app,
    sidebar,
    toggle,
    backdrop,
  } = elements();

  if (!app || !sidebar || !backdrop) return;

  if (
    !fromHistory &&
    app.classList.contains('sidebar-open') &&
    history.state?.yantaOverlay === 'mobile-sidebar'
  ) {
    closeTopOverlay(() => {
      closeMobileSidebar({
        animated,
        fromHistory: true,
      });
    });

    return;
  }

  clearCloseTimer();

  const token = ++transitionToken;

  toggle?.setAttribute('aria-expanded', 'false');

  if (!app.classList.contains('sidebar-open')) {
    backdrop.hidden = true;
    return;
  }

  const finish = () => {
    if (token !== transitionToken) return;
    if (app.classList.contains('sidebar-open')) return;

    backdrop.hidden = true;
  };

  if (!animated || prefersReducedMotion()) {
    app.classList.remove('sidebar-open');
    finish();
    return;
  }

  /*
    CSS transition starts here.
    Backdrop stays visible until transition end/fallback.
  */
  app.classList.remove('sidebar-open');

  const onTransitionEnd = (e) => {
    if (e.target !== sidebar) return;
    if (e.propertyName !== 'transform') return;

    sidebar.removeEventListener('transitionend', onTransitionEnd);
    finish();
  };

  sidebar.addEventListener('transitionend', onTransitionEnd);

  closeTimer = window.setTimeout(() => {
    sidebar.removeEventListener('transitionend', onTransitionEnd);
    finish();
  }, CLOSE_FALLBACK_MS);
}

export function toggleMobileSidebar() {
  if (isMobileSidebarOpen()) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

/**
 * Setup once.
 *
 * onMobileLayoutChange is called when viewport switches into mobile.
 * main.js can use it to force edit-only instead of split view.
 */
export function setupMobileSidebarController({
  onMobileLayoutChange = null,
} = {}) {
  onMobileLayout = onMobileLayoutChange;

  registerMobileSidebarOverlayRoute();

  if (initialized) return;
  initialized = true;

  const {
    app,
    sidebar,
    toggle,
    backdrop,
  } = elements();

  if (!app || !sidebar || !backdrop) return;

  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      toggleMobileSidebar();
    });
  }

  backdrop.addEventListener('click', () => {
    closeMobileSidebar();
  });

  /*
    Public event contract.
  */
  window.addEventListener('yanta-close-mobile-sidebar', (e) => {
    if (!isMobileViewport()) return;

    closeMobileSidebar({
      animated: e.detail?.animated !== false,
    });
  });

  window.addEventListener('yanta-open-mobile-sidebar', () => {
    openMobileSidebar();
  });

  window.addEventListener('yanta-toggle-mobile-sidebar', () => {
    toggleMobileSidebar();
  });

  /*
    Tap outside closes sidebar.
    Do not prevent/stop the event.
  */
  document.addEventListener('pointerdown', (e) => {
    if (!isMobileViewport()) return;
    if (!app.classList.contains('sidebar-open')) return;

    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    if (sidebar.contains(target)) return;
    if (toggle?.contains?.(target)) return;

    closeMobileSidebar();
  }, {
    capture: true,
    passive: true,
  });

  MOBILE_MQ.addEventListener?.('change', () => {
    if (!isMobileViewport()) {
      closeMobileSidebar({
        animated: false,
        fromHistory: true,
      });
      return;
    }

    onMobileLayout?.();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.classList.contains('sidebar-open')) {
      closeMobileSidebar();
    }
  });
}