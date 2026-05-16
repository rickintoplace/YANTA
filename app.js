/* ============================================================
   YANTA — Yet another note taking app
   Vanilla JS. Stores notes & images in IndexedDB. No backend.
   ============================================================ */

'use strict';

/* ----------------------------------------------------------------
   utils
---------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
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
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
};
const fmtDate = (ms) => {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (now - d < 6 * 86400000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString();
};

function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ----------------------------------------------------------------
   storage — IndexedDB
---------------------------------------------------------------- */
const DB_NAME = 'yanta';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('notes')) {
        const s = idb.createObjectStore('notes', { keyPath: 'id' });
        s.createIndex('folder', 'folderId', { unique: false });
        s.createIndex('updated', 'updated', { unique: false });
      }
      if (!idb.objectStoreNames.contains('folders')) {
        idb.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!idb.objectStoreNames.contains('images')) {
        idb.createObjectStore('images', { keyPath: 'id' });
      }
      if (!idb.objectStoreNames.contains('settings')) {
        idb.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { db = req.result; res(db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}
function idbReq(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

const store = {
  notes: {
    all: () => idbReq(tx('notes').getAll()),
    get: (id) => idbReq(tx('notes').get(id)),
    put: (n) => idbReq(tx('notes', 'readwrite').put(n)),
    del: (id) => idbReq(tx('notes', 'readwrite').delete(id)),
  },
  folders: {
    all: () => idbReq(tx('folders').getAll()),
    put: (f) => idbReq(tx('folders', 'readwrite').put(f)),
    del: (id) => idbReq(tx('folders', 'readwrite').delete(id)),
  },
  images: {
    all: () => idbReq(tx('images').getAll()),
    get: (id) => idbReq(tx('images').get(id)),
    put: (i) => idbReq(tx('images', 'readwrite').put(i)),
    del: (id) => idbReq(tx('images', 'readwrite').delete(id)),
  },
  settings: {
    get: async (k, d) => (await idbReq(tx('settings').get(k)))?.value ?? d,
    set: (k, v) => idbReq(tx('settings', 'readwrite').put({ key: k, value: v })),
  },
};

/* ----------------------------------------------------------------
   state
---------------------------------------------------------------- */
const state = {
  notes: new Map(),        // id -> note
  folders: new Map(),      // id -> folder
  imagesMeta: new Map(),   // id -> {id, name, size, type, ts} (no blob)
  imageBlobs: new Map(),   // id -> object url cache (resolved on demand)
  currentNoteId: null,
  expandedFolders: new Set(),
  activeFolderFilter: null,
  activeTagFilter: null,
  searchQuery: '',
  view: 'split',           // edit / split / preview
  theme: 'dark',
  saveTimer: null,
  dirty: false,
};

/* ----------------------------------------------------------------
   markdown — line-oriented parser
   Each source line maps to one preview block (.pv-line) so that
   y-positions match the editor (which also renders one div per line).
   Multi-line constructs (code fences, tables) preserve per-line
   alignment by emitting one .pv-line per source line.
---------------------------------------------------------------- */

// Classify line type (for both editor and preview styling)
function classifyLine(line, ctx) {
  if (ctx.inFence) {
    if (/^```/.test(line)) return { type: 'fence', closes: true };
    return { type: 'code' };
  }
  if (/^```/.test(line)) return { type: 'fence', opens: true, lang: line.slice(3).trim() };
  if (/^\s*$/.test(line)) return { type: 'blank' };
  let m;
  if ((m = /^(#{1,6})\s/.exec(line))) return { type: 'h' + m[1].length };
  if (/^\s*>\s?/.test(line)) return { type: 'quote' };
  if (/^\s*[-*_]{3,}\s*$/.test(line)) return { type: 'hr' };
  if ((m = /^(\s*)([-*+])\s+\[([ xX])\]\s/.exec(line))) return { type: 'task', checked: m[3].toLowerCase() === 'x', indent: m[1].length };
  if ((m = /^(\s*)([-*+])\s+/.exec(line))) return { type: 'ul', indent: m[1].length };
  if ((m = /^(\s*)(\d+)\.\s+/.exec(line))) return { type: 'ol', indent: m[1].length, num: parseInt(m[2], 10) };
  if (/^\|.*\|\s*$/.test(line)) return { type: 'table' };
  // image-only line (often base64): "![alt](url)"
  if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) return { type: 'image' };
  return { type: 'p' };
}

// Inline tokenizer for preview (HTML output)
function renderInline(s) {
  // Order matters: escape -> code -> wikilinks -> images -> md links -> bold -> ...
  let out = escapeHtml(s);
  // inline code
  out = out.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  // wikilinks [[Target]] or [[Target|alias]]
  out = out.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, target, alias) => {
    const t = target.trim();
    const key = t.toLowerCase();
    const noteId = wikilinkIndex.get(key);
    const text = (alias || t).trim();
    const cls = noteId ? 'wiki-link' : 'wiki-link missing';
    const id = noteId ? ` data-note-id="${noteId}"` : '';
    return `<a class="${cls}" data-wiki="${escapeHtml(t)}"${id}>${escapeHtml(text)}</a>`;
  });
  // images ![alt](url "title")
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
    const resolved = resolveImageUrl(url);
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    if (resolved === null) {
      return `<span class="pv-img-missing">missing: ${escapeHtml(url.slice(0, 40))}…</span>`;
    }
    return `<span class="pv-img-wrap" contenteditable="false"><img src="${resolved}" alt="${escapeHtml(alt)}"${t} loading="lazy" draggable="false" /></span>`;
  });
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) =>
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${txt}</a>`);
  // bold + italic combined
  out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  // hashtag refs
  out = out.replace(/(^|\s)#([a-zA-Z][\w-]*)/g, (_, sp, t) => `${sp}<span class="tag-ref" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`);
  return out;
}

// Render preview as one .pv-line per source line
function renderPreview(md) {
  const lines = md.split('\n');
  const ctx = { inFence: false, fenceLang: '' };
  const pieces = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = classifyLine(line, ctx);
    let inner = '';
    let dataType = info.type;
    if (info.type === 'fence') {
      if (info.opens) { ctx.inFence = true; ctx.fenceLang = info.lang; inner = `<span style="font-family:var(--font-mono);font-size:0.9em;color:var(--text-faint)">\`\`\`${escapeHtml(info.lang)}</span>`; }
      else { ctx.inFence = false; ctx.fenceLang = ''; inner = `<span style="font-family:var(--font-mono);font-size:0.9em;color:var(--text-faint)">\`\`\`</span>`; }
    } else if (info.type === 'code') {
      inner = `<span style="font-family:var(--font-mono);font-size:0.9em">${escapeHtml(line) || '&nbsp;'}</span>`;
    } else if (info.type === 'blank') {
      inner = '&nbsp;';
    } else if (info.type === 'hr') {
      inner = '<hr/>';
    } else if (info.type === 'h1' || info.type === 'h2' || info.type === 'h3' || info.type === 'h4' || info.type === 'h5' || info.type === 'h6') {
      const lvl = parseInt(info.type[1], 10);
      const txt = line.replace(/^#{1,6}\s+/, '');
      inner = `<h${lvl}>${renderInline(txt)}</h${lvl}>`;
    } else if (info.type === 'quote') {
      const txt = line.replace(/^\s*>\s?/, '');
      inner = `<blockquote>${renderInline(txt)}</blockquote>`;
    } else if (info.type === 'task') {
      const m = /^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/.exec(line);
      const checked = m[3].toLowerCase() === 'x';
      inner = `<div class="task" style="padding-left:${(m[1].length * 0.6) + 1.5}em">
        <input type="checkbox" data-line="${i}" contenteditable="false" ${checked ? 'checked' : ''}/>
        <span${checked ? ' style="text-decoration:line-through;color:var(--text-dim)"' : ''}>${renderInline(m[4])}</span>
      </div>`;
    } else if (info.type === 'ul') {
      const m = /^(\s*)([-*+])\s+(.*)$/.exec(line);
      inner = `<div style="padding-left:${(m[1].length * 0.6) + 1.5}em;text-indent:-1.2em">• ${renderInline(m[3])}</div>`;
    } else if (info.type === 'ol') {
      const m = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
      inner = `<div style="padding-left:${(m[1].length * 0.6) + 1.8}em;text-indent:-1.5em">${m[2]}. ${renderInline(m[3])}</div>`;
    } else if (info.type === 'image') {
      inner = renderInline(line);
    } else if (info.type === 'table') {
      // Render as monospace row for line alignment (proper table rendering would break per-line sync)
      inner = `<pre style="margin:0;font-size:0.9em;color:var(--text-dim)"><code>${escapeHtml(line)}</code></pre>`;
    } else {
      inner = renderInline(line) || '&nbsp;';
    }
    pieces.push(`<div class="pv-line" data-line="${i}" data-type="${dataType}">${inner}</div>`);
  }
  return pieces.join('');
}

/* ----------------------------------------------------------------
   image URL resolution
   Supports:
     yanta-img://<id>      → blob in IndexedDB
     data:image/...        → base64 inline
     http(s)://...         → web
     file:// or absolute path → as-is (note: browsers block file://
                              from non-file origins; we render anyway)
     ./relative/path       → as-is
---------------------------------------------------------------- */
function resolveImageUrl(url) {
  if (url.startsWith('yanta-img://')) {
    const id = url.slice('yanta-img://'.length);
    if (state.imageBlobs.has(id)) return state.imageBlobs.get(id);
    if (!state.imagesMeta.has(id)) return null;
    // load synchronously into cache — actually async, so trigger and return placeholder
    store.images.get(id).then((rec) => {
      if (rec && rec.blob) {
        const u = URL.createObjectURL(rec.blob);
        state.imageBlobs.set(id, u);
        renderPreviewSoon(); // re-render once loaded
      }
    });
    return ''; // empty src → will re-render
  }
  return url;
}

/* ----------------------------------------------------------------
   editor — contenteditable; one div per line; tokenized formatting
   Cursor preserved by char-offset within current line.
---------------------------------------------------------------- */
const editor = $('editor');

function tokenizeLine(line, info) {
  // Returns array of {text, cls} or {trunc, full}
  if (info.type === 'code' || info.type === 'fence') {
    return [{ text: line, cls: '' }];
  }
  const tokens = [];
  let s = line;
  // strip leading markers for headings/quotes/lists but keep visible
  // Approach: walk through inline patterns and split
  // We handle inline tokens, but keep markers (** ** etc) visible.
  const inlineRegex = /(`[^`\n]+`)|(\[\[[^\]\n]+\]\])|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))|(\*\*\*[^*\n]+\*\*\*)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(\s#[a-zA-Z][\w-]*)/g;
  let last = 0; let m;
  while ((m = inlineRegex.exec(s)) !== null) {
    if (m.index > last) tokens.push({ text: s.slice(last, m.index) });
    const tok = m[0];
    if (m[1]) tokens.push({ text: tok, cls: 'ed-code' });
    else if (m[2]) {
      // wikilink [[Target]] or [[Target|alias]]
      const inner = tok.slice(2, -2);
      const pipeIdx = inner.indexOf('|');
      tokens.push({ text: '[[', cls: 'ed-mark' });
      if (pipeIdx >= 0) {
        const target = inner.slice(0, pipeIdx);
        const alias = inner.slice(pipeIdx + 1);
        const exists = wikilinkIndex.has(target.trim().toLowerCase());
        tokens.push({ text: target, cls: exists ? 'ed-wiki' : 'ed-wiki-missing' });
        tokens.push({ text: '|', cls: 'ed-mark' });
        tokens.push({ text: alias, cls: exists ? 'ed-wiki' : 'ed-wiki-missing' });
      } else {
        const exists = wikilinkIndex.has(inner.trim().toLowerCase());
        tokens.push({ text: inner, cls: exists ? 'ed-wiki' : 'ed-wiki-missing' });
      }
      tokens.push({ text: ']]', cls: 'ed-mark' });
    }
    else if (m[3]) tokens.push(...tokenizeImage(tok));
    else if (m[4]) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      tokens.push({ text: '[', cls: 'ed-mark' });
      tokens.push({ text: lm[1], cls: 'ed-link' });
      tokens.push({ text: '](', cls: 'ed-mark' });
      tokens.push({ text: lm[2], cls: 'ed-url' });
      tokens.push({ text: ')', cls: 'ed-mark' });
    } else if (m[5]) {
      tokens.push({ text: '***', cls: 'ed-mark' });
      tokens.push({ text: tok.slice(3, -3), cls: 'ed-bold ed-italic' });
      tokens.push({ text: '***', cls: 'ed-mark' });
    } else if (m[6] || m[7]) {
      const mk = tok.slice(0, 2);
      tokens.push({ text: mk, cls: 'ed-mark' });
      tokens.push({ text: tok.slice(2, -2), cls: 'ed-bold' });
      tokens.push({ text: mk, cls: 'ed-mark' });
    } else if (m[8] || m[9]) {
      const mk = tok[0];
      tokens.push({ text: mk, cls: 'ed-mark' });
      tokens.push({ text: tok.slice(1, -1), cls: 'ed-italic' });
      tokens.push({ text: mk, cls: 'ed-mark' });
    } else if (m[10]) {
      tokens.push({ text: '~~', cls: 'ed-mark' });
      tokens.push({ text: tok.slice(2, -2), cls: 'ed-strike' });
      tokens.push({ text: '~~', cls: 'ed-mark' });
    } else if (m[11]) {
      tokens.push({ text: tok, cls: 'ed-tag-ref' });
    }
    last = m.index + tok.length;
  }
  if (last < s.length) tokens.push({ text: s.slice(last) });
  return tokens;
}

function tokenizeImage(tok) {
  // ![alt](url) — if url is base64 long, render as truncated chip
  const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(tok);
  if (!m) return [{ text: tok }];
  const alt = m[1], url = m[2];
  const out = [
    { text: '![', cls: 'ed-mark' },
    { text: alt, cls: 'ed-img-tag' },
    { text: '](', cls: 'ed-mark' },
  ];
  if (/^data:image\/[\w+]+;base64,/.test(url) && url.length > 80) {
    const head = url.slice(0, url.indexOf(',') + 1);
    out.push({ text: head, cls: 'ed-url' });
    out.push({ trunc: true, full: url.slice(head.length), label: `base64 · ${fmtBytes(url.length * 0.75)}` });
  } else if (url.startsWith('yanta-img://')) {
    out.push({ text: url, cls: 'ed-img-tag' });
  } else {
    out.push({ text: url, cls: 'ed-url' });
  }
  out.push({ text: ')', cls: 'ed-mark' });
  return out;
}

// Render the entire editor from a markdown string
function renderEditor(md, opts = {}) {
  const lines = md.split('\n');
  const ctx = { inFence: false };
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = classifyLine(line, ctx);
    if (info.type === 'fence') {
      if (info.opens) ctx.inFence = true;
      else if (info.closes) ctx.inFence = false;
    }
    const lineDiv = el('div', { class: 'ed-line', dataset: { line: String(i), type: info.type } });
    const tokens = tokenizeLine(line, info);
    if (tokens.length === 0 || line === '') {
      lineDiv.append(document.createElement('br'));
    } else {
      for (const t of tokens) {
        if (t.trunc) {
          const span = el('span', { class: 'ed-trunc', dataset: { full: t.full } }, t.label);
          span.contentEditable = 'false';
          lineDiv.append(span);
        } else {
          const sp = el('span', t.cls ? { class: t.cls } : {}, t.text);
          lineDiv.append(sp);
        }
      }
    }
    // For image lines, also show the actual image thumbnail beneath the source
    if (info.type === 'image') {
      const m = /!\[([^\]]*)\]\(([^)]+)\)/.exec(line);
      if (m) {
        const resolved = resolveImageUrl(m[2]);
        if (resolved !== null) {
          const img = document.createElement('img');
          img.className = 'ed-img-thumb';
          img.src = resolved;
          img.alt = m[1];
          img.contentEditable = 'false';
          img.draggable = false;
          lineDiv.append(img);
        }
      }
    }
    frag.append(lineDiv);
  }
  editor.replaceChildren(frag);
}

// Read markdown back from editor DOM. Each top-level block child of the
// editor is exactly one source line; BRs and images inside a block are
// treated as layout / non-source (they don't create new source lines).
function readEditorMarkdown() {
  const lines = [];
  const isBlock = (n) => n.nodeName && ['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE'].includes(n.nodeName);
  function readInline(n) {
    let s = '';
    function w(x) {
      if (x.nodeType === 3) { s += x.nodeValue; return; }
      if (x.nodeName === 'BR' || x.nodeName === 'IMG') return;
      if (x.classList && x.classList.contains('ed-trunc')) { s += x.dataset.full; return; }
      for (const c of x.childNodes) w(c);
    }
    w(n);
    return s;
  }
  let pending = '';
  for (const child of editor.childNodes) {
    if (child.nodeType === 3) {
      pending += child.nodeValue;
    } else if (child.nodeName === 'BR') {
      lines.push(pending); pending = '';
    } else if (isBlock(child)) {
      if (pending.length > 0) { lines.push(pending); pending = ''; }
      lines.push(readInline(child));
    } else {
      pending += readInline(child);
    }
  }
  if (pending.length > 0) lines.push(pending);
  return lines.join('\n');
}

/* ----------------------------------------------------------------
   cursor — save/restore by (lineIndex, charOffset)
   Uses sibling index (not data-line attr) so it works even when the
   DOM is in a transient state between lazy re-renders.
---------------------------------------------------------------- */
function getCursorPos() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  // Climb to the direct child of editor
  let line = node;
  while (line && line.parentNode !== editor) line = line.parentNode;
  if (!line || line.parentNode !== editor) return null;
  const blocks = [...editor.children];
  const lineIndex = blocks.indexOf(line);
  if (lineIndex < 0) return null;
  let offset = 0;
  function walk(n) {
    if (n === range.startContainer) {
      if (n.nodeType === 3) offset += range.startOffset;
      else for (let i = 0; i < range.startOffset; i++) walk(n.childNodes[i]);
      return true;
    }
    if (n.classList && n.classList.contains('ed-trunc')) { offset += n.dataset.full.length; return false; }
    if (n.nodeType === 3) { offset += n.nodeValue.length; return false; }
    if (n.nodeName === 'BR' || n.nodeName === 'IMG') return false;
    for (const c of n.childNodes) if (walk(c)) return true;
    return false;
  }
  for (const c of line.childNodes) if (walk(c)) break;
  return { lineIndex, offset };
}

function setCursorPos(pos) {
  if (!pos) return;
  const blocks = [...editor.children];
  if (!blocks.length) return;
  const line = blocks[Math.min(Math.max(0, pos.lineIndex), blocks.length - 1)];
  if (!line) return;
  let remaining = pos.offset;
  const sel = window.getSelection();
  const range = document.createRange();
  function place(n) {
    if (!n) return false;
    if (n.classList && n.classList.contains('ed-trunc')) {
      const len = n.dataset.full.length;
      if (remaining <= len) { range.setStartAfter(n); range.collapse(true); return true; }
      remaining -= len; return false;
    }
    if (n.nodeType === 3) {
      if (remaining <= n.nodeValue.length) { range.setStart(n, remaining); range.collapse(true); return true; }
      remaining -= n.nodeValue.length; return false;
    }
    if (n.nodeName === 'BR' || n.nodeName === 'IMG') return false;
    for (const c of n.childNodes) if (place(c)) return true;
    return false;
  }
  let placed = false;
  for (const c of line.childNodes) if (place(c)) { placed = true; break; }
  if (!placed) { range.selectNodeContents(line); range.collapse(false); }
  sel.removeAllRanges(); sel.addRange(range);
}

/* ----------------------------------------------------------------
   editor input handling

   Hot path (each keystroke):
     - quickStyleCurrentLine: just updates the data-type attr of the
       current line (font-size / colour comes from CSS) — no DOM swap.
     - readEditorMarkdown + schedulePreview: refresh preview.
     - scheduleLazyEditorRender: full re-tokenization happens only
       after the user pauses (debounced). This is what gives us
       fast, smooth typing.
---------------------------------------------------------------- */
let lastMarkdown = '';

function readCurrentEditorLine() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  while (n && n.parentNode !== editor) n = n.parentNode;
  if (!n || n.parentNode !== editor) return null;
  let s = '';
  function w(x) {
    if (x.nodeType === 3) { s += x.nodeValue; return; }
    if (x.nodeName === 'BR' || x.nodeName === 'IMG') return;
    if (x.classList && x.classList.contains('ed-trunc')) { s += x.dataset.full; return; }
    for (const c of x.childNodes) w(c);
  }
  w(n);
  return { line: n, text: s };
}

function quickStyleCurrentLine() {
  const cur = readCurrentEditorLine();
  if (!cur) return;
  const info = classifyLine(cur.text, { inFence: false });
  if (cur.line.dataset.type !== info.type) cur.line.dataset.type = info.type;
}

function handleEditorInput() {
  quickStyleCurrentLine();
  const md = readEditorMarkdown();
  if (md === lastMarkdown) {
    checkWikiAutocomplete();
    return;
  }
  lastMarkdown = md;
  schedulePreview(md);
  scheduleLazyEditorRender();
  checkWikiAutocomplete();
  markDirty();
  scheduleSave();
  updateWordCount(md);
}

const scheduleLazyEditorRender = debounce(() => {
  const isEditing = editor.contains(document.activeElement);
  const pos = isEditing ? getCursorPos() : null;
  renderEditor(lastMarkdown);
  if (pos) setCursorPos(pos);
  syncLineHeights();
}, 450);

const schedulePreview = debounce((md) => {
  if ($('preview').contains(document.activeElement)) return;
  $('preview').innerHTML = renderPreview(md);
  if (typeof renderBacklinks === 'function') renderBacklinks();
  syncLineHeights();
}, 120);

function renderPreviewSoon() {
  schedulePreview(lastMarkdown);
}

const scheduleSave = debounce(() => saveCurrentNote(), 700);

function markDirty() {
  state.dirty = true;
  const e = $('statSaved');
  e.textContent = 'Saving…';
  e.className = 'dirty';
}
function markSaved() {
  state.dirty = false;
  const e = $('statSaved');
  e.textContent = 'Saved · ' + fmtDate(Date.now());
  e.className = 'saved';
}

function updateWordCount(md) {
  const text = md.replace(/```[\s\S]*?```/g, '').replace(/[#*_>`-]/g, '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('statWords').textContent = words + ' word' + (words === 1 ? '' : 's');
  $('statChars').textContent = md.length + ' char' + (md.length === 1 ? '' : 's');
}

/* Pair each editor line with its preview line so y-positions match. */
function syncLineHeights() {
  const edLines = editor.querySelectorAll('.ed-line');
  const pvLines = $('preview').querySelectorAll('.pv-line');
  const n = Math.min(edLines.length, pvLines.length);
  // first pass: clear forced heights
  for (let i = 0; i < n; i++) {
    edLines[i].style.minHeight = '';
    pvLines[i].style.minHeight = '';
  }
  // measure after reflow
  requestAnimationFrame(() => {
    for (let i = 0; i < n; i++) {
      const eh = edLines[i].offsetHeight;
      const ph = pvLines[i].offsetHeight;
      const h = Math.max(eh, ph);
      if (eh !== h) edLines[i].style.minHeight = h + 'px';
      if (ph !== h) pvLines[i].style.minHeight = h + 'px';
    }
  });
}

/* Synchronized scrolling */
let scrollSyncing = false;
function syncScroll(source, target) {
  if (scrollSyncing) return;
  scrollSyncing = true;
  const max = source.scrollHeight - source.clientHeight;
  const ratio = max > 0 ? source.scrollTop / max : 0;
  const tmax = target.scrollHeight - target.clientHeight;
  target.scrollTop = ratio * tmax;
  requestAnimationFrame(() => { scrollSyncing = false; });
}

/* ----------------------------------------------------------------
   editable preview — user types in preview, source updates live
---------------------------------------------------------------- */
function getPreviewLineAtCursor() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  return n.closest?.('.pv-line') || null;
}

function extractPreviewLineSource(pvLine, type, lineIndex) {
  const oldLines = lastMarkdown.split('\n');
  const oldLine = oldLines[lineIndex] || '';
  if (['hr', 'image', 'fence', 'table'].includes(type)) return oldLine;

  let body = '';
  function walk(n) {
    if (n.nodeType === 3) { body += n.nodeValue; return; }
    if (n.nodeName === 'INPUT' || n.nodeName === 'IMG') return;
    if (n.classList && n.classList.contains('pv-img-wrap')) return;
    if (n.nodeName === 'BR') { body += '\n'; return; }
    for (const c of n.childNodes) walk(c);
  }
  for (const c of pvLine.childNodes) walk(c);

  if (type === 'ul') body = body.replace(/^\s*•\s*/, '');
  else if (type === 'ol') body = body.replace(/^\s*\d+\.\s*/, '');

  switch (type) {
    case 'h1': return '# ' + body;
    case 'h2': return '## ' + body;
    case 'h3': return '### ' + body;
    case 'h4': return '#### ' + body;
    case 'h5': return '##### ' + body;
    case 'h6': return '###### ' + body;
    case 'quote': {
      const m = /^(\s*>+\s*)/.exec(oldLine);
      return (m ? m[1] : '> ') + body;
    }
    case 'ul': {
      const m = /^(\s*[-*+]\s+)/.exec(oldLine);
      return (m ? m[1] : '- ') + body;
    }
    case 'ol': {
      const m = /^(\s*\d+\.\s+)/.exec(oldLine);
      return (m ? m[1] : '1. ') + body;
    }
    case 'task': {
      const m = /^(\s*[-*+]\s+\[[ xX]\]\s+)/.exec(oldLine);
      return (m ? m[1] : '- [ ] ') + body;
    }
    case 'code': return pvLine.textContent;
    case 'blank':
    case 'p':
    default:  return body;
  }
}

function handlePreviewInput(e) {
  const pvLine = e.target.closest('.pv-line');
  if (!pvLine) return;
  const lineIndex = parseInt(pvLine.dataset.line, 10);
  if (isNaN(lineIndex)) return;
  const type = pvLine.dataset.type;
  const newSource = extractPreviewLineSource(pvLine, type, lineIndex);
  const lines = lastMarkdown.split('\n');
  if (lines[lineIndex] === newSource) return;
  if (newSource.includes('\n')) {
    const expanded = newSource.split('\n');
    lines.splice(lineIndex, 1, ...expanded);
  } else {
    lines[lineIndex] = newSource;
  }
  lastMarkdown = lines.join('\n');
  // Only re-render the editor; leave preview DOM alone so the cursor stays.
  renderEditor(lastMarkdown);
  markDirty();
  scheduleSave();
  updateWordCount(lastMarkdown);
}

function handlePreviewKey(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) {
    e.preventDefault();
    applyFormat(e.key === 'b' ? 'bold' : 'italic');
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const pvLine = getPreviewLineAtCursor();
    if (!pvLine) return;
    const lineIndex = parseInt(pvLine.dataset.line, 10);
    const lines = lastMarkdown.split('\n');
    const cur = lines[lineIndex] || '';
    let prefix = '';
    let m;
    if ((m = /^(\s*)([-*+])\s+\[[ xX]\]\s+/.exec(cur))) prefix = m[1] + m[2] + ' [ ] ';
    else if ((m = /^(\s*)([-*+])\s+/.exec(cur))) prefix = m[1] + m[2] + ' ';
    else if ((m = /^(\s*)(\d+)\.\s+/.exec(cur))) prefix = m[1] + (parseInt(m[2], 10) + 1) + '. ';
    else if (/^\s*>/.test(cur)) { const im = /^(\s*>\s*)/.exec(cur); prefix = im[1]; }

    lines.splice(lineIndex + 1, 0, prefix);
    lastMarkdown = lines.join('\n');
    renderEditor(lastMarkdown);
    $('preview').innerHTML = renderPreview(lastMarkdown);
    syncLineHeights();
    markDirty();
    scheduleSave();
    const newPv = $('preview').querySelector(`.pv-line[data-line="${lineIndex + 1}"]`);
    if (newPv) {
      const range = document.createRange();
      range.selectNodeContents(newPv);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      $('preview').focus();
    }
  }
}

function setupEditablePreview() {
  const pv = $('preview');
  pv.contentEditable = 'true';
  pv.spellcheck = true;
  pv.addEventListener('input', handlePreviewInput);
  pv.addEventListener('keydown', handlePreviewKey);
  pv.addEventListener('focusout', () => {
    // After cursor leaves, re-render to normalize (e.g., heading just typed)
    setTimeout(() => {
      if (!pv.contains(document.activeElement)) schedulePreview(lastMarkdown);
    }, 50);
  });
  // Last-line catcher in preview pane
  $('panePreview').addEventListener('mousedown', (e) => {
    if (e.target.closest('.pv-line') || e.target.closest('img') || e.target.closest('input')) return;
    e.preventDefault();
    focusPreviewEnd();
  });
}

function focusPreviewEnd() {
  const pv = $('preview');
  const lines = pv.querySelectorAll('.pv-line');
  if (!lines.length) { pv.focus(); return; }
  const last = lines[lines.length - 1];
  const range = document.createRange();
  range.selectNodeContents(last);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  pv.focus();
  last.scrollIntoView({ block: 'nearest' });
}

/* ----------------------------------------------------------------
   floating format toolbar — appears on text selection
---------------------------------------------------------------- */
function setupFormatToolbar() {
  const tb = $('formatToolbar');
  if (!tb) return;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { tb.hidden = true; return; }
    const range = sel.getRangeAt(0);
    const inEditor = editor.contains(range.startContainer);
    const inPreview = $('preview').contains(range.startContainer);
    if (!inEditor && !inPreview) { tb.hidden = true; return; }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { tb.hidden = true; return; }
    tb.hidden = false;
    requestAnimationFrame(() => {
      const tw = tb.offsetWidth, th = tb.offsetHeight;
      const x = Math.max(8, Math.min(window.innerWidth - tw - 8, rect.left + rect.width / 2 - tw / 2));
      const y = Math.max(8, rect.top - th - 8);
      tb.style.left = x + 'px';
      tb.style.top = y + 'px';
    });
  });
  // Prevent losing selection when clicking the toolbar
  tb.addEventListener('mousedown', (e) => e.preventDefault());
  tb.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn) return;
    applyFormat(btn.dataset.fmt);
  });
}

function applyFormat(fmt) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const text = sel.toString();
  const wraps = { bold: '**', italic: '*', strike: '~~', code: '`' };
  if (wraps[fmt]) {
    if (!text) return;
    document.execCommand('insertText', false, wraps[fmt] + text + wraps[fmt]);
    return;
  }
  if (fmt === 'link') {
    const url = prompt('URL:', 'https://');
    if (!url) return;
    document.execCommand('insertText', false, `[${text || 'link'}](${url})`);
    return;
  }
  if (['h1', 'h2', 'h3', 'quote', 'ul', 'task'].includes(fmt)) applyLinePrefix(fmt);
}

function applyLinePrefix(fmt) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  const lineEl = n.closest?.('.ed-line') || n.closest?.('.pv-line');
  if (!lineEl) return;
  const lineIndex = parseInt(lineEl.dataset.line, 10);
  const lines = lastMarkdown.split('\n');
  let line = lines[lineIndex] || '';
  line = line.replace(/^(\s*)(#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/, '$1');
  const prefixes = { h1: '# ', h2: '## ', h3: '### ', quote: '> ', ul: '- ', task: '- [ ] ' };
  lines[lineIndex] = (prefixes[fmt] || '') + line;
  lastMarkdown = lines.join('\n');
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  syncLineHeights();
  markDirty();
  scheduleSave();
}

/* ----------------------------------------------------------------
   notes — CRUD
---------------------------------------------------------------- */
function newNote(folderId = null) {
  const id = uid();
  const note = {
    id,
    title: 'Untitled',
    body: '',
    folderId,
    tags: [],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };
  state.notes.set(id, note);
  store.notes.put(note);
  rebuildWikilinkIndex();
  openNote(id);
  renderTree();
  $('noteTitle').focus();
  $('noteTitle').select();
}

function newFolder(parentId = null) {
  const name = prompt('Folder name:');
  if (!name) return;
  const f = { id: uid(), name: name.trim(), parentId, created: Date.now() };
  state.folders.set(f.id, f);
  store.folders.put(f);
  state.expandedFolders.add(f.id);
  renderTree();
}

async function openNote(id) {
  if (state.currentNoteId === id) return;
  if (state.dirty) await saveCurrentNote();
  const note = state.notes.get(id);
  if (!note) return;
  state.currentNoteId = id;
  $('noteTitle').value = note.title || '';
  lastMarkdown = note.body || '';
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  renderBacklinks();
  renderChips();
  updatePinIcon();
  syncLineHeights();
  updateWordCount(lastMarkdown);
  markSaved();
  renderTree();
}

async function saveCurrentNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.get(state.currentNoteId);
  if (!note) return;
  const newTitle = $('noteTitle').value.trim() || 'Untitled';
  const newBody = readEditorMarkdown();
  if (note.title === newTitle && note.body === newBody) {
    markSaved();
    return;
  }
  const titleChanged = note.title !== newTitle;
  note.title = newTitle;
  note.body = newBody;
  note.updated = Date.now();
  await store.notes.put(note);
  if (titleChanged) {
    rebuildWikilinkIndex();
    schedulePreview(lastMarkdown);
  }
  markSaved();
  renderTree();
}

async function deleteCurrentNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.get(state.currentNoteId);
  if (!confirm(`Delete "${note.title}"? This cannot be undone.`)) return;
  await store.notes.del(note.id);
  state.notes.delete(note.id);
  rebuildWikilinkIndex();
  state.currentNoteId = null;
  // pick another note
  const next = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
  if (next) openNote(next.id);
  else clearEditor();
  renderTree();
  toast('Note deleted');
}

function clearEditor() {
  state.currentNoteId = null;
  $('noteTitle').value = '';
  lastMarkdown = '';
  renderEditor('');
  $('preview').innerHTML = '';
  renderChips();
  markSaved();
}

function togglePin() {
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  n.pinned = !n.pinned;
  n.updated = Date.now();
  store.notes.put(n);
  updatePinIcon();
  renderTree();
}
function updatePinIcon() {
  const btn = $('btn-pin');
  if (!state.currentNoteId) { btn.classList.remove('active'); return; }
  const n = state.notes.get(state.currentNoteId);
  btn.classList.toggle('active', !!n?.pinned);
}

/* ----------------------------------------------------------------
   tags / chips
---------------------------------------------------------------- */
function renderChips() {
  const c = $('chips');
  c.replaceChildren();
  if (!state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  for (const tag of n.tags) {
    const chip = el('span', { class: 'chip' }, '#' + tag,
      el('button', { title: 'Remove tag', onclick: () => removeTag(tag) }, '×'));
    c.append(chip);
  }
}
function addTag(tag) {
  tag = tag.trim().replace(/^#/, '').toLowerCase();
  if (!tag || !state.currentNoteId) return;
  const n = state.notes.get(state.currentNoteId);
  if (!n.tags.includes(tag)) {
    n.tags.push(tag);
    n.updated = Date.now();
    store.notes.put(n);
    renderChips();
    renderTagCloud();
    markSaved();
  }
}
function removeTag(tag) {
  const n = state.notes.get(state.currentNoteId);
  n.tags = n.tags.filter((t) => t !== tag);
  n.updated = Date.now();
  store.notes.put(n);
  renderChips();
  renderTagCloud();
}

/* ----------------------------------------------------------------
   tree (sidebar) — folders + notes + filters
---------------------------------------------------------------- */
function renderTree() {
  const root = $('tree');
  root.replaceChildren();

  const q = state.searchQuery.toLowerCase();
  const filterTag = state.activeTagFilter;
  const filterFolder = state.activeFolderFilter;

  // Filtered set of notes (after search + tag)
  const visible = [...state.notes.values()].filter((n) => {
    if (filterTag && !n.tags.includes(filterTag)) return false;
    if (q && !(n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.join(' ').toLowerCase().includes(q))) return false;
    return true;
  });

  // Pinned section
  const pinned = visible.filter((n) => n.pinned).sort((a, b) => b.updated - a.updated);
  if (pinned.length) {
    const sec = el('div', { class: 'tree-section' });
    sec.append(el('div', { class: 'tree-section-title' }, 'Pinned'));
    for (const n of pinned) sec.append(noteRow(n));
    root.append(sec);
  }

  // Folder tree
  const folderSec = el('div', { class: 'tree-section' });
  const ftitle = el('div', { class: 'tree-section-title' }, 'Folders',
    el('button', { class: 'icon-btn', title: 'New folder', onclick: () => newFolder(null), style: { width: '20px', height: '20px' } }, '+'));
  folderSec.append(ftitle);
  // root-level pseudo: notes without folder
  const orphanNotes = visible.filter((n) => !n.folderId && !n.pinned).sort((a, b) => b.updated - a.updated);
  for (const n of orphanNotes) folderSec.append(noteRow(n));
  // top-level folders
  const topFolders = [...state.folders.values()].filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name));
  for (const f of topFolders) folderSec.append(folderRow(f, visible, 0));
  if (!topFolders.length && !orphanNotes.length) {
    folderSec.append(el('div', { class: 'tree-empty' }, q || filterTag ? 'No matches' : 'No notes yet'));
  }
  root.append(folderSec);

  renderTagCloud();
  updateStorageMeter();
}

function folderRow(f, visibleNotes, depth) {
  const wrap = el('div');
  const expanded = state.expandedFolders.has(f.id);
  const isActive = state.activeFolderFilter === f.id;
  const childFolders = [...state.folders.values()].filter((x) => x.parentId === f.id).sort((a, b) => a.name.localeCompare(b.name));
  const childNotes = visibleNotes.filter((n) => n.folderId === f.id && !n.pinned).sort((a, b) => b.updated - a.updated);
  const row = el('div', {
    class: 'tree-row folder' + (isActive ? ' active' : ''),
    style: { paddingLeft: (12 + depth * 14) + 'px' },
    onclick: () => {
      if (expanded) state.expandedFolders.delete(f.id);
      else state.expandedFolders.add(f.id);
      renderTree();
    },
    oncontextmenu: (e) => { e.preventDefault(); folderMenu(e, f); },
  });
  row.append(el('span', { class: 'twist' }, expanded ? '▾' : '▸'));
  row.append(svgIcon('folder'));
  row.append(el('span', { class: 'label' }, f.name));
  row.append(el('span', { class: 'menu-trigger', title: 'Add note', onclick: (e) => { e.stopPropagation(); newNote(f.id); } }, '+'));
  wrap.append(row);
  if (expanded) {
    const kids = el('div', { class: 'tree-children' });
    for (const sf of childFolders) kids.append(folderRow(sf, visibleNotes, depth + 1));
    for (const n of childNotes) kids.append(noteRow(n, depth + 1));
    if (!childFolders.length && !childNotes.length) kids.append(el('div', { class: 'tree-empty' }, 'Empty'));
    wrap.append(kids);
  }
  return wrap;
}

function noteRow(n, depth = 0) {
  const isActive = state.currentNoteId === n.id;
  const row = el('div', {
    class: 'tree-row note' + (isActive ? ' active' : ''),
    style: { paddingLeft: (24 + depth * 14) + 'px' },
    draggable: 'true',
    onclick: () => openNote(n.id),
    oncontextmenu: (e) => { e.preventDefault(); noteMenu(e, n); },
    ondragstart: (e) => { e.dataTransfer.setData('text/yanta-note', n.id); },
  });
  row.append(svgIcon('doc'));
  row.append(el('span', { class: 'label' }, n.title || 'Untitled'));
  if (n.pinned) row.append(el('span', { class: 'pin', title: 'Pinned' }, '●'));
  return row;
}

function svgIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  let path;
  if (name === 'folder') {
    path = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
  } else {
    path = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6';
  }
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

function renderTagCloud() {
  const c = $('tagCloud');
  c.replaceChildren();
  const counts = new Map();
  for (const n of state.notes.values()) {
    for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return;
  for (const [t, n] of sorted) {
    const p = el('span', {
      class: 'tag-pill' + (state.activeTagFilter === t ? ' active' : ''),
      onclick: () => { state.activeTagFilter = state.activeTagFilter === t ? null : t; renderTree(); },
    }, '#' + t, el('span', { class: 'count' }, String(n)));
    c.append(p);
  }
}

/* ----------------------------------------------------------------
   context menus
---------------------------------------------------------------- */
let activeMenu = null;
function showMenu(x, y, items) {
  closeMenu();
  const m = el('div', { class: 'ctx-menu', style: { left: x + 'px', top: y + 'px' } });
  for (const it of items) {
    if (it === 'hr') { m.append(el('hr')); continue; }
    m.append(el('button', { class: it.danger ? 'danger' : '', onclick: () => { closeMenu(); it.action(); } }, it.label));
  }
  document.body.append(m);
  activeMenu = m;
  // adjust if off screen
  const r = m.getBoundingClientRect();
  if (r.right > window.innerWidth) m.style.left = (x - r.width) + 'px';
  if (r.bottom > window.innerHeight) m.style.top = (y - r.height) + 'px';
}
function closeMenu() { if (activeMenu) { activeMenu.remove(); activeMenu = null; } }
document.addEventListener('click', closeMenu);

function noteMenu(e, n) {
  showMenu(e.clientX, e.clientY, [
    { label: n.pinned ? 'Unpin' : 'Pin', action: () => { n.pinned = !n.pinned; n.updated = Date.now(); store.notes.put(n); renderTree(); updatePinIcon(); } },
    { label: 'Rename…', action: () => { const t = prompt('Title:', n.title); if (t) { n.title = t; n.updated = Date.now(); store.notes.put(n); if (state.currentNoteId === n.id) $('noteTitle').value = t; renderTree(); } } },
    { label: 'Move to folder…', action: () => moveNoteDialog(n) },
    { label: 'Duplicate', action: () => duplicateNote(n) },
    { label: 'Export as .md', action: () => exportNoteAsMd(n) },
    'hr',
    { label: 'Delete', danger: true, action: async () => { if (confirm(`Delete "${n.title}"?`)) { await store.notes.del(n.id); state.notes.delete(n.id); if (state.currentNoteId === n.id) clearEditor(); renderTree(); } } },
  ]);
}
function folderMenu(e, f) {
  showMenu(e.clientX, e.clientY, [
    { label: 'New note here', action: () => newNote(f.id) },
    { label: 'New sub-folder', action: () => newFolder(f.id) },
    { label: 'Rename…', action: () => { const t = prompt('Folder name:', f.name); if (t) { f.name = t; store.folders.put(f); renderTree(); } } },
    'hr',
    { label: 'Delete folder', danger: true, action: async () => {
      const childNotes = [...state.notes.values()].filter((n) => n.folderId === f.id);
      const msg = childNotes.length ? `Delete "${f.name}" and move ${childNotes.length} note(s) out of it?` : `Delete "${f.name}"?`;
      if (!confirm(msg)) return;
      for (const n of childNotes) { n.folderId = null; await store.notes.put(n); }
      await store.folders.del(f.id);
      state.folders.delete(f.id);
      renderTree();
    } },
  ]);
}
function moveNoteDialog(n) {
  const folders = [...state.folders.values()];
  const opts = ['(no folder)', ...folders.map((f) => f.name)];
  const choice = prompt(`Move to folder:\n${opts.map((o, i) => `${i}. ${o}`).join('\n')}\n\nEnter number:`);
  if (choice === null) return;
  const idx = parseInt(choice, 10);
  if (isNaN(idx) || idx < 0 || idx > folders.length) return;
  n.folderId = idx === 0 ? null : folders[idx - 1].id;
  n.updated = Date.now();
  store.notes.put(n);
  renderTree();
}
async function duplicateNote(src) {
  const n = { ...src, id: uid(), title: src.title + ' (copy)', created: Date.now(), updated: Date.now() };
  await store.notes.put(n);
  state.notes.set(n.id, n);
  rebuildWikilinkIndex();
  renderTree();
  openNote(n.id);
}

/* ----------------------------------------------------------------
   image insert flow
---------------------------------------------------------------- */
const imgModal = $('imageModal');
const compressPanel = $('compressPanel');
let imgWorkingBlob = null;       // original
let imgCompressedBlob = null;    // result
let imgCompressedDataUrl = null;
let imgCompressedDims = null;

function openImageModal() {
  imgModal.hidden = false;
  setTab('upload');
  imgWorkingBlob = null;
  imgCompressedBlob = null;
  compressPanel.hidden = true;
}
function closeImageModal() { imgModal.hidden = true; }

function setTab(name) {
  for (const b of imgModal.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === name);
  for (const p of imgModal.querySelectorAll('.tab-pane')) p.hidden = p.dataset.pane !== name;
  if (name === 'library') renderLibrary();
}

async function pickImageFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('Not an image', 'error'); return; }
  imgWorkingBlob = file;
  compressPanel.hidden = false;
  // default format hint
  if (file.type === 'image/png' || file.type === 'image/svg+xml') $('fmt').value = 'image/png';
  else $('fmt').value = 'image/webp';
  await recompress();
}

async function recompress() {
  if (!imgWorkingBlob) return;
  const fmt = $('fmt').value;
  const q = parseFloat($('quality').value);
  const maxW = parseInt($('maxW').value, 10);
  $('qualVal').textContent = q.toFixed(2);
  $('mwVal').textContent = maxW + ' px';

  // SVG: keep as-is, no compression
  if (imgWorkingBlob.type === 'image/svg+xml') {
    imgCompressedBlob = imgWorkingBlob;
    imgCompressedDataUrl = await blobToDataURL(imgWorkingBlob);
    imgCompressedDims = { w: 0, h: 0 };
    $('imgPreview').src = imgCompressedDataUrl;
    $('imgMeta').innerHTML = `<span>SVG (kept as-is)</span><strong>${fmtBytes(imgWorkingBlob.size)}</strong>`;
    return;
  }

  const bmp = await createImageBitmap(imgWorkingBlob);
  const ratio = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * ratio);
  const h = Math.round(bmp.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, fmt, fmt === 'image/png' ? undefined : q));
  imgCompressedBlob = blob;
  imgCompressedDims = { w, h };
  imgCompressedDataUrl = await blobToDataURL(blob);
  $('imgPreview').src = imgCompressedDataUrl;
  const orig = imgWorkingBlob.size;
  const out = blob.size;
  const pct = orig ? (100 * (orig - out) / orig) : 0;
  const cls = pct >= 0 ? 'delta-good' : 'delta-bad';
  $('imgMeta').innerHTML =
    `<span>${bmp.width}×${bmp.height} → <strong>${w}×${h}</strong></span>
     <span>${fmtBytes(orig)} → <strong>${fmtBytes(out)}</strong></span>
     <span class="${cls}">${pct >= 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%</span>`;
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

async function insertCompressedImage() {
  if (!imgCompressedBlob) { toast('Pick an image first', 'error'); return; }
  const asRef = $('asReference').checked;
  const asBase64 = $('asBase64').checked;
  let md;
  if (asRef) {
    const id = uid();
    const meta = { id, name: imgWorkingBlob.name || (id + '.img'), size: imgCompressedBlob.size, type: imgCompressedBlob.type, ts: Date.now() };
    await store.images.put({ ...meta, blob: imgCompressedBlob });
    state.imagesMeta.set(id, meta);
    const u = URL.createObjectURL(imgCompressedBlob);
    state.imageBlobs.set(id, u);
    md = `![${imgWorkingBlob.name?.replace(/\.[^.]+$/, '') || 'image'}](yanta-img://${id})`;
  } else if (asBase64) {
    md = `![${imgWorkingBlob.name?.replace(/\.[^.]+$/, '') || 'image'}](${imgCompressedDataUrl})`;
  } else {
    toast('Pick a save mode (Base64 or library reference)', 'error');
    return;
  }
  insertAtCursor('\n' + md + '\n');
  closeImageModal();
  updateStorageMeter();
  toast('Image inserted', 'success');
}

function insertAtCursor(text) {
  editor.focus();
  const pos = getCursorPos();
  let md = readEditorMarkdown();
  let newPos;
  const inserts = text.split('\n');
  if (!pos) {
    md = md + text;
    const parts = md.split('\n');
    newPos = { lineIndex: parts.length - 1, offset: parts[parts.length - 1].length };
  } else {
    const lines = md.split('\n');
    const line = lines[pos.lineIndex] || '';
    const before = line.slice(0, pos.offset);
    const after = line.slice(pos.offset);
    const insertedLines = (before + text + after).split('\n');
    lines.splice(pos.lineIndex, 1, ...insertedLines);
    md = lines.join('\n');
    const newLineIndex = pos.lineIndex + inserts.length - 1;
    const offset = inserts.length === 1
      ? pos.offset + text.length
      : inserts[inserts.length - 1].length;
    newPos = { lineIndex: newLineIndex, offset };
  }
  lastMarkdown = md;
  renderEditor(md);
  setCursorPos(newPos);
  $('preview').innerHTML = renderPreview(md);
  syncLineHeights();
  markDirty();
  scheduleSave();
  updateWordCount(md);
}

/* ----------------------------------------------------------------
   image library
---------------------------------------------------------------- */
async function renderLibrary() {
  const grid = $('libraryGrid');
  grid.replaceChildren();
  const list = [...state.imagesMeta.values()].sort((a, b) => b.ts - a.ts);
  if (!list.length) {
    grid.append(el('div', { class: 'lib-empty' }, 'No images in library yet. Insert an image with "Save as library reference" to build your library.'));
    return;
  }
  for (const meta of list) {
    let url = state.imageBlobs.get(meta.id);
    if (!url) {
      const rec = await store.images.get(meta.id);
      if (rec) { url = URL.createObjectURL(rec.blob); state.imageBlobs.set(meta.id, url); }
    }
    const item = el('div', { class: 'lib-item', title: `${meta.name} · ${fmtBytes(meta.size)}`,
      onclick: () => {
        insertAtCursor(`\n![${meta.name.replace(/\.[^.]+$/, '')}](yanta-img://${meta.id})\n`);
        closeImageModal();
      } });
    item.append(el('img', { src: url, alt: meta.name }));
    item.append(el('div', { class: 'lib-meta' },
      el('span', {}, meta.name.slice(0, 14)),
      el('span', {}, fmtBytes(meta.size))));
    item.append(el('button', { class: 'lib-del', title: 'Delete from library',
      onclick: async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${meta.name}"? References will break.`)) return;
        await store.images.del(meta.id);
        state.imagesMeta.delete(meta.id);
        if (state.imageBlobs.has(meta.id)) { URL.revokeObjectURL(state.imageBlobs.get(meta.id)); state.imageBlobs.delete(meta.id); }
        renderLibrary();
        updateStorageMeter();
      } }, '×'));
    grid.append(item);
  }
}

/* ----------------------------------------------------------------
   import / export
---------------------------------------------------------------- */
function safeFilename(s) {
  return (s || 'untitled').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function noteToFrontmatter(n) {
  const meta = {};
  if (n.tags?.length) meta.tags = n.tags;
  if (n.pinned) meta.pinned = true;
  if (n.folderId) {
    const folder = state.folders.get(n.folderId);
    if (folder) meta.folder = folder.name;
  }
  meta.created = new Date(n.created).toISOString();
  meta.updated = new Date(n.updated).toISOString();
  if (Object.keys(meta).length === 0) return '';
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    else lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function parseFrontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const mm = /^(\w+):\s*(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2].trim();
    if (/^\[.*\]$/.test(v)) { try { meta[mm[1]] = JSON.parse(v); continue; } catch {} }
    if (v === 'true') meta[mm[1]] = true;
    else if (v === 'false') meta[mm[1]] = false;
    else { try { meta[mm[1]] = JSON.parse(v); } catch { meta[mm[1]] = v; } }
  }
  return { meta, body: md.slice(m[0].length) };
}

// Export a single note as a .md file
async function exportNoteAsMd(note) {
  if (!note) return;
  const md = noteToFrontmatter(note) + (note.body || '');
  const blob = new Blob([md], { type: 'text/markdown' });
  downloadBlob(blob, safeFilename(note.title) + '.md');
  toast('Exported "' + (note.title || 'note') + '.md"', 'success');
}

// Export every note as a separate .md file, batched into a single download:
// produces a .json "archive" you can later re-import. For raw .md export of
// individual notes use the per-note button or context-menu.
async function exportAllMarkdown() {
  // We use a single text "ZIP-like" archive: each file is delimited.
  // Simpler: emit a .json bundle (already supported), or trigger N downloads.
  // We'll pick: ask the user.
  exportBundle();
}

async function exportBundle() {
  // Bundles notes + folders + images as one portable JSON
  const images = [];
  for (const meta of state.imagesMeta.values()) {
    const rec = await store.images.get(meta.id);
    if (rec) {
      const dataUrl = await blobToDataURL(rec.blob);
      images.push({ ...meta, data: dataUrl });
    }
  }
  const bundle = {
    yanta: 1,
    exported: new Date().toISOString(),
    notes: [...state.notes.values()],
    folders: [...state.folders.values()],
    images,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `yanta-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Exported full bundle', 'success');
}

// Export every note as individual .md files (triggers one download per note;
// browsers usually let you allow multi-download once)
async function exportEveryNoteMd() {
  const notes = [...state.notes.values()];
  if (!notes.length) { toast('Nothing to export', 'error'); return; }
  if (!confirm(`Download ${notes.length} .md file(s)? Your browser may ask to allow multiple downloads.`)) return;
  for (const n of notes) {
    const md = noteToFrontmatter(n) + (n.body || '');
    const blob = new Blob([md], { type: 'text/markdown' });
    downloadBlob(blob, safeFilename(n.title) + '.md');
    await new Promise((r) => setTimeout(r, 80));
  }
  toast('Exported ' + notes.length + ' note(s)', 'success');
}

// Open the Export menu anchored to a button
function openExportMenu(anchorBtn) {
  const r = anchorBtn.getBoundingClientRect();
  const note = state.currentNoteId ? state.notes.get(state.currentNoteId) : null;
  showMenu(r.left, r.bottom + 4, [
    { label: note ? `Export current note (.md)` : 'Export current note (.md)', action: () => note && exportNoteAsMd(note) },
    { label: 'Export every note as .md files', action: exportEveryNoteMd },
    'hr',
    { label: 'Export full bundle (.json)', action: exportBundle },
  ]);
}

// Ensure a folder path (array of segment names) exists, return its id (or null).
const _folderCache = new Map();
async function ensureFolderPath(pathArr) {
  if (!pathArr || pathArr.length === 0) return null;
  const key = pathArr.join('/');
  if (_folderCache.has(key)) return _folderCache.get(key);
  let parentId = null;
  let cum = '';
  for (const seg of pathArr) {
    cum += (cum ? '/' : '') + seg;
    if (_folderCache.has(cum)) { parentId = _folderCache.get(cum); continue; }
    const existing = [...state.folders.values()].find((f) => f.name === seg && f.parentId === parentId);
    if (existing) { _folderCache.set(cum, existing.id); parentId = existing.id; continue; }
    const f = { id: uid(), name: seg, parentId, created: Date.now() };
    state.folders.set(f.id, f);
    await store.folders.put(f);
    state.expandedFolders.add(f.id);
    _folderCache.set(cum, f.id);
    parentId = f.id;
  }
  return parentId;
}

async function importBundleFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.yanta) throw new Error('Not a YANTA bundle');
  for (const f of data.folders || []) { state.folders.set(f.id, f); await store.folders.put(f); }
  for (const n of data.notes || []) { state.notes.set(n.id, n); await store.notes.put(n); }
  for (const im of data.images || []) {
    const blob = await (await fetch(im.data)).blob();
    const { data: _, ...meta } = im;
    await store.images.put({ ...meta, blob });
    state.imagesMeta.set(meta.id, meta);
  }
}

// Import items with optional folder path; pathArr is the folder hierarchy
// (folder names only, NOT including the file). Notes land in their folder;
// JSON bundles merge globally; unknown files are skipped.
async function importItems(items) {
  _folderCache.clear();
  let noteCount = 0, bundleCount = 0, failed = 0, skipped = 0;
  for (const { file, pathArr } of items) {
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) {
        await importBundleFile(file);
        bundleCount++;
      } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
        const text = await file.text();
        const { meta, body } = parseFrontmatter(text);
        let folderId = await ensureFolderPath(pathArr);
        if (!folderId && meta.folder) folderId = await ensureFolderPath([meta.folder]);
        const title = file.name.replace(/\.(md|markdown|txt)$/i, '');
        const note = {
          id: uid(),
          title,
          body,
          folderId,
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          pinned: !!meta.pinned,
          created: meta.created ? Date.parse(meta.created) || Date.now() : Date.now(),
          updated: Date.now(),
        };
        state.notes.set(note.id, note);
        await store.notes.put(note);
        noteCount++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error('Import failed for', file.name, e);
      failed++;
    }
  }
  rebuildWikilinkIndex();
  renderTree();
  const parts = [];
  if (noteCount) parts.push(`${noteCount} note${noteCount === 1 ? '' : 's'}`);
  if (bundleCount) parts.push(`${bundleCount} bundle${bundleCount === 1 ? '' : 's'}`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  toast('Imported ' + (parts.join(', ') || 'nothing'), failed ? 'error' : 'success');
}

// Back-compat: flat list of files with no folder context
async function importFiles(files) {
  return importItems(files.map((f) => ({ file: f, pathArr: [] })));
}

/* Walk a webkitGetAsEntry tree (supports nested directories) */
async function walkEntry(entry, pathArr = []) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    return [{ file, pathArr }];
  }
  // Directory: include its own name in the path of its children
  const childPath = [...pathArr, entry.name];
  const reader = entry.createReader();
  const all = [];
  // readEntries returns at most 100 at a time; keep calling until empty
  while (true) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) {
      all.push(...(await walkEntry(e, childPath)));
    }
  }
  return all;
}

/* ----------------------------------------------------------------
   storage meter
---------------------------------------------------------------- */
async function updateStorageMeter() {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      $('storageMeter').textContent = fmtBytes(est.usage || 0);
      $('storageMeter').title = `Used ${fmtBytes(est.usage || 0)} of ~${fmtBytes(est.quota || 0)}`;
    }
  } catch {}
}

/* ----------------------------------------------------------------
   theme — auto / dark / light
---------------------------------------------------------------- */
const THEMES = ['auto', 'dark', 'light'];
function setTheme(t) {
  if (!THEMES.includes(t)) t = 'auto';
  state.theme = t;
  document.documentElement.dataset.theme = t;
  store.settings.set('theme', t);
  const btn = $('btn-theme');
  if (btn) btn.title = `Theme: ${t} (click to cycle)`;
}
function toggleTheme() {
  const i = THEMES.indexOf(state.theme);
  setTheme(THEMES[(i + 1) % THEMES.length]);
  toast(`Theme: ${state.theme}`);
}

/* ================================================================
   Wikilinks — [[Target]] / [[Target|alias]]
================================================================ */
const wikilinkIndex = new Map(); // titleLower -> noteId

function rebuildWikilinkIndex() {
  wikilinkIndex.clear();
  for (const n of state.notes.values()) {
    if (n.title) wikilinkIndex.set(n.title.toLowerCase(), n.id);
  }
}

const WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;

// All notes that link to `noteId`, with one example line each.
function getBacklinks(noteId) {
  const note = state.notes.get(noteId);
  if (!note) return [];
  const target = note.title.trim().toLowerCase();
  const out = [];
  for (const n of state.notes.values()) {
    if (n.id === noteId) continue;
    WIKILINK_RE.lastIndex = 0;
    let m;
    let foundLine = null;
    while ((m = WIKILINK_RE.exec(n.body || '')) !== null) {
      if (m[1].trim().toLowerCase() === target) {
        const before = n.body.slice(0, m.index);
        const lineIdx = before.split('\n').length - 1;
        foundLine = (n.body.split('\n')[lineIdx] || '').trim();
        break;
      }
    }
    if (foundLine != null) out.push({ note: n, line: foundLine });
  }
  return out.sort((a, b) => b.note.updated - a.note.updated);
}

function renderBacklinks() {
  const pv = $('preview');
  const old = pv.querySelector('.backlinks');
  if (old) old.remove();
  if (!state.currentNoteId) return;
  const back = getBacklinks(state.currentNoteId);
  const wrap = el('div', { class: 'backlinks', contenteditable: 'false' });
  const title = el('div', { class: 'backlinks-title' }, 'Linked from',
    el('span', { class: 'badge' }, String(back.length)));
  wrap.append(title);
  if (!back.length) {
    wrap.append(el('div', { class: 'backlinks-empty' }, 'No backlinks yet. Reference this note from another with [[' + (state.notes.get(state.currentNoteId)?.title || '') + ']].'));
  } else {
    for (const { note, line } of back) {
      const item = el('div', { class: 'backlink', onclick: () => openNote(note.id) });
      item.append(el('div', { class: 'bl-title' }, note.title || 'Untitled'));
      // highlight the [[link]] in the context
      const tname = state.notes.get(state.currentNoteId).title;
      const ctx = line.replace(new RegExp('\\[\\[' + tname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\|[^\\]]+)?\\]\\]', 'gi'), `<span class="bl-mark">[[${escapeHtml(tname)}$1]]</span>`);
      const ctxDiv = el('div', { class: 'bl-context' });
      ctxDiv.innerHTML = ctx.length > 200 ? ctx.slice(0, 200) + '…' : ctx;
      item.append(ctxDiv);
      wrap.append(item);
    }
  }
  pv.append(wrap);
}

// Patch: re-render backlinks after preview renders
const _origSchedulePreview = schedulePreview;
function schedulePreviewWithBacklinks(md) {
  _origSchedulePreview(md);
  // backlinks render after preview content
  setTimeout(renderBacklinks, 130);
}
// replace the binding (functions referencing schedulePreview keep old name)
// We'll add explicit calls to renderBacklinks where needed.

/* ================================================================
   Wikilink click / create flow
================================================================ */
function handleWikilinkClick(e) {
  const a = e.target.closest('a.wiki-link');
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  const target = a.dataset.wiki;
  const id = a.dataset.noteId;
  if (id && state.notes.get(id)) {
    openNote(id);
  } else {
    if (confirm(`Note "${target}" doesn't exist yet. Create it?`)) {
      createNoteWithTitle(target);
    }
  }
}
async function createNoteWithTitle(title) {
  const note = {
    id: uid(),
    title: title.trim() || 'Untitled',
    body: '',
    folderId: state.currentNoteId ? state.notes.get(state.currentNoteId)?.folderId || null : null,
    tags: [],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
  };
  state.notes.set(note.id, note);
  await store.notes.put(note);
  rebuildWikilinkIndex();
  openNote(note.id);
  renderTree();
}

/* ================================================================
   Autocomplete popup — used for [[ wikilinks
================================================================ */
const ac = {
  el: null, items: [], active: 0,
  triggerStart: -1, lineDiv: null, mode: 'wiki', // 'wiki'
};
function acHide() {
  const e = $('autocomplete');
  if (e) e.hidden = true;
  ac.items = []; ac.triggerStart = -1; ac.active = 0;
}
function acShowWiki(query, anchorRect) {
  const e = $('autocomplete');
  if (!e) return;
  const q = query.toLowerCase();
  // Score notes by title containing query
  const all = [...state.notes.values()]
    .filter((n) => n.id !== state.currentNoteId)
    .map((n) => ({ n, score: scoreMatch(n.title || '', q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  ac.items = all.map(({ n }) => ({ kind: 'note', id: n.id, label: n.title || 'Untitled', meta: 'note' }));
  // Always offer "Create" if query is non-empty and no exact match
  if (query.trim() && !state.notes.has(wikilinkIndex.get(query.trim().toLowerCase()))) {
    ac.items.push({ kind: 'create', label: 'Create "' + query.trim() + '"', meta: 'new', value: query.trim() });
  }
  if (!ac.items.length) { acHide(); return; }
  ac.active = 0;
  e.replaceChildren();
  for (let i = 0; i < ac.items.length; i++) {
    const it = ac.items[i];
    const row = el('div', {
      class: 'ac-item' + (i === ac.active ? ' active' : ''),
      dataset: { i: String(i) },
      onclick: () => acAccept(i),
    });
    if (it.kind === 'create') row.classList.add('create');
    row.append(el('span', { class: 'ac-icon' }, it.kind === 'create' ? '+' : '◆'));
    row.append(el('span', { class: 'ac-label' }, it.label));
    row.append(el('span', { class: 'ac-meta' }, it.meta));
    e.append(row);
  }
  e.hidden = false;
  // position below the cursor; anchorRect is the caret bounding rect
  const ew = e.offsetWidth || 240, eh = e.offsetHeight || 160;
  let x = anchorRect.left;
  let y = anchorRect.bottom + 4;
  if (x + ew > window.innerWidth - 8) x = window.innerWidth - ew - 8;
  if (y + eh > window.innerHeight - 8) y = anchorRect.top - eh - 4;
  e.style.left = x + 'px';
  e.style.top = y + 'px';
}
function acMove(delta) {
  if (!ac.items.length) return;
  ac.active = (ac.active + delta + ac.items.length) % ac.items.length;
  const e = $('autocomplete');
  for (const child of e.children) child.classList.toggle('active', parseInt(child.dataset.i, 10) === ac.active);
  const sel = e.children[ac.active];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
async function acAccept(i) {
  if (i == null) i = ac.active;
  const item = ac.items[i];
  if (!item) { acHide(); return; }
  let inserted;
  if (item.kind === 'create') {
    inserted = item.value;
  } else {
    inserted = item.label;
  }
  // Replace the partial text from `[[<query>` with `[[<inserted>]]`
  replaceWikiTrigger(inserted);
  acHide();
}
function replaceWikiTrigger(insertText) {
  const pos = getCursorPos();
  if (!pos) return;
  const lines = lastMarkdown.split('\n');
  const line = lines[pos.lineIndex] || '';
  // Find the `[[` to the left of cursor (within this line)
  const before = line.slice(0, pos.offset);
  const open = before.lastIndexOf('[[');
  if (open < 0) return;
  const after = line.slice(pos.offset);
  // Replace from `[[` to cursor with [[insertText]]
  const newLine = line.slice(0, open) + '[[' + insertText + ']]' + after;
  lines[pos.lineIndex] = newLine;
  lastMarkdown = lines.join('\n');
  renderEditor(lastMarkdown);
  const newOffset = open + 2 + insertText.length + 2;
  setCursorPos({ lineIndex: pos.lineIndex, offset: newOffset });
  schedulePreview(lastMarkdown);
  setTimeout(renderBacklinks, 200);
  markDirty(); scheduleSave();
}

// Detect [[ trigger after each input event in the editor.
function checkWikiAutocomplete() {
  const pos = getCursorPos();
  if (!pos) { acHide(); return; }
  const lines = lastMarkdown.split('\n');
  const line = lines[pos.lineIndex] || '';
  const before = line.slice(0, pos.offset);
  const open = before.lastIndexOf('[[');
  const close = before.lastIndexOf(']]');
  if (open < 0 || close > open) { acHide(); return; }
  // We're inside an unclosed [[
  const query = before.slice(open + 2);
  if (query.length > 40 || /\n/.test(query)) { acHide(); return; }
  // Get caret rect
  const sel = window.getSelection();
  if (!sel.rangeCount) { acHide(); return; }
  const rng = sel.getRangeAt(0).cloneRange();
  let rect = rng.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    // collapsed at end — use the parent line's rect end
    const blocks = [...editor.children];
    const lineEl = blocks[pos.lineIndex];
    if (lineEl) rect = lineEl.getBoundingClientRect();
  }
  acShowWiki(query, rect);
}

/* ================================================================
   Command palette + Quick switcher
================================================================ */
const palette = {
  mode: 'commands', // 'commands' | 'notes'
  items: [],
  active: 0,
  filter: '',
};
function openPalette(mode = 'commands') {
  palette.mode = mode;
  palette.filter = '';
  palette.active = 0;
  $('paletteInput').value = '';
  $('paletteInput').placeholder = mode === 'commands'
    ? 'Type a command…'
    : 'Type to switch to a note…';
  $('paletteMode').textContent = mode === 'commands' ? 'Command palette' : 'Quick switcher';
  buildPaletteItems();
  $('palette').hidden = false;
  $('paletteInput').focus();
}
function closePalette() {
  $('palette').hidden = true;
  palette.items = [];
}
function buildPaletteItems() {
  const q = palette.filter.trim().toLowerCase();
  if (palette.mode === 'commands') {
    palette.items = commandList
      .map((c) => ({ ...c, score: q ? scoreMatch(c.label, q) + (c.label.toLowerCase().startsWith(q) ? 50 : 0) : 1 }))
      .filter((c) => !q || c.score > 0)
      .sort((a, b) => b.score - a.score);
  } else {
    palette.items = [...state.notes.values()]
      .map((n) => ({ id: n.id, label: n.title || 'Untitled', folder: state.folders.get(n.folderId)?.name || '', score: q ? scoreMatch(n.title || '', q) : (Date.now() - n.updated) * -1 / 1e9 + 1 }))
      .filter((n) => !q || n.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 80);
  }
  palette.active = 0;
  renderPaletteList();
}
function renderPaletteList() {
  const list = $('paletteList');
  list.replaceChildren();
  if (!palette.items.length) {
    list.append(el('div', { class: 'palette-empty' }, palette.mode === 'commands' ? 'No matching command' : 'No matching note'));
    return;
  }
  for (let i = 0; i < palette.items.length; i++) {
    const it = palette.items[i];
    const row = el('div', {
      class: 'palette-item' + (i === palette.active ? ' active' : ''),
      dataset: { i: String(i) },
      onclick: () => paletteAccept(i),
      onmouseenter: () => { palette.active = i; for (const c of list.children) c.classList.toggle('active', parseInt(c.dataset.i, 10) === i); },
    });
    if (palette.mode === 'commands') {
      row.append(el('span', { class: 'pi-icon' }, it.icon || '·'));
      row.append(el('span', { class: 'pi-label' }, it.label));
      if (it.hint) row.append(el('span', { class: 'pi-hint' }, it.hint));
    } else {
      row.append(el('span', { class: 'pi-icon' }, '◆'));
      row.append(el('span', { class: 'pi-label' }, it.label));
      if (it.folder) row.append(el('span', { class: 'pi-meta' }, it.folder));
    }
    list.append(row);
  }
  // ensure active is visible
  const a = list.children[palette.active];
  if (a) a.scrollIntoView({ block: 'nearest' });
}
function paletteMove(delta) {
  if (!palette.items.length) return;
  palette.active = (palette.active + delta + palette.items.length) % palette.items.length;
  renderPaletteList();
}
function paletteAccept(i) {
  if (i == null) i = palette.active;
  const it = palette.items[i];
  if (!it) return;
  closePalette();
  if (palette.mode === 'commands') {
    if (it.action) it.action();
  } else {
    openNote(it.id);
  }
}

let commandList = [];
function buildCommandList() {
  commandList = [
    { label: 'New note', icon: '＋', hint: 'Ctrl+N', action: () => newNote(currentFolderForNew()) },
    { label: 'New folder', icon: '▸', action: () => newFolder(null) },
    { label: 'Quick switcher (jump to note)', icon: '◆', hint: 'Ctrl+O', action: () => openPalette('notes') },
    { label: 'Open graph view', icon: '◌', hint: 'Ctrl+G', action: openGraph },
    { label: 'Search notes', icon: '⌕', hint: 'Ctrl+K', action: () => $('search').focus() },
    { label: 'Toggle preview/edit/split', icon: '◐', hint: 'Ctrl+/', action: () => setView(state.view === 'split' ? 'preview' : (state.view === 'preview' ? 'edit' : 'split')) },
    { label: 'Insert image', icon: '▣', hint: 'Ctrl+I', action: openImageModal },
    { label: 'Insert wikilink', icon: '↔', action: () => insertAtCursor('[[') },
    { label: 'Toggle pin', icon: '★', action: togglePin },
    { label: 'Cycle theme (auto/dark/light)', icon: '◑', hint: 'T', action: toggleTheme },
    { label: 'Export current note (.md)', icon: '⤓', hint: 'Ctrl+E', action: () => { const n = state.currentNoteId ? state.notes.get(state.currentNoteId) : null; if (n) exportNoteAsMd(n); } },
    { label: 'Export full bundle (.json)', icon: '⤓', action: exportBundle },
    { label: 'Export every note as .md', icon: '⤓', action: exportEveryNoteMd },
    { label: 'Import files…', icon: '⤒', action: () => $('importFile').click() },
    { label: 'Import folder…', icon: '⤒', action: () => $('importFolder').click() },
    { label: 'Delete current note', icon: '✕', action: deleteCurrentNote },
  ];
}

// Simple fuzzy-ish scorer. Higher is better. 0 means no match.
function scoreMatch(text, query) {
  if (!query) return 1;
  const t = text.toLowerCase();
  let q = 0; let score = 0; let streak = 0;
  for (let i = 0; i < t.length && q < query.length; i++) {
    if (t[i] === query[q]) { q++; score += 1 + streak; streak += 1; }
    else { streak = 0; }
  }
  if (q < query.length) return 0;
  // prefer shorter matches
  return score + 10 / (1 + t.length);
}

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
  c.addEventListener('mousedown', (e) => {
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

/* ----------------------------------------------------------------
   wire-up
---------------------------------------------------------------- */
async function init() {
  await openDB();
  // Ask the browser to persist our IndexedDB so it isn't evicted under
  // pressure. On Chrome/Firefox this either auto-grants (PWA/bookmarked)
  // or is silently ignored — no prompt for the user.
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {}

  // Load all
  const [notes, folders, images, theme, expanded, view] = await Promise.all([
    store.notes.all(),
    store.folders.all(),
    store.images.all(),
    store.settings.get('theme', 'auto'),
    store.settings.get('expandedFolders', []),
    store.settings.get('view', 'split'),
  ]);
  for (const n of notes) state.notes.set(n.id, n);
  for (const f of folders) state.folders.set(f.id, f);
  for (const im of images) {
    const { blob, ...meta } = im;
    state.imagesMeta.set(meta.id, meta);
  }
  setTheme(theme);
  state.expandedFolders = new Set(expanded);
  setView(view);

  rebuildWikilinkIndex();
  buildCommandList();
  setupGraphInteractions();

  renderTree();

  // Open most recent note, or create a welcome one
  const recent = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];
  if (recent) openNote(recent.id);
  else createWelcomeNote();

  bindEvents();
  editor.dataset.placeholder = 'Start writing in Markdown…';
}

function setView(v) {
  state.view = v;
  document.getElementById('app').dataset.view = v;
  $('btn-view-edit').classList.toggle('active', v === 'edit');
  $('btn-view-split').classList.toggle('active', v === 'split');
  $('btn-view-preview').classList.toggle('active', v === 'preview');
  store.settings.set('view', v);
  if (v !== 'edit') syncLineHeights();
}

async function createWelcomeNote() {
  const body = `# Welcome to YANTA

**Yet another note taking app** — but small, fast, and 100% local.

## Features at a glance

- Markdown editing with **live styled preview** on the right — and the preview is **editable too** (great on mobile)
- **[[Wikilinks]]** between notes — type \`[[\` to get autocomplete; click a missing link to create that note
- **Backlinks panel** below every note shows who references it
- **Interactive graph view** — see your knowledge network (Ctrl+G)
- **Command palette** for everything (Ctrl+P) · **Quick switcher** to jump to any note (Ctrl+O)
- Select text → **floating formatting toolbar** (bold · italic · headings · list · quote · link)
- Drop, paste or upload **images** — choose Base64 or library **references** · live compression preview
- **Folders** with sub-folders, **#tags**, pin, search, full offline use
- Drop a whole **folder tree** onto the window to import — structure is preserved
- **Auto theme** follows your system

> Try pasting an image from your clipboard right now (\`Ctrl+V\`).

### Shortcuts

| Action | Shortcut |
|---|---|
| Command palette | \`Ctrl+P\` |
| Quick switcher | \`Ctrl+O\` |
| Graph view | \`Ctrl+G\` |
| New note | \`Ctrl+N\` |
| Search | \`Ctrl+K\` |
| Insert image | \`Ctrl+I\` |
| Save | \`Ctrl+S\` |
| Export current note | \`Ctrl+E\` |
| Toggle preview | \`Ctrl+/\` |

### Try wikilinks

This note links to [[Welcome to YANTA]] (itself) and to a non-existent note: [[My next idea]] — click it to create the note.

### Inline formatting examples

- **bold**, *italic*, ***bold italic***, ~~strike~~, \`code\`
- A [link](https://example.com) and a #tag
- Task lists:
  - [x] Set up storage
  - [ ] Write your first note

\`\`\`js
// fenced code is preserved
console.log("hello from YANTA");
\`\`\`

Happy writing!
`;
  const id = uid();
  const note = { id, title: 'Welcome to YANTA', body, folderId: null, tags: ['welcome'], pinned: true, created: Date.now(), updated: Date.now() };
  state.notes.set(id, note);
  await store.notes.put(note);
  rebuildWikilinkIndex();
  openNote(id);
  renderTree();
}

function bindEvents() {
  // editor input
  editor.addEventListener('input', handleEditorInput);
  editor.addEventListener('keydown', handleEditorKey);
  editor.addEventListener('paste', handleEditorPaste);
  editor.addEventListener('click', handleEditorClick);

  // Click anywhere in the edit pane that isn't a real line → focus editor at end.
  $('paneEdit').addEventListener('mousedown', (e) => {
    if (e.target.closest('.ed-line') || e.target.closest('img')) return;
    e.preventDefault();
    focusEditorEnd();
  });

  // title
  $('noteTitle').addEventListener('input', () => { markDirty(); scheduleSave(); });
  $('noteTitle').addEventListener('blur', () => saveCurrentNote().then(() => renderTree()));

  // tag input
  $('tagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { addTag(e.target.value); e.target.value = ''; }
  });

  // sidebar buttons
  $('btn-new-note').addEventListener('click', () => newNote(currentFolderForNew()));
  $('btn-new-folder').addEventListener('click', () => newFolder(null));
  $('btn-theme').addEventListener('click', toggleTheme);
  $('btn-export').addEventListener('click', (e) => { e.stopPropagation(); openExportMenu(e.currentTarget); });
  $('btn-import').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'Import files (.md / .json)…', action: () => $('importFile').click() },
      { label: 'Import folder (with sub-folders)…', action: () => $('importFolder').click() },
      'hr',
      { label: 'Or drop files/folders anywhere on the window', action: () => toast('Drop files or a folder onto YANTA') },
    ]);
  });
  $('importFile').addEventListener('change', (e) => {
    if (e.target.files.length) importFiles([...e.target.files]);
    e.target.value = '';
  });
  $('importFolder').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) { e.target.value = ''; return; }
    const items = files.map((f) => {
      const parts = (f.webkitRelativePath || f.name).split('/');
      parts.pop(); // drop the filename
      return { file: f, pathArr: parts };
    });
    await importItems(items);
    e.target.value = '';
  });
  $('btn-export-note').addEventListener('click', () => {
    const n = state.currentNoteId ? state.notes.get(state.currentNoteId) : null;
    if (n) exportNoteAsMd(n);
  });
  $('btn-images').addEventListener('click', () => { openImageModal(); setTab('library'); });
  $('btn-settings').addEventListener('click', () => {
    toast('Settings: theme & view persist automatically');
  });

  // search
  $('search').addEventListener('input', (e) => { state.searchQuery = e.target.value; renderTree(); });

  // view toggles
  $('btn-view-edit').addEventListener('click', () => setView('edit'));
  $('btn-view-split').addEventListener('click', () => setView('split'));
  $('btn-view-preview').addEventListener('click', () => setView('preview'));

  // head actions
  $('btn-pin').addEventListener('click', togglePin);
  $('btn-delete').addEventListener('click', deleteCurrentNote);
  $('btn-insert-image').addEventListener('click', openImageModal);

  // modal
  imgModal.addEventListener('click', (e) => {
    if (e.target === imgModal) closeImageModal();
    if (e.target.matches('[data-close]')) closeImageModal();
    if (e.target.matches('.tab')) setTab(e.target.dataset.tab);
  });
  $('pickFile').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => { if (e.target.files[0]) pickImageFile(e.target.files[0]); });
  const dz = $('dropZone');
  dz.addEventListener('dragenter', () => dz.classList.add('over'));
  dz.addEventListener('dragleave', (e) => { if (e.target === dz) dz.classList.remove('over'); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files[0]) pickImageFile(e.dataTransfer.files[0]);
  });
  // when modal open, also accept paste
  document.addEventListener('paste', (e) => {
    if (imgModal.hidden) return;
    for (const it of e.clipboardData.items) {
      if (it.type.startsWith('image/')) { pickImageFile(it.getAsFile()); break; }
    }
  });

  $('quality').addEventListener('input', recompress);
  $('maxW').addEventListener('input', recompress);
  $('fmt').addEventListener('change', recompress);
  $('asBase64').addEventListener('change', (e) => { if (e.target.checked) $('asReference').checked = false; });
  $('asReference').addEventListener('change', (e) => { if (e.target.checked) $('asBase64').checked = false; });
  $('insertImage').addEventListener('click', insertCompressedImage);
  $('insertPath').addEventListener('click', () => {
    const path = $('pathInput').value.trim();
    if (!path) return;
    const alt = $('pathAlt').value.trim() || 'image';
    insertAtCursor(`\n![${alt}](${path})\n`);
    $('pathInput').value = ''; $('pathAlt').value = '';
    closeImageModal();
  });

  // divider drag
  setupDivider();

  // scroll sync
  const pe = $('paneEdit'); const pp = $('panePreview');
  pe.addEventListener('scroll', () => syncScroll(pe, pp));
  pp.addEventListener('scroll', () => syncScroll(pp, pe));

  // global shortcuts
  window.addEventListener('keydown', handleGlobalKey);

  // global drag-and-drop import of .md/.json files & folders
  setupGlobalDropImport();

  // make the preview editable + floating format toolbar
  setupEditablePreview();
  setupFormatToolbar();

  // preview interactions (checkbox toggle, tag click, wikilinks, backlinks)
  $('preview').addEventListener('click', (e) => {
    if (e.target.closest('a.wiki-link')) { handleWikilinkClick(e); return; }
    if (e.target.matches('input[type=checkbox][data-line]')) {
      const line = parseInt(e.target.dataset.line, 10);
      toggleTaskLine(line, e.target.checked);
    } else if (e.target.matches('.tag-ref')) {
      state.activeTagFilter = e.target.dataset.tag;
      renderTree();
    }
  });

  // Editor wikilink follow: Ctrl/Cmd+click (single click stays in edit mode)
  editor.addEventListener('click', (e) => {
    const w = e.target.closest('.ed-wiki, .ed-wiki-missing');
    if (!w) return;
    if (!(e.ctrlKey || e.metaKey)) {
      // Show a transient hint the first time
      if (!editor.dataset.hintShown) {
        toast('Tip: Ctrl/⌘+click a wikilink to follow it', '');
        editor.dataset.hintShown = '1';
      }
      return;
    }
    e.preventDefault();
    const lineDiv = w.closest('div');
    if (!lineDiv) return;
    const idx = [...editor.children].indexOf(lineDiv);
    const line = lastMarkdown.split('\n')[idx] || '';
    const m = /\[\[([^\]|\n]+)/.exec(line);
    if (m) {
      const target = m[1].trim();
      const nid = wikilinkIndex.get(target.toLowerCase());
      if (nid) openNote(nid);
      else if (confirm(`Note "${target}" doesn't exist. Create it?`)) createNoteWithTitle(target);
    }
  });

  // Editor key handling for autocomplete (must run before our other Enter handler)
  editor.addEventListener('keydown', (e) => {
    const acEl = $('autocomplete');
    if (!acEl.hidden && ac.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); acMove(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acAccept(); return; }
      if (e.key === 'Escape')    { e.preventDefault(); acHide(); return; }
    }
  }, true); // capture so we win over the other Enter handler

  // Hide autocomplete on click anywhere
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#autocomplete') && !editor.contains(e.target)) acHide();
  });

  // Palette
  $('btn-palette').addEventListener('click', () => openPalette('commands'));
  $('btn-graph').addEventListener('click', openGraph);
  const palEl = $('palette');
  palEl.addEventListener('click', (e) => { if (e.target === palEl) closePalette(); });
  $('paletteInput').addEventListener('input', (e) => {
    palette.filter = e.target.value;
    buildPaletteItems();
  });
  $('paletteInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteMove(-1); }
    else if (e.key === 'Enter')  { e.preventDefault(); paletteAccept(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });

  // resize -> re-sync heights
  window.addEventListener('resize', debounce(syncLineHeights, 100));

  // unload — flush save
  window.addEventListener('beforeunload', () => { if (state.dirty) saveCurrentNote(); });

  // persist expanded folders
  setInterval(() => store.settings.set('expandedFolders', [...state.expandedFolders]), 5000);
}

function currentFolderForNew() {
  // If current note has a folder, default new note there
  if (state.currentNoteId) {
    const n = state.notes.get(state.currentNoteId);
    return n?.folderId || null;
  }
  return null;
}

function toggleTaskLine(lineIndex, checked) {
  const lines = lastMarkdown.split('\n');
  const line = lines[lineIndex];
  if (!line) return;
  lines[lineIndex] = line.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (_, a, _b, c) => a + (checked ? 'x' : ' ') + c);
  lastMarkdown = lines.join('\n');
  renderEditor(lastMarkdown);
  $('preview').innerHTML = renderPreview(lastMarkdown);
  syncLineHeights();
  markDirty();
  scheduleSave();
}

function handleEditorKey(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) {
    e.preventDefault();
    applyFormat(e.key === 'b' ? 'bold' : 'italic');
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    insertAtCursor('  ');
    return;
  }
  if (e.key !== 'Enter') return;
  // Always intercept Enter so our line-per-div structure stays intact
  e.preventDefault();
  const pos = getCursorPos();
  if (!pos) { insertAtCursor('\n'); return; }
  const lines = lastMarkdown.split('\n');
  const line = lines[pos.lineIndex] || '';
  let prefix = '';
  let m;
  if ((m = /^(\s*)([-*+])\s+\[[ xX]\]\s*(.*)$/.exec(line))) {
    if (m[3] === '' && pos.offset === line.length) { replaceCurrentLine(''); return; }
    prefix = m[1] + m[2] + ' [ ] ';
  } else if ((m = /^(\s*)([-*+])\s+(.*)$/.exec(line))) {
    if (m[3] === '' && pos.offset === line.length) { replaceCurrentLine(''); return; }
    prefix = m[1] + m[2] + ' ';
  } else if ((m = /^(\s*)(\d+)\.\s+(.*)$/.exec(line))) {
    if (m[3] === '' && pos.offset === line.length) { replaceCurrentLine(''); return; }
    prefix = m[1] + (parseInt(m[2], 10) + 1) + '. ';
  } else if (/^\s*>/.test(line)) {
    const im = /^(\s*>\s*)/.exec(line);
    prefix = im[1];
  }
  insertAtCursor('\n' + prefix);
}

function replaceCurrentLine(text) {
  const pos = getCursorPos();
  if (!pos) return;
  const lines = lastMarkdown.split('\n');
  lines[pos.lineIndex] = text;
  lastMarkdown = lines.join('\n');
  renderEditor(lastMarkdown);
  // move cursor to end of replaced line
  setCursorPos({ lineIndex: pos.lineIndex, offset: text.length });
  schedulePreview(lastMarkdown);
  markDirty();
  scheduleSave();
}

async function handleEditorPaste(e) {
  // images?
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      e.preventDefault();
      const file = it.getAsFile();
      // Open modal pre-loaded with the pasted image
      openImageModal();
      setTab('upload');
      await pickImageFile(file);
      return;
    }
  }
  // Plain text paste — normalize line endings
  const text = e.clipboardData.getData('text/plain');
  if (text) {
    e.preventDefault();
    insertAtCursor(text.replace(/\r\n/g, '\n'));
  }
}

function focusEditorEnd() {
  editor.focus();
  const lines = editor.querySelectorAll('.ed-line');
  if (!lines.length) return;
  const last = lines[lines.length - 1];
  const range = document.createRange();
  // Place before any contenteditable=false children at the end (e.g., image thumbs)
  let placed = false;
  for (let i = last.childNodes.length - 1; i >= 0; i--) {
    const n = last.childNodes[i];
    if (n.nodeName === 'IMG' || (n.contentEditable === 'false')) continue;
    if (n.nodeType === 3) {
      range.setStart(n, n.nodeValue.length);
      placed = true; break;
    }
    range.selectNodeContents(n);
    range.collapse(false);
    placed = true; break;
  }
  if (!placed) { range.selectNodeContents(last); range.collapse(false); }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  last.scrollIntoView({ block: 'nearest' });
}

function handleEditorClick(e) {
  // Clicking the inline image thumbnail opens an action menu
  const thumb = e.target.closest('.ed-img-thumb');
  if (thumb) {
    e.preventDefault();
    const lineDiv = thumb.closest('.ed-line');
    const idx = parseInt(lineDiv.dataset.line, 10);
    showMenu(e.clientX, e.clientY, [
      { label: 'Open in new tab', action: () => window.open(thumb.src, '_blank') },
      { label: 'Copy markdown', action: () => {
        navigator.clipboard?.writeText(lastMarkdown.split('\n')[idx] || '');
        toast('Markdown copied');
      } },
      'hr',
      { label: 'Remove image', danger: true, action: () => {
        const lines = lastMarkdown.split('\n');
        lines[idx] = lines[idx].replace(/!\[[^\]]*\]\([^)]+\)/, '');
        lastMarkdown = lines.join('\n');
        renderEditor(lastMarkdown);
        schedulePreview(lastMarkdown);
        markDirty(); scheduleSave();
      } },
    ]);
  }
}

function handleGlobalKey(e) {
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key === 'n') { e.preventDefault(); newNote(currentFolderForNew()); }
  else if (meta && e.key === 'k') { e.preventDefault(); $('search').focus(); }
  else if (meta && e.key === 's') { e.preventDefault(); saveCurrentNote(); toast('Saved', 'success'); }
  else if (meta && e.key === 'i') { e.preventDefault(); openImageModal(); }
  else if (meta && e.key === 'o') { e.preventDefault(); openPalette('notes'); }
  else if (meta && e.key === 'p') { e.preventDefault(); openPalette('commands'); }
  else if (meta && e.key === 'g') { e.preventDefault(); openGraph(); }
  else if (meta && e.key === 'e') {
    e.preventDefault();
    const n = state.currentNoteId ? state.notes.get(state.currentNoteId) : null;
    if (n) exportNoteAsMd(n);
  }
  else if (meta && e.key === '/') { e.preventDefault(); setView(state.view === 'split' ? 'preview' : 'split'); }
  else if (e.key === 'Escape') {
    closeImageModal();
    closeMenu();
    closePalette();
    if (!$('graphOverlay').hidden) closeGraph();
    acHide();
    $('dropOverlay').hidden = true;
  }
}

function setupGlobalDropImport() {
  const overlay = $('dropOverlay');
  let hideTimer = null;
  function isFileDrag(e) {
    return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  }
  // dragover fires continuously while a drag is in progress; if it stops
  // firing for ~120ms, the drag has left the window — hide the overlay.
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    overlay.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { overlay.hidden = true; }, 120);
  });
  window.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    clearTimeout(hideTimer);
    overlay.hidden = true;

    // Prefer the items API (so we can recurse into folders)
    const items = e.dataTransfer.items ? [...e.dataTransfer.items] : [];
    const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    const hasDirectory = entries.some((en) => en && en.isDirectory);

    if (hasDirectory) {
      const collected = [];
      for (const entry of entries) {
        try {
          collected.push(...(await walkEntry(entry, [])));
        } catch (err) {
          console.error('walkEntry failed', err);
        }
      }
      if (collected.length) await importItems(collected);
      else toast('Folder was empty', 'error');
      return;
    }

    // No directories — flat list of files
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (files.length === 1 && files[0].type.startsWith('image/')) {
      openImageModal();
      setTab('upload');
      await pickImageFile(files[0]);
      return;
    }
    const importable = files.filter((f) =>
      /\.(md|markdown|txt|json)$/i.test(f.name) ||
      f.type === 'application/json' || f.type === 'text/markdown' || f.type === 'text/plain'
    );
    if (importable.length) {
      await importFiles(importable);
    } else {
      toast('Drop .md, .markdown, .txt, or YANTA .json files', 'error');
    }
  });
}

function setupDivider() {
  const div = $('divider');
  let dragging = false;
  div.addEventListener('mousedown', (e) => {
    dragging = true;
    div.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const panes = $('panes').getBoundingClientRect();
    const pct = Math.min(85, Math.max(15, ((e.clientX - panes.left) / panes.width) * 100));
    document.documentElement.style.setProperty('--split', pct + '%');
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    div.classList.remove('dragging');
    document.body.style.cursor = '';
    syncLineHeights();
  });
}

init().catch((e) => {
  console.error(e);
  toast('Failed to start: ' + e.message, 'error');
});
