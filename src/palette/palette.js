// ============================================================
// YANTA — Unified palette.
//
// One overlay for everything findable: notes (full text), commands, folders,
// calendar events, chat messages and semantic matches. Ctrl+P and Ctrl+O both
// land here; `>` narrows to commands, the VS Code convention.
//
// Two-phase results keep typing instant: in-memory providers render on the
// keystroke, IndexedDB/worker providers stream in afterwards and only ever
// append at the bottom, so the selection never moves under the user's hands.
// ============================================================

import { $, el, lucide } from '../core.js';
import { t } from '../i18n/index.js';
import { tokenizeQuery } from '../text-search.js';
import { noteCommandUsed } from './palette-commands.js';
import { GROUPS, collectInstant, collectDeferred } from './palette-providers.js';

export { buildCommandList } from './palette-commands.js';

const COMMAND_PREFIX = '>';
const DEFERRED_DELAY_MS = 200;

const GROUP_RANK = new Map(GROUPS.map((g, i) => [g.id, i]));
const GROUP_LABEL = new Map(GROUPS.map((g) => [g.id, g.labelKey]));

const palette = {
  open: false,
  scope: 'all',
  query: '',
  tokens: [],
  instant: [],
  /** @type {Map<string, object[]>} groupId -> items, filled as providers resolve */
  deferred: new Map(),
  items: [],
  active: 0,
  /** Selection anchor: survives re-renders when late results append. */
  activeKey: '',
  deferredTimer: null,
  controller: null,
};

// -------- Lifecycle --------------------------------------------

export function openPalette() {
  const input = $('paletteInput');
  if (!input) return;

  const icon = $('paletteSearchIcon');
  if (icon && !icon.firstChild) icon.innerHTML = lucide('search', 16);

  palette.open = true;
  input.value = '';

  applyQuery('');

  $('palette').hidden = false;
  input.focus();
}

export function closePalette() {
  cancelDeferred();

  palette.open = false;
  palette.instant = [];
  palette.deferred.clear();
  palette.items = [];
  palette.activeKey = '';

  const node = $('palette');
  if (node) node.hidden = true;
}

export function paletteFilter(value) {
  applyQuery(value);
}

// -------- Query ------------------------------------------------

function cancelDeferred() {
  clearTimeout(palette.deferredTimer);
  palette.deferredTimer = null;

  palette.controller?.abort();
  palette.controller = null;
}

function applyQuery(raw) {
  cancelDeferred();

  const text = String(raw || '');
  const isCommandScope = text.trimStart().startsWith(COMMAND_PREFIX);

  palette.scope = isCommandScope ? 'commands' : 'all';
  palette.query = (isCommandScope ? text.trimStart().slice(1) : text)
    .trim()
    .toLowerCase();

  // Tokenized once per query, then shared by scoring and highlighting.
  palette.tokens = tokenizeQuery(palette.query);

  palette.deferred.clear();
  palette.instant = collectInstant({
    query: palette.query,
    tokens: palette.tokens,
    scope: palette.scope,
  });

  // A fresh query starts at the top; the anchor is only for late arrivals.
  palette.activeKey = '';
  rebuild();

  const input = $('paletteInput');
  if (input) {
    input.placeholder = palette.scope === 'commands'
      ? t('palette.typeCommand')
      : t('palette.placeholder');
  }

  scheduleDeferred();
}

function scheduleDeferred() {
  if (palette.scope === 'commands' || !palette.query) return;

  const controller = new AbortController();
  palette.controller = controller;

  palette.deferredTimer = setTimeout(() => {
    const exclude = new Set(palette.instant.map((i) => i.key));

    collectDeferred({
      query: palette.query,
      exclude,
      signal: controller.signal,
      onGroup: (groupId, items) => {
        if (controller.signal.aborted || !palette.open) return;

        palette.deferred.set(groupId, items);
        rebuild();
      },
    }).catch(() => {});
  }, DEFERRED_DELAY_MS);
}

// -------- Selection --------------------------------------------

function rebuild() {
  // Array.sort is stable, so provider order survives inside each group.
  palette.items = [...palette.instant, ...[...palette.deferred.values()].flat()]
    .sort((a, b) => (GROUP_RANK.get(a.group) ?? 99) - (GROUP_RANK.get(b.group) ?? 99));

  const anchored = palette.items.findIndex((i) => i.key === palette.activeKey);

  palette.active = anchored >= 0 ? anchored : 0;
  palette.activeKey = palette.items[palette.active]?.key || '';

  render();
}

export function paletteMove(delta) {
  if (!palette.items.length) return;

  setActive((palette.active + delta + palette.items.length) % palette.items.length);
}

/**
 * Moves the highlight without rebuilding the list: replaceChildren() under a
 * hovering pointer would drop the node the cursor sits on and re-fire
 * mouseenter, and arrow-key repeat would rebuild dozens of rows per second.
 */
function setActive(index) {
  if (index === palette.active) return;

  palette.active = index;
  palette.activeKey = palette.items[index]?.key || '';

  const list = $('paletteList');
  if (!list) return;

  for (const row of list.querySelectorAll('.palette-item')) {
    const on = Number(row.dataset.i) === index;

    row.classList.toggle('active', on);
    row.setAttribute('aria-selected', on ? 'true' : 'false');

    if (on) {
      row.scrollIntoView({ block: 'nearest' });
      updateActiveDescendant(row);
    }
  }
}

export function paletteAccept(index) {
  const item = palette.items[index ?? palette.active];
  if (!item) return;

  closePalette();

  if (item.command) noteCommandUsed(item.command.label);

  try {
    item.run?.();
  } catch (err) {
    console.error('[YANTA Palette] Action failed', err);
  }
}

// -------- Rendering --------------------------------------------

/** Wraps every token occurrence in <mark> so a hit is scannable at a glance. */
function highlighted(text, className) {
  const raw = String(text || '');
  const node = el('span', { class: className });
  const tokens = palette.tokens;

  if (!raw || !tokens.length) {
    node.textContent = raw;
    return node;
  }

  const lower = raw.toLowerCase();
  const hits = [];

  for (const token of tokens) {
    for (let i = lower.indexOf(token); i >= 0; i = lower.indexOf(token, i + token.length)) {
      hits.push([i, i + token.length]);
    }
  }

  if (!hits.length) {
    node.textContent = raw;
    return node;
  }

  // Overlapping tokens must collapse into one range — nested <mark> would
  // otherwise double-emphasise the overlap.
  const ranges = [];

  for (const [start, end] of hits.sort((a, b) => a[0] - b[0])) {
    const last = ranges[ranges.length - 1];

    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  let cursor = 0;

  for (const [start, end] of ranges) {
    if (start > cursor) node.append(raw.slice(cursor, start));

    node.append(el('mark', {}, raw.slice(start, end)));
    cursor = end;
  }

  node.append(raw.slice(cursor));

  return node;
}

function itemRow(item, index) {
  const active = index === palette.active;

  const row = el('div', {
    class: `palette-item${active ? ' active' : ''}`,
    id: `palette-item-${index}`,
    role: 'option',
    'aria-selected': active ? 'true' : 'false',
    dataset: { i: String(index) },
    onclick: () => paletteAccept(index),
    onmouseenter: () => setActive(index),
  });

  const icon = el('span', { class: 'pi-icon' });
  icon.innerHTML = lucide(item.icon || 'square', 14);
  row.append(icon);

  const body = el('div', { class: 'pi-body' });
  body.append(highlighted(item.label || t('note.untitled'), 'pi-label'));

  if (item.snippet) {
    body.append(highlighted(item.snippet, 'pi-snippet'));
  }

  row.append(body);

  if (item.meta) row.append(el('span', { class: 'pi-meta' }, item.meta));
  if (item.hint) row.append(el('span', { class: 'pi-hint' }, item.hint));

  return row;
}

function render() {
  const list = $('paletteList');
  if (!list) return;

  list.replaceChildren();

  if (!palette.items.length) {
    list.append(el('div', { class: 'palette-empty' }, t('palette.empty')));
    updateActiveDescendant(null);
    return;
  }

  let group = null;

  palette.items.forEach((item, index) => {
    if (item.group !== group) {
      group = item.group;

      list.append(el(
        'div',
        { class: 'palette-group', role: 'presentation' },
        t(GROUP_LABEL.get(group) || '')
      ));
    }

    list.append(itemRow(item, index));
  });

  const activeRow = list.querySelector('.palette-item.active');
  activeRow?.scrollIntoView({ block: 'nearest' });
  updateActiveDescendant(activeRow);
}

function updateActiveDescendant(row) {
  const input = $('paletteInput');
  if (!input) return;

  if (row) input.setAttribute('aria-activedescendant', row.id);
  else input.removeAttribute('aria-activedescendant');
}
