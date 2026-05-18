// ============================================================
// YANTA — Floating format toolbar.
// Appears whenever there is a non-empty selection in the editor.
// ============================================================

import { $ } from './core.js';
import { getView } from './editor.js';

let tb;
let raf = 0;
let applying = false;

export function setupFormatToolbar() {
  tb = $('formatToolbar');
  if (!tb) return;

  // Do not let toolbar clicks steal the CodeMirror selection.
  tb.addEventListener('mousedown', (e) => e.preventDefault());

  tb.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn) return;

    applying = true;
    applyFormat(btn.dataset.fmt);
    hide();

    // Avoid immediate re-open from the selectionchange fired by CM/browser.
    setTimeout(() => {
      applying = false;
      refreshSoon();
    }, 120);
  });

  window.addEventListener('yanta-selection-change', refreshSoon);
  document.addEventListener('selectionchange', refreshSoon);
  window.addEventListener('scroll', () => {
    if (!tb.hidden) refreshSoon();
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!tb || tb.hidden) return;
    if (tb.contains(e.target)) return;

    const v = getView();
    if (!v) {
      hide();
      return;
    }

    if (!v.dom.contains(e.target)) hide();
  }, true);
}

function refreshSoon() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(refresh);
}

function refresh() {
  if (applying) return;

  const v = getView();
  if (!v || !tb) {
    hide();
    return;
  }

  // If the editor is not focused, do not keep a stale toolbar open.
  if (!v.hasFocus && !tb.matches(':hover')) {
    hide();
    return;
  }

  const sel = v.state.selection.main;
  if (sel.empty) {
    hide();
    return;
  }

  const text = v.state.sliceDoc(sel.from, sel.to);
  const lines = text.split('\n');

  const allTasks = lines.length > 0 && lines.every((l) =>
    /^\s*[-*+]\s+\[[ xX]\]/.test(l) || l.trim() === ''
  );
  const allBullets = lines.length > 0 && lines.every((l) =>
    /^\s*[-*+]\s+/.test(l) || l.trim() === ''
  );
  const allOrdered = lines.length > 0 && lines.every((l) =>
    /^\s*\d+\.\s+/.test(l) || l.trim() === ''
  );
  const isMultiline = lines.length > 1;

  const html = [];
  const btn = (fmt, label, title) =>
    `<button data-fmt="${fmt}" title="${title || label}">${label}</button>`;

  if (allTasks) {
    html.push(btn('tasks-toggle', '☑', 'Toggle all done'));
    html.push(btn('to-bullets', '•', 'Convert to bullets'));
    html.push(btn('to-numbered', '1.', 'Convert to numbered'));
  } else if (allBullets) {
    html.push(btn('to-tasks', '☐', 'Make tasks'));
    html.push(btn('to-numbered', '1.', 'Make numbered'));
  } else if (allOrdered) {
    html.push(btn('to-tasks', '☐', 'Make tasks'));
    html.push(btn('to-bullets', '•', 'Make bullets'));
  } else if (isMultiline) {
    html.push(btn('to-tasks', '☐ Tasks', 'Make tasks'));
    html.push(btn('to-bullets', '• Bullets', 'Make bullets'));
    html.push(btn('to-numbered', '1. Numbered', 'Make numbered'));
    html.push(btn('quote', 'Quote', 'Quote'));
    html.push(btn('code-block', '{ }', 'Code block'));
  } else {
    html.push(btn('bold', 'B', 'Bold'));
    html.push(btn('italic', 'I', 'Italic'));
    html.push(btn('code', '</>', 'Inline code'));
    html.push(btn('strike', 'S', 'Strikethrough'));
    html.push('<span class="sep"></span>');
    html.push(btn('h1', 'H1', 'Heading 1'));
    html.push(btn('h2', 'H2', 'Heading 2'));
    html.push(btn('h3', 'H3', 'Heading 3'));
    html.push('<span class="sep"></span>');
    html.push(btn('quote', '“”', 'Quote'));
    html.push(btn('to-bullets', '•', 'Bullet'));
    html.push(btn('to-tasks', '☐', 'Task'));
    html.push(btn('link', '🔗', 'Link'));
  }

  tb.innerHTML = html.join('');
  tb.hidden = false;

  const coordsFrom = v.coordsAtPos(sel.from);
  const coordsTo = v.coordsAtPos(sel.to);
  if (!coordsFrom || !coordsTo) {
    hide();
    return;
  }

  requestAnimationFrame(() => {
    if (!tb || tb.hidden) return;

    const tw = tb.offsetWidth;
    const th = tb.offsetHeight;
    const cx = (coordsFrom.left + coordsTo.right) / 2;

    let x = Math.max(8, Math.min(window.innerWidth - tw - 8, cx - tw / 2));
    let y = coordsFrom.top - th - 8;

    if (y < 8) y = coordsTo.bottom + 8;

    tb.style.left = x + 'px';
    tb.style.top = y + 'px';
  });
}

function hide() {
  if (tb) tb.hidden = true;
}

function applyFormat(fmt) {
  const v = getView();
  if (!v) return;

  const sel = v.state.selection.main;
  const wraps = { bold: '**', italic: '*', strike: '~~', code: '`' };

  if (wraps[fmt]) {
    const text = v.state.sliceDoc(sel.from, sel.to);
    const open = wraps[fmt];
    const close = wraps[fmt];
    const insert = open + text + close;

    v.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + insert.length },
    });
    v.focus();
    return;
  }

  if (fmt === 'link') {
    const url = prompt('URL:', 'https://');
    if (!url) return;

    const text = v.state.sliceDoc(sel.from, sel.to) || 'link';
    const insert = `[${text}](${url})`;

    v.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + insert.length },
    });
    v.focus();
    return;
  }

  if (fmt === 'code-block') {
    const text = v.state.sliceDoc(sel.from, sel.to);
    const insert = '```\n' + text + '\n```';

    v.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + insert.length },
    });
    v.focus();
    return;
  }

  rewriteLines(v, sel, (line, idx) => {
    if (fmt === 'h1') return setHeading(line, 1);
    if (fmt === 'h2') return setHeading(line, 2);
    if (fmt === 'h3') return setHeading(line, 3);
    if (fmt === 'quote') return ensurePrefix(line, '> ');
    if (fmt === 'to-tasks') return convertTo(line, 'task');
    if (fmt === 'to-bullets') return convertTo(line, 'bullet');
    if (fmt === 'to-numbered') return convertTo(line, 'ordered', idx);
    if (fmt === 'tasks-toggle') return toggleTaskLine(line);
    return line;
  });
}

function rewriteLines(v, sel, fn) {
  const fromLine = v.state.doc.lineAt(sel.from);
  const toLine = v.state.doc.lineAt(sel.to);
  const newLines = [];

  for (let n = fromLine.number, i = 0; n <= toLine.number; n++, i++) {
    newLines.push(fn(v.state.doc.line(n).text, i));
  }

  const insert = newLines.join('\n');

  v.dispatch({
    changes: { from: fromLine.from, to: toLine.to, insert },
    selection: { anchor: fromLine.from + insert.length },
  });

  v.focus();
}

function setHeading(line, level) {
  const stripped = stripLinePrefix(line);
  return '#'.repeat(level) + ' ' + stripped.trimStart();
}

function ensurePrefix(line, p) {
  const stripped = stripLinePrefix(line);
  return p + stripped.trimStart();
}

function stripLinePrefix(line) {
  return line.replace(/^(\s*)(#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)?/, '$1');
}

function convertTo(line, kind, idx = 0) {
  const m = /^(\s*)(?:#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)?(.*)$/.exec(line);
  const indent = m?.[1] || '';
  const body = m?.[2] || '';

  if (kind === 'task') return indent + '- [ ] ' + body;
  if (kind === 'bullet') return indent + '- ' + body;
  if (kind === 'ordered') return indent + (idx + 1) + '. ' + body;

  return line;
}

function toggleTaskLine(line) {
  return line.replace(
    /(^\s*[-*+]\s+\[)([ xX])(\])/,
    (_, a, c, d) => a + (c.toLowerCase() === 'x' ? ' ' : 'x') + d
  );
}