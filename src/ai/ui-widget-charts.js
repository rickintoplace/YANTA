// ============================================================
// YANTA AI — charts for chat widgets
//
// Bar, line and donut charts as SVG, drawn at the width they are shown
// at (text stays 11 px on a phone and on a wide pane), with:
//   - an entrance animation (bars grow, lines draw, the donut sweeps),
//   - hover / tap: the band under the pointer is highlighted and a
//     tooltip lists every series' value there; donut segments pop out
//     and the centre shows the segment,
//   - a legend that dims the other series while one is hovered.
// No library: the whole thing is a few kB and matches YANTA's theme.
//
// @i18n-locked — user-facing text goes through t('ai.widgets.…').
// ============================================================

import { escapeHtml } from '../core.js';
import { t } from '../i18n/index.js';

export const PALETTE = ['var(--accent)', '#e8833a', '#3f9fd8', '#b06ad9', '#d9b23f', '#3fae7e', '#e05d7a', '#6c7ae0'];

const NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/*
  Bars start at zero (a bar's length is its value). Lines show change, so
  their axis hugs the data when it sits far from zero — a weight curve
  between 78 and 82 kg would otherwise be a flat line at the top.
*/
function niceScale(values, { zero = true } = {}) {
  const finite = values.filter(Number.isFinite);
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (!finite.length) { min = 0; max = 1; }
  if (zero || min <= 0 || (max - min) / Math.abs(max) > 0.5) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  } else {
    const padBy = (max - min) * 0.15 || Math.abs(max) * 0.05 || 1;
    min -= padBy;
    max += padBy;
  }
  if (min === max) max = min + 1;

  const span = max - min;
  const step = 10 ** Math.floor(Math.log10(span / 4));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => span / s <= 5) || step * 10;

  return {
    min: Math.floor(min / nice) * nice,
    max: Math.ceil(max / nice) * nice,
    step: nice,
  };
}

function tooltipHtml(title, rows) {
  return `<strong>${escapeHtml(title)}</strong>${rows.map((r) =>
    `<span><i style="background:${r.color}"></i>${escapeHtml(r.name)}<b>${escapeHtml(r.value)}</b></span>`
  ).join('')}`;
}

function placeTooltip(box, tip, x, y) {
  const bw = box.clientWidth;
  tip.hidden = false;
  const tw = tip.offsetWidth;
  const left = Math.max(4, Math.min(bw - tw - 4, x - tw / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
}

/**
 * Bars and lines. `fmt(v)` formats a value for labels and tooltips.
 */
function drawCartesian(box, { kind, labels, series, fmt, tickFmt }, width) {
  const W = Math.max(260, Math.min(1000, Math.round(width)));
  const H = Math.round(Math.max(170, Math.min(280, W * 0.42)));
  const scale = niceScale(series.flatMap((s) => s.values), { zero: kind !== 'line' });
  const ticks = [];
  for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) ticks.push(v);

  const pad = { l: 10 + Math.max(...ticks.map((t) => tickFmt(t).length)) * 6.3, r: 10, t: 10, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = labels.length;
  const band = iw / n;
  const sy = (v) => pad.t + ih - ((v - scale.min) / (scale.max - scale.min)) * ih;
  const cx = (i) => pad.l + band * i + band / 2;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: `ywc-svg ywc-${kind}`, role: 'img' });

  for (const v of ticks) {
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), class: v === 0 ? 'ywc-zero' : 'ywc-grid' }));
    const t = svgEl('text', { x: pad.l - 6, y: sy(v) + 4, class: 'ywc-axis', 'text-anchor': 'end' });
    t.textContent = tickFmt(v);
    svg.append(t);
  }

  const every = Math.ceil(n / Math.max(3, Math.floor(iw / 58)));
  labels.forEach((label, i) => {
    if (i % every) return;
    const t = svgEl('text', { x: cx(i), y: H - 8, class: 'ywc-axis', 'text-anchor': 'middle' });
    t.textContent = label.length > 12 ? `${label.slice(0, 11)}…` : label;
    svg.append(t);
  });

  const plot = svgEl('g', { class: 'ywc-plot' });
  svg.append(plot);

  const marks = []; // per band: elements to highlight

  if (kind === 'line') {
    const guide = svgEl('line', { class: 'ywc-guide', y1: pad.t, y2: pad.t + ih, x1: 0, x2: 0 });
    plot.append(guide);

    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length];
      const pts = s.values.map((v, i) => (Number.isFinite(v) ? [cx(i), sy(v)] : null));
      const d = pts.reduce((acc, p, i) => (p ? `${acc}${pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), '');

      // Soft area under the first series, down to the axis floor.
      if (si === 0 && series.length <= 2) {
        const first = pts.findIndex(Boolean);
        const last = pts.length - 1 - [...pts].reverse().findIndex(Boolean);
        if (first >= 0 && last > first) {
          plot.append(svgEl('path', {
            d: `${d}L${pts[last][0].toFixed(1)},${sy(scale.min)}L${pts[first][0].toFixed(1)},${sy(scale.min)}Z`,
            fill: color,
            class: 'ywc-area',
          }));
        }
      }

      const path = svgEl('path', { d, fill: 'none', stroke: color, class: 'ywc-line', 'data-series': si });
      plot.append(path);

      pts.forEach((p, i) => {
        if (!p) return;
        const dot = svgEl('circle', { cx: p[0], cy: p[1], r: n <= 24 ? 3 : 0, fill: color, class: 'ywc-dot', 'data-series': si });
        plot.append(dot);
        (marks[i] ||= []).push(dot);
      });
    });

    marks.guide = guide;
  } else {
    const groupW = band * 0.74;
    const barW = groupW / series.length;
    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length];
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const x = pad.l + band * i + (band - groupW) / 2 + si * barW;
        const top = sy(Math.max(0, v));
        const h = Math.max(1, Math.abs(sy(v) - sy(0)));
        const r = svgEl('rect', {
          x: (x + 1).toFixed(1),
          y: top.toFixed(1),
          width: Math.max(1, barW - 2).toFixed(1),
          height: h.toFixed(1),
          rx: Math.min(4, barW / 3).toFixed(1),
          fill: color,
          // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
          class: `ywc-bar${v < 0 ? ' is-neg' : ''}`,
          'data-series': si,
          style: `animation-delay:${Math.min(400, i * 30)}ms`,
        });
        plot.append(r);
        (marks[i] ||= []).push(r);
      });
    });
  }

  // Hit areas: one transparent column per band.
  const hits = svgEl('g', { class: 'ywc-hits' });
  labels.forEach((label, i) => {
    const hit = svgEl('rect', { x: pad.l + band * i, y: pad.t, width: band, height: ih, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => hover(i));
    hit.addEventListener('pointerdown', () => hover(i));
    hits.append(hit);
  });
  svg.append(hits);
  svg.addEventListener('pointerleave', () => hover(-1));

  const tip = box.querySelector('.ywc-tip');

  function hover(i) {
    svg.classList.toggle('is-hovering', i >= 0);
    marks.forEach((list, j) => list?.forEach((m) => m.classList.toggle('is-hot', j === i)));

    if (i < 0) {
      tip.hidden = true;
      if (marks.guide) marks.guide.classList.remove('is-on');
      return;
    }

    if (marks.guide) {
      marks.guide.setAttribute('x1', cx(i));
      marks.guide.setAttribute('x2', cx(i));
      marks.guide.classList.add('is-on');
    }

    tip.innerHTML = tooltipHtml(labels[i], series.map((s, si) => ({
      name: s.name,
      value: fmt(s.values[i]),
      color: PALETTE[si % PALETTE.length],
    })));

    const rect = svg.getBoundingClientRect();
    const k = rect.width / W;
    const topV = Math.max(...series.map((s) => s.values[i]).filter(Number.isFinite), 0);
    placeTooltip(box, tip, cx(i) * k, sy(topV) * k);
  }

  return svg;
}

function drawDonut(box, { labels, series, fmt }, width) {
  const values = series[0].values.map((v) => Math.max(0, Number(v) || 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const wide = width >= 420;
  const size = Math.min(220, wide ? 200 : width - 20);
  const W = wide ? Math.min(width, 640) : size;
  const H = size;
  const r = size / 2 - 8;
  const ir = r * 0.62;
  const cx = size / 2;
  const cy = H / 2;

  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS classes
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ywc-svg ywc-donut', role: 'img', style: wide ? '' : `max-width:${size}px;margin:0 auto` });
  const center = svgEl('text', { x: cx, y: cy - 2, class: 'ywc-center', 'text-anchor': 'middle' });
  const centerSub = svgEl('text', { x: cx, y: cy + 16, class: 'ywc-center-sub', 'text-anchor': 'middle' });

  const showCenter = (i) => {
    if (i < 0) {
      center.textContent = fmt(total === 1 && !values.some(Boolean) ? 0 : values.reduce((a, b) => a + b, 0));
      centerSub.textContent = series[0].name || t('ai.widgets.chart.total');
    } else {
      center.textContent = `${Math.round((values[i] / total) * 100)} %`;
      centerSub.textContent = labels[i].length > 16 ? `${labels[i].slice(0, 15)}…` : labels[i];
    }
  };

  let angle = -Math.PI / 2;
  const segs = [];

  values.forEach((v, i) => {
    if (!v) return;
    const a2 = angle + (v / total) * Math.PI * 2;
    const large = a2 - angle > Math.PI ? 1 : 0;
    const p = (rad, rr) => `${(cx + rr * Math.cos(rad)).toFixed(2)},${(cy + rr * Math.sin(rad)).toFixed(2)}`;
    const d = v / total >= 0.9999
      ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 M${cx - ir},${cy} a${ir},${ir} 0 1,1 ${2 * ir},0 a${ir},${ir} 0 1,1 ${-2 * ir},0`
      : `M${p(angle, r)} A${r},${r} 0 ${large} 1 ${p(a2, r)} L${p(a2, ir)} A${ir},${ir} 0 ${large} 0 ${p(angle, ir)} Z`;

    const mid = (angle + a2) / 2;
    const seg = svgEl('path', {
      d,
      fill: PALETTE[i % PALETTE.length],
      'fill-rule': 'evenodd',
      class: 'ywc-seg',
      style: `--dx:${(Math.cos(mid) * 5).toFixed(2)}px;--dy:${(Math.sin(mid) * 5).toFixed(2)}px;animation-delay:${i * 60}ms`,
    });
    seg.addEventListener('pointerenter', () => hover(i));
    seg.addEventListener('pointerdown', () => hover(i));
    svg.append(seg);
    segs[i] = seg;
    angle = a2;
  });

  svg.append(center, centerSub);
  showCenter(-1);
  svg.addEventListener('pointerleave', () => hover(-1));

  if (wide) {
    const lx = size + 28;
    labels.slice(0, 10).forEach((label, i) => {
      const y = cy - (Math.min(labels.length, 10) * 24) / 2 + 16 + i * 24;
      const row = svgEl('g', { class: 'ywc-legend-row' });
      row.append(svgEl('rect', { x: lx, y: y - 10, width: 11, height: 11, rx: 3, fill: PALETTE[i % PALETTE.length] }));
      const t = svgEl('text', { x: lx + 18, y, class: 'ywc-legend' });
      t.textContent = `${label} · ${fmt(values[i])} · ${Math.round((values[i] / total) * 100)} %`;
      row.append(t);
      row.addEventListener('pointerenter', () => hover(i));
      svg.append(row);
    });
  }

  function hover(i) {
    svg.classList.toggle('is-hovering', i >= 0);
    segs.forEach((s, j) => s?.classList.toggle('is-hot', j === i));
    showCenter(i);
  }

  return svg;
}

function legendNode(series, box) {
  if (series.length < 2) return null;
  const legend = document.createElement('div');
  legend.className = 'ywc-legend-html';
  series.forEach((s, i) => {
    const item = document.createElement('span');
    item.innerHTML = `<i style="background:${PALETTE[i % PALETTE.length]}"></i>${escapeHtml(s.name)}`;
    item.addEventListener('pointerenter', () => box.querySelector('svg')?.setAttribute('data-focus', i));
    item.addEventListener('pointerleave', () => box.querySelector('svg')?.removeAttribute('data-focus'));
    legend.append(item);
  });
  return legend;
}

/**
 * A chart element that redraws when its width changes.
 * opts: { kind: 'bar'|'line'|'donut', labels, series:[{name, values}], fmt, tickFmt }
 */
export function chartElement(opts) {
  const root = document.createElement('div');
  root.className = 'ywc';

  const box = document.createElement('div');
  box.className = 'ywc-box';
  const tip = document.createElement('div');
  tip.className = 'ywc-tip';
  tip.hidden = true;

  root.append(box);

  let drawnAt = 0;
  const draw = (width) => {
    if (!width || Math.abs(width - drawnAt) < 24) return;
    const first = !drawnAt;
    drawnAt = width;
    box.replaceChildren(tip);
    const svg = opts.kind === 'donut' ? drawDonut(box, opts, width) : drawCartesian(box, opts, width);
    if (!first) svg.classList.add('no-intro');
    box.prepend(svg);
  };

  draw(520);

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver((entries) => draw(entries[0]?.contentRect?.width)).observe(box);
  }

  if (opts.kind !== 'donut') {
    const legend = legendNode(opts.series, box);
    if (legend) root.append(legend);
  }

  /** Redraw with new data (calculator charts), keeping the size. */
  root.update = (next) => {
    Object.assign(opts, next);
    const w = drawnAt;
    drawnAt = 0;
    draw(w || 520);
    box.querySelector('svg')?.classList.add('no-intro');
  };

  return root;
}
