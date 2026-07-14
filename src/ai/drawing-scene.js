// ============================================================
// YANTA AI — Drawing scene helpers
//
// Turns AI-provided content (Mermaid source or inline SVG) into
// Excalidraw scene fragments ({ elements, files }) that can be
// used to create a new drawing or edited into an existing one.
//
// Mermaid: flowchart, sequence and class diagrams convert to
// native, editable Excalidraw elements. Every other Mermaid type
// is rasterized to a static image (still inserted, but no longer
// editable) — this mirrors Excalidraw's own Mermaid import.
// ============================================================

import {
  uid,
} from '../core.js';

function now() {
  return Date.now();
}

// ------------------------------------------------------------
// Library loading (lazy — Mermaid pulls in a heavy parser)
// ------------------------------------------------------------

let convertersPromise = null;

function ensureExcalidrawAssetPath() {
  if (typeof window !== 'undefined' && !window.EXCALIDRAW_ASSET_PATH) {
    window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
  }
}

async function loadConverters() {
  ensureExcalidrawAssetPath();

  if (!convertersPromise) {
    convertersPromise = Promise.all([
      import('@excalidraw/excalidraw'),
      import('@excalidraw/mermaid-to-excalidraw'),
    ]).then(([excalidraw, mermaid]) => ({
      convertToExcalidrawElements: excalidraw.convertToExcalidrawElements,
      parseMermaidToExcalidraw: mermaid.parseMermaidToExcalidraw,
    }));
  }

  return convertersPromise;
}

// ------------------------------------------------------------
// Files
// ------------------------------------------------------------

function normalizeFiles(rawFiles = {}) {
  const ts = now();
  const out = {};

  for (const [id, file] of Object.entries(rawFiles || {})) {
    if (!file || !file.dataURL) continue;

    out[id] = {
      id: file.id || id,
      dataURL: file.dataURL,
      mimeType: file.mimeType || 'image/svg+xml',
      created: file.created || ts,
      lastRetrieved: ts,
    };
  }

  return out;
}

function tagAiElements(elements = [], source = 'mermaid') {
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;

    el.customData = {
      ...(el.customData || {}),
      yanta: {
        ...(el.customData?.yanta || {}),
        generatedBy: 'ai',
        source,
      },
    };
  }

  return elements;
}

// ------------------------------------------------------------
// Mermaid → editable Excalidraw elements
// ------------------------------------------------------------

export async function mermaidToDrawingScene(mermaidCode, { fontSize = 20 } = {}) {
  const definition = String(mermaidCode || '').trim();

  if (!definition) {
    throw new Error('Mermaid code is required.');
  }

  const { convertToExcalidrawElements, parseMermaidToExcalidraw } = await loadConverters();

  if (
    typeof parseMermaidToExcalidraw !== 'function' ||
    typeof convertToExcalidrawElements !== 'function'
  ) {
    throw new Error('Mermaid conversion is unavailable in this build.');
  }

  let skeleton;

  try {
    skeleton = await parseMermaidToExcalidraw(definition, {
      themeVariables: { fontSize: `${fontSize}px` },
    });
  } catch (err) {
    throw new Error(`Invalid Mermaid diagram: ${err?.message || 'could not be parsed.'}`);
  }

  const skeletonElements = Array.isArray(skeleton?.elements) ? skeleton.elements : [];

  if (!skeletonElements.length) {
    throw new Error('Mermaid produced no diagram elements.');
  }

  const elements = convertToExcalidrawElements(skeletonElements, {
    regenerateIds: true,
  });

  const files = normalizeFiles(skeleton?.files);

  // The Mermaid→Excalidraw converter emits a single image element for any
  // diagram type it cannot express as editable shapes (pie, gantt, mindmap…).
  const editable = !(elements.length === 1 && elements[0]?.type === 'image');

  const warnings = [];

  if (!editable) {
    warnings.push(
      'This Mermaid diagram type is not editable in Excalidraw and was inserted as a static image. '
      + 'Use flowchart, sequence or class diagrams for editable results.'
    );
  }

  tagAiElements(elements, 'mermaid');

  return {
    elements,
    files,
    editable,
    warnings,
  };
}

// ------------------------------------------------------------
// Inline SVG → single image element
// ------------------------------------------------------------

export function sanitizeSvgForDrawing(rawSvg = '') {
  const raw = String(rawSvg || '').trim();

  if (!raw) {
    throw new Error('SVG is required.');
  }

  if (!/^<svg[\s>]/i.test(raw)) {
    throw new Error('Only inline SVG starting with <svg> is supported.');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'image/svg+xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid SVG.');
  }

  const svg = doc.documentElement;

  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('Invalid SVG root.');
  }

  for (const node of [...svg.querySelectorAll('script, foreignObject, iframe, object, embed')]) {
    node.remove();
  }

  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '').trim().toLowerCase();

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }

      if (
        (name === 'href' || name.endsWith(':href')) &&
        value.startsWith('javascript:')
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  return new XMLSerializer().serializeToString(svg);
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function svgSize(svgText = '') {
  const width = Number(svgText.match(/\bwidth=["']?(\d+(?:\.\d+)?)/i)?.[1] || 0);
  const height = Number(svgText.match(/\bheight=["']?(\d+(?:\.\d+)?)/i)?.[1] || 0);

  const viewBox = svgText.match(/\bviewBox=["']([^"']+)["']/i)?.[1] || '';
  const vb = viewBox
    .split(/\s+/)
    .map(Number)
    .filter(Number.isFinite);

  return {
    width: Math.max(24, Math.min(2000, width || vb[2] || 320)),
    height: Math.max(24, Math.min(2000, height || vb[3] || 240)),
  };
}

export function svgToDrawingScene(rawSvg = '') {
  const safeSvg = sanitizeSvgForDrawing(rawSvg);
  const size = svgSize(safeSvg);
  const fileId = `svg_${uid()}`;

  const imageElement = {
    id: uid(),
    type: 'image',
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: now(),
    link: null,
    locked: false,
    fileId,
    scale: [1, 1],
    status: 'saved',
    customData: {
      yanta: {
        generatedBy: 'ai',
        source: 'svg',
      },
    },
  };

  return {
    elements: [imageElement],
    files: {
      [fileId]: {
        id: fileId,
        dataURL: svgToDataUrl(safeSvg),
        mimeType: 'image/svg+xml',
        created: now(),
        lastRetrieved: now(),
      },
    },
    svgBytes: new TextEncoder().encode(safeSvg).byteLength,
  };
}

// ------------------------------------------------------------
// Geometry
// ------------------------------------------------------------

export function sceneBounds(elements = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    if (!el || el.isDeleted) continue;

    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function translateSceneElements(elements = [], dx = 0, dy = 0) {
  if (!dx && !dy) return elements;

  for (const el of elements) {
    if (!el) continue;

    el.x = (Number(el.x) || 0) + dx;
    el.y = (Number(el.y) || 0) + dy;

    // Linear elements (arrows/lines) keep relative points, so only their
    // origin needs shifting.
  }

  return elements;
}
