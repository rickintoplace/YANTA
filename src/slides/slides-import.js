// ============================================================
// YANTA Slides — Excalidraw Slideshow Import
//
// Converts complete Excalidraw JSON into a native YANTA drawing with
// YANTA slide-frame rectangles + drawing.slides metadata.
//
// YANTA slide frame:
//   rectangle element with customData.yanta.slideFrame=true
//   and customData.yanta.slideId=<slide-id>
//
// These are camera targets on the infinite board.
// ============================================================

import {
  uid,
} from '../core.js';

import {
  normalizeDrawingScene,
} from '../yjs.js';

import {
  normalizeSlide,
  normalizeSlides,
  normalizeSlideBounds,
  makeSlideFrameElement,
  isSlideFrameElement,
  slideIdFromElement,
  elementBounds,
  rectsIntersect,
} from './slides-model.js';

const DEFAULT_SLIDE_WIDTH = 1280;
const DEFAULT_SLIDE_HEIGHT = 720;
const DEFAULT_SLIDE_GAP = 180;

function cloneJson(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

export function parseExcalidrawJsonInput(input) {
  if (typeof input === 'string') {
    return JSON.parse(input);
  }

  if (input && typeof input === 'object') {
    return cloneJson(input);
  }

  throw new Error('Excalidraw JSON must be an object or JSON string.');
}

function randomInt() {
  return Math.floor(Math.random() * 2 ** 31);
}

function stableElementId(prefix = 'el') {
  return `${prefix}_${uid()}`;
}

function normalizeElement(el, index = 0) {
  const updated = Number(el.updated || Date.now());

  return {
    ...el,

    id: String(el.id || stableElementId(`el_${index}`)),
    type: String(el.type || 'rectangle'),

    x: Number(el.x || 0),
    y: Number(el.y || 0),
    width: Number(el.width || 0),
    height: Number(el.height || 0),
    angle: Number(el.angle || 0),

    strokeColor: el.strokeColor || '#1e1e1e',
    backgroundColor: el.backgroundColor ?? 'transparent',
    fillStyle: el.fillStyle || 'solid',
    strokeWidth: Number(el.strokeWidth || 1),
    strokeStyle: el.strokeStyle || 'solid',
    roughness: Number(el.roughness ?? 0),
    opacity: Number(el.opacity ?? 100),

    groupIds: Array.isArray(el.groupIds) ? el.groupIds : [],
    frameId: el.frameId || null,
    roundness: el.roundness ?? null,

    seed: Number(el.seed || randomInt()),
    version: Number(el.version || 1),
    versionNonce: Number(el.versionNonce || randomInt()),
    isDeleted: el.isDeleted === true,
    boundElements: el.boundElements ?? null,
    updated,
    link: el.link || null,
    locked: el.locked === true,
    customData: el.customData || {},
  };
}

function rawSlidesFromJson(raw = {}) {
  if (Array.isArray(raw.yanta?.slides)) return raw.yanta.slides;
  if (Array.isArray(raw.slides)) return raw.slides;
  return [];
}

function rawSlideDecksFromJson(raw = {}, existingDrawing = null) {
  if (Array.isArray(raw.yanta?.slideDecks)) return raw.yanta.slideDecks;
  if (Array.isArray(raw.slideDecks)) return raw.slideDecks;
  return existingDrawing?.slideDecks || [];
}

function existingSlideById(existingDrawing = null) {
  return new Map(
    normalizeSlides(existingDrawing?.slides || []).map((slide) => [slide.id, slide])
  );
}

function rawSlideById(rawSlides = []) {
  return new Map(
    normalizeSlides(rawSlides).map((slide) => [slide.id, slide])
  );
}

function ensureSlideFrameCustomData(frame, slideId) {
  return {
    ...frame,
    customData: {
      ...(frame.customData || {}),
      yanta: {
        ...(frame.customData?.yanta || {}),
        slideId,
        slideFrame: true,
      },
    },
  };
}

function frameSlideId(frame, index) {
  return (
    slideIdFromElement(frame) ||
    frame.customData?.yanta?.slideId ||
    `slide_${String(index + 1).padStart(2, '0')}`
  );
}

function slideTitleFromFrame(frame, index, rawSlide = null, existingSlide = null) {
  return (
    rawSlide?.title ||
    existingSlide?.title ||
    frame.customData?.yanta?.title ||
    frame.customData?.yanta?.slideTitle ||
    `Slide ${index + 1}`
  );
}

function mergeSlideNotes(rawSlide = null, existingSlide = null) {
  if (rawSlide?.notes?.markdown != null) {
    return {
      markdown: String(rawSlide.notes.markdown || ''),
      visibility: rawSlide.notes.visibility || 'presenter-only',
    };
  }

  if (rawSlide?.presenterNotes != null) {
    return {
      markdown: String(rawSlide.presenterNotes || ''),
      visibility: 'presenter-only',
    };
  }

  if (existingSlide?.notes) {
    return cloneJson(existingSlide.notes);
  }

  return {
    markdown: '',
    visibility: 'presenter-only',
  };
}

export function extractYantaSlideFrames(elements = [], {
  rawSlides = [],
  existingDrawing = null,
} = {}) {
  const rawById = rawSlideById(rawSlides);
  const existingById = existingSlideById(existingDrawing);

  return elements
    .filter((el) => el && !el.isDeleted && isSlideFrameElement(el))
    .sort((a, b) =>
      Number(a.y || 0) - Number(b.y || 0) ||
      Number(a.x || 0) - Number(b.x || 0)
    )
    .map((frame, index) => {
      const slideId = frameSlideId(frame, index);
      const rawSlide = rawById.get(slideId) || null;
      const existingSlide = existingById.get(slideId) || null;
      const bounds = normalizeSlideBounds(elementBounds(frame));

      const slide = normalizeSlide({
        ...(existingSlide || {}),
        ...(rawSlide || {}),

        id: slideId,
        title: slideTitleFromFrame(frame, index, rawSlide, existingSlide),
        order: Number.isFinite(Number(rawSlide?.order))
          ? Number(rawSlide.order)
          : index,
        frameElementId: frame.id,
        bounds,
        aspectRatio: bounds.width / bounds.height,
        notes: mergeSlideNotes(rawSlide, existingSlide),
      }, index);

      return {
        frame: ensureSlideFrameCustomData(frame, slideId),
        slide,
      };
    });
}

function synthesizeFramesForSlides(elements, slides) {
  const existingSlideIds = new Set(
    elements
      .filter((el) => el && !el.isDeleted && isSlideFrameElement(el))
      .map(slideIdFromElement)
      .filter(Boolean)
  );

  const next = [...elements];

  for (const slide of normalizeSlides(slides)) {
    if (existingSlideIds.has(slide.id)) continue;

    next.push(makeSlideFrameElement(slide));
  }

  return next;
}

function autoSlidesFromContent(elements = []) {
  const content = elements.filter((el) =>
    el &&
    !el.isDeleted &&
    !isSlideFrameElement(el)
  );

  if (!content.length) return [];

  const boxes = content.map(elementBounds);

  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));

  const width = Math.max(DEFAULT_SLIDE_WIDTH, x2 - x1 + 160);
  const height = Math.max(DEFAULT_SLIDE_HEIGHT, y2 - y1 + 120);

  return normalizeSlides([
    {
      id: 'slide_01',
      title: 'Slide 1',
      order: 0,
      bounds: {
        x: Math.round(x1 - 80),
        y: Math.round(y1 - 60),
        width,
        height,
      },
    },
  ]);
}

function slideContainsAnyContent(slide, elements) {
  const bounds = normalizeSlideBounds(slide.bounds);

  return elements.some((el) => {
    if (!el || el.isDeleted || isSlideFrameElement(el)) return false;

    return rectsIntersect(bounds, elementBounds(el));
  });
}

function validateSlideCoverage(slides, elements) {
  const warnings = [];

  for (const slide of slides) {
    if (!slideContainsAnyContent(slide, elements)) {
      warnings.push(`Slide "${slide.title}" contains no visible content.`);
    }
  }

  return warnings;
}

export function validateExcalidrawSlideshowJson(input) {
  const raw = parseExcalidrawJsonInput(input);
  const elements = Array.isArray(raw.elements) ? raw.elements : [];

  const errors = [];
  const warnings = [];

  if (!elements.length) {
    errors.push('No Excalidraw elements found.');
  }

  const ids = new Set();

  elements.forEach((el, index) => {
    if (!el || typeof el !== 'object') {
      errors.push(`Invalid element at index ${index}.`);
      return;
    }

    if (!el.id) {
      warnings.push(`Element at index ${index} has no id. YANTA will assign one.`);
    } else if (ids.has(el.id)) {
      errors.push(`Duplicate element id: ${el.id}`);
    } else {
      ids.add(el.id);
    }

    if (!el.type) {
      errors.push(`Element ${el.id || index} has no type.`);
    }

    if (el.opacity != null && (Number(el.opacity) < 0 || Number(el.opacity) > 100)) {
      warnings.push(`Element ${el.id || index} has opacity outside 0..100.`);
    }
  });

  const slideFrames = elements.filter((el) =>
    el && !el.isDeleted && isSlideFrameElement(el)
  );

  const rawSlides = rawSlidesFromJson(raw);

  if (!slideFrames.length && !rawSlides.length) {
    warnings.push(
      'No YANTA slide-frame rectangles or yanta.slides metadata found. YANTA will create a single slide around the content.'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    elementCount: elements.length,
    slideFrameCount: slideFrames.length,
    slideMetadataCount: Array.isArray(rawSlides) ? rawSlides.length : 0,
  };
}

export function buildDrawingFromExcalidrawSlideshowJson(input, {
  title = 'AI Slideshow',
  existingDrawing = null,
} = {}) {
  const raw = parseExcalidrawJsonInput(input);

  const validation = validateExcalidrawSlideshowJson(raw);

  if (!validation.ok) {
    throw new Error(`Invalid Excalidraw JSON: ${validation.errors.join('; ')}`);
  }

  const rawSlides = rawSlidesFromJson(raw);

  let elements = (raw.elements || []).map(normalizeElement);

  let slides = normalizeSlides(rawSlides);

  if (!slides.length) {
    const framePairs = extractYantaSlideFrames(elements, {
      rawSlides,
      existingDrawing,
    });

    slides = normalizeSlides(framePairs.map((x) => x.slide));
  }

  if (!slides.length) {
    slides = autoSlidesFromContent(elements);
  }

  elements = synthesizeFramesForSlides(elements, slides);

  const framePairs = extractYantaSlideFrames(elements, {
    rawSlides: slides,
    existingDrawing,
  });

  if (framePairs.length) {
    const normalizedFrames = new Map(
      framePairs.map((x) => [x.frame.id, x.frame])
    );

    elements = elements.map((el) => normalizedFrames.get(el.id) || el);
    slides = normalizeSlides(framePairs.map((x) => x.slide));
  }

  const scene = normalizeDrawingScene({
    ...raw,
    elements,
    appState: raw.appState || {},
    files: raw.files || {},
    canvas: raw.yanta?.canvas || raw.canvas || {
      width: DEFAULT_SLIDE_WIDTH,
      height: DEFAULT_SLIDE_HEIGHT,
    },
  });

  return {
    ...(existingDrawing || {}),

    id: existingDrawing?.id || raw.yanta?.id || raw.id || uid(),
    title:
      title ||
      raw.yanta?.title ||
      raw.name ||
      existingDrawing?.title ||
      'AI Slideshow',

    canvas:
      raw.yanta?.canvas ||
      raw.canvas ||
      existingDrawing?.canvas ||
      scene.canvas,

    elements: scene.elements,
    appState: scene.appState || {},
    files: scene.files || {},

    slides,
    slideDecks: rawSlideDecksFromJson(raw, existingDrawing),
    defaultSlideDeckId:
      raw.yanta?.defaultSlideDeckId ||
      raw.defaultSlideDeckId ||
      existingDrawing?.defaultSlideDeckId ||
      null,
    presentationSettings:
      raw.yanta?.presentationSettings ||
      raw.presentationSettings ||
      existingDrawing?.presentationSettings ||
      null,

    importWarnings: [
      ...validation.warnings,
      ...validateSlideCoverage(slides, scene.elements),
    ],
  };
}

export function makeSlideGridBounds(index, {
  width = DEFAULT_SLIDE_WIDTH,
  height = DEFAULT_SLIDE_HEIGHT,
  gap = DEFAULT_SLIDE_GAP,
  columns = 1,
} = {}) {
  const col = index % columns;
  const row = Math.floor(index / columns);

  return {
    x: col * (width + gap),
    y: row * (height + gap),
    width,
    height,
  };
}