// ============================================================
// YANTA — Predictive Back (Android app shell)
//
// Android 13+ hands the back gesture to the app *while the finger is
// still down*: the system asks for a preview of what back would do and
// only commits when the swipe is released.
//
// The native half lives in MainActivity.kt:
//  - the OnBackPressedCallback stays disabled on the root entry, so the
//    system plays its own back-to-home preview,
//  - while it is enabled, every swipe event is forwarded here.
//
// This module answers two questions:
//  1. "Is there anything left to go back to?"  -> setBackState()
//  2. "What would back close?"                 -> the animated surface
//
// Browsers do not expose gesture progress, so everything here is a no-op
// outside the Android WebView.
// ============================================================

import {
  overlayIdFromState,
  overlayRouteSurface,
} from '../overlay-history.js';

let installed = false;

/** Surface descriptor of the running gesture, null while idle. */
let activeSurface = null;
let cleanupTimer = 0;

// Material predictive-back spec (developer.android.com/design → predictive back).
const MIN_SCALE = 0.9;
const EDGE_MARGIN = 8;
const SLIDE_PREVIEW = 26;
const COMMIT_MS = 160;
const CANCEL_MS = 220;

function isAndroidApp() {
  return !!window.YantaAndroid;
}

function callAndroid(method, ...args) {
  try {
    if (!window.YantaAndroid?.[method]) return null;
    return window.YantaAndroid[method](...args);
  } catch (err) {
    console.warn('[YANTA predictive-back]', method, err);
    return null;
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * STANDARD_DECELERATE, i.e. cubic-bezier(0, 0, 0, 1) solved for x:
 * both control points sit on x = 0, so x = t³ and y = 3t² - 2t³.
 * Movement is easy to spot at the very start of the swipe.
 */
function decelerate(progress) {
  const x = Math.min(Math.max(progress, 0), 1);
  const t = Math.cbrt(x);
  return 3 * t * t - 2 * t * t * t;
}

// ------------------------------------------------------------
// Which surface does back close?
// ------------------------------------------------------------

function visibleModalSurface() {
  const modals = [...document.querySelectorAll('.modal:not([hidden])')]
    .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');

  const modal = modals[modals.length - 1];
  if (!modal) return null;

  return {
    element: modal.querySelector('.modal-card') || modal,
    backdrop: modal,
    mode: 'shrink',
  };
}

/**
 * Resolution order: what the top overlay declared, then any open modal,
 * then the whole app shell — which is exactly the system's cross-activity
 * look and therefore a safe fallback for route-level back.
 */
function resolveSurface() {
  const declared = overlayRouteSurface(overlayIdFromState());

  if (declared?.element?.isConnected) return declared;

  const modal = visibleModalSurface();
  if (modal) return modal;

  const app = document.getElementById('app');
  if (!app) return null;

  return {
    element: app,
    mode: 'shrink',
    root: true,
  };
}

// ------------------------------------------------------------
// Gesture rendering
// ------------------------------------------------------------

function setTransform(el, value) {
  // The mobile sidebar transform is authored with !important, so inline
  // styles only win when they carry the flag as well.
  el.style.setProperty('transform', value, 'important');
}

function renderShrink(surface, eased, touchY, swipeEdge) {
  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;

  // BackEvent carries physical pixels, the layout below is CSS pixels.
  const touch = touchY / (window.devicePixelRatio || 1);

  const scale = 1 - (1 - MIN_SCALE) * eased;

  const maxX = Math.max(width / 20 - EDGE_MARGIN, 0);
  const maxY = Math.max(height / 20 - EDGE_MARGIN, 0);

  // Swiping from the left edge pushes the surface to the right, and vice
  // versa — the surface detaches from the edge the finger came from.
  const dirX = swipeEdge === 1 ? -1 : 1;

  const center = height / 2;
  const dirY = center > 0
    ? Math.min(Math.max((touch - center) / center, -1), 1)
    : 0;

  setTransform(
    surface.element,
    `translate3d(${dirX * maxX * eased}px, ${dirY * maxY * eased}px, 0) scale(${scale})`
  );

  // A previewed surface detaches from the screen edges, so it gets the
  // rounded window corners the system uses for the same motion.
  surface.element.style.borderRadius = `${28 * eased}px`;
  surface.element.style.overflow = 'hidden';

  if (surface.backdrop) {
    surface.backdrop.style.opacity = String(1 - 0.35 * eased);
  }
}

function renderSlide(surface, eased) {
  const dir = surface.mode === 'slide-right' ? 1 : -1;

  /*
    A preview hints at the exit, it never performs it: at half a swipe the
    drawer must still be clearly on screen, otherwise releasing back into
    "cancel" looks like the drawer re-opens from nothing.
  */
  setTransform(surface.element, `translate3d(${dir * SLIDE_PREVIEW * eased}%, 0, 0)`);

  if (surface.backdrop) {
    surface.backdrop.style.opacity = String(1 - 0.45 * eased);
  }
}

function render(surface, progress, touchY, swipeEdge) {
  const eased = decelerate(progress);

  if (surface.mode === 'slide-left' || surface.mode === 'slide-right') {
    renderSlide(surface, eased);
    return;
  }

  renderShrink(surface, eased, touchY, swipeEdge);
}

function clearSurface(surface) {
  if (!surface) return;

  for (const el of [surface.element, surface.backdrop]) {
    if (!el) continue;
    el.style.removeProperty('transform');
    el.style.removeProperty('transition');
    el.style.removeProperty('opacity');
    el.style.removeProperty('border-radius');
    el.style.removeProperty('overflow');
    el.classList.remove('yanta-back-gesture');
  }

  document.documentElement.classList.remove('yanta-back-gesture-active');
}

function setTransition(surface, ms, easing) {
  for (const el of [surface.element, surface.backdrop]) {
    if (!el) continue;
    el.style.setProperty(
      'transition',
      `transform ${ms}ms ${easing}, opacity ${ms}ms ${easing}, border-radius ${ms}ms ${easing}`,
      'important'
    );
  }
}

function endGesture(committed) {
  const surface = activeSurface;
  activeSurface = null;

  if (!surface) return;

  window.clearTimeout(cleanupTimer);

  if (committed) {
    /*
      From here on the app's own close animation owns the surface. A
      drawer has one (220ms slide-out), so the gesture transform is
      dropped right away and its transition continues from wherever the
      finger left it; a shrunk shell has none and eases back instead.
    */
    if (surface.mode === 'slide-left' || surface.mode === 'slide-right') {
      clearSurface(surface);
      return;
    }

    setTransition(surface, COMMIT_MS, 'cubic-bezier(.2, .8, .2, 1)');
    cleanupTimer = window.setTimeout(() => clearSurface(surface), COMMIT_MS);
    return;
  }

  setTransition(surface, CANCEL_MS, 'cubic-bezier(.2, .8, .2, 1)');
  setTransform(surface.element, 'none');

  // Dropping the inline radius transitions back to the authored one.
  surface.element.style.removeProperty('border-radius');

  if (surface.backdrop) surface.backdrop.style.opacity = '1';

  cleanupTimer = window.setTimeout(() => clearSurface(surface), CANCEL_MS);
}

function startGesture() {
  window.clearTimeout(cleanupTimer);

  // A second gesture on top of a running one: drop the old transform.
  if (activeSurface) clearSurface(activeSurface);

  if (prefersReducedMotion()) {
    activeSurface = null;
    return;
  }

  const surface = resolveSurface();
  if (!surface?.element) return;

  /*
    Only a backdrop that sits *next to* the surface may be faded. Modal
    scrims wrap their card, and opacity on an ancestor drags the card
    along — the whole overlay would go translucent instead of stepping
    back.
  */
  if (surface.backdrop?.contains(surface.element)) surface.backdrop = null;

  activeSurface = surface;

  for (const el of [surface.element, surface.backdrop]) {
    if (!el) continue;
    // Authored transitions (the sidebar has a 220ms one) would run a frame
    // behind the finger — the gesture drives every value itself.
    el.style.setProperty('transition', 'none', 'important');
    el.classList.add('yanta-back-gesture');
  }

  if (surface.root) {
    document.documentElement.classList.add('yanta-back-gesture-active');
  }
}

// ------------------------------------------------------------
// Back-target reporting
// ------------------------------------------------------------

function reportBackState() {
  const nav = window.navigation;

  /*
    The Navigation API knows about pushState entries the WebView cannot
    tell apart from a fresh document load. Where it is missing, an open
    overlay is still a certain back target; the native side ORs this with
    its own WebView history, so under-reporting is harmless.
  */
  const canGoBack = nav
    ? !!nav.canGoBack
    : !!overlayIdFromState();

  callAndroid('setBackState', canGoBack);
}

// ------------------------------------------------------------

export function installPredictiveBack() {
  if (installed || !isAndroidApp()) return;
  installed = true;

  /** Called from MainActivity.evaluateBackGesture(). */
  window.__yantaPredictiveBack = (phase, progress = 0, touchX = 0, touchY = 0, swipeEdge = 0) => {
    try {
      if (phase === 'start') {
        startGesture();
      }

      if (phase === 'start' || phase === 'progress') {
        if (activeSurface) render(activeSurface, progress, touchY, swipeEdge);
        return;
      }

      endGesture(phase === 'commit');
    } catch (err) {
      console.warn('[YANTA predictive-back]', phase, err);
      endGesture(false);
    }
  };

  window.navigation?.addEventListener('currententrychange', reportBackState);
  window.addEventListener('popstate', reportBackState);
  window.addEventListener('pageshow', reportBackState);

  reportBackState();
}
