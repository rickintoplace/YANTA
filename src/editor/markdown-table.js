// ============================================================
// YANTA — Markdown tables as data
//
// The editor works on pipe tables in two ways: in the text (Tab moves
// between cells and keeps the columns aligned, Enter adds a row) and in
// the grid editor (table-editor.js). Both read a table into
// { headers, align, rows }, change that, and write it back formatted —
// so this module holds the parsing, the formatting and the operations,
// with no editor in sight.
// ============================================================

const ROW_RE = /^\s*\|.*\|\s*$/;

/** Splits one table row into trimmed cells; escaped pipes stay in the cell. */
export function splitRow(line = '') {
  let text = String(line).trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells = [];
  let cur = '';
  let escaped = false;

  for (const ch of text) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      cur += ch;
      continue;
    }
    if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }

  cells.push(cur.trim());
  return cells;
}

export function isRowLine(line = '') {
  return ROW_RE.test(String(line));
}

export function isSeparatorLine(line = '') {
  if (!isRowLine(line)) return false;
  const cells = splitRow(line);
  return cells.length >= 1 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.replace(/\s+/g, '')));
}

function alignOf(cell) {
  const s = String(cell || '').replace(/\s+/g, '');
  if (s.startsWith(':') && s.endsWith(':')) return 'center';
  if (s.endsWith(':')) return 'right';
  if (s.startsWith(':')) return 'left';
  return '';
}

/**
 * The table around line `lineIndex` (0-based) of `lines`, or null.
 * Returns { fromLine, toLine, headers, align, rows } with 0-based,
 * inclusive line indexes.
 */
export function tableAt(lines, lineIndex) {
  if (!isRowLine(lines[lineIndex])) return null;

  let from = lineIndex;
  while (from > 0 && isRowLine(lines[from - 1])) from--;
  let to = lineIndex;
  while (to < lines.length - 1 && isRowLine(lines[to + 1])) to++;

  // A table is a header row followed by a separator row.
  if (to - from < 1 || !isSeparatorLine(lines[from + 1])) return null;

  const headers = splitRow(lines[from]);
  const align = splitRow(lines[from + 1]).map(alignOf);
  const rows = lines.slice(from + 2, to + 1).map(splitRow);

  return normalize({ fromLine: from, toLine: to, headers, align, rows });
}

/** Every row as wide as the widest; alignment list to match. */
export function normalize(table) {
  const width = Math.max(1, table.headers.length, ...table.rows.map((r) => r.length));
  const pad = (cells) => [...cells, ...Array(Math.max(0, width - cells.length)).fill('')].slice(0, width);

  return {
    ...table,
    headers: pad(table.headers),
    align: [...(table.align || []), ...Array(width).fill('')].slice(0, width),
    rows: table.rows.map(pad),
  };
}

/*
  Display width: East Asian wide characters take two columns in a
  monospace font, so a Japanese table needs them counted twice to line up.
*/
function visualWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    width += (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    ) ? 2 : 1;
  }
  return width;
}

function padCell(text, width, align) {
  const gap = Math.max(0, width - visualWidth(text));
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

/** A cell's text for markdown: one line, pipes escaped. */
export function cellText(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/(^|[^\\])\|/g, '$1\\|')
    .trim();
}

/** The table as aligned markdown lines (no trailing newline). */
export function formatTable(table) {
  const t = normalize(table);
  const all = [t.headers, ...t.rows].map((row) => row.map(cellText));
  const widths = t.headers.map((_, c) => Math.max(3, ...all.map((row) => visualWidth(row[c]))));

  const line = (cells) => `| ${cells.map((cell, c) => padCell(cell, widths[c], t.align[c])).join(' | ')} |`;

  const separator = `| ${widths.map((w, c) => {
    const a = t.align[c];
    if (a === 'center') return `:${'-'.repeat(w - 2)}:`;
    if (a === 'right') return `${'-'.repeat(w - 1)}:`;
    if (a === 'left') return `:${'-'.repeat(w - 1)}`;
    return '-'.repeat(w);
  }).join(' | ')} |`;

  return [line(all[0]), separator, ...all.slice(1).map(line)].join('\n');
}

/** Which cell a column offset inside a row line falls in (0-based). */
export function cellIndexAt(line, column) {
  let index = -1;
  let escaped = false;
  const text = String(line);

  for (let i = 0; i < Math.min(column, text.length); i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '|') index++;
  }

  return Math.max(0, index);
}

/** Column offset of the first character of cell `index` in a formatted row line. */
export function cellStartColumn(line, index) {
  let seen = -1;
  let escaped = false;
  const text = String(line);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '|') {
      seen++;
      if (seen === index) {
        let j = i + 1;
        while (text[j] === ' ') j++;
        // An empty cell: sit one space after the pipe.
        return text[j] === '|' || j >= text.length ? Math.min(i + 2, text.length) : j;
      }
    }
  }

  return text.length;
}

// ---- operations (each returns a new table) -----------------------

const clone = (t) => ({ ...t, headers: [...t.headers], align: [...t.align], rows: t.rows.map((r) => [...r]) });

export function insertRow(table, at) {
  const t = clone(normalize(table));
  t.rows.splice(Math.max(0, Math.min(at, t.rows.length)), 0, Array(t.headers.length).fill(''));
  return t;
}

export function deleteRow(table, at) {
  const t = clone(table);
  t.rows.splice(at, 1);
  return t;
}

export function moveRow(table, from, to) {
  const t = clone(table);
  if (to < 0 || to >= t.rows.length) return t;
  const [row] = t.rows.splice(from, 1);
  t.rows.splice(to, 0, row);
  return t;
}

export function insertColumn(table, at) {
  const t = clone(normalize(table));
  const i = Math.max(0, Math.min(at, t.headers.length));
  t.headers.splice(i, 0, '');
  t.align.splice(i, 0, '');
  t.rows.forEach((row) => row.splice(i, 0, ''));
  return t;
}

export function deleteColumn(table, at) {
  const t = clone(table);
  if (t.headers.length <= 1) return t;
  t.headers.splice(at, 1);
  t.align.splice(at, 1);
  t.rows.forEach((row) => row.splice(at, 1));
  return t;
}

export function moveColumn(table, from, to) {
  const t = clone(table);
  if (to < 0 || to >= t.headers.length) return t;
  const move = (list) => {
    const [x] = list.splice(from, 1);
    list.splice(to, 0, x);
  };
  move(t.headers);
  move(t.align);
  t.rows.forEach(move);
  return t;
}

export function setAlign(table, column, align) {
  const t = clone(table);
  t.align[column] = align;
  return t;
}

/** Numbers sort as numbers ("9" before "10", "1.5 €" too), the rest by locale. */
export function sortByColumn(table, column, direction = 'asc', locale = undefined) {
  const t = clone(table);
  const num = (s) => {
    const m = String(s).replace(/\s/g, '').replace(/(\d)[.,](?=\d{3}\b)/g, '$1').replace(',', '.').match(/^[^\d-]*(-?\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  };
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const sign = direction === 'desc' ? -1 : 1;

  t.rows.sort((a, b) => {
    const x = a[column] ?? '';
    const y = b[column] ?? '';
    if (!x && y) return 1;
    if (x && !y) return -1;
    const nx = num(x);
    const ny = num(y);
    if (nx != null && ny != null && nx !== ny) return (nx - ny) * sign;
    return collator.compare(x, y) * sign;
  });

  return t;
}

/** A fresh table for the slash command. */
export function emptyTable(columns = 3, rows = 2) {
  return {
    headers: Array.from({ length: columns }, (_, i) => `Column ${i + 1}`),
    align: Array(columns).fill(''),
    rows: Array.from({ length: rows }, () => Array(columns).fill('')),
  };
}

/** Rows pasted from a spreadsheet (tab-separated lines), or null. */
export function parseTsv(text) {
  const lines = String(text || '').replace(/\r/g, '').replace(/\n$/, '').split('\n');
  if (lines.length < 1 || !lines.some((l) => l.includes('\t'))) return null;
  return lines.map((l) => l.split('\t'));
}
