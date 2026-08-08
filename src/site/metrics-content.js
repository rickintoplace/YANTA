/*
  Owner-only funnel dashboard (/metrics).

  Reads GET /api/metrics/summary, which returns two kinds of numbers:

   - DERIVED: signups, activity, plans, subscriptions, retention and reach are
     computed from rows the service already keeps. No collection at all.
   - COLLECTED: landing views and CTA clicks, stored server-side as aggregate
     tallies (day + event + variant + referrer host). No identifier, no
     session, no IP.

  Charts are inline SVG on purpose: the CSP forbids external scripts, and a
  chart library would be a bigger dependency than the drawing it does.

  Palette: categorical slots 1 (blue) and 2 (orange) from the data-viz
  reference palette, validated against YANTA's own surfaces (#fdfcfa / #141414)
  in both modes — all six checks pass, so hue alone is a legal identity channel
  here; the legend and the table views back it up anyway.
*/

import { YANTA_CLOUD_BASE_URL } from '../cloud/cloud-api.js';

const TOKEN_KEY = 'yanta.metrics.token';

const SUMMARY_URL = `${YANTA_CLOUD_BASE_URL}/api/metrics/summary`;

/*
  Colour scoping mirrors styles.css exactly, and that is the whole point: ink
  and chart surface must be driven by the SAME signal, or they disagree.

  Dark is the default because YANTA's tokens default to dark. Light applies in
  the two cases where the app's own tokens go light: an explicit
  data-theme="light", and a light OS with either data-theme="auto" or no
  attribute at all — the latter being every first-time visitor and every
  standalone surface, since only the app stamps the attribute. Getting this
  wrong once already produced light ink on a dark page.

  Series hues are categorical slots 1 and 2 from the data-viz reference
  palette. Both pairs pass all six checks against the surface they render on
  (#141414 dark, #fdfcfa light): worst adjacent CVD ΔE 26.8 dark / 24.7 light,
  well clear of the ≥8 gate.
*/
const LIGHT_TOKENS = `
  --ym-s1: #2a78d6;
  --ym-s2: #eb6834;
  --ym-ink: #0b0b0b;
  --ym-ink-2: #52514e;
  --ym-muted: #898781;
  --ym-grid: #e1e0d9;
  --ym-axis: #c3c2b7;
  --ym-card: rgba(11, 11, 11, .025);
  --ym-ring: rgba(11, 11, 11, .10);
  --ym-surface: #fdfcfa;
`;

const CSS = `
.ym {
  --ym-s1: #3987e5;
  --ym-s2: #d95926;
  --ym-ink: #fff;
  --ym-ink-2: #c3c2b7;
  --ym-muted: #898781;
  --ym-grid: #2c2c2a;
  --ym-axis: #383835;
  --ym-card: rgba(255, 255, 255, .04);
  --ym-ring: rgba(255, 255, 255, .10);
  --ym-surface: #141414;
  color: var(--ym-ink);
}

@media (prefers-color-scheme: light) {
  :root[data-theme="auto"] .ym,
  :root:not([data-theme]) .ym { ${LIGHT_TOKENS} }
}

:root[data-theme="light"] .ym { ${LIGHT_TOKENS} }

.ym-gate { max-width: 30rem; }
.ym-gate input {
  width: 100%; padding: 10px 12px; margin: 10px 0 14px;
  border-radius: 8px; border: 1px solid var(--ym-ring);
  background: transparent; color: inherit; font: inherit;
}

.ym-hero { margin: 0 0 30px; }
.ym-hero-value {
  font-size: 56px; font-weight: 650; line-height: 1; letter-spacing: -.02em;
}
.ym-hero-label { color: var(--ym-ink-2); margin-top: 8px; font-size: 15px; }

.ym-tiles {
  display: grid; gap: 14px; margin: 0 0 34px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}
.ym-tile {
  border: 1px solid var(--ym-ring); border-radius: 11px;
  background: var(--ym-card); padding: 14px 16px;
}
.ym-tile-label {
  font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--ym-muted); margin-bottom: 7px;
}
.ym-tile-value { font-size: 27px; font-weight: 620; line-height: 1.1; }
.ym-tile-sub { font-size: 13px; color: var(--ym-ink-2); margin-top: 5px; }

.ym-section { margin: 0 0 38px; }
.ym-section > h2 {
  font-size: 16px; font-weight: 620; margin: 0 0 4px;
}
.ym-section > p.ym-note {
  font-size: 13px; color: var(--ym-ink-2); margin: 0 0 14px;
}

.ym-legend {
  display: flex; gap: 18px; flex-wrap: wrap;
  font-size: 13px; color: var(--ym-ink-2); margin: 0 0 10px;
}
.ym-legend span { display: inline-flex; align-items: center; gap: 7px; }
.ym-key { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }

.ym-chart { position: relative; }
.ym-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.ym-tip {
  position: absolute; pointer-events: none; opacity: 0;
  transform: translate(-50%, -100%);
  background: var(--ym-surface); color: var(--ym-ink);
  border: 1px solid var(--ym-ring); border-radius: 8px;
  padding: 7px 10px; font-size: 12px; white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .16);
  font-variant-numeric: tabular-nums;
}
.ym-tip.on { opacity: 1; }

table.ym-table { width: 100%; border-collapse: collapse; font-size: 14px; }
table.ym-table th, table.ym-table td {
  text-align: right; padding: 8px 10px;
  border-bottom: 1px solid var(--ym-grid);
}
table.ym-table th:first-child, table.ym-table td:first-child { text-align: left; }
table.ym-table th {
  font-size: 12px; text-transform: uppercase; letter-spacing: .07em;
  color: var(--ym-muted); font-weight: 600;
}
table.ym-table td { font-variant-numeric: tabular-nums; }

.ym-bar-track { background: var(--ym-card); border-radius: 4px; height: 10px; }
.ym-bar-fill { height: 100%; border-radius: 4px; background: var(--ym-s1); }

details.ym-data { margin-top: 12px; }
details.ym-data > summary {
  cursor: pointer; font-size: 13px; color: var(--ym-ink-2);
}
details.ym-data[open] > summary { margin-bottom: 10px; }

.ym-scroll { overflow-x: auto; }
.ym-empty { color: var(--ym-muted); font-size: 14px; }
.ym-foot { font-size: 12px; color: var(--ym-muted); margin-top: 34px; }
`;

function injectCss() {
  if (document.getElementById('yanta-metrics-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-metrics-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/*
  Compact only above 10k. Below that the exact number matters more than the
  space saved — "842" is more useful to read than "0.8K".
*/
function compact(n) {
  const value = Number(n || 0);
  if (Math.abs(value) < 10000) return fmt(value);
  if (Math.abs(value) < 1000000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1000000).toFixed(1)}M`;
}

const pct = (num, den) =>
  !den ? '—' : `${((num / den) * 100).toFixed(1)}%`;

// ---------------------------------------------------------------- charts

/*
  Multi-series line chart. 2px strokes, hairline grid, end-markers with a 2px
  surface ring, and a crosshair tooltip. Values are also exposed as a table
  below the chart, so nothing is gated behind hover.
*/
function lineChart(series, { height = 190 } = {}) {
  const days = [...new Set(series.flatMap((s) => s.points.map((p) => p.day)))].sort();

  if (days.length < 2) {
    return '<p class="ym-empty">Not enough data yet — needs at least two days.</p>';
  }

  const W = 720;
  const H = height;
  const padL = 40;
  const padR = 14;
  const padT = 12;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const byDay = series.map((s) => {
    const map = new Map(s.points.map((p) => [p.day, Number(p.n || 0)]));
    return days.map((d) => map.get(d) || 0);
  });

  const max = Math.max(1, ...byDay.flat());
  // Round the axis top to something clean so the ticks read well.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;

  const x = (i) => padL + (days.length === 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v) => padT + innerH - (v / top) * innerH;

  const ticks = [0, top / 2, top];

  const grid = ticks.map((t) => `
    <line x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"
      stroke="var(--ym-grid)" stroke-width="1" />
    <text x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end"
      font-size="11" fill="var(--ym-muted)">${fmt(Math.round(t))}</text>
  `).join('');

  const xLabels = [0, Math.floor((days.length - 1) / 2), days.length - 1]
    .filter((i, idx, arr) => arr.indexOf(i) === idx)
    .map((i) => `
      <text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="11" fill="var(--ym-muted)"
        text-anchor="${i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}">
        ${esc(days[i].slice(5))}
      </text>
    `).join('');

  const paths = series.map((s, si) => {
    const d = byDay[si].map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const lastI = days.length - 1;

    return `
      <path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" />
      <circle cx="${x(lastI).toFixed(1)}" cy="${y(byDay[si][lastI]).toFixed(1)}" r="4"
        fill="${s.color}" stroke="var(--ym-surface)" stroke-width="2" />
    `;
  }).join('');

  const rows = days.map((d, i) => `
    <tr><td>${esc(d)}</td>${byDay.map((vals) => `<td>${fmt(vals[i])}</td>`).join('')}</tr>
  `).join('');

  const payload = esc(JSON.stringify({
    days,
    series: series.map((s, si) => ({ label: s.label, values: byDay[si] })),
  }));

  return `
    <div class="ym-legend">
      ${series.map((s) => `
        <span><i class="ym-key" style="background:${s.color}"></i>${esc(s.label)}</span>
      `).join('')}
    </div>
    <div class="ym-chart" data-line='${payload}'
      data-pad-l="${padL}" data-pad-r="${padR}" data-w="${W}">
      <svg viewBox="0 0 ${W} ${H}" role="img"
        aria-label="${esc(series.map((s) => s.label).join(' and '))} per day">
        ${grid}
        <line x1="${padL}" x2="${W - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"
          stroke="var(--ym-axis)" stroke-width="1" />
        <line class="ym-cross" x1="0" x2="0" y1="${padT}" y2="${padT + innerH}"
          stroke="var(--ym-axis)" stroke-width="1" opacity="0" />
        ${paths}
        ${xLabels}
      </svg>
      <div class="ym-tip"></div>
    </div>
    <details class="ym-data">
      <summary>Show the numbers</summary>
      <div class="ym-scroll">
        <table class="ym-table">
          <thead><tr><th>Day</th>${series.map((s) => `<th>${esc(s.label)}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>
  `;
}

/*
  Single-series column chart. Bars are capped at 24px, 4px rounded on the cap
  and square at the baseline, with a 2px surface gap between neighbours.
*/
function columnChart(points, { color, label, height = 170 } = {}) {
  if (!points.length) return '<p class="ym-empty">No data yet.</p>';

  const W = 720;
  const H = height;
  const padL = 40;
  const padR = 14;
  const padT = 12;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = points.map((p) => Number(p.n || 0));
  const max = Math.max(1, ...values);
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;

  const band = innerW / points.length;
  const barW = Math.min(24, Math.max(2, band - 2));
  const y = (v) => padT + innerH - (v / top) * innerH;
  const radius = Math.min(4, barW / 2);

  const ticks = [0, top / 2, top];

  const grid = ticks.map((t) => `
    <line x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"
      stroke="var(--ym-grid)" stroke-width="1" />
    <text x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end"
      font-size="11" fill="var(--ym-muted)">${fmt(Math.round(t))}</text>
  `).join('');

  const bars = points.map((p, i) => {
    const v = values[i];
    const cx = padL + band * i + band / 2;
    const h = Math.max(v > 0 ? 1.5 : 0, padT + innerH - y(v));

    if (!h) return '';

    return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y(v).toFixed(1)}"
      width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
      rx="${radius}" fill="${color}"
      data-day="${esc(p.day)}" data-value="${v}"><title>${esc(p.day)}: ${fmt(v)}</title></rect>`;
  }).join('');

  const idx = [0, points.length - 1].filter((i, n, arr) => arr.indexOf(i) === n && i >= 0);
  const xLabels = idx.map((i) => `
    <text x="${(padL + band * i + band / 2).toFixed(1)}" y="${H - 6}" font-size="11"
      fill="var(--ym-muted)" text-anchor="${i === 0 ? 'start' : 'end'}">
      ${esc(points[i].day.slice(5))}
    </text>
  `).join('');

  return `
    <div class="ym-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} per day">
        ${grid}
        ${bars}
        <line x1="${padL}" x2="${W - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"
          stroke="var(--ym-axis)" stroke-width="1" />
        ${xLabels}
      </svg>
    </div>
  `;
}

// ---------------------------------------------------------------- sections

function tile(label, value, sub) {
  return `
    <div class="ym-tile">
      <div class="ym-tile-label">${esc(label)}</div>
      <div class="ym-tile-value">${esc(value)}</div>
      ${sub ? `<div class="ym-tile-sub">${esc(sub)}</div>` : ''}
    </div>
  `;
}

function variantSection(variants) {
  const get = (variant, name) =>
    variants
      .filter((r) => (r.variant || '') === variant && r.name === name)
      .reduce((sum, r) => sum + Number(r.n || 0), 0);

  const rows = ['a', 'b'].map((v) => {
    const views = get(v, 'landing_view');
    const ctas = get(v, 'landing_cta');
    return { v, views, ctas, rate: views ? ctas / views : 0 };
  });

  const best = Math.max(...rows.map((r) => r.rate), 0.0001);
  const totalViews = rows.reduce((s, r) => s + r.views, 0);

  if (!totalViews) {
    return '<p class="ym-empty">No landing visits counted yet.</p>';
  }

  const body = rows.map((r) => `
    <tr>
      <td>Variant ${r.v.toUpperCase()}</td>
      <td>${fmt(r.views)}</td>
      <td>${fmt(r.ctas)}</td>
      <td>${pct(r.ctas, r.views)}</td>
      <td style="width:34%">
        <div class="ym-bar-track">
          <div class="ym-bar-fill" style="width:${((r.rate / best) * 100).toFixed(1)}%"></div>
        </div>
      </td>
    </tr>
  `).join('');

  /*
    The honest caveat, on the page itself so it cannot be forgotten: below
    roughly a thousand views per variant only very large differences are real.
  */
  const enough = rows.every((r) => r.views >= 1000);

  return `
    <div class="ym-scroll">
      <table class="ym-table">
        <thead><tr><th>Variant</th><th>Views</th><th>Clicks</th><th>Rate</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="ym-note" style="margin-top:12px">
      ${enough
        ? 'Both variants have enough traffic for a difference above ~10% to mean something.'
        : 'Not enough traffic to call a winner: under ~1,000 views per variant only differences above ~30% are real. Treat this as direction, not proof.'}
    </p>
  `;
}

function sourcesSection(sources) {
  const map = new Map();

  for (const row of sources) {
    const key = row.source || 'direct';
    const entry = map.get(key) || { views: 0, ctas: 0 };
    if (row.name === 'landing_view') entry.views += Number(row.n || 0);
    if (row.name === 'landing_cta') entry.ctas += Number(row.n || 0);
    map.set(key, entry);
  }

  const rows = [...map.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 15);

  if (!rows.length) return '<p class="ym-empty">No referrers counted yet.</p>';

  return `
    <div class="ym-scroll">
      <table class="ym-table">
        <thead><tr><th>Referrer</th><th>Views</th><th>Clicks</th><th>Rate</th></tr></thead>
        <tbody>
          ${rows.map(([host, v]) => `
            <tr>
              <td>${esc(host)}</td>
              <td>${fmt(v.views)}</td>
              <td>${fmt(v.ctas)}</td>
              <td>${pct(v.ctas, v.views)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function retentionSection(retention) {
  const rows = retention.filter((r) => Number(r.signups || 0) > 0).slice(-12);

  if (!rows.length) return '<p class="ym-empty">No cohorts yet.</p>';

  return `
    <div class="ym-scroll">
      <table class="ym-table">
        <thead><tr><th>Signup week</th><th>Signups</th><th>Still there after 7 days</th><th>Rate</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.cohort)}</td>
              <td>${fmt(r.signups)}</td>
              <td>${fmt(r.retained_7)}</td>
              <td>${pct(Number(r.retained_7 || 0), Number(r.signups || 0))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/*
  The activation funnel. Deliberately three steps, because each one is a
  different decision: look at the page, enter the app, make something of your
  own. The last step is the only number that cannot be derived server-side —
  a visitor without an account exists only on their own device.
*/
function funnelSection(steps) {
  const first = steps[0].n || 0;

  if (!first) return '<p class="ym-empty">Nothing counted yet.</p>';

  return `
    <div class="ym-scroll">
      <table class="ym-table">
        <thead><tr><th>Step</th><th>Count</th><th>Of previous</th><th>Of all visits</th><th></th></tr></thead>
        <tbody>
          ${steps.map((step, i) => {
            const prev = i === 0 ? step.n : steps[i - 1].n || 0;
            return `
              <tr>
                <td>${esc(step.label)}</td>
                <td>${fmt(step.n)}</td>
                <td>${i === 0 ? '—' : pct(step.n, prev)}</td>
                <td>${pct(step.n, first)}</td>
                <td style="width:30%">
                  <div class="ym-bar-track">
                    <div class="ym-bar-fill" style="width:${((step.n / first) * 100).toFixed(1)}%"></div>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function dashboard(data) {
  const daily = (name) => data.landing.daily
    .filter((r) => r.name === name)
    .map((r) => ({ day: r.day, n: Number(r.n || 0) }));

  const totalOf = (name) => data.landing.variants
    .filter((r) => r.name === name)
    .reduce((sum, r) => sum + Number(r.n || 0), 0);

  const views = daily('landing_view');
  const ctas = daily('landing_cta');

  const totalViews = views.reduce((s, p) => s + p.n, 0);
  const totalCtas = ctas.reduce((s, p) => s + p.n, 0);
  const totalFirstNotes = totalOf('first_note');
  const totalShareKeeps = totalOf('share_keep');

  const subsByStatus = new Map(
    data.subscriptions.map((r) => [String(r.status || ''), Number(r.n || 0)])
  );
  const activeSubs =
    (subsByStatus.get('active') || 0) + (subsByStatus.get('trialing') || 0);

  const plusUsers = Number(
    (data.plans.find((p) => p.plan === 'premium') || {}).n || 0
  );

  const u = data.users || {};

  return `
    <section class="ym-hero">
      <div class="ym-hero-value">${esc(compact(activeSubs))}</div>
      <div class="ym-hero-label">
        Paying subscriptions${activeSubs !== plusUsers ? ` · ${fmt(plusUsers)} accounts on the Plus plan` : ''}
      </div>
    </section>

    <div class="ym-tiles">
      ${tile('Accounts', compact(u.total), `${fmt(u.new_30)} new in 30 days`)}
      ${tile('New this week', compact(u.new_7), `${fmt(u.new_1)} today`)}
      ${tile('Active this week', compact(u.active_7), `${fmt(u.active_30)} in 30 days`)}
      ${tile('Landing → app', pct(totalCtas, totalViews), `${fmt(totalCtas)} of ${fmt(totalViews)} visits`)}
      ${tile('Kept from a share', compact(totalShareKeeps), 'chose to keep a shared note')}
      ${tile('Shared spaces', compact(data.reach.spaces), `${fmt(data.reach.spaceMembers)} members · ${fmt(data.reach.publicShares)} public pages`)}
    </div>

    <section class="ym-section">
      <h2>Activation funnel</h2>
      <p class="ym-note">
        Where people stop. The last step — writing something of their own — is
        the moment a visitor becomes a user, and the only one no server-side
        derivation can see.
      </p>
      ${funnelSection([
        { label: 'Opened the landing page', n: totalViews },
        { label: 'Entered the app', n: totalCtas },
        { label: 'Wrote their first note', n: totalFirstNotes },
      ])}
    </section>

    <section class="ym-section">
      <h2>Landing page</h2>
      <p class="ym-note">
        Visits and clicks on “Start”, counted as daily totals. The only numbers on
        this page that are collected rather than derived.
      </p>
      ${lineChart([
        { label: 'Visits', color: 'var(--ym-s1)', points: views },
        { label: 'Clicked “Start”', color: 'var(--ym-s2)', points: ctas },
      ])}
    </section>

    <section class="ym-section">
      <h2>A/B: which framing converts</h2>
      <p class="ym-note">
        A leads on relief (“Everything for today, in one place”), B on control
        (“Your notes. Your calendar. Nobody else's”).
      </p>
      ${variantSection(data.landing.variants)}
    </section>

    <section class="ym-section">
      <h2>Signups per day</h2>
      <p class="ym-note">Derived from account creation dates — nothing extra is recorded.</p>
      ${columnChart(
        data.signupsDaily.map((r) => ({ day: r.day, n: Number(r.n || 0) })),
        { color: 'var(--ym-s1)', label: 'Signups' }
      )}
    </section>

    <section class="ym-section">
      <h2>Where visitors come from</h2>
      <p class="ym-note">Referring hostname only — never a full URL.</p>
      ${sourcesSection(data.landing.sources)}
    </section>

    <section class="ym-section">
      <h2>Do they stay?</h2>
      <p class="ym-note">
        Per signup week, how many accounts were still active at least 7 days
        after signing up. The single best early signal that the product works.
      </p>
      ${retentionSection(data.retention)}
    </section>

    <p class="ym-foot">
      Generated ${esc(new Date(data.generatedAt).toISOString().replace('T', ' ').slice(0, 16))} UTC ·
      no identifiers, sessions, IP addresses or user agents are stored anywhere in this data.
      <button class="link" data-metrics-forget type="button">Forget token</button>
    </p>
  `;
}

// ---------------------------------------------------------------- page

export function metricsContent() {
  injectCss();

  return `
    <main class="yanta-site-main ym">
      <h1>Metrics</h1>
      <div id="ym-body">
        <p class="ym-empty">Loading…</p>
      </div>
    </main>
  `;
}

function gateMarkup(message) {
  return `
    <div class="ym-gate">
      <p class="ym-note">${esc(message)}</p>
      <label for="ym-token" class="ym-tile-label">Metrics token</label>
      <input id="ym-token" type="password" autocomplete="off" spellcheck="false" />
      <button class="btn primary" data-metrics-unlock type="button">Show dashboard</button>
    </div>
  `;
}

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function writeToken(value) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/*
  Crosshair + tooltip for the line charts. Attached after render because the
  markup is built as a string; the payload rides on a data attribute so the
  handler needs no closure over the render scope.
*/
function wireLineCharts(root) {
  root.querySelectorAll('.ym-chart[data-line]').forEach((host) => {
    let payload = null;
    try {
      payload = JSON.parse(host.dataset.line);
    } catch {
      return;
    }

    const svg = host.querySelector('svg');
    const cross = host.querySelector('.ym-cross');
    const tip = host.querySelector('.ym-tip');
    const padL = Number(host.dataset.padL);
    const padR = Number(host.dataset.padR);
    const vbW = Number(host.dataset.w);
    const count = payload.days.length;

    const move = (event) => {
      const rect = host.getBoundingClientRect();
      const scale = rect.width / vbW;
      const innerLeft = padL * scale;
      const innerW = (vbW - padL - padR) * scale;
      const ratio = (event.clientX - rect.left - innerLeft) / innerW;
      const i = Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
      const xPx = innerLeft + (count === 1 ? innerW / 2 : (i / (count - 1)) * innerW);

      cross.setAttribute('x1', String(xPx / scale));
      cross.setAttribute('x2', String(xPx / scale));
      cross.setAttribute('opacity', '1');

      tip.innerHTML = [
        `<strong>${esc(payload.days[i])}</strong>`,
        ...payload.series.map((s) => `${esc(s.label)}: ${fmt(s.values[i])}`),
      ].join('<br>');
      tip.style.left = `${xPx}px`;
      tip.style.top = `${Math.max(28, rect.height * 0.28)}px`;
      tip.classList.add('on');
    };

    const leave = () => {
      cross.setAttribute('opacity', '0');
      tip.classList.remove('on');
    };

    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', leave);
    svg.addEventListener('touchmove', (e) => {
      if (e.touches[0]) move(e.touches[0]);
    }, { passive: true });
    svg.addEventListener('touchend', leave);
  });
}

async function loadDashboard(body, token) {
  body.innerHTML = '<p class="ym-empty">Loading…</p>';

  let res = null;
  try {
    res = await fetch(SUMMARY_URL, {
      headers: { 'x-yanta-metrics-token': token },
      credentials: 'omit',
    });
  } catch {
    body.innerHTML = gateMarkup('Could not reach the metrics API. Check the connection and try again.');
    wireGate(body);
    return;
  }

  if (res.status === 401) {
    writeToken('');
    body.innerHTML = gateMarkup('That token was not accepted.');
    wireGate(body);
    return;
  }

  if (!res.ok) {
    body.innerHTML = gateMarkup(`The metrics API answered HTTP ${res.status}.`);
    wireGate(body);
    return;
  }

  const data = await res.json();
  writeToken(token);
  body.innerHTML = dashboard(data);
  wireLineCharts(body);

  body.querySelector('[data-metrics-forget]')?.addEventListener('click', () => {
    writeToken('');
    body.innerHTML = gateMarkup('Token forgotten.');
    wireGate(body);
  });
}

function wireGate(body) {
  const input = body.querySelector('#ym-token');
  const submit = () => {
    const token = String(input?.value || '').trim();
    if (token) loadDashboard(body, token);
  };

  body.querySelector('[data-metrics-unlock]')?.addEventListener('click', submit);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  input?.focus();
}

export function wireMetricsPage() {
  const body = document.getElementById('ym-body');
  if (!body) return;

  const stored = readToken();

  if (stored) {
    loadDashboard(body, stored);
    return;
  }

  body.innerHTML = gateMarkup('This dashboard is private. Paste the metrics token to continue.');
  wireGate(body);
}
