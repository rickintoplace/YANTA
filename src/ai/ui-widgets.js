// ============================================================
// YANTA AI — interactive widgets in answers
//
// An answer may contain one fenced block with the language `yanta-ui`
// holding JSON. It is rendered as a widget from a fixed catalogue —
// calculator, chart, table, checklist, events, stats, progress, steps,
// pros/cons, choices, flashcards, timer — with YANTA's own
// components and CSS. Nothing in the block is executed: formulas go
// through the evaluator in ui-expr.js, text is always escaped, and the
// only side effects are the ones the user clicks (save as note, add an
// event). That keeps a widget harmless even when the model was steered
// by something it read.
//
// Widget state (inputs, ticks, added events) lives on the message, so a
// re-render while another answer streams keeps what the user entered,
// and "Save as note" saves what is on screen.
//
// @i18n-locked — user-facing text goes through t('ai.widgets.…')
// (src/i18n/locales/ai/widgets.en.js). Data from the model (titles,
// labels, values) is shown as it came.
// ============================================================

import { lucide, escapeHtml, toast, actionToast } from '../core.js';
import { getLocale, t } from '../i18n/index.js';
import { compileFormula } from './ui-expr.js';
import { chartElement } from './ui-widget-charts.js';
import { WIDGET_CSS } from './ui-widget-styles.js';

export const WIDGET_LANG = 'yanta-ui';

// The model-facing prompt lives in its own module (it stays English).
export { WIDGET_INSTRUCTIONS } from './ui-widget-prompt.js';

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

// Validation messages below are developer-facing: they end up in logs and
// tests, never in the UI (the error fold-out shows the raw block instead).
/* eslint-disable yanta/no-untranslated-literal */
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
      name: str(s?.name || t('ai.widgets.chart.seriesName', { n: n + 1 }), 40),
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

  if (type === 'steps') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 20).map((i) => (typeof i === 'string'
      ? { title: str(i, 140), text: '', status: 'todo' }
      : { title: str(i?.title, 140), text: str(i?.text, 400), status: ['done', 'current', 'todo'].includes(i?.status) ? i.status : 'todo' }
    )).filter((i) => i.title);
    if (!items.length) throw new Error('No steps');
    return { ...base, items };
  }

  if (type === 'proscons') {
    const list = (v) => (Array.isArray(v) ? v : []).slice(0, 12).map((x) => str(x, 200)).filter(Boolean);
    const pros = list(raw.pros);
    const cons = list(raw.cons);
    if (!pros.length && !cons.length) throw new Error('No pros or cons');
    return { ...base, pros, cons, verdict: str(raw.verdict, 300) };
  }

  if (type === 'choices') {
    const options = (Array.isArray(raw.options) ? raw.options : []).slice(0, 6).map((o) => (typeof o === 'string'
      ? { label: str(o, 80), description: '', prompt: str(o, 300) }
      : { label: str(o?.label, 80), description: str(o?.description, 200), prompt: str(o?.prompt || o?.label, 300) }
    )).filter((o) => o.label);
    if (options.length < 2) throw new Error('Choices need at least two options');
    return { ...base, question: str(raw.question, 200), options };
  }

  if (type === 'flashcards') {
    const cards = (Array.isArray(raw.cards) ? raw.cards : []).slice(0, 60)
      .map((c) => ({ front: str(c?.front, 300), back: str(c?.back, 600) }))
      .filter((c) => c.front && c.back);
    if (!cards.length) throw new Error('No cards');
    return { ...base, cards };
  }

  if (type === 'timer') {
    const seconds = Math.round(num(raw.seconds, 0) || num(raw.minutes, 0) * 60);
    if (!(seconds > 0 && seconds <= 24 * 3600)) throw new Error('Timer needs 1 s to 24 h');
    const presets = (Array.isArray(raw.presets) ? raw.presets : []).slice(0, 5)
      .map((m) => Math.round(num(m) * 60)).filter((s) => s > 0 && s <= 24 * 3600);
    return { ...base, label: str(raw.label, 80), seconds, presets };
  }

  if (type === 'progress') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 12).map((i) => ({
      label: str(i?.label, 80),
      value: num(i?.value, NaN),
      target: num(i?.target, NaN),
      unit: str(i?.unit, 12),
      format: ['number', 'integer', 'currency', 'percent'].includes(i?.format) ? i.format : 'number',
      currency: /^[A-Z]{3}$/.test(String(i?.currency || '')) ? i.currency : 'EUR',
    })).filter((i) => i.label && Number.isFinite(i.value) && Number.isFinite(i.target) && i.target !== 0);
    if (!items.length) throw new Error('No progress items');
    return { ...base, items };
  }

  throw new Error(`Unknown widget type "${type}"`);
}
/* eslint-enable yanta/no-untranslated-literal */

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

function button(cls, html, onClick, title = '') {
  const b = el('button', cls, html);
  b.type = 'button';
  if (title) {
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// eslint-disable-next-line yanta/no-untranslated-literal -- media query
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts a number from its last shown value to the new one. */
function tweenNumber(node, to, format) {
  const from = Number(node.dataset.v);
  node.dataset.v = String(to);

  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to || reducedMotion()) {
    node.textContent = format(to);
    return;
  }

  const start = performance.now();
  const ms = 320;
  cancelAnimationFrame(Number(node.dataset.raf) || 0);

  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    const e = 1 - (1 - k) ** 3;
    node.textContent = format(from + (to - from) * e);
    if (k < 1) node.dataset.raf = String(requestAnimationFrame(step));
  };

  node.dataset.raf = String(requestAnimationFrame(step));
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS selector
  node.closest('.yw-output, .yw-stat')?.animate?.(
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS values
    [{ boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent)' }, { boxShadow: '0 0 0 6px transparent' }],
    { duration: 500, easing: 'ease-out' }
  );
}

/** Sets a bar's width after first paint, so it grows instead of appearing. */
function growTo(node, pct) {
  const clamped = `${Math.max(0, Math.min(100, pct))}%`;
  if (!node.isConnected) {
    node.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { node.style.width = clamped; }));
  } else {
    node.style.width = clamped;
  }
}

function sliderFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const v = Number(input.value);
  input.style.setProperty('--fill', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
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
  const values = calculatorState(spec, state);

  // Output cards are built once and only their numbers change.
  const outNodes = spec.outputs.map((o) => {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    const card = el('div', `yw-output${o.primary ? ' is-primary' : ''}`);
    card.append(el('span', 'yw-output-label', escapeHtml(o.label)));
    const value = el('strong', 'yw-output-value');
    card.append(value);
    outputs.append(card);
    return value;
  });

  let chart = null;

  const chartData = () => {
    const xs = Array.from({ length: spec.chart.steps }, (_, i) => spec.chart.from + ((spec.chart.to - spec.chart.from) * i) / (spec.chart.steps - 1));
    const first = spec.outputs.find((o) => o.id === spec.chart.y[0]) || {};
    return {
      kind: 'line',
      labels: xs.map((x) => formatValue(x, { decimals: Number.isInteger(x) ? 0 : 1 })),
      series: spec.chart.y.map((id) => ({
        name: spec.outputs.find((o) => o.id === id)?.label || id,
        values: xs.map((x) => computeOutputs(spec, { ...values, [spec.chart.input]: x }).find((r) => r.id === id)?.v ?? NaN),
      })),
      fmt: (v) => formatValue(v, first),
      tickFmt: (v) => formatValue(v, { ...first, decimals: 0 }),
    };
  };

  const update = () => {
    computeOutputs(spec, values).forEach((r, i) => tweenNumber(outNodes[i], r.v, (v) => formatValue(v, r)));
    if (chart) chart.update(chartData());
    state.values = { ...values };
    save();
  };

  for (const input of spec.inputs) {
    const row = el('label', `yw-input yw-input-${input.type}`);
    const label = el('span', 'yw-input-label', escapeHtml(input.label));
    row.append(label);

    if (input.type === 'select' && input.options.length) {
      const control = document.createElement('select');
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
      const control = document.createElement('input');
      control.type = 'checkbox';
      control.className = 'yw-switch';
      control.checked = !!values[input.id];
      control.addEventListener('change', () => { values[input.id] = control.checked ? 1 : 0; update(); });
      row.append(control);
    } else if (input.type === 'slider') {
      const readout = el('output', 'yw-slider-value');
      const show = () => {
        readout.textContent = `${formatValue(values[input.id], { decimals: input.step && input.step < 1 ? 2 : 0 })}${input.unit ? ` ${input.unit}` : ''}`;
      };
      label.append(readout);
      const control = document.createElement('input');
      control.type = 'range';
      control.className = 'yw-range';
      control.min = String(input.min ?? 0);
      control.max = String(input.max ?? Math.max(100, values[input.id] * 2));
      control.step = String(input.step ?? 1);
      control.value = String(values[input.id]);
      sliderFill(control);
      show();
      control.addEventListener('input', () => {
        values[input.id] = Number(control.value);
        sliderFill(control);
        show();
        update();
      });
      row.append(control);
    } else {
      const field = el('span', 'yw-field');
      const control = document.createElement('input');
      control.type = 'number';
      control.inputMode = 'decimal';
      if (input.min != null) control.min = String(input.min);
      if (input.max != null) control.max = String(input.max);
      control.step = String(input.step ?? 'any');
      control.value = String(values[input.id]);
      control.addEventListener('input', () => {
        const v = Number(control.value);
        if (control.value !== '' && Number.isFinite(v)) {
          values[input.id] = v;
          update();
        }
      });
      field.append(control);
      if (input.unit) field.append(el('span', 'yw-unit', escapeHtml(input.unit)));
      row.append(field);
    }

    form.append(row);
  }

  root.append(form, outputs);

  if (spec.chart) {
    chart = chartElement(chartData());
    chart.classList.add('yw-calc-chart');
    root.append(chart);
  }

  update();

  root.toMarkdown = () => [
    ...spec.inputs.map((i) => `- ${i.label}: ${i.type === 'toggle' ? (values[i.id] ? t('ai.widgets.calculator.yes') : t('ai.widgets.calculator.no')) : formatValue(values[i.id], { unit: i.unit })}`),
    '',
    ...computeOutputs(spec, values).map((r) => `- **${r.label}: ${formatValue(r.v, r)}**`),
  ].join('\n');

  return root;
}

function renderChart(spec) {
  const root = chartElement({
    kind: spec.kind,
    labels: spec.labels,
    series: spec.series,
    fmt: (v) => formatValue(v, spec),
    tickFmt: (v) => formatValue(v, { ...spec, decimals: 0 }),
  });

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
    if (ok.length) bestRow = vals.indexOf(spec.best.direction === 'min' ? Math.min(...ok) : Math.max(...ok));
  }

  const draw = () => {
    const order = spec.rows.map((_, i) => i);
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
      const th = el('th', sort?.column === i ? 'is-sorted' : '', `<span>${escapeHtml(c)}</span>${lucide(sort?.column === i && sort.dir === 'desc' ? 'arrow-down' : 'arrow-up', 11)}`);
      th.tabIndex = 0;
      const toggle = () => {
        sort = sort?.column === i && sort.dir === 'asc' ? { column: i, dir: 'desc' } : { column: i, dir: 'asc' };
        state.sort = sort;
        save();
        draw();
      };
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      head.append(th);
    });

    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');

    for (const ri of order) {
      const tr = el('tr', ri === bestRow ? 'is-best' : '');
      spec.columns.forEach((_, ci) => {
        const v = spec.rows[ri][ci] ?? '';
        const td = el('td', numeric(v) != null && ci > 0 ? 'is-num' : '', escapeHtml(v));
        if (ri === bestRow && ci === 0) td.insertAdjacentHTML('beforeend', ` <span class="yw-badge">${lucide('trophy', 11)} ${escapeHtml(t('ai.widgets.table.best'))}</span>`);
        tr.append(td);
      });
      tbody.append(tr);
    }

    table.replaceChildren(thead, tbody);
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

function progressBar(pct, cls = '') {
  const bar = el('div', `yw-bar ${cls}`.trim());
  const fill = el('span');
  bar.append(fill);
  growTo(fill, pct);
  bar.set = (p) => growTo(fill, p);
  return bar;
}

function renderChecklist(spec, state, save) {
  const root = el('div', 'yw-checklist');
  const done = Array.isArray(state.done) ? state.done : spec.items.map((i) => i.done);
  const head = el('div', 'yw-progress-row');
  const bar = progressBar(0);
  const count = el('span', 'yw-progress-count');
  head.append(bar, count);
  root.append(head);

  const showProgress = () => {
    const n = done.filter(Boolean).length;
    bar.set((n / spec.items.length) * 100);
    count.textContent = `${n}/${spec.items.length}`;
    root.classList.toggle('is-complete', n === spec.items.length);
  };

  const list = el('div', 'yw-checks');
  spec.items.forEach((item, i) => {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    const row = el('label', `yw-check${done[i] ? ' is-done' : ''}`);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'yw-checkbox';
    box.checked = !!done[i];
    box.addEventListener('change', () => {
      done[i] = box.checked;
      row.classList.toggle('is-done', box.checked);
      state.done = [...done];
      save();
      showProgress();
    });
    row.append(box, el('span', 'yw-check-text', escapeHtml(item.text)));
    list.append(row);
  });
  root.append(list);

  showProgress();

  root.toMarkdown = () => spec.items.map((item, i) => `- [${done[i] ? 'x' : ' '}] ${item.text}`).join('\n');

  return root;
}

function formatEventTime(e) {
  const loc = intlLocale();
  const start = new Date(e.start);
  try {
    if (e.allDay) return new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' }).format(start);
    const time = (d) => new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(d);
    return `${time(start)}${e.end && !Number.isNaN(Date.parse(e.end)) ? ` – ${time(new Date(e.end))}` : ''}`;
  } catch {
    return e.start;
  }
}

function renderEvents(spec, state, save) {
  const root = el('div', 'yw-events');
  const added = Array.isArray(state.added) ? state.added : spec.items.map(() => false);
  const buttons = [];
  const loc = intlLocale();

  const markAdded = (i) => {
    const done = el('span', 'yw-added', `${lucide('check', 13)} ${escapeHtml(t('ai.widgets.events.added'))}`);
    buttons[i].replaceWith(done);
    buttons[i] = done;
  };

  const add = async (i) => {
    if (added[i]) return;
    const e = spec.items[i];
    try {
      const { createEventAction } = await import('./app-actions.js');
      await createEventAction({ title: e.title, start: e.start, end: e.end || null, allDay: e.allDay, location: e.location || undefined });
      added[i] = true;
      state.added = [...added];
      save();
      markAdded(i);
    } catch (err) {
      toast(t('ai.widgets.events.addFailed', { error: String(err?.message || err) }), 'error');
    }
  };

  spec.items.forEach((e, i) => {
    const d = new Date(e.start);
    const row = el('div', 'yw-event');

    const date = el('div', 'yw-event-date');
    try {
      date.innerHTML = `<small>${escapeHtml(new Intl.DateTimeFormat(loc, { month: 'short' }).format(d))}</small><strong>${d.getDate()}</strong><small>${escapeHtml(new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d))}</small>`;
    } catch {
      date.textContent = e.start.slice(5, 10);
    }

    const main = el('div', 'yw-event-main');
    main.append(el('strong', '', escapeHtml(e.title)));
    main.append(el('small', '', escapeHtml([e.allDay ? t('ai.widgets.events.allDay') : formatEventTime(e), e.location].filter(Boolean).join(' · '))));

    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS classes
    buttons[i] = button('yw-btn yw-btn-soft', `${lucide('calendar-plus', 13)}<span>${escapeHtml(t('ai.widgets.events.add'))}</span>`, () => add(i), t('ai.widgets.events.addToCalendar'));

    row.append(date, main, buttons[i]);
    root.append(row);
    if (added[i]) markAdded(i);
  });

  root.extraActions = spec.items.length > 1
    ? [{
        label: t('ai.widgets.events.addAll'),
        icon: 'calendar-plus',
        run: async () => {
          for (let i = 0; i < spec.items.length; i++) await add(i);
          toast(t('ai.widgets.events.allAdded'), 'success');
        },
      }]
    : [];

  root.toMarkdown = () => spec.items.map((e) => `- **${e.title}** — ${e.start.replace('T', ' ')}${e.end ? ` – ${e.end.replace('T', ' ')}` : ''}${e.location ? ` · ${e.location}` : ''}`).join('\n');

  return root;
}

function renderStats(spec) {
  const root = el('div', 'yw-stats');
  for (const s of spec.items) {
    const card = el('div', 'yw-stat');
    if (s.hint) card.title = s.hint;
    card.append(el('span', 'yw-stat-label', escapeHtml(s.label)));
    const value = el('strong', 'yw-stat-value', escapeHtml(s.value));
    card.append(value);
    if (s.delta) {
      const up = /^\+/.test(s.delta);
      const down = /^[-−]/.test(s.delta);
      // eslint-disable-next-line yanta/no-untranslated-literal -- CSS classes
      card.append(el('small', `yw-stat-delta${up ? ' is-up' : down ? ' is-down' : ''}`, `${up ? lucide('trending-up', 12) : down ? lucide('trending-down', 12) : ''}${escapeHtml(s.delta)}`));
    }
    root.append(card);

    // Count up purely numeric values.
    const n = Number(String(s.value).replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (/^[\d.,\s]+$/.test(s.value) && Number.isFinite(n) && !reducedMotion()) {
      value.dataset.v = '0';
      requestAnimationFrame(() => tweenNumber(value, n, (v) => formatValue(v, { decimals: Number.isInteger(n) ? 0 : 1 })));
    }
  }
  root.toMarkdown = () => spec.items.map((s) => `- ${s.label}: **${s.value}**${s.delta ? ` (${s.delta})` : ''}`).join('\n');
  return root;
}

function renderProgress(spec) {
  const root = el('div', 'yw-progress-list');
  for (const item of spec.items) {
    const pct = (item.value / item.target) * 100;
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    const row = el('div', `yw-progress-item${pct >= 100 ? ' is-full' : ''}`);
    const top = el('div', 'yw-progress-top');
    top.append(el('span', '', escapeHtml(item.label)));
    top.append(el('span', 'yw-progress-num', `<b>${escapeHtml(formatValue(item.value, item))}</b> / ${escapeHtml(formatValue(item.target, item))} · ${Math.round(pct)} %`));
    row.append(top, progressBar(pct, pct > 100 ? 'is-over' : ''));
    root.append(row);
  }
  root.toMarkdown = () => spec.items.map((i) => `- ${i.label}: ${formatValue(i.value, i)} / ${formatValue(i.target, i)} (${Math.round((i.value / i.target) * 100)} %)`).join('\n');
  return root;
}

function renderSteps(spec, state, save) {
  const root = el('ol', 'yw-steps');
  const status = Array.isArray(state.status) ? state.status : spec.items.map((i) => i.status);

  const paint = () => {
    [...root.children].forEach((li, i) => {
      li.className = `yw-step is-${status[i]}`;
      li.querySelector('.yw-step-dot').innerHTML = status[i] === 'done' ? lucide('check', 12) : String(i + 1);
    });
  };

  spec.items.forEach((item, i) => {
    const li = el('li');
    const dot = button('yw-step-dot', '', () => {
      status[i] = status[i] === 'done' ? 'todo' : 'done';
      // The first open step after a done one is "current".
      const next = status.findIndex((s) => s !== 'done');
      status.forEach((s, j) => { if (s !== 'done') status[j] = j === next ? 'current' : 'todo'; });
      state.status = [...status];
      save();
      paint();
    }, t('ai.widgets.steps.markDone'));
    const body = el('div', 'yw-step-body');
    body.append(el('strong', '', escapeHtml(item.title)));
    if (item.text) body.append(el('p', '', escapeHtml(item.text)));
    li.append(dot, body);
    root.append(li);
  });

  paint();
  root.toMarkdown = () => spec.items.map((item, i) => `${i + 1}. ${status[i] === 'done' ? '~~' : ''}**${item.title}**${status[i] === 'done' ? '~~' : ''}${item.text ? ` — ${item.text}` : ''}`).join('\n');
  return root;
}

function renderProsCons(spec) {
  const root = el('div', 'yw-proscons');
  const col = (title, items, cls, icon) => {
    const c = el('div', `yw-pc ${cls}`);
    c.append(el('div', 'yw-pc-head', `${lucide(icon, 14)}<span>${escapeHtml(title)}</span><em>${items.length}</em>`));
    const ul = el('ul');
    for (const item of items) ul.append(el('li', '', escapeHtml(item)));
    c.append(ul);
    return c;
  };
  root.append(
    col(t('ai.widgets.proscons.pros'), spec.pros, 'is-pro', 'thumbs-up'),
    col(t('ai.widgets.proscons.cons'), spec.cons, 'is-con', 'thumbs-down'),
  );
  if (spec.verdict) root.append(el('div', 'yw-verdict', `${lucide('scale', 14)}<span>${escapeHtml(spec.verdict)}</span>`));
  root.toMarkdown = () => [
    `**${t('ai.widgets.proscons.pros')}**`, ...spec.pros.map((p) => `- ${p}`),
    '',
    `**${t('ai.widgets.proscons.cons')}**`, ...spec.cons.map((c) => `- ${c}`),
    ...(spec.verdict ? ['', t('ai.widgets.proscons.verdictMarkdown', { verdict: spec.verdict })] : []),
  ].join('\n');
  return root;
}

function renderChoices(spec, state, save, ctx) {
  const root = el('div', 'yw-choices');
  if (spec.question) root.append(el('p', 'yw-question', escapeHtml(spec.question)));
  const grid = el('div', 'yw-choice-grid');

  spec.options.forEach((o, i) => {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    const b = button(`yw-choice${state.picked === i ? ' is-picked' : ''}`, `<strong>${escapeHtml(o.label)}</strong>${o.description ? `<small>${escapeHtml(o.description)}</small>` : ''}<span class="yw-choice-go">${lucide('arrow-right', 14)}</span>`, () => {
      if (state.picked != null || !ctx.ask) return;
      state.picked = i;
      save();
      grid.querySelectorAll('.yw-choice').forEach((n, j) => n.classList.toggle(j === i ? 'is-picked' : 'is-dimmed', true));
      ctx.ask(o.prompt);
    });
    if (state.picked != null && state.picked !== i) b.classList.add('is-dimmed');
    grid.append(b);
  });

  root.append(grid);
  root.noSave = true;
  return root;
}

function renderFlashcards(spec, state, save) {
  const root = el('div', 'yw-cards');
  let order = Array.isArray(state.order) && state.order.length === spec.cards.length ? state.order : spec.cards.map((_, i) => i);
  let pos = Math.min(state.pos || 0, spec.cards.length - 1);
  let flipped = false;

  const card = button('yw-card', '', () => {
    flipped = !flipped;
    card.classList.toggle('is-flipped', flipped);
  }, t('ai.widgets.flashcards.flip'));
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS classes
  const front = el('div', 'yw-card-face yw-card-front');
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS classes
  const back = el('div', 'yw-card-face yw-card-back');
  const inner = el('div', 'yw-card-inner');
  inner.append(front, back);
  card.append(inner);

  const nav = el('div', 'yw-card-nav');
  const counter = el('span', 'yw-card-count');
  const bar = progressBar(0, 'is-thin');

  const show = () => {
    const c = spec.cards[order[pos]];
    flipped = false;
    card.classList.remove('is-flipped');
    front.innerHTML = `<small>${escapeHtml(t('ai.widgets.flashcards.question'))}</small><p>${escapeHtml(c.front)}</p><em>${lucide('rotate-3d', 12)} ${escapeHtml(t('ai.widgets.flashcards.tapToFlip'))}</em>`;
    back.innerHTML = `<small>${escapeHtml(t('ai.widgets.flashcards.answer'))}</small><p>${escapeHtml(c.back)}</p>`;
    counter.textContent = `${pos + 1} / ${spec.cards.length}`;
    bar.set(((pos + 1) / spec.cards.length) * 100);
    state.pos = pos;
    state.order = order;
    save();
  };

  nav.append(
    button('yw-icon-btn', lucide('chevron-left', 16), () => { pos = (pos - 1 + spec.cards.length) % spec.cards.length; show(); }, t('ai.widgets.flashcards.previous')),
    counter,
    button('yw-icon-btn', lucide('chevron-right', 16), () => { pos = (pos + 1) % spec.cards.length; show(); }, t('ai.widgets.flashcards.next')),
    button('yw-icon-btn', lucide('shuffle', 15), () => {
      order = [...order].sort(() => Math.random() - 0.5);
      pos = 0;
      show();
    }, t('ai.widgets.flashcards.shuffle')),
  );

  root.append(card, bar, nav);
  show();

  root.toMarkdown = () => spec.cards.map((c) => t('ai.widgets.flashcards.cardMarkdown', { front: c.front, back: c.back })).join('\n\n');
  return root;
}

// Timers keep running across re-renders: their clock lives here, keyed by
// the state object of the widget that started them.
const runningTimers = new WeakMap();

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach((at, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = [880, 1046, 1318][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.32);
    });
  } catch {}
}

function renderTimer(spec, state, save) {
  const root = el('div', 'yw-timer');
  let total = state.total || spec.seconds;
  const R = 52;
  const C = 2 * Math.PI * R;

  const ring = el('div', 'yw-timer-ring', `
    <svg viewBox="0 0 120 120"><circle class="yw-timer-track" cx="60" cy="60" r="${R}"/><circle class="yw-timer-arc" cx="60" cy="60" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
    <div class="yw-timer-text"><strong></strong><small>${escapeHtml(spec.label || '')}</small></div>`);
  const arc = ring.querySelector('.yw-timer-arc');
  const text = ring.querySelector('strong');

  const controls = el('div', 'yw-timer-controls');
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS classes
  const play = button('yw-btn yw-btn-primary', '', () => toggle());
  const reset = button('yw-icon-btn', lucide('rotate-ccw', 15), () => { stop(); state.left = total; state.endsAt = null; save(); paint(); }, t('ai.widgets.timer.reset'));
  controls.append(play, reset);

  if (spec.presets.length) {
    const presets = el('div', 'yw-timer-presets');
    for (const p of spec.presets) {
      presets.append(button('yw-chip', escapeHtml(t('ai.widgets.timer.minutes', { count: Math.round(p / 60) })), () => {
        stop();
        total = p;
        state.total = p;
        state.left = p;
        state.endsAt = null;
        save();
        paint();
      }));
    }
    root.append(presets);
  }

  const left = () => (state.endsAt ? Math.max(0, (state.endsAt - Date.now()) / 1000) : state.left ?? total);

  const paint = () => {
    const l = left();
    const m = Math.floor(l / 60);
    const s = Math.floor(l % 60);
    text.textContent = `${m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
    arc.setAttribute('stroke-dashoffset', String(C * (1 - l / total)));
    const running = !!state.endsAt;
    const playLabel = t(running ? 'ai.widgets.timer.pause' : l < total ? 'ai.widgets.timer.resume' : 'ai.widgets.timer.start');
    play.innerHTML = `${lucide(running ? 'pause' : 'play', 14)}<span>${escapeHtml(playLabel)}</span>`;
    root.classList.toggle('is-running', running);
    root.classList.toggle('is-finished', l <= 0);
  };

  const name = spec.label || spec.title || t('ai.widgets.titles.timer');

  const tick = () => {
    if (!root.isConnected && !state.endsAt) return;
    paint();
    if (state.endsAt && left() <= 0) {
      state.endsAt = null;
      state.left = 0;
      save();
      paint();
      chime();
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(name, { body: t('ai.widgets.timer.notificationBody') });
        }
      } catch {}
      toast(t('ai.widgets.timer.timeUp', { label: name }), 'success');
      return;
    }
    if (state.endsAt) runningTimers.set(state, requestAnimationFrame(tick));
  };

  const stop = () => {
    if (state.endsAt) {
      state.left = left();
      state.endsAt = null;
    }
    cancelAnimationFrame(runningTimers.get(state));
  };

  const toggle = () => {
    if (state.endsAt) {
      stop();
    } else {
      const l = left() > 0 ? left() : total;
      state.endsAt = Date.now() + l * 1000;
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch?.(() => {});
      runningTimers.set(state, requestAnimationFrame(tick));
    }
    save();
    paint();
  };

  root.prepend(ring);
  root.append(controls);
  paint();
  if (state.endsAt) runningTimers.set(state, requestAnimationFrame(tick));

  root.toMarkdown = () => `- ${t('ai.widgets.timer.noteLine', { duration: t('ai.widgets.timer.minutes', { count: Math.round(total / 60) }) })}${spec.label ? ` (${spec.label})` : ''}`;
  return root;
}

const RENDERERS = {
  calculator: renderCalculator,
  chart: renderChart,
  table: renderTable,
  checklist: renderChecklist,
  events: renderEvents,
  stats: renderStats,
  progress: renderProgress,
  steps: renderSteps,
  proscons: renderProsCons,
  choices: renderChoices,
  flashcards: renderFlashcards,
  timer: renderTimer,
};

const ICONS = {
  calculator: 'calculator',
  chart: 'chart-column',
  table: 'table',
  checklist: 'list-checks',
  events: 'calendar-days',
  stats: 'gauge',
  progress: 'target',
  steps: 'list-ordered',
  proscons: 'scale',
  choices: 'messages-square',
  flashcards: 'layers',
  timer: 'timer',
};

/**
 * The widget for one extracted block. `state` is a plain object kept on
 * the message; `save()` persists it; `ask(text)` sends a user message.
 */
export function renderWidget(block, { state = {}, save = () => {}, ask = null } = {}) {
  injectWidgetStyles();

  if (block.pending) {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS classes
    const node = el('div', 'yw yw--pending');
    node.innerHTML = `<div class="yw-head"><span class="yw-icon">${lucide('sparkles', 14)}</span><span class="yw-skel" style="width:40%"></span></div><span class="yw-skel"></span><span class="yw-skel" style="width:75%"></span>`;
    return node;
  }

  if (block.error || !block.spec) {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS classes
    const node = el('details', 'yw yw--error');
    node.innerHTML = `<summary>${lucide('triangle-alert', 13)} ${escapeHtml(t('ai.widgets.error.notShown'))}</summary><pre>${escapeHtml(String(block.raw || block.error || '').slice(0, 2000))}</pre>`;
    return node;
  }

  const { spec } = block;
  const card = el('section', `yw yw--${spec.type}`);

  const head = el('header', 'yw-head');
  head.append(el('span', 'yw-icon', lucide(ICONS[spec.type] || 'sparkles', 15)));
  const titles = el('div', 'yw-titles');
  titles.append(el('strong', 'yw-title', escapeHtml(spec.title || (RENDERERS[spec.type] ? t(`ai.widgets.titles.${spec.type}`) : spec.type))));
  if (spec.note) titles.append(el('span', 'yw-sub', escapeHtml(spec.note)));
  head.append(titles);
  card.append(head);

  let body;
  try {
    body = RENDERERS[spec.type](spec, state, save, { ask });
  } catch (err) {
    // eslint-disable-next-line yanta/no-untranslated-literal -- console log
    console.warn('[YANTA AI] widget failed', err);
    card.append(el('p', 'yw-sub', escapeHtml(t('ai.widgets.error.notBuilt'))));
    return card;
  }

  body.classList.add('yw-body');
  card.append(body);

  const actions = el('div', 'yw-actions');

  for (const extra of body.extraActions || []) {
    actions.append(button('yw-btn', `${lucide(extra.icon, 13)}<span>${escapeHtml(extra.label)}</span>`, () => extra.run(), extra.label));
  }

  if (!body.noSave) {
    actions.append(button('yw-btn', `${lucide('file-plus', 13)}<span>${escapeHtml(t('ai.widgets.actions.saveAsNote'))}</span>`, async () => {
      try {
        const { createNoteAction } = await import('./app-actions.js');
        const note = await createNoteAction({
          title: spec.title || t('ai.widgets.actions.noteTitleFallback'),
          body: body.toMarkdown ? body.toMarkdown() : '',
        });
        actionToast(spec.title ? t('ai.widgets.toast.saved', { title: spec.title }) : t('ai.widgets.toast.savedUntitled'), {
          actionLabel: t('ai.widgets.toast.open'),
          onAction: async () => {
            const { openNote } = await import('../notes.js');
            openNote(note.id);
          },
        });
      } catch (err) {
        toast(t('ai.widgets.toast.saveFailed', { error: String(err?.message || err) }), 'error');
      }
    }, t('ai.widgets.actions.saveAsNote')));
  }

  if (actions.children.length) head.append(actions);

  return card;
}

/**
 * Replaces the markers in rendered markdown with widgets.
 * `stateFor(i)` returns the persisted state object for widget i.
 */
export function mountWidgets(root, widgets, { stateFor, save, ask = null }) {
  if (!widgets.length) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walker.nextNode()) {
    if (MARK_RE.test(walker.currentNode.nodeValue)) hits.push(walker.currentNode);
  }

  for (const textNode of hits) {
    const i = Number(MARK_RE.exec(textNode.nodeValue)[1]);
    const widget = renderWidget(widgets[i] || { error: 'missing' }, { state: stateFor(i), save, ask });
    // Replace the whole paragraph the marker sits in.
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS selector
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
  style.textContent = WIDGET_CSS;
  document.head.append(style);
}
