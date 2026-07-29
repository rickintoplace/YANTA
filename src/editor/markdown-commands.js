// ============================================================
// YANTA — Markdown editing commands.
//
// One implementation of "make this bold / turn this into a heading /
// make these lines a list" for every surface that offers formatting:
// keyboard shortcuts, the floating selection toolbar, the note chrome
// menus and the command palette. Everything here is a plain CodeMirror
// `Command`: it receives the view, changes it, and reports whether it
// did anything.
//
// Two rules shape the behaviour, both aimed at "it did what I meant":
//
//   1. No selection is not "no target". Inline commands act on the word
//      under the cursor, line commands on the current paragraph. Ctrl+B
//      inside a word produces **word**, never Wo****rd.
//   2. Applying a format that is already there removes it. Formats
//      toggle instead of nesting, on every surface.
//
// Multi-cursor is supported throughout: inline commands go through
// changeByRange, line commands operate on the union of touched lines.
// ============================================================

import { ChangeSet, EditorSelection } from '@codemirror/state';

// ------------------------------------------------------------
// Inline marks
// ------------------------------------------------------------
// `chars` lists the delimiters we recognise when toggling off — the
// first one is what we write. `count` is how many of them make the
// mark. `emphasis` marks the */_ family, where a run of delimiters is
// shared between italic (1) and bold (2) and only the parity of the run
// tells them apart: `***x***` is both, `**x**` is bold only.
const INLINE_MARKS = {
  bold:          { chars: ['*', '_'], count: 2, emphasis: true },
  italic:        { chars: ['*', '_'], count: 1, emphasis: true },
  strikethrough: { chars: ['~'],      count: 2 },
  highlight:     { chars: ['='],      count: 2 },
  code:          { chars: ['`'],      count: 1 },
};

export const INLINE_MARK_KINDS = Object.keys(INLINE_MARKS);

// Longest delimiter run we ever need to look at (`***bold italic***`).
const MAX_RUN = 3;

/** Length of the identical `ch` run directly outside `[from, to)`, both sides. */
function outerRun(doc, from, to, ch) {
  let before = 0;
  while (before < MAX_RUN && from - before - 1 >= 0 &&
         doc.sliceString(from - before - 1, from - before) === ch) before++;

  let after = 0;
  while (after < MAX_RUN && to + after + 1 <= doc.length &&
         doc.sliceString(to + after, to + after + 1) === ch) after++;

  return Math.min(before, after);
}

/** Length of the identical `ch` run at both ends of `text`. */
function innerRun(text, ch) {
  let lead = 0;
  while (lead < MAX_RUN && text[lead] === ch) lead++;

  let tail = 0;
  while (tail < MAX_RUN && text[text.length - 1 - tail] === ch) tail++;

  // The delimiters must not overlap — `**` is not a bold empty string.
  if (lead + tail >= text.length) return 0;

  return Math.min(lead, tail);
}

function runCarriesMark(run, spec) {
  if (run < spec.count) return false;

  // In a */_ run, italic is present exactly when the run length is odd.
  return !(spec.emphasis && spec.count === 1 && run % 2 === 0);
}

/**
 * What an inline command should act on: the selection if there is one,
 * otherwise the word under the cursor, otherwise the bare caret.
 * `caret` keeps the cursor's offset inside the target so it can be
 * restored after the delimiters shift everything.
 */
function inlineTarget(state, range) {
  if (!range.empty) {
    return { from: range.from, to: range.to, caret: null };
  }

  const word = state.wordAt(range.head);

  if (word) {
    return { from: word.from, to: word.to, caret: range.head - word.from };
  }

  return { from: range.head, to: range.head, caret: 0 };
}

/** Where the cursor/selection belongs once the target moved by `shift`. */
function restoreRange(target, shift, length) {
  if (target.caret == null) {
    return EditorSelection.range(target.from + shift, target.from + shift + length);
  }

  return EditorSelection.cursor(target.from + shift + Math.min(target.caret, length));
}

/**
 * Toggle an inline mark (`bold`, `italic`, `strikethrough`, `highlight`,
 * `code`) over the selection, the word under the cursor, or — with
 * nothing to grab onto — around a fresh caret.
 */
export function toggleInlineMark(view, kind) {
  const spec = INLINE_MARKS[kind];
  if (!spec || !view || view.state.readOnly) return false;

  const { state } = view;

  view.dispatch({
    ...state.changeByRange((range) => markChangeForRange(state, range, spec)),
    userEvent: 'input.format',
    scrollIntoView: true,
  });

  view.focus();
  return true;
}

/** The changes and resulting range for one selection range. */
function markChangeForRange(state, range, spec) {
  const target = inlineTarget(state, range);
  const text = state.sliceDoc(target.from, target.to);
  const length = target.to - target.from;

  // Removal first, and across every recognised delimiter: `__word__`
  // must un-bold even though we only ever write `**`.
  for (const ch of spec.chars) {
    // `**word**` selected including its delimiters.
    if (runCarriesMark(innerRun(text, ch), spec)) {
      return {
        changes: [
          { from: target.from, to: target.from + spec.count },
          { from: target.to - spec.count, to: target.to },
        ],
        range: restoreRange(target, 0, length - 2 * spec.count),
      };
    }

    // Cursor or selection sits inside `**word**`.
    if (runCarriesMark(outerRun(state.doc, target.from, target.to, ch), spec)) {
      return {
        changes: [
          { from: target.from - spec.count, to: target.from },
          { from: target.to, to: target.to + spec.count },
        ],
        range: restoreRange(target, -spec.count, length),
      };
    }
  }

  const mark = spec.chars[0].repeat(spec.count);

  return {
    changes: [
      { from: target.from, insert: mark },
      { from: target.to, insert: mark },
    ],
    range: restoreRange(target, spec.count, length),
  };
}

// ------------------------------------------------------------
// Line prefixes
// ------------------------------------------------------------

const LINE_PREFIX_RE =
  /^([ \t]*)(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)?([\s\S]*)$/;

/**
 * Split a source line into indentation, block marker and body, and name
 * the block kind. Everything that rewrites lines goes through this so
 * the surfaces cannot drift apart on what counts as a list item.
 */
export function parseLine(text) {
  const [, indent = '', marker = '', body = ''] = LINE_PREFIX_RE.exec(text) || [];

  let kind = 'paragraph';
  let level = 0;

  if (/^#/.test(marker)) {
    kind = 'heading';
    level = marker.trim().length;
  } else if (/^>/.test(marker)) {
    kind = 'quote';
  } else if (/\[[ xX]\]/.test(marker)) {
    kind = 'task';
  } else if (/^[-*+]/.test(marker)) {
    kind = 'bullet';
  } else if (/^\d/.test(marker)) {
    kind = 'ordered';
  }

  return { indent, marker, body, kind, level, checked: /\[[xX]\]/.test(marker) };
}

/** Every line touched by any selection range, in document order, deduped. */
function selectedLines(state) {
  const lines = [];
  let last = -1;

  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;

    for (let n = Math.max(from, last + 1); n <= to; n++) {
      lines.push(state.doc.line(n));
      last = n;
    }
  }

  return lines;
}

/**
 * Rewrite the given lines. `fn` returns the new text for a line, or
 * `null` to leave it untouched.
 *
 * Every command here only ever edits the *prefix* of a line and leaves
 * the body intact, so a cursor inside the body has to travel with it by
 * exactly the length the prefix grew or shrank. Letting CodeMirror map
 * the position through a whole-line replacement instead would collapse
 * the cursor onto the line start — the caret would visibly jump every
 * time you pressed Ctrl+1.
 */
function rewriteLines(view, lines, fn) {
  if (!view || view.state.readOnly) return false;

  const { state } = view;
  const changes = [];
  const rewritten = new Map();

  lines.forEach((line, index) => {
    const next = fn(line, index);
    if (next == null || next === line.text) return;

    changes.push({ from: line.from, to: line.to, insert: next });
    rewritten.set(line.number, next);
  });

  if (!changes.length) return false;

  const changeSet = ChangeSet.of(changes, state.doc.length);

  const mapPoint = (pos) => {
    const line = state.doc.lineAt(pos);
    const next = rewritten.get(line.number);

    if (next == null) return changeSet.mapPos(pos);

    const offset = pos - line.from + (next.length - line.text.length);

    return changeSet.mapPos(line.from, -1) + Math.min(Math.max(offset, 0), next.length);
  };

  view.dispatch({
    changes,
    selection: EditorSelection.create(
      state.selection.ranges.map((r) => EditorSelection.range(mapPoint(r.anchor), mapPoint(r.head))),
      state.selection.mainIndex
    ),
    userEvent: 'input.format',
    scrollIntoView: true,
  });

  view.focus();

  return true;
}

/**
 * Lines a block command should actually touch: blank lines inside a
 * multi-line selection are left alone so a selected paragraph does not
 * grow a trail of empty bullets.
 */
function contentLines(lines) {
  const filled = lines.filter((line) => line.text.trim());
  return filled.length ? filled : lines;
}

// ------------------------------------------------------------
// Headings
// ------------------------------------------------------------

/**
 * Set the heading level of every touched line. `level` 0 clears the
 * heading; re-applying the level a line already has clears it too, so
 * Ctrl+2 on an H2 turns it back into a paragraph.
 */
export function setHeading(view, level) {
  if (!view) return false;

  const targets = contentLines(selectedLines(view.state));

  const alreadyAtLevel = level > 0 && targets.length > 0 && targets.every((line) => {
    const parsed = parseLine(line.text);
    return parsed.kind === 'heading' && parsed.level === level;
  });

  const next = alreadyAtLevel ? 0 : level;

  return rewriteLines(view, targets, (line) => {
    const { indent, body } = parseLine(line.text);

    // Markdown headings cannot be indented, so the indent goes with the
    // marker; paragraphs keep theirs.
    return next
      ? `${'#'.repeat(next)} ${body}`
      : indent + body;
  });
}

// ------------------------------------------------------------
// Lists and quotes
// ------------------------------------------------------------

function listMarker(kind, index) {
  if (kind === 'bullet') return '- ';
  if (kind === 'task') return '- [ ] ';
  if (kind === 'ordered') return `${index + 1}. `;
  if (kind === 'quote') return '> ';
  return '';
}

/**
 * Toggle every touched line into `kind` (`bullet`, `ordered`, `task` or
 * `quote`) — or back to a plain paragraph when they are all already
 * that kind. Ordered lists are renumbered from 1 across the selection.
 */
export function toggleBlockKind(view, kind) {
  if (!view) return false;

  const targets = contentLines(selectedLines(view.state));

  const alreadyKind = targets.length > 0 && targets.every(
    (line) => parseLine(line.text).kind === kind
  );

  let ordinal = 0;

  return rewriteLines(view, targets, (line) => {
    const { indent, body, checked } = parseLine(line.text);

    if (alreadyKind) return indent + body;

    const marker = listMarker(kind, ordinal++);

    // A checked task keeps its state when it is only re-labelled.
    if (kind === 'task' && checked) {
      return `${indent}- [x] ${body}`;
    }

    return indent + marker + body;
  });
}

/** Flip `- [ ]` ↔ `- [x]` on every touched task line. */
export function toggleTaskDone(view) {
  if (!view) return false;

  const targets = selectedLines(view.state)
    .filter((line) => parseLine(line.text).kind === 'task');

  if (!targets.length) return false;

  // Mixed selections resolve to "check everything" — the same rule the
  // selection toolbar uses.
  const allDone = targets.every((line) => parseLine(line.text).checked);

  return rewriteLines(view, targets, (line) => {
    return line.text.replace(
      /^(\s*[-*+]\s+\[)[ xX](\])/,
      (_, open, close) => open + (allDone ? ' ' : 'x') + close
    );
  });
}

// ------------------------------------------------------------
// Fenced code blocks
// ------------------------------------------------------------

const FENCE_RE = /^\s*(?:```|~~~)/;

/**
 * Wrap the touched lines in a fenced code block — or unwrap them when
 * they already sit between fences. With nothing selected this drops in
 * an empty block and parks the cursor inside it.
 */
export function toggleCodeBlock(view) {
  if (!view || view.state.readOnly) return false;

  const { state } = view;
  const lines = selectedLines(state);
  const first = lines[0];
  const last = lines[lines.length - 1];

  const above = first.number > 1 ? state.doc.line(first.number - 1) : null;
  const below = last.number < state.doc.lines ? state.doc.line(last.number + 1) : null;

  if (above && below && FENCE_RE.test(above.text) && FENCE_RE.test(below.text)) {
    view.dispatch({
      changes: [
        { from: above.from, to: first.from },
        { from: last.to, to: below.to },
      ],
      userEvent: 'input.format',
    });
    view.focus();
    return true;
  }

  const selection = state.selection.main;

  if (selection.empty && !first.text.trim()) {
    const insert = '```\n\n```';

    view.dispatch({
      changes: { from: first.from, to: first.to, insert },
      selection: { anchor: first.from + 4 },
      userEvent: 'input.format',
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  view.dispatch({
    changes: [
      { from: first.from, insert: '```\n' },
      { from: last.to, insert: '\n```' },
    ],
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  view.focus();

  return true;
}

// ------------------------------------------------------------
// Links
// ------------------------------------------------------------

/**
 * Insert `[text](url)` over the selection, the word under the cursor, or
 * at the caret. `fallbackText` is used when there is nothing to label.
 */
export function insertLink(view, url, fallbackText = 'link') {
  if (!view || !url || view.state.readOnly) return false;

  const { state } = view;

  view.dispatch({
    ...state.changeByRange((range) => {
      const target = inlineTarget(state, range);
      const label = state.sliceDoc(target.from, target.to) || fallbackText;
      const insert = `[${label}](${url})`;

      return {
        changes: { from: target.from, to: target.to, insert },
        range: EditorSelection.cursor(target.from + insert.length),
      };
    }),
    userEvent: 'input.format',
    scrollIntoView: true,
  });

  view.focus();
  return true;
}
