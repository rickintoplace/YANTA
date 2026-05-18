/* ============================================================
   YANTA — markdown rendering
   classifyLine, renderInline, renderPreview, admonitions,
   footnotes, transclusion, video embeds, math.
   ============================================================ */
'use strict';

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

/* ----------------------------------------------------------------
   YouTube / Vimeo URL detection
---------------------------------------------------------------- */
function videoEmbedUrl(url) {
  let m;
  if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(url))) {
    return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  }
  if ((m = /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/.exec(url))) {
    return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  }
  if ((m = /vimeo\.com\/(\d+)/.exec(url))) {
    return `https://player.vimeo.com/video/${m[1]}`;
  }
  return null;
}

/* ----------------------------------------------------------------
   Inline tokenizer for preview (HTML output).
   Order matters: escape -> code -> transclusion -> wikilinks ->
   images -> md links -> bold -> ... -> footnotes -> math -> tags.
---------------------------------------------------------------- */
function renderInline(s) {
  let out = escapeHtml(s);
  // inline code (protect content from further pattern matches)
  out = out.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  // transclusion ![[Note]] or ![[Note#Section]] or ![[Note|alias]]
  out = out.replace(/!\[\[([^\]\n#|]+)(?:#([^\]\n|]+))?(?:\|([^\]\n]+))?\]\]/g, (_, title, section, alias) => {
    const decoded = decodeEntities(title.trim());
    const nid = wikilinkIndex.get(decoded.toLowerCase());
    if (!nid) {
      return `<div class="pv-trans pv-trans-missing">↳ <strong>${title}</strong> · not found</div>`;
    }
    if (transcludeDepth >= 3) {
      return `<div class="pv-trans pv-trans-loop">↳ ${title} · transclusion too deep</div>`;
    }
    const note = state.notes.get(nid);
    if (!note) return '';
    let body = note.body || '';
    if (section) body = extractSection(body, decodeEntities(section.trim()));
    transcludeDepth++;
    const rendered = renderBlocksInline(body);
    transcludeDepth--;
    const label = alias ? alias.trim() : (title + (section ? ' › ' + section : ''));
    return `<div class="pv-trans" contenteditable="false">
      <div class="pv-trans-head">↳ <a class="wiki-link" data-wiki="${decoded}" data-note-id="${nid}">${label}</a></div>
      <div class="pv-trans-body">${rendered}</div>
    </div>`;
  });
  // wikilinks [[Target]] or [[Target|alias]]
  out = out.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, target, alias) => {
    const decoded = decodeEntities(target.trim());
    const key = decoded.toLowerCase();
    const noteId = wikilinkIndex.get(key);
    const text = (alias || target).trim();
    const cls = noteId ? 'wiki-link' : 'wiki-link missing';
    const id = noteId ? ` data-note-id="${noteId}"` : '';
    return `<a class="${cls}" data-wiki="${target.trim()}"${id}>${text}</a>`;
  });
  // images ![alt](url "title") — also: auto-embed YouTube/Vimeo URLs
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
    const embed = videoEmbedUrl(decodeEntities(url));
    if (embed) {
      return `<div class="pv-embed-video" contenteditable="false"><iframe src="${embed}" allowfullscreen frameborder="0" allow="autoplay; encrypted-media; picture-in-picture"></iframe></div>`;
    }
    const resolved = resolveImageUrl(decodeEntities(url));
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    if (resolved === null) {
      return `<span class="pv-img-missing">missing: ${escapeHtml(url.slice(0, 40))}…</span>`;
    }
    return `<span class="pv-img-wrap" contenteditable="false"><img src="${resolved}" alt="${escapeHtml(alt)}"${t} loading="lazy" draggable="false" /></span>`;
  });
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) =>
    `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`);
  // DOI shortcut: doi:10.xxxx/yyyy
  out = out.replace(/\bdoi:(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/gi, (_, d) =>
    `<a href="https://doi.org/${d}" target="_blank" rel="noopener" class="pv-doi">doi:${d}</a>`);
  // bold + italic combined
  out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  out = out.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  // footnote references [^id]
  out = out.replace(/\[\^([^\]\s]+)\]/g, (_, id) => {
    return `<sup class="fn-ref"><a href="#fn-${id}" data-fn="${id}">${id}</a></sup>`;
  });
  // basic math placeholder — $...$ inline, $$...$$ display
  out = out.replace(/\$\$([^$\n]+)\$\$/g, (_, expr) =>
    `<span class="pv-math pv-math-block">${expr}</span>`);
  out = out.replace(/(?<!\\)\$([^$\n]+)\$/g, (_, expr) =>
    `<span class="pv-math">${expr}</span>`);
  // hashtag refs
  out = out.replace(/(^|\s)#([a-zA-Z][\w-]*)/g, (_, sp, t) => `${sp}<span class="tag-ref" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`);
  return out;
}

let transcludeDepth = 0;

// Extract a heading section from markdown source (used by transclusion).
function extractSection(md, sectionName) {
  const lines = md.split('\n');
  const out = [];
  let inSection = false;
  let level = 0;
  const target = sectionName.toLowerCase();
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const lvl = m[1].length;
      const title = m[2].trim().toLowerCase();
      if (!inSection) {
        if (title === target) { inSection = true; level = lvl; }
      } else if (lvl <= level) {
        break;
      } else {
        out.push(line);
      }
    } else if (inSection) {
      out.push(line);
    }
  }
  return out.join('\n');
}

// Render markdown as block-level HTML (used for transclusion); no .pv-line wrapping.
function renderBlocksInline(md) {
  const lines = md.split('\n');
  const ctx = { inFence: false };
  const out = [];
  let codeBuf = [];
  function flushCode() {
    if (codeBuf.length) {
      out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
      codeBuf = [];
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = classifyLine(line, ctx);
    if (info.type === 'fence') {
      flushCode();
      if (info.opens) ctx.inFence = true; else ctx.inFence = false;
      continue;
    }
    if (info.type === 'code') { codeBuf.push(line); continue; }
    flushCode();
    if (info.type === 'blank') { out.push(''); continue; }
    if (/^h[1-6]$/.test(info.type)) {
      const lvl = parseInt(info.type[1], 10);
      const txt = line.replace(/^#{1,6}\s+/, '');
      out.push(`<h${Math.min(6, lvl + 1)}>${renderInline(txt)}</h${Math.min(6, lvl + 1)}>`);
      continue;
    }
    if (info.type === 'hr') { out.push('<hr/>'); continue; }
    if (info.type === 'quote') {
      const txt = line.replace(/^\s*>\s?/, '');
      out.push(`<blockquote>${renderInline(txt)}</blockquote>`);
      continue;
    }
    if (info.type === 'ul' || info.type === 'task') {
      const m = /^(\s*)([-*+])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
      const checked = m && m[3] && m[3].toLowerCase() === 'x';
      const checkbox = m && m[3] != null ? `<input type="checkbox" disabled ${checked ? 'checked' : ''}/> ` : '';
      out.push(`<div style="padding-left:${(m[1].length * 0.6) + 1.5}em;text-indent:-1.2em">• ${checkbox}${renderInline(m[4])}</div>`);
      continue;
    }
    if (info.type === 'ol') {
      const m = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
      out.push(`<div style="padding-left:${(m[1].length * 0.6) + 1.8}em;text-indent:-1.5em">${m[2]}. ${renderInline(m[3])}</div>`);
      continue;
    }
    if (info.type === 'image') { out.push(renderInline(line)); continue; }
    out.push(`<p style="margin:0.2em 0">${renderInline(line)}</p>`);
  }
  flushCode();
  return out.join('');
}

/* ----------------------------------------------------------------
   Admonition pre-pass — recognises GitHub-style callouts:
     > [!NOTE]    > [!WARNING]    > [!INFO]    > [!TIP]
     > [!IMPORTANT]    > [!CAUTION]    > [!FOLD] (collapsible)
   Each admonition spans the title line + all consecutive `>` lines
   below it. Returns a per-line { type, role, title? } | null array.
---------------------------------------------------------------- */
const ADMONITION_TYPES = new Set(['note', 'warning', 'info', 'tip', 'important', 'caution', 'fold', 'quote']);
function preprocessAdmonitions(lines) {
  const out = new Array(lines.length).fill(null);
  const ctx = { inFence: false };
  let active = null;
  for (let i = 0; i < lines.length; i++) {
    const info = classifyLine(lines[i], ctx);
    if (info.type === 'fence') {
      if (info.opens) ctx.inFence = true; else ctx.inFence = false;
      active = null; continue;
    }
    if (info.type !== 'quote') { active = null; continue; }
    const m = /^\s*>\s*\[!(\w+)\]\s*(.*)$/.exec(lines[i]);
    if (m && ADMONITION_TYPES.has(m[1].toLowerCase())) {
      active = m[1].toLowerCase();
      out[i] = { type: active, role: 'title', title: m[2].trim() };
    } else if (active) {
      out[i] = { type: active, role: 'body' };
    }
  }
  return out;
}

// Collect footnote definitions [^id]: text — they can appear anywhere
// and are rendered as a footnotes section at the bottom of the preview.
function collectFootnotes(md) {
  const defs = new Map();
  for (const line of md.split('\n')) {
    const m = /^\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);
    if (m) defs.set(m[1], m[2]);
  }
  return defs;
}

// Render preview as one .pv-line per source line
function renderPreview(md) {
  const lines = md.split('\n');
  const ctx = { inFence: false, fenceLang: '' };
  const adm = preprocessAdmonitions(lines);
  const footnotes = collectFootnotes(md);
  const pieces = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = classifyLine(line, ctx);
    let inner = '';
    let dataType = info.type;
    let extraClass = '';

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
      const slug = headingSlug(txt);
      inner = `<h${lvl} id="h-${slug}">${renderInline(txt)}</h${lvl}>`;
    } else if (info.type === 'quote') {
      // Footnote definition? render as small grey footnote entry
      let fnMatch = /^\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);
      const a = adm[i];
      if (a) {
        extraClass = `pv-adm pv-adm-${a.type} pv-adm-${a.role}`;
        if (a.role === 'title') {
          const titleText = a.title || a.type.toUpperCase();
          inner = `<div class="pv-adm-title-row"><span class="pv-adm-icon">${admIcon(a.type)}</span><span class="pv-adm-title-text">${renderInline(titleText)}</span></div>`;
        } else {
          const txt = line.replace(/^\s*>\s?/, '');
          inner = `<div>${renderInline(txt)}</div>`;
        }
      } else if (fnMatch) {
        extraClass = 'pv-fn-def';
        inner = `<div id="fn-${fnMatch[1]}"><strong>[${fnMatch[1]}]</strong> ${renderInline(fnMatch[2])}</div>`;
      } else {
        const txt = line.replace(/^\s*>\s?/, '');
        inner = `<blockquote>${renderInline(txt)}</blockquote>`;
      }
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
      inner = `<pre style="margin:0;font-size:0.9em;color:var(--text-dim)"><code>${escapeHtml(line)}</code></pre>`;
    } else {
      // p line — but also detect footnote definitions in case user
      // didn't prefix with `>`
      const fn = /^\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);
      if (fn) {
        extraClass = 'pv-fn-def';
        inner = `<div id="fn-${fn[1]}"><strong>[${fn[1]}]</strong> ${renderInline(fn[2])}</div>`;
      } else {
        inner = renderInline(line) || '&nbsp;';
      }
    }
    pieces.push(`<div class="pv-line ${extraClass}" data-line="${i}" data-type="${dataType}">${inner}</div>`);
  }
  return pieces.join('');
}

function admIcon(type) {
  const icons = {
    note: 'info', info: 'info', tip: 'check', warning: 'star', important: 'star',
    caution: 'x', fold: 'eye', quote: 'quote',
  };
  return lucide(icons[type] || 'info', 14);
}

const _slugCounts = new Map();
function headingSlug(text) {
  const base = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'h';
  return base;
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
