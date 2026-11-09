// ============================================================
// YANTA — the table as a grid
//
// Opens a pipe table from the note in a spreadsheet-like editor: one field
// per cell, menus on each column and row (insert, move, delete, align,
// sort), paste straight from a spreadsheet, and "Apply" writes the table
// back as aligned markdown. On a phone it is the comfortable way to edit
// a table at all; on a desktop it is the quick way to restructure one.
// ============================================================

import { el, lucide, escapeHtml } from '../core.js';
import { getLocale, t } from '../i18n/index.js';
import { openSurface } from '../ui/surface.js';

import {
  deleteColumn,
  deleteRow,
  formatTable,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  normalize,
  parseTsv,
  setAlign,
  sortByColumn,
} from './markdown-table.js';

import { tableRangeAt } from './table-cm.js';

async function menu(anchor, items) {
  const { showMenu } = await import('../tree.js');
  const r = anchor.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, items);
}

/** Opens the table that contains `pos` in the grid editor. */
export function openTableEditor(view, pos) {
  const range = tableRangeAt(view.state, pos);
  if (!range) return;

  // Where the table stands now; re-checked before writing back.
  const original = view.state.sliceDoc(range.from, range.to);
  let table = normalize(range.table);
  let focus = { row: -1, col: 0 };

  const dialog = openSurface({
    kind: 'dialog',
    title: t('table.title'),
    width: 1000,
    className: 'yte',
    historyId: 'table-editor',
    footer: true,
    onClose: () => view.focus(),
  });

  const close = () => dialog.close();

  const apply = () => {
    const current = tableRangeAt(view.state, Math.min(range.from, view.state.doc.length));

    // The note changed underneath (sync, another tab): find the table again.
    const target = current && view.state.sliceDoc(current.from, current.to) === original ? current : range;

    view.dispatch({
      changes: { from: target.from, to: target.to, insert: formatTable(table) },
      userEvent: 'input.table',
    });

    close();
  };

  dialog.root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      apply();
    }
  });

  const update = (next, nextFocus = focus) => {
    table = next;
    focus = nextFocus;
    render();
  };

  const columnMenu = (anchor, col) => menu(anchor, [
    { label: t('table.alignLeft'), icon: 'align-left', action: () => update(setAlign(table, col, 'left')) },
    { label: t('table.alignCenter'), icon: 'align-center', action: () => update(setAlign(table, col, 'center')) },
    { label: t('table.alignRight'), icon: 'align-right', action: () => update(setAlign(table, col, 'right')) },
    'hr',
    { label: t('table.sortAsc'), icon: 'arrow-down-a-z', action: () => update(sortByColumn(table, col, 'asc', getLocale())) },
    { label: t('table.sortDesc'), icon: 'arrow-up-z-a', action: () => update(sortByColumn(table, col, 'desc', getLocale())) },
    'hr',
    { label: t('table.insertLeft'), icon: 'between-vertical-start', action: () => update(insertColumn(table, col), { row: -1, col }) },
    { label: t('table.insertRight'), icon: 'between-vertical-end', action: () => update(insertColumn(table, col + 1), { row: -1, col: col + 1 }) },
    { label: t('table.moveLeft'), icon: 'arrow-left', disabled: col === 0, action: () => update(moveColumn(table, col, col - 1), { row: -1, col: col - 1 }) },
    { label: t('table.moveRight'), icon: 'arrow-right', disabled: col === table.headers.length - 1, action: () => update(moveColumn(table, col, col + 1), { row: -1, col: col + 1 }) },
    'hr',
    { label: t('table.deleteColumn'), icon: 'trash-2', danger: true, disabled: table.headers.length <= 1, action: () => update(deleteColumn(table, col), { row: -1, col: Math.max(0, col - 1) }) },
  ]);

  const rowMenu = (anchor, row) => menu(anchor, [
    { label: t('table.insertAbove'), icon: 'between-horizontal-start', action: () => update(insertRow(table, row), { row, col: 0 }) },
    { label: t('table.insertBelow'), icon: 'between-horizontal-end', action: () => update(insertRow(table, row + 1), { row: row + 1, col: 0 }) },
    { label: t('table.moveUp'), icon: 'arrow-up', disabled: row === 0, action: () => update(moveRow(table, row, row - 1), { row: row - 1, col: 0 }) },
    { label: t('table.moveDown'), icon: 'arrow-down', disabled: row === table.rows.length - 1, action: () => update(moveRow(table, row, row + 1), { row: row + 1, col: 0 }) },
    'hr',
    { label: t('table.deleteRow'), icon: 'trash-2', danger: true, action: () => update(deleteRow(table, row), { row: Math.min(row, table.rows.length - 2), col: 0 }) },
  ]);

  function cellInput(value, row, col) {
    const input = el('input', {
      type: 'text',
      value,
      'data-row': String(row),
      'data-col': String(col),
      'data-align': table.align[col] || 'left',
      'aria-label': row < 0 ? t('table.headerCell', { col: col + 1 }) : t('table.cell', { row: row + 1, col: col + 1 }),
    });

    input.addEventListener('input', () => {
      if (row < 0) table.headers[col] = input.value;
      else table.rows[row][col] = input.value;
    });

    input.addEventListener('focus', () => {
      focus = { row, col };
    });

    // A block copied from a spreadsheet fills the grid from this cell on.
    input.addEventListener('paste', (e) => {
      const grid = parseTsv(e.clipboardData?.getData('text/plain'));
      if (!grid) return;
      e.preventDefault();

      let next = table;
      const startRow = Math.max(0, row);
      while (next.rows.length < startRow + grid.length - (row < 0 ? 1 : 0)) next = insertRow(next, next.rows.length);
      while (next.headers.length < col + Math.max(...grid.map((r) => r.length))) next = insertColumn(next, next.headers.length);

      grid.forEach((cells, i) => {
        cells.forEach((value, j) => {
          if (row < 0 && i === 0) next.headers[col + j] = value.trim();
          else next.rows[(row < 0 ? -1 : row) + i][col + j] = value.trim();
        });
      });

      update(next);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        // Down a row; off the bottom adds one.
        if (row >= table.rows.length - 1) update(insertRow(table, table.rows.length), { row: table.rows.length, col });
        else focusCell(row + 1, col);
      }
    });

    return input;
  }

  function focusCell(row, col) {
    dialog.body.querySelector(`input[data-row="${row}"][data-col="${col}"]`)?.focus();
  }

  function render() {
    const cols = table.headers.length;

    const thead = el('thead', {},
      el('tr', {},
        el('th', { class: 'ctl' }),
        ...table.headers.map((_, col) => {
          const btn = el('button', { type: 'button', class: 'yte-ctl', title: t('table.columnMenu'), 'aria-label': t('table.columnMenu') });
          btn.innerHTML = lucide('chevron-down', 14);
          btn.addEventListener('click', () => columnMenu(btn, col));
          return el('th', { class: 'ctl' }, btn);
        })
      ),
      el('tr', {},
        el('th', { class: 'ctl' }),
        ...table.headers.map((value, col) => el('th', {}, cellInput(value, -1, col)))
      )
    );

    const tbody = el('tbody', {},
      ...table.rows.map((cells, row) => {
        const btn = el('button', { type: 'button', class: 'yte-ctl', title: t('table.rowMenu'), 'aria-label': t('table.rowMenu') });
        btn.innerHTML = lucide('grip-vertical', 14);
        btn.addEventListener('click', () => rowMenu(btn, row));
        return el('tr', {},
          el('td', { class: 'ctl' }, btn),
          ...cells.slice(0, cols).map((value, col) => el('td', {}, cellInput(value, row, col)))
        );
      })
    );

    const addRow = el('button', { type: 'button', class: 'btn' });
    addRow.innerHTML = `${lucide('plus', 14)} ${escapeHtml(t('table.addRow'))}`;
    addRow.addEventListener('click', () => update(insertRow(table, table.rows.length), { row: table.rows.length, col: 0 }));

    const addCol = el('button', { type: 'button', class: 'btn' });
    addCol.innerHTML = `${lucide('plus', 14)} ${escapeHtml(t('table.addColumn'))}`;
    addCol.addEventListener('click', () => update(insertColumn(table, cols), { row: -1, col: cols }));

    dialog.body.replaceChildren(
      el('div', { class: 'yte-scroll' }, el('table', { class: 'yte-grid' }, thead, tbody)),
      el('div', { class: 'yte-add' }, addRow, addCol)
    );

    requestAnimationFrame(() => focusCell(focus.row, focus.col));
  }

  const cancel = el('button', { type: 'button', class: 'btn' }, t('common.cancel'));
  cancel.addEventListener('click', close);

  const applyBtn = el('button', { type: 'button', class: 'btn primary', title: 'Ctrl+Enter' }, t('table.apply'));
  applyBtn.addEventListener('click', apply);

  dialog.foot.append(el('span', { class: 'ys-grow' }), cancel, applyBtn);
  render();
}
