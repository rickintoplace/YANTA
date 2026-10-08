// ============================================================
// YANTA AI — styles for chat widgets (ui-widgets.js)
//
// Layout follows the widget's own width (container queries), not the
// window: the same answer is shown in a phone-sized floating panel and
// in a wide side pane. Motion is short and stops under
// prefers-reduced-motion.
// ============================================================

export const WIDGET_CSS = `
.yanta-ai-msg.assistant:has(.yw) { width: 100%; }

.yw {
  --yw-radius: 16px;
  --yw-tint: color-mix(in srgb, var(--accent) 7%, transparent);
  --yw-tint-strong: color-mix(in srgb, var(--accent) 15%, transparent);
  --yw-line: color-mix(in srgb, var(--border) 70%, transparent);
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 12px 0 4px;
  padding: 14px 16px 16px;
  border: 1px solid var(--yw-line);
  border-radius: var(--yw-radius);
  background:
    radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 60%),
    var(--bg-elev-2, var(--bg));
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%), 0 8px 24px -16px rgb(0 0 0 / 18%);
  max-width: 100%;
  min-width: 0;
  animation: yw-in .32s cubic-bezier(.2, .8, .2, 1) both;
}

@keyframes yw-in { from { opacity: 0; transform: translateY(6px) scale(.99); } }

.yw-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.yw-icon {
  flex: 0 0 auto;
  width: 30px; height: 30px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--accent); background: var(--yw-tint-strong);
}
.yw-titles { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.yw-title { font-size: 14px; line-height: 1.25; overflow-wrap: anywhere; }
.yw-sub { font-size: 12px; color: var(--text-faint); line-height: 1.35; }
.yw-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.yw-body { min-width: 0; }

.yw-btn, .yw-icon-btn, .yw-chip {
  font: inherit;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--yw-line); border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 60%, transparent);
  color: var(--text-dim);
  font-size: 12px; line-height: 1;
  padding: 7px 11px;
  cursor: pointer;
  transition: background .15s, color .15s, border-color .15s, transform .15s, box-shadow .15s;
  white-space: nowrap;
}
.yw-btn:hover, .yw-icon-btn:hover, .yw-chip:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--yw-tint);
}
.yw-btn:active, .yw-icon-btn:active, .yw-chip:active { transform: scale(.97); }
.yw-btn:focus-visible, .yw-icon-btn:focus-visible, .yw-chip:focus-visible,
.yw input:focus-visible, .yw select:focus-visible, .yw th:focus-visible, .yw-choice:focus-visible, .yw-card:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  outline-offset: 2px;
}
.yw-icon-btn { padding: 6px; width: 30px; height: 30px; }
.yw-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast, #fff); font-weight: 600; padding: 9px 16px; }
.yw-btn-primary:hover { background: color-mix(in srgb, var(--accent) 88%, #000); color: var(--accent-contrast, #fff); }
.yw-btn-soft { background: var(--yw-tint); border-color: transparent; color: var(--accent); }

/* Narrow: header buttons show their icon only. */
@container (max-width: 420px) {
  .yw-head .yw-btn span { display: none; }
  .yw-head .yw-btn { padding: 7px; }
}

/* ------------------------------------------------------- pending, error */
.yw--pending { gap: 10px; }
.yw-skel {
  display: block; height: 12px; border-radius: 6px; width: 100%;
  background: linear-gradient(90deg, var(--yw-tint) 0%, var(--yw-tint-strong) 50%, var(--yw-tint) 100%);
  background-size: 200% 100%;
  animation: yw-shimmer 1.2s linear infinite;
}
@keyframes yw-shimmer { to { background-position: -200% 0; } }
.yw--error summary { cursor: pointer; font-size: 12px; color: var(--text-faint); display: flex; gap: 6px; align-items: center; }
.yw--error pre { font-size: 11px; white-space: pre-wrap; max-height: 200px; overflow: auto; margin: 8px 0 0; }

/* ---------------------------------------------------------- calculator */
.yw-calc { display: grid; gap: 14px; }
.yw-inputs { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px 16px; }
@container (min-width: 620px) {
  .yw-calc { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: start; }
  .yw-inputs { grid-template-columns: 1fr; }
  .yw-calc-chart { grid-column: 1 / -1; }
  .yw-outputs { grid-template-columns: 1fr; }
}
.yw-input { display: grid; grid-template-rows: auto 40px; gap: 6px; font-size: 12px; color: var(--text-dim); min-width: 0; align-items: center; }
.yw-input-toggle { grid-template-rows: none; min-height: 40px; }
.yw-input-label { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.yw-input-toggle { grid-template-columns: 1fr auto; align-items: center; align-self: end; }
.yw-field {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid var(--yw-line); border-radius: 10px;
  background: var(--bg); padding: 0 10px 0 0;
  transition: border-color .15s, box-shadow .15s;
}
.yw-field:focus-within { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }
.yw-field { height: 40px; box-sizing: border-box; }
.yw-field input {
  flex: 1; min-width: 0; width: 100%; border: 0; background: transparent; color: var(--text);
  padding: 8px 10px; font: inherit; font-size: 14px; font-variant-numeric: tabular-nums; outline: none;
}
.yw-unit { color: var(--text-faint); font-size: 12px; }
.yw select {
  width: 100%; min-width: 0; max-width: 100%; height: 40px; box-sizing: border-box;
  border: 1px solid var(--yw-line); border-radius: 10px;
  background: var(--bg); color: var(--text);
  padding: 8px 10px; font: inherit; font-size: 13.5px;
}
.yw-slider-value { font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; font-size: 13px; }

.yw-range {
  --fill: 50%;
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 22px; background: transparent; margin: 0; cursor: pointer;
}
.yw-range::-webkit-slider-runnable-track {
  height: 6px; border-radius: 999px;
  background: linear-gradient(to right, var(--accent) var(--fill), var(--yw-tint-strong) var(--fill));
}
.yw-range::-moz-range-track { height: 6px; border-radius: 999px; background: var(--yw-tint-strong); }
.yw-range::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--accent); }
.yw-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 18px; height: 18px; margin-top: -6px; border-radius: 50%;
  background: var(--bg); border: 2px solid var(--accent);
  box-shadow: 0 1px 3px rgb(0 0 0 / 20%);
  transition: transform .12s, box-shadow .12s;
}
.yw-range::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--bg); border: 2px solid var(--accent); box-shadow: 0 1px 3px rgb(0 0 0 / 20%);
}
.yw-range:hover::-webkit-slider-thumb, .yw-range:active::-webkit-slider-thumb {
  transform: scale(1.15); box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent);
}

.yw-switch {
  -webkit-appearance: none; appearance: none;
  width: 38px; height: 22px; border-radius: 999px; margin: 0;
  background: var(--yw-tint-strong); position: relative; cursor: pointer;
  transition: background .2s;
}
.yw-switch::after {
  content: ""; position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px; border-radius: 50%; background: var(--bg);
  box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
  transition: transform .2s cubic-bezier(.2, .8, .2, 1);
}
.yw-switch:checked { background: var(--accent); }
.yw-switch:checked::after { transform: translateX(16px); }

.yw-outputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; align-content: start; }
.yw-output {
  border-radius: 12px; padding: 10px 12px;
  background: var(--yw-tint);
  display: grid; gap: 3px; min-width: 0;
  transition: background .2s;
}
.yw-output.is-primary {
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, transparent), color-mix(in srgb, var(--accent) 10%, transparent));
}
.yw-output-label { font-size: 11.5px; color: var(--text-faint); }
.yw-output-value { font-size: 18px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; overflow-wrap: anywhere; }
.yw-output.is-primary .yw-output-value { font-size: 24px; }

/* --------------------------------------------------------------- charts */
.ywc { display: grid; gap: 8px; min-width: 0; }
.ywc-box { position: relative; width: 100%; min-width: 0; }
.ywc-svg { width: 100%; height: auto; display: block; overflow: visible; touch-action: pan-y; }
.ywc-grid { stroke: var(--yw-line); stroke-width: 1; stroke-dasharray: 2 4; }
.ywc-zero { stroke: color-mix(in srgb, var(--text-faint) 60%, transparent); stroke-width: 1; }
.ywc-axis { fill: var(--text-faint); font-size: 11px; font-family: inherit; }
.ywc-legend { fill: var(--text-dim); font-size: 12.5px; font-family: inherit; }
.ywc-legend-row { cursor: default; }

.ywc-bar {
  transform-box: fill-box; transform-origin: 50% 100%;
  transition: opacity .15s, filter .15s;
  animation: ywc-grow .55s cubic-bezier(.2, .8, .2, 1) both;
}
.ywc-bar.is-neg { transform-origin: 50% 0%; }
@keyframes ywc-grow { from { transform: scaleY(0); } }
.ywc-svg.is-hovering .ywc-bar:not(.is-hot) { opacity: .35; }
.ywc-bar.is-hot { filter: brightness(1.08) saturate(1.1); }

.ywc-line {
  stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round;
  stroke-dasharray: 3000; stroke-dashoffset: 0;
  animation: ywc-draw 1s cubic-bezier(.4, 0, .2, 1) both;
}
@keyframes ywc-draw { from { stroke-dashoffset: 3000; } }
.ywc-area { opacity: .1; animation: yw-fade .8s ease both; }
@keyframes yw-fade { from { opacity: 0; } }
.ywc-dot { transition: r .15s; stroke: var(--bg-elev-2, var(--bg)); stroke-width: 2; }
.ywc-dot.is-hot { r: 5.5; }
.ywc-guide { stroke: var(--text-faint); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0; transition: opacity .12s; }
.ywc-guide.is-on { opacity: .8; }
.ywc-svg[data-focus="0"] [data-series]:not([data-series="0"]),
.ywc-svg[data-focus="1"] [data-series]:not([data-series="1"]),
.ywc-svg[data-focus="2"] [data-series]:not([data-series="2"]),
.ywc-svg[data-focus="3"] [data-series]:not([data-series="3"]),
.ywc-svg[data-focus="4"] [data-series]:not([data-series="4"]),
.ywc-svg[data-focus="5"] [data-series]:not([data-series="5"]) { opacity: .15; }

.ywc-seg {
  transform-box: view-box;
  transition: transform .2s cubic-bezier(.2, .8, .2, 1), opacity .15s;
  animation: yw-pop .5s cubic-bezier(.2, .8, .2, 1) both;
  cursor: pointer;
}
@keyframes yw-pop { from { opacity: 0; transform: scale(.85); } }
.ywc-seg.is-hot { transform: translate(var(--dx), var(--dy)); }
.ywc-svg.is-hovering .ywc-seg:not(.is-hot) { opacity: .45; }
.ywc-center { fill: var(--text); font-size: 20px; font-weight: 650; font-family: inherit; }
.ywc-center-sub { fill: var(--text-faint); font-size: 11.5px; font-family: inherit; }

.ywc-svg.no-intro .ywc-bar, .ywc-svg.no-intro .ywc-line, .ywc-svg.no-intro .ywc-area, .ywc-svg.no-intro .ywc-seg { animation: none; }

.ywc-tip {
  position: absolute; z-index: 2; pointer-events: none;
  min-width: 120px; max-width: 240px;
  padding: 8px 10px; border-radius: 10px;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid var(--yw-line);
  box-shadow: 0 8px 24px -8px rgb(0 0 0 / 25%);
  font-size: 12px; display: grid; gap: 4px;
  animation: yw-fade .12s ease;
}
.ywc-tip strong { font-size: 12px; color: var(--text); }
.ywc-tip span { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.ywc-tip i { width: 8px; height: 8px; border-radius: 3px; flex: 0 0 auto; }
.ywc-tip b { margin-left: auto; padding-left: 10px; color: var(--text); font-variant-numeric: tabular-nums; }
.ywc-legend-html { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-dim); }
.ywc-legend-html span { display: inline-flex; align-items: center; gap: 6px; cursor: default; }
.ywc-legend-html i { width: 10px; height: 10px; border-radius: 3px; }

/* ---------------------------------------------------------------- table */
.yw-table-wrap { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
.yw-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.yw-table th {
  text-align: left; font-weight: 600; font-size: 11.5px; color: var(--text-faint);
  text-transform: uppercase; letter-spacing: .03em;
  padding: 8px 12px 8px 0; border-bottom: 1px solid var(--yw-line);
  cursor: pointer; white-space: nowrap; user-select: none;
}
.yw-table th svg { margin-left: 4px; opacity: 0; vertical-align: -1px; transition: opacity .15s; }
.yw-table th:hover svg, .yw-table th.is-sorted svg { opacity: 1; }
.yw-table th.is-sorted { color: var(--accent); }
.yw-table td { padding: 9px 12px 9px 0; border-bottom: 1px solid var(--yw-line); transition: background .15s; }
.yw-table tbody tr:last-child td { border-bottom: 0; }
.yw-table td.is-num { font-variant-numeric: tabular-nums; }
.yw-table tbody tr:hover td { background: var(--yw-tint); }
.yw-table tr.is-best td { background: color-mix(in srgb, var(--accent) 11%, transparent); font-weight: 600; }
.yw-table tr td:first-child { padding-left: 8px; border-radius: 8px 0 0 8px; }
.yw-table tr th:first-child { padding-left: 8px; }
.yw-table tr td:last-child { border-radius: 0 8px 8px 0; }
.yw-badge {
  display: inline-flex; align-items: center; gap: 3px; margin-left: 6px;
  font-size: 10.5px; font-weight: 600; color: var(--accent);
  background: var(--yw-tint-strong); padding: 2px 7px; border-radius: 999px; vertical-align: 1px;
}

/* ------------------------------------------------- progress & checklist */
.yw-bar { position: relative; height: 8px; border-radius: 999px; background: var(--yw-tint-strong); overflow: hidden; flex: 1; }
.yw-bar.is-thin { height: 4px; }
.yw-bar span {
  position: absolute; inset: 0 auto 0 0; width: 0; border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 75%, #fff), var(--accent));
  transition: width .6s cubic-bezier(.2, .8, .2, 1);
}
.yw-bar.is-over span { background: linear-gradient(90deg, var(--accent), var(--warning, #d29922)); }
.yw-progress-row { display: flex; align-items: center; gap: 10px; }
.yw-progress-count { font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }
.yw-checklist.is-complete .yw-progress-count { color: var(--success, #3fb950); font-weight: 600; }

.yw-checks { display: grid; gap: 2px; margin-top: 8px; }
.yw-check {
  display: flex; gap: 10px; align-items: flex-start;
  font-size: 13.5px; cursor: pointer; padding: 7px 8px; margin: 0 -8px; border-radius: 10px;
  transition: background .15s;
}
.yw-check:hover { background: var(--yw-tint); }
.yw-checkbox {
  -webkit-appearance: none; appearance: none; flex: 0 0 auto;
  width: 18px; height: 18px; margin: 1px 0 0; border-radius: 6px;
  border: 1.5px solid color-mix(in srgb, var(--text-faint) 70%, transparent);
  background: var(--bg) center / 12px no-repeat;
  cursor: pointer; transition: background-color .15s, border-color .15s, transform .15s;
}
.yw-checkbox:checked {
  background-color: var(--accent); border-color: var(--accent);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E");
  animation: yw-tick .25s cubic-bezier(.2, .8, .2, 1);
}
@keyframes yw-tick { 50% { transform: scale(1.18); } }
.yw-check-text { transition: color .2s; overflow-wrap: anywhere; }
.yw-check.is-done .yw-check-text { color: var(--text-faint); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--text-faint) 60%, transparent); }

.yw-progress-list { display: grid; gap: 14px; }
.yw-progress-top { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; margin-bottom: 6px; flex-wrap: wrap; }
.yw-progress-num { color: var(--text-faint); font-size: 12px; font-variant-numeric: tabular-nums; }
.yw-progress-num b { color: var(--text); font-weight: 600; }
.yw-progress-item.is-full .yw-progress-num b { color: var(--success, #3fb950); }

/* --------------------------------------------------------------- events */
.yw-events { display: grid; gap: 8px; }
.yw-event {
  display: flex; align-items: center; gap: 12px; padding: 8px; margin: 0 -8px; border-radius: 12px;
  transition: background .15s;
}
.yw-event:hover { background: var(--yw-tint); }
.yw-event-date {
  flex: 0 0 auto; width: 46px; padding: 4px 0;
  display: grid; justify-items: center; line-height: 1.1;
  border-radius: 10px; background: var(--yw-tint-strong); color: var(--accent);
}
.yw-event-date small { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
.yw-event-date strong { font-size: 18px; }
.yw-event-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
.yw-event-main strong { font-size: 13.5px; overflow-wrap: anywhere; }
.yw-event-main small { font-size: 12px; color: var(--text-faint); }
.yw-added { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--success, #3fb950); white-space: nowrap; animation: yw-fade .2s; }
@container (max-width: 360px) { .yw-event .yw-btn span { display: none; } }

/* ---------------------------------------------------------------- stats */
.yw-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.yw-stat {
  border-radius: 12px; padding: 12px 14px;
  background: var(--yw-tint);
  display: grid; gap: 4px; min-width: 0;
  transition: transform .18s, box-shadow .18s, background .18s;
}
.yw-stat:hover { transform: translateY(-2px); background: var(--yw-tint-strong); box-shadow: 0 8px 18px -12px rgb(0 0 0 / 30%); }
.yw-stat-label { font-size: 11.5px; color: var(--text-faint); }
.yw-stat-value { font-size: 24px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.yw-stat-delta { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-dim); }
.yw-stat-delta.is-up { color: var(--success, #3fb950); }
.yw-stat-delta.is-down { color: var(--warning, #d29922); }

/* ---------------------------------------------------------------- steps */
.yw .yw-steps { list-style: none; margin: 0; padding: 0; display: grid; }
.yw .yw-steps > li { margin: 0; padding-left: 0; }
.yw-step { display: grid; grid-template-columns: 28px 1fr; gap: 12px; position: relative; padding-bottom: 14px; }
.yw-step:last-child { padding-bottom: 0; }
.yw-step:not(:last-child)::before {
  content: ""; position: absolute; left: 13px; top: 30px; bottom: 2px; width: 2px; border-radius: 2px;
  background: var(--yw-line); transition: background .3s;
}
.yw-step.is-done:not(:last-child)::before { background: var(--accent); }
.yw-step-dot {
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font: inherit; font-size: 12px; font-weight: 650;
  border: 2px solid var(--yw-line); background: var(--bg); color: var(--text-faint);
  cursor: pointer; transition: background .2s, border-color .2s, color .2s, transform .15s;
}
.yw-step-dot:hover { transform: scale(1.08); border-color: var(--accent); }
.yw-step.is-current .yw-step-dot { border-color: var(--accent); color: var(--accent); box-shadow: 0 0 0 4px var(--yw-tint-strong); }
.yw-step.is-done .yw-step-dot { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast, #fff); }
.yw-step-body { padding-top: 4px; min-width: 0; }
.yw-step-body strong { font-size: 13.5px; }
.yw-step.is-done .yw-step-body strong { color: var(--text-faint); }
.yw-step-body p { margin: 3px 0 0; font-size: 12.5px; color: var(--text-dim); line-height: 1.45; }

/* ------------------------------------------------------------ pros/cons */
.yw-proscons { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.yw-pc { border-radius: 12px; padding: 12px 14px; background: var(--yw-tint); }
.yw-pc.is-pro { background: color-mix(in srgb, var(--success, #3fb950) 9%, transparent); }
.yw-pc.is-con { background: color-mix(in srgb, var(--warning, #d29922) 10%, transparent); }
.yw-pc-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 650; margin-bottom: 6px; }
.yw-pc.is-pro .yw-pc-head { color: var(--success, #3fb950); }
.yw-pc.is-con .yw-pc-head { color: var(--warning, #d29922); }
.yw-pc-head em { margin-left: auto; font-style: normal; font-weight: 500; opacity: .7; }
.yw-pc ul { margin: 0; padding-left: 18px; display: grid; gap: 5px; font-size: 13px; }
.yw-verdict {
  grid-column: 1 / -1; display: flex; gap: 8px; align-items: flex-start;
  padding: 10px 12px; border-radius: 12px; border: 1px dashed var(--yw-line);
  font-size: 13px; color: var(--text);
}
.yw-verdict svg { color: var(--accent); flex: 0 0 auto; margin-top: 2px; }

/* -------------------------------------------------------------- choices */
.yw-question { margin: 0 0 10px; font-size: 13.5px; }
.yw-choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
.yw-choice {
  font: inherit; text-align: left; cursor: pointer; position: relative;
  display: grid; gap: 3px; padding: 11px 36px 11px 13px; border-radius: 12px;
  border: 1px solid var(--yw-line); background: var(--bg); color: var(--text);
  transition: border-color .15s, background .15s, transform .15s, opacity .2s, box-shadow .15s;
}
.yw-choice strong { font-size: 13.5px; }
.yw-choice small { font-size: 12px; color: var(--text-faint); line-height: 1.35; }
.yw-choice-go {
  position: absolute; right: 12px; top: 50%; transform: translate(-4px, -50%); opacity: 0;
  color: var(--accent); transition: transform .15s, opacity .15s;
}
.yw-choice:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: var(--yw-tint); transform: translateY(-1px); box-shadow: 0 6px 16px -12px rgb(0 0 0 / 35%); }
.yw-choice:hover .yw-choice-go { opacity: 1; transform: translate(0, -50%); }
.yw-choice.is-picked { border-color: var(--accent); background: var(--yw-tint-strong); }
.yw-choice.is-dimmed { opacity: .45; pointer-events: none; }

/* ----------------------------------------------------------- flashcards */
.yw-cards { display: grid; gap: 10px; }
.yw-card { font: inherit; border: 0; padding: 0; background: none; cursor: pointer; perspective: 1000px; color: inherit; text-align: left; }
.yw-card-inner {
  position: relative; min-height: 150px; display: grid;
  transform-style: preserve-3d; transition: transform .5s cubic-bezier(.2, .8, .2, 1);
}
.yw-card.is-flipped .yw-card-inner { transform: rotateY(180deg); }
.yw-card-face {
  grid-area: 1 / 1; backface-visibility: hidden; -webkit-backface-visibility: hidden;
  display: grid; align-content: center; gap: 8px; padding: 18px 20px; border-radius: 14px;
  border: 1px solid var(--yw-line); background: var(--bg);
  box-shadow: 0 10px 24px -18px rgb(0 0 0 / 40%);
}
.yw-card-back { transform: rotateY(180deg); background: var(--yw-tint-strong); }
.yw-card-face small { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); font-weight: 650; }
.yw-card-face p { margin: 0; font-size: 15px; line-height: 1.45; }
.yw-card-face em { font-style: normal; font-size: 11.5px; color: var(--text-faint); display: inline-flex; gap: 5px; align-items: center; }
.yw-card-nav { display: flex; align-items: center; justify-content: center; gap: 8px; }
.yw-card-count { font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; min-width: 56px; text-align: center; }

/* ---------------------------------------------------------------- timer */
.yw-timer { display: grid; justify-items: center; gap: 14px; }
.yw-timer-ring { position: relative; width: 156px; height: 156px; }
.yw-timer-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.yw-timer-track { fill: none; stroke: var(--yw-tint-strong); stroke-width: 8; }
.yw-timer-arc { fill: none; stroke: var(--accent); stroke-width: 8; stroke-linecap: round; transition: stroke-dashoffset .25s linear; }
.yw-timer.is-finished .yw-timer-arc { stroke: var(--success, #3fb950); }
.yw-timer-text { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 2px; }
.yw-timer-text strong { font-size: 30px; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.yw-timer-text small { font-size: 11.5px; color: var(--text-faint); max-width: 120px; }
.yw-timer.is-running .yw-timer-ring { animation: yw-breathe 2.4s ease-in-out infinite; }
@keyframes yw-breathe { 50% { transform: scale(1.015); } }
.yw-timer-controls, .yw-timer-presets { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }

@media (prefers-reduced-motion: reduce) {
  .yw, .yw *, .ywc-svg * { animation: none !important; transition: none !important; }
}
`;
