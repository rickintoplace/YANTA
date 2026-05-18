// ============================================================
// YANTA — Markdown preview renderer.
// Renders one .pv-line per source line so y-positions match the editor.
// Supports headings, lists, tasks, tables, quotes, admonitions,
// wikilinks, transclusion, footnotes, math placeholders, DOI links,
// YouTube/Vimeo embeds, image refs (yanta-img:// and external).
// ============================================================

import { state, store, escapeHtml, decodeEntities, lucide } from './core.js';
import { wikilinkIndex } from './features-state.js';
import { noteMarkdown } from './yjs.js';

let transcludeDepth = 0;
let rerenderHook = null;
export function setMarkdownRerenderHook(fn) { rerenderHook = fn; }

export function classifyLine(line, ctx) {
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
  if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) return { type: 'image' };
  return { type: 'p' };
}

function videoEmbedUrl(url) {
  let m;
  if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(url))) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  if ((m = /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/.exec(url))) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  if ((m = /vimeo\.com\/(\d+)/.exec(url))) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

function resolveImageUrl(url) {
  if (url.startsWith('yanta-img://')) {
    const id = url.slice('yanta-img://'.length);
    if (state.imageBlobs.has(id)) return state.imageBlobs.get(id);
    if (!state.imagesMeta.has(id)) return null;
    store.images.get(id).then((rec) => {
      if (rec && rec.blob) {
        const u = URL.createObjectURL(rec.blob);
        state.imageBlobs.set(id, u);
        rerenderHook?.();
      }
    });
    return '';
  }
  return url;
}

function extractSection(md, sectionName) {
  const lines = md.split('\n');
  const out = [];
  let inSection = false, level = 0;
  const target = sectionName.toLowerCase();
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const lvl = m[1].length;
      const title = m[2].trim().toLowerCase();
      if (!inSection) { if (title === target) { inSection = true; level = lvl; } }
      else if (lvl <= level) break;
      else out.push(line);
    } else if (inSection) out.push(line);
  }
  return out.join('\n');
}

export function renderInline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/!\[\[([^\]\n#|]+)(?:#([^\]\n|]+))?(?:\|([^\]\n]+))?\]\]/g, (_, title, section, alias) => {
    const decoded = decodeEntities(title.trim());
    const nid = wikilinkIndex.get(decoded.toLowerCase());
    if (!nid) return `<div class="pv-trans pv-trans-missing">↳ <strong>${title}</strong> · not found</div>`;
    if (transcludeDepth >= 3) return `<div class="pv-trans pv-trans-loop">↳ ${title} · transclusion too deep</div>`;
    const note = state.notes.get(nid);
    if (!note) return '';
    let body = '';
    try { body = noteMarkdown(nid); } catch { body = ''; }
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
  out = out.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, target, alias) => {
    const decoded = decodeEntities(target.trim());
    const key = decoded.toLowerCase();
    const noteId = wikilinkIndex.get(key);
    const text = (alias || target).trim();
    const cls = noteId ? 'wiki-link' : 'wiki-link missing';
    const id = noteId ? ` data-note-id="${noteId}"` : '';
    return `<a class="${cls}" data-wiki="${target.trim()}"${id}>${text}</a>`;
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
    const embed = videoEmbedUrl(decodeEntities(url));
    if (embed) return `<div class="pv-embed-video" contenteditable="false"><iframe src="${embed}" allowfullscreen frameborder="0" allow="autoplay; encrypted-media; picture-in-picture"></iframe></div>`;
    const resolved = resolveImageUrl(decodeEntities(url));
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    if (resolved === null) return `<span class="pv-img-missing">missing: ${escapeHtml(url.slice(0, 40))}…</span>`;
    return `<span class="pv-img-wrap" contenteditable="false"><img src="${resolved}" alt="${escapeHtml(alt)}"${t} loading="lazy" draggable="false" /></span>`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`);
  out = out.replace(/\bdoi:(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/gi, (_, d) => `<a href="https://doi.org/${d}" target="_blank" rel="noopener" class="pv-doi">doi:${d}</a>`);
  out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  out = out.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  out = out.replace(/\[\^([^\]\s]+)\]/g, (_, id) => `<sup class="fn-ref"><a href="#fn-${id}" data-fn="${id}">${id}</a></sup>`);
  out = out.replace(/\$\$([^$\n]+)\$\$/g, (_, expr) => `<span class="pv-math pv-math-block">${expr}</span>`);
  out = out.replace(/(?<!\\)\$([^$\n]+)\$/g, (_, expr) => `<span class="pv-math">${expr}</span>`);
  out = out.replace(/(^|\s)#([a-zA-Z][\w-]*)/g, (_, sp, t) => `${sp}<span class="tag-ref" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`);
  return out;
}

export function renderBlocksInline(md) {
  const lines = md.split('\n');
  const ctx = { inFence: false };
  const out = [];
  let codeBuf = [];
  const flush = () => { if (codeBuf.length) { out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`); codeBuf = []; } };
  for (const line of lines) {
    const info = classifyLine(line, ctx);
    if (info.type === 'fence') { flush(); ctx.inFence = !!info.opens; continue; }
    if (info.type === 'code') { codeBuf.push(line); continue; }
    flush();
    if (info.type === 'blank') { out.push(''); continue; }
    if (/^h[1-6]$/.test(info.type)) {
      const lvl = parseInt(info.type[1], 10);
      const txt = line.replace(/^#{1,6}\s+/, '');
      out.push(`<h${Math.min(6, lvl + 1)}>${renderInline(txt)}</h${Math.min(6, lvl + 1)}>`);
      continue;
    }
    if (info.type === 'hr') { out.push('<hr/>'); continue; }
    if (info.type === 'quote') { out.push(`<blockquote>${renderInline(line.replace(/^\s*>\s?/, ''))}</blockquote>`); continue; }
    if (info.type === 'ul' || info.type === 'task') {
      const m = /^(\s*)([-*+])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
      const checked = m && m[3] && m[3].toLowerCase() === 'x';
      const cb = m && m[3] != null ? `<input type="checkbox" disabled ${checked ? 'checked' : ''}/> ` : '';
      out.push(`<div style="padding-left:${(m[1].length * 0.6) + 1.5}em;text-indent:-1.2em">• ${cb}${renderInline(m[4])}</div>`);
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
  flush();
  return out.join('');
}

const ADMONITION_TYPES = new Set(['note', 'warning', 'info', 'tip', 'important', 'caution', 'fold', 'quote']);
function preprocessAdmonitions(lines) {
  const out = new Array(lines.length).fill(null);
  const ctx = { inFence: false };
  let active = null;
  for (let i = 0; i < lines.length; i++) {
    const info = classifyLine(lines[i], ctx);
    if (info.type === 'fence') { ctx.inFence = !!info.opens; active = null; continue; }
    if (info.type !== 'quote') { active = null; continue; }
    const m = /^\s*>\s*\[!(\w+)\]\s*(.*)$/.exec(lines[i]);
    if (m && ADMONITION_TYPES.has(m[1].toLowerCase())) {
      active = m[1].toLowerCase();
      out[i] = { type: active, role: 'title', title: m[2].trim() };
    } else if (active) out[i] = { type: active, role: 'body' };
  }
  return out;
}

export function headingSlug(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'h';
}

function admIcon(type) {
  const map = { note: 'info', info: 'info', tip: 'check', warning: 'star', important: 'star', caution: 'x', fold: 'eye', quote: 'quote' };
  return lucide(map[type] || 'info', 14);
}

export function renderPreview(md) {
  const lines = md.split('\n');
  const ctx = { inFence: false, fenceLang: '' };
  const adm = preprocessAdmonitions(lines);
  const pieces = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = classifyLine(line, ctx);
    let inner = '', extraClass = '';
    if (info.type === 'fence') {
      ctx.inFence = !!info.opens;
      ctx.fenceLang = info.opens ? info.lang : '';
      inner = `<span style="font-family:var(--font-mono);font-size:0.9em;color:var(--text-faint)">\`\`\`${escapeHtml(info.lang || '')}</span>`;
    } else if (info.type === 'code') {
      inner = `<span style="font-family:var(--font-mono);font-size:0.9em">${escapeHtml(line) || '&nbsp;'}</span>`;
    } else if (info.type === 'blank') { inner = '&nbsp;'; }
    else if (info.type === 'hr') { inner = '<hr/>'; }
    else if (/^h[1-6]$/.test(info.type)) {
      const lvl = parseInt(info.type[1], 10);
      const txt = line.replace(/^#{1,6}\s+/, '');
      inner = `<h${lvl} id="h-${headingSlug(txt)}">${renderInline(txt)}</h${lvl}>`;
    } else if (info.type === 'quote') {
      const fn = /^\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);
      const a = adm[i];
      if (a) {
        extraClass = `pv-adm pv-adm-${a.type} pv-adm-${a.role}`;
        if (a.role === 'title') {
          const titleText = a.title || a.type.toUpperCase();
          inner = `<div class="pv-adm-title-row"><span class="pv-adm-icon">${admIcon(a.type)}</span><span class="pv-adm-title-text">${renderInline(titleText)}</span></div>`;
        } else inner = `<div>${renderInline(line.replace(/^\s*>\s?/, ''))}</div>`;
      } else if (fn) {
        extraClass = 'pv-fn-def';
        inner = `<div id="fn-${fn[1]}"><strong>[${fn[1]}]</strong> ${renderInline(fn[2])}</div>`;
      } else inner = `<blockquote>${renderInline(line.replace(/^\s*>\s?/, ''))}</blockquote>`;
    } else if (info.type === 'task') {
      const m = /^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/.exec(line);
      const checked = m[3].toLowerCase() === 'x';
      inner = `<div class="task" data-line="${i}" style="padding-left:${(m[1].length * 0.6) + 1.5}em">
        <input type="checkbox" data-line="${i}" contenteditable="false" ${checked ? 'checked' : ''}/>
        <span class="task-label"${checked ? ' style="text-decoration:line-through;color:var(--text-dim)"' : ''}>${renderInline(m[4])}</span>
      </div>`;
    } else if (info.type === 'ul') {
      const m = /^(\s*)([-*+])\s+(.*)$/.exec(line);
      inner = `<div style="padding-left:${(m[1].length * 0.6) + 1.5}em;text-indent:-1.2em">• ${renderInline(m[3])}</div>`;
    } else if (info.type === 'ol') {
      const m = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
      inner = `<div style="padding-left:${(m[1].length * 0.6) + 1.8}em;text-indent:-1.5em">${m[2]}. ${renderInline(m[3])}</div>`;
    } else if (info.type === 'image') { inner = renderInline(line); }
    else if (info.type === 'table') { inner = `<pre style="margin:0;font-size:0.9em;color:var(--text-dim)"><code>${escapeHtml(line)}</code></pre>`; }
    else {
      const fn = /^\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);
      if (fn) { extraClass = 'pv-fn-def'; inner = `<div id="fn-${fn[1]}"><strong>[${fn[1]}]</strong> ${renderInline(fn[2])}</div>`; }
      else inner = renderInline(line) || '&nbsp;';
    }
    pieces.push(`<div class="pv-line ${extraClass}" data-line="${i}" data-type="${info.type}">${inner}</div>`);
  }
  return pieces.join('');
}
