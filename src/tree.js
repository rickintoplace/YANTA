// ============================================================
// YANTA — Sidebar tree (folders + notes), tag cloud, context
// menus, drag-and-drop reorganisation, multi-select + bulk ops.
// ============================================================

import { $, el, uid, state, store, lucide, safeCssColor, toast, actionToast, isSpaceMountedFolder } from './core.js';

import { t } from './i18n/index.js';

import {
  openNote,
  newNote,
  newFolder,
  rebuildWikilinkIndex,
} from './notes.js';

import {
  getNoteDoc,
  noteMarkdown,
} from './yjs.js';

import { updateStorageMeter } from './core.js';
import { inlineTextEdit } from './inline-ui.js';

import {
  openFolderInDashboard,
  renameNoteById,
  renameFolderById,
} from './item-actions.js';

import {
  iconForContextMenuItem,
} from './context-menu-icons.js';

import {
  AI_BRAIN_IDS,
  isSystemItem,
} from './ai/brain.js';

import {
  isNoteInTrash,
  isFolderInTrash,
  collectTrashedRootItems,
  trashCount,
  trashItemsWithUndo,
  restoreNoteFromTrash,
  restoreFolderFromTrash,
  permanentlyDeleteNote,
  permanentlyDeleteFolder,
  emptyTrash,
} from './trash.js';

import {
  formatCalendarDateTime,
} from './calendar-preferences.js';

import {
  publicShareStateForNote,
  isPublicShareActive,
} from './public-share/public-share-publisher.js';

import {
  setAiContextDragData,
} from './ai/context-dnd.js';

import {
  AI_SESSION_IDS,
  isAiSessionNote,
} from './ai/ai-sessions.js';

import {
  yantaConfirm,
  yantaFolderPicker,
} from './dialogs.js';

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

function isArchivedItem(item) {
  return !!item && item.archived === true;
}

function isAiSessionsRootFolder(folder) {
  return !!folder && (
    folder.id === AI_SESSION_IDS.rootFolder ||
    folder.aiSessionRoot === true
  );
}

function isMainTreeItem(item) {
  return (
    !isSpaceMountedFolder(item) &&
    !isSystemItem(item) &&
    !isArchivedItem(item) &&
    !isFolderInTrash(item)
  );
}

function isSystemFolder(f) {
  return !!f && isSystemItem(f) && !isFolderInTrash(f);
}

function isArchivedFolder(f) {
  return !!f && isArchivedItem(f) && !isFolderInTrash(f);
}

function noteBelongsToSystem(note) {
  return (
    !isNoteInTrash(note) &&
    (
      isSystemItem(note) ||
      isSystemFolder(state.folders.get(note.folderId))
    )
  );
}

function noteBelongsToArchived(note) {
  return (
    !isNoteInTrash(note) &&
    (
      isArchivedItem(note) ||
      isArchivedFolder(state.folders.get(note.folderId))
    )
  );
}

// Notes mounted from someone else's shared space live in their own
// "Shared with me" section — they have no place in the user's folders.
function noteBelongsToShared(note) {
  return !isNoteInTrash(note) && !!note.spaceId;
}

function noteBelongsToMain(note) {
  return (
    !isNoteInTrash(note) &&
    !noteBelongsToShared(note) &&
    !noteBelongsToSystem(note) &&
    !noteBelongsToArchived(note)
  );
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

const TREE_TRASH_EXPANDED_KEY = 'yanta.tree.trashExpanded.v1';

function isTrashExpanded() {
  try {
    return localStorage.getItem(TREE_TRASH_EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

function setTrashExpanded(value) {
  try {
    localStorage.setItem(TREE_TRASH_EXPANDED_KEY, value ? 'true' : 'false');
  } catch {}
}

function toggleTrashExpanded() {
  setTrashExpanded(!isTrashExpanded());
  renderTree();
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

      // Keyboard-only tree navigation: arrows move between rows,
      // Enter activates (open note / toggle folder), ArrowUp from the
      // first row returns to the search field.
      const row = e.target?.closest?.('.tree-row[data-tree-key]');
      if (!row) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();

        const rows = [...root.querySelectorAll('.tree-row[data-tree-key]')];
        const i = rows.indexOf(row);

        if (e.key === 'ArrowUp' && i === 0) {
          $('search')?.focus();
          return;
        }

        rows[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        row.click();
      }
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

let folderCreatedRenameBound = false;

function bindFolderCreatedRenameRequest() {
  if (folderCreatedRenameBound) return;
  folderCreatedRenameBound = true;

  window.addEventListener('yanta-folder-created', (e) => {
    const folderId = e.detail?.folderId;
    const focusRename = e.detail?.focusRename !== false;

    if (!folderId || !focusRename) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        renameTreeFolder(folderId);
      });
    });
  });
}

// ============================================================
// Render
// ============================================================

export function renderTree() {
  const root = $('tree');
  if (!root) return;

  bindFolderCreatedRenameRequest();
  bindTreeKeyboardShortcuts(root);

  pruneDeadSelection();

  visibleTreeOrder = [];
  root.replaceChildren();

  const q = String(state.searchQuery || '').toLowerCase();
  const filterTag = state.activeTagFilter;

  const visible = [...state.notes.values()].filter((n) => {
    if (isNoteInTrash(n)) return false;

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

  const visibleMain = visible.filter(noteBelongsToMain);
  const visibleSystem = visible.filter(noteBelongsToSystem);
  const visibleArchived = visible.filter(noteBelongsToArchived);

  /*
    Bei aktiver Suche/Tag-Filter nur Ordner zeigen, die (transitiv)
    Treffer enthalten — leere Ordnerskelette verstecken die Treffer
    sonst zwischen irrelevantem Rauschen.
  */
  const filterActive = !!(q || filterTag);
  const foldersWithMatches = new Set();

  if (filterActive) {
    for (const n of visible) {
      let f = n.folderId ? state.folders.get(n.folderId) : null;
      const seen = new Set();

      while (f && !seen.has(f.id)) {
        foldersWithMatches.add(f.id);
        seen.add(f.id);
        f = f.parentId ? state.folders.get(f.parentId) : null;
      }
    }
  }

  const folderHasMatches = (f) => !filterActive || foldersWithMatches.has(f.id);

const pinned = visible
  .filter((n) => n.pinned)
  .sort((a, b) => b.updated - a.updated);

if (pinned.length) {
  const sec = el('div', { class: 'tree-section tree-section-pinned' });
  sec.append(el('div', { class: 'tree-section-title' }, t('tree.section.pinned')));

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

  const visibleShared = visible.filter(noteBelongsToShared);

  const sharedFolders = [...state.folders.values()]
    .filter(isSpaceMountedFolder)
    .filter(folderHasMatches)
    .filter((f) => !f.parentId || !isSpaceMountedFolder(state.folders.get(f.parentId)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Notes shared individually (not part of a shared workspace folder).
  const sharedRootNotes = visibleShared
    .filter((n) => !n.folderId || !isSpaceMountedFolder(state.folders.get(n.folderId)))
    .sort((a, b) => b.updated - a.updated);

  if (sharedFolders.length || sharedRootNotes.length) {
    const sec = el('div', { class: 'tree-section tree-section-shared' });
    sec.append(el('div', { class: 'tree-section-title' }, t('tree.section.sharedWithMe')));

    for (const n of sharedRootNotes) {
      sec.append(noteRow(n, 0));
    }

    for (const f of sharedFolders) {
      sec.append(folderRow(f, visibleShared, 0, {
        folderFilter: isSpaceMountedFolder,
      }));
    }

    root.append(sec);
  }

  const folderSec = el('div', { class: 'tree-section' });

  const ftitle = el(
    'div',
    { class: 'tree-section-title' },
    t('tree.section.root'),
    el('button', {
      class: 'icon-btn',
      title: t('tree.newFolder'),
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

    await handleTreeDropToFolder(e, {
      targetFolderId: null,
      source: 'tree-drop-root',
    });
  });

  folderSec.append(ftitle);

  const orphanNotes = visibleMain
    .filter((n) => !n.folderId)
    .sort((a, b) => b.updated - a.updated);

  for (const n of orphanNotes) {
    folderSec.append(noteRow(n));
  }

  const topFolders = [...state.folders.values()]
    .filter(isMainTreeItem)
    .filter(folderHasMatches)
    .filter((f) => !f.parentId || !state.folders.has(f.parentId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  for (const f of topFolders) {
    folderSec.append(folderRow(f, visibleMain, 0, {
      folderFilter: isMainTreeItem,
    }));
  }

  if (!topFolders.length && !orphanNotes.length) {
    folderSec.append(el('div', { class: 'tree-empty' }, q || filterTag ? t('tree.noMatches') : t('tree.noNotesYet')));
  }

  root.append(folderSec);

  const archivedFolders = [...state.folders.values()]
    .filter(isArchivedFolder)
    .filter(folderHasMatches)
    .filter((f) => !f.parentId || !isArchivedFolder(state.folders.get(f.parentId)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const archivedRootNotes = visibleArchived
    .filter((n) => !n.folderId || !isArchivedFolder(state.folders.get(n.folderId)))
    .sort((a, b) => b.updated - a.updated);

  if (archivedFolders.length || archivedRootNotes.length) {
    const archivedSec = el('div', { class: 'tree-section tree-section-archived' });
    archivedSec.append(el('div', { class: 'tree-section-title' }, t('tree.section.archived')));

    for (const n of archivedRootNotes) {
      archivedSec.append(noteRow(n));
    }

    for (const f of archivedFolders) {
      archivedSec.append(folderRow(f, visibleArchived, 0, {
        folderFilter: isArchivedFolder,
      }));
    }

    root.append(archivedSec);
  }

  const trashItems = collectTrashedRootItems();
  const totalTrashCount = trashCount();

  if (totalTrashCount > 0) {
    root.append(trashRootFolderRow(trashItems, totalTrashCount));
  }

  const systemFolders = [...state.folders.values()]
    .filter(isSystemFolder)
    .filter(folderHasMatches)
    .filter((f) => !f.parentId || !isSystemFolder(state.folders.get(f.parentId)))
    .sort((a, b) => {
      if (a.id === AI_BRAIN_IDS.rootFolder) return -1;
      if (b.id === AI_BRAIN_IDS.rootFolder) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

  const systemRootNotes = visibleSystem
    .filter((n) => !n.folderId || !isSystemFolder(state.folders.get(n.folderId)))
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

  if (systemFolders.length || systemRootNotes.length) {
    const systemSec = el('div', { class: 'tree-section tree-section-system' });
    systemSec.append(el('div', { class: 'tree-section-title' }, t('tree.section.system')));

    for (const n of systemRootNotes) {
      systemSec.append(noteRow(n));
    }

    for (const f of systemFolders) {
      systemSec.append(folderRow(f, visibleSystem, 0, {
        folderFilter: isSystemFolder,
      }));
    }

    root.append(systemSec);
  }

  normalizeCollapsedTreeIndents(root);

  if (q && q.length >= 3) {
    scheduleSemanticTreeResults(root, q, new Set(visible.map((n) => n.id)));
  }

  requestAnimationFrame(() => {
    updateActiveTreeIndicator(root);
    restoreTreeFocusSoon();
  });

  renderTagCloud();
  updateStorageMeter();
}

/*
  Hybrid search, second stage: keyword results above render instantly
  and untouched; semantic hits the keyword filter missed arrive async
  and append below as "Related matches". Everything degrades silently
  — feature off, model loading, worker error: the tree looks exactly
  like before.
*/
let semanticTreeToken = 0;

async function scheduleSemanticTreeResults(root, q, visibleIds) {
  const token = ++semanticTreeToken;

  let semantic;

  try {
    semantic = await import('./semantic/semantic-index.js');
  } catch {
    return;
  }

  if (!semantic.semanticEnabled() || !semantic.semanticReady()) return;

  let results = [];

  try {
    results = await semantic.semanticSearchDebounced(q, { topK: 10 });
  } catch {
    return;
  }

  // Stale guards: newer render, changed query, or the root left the DOM.
  if (token !== semanticTreeToken) return;
  if (String(state.searchQuery || '').toLowerCase() !== q) return;
  if (!root.isConnected) return;

  const rows = results
    .map((r) => ({ note: state.notes.get(r.noteId), preview: r.preview }))
    .filter(({ note }) => note && !visibleIds.has(note.id) && !isNoteInTrash(note))
    .slice(0, 6);

  if (!rows.length) return;

  const sec = el('div', { class: 'tree-section tree-section-semantic' });

  const title = el('div', { class: 'tree-section-title' }, t('tree.section.relatedMatches'));
  title.title = t('tree.section.relatedMatchesTitle');
  sec.append(title);

  for (const { note } of rows) {
    sec.append(noteRow(note, 0, { registerOrder: false }));
  }

  root.append(sec);
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

function uniqueNonEmptyStrings(values = []) {
  return [...new Set(
    [...values]
      .map((value) => String(value || ''))
      .filter(Boolean)
  )];
}

function clearTreeSelection() {
  selection.keys.clear();
  selection.anchorKey = null;
  lastTreeFocusKey = null;
}

function topLevelFolderIds(folderIds = []) {
  const ids = uniqueNonEmptyStrings(folderIds);

  return ids.filter((folderId) => {
    if (!state.folders.has(folderId)) return false;

    for (const otherId of ids) {
      if (otherId !== folderId && isAncestor(otherId, folderId)) {
        return false;
      }
    }

    return true;
  });
}

function noteIsInsideAnyFolder(note, folderIds = []) {
  if (!note?.folderId) return false;

  for (const folderId of folderIds) {
    if (
      note.folderId === folderId ||
      isAncestor(folderId, note.folderId)
    ) {
      return true;
    }
  }

  return false;
}

function canMoveFolderToParent(folderId, targetParentId) {
  if (!folderId || !state.folders.has(folderId)) return false;
  if (!targetParentId) return true;
  if (!state.folders.has(targetParentId)) return false;
  if (targetParentId === folderId) return false;
  if (isAncestor(folderId, targetParentId)) return false;

  return true;
}

function emitTreeStructureChanged(reason, detail = {}) {
  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
    detail: {
      reason,
      source: 'tree',
      ...detail,
    },
  }));
}

async function setNoteArchived(note, archived) {
  if (!note) return;

  note.archived = !!archived;
  note.updated = Date.now();

  await store.notes.put(note);

  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));
  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId: note.id,
      reason: note.archived ? 'archived' : 'unarchived',
    },
  }));
}

async function setFolderArchived(folder, archived) {
  if (!folder) return;

  folder.archived = !!archived;
  folder.updated = Date.now();

  await store.folders.put(folder);

  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));
  window.dispatchEvent(new CustomEvent('yanta-folder-updated', {
    detail: {
      folderId: folder.id,
      reason: folder.archived ? 'archived' : 'unarchived',
    },
  }));
}

async function undoMoveToFolder(noteOrigins = [], folderOrigins = []) {
  let restored = 0;

  for (const { id, folderId } of noteOrigins) {
    const note = state.notes.get(id);
    if (!note) continue;

    if ((note.folderId || null) === (folderId || null)) continue;

    note.folderId = folderId || null;
    note.updated = Date.now();

    await store.notes.put(note);
    restored++;
  }

  for (const { id, parentId } of folderOrigins) {
    const folder = state.folders.get(id);
    if (!folder) continue;

    if ((folder.parentId || null) === (parentId || null)) continue;
    if (!canMoveFolderToParent(id, parentId || null)) continue;

    folder.parentId = parentId || null;
    folder.updated = Date.now();

    await store.folders.put(folder);
    restored++;
  }

  if (!restored) return;

  emitTreeStructureChanged('tree-bulk-move-undo', {});
  renderTree();

  toast(t('tree.moveUndone'), 'success');
}

async function moveNotesToFolder(noteIds = [], targetFolderId = null, source = 'tree-drop') {
  const target = targetFolderId || null;
  let moved = 0;

  for (const noteId of uniqueNonEmptyStrings(noteIds)) {
    const note = state.notes.get(noteId);
    if (!note) continue;

    if (isNoteInTrash(note)) {
      if (await restoreNoteFromTrash(noteId, {
        targetFolderId: target,
        source,
      })) {
        moved++;
      }

      continue;
    }

    if ((note.folderId || null) === target) {
      continue;
    }

    note.folderId = target;
    note.updated = Date.now();

    await store.notes.put(note);
    moved++;
  }

  return moved;
}

async function moveFoldersToParent(folderIds = [], targetParentId = null, source = 'tree-drop') {
  const target = targetParentId || null;
  let moved = 0;
  let skipped = 0;

  for (const folderId of topLevelFolderIds(folderIds)) {
    const folder = state.folders.get(folderId);
      if (isAiSessionsRootFolder(folder)) {
      skipped++;
      continue;
    }
    if (!folder) continue;

    if (!canMoveFolderToParent(folderId, target)) {
      skipped++;
      continue;
    }

    if (isFolderInTrash(folder)) {
      if (await restoreFolderFromTrash(folderId, {
        targetParentId: target,
        source,
      })) {
        moved++;
      }

      continue;
    }

    if ((folder.parentId || null) === target) {
      continue;
    }

    folder.parentId = target;
    folder.updated = Date.now();

    await store.folders.put(folder);
    moved++;
  }

  if (target && moved) {
    state.expandedFolders.add(target);
  }

  return {
    moved,
    skipped,
  };
}

async function handleTreeDropToFolder(e, {
  targetFolderId = null,
  source = 'tree-drop',
} = {}) {
  e.preventDefault();
  e.stopPropagation();

  if (targetFolderId === AI_SESSION_IDS.rootFolder) {
    toast(t('tree.aiSessionsNoManualItems'), 'error');
    return;
  }

  const noteId = e.dataTransfer.getData('text/yanta-note');
  const folderId = e.dataTransfer.getData('text/yanta-folder');

  let moved = 0;
  let skipped = 0;

  if (noteId) {
    moved = await moveNotesToFolder(
      draggedNoteIds(noteId),
      targetFolderId,
      source
    );
  } else if (folderId) {
    const result = await moveFoldersToParent(
      draggedFolderIds(folderId),
      targetFolderId,
      source
    );

    moved = result.moved;
    skipped = result.skipped;
  }

  if (!moved && !skipped) {
    return;
  }

  emitTreeStructureChanged(source, {
    targetFolderId: targetFolderId || null,
    moved,
    skipped,
  });

  renderTree();

  if (skipped) {
    toast(
      t('tree.movedSkipped', { count: skipped, moved, skipped }),
      'error'
    );
  }
}

function folderRow(f, visibleNotes, depth, {
  folderFilter = isMainTreeItem,
} = {}) {
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
  // Bei aktiver Suche auto-expandieren — die Treffer sollen sichtbar
  // sein, nicht hinter zugeklappten Ordnern stecken. Der gespeicherte
  // Expand-Zustand bleibt unangetastet.
  const searchActive = !!(String(state.searchQuery || '').trim() || state.activeTagFilter);
  const expanded = searchActive || state.expandedFolders.has(f.id);
  const selected = isSelected(key);
  const isAnchor = selection.anchorKey === key;

  const isCurrentPath = currentFolderTrailSet().has(f.id);
  const lockedAiSessionsFolder = isAiSessionsRootFolder(f);

  const childFolders = [...state.folders.values()]
    .filter((x) => x.parentId === f.id)
    .filter(folderFilter)
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
      if (lockedAiSessionsFolder) return;

      const types = [...(e.dataTransfer.types || [])];
      if (!types.includes('text/yanta-note') && !types.includes('text/yanta-folder')) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    },
    ondragleave: () => row.classList.remove('drop-target'),
    ondrop: async (e) => {
      row.classList.remove('drop-target');

      if (lockedAiSessionsFolder) {
        e.preventDefault();
        e.stopPropagation();
        toast(t('tree.aiSessionsNoManualItems'), 'error');
        return;
      }

      await handleTreeDropToFolder(e, {
        targetFolderId: f.id,
        source: 'tree-drop-folder',
      });
    },
  });

  applyItemColor(row, f.color);
  applyCollapsedTreeDepth(row, depth);

  row.draggable = !lockedAiSessionsFolder;
  row.addEventListener('dragstart', (e) => {
    if (lockedAiSessionsFolder) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!isSelected(key)) setOnlySelection(key);

    const selected = getSelectedItems();

    setAiContextDragData(
      e.dataTransfer,
      selected.length > 1 && selected.some((item) => item.key === key)
        ? selected.map((item) => ({ kind: item.kind, id: item.id }))
        : [{ kind: 'folder', id: f.id }]
    );

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

  row.append(el('span', { class: 'label' }, f.name || t('items.folderFallback')));

    const childCount = childFolders.length + childNotes.length;

  if (childCount > 0) {
    row.append(el('span', {
      class: 'tree-folder-count',
      title: t('tree.itemCount', { count: childCount }),
    }, String(childCount)));
  }

  if (f.spaceId) {
    const badge = el('span', {
      class: 'public-share-dot',
      title: f.spaceRole === 'write'
        ? t('tree.folder.sharedWrite')
        : t('tree.folder.sharedRead'),
    });

    badge.innerHTML = lucide(f.spaceRole === 'write' ? 'pencil' : 'eye', 11);
    row.append(badge);
  } else {
    for (const spaceSession of state.spaces.values()) {
      if (spaceSession.record?.rootFolderId === f.id && spaceSession.role === 'owner') {
        row.append(el('span', { class: 'live-dot', title: t('tree.folder.liveWorkspace') }));
        break;
      }
    }
  }

  if (!lockedAiSessionsFolder) {
    row.append(el('span', {
      class: 'menu-trigger',
      title: t('tree.addNote'),
      onclick: (e) => {
        e.stopPropagation();
        newNote(f.id);
      },
    }, '+'));
  }

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
      kids.append(folderRow(sf, visibleNotes, depth + 1, {
        folderFilter,
      }));
    }

    for (const n of childNotes) {
      kids.append(noteRow(n, depth + 1));
    }

    if (!childFolders.length && !childNotes.length) {
      kids.append(el('div', { class: 'tree-empty' }, t('tree.empty')));
    }

    wrap.append(kids);
  }

  return wrap;
}

function trashItemDeletedLabel(item) {
  const ts = Number(item?.deletedAt || 0);

  if (!ts) return t('tree.trash.inTrash');

  try {
    return formatCalendarDateTime(ts, {
      allDay: false,
      editor: false,
      includeWeekday: false,
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function trashRootFolderRow(trashItems, totalTrashCount) {
  const expanded = isTrashExpanded();

  const wrap = el('div', {
    class: 'tree-section tree-section-trash tree-folder-node trash-root-node',
    dataset: {
      treeKey: 'trash:root',
      folderId: 'trash',
      treeDepth: '0',
    },
  });

  const row = el('div', {
    class:
      'tree-row folder trash-root-row' +
      (expanded ? ' expanded' : ''),
    dataset: {
      treeKey: 'trash:root',
      folderId: 'trash',
      treeDepth: '0',
    },
    tabindex: '0',
    style: {
      paddingLeft: '12px',
    },
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTrashExpanded();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTrashExpanded();
      }
    },
    oncontextmenu: (e) => {
      e.preventDefault();
      e.stopPropagation();

      showMenu(e.clientX, e.clientY, [
        {
          label: expanded ? t('tree.trash.collapse') : t('tree.trash.expand'),
          icon: expanded ? 'chevron-up' : 'chevron-down',
          action: toggleTrashExpanded,
        },
        'hr',
        {
          label: t('tree.trash.empty'),
          icon: 'shredder',
          danger: true,
          action: async () => {
            const ok = await yantaConfirm({
              title: t('tree.trash.emptyConfirmTitle'),
              message: t('tree.trash.emptyConfirmMessage', { count: totalTrashCount }),
              confirmLabel: t('tree.trash.empty'),
              icon: 'shredder',
              danger: true,
            });

            if (ok) {
              await emptyTrash();
            }
          },
        },
      ]);
    },
    ondragover: (e) => {
      const types = [...(e.dataTransfer?.types || [])];

      if (!types.includes('text/yanta-note') && !types.includes('text/yanta-folder')) {
        return;
      }

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    },
    ondragleave: () => {
      row.classList.remove('drop-target');
    },
    ondrop: async (e) => {
      row.classList.remove('drop-target');
      e.preventDefault();
      e.stopPropagation();

      const noteId = e.dataTransfer.getData('text/yanta-note');
      const folderId = e.dataTransfer.getData('text/yanta-folder');

      const noteIds = noteId
        ? draggedNoteIds(noteId)
        : [];

      const folderIds = folderId
        ? draggedFolderIds(folderId)
        : [];

      const { changed } = await trashItemsWithUndo({
        noteIds,
        folderIds,
        source: 'tree-drop-trash',
      });

      if (!changed) return;

      clearTreeSelection();
      renderTree();
    },
  });

  applyCollapsedTreeDepth(row, 0);

  row.append(el('span', { class: 'twist' }, expanded ? '▾' : '▸'));

  const icon = itemIcon('trash', '');
  icon.classList.add('tree-folder-icon', 'tree-trash-root-icon');
  row.append(icon);

  row.append(el('span', { class: 'label' }, t('tree.section.trash')));

  row.append(el('span', {
    class: 'tree-folder-count',
    title: t('tree.trash.countInTrash', { count: totalTrashCount }),
  }, String(totalTrashCount)));

  wrap.append(row);

  if (expanded) {
    const kids = el('div', { class: 'tree-children tree-trash-children' });

    for (const folder of trashItems.folders) {
      kids.append(trashFolderRow(folder, 1));
    }

    for (const note of trashItems.notes) {
      kids.append(trashNoteRow(note, 1));
    }

    if (!trashItems.folders.length && !trashItems.notes.length) {
      kids.append(el('div', { class: 'tree-empty' }, t('tree.trash.isEmpty')));
    }

    wrap.append(kids);
  }

  return wrap;
}

function trashNoteRow(note, depth = 0) {
  const key = noteKey(note.id);
  visibleTreeOrder.push(key);

  const selected = isSelected(key);
  const isAnchor = selection.anchorKey === key;
  const isActive = state.currentNoteId === note.id;

  const row = el('div', {
    class:
      'tree-row note trash-row' +
      (isActive ? ' active' : '') +
      (selected ? ' selected' : '') +
      (isAnchor ? ' selection-anchor' : ''),
    dataset: {
      treeKey: key,
      noteId: note.id,
      treeDepth: String(depth),
      trashed: '1',
    },
    tabindex: '0',
    draggable: 'true',
    style: {
      paddingLeft: (12 + depth * 14) + 'px',
    },
    onclick: (e) => handleTreeSelectionClick(e, key, () => {
      openNote(note.id);
      window.dispatchEvent(new CustomEvent('yanta-close-mobile-sidebar'));
    }),
    oncontextmenu: (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!isSelected(key)) {
        setOnlySelection(key);
        renderTree();
      }

      showMenu(e.clientX, e.clientY, [
        {
          label: t('tree.trash.restore'),
          icon: 'undo-2',
          action: () => restoreNoteFromTrash(note.id),
        },
        {
          label: t('tree.trash.restoreToFolder'),
          icon: 'folder-input',
          action: async () => {
            const folderId = await yantaFolderPicker({
              title: t('tree.trash.restoreNoteTitle'),
              allowNone: true,
              noneLabel: t('tree.trash.homeNoFolder'),
              isDisabled(folder) {
                return isFolderInTrash(folder);
              },
              disabledHint: t('tree.trash.folderInTrash'),
            });

            if (folderId !== undefined) {
              await restoreNoteFromTrash(note.id, {
                targetFolderId: folderId,
              });
            }
          },
        },
        'hr',
        {
          label: t('tree.trash.deletePermanently'),
          icon: 'shredder',
          danger: true,
          action: async () => {
            const ok = await yantaConfirm({
              title: t('tree.trash.deleteNoteConfirmTitle'),
              message: t('tree.trash.deleteNoteConfirmMessage', { title: note.title || t('note.untitled') }),
              confirmLabel: t('tree.trash.deletePermanently'),
              danger: true,
            });

            if (ok) {
              await permanentlyDeleteNote(note.id);
            }
          },
        },
      ]);
    },
    ondragstart: (e) => {
      if (!isSelected(key)) setOnlySelection(key);

      e.dataTransfer.setData('text/yanta-note', note.id);
      e.dataTransfer.setData('text/plain', note.title || t('note.untitled'));
      e.dataTransfer.effectAllowed = 'move';
    },
  });

  applyItemColor(row, note.color);
  applyCollapsedTreeDepth(row, depth);

  if (isActive) {
    row.append(activeNoteMarker(depth));
  }

  row.append(itemIcon(note.icon || (note.type === 'list' ? 'list' : 'file'), note.color));
  row.append(el('span', { class: 'label' }, note.title || t('note.untitled')));
  row.append(el('span', { class: 'tree-trash-meta' }, trashItemDeletedLabel(note)));

  return row;
}

function trashFolderRow(folder, depth = 0) {
  const key = folderKey(folder.id);
  visibleTreeOrder.push(key);

  const expanded = state.expandedFolders.has(folder.id);
  const selected = isSelected(key);
  const isAnchor = selection.anchorKey === key;

  const wrap = el('div', {
    class: 'tree-node tree-folder-node trash-folder-node',
    dataset: {
      treeKey: key,
      folderId: folder.id,
      treeDepth: String(depth),
      trashed: '1',
    },
  });

  const row = el('div', {
    class:
      'tree-row folder trash-row' +
      (expanded ? ' expanded' : '') +
      (selected ? ' selected' : '') +
      (isAnchor ? ' selection-anchor' : ''),
    dataset: {
      treeKey: key,
      folderId: folder.id,
      treeDepth: String(depth),
      trashed: '1',
    },
    tabindex: '0',
    draggable: 'true',
    style: {
      paddingLeft: (12 + depth * 12) + 'px',
    },
    onclick: (e) => handleTreeSelectionClick(e, key, () => {
      toggleFolderAnimated(folder.id, expanded);
    }),
    oncontextmenu: (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!isSelected(key)) {
        setOnlySelection(key);
        renderTree();
      }

      showMenu(e.clientX, e.clientY, [
        {
          label: t('tree.trash.restoreFolder'),
          icon: 'undo-2',
          action: () => restoreFolderFromTrash(folder.id),
        },
        {
          label: t('tree.trash.restoreToFolder'),
          icon: 'folder-input',
          action: async () => {
            const parentId = await yantaFolderPicker({
              title: t('tree.trash.restoreFolderTitle'),
              allowNone: true,
              noneLabel: t('tree.trash.homeRoot'),
              isDisabled(target) {
                return (
                  isFolderInTrash(target) ||
                  target.id === folder.id ||
                  isAncestor(folder.id, target.id)
                );
              },
              disabledHint: t('tree.trash.invalidRestoreTarget'),
            });

            if (parentId !== undefined) {
              await restoreFolderFromTrash(folder.id, {
                targetParentId: parentId,
              });
            }
          },
        },
        'hr',
        {
          label: t('tree.trash.deleteFolderEllipsis'),
          danger: true,
          action: async () => {
            const ok = await yantaConfirm({
              title: t('tree.trash.deleteFolderConfirmTitle'),
              message: t('tree.trash.deleteFolderConfirmMessage', { name: folder.name || t('items.folderFallback') }),
              confirmLabel: t('tree.trash.deletePermanently'),
              danger: true,
            });

            if (ok) {
              await permanentlyDeleteFolder(folder.id);
            }
          },
        },
      ]);
    },
    ondragstart: (e) => {
      if (!isSelected(key)) setOnlySelection(key);

      e.dataTransfer.setData('text/yanta-folder', folder.id);
      e.dataTransfer.effectAllowed = 'move';
    },
  });

  applyItemColor(row, folder.color);
  applyCollapsedTreeDepth(row, depth);

  row.append(el('span', { class: 'twist' }, expanded ? '▾' : '▸'));

  const icon = itemIcon(folder.icon || 'folder', folder.color);
  icon.classList.add('tree-folder-icon');
  row.append(icon);

  row.append(el('span', { class: 'label' }, folder.name || t('items.folderFallback')));
  row.append(el('span', { class: 'tree-trash-meta' }, trashItemDeletedLabel(folder)));

  wrap.append(row);

  if (expanded) {
    const kids = el('div', { class: 'tree-children' });

    const childFolders = [...state.folders.values()]
      .filter((f) => f.parentId === folder.id)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    const childNotes = [...state.notes.values()]
      .filter((n) => n.folderId === folder.id)
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

    for (const child of childFolders) {
      kids.append(trashFolderRow(child, depth + 1));
    }

    for (const note of childNotes) {
      kids.append(trashNoteRow(note, depth + 1));
    }

    if (!childFolders.length && !childNotes.length) {
      kids.append(el('div', { class: 'tree-empty' }, t('tree.empty')));
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
      if (isAiSessionNote(n)) {
        window.dispatchEvent(new CustomEvent('yanta-open-ai-session', {
          detail: {
            sessionId: n.id,
          },
        }));

        window.dispatchEvent(new CustomEvent('yanta-close-mobile-sidebar'));
        return;
      }

      openNote(n.id);

      window.dispatchEvent(new CustomEvent('yanta-close-mobile-sidebar'));
    }),
    oncontextmenu: (e) => openTreeContextMenu(e, key, () => noteMenu(e, n)),
    ondragstart: (e) => {
      if (!isSelected(key)) setOnlySelection(key);

      const selected = getSelectedItems();

      const aiContextRefs =
        selected.length > 1 && selected.some((item) => item.key === key)
          ? selected.map((item) => {
              if (item.kind === 'note' && isAiSessionNote(item.note)) {
                return {
                  kind: 'ai-session',
                  id: item.id,
                };
              }

              return {
                kind: item.kind,
                id: item.id,
              };
            })
          : [{
              kind: isAiSessionNote(n) ? 'ai-session' : 'note',
              id: n.id,
            }];

      setAiContextDragData(
        e.dataTransfer,
        aiContextRefs
      );

      // text/yanta-note enables intra-app folder moves & wikilink-on-drop;
      // text/plain so a drop onto a foreign target still gets the title.
      e.dataTransfer.setData('text/yanta-note', n.id);
      e.dataTransfer.setData('text/plain', n.title || t('note.untitled'));
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
      e.stopPropagation();

      const targetFolderId = n.folderId || null;

      const noteIds = draggedNoteIds(draggedId)
        .filter((id) => id !== n.id);

      const moved = await moveNotesToFolder(
        noteIds,
        targetFolderId,
        'tree-drop-note'
      );

      if (!moved) return;

      emitTreeStructureChanged('tree-drop-note', {
        targetFolderId,
        moved,
      });

      renderTree();
    },
  });

  applyItemColor(row, n.color);
  applyCollapsedTreeDepth(row, depth);

  if (isActive) {
    row.append(activeNoteMarker(depth));
  }

  row.append(itemIcon(n.icon || (n.type === 'list' ? 'list' : 'file'), n.color));
  row.append(el('span', { class: 'label' }, n.title || t('note.untitled')));

  /*
    In der Pinned-Section ist die Note nur ein Shortcut.
    Wenn sie eigentlich in einem Folder liegt, zeigen wir optional den Folderpfad.
  */
  if (pinnedMirror && n.folderId) {
    const path = folderPath(n.folderId);
    const folder = state.folders.get(n.folderId);

    row.append(el('span', {
      class: 'tree-note-location',
      title: path || folder?.name || t('items.folderFallback'),
    }, folder?.name || t('items.folderFallback')));
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
    row.append(el('span', { class: 'live-dot', title: t('tree.note.liveShared') }));
  }

  if (n.spaceId) {
    const badge = el('span', {
      class: 'public-share-dot',
      title: n.spaceRole === 'write'
        ? t('tree.note.sharedWithYouWrite')
        : t('tree.note.sharedWithYouRead'),
    });

    badge.innerHTML = lucide(n.spaceRole === 'write' ? 'pencil' : 'eye', 11);
    row.append(badge);
  } else {
    for (const spaceSession of state.spaces.values()) {
      if (spaceSession.noteId === n.id && spaceSession.role === 'owner') {
        row.append(el('span', { class: 'live-dot', title: t('tree.note.liveShareActive') }));
        break;
      }
    }
  }

  if (isPublicShareActive(publicShareStateForNote(n.id))) {
    const publicDot = el('span', {
      class: 'public-share-dot',
      title: t('tree.note.publicLinkActive'),
    });

    publicDot.innerHTML = lucide('share-2', 11);
    row.append(publicDot);
  }
  
  if (n.pinned && !pinnedMirror) {
    row.append(el('span', { class: 'pin', title: t('tree.note.pinned') }, '●'));
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
    local: t('tree.status.local'),
    remote: t('tree.status.remote'),
    syncing: t('tree.status.syncing'),
    conflict: t('tree.status.conflict'),
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
    if (isNoteInTrash(n) || noteBelongsToSystem(n) || noteBelongsToArchived(n)) continue;

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
    initial: note.title || t('note.untitled'),
    placeholder: t('tree.note.titlePlaceholder'),
    emptyFallback: t('note.untitled'),

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
    initial: folder.name || t('items.folderFallback'),
    placeholder: t('tree.folder.namePlaceholder'),
    emptyFallback: t('items.folderFallback'),

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
  if (!activeMenu) return;

  if (activeMenu.contains(e.target)) {
    return;
  }

  closeMenu();
}

function bindMenuOutsideClose() {
  document.addEventListener('pointerdown', _menuOutsideClose, true);
  document.addEventListener('mousedown', _menuOutsideClose, true);
  document.addEventListener('touchstart', _menuOutsideClose, true);
}

function unbindMenuOutsideClose() {
  document.removeEventListener('pointerdown', _menuOutsideClose, true);
  document.removeEventListener('mousedown', _menuOutsideClose, true);
  document.removeEventListener('touchstart', _menuOutsideClose, true);
}

export function showMenu(x, y, items, {
  align = 'start',
  margin = 8,
} = {}) {
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

    const iconName = iconForContextMenuItem(it);

    const btn = el('button', {
      class: [
        it.danger ? 'danger' : '',
        it.disabled ? 'disabled' : '',
        it.meta ? 'meta' : '',
        iconName ? 'has-icon' : '',
      ].filter(Boolean).join(' '),
      disabled: !!it.disabled,
      title: it.title || '',
      onclick: () => {
        if (it.disabled) return;
        closeMenu();
        it.action?.();
      },
    });

    const label = el('span', { class: 'ctx-menu-label' }, it.label);

    if (iconName) {
      const icon = el('span', {
        class: 'ctx-menu-icon',
        'aria-hidden': 'true',
      });

      icon.innerHTML = lucide(iconName, 14);

      btn.append(icon, label);
    } else {
      btn.append(label);
    }

    // Keyboard hint, right-aligned — how a command is discovered.
    if (it.hint) {
      btn.classList.add('has-hint');
      btn.append(el('span', { class: 'ctx-menu-hint' }, it.hint));
    }

    m.append(btn);
  }

  document.body.append(m);
  activeMenu = m;

  setTimeout(() => {
    bindMenuOutsideClose();
  }, 0);

  const r = m.getBoundingClientRect();

  let left = align === 'end'
    ? x - r.width
    : x;

  let top = y;

  if (left + r.width > window.innerWidth - margin) {
    left = window.innerWidth - r.width - margin;
  }

  if (left < margin) {
    left = margin;
  }

  if (top + r.height > window.innerHeight - margin) {
    top = y - r.height - 6;
  }

  if (top < margin) {
    top = margin;
  }

  m.style.left = `${Math.round(left)}px`;
  m.style.top = `${Math.round(top)}px`;

  return m;
}

export function closeMenu() {
  if (!activeMenu) return;

  unbindMenuOutsideClose();

  activeMenu.remove();
  activeMenu = null;
}

function noteMenu(e, n) {

  if (isAiSessionNote(n)) {
    showMenu(e.clientX, e.clientY, [
      {
        label: t('tree.menu.openAiSession'),
        icon: 'messages-square',
        action: () => {
          window.dispatchEvent(new CustomEvent('yanta-open-ai-session', {
            detail: {
              sessionId: n.id,
            },
          }));
        },
      },
      {
        label: t('tree.menu.rename'),
        icon: 'pencil',
        action: () => renameTreeNote(n.id),
      },
      'hr',
      {
        label: t('tree.menu.deleteAiSession'),
        icon: 'shredder',
        danger: true,
        action: async () => {
          const ok = await yantaConfirm({
            title: t('tree.menu.deleteAiSessionConfirmTitle'),
            message: t('tree.menu.deleteAiSessionConfirmMessage', { title: n.title || t('tree.menu.aiSessionFallback') }),
            confirmLabel: t('tree.trash.deletePermanently'),
            danger: true,
          });

          if (!ok) return;

          await permanentlyDeleteNote(n.id, {
            source: 'ai-session-direct-delete',
          });
        },
      },
    ]);

    return;
  }
  
  showMenu(e.clientX, e.clientY, [
    {
      label: n.pinned ? t('tree.menu.unpin') : t('tree.menu.pin'),
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
      label: t('tree.menu.iconColor'),
      action: () => editItemsIconColor([noteKey(n.id)]),
    },
    {
      label: t('tree.menu.rename'),
      action: () => renameTreeNote(n.id),
    },
    'hr',
    {
      label: n.spaceId ? t('tree.menu.sharedNote') : t('tree.menu.shareNote'),
      icon: 'users',
      action: async () => {
        const { openUnifiedShareModal } = await import('./public-share/public-share-ui.js');
        openUnifiedShareModal({ noteId: n.id });
      },
    },
    'hr',
    {
      label: n.archived ? t('tree.menu.unarchive') : t('tree.menu.archive'),
      action: async () => {
        const nowArchived = !n.archived;

        await setNoteArchived(n, nowArchived);

        actionToast(nowArchived ? t('tree.menu.noteArchived') : t('tree.menu.noteUnarchived'), {
          actionLabel: t('common.undo'),
          onAction: () => setNoteArchived(n, !nowArchived),
        });
      },
    },
    {
      label: t('tree.menu.moveToFolder'),
      action: () => moveSelectedToFolder([noteKey(n.id)]),
    },
    {
      label: t('tree.menu.duplicate'),
      action: () => duplicateNote(n),
    },
    'hr',
    {
      label: t('tree.menu.moveToTrash'),
      danger: true,
      action: async () => {
        await trashItemsWithUndo({
          noteIds: [n.id],
          source: 'tree-menu',
        });
      },
    },
  ]);
}

function folderMenu(e, f) {

  if (isAiSessionsRootFolder(f)) {
    showMenu(e.clientX, e.clientY, [
      {
        label: t('tree.menu.deleteAiSessions'),
        icon: 'shredder',
        danger: true,
        action: async () => {
          const ok = await yantaConfirm({
            title: t('tree.menu.deleteAiSessionsConfirmTitle'),
            message: t('tree.menu.deleteAiSessionsConfirmMessage'),
            confirmLabel: t('tree.trash.deletePermanently'),
            danger: true,
          });

          if (!ok) return;

          await permanentlyDeleteFolder(f.id, {
            source: 'ai-sessions-folder-direct-delete',
          });
        },
      },
    ]);

    return;
  }

  showMenu(e.clientX, e.clientY, [
    {
      label: t('tree.menu.open'),
      action: () => openFolderInDashboard(f.id, { push: true }),
    },
    'hr',
    {
      label: t('tree.menu.newNoteHere'),
      action: () => newNote(f.id),
    },
    {
      label: t('tree.menu.newSubFolder'),
      action: () => newFolder(f.id),
    },
    {
      label: t('tree.menu.selectFolderContents'),
      action: () => selectFolderSubtree(f.id),
    },
    'hr',
    {
      label: f.spaceId ? t('tree.menu.sharedWorkspace') : t('tree.menu.shareFolder'),
      icon: 'users',
      action: async () => {
        const { openUnifiedShareModal } = await import('./public-share/public-share-ui.js');
        openUnifiedShareModal({ folderId: f.id });
      },
    },
    'hr',
    {
      label: t('tree.menu.iconColor'),
      action: () => editItemsIconColor([folderKey(f.id)]),
    },
    {
      label: t('tree.menu.rename'),
      action: () => renameTreeFolder(f.id),
    },
    {
      label: f.archived ? t('tree.menu.unarchiveFolder') : t('tree.menu.archiveFolder'),
      action: async () => {
        const nowArchived = !f.archived;

        await setFolderArchived(f, nowArchived);

        actionToast(nowArchived ? t('tree.menu.folderArchived') : t('tree.menu.folderUnarchived'), {
          actionLabel: t('common.undo'),
          onAction: () => setFolderArchived(f, !nowArchived),
        });
      },
    },
    {
      label: t('tree.menu.moveToFolder'),
      action: () => moveSelectedToFolder([folderKey(f.id)]),
    },
    'hr',
    {
      label: t('tree.menu.moveFolderToTrash'),
      danger: true,
      action: async () => {
        await trashItemsWithUndo({
          folderIds: [f.id],
          source: 'tree-menu',
        });
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
      label: `${t('tree.bulk.selectedHeader', { count })} · ${t('tree.bulk.notesLabel', { count: noteCount })} · ${t('tree.bulk.foldersLabel', { count: folderCount })}`,
      disabled: true,
      meta: true,
    },
    'hr',
  ];

  if (noteCount) {
    menu.push({
      label: t('tree.bulk.pinSelected', { count: noteCount }),
      disabled: !anyUnpinned,
      action: () => bulkSetPinned(notes, true),
    });

    menu.push({
      label: t('tree.bulk.unpinSelected', { count: noteCount }),
      disabled: !anyPinned,
      action: () => bulkSetPinned(notes, false),
    });
  }

  menu.push({
    label: t('tree.bulk.iconColorSelected'),
    action: () => editItemsIconColor(items.map((x) => x.key)),
  });

  menu.push({
    label: t('tree.bulk.moveSelectedToFolder'),
    action: () => moveSelectedToFolder(items.map((x) => x.key)),
  });

  if (noteCount) {
    menu.push({
      label: t('tree.bulk.duplicateSelected', { count: noteCount }),
      action: () => duplicateNotes(notes),
    });
  }

  menu.push('hr');

  menu.push({
    label: t('tree.bulk.clearSelection'),
    action: () => {
      selection.keys.clear();
      selection.anchorKey = null;
      renderTree();
    },
  });

  menu.push({
    label: t('tree.bulk.deleteSelected'),
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

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      reason: pinned ? 'tree-bulk-pin' : 'tree-bulk-unpin',
      source: 'tree',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
    detail: {
      reason: pinned ? 'tree-bulk-pin' : 'tree-bulk-unpin',
      source: 'tree',
    },
  }));

  toast(
    pinned
      ? t('tree.bulk.pinnedToast', { count: notes.length })
      : t('tree.bulk.unpinnedToast', { count: notes.length }),
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
    toast(t('tree.bulk.nothingSelected'), 'info');
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
    title: t('tree.bulk.iconColorForCount', { count: cleanKeys.length }),
  });
}

function folderPath(folderId) {
  if (!folderId) return '';

  const parts = [];
  const seen = new Set();

  let f = state.folders.get(folderId);

  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    parts.unshift(f.name || t('items.folderFallback'));
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return parts.join(' / ');
}

async function chooseFolderPrompt({
  title = t('tree.move.title'),
  keys = [],
} = {}) {
  const folderKeys = keys
    .map(parseTreeKey)
    .filter((x) => x.kind === 'folder')
    .map((x) => x.id);

  return await yantaFolderPicker({
    title,
    allowNone: true,
    noneLabel: t('tree.move.noFolderHome'),
    isDisabled(folder) {
      if (isFolderInTrash(folder)) return true;

      for (const selectedFolderId of folderKeys) {
        if (folder.id === selectedFolderId) return true;
        if (isAncestor(selectedFolderId, folder.id)) return true;
      }

      return false;
    },
    disabledHint: t('tree.move.wouldLoop'),
  });
}

async function moveSelectedToFolder(keys = [...selection.keys]) {
  const cleanKeys = uniqueNonEmptyStrings(keys);

  const targetFolderId = await chooseFolderPrompt({
    title: t('tree.move.selectedItems'),
    keys: cleanKeys,
  });

  if (targetFolderId === undefined) return;

  const directFolderIds = cleanKeys
    .map(parseTreeKey)
    .filter((x) => x.kind === 'folder')
    .map((x) => x.id);

  const topFolderIds = topLevelFolderIds(directFolderIds);

  const directNoteIds = cleanKeys
    .map(parseTreeKey)
    .filter((x) => x.kind === 'note')
    .map((x) => x.id);

  /*
    Wichtig:
    Wenn eine Note bereits in einem ausgewählten Folder/Subfolder liegt,
    darf sie nicht zusätzlich separat bewegt werden.
    Sonst würde ein Bulk-Move die interne Folder-Struktur kaputtmachen.
  */
  const effectiveNoteIds = directNoteIds.filter((noteId) => {
    const note = state.notes.get(noteId);
    if (!note) return false;

    return !noteIsInsideAnyFolder(note, topFolderIds);
  });

  // Snapshot origins before moving so the move can be reversed.
  const noteOrigins = effectiveNoteIds.map((id) => ({
    id,
    folderId: state.notes.get(id)?.folderId ?? null,
  }));

  const folderOrigins = topFolderIds.map((id) => ({
    id,
    parentId: state.folders.get(id)?.parentId ?? null,
  }));

  const movedNotes = await moveNotesToFolder(
    effectiveNoteIds,
    targetFolderId || null,
    'tree-bulk-move'
  );

  const folderResult = await moveFoldersToParent(
    topFolderIds,
    targetFolderId || null,
    'tree-bulk-move'
  );

  const moved = movedNotes + folderResult.moved;
  const skipped = folderResult.skipped;

  if (targetFolderId && moved) {
    state.expandedFolders.add(targetFolderId);
  }

  if (moved || skipped) {
    emitTreeStructureChanged('tree-bulk-move', {
      targetFolderId: targetFolderId || null,
      moved,
      skipped,
    });

    renderTree();
  }

  if (skipped) {
    toast(
      t('tree.movedSkipped', { count: skipped, moved, skipped }),
      'error'
    );
  } else if (moved) {
    actionToast(t('tree.move.movedToast', { count: moved }), {
      actionLabel: t('common.undo'),
      onAction: () => undoMoveToFolder(noteOrigins, folderOrigins),
    });
  }
}

async function duplicateNotes(notes) {
  let created = 0;

  for (const n of notes) {
    await duplicateNote(n, { openCreated: false });
    created++;
  }

  renderTree();

  toast(t('tree.bulk.duplicatedToast', { count: created }), 'success');
}

async function duplicateNote(src, { openCreated = true } = {}) {
  const id = uid();

  const n = {
    ...src,
    id,
    title: t('items.copySuffix', { title: src.title || t('note.untitled') }),
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
  const folderIds = new Set(
    selectedFolders(items).map((f) => f.id)
  );

  const noteIds = new Set(
    selectedNotes(items).map((n) => n.id)
  );

  if (!folderIds.size && !noteIds.size) return;

  await trashItemsWithUndo({
    noteIds: [...noteIds],
    folderIds: [...folderIds],
    source: 'tree-bulk',
  });

  selection.keys.clear();
  selection.anchorKey = null;

  renderTree();
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