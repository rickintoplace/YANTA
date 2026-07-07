// ============================================================
// YANTA — Graph insights (pure module).
//
// Cheap O(n + m) vault analytics computed on every graph rebuild
// and surfaced in the "Insights" panel:
//
//   orphans       notes without a single wikilink
//   hubs          the most-linked notes
//   stale         notes untouched for `staleDays`+
//   components    islands of wikilinked notes
//   suggestions   strongest semantic pairs (when the layer is on)
//
// The module never touches app state — graph.js hands it the node
// and link arrays it already maintains.
// ============================================================
const DAY_MS = 86400000;
function noteNodes(nodes) {
  return nodes.filter((n) => n.type === 'note');
}
function componentStats(nodes, links, wikiKind) {
  const indexOfGid = new Map();
  const members = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'note') continue;
    indexOfGid.set(i, members.length);
    members.push(i);
  }
  const parent = new Int32Array(members.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
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
  for (const link of links) {
    if (link.kind !== wikiKind) continue;
    const a = indexOfGid.get(link.a);
    const b = indexOfGid.get(link.b);
    if (a == null || b == null) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }
  const sizes = new Map();
  for (let i = 0; i < parent.length; i++) {
    const root = find(i);
    sizes.set(root, (sizes.get(root) || 0) + 1);
  }
  const linked = [...sizes.values()].filter((s) => s >= 2);
  return {
    count: linked.length,
    largest: linked.length ? Math.max(...linked) : 0,
  };
}
/**
 * Compute vault-level insights from the graph model.
 *
 * Node contract (from graph.js): { gid, type, title, wikiDegree,
 * updatedAt? } — `updatedAt` is only present on note nodes.
 */
export function computeGraphInsights({
  nodes,
  links,
  wikiKind = 'wiki',
  now = Date.now(),
  staleDays = 90,
  hubLimit = 5,
  staleLimit = 200,
  orphanLimit = 400,
}) {
  const notes = noteNodes(nodes);
  const orphans = [];
  for (const n of notes) {
    if ((n.wikiDegree || 0) > 0) continue;
    orphans.push({ gid: n.gid, title: n.title || 'Untitled' });
    if (orphans.length >= orphanLimit) break;
  }
  const hubs = notes
    .filter((n) => (n.wikiDegree || 0) > 0)
    .sort((a, b) => (b.wikiDegree || 0) - (a.wikiDegree || 0))
    .slice(0, hubLimit)
    .map((n) => ({
      gid: n.gid,
      title: n.title || 'Untitled',
      degree: n.wikiDegree || 0,
    }));
  const staleThreshold = now - staleDays * DAY_MS;
  const stale = notes
    .filter((n) => (n.updatedAt || 0) > 0 && n.updatedAt < staleThreshold)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
    .slice(0, staleLimit)
    .map((n) => ({
      gid: n.gid,
      title: n.title || 'Untitled',
      ageDays: Math.round((now - (n.updatedAt || now)) / DAY_MS),
    }));
  const components = componentStats(nodes, links, wikiKind);
  return {
    noteCount: notes.length,
    orphans,
    hubs,
    stale,
    staleDays,
    componentCount: components.count,
    largestComponent: components.largest,
  };
}
/**
 * Strongest semantic pairs, for the "Suggested connections" rows.
 * Only meaningful while the semantic layer is enabled (the links
 * simply don't exist otherwise).
 */
export function topSemanticSuggestions({
  nodes,
  links,
  semanticKind = 'semantic',
  max = 4,
}) {
  return links
    .filter((l) => l.kind === semanticKind)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, max)
    .map((l) => ({
      aGid: nodes[l.a]?.gid,
      bGid: nodes[l.b]?.gid,
      aTitle: nodes[l.a]?.title || 'Untitled',
      bTitle: nodes[l.b]?.title || 'Untitled',
      score: l.score || 0,
    }))
    .filter((s) => s.aGid && s.bGid);
}