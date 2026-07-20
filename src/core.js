// ============================================================
// YANTA — core: utilities, icons, IndexedDB (metadata), state, theme.
// Note CONTENTS now live in Yjs docs (see src/yjs.js); IndexedDB here
// stores only note METADATA, folders, image blobs and settings.
// ============================================================

import { icons as LUCIDE_ICONS } from 'lucide';

export const $ = (id) => document.getElementById(id);

export function isStandalonePwa() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

export const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') {
      n.className = v;
    }

    else if (k === 'style' && v && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null || sv === false) continue;

        // Wichtig: CSS Custom Properties müssen per setProperty gesetzt werden.
        // Object.assign(n.style, { '--foo': 'bar' }) ist nicht zuverlässig.
        if (sk.startsWith('--')) {
          n.style.setProperty(sk, String(sv));
        } else {
          n.style[sk] = sv;
        }
      }
    }

    else if (k.startsWith('on') && typeof v === 'function') {
      n.addEventListener(k.slice(2), v);
    }

    else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) {
        n.dataset[dk] = dv;
      }
    }

    else if (v === true) {
      n.setAttribute(k, '');
    }

    else if (v !== false && v != null) {
      n.setAttribute(k, v);
    }
  }

  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }

  return n;
};

/**
 * Resolves the active Service Worker registration, or null if none becomes
 * ready within `timeoutMs`.
 *
 * `navigator.serviceWorker.ready` never rejects and waits *forever* when no
 * worker ever reaches "activated" (e.g. a failed install). Awaiting it
 * directly can hang a caller silently — always race it against a timeout so
 * callers fall back (e.g. to a page-scoped Notification) instead of hanging.
 */
export async function swRegistrationReady(timeoutMs = 1500) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;

  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

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

// ----------------------------------------------------------------
// YANTA custom Lucide-compatible icons
//
// Why:
// Some Lucide icons exist only in newer package versions.
// YANTA can still use stable semantic icon names everywhere.
// If the installed lucide package does not contain these names,
// these fallback icon nodes are rendered by the same lucide() pipeline.
// ----------------------------------------------------------------

const CUSTOM_LUCIDE_ICONS = {
  'line-squiggle': [
    ['path', {
      d: 'M7 3.5c5-2 7 2.5 3 4C1.5 10 2 15 5 16c5 2 9-10 14-7s.5 13.5-4 12c-5-2.5.5-11 6-2',
    }],
  ],

  'scan-check': [
    ['path', {
      d: 'M7 3H5a2 2 0 0 0-2 2v2',
    }],
    ['path', {
      d: 'M17 3h2a2 2 0 0 1 2 2v2',
    }],
    ['path', {
      d: 'M21 17v2a2 2 0 0 1-2 2h-2',
    }],
    ['path', {
      d: 'M7 21H5a2 2 0 0 1-2-2v-2',
    }],
    ['path', {
      d: 'm8 12 2.5 2.5L16 9',
    }],
  ],
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

const LUCIDE_KEY_BY_KEBAB = new Map([
  ...Object.keys(LUCIDE_ICONS || {}).map((key) => [keyToKebab(key), key]),

  // Custom icons use kebab-case keys directly.
  ...Object.keys(CUSTOM_LUCIDE_ICONS).map((key) => [keyToKebab(key), key]),
]);

function lucideDefByKey(key) {
  const kebab = keyToKebab(key);

  if (CUSTOM_LUCIDE_ICONS[kebab]) {
    return CUSTOM_LUCIDE_ICONS[kebab];
  }

  return LUCIDE_ICONS?.[key] || null;
}

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

    if (key && iconDefLooksValid(lucideDefByKey(key))) {
      return key;
    }

    if (lucideDefByKey(c) && iconDefLooksValid(lucideDefByKey(c))) {
      return c;
    }
  }

  return (
    LUCIDE_KEY_BY_KEBAB.get('square') ||
    LUCIDE_KEY_BY_KEBAB.get('box') ||
    Object.keys(LUCIDE_ICONS || {}).find((k) => iconDefLooksValid(LUCIDE_ICONS[k])) ||
    Object.keys(CUSTOM_LUCIDE_ICONS).find((k) => iconDefLooksValid(CUSTOM_LUCIDE_ICONS[k])) ||
    null
  );
}

function getLucideDef(name) {
  const key = findLucideKey(name);
  return key ? lucideDefByKey(key) : null;
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
  const names = [
    ...Object.keys(LUCIDE_ICONS || {})
      .filter((key) => iconDefLooksValid(LUCIDE_ICONS[key]))
      .map(keyToKebab),

    ...Object.keys(CUSTOM_LUCIDE_ICONS)
      .filter((key) => iconDefLooksValid(CUSTOM_LUCIDE_ICONS[key]))
      .map(keyToKebab),
  ];

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
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

export function lucideCalendarDay(size = 14, day = new Date().getDate()) {
  const dayNum = Number(day);

  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
    return lucide('calendar-1', size);
  }

  const twoDigits = dayNum >= 10;

  return `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="${size}"
      height="${size}"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="lucide lucide-calendar yanta-calendar-day-icon"
      aria-hidden="true">
      <path d="M8 2v4"/>
      <path d="M16 2v4"/>
      <rect width="18" height="18" x="3" y="4" rx="2"/>
      <path d="M3 10h18"/>
      <text
        x="12"
        y="${twoDigits ? '19.5' : '19.5'}"
        text-anchor="middle"
        font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
        font-size="${twoDigits ? '10' : '10'}"
        font-weight="750"
        fill="currentColor"
        stroke="none">${dayNum}</text>
    </svg>
  `;
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
// Action toast — a non-blocking toast carrying one action, typically
// "Undo". Used to replace confirm() dialogs for reversible actions
// (move to trash, archive, move to folder, remove source): execute
// immediately, then offer a brief window to reverse it.
//
// Only one action toast lives at a time; showing a new one dismisses
// the previous. The auto-dismiss timer pauses while the toast is
// hovered or focused, so the action is always reachable.
// ----------------------------------------------------------------
let actionToastEl = null;
let actionToastTimer = null;

export function dismissActionToast() {
  clearTimeout(actionToastTimer);
  actionToastTimer = null;

  const node = actionToastEl;
  actionToastEl = null;

  if (node) {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 200);
  }
}

export function actionToast(message, {
  actionLabel = '',
  onAction = null,
  duration = 6500,
  type = '',
} = {}) {
  dismissActionToast();

  const wrap = document.createElement('div');
  wrap.className = 'action-toast' + (type ? ' ' + type : '');
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');

  const msg = document.createElement('span');
  msg.className = 'action-toast-msg';
  msg.textContent = message;
  wrap.append(msg);

  const hasAction = actionLabel && typeof onAction === 'function';

  if (hasAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action-toast-btn';
    btn.textContent = actionLabel;

    btn.addEventListener('click', async () => {
      dismissActionToast();

      try {
        await onAction();
      } catch (err) {
        console.error('[YANTA] action-toast action failed', err);
        toast('Could not undo', 'error');
      }
    });

    wrap.append(btn);
  }

  document.body.append(wrap);
  actionToastEl = wrap;

  requestAnimationFrame(() => wrap.classList.add('show'));

  const startTimer = () => {
    clearTimeout(actionToastTimer);
    actionToastTimer = setTimeout(dismissActionToast, duration);
  };

  const stopTimer = () => {
    clearTimeout(actionToastTimer);
    actionToastTimer = null;
  };

  wrap.addEventListener('mouseenter', stopTimer);
  wrap.addEventListener('mouseleave', startTimer);
  wrap.addEventListener('focusin', stopTimer);
  wrap.addEventListener('focusout', startTimer);

  startTimer();

  return { dismiss: dismissActionToast };
}

// ----------------------------------------------------------------
// IndexedDB — metadata only (note bodies live in Yjs y-indexeddb)
// ----------------------------------------------------------------
const DB_NAME = 'yanta';
const DB_VERSION = 3;
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
      if (!idb.objectStoreNames.contains('spaces')) idb.createObjectStore('spaces', { keyPath: 'spaceId' });
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
  spaces: {
    all: () => req(tx('spaces').getAll()),
    get: (id) => req(tx('spaces').get(id)),
    put: (s) => req(tx('spaces', 'readwrite').put(s)),
    del: (id) => req(tx('spaces', 'readwrite').delete(id)),
  },
};

// An item materialized from someone else's shared space. Such items
// must never enter this user's private vault sync — they belong to the
// space container, not to the vault. (The owner of a space marks
// nothing: those are their own notes and folders.)
export function isSpaceMountedNote(note) {
  return !!note?.spaceId;
}

export function isSpaceMountedFolder(folder) {
  return !!folder?.spaceId;
}

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
  surface: 'note',
  dashboardFolderId: null,
  calendarEvents: new Map(),
  calendarCategories: new Map(),
  currentCalendarView: 'dayGridMonth',
  theme: 'auto',
  dirty: false,
  // Sync status per note: 'synced' | 'local' | 'remote' | 'syncing' | 'conflict'
  noteSyncStatus: new Map(),
  globalSyncStatus: 'synced',
  // Active live shares: noteId -> { room, key, provider, peers }
  liveShares: new Map(),
  // Mounted shared spaces: spaceId -> session (see spaces/space-session.js)
  spaces: new Map(),
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

  window.dispatchEvent(new CustomEvent('yanta-theme-change', { detail: { theme: t } }));
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
