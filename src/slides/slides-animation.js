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

import {
  registerScenePersistSanitizer,
  runDrawingApiUpdateWithoutSaving,
} from '../draw-scene-sync.js';

export const SLIDE_TRANSITIONS = ['auto', 'cut', 'fade'];

export const SLIDE_TRANSITION_LABELS = {
  auto: 'Move camera',
  cut: 'Cut',
  fade: 'Fade',
};

/*
  Entrance effects, PowerPoint's vocabulary plus the one a drawing app owes
  its users: Draw, which retraces a stroke the way it was drawn.

  Not every effect fits every element — you cannot wipe a line, and scaling a
  text box re-wraps it — so `effectForElement()` degrades to the closest thing
  that always looks right instead of rendering something broken.
*/
export const SLIDE_BUILD_EFFECTS = ['appear', 'fade', 'fly', 'wipe', 'zoom', 'draw'];

export const SLIDE_BUILD_EFFECT_LABELS = {
  appear: 'Appear',
  fade: 'Fade in',
  fly: 'Fly in',
  wipe: 'Wipe',
  zoom: 'Zoom in',
  draw: 'Draw',
};

export const SLIDE_BUILD_DIRECTIONS = ['left', 'right', 'up', 'down'];

export const SLIDE_BUILD_DIRECTION_LABELS = {
  left: 'From left',
  right: 'From right',
  up: 'From top',
  down: 'From bottom',
};

/*
  When a step starts, exactly like PowerPoint's animation pane:
  - click: waits for the presenter
  - with:  starts together with the previous step
  - after: starts when the previous step has finished
*/
export const SLIDE_BUILD_TRIGGERS = ['click', 'with', 'after'];

export const SLIDE_BUILD_TRIGGER_LABELS = {
  click: 'On click',
  with: 'With previous',
  after: 'After previous',
};

const DEFAULT_BUILD_DURATION = 500;
const DEFAULT_TRANSITION_DURATION = 520;

// Scene-unit travel of the moving effects, scaled by the element's own size so
// a sticker and a full-width headline both move a sensible distance.
const TRAVEL_BASE = 40;
const TRAVEL_MAX = 260;

const BOXY_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'image', 'frame', 'embeddable']);
const LINEAR_TYPES = new Set(['freedraw', 'line', 'arrow']);

/** The effect that will actually be used for one element. */
export function effectForElement(el, effect) {
  const type = el?.type;

  if (effect === 'draw') {
    if (LINEAR_TYPES.has(type)) return 'draw';
    return BOXY_TYPES.has(type) ? 'wipe' : 'fade';
  }

  if (effect === 'wipe' || effect === 'zoom') {
    // Geometry effects re-wrap text and do not move linear points with the box.
    return BOXY_TYPES.has(type) ? effect : 'fade';
  }

  return SLIDE_BUILD_EFFECTS.includes(effect) ? effect : 'fade';
}

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

  const duration = Number(raw.duration);
  const delay = Number(raw.delay);

  return {
    id: String(raw.id || uid()),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    elementIds,

    effect: SLIDE_BUILD_EFFECTS.includes(raw.effect) ? raw.effect : 'fade',

    direction: SLIDE_BUILD_DIRECTIONS.includes(raw.direction)
      ? raw.direction
      : 'left',

    // The very first step has nothing to run with or after.
    trigger: SLIDE_BUILD_TRIGGERS.includes(raw.trigger) ? raw.trigger : 'click',

    duration: Number.isFinite(duration)
      ? Math.max(0, Math.min(5000, duration))
      : DEFAULT_BUILD_DURATION,

    delay: Number.isFinite(delay) ? Math.max(0, Math.min(5000, delay)) : 0,
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
    .map((build, index) => ({
      ...build,
      order: index,
      trigger: index === 0 ? 'click' : build.trigger,
    }));

  return {
    transition,
    builds,
  };
}

export function slideAnimation(slide) {
  return normalizeSlideAnimation(slide?.animation || {});
}

/**
 * Groups a slide's build steps into what one click plays.
 *
 * A group starts at every "on click" step and swallows the following
 * "with previous" / "after previous" steps, each with the start time those
 * triggers imply. This is the whole timeline model — everything else just
 * reads it.
 *
 * @returns {Array<{ steps: Array<{build, startAt, endAt}>, duration: number }>}
 */
export function slideBuildGroups(slide) {
  const { builds } = slideAnimation(slide);
  const groups = [];

  for (const build of builds) {
    const startsGroup = !groups.length || build.trigger === 'click';

    if (startsGroup) {
      groups.push({ steps: [], duration: 0 });
    }

    const group = groups[groups.length - 1];
    const previous = group.steps[group.steps.length - 1];

    let startAt = build.delay;

    if (previous) {
      startAt = build.trigger === 'with'
        ? previous.startAt + build.delay
        : previous.endAt + build.delay;
    }

    const endAt = startAt + build.duration;

    group.steps.push({ build, startAt, endAt });
    group.duration = Math.max(group.duration, endAt);
  }

  return groups;
}

/** Number of clicks a slide takes before it is done. */
export function slideBuildCount(slide) {
  return slideBuildGroups(slide).length;
}

/** Total presentation steps of a slide: the base view plus one per click. */
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

function travelFor(el, direction) {
  const size = direction === 'up' || direction === 'down'
    ? Math.abs(Number(el?.height) || 0)
    : Math.abs(Number(el?.width) || 0);

  return Math.min(TRAVEL_MAX, TRAVEL_BASE + size * 0.6);
}

/**
 * The presentation-only patch for one element at progress `k`.
 *
 * Returns null once the element has arrived, which is the signal to drop the
 * override and let the original values stand again — bit-for-bit, never a
 * recomputed approximation.
 */
function effectPatch(original, effect, direction, k) {
  if (k >= 1) return null;

  switch (effect) {
    case 'appear':
      return { opacity: 0, locked: true };

    case 'fly': {
      const travel = travelFor(original, direction) * (1 - k);

      const patch = {
        // Fly-ins fade in faster than they travel, as they do in Keynote.
        opacity: Math.max(1, Math.round(original.opacity * Math.min(1, k * 1.6))),
        locked: true,
      };

      if (direction === 'left') patch.x = original.x - travel;
      else if (direction === 'right') patch.x = original.x + travel;
      else if (direction === 'up') patch.y = original.y - travel;
      else patch.y = original.y + travel;

      return patch;
    }

    case 'wipe': {
      const patch = { opacity: original.opacity, locked: true };

      if (direction === 'up' || direction === 'down') {
        patch.height = Math.max(1, original.height * k);
        patch.y = direction === 'down'
          ? original.y + original.height - patch.height
          : original.y;
      } else {
        patch.width = Math.max(1, original.width * k);
        patch.x = direction === 'right'
          ? original.x + original.width - patch.width
          : original.x;
      }

      return patch;
    }

    case 'zoom': {
      // Scales around the element's own centre so it grows in place.
      const scale = 0.35 + 0.65 * k;

      const width = Math.max(1, original.width * scale);
      const height = Math.max(1, original.height * scale);

      return {
        opacity: Math.max(1, Math.round(original.opacity * Math.min(1, k * 1.6))),
        x: original.x + (original.width - width) / 2,
        y: original.y + (original.height - height) / 2,
        width,
        height,
        locked: true,
      };
    }

    case 'draw': {
      const points = original.points || [];

      if (points.length < 2) {
        return { opacity: Math.max(1, Math.round(original.opacity * k)), locked: true };
      }

      /*
        The tip advances *within* the current segment, not from point to
        point. Slicing whole points made a 20-point stroke jump in 20 visible
        chunks — the stop-motion look. Interpolating the last one gives a tip
        that moves continuously no matter how coarse the stroke is.
      */
      const segments = points.length - 1;
      const exact = segments * k;
      const whole = Math.min(segments, Math.floor(exact));
      const frac = exact - whole;

      const sliced = points.slice(0, whole + 1);

      if (frac > 0 && whole < segments) {
        const from = points[whole];
        const to = points[whole + 1];

        sliced.push([
          from[0] + (to[0] - from[0]) * frac,
          from[1] + (to[1] - from[1]) * frac,
        ]);
      }

      // Excalidraw needs at least two points to draw anything at all.
      if (sliced.length < 2) sliced.push([...points[0]]);

      const patch = {
        opacity: original.opacity,
        points: sliced,
        locked: true,
      };

      if (Array.isArray(original.pressures) && original.pressures.length) {
        patch.pressures = original.pressures.slice(0, sliced.length);
      }

      return patch;
    }

    case 'fade':
    default:
      return {
        opacity: Math.max(1, Math.round(original.opacity * k)),
        locked: true,
      };
  }
}

/**
 * Drives build steps for one running presentation.
 *
 * The animator owns no elements of its own. It keeps a set of *overrides* —
 * the presentation-only values each animated element should currently have —
 * plus the untouched original of everything it ever overrode, and applies the
 * difference to the live scene.
 *
 * Why overrides instead of patching straight through: Excalidraw commits
 * updateScene() through React, so two read-modify-write passes in the same
 * tick both start from the pre-update element array and the second silently
 * undoes the first. That is exactly what happens next to the slide-frame
 * visibility pass. Writes are therefore coalesced into one per animation
 * frame, which reads a scene that has settled.
 */
export function createSlideAnimator({ getApi }) {
  // elementId -> untouched geometry/appearance the presentation may change
  const originals = new Map();

  // elementId -> presentation-only patch currently in force
  const overrides = new Map();

  let applyRaf = 0;
  let animationRaf = 0;

  /*
    Hard guarantee that a presentation never leaves a mark on the drawing: any
    save that happens while elements are hidden or mid-flight writes their
    untouched values instead. `restore()` puts the board back on screen; this
    protects the document even if the tab is closed mid-presentation.
  */
  const unregisterSanitizer = registerScenePersistSanitizer((elements) => {
    if (!originals.size) return elements;

    return elements.map((el) => {
      const original = originals.get(el?.id);

      return original && differs(el, restoreTarget(original))
        ? { ...el, ...restoreTarget(original) }
        : el;
    });
  });

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
      id: el.id,
      type: el.type,
      opacity: el.opacity,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      locked: el.locked === true,
      points: el.points,
      pressures: el.pressures,
    };

    originals.set(el.id, snapshot);

    return snapshot;
  }

  /*
    points/pressures are compared by reference on purpose: restoring always
    puts the original array back, so identity is both correct and far cheaper
    than comparing thousands of freehand coordinates every frame.
  */
  function differs(el, target) {
    return (
      el.opacity !== target.opacity ||
      el.x !== target.x ||
      el.y !== target.y ||
      el.width !== target.width ||
      el.height !== target.height ||
      el.locked !== target.locked ||
      el.points !== target.points ||
      el.pressures !== target.pressures
    );
  }

  function restoreTarget(original) {
    return {
      opacity: original.opacity,
      x: original.x,
      y: original.y,
      width: original.width,
      height: original.height,
      locked: original.locked,
      points: original.points,
      pressures: original.pressures,
    };
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
        const target = { ...restoreTarget(original), ...override };

        if (differs(el, target)) patches.set(el.id, target);

        continue;
      }

      const original = originals.get(el.id);

      if (original) {
        const target = restoreTarget(original);

        if (differs(el, target)) patches.set(el.id, target);
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

  function collectHiddenIds(groups, fromIndex, into) {
    for (let i = fromIndex; i < groups.length; i++) {
      for (const { build } of groups[i].steps) {
        for (const id of build.elementIds) into.add(id);
      }
    }
  }

  /**
   * Sets the visibility of the whole deck for one position in it.
   *
   * Deck-wide on purpose. Hiding only the current slide's build steps meant
   * everything a *later* slide animates was already on the board — visible
   * while presenting an earlier slide, and then popping out of existence the
   * moment its own slide came up. A build element must stay hidden from the
   * first frame of the presentation until its own step plays.
   *
   * @param {Array}  slides  the running deck, in order
   * @param {number} index   slide being presented
   * @param {number} step    build steps of that slide already revealed
   */
  function applyDeckState(slides, index, step = 0) {
    cancelAnimation();

    overrides.clear();

    const deck = Array.isArray(slides) ? slides : [];
    const hidden = new Set();

    deck.forEach((slide, i) => {
      const groups = slideBuildGroups(slide);

      // Past slides keep everything they revealed; the current one hides from
      // its next step on; later ones are hidden completely.
      const from = i < index ? groups.length : (i === index ? step : 0);

      collectHiddenIds(groups, from, hidden);
    });

    for (const id of hidden) {
      // opacity 0 + locked is the marker a scene re-hydration keeps hidden
      // (see applyPersistedDrawingToApi), so a sync mid-presentation cannot
      // flash the rest of the deck.
      overrides.set(id, { opacity: 0, locked: true });
    }

    scheduleApply();
  }

  /** Single-slide shorthand, used by the authoring preview. */
  function showStep(slide, step = 0) {
    applyDeckState([slide], 0, step);
  }

  /** Plays one click's worth of animation: the whole group, on its timeline. */
  function revealStep(slide, groupIndex) {
    cancelAnimation();

    const group = slideBuildGroups(slide)[groupIndex];
    if (!group) return;

    const { elements } = readElements();
    const byId = new Map(elements.map((el) => [el.id, el]));

    // Resolve every element once: which effect it really gets, and its
    // untouched values to animate towards.
    const timeline = [];

    for (const { build, startAt } of group.steps) {
      for (const id of build.elementIds) {
        const el = byId.get(id);
        if (!el || el.isDeleted) continue;

        timeline.push({
          id,
          startAt,
          duration: build.duration,
          direction: build.direction,
          effect: effectForElement(el, build.effect),
          original: remember(el),
        });
      }
    }

    const finish = () => {
      animationRaf = 0;

      for (const entry of timeline) overrides.delete(entry.id);

      scheduleApply();
    };

    if (!timeline.length || prefersReducedMotion() || !group.duration) {
      finish();
      return;
    }

    const start = performance.now();

    const tick = () => {
      const elapsed = performance.now() - start;

      if (elapsed >= group.duration) {
        finish();
        return;
      }

      for (const entry of timeline) {
        const local = entry.duration > 0
          ? (elapsed - entry.startAt) / entry.duration
          : (elapsed >= entry.startAt ? 1 : 0);

        /*
          Before its slot a step stays hidden; after it, it is simply done.
          A pen moves at a steady speed, so `draw` runs linear — easing makes
          the tip visibly stall near the end of the stroke.
        */
        const clamped = Math.min(1, local);
        const k = local <= 0
          ? 0
          : (entry.effect === 'draw' ? clamped : easeOutCubic(clamped));

        const patch = effectPatch(entry.original, entry.effect, entry.direction, local >= 1 ? 1 : k);

        if (patch) {
          overrides.set(entry.id, local <= 0 ? { opacity: 0, locked: true } : patch);
        } else {
          overrides.delete(entry.id);
        }
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
    applyDeckState,
    showStep,
    revealStep,
    restore,

    /** Restores the board and stops protecting saves. Call when done for good. */
    dispose() {
      restore();
      unregisterSanitizer();
    },
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
