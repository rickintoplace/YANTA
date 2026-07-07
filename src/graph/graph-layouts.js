// ============================================================
// YANTA — Graph layout engines (pure, framework-free).
//
// Each engine computes *target positions* for nodes. graph.js
// feeds these targets into the force simulation as a per-node
// positioning force (node.tx / node.ty), so switching layouts
// animates smoothly instead of teleporting.
//
// Engines:
//   computeRadialLayout   ego / local graph — concentric hop rings
//   computeTreeLayout     tidy top-down folder hierarchy
//   computeClusterLayout  connected components packed as islands
//
// No DOM, no app state: everything arrives via parameters, so
// the engines are trivially unit-testable.
// ============================================================
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_TREE_DEPTH = 100;
/**
 * Radial ego layout.
 *
 * BFS from `centerIdx` over the adjacency map up to `depth` hops.
 * Ring members are ordered by their BFS parent's angle, which keeps
 * subtrees angularly contiguous and the layout stable across rebuilds.
 *
 * @returns {{
 *   targets: Map<number, {x:number, y:number}>,
 *   hops: Map<number, number>,
 *   visible: Set<number>,
 * }}
 */
export function computeRadialLayout({
  nodes,
  adj,
  centerIdx,
  depth = 2,
  cx = 0,
  cy = 0,
  ringGap = 170,
}) {
  const hops = new Map([[centerIdx, 0]]);
  const parentOf = new Map();
  const order = [centerIdx];
  let head = 0;
  while (head < order.length) {
    const cur = order[head++];
    const hop = hops.get(cur);
    if (hop >= depth) continue;
    const neighbors = adj.get(cur);
    if (!neighbors) continue;
    for (const nb of neighbors) {
      if (hops.has(nb)) continue;
      hops.set(nb, hop + 1);
      parentOf.set(nb, cur);
      order.push(nb);
    }
  }
  const rings = new Map();
  for (const [idx, hop] of hops) {
    let ring = rings.get(hop);
    if (!ring) {
      ring = [];
      rings.set(hop, ring);
    }
    ring.push(idx);
  }
  const targets = new Map([[centerIdx, { x: cx, y: cy }]]);
  const angleOf = new Map([[centerIdx, 0]]);
  for (let hop = 1; hop <= depth; hop++) {
    const ring = rings.get(hop);
    if (!ring?.length) continue;
    ring.sort((a, b) => {
      const pa = angleOf.get(parentOf.get(a)) ?? 0;
      const pb = angleOf.get(parentOf.get(b)) ?? 0;
      return (
        pa - pb ||
        String(nodes[a]?.title || '').localeCompare(String(nodes[b]?.title || ''))
      );
    });
    const radius = hop * ringGap;
    const step = (Math.PI * 2) / ring.length;
    ring.forEach((idx, i) => {
      const angle = -Math.PI / 2 + i * step;
      angleOf.set(idx, angle);
      targets.set(idx, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    });
  }
  let maxHop = 0;
  for (const hop of hops.values()) {
    if (hop > maxHop) maxHop = hop;
  }
  return {
    targets,
    hops,
    visible: new Set(hops.keys()),
    ringGap,
    maxHop,
  };
}
/**
 * Tidy top-down tree layout of the folder hierarchy.
 *
 * `entries` describe the visible nodes:
 *   { idx, kind: 'folder'|'note', id, parentFolderId?, folderId?, sortKey }
 *
 * Every entry's horizontal span equals the number of leaves beneath it,
 * so parents sit centered above their children — the classic layered
 * tree without crossings. Positions start at (0, 0); the caller centers
 * the resulting bounding box in the viewport.
 *
 * @returns {{ targets: Map<number, {x:number, y:number}> }}
 */
export function computeTreeLayout({
  entries,
  levelGap = 150,
  leafGap = 92,
}) {
  const rootKey = '__root__';
  const folderEntries = new Map();
  for (const e of entries) {
    if (e.kind === 'folder') folderEntries.set(e.id, e);
  }
  const children = new Map();
  const parentKeyOf = (e) => {
    if (e.kind === 'folder') {
      return e.parentFolderId && folderEntries.has(e.parentFolderId)
        ? e.parentFolderId
        : rootKey;
    }
    return e.folderId && folderEntries.has(e.folderId)
      ? e.folderId
      : rootKey;
  };
  for (const e of entries) {
    const key = parentKeyOf(e);
    let list = children.get(key);
    if (!list) {
      list = [];
      children.set(key, list);
    }
    list.push(e);
  }
  for (const list of children.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return String(a.sortKey || '').localeCompare(String(b.sortKey || ''));
    });
  }
  const leafCount = new Map();
  const measure = (entry, guard = 0) => {
    if (guard > MAX_TREE_DEPTH) return 1;
    const kids = entry.kind === 'folder' ? children.get(entry.id) || [] : [];
    if (!kids.length) {
      leafCount.set(entry, 1);
      return 1;
    }
    let sum = 0;
    for (const kid of kids) sum += measure(kid, guard + 1);
    const count = Math.max(1, sum);
    leafCount.set(entry, count);
    return count;
  };
  const roots = children.get(rootKey) || [];
  for (const root of roots) measure(root);
  const targets = new Map();
  let cursor = 0;
  const place = (entry, depth, guard = 0) => {
    if (guard > MAX_TREE_DEPTH) return;
    const width = (leafCount.get(entry) || 1) * leafGap;
    targets.set(entry.idx, {
      x: cursor + width / 2,
      y: depth * levelGap,
    });
    const kids = entry.kind === 'folder' ? children.get(entry.id) || [] : [];
    if (!kids.length) {
      cursor += width;
      return;
    }
    for (const kid of kids) place(kid, depth + 1, guard + 1);
  };
  for (const root of roots) place(root, 0);
  return { targets };
}
// ------------------------------------------------------------
// Cluster layout — connected components as packed islands
// ------------------------------------------------------------
function unionFind(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  return { find, union };
}
/**
 * Connected-component layout ("islands of thought").
 *
 * Components are placed largest-first on a golden-angle spiral so no
 * two islands overlap. Within an island, nodes fill a phyllotaxis
 * (sunflower) disc, best-connected nodes first, so hubs sit central.
 *
 * @returns {{
 *   targets: Map<number, {x:number, y:number}>,
 *   componentCount: number,
 *   componentSizes: number[],
 * }}
 */
export function computeClusterLayout({
  nodes,
  links,
  cx = 0,
  cy = 0,
  nodeSpacing = 46,
}) {
  const n = nodes.length;
  if (!n) {
    return { targets: new Map(), componentCount: 0, componentSizes: [] };
  }
  const { find, union } = unionFind(n);
  for (const link of links) union(link.a, link.b);
  const componentsByRoot = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let members = componentsByRoot.get(root);
    if (!members) {
      members = [];
      componentsByRoot.set(root, members);
    }
    members.push(i);
  }
  const components = [...componentsByRoot.values()]
    .sort((a, b) => b.length - a.length);
  const islandRadius = (size) => nodeSpacing * Math.sqrt(size) * 0.9 + 34;
  const placed = [];
  for (let i = 0; i < components.length; i++) {
    const radius = islandRadius(components[i].length);
    if (i === 0) {
      placed.push({ x: cx, y: cy, r: radius });
      continue;
    }
    let angle = i * GOLDEN_ANGLE;
    let dist = placed[0].r + radius + 44;
    // Walk outward along the spiral until this island fits.
    for (let guard = 0; guard < 2000; guard++) {
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      const fits = placed.every(
        (p) => Math.hypot(x - p.x, y - p.y) >= p.r + radius + 28
      );
      if (fits) {
        placed.push({ x, y, r: radius });
        break;
      }
      angle += 0.7;
      dist += 14;
    }
    if (placed.length !== i + 1) {
      placed.push({ x: cx + dist, y: cy, r: radius });
    }
  }
  const targets = new Map();
  const connectivity = (idx) =>
    (nodes[idx]?.wikiDegree || 0) + (nodes[idx]?.degree || 0);
  components.forEach((members, ci) => {
    const center = placed[ci];
    const sorted = [...members].sort((a, b) => connectivity(b) - connectivity(a));
    sorted.forEach((idx, j) => {
      const r = nodeSpacing * Math.sqrt(j) * 0.72;
      const angle = j * GOLDEN_ANGLE;
      targets.set(idx, {
        x: center.x + Math.cos(angle) * r,
        y: center.y + Math.sin(angle) * r,
      });
    });
  });
  return {
    targets,
    componentCount: components.length,
    componentSizes: components.map((m) => m.length),
  };
}