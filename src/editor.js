// ============================================================
// YANTA — Editor: CodeMirror 6 + Yjs binding.
// Features: markdown highlighting, Yjs collab text, undo/redo,
// autocomplete (wikilinks / tags / slash commands), task checkbox
// widget, image preview widget, live cursors (when shared).
// ============================================================

import { EditorState, Compartment, RangeSetBuilder, StateField, StateEffect, Transaction } from '@codemirror/state';
import { EditorView, keymap, drawSelection, placeholder, ViewPlugin, Decoration, WidgetType, MatchDecorator } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { autocompletion, completionKeymap, acceptCompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { classifyLine, renderDrawEmbedHtml } from './markdown.js';
import { videoEmbedUrl, audioEmbedUrl } from './media/video-embeds.js';
import { getImageObjectUrl, putImageObjectUrl } from './media/object-url-cache.js';

import { $, state, safeCssColor, lucide } from './core.js';
import { t as i18n } from './i18n/index.js';
import { getNoteDoc, getMarkdownText } from './yjs.js';
import { wikilinkIndex } from './features-state.js';

let view = null;
let currentNoteId = null;
let currentYBinding = null;
let applyingYUpdate = false;

const themeCompartment = new Compartment();
const editableCompartment = new Compartment();

// ----- Custom highlight style (matches YANTA theme) ---------------------
const yantaHighlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', color: 'var(--text)' },
  { tag: t.heading2, fontWeight: '700', color: 'var(--text)' },
  { tag: t.heading3, fontWeight: '600', color: 'var(--text)' },
  { tag: t.heading4, fontWeight: '600', color: 'var(--text)' },
  { tag: t.heading5, fontWeight: '600' },
  { tag: t.heading6, fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--text-dim)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' },
  { tag: t.quote, color: 'var(--text-dim)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--text)' },
  { tag: t.processingInstruction, color: 'var(--text-faint)' },
  { tag: t.contentSeparator, color: 'var(--text-faint)' },
]);

// ----- Theme: minimal, inherits from YANTA CSS vars ---------------------
const yantaTheme = EditorView.theme({
  '&': {
    fontSize: 'var(--fs-base)',
    color: 'var(--text)',
    backgroundColor: 'transparent',
    height: '100%',
    width: '100%',
    minWidth: '0',
    minHeight: '0',
    maxWidth: '100%',
    overflow: 'hidden',
  },

  '.cm-scroller': {
    fontFamily: 'var(--font)',
    lineHeight: 'var(--lh-base)',
    height: '100%',
    minHeight: '0',
    padding: '28px clamp(14px, 5vw, 40px) calc(28px + 40vh)',
    overflowY: 'auto',
    overflowX: 'hidden',
    boxSizing: 'border-box',
    minWidth: '0',
    maxWidth: '100%',
  },

  '.cm-content': {
    width: 'min(760px, 100%)',
    maxWidth: '760px',
    minWidth: '0',

    margin: '0 auto',
    padding: '0',
    caretColor: 'var(--accent)',
    minHeight: '100%',

    boxSizing: 'border-box',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },

  '.cm-line': {
    padding: '0 2px',
    maxWidth: '100%',
    minWidth: '0',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },

  '.cm-line *': {
    maxWidth: '100%',
  },

  '&.cm-focused': {
    outline: 'none',
  },

  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },

  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important',
  },

  '& ::selection': {
    backgroundColor: 'var(--selection)',
    color: 'var(--selection-text)',
  },

  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },

  '.cm-gutters': {
    display: 'none',
  },

  '.cm-tooltip': {
    background: 'var(--bg-elev-3)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text)',
    boxShadow: 'var(--shadow)',
  },

  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: 'var(--accent)',
    color: 'white',
  },

  '.cm-tooltip-autocomplete ul li': {
    padding: '4px 8px',
  },

  '.yanta-task-checkbox': {
    display: 'inline-block',
    verticalAlign: 'middle',
    width: '14px',
    height: '14px',
    cursor: 'pointer',
  },

  '.yanta-wiki': {
    color: 'var(--accent)',
    textDecoration: 'none',
    background: 'rgba(110,168,254,0.10)',
    borderRadius: '3px',
    padding: '0 3px',
  },

  '.yanta-wiki-missing': {
    color: 'var(--text-dim)',
    textDecoration: 'underline dotted',
    background: 'rgba(138,147,164,0.08)',
    borderRadius: '3px',
    padding: '0 3px',
  },

  '.yanta-tag': {
    color: 'var(--accent-2)',
    background: 'rgba(167,139,250,0.10)',
    borderRadius: '4px',
    padding: '0 4px',
  },

  '.yanta-img-thumb': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '220px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    margin: '4px 0',
  },

  '.yanta-video-embed': {
    maxWidth: '100%',
  },

  '.yanta-draw-editor-embed': {
    width: '100%',
    maxWidth: '100%',
    minWidth: '0',
    overflow: 'hidden',
  },

  '.yanta-draw-embed': {
    maxWidth: '100%',
    minWidth: '0',
  },

  '.cm-ySelectionInfo': {
    position: 'absolute',
    top: '-1.4em',
    left: '-1px',
    padding: '1px 4px',
    borderRadius: '3px',
    fontSize: '11px',
    fontFamily: 'system-ui',
    color: 'white',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    pointerEvents: 'none',
  },
});

// ============================================================
// CodeMirror viewport/render sync
// ------------------------------------------------------------
// CodeMirror virtualisiert große Dokumente. In komplexen SaaS-Layouts
// mit verschachtelten Scroll-Containern, Split-Panes, versteckten Tabs
// oder animierten Pane-Größen kann der Browser scrollen, ohne dass CM
// sofort neu misst. Ergebnis: Inhalt/Widgets erscheinen erst beim Klick.
//
// Diese Extension synchronisiert CM-Messungen robust, aber performant:
// - hört auf relevante Scroll-Container + Window-Capture-Scroll
// - coalesced alles via requestAnimationFrame
// - reagiert auf Resize, Visibility, Focus und Intersection
// - keine Doc-Änderung, kein History-Eintrag, kein redundantes Rendering
// ============================================================

const VIEWPORT_SYNC_EVENT_OPTIONS = { passive: true, capture: true };

function isScrollableElement(el) {
  if (!(el instanceof Element)) return false;

  const style = window.getComputedStyle(el);
  const overflow = `${style.overflowY} ${style.overflow}`;
  return /(auto|scroll|overlay)/i.test(overflow);
}

function collectEditorScrollTargets(startNode) {
  const targets = new Set();

  // Window-Capture ist wichtig, weil scroll nicht zuverlässig bubbled.
  targets.add(window);

  if (document.scrollingElement) {
    targets.add(document.scrollingElement);
  }

  let node = startNode instanceof Element ? startNode : null;

  while (node && node !== document.documentElement) {
    if (isScrollableElement(node)) {
      targets.add(node);
    }

    const root = node.getRootNode?.();
    node =
      node.parentElement ||
      (root && root.host instanceof Element ? root.host : null);
  }

  return [...targets];
}

const viewportRenderSyncPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.destroyed = false;
    this.frame = 0;

    this.onViewportSignal = () => this.schedule();

    this.scrollTargets = collectEditorScrollTargets(view.dom);
    for (const target of this.scrollTargets) {
      target.addEventListener('scroll', this.onViewportSignal, VIEWPORT_SYNC_EVENT_OPTIONS);
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.onViewportSignal, VIEWPORT_SYNC_EVENT_OPTIONS);
      window.visualViewport.addEventListener('scroll', this.onViewportSignal, VIEWPORT_SYNC_EVENT_OPTIONS);
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onViewportSignal);

      for (const el of [
        view.dom,
        view.scrollDOM,
        view.dom.parentElement,
        view.dom.closest?.('#paneEdit'),
      ]) {
        if (el instanceof Element) {
          this.resizeObserver.observe(el);
        }
      }
    } else {
      this.resizeObserver = null;
      window.addEventListener('resize', this.onViewportSignal, VIEWPORT_SYNC_EVENT_OPTIONS);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.schedule(true);
        }
      });
      this.intersectionObserver.observe(view.dom);
    } else {
      this.intersectionObserver = null;
    }

    this.onVisibilityChange = () => {
      if (!document.hidden) {
        this.schedule(true);
      }
    };

    this.onFocus = () => this.schedule(true);

    document.addEventListener('visibilitychange', this.onVisibilityChange, { passive: true });
    window.addEventListener('focus', this.onFocus, { passive: true });

    // Initiale Layouts sind oft nach Mount, Fonts, Pane-Animationen oder
    // Split-Layout erst 1–2 Frames später stabil.
    this.schedule(true);
    requestAnimationFrame(() => this.schedule(true));
  }

  schedule(immediate = false) {
    if (this.destroyed) return;

    if (immediate) {
      if (this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
      this.flush();
      return;
    }

    if (this.frame) return;

    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.flush();
    });
  }

  flush() {
    if (this.destroyed) return;

    // Löst CodeMirrors interne Viewport-/Geometry-Messung aus.
    // Das ist bewusst kein Dispatch und verändert weder Dokument noch Undo.
    this.view.requestMeasure();
  }

  destroy() {
    this.destroyed = true;

    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }

    for (const target of this.scrollTargets || []) {
      target.removeEventListener('scroll', this.onViewportSignal, VIEWPORT_SYNC_EVENT_OPTIONS);
    }

    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.onViewportSignal, VIEWPORT_SYNC_EVENT_OPTIONS);
      window.visualViewport.removeEventListener('scroll', this.onViewportSignal, VIEWPORT_SYNC_EVENT_OPTIONS);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    } else {
      window.removeEventListener('resize', this.onViewportSignal, VIEWPORT_SYNC_EVENT_OPTIONS);
    }

    this.intersectionObserver?.disconnect();

    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('focus', this.onFocus);
  }
});

function primeEditorViewport(v) {
  const measure = () => {
    if (view === v) {
      v.requestMeasure();
    }
  };

  // Mehrere Frames decken Mount, CSS/Layout, Pane-Transitions und Font-Swap ab.
  requestAnimationFrame(() => {
    measure();
    requestAnimationFrame(measure);
  });

  document.fonts?.ready?.then(measure).catch(() => {});
}

// ============================================================
// Task checkbox widget — clickable in the editor.
// ============================================================
class TaskCheckboxWidget extends WidgetType {
  constructor(checked, lineFrom) { super(); this.checked = checked; this.lineFrom = lineFrom; }
  eq(o) { return o.checked === this.checked && o.lineFrom === this.lineFrom; }
  toDOM() {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.checked;
    cb.className = 'yanta-task-checkbox';
    cb.dataset.lineFrom = String(this.lineFrom);
    cb.addEventListener('mousedown', (e) => e.preventDefault());
    cb.addEventListener('click', (e) => {
      e.preventDefault();
      const v = view;
      if (!v) return;
      const line = v.state.doc.lineAt(this.lineFrom);
      const m = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(line.text);
      if (!m) return;
      const newChar = this.checked ? ' ' : 'x';
      const from = line.from + m[1].length;
      v.dispatch({ changes: { from, to: from + 1, insert: newChar } });
    });
    return cb;
  }
  ignoreEvent(e) { return e.type !== 'mousedown'; }
}

// Decorate lines starting with "- [ ]" / "- [x]" with a clickable checkbox
// rendered as an atomic replacement of just the bracket triple.
// ============================================================
// Viewport-basierte Markdown-Dekorationen.
// Rechnet Line-Klassen, Inline-Klassen und Task-Checkboxen nur
// für sichtbare Zeilen. Fence-Kontext wird günstig (nur ```-Test)
// bis zum Viewport-Start ermittelt.
// ============================================================
function fenceStateAt(doc, pos) {
  let inFence = false;
  for (let p = 0; p < pos;) {
    const line = doc.lineAt(p);
    if (/^```/.test(line.text)) inFence = !inFence;
    if (line.to >= doc.length) break;
    p = line.to + 1;
  }
  return inFence;
}

function forVisibleLines(view, fn) {
  const doc = view.state.doc;
  for (const range of view.visibleRanges) {
    const startLine = doc.lineAt(range.from);
    const ctx = { inFence: fenceStateAt(doc, startLine.from) };
    for (let p = startLine.from; p <= range.to;) {
      const line = doc.lineAt(p);
      const info = classifyLine(line.text, ctx);
      fn(line, info);
      if (info.type === 'fence') ctx.inFence = !!info.opens;
      if (line.to >= doc.length) break;
      p = line.to + 1;
    }
  }
}

const mdLineClassPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view) {
    const b = new RangeSetBuilder();
    forVisibleLines(view, (line, info) => {
      let cls = 'cm-md-line cm-md-' + info.type;
      if (/^h[1-6]$/.test(info.type)) cls += ' cm-md-heading';
      b.add(line.from, line.from, Decoration.line({ class: cls }));
    });
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

const taskCheckboxPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view) {
    const b = new RangeSetBuilder();
    forVisibleLines(view, (line, info) => {
      if (info.type !== 'task') return;
      const m = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(line.text);
      if (!m) return;
      const from = line.from + m[1].length;
      b.add(from, from + 1, Decoration.replace({
        widget: new TaskCheckboxWidget(m[2].toLowerCase() === 'x', line.from),
      }));
    });
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

const mdInlineClassPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view) {
    const ranges = [];
    forVisibleLines(view, (line, info) => {
      if (info.type === 'code' || info.type === 'fence') return;
      collectMarkdownInlineRanges(line.text, line.from, ranges);
    });
    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    const b = new RangeSetBuilder();
    for (const r of ranges) {
      if (r.to > r.from) b.add(r.from, r.to, Decoration.mark({ class: r.className }));
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

// ============================================================
// Wikilink decorations — colour [[Target]] based on whether
// the target note exists.
// ============================================================
const wikiMatcher = new MatchDecorator({
  regexp: /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g,
  decoration: (m) => {
    const target = m[1].trim().toLowerCase();
    const exists = wikilinkIndex.has(target);
    return Decoration.mark({ class: exists ? 'yanta-wiki' : 'yanta-wiki-missing', attributes: { 'data-wiki': m[1].trim() } });
  },
});
const wikiPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = wikiMatcher.createDeco(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = wikiMatcher.updateDeco(u, this.decorations);
  }
}, { decorations: (v) => v.decorations });

// Tag decoration ( #example )
const tagMatcher = new MatchDecorator({
  regexp: /(^|\s)(#[a-zA-Z][\w-]*)/g,
  decoration: () => Decoration.mark({ class: 'yanta-tag' }),
});
const tagPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = tagMatcher.createDeco(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = tagMatcher.updateDeco(u, this.decorations); }
}, { decorations: (v) => v.decorations });

// ============================================================
// Inline image preview widget — rendered below image-only lines.
// Resizable in editor. Size is persisted as Markdown:
//
//   ![alt](url){width=420}
//
// Double-click resize handle resets width.
// ============================================================

const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(?:\{([^}\n]*)\})?\s*$/;

function clampImageWidth(n) {
  const x = Math.round(Number(n) || 0);
  return Math.max(80, Math.min(2400, x));
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
      out.width = clampImageWidth(val);
    }

    if (key === 'height' || key === 'h') {
      out.height = Math.max(50, Math.min(5000, val));
    }
  }

  return out;
}

function imageSizeAttrsToMarkdown(attrs = {}) {
  const parts = [];

  if (attrs.width) {
    parts.push(`width=${clampImageWidth(attrs.width)}`);
  }

  if (attrs.height) {
    parts.push(`height=${Math.max(50, Math.min(5000, Math.round(attrs.height)))}`);
  }

  return parts.length ? `{${parts.join(' ')}}` : '';
}

function clearActiveImageWidgets(except = null) {
  document
    .querySelectorAll('#editor .yanta-img-resizable.is-active')
    .forEach((node) => {
      if (node !== except) node.classList.remove('is-active');
    });
}

function commitImageWidgetWidth(lineFrom, width) {
  const v = view;
  if (!v) return;

  const line = v.state.doc.lineAt(lineFrom);
  const m = IMAGE_LINE_RE.exec(line.text);

  if (!m) return;

  const [, alt, url, title, rawAttrs] = m;
  const attrs = parseImageSizeAttrs(rawAttrs || '');

  if (width == null) {
    delete attrs.width;
  } else {
    attrs.width = clampImageWidth(width);
  }

  const titlePart = title ? ` "${title}"` : '';
  const attrPart = imageSizeAttrsToMarkdown(attrs);

  const next = `![${alt}](${url}${titlePart})${attrPart}`;

  v.dispatch({
    changes: {
      from: line.from,
      to: line.to,
      insert: next,
    },
    selection: {
      anchor: line.from + next.length,
    },
  });

  v.focus();
}

class ImageWidget extends WidgetType {
  constructor(url, alt, attrs = {}, lineFrom) {
    super();

    this.url = url;
    this.alt = alt;
    this.attrs = attrs;
    this.lineFrom = lineFrom;
  }

  eq(other) {
    return (
      other.url === this.url &&
      other.alt === this.alt &&
      other.lineFrom === this.lineFrom &&
      other.attrs?.width === this.attrs?.width &&
      other.attrs?.height === this.attrs?.height
    );
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'yanta-img-resizable';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', i18n('editor.imagePreviewAria'));

    const width = this.attrs?.width
      ? clampImageWidth(this.attrs.width)
      : null;

    if (width) {
      wrap.classList.add('is-resized');
      wrap.style.width = `min(${width}px, 100%)`;
    }

    const img = document.createElement('img');
    img.className = 'yanta-img-thumb';
    img.alt = this.alt;
    img.draggable = false;

    if (width) {
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.maxHeight = 'none';
    }

    if (this.attrs?.height) {
      img.style.height = `${this.attrs.height}px`;
      img.style.objectFit = 'contain';
    }

    const resolved = resolveImageForWidget(this.url);

    if (resolved) {
      img.src = resolved;
    } else if (this.url.startsWith('yanta-img://')) {
      const id = this.url.slice('yanta-img://'.length);

      ensureImageBlob(id).then((u) => {
        if (u) img.src = u;
      });
    }

    const handle = document.createElement('div');
    handle.className = 'yanta-img-resize-handle';
    handle.title = i18n('editor.resizeImageTitle');

    const activate = () => {
      clearActiveImageWidgets(wrap);
      wrap.classList.add('is-active');
    };

    wrap.addEventListener('pointerdown', (e) => {
      // Wenn der Handle selbst gedrückt wird, übernimmt dessen eigener Handler.
      if (handle.contains(e.target)) return;

      activate();
    });

    wrap.addEventListener('focus', activate);

    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        wrap.classList.remove('is-active');
        return;
      }

      // Tastatur-Resize als kleine Accessibility-Verbesserung.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();

        const current = Math.round(wrap.getBoundingClientRect().width) || width || 320;
        const step = e.shiftKey ? 50 : 20;
        const next = e.key === 'ArrowLeft'
          ? current - step
          : current + step;

        commitImageWidgetWidth(this.lineFrom, next);
      }
    });

    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    let nextWidth = width || 0;

    const onMove = (e) => {
      if (!dragging) return;

      e.preventDefault();

      const parentWidth =
        wrap.parentElement?.getBoundingClientRect?.().width ||
        wrap.getBoundingClientRect().width ||
        760;

      nextWidth = clampImageWidth(startWidth + (e.clientX - startX));
      nextWidth = Math.min(nextWidth, Math.round(parentWidth));

      wrap.classList.add('is-resized');
      wrap.classList.add('is-active');
      wrap.style.width = `min(${nextWidth}px, 100%)`;

      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.maxHeight = 'none';
    };

    const onUp = (e) => {
      if (!dragging) return;

      e?.preventDefault?.();

      dragging = false;

      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);

      if (nextWidth) {
        commitImageWidgetWidth(this.lineFrom, nextWidth);
      }
    };

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      activate();

      dragging = true;
      startX = e.clientX;
      startWidth = Math.round(wrap.getBoundingClientRect().width);
      nextWidth = startWidth;

      try {
        handle.setPointerCapture?.(e.pointerId);
      } catch {}

      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    });

    handle.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();

      commitImageWidgetWidth(this.lineFrom, null);
    });

    wrap.append(img, handle);

    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function resolveImageForWidget(url) {
  if (url.startsWith('yanta-img://')) {
    const id = url.slice('yanta-img://'.length);
    return getImageObjectUrl(id);
  }

  return url;
}

async function ensureImageBlob(id) {
  const cached = getImageObjectUrl(id);
  if (cached) return cached;

  const { store } = await import('./core.js');
  const rec = await store.images.get(id);

  if (!rec?.blob) return null;

  return putImageObjectUrl(id, rec.blob);
}

/*
  Wichtig:
  CodeMirror erlaubt block:true Decorations NICHT über ViewPlugin.
  Block-Widgets beeinflussen die vertikale Geometrie und müssen daher aus
  StateFields kommen. Viewport-Optimierung für Block-Widgets braucht eine
  andere Architektur; dieser sichere Pfad verhindert Editor-Crashes.
*/
const imagePreviewField = StateField.define({
  create(state) {
    return buildImageDecos(state);
  },

  update(deco, tr) {
    if (tr.docChanged) {
      return buildImageDecos(tr.state);
    }

    return deco.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field),
});

function buildImageDecos(state) {
  const b = new RangeSetBuilder();

  for (let p = 0; p < state.doc.length;) {
    const line = state.doc.lineAt(p);
    const m = IMAGE_LINE_RE.exec(line.text);

    if (m && !videoEmbedUrl(m[2])) {
      b.add(line.to, line.to, Decoration.widget({
        widget: new ImageWidget(
          m[2],
          m[1],
          parseImageSizeAttrs(m[4] || ''),
          line.from
        ),
        side: 1,
        block: true,
      }));
    }

    if (line.to >= state.doc.length) break;
    p = line.to + 1;
  }

  return b.finish();
}

class AudioWidget extends WidgetType {
  constructor(src) {
    super();
    this.src = src;
  }

  eq(o) {
    return o.src === this.src;
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'yanta-audio-embed';

    const audio = document.createElement('audio');
    audio.src = this.src;
    audio.controls = true;
    audio.preload = 'metadata';

    wrap.append(audio);

    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}
class VideoWidget extends WidgetType {
  constructor(embed) { super(); this.embed = embed; }
  eq(o) { return o.embed === this.embed; }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'yanta-video-embed';
    const f = document.createElement('iframe');
    f.src = this.embed;
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('frameborder', '0');
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    wrap.append(f);
    return wrap;
  }
}

/*
  Block-Widgets müssen über StateField kommen, nicht über ViewPlugin.
*/
const videoPreviewField = StateField.define({
  create(state) {
    return buildVideoDecos(state);
  },

  update(deco, tr) {
    if (tr.docChanged) {
      return buildVideoDecos(tr.state);
    }

    return deco.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field),
});

function buildVideoDecos(state) {
  const b = new RangeSetBuilder();

  for (let p = 0; p < state.doc.length;) {
    const line = state.doc.lineAt(p);
    const m = /^!?\[[^\]]*\]\(([^)\s]+)\)\s*$/.exec(line.text);

    if (m) {
      const audio = audioEmbedUrl(m[1]);
      const embed = videoEmbedUrl(m[1]);

      if (audio) {
        b.add(line.to, line.to, Decoration.widget({
          widget: new AudioWidget(audio),
          side: 1,
          block: true,
        }));
      } else if (embed) {
        b.add(line.to, line.to, Decoration.widget({
          widget: new VideoWidget(embed),
          side: 1,
          block: true,
        }));
      }
    }

    if (line.to >= state.doc.length) break;
    p = line.to + 1;
  }

  return b.finish();
}

// ============================================================
// Inline drawing preview widget for draw://<id> lines.
// ============================================================

class DrawWidget extends WidgetType {
  constructor(id) {
    super();
    this.id = id;
  }

  eq(other) {
    return other.id === this.id;
  }

  toDOM() {
    const node = document.createElement('div');
    node.className = 'yanta-draw-editor-embed';
    node.innerHTML = renderDrawEmbedHtml(this.id, i18n('image.drawingFallback'), 'editor');

    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('yanta-draw-hydrate', {
        detail: { root: node },
      }));
    });

    return node;
  }

  destroy(dom) {
    window.dispatchEvent(new CustomEvent('yanta-draw-unmount', {
      detail: { root: dom },
    }));
  }

  ignoreEvent(event) {
    // Excalidraw muss Pointer/Drag/Drop selbst bekommen.
    // Nur CodeMirror soll diese Events nicht als Text-Editing interpretieren.
    return true;
  }
}
/*
  Block-Widgets müssen über StateField kommen, nicht über ViewPlugin.
*/
const drawPreviewField = StateField.define({
  create(state) {
    return buildDrawDecos(state);
  },

  update(deco, tr) {
    if (tr.docChanged) {
      return buildDrawDecos(tr.state);
    }

    return deco.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field),
});

function buildDrawDecos(state) {
  const b = new RangeSetBuilder();

  for (let p = 0; p < state.doc.length;) {
    const line = state.doc.lineAt(p);
    const m = /^\s*draw:\/\/([a-z0-9_-]+)\s*$/i.exec(line.text);

    if (m) {
      b.add(line.to, line.to, Decoration.widget({
        widget: new DrawWidget(m[1]),
        side: 1,
        block: true,
      }));
    }

    if (line.to >= state.doc.length) break;
    p = line.to + 1;
  }

  return b.finish();
}

// ============================================================
// Autocomplete: wikilinks, tags, slash commands.
// ============================================================
function wikiCompletion(ctx) {
  const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 60), ctx.pos);
  const open = before.lastIndexOf('[[');
  const close = before.lastIndexOf(']]');
  if (open < 0 || close > open) return null;
  const query = before.slice(open + 2);
  if (/\n/.test(query)) return null;
  const q = query.toLowerCase();
  const options = [...state.notes.values()]
    .filter((n) => n.id !== currentNoteId)
    .filter((n) => !q || (n.title || '').toLowerCase().includes(q))
    .slice(0, 12)
    .map((n) => ({
      label: n.title || i18n('note.untitled'),
      type: 'note',
      apply: (v, _c, from, to) => {
        const insert = (n.title || i18n('note.untitled')) + ']]';
        v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      },
    }));
  if (query.trim() && !options.find((o) => o.label.toLowerCase() === q)) {
    options.push({
      label: `+ Create "${query.trim()}"`,
      type: 'create',
      apply: (v, _c, from, to) => {
        const insert = query.trim() + ']]';
        v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      },
    });
  }
  return { from: ctx.pos - query.length, options, validFor: /^[^\]\n]*$/ };
}
function tagCompletion(ctx) {
  const m = ctx.matchBefore(/(^|\s)#[\w-]*$/);
  if (!m || (m.from === m.to && !ctx.explicit)) return null;
  const text = ctx.state.sliceDoc(m.from, m.to);
  const tm = /#([\w-]*)$/.exec(text);
  if (!tm) return null;
  const q = tm[1].toLowerCase();
  const seen = new Map();
  for (const n of state.notes.values()) for (const t of n.tags || []) seen.set(t, (seen.get(t) || 0) + 1);
  const opts = [...seen.entries()]
    .filter(([t]) => !q || t.toLowerCase().includes(q))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => ({ label: '#' + t, type: 'tag', apply: '#' + t + ' ' }));
  if (!opts.length) return null;
  return { from: m.from + (m.text.startsWith(' ') ? 1 : 0), options: opts };
}
function slashCompletion(ctx) {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = ctx.state.sliceDoc(line.from, ctx.pos);

  // Slash command anywhere in the current line, but only as a token:
  // erlaubt:
  //   /task
  //   Text /task
  //   ( /task
  //
  // vermeidet eher unerwünschte Treffer in URLs/Pfaden wie https://...
  const m = /(^|[\s([{'"“‘])\/[\w-]*$/.exec(before);

  if (!m) return null;

  const from = line.from + m.index + m[1].length;
  const token = ctx.state.sliceDoc(from, ctx.pos);

  if (!token.startsWith('/')) return null;
  if (token === '' && !ctx.explicit) return null;

  const cmds = [
    { name: 'heading-1', apply: '# ' },
    { name: 'heading-2', apply: '## ' },
    { name: 'heading-3', apply: '### ' },
    { name: 'task', apply: '- [ ] ' },
    { name: 'bullet', apply: '- ' },
    { name: 'numbered', apply: '1. ' },
    { name: 'quote', apply: '> ' },
    { name: 'code-block', apply: '```\n\n```' },
    { name: 'table', apply: '| col | col |\n| --- | --- |\n|     |     |' },
    { name: 'callout-note', apply: '> [!NOTE]\n> ' },
    { name: 'callout-tip', apply: '> [!TIP]\n> ' },
    { name: 'callout-warning', apply: '> [!WARNING]\n> ' },
    { name: 'math-block', apply: '$$\n\n$$' },
    { name: 'wikilink', apply: '[[' },
    { name: 'image', apply: 'IMAGE_INSERT' },
    { name: 'cite', apply: 'CITE_INSERT' },
    { name: 'citation', apply: 'CITE_INSERT' },
    { name: 'drawing', apply: 'DRAW_INSERT' },
    { name: 'icon', apply: 'ICON_INSERT' },
    { name: 'shopping-list-link', apply: '[[' },
  ];

  return {
    from,
    options: cmds.map((c) => ({
      label: '/' + c.name,
      type: 'slash',

      // Kein detail mehr: /task erklärt sich selbst.
      apply: (view, completion, from, to) => {
        if (c.apply === 'IMAGE_INSERT') {
          view.dispatch({ changes: { from, to, insert: '' } });
          window.dispatchEvent(new CustomEvent('yanta-open-image-modal'));
          return;
        }

        if (c.apply === 'CITE_INSERT') {
          view.dispatch({ changes: { from, to, insert: '' } });
          window.dispatchEvent(new CustomEvent('yanta-open-citation-manager'));
          return;
        }

        if (c.apply === 'DRAW_INSERT') {
          view.dispatch({ changes: { from, to, insert: '' } });
          window.dispatchEvent(new CustomEvent('yanta-create-drawing'));
          return;
        }

        if (c.apply === 'ICON_INSERT') {
          view.dispatch({ changes: { from, to, insert: '' } });
          window.dispatchEvent(new CustomEvent('yanta-open-icon-insert'));
          return;
        }

        view.dispatch({
          changes: { from, to, insert: c.apply },
          selection: { anchor: from + c.apply.length },
        });
      },
    })),

    validFor: /^\/[\w-]*$/,
  };
}

// ============================================================
// Wikilink follow: Ctrl/Cmd+click in editor follows [[Target]].
// ============================================================
function wikilinkClickHandler() {
  return EditorView.domEventHandlers({
    click(e, view) {
      if (!(e.ctrlKey || e.metaKey)) return false;
      const target = e.target.closest('.yanta-wiki, .yanta-wiki-missing');
      if (!target) return false;
      const wiki = target.getAttribute('data-wiki');
      if (!wiki) return false;
      window.dispatchEvent(new CustomEvent('yanta-follow-wiki', { detail: { target: wiki } }));
      e.preventDefault();
      return true;
    },
  });
}

// ============================================================
// Paste handler — if the clipboard holds an image, open the image
// modal pre-loaded with that file; otherwise let CM handle the paste.
// ============================================================
function pasteHandler() {
  return EditorView.domEventHandlers({
    paste(e) {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          e.preventDefault();
          const file = it.getAsFile();
          if (file) window.dispatchEvent(new CustomEvent('yanta-paste-image', { detail: { file } }));
          return true;
        }
      }
      return false;
    },
  });
}

// ============================================================
// Drop handler — if a YANTA note is dropped, insert as wikilink.
// If a URL is dropped, insert as markdown link (or image-embed).
// If a file is dropped, route it (image → image modal; .md → import).
// ============================================================
function dropHandler() {
  return EditorView.domEventHandlers({
    dragover(e) {
      const types = [...(e.dataTransfer.types || [])];

      if (
        types.includes('text/yanta-calendar-event') ||
        types.includes('text/yanta-note') ||
        types.includes('Files') ||
        types.includes('text/uri-list') ||
        types.includes('text/x-moz-url') ||
        types.includes('text/plain')
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        return true;
      }

      return false;
    },
    drop(e, view) {
      const types = [...(e.dataTransfer.types || [])];
      // Find caret position for the drop.
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.doc.length;
      const calendarEventJson = e.dataTransfer.getData('text/yanta-calendar-event');
      const plainDropText = e.dataTransfer.getData('text/plain') || '';

      const looksLikeCalendarMarkdown =
        /@(due|date|event)\([^)]+\)(?:\{[^}\n]*\})?/i.test(plainDropText);

      if (calendarEventJson || looksLikeCalendarMarkdown) {
        e.preventDefault();
        e.stopPropagation();

        let payload = null;

        if (calendarEventJson) {
          try {
            payload = JSON.parse(calendarEventJson);
          } catch {}
        }

        /*
          Kein @due/@date Markdown mehr einfügen.
          Stattdessen Event↔Note sauber über calendar.js verlinken.
        */
        window.dispatchEvent(new CustomEvent('yanta-calendar-event-drop-on-note', {
          detail: {
            ...(payload || {}),
            noteId: state.currentNoteId,
            clientX: e.clientX,
            clientY: e.clientY,
            rawText: plainDropText || '',
          },
        }));

        return true;
      }

      // A YANTA note drag → insert [[Title]] at drop position.
      const noteId = e.dataTransfer.getData('text/yanta-note');
      if (noteId) {
        e.preventDefault();
        const title = e.dataTransfer.getData('text/plain') || i18n('image.noteFallback');
        const insert = `[[${title}]]`;
        view.dispatch({ changes: { from: pos, to: pos, insert }, selection: { anchor: pos + insert.length } });
        return true;
      }
      // Files: route via custom event so main.js can handle (image vs md).
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('yanta-editor-drop-files', { detail: { files, pos } }));
        return true;
      }
      // URL drop (text/uri-list or text/plain that looks like a URL).
      let url = e.dataTransfer.getData('text/uri-list') || '';
      url = url.split('\n').find((l) => l && !l.startsWith('#')) || '';
      if (!url) {
        const text = e.dataTransfer.getData('text/plain') || '';
        if (/^https?:\/\/\S+$/.test(text.trim())) url = text.trim();
      }
      if (url) {
        e.preventDefault();
        const isImage = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(url);
        const isVideo = /(?:youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d+)/.test(url);
        const title = e.dataTransfer.getData('text/x-moz-url-title') || url;
        const insert = isImage ? `![${title}](${url})`
                     : isVideo ? `![](${url})`
                     : `[${title}](${url})`;
        view.dispatch({ changes: { from: pos, to: pos, insert }, selection: { anchor: pos + insert.length } });
        return true;
      }
      return false;
    },
  });
}

function collectMarkdownInlineRanges(text, lineFrom, ranges) {
  const protectedRanges = [];

  const overlapsProtected = (from, to) =>
    protectedRanges.some((r) => from < r.to && to > r.from);

  const protect = (from, to) => {
    if (to > from) protectedRanges.push({ from, to });
  };

  const add = (from, to, className, shouldProtect = false) => {
    if (to <= from) return;
    if (overlapsProtected(from, to)) return;

    ranges.push({
      from: lineFrom + from,
      to: lineFrom + to,
      className,
    });

    if (shouldProtect) protect(from, to);
  };

  let m;

  // Inline code first; nothing inside code should be styled as Markdown.
  const codeRe = /`([^`\n]+)`/g;
  while ((m = codeRe.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'yanta-md-inline-code', true);
  }

  // Images and normal links.
  const linkRe = /!?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = linkRe.exec(text)) !== null) {
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    if (overlapsProtected(fullFrom, fullTo)) continue;

    const isImage = m[0].startsWith('!');
    const labelOffset = isImage ? 2 : 1;
    const labelFrom = m.index + labelOffset;
    const labelTo = labelFrom + m[1].length;

    const urlMarker = m[0].indexOf('](');
    const urlFrom = m.index + urlMarker + 2;
    const urlTo = urlFrom + m[2].length;

    if (isImage) {
      add(fullFrom, fullTo, 'yanta-md-image', true);
    } else {
      add(labelFrom, labelTo, 'yanta-md-link-text');
      add(urlFrom, urlTo, 'yanta-md-link-url');
      protect(fullFrom, fullTo);
    }
  }

  // DOI links.
  const doiRe = /\bdoi:(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/gi;
  while ((m = doiRe.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'yanta-md-doi', true);
  }

  // Display/inline math placeholders.
  const displayMathRe = /\$\$([^$\n]+)\$\$/g;
  while ((m = displayMathRe.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'yanta-md-math yanta-md-math-block', true);
  }

  const inlineMathRe = /(?<!\\)\$([^$\n]+)\$/g;
  while ((m = inlineMathRe.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'yanta-md-math', true);
  }

  // Bold + italic combined.
  const boldItalicRe = /(\*\*\*|___)(.+?)\1/g;
  while ((m = boldItalicRe.exec(text)) !== null) {
    const innerFrom = m.index + m[1].length;
    const innerTo = innerFrom + m[2].length;
    add(innerFrom, innerTo, 'yanta-md-strong yanta-md-em', true);
    protect(m.index, m.index + m[0].length);
  }

  // Bold.
  const boldRe = /(\*\*|__)(.+?)\1/g;
  while ((m = boldRe.exec(text)) !== null) {
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    if (overlapsProtected(fullFrom, fullTo)) continue;

    const innerFrom = m.index + m[1].length;
    const innerTo = innerFrom + m[2].length;
    add(innerFrom, innerTo, 'yanta-md-strong', true);
    protect(fullFrom, fullTo);
  }

  // Italic with *...*
  const italicStarRe = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
  while ((m = italicStarRe.exec(text)) !== null) {
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    if (overlapsProtected(fullFrom, fullTo)) continue;

    const innerFrom = m.index + 1;
    const innerTo = innerFrom + m[1].length;
    add(innerFrom, innerTo, 'yanta-md-em', true);
    protect(fullFrom, fullTo);
  }

  // Italic with _..._
  const italicUnderscoreRe = /(?<!_)_([^_\n]+)_(?!_)/g;
  while ((m = italicUnderscoreRe.exec(text)) !== null) {
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    if (overlapsProtected(fullFrom, fullTo)) continue;

    const innerFrom = m.index + 1;
    const innerTo = innerFrom + m[1].length;
    add(innerFrom, innerTo, 'yanta-md-em', true);
    protect(fullFrom, fullTo);
  }

  // Highlight ==...==
  const markRe = /==([^=\n]+)==/g;
  while ((m = markRe.exec(text)) !== null) {
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    if (overlapsProtected(fullFrom, fullTo)) continue;

    const innerFrom = m.index + 2;
    const innerTo = innerFrom + m[1].length;
    add(innerFrom, innerTo, 'yanta-md-mark', true);
    protect(fullFrom, fullTo);
  }

  // Strikethrough ~~...~~
  const strikeRe = /~~([^~\n]+)~~/g;
  while ((m = strikeRe.exec(text)) !== null) {
    const fullFrom = m.index;
    const fullTo = m.index + m[0].length;
    if (overlapsProtected(fullFrom, fullTo)) continue;

    const innerFrom = m.index + 2;
    const innerTo = innerFrom + m[1].length;
    add(innerFrom, innerTo, 'yanta-md-strike', true);
    protect(fullFrom, fullTo);
  }
}

// ============================================================
// Inline Lucide editor decorations.
// Makes :lucide[cloud]{#4ade80}: editable by clicking:
// - icon key  -> icon picker
// - color     -> native color picker
// Also supports color names like {black}.
// ============================================================

const LUCIDE_INLINE_RE = /:lucide\[([a-zA-Z0-9-_ ]+)\](?:\{([^}\n:]+)\})?:/g;

const lucideInlineEditField = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = buildLucideInlineEditDecos(view);
  }

  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildLucideInlineEditDecos(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

function buildLucideInlineEditDecos(view) {
  const b = new RangeSetBuilder();
  const doc = view.state.doc;

  for (const range of view.visibleRanges) {
    let p = doc.lineAt(range.from).from;

    while (p <= range.to) {
      const line = doc.lineAt(p);
      const text = line.text;

      LUCIDE_INLINE_RE.lastIndex = 0;

      let m;
      while ((m = LUCIDE_INLINE_RE.exec(text)) !== null) {
        const tokenFrom = line.from + m.index;
        const tokenTo = tokenFrom + m[0].length;

        const iconFrom = tokenFrom + ':lucide['.length;
        const iconTo = iconFrom + m[1].length;

        const baseAttrs = {
          'data-token-from': String(tokenFrom),
          'data-token-to': String(tokenTo),
          'data-icon': m[1].trim(),
          'data-icon-from': String(iconFrom),
          'data-icon-to': String(iconTo),
        };

        if (m[2]) {
          const colorBrace = m[0].indexOf('{');
          const colorFrom = tokenFrom + colorBrace + 1;
          const colorTo = colorFrom + m[2].length;

          baseAttrs['data-color'] = m[2].trim();
          baseAttrs['data-color-from'] = String(colorFrom);
          baseAttrs['data-color-to'] = String(colorTo);
        }

        b.add(
          iconFrom,
          iconTo,
          Decoration.mark({
            class: 'yanta-lucide-key',
            attributes: baseAttrs,
          })
        );

        if (m[2]) {
          const colorBrace = m[0].indexOf('{');
          const colorFrom = tokenFrom + colorBrace + 1;
          const colorTo = colorFrom + m[2].length;
          const safeColor = safeCssColor(m[2]);

          b.add(
            colorFrom,
            colorTo,
            Decoration.mark({
              class: 'yanta-color-code',
              attributes: {
                ...baseAttrs,
                'data-color': m[2].trim(),
                'data-color-from': String(colorFrom),
                'data-color-to': String(colorTo),
                ...(safeColor
                  ? { style: `color:${safeColor};border-bottom-color:${safeColor}` }
                  : {}),
              },
            })
          );
        }
      }

      if (line.to >= doc.length) break;
      p = line.to + 1;
    }
  }

  return b.finish();
}

function readInlineEditDataset(node) {
  const n = node instanceof Element ? node : null;
  if (!n) return null;

  const intAttr = (name) => {
    const v = n.getAttribute(name);
    const i = parseInt(v || '', 10);
    return Number.isFinite(i) ? i : null;
  };

  return {
    tokenFrom: intAttr('data-token-from'),
    tokenTo: intAttr('data-token-to'),
    iconFrom: intAttr('data-icon-from'),
    iconTo: intAttr('data-icon-to'),
    colorFrom: intAttr('data-color-from'),
    colorTo: intAttr('data-color-to'),
    icon: n.getAttribute('data-icon') || '',
    color: n.getAttribute('data-color') || '',
  };
}

function inlineLucideEditClickHandler() {
  return EditorView.domEventHandlers({
    click(e) {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return false;

      const colorEl = target.closest('.yanta-color-code');
      if (colorEl) {
        const detail = readInlineEditDataset(colorEl);
        if (!detail) return false;

        window.dispatchEvent(new CustomEvent('yanta-edit-inline-icon-color', { detail }));
        e.preventDefault();
        return true;
      }

      const iconEl = target.closest('.yanta-lucide-key');
      if (iconEl) {
        const detail = readInlineEditDataset(iconEl);
        if (!detail) return false;

        window.dispatchEvent(new CustomEvent('yanta-edit-inline-icon', { detail }));
        e.preventDefault();
        return true;
      }

      return false;
    },
  });
}

// ============================================================
// Layout sync spacers.
// The preview can naturally be taller than the editor for a source line
// because rendered Markdown hides syntax or expands embeds/callouts.
// These block widgets let us add invisible height after editor lines so
// source-line Y positions can match the preview.
// ============================================================

const setEditorLineSpacersEffect = StateEffect.define();

class LineSpacerWidget extends WidgetType {
  constructor(height) {
    super();
    this.height = Math.max(0, Math.round(height || 0));
  }

  eq(other) {
    return other.height === this.height;
  }

  toDOM() {
    const n = document.createElement('div');
    n.className = 'yanta-line-spacer';
    n.style.height = this.height + 'px';
    return n;
  }

  ignoreEvent() {
    return true;
  }
}

const editorLineSpacerField = StateField.define({
  create() {
    return Decoration.none;
  },

  update(deco, tr) {
    deco = deco.map(tr.changes);

    for (const e of tr.effects) {
      if (e.is(setEditorLineSpacersEffect)) {
        return buildEditorLineSpacers(tr.state, e.value || []);
      }
    }

    return deco;
  },

  provide: (field) => EditorView.decorations.from(field),
});

function buildEditorLineSpacers(s, extraByLine) {
  const b = new RangeSetBuilder();

  for (let lineNo = 1; lineNo <= s.doc.lines; lineNo++) {
    const extra = extraByLine[lineNo - 1] || 0;
    if (extra < 1) continue;

    const line = s.doc.line(lineNo);
    b.add(line.to, line.to, Decoration.widget({
      widget: new LineSpacerWidget(extra),
      block: true,
      side: 1,
    }));
  }

  return b.finish();
}

export function setEditorLineSpacers(extraByLine) {
  if (!view) return;
  view.dispatch({
    effects: setEditorLineSpacersEffect.of(extraByLine || []),
  });
}

// ============================================================
// Editor title row as CodeMirror block widget
// ------------------------------------------------------------
// Die Titelzeile soll im Editor mitscrollen, darf aber nicht als
// fremdes DOM-Kind direkt in .cm-scroller eingefügt werden.
// Deshalb wird sie als offizielles CodeMirror Block Widget bei pos 0
// gerendert. So bleibt CodeMirrors Virtualisierung/Layout sauber.
// ============================================================

class EditorTitleWidget extends WidgetType {
  constructor(noteId) {
    super();
    this.noteId = noteId || '';
  }

  eq(other) {
    // Absichtlich nur noteId vergleichen:
    // Der Input-Wert wird über syncTitleMirrorValue() / DOM synchronisiert.
    // So wird das Widget beim Tippen im Titel nicht ständig ersetzt.
    return other.noteId === this.noteId;
  }

  toDOM() {
    const row = document.createElement('div');
    row.className = 'yanta-pane-title-row edit yanta-cm-title-widget';
    row.dataset.notePaneTitle = 'edit';

    const canonical = $('noteTitle');
    const note = this.noteId ? state.notes.get(this.noteId) : null;

    const input = document.createElement('input');
    input.className = 'yanta-note-title-mirror';
    input.value = canonical?.value || note?.title || '';
    input.placeholder = i18n('note.untitledPlaceholder');
    input.autocomplete = 'off';
    input.spellcheck = false;

    const commitInput = () => {
      const c = $('noteTitle');
      if (!c) return;

      c.value = input.value || '';

      const note = this.noteId ? state.notes.get(this.noteId) : null;

      if (note) {
        note.title = input.value.trim() || note.title || i18n('note.untitled');
        note.updated = Date.now();
      }

      c.dispatchEvent(new Event('input', {
        bubbles: true,
      }));
    };

    const commitBlur = () => {
      const c = $('noteTitle');
      if (!c) return;

      c.value = input.value || '';

      const note = this.noteId ? state.notes.get(this.noteId) : null;

      if (note) {
        note.title = input.value.trim() || i18n('note.untitled');
        note.updated = Date.now();
      }

      c.dispatchEvent(new Event('blur', {
        bubbles: true,
      }));
    };

    input.addEventListener('input', (e) => {
      e.stopPropagation();
      commitInput();
    });

    input.addEventListener('blur', (e) => {
      e.stopPropagation();
      commitBlur();
    });

    input.addEventListener('keydown', (e) => {
      /*
        Critical:
        This input lives inside a CodeMirror block widget.
        If keydown bubbles, CodeMirror may consume ArrowLeft/ArrowRight,
        Home/End, Backspace, shortcuts, etc. Native input editing must win.
      */
      e.stopPropagation();

      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });

    input.addEventListener('keyup', (e) => {
      e.stopPropagation();
    });

    input.addEventListener('keypress', (e) => {
      e.stopPropagation();
    });

    input.addEventListener('beforeinput', (e) => {
      e.stopPropagation();
    });

    /*
      Wichtig:
      Diese Events nicht an CodeMirror durchreichen, sonst setzt CM ggf.
      Cursor/Selection im Dokument statt den Titel-Input normal zu bedienen.
    */
    for (const type of ['mousedown', 'pointerdown', 'click', 'dblclick']) {
      row.addEventListener(type, (e) => {
        e.stopPropagation();
      });
    }

    row.append(input);

    return row;
  }

  ignoreEvent() {
    /*
      true = CodeMirror ignores events inside this widget.
      The native input can handle cursor movement, selection, typing, etc.
    */
    return true;
  }
}

const editorTitleWidgetField = StateField.define({
  create() {
    return buildEditorTitleWidgetDeco();
  },

  update(deco, tr) {
    deco = deco.map(tr.changes);
    return deco;
  },

  provide: (field) => EditorView.decorations.from(field),
});

function buildEditorTitleWidgetDeco() {
  if (!currentNoteId) {
    return Decoration.none;
  }

  const b = new RangeSetBuilder();

  b.add(0, 0, Decoration.widget({
    widget: new EditorTitleWidget(currentNoteId),
    block: true,
    side: -1,
  }));

  return b.finish();
}

// ============================================================
// Public API — mount / swap / destroy editor.
// ============================================================

function cleanupYBinding() {
  if (!currentYBinding) return;

  try {
    currentYBinding.ytext.unobserve(currentYBinding.observer);
  } catch {}

  currentYBinding = null;
}

function bindYTextToEditor(v, ytext) {
  cleanupYBinding();

  const observer = (event) => {
    if (!view || view !== v) return;

    // Updates, die wir selbst aus CodeMirror in Y.Text geschrieben haben,
    // nicht wieder zurückspiegeln.
    if (event.transaction.origin === 'codemirror') return;

    const changes = [];
    let pos = 0;

    for (const op of event.changes.delta) {
      if (op.retain) {
        pos += op.retain;
      }

      if (op.delete) {
        changes.push({
          from: pos,
          to: pos + op.delete,
          insert: '',
        });

        // Delta-Positionen beziehen sich auf das alte Dokument.
        pos += op.delete;
      }

      if (op.insert) {
        changes.push({
          from: pos,
          to: pos,
          insert: String(op.insert),
        });

        // Insert verbraucht keine Position im alten Dokument.
      }
    }

    if (!changes.length) return;

    applyingYUpdate = true;

    try {
      v.dispatch({
        changes,
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      applyingYUpdate = false;
    }
  };

  ytext.observe(observer);
  currentYBinding = { ytext, observer };
}

function applyCodeMirrorChangesToYText(update, ytext) {
  if (!update.docChanged || applyingYUpdate) return;

  let offset = 0;

  ytext.doc?.transact(() => {
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const from = fromA + offset;
      const deleteLen = toA - fromA;
      const insertText = inserted.toString();

      if (deleteLen > 0) {
        ytext.delete(from, deleteLen);
      }

      if (insertText) {
        ytext.insert(from, insertText);
      }

      offset += insertText.length - deleteLen;
    });
  }, 'codemirror');
}

export function mountEditor(host, { noteId, awarenessUser }) {
  cleanupYBinding();
  if (view) view.destroy();
  currentNoteId = noteId;
  const { doc } = getNoteDoc(noteId);
  const ytext = doc.getText('markdown');

  const exts = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    viewportRenderSyncPlugin,
    editorTitleWidgetField,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(yantaHighlight),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    mdLineClassPlugin,
    mdInlineClassPlugin,
    lucideInlineEditField,
    editorLineSpacerField,
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    autocompletion({
      override: [wikiCompletion, tagCompletion, slashCompletion],
      closeOnBlur: true,
      activateOnTyping: true,
    }),
    wikiPlugin,
    tagPlugin,
    taskCheckboxPlugin,
    imagePreviewField,
    videoPreviewField,
    drawPreviewField,
    wikilinkClickHandler(),
    inlineLucideEditClickHandler(),
    pasteHandler(),
    dropHandler(),
    EditorView.domEventHandlers({
      pointerdown(e) {
        const target = e.target instanceof Element ? e.target : null;

        if (!target?.closest?.('.yanta-img-resizable')) {
          clearActiveImageWidgets();
        }

        return false;
      },
    }),
    EditorView.updateListener.of((u) => {
      applyCodeMirrorChangesToYText(u, ytext);

      if (u.selectionSet || u.focusChanged) {
        window.dispatchEvent(new CustomEvent('yanta-selection-change'));
      }

      if (u.docChanged || u.geometryChanged) {
        window.dispatchEvent(new CustomEvent('yanta-editor-geometry-change'));
      }
    }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      { key: 'Tab', run: acceptCompletion },
      indentWithTab,
      { key: 'Mod-b', run: (v) => wrapSelection(v, '**', '**') },
      { key: 'Mod-i', run: (v) => wrapSelection(v, '*', '*') },
      { key: 'Mod-`', run: (v) => wrapSelection(v, '`', '`') },
    ]),
    placeholder('Start writing in Markdown… type / for commands, [[ for links'),
    themeCompartment.of(yantaTheme),
    editableCompartment.of([]),
  ];

  // y-codemirror.next expects the initial editor doc to mirror the
  // Y.Text — it only syncs *future* changes from Y.Text into the editor.
  view = new EditorView({
    parent: host,
    state: EditorState.create({ doc: ytext.toString(), extensions: exts }),
  });

  bindYTextToEditor(view, ytext);
  primeEditorViewport(view);

  return view;
}

export function getView() { return view; }

// Hard read-only for notes the user may not edit (e.g. mounted from a
// shared space with a read role). Blocks both keyboard input and
// programmatic transactions at the state level.
export function setEditorReadOnly(readOnly) {
  if (!view) return;
  view.dispatch({
    effects: editableCompartment.reconfigure(
      readOnly
        ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
        : []
    ),
  });
}

export function destroyEditor() {
  cleanupYBinding();

  if (view) {
    view.destroy();
    view = null;
  }

  currentNoteId = null;
}

export function focusEditor() { view?.focus(); }

export function focusEditorEnd() {
  if (!view) return;
  view.focus();
  const len = view.state.doc.length;
  view.dispatch({ selection: { anchor: len }, scrollIntoView: true });
}

// Force CodeMirror to re-render image/video decorations (called after
// an async image blob load completes so the widget can swap in the URL).
export function refreshWidgets() {
  if (!view) return;
  // Trigger a no-op dispatch so StateFields recompute (they only rebuild
  // on docChanged, so we nudge by an empty changes object).
  view.requestMeasure();
}

export function insertAtCursor(text) {
  if (!view) return;
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + text.length },
  });
  view.focus();
}

export function insertTextAtCoords(text, clientX, clientY) {
  if (!view) return false;

  const raw = String(text || '').trim();
  if (!raw) return false;

  const paneEdit = document.getElementById('paneEdit');
  const elementAtPoint = document.elementFromPoint(clientX, clientY);

  const insideEditor =
    view.dom.contains(elementAtPoint) ||
    view.scrollDOM.contains(elementAtPoint) ||
    paneEdit?.contains(elementAtPoint);

  if (!insideEditor) {
    return false;
  }

  let pos = view.posAtCoords({
    x: clientX,
    y: clientY,
  });

  if (pos == null) {
    // Dropping into editor padding / below last line should append.
    pos = view.state.doc.length;
  }

  const docText = view.state.doc.toString();

  const before = docText.slice(Math.max(0, pos - 1), pos);
  const after = docText.slice(pos, pos + 1);

  const prefix = before && before !== '\n' ? '\n' : '';
  const suffix = after && after !== '\n' ? '\n' : '';

  const insert = `${prefix}${raw}${suffix}`;

  view.dispatch({
    changes: {
      from: pos,
      to: pos,
      insert,
    },
    selection: {
      anchor: pos + insert.length,
    },
    scrollIntoView: true,
  });

  view.focus();

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: state.currentNoteId,
      reason: 'external-insert',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-calendar-markdown-changed', {
    detail: {
      noteId: state.currentNoteId,
    },
  }));

  return true;
}

function wrapSelection(v, open, close) {
  const sel = v.state.selection.main;
  const text = v.state.sliceDoc(sel.from, sel.to) || '';
  v.dispatch({
    changes: { from: sel.from, to: sel.to, insert: open + text + close },
    selection: { anchor: sel.from + open.length + text.length + (text ? 0 : 0) },
  });
  return true;
}

export function applyLinePrefix(prefix) {
  if (!view) return;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const stripped = line.text.replace(/^(\s*)(#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/, '$1');
  view.dispatch({ changes: { from: line.from, to: line.to, insert: prefix + stripped } });
}

export function currentMarkdown() {
  return view ? view.state.doc.toString() : '';
}

export function setEditableForView(viewMode) {
  if (!view) return;
  // Editor is hidden via CSS when preview-only; nothing extra needed.
}

// Cycle theme override or other compartments could go here if needed.
