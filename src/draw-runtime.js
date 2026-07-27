// ============================================================
// YANTA — Lazy runtime dependencies of the drawing surfaces.
//
// React and Excalidraw are heavy and must be loaded exactly once, no matter
// which drawing surface asks first (inline embed, fullscreen modal, selection
// menu, exporters). Keeping the loaders in their own module gives every
// consumer the same promise without importing draw.js — which would create an
// import cycle.
// ============================================================

let reactLibPromise = null;
let excalidrawLibPromise = null;

export async function loadReact() {
  if (!reactLibPromise) {
    reactLibPromise = Promise.all([
      import('react'),
      import('react-dom/client'),
    ]).then(([React, ReactDOM]) => ({ React, ReactDOM }));
  }

  return reactLibPromise;
}

function ensureExcalidrawAssetPath() {
  if (!window.EXCALIDRAW_ASSET_PATH) {
    window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
  }
}

export async function loadExcalidraw() {
  ensureExcalidrawAssetPath();

  if (!excalidrawLibPromise) {
    excalidrawLibPromise = Promise.all([
      import('@excalidraw/excalidraw'),
      import('@excalidraw/excalidraw/index.css'),
    ]).then(([mod]) => mod);
  }

  return excalidrawLibPromise;
}

export function currentExcalidrawTheme() {
  return document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'light';
}
