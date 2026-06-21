// ============================================================
// YANTA — Slim Lucide icon picker.
// Used for sidebar note/folder icons and inserting inline icons.
// ============================================================

import {
  $,
  el,
  lucide,
  lucideIconNames,
  normalizeLucideName,
  safeCssColor,
  cssColorToHex,
  toast,
} from './core.js';
import { insertAtCursor } from './editor.js';

const COLORS = [
  '#6ea8fe',
  '#a78bfa',
  '#4ade80',
  '#fbbf24',
  '#f87171',
  '#fb923c',
  '#22d3ee',
  '#f472b6',
  '#94a3b8',
];

let modal;
let searchInput;
let colorInput;
let colorTextInput;
let grid;
let titleEl;
let applyBtn;
let resetBtn;

let pickerState = {
  icon: 'square',
  color: '#6ea8fe',
  onApply: null,
  allowReset: true,
};

function safeColor(c) {
  return safeCssColor(c);
}

function ensurePicker() {
  if (modal) return;

  modal = el('div', { class: 'modal icon-picker-modal', hidden: true });

  const card = el('div', { class: 'modal-card icon-picker-card' });

  const head = el(
    'header',
    { class: 'modal-head' },
    (titleEl = el('h3', {}, 'Choose icon')),
    el(
      'button',
      {
        class: 'icon-btn',
        onclick: closeIconPicker,
        title: 'Close',
      },
      '×'
    )
  );

  searchInput = el('input', {
    class: 'text-input icon-picker-search',
    type: 'search',
    placeholder: 'Search Lucide icons…',
    autocomplete: 'off',
    oninput: () => renderGrid(),
  });

  colorTextInput = el('input', {
    class: 'text-input icon-picker-color-text',
    type: 'text',
    placeholder: '#4ade80 or black',
    autocomplete: 'off',
    oninput: () => {
      const c = safeColor(colorTextInput.value);
      if (!c) return;

      pickerState.color = c;

      const hex = cssColorToHex(c);
      if (hex) colorInput.value = hex;

      markSelection();
    },
  });

  colorInput = el('input', {
    type: 'color',
    class: 'icon-picker-color',
    value: cssColorToHex(pickerState.color) || '#6ea8fe',

    oninput: () => {
      pickerState.color = colorInput.value;
      colorTextInput.value = pickerState.color;
      markSelection();
    },
  });

  const swatches = el(
    'div',
    { class: 'icon-picker-swatches' },
    COLORS.map((c) =>
      el('button', {
        class: 'icon-picker-swatch',
        title: c,
        style: { background: c },
        onclick: () => {
          pickerState.color = c;
          colorInput.value = c;
          colorTextInput.value = c;
          markSelection();
        },
      })
    )
  );

  grid = el('div', { class: 'icon-picker-grid' });

  resetBtn = el(
    'button',
    {
      class: 'btn',
      onclick: () => {
        pickerState.onApply?.({ icon: null, color: null });
        closeIconPicker();
      },
    },
    'Reset'
  );

  applyBtn = el(
    'button',
    {
      class: 'btn primary',
      onclick: () => {
        pickerState.onApply?.({
          icon: normalizeLucideName(pickerState.icon),
          color: safeColor(pickerState.color) || null,
        });
        closeIconPicker();
      },
    },
    'Apply'
  );

  const body = el(
    'div',
    { class: 'modal-body icon-picker-body' },
    el('div', { class: 'icon-picker-toolbar' }, searchInput, colorTextInput, colorInput),
    swatches,
    grid,
    el('div', { class: 'compress-actions' }, resetBtn, applyBtn)
  );

  card.append(head, body);
  modal.append(card);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeIconPicker();
  });

  document.body.append(modal);
}

function renderGrid() {
  const q = searchInput.value.trim().toLowerCase();
  const names = lucideIconNames().filter((name) => !q || name.includes(q));

  grid.replaceChildren();

  const frag = document.createDocumentFragment();

  for (const name of names) {
    const btn = el('button', {
      class: 'icon-picker-item',
      title: name,
      dataset: { icon: name },
      onclick: () => {
        pickerState.icon = name;
        markSelection();
      },
    });

    btn.innerHTML = lucide(name, 18);
    frag.append(btn);
  }

  grid.append(frag);
  markSelection();
}

function markSelection() {
  if (!grid) return;

  for (const btn of grid.querySelectorAll('.icon-picker-item')) {
    const active = btn.dataset.icon === normalizeLucideName(pickerState.icon);
    btn.classList.toggle('active', active);
    btn.style.color = safeColor(pickerState.color) || '';
  }
}

export function openIconPicker({
  title = 'Choose icon',
  initialIcon = 'square',
  initialColor = '#6ea8fe',
  allowReset = true,
  applyLabel = 'Apply',
  onApply,
} = {}) {
  ensurePicker();

  pickerState = {
    icon: normalizeLucideName(initialIcon || 'square'),
    color: safeColor(initialColor) || '#6ea8fe',
    allowReset,
    onApply,
  };

  titleEl.textContent = title;
  searchInput.value = '';
  colorTextInput.value = pickerState.color;
  colorInput.value = cssColorToHex(pickerState.color) || '#6ea8fe';
  resetBtn.hidden = !allowReset;
  applyBtn.textContent = applyLabel;

  modal.hidden = false;
  renderGrid();

  setTimeout(() => searchInput.focus(), 0);
}

export function closeIconPicker() {
  if (modal) modal.hidden = true;
}

export function openIconInsertPicker() {
  openIconPicker({
    title: 'Insert Lucide icon',
    initialIcon: 'shapes',
    initialColor: '#6ea8fe',
    allowReset: false,
    applyLabel: 'Insert',
    onApply: ({ icon, color }) => {
      if (!icon) return;
      const colorPart = color ? `{${color}}` : '';
      insertAtCursor(`:lucide[${icon}]${colorPart}:`);
      toast('Icon inserted', 'success');
    },
  });
}