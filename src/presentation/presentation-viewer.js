import React from 'react';
import {
  createRoot,
} from 'react-dom/client';

import {
  Excalidraw,
} from '@excalidraw/excalidraw';

import '@excalidraw/excalidraw/index.css';

import {
  escapeHtml,
  lucide,
} from '../core.js';

import {
  getPresentationSession,
} from './presentation-api.js';

import {
  decryptPresentationPayload,
  parsePresentationKeyFromHash,
} from './presentation-crypto.js';

import {
  normalizeSlides,
  visibleElementsInSlide,
  makeVirtualElementForSlide,
  isSlideFrameElement,
} from '../slides/slides-model.js';

const SIGNALING_URL =
  import.meta.env.VITE_YANTA_SIGNALING_URL ||
  'wss://yanta-signaling-932960946294.europe-west1.run.app';

let payload = null;
let sessionResponse = null;
let api = null;
let root = null;
let ws = null;
let slides = [];
let index = 0;
let sendDraftTimer = 0;

let cameraRaf = 0;
let setViewerMode = null;
let laserHideTimer = 0;

function sessionIdFromPath(pathname = location.pathname) {
  const m = String(pathname || '').match(/^\/present\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function ensureExcalidrawAssetPath() {
  if (!window.EXCALIDRAW_ASSET_PATH) {
    window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
  }
}

function cleanAppState(appState = {}) {
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
    openMenu,
    openPopup,
    contextMenu,
    activeTool,
    pendingImageElementId,
    editingLinearElement,
    multiElement,
    selectionElement,
    errorMessage,
    ...rest
  } = appState || {};

  const out = { ...rest };

  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }

  return out;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);

  return x < 0.5
    ? 4 * x * x * x
    : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function zoomValue(appState = {}) {
  return Number(appState.zoom?.value ?? appState.zoom ?? 1) || 1;
}

function presentationElements(elements = []) {
  /*
    Meeting-room presentation view:
    Slide frames are structural authoring helpers.
    They must not be visible in the actual presentation.
  */
  return (Array.isArray(elements) ? elements : []).map((el) => {
    if (!el || !isSlideFrameElement(el)) return el;

    return {
      ...el,
      opacity: 0,
      locked: true,
      selected: false,
    };
  });
}

function editableDraftElements(elements = []) {
  /*
    Scoped Edit Mode:
    The meeting-room laptop edits only presentation content.
    Slide-frame authoring elements are never sent back as draft edits.
    Owner-side Apply merges these edits with the original private slide frames.
  */
  return (Array.isArray(elements) ? elements : [])
    .filter((el) => el && !isSlideFrameElement(el));
}

function applyElementsForMode(mode) {
  if (!api || !payload?.display?.drawing) return;

  const drawing = payload.display.drawing;

  api.updateScene({
    elements:
      mode === 'present'
        ? presentationElements(drawing.elements || [])
        : drawing.elements || [],
    files: drawing.files || {},
  });

  api.refresh?.();
}

function updatePresentationBodyMode(mode) {
  document.body.classList.toggle('is-yanta-presentation-presenting', mode === 'present');
  document.body.classList.toggle('is-yanta-presentation-editing', mode !== 'present');
}

function requestPresentationFullscreen() {
  const el =
    document.querySelector('.yanta-presentation-shell') ||
    document.documentElement;

  try {
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    }
  } catch {}
}

function exitPresentationFullscreen() {
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    }
  } catch {}
}

function sceneToScreen(sceneX, sceneY) {
  if (!api) return null;

  const host = document.querySelector('[data-presentation-stage]');
  const rect =
    host?.querySelector?.('.excalidraw')?.getBoundingClientRect?.() ||
    host?.getBoundingClientRect?.();

  if (!rect) return null;

  const appState = api.getAppState?.() || {};
  const zoom = zoomValue(appState);
  const scrollX = Number(appState.scrollX || 0);
  const scrollY = Number(appState.scrollY || 0);

  return {
    x: rect.left + (sceneX + scrollX) * zoom,
    y: rect.top + (sceneY + scrollY) * zoom,
  };
}

function slideUnitToScreen(data = {}) {
  const slide = slides[index];
  if (!slide) return null;

  const bounds = normalizeSlideBounds(slide.bounds);

  const sceneX = bounds.x + clamp(Number(data.x || 0), 0, 1) * bounds.width;
  const sceneY = bounds.y + clamp(Number(data.y || 0), 0, 1) * bounds.height;

  return sceneToScreen(sceneX, sceneY);
}

function ensureLaserDot() {
  let dot = document.querySelector('[data-presentation-laser-dot]');

  if (dot) return dot;

  dot = document.createElement('div');
  dot.className = 'yanta-presentation-laser-dot';
  dot.dataset.presentationLaserDot = '1';

  document.body.append(dot);

  return dot;
}

function showLaserDotAt(x, y) {
  const dot = ensureLaserDot();

  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  dot.classList.add('visible');

  clearTimeout(laserHideTimer);

  laserHideTimer = window.setTimeout(() => {
    dot.classList.remove('visible');
  }, 850);
}

function showLaserDotFromRemote(data = {}) {
  if (data.unit === 'slide') {
    const point = slideUnitToScreen(data);

    if (point) {
      showLaserDotAt(point.x, point.y);
    }
  }
}

function drawingViewportRect() {
  const host = document.querySelector('[data-presentation-stage]');
  const rect =
    host?.querySelector?.('.excalidraw')?.getBoundingClientRect?.() ||
    host?.getBoundingClientRect?.() ||
    null;

  if (rect && rect.width > 0 && rect.height > 0) {
    return rect;
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function slideCameraTarget(slide, {
  viewportZoomFactor = 0.84,
} = {}) {
  const rect = drawingViewportRect();
  const bounds = normalizeSlideBounds(slide.bounds);

  const zoom = clamp(
    Math.min(
      (rect.width * viewportZoomFactor) / Math.max(1, bounds.width),
      (rect.height * viewportZoomFactor) / Math.max(1, bounds.height)
    ),
    0.04,
    4
  );

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    scrollX: rect.width / (2 * zoom) - centerX,
    scrollY: rect.height / (2 * zoom) - centerY,
    zoom: {
      value: zoom,
    },
  };
}

function currentCamera() {
  const appState = api?.getAppState?.() || {};

  return {
    scrollX: Number(appState.scrollX || 0),
    scrollY: Number(appState.scrollY || 0),
    zoom: zoomValue(appState),
  };
}

function applyCamera(camera) {
  if (!api || !camera) return;

  api.updateScene({
    appState: {
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: {
        value: camera.zoom,
      },
    },
  });
}

function animateCameraToSlide(slide, {
  duration = 520,
} = {}) {
  if (!api || !slide) return;

  cancelAnimationFrame(cameraRaf);
  cameraRaf = 0;

  const target = slideCameraTarget(slide);

  const to = {
    scrollX: target.scrollX,
    scrollY: target.scrollY,
    zoom: target.zoom.value,
  };

  if (prefersReducedMotion() || duration <= 0) {
    applyCamera(to);
    api.refresh?.();
    return;
  }

  const from = currentCamera();
  const start = performance.now();

  const tick = () => {
    const t = clamp((performance.now() - start) / duration, 0, 1);
    const k = easeInOutCubic(t);

    applyCamera({
      scrollX: from.scrollX + (to.scrollX - from.scrollX) * k,
      scrollY: from.scrollY + (to.scrollY - from.scrollY) * k,
      zoom: from.zoom + (to.zoom - from.zoom) * k,
    });

    if (t < 1) {
      cameraRaf = requestAnimationFrame(tick);
      return;
    }

    cameraRaf = 0;
    applyCamera(to);
    api.refresh?.();
  };

  cameraRaf = requestAnimationFrame(tick);
}

function goToSlide(nextIndex, {
  notifyOwner = true,
  animated = true,
} = {}) {
  if (!api || !slides.length) return;

  index = Math.max(0, Math.min(slides.length - 1, Number(nextIndex || 0)));

  const slide = slides[index];

  animateCameraToSlide(slide, {
    duration: animated ? 560 : 0,
  });

  updateTopbar();

  if (notifyOwner) {
    sendSignal({
      kind: 'slide',
      index,
    });
  }
}

function nextSlide() {
  goToSlide(index + 1);
}

function prevSlide() {
  goToSlide(index - 1);
}

function sendSignal(data = {}) {
  const sig = payload?.signaling;

  if (!ws || ws.readyState !== WebSocket.OPEN || !sig?.topic || !sig?.token) return;

  ws.send(JSON.stringify({
    type: 'publish',
    topic: sig.topic,
    data: {
      ...data,
      token: sig.token,
    },
  }));
}

function connectSocket() {
  const sig = payload?.signaling;

  if (!sig?.topic || !sig?.token) return;

  ws = new WebSocket(SIGNALING_URL);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      type: 'subscribe',
      topics: [sig.topic],
    }));

    sendSignal({
      kind: 'hello',
    });
  });

  ws.addEventListener('message', (event) => {
    let msg = null;

    try {
      msg = JSON.parse(event.data);
    } catch {}

    const data = msg?.data;
    if (!data || data.token !== sig.token) return;

    if (data.kind === 'go') {
      goToSlide(Number(data.index || 0), {
        notifyOwner: false,
      });
      return;
    }

    if (data.kind === 'next') {
      nextSlide();
      return;
    }

    if (data.kind === 'prev') {
      prevSlide();
      return;
    }

    if (data.kind === 'laser') {
      showLaserDotFromRemote(data);
      return;
    }
    if (data.kind === 'discard-draft') {
      renderNotice('Owner discarded the current draft.');
      return;
    }

    if (data.kind === 'draft-applied') {
      renderNotice('Owner applied your edits to the original drawing.');
      return;
    }

    if (data.kind === 'end') {
      renderState('Presentation ended', 'The owner ended this session.');
    }
  });
}

function scheduleDraftSend(elements, appState, files) {
  clearTimeout(sendDraftTimer);

  sendDraftTimer = window.setTimeout(() => {
    sendSignal({
      kind: 'draft',
      draft: {
        elements: elements || [],
        appState: cleanAppState(appState || {}),
        files: files || {},
        updatedAt: Date.now(),
      },
    });
  }, 900);
}

function injectCss() {
  if (document.getElementById('yanta-presentation-viewer-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-presentation-viewer-css';
  style.textContent = `
html.yanta-presentation-page,
body.yanta-presentation-page {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: #141414;
  color: #e8e6e3;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.yanta-presentation-shell {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #141414;
  color: #e8e6e3;
}

.yanta-presentation-top {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: max(6px, env(safe-area-inset-top)) 10px 6px;
  border-bottom: 1px solid #333;
  background: #1c1c1c;
  z-index: 10;
}

.yanta-presentation-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 800;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-presentation-stage {
  flex: 1;
  min-height: 0;
  position: relative;
}

.yanta-presentation-stage .excalidraw {
  width: 100%;
  height: 100%;
}

.yanta-presentation-btn {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid #333;
  border-radius: 8px;
  background: #242424;
  color: #e8e6e3;
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;
}

.yanta-presentation-btn.primary {
  background: #6ea8fe;
  border-color: #6ea8fe;
  color: white;
}

.yanta-presentation-state {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  background: #141414;
}

.yanta-presentation-state-card {
  max-width: 520px;
  padding: 24px;
  border: 1px solid #333;
  border-radius: 16px;
  background: #1c1c1c;
  text-align: center;
}

.yanta-presentation-toast {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  padding: 10px 14px;
  border-radius: 999px;
  background: #242424;
  color: #e8e6e3;
  border: 1px solid #333;
  z-index: 50;
  font-size: 13px;
  box-shadow: 0 18px 50px rgba(0,0,0,.4);
}

.yanta-presentation-shell.is-presenting .yanta-presentation-top {
  display: none !important;
}

.yanta-presentation-shell.is-presenting .excalidraw .App-toolbar,
.yanta-presentation-shell.is-presenting .excalidraw .FixedSideContainer,
.yanta-presentation-shell.is-presenting .excalidraw .HintViewer,
.yanta-presentation-shell.is-presenting .excalidraw .help-icon,
.yanta-presentation-shell.is-presenting .excalidraw .layer-ui__wrapper__top-right,
.yanta-presentation-shell.is-presenting .excalidraw .layer-ui__wrapper__footer-right,
.yanta-presentation-shell.is-presenting .excalidraw .layer-ui__wrapper__footer-left,
.yanta-presentation-shell.is-presenting .excalidraw .Island,
.yanta-presentation-shell.is-presenting .excalidraw .App-menu,
.yanta-presentation-shell.is-presenting .excalidraw .Stack_vertical {
  display: none !important;
  pointer-events: none !important;
}

.yanta-presentation-shell.is-presenting .excalidraw {
  --color-primary: #6ea8fe;
}

.yanta-presentation-present-hint {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 30;

  padding: 8px 12px;
  border: 1px solid #333;
  border-radius: 999px;

  background: rgba(28,28,28,.86);
  color: #9a9794;

  font-size: 12px;
  font-weight: 750;

  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  opacity: 0;
  pointer-events: none;

  animation: yantaPresentHint 3.2s ease forwards;
}

@keyframes yantaPresentHint {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }

  12% {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  72% {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  100% {
    opacity: 0;
    transform: translateX(-50%) translateY(-6px);
  }
}

.yanta-presentation-laser-dot {
  position: fixed;
  z-index: 60;

  width: 20px;
  height: 20px;
  margin-left: -10px;
  margin-top: -10px;

  border-radius: 999px;
  background: #ff3b30;

  box-shadow:
    0 0 0 5px rgba(255,59,48,.18),
    0 0 26px rgba(255,59,48,.76);

  opacity: 0;
  transform: scale(.82);

  pointer-events: none;

  transition:
    opacity 80ms ease,
    transform 80ms ease;
}

.yanta-presentation-laser-dot.visible {
  opacity: 1;
  transform: scale(1);
}
  `;

  document.head.append(style);
}

function renderNotice(text) {
  const old = document.querySelector('.yanta-presentation-toast');
  old?.remove();

  const node = document.createElement('div');
  node.className = 'yanta-presentation-toast';
  node.textContent = text;

  document.body.append(node);

  window.setTimeout(() => {
    node.remove();
  }, 2600);
}

function updateTopbar() {
  const title = document.querySelector('[data-presentation-title]');
  const count = document.querySelector('[data-presentation-count]');

  const source = payload?.source || {};
  const slide = slides[index] || null;

  if (title) {
    title.textContent = slide?.title || source.drawingTitle || 'YANTA Presentation';
  }

  if (count) {
    count.textContent = slides.length
      ? `${index + 1} / ${slides.length}`
      : 'No slides';
  }
}

function renderState(title, message) {
  document.body.innerHTML = `
    <div class="yanta-presentation-state">
      <main class="yanta-presentation-state-card">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </main>
    </div>
  `;
}

function PresentationApp() {
  const drawing = payload.display.drawing;
  const [mode, setMode] = React.useState('present');

  React.useEffect(() => {
    setViewerMode = setMode;

    return () => {
      if (setViewerMode === setMode) {
        setViewerMode = null;
      }
    };
  }, []);

  React.useEffect(() => {
    updatePresentationBodyMode(mode);
    applyElementsForMode(mode);

    if (slides[index]) {
      goToSlide(index, {
        notifyOwner: false,
        animated: false,
      });
    }
  }, [mode]);

  return React.createElement('div', {
    className: `yanta-presentation-shell ${mode === 'present' ? 'is-presenting' : 'is-editing'}`,
  }, [
    React.createElement('header', {
      className: 'yanta-presentation-top',
      key: 'top',
    }, [
      React.createElement('span', {
        key: 'icon',
        dangerouslySetInnerHTML: {
          __html: lucide('presentation', 17),
        },
      }),

      React.createElement('div', {
        className: 'yanta-presentation-title',
        key: 'title',
        'data-presentation-title': '1',
      }, payload.display.title || 'YANTA Presentation'),

      React.createElement('span', {
        key: 'count',
        'data-presentation-count': '1',
        style: {
          color: '#9a9794',
          fontSize: '12px',
          minWidth: '72px',
          textAlign: 'center',
        },
      }, ''),

      React.createElement('button', {
        key: 'prev',
        className: 'yanta-presentation-btn',
        onClick: prevSlide,
      }, 'Prev'),

      React.createElement('button', {
        key: 'next',
        className: 'yanta-presentation-btn primary',
        onClick: nextSlide,
      }, 'Next'),

      React.createElement('button', {
        key: 'present',
        className: 'yanta-presentation-btn',
        onClick: () => {
          setMode('present');
          goToSlide(index, {
            notifyOwner: true,
            animated: false,
          });
        },
      }, 'Present'),

      React.createElement('button', {
        key: 'edit',
        className: 'yanta-presentation-btn',
        onClick: () => {
          setMode('edit');
        },
      }, 'Edit copy'),

      React.createElement('button', {
        key: 'fullscreen',
        className: 'yanta-presentation-btn',
        onClick: () => {
          requestPresentationFullscreen();
          setMode('present');
        },
      }, 'Fullscreen'),
    ]),

    mode === 'present'
      ? React.createElement('div', {
          key: 'hint',
          className: 'yanta-presentation-present-hint',
        }, 'Press Esc for controls')
      : null,

    React.createElement('main', {
      className: 'yanta-presentation-stage',
      key: 'stage',
      'data-presentation-stage': '1',
    }, React.createElement(Excalidraw, {
      initialData: {
        elements: presentationElements(drawing.elements || []),
        appState: {
          ...(drawing.appState || {}),
          collaborators: new Map(),
        },
        files: drawing.files || {},
      },

      excalidrawAPI(nextApi) {
        api = nextApi;

        requestAnimationFrame(() => {
          api?.refresh?.();

          if (slides.length) {
            goToSlide(0, {
              notifyOwner: true,
              animated: false,
            });
          }
        });
      },

      UIOptions: {
        canvasActions: {
          loadScene: false,
          saveAsImage: false,
          export: false,
          clearCanvas: mode !== 'present',
          toggleTheme: false,
        },
      },

      viewModeEnabled: mode === 'present',
      zenModeEnabled: mode === 'present',
      detectScroll: true,
      autoFocus: true,

      onChange(elements, appState, files) {
        if (mode === 'present') return;

        scheduleDraftSend(
          editableDraftElements(elements || []),
          appState,
          files
        );
      },
    })),
  ]);
}

export async function mountPresentationViewer() {
  document.documentElement.classList.add('yanta-presentation-page');
  document.body.classList.add('yanta-presentation-page');

  ensureExcalidrawAssetPath();
  injectCss();

  document.body.innerHTML = `
    <div class="yanta-presentation-state">
      <main class="yanta-presentation-state-card">
        <h1>Loading presentation…</h1>
        <p>Decrypting in this browser.</p>
      </main>
    </div>
  `;

  try {
    const sessionId = sessionIdFromPath();
    const key = parsePresentationKeyFromHash();

    if (!sessionId) {
      throw new Error('Missing presentation session id.');
    }

    sessionResponse = await getPresentationSession(sessionId);
    payload = await decryptPresentationPayload(key, sessionResponse.encryptedPayload);

    if (payload?.kind !== 'yanta-presentation-session') {
      throw new Error('Unsupported presentation payload.');
    }

    slides = normalizeSlides(payload.display?.slides || []).filter((s) => !s.hidden);
    index = 0;

    document.body.innerHTML = '<div id="presentationRoot"></div>';

    root = createRoot(document.getElementById('presentationRoot'));
    root.render(React.createElement(PresentationApp));

    connectSocket();

    window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        /*
        UX rule:
        Esc exits presentation/fullscreen UI first.
        It does NOT end the meeting-room session.
        */
        e.preventDefault();
        e.stopPropagation();

        exitPresentationFullscreen();

        if (setViewerMode) {
        setViewerMode('edit');
        }

        return;
    }

    const target = e.target instanceof Element ? e.target : null;

    if (
        target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    ) {
        return;
    }

    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        nextSlide();
    }

    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        prevSlide();
    }

    if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        requestPresentationFullscreen();

        if (setViewerMode) {
        setViewerMode('present');
        }
    }
    }, true);

    window.addEventListener('resize', () => {
      api?.refresh?.();

      if (slides[index]) {
        goToSlide(index, {
          notifyOwner: false,
        });
      }
    });
  } catch (err) {
    console.error('[YANTA Presentation] viewer failed', err);
    renderState('Could not open presentation', err?.message || String(err));
  }
}