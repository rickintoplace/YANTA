// ============================================================
// YANTA — core: utilities, icons, IndexedDB (metadata), state, theme.
// Note CONTENTS now live in Yjs docs (see src/yjs.js); IndexedDB here
// stores only note METADATA, folders, image blobs and settings.
// ============================================================

import { icons as LUCIDE_ICONS } from 'lucide';

export const $ = (id) => document.getElementById(id);

export const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[c]));

export const escapeAttr = escapeHtml;

export const decodeEntities = (s) => String(s ?? '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

/**
 * URL allow-list for generated preview HTML.
 * - Links: http(s), mailto, tel, same-page hash
 * - Images: additionally blob: and data:image/*
 */
export function safeUrl(url, { image = false } = {}) {
  const raw = decodeEntities(String(url ?? '')).trim();

  if (!raw) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (raw.startsWith('#')) return raw;

  try {
    const u = new URL(raw, location.href);

    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    if (!image && (u.protocol === 'mailto:' || u.protocol === 'tel:')) return u.href;

    if (image) {
      if (u.protocol === 'blob:') return raw;
      if (u.protocol === 'data:' && /^data:image\//i.test(raw)) return raw;
    }

    return null;
  } catch {
    return null;
  }
}

export function safeCssColor(color) {
  const s = String(color || '').trim();

  if (!s) return '';

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;

  // CSS color names / system colors, e.g. black, white, rebeccapurple.
  // Deliberately no functions like rgb(), hsl(), var(), ...
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(s)) {
    try {
      if (typeof CSS !== 'undefined' && CSS.supports?.('color', s)) return s;
    } catch {}
  }

  return '';
}

export function cssColorToHex(color) {
  const safe = safeCssColor(color);
  if (!safe) return '';

  if (/^#[0-9a-f]{6}$/i.test(safe)) return safe;
  if (/^#[0-9a-f]{3}$/i.test(safe)) {
    return '#' + safe.slice(1).split('').map((c) => c + c).join('');
  }

  try {
    const canvas = cssColorToHex._canvas || (cssColorToHex._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillStyle = safe;

    const normalized = ctx.fillStyle;

    if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;

    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(normalized);
    if (m) {
      return '#' + [m[1], m[2], m[3]]
        .map((n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {}

  return '';
}

export const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
};

export const fmtDate = (ms) => {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (now - d < 6 * 86400000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString();
};

export function safeFilename(s) {
  return (s || 'untitled').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ----------------------------------------------------------------
// Lucide icons — full icon set from lucide package
// ----------------------------------------------------------------

const ICON_ALIASES = {
  doc: 'file-text',
  file: 'file',
  folder: 'folder',
  qr: 'qr-code',
  x: 'x',
  check: 'check',
  settings: 'settings',
  refresh: 'refresh-cw',
  trash: 'trash',
  image: 'image',
  upload: 'upload',
  download: 'download',
  edit: 'pencil',
  share: 'share-2',
  link: 'link',
  users: 'users',
  tag: 'tag',
  hash: 'hash',
  network: 'network',
  command: 'command',
  sun: 'sun',
  moon: 'moon',
  square: 'square',
  copy: 'copy',
  quote: 'quote',
  list: 'list',
  pin: 'pin',
  star: 'star',
  plus: 'plus',
  search: 'search',
  eye: 'eye',
  info: 'info',
  triangle: 'triangle-alert',
  'folder-plus': 'folder-plus',
  'chevron-down': 'chevron-down',
  'chevron-right': 'chevron-right',
  'check-square': 'square-check',
  'shopping-cart': 'shopping-cart',
};

function pascalToKebab(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function kebabToPascal(name) {
  return String(name || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function keyToKebab(key) {
  const s = String(key || '').trim();
  if (!s) return '';
  if (s.includes('-')) return s.toLowerCase();
  return pascalToKebab(s);
}

function attrName(name) {
  if (name === 'viewBox') return 'viewBox';
  return String(name).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

function escapeSvgAttr(v) {
  return escapeAttr(String(v ?? ''));
}

const SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'line',
  'polyline',
  'polygon',
  'circle',
  'rect',
  'ellipse',
]);

const LUCIDE_KEY_BY_KEBAB = new Map(
  Object.keys(LUCIDE_ICONS || {}).map((key) => [keyToKebab(key), key])
);

function isNodeTuple(v) {
  return Array.isArray(v) && typeof v[0] === 'string';
}

function nodeList(v) {
  if (!v) return [];

  // Single lucide tuple:
  // ['path', { d: '...' }]
  if (isNodeTuple(v)) return [v];

  // List of tuples / nodes.
  if (Array.isArray(v)) return v;

  if (typeof v === 'object') {
    // Vanilla lucide package often uses:
    // { name: '...', contents: [...] }
    // or root svg-like objects. For icon definitions, we want only contents.
    if (Array.isArray(v.contents)) return v.contents;

    // Other possible builds:
    if (Array.isArray(v.iconNode)) return v.iconNode;
    if (Array.isArray(v.children)) return v.children;
    if (Array.isArray(v.child)) return v.child;

    // Single object node:
    // { tag: 'path', attrs: {...} }
    if (v.tag || v.name) return [v];
  }

  return [];
}

function iconDefLooksValid(def) {
  return nodeList(def).length > 0;
}

function findLucideKey(name) {
  const raw = String(name || '').trim();
  const alias = ICON_ALIASES[raw] || ICON_ALIASES[raw.toLowerCase()];

  const candidates = [
    alias,
    raw,
    raw.toLowerCase(),
    keyToKebab(raw),
    keyToKebab(kebabToPascal(raw)),
  ].filter(Boolean);

  for (const c of candidates) {
    const kebab = keyToKebab(c);
    const key = LUCIDE_KEY_BY_KEBAB.get(kebab);
    if (key && iconDefLooksValid(LUCIDE_ICONS[key])) return key;

    if (LUCIDE_ICONS[c] && iconDefLooksValid(LUCIDE_ICONS[c])) return c;
  }

  return (
    LUCIDE_KEY_BY_KEBAB.get('square') ||
    LUCIDE_KEY_BY_KEBAB.get('box') ||
    Object.keys(LUCIDE_ICONS || {}).find((k) => iconDefLooksValid(LUCIDE_ICONS[k])) ||
    null
  );
}

function getLucideDef(name) {
  const key = findLucideKey(name);
  return key ? LUCIDE_ICONS[key] : null;
}

function renderSvgEntry(entry) {
  let tag;
  let attrs = {};
  let children;

  // Tuple shape:
  // ['path', { d: '...' }]
  if (isNodeTuple(entry)) {
    [tag, attrs = {}, children] = entry;
  }

  // Object shape:
  // { tag: 'path', attrs: {...}, contents: [...] }
  else if (entry && typeof entry === 'object') {
    tag = entry.tag || entry.name;
    attrs = entry.attrs || entry.attributes || {};
    children = entry.contents || entry.children || entry.child;
  }

  if (tag === 'svg') {
    return renderIconNode(children || entry.contents || entry.children || entry.child);
  }

  if (!SVG_TAGS.has(tag)) return '';

  const attrText = Object.entries(attrs || {})
    .filter(([k, v]) => k !== 'key' && v != null)
    .map(([k, v]) => `${attrName(k)}="${escapeSvgAttr(v)}"`)
    .join(' ');

  const childText = children ? renderIconNode(children) : '';

  if (childText) {
    return `<${tag}${attrText ? ' ' + attrText : ''}>${childText}</${tag}>`;
  }

  return `<${tag}${attrText ? ' ' + attrText : ''}/>`;
}

function renderIconNode(defOrNodes) {
  return nodeList(defOrNodes).map(renderSvgEntry).join('');
}

export function lucideIconNames() {
  return Object.keys(LUCIDE_ICONS || {})
    .filter((key) => iconDefLooksValid(LUCIDE_ICONS[key]))
    .map(keyToKebab)
    .sort((a, b) => a.localeCompare(b));
}

export function normalizeLucideName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'square';

  const key = findLucideKey(raw);
  return key ? keyToKebab(key) : 'square';
}

export function lucideExists(name) {
  const key = findLucideKey(name);
  return !!key && iconDefLooksValid(LUCIDE_ICONS[key]);
}

export function lucide(name, size = 14) {
  const normalized = normalizeLucideName(name);
  const def = getLucideDef(normalized);
  const body = renderIconNode(def);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

// ----------------------------------------------------------------
// IndexedDB — metadata only (note bodies live in Yjs y-indexeddb)
// ----------------------------------------------------------------
const DB_NAME = 'yanta';
const DB_VERSION = 2;
let db;

export function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('notes')) {
        const s = idb.createObjectStore('notes', { keyPath: 'id' });
        s.createIndex('folder', 'folderId', { unique: false });
        s.createIndex('updated', 'updated', { unique: false });
      }
      if (!idb.objectStoreNames.contains('folders')) idb.createObjectStore('folders', { keyPath: 'id' });
      if (!idb.objectStoreNames.contains('images')) idb.createObjectStore('images', { keyPath: 'id' });
      if (!idb.objectStoreNames.contains('settings')) idb.createObjectStore('settings', { keyPath: 'key' });
      if (!idb.objectStoreNames.contains('shares')) idb.createObjectStore('shares', { keyPath: 'noteId' });
    };
    req.onsuccess = () => { db = req.result; res(db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function cursorAllImageMeta() {
  return new Promise((res, rej) => {
    const out = [];
    const r = tx('images').openCursor();

    r.onsuccess = () => {
      const cur = r.result;
      if (!cur) {
        res(out);
        return;
      }

      const { blob, ...meta } = cur.value;
      out.push(meta);
      cur.continue();
    };

    r.onerror = () => rej(r.error);
  });
}

export const store = {
  notes: {
    all: () => req(tx('notes').getAll()),
    get: (id) => req(tx('notes').get(id)),
    put: (n) => req(tx('notes', 'readwrite').put(n)),
    del: (id) => req(tx('notes', 'readwrite').delete(id)),
  },
  folders: {
    all: () => req(tx('folders').getAll()),
    put: (f) => req(tx('folders', 'readwrite').put(f)),
    del: (id) => req(tx('folders', 'readwrite').delete(id)),
  },
  images: {
    all: () => req(tx('images').getAll()),
    allMeta: () => cursorAllImageMeta(),
    get: (id) => req(tx('images').get(id)),
    put: (i) => req(tx('images', 'readwrite').put(i)),
    del: (id) => req(tx('images', 'readwrite').delete(id)),
  },
  settings: {
    get: async (k, d) => (await req(tx('settings').get(k)))?.value ?? d,
    set: (k, v) => req(tx('settings', 'readwrite').put({ key: k, value: v })),
  },
  shares: {
    all: () => req(tx('shares').getAll()),
    get: (id) => req(tx('shares').get(id)),
    put: (s) => req(tx('shares', 'readwrite').put(s)),
    del: (id) => req(tx('shares', 'readwrite').delete(id)),
  },
};

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------
export const state = {
  notes: new Map(),         // id -> { id, title, type, folderId, tags, pinned, created, updated }
  folders: new Map(),
  imagesMeta: new Map(),
  imageBlobs: new Map(),
  searchIndex: new Map(),      // noteId -> lowercased title/tags/body
  currentNoteId: null,
  expandedFolders: new Set(),
  activeTagFilter: null,
  searchQuery: '',
  view: 'split',
  theme: 'auto',
  dirty: false,
  // Sync status per note: 'synced' | 'local' | 'remote' | 'syncing' | 'conflict'
  noteSyncStatus: new Map(),
  globalSyncStatus: 'synced',
  // Active live shares: noteId -> { room, key, provider, peers }
  liveShares: new Map(),
};

// ----------------------------------------------------------------
// Theme
// ----------------------------------------------------------------
const THEMES = ['auto', 'dark', 'light'];
export function setTheme(t) {
  if (!THEMES.includes(t)) t = 'auto';
  state.theme = t;
  document.documentElement.dataset.theme = t;
  store.settings.set('theme', t);
  const btn = $('btn-theme');
  if (btn) btn.title = `Theme: ${t} (click to cycle)`;
}
export function toggleTheme() {
  const i = THEMES.indexOf(state.theme);
  setTheme(THEMES[(i + 1) % THEMES.length]);
  toast(`Theme: ${state.theme}`);
}

// ----------------------------------------------------------------
// Storage estimate
// ----------------------------------------------------------------
export async function updateStorageMeter() {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      $('storageMeter').textContent = fmtBytes(est.usage || 0);
      $('storageMeter').title = `Used ${fmtBytes(est.usage || 0)} of ~${fmtBytes(est.quota || 0)}`;
    }
  } catch {}
}
