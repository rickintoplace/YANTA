// ============================================================
// YANTA — Floating Quick Actions trigger icons
//
// Each icon is a small, self-contained morph that animates between
// its resting glyph (progress 0) and a close "X" (progress 1).
//
// An icon exposes:
//   markup()      -> SVG string in its resting state (also used as a
//                    static preview in Settings).
//   init(svgEl)   -> { setProgress(p), animateTo(target) }.
//
// The RAF loop, easing and reduced-motion handling are shared via
// createAnimator() so each icon only implements a pure setProgress(p).
// ============================================================

import {
  FLOATING_CREATE_ICON_STYLES,
  DEFAULT_FLOATING_CREATE_ICON_STYLE,
} from './floating-create-settings.js';

// ---- shared math -------------------------------------------------

const DURATION = 420;

const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

const smooth = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};

function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

let filterUid = 0;

/**
 * Drives a pure `render(progress)` callback with an eased RAF loop.
 * Interruptible: re-targeting mid-flight eases from the current value.
 */
function createAnimator(render) {
  let progress = 0;
  let raf = null;

  const apply = (p) => {
    progress = clamp(p);
    render(progress);
  };

  function animateTo(target) {
    const end = clamp(target);

    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }

    if (prefersReducedMotion()) {
      apply(end);
      return;
    }

    const start = progress;
    const startTime = performance.now();

    const step = (now) => {
      const t = clamp((now - startTime) / DURATION);

      apply(lerp(start, end, smooth(t)));

      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        apply(end);
        raf = null;
      }
    };

    raf = requestAnimationFrame(step);
  }

  apply(0);

  return { setProgress: apply, animateTo };
}

/**
 * Reveals the four X half-strokes together. Each `<path>` starts at the
 * center, so a single dash offset grows all arms outward symmetrically —
 * no directional top-to-bottom wipe.
 */
function drawXLines(xLines, xLengths, xDraw) {
  xLines.forEach((line, i) => {
    const len = xLengths[i];

    line.setAttribute('opacity', xDraw);
    line.setAttribute('stroke-dasharray', len);
    line.setAttribute('stroke-dashoffset', len * (1 - xDraw));
  });
}

// The X is four half-strokes emanating from the center to each corner.
// Kept identical for every icon so the reveal reads the same everywhere.
const X_LINES_MARKUP = `
        <path data-qc-x-line d="M12 12 18 6" opacity="0"/>
        <path data-qc-x-line d="M12 12 6 18" opacity="0"/>
        <path data-qc-x-line d="M12 12 6 6" opacity="0"/>
        <path data-qc-x-line d="M12 12 18 18" opacity="0"/>`;

// ---- icon: bubbles ----------------------------------------------
// Three stroke bubbles merge (goo filter), pop into a burst, draw an X.

function bubblesMarkup() {
  const goo = `qc-goo-${++filterUid}`;

  return `
    <svg
      class="yanta-qc-trigger-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false">
      <defs>
        <filter id="${goo}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.75" result="blur"/>
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
            result="goo"/>
        </filter>
      </defs>

      <g data-qc-bubble-group filter="url(#${goo})" fill="none" stroke-width="2">
        <circle data-qc-bubble="big" cx="7.5" cy="16.5" r="5.5"/>
        <circle data-qc-bubble="right" cx="18.5" cy="8.5" r="3.5"/>
        <circle data-qc-bubble="small" cx="7.5" cy="4.5" r="2.5"/>
        <path data-qc-bubble-arc d="M7.001 15.085A1.5 1.5 0 0 1 9 16.5"/>
      </g>

      <g data-qc-burst-group fill="none" opacity="0" stroke-width="1.5">
        <line x1="12" y1="5.2" x2="12" y2="2.2"/>
        <line x1="17" y1="7" x2="19.2" y2="4.8"/>
        <line x1="18.8" y1="12" x2="21.8" y2="12"/>
        <line x1="17" y1="17" x2="19.2" y2="19.2"/>
        <line x1="7" y1="17" x2="4.8" y2="19.2"/>
        <line x1="5.2" y1="12" x2="2.2" y2="12"/>
      </g>

      <g data-qc-x-group fill="none">${X_LINES_MARKUP}
      </g>
    </svg>
  `;
}

function initBubbles(svg) {
  const q = (sel) => svg.querySelector(sel);

  const bubbleGroup = q('[data-qc-bubble-group]');
  const bubbleArc = q('[data-qc-bubble-arc]');
  const burstGroup = q('[data-qc-burst-group]');
  const burstLines = [...burstGroup.querySelectorAll('line')];
  const xLines = [...svg.querySelectorAll('[data-qc-x-line]')];
  const xLengths = xLines.map((line) => line.getTotalLength());

  const bubbles = [
    { el: q('[data-qc-bubble="big"]'), cx: 7.5, cy: 16.5, r: 5.5, mergedR: 6.2 },
    { el: q('[data-qc-bubble="right"]'), cx: 18.5, cy: 8.5, r: 3.5, mergedR: 5.7 },
    { el: q('[data-qc-bubble="small"]'), cx: 7.5, cy: 4.5, r: 2.5, mergedR: 5.2 },
  ];

  return createAnimator((progress) => {
    const merge = smooth(progress / 0.62);
    const pop = smooth((progress - 0.58) / 0.18);
    const xDraw = smooth((progress - 0.68) / 0.28);

    const bubbleOpacity = 1 - pop;
    const gooStroke = lerp(2, 2.6, merge) * bubbleOpacity;

    bubbleGroup.setAttribute('opacity', bubbleOpacity);
    bubbleGroup.setAttribute('stroke-width', Math.max(0.01, gooStroke));

    bubbles.forEach(({ el, cx, cy, r, mergedR }) => {
      const wobble = Math.sin(progress * Math.PI * 2) * 0.15 * (1 - pop);

      el.setAttribute('cx', lerp(cx, 12, merge));
      el.setAttribute('cy', lerp(cy, 12, merge));
      el.setAttribute('r', Math.max(0.01, lerp(r, mergedR + wobble, merge) * bubbleOpacity));
    });

    bubbleArc.setAttribute('opacity', Math.max(0, 1 - merge * 1.4));
    bubbleArc.setAttribute(
      'transform',
      `translate(${lerp(0, 4.1, merge)} ${lerp(0, -3.5, merge)}) scale(${lerp(1, 0.15, merge)})`
    );

    // Burst appears while popping, symmetric on reverse.
    const burstPhase = clamp((progress - 0.58) / 0.34);

    burstGroup.setAttribute('opacity', Math.sin(burstPhase * Math.PI));

    burstLines.forEach((line, i) => {
      const offset = burstPhase * 2.8;

      line.setAttribute('stroke-dasharray', '3');
      line.setAttribute('stroke-dashoffset', 3 - offset - i * 0.12);
    });

    drawXLines(xLines, xLengths, xDraw);
  });
}

// ---- icon: loader (radial spokes) -------------------------------
// Two-beat morph:
//   1. cardinal spokes (12/3/6/9) pull inward to a small +, while the
//      diagonal spokes rotate 45° onto the axes to form a large + —
//      together one continuous plus sign.
//   2. the whole glyph rotates 45°, turning that plus into the final X.

const LOADER_CENTER = 12;
const LOADER_BASE_INNER = 6;
const LOADER_BASE_OUTER = 9.5;
const LOADER_MID = 4.24; // seam between the small + and the large +
const LOADER_OUTER = 8.49; // reaches a 6,6 corner once rotated

function spokePoint(angleDeg, r) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: LOADER_CENTER + Math.sin(rad) * r,
    y: LOADER_CENTER - Math.cos(rad) * r,
  };
}

function loaderMarkup() {
  const lines = Array.from({ length: 8 }, (_, i) => {
    const angle = i * 45;
    const a = spokePoint(angle, LOADER_BASE_INNER);
    const b = spokePoint(angle, LOADER_BASE_OUTER);

    return `<line
      data-qc-spoke
      x1="${a.x.toFixed(3)}" y1="${a.y.toFixed(3)}"
      x2="${b.x.toFixed(3)}" y2="${b.y.toFixed(3)}"/>`;
  }).join('');

  return `
    <svg
      class="yanta-qc-trigger-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false">
      <g data-qc-loader-group fill="none">${lines}</g>
    </svg>
  `;
}

function initLoader(svg) {
  const group = svg.querySelector('[data-qc-loader-group]');
  const spokes = [...group.querySelectorAll('[data-qc-spoke]')];

  return createAnimator((progress) => {
    const plus = smooth(clamp(progress / 0.62)); // spokes gather into a +
    const spin = smooth(clamp((progress - 0.55) / 0.45)); // + rotates into X

    group.setAttribute('transform', `rotate(${(45 * spin).toFixed(3)} 12 12)`);

    spokes.forEach((line, i) => {
      const cardinal = i % 2 === 0;
      const baseAngle = i * 45;

      // Cardinals hold their axis and shrink to the inner +; diagonals
      // rotate 45° onto the axes and become the outer + arms.
      const angle = cardinal ? baseAngle : lerp(baseAngle, baseAngle + 45, plus);
      const inner = lerp(LOADER_BASE_INNER, cardinal ? 0 : LOADER_MID, plus);
      const outer = lerp(LOADER_BASE_OUTER, cardinal ? LOADER_MID : LOADER_OUTER, plus);

      const a = spokePoint(angle, inner);
      const b = spokePoint(angle, outer);

      line.setAttribute('x1', a.x.toFixed(3));
      line.setAttribute('y1', a.y.toFixed(3));
      line.setAttribute('x2', b.x.toFixed(3));
      line.setAttribute('y2', b.y.toFixed(3));
    });
  });
}

// ---- icon: gamepad (D-pad) --------------------------------------
// The D-pad spins 45° and collapses toward center while an X draws in.

function gamepadMarkup() {
  return `
    <svg
      class="yanta-qc-trigger-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false">
      <g data-qc-gamepad fill="none">
        <path d="M11.146 15.854a1.207 1.207 0 0 1 1.708 0l1.56 1.56A2 2 0 0 1 15 18.828V21a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2.172a2 2 0 0 1 .586-1.414z"/>
        <path d="M18.828 15a2 2 0 0 1-1.414-.586l-1.56-1.56a1.207 1.207 0 0 1 0-1.708l1.56-1.56A2 2 0 0 1 18.828 9H21a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1z"/>
        <path d="M6.586 14.414A2 2 0 0 1 5.172 15H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2.172a2 2 0 0 1 1.414.586l1.56 1.56a1.207 1.207 0 0 1 0 1.708z"/>
        <path d="M9 3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.172a2 2 0 0 1-.586 1.414l-1.56 1.56a1.207 1.207 0 0 1-1.708 0l-1.56-1.56A2 2 0 0 1 9 5.172z"/>
      </g>

      <g data-qc-x-group fill="none">${X_LINES_MARKUP}
      </g>
    </svg>
  `;
}

function initGamepad(svg) {
  const gamepad = svg.querySelector('[data-qc-gamepad]');
  const xGroup = svg.querySelector('[data-qc-x-group]');
  const xLines = [...svg.querySelectorAll('[data-qc-x-line]')];
  const xLengths = xLines.map((line) => line.getTotalLength());

  const spin = (scale, rot = 0) =>
    `translate(12 12) rotate(${rot}) scale(${scale}) translate(-12 -12)`;

  return createAnimator((progress) => {
    const e = smooth(progress);

    gamepad.setAttribute('transform', spin(lerp(1, 0.62, e), 45 * e));
    gamepad.setAttribute('opacity', 1 - smooth(clamp((progress - 0.5) / 0.4)));

    const xDraw = smooth(clamp((progress - 0.45) / 0.55));

    xGroup.setAttribute('transform', spin(lerp(0.6, 1, xDraw)));

    drawXLines(xLines, xLengths, xDraw);
  });
}

// ---- registry ----------------------------------------------------

export const FLOATING_CREATE_ICONS = Object.freeze({
  bubbles: { label: 'Bubbles', markup: bubblesMarkup, init: initBubbles },
  loader: { label: 'Radial', markup: loaderMarkup, init: initLoader },
  gamepad: { label: 'D-Pad', markup: gamepadMarkup, init: initGamepad },
});

export const FLOATING_CREATE_ICON_OPTIONS = FLOATING_CREATE_ICON_STYLES.map((id) => ({
  id,
  label: FLOATING_CREATE_ICONS[id].label,
}));

export function resolveFloatingCreateIcon(styleId) {
  return FLOATING_CREATE_ICONS[styleId] || FLOATING_CREATE_ICONS[DEFAULT_FLOATING_CREATE_ICON_STYLE];
}

/** Resting-state SVG string for a style — used as a static preview. */
export function floatingCreateIconPreview(styleId) {
  return resolveFloatingCreateIcon(styleId).markup();
}
