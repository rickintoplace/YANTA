// ============================================================
// YANTA — Sidebar tree (folders + notes), tag cloud, context
// menus, drag-and-drop reorganisation, multi-select + bulk ops.
// ============================================================

import { $, el, uid, state, store, lucide, safeCssColor, toast } from './core.js';
import {
  openNote,
  newNote,
  newFolder,
  rebuildWikilinkIndex,
  clearEditor,
} from './notes.js';
import { syncDeleteNoteFile } from './sync.js';
import { getNoteDoc, noteMarkdown, destroyNoteDoc } from './yjs.js';
import { updateStorageMeter } from './core.js';
import { inlineTextEdit } from './inline-ui.js';

import {
  openFolderInDashboard,
  renameNoteById,
  renameFolderById,
} from './item-actions.js';

function safeItemColor(c) {
  return safeCssColor(c);
}

function itemIcon(name, color) {
  const span = el('span', { class: 'tree-item-icon' });
  span.innerHTML = lucide(name || 'square', 14);

  const c = safeItemColor(color);
  if (c) span.style.color = c;

  return span;
}

function applyItemColor(row, color) {
  const c = safeItemColor(color);
  if (!c) return;

  row.classList.add('has-color');
  row.style.setProperty('--item-color', c);
}

/**
 * Aktiver Marker für Notes.
 *
 * Warum nicht der normale border-left?
 * Der normale Border sitzt am linken Rand der kompletten .tree-row.
 * Bei Notes in Ordnern/Subordnern ist aber der Inhalt eingerückt.
 * Dadurch wirkt der Border auf der falschen Ebene.
 *
 * Dieser Marker sitzt relativ zur Note-Ebene kurz vor dem Icon/Text.
 */
function activeNoteMarker(depth = 0) {
  return el('span', {
    class: 'tree-active-note-marker',
    'aria-hidden': 'true',
    style: {
      position: 'absolute',
      left: (0 + depth * 12) + 'px',
      top: '4px',
      bottom: '4px',
      width: '2px',
      borderRadius: '999px',
      background: 'var(--accent)',
      pointerEvents: 'none',
    },
  });
}

function applyCollapsedTreeDepth(row, depth = 0) {
  if (!row) return;

  const d = Math.max(0, Number(depth) || 0);

  row.dataset.treeDepth = String(d);
  row.style.setProperty('--tree-depth', String(d));

  // Sicherer Fallback:
  // 56px Sidebar, 18px Icon => (56 - 18) / 2 = 19px.
  // Root-Icons sind damit mittig.
  row.style.setProperty('--tree-indent-collapsed', '19px');

  // Root-Marker ganz links, tiefere Marker später dynamisch.
  row.style.setProperty('--tree-marker-collapsed', d === 0 ? '0px' : '8px');
  row.style.setProperty('--tree-guide-opacity', d > 0 ? '1' : '0');
}

function normalizeCollapsedTreeIndents(root = $('tree')) {
  if (!root) return;

  const rows = [...root.querySelectorAll('.tree-row[data-tree-depth]')];
  if (!rows.length) return;

  const depths = rows.map((row) => {
    const d = parseInt(row.dataset.treeDepth || '0', 10);
    return Number.isFinite(d) ? Math.max(0, d) : 0;
  });

  const maxDepth = Math.max(0, ...depths);

  // Hart und robust für collapsed Sidebar.
  const sidebarW = 42;
  const iconW = 18;
  const rightSafety = 3;

  // Root-Icon exakt mittig.
  const rootIconLeft = Math.round((sidebarW - iconW) / 2); // 19

  // Größter erlaubter Icon-Left-Wert:
  // iconLeft + iconW + rightSafety <= sidebarW
  const maxIconLeft = sidebarW - iconW - rightSafety; // 35

  const available = maxIconLeft - rootIconLeft; // 16

  /*
    Dynamisch:
    - Root bleibt immer 19px.
    - Tiefste existierende Ebene landet maximal bei 35px.
    - Dazwischen proportional.
    - Bei sehr hoher maxDepth werden die Abstände kleiner, aber niemals negativ.
  */
  const indentStrength = 0.5; // 1 = volle Spreizung, 0.5 = halb so stark
  const step = maxDepth > 0 ? (available / maxDepth) * indentStrength : 0;

  for (const row of rows) {
    const d = parseInt(row.dataset.treeDepth || '0', 10) || 0;

    const iconLeft = Math.round(rootIconLeft + d * step);

    /*
      Marker:
      - Root exakt 0.
      - Unterebenen links vom Icon, ebenfalls komprimiert.
    */
    const markerLeft = d === 0
      ? 0
      : Math.max(4, Math.min(iconLeft - 7, maxIconLeft - 7));

    row.style.setProperty('--tree-indent-collapsed', iconLeft + 'px');
    row.style.setProperty('--tree-marker-collapsed', markerLeft + 'px');
    row.style.setProperty('--tree-guide-opacity', d > 0 ? '1' : '0');
  }
}

function treePathMarker() {
  return el('span', {
    class: 'tree-path-marker',
    'aria-hidden': 'true',
  });
}

function currentFolderTrailSet() {
  const out = new Set();

  const current = state.currentNoteId
    ? state.notes.get(state.currentNoteId)
    : null;

  let folderId = current?.folderId || null;
  const seen = new Set();

  while (folderId && state.folders.has(folderId) && !seen.has(folderId)) {
    seen.add(folderId);
    out.add(folderId);

    const f = state.folders.get(folderId);
    folderId = f?.parentId || null;
  }

  return out;
}

// ============================================================
// Tree animations
// ============================================================

const TREE_ANIM_MS = 220;

let pendingFolderAnimation = null;

// Letzte Position des aktiven Tree-Indicators.
// Wichtig, weil renderTree() den Tree komplett neu baut.
// Wir starten den neuen Floating-Indicator an der alten Position.
let lastActiveTreeIndicator = null;

function treeMotionEnabled() {
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

function findFolderChildren(folderId) {
  const root = $('tree');
  if (!root) return null;

  const node = [...root.querySelectorAll('.tree-folder-node')]
    .find((n) => n.dataset.folderId === folderId);

  return node?.querySelector(':scope > .tree-children') || null;
}

function removeActiveTreeFloaters(root) {
  root?.querySelectorAll(
    ':scope > .tree-active-bg-floater, :scope > .tree-active-marker-floater'
  ).forEach((n) => n.remove());
}

function setTreeFolderAnimating(on) {
  const root = $('tree');
  if (!root) return;

  root.classList.toggle('tree-folder-animating', !!on);

  if (on) {
    // Während Folder-Animationen darf der Floater nicht sichtbar sein.
    // Die aktive Row rendert dann ihr eigenes Highlight und wird natürlich
    // mit dem Subtree bewegt/geclippt.
    removeActiveTreeFloaters(root);
    lastActiveTreeIndicator = null;
  }
}

function toggleFolderAnimated(folderId, wasExpanded) {
  // Reduced motion: keine Animation.
  if (!treeMotionEnabled()) {
    if (wasExpanded) state.expandedFolders.delete(folderId);
    else state.expandedFolders.add(folderId);

    renderTree();
    return;
  }

  // Collapse: vorhandene Children rausanimieren, danach State ändern.
  if (wasExpanded) {
    const kids = findFolderChildren(folderId);

    if (!kids) {
      state.expandedFolders.delete(folderId);
      renderTree();
      return;
    }

    setTreeFolderAnimating(true);

    kids.style.maxHeight = kids.scrollHeight + 'px';
    kids.style.opacity = '1';
    kids.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      kids.classList.add('is-collapsing');
    });

    window.setTimeout(() => {
      state.expandedFolders.delete(folderId);
      renderTree();

      // renderTree() scheduled selbst ein updateActiveTreeIndicator().
      // Das soll wegen tree-folder-animating noch unterdrückt werden.
      // Danach final sauber messen.
      requestAnimationFrame(() => {
        setTreeFolderAnimating(false);
        updateActiveTreeIndicator($('tree'), { animate: false });
      });
    }, TREE_ANIM_MS);

    return;
  }

  // Expand: State ändern, neu rendern, Children per CSS reinanimieren.
  setTreeFolderAnimating(true);

  state.expandedFolders.add(folderId);
  pendingFolderAnimation = { id: folderId, action: 'expand' };

  renderTree();

  window.setTimeout(() => {
    if (
      pendingFolderAnimation?.id === folderId &&
      pendingFolderAnimation?.action === 'expand'
    ) {
      pendingFolderAnimation = null;
    }

    findFolderChildren(folderId)?.classList.remove('is-expanding');

    setTreeFolderAnimating(false);
    updateActiveTreeIndicator($('tree'), { animate: false });
  }, TREE_ANIM_MS + 40);
}

function setFloaterRect(node, rect) {
  node.style.left = rect.left + 'px';
  node.style.top = rect.top + 'px';
  node.style.width = rect.width + 'px';
  node.style.height = rect.height + 'px';
  node.style.opacity = rect.opacity == null ? '1' : String(rect.opacity);
}

function updateActiveTreeIndicator(root, { animate = true } = {}) {
  if (!root) return;

  removeActiveTreeFloaters(root);

  // Während Folder-Animationen übernimmt die aktive Row ihr Highlight selbst.
  if (root.classList.contains('tree-folder-animating')) {
    return;
  }

  const active = root.querySelector('.tree-row.note.active');

  if (!active) {
    lastActiveTreeIndicator = null;
    return;
  }

  const bg = el('div', {
    class: 'tree-active-bg-floater',
    'aria-hidden': 'true',
  });

  const marker = el('div', {
    class: 'tree-active-marker-floater',
    'aria-hidden': 'true',
  });

  root.append(bg, marker);

  const rootRect = root.getBoundingClientRect();
  const rowRect = active.getBoundingClientRect();

  const top = rowRect.top - rootRect.top + root.scrollTop;
  const left = rowRect.left - rootRect.left + root.scrollLeft;
  const height = rowRect.height;

  const depth = parseInt(active.dataset.treeDepth || '0', 10) || 0;
  const collapsed = $('app')?.classList.contains('sidebar-collapsed');

  const cs = getComputedStyle(active);
  const collapsedMarkerLeft = parseFloat(
    cs.getPropertyValue('--tree-marker-collapsed') || '0'
  );

  const markerInnerLeft = collapsed
    ? collapsedMarkerLeft
    : depth * 12;

  const markerTopInset = collapsed ? 0 : 4;
  const markerHeightInset = collapsed ? 0 : 8;

  const next = {
    bg: {
      left: 0,
      top,
      width: root.clientWidth,
      height,
      opacity: 1,
    },

    marker: {
      left: left + markerInnerLeft,
      top: top + markerTopInset,
      width: 2,
      height: Math.max(2, height - markerHeightInset),
      opacity: 1,
    },
  };

  if (!animate || !lastActiveTreeIndicator) {
    setFloaterRect(bg, next.bg);
    setFloaterRect(marker, next.marker);
    lastActiveTreeIndicator = next;
    return;
  }

  setFloaterRect(bg, lastActiveTreeIndicator.bg);
  setFloaterRect(marker, lastActiveTreeIndicator.marker);

  requestAnimationFrame(() => {
    bg.classList.add('is-live');
    marker.classList.add('is-live');

    setFloaterRect(bg, next.bg);
    setFloaterRect(marker, next.marker);
  });

  lastActiveTreeIndicator = next;
}

// ============================================================
// Multi-selection state
// Keys:
//   note:<id>
//   folder:<id>
// ============================================================

const selection = {
  keys: new Set(),
  anchorKey: null,
};

let visibleTreeOrder = [];
let lastTreeFocusKey = null;

function noteKey(id) {
  return `note:${id}`;
}

function folderKey(id) {
  return `folder:${id}`;
}

function parseTreeKey(key) {
  const [kind, ...rest] = String(key || '').split(':');
  return {
    kind,
    id: rest.join(':'),
  };
}

function isEditableTreeKeyTarget(target) {
  const node = target instanceof Element ? target : null;

  return !!node?.closest?.(
    'input, textarea, select, button, a, [contenteditable="true"], .yanta-inline-edit'
  );
}

function treeKeyFromDomTarget(target) {
  const node = target instanceof Element ? target : null;
  if (!node) return '';

  const row = node.closest?.('.tree-row[data-tree-key]');

  if (row?.dataset?.treeKey) {
    return row.dataset.treeKey;
  }

  return '';
}

function focusedTreeKey() {
  const key = treeKeyFromDomTarget(document.activeElement);
  return key && treeKeyExists(key) ? key : '';
}

function primarySelectedTreeKey() {
  if (lastTreeFocusKey && treeKeyExists(lastTreeFocusKey)) {
    return lastTreeFocusKey;
  }

  if (selection.anchorKey && treeKeyExists(selection.anchorKey)) {
    return selection.anchorKey;
  }

  if (selection.keys.size === 1) {
    const [only] = selection.keys;
    return treeKeyExists(only) ? only : '';
  }

  return '';
}

function renameTreeKey(key) {
  const { kind, id } = parseTreeKey(key);

  if (kind === 'note' && state.notes.has(id)) {
    renameTreeNote(id);
    return true;
  }

  if (kind === 'folder' && state.folders.has(id)) {
    renameTreeFolder(id);
    return true;
  }

  return false;
}

function renameFocusedOrSelectedTreeItem(target = document.activeElement) {
  const fromTarget = treeKeyFromDomTarget(target);

  const key =
    (fromTarget && treeKeyExists(fromTarget) ? fromTarget : '') ||
    focusedTreeKey() ||
    primarySelectedTreeKey();

  if (!key) return false;

  return renameTreeKey(key);
}

function findTreeRowByKey(key) {
  if (!key) return null;

  const tree = $('tree');
  if (!tree) return null;

  /*
    Prefer the real tree row over pinned mirrors.
    If the real row is hidden inside a collapsed folder, fall back to any visible row.
  */
  return (
    tree.querySelector(`.tree-row[data-tree-key="${CSS.escape(key)}"]:not([data-pinned-mirror="1"])`) ||
    tree.querySelector(`.tree-row[data-tree-key="${CSS.escape(key)}"]`)
  );
}

function focusTreeRowByKey(key, { preventScroll = true } = {}) {
  const row = findTreeRowByKey(key);
  if (!row) return false;

  try {
    row.focus({ preventScroll });
  } catch {
    row.focus();
  }

  return true;
}

function restoreTreeFocusSoon() {
  const key =
    (lastTreeFocusKey && treeKeyExists(lastTreeFocusKey) ? lastTreeFocusKey : '') ||
    primarySelectedTreeKey();

  if (!key) return;

  requestAnimationFrame(() => {
    /*
      Nicht in ein laufendes Inline-Edit reinfunken.
    */
    if (isEditableTreeKeyTarget(document.activeElement)) return;

    focusTreeRowByKey(key);
  });
}

function handleTreeF2(e) {
  if (e.key !== 'F2') return false;
  if (isEditableTreeKeyTarget(e.target)) return false;

  /*
    Wenn Dashboard sichtbar ist, soll dessen eigener F2-Handler gewinnen.
  */
  if ($('app')?.dataset?.surface === 'dashboard') return false;

  const handled = renameFocusedOrSelectedTreeItem(e.target);

  if (!handled) return false;

  e.preventDefault();
  e.stopPropagation();

  return true;
}

function bindTreeKeyboardShortcuts(root) {
  if (!root) return;

  if (root.dataset.treeKeyboardBound !== '1') {
    root.dataset.treeKeyboardBound = '1';

    root.addEventListener('keydown', (e) => {
      handleTreeF2(e);
    });
  }

  if (bindTreeKeyboardShortcuts._globalBound) return;
  bindTreeKeyboardShortcuts._globalBound = true;

  window.addEventListener('keydown', (e) => {
    if (!$('tree')) return;

    handleTreeF2(e);
  }, true);
}

function treeKeyExists(key) {
  const { kind, id } = parseTreeKey(key);
  if (kind === 'note') return state.notes.has(id);
  if (kind === 'folder') return state.folders.has(id);
  return false;
}

function pruneDeadSelection() {
  for (const key of [...selection.keys]) {
    if (!treeKeyExists(key)) selection.keys.delete(key);
  }

  if (selection.anchorKey && !treeKeyExists(selection.anchorKey)) {
    selection.anchorKey = selection.keys.values().next().value || null;
  }
}

function isSelected(key) {
  return selection.keys.has(key);
}

function setOnlySelection(key) {
  selection.keys.clear();
  selection.keys.add(key);
  selection.anchorKey = key;
}

function toggleSelection(key) {
  if (selection.keys.has(key)) {
    selection.keys.delete(key);
    if (selection.anchorKey === key) {
      selection.anchorKey = selection.keys.values().next().value || null;
    }
  } else {
    selection.keys.add(key);
    selection.anchorKey = key;
  }

  if (!selection.keys.size) {
    selection.anchorKey = null;
  }
}

function selectRange(anchorKey, targetKey) {
  const order = visibleTreeOrder;
  const a = order.indexOf(anchorKey);
  const b = order.indexOf(targetKey);

  if (a < 0 || b < 0) {
    setOnlySelection(targetKey);
    return;
  }

  const from = Math.min(a, b);
  const to = Math.max(a, b);

  selection.keys.clear();

  for (let i = from; i <= to; i++) {
    selection.keys.add(order[i]);
  }

  selection.anchorKey = anchorKey;
}

function getSelectedItems() {
  const out = [];

  for (const key of selection.keys) {
    const { kind, id } = parseTreeKey(key);

    if (kind === 'note') {
      const note = state.notes.get(id);
      if (note) out.push({ key, kind, id, note });
    } else if (kind === 'folder') {
      const folder = state.folders.get(id);
      if (folder) out.push({ key, kind, id, folder });
    }
  }

  return out;
}

function selectedNotes(items = getSelectedItems()) {
  return items.filter((x) => x.kind === 'note').map((x) => x.note);
}

function selectedFolders(items = getSelectedItems()) {
  return items.filter((x) => x.kind === 'folder').map((x) => x.folder);
}

function handleTreeSelectionClick(e, key, normalAction) {
  /*
    Merken, welches Tree-Item zuletzt bewusst bedient wurde.
    Wichtig, weil openNote()/Folder-Toggle renderTree() auslösen und dadurch
    der DOM-Fokus sonst verloren geht.
  */
  lastTreeFocusKey = key;

  const row = e.currentTarget?.closest?.('.tree-row') || e.currentTarget;

  try {
    row?.focus?.({ preventScroll: true });
  } catch {
    row?.focus?.();
  }

  // Ctrl/Cmd toggles individual rows.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    e.stopPropagation();

    toggleSelection(key);
    renderTree();

    return;
  }

  // Shift selects visible range from anchor to target.
  if (e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();

    selectRange(selection.anchorKey || key, key);
    renderTree();

    return;
  }

  // Normal click behaves like common tree UIs:
  // select row + perform normal action.
  setOnlySelection(key);
  normalAction?.();

  /*
    Falls normalAction synchron oder async einen Tree-Render auslöst,
    danach Fokus auf die neu erzeugte Row zurückholen.
  */
  restoreTreeFocusSoon();
}

function openTreeContextMenu(e, key, singleMenuFn) {
  e.preventDefault();
  e.stopPropagation();

  if (!isSelected(key)) {
    setOnlySelection(key);
    renderTree();
  }

  const items = getSelectedItems();

  if (items.length > 1) {
    bulkMenu(e, items);
  } else {
    singleMenuFn();
  }
}

// ============================================================
// Render
// ============================================================

export function renderTree() {
  const root = $('tree');
  if (!root) return;

  bindTreeKeyboardShortcuts(root);

  pruneDeadSelection();

  visibleTreeOrder = [];
  root.replaceChildren();

  const q = state.searchQuery.toLowerCase();
  const filterTag = state.activeTagFilter;

  const visible = [...state.notes.values()].filter((n) => {
    if (filterTag && !(n.tags || []).includes(filterTag)) return false;

    if (q) {
      const fallbackHay = [
        n.title || '',
        (n.tags || []).join(' '),
      ].join(' ').toLowerCase();

      const hay = state.searchIndex.get(n.id) || fallbackHay;

      if (!hay.includes(q)) return false;
    }

    return true;
  });

const pinned = visible
  .filter((n) => n.pinned)
  .sort((a, b) => b.updated - a.updated);

if (pinned.length) {
  const sec = el('div', { class: 'tree-section tree-section-pinned' });
  sec.append(el('div', { class: 'tree-section-title' }, 'Pinned'));

  for (const n of pinned) {
    /*
      Pinned ist nur ein Shortcut/Mirror.
      Die Note bleibt zusätzlich an ihrem echten Ort im Tree sichtbar.
      registerOrder:false vermeidet doppelte Einträge in visibleTreeOrder
      für Shift-Range-Selection.
    */
    sec.append(noteRow(n, 0, {
      registerOrder: false,
      pinnedMirror: true,
    }));
  }

  root.append(sec);
}

  const folderSec = el('div', { class: 'tree-section' });

  const ftitle = el(
    'div',
    { class: 'tree-section-title' },
    'Root',
    el('button', {
      class: 'icon-btn',
      title: 'New folder',
      onclick: () => newFolder(null),
      style: { width: '20px', height: '20px' },
    }, '+')
  );

  ftitle.addEventListener('dragover', (e) => {
    const types = [...(e.dataTransfer.types || [])];
    if (!types.includes('text/yanta-note') && !types.includes('text/yanta-folder')) return;

    e.preventDefault();
    ftitle.classList.add('drop-target');
  });

  ftitle.addEventListener('dragleave', () => {
    ftitle.classList.remove('drop-target');
  });

  ftitle.addEventListener('drop', async (e) => {
    ftitle.classList.remove('drop-target');
    e.preventDefault();

    const noteId = e.dataTransfer.getData('text/yanta-note');
    const folderId = e.dataTransfer.getData('text/yanta-folder');

    if (noteId) {
      const noteIds = draggedNoteIds(noteId);

      for (const id of noteIds) {
        const note = state.notes.get(id);
        if (!note) continue;

        note.folderId = null;
        note.updated = Date.now();

        await store.notes.put(note);
      }
    } else if (folderId) {
      const folderIds = draggedFolderIds(folderId);

      for (const id of folderIds) {
        const folder = state.folders.get(id);
        if (!folder) continue;

        folder.parentId = null;

        await store.folders.put(folder);
      }
    }

    renderTree();
  });

  folderSec.append(ftitle);

  const orphanNotes = visible
    .filter((n) => !n.folderId)
    .sort((a, b) => b.updated - a.updated);

  for (const n of orphanNotes) {
    folderSec.append(noteRow(n));
  }

  const topFolders = [...state.folders.values()]
    .filter((f) => !f.parentId || !state.folders.has(f.parentId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  for (const f of topFolders) {
    folderSec.append(folderRow(f, visible, 0));
  }

  if (!topFolders.length && !orphanNotes.length) {
    folderSec.append(el('div', { class: 'tree-empty' }, q || filterTag ? 'No matches' : 'No notes yet'));
  }

  root.append(folderSec);

  normalizeCollapsedTreeIndents(root);

  requestAnimationFrame(() => {
    updateActiveTreeIndicator(root);
    restoreTreeFocusSoon();
  });

  renderTagCloud();
  updateStorageMeter();
}

function isAncestor(ancestorId, descendantId) {
  let cur = state.folders.get(descendantId);
  const seen = new Set();

  while (cur && !seen.has(cur.id)) {
    if (cur.id === ancestorId) return true;

    seen.add(cur.id);
    cur = cur.parentId ? state.folders.get(cur.parentId) : null;
  }

  return false;
}

function folderRow(f, visibleNotes, depth) {
  const key = folderKey(f.id);
  visibleTreeOrder.push(key);

  const wrap = el('div', {
    class: 'tree-node tree-folder-node',
    dataset: {
      treeKey: key,
      folderId: f.id,
      treeDepth: String(depth),
    },
  });
  const expanded = state.expandedFolders.has(f.id);
  const selected = isSelected(key);
  const isAnchor = selection.anchorKey === key;

  const isCurrentPath = currentFolderTrailSet().has(f.id);

  const childFolders = [...state.folders.values()]
    .filter((x) => x.parentId === f.id)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const childNotes = visibleNotes
    .filter((n) => n.folderId === f.id)
    .sort((a, b) => b.updated - a.updated);

  const row = el('div', {
    class:
      'tree-row folder' +
      (expanded ? ' expanded' : '') +
      (selected ? ' selected' : '') +
      (isAnchor ? ' selection-anchor' : '') +
      (isCurrentPath ? ' current-path' : ''),
    dataset: {
      treeKey: key,
      folderId: f.id,
      treeDepth: String(depth),
    },
    tabindex: '0',
    style: { paddingLeft: (12 + depth * 12) + 'px' },
    onclick: (e) => handleTreeSelectionClick(e, key, () => {
      toggleFolderAnimated(f.id, expanded);
    }),
    oncontextmenu: (e) => openTreeContextMenu(e, key, () => folderMenu(e, f)),
    ondragover: (e) => {
      const types = [...(e.dataTransfer.types || [])];
      if (!types.includes('text/yanta-note') && !types.includes('text/yanta-folder')) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    },
    ondragleave: () => row.classList.remove('drop-target'),
    ondrop: async (e) => {
      row.classList.remove('drop-target');
      e.preventDefault();

      const noteId = e.dataTransfer.getData('text/yanta-note');
      const folderId = e.dataTransfer.getData('text/yanta-folder');

      if (noteId) {
        const noteIds = draggedNoteIds(noteId);

        for (const id of noteIds) {
          const note = state.notes.get(id);
          if (!note) continue;

          note.folderId = f.id;
          note.updated = Date.now();

          await store.notes.put(note);
        }
      } else if (folderId) {
        const folderIds = draggedFolderIds(folderId);

        for (const id of folderIds) {
          if (id === f.id) continue;
          if (isAncestor(id, f.id)) continue;

          const folder = state.folders.get(id);
          if (!folder) continue;

          folder.parentId = f.id;

          await store.folders.put(folder);
        }
      }

      state.expandedFolders.add(f.id);
      renderTree();
    },
  });

  applyItemColor(row, f.color);
  applyCollapsedTreeDepth(row, depth);

  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    if (!isSelected(key)) setOnlySelection(key);

    e.dataTransfer.setData('text/yanta-folder', f.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  if (isCurrentPath) {
    row.append(treePathMarker());
  }

  row.append(el('span', { class: 'twist' }, expanded ? '▾' : '▸'));

  const icon = itemIcon(f.icon || 'folder', f.color);
  icon.classList.add('tree-folder-icon');
  row.append(icon);

  row.append(el('span', { class: 'label' }, f.name || 'Folder'));

    const childCount = childFolders.length + childNotes.length;

  if (childCount > 0) {
    row.append(el('span', {
      class: 'tree-folder-count',
      title: `${childCount} item${childCount === 1 ? '' : 's'}`,
    }, String(childCount)));
  }

  row.append(el('span', {
    class: 'menu-trigger',
    title: 'Add note',
    onclick: (e) => {
      e.stopPropagation();
      newNote(f.id);
    },
  }, '+'));

  wrap.append(row);

  if (expanded) {
    const kids = el('div', {
      class:
        'tree-children' +
        (
          pendingFolderAnimation?.id === f.id &&
          pendingFolderAnimation?.action === 'expand'
            ? ' is-expanding'
            : ''
        ),
    });

    for (const sf of childFolders) {
      kids.append(folderRow(sf, visibleNotes, depth + 1));
    }

    for (const n of childNotes) {
      kids.append(noteRow(n, depth + 1));
    }

    if (!childFolders.length && !childNotes.length) {
      kids.append(el('div', { class: 'tree-empty' }, 'Empty'));
    }

    wrap.append(kids);
  }

  return wrap;
}

function noteRow(n, depth = 0, {
  registerOrder = true,
  pinnedMirror = false,
} = {}) {
  const key = noteKey(n.id);

  if (registerOrder) {
    visibleTreeOrder.push(key);
  }

  const isActive = state.currentNoteId === n.id;
  const selected = isSelected(key);
  const isAnchor = selection.anchorKey === key;

  const rowStyle = {
    paddingLeft: (12 + depth * 14) + 'px',

    // Für collapsed Sidebar: Hierarchie sichtbar machen.
    '--tree-depth': String(depth),
    '--tree-indent-collapsed': (6 + depth * 10) + 'px',
    '--tree-marker-collapsed': (depth * 10) + 'px',
    '--tree-guide-opacity': depth > 0 ? '1' : '0',
  };

  /*
    Wichtig:
    Der globale CSS-Border `.tree-row.active { border-left-color: ... }`
    sitzt bei verschachtelten Notes optisch auf der falschen Ebene.
    Für aktive Notes deaktivieren wir ihn inline und zeichnen stattdessen
    einen korrekt eingerückten Marker.
  */
  if (isActive) {
    rowStyle.borderLeftColor = 'transparent';
  }

  const row = el('div', {
    class:
      'tree-row note' +
      (isActive ? ' active' : '') +
      (selected ? ' selected' : '') +
      (isAnchor ? ' selection-anchor' : '') +
      (pinnedMirror ? ' pinned-mirror' : ''),
    dataset: {
      treeKey: key,
      noteId: n.id,
      treeDepth: String(depth),
      pinnedMirror: pinnedMirror ? '1' : '',
    },
    tabindex: '0',
    style: rowStyle,
    draggable: 'true',
    onclick: (e) => handleTreeSelectionClick(e, key, () => {
      openNote(n.id);

      window.dispatchEvent(new CustomEvent('yanta-close-mobile-sidebar'));
    }),
    oncontextmenu: (e) => openTreeContextMenu(e, key, () => noteMenu(e, n)),
    ondragstart: (e) => {
      if (!isSelected(key)) setOnlySelection(key);

      // text/yanta-note enables intra-app folder moves & wikilink-on-drop;
      // text/plain so a drop onto a foreign target still gets the title.
      e.dataTransfer.setData('text/yanta-note', n.id);
      e.dataTransfer.setData('text/plain', n.title || 'Untitled');
      e.dataTransfer.effectAllowed = 'copyMove';
    },
    ondragover: (e) => {
      const types = [...(e.dataTransfer.types || [])];
      if (!types.includes('text/yanta-note')) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    },
    ondragleave: () => row.classList.remove('drop-target'),
    ondrop: async (e) => {
      row.classList.remove('drop-target');

      const draggedId = e.dataTransfer.getData('text/yanta-note');
      if (!draggedId) return;

      e.preventDefault();

      const ids = draggedNoteIds(draggedId);

      // Dropping note(s) onto another note → move into that note's folder.
      for (const id of ids) {
        if (id === n.id) continue;

        const dropped = state.notes.get(id);
        if (!dropped) continue;

        dropped.folderId = n.folderId || null;
        dropped.updated = Date.now();

        await store.notes.put(dropped);
      }

      window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));

      renderTree();
    },
  });

  applyItemColor(row, n.color);
  applyCollapsedTreeDepth(row, depth);

  if (isActive) {
    row.append(activeNoteMarker(depth));
  }

  row.append(itemIcon(n.icon || (n.type === 'list' ? 'list' : 'file'), n.color));
  row.append(el('span', { class: 'label' }, n.title || 'Untitled'));

  /*
    In der Pinned-Section ist die Note nur ein Shortcut.
    Wenn sie eigentlich in einem Folder liegt, zeigen wir optional den Folderpfad.
  */
  if (pinnedMirror && n.folderId) {
    const path = folderPath(n.folderId);
    const folder = state.folders.get(n.folderId);

    row.append(el('span', {
      class: 'tree-note-location',
      title: path || folder?.name || 'Folder',
    }, folder?.name || 'Folder'));
  }

  // Per-note sync status dot
  const status = state.noteSyncStatus.get(n.id);
  if (status && status !== 'synced') {
    const dot = el('span', {
      class: 'sync-dot sync-dot-' + status,
      title: statusLabel(status),
    });

    row.append(dot);
  }

  if (state.liveShares.has(n.id)) {
    row.append(el('span', { class: 'live-dot', title: 'Live shared' }));
  }

  if (n.pinned && !pinnedMirror) {
    row.append(el('span', { class: 'pin', title: 'Pinned' }, '●'));
  }

  return row;
}

function draggedNoteIds(draggedId) {
  const key = noteKey(draggedId);

  if (isSelected(key)) {
    const ids = selectedNotes().map((n) => n.id);
    if (ids.length > 1) return ids;
  }

  return [draggedId];
}

function draggedFolderIds(draggedId) {
  const key = folderKey(draggedId);

  if (isSelected(key)) {
    const ids = selectedFolders().map((f) => f.id);
    if (ids.length > 1) return ids;
  }

  return [draggedId];
}

function statusLabel(s) {
  return {
    local: 'Local changes',
    remote: 'Remote changes',
    syncing: 'Syncing…',
    conflict: 'Conflict',
  }[s] || s;
}

// ============================================================
// Tags
// ============================================================

export function renderTagCloud() {
  const c = $('tagCloud');
  if (!c) return;

  c.replaceChildren();

  const counts = new Map();

  for (const n of state.notes.values()) {
    for (const t of n.tags || []) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  for (const [t, n] of sorted) {
    const p = el('span', {
      class: 'tag-pill' + (state.activeTagFilter === t ? ' active' : ''),
      onclick: () => {
        state.activeTagFilter = state.activeTagFilter === t ? null : t;
        renderTree();

        window.dispatchEvent(new CustomEvent('yanta-close-mobile-sidebar'));
      },
    }, '#' + t, el('span', { class: 'count' }, String(n)));

    c.append(p);
  }
}

// ============================================================
// Inline rename helpers
// ============================================================

function findTreeNoteLabel(noteId) {
  if (!noteId) return null;

  return $('tree')?.querySelector(
    `.tree-row.note[data-note-id="${CSS.escape(noteId)}"] .label`
  ) || null;
}

function findTreeFolderLabel(folderId) {
  if (!folderId) return null;

  return $('tree')?.querySelector(
    `.tree-folder-node[data-folder-id="${CSS.escape(folderId)}"] > .tree-row.folder .label`
  ) || null;
}

function renameTreeNote(noteId) {
  const note = state.notes.get(noteId);
  const anchor = findTreeNoteLabel(noteId);

  if (!note || !anchor) return;

  inlineTextEdit(anchor, {
    initial: note.title || 'Untitled',
    placeholder: 'Note title',
    emptyFallback: 'Untitled',

    onCommit: async (value) => {
      return await renameNoteById(noteId, value);
    },
  });
}

function renameTreeFolder(folderId) {
  const folder = state.folders.get(folderId);
  const anchor = findTreeFolderLabel(folderId);

  if (!folder || !anchor) return;

  inlineTextEdit(anchor, {
    initial: folder.name || 'Folder',
    placeholder: 'Folder name',
    emptyFallback: 'Folder',

    onCommit: async (value) => {
      return await renameFolderById(folderId, value);
    },
  });
}

// ============================================================
// Context menus
// ============================================================

let activeMenu = null;

function _menuOutsideClose(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}

export function showMenu(x, y, items) {
  closeMenu();

  const m = el('div', {
    class: 'ctx-menu',
    style: {
      left: x + 'px',
      top: y + 'px',
    },
  });

  for (const it of items) {
    if (it === 'hr') {
      m.append(el('hr'));
      continue;
    }

    const btn = el('button', {
      class: [
        it.danger ? 'danger' : '',
        it.disabled ? 'disabled' : '',
        it.meta ? 'meta' : '',
      ].filter(Boolean).join(' '),
      disabled: !!it.disabled,
      onclick: () => {
        if (it.disabled) return;
        closeMenu();
        it.action?.();
      },
    }, it.label);

    m.append(btn);
  }

  document.body.append(m);
  activeMenu = m;

  setTimeout(() => {
    document.addEventListener('mousedown', _menuOutsideClose, true);
  }, 0);

  const r = m.getBoundingClientRect();

  if (r.right > window.innerWidth) {
    m.style.left = (x - r.width) + 'px';
  }

  if (r.bottom > window.innerHeight) {
    m.style.top = (y - r.height) + 'px';
  }
}

export function closeMenu() {
  if (!activeMenu) return;

  document.removeEventListener('mousedown', _menuOutsideClose, true);
  activeMenu.remove();
  activeMenu = null;
}

function noteMenu(e, n) {
  showMenu(e.clientX, e.clientY, [
    {
      label: n.pinned ? 'Unpin' : 'Pin',
      action: async () => {
        n.pinned = !n.pinned;
        n.updated = Date.now();

        await store.notes.put(n);
        renderTree();

        window.dispatchEvent(new CustomEvent('yanta-note-updated', {
          detail: { noteId: n.id },
        }));
      },
    },
    {
      label: 'Icon & color…',
      action: () => editItemsIconColor([noteKey(n.id)]),
    },
    {
      label: 'Rename…',
      action: () => renameTreeNote(n.id),
    },
    {
      label: 'Move to folder…',
      action: () => moveSelectedToFolder([noteKey(n.id)]),
    },
    {
      label: 'Duplicate',
      action: () => duplicateNote(n),
    },
    'hr',
    {
      label: 'Delete',
      danger: true,
      action: async () => {
        if (!confirm(`Delete "${n.title || 'Untitled'}"?`)) return;

        await deleteNotesAndFolders({
          noteIds: new Set([n.id]),
          folderIds: new Set(),
          recursiveFolders: false,
        });
      },
    },
  ]);
}

function folderMenu(e, f) {
  showMenu(e.clientX, e.clientY, [
    {
      label: 'Open',
      action: () => openFolderInDashboard(f.id, { push: true }),
    },
    'hr',
    {
      label: 'New note here',
      action: () => newNote(f.id),
    },
    {
      label: 'New sub-folder',
      action: () => newFolder(f.id),
    },
    {
      label: 'Select folder contents',
      action: () => selectFolderSubtree(f.id),
    },
    {
      label: 'Icon & color…',
      action: () => editItemsIconColor([folderKey(f.id)]),
    },
    {
      label: 'Rename…',
      action: () => renameTreeFolder(f.id),
    },
    {
      label: 'Move to folder…',
      action: () => moveSelectedToFolder([folderKey(f.id)]),
    },
    'hr',
    {
      label: 'Delete folder',
      danger: true,
      action: async () => {
        const directNotes = [...state.notes.values()].filter((n) => n.folderId === f.id);
        const directFolders = [...state.folders.values()].filter((x) => x.parentId === f.id);

        const msg = directNotes.length || directFolders.length
          ? `Delete "${f.name || 'Folder'}" and move ${directNotes.length} note(s), ${directFolders.length} sub-folder(s) out of it?`
          : `Delete "${f.name || 'Folder'}"?`;

        if (!confirm(msg)) return;

        for (const n of directNotes) {
          n.folderId = f.parentId || null;
          n.updated = Date.now();

          await store.notes.put(n);

          window.dispatchEvent(new CustomEvent('yanta-note-updated', {
            detail: { noteId: n.id },
          }));
        }

        for (const child of directFolders) {
          child.parentId = f.parentId || null;
          child.updated = Date.now();

          await store.folders.put(child);
        }

        await store.folders.del(f.id);

        state.folders.delete(f.id);
        state.expandedFolders.delete(f.id);

        selection.keys.delete(folderKey(f.id));

        window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));

        renderTree();
      },
    },
  ]);
}

function bulkMenu(e, items) {
  const notes = selectedNotes(items);
  const folders = selectedFolders(items);

  const count = items.length;
  const noteCount = notes.length;
  const folderCount = folders.length;

  const anyUnpinned = notes.some((n) => !n.pinned);
  const anyPinned = notes.some((n) => n.pinned);

  const menu = [
    {
      label: `${count} selected · ${noteCount} note${noteCount === 1 ? '' : 's'} · ${folderCount} folder${folderCount === 1 ? '' : 's'}`,
      disabled: true,
      meta: true,
    },
    'hr',
  ];

  if (noteCount) {
    menu.push({
      label: anyUnpinned ? `Pin selected note${noteCount === 1 ? '' : 's'}` : 'Pin selected notes',
      disabled: !anyUnpinned,
      action: () => bulkSetPinned(notes, true),
    });

    menu.push({
      label: anyPinned ? `Unpin selected note${noteCount === 1 ? '' : 's'}` : 'Unpin selected notes',
      disabled: !anyPinned,
      action: () => bulkSetPinned(notes, false),
    });
  }

  menu.push({
    label: 'Icon & color for selected…',
    action: () => editItemsIconColor(items.map((x) => x.key)),
  });

  menu.push({
    label: 'Move selected to folder…',
    action: () => moveSelectedToFolder(items.map((x) => x.key)),
  });

  if (noteCount) {
    menu.push({
      label: `Duplicate selected note${noteCount === 1 ? '' : 's'}`,
      action: () => duplicateNotes(notes),
    });
  }

  menu.push('hr');

  menu.push({
    label: 'Clear selection',
    action: () => {
      selection.keys.clear();
      selection.anchorKey = null;
      renderTree();
    },
  });

  menu.push({
    label: 'Delete selected items',
    danger: true,
    action: () => deleteSelectedItems(items),
  });

  showMenu(e.clientX, e.clientY, menu);
}

// ============================================================
// Bulk operations
// ============================================================

async function bulkSetPinned(notes, pinned) {
  for (const n of notes) {
    n.pinned = pinned;
    n.updated = Date.now();

    await store.notes.put(n);
  }

  renderTree();

  toast(
    `${pinned ? 'Pinned' : 'Unpinned'} ${notes.length} note${notes.length === 1 ? '' : 's'}`,
    'success'
  );
}

async function editItemsIconColor(keys) {
  const cleanKeys = [...new Set(keys || [])]
    .map((key) => {
      const { kind, id } = parseTreeKey(key);

      if (kind === 'note' && state.notes.has(id)) return noteKey(id);
      if (kind === 'folder' && state.folders.has(id)) return folderKey(id);

      return null;
    })
    .filter(Boolean);

  if (!cleanKeys.length) {
    toast('Nothing selected', 'info');
    return;
  }

  const {
    editNoteAppearance,
    editFolderAppearance,
    editTreeAppearanceTargets,
  } = await import('./graph.js');

  // Single note/folder: use exactly the same Graph picker/scopes.
  if (cleanKeys.length === 1) {
    const { kind, id } = parseTreeKey(cleanKeys[0]);

    if (kind === 'note') {
      const note = state.notes.get(id);
      if (note) editNoteAppearance(note);
      return;
    }

    if (kind === 'folder') {
      const folder = state.folders.get(id);
      if (folder) editFolderAppearance(folder);
      return;
    }
  }

  // Multi-selection: use the shared Graph appearance picker with Tree scopes.
  editTreeAppearanceTargets(cleanKeys, {
    title: `Icon & color for ${cleanKeys.length} selected items`,
  });
}

function folderPath(folderId) {
  if (!folderId) return '';

  const parts = [];
  const seen = new Set();

  let f = state.folders.get(folderId);

  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    parts.unshift(f.name || 'Folder');
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return parts.join(' / ');
}

function chooseFolderPrompt({ title = 'Move to folder:' } = {}) {
  const folders = [...state.folders.values()]
    .sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)));

  const opts = ['(no folder)', ...folders.map((f) => folderPath(f.id) || f.name || 'Folder')];

  const choice = prompt(
    `${title}\n\n${opts.map((o, i) => `${i}. ${o}`).join('\n')}\n\nEnter number:`
  );

  if (choice === null) return undefined;

  const idx = parseInt(choice, 10);

  if (Number.isNaN(idx) || idx < 0 || idx >= opts.length) {
    toast('Invalid folder selection', 'error');
    return undefined;
  }

  return idx === 0 ? null : folders[idx - 1].id;
}

async function moveSelectedToFolder(keys = [...selection.keys]) {
  const targetFolderId = chooseFolderPrompt();
  if (targetFolderId === undefined) return;

  let moved = 0;
  let skipped = 0;

  for (const key of keys) {
    const { kind, id } = parseTreeKey(key);

    if (kind === 'note') {
      const n = state.notes.get(id);
      if (!n) continue;

      n.folderId = targetFolderId || null;
      n.updated = Date.now();

      await store.notes.put(n);
      moved++;
    } else if (kind === 'folder') {
      const f = state.folders.get(id);
      if (!f) continue;

      // Avoid cycles.
      if (targetFolderId && (targetFolderId === f.id || isAncestor(f.id, targetFolderId))) {
        skipped++;
        continue;
      }

      f.parentId = targetFolderId || null;

      await store.folders.put(f);
      moved++;
    }
  }

  if (targetFolderId) {
    state.expandedFolders.add(targetFolderId);
  }

  renderTree();

  if (skipped) {
    toast(`Moved ${moved}; skipped ${skipped} invalid folder move${skipped === 1 ? '' : 's'}`, 'error');
  } else {
    toast(`Moved ${moved} item${moved === 1 ? '' : 's'}`, 'success');
  }
}

async function duplicateNotes(notes) {
  let created = 0;

  for (const n of notes) {
    await duplicateNote(n, { openCreated: false });
    created++;
  }

  renderTree();

  toast(`Duplicated ${created} note${created === 1 ? '' : 's'}`, 'success');
}

async function duplicateNote(src, { openCreated = true } = {}) {
  const id = uid();

  const n = {
    ...src,
    id,
    title: (src.title || 'Untitled') + ' (copy)',
    created: Date.now(),
    updated: Date.now(),
  };

  delete n.body;
  delete n.bodyMigrated;

  await store.notes.put(n);
  state.notes.set(n.id, n);

  // Ensure source Y.Doc is loaded before reading.
  try {
    const srcEntry = getNoteDoc(src.id);
    await srcEntry.ready;

    const dstEntry = getNoteDoc(id);
    await dstEntry.ready;

    const body = noteMarkdown(src.id);

    if (body) {
      dstEntry.doc.getText('markdown').insert(0, body);
    }

    state.searchIndex.set(
      id,
      [n.title || '', (n.tags || []).join(' '), body].join(' ').toLowerCase()
    );
  } catch {}

  rebuildWikilinkIndex();

  if (openCreated) {
    renderTree();
    openNote(n.id);
  }

  return n;
}

function selectFolderSubtree(folderId) {
  const keys = new Set();
  keys.add(folderKey(folderId));

  const folders = collectFolderIdsRecursive(folderId);

  for (const id of folders) {
    keys.add(folderKey(id));
  }

  for (const n of state.notes.values()) {
    if (n.folderId && folders.has(n.folderId)) {
      keys.add(noteKey(n.id));
    }
  }

  selection.keys = keys;
  selection.anchorKey = folderKey(folderId);

  renderTree();
}

function collectFolderIdsRecursive(rootId) {
  const out = new Set([rootId]);
  const stack = [rootId];

  while (stack.length) {
    const cur = stack.pop();

    for (const f of state.folders.values()) {
      if (f.parentId === cur && !out.has(f.id)) {
        out.add(f.id);
        stack.push(f.id);
      }
    }
  }

  return out;
}

async function deleteSelectedItems(items = getSelectedItems()) {
  const selectedFolderIds = new Set(
    selectedFolders(items).map((f) => f.id)
  );

  const selectedNoteIds = new Set(
    selectedNotes(items).map((n) => n.id)
  );

  const allFolderIds = new Set();

  for (const folderId of selectedFolderIds) {
    for (const id of collectFolderIdsRecursive(folderId)) {
      allFolderIds.add(id);
    }
  }

  const allNoteIds = new Set(selectedNoteIds);

  for (const n of state.notes.values()) {
    if (n.folderId && allFolderIds.has(n.folderId)) {
      allNoteIds.add(n.id);
    }
  }

  const msgParts = [];

  if (allNoteIds.size) {
    msgParts.push(`${allNoteIds.size} note${allNoteIds.size === 1 ? '' : 's'}`);
  }

  if (allFolderIds.size) {
    msgParts.push(`${allFolderIds.size} folder${allFolderIds.size === 1 ? '' : 's'}`);
  }

  if (!msgParts.length) return;

  const recursiveWarning = allFolderIds.size
    ? '\n\nFolders are deleted together with all notes and sub-folders inside them.'
    : '';

  if (!confirm(`Delete ${msgParts.join(' and ')}? This cannot be undone.${recursiveWarning}`)) {
    return;
  }

  await deleteNotesAndFolders({
    noteIds: allNoteIds,
    folderIds: allFolderIds,
    recursiveFolders: true,
  });
}

async function deleteNotesAndFolders({ noteIds, folderIds, recursiveFolders = true }) {
  const deletedCurrent = noteIds.has(state.currentNoteId);

  for (const noteId of noteIds) {
    const n = state.notes.get(noteId);
    if (!n) continue;

    await store.notes.del(noteId);
    state.notes.delete(noteId);
    state.searchIndex.delete(noteId);

    await destroyNoteDoc(noteId);

    syncDeleteNoteFile(n).catch(() => {});
  }

  if (recursiveFolders) {
    for (const folderId of folderIds) {
      await store.folders.del(folderId);
      state.folders.delete(folderId);
      state.expandedFolders.delete(folderId);
    }
  }

  for (const key of [...selection.keys]) {
    if (!treeKeyExists(key)) {
      selection.keys.delete(key);
    }
  }

  if (selection.anchorKey && !treeKeyExists(selection.anchorKey)) {
    selection.anchorKey = selection.keys.values().next().value || null;
  }

  rebuildWikilinkIndex();

  if (deletedCurrent) {
    state.currentNoteId = null;

    const next = [...state.notes.values()].sort((a, b) => b.updated - a.updated)[0];

    if (next) {
      await openNote(next.id);
    } else {
      clearEditor();
    }
  }

  renderTree();

  toast('Deleted selected item(s)', 'success');
}

// ============================================================
// Public helper
// ============================================================

export function currentFolderForNew() {
  if (state.currentNoteId) {
    const n = state.notes.get(state.currentNoteId);
    return n?.folderId || null;
  }

  return null;
}