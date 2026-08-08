/*
  Slide templates.

  A YANTA slide deck is not a separate document type: a drawing is an infinite
  board, and slides are named rectangular camera targets on it (see
  slides-model.js). A slideshow just moves the Excalidraw camera between them.

  That is genuinely unusual, and it is the one thing in the product no
  competitor has — which makes it worth a template, but also makes a template
  hard: a deck has to arrive with something ON the board, or the user opens an
  empty canvas and learns nothing.

  So this module builds a small, real board — title, three content slides,
  a closing one — with text already placed inside each frame and presenter
  notes attached. The user edits words; they never have to invent the
  structure or discover that slides exist.

  Element construction is deliberately minimal and self-contained: plain
  Excalidraw element objects with every field the schema needs. Importing the
  welcome-vault builder from notes.js would drag that whole module in for a
  feature most people never touch.
*/

import { uid } from '../core.js';
import { setDrawing } from '../yjs.js';

const SLIDE_W = 960;
const SLIDE_H = 540;
const SLIDE_GAP = 220;

const INK = '#1e1e1e';
const MUTED = '#5b5b5b';
const ACCENT = '#6ea8fe';

function nonce() {
  return Math.floor(Math.random() * 2 ** 31);
}

function textElement({
  text,
  x,
  y,
  width,
  fontSize = 28,
  strokeColor = INK,
  textAlign = 'left',
}) {
  const value = String(text || '');
  const lines = value.split('\n').length;

  return {
    id: uid(),
    type: 'text',
    x,
    y,
    width,
    height: Math.round(fontSize * 1.25 * lines),
    angle: 0,
    strokeColor,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nonce(),
    version: 1,
    versionNonce: nonce(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: {},
    text: value,
    rawText: value,
    originalText: value,
    fontSize,
    fontFamily: 5,
    textAlign,
    verticalAlign: 'top',
    containerId: null,
    lineHeight: 1.25,
    baseline: Math.round(fontSize * 0.9),
  };
}

function underline({ x, y, width }) {
  return {
    id: uid(),
    type: 'line',
    x,
    y,
    width,
    height: 0,
    angle: 0,
    strokeColor: ACCENT,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 4,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nonce(),
    version: 1,
    versionNonce: nonce(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: {},
    points: [[0, 0], [width, 0]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  };
}

/*
  The deck itself. Content over cleverness: a talk that already says something
  is easier to rewrite than a blank one, and it demonstrates presenter notes
  by actually having them.
*/
const DECK = [
  {
    title: 'Title',
    heading: 'What we decided,\nand why',
    body: 'Team review · {{date}}',
    notes: 'Say the decision in the first sentence. People stop listening while they wait for the point.',
  },
  {
    title: 'The problem',
    heading: 'The problem',
    body: 'Every Monday somebody spends\nhalf a day pulling exports\nto answer one question.',
    notes: 'Use their words, not yours. If someone in the room said this, name them — it makes the room agree faster.',
  },
  {
    title: 'What we looked at',
    heading: 'What we looked at',
    body: '1 · Buy a reporting tool\n2 · Build one view ourselves\n3 · Keep doing it by hand',
    notes: 'Three options. Two are real, one is the status quo — naming it out loud stops it winning by default.',
  },
  {
    title: 'The decision',
    heading: 'We build one view',
    body: 'Six weeks · one person\nHand it over so it survives us',
    notes: 'The whole talk exists for this slide. Pause here. Let it be quiet for a moment.',
  },
  {
    title: 'What would change our minds',
    heading: 'What would change our minds',
    body: 'If the database access does not\narrive in week one, we stop\nand talk again.',
    notes: 'Ending on the failure condition reads as confidence, not doubt — and it gets you the access you need.',
  },
];

/**
 * Builds the deck into a fresh drawing on `noteId` and returns the drawing id
 * so the caller can embed it with a `draw://` line.
 */
export function buildSlideDeck(noteId, { dateLabel = '' } = {}) {
  const drawingId = uid();
  const elements = [];

  DECK.forEach((slide, index) => {
    const originX = index * (SLIDE_W + SLIDE_GAP);
    const heading = slide.heading;
    const body = String(slide.body || '').replace('{{date}}', dateLabel);

    elements.push(textElement({
      text: heading,
      x: originX + 80,
      y: 120,
      width: SLIDE_W - 160,
      fontSize: index === 0 ? 64 : 44,
    }));

    elements.push(underline({
      x: originX + 80,
      y: index === 0 ? 300 : 240,
      width: 160,
    }));

    elements.push(textElement({
      text: body,
      x: originX + 80,
      y: index === 0 ? 340 : 290,
      width: SLIDE_W - 160,
      fontSize: 28,
      strokeColor: MUTED,
    }));
  });

  setDrawing(noteId, drawingId, {
    id: drawingId,
    title: 'Deck',
    elements,
    appState: {},
    files: {},
  }, 'template-slides');

  return drawingId;
}

/**
 * Registers the camera targets and presenter notes. Must run AFTER the drawing
 * exists, because createSlide() appends its frame element to the stored scene.
 */
export async function attachSlideFrames(noteId, drawingId) {
  const { createSlide, setSlideNotes } = await import('../slides/slides-store.js');

  DECK.forEach((slide, index) => {
    const created = createSlide(noteId, drawingId, {
      title: slide.title,
      bounds: {
        x: index * (SLIDE_W + SLIDE_GAP),
        y: 0,
        width: SLIDE_W,
        height: SLIDE_H,
      },
      color: ACCENT,
    });

    if (created && slide.notes) {
      setSlideNotes(noteId, drawingId, created.id, slide.notes);
    }
  });
}
