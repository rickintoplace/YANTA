// ============================================================
// YANTA — Graph settings.
//
// Single persisted source of truth for every user-tunable graph
// option (display, forces, layers, behavior).
//
// Pure module: no DOM, no dependency on graph.js. Consumers read
// via graphSettings(), write via updateGraphSettings() and react
// via onGraphSettingsChange().
//
// Persistence: one JSON blob under STORAGE_KEY. Legacy per-option
// keys from older builds are migrated once, then ignored.
// ============================================================

const STORAGE_KEY = 'yanta.graph.settings.v2';

const LEGACY_BOOL_KEYS = Object.freeze({
  showFolders: 'yanta.graph.showFolders',
  showSemantic: 'yanta.graph.showSemantic',
  showArchive: 'yanta.graph.showArchive',
  showAiBrain: 'yanta.graph.showAiBrain',
  preferPane: 'yanta.graph.preferPane',
  controlsOpen: 'yanta.graph.controlsOpen',
  deepSearch: 'yanta.graph.deepSearch',
});

export const NODE_SIZE_MODES = Object.freeze([
  'uniform',   // every note the same size
  'links',     // scaled by wikilink connectivity (Obsidian-style)
  'content',   // scaled by note text length
  'recency',   // recently edited notes are larger
]);

export const LABEL_MODES = Object.freeze([
  'off',       // labels only on hover / focus
  'smart',     // fade in with zoom level (level-of-detail)
  'always',    // always visible
]);

export const GRAPH_FORCE_DEFAULTS = Object.freeze({
  center: 0.35,       // 0..1 pull toward the canvas center
  repel: 0.55,        // 0..1 many-body repulsion
  link: 0.6,          // 0..1 spring strength of links
  linkDistance: 1,    // 0.4..2.2 multiplier on resting link length
  folderPull: 0.4,    // 0..1 clustering around folder nodes
  collide: true,      // prevent node overlap
});

export const GRAPH_SETTINGS_DEFAULTS = Object.freeze({
  // Layers
  showFolders: true,
  showSemantic: false,
  showArchive: false,
  showAiBrain: false,
  // Display
  noteLabels: 'smart',
  folderLabels: 'always',
  showIcons: true,
  nodeSizeMode: 'links',
  nodeScale: 1, // 0.6 .. 1.8
  // Behavior
  deepSearch: true,
  preferPane: true,
  controlsOpen: false,
  forces: GRAPH_FORCE_DEFAULTS,
});

// ------------------------------------------------------------
// Sanitizing
// ------------------------------------------------------------
function clamp(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf(v, list, fallback) {
  return list.includes(v) ? v : fallback;
}

function sanitizeForces(raw = {}) {
  const d = GRAPH_FORCE_DEFAULTS;
  return {
    center: clamp(raw.center, 0, 1, d.center),
    repel: clamp(raw.repel, 0, 1, d.repel),
    link: clamp(raw.link, 0, 1, d.link),
    linkDistance: clamp(raw.linkDistance, 0.4, 2.2, d.linkDistance),
    folderPull: clamp(raw.folderPull, 0, 1, d.folderPull),
    collide: raw.collide !== false,
  };
}

function sanitize(raw = {}) {
  const d = GRAPH_SETTINGS_DEFAULTS;
  return {
    showFolders: raw.showFolders !== false,
    showSemantic: raw.showSemantic === true,
    showArchive: raw.showArchive === true,
    showAiBrain: raw.showAiBrain === true,
    noteLabels: oneOf(raw.noteLabels, LABEL_MODES, d.noteLabels),
    folderLabels: oneOf(raw.folderLabels, LABEL_MODES, d.folderLabels),
    showIcons: raw.showIcons !== false,
    nodeSizeMode: oneOf(raw.nodeSizeMode, NODE_SIZE_MODES, d.nodeSizeMode),
    nodeScale: clamp(raw.nodeScale, 0.6, 1.8, d.nodeScale),
    deepSearch: raw.deepSearch !== false,
    preferPane: raw.preferPane !== false,
    controlsOpen: raw.controlsOpen === true,
    forces: sanitizeForces(raw.forces),
  };
}

// ------------------------------------------------------------
// Load with one-time legacy migration
// ------------------------------------------------------------
function readLegacyBool(key) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? undefined : v !== 'false';
  } catch {
    return undefined;
  }
}

function load() {
  let raw = null;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) raw = JSON.parse(s);
  } catch {}
  if (raw && typeof raw === 'object') {
    return sanitize(raw);
  }
  // Migrate legacy per-option keys once.
  const migrated = {};
  for (const [prop, key] of Object.entries(LEGACY_BOOL_KEYS)) {
    const v = readLegacyBool(key);
    if (v !== undefined) migrated[prop] = v;
  }
  const settings = sanitize(migrated);
  persist(settings);
  return settings;
}

function persist(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

// ------------------------------------------------------------
// Live state + pub/sub
// ------------------------------------------------------------
let current = load();
const listeners = new Set();

/** Read-only view of the current settings. Do not mutate. */
export function graphSettings() {
  return current;
}

/**
 * Merge a partial patch (forces are deep-merged), persist and notify.
 * Returns the keys that actually changed so callers can react
 * proportionally (redraw vs. metric recompute vs. full rebuild).
 */
export function updateGraphSettings(patch = {}) {
  const next = sanitize({
    ...current,
    ...patch,
    forces: { ...current.forces, ...(patch.forces || {}) },
  });
  const changed = [];
  for (const key of Object.keys(next)) {
    if (key === 'forces') {
      for (const fk of Object.keys(next.forces)) {
        if (next.forces[fk] !== current.forces[fk]) changed.push(`forces.${fk}`);
      }
    } else if (next[key] !== current[key]) {
      changed.push(key);
    }
  }
  if (!changed.length) return changed;
  current = next;
  persist(current);
  for (const fn of listeners) {
    try {
      fn(current, changed);
    } catch (err) {
      console.warn('[YANTA graph-settings] listener failed', err);
    }
  }
  return changed;
}

export function resetGraphForces() {
  return updateGraphSettings({ forces: { ...GRAPH_FORCE_DEFAULTS } });
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function onGraphSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}