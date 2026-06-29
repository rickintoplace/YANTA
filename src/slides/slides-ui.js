// ============================================================
// YANTA Slides — UI, Slideshow, Laser, Remote QR
// ============================================================

import {
    state,
    toast,
    lucide,
    escapeHtml,
    escapeAttr,
    uid,
  } from '../core.js';
  
  import {
    renderBrandedQrSvg,
  } from '../qr.js';
  
  import {
    BRAND_LOGO_SVG,
  } from '../brand-logo.js';
  
  import {
    getDrawing,
  } from '../yjs.js';
  
  import {
    listSlides,
    createSlide,
    updateSlide,
    deleteSlide,
    setSlideNotes,
    syncSlidesFromScene,
    drawingRef,
  } from './slides-store.js';
  
  import {
    makeVirtualElementForSlide,
    normalizeSlideBounds,
  } from './slides-model.js';
  
  import {
    exportDrawingSlidesToPdf,
  } from './slides-export.js';
  
  import {
    getDrawingApiForEmbed,
    getActiveDrawingApi,
    getActiveDrawingHost,
  } from '../draw.js';
  
  const SIGNALING_URL =
    import.meta.env.VITE_YANTA_SIGNALING_URL ||
    'wss://yanta-signaling-932960946294.europe-west1.run.app';
  
  let cssInjected = false;
  let slideshow = null;
  let remoteSocket = null;
  let remoteTopic = '';
  let remoteToken = '';
  
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
  
    const style = document.createElement('style');
    style.id = 'yanta-slides-css';
    style.textContent = `
  .yanta-slides-panel {
    border-top: 1px solid var(--border);
    background: var(--bg-elev-2);
    padding: 7px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  
  .yanta-slides-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  
  .yanta-slides-actions .btn {
    min-height: 28px;
    padding: 4px 8px;
    font-size: 11px;
  }
  
  .yanta-slides-strip {
    display: flex;
    align-items: stretch;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  
  .yanta-slide-chip {
    min-width: 116px;
    max-width: 160px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elev);
    color: var(--text);
    padding: 7px 8px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 7px;
    align-items: center;
    cursor: pointer;
    text-align: left;
  }
  
  .yanta-slide-chip:hover,
  .yanta-slide-chip.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev));
  }
  
  .yanta-slide-chip-num {
    width: 21px;
    height: 21px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    font-size: 11px;
    font-weight: 850;
  }
  
  .yanta-slide-chip-title {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12px;
    font-weight: 750;
  }
  
  .yanta-slide-chip-menu {
    opacity: .72;
  }
  
  .yanta-slide-draw-overlay {
    position: absolute;
    inset: 0;
    z-index: 40;
    cursor: crosshair;
    background: color-mix(in srgb, var(--accent) 4%, transparent);
  }
  
  .yanta-slide-draw-rect {
    position: fixed;
    pointer-events: none;
    z-index: 9999;
    border: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 10px;
    box-shadow: 0 0 0 1px rgba(255,255,255,.14) inset;
  }
  
  .yanta-slideshow {
    position: fixed;
    inset: 0;
    z-index: 390;
    pointer-events: none;
  }
  
  .yanta-slideshow-toolbar {
    position: fixed;
    left: 50%;
    bottom: max(18px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 16px 50px rgba(0,0,0,.34);
  }
  
  .yanta-slideshow-toolbar .btn,
  .yanta-slideshow-toolbar .icon-btn {
    pointer-events: auto;
  }
  
  .yanta-slideshow-count {
    min-width: 88px;
    color: var(--text-dim);
    font-size: 12px;
    text-align: center;
    font-weight: 750;
  }
  
  .yanta-slideshow-notes {
    position: fixed;
    right: max(16px, env(safe-area-inset-right));
    top: max(16px, env(safe-area-inset-top));
    width: min(360px, calc(100vw - 32px));
    max-height: min(60vh, 540px);
    pointer-events: auto;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--bg-elev) 94%, transparent);
    color: var(--text);
    backdrop-filter: blur(12px);
    overflow: hidden;
    box-shadow: 0 20px 70px rgba(0,0,0,.38);
  }
  
  .yanta-slideshow-notes-head {
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 11px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev-2);
  }
  
  .yanta-slideshow-notes-head strong {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  
  .yanta-slideshow-notes textarea {
    width: 100%;
    min-height: 180px;
    max-height: 48vh;
    resize: vertical;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    line-height: 1.55;
    padding: 12px;
    box-sizing: border-box;
  }
  
  .yanta-laser-layer {
    position: fixed;
    inset: 0;
    z-index: 391;
    pointer-events: none;
  }
  
  .yanta-laser-dot {
    position: fixed;
    width: 18px;
    height: 18px;
    margin-left: -9px;
    margin-top: -9px;
    border-radius: 999px;
    background: #ff3b30;
    box-shadow:
      0 0 0 4px rgba(255,59,48,.18),
      0 0 24px rgba(255,59,48,.72);
    opacity: 0;
    transform: scale(.8);
    transition: opacity 80ms ease, transform 80ms ease;
  }
  
  .yanta-laser-dot.visible {
    opacity: 1;
    transform: scale(1);
  }
  
  .yanta-slides-remote-modal,
  .yanta-slides-remote-screen {
    position: fixed;
    inset: 0;
    z-index: 530;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(0,0,0,.58);
    backdrop-filter: blur(8px);
  }
  
  .yanta-slides-remote-card,
  .yanta-slides-remote-phone {
    width: min(460px, 94vw);
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--bg-elev);
    color: var(--text);
    box-shadow: 0 28px 90px rgba(0,0,0,.48);
    overflow: hidden;
  }
  
  .yanta-slides-remote-card header,
  .yanta-slides-remote-phone header {
    min-height: 52px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-elev-2);
    border-bottom: 1px solid var(--border);
  }
  
  .yanta-slides-remote-card header h3,
  .yanta-slides-remote-phone header h3 {
    flex: 1;
    margin: 0;
    font-size: 15px;
  }
  
  .yanta-slides-remote-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .yanta-slides-remote-qr {
    display: flex;
    justify-content: center;
    padding: 16px;
    border-radius: 16px;
    background: white;
  }
  
  .yanta-slides-remote-controls {
    padding: 18px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  
  .yanta-slides-remote-controls button {
    min-height: 92px;
    border-radius: 18px;
    font-size: 18px;
    font-weight: 850;
  }
  
  .yanta-slides-remote-laserpad {
    grid-column: 1 / -1;
    min-height: 220px;
    border: 1px dashed var(--border-strong);
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
    touch-action: none;
    user-select: none;
  }
  
  .yanta-slides-embed {
    margin: 12px 0;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--bg-elev-2);
  }
  
  .yanta-slides-embed-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  .yanta-slides-embed-head strong {
    flex: 1;
    min-width: 0;
  }
    `;
  
    document.head.append(style);
  }
  
  function screenToScene(api, clientX, clientY) {
    try {
      if (api?.screenToSceneCoords) {
        const p = api.screenToSceneCoords({
          clientX,
          clientY,
        });
  
        if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
          return p;
        }
  
        const p2 = api.screenToSceneCoords({
          x: clientX,
          y: clientY,
        });
  
        if (Number.isFinite(p2?.x) && Number.isFinite(p2?.y)) {
          return p2;
        }
      }
    } catch {}
  
    return {
      x: clientX,
      y: clientY,
    };
  }
  
  function scrollToSlide(api, slide) {
    if (!api || !slide) return;
  
    const virtual = makeVirtualElementForSlide(slide);
  
    try {
      api.scrollToContent?.([virtual], {
        fitToContent: true,
        animate: true,
        viewportZoomFactor: 0.84,
      });
      return;
    } catch {}
  
    try {
      api.updateScene({
        appState: {
          scrollX: -slide.bounds.x + 80,
          scrollY: -slide.bounds.y + 80,
        },
      });
    } catch {}
  }
  
  function currentApiForDrawing(noteId, drawingId) {
    const fullscreenApi = getActiveDrawingApi?.();
  
    if (
      fullscreenApi &&
      slideshow?.drawingId === drawingId &&
      slideshow?.noteId === noteId
    ) {
      return fullscreenApi;
    }
  
    const embed = document.querySelector(
      `.yanta-draw-embed[data-draw-id="${CSS.escape(drawingId)}"][data-note-id="${CSS.escape(noteId)}"]`
    );
  
    return embed ? getDrawingApiForEmbed(embed) : null;
  }
  
  function contextFromEmbed(embed) {
    const drawingId = embed?.dataset?.drawId || '';
    const preferredNoteId = embed?.dataset?.noteId || state.currentNoteId || '';
    const ref = drawingRef(preferredNoteId, drawingId);
  
    if (!ref) return null;
  
    return {
      noteId: ref.noteId,
      drawingId,
      drawing: ref.drawing,
      api: getDrawingApiForEmbed(embed),
      container: embed.querySelector('.yanta-draw-inline-host') || embed,
    };
  }
  
  function enhanceDrawingEmbed(embed) {
    injectCss();
  
    if (!embed || embed.dataset.slidesEnhanced === '1') {
      refreshSlidesPanel(embed);
      return;
    }
  
    embed.dataset.slidesEnhanced = '1';
  
    const panel = document.createElement('div');
    panel.className = 'yanta-slides-panel';
    panel.dataset.slidesPanel = '1';
  
    const host = embed.querySelector('.yanta-draw-inline-host');
    if (host) {
      embed.insertBefore(panel, host);
    } else {
      embed.append(panel);
    }
  
    refreshSlidesPanel(embed);
  }
  
  function refreshSlidesPanel(embed) {
    if (!embed) return;
  
    const panel = embed.querySelector('[data-slides-panel]');
    if (!panel) return;
  
    const ctx = contextFromEmbed(embed);
  
    if (!ctx) {
      panel.innerHTML = '';
      return;
    }
  
    const slides = syncSlidesFromScene(ctx.noteId, ctx.drawingId, ctx.api);
  
    panel.innerHTML = `
      <div class="yanta-slides-actions">
        <button class="btn" data-slides-action="draw">${lucide('scan', 13)} Add slide</button>
        <button class="btn primary" data-slides-action="present">${lucide('presentation', 13)} Present</button>
        <button class="btn" data-slides-action="pdf">${lucide('file-down', 13)} PDF</button>
        <button class="btn" data-slides-action="remote">${lucide('qr-code', 13)} Remote</button>
        <span style="flex:1"></span>
        <small style="color:var(--text-faint)">${slides.length} slide${slides.length === 1 ? '' : 's'}</small>
      </div>
  
      <div class="yanta-slides-strip">
        ${
          slides.length
            ? slides.map((slide, index) => `
                <button class="yanta-slide-chip" data-slide-id="${escapeAttr(slide.id)}">
                  <span class="yanta-slide-chip-num">${index + 1}</span>
                  <span class="yanta-slide-chip-title">${escapeHtml(slide.title)}</span>
                  <span class="yanta-slide-chip-menu">${lucide('chevron-right', 13)}</span>
                </button>
              `).join('')
            : `<div style="color:var(--text-faint);font-size:12px;padding:4px 2px">
                Draw a slide around part of the canvas.
              </div>`
        }
      </div>
    `;
  
    panel.querySelector('[data-slides-action="draw"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
  
      const api = getDrawingApiForEmbed(embed);
  
      if (!api) {
        toast('Drawing is not ready yet', 'error');
        return;
      }
  
      startSlideDrawMode({
        noteId: ctx.noteId,
        drawingId: ctx.drawingId,
        api,
        container: ctx.container,
        onDone: () => refreshSlidesPanel(embed),
      });
    });
  
    panel.querySelector('[data-slides-action="present"]')?.addEventListener('click', () => {
      startSlideshow({
        noteId: ctx.noteId,
        drawingId: ctx.drawingId,
        api: getDrawingApiForEmbed(embed),
        container: ctx.container,
      });
    });
  
    panel.querySelector('[data-slides-action="pdf"]')?.addEventListener('click', () => {
      exportDrawingSlidesToPdf(ctx.noteId, ctx.drawingId);
    });
  
    panel.querySelector('[data-slides-action="remote"]')?.addEventListener('click', () => {
      ensureSlideshowForRemote(ctx);
      openRemoteQrModal();
    });
  
    panel.querySelectorAll('[data-slide-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slide = listSlides(ctx.noteId, ctx.drawingId)
          .find((s) => s.id === btn.dataset.slideId);
  
        scrollToSlide(getDrawingApiForEmbed(embed), slide);
      });
  
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openSlideMiniMenu(e.clientX, e.clientY, {
          noteId: ctx.noteId,
          drawingId: ctx.drawingId,
          slideId: btn.dataset.slideId,
          api: getDrawingApiForEmbed(embed),
          refresh: () => refreshSlidesPanel(embed),
        });
      });
    });
  }
  
  function openSlideMiniMenu(x, y, {
    noteId,
    drawingId,
    slideId,
    api,
    refresh,
  }) {
    const slide = listSlides(noteId, drawingId).find((s) => s.id === slideId);
    if (!slide) return;
  
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.zIndex = '540';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  
    menu.innerHTML = `
      <button data-action="rename">${lucide('pencil', 14)} Rename</button>
      <button data-action="notes">${lucide('notebook-text', 14)} Speaker notes</button>
      <hr>
      <button class="danger" data-action="delete">${lucide('trash', 14)} Delete slide</button>
    `;
  
    document.body.append(menu);
  
    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', outside, true);
    };
  
    const outside = (e) => {
      if (menu.contains(e.target)) return;
      close();
    };
  
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
    });
  
    menu.querySelector('[data-action="rename"]')?.addEventListener('click', () => {
      close();
  
      const title = prompt('Slide title', slide.title);
      if (title != null) {
        updateSlide(noteId, drawingId, slideId, {
          title: title.trim() || slide.title,
        });
        refresh?.();
      }
    });
  
    menu.querySelector('[data-action="notes"]')?.addEventListener('click', () => {
      close();
  
      const notes = prompt('Speaker notes', slide.notes?.markdown || '');
      if (notes != null) {
        setSlideNotes(noteId, drawingId, slideId, notes);
        refresh?.();
      }
    });
  
    menu.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
      close();
  
      if (confirm(`Delete "${slide.title}"?`)) {
        deleteSlide(noteId, drawingId, slideId, {
          deleteFrame: true,
          api,
        });
  
        refresh?.();
      }
    });
  }
  
  function startSlideDrawMode({
    noteId,
    drawingId,
    api,
    container,
    onDone,
  }) {
    injectCss();
  
    if (!container) return;
  
    const overlay = document.createElement('div');
    overlay.className = 'yanta-slide-draw-overlay';
    overlay.title = 'Drag to create a slide';
  
    const rect = document.createElement('div');
    rect.className = 'yanta-slide-draw-rect';
    rect.hidden = true;
  
    document.body.append(rect);
    container.append(overlay);
  
    let start = null;
    let latest = null;
  
    const cleanup = () => {
      overlay.remove();
      rect.remove();
    };
  
    overlay.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
  
      start = {
        clientX: e.clientX,
        clientY: e.clientY,
        scene: screenToScene(api, e.clientX, e.clientY),
      };
  
      latest = start;
      rect.hidden = false;
  
      try {
        overlay.setPointerCapture?.(e.pointerId);
      } catch {}
    });
  
    overlay.addEventListener('pointermove', (e) => {
      if (!start) return;
  
      e.preventDefault();
      e.stopPropagation();
  
      latest = {
        clientX: e.clientX,
        clientY: e.clientY,
        scene: screenToScene(api, e.clientX, e.clientY),
      };
  
      const left = Math.min(start.clientX, latest.clientX);
      const top = Math.min(start.clientY, latest.clientY);
      const width = Math.abs(latest.clientX - start.clientX);
      const height = Math.abs(latest.clientY - start.clientY);
  
      Object.assign(rect.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    });
  
    overlay.addEventListener('pointerup', (e) => {
      if (!start || !latest) {
        cleanup();
        return;
      }
  
      e.preventDefault();
      e.stopPropagation();
  
      const x1 = Math.min(start.scene.x, latest.scene.x);
      const y1 = Math.min(start.scene.y, latest.scene.y);
      const x2 = Math.max(start.scene.x, latest.scene.x);
      const y2 = Math.max(start.scene.y, latest.scene.y);
  
      const bounds = normalizeSlideBounds({
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
      });
  
      cleanup();
  
      if (bounds.width < 80 || bounds.height < 60) {
        toast('Slide is too small', 'error');
        return;
      }
  
      const slide = createSlide(noteId, drawingId, {
        bounds,
        api,
      });
  
      if (slide) {
        toast(`Created ${slide.title}`, 'success');
        onDone?.(slide);
      }
    });
  
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        cleanup();
      }
    });
  }
  
  function ensureSlideshowForRemote(ctx) {
    if (!slideshow || slideshow.noteId !== ctx.noteId || slideshow.drawingId !== ctx.drawingId) {
      startSlideshow({
        noteId: ctx.noteId,
        drawingId: ctx.drawingId,
        api: ctx.api,
        container: ctx.container,
        silent: true,
      });
    }
  }
  
  export function startSlideshow({
    noteId,
    drawingId,
    api = null,
    container = null,
    startIndex = 0,
    silent = false,
  } = {}) {
    injectCss();
  
    const slides = listSlides(noteId, drawingId).filter((s) => !s.hidden);
    const drawing = getDrawing(noteId, drawingId);
  
    if (!drawing || !slides.length) {
      if (!silent) toast('No slides defined yet', 'error');
      return null;
    }
  
    stopSlideshow();
  
    const root = document.createElement('div');
    root.className = 'yanta-slideshow';
  
    const toolbar = document.createElement('div');
    toolbar.className = 'yanta-slideshow-toolbar';
  
    toolbar.innerHTML = `
      <button class="icon-btn" data-slide-prev title="Previous">${lucide('chevron-left', 18)}</button>
      <span class="yanta-slideshow-count" data-slide-count></span>
      <button class="icon-btn" data-slide-next title="Next">${lucide('chevron-right', 18)}</button>
      <button class="icon-btn" data-slide-laser title="Laser">${lucide('mouse-pointer-2', 17)}</button>
      <button class="icon-btn" data-slide-notes title="Notes">${lucide('notebook-text', 17)}</button>
      <button class="icon-btn" data-slide-remote title="Remote">${lucide('qr-code', 17)}</button>
      <button class="icon-btn" data-slide-exit title="Exit">${lucide('x', 17)}</button>
    `;
  
    const laserLayer = document.createElement('div');
    laserLayer.className = 'yanta-laser-layer';
    laserLayer.innerHTML = `<div class="yanta-laser-dot" data-laser-dot></div>`;
  
    root.append(toolbar, laserLayer);
    document.body.append(root);
  
    slideshow = {
      noteId,
      drawingId,
      api: api || currentApiForDrawing(noteId, drawingId),
      container,
      slides,
      index: Math.max(0, Math.min(slides.length - 1, startIndex)),
      root,
      toolbar,
      laserLayer,
      laserEnabled: false,
      notesOpen: false,
      notesEl: null,
    };
  
    toolbar.querySelector('[data-slide-prev]')?.addEventListener('click', previousSlide);
    toolbar.querySelector('[data-slide-next]')?.addEventListener('click', nextSlide);
    toolbar.querySelector('[data-slide-exit]')?.addEventListener('click', stopSlideshow);
    toolbar.querySelector('[data-slide-laser]')?.addEventListener('click', toggleLaser);
    toolbar.querySelector('[data-slide-notes]')?.addEventListener('click', toggleNotes);
    toolbar.querySelector('[data-slide-remote]')?.addEventListener('click', openRemoteQrModal);
  
    document.addEventListener('keydown', slideshowKeyHandler, true);
    document.addEventListener('pointermove', laserPointerMove, true);
  
    goToSlide(slideshow.index, {
      notifyRemote: false,
    });
  
    return slideshow;
  }
  
  export function stopSlideshow() {
    if (!slideshow) return;
  
    document.removeEventListener('keydown', slideshowKeyHandler, true);
    document.removeEventListener('pointermove', laserPointerMove, true);
  
    slideshow.notesEl?.remove();
    slideshow.root?.remove();
  
    closeRemoteSocket();
  
    slideshow = null;
  }
  
  function slideshowKeyHandler(e) {
    if (!slideshow) return;
  
    if (e.key === 'Escape') {
      e.preventDefault();
      stopSlideshow();
      return;
    }
  
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      nextSlide();
      return;
    }
  
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      previousSlide();
      return;
    }
  
    if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      toggleLaser();
      return;
    }
  
    if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      toggleNotes();
    }
  }
  
  function goToSlide(index, {
    notifyRemote = true,
  } = {}) {
    if (!slideshow) return;
  
    slideshow.index = Math.max(0, Math.min(slideshow.slides.length - 1, index));
  
    const slide = slideshow.slides[slideshow.index];
  
    const api =
      slideshow.api ||
      currentApiForDrawing(slideshow.noteId, slideshow.drawingId);
  
    slideshow.api = api;
  
    scrollToSlide(api, slide);
  
    const count = slideshow.toolbar.querySelector('[data-slide-count]');
    if (count) {
      count.textContent = `${slideshow.index + 1} / ${slideshow.slides.length}`;
    }
  
    updateNotesPanel();
  
    if (notifyRemote) {
      publishRemoteState();
    }
  }
  
  function nextSlide() {
    if (!slideshow) return;
    goToSlide(slideshow.index + 1);
  }
  
  function previousSlide() {
    if (!slideshow) return;
    goToSlide(slideshow.index - 1);
  }
  
  function toggleLaser() {
    if (!slideshow) return;
  
    slideshow.laserEnabled = !slideshow.laserEnabled;
  
    const btn = slideshow.toolbar.querySelector('[data-slide-laser]');
    btn?.classList.toggle('active', slideshow.laserEnabled);
  
    if (!slideshow.laserEnabled) {
      const dot = slideshow.root.querySelector('[data-laser-dot]');
      dot?.classList.remove('visible');
    }
  }
  
  function laserPointerMove(e) {
    if (!slideshow?.laserEnabled) return;
  
    const dot = slideshow.root.querySelector('[data-laser-dot]');
    if (!dot) return;
  
    dot.style.left = `${e.clientX}px`;
    dot.style.top = `${e.clientY}px`;
    dot.classList.add('visible');
  
    publishRemote({
      kind: 'laser',
      x: e.clientX,
      y: e.clientY,
      ts: Date.now(),
    });
  }
  
  function toggleNotes() {
    if (!slideshow) return;
  
    slideshow.notesOpen = !slideshow.notesOpen;
  
    if (!slideshow.notesOpen) {
      slideshow.notesEl?.remove();
      slideshow.notesEl = null;
      return;
    }
  
    const panel = document.createElement('div');
    panel.className = 'yanta-slideshow-notes';
    panel.innerHTML = `
      <div class="yanta-slideshow-notes-head">
        ${lucide('notebook-text', 15)}
        <strong data-notes-title>Speaker notes</strong>
        <button class="icon-btn" data-close-notes>${lucide('x', 14)}</button>
      </div>
      <textarea data-notes-input placeholder="Presenter notes for this slide…"></textarea>
    `;
  
    panel.querySelector('[data-close-notes]')?.addEventListener('click', toggleNotes);
    panel.querySelector('[data-notes-input]')?.addEventListener('input', (e) => {
      const slide = slideshow.slides[slideshow.index];
      if (!slide) return;
  
      setSlideNotes(
        slideshow.noteId,
        slideshow.drawingId,
        slide.id,
        e.target.value
      );
  
      slideshow.slides = listSlides(slideshow.noteId, slideshow.drawingId).filter((s) => !s.hidden);
    });
  
    slideshow.root.append(panel);
    slideshow.notesEl = panel;
  
    updateNotesPanel();
  }
  
  function updateNotesPanel() {
    if (!slideshow?.notesEl) return;
  
    const slide = slideshow.slides[slideshow.index];
    const title = slideshow.notesEl.querySelector('[data-notes-title]');
    const input = slideshow.notesEl.querySelector('[data-notes-input]');
  
    if (title) title.textContent = slide?.title || 'Speaker notes';
  
    if (input && document.activeElement !== input) {
      input.value = slide?.notes?.markdown || '';
    }
  }
  
  // ------------------------------------------------------------
  // Remote QR via signaling server
  // ------------------------------------------------------------
  
  function remotePayload() {
    return {
      v: 1,
      kind: 'yanta-slides-remote',
      topic: `slides-${uid()}-${Date.now()}`,
      token: uid() + uid(),
      origin: location.origin,
    };
  }
  
  function remoteUrl(payload) {
    const encoded = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  
    return `${location.origin}${location.pathname}${location.search}#slides-remote=${encoded}`;
  }
  
  function decodeRemoteHash() {
    const raw = String(location.hash || '').replace(/^#/, '');
  
    if (!raw.startsWith('slides-remote=')) return null;
  
    let b64 = raw.slice('slides-remote='.length)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
  
    while (b64.length % 4) b64 += '=';
  
    try {
      return JSON.parse(atob(b64));
    } catch {
      return null;
    }
  }
  
  function openRemoteQrModal() {
    if (!slideshow) {
      toast('Start a slideshow first', 'error');
      return;
    }
  
    const payload = remotePayload();
  
    remoteTopic = payload.topic;
    remoteToken = payload.token;
  
    openRemotePresenterSocket();
  
    const modal = document.createElement('div');
    modal.className = 'yanta-slides-remote-modal';
  
    const url = remoteUrl(payload);
  
    modal.innerHTML = `
      <div class="yanta-slides-remote-card">
        <header>
          <h3>Remote Control</h3>
          <button class="icon-btn" data-close>${lucide('x', 16)}</button>
        </header>
        <div class="yanta-slides-remote-body">
          <div class="yanta-slides-remote-qr" data-qr></div>
          <input class="text-input" readonly value="${escapeAttr(url)}">
          <p style="margin:0;color:var(--text-dim);font-size:13px;line-height:1.45">
            Scan with your phone to control slide navigation and laser pointer.
          </p>
        </div>
      </div>
    `;
  
    modal.querySelector('[data-qr]')?.append(renderBrandedQrSvg(url, {
      size: 240,
      logo: BRAND_LOGO_SVG,
    }));
  
    modal.querySelector('[data-close]')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  
    document.body.append(modal);
  }
  
  function openRemotePresenterSocket() {
    closeRemoteSocket();
  
    remoteSocket = new WebSocket(SIGNALING_URL);
  
    remoteSocket.addEventListener('open', () => {
      remoteSocket.send(JSON.stringify({
        type: 'subscribe',
        topics: [remoteTopic],
      }));
  
      publishRemoteState();
    });
  
    remoteSocket.addEventListener('message', (event) => {
      let msg = null;
  
      try {
        msg = JSON.parse(event.data);
      } catch {}
  
      const data = msg?.data;
  
      if (!data || data.token !== remoteToken) return;
  
      if (data.kind === 'next') nextSlide();
      if (data.kind === 'prev') previousSlide();
  
      if (data.kind === 'laser') {
        const dot = slideshow?.root?.querySelector('[data-laser-dot]');
        if (!dot) return;
  
        dot.style.left = `${data.x}px`;
        dot.style.top = `${data.y}px`;
        dot.classList.add('visible');
      }
    });
  }
  
  function publishRemote(data) {
    if (!remoteSocket || remoteSocket.readyState !== WebSocket.OPEN || !remoteTopic) return;
  
    remoteSocket.send(JSON.stringify({
      type: 'publish',
      topic: remoteTopic,
      data: {
        ...data,
        token: remoteToken,
      },
    }));
  }
  
  function publishRemoteState() {
    if (!slideshow) return;
  
    const slide = slideshow.slides[slideshow.index];
  
    publishRemote({
      kind: 'state',
      index: slideshow.index,
      total: slideshow.slides.length,
      title: slide?.title || '',
      notes: slide?.notes?.markdown || '',
    });
  }
  
  function closeRemoteSocket() {
    if (!remoteSocket) return;
  
    try {
      remoteSocket.close();
    } catch {}
  
    remoteSocket = null;
    remoteTopic = '';
    remoteToken = '';
  }
  
  function mountRemoteControl(payload) {
    injectCss();
  
    document.body.innerHTML = '';
  
    const screen = document.createElement('div');
    screen.className = 'yanta-slides-remote-screen';
  
    screen.innerHTML = `
      <div class="yanta-slides-remote-phone">
        <header>
          <h3 data-title>YANTA Remote</h3>
        </header>
        <div class="yanta-slides-remote-controls">
          <button class="btn" data-prev>${lucide('chevron-left', 26)} Prev</button>
          <button class="btn primary" data-next>Next ${lucide('chevron-right', 26)}</button>
          <div class="yanta-slides-remote-laserpad" data-laserpad>
            Touch and drag for laser pointer
          </div>
          <textarea class="text-input" data-notes rows="7" readonly placeholder="Presenter notes"></textarea>
        </div>
      </div>
    `;
  
    document.body.append(screen);
  
    const ws = new WebSocket(SIGNALING_URL);
  
    const send = (kind, extra = {}) => {
      if (ws.readyState !== WebSocket.OPEN) return;
  
      ws.send(JSON.stringify({
        type: 'publish',
        topic: payload.topic,
        data: {
          kind,
          token: payload.token,
          ...extra,
        },
      }));
    };
  
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        topics: [payload.topic],
      }));
    });
  
    ws.addEventListener('message', (event) => {
      let msg = null;
  
      try {
        msg = JSON.parse(event.data);
      } catch {}
  
      const data = msg?.data;
      if (!data || data.token !== payload.token) return;
  
      if (data.kind === 'state') {
        screen.querySelector('[data-title]').textContent =
          `${data.index + 1}/${data.total} · ${data.title || 'Slide'}`;
  
        screen.querySelector('[data-notes]').value = data.notes || '';
      }
    });
  
    screen.querySelector('[data-prev]')?.addEventListener('click', () => send('prev'));
    screen.querySelector('[data-next]')?.addEventListener('click', () => send('next'));
  
    const pad = screen.querySelector('[data-laserpad]');
  
    pad?.addEventListener('pointermove', (e) => {
      if (!(e.buttons & 1)) return;
  
      send('laser', {
        x: e.clientX,
        y: e.clientY,
        ts: Date.now(),
      });
    });
  
    pad?.addEventListener('pointerdown', (e) => {
      try {
        pad.setPointerCapture?.(e.pointerId);
      } catch {}
  
      send('laser', {
        x: e.clientX,
        y: e.clientY,
        ts: Date.now(),
      });
    });
  }
  
  // ------------------------------------------------------------
  // slides:// embeds
  // ------------------------------------------------------------
  
  function hydrateSlidesEmbeds(root = document) {
    injectCss();
  
    root.querySelectorAll?.('.yanta-slides-embed[data-slides-draw-id]').forEach((node) => {
      const drawingId = node.dataset.slidesDrawId;
      const ref = drawingRef(state.currentNoteId, drawingId);
  
      if (!ref) {
        node.innerHTML = `<div class="tree-empty">Slideshow unavailable</div>`;
        return;
      }
  
      const slides = listSlides(ref.noteId, drawingId);
  
      node.innerHTML = `
        <div class="yanta-slides-embed-head">
          ${lucide('presentation', 18)}
          <strong>${escapeHtml(ref.drawing.title || 'Slideshow')}</strong>
          <span style="color:var(--text-faint);font-size:12px">${slides.length} slide${slides.length === 1 ? '' : 's'}</span>
          <button class="btn primary" data-start>${lucide('play', 13)} Start</button>
        </div>
      `;
  
      node.querySelector('[data-start]')?.addEventListener('click', () => {
        const embed = document.querySelector(`.yanta-draw-embed[data-draw-id="${CSS.escape(drawingId)}"]`);
        const api = embed ? getDrawingApiForEmbed(embed) : getActiveDrawingApi();
  
        startSlideshow({
          noteId: ref.noteId,
          drawingId,
          api,
          container: embed || getActiveDrawingHost(),
        });
      });
    });
  }
  
  export function setupSlides() {
    injectCss();
  
    const remote = decodeRemoteHash();
  
    if (remote?.kind === 'yanta-slides-remote') {
      mountRemoteControl(remote);
      return;
    }
  
    window.addEventListener('yanta-preview-rendered', () => {
      document.querySelectorAll('.yanta-draw-embed[data-draw-id]').forEach(enhanceDrawingEmbed);
      hydrateSlidesEmbeds(document);
    });
  
    window.addEventListener('yanta-draw-hydrate', (e) => {
      const root = e.detail?.root || document;
      root.querySelectorAll?.('.yanta-draw-embed[data-draw-id]').forEach(enhanceDrawingEmbed);
      hydrateSlidesEmbeds(root);
    });
  
    window.addEventListener('yanta-draw-api-ready', (e) => {
      const detail = e.detail || {};
  
      if (detail.embed) {
        enhanceDrawingEmbed(detail.embed);
      }
    });
  
    window.addEventListener('yanta-slides-updated', () => {
      document.querySelectorAll('.yanta-draw-embed[data-draw-id]').forEach(refreshSlidesPanel);
      hydrateSlidesEmbeds(document);
    });
  
    window.addEventListener('yanta-drawing-updated', () => {
      document.querySelectorAll('.yanta-draw-embed[data-draw-id]').forEach(refreshSlidesPanel);
    });
  }