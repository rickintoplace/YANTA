// ============================================================
// YANTA Present — the deck a connected device receives
//
// A screen or remote has no copy of the drawing (it may be a TV that never
// saw YANTA before). The presenter sends a deck: the board's elements, its
// slides with their build steps, presenter notes and the images. Pictures
// are by far the largest part and never change, so a device lists the
// files it already has and gets only the missing ones — an edit during the
// talk resends a few kilobytes, not the photos again.
// ============================================================

import { isSlideFrameElement, presentationSlidesFor } from '../slides/slides-model.js';

function fnv(text, hash = 0x811c9dc5) {
  let h = hash;

  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return h >>> 0;
}

function deckElements(drawing) {
  return (drawing?.elements || []).filter((el) => el && !el.isDeleted && !isSlideFrameElement(el));
}

/** Changes whenever anything a screen shows changes; cheap enough for every edit. */
export function deckVersionOf(drawing) {
  if (!drawing) return '';

  let h = 0x811c9dc5;

  for (const el of deckElements(drawing)) {
    h = fnv(`${el.id}:${el.version}:${el.versionNonce}|`, h);
  }

  h = fnv(JSON.stringify(presentationSlidesFor(drawing).map((s) => [s.id, s.bounds, s.animation, s.title, s.notes?.markdown || ''])), h);
  h = fnv(Object.keys(drawing.files || {}).sort().join(','), h);
  h = fnv(String(drawing.appState?.viewBackgroundColor || ''), h);

  return h.toString(36);
}

/**
 * The deck for one device. `haveFiles` are the image ids it already holds.
 */
export function buildDeck(drawing, { haveFiles = [], theme = 'light' } = {}) {
  const have = new Set(haveFiles);
  const slides = presentationSlidesFor(drawing);
  const notes = {};

  for (const slide of slides) {
    if (slide.notes?.markdown) notes[slide.id] = slide.notes.markdown;
  }

  const files = {};

  for (const [id, file] of Object.entries(drawing?.files || {})) {
    if (!have.has(id)) files[id] = file;
  }

  return {
    version: deckVersionOf(drawing),
    title: drawing?.title || '',
    slides: slides.map((slide) => ({ ...slide, notes: { markdown: '', visibility: 'presenter-only' } })),
    notes,
    elements: deckElements(drawing),
    appState: {
      viewBackgroundColor: drawing?.appState?.viewBackgroundColor || '#ffffff',
      // Screens draw the board the way the presenter sees it.
      theme: theme === 'dark' ? 'dark' : 'light',
    },
    files,
    fileIds: Object.keys(drawing?.files || {}),
  };
}

/** Folds a received deck into what the device already had (files accumulate). */
export function mergeDeck(previous, incoming) {
  const files = { ...(previous?.files || {}) };

  for (const [id, file] of Object.entries(incoming.files || {})) files[id] = file;

  // Keep only what the current deck still uses.
  const wanted = new Set(incoming.fileIds || Object.keys(files));
  for (const id of Object.keys(files)) {
    if (!wanted.has(id)) delete files[id];
  }

  return { ...incoming, files };
}
