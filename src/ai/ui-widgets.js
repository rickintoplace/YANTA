// ============================================================
// YANTA AI — interactive widgets in answers
//
// An answer may contain one fenced block with the language `yanta-ui`
// holding JSON. It is rendered as a widget from a fixed catalogue —
// calculator, chart, table, checklist, events, stats — with YANTA's own
// components and CSS. Nothing in the block is executed: formulas go
// through the evaluator in ui-expr.js, text is always escaped, and the
// only side effects are the ones the user clicks (save as note, add an
// event). That keeps a widget harmless even when the model was steered
// by something it read.
//
// Widget state (inputs, ticks, added events) lives on the message, so a
// re-render while another answer streams keeps what the user entered,
// and "Save as note" saves what is on screen.
// ============================================================

import { lucide, escapeHtml, toast, actionToast } from '../core.js';
import { getLocale } from '../i18n/index.js';
import { compileFormula } from './ui-expr.js';

export const WIDGET_LANG = 'yanta-ui';

/** For the system prompt. Compact on purpose: it is sent with every turn (cached). */
export const WIDGET_INSTRUCTIONS = [
  '# Interactive answers',
  '',
  'Some answers work better as something the user can use than as text. Add ONE interactive widget — a fenced code block with the language yanta-ui containing JSON — when the answer is:',
  '- a calculation with parameters the user could vary (savings, loans, budgets, prices, conversions, durations): always a calculator, with the given values as defaults;',
  '- several options compared on the same attributes: a table; numbers over time or by category: a chart;',
  '- a plan with dates: events; steps or items to tick off: a checklist.',
  'Then write one or two sentences with the key result; do not repeat the widget\'s contents or show the working in text. Never use a widget for a simple factual or conversational answer.',
  '',
  'Types:',
  '- calculator: {"type":"calculator","title":"…","inputs":[{"id":"price","label":"Price","type":"number|slider|select|toggle","value":100,"min":0,"max":1000,"step":10,"unit":"€","options":[{"label":"…","value":1}]}],"outputs":[{"id":"total","label":"Total","formula":"price * qty","format":"number|integer|currency|percent","currency":"EUR","decimals":2,"primary":true}],"chart":{"x":{"input":"years","from":1,"to":30},"y":["balance"]}}',
  '  Formulas: + - * / % ^, comparisons, c ? a : b, min max round(x,d) floor ceil abs sqrt pow log exp clamp sum avg pmt(rate,n,pv). Outputs may use earlier outputs. Toggles are 1 or 0; percentages are plain numbers (7 means 7 %). "chart" (optional) plots outputs while one input runs from..to.',
  '- chart: {"type":"chart","kind":"bar|line|donut","title":"…","labels":["Jan","Feb"],"series":[{"name":"Spend","values":[120,90]}],"format":"number|currency|percent","currency":"EUR"}',
  '- table: {"type":"table","title":"…","columns":["Option","Price","Rating"],"rows":[["A","19","4.5"]],"best":{"column":2,"direction":"max"}}',
  '- checklist: {"type":"checklist","title":"…","items":[{"text":"Passport","done":false}]}',
  '- events: {"type":"events","title":"…","items":[{"title":"Flight","start":"2026-11-12T07:40","end":"2026-11-12T10:15","location":"FRA"}]} — local times; the user adds them with one click, so do not also call create_event.',
  '- stats: {"type":"stats","title":"…","items":[{"label":"Notes","value":"128","delta":"+12 this week"}]}',
  'The user can save any widget as a note.',
].join('\n');

const FENCE_RE = /```yanta-ui[^\n]*\n([\s\S]*?)(```|$)/g;
const MARK = (i) => `⟦w${i}⟧`;
const MARK_RE = /⟦w(\d+)⟧/;

const LIMITS = { inputs: 12, outputs: 12, items: 60, rows: 60, columns: 8, series: 6, points: 120 };

// ------------------------------------------------------------------ parsing

/**
 * Pulls widget blocks out of an answer. Returns the text with a marker
 * per block (so markdown renders around it) and the blocks; a block that
 * is still streaming is `{ pending: true }`.
 */
export function extractWidgets(text) {
  const widgets = [];

  const out = String(text || '').replace(FENCE_RE, (_, body, close) => {
    const i = widgets.length;

    if (!close) {
      widgets.push({ pending: true });
    } else {
      try {
        widgets.push({ spec: normalizeSpec(JSON.parse(body)) });
      } catch (err) {
        widgets.push({ error: String(err?.message || err), raw: body });
      }
    }

    return `\n\n${MARK(i)}\n\n`;
  });

  return { text: out, widgets };
}

/** An answer without its widget JSON, for places that only want prose. */
export function stripWidgets(text) {
  return String(text || '').replace(FENCE_RE, (_, body, close) => {
    if (!close) return '';
    try {
      const spec = normalizeSpec(JSON.parse(body));
      return `\n[${spec.title || spec.type}: interactive ${spec.type}]\n`;
    } catch {
      return '';
    }
  });
}

const str = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const ident = (v) => (/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(String(v || '')) ? String(v) : '');

function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Widget is not an object');

  const type = String(raw.type || '').toLowerCase();
  const base = { type, title: str(raw.title, 120), note: str(raw.note, 300) };

  if (type === 'calculator') {
    const inputs = (Array.isArray(raw.inputs) ? raw.inputs : []).slice(0, LIMITS.inputs).map((i) => {
      const kind = ['number', 'slider', 'select', 'toggle'].includes(i?.type) ? i.type : 'number';
      return {
        id: ident(i?.id),
        label: str(i?.label || i?.id, 80),
        type: kind,
        value: kind === 'toggle' ? (i?.value ? 1 : 0) : num(i?.value, kind === 'select' ? num(i?.options?.[0]?.value) : 0),
        min: i?.min != null ? num(i.min) : null,
        max: i?.max != null ? num(i.max) : null,
        step: i?.step != null ? Math.abs(num(i.step, 1)) || 1 : null,
        unit: str(i?.unit, 12),
        options: Array.isArray(i?.options)
          ? i.options.slice(0, 20).map((o) => ({ label: str(o?.label ?? o?.value, 60), value: num(o?.value) }))
          : [],
      };
    }).filter((i) => i.id);

    const outputs = (Array.isArray(raw.outputs) ? raw.outputs : []).slice(0, LIMITS.outputs).map((o, n) => ({
      id: ident(o?.id) || `out${n + 1}`,
      label: str(o?.label, 80),
      formula: String(o?.formula ?? '').slice(0, 500),
      format: ['number', 'integer', 'currency', 'percent'].includes(o?.format) ? o.format : 'number',
      currency: /^[A-Z]{3}$/.test(String(o?.currency || '')) ? o.currency : 'EUR',
      decimals: o?.decimals != null ? Math.max(0, Math.min(6, Math.trunc(num(o.decimals)))) : null,
      unit: str(o?.unit, 12),
      primary: !!o?.primary,
    })).filter((o) => o.formula);

    if (!inputs.length || !outputs.length) throw new Error('A calculator needs inputs and outputs');

    let chart = null;
    const x = raw.chart?.x;
    if (x && ident(x.input) && Array.isArray(raw.chart?.y)) {
      chart = {
        input: ident(x.input),
        from: num(x.from),
        to: num(x.to),
        steps: Math.max(2, Math.min(LIMITS.points, Math.trunc(num(x.steps, 0)) || Math.min(LIMITS.points, Math.abs(num(x.to) - num(x.from)) + 1 || 20))),
        y: raw.chart.y.map(ident).filter(Boolean).slice(0, LIMITS.series),
      };
      if (!chart.y.length || chart.from === chart.to) chart = null;
    }

    return { ...base, inputs, outputs, chart };
  }

  if (type === 'chart') {
    const labels = (Array.isArray(raw.labels) ? raw.labels : []).slice(0, LIMITS.points).map((l) => str(l, 40));
    const series = (Array.isArray(raw.series) ? raw.series : []).slice(0, LIMITS.series).map((s, n) => ({
      name: str(s?.name || `Series ${n + 1}`, 40),
      values: (Array.isArray(s?.values) ? s.values : []).slice(0, labels.length).map((v) => num(v, NaN)),
    }));
    if (!labels.length || !series.length) throw new Error('A chart needs labels and series');
    return {
      ...base,
      kind: ['bar', 'line', 'donut'].includes(raw.kind) ? raw.kind : 'bar',
      labels,
      series,
      format: ['number', 'integer', 'currency', 'percent'].includes(raw.format) ? raw.format : 'number',
      currency: /^[A-Z]{3}$/.test(String(raw.currency || '')) ? raw.currency : 'EUR',
    };
  }

  if (type === 'table') {
    const columns = (Array.isArray(raw.columns) ? raw.columns : []).slice(0, LIMITS.columns).map((c) => str(typeof c === 'object' ? c?.label : c, 60));
    const rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, LIMITS.rows)
      .map((r) => (Array.isArray(r) ? r : []).slice(0, columns.length).map((c) => str(c, 160)));
    if (!columns.length || !rows.length) throw new Error('A table needs columns and rows');
    const best = raw.best && Number.isInteger(raw.best.column) && raw.best.column < columns.length
      ? { column: raw.best.column, direction: raw.best.direction === 'min' ? 'min' : 'max' }
      : null;
    return { ...base, columns, rows, best };
  }

  if (type === 'checklist') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.items)
      .map((i) => (typeof i === 'string' ? { text: str(i), done: false } : { text: str(i?.text), done: !!i?.done }))
      .filter((i) => i.text);
    if (!items.length) throw new Error('A checklist needs items');
    return { ...base, items };
  }

  if (type === 'events') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 20).map((e) => ({
      title: str(e?.title, 120),
      start: str(e?.start, 40),
      end: str(e?.end, 40),
      allDay: !!e?.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(e?.start || '')),
      location: str(e?.location, 120),
    })).filter((e) => e.title && !Number.isNaN(Date.parse(e.start)));
    if (!items.length) throw new Error('No valid events');
    return { ...base, items };
  }

  if (type === 'stats') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 12).map((s) => ({
      label: str(s?.label, 60), value: str(s?.value, 40), delta: str(s?.delta, 60), hint: str(s?.hint, 120),
    })).filter((s) => s.label && s.value);
    if (!items.length) throw new Error('No stats');
    return { ...base, items };
  }

  throw new Error(`Unknown widget type "${type}"`);
}

// --------------------------------------------------------------- formatting

function intlLocale() {
  const code = getLocale?.() || 'en';
  return code === 'en' ? navigator.language || 'en' : code;
}

export function formatValue(v, { format = 'number', currency = 'EUR', decimals = null, unit = '' } = {}) {
  if (!Number.isFinite(v)) return '—';

  const loc = intlLocale();
  let text;

  try {
    if (format === 'currency') {
      text = new Intl.NumberFormat(loc, { style: 'currency', currency, maximumFractionDigits: decimals ?? 2, minimumFractionDigits: decimals ?? 0 }).format(v);
    } else if (format === 'percent') {
      text = `${new Intl.NumberFormat(loc, { maximumFractionDigits: decimals ?? 1 }).format(v)} %`;
    } else if (format === 'integer') {
      text = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(v);
    } else {
      const auto = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 4;
      text = new Intl.NumberFormat(loc, { maximumFractionDigits: decimals ?? auto }).format(v);
    }
  } catch {
    text = String(Math.round(v * 100) / 100);
  }

  return unit ? `${text} ${unit}` : text;
}

// ------------------------------------------------------------------ helpers

function el(tag, cls = '', html = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html) node.innerHTML = html;
  return node;
}

const PALETTE = ['var(--accent)', '#e8833a', '#3f9fd8', '#b06ad9', '#d9b23f', '#3fae7e'];

// ----------------------------------------------------------------- charts

/** An SVG chart. `series` values may contain NaN (gaps). */
function renderChartSvg({ kind = 'bar', labels, series, format, currency }, width = 520) {
  // Drawn at the width it is shown at, so text stays 11 px on a phone and
  // on a wide pane alike (see responsiveChart).
  const W = Math.max(260, Math.min(900, Math.round(width)));
  const H = Math.round(Math.max(170, Math.min(260, W * 0.42)));
  const pad = { l: 34, r: 12, t: 12, b: 28 };
  const ns = 'http://www.w3.org/2000/svg';
  const fmt = (v) => formatValue(v, { format, currency });

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'yw-chart-svg');
  svg.setAttribute('role', 'img');

  const add = (name, attrs, text) => {
    const n = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };

  if (kind === 'donut') {
    const values = series[0].values.map((v) => Math.max(0, num(v)));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min(80, H / 2 - 12);
    const ir = r * 0.6;
    const cx = r + 12;
    const cy = H / 2;
    let angle = -Math.PI / 2;

    values.forEach((v, i) => {
      const a2 = angle + (v / total) * Math.PI * 2;
      const large = a2 - angle > Math.PI ? 1 : 0;
      const p = (rad, rr) => `${cx + rr * Math.cos(rad)},${cy + rr * Math.sin(rad)}`;
      const d = v / total >= 0.9999
        ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 M${cx - ir},${cy} a${ir},${ir} 0 1,1 ${2 * ir},0 a${ir},${ir} 0 1,1 ${-2 * ir},0`
        : `M${p(angle, r)} A${r},${r} 0 ${large} 1 ${p(a2, r)} L${p(a2, ir)} A${ir},${ir} 0 ${large} 0 ${p(angle, ir)} Z`;
      const path = add('path', { d, fill: PALETTE[i % PALETTE.length], 'fill-rule': 'evenodd' });
      const t = document.createElementNS(ns, 'title');
      t.textContent = `${labels[i]}: ${fmt(v)} (${Math.round((v / total) * 100)} %)`;
      path.append(t);
      angle = a2;
    });

    const lx = cx + r + 24;
    labels.slice(0, 10).forEach((label, i) => {
      const y = cy - (Math.min(labels.length, 10) * 19) / 2 + 14 + i * 19;
      add('rect', { x: lx, y: y - 9, width: 10, height: 10, rx: 2, fill: PALETTE[i % PALETTE.length] });
      add('text', { x: lx + 16, y, class: 'yw-chart-legend' }, `${label} · ${fmt(values[i])} (${Math.round((values[i] / total) * 100)} %)`);
    });

    return svg;
  }

  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (min === max) max = min + 1;

  // Round the axis to a readable step.
  const span = max - min;
  const step = 10 ** Math.floor(Math.log10(span / 4));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => span / s <= 5) || step * 10;
  min = Math.floor(min / nice) * nice;
  max = Math.ceil(max / nice) * nice;

  // Room for the longest tick label (about 6.3 px per character at 11 px).
  const tickLabel = (v) => formatValue(v, { format, currency, decimals: Math.abs(nice) < 1 ? 2 : 0 });
  pad.l = Math.max(pad.l, 10 + Math.max(tickLabel(min).length, tickLabel(max).length) * 6.3);

  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const sy = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;

  for (let v = min; v <= max + nice / 2; v += nice) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), class: v === 0 ? 'yw-chart-zero' : 'yw-chart-grid' });
    add('text', { x: pad.l - 6, y: sy(v) + 4, class: 'yw-chart-axis', 'text-anchor': 'end' }, tickLabel(v));
  }

  const n = labels.length;
  const every = Math.ceil(n / Math.max(3, Math.floor(iw / 56)));
  const bandX = (i) => pad.l + (iw / n) * i;

  labels.forEach((label, i) => {
    if (i % every) return;
    add('text', { x: bandX(i) + iw / n / 2, y: H - 8, class: 'yw-chart-axis', 'text-anchor': 'middle' }, label.length > 10 ? `${label.slice(0, 9)}…` : label);
  });

  if (kind === 'line') {
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (Number.isFinite(v) ? [bandX(i) + iw / n / 2, sy(v)] : null));
      const d = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), '');
      add('path', { d, fill: 'none', stroke: PALETTE[si % PALETTE.length], 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      if (n <= 31) {
        pts.forEach((p, i) => {
          if (!p) return;
          const c = add('circle', { cx: p[0], cy: p[1], r: 3, fill: PALETTE[si % PALETTE.length] });
          const t = document.createElementNS(ns, 'title');
          t.textContent = `${s.name} · ${labels[i]}: ${fmt(s.values[i])}`;
          c.append(t);
        });
      }
    });
  } else {
    const groupW = (iw / n) * 0.78;
    const barW = groupW / series.length;
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const x = bandX(i) + (iw / n - groupW) / 2 + si * barW;
        const y0 = sy(Math.max(0, v));
        const h = Math.max(1, Math.abs(sy(v) - sy(0)));
        const r = add('rect', { x: x.toFixed(1), y: y0.toFixed(1), width: Math.max(1, barW - 2).toFixed(1), height: h.toFixed(1), rx: 2, fill: PALETTE[si % PALETTE.length] });
        const t = document.createElementNS(ns, 'title');
        t.textContent = `${s.name} · ${labels[i]}: ${fmt(v)}`;
        r.append(t);
      });
    });
  }

  return svg;
}

/** A chart that redraws when its box changes width. */
function responsiveChart(opts) {
  const box = el('div', 'yw-chart-box');
  let drawnAt = 0;

  const draw = (width) => {
    if (!width || Math.abs(width - drawnAt) < 24) return;
    drawnAt = width;
    box.replaceChildren(renderChartSvg(opts, width));
  };

  draw(520);

  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver((entries) => draw(entries[0]?.contentRect?.width));
    ro.observe(box);
  }

  return box;
}

function chartLegend(series) {
  if (series.length < 2) return null;
  const legend = el('div', 'yw-legend');
  series.forEach((s, i) => {
    legend.append(el('span', '', `<i style="background:${PALETTE[i % PALETTE.length]}"></i>${escapeHtml(s.name)}`));
  });
  return legend;
}

// ---------------------------------------------------------------- widgets

function calculatorState(spec, state) {
  const values = {};
  for (const input of spec.inputs) {
    values[input.id] = Number.isFinite(state.values?.[input.id]) ? state.values[input.id] : input.value;
  }
  return values;
}

function computeOutputs(spec, values) {
  const vars = { ...values };
  const results = [];

  for (const out of spec.outputs) {
    let v;
    try {
      v = compileFormula(out.formula)(vars);
    } catch {
      v = NaN;
    }
    vars[out.id] = v;
    results.push({ ...out, v });
  }

  return results;
}

function renderCalculator(spec, state, save) {
  const root = el('div', 'yw-calc');
  const form = el('div', 'yw-inputs');
  const outputs = el('div', 'yw-outputs');
  const chartBox = el('div', 'yw-calc-chart');

  const values = calculatorState(spec, state);

  const update = () => {
    const results = computeOutputs(spec, values);

    outputs.replaceChildren(...results.map((r) => {
      const node = el('div', `yw-output${r.primary ? ' is-primary' : ''}`);
      node.append(el('span', 'yw-output-label', escapeHtml(r.label)));
      node.append(el('strong', 'yw-output-value', escapeHtml(formatValue(r.v, r))));
      return node;
    }));

    if (spec.chart) {
      const xs = Array.from({ length: spec.chart.steps }, (_, i) => spec.chart.from + ((spec.chart.to - spec.chart.from) * i) / (spec.chart.steps - 1));
      const ys = spec.chart.y.map((id) => ({
        name: spec.outputs.find((o) => o.id === id)?.label || id,
        values: xs.map((x) => computeOutputs(spec, { ...values, [spec.chart.input]: x }).find((r) => r.id === id)?.v ?? NaN),
      }));
      const firstOut = spec.outputs.find((o) => o.id === spec.chart.y[0]) || {};
      chartBox.replaceChildren(responsiveChart({
        kind: 'line',
        labels: xs.map((x) => formatValue(x, { decimals: Number.isInteger(x) ? 0 : 1 })),
        series: ys,
        format: firstOut.format,
        currency: firstOut.currency,
      }));
      const legend = chartLegend(ys);
      if (legend) chartBox.append(legend);
    }

    state.values = { ...values };
    save();
  };

  for (const input of spec.inputs) {
    const row = el('label', `yw-input yw-input-${input.type}`);
    row.append(el('span', 'yw-input-label', escapeHtml(input.label)));

    let control;

    if (input.type === 'select' && input.options.length) {
      control = document.createElement('select');
      for (const o of input.options) {
        const opt = document.createElement('option');
        opt.value = String(o.value);
        opt.textContent = o.label;
        if (o.value === values[input.id]) opt.selected = true;
        control.append(opt);
      }
      control.addEventListener('change', () => { values[input.id] = Number(control.value); update(); });
      row.append(control);
    } else if (input.type === 'toggle') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = !!values[input.id];
      control.addEventListener('change', () => { values[input.id] = control.checked ? 1 : 0; update(); });
      row.append(control);
    } else {
      const wrap = el('span', 'yw-input-field');
      control = document.createElement('input');
      control.type = input.type === 'slider' ? 'range' : 'number';
      if (input.min != null) control.min = String(input.min);
      if (input.max != null) control.max = String(input.max);
      control.step = String(input.step ?? (input.type === 'slider' ? 1 : 'any'));
      control.value = String(values[input.id]);

      const readout = input.type === 'slider' ? el('output', 'yw-slider-value') : null;
      const showReadout = () => {
        if (readout) readout.textContent = `${formatValue(values[input.id], { decimals: input.step && input.step < 1 ? 2 : 0 })}${input.unit ? ` ${input.unit}` : ''}`;
      };
      showReadout();

      control.addEventListener('input', () => {
        const v = Number(control.value);
        if (Number.isFinite(v)) {
          values[input.id] = v;
          showReadout();
          update();
        }
      });

      wrap.append(control);
      if (readout) wrap.append(readout);
      else if (input.unit) wrap.append(el('span', 'yw-unit', escapeHtml(input.unit)));
      row.append(wrap);
    }

    form.append(row);
  }

  root.append(form, outputs);
  if (spec.chart) root.append(chartBox);

  update();

  root.toMarkdown = () => [
    ...spec.inputs.map((i) => `- ${i.label}: ${i.type === 'toggle' ? (values[i.id] ? 'yes' : 'no') : formatValue(values[i.id], { unit: i.unit })}`),
    '',
    ...computeOutputs(spec, values).map((r) => `- **${r.label}: ${formatValue(r.v, r)}**`),
  ].join('\n');

  return root;
}

function renderChart(spec) {
  const root = el('div', 'yw-chart');
  root.append(responsiveChart(spec));
  const legend = chartLegend(spec.series);
  if (legend) root.append(legend);

  root.toMarkdown = () => [
    `| | ${spec.series.map((s) => s.name).join(' | ')} |`,
    `| --- | ${spec.series.map(() => '---:').join(' | ')} |`,
    ...spec.labels.map((label, i) => `| ${label} | ${spec.series.map((s) => formatValue(s.values[i], spec)).join(' | ')} |`),
  ].join('\n');

  return root;
}

function renderTable(spec, state, save) {
  const root = el('div', 'yw-table-wrap');
  const table = el('table', 'yw-table');
  let sort = state.sort || null;

  const numeric = (v) => {
    const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.'));
    return Number.isFinite(n) && /\d/.test(String(v)) ? n : null;
  };

  let bestRow = -1;
  if (spec.best) {
    const vals = spec.rows.map((r) => numeric(r[spec.best.column]));
    const ok = vals.filter((v) => v != null);
    if (ok.length) {
      const target = spec.best.direction === 'min' ? Math.min(...ok) : Math.max(...ok);
      bestRow = vals.indexOf(target);
    }
  }

  const draw = () => {
    const order = spec.rows.map((r, i) => i);
    if (sort) {
      order.sort((a, b) => {
        const x = spec.rows[a][sort.column] ?? '';
        const y = spec.rows[b][sort.column] ?? '';
        const nx = numeric(x);
        const ny = numeric(y);
        const c = nx != null && ny != null ? nx - ny : String(x).localeCompare(String(y));
        return sort.dir === 'desc' ? -c : c;
      });
    }

    const head = el('tr');
    spec.columns.forEach((c, i) => {
      const th = el('th', '', `${escapeHtml(c)}${sort?.column === i ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}`);
      th.addEventListener('click', () => {
        sort = sort?.column === i && sort.dir === 'asc' ? { column: i, dir: 'desc' } : { column: i, dir: 'asc' };
        state.sort = sort;
        save();
        draw();
      });
      head.append(th);
    });

    const body = order.map((ri) => {
      const tr = el('tr', ri === bestRow ? 'is-best' : '');
      spec.columns.forEach((_, ci) => {
        const v = spec.rows[ri][ci] ?? '';
        tr.append(el('td', numeric(v) != null && ci > 0 ? 'is-num' : '', escapeHtml(v)));
      });
      return tr;
    });

    table.replaceChildren(head, ...body);
  };

  draw();
  root.append(table);

  root.toMarkdown = () => [
    `| ${spec.columns.join(' | ')} |`,
    `| ${spec.columns.map(() => '---').join(' | ')} |`,
    ...spec.rows.map((r) => `| ${spec.columns.map((_, i) => String(r[i] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');

  return root;
}

function renderChecklist(spec, state, save) {
  const root = el('div', 'yw-checklist');
  const done = Array.isArray(state.done) ? state.done : spec.items.map((i) => i.done);
  const progress = el('div', 'yw-progress');

  const showProgress = () => {
    const n = done.filter(Boolean).length;
    progress.innerHTML = `<span style="width:${Math.round((n / spec.items.length) * 100)}%"></span><em>${n}/${spec.items.length}</em>`;
  };

  spec.items.forEach((item, i) => {
    const row = el('label', `yw-check${done[i] ? ' is-done' : ''}`);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!done[i];
    box.addEventListener('change', () => {
      done[i] = box.checked;
      row.classList.toggle('is-done', box.checked);
      state.done = [...done];
      save();
      showProgress();
    });
    row.append(box, el('span', '', escapeHtml(item.text)));
    root.append(row);
  });

  showProgress();
  root.prepend(progress);

  root.toMarkdown = () => spec.items.map((item, i) => `- [${done[i] ? 'x' : ' '}] ${item.text}`).join('\n');

  return root;
}

function formatEventTime(e) {
  const loc = intlLocale();
  const start = new Date(e.start);
  try {
    if (e.allDay) return new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' }).format(start);
    const day = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' }).format(start);
    const t = (d) => new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(d);
    return `${day}, ${t(start)}${e.end && !Number.isNaN(Date.parse(e.end)) ? `–${t(new Date(e.end))}` : ''}`;
  } catch {
    return e.start;
  }
}

function renderEvents(spec, state, save) {
  const root = el('div', 'yw-events');
  const added = Array.isArray(state.added) ? state.added : spec.items.map(() => false);
  const buttons = [];

  const add = async (i) => {
    if (added[i]) return;
    const e = spec.items[i];
    try {
      const { createEventAction } = await import('./app-actions.js');
      await createEventAction({
        title: e.title,
        start: e.start,
        end: e.end || null,
        allDay: e.allDay,
        location: e.location || undefined,
      });
      added[i] = true;
      state.added = [...added];
      save();
      buttons[i].replaceWith(el('span', 'yw-added', `${lucide('check', 13)} Added`));
    } catch (err) {
      toast(`Could not add the event: ${err?.message || err}`, 'error');
    }
  };

  spec.items.forEach((e, i) => {
    const row = el('div', 'yw-event');
    row.append(el('span', 'yw-event-icon', lucide('calendar-days', 15)));
    const main = el('div', 'yw-event-main');
    main.append(el('strong', '', escapeHtml(e.title)));
    main.append(el('small', '', escapeHtml([formatEventTime(e), e.location].filter(Boolean).join(' · '))));
    row.append(main);

    if (added[i]) {
      buttons[i] = el('span', 'yw-added', `${lucide('check', 13)} Added`);
    } else {
      buttons[i] = el('button', 'yw-btn', `${lucide('calendar-plus', 13)} Add`);
      buttons[i].type = 'button';
      buttons[i].addEventListener('click', () => add(i));
    }

    row.append(buttons[i]);
    root.append(row);
  });

  root.extraActions = spec.items.length > 1
    ? [{
        label: 'Add all to calendar',
        icon: 'calendar-plus',
        run: async () => {
          for (let i = 0; i < spec.items.length; i++) await add(i);
          toast('Events added to your calendar', 'success');
        },
      }]
    : [];

  root.toMarkdown = () => spec.items.map((e) => `- **${e.title}** — ${formatEventTime(e)}${e.location ? ` · ${e.location}` : ''}`).join('\n');

  return root;
}

function renderStats(spec) {
  const root = el('div', 'yw-stats');
  for (const s of spec.items) {
    const card = el('div', 'yw-stat');
    if (s.hint) card.title = s.hint;
    card.append(el('span', 'yw-stat-label', escapeHtml(s.label)));
    card.append(el('strong', 'yw-stat-value', escapeHtml(s.value)));
    if (s.delta) card.append(el('small', `yw-stat-delta${/^[-−]/.test(s.delta) ? ' is-down' : /^\+/.test(s.delta) ? ' is-up' : ''}`, escapeHtml(s.delta)));
    root.append(card);
  }
  root.toMarkdown = () => spec.items.map((s) => `- ${s.label}: **${s.value}**${s.delta ? ` (${s.delta})` : ''}`).join('\n');
  return root;
}

const RENDERERS = {
  calculator: renderCalculator,
  chart: renderChart,
  table: renderTable,
  checklist: renderChecklist,
  events: renderEvents,
  stats: renderStats,
};

const ICONS = {
  calculator: 'calculator',
  chart: 'chart-column',
  table: 'table',
  checklist: 'list-checks',
  events: 'calendar-days',
  stats: 'gauge',
};

/**
 * The widget for one extracted block. `state` is a plain object kept on
 * the message; `save()` persists it.
 */
export function renderWidget(block, { state = {}, save = () => {} } = {}) {
  injectWidgetStyles();

  if (block.pending) {
    return el('div', 'yw yw-pending', `${lucide('sparkles', 14)}<span>Building an interactive view…</span>`);
  }

  if (block.error || !block.spec) {
    const node = el('details', 'yw yw-error');
    node.innerHTML = `<summary>${lucide('triangle-alert', 13)} This interactive view could not be shown</summary><pre>${escapeHtml(String(block.raw || block.error || '').slice(0, 2000))}</pre>`;
    return node;
  }

  const { spec } = block;
  const card = el('div', `yw yw-${spec.type}`);

  const head = el('div', 'yw-head');
  head.append(el('span', 'yw-icon', lucide(ICONS[spec.type] || 'sparkles', 14)));
  head.append(el('strong', 'yw-title', escapeHtml(spec.title || spec.type)));
  card.append(head);

  let body;
  try {
    body = RENDERERS[spec.type](spec, state, save);
  } catch (err) {
    console.warn('[YANTA AI] widget failed', err);
    card.append(el('p', 'yw-note', 'This view could not be built.'));
    return card;
  }

  card.append(body);
  if (spec.note) card.append(el('p', 'yw-note', escapeHtml(spec.note)));

  const actions = el('div', 'yw-actions');

  for (const extra of body.extraActions || []) {
    const b = el('button', 'yw-btn', `${lucide(extra.icon, 13)} ${escapeHtml(extra.label)}`);
    b.type = 'button';
    b.addEventListener('click', () => extra.run());
    actions.append(b);
  }

  const saveBtn = el('button', 'yw-btn', `${lucide('file-plus', 13)} Save as note`);
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    try {
      const { createNoteAction } = await import('./app-actions.js');
      const note = await createNoteAction({
        title: spec.title || 'From YANTA AI',
        body: body.toMarkdown ? body.toMarkdown() : '',
      });
      actionToast(`Saved “${spec.title || 'note'}”`, {
        actionLabel: 'Open',
        onAction: async () => {
          const { openNote } = await import('../notes.js');
          openNote(note.id);
        },
      });
    } catch (err) {
      toast(`Could not save: ${err?.message || err}`, 'error');
    }
  });
  actions.append(saveBtn);
  card.append(actions);

  return card;
}

/**
 * Replaces the markers in rendered markdown with widgets.
 * `stateFor(i)` returns the persisted state object for widget i.
 */
export function mountWidgets(root, widgets, { stateFor, save }) {
  if (!widgets.length) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walker.nextNode()) {
    if (MARK_RE.test(walker.currentNode.nodeValue)) hits.push(walker.currentNode);
  }

  for (const textNode of hits) {
    const i = Number(MARK_RE.exec(textNode.nodeValue)[1]);
    const widget = renderWidget(widgets[i] || { error: 'missing' }, { state: stateFor(i), save });
    // Replace the whole paragraph the marker sits in.
    const block = textNode.parentElement?.closest('p, div') || textNode.parentElement;
    if (block && block !== root && block.textContent.trim() === textNode.nodeValue.trim()) block.replaceWith(widget);
    else textNode.replaceWith(widget);
  }
}

// ------------------------------------------------------------------ styles

let stylesInjected = false;

function injectWidgetStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-ai-widget-styles';
  style.textContent = `
.yanta-ai-msg.assistant:has(.yw) { width: 100%; }
.yw {
  margin: 10px 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev-2, var(--bg));
  padding: 12px 14px;
  display: grid;
  gap: 10px;
  max-width: 100%;
  overflow: hidden;
}
.yw-head { display: flex; align-items: center; gap: 8px; }
.yw-icon {
  width: 26px; height: 26px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.yw-title { font-size: 13.5px; }
.yw-note { margin: 0; font-size: 12px; color: var(--text-faint); }
.yw-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.yw-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--border); border-radius: 999px;
  background: transparent; color: var(--text-dim);
  font-size: 12px; padding: 4px 10px; cursor: pointer;
}
.yw-btn:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
.yw-pending {
  grid-auto-flow: column; justify-content: start; align-items: center; gap: 8px;
  color: var(--text-faint); font-size: 12.5px;
  animation: yw-pulse 1.4s ease-in-out infinite;
}
@keyframes yw-pulse { 50% { opacity: .5; } }
.yw-error summary { cursor: pointer; font-size: 12px; color: var(--text-faint); }
.yw-error pre { font-size: 11px; white-space: pre-wrap; max-height: 200px; overflow: auto; }

.yw-calc { display: grid; gap: 12px; }
.yw-inputs { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px 12px; }
.yw-input { display: grid; gap: 4px; font-size: 12px; color: var(--text-dim); }
.yw-input-toggle { grid-template-columns: 1fr auto; align-items: center; }
.yw-input-field { display: flex; align-items: center; gap: 6px; }
.yw-input input[type="number"], .yw-input select {
  width: 100%; min-width: 0; box-sizing: border-box;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--text);
  padding: 6px 8px; font: inherit; font-size: 13px;
}
.yw-input input[type="range"] { flex: 1; accent-color: var(--accent); min-width: 0; }
.yw-slider-value { font-variant-numeric: tabular-nums; color: var(--text); font-size: 12.5px; min-width: 52px; text-align: right; }
.yw-unit { color: var(--text-faint); }
.yw-outputs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.yw-output {
  border-radius: 10px; padding: 8px 10px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  display: grid; gap: 2px;
}
.yw-output.is-primary { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.yw-output-label { font-size: 11.5px; color: var(--text-faint); }
.yw-output-value { font-size: 17px; font-variant-numeric: tabular-nums; }
.yw-output.is-primary .yw-output-value { font-size: 21px; }

.yw-chart-box { width: 100%; }
.yw-chart-svg { width: 100%; height: auto; display: block; }
.yw-chart-grid { stroke: var(--border); stroke-width: 1; }
.yw-chart-zero { stroke: var(--text-faint); stroke-width: 1; }
.yw-chart-axis, .yw-chart-legend { fill: var(--text-faint); font-size: 11px; font-family: inherit; }
.yw-chart-legend { fill: var(--text-dim); font-size: 12px; }
.yw-legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--text-dim); }
.yw-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }

.yw-table-wrap { overflow-x: auto; }
.yw-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.yw-table th {
  text-align: left; font-weight: 600; color: var(--text-dim);
  padding: 6px 10px 6px 0; border-bottom: 1px solid var(--border);
  cursor: pointer; white-space: nowrap; user-select: none;
}
.yw-table td { padding: 6px 10px 6px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
.yw-table td.is-num { font-variant-numeric: tabular-nums; }
.yw-table tr.is-best td { background: color-mix(in srgb, var(--accent) 10%, transparent); font-weight: 600; }

.yw-checklist { display: grid; gap: 4px; }
.yw-check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; cursor: pointer; padding: 3px 0; }
.yw-check input { accent-color: var(--accent); margin-top: 3px; }
.yw-check.is-done span { color: var(--text-faint); text-decoration: line-through; }
.yw-progress {
  position: relative; height: 6px; border-radius: 999px; margin: 2px 40px 6px 0;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.yw-progress span { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--accent); transition: width .2s; }
.yw-progress em { position: absolute; right: -40px; top: -6px; font-size: 11px; font-style: normal; color: var(--text-faint); }

.yw-events { display: grid; gap: 6px; }
.yw-event { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
.yw-event:last-child { border-bottom: 0; }
.yw-event-icon { color: var(--accent); display: inline-flex; }
.yw-event-main { flex: 1; min-width: 0; display: grid; }
.yw-event-main strong { font-size: 13px; }
.yw-event-main small { font-size: 11.5px; color: var(--text-faint); }
.yw-added { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--success, #3fb950); }

.yw-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.yw-stat { border-radius: 10px; padding: 8px 10px; background: color-mix(in srgb, var(--accent) 6%, transparent); display: grid; gap: 2px; }
.yw-stat-label { font-size: 11.5px; color: var(--text-faint); }
.yw-stat-value { font-size: 18px; font-variant-numeric: tabular-nums; }
.yw-stat-delta { font-size: 11.5px; color: var(--text-dim); }
.yw-stat-delta.is-up { color: var(--success, #3fb950); }
.yw-stat-delta.is-down { color: var(--warning, #d29922); }
`;
  document.head.append(style);
}
