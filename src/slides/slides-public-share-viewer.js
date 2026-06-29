// ============================================================
// YANTA Slides — Public Share Viewer support
// ============================================================

import {
    escapeHtml,
    lucide,
  } from '../core.js';
  
  import {
    visibleElementsInSlide,
  } from './slides-model.js';
  
  import {
    normalizeSlides,
  } from './slides-model.js';
  
  let cssInjected = false;
  let activeModal = null;
  
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
  
    const style = document.createElement('style');
    style.id = 'yanta-public-slides-css';
    style.textContent = `
  .yps-slides-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-elev-2);
  }
  
  .yps-slides-bar strong {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  
  .yps-slides-modal {
    position: fixed;
    inset: 0;
    z-index: 800;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
  }
  
  .yps-slides-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 22px;
    overflow: hidden;
  }
  
  .yps-slides-stage svg {
    max-width: 100%;
    max-height: 100%;
  }
  
  .yps-slides-top {
    min-height: 54px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: max(8px, env(safe-area-inset-top)) 12px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
  }
  
  .yps-slides-title {
    flex: 1;
    min-width: 0;
    font-weight: 800;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  
  .yps-slides-bottom {
    min-height: 54px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 12px max(8px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
  }
    `;
  
    document.head.append(style);
  }
  
  async function loadExcalidraw() {
    const mod = await import('@excalidraw/excalidraw');
  
    if (typeof mod.exportToSvg !== 'function') {
      throw new Error('Excalidraw SVG export unavailable');
    }
  
    return mod;
  }
  
  async function slideSvg(drawing, slide) {
    const { exportToSvg } = await loadExcalidraw();
  
    const elements = visibleElementsInSlide(drawing.elements || [], slide);
  
    const svg = await exportToSvg({
      elements,
      appState: {
        ...(drawing.appState || {}),
        exportBackground: true,
        viewBackgroundColor:
          document.documentElement.dataset.publicShareTheme === 'light'
            ? '#ffffff'
            : '#121212',
      },
      files: drawing.files || {},
    });
  
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
  
    return svg;
  }
  
  async function openPublicSlideshow(drawing) {
    injectCss();
  
    const slides = normalizeSlides(drawing.slides || []).filter((s) => !s.hidden);
    if (!slides.length) return;
  
    activeModal?.remove();
  
    let index = 0;
  
    const modal = document.createElement('div');
    modal.className = 'yps-slides-modal';
  
    modal.innerHTML = `
      <header class="yps-slides-top">
        ${lucide('presentation', 18)}
        <div class="yps-slides-title" data-title></div>
        <button class="yps-icon-btn" data-close>${lucide('x', 16)}</button>
      </header>
  
      <main class="yps-slides-stage" data-stage>
        <div class="tree-empty">Rendering slide…</div>
      </main>
  
      <footer class="yps-slides-bottom">
        <button class="yps-btn" data-prev>${lucide('chevron-left', 14)} Prev</button>
        <span data-count style="color:var(--text-dim);font-size:12px;min-width:80px;text-align:center"></span>
        <button class="yps-btn primary" data-next>Next ${lucide('chevron-right', 14)}</button>
      </footer>
    `;
  
    document.body.append(modal);
    activeModal = modal;
  
    const render = async () => {
      const slide = slides[index];
  
      modal.querySelector('[data-title]').textContent = slide.title || `Slide ${index + 1}`;
      modal.querySelector('[data-count]').textContent = `${index + 1} / ${slides.length}`;
  
      const stage = modal.querySelector('[data-stage]');
      stage.innerHTML = '<div class="tree-empty">Rendering slide…</div>';
  
      try {
        const svg = await slideSvg(drawing, slide);
        stage.replaceChildren(svg);
      } catch {
        stage.innerHTML = '<div class="tree-empty">Slide unavailable</div>';
      }
    };
  
    const next = () => {
      index = Math.min(slides.length - 1, index + 1);
      render();
    };
  
    const prev = () => {
      index = Math.max(0, index - 1);
      render();
    };
  
    modal.querySelector('[data-close]')?.addEventListener('click', () => {
      modal.remove();
      activeModal = null;
    });
  
    modal.querySelector('[data-next]')?.addEventListener('click', next);
    modal.querySelector('[data-prev]')?.addEventListener('click', prev);
  
    const keyHandler = (e) => {
      if (!activeModal) {
        window.removeEventListener('keydown', keyHandler, true);
        return;
      }
  
      if (e.key === 'Escape') {
        e.preventDefault();
        activeModal.remove();
        activeModal = null;
        window.removeEventListener('keydown', keyHandler, true);
      }
  
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        next();
      }
  
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
  
    window.addEventListener('keydown', keyHandler, true);
  
    await render();
  }
  
  export function mountPublicShareSlides(payload = {}) {
    injectCss();
  
    const drawings = Array.isArray(payload.drawings) ? payload.drawings : [];
    const byId = new Map(drawings.map((d) => [d.id, d]));
  
    document.querySelectorAll('[data-public-draw-id]').forEach((node) => {
      const id = node.dataset.publicDrawId || '';
      const drawing = byId.get(id);
      const slides = normalizeSlides(drawing?.slides || []);
  
      if (!drawing || !slides.length) return;
      if (node.querySelector('.yps-slides-bar')) return;
  
      const bar = document.createElement('div');
      bar.className = 'yps-slides-bar';
      bar.innerHTML = `
        ${lucide('presentation', 15)}
        <strong>${escapeHtml(slides.length)} slide${slides.length === 1 ? '' : 's'}</strong>
        <button class="yps-btn primary" type="button">${lucide('play', 14)} Start slideshow</button>
      `;
  
      bar.querySelector('button')?.addEventListener('click', () => {
        openPublicSlideshow(drawing);
      });
  
      node.append(bar);
    });
  }