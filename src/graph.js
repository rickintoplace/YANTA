// ============================================================
// YANTA — Interactive graph view (canvas).
//
// Nodes = notes + optional folders.
// Edges = wikilinks (with multiplicity), folder structure, optional
// local semantic links.
//
// Features:
// - Stable, responsive physics with live rearrangement during drag.
// - Click note node → clean Markdown preview popover.
// - Double-click / preview button → open note.
// - Right-click note OR folder node → context menu.
// - Right-click empty space → create root-level note/folder.
// - Middle mouse button anywhere → pan.
// - Smooth animated transition when focusing a folder.
// - Slim graph controls panel (collapsible).
// - Deep search: matches title, folder, AND note body.
// - Double wikilinks: rendered as parallel lines + stronger attraction.
// - Icon/color editing for notes and folders from the graph.
// - Bulk icon/color apply: this only · siblings · children · parents · all.
// ============================================================

import {
  $,
  state,
  lucide,
  safeCssColor,
  uid,
  store,
  escapeHtml,
  toast,
} from './core.js';
import { wikilinkIndex } from './features-state.js';
import { openNote, rebuildWikilinkIndex } from './notes.js';
import { renderTree } from './tree.js';
import { noteMarkdown, getNoteDoc } from './yjs.js';
import { renderPreview } from './markdown.js';
import { openIconPicker } from './icon-picker.js';

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;

const NODE = {
  NOTE: 'note',
  FOLDER: 'folder',
};

const LINK = {
  WIKI: 'wiki',
  SEMANTIC: 'semantic',
  CONTAINS: 'contains',
  FOLDER: 'folder',
};

const GRAPH_PREFS_KEY = 'yanta.graph.showFolders';
const GRAPH_SEMANTIC_PREFS_KEY = 'yanta.graph.showSemantic';
const GRAPH_PANE_PREFS_KEY = 'yanta.graph.preferPane';
const GRAPH_CONTROLS_OPEN_KEY = 'yanta.graph.controlsOpen';
const GRAPH_DEEP_SEARCH_KEY = 'yanta.graph.deepSearch';

// Semantic graph tuning.
const SEMANTIC_MIN_SCORE = 0.23;
const SEMANTIC_MAX_LINKS_PER_NOTE = 3;
const SEMANTIC_MAX_BODY_CHARS = 16000;

// Visual tuning.
const VISUAL_EASE = 0.24;
const VISUAL_EPS = 0.007;

// Physics tuning.
const PHYSICS = {
  minAlpha: 0.004,
  alphaDecay: 0.928,
  dragAlphaDecay: 0.955,

  damping: 0.815,
  dragDamping: 0.835,

  repulsion: 1850,
  semanticRepulsion: 1450,
  repulsionCutoff: 390,

  centerGravity: 0.0028,
  dragCenterGravity: 0.0012,

  folderPull: 0.0034,
  dragFolderPull: 0.0018,

  maxSpeed: 14,
  settleSpeed: 0.012,
};

const DRAG_START_ALPHA = 0.32;
const DRAG_MOVE_ALPHA = 0.42;
const DRAG_RELEASE_ALPHA = 0.38;
const BUILD_ALPHA = 1.0;

// Interaction tuning.
const CLICK_MOVE_TOLERANCE = 6;
const LONG_PRESS_MS = 560;
const LONG_PRESS_MOVE_TOLERANCE = 8;

// Smooth view transition tuning (used by centerOnNode).
const VIEW_TRANSITION_MS = 360;

// Optional pane mode.
const WIDE_PANE_MIN_WIDTH = 1120;

const SEMANTIC_STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'onto', 'over',
  'under', 'then', 'than', 'when', 'where', 'what', 'which', 'while', 'about',
  'also', 'because', 'there', 'their', 'these', 'those', 'they', 'them', 'were',
  'been', 'being', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
  'will', 'may', 'might', 'must', 'not', 'are', 'was', 'is', 'it', 'as', 'at',
  'by', 'on', 'in', 'of', 'to', 'a', 'an', 'or', 'if', 'we', 'you', 'i',

  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem',
  'einen', 'und', 'oder', 'aber', 'auch', 'mit', 'für', 'von', 'aus', 'auf',
  'über', 'unter', 'nach', 'vor', 'bei', 'ist', 'sind', 'war', 'waren', 'sein',
  'hat', 'haben', 'hatte', 'hatten', 'wird', 'werden', 'wurde', 'wurden',
  'kann', 'könnte', 'soll', 'sollte', 'muss', 'müssen', 'nicht', 'nur', 'wie',
  'was', 'wenn', 'dann', 'weil', 'dass', 'dies', 'diese', 'dieser', 'dieses',
  'diesen', 'als', 'im', 'am', 'an', 'zu', 'in', 'es', 'ich', 'du', 'wir',
  'sie', 'er',

  // Markdown / note-system noise
  'http', 'https', 'www', 'com', 'org', 'net', 'markdown', 'yanta', 'img',
  'png', 'jpg', 'jpeg', 'webp', 'svg', 'todo', 'done',
]);

const graph = {
  nodes: [],
  links: [],
  idIndex: new Map(),
  adj: new Map(),
  descendantsByFolder: new Map(),

  canvas: null,
  ctx: null,
  mode: 'overlay', // 'overlay' | 'pane'

  overlayCanvas: null,
  paneHost: null,
  paneCanvas: null,
  paneHiddenChildren: [],

  raf: 0,
  visualRaf: 0,
  visualTime: 0,

  simRunning: false,
  simAlpha: 0,

  scale: 1,
  ox: 0,
  oy: 0,

  // Smooth view-transition state.
  viewTween: null,

  dragNode: null,
  dragMx: 0,
  dragMy: 0,
  panning: false,
  panningButton: 0,

  hover: null,
  highlight: '',
  focusFolderId: null,

  showFolders: readBoolPref(GRAPH_PREFS_KEY, true),
  showSemantic: readBoolPref(GRAPH_SEMANTIC_PREFS_KEY, false),
  preferPane: readBoolPref(GRAPH_PANE_PREFS_KEY, false),
  controlsOpen: readBoolPref(GRAPH_CONTROLS_OPEN_KEY, false),
  deepSearch: readBoolPref(GRAPH_DEEP_SEARCH_KEY, true),

  pressMx: 0,
  pressMy: 0,
  moved: 0,
  pointerId: null,
  longPressTimer: 0,
  longPressFired: false,
  suppressNextClick: false,

  positionMemory: new Map(), // gid -> { x, y, vx, vy }
  spawnPositions: new Map(), // gid -> { x, y }
};

const iconCache = new Map();
const boundCanvases = new WeakSet();

let previewEl = null;
let menuEl = null;
let injectedCss = false;

// ------------------------------------------------------------
// Preferences / theme / utility
// ------------------------------------------------------------

function readBoolPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v !== 'false';
  } catch {
    return fallback;
  }
}

function writeBoolPref(key, v) {
  try {
    localStorage.setItem(key, String(!!v));
  } catch {}
}

function cssVar(style, name, fallback) {
  return style.getPropertyValue(name).trim() || fallback;
}

function theme() {
  const s = getComputedStyle(document.documentElement);

  return {
    accent: cssVar(s, '--accent', '#6ea8fe'),
    accent2: cssVar(s, '--accent-2', '#a78bfa'),
    green: cssVar(s, '--green', '#4ade80'),
    yellow: cssVar(s, '--yellow', '#fbbf24'),
    red: cssVar(s, '--red', '#f87171'),
    bg: cssVar(s, '--bg', '#0d1117'),
    bgElev: cssVar(s, '--bg-elev', '#161b22'),
    bgElev2: cssVar(s, '--bg-elev-2', '#1c222c'),
    bgElev3: cssVar(s, '--bg-elev-3', '#242b36'),
    border: cssVar(s, '--border', '#2a313c'),
    borderStrong: cssVar(s, '--border-strong', '#3a4250'),
    text: cssVar(s, '--text', '#d8dee9'),
    textDim: cssVar(s, '--text-dim', '#8a93a4'),
    textFaint: cssVar(s, '--text-faint', '#5b6270'),
    font: s.fontFamily || 'system-ui, sans-serif',
  };
}

function graphIdForNote(noteId) {
  return `note:${noteId}`;
}

function graphIdForFolder(folderId) {
  return `folder:${folderId}`;
}

function safeMetaColor(color, fallback = '') {
  return safeCssColor(color) || fallback;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function lerpValue(current, target, ease = VISUAL_EASE) {
  return current + (target - current) * ease;
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function pairKey(aGid, bGid) {
  return [aGid, bGid].sort().join('::');
}

function deterministicPhase(s) {
  let h = 2166136261;

  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return ((h >>> 0) / 4294967295) * Math.PI * 2;
}

function canvasCssSize() {
  if (!graph.canvas) return { w: 1200, h: 800 };

  const r = graph.canvas.getBoundingClientRect();

  return {
    w: Math.max(1, r.width || graph.canvas.clientWidth || 1200),
    h: Math.max(1, r.height || graph.canvas.clientHeight || 800),
  };
}

function viewportCenter() {
  const { w, h } = canvasCssSize();
  return { x: w / 2, y: h / 2 };
}

function graphVisible() {
  if (graph.mode === 'pane') {
    return !!graph.paneHost?.isConnected && !!graph.canvas;
  }

  const ov = $('graphOverlay');
  return !!ov && !ov.hidden && !!graph.canvas;
}

function injectGraphCss() {
  if (injectedCss) return;
  injectedCss = true;

  const style = document.createElement('style');
  style.id = 'yanta-graph-runtime-css';
  style.textContent = `
    .graph-head .btn.active {
      color: var(--accent);
      border-color: var(--accent);
      background: rgba(110,168,254,0.10);
    }

    .yanta-graph-note-preview {
      position: fixed;
      z-index: 170;
      width: min(620px, calc(100vw - 24px));
      max-height: min(72vh, 720px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 18px 50px rgba(0,0,0,0.42);
      animation: fade-in 0.12s ease;
    }

    .yanta-graph-note-preview[hidden] {
      display: none !important;
    }

    .yanta-graph-note-preview-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-elev-2);
    }

    .yanta-graph-note-preview-title {
      min-width: 0;
      flex: 1;
      font-weight: 700;
      color: var(--text);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .yanta-graph-note-preview-meta {
      font-size: 11px;
      color: var(--text-faint);
      margin-top: 1px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .yanta-graph-note-preview-icon {
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
      background: rgba(110,168,254,0.10);
      box-shadow: 0 0 0 1px var(--border) inset;
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
      background: var(--bg);
    }

    .yanta-graph-note-preview-body .preview {
      max-width: none;
      margin: 0;
      font-size: 14px;
      line-height: 1.65;
    }

    .yanta-graph-note-preview-body .backlinks,
    .yanta-graph-note-preview-body .pv-outline {
      display: none !important;
    }

    .yanta-graph-empty-preview {
      padding: 22px;
      color: var(--text-faint);
      text-align: center;
      font-style: italic;
      border: 1px dashed var(--border);
      border-radius: 10px;
      background: var(--bg-elev);
    }

    .yanta-graph-context-menu {
      position: fixed;
      z-index: 180;
      min-width: 220px;
      padding: 5px;
      border-radius: 10px;
      background: var(--bg-elev-3);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
    }

    .yanta-graph-context-menu button {
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 7px;
      cursor: pointer;
      text-align: left;
      font-size: 13px;
    }

    .yanta-graph-context-menu button:hover {
      background: var(--bg-elev-2);
    }

    .yanta-graph-context-menu button.danger {
      color: var(--red);
    }

    .yanta-graph-context-menu hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 4px 2px;
    }

    .yanta-graph-context-menu .ctx-meta {
      padding: 6px 10px 8px;
      color: var(--text-faint);
      font-size: 11px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 4px;
    }

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

    .yanta-graph-pane-host .graph-legend {
      max-width: min(520px, calc(100% - 32px));
    }

    .pane-preview.yanta-graph-pane-active {
      position: relative;
      padding: 0 !important;
      overflow: hidden;
    }

    /* Slim stats badge replaces the verbose legend */
    .yanta-graph-stats {
      position: absolute;
      left: 14px;
      bottom: 14px;
      z-index: 4;
      display: flex;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(0,0,0,0.35);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 11px;
      pointer-events: none;
    }

    .yanta-graph-stats strong {
      color: var(--text);
      font-weight: 600;
    }

    /* Controls panel */
    .yanta-graph-controls {
      position: absolute;
      right: 14px;
      top: 14px;
      z-index: 5;
      width: 268px;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.35);
      overflow: hidden;
      font-size: 12px;
      transition: width 0.18s ease;
    }

    .yanta-graph-controls.collapsed {
      width: 44px;
    }

    .yanta-graph-controls-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      cursor: pointer;
      user-select: none;
      background: var(--bg-elev-2);
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
    .yanta-graph-controls.collapsed .yanta-graph-controls-body {
      display: none;
    }

    .yanta-graph-controls-head .gc-chev {
      color: var(--text-faint);
      display: inline-flex;
    }

    .yanta-graph-controls-body {
      padding: 10px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: min(72vh, 560px);
      overflow: auto;
    }

    .yanta-graph-controls .gc-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .yanta-graph-controls .gc-group-title {
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-faint);
      font-weight: 600;
    }

    .yanta-graph-controls .gc-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 8px;
      border-radius: 7px;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      cursor: pointer;
    }

    .yanta-graph-controls .gc-toggle:hover {
      border-color: var(--border-strong);
    }

    .yanta-graph-controls .gc-toggle .gc-label {
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--text);
    }

    .yanta-graph-controls .gc-switch {
      position: relative;
      width: 28px;
      height: 16px;
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
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--text-dim);
      transition: transform 0.15s ease, background 0.15s ease;
    }

    .yanta-graph-controls .gc-toggle.on .gc-switch {
      background: rgba(110,168,254,0.25);
      border-color: var(--accent);
    }

    .yanta-graph-controls .gc-toggle.on .gc-switch::after {
      transform: translateX(12px);
      background: var(--accent);
    }

    .yanta-graph-controls .gc-action {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 8px;
      border-radius: 7px;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      cursor: pointer;
      text-align: left;
    }

    .yanta-graph-controls .gc-action:hover {
      background: var(--bg-elev-2);
      border-color: var(--border-strong);
    }

    .yanta-graph-controls .gc-search-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .yanta-graph-controls input[type="search"] {
      width: 100%;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 7px;
      padding: 6px 8px;
      font-size: 12px;
      outline: none;
    }

    .yanta-graph-controls input[type="search"]:focus {
      border-color: var(--accent);
    }

    .yanta-graph-controls .gc-hint {
      color: var(--text-faint);
      font-size: 10px;
      line-height: 1.4;
    }

    /* Scope picker (used when applying icon/color to a group) */
    .yanta-scope-modal {
      position: fixed;
      inset: 0;
      z-index: 200;
      background: rgba(0,0,0,0.4);
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
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
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

    .yanta-scope-body .yanta-scope-opt:hover {
      border-color: var(--accent);
      background: rgba(110,168,254,0.08);
    }

    .yanta-scope-body .yanta-scope-opt[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .yanta-scope-body .yanta-scope-opt:hover:not([disabled]) {
      border-color: var(--accent);
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
  `;

  document.head.append(style);
}

// ------------------------------------------------------------
// Folder / note metadata helpers
// ------------------------------------------------------------

function folderPath(folderId) {
  if (!folderId) return [];

  const out = [];
  const seen = new Set();
  let f = state.folders.get(folderId);

  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    out.unshift(f.name || 'Folder');
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return out;
}

function noteFolderLabel(note) {
  const path = folderPath(note.folderId);
  return path.length ? path.join(' / ') : 'No folder';
}

function folderDepth(folderId) {
  let d = 0;
  let f = state.folders.get(folderId);
  const seen = new Set();

  while (f?.parentId && !seen.has(f.id)) {
    seen.add(f.id);
    d++;
    f = state.folders.get(f.parentId);
  }

  return d;
}

function folderRootId(folderId) {
  let f = state.folders.get(folderId);
  const seen = new Set();

  if (!f) return null;

  while (f.parentId && state.folders.has(f.parentId) && !seen.has(f.id)) {
    seen.add(f.id);
    f = state.folders.get(f.parentId);
  }

  return f?.id || folderId;
}

function isTopLevelFolder(folder) {
  return !folder.parentId || !state.folders.has(folder.parentId);
}

function topLevelFolderIds() {
  return [...state.folders.values()]
    .filter((f) => !f.parentId || !state.folders.has(f.parentId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map((f) => f.id);
}

// ------------------------------------------------------------
// Graph data creation
// ------------------------------------------------------------

function rememberPositions() {
  for (const n of graph.nodes) {
    graph.positionMemory.set(n.gid, {
      x: n.x,
      y: n.y,
      vx: n.vx || 0,
      vy: n.vy || 0,
    });
  }
}

function resolvePosition(gid, fallback) {
  const spawn = graph.spawnPositions.get(gid);
  if (spawn) {
    return {
      x: spawn.x,
      y: spawn.y,
      vx: (Math.random() - 0.5) * 1.8,
      vy: (Math.random() - 0.5) * 1.8,
      birthT: 1,
      isNew: true,
    };
  }

  const prev = graph.positionMemory.get(gid);
  if (prev) {
    return {
      x: prev.x,
      y: prev.y,
      vx: prev.vx || 0,
      vy: prev.vy || 0,
      birthT: 0,
      isNew: false,
    };
  }

  return {
    x: fallback.x,
    y: fallback.y,
    vx: 0,
    vy: 0,
    birthT: 0,
    isNew: false,
  };
}

function addNode(node) {
  node.phase = node.phase ?? deterministicPhase(node.gid);

  node.hoverT = node.hoverT ?? 0;
  node.currentT = node.currentT ?? 0;
  node.matchT = node.matchT ?? 0;
  node.dimT = node.dimT ?? 0;
  node.birthT = node.birthT ?? 0;

  graph.idIndex.set(node.gid, graph.nodes.length);
  graph.nodes.push(node);
}

function addLink(aGid, bGid, kind, weight = 1, extra = {}) {
  const a = graph.idIndex.get(aGid);
  const b = graph.idIndex.get(bGid);

  if (a == null || b == null || a === b) return null;

  const link = {
    a,
    b,
    kind,
    weight,
    dimT: 0,
    ...extra,
  };

  graph.links.push(link);

  if (kind === LINK.SEMANTIC) {
    graph.nodes[a].semanticDegree = (graph.nodes[a].semanticDegree || 0) + 1;
    graph.nodes[b].semanticDegree = (graph.nodes[b].semanticDegree || 0) + 1;
  } else {
    graph.nodes[a].degree++;
    graph.nodes[b].degree++;
  }

  if (kind === LINK.WIKI) {
    graph.nodes[a].wikiDegree++;
    graph.nodes[b].wikiDegree++;
  }

  if (!graph.adj.has(a)) graph.adj.set(a, new Set());
  if (!graph.adj.has(b)) graph.adj.set(b, new Set());

  graph.adj.get(a).add(b);
  graph.adj.get(b).add(a);

  return link;
}

function groupCenters() {
  const { w, h } = canvasCssSize();
  const cx = w / 2;
  const cy = h / 2;

  const rootIds = topLevelFolderIds();
  const groups = rootIds.length ? rootIds : ['__ungrouped__'];

  const centers = new Map();

  if (groups.length === 1) {
    centers.set(groups[0], { x: cx, y: cy });
    return centers;
  }

  const radius = Math.min(w, h) * 0.29;

  groups.forEach((id, i) => {
    const angle = -Math.PI / 2 + (i / groups.length) * Math.PI * 2;

    centers.set(id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });

  return centers;
}

function initialFolderPosition(folder, indexByRoot, centers) {
  const root = folderRootId(folder.id) || folder.id;
  const center = centers.get(root) || viewportCenter();

  const depth = folderDepth(folder.id);
  const i = indexByRoot.get(root) || 0;

  indexByRoot.set(root, i + 1);

  const angle = -Math.PI / 2 + i * 1.919862177;
  const radius = depth === 0 ? 0 : 74 + depth * 78 + (i % 4) * 16;

  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function initialNotePosition(note, noteIndexByGroup, centers, folderNodeById) {
  if (graph.showFolders && note.folderId && folderNodeById.has(note.folderId)) {
    const parent = folderNodeById.get(note.folderId);
    const key = note.folderId;
    const i = noteIndexByGroup.get(key) || 0;

    noteIndexByGroup.set(key, i + 1);

    const angle = -Math.PI / 2 + i * 2.399963229728653;
    const radius = 54 + Math.floor(i / 7) * 34 + (i % 7) * 4;

    return {
      x: parent.x + Math.cos(angle) * radius,
      y: parent.y + Math.sin(angle) * radius,
    };
  }

  const root = note.folderId ? folderRootId(note.folderId) : '__ungrouped__';

  const center =
    centers.get(root) ||
    centers.get('__ungrouped__') ||
    [...centers.values()][0] ||
    viewportCenter();

  const key = root || '__ungrouped__';
  const i = noteIndexByGroup.get(key) || 0;

  noteIndexByGroup.set(key, i + 1);

  const angle = -Math.PI / 2 + i * 2.399963229728653;
  const radius = 54 + Math.floor(i / 9) * 43 + (i % 9) * 5;

  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function buildDescendantSets() {
  graph.descendantsByFolder.clear();

  for (const f of state.folders.values()) {
    graph.descendantsByFolder.set(f.id, new Set([graphIdForFolder(f.id)]));
  }

  for (const f of state.folders.values()) {
    let cur = f;

    while (cur?.parentId) {
      graph.descendantsByFolder.get(cur.parentId)?.add(graphIdForFolder(f.id));
      cur = state.folders.get(cur.parentId);
    }
  }

  for (const n of state.notes.values()) {
    if (!n.folderId) continue;

    let f = state.folders.get(n.folderId);

    while (f) {
      graph.descendantsByFolder.get(f.id)?.add(graphIdForNote(n.id));
      f = f.parentId ? state.folders.get(f.parentId) : null;
    }
  }
}

function buildGraph() {
  rememberPositions();

  graph.nodes = [];
  graph.links = [];
  graph.idIndex.clear();
  graph.adj.clear();
  graph.descendantsByFolder.clear();
  graph.hover = null;

  if (!graph.showFolders) {
    graph.focusFolderId = null;
  }

  const t = theme();
  const centers = groupCenters();

  const folders = [...state.folders.values()].sort((a, b) => {
    const da = folderDepth(a.id);
    const db = folderDepth(b.id);
    return da - db || (a.name || '').localeCompare(b.name || '');
  });

  const notes = [...state.notes.values()].sort((a, b) => {
    const fa = folderPath(a.folderId).join('/');
    const fb = folderPath(b.folderId).join('/');
    return fa.localeCompare(fb) || (b.updated || 0) - (a.updated || 0);
  });

  const folderNodeById = new Map();

  if (graph.showFolders) {
    const folderIndexByRoot = new Map();

    for (const f of folders) {
      const fallback = initialFolderPosition(f, folderIndexByRoot, centers);
      const pos = resolvePosition(graphIdForFolder(f.id), fallback);
      const top = isTopLevelFolder(f);

      const color = safeMetaColor(
        f.color,
        top ? t.textDim : t.textFaint
      );

      const node = {
        gid: graphIdForFolder(f.id),
        id: f.id,
        type: NODE.FOLDER,
        title: f.name || 'Folder',
        subtitle: folderPath(f.id).join(' / ') || 'Folder',
        icon: f.icon || 'folder',
        color,

        x: pos.x,
        y: pos.y,
        vx: pos.vx,
        vy: pos.vy,
        fx: 0,
        fy: 0,
        birthT: pos.birthT,

        degree: 0,
        wikiDegree: 0,
        semanticDegree: 0,

        folderId: f.id,
        folderDepth: folderDepth(f.id),
        isTopLevelFolder: top,

        radius: top ? 24 : 15,
        physicsRadius: top ? 31 : 17,
      };

      folderNodeById.set(f.id, node);
      addNode(node);
    }
  }

  const noteIndexByGroup = new Map();

  for (const n of notes) {
    const fallback = initialNotePosition(n, noteIndexByGroup, centers, folderNodeById);
    const pos = resolvePosition(graphIdForNote(n.id), fallback);

    const color = safeMetaColor(
      n.color,
      n.type === 'list' ? t.accent2 : t.text
    );

    addNode({
      gid: graphIdForNote(n.id),
      id: n.id,
      type: NODE.NOTE,
      title: n.title || 'Untitled',
      subtitle: noteFolderLabel(n),
      icon: n.icon || (n.type === 'list' ? 'list' : 'file'),
      color,

      x: pos.x,
      y: pos.y,
      vx: pos.vx,
      vy: pos.vy,
      fx: 0,
      fy: 0,
      birthT: pos.birthT,

      degree: 0,
      wikiDegree: 0,
      semanticDegree: 0,

      radius: 12,
      physicsRadius: 14,

      noteId: n.id,
      folderId: n.folderId || null,
      pinned: !!n.pinned,
    });
  }

  if (graph.showFolders) {
    for (const f of folders) {
      if (f.parentId && state.folders.has(f.parentId)) {
        addLink(graphIdForFolder(f.parentId), graphIdForFolder(f.id), LINK.FOLDER, 1.3);
      }
    }

    for (const n of notes) {
      if (n.folderId && state.folders.has(n.folderId)) {
        addLink(graphIdForFolder(n.folderId), graphIdForNote(n.id), LINK.CONTAINS, 1.22);
      }
    }
  }

  // Wiki links — count multiplicities per ordered pair and merge into a
  // single visible link per unordered pair with attached "count" weight.
  // Forward (n.id -> tid) and reverse counts are stored separately so
  // mutual references are visible (count >= 2 means "back-and-forth").
  const wikiCounts = new Map(); // pairKey -> { a, b, fwd, rev, total }

  for (const n of notes) {
    let body = '';

    try {
      body = noteMarkdown(n.id);
    } catch {}

    WIKILINK_RE.lastIndex = 0;
    let m;

    while ((m = WIKILINK_RE.exec(body)) !== null) {
      const tid = wikilinkIndex.get(m[1].trim().toLowerCase());
      if (!tid || tid === n.id) continue;

      const aGid = graphIdForNote(n.id);
      const bGid = graphIdForNote(tid);
      const key = pairKey(aGid, bGid);

      let entry = wikiCounts.get(key);
      if (!entry) {
        entry = { a: aGid, b: bGid, fwd: 0, rev: 0, total: 0 };
        wikiCounts.set(key, entry);
      }

      // Direction relative to the ordered "min,max" pair key.
      if (aGid < bGid) entry.fwd++;
      else entry.rev++;

      entry.total++;
    }
  }

  const wikiSeenGlobal = new Set();

  for (const entry of wikiCounts.values()) {
    wikiSeenGlobal.add(pairKey(entry.a, entry.b));

    // Weight scales mildly with multiplicity but caps so 5+ refs don't
    // collapse the graph.
    const count = entry.total;
    const weight = Math.min(2.4, 1 + Math.log2(count + 1) * 0.55);

    addLink(entry.a, entry.b, LINK.WIKI, weight, {
      count,
      mutual: entry.fwd > 0 && entry.rev > 0,
    });
  }

  addSemanticLinks(notes, wikiSeenGlobal);
  buildDescendantSets();

  graph.spawnPositions.clear();
}

// ------------------------------------------------------------
// Local semantic graph
// ------------------------------------------------------------

function normalizeToken(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function semanticTokens(text) {
  const norm = normalizeToken(text)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/yanta-img:\/\/[a-z0-9]+/gi, ' ')
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, ' ');

  const matches = norm.match(/[\p{L}\p{N}]{3,}/gu) || [];

  return matches
    .filter((tok) => !SEMANTIC_STOPWORDS.has(tok))
    .filter((tok) => !/^\d+$/.test(tok))
    .map((tok) => {
      if (tok.length > 7 && tok.endsWith('ungen')) return tok.slice(0, -5);
      if (tok.length > 6 && tok.endsWith('tion')) return tok.slice(0, -4);
      if (tok.length > 6 && tok.endsWith('ing')) return tok.slice(0, -3);
      if (tok.length > 6 && tok.endsWith('lich')) return tok.slice(0, -4);
      if (tok.length > 5 && tok.endsWith('en')) return tok.slice(0, -2);
      if (tok.length > 5 && tok.endsWith('er')) return tok.slice(0, -2);
      if (tok.length > 5 && tok.endsWith('es')) return tok.slice(0, -2);
      if (tok.length > 5 && tok.endsWith('s')) return tok.slice(0, -1);
      return tok;
    });
}

function noteSemanticText(note) {
  let body = '';

  try {
    body = noteMarkdown(note.id) || '';
  } catch {
    body = '';
  }

  if (body.length > SEMANTIC_MAX_BODY_CHARS) {
    body = body.slice(0, SEMANTIC_MAX_BODY_CHARS);
  }

  const title = note.title || '';
  const tags = (note.tags || []).join(' ');

  return [
    title,
    title,
    title,
    tags,
    tags,
    tags,
    body,
  ].join('\n');
}

function semanticVectorForNote(note) {
  const tokens = semanticTokens(noteSemanticText(note));
  const vec = new Map();

  for (const tok of tokens) {
    vec.set(tok, Math.min(10, (vec.get(tok) || 0) + 1));
  }

  let norm = 0;

  for (const v of vec.values()) {
    norm += v * v;
  }

  norm = Math.sqrt(norm) || 1;

  return { vec, norm };
}

function semanticCosine(a, b) {
  let small = a.vec;
  let large = b.vec;

  if (large.size < small.size) {
    small = b.vec;
    large = a.vec;
  }

  let dot = 0;

  for (const [tok, av] of small) {
    const bv = large.get(tok);
    if (bv) dot += av * bv;
  }

  return dot / (a.norm * b.norm);
}

function semanticLayoutParams(score) {
  const closeness = clamp01((score - SEMANTIC_MIN_SCORE) / (0.62 - SEMANTIC_MIN_SCORE));

  const maxDistance = 185;
  const minDistance = 44;

  return {
    closeness,
    distance: maxDistance - closeness * (maxDistance - minDistance),
    strength: 0.0045 + closeness * 0.023,
  };
}

function addSemanticLinks(notes, explicitWikiPairs) {
  if (!graph.showSemantic || notes.length < 2) return;

  const prepared = [];

  for (const note of notes) {
    const gid = graphIdForNote(note.id);
    if (!graph.idIndex.has(gid)) continue;

    const vector = semanticVectorForNote(note);
    if (vector.vec.size < 4) continue;

    prepared.push({ note, gid, vector });
  }

  const candidates = [];

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];

      const pk = pairKey(a.gid, b.gid);
      if (explicitWikiPairs.has(pk)) continue;

      const score = semanticCosine(a.vector, b.vector);

      if (score >= SEMANTIC_MIN_SCORE) {
        candidates.push({ a, b, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const countByNote = new Map();
  const maxGlobal = Math.max(12, notes.length * 2);

  let added = 0;

  for (const c of candidates) {
    if (added >= maxGlobal) break;

    const ca = countByNote.get(c.a.note.id) || 0;
    const cb = countByNote.get(c.b.note.id) || 0;

    if (ca >= SEMANTIC_MAX_LINKS_PER_NOTE || cb >= SEMANTIC_MAX_LINKS_PER_NOTE) {
      continue;
    }

    const layout = semanticLayoutParams(c.score);

    addLink(c.a.gid, c.b.gid, LINK.SEMANTIC, Math.max(0.4, c.score), {
      score: c.score,
      semanticDistance: layout.distance,
      semanticStrength: layout.strength,
      semanticCloseness: layout.closeness,
    });

    countByNote.set(c.a.note.id, ca + 1);
    countByNote.set(c.b.note.id, cb + 1);

    added++;
  }
}

// ------------------------------------------------------------
// Physics
// ------------------------------------------------------------

function pairRepulsion(a, b, repulsion) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;

  let d2 = dx * dx + dy * dy;

  if (d2 < 0.001) {
    const p = (a.phase || 0) - (b.phase || 0) || Math.random();
    dx = Math.cos(p) * 0.5;
    dy = Math.sin(p) * 0.5;
    d2 = dx * dx + dy * dy;
  }

  const d = Math.sqrt(d2);
  const minD = (a.physicsRadius || 12) + (b.physicsRadius || 12) + 5;

  if (d > PHYSICS.repulsionCutoff && d > minD * 2.4) return;

  const sizeFactor = ((a.physicsRadius || 12) + (b.physicsRadius || 12)) / 25;

  let f = (repulsion * sizeFactor) / (d2 + 120);

  if (d < minD) {
    f += (minD - d) * 0.055;
  }

  const fx = (dx / d) * f;
  const fy = (dy / d) * f;

  a.fx -= fx;
  a.fy -= fy;
  b.fx += fx;
  b.fy += fy;
}

function applyRepulsion(ns, repulsion) {
  const n = ns.length;

  if (n < 260) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        pairRepulsion(ns[i], ns[j], repulsion);
      }
    }

    return;
  }

  const cell = PHYSICS.repulsionCutoff;
  const buckets = new Map();

  const keyFor = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;

  for (let i = 0; i < n; i++) {
    const node = ns[i];
    const k = keyFor(node.x, node.y);

    let bucket = buckets.get(k);
    if (!bucket) {
      bucket = [];
      buckets.set(k, bucket);
    }

    bucket.push(i);
  }

  const seen = new Set();

  for (let i = 0; i < n; i++) {
    const a = ns[i];
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);

    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = buckets.get(`${gx},${gy}`);
        if (!bucket) continue;

        for (const j of bucket) {
          if (j <= i) continue;

          const pk = `${i}:${j}`;
          if (seen.has(pk)) continue;
          seen.add(pk);

          pairRepulsion(a, ns[j], repulsion);
        }
      }
    }
  }
}

function stepGraph() {
  if (!graph.canvas) return 0;

  const ns = graph.nodes;
  const ls = graph.links;
  const alpha = graph.simAlpha;

  const dragging = !!graph.dragNode;
  const dragIdx = dragging ? graph.idIndex.get(graph.dragNode.gid) : null;

  const baseRepulsion = graph.showSemantic
    ? PHYSICS.semanticRepulsion
    : PHYSICS.repulsion;

  const repulsion = baseRepulsion * alpha;
  const damping = dragging ? PHYSICS.dragDamping : PHYSICS.damping;

  const { w, h } = canvasCssSize();
  const cx = w / 2;
  const cy = h / 2;

  let energy = 0;

  for (const n of ns) {
    n.fx = 0;
    n.fy = 0;
  }

  applyRepulsion(ns, repulsion);

  for (const l of ls) {
    const a = ns[l.a];
    const b = ns[l.b];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;

    let desired = 135;
    let strength = 0.010 * alpha;

    if (l.kind === LINK.FOLDER) {
      desired = 120;
      strength = 0.0165 * alpha;
    } else if (l.kind === LINK.CONTAINS) {
      desired = a.isTopLevelFolder || b.isTopLevelFolder ? 100 : 78;
      strength = 0.024 * alpha;
    } else if (l.kind === LINK.WIKI) {
      // Wikilinks pull harder when there are more references between two notes.
      // A single ref behaves like before; mutual or repeated refs pull closer.
      const count = l.count || 1;
      const countBoost = Math.min(2.2, 1 + Math.log2(count) * 0.65);

      desired = (graph.showFolders ? 158 : 128) / countBoost;
      strength = 0.0125 * alpha * countBoost;
    } else if (l.kind === LINK.SEMANTIC) {
      desired = l.semanticDistance || (graph.showFolders ? 160 : 120);
      strength = (l.semanticStrength || 0.006) * alpha;

      if (!graph.showFolders) {
        strength *= 1.45;
        desired *= 0.88;
      }
    }

    strength *= l.weight || 1;

    if (dragging && dragIdx != null) {
      const incident = l.a === dragIdx || l.b === dragIdx;
      strength *= incident ? 1.35 : 0.42;
    }

    const delta = d - desired;
    const f = delta * strength;

    const fx = (dx / d) * f;
    const fy = (dy / d) * f;

    if (dragging && dragIdx != null) {
      if (l.a === dragIdx) {
        b.fx -= fx;
        b.fy -= fy;
      } else if (l.b === dragIdx) {
        a.fx += fx;
        a.fy += fy;
      } else {
        a.fx += fx;
        a.fy += fy;
        b.fx -= fx;
        b.fy -= fy;
      }
    } else {
      a.fx += fx;
      a.fy += fy;
      b.fx -= fx;
      b.fy -= fy;
    }
  }

  const centerGravity =
    (dragging ? PHYSICS.dragCenterGravity : PHYSICS.centerGravity) * alpha;

  const folderPull =
    (dragging ? PHYSICS.dragFolderPull : PHYSICS.folderPull) * alpha;

  for (const n of ns) {
    n.fx += (cx - n.x) * centerGravity;
    n.fy += (cy - n.y) * centerGravity;

    if (graph.showFolders && n.type === NODE.NOTE && n.folderId) {
      const folderIdx = graph.idIndex.get(graphIdForFolder(n.folderId));

      if (folderIdx != null) {
        const f = ns[folderIdx];

        n.fx += (f.x - n.x) * folderPull;
        n.fy += (f.y - n.y) * folderPull;
      }
    }
  }

  for (const n of ns) {
    n.vx = (n.vx + n.fx) * damping;
    n.vy = (n.vy + n.fy) * damping;

    const speed = Math.hypot(n.vx, n.vy);
    const maxSpeed = dragging ? PHYSICS.maxSpeed * 1.15 : PHYSICS.maxSpeed;

    if (speed > maxSpeed) {
      const k = maxSpeed / speed;
      n.vx *= k;
      n.vy *= k;
    }

    if (graph.dragNode !== n) {
      n.x += n.vx;
      n.y += n.vy;
    }

    if (graph.simAlpha < 0.02 && Math.abs(n.vx) + Math.abs(n.vy) < PHYSICS.settleSpeed) {
      n.vx = 0;
      n.vy = 0;
    }

    energy += Math.abs(n.vx) + Math.abs(n.vy);
  }

  graph.simAlpha *= dragging ? PHYSICS.dragAlphaDecay : PHYSICS.alphaDecay;

  return energy;
}

function startSimulation(alpha = 1) {
  graph.simAlpha = Math.max(graph.simAlpha || 0, alpha);

  if (!graph.simRunning) {
    graph.simRunning = true;
    cancelAnimationFrame(graph.raf);
    graph.raf = requestAnimationFrame(animate);
  }

  startVisualLoop();
}

function stopSimulation({ keepDrag = false } = {}) {
  graph.simRunning = false;
  graph.simAlpha = 0;
  cancelAnimationFrame(graph.raf);

  for (const n of graph.nodes) {
    if (keepDrag && graph.dragNode === n) continue;

    n.vx = 0;
    n.vy = 0;
    n.fx = 0;
    n.fy = 0;
  }

  startVisualLoop();
}

function animate() {
  if (!graph.simRunning) return;

  const energy = stepGraph();

  if (graph.simAlpha < PHYSICS.minAlpha || energy < 0.055) {
    stopSimulation({ keepDrag: !!graph.dragNode });
    return;
  }

  graph.raf = requestAnimationFrame(animate);
}

// ------------------------------------------------------------
// Visual transitions
// ------------------------------------------------------------

function startVisualLoop() {
  if (graph.visualRaf) return;
  graph.visualRaf = requestAnimationFrame(visualFrame);
}

function visualFrame(ts) {
  graph.visualRaf = 0;
  graph.visualTime = ts || performance.now();

  const transitionsActive = updateVisualTransitions();
  const viewTweenActive = stepViewTween();

  drawGraph();

  const shouldContinue =
    graphVisible() &&
    (
      graph.simRunning ||
      transitionsActive ||
      viewTweenActive
    );

  if (shouldContinue) {
    graph.visualRaf = requestAnimationFrame(visualFrame);
  }
}

function stepViewTween() {
  const tw = graph.viewTween;
  if (!tw) return false;

  const now = performance.now();
  const t = clamp01((now - tw.startTime) / tw.duration);
  const e = easeInOutCubic(t);

  graph.scale = tw.fromScale + (tw.toScale - tw.fromScale) * e;
  graph.ox = tw.fromOx + (tw.toOx - tw.fromOx) * e;
  graph.oy = tw.fromOy + (tw.toOy - tw.fromOy) * e;

  if (t >= 1) {
    graph.viewTween = null;
    return false;
  }

  return true;
}

function updateVisualTransitions() {
  let active = false;

  for (const n of graph.nodes) {
    const hoverTarget = graph.hover === n ? 1 : 0;
    const currentTarget = isCurrent(n) ? 1 : 0;
    const matchTarget = isSearchMatch(n) ? 1 : 0;
    const dimTarget = nodeDimmed(n) ? 1 : 0;
    const birthTarget = 0;

    const nextHover = lerpValue(n.hoverT || 0, hoverTarget);
    const nextCurrent = lerpValue(n.currentT || 0, currentTarget);
    const nextMatch = lerpValue(n.matchT || 0, matchTarget);
    const nextDim = lerpValue(n.dimT || 0, dimTarget);
    const nextBirth = lerpValue(n.birthT || 0, birthTarget, 0.17);

    if (
      Math.abs(nextHover - (n.hoverT || 0)) > VISUAL_EPS ||
      Math.abs(nextCurrent - (n.currentT || 0)) > VISUAL_EPS ||
      Math.abs(nextMatch - (n.matchT || 0)) > VISUAL_EPS ||
      Math.abs(nextDim - (n.dimT || 0)) > VISUAL_EPS ||
      Math.abs(nextBirth - (n.birthT || 0)) > VISUAL_EPS
    ) {
      active = true;
    }

    n.hoverT = Math.abs(nextHover - hoverTarget) < VISUAL_EPS ? hoverTarget : nextHover;
    n.currentT = Math.abs(nextCurrent - currentTarget) < VISUAL_EPS ? currentTarget : nextCurrent;
    n.matchT = Math.abs(nextMatch - matchTarget) < VISUAL_EPS ? matchTarget : nextMatch;
    n.dimT = Math.abs(nextDim - dimTarget) < VISUAL_EPS ? dimTarget : nextDim;
    n.birthT = Math.abs(nextBirth - birthTarget) < VISUAL_EPS ? birthTarget : nextBirth;
  }

  for (const l of graph.links) {
    const target = linkDimmed(l) ? 1 : 0;
    const next = lerpValue(l.dimT || 0, target);

    if (Math.abs(next - (l.dimT || 0)) > VISUAL_EPS) {
      active = true;
    }

    l.dimT = Math.abs(next - target) < VISUAL_EPS ? target : next;
  }

  return active;
}

function drawPos(node) {
  return {
    x: node.x,
    y: node.y,
  };
}

// ------------------------------------------------------------
// Drawing
// ------------------------------------------------------------

function escapeSvgAttr(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function iconImage(name, color, size = 28) {
  const cleanName = name || 'square';
  const cleanColor = color || '#d8dee9';
  const key = `${cleanName}|${cleanColor}|${size}`;

  const cached = iconCache.get(key);

  if (cached) {
    return cached.ready ? cached.img : null;
  }

  const img = new Image();

  let svg = lucide(cleanName, size);

  svg = svg.replace(/stroke="currentColor"/g, `stroke="${escapeSvgAttr(cleanColor)}"`);
  svg = svg.replace(/<svg /, `<svg color="${escapeSvgAttr(cleanColor)}" `);

  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  const rec = { img, ready: false };
  iconCache.set(key, rec);

  img.onload = () => {
    rec.ready = true;
    startVisualLoop();
  };

  img.onerror = () => {
    iconCache.delete(key);
  };

  img.src = url;

  return null;
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);

  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

function focusSet() {
  if (!graph.showFolders || !graph.focusFolderId) return null;
  return graph.descendantsByFolder.get(graph.focusFolderId) || null;
}

// Deep search: title, subtitle, folder, tags, AND note body when enabled.
function isSearchMatch(node) {
  const q = graph.highlight.trim().toLowerCase();
  if (!q) return false;

  const base = [
    node.title || '',
    node.subtitle || '',
    node.type || '',
  ].join(' ').toLowerCase();

  if (base.includes(q)) return true;

  if (!graph.deepSearch) return false;

  if (node.type === NODE.NOTE) {
    const note = state.notes.get(node.id);
    if (!note) return false;

    // Tags + folder full path.
    const tags = (note.tags || []).join(' ').toLowerCase();
    if (tags && tags.includes(q)) return true;

    // Search index is precomputed lowercase title+tags+body.
    const indexed = state.searchIndex?.get(note.id);
    if (indexed && indexed.includes(q)) return true;

    // Fallback: read body directly (rare; only if index is missing).
    if (!indexed) {
      try {
        const body = noteMarkdown(note.id) || '';
        if (body.toLowerCase().includes(q)) return true;
      } catch {}
    }

    return false;
  }

  // Folder: include folder name and full path; also match if any
  // descendant note matches in deep search.
  if (node.type === NODE.FOLDER) {
    const path = folderPath(node.id).join(' / ').toLowerCase();
    if (path.includes(q)) return true;

    const descendants = graph.descendantsByFolder.get(node.id);
    if (!descendants) return false;

    for (const gid of descendants) {
      if (!gid.startsWith('note:')) continue;
      const idx = graph.idIndex.get(gid);
      if (idx == null) continue;
      const child = graph.nodes[idx];
      if (child && isSearchMatch(child)) return true;
    }
  }

  return false;
}

function isCurrent(node) {
  return node.type === NODE.NOTE && node.id === state.currentNoteId;
}

function isHoverConnected(node) {
  if (!graph.hover) return false;

  const hi = graph.idIndex.get(graph.hover.gid);
  const ni = graph.idIndex.get(node.gid);

  if (hi == null || ni == null) return false;
  if (hi === ni) return true;

  return graph.adj.get(hi)?.has(ni) || false;
}

function nodeDimmed(node) {
  const fs = focusSet();

  if (fs && !fs.has(node.gid) && !isSearchMatch(node) && !isCurrent(node) && !isHoverConnected(node)) {
    return true;
  }

  if (graph.hover && !isHoverConnected(node) && !isSearchMatch(node) && !isCurrent(node)) {
    return true;
  }

  const q = graph.highlight.trim();

  if (q && !isSearchMatch(node) && !isCurrent(node) && !isHoverConnected(node)) {
    return true;
  }

  return false;
}

function linkDimmed(link) {
  const a = graph.nodes[link.a];
  const b = graph.nodes[link.b];

  const fs = focusSet();

  if (fs && !fs.has(a.gid) && !fs.has(b.gid)) return true;

  if (graph.hover) {
    return graph.hover !== a && graph.hover !== b;
  }

  const q = graph.highlight.trim();

  if (q) {
    return !isSearchMatch(a) && !isSearchMatch(b) && !isCurrent(a) && !isCurrent(b);
  }

  return false;
}

function drawSingleLine(ctx, ax, ay, bx, by, offset = 0) {
  if (offset === 0) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    return;
  }

  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;

  // Perpendicular unit vector.
  const nx = -dy / len;
  const ny = dx / len;

  ctx.beginPath();
  ctx.moveTo(ax + nx * offset, ay + ny * offset);
  ctx.lineTo(bx + nx * offset, by + ny * offset);
  ctx.stroke();
}

function drawLink(ctx, link, t) {
  const a = graph.nodes[link.a];
  const b = graph.nodes[link.b];

  const ap = drawPos(a);
  const bp = drawPos(b);

  const dimT = link.dimT || 0;

  let color = t.border;
  let alpha = 0.55 * (1 - dimT) + 0.10 * dimT;
  let width = 1.15;

  if (link.kind === LINK.SEMANTIC) {
    const closeness = link.semanticCloseness ?? 0.35;

    color = t.accent2;
    alpha = (0.14 + closeness * 0.22) * (1 - dimT) + 0.045 * dimT;
    width = 0.75 + closeness * 0.85;

    const dash = 2.2 / graph.scale;
    const gap = (9 - closeness * 4) / graph.scale;

    ctx.setLineDash([dash, gap]);
  } else if (link.kind === LINK.WIKI) {
    const count = link.count || 1;
    color = t.accent;
    // Higher-count wiki links are slightly brighter and thicker.
    alpha = Math.min(0.92, 0.58 + Math.log2(count + 1) * 0.07) * (1 - dimT) + 0.12 * dimT;
    width = 1.35 + Math.min(1.4, Math.log2(count + 1) * 0.35);
    ctx.setLineDash([]);
  } else if (link.kind === LINK.FOLDER) {
    color = t.textFaint;
    alpha = 0.24 * (1 - dimT) + 0.06 * dimT;
    width = 0.95;
    ctx.setLineDash([5 / graph.scale, 6 / graph.scale]);
  } else if (link.kind === LINK.CONTAINS) {
    color = t.borderStrong;
    alpha = 0.20 * (1 - dimT) + 0.05 * dimT;
    width = 0.9;
    ctx.setLineDash([3 / graph.scale, 7 / graph.scale]);
  }

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width / graph.scale;

  if (link.kind === LINK.WIKI && (link.count || 1) >= 2) {
    // Render as a doubled line: two parallel strokes around the centerline.
    // Spacing scales mildly with count up to a cap so it stays readable.
    const count = link.count || 1;
    const spacing = (2.2 + Math.min(2.4, Math.log2(count) * 1.0)) / graph.scale;

    drawSingleLine(ctx, ap.x, ap.y, bp.x, bp.y, spacing / 2);
    drawSingleLine(ctx, ap.x, ap.y, bp.x, bp.y, -spacing / 2);

    // For 3+ references add a faint center stroke so the bundle reads as bundled.
    if (count >= 3) {
      ctx.globalAlpha = alpha * 0.55;
      ctx.lineWidth = (width * 0.55) / graph.scale;
      drawSingleLine(ctx, ap.x, ap.y, bp.x, bp.y, 0);
    }
  } else {
    drawSingleLine(ctx, ap.x, ap.y, bp.x, bp.y, 0);
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawNode(ctx, node, t) {
  const p = drawPos(node);

  const hoverT = node.hoverT || 0;
  const currentT = node.currentT || 0;
  const matchT = node.matchT || 0;
  const dimT = node.dimT || 0;
  const birthT = node.birthT || 0;

  const connectivity =
    node.type === NODE.NOTE
      ? (node.wikiDegree || node.degree || (graph.showSemantic ? (node.semanticDegree || 0) * 0.55 : 0))
      : node.degree;

  const baseR =
    node.type === NODE.FOLDER
      ? (node.isTopLevelFolder ? 24 : 15) + Math.min(
          node.isTopLevelFolder ? 8 : 5,
          Math.sqrt(connectivity || 0) * (node.isTopLevelFolder ? 1.6 : 1.2)
        )
      : 12 + Math.min(5, Math.sqrt(connectivity || 0) * 1.35);

  const r =
    baseR +
    currentT * 4 +
    hoverT * 3 +
    matchT * 2 +
    birthT * 7;

  const hitR = baseR + 9;
  const color = node.color || (node.type === NODE.FOLDER ? t.textDim : t.text);

  node.radius = r;
  node.hitRadius = hitR;

  ctx.save();

  ctx.globalAlpha = (1 - dimT * 0.68) * (1 - birthT * 0.28);

  if (birthT > 0.02) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 12 * birthT, 0, Math.PI * 2);
    ctx.strokeStyle = node.type === NODE.FOLDER ? t.textDim : t.accent;
    ctx.globalAlpha = 0.35 * birthT;
    ctx.lineWidth = 1.8 / graph.scale;
    ctx.stroke();
    ctx.globalAlpha = (1 - dimT * 0.68) * (1 - birthT * 0.28);
  }

  if (hoverT > 0.02 || currentT > 0.02 || matchT > 0.02 || birthT > 0.02) {
    ctx.shadowColor = currentT > 0.3 ? t.accent : color;
    ctx.shadowBlur = 4 + hoverT * 14 + currentT * 8 + matchT * 7 + birthT * 10;
  }

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle =
    node.type === NODE.FOLDER
      ? (node.isTopLevelFolder ? t.bgElev2 : t.bgElev3)
      : t.bgElev2;
  ctx.fill();

  ctx.shadowBlur = 0;

  ctx.strokeStyle =
    currentT > 0.1 || matchT > 0.1
      ? t.accent
      : color;

  ctx.lineWidth = (
    currentT > 0.1
      ? 2.8
      : node.type === NODE.FOLDER
        ? (node.isTopLevelFolder ? 2.3 : 1.45)
        : 1.45
  ) / graph.scale;

  ctx.globalAlpha = (1 - dimT * 0.55) * (1 - birthT * 0.18);
  ctx.stroke();

  if (node.type === NODE.NOTE && graph.showSemantic && node.semanticDegree && !node.wikiDegree) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = t.accent2;
    ctx.globalAlpha = (0.28 + hoverT * 0.22) * (1 - dimT * 0.65);
    ctx.lineWidth = 0.9 / graph.scale;
    ctx.setLineDash([2 / graph.scale, 5 / graph.scale]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = (1 - dimT * 0.68) * (1 - birthT * 0.18);

  if (node.pinned) {
    ctx.beginPath();
    ctx.arc(p.x + r * 0.58, p.y - r * 0.58, Math.max(2.2, r * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = t.yellow;
    ctx.fill();
  }

  const iconSize =
    node.type === NODE.FOLDER
      ? (node.isTopLevelFolder ? 30 : 22)
      : 20;

  const img = iconImage(node.icon || 'square', color, 28);

  if (img) {
    ctx.drawImage(
      img,
      p.x - iconSize / 2,
      p.y - iconSize / 2,
      iconSize,
      iconSize
    );
  } else {
    const s = iconSize * 0.72;
    roundedRect(ctx, p.x - s / 2, p.y - s / 2, s, s, 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / graph.scale;
    ctx.stroke();
  }

  const showLabel =
    graph.scale > 0.62 ||
    hoverT > 0.04 ||
    currentT > 0.04 ||
    matchT > 0.04 ||
    node.type === NODE.FOLDER;

  if (showLabel) {
    const label = node.title.length > 34 ? node.title.slice(0, 34) + '…' : node.title;

    const fontSize = Math.max(
      node.isTopLevelFolder ? 11 : 9,
      (node.isTopLevelFolder ? 13 : 11) / Math.sqrt(graph.scale)
    );

    ctx.font = `${node.isTopLevelFolder ? '600 ' : ''}${fontSize.toFixed(1)}px ${t.font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const x = p.x + r + 7;
    const y = p.y;

    const metrics = ctx.measureText(label);
    const padX = 5;
    const padY = 3;

    ctx.globalAlpha = (0.76 + hoverT * 0.14 + currentT * 0.12) * (1 - dimT * 0.75);

    roundedRect(
      ctx,
      x - padX,
      y - fontSize / 2 - padY,
      metrics.width + padX * 2,
      fontSize + padY * 2,
      5
    );

    ctx.fillStyle = t.bg;
    ctx.fill();

    ctx.globalAlpha = (1 - dimT * 0.62);
    ctx.fillStyle =
      currentT > 0.2
        ? t.accent
        : node.type === NODE.FOLDER
          ? color
          : t.text;

    ctx.fillText(label, x, y);

    if ((hoverT > 0.15 || matchT > 0.15) && node.subtitle) {
      const sub = node.subtitle.length > 42 ? node.subtitle.slice(0, 42) + '…' : node.subtitle;
      const subFont = Math.max(8, 9 / Math.sqrt(graph.scale));

      ctx.font = `${subFont.toFixed(1)}px ${t.font}`;
      ctx.globalAlpha = Math.max(hoverT, matchT) * (1 - dimT * 0.6);
      ctx.fillStyle = t.textFaint;
      ctx.fillText(sub, x, y + fontSize + 4);

      if (node.type === NODE.NOTE && graph.showSemantic && node.semanticDegree) {
        ctx.fillStyle = t.accent2;
        ctx.fillText(
          `${node.semanticDegree} semantic suggestion${node.semanticDegree === 1 ? '' : 's'}`,
          x,
          y + fontSize + subFont + 9
        );
      }
    }
  }

  ctx.restore();
}

function drawGraph() {
  const c = graph.canvas;
  const ctx = graph.ctx;

  if (!c || !ctx) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const t = theme();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);

  ctx.setTransform(
    graph.scale * dpr,
    0,
    0,
    graph.scale * dpr,
    graph.ox * dpr,
    graph.oy * dpr
  );

  for (const kind of [LINK.SEMANTIC, LINK.FOLDER, LINK.CONTAINS, LINK.WIKI]) {
    for (const l of graph.links) {
      if (l.kind === kind) drawLink(ctx, l, t);
    }
  }

  const ordered = [...graph.nodes].sort((a, b) => {
    const ia =
      (isCurrent(a) ? 10 : 0) +
      (graph.hover === a ? 8 : 0) +
      (isSearchMatch(a) ? 6 : 0) +
      (a.isTopLevelFolder ? 2 : 0);

    const ib =
      (isCurrent(b) ? 10 : 0) +
      (graph.hover === b ? 8 : 0) +
      (isSearchMatch(b) ? 6 : 0) +
      (b.isTopLevelFolder ? 2 : 0);

    return ia - ib;
  });

  for (const n of ordered) {
    drawNode(ctx, n, t);
  }
}

// ------------------------------------------------------------
// Interaction helpers
// ------------------------------------------------------------

function nodeAt(x, y) {
  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    const n = graph.nodes[i];
    const r = n.hitRadius || n.radius || n.physicsRadius || 12;

    if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) {
      return n;
    }
  }

  return null;
}

function canvasCoords(e) {
  const r = graph.canvas.getBoundingClientRect();

  return {
    x: (e.clientX - r.left - graph.ox) / graph.scale,
    y: (e.clientY - r.top - graph.oy) / graph.scale,
  };
}

function centerOnNode(node, scale = Math.max(1.15, graph.scale), { animated = true } = {}) {
  const { w, h } = canvasCssSize();

  const targetScale = Math.max(0.25, Math.min(4.5, scale));
  const targetOx = w / 2 - node.x * targetScale;
  const targetOy = h / 2 - node.y * targetScale;

  if (!animated) {
    graph.viewTween = null;
    graph.scale = targetScale;
    graph.ox = targetOx;
    graph.oy = targetOy;
    startVisualLoop();
    return;
  }

  graph.viewTween = {
    fromScale: graph.scale,
    fromOx: graph.ox,
    fromOy: graph.oy,
    toScale: targetScale,
    toOx: targetOx,
    toOy: targetOy,
    startTime: performance.now(),
    duration: VIEW_TRANSITION_MS,
  };

  startVisualLoop();
}

function recenterAll() {
  graph.viewTween = {
    fromScale: graph.scale,
    fromOx: graph.ox,
    fromOy: graph.oy,
    toScale: 1,
    toOx: 0,
    toOy: 0,
    startTime: performance.now(),
    duration: VIEW_TRANSITION_MS,
  };

  graph.focusFolderId = null;

  updateStats();
  startSimulation(0.45);
  startVisualLoop();
}

function clearLongPressTimer() {
  clearTimeout(graph.longPressTimer);
  graph.longPressTimer = 0;
}

// ------------------------------------------------------------
// Note preview popover
// ------------------------------------------------------------

function ensurePreviewPopover() {
  injectGraphCss();

  if (previewEl) return previewEl;

  previewEl = document.createElement('div');
  previewEl.className = 'yanta-graph-note-preview';
  previewEl.hidden = true;
  document.body.append(previewEl);

  document.addEventListener('mousedown', (e) => {
    if (previewEl?.hidden) return;
    if (previewEl.contains(e.target)) return;
    if (e.target === graph.canvas) return;
    hideNodePreview();
  }, true);

  return previewEl;
}

function hideNodePreview() {
  if (previewEl) previewEl.hidden = true;
}

function positionFloatingElement(elm, x, y) {
  elm.hidden = false;

  requestAnimationFrame(() => {
    const r = elm.getBoundingClientRect();

    let left = x + 14;
    let top = y + 14;

    if (left + r.width > window.innerWidth - 10) {
      left = x - r.width - 14;
    }

    if (top + r.height > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - r.height - 10);
    }

    if (left < 10) left = 10;
    if (top < 10) top = 10;

    elm.style.left = left + 'px';
    elm.style.top = top + 'px';
  });
}

function showNodePreview(node, clientX, clientY) {
  if (!node || node.type !== NODE.NOTE) return;

  hideContextMenu();

  const note = state.notes.get(node.id);
  if (!note) return;

  const pop = ensurePreviewPopover();

  let body = '';

  try {
    body = noteMarkdown(note.id) || '';
  } catch {}

  const bodyHtml = body.trim()
    ? `<article class="preview">${renderPreview(body)}</article>`
    : `<div class="yanta-graph-empty-preview">Empty note.</div>`;

  const folder = noteFolderLabel(note);

  pop.innerHTML = `
    <div class="yanta-graph-note-preview-head">
      <span class="yanta-graph-note-preview-icon">${lucide(note.icon || (note.type === 'list' ? 'list' : 'file'), 16)}</span>
      <div style="min-width:0;flex:1">
        <div class="yanta-graph-note-preview-title">${escapeHtml(note.title || 'Untitled')}</div>
        <div class="yanta-graph-note-preview-meta">${escapeHtml(folder)}</div>
      </div>
      <div class="yanta-graph-note-preview-actions">
        <button class="btn" data-graph-open-note>${lucide('file-text', 13)} Open</button>
        <button class="icon-btn" data-graph-close-preview title="Close">✕</button>
      </div>
    </div>
    <div class="yanta-graph-note-preview-body">
      ${bodyHtml}
    </div>
  `;

  pop.querySelector('[data-graph-open-note]')?.addEventListener('click', async () => {
    hideNodePreview();
    if (graph.mode === 'overlay') closeGraph();
    await openNote(note.id);
  });

  pop.querySelector('[data-graph-close-preview]')?.addEventListener('click', hideNodePreview);

  positionFloatingElement(pop, clientX, clientY);
}

// ------------------------------------------------------------
// Context menus
// ------------------------------------------------------------

function hideContextMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
}

function ensureContextMenuCloseHandlers() {
  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) hideContextMenu();
  }, true);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });
}

function folderLabelForContext(folderId) {
  if (!folderId) return 'root';
  const f = state.folders.get(folderId);
  return f?.name || 'folder';
}

function buildMenuButton(action, iconName, label, opts = {}) {
  const btn = document.createElement('button');
  if (opts.danger) btn.className = 'danger';
  btn.dataset.action = action;
  btn.innerHTML = `${lucide(iconName, 14)} <span>${escapeHtml(label)}</span>`;
  return btn;
}

function showNodeContextMenu(node, clientX, clientY) {
  if (!node) return;

  injectGraphCss();
  hideNodePreview();
  hideContextMenu();

  menuEl = document.createElement('div');
  menuEl.className = 'yanta-graph-context-menu';

  if (node.type === NODE.NOTE) {
    const note = state.notes.get(node.id);
    if (!note) return;

    const parentFolderId = note.folderId || null;
    const folderLabel = folderLabelForContext(parentFolderId);

    const meta = document.createElement('div');
    meta.className = 'ctx-meta';
    meta.textContent = `Note in ${folderLabel}`;
    menuEl.append(meta);

    const open = buildMenuButton('open', 'file-text', 'Open note');
    open.addEventListener('click', async () => {
      hideContextMenu();
      if (graph.mode === 'overlay') closeGraph();
      await openNote(node.id);
    });
    menuEl.append(open);

    const editLook = buildMenuButton('icon', 'palette', 'Icon & color…');
    editLook.addEventListener('click', () => {
      hideContextMenu();
      editNoteAppearanceFromGraph(note);
    });
    menuEl.append(editLook);

    menuEl.append(document.createElement('hr'));

    const newNote = buildMenuButton('new-note', 'file-plus', 'New note in this folder');
    newNote.addEventListener('click', async () => {
      hideContextMenu();
      await createNoteFromGraph(node, parentFolderId);
    });
    menuEl.append(newNote);

    const newFolder = buildMenuButton('new-folder', 'folder-plus', 'New folder in this folder');
    newFolder.addEventListener('click', async () => {
      hideContextMenu();
      await createFolderFromGraph(node, parentFolderId);
    });
    menuEl.append(newFolder);
  } else if (node.type === NODE.FOLDER) {
    const folder = state.folders.get(node.id);
    if (!folder) return;

    const meta = document.createElement('div');
    meta.className = 'ctx-meta';
    meta.textContent = `Folder · ${folderPath(folder.id).join(' / ') || folder.name}`;
    menuEl.append(meta);

    const focusBtn = buildMenuButton(
      'focus',
      graph.focusFolderId === folder.id ? 'minimize-2' : 'maximize-2',
      graph.focusFolderId === folder.id ? 'Clear focus' : 'Focus this folder'
    );
    focusBtn.addEventListener('click', () => {
      hideContextMenu();
      graph.focusFolderId = graph.focusFolderId === folder.id ? null : folder.id;
      centerOnNode(node, Math.max(1.25, graph.scale));
      updateStats();
    });
    menuEl.append(focusBtn);

    const editLook = buildMenuButton('icon', 'palette', 'Icon & color…');
    editLook.addEventListener('click', () => {
      hideContextMenu();
      editFolderAppearanceFromGraph(folder);
    });
    menuEl.append(editLook);

    menuEl.append(document.createElement('hr'));

    const newNote = buildMenuButton('new-note', 'file-plus', 'New note in this folder');
    newNote.addEventListener('click', async () => {
      hideContextMenu();
      await createNoteFromGraph(node, folder.id);
    });
    menuEl.append(newNote);

    const newSub = buildMenuButton('new-folder', 'folder-plus', 'New sub-folder');
    newSub.addEventListener('click', async () => {
      hideContextMenu();
      await createFolderFromGraph(node, folder.id);
    });
    menuEl.append(newSub);
  }

  document.body.append(menuEl);
  positionFloatingElement(menuEl, clientX, clientY);
}

function showEmptyContextMenu(clientX, clientY) {
  injectGraphCss();
  hideNodePreview();
  hideContextMenu();

  menuEl = document.createElement('div');
  menuEl.className = 'yanta-graph-context-menu';

  const meta = document.createElement('div');
  meta.className = 'ctx-meta';
  meta.textContent = 'In root';
  menuEl.append(meta);

  const newNote = buildMenuButton('new-note', 'file-plus', 'New root note');
  newNote.addEventListener('click', async () => {
    hideContextMenu();
    await createRootEntity('note', clientX, clientY);
  });
  menuEl.append(newNote);

  const newFolder = buildMenuButton('new-folder', 'folder-plus', 'New root folder');
  newFolder.addEventListener('click', async () => {
    hideContextMenu();
    await createRootEntity('folder', clientX, clientY);
  });
  menuEl.append(newFolder);

  menuEl.append(document.createElement('hr'));

  const recenter = buildMenuButton('recenter', 'crosshair', 'Recenter view');
  recenter.addEventListener('click', () => {
    hideContextMenu();
    recenterAll();
  });
  menuEl.append(recenter);

  document.body.append(menuEl);
  positionFloatingElement(menuEl, clientX, clientY);
}

function spawnNearNode(sourceNode, gid, distance = 46) {
  const angle = deterministicPhase(gid) + Math.PI * 0.15;
  graph.spawnPositions.set(gid, {
    x: sourceNode.x + Math.cos(angle) * distance,
    y: sourceNode.y + Math.sin(angle) * distance,
  });
}

function spawnAtClient(gid, clientX, clientY) {
  if (!graph.canvas) return;
  const r = graph.canvas.getBoundingClientRect();
  const x = (clientX - r.left - graph.ox) / graph.scale;
  const y = (clientY - r.top - graph.oy) / graph.scale;
  graph.spawnPositions.set(gid, { x, y });
}

async function createNoteFromGraph(sourceNode, folderId) {
  const title = prompt('Note title:', 'Untitled');
  if (title === null) return;

  const id = uid();

  const note = {
    id,
    title: title.trim() || 'Untitled',
    type: 'markdown',
    folderId: folderId || null,
    tags: [],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };

  state.notes.set(id, note);
  await store.notes.put(note);

  try {
    const entry = getNoteDoc(id);
    await entry.ready;
  } catch {}

  state.searchIndex.set(id, [note.title || '', ''].join(' ').toLowerCase());

  rebuildWikilinkIndex();

  if (folderId) state.expandedFolders.add(folderId);

  spawnNearNode(sourceNode, graphIdForNote(id), 48);

  renderTree();
  rebuildAndAnimateAfterMutation(0.9);

  toast('Note created', 'success');
}

async function createFolderFromGraph(sourceNode, parentId) {
  const name = prompt('Folder name:', 'New folder');
  if (name === null) return;

  const id = uid();

  const folder = {
    id,
    name: name.trim() || 'New folder',
    parentId: parentId || null,
    created: Date.now(),
  };

  state.folders.set(id, folder);
  await store.folders.put(folder);

  if (parentId) state.expandedFolders.add(parentId);
  state.expandedFolders.add(id);

  spawnNearNode(sourceNode, graphIdForFolder(id), 56);

  renderTree();
  rebuildAndAnimateAfterMutation(1.0);

  toast('Folder created', 'success');
}

async function createRootEntity(kind, clientX, clientY) {
  if (kind === 'note') {
    const title = prompt('Note title:', 'Untitled');
    if (title === null) return;

    const id = uid();
    const note = {
      id,
      title: title.trim() || 'Untitled',
      type: 'markdown',
      folderId: null,
      tags: [],
      pinned: false,
      created: Date.now(),
      updated: Date.now(),
    };

    state.notes.set(id, note);
    await store.notes.put(note);

    try {
      const entry = getNoteDoc(id);
      await entry.ready;
    } catch {}

    state.searchIndex.set(id, [note.title || '', ''].join(' ').toLowerCase());
    rebuildWikilinkIndex();

    spawnAtClient(graphIdForNote(id), clientX, clientY);

    renderTree();
    rebuildAndAnimateAfterMutation(0.9);

    toast('Note created', 'success');
    return;
  }

  if (kind === 'folder') {
    const name = prompt('Folder name:', 'New folder');
    if (name === null) return;

    const id = uid();
    const folder = {
      id,
      name: name.trim() || 'New folder',
      parentId: null,
      created: Date.now(),
    };

    state.folders.set(id, folder);
    await store.folders.put(folder);

    state.expandedFolders.add(id);

    spawnAtClient(graphIdForFolder(id), clientX, clientY);

    renderTree();
    rebuildAndAnimateAfterMutation(1.0);

    toast('Folder created', 'success');
  }
}

function rebuildAndAnimateAfterMutation(alpha = 0.8) {
  if (!graph.canvas || !graphVisible()) return;

  buildGraph();
  updateStats();
  refreshControlsUI();

  startSimulation(alpha);
  startVisualLoop();
}

// ------------------------------------------------------------
// Appearance editing from graph (with scope picker)
// ------------------------------------------------------------

function editNoteAppearanceFromGraph(note) {
  openIconPicker({
    title: `Icon & color: ${note.title || 'Untitled'}`,
    initialIcon: note.icon || (note.type === 'list' ? 'list' : 'file'),
    initialColor: note.color || '#6ea8fe',
    onApply: ({ icon, color }) => {
      pickScopeForNote(note, { icon, color });
    },
  });
}

function editFolderAppearanceFromGraph(folder) {
  openIconPicker({
    title: `Icon & color: ${folder.name || 'Folder'}`,
    initialIcon: folder.icon || 'folder',
    initialColor: folder.color || '#6ea8fe',
    onApply: ({ icon, color }) => {
      pickScopeForFolder(folder, { icon, color });
    },
  });
}

// Scope-picker modal: lets the user choose where to apply the change.
function openScopePicker({ title, options, onPick }) {
  injectGraphCss();

  const overlay = document.createElement('div');
  overlay.className = 'yanta-scope-modal';

  const card = document.createElement('div');
  card.className = 'yanta-scope-card';

  const head = document.createElement('div');
  head.className = 'yanta-scope-head';
  head.innerHTML = `<h3>${escapeHtml(title)}</h3>`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.title = 'Close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());
  head.append(closeBtn);

  const body = document.createElement('div');
  body.className = 'yanta-scope-body';

  for (const opt of options) {
    const b = document.createElement('button');
    b.className = 'yanta-scope-opt';
    if (opt.disabled) b.disabled = true;
    b.innerHTML = `
      <span class="yanta-scope-icon">${lucide(opt.icon || 'square', 16)}</span>
      <span>${escapeHtml(opt.label)}</span>
      ${opt.meta ? `<span class="yanta-scope-meta">${escapeHtml(opt.meta)}</span>` : ''}
    `;
    b.addEventListener('click', () => {
      overlay.remove();
      if (!opt.disabled) onPick(opt.value);
    });
    body.append(b);
  }

  card.append(head, body);
  overlay.append(card);
  document.body.append(overlay);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function pickScopeForNote(note, { icon, color }) {
  // For a note, scope options refer to its containing folder.
  const folderId = note.folderId || null;
  const siblings = folderId
    ? [...state.notes.values()].filter((n) => n.folderId === folderId && n.id !== note.id)
    : [...state.notes.values()].filter((n) => !n.folderId && n.id !== note.id);

  const folder = folderId ? state.folders.get(folderId) : null;
  const parents = collectAncestorFolders(folderId);

  openScopePicker({
    title: 'Apply icon & color to…',
    options: [
      {
        value: 'self',
        icon: 'file',
        label: 'Just this note',
      },
      {
        value: 'siblings',
        icon: 'files',
        label: folder ? `All notes in "${folder.name || 'folder'}"` : 'All root notes',
        meta: `${siblings.length + 1} note${siblings.length === 0 ? '' : 's'}`,
      },
      {
        value: 'parents',
        icon: 'folder-tree',
        label: 'This note and its parent folders',
        meta: parents.length ? `+${parents.length} folder${parents.length === 1 ? '' : 's'}` : '',
        disabled: parents.length === 0,
      },
    ],
    onPick: (scope) => applyAppearanceToNote(note, { icon, color }, scope),
  });
}

function pickScopeForFolder(folder, { icon, color }) {
  const directChildren = childFoldersOf(folder.id).length + notesInFolder(folder.id).length;
  const allDescendants = countAllDescendants(folder.id);
  const parents = collectAncestorFolders(folder.parentId);
  const siblings = [...state.folders.values()].filter(
    (f) => f.parentId === folder.parentId && f.id !== folder.id
  );

  openScopePicker({
    title: 'Apply icon & color to…',
    options: [
      {
        value: 'self',
        icon: 'folder',
        label: 'Just this folder',
      },
      {
        value: 'siblings',
        icon: 'folders',
        label: folder.parentId
          ? 'This folder and its sibling folders'
          : 'All root folders',
        meta: `${siblings.length + 1} folder${siblings.length === 0 ? '' : 's'}`,
      },
      {
        value: 'children',
        icon: 'corner-down-right',
        label: 'This folder and direct children',
        meta: directChildren ? `+${directChildren} item${directChildren === 1 ? '' : 's'}` : '',
        disabled: directChildren === 0,
      },
      {
        value: 'descendants',
        icon: 'folder-tree',
        label: 'This folder and everything inside',
        meta: allDescendants ? `+${allDescendants} item${allDescendants === 1 ? '' : 's'}` : '',
        disabled: allDescendants === 0,
      },
      {
        value: 'parents',
        icon: 'corner-up-left',
        label: 'This folder and its parent folders',
        meta: parents.length ? `+${parents.length} folder${parents.length === 1 ? '' : 's'}` : '',
        disabled: parents.length === 0,
      },
    ],
    onPick: (scope) => applyAppearanceToFolder(folder, { icon, color }, scope),
  });
}

function collectAncestorFolders(startId) {
  const out = [];
  const seen = new Set();
  let f = startId ? state.folders.get(startId) : null;
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    out.push(f);
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }
  return out;
}

function childFoldersOf(folderId) {
  return [...state.folders.values()].filter((f) => f.parentId === folderId);
}

function notesInFolder(folderId) {
  return [...state.notes.values()].filter((n) => n.folderId === folderId);
}

function countAllDescendants(folderId) {
  const folders = new Set();
  const notes = new Set();
  const stack = [folderId];

  while (stack.length) {
    const cur = stack.pop();
    for (const f of state.folders.values()) {
      if (f.parentId === cur && !folders.has(f.id)) {
        folders.add(f.id);
        stack.push(f.id);
      }
    }
    for (const n of state.notes.values()) {
      if (n.folderId === cur) notes.add(n.id);
    }
  }

  return folders.size + notes.size;
}

async function applyAppearanceToNote(note, { icon, color }, scope) {
  const applyTo = new Set();
  applyTo.add(`note:${note.id}`);

  if (scope === 'siblings') {
    const fid = note.folderId || null;
    for (const n of state.notes.values()) {
      if ((n.folderId || null) === fid) applyTo.add(`note:${n.id}`);
    }
  } else if (scope === 'parents') {
    const parents = collectAncestorFolders(note.folderId);
    for (const f of parents) applyTo.add(`folder:${f.id}`);
  }

  await applyAppearanceToTargets(applyTo, { icon, color });
}

async function applyAppearanceToFolder(folder, { icon, color }, scope) {
  const applyTo = new Set();
  applyTo.add(`folder:${folder.id}`);

  if (scope === 'siblings') {
    for (const f of state.folders.values()) {
      if ((f.parentId || null) === (folder.parentId || null)) applyTo.add(`folder:${f.id}`);
    }
  } else if (scope === 'children') {
    for (const f of childFoldersOf(folder.id)) applyTo.add(`folder:${f.id}`);
    for (const n of notesInFolder(folder.id)) applyTo.add(`note:${n.id}`);
  } else if (scope === 'descendants') {
    const stack = [folder.id];
    while (stack.length) {
      const cur = stack.pop();
      for (const f of state.folders.values()) {
        if (f.parentId === cur && !applyTo.has(`folder:${f.id}`)) {
          applyTo.add(`folder:${f.id}`);
          stack.push(f.id);
        }
      }
      for (const n of state.notes.values()) {
        if (n.folderId === cur) applyTo.add(`note:${n.id}`);
      }
    }
  } else if (scope === 'parents') {
    for (const f of collectAncestorFolders(folder.parentId)) applyTo.add(`folder:${f.id}`);
  }

  await applyAppearanceToTargets(applyTo, { icon, color });
}

async function applyAppearanceToTargets(targets, { icon, color }) {
  const writes = [];

  for (const key of targets) {
    const [kind, id] = key.split(':');

    if (kind === 'note') {
      const n = state.notes.get(id);
      if (!n) continue;

      if (icon === null && color === null) {
        delete n.icon;
        delete n.color;
      } else {
        if (icon != null) n.icon = icon;
        if (color != null) n.color = color;
      }

      n.updated = Date.now();
      writes.push(store.notes.put(n));
    } else if (kind === 'folder') {
      const f = state.folders.get(id);
      if (!f) continue;

      if (icon === null && color === null) {
        delete f.icon;
        delete f.color;
      } else {
        // Folder still shows folder-shaped icons by default in tree,
        // but in graph we honor any icon they choose.
        if (icon != null) f.icon = icon;
        if (color != null) f.color = color;
      }

      writes.push(store.folders.put(f));
    }
  }

  try {
    await Promise.all(writes);
  } catch {}

  renderTree();
  if (graphVisible()) {
    buildGraph();
    updateStats();
    startSimulation(0.3);
  }

  toast(`Updated ${targets.size} item${targets.size === 1 ? '' : 's'}`, 'success');
}

// ------------------------------------------------------------
// Controls panel
// ------------------------------------------------------------

function statsHtml() {
  const noteCount = graph.nodes.filter((n) => n.type === NODE.NOTE).length;
  const folderCount = graph.nodes.filter((n) => n.type === NODE.FOLDER).length;
  const wikiCount = graph.links.filter((l) => l.kind === LINK.WIKI).length;
  const semanticCount = graph.links.filter((l) => l.kind === LINK.SEMANTIC).length;

  const parts = [
    `<strong>${noteCount}</strong> notes`,
  ];

  if (graph.showFolders) parts.push(`<strong>${folderCount}</strong> folders`);
  parts.push(`<strong>${wikiCount}</strong> links`);
  if (graph.showSemantic) parts.push(`<strong>${semanticCount}</strong> semantic`);

  return parts.join('<span style="opacity:0.4">·</span>');
}

function statsEl() {
  if (graph.mode === 'pane') {
    return graph.paneHost?.querySelector('[data-graph-stats]') || null;
  }
  return document.querySelector('[data-graph-stats-overlay]');
}

function updateStats() {
  const el = statsEl();
  if (el) el.innerHTML = statsHtml();
}

function controlsEl() {
  if (graph.mode === 'pane') {
    return graph.paneHost?.querySelector('[data-graph-controls]') || null;
  }
  return document.querySelector('[data-graph-controls-overlay]');
}

function refreshControlsUI() {
  const el = controlsEl();
  if (!el) return;

  el.classList.toggle('collapsed', !graph.controlsOpen);

  const folderToggle = el.querySelector('[data-toggle="folders"]');
  if (folderToggle) folderToggle.classList.toggle('on', graph.showFolders);

  const semanticToggle = el.querySelector('[data-toggle="semantic"]');
  if (semanticToggle) semanticToggle.classList.toggle('on', graph.showSemantic);

  const deepToggle = el.querySelector('[data-toggle="deep"]');
  if (deepToggle) deepToggle.classList.toggle('on', graph.deepSearch);

  const paneToggle = el.querySelector('[data-toggle="pane"]');
  if (paneToggle) paneToggle.classList.toggle('on', graph.mode === 'pane');
}

function buildControlsPanel({ paneMode = false } = {}) {
  injectGraphCss();

  const wrap = document.createElement('div');
  wrap.className = 'yanta-graph-controls' + (graph.controlsOpen ? '' : ' collapsed');
  if (paneMode) wrap.setAttribute('data-graph-controls', '');
  else wrap.setAttribute('data-graph-controls-overlay', '');

  wrap.innerHTML = `
    <div class="yanta-graph-controls-head" data-controls-toggle>
      <span class="gc-chev">${lucide('sliders-horizontal', 14)}</span>
      <span class="gc-title">Graph controls</span>
      <span class="gc-chev">${lucide(graph.controlsOpen ? 'chevron-up' : 'chevron-down', 13)}</span>
    </div>
    <div class="yanta-graph-controls-body">
      <div class="gc-group gc-search-row">
        <div class="gc-group-title">Search</div>
        <input type="search" data-graph-search placeholder="Highlight notes…" value="${escapeHtml(graph.highlight || '')}" />
        <div class="gc-toggle ${graph.deepSearch ? 'on' : ''}" data-toggle="deep">
          <span class="gc-label">${lucide('zoom-in', 13)} Deep search (in note text)</span>
          <span class="gc-switch"></span>
        </div>
      </div>

      <div class="gc-group">
        <div class="gc-group-title">Layers</div>
        <div class="gc-toggle ${graph.showFolders ? 'on' : ''}" data-toggle="folders">
          <span class="gc-label">${lucide('folder', 13)} Show folders</span>
          <span class="gc-switch"></span>
        </div>
        <div class="gc-toggle ${graph.showSemantic ? 'on' : ''}" data-toggle="semantic">
          <span class="gc-label">${lucide('sparkles', 13)} Semantic suggestions</span>
          <span class="gc-switch"></span>
        </div>
      </div>

      <div class="gc-group">
        <div class="gc-group-title">View</div>
        <button class="gc-action" data-action="recenter">${lucide('crosshair', 13)} Recenter</button>
        ${graph.mode === 'overlay'
          ? `<div class="gc-toggle" data-toggle="pane"><span class="gc-label">${lucide('panel-right', 13)} Show in side pane</span><span class="gc-switch"></span></div>`
          : `<button class="gc-action" data-action="exit-pane">${lucide('x', 13)} Exit pane mode</button>`
        }
      </div>

      <div class="gc-hint">
        Tip: middle-click to pan · right-click for context menu · double-click a note to open.
      </div>
    </div>
  `;

  wrap.querySelector('[data-controls-toggle]').addEventListener('click', () => {
    graph.controlsOpen = !graph.controlsOpen;
    writeBoolPref(GRAPH_CONTROLS_OPEN_KEY, graph.controlsOpen);
    refreshControlsUI();
    // Re-render the chevron icon.
    const head = wrap.querySelector('[data-controls-toggle]');
    const chevs = head.querySelectorAll('.gc-chev');
    if (chevs.length >= 2) {
      chevs[chevs.length - 1].innerHTML = lucide(graph.controlsOpen ? 'chevron-up' : 'chevron-down', 13);
    }
  });

  wrap.querySelector('[data-graph-search]').addEventListener('input', (e) => {
    graph.highlight = e.target.value || '';
    startVisualLoop();
  });

  wrap.querySelector('[data-toggle="deep"]').addEventListener('click', (e) => {
    e.stopPropagation();
    graph.deepSearch = !graph.deepSearch;
    writeBoolPref(GRAPH_DEEP_SEARCH_KEY, graph.deepSearch);
    refreshControlsUI();
    startVisualLoop();
  });

  wrap.querySelector('[data-toggle="folders"]').addEventListener('click', () => {
    graph.showFolders = !graph.showFolders;
    writeBoolPref(GRAPH_PREFS_KEY, graph.showFolders);

    graph.focusFolderId = null;
    graph.hover = null;

    refreshControlsUI();
    buildGraph();
    updateStats();
    startSimulation(BUILD_ALPHA);
  });

  wrap.querySelector('[data-toggle="semantic"]').addEventListener('click', () => {
    graph.showSemantic = !graph.showSemantic;
    writeBoolPref(GRAPH_SEMANTIC_PREFS_KEY, graph.showSemantic);

    graph.hover = null;

    refreshControlsUI();
    buildGraph();
    updateStats();
    startSimulation(graph.showSemantic ? 1 : 0.55);
  });

  wrap.querySelector('[data-action="recenter"]')?.addEventListener('click', recenterAll);

  const paneToggle = wrap.querySelector('[data-toggle="pane"]');
  if (paneToggle) {
    paneToggle.addEventListener('click', () => {
      openGraphPane();
    });
  }

  const exitPane = wrap.querySelector('[data-action="exit-pane"]');
  if (exitPane) {
    exitPane.addEventListener('click', () => closeGraphPane());
  }

  return wrap;
}

// ------------------------------------------------------------
// Canvas mount / resize / pane mode
// ------------------------------------------------------------

function activateCanvas(canvas, mode) {
  graph.canvas = canvas;
  graph.ctx = canvas?.getContext('2d') || null;
  graph.mode = mode;

  if (canvas) {
    bindGraphCanvas(canvas);
    resizeGraphCanvas();
  }
}

function resizeGraphCanvas() {
  if (!graph.canvas) return;

  const wrap =
    graph.mode === 'pane'
      ? graph.paneHost?.querySelector('.graph-canvas-wrap')
      : $('graphCanvasWrap');

  if (!wrap) return;

  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  graph.canvas.width = Math.max(1, Math.floor(r.width * dpr));
  graph.canvas.height = Math.max(1, Math.floor(r.height * dpr));
  graph.canvas.style.width = r.width + 'px';
  graph.canvas.style.height = r.height + 'px';

  startVisualLoop();
}

function forceSplitViewForPane() {
  const app = $('app');
  if (!app) return;

  state.view = 'split';
  app.dataset.view = 'split';

  $('btn-view-edit')?.classList.toggle('active', false);
  $('btn-view-split')?.classList.toggle('active', true);
  $('btn-view-preview')?.classList.toggle('active', false);

  store.settings.set('view', 'split');
}

function openGraphPane() {
  if (window.innerWidth < WIDE_PANE_MIN_WIDTH) {
    toast('Graph pane is available on wider screens', 'error');
    return;
  }

  injectGraphCss();

  const pane = $('panePreview');
  if (!pane) return;

  closeGraph();

  forceSplitViewForPane();
  closeGraphPane({ silent: true });

  graph.preferPane = true;
  writeBoolPref(GRAPH_PANE_PREFS_KEY, true);

  graph.paneHiddenChildren = [...pane.children].map((child) => ({
    child,
    display: child.style.display,
  }));

  for (const { child } of graph.paneHiddenChildren) {
    child.style.display = 'none';
  }

  pane.classList.add('yanta-graph-pane-active');

  const host = document.createElement('div');
  host.className = 'yanta-graph-pane-host';
  host.innerHTML = `
    <div class="graph-head">
      <strong>Graph</strong>
      <span class="grow"></span>
      <button class="icon-btn" data-graph-pane-close title="Close pane graph">✕</button>
    </div>
    <div class="graph-canvas-wrap">
      <canvas class="graph-canvas" data-graph-pane-canvas></canvas>
      <div class="yanta-graph-stats" data-graph-stats></div>
    </div>
  `;

  pane.append(host);

  graph.paneHost = host;
  graph.paneCanvas = host.querySelector('[data-graph-pane-canvas]');

  // Mount the controls panel inside the canvas wrap.
  const canvasWrap = host.querySelector('.graph-canvas-wrap');
  canvasWrap.append(buildControlsPanel({ paneMode: true }));

  host.querySelector('[data-graph-pane-close]')?.addEventListener('click', () => closeGraphPane());

  activateCanvas(graph.paneCanvas, 'pane');

  graph.scale = 1;
  graph.ox = 0;
  graph.oy = 0;
  graph.highlight = '';
  graph.focusFolderId = null;
  graph.hover = null;

  buildGraph();
  updateStats();
  refreshControlsUI();

  startSimulation(BUILD_ALPHA);
  startVisualLoop();
}

function closeGraphPane({ silent = false } = {}) {
  if (!graph.paneHost) return;

  stopSimulation();
  hideNodePreview();
  hideContextMenu();

  const pane = $('panePreview');

  for (const { child, display } of graph.paneHiddenChildren) {
    child.style.display = display;
  }

  graph.paneHiddenChildren = [];

  graph.paneHost.remove();
  graph.paneHost = null;
  graph.paneCanvas = null;

  pane?.classList.remove('yanta-graph-pane-active');

  if (graph.mode === 'pane') {
    graph.canvas = null;
    graph.ctx = null;
    graph.mode = 'overlay';
  }

  if (!silent) {
    graph.preferPane = false;
    writeBoolPref(GRAPH_PANE_PREFS_KEY, false);
  }
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

function ensureOverlayChrome() {
  injectGraphCss();

  const wrap = $('graphCanvasWrap');
  if (!wrap) return;

  // Hide the legacy legend if present — we replace it with the slim stats badge.
  const legacyLegend = $('graphLegend');
  if (legacyLegend) legacyLegend.style.display = 'none';

  // Slim stats badge.
  if (!wrap.querySelector('[data-graph-stats-overlay]')) {
    const stats = document.createElement('div');
    stats.className = 'yanta-graph-stats';
    stats.setAttribute('data-graph-stats-overlay', '');
    wrap.append(stats);
  }

  // Controls panel.
  if (!wrap.querySelector('[data-graph-controls-overlay]')) {
    wrap.append(buildControlsPanel({ paneMode: false }));
  }

  // Hide the legacy header search field if present, since controls panel has its own.
  const legacySearch = $('graphSearch');
  if (legacySearch) legacySearch.style.display = 'none';
}

export function openGraph() {
  injectGraphCss();

  if (graph.preferPane && window.innerWidth >= WIDE_PANE_MIN_WIDTH) {
    openGraphPane();
    return;
  }

  closeGraphPane({ silent: true });

  const overlay = $('graphOverlay');
  if (!overlay) return;

  overlay.hidden = false;

  ensureOverlayChrome();

  const c = $('graphCanvas');

  graph.overlayCanvas = c;
  activateCanvas(c, 'overlay');

  graph.scale = 1;
  graph.ox = 0;
  graph.oy = 0;
  graph.highlight = '';
  graph.focusFolderId = null;
  graph.hover = null;

  buildGraph();
  updateStats();
  refreshControlsUI();

  startSimulation(BUILD_ALPHA);
  startVisualLoop();
}

export function closeGraph() {
  if (graph.mode !== 'overlay') return;

  stopSimulation();
  hideNodePreview();
  hideContextMenu();

  if (graph.visualRaf) {
    cancelAnimationFrame(graph.visualRaf);
    graph.visualRaf = 0;
  }

  const overlay = $('graphOverlay');
  if (overlay) overlay.hidden = true;

  graph.canvas = null;
  graph.ctx = null;
}

// ------------------------------------------------------------
// Interaction binding
// ------------------------------------------------------------

function bindGraphCanvas(c) {
  if (!c || boundCanvases.has(c)) return;
  boundCanvases.add(c);

  c.addEventListener('pointerdown', (e) => {
    if (!graph.canvas || c !== graph.canvas || !graphVisible()) return;

    hideContextMenu();
    // Any user-initiated interaction cancels a running view tween so
    // the view immediately responds.
    graph.viewTween = null;

    graph.pointerId = e.pointerId;
    graph.pressMx = e.clientX;
    graph.pressMy = e.clientY;
    graph.moved = 0;
    graph.longPressFired = false;
    graph.suppressNextClick = false;
    graph.panningButton = e.button;

    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    // Middle mouse button → always pan, regardless of what is under it.
    if (e.button === 1) {
      e.preventDefault();
      hideNodePreview();
      graph.panning = true;
      graph.dragMx = e.clientX;
      graph.dragMy = e.clientY;
      c.classList.add('dragging');
      c.setPointerCapture?.(e.pointerId);
      startVisualLoop();
      return;
    }

    // Right-click / secondary pointer.
    if (e.button === 2) {
      e.preventDefault();
      if (hit) {
        showNodeContextMenu(hit, e.clientX, e.clientY);
      } else {
        showEmptyContextMenu(e.clientX, e.clientY);
      }
      return;
    }

    if (hit) {
      hideNodePreview();

      graph.dragNode = hit;
      graph.dragMx = pos.x - hit.x;
      graph.dragMy = pos.y - hit.y;

      hit.vx = 0;
      hit.vy = 0;
      hit.fx = 0;
      hit.fy = 0;

      c.classList.add('dragging');
      c.setPointerCapture?.(e.pointerId);

      // Long press → context menu (works for notes AND folders now).
      clearLongPressTimer();
      graph.longPressTimer = setTimeout(() => {
        if (!graph.dragNode || graph.dragNode !== hit) return;
        if (graph.moved > LONG_PRESS_MOVE_TOLERANCE) return;

        graph.longPressFired = true;
        graph.suppressNextClick = true;
        graph.dragNode = null;
        graph.panning = false;

        c.classList.remove('dragging');

        showNodeContextMenu(hit, e.clientX, e.clientY);
        startVisualLoop();
      }, LONG_PRESS_MS);

      startSimulation(DRAG_START_ALPHA);
    } else {
      hideNodePreview();

      graph.panning = true;
      graph.dragMx = e.clientX;
      graph.dragMy = e.clientY;
      c.classList.add('dragging');
      c.setPointerCapture?.(e.pointerId);
    }

    startVisualLoop();
  });

  c.addEventListener('pointermove', (e) => {
    if (!graph.canvas || c !== graph.canvas || !graphVisible()) return;

    graph.moved = Math.max(
      graph.moved,
      Math.hypot(e.clientX - graph.pressMx, e.clientY - graph.pressMy)
    );

    if (graph.moved > LONG_PRESS_MOVE_TOLERANCE) {
      clearLongPressTimer();
    }

    if (graph.dragNode) {
      const pos = canvasCoords(e);

      graph.dragNode.x = pos.x - graph.dragMx;
      graph.dragNode.y = pos.y - graph.dragMy;
      graph.dragNode.vx = 0;
      graph.dragNode.vy = 0;
      graph.dragNode.fx = 0;
      graph.dragNode.fy = 0;

      startSimulation(DRAG_MOVE_ALPHA);
      return;
    }

    if (graph.panning) {
      graph.ox += e.clientX - graph.dragMx;
      graph.oy += e.clientY - graph.dragMy;
      graph.dragMx = e.clientX;
      graph.dragMy = e.clientY;

      startVisualLoop();
      return;
    }

    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    if (hit !== graph.hover) {
      graph.hover = hit;
      c.style.cursor = hit ? 'pointer' : 'grab';

      startVisualLoop();
    }
  });

  c.addEventListener('pointerup', (e) => {
    if (!graph.canvas || c !== graph.canvas) return;

    clearLongPressTimer();

    const hadDragNode = !!graph.dragNode;

    graph.dragNode = null;
    graph.panning = false;
    graph.pointerId = null;

    c.classList.remove('dragging');

    try {
      c.releasePointerCapture?.(e.pointerId);
    } catch {}

    if (graph.longPressFired) {
      graph.suppressNextClick = true;
      startVisualLoop();
      return;
    }

    if (hadDragNode) {
      startSimulation(DRAG_RELEASE_ALPHA);
    } else {
      startVisualLoop();
    }
  });

  c.addEventListener('pointercancel', () => {
    clearLongPressTimer();

    graph.dragNode = null;
    graph.panning = false;
    graph.pointerId = null;

    c.classList.remove('dragging');
    startVisualLoop();
  });

  c.addEventListener('mouseleave', () => {
    if (graph.dragNode || graph.panning) return;

    graph.hover = null;
    c.style.cursor = 'grab';
    startVisualLoop();
  });

  // Prevent middle-click default (autoscroll in some browsers).
  c.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  c.addEventListener('click', (e) => {
    if (!graph.canvas || c !== graph.canvas || !graphVisible()) return;

    if (graph.suppressNextClick) {
      graph.suppressNextClick = false;
      return;
    }

    if (graph.moved > CLICK_MOVE_TOLERANCE || graph.panning) return;

    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    if (!hit) return;

    if (hit.type === NODE.NOTE) {
      showNodePreview(hit, e.clientX, e.clientY);
      return;
    }

    if (hit.type === NODE.FOLDER) {
      hideNodePreview();

      graph.focusFolderId = graph.focusFolderId === hit.id ? null : hit.id;

      // Smooth, snappy transition to the folder.
      centerOnNode(hit, Math.max(1.25, graph.scale), { animated: true });
      updateStats();
    }
  });

  c.addEventListener('dblclick', async (e) => {
    if (!graph.canvas || c !== graph.canvas || !graphVisible()) return;

    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    if (hit?.type !== NODE.NOTE) return;

    e.preventDefault();
    hideNodePreview();

    if (graph.mode === 'overlay') closeGraph();
    await openNote(hit.id);
  });

  c.addEventListener('contextmenu', (e) => {
    if (!graph.canvas || c !== graph.canvas || !graphVisible()) return;

    e.preventDefault();

    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    if (hit) {
      showNodeContextMenu(hit, e.clientX, e.clientY);
    } else {
      showEmptyContextMenu(e.clientX, e.clientY);
    }
  });

  c.addEventListener('wheel', (e) => {
    if (!graph.canvas || c !== graph.canvas || !graphVisible()) return;

    e.preventDefault();

    // Any wheel zoom cancels a running view tween.
    graph.viewTween = null;

    const r = c.getBoundingClientRect();

    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.max(0.25, Math.min(4.5, graph.scale * factor));

    const wx = (mx - graph.ox) / graph.scale;
    const wy = (my - graph.oy) / graph.scale;

    graph.scale = ns;
    graph.ox = mx - wx * graph.scale;
    graph.oy = my - wy * graph.scale;

    startVisualLoop();
  }, { passive: false });
}

export function setupGraphInteractions() {
  injectGraphCss();
  ensureContextMenuCloseHandlers();

  const c = $('graphCanvas');
  if (c) bindGraphCanvas(c);

  // Keep the legacy header search wired (it's hidden, but harmless).
  $('graphSearch')?.addEventListener('input', (e) => {
    graph.highlight = e.target.value || '';
    startVisualLoop();
  });

  $('graphRecenter')?.addEventListener('click', () => {
    recenterAll();
  });

  $('graphClose')?.addEventListener('click', closeGraph);

  window.addEventListener('resize', () => {
    if (!graphVisible()) return;

    resizeGraphCanvas();

    buildGraph();
    updateStats();
    startSimulation(0.55);
  });

  window.addEventListener('yanta-preview-rendered', () => {
    if (graph.mode === 'pane' && graphVisible()) {
      buildGraph();
      updateStats();
      startSimulation(0.35);
    }
  });
}
