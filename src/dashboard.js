import {
  $,
  el,
  uid,
  state,
  store,
  lucide,
  safeCssColor,
  toast,
} from './core.js';

import {
  openNote,
  newNote,
  toggleTaskLineInNote,
  rebuildWikilinkIndex,
  clearEditor,
} from './notes.js';

import {
  getNoteDoc,
  noteMarkdown,
  findDrawing,
  destroyNoteDoc,
} from './yjs.js';
import { inlineTextEdit } from './inline-ui.js';

import {
  renameNoteById,
  renameFolderById,
} from './item-actions.js';

import {
  dashboardUrl,
  dashboardState,
} from './navigation.js';

import {
  openSidePane,
  closeSidePane,
  isSidePaneOpen,
} from './side-pane.js';

  const MOBILE_MQ = window.matchMedia('(max-width: 880px)');
  
  const DASH_ORDER_STEP = 1000;
  
  const LONG_PRESS_MS = 300;
  const HANDLE_LONG_PRESS_MS = 360;
  const MOVE_TOLERANCE = 8;

  const DRAG_EDGE_SCROLL_PX = 76;
  const DRAG_EDGE_SCROLL_MAX = 18;
  const DRAG_DROP_ANIM_MS = 145;

  const GRID_ROW_PX = 8;
  const GRID_GAP_PX = 10;

  const DEFAULT_NOTE_HEIGHT = 150;
  const DEFAULT_FOLDER_HEIGHT = 150;
  const MIN_CARD_HEIGHT = 76;
  const MAX_CARD_HEIGHT = 620;

  const DASHBOARD_CARD_DISPLAY_KEY = 'dashboard.cardDisplay.v1';

  const DEFAULT_DASHBOARD_CARD_DISPLAY = {
    notesShowHeader: false,
    foldersShowHeader: false,
  };

  let dashboardCardDisplay = { ...DEFAULT_DASHBOARD_CARD_DISPLAY };
  let dashboardCardDisplayLoaded = false;

  let root = null;
  let initialized = false;
  let previewObserver = null;
  
  let dashboard = {
    folderId: null,
    visible: false,
    internalOpeningNote: false,
    selectedKey: null,
    dragging: null,
    resize: null,
    suppressOpenUntil: 0,
    paneMode: false,
  };
  
  const previewCache = new Map();
  // noteId -> { updated, textLen, preview }


  export function getDashboardCardDisplayPrefs() {
    return { ...dashboardCardDisplay };
  }

  export async function loadDashboardCardDisplayPrefs() {
    if (dashboardCardDisplayLoaded) return dashboardCardDisplay;

    try {
      dashboardCardDisplay = {
        ...DEFAULT_DASHBOARD_CARD_DISPLAY,
        ...(await store.settings.get(DASHBOARD_CARD_DISPLAY_KEY, {})),
      };
    } catch {
      dashboardCardDisplay = { ...DEFAULT_DASHBOARD_CARD_DISPLAY };
    }

    dashboardCardDisplayLoaded = true;
    return dashboardCardDisplay;
  }

  export async function setDashboardCardDisplayPrefs(patch = {}) {
    dashboardCardDisplay = {
      ...dashboardCardDisplay,
      ...patch,
    };

    dashboardCardDisplayLoaded = true;

    await store.settings.set(DASHBOARD_CARD_DISPLAY_KEY, dashboardCardDisplay);

    window.dispatchEvent(new CustomEvent('yanta-dashboard-settings-changed', {
      detail: { ...dashboardCardDisplay },
    }));

    if (dashboard.visible) {
      renderDashboard();
    }

    return dashboardCardDisplay;
  }
  
  function isMobile() {
    return MOBILE_MQ.matches;
  }
  
  function itemKey(item) {
    return `${item.kind}:${item.id}`;
  }
  
  function parseItemKey(key) {
    const [kind, ...rest] = String(key || '').split(':');
    return { kind, id: rest.join(':') };
  }

  function isEditableDashboardKeyTarget(target) {
    const node = target instanceof Element ? target : null;

    return !!node?.closest?.(
      'input, textarea, select, button, a, [contenteditable="true"], .yanta-inline-edit'
    );
  }

  function focusedDashboardCard() {
    const active = document.activeElement;

    const card = active?.closest?.('.yanta-dash-card[data-key]');

    if (card && root?.contains(card)) {
      return card;
    }

    return null;
  }

  function findDashboardCardByKey(key) {
    const { kind, id } = parseItemKey(key);

    if (kind === 'note') {
      return findDashboardNoteCard(id);
    }

    if (kind === 'folder') {
      return findDashboardFolderCard(id);
    }

    return null;
  }

  function renameCurrentDashboardSelection() {
    const focusedCard = focusedDashboardCard();
    const key =
      focusedCard?.dataset?.key ||
      dashboard.selectedKey ||
      '';

    if (!key) return false;

    const { kind, id } = parseItemKey(key);
    const card = focusedCard || findDashboardCardByKey(key);

    if (kind === 'note' && state.notes.has(id)) {
      renameDashboardNote(id, card);
      return true;
    }

    if (kind === 'folder' && state.folders.has(id)) {
      renameDashboardFolder(id, card);
      return true;
    }

    return false;
  }
  
  function defaultIconForNote(note) {
    return note.icon || (note.type === 'list' ? 'list' : 'file-text');
  }
  
  function defaultIconForFolder(folder) {
    return folder.icon || 'folder';
  }
  
  function itemColor(item) {
    if (item.kind === 'note') return safeCssColor(item.note.color) || '';
    return safeCssColor(item.folder.color) || '';
  }
  
  function itemTitle(item) {
    if (item.kind === 'note') return item.note.title || 'Untitled';
    return item.folder.name || 'Folder';
  }
  
  function itemIcon(item) {
    if (item.kind === 'note') return defaultIconForNote(item.note);
    return defaultIconForFolder(item.folder);
  }
  
  function transitionNameFor(kind, id) {
    return `dash-${kind}-${String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }
  
  function heightToGridSpan(px) {
    const h = Math.max(
      MIN_CARD_HEIGHT,
      Math.min(MAX_CARD_HEIGHT, Number(px) || DEFAULT_NOTE_HEIGHT)
    );
  
    // CSS Grid item height:
    // span * rowHeight + (span - 1) * gap
    // => span = ceil((height + gap) / (rowHeight + gap))
    return Math.max(
      5,
      Math.ceil((h + GRID_GAP_PX) / (GRID_ROW_PX + GRID_GAP_PX))
    );
  }
  
  function itemDashboardHeightPx(item) {
    const raw =
      item.kind === 'note'
        ? item.note.dashboardHeightPx ?? item.note.dashboardHeight
        : item.folder.dashboardHeightPx ?? item.folder.dashboardHeight;
  
    const n = Number(raw);
  
    if (Number.isFinite(n)) {
      // Backward compatibility: old dashboardHeight was a small span value.
      if (n > 0 && n <= 10) {
        return Math.max(MIN_CARD_HEIGHT, n * 72);
      }
  
      return Math.max(MIN_CARD_HEIGHT, Math.min(MAX_CARD_HEIGHT, n));
    }
  
    return item.kind === 'folder'
      ? DEFAULT_FOLDER_HEIGHT
      : DEFAULT_NOTE_HEIGHT;
  }
    
  function maxResizeHeightForCard(card, key) {
    const { kind } = parseItemKey(key);

    if (kind === 'note') {
      const fromPreview = Number(card?.dataset?.contentMaxHeight);

      if (Number.isFinite(fromPreview) && fromPreview > 0) {
        return Math.max(MIN_CARD_HEIGHT, Math.min(MAX_CARD_HEIGHT, fromPreview));
      }

      const host = card?.querySelector?.('.yanta-dash-preview');

      if (host) {
        const measured = Math.ceil(host.scrollHeight + 18);
        if (measured > 0) {
          return Math.max(MIN_CARD_HEIGHT, Math.min(MAX_CARD_HEIGHT, measured));
        }
      }
    }

    return MAX_CARD_HEIGHT;
  }

  function noteHasCustomIcon(note) {
    const def = note.type === 'list' ? 'list' : 'file-text';
    return !!note.icon && note.icon !== def && note.icon !== 'file';
  }
  
  function autoHeightForPreview(preview) {
    let h = 82;
  
    for (const block of preview.blocks || []) {
      if (block.type === 'heading') h += block.level === 1 ? 30 : 25;
      else if (block.type === 'task') h += 28;
      else if (block.type === 'text') h += Math.min(80, 18 + Math.ceil((block.text || '').length / 36) * 16);
      else if (block.type === 'quote') h += 42;
      else if (block.type === 'image') h += 120;
      else if (block.type === 'video') h += 132;
      else if (block.type === 'drawing') h += 118;
    }
  
    if (preview.badges?.length) h += 28;
  
    return Math.max(MIN_CARD_HEIGHT, Math.min(MAX_CARD_HEIGHT, h));
  }

  function fallbackOrderForNote(note) {
    // Stable-ish fallback before user explicitly orders cards.
    // Pinned section has its own ordering.
    return note.dashboardOrder ?? note.created ?? note.updated ?? 0;
  }
  
  function fallbackOrderForFolder(folder) {
    return folder.dashboardOrder ?? folder.created ?? 0;
  }
  
  function sortByDashboardOrder(a, b) {
    const ao =
      a.kind === 'note'
        ? fallbackOrderForNote(a.note)
        : fallbackOrderForFolder(a.folder);
  
    const bo =
      b.kind === 'note'
        ? fallbackOrderForNote(b.note)
        : fallbackOrderForFolder(b.folder);
  
    return ao - bo || itemTitle(a).localeCompare(itemTitle(b));
  }
  
  function sortPinnedNotes(a, b) {
    const ao = a.dashboardPinnedOrder ?? a.dashboardOrder ?? 0;
    const bo = b.dashboardPinnedOrder ?? b.dashboardOrder ?? 0;
  
    return ao - bo || (b.updated || 0) - (a.updated || 0);
  }
  
  function currentFolder() {
    return dashboard.folderId
      ? state.folders.get(dashboard.folderId)
      : null;
  }
  
  function currentFolderPath() {
    const parts = [];
    const seen = new Set();
    let f = currentFolder();
  
    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      parts.unshift(f);
      f = f.parentId ? state.folders.get(f.parentId) : null;
    }
  
    return parts;
  }
  
function getDashboardItems() {
  const folderId = dashboard.folderId || null;

  /*
    Pinning ist jetzt eine Shortcut-/Priority-Ebene, kein "Move".

    Root/Home:
      - zeigt ALLE gepinnten Notes aus dem ganzen Vault oben.
      - diese Notes sind Shortcuts/Mirrors, bleiben aber in ihren Ordnern.

    Folder:
      - zeigt nur gepinnte Notes dieses Folders oben.
      - gepinnte Notes aus anderen Foldern werden hier nicht angezeigt.
  */
  const pinnedNotes = [...state.notes.values()]
    .filter((n) => n.pinned)
    .filter((n) => {
      if (!folderId) return true;
      return (n.folderId || null) === folderId;
    })
    .sort(sortPinnedNotes)
    .map((note) => ({
      kind: 'note',
      id: note.id,
      note,
      pinned: true,
      mirrored: !folderId && !!note.folderId,
    }));

  const folders = [...state.folders.values()]
    .filter((f) => (f.parentId || null) === folderId)
    .map((folder) => ({
      kind: 'folder',
      id: folder.id,
      folder,
      pinned: false,
      mirrored: false,
    }));

  const notes = [...state.notes.values()]
    .filter((n) => !n.pinned)
    .filter((n) => (n.folderId || null) === folderId)
    .map((note) => ({
      kind: 'note',
      id: note.id,
      note,
      pinned: false,
      mirrored: false,
    }));

  const normalItems = [...folders, ...notes].sort(sortByDashboardOrder);

  return {
    pinnedNotes,
    normalItems,
  };
}
  
  function ensureDashboardRoot() {
    if (root) return root;
  
    root = $('dashboard');
  
    if (!root) {
      root = document.createElement('section');
      root.id = 'dashboard';
      root.className = 'dashboard';
      root.hidden = true;
  
      const main = document.querySelector('main.main');
      main?.insertBefore(root, $('panes'));
    }
  
    return root;
  }

  function attachDashboardToMain() {
    ensureDashboardRoot();

    const main = document.querySelector('main.main');
    const panes = $('panes');

    if (!main || !root) return;

    if (root.parentElement !== main) {
      if (panes && panes.parentElement === main) {
        main.insertBefore(root, panes);
      } else {
        main.append(root);
      }
    }
  }
  
  export function isDashboardVisible() {
    return dashboard.visible;
  }
  
  export function setupDashboard() {
    if (initialized) return;
    initialized = true;
  
    ensureDashboardRoot();

    dashboard.paneMode = false;

    if (isSidePaneOpen('dashboard')) {
      closeSidePane({ silent: true });
    }

    attachDashboardToMain();

    setupPreviewObserver();

    loadDashboardCardDisplayPrefs().then(() => {
      if (dashboard.visible) renderDashboard();
    });

    window.addEventListener('yanta-dashboard-settings-changed', () => {
      if (dashboard.visible) renderDashboard();
    });
  
    MOBILE_MQ.addEventListener?.('change', () => {
      if (isMobile() && !state.currentNoteId) {
        showDashboard({ replace: true });
      }
    });

    document.addEventListener('pointerdown', (e) => {
        if (!dashboard.visible) return;
        if (!dashboard.selectedKey) return;
      
        const selected = root?.querySelector(`.yanta-dash-card.selected`);
      
        if (selected && selected.contains(e.target)) return;
      
        if (e.target.closest?.('.yanta-dash-card-clone, .yanta-dash-card.drag-clone')) return;
      
        dashboard.selectedKey = null;
      
        root
          ?.querySelectorAll('.yanta-dash-card.selected')
          ?.forEach((n) => n.classList.remove('selected'));
      }, true);
  
    window.addEventListener('yanta-note-updated', (e) => {
      const noteId = e.detail?.noteId;
  
      if (noteId) {
        previewCache.delete(noteId);
      }
  
      if (dashboard.visible) {
        renderDashboard();
      }
    });
  
    window.addEventListener('yanta-dashboard-refresh', () => {
      if (dashboard.visible) renderDashboard();
    });
  
    window.addEventListener('yanta-note-opened', () => {
      if (!dashboard.visible) return;
      if (dashboard.internalOpeningNote) return;

      // In pane mode dashboard is allowed to stay open next to the note.
      if (dashboard.paneMode) return;

      hideDashboard({ push: false });
    });
  
    window.addEventListener('keydown', (e) => {
      if (!dashboard.visible) return;

      /*
        F2 = Rename selected/focused dashboard card.
      */
      if (e.key === 'F2') {
        if (isEditableDashboardKeyTarget(e.target)) return;

        const handled = renameCurrentDashboardSelection();

        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }

        return;
      }

      if (e.key === 'Escape' && dashboard.folderId) {
        e.preventDefault();
        navigateDashboardFolder(null);
      }
    });
  }
  
export function showDashboard({
  folderId = dashboard.folderId || null,
  push = false,
  replace = false,
} = {}) {
  ensureDashboardRoot();

  dashboard.folderId = folderId || null;
  dashboard.visible = true;
  dashboard.selectedKey = null;

  state.surface = 'dashboard';
  state.dashboardFolderId = dashboard.folderId;

  const app = $('app');

  if (app) {
    app.dataset.surface = 'dashboard';
  }

  root.hidden = false;

  renderDashboard();

  if (replace) {
    history.replaceState(
      dashboardState(dashboard.folderId),
      '',
      dashboardUrl(dashboard.folderId)
    );
  } else if (push) {
    history.pushState(
      dashboardState(dashboard.folderId),
      '',
      dashboardUrl(dashboard.folderId)
    );
  }
}
  
export function showDashboardPane({
  folderId = dashboard.folderId || null,
} = {}) {
  ensureDashboardRoot();

  const body = openSidePane({
    kind: 'dashboard',
    title: folderId && state.folders.has(folderId)
      ? state.folders.get(folderId).name || 'Dashboard'
      : 'Dashboard',
    icon: 'layout-dashboard',
    className: 'yanta-dashboard-side-pane',
    onClose: () => {
      dashboard.paneMode = false;
      dashboard.visible = false;

      attachDashboardToMain();

      if (root) {
        root.hidden = true;
      }
    },
  });

  if (!body) return;

  dashboard.folderId = folderId || null;
  dashboard.visible = true;
  dashboard.paneMode = true;
  dashboard.selectedKey = null;

  state.dashboardFolderId = dashboard.folderId;

  body.append(root);

  root.hidden = false;

  // Important:
  // Do not set state.surface = 'dashboard'.
  // In pane mode the main surface stays note.
  renderDashboard();

  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('yanta-dashboard-pane-opened'));
  });
}

export function closeDashboardPane({ silent = false } = {}) {
  if (!isSidePaneOpen('dashboard')) return;

  closeSidePane({ silent });
}

export function hideDashboard({ push = false } = {}) {
  if (!root) return;

  if (dashboard.paneMode) {
    closeDashboardPane({ silent: true });
    return;
  }

  dashboard.visible = false;
  dashboard.selectedKey = null;
  dashboard.dragging = null;
  dashboard.resize = null;

  state.surface = 'note';

  const app = $('app');

  if (app) {
    app.dataset.surface = 'note';
  }

  root.hidden = true;

  if (push && state.currentNoteId) {
    history.pushState(
      { surface: 'note', noteId: state.currentNoteId },
      '',
      '#' + encodeURIComponent(state.currentNoteId)
    );
  }
}

export async function showDashboardFolderFromHistory(folderId = null) {
  ensureDashboardRoot();

  dashboard.paneMode = false;

  if (isSidePaneOpen('dashboard')) {
    closeSidePane({ silent: true });
  }

  const targetFolderId = folderId || null;

  /*
    Wichtig:
    Browser Back/Forward darf Dashboard-Folder nicht direkt per showDashboard()
    oder renderDashboard() wechseln, sonst gibt es keine View Transition.
    Stattdessen immer durch navigateDashboardFolder(..., { push:false }).
  */
  if (dashboard.visible) {
    await navigateDashboardFolder(targetFolderId, {
      sourceCard: null,
      push: false,
    });

    return;
  }

  /*
    Falls wir gerade aus einer Note zurück ins Dashboard kommen,
    weiterhin die bestehende Note -> Card Transition benutzen.
  */
  if (state.currentNoteId && document.startViewTransition) {
    await showDashboardFromNote(state.currentNoteId, {
      folderId: targetFolderId,
      replace: false,
    });

    return;
  }

  showDashboard({
    folderId: targetFolderId,
    push: false,
    replace: false,
  });
}

  export async function showDashboardFromNote(noteId = state.currentNoteId, {
    folderId = dashboard.folderId || null,
    replace = true,
  } = {}) {
    ensureDashboardRoot();
  
    if (!noteId || !document.startViewTransition) {
      showDashboard({ folderId, replace });
      return;
    }
  
    const transitionName = transitionNameFor('note', noteId);
    const source = $('panes');
    let targetCard = null;
  
    if (source) {
      source.style.viewTransitionName = transitionName;
      source.style.contain = 'layout paint';
      source.classList.add('is-note-transition-source');
    }
  
    const vt = document.startViewTransition(() => {
      showDashboard({ folderId, replace: false, push: false });
  
      targetCard = root?.querySelector(
        `.yanta-dash-card[data-note-id="${CSS.escape(noteId)}"]`
      );
  
      if (targetCard) {
        targetCard.style.viewTransitionName = transitionName;
        targetCard.style.contain = 'layout paint';
      }
    });
  
    await vt.finished.catch(() => {});
  
    if (source) {
      source.style.viewTransitionName = '';
      source.style.contain = '';
      source.classList.remove('is-note-transition-source');
    }
  
    if (targetCard) {
      targetCard.style.viewTransitionName = '';
      targetCard.style.contain = '';
    }
  
    if (replace) {
      history.replaceState(
        dashboardState(dashboard.folderId),
        '',
        dashboardUrl(dashboard.folderId)
      );
    }
  }
  
  function setupPreviewObserver() {
    previewObserver?.disconnect();
  
    previewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
  
        const card = entry.target;
        previewObserver.unobserve(card);
  
        const noteId = card.dataset.noteId;
        if (!noteId) continue;
  
        hydrateCardPreview(card, noteId).catch(() => {});
      }
    }, {
      root: root || null,
      rootMargin: '280px 0px',
    });
  }
  
function renderDashboard() {
  ensureDashboardRoot();
  setupPreviewObserver();

  root.replaceChildren();

  /*
    Folder view transitions need a real surface that is replaced on each
    dashboard render, similar to how Notes transition between panes <-> card.
    Do not transition #dashboard itself; it is reused.
  */
  const page = el('div', { class: 'yanta-dashboard-page' });

  page.dataset.notesHeader = dashboardCardDisplay.notesShowHeader ? '1' : '0';
  page.dataset.foldersHeader = dashboardCardDisplay.foldersShowHeader ? '1' : '0';

  page.append(renderDashboardHeader());

  const { pinnedNotes, normalItems } = getDashboardItems();

  const body = el('div', { class: 'yanta-dashboard-body' });

  /*
    Keine sichtbaren Section-Titles mehr.
    Gepinnte Items stehen einfach oben.
    Im Root sind gepinnte Notes Shortcuts aus dem ganzen Vault.
    In Foldern sind gepinnte Notes nur lokale Top-Items.
  */
  if (!pinnedNotes.length && !normalItems.length) {
    body.append(
      dashboard.folderId
        ? renderEmptyFolderState()
        : renderEmptyState()
    );
  } else {
    if (pinnedNotes.length) {
      body.append(renderGrid(pinnedNotes, { section: 'pinned' }));
    }

    if (normalItems.length) {
      body.append(renderGrid(normalItems, { section: 'normal' }));
    }
  }

  page.append(body);
  root.append(page);
}

  function renderDashboardHeader() {
    const header = el('header', { class: 'yanta-dashboard-head' });
  
    const menuBtn = el('button', {
      class: 'icon-btn yanta-dashboard-icon-btn',
      title: 'Open sidebar',
      onclick: () => $('btn-sidebar-toggle')?.click(),
    });
  
    menuBtn.innerHTML = lucide('menu', 21);
  
    const titleWrap = el('div', { class: 'yanta-dashboard-title-wrap' });
  
    const path = currentFolderPath();
  
    const title = el('div', {
      class: 'yanta-dashboard-title',
    }, dashboard.folderId ? (path.at(-1)?.name || 'Folder') : 'Notes');
  
    const crumb = el('div', { class: 'yanta-dashboard-breadcrumb' });
  
    const home = el('button', {
      type: 'button',
      onclick: () => navigateDashboardFolder(null),
    }, 'Home');
  
    crumb.append(home);
  
    for (const f of path) {
      crumb.append(el('span', {}, '/'));
      crumb.append(el('button', {
        type: 'button',
        onclick: () => navigateDashboardFolder(f.id),
      }, f.name || 'Folder'));
    }
  
    titleWrap.append(title, crumb);
  
    const searchBtn = el('button', {
      class: 'icon-btn yanta-dashboard-icon-btn',
      title: 'Search',
      onclick: () => {
        $('btn-sidebar-toggle')?.click();
        setTimeout(() => $('search')?.focus(), 120);
      },
    });
    searchBtn.innerHTML = lucide('search', 21);
  
    const newBtn = el('button', {
      class: 'btn primary yanta-dashboard-new-btn',
      title: 'New note',
      onclick: async () => {
        await newNote(dashboard.folderId || null);
        hideDashboard({ push: false });
      },
    });
    newBtn.innerHTML = `${lucide('plus', 17)} <span>New</span>`;
  
    header.append(menuBtn, titleWrap, searchBtn, newBtn);
  
    return header;
  }
  
  function renderEmptyState() {
    const box = el('div', { class: 'yanta-dashboard-empty' });
  
    box.innerHTML = `
      <div class="yanta-dashboard-empty-icon">${lucide('sparkles', 34)}</div>
      <strong>No notes yet</strong>
      <p>Create your first note or open the sidebar.</p>
    `;
  
    const btn = el('button', {
      class: 'btn primary',
      onclick: async () => {
        await newNote(dashboard.folderId || null);
        hideDashboard({ push: false });
      },
    }, 'Create note');
  
    box.append(btn);
  
    return box;
  }
  
  function renderEmptyFolderState() {
    const box = el('div', { class: 'yanta-dashboard-empty compact' });
  
    box.innerHTML = `
      <div class="yanta-dashboard-empty-icon">${lucide('folder-open', 30)}</div>
      <strong>This folder is empty</strong>
      <p>Add a note here.</p>
    `;
  
    const btn = el('button', {
      class: 'btn primary',
      onclick: async () => {
        await newNote(dashboard.folderId || null);
        hideDashboard({ push: false });
      },
    }, 'New note');
  
    box.append(btn);
  
    return box;
  }
  
  function renderGrid(items, { section }) {
    const grid = el('div', {
      class: 'yanta-dashboard-grid',
      dataset: { section },
    });
  
    for (const item of items) {
      grid.append(renderCard(item, { section }));
    }
  
    return grid;
  }
  
function renderCard(item, { section }) {
  const key = itemKey(item);
  const color = itemColor(item);
  const heightPx = itemDashboardHeightPx(item);
  const rowSpan = heightToGridSpan(heightPx);

  const card = el('article', {
    class:
      'yanta-dash-card' +
      (color ? ' has-color' : '') +
      (item.kind === 'folder' ? ' folder-card' : ' note-card') +
      (dashboard.selectedKey === key ? ' selected' : ''),
    dataset: {
      key,
      kind: item.kind,
      id: item.id,
      section,
      noteId: item.kind === 'note' ? item.id : '',
      folderId: item.kind === 'folder' ? item.id : '',
    },
  });

  // Wichtig: Custom Properties explizit setzen.
  card.style.setProperty('--dash-row-span', String(rowSpan));

  if (color) {
    card.style.setProperty('--card-color', color);
  }

  /*
    View transition names must NOT be permanent.
    They are assigned temporarily only during open/close transitions.
  */
  card.style.viewTransitionName = '';

  card.dataset.effectiveHeight = String(heightPx);
  card.tabIndex = 0;

  if (item.kind === 'folder') {
    card.append(renderCardHeader(item));
    card.append(renderFolderBody(item.folder));
    card.append(renderCardActions(item));

    const meta = renderFolderMeta(item.folder);

    if (meta) {
      card.append(meta);
    }
  } else {
    card.append(renderNoteCorner(item.note));

    // Notes bekommen jetzt ebenfalls einen Titel-Header.
    // Dadurch kann man sie sauber im Dashboard umbenennen.
    card.append(renderCardHeader(item));

    const previewHost = el('div', {
      class:
        'yanta-dash-preview' +
        ((noteHasCustomIcon(item.note) || item.note.pinned) ? ' has-corner' : ''),
      dataset: { previewHost: '1' },
    });

    previewHost.innerHTML = `<div class="yanta-dash-preview-skeleton"></div>`;

    card.append(previewHost);

    previewObserver?.observe(card);

    card.append(renderCardActions(item));
  }

  card.append(renderResizeHandle(key));

  bindCardPointerInteractions(card, item);

  return card;
}

  function renderNoteCorner(note) {
    const wrap = el('div', { class: 'yanta-dash-note-corner' });
  
    if (noteHasCustomIcon(note)) {
      const icon = el('span', {
        class: 'yanta-dash-note-corner-icon',
        title: note.icon,
      });
  
      icon.innerHTML = lucide(note.icon, 14);
      wrap.append(icon);
    }
  
    if (note.pinned) {
      const pin = el('span', {
        class: 'yanta-dash-note-corner-pin',
        title: 'Pinned',
      });
  
      pin.innerHTML = lucide('pin', 13);
      wrap.append(pin);
    }
  
    return wrap;
  }

function renderCardActions(item) {
  const actions = el('div', {
    class: 'yanta-dash-card-actions',
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onpointerdown: (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
  });

  if (item.kind !== 'note') {
    actions.append(
      iconActionButton({
        icon: 'folder-open',
        title: 'Open',
        onClick: () => navigateDashboardFolder(item.folder.id),
      }),

      iconActionButton({
        icon: 'pencil',
        title: 'Rename',
        onClick: () => {
          const card = findDashboardFolderCard(item.folder.id);
          renameDashboardFolder(item.folder.id, card);
        },
      }),

      iconActionButton({
        icon: 'palette',
        title: 'Icon & color',
        onClick: () => editDashboardFolderAppearance(item.folder),
      }),
    );

    return actions;
  }

  const note = item.note;

  actions.append(
    iconActionButton({
      icon: note.pinned ? 'pin-off' : 'pin',
      title: note.pinned ? 'Unpin' : 'Pin',
      onClick: () => toggleDashboardPin(note.id),
    }),

    iconActionButton({
      icon: 'pencil',
      title: 'Rename',
      onClick: () => {
        const card = findDashboardNoteCard(note.id);
        renameDashboardNote(note.id, card);
      },
    }),

    iconActionButton({
      icon: 'palette',
      title: 'Icon & color',
      onClick: () => editDashboardNoteAppearance(note.id),
    }),

    iconActionButton({
      icon: 'copy',
      title: 'Duplicate',
      onClick: () => duplicateDashboardNote(note.id),
    }),
  );

  if (note.folderId) {
    actions.append(
      iconActionButton({
        icon: 'folder-up',
        title: 'Move out of folder',
        onClick: () => moveDashboardNoteOutOfFolder(note.id),
      })
    );
  }

  actions.append(
    iconActionButton({
      icon: 'trash',
      title: 'Delete',
      danger: true,
      onClick: () => deleteDashboardNote(note.id),
    })
  );

  return actions;
}

  function iconActionButton({ icon, title, danger = false, onClick }) {
    let ownPointerDownAt = 0;

    const btn = el('button', {
      type: 'button',
      class: 'yanta-dash-action-btn' + (danger ? ' danger' : ''),
      title,
      'aria-label': title,
      onclick: async (e) => {
        e.preventDefault();
        e.stopPropagation();

        /*
          Verhindert Ghost-Clicks nach Long-Press:
          Der Button darf nur reagieren, wenn er selbst vorher ein pointerdown
          bekommen hat. Keyboard/Screenreader-Clicks haben meist detail === 0
          und bleiben erlaubt.
        */
        const now = performance.now();
        if (e.detail > 0 && (!ownPointerDownAt || now - ownPointerDownAt > 5000)) {
          return;
        }
        ownPointerDownAt = 0;
  
        dashboard.suppressOpenUntil = performance.now() + 700;
  
        try {
          await onClick?.();
        } catch (err) {
          console.error(err);
          toast('Action failed', 'error');
        }
      },
      onpointerdown: (e) => {
        ownPointerDownAt = performance.now();
        e.preventDefault();
        e.stopPropagation();
      },
      onpointercancel: () => {
        ownPointerDownAt = 0;
      },
    });
  
    btn.innerHTML = lucide(icon, 15);
  
    return btn;
  }
  
  async function toggleDashboardPin(noteId) {
    const note = state.notes.get(noteId);
    if (!note) return;
  
    note.pinned = !note.pinned;
    note.updated = Date.now();
  
    if (note.pinned && note.dashboardPinnedOrder == null) {
      note.dashboardPinnedOrder = Date.now();
    }
  
    await store.notes.put(note);
  
    previewCache.delete(noteId);
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: { noteId },
    }));
  
    renderDashboard();
  }
  
  async function editDashboardNoteAppearance(noteId) {
    const note = state.notes.get(noteId);
    if (!note) return;
  
    const { editNoteAppearance } = await import('./graph.js');
    editNoteAppearance(note);
  }
  
  async function editDashboardFolderAppearance(folder) {
    if (!folder) return;
  
    const { editFolderAppearance } = await import('./graph.js');
    editFolderAppearance(folder);
  }
  
  async function duplicateDashboardNote(noteId) {
    const src = state.notes.get(noteId);
    if (!src) return;
  
    const id = uid();
  
    const copy = {
      ...src,
      id,
      title: `${src.title || 'Untitled'} (copy)`,
      pinned: false,
      dashboardOrder: Date.now(),
      dashboardPinnedOrder: undefined,
      created: Date.now(),
      updated: Date.now(),
    };
  
    delete copy.body;
    delete copy.bodyMigrated;
  
    state.notes.set(id, copy);
    await store.notes.put(copy);
  
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
        [
          copy.title || '',
          (copy.tags || []).join(' '),
          body || '',
        ].join(' ').toLowerCase()
      );
    } catch {}
  
    rebuildWikilinkIndex();
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: { noteId: id },
    }));
  
    toast('Note duplicated', 'success');
    renderDashboard();
  }
  
  async function deleteDashboardNote(noteId) {
    const note = state.notes.get(noteId);
    if (!note) return;
  
    if (!confirm(`Delete "${note.title || 'Untitled'}"? This cannot be undone.`)) {
      return;
    }
  
    await store.notes.del(noteId);
  
    state.notes.delete(noteId);
    state.searchIndex.delete(noteId);
    previewCache.delete(noteId);
  
    try {
      await destroyNoteDoc(noteId);
    } catch {}
  
    if (state.currentNoteId === noteId) {
      clearEditor();
    }
  
    rebuildWikilinkIndex();
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: { noteId },
    }));
  
    toast('Note deleted', 'success');
    renderDashboard();
  }
  
  async function moveDashboardNoteOutOfFolder(noteId) {
    const note = state.notes.get(noteId);
    if (!note || !note.folderId) return;
  
    note.folderId = null;
    note.updated = Date.now();
  
    await store.notes.put(note);
  
    previewCache.delete(noteId);
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: { noteId },
    }));
  
    toast('Moved to root', 'success');
    renderDashboard();
  }

function dashboardRenameTarget(cardOrAnchor, {
  noteId = '',
  folderId = '',
} = {}) {
  const card =
    cardOrAnchor?.closest?.('.yanta-dash-card') ||
    (noteId ? findDashboardNoteCard(noteId) : null) ||
    (folderId ? findDashboardFolderCard(folderId) : null);

  const anchor =
    card?.querySelector('.yanta-dash-card-title') ||
    cardOrAnchor;

  return { card, anchor };
}

function beginDashboardRename(card) {
  if (!card) return;

  const key = card.dataset.key || '';

  if (key) {
    dashboard.selectedKey = key;
  }

  card.classList.add('selected', 'is-renaming');

  dashboard.suppressOpenUntil = performance.now() + 1200;
}

function endDashboardRename(card) {
  if (!card) return;

  requestAnimationFrame(() => {
    if (!card.isConnected) return;

    card.classList.remove('is-renaming');
    dashboard.suppressOpenUntil = performance.now() + 350;
  });
}

async function renameDashboardNote(noteId, cardOrAnchor) {
  const note = state.notes.get(noteId);
  if (!note) return;

  const { card, anchor } = dashboardRenameTarget(cardOrAnchor, { noteId });
  if (!anchor) return;

  beginDashboardRename(card);

  inlineTextEdit(anchor, {
    initial: note.title || 'Untitled',
    placeholder: 'Note title',
    emptyFallback: 'Untitled',

    onCancel: () => {
      endDashboardRename(card);
    },

    onCommit: async (value) => {
      previewCache.delete(note.id);

      const result = await renameNoteById(noteId, value);

      /*
        renameNoteById() dispatcht yanta-note-updated/yanta-dashboard-refresh.
        Dadurch wird das Dashboard meistens neu gerendert.
        Falls nicht, klappen wir den temporären Header sauber wieder ein.
      */
      setTimeout(() => {
        endDashboardRename(card);
      }, 120);

      return result;
    },
  });
}

async function renameDashboardFolder(folderId, cardOrAnchor) {
  const folder = state.folders.get(folderId);
  if (!folder) return;

  const { card, anchor } = dashboardRenameTarget(cardOrAnchor, { folderId });
  if (!anchor) return;

  beginDashboardRename(card);

  inlineTextEdit(anchor, {
    initial: folder.name || 'Folder',
    placeholder: 'Folder name',
    emptyFallback: 'Folder',

    onCancel: () => {
      endDashboardRename(card);
    },

    onCommit: async (value) => {
      const result = await renameFolderById(folderId, value);

      setTimeout(() => {
        endDashboardRename(card);
      }, 120);

      return result;
    },
  });
}

function findDashboardNoteCard(noteId) {
  if (!root || !noteId) return null;

  return root.querySelector(
    `.yanta-dash-card[data-kind="note"][data-note-id="${CSS.escape(noteId)}"]`
  );
}

function renderCardHeader(item) {
  const head = el('div', { class: 'yanta-dash-card-head' });

  const icon = el('span', { class: 'yanta-dash-card-icon' });
  icon.innerHTML = lucide(itemIcon(item), 18);

  const title = el('div', {
    class: 'yanta-dash-card-title',
    title: itemTitle(item),

    ondblclick: (e) => {
      e.preventDefault();
      e.stopPropagation();

      const card = title.closest('.yanta-dash-card');

      if (item.kind === 'note') {
        renameDashboardNote(item.id, card || title);
      } else {
        renameDashboardFolder(item.id, card || title);
      }
    },
  }, itemTitle(item));

  head.append(icon, title);

  if (item.kind === 'folder') {
    const count = folderDirectCount(item.id);

    const badge = el('span', {
      class: 'yanta-dash-count',
      title: `${count} item${count === 1 ? '' : 's'}`,
    }, String(count));

    head.append(badge);
  }

  return head;
}
  
function folderPreviewItems(folderId) {
  const folders = [...state.folders.values()]
    .filter((f) => f.parentId === folderId)
    .map((folder) => ({
      kind: 'folder',
      id: folder.id,
      folder,
      title: folder.name || 'Folder',
      icon: defaultIconForFolder(folder),
      color: safeCssColor(folder.color) || '',
      order: fallbackOrderForFolder(folder),
    }));

  const notes = [...state.notes.values()]
    .filter((n) => n.folderId === folderId)
    .map((note) => ({
      kind: 'note',
      id: note.id,
      note,
      title: note.title || 'Untitled',
      icon: defaultIconForNote(note),
      color: safeCssColor(note.color) || '',
      order: fallbackOrderForNote(note),
    }));

  return [...folders, ...notes].sort((a, b) =>
    a.order - b.order ||
    a.title.localeCompare(b.title)
  );
}

function folderDirectBreakdown(folderId) {
  let folders = 0;
  let notes = 0;

  for (const f of state.folders.values()) {
    if (f.parentId === folderId) folders++;
  }

  for (const note of state.notes.values()) {
    if (note.folderId === folderId) notes++;
  }

  return {
    folders,
    notes,
    total: folders + notes,
  };
}

function folderMetaText(folderCount, noteCount, emptyText = '') {
  const parts = [];

  if (folderCount > 0) {
    parts.push(`${folderCount} folder${folderCount === 1 ? '' : 's'}`);
  }

  if (noteCount > 0) {
    parts.push(`${noteCount} note${noteCount === 1 ? '' : 's'}`);
  }

  return parts.join(' · ') || emptyText;
}

function renderFolderBody(folder) {
  const body = el('div', { class: 'yanta-dash-folder-body' });

  const items = folderPreviewItems(folder.id);

  if (!items.length) {
    body.classList.add('is-empty');

    body.innerHTML = `
      <div class="yanta-dash-folder-big-icon">${lucide(defaultIconForFolder(folder), 36)}</div>
    `;

    return body;
  }

  const grid = el('div', { class: 'yanta-dash-folder-preview-grid' });

  /*
    Zwei Spalten.
    Standardmäßig vier vollwertige Mini-Vorschauen.
    Bei höheren Folder-Cards sieht man durch das Grid automatisch mehr Inhalt.
  */
  const visible = items.slice(0, 4);
  const rest = items.length - visible.length;

  for (const child of visible) {
    grid.append(renderFolderPreviewCell(child));
  }

  if (rest > 0) {
    const more = el('div', {
      class: 'yanta-dash-folder-preview-cell more',
      title: `${rest} more`,
    });

    more.append(el('span', {
      class: 'yanta-dash-folder-preview-more',
    }, `+${rest}`));

    grid.append(more);
  }

  body.append(grid);

  return body;
}

function renderFolderMeta(folder) {
  const counts = folderDirectBreakdown(folder.id);
  const meta = folderMetaText(counts.folders, counts.notes, 'Empty folder');

  if (!meta) return null;

  return el('div', {
    class: 'yanta-dash-folder-meta',
  }, meta);
}

function renderFolderMiniFolderPreview(folder) {
  const wrap = el('div', {
    class: 'yanta-dash-folder-mini-folder-preview',
  });

  const items = folderPreviewItems(folder.id).slice(0, 3);

  if (!items.length) {
    wrap.append(el('div', {
      class: 'yanta-dash-folder-mini-empty',
    }, 'Empty folder'));
  } else {
    for (const item of items) {
      const row = el('div', {
        class: 'yanta-dash-folder-mini-folder-row',
        title: item.title,
      });

      row.innerHTML = `${lucide(item.kind === 'folder' ? defaultIconForFolder(item.folder) : defaultIconForNote(item.note), 11)}<span></span>`;
      row.querySelector('span').textContent = item.title;

      wrap.append(row);
    }
  }

  const counts = folderDirectBreakdown(folder.id);
  const meta = folderMetaText(counts.folders, counts.notes);

  if (meta) {
    wrap.append(el('div', {
      class: 'yanta-dash-folder-mini-meta',
    }, meta));
  }

  return wrap;
}

function renderFolderPreviewCell(child) {
  const cell = el('div', {
    class: 'yanta-dash-folder-preview-cell ' + child.kind,
    title: child.title,
    style: child.color ? { '--mini-color': child.color } : {},
    dataset: {
      miniKind: child.kind,
      miniId: child.id,
    },
  });

  const head = el('div', { class: 'yanta-dash-folder-preview-cell-head' });

  const ico = el('span', { class: 'yanta-dash-folder-preview-icon' });
  ico.innerHTML = lucide(child.icon, 13);

  head.append(
    ico,
    el('span', { class: 'yanta-dash-folder-preview-title' }, child.title)
  );

  cell.append(head);

  if (child.kind === 'folder') {
    cell.append(renderFolderMiniFolderPreview(child.folder));
    return cell;
  }

  const previewHost = el('div', {
    class: 'yanta-dash-folder-note-preview',
    dataset: {
      miniNotePreview: child.id,
    },
  });

  previewHost.innerHTML = `<div class="yanta-dash-folder-mini-skeleton"></div>`;

  cell.append(previewHost);

  /*
    Wichtig:
    Die Zelle hängt an dieser Stelle noch nicht sicher im DOM.
    Deshalb Mini-Preview erst im nächsten Frame laden.
  */
  requestAnimationFrame(() => {
    if (!previewHost.isConnected) return;

    hydrateFolderNotePreviewCell(previewHost, child.id).catch((err) => {
      console.warn('Folder mini note preview failed', child.id, err);

      if (!previewHost.isConnected) return;

      previewHost.replaceChildren(
        el('div', {
          class: 'yanta-dash-folder-mini-empty',
        }, 'Preview unavailable')
      );
    });
  });

  return cell;
}

async function hydrateFolderNotePreviewCell(host, noteId) {
  const note = state.notes.get(noteId);

  if (!note || !host) return;

  /*
    Nicht vor dem await auf isConnected abbrechen:
    Beim ersten Render hängt host ggf. noch nicht im DOM.
    Nach dem Laden prüfen wir aber wieder, damit alte Render nicht schreiben.
  */
  const preview = await getDashboardPreview(note);

  if (!host.isConnected) return;

  host.replaceChildren();

  if (!preview.blocks.length && !preview.badges.length) {
    host.append(el('div', {
      class: 'yanta-dash-folder-mini-empty',
    }, 'Empty note'));

    return;
  }

  let appended = 0;

  for (const block of preview.blocks) {
    if (appended >= 4) break;

    const node = renderFolderMiniNoteBlock(noteId, block);

    if (node) {
      host.append(node);
      appended++;
    }
  }

  if (preview.badges.length) {
    const badges = el('div', {
      class: 'yanta-dash-folder-mini-badges',
    });

    for (const badge of preview.badges.slice(0, 3)) {
      const pill = el('span', {
        class: 'yanta-dash-folder-mini-badge',
        title: badge.label,
      });

      pill.innerHTML = lucide(badge.icon, 9);
      badges.append(pill);
    }

    host.append(badges);
  }
}

function renderFolderMiniNoteBlock(noteId, block) {
  if (block.type === 'heading') {
    return el('div', {
      class: 'yanta-dash-folder-mini-line is-heading',
    }, block.text);
  }

  if (block.type === 'text') {
    return el('div', {
      class: 'yanta-dash-folder-mini-line',
    }, block.text);
  }

  if (block.type === 'quote') {
    return el('div', {
      class: 'yanta-dash-folder-mini-line is-quote',
    }, block.text);
  }

  if (block.type === 'list') {
    return el('div', {
      class: 'yanta-dash-folder-mini-line is-list',
    }, block.text);
  }

  if (block.type === 'task') {
    return el('div', {
      class:
        'yanta-dash-folder-mini-task' +
        (block.checked ? ' is-checked' : ''),
    }, [
      el('span', { class: 'yanta-dash-folder-mini-task-box' }),
      el('span', {}, block.text || 'Task'),
    ]);
  }

  if (block.type === 'image') {
    return renderFolderMiniImage(block);
  }

  if (block.type === 'video') {
    const media = el('div', {
      class: 'yanta-dash-folder-mini-media video',
    });

    media.innerHTML = `${lucide('play', 12)} <span>Video</span>`;

    return media;
  }

  if (block.type === 'drawing') {
    return renderFolderMiniDrawing(noteId, block);
  }

  return null;
}

function renderFolderMiniImage(block) {
  const media = el('div', {
    class: 'yanta-dash-folder-mini-media image',
  });

  media.innerHTML = `${lucide('image', 12)} <span>Image</span>`;

  resolveDashboardImageUrl(block.url)
    .then((src) => {
      if (!src || !media.isConnected) return;

      media.replaceChildren();

      media.append(el('img', {
        src,
        alt: block.alt || '',
        loading: 'lazy',
        draggable: 'false',
      }));
    })
    .catch(() => {});

  return media;
}

function renderFolderMiniDrawing(noteId, block) {
  const media = el('div', {
    class: 'yanta-dash-folder-mini-media drawing',
  });

  media.innerHTML = `${lucide('pencil', 12)} <span>Drawing</span>`;

  import('./draw.js')
    .then(async ({ drawingThumbnailUrl }) => {
      const hit = findDrawing(block.id, noteId);

      if (!hit || !media.isConnected) return;

      const url = await drawingThumbnailUrl(hit.noteId, block.id);

      if (!url || !media.isConnected) return;

      media.replaceChildren();

      media.append(el('img', {
        src: url,
        alt: 'Drawing',
        loading: 'lazy',
        draggable: 'false',
      }));
    })
    .catch(() => {});

  return media;
}

  function renderResizeHandle(key) {
    const handle = el('div', {
      class: 'yanta-dash-resize-handle',
      title: 'Drag to resize · double-click to reset',
      dataset: { resizeHandle: key },
    });
  
    handle.innerHTML = `<span></span>`;
  
    bindResizeHandle(handle, key);
  
    return handle;
  }
  
  function folderDirectCount(folderId) {
    let n = 0;
  
    for (const f of state.folders.values()) {
      if (f.parentId === folderId) n++;
    }
  
    for (const note of state.notes.values()) {
      if (note.folderId === folderId) n++;
    }
  
    return n;
  }
  
  // ============================================================
  // Preview extraction
  // ============================================================
  
  async function hydrateCardPreview(card, noteId) {
    const note = state.notes.get(noteId);
    if (!note || !card.isConnected) return;
  
    const host = card.querySelector('[data-preview-host]');
    if (!host) return;
  
    const preview = await getDashboardPreview(note);

    host.classList.toggle('is-media-only', !!preview.mediaOnly);

    const contentMaxH = autoHeightForPreview(preview);
    card.dataset.contentMaxHeight = String(contentMaxH);
  
    if (!card.isConnected) return;
  
    // Auto-size unless user manually resized.
    if (note.dashboardHeightPx == null && note.dashboardHeight == null) {
      const autoH = contentMaxH;
      card.style.setProperty('--dash-row-span', String(heightToGridSpan(autoH)));
      card.dataset.effectiveHeight = String(autoH);
    } else {
      const storedH = itemDashboardHeightPx({ kind: 'note', note, id: note.id });
      const cappedH = Math.min(storedH, contentMaxH);

      card.style.setProperty('--dash-row-span', String(heightToGridSpan(cappedH)));
      card.dataset.effectiveHeight = String(cappedH);
    }
    host.replaceChildren();
  
    if (!preview.blocks.length && !preview.badges.length) {
      host.append(el('div', {
        class: 'yanta-dash-empty-preview',
      }, 'Empty note'));
      return;
    }
  
    for (const block of preview.blocks) {
      if (block.type === 'heading') {
        host.append(el('div', {
          class: `yanta-dash-preview-line is-heading level-${block.level}`,
        }, block.text));
        continue;
      }
  
      if (block.type === 'text') {
        host.append(el('div', {
          class: 'yanta-dash-preview-line',
        }, block.text));
        continue;
      }
  
      if (block.type === 'quote') {
        host.append(el('div', {
          class: 'yanta-dash-preview-line is-quote',
        }, block.text));
        continue;
      }
  
      if (block.type === 'list') {
        host.append(el('div', {
          class: 'yanta-dash-preview-line is-list',
        }, block.text));
        continue;
      }
  
      if (block.type === 'task') {
        host.append(renderDashboardTask(noteId, block));
        continue;
      }
  
      if (block.type === 'image') {
        host.append(await renderDashboardImage(block));
        continue;
      }
  
      if (block.type === 'video') {
        host.append(renderDashboardVideo(block));
        continue;
      }
  
      if (block.type === 'drawing') {
        host.append(renderDashboardDrawing(noteId, block));
        continue;
      }
    }
  
    if (preview.badges.length) {
      const badges = el('div', { class: 'yanta-dash-badges' });
  
      for (const badge of preview.badges) {
        const pill = el('span', {
          class: 'yanta-dash-badge',
          title: badge.label,
        });
  
        pill.innerHTML = lucide(badge.icon, 12);
        badges.append(pill);
      }
  
      host.append(badges);
    }
  }

  function renderDashboardTask(noteId, task) {
    const row = el('label', {
      class: 'yanta-dash-task',
      onclick: (e) => {
        e.stopPropagation();
      },
    });
  
    const cb = el('input', {
      type: 'checkbox',
    });
  
    cb.checked = task.checked;
  
    cb.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
  
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  
    cb.addEventListener('change', async (e) => {
      e.stopPropagation();
  
      await toggleTaskLineInNote(noteId, task.line, cb.checked);
  
      previewCache.delete(noteId);
  
      const card = root?.querySelector(`.yanta-dash-card[data-note-id="${CSS.escape(noteId)}"]`);
  
      if (card) {
        await hydrateCardPreview(card, noteId);
      }
    });
  
    row.append(cb, el('span', {}, task.text || 'Task'));
  
    return row;
  }
  
  async function renderDashboardImage(block) {
    const wrap = el('div', { class: 'yanta-dash-media yanta-dash-image' });
  
    const img = el('img', {
      alt: block.alt || '',
      loading: 'lazy',
      draggable: 'false',
    });
  
    const src = await resolveDashboardImageUrl(block.url);
  
    if (src) {
      img.src = src;
      wrap.append(img);
    } else {
      wrap.append(el('div', {
        class: 'yanta-dash-drawing-thumb',
      }, 'Image unavailable'));
    }
  
    return wrap;
  }
  
function renderDashboardVideo(block) {
  const thumb =
    block.thumb ||
    videoThumbnailUrl(block.url || '') ||
    videoThumbnailUrl(block.embed || '');

  const wrap = el('div', {
    class: 'yanta-dash-media yanta-dash-video-thumb',
    title: block.title || 'Video',
  });

  if (thumb) {
    const img = el('img', {
      src: thumb,
      alt: block.title || 'Video',
      loading: 'lazy',
      draggable: 'false',
    });

    const play = el('div', {
      class: 'yanta-dash-video-play',
      'aria-hidden': 'true',
    });

    play.innerHTML = lucide('play', 22);

    wrap.append(img, play);
  } else {
    wrap.innerHTML = `
      <div class="yanta-dash-video-fallback">
        ${lucide('play', 24)}
        <span>${block.title || 'Video'}</span>
      </div>
    `;
  }

  return wrap;
}
  
  function renderDashboardDrawing(noteId, block) {
    const wrap = el('div', { class: 'yanta-dash-media yanta-dash-drawing-thumb' });
  
    wrap.innerHTML = `${lucide('pencil', 24)} <span style="margin-left:8px">Drawing</span>`;
  
    import('./draw.js')
      .then(async ({ drawingThumbnailUrl }) => {
        const hit = findDrawing(block.id, noteId);
        if (!hit || !wrap.isConnected) return;
  
        const url = await drawingThumbnailUrl(hit.noteId, block.id);
        if (!url || !wrap.isConnected) return;
  
        wrap.replaceChildren();
  
        wrap.append(el('img', {
          src: url,
          alt: 'Drawing',
          loading: 'lazy',
          draggable: 'false',
        }));
      })
      .catch(() => {});
  
    return wrap;
  }
  
  async function resolveDashboardImageUrl(url) {
    const raw = String(url || '');
  
    if (!raw.startsWith('yanta-img://')) {
      return raw;
    }
  
    const id = raw.slice('yanta-img://'.length);
  
    if (state.imageBlobs.has(id)) {
      return state.imageBlobs.get(id);
    }
  
    try {
      const rec = await store.images.get(id);
  
      if (rec?.blob) {
        const obj = URL.createObjectURL(rec.blob);
        state.imageBlobs.set(id, obj);
        return obj;
      }
    } catch {}
  
    return '';
  }

  async function getDashboardPreview(note) {
    const cached = previewCache.get(note.id);
  
    if (
      cached &&
      cached.updated === note.updated
    ) {
      return cached.preview;
    }
  
    const entry = getNoteDoc(note.id);
    await entry.ready;
  
    let md = '';
  
    try {
      md = noteMarkdown(note.id);
    } catch {
      md = '';
    }
  
    const preview = extractDashboardPreview(md, note);
  
    previewCache.set(note.id, {
      updated: note.updated,
      textLen: md.length,
      preview,
    });
  
    return preview;
  }
  
  function extractDashboardPreview(md, note) {
    const lines = String(md || '').split('\n');

    const blocks = [];
    const badges = [];

    let hasCitation = false;
    let hasLinks = false;

    let inFence = false;

    let meaningfulCount = 0;
    let nonMediaContent = false;
    let firstMeaningfulType = '';

    const pushBlock = (block) => {
      if (blocks.length < 8) {
        blocks.push(block);
      }
    };

    const markMeaningful = (type) => {
      meaningfulCount++;

      if (!firstMeaningfulType) {
        firstMeaningfulType = type;
      }

      if (!['image', 'video', 'drawing'].includes(type)) {
        nonMediaContent = true;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] || '';
      const line = raw.trim();

      if (/^```/.test(line)) {
        inFence = !inFence;
        markMeaningful('text');
        continue;
      }

      if (inFence) {
        if (line) {
          markMeaningful('text');

          pushBlock({
            type: 'text',
            text: cleanInlineText(line).slice(0, 220),
          });
        }

        continue;
      }

      if (!line) continue;

      if (/\[\^([^\]\s]+)\]/.test(raw)) {
        hasCitation = true;
      }

      if (/\[\[[^\]]+\]\]/.test(raw)) {
        hasLinks = true;
      }

      const drawing = /^\s*draw:\/\/([a-z0-9_-]+)\s*$/i.exec(raw);

      if (drawing) {
        markMeaningful('drawing');

        pushBlock({
          type: 'drawing',
          id: drawing[1],
        });

        continue;
      }

      const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\{[^}\n]*\})?\s*$/.exec(raw);

      if (image) {
        const embed = videoEmbedUrl(image[2]);

        if (embed) {
          markMeaningful('video');

          pushBlock({
            type: 'video',
            embed,
            thumb: videoThumbnailUrl(image[2]),
            title: cleanInlineText(image[1]) || 'Video',
            url: image[2],
          });
        } else {
          markMeaningful('image');

          pushBlock({
            type: 'image',
            alt: cleanInlineText(image[1]),
            url: image[2],
          });
        }

        continue;
      }

      const videoLink = /^\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(raw);

      if (videoLink) {
        const embed = videoEmbedUrl(videoLink[2]);

        if (embed) {
          markMeaningful('video');

          pushBlock({
            type: 'video',
            embed,
            thumb: videoThumbnailUrl(videoLink[2]),
            title: cleanInlineText(videoLink[1]) || 'Video',
            url: videoLink[2],
          });

          continue;
        }
      }

      /*
        Optional: reine YouTube/Vimeo-URL als Video behandeln.
        Dadurch zählt eine Note mit nur einer Video-URL ebenfalls als Media-only.
      */
      if (/^https?:\/\/\S+$/i.test(line)) {
        const embed = videoEmbedUrl(line);

        if (embed) {
          markMeaningful('video');

          pushBlock({
            type: 'video',
            embed,
          });

          continue;
        }
      }

      const task = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/.exec(raw);

      if (task) {
        markMeaningful('task');

        pushBlock({
          type: 'task',
          line: i,
          checked: task[2].toLowerCase() === 'x',
          text: cleanInlineText(task[4]).slice(0, 160),
        });

        continue;
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);

      if (heading) {
        const text = cleanInlineText(heading[2]);

        if (text) {
          markMeaningful('heading');

          pushBlock({
            type: 'heading',
            level: Math.min(6, heading[1].length),
            text,
          });
        }

        continue;
      }

      const quote = /^\s*>\s?(.*)$/.exec(raw);

      if (quote) {
        const text = cleanInlineText(quote[1]);

        if (text) {
          markMeaningful('quote');

          pushBlock({
            type: 'quote',
            text: text.slice(0, 180),
          });
        }

        continue;
      }

      const ul = /^\s*[-*+]\s+(.*)$/.exec(raw);

      if (ul) {
        const text = cleanInlineText(ul[1]);

        if (text) {
          markMeaningful('list');

          pushBlock({
            type: 'list',
            text: text.slice(0, 140),
          });
        }

        continue;
      }

      const ol = /^\s*\d+\.\s+(.*)$/.exec(raw);

      if (ol) {
        const text = cleanInlineText(ol[1]);

        if (text) {
          markMeaningful('list');

          pushBlock({
            type: 'list',
            text: text.slice(0, 140),
          });
        }

        continue;
      }

      if (/^\|.*\|$/.test(line)) {
        markMeaningful('text');
        continue;
      }

      if (/^\[\^[^\]]+\]:/.test(line)) {
        markMeaningful('text');
        continue;
      }

      const text = cleanInlineText(line);

      if (text) {
        markMeaningful('text');

        pushBlock({
          type: 'text',
          text: text.slice(0, 220),
        });
      }
    }

    if (hasLinks) badges.push({ icon: 'link', label: 'Links' });
    if (hasCitation) badges.push({ icon: 'quote', label: 'Citation' });

    const mediaOnly =
      meaningfulCount === 1 &&
      !nonMediaContent &&
      ['image', 'video', 'drawing'].includes(firstMeaningfulType);

    return {
      blocks,
      badges,
      mediaOnly,
    };
  }

function youtubeVideoId(url) {
  const s = String(url || '').trim();

  try {
    const u = new URL(s, location.href);
    const host = u.hostname.replace(/^www\./, '');

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      if (u.pathname === '/watch') {
        return u.searchParams.get('v') || '';
      }

      const embed = /^\/embed\/([a-zA-Z0-9_-]{6,})/.exec(u.pathname);
      if (embed) return embed[1];

      const shorts = /^\/shorts\/([a-zA-Z0-9_-]{6,})/.exec(u.pathname);
      if (shorts) return shorts[1];
    }

    if (host === 'youtu.be') {
      return u.pathname.replace(/^\//, '').split('/')[0] || '';
    }
  } catch {}

  let m;

  if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  if ((m = /(?:youtube\.com|youtube-nocookie\.com)\/embed\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  if ((m = /youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  return '';
}

function videoEmbedUrl(url) {
  const s = String(url || '').trim();

  const yt = youtubeVideoId(s);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}`;

  let m;

  if ((m = /vimeo\.com\/(\d+)/.exec(s))) {
    return `https://player.vimeo.com/video/${m[1]}`;
  }

  return '';
}

function videoThumbnailUrl(url) {
  const yt = youtubeVideoId(url);

  if (yt) {
    return `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
  }

  // Vimeo-Thumbnails brauchen normalerweise einen API/oEmbed-Request.
  // Daher für Vimeo erstmal kein Thumbnail.
  return '';
}

  function cleanInlineText(s) {
    return String(s || '')
      // transclusions / wikilinks
      .replace(/!\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_full, target, alias) => alias || target)
  
      // markdown images / links
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  
      // inline code / emphasis
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/==([^=]+)==/g, '$1')
  
      // footnote refs
      .replace(/\[\^([^\]\s]+)\]/g, '')
  
      // light cleanup
      .replace(/[>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  // ============================================================
  // Card open/navigation
  // ============================================================
  function pushDashboardFolderHistory() {
    history.pushState(
      dashboardState(dashboard.folderId),
      '',
      dashboardUrl(dashboard.folderId)
    );
  }

  function dashboardPage() {
    return root?.querySelector('.yanta-dashboard-page') || null;
  }

  function setTemporaryViewTransitionElement(node, transitionName, className = '', {
    viewportClip = false,
  } = {}) {
    if (!node || !transitionName) return null;

    const token = {
      node,
      previousViewTransitionName: node.style.viewTransitionName,
      previousContain: node.style.contain,
      previousHeight: node.style.height,
      previousOverflow: node.style.overflow,
      previousBackground: node.style.background,
      className,
      active: true,
    };

    node.style.viewTransitionName = transitionName;
    node.style.contain = 'layout paint';

    /*
      For folder page transitions we must snapshot the visible dashboard area,
      not an arbitrarily tall content box. This makes it behave like panes.
    */
    if (viewportClip && root) {
      const r = root.getBoundingClientRect();
      node.style.height = `${Math.max(1, Math.round(r.height))}px`;
      node.style.overflow = 'hidden';
      node.style.background = 'var(--bg)';
    }

    if (className) {
      node.classList.add(className);
    }

    return token;
  }

  function clearTemporaryViewTransitionElement(token) {
    if (!token || !token.active) return;

    token.active = false;

    const node = token.node;

    if (!node || !node.isConnected) return;

    node.style.viewTransitionName = token.previousViewTransitionName || '';
    node.style.contain = token.previousContain || '';
    node.style.height = token.previousHeight || '';
    node.style.overflow = token.previousOverflow || '';
    node.style.background = token.previousBackground || '';

    if (token.className) {
      node.classList.remove(token.className);
    }
  }

  function folderPathForId(folderId) {
    const parts = [];
    const seen = new Set();

    let f = folderId ? state.folders.get(folderId) : null;

    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      parts.unshift(f);
      f = f.parentId ? state.folders.get(f.parentId) : null;
    }

    return parts;
  }

  function visibleFolderCardIdForTargetView(fromFolderId, targetFolderId) {
    if (!fromFolderId) return null;

    const path = folderPathForId(fromFolderId);

    if (!path.length) return fromFolderId;

    /*
      Home / A / B / C -> Home
      In Home, A is visible.
    */
    if (!targetFolderId) {
      return path[0]?.id || fromFolderId;
    }

    /*
      Home / A / B / C -> A
      In A, B is visible.
    */
    const idx = path.findIndex((f) => f.id === targetFolderId);

    if (idx >= 0 && idx < path.length - 1) {
      return path[idx + 1].id;
    }

    return fromFolderId;
  }

  function findDashboardFolderCard(folderId) {
    if (!root || !folderId) return null;

    return root.querySelector(
      `.yanta-dash-card[data-kind="folder"][data-folder-id="${CSS.escape(folderId)}"]`
    );
  }

  function scrollElementIntoDashboardView(node) {
    if (!node) return;

    try {
      node.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'instant',
      });
    } catch {
      try {
        node.scrollIntoView({
          block: 'center',
          inline: 'nearest',
        });
      } catch {}
    }
  }

  function commitDashboardFolderNavigation(folderId, { push = true } = {}) {
    dashboard.folderId = folderId || null;
    dashboard.selectedKey = null;

    if (push) {
      pushDashboardFolderHistory();
    }

    renderDashboard();
  }

async function navigateDashboardFolder(folderId, {
  sourceCard = null,
  push = true,
} = {}) {
  ensureDashboardRoot();

  const fromFolderId = dashboard.folderId || null;
  const targetFolderId = folderId || null;

  if (fromFolderId === targetFolderId) return;
  if (dashboard.dragging || dashboard.resize) return;

  dashboard.suppressOpenUntil = performance.now() + 850;

  const isOpeningFolder =
    !!sourceCard &&
    !!targetFolderId &&
    sourceCard.dataset.folderId === targetFolderId;

  /*
    Same model as Notes:
      Note open/back:
        card <-> panes

      Folder open/back:
        folder-card <-> yanta-dashboard-page

    Wichtig:
    Im startViewTransition()-Update-Callback NICHT auf requestAnimationFrame()
    warten. Das kann die Transition blockieren/hängen lassen.
  */
  const sharedFolderId = isOpeningFolder
    ? targetFolderId
    : visibleFolderCardIdForTargetView(fromFolderId, targetFolderId);

  if (!document.startViewTransition || !sharedFolderId) {
    commitDashboardFolderNavigation(targetFolderId, { push });

    root?.scrollTo?.({
      top: 0,
      behavior: 'smooth',
    });

    dashboard.suppressOpenUntil = performance.now() + 350;
    return;
  }

  const transitionName = transitionNameFor('folder', sharedFolderId);

  const oldPage = dashboardPage();

  const oldElement = isOpeningFolder
    ? sourceCard
    : oldPage;

  if (!oldElement) {
    commitDashboardFolderNavigation(targetFolderId, { push });
    dashboard.suppressOpenUntil = performance.now() + 350;
    return;
  }

  const oldToken = setTemporaryViewTransitionElement(
    oldElement,
    transitionName,
    'is-folder-transition-source',
    {
      viewportClip: !isOpeningFolder,
    }
  );

  let newToken = null;

  const vt = document.startViewTransition(() => {
    commitDashboardFolderNavigation(targetFolderId, { push });

    if (isOpeningFolder) {
      root.scrollTop = 0;

      const newPage = dashboardPage();

      newToken = setTemporaryViewTransitionElement(
        newPage,
        transitionName,
        'is-folder-transition-target',
        {
          viewportClip: true,
        }
      );

      return;
    }

    /*
      Back/up:
      old dashboard page -> folder card in new dashboard.

      Kein await requestAnimationFrame() hier!
      scrollIntoView({ behavior:'instant' }) reicht synchron aus.
    */
    let targetCard = findDashboardFolderCard(sharedFolderId);

    if (targetCard) {
      scrollElementIntoDashboardView(targetCard);

      /*
        Nach scrollIntoView erneut suchen, falls durch Render/Scroll/Layout
        etwas aktualisiert wurde. Aber synchron bleiben.
      */
      targetCard = findDashboardFolderCard(sharedFolderId);
    }

    if (targetCard) {
      newToken = setTemporaryViewTransitionElement(
        targetCard,
        transitionName,
        'is-folder-transition-target'
      );

      return;
    }

    /*
      Fallback if target card is not present.
    */
    root.scrollTop = 0;

    const newPage = dashboardPage();

    newToken = setTemporaryViewTransitionElement(
      newPage,
      transitionName,
      'is-folder-transition-target',
      {
        viewportClip: true,
      }
    );
  });

  vt.ready.catch((err) => {
    console.warn('Folder view transition skipped:', err);
  });

  await vt.finished.catch(() => {});

  clearTemporaryViewTransitionElement(oldToken);
  clearTemporaryViewTransitionElement(newToken);

  dashboard.suppressOpenUntil = performance.now() + 350;
}

  async function openItem(item, card) {
    if (performance.now() < (dashboard.suppressOpenUntil || 0)) return;
    if (dashboard.dragging || dashboard.resize) return;
  
    if (item.kind === 'folder') {
      await navigateDashboardFolder(item.id, {
        sourceCard: card,
      });
      return;
    }
  
    await openNoteFromDashboard(item.note.id, card);
  }
  
  async function openNoteFromDashboard(noteId, card) {
    dashboard.internalOpeningNote = true;
  
    const transitionName = transitionNameFor('note', noteId);
  
    try {
      if (document.startViewTransition && card) {
        card.style.viewTransitionName = transitionName;
        card.style.contain = 'layout paint';
  
        let target = null;

        const vt = document.startViewTransition(async () => {
          hideDashboard({ push: false });
  
          await openNote(noteId);
  
          target = $('panes');
  
          if (target) {
            target.style.viewTransitionName = transitionName;
            target.style.contain = 'layout paint';
            target.classList.add('is-note-transition-target');
          }
        });
  
        await vt.finished.catch(() => {});
  
        if (target) {
          target.style.viewTransitionName = '';
          target.style.contain = '';
          target.classList.remove('is-note-transition-target');
        }
  
        card.style.viewTransitionName = '';
        card.style.contain = '';

        return;
      }
  
      await animateCardToScreen(card, async () => {
        hideDashboard({ push: false });
        await openNote(noteId);
      });
    } finally {
      dashboard.internalOpeningNote = false;
    }
  }
  
  async function animateCardToScreen(card, mutate) {
    if (!card) {
      await mutate();
      return;
    }
  
    const r = card.getBoundingClientRect();
    const clone = card.cloneNode(true);
  
    clone.classList.add('yanta-dash-card-clone');
    clone.style.position = 'fixed';
    clone.style.left = r.left + 'px';
    clone.style.top = r.top + 'px';
    clone.style.width = r.width + 'px';
    clone.style.height = r.height + 'px';
    clone.style.margin = '0';
    clone.style.zIndex = '300';
    clone.style.pointerEvents = 'none';
  
    document.body.append(clone);
  
    card.style.opacity = '0';
  
    const anim = clone.animate([
      {
        left: r.left + 'px',
        top: r.top + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
        borderRadius: getComputedStyle(card).borderRadius,
      },
      {
        left: '0px',
        top: '0px',
        width: window.innerWidth + 'px',
        height: window.innerHeight + 'px',
        borderRadius: '0px',
      },
    ], {
      duration: 260,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'forwards',
    });
  
    await anim.finished.catch(() => {});
    await mutate();
  
    clone.remove();
  }
  
  // ============================================================
  // Long press, drag reorder, resize
  // ============================================================

  function bindCardPointerInteractions(card, item) {
    let pressTimer = 0;
    let active = null;

    const key = itemKey(item);

    const clearPress = () => {
      clearTimeout(pressTimer);
      pressTimer = 0;
    };

    const selectInPlace = () => {
      dashboard.selectedKey = key;

      root
        ?.querySelectorAll('.yanta-dash-card.selected')
        ?.forEach((node) => {
          if (node !== card) node.classList.remove('selected');
        });

      card.classList.add('selected');

      /*
        Wichtig:
        Ohne echten Fokus bekommt die Card keine keydown-Events.
        F2/F12/Enter funktionieren sonst nach Long-Press oft nicht.
      */
      try {
        card.focus({ preventScroll: true });
      } catch {
        card.focus();
      }
    };

    const cleanupPending = () => {
      clearPress();

      document.removeEventListener('pointermove', onDocumentPendingMove, true);
      document.removeEventListener('pointerup', onDocumentPendingUp, true);
      document.removeEventListener('pointercancel', onDocumentPendingCancel, true);

      root?.classList.remove('is-touch-scrolling');

      active = null;
    };

    card.addEventListener('contextmenu', (e) => {
      if (!dashboard.visible) return;
      e.preventDefault();
      e.stopPropagation();
    });

    card.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest?.('input, button, a, textarea, select, iframe, .yanta-dash-resize-handle')) return;
      if (dashboard.resize || dashboard.dragging) return;

      const pointerType = e.pointerType || 'mouse';

      active = {
        pointerId: e.pointerId,
        pointerType,
        downX: e.clientX,
        downY: e.clientY,
        lastScrollY: e.clientY,
        moved: false,
        longPressed: false,
        dragStarted: false,
        scrolling: false,
      };

      clearPress();

      /*
        CSS setzt touch-action:none auf Cards.
        Deshalb verhindern wir native Gesten und scrollen bei Touch selbst,
        solange der Long-Press noch nicht aktiv ist.
      */
      e.preventDefault();
      e.stopPropagation();

      try {
        card.setPointerCapture?.(e.pointerId);
      } catch {}

      pressTimer = window.setTimeout(() => {
        if (!active || active.pointerId !== e.pointerId) return;
        if (active.scrolling || active.dragStarted) return;

        active.longPressed = true;
        selectInPlace();

        dashboard.suppressOpenUntil = performance.now() + 600;
      }, LONG_PRESS_MS);

      document.addEventListener('pointermove', onDocumentPendingMove, true);
      document.addEventListener('pointerup', onDocumentPendingUp, true);
      document.addEventListener('pointercancel', onDocumentPendingCancel, true);
    }, { passive: false });

    function onDocumentPendingMove(e) {
      if (!active || e.pointerId !== active.pointerId) return;

      const dx = e.clientX - active.downX;
      const dy = e.clientY - active.downY;
      const dist = Math.hypot(dx, dy);

      if (dashboard.dragging?.key === key) {
        e.preventDefault();
        e.stopPropagation();
        moveCardDrag(e);
        return;
      }

      /*
        Touch-Scroll-Modus:
        Wenn der User vor Long-Press vertikal bewegt, ist es Scrollen.
        Da touch-action:none gesetzt ist, machen wir den Scroll manuell.
      */
      if (active.scrolling) {
        e.preventDefault();
        e.stopPropagation();

        if (root) {
          const delta = active.lastScrollY - e.clientY;
          root.scrollBy(0, delta);
        }

        active.lastScrollY = e.clientY;
        active.moved = true;
        return;
      }

      if (dist <= MOVE_TOLERANCE) {
        if (active.longPressed) {
          e.preventDefault();
          e.stopPropagation();
        }

        return;
      }

      active.moved = true;

      const canStartDrag =
        active.pointerType !== 'touch' ||
        active.longPressed ||
        dashboard.selectedKey === key;

      /*
        Touch vor Long-Press bedeutet weiterhin: scrollen, nicht draggen.
        Dadurch bleibt die UX natürlich, obwohl Cards touch-action:none haben.
      */
      if (!canStartDrag) {
        clearPress();

        active.scrolling = true;
        active.lastScrollY = active.downY;

        root?.classList.add('is-touch-scrolling');

        e.preventDefault();
        e.stopPropagation();

        if (root) {
          const delta = active.lastScrollY - e.clientY;
          root.scrollBy(0, delta);
        }

        active.lastScrollY = e.clientY;
        dashboard.suppressOpenUntil = performance.now() + 350;
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      clearPress();

      if (!active.longPressed) {
        active.longPressed = true;
        selectInPlace();
      }

      if (!active.dragStarted) {
        active.dragStarted = true;

        dashboard.suppressOpenUntil = performance.now() + 900;
        startCardDrag(card, item, e);
      }
    }

    async function onDocumentPendingUp(e) {
      if (!active || e.pointerId !== active.pointerId) return;

      const snapshot = active;
      const wasDragging = dashboard.dragging?.key === key;

      e.preventDefault();
      e.stopPropagation();

      try {
        card.releasePointerCapture?.(e.pointerId);
      } catch {}

      cleanupPending();

      if (wasDragging) {
        await finishCardDrag();
        dashboard.suppressOpenUntil = performance.now() + 750;
        return;
      }

      if (snapshot.scrolling) {
        dashboard.suppressOpenUntil = performance.now() + 250;
        return;
      }

      if (snapshot.longPressed && !snapshot.dragStarted) {
        selectInPlace();
        dashboard.suppressOpenUntil = performance.now() + 350;
        return;
      }

      if (!snapshot.moved && !snapshot.longPressed) {
        await openItem(item, card);
      }
    }

    function onDocumentPendingCancel(e) {
      if (!active || e.pointerId !== active.pointerId) return;

      const wasDragging = dashboard.dragging?.key === key;

      try {
        card.releasePointerCapture?.(e.pointerId);
      } catch {}

      cleanupPending();

      if (wasDragging) {
        cancelCardDrag();
      }
    }

    card.addEventListener('keydown', async (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        e.stopPropagation();

        if (item.kind === 'note') {
          renameDashboardNote(item.id, card);
        } else {
          renameDashboardFolder(item.id, card);
        }

        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        await openItem(item, card);
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();

        if (dashboard.dragging) {
          await cancelCardDrag();
          return;
        }

        dashboard.selectedKey = null;
        renderDashboard();
      }
    });
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  }

  function clearFolderDropTargets() {
    root
      ?.querySelectorAll('.yanta-dash-card.folder-drop-target')
      ?.forEach((node) => node.classList.remove('folder-drop-target'));
  }

  function clearInsertTargets() {
    root
      ?.querySelectorAll('.yanta-dash-card.insert-before, .yanta-dash-card.insert-after')
      ?.forEach((node) => {
        node.classList.remove('insert-before');
        node.classList.remove('insert-after');
      });
  }

  function clearDragVisuals() {
    clearFolderDropTargets();
    clearInsertTargets();
  }

  function gridItemRowSpan(card) {
    if (!card) return 18;

    const inlineVar = String(card.style.getPropertyValue('--dash-row-span') || '').trim();

    if (/^\d+$/.test(inlineVar)) {
      return Number(inlineVar);
    }

    const computed = getComputedStyle(card);
    const computedVar = String(computed.getPropertyValue('--dash-row-span') || '').trim();

    if (/^\d+$/.test(computedVar)) {
      return Number(computedVar);
    }

    const rowEnd = String(computed.gridRowEnd || '').trim();
    const m = /span\s+(\d+)/i.exec(rowEnd);

    if (m) {
      return Number(m[1]);
    }

    const h =
      Number(card.dataset.effectiveHeight) ||
      card.getBoundingClientRect().height ||
      DEFAULT_NOTE_HEIGHT;

    return heightToGridSpan(h);
  }

  function createDragPlaceholder(card) {
    const computed = getComputedStyle(card);
    const span = gridItemRowSpan(card);

    const placeholder = document.createElement('div');
    placeholder.className = 'yanta-dash-placeholder';

    placeholder.dataset.placeholderFor = card.dataset.key || '';
    placeholder.style.setProperty('--dash-row-span', String(span));
    placeholder.style.borderRadius = computed.borderRadius || '16px';

    /*
      Keine explizite height setzen.
      Der Placeholder soll exakt den gleichen Grid-Span wie die Source haben.
      Das verhindert Overlaps bei gap/row-span Kombinationen.
    */

    return placeholder;
  }

  function dragAnimElements(grid) {
    return [...grid.children].filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.classList.contains('drag-clone')) return false;
      if (node.classList.contains('drag-source')) return false;
      if (node.classList.contains('yanta-dash-placeholder')) return false;

      return node.classList.contains('yanta-dash-card');
    });
  }

  function animateGridMutation(grid, mutate) {
    if (!grid || prefersReducedMotion()) {
      mutate?.();
      return;
    }

    const nodes = dragAnimElements(grid);
    const before = new Map();

    for (const node of nodes) {
      node.__yantaDashFlipAnimation?.cancel?.();
      node.__yantaDashFlipAnimation = null;
      before.set(node, node.getBoundingClientRect());
    }

    mutate?.();

    const afterNodes = dragAnimElements(grid);

    for (const node of afterNodes) {
      const a = before.get(node);
      if (!a) continue;

      const b = node.getBoundingClientRect();

      const dx = a.left - b.left;
      const dy = a.top - b.top;

      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      node.__yantaDashFlipAnimation = node.animate(
        [
          {
            transform: `translate3d(${dx}px, ${dy}px, 0)`,
          },
          {
            transform: 'translate3d(0, 0, 0)',
          },
        ],
        {
          duration: 150,
          easing: 'cubic-bezier(.2,.8,.2,1)',
          fill: 'both',
        }
      );

      node.__yantaDashFlipAnimation.addEventListener('finish', () => {
        if (node.__yantaDashFlipAnimation) {
          node.__yantaDashFlipAnimation = null;
        }
      }, { once: true });
    }
  }

  function startCardDrag(card, item, e) {
    if (dashboard.dragging) return;

    const grid = card.closest('.yanta-dashboard-grid');
    if (!grid) return;

    const key = itemKey(item);
    const rect = card.getBoundingClientRect();

    const placeholder = createDragPlaceholder(card);

    grid.insertBefore(placeholder, card);

    const clone = card.cloneNode(true);
    clone.classList.add('drag-clone');
    clone.classList.remove('selected');
    clone.style.viewTransitionName = 'none';

    Object.assign(clone.style, {
      position: 'fixed',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      margin: '0',
      zIndex: '1000',
      pointerEvents: 'none',
    });

    clone.style.setProperty('transform', 'translate3d(0,0,0)', 'important');

    document.body.append(clone);

    /*
      display:none entfernt die Source aus dem Grid-Flow.
      Der Placeholder übernimmt exakt ihren Slot.
    */
    card.classList.add('drag-source');
    card.style.display = 'none';
    card.style.viewTransitionName = 'none';

    root?.classList.add('is-card-dragging');

    dashboard.suppressOpenUntil = performance.now() + 900;

    dashboard.dragging = {
      key,
      section: card.dataset.section || '',
      grid,
      source: card,
      clone,
      placeholder,

      sourceKind: item.kind,
      sourceId: item.id,

      width: rect.width,
      height: rect.height,

      startLeft: rect.left,
      startTop: rect.top,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,

      lastX: e.clientX,
      lastY: e.clientY,

      raf: 0,
      scrollRaf: 0,

      dropFolderId: null,
      lastInsertSignature: '',
    };

    moveCardDrag(e);
  }

  function moveCardDrag(e) {
    const d = dashboard.dragging;
    if (!d) return;

    d.lastX = e.clientX;
    d.lastY = e.clientY;

    startDragAutoScroll();

    if (d.raf) return;

    d.raf = requestAnimationFrame(() => {
      const cur = dashboard.dragging;
      if (!cur) return;

      cur.raf = 0;

      const left = cur.lastX - cur.offsetX;
      const top = cur.lastY - cur.offsetY;

      cur.clone.style.setProperty(
        'transform',
        `translate3d(${left - cur.startLeft}px, ${top - cur.startTop}px, 0)`,
        'important'
      );

      updateLiveDragPlacement(cur.lastX, cur.lastY);
    });
  }

  function updateLiveDragPlacement(clientX, clientY) {
    const d = dashboard.dragging;
    if (!d) return;

    clearDragVisuals();
    d.dropFolderId = null;

    if (updateFolderDropTarget(clientX, clientY)) {
      d.lastInsertSignature = 'folder:' + d.dropFolderId;
      return;
    }

    updatePlaceholderPosition(clientX, clientY);
  }

  function updateFolderDropTarget(clientX, clientY) {
    const d = dashboard.dragging;
    if (!d) return false;

    if (d.sourceKind !== 'note') return false;

    const below = document.elementFromPoint(clientX, clientY);
    const folderTarget = below?.closest?.('.yanta-dash-card[data-kind="folder"]');

    if (!folderTarget) return false;
    if (!folderTarget.isConnected) return false;
    if (folderTarget.classList.contains('drag-source')) return false;

    const folderId = folderTarget.dataset.folderId;
    if (!folderId) return false;

    const r = folderTarget.getBoundingClientRect();
    const yRatio = (clientY - r.top) / Math.max(1, r.height);

    /*
      Middle zone = move into folder.
      Top/bottom zones bleiben Reorder-Zonen.
    */
    if (yRatio < 0.28 || yRatio > 0.72) {
      return false;
    }

    folderTarget.classList.add('folder-drop-target');
    d.dropFolderId = folderId;

    return true;
  }

  function updatePlaceholderPosition(clientX, clientY) {
    const d = dashboard.dragging;
    if (!d) return;

    const pointerGrid = document
      .elementFromPoint(clientX, clientY)
      ?.closest?.('.yanta-dashboard-grid');

    if (pointerGrid && pointerGrid !== d.grid) {
      return;
    }

    const target = findBestInsertionTarget(d.grid, clientX, clientY);

    if (!target) {
      const signature = 'append';

      if (d.lastInsertSignature === signature) return;
      d.lastInsertSignature = signature;

      if (d.placeholder.parentNode !== d.grid || d.placeholder.nextSibling) {
        animateGridMutation(d.grid, () => {
          d.grid.append(d.placeholder);
        });
      }

      return;
    }

    const { card, place } = target;
    const signature = `${card.dataset.key || ''}:${place}`;

    card.classList.add(place === 'before' ? 'insert-before' : 'insert-after');

    if (d.lastInsertSignature === signature) return;
    d.lastInsertSignature = signature;

    if (place === 'before') {
      if (d.placeholder.nextSibling === card) return;

      animateGridMutation(d.grid, () => {
        d.grid.insertBefore(d.placeholder, card);
      });

      return;
    }

    const ref = card.nextSibling;

    if (ref === d.placeholder) return;

    animateGridMutation(d.grid, () => {
      d.grid.insertBefore(d.placeholder, ref);
    });
  }

  function findBestInsertionTarget(grid, clientX, clientY) {
    const cards = [...grid.querySelectorAll('.yanta-dash-card[data-key]')]
      .filter((card) => !card.classList.contains('drag-source'))
      .filter((card) => card.offsetParent !== null);

    if (!cards.length) return null;

    const direct = document
      .elementFromPoint(clientX, clientY)
      ?.closest?.('.yanta-dash-card[data-key]');

    if (direct && cards.includes(direct)) {
      const r = direct.getBoundingClientRect();

      return {
        card: direct,
        place: clientY < r.top + r.height / 2 ? 'before' : 'after',
      };
    }

    let best = null;
    let bestScore = Infinity;

    for (const card of cards) {
      const r = card.getBoundingClientRect();

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      const dx = clientX - cx;
      const dy = clientY - cy;

      /*
        Y stärker gewichten, X aber berücksichtigen.
        Das stabilisiert Bento/Masonry-artige Layouts.
      */
      const score = Math.abs(dy) * 1.35 + Math.abs(dx) * 0.75;

      if (score < bestScore) {
        bestScore = score;
        best = {
          card,
          cy,
        };
      }
    }

    if (!best) return null;

    return {
      card: best.card,
      place: clientY < best.cy ? 'before' : 'after',
    };
  }

  function startDragAutoScroll() {
    const d = dashboard.dragging;
    if (!d || d.scrollRaf) return;

    const tick = () => {
      const cur = dashboard.dragging;

      if (!cur || !root) return;

      const r = root.getBoundingClientRect();
      const y = cur.lastY;

      let speed = 0;

      if (y < r.top + DRAG_EDGE_SCROLL_PX) {
        const t = 1 - clamp((y - r.top) / DRAG_EDGE_SCROLL_PX, 0, 1);
        speed = -DRAG_EDGE_SCROLL_MAX * t;
      } else if (y > r.bottom - DRAG_EDGE_SCROLL_PX) {
        const t = 1 - clamp((r.bottom - y) / DRAG_EDGE_SCROLL_PX, 0, 1);
        speed = DRAG_EDGE_SCROLL_MAX * t;
      }

      if (Math.abs(speed) > 0.25) {
        root.scrollBy(0, speed);
        updateLiveDragPlacement(cur.lastX, cur.lastY);
        cur.scrollRaf = requestAnimationFrame(tick);
      } else {
        cur.scrollRaf = 0;
      }
    };

    d.scrollRaf = requestAnimationFrame(tick);
  }

  function stopDragAutoScroll(d = dashboard.dragging) {
    if (!d?.scrollRaf) return;

    cancelAnimationFrame(d.scrollRaf);
    d.scrollRaf = 0;
  }

  async function animateCloneToRect(clone, toRect) {
    if (!clone || !toRect || prefersReducedMotion()) return;

    const from = clone.getBoundingClientRect();

    clone.style.setProperty('transform', 'none', 'important');
    clone.style.left = from.left + 'px';
    clone.style.top = from.top + 'px';
    clone.style.width = from.width + 'px';
    clone.style.height = from.height + 'px';

    const anim = clone.animate(
      [
        {
          left: from.left + 'px',
          top: from.top + 'px',
          width: from.width + 'px',
          height: from.height + 'px',
          opacity: '0.985',
        },
        {
          left: toRect.left + 'px',
          top: toRect.top + 'px',
          width: toRect.width + 'px',
          height: toRect.height + 'px',
          opacity: '0.985',
        },
      ],
      {
        duration: DRAG_DROP_ANIM_MS,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'forwards',
      }
    );

    await anim.finished.catch(() => {});
  }

  async function finishCardDrag() {
    const d = dashboard.dragging;
    if (!d) return;

    if (d.raf) {
      cancelAnimationFrame(d.raf);
      d.raf = 0;
    }

    stopDragAutoScroll(d);
    clearDragVisuals();

    dashboard.dragging = null;
    dashboard.suppressOpenUntil = performance.now() + 850;

    const {
      source,
      clone,
      grid,
      placeholder,
      sourceKind,
      sourceId,
      dropFolderId,
    } = d;

    // Drop note into folder.
    if (sourceKind === 'note' && dropFolderId) {
      placeholder?.remove();

      clone?.remove();

      source.style.display = '';
      source.classList.remove('drag-source');
      source.style.viewTransitionName = '';

      root?.classList.remove('is-card-dragging');

      const note = state.notes.get(sourceId);

      if (note && note.folderId !== dropFolderId) {
        note.folderId = dropFolderId;
        note.pinned = false;
        note.updated = Date.now();

        await store.notes.put(note);
        previewCache.delete(sourceId);

        toast('Moved into folder', 'success');
      }

      renderDashboard();
      return;
    }

    /*
      Source an Placeholder-Position setzen, aber noch unsichtbar lassen.
      So messen wir die finale Position korrekt, ohne visuellen Doppel-Effekt.
    */
    grid.insertBefore(source, placeholder);
    source.style.display = '';

    const finalRect = source.getBoundingClientRect();

    placeholder?.remove();

    await animateCloneToRect(clone, finalRect);

    clone?.remove();

    source.classList.remove('drag-source');
    source.style.viewTransitionName = '';

    root?.classList.remove('is-card-dragging');

    await persistGridOrder(grid, grid.dataset.section || d.section);
  }

  async function cancelCardDrag() {
    const d = dashboard.dragging;
    if (!d) return;

    if (d.raf) {
      cancelAnimationFrame(d.raf);
      d.raf = 0;
    }

    stopDragAutoScroll(d);
    clearDragVisuals();

    dashboard.dragging = null;
    dashboard.suppressOpenUntil = performance.now() + 700;

    d.placeholder?.remove();

    d.source.style.display = '';

    const sourceRect = d.source.getBoundingClientRect();

    await animateCloneToRect(d.clone, sourceRect);

    d.clone?.remove();

    d.source.classList.remove('drag-source');
    d.source.style.viewTransitionName = '';

    root?.classList.remove('is-card-dragging');
  }

  async function persistGridOrder(grid, section) {
    const cards = [...grid.querySelectorAll('.yanta-dash-card[data-key]')];

    let order = DASH_ORDER_STEP;

    for (const card of cards) {
      const { kind, id } = parseItemKey(card.dataset.key);

      if (kind === 'note') {
        const note = state.notes.get(id);
        if (!note) continue;

        if (section === 'pinned') {
          note.dashboardPinnedOrder = order;
        } else {
          note.dashboardOrder = order;
        }

        await store.notes.put(note);
      } else if (kind === 'folder') {
        const folder = state.folders.get(id);
        if (!folder) continue;

        folder.dashboardOrder = order;
        await store.folders.put(folder);
      }

      order += DASH_ORDER_STEP;
    }
  }
  
  function bindResizeHandle(handle, key) {
    const reset = async () => {
      dashboard.suppressOpenUntil = performance.now() + 700;
      await setItemHeightPx(key, null);
      dashboard.selectedKey = null;
      renderDashboard();
    };

    handle.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await reset();
    });

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const card = handle.closest('.yanta-dash-card');
      if (!card) return;

      const rect = card.getBoundingClientRect();

      dashboard.resize = {
        key,
        card,
        pointerId: e.pointerId,
        startY: e.clientY,
        startHeight: rect.height,
        nextHeight: rect.height,
        active: false,
      };

      try {
        handle.setPointerCapture?.(e.pointerId);
      } catch {}

      document.addEventListener('pointermove', onDocumentResizeMove, true);
      document.addEventListener('pointerup', onDocumentResizeUp, true);
      document.addEventListener('pointercancel', onDocumentResizeCancel, true);
    }, { passive: false });

    function cleanupResizeListeners() {
      document.removeEventListener('pointermove', onDocumentResizeMove, true);
      document.removeEventListener('pointerup', onDocumentResizeUp, true);
      document.removeEventListener('pointercancel', onDocumentResizeCancel, true);
    }

    function onDocumentResizeMove(e) {
      const r = dashboard.resize;
      if (!r || r.key !== key) return;
      if (r.pointerId != null && e.pointerId !== r.pointerId) return;

      const dy = e.clientY - r.startY;

      if (Math.abs(dy) > MOVE_TOLERANCE) {
        r.active = true;
      }

      if (!r.active) return;

      e.preventDefault();
      e.stopPropagation();

      const maxHeight = maxResizeHeightForCard(r.card, key);

      const nextHeight = Math.max(
        MIN_CARD_HEIGHT,
        Math.min(maxHeight, r.startHeight + dy)
      );

      r.nextHeight = nextHeight;

      r.card.style.setProperty('--dash-row-span', String(heightToGridSpan(nextHeight)));
      r.card.dataset.effectiveHeight = String(Math.round(nextHeight));
      r.card.classList.add('resizing');

      dashboard.suppressOpenUntil = performance.now() + 700;
    }

    async function onDocumentResizeUp(e) {
      const r = dashboard.resize;
      if (!r || r.key !== key) return;
      if (r.pointerId != null && e.pointerId !== r.pointerId) return;

      e.preventDefault();
      e.stopPropagation();

      cleanupResizeListeners();

      try {
        handle.releasePointerCapture?.(e.pointerId);
      } catch {}

      dashboard.suppressOpenUntil = performance.now() + 900;

      if (r.active) {
        await setItemHeightPx(key, r.nextHeight);
        dashboard.selectedKey = key;

        // Kein komplettes renderDashboard() hier:
        // Das verhindert das sichtbare Flackern nach Resize.
        r.card.classList.add('selected');
      } else {
        // Wenn nur geklickt wurde: Karte selektiert lassen.
        dashboard.selectedKey = key;
        r.card.classList.add('selected');
      }

      r.card?.classList.remove('resizing');
      dashboard.resize = null;
    }

    function onDocumentResizeCancel(e) {
      const r = dashboard.resize;
      if (!r || r.key !== key) return;

      cleanupResizeListeners();

      try {
        handle.releasePointerCapture?.(e.pointerId);
      } catch {}

      // Visuelle Änderung zurücksetzen, falls Resize abgebrochen wurde.
      r.card.style.setProperty('--dash-row-span', String(heightToGridSpan(r.startHeight)));
      r.card.dataset.effectiveHeight = String(Math.round(r.startHeight));
      r.card?.classList.remove('resizing');

      dashboard.resize = null;
      dashboard.suppressOpenUntil = performance.now() + 700;
    }
  }
  
  async function setItemHeightPx(key, heightPx) {
    const { kind, id } = parseItemKey(key);
  
    const clean =
      heightPx == null
        ? null
        : Math.max(
            MIN_CARD_HEIGHT,
            Math.min(MAX_CARD_HEIGHT, Math.round(heightPx))
          );
  
        if (kind === 'note') {
          const note = state.notes.get(id);
          if (!note) return;

          if (clean == null) {
            delete note.dashboardHeightPx;
            delete note.dashboardHeight;
          } else {
            note.dashboardHeightPx = clean;
            delete note.dashboardHeight;
          }

          note.updated = Date.now();

          await store.notes.put(note);
        }
  
    if (kind === 'folder') {
      const folder = state.folders.get(id);
      if (!folder) return;

      if (clean == null) {
        delete folder.dashboardHeightPx;
        delete folder.dashboardHeight;
      } else {
        folder.dashboardHeightPx = clean;
        delete folder.dashboardHeight;
      }

      folder.updated = Date.now();

      await store.folders.put(folder);
    }
  }