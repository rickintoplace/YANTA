import DOMPurify from 'dompurify';

import {
  escapeHtml,
  escapeAttr,
  lucide,
  safeCssColor,
} from '../core.js';

function sanitize(html) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    ADD_TAGS: ['img', 'svg', 'path', 'line', 'polyline', 'polygon', 'circle', 'rect', 'ellipse'],
    ADD_ATTR: [
      'class', 'href', 'src', 'alt', 'title', 'loading', 'draggable',
      'target', 'rel', 'style',
      'xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke',
      'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'points',
      'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|data:image\/|#|\/|\.)/i,
  });
}

function inlineMarkdown(text, ctx) {
  let out = escapeHtml(text || '');

  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  out = out.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_m, target, alias) => {
    const label = alias || target;
    return `<span class="yps-wiki-missing">${escapeHtml(label)}</span>`;
  });

  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => {
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  out = out.replace(/:lucide\[([a-zA-Z0-9-_ ]+)\](?:\{([^}\n:]+)\})?:/g, (_m, icon, color) => {
    const c = safeCssColor(color || '');
    return `<span class="yps-inline-icon" style="${c ? `color:${escapeAttr(c)}` : ''}">${lucide(icon.trim() || 'square', 16)}</span>`;
  });

  return out;
}

function renderImageLine(line, ctx) {
  const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(?:\{[^}\n]*\})?\s*$/.exec(line);

  if (!m) return null;

  const alt = m[1] || '';
  const url = m[2] || '';

  if (url.startsWith('yanta-img://')) {
    const id = url.slice('yanta-img://'.length);
    const src = ctx.resolveImageUrl?.(id) || '';

    if (!src) {
      return `<div class="yps-missing">Image unavailable: ${escapeHtml(id)}</div>`;
    }

    return `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy" draggable="false"></figure>`;
  }

  if (/^https?:\/\//i.test(url)) {
    return `<figure><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" draggable="false"></figure>`;
  }

  return `<div class="yps-missing">Blocked image URL</div>`;
}

export function renderPublicShareMarkdown(markdown, ctx = {}) {
  const lines = String(markdown || '').split('\n');
  const out = [];

  let inFence = false;
  let code = [];

  const flushCode = () => {
    if (!code.length) return;

    out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    code = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inFence) {
        flushCode();
        inFence = false;
      } else {
        inFence = true;
      }

      continue;
    }

    if (inFence) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      out.push('');
      continue;
    }

    const img = renderImageLine(line, ctx);

    if (img) {
      out.push(img);
      continue;
    }

    const draw = /^\s*draw:\/\/([a-z0-9_-]+)\s*$/i.exec(line);

    if (draw) {
      const drawing = ctx.drawingsById?.get(draw[1]);

      if (drawing) {
        out.push(`
          <section class="yps-drawing">
            <div class="yps-drawing-head">
              ${lucide('line-squiggle', 15)}
              <strong>${escapeHtml(drawing.title || 'Drawing')}</strong>
            </div>
            <pre>${escapeHtml(JSON.stringify(drawing.elements || [], null, 2)).slice(0, 4000)}</pre>
          </section>
        `);
      } else {
        out.push(`<div class="yps-missing">Drawing unavailable: ${escapeHtml(draw[1])}</div>`);
      }

      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);

    if (h) {
      const lvl = Math.min(6, h[1].length);
      out.push(`<h${lvl}>${inlineMarkdown(h[2], ctx)}</h${lvl}>`);
      continue;
    }

    const task = /^\s*[-*+]\s+$$([ xX])$$\s+(.*)$/.exec(line);

    if (task) {
      const checked = task[1].toLowerCase() === 'x';

      out.push(`
        <div class="yps-task ${checked ? 'checked' : ''}">
          <input type="checkbox" disabled ${checked ? 'checked' : ''}>
          <span>${inlineMarkdown(task[2], ctx)}</span>
        </div>
      `);

      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);

    if (ul) {
      out.push(`<div class="yps-list">• ${inlineMarkdown(ul[1], ctx)}</div>`);
      continue;
    }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);

    if (ol) {
      out.push(`<div class="yps-list">1. ${inlineMarkdown(ol[1], ctx)}</div>`);
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);

    if (quote) {
      out.push(`<blockquote>${inlineMarkdown(quote[1], ctx)}</blockquote>`);
      continue;
    }

    out.push(`<p>${inlineMarkdown(line, ctx)}</p>`);
  }

  flushCode();

  return sanitize(out.join('\n'));
}