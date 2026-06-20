/*
  YANTA Dashboard Crumple Drag Effect
  -----------------------------------
  Robust canvas mesh deformation for a dashboard drag clone.

  Important:
  This version does NOT use SVG foreignObject snapshots.
  foreignObject often renders transparent in real app CSS contexts.
  Instead we synthesize a clean canvas texture from the clone's DOM layout.
*/

const DEFAULT_OPTIONS = {
  maxProgress: 1,
  cols: 10,
  rows: 14,
  durationMs: 250,
};

const CRUMPLE_FOLDS = [
  { nx: 0.86, ny: 0.51, o: -0.48, w: 0.105, s: -1, p: 1.2, phase: 0.2 },
  { nx: -0.42, ny: 0.91, o: -0.18, w: 0.085, s: 1, p: 1.05, phase: 1.7 },
  { nx: 0.98, ny: -0.19, o: 0.22, w: 0.075, s: -1, p: 1.15, phase: 2.6 },
  { nx: 0.35, ny: 0.94, o: 0.46, w: 0.12, s: 1, p: 0.9, phase: 3.4 },
  { nx: -0.78, ny: 0.63, o: 0.08, w: 0.095, s: -1, p: 1.1, phase: 4.1 },
  { nx: 0.63, ny: 0.78, o: -0.02, w: 0.07, s: 1, p: 0.85, phase: 5.2 },
];

const TEXT_SELECTORS = [
  '.yanta-dash-card-title',
  '.yanta-dash-preview-line',
  '.yanta-dash-empty-preview',
  '.yanta-dash-task span',
  '.yanta-dash-folder-meta',
  '.yanta-dash-folder-preview-title',
  '.yanta-dash-folder-mini-line',
  '.yanta-dash-folder-mini-task span:last-child',
  '.yanta-dash-folder-mini-folder-row span',
  '.yanta-dash-folder-mini-meta',
  '.yanta-dash-folder-mini-empty',
  '.yanta-dash-event-header-title',
  '.yanta-dash-event-header-time',
  '.yanta-dash-event-header-location span',
  '.yanta-dash-event-header-description',
];

const SURFACE_SELECTORS = [
  '.yanta-dash-card',
  '.yanta-dash-card-icon',
  '.yanta-dash-note-corner-icon',
  '.yanta-dash-note-corner-pin',
  '.yanta-dash-note-corner-public',
  '.yanta-dash-count',
  '.yanta-dash-badge',
  '.yanta-dash-media',
  '.yanta-dash-video-thumb',
  '.yanta-dash-drawing-thumb',
  '.yanta-dash-folder-preview-cell',
  '.yanta-dash-folder-preview-icon',
  '.yanta-dash-folder-mini-badge',
  '.yanta-dash-event-header',
  '.yanta-dash-event-header-icon',
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function smoothNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash(ix + iy * 57);
  const b = hash(ix + 1 + iy * 57);
  const c = hash(ix + (iy + 1) * 57);
  const d = hash(ix + 1 + (iy + 1) * 57);

  return (
    a +
    (b - a) * ux +
    (c - a) * uy +
    (a - b - c + d) * ux * uy
  );
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function cssVar(name, fallback = '') {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim() || fallback;
}

function isTransparentColor(value) {
  const s = String(value || '').trim().toLowerCase();

  return (
    !s ||
    s === 'transparent' ||
    s === 'rgba(0, 0, 0, 0)' ||
    s === 'rgba(0,0,0,0)' ||
    /rgba?\([^)]*,\s*0\)$/.test(s)
  );
}

function parsePx(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function elementRectWithin(rootRect, node) {
  const r = node.getBoundingClientRect();

  return {
    x: r.left - rootRect.left,
    y: r.top - rootRect.top,
    width: r.width,
    height: r.height,
    right: r.right - rootRect.left,
    bottom: r.bottom - rootRect.top,
  };
}

function roundRectPath(ctx, x, y, width, height, radius = 0) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  if (width <= 0 || height <= 0) return;

  ctx.save();
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
}

function strokeRoundRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
  if (width <= 0 || height <= 0 || lineWidth <= 0) return;

  ctx.save();
  roundRectPath(
    ctx,
    x + lineWidth / 2,
    y + lineWidth / 2,
    Math.max(0, width - lineWidth),
    Math.max(0, height - lineWidth),
    Math.max(0, radius - lineWidth / 2)
  );

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function computedCanvasFont(style) {
  const fontStyle = style.fontStyle || 'normal';
  const fontVariant = style.fontVariant || 'normal';
  const fontWeight = style.fontWeight || '400';
  const fontSize = style.fontSize || '12px';
  const fontFamily = style.fontFamily || 'system-ui, sans-serif';

  return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`;
}

function textFromNode(node) {
  return String(node?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function drawWrappedText(ctx, text, x, y, maxWidth, maxHeight, lineHeight) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return;

  const maxLines = Math.max(1, Math.floor(maxHeight / Math.max(1, lineHeight)));
  const lines = [];

  let line = '';

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;

    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
      continue;
    }

    lines.push(line);
    line = word;

    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && line) {
    lines.push(line);
  }

  for (let i = 0; i < lines.length; i++) {
    let out = lines[i];

    if (i === maxLines - 1) {
      while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
        out = out.slice(0, -1);
      }

      if (out !== lines[i]) out += '…';
    }

    ctx.fillText(out, x, y + i * lineHeight);
  }
}

function drawElementBackground(ctx, rootRect, node) {
  if (!(node instanceof HTMLElement)) return;

  const rect = elementRectWithin(rootRect, node);

  if (rect.width < 1 || rect.height < 1) return;

  const style = getComputedStyle(node);

  const isMainCard = node.classList.contains('yanta-dash-card');

  let bg = style.backgroundColor;

  if (isTransparentColor(bg) && isMainCard) {
    bg = cssVar('--bg-elev', '#222432');
  }

  const borderColor = style.borderTopColor;
  const borderWidth = parsePx(style.borderTopWidth, 0);
  const radius = parsePx(style.borderTopLeftRadius, isMainCard ? 16 : 8);

  if (!isTransparentColor(bg)) {
    fillRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius, bg);
  }

  if (
    borderWidth > 0 &&
    !isTransparentColor(borderColor) &&
    node.matches(SURFACE_SELECTORS.join(','))
  ) {
    strokeRoundRect(
      ctx,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      radius,
      borderColor,
      Math.min(2, borderWidth)
    );
  }
}

function drawImageOrPlaceholder(ctx, rootRect, node) {
  if (!(node instanceof HTMLElement)) return;

  const rect = elementRectWithin(rootRect, node);
  if (rect.width < 6 || rect.height < 6) return;

  if (node.tagName === 'IMG') {
    try {
      const img = node;

      if (img.complete && img.naturalWidth > 0) {
        ctx.save();
        roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, 8);
        ctx.clip();

        ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();

        return;
      }
    } catch {
      // Cross-origin or decode issue. Fall through to placeholder.
    }
  }

  if (
    node.classList.contains('yanta-dash-media') ||
    node.classList.contains('yanta-dash-video-thumb') ||
    node.classList.contains('yanta-dash-drawing-thumb')
  ) {
    const style = getComputedStyle(node);

    fillRoundRect(
      ctx,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      parsePx(style.borderTopLeftRadius, 10),
      cssVar('--bg', '#111119')
    );

    ctx.save();
    ctx.fillStyle = cssVar('--text-faint', 'rgba(160,160,180,.72)');
    ctx.font = '700 11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const label = node.classList.contains('yanta-dash-video-thumb')
      ? 'Video'
      : node.classList.contains('yanta-dash-drawing-thumb')
        ? 'Drawing'
        : 'Media';

    ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();
  }
}

function drawTextElement(ctx, rootRect, node) {
  if (!(node instanceof HTMLElement)) return;

  const text = textFromNode(node);
  if (!text) return;

  const rect = elementRectWithin(rootRect, node);
  if (rect.width < 4 || rect.height < 4) return;

  const style = getComputedStyle(node);

  ctx.save();

  ctx.font = computedCanvasFont(style);
  ctx.fillStyle = isTransparentColor(style.color)
    ? cssVar('--text', '#e8e6f0')
    : style.color;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const fontSize = parsePx(style.fontSize, 12);
  const lineHeightRaw = parsePx(style.lineHeight, 0);
  const lineHeight = lineHeightRaw > 0 ? lineHeightRaw : fontSize * 1.35;

  const paddingX = Math.min(4, Math.max(0, rect.width * 0.03));
  const maxWidth = Math.max(1, rect.width - paddingX * 2);
  const maxHeight = Math.max(1, rect.height);

  drawWrappedText(
    ctx,
    text,
    rect.x + paddingX,
    rect.y,
    maxWidth,
    maxHeight,
    lineHeight
  );

  ctx.restore();
}

function drawTaskControls(ctx, rootRect, source) {
  const boxes = source.querySelectorAll('.yanta-dash-task input[type="checkbox"]');

  for (const box of boxes) {
    const rect = elementRectWithin(rootRect, box);
    if (rect.width < 4 || rect.height < 4) continue;

    ctx.save();

    const checked = box.checked;

    strokeRoundRect(
      ctx,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      4,
      checked ? cssVar('--accent', '#7c5cff') : cssVar('--text-faint', '#888'),
      1.4
    );

    if (checked) {
      fillRoundRect(
        ctx,
        rect.x + 2,
        rect.y + 2,
        rect.width - 4,
        rect.height - 4,
        3,
        cssVar('--accent', '#7c5cff')
      );
    }

    ctx.restore();
  }
}

function drawSyntheticTexture(source, width, height) {
  const canvas = document.createElement('canvas');

  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const ctx = canvas.getContext('2d', {
    alpha: true,
    desynchronized: true,
  });

  const rootRect = source.getBoundingClientRect();

  /*
    1. Surfaces/backgrounds in DOM order.
  */
  const surfaceNodes = [
    source,
    ...source.querySelectorAll(SURFACE_SELECTORS.join(',')),
  ].filter((node, index, arr) => arr.indexOf(node) === index);

  for (const node of surfaceNodes) {
    drawElementBackground(ctx, rootRect, node);
  }

  /*
    2. Media/images/placeholders.
  */
  const mediaNodes = source.querySelectorAll(
    'img, .yanta-dash-media, .yanta-dash-video-thumb, .yanta-dash-drawing-thumb'
  );

  for (const node of mediaNodes) {
    drawImageOrPlaceholder(ctx, rootRect, node);
  }

  /*
    3. Task controls.
  */
  drawTaskControls(ctx, rootRect, source);

  /*
    4. Text on top.
  */
  const textNodes = source.querySelectorAll(TEXT_SELECTORS.join(','));

  for (const node of textNodes) {
    drawTextElement(ctx, rootRect, node);
  }

  /*
    5. If something went wrong and texture is too empty, draw a minimal card.
  */
  if (!canvasHasVisiblePixels(canvas)) {
    ctx.clearRect(0, 0, width, height);

    fillRoundRect(
      ctx,
      0,
      0,
      width,
      height,
      16,
      cssVar('--bg-elev', '#222432')
    );

    strokeRoundRect(
      ctx,
      0.5,
      0.5,
      width - 1,
      height - 1,
      16,
      cssVar('--border', 'rgba(255,255,255,.14)'),
      1
    );

    const title = textFromNode(source.querySelector('.yanta-dash-card-title')) ||
      source.dataset.kind ||
      'Item';

    ctx.save();
    ctx.fillStyle = cssVar('--text', '#e8e6f0');
    ctx.font = '800 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'top';
    drawWrappedText(ctx, title, 12, 12, width - 24, height - 24, 18);
    ctx.restore();
  }

  return canvas;
}

function canvasHasVisiblePixels(canvas) {
  try {
    const ctx = canvas.getContext('2d', {
      willReadFrequently: true,
    });

    const w = canvas.width;
    const h = canvas.height;

    if (!w || !h) return false;

    const sampleW = Math.min(w, 80);
    const sampleH = Math.min(h, 80);

    const image = ctx.getImageData(0, 0, sampleW, sampleH);
    const data = image.data;

    let visible = 0;

    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) {
        visible++;

        if (visible > 24) return true;
      }
    }

    return false;
  } catch {
    /*
      If reading fails, assume visible to avoid unnecessary fallback loops.
    */
    return true;
  }
}

function deformedPos(origX, origY, t, width, height) {
  if (t < 0.001) {
    return {
      x: origX,
      y: origY,
      z: 0,
      crease: 0,
      valley: 0,
      ridge: 0,
    };
  }

  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);

  const nx0 = (origX - cx) / cx;
  const ny0 = (origY - cy) / cy;

  const id = origX * 7.31 + origY * 13.17;

  const r1 = hash(id + 1);
  const r2 = hash(id + 2);
  const r3 = hash(id + 3);
  const r4 = hash(id + 4);
  const r5 = hash(id + 5);
  const r6 = hash(id + 6);

  const edgeDist = Math.max(Math.abs(nx0), Math.abs(ny0));

  /*
    Slightly off-center collapse point.
    This makes the card crumple into a small irregular mass instead of
    staying as a flat scaled rectangle.
  */
  const knotX = cx + (smoothNoise(3.7, 9.2) - 0.5) * width * 0.2;
  const knotY = cy + (smoothNoise(8.1, 2.4) - 0.5) * height * 0.18;

  const radialToKnot = Math.sqrt(
    Math.pow((origX - knotX) / cx, 2) +
    Math.pow((origY - knotY) / cy, 2)
  );

  const edgeT = smoothstep(0, 0.72, t);
  const centerT = smoothstep(0.18, 1, t);

  const edgeCompress = edgeT * Math.pow(edgeDist, 0.9) * 0.66;
  const centerCompress =
    centerT *
    (0.24 + 0.24 * (1 - smoothstep(0.15, 1.15, radialToKnot)));

  const totalCompress = Math.min(0.92, edgeCompress + centerCompress);

  let x = knotX + (origX - knotX) * (1 - totalCompress);
  let y = knotY + (origY - knotY) * (1 - totalCompress);

  const foldT = smoothstep(0.03, 0.72, t);
  const wrinkleT = smoothstep(0.12, 0.9, t);

  const foldAmpZ = minDim * (0.2 * foldT + 0.12 * t * t);
  const foldAmpXY = minDim * (0.045 + 0.06 * t) * foldT;

  let z = 0;
  let crease = 0;
  let valley = 0;
  let ridge = 0;

  /*
    Actual crease fields.
    These create ridges/valleys and local pinching toward fold lines.
  */
  for (const f of CRUMPLE_FOLDS) {
    const invLen = 1 / Math.max(0.0001, Math.hypot(f.nx, f.ny));
    const ax = f.nx * invLen;
    const ay = f.ny * invLen;

    const lineDist = nx0 * ax + ny0 * ay - f.o;
    const along = -nx0 * ay + ny0 * ax;

    const profile =
      Math.exp(-(lineDist * lineDist) / (f.w * f.w)) *
      (0.38 + 0.62 * Math.exp(-(along * along) / 1.7));

    const side = Math.tanh(lineDist / (f.w * 0.72));
    const signed = profile * f.s * f.p;

    crease += profile * f.p;

    if (f.s < 0) {
      valley += profile * f.p;
    } else {
      ridge += profile * f.p;
    }

    z += signed * foldAmpZ;

    /*
      Pull both sides toward the fold line.
      This makes the texture buckle instead of just changing z.
    */
    const pinch = -side * profile * foldAmpXY * f.p;

    x += ax * pinch;
    y += ay * pinch;

    /*
      Small shear along the fold direction for crushed-paper irregularity.
    */
    const shear =
      Math.sin(along * 4.2 + f.phase) *
      profile *
      foldAmpXY *
      0.34 *
      f.p;

    x += -ay * shear;
    y += ax * shear;
  }

  /*
    Fine wrinkles.
  */
  const n1 = smoothNoise(nx0 * 12 + 5, ny0 * 12 + 11) - 0.5;
  const n2 = smoothNoise(nx0 * 24 + 13, ny0 * 24 + 3) - 0.5;
  const n3 = smoothNoise(nx0 * 38 + 21, ny0 * 38 + 17) - 0.5;

  const wrinkle = n1 * 0.9 + n2 * 0.45 + n3 * 0.25;

  z += wrinkle * minDim * 0.07 * wrinkleT;

  x +=
    (smoothNoise(nx0 * 18 + 15, ny0 * 18 + 20) - 0.5) *
    minDim *
    0.035 *
    wrinkleT;

  y +=
    (smoothNoise(nx0 * 18 + 25, ny0 * 18 + 8) - 0.5) *
    minDim *
    0.035 *
    wrinkleT;

  /*
    Edges curl and tear visually into the crumple.
  */
  const edgeCurl = smoothstep(0.68, 1, edgeDist) * t;
  const edgeSign = hash(Math.round(nx0 * 4) + Math.round(ny0 * 5) * 17 + 91) - 0.35;

  z += edgeCurl * minDim * 0.16 * edgeSign;

  if (edgeDist > 0.82) {
    const rough =
      t *
      minDim *
      0.055 *
      Math.pow((edgeDist - 0.82) / 0.18, 0.55);

    x += (r5 - 0.5) * rough;
    y += (r6 - 0.5) * rough;
  }

  /*
    Subtle global twist.
  */
  const rot = t * 0.10;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  const dx = x - cx;
  const dy = y - cy;

  x = cx + dx * cosR - dy * sinR;
  y = cy + dx * sinR + dy * cosR;

  return {
    x,
    y,
    z,
    crease: clamp(crease * 0.38 + Math.abs(wrinkle) * 0.32 + edgeCurl * 0.25, 0, 1),
    valley: clamp(valley * 0.45, 0, 1),
    ridge: clamp(ridge * 0.38, 0, 1),
  };
}

function drawTexturedTriangle(
  ctx,
  img,
  sx0,
  sy0,
  sx1,
  sy1,
  sx2,
  sy2,
  dx0,
  dy0,
  dx1,
  dy1,
  dx2,
  dy2
) {
  const det =
    sx0 * (sy1 - sy2) +
    sx1 * (sy2 - sy0) +
    sx2 * (sy0 - sy1);

  if (Math.abs(det) < 0.001) return;

  const a =
    (dx0 * (sy1 - sy2) +
      dx1 * (sy2 - sy0) +
      dx2 * (sy0 - sy1)) /
    det;

  const b =
    (dy0 * (sy1 - sy2) +
      dy1 * (sy2 - sy0) +
      dy2 * (sy0 - sy1)) /
    det;

  const c =
    (sx0 * (dx1 - dx2) +
      sx1 * (dx2 - dx0) +
      sx2 * (dx0 - dx1)) /
    det;

  const d =
    (sx0 * (dy1 - dy2) +
      sx1 * (dy2 - dy0) +
      sx2 * (dy0 - dy1)) /
    det;

  const e =
    (sx0 * (sy1 * dx2 - sy2 * dx1) +
      sx1 * (sy2 * dx0 - sy0 * dx2) +
      sx2 * (sy0 * dx1 - sy1 * dx0)) /
    det;

  const f =
    (sx0 * (sy1 * dy2 - sy2 * dy1) +
      sx1 * (sy2 * dy0 - sy0 * dy2) +
      sx2 * (sy0 * dy1 - sy1 * dy0)) /
    det;

  ctx.save();

  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();

  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);

  ctx.restore();
}

function drawTriangleShading(ctx, v0, v1, v2, intensity) {
  const e1x = v1.x - v0.x;
  const e1y = v1.y - v0.y;
  const e1z = v1.z - v0.z;

  const e2x = v2.x - v0.x;
  const e2y = v2.y - v0.y;
  const e2z = v2.z - v0.z;

  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 0.001) return;

  nx /= len;
  ny /= len;
  nz /= len;

  /*
    Keep normals facing the viewer so back-facing triangle winding does not
    invert the lighting randomly.
  */
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }

  const lightX = -0.42;
  const lightY = -0.58;
  const lightZ = 0.7;
  const lightLen = Math.sqrt(lightX * lightX + lightY * lightY + lightZ * lightZ);

  const lambert = clamp(
    (nx * lightX + ny * lightY + nz * lightZ) / lightLen,
    0,
    1
  );

  const crease =
    ((v0.crease || 0) + (v1.crease || 0) + (v2.crease || 0)) / 3;

  const valley =
    ((v0.valley || 0) + (v1.valley || 0) + (v2.valley || 0)) / 3;

  const ridge =
    ((v0.ridge || 0) + (v1.ridge || 0) + (v2.ridge || 0)) / 3;

  /*
    Darkening from surface tilt + explicit valley crease shadow.
  */
  const sideShadow = clamp((0.86 - nz) * 0.62, 0, 0.38);

  const darkAlpha = clamp(
    (
      Math.max(0, 0.7 - lambert) * 0.48 +
      sideShadow +
      valley * 0.26 +
      crease * 0.14
    ) * intensity,
    0,
    0.06
  );

  if (darkAlpha > 0.01) {
    ctx.fillStyle = `rgba(7,6,12,${darkAlpha.toFixed(3)})`;

    ctx.beginPath();
    ctx.moveTo(v0.x, v0.y);
    ctx.lineTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    ctx.closePath();
    ctx.fill();
  }

  /*
    Small ridge highlights.
  */
  const highlightAlpha = clamp(
    (
      Math.max(0, lambert - 0.78) * 0.22 +
      ridge * 0.08
    ) * intensity,
    0,
    0.22
  );

  if (highlightAlpha > 0.01) {
    ctx.fillStyle = `rgba(255,255,245,${highlightAlpha.toFixed(3)})`;

    ctx.beginPath();
    ctx.moveTo(v0.x, v0.y);
    ctx.lineTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawInternalFoldShadow(ctx, a, b, intensity, width, height) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);

  if (len < 1) return;

  const minDim = Math.min(width, height);

  const dz = Math.abs(a.z - b.z) / Math.max(1, minDim * 0.11);
  const crease = ((a.crease || 0) + (b.crease || 0)) / 2;
  const valley = ((a.valley || 0) + (b.valley || 0)) / 2;

  const alpha = clamp(
    (dz * 0.18 + crease * 0.11 + valley * 0.22 - 0.045) * intensity,
    0,
    0.34
  );

  if (alpha <= 0.018) return;

  ctx.save();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = clamp(
    minDim * (0.004 + 0.007 * clamp(crease + valley, 0, 1)),
    0.75,
    3.25
  );

  ctx.strokeStyle = `rgba(4,3,8,${alpha.toFixed(3)})`;
  ctx.shadowColor = `rgba(0,0,0,${(alpha * 0.75).toFixed(3)})`;
  ctx.shadowBlur = 2.5;

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.restore();
}

class DashboardCrumpleController {
  constructor(clone, options = {}) {
    this.clone = clone;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.width = 0;
    this.height = 0;

    this.canvas = null;
    this.ctx = null;
    this.texture = null;

    this.ready = false;
    this.destroyed = false;

    this.intensity = 0;
    this.targetIntensity = 0;
    this.raf = 0;

    this.prepare();
  }

  prepare() {
    if (prefersReducedMotion()) return;
    if (!this.clone?.isConnected) return;

    const rect = this.clone.getBoundingClientRect();

    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));

    try {
      this.texture = drawSyntheticTexture(
        this.clone,
        this.width,
        this.height
      );

      if (this.destroyed || !this.clone?.isConnected) return;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'yanta-crumple-canvas';
      this.canvas.width = this.width;
      this.canvas.height = this.height;

      Object.assign(this.canvas.style, {
        width: '100%',
        height: '100%',
      });

      this.ctx = this.canvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
      });

      this.clone.append(this.canvas);

      this.ready = true;
      this.render();

      if (this.targetIntensity > 0.001) {
        this.clone.classList.add('yanta-crumple-active');
        this.animateToTarget();
      }
    } catch (err) {
      console.warn('[YANTA Dashboard] Crumple texture failed', err);

      /*
        Do not hide children if texture generation fails.
        Let the DOM clone remain visible.
      */
      this.ready = false;
      this.clone?.classList?.remove('yanta-crumple-active');
    }
  }

  setActive(active, { immediate = false } = {}) {
    this.setIntensity(active ? 1 : 0, {
      immediate,
    });
  }

  setIntensity(value, { immediate = false } = {}) {
    this.targetIntensity = clamp(Number(value) || 0, 0, 1);

    if (!this.ready) {
      return;
    }

    if (this.targetIntensity > 0.001) {
      this.clone?.classList?.add('yanta-crumple-active');
    }

    if (immediate) {
      this.intensity = this.targetIntensity;
      this.render();

      if (this.intensity <= 0.001) {
        this.clone?.classList?.remove('yanta-crumple-active');
      }

      return;
    }

    this.animateToTarget();
  }

  animateToTarget() {
    if (this.destroyed || !this.ready) return;

    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    const from = this.intensity;
    const to = this.targetIntensity;
    const start = performance.now();
    const duration = this.options.durationMs;

    const tick = () => {
      if (this.destroyed || !this.ready) {
        this.raf = 0;
        return;
      }

      const raw = clamp((performance.now() - start) / duration, 0, 1);
      const eased = easeOutCubic(raw);

      this.intensity = from + (to - from) * eased;

      this.render();

      if (raw < 1) {
        this.raf = requestAnimationFrame(tick);
        return;
      }

      this.intensity = to;
      this.raf = 0;

      this.render();

      if (this.intensity <= 0.001) {
        this.clone?.classList?.remove('yanta-crumple-active');
      }
    };

    this.raf = requestAnimationFrame(tick);
  }

  render() {
    if (!this.ready || !this.ctx || !this.texture) return;

    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    const cols = this.options.cols;
    const rows = this.options.rows;

    const t = this.intensity * this.options.maxProgress;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (this.intensity <= 0.001) {
      ctx.drawImage(this.texture, 0, 0, width, height);
      return;
    }

    const verts = [];

    for (let r = 0; r <= rows; r++) {
      verts[r] = [];

      for (let c = 0; c <= cols; c++) {
        const ox = (c / cols) * width;
        const oy = (r / rows) * height;
        const d = deformedPos(ox, oy, t, width, height);

        verts[r][c] = {
          x: d.x,
          y: d.y,
          z: d.z,
          ox,
          oy,
        };
      }
    }

    const tris = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = verts[r][c];
        const b = verts[r][c + 1];
        const d = verts[r + 1][c];
        const e = verts[r + 1][c + 1];

        tris.push({
          v: [a, b, d],
          z: (a.z + b.z + d.z) / 3,
        });

        tris.push({
          v: [b, e, d],
          z: (b.z + e.z + d.z) / 3,
        });
      }
    }

    tris.sort((a, b) => a.z - b.z);

    for (const tri of tris) {
      const [v0, v1, v2] = tri.v;

      drawTexturedTriangle(
        ctx,
        this.texture,
        v0.ox,
        v0.oy,
        v1.ox,
        v1.oy,
        v2.ox,
        v2.oy,
        v0.x,
        v0.y,
        v1.x,
        v1.y,
        v2.x,
        v2.y
      );

      drawTriangleShading(ctx, v0, v1, v2, this.intensity);
    }

    /*
      Inner crease shadows.
      These are intentionally drawn after the textured triangles so valleys
      remain visible even when the original card texture is bright.
    */
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        drawInternalFoldShadow(
          ctx,
          verts[r][c],
          verts[r][c + 1],
          this.intensity,
          width,
          height
        );
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        drawInternalFoldShadow(
          ctx,
          verts[r][c],
          verts[r + 1][c],
          this.intensity,
          width,
          height
        );
      }
    }

    ctx.restore();

  }

  destroy() {
    this.destroyed = true;

    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    this.canvas?.remove();

    this.clone?.classList?.remove(
      'yanta-crumple-active',
      'is-trash-crumple-preview'
    );

    this.canvas = null;
    this.ctx = null;
    this.texture = null;
    this.clone = null;
  }
}

export function createDashboardCrumpleController(clone, options = {}) {
  return new DashboardCrumpleController(clone, options);
}