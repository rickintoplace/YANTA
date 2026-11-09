// ============================================================
// YANTA — writing without seeing Markdown
//
// The note stays Markdown underneath (files, sync, export, AI all read
// it), but nobody should have to know Markdown to write one. Away from
// the cursor, the editor shows what the text means: a heading is large
// without its "#", bold is bold without "**", a link is its text, a list
// item has a bullet, a task a checkbox. On the line the cursor is on, the
// characters come back, so nothing is hidden from someone who wants it —
// the way Obsidian, Bear and Typora do it.
//
// Line-based like the rest of editor-cm.js (classifyLine from
// markdown.js), so a line is either shown as written or as meant.
// ============================================================

import { RangeSetBuilder, StateField, StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, WidgetType } from '@codemirror/view';
import { classifyLine } from '../markdown.js';

// ---------------- widgets ----------------------------------------------

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'yanta-live-bullet';
    el.textContent = '•';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  ignoreEvent() { return false; }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'yanta-live-rule';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  ignoreEvent() { return false; }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const hide = Decoration.replace({});

// ---------------- which lines show their characters ----------------------

/** Lines the cursor or a selection touches (only while the editor has focus). */
function revealedLines(view) {
  const lines = new Set();
  if (!view.hasFocus) return lines;
  const doc = view.state.doc;
  for (const r of view.state.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

// ---------------- what to hide on one line --------------------------------

/*
  Ranges (relative to the line) to hide or replace, never overlapping.
  Inline code is found first: nothing inside it is Markdown.
*/
export function lineRanges(text, info) {
  const out = [];
  const taken = [];
  const free = (a, b) => !taken.some((r) => a < r.to && b > r.from);
  const add = (from, to, deco = hide) => {
    if (to <= from || !free(from, to)) return false;
    out.push({ from, to, deco });
    taken.push({ from, to });
    return true;
  };
  const block = (from, to) => taken.push({ from, to });
  let m;

  // ---- what the line is
  if (/^h[1-6]$/.test(info.type) && (m = /^(#{1,6}\s+)/.exec(text))) add(0, m[1].length);
  else if (info.type === 'quote' && (m = /^(\s*>\s?)/.exec(text))) add(0, m[1].length);
  else if (info.type === 'hr') return [{ from: 0, to: text.length, deco: rule }];
  else if (info.type === 'task' && (m = /^(\s*)([-*+]\s+\[)([ xX])(\]\s?)/.exec(text))) {
    // The checkbox itself is drawn by the task plugin over [ ]'s middle character.
    const open = m[1].length;
    const box = open + m[2].length;
    add(open, box);
    block(box, box + 1);
    add(box + 1, box + 1 + m[4].length);
  } else if (info.type === 'ul' && (m = /^(\s*)([-*+])(\s+)/.exec(text))) {
    add(m[1].length, m[1].length + 1, bullet);
  } else if (info.type === 'image') {
    // The picture is drawn below the line; the line itself is just its address.
    return [{ from: 0, to: text.length, deco: hide }];
  }

  // ---- inline
  const codeRe = /(`+)([^`\n]+?)\1/g;
  while ((m = codeRe.exec(text))) {
    const a = m.index;
    const b = a + m[0].length;
    if (!free(a, b)) continue;
    add(a, a + m[1].length);
    add(b - m[1].length, b);
    block(a + m[1].length, b - m[1].length);
  }

  // [[target]] and [[target|shown text]]
  const wikiRe = /\[\[([^\]|\n]+)(\|[^\]\n]+)?\]\]/g;
  while ((m = wikiRe.exec(text))) {
    const a = m.index;
    const b = a + m[0].length;
    if (!free(a, b)) continue;
    if (m[2]) add(a, a + 2 + m[1].length + 1);
    else add(a, a + 2);
    add(b - 2, b);
    block(a, b);
  }

  // [text](url) — the text stays, styled as a link; images are lines of their own.
  const linkRe = /(?<!!)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = linkRe.exec(text))) {
    const a = m.index;
    const b = a + m[0].length;
    if (!free(a, b)) continue;
    add(a, a + 1);
    add(a + 1 + m[1].length, b);
    block(a, b);
  }

  // Emphasis: markers on both sides, never across words in identifiers.
  const pairs = [
    [/(\*\*\*|___)(?=\S)(.+?)(?<=\S)\1/g, 3],
    [/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, 2],
    [/(~~)(?=\S)(.+?)(?<=\S)\1/g, 2],
    [/(==)(?=\S)(.+?)(?<=\S)\1/g, 2],
    [/(?<![*\w])(\*)(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\w])/g, 1],
    [/(?<![_\w])(_)(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![_\w])/g, 1],
  ];
  for (const [re, n] of pairs) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const a = m.index;
      const b = a + m[0].length;
      if (!free(a, a + n) || !free(b - n, b)) continue;
      add(a, a + n);
      add(b - n, b);
    }
  }

  return out.sort((x, y) => x.from - y.from);
}

// ---------------- the plugin ---------------------------------------------

function fenceStateBefore(doc, pos) {
  let inFence = false;
  for (let p = 0; p < pos;) {
    const line = doc.lineAt(p);
    if (/^```/.test(line.text)) inFence = !inFence;
    if (line.to >= doc.length) break;
    p = line.to + 1;
  }
  return inFence;
}

const inlinePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }

  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) {
      this.decorations = this.build(u.view);
    }
  }

  build(view) {
    const b = new RangeSetBuilder();
    const doc = view.state.doc;
    const shown = revealedLines(view);

    for (const range of view.visibleRanges) {
      const first = doc.lineAt(range.from);
      const ctx = { inFence: fenceStateBefore(doc, first.from) };
      for (let p = first.from; p <= range.to;) {
        const line = doc.lineAt(p);
        const info = classifyLine(line.text, ctx);
        if (info.type === 'fence') ctx.inFence = !!info.opens;
        const skip = shown.has(line.number) || info.type === 'code' || info.type === 'fence' || info.type === 'table';
        if (!skip) {
          for (const r of lineRanges(line.text, info)) b.add(line.from + r.from, line.from + r.to, r.deco);
        }
        if (line.to >= doc.length) break;
        p = line.to + 1;
      }
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

// ---------------- the title, said once ------------------------------------

/*
  A note whose text starts with "# Its title" shows that title twice:
  in the title field above and as the first line. Away from the cursor
  the first line is left out (it stays in the Markdown).
*/
export const refreshLiveTitle = StateEffect.define();

function titleField(getTitle) {
  const build = (state, focused) => {
    const doc = state.doc;
    const first = doc.line(1);
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(first.text);
    const title = String(getTitle() || '').trim().toLowerCase();
    if (!m || !title || m[1].trim().toLowerCase() !== title) return Decoration.none;
    const head = state.selection.main.head;
    if (focused && head <= first.to) return Decoration.none;
    const to = doc.lines > 1 ? doc.line(2).from : first.to;
    return Decoration.set([Decoration.replace({ block: true }).range(first.from, to)]);
  };

  const focusState = StateField.define({
    create: () => false,
    update: (value, tr) => {
      for (const e of tr.effects) if (e.is(focusEffect)) return e.value;
      return value;
    },
  });

  const field = StateField.define({
    create: (state) => build(state, false),
    update(deco, tr) {
      if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshLiveTitle) || e.is(focusEffect))) {
        return build(tr.state, tr.state.field(focusState));
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [focusState, field];
}

const focusEffect = StateEffect.define();
const focusTracker = EditorView.focusChangeEffect.of((_state, focusing) => focusEffect.of(focusing));

/** The extension; `getTitle()` returns the open note's title. */
export function livePreview({ getTitle = () => '' } = {}) {
  return [
    inlinePlugin,
    titleField(getTitle),
    focusTracker,
    EditorView.editorAttributes.of({ class: 'yanta-live' }),
  ];
}
