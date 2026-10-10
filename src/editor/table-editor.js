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
import { openBoundOverlay } from '../overlay-history.js';

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

let cssInjected = false;

function ensureCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-table-editor-css';
  style.textContent = `
.yanta-table-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.42);
}

.yanta-table-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(1000px, 100%);
  max-height: min(820px, 100%);
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--bg-elev);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.yanta-table-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.yanta-table-head strong {
  flex: 1;
  color: var(--text);
  font-size: 15px;
}

.yanta-table-scroll {
  overflow: auto;
  padding: 12px;
}

.yanta-table-grid {
  border-collapse: separate;
  border-spacing: 0;
}

.yanta-table-grid td,
.yanta-table-grid th {
  padding: 0;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.yanta-table-grid tr:first-child th { border-top: 1px solid var(--border); }
.yanta-table-grid th:first-child,
.yanta-table-grid td:first-child { border-left: 1px solid var(--border); }

.yanta-table-grid .ctl {
  border: 0 !important;
  background: transparent;
  text-align: center;
}

.yanta-table-grid input {
  display: block;
  width: 100%;
  min-width: 120px;
  padding: 8px 10px;
  border: 0;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  outline: none;
}

.yanta-table-grid thead input {
  font-weight: 650;
  background: var(--bg-elev-2);
}

.yanta-table-grid input:focus {
  box-shadow: inset 0 0 0 2px var(--accent);
}

.yanta-table-grid input[data-align="center"] { text-align: center; }
.yanta-table-grid input[data-align="right"] { text-align: right; }

.yanta-table-ctl {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}

.yanta-table-ctl:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}

.yanta-table-add {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.yanta-table-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}

@media (max-width: 720px) {
  .yanta-table-overlay { padding: 0; }
  .yanta-table-card { width: 100%; height: 100%; max-height: none; border-radius: 0; border: 0; }
  .yanta-table-grid input { min-width: 104px; font-size: 16px; }
}
`;
  document.head.append(style);
}

async function menu(anchor, items) {
  const { showMenu } = await import('../tree.js');
  const r = anchor.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, items);
}

/** Opens the table that contains `pos` in the grid editor. */
export function openTableEditor(view, pos) {
  const range = tableRangeAt(view.state, pos);
  if (!range) return;

  ensureCss();

  // Where the table stands now; re-checked before writing back.
  const original = view.state.sliceDoc(range.from, range.to);
  let table = normalize(range.table);
  let focus = { row: -1, col: 0 };

  const overlay = el('div', { class: 'yanta-table-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('table.title') });

  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
    release?.();
    view.focus();
  };

  const release = openBoundOverlay('table-editor', {
    close: () => close(),
    isOpen: () => overlay.isConnected,
  });

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

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      apply();
    }
  };

  window.addEventListener('keydown', onKey, true);

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
    overlay.querySelector(`input[data-row="${row}"][data-col="${col}"]`)?.focus();
  }

  function render() {
    const cols = table.headers.length;

    const thead = el('thead', {},
      el('tr', {},
        el('th', { class: 'ctl' }),
        ...table.headers.map((_, col) => {
          const btn = el('button', { type: 'button', class: 'yanta-table-ctl', title: t('table.columnMenu'), 'aria-label': t('table.columnMenu') });
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
        const btn = el('button', { type: 'button', class: 'yanta-table-ctl', title: t('table.rowMenu'), 'aria-label': t('table.rowMenu') });
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

    const closeBtn = el('button', { type: 'button', class: 'icon-btn', title: t('common.close'), 'aria-label': t('common.close') });
    closeBtn.innerHTML = lucide('x', 18);
    closeBtn.addEventListener('click', close);

    const cancel = el('button', { type: 'button', class: 'btn' }, t('common.cancel'));
    cancel.addEventListener('click', close);

    const applyBtn = el('button', { type: 'button', class: 'btn primary', title: 'Ctrl+Enter' }, t('table.apply'));
    applyBtn.addEventListener('click', apply);

    const icon = el('span');
    icon.innerHTML = lucide('table-2', 18);

    overlay.replaceChildren(
      el('section', { class: 'yanta-table-card' },
        el('header', { class: 'yanta-table-head' },
          icon,
          el('strong', {}, t('table.title')),
          closeBtn
        ),
        el('div', { class: 'yanta-table-scroll' },
          el('table', { class: 'yanta-table-grid' }, thead, tbody),
          el('div', { class: 'yanta-table-add' }, addRow, addCol)
        ),
        el('footer', { class: 'yanta-table-foot' }, cancel, applyBtn)
      )
    );

    requestAnimationFrame(() => focusCell(focus.row, focus.col));
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.body.append(overlay);
  render();
}
