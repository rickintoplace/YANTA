// ============================================================
// YANTA Slides — Store
// Drawing-local persistence via existing Yjs drawing object.
// ============================================================

import {
  state,
} from '../core.js';

import {
  getDrawing,
  setDrawing,
  updateDrawingMeta,
  findDrawing,
} from '../yjs.js';

import {
  normalizeSlides,
  normalizeSlide,
  makeSlideFrameElement,
  isSlideFrameElement,
  slideIdFromElement,
  elementBounds,
  now,
} from './slides-model.js';

import {
  runDrawingApiUpdateWithoutSaving,
} from '../draw.js';

function cloneJson(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

function sceneElementsForApiOrDrawing(d, api = null) {
  try {
    const elements =
      api?.getSceneElementsIncludingDeleted?.() ||
      api?.getSceneElements?.();

    if (Array.isArray(elements)) {
      return cloneJson(elements);
    }
  } catch {}

  return cloneJson(d?.elements || []);
}

function sceneAppStateForApiOrDrawing(d, api = null) {
  try {
    const appState = api?.getAppState?.();

    if (appState && typeof appState === 'object') {
      return cloneJson(appState);
    }
  } catch {}

  return cloneJson(d?.appState || {});
}

function sceneFilesForApiOrDrawing(d, api = null) {
  try {
    const files = api?.getFiles?.();

    if (files && typeof files === 'object') {
      return cloneJson(files);
    }
  } catch {}

  return cloneJson(d?.files || {});
}

function readSceneElementsFromApi(api = null) {
  if (!api) {
    return {
      ok: false,
      elements: [],
    };
  }

  try {
    const elements =
      api.getSceneElementsIncludingDeleted?.() ||
      api.getSceneElements?.();

    if (Array.isArray(elements)) {
      return {
        ok: true,
        elements: cloneJson(elements),
      };
    }
  } catch {}

  return {
    ok: false,
    elements: [],
  };
}

function hasLiveSlideFrame(elements = []) {
  return (Array.isArray(elements) ? elements : []).some((el) =>
    el &&
    !el.isDeleted &&
    isSlideFrameElement(el) &&
    slideIdFromElement(el)
  );
}

/**
 * Excalidraw API can be momentarily empty/incomplete during mount.
 *
 * Critical:
 * We must not delete slide metadata just because api.getSceneElements()
 * returned an unhydrated initial scene. Prefer persisted drawing elements
 * if they clearly contain slide frames and the API does not.
 */
function sceneElementsForSlideSync(d, api = null) {
  const persisted = cloneJson(d?.elements || []);
  const apiRead = readSceneElementsFromApi(api);

  const persistedHasFrames = hasLiveSlideFrame(persisted);
  const apiHasFrames = hasLiveSlideFrame(apiRead.elements);

  if (!apiRead.ok) {
    return {
      elements: persisted,
      canDeleteMissingFrames: false,
      source: 'persisted-no-api',
    };
  }

  if (apiRead.elements.length === 0 && persisted.length > 0) {
    return {
      elements: persisted,
      canDeleteMissingFrames: false,
      source: 'persisted-api-empty',
    };
  }

  if (persistedHasFrames && !apiHasFrames) {
    return {
      elements: persisted,
      canDeleteMissingFrames: false,
      source: 'persisted-api-no-frames',
    };
  }

  return {
    elements: apiRead.elements,
    canDeleteMissingFrames: true,
    source: 'api',
  };
}

function slidesFromSceneFrames(elements = []) {
  const frames = (Array.isArray(elements) ? elements : [])
    .filter((el) =>
      el &&
      !el.isDeleted &&
      isSlideFrameElement(el) &&
      slideIdFromElement(el)
    );

  if (!frames.length) return [];

  return normalizeSlides(frames.map((frame, index) => {
    const slideId = slideIdFromElement(frame);
    const bounds = elementBounds(frame);

    return normalizeSlide({
      id: slideId,
      order: index,
      title: `Slide ${index + 1}`,
      frameElementId: frame.id,
      bounds,
      aspectRatio: bounds.width / bounds.height,
      created: Number(frame.updated || now()),
      updated: Number(frame.updated || now()),
    }, index);
  }));
}

export function drawingRef(noteId, drawingId) {
  const hit = findDrawing(drawingId, noteId || state.currentNoteId);

  if (hit) {
    return hit;
  }

  return null;
}

export function listSlides(noteId, drawingId) {
  const d = getDrawing(noteId, drawingId);

  if (!d) return [];

  return normalizeSlides(d.slides || []);
}

export function getSlide(noteId, drawingId, slideId) {
  return listSlides(noteId, drawingId).find((s) => s.id === slideId) || null;
}

export function saveSlides(noteId, drawingId, slides, origin = 'slides') {
  const normalized = normalizeSlides(slides);

  updateDrawingMeta(noteId, drawingId, {
    slides: normalized,
  }, origin);

  window.dispatchEvent(new CustomEvent('yanta-slides-updated', {
    detail: {
      noteId,
      drawingId,
      slides: normalized,
      origin,
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: {
      noteId,
      drawingId,
      reason: 'slides-updated',
    },
  }));

  return normalized;
}

export function createSlide(noteId, drawingId, {
  bounds,
  title = '',
  api = null,
  color = '#6ea8fe',
} = {}) {
  const d = getDrawing(noteId, drawingId);
  if (!d) return null;

  const slides = normalizeSlides(d.slides || []);

  const slide = normalizeSlide({
    title: title || `Slide ${slides.length + 1}`,
    order: slides.length,
    bounds,
    created: now(),
    updated: now(),
  }, slides.length);

  const frame = makeSlideFrameElement(slide, {
    color,
  });

  slide.frameElementId = frame.id;

  const currentElements = sceneElementsForApiOrDrawing(d, api);
  const currentAppState = sceneAppStateForApiOrDrawing(d, api);
  const currentFiles = sceneFilesForApiOrDrawing(d, api);

  const nextElements = [
    ...currentElements,
    frame,
  ];

  setDrawing(noteId, drawingId, {
    ...d,
    elements: nextElements,
    appState: currentAppState,
    files: currentFiles,
    slides: normalizeSlides([
      ...slides,
      slide,
    ]),
  }, 'slides-create');

  if (api) {
    runDrawingApiUpdateWithoutSaving(api, {
      elements: nextElements,
    });
  }

  window.dispatchEvent(new CustomEvent('yanta-slides-updated', {
    detail: {
      noteId,
      drawingId,
      slideId: slide.id,
      origin: 'slides-create',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: {
      noteId,
      drawingId,
      reason: 'slide-created',
    },
  }));

  return slide;
}

export function updateSlide(noteId, drawingId, slideId, patch = {}) {
  const slides = listSlides(noteId, drawingId);

  const next = slides.map((slide) =>
    slide.id === slideId
      ? normalizeSlide({
          ...slide,
          ...patch,
          bounds: patch.bounds || slide.bounds,
          notes: patch.notes || slide.notes,
          updated: now(),
        }, slide.order)
      : slide
  );

  return saveSlides(noteId, drawingId, next, 'slides-update');
}

export function deleteSlide(noteId, drawingId, slideId, {
  deleteFrame = false,
  api = null,
} = {}) {
  const d = getDrawing(noteId, drawingId);
  if (!d) return [];

  const slides = listSlides(noteId, drawingId);
  const slide = slides.find((s) => s.id === slideId);

  const nextSlides = slides.filter((s) => s.id !== slideId);

  let nextElements = sceneElementsForApiOrDrawing(d, api);
  const currentAppState = sceneAppStateForApiOrDrawing(d, api);
  const currentFiles = sceneFilesForApiOrDrawing(d, api);

  if (deleteFrame && slide?.frameElementId) {
    nextElements = nextElements.map((el) =>
      el.id === slide.frameElementId
        ? {
            ...el,
            isDeleted: true,
            updated: now(),
            version: (el.version || 1) + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
          }
        : el
    );
  }

  setDrawing(noteId, drawingId, {
    ...d,
    elements: nextElements,
    appState: currentAppState,
    files: currentFiles,
    slides: normalizeSlides(nextSlides),
  }, 'slides-delete');

  if (api) {
    runDrawingApiUpdateWithoutSaving(api, {
      elements: nextElements,
    });
  }

  window.dispatchEvent(new CustomEvent('yanta-slides-updated', {
    detail: {
      noteId,
      drawingId,
      slideId,
      origin: 'slides-delete',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: {
      noteId,
      drawingId,
      reason: 'slide-deleted',
    },
  }));

  return normalizeSlides(nextSlides);
}

export function reorderSlides(noteId, drawingId, slideIds = []) {
  const order = new Map(slideIds.map((id, i) => [String(id), i]));
  const slides = listSlides(noteId, drawingId);

  const next = slides
    .map((s) => ({
      ...s,
      order: order.has(s.id) ? order.get(s.id) : s.order,
      updated: now(),
    }))
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({
      ...s,
      order: i,
    }));

  return saveSlides(noteId, drawingId, next, 'slides-reorder');
}

export function setSlideNotes(noteId, drawingId, slideId, markdown) {
  return updateSlide(noteId, drawingId, slideId, {
    notes: {
      markdown: String(markdown || ''),
      visibility: 'presenter-only',
    },
  });
}

export function syncSlidesFromScene(noteId, drawingId, api = null) {
  const d = getDrawing(noteId, drawingId);
  if (!d) return [];

  const scene = sceneElementsForSlideSync(d, api);

  let slides = listSlides(noteId, drawingId);

  /*
    Recovery path:
    A previous build may have deleted d.slides because Excalidraw API returned
    an empty scene during mount. If physical slide frames still exist, rebuild
    slide metadata from those frames.
  */
  if (!slides.length) {
    const recovered = slidesFromSceneFrames(scene.elements);

    if (recovered.length) {
      saveSlides(
        noteId,
        drawingId,
        recovered,
        'slides-recover-from-scene-frames'
      );

      return recovered;
    }

    return [];
  }

  const bySlideId = new Map();

  for (const el of scene.elements) {
    if (!el || el.isDeleted) continue;
    if (!isSlideFrameElement(el)) continue;

    const sid = slideIdFromElement(el);
    if (!sid) continue;

    bySlideId.set(sid, el);
  }

  let changed = false;
  const nextSlides = [];

  for (const slide of slides) {
    const frame = bySlideId.get(slide.id);

    /*
      UX rule:
      A slide with a physical frame belongs to that frame.
      If the user deletes the frame from a trusted, hydrated API scene,
      the slide is removed too.

      Important:
      During Excalidraw mount the API can be empty/incomplete. In that case
      missing frames are NOT deletion evidence.
    */
    if (!frame && slide.frameElementId) {
      if (scene.canDeleteMissingFrames) {
        changed = true;
        continue;
      }

      nextSlides.push(slide);
      continue;
    }

    if (!frame) {
      nextSlides.push(slide);
      continue;
    }

    const bounds = elementBounds(frame);

    const same =
      bounds.x === slide.bounds.x &&
      bounds.y === slide.bounds.y &&
      bounds.width === slide.bounds.width &&
      bounds.height === slide.bounds.height &&
      frame.id === slide.frameElementId;

    if (same) {
      nextSlides.push(slide);
      continue;
    }

    changed = true;

    nextSlides.push({
      ...slide,
      frameElementId: frame.id,
      bounds,
      aspectRatio: bounds.width / bounds.height,
      updated: now(),
    });
  }

  const normalized = normalizeSlides(nextSlides);

  if (changed) {
    saveSlides(noteId, drawingId, normalized, 'slides-sync-from-scene');
  }

  return normalized;
}

export function publicSafeSlides(slides = []) {
  return normalizeSlides(slides).map((slide) => {
    const copy = cloneJson(slide);

    // Speaker notes are private by default.
    delete copy.notes;
    delete copy.presenterNotes;

    return copy;
  });
}