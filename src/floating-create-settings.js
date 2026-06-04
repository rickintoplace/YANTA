// ============================================================
// YANTA — Floating Quick Create settings
//
// Free interactive bubble layout with automatic minimum-distance
// constraint. Runtime still receives simple { id, label, icon, x, y }.
// ============================================================

import {
  normalizeLucideName,
} from './core.js';

export const FLOATING_CREATE_SETTINGS_KEY = 'yanta.floatingCreate.v2';

export const FLOATING_CREATE_MIN_DISTANCE = 58;

export const FLOATING_CREATE_BOUNDS = Object.freeze({
  minX: -260,
  maxX: 34,
  minY: -300,
  maxY: 18,
});

export const FLOATING_CREATE_ACTION_CATALOG = [
  {
    id: 'note',
    defaultLabel: 'New text note',
    defaultIcon: 'file-text',
  },
  {
    id: 'folder',
    defaultLabel: 'New folder',
    defaultIcon: 'folder-plus',
  },
  {
    id: 'list',
    defaultLabel: 'New list',
    defaultIcon: 'list-checks',
  },
  {
    id: 'drawing',
    defaultLabel: 'New drawing',
    defaultIcon: 'pencil',
  },
  {
    id: 'image',
    defaultLabel: 'New image',
    defaultIcon: 'image',
  },
  {
    id: 'event',
    defaultLabel: 'New calendar event',
    defaultIcon: 'calendar-plus',
  },
  {
    id: 'ai',
    defaultLabel: 'AI assistant',
    defaultIcon: 'sparkles',
  },
];

export const DEFAULT_FLOATING_CREATE_SETTINGS = {
  version: 2,
  minDistance: 58,
  actions: [
    {
      id: 'note',
      enabled: true,
      label: 'New text note',
      icon: 'file-text',
      x: -68,
      y: -19,
      order: 0,
    },
    {
      id: 'list',
      enabled: true,
      label: 'New list',
      icon: 'list-checks',
      x: -119,
      y: -53,
      order: 1,
    },
    {
      id: 'drawing',
      enabled: true,
      label: 'New drawing',
      icon: 'pencil',
      x: -140,
      y: -111,
      order: 2,
    },
    {
      id: 'event',
      enabled: true,
      label: 'New calendar event',
      icon: 'calendar-plus',
      x: -137,
      y: -176,
      order: 3,
    },
    {
      id: 'ai',
      enabled: true,
      label: 'AI assistant',
      icon: 'sparkles',
      x: 0,
      y: -73,
      order: 4,
    },
    {
      id: 'folder',
      enabled: false,
      label: 'New folder',
      icon: 'folder-plus',
      x: -136,
      y: -24,
      order: 5,
    },
    {
      id: 'image',
      enabled: false,
      label: 'New image',
      icon: 'image',
      x: -214,
      y: -96,
      order: 6,
    },
  ],
};

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function cloneJson(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function catalogById() {
  return new Map(FLOATING_CREATE_ACTION_CATALOG.map((a) => [a.id, a]));
}

function defaultById() {
  return new Map(DEFAULT_FLOATING_CREATE_SETTINGS.actions.map((a) => [a.id, a]));
}

function normalizedOrder(actions) {
  return [...actions]
    .sort((a, b) =>
      Number(a.order || 0) - Number(b.order || 0) ||
      String(a.label || '').localeCompare(String(b.label || ''))
    )
    .map((a, index) => ({
      ...a,
      order: index,
    }));
}

function deterministicAngle(id) {
  let h = 2166136261;

  for (let i = 0; i < String(id || '').length; i++) {
    h ^= String(id).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return ((h >>> 0) / 4294967295) * Math.PI * 2;
}

function distance(a, b) {
  return Math.hypot(
    Number(a.x || 0) - Number(b.x || 0),
    Number(a.y || 0) - Number(b.y || 0)
  );
}

function clampPoint(point, bounds = FLOATING_CREATE_BOUNDS) {
  return {
    x: clamp(Number(point.x || 0), bounds.minX, bounds.maxX),
    y: clamp(Number(point.y || 0), bounds.minY, bounds.maxY),
  };
}

/**
 * Constraint solver:
 * - activeId may be fixed to candidate.
 * - enabled bubbles maintain minimum center distance.
 * - nearby bubbles are pushed aside smoothly.
 * - all points remain inside bounds.
 */
export function constrainFloatingCreateLayout(actions, {
  activeId = '',
  candidate = null,
  minDistance = FLOATING_CREATE_MIN_DISTANCE,
  bounds = FLOATING_CREATE_BOUNDS,
  iterations = 22,
} = {}) {
  const next = actions.map((a) => ({ ...a }));

  const enabled = next.filter((a) => a.enabled !== false);

  for (const a of enabled) {
    const p = clampPoint(a, bounds);
    a.x = p.x;
    a.y = p.y;
  }

  const active = activeId
    ? enabled.find((a) => a.id === activeId)
    : null;

  if (active && candidate) {
    const p = clampPoint(candidate, bounds);
    active.x = p.x;
    active.y = p.y;
  }

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;

    for (let i = 0; i < enabled.length; i++) {
      for (let j = i + 1; j < enabled.length; j++) {
        const a = enabled[i];
        const b = enabled[j];

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);

        if (d < 0.001) {
          const angle = deterministicAngle(`${a.id}:${b.id}:${iter}`);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }

        if (d >= minDistance) continue;

        const overlap = minDistance - d;
        const nx = dx / d;
        const ny = dy / d;

        const aFixed = active && a.id === active.id;
        const bFixed = active && b.id === active.id;

        let moveA = 0.5;
        let moveB = 0.5;

        if (aFixed && !bFixed) {
          moveA = 0;
          moveB = 1;
        } else if (bFixed && !aFixed) {
          moveA = 1;
          moveB = 0;
        }

        if (!aFixed) {
          a.x -= nx * overlap * moveA;
          a.y -= ny * overlap * moveA;

          const p = clampPoint(a, bounds);
          a.x = p.x;
          a.y = p.y;
        }

        if (!bFixed) {
          b.x += nx * overlap * moveB;
          b.y += ny * overlap * moveB;

          const p = clampPoint(b, bounds);
          b.x = p.x;
          b.y = p.y;
        }

        changed = true;
      }
    }

    if (!changed) break;
  }

  return next.map((a) => ({
    ...a,
    x: Math.round(numberOr(a.x, 0)),
    y: Math.round(numberOr(a.y, 0)),
  }));
}

/**
 * Finds a pleasant free position in a left/up fan around the trigger.
 * Used when adding an action back.
 */
export function suggestFloatingCreatePosition(actions, {
  minDistance = FLOATING_CREATE_MIN_DISTANCE,
  bounds = FLOATING_CREATE_BOUNDS,
} = {}) {
  const enabled = actions
    .filter((a) => a.enabled !== false)
    .map((a) => clampPoint(a, bounds));

  let best = { x: -76, y: 0 };
  let bestScore = -Infinity;

  const radii = [76, 112, 148, 184, 220, 256, 292];

  // Mostly left/up fan; enough freedom but avoids off-screen positive area.
  const degrees = [
    180, 195, 210, 225, 240, 255, 270, 285,
    168, 202, 236, 270, 304,
  ];

  for (const r of radii) {
    for (const deg of degrees) {
      const angle = (deg * Math.PI) / 180;

      const raw = {
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
      };

      const p = clampPoint(raw, bounds);

      const minD = enabled.length
        ? Math.min(...enabled.map((a) => distance(a, p)))
        : Infinity;

      const boundsPenalty =
        Math.abs(raw.x - p.x) +
        Math.abs(raw.y - p.y);

      const upwardPreference = -Math.abs(p.y + 150) * 0.05;
      const leftPreference = -Math.abs(p.x + 120) * 0.035;

      const score =
        minD -
        boundsPenalty * 1.8 +
        upwardPreference +
        leftPreference;

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }

      if (minD >= minDistance && boundsPenalty === 0) {
        return {
          x: Math.round(p.x),
          y: Math.round(p.y),
        };
      }
    }
  }

  return {
    x: Math.round(best.x),
    y: Math.round(best.y),
  };
}

export function normalizeFloatingCreateSettings(raw = {}) {
  const catalog = catalogById();
  const defaults = defaultById();

  const rawActions = Array.isArray(raw.actions)
    ? raw.actions
    : [];

  const rawById = new Map();

  for (const action of rawActions) {
    if (!action || !catalog.has(action.id)) continue;
    rawById.set(action.id, action);
  }

  let actions = [];

  for (let i = 0; i < FLOATING_CREATE_ACTION_CATALOG.length; i++) {
    const cat = FLOATING_CREATE_ACTION_CATALOG[i];
    const saved = rawById.get(cat.id) || {};
    const def = defaults.get(cat.id) || {};

    actions.push({
      id: cat.id,
      enabled: Object.prototype.hasOwnProperty.call(saved, 'enabled')
      ? saved.enabled !== false
      : def.enabled !== false,
      label: typeof saved.label === 'string' && saved.label.trim()
        ? saved.label.trim()
        : cat.defaultLabel,
      icon: normalizeLucideName(saved.icon || cat.defaultIcon),
      x: numberOr(saved.x, def.x ?? -76),
      y: numberOr(saved.y, def.y ?? 0),
      order: numberOr(saved.order, def.order ?? i),
    });
  }

  actions = normalizedOrder(actions);

  actions = constrainFloatingCreateLayout(actions, {
    minDistance: numberOr(raw.minDistance, FLOATING_CREATE_MIN_DISTANCE),
  });

  return {
    version: 2,
    minDistance: numberOr(raw.minDistance, FLOATING_CREATE_MIN_DISTANCE),
    actions,
  };
}

export function getFloatingCreateSettings() {
  const raw = localStorage.getItem(FLOATING_CREATE_SETTINGS_KEY);

  return normalizeFloatingCreateSettings(
    raw
      ? safeJsonParse(raw, DEFAULT_FLOATING_CREATE_SETTINGS)
      : DEFAULT_FLOATING_CREATE_SETTINGS
  );
}

export function saveFloatingCreateSettings(next) {
  const clean = normalizeFloatingCreateSettings(next);

  localStorage.setItem(
    FLOATING_CREATE_SETTINGS_KEY,
    JSON.stringify(clean)
  );

  window.dispatchEvent(new CustomEvent('yanta-floating-create-settings-changed', {
    detail: cloneJson(clean),
  }));

  return clean;
}

export function resetFloatingCreateSettings() {
  return saveFloatingCreateSettings(DEFAULT_FLOATING_CREATE_SETTINGS);
}

export function floatingCreateActionsForRuntime(settings = getFloatingCreateSettings()) {
  return normalizeFloatingCreateSettings(settings)
    .actions
    .filter((a) => a.enabled !== false)
    .sort((a, b) => a.order - b.order)
    .map((a) => ({
      id: a.id,
      label: a.label,
      icon: normalizeLucideName(a.icon),
      x: Math.round(a.x),
      y: Math.round(a.y),
    }));
}