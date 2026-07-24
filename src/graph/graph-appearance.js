// ============================================================
// YANTA — Icon & color editor for notes and folders.
//
// Used by the graph, the tree and the dashboard. This module has
// no dependency on graph.js: after applying changes it dispatches
//   yanta-appearance-changed   (graph rebuilds itself)
//   yanta-dashboard-refresh    (dashboard re-renders card colors)
// so every surface stays in sync without import cycles.
// ============================================================

import {
  state,
  store,
  lucide,
  lucideIconNames,
  safeCssColor,
  escapeHtml,
  toast,
} from '../core.js';
import { t } from '../i18n/index.js';
import { renderTree } from '../tree.js';
import { injectGraphCss } from './graph-css.js';

const APPEARANCE_ICONS = lucideIconNames();

const COLOR_SWATCHES = [
  // Blues
  '#6ea8fe', '#3b82f6', '#0ea5e9', '#06b6d4',
  // Purples / pinks
  '#a78bfa', '#8b5cf6', '#d946ef', '#ec4899',
  // Reds / oranges
  '#f87171', '#ef4444', '#fb923c', '#f59e0b',
  // Yellows
  '#fbbf24', '#eab308',
  // Greens
  '#4ade80', '#22c55e', '#10b981', '#84cc16',
  // Neutrals
  '#94a3b8', '#64748b', '#a8a29e', '#d4d4d8',
];

let modalEl = null;

// ------------------------------------------------------------
// Target key helpers ("note:<id>" / "folder:<id>")
// ------------------------------------------------------------

function parseKey(key) {
  const [kind, ...rest] = String(key || '').split(':');
  return { kind, id: rest.join(':') };
}

function normalizeTargetKeys(keys) {
  const out = [];
  const seen = new Set();
  for (const key of keys || []) {
    const { kind, id } = parseKey(key);
    let normalized = '';
    if (kind === 'note' && state.notes.has(id)) normalized = `note:${id}`;
    else if (kind === 'folder' && state.folders.has(id)) normalized = `folder:${id}`;
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function firstTarget(keys) {
  for (const key of normalizeTargetKeys(keys)) {
    const { kind, id } = parseKey(key);
    if (kind === 'note') {
      const note = state.notes.get(id);
      if (note) return { kind, id, note };
    }
    if (kind === 'folder') {
      const folder = state.folders.get(id);
      if (folder) return { kind, id, folder };
    }
  }
  return null;
}

function targetLabel(item) {
  if (!item) return t('appearance.itemFallback');
  if (item.kind === 'folder') return item.folder?.name || t('items.folderFallback');
  return item.note?.title || t('note.untitled');
}

// ------------------------------------------------------------
// Tree traversal helpers
// ------------------------------------------------------------

function collectAncestorFolders(startId) {
  const out = [];
  const seen = new Set();
  let f = startId ? state.folders.get(startId) : null;
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    out.push(f);
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }
  return out;
}

function childFoldersOf(folderId) {
  return [...state.folders.values()].filter((f) => f.parentId === folderId);
}

function notesInFolder(folderId) {
  return [...state.notes.values()].filter((n) => n.folderId === folderId);
}

function countAllDescendants(folderId) {
  const folders = new Set();
  const notes = new Set();
  const stack = [folderId];
  while (stack.length) {
    const cur = stack.pop();
    for (const f of state.folders.values()) {
      if (f.parentId === cur && !folders.has(f.id)) {
        folders.add(f.id);
        stack.push(f.id);
      }
    }
    for (const n of state.notes.values()) {
      if (n.folderId === cur) notes.add(n.id);
    }
  }
  return folders.size + notes.size;
}

// ------------------------------------------------------------
// Applying appearance payloads
// ------------------------------------------------------------

// payload: { icon, color, applyIcon, applyColor, resetIcon, resetColor }
export async function applyAppearanceToTargets(targets, payload) {
  const { icon, color, applyIcon, applyColor, resetIcon, resetColor } = payload || {};
  if (!applyIcon && !applyColor && !resetIcon && !resetColor) {
    toast(t('appearance.nothingToApply'), 'info');
    return;
  }
  const writes = [];
  const now = Date.now();
  for (const key of targets) {
    const { kind, id } = parseKey(key);
    if (kind === 'note') {
      const n = state.notes.get(id);
      if (!n) continue;
      if (resetIcon) delete n.icon;
      else if (applyIcon && icon != null) n.icon = icon;
      if (resetColor) delete n.color;
      else if (applyColor && color != null) n.color = color;
      n.updated = now;
      writes.push(store.notes.put(n));
    } else if (kind === 'folder') {
      const f = state.folders.get(id);
      if (!f) continue;
      if (resetIcon) delete f.icon;
      else if (applyIcon && icon != null) f.icon = icon;
      if (resetColor) delete f.color;
      else if (applyColor && color != null) f.color = color;
      f.updated = now;
      writes.push(store.folders.put(f));
    }
  }
  try {
    await Promise.all(writes);
  } catch {}
  renderTree();
  window.dispatchEvent(new CustomEvent('yanta-appearance-changed', {
    detail: { count: targets.size ?? targets.length ?? 0 },
  }));
  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
    detail: { source: 'appearance' },
  }));
  const count = targets.size ?? targets.length ?? 0;
  toast(t('appearance.updated', { count }), 'success');
}

// ------------------------------------------------------------
// Scope picker modal
// ------------------------------------------------------------

function openScopePicker({ title, options, onPick }) {
  injectGraphCss();
  const overlay = document.createElement('div');
  overlay.className = 'yanta-scope-modal';
  const card = document.createElement('div');
  card.className = 'yanta-scope-card';

  const head = document.createElement('div');
  head.className = 'yanta-scope-head';
  head.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.title = t('common.close');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());
  head.append(closeBtn);

  const body = document.createElement('div');
  body.className = 'yanta-scope-body';
  for (const opt of options) {
    const b = document.createElement('button');
    b.className = 'yanta-scope-opt';
    if (opt.disabled) b.disabled = true;
    b.innerHTML = `
      <span class="yanta-scope-icon">${lucide(opt.icon || 'square', 16)}</span>
      <span>${escapeHtml(opt.label)}</span>
      ${opt.meta ? `<span class="yanta-scope-meta">${escapeHtml(opt.meta)}</span>` : ''}
    `;
    b.addEventListener('click', () => {
      overlay.remove();
      if (!opt.disabled) onPick(opt.value);
    });
    body.append(b);
  }

  card.append(head, body);
  overlay.append(card);
  document.body.append(overlay);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function scopeTitleFor(payload) {
  if (!payload) return t('appearance.applyTo');
  if (payload.applyIcon && payload.applyColor) return t('appearance.applyIconColorTo');
  if (payload.applyIcon) return t('appearance.applyIconTo');
  if (payload.applyColor) return t('appearance.applyColorTo');
  return t('appearance.applyTo');
}

function collectTargetsForScope(keys, scope) {
  const baseKeys = normalizeTargetKeys(keys);
  const out = new Set(baseKeys);
  if (scope === 'self') return out;
  if (scope === 'all') {
    for (const n of state.notes.values()) out.add(`note:${n.id}`);
    for (const f of state.folders.values()) out.add(`folder:${f.id}`);
    return out;
  }
  for (const key of baseKeys) {
    const { kind, id } = parseKey(key);
    if (kind === 'note') {
      const note = state.notes.get(id);
      if (!note) continue;
      const folderId = note.folderId || null;
      if (scope === 'siblings') {
        for (const n of state.notes.values()) {
          if ((n.folderId || null) === folderId) out.add(`note:${n.id}`);
        }
      }
      if (scope === 'parents') {
        for (const f of collectAncestorFolders(note.folderId)) {
          out.add(`folder:${f.id}`);
        }
      }
      continue;
    }
    if (kind === 'folder') {
      const folder = state.folders.get(id);
      if (!folder) continue;
      if (scope === 'siblings') {
        for (const f of state.folders.values()) {
          if ((f.parentId || null) === (folder.parentId || null)) {
            out.add(`folder:${f.id}`);
          }
        }
      }
      if (scope === 'children') {
        for (const f of childFoldersOf(folder.id)) out.add(`folder:${f.id}`);
        for (const n of notesInFolder(folder.id)) out.add(`note:${n.id}`);
      }
      if (scope === 'descendants') {
        const stack = [folder.id];
        while (stack.length) {
          const cur = stack.pop();
          for (const f of state.folders.values()) {
            if (f.parentId === cur && !out.has(`folder:${f.id}`)) {
              out.add(`folder:${f.id}`);
              stack.push(f.id);
            }
          }
          for (const n of state.notes.values()) {
            if (n.folderId === cur) out.add(`note:${n.id}`);
          }
        }
      }
      if (scope === 'parents') {
        for (const f of collectAncestorFolders(folder.parentId)) {
          out.add(`folder:${f.id}`);
        }
      }
    }
  }
  return out;
}

export function pickScopeForNote(note, payload) {
  const folderId = note.folderId || null;
  const siblings = folderId
    ? [...state.notes.values()].filter((n) => n.folderId === folderId && n.id !== note.id)
    : [...state.notes.values()].filter((n) => !n.folderId && n.id !== note.id);
  const folder = folderId ? state.folders.get(folderId) : null;
  const parents = collectAncestorFolders(folderId);

  openScopePicker({
    title: scopeTitleFor(payload),
    options: [
      { value: 'self', icon: 'file', label: t('appearance.scope.justThisNote') },
      {
        value: 'siblings',
        icon: 'files',
        label: folder ? t('appearance.scope.allNotesIn', { name: folder.name || t('graph.ctxFolder') }) : t('appearance.scope.allRootNotes'),
        meta: t('tree.bulk.notesLabel', { count: siblings.length + 1 }),
      },
      {
        value: 'parents',
        icon: 'folder-tree',
        label: t('appearance.scope.noteAndParents'),
        meta: parents.length ? t('appearance.plusFolders', { count: parents.length }) : '',
        disabled: parents.length === 0,
      },
    ],
    onPick: async (scope) => {
      const targets = collectTargetsForScope([`note:${note.id}`], scope);
      await applyAppearanceToTargets(targets, payload);
    },
  });
}

export function pickScopeForFolder(folder, payload) {
  const directChildren = childFoldersOf(folder.id).length + notesInFolder(folder.id).length;
  const allDescendants = countAllDescendants(folder.id);
  const parents = collectAncestorFolders(folder.parentId);
  const siblings = [...state.folders.values()].filter(
    (f) => (f.parentId || null) === (folder.parentId || null) && f.id !== folder.id
  );

  openScopePicker({
    title: scopeTitleFor(payload),
    options: [
      { value: 'self', icon: 'folder', label: t('appearance.scope.justThisFolder') },
      {
        value: 'siblings',
        icon: 'folders',
        label: folder.parentId ? t('appearance.scope.folderAndSiblings') : t('appearance.scope.allRootFolders'),
        meta: t('tree.bulk.foldersLabel', { count: siblings.length + 1 }),
      },
      {
        value: 'children',
        icon: 'corner-down-right',
        label: t('appearance.scope.folderAndChildren'),
        meta: directChildren ? t('appearance.plusItems', { count: directChildren }) : '',
        disabled: directChildren === 0,
      },
      {
        value: 'descendants',
        icon: 'folder-tree',
        label: t('appearance.scope.folderAndEverything'),
        meta: allDescendants ? t('appearance.plusItems', { count: allDescendants }) : '',
        disabled: allDescendants === 0,
      },
      {
        value: 'parents',
        icon: 'corner-up-left',
        label: t('appearance.scope.folderAndParents'),
        meta: parents.length ? t('appearance.plusFolders', { count: parents.length }) : '',
        disabled: parents.length === 0,
      },
    ],
    onPick: async (scope) => {
      const targets = collectTargetsForScope([`folder:${folder.id}`], scope);
      await applyAppearanceToTargets(targets, payload);
    },
  });
}

export function pickScopeForTargets(keys, payload) {
  const baseKeys = normalizeTargetKeys(keys);
  if (!baseKeys.length) {
    toast(t('tree.bulk.nothingSelected'), 'info');
    return;
  }
  const selfCount = collectTargetsForScope(baseKeys, 'self').size;
  const extra = (scope) =>
    Math.max(0, collectTargetsForScope(baseKeys, scope).size - selfCount);
  const siblingExtra = extra('siblings');
  const childExtra = extra('children');
  const descendantExtra = extra('descendants');
  const parentExtra = extra('parents');
  const allCount = collectTargetsForScope(baseKeys, 'all').size;

  openScopePicker({
    title: scopeTitleFor(payload),
    options: [
      {
        value: 'self',
        icon: 'check',
        label: baseKeys.length === 1 ? t('appearance.scope.justThisItem') : t('appearance.scope.selectedItemsOnly'),
        meta: t('tree.itemCount', { count: selfCount }),
      },
      {
        value: 'siblings',
        icon: 'folders',
        label: t('appearance.scope.selectedAndSiblings'),
        meta: siblingExtra ? t('appearance.plusItems', { count: siblingExtra }) : '',
        disabled: siblingExtra === 0,
      },
      {
        value: 'children',
        icon: 'corner-down-right',
        label: t('appearance.scope.selectedFoldersAndChildren'),
        meta: childExtra ? t('appearance.plusItems', { count: childExtra }) : '',
        disabled: childExtra === 0,
      },
      {
        value: 'descendants',
        icon: 'folder-tree',
        label: t('appearance.scope.selectedFoldersAndEverything'),
        meta: descendantExtra ? t('appearance.plusItems', { count: descendantExtra }) : '',
        disabled: descendantExtra === 0,
      },
      {
        value: 'parents',
        icon: 'corner-up-left',
        label: t('appearance.scope.selectedAndParents'),
        meta: parentExtra ? t('appearance.plusFolders', { count: parentExtra }) : '',
        disabled: parentExtra === 0,
      },
      {
        value: 'all',
        icon: 'globe',
        label: t('appearance.scope.allNotesAndFolders'),
        meta: t('tree.itemCount', { count: allCount }),
      },
    ],
    onPick: async (scope) => {
      const targets = collectTargetsForScope(baseKeys, scope);
      await applyAppearanceToTargets(targets, payload);
    },
  });
}

// ------------------------------------------------------------
// Appearance picker modal
// ------------------------------------------------------------

function closeAppearancePicker() {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
}

// opts: { title, kind: 'note'|'folder'|'targets', target, initialIcon,
//         initialColor, hasIcon, hasColor }
export function openAppearancePicker(opts) {
  injectGraphCss();
  closeAppearancePicker();

  const {
    title = t('appearance.title'),
    kind,
    target,
    initialIcon,
    initialColor = '#6ea8fe',
    hasIcon = false,
    hasColor = false,
  } = opts;

  const defaultIcon = kind === 'folder' ? 'folder' : 'file';

  const local = {
    icon: initialIcon || defaultIcon,
    color: safeCssColor(initialColor) || '#6ea8fe',
    changeIcon: true,
    changeColor: true,
    iconSearch: '',
  };

  const overlay = document.createElement('div');
  overlay.className = 'yanta-appearance-modal';
  const card = document.createElement('div');
  card.className = 'yanta-appearance-card';
  card.innerHTML = `
    <div class="yanta-appearance-head">
      <span class="yanta-appearance-preview" data-yap-preview></span>
      <h3>${escapeHtml(title)}</h3>
      <button class="icon-btn" data-yap-close title="${escapeHtml(t('common.close'))}">✕</button>
    </div>
    <div class="yanta-appearance-body">
      <div class="yanta-appearance-section" data-yap-section="icon">
        <div class="yanta-appearance-section-head">
          <label class="yanta-appearance-toggle">
            <input type="checkbox" data-yap-toggle="icon" checked />
            <span class="yap-title">${lucide('shapes', 12)} ${escapeHtml(t('appearance.iconLabel'))}</span>
          </label>
          ${hasIcon ? `<button class="yanta-appearance-reset" data-yap-reset="icon">${lucide('rotate-ccw', 11)} ${escapeHtml(t('appearance.resetToDefault'))}</button>` : ''}
        </div>
        <div class="yap-content">
          <input type="search" class="yanta-appearance-search" data-yap-search placeholder="${escapeHtml(t('appearance.searchIcons'))}" />
          <div class="yanta-appearance-icon-grid" data-yap-grid></div>
        </div>
      </div>
      <div class="yanta-appearance-section" data-yap-section="color">
        <div class="yanta-appearance-section-head">
          <label class="yanta-appearance-toggle">
            <input type="checkbox" data-yap-toggle="color" checked />
            <span class="yap-title">${lucide('palette', 12)} ${escapeHtml(t('appearance.colorLabel'))}</span>
          </label>
          ${hasColor ? `<button class="yanta-appearance-reset" data-yap-reset="color">${lucide('rotate-ccw', 11)} ${escapeHtml(t('appearance.resetToDefault'))}</button>` : ''}
        </div>
        <div class="yap-content">
          <div class="yanta-appearance-colors" data-yap-swatches></div>
          <div class="yanta-appearance-color-row" style="margin-top:8px">
            <input type="color" data-yap-color-picker value="${escapeHtml(local.color)}" />
            <input type="text" data-yap-color-hex value="${escapeHtml(local.color)}" placeholder="#6ea8fe" maxlength="9" />
            <span style="font-size:11px;color:var(--text-faint)">${escapeHtml(t('appearance.custom'))}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="yanta-appearance-foot">
      <button class="yap-btn ghost" data-yap-cancel>${escapeHtml(t('common.cancel'))}</button>
      <span class="yap-spacer"></span>
      <button class="yap-btn secondary" data-yap-apply-to>${lucide('share-2', 13)} ${escapeHtml(t('appearance.applyTo'))}</button>
      <button class="yap-btn primary" data-yap-apply>${lucide('check', 13)} ${escapeHtml(t('common.apply'))}</button>
    </div>
  `;
  overlay.append(card);
  document.body.append(overlay);
  modalEl = overlay;

  const previewEl = card.querySelector('[data-yap-preview]');
  const iconSearchEl = card.querySelector('[data-yap-search]');
  const iconGridEl = card.querySelector('[data-yap-grid]');
  const swatchesEl = card.querySelector('[data-yap-swatches]');
  const colorPickerEl = card.querySelector('[data-yap-color-picker]');
  const colorHexEl = card.querySelector('[data-yap-color-hex]');
  const sectionIconEl = card.querySelector('[data-yap-section="icon"]');
  const sectionColorEl = card.querySelector('[data-yap-section="color"]');
  const toggleIconEl = card.querySelector('[data-yap-toggle="icon"]');
  const toggleColorEl = card.querySelector('[data-yap-toggle="color"]');
  const applyBtn = card.querySelector('[data-yap-apply]');
  const applyToBtn = card.querySelector('[data-yap-apply-to]');

  function syncSectionDisabled() {
    sectionIconEl.classList.toggle('disabled', !local.changeIcon);
    sectionColorEl.classList.toggle('disabled', !local.changeColor);
    const noChange = !local.changeIcon && !local.changeColor;
    applyBtn.disabled = noChange;
    applyToBtn.disabled = noChange;
  }

  function refreshPreview() {
    card.style.setProperty('--yap-color', local.color);
    previewEl.style.setProperty('--yap-color', local.color);
    previewEl.innerHTML = lucide(local.icon || defaultIcon, 18);
  }

  function refreshSwatches() {
    const seen = new Set();
    const html = [];
    for (const c of [local.color, ...COLOR_SWATCHES]) {
      const lc = (c || '').toLowerCase();
      if (!lc || seen.has(lc)) continue;
      seen.add(lc);
      const selected = lc === (local.color || '').toLowerCase() ? ' selected' : '';
      html.push(`<button type="button" class="yanta-appearance-swatch${selected}" data-yap-swatch="${escapeHtml(c)}" style="background:${escapeHtml(c)}" title="${escapeHtml(c)}"></button>`);
    }
    swatchesEl.innerHTML = html.join('');
    for (const btn of swatchesEl.querySelectorAll('[data-yap-swatch]')) {
      btn.addEventListener('click', () => {
        local.color = btn.dataset.yapSwatch;
        colorPickerEl.value = local.color;
        colorHexEl.value = local.color;
        refreshPreview();
        refreshSwatches();
        refreshIconGrid();
      });
    }
  }

  function refreshIconGrid() {
    const q = local.iconSearch.trim().toLowerCase();
    const list = q
      ? APPEARANCE_ICONS.filter((name) => name.includes(q))
      : APPEARANCE_ICONS;
    const html = [
      `<button type="button" class="${local.icon === defaultIcon ? 'selected' : ''}" data-yap-icon="${escapeHtml(defaultIcon)}" title="Default (${escapeHtml(defaultIcon)})">${lucide(defaultIcon, 18)}</button>`,
    ];
    for (const name of list) {
      if (name === defaultIcon) continue;
      const selected = name === local.icon ? 'selected' : '';
      html.push(`<button type="button" class="${selected}" data-yap-icon="${escapeHtml(name)}" title="${escapeHtml(name)}">${lucide(name, 18)}</button>`);
    }
    iconGridEl.innerHTML = html.join('');
    for (const btn of iconGridEl.querySelectorAll('[data-yap-icon]')) {
      btn.addEventListener('click', () => {
        local.icon = btn.dataset.yapIcon;
        refreshIconGrid();
        refreshPreview();
      });
    }
  }

  refreshPreview();
  refreshSwatches();
  refreshIconGrid();
  syncSectionDisabled();

  iconSearchEl.addEventListener('input', (e) => {
    local.iconSearch = e.target.value || '';
    refreshIconGrid();
  });
  toggleIconEl.addEventListener('change', () => {
    local.changeIcon = toggleIconEl.checked;
    syncSectionDisabled();
  });
  toggleColorEl.addEventListener('change', () => {
    local.changeColor = toggleColorEl.checked;
    syncSectionDisabled();
  });
  colorPickerEl.addEventListener('input', () => {
    local.color = colorPickerEl.value || '#6ea8fe';
    colorHexEl.value = local.color;
    refreshPreview();
    refreshSwatches();
    refreshIconGrid();
  });
  colorHexEl.addEventListener('input', () => {
    const val = (colorHexEl.value || '').trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(val)) {
      local.color = val;
      colorPickerEl.value = val.length >= 7 ? val.slice(0, 7) : val;
      refreshPreview();
      refreshSwatches();
      refreshIconGrid();
    }
  });

  function buildPayload({ reset } = {}) {
    if (reset === 'icon') {
      return { icon: null, color: local.color, applyIcon: false, applyColor: false, resetIcon: true, resetColor: false };
    }
    if (reset === 'color') {
      return { icon: local.icon, color: null, applyIcon: false, applyColor: false, resetIcon: false, resetColor: true };
    }
    return {
      icon: local.icon,
      color: local.color,
      applyIcon: local.changeIcon,
      applyColor: local.changeColor,
      resetIcon: false,
      resetColor: false,
    };
  }

  function selfTargets() {
    const targets = new Set();
    if (kind === 'note') targets.add(`note:${target.id}`);
    else if (kind === 'folder') targets.add(`folder:${target.id}`);
    else if (kind === 'targets') {
      for (const key of normalizeTargetKeys(target?.keys || [])) targets.add(key);
    }
    return targets;
  }

  for (const btn of card.querySelectorAll('[data-yap-reset]')) {
    btn.addEventListener('click', () => {
      const payload = buildPayload({ reset: btn.dataset.yapReset });
      closeAppearancePicker();
      applyAppearanceToTargets(selfTargets(), payload);
    });
  }
  card.querySelector('[data-yap-cancel]').addEventListener('click', closeAppearancePicker);
  card.querySelector('[data-yap-close]').addEventListener('click', closeAppearancePicker);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeAppearancePicker();
  });

  function onKey(e) {
    if (!modalEl) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'Escape') {
      closeAppearancePicker();
      window.removeEventListener('keydown', onKey);
    }
  }
  window.addEventListener('keydown', onKey);

  applyBtn.addEventListener('click', () => {
    const payload = buildPayload();
    closeAppearancePicker();
    applyAppearanceToTargets(selfTargets(), payload);
  });

  applyToBtn.addEventListener('click', () => {
    const payload = buildPayload();
    closeAppearancePicker();
    if (kind === 'note') pickScopeForNote(target, payload);
    else if (kind === 'folder') pickScopeForFolder(target, payload);
    else if (kind === 'targets') pickScopeForTargets(target?.keys || [], payload);
  });
}

// ------------------------------------------------------------
// Public entry points (used by graph, tree, dashboard, note chrome)
// ------------------------------------------------------------

export function editNoteAppearance(note) {
  if (!note) return;
  openAppearancePicker({
    title: t('appearance.titleFor', { name: note.title || t('note.untitled') }),
    kind: 'note',
    target: note,
    initialIcon: note.icon || (note.type === 'list' ? 'list' : 'file'),
    initialColor: note.color || '#6ea8fe',
    hasIcon: note.icon != null,
    hasColor: note.color != null,
  });
}

export function editFolderAppearance(folder) {
  if (!folder) return;
  openAppearancePicker({
    title: t('appearance.titleFor', { name: folder.name || t('items.folderFallback') }),
    kind: 'folder',
    target: folder,
    initialIcon: folder.icon || 'folder',
    initialColor: folder.color || '#6ea8fe',
    hasIcon: folder.icon != null,
    hasColor: folder.color != null,
  });
}

export function editTreeAppearanceTargets(keys, { title } = {}) {
  const targetKeys = normalizeTargetKeys(keys);
  if (!targetKeys.length) {
    toast(t('tree.bulk.nothingSelected'), 'info');
    return;
  }
  const first = firstTarget(targetKeys);
  if (!first) {
    toast(t('tree.bulk.nothingSelected'), 'info');
    return;
  }
  const initialIcon =
    first.kind === 'folder'
      ? first.folder.icon || 'folder'
      : first.note.icon || (first.note.type === 'list' ? 'list' : 'file');
  const initialColor =
    first.kind === 'folder'
      ? first.folder.color || '#6ea8fe'
      : first.note.color || '#6ea8fe';
  const hasIcon = targetKeys.some((key) => {
    const { kind, id } = parseKey(key);
    if (kind === 'note') return state.notes.get(id)?.icon != null;
    if (kind === 'folder') return state.folders.get(id)?.icon != null;
    return false;
  });
  const hasColor = targetKeys.some((key) => {
    const { kind, id } = parseKey(key);
    if (kind === 'note') return state.notes.get(id)?.color != null;
    if (kind === 'folder') return state.folders.get(id)?.color != null;
    return false;
  });
  openAppearancePicker({
    title: title || (
      targetKeys.length === 1
        ? `Icon & color: ${targetLabel(first)}`
        : `Icon & color for ${targetKeys.length} selected items`
    ),
    kind: 'targets',
    target: { keys: targetKeys },
    initialIcon,
    initialColor,
    hasIcon,
    hasColor,
  });
}