// ============================================================
// YANTA Drawing — Layer store.
//
// Every mutation follows the same shape: read the live scene, produce the next
// element array, write it back through setDrawing() so it is one CRDT edit
// that syncs, undoes and shares like any other drawing change — and push the
// same elements into the mounted Excalidraw instance so the board updates
// without waiting for a round trip.
// ============================================================

import {
  getDrawing,
  setDrawing,
} from '../yjs.js';

import {
  runDrawingApiUpdateWithoutSaving,
} from '../draw-scene-sync.js';

import {
  BASE_LAYER_ID,
  LAYER_COLORS,
  hideElementForLayer,
  isElementLockedByLayer,
  layerIdOfElement,
  lockElementForLayer,
  makeLayer,
  normalizeLayers,
  showElementForLayer,
  sortElementsByLayer,
  unlockElementForLayer,
  withLayerId,
} from './layers-model.js';

const LAYERS_ORIGIN = 'draw-layers';

export function listLayers(noteId, drawingId) {
  return normalizeLayers(getDrawing(noteId, drawingId)?.layers || []);
}

function sceneElements(noteId, drawingId, api) {
  try {
    const live = api?.getSceneElementsIncludingDeleted?.() || api?.getSceneElements?.();
    if (Array.isArray(live) && live.length) return live;
  } catch {}

  return getDrawing(noteId, drawingId)?.elements || [];
}

/** Element counts per layer id, for the panel. */
export function layerElementCounts(elements = []) {
  const counts = new Map();

  for (const el of elements) {
    if (!el || el.isDeleted) continue;

    const id = layerIdOfElement(el);

    counts.set(id, (counts.get(id) || 0) + 1);
  }

  return counts;
}

function commit(noteId, drawingId, { layers, elements, api }) {
  const drawing = getDrawing(noteId, drawingId);
  if (!drawing) return null;

  const nextLayers = normalizeLayers(layers ?? drawing.layers ?? []);
  const nextElements = sortElementsByLayer(
    elements ?? drawing.elements ?? [],
    nextLayers
  );

  setDrawing(noteId, drawingId, {
    ...drawing,
    layers: nextLayers,
    elements: nextElements,
  }, LAYERS_ORIGIN);

  if (api) {
    runDrawingApiUpdateWithoutSaving(api, { elements: nextElements });
  }

  window.dispatchEvent(new CustomEvent('yanta-draw-layers-updated', {
    detail: { noteId, drawingId },
  }));

  return nextLayers;
}

export function createLayer(noteId, drawingId, { name, api } = {}) {
  const layers = listLayers(noteId, drawingId);

  const layer = makeLayer({
    name: name || `Layer ${layers.length}`,
    order: layers.length,
    color: LAYER_COLORS[layers.length % LAYER_COLORS.length],
  });

  commit(noteId, drawingId, {
    layers: [...layers, layer],
    elements: sceneElements(noteId, drawingId, api),
    api,
  });

  return layer;
}

export function updateLayer(noteId, drawingId, layerId, patch = {}, { api } = {}) {
  const layers = listLayers(noteId, drawingId).map((layer) =>
    layer.id === layerId ? { ...layer, ...patch, id: layer.id } : layer
  );

  return commit(noteId, drawingId, {
    layers,
    elements: sceneElements(noteId, drawingId, api),
    api,
  });
}

export function reorderLayer(noteId, drawingId, layerId, delta, { api } = {}) {
  const layers = listLayers(noteId, drawingId);
  const index = layers.findIndex((l) => l.id === layerId);
  const target = index + delta;

  // The base layer is the floor of the stack and never moves.
  if (index <= 0 || target <= 0 || target >= layers.length) return layers;

  const next = [...layers];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);

  return commit(noteId, drawingId, {
    layers: next.map((layer, i) => ({ ...layer, order: i })),
    elements: sceneElements(noteId, drawingId, api),
    api,
  });
}

/**
 * Deletes a layer. Its elements are not destroyed — they move to the base
 * layer, because losing work to a panel click is never acceptable.
 */
export function deleteLayer(noteId, drawingId, layerId, { api } = {}) {
  if (layerId === BASE_LAYER_ID) return listLayers(noteId, drawingId);

  const layers = listLayers(noteId, drawingId).filter((l) => l.id !== layerId);

  const elements = sceneElements(noteId, drawingId, api).map((el) => {
    if (layerIdOfElement(el) !== layerId) return el;

    // Whatever the deleted layer hid or locked comes back with it.
    return withLayerId(unlockElementForLayer(showElementForLayer(el)), BASE_LAYER_ID);
  });

  return commit(noteId, drawingId, { layers, elements, api });
}

export function setLayerVisible(noteId, drawingId, layerId, visible, { api } = {}) {
  const elements = sceneElements(noteId, drawingId, api).map((el) => {
    if (layerIdOfElement(el) !== layerId) return el;

    return visible ? showElementForLayer(el) : hideElementForLayer(el);
  });

  const layers = listLayers(noteId, drawingId).map((layer) =>
    layer.id === layerId ? { ...layer, visible: !!visible } : layer
  );

  return commit(noteId, drawingId, { layers, elements, api });
}

export function setLayerLocked(noteId, drawingId, layerId, locked, { api } = {}) {
  const elements = sceneElements(noteId, drawingId, api).map((el) => {
    if (layerIdOfElement(el) !== layerId) return el;

    return locked ? lockElementForLayer(el) : unlockElementForLayer(el);
  });

  const layers = listLayers(noteId, drawingId).map((layer) =>
    layer.id === layerId ? { ...layer, locked: !!locked } : layer
  );

  return commit(noteId, drawingId, { layers, elements, api });
}

/**
 * Moves the current board selection into a layer, adopting that layer's
 * visibility and lock so the result matches what the panel promises.
 */
export function moveSelectionToLayer(noteId, drawingId, layerId, { api } = {}) {
  const selected = selectedElementIds(api);
  if (!selected.size) return 0;

  const layer = listLayers(noteId, drawingId).find((l) => l.id === layerId);
  if (!layer) return 0;

  let moved = 0;

  const elements = sceneElements(noteId, drawingId, api).map((el) => {
    if (!selected.has(el.id)) return el;

    moved++;

    let next = withLayerId(showElementForLayer(unlockElementForLayer(el)), layerId);

    if (layer.locked) next = lockElementForLayer(next);
    if (!layer.visible) next = hideElementForLayer(next);

    return next;
  });

  commit(noteId, drawingId, { elements, api });

  return moved;
}

export function selectedElementIds(api) {
  try {
    const selected = api?.getAppState?.()?.selectedElementIds || {};

    return new Set(Object.keys(selected).filter((id) => selected[id]));
  } catch {
    return new Set();
  }
}

/** Selects every element of a layer on the board. */
export function selectLayer(noteId, drawingId, layerId, { api } = {}) {
  if (!api) return 0;

  const ids = sceneElements(noteId, drawingId, api)
    .filter((el) => el && !el.isDeleted && layerIdOfElement(el) === layerId && !el.locked)
    .map((el) => el.id);

  runDrawingApiUpdateWithoutSaving(api, {
    appState: {
      selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
    },
  });

  return ids.length;
}

/** Ids of every live element, used as the "already existed" baseline below. */
export function liveElementIds(noteId, drawingId, api) {
  return new Set(
    sceneElements(noteId, drawingId, api)
      .filter((el) => el && !el.isDeleted)
      .map((el) => el.id)
  );
}

/**
 * Puts freshly drawn elements into the layer the user is working in.
 *
 * Excalidraw knows nothing about layers, so anything drawn lands untagged.
 * Only elements missing from `knownIds` are adopted — an explicit baseline
 * rather than "untagged means new", which would swallow the base layer.
 *
 * Returns the ids that were adopted.
 */
export function adoptNewElements(noteId, drawingId, layerId, knownIds, { api } = {}) {
  if (!layerId || layerId === BASE_LAYER_ID) return [];

  const elements = sceneElements(noteId, drawingId, api);
  const adopted = [];

  const next = elements.map((el) => {
    if (!el || el.isDeleted) return el;
    if (knownIds.has(el.id)) return el;
    if (el.customData?.yanta?.layerId) return el;
    if (isElementLockedByLayer(el)) return el;

    adopted.push(el.id);

    return withLayerId(el, layerId);
  });

  if (!adopted.length) return [];

  commit(noteId, drawingId, { elements: next, api });

  return adopted;
}
