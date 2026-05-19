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
  doc: 'FileText',
  file: 'File',
  folder: 'Folder',
  qr: 'QrCode',
  x: 'X',
  check: 'Check',
  settings: 'Settings',
  refresh: 'RefreshCw',
  trash: 'Trash',
  image: 'Image',
  upload: 'Upload',
  download: 'Download',
  edit: 'Pencil',
  share: 'Share2',
  link: 'Link',
  users: 'Users',
  tag: 'Tag',
  hash: 'Hash',
  network: 'Network',
  command: 'Command',
  sun: 'Sun',
  moon: 'Moon',
  square: 'Square',
  copy: 'Copy',
  quote: 'Quote',
  list: 'List',
  pin: 'Pin',
  star: 'Star',
  plus: 'Plus',
  search: 'Search',
  eye: 'Eye',
  info: 'Info',
  triangle: 'TriangleAlert',
  'folder-plus': 'FolderPlus',
  'chevron-down': 'ChevronDown',
  'chevron-right': 'ChevronRight',
  'check-square': 'SquareCheck',
  'shopping-cart': 'ShoppingCart',
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

function attrName(name) {
  return String(name).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

function escapeSvgAttr(v) {
  return escapeAttr(String(v ?? ''));
}

const SVG_TAGS = new Set([
  'path',
  'line',
  'polyline',
  'polygon',
  'circle',
  'rect',
  'ellipse',
  'g',
]);

function keyToKebab(key) {
  const s = String(key || '').trim();

  if (!s) return '';

  // lucide package may expose keys either as "AlertCircle" or "alert-circle".
  if (s.includes('-')) return s.toLowerCase();

  return pascalToKebab(s);
}

const LUCIDE_KEY_BY_KEBAB = new Map(
  Object.keys(LUCIDE_ICONS || {}).map((key) => [keyToKebab(key), key])
);

function aliasToKebab(name) {
  const alias = ICON_ALIASES[name];

  if (!alias) return '';

  return keyToKebab(alias);
}

function findLucideKey(name) {
  const raw = String(name || '').trim();

  const candidates = [
    raw,
    raw.toLowerCase(),
    keyToKebab(raw),
    keyToKebab(kebabToPascal(raw)),
    aliasToKebab(raw),
  ].filter(Boolean);

  for (const c of candidates) {
    const key = LUCIDE_KEY_BY_KEBAB.get(c);
    if (key) return key;

    // Also allow direct object access for unusual builds.
    if (LUCIDE_ICONS[c]) return c;
  }

  return (
    LUCIDE_KEY_BY_KEBAB.get('square') ||
    LUCIDE_KEY_BY_KEBAB.get('box') ||
    Object.keys(LUCIDE_ICONS || {})[0]
  );
}

function getLucideDef(name) {
  const key = findLucideKey(name);
  return key ? LUCIDE_ICONS[key] : null;
}

function getLucideNode(def) {
  if (!def) return [];

  // Most lucide icon definitions:
  // [['path', { d: '...' }], ['circle', {...}]]
  if (Array.isArray(def)) return def;

  // Some builds wrap nodes:
  // { iconNode: [...] }
  if (def && typeof def === 'object') {
    if (Array.isArray(def.iconNode)) return def.iconNode;
    if (Array.isArray(def.children)) return def.children;
    if (Array.isArray(def.child)) return def.child;
  }

  return [];
}

function iconDefLooksValid(def) {
  return getLucideNode(def).length > 0;
}

function renderIconNode(nodeOrDef) {
  const nodes = getLucideNode(nodeOrDef);

  return nodes
    .map((entry) => {
      let tag;
      let attrs;
      let children;

      // Shape:
      // ['path', { d: '...' }]
      if (Array.isArray(entry)) {
        [tag, attrs = {}, children] = entry;
      }

      // Shape:
      // { tag: 'path', attrs: { d: '...' } }
      else if (entry && typeof entry === 'object') {
        tag = entry.tag || entry.name;
        attrs = entry.attrs || entry.attributes || {};
        children = entry.children || entry.child;
      }

      if (!SVG_TAGS.has(tag)) return '';

      const attrText = Object.entries(attrs || {})
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${attrName(k)}="${escapeSvgAttr(v)}"`)
        .join(' ');

      const childText = children ? renderIconNode(children) : '';

      if (childText) {
        return `<${tag}${attrText ? ' ' + attrText : ''}>${childText}</${tag}>`;
      }

      return `<${tag}${attrText ? ' ' + attrText : ''}/>`;
    })
    .join('');
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

  if (!key) return 'square';

  return keyToKebab(key);
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
