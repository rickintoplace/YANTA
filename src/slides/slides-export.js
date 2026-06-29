// ============================================================
// YANTA Slides — Export
// PDF via browser print pipeline.
// ============================================================

import {
    escapeHtml,
    toast,
  } from '../core.js';
  
  import {
    getDrawing,
  } from '../yjs.js';
  
  import {
    listSlides,
  } from './slides-store.js';
  
  import {
    visibleElementsInSlide,
  } from './slides-model.js';
  
  async function loadExcalidraw() {
    const mod = await import('@excalidraw/excalidraw');
  
    if (typeof mod.exportToSvg !== 'function') {
      throw new Error('Excalidraw SVG export is unavailable.');
    }
  
    return mod;
  }
  
  function svgToString(svg) {
    return new XMLSerializer().serializeToString(svg);
  }
  
  export async function renderSlideToSvgString(drawing, slide, {
    background = '#ffffff',
  } = {}) {
    const { exportToSvg } = await loadExcalidraw();
  
    const elements = visibleElementsInSlide(drawing.elements || [], slide);
  
    const svg = await exportToSvg({
      elements,
      appState: {
        ...(drawing.appState || {}),
        exportBackground: true,
        viewBackgroundColor: background,
      },
      files: drawing.files || {},
    });
  
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  
    return svgToString(svg);
  }
  
  export async function exportDrawingSlidesToPdf(noteId, drawingId, {
    includeNotes = false,
    background = '#ffffff',
  } = {}) {
    const drawing = getDrawing(noteId, drawingId);
    if (!drawing) {
      toast('Drawing not found', 'error');
      return;
    }
  
    const slides = listSlides(noteId, drawingId).filter((s) => !s.hidden);
  
    if (!slides.length) {
      toast('No slides to export', 'error');
      return;
    }
  
    toast('Preparing PDF…', 'success');
  
    const rendered = [];
  
    for (const slide of slides) {
      rendered.push({
        slide,
        svg: await renderSlideToSvgString(drawing, slide, {
          background,
        }),
      });
    }
  
    const win = window.open('', '_blank');
  
    if (!win) {
      toast('Popup blocked · allow popups to export PDF', 'error');
      return;
    }
  
    win.document.write(`
  <!doctype html>
  <html>
  <head>
  <meta charset="utf-8">
  <title>${escapeHtml(drawing.title || 'Slideshow')}</title>
  <style>
    @page {
      size: landscape;
      margin: 0;
    }
  
    html,
    body {
      margin: 0;
      padding: 0;
      background: white;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  
    .slide-page {
      page-break-after: always;
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: ${background};
      overflow: hidden;
    }
  
    .slide-canvas {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    }
  
    .slide-canvas svg {
      max-width: 100%;
      max-height: 100%;
    }
  
    .slide-notes {
      display: ${includeNotes ? 'block' : 'none'};
      padding: 12px 24px 20px;
      border-top: 1px solid #ddd;
      font-size: 12px;
      color: #333;
      white-space: pre-wrap;
    }
  
    .slide-title {
      position: fixed;
      left: 18px;
      top: 12px;
      color: rgba(0,0,0,.45);
      font-size: 11px;
      font-weight: 700;
    }
  </style>
  </head>
  <body>
  ${rendered.map(({ slide, svg }, index) => `
    <section class="slide-page">
      <div class="slide-title">${index + 1}. ${escapeHtml(slide.title || `Slide ${index + 1}`)}</div>
      <div class="slide-canvas">
        ${svg}
      </div>
      <div class="slide-notes">${escapeHtml(slide.notes?.markdown || '')}</div>
    </section>
  `).join('')}
  <script>
    window.onload = () => {
      setTimeout(() => {
        window.focus();
        window.print();
      }, 250);
    };
  </script>
  </body>
  </html>
    `);
  
    win.document.close();
  }