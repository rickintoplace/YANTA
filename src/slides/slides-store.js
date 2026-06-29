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
  
  function cloneJson(value) {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value ?? null));
    }
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
  
    const nextElements = [
      ...(d.elements || []),
      frame,
    ];
  
    setDrawing(noteId, drawingId, {
      ...d,
      elements: nextElements,
      slides: normalizeSlides([
        ...slides,
        slide,
      ]),
    }, 'slides-create');
  
    if (api) {
      try {
        api.updateScene({
          elements: nextElements,
        });
  
        api.refresh?.();
      } catch {}
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
  
    let nextElements = d.elements || [];
  
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
      slides: normalizeSlides(nextSlides),
    }, 'slides-delete');
  
    if (api) {
      try {
        api.updateScene({
          elements: nextElements,
        });
  
        api.refresh?.();
      } catch {}
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
  
    const slides = listSlides(noteId, drawingId);
    if (!slides.length) return slides;
  
    const sceneElements =
      api?.getSceneElementsIncludingDeleted?.() ||
      api?.getSceneElements?.() ||
      d.elements ||
      [];
  
    const bySlideId = new Map();
  
    for (const el of sceneElements) {
      if (!el || el.isDeleted) continue;
      if (!isSlideFrameElement(el)) continue;
  
      const sid = slideIdFromElement(el);
      if (!sid) continue;
  
      bySlideId.set(sid, el);
    }
  
    let changed = false;
  
    const nextSlides = slides.map((slide) => {
      const frame = bySlideId.get(slide.id);
  
      if (!frame) return slide;
  
      const bounds = elementBounds(frame);
  
      const same =
        bounds.x === slide.bounds.x &&
        bounds.y === slide.bounds.y &&
        bounds.width === slide.bounds.width &&
        bounds.height === slide.bounds.height &&
        frame.id === slide.frameElementId;
  
      if (same) return slide;
  
      changed = true;
  
      return {
        ...slide,
        frameElementId: frame.id,
        bounds,
        aspectRatio: bounds.width / bounds.height,
        updated: now(),
      };
    });
  
    if (changed) {
      saveSlides(noteId, drawingId, nextSlides, 'slides-sync-from-scene');
    }
  
    return normalizeSlides(nextSlides);
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