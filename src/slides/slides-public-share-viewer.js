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

  .yps-slides-viewport {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .yps-slide-frame {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    will-change: transform, opacity;
  }

  .yps-slides-stage svg {
    max-width: 100%;
    max-height: 100%;
  }

  .yps-slides-error {
    color: var(--text-faint);
    font-size: 13px;
    font-style: italic;
  }

  /* Enter/leave transitions — subtle directional slide + fade. */
  .yps-slide-frame.is-entering-next {
    opacity: 0;
    transform: translateX(4%) scale(0.985);
  }

  .yps-slide-frame.is-entering-prev {
    opacity: 0;
    transform: translateX(-4%) scale(0.985);
  }

  .yps-slide-frame.is-active {
    opacity: 1;
    transform: translateX(0) scale(1);
    transition:
      opacity 340ms cubic-bezier(.4, 0, .2, 1),
      transform 420ms cubic-bezier(.4, 0, .2, 1);
  }

  .yps-slide-frame.is-leaving-next {
    animation: yps-slide-leave-next 360ms cubic-bezier(.4, 0, .2, 1) forwards;
  }

  .yps-slide-frame.is-leaving-prev {
    animation: yps-slide-leave-prev 360ms cubic-bezier(.4, 0, .2, 1) forwards;
  }

  @keyframes yps-slide-leave-next {
    to {
      opacity: 0;
      transform: translateX(-4%) scale(0.985);
    }
  }

  @keyframes yps-slide-leave-prev {
    to {
      opacity: 0;
      transform: translateX(4%) scale(0.985);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .yps-slide-frame.is-active {
      transition: none;
    }

    .yps-slide-frame.is-leaving-next,
    .yps-slide-frame.is-leaving-prev {
      animation: none;
    }
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
  let renderToken = 0;

  const modal = document.createElement('div');
  modal.className = 'yps-slides-modal';

  modal.innerHTML = `
    <header class="yps-slides-top">
      ${lucide('presentation', 18)}
      <div class="yps-slides-title" data-title></div>
      <button class="yps-icon-btn" data-close>${lucide('x', 16)}</button>
    </header>

    <main class="yps-slides-stage" data-stage>
      <div class="yps-slides-viewport" data-viewport></div>
    </main>

    <footer class="yps-slides-bottom">
      <button class="yps-btn" data-prev>${lucide('chevron-left', 14)} Prev</button>
      <span data-count style="color:var(--text-dim);font-size:12px;min-width:80px;text-align:center"></span>
      <button class="yps-btn primary" data-next>Next ${lucide('chevron-right', 14)}</button>
    </footer>
  `;

  document.body.append(modal);
  activeModal = modal;

  const viewport = modal.querySelector('[data-viewport]');

  const prefersReducedMotion = (() => {
    try {
      return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
      return false;
    }
  })();

  const svgCache = new Map();

  const svgFor = async (slide) => {
    if (svgCache.has(slide.id)) return svgCache.get(slide.id);

    const svg = await slideSvg(drawing, slide);
    svgCache.set(slide.id, svg);

    return svg;
  };

  const render = async (direction = 0) => {
    const myToken = ++renderToken;
    const slide = slides[index];

    modal.querySelector('[data-title]').textContent = slide.title || `Slide ${index + 1}`;
    modal.querySelector('[data-count]').textContent = `${index + 1} / ${slides.length}`;

    let svg;

    try {
      svg = (await svgFor(slide)).cloneNode(true);
    } catch {
      if (myToken !== renderToken) return;

      viewport.innerHTML = '<div class="yps-slides-error">Slide unavailable</div>';
      return;
    }

    // A newer navigation happened while awaiting: abort this frame.
    if (myToken !== renderToken || !viewport.isConnected) return;

    const incoming = document.createElement('div');
    incoming.className = 'yps-slide-frame';
    incoming.append(svg);

    if (prefersReducedMotion || direction === 0) {
      viewport.replaceChildren(incoming);
      return;
    }

    // Enter animation: subtle slide + fade (Ken-Burns feel).
    incoming.classList.add(
      direction > 0 ? 'is-entering-next' : 'is-entering-prev'
    );

    const outgoing = viewport.querySelector('.yps-slide-frame');

    if (outgoing) {
      outgoing.classList.remove('is-entering-next', 'is-entering-prev');
      outgoing.classList.add(
        direction > 0 ? 'is-leaving-next' : 'is-leaving-prev'
      );

      outgoing.addEventListener('animationend', () => {
        outgoing.remove();
      }, { once: true });

      viewport.append(incoming);
    } else {
      viewport.replaceChildren(incoming);
    }

    // Trigger enter animation on next frame.
    requestAnimationFrame(() => {
      incoming.classList.add('is-active');
    });
  };

  const next = () => {
    if (index >= slides.length - 1) return;
    index += 1;
    render(1);

    // Prefetch the following slide for a seamless next transition.
    if (slides[index + 1]) svgFor(slides[index + 1]).catch(() => {});
  };

  const prev = () => {
    if (index <= 0) return;
    index -= 1;
    render(-1);

    if (slides[index - 1]) svgFor(slides[index - 1]).catch(() => {});
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
      return;
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

  await render(0);

  // Warm the next slide immediately.
  if (slides[1]) svgFor(slides[1]).catch(() => {});
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