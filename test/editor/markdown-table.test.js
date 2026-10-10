import { describe, it, expect } from 'vitest';
import {
  tableAt, formatTable, insertRow, deleteColumn, moveColumn, sortByColumn, setAlign,
  cellIndexAt, cellStartColumn, parseTsv, splitRow,
} from '../../src/editor/markdown-table.js';

const lines = [
  'Intro',
  '| Name | Preis |',
  '|---|--:|',
  '| Birne | 10 € |',
  '| Apfel | 9 € |',
  '',
];

describe('markdown tables', () => {
  it('finds the table around a line and reads alignment', () => {
    const t = tableAt(lines, 3);
    expect(t).toMatchObject({ fromLine: 1, toLine: 4, headers: ['Name', 'Preis'], align: ['', 'right'] });
    expect(t.rows).toEqual([['Birne', '10 €'], ['Apfel', '9 €']]);
    expect(tableAt(lines, 0)).toBeNull();
  });

  it('formats aligned columns, keeping the alignment markers', () => {
    expect(formatTable(tableAt(lines, 1))).toBe([
      '| Name  | Preis |',
      '| ----- | ----: |',
      '| Birne |  10 € |',
      '| Apfel |   9 € |',
    ].join('\n'));
  });

  it('sorts numbers as numbers', () => {
    const t = sortByColumn(tableAt(lines, 1), 1, 'asc');
    expect(t.rows.map((r) => r[0])).toEqual(['Apfel', 'Birne']);
  });

  it('inserts, deletes and moves', () => {
    let t = tableAt(lines, 1);
    t = insertRow(t, 0);
    expect(t.rows[0]).toEqual(['', '']);
    t = moveColumn(t, 0, 1);
    expect(t.headers).toEqual(['Preis', 'Name']);
    expect(t.align).toEqual(['right', '']);
    t = deleteColumn(t, 0);
    expect(t.headers).toEqual(['Name']);
    t = setAlign(t, 0, 'center');
    expect(formatTable(t).split('\n')[1]).toBe('| :---: |');
  });

  it('escapes pipes in cells and keeps them on read', () => {
    const t = { headers: ['a|b', 'c'], align: ['', ''], rows: [['x', 'y']] };
    const md = formatTable(t).split('\n');
    expect(md[0]).toContain('a\\|b');
    expect(splitRow(md[0])[0]).toBe('a\\|b');
  });

  it('maps columns to cells and back', () => {
    const row = '| Birne |  10 € |';
    expect(cellIndexAt(row, 3)).toBe(0);
    expect(cellIndexAt(row, 10)).toBe(1);
    expect(row.slice(cellStartColumn(row, 1))).toBe('10 € |');
    expect(cellStartColumn('|   |   |', 1)).toBe(6);
  });

  it('reads spreadsheet pastes', () => {
    expect(parseTsv('a\tb\nc\td\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTsv('plain text')).toBeNull();
  });
});
