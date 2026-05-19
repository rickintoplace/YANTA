// ============================================================
// YANTA — Interactive icon graph view (canvas).
// Nodes = notes (+ optionally folders). Edges = wikilinks (+ optionally
// folder structure). Pan/zoom/drag/search.
// UX:
// - No artificial "Vault" center node.
// - No permanent motion/rotation: simulation cools down and stops.
// - Hover/search/focus only redraws, never re-heats physics -> no jitter.
// - Toggle folders on/off: notes-only graph possible.
// ============================================================

import { $, state, lucide, safeCssColor } from './core.js';
import { wikilinkIndex } from './features-state.js';
import { openNote } from './notes.js';
import { noteMarkdown } from './yjs.js';

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;

const NODE = {
  NOTE: 'note',
  FOLDER: 'folder',
};

const LINK = {
  WIKI: 'wiki',
  CONTAINS: 'contains',
  FOLDER: 'folder',
};

const GRAPH_PREFS_KEY = 'yanta.graph.showFolders';

const graph = {
  nodes: [],
  links: [],
  idIndex: new Map(),
  adj: new Map(),

  // folderId -> Set<graphNodeId>
  descendantsByFolder: new Map(),

  canvas: null,
  ctx: null,
  raf: 0,

  // Force simulation state.
  simRunning: false,
  simAlpha: 0,
  simMinAlpha: 0.012,

  scale: 1,
  ox: 0,
  oy: 0,

  dragNode: null,
  dragMx: 0,
  dragMy: 0,
  panning: false,

  hover: null,
  highlight: '',
  focusFolderId: null,

  showFolders: readShowFoldersPref(),

  // Avoid "click" after drag.
  pressMx: 0,
  pressMy: 0,
  moved: 0,
};

// SVG image cache for icon drawing on canvas.
// key = icon|color|size -> { img, ready }
const iconCache = new Map();

function readShowFoldersPref() {
  try {
    const v = localStorage.getItem(GRAPH_PREFS_KEY);
    return v == null ? true : v !== 'false';
  } catch {
    return true;
  }
}

function writeShowFoldersPref(v) {
  try {
    localStorage.setItem(GRAPH_PREFS_KEY, String(!!v));
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

function canvasCssSize() {
  if (!graph.canvas) return { w: 1200, h: 800 };

  const r = graph.canvas.getBoundingClientRect();

  return {
    w: Math.max(1, r.width || graph.canvas.clientWidth || 1200),
    h: Math.max(1, r.height || graph.canvas.clientHeight || 800),
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

function addNode(node) {
  graph.idIndex.set(node.gid, graph.nodes.length);
  graph.nodes.push(node);
}

function addLink(aGid, bGid, kind, weight = 1) {
  const a = graph.idIndex.get(aGid);
  const b = graph.idIndex.get(bGid);

  if (a == null || b == null || a === b) return;

  graph.links.push({ a, b, kind, weight });

  graph.nodes[a].degree++;
  graph.nodes[b].degree++;

  if (kind === LINK.WIKI) {
    graph.nodes[a].wikiDegree++;
    graph.nodes[b].wikiDegree++;
  }

  if (!graph.adj.has(a)) graph.adj.set(a, new Set());
  if (!graph.adj.has(b)) graph.adj.set(b, new Set());

  graph.adj.get(a).add(b);
  graph.adj.get(b).add(a);
}

function buildDescendantSets() {
  graph.descendantsByFolder.clear();

  for (const f of state.folders.values()) {
    graph.descendantsByFolder.set(f.id, new Set([graphIdForFolder(f.id)]));
  }

  // Folder descendants.
  for (const f of state.folders.values()) {
    let cur = f;

    while (cur?.parentId) {
      graph.descendantsByFolder.get(cur.parentId)?.add(graphIdForFolder(f.id));
      cur = state.folders.get(cur.parentId);
    }
  }

  // Note descendants.
  for (const n of state.notes.values()) {
    if (!n.folderId) continue;

    let f = state.folders.get(n.folderId);

    while (f) {
      graph.descendantsByFolder.get(f.id)?.add(graphIdForNote(n.id));
      f = f.parentId ? state.folders.get(f.parentId) : null;
    }
  }
}

function topLevelFolderIds() {
  return [...state.folders.values()]
    .filter((f) => !f.parentId || !state.folders.has(f.parentId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map((f) => f.id);
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

  const radius = Math.min(w, h) * 0.28;

  groups.forEach((id, i) => {
    // Deterministic, no animation/rotation.
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
  const center = centers.get(root) || centers.values().next().value || canvasCssSize();

  const depth = folderDepth(folder.id);
  const i = indexByRoot.get(root) || 0;

  indexByRoot.set(root, i + 1);

  const angle = -Math.PI / 2 + i * 1.919862177; // deterministic spread
  const radius = depth === 0 ? 0 : 72 + depth * 78 + (i % 4) * 16;

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

    const angle = -Math.PI / 2 + i * 2.399963229728653; // golden angle
    const radius = 52 + Math.floor(i / 7) * 34 + (i % 7) * 4;

    return {
      x: parent.x + Math.cos(angle) * radius,
      y: parent.y + Math.sin(angle) * radius,
    };
  }

  // Notes-only mode: cluster notes by their top-level folder,
  // but don't render folder nodes.
  const root = note.folderId ? folderRootId(note.folderId) : '__ungrouped__';
  const center = centers.get(root) || centers.get('__ungrouped__') || centers.values().next().value || canvasCssSize();

  const key = root || '__ungrouped__';
  const i = noteIndexByGroup.get(key) || 0;

  noteIndexByGroup.set(key, i + 1);

  const angle = -Math.PI / 2 + i * 2.399963229728653;
  const radius = 50 + Math.floor(i / 9) * 42 + (i % 9) * 5;

  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function buildGraph() {
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

    folders.forEach((f) => {
      const p = initialFolderPosition(f, folderIndexByRoot, centers);
      const color = safeMetaColor(f.color, t.yellow);

      const node = {
        gid: graphIdForFolder(f.id),
        id: f.id,
        type: NODE.FOLDER,
        title: f.name || 'Folder',
        subtitle: folderPath(f.id).join(' / ') || 'Folder',
        icon: f.icon || 'folder',
        color,
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        degree: 0,
        wikiDegree: 0,
        radius: 15,
        physicsRadius: 16,
        folderId: f.id,
      };

      folderNodeById.set(f.id, node);
      addNode(node);
    });
  }

  const noteIndexByGroup = new Map();

  notes.forEach((n) => {
    const p = initialNotePosition(n, noteIndexByGroup, centers, folderNodeById);

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
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
      degree: 0,
      wikiDegree: 0,
      radius: 12,
      physicsRadius: 13,
      noteId: n.id,
      folderId: n.folderId || null,
      pinned: !!n.pinned,
    });
  });

  // Folder hierarchy links.
  if (graph.showFolders) {
    for (const f of folders) {
      if (f.parentId && state.folders.has(f.parentId)) {
        addLink(graphIdForFolder(f.parentId), graphIdForFolder(f.id), LINK.FOLDER, 1.3);
      }
    }

    // Folder -> note links.
    for (const n of notes) {
      if (n.folderId && state.folders.has(n.folderId)) {
        addLink(graphIdForFolder(n.folderId), graphIdForNote(n.id), LINK.CONTAINS, 1.2);
      }
    }
  }

  // Wikilink edges note -> note.
  const wikiSeenGlobal = new Set();

  for (const n of notes) {
    let body = '';

    try {
      body = noteMarkdown(n.id);
    } catch {}

    const seenTargets = new Set();
    WIKILINK_RE.lastIndex = 0;

    let m;

    while ((m = WIKILINK_RE.exec(body)) !== null) {
      const tid = wikilinkIndex.get(m[1].trim().toLowerCase());

      if (!tid || tid === n.id || seenTargets.has(tid)) continue;

      seenTargets.add(tid);

      const aGid = graphIdForNote(n.id);
      const bGid = graphIdForNote(tid);
      const key = [aGid, bGid].sort().join('::');

      if (wikiSeenGlobal.has(key)) continue;

      wikiSeenGlobal.add(key);
      addLink(aGid, bGid, LINK.WIKI, 1);
    }
  }

  buildDescendantSets();
}

function stepGraph() {
  if (!graph.canvas) return 0;

  const ns = graph.nodes;
  const ls = graph.links;

  // No random noise, no tangential force, no rotation.
  const alpha = graph.simAlpha;
  const repulsion = 1650 * alpha;
  const damping = 0.76;
  const centerGravity = graph.showFolders ? 0.0025 * alpha : 0.0035 * alpha;

  const { w, h } = canvasCssSize();
  const cx = w / 2;
  const cy = h / 2;

  let energy = 0;

  for (const n of ns) {
    n.fx = 0;
    n.fy = 0;
  }

  // Repulsion.
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i];
      const b = ns[j];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 90;
      const d = Math.sqrt(d2);

      const sizeFactor = ((a.physicsRadius || 12) + (b.physicsRadius || 12)) / 24;
      const f = (repulsion * sizeFactor) / d2;

      const fx = (dx / d) * f;
      const fy = (dy / d) * f;

      a.fx -= fx;
      a.fy -= fy;
      b.fx += fx;
      b.fy += fy;
    }
  }

  // Link attraction.
  for (const l of ls) {
    const a = ns[l.a];
    const b = ns[l.b];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;

    let desired = 135;
    let strength = 0.010 * alpha;

    if (l.kind === LINK.FOLDER) {
      desired = 105;
      strength = 0.020 * alpha;
    } else if (l.kind === LINK.CONTAINS) {
      desired = 72;
      strength = 0.030 * alpha;
    } else if (l.kind === LINK.WIKI) {
      desired = graph.showFolders ? 155 : 125;
      strength = 0.012 * alpha;
    }

    strength *= l.weight || 1;

    const delta = d - desired;
    const f = delta * strength;

    const fx = (dx / d) * f;
    const fy = (dy / d) * f;

    a.fx += fx;
    a.fy += fy;
    b.fx -= fx;
    b.fy -= fy;
  }

  // Soft pull to viewport center.
  for (const n of ns) {
    n.fx += (cx - n.x) * centerGravity;
    n.fy += (cy - n.y) * centerGravity;

    // Notes get a subtle pull toward their folder cluster only while simulation runs.
    if (graph.showFolders && n.type === NODE.NOTE && n.folderId) {
      const folderIdx = graph.idIndex.get(graphIdForFolder(n.folderId));

      if (folderIdx != null) {
        const f = ns[folderIdx];

        n.fx += (f.x - n.x) * 0.004 * alpha;
        n.fy += (f.y - n.y) * 0.004 * alpha;
      }
    }

    n.vx = (n.vx + n.fx) * damping;
    n.vy = (n.vy + n.fy) * damping;

    if (graph.dragNode !== n) {
      n.x += n.vx;
      n.y += n.vy;
    }

    energy += Math.abs(n.vx) + Math.abs(n.vy);
  }

  graph.simAlpha *= 0.94;

  return energy;
}

function startSimulation(alpha = 1) {
  graph.simAlpha = Math.max(graph.simAlpha || 0, alpha);

  if (graph.simRunning) return;

  graph.simRunning = true;
  cancelAnimationFrame(graph.raf);
  graph.raf = requestAnimationFrame(animate);
}

function stopSimulation() {
  graph.simRunning = false;
  graph.simAlpha = 0;
  cancelAnimationFrame(graph.raf);

  // Kill residual velocities so redraw-only interactions never jitter.
  for (const n of graph.nodes) {
    n.vx = 0;
    n.vy = 0;
    n.fx = 0;
    n.fy = 0;
  }
}

function animate() {
  if (!graph.simRunning) return;

  const energy = stepGraph();
  drawGraph();

  if (graph.simAlpha < graph.simMinAlpha || energy < 0.08) {
    stopSimulation();
    drawGraph();
    return;
  }

  graph.raf = requestAnimationFrame(animate);
}

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

  // lucide() uses currentColor; for canvas images we bake the actual color in.
  svg = svg.replace(/stroke="currentColor"/g, `stroke="${escapeSvgAttr(cleanColor)}"`);
  svg = svg.replace(/<svg /, `<svg color="${escapeSvgAttr(cleanColor)}" `);

  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  const rec = { img, ready: false };
  iconCache.set(key, rec);

  img.onload = () => {
    rec.ready = true;
    drawGraph();
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

function isSearchMatch(node) {
  const q = graph.highlight.trim().toLowerCase();
  if (!q) return false;

  return [
    node.title || '',
    node.subtitle || '',
    node.type || '',
  ].join(' ').toLowerCase().includes(q);
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

function drawLink(ctx, link, t) {
  const a = graph.nodes[link.a];
  const b = graph.nodes[link.b];

  const dimmed = linkDimmed(link);

  let color = t.border;
  let alpha = dimmed ? 0.10 : 0.55;
  let width = 1.15;

  if (link.kind === LINK.WIKI) {
    color = t.accent;
    alpha = dimmed ? 0.12 : 0.58;
    width = 1.35;
    ctx.setLineDash([]);
  } else if (link.kind === LINK.FOLDER) {
    color = t.yellow;
    alpha = dimmed ? 0.08 : 0.32;
    width = 1.0;
    ctx.setLineDash([5 / graph.scale, 5 / graph.scale]);
  } else if (link.kind === LINK.CONTAINS) {
    color = t.textFaint;
    alpha = dimmed ? 0.07 : 0.24;
    width = 1.0;
    ctx.setLineDash([3 / graph.scale, 6 / graph.scale]);
  }

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width / graph.scale;

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawNode(ctx, node, t) {
  const current = isCurrent(node);
  const hover = graph.hover === node;
  const matched = isSearchMatch(node);
  const dimmed = nodeDimmed(node);

  // Important: visual radius does NOT feed back into physics.
  // This avoids selection/hover jitter.
  const baseR =
    node.type === NODE.FOLDER
      ? 15 + Math.min(5, Math.sqrt(node.degree || 0) * 1.2)
      : 12 + Math.min(5, Math.sqrt(node.wikiDegree || node.degree || 0) * 1.35);

  const r = baseR + (current ? 4 : 0) + (hover ? 3 : 0) + (matched ? 2 : 0);
  const hitR = baseR + 7;
  const color = node.color || (node.type === NODE.FOLDER ? t.yellow : t.text);

  node.radius = r;
  node.hitRadius = hitR;

  ctx.save();

  ctx.globalAlpha = dimmed ? 0.28 : 1;

  if (hover || current || matched) {
    ctx.shadowColor = current ? t.accent : color;
    ctx.shadowBlur = hover ? 18 : 12;
  }

  // Backplate.
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.fillStyle = node.type === NODE.FOLDER ? t.bgElev3 : t.bgElev2;
  ctx.fill();

  ctx.shadowBlur = 0;

  // Ring.
  ctx.strokeStyle = current || matched ? t.accent : color;
  ctx.lineWidth = (current ? 2.4 : node.type === NODE.FOLDER ? 1.8 : 1.45) / graph.scale;
  ctx.stroke();

  // Small pin marker.
  if (node.pinned) {
    ctx.beginPath();
    ctx.arc(node.x + r * 0.58, node.y - r * 0.58, Math.max(2.2, r * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = t.yellow;
    ctx.fill();
  }

  // Icon.
  const iconSize = node.type === NODE.FOLDER ? 22 : 20;
  const img = iconImage(node.icon || 'square', color, 28);

  if (img) {
    ctx.drawImage(
      img,
      node.x - iconSize / 2,
      node.y - iconSize / 2,
      iconSize,
      iconSize
    );
  } else {
    // Non-dot fallback while SVG loads: a small rounded glyph tile.
    const s = iconSize * 0.72;
    roundedRect(ctx, node.x - s / 2, node.y - s / 2, s, s, 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / graph.scale;
    ctx.stroke();
  }

  // Labels.
  const showLabel =
    graph.scale > 0.62 ||
    hover ||
    current ||
    matched ||
    node.type === NODE.FOLDER;

  if (showLabel) {
    const label = node.title.length > 34 ? node.title.slice(0, 34) + '…' : node.title;

    const fontSize = Math.max(9, 11 / Math.sqrt(graph.scale));
    ctx.font = `${fontSize.toFixed(1)}px ${t.font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const x = node.x + r + 7;
    const y = node.y;

    // Label background for readability.
    const metrics = ctx.measureText(label);
    const padX = 5;
    const padY = 3;

    ctx.globalAlpha = dimmed ? 0.18 : 0.78;
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

    ctx.globalAlpha = dimmed ? 0.38 : 1;
    ctx.fillStyle =
      current
        ? t.accent
        : node.type === NODE.FOLDER
          ? color
          : t.text;

    ctx.fillText(label, x, y);

    if ((hover || matched) && node.subtitle) {
      const sub = node.subtitle.length > 42 ? node.subtitle.slice(0, 42) + '…' : node.subtitle;
      const subFont = Math.max(8, 9 / Math.sqrt(graph.scale));

      ctx.font = `${subFont.toFixed(1)}px ${t.font}`;
      ctx.fillStyle = t.textFaint;
      ctx.fillText(sub, x, y + fontSize + 4);
    }
  }

  ctx.restore();
}

function drawGraph() {
  const c = graph.canvas;
  const ctx = graph.ctx;

  if (!c || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
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

  // Draw structure links behind wikilinks.
  for (const kind of [LINK.FOLDER, LINK.CONTAINS, LINK.WIKI]) {
    for (const l of graph.links) {
      if (l.kind === kind) drawLink(ctx, l, t);
    }
  }

  // Less important nodes first, highlighted nodes last.
  const ordered = [...graph.nodes].sort((a, b) => {
    const ia = (isCurrent(a) ? 10 : 0) + (graph.hover === a ? 8 : 0) + (isSearchMatch(a) ? 6 : 0);
    const ib = (isCurrent(b) ? 10 : 0) + (graph.hover === b ? 8 : 0) + (isSearchMatch(b) ? 6 : 0);

    return ia - ib;
  });

  for (const n of ordered) drawNode(ctx, n, t);
}

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

function centerOnNode(node, scale = Math.max(1.15, graph.scale)) {
  const { w, h } = canvasCssSize();

  graph.scale = Math.max(0.25, Math.min(4.5, scale));
  graph.ox = w / 2 - node.x * graph.scale;
  graph.oy = h / 2 - node.y * graph.scale;

  drawGraph();
}

function recenterAll() {
  graph.scale = 1;
  graph.ox = 0;
  graph.oy = 0;
  graph.focusFolderId = null;

  drawGraph();
  updateLegend();
}

function legendHtml() {
  const noteCount = graph.nodes.filter((n) => n.type === NODE.NOTE).length;
  const folderCount = graph.nodes.filter((n) => n.type === NODE.FOLDER).length;
  const wikiCount = graph.links.filter((l) => l.kind === LINK.WIKI).length;
  const folderFocus = graph.focusFolderId ? state.folders.get(graph.focusFolderId) : null;

  const parts = [
    graph.showFolders
      ? `<div><strong>${noteCount}</strong> notes · <strong>${folderCount}</strong> folders · <strong>${wikiCount}</strong> links</div>`
      : `<div><strong>${noteCount}</strong> notes · <strong>${wikiCount}</strong> links · folders hidden</div>`,
    graph.showFolders
      ? '<div>Icons = note/folder metadata · dashed lines = folder structure</div>'
      : '<div>Notes-only mode · folder paths are still used for initial clustering</div>',
    '<div>Scroll: zoom · Drag background: pan · Drag node: move</div>',
  ];

  if (folderFocus && graph.showFolders) {
    parts.push(`<div>Focused folder: <strong>${folderFocus.name || 'Folder'}</strong> · click it again to clear</div>`);
  }

  return parts.join('');
}

function updateLegend() {
  const legend = $('graphLegend');
  if (legend) legend.innerHTML = legendHtml();
}

function ensureGraphControls() {
  const head = document.querySelector('.graph-head');
  const recenter = $('graphRecenter');

  if (!head || !recenter) return;

  let btn = $('graphToggleFolders');

  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'btn';
    btn.id = 'graphToggleFolders';
    btn.type = 'button';
    btn.title = 'Show/hide folder nodes';

    btn.addEventListener('click', () => {
      graph.showFolders = !graph.showFolders;
      writeShowFoldersPref(graph.showFolders);

      graph.focusFolderId = null;
      graph.hover = null;

      updateFolderToggleButton();
      buildGraph();
      updateLegend();
      drawGraph();
      startSimulation(1);
    });

    head.insertBefore(btn, recenter);
  }

  updateFolderToggleButton();
}

function updateFolderToggleButton() {
  const btn = $('graphToggleFolders');
  if (!btn) return;

  btn.innerHTML = graph.showFolders
    ? `${lucide('folder', 13)} Folders on`
    : `${lucide('file', 13)} Notes only`;

  btn.classList.toggle('active', graph.showFolders);
}

export function openGraph() {
  $('graphOverlay').hidden = false;

  ensureGraphControls();

  const c = $('graphCanvas');

  graph.canvas = c;
  graph.ctx = c.getContext('2d');

  resizeGraphCanvas();

  graph.scale = 1;
  graph.ox = 0;
  graph.oy = 0;
  graph.highlight = $('graphSearch')?.value || '';
  graph.focusFolderId = null;
  graph.hover = null;

  buildGraph();
  updateLegend();
  updateFolderToggleButton();

  drawGraph();
  startSimulation(1);
}

export function closeGraph() {
  stopSimulation();
  $('graphOverlay').hidden = true;
}

function resizeGraphCanvas() {
  if (!graph.canvas) return;

  const wrap = $('graphCanvasWrap');
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  graph.canvas.width = Math.max(1, Math.floor(r.width * dpr));
  graph.canvas.height = Math.max(1, Math.floor(r.height * dpr));
  graph.canvas.style.width = r.width + 'px';
  graph.canvas.style.height = r.height + 'px';

  drawGraph();
}

export function setupGraphInteractions() {
  const c = $('graphCanvas');

  c.addEventListener('mousedown', (e) => {
    if (!graph.canvas || $('graphOverlay').hidden) return;

    graph.pressMx = e.clientX;
    graph.pressMy = e.clientY;
    graph.moved = 0;

    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    if (hit) {
      // While user drags, stop simulation to avoid fighting the pointer.
      stopSimulation();

      graph.dragNode = hit;
      graph.dragMx = pos.x - hit.x;
      graph.dragMy = pos.y - hit.y;
      c.classList.add('dragging');
    } else {
      graph.panning = true;
      graph.dragMx = e.clientX;
      graph.dragMy = e.clientY;
      c.classList.add('dragging');
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!graph.canvas || $('graphOverlay').hidden) return;

    graph.moved = Math.max(
      graph.moved,
      Math.hypot(e.clientX - graph.pressMx, e.clientY - graph.pressMy)
    );

    if (graph.dragNode) {
      const pos = canvasCoords(e);

      graph.dragNode.x = pos.x - graph.dragMx;
      graph.dragNode.y = pos.y - graph.dragMy;
      graph.dragNode.vx = 0;
      graph.dragNode.vy = 0;

      drawGraph();
      return;
    }

    if (graph.panning) {
      graph.ox += e.clientX - graph.dragMx;
      graph.oy += e.clientY - graph.dragMy;
      graph.dragMx = e.clientX;
      graph.dragMy = e.clientY;

      drawGraph();
      return;
    }

    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    if (hit !== graph.hover) {
      graph.hover = hit;
      c.style.cursor = hit ? 'pointer' : 'grab';

      // Hover only redraws. No simulation -> no arbitrary jitter.
      drawGraph();
    }
  });

  window.addEventListener('mouseup', () => {
    const hadDragNode = !!graph.dragNode;

    graph.dragNode = null;
    graph.panning = false;

    if (graph.canvas) graph.canvas.classList.remove('dragging');

    // After a node drag, do a small deterministic settle and stop.
    if (hadDragNode) startSimulation(0.28);
  });

  c.addEventListener('mouseleave', () => {
    if (graph.dragNode || graph.panning) return;

    graph.hover = null;
    c.style.cursor = 'grab';
    drawGraph();
  });

  c.addEventListener('click', (e) => {
    if (!graph.canvas || $('graphOverlay').hidden) return;
    if (graph.moved > 5 || graph.panning) return;

    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);

    if (!hit) return;

    if (hit.type === NODE.NOTE) {
      closeGraph();
      openNote(hit.id);
      return;
    }

    if (hit.type === NODE.FOLDER) {
      graph.focusFolderId = graph.focusFolderId === hit.id ? null : hit.id;

      // Folder focus only changes visibility/centering; it does not
      // re-run physics, so no selected-node jitter.
      centerOnNode(hit, Math.max(1.25, graph.scale));
      updateLegend();
    }
  });

  c.addEventListener('wheel', (e) => {
    if (!graph.canvas || $('graphOverlay').hidden) return;

    e.preventDefault();

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

    drawGraph();
  }, { passive: false });

  $('graphSearch').addEventListener('input', (e) => {
    graph.highlight = e.target.value || '';

    // Search only redraws. No simulation -> no arbitrary jitter.
    drawGraph();
  });

  $('graphRecenter').addEventListener('click', () => {
    recenterAll();
  });

  $('graphClose').addEventListener('click', closeGraph);

  window.addEventListener('resize', () => {
    if (graph.canvas && !$('graphOverlay').hidden) {
      resizeGraphCanvas();

      // Rebuild layout on resize because initial group centers depend on size.
      buildGraph();
      updateLegend();
      drawGraph();
      startSimulation(0.7);
    }
  });
}