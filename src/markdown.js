// ============================================================
// YANTA — Markdown preview renderer.
// Renders one .pv-line per source line so y-positions match the editor.
// Supports headings, lists, tasks, tables, quotes, admonitions,
// wikilinks, transclusion, footnotes, math placeholders, DOI links,
// YouTube/Vimeo embeds, image refs (yanta-img:// and external).
// ============================================================

import DOMPurify from 'dompurify';
import { state, store, escapeHtml, escapeAttr, decodeEntities, safeUrl, lucide, safeCssColor } from './core.js';
import { wikilinkIndex } from './features-state.js';
import { noteMarkdown } from './yjs.js';

function hydrateLucideHost(host, name, size = 16) {
  host.replaceChildren();

  const tpl = document.createElement('template');
  tpl.innerHTML = lucide(name || 'square', size);

  const svg = tpl.content.firstElementChild;

  if (svg) {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    host.append(svg);
  }
}

function sanitizeHtml(html) {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: {
      html: true,
      svg: true,
      svgFilters: false,
    },

    ADD_TAGS: [
      'iframe',
      'input',

      // SVG bleibt erlaubt, aber Icons hydraten wir unten nochmal robust.
      'svg',
      'path',
      'line',
      'polyline',
      'polygon',
      'circle',
      'rect',
      'ellipse',
    ],

    ADD_ATTR: [
      // Allgemein
      'class',
      'id',
      'style',
      'title',
      'target',
      'rel',
      'contenteditable',
      'aria-hidden',
      'role',
      'data-draw-id',
      'data-draw-title',
      'data-draw-info',
      'data-draw-action',
     'data-draw-surface',

      // YANTA data attrs
      'data-wiki',
      'data-note-id',
      'data-tag',
      'data-line',
      'data-type',
      'data-fn',
      'data-adm-icon',

      // Inline Lucide placeholders
      'data-lucide-icon',
      'data-lucide-color',
      'data-lucide-size',

      // Checkboxen
      'type',
      'checked',
      'disabled',

      // Images / embeds
      'src',
      'href',
      'alt',
      'loading',
      'draggable',
      'allow',
      'allowfullscreen',
      'frameborder',

      // SVG/Lucide
      'xmlns',
      'viewBox',
      'viewbox',
      'width',
      'height',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'stroke-dasharray',
      'stroke-dashoffset',
      'd',
      'points',
      'x',
      'y',
      'x1',
      'x2',
      'y1',
      'y2',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
    ],

    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|data:image\/|#|\/|\.)/i,
  });

  const tmp = document.createElement('template');
  tmp.innerHTML = clean;

  // Defensive repair: falls DOMPurify/Browser type entfernt oder verändert.
  for (const input of tmp.content.querySelectorAll('.task input[data-line], input[type="checkbox"]')) {
    input.setAttribute('type', 'checkbox');
  }

  // Robust: Admonition-Icons nach DOMPurify aus vertrauenswürdigem Code hydraten.
  // Dadurch müssen die Lucide-SVGs nicht als Markdown-HTML durch den Sanitizer.
  const allowedAdmIcons = new Set([
    'info',
    'check',
    'star',
    'x',
    'eye',
    'quote',
  ]);

  for (const host of tmp.content.querySelectorAll('.pv-adm-icon[data-adm-icon]')) {
    const name = host.getAttribute('data-adm-icon') || 'info';

    if (!allowedAdmIcons.has(name)) {
      host.removeAttribute('data-adm-icon');
      continue;
    }

    hydrateLucideHost(host, name, 14);
    host.removeAttribute('data-adm-icon');
  }

  // Robust: Inline-Lucide-Icons nach DOMPurify hydrieren.
  // Wichtig: Die SVG-Attribute wie d/cx/cy/r/viewBox laufen dadurch NICHT
  // durch DOMPurify und werden deshalb nicht entfernt.
  for (const host of tmp.content.querySelectorAll('.pv-inline-icon[data-lucide-icon]')) {
    const name = host.getAttribute('data-lucide-icon') || 'square';
    const color = host.getAttribute('data-lucide-color') || '';
    const sizeRaw = parseInt(host.getAttribute('data-lucide-size') || '16', 10);
    const size = Number.isFinite(sizeRaw) ? sizeRaw : 16;

    const safeColor = safeCssColor(color);

    if (safeColor) {
      host.style.color = safeColor;
    } else {
      host.style.removeProperty('color');
    }

    hydrateLucideHost(host, name, size);

    host.removeAttribute('data-lucide-icon');
    host.removeAttribute('data-lucide-color');
    host.removeAttribute('data-lucide-size');
  }

  return tmp.innerHTML;
}

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
  if (/^\s*<!--[\s\S]*?-->\s*$/.test(line)) return { type: 'comment' };
  let m;
  if ((m = /^(#{1,6})\s/.exec(line))) return { type: 'h' + m[1].length };
  if (/^\s*>\s?/.test(line)) return { type: 'quote' };
  if (/^\s*[-*_]{3,}\s*$/.test(line)) return { type: 'hr' };
  if ((m = /^(\s*)([-*+])\s+\[([ xX])\]\s/.exec(line))) return { type: 'task', checked: m[3].toLowerCase() === 'x', indent: m[1].length };
  if ((m = /^(\s*)([-*+])\s+/.exec(line))) return { type: 'ul', indent: m[1].length };
  if ((m = /^(\s*)(\d+)\.\s+/.exec(line))) return { type: 'ol', indent: m[1].length, num: parseInt(m[2], 10) };
  if (/^\|.*\|\s*$/.test(line)) return { type: 'table' };
  if (/^\s*draw:\/\/[a-z0-9_-]+\s*$/i.test(line)) return { type: 'draw' };
  if (/^!\[[^\]]*\]\([^)]+\)(?:\{[^}\n]*\})?\s*$/.test(line)) return { type: 'image' };
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

function parseImageSizeAttrs(raw = '') {
  const out = {};

  const re = /(?:^|\s)(width|w|height|h)\s*=\s*["']?(\d{1,4})(?:px)?["']?/gi;
  let m;

  while ((m = re.exec(raw || '')) !== null) {
    const key = m[1].toLowerCase();
    const val = parseInt(m[2], 10);

    if (!Number.isFinite(val)) continue;

    if (key === 'width' || key === 'w') {
      out.width = Math.max(80, Math.min(2400, val));
    }

    if (key === 'height' || key === 'h') {
      out.height = Math.max(50, Math.min(5000, val));
    }
  }

  return out;
}

function imageSizeHtml(rawAttrs = '') {
  const attrs = parseImageSizeAttrs(rawAttrs);
  const parts = [];

  if (attrs.width) {
    parts.push(`width:${attrs.width}px`);
    parts.push('max-width:100%');
  }

  if (attrs.height) {
    parts.push(`height:${attrs.height}px`);
    parts.push('object-fit:contain');
  } else if (attrs.width) {
    parts.push('height:auto');
  }

  if (!parts.length) {
    return {
      wrapClass: '',
      styleAttr: '',
    };
  }

  return {
    wrapClass: ' is-sized',
    styleAttr: ` style="${escapeAttr(parts.join(';'))}"`,
  };
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

export function renderDrawEmbedHtml(id, label = 'Drawing', surface = 'preview') {
  const cleanId = String(id || '').trim();
  const cleanSurface = surface === 'editor' ? 'editor' : 'preview';

  return `<div class="yanta-draw-embed ${cleanSurface}-surface" data-draw-surface="${escapeAttr(cleanSurface)}" data-draw-id="${escapeAttr(cleanId)}" data-note-id="${escapeAttr(state.currentNoteId || '')}" contenteditable="false">
    <div class="yanta-draw-embed-head">
      <span class="yanta-draw-embed-icon" aria-hidden="true">${previewLucide('line-squiggle', 13)}</span>
      <div class="yanta-draw-embed-title" data-draw-title title="Rename drawing">${escapeHtml(label || 'Drawing')}</div>
      <div class="yanta-draw-embed-meta" data-draw-info>draw://${escapeHtml(cleanId)}</div>

      <button type="button" class="btn yanta-draw-mobile-done" data-draw-action="mobile-done" title="Leave drawing mode">
        ${previewLucide('check', 14)} Done
      </button>

      <div class="yanta-draw-embed-actions">
        <button type="button" class="icon-btn" data-draw-action="export" title="Export .excalidraw">${previewLucide('download', 14)}</button>
        <button type="button" class="icon-btn" data-draw-action="link-note" title="Link selected element to note">${previewLucide('file-plus', 14)}</button>
        <button type="button" class="icon-btn" data-draw-action="toggle-width" title="Expand drawing width">${previewLucide('unfold-horizontal', 14)}</button>
        <button type="button" class="icon-btn" data-draw-action="fullscreen" title="Open fullscreen">${previewLucide('expand', 14)}</button>
        <div style="
            border-right: 1px solid var(--text-dim);
            width: 2px;
            margin-right: 2px;
            max-height: 22px;
        ">
        </div>
        <button type="button" class="icon-btn danger" data-draw-action="delete" title="Delete drawing">${previewLucide('trash', 14)}</button>
      </div>
    </div>
    <div class="yanta-draw-inline-host"></div>
    <div class="yanta-draw-resize-handle" title="Resize drawing"></div>
    <div class="yanta-draw-links"></div>
  </div>`;
}

function resolveWikilinkNoteId(target) {
  const decoded = decodeEntities(String(target || '').trim());
  const key = decoded.toLowerCase();

  let noteId = wikilinkIndex.get(key);
  if (noteId && state.notes.has(noteId)) return noteId;

  // Fallback: robust gegen Entity-/Index-Timing-Probleme.
  const hit = [...state.notes.values()].find((n) =>
    (n.title || '').trim().toLowerCase() === key
  );

  return hit?.id || null;
}

function previewLucide(name, size = 14) {
  return `<span class="pv-inline-icon"
    data-lucide-icon="${escapeAttr(name)}"
    data-lucide-size="${escapeAttr(size)}"
    contenteditable="false"
    aria-hidden="true">${lucide(name, size)}</span>`;
}

export function renderInline(s) {
  let out = escapeHtml(s);

  // Wichtig:
  // HTML-Fragmente werden als Platzhalter geparkt, damit spätere Markdown-
  // Regeln wie _italic_ nicht in data-note-id / data-draw-id / href etc.
  // hineinlaufen und das erzeugte HTML beschädigen.
  const placeholders = [];

  const stash = (html) => {
    const token = `\uE000YANTA${placeholders.length}\uE001`;
    placeholders.push({ token, html });
    return token;
  };

  const restore = () => {
    for (const { token, html } of placeholders) {
      out = out.split(token).join(html);
    }
  };

  // Excalidraw embeds:
  //   draw://abc123
  //   ![](draw://abc123)
  out = out.replace(
    /!\[([^\]]*)\]\(draw:\/\/([a-z0-9_-]+)\)/gi,
    (_, alt, id) => stash(renderDrawEmbedHtml(id, decodeEntities(alt || 'Drawing')))
  );

  out = out.replace(
    /(^|[\s>])draw:\/\/([a-z0-9_-]+)/gi,
    (_, prefix, id) => `${prefix}${stash(renderDrawEmbedHtml(id, 'Drawing'))}`
  );

  // Inline Lucide icon syntax:
  // :lucide[atom]:
  // :lucide[atom]{#6ea8fe}:
  out = out.replace(
    /:lucide\[([a-zA-Z0-9-_ ]+)\](?:\{([^}\n:]+)\})?:/g,
    (_, iconName, color) => {
      const cleanName = iconName.trim();
      const cleanColor = safeCssColor(color);

      const colorAttr = cleanColor
        ? ` data-lucide-color="${escapeAttr(cleanColor)}" style="color:${escapeAttr(cleanColor)}"`
        : '';

      return stash(
        `<span class="pv-inline-icon" data-lucide-icon="${escapeAttr(cleanName)}"${colorAttr} contenteditable="false" aria-hidden="true"></span>`
      );
    }
  );

  // Inline code first.
  out = out.replace(/`([^`\n]+)`/g, (_, c) => stash(`<code>${c}</code>`));

  // Transclusion: ![[Note#Section|Alias]]
  out = out.replace(/!\[\[([^\]\n#|]+)(?:#([^\]\n|]+))?(?:\|([^\]\n]+))?\]\]/g, (_, title, section, alias) => {
    const decodedTitle = decodeEntities(title.trim());
    const nid = resolveWikilinkNoteId(decodedTitle);

    if (!nid) {
      return stash(`<div class="pv-trans pv-trans-missing">↳ <strong>${escapeHtml(decodedTitle)}</strong> · not found</div>`);
    }

    if (transcludeDepth >= 3) {
      return stash(`<div class="pv-trans pv-trans-loop">↳ ${escapeHtml(decodedTitle)} · transclusion too deep</div>`);
    }

    const note = state.notes.get(nid);
    if (!note) return '';

    let body = '';
    try {
      body = noteMarkdown(nid);
    } catch {
      body = '';
    }

    const decodedSection = section ? decodeEntities(section.trim()) : '';
    if (decodedSection) body = extractSection(body, decodedSection);

    transcludeDepth++;
    const rendered = renderBlocksInline(body);
    transcludeDepth--;

    const label = alias
      ? decodeEntities(alias.trim())
      : decodedTitle + (decodedSection ? ' › ' + decodedSection : '');

    return stash(`<div class="pv-trans" contenteditable="false">
      <div class="pv-trans-head">↳ <a class="wiki-link" data-wiki="${escapeAttr(decodedTitle)}" data-note-id="${escapeAttr(nid)}">${escapeHtml(label)}</a></div>
      <div class="pv-trans-body">${rendered}</div>
    </div>`);
  });

  // Wikilinks: [[Target|Alias]]
  out = out.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, target, alias) => {
    const decodedTarget = decodeEntities(target.trim());
    const noteId = resolveWikilinkNoteId(decodedTarget);
    const text = decodeEntities((alias || target).trim());

    const cls = noteId ? 'wiki-link' : 'wiki-link missing';
    const idAttr = noteId ? ` data-note-id="${escapeAttr(noteId)}"` : '';

    return stash(`<a class="${cls}" data-wiki="${escapeAttr(decodedTarget)}"${idAttr}>${escapeHtml(text)}</a>`);
  });

  // Images + video embeds through image syntax.
  // Supports optional size attrs:
  //
  //   ![alt](url){width=420}
  //   ![alt](url){width=420 height=260}
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(?:\{([^}\n]*)\})?/g, (_, alt, url, title, rawAttrs) => {
    const decodedUrl = decodeEntities(url);
    const embed = videoEmbedUrl(decodedUrl);

    if (embed) {
      const safeEmbed = safeUrl(embed);

      if (!safeEmbed) {
        return stash(`<span class="pv-img-missing">blocked video url</span>`);
      }

      return stash(`<div class="pv-embed-video" contenteditable="false">
        <iframe src="${escapeAttr(safeEmbed)}" allowfullscreen frameborder="0" allow="autoplay; encrypted-media; picture-in-picture"></iframe>
      </div>`);
    }

    const resolved = resolveImageUrl(decodedUrl);

    if (resolved === null) {
      return stash(`<span class="pv-img-missing">missing: ${escapeHtml(decodedUrl.slice(0, 40))}…</span>`);
    }

    const safeImg = safeUrl(resolved, { image: true });

    if (!safeImg) {
      return stash(`<span class="pv-img-missing">blocked image url</span>`);
    }

    const titleAttr = title
      ? ` title="${escapeAttr(decodeEntities(title))}"`
      : '';

    const size = imageSizeHtml(rawAttrs || '');

    return stash(`<span class="pv-img-wrap${size.wrapClass}"${size.styleAttr} contenteditable="false">
      <img src="${escapeAttr(safeImg)}" alt="${escapeAttr(decodeEntities(alt))}"${titleAttr} loading="lazy" draggable="false" />
    </span>`);
  });

  // Normal markdown links.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
    const decodedUrl = decodeEntities(url);
    const href = safeUrl(decodedUrl);

    if (!href) {
      return stash(`<span>${escapeHtml(decodeEntities(txt))}</span>`);
    }

    return stash(`<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
  });

  // DOI.
  out = out.replace(/\bdoi:(10\.\d{4,9}\/[^\s<>"']+)/gi, (_, rawDoi) => {
    const trailing = rawDoi.match(/[.,;:)]+$/)?.[0] || '';
    const d = trailing ? rawDoi.slice(0, -trailing.length) : rawDoi;

    const href = safeUrl(`https://doi.org/${d}`);

    return stash(
      href
        ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" class="pv-doi">doi:${escapeHtml(d)}</a>${escapeHtml(trailing)}`
        : `doi:${escapeHtml(rawDoi)}`
    );
  });

  // Footnotes.
  out = out.replace(/\[\^([^\]\s]+)\]/g, (_, id) =>
    stash(`<sup class="fn-ref"><a href="#fn-${escapeAttr(id)}" data-fn="${escapeAttr(id)}">${escapeHtml(id)}</a></sup>`)
  );

  // Math placeholders.
  out = out.replace(/\$\$([^$\n]+)\$\$/g, (_, expr) =>
    stash(`<span class="pv-math pv-math-block">${escapeHtml(decodeEntities(expr))}</span>`)
  );

  out = out.replace(/(?<!\\)\$([^$\n]+)\$/g, (_, expr) =>
    stash(`<span class="pv-math">${escapeHtml(decodeEntities(expr))}</span>`)
  );

  // Markdown inline styling.
  out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  out = out.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Tags after styling.
  out = out.replace(/(^|\s)#([a-zA-Z][\w-]*)/g, (_, sp, tag) =>
    `${sp}${stash(`<span class="tag-ref" data-tag="${escapeAttr(tag)}">#${escapeHtml(tag)}</span>`)}`
  );

  restore();

  return out;
}

export function renderBlocksInline(md) {
  const lines = String(md || '').split('\n');
  const ctx = { inFence: false };
  const out = [];
  let codeBuf = [];

  const flush = () => {
    if (!codeBuf.length) return;

    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
    codeBuf = [];
  };

  for (const line of lines) {
    const info = classifyLine(line, ctx);

    if (info.type === 'fence') {
      flush();
      ctx.inFence = !!info.opens;
      continue;
    }

    if (info.type === 'code') {
      codeBuf.push(line);
      continue;
    }

    flush();

    if (info.type === 'blank') {
      out.push('');
      continue;
    }

    if (info.type === 'comment') {
      continue;
    }

    if (/^h[1-6]$/.test(info.type)) {
      const lvl = parseInt(info.type[1], 10);
      const txt = line.replace(/^#{1,6}\s+/, '');
      const smallLvl = Math.min(6, lvl + 1);

      out.push(`<h${smallLvl}>${renderInline(txt)}</h${smallLvl}>`);
      continue;
    }

    if (info.type === 'hr') {
      out.push('<hr/>');
      continue;
    }

    if (info.type === 'quote') {
      out.push(`<blockquote>${renderInline(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
      continue;
    }

    // Tasks im Hover-Tooltip / Inline-Block sauber als Checkbox + Label rendern.
    // Vorher wurden Tasks im kompakten Renderer wie normale Bullet-Listen behandelt,
    // wodurch sie im Tooltip optisch kaputt bzw. uneinheitlich aussahen.
    if (info.type === 'task') {
      const m = /^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/.exec(line);

      if (!m) {
        out.push(`<p style="margin:0.2em 0">${renderInline(line)}</p>`);
        continue;
      }

      const indent = m[1].length;
      const checked = m[3].toLowerCase() === 'x';
      const label = m[4] || '';

      out.push(`
        <div class="task task-static"
          style="display:flex;align-items:flex-start;gap:8px;min-height:24px;padding-left:${(indent * 0.6) + 0.25}em;margin:2px 0">
          <input type="checkbox" disabled contenteditable="false" ${checked ? 'checked' : ''}
            style="width:16px;height:16px;min-width:16px;margin:3px 0 0 0;accent-color:var(--accent)" />
          <span class="task-label"
            style="flex:1;${checked ? 'text-decoration:line-through;color:var(--text-dim)' : ''}">
            ${renderInline(label)}
          </span>
        </div>
      `);

      continue;
    }

    if (info.type === 'ul') {
      const m = /^(\s*)([-*+])\s+(.*)$/.exec(line);

      if (!m) {
        out.push(`<p style="margin:0.2em 0">${renderInline(line)}</p>`);
        continue;
      }

      out.push(
        `<div style="padding-left:${(m[1].length * 0.6) + 1.5}em;text-indent:-1.2em">• ${renderInline(m[3])}</div>`
      );

      continue;
    }

    if (info.type === 'ol') {
      const m = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);

      if (!m) {
        out.push(`<p style="margin:0.2em 0">${renderInline(line)}</p>`);
        continue;
      }

      out.push(
        `<div style="padding-left:${(m[1].length * 0.6) + 1.8}em;text-indent:-1.5em">${m[2]}. ${renderInline(m[3])}</div>`
      );

      continue;
    }

    if (info.type === 'image') {
      out.push(renderInline(line));
      continue;
    }

    out.push(`<p style="margin:0.2em 0">${renderInline(line)}</p>`);
  }

  flush();

  return sanitizeHtml(out.join(''));
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
  const map = {
    note: 'info',
    info: 'info',
    tip: 'check',
    warning: 'circle-alert',
    important: 'circle-alert',
    caution: 'x',
    fold: 'eye',
    quote: 'quote',
  };

  const icon = map[type] || 'info';

  // Wichtig:
  // Nicht direkt SVG hier zurückgeben. DOMPurify kann inline SVG je nach
  // Build/Profil entfernen. Wir geben nur einen sicheren Placeholder zurück;
  // sanitizeHtml() setzt danach aus vertrauenswürdigem Code das Lucide-SVG ein.
  return `<span class="pv-adm-icon" data-adm-icon="${escapeAttr(icon)}" aria-hidden="true"></span>`;
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
    else if (info.type === 'comment') { inner = ''; extraClass = 'pv-hidden-line'; }
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

          inner = `<div class="pv-adm-title-row">
            ${admIcon(a.type)}
            <span class="pv-adm-title-text">${renderInline(titleText)}</span>
          </div>`;
        } else {
          inner = `<div>${renderInline(line.replace(/^\s*>\s?/, ''))}</div>`;
        }      
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
  return sanitizeHtml(pieces.join(''));
}
