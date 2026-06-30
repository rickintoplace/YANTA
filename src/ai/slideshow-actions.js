// ============================================================
// YANTA AI — Slideshow Actions
//
// Native editable YANTA slideshows from complete Excalidraw JSON.
// ============================================================

import {
  uid,
} from '../core.js';

import {
  getDrawing,
  setDrawing,
} from '../yjs.js';

import {
  createNoteAction,
  appendToNoteAction,
} from './app-actions.js';

import {
  buildDrawingFromExcalidrawSlideshowJson,
  validateExcalidrawSlideshowJson,
} from '../slides/slides-import.js';

export async function validateExcalidrawSlideshowJsonAction({
  excalidrawJson,
} = {}) {
  return validateExcalidrawSlideshowJson(excalidrawJson);
}

export async function createExcalidrawSlideshowAction({
  title = 'AI Slideshow',
  body = '',
  folderId = null,
  tags = ['slideshow'],
  excalidrawJson,
} = {}) {
  const validation = validateExcalidrawSlideshowJson(excalidrawJson);

  if (!validation.ok) {
    throw new Error(validation.errors.join('\n'));
  }

  const note = await createNoteAction({
    title,
    body,
    folderId,
    tags: Array.isArray(tags) ? tags : ['slideshow'],
    icon: 'presentation',
    color: '#8b5cf6',
  });

  const drawingId = `slides_${uid()}`;

  const drawing = buildDrawingFromExcalidrawSlideshowJson(excalidrawJson, {
    title,
  });

  setDrawing(note.id, drawingId, {
    ...drawing,
    id: drawingId,
    title,
  }, 'ai-create-excalidraw-slideshow');

  await appendToNoteAction({
    noteId: note.id,
    text: `draw://${drawingId}`,
  });

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: {
      noteId: note.id,
      drawingId,
      reason: 'ai-create-excalidraw-slideshow',
      source: 'ai',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-slides-updated', {
    detail: {
      noteId: note.id,
      drawingId,
      origin: 'ai-create-excalidraw-slideshow',
    },
  }));

  return {
    ok: true,
    note,
    drawingId,
    slideCount: drawing.slides?.length || 0,
    elementCount: drawing.elements?.length || 0,
    warnings: drawing.importWarnings || validation.warnings || [],
  };
}

export async function updateExcalidrawSlideshowAction({
  noteId,
  drawingId,
  title = '',
  excalidrawJson,
} = {}) {
  const existing = getDrawing(noteId, drawingId);

  if (!existing) {
    throw new Error('Drawing not found.');
  }

  const validation = validateExcalidrawSlideshowJson(excalidrawJson);

  if (!validation.ok) {
    throw new Error(validation.errors.join('\n'));
  }

  const drawing = buildDrawingFromExcalidrawSlideshowJson(excalidrawJson, {
    title: title || existing.title || 'AI Slideshow',
    existingDrawing: existing,
  });

  setDrawing(noteId, drawingId, {
    ...existing,
    ...drawing,
    id: drawingId,
    title: title || existing.title || drawing.title,
  }, 'ai-update-excalidraw-slideshow');

  window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
    detail: {
      noteId,
      drawingId,
      reason: 'ai-update-excalidraw-slideshow',
      source: 'ai',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-slides-updated', {
    detail: {
      noteId,
      drawingId,
      origin: 'ai-update-excalidraw-slideshow',
    },
  }));

  return {
    ok: true,
    noteId,
    drawingId,
    slideCount: drawing.slides?.length || 0,
    elementCount: drawing.elements?.length || 0,
    warnings: drawing.importWarnings || validation.warnings || [],
  };
}

export async function readExcalidrawDrawingJsonAction({
  noteId,
  drawingId,
} = {}) {
  const drawing = getDrawing(noteId, drawingId);

  if (!drawing) {
    throw new Error('Drawing not found.');
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://yanta.page',
    elements: drawing.elements || [],
    appState: drawing.appState || {},
    files: drawing.files || {},
    yanta: {
      title: drawing.title || 'Drawing',
      canvas: drawing.canvas || null,
      slides: drawing.slides || [],
      slideDecks: drawing.slideDecks || [],
      defaultSlideDeckId: drawing.defaultSlideDeckId || null,
      presentationSettings: drawing.presentationSettings || null,
    },
  };
}