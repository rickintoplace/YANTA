// ============================================================
// YANTA Drawing — Layer model.
//
// Excalidraw has no layer concept: a scene is one flat, z-ordered array of
// elements. YANTA adds layers on top of that without forking the format —
// each element carries `customData.yanta.layerId`, and the drawing carries the
// ordered list of layers. Anything without a tag belongs to the base layer, so
// every existing drawing already has a valid layer structure.
//
// What a layer owns:
// - z-order   elements are sorted by their layer's order
// - visible   hidden elements keep their real opacity in customData and are
//             rendered at 0, so hiding is lossless and survives sync
// - locked    the layer's elements cannot be selected or edited
// ============================================================

import { uid } from '../core.js';

export const BASE_LAYER_ID = 'base';

export const LAYER_COLORS = [
  '#6ea8fe',
  '#a78bfa',
  '#f472b6',
  '#fbbf24',
  '#34d399',
  '#22d3ee',
];

export function makeLayer({
  name = 'Layer',
  order = 0,
  color = LAYER_COLORS[0],
} = {}) {
  return {
    id: uid(),
    name,
    order,
    color,
    visible: true,
    locked: false,
  };
}

function normalizeLayer(raw = {}, index = 0) {
  const id = String(raw.id || uid());

  return {
    id,
    name: String(raw.name || `Layer ${index + 1}`).slice(0, 60),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    color: typeof raw.color === 'string' && raw.color ? raw.color : LAYER_COLORS[index % LAYER_COLORS.length],
    visible: raw.visible !== false,
    locked: raw.locked === true,
  };
}

/**
 * The layer list of a drawing, base layer first and always present.
 *
 * Order is bottom-to-top, matching the scene array: the first layer renders
 * behind the others, exactly like the "send to back" the user already knows.
 */
export function normalizeLayers(raw = []) {
  const list = (Array.isArray(raw) ? raw : [])
    .map(normalizeLayer)
    .filter((layer) => layer.id !== BASE_LAYER_ID);

  list.sort((a, b) =>
    a.order - b.order ||
    String(a.id).localeCompare(String(b.id))
  );

  const base = (Array.isArray(raw) ? raw : []).find((l) => l?.id === BASE_LAYER_ID);

  return [
    {
      ...normalizeLayer({
        name: 'Base',
        color: '#94a3b8',
        ...(base || {}),
      }, 0),
      id: BASE_LAYER_ID,
      order: 0,
    },
    ...list.map((layer, index) => ({ ...layer, order: index + 1 })),
  ];
}

export function layerIdOfElement(el) {
  const id = el?.customData?.yanta?.layerId;

  return typeof id === 'string' && id ? id : BASE_LAYER_ID;
}

/** Returns a copy of `el` assigned to `layerId` (base clears the tag). */
export function withLayerId(el, layerId) {
  const yanta = { ...(el?.customData?.yanta || {}) };

  if (!layerId || layerId === BASE_LAYER_ID) {
    delete yanta.layerId;
  } else {
    yanta.layerId = layerId;
  }

  const customData = { ...(el?.customData || {}) };

  if (Object.keys(yanta).length) {
    customData.yanta = yanta;
  } else {
    delete customData.yanta;
  }

  return { ...el, customData };
}

// ------------------------------------------------------------
// Visibility / lock
//
// Both are stored on the element itself so they survive a reload and sync to
// other devices like any other edit. The real opacity is parked in customData
// while hidden, which makes unhide exact rather than a guess at 100.
// ------------------------------------------------------------

function yantaData(el) {
  return el?.customData?.yanta || {};
}

export function isElementHiddenByLayer(el) {
  return yantaData(el).layerHidden === true;
}

export function isElementLockedByLayer(el) {
  return yantaData(el).layerLocked === true;
}

function patchYanta(el, patch) {
  const yanta = { ...yantaData(el), ...patch };

  for (const key of Object.keys(yanta)) {
    if (yanta[key] === undefined) delete yanta[key];
  }

  const customData = { ...(el?.customData || {}) };

  if (Object.keys(yanta).length) {
    customData.yanta = yanta;
  } else {
    delete customData.yanta;
  }

  return { ...el, customData };
}

export function hideElementForLayer(el) {
  if (isElementHiddenByLayer(el)) return el;

  return {
    ...patchYanta(el, {
      layerHidden: true,
      layerOpacity: el.opacity,
    }),
    opacity: 0,
    locked: true,
  };
}

export function showElementForLayer(el) {
  if (!isElementHiddenByLayer(el)) return el;

  const restoredOpacity = Number(yantaData(el).layerOpacity);

  return {
    ...patchYanta(el, {
      layerHidden: undefined,
      layerOpacity: undefined,
    }),
    opacity: Number.isFinite(restoredOpacity) ? restoredOpacity : 100,
    locked: isElementLockedByLayer(el),
  };
}

export function lockElementForLayer(el) {
  if (isElementLockedByLayer(el)) return el;

  return {
    ...patchYanta(el, { layerLocked: true }),
    locked: true,
  };
}

export function unlockElementForLayer(el) {
  if (!isElementLockedByLayer(el)) return el;

  return {
    ...patchYanta(el, { layerLocked: undefined }),
    // A hidden layer stays locked — its elements are not there to be grabbed.
    locked: isElementHiddenByLayer(el),
  };
}

/**
 * Sorts elements by their layer order, keeping the order inside a layer.
 *
 * Excalidraw renders the array back to front, so this is what actually gives
 * layers their stacking meaning.
 */
export function sortElementsByLayer(elements = [], layers = []) {
  const rank = new Map(normalizeLayers(layers).map((layer, index) => [layer.id, index]));

  return [...elements]
    .map((el, index) => ({ el, index }))
    .sort((a, b) => {
      const ra = rank.get(layerIdOfElement(a.el)) ?? 0;
      const rb = rank.get(layerIdOfElement(b.el)) ?? 0;

      return ra - rb || a.index - b.index;
    })
    .map((entry) => entry.el);
}
