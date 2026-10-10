// ============================================================
// YANTA — tables in the note editor
//
// Pipe tables stay plain markdown, but they no longer have to be typed
// like a puzzle:
//
//   - Tab / Shift+Tab move between cells and re-align the columns on the
//     way; Tab in the last cell adds a row.
//   - Enter in a row adds the next row below; Enter in an empty last row
//     leaves the table (as in a list).
//   - A small grid button on the header row opens the table as a grid
//     (table-editor.js): rows, columns, alignment, sorting, paste from a
//     spreadsheet — useful above all on a phone.
//
// Inspired by spreadsheet-style markdown table editors such as
// interactive-markdown-table-editor; the text remains the source of truth.
// ============================================================

import { Prec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view';

import { lucide } from '../core.js';
import { t } from '../i18n/index.js';

import {
  cellIndexAt,
  cellStartColumn,
  formatTable,
  isRowLine,
  isSeparatorLine,
  insertRow,
  tableAt,
} from './markdown-table.js';

/** The table around `pos`, with its line numbers (1-based, inclusive). */
export function tableRangeAt(state, pos) {
  const line = state.doc.lineAt(pos);
  if (!isRowLine(line.text)) return null;

  let from = line.number;
  let to = line.number;
  while (from > 1 && isRowLine(state.doc.line(from - 1).text)) from--;
  while (to < state.doc.lines && isRowLine(state.doc.line(to + 1).text)) to++;

  const lines = [];
  for (let n = from; n <= to; n++) lines.push(state.doc.line(n).text);

  const table = tableAt(lines, line.number - from);
  if (!table) return null;

  return {
    table,
    fromLine: from,
    toLine: to,
    from: state.doc.line(from).from,
    to: state.doc.line(to).to,
    rowIndex: line.number - from, // 0 header, 1 separator, 2… data rows
    cell: cellIndexAt(line.text, pos - line.from),
  };
}

/**
 * Writes `table` over the range and puts the caret into cell
 * (`row` = line index inside the table, `cell`), selecting its text so
 * typing replaces it — the way a spreadsheet moves between cells.
 */
function writeTable(view, range, table, row, cell) {
  const text = formatTable(table);
  const lines = text.split('\n');
  const target = Math.max(0, Math.min(row, lines.length - 1));

  let offset = 0;
  for (let i = 0; i < target; i++) offset += lines[i].length + 1;

  const lineText = lines[target];
  const start = cellStartColumn(lineText, cell);
  let end = start;
  while (end < lineText.length && lineText[end] !== '|') end++;
  while (end > start && lineText[end - 1] === ' ') end--;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + offset + start, head: range.from + offset + end },
    scrollIntoView: true,
    userEvent: 'input.table',
  });
}

function moveCell(view, direction) {
  const { state } = view;
  const range = tableRangeAt(state, state.selection.main.head);
  if (!range) return false;

  const columns = range.table.headers.length;
  const dataRows = range.table.rows.length;

  let row = range.rowIndex === 1 ? (direction > 0 ? 2 : 0) : range.rowIndex;
  let cell = range.rowIndex === 1 ? (direction > 0 ? -1 : columns) : range.cell;
  let table = range.table;

  cell += direction;

  if (cell >= columns) {
    cell = 0;
    row = row === 0 ? 2 : row + 1;

    // Tab out of the last cell: a new row, like a spreadsheet.
    if (row > dataRows + 1) table = insertRow(table, dataRows);
  } else if (cell < 0) {
    if (row === 0) return true;
    cell = columns - 1;
    row = row === 2 ? 0 : row - 1;
  }

  writeTable(view, range, table, row, cell);
  return true;
}

function enterInTable(view) {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const range = tableRangeAt(state, sel.head);
  if (!range || range.rowIndex === 1) return false;

  const rowIndex = range.rowIndex;
  const dataIndex = rowIndex - 2;
  const isLastRow = dataIndex === range.table.rows.length - 1;
  const rowEmpty = dataIndex >= 0 && range.table.rows[dataIndex].every((c) => !c.trim());

  // Enter on an empty last row leaves the table, like Enter on an empty list item.
  if (isLastRow && rowEmpty) {
    const rows = range.table.rows.slice(0, -1);
    const text = formatTable({ ...range.table, rows });
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: `${text}\n` },
      selection: { anchor: range.from + text.length + 1 },
      scrollIntoView: true,
      userEvent: 'input.table',
    });
    return true;
  }

  const table = insertRow(range.table, Math.max(0, dataIndex + 1));
  writeTable(view, range, table, Math.max(2, rowIndex + 1), 0);
  return true;
}

class TableButtonWidget extends WidgetType {
  constructor(pos) {
    super();
    this.pos = pos;
  }

  eq(other) {
    return other.pos === this.pos;
  }

  toDOM(view) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-table-edit-btn';
    btn.title = t('table.editGrid');
    btn.setAttribute('aria-label', t('table.editGrid'));
    btn.innerHTML = lucide('table-2', 14);
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { openTableEditor } = await import('./table-editor.js');
      openTableEditor(view, this.pos);
    });
    return btn;
  }

  ignoreEvent() {
    return true;
  }
}

function buttonDecorations(view) {
  const widgets = [];
  const { doc } = view.state;

  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);

    while (line.from <= to) {
      if (
        isRowLine(line.text) &&
        line.number < doc.lines &&
        isSeparatorLine(doc.line(line.number + 1).text) &&
        (line.number === 1 || !isRowLine(doc.line(line.number - 1).text))
      ) {
        widgets.push(Decoration.widget({ widget: new TableButtonWidget(line.from), side: 1 }).range(line.to));
      }

      if (line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }

  return Decoration.set(widgets, true);
}

const tableButtons = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = buttonDecorations(view);
  }

  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buttonDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

const tableTheme = EditorView.baseTheme({
  '.cm-table-edit-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    verticalAlign: 'middle',
    width: '24px',
    height: '22px',
    marginLeft: '8px',
    padding: '0',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--bg-elev)',
    color: 'var(--text-faint)',
    cursor: 'pointer',
  },
  '.cm-table-edit-btn:hover': {
    color: 'var(--accent)',
    borderColor: 'var(--border-strong)',
  },
});

export function tableEditing() {
  return [
    // Above the completion/indent Tab and the list-continuing Enter.
    Prec.high(keymap.of([
      { key: 'Tab', run: (view) => moveCell(view, 1) },
      { key: 'Shift-Tab', run: (view) => moveCell(view, -1) },
      { key: 'Enter', run: enterInTable },
    ])),
    tableButtons,
    tableTheme,
  ];
}
