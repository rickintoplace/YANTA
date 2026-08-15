// ============================================================
// YANTA — Drawing scene persistence.
//
// One place for the rules that decide WHEN an Excalidraw scene is written
// back into its Yjs note document, and how a surface reacts to writes that
// came from somewhere else.
//
// Why this is its own module:
// A drawing can be mounted several times at once — an inline embed in the
// editor, the fullscreen stage, a preview. Every mount runs its own
// Excalidraw instance and every instance both writes to and observes the
// same Yjs entry. Getting that interplay wrong loses strokes, so the rules
// live here once instead of being re-implemented per surface.
// ============================================================

import { uid } from './core.js';
import { setDrawing } from './yjs.js';

// ------------------------------------------------------------
// Programmatic-update guard
//
// Excalidraw fires onChange for real user edits AND for most programmatic
// updateScene() calls. Camera moves, remote hydration and presentation-only
// changes must never be persisted, or an old snapshot can overwrite live work.
// ------------------------------------------------------------

const API_SAVE_SUPPRESSION = new WeakMap();

export function isDrawingApiSaveSuppressed(api) {
  return !!api && API_SAVE_SUPPRESSION.has(api);
}

function suppressDrawingApiSave(api, { releaseMs = 220 } = {}) {
  if (!api) return () => {};

  const token = {};
  let released = false;

  API_SAVE_SUPPRESSION.set(api, token);

  const release = () => {
    if (released) return;
    released = true;

    if (API_SAVE_SUPPRESSION.get(api) === token) {
      API_SAVE_SUPPRESSION.delete(api);
    }
  };

  // Excalidraw can emit onChange synchronously, next frame, or shortly after
  // updateScene(). Keep suppression briefly active, but never permanently.
  requestAnimationFrame(() => requestAnimationFrame(release));
  window.setTimeout(release, releaseMs);

  return release;
}

/**
 * Run api.updateScene() without letting the Drawing autosave persist it.
 *
 * Use this for:
 * - Yjs/remote scene hydration
 * - camera moves
 * - selection-only changes
 * - presentation-only visual changes
 *
 * Do NOT use for user-intended mutations unless you persist them yourself in
 * the same code path.
 */
export function runDrawingApiUpdateWithoutSaving(api, updateOrFn, {
  refresh = true,
  releaseMs = 220,
} = {}) {
  if (!api) return false;

  suppressDrawingApiSave(api, { releaseMs });

  try {
    if (typeof updateOrFn === 'function') {
      updateOrFn(api);
    } else {
      api.updateScene?.(updateOrFn);
    }

    if (refresh) api.refresh?.();

    return true;
  } catch (err) {
    console.warn('[YANTA Draw] programmatic Excalidraw update failed', err);
    return false;
  }
}

// ------------------------------------------------------------
// Scene signature
//
// onChange runs on every pointer move while drawing, so the signature is on
// the hot path. It used to JSON.stringify() the whole scene *including*
// `files` — image files are base64 data URLs, so a board with two photos
// serialised several megabytes per pointer move, which is what made drawing
// feel sticky on phones.
//
// Excalidraw already versions element identity (`version`/`versionNonce` bump
// on every mutation) and a file's bytes never change under a given id, so
// hashing ids is both cheaper and more accurate. Deleted elements are skipped
// so the signature is identical whether it was derived from onChange
// arguments or from a persisted scene object.
// ------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashText(hash, value) {
  const text = String(value ?? '');

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash;
}

function elementsSignature(elements) {
  if (!Array.isArray(elements)) return '0:0';

  let hash = FNV_OFFSET;
  let live = 0;

  for (const el of elements) {
    if (!el || el.isDeleted === true) continue;

    live++;
    hash = hashText(hash, el.id);
    hash = hashText(hash, el.version);
    hash = hashText(hash, el.versionNonce);
  }

  return `${live}:${(hash >>> 0).toString(36)}`;
}

function filesSignature(files) {
  if (!files || typeof files !== 'object') return '0';

  const ids = Object.keys(files);

  return ids.length ? `${ids.length}:${ids.sort().join(',')}` : '0';
}

/**
 * Strips volatile UI state from an Excalidraw appState before it is persisted.
 *
 * Everything removed here is either per-session (selection, editing element,
 * open menus), per-surface (offsets, size, theme) or derived (collaborators).
 * Persisting it is what caused tool-button flicker after a scene reload.
 */
export function cleanAppState(appState = {}) {
  const {
    collaborators,
    selectedElementIds,
    selectedGroupIds,
    editingElement,
    resizingElement,
    draggingElement,
    suggestedBindings,
    startBoundElement,
    cursorButton,
    name,
    offsetTop,
    offsetLeft,
    width,
    height,
    theme,
    viewBackgroundColor,
    currentItemStrokeColor,
    currentItemBackgroundColor,
    openMenu,
    openPopup,
    contextMenu,
    activeTool,
    pendingImageElementId,
    frameToHighlight,
    editingLinearElement,
    multiElement,
    resizingLinearElement,
    selectionElement,
    isBindingEnabled,
    errorMessage,
    ...rest
  } = appState || {};

  const cleaned = { ...rest };

  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === undefined) delete cleaned[key];
  }

  return cleaned;
}

function appStateSignature(appState) {
  // Small and flat once cleaned (scalars only), so stringify stays cheap.
  try {
    return JSON.stringify(cleanAppState(appState || {}));
  } catch {
    return '';
  }
}

export function sceneSignature(elements, appState, files) {
  return `${elementsSignature(elements)}|${appStateSignature(appState)}|${filesSignature(files)}`;
}

export function drawingSignature(drawing) {
  return sceneSignature(
    drawing?.elements || [],
    drawing?.appState || {},
    drawing?.files || {}
  );
}

// ------------------------------------------------------------
// Local origins
//
// Every writer stamps its Yjs transactions with a unique origin. A surface
// must ignore its own writes; it must NOT ignore a sibling surface in the
// same tab, because that is how the inline embed follows fullscreen edits.
// ------------------------------------------------------------

const localOrigins = new Set();

/** True for a Yjs transaction origin produced by a drawing surface in this tab. */
export function isLocalDrawingOrigin(origin) {
  return typeof origin === 'string' && localOrigins.has(origin);
}

// ------------------------------------------------------------
// Writer
// ------------------------------------------------------------

const liveWriters = new Set();

let unloadGuardsBound = false;

function bindUnloadGuards() {
  if (unloadGuardsBound) return;
  unloadGuardsBound = true;

  /*
    A phone can freeze or discard the tab the moment it goes to the
    background. Anything still sitting in a debounce window would be lost, so
    every pending scene is written out synchronously on the way out.
  */
  const flushAll = () => {
    for (const writer of liveWriters) writer.flush();
  };

  window.addEventListener('pagehide', flushAll);
  window.addEventListener('beforeunload', flushAll);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

/**
 * Creates the autosave for exactly one mounted Excalidraw surface.
 *
 * @param {object}   options
 * @param {string}   options.noteId      note document the drawing lives in
 * @param {string}   options.drawingId   drawing key inside that document
 * @param {Function} options.getApi      () => Excalidraw API | null
 * @param {Function} options.buildScene  (api) => persisted scene object
 * @param {Function} [options.onPersisted] (scene) => void, after a write
 * @param {object}   [options.baseline]  scene the surface mounted with
 */
export function createDrawingSceneWriter({
  noteId,
  drawingId,
  getApi,
  buildScene,
  onPersisted = null,
  baseline = null,
  quietMs = 250,
  maxWaitMs = 1200,
}) {
  bindUnloadGuards();

  const origin = `draw-local-${uid()}`;
  localOrigins.add(origin);

  /*
    While the pointer is down we are inside a stroke. Writing then means a
    deep clone of the whole scene in the middle of the gesture — a visible
    stutter. The write is deferred to the gap between strokes instead, but
    only up to a hard ceiling so one very long stroke still gets saved.
  */
  const strokeDeferCeilingMs = maxWaitMs * 3;

  let timer = 0;
  let dirtySince = 0;
  let pointerDown = false;
  let disposed = false;

  let lastSeenSig = baseline ? drawingSignature(baseline) : '';
  let lastPersistedSig = lastSeenSig;

  function clearTimer() {
    if (!timer) return;
    window.clearTimeout(timer);
    timer = 0;
  }

  function schedule(delay) {
    clearTimer();
    timer = window.setTimeout(run, Math.max(0, delay));
  }

  function scheduleFromDeadline() {
    const waited = performance.now() - dirtySince;
    schedule(Math.min(quietMs, maxWaitMs - waited));
  }

  function run() {
    timer = 0;

    if (disposed || !dirtySince) return;

    const api = getApi();

    /*
      Never drop a pending write. A surface that is briefly unavailable or
      inside a programmatic-update window gets retried — dropping it silently
      is how edits made just before a theme switch or a camera move used to
      disappear.
    */
    if (!api || isDrawingApiSaveSuppressed(api)) {
      schedule(180);
      return;
    }

    if (pointerDown && performance.now() - dirtySince < strokeDeferCeilingMs) {
      schedule(120);
      return;
    }

    persist();
  }

  function persist() {
    clearTimer();

    if (disposed) return false;

    const api = getApi();
    if (!api) return false;

    const scene = buildScene(api);
    if (!scene) return false;

    const sig = drawingSignature(scene);

    dirtySince = 0;
    lastSeenSig = sig;

    if (sig === lastPersistedSig) return false;

    lastPersistedSig = sig;

    setDrawing(noteId, drawingId, scene, origin);
    onPersisted?.(scene);

    window.dispatchEvent(new CustomEvent('yanta-drawing-updated', {
      detail: {
        noteId,
        drawingId,
        reason: 'scene-persisted',
      },
    }));

    return true;
  }

  const writer = {
    origin,

    /** Report an Excalidraw onChange. Returns true when it scheduled a write. */
    note(elements, appState, files) {
      if (disposed) return false;

      const api = getApi();
      if (isDrawingApiSaveSuppressed(api)) return false;

      const sig = sceneSignature(elements, appState, files);
      if (sig === lastSeenSig) return false;

      lastSeenSig = sig;
      pointerDown = appState?.cursorButton === 'down';

      if (!dirtySince) dirtySince = performance.now();

      scheduleFromDeadline();

      return true;
    },

    isOwnOrigin(candidate) {
      return candidate === origin;
    },

    /** True while this surface holds edits the document has not seen yet. */
    isDirty() {
      return !disposed && dirtySince > 0;
    },

    /** True when `scene` is exactly what this surface last wrote. */
    matchesScene(scene) {
      return drawingSignature(scene) === lastPersistedSig;
    },

    /**
     * Accept a scene that came from elsewhere as the new baseline, so the
     * onChange echoing back from updateScene() is recognised as a no-op.
     */
    adopt(scene) {
      const sig = drawingSignature(scene);

      lastSeenSig = sig;
      lastPersistedSig = sig;
      dirtySince = 0;
      pointerDown = false;

      clearTimer();
    },

    /** Write pending edits out now. */
    flush() {
      if (disposed || !dirtySince) return false;
      return persist();
    },

    /**
     * Flush after the current task. Used from Yjs observers, where writing
     * back into the document mid-transaction would re-enter Yjs.
     */
    flushSoon() {
      if (disposed || !dirtySince) return;
      schedule(0);
    },

    dispose() {
      if (disposed) return;

      writer.flush();

      disposed = true;
      clearTimer();
      localOrigins.delete(origin);
      liveWriters.delete(writer);
    },
  };

  liveWriters.add(writer);

  return writer;
}
