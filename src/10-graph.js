/* ============================================================
   YANTA — interactive force-directed graph view.
   ============================================================ */
'use strict';

/* ================================================================
   Graph view — force-directed, canvas-based
================================================================ */
const graph = {
  nodes: [], links: [], idIndex: new Map(),
  canvas: null, ctx: null, raf: 0,
  scale: 1, ox: 0, oy: 0,           // pan/zoom
  dragNode: null, dragMx: 0, dragMy: 0, panning: false,
  hover: null, highlight: '',
  running: false,
};

function buildGraph() {
  graph.nodes = [];
  graph.links = [];
  graph.idIndex.clear();
  const cx = graph.canvas ? graph.canvas.width / 2 : 600;
  const cy = graph.canvas ? graph.canvas.height / 2 : 400;
  let i = 0;
  for (const n of state.notes.values()) {
    const angle = i * 0.618 * Math.PI * 2;
    const r = 30 + i * 4;
    graph.idIndex.set(n.id, graph.nodes.length);
    graph.nodes.push({
      id: n.id,
      title: n.title || 'Untitled',
      tags: n.tags || [],
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0, vy: 0,
      degree: 0,
    });
    i++;
  }
  for (const n of state.notes.values()) {
    const seen = new Set();
    WIKILINK_RE.lastIndex = 0;
    let m;
    while ((m = WIKILINK_RE.exec(n.body || '')) !== null) {
      const tid = wikilinkIndex.get(m[1].trim().toLowerCase());
      if (!tid || tid === n.id || seen.has(tid)) continue;
      seen.add(tid);
      const a = graph.idIndex.get(n.id), b = graph.idIndex.get(tid);
      if (a == null || b == null) continue;
      graph.links.push({ a, b });
      graph.nodes[a].degree++;
      graph.nodes[b].degree++;
    }
  }
}

function stepGraph() {
  const repulsion = 1200;
  const attraction = 0.012;
  const gravity = 0.006;
  const damping = 0.82;
  const cx = graph.canvas.width / 2, cy = graph.canvas.height / 2;
  const ns = graph.nodes, ls = graph.links;
  for (const n of ns) { n.fx = 0; n.fy = 0; }
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const dx = ns[j].x - ns[i].x;
      const dy = ns[j].y - ns[i].y;
      const d2 = dx*dx + dy*dy + 25;
      const f = repulsion / d2;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      ns[i].fx -= fx; ns[i].fy -= fy;
      ns[j].fx += fx; ns[j].fy += fy;
    }
  }
  for (const l of ls) {
    const a = ns[l.a], b = ns[l.b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const fx = dx * attraction, fy = dy * attraction;
    a.fx += fx; a.fy += fy;
    b.fx -= fx; b.fy -= fy;
  }
  for (const n of ns) {
    n.fx += (cx - n.x) * gravity;
    n.fy += (cy - n.y) * gravity;
    n.vx = (n.vx + n.fx) * damping;
    n.vy = (n.vy + n.fy) * damping;
    if (graph.dragNode !== n) { n.x += n.vx; n.y += n.vy; }
  }
}

function drawGraph() {
  const c = graph.canvas, ctx = graph.ctx;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.setTransform(graph.scale * dpr, 0, 0, graph.scale * dpr, graph.ox * dpr, graph.oy * dpr);

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim() || '#6ea8fe';
  const dim = styles.getPropertyValue('--text-faint').trim() || '#5b6270';
  const border = styles.getPropertyValue('--border').trim() || '#2a313c';
  const text = styles.getPropertyValue('--text').trim() || '#d8dee9';

  // edges
  ctx.lineWidth = 1 / graph.scale;
  ctx.strokeStyle = border;
  ctx.beginPath();
  for (const l of graph.links) {
    const a = graph.nodes[l.a], b = graph.nodes[l.b];
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // nodes
  const hq = graph.highlight.trim().toLowerCase();
  for (const n of graph.nodes) {
    const r = 4 + Math.sqrt(n.degree) * 2;
    const matched = hq && n.title.toLowerCase().includes(hq);
    const isCurrent = n.id === state.currentNoteId;
    const isHover = graph.hover === n;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isCurrent || matched ? accent : (n.degree ? text : dim);
    if (isHover) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 12;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    if (isCurrent) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 / graph.scale;
      ctx.stroke();
    }
    // label when zoomed in enough or hovered or current
    if (graph.scale > 0.7 || isHover || isCurrent || matched) {
      ctx.fillStyle = text;
      ctx.font = (11 / graph.scale).toFixed(2) + 'px ' + styles.fontFamily;
      ctx.textAlign = 'left';
      ctx.fillText(n.title.length > 30 ? n.title.slice(0, 30) + '…' : n.title, n.x + r + 4, n.y + 3);
    }
  }
}

function animateGraph() {
  if (!graph.running) return;
  stepGraph();
  drawGraph();
  graph.raf = requestAnimationFrame(animateGraph);
}

function nodeAt(x, y) {
  // x,y in canvas coords (already accounting for pan/zoom)
  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    const n = graph.nodes[i];
    const r = 4 + Math.sqrt(n.degree) * 2 + 4;
    if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
  }
  return null;
}
function canvasCoords(e) {
  const r = graph.canvas.getBoundingClientRect();
  const cx = (e.clientX - r.left - graph.ox) / graph.scale;
  const cy = (e.clientY - r.top - graph.oy) / graph.scale;
  return { x: cx, y: cy, mx: e.clientX - r.left, my: e.clientY - r.top };
}

function openGraph() {
  $('graphOverlay').hidden = false;
  const c = $('graphCanvas');
  graph.canvas = c;
  graph.ctx = c.getContext('2d');
  resizeGraphCanvas();
  // Default centering: identity
  graph.scale = 1; graph.ox = 0; graph.oy = 0;
  buildGraph();
  $('graphLegend').innerHTML = `<div><strong>${graph.nodes.length}</strong> notes · <strong>${graph.links.length}</strong> links</div><div>Scroll: zoom · Drag: pan / move node</div>`;
  graph.running = true;
  animateGraph();
}
function closeGraph() {
  graph.running = false;
  cancelAnimationFrame(graph.raf);
  $('graphOverlay').hidden = true;
}
function resizeGraphCanvas() {
  if (!graph.canvas) return;
  const wrap = $('graphCanvasWrap');
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  graph.canvas.width = r.width * dpr;
  graph.canvas.height = r.height * dpr;
  graph.canvas.style.width = r.width + 'px';
  graph.canvas.style.height = r.height + 'px';
  graph.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // pan/zoom acts on top of the DPR transform — store dpr to apply
  graph.scale = graph.scale || 1;
}
function setupGraphInteractions() {
  const c = $('graphCanvas');
  let pressMx = 0, pressMy = 0, moved = 0; // for click-vs-drag detection
  c.addEventListener('mousedown', (e) => {
    pressMx = e.clientX; pressMy = e.clientY; moved = 0;
    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);
    if (hit) {
      graph.dragNode = hit;
      graph.dragMx = pos.x - hit.x;
      graph.dragMy = pos.y - hit.y;
    } else {
      graph.panning = true;
      graph.dragMx = e.clientX;
      graph.dragMy = e.clientY;
      c.classList.add('dragging');
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!graph.canvas || graph.canvas.parentElement.parentElement.hidden) return;
    moved = Math.max(moved, Math.hypot(e.clientX - pressMx, e.clientY - pressMy));
    if (graph.dragNode) {
      const pos = canvasCoords(e);
      graph.dragNode.x = pos.x - graph.dragMx;
      graph.dragNode.y = pos.y - graph.dragMy;
      graph.dragNode.vx = 0; graph.dragNode.vy = 0;
    } else if (graph.panning) {
      graph.ox += e.clientX - graph.dragMx;
      graph.oy += e.clientY - graph.dragMy;
      graph.dragMx = e.clientX;
      graph.dragMy = e.clientY;
    } else {
      const pos = canvasCoords(e);
      graph.hover = nodeAt(pos.x, pos.y);
    }
  });
  window.addEventListener('mouseup', () => {
    graph.dragNode = null;
    graph.panning = false;
    if (graph.canvas) graph.canvas.classList.remove('dragging');
  });
  c.addEventListener('click', (e) => {
    if (moved > 5) return;            // user dragged, not clicked
    if (graph.panning) return;
    const pos = canvasCoords(e);
    const hit = nodeAt(pos.x, pos.y);
    if (hit) { closeGraph(); openNote(hit.id); }
  });
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.2, Math.min(4, graph.scale * factor));
    // Zoom around mouse position
    const wx = (mx - graph.ox) / graph.scale;
    const wy = (my - graph.oy) / graph.scale;
    graph.scale = newScale;
    graph.ox = mx - wx * graph.scale;
    graph.oy = my - wy * graph.scale;
  }, { passive: false });
  $('graphSearch').addEventListener('input', (e) => { graph.highlight = e.target.value; });
  $('graphRecenter').addEventListener('click', () => {
    graph.scale = 1; graph.ox = 0; graph.oy = 0;
  });
  $('graphClose').addEventListener('click', closeGraph);
  window.addEventListener('resize', () => { if (graph.canvas && !$('graphOverlay').hidden) resizeGraphCanvas(); });
}
