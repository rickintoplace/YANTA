// ============================================================
// YANTA Slides — Animation authoring.
//
// Two ways in, matching how people actually build a deck:
//
// - Select something on the board → "Animate on click" turns it into the next
//   build step of the slide it sits on. That is the 90% gesture.
// - The slide menu → "Animation…" opens this panel for the details: the
//   slide's transition, the order of the steps, their effect and pace.
//
// The panel edits the slide record directly (updateSlide), so everything it
// changes is CRDT state that syncs and survives a reload like any other slide
// property.
// ============================================================

import {
  lucide,
  escapeHtml,
  escapeAttr,
  toast,
} from '../core.js';

import {
  listSlides,
  updateSlide,
} from './slides-store.js';

import {
  elementBounds,
  isSlideFrameElement,
  normalizeSlideBounds,
  rectsIntersect,
} from './slides-model.js';

import {
  expandBuildSelection,
  slideAnimation,
  SLIDE_BUILD_EFFECTS,
  SLIDE_BUILD_EFFECT_LABELS,
  SLIDE_TRANSITIONS,
  SLIDE_TRANSITION_LABELS,
} from './slides-animation.js';

import {
  openBoundOverlay,
} from '../overlay-history.js';

const PANEL_OVERLAY_ID = 'slide-animation';

let panel = null;
let cssInjected = false;

function injectCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.dataset.yanta = 'slides-animation';

  style.textContent = `
.yanta-slide-anim-panel {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  top: 50%;
  transform: translateY(-50%);
  z-index: 630;

  width: min(340px, calc(100vw - 32px));
  max-height: min(70vh, 620px);

  display: flex;
  flex-direction: column;

  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-elev) 96%, transparent);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  overflow: hidden;
}

/* Out of the way while presenting — hidden, not closed (see startSlideshow). */
body.yanta-slideshow-active .yanta-slide-anim-panel {
  display: none;
}

@media (max-width: 760px) {
  .yanta-slide-anim-panel {
    right: 8px;
    left: 8px;
    width: auto;
    top: auto;
    bottom: max(12px, env(safe-area-inset-bottom));
    transform: none;
    max-height: 66vh;
  }
}

.yanta-slide-anim-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--border);
}

.yanta-slide-anim-head h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanta-slide-anim-body {
  padding: 12px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-slide-anim-section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}

.yanta-slide-anim-segmented {
  display: flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}

.yanta-slide-anim-segmented button {
  flex: 1 1 0;
  min-width: 0;
  padding: 6px 4px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.yanta-slide-anim-segmented button[aria-pressed="true"] {
  background: var(--accent);
  color: #fff;
}

.yanta-slide-anim-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-slide-anim-step {
  display: grid;
  grid-template-columns: 22px 1fr;
  grid-template-areas:
    "index main"
    "actions actions";
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg);
}

.yanta-slide-anim-step-index {
  grid-area: index;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}

.yanta-slide-anim-step-main {
  grid-area: main;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.yanta-slide-anim-step-meta {
  font-size: 11px;
  color: var(--muted);
}

.yanta-slide-anim-step-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.yanta-slide-anim-step select {
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
}

.yanta-slide-anim-step-actions {
  grid-area: actions;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}

.yanta-slide-anim-step-actions .icon-btn {
  width: 26px;
  height: 26px;
}

.yanta-slide-anim-empty {
  padding: 14px 12px;
  border: 1px dashed var(--border);
  border-radius: 11px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}

.yanta-slide-anim-foot {
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 8px;
}

.yanta-slide-anim-foot .btn {
  flex: 1 1 auto;
  justify-content: center;
}
  `;

  document.head.append(style);
}

// ------------------------------------------------------------
// Slide lookup
// ------------------------------------------------------------

function selectedElementIdsFromApi(api) {
  try {
    const selected = api?.getAppState?.()?.selectedElementIds || {};

    return Object.keys(selected).filter((id) => selected[id]);
  } catch {
    return [];
  }
}

function sceneElements(api) {
  try {
    const elements = api?.getSceneElements?.() || [];
    return Array.isArray(elements) ? elements : [];
  } catch {
    return [];
  }
}

function boundsOfElements(elements = []) {
  if (!elements.length) return null;

  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;

  for (const el of elements) {
    const b = elementBounds(el);

    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
    y2 = Math.max(y2, b.y + b.height);
  }

  return normalizeSlideBounds({
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  });
}

/** The slide a set of elements belongs to: the one it overlaps most. */
export function slideForElements(noteId, drawingId, elements = []) {
  const bounds = boundsOfElements(elements);
  if (!bounds) return null;

  let best = null;
  let bestArea = 0;

  for (const slide of listSlides(noteId, drawingId)) {
    const slideBounds = normalizeSlideBounds(slide.bounds);
    if (!rectsIntersect(slideBounds, bounds)) continue;

    const w = Math.min(slideBounds.x + slideBounds.width, bounds.x + bounds.width) -
      Math.max(slideBounds.x, bounds.x);
    const h = Math.min(slideBounds.y + slideBounds.height, bounds.y + bounds.height) -
      Math.max(slideBounds.y, bounds.y);

    const area = Math.max(0, w) * Math.max(0, h);

    if (area > bestArea) {
      bestArea = area;
      best = slide;
    }
  }

  return best;
}

function writeAnimation(noteId, drawingId, slide, animation) {
  updateSlide(noteId, drawingId, slide.id, { animation });

  window.dispatchEvent(new CustomEvent('yanta-slides-updated', {
    detail: { noteId, drawingId, slideId: slide.id, reason: 'animation' },
  }));
}

// ------------------------------------------------------------
// "Animate on click" from a selection
// ------------------------------------------------------------

/**
 * Turns the current board selection into the slide's next build step.
 *
 * Returns the slide it was added to, or null when there was nothing to add.
 */
export function addSelectionAsBuildStep({ noteId, drawingId, api }) {
  const elements = sceneElements(api);
  const selectedIds = selectedElementIdsFromApi(api);

  const ids = expandBuildSelection(elements, selectedIds)
    .filter((id) => {
      const el = elements.find((e) => e.id === id);
      // A slide frame is the camera target, not content — never animate it.
      return el && !isSlideFrameElement(el);
    });

  if (!ids.length) {
    toast('Select something on the board first', 'error');
    return null;
  }

  const chosen = elements.filter((el) => ids.includes(el.id));
  const slide = slideForElements(noteId, drawingId, chosen);

  if (!slide) {
    toast('This selection is not on a slide yet', 'error');
    return null;
  }

  const animation = slideAnimation(slide);

  // An element can only belong to one step; re-animating moves it.
  const builds = animation.builds
    .map((build) => ({
      ...build,
      elementIds: build.elementIds.filter((id) => !ids.includes(id)),
    }))
    .filter((build) => build.elementIds.length);

  builds.push({
    elementIds: ids,
    effect: 'fade',
    order: builds.length,
  });

  writeAnimation(noteId, drawingId, slide, { ...animation, builds });

  toast(`Step ${builds.length} on "${slide.title}"`, 'success');

  if (panel?.slideId === slide.id) render();

  return slide;
}

// ------------------------------------------------------------
// Panel
// ------------------------------------------------------------

function currentSlide() {
  if (!panel) return null;

  return listSlides(panel.noteId, panel.drawingId)
    .find((s) => s.id === panel.slideId) || null;
}

function stepSummary(slide, build) {
  const elements = sceneElements(panel?.getApi?.());
  const known = build.elementIds.filter((id) =>
    elements.some((el) => el.id === id && !el.isDeleted)
  );

  const count = known.length || build.elementIds.length;
  const missing = build.elementIds.length - known.length;

  return `${count} object${count === 1 ? '' : 's'}${missing > 0 ? ' · some deleted' : ''}`;
}

function render() {
  if (!panel?.root?.isConnected) return;

  const slide = currentSlide();

  if (!slide) {
    closeSlideAnimationPanel();
    return;
  }

  const animation = slideAnimation(slide);
  const body = panel.root.querySelector('[data-anim-body]');
  const title = panel.root.querySelector('[data-anim-title]');

  if (title) title.textContent = `Animation · ${slide.title}`;
  if (!body) return;

  const transitions = SLIDE_TRANSITIONS.map((kind) => `
    <button type="button"
            data-transition="${escapeAttr(kind)}"
            aria-pressed="${animation.transition === kind ? 'true' : 'false'}">
      ${escapeHtml(SLIDE_TRANSITION_LABELS[kind] || kind)}
    </button>
  `).join('');

  const steps = animation.builds.length
    ? animation.builds.map((build, index) => `
        <div class="yanta-slide-anim-step" data-build="${escapeAttr(build.id)}">
          <span class="yanta-slide-anim-step-index">${index + 1}</span>

          <div class="yanta-slide-anim-step-main">
            <div class="yanta-slide-anim-step-controls">
              <select data-effect aria-label="Effect">
                ${SLIDE_BUILD_EFFECTS.map((effect) => `
                  <option value="${escapeAttr(effect)}" ${build.effect === effect ? 'selected' : ''}>
                    ${escapeHtml(SLIDE_BUILD_EFFECT_LABELS[effect] || effect)}
                  </option>
                `).join('')}
              </select>

              <select data-duration aria-label="Pace">
                <option value="220" ${build.duration <= 260 ? 'selected' : ''}>Fast</option>
                <option value="420" ${build.duration > 260 && build.duration <= 600 ? 'selected' : ''}>Normal</option>
                <option value="800" ${build.duration > 600 ? 'selected' : ''}>Slow</option>
              </select>
            </div>

            <div class="yanta-slide-anim-step-meta">${escapeHtml(stepSummary(slide, build))}</div>
          </div>

          <div class="yanta-slide-anim-step-actions">
            <button class="icon-btn" data-move="up" title="Move earlier" ${index === 0 ? 'disabled' : ''}>${lucide('chevron-up', 14)}</button>
            <button class="icon-btn" data-move="down" title="Move later" ${index === animation.builds.length - 1 ? 'disabled' : ''}>${lucide('chevron-down', 14)}</button>
            <button class="icon-btn danger" data-remove title="Remove step">${lucide('x', 14)}</button>
          </div>
        </div>
      `).join('')
    : `
        <div class="yanta-slide-anim-empty">
          No build steps yet. Select objects on the board and press
          <strong>Add selection as step</strong> — during the presentation they
          appear one click at a time.
        </div>
      `;

  body.innerHTML = `
    <div>
      <div class="yanta-slide-anim-section-label">Transition into this slide</div>
      <div class="yanta-slide-anim-segmented" data-anim-transitions>${transitions}</div>
    </div>

    <div>
      <div class="yanta-slide-anim-section-label">Build steps</div>
      <div class="yanta-slide-anim-steps">${steps}</div>
    </div>
  `;
}

function updateBuilds(mutate) {
  const slide = currentSlide();
  if (!slide) return;

  const animation = slideAnimation(slide);
  const builds = mutate([...animation.builds]);

  writeAnimation(panel.noteId, panel.drawingId, slide, {
    ...animation,
    builds: builds.map((build, index) => ({ ...build, order: index })),
  });

  render();
}

function onBodyClick(e) {
  const transition = e.target.closest?.('[data-transition]');

  if (transition) {
    const slide = currentSlide();
    if (!slide) return;

    writeAnimation(panel.noteId, panel.drawingId, slide, {
      ...slideAnimation(slide),
      transition: transition.dataset.transition,
    });

    render();
    return;
  }

  const stepEl = e.target.closest?.('[data-build]');
  if (!stepEl) return;

  const buildId = stepEl.dataset.build;

  if (e.target.closest('[data-remove]')) {
    updateBuilds((builds) => builds.filter((b) => b.id !== buildId));
    return;
  }

  const move = e.target.closest('[data-move]');

  if (move) {
    const delta = move.dataset.move === 'up' ? -1 : 1;

    updateBuilds((builds) => {
      const index = builds.findIndex((b) => b.id === buildId);
      const target = index + delta;

      if (index < 0 || target < 0 || target >= builds.length) return builds;

      const [moved] = builds.splice(index, 1);
      builds.splice(target, 0, moved);

      return builds;
    });
  }
}

function onBodyChange(e) {
  const stepEl = e.target.closest?.('[data-build]');
  if (!stepEl) return;

  const buildId = stepEl.dataset.build;

  if (e.target.matches('[data-effect]')) {
    const effect = e.target.value;

    updateBuilds((builds) =>
      builds.map((b) => (b.id === buildId ? { ...b, effect } : b))
    );

    return;
  }

  if (e.target.matches('[data-duration]')) {
    const duration = Number(e.target.value) || 420;

    updateBuilds((builds) =>
      builds.map((b) => (b.id === buildId ? { ...b, duration } : b))
    );
  }
}

export function closeSlideAnimationPanel({ fromHistory = false } = {}) {
  if (!panel) return;

  const release = panel.release;

  panel.root.remove();
  panel = null;

  if (!fromHistory) release?.();
}

export function openSlideAnimationPanel({
  noteId,
  drawingId,
  slideId,
  getApi,
}) {
  injectCss();
  closeSlideAnimationPanel();

  const root = document.createElement('div');
  root.className = 'yanta-slide-anim-panel';

  root.innerHTML = `
    <div class="yanta-slide-anim-head">
      <span>${lucide('sparkles', 16)}</span>
      <h3 data-anim-title>Animation</h3>
      <button class="icon-btn" data-anim-close title="Close">${lucide('x', 16)}</button>
    </div>

    <div class="yanta-slide-anim-body" data-anim-body></div>

    <div class="yanta-slide-anim-foot">
      <button class="btn" data-anim-add>${lucide('plus', 14)} Add selection as step</button>
    </div>
  `;

  document.body.append(root);

  panel = {
    root,
    noteId,
    drawingId,
    slideId,
    getApi: getApi || (() => null),
    release: null,
  };

  root.querySelector('[data-anim-close]')?.addEventListener('click', () => {
    closeSlideAnimationPanel();
  });

  root.querySelector('[data-anim-add]')?.addEventListener('click', () => {
    addSelectionAsBuildStep({
      noteId,
      drawingId,
      api: panel?.getApi?.(),
    });
  });

  const body = root.querySelector('[data-anim-body]');
  body.addEventListener('click', onBodyClick);
  body.addEventListener('change', onBodyChange);

  panel.release = openBoundOverlay(PANEL_OVERLAY_ID, {
    close: () => closeSlideAnimationPanel({ fromHistory: true }),
    isOpen: () => !!panel,
  });

  render();

  return root;
}
