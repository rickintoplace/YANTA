// ============================================================
// YANTA Slides — Model
//
// A Drawing is an infinite board.
// Slides are named rectangular camera targets on that board.
// ============================================================

import {
    uid,
  } from '../core.js';
  
  export const SLIDE_DEFAULT_ASPECT = 16 / 9;
  
  export function now() {
    return Date.now();
  }
  
  export function normalizeSlideBounds(bounds = {}) {
    const x = Number(bounds.x || 0);
    const y = Number(bounds.y || 0);
    const width = Math.max(40, Number(bounds.width || 320));
    const height = Math.max(40, Number(bounds.height || 180));
  
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
  }
  
  export function normalizeSlide(raw = {}, index = 0) {
    const id = String(raw.id || uid());
    const bounds = normalizeSlideBounds(raw.bounds || raw);
  
    return {
      id,
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
      title: String(raw.title || `Slide ${index + 1}`),
      frameElementId: raw.frameElementId || null,
      bounds,
      aspectRatio: Number(raw.aspectRatio || bounds.width / bounds.height || SLIDE_DEFAULT_ASPECT),
      background: raw.background || '',
      notes: {
        markdown: String(raw.notes?.markdown || raw.presenterNotes || ''),
        visibility: raw.notes?.visibility || 'presenter-only',
      },
      hidden: raw.hidden === true,
      created: Number(raw.created || now()),
      updated: Number(raw.updated || now()),
    };
  }
  
  export function normalizeSlides(slides = []) {
    return (Array.isArray(slides) ? slides : [])
      .map(normalizeSlide)
      .sort((a, b) =>
        Number(a.order || 0) - Number(b.order || 0) ||
        Number(a.created || 0) - Number(b.created || 0) ||
        String(a.id).localeCompare(String(b.id))
      )
      .map((slide, index) => ({
        ...slide,
        order: index,
        title: slide.title || `Slide ${index + 1}`,
      }));
  }
  
  export function slideElementId(slideId) {
    return `slide_frame_${slideId}`;
  }
  
  export function elementBounds(el = {}) {
    const x = Number(el.x || 0);
    const y = Number(el.y || 0);
    const w = Number(el.width || 0);
    const h = Number(el.height || 0);
  
    return normalizeSlideBounds({
      x: Math.min(x, x + w),
      y: Math.min(y, y + h),
      width: Math.abs(w),
      height: Math.abs(h),
    });
  }
  
  export function makeSlideFrameElement(slide, {
    color = '#6ea8fe',
  } = {}) {
    const bounds = normalizeSlideBounds(slide.bounds);
    const id = slide.frameElementId || slideElementId(slide.id);
  
    return {
      id,
      type: 'rectangle',
  
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      angle: 0,
  
      strokeColor: color,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
  
      groupIds: [],
      frameId: null,
      roundness: {
        type: 3,
      },
  
      seed: Math.floor(Math.random() * 2 ** 31),
      version: 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      isDeleted: false,
      boundElements: null,
      updated: now(),
      link: null,
      locked: false,
  
      customData: {
        yanta: {
          slideId: slide.id,
          slideFrame: true,
        },
      },
    };
  }
    
  export function isSlideFrameElement(el) {
    const yanta = el?.customData?.yanta || {};

    /*
      YANTA slide frames are camera-target rectangles on the infinite board.
      Important: normal content elements must not become invisible in export/
      presentation just because they carry a slideId-like metadata field.
    */
    return (
      yanta.slideFrame === true ||
      yanta.kind === 'slide-frame' ||

      // Backward compatibility for older slide-frame elements.
      (
        !!yanta.slideId &&
        el?.type === 'rectangle' &&
        String(el?.id || '').startsWith('slide_frame_')
      )
    );
  }
  
  export function slideIdFromElement(el) {
    return el?.customData?.yanta?.slideId || '';
  }
  
  export function makeVirtualElementForSlide(slide) {
    const bounds = normalizeSlideBounds(slide.bounds);
  
    return {
      id: `virtual_${slide.id}`,
      type: 'rectangle',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      angle: 0,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 0,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: now(),
      link: null,
      locked: true,
    };
  }
  
  export function rectsIntersect(a, b) {
    const ax1 = a.x;
    const ay1 = a.y;
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
  
    const bx1 = b.x;
    const by1 = b.y;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;
  
    return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
  }
  
  export function visibleElementsInSlide(elements = [], slide) {
    const bounds = normalizeSlideBounds(slide.bounds);
  
    return (Array.isArray(elements) ? elements : [])
      .filter((el) => el && !el.isDeleted)
      .filter((el) => {
        if (isSlideFrameElement(el)) return false;
  
        const b = elementBounds(el);
  
        return rectsIntersect(bounds, b);
      });
  }