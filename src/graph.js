// ============================================================
// YANTA — Interactive graph view (canvas).
//
// Nodes = notes + optional folders.
// Edges = wikilinks (with multiplicity), folder structure, optional
// local semantic links.
//
// Architecture:
//   graph-settings.js  persisted user options (display, forces, layers)
//   graph-physics.js   pure force simulation (Barnes-Hut, springs)
//   graph-preview.js   note preview popover (real Markdown renderer)
//   graph-appearance.js icon & color editor
//   graph-css.js       runtime styles
//
// Simulation model (d3 semantics):
//   alpha += (alphaTarget - alpha) * alphaDecay   per tick
//   drag start  → alphaTarget = 0.3 (layout stays warm and calm)
//   drag end    → alphaTarget = 0   (layout cools down smoothly)
//   mutations   → kickSimulation(alpha)
//
// Rendering:
//   - Viewport culling for nodes and links
//   - Two-pass z-ordering (no per-frame sort)
//   - Level-of-detail labels driven by zoom + node importance
//   - Cached search-match set (no per-frame string work)
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
  debounce,
} from './core.js';
import { wikilinkIndex } from './features-state.js';
import { openNote, rebuildWikilinkIndex } from './notes.js';
import { renderTree } from './tree.js';
import { noteMarkdown, getNoteDoc } from './yjs.js';
import {
  openSidePane,
  closeSidePane,
  isSidePaneOpen,
} from './side-pane.js';
import { injectGraphCss } from './graph/graph-css.js';
import { tickSimulation } from './graph/graph-physics.js';
import { computeSemanticLinks } from './graph/graph-semantic.js';
import {
  graphSettings,
  updateGraphSettings,
  resetGraphForces,
  onGraphSettingsChange,
} from './graph/graph-settings.js';
import {
  showGraphNotePreview,
  hideGraphNotePreview,
  refreshGraphNotePreview,
} from './graph/graph-preview.js';
import {
  editNoteAppearance as editNoteAppearancePicker,
  editFolderAppearance as editFolderAppearancePicker,
} from './graph/graph-appearance.js';
export {
  editNoteAppearance,
  editFolderAppearance,
  editTreeAppearanceTargets,
} from './graph/graph-appearance.js';
import { AI_BRAIN_IDS } from './ai/brain.js';
import { yantaPrompt } from './dialogs.js';
import * as trash from './trash.js';
import { noteUrl } from './navigation.js';
import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
} from './overlay-history.js';

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;

const NODE = { NOTE: 'note', FOLDER: 'folder' };
const LINK = {
  WIKI: 'wiki',
  SEMANTIC: 'semantic',
  CONTAINS: 'contains',
  FOLDER: 'folder',
};

// d3-style simulation constants (not user-facing).
const SIM = Object.freeze({
  alphaMin: 0.002,
  alphaDecay: 0.026,
  velocityDecay: 0.4, // friction = 1 - velocityDecay
  dragAlphaTarget: 0.3,
});
const BUILD_ALPHA = 1;

// Visual transition tuning.
const VISUAL_EASE = 0.24;
const VISUAL_EPS = 0.007;

// Interaction tuning.
const CLICK_MOVE_TOLERANCE = 6;
const LONG_PRESS_MS = 560;
const LONG_PRESS_MOVE_TOLERANCE = 8;
const VIEW_TRANSITION_MS = 360;
const ZOOM_MIN = 0.06;
const ZOOM_MAX = 5;
const POSITION_MEMORY_MAX = 4000;

// Optional pane mode.
const WIDE_PANE_MIN_WIDTH = 1120;

// Convenience accessor for persisted settings.
const S = () => graphSettings();

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
  raf: 0,
  visualRaf: 0,
  simRunning: false,
  simAlpha: 0,
  alphaTarget: 0,
  scale: 1,
  ox: 0,
  oy: 0,
  viewTween: null,
  dragNode: null,
  dragMx: 0,
  dragMy: 0,
  panning: false,
  hover: null,
  highlight: '',
  hasQuery: false,
  hubDegree: 3,
  focusFolderId: null,
  pressMx: 0,
  pressMy: 0,
  moved: 0,
  pointerId: null,
  longPressTimer: 0,
  longPressFired: false,
  suppressNextClick: false,
  previewAnchor: null,
  positionMemory: new Map(), // gid -> { x, y, vx, vy }
  spawnPositions: new Map(), // gid -> { x, y }
};

const iconCache = new Map();
const boundCanvases = new WeakSet();
let menuEl = null;
let graphOverlayRegistered = false;
let settingsSubscribed = false;

function graphOverlayIsOpen() {
  return graph.mode === 'overlay' && $('graphOverlay')?.hidden === false;
}

function registerGraphOverlayRoute() {
  if (graphOverlayRegistered) return;
  graphOverlayRegistered = true;
  registerOverlayRoute('graph', {
    open: () => openGraph({ forceOverlay: true, fromHistory: true }),
    close: () => closeGraph({ fromHistory: true }),
    isOpen: graphOverlayIsOpen,
  });
}

// ------------------------------------------------------------
// Theme / utility
// ------------------------------------------------------------
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
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, 'success');
  } catch {
    toast('Copy failed', 'error');
  }
}

// ------------------------------------------------------------
// Folder / note metadata helpers
// ------------------------------------------------------------
function folderByIdOrSelf(folderOrId) {
  return typeof folderOrId === 'string'
    ? state.folders.get(folderOrId)
    : folderOrId;
}

function folderIsAiBrain(folderOrId) {
  const start = folderByIdOrSelf(folderOrId);
  if (!start) return false;
  const seen = new Set();
  let f = start;
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    if (f.id === AI_BRAIN_IDS.rootFolder || f.aiBrain === true) return true;
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }
  return false;
}

function noteIsAiBrain(note) {
  if (!note) return false;
  return (
    note.aiBrain === true ||
    note.id === AI_BRAIN_IDS.soul ||
    note.id === AI_BRAIN_IDS.user ||
    note.id === AI_BRAIN_IDS.memory ||
    note.id === AI_BRAIN_IDS.activity ||
    note.id === AI_BRAIN_IDS.weatherSkill ||
    folderIsAiBrain(note.folderId)
  );
}

function folderIsArchived(folderOrId) {
  const start = folderByIdOrSelf(folderOrId);
  if (!start) return false;
  const seen = new Set();
  let f = start;
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    if (f.archived === true) return true;
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }
  return false;
}

function noteIsArchived(note) {
  if (!note) return false;
  return note.archived === true || folderIsArchived(note.folderId);
}

function graphArchiveExists() {
  for (const folder of state.folders.values()) {
    if (folderIsArchived(folder)) return true;
  }
  for (const note of state.notes.values()) {
    if (noteIsArchived(note)) return true;
  }
  return false;
}

function graphAiBrainExists() {
  for (const folder of state.folders.values()) {
    if (folderIsAiBrain(folder)) return true;
  }
  for (const note of state.notes.values()) {
    if (noteIsAiBrain(note)) return true;
  }
  return false;
}

function folderIsGraphExcluded(folderOrId) {
  const start = folderByIdOrSelf(folderOrId);
  if (!start) return false;
  if (trash.isFolderInTrash(start)) return true;
  if (folderIsArchived(start)) return !S().showArchive;
  if (folderIsAiBrain(start)) return !S().showAiBrain;
  const seen = new Set();
  let f = start;
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    if (f.system === true || f.hidden === true) return true;
    if (f.dashboardHidden === true || f.hiddenFromDashboard === true) return true;
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }
  return false;
}

function noteIsGraphExcluded(note) {
  if (!note) return true;
  if (trash.isNoteInTrash(note)) return true;
  if (noteIsArchived(note)) return !S().showArchive;
  if (noteIsAiBrain(note)) return !S().showAiBrain;
  if (
    note.system === true ||
    note.hidden === true ||
    note.dashboardHidden === true ||
    note.hiddenFromDashboard === true
  ) {
    return true;
  }
  if (note.folderId && folderIsGraphExcluded(note.folderId)) return true;
  return false;
}

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
    .filter((folder) => !folderIsGraphExcluded(folder))
    .filter((f) =>
      !f.parentId ||
      !state.folders.has(f.parentId) ||
      folderIsGraphExcluded(f.parentId)
    )
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
  // Bounded memory: drop the oldest remembered positions.
  if (graph.positionMemory.size > POSITION_MEMORY_MAX) {
    const excess = graph.positionMemory.size - POSITION_MEMORY_MAX;
    let i = 0;
    for (const key of graph.positionMemory.keys()) {
      graph.positionMemory.delete(key);
      if (++i >= excess) break;
    }
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
    };
  }
  const prev = graph.positionMemory.get(gid);
  if (prev) {
    return { x: prev.x, y: prev.y, vx: prev.vx || 0, vy: prev.vy || 0, birthT: 0 };
  }
  return { x: fallback.x, y: fallback.y, vx: 0, vy: 0, birthT: 0 };
}

function addNode(node) {
  node.phase = node.phase ?? deterministicPhase(node.gid);
  node.hoverT = node.hoverT ?? 0;
  node.currentT = node.currentT ?? 0;
  node.matchT = node.matchT ?? 0;
  node.dimT = node.dimT ?? 0;
  node.birthT = node.birthT ?? 0;
  node.isMatch = false;
  graph.idIndex.set(node.gid, graph.nodes.length);
  graph.nodes.push(node);
}

function addLink(aGid, bGid, kind, weight = 1, extra = {}) {
  const a = graph.idIndex.get(aGid);
  const b = graph.idIndex.get(bGid);
  if (a == null || b == null || a === b) return null;
  const link = { a, b, kind, weight, dimT: 0, ...extra };
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
  if (S().showFolders && note.folderId && folderNodeById.has(note.folderId)) {
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
  const visibleFolderIds = new Set(
    graph.nodes.filter((n) => n.type === NODE.FOLDER).map((n) => n.id)
  );
  for (const folderId of visibleFolderIds) {
    graph.descendantsByFolder.set(folderId, new Set([graphIdForFolder(folderId)]));
  }
  for (const node of graph.nodes) {
    if (node.type === NODE.FOLDER) {
      let f = state.folders.get(node.id);
      const seen = new Set();
      while (f?.parentId && !seen.has(f.id)) {
        seen.add(f.id);
        if (!visibleFolderIds.has(f.parentId)) break;
        graph.descendantsByFolder.get(f.parentId)?.add(graphIdForFolder(node.id));
        f = state.folders.get(f.parentId);
      }
    }
    if (node.type === NODE.NOTE && node.folderId) {
      let f = state.folders.get(node.folderId);
      const seen = new Set();
      while (f && !seen.has(f.id)) {
        seen.add(f.id);
        if (visibleFolderIds.has(f.id)) {
          graph.descendantsByFolder.get(f.id)?.add(graphIdForNote(node.id));
        }
        f = f.parentId ? state.folders.get(f.parentId) : null;
      }
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
  const s = S();
  if (!s.showFolders) graph.focusFolderId = null;

  const t = theme();
  const centers = groupCenters();
  const folders = [...state.folders.values()]
    .filter((folder) => !folderIsGraphExcluded(folder))
    .sort((a, b) => {
      const da = folderDepth(a.id);
      const db = folderDepth(b.id);
      return da - db || (a.name || '').localeCompare(b.name || '');
    });
  const notes = [...state.notes.values()]
    .filter((note) => !noteIsGraphExcluded(note))
    .sort((a, b) => {
      const fa = folderPath(a.folderId).join('/');
      const fb = folderPath(b.folderId).join('/');
      return fa.localeCompare(fb) || (b.updated || 0) - (a.updated || 0);
    });

  const folderNodeById = new Map();
  if (s.showFolders) {
    const folderIndexByRoot = new Map();
    for (const f of folders) {
      const fallback = initialFolderPosition(f, folderIndexByRoot, centers);
      const pos = resolvePosition(graphIdForFolder(f.id), fallback);
      const top = isTopLevelFolder(f);
      const color = safeMetaColor(f.color, top ? t.textDim : t.textFaint);
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
        fx: null,
        fy: null,
        birthT: pos.birthT,
        degree: 0,
        wikiDegree: 0,
        semanticDegree: 0,
        folderId: f.id,
        isTopLevelFolder: top,
      };
      folderNodeById.set(f.id, node);
      addNode(node);
    }
  }

  const noteIndexByGroup = new Map();
  for (const n of notes) {
    const fallback = initialNotePosition(n, noteIndexByGroup, centers, folderNodeById);
    const pos = resolvePosition(graphIdForNote(n.id), fallback);
    const color = safeMetaColor(n.color, n.type === 'list' ? t.accent2 : t.text);
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
      fx: null,
      fy: null,
      birthT: pos.birthT,
      degree: 0,
      wikiDegree: 0,
      semanticDegree: 0,
      noteId: n.id,
      folderId: n.folderId || null,
      pinned: !!n.pinned,
    });
  }

  if (s.showFolders) {
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
      if (aGid < bGid) entry.fwd++;
      else entry.rev++;
      entry.total++;
    }
  }
  const wikiSeenGlobal = new Set();
  for (const entry of wikiCounts.values()) {
    wikiSeenGlobal.add(pairKey(entry.a, entry.b));
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

  // Hub threshold for label LOD: 80th percentile of wiki connectivity.
  const degs = graph.nodes
    .filter((n) => n.type === NODE.NOTE && n.wikiDegree > 0)
    .map((n) => n.wikiDegree)
    .sort((a, b) => a - b);
  graph.hubDegree = degs.length
    ? Math.max(3, degs[Math.floor(degs.length * 0.8)])
    : 3;

  recomputeNodeMetrics();
  recomputeSearchMatches();
}

// ------------------------------------------------------------
// Node metrics (size modes)
// ------------------------------------------------------------
function computeBaseRadius(node, s, now) {
  const scale = s.nodeScale;
  if (node.type === NODE.FOLDER) {
    const bump = Math.min(
      node.isTopLevelFolder ? 8 : 5,
      Math.sqrt(node.degree || 0) * (node.isTopLevelFolder ? 1.5 : 1.1)
    );
    return ((node.isTopLevelFolder ? 22 : 14) + bump) * scale;
  }
  const conn =
    node.wikiDegree ||
    node.degree ||
    (s.showSemantic ? (node.semanticDegree || 0) * 0.55 : 0);
  let r;
  switch (s.nodeSizeMode) {
    case 'uniform':
      r = 11;
      break;
    case 'content': {
      // state.searchIndex holds precomputed title+tags+body → O(1) length.
      const chars = (state.searchIndex?.get(node.id) || '').length;
      r = 8 + Math.min(11, Math.log2(1 + chars / 90) * 1.8);
      break;
    }
    case 'recency': {
      const note = state.notes.get(node.id);
      const ageDays = Math.max(0, (now - (note?.updated || 0)) / 86400000);
      r = 8.5 + 8.5 * Math.exp(-ageDays / 21);
      break;
    }
    case 'links':
    default:
      r = 9 + Math.min(9, Math.sqrt(conn || 0) * 2.1);
  }
  return r * scale;
}

function recomputeNodeMetrics() {
  const s = S();
  const now = Date.now();
  for (const n of graph.nodes) {
    n.baseR = computeBaseRadius(n, s, now);
    n.hitRadius = n.baseR + 8;
  }
}

// ------------------------------------------------------------
// Local semantic graph
// ------------------------------------------------------------
function addSemanticLinks(notes, explicitWikiPairs) {
  if (!S().showSemantic || notes.length < 2) return;
  const visibleNotes = notes.filter((note) =>
    graph.idIndex.has(graphIdForNote(note.id))
  );
  const semanticLinks = computeSemanticLinks(
    visibleNotes,
    (noteId) => {
      try {
        return noteMarkdown(noteId) || '';
      } catch {
        return '';
      }
    },
    explicitWikiPairs,
    (aId, bId) => pairKey(graphIdForNote(aId), graphIdForNote(bId))
  );
  for (const link of semanticLinks) {
    addLink(
      graphIdForNote(link.aId),
      graphIdForNote(link.bId),
      LINK.SEMANTIC,
      Math.max(0.4, link.score),
      {
        score: link.score,
        semanticDistance: link.distance,
        semanticStrength: 0.0045 + link.closeness * 0.023,
        semanticCloseness: link.closeness,
      }
    );
  }
}

// ------------------------------------------------------------
// Physics
// ------------------------------------------------------------
function forceConfig(dragging) {
  const s = S();
  const f = s.forces;
  const { w, h } = canvasCssSize();
  return {
    alpha: graph.simAlpha,
    repelK: (200 + f.repel * 2800) * (s.showSemantic ? 0.82 : 1),
    linkScale: 0.25 + f.link * 1.5,
    distanceScale: f.linkDistance,
    centerX: w / 2,
    centerY: h / 2,
    centerStrength: f.center * 0.008 * (dragging ? 0.45 : 1),
    folderStrength: s.showFolders
      ? f.folderPull * 0.01 * (dragging ? 0.5 : 1)
      : 0,
    friction: 1 - SIM.velocityDecay,
    collide: f.collide,
  };
}

function preparePhysicsModel({ dragging = false, dragIdx = null } = {}) {
  const s = S();
  for (const n of graph.nodes) {
    const connectivity =
      n.type === NODE.NOTE
        ? (n.wikiDegree || n.degree || (s.showSemantic ? (n.semanticDegree || 0) * 0.55 : 0))
        : n.degree;
    n.mass =
      n.type === NODE.FOLDER
        ? (n.isTopLevelFolder ? 2.2 : 1.45) + Math.sqrt(connectivity || 0) * 0.22
        : 1 + Math.sqrt(connectivity || 0) * 0.16;
    n.collideR = n.baseR + (n.type === NODE.FOLDER ? 6 : 4);
    if (s.showFolders && n.type === NODE.NOTE && n.folderId) {
      const folderIdx = graph.idIndex.get(graphIdForFolder(n.folderId));
      n.groupIdx = folderIdx == null ? -1 : folderIdx;
    } else {
      n.groupIdx = -1;
    }
  }
  for (const l of graph.links) {
    const a = graph.nodes[l.a];
    const b = graph.nodes[l.b];
    let distance = 135;
    let strength = 0.01;
    if (l.kind === LINK.FOLDER) {
      distance = 120;
      strength = 0.0165;
    } else if (l.kind === LINK.CONTAINS) {
      distance = a.isTopLevelFolder || b.isTopLevelFolder ? 100 : 78;
      strength = 0.024;
    } else if (l.kind === LINK.WIKI) {
      const count = l.count || 1;
      const countBoost = Math.min(2.2, 1 + Math.log2(count) * 0.65);
      distance = (s.showFolders ? 155 : 125) / countBoost;
      strength = 0.013 * countBoost;
      // Hub normalization (d3-like): links into well-connected notes
      // pull less, so hubs stay calm instead of collapsing the layout.
      const minDeg = Math.max(1, Math.min(a.degree || 1, b.degree || 1));
      strength /= Math.sqrt(minDeg);
    } else if (l.kind === LINK.SEMANTIC) {
      distance = l.semanticDistance || (s.showFolders ? 160 : 120);
      strength = l.semanticStrength || 0.006;
      if (!s.showFolders) {
        strength *= 1.45;
        distance *= 0.88;
      }
      const minDeg = Math.max(1, Math.min(a.degree || 1, b.degree || 1));
      strength /= Math.sqrt(minDeg);
    }
    if (dragging && dragIdx != null) {
      const incident = l.a === dragIdx || l.b === dragIdx;
      strength *= incident ? 1.35 : 0.42;
    }
    l.distance = distance;
    l.strength = strength * (l.weight || 1);
  }
}

function stepGraph() {
  if (!graph.canvas) return 0;
  const dragging = !!graph.dragNode;
  const dragIdx = dragging ? graph.idIndex.get(graph.dragNode.gid) : null;
  preparePhysicsModel({ dragging, dragIdx });
  return tickSimulation(graph.nodes, graph.links, forceConfig(dragging));
}

function wakeSimulation() {
  if (!graph.simRunning) {
    graph.simRunning = true;
    cancelAnimationFrame(graph.raf);
    graph.raf = requestAnimationFrame(animate);
  }
  startVisualLoop();
}

function kickSimulation(alpha = 0.5) {
  graph.simAlpha = Math.max(graph.simAlpha || 0, alpha);
  wakeSimulation();
}

function setAlphaTarget(target) {
  graph.alphaTarget = target;
  if (target > 0) wakeSimulation();
}

function stopSimulation({ keepDrag = false } = {}) {
  graph.simRunning = false;
  graph.simAlpha = 0;
  graph.alphaTarget = 0;
  cancelAnimationFrame(graph.raf);
  for (const n of graph.nodes) {
    if (keepDrag && graph.dragNode === n) {
      n.fx = n.x;
      n.fy = n.y;
      continue;
    }
    n.vx = 0;
    n.vy = 0;
    n.fx = null;
    n.fy = null;
  }
  startVisualLoop();
}

function animate() {
  if (!graph.simRunning) return;
  // d3 semantics: alpha relaxes toward alphaTarget every tick.
  graph.simAlpha += (graph.alphaTarget - graph.simAlpha) * SIM.alphaDecay;
  const energy = stepGraph();
  if (
    graph.simAlpha < SIM.alphaMin &&
    graph.alphaTarget < SIM.alphaMin &&
    energy < 0.02
  ) {
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

function visualFrame() {
  graph.visualRaf = 0;
  const transitionsActive = updateVisualTransitions();
  const viewTweenActive = stepViewTween();
  drawGraph();
  const shouldContinue =
    graphVisible() && (graph.simRunning || transitionsActive || viewTweenActive);
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
    const matchTarget = graph.hasQuery && n.isMatch ? 1 : 0;
    const dimTarget = nodeDimmed(n) ? 1 : 0;
    const nextHover = lerpValue(n.hoverT || 0, hoverTarget);
    const nextCurrent = lerpValue(n.currentT || 0, currentTarget);
    const nextMatch = lerpValue(n.matchT || 0, matchTarget);
    const nextDim = lerpValue(n.dimT || 0, dimTarget);
    const nextBirth = lerpValue(n.birthT || 0, 0, 0.17);
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
    n.birthT = Math.abs(nextBirth) < VISUAL_EPS ? 0 : nextBirth;
  }
  for (const l of graph.links) {
    const target = linkDimmed(l) ? 1 : 0;
    const next = lerpValue(l.dimT || 0, target);
    if (Math.abs(next - (l.dimT || 0)) > VISUAL_EPS) active = true;
    l.dimT = Math.abs(next - target) < VISUAL_EPS ? target : next;
  }
  return active;
}

// ------------------------------------------------------------
// Search matches (cached, no per-frame string work)
// ------------------------------------------------------------
function noteMatchesQuery(node, q, deep) {
  const base = `${node.title || ''} ${node.subtitle || ''}`.toLowerCase();
  if (base.includes(q)) return true;
  if (!deep) return false;
  const note = state.notes.get(node.id);
  if (!note) return false;
  const tags = (note.tags || []).join(' ').toLowerCase();
  if (tags && tags.includes(q)) return true;
  const indexed = state.searchIndex?.get(note.id);
  if (indexed) return indexed.includes(q);
  try {
    return (noteMarkdown(note.id) || '').toLowerCase().includes(q);
  } catch {
    return false;
  }
}

function recomputeSearchMatches() {
  const q = graph.highlight.trim().toLowerCase();
  graph.hasQuery = !!q;
  if (!q) {
    for (const n of graph.nodes) n.isMatch = false;
    startVisualLoop();
    return;
  }
  const deep = S().deepSearch;
  for (const n of graph.nodes) {
    if (n.type === NODE.NOTE) n.isMatch = noteMatchesQuery(n, q, deep);
  }
  for (const n of graph.nodes) {
    if (n.type !== NODE.FOLDER) continue;
    let match =
      (n.title || '').toLowerCase().includes(q) ||
      (n.subtitle || '').toLowerCase().includes(q);
    if (!match) {
      const desc = graph.descendantsByFolder.get(n.id);
      if (desc) {
        for (const gid of desc) {
          if (!gid.startsWith('note:')) continue;
          const idx = graph.idIndex.get(gid);
          if (idx != null && graph.nodes[idx]?.isMatch) {
            match = true;
            break;
          }
        }
      }
    }
    n.isMatch = match;
  }
  startVisualLoop();
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
  if (cached) return cached.ready ? cached.img : null;
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
  img.onerror = () => iconCache.delete(key);
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
  if (!S().showFolders || !graph.focusFolderId) return null;
  return graph.descendantsByFolder.get(graph.focusFolderId) || null;
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
  const match = graph.hasQuery && node.isMatch;
  if (fs && !fs.has(node.gid) && !match && !isCurrent(node) && !isHoverConnected(node)) {
    return true;
  }
  if (graph.hover && !isHoverConnected(node) && !match && !isCurrent(node)) {
    return true;
  }
  if (graph.hasQuery && !match && !isCurrent(node) && !isHoverConnected(node)) {
    return true;
  }
  return false;
}

function linkDimmed(link) {
  const a = graph.nodes[link.a];
  const b = graph.nodes[link.b];
  const fs = focusSet();
  if (fs && !fs.has(a.gid) && !fs.has(b.gid)) return true;
  if (graph.hover) return graph.hover !== a && graph.hover !== b;
  if (graph.hasQuery) {
    return !a.isMatch && !b.isMatch && !isCurrent(a) && !isCurrent(b);
  }
  return false;
}

function labelAlphaFor(node, s) {
  const focusA = Math.max(node.hoverT || 0, node.currentT || 0, node.matchT || 0);
  const mode = node.type === NODE.FOLDER ? s.folderLabels : s.noteLabels;
  if (mode === 'off') return focusA;
  if (mode === 'always') return Math.max(0.92, focusA);
  // Smart level-of-detail: labels fade in with zoom; hubs and folders
  // surface earlier; dense graphs raise the threshold.
  const dense = graph.nodes.length > 600;
  const isFolder = node.type === NODE.FOLDER;
  const t0 = isFolder ? 0.3 : dense ? 0.85 : 0.55;
  const t1 = isFolder ? 0.55 : dense ? 1.2 : 0.95;
  let a = clamp01((graph.scale - t0) / Math.max(0.01, t1 - t0));
  if (!isFolder && (node.wikiDegree || 0) >= graph.hubDegree) {
    a = Math.max(a, clamp01((graph.scale - 0.4) / 0.35));
  }
  return Math.max(a, focusA);
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
  const dimT = link.dimT || 0;
  let color = t.border;
  let alpha = 0.55 * (1 - dimT) + 0.1 * dimT;
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
    alpha = 0.2 * (1 - dimT) + 0.05 * dimT;
    width = 0.9;
    ctx.setLineDash([3 / graph.scale, 7 / graph.scale]);
  }
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width / graph.scale;
  if (link.kind === LINK.WIKI && (link.count || 1) >= 2) {
    const count = link.count || 1;
    const spacing = (2.2 + Math.min(2.4, Math.log2(count) * 1.0)) / graph.scale;
    drawSingleLine(ctx, a.x, a.y, b.x, b.y, spacing / 2);
    drawSingleLine(ctx, a.x, a.y, b.x, b.y, -spacing / 2);
    if (count >= 3) {
      ctx.globalAlpha = alpha * 0.55;
      ctx.lineWidth = (width * 0.55) / graph.scale;
      drawSingleLine(ctx, a.x, a.y, b.x, b.y, 0);
    }
  } else {
    drawSingleLine(ctx, a.x, a.y, b.x, b.y, 0);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawNode(ctx, node, t, s) {
  const hoverT = node.hoverT || 0;
  const currentT = node.currentT || 0;
  const matchT = node.matchT || 0;
  const dimT = node.dimT || 0;
  const birthT = node.birthT || 0;
  const baseR = node.baseR || 11;
  const r = baseR + currentT * 4 + hoverT * 3 + matchT * 2 + birthT * 7;
  const color = node.color || (node.type === NODE.FOLDER ? t.textDim : t.text);
  node.radius = r;
  node.hitRadius = baseR + 9;

  ctx.save();
  ctx.globalAlpha = (1 - dimT * 0.68) * (1 - birthT * 0.28);
  if (birthT > 0.02) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 12 * birthT, 0, Math.PI * 2);
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
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.fillStyle =
    node.type === NODE.FOLDER
      ? node.isTopLevelFolder ? t.bgElev2 : t.bgElev3
      : t.bgElev2;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = currentT > 0.1 || matchT > 0.1 ? t.accent : color;
  ctx.lineWidth = (
    currentT > 0.1
      ? 2.8
      : node.type === NODE.FOLDER
        ? node.isTopLevelFolder ? 2.3 : 1.45
        : 1.45
  ) / graph.scale;
  ctx.globalAlpha = (1 - dimT * 0.55) * (1 - birthT * 0.18);
  ctx.stroke();

  if (node.type === NODE.NOTE && s.showSemantic && node.semanticDegree && !node.wikiDegree) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
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
    ctx.arc(node.x + r * 0.58, node.y - r * 0.58, Math.max(2.2, r * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = t.yellow;
    ctx.fill();
  }

  // Icon (or a colored core dot when icons are turned off).
  if (s.showIcons) {
    const iconSize = Math.max(12, Math.min(30, r * 1.15));
    const img = iconImage(node.icon || 'square', color, 28);
    if (img) {
      ctx.drawImage(img, node.x - iconSize / 2, node.y - iconSize / 2, iconSize, iconSize);
    } else {
      const sq = iconSize * 0.72;
      roundedRect(ctx, node.x - sq / 2, node.y - sq / 2, sq, sq, 4);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / graph.scale;
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(node.x, node.y, Math.max(2.5, r * 0.36), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.85;
    ctx.fill();
    ctx.globalAlpha = (1 - dimT * 0.68) * (1 - birthT * 0.18);
  }

  // Label with level-of-detail fade.
  const labelA = labelAlphaFor(node, s);
  if (labelA > 0.03) {
    const label = node.title.length > 34 ? node.title.slice(0, 34) + '…' : node.title;
    const fontSize = Math.max(
      node.isTopLevelFolder ? 11 : 9,
      (node.isTopLevelFolder ? 13 : 11) / Math.sqrt(graph.scale)
    );
    ctx.font = `${node.isTopLevelFolder ? '600 ' : ''}${fontSize.toFixed(1)}px ${t.font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const x = node.x + r + 7;
    const y = node.y;
    const metrics = ctx.measureText(label);
    const padX = 5;
    const padY = 3;
    ctx.globalAlpha = labelA * (0.76 + hoverT * 0.14 + currentT * 0.12) * (1 - dimT * 0.75);
    roundedRect(ctx, x - padX, y - fontSize / 2 - padY, metrics.width + padX * 2, fontSize + padY * 2, 5);
    ctx.fillStyle = t.bg;
    ctx.fill();
    ctx.globalAlpha = labelA * (1 - dimT * 0.62);
    ctx.fillStyle =
      currentT > 0.2 ? t.accent : node.type === NODE.FOLDER ? color : t.text;
    ctx.fillText(label, x, y);
    if ((hoverT > 0.15 || matchT > 0.15) && node.subtitle) {
      const sub = node.subtitle.length > 42 ? node.subtitle.slice(0, 42) + '…' : node.subtitle;
      const subFont = Math.max(8, 9 / Math.sqrt(graph.scale));
      ctx.font = `${subFont.toFixed(1)}px ${t.font}`;
      ctx.globalAlpha = Math.max(hoverT, matchT) * (1 - dimT * 0.6);
      ctx.fillStyle = t.textFaint;
      ctx.fillText(sub, x, y + fontSize + 4);
      if (node.type === NODE.NOTE && s.showSemantic && node.semanticDegree) {
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

function drawEmptyState(ctx, t, dpr) {
  const { w, h } = canvasCssSize();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.fillStyle = t.textDim;
  ctx.font = `600 15px ${t.font}`;
  ctx.fillText('Nothing to show yet', w / 2, h / 2 - 10);
  ctx.fillStyle = t.textFaint;
  ctx.font = `12px ${t.font}`;
  ctx.fillText('Right-click to create your first note or folder.', w / 2, h / 2 + 12);
}

function drawGraph() {
  const c = graph.canvas;
  const ctx = graph.ctx;
  if (!c || !ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const t = theme();
  const s = S();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);

  if (!graph.nodes.length) {
    drawEmptyState(ctx, t, dpr);
    return;
  }

  ctx.setTransform(graph.scale * dpr, 0, 0, graph.scale * dpr, graph.ox * dpr, graph.oy * dpr);

  // Viewport culling bounds (world coordinates, generous padding for labels).
  const { w, h } = canvasCssSize();
  const pad = 160 / graph.scale + 160;
  const vx0 = -graph.ox / graph.scale - pad;
  const vy0 = -graph.oy / graph.scale - pad;
  const vx1 = (w - graph.ox) / graph.scale + pad;
  const vy1 = (h - graph.oy) / graph.scale + pad;

  for (const kind of [LINK.SEMANTIC, LINK.FOLDER, LINK.CONTAINS, LINK.WIKI]) {
    for (const l of graph.links) {
      if (l.kind !== kind) continue;
      const a = graph.nodes[l.a];
      const b = graph.nodes[l.b];
      if (
        Math.max(a.x, b.x) < vx0 || Math.min(a.x, b.x) > vx1 ||
        Math.max(a.y, b.y) < vy0 || Math.min(a.y, b.y) > vy1
      ) {
        continue;
      }
      drawLink(ctx, l, t);
    }
  }

  // Two-pass z-ordering without per-frame sorting: normal nodes first,
  // then the small elevated set (current / hover / matches) on top.
  const elevated = [];
  for (const n of graph.nodes) {
    if (n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
    if (graph.hover === n || isCurrent(n) || (graph.hasQuery && n.isMatch)) {
      elevated.push(n);
      continue;
    }
    drawNode(ctx, n, t, s);
  }
  for (const n of elevated) {
    drawNode(ctx, n, t, s);
  }
}

// ------------------------------------------------------------
// Interaction helpers
// ------------------------------------------------------------
function nodeAt(x, y) {
  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    const n = graph.nodes[i];
    const r = n.hitRadius || (n.baseR || 12) + 8;
    if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
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

// ---- Shared pinch zoom (document listeners bound exactly once) ----
const pinch = {
  pointers: new Map(),
  session: null,
  docBound: false,
};

function pinchIsTouchLike(e) {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

function pinchDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function pinchCenter(a, b) {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  };
}

function pinchPair() {
  const list = [...pinch.pointers.values()];
  return list.length >= 2 ? [list[0], list[1]] : null;
}

function beginPinch() {
  const pair = pinchPair();
  if (!pair || !graph.canvas) return;
  const [a, b] = pair;
  const c = pinchCenter(a, b);
  const rect = graph.canvas.getBoundingClientRect();
  const startScale = graph.scale;
  pinch.session = {
    startDistance: Math.max(1, pinchDistance(a, b)),
    startScale,
    worldX: (c.clientX - rect.left - graph.ox) / startScale,
    worldY: (c.clientY - rect.top - graph.oy) / startScale,
  };
  graph.viewTween = null;
  graph.dragNode = null;
  graph.panning = false;
  graph.suppressNextClick = true;
  clearLongPressTimer();
  graph.canvas.classList.add('dragging');
}

function updatePinch(e) {
  if (!pinch.session || !graph.canvas) return;
  const pair = pinchPair();
  if (!pair) {
    pinch.session = null;
    graph.canvas.classList.remove('dragging');
    return;
  }
  const [a, b] = pair;
  const c = pinchCenter(a, b);
  const rect = graph.canvas.getBoundingClientRect();
  const d = Math.max(1, pinchDistance(a, b));
  const nextScale = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, pinch.session.startScale * (d / pinch.session.startDistance))
  );
  graph.scale = nextScale;
  graph.ox = c.clientX - rect.left - pinch.session.worldX * nextScale;
  graph.oy = c.clientY - rect.top - pinch.session.worldY * nextScale;
  startVisualLoop();
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
}

function bindPinchDocumentListenersOnce() {
  if (pinch.docBound) return;
  pinch.docBound = true;
  document.addEventListener('pointermove', (e) => {
    if (!pinch.pointers.has(e.pointerId)) return;
    pinch.pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    if (pinch.session) updatePinch(e);
  }, { capture: true, passive: false });
  const end = (e) => {
    if (!pinch.pointers.has(e.pointerId)) return;
    pinch.pointers.delete(e.pointerId);
    if (pinch.session && pinch.pointers.size < 2) {
      pinch.session = null;
      graph.suppressNextClick = true;
      graph.canvas?.classList.remove('dragging');
      startVisualLoop();
    }
  };
  document.addEventListener('pointerup', end, { capture: true, passive: false });
  document.addEventListener('pointercancel', end, { capture: true, passive: false });
}

function installGraphPinchZoom(canvas) {
  bindPinchDocumentListenersOnce();
  canvas.addEventListener('pointerdown', (e) => {
    if (canvas !== graph.canvas) return;
    if (!pinchIsTouchLike(e)) return;
    pinch.pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    if (pinch.pointers.size >= 2) {
      beginPinch();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    }
  }, { capture: true, passive: false });
}

// ---- View transitions ----
function centerOnNode(node, scale = Math.max(1.15, graph.scale), { animated = true } = {}) {
  const { w, h } = canvasCssSize();
  const targetScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
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

function fitToView({ nodes = graph.nodes, animated = true, maxScale = 1.4 } = {}) {
  if (!nodes.length || !graph.canvas) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    const r = (n.baseR || 12) + 30;
    if (n.x - r < x0) x0 = n.x - r;
    if (n.y - r < y0) y0 = n.y - r;
    if (n.x + r > x1) x1 = n.x + r;
    if (n.y + r > y1) y1 = n.y + r;
  }
  const { w, h } = canvasCssSize();
  const pad = 60;
  const bw = Math.max(60, x1 - x0);
  const bh = Math.max(60, y1 - y0);
  const targetScale = Math.max(
    ZOOM_MIN,
    Math.min(maxScale, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh))
  );
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const targetOx = w / 2 - cx * targetScale;
  const targetOy = h / 2 - cy * targetScale;
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

function fitFolderToView(folderId) {
  const desc = graph.descendantsByFolder.get(folderId);
  if (!desc) return;
  const nodes = [];
  for (const gid of desc) {
    const idx = graph.idIndex.get(gid);
    if (idx != null) nodes.push(graph.nodes[idx]);
  }
  if (nodes.length) fitToView({ nodes, maxScale: 1.6 });
}

function recenterAll() {
  graph.focusFolderId = null;
  fitToView({ animated: true });
  updateStats();
  kickSimulation(0.35);
}

function clearLongPressTimer() {
  clearTimeout(graph.longPressTimer);
  graph.longPressTimer = 0;
}

// ------------------------------------------------------------
// Note preview integration
// ------------------------------------------------------------
function previewHandlers() {
  return {
    onOpen: async (noteId) => {
      hideGraphNotePreview();
      if (graph.mode === 'overlay') closeGraph();
      await openNote(noteId);
    },
    onEditAppearance: (note) => {
      editNoteAppearancePicker(note);
    },
    onNavigate: (noteId) => {
      const idx = graph.idIndex.get(graphIdForNote(noteId));
      const note = state.notes.get(noteId);
      if (idx == null || !note) {
        hideGraphNotePreview();
        if (graph.mode === 'overlay') closeGraph();
        openNote(noteId);
        return;
      }
      const target = graph.nodes[idx];
      centerOnNode(target, Math.max(1.1, graph.scale));
      const a = graph.previewAnchor || {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };
      showGraphNotePreview(note, a.x, a.y, previewHandlers());
    },
  };
}

function openPreviewForNode(node, clientX, clientY) {
  if (!node || node.type !== NODE.NOTE) return;
  const note = state.notes.get(node.id);
  if (!note) return;
  hideContextMenu();
  graph.previewAnchor = { x: clientX, y: clientY };
  showGraphNotePreview(note, clientX, clientY, previewHandlers());
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

function positionFloatingElement(elm, x, y) {
  elm.hidden = false;
  requestAnimationFrame(() => {
    const r = elm.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > window.innerWidth - 10) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - r.height - 10);
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    elm.style.left = left + 'px';
    elm.style.top = top + 'px';
  });
}

function menuShell(metaIcon, metaText) {
  injectGraphCss();
  hideGraphNotePreview();
  hideContextMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'yanta-graph-context-menu';
  if (metaText) {
    const meta = document.createElement('div');
    meta.className = 'ctx-meta';
    meta.innerHTML = `${lucide(metaIcon || 'info', 12)} <span>${escapeHtml(metaText)}</span>`;
    menuEl.append(meta);
  }
  return menuEl;
}

function menuItem(menu, icon, label, onClick, { danger = false, kbd = '' } = {}) {
  const btn = document.createElement('button');
  if (danger) btn.className = 'danger';
  btn.innerHTML = `${lucide(icon, 14)} <span>${escapeHtml(label)}</span>${kbd ? `<span class="ctx-kbd">${escapeHtml(kbd)}</span>` : ''}`;
  btn.addEventListener('click', async () => {
    hideContextMenu();
    try {
      await onClick();
    } catch (err) {
      console.error(err);
      toast('Action failed', 'error');
    }
  });
  menu.append(btn);
  return btn;
}

function menuDivider(menu) {
  menu.append(document.createElement('hr'));
}

function folderLabelForContext(folderId) {
  if (!folderId) return 'root';
  const f = state.folders.get(folderId);
  return f?.name || 'folder';
}

async function togglePinFromGraph(node) {
  const n = state.notes.get(node.id);
  if (!n) return;
  n.pinned = !n.pinned;
  n.updated = Date.now();
  await store.notes.put(n);
  node.pinned = n.pinned;
  renderTree();
  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: { noteId: n.id, reason: 'pin-toggle', source: 'graph' },
  }));
  toast(n.pinned ? 'Note pinned' : 'Note unpinned', 'success');
  startVisualLoop();
}

async function duplicateNoteFromGraph(node) {
  const { duplicateNoteById } = await import('./item-actions.js');
  await duplicateNoteById(node.id);
  renderTree();
  rebuildAndAnimateAfterMutation(0.7);
}

async function trashNoteFromGraph(node) {
  await trash.moveNoteToTrash(node.id, {
    source: 'graph-context-menu',
    toastMessage: 'Moved note to Trash',
  });
  renderTree();
  rebuildAndAnimateAfterMutation(0.7);
  try {
    window.yantaSync2Now?.();
  } catch {}
}

async function renameFolderFromGraph(folder) {
  const name = await yantaPrompt({
    title: 'Rename folder',
    label: 'Folder name',
    initial: folder.name || '',
    placeholder: 'Folder name',
    required: true,
    confirmLabel: 'Rename',
    icon: 'folder-pen',
  });
  if (name === null) return;
  folder.name = name.trim() || folder.name || 'Folder';
  folder.updated = Date.now();
  await store.folders.put(folder);
  renderTree();
  window.dispatchEvent(new CustomEvent('yanta-folder-updated', {
    detail: { folderId: folder.id, reason: 'folder-renamed', source: 'graph' },
  }));
  rebuildAndAnimateAfterMutation(0.4);
  toast('Folder renamed', 'success');
}

function showNodeContextMenu(node, clientX, clientY) {
  if (!node) return;
  if (node.type === NODE.NOTE) {
    const note = state.notes.get(node.id);
    if (!note) return;
    const parentFolderId = note.folderId || null;
    const menu = menuShell('file-text', `Note in ${folderLabelForContext(parentFolderId)} · ${node.wikiDegree || 0} link${(node.wikiDegree || 0) === 1 ? '' : 's'}`);

    menuItem(menu, 'file-text', 'Open note', async () => {
      if (graph.mode === 'overlay') closeGraph();
      await openNote(node.id);
    }, { kbd: '⏎' });
    menuItem(menu, 'eye', 'Quick preview', () => {
      openPreviewForNode(node, clientX, clientY);
    });
    menuItem(
      menu,
      note.pinned ? 'pin-off' : 'pin',
      note.pinned ? 'Unpin note' : 'Pin note',
      () => togglePinFromGraph(node)
    );
    menuItem(menu, 'palette', 'Icon & color…', () => {
      editNoteAppearancePicker(note);
    });
    menuDivider(menu);
    menuItem(menu, 'brackets', 'Copy wikilink', () => {
      copyText(`[[${note.title || 'Untitled'}]]`, 'Wikilink copied');
    });
    menuItem(menu, 'link', 'Copy note link', () => {
      copyText(
        `${location.origin}${location.pathname}${noteUrl(note.id)}`,
        'Link copied'
      );
    });
    menuDivider(menu);
    menuItem(menu, 'file-plus', 'New note in this folder', () =>
      createNoteFromGraph(node, parentFolderId)
    );
    menuItem(menu, 'folder-plus', 'New folder in this folder', () =>
      createFolderFromGraph(node, parentFolderId)
    );
    menuDivider(menu);
    menuItem(menu, 'copy', 'Duplicate note', () => duplicateNoteFromGraph(node));
    menuItem(menu, 'trash', 'Move to Trash', () => trashNoteFromGraph(node), {
      danger: true,
    });

    document.body.append(menu);
    positionFloatingElement(menu, clientX, clientY);
    return;
  }

  if (node.type === NODE.FOLDER) {
    const folder = state.folders.get(node.id);
    if (!folder) return;
    const menu = menuShell('folder', `Folder · ${folderPath(folder.id).join(' / ') || folder.name}`);

    menuItem(
      menu,
      graph.focusFolderId === folder.id ? 'minimize-2' : 'maximize-2',
      graph.focusFolderId === folder.id ? 'Clear focus' : 'Focus this folder',
      () => {
        graph.focusFolderId = graph.focusFolderId === folder.id ? null : folder.id;
        centerOnNode(node, Math.max(1.25, graph.scale));
        updateStats();
        startVisualLoop();
      }
    );
    menuItem(menu, 'scan', 'Zoom to contents', () => fitFolderToView(folder.id));
    menuItem(menu, 'folder-pen', 'Rename folder…', () =>
      renameFolderFromGraph(folder)
    );
    menuItem(menu, 'palette', 'Icon & color…', () => {
      editFolderAppearancePicker(folder);
    });
    menuDivider(menu);
    menuItem(menu, 'file-plus', 'New note in this folder', () =>
      createNoteFromGraph(node, folder.id)
    );
    menuItem(menu, 'folder-plus', 'New sub-folder', () =>
      createFolderFromGraph(node, folder.id)
    );
    if (typeof trash.moveFolderToTrash === 'function') {
      menuDivider(menu);
      menuItem(menu, 'trash', 'Move to Trash', async () => {
        await trash.moveFolderToTrash(folder.id, {
          source: 'graph-context-menu',
          toastMessage: 'Moved folder to Trash',
        });
        renderTree();
        rebuildAndAnimateAfterMutation(0.8);
      }, { danger: true });
    }

    document.body.append(menu);
    positionFloatingElement(menu, clientX, clientY);
  }
}

function showEmptyContextMenu(clientX, clientY) {
  const menu = menuShell('mouse-pointer-2', 'Canvas');
  menuItem(menu, 'file-plus', 'New root note', () =>
    createRootEntity('note', clientX, clientY)
  );
  menuItem(menu, 'folder-plus', 'New root folder', () =>
    createRootEntity('folder', clientX, clientY)
  );
  menuDivider(menu);
  menuItem(menu, 'crosshair', 'Recenter view', () => recenterAll());
  menuItem(menu, 'scan', 'Fit everything', () => fitToView({ animated: true }));
  document.body.append(menu);
  positionFloatingElement(menu, clientX, clientY);
}

// ------------------------------------------------------------
// Creating notes / folders from the graph
// ------------------------------------------------------------
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
  graph.spawnPositions.set(gid, {
    x: (clientX - r.left - graph.ox) / graph.scale,
    y: (clientY - r.top - graph.oy) / graph.scale,
  });
}

async function persistNewNote(title, folderId) {
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
  return note;
}

async function createNoteFromGraph(sourceNode, folderId) {
  const title = await yantaPrompt({
    title: 'New note',
    message: folderId
      ? 'Create a new note in this folder.'
      : 'Create a new root note.',
    label: 'Note title',
    initial: 'Untitled',
    placeholder: 'Untitled',
    required: true,
    confirmLabel: 'Create note',
    icon: 'file-plus',
  });
  if (title === null) return;
  const note = await persistNewNote(title, folderId);
  if (folderId) state.expandedFolders.add(folderId);
  spawnNearNode(sourceNode, graphIdForNote(note.id), 48);
  renderTree();
  rebuildAndAnimateAfterMutation(0.9);
  toast('Note created', 'success');
}

async function createFolderFromGraph(sourceNode, parentId) {
  const id = uid();
  const now = Date.now();
  const folder = {
    id,
    name: 'New folder',
    parentId: parentId || null,
    created: now,
    updated: now,
  };
  state.folders.set(id, folder);
  await store.folders.put(folder);
  if (parentId) state.expandedFolders.add(parentId);
  state.expandedFolders.add(id);
  spawnNearNode(sourceNode, graphIdForFolder(id), 56);
  renderTree();
  rebuildAndAnimateAfterMutation(1.0);
  window.dispatchEvent(new CustomEvent('yanta-folder-created', {
    detail: { folderId: id, parentId: parentId || null, focusRename: true, source: 'graph' },
  }));
  toast('Folder created', 'success');
}

async function createRootEntity(kind, clientX, clientY) {
  if (kind === 'note') {
    const title = await yantaPrompt({
      title: 'New root note',
      label: 'Note title',
      initial: 'Untitled',
      placeholder: 'Untitled',
      required: true,
      confirmLabel: 'Create note',
      icon: 'file-plus',
    });
    if (title === null) return;
    const note = await persistNewNote(title, null);
    spawnAtClient(graphIdForNote(note.id), clientX, clientY);
    renderTree();
    rebuildAndAnimateAfterMutation(0.9);
    toast('Note created', 'success');
    return;
  }
  if (kind === 'folder') {
    const id = uid();
    const now = Date.now();
    const folder = { id, name: 'New folder', parentId: null, created: now, updated: now };
    state.folders.set(id, folder);
    await store.folders.put(folder);
    state.expandedFolders.add(id);
    spawnAtClient(graphIdForFolder(id), clientX, clientY);
    renderTree();
    rebuildAndAnimateAfterMutation(1.0);
    window.dispatchEvent(new CustomEvent('yanta-folder-created', {
      detail: { folderId: id, parentId: null, focusRename: true, source: 'graph' },
    }));
    toast('Folder created', 'success');
  }
}

function rebuildAndAnimateAfterMutation(alpha = 0.8) {
  if (!graph.canvas || !graphVisible()) return;
  buildGraph();
  updateStats();
  refreshControlsUI();
  kickSimulation(alpha);
}

// ------------------------------------------------------------
// Stats + controls panel
// ------------------------------------------------------------
function statsHtml() {
  const s = S();
  const noteCount = graph.nodes.filter((n) => n.type === NODE.NOTE).length;
  const folderCount = graph.nodes.filter((n) => n.type === NODE.FOLDER).length;
  const wikiCount = graph.links.filter((l) => l.kind === LINK.WIKI).length;
  const semanticCount = graph.links.filter((l) => l.kind === LINK.SEMANTIC).length;
  const parts = [`<strong>${noteCount}</strong> notes`];
  if (s.showFolders) parts.push(`<strong>${folderCount}</strong> folders`);
  parts.push(`<strong>${wikiCount}</strong> links`);
  if (s.showSemantic) parts.push(`<strong>${semanticCount}</strong> semantic`);
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
  el.classList.toggle('collapsed', !S().controlsOpen);
  for (const sync of el.__syncs || []) {
    try {
      sync();
    } catch {}
  }
}

// ---- Generic control builders ----
function ctlToggle(panel, { icon, label, get, set }) {
  const row = document.createElement('div');
  row.className = 'gc-toggle';
  row.setAttribute('role', 'switch');
  row.tabIndex = 0;
  row.innerHTML = `
    <span class="gc-label">${lucide(icon, 13)} ${escapeHtml(label)}</span>
    <span class="gc-switch"></span>
  `;
  const sync = () => {
    const on = !!get();
    row.classList.toggle('on', on);
    row.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  const flip = (e) => {
    e?.stopPropagation();
    set(!get());
    sync();
  };
  row.addEventListener('click', flip);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      flip(e);
    }
  });
  sync();
  panel.__syncs.push(sync);
  return row;
}

function ctlSegment(panel, { options, get, set, ariaLabel = '' }) {
  const seg = document.createElement('div');
  seg.className = 'gc-seg';
  if (ariaLabel) seg.setAttribute('aria-label', ariaLabel);
  seg.setAttribute('role', 'radiogroup');
  const sync = () => {
    const value = get();
    for (const btn of seg.querySelectorAll('button')) {
      const on = btn.dataset.value === value;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.value = opt.value;
    btn.setAttribute('role', 'radio');
    btn.title = opt.hint || opt.label;
    btn.innerHTML = `${opt.icon ? lucide(opt.icon, 12) + ' ' : ''}${escapeHtml(opt.label)}`;
    btn.addEventListener('click', () => {
      set(opt.value);
      sync();
    });
    seg.append(btn);
  }
  sync();
  panel.__syncs.push(sync);
  return seg;
}

function ctlSlider(panel, { icon, label, min, max, step, get, set, format, hint = '' }) {
  const row = document.createElement('div');
  row.className = 'gc-slider-row';
  if (hint) row.title = hint;
  row.innerHTML = `
    <div class="gcs-head">
      <span class="gcs-label">${lucide(icon, 13)} ${escapeHtml(label)}</span>
      <span class="gcs-value"></span>
    </div>
    <input type="range" min="${min}" max="${max}" step="${step}" aria-label="${escapeHtml(label)}" />
  `;
  const slider = row.querySelector('input');
  const valueEl = row.querySelector('.gcs-value');
  const fmt = format || ((v) => v.toFixed(2));
  const sync = () => {
    const v = get();
    slider.value = String(v);
    valueEl.textContent = fmt(v);
  };
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    set(v);
    valueEl.textContent = fmt(v);
  });
  sync();
  panel.__syncs.push(sync);
  return row;
}

function ctlGroup(title, extraButton = null) {
  const group = document.createElement('div');
  group.className = 'gc-group';
  const head = document.createElement('div');
  head.className = 'gc-group-title';
  head.innerHTML = `<span>${escapeHtml(title)}</span>`;
  if (extraButton) head.append(extraButton);
  group.append(head);
  return group;
}

function ctlFieldLabel(icon, text) {
  const label = document.createElement('div');
  label.className = 'gc-field-label';
  label.innerHTML = `${lucide(icon, 12)} ${escapeHtml(text)}`;
  return label;
}

function ctlAction(icon, label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gc-action';
  btn.innerHTML = `${lucide(icon, 13)} ${escapeHtml(label)}`;
  btn.addEventListener('click', onClick);
  return btn;
}

// ---- Panel assembly ----
function setForce(key, value) {
  updateGraphSettings({ forces: { [key]: value } });
  kickSimulation(0.4);
}

function setLayer(key, value) {
  updateGraphSettings({ [key]: value });
  graph.focusFolderId = null;
  graph.hover = null;
  buildGraph();
  updateStats();
  kickSimulation(BUILD_ALPHA);
}

function buildControlsPanel({ paneMode = false } = {}) {
  injectGraphCss();
  const wrap = document.createElement('div');
  wrap.__syncs = [];
  wrap.className = 'yanta-graph-controls' + (S().controlsOpen ? '' : ' collapsed');
  wrap.setAttribute(paneMode ? 'data-graph-controls' : 'data-graph-controls-overlay', '');

  // Head (collapse toggle)
  const head = document.createElement('div');
  head.className = 'yanta-graph-controls-head';
  head.innerHTML = `
    <span class="gc-chev">${lucide('sliders-horizontal', 14)}</span>
    <span class="gc-title">Graph</span>
    <span class="gc-chev" data-gc-chevron>${lucide(S().controlsOpen ? 'chevron-up' : 'chevron-down', 13)}</span>
  `;
  head.addEventListener('click', () => {
    updateGraphSettings({ controlsOpen: !S().controlsOpen });
    wrap.classList.toggle('collapsed', !S().controlsOpen);
    head.querySelector('[data-gc-chevron]').innerHTML =
      lucide(S().controlsOpen ? 'chevron-up' : 'chevron-down', 13);
  });
  wrap.append(head);

  const body = document.createElement('div');
  body.className = 'yanta-graph-controls-body';
  wrap.append(body);

  // --- Search -------------------------------------------------
  const searchGroup = ctlGroup('Search');
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Highlight notes…';
  search.value = graph.highlight || '';
  search.addEventListener('input', (e) => {
    graph.highlight = e.target.value || '';
    recomputeSearchMatches();
  });
  searchGroup.append(search);
  searchGroup.append(ctlToggle(wrap, {
    icon: 'text-search',
    label: 'Deep search (note text)',
    get: () => S().deepSearch,
    set: (v) => {
      updateGraphSettings({ deepSearch: v });
      recomputeSearchMatches();
    },
  }));
  body.append(searchGroup);

  // --- Display ------------------------------------------------
  const displayGroup = ctlGroup('Display');
  displayGroup.append(ctlFieldLabel('type', 'Note labels'));
  displayGroup.append(ctlSegment(wrap, {
    ariaLabel: 'Note labels',
    options: [
      { value: 'off', label: 'Off', hint: 'Only on hover' },
      { value: 'smart', label: 'Smart', hint: 'Fade in with zoom' },
      { value: 'always', label: 'All', hint: 'Always visible' },
    ],
    get: () => S().noteLabels,
    set: (v) => {
      updateGraphSettings({ noteLabels: v });
      startVisualLoop();
    },
  }));
  displayGroup.append(ctlToggle(wrap, {
    icon: 'folder-open',
    label: 'Folder labels',
    get: () => S().folderLabels !== 'off',
    set: (v) => {
      updateGraphSettings({ folderLabels: v ? 'always' : 'off' });
      startVisualLoop();
    },
  }));
  displayGroup.append(ctlToggle(wrap, {
    icon: 'shapes',
    label: 'Node icons',
    get: () => S().showIcons,
    set: (v) => {
      updateGraphSettings({ showIcons: v });
      startVisualLoop();
    },
  }));
  displayGroup.append(ctlFieldLabel('circle-dot', 'Node size'));
  displayGroup.append(ctlSegment(wrap, {
    ariaLabel: 'Node size mode',
    options: [
      { value: 'uniform', label: 'Same', hint: 'All notes the same size' },
      { value: 'links', label: 'Links', hint: 'Well-connected notes grow' },
      { value: 'content', label: 'Text', hint: 'Longer notes grow' },
      { value: 'recency', label: 'New', hint: 'Recently edited notes grow' },
    ],
    get: () => S().nodeSizeMode,
    set: (v) => {
      updateGraphSettings({ nodeSizeMode: v });
      recomputeNodeMetrics();
      kickSimulation(0.35);
    },
  }));
  displayGroup.append(ctlSlider(wrap, {
    icon: 'proportions',
    label: 'Node scale',
    min: 0.6,
    max: 1.8,
    step: 0.05,
    get: () => S().nodeScale,
    set: (v) => {
      updateGraphSettings({ nodeScale: v });
      recomputeNodeMetrics();
      kickSimulation(0.3);
    },
    format: (v) => `×${v.toFixed(2)}`,
  }));
  body.append(displayGroup);

  // --- Forces -------------------------------------------------
  const resetBtn = document.createElement('button');
  resetBtn.innerHTML = `${lucide('rotate-ccw', 11)} Reset`;
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetGraphForces();
    refreshControlsUI();
    kickSimulation(0.7);
    toast('Forces reset to defaults', 'success');
  });
  const forcesGroup = ctlGroup('Forces', resetBtn);
  const pct = (v) => `${Math.round(v * 100)}%`;
  forcesGroup.append(ctlSlider(wrap, {
    icon: 'crosshair', label: 'Center force',
    min: 0, max: 1, step: 0.02,
    get: () => S().forces.center,
    set: (v) => setForce('center', v),
    format: pct,
    hint: 'Pull toward the canvas center (0 = drift freely).',
  }));
  forcesGroup.append(ctlSlider(wrap, {
    icon: 'expand', label: 'Repel force',
    min: 0, max: 1, step: 0.02,
    get: () => S().forces.repel,
    set: (v) => setForce('repel', v),
    format: pct,
    hint: 'How strongly nodes push each other apart.',
  }));
  forcesGroup.append(ctlSlider(wrap, {
    icon: 'link', label: 'Link force',
    min: 0, max: 1, step: 0.02,
    get: () => S().forces.link,
    set: (v) => setForce('link', v),
    format: pct,
    hint: 'How strongly linked notes pull together.',
  }));
  forcesGroup.append(ctlSlider(wrap, {
    icon: 'ruler', label: 'Link distance',
    min: 0.4, max: 2.2, step: 0.05,
    get: () => S().forces.linkDistance,
    set: (v) => setForce('linkDistance', v),
    format: (v) => `×${v.toFixed(2)}`,
    hint: 'Resting length of links.',
  }));
  forcesGroup.append(ctlSlider(wrap, {
    icon: 'folder', label: 'Folder pull',
    min: 0, max: 1, step: 0.02,
    get: () => S().forces.folderPull,
    set: (v) => setForce('folderPull', v),
    format: pct,
    hint: 'How tightly notes cluster around their folder.',
  }));
  forcesGroup.append(ctlToggle(wrap, {
    icon: 'circle-slash-2',
    label: 'Prevent overlap',
    get: () => S().forces.collide,
    set: (v) => setForce('collide', v),
  }));
  body.append(forcesGroup);

  // --- Layers -------------------------------------------------
  const layersGroup = ctlGroup('Layers');
  layersGroup.append(ctlToggle(wrap, {
    icon: 'folder',
    label: 'Show folders',
    get: () => S().showFolders,
    set: (v) => setLayer('showFolders', v),
  }));
  layersGroup.append(ctlToggle(wrap, {
    icon: 'sparkles',
    label: 'Semantic suggestions',
    get: () => S().showSemantic,
    set: (v) => setLayer('showSemantic', v),
  }));
  if (graphArchiveExists()) {
    layersGroup.append(ctlToggle(wrap, {
      icon: 'archive',
      label: 'Show archive',
      get: () => S().showArchive,
      set: (v) => setLayer('showArchive', v),
    }));
  }
  if (graphAiBrainExists()) {
    layersGroup.append(ctlToggle(wrap, {
      icon: 'brain-circuit',
      label: 'Show AI Brain',
      get: () => S().showAiBrain,
      set: (v) => setLayer('showAiBrain', v),
    }));
  }
  body.append(layersGroup);

  // --- View ---------------------------------------------------
  const viewGroup = ctlGroup('View');
  const actionsRow = document.createElement('div');
  actionsRow.className = 'gc-actions-row';
  actionsRow.append(
    ctlAction('crosshair', 'Recenter', () => recenterAll()),
    ctlAction('scan', 'Fit all', () => fitToView({ animated: true }))
  );
  viewGroup.append(actionsRow);
  viewGroup.append(ctlToggle(wrap, {
    icon: 'panel-right',
    label: 'Show in side pane',
    get: () => graph.mode === 'pane',
    set: () => {
      if (graph.mode === 'pane') {
        closeGraphPane();
        updateGraphSettings({ preferPane: false });
      } else {
        openGraphPane();
      }
    },
  }));
  body.append(viewGroup);

  const hint = document.createElement('div');
  hint.className = 'gc-hint';
  hint.textContent =
    'Middle-click to pan · right-click for actions · double-click a note to open.';
  body.append(hint);

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

export function openGraphPane() {
  /*
    Only open the graph pane when the real right preview pane is visible.
    From Dashboard/Calendar/edit-only the pane would be invisible or
    measured incorrectly — fall back to the stable fullscreen overlay.
  */
  if (!canOpenGraphPaneNow()) {
    openGraph({ forceOverlay: true });
    return;
  }
  injectGraphCss();
  closeGraph();
  const body = openSidePane({
    kind: 'graph',
    title: 'Graph',
    icon: 'network',
    className: 'yanta-graph-side-pane',
    onClose: () => {
      stopSimulation();
      hideGraphNotePreview();
      hideContextMenu();
      if (graph.mode === 'pane') {
        graph.canvas = null;
        graph.ctx = null;
        graph.mode = 'overlay';
      }
      graph.paneHost = null;
      graph.paneCanvas = null;
    },
  });
  if (!body) return;
  updateGraphSettings({ preferPane: true });
  body.innerHTML = `
    <div class="graph-canvas-wrap">
      <canvas class="graph-canvas" data-graph-pane-canvas></canvas>
      <div class="yanta-graph-stats" data-graph-stats></div>
    </div>
  `;
  graph.paneHost = body;
  graph.paneCanvas = body.querySelector('[data-graph-pane-canvas]');
  const canvasWrap = body.querySelector('.graph-canvas-wrap');
  canvasWrap.append(buildControlsPanel({ paneMode: true }));
  activateCanvas(graph.paneCanvas, 'pane');
  graph.scale = 1;
  graph.ox = 0;
  graph.oy = 0;
  graph.highlight = '';
  graph.hasQuery = false;
  graph.focusFolderId = null;
  graph.hover = null;
  buildGraph();
  updateStats();
  refreshControlsUI();
  kickSimulation(BUILD_ALPHA);
  /*
    Side-pane layout settles over the next frames; re-measure so the
    canvas doesn't stay at a stale height, then fit the view.
  */
  requestAnimationFrame(() => {
    resizeGraphCanvas();
    fitToView({ animated: false });
    requestAnimationFrame(() => {
      resizeGraphCanvas();
      fitToView({ animated: false });
      drawGraph();
    });
  });
}

function closeGraphPane({ silent = false, preservePreference = false } = {}) {
  if (!isSidePaneOpen('graph')) return;
  closeSidePane({ silent });
  if (!preservePreference) {
    updateGraphSettings({ preferPane: false });
  }
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------
function canOpenGraphPaneNow() {
  const pane = $('panePreview');
  return (
    window.innerWidth >= WIDE_PANE_MIN_WIDTH &&
    state.surface === 'note' &&
    state.view === 'split' &&
    !!pane &&
    pane.offsetParent !== null
  );
}

function ensureOverlayChrome() {
  injectGraphCss();
  const wrap = $('graphCanvasWrap');
  if (!wrap) return;
  // Hide the legacy legend if present — replaced by the slim stats badge.
  const legacyLegend = $('graphLegend');
  if (legacyLegend) legacyLegend.style.display = 'none';
  if (!wrap.querySelector('[data-graph-stats-overlay]')) {
    const stats = document.createElement('div');
    stats.className = 'yanta-graph-stats';
    stats.setAttribute('data-graph-stats-overlay', '');
    wrap.append(stats);
  }
  if (!wrap.querySelector('[data-graph-controls-overlay]')) {
    wrap.append(buildControlsPanel({ paneMode: false }));
  }
  // Hide the legacy header search field; the controls panel has its own.
  const legacySearch = $('graphSearch');
  if (legacySearch) legacySearch.style.display = 'none';
}

export function openGraph({ forceOverlay = false, fromHistory = false } = {}) {
  injectGraphCss();
  if (!forceOverlay && S().preferPane && canOpenGraphPaneNow()) {
    openGraphPane();
    return;
  }
  closeGraphPane({ silent: true, preservePreference: true });
  const overlay = $('graphOverlay');
  if (!overlay) return;
  const wasClosed = overlay.hidden !== false;
  overlay.hidden = false;
  registerGraphOverlayRoute();
  if (!fromHistory && wasClosed) {
    pushOverlayState('graph');
  }
  ensureOverlayChrome();
  const c = $('graphCanvas');
  graph.overlayCanvas = c;
  activateCanvas(c, 'overlay');
  graph.scale = 1;
  graph.ox = 0;
  graph.oy = 0;
  graph.highlight = '';
  graph.hasQuery = false;
  graph.focusFolderId = null;
  graph.hover = null;
  buildGraph();
  updateStats();
  refreshControlsUI();
  kickSimulation(BUILD_ALPHA);
  requestAnimationFrame(() => {
    resizeGraphCanvas();
    fitToView({ animated: false });
  });
}

function closeGraphUI() {
  if (graph.mode !== 'overlay') return;
  stopSimulation();
  hideGraphNotePreview();
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

export function closeGraph({ fromHistory = false } = {}) {
  if (!fromHistory && graphOverlayIsOpen()) {
    closeTopOverlay(() => closeGraphUI());
    return;
  }
  closeGraphUI();
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
    // Any user interaction cancels a running view tween.
    graph.viewTween = null;
    graph.pointerId = e.pointerId;
    graph.pressMx = e.clientX;
    graph.pressMy = e.clientY;
    graph.moved = 0;
    graph.longPressFired = false;
    graph.suppressNextClick = false;
    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    // Middle mouse button → always pan.
    if (e.button === 1) {
      e.preventDefault();
      hideGraphNotePreview();
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
      if (hit) showNodeContextMenu(hit, e.clientX, e.clientY);
      else showEmptyContextMenu(e.clientX, e.clientY);
      return;
    }
    if (hit) {
      hideGraphNotePreview();
      graph.dragNode = hit;
      graph.dragMx = pos.x - hit.x;
      graph.dragMy = pos.y - hit.y;
      hit.vx = 0;
      hit.vy = 0;
      hit.fx = hit.x;
      hit.fy = hit.y;
      c.classList.add('dragging');
      c.setPointerCapture?.(e.pointerId);
      // Long press → context menu (notes AND folders).
      clearLongPressTimer();
      graph.longPressTimer = setTimeout(() => {
        if (!graph.dragNode || graph.dragNode !== hit) return;
        if (graph.moved > LONG_PRESS_MOVE_TOLERANCE) return;
        graph.longPressFired = true;
        graph.suppressNextClick = true;
        hit.fx = null;
        hit.fy = null;
        graph.dragNode = null;
        graph.panning = false;
        setAlphaTarget(0);
        c.classList.remove('dragging');
        showNodeContextMenu(hit, e.clientX, e.clientY);
        startVisualLoop();
      }, LONG_PRESS_MS);
      // d3-style: keep the layout gently warm while dragging.
      setAlphaTarget(SIM.dragAlphaTarget);
      kickSimulation(0.35);
    } else {
      hideGraphNotePreview();
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
    if (graph.moved > LONG_PRESS_MOVE_TOLERANCE) clearLongPressTimer();
    if (graph.dragNode) {
      const pos = canvasCoords(e);
      const nx = pos.x - graph.dragMx;
      const ny = pos.y - graph.dragMy;
      graph.dragNode.x = nx;
      graph.dragNode.y = ny;
      graph.dragNode.vx = 0;
      graph.dragNode.vy = 0;
      graph.dragNode.fx = nx;
      graph.dragNode.fy = ny;
      wakeSimulation();
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
    const releasedNode = graph.dragNode;
    graph.dragNode = null;
    if (releasedNode) {
      releasedNode.fx = null;
      releasedNode.fy = null;
    }
    graph.panning = false;
    graph.pointerId = null;
    c.classList.remove('dragging');
    try {
      c.releasePointerCapture?.(e.pointerId);
    } catch {}
    // Cool down smoothly (d3: alphaTarget back to 0 on drag end).
    setAlphaTarget(0);
    if (graph.longPressFired) {
      graph.suppressNextClick = true;
    }
    startVisualLoop();
  });

  c.addEventListener('pointercancel', () => {
    clearLongPressTimer();
    if (graph.dragNode) {
      graph.dragNode.fx = null;
      graph.dragNode.fy = null;
    }
    graph.dragNode = null;
    graph.panning = false;
    graph.pointerId = null;
    setAlphaTarget(0);
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
      openPreviewForNode(hit, e.clientX, e.clientY);
      return;
    }
    if (hit.type === NODE.FOLDER) {
      hideGraphNotePreview();
      graph.focusFolderId = graph.focusFolderId === hit.id ? null : hit.id;
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
    hideGraphNotePreview();
    if (graph.mode === 'overlay') closeGraph();
    await openNote(hit.id);
  });

  c.addEventListener('contextmenu', (e) => {
    if (!graph.canvas || c !== graph.canvas || !graphVisible()) return;
    e.preventDefault();
    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);
    if (hit) showNodeContextMenu(hit, e.clientX, e.clientY);
    else showEmptyContextMenu(e.clientX, e.clientY);
  });

  c.addEventListener('wheel', (e) => {
    if (!graph.canvas || c !== graph.canvas || !graphVisible()) return;
    e.preventDefault();
    graph.viewTween = null;
    const r = c.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, graph.scale * factor));
    const wx = (mx - graph.ox) / graph.scale;
    const wy = (my - graph.oy) / graph.scale;
    graph.scale = ns;
    graph.ox = mx - wx * graph.scale;
    graph.oy = my - wy * graph.scale;
    startVisualLoop();
  }, { passive: false });

  installGraphPinchZoom(c);
}

export function setupGraphInteractions() {
  injectGraphCss();
  registerGraphOverlayRoute();
  ensureContextMenuCloseHandlers();
  const c = $('graphCanvas');
  if (c) bindGraphCanvas(c);

  // Keep the legacy header search wired (hidden, but harmless).
  $('graphSearch')?.addEventListener('input', (e) => {
    graph.highlight = e.target.value || '';
    recomputeSearchMatches();
  });
  $('graphRecenter')?.addEventListener('click', () => recenterAll());
  $('graphClose')?.addEventListener('click', closeGraph);

  // Resize: only re-measure the canvas and gently reheat.
  // (A full rebuild on every resize event destroyed layout stability.)
  const onResize = debounce(() => {
    if (!graphVisible()) return;
    resizeGraphCanvas();
    kickSimulation(0.25);
  }, 150);
  window.addEventListener('resize', onResize);

  // Note bodies changed while the pane graph is visible → rebuild links.
  const rebuildFromPreview = debounce(() => {
    if (graph.mode === 'pane' && graphVisible()) {
      buildGraph();
      updateStats();
      kickSimulation(0.3);
    }
  }, 400);
  window.addEventListener('yanta-preview-rendered', rebuildFromPreview);

  // Keep the open preview popover in sync with live note edits.
  window.addEventListener('yanta-note-updated', (e) => {
    const noteId = e.detail?.noteId;
    if (noteId) refreshGraphNotePreview(noteId);
  });

  window.addEventListener('yanta-appearance-changed', () => {
    iconCache.clear();
    if (!graphVisible()) return;
    buildGraph();
    updateStats();
    refreshControlsUI();
    kickSimulation(0.35);
  });

  if (!settingsSubscribed) {
    settingsSubscribed = true;
    onGraphSettingsChange(() => {
      refreshControlsUI();
      startVisualLoop();
    });
  }
}