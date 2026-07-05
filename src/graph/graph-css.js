// ============================================================
// YANTA — Graph runtime CSS.
//
// One injection point for every graph-related surface:
// canvas chrome, controls panel, note preview popover, context
// menus, appearance picker and scope picker.
//
// Kept in its own module so graph.js and graph-appearance.js can
// both depend on it without a cycle.
// ============================================================

let injected = false;

export function injectGraphCss() {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'yanta-graph-runtime-css';
  style.textContent = `
    /* ---------- Pane mode ---------- */
    .yanta-graph-side-pane .yanta-side-pane-body {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      padding: 0 !important;
      overflow: hidden !important;
    }
    .yanta-graph-side-pane .graph-canvas-wrap {
      position: relative;
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .yanta-graph-side-pane .graph-canvas {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
    }
    .graph-canvas { cursor: grab; }
    .graph-canvas.dragging { cursor: grabbing; }
    .graph-head .btn.active {
      color: var(--accent);
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }

    /* ---------- Stats badge ---------- */
    .yanta-graph-stats {
      position: absolute;
      left: 14px;
      bottom: 14px;
      z-index: 4;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--bg-elev) 78%, transparent);
      backdrop-filter: blur(10px) saturate(1.2);
      -webkit-backdrop-filter: blur(10px) saturate(1.2);
      border: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 11px;
      pointer-events: none;
      white-space: nowrap;
    }
    .yanta-graph-stats strong {
      color: var(--text);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    /* ---------- Controls panel ---------- */
    .yanta-graph-controls {
      position: absolute;
      right: 14px;
      top: 14px;
      z-index: 5;
      width: 300px;
      background: color-mix(in srgb, var(--bg-elev) 90%, transparent);
      backdrop-filter: blur(16px) saturate(1.3);
      -webkit-backdrop-filter: blur(16px) saturate(1.3);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow:
        0 1px 0 color-mix(in srgb, var(--text) 5%, transparent) inset,
        0 16px 44px rgba(0, 0, 0, 0.32);
      overflow: hidden;
      font-size: 12px;
      transition: width 0.18s ease;
    }
    .yanta-graph-controls.collapsed { width: 44px; }
    .yanta-graph-controls-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 11px;
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid var(--border);
    }
    .yanta-graph-controls.collapsed .yanta-graph-controls-head {
      justify-content: center;
      border-bottom: 0;
    }
    .yanta-graph-controls-head .gc-title {
      flex: 1;
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .yanta-graph-controls.collapsed .gc-title,
    .yanta-graph-controls.collapsed .yanta-graph-controls-body { display: none; }
    .yanta-graph-controls-head .gc-chev {
      color: var(--text-faint);
      display: inline-flex;
    }
    .yanta-graph-controls-body {
      padding: 10px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-height: min(78vh, 680px);
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }
    .yanta-graph-controls .gc-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .yanta-graph-controls .gc-group-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 10px;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--text-faint);
      font-weight: 700;
      padding: 0 2px;
    }
    .yanta-graph-controls .gc-group-title button {
      all: unset;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      color: var(--text-faint);
      font-size: 10px;
      letter-spacing: 0;
      text-transform: none;
      border-radius: 5px;
      padding: 2px 6px;
    }
    .yanta-graph-controls .gc-group-title button:hover {
      color: var(--text);
      background: var(--bg-elev-2);
    }

    /* Toggle rows */
    .yanta-graph-controls .gc-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 9px;
      border-radius: 9px;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      cursor: pointer;
      user-select: none;
      transition: border-color 0.12s ease;
    }
    .yanta-graph-controls .gc-toggle:hover { border-color: var(--border-strong); }
    .yanta-graph-controls .gc-toggle:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .yanta-graph-controls .gc-toggle .gc-label {
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--text);
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .yanta-graph-controls .gc-toggle .gc-label svg { color: var(--text-dim); }
    .yanta-graph-controls .gc-toggle.on .gc-label svg { color: var(--accent); }
    .yanta-graph-controls .gc-switch {
      position: relative;
      width: 30px;
      height: 17px;
      background: var(--bg-elev-3);
      border-radius: 999px;
      border: 1px solid var(--border);
      flex: 0 0 auto;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .yanta-graph-controls .gc-switch::after {
      content: '';
      position: absolute;
      top: 1px;
      left: 1px;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: var(--text-dim);
      transition: transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1), background 0.15s ease;
    }
    .yanta-graph-controls .gc-toggle.on .gc-switch {
      background: color-mix(in srgb, var(--accent) 30%, transparent);
      border-color: var(--accent);
    }
    .yanta-graph-controls .gc-toggle.on .gc-switch::after {
      transform: translateX(13px);
      background: var(--accent);
    }

    /* Action buttons */
    .yanta-graph-controls .gc-actions-row {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      gap: 6px;
    }
    .yanta-graph-controls .gc-action {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 6px 9px;
      border-radius: 9px;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      cursor: pointer;
      text-align: center;
      font-size: 12px;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .yanta-graph-controls .gc-action:hover {
      background: var(--bg-elev-2);
      border-color: var(--border-strong);
    }
    .yanta-graph-controls .gc-action svg { color: var(--text-dim); }

    .yanta-graph-controls input[type="search"] {
      width: 100%;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 9px;
      padding: 7px 9px;
      font-size: 12px;
      outline: none;
      transition: border-color 0.12s ease, box-shadow 0.12s ease;
    }
    .yanta-graph-controls input[type="search"]:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .yanta-graph-controls .gc-hint {
      color: var(--text-faint);
      font-size: 10px;
      line-height: 1.45;
      padding: 0 2px;
    }

    /* Field label above a control */
    .yanta-graph-controls .gc-field-label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-dim);
      font-size: 11px;
      padding: 2px 2px 0;
    }

    /* Segmented control */
    .yanta-graph-controls .gc-seg {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      gap: 2px;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 2px;
    }
    .yanta-graph-controls .gc-seg button {
      all: unset;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 5px 2px;
      border-radius: 7px;
      font-size: 11px;
      color: var(--text-dim);
      cursor: pointer;
      text-align: center;
      transition: color 0.12s ease, background 0.12s ease;
      white-space: nowrap;
      overflow: hidden;
    }
    .yanta-graph-controls .gc-seg button:hover { color: var(--text); }
    .yanta-graph-controls .gc-seg button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .yanta-graph-controls .gc-seg button.on {
      background: var(--bg-elev);
      color: var(--accent);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
      font-weight: 600;
    }

    /* Slider rows */
    .yanta-graph-controls .gc-slider-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px 9px 8px;
      border-radius: 9px;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      transition: border-color 0.12s ease;
    }
    .yanta-graph-controls .gc-slider-row:hover { border-color: var(--border-strong); }
    .yanta-graph-controls .gc-slider-row .gcs-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .yanta-graph-controls .gc-slider-row .gcs-label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text);
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .yanta-graph-controls .gc-slider-row .gcs-label svg { color: var(--text-dim); }
    .yanta-graph-controls .gc-slider-row .gcs-value {
      color: var(--text-dim);
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
      font-size: 11px;
      flex: 0 0 auto;
      font-variant-numeric: tabular-nums;
    }
    .yanta-graph-controls .gc-slider-row input[type="range"] {
      width: 100%;
      accent-color: var(--accent);
      cursor: pointer;
      margin: 2px 0 0;
      height: 16px;
    }

    /* ---------- Note preview popover ---------- */
    .yanta-graph-note-preview {
      position: fixed;
      z-index: 170;
      width: min(660px, calc(100vw - 24px));
      max-height: min(76vh, 780px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow:
        0 1px 0 color-mix(in srgb, var(--text) 5%, transparent) inset,
        0 22px 60px rgba(0, 0, 0, 0.45);
      animation: fade-in 0.12s ease;
    }
    .yanta-graph-note-preview[hidden] { display: none !important; }
    .yanta-graph-note-preview-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-elev-2);
      flex: 0 0 auto;
    }
    .yanta-graph-note-preview-headings { min-width: 0; flex: 1; }
    .yanta-graph-note-preview-title {
      min-width: 0;
      font-weight: 700;
      color: var(--text);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .yanta-graph-note-preview-meta {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--text-faint);
      margin-top: 1px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .yanta-graph-note-preview-meta .gnp-dot { opacity: 0.5; }
    .yanta-graph-note-preview-icon {
      width: 32px;
      height: 32px;
      flex: 0 0 auto;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--note-icon-color, var(--accent));
      background: color-mix(in srgb, var(--note-icon-color, var(--accent)) 14%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--note-icon-color, var(--accent)) 35%, var(--border)) inset;
      cursor: pointer;
      transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
    }
    .yanta-graph-note-preview-icon:hover {
      transform: scale(1.08);
      background: color-mix(in srgb, var(--note-icon-color, var(--accent)) 22%, transparent);
      box-shadow: 0 0 0 1.5px var(--note-icon-color, var(--accent)) inset;
    }
    .yanta-graph-note-preview-icon:focus-visible {
      outline: 2px solid var(--note-icon-color, var(--accent));
      outline-offset: 2px;
    }
    .yanta-graph-note-preview-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }
    .yanta-graph-note-preview-body {
      padding: 18px 20px 26px;
      overflow: auto;
      overscroll-behavior: contain;
      background: var(--bg);
      flex: 1 1 auto;
      min-height: 0;
      scrollbar-width: thin;
    }
    .yanta-graph-note-preview-body .preview {
      max-width: none;
      margin: 0;
      font-size: 14px;
      line-height: 1.65;
    }
    .yanta-graph-note-preview-body .backlinks,
    .yanta-graph-note-preview-body .pv-outline { display: none !important; }
    .yanta-graph-note-preview-body a.wiki-link { cursor: pointer; }
    .yanta-graph-note-preview-body .task { cursor: pointer; }

    /* Drawings render as static thumbnails inside the popover */
    .yanta-graph-draw-thumb {
      margin: 8px 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--bg-elev);
      cursor: zoom-in;
      transition: border-color 0.12s ease;
    }
    .yanta-graph-draw-thumb:hover { border-color: var(--border-strong); }
    .yanta-graph-draw-canvas {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 72px;
      max-height: 300px;
      overflow: hidden;
      padding: 8px;
      background: var(--bg-elev);
    }
    .yanta-graph-draw-canvas svg { display: block; }
    .yanta-graph-draw-spinner svg { animation: yanta-graph-spin 0.9s linear infinite; color: var(--text-faint); }
    @keyframes yanta-graph-spin { to { transform: rotate(360deg); } }
    .yanta-graph-draw-empty {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-faint);
      font-size: 12px;
      font-style: italic;
    }
    .yanta-graph-draw-caption {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      font-size: 11px;
      color: var(--text-dim);
      border-top: 1px solid var(--border);
    }
    .yanta-graph-empty-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 26px;
      color: var(--text-faint);
      text-align: center;
      font-style: italic;
      border: 1px dashed var(--border);
      border-radius: 10px;
      background: var(--bg-elev);
    }

    /* ---------- Context menu ---------- */
    .yanta-graph-context-menu {
      position: fixed;
      z-index: 180;
      min-width: 236px;
      padding: 5px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--bg-elev-3) 94%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      box-shadow:
        0 1px 0 color-mix(in srgb, var(--text) 5%, transparent) inset,
        0 16px 40px rgba(0, 0, 0, 0.4);
      animation: fade-in 0.1s ease;
    }
    .yanta-graph-context-menu button {
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 7px 10px;
      border-radius: 8px;
      cursor: pointer;
      text-align: left;
      font-size: 13px;
    }
    .yanta-graph-context-menu button:hover,
    .yanta-graph-context-menu button:focus-visible {
      background: var(--bg-elev-2);
      outline: none;
    }
    .yanta-graph-context-menu button.danger { color: var(--red); }
    .yanta-graph-context-menu button.danger:hover {
      background: color-mix(in srgb, var(--red) 12%, transparent);
    }
    .yanta-graph-context-menu button svg {
      flex: 0 0 auto;
      color: var(--text-dim);
    }
    .yanta-graph-context-menu button.danger svg { color: var(--red); }
    .yanta-graph-context-menu button .ctx-kbd {
      margin-left: auto;
      color: var(--text-faint);
      font-size: 10px;
      font-family: var(--font-mono, ui-monospace, monospace);
    }
    .yanta-graph-context-menu hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 4px 6px;
    }
    .yanta-graph-context-menu .ctx-meta {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 10px 8px;
      color: var(--text-faint);
      font-size: 11px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 4px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    /* ---------- Pane host / overlay ---------- */
    .yanta-graph-pane-host {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      background: var(--bg);
    }
    .yanta-graph-pane-host .graph-head {
      flex: 0 0 auto;
      min-height: 47px;
    }
    .yanta-graph-pane-host .graph-canvas-wrap {
      flex: 1 1 auto;
      min-height: 0;
    }
    .pane-preview.yanta-graph-pane-active {
      position: relative;
      padding: 0 !important;
      overflow: hidden;
    }

    /* ---------- Scope picker ---------- */
    .yanta-scope-modal {
      position: fixed;
      inset: 0;
      z-index: 200;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .yanta-scope-card {
      width: min(420px, 100%);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }
    .yanta-scope-head {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .yanta-scope-head h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }
    .yanta-scope-body {
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .yanta-scope-body .yanta-scope-opt {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 9px;
      border: 1px solid var(--border);
      background: var(--bg-elev-2);
      color: var(--text);
      cursor: pointer;
      text-align: left;
    }
    .yanta-scope-body .yanta-scope-opt[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .yanta-scope-body .yanta-scope-opt:hover:not([disabled]) {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 8%, transparent);
    }
    .yanta-scope-body .yanta-scope-opt .yanta-scope-meta {
      margin-left: auto;
      color: var(--text-faint);
      font-size: 11px;
    }
    .yanta-scope-body .yanta-scope-opt .yanta-scope-icon {
      display: inline-flex;
      color: var(--accent);
    }

    /* ---------- Appearance picker ---------- */
    .yanta-appearance-modal {
      position: fixed;
      inset: 0;
      z-index: 200;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .yanta-appearance-card {
      width: min(520px, 100%);
      max-height: min(82vh, 720px);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .yanta-appearance-head {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .yanta-appearance-head h3 {
      margin: 0;
      flex: 1;
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .yanta-appearance-body {
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow: auto;
      min-height: 0;
    }
    .yanta-appearance-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .yanta-appearance-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .yanta-appearance-section-head .yap-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-faint);
      font-weight: 600;
    }
    .yanta-appearance-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--text-dim);
      cursor: pointer;
      user-select: none;
    }
    .yanta-appearance-toggle input { accent-color: var(--accent); }
    .yanta-appearance-section.disabled .yap-content {
      opacity: 0.35;
      pointer-events: none;
    }
    .yanta-appearance-preview {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      box-shadow: 0 0 0 1.5px var(--yap-color, var(--accent)) inset;
      background: color-mix(in srgb, var(--yap-color, var(--accent)) 15%, transparent);
      color: var(--yap-color, var(--accent));
    }
    .yanta-appearance-search {
      width: 100%;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 7px;
      padding: 6px 8px;
      font-size: 12px;
      outline: none;
    }
    .yanta-appearance-search:focus { border-color: var(--accent); }
    .yanta-appearance-icon-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
      gap: 4px;
      max-height: 220px;
      overflow: auto;
      padding: 4px;
      background: var(--bg);
      border-radius: 7px;
      border: 1px solid var(--border);
    }
    .yanta-appearance-icon-grid button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 1 / 1;
      background: var(--bg-elev-2);
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--text-dim);
      cursor: pointer;
      padding: 0;
      transition: border-color 0.1s ease, background 0.1s ease, color 0.1s ease;
    }
    .yanta-appearance-icon-grid button:hover {
      background: var(--bg-elev-3);
      color: var(--text);
    }
    .yanta-appearance-icon-grid button.selected {
      background: color-mix(in srgb, var(--yap-color, var(--accent)) 18%, transparent);
      border-color: var(--yap-color, var(--accent));
      color: var(--yap-color, var(--accent));
    }
    .yanta-appearance-colors {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .yanta-appearance-swatch {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      border: 2px solid transparent;
      box-shadow: 0 0 0 1px var(--border) inset;
      cursor: pointer;
      padding: 0;
      transition: transform 0.12s ease, border-color 0.12s ease;
    }
    .yanta-appearance-swatch:hover { transform: scale(1.1); }
    .yanta-appearance-swatch.selected {
      border-color: var(--text);
      transform: scale(1.12);
    }
    .yanta-appearance-color-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .yanta-appearance-color-row input[type="color"] {
      width: 28px;
      height: 28px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-elev-2);
      cursor: pointer;
    }
    .yanta-appearance-color-row input[type="text"] {
      flex: 0 0 100px;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
      outline: none;
    }
    .yanta-appearance-color-row input[type="text"]:focus { border-color: var(--accent); }
    .yanta-appearance-reset {
      background: transparent;
      border: 1px dashed var(--border);
      color: var(--text-dim);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
    }
    .yanta-appearance-reset:hover {
      border-color: var(--border-strong);
      color: var(--text);
    }
    .yanta-appearance-foot {
      padding: 10px 14px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg-elev-2);
    }
    .yanta-appearance-foot .yap-spacer { flex: 1; }
    .yanta-appearance-foot .yap-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 7px;
      border: 1px solid var(--border);
      background: var(--bg-elev);
      color: var(--text);
      cursor: pointer;
      font-size: 12px;
    }
    .yanta-appearance-foot .yap-btn:hover {
      background: var(--bg-elev-3);
      border-color: var(--border-strong);
    }
    .yanta-appearance-foot .yap-btn.primary {
      background: var(--accent);
      color: var(--bg);
      border-color: var(--accent);
      font-weight: 600;
    }
    .yanta-appearance-foot .yap-btn.primary:hover { filter: brightness(1.1); }
    .yanta-appearance-foot .yap-btn.secondary {
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    .yanta-appearance-foot .yap-btn.secondary:hover {
      background: color-mix(in srgb, var(--accent) 25%, transparent);
    }
    .yanta-appearance-foot .yap-btn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .yanta-appearance-foot .yap-btn.ghost {
      background: transparent;
      border-color: transparent;
      color: var(--text-dim);
    }
    .yanta-appearance-foot .yap-btn.ghost:hover {
      color: var(--text);
      background: var(--bg-elev-3);
    }

    @media (prefers-reduced-motion: reduce) {
      .yanta-graph-note-preview,
      .yanta-graph-context-menu { animation: none; }
      .yanta-graph-controls,
      .yanta-graph-controls .gc-switch,
      .yanta-graph-controls .gc-switch::after { transition: none; }
      .yanta-graph-draw-spinner svg { animation: none; }
    }
  `;
  document.head.append(style);
}