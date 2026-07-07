// ============================================================
// YANTA — Graph force simulation (pure, framework-free).
//
// A d3-force style tick with:
// - Barnes-Hut quadtree many-body repulsion  → O(n log n)
// - Degree-biased link springs (the trick that makes d3/Obsidian
//   layouts feel calm: low-degree nodes move, hubs stay put)
// - Center (forceX/forceY equivalent) + folder-group positioning
// - Layout-target force: nodes with tx/ty set are pulled toward
//   their target position (used by the radial / tree / cluster
//   layout engines, see graph-layouts.js). This is what makes
//   switching visualization modes a smooth animated transition
//   instead of a teleport.
// - Grid-based collision pass so nodes never overlap
// - Velocity Verlet integration with velocity decay
//
// The module knows nothing about rendering or DOM. graph.js owns
// alpha / alphaTarget management (d3 semantics:
//   alpha += (alphaTarget - alpha) * alphaDecay per tick)
// and calls tickSimulation once per animation frame while warm.
//
// Node contract (mutated in place):
//   { x, y, vx, vy, fx, fy, tx, ty, mass, collideR, degree,
//     groupIdx, phase }
//   fx/fy: pinned position while dragging (null otherwise)
//   tx/ty: layout target position (null in organic force mode)
//   groupIdx: index of the folder node this node clusters around
//             (or -1 when folders are hidden / node is a root)
//
// Link contract:
//   { a, b, distance, strength }   (a/b are node indices)
// ============================================================
const THETA2 = 0.81;          // Barnes-Hut criterion (theta = 0.9)²
const SOFTENING = 40;         // avoids force singularities at tiny distances
const DEFAULT_DISTANCE_MAX2 = 1500 * 1500;
const MAX_QUAD_DEPTH = 22;
const DEFAULT_COLLIDE_STRENGTH = 0.72;
const COLLIDE_PADDING = 2.5;
// ------------------------------------------------------------
// Quadtree
// ------------------------------------------------------------
function newCell(x, y, s) {
  return { x, y, s, q: null, p: null, pts: null, mass: 0, cx: 0, cy: 0 };
}
function insert(cell, node, depth) {
  if (depth >= MAX_QUAD_DEPTH) {
    (cell.pts || (cell.pts = [])).push(node);
    return;
  }
  if (!cell.q) {
    if (!cell.p && !cell.pts) {
      cell.p = node;
      return;
    }
    const old = cell.p;
    cell.p = null;
    cell.q = [null, null, null, null];
    if (old) placeChild(cell, old, depth);
  }
  placeChild(cell, node, depth);
}
function placeChild(cell, node, depth) {
  const half = cell.s / 2;
  const ix = node.x >= cell.x + half ? 1 : 0;
  const iy = node.y >= cell.y + half ? 1 : 0;
  const i = iy * 2 + ix;
  let child = cell.q[i];
  if (!child) {
    child = cell.q[i] = newCell(cell.x + ix * half, cell.y + iy * half, half);
  }
  insert(child, node, depth + 1);
}
function aggregate(cell) {
  let m = 0;
  let cx = 0;
  let cy = 0;
  if (cell.p) {
    m = cell.p.mass;
    cx = cell.p.x * m;
    cy = cell.p.y * m;
  }
  if (cell.pts) {
    for (const p of cell.pts) {
      m += p.mass;
      cx += p.x * p.mass;
      cy += p.y * p.mass;
    }
  }
  if (cell.q) {
    for (const c of cell.q) {
      if (!c) continue;
      aggregate(c);
      m += c.mass;
      cx += c.cx * c.mass;
      cy += c.cy * c.mass;
    }
  }
  cell.mass = m;
  cell.cx = m ? cx / m : cell.x;
  cell.cy = m ? cy / m : cell.y;
}
function buildQuadtree(nodes) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    if (n.x < x0) x0 = n.x;
    if (n.y < y0) y0 = n.y;
    if (n.x > x1) x1 = n.x;
    if (n.y > y1) y1 = n.y;
  }
  const size = Math.max(x1 - x0, y1 - y0, 1);
  const root = newCell(x0, y0, size);
  for (const n of nodes) {
    insert(root, n, 0);
  }
  aggregate(root);
  return root;
}
// ------------------------------------------------------------
// Forces
// ------------------------------------------------------------
function repelFrom(node, px, py, mass, repelK, alpha, distanceMax2) {
  let dx = px - node.x;
  let dy = py - node.y;
  let d2 = dx * dx + dy * dy;
  if (d2 < 1e-6) {
    // Perfectly stacked points: deterministic-ish jitter.
    dx = (node.phase != null ? Math.cos(node.phase) : Math.random() - 0.5) * 0.5;
    dy = (node.phase != null ? Math.sin(node.phase) : Math.random() - 0.5) * 0.5;
    d2 = dx * dx + dy * dy;
  }
  if (d2 > distanceMax2) return;
  const d = Math.sqrt(d2);
  const f = (repelK * mass) / (d2 + SOFTENING) * alpha;
  node.vx -= (dx / d) * f;
  node.vy -= (dy / d) * f;
}
function applyManyBody(nodes, repelK, alpha, distanceMax2) {
  if (nodes.length < 2) return;
  const root = buildQuadtree(nodes);
  const stack = [];
  for (const node of nodes) {
    stack.length = 0;
    stack.push(root);
    while (stack.length) {
      const cell = stack.pop();
      if (!cell || cell.mass === 0) continue;
      const dx = cell.cx - node.x;
      const dy = cell.cy - node.y;
      const d2 = dx * dx + dy * dy;
      // Internal cell far enough away → approximate with center of mass.
      if (cell.q && (cell.s * cell.s) / Math.max(d2, 1e-6) < THETA2) {
        repelFrom(node, cell.cx, cell.cy, cell.mass, repelK, alpha, distanceMax2);
        continue;
      }
      if (cell.q) {
        for (const c of cell.q) {
          if (c) stack.push(c);
        }
        continue;
      }
      // Leaf: apply point charges individually, skipping self.
      if (cell.p && cell.p !== node) {
        repelFrom(node, cell.p.x, cell.p.y, cell.p.mass, repelK, alpha, distanceMax2);
      }
      if (cell.pts) {
        for (const p of cell.pts) {
          if (p !== node) {
            repelFrom(node, p.x, p.y, p.mass, repelK, alpha, distanceMax2);
          }
        }
      }
    }
  }
}
function applyLinks(nodes, links, linkScale, distanceScale, alpha) {
  for (const l of links) {
    const a = nodes[l.a];
    const b = nodes[l.b];
    let dx = b.x + b.vx - a.x - a.vx;
    let dy = b.y + b.vy - a.y - a.vy;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) {
      dx = 0.1;
      dy = 0.1;
      d = Math.SQRT2 * 0.1;
    }
    const target = l.distance * distanceScale;
    const k = ((d - target) / d) * alpha * l.strength * linkScale;
    dx *= k;
    dy *= k;
    // Degree bias: the better-connected endpoint moves less.
    const bias = a.degree / Math.max(1, a.degree + b.degree);
    b.vx -= dx * bias;
    b.vy -= dy * bias;
    a.vx += dx * (1 - bias);
    a.vy += dy * (1 - bias);
  }
}
function applyPositioning(nodes, cfg, alpha) {
  const centerK = cfg.centerStrength * alpha;
  const folderK = cfg.folderStrength * alpha;
  const targetK = (cfg.targetStrength || 0) * alpha;
  for (const n of nodes) {
    if (targetK > 0 && n.tx != null && n.ty != null) {
      n.vx += (n.tx - n.x) * targetK;
      n.vy += (n.ty - n.y) * targetK;
    }
    if (centerK > 0) {
      n.vx += (cfg.centerX - n.x) * centerK;
      n.vy += (cfg.centerY - n.y) * centerK;
    }
    if (folderK > 0 && n.groupIdx != null && n.groupIdx >= 0) {
      const g = nodes[n.groupIdx];
      if (g && g !== n) {
        n.vx += (g.x - n.x) * folderK;
        n.vy += (g.y - n.y) * folderK;
      }
    }
  }
}
function applyCollision(nodes, collideStrength) {
  const n = nodes.length;
  if (n < 2) return;
  let maxR = 0;
  for (const node of nodes) {
    if (node.collideR > maxR) maxR = node.collideR;
  }
  const cell = Math.max(12, maxR * 2 + COLLIDE_PADDING);
  const grid = new Map();
  const keyOf = (gx, gy) => (gx + 50000) * 100003 + (gy + 50000);
  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    const k = keyOf(Math.floor(node.x / cell), Math.floor(node.y / cell));
    let bucket = grid.get(k);
    if (!bucket) {
      bucket = [];
      grid.set(k, bucket);
    }
    bucket.push(i);
  }
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    const gx = Math.floor(a.x / cell);
    const gy = Math.floor(a.y / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(keyOf(gx + ox, gy + oy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = nodes[j];
          const min = a.collideR + b.collideR + COLLIDE_PADDING;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          if (d2 < 1e-6) {
            dx = 0.1;
            dy = 0;
            d2 = 0.01;
          }
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * collideStrength;
          const aMovable = a.fx == null;
          const bMovable = b.fx == null;
          if (aMovable && bMovable) {
            a.x -= dx * push * 0.5;
            a.y -= dy * push * 0.5;
            b.x += dx * push * 0.5;
            b.y += dy * push * 0.5;
          } else if (aMovable) {
            a.x -= dx * push;
            a.y -= dy * push;
          } else if (bMovable) {
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }
    }
  }
}
function integrate(nodes, alpha, friction) {
  const maxV = 10 + 90 * alpha;
  let energy = 0;
  for (const n of nodes) {
    if (n.fx != null) {
      n.x = n.fx;
      n.y = n.fy;
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= friction;
    n.vy *= friction;
    const speed = Math.hypot(n.vx, n.vy);
    if (speed > maxV) {
      const k = maxV / speed;
      n.vx *= k;
      n.vy *= k;
    }
    n.x += n.vx;
    n.y += n.vy;
    energy += Math.abs(n.vx) + Math.abs(n.vy);
  }
  return energy;
}
/**
 * Run one simulation tick. Returns total kinetic energy so the caller
 * can decide when the layout has settled.
 *
 * cfg:
 *   alpha            current simulation temperature (0..1)
 *   repelK           repulsion constant (≈ 200..3000)
 *   linkScale        global link strength multiplier
 *   distanceScale    global link distance multiplier
 *   centerX/Y        viewport center in world coordinates
 *   centerStrength   0..~0.02
 *   folderStrength   0..~0.02
 *   targetStrength   0..~0.1 pull toward node.tx/node.ty (layout modes)
 *   friction         velocity retained per tick (d3 default: 0.6)
 *   collide          boolean
 *   collideStrength  optional, default 0.72
 *   distanceMax      optional repulsion cutoff (world units)
 */
export function tickSimulation(nodes, links, cfg) {
  if (!nodes.length) return 0;
  const alpha = cfg.alpha;
  const distanceMax2 = cfg.distanceMax
    ? cfg.distanceMax * cfg.distanceMax
    : DEFAULT_DISTANCE_MAX2;
  applyManyBody(nodes, cfg.repelK, alpha, distanceMax2);
  applyLinks(nodes, links, cfg.linkScale, cfg.distanceScale, alpha);
  applyPositioning(nodes, cfg, alpha);
  if (cfg.collide) {
    applyCollision(nodes, cfg.collideStrength ?? DEFAULT_COLLIDE_STRENGTH);
  }
  return integrate(nodes, alpha, cfg.friction ?? 0.6);
}