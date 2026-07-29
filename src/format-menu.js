// ============================================================
// YANTA — Floating format toolbar.
// Appears whenever there is a non-empty selection in the editor.
//
// The buttons carry no formatting logic of their own: every one of them
// runs the same command the keyboard shortcut does, so the toolbar and
// the shortcuts can never disagree about what "make this a list" means.
// See editor/markdown-commands.js.
// ============================================================

import { $ } from './core.js';
import { getView } from './editor.js';
import {
  editorShortcutsFor,
  formatChord,
  runEditorCommand,
} from './editor/editor-shortcuts.js';
import { parseLine } from './editor/markdown-commands.js';
import { t } from './i18n/index.js';

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

    applyEditorFormat(btn.dataset.fmt);

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

  const everyLineIs = (kind) => lines.every(
    (l) => !l.trim() || parseLine(l).kind === kind
  );

  const allTasks = everyLineIs('task');
  const allBullets = everyLineIs('bullet');
  const allOrdered = everyLineIs('ordered');
  const isMultiline = lines.length > 1;

  const html = [];
  const btn = (fmt, label, title) =>
    `<button data-fmt="${fmt}" title="${escapeAttr(withChord(fmt, title || label))}">${label}</button>`;

  if (allTasks) {
    html.push(btn('tasks-toggle', '☑', t('format.toggleAllDone')));
    html.push(btn('to-bullets', '•', t('format.convertToBullets')));
    html.push(btn('to-numbered', '1.', t('format.convertToNumbered')));
  } else if (allBullets) {
    html.push(btn('to-tasks', '☐', t('format.makeTasks')));
    html.push(btn('to-numbered', '1.', t('format.makeNumbered')));
  } else if (allOrdered) {
    html.push(btn('to-tasks', '☐', t('format.makeTasks')));
    html.push(btn('to-bullets', '•', t('format.makeBullets')));
  } else if (isMultiline) {
    html.push(btn('to-tasks', '☐ ' + t('format.tasks'), t('format.makeTasks')));
    html.push(btn('to-bullets', '• ' + t('format.bullets'), t('format.makeBullets')));
    html.push(btn('to-numbered', '1. ' + t('format.numbered'), t('format.makeNumbered')));
    html.push(btn('quote', t('format.quote'), t('format.quote')));
    html.push(btn('code-block', '{ }', t('format.codeBlock')));
  } else {
    html.push(btn('bold', 'B', t('format.bold')));
    html.push(btn('italic', 'I', t('format.italic')));
    html.push(btn('code', '</>', t('format.inlineCode')));
    html.push(btn('strike', 'S', t('format.strikethrough')));
    html.push('<span class="sep"></span>');
    html.push(btn('h1', 'H1', t('format.heading1')));
    html.push(btn('h2', 'H2', t('format.heading2')));
    html.push(btn('h3', 'H3', t('format.heading3')));
    html.push('<span class="sep"></span>');
    html.push(btn('quote', '“”', t('format.quote')));
    html.push(btn('to-bullets', '•', t('format.bullet')));
    html.push(btn('to-tasks', '☐', t('format.task')));
    html.push(btn('link', '🔗', t('format.link')));
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

// Tooltips carry user-recorded chords, which can contain quotes.
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ------------------------------------------------------------
// Format ids → editor commands
// ------------------------------------------------------------
// The short ids are what the toolbar markup and the note chrome menus
// have always used; they stay as the stable vocabulary of those
// surfaces and map onto the shared command registry here.
const FORMAT_COMMANDS = {
  bold: 'bold',
  italic: 'italic',
  strike: 'strikethrough',
  code: 'inlineCode',
  highlight: 'highlight',
  link: 'link',

  h1: 'heading1',
  h2: 'heading2',
  h3: 'heading3',
  'clear-heading': 'paragraph',

  quote: 'quote',
  'to-bullets': 'bulletList',
  'to-numbered': 'numberedList',
  'to-tasks': 'taskList',
  'tasks-toggle': 'toggleTaskDone',
  'code-block': 'codeBlock',
};

/** Display form of the chord bound to a format id, or '' when unbound. */
export function formatShortcutHint(fmt) {
  const [chord] = editorShortcutsFor(FORMAT_COMMANDS[fmt]);
  return chord ? formatChord(chord) : '';
}

/** Appends the bound shortcut to a tooltip, when the command has one. */
function withChord(fmt, label) {
  const hint = formatShortcutHint(fmt);
  return hint ? `${label} · ${hint}` : label;
}

/** Runs a toolbar/menu format action against the live editor. */
export function applyEditorFormat(fmt) {
  return runEditorCommand(getView(), FORMAT_COMMANDS[fmt]);
}
