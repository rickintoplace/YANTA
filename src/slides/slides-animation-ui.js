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
  uid,
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

import {
  getActiveDrawingApi,
} from '../draw.js';

const PANEL_OVERLAY_ID = 'slide-animation';

let panel = null;
let cssInjected = false;

// Rendered step thumbnails, keyed by the elements they show. A step's picture
// only changes when its objects change, so this stays tiny and always fresh.
const stepThumbnailCache = new Map();

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

/*
  The target slide is stated, not inferred. "Which slide did that animation
  just go to?" was the single most confusing thing about the first version.
*/
.yanta-slide-anim-target {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
}

.yanta-slide-anim-target label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.yanta-slide-anim-target select {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
}

.yanta-slide-anim-body {
  padding: 12px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Flash the step that was just added or moved, so it is never a silent write. */
@keyframes yanta-slide-anim-flash {
  from {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 22%, var(--bg));
  }
  to {
    border-color: var(--border);
    background: var(--bg);
  }
}

.yanta-slide-anim-step.is-new {
  animation: yanta-slide-anim-flash 1.4s ease-out;
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
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg);
}

.yanta-slide-anim-step-lead {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

/* What this step animates, at a glance — ids in a list say nothing. */
.yanta-slide-anim-step-thumb {
  width: 40px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}

.yanta-slide-anim-step-thumb.is-empty {
  opacity: 0.35;
}

.yanta-slide-anim-step-index {
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

/**
 * The Excalidraw instance the panel should talk to.
 *
 * Falls back to whatever drawing is on the fullscreen stage: the panel can
 * outlive the instance it was opened against (a remount, a route restore),
 * and a panel wired to a dead API is a panel whose buttons do nothing.
 */
function panelApi() {
  return panel?.getApi?.() || getActiveDrawingApi?.() || null;
}

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

function contains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The slide a set of elements belongs to.
 *
 * A slide that *contains* the selection outright wins over one that merely
 * overlaps it, and among containing slides the smallest wins — slides are free
 * rectangles on one board, so they can nest or overlap, and "largest overlap"
 * alone happily picked the big slide behind the small one the user was
 * actually looking at.
 *
 * @param {string} [activeSlideId]  breaks ties towards the slide in view
 */
export function slideForElements(noteId, drawingId, elements = [], activeSlideId = '') {
  const bounds = boundsOfElements(elements);
  if (!bounds) return null;

  const slides = listSlides(noteId, drawingId);

  let containing = null;
  let containingArea = Infinity;

  let overlapping = null;
  let overlapArea = 0;

  for (const slide of slides) {
    const slideBounds = normalizeSlideBounds(slide.bounds);
    if (!rectsIntersect(slideBounds, bounds)) continue;

    const area = slideBounds.width * slideBounds.height;

    if (contains(slideBounds, bounds)) {
      const preferred = slide.id === activeSlideId && containing?.id !== activeSlideId;

      if (preferred || area < containingArea) {
        containing = slide;
        containingArea = preferred ? -1 : area;
      }

      continue;
    }

    const w = Math.min(slideBounds.x + slideBounds.width, bounds.x + bounds.width) -
      Math.max(slideBounds.x, bounds.x);
    const h = Math.min(slideBounds.y + slideBounds.height, bounds.y + bounds.height) -
      Math.max(slideBounds.y, bounds.y);

    const overlap = Math.max(0, w) * Math.max(0, h);

    if (overlap > overlapArea) {
      overlapArea = overlap;
      overlapping = slide;
    }
  }

  return containing || overlapping;
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
  if (!api) {
    console.warn('[YANTA Slides] add step: no drawing API');
    toast('Drawing is not ready yet', 'error');
    return null;
  }

  const elements = sceneElements(api);
  const selectedIds = selectedElementIdsFromApi(api);

  const ids = expandBuildSelection(elements, selectedIds)
    .filter((id) => {
      const el = elements.find((e) => e.id === id);
      // A slide frame is the camera target, not content — never animate it.
      return el && !isSlideFrameElement(el);
    });

  if (!ids.length) {
    console.warn('[YANTA Slides] add step: nothing selected');
    toast('Select something on the board first', 'error');
    return null;
  }

  const chosen = elements.filter((el) => ids.includes(el.id));

  /*
    The slide is decided by what the user actually selected, never by the
    expanded set. Expansion can reach across a slide boundary (a group member,
    a label), and then the step landed on a different slide than the one the
    context-menu label had just promised.
  */
  const picked = elements.filter(
    (el) => selectedIds.includes(el.id) && !isSlideFrameElement(el)
  );

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
  let slide = slideForElements(
    noteId,
    drawingId,
    picked.length ? picked : chosen,
    // The slide on screen breaks ties, so "Animate on X" and where the step
    // lands cannot disagree.
    preferSlideId || panel?.slideId || ''
  );
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

  const added = {
    id: uid(),
    elementIds: ids,
    effect: 'fade',
    trigger: 'click',
    order: builds.length,
  };

  builds.push(added);

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
    The panel always follows the step that was just created, and flags it so
    render() can flash and scroll to it. Adding a step and not seeing anything
    move is what reads as "the button does nothing" — especially when the
    selection was already animated and the step count therefore stays put.
  */
  if (panel) {
    panel.slideId = slide.id;
    panel.highlightBuildId = added.id;
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

/**
 * Draws a small picture of the objects a step animates.
 *
 * Element ids in a list say nothing; a thumbnail is how you recognise "the
 * headline" versus "the arrow" at a glance. Rendered lazily after the list is
 * in the DOM, so opening the panel stays instant.
 */
async function hydrateStepThumbnails(slide) {
  const root = panel?.root;
  if (!root) return;

  const elements = sceneElements(panelApi());
  const byId = new Map(elements.map((el) => [el.id, el]));

  for (const build of slideAnimation(slide).builds) {
    const host = root.querySelector(`[data-step-thumb="${CSS.escape(build.id)}"]`);
    if (!host) continue;

    const content = build.elementIds
      .map((id) => byId.get(id))
      .filter((el) => el && !el.isDeleted && !isSlideFrameElement(el));

    if (!content.length) {
      host.classList.add('is-empty');
      continue;
    }

    const key = content.map((el) => `${el.id}:${el.version}`).join(',');

    if (host.dataset.thumbKey === key) continue;

    const cached = stepThumbnailCache.get(key);

    if (cached) {
      host.dataset.thumbKey = key;
      host.style.backgroundImage = `url("${cached}")`;
      continue;
    }

    try {
      const { exportToSvg } = await import('@excalidraw/excalidraw');

      const svg = await exportToSvg({
        elements: content,
        appState: {
          exportBackground: false,
          viewBackgroundColor: 'transparent',
        },
        files: {},

        // In-app preview — see renderSlideSvgString in slides-ui.js.
        skipInliningFonts: true,
      });

      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');

      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        new XMLSerializer().serializeToString(svg)
      )}`;

      stepThumbnailCache.set(key, url);

      // The panel may have re-rendered or closed while this was exporting.
      const liveHost = panel?.root?.querySelector(`[data-step-thumb="${CSS.escape(build.id)}"]`);

      if (liveHost) {
        liveHost.dataset.thumbKey = key;
        liveHost.style.backgroundImage = `url("${url}")`;
      }
    } catch {
      host.classList.add('is-empty');
    }
  }
}

function stepSummary(slide, build) {
  const elements = sceneElements(panelApi());
  const known = build.elementIds.filter((id) =>
    elements.some((el) => el.id === id && !el.isDeleted)
  );

  const count = known.length || build.elementIds.length;
  const missing = build.elementIds.length - known.length;

  return `${count} object${count === 1 ? '' : 's'}${missing > 0 ? ' · some deleted' : ''}`;
}

/** Fills the "which slide" picker and keeps it on the panel's target. */
function renderSlidePicker(slides) {
  const select = panel.root.querySelector('[data-anim-slide]');
  if (!select) return;

  if (!slides.length) {
    select.innerHTML = '<option value="">No slide yet</option>';
    select.disabled = true;
    return;
  }

  select.disabled = false;

  select.innerHTML = slides.map((slide, index) => {
    const count = slideAnimation(slide).builds.length;

    return `
      <option value="${escapeAttr(slide.id)}" ${slide.id === panel.slideId ? 'selected' : ''}>
        ${index + 1}. ${escapeHtml(slide.title)}${count ? ` · ${count} step${count === 1 ? '' : 's'}` : ''}
      </option>
    `;
  }).join('');
}

function render() {
  if (!panel?.root?.isConnected) return;

  const slides = listSlides(panel.noteId, panel.drawingId);
  const slide = currentSlide();
  const body = panel.root.querySelector('[data-anim-body]');
  const title = panel.root.querySelector('[data-anim-title]');

  renderSlidePicker(slides);

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
        <div class="yanta-slide-anim-step ${build.id === panel.highlightBuildId ? 'is-new' : ''}"
             data-build="${escapeAttr(build.id)}">
          <span class="yanta-slide-anim-step-lead">
            <span class="yanta-slide-anim-step-index"
                  title="Plays on click ${clickNumber.get(build.id) || 1}">${clickNumber.get(build.id) || 1}</span>
            <span class="yanta-slide-anim-step-thumb" data-step-thumb="${escapeAttr(build.id)}"></span>
          </span>

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

  // Bring the step that was just touched into view, then forget it so the
  // flash does not replay on the next unrelated render.
  if (panel.highlightBuildId) {
    const target = body.querySelector('.yanta-slide-anim-step.is-new');

    target?.scrollIntoView({ block: 'nearest' });
    panel.highlightBuildId = '';
  }

  hydrateStepThumbnails(slide).catch(() => {});
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
function stopPreview() {
  if (!panel?.preview) return;

  window.clearTimeout(panel.preview.timer);
  panel.preview.animator.dispose();
  panel.preview = null;
}

function previewBuild(buildId) {
  /*
    Every bail-out says something. A play button that does nothing and logs
    nothing is impossible to report and impossible to diagnose.
  */
  if (!panelApi()) {
    console.warn('[YANTA Slides] preview: no drawing API');
    toast('Drawing is not ready yet', 'error');
    return;
  }

  const slide = currentSlide();

  if (!slide) {
    console.warn('[YANTA Slides] preview: panel has no slide', panel?.slideId);
    toast('This step no longer belongs to a slide', 'error');
    return;
  }

  const build = slideAnimation(slide).builds.find((b) => b.id === buildId);

  if (!build) {
    console.warn('[YANTA Slides] preview: step not found', buildId);
    toast('Step not found', 'error');
    return;
  }

  /*
    Restart rather than ignore. A "previewing" latch meant a second click did
    nothing, and any path that left the flag set made the play button dead for
    the rest of the session.
  */
  stopPreview();

  const animator = createSlideAnimator({ getApi: () => panelApi() });

  // A one-step slide: hidden first, then played on its own timeline.
  const solo = {
    animation: {
      transition: 'cut',
      builds: [{ ...build, order: 0, trigger: 'click', delay: 0 }],
    },
  };

  animator.showStep(solo, 0);

  panel.preview = {
    animator,
    timer: 0,
  };

  requestAnimationFrame(() => {
    if (panel?.preview?.animator !== animator) return;

    animator.revealStep(solo, 0);

    panel.preview.timer = window.setTimeout(() => {
      if (panel?.preview?.animator !== animator) return;
      stopPreview();
    }, build.duration + 320);
  });
}

/**
 * Points an already-open panel at a different slide. No-op when it is closed —
 * navigating slides should never conjure the panel up.
 */
export function retargetSlideAnimationPanel({ noteId, drawingId, slideId }) {
  if (!panel) return false;
  if (panel.noteId !== noteId || panel.drawingId !== drawingId) return false;
  if (panel.slideId === slideId) return false;

  stopPreview();

  panel.slideId = slideId;
  render();

  return true;
}

export function closeSlideAnimationPanel({ fromHistory = false } = {}) {
  if (!panel) return;

  // A preview must never outlive the panel — it holds elements hidden.
  stopPreview();

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

  /*
    Already open → retarget it, never close and reopen.

    closeSlideAnimationPanel() releases the overlay entry with history.back(),
    which lands asynchronously; the router then syncs to the older state and
    closes the panel that was pushed in the meantime. The panel appeared to
    vanish on "Animate on <slide>", and what was left behind answered to no
    click at all.
  */
  if (panel) {
    stopPreview();

    panel.noteId = noteId;
    panel.drawingId = drawingId;
    panel.slideId = slideId;
    if (getApi) panel.getApi = getApi;

    render();

    return panel.root;
  }

  const root = document.createElement('div');
  root.className = 'yanta-slide-anim-panel';

  root.innerHTML = `
    <div class="yanta-slide-anim-head" data-anim-drag>
      <span>${lucide('sparkles', 16)}</span>
      <h3 data-anim-title>Animation</h3>
      <button class="icon-btn" data-anim-close title="Close">${lucide('x', 16)}</button>
    </div>

    <div class="yanta-slide-anim-target">
      <label for="yanta-anim-slide">Slide</label>
      <select id="yanta-anim-slide" data-anim-slide></select>
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
    highlightBuildId: '',
    preview: null,
    release: null,
  };

  root.querySelector('[data-anim-slide]')?.addEventListener('change', (e) => {
    panel.slideId = e.target.value || null;
    render();
  });

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
      api: panelApi(),
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
