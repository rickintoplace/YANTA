// ============================================================
// YANTA — Editor: CodeMirror 6 + Yjs binding.
// Features: markdown highlighting, Yjs collab text, undo/redo,
// autocomplete (wikilinks / tags / slash commands), task checkbox
// widget, image preview widget, live cursors (when shared).
// ============================================================

import { EditorState, Compartment, RangeSetBuilder, StateField } from '@codemirror/state';
import { EditorView, keymap, drawSelection, placeholder, ViewPlugin, Decoration, WidgetType, MatchDecorator } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { yCollab } from 'y-codemirror.next';

import { state } from './core.js';
import { getNoteDoc, getMarkdownText } from './yjs.js';
import { wikilinkIndex } from './features-state.js';

let view = null;
let currentNoteId = null;
const collabCompartment = new Compartment();
const themeCompartment = new Compartment();

// ----- Custom highlight style (matches YANTA theme) ---------------------
const yantaHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.55em', fontWeight: '700', color: 'var(--text)' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '700', color: 'var(--text)' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600', color: 'var(--text)' },
  { tag: t.heading4, fontSize: '1.05em', fontWeight: '600', color: 'var(--text)' },
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
    fontSize: 'var(--font-size, 15px)',
    color: 'var(--text)',
    backgroundColor: 'transparent',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font, system-ui)',
    lineHeight: '1.6',
    padding: '12px 18px',
  },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--sel)' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-tooltip': {
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text)',
    boxShadow: '0 6px 20px rgba(0,0,0,.25)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: 'var(--accent)',
    color: 'white',
  },
  '.cm-tooltip-autocomplete ul li': { padding: '4px 8px' },
  '.yanta-task-checkbox': {
    display: 'inline-block', verticalAlign: 'middle', marginRight: '6px',
    width: '14px', height: '14px', cursor: 'pointer',
  },
  '.yanta-wiki': { color: 'var(--accent)', textDecoration: 'none' },
  '.yanta-wiki-missing': { color: 'var(--text-dim)', textDecoration: 'underline dotted' },
  '.yanta-tag': { color: 'var(--accent-2, #8ab4f8)' },
  '.yanta-img-thumb': {
    display: 'block', maxWidth: '320px', maxHeight: '220px',
    borderRadius: '6px', margin: '4px 0',
  },
  // Yjs remote cursors
  '.cm-ySelectionInfo': {
    position: 'absolute', top: '-1.4em', left: '-1px',
    padding: '1px 4px', borderRadius: '3px',
    fontSize: '11px', fontFamily: 'system-ui', color: 'white',
    whiteSpace: 'nowrap', userSelect: 'none', pointerEvents: 'none',
  },
});

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
const taskCheckboxField = StateField.define({
  create(s) { return buildTaskDecos(s); },
  update(d, tr) { return tr.docChanged ? buildTaskDecos(tr.state) : d; },
  provide: (f) => EditorView.decorations.from(f),
});
function buildTaskDecos(s) {
  const b = new RangeSetBuilder();
  for (let p = 0; p < s.doc.length;) {
    const line = s.doc.lineAt(p);
    const m = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(line.text);
    if (m) {
      const from = line.from + m[1].length;
      const to = from + 1;
      b.add(from, to, Decoration.replace({ widget: new TaskCheckboxWidget(m[2].toLowerCase() === 'x', line.from) }));
    }
    p = line.to + 1;
  }
  return b.finish();
}

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
// Resolves yanta-img:// references; if the blob isn't loaded yet,
// pulls it from IndexedDB and re-decorates the line.
// ============================================================
class ImageWidget extends WidgetType {
  constructor(url, alt) { super(); this.url = url; this.alt = alt; }
  eq(o) { return o.url === this.url && o.alt === this.alt; }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'yanta-img-thumb';
    img.alt = this.alt;
    img.draggable = false;
    const resolved = resolveImageForWidget(this.url);
    if (resolved) {
      img.src = resolved;
    } else if (this.url.startsWith('yanta-img://')) {
      const id = this.url.slice('yanta-img://'.length);
      ensureImageBlob(id).then((u) => { if (u) img.src = u; });
    }
    return img;
  }
}
function resolveImageForWidget(url) {
  if (url.startsWith('yanta-img://')) {
    const id = url.slice('yanta-img://'.length);
    return state.imageBlobs.get(id) || '';
  }
  return url;
}
async function ensureImageBlob(id) {
  if (state.imageBlobs.has(id)) return state.imageBlobs.get(id);
  const { store } = await import('./core.js');
  const rec = await store.images.get(id);
  if (!rec || !rec.blob) return null;
  const u = URL.createObjectURL(rec.blob);
  state.imageBlobs.set(id, u);
  return u;
}
const imagePreviewField = StateField.define({
  create(s) { return buildImageDecos(s); },
  update(d, tr) { return tr.docChanged ? buildImageDecos(tr.state) : d; },
  provide: (f) => EditorView.decorations.from(f),
});
function buildImageDecos(s) {
  const b = new RangeSetBuilder();
  for (let p = 0; p < s.doc.length;) {
    const line = s.doc.lineAt(p);
    const m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.text);
    if (m && !videoEmbedUrl(m[2])) {
      b.add(line.to, line.to, Decoration.widget({
        widget: new ImageWidget(m[2], m[1]),
        side: 1,
        block: true,
      }));
    }
    p = line.to + 1;
  }
  return b.finish();
}

// ============================================================
// Inline YouTube / Vimeo video preview widget.
// Matches image-syntax lines whose URL is a recognised video host.
// ============================================================
function videoEmbedUrl(url) {
  let m;
  if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(url))) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  if ((m = /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/.exec(url))) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  if ((m = /vimeo\.com\/(\d+)/.exec(url))) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
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
const videoPreviewField = StateField.define({
  create(s) { return buildVideoDecos(s); },
  update(d, tr) { return tr.docChanged ? buildVideoDecos(tr.state) : d; },
  provide: (f) => EditorView.decorations.from(f),
});
function buildVideoDecos(s) {
  const b = new RangeSetBuilder();
  for (let p = 0; p < s.doc.length;) {
    const line = s.doc.lineAt(p);
    const m = /^!?\[[^\]]*\]\(([^)\s]+)\)\s*$/.exec(line.text);
    if (m) {
      const embed = videoEmbedUrl(m[1]);
      if (embed) {
        b.add(line.to, line.to, Decoration.widget({
          widget: new VideoWidget(embed), side: 1, block: true,
        }));
      }
    }
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
      label: n.title || 'Untitled',
      type: 'note',
      apply: (v, _c, from, to) => {
        const insert = (n.title || 'Untitled') + ']]';
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
  const m = ctx.matchBefore(/(^|\n)\/\w*/);
  if (!m || (m.from === m.to && !ctx.explicit)) return null;
  const cmds = [
    { label: 'Heading 1', apply: '# ' },
    { label: 'Heading 2', apply: '## ' },
    { label: 'Heading 3', apply: '### ' },
    { label: 'Task', apply: '- [ ] ' },
    { label: 'Bullet', apply: '- ' },
    { label: 'Numbered', apply: '1. ' },
    { label: 'Quote', apply: '> ' },
    { label: 'Code block', apply: '```\n\n```' },
    { label: 'Table', apply: '| col | col |\n| --- | --- |\n|     |     |' },
    { label: 'Callout (Note)', apply: '> [!NOTE]\n> ' },
    { label: 'Callout (Tip)', apply: '> [!TIP]\n> ' },
    { label: 'Callout (Warning)', apply: '> [!WARNING]\n> ' },
    { label: 'Math (block)', apply: '$$\n\n$$' },
    { label: 'Wikilink', apply: '[[' },
    { label: 'Image', apply: 'IMAGE_INSERT' }, // handled separately
    { label: 'Shopping list link', apply: '[[' },
  ];
  // Skip the leading newline if present
  const from = m.from + (m.text.startsWith('\n') ? 1 : 0);
  return {
    from,
    options: cmds.map((c) => ({
      label: '/' + c.label.toLowerCase().replace(/\s+/g, '-'),
      detail: c.label,
      type: 'slash',
      apply: (view, completion, from, to) => {
        if (c.apply === 'IMAGE_INSERT') {
          view.dispatch({ changes: { from, to, insert: '' } });
          window.dispatchEvent(new CustomEvent('yanta-open-image-modal'));
          return;
        }
        view.dispatch({ changes: { from, to, insert: c.apply } });
      },
    })),
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
      if (types.includes('text/yanta-note') || types.includes('Files') ||
          types.includes('text/uri-list') || types.includes('text/x-moz-url') ||
          types.includes('text/plain')) {
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
      // A YANTA note drag → insert [[Title]] at drop position.
      const noteId = e.dataTransfer.getData('text/yanta-note');
      if (noteId) {
        e.preventDefault();
        const title = e.dataTransfer.getData('text/plain') || 'Note';
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

// ============================================================
// Public API — mount / swap / destroy editor.
// ============================================================
export function mountEditor(host, { noteId, awarenessUser }) {
  if (view) view.destroy();
  currentNoteId = noteId;
  const { doc } = getNoteDoc(noteId);
  const ytext = doc.getText('markdown');
  const collabExt = awarenessUser
    ? yCollab(ytext, awarenessUser.awareness, { undoManager: awarenessUser.undoManager })
    : yCollab(ytext, null);

  const exts = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(yantaHighlight),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
    taskCheckboxField,
    imagePreviewField,
    videoPreviewField,
    wikilinkClickHandler(),
    pasteHandler(),
    dropHandler(),
    EditorView.updateListener.of((u) => {
      if (u.selectionSet || u.focusChanged) {
        window.dispatchEvent(new CustomEvent('yanta-selection-change'));
      }
    }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
      { key: 'Mod-b', run: (v) => wrapSelection(v, '**', '**') },
      { key: 'Mod-i', run: (v) => wrapSelection(v, '*', '*') },
      { key: 'Mod-`', run: (v) => wrapSelection(v, '`', '`') },
    ]),
    placeholder('Start writing in Markdown… (type / for commands, [[ for links)'),
    themeCompartment.of(yantaTheme),
    collabCompartment.of(collabExt),
  ];

  // y-codemirror.next expects the initial editor doc to mirror the
  // Y.Text — it only syncs *future* changes from Y.Text into the editor.
  view = new EditorView({
    parent: host,
    state: EditorState.create({ doc: ytext.toString(), extensions: exts }),
  });
  return view;
}

export function getView() { return view; }

export function destroyEditor() {
  if (view) { view.destroy(); view = null; }
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
