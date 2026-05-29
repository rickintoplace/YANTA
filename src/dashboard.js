// ============================================================
// YANTA — Dashboard
// Mobile-first Bento dashboard inspired by Google Keep.
// Parallel to the sidebar tree.
// ============================================================

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
  
  const MOBILE_MQ = window.matchMedia('(max-width: 880px)');
  
  const DASH_ORDER_STEP = 1000;
  
  const LONG_PRESS_MS = 430;
  const HANDLE_LONG_PRESS_MS = 460;
  const MOVE_TOLERANCE = 8;

  const GRID_ROW_PX = 8;
  const GRID_GAP_PX = 10;
  
  const DEFAULT_NOTE_HEIGHT = 150;
  const DEFAULT_FOLDER_HEIGHT = 150;
  const MIN_CARD_HEIGHT = 76;
  const MAX_CARD_HEIGHT = 620;
  
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
  };
  
  const previewCache = new Map();
  // noteId -> { updated, textLen, preview }
  
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
  
    const pinnedNotes = [...state.notes.values()]
      .filter((n) => n.pinned)
      .sort(sortPinnedNotes)
      .map((note) => ({
        kind: 'note',
        id: note.id,
        note,
        pinned: true,
      }));
  
    const folders = [...state.folders.values()]
      .filter((f) => (f.parentId || null) === folderId)
      .map((folder) => ({
        kind: 'folder',
        id: folder.id,
        folder,
        pinned: false,
      }));
  
    const notes = [...state.notes.values()]
      .filter((n) => !n.pinned)
      .filter((n) => (n.folderId || null) === folderId)
      .map((note) => ({
        kind: 'note',
        id: note.id,
        note,
        pinned: false,
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
  
  export function isDashboardVisible() {
    return dashboard.visible;
  }
  
  export function setupDashboard() {
    if (initialized) return;
    initialized = true;
  
    ensureDashboardRoot();
    setupPreviewObserver();
  
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
  
      hideDashboard({ push: false });
    });
  
    window.addEventListener('keydown', (e) => {
      if (!dashboard.visible) return;
  
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
  
    const app = $('app');
    if (app) app.dataset.surface = 'dashboard';
  
    root.hidden = false;
    
    renderDashboard();
  
    if (replace) {
      history.replaceState(
        { surface: 'dashboard', folderId: dashboard.folderId },
        '',
        '#dashboard'
      );
    } else if (push) {
      history.pushState(
        { surface: 'dashboard', folderId: dashboard.folderId },
        '',
        '#dashboard'
      );
    }
  }
  
  export function hideDashboard({ push = false } = {}) {
    if (!root) return;
  
    dashboard.visible = false;
    dashboard.selectedKey = null;
    dashboard.dragging = null;
    dashboard.resize = null;
  
    const app = $('app');
    if (app) app.dataset.surface = 'note';
  
    root.hidden = true;
  
    if (push && state.currentNoteId) {
      history.pushState(
        { noteId: state.currentNoteId, surface: 'note' },
        '',
        '#' + encodeURIComponent(state.currentNoteId)
      );
    }
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
  
    if (source) {
      source.style.viewTransitionName = transitionName;
      source.style.contain = 'layout paint';
    }
  
    const vt = document.startViewTransition(() => {
      showDashboard({ folderId, replace: false, push: false });
  
      const card = root?.querySelector(
        `.yanta-dash-card[data-note-id="${CSS.escape(noteId)}"]`
      );
  
      if (card) {
        card.style.viewTransitionName = transitionName;
      }
    });
  
    await vt.finished.catch(() => {});
  
    if (source) {
      source.style.viewTransitionName = '';
      source.style.contain = '';
    }
  
    const card = root?.querySelector(
      `.yanta-dash-card[data-note-id="${CSS.escape(noteId)}"]`
    );
  
    if (card) {
      card.style.viewTransitionName = transitionNameFor('note', noteId);
    }
  
    if (replace) {
      history.replaceState(
        { surface: 'dashboard', folderId: dashboard.folderId },
        '',
        '#dashboard'
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
  
    root.append(renderDashboardHeader());
  
    const { pinnedNotes, normalItems } = getDashboardItems();
  
    const body = el('div', { class: 'yanta-dashboard-body' });
  
    if (pinnedNotes.length) {
      body.append(sectionTitle('Pinned'));
      body.append(renderGrid(pinnedNotes, { section: 'pinned' }));
    }
  
    body.append(sectionTitle(dashboard.folderId ? 'Folder' : 'Home'));
  
    if (!normalItems.length && !pinnedNotes.length) {
      body.append(renderEmptyState());
    } else if (!normalItems.length) {
      body.append(renderEmptyFolderState());
    } else {
      body.append(renderGrid(normalItems, { section: 'normal' }));
    }
  
    root.append(body);
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
    }, dashboard.folderId ? (path.at(-1)?.name || 'Folder') : 'Dashboard');
  
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
  
  function sectionTitle(text) {
    return el('div', { class: 'yanta-dashboard-section-title' }, text);
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
    style: {
    '--dash-row-span': String(rowSpan),
    ...(color ? { '--card-color': color } : {}),
    viewTransitionName: transitionNameFor(item.kind, item.id),
    },
    });
  
    card.tabIndex = 0;
  
    if (item.kind === 'folder') {
        card.append(renderCardHeader(item));
        card.append(renderFolderBody(item.folder));
      } else {
        card.append(renderNoteCorner(item.note));
      
        const previewHost = el('div', {
          class:
            'yanta-dash-preview' +
            ((noteHasCustomIcon(item.note) || item.note.pinned) ? ' has-corner' : ''),
          dataset: { previewHost: '1' },
        });
      
        previewHost.innerHTML = `<div class="yanta-dash-preview-skeleton"></div>`;
        card.append(previewHost);
        previewObserver?.observe(card);
    }
  
    card.append(renderCardActions(item));
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
      const colorBtn = iconActionButton({
        icon: 'palette',
        title: 'Icon & color',
        onClick: () => editDashboardFolderAppearance(item.folder),
      });
  
      actions.append(colorBtn);
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
    const btn = el('button', {
      type: 'button',
      class: 'yanta-dash-action-btn' + (danger ? ' danger' : ''),
      title,
      'aria-label': title,
      onclick: async (e) => {
        e.preventDefault();
        e.stopPropagation();
  
        dashboard.suppressOpenUntil = performance.now() + 700;
  
        try {
          await onClick?.();
        } catch (err) {
          console.error(err);
          toast('Action failed', 'error');
        }
      },
      onpointerdown: (e) => {
        e.preventDefault();
        e.stopPropagation();
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

  function renderCardHeader(item) {
    const head = el('div', { class: 'yanta-dash-card-head' });
  
    const icon = el('span', { class: 'yanta-dash-card-icon' });
    icon.innerHTML = lucide(itemIcon(item), 18);
  
    const title = el('div', { class: 'yanta-dash-card-title' }, itemTitle(item));
  
    head.append(icon, title);
  
    if (item.kind === 'note' && item.note.pinned) {
      const pin = el('span', {
        class: 'yanta-dash-pin',
        title: 'Pinned',
      });
      pin.innerHTML = lucide('pin', 14);
      head.append(pin);
    }
  
    if (item.kind === 'folder') {
      const count = folderDirectCount(item.id);
      const badge = el('span', { class: 'yanta-dash-count' }, String(count));
      head.append(badge);
    }
  
    return head;
  }
  
  function renderFolderBody(folder) {
    const body = el('div', { class: 'yanta-dash-folder-body' });
  
    const childFolders = [...state.folders.values()]
      .filter((f) => f.parentId === folder.id).length;
  
    const childNotes = [...state.notes.values()]
      .filter((n) => n.folderId === folder.id).length;
  
    body.innerHTML = `
      <div class="yanta-dash-folder-big-icon">${lucide(defaultIconForFolder(folder), 36)}</div>
      <div class="yanta-dash-folder-meta">
        ${childFolders} folder${childFolders === 1 ? '' : 's'} · ${childNotes} note${childNotes === 1 ? '' : 's'}
      </div>
    `;
  
    return body;
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
  
    if (!card.isConnected) return;
  
    // Auto-size unless user manually resized.
    if (note.dashboardHeightPx == null && note.dashboardHeight == null) {
      const autoH = autoHeightForPreview(preview);
      card.style.setProperty('--dash-row-span', String(heightToGridSpan(autoH)));
      card.dataset.effectiveHeight = String(autoH);
    } else {
      const h = itemDashboardHeightPx({ kind: 'note', note, id: note.id });
      card.style.setProperty('--dash-row-span', String(heightToGridSpan(h)));
      card.dataset.effectiveHeight = String(h);
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
    const wrap = el('div', { class: 'yanta-dash-media yanta-dash-video' });
  
    const iframe = el('iframe', {
      src: block.embed,
      allow: 'autoplay; encrypted-media; picture-in-picture',
      allowfullscreen: true,
      frameborder: '0',
      loading: 'lazy',
    });
  
    wrap.append(iframe);
  
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
  
    for (let i = 0; i < lines.length; i++) {
      if (blocks.length >= 8) break;
  
      const raw = lines[i] || '';
      const line = raw.trim();
  
      if (/^```/.test(line)) {
        inFence = !inFence;
        continue;
      }
  
      if (inFence || !line) continue;
  
      if (/\[\^([^\]\s]+)\]/.test(raw)) {
        hasCitation = true;
      }

      if (/\[\[[^\]]+\]\]/.test(raw)) {
        hasLinks = true;
      }
  
      const drawing = /^\s*draw:\/\/([a-z0-9_-]+)\s*$/i.exec(raw);
      if (drawing) {
        blocks.push({
          type: 'drawing',
          id: drawing[1],
        });
        continue;
      }
  
      const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\{[^}\n]*\})?\s*$/.exec(raw);

      if (image) {
        const embed = videoEmbedUrl(image[2]);
  
        if (embed) {
          blocks.push({
            type: 'video',
            embed,
          });
        } else {
          blocks.push({
            type: 'image',
            alt: cleanInlineText(image[1]),
            url: image[2],
          });
        }
  
        continue;
      }
  
      const task = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/.exec(raw);
      if (task) {
        blocks.push({
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
          blocks.push({
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
          blocks.push({
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
          blocks.push({
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
          blocks.push({
            type: 'list',
            text: text.slice(0, 140),
          });
        }
  
        continue;
      }
  
      if (/^\|.*\|$/.test(line)) continue;
      if (/^\[\^[^\]]+\]:/.test(line)) continue;
  
      const text = cleanInlineText(line);
  
      if (text) {
        blocks.push({
          type: 'text',
          text: text.slice(0, 220),
        });
      }
    }
  
    if (hasLinks) badges.push({ icon: 'link', label: 'Links' });
    if (hasCitation) badges.push({ icon: 'quote', label: 'Citation' });
  
    return {
      blocks,
      badges,
    };
  }
  
  function videoEmbedUrl(url) {
    const s = String(url || '');
  
    let m;
  
    if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(s))) {
      return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    }
  
    if ((m = /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
      return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    }
  
    if ((m = /vimeo\.com\/(\d+)/.exec(s))) {
      return `https://player.vimeo.com/video/${m[1]}`;
    }
  
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
  
  function navigateDashboardFolder(folderId) {
    dashboard.folderId = folderId || null;
    dashboard.selectedKey = null;
  
    history.pushState(
      { surface: 'dashboard', folderId: dashboard.folderId },
      '',
      '#dashboard'
    );
  
    renderDashboard();
  
    root?.scrollTo?.({
      top: 0,
      behavior: 'smooth',
    });
  }
  
  async function openItem(item, card) {
    if (performance.now() < (dashboard.suppressOpenUntil || 0)) return;
    if (dashboard.dragging || dashboard.resize) return;
  
    if (item.kind === 'folder') {
      navigateDashboardFolder(item.id);
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
  
        const vt = document.startViewTransition(async () => {
          hideDashboard({ push: false });
  
          await openNote(noteId);
  
          const target = $('panes');
  
          if (target) {
            target.style.viewTransitionName = transitionName;
            target.style.contain = 'layout paint';
          }
        });
  
        await vt.finished.catch(() => {});
  
        const target = $('panes');
  
        if (target) {
          target.style.viewTransitionName = '';
          target.style.contain = '';
        }
  
        card.style.viewTransitionName = transitionNameFor('note', noteId);
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
    let downX = 0;
    let downY = 0;
    let moved = false;
    let longPressed = false;
    let draggingStarted = false;
    let pointerId = null;
  
    const key = itemKey(item);
  
    const clearPress = () => {
      clearTimeout(pressTimer);
      pressTimer = 0;
    };
  
    const selectInPlace = () => {
      dashboard.selectedKey = key;
  
      root
        ?.querySelectorAll('.yanta-dash-card.selected')
        ?.forEach((n) => {
          if (n !== card) n.classList.remove('selected');
        });
  
      card.classList.add('selected');
      navigator.vibrate?.(12);
    };
  
    card.addEventListener('contextmenu', (e) => {
      // Prevent browser / emulated mobile long-press context menu.
      e.preventDefault();
      e.stopPropagation();
    });
  
    card.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest?.('input, button, a, .yanta-dash-resize-handle')) return;
  
      pointerId = e.pointerId;
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
      longPressed = false;
      draggingStarted = false;
  
      clearPress();
  
      pressTimer = setTimeout(() => {
        longPressed = true;
        selectInPlace();
      }, LONG_PRESS_MS);
  
      try {
        card.setPointerCapture?.(e.pointerId);
      } catch {}
    }, { passive: true });
  
    card.addEventListener('pointermove', (e) => {
      if (pointerId == null || e.pointerId !== pointerId) return;
  
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
  
      if (dist > MOVE_TOLERANCE) {
        moved = true;
  
        // User is scrolling before long-press: cancel gesture.
        if (!longPressed) {
          clearPress();
          return;
        }
  
        // Long-pressed and now moving: start reorder drag.
        if (!draggingStarted) {
          draggingStarted = true;
          startCardDrag(card, item, e);
        }
      }
    }, { passive: false });
  
    card.addEventListener('pointerup', async (e) => {
      if (pointerId != null && e.pointerId !== pointerId) return;
  
      clearPress();
  
      const wasDragging = dashboard.dragging?.key === key;
  
      if (wasDragging) {
        e.preventDefault();
        pointerId = null;
        return;
      }
  
      // Long press without movement: keep resize handle visible.
      if (longPressed && !draggingStarted) {
        e.preventDefault();
        selectInPlace();
        pointerId = null;
        return;
      }
  
      // Normal tap.
      if (!moved && !longPressed) {
        e.preventDefault();
        await openItem(item, card);
      }
  
      pointerId = null;
    });
  
    card.addEventListener('pointercancel', () => {
      clearPress();
      cancelCardDrag();
      pointerId = null;
    });
  
    card.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await openItem(item, card);
      }
  
      if (e.key === 'Escape') {
        dashboard.selectedKey = null;
        renderDashboard();
      }
    });
  }

  function startCardDrag(card, item, e) {
    if (dashboard.dragging) return;
  
    const key = itemKey(item);
    const rect = card.getBoundingClientRect();
  
    try {
      card.releasePointerCapture?.(e.pointerId);
    } catch {}
  
    const clone = card.cloneNode(true);
    clone.classList.add('drag-clone');
    clone.style.position = 'fixed';
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    clone.style.zIndex = '260';
    clone.style.pointerEvents = 'none';
    clone.style.margin = '0';
    clone.style.willChange = 'transform,left,top';
  
    document.body.append(clone);
  
    card.classList.add('drag-source');
    card.style.visibility = 'hidden';
  
    dashboard.suppressOpenUntil = performance.now() + 900;
  
dashboard.dragging = {
  key,
  section: card.dataset.section,
  source: card,
  clone,
  startX: e.clientX,
  startY: e.clientY,
  offsetX: e.clientX - rect.left,
  offsetY: e.clientY - rect.top,
  lastX: e.clientX,
  lastY: e.clientY,
  pointerId: e.pointerId,

  sourceKind: item.kind,
  sourceId: item.id,
  dropFolderId: null,
  lastPlacement: '',
};
  
    document.addEventListener('pointermove', onDocumentCardDragMove, true);
    document.addEventListener('pointerup', onDocumentCardDragUp, true);
    document.addEventListener('pointercancel', onDocumentCardDragCancel, true);
  
    navigator.vibrate?.(18);
  }

  function onDocumentCardDragMove(e) {
    if (!dashboard.dragging) return;
  
    e.preventDefault();
    e.stopPropagation();
  
    moveCardDrag(e);
  }
  
  async function onDocumentCardDragUp(e) {
    if (!dashboard.dragging) return;
  
    e.preventDefault();
    e.stopPropagation();
  
    cleanupDocumentDragListeners();
  
    await finishCardDrag();
  
    dashboard.suppressOpenUntil = performance.now() + 700;
  }
  
  function onDocumentCardDragCancel(e) {
    if (!dashboard.dragging) return;
  
    e.preventDefault();
    e.stopPropagation();
  
    cleanupDocumentDragListeners();
    cancelCardDrag();
  
    dashboard.suppressOpenUntil = performance.now() + 700;
  }
  

  function clearFolderDropTargets() {
    root
      ?.querySelectorAll('.yanta-dash-card.folder-drop-target')
      ?.forEach((n) => n.classList.remove('folder-drop-target'));
  }
  
  function clearInsertTargets() {
    root
      ?.querySelectorAll('.yanta-dash-card.insert-before, .yanta-dash-card.insert-after')
      ?.forEach((n) => {
        n.classList.remove('insert-before');
        n.classList.remove('insert-after');
      });
  }

  function cleanupDocumentDragListeners() {
    document.removeEventListener('pointermove', onDocumentCardDragMove, true);
    document.removeEventListener('pointerup', onDocumentCardDragUp, true);
    document.removeEventListener('pointercancel', onDocumentCardDragCancel, true);
  }

  function animateGridReorder(grid, mutate) {
    if (!grid) {
      mutate?.();
      return;
    }
  
    const cards = [...grid.querySelectorAll('.yanta-dash-card')]
      .filter((card) => !card.classList.contains('drag-source'));
  
    const first = new Map();
  
    for (const card of cards) {
      first.set(card, card.getBoundingClientRect());
    }
  
    mutate?.();
  
    for (const card of cards) {
      if (!card.isConnected) continue;
  
      const a = first.get(card);
      const b = card.getBoundingClientRect();
  
      if (!a || !b) continue;
  
      const dx = a.left - b.left;
      const dy = a.top - b.top;
  
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
  
      card.animate(
        [
          {
            transform: `translate(${dx}px, ${dy}px)`,
          },
          {
            transform: 'translate(0, 0)',
          },
        ],
        {
          duration: 180,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        }
      );
    }
  }
  
  function moveCardDrag(e) {
    const d = dashboard.dragging;
    if (!d) return;
  
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  
    d.clone.style.left = (e.clientX - d.offsetX) + 'px';
    d.clone.style.top = (e.clientY - d.offsetY) + 'px';
  
    const below = document.elementFromPoint(e.clientX, e.clientY);
    const target = below?.closest?.('.yanta-dash-card');
  
    clearFolderDropTargets();
    clearInsertTargets();
  
    d.dropFolderId = null;
    d.insertMode = null;
  
    if (!target || !target.dataset.key) return;
    if (target === d.source) return;
  
    const targetRect = target.getBoundingClientRect();
  
    // Folder cards are dual-purpose:
    // - top 25%    => insert before folder
    // - bottom 25% => insert after folder
    // - middle 50% => drop into folder
    if (
      d.sourceKind === 'note' &&
      target.dataset.kind === 'folder' &&
      target.dataset.folderId
    ) {
      const yRatio = (e.clientY - targetRect.top) / Math.max(1, targetRect.height);
  
      if (yRatio < 0.25 || yRatio > 0.75) {
        // Reorder before/after folder.
        if (target.dataset.section !== d.section) return;
  
        const grid = target.closest('.yanta-dashboard-grid');
        if (!grid) return;
  
        const before = yRatio < 0.25;
        const placement = `${target.dataset.key}:${before ? 'before' : 'after'}`;
  
        target.classList.add(before ? 'insert-before' : 'insert-after');
  
        if (d.lastPlacement === placement) return;
        d.lastPlacement = placement;
  
        animateGridReorder(grid, () => {
          if (before) {
            grid.insertBefore(d.source, target);
          } else {
            grid.insertBefore(d.source, target.nextSibling);
          }
        });
  
        return;
      }
  
      // Middle zone: drop into folder.
      d.dropFolderId = target.dataset.folderId;
      target.classList.add('folder-drop-target');
      d.lastPlacement = `folder:${d.dropFolderId}`;
      return;
    }
  
    // Normal reorder.
    if (target.dataset.section !== d.section) return;
  
    const grid = target.closest('.yanta-dashboard-grid');
    if (!grid) return;
  
    const before =
      e.clientY < targetRect.top + targetRect.height / 2 ||
      (
        Math.abs(e.clientY - (targetRect.top + targetRect.height / 2)) < 24 &&
        e.clientX < targetRect.left + targetRect.width / 2
      );
  
    const placement = `${target.dataset.key}:${before ? 'before' : 'after'}`;
  
    target.classList.add(before ? 'insert-before' : 'insert-after');
  
    if (d.lastPlacement === placement) return;
    d.lastPlacement = placement;
  
    animateGridReorder(grid, () => {
      if (before) {
        grid.insertBefore(d.source, target);
      } else {
        grid.insertBefore(d.source, target.nextSibling);
      }
    });
  }
  
  async function finishCardDrag() {
    const d = dashboard.dragging;
    if (!d) return;
  
    cleanupDocumentDragListeners();
    clearFolderDropTargets();
    clearInsertTargets();

    const section = d.section;
    const grid = root.querySelector(`.yanta-dashboard-grid[data-section="${section}"]`);
  
    d.source.classList.remove('drag-source');
    d.source.style.visibility = '';
    d.clone?.remove();
  
    const dropFolderId = d.dropFolderId;
    const sourceKind = d.sourceKind;
    const sourceId = d.sourceId;
  
    dashboard.dragging = null;
    dashboard.suppressOpenUntil = performance.now() + 800;
  
    // Move note into folder.
    if (sourceKind === 'note' && dropFolderId) {
      const note = state.notes.get(sourceId);
  
      if (note && note.folderId !== dropFolderId) {
        note.folderId = dropFolderId;
        note.pinned = false;
        note.updated = Date.now();
  
        await store.notes.put(note);
  
        previewCache.delete(sourceId);
  
        window.dispatchEvent(new CustomEvent('yanta-note-updated', {
          detail: { noteId: sourceId },
        }));
  
        toast('Moved into folder', 'success');
      }
  
      renderDashboard();
      return;
    }
  
    // Otherwise persist reorder.
    if (grid) {
      await persistGridOrder(grid, section);
    }
  
    renderDashboard();
  }
  
  function cancelCardDrag() {
    const d = dashboard.dragging;
    if (!d) return;
  
    cleanupDocumentDragListeners();
    clearFolderDropTargets();
    clearInsertTargets();

    d.source?.classList.remove('drag-source');
  
    if (d.source) {
      d.source.style.visibility = '';
    }
  
    d.clone?.remove();
  
    dashboard.dragging = null;
    dashboard.suppressOpenUntil = performance.now() + 700;
  
    renderDashboard();
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
  
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));
  }
  
  function bindResizeHandle(handle, key) {
    let timer = 0;
  
    const clear = () => {
      clearTimeout(timer);
      timer = 0;
    };
  
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
  
      timer = setTimeout(async () => {
        clear();
        dashboard.resize = null;
        await reset();
      }, HANDLE_LONG_PRESS_MS);
  
      document.addEventListener('pointermove', onDocumentResizeMove, true);
      document.addEventListener('pointerup', onDocumentResizeUp, true);
      document.addEventListener('pointercancel', onDocumentResizeCancel, true);
    });
  
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
        clear();
        r.active = true;
      }
  
      if (!r.active) return;
  
      e.preventDefault();
      e.stopPropagation();
  
      const nextHeight = Math.max(
        MIN_CARD_HEIGHT,
        Math.min(MAX_CARD_HEIGHT, r.startHeight + dy)
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
  
      clear();
      cleanupResizeListeners();
  
      dashboard.suppressOpenUntil = performance.now() + 900;
  
      if (r.active) {
        await setItemHeightPx(key, r.nextHeight);
        dashboard.selectedKey = key;
      }
  
      r.card?.classList.remove('resizing');
  
      dashboard.resize = null;
  
      renderDashboard();
    }
  
    function onDocumentResizeCancel(e) {
      const r = dashboard.resize;
      if (!r || r.key !== key) return;
  
      clear();
      cleanupResizeListeners();
  
      r.card?.classList.remove('resizing');
  
      dashboard.resize = null;
      dashboard.suppressOpenUntil = performance.now() + 700;
  
      renderDashboard();
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
  
      await store.folders.put(folder);
    }
  }