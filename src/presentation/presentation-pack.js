import {
  state,
} from '../core.js';

import {
  getDrawing,
} from '../yjs.js';

import {
  normalizeSlides,
} from '../slides/slides-model.js';

function cloneJson(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }

  return '{' + Object.keys(value).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
    .join(',') + '}';
}

async function sha256B64url(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const u8 = new Uint8Array(digest);

  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);

  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function publicSlides(slides = []) {
  return normalizeSlides(slides).map((slide) => {
    const copy = cloneJson(slide);

    delete copy.notes;
    delete copy.presenterNotes;

    return copy;
  });
}

function presenterNotes(slides = []) {
  const out = {};

  for (const slide of normalizeSlides(slides)) {
    out[slide.id] = String(slide.notes?.markdown || slide.presenterNotes || '');
  }

  return out;
}

export async function packPresentationSession({
  noteId,
  drawingId,
  session,
} = {}) {
  if (!noteId) throw new Error('noteId required');
  if (!drawingId) throw new Error('drawingId required');
  if (!session?.signalingTopic || !session?.signalingToken) {
    throw new Error('session signaling data required');
  }

  const note = state.notes.get(noteId);
  const drawing = getDrawing(noteId, drawingId);

  if (!note) throw new Error('Note not found');
  if (!drawing) throw new Error('Drawing not found');

  const slides = normalizeSlides(drawing.slides || []).filter((s) => !s.hidden);

  const payload = {
    v: 1,
    kind: 'yanta-presentation-session',
    exportedAt: new Date().toISOString(),

    source: {
      noteId,
      noteTitle: note.title || 'Untitled',
      drawingId,
      drawingTitle: drawing.title || 'Drawing',
    },

    signaling: {
      topic: session.signalingTopic,
      token: session.signalingToken,
    },

    display: {
      title: drawing.title || note.title || 'YANTA Presentation',

      drawing: {
        id: drawing.id || drawingId,
        title: drawing.title || 'Drawing',
        elements: cloneJson(drawing.elements || []),
        appState: cloneJson(drawing.appState || {}),
        files: cloneJson(drawing.files || {}),
        canvas: cloneJson(drawing.canvas || null),
      },

      slides: publicSlides(slides),
    },

    presenter: {
      notesBySlideId: presenterNotes(drawing.slides || []),
    },

    scopedEdit: {
      enabled: true,
      applyRequired: true,
    },
  };

  const payloadHash = await sha256B64url(
    stableStringify({
      ...payload,
      exportedAt: undefined,
    })
  );

  return {
    payload,
    payloadHash,
  };
}