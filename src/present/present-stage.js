// ============================================================
// YANTA Present — the stage on a connected screen
//
// A read-only Excalidraw showing the deck, driven by the presenter's
// position with the very same pieces the slideshow in the app uses: the
// camera (slides/slide-camera.js), build steps and transitions
// (slides/slides-animation.js). A step forward plays the build, a step back
// plays it backwards, anything else moves to the slide — so the screen
// looks like the presenter's own.
// ============================================================

import { loadExcalidraw, loadReact } from '../draw-runtime.js';
import { runDrawingApiUpdateWithoutSaving } from '../draw-scene-sync.js';
import { createSlideAnimator, removeTransitionVeil, runSlideTransition } from '../slides/slides-animation.js';
import { cancelCameraAnimation, scrollToSlide, slidePointToScreen } from '../slides/slide-camera.js';
import { motionBetween } from './present-protocol.js';

function filesArray(files = {}) {
  return Object.values(files || {}).filter((f) => f?.id && f?.dataURL);
}

export async function mountPresentStage(container, { deck, theme = 'light' }) {
  const [{ React, ReactDOM }, { Excalidraw }] = await Promise.all([loadReact(), loadExcalidraw()]);

  container.classList.add('yanta-present-stage');

  const mount = document.createElement('div');
  mount.className = 'yanta-present-stage-canvas';

  const laser = document.createElement('div');
  laser.className = 'yanta-present-laser';

  const blank = document.createElement('div');
  blank.className = 'yanta-present-blank';

  container.append(mount, laser, blank);

  let api = null;
  let currentDeck = deck;
  let shown = null; // { index, step }
  let animator = null;
  let laserTimer = 0;
  let pendingShow = null;

  const root = ReactDOM.createRoot(mount);

  const ready = new Promise((resolve) => {
    root.render(React.createElement(Excalidraw, {
      initialData: {
        elements: deck.elements || [],
        appState: {
          viewBackgroundColor: deck.appState?.viewBackgroundColor || '#ffffff',
          theme,
        },
        files: deck.files || {},
      },
      theme,
      viewModeEnabled: true,
      zenModeEnabled: true,
      gridModeEnabled: false,
      detectScroll: false,
      autoFocus: false,
      UIOptions: {
        canvasActions: {
          loadScene: false,
          saveAsImage: false,
          export: false,
          clearCanvas: false,
          toggleTheme: false,
          changeViewBackgroundColor: false,
        },
      },
      excalidrawAPI: (nextApi) => {
        api = nextApi;
        animator = createSlideAnimator({ getApi: () => api });
        resolve();
      },
    }));
  });

  await ready;

  // A resized window (rotation, fullscreen) re-frames the current slide.
  const ro = new ResizeObserver(() => {
    if (!shown || !api) return;

    const slide = currentDeck.slides?.[shown.index];
    if (slide) scrollToSlide(api, slide, container, { animate: false });
  });

  ro.observe(container);

  function slideAt(index) {
    return currentDeck?.slides?.[index] || null;
  }

  function show(position, { animate = true } = {}) {
    if (!api) {
      pendingShow = position;
      return;
    }

    const slides = currentDeck.slides || [];
    const slide = slides[position.index];
    if (!slide) return;

    const motion = animate ? motionBetween(shown, position) : 'jump';
    const previous = shown;
    shown = { index: position.index, step: position.step };

    if (motion === 'none') return;

    if (motion === 'reveal') {
      animator.revealStep(slide, position.step - 1);
      return;
    }

    if (motion === 'unreveal') {
      animator.revealStep(slide, position.step, { reverse: true });
      return;
    }

    animator.applyDeckState(slides, position.index, position.step);

    if (!animate || !previous) {
      scrollToSlide(api, slide, container, { animate: false });
      return;
    }

    runSlideTransition(slide, ({ animate: glide }) => {
      scrollToSlide(api, slide, container, { animate: glide });
    });
  }

  if (pendingShow) show(pendingShow, { animate: false });

  return {
    get position() {
      return shown;
    },

    show,

    /** A new deck version mid-talk: swap the scene, keep the place. */
    setDeck(next) {
      currentDeck = next;
      if (!api) return;

      animator?.dispose();

      runDrawingApiUpdateWithoutSaving(api, {
        elements: next.elements || [],
        appState: { viewBackgroundColor: next.appState?.viewBackgroundColor || '#ffffff' },
      });

      const files = filesArray(next.files);
      if (files.length) api.addFiles?.(files);

      animator = createSlideAnimator({ getApi: () => api });

      if (shown) {
        const slides = next.slides || [];
        const index = Math.min(shown.index, Math.max(0, slides.length - 1));
        animator.applyDeckState(slides, index, shown.step);

        const slide = slides[index];
        if (slide) scrollToSlide(api, slide, container, { animate: false });
      }
    },

    /** A laser point in slide units (0..1), from any device. */
    laser(point) {
      if (!shown || !api) return;

      if (point?.on === false) {
        laser.classList.remove('is-visible');
        return;
      }

      const slide = slideAt(shown.index);
      const p = slidePointToScreen({ api, container, slide, x: point.x, y: point.y });
      if (!p) return;

      const rect = container.getBoundingClientRect();
      laser.style.transform = `translate(${p.x - rect.left}px, ${p.y - rect.top}px)`;
      laser.classList.add('is-visible');

      clearTimeout(laserTimer);
      laserTimer = setTimeout(() => laser.classList.remove('is-visible'), 900);
    },

    setBlank(on) {
      blank.classList.toggle('is-on', !!on);
    },

    destroy() {
      ro.disconnect();
      clearTimeout(laserTimer);
      cancelCameraAnimation();
      removeTransitionVeil();
      animator?.dispose();

      try {
        root.unmount();
      } catch {}

      container.replaceChildren();
      container.classList.remove('yanta-present-stage');
    },
  };
}
