// ============================================================
// YANTA Drawing — Layer z-order enforcement.
//
// Excalidraw's scene is one flat array and its own "send backward / bring to
// front" actions reorder that array freely. Without this, a base-layer element
// could be moved in front of a top-layer one and layers would not actually
// stack — which is the whole point of having them.
//
// The rule: layer order wins, order *inside* a layer is the user's. Excalidraw's
// native actions therefore keep working exactly as expected, they just operate
// within the element's own layer.
//
// Kept in its own tiny module because draw.js imports it statically on the hot
// onChange path — the panel and the store stay lazily loaded.
// ============================================================

import {
  layerIdOfElement,
  normalizeLayers,
  sortElementsByLayer,
} from './layers-model.js';

/**
 * True when `elements` are not grouped by layer order.
 *
 * O(n), no allocation beyond the rank map, and it returns immediately for the
 * overwhelming majority of drawings, which use no layers at all.
 */
export function violatesLayerOrder(elements, layers) {
  if (!Array.isArray(elements) || elements.length < 2) return false;
  if (!Array.isArray(layers) || layers.length < 2) return false;

  const rank = new Map(normalizeLayers(layers).map((layer, index) => [layer.id, index]));

  let previous = -1;

  for (const el of elements) {
    if (!el || el.isDeleted) continue;

    const current = rank.get(layerIdOfElement(el)) ?? 0;

    if (current < previous) return true;

    previous = current;
  }

  return false;
}

/**
 * Returns layer-sorted elements, or null when the order is already correct.
 *
 * Returning null lets callers skip the scene write entirely, which is what
 * keeps this safe to call from onChange.
 */
export function layerSortedElements(elements, layers) {
  if (!violatesLayerOrder(elements, layers)) return null;

  return sortElementsByLayer(elements, layers);
}
