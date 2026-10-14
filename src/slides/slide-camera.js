// ============================================================
// YANTA Slides — camera
//
// Where the board has to be scrolled and zoomed so a slide fills the
// screen, and the glide between two slides. Shared by the slideshow in the
// app (slides-ui.js) and the stage on a connected screen
// (present/present-stage.js), so a slide lands on exactly the same framing
// on every device.
// ============================================================

import { runDrawingApiUpdateWithoutSaving } from '../draw-scene-sync.js';
import { normalizeSlideBounds } from './slides-model.js';

let cameraAnimationRaf = 0;

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);

  return x < 0.5
    ? 4 * x * x * x
    : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function drawingViewportRect(container = null) {
  const rect =
    container?.querySelector?.('.excalidraw')?.getBoundingClientRect?.() ||
    container?.getBoundingClientRect?.() ||
    null;

  if (rect && rect.width > 0 && rect.height > 0) {
    return rect;
  }

  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function zoomValue(appState = {}) {
  return finiteNumber(appState.zoom?.value ?? appState.zoom, 1) || 1;
}

export function screenToScene({
  api,
  container,
  clientX,
  clientY,
}) {
  if (!Number.isFinite(Number(clientX)) || !Number.isFinite(Number(clientY))) {
    return {
      x: 0,
      y: 0,
      invalid: true,
    };
  }

  try {
    if (api?.screenToSceneCoords) {
      const p = api.screenToSceneCoords({ clientX, clientY });

      if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
        return { x: Number(p.x), y: Number(p.y) };
      }

      const p2 = api.screenToSceneCoords({ x: clientX, y: clientY });

      if (p2 && Number.isFinite(Number(p2.x)) && Number.isFinite(Number(p2.y))) {
        return { x: Number(p2.x), y: Number(p2.y) };
      }
    }
  } catch {}

  const rect = drawingViewportRect(container);
  const appState = api?.getAppState?.() || {};
  const zoom = zoomValue(appState);
  const scrollX = finiteNumber(appState.scrollX, 0);
  const scrollY = finiteNumber(appState.scrollY, 0);

  return {
    x: (clientX - rect.left) / zoom - scrollX,
    y: (clientY - rect.top) / zoom - scrollY,
  };
}

export function sceneToScreen({
  api,
  container,
  sceneX,
  sceneY,
}) {
  const rect = drawingViewportRect(container);
  const appState = api?.getAppState?.() || {};
  const zoom = zoomValue(appState);
  const scrollX = finiteNumber(appState.scrollX, 0);
  const scrollY = finiteNumber(appState.scrollY, 0);

  return {
    x: rect.left + (sceneX + scrollX) * zoom,
    y: rect.top + (sceneY + scrollY) * zoom,
  };
}

/** A point given relative to a slide (0..1 on both axes) → screen pixels. */
export function slidePointToScreen({ api, container, slide, x, y }) {
  if (!api || !slide) return null;

  const bounds = normalizeSlideBounds(slide.bounds);

  return sceneToScreen({
    api,
    container,
    sceneX: bounds.x + clamp(Number(x || 0), 0, 1) * bounds.width,
    sceneY: bounds.y + clamp(Number(y || 0), 0, 1) * bounds.height,
  });
}

/** Screen pixels → a point relative to the slide (0..1), the unit remotes speak. */
export function screenToSlidePoint({ api, container, slide, clientX, clientY }) {
  if (!api || !slide) return null;

  const scene = screenToScene({ api, container, clientX, clientY });
  const bounds = normalizeSlideBounds(slide.bounds);

  return {
    x: clamp((scene.x - bounds.x) / Math.max(1, bounds.width), 0, 1),
    y: clamp((scene.y - bounds.y) / Math.max(1, bounds.height), 0, 1),
  };
}

export function slideCameraTarget(api, container, slide, {
  viewportZoomFactor = 0.84,
} = {}) {
  const rect = drawingViewportRect(container);
  const bounds = normalizeSlideBounds(slide.bounds);

  const safeWidth = Math.max(1, bounds.width);
  const safeHeight = Math.max(1, bounds.height);

  const zoom = clamp(
    Math.min(
      (rect.width * viewportZoomFactor) / safeWidth,
      (rect.height * viewportZoomFactor) / safeHeight
    ),
    0.04,
    4
  );

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    scrollX: rect.width / (2 * zoom) - centerX,
    scrollY: rect.height / (2 * zoom) - centerY,
    zoom,
  };
}

export function updateCamera(api, camera) {
  if (!api || !camera) return;

  runDrawingApiUpdateWithoutSaving(api, {
    appState: {
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: {
        value: camera.zoom,
      },
    },
  }, {
    releaseMs: 260,
  });
}

export function cancelCameraAnimation() {
  cancelAnimationFrame(cameraAnimationRaf);
  cameraAnimationRaf = 0;
}

export function animateCameraToSlide(api, container, slide, {
  duration = 520,
  viewportZoomFactor,
} = {}) {
  if (!api || !slide) return;

  duration = Number.isFinite(duration) ? duration : 520;

  cancelCameraAnimation();

  const appState = api.getAppState?.() || {};

  const from = {
    scrollX: finiteNumber(appState.scrollX, 0),
    scrollY: finiteNumber(appState.scrollY, 0),
    zoom: zoomValue(appState),
  };

  const to = slideCameraTarget(api, container, slide, viewportZoomFactor ? { viewportZoomFactor } : {});

  if (prefersReducedMotion() || duration <= 0) {
    updateCamera(api, to);
    return;
  }

  const start = performance.now();

  const tick = () => {
    const t = clamp((performance.now() - start) / duration, 0, 1);
    const k = easeInOutCubic(t);

    updateCamera(api, {
      scrollX: from.scrollX + (to.scrollX - from.scrollX) * k,
      scrollY: from.scrollY + (to.scrollY - from.scrollY) * k,
      zoom: from.zoom + (to.zoom - from.zoom) * k,
    });

    if (t < 1) {
      cameraAnimationRaf = requestAnimationFrame(tick);
    } else {
      cameraAnimationRaf = 0;
      updateCamera(api, to);
    }
  };

  cameraAnimationRaf = requestAnimationFrame(tick);
}

export function scrollToSlide(api, slide, container = null, { animate = true, viewportZoomFactor } = {}) {
  if (!api || !slide) return;

  animateCameraToSlide(api, container, slide, {
    duration: animate ? undefined : 0,
    viewportZoomFactor,
  });
}
