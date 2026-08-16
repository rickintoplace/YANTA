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
  createSlide,
  listSlides,
  updateSlide,
} from './slides-store.js';

import {
  elementBounds,
  isSlideFrameElement,
  normalizeSlideBounds,
  rectsIntersect,
  slideBoundsAroundElements,
} from './slides-model.js';

import {
  createSlideAnimator,
  expandBuildSelection,
  slideAnimation,
  slideBuildGroups,
  SLIDE_BUILD_DIRECTIONS,
  SLIDE_BUILD_DIRECTION_LABELS,
  SLIDE_BUILD_EFFECTS,
  SLIDE_BUILD_EFFECT_LABELS,
  SLIDE_BUILD_TRIGGERS,
  SLIDE_BUILD_TRIGGER_LABELS,
  SLIDE_TRANSITIONS,
  SLIDE_TRANSITION_LABELS,
} from './slides-animation.js';

import {
  openBoundOverlay,
} from '../overlay-history.js';

import {
  makePanelDraggable,
} from '../draggable-panel.js';

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
  align-items: start;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg);
}

.yanta-slide-anim-step-index {
  margin-top: 3px;
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
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.yanta-slide-anim-step-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
  flex: 1 1 0;
  min-width: 0;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
}

.yanta-slide-anim-panel.is-dragging {
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.42);
  user-select: none;
}

.yanta-slide-anim-step-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  flex: 0 0 auto;
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
 * Turns the current board selection into a slide's next build step.
 *
 * @param {string} [options.preferSlideId]  slide to use when the selection is
 *   not inside any slide — the one the panel is showing. Without it, every
 *   step added from outside a slide frame would spawn a slide of its own.
 * @returns the slide the step landed on, or null when there was nothing to add
 */
export function addSelectionAsBuildStep({ noteId, drawingId, api, preferSlideId = '' }) {
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

  /*
    Which slide the step belongs to, in order of what the user most likely
    means:
      1. the slide the selection actually sits on
      2. the slide currently open in the panel — you are editing its animation
      3. a new slide around the selection

    An animation belongs to a slide, but nobody should have to know that
    before they can animate something; step 3 is what keeps a bare board from
    being a dead end. Step 2 is what keeps it from spawning a slide per click.
  */
  let slide = slideForElements(noteId, drawingId, chosen);
  let createdSlide = false;

  if (!slide && preferSlideId) {
    slide = listSlides(noteId, drawingId).find((s) => s.id === preferSlideId) || null;
  }

  if (!slide) {
    slide = createSlide(noteId, drawingId, {
      bounds: slideBoundsAroundElements(chosen),
      api,
    });

    if (!slide) {
      toast('Could not create a slide for this selection', 'error');
      return null;
    }

    createdSlide = true;
  }

  const animation = slideAnimation(slide);

  // An element can only belong to one step; re-animating moves it.
  const wasAnimated = animation.builds.some((build) =>
    build.elementIds.some((id) => ids.includes(id))
  );

  const builds = animation.builds
    .map((build) => ({
      ...build,
      elementIds: build.elementIds.filter((id) => !ids.includes(id)),
    }))
    .filter((build) => build.elementIds.length);

  builds.push({
    elementIds: ids,
    effect: 'fade',
    trigger: 'click',
    order: builds.length,
  });

  writeAnimation(noteId, drawingId, slide, { ...animation, builds });

  /*
    Say which of the three things happened. Re-adding an already animated
    object moves it to a new last step rather than adding one, so the step
    count does not grow — without a word about it that reads as "the button
    did nothing".
  */
  toast(
    createdSlide
      ? `Created "${slide.title}" — animation step 1`
      : wasAnimated
        ? `Moved to step ${builds.length} on "${slide.title}"`
        : `Step ${builds.length} on "${slide.title}"`,
    'success'
  );

  /*
    The panel always follows the step that was just created. Anything else
    means adding a step and not seeing it appear, which reads as "the button
    does nothing".
  */
  if (panel) {
    panel.slideId = slide.id;
    render();
  }

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
  const body = panel.root.querySelector('[data-anim-body]');
  const title = panel.root.querySelector('[data-anim-title]');

  if (!body) return;

  /*
    No slide yet — do NOT close. The panel closing itself the moment it opened
    is exactly the "I clicked it and nothing happened" bug. Explain instead;
    the footer button creates the slide along with the first step.
  */
  if (!slide) {
    if (title) title.textContent = 'Animation';

    body.innerHTML = `
      <div class="yanta-slide-anim-empty">
        Select the objects you want to animate on the board, then press
        <strong>Add selection as step</strong>. They become the first step of a
        slide — one is created around them if this part of the board is not a
        slide yet.
      </div>
    `;

    return;
  }

  const animation = slideAnimation(slide);

  if (title) title.textContent = `Animation · ${slide.title}`;

  const transitions = SLIDE_TRANSITIONS.map((kind) => `
    <button type="button"
            data-transition="${escapeAttr(kind)}"
            aria-pressed="${animation.transition === kind ? 'true' : 'false'}">
      ${escapeHtml(SLIDE_TRANSITION_LABELS[kind] || kind)}
    </button>
  `).join('');

  // Click number per step, the way PowerPoint's animation pane numbers them:
  // steps that play together share the number of the click that starts them.
  const clickNumber = new Map();

  slideBuildGroups(slide).forEach((group, index) => {
    for (const { build } of group.steps) clickNumber.set(build.id, index + 1);
  });

  const options = (values, labels, selected) => values.map((value) => `
    <option value="${escapeAttr(value)}" ${value === selected ? 'selected' : ''}>
      ${escapeHtml(labels[value] || value)}
    </option>
  `).join('');

  const steps = animation.builds.length
    ? animation.builds.map((build, index) => {
        const directional = build.effect === 'fly' || build.effect === 'wipe';

        return `
        <div class="yanta-slide-anim-step" data-build="${escapeAttr(build.id)}">
          <span class="yanta-slide-anim-step-index"
                title="Plays on click ${clickNumber.get(build.id) || 1}">${clickNumber.get(build.id) || 1}</span>

          <div class="yanta-slide-anim-step-main">
            <div class="yanta-slide-anim-step-controls">
              <select data-effect aria-label="Effect">
                ${options(SLIDE_BUILD_EFFECTS, SLIDE_BUILD_EFFECT_LABELS, build.effect)}
              </select>

              ${directional ? `
                <select data-direction aria-label="Direction">
                  ${options(SLIDE_BUILD_DIRECTIONS, SLIDE_BUILD_DIRECTION_LABELS, build.direction)}
                </select>
              ` : ''}
            </div>

            <div class="yanta-slide-anim-step-controls">
              <select data-trigger aria-label="Start" ${index === 0 ? 'disabled' : ''}>
                ${options(SLIDE_BUILD_TRIGGERS, SLIDE_BUILD_TRIGGER_LABELS, build.trigger)}
              </select>

              <select data-duration aria-label="Speed">
                <option value="250" ${build.duration <= 300 ? 'selected' : ''}>Fast</option>
                <option value="500" ${build.duration > 300 && build.duration <= 750 ? 'selected' : ''}>Normal</option>
                <option value="1100" ${build.duration > 750 ? 'selected' : ''}>Slow</option>
              </select>
            </div>

            <div class="yanta-slide-anim-step-foot">
              <span class="yanta-slide-anim-step-meta">${escapeHtml(stepSummary(slide, build))}</span>

              <span class="yanta-slide-anim-step-actions">
                <button class="icon-btn" data-preview title="Preview this step">${lucide('play', 14)}</button>
                <button class="icon-btn" data-move="up" title="Move earlier" ${index === 0 ? 'disabled' : ''}>${lucide('chevron-up', 14)}</button>
                <button class="icon-btn" data-move="down" title="Move later" ${index === animation.builds.length - 1 ? 'disabled' : ''}>${lucide('chevron-down', 14)}</button>
                <button class="icon-btn danger" data-remove title="Remove step">${lucide('x', 14)}</button>
              </span>
            </div>
          </div>
        </div>
      `;
      }).join('')
    : `
        <div class="yanta-slide-anim-empty">
          No animation yet. Select objects on the board and press
          <strong>Add selection as step</strong> — each step plays on its own
          click, or together with the one before it.
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

  if (e.target.closest('[data-preview]')) {
    previewBuild(buildId);
    return;
  }

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

  if (e.target.matches('[data-direction]')) {
    const direction = e.target.value;

    updateBuilds((builds) =>
      builds.map((b) => (b.id === buildId ? { ...b, direction } : b))
    );

    return;
  }

  if (e.target.matches('[data-trigger]')) {
    const trigger = e.target.value;

    updateBuilds((builds) =>
      builds.map((b) => (b.id === buildId ? { ...b, trigger } : b))
    );

    return;
  }

  if (e.target.matches('[data-duration]')) {
    const duration = Number(e.target.value) || 500;

    updateBuilds((builds) =>
      builds.map((b) => (b.id === buildId ? { ...b, duration } : b))
    );
  }
}

/**
 * Plays one step right where the user is editing it.
 *
 * Authoring an animation you cannot see is guesswork, so the preview runs the
 * real runtime — same animator, same effects — on a throwaway slide holding
 * only this step. Nothing about it is persisted, and it always ends by putting
 * the board back.
 */
function previewBuild(buildId) {
  const slide = currentSlide();
  if (!slide || panel.previewing) return;

  const build = slideAnimation(slide).builds.find((b) => b.id === buildId);
  if (!build) return;

  const animator = createSlideAnimator({ getApi: () => panel?.getApi?.() });

  // A one-step slide: hidden first, then played on its own timeline.
  const solo = {
    animation: {
      transition: 'cut',
      builds: [{ ...build, order: 0, trigger: 'click', delay: 0 }],
    },
  };

  panel.previewing = true;

  animator.showStep(solo, 0);

  requestAnimationFrame(() => {
    animator.revealStep(solo, 0);

    window.setTimeout(() => {
      animator.dispose();
      if (panel) panel.previewing = false;
    }, build.duration + 260);
  });
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
    <div class="yanta-slide-anim-head" data-anim-drag>
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
    previewing: false,
    release: null,
  };

  makePanelDraggable(root, root.querySelector('[data-anim-drag]'), {
    key: 'slide-animation',
  });

  root.querySelector('[data-anim-close]')?.addEventListener('click', () => {
    closeSlideAnimationPanel();
  });

  root.querySelector('[data-anim-add]')?.addEventListener('click', () => {
    addSelectionAsBuildStep({
      noteId,
      drawingId,
      api: panel?.getApi?.(),
      preferSlideId: panel?.slideId || '',
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
