// ============================================================
// YANTA Slides — Animation.
//
// Two independent things live here:
//
// 1. Build steps — parts of a slide that appear one click at a time, the way
//    Keynote/PowerPoint "builds" work. A step is a set of element ids plus an
//    effect; the presentation reveals them in order before moving on.
//
// 2. Slide transitions — how the camera arrives at the next slide.
//
// Reliability rules that shape the whole module:
// - Nothing here may ever be persisted. Every scene write goes through
//   runDrawingApiUpdateWithoutSaving, and the original opacity/position of
//   every touched element is remembered so it can be restored exactly.
// - Hidden build elements use `opacity: 0` + `locked: true`, the same marker
//   slide frames use, so a scene re-hydration mid-presentation leaves them
//   hidden instead of flashing the whole slide (see applyPersistedDrawingToApi).
// - Every entry point tolerates a missing or swapped Excalidraw API: the
//   fullscreen stage can remount underneath a running presentation.
// ============================================================

import { uid } from '../core.js';
import { runDrawingApiUpdateWithoutSaving } from '../draw-scene-sync.js';

export const SLIDE_TRANSITIONS = ['auto', 'cut', 'fade'];

export const SLIDE_TRANSITION_LABELS = {
  auto: 'Move camera',
  cut: 'Cut',
  fade: 'Fade',
};

export const SLIDE_BUILD_EFFECTS = ['fade', 'rise', 'drift'];

export const SLIDE_BUILD_EFFECT_LABELS = {
  fade: 'Fade in',
  rise: 'Rise up',
  drift: 'Drift in',
};

const DEFAULT_BUILD_DURATION = 420;
const DEFAULT_TRANSITION_DURATION = 520;

// Scene-unit travel of the moving effects, scaled by the element's own size so
// a sticker and a full-width headline both move a sensible distance.
const TRAVEL_BASE = 28;
const TRAVEL_MAX = 90;

// ------------------------------------------------------------
// Model
// ------------------------------------------------------------

function normalizeBuild(raw = {}, index = 0) {
  const elementIds = [...new Set(
    (Array.isArray(raw.elementIds) ? raw.elementIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  )];

  if (!elementIds.length) return null;

  const effect = SLIDE_BUILD_EFFECTS.includes(raw.effect) ? raw.effect : 'fade';
  const duration = Number(raw.duration);

  return {
    id: String(raw.id || uid()),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    elementIds,
    effect,
    duration: Number.isFinite(duration)
      ? Math.max(0, Math.min(3000, duration))
      : DEFAULT_BUILD_DURATION,
  };
}

export function normalizeSlideAnimation(raw = {}) {
  const transition = SLIDE_TRANSITIONS.includes(raw?.transition)
    ? raw.transition
    : 'auto';

  const builds = (Array.isArray(raw?.builds) ? raw.builds : [])
    .map(normalizeBuild)
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((build, index) => ({ ...build, order: index }));

  return {
    transition,
    builds,
  };
}

export function slideAnimation(slide) {
  return normalizeSlideAnimation(slide?.animation || {});
}

export function slideBuildCount(slide) {
  return slideAnimation(slide).builds.length;
}

/** Total presentation steps of a slide: the base view plus one per build. */
export function slideStepCount(slide) {
  return slideBuildCount(slide) + 1;
}

/**
 * Expands a raw selection into the element set a build step must move.
 *
 * Moving a container without its bound label, or half a group, looks broken —
 * so the selection grows to whole groups and to bound text.
 */
export function expandBuildSelection(elements = [], selectedIds = []) {
  const wanted = new Set(selectedIds.map(String).filter(Boolean));
  if (!wanted.size) return [];

  const byId = new Map();
  const groups = new Set();

  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    byId.set(el.id, el);
  }

  for (const id of wanted) {
    const el = byId.get(id);
    if (!el) continue;

    for (const groupId of el.groupIds || []) groups.add(groupId);
  }

  const out = new Set();

  const add = (el) => {
    if (!el || el.isDeleted || out.has(el.id)) return;

    out.add(el.id);

    for (const bound of el.boundElements || []) {
      const boundEl = byId.get(bound?.id);
      if (boundEl) add(boundEl);
    }
  };

  for (const el of byId.values()) {
    if (wanted.has(el.id) || (el.groupIds || []).some((g) => groups.has(g))) {
      add(el);
    }
  }

  return [...out];
}

// ------------------------------------------------------------
// Runtime
// ------------------------------------------------------------

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function travelFor(el, effect) {
  if (effect === 'rise' || effect === 'drift') {
    const size = effect === 'rise'
      ? Math.abs(Number(el?.height) || 0)
      : Math.abs(Number(el?.width) || 0);

    return Math.min(TRAVEL_MAX, TRAVEL_BASE + size * 0.25);
  }

  return 0;
}

/**
 * Drives build steps for one running presentation.
 *
 * The animator owns no elements of its own. It keeps a set of *overrides* —
 * the presentation-only opacity/offset each animated element should currently
 * have — plus the untouched original of everything it ever overrode, and
 * applies the difference to the live scene.
 *
 * Why overrides instead of patching straight through: Excalidraw commits
 * updateScene() through React, so two read-modify-write passes in the same
 * tick both start from the pre-update element array and the second silently
 * undoes the first. That is exactly what happens next to the slide-frame
 * visibility pass. Writes are therefore coalesced into one per animation
 * frame, which reads a scene that has settled.
 */
export function createSlideAnimator({ getApi }) {
  // elementId -> untouched { opacity, x, y, locked }
  const originals = new Map();

  // elementId -> presentation-only patch currently in force
  const overrides = new Map();

  let applyRaf = 0;
  let animationRaf = 0;

  function readElements() {
    const api = getApi?.();
    if (!api) return { api: null, elements: [] };

    try {
      const elements = api.getSceneElementsIncludingDeleted?.() ||
        api.getSceneElements?.() ||
        [];

      return { api, elements: Array.isArray(elements) ? elements : [] };
    } catch {
      return { api, elements: [] };
    }
  }

  function remember(el) {
    if (originals.has(el.id)) return originals.get(el.id);

    const snapshot = {
      opacity: el.opacity,
      x: el.x,
      y: el.y,
      locked: el.locked === true,
    };

    originals.set(el.id, snapshot);

    return snapshot;
  }

  function differs(el, target) {
    return (
      el.opacity !== target.opacity ||
      el.x !== target.x ||
      el.y !== target.y ||
      el.locked !== target.locked
    );
  }

  /** Writes the current overrides — and only them — into the live scene. */
  function applyNow() {
    applyRaf = 0;

    const { api, elements } = readElements();
    if (!api) return;

    const patches = new Map();

    for (const el of elements) {
      if (!el) continue;

      const override = overrides.get(el.id);

      if (override) {
        // Snapshot before the first override, while the element is still the
        // one the user drew.
        const original = remember(el);
        const target = { ...original, ...override };

        if (differs(el, target)) patches.set(el.id, target);

        continue;
      }

      const original = originals.get(el.id);

      if (original && differs(el, original)) {
        patches.set(el.id, { ...original });
      }
    }

    if (!patches.size) return;

    runDrawingApiUpdateWithoutSaving(api, {
      elements: elements.map((el) =>
        patches.has(el.id) ? { ...el, ...patches.get(el.id) } : el
      ),
    }, { refresh: false });
  }

  function scheduleApply() {
    if (applyRaf) return;
    applyRaf = requestAnimationFrame(applyNow);
  }

  function cancelAnimation() {
    if (!animationRaf) return;

    cancelAnimationFrame(animationRaf);
    animationRaf = 0;
  }

  function idsForSteps(slide, fromIndex) {
    const { builds } = slideAnimation(slide);
    const ids = new Set();

    for (let i = fromIndex; i < builds.length; i++) {
      for (const id of builds[i].elementIds) ids.add(id);
    }

    return ids;
  }

  /**
   * Puts a slide into the state of a given step: everything up to `step` is
   * visible, everything after it is hidden. No animation — this is the jump
   * used when entering a slide or stepping backwards.
   */
  function showStep(slide, step = 0) {
    cancelAnimation();

    overrides.clear();

    for (const id of idsForSteps(slide, step)) {
      // opacity 0 + locked is the marker a scene re-hydration keeps hidden
      // (see applyPersistedDrawingToApi), so a sync mid-presentation cannot
      // flash the rest of the slide.
      overrides.set(id, { opacity: 0, locked: true });
    }

    scheduleApply();
  }

  /** Reveals one build step with its effect. */
  function revealStep(slide, stepIndex) {
    cancelAnimation();

    const build = slideAnimation(slide).builds[stepIndex];
    if (!build) return;

    const { elements } = readElements();

    const targets = elements
      .filter((el) => el && !el.isDeleted && build.elementIds.includes(el.id))
      .map((el) => ({
        id: el.id,
        original: remember(el),
        travel: travelFor(el, build.effect),
      }));

    const finish = () => {
      animationRaf = 0;

      for (const target of targets) overrides.delete(target.id);

      scheduleApply();
    };

    if (!targets.length) {
      finish();
      return;
    }

    if (!build.duration || prefersReducedMotion()) {
      finish();
      return;
    }

    const start = performance.now();

    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / build.duration);

      if (t >= 1) {
        finish();
        return;
      }

      const k = easeOutCubic(t);

      for (const target of targets) {
        const override = {
          opacity: Math.max(1, Math.round(target.original.opacity * k)),
          locked: true,
        };

        if (build.effect === 'rise') {
          override.y = target.original.y + target.travel * (1 - k);
        } else if (build.effect === 'drift') {
          override.x = target.original.x - target.travel * (1 - k);
        }

        overrides.set(target.id, override);
      }

      applyNow();

      animationRaf = requestAnimationFrame(tick);
    };

    animationRaf = requestAnimationFrame(tick);
  }

  /** Puts every element this animator touched back the way the user drew it. */
  function restore() {
    cancelAnimation();

    if (applyRaf) {
      cancelAnimationFrame(applyRaf);
      applyRaf = 0;
    }

    if (!originals.size) {
      overrides.clear();
      return;
    }

    overrides.clear();
    applyNow();
    originals.clear();
  }

  return {
    showStep,
    revealStep,
    restore,
  };
}

// ------------------------------------------------------------
// Slide transitions
// ------------------------------------------------------------

let transitionVeil = null;

function ensureTransitionVeil() {
  if (transitionVeil?.isConnected) return transitionVeil;

  transitionVeil = document.createElement('div');
  transitionVeil.className = 'yanta-slide-transition-veil';
  transitionVeil.setAttribute('aria-hidden', 'true');

  document.body.append(transitionVeil);

  return transitionVeil;
}

export function removeTransitionVeil() {
  transitionVeil?.remove();
  transitionVeil = null;
}

/**
 * Runs the camera change for a slide with the slide's chosen transition.
 *
 * `applyCamera` gets `{ animate }` and is responsible for the actual move:
 * with `animate: true` it should ease the camera across, otherwise jump.
 *
 * The fade is a DOM veil rather than a canvas effect on purpose — it is
 * GPU-composited, cannot desync from the scene, and looks identical no matter
 * how heavy the board is.
 */
export function runSlideTransition(slide, applyCamera, {
  duration = DEFAULT_TRANSITION_DURATION,
} = {}) {
  const { transition } = slideAnimation(slide);

  if (transition === 'cut' || prefersReducedMotion()) {
    applyCamera({ animate: false });
    return;
  }

  if (transition !== 'fade') {
    applyCamera({ animate: true });
    return;
  }

  const veil = ensureTransitionVeil();
  const half = Math.max(90, duration / 2);

  veil.style.transitionDuration = `${half}ms`;
  veil.classList.add('is-active');

  window.setTimeout(() => {
    applyCamera({ animate: false });

    // One frame on the far side of the camera jump, so the reveal never
    // uncovers the previous slide.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => veil.classList.remove('is-active'));
    });
  }, half);
}
