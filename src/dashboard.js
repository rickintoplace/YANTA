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
import { renderDashboardWidgetsInto } from './dashboard-widgets.js';

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

import {
  shouldHideFromDashboard,
} from './ai/brain.js';

import {
  openCreateMenu,
} from './create-actions.js';

import {
  yantaConfirm,
} from './dialogs.js';

import {
  isNoteInTrash,
  isFolderInTrash,
  moveNoteToTrash,
  moveFolderToTrash,
  moveItemsToTrash,
} from './trash.js';

import {
  showTrashDropTarget,
  hideTrashDropTarget,
  isPointOverTrashDropTarget,
  setTrashDropTargetHot,
} from './trash-drop-target.js';

import {
  publicShareStateForNote,
  isPublicShareActive,
} from './public-share/public-share-publisher.js';

import {
  createDashboardCrumpleController,
} from './dashboard-crumple.js';

import {
  getDashboardSelectedKeys,
} from './dashboard-multiselect.js';

import { videoEmbedUrl, videoThumbnailUrl } from './media/video-embeds.js';
import { getImageObjectUrl, putImageObjectUrl } from './media/object-url-cache.js';
import { EVT, emit, shouldIgnoreInvisibleSyncEvent } from './events.js';

  const MOBILE_MQ = window.matchMedia('(max-width: 880px)');
  
  const DASH_ORDER_STEP = 1000;
  
  const LONG_PRESS_MS = 300;
  const HANDLE_LONG_PRESS_MS = 360;
  const MOVE_TOLERANCE = 8;

  const DRAG_EDGE_SCROLL_PX = 76;
  const DRAG_EDGE_SCROLL_MAX = 18;
  const DRAG_DROP_ANIM_MS = 145;
  const DRAG_FOLDER_INSERT_PREVIEW_SCALE = 0.56;
  const DRAG_TRASH_PREVIEW_SCALE = 0.90;

  const DRAG_REORDER_COOLDOWN_MS = 120;
  const DRAG_REORDER_MIN_MOVE_PX = 22;
  const DRAG_REORDER_CANDIDATE_STABLE_MS = 130;
  const DRAG_REORDER_CENTER_DEADZONE_PX = 18;

  const DRAG_REORDER_LOCK_MS = 190;
  const DRAG_REORDER_LOCK_MARGIN_PX = 24;
  const DRAG_SPATIAL_ROW_TOLERANCE_PX = 28;

  const GRID_ROW_PX = 8;
  const GRID_GAP_PX = 10;

  const DEFAULT_NOTE_HEIGHT = 150;
  const DEFAULT_FOLDER_HEIGHT = 150;
  const MIN_CARD_HEIGHT = 76;
  const MAX_CARD_HEIGHT = 620;
  const DASHBOARD_PREVIEW_MAX_BLOCKS = 20;

  /*
    draw.js erzeugt Dashboard-Thumbnails effektiv als 360×220 SVG.
    Diese Ratio reservieren wir sofort, damit die Card-Höhe nach Reload
    nicht erst klein misst und später beim Thumbnail-Load springt.
  */
  const DASHBOARD_DRAWING_THUMB_W = 360;
  const DASHBOARD_DRAWING_THUMB_H = 220;

  const DASHBOARD_EMPTY_PENDING_MS = 12_000;

/*
    So viele Note-Cards werden nach einem Full-Render sofort hydriert,
    ohne auf den IntersectionObserver zu warten. Deckt den sichtbaren
    Viewport ab und macht das LCP-Bild so früh wie möglich anforderbar.
  */
  const EAGER_PREVIEW_COUNT = 6;

  function injectDashboardPreviewLoadingCss() {
    if (document.getElementById('yanta-dashboard-preview-loading-css')) return;

    const style = document.createElement('style');
    style.id = 'yanta-dashboard-preview-loading-css';
    style.textContent = `
.yanta-dash-preview-loading {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 0;
  opacity: 1;
  animation: yantaDashPreviewLoadingIn 160ms ease both;
}

.yanta-dash-preview-loading.media {
  min-height: 112px;
}

.yanta-dash-preview-loading.event {
  min-height: 70px;
}

.yanta-dash-skeleton-line,
.yanta-dash-skeleton-media,
.yanta-dash-skeleton-event {
  position: relative;
  overflow: hidden;
  border-radius: 999px;
  background:
    color-mix(
      in srgb,
      var(--card-color, var(--note-color, var(--accent))) 18%,
      var(--bg-elev-2)
    );
}

.yanta-dash-skeleton-line {
  height: 10px;
}

.yanta-dash-skeleton-line.long {
  width: 88%;
}

.yanta-dash-skeleton-line.mid {
  width: 72%;
}

.yanta-dash-skeleton-line.short {
  width: 42%;
}

.yanta-dash-skeleton-media {
  height: 104px;
  border-radius: 12px;
}

.yanta-dash-skeleton-event {
  height: 54px;
  border-radius: 12px;
}

.yanta-dash-skeleton-line::after,
.yanta-dash-skeleton-media::after,
.yanta-dash-skeleton-event::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-120%);
  background:
    linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, white 18%, transparent),
      transparent
    );
  animation: yantaDashSkeletonSweep 1.7s ease-in-out infinite;
}

.yanta-dash-folder-mini-loading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 2px;
}

.yanta-dash-folder-mini-loading span {
  height: 5px;
  border-radius: 999px;
  background:
    color-mix(
      in srgb,
      var(--mini-color, var(--accent)) 18%,
      var(--bg-elev-2)
    );
  opacity: 0.92;
}

.yanta-dash-folder-mini-loading span:nth-child(1) {
  width: 84%;
}

.yanta-dash-folder-mini-loading span:nth-child(2) {
  width: 66%;
}

.yanta-dash-folder-mini-loading span:nth-child(3) {
  width: 42%;
}

@keyframes yantaDashSkeletonSweep {
  0% {
    transform: translateX(-120%);
  }

  55% {
    transform: translateX(120%);
  }

  100% {
    transform: translateX(120%);
  }
}

@keyframes yantaDashPreviewLoadingIn {
  from {
    opacity: 0;
    transform: translateY(2px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .yanta-dash-skeleton-line::after,
  .yanta-dash-skeleton-media::after,
  .yanta-dash-skeleton-event::after,
  .yanta-dash-preview-loading {
    animation: none !important;
  }
}
`;
    document.head.append(style);
  }

  function dashboardNoteLooksTemporarilyEmpty(note, {
    preview = null,
    eventHeader = null,
  } = {}) {
    if (!note) return false;
    if (eventHeader) return false;
    if (preview?.blocks?.length || preview?.badges?.length) return false;

    const status = state.noteSyncStatus.get(note.id);
    const fresh =
      Date.now() - Number(note.updated || note.created || 0) < DASHBOARD_EMPTY_PENDING_MS;

    return (
      fresh ||
      status === 'remote' ||
      status === 'syncing' ||
      state.globalSyncStatus === 'syncing'
    );
  }

  function dashboardPreviewMayContainMedia(note) {
    const icon = String(note?.icon || '').toLowerCase();
    const type = String(note?.type || '').toLowerCase();

    return (
      type === 'drawing' ||
      icon.includes('image') ||
      icon.includes('play') ||
      icon.includes('video') ||
      icon.includes('podcast') ||
      icon.includes('line-squiggle')
    );
  }

  function renderDashboardPreviewSkeleton(note, {
    media = false,
    event = false,
  } = {}) {
    const wrap = el('div', {
      class:
        'yanta-dash-preview-loading' +
        (media ? ' media' : '') +
        (event ? ' event' : ''),
      'aria-label': 'Loading note preview',
    });

    if (event) {
      wrap.append(el('div', { class: 'yanta-dash-skeleton-event' }));
    }

    if (media) {
      wrap.append(el('div', { class: 'yanta-dash-skeleton-media' }));
    }

    wrap.append(
      el('div', { class: 'yanta-dash-skeleton-line long' }),
      el('div', { class: 'yanta-dash-skeleton-line mid' }),
      el('div', { class: 'yanta-dash-skeleton-line short' })
    );

    return wrap;
  }

  function renderDashboardFolderMiniSkeleton() {
    return el('div', {
      class: 'yanta-dash-folder-mini-loading',
      'aria-label': 'Loading note preview',
    },
      el('span'),
      el('span'),
      el('span')
    );
  }

  const DASHBOARD_CARD_DISPLAY_KEY = 'dashboard.cardDisplay.v1';

  const DEFAULT_DASHBOARD_CARD_DISPLAY = {
    notesShowHeader: false,
    foldersShowHeader: false,

    linkedEventShow: true,
    linkedEventFields: {
      icon: true,
      title: true,
      time: true,
      location: true,
      description: true,
    },
  };

  function normalizeDashboardCardDisplayPrefs(raw = {}) {
    return {
      ...DEFAULT_DASHBOARD_CARD_DISPLAY,
      ...(raw && typeof raw === 'object' ? raw : {}),

      linkedEventFields: {
        ...DEFAULT_DASHBOARD_CARD_DISPLAY.linkedEventFields,
        ...(raw?.linkedEventFields && typeof raw.linkedEventFields === 'object'
          ? raw.linkedEventFields
          : {}),
      },
    };
  }

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

    layoutCommitInProgress: false,

    // Disable entry stagger while a View Transition is taking snapshots.
    // Otherwise target snapshots can be captured with opacity:0.
    suppressStagger: false,

    // Temporarily suppress stagger after drag/drop reorder.
    // Otherwise a dashboard refresh after reordering replays the entry animation.
    suppressStaggerUntil: 0,

    // Signatur des zuletzt voll gerenderten Dashboard-Zustands.
    // Gleiche Signatur => kein replaceChildren(), nur gezielte Card-Refreshes.
    lastStructureSig: '',
  };

  let dashboardStaggerIndex = 0;

  const previewCache = new Map();
  // noteId -> { updated, textLen, preview }
    
  let calendarModulePromise = null;

  function calendarModule() {
    calendarModulePromise ||= import('./calendar.js');
    return calendarModulePromise;
  }

  async function dashboardLinkedEventHeader(noteId) {
    const prefs = normalizeDashboardCardDisplayPrefs(dashboardCardDisplay);

    if (!prefs.linkedEventShow) return null;

    try {
      const calendar = await calendarModule();

      return calendar.createLinkedCalendarEventDashboardHeader?.(noteId, {
        fields: prefs.linkedEventFields,
      }) || null;
    } catch (err) {
      console.warn('[YANTA Dashboard] Could not render linked event header', err);
      return null;
    }
  }

  function dashboardItemFromKey(key) {
    const { kind, id } = parseItemKey(key);

    if (kind === 'note') {
      const note = state.notes.get(id);
      return note
        ? {
            kind: 'note',
            id,
            note,
          }
        : null;
    }

    if (kind === 'folder') {
      const folder = state.folders.get(id);
      return folder
        ? {
            kind: 'folder',
            id,
            folder,
          }
        : null;
    }

    return null;
  }

  function dashboardSelectedDragKeys(sourceKey) {
    const selected = getDashboardSelectedKeys();

    if (
      selected.length > 1 &&
      selected.includes(sourceKey)
    ) {
      return selected;
    }

    return [sourceKey];
  }

  function dashboardKeyToAiRef(key) {
    const { kind, id } = parseItemKey(key);

    if (kind === 'note') return { kind: 'note', id };
    if (kind === 'folder') return { kind: 'folder', id };

    return null;
  }

  function aiContextDropTargetAtPoint(x, y) {
    return document
      .elementFromPoint(x, y)
      ?.closest?.('[data-ai-context-drop-target]');
  }

  function emitAiContextDashboardDragHover(d, x, y) {
    const over = !!aiContextDropTargetAtPoint(x, y);

    const refs = d
      ? dashboardSelectedDragKeys(d.key)
          .map(dashboardKeyToAiRef)
          .filter(Boolean)
      : [];

    window.dispatchEvent(new CustomEvent('yanta-ai-context-drag-position', {
      detail: {
        over,
        clientX: x,
        clientY: y,
        refs,
      },
    }));
  }

  function endAiContextDashboardDragHover() {
    window.dispatchEvent(new CustomEvent('yanta-ai-context-drag-end'));
  }

  async function moveDashboardKeysToFolder(keys = [], folderId) {
    let moved = 0;
  
    const writes = [];
    const t = Date.now();
  
    for (const key of keys) {
      const { kind, id } = parseItemKey(key);
  
      if (kind === 'note') {
        const note = state.notes.get(id);
        if (!note) continue;
  
        note.folderId = folderId || null;
        note.pinned = false;
        note.updated = t;
  
        writes.push(store.notes.put(note));
        previewCache.delete(id);
  
        moved++;
        continue;
      }
  
      if (kind === 'folder') {
        const folder = state.folders.get(id);
        if (!folder) continue;
  
        if (
          folderId &&
          (
            folderId === folder.id ||
            dashboardFolderIsAncestor(folder.id, folderId)
          )
        ) {
          continue;
        }
  
        folder.parentId = folderId || null;
        folder.updated = t;
  
        writes.push(store.folders.put(folder));
  
        moved++;
      }
    }
  
    await Promise.all(writes);
  
    if (folderId) {
      state.expandedFolders.add(folderId);
    }
  
    return moved;
  }

  async function moveDashboardKeysToTrash(keys = []) {
    const noteIds = [];
    const folderIds = [];

    for (const key of keys) {
      const { kind, id } = parseItemKey(key);

      if (kind === 'note' && state.notes.has(id)) {
        noteIds.push(id);
        continue;
      }

      if (kind === 'folder' && state.folders.has(id)) {
        folderIds.push(id);
      }
    }

    if (!noteIds.length && !folderIds.length) {
      return 0;
    }

    const movedCount = await moveItemsToTrash({
      noteIds,
      folderIds,
      source: 'dashboard-drag-multi',
    });

    for (const id of noteIds) {
      previewCache.delete(id);
    }

    return movedCount;
  }

  export function getDashboardCardDisplayPrefs() {
    return normalizeDashboardCardDisplayPrefs(dashboardCardDisplay);
  }

  export async function loadDashboardCardDisplayPrefs() {
    if (dashboardCardDisplayLoaded) return dashboardCardDisplay;

    try {
      dashboardCardDisplay = normalizeDashboardCardDisplayPrefs(
        await store.settings.get(DASHBOARD_CARD_DISPLAY_KEY, {})
      );
    } catch {
      dashboardCardDisplay = normalizeDashboardCardDisplayPrefs();
    }

    dashboardCardDisplayLoaded = true;
    return dashboardCardDisplay;
  }

  export async function setDashboardCardDisplayPrefs(patch = {}) {
    dashboardCardDisplay = normalizeDashboardCardDisplayPrefs({
      ...dashboardCardDisplay,
      ...patch,
      linkedEventFields: {
        ...dashboardCardDisplay.linkedEventFields,
        ...(patch.linkedEventFields || {}),
      },
    });

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

  function isDashboardBlankAreaTarget(target) {
    const node = target instanceof Element ? target : null;
    if (!node || !root?.contains(node)) return false;
  
    if (dashboard.dragging || dashboard.resize) return false;
  
    /*
      Nicht leeren, wenn man auf eine Card, Control, Popover,
      Inline-Edit oder Header-Control tippt.
    */
    if (
      node.closest?.(
        [
          '.yanta-dash-card',
          '.yanta-dash-card-clone',
          '.drag-clone',
          '.yanta-inline-edit',
          '.yanta-dashboard-selection-tray',
          '.yanta-dashboard-popover',
          'button',
          'input',
          'textarea',
          'select',
          'a',
          'iframe',
          '[contenteditable="true"]',
        ].join(',')
      )
    ) {
      return false;
    }
  
    /*
      Header nicht als "Leere" behandeln.
      Wenn du auch Header-Leerflächen zum Deselect nutzen willst,
      diese Zeile entfernen.
    */
    if (node.closest?.('.yanta-dashboard-head')) {
      return false;
    }
  
    return !!node.closest?.(
      [
        '.yanta-dashboard-body',
        '.yanta-dashboard-grid',
        '.yanta-dashboard-page',
        '#dashboard',
      ].join(',')
    );
  }
  
  function clearDashboardItemSelectionFromBlankTap() {
    dashboard.selectedKey = null;
  
    root
      ?.querySelectorAll('.yanta-dash-card.selected')
      ?.forEach((node) => {
        node.classList.remove('selected');
      });
  
    window.dispatchEvent(new CustomEvent('yanta-dashboard-clear-selection', {
      detail: {
        source: 'dashboard-blank-tap',
      },
    }));
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

  export function suppressDashboardAnimationsFor(ms = 900) {
    dashboard.suppressStaggerUntil = Math.max(
      dashboard.suppressStaggerUntil || 0,
      performance.now() + ms
    );
  }

  function suppressDashboardStaggerFor(ms = 900) {
    suppressDashboardAnimationsFor(ms);
  }

  function applyDashboardStagger(node) {
    if (!node) return;
    if (dashboard.suppressStagger) return;
    if ((dashboard.suppressStaggerUntil || 0) > performance.now()) return;
    if (prefersReducedMotion()) return;

    const i = dashboardStaggerIndex++;

    /*
      Smooth progressive stagger:
      - frühe Items starten schnell und kurz
      - spätere Items bekommen etwas mehr Delay UND längere Fade-Dauer
      - alles gecappt, damit große Dashboards nicht träge werden
    */
    const cappedIndex = Math.min(i, 34);

    const delay = cappedIndex * 24;
    const duration = Math.min(1000, 680 + cappedIndex * 16);

    /*
      Spätere Items starten minimal tiefer.
      Das unterstützt den smoothen "Wave"-Effekt, ohne zu stark zu springen.
    */
    const offset = Math.min(16, 8 + cappedIndex * 0.22);

    node.classList.add('yanta-stagger-item');
    node.style.setProperty('--yanta-stagger-delay', `${delay}ms`);
    node.style.setProperty('--yanta-stagger-duration', `${duration}ms`);
    node.style.setProperty('--yanta-stagger-offset', `${offset}px`);
  }
  
  function cancelDashboardCardStagger(card) {
    if (!card) return;

    card.classList.remove('yanta-stagger-item');

    try {
      card.getAnimations?.().forEach((anim) => {
        try {
          anim.cancel();
        } catch {}
      });
    } catch {}

    card.style.animation = '';
    card.style.opacity = '';
    card.style.transform = '';
    card.style.filter = '';
  }

  function dashboardGridMetricsForCard(card = null) {
    const grid =
      card?.closest?.('.yanta-dashboard-grid') ||
      root?.querySelector?.('.yanta-dashboard-grid') ||
      null;

    if (!grid) {
      return {
        row: GRID_ROW_PX,
        gap: GRID_GAP_PX,
      };
    }

    const style = getComputedStyle(grid);

    const row =
      parseFloat(style.gridAutoRows || '') ||
      GRID_ROW_PX;

    const gap =
      parseFloat(style.rowGap || '') ||
      parseFloat(style.gap || '') ||
      GRID_GAP_PX;

    return {
      row: Number.isFinite(row) && row > 0 ? row : GRID_ROW_PX,
      gap: Number.isFinite(gap) && gap >= 0 ? gap : GRID_GAP_PX,
    };
  }

  function heightToGridSpan(px, card = null) {
    const h = Math.max(
      MIN_CARD_HEIGHT,
      Math.min(MAX_CARD_HEIGHT, Number(px) || DEFAULT_NOTE_HEIGHT)
    );

    const { row, gap } = dashboardGridMetricsForCard(card);

    /*
      CSS Grid item height:
        span * rowHeight + (span - 1) * rowGap

      Umgestellt:
        span = ceil((height + rowGap) / (rowHeight + rowGap))

      Wichtig:
      rowGap muss aus CSS kommen, weil dashboard.css je nach Breakpoint
      andere Gaps verwenden kann.
    */
    return Math.max(
      5,
      Math.ceil((h + gap) / (row + gap))
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

  const dashboardAutofitObservers = new WeakMap();

  function hasManualDashboardHeight(note) {
    return note.dashboardHeightPx != null || note.dashboardHeight != null;
  }

  function applyDashboardCardHeight(card, heightPx) {
    const h = Math.max(
      MIN_CARD_HEIGHT,
      Math.min(MAX_CARD_HEIGHT, Math.ceil(Number(heightPx) || MIN_CARD_HEIGHT))
    );

    card.style.setProperty('--dash-row-span', String(heightToGridSpan(h, card)));
    card.dataset.effectiveHeight = String(h);
  }

  function dashboardNumericStyle(node, prop) {
    if (!node) return 0;

    const value = parseFloat(
      getComputedStyle(node).getPropertyValue(prop) || '0'
    );

    return Number.isFinite(value) ? value : 0;
  }

  function dashboardVerticalMargins(node) {
    if (!node) return 0;

    return (
      dashboardNumericStyle(node, 'margin-top') +
      dashboardNumericStyle(node, 'margin-bottom')
    );
  }

  function dashboardVisibleInLayout(node) {
    if (!node) return false;

    const style = getComputedStyle(node);

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.position !== 'absolute' &&
      style.position !== 'fixed'
    );
  }

  function measureDashboardPreviewContentHeight(card, host) {
    if (!card || !host) return DEFAULT_NOTE_HEIGHT;
    if (!card.isConnected || !host.isConnected) return DEFAULT_NOTE_HEIGHT;

    const cardRect = card.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();

    const cardWidth = Math.max(
      120,
      Math.ceil(cardRect.width || card.offsetWidth || 0)
    );

    const hostWidth = Math.max(
      80,
      Math.ceil(hostRect.width || host.clientWidth || cardWidth || 0)
    );

    if (!cardWidth || !hostWidth) return DEFAULT_NOTE_HEIGHT;

    /*
      Wichtig:
      Der Preview-Clone braucht denselben CSS-Kontext wie die echte Preview:
        .yanta-dashboard-page
          .yanta-dash-card.note-card
            .yanta-dash-preview

      Wir messen aber NICHT die Card-Höhe, sondern nur den Preview-Inhalt.
    */
    const sandbox = document.createElement('div');
    sandbox.className = 'yanta-dashboard-measure-sandbox';

    Object.assign(sandbox.style, {
      position: 'fixed',
      left: '-100000px',
      top: '0',
      width: `${cardWidth}px`,
      height: 'auto',
      minHeight: '0',
      maxHeight: 'none',
      overflow: 'visible',
      visibility: 'hidden',
      pointerEvents: 'none',
      opacity: '0',
      zIndex: '-1',
      contain: 'layout style paint',
    });

    const realPage = card.closest('.yanta-dashboard-page');

    const page = document.createElement('div');
    page.className = 'yanta-dashboard-page';

    if (realPage) {
      for (const [key, value] of Object.entries(realPage.dataset || {})) {
        page.dataset[key] = value;
      }
    }

    const cardShell = document.createElement('article');
    cardShell.className = card.className;

    cardShell.classList.remove(
      'selected',
      'bulk-selected',
      'bulk-focus',
      'resizing',
      'drag-source',
      'yanta-stagger-item'
    );

    Object.assign(cardShell.style, {
      width: `${cardWidth}px`,
      height: 'auto',
      minHeight: '0',
      maxHeight: 'none',
      margin: '0',
      transform: 'none',
      animation: 'none',
      gridRow: 'auto',
      position: 'relative',
      overflow: 'visible',
      contain: 'layout style paint',
    });

    cardShell.style.setProperty('--dash-row-span', 'auto');

    const previewClone = host.cloneNode(false);
    previewClone.className = host.className;

    /*
      Preview-Host bekommt exakt die echte Breite.
      Keine echte Höhe, kein Grid-Stretch.
    */
    Object.assign(previewClone.style, {
      width: `${hostWidth}px`,
      height: 'auto',
      minHeight: '0',
      maxHeight: 'none',
      overflow: 'visible',
      flex: '0 0 auto',
      alignSelf: 'stretch',
    });

    for (const child of [...host.children]) {
      if (!dashboardVisibleInLayout(child)) continue;

      previewClone.append(child.cloneNode(true));
    }

    cardShell.append(previewClone);
    page.append(cardShell);
    sandbox.append(page);
    document.body.append(sandbox);

    let measured = 0;

    try {
      const children = [...previewClone.children];

      if (children.length) {
        let h = 0;

        /*
          Host-eigene Padding/Border mitmessen.
          Children-Messung allein verpasst sonst Preview-Innenabstände.
        */
        h += dashboardNumericStyle(previewClone, 'padding-top');
        h += dashboardNumericStyle(previewClone, 'padding-bottom');
        h += dashboardNumericStyle(previewClone, 'border-top-width');
        h += dashboardNumericStyle(previewClone, 'border-bottom-width');

        for (const child of children) {
          const rect = child.getBoundingClientRect();

          h += rect.height + dashboardVerticalMargins(child);
        }

        const hostStyle = getComputedStyle(previewClone);
        const rowGap =
          parseFloat(hostStyle.rowGap || hostStyle.gap || '0') || 0;

        if (rowGap && children.length > 1) {
          h += rowGap * (children.length - 1);
        }

        measured = Math.ceil(h);
      } else {
        measured = Math.ceil(
          previewClone.scrollHeight ||
          previewClone.offsetHeight ||
          0
        );
      }
    } finally {
      sandbox.remove();
    }

    return Math.max(0, measured || 0);
  }

  function measureDashboardCardChromeHeight(card, host) {
    if (!card || !host) return 0;

    let h = 0;

    /*
      Card padding/border.
    */
    h += dashboardNumericStyle(card, 'padding-top');
    h += dashboardNumericStyle(card, 'padding-bottom');
    h += dashboardNumericStyle(card, 'border-top-width');
    h += dashboardNumericStyle(card, 'border-bottom-width');

    /*
      Nur echte Layout-Chrome-Elemente zählen.
      Bewusst NICHT:
      - Preview selbst
      - Note-Corner
      - Actions
      - Resize-Handle
    */
    const header = card.querySelector(':scope > .yanta-dash-card-head');

    if (header && dashboardVisibleInLayout(header)) {
      const rect = header.getBoundingClientRect();
      h += rect.height + dashboardVerticalMargins(header);
    }

    return Math.ceil(h);
  }

  function measureDashboardNoteCardNaturalHeight(card, host) {
    if (!card || !host) return DEFAULT_NOTE_HEIGHT;

    const previewH = measureDashboardPreviewContentHeight(card, host);
    const chromeH = measureDashboardCardChromeHeight(card, host);

    /*
      Kleine Reserve gegen Subpixel/Grid-Rounding.
      Keine breitenabhängige Magic-Zahl.
    */
    const reserve = 4;

    return Math.max(
      MIN_CARD_HEIGHT,
      Math.min(
        MAX_CARD_HEIGHT,
        Math.ceil(previewH + chromeH + reserve)
      )
    );
  }

  function fitDashboardNoteCardToRenderedPreview(card, note, host) {
    if (!card || !note || !host) return;

    try {
      dashboardAutofitObservers.get(card)?.disconnect();
    } catch {}

    dashboardAutofitObservers.delete(card);

    let raf = 0;
    let lastAppliedHeight = Number(card.dataset.effectiveHeight || 0) || 0;

    const apply = () => {
      raf = 0;

      if (!card.isConnected || !host.isConnected) {
        try {
          dashboardAutofitObservers.get(card)?.disconnect();
        } catch {}

        dashboardAutofitObservers.delete(card);
        return;
      }

      const contentHeight = measureDashboardNoteCardNaturalHeight(card, host);

      card.dataset.contentMaxHeight = String(contentHeight);

      const finalHeight = hasManualDashboardHeight(note)
        ? Math.min(
            itemDashboardHeightPx({ kind: 'note', note, id: note.id }),
            contentHeight
          )
        : contentHeight;

      if (Math.abs(finalHeight - lastAppliedHeight) < 1) {
        return;
      }

      lastAppliedHeight = finalHeight;
      applyDashboardCardHeight(card, finalHeight);
    };

    const scheduleApply = () => {
      if (raf) return;

      raf = requestAnimationFrame(() => {
        requestAnimationFrame(apply);
      });
    };

    requestAnimationFrame(() => {
      apply();

      host.querySelectorAll('img').forEach((img) => {
        if (img.complete) return;

        img.addEventListener('load', scheduleApply, { once: true });
        img.addEventListener('error', scheduleApply, { once: true });
      });

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          scheduleApply();
        });

        ro.observe(card);
        ro.observe(host);

        for (const child of host.children) {
          ro.observe(child);
        }

        dashboardAutofitObservers.set(card, ro);
      }
    });
  }

  let dashboardAutofitTimer = 0;

  function scheduleDashboardVisibleNoteAutofit({
    delay = 120,
  } = {}) {
    clearTimeout(dashboardAutofitTimer);

    dashboardAutofitTimer = window.setTimeout(() => {
      if (!dashboard.visible || !root) return;

      const cards = [
        ...root.querySelectorAll('.yanta-dash-card.note-card[data-note-id]'),
      ];

      for (const card of cards) {
        const noteId = card.dataset.noteId;
        const note = state.notes.get(noteId);

        if (!note) continue;

        /*
          Manuelle Höhen respektieren.
          Doppelklick auf Resize-Handle löscht dashboardHeightPx/dashboardHeight.
        */
        if (hasManualDashboardHeight(note)) {
          continue;
        }

        const host = card.querySelector('[data-preview-host]');
        if (!host) continue;

        fitDashboardNoteCardToRenderedPreview(card, note, host);
      }
    }, delay);
  }

  function maxResizeHeightForCard(card, key) {
    const { kind, id } = parseItemKey(key);

    if (kind === 'note') {
      const note = state.notes.get(id);
      const host = card?.querySelector?.('[data-preview-host]');

      if (note && host) {
        const measured = measureDashboardNoteCardNaturalHeight(card, host);

        if (measured > 0) {
          return Math.max(MIN_CARD_HEIGHT, Math.min(MAX_CARD_HEIGHT, measured));
        }
      }

      const fromPreview = Number(card?.dataset?.contentMaxHeight);

      if (Number.isFinite(fromPreview) && fromPreview > 0) {
        return Math.max(MIN_CARD_HEIGHT, Math.min(MAX_CARD_HEIGHT, fromPreview));
      }
    }

    return MAX_CARD_HEIGHT;
  }
  
  function noteHasCustomIcon(note) {
    const def = note.type === 'list' ? 'list' : 'file-text';
    return !!note.icon && note.icon !== def && note.icon !== 'file';
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
  
  let dashboardChildIndex = null;

  function invalidateDashboardChildIndex() {
    dashboardChildIndex = null;
  }
  
  function dashboardChildren() {
    if (dashboardChildIndex) return dashboardChildIndex;
    const foldersByParent = new Map();
    const notesByFolder = new Map();
    for (const f of state.folders.values()) {
      const key = f.parentId || null;
      if (!foldersByParent.has(key)) foldersByParent.set(key, []);
      foldersByParent.get(key).push(f);
    }
    for (const n of state.notes.values()) {
      const key = n.folderId || null;
      if (!notesByFolder.has(key)) notesByFolder.set(key, []);
      notesByFolder.get(key).push(n);
    }
    dashboardChildIndex = { foldersByParent, notesByFolder };
    return dashboardChildIndex;
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
    .filter((n) => !isNoteInTrash(n))
    .filter((n) => !shouldHideFromDashboard(n))
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
    .filter((f) => !isFolderInTrash(f))
    .filter((f) => !shouldHideFromDashboard(f))
    .filter((f) => (f.parentId || null) === folderId)
    .map((folder) => ({
      kind: 'folder',
      id: folder.id,
      folder,
      pinned: false,
      mirrored: false,
    }));

  const notes = [...state.notes.values()]
    .filter((n) => !isNoteInTrash(n))
    .filter((n) => !shouldHideFromDashboard(n))
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

  invalidateDashboardChildIndex();

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

    injectDashboardPreviewLoadingCss();
  
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

    window.addEventListener('yanta-folder-updated', (e) => {
      invalidateDashboardChildIndex();

      if (shouldIgnoreInvisibleSyncEvent(e.detail)) {
        return;
      }

      if (!dashboard.visible) return;

      const folderId = e.detail?.folderId;
      if (!folderId) return;

      if (e.detail?.refreshDashboard === false) {
        syncDashboardFolderLabels(folderId);
        return;
      }

      renderDashboard({
        animate: e.detail?.source !== 'sync',
      });
    });

    window.addEventListener('yanta-dashboard-settings-changed', () => {
      if (dashboard.visible) renderDashboard();
    });
  
    MOBILE_MQ.addEventListener?.('change', () => {
      if (isMobile() && !state.currentNoteId) {
        showDashboard({ replace: true });
      }
    });

    window.addEventListener('resize', () => {
      scheduleDashboardVisibleNoteAutofit({
        delay: 180,
      });
    });

    window.addEventListener('yanta-sidebar-resized', () => {
      scheduleDashboardVisibleNoteAutofit({
        delay: 240,
      });
    });

    window.addEventListener('yanta-side-pane-opened', () => {
      scheduleDashboardVisibleNoteAutofit({
        delay: 240,
      });
    });

    window.addEventListener('yanta-side-pane-closed', () => {
      scheduleDashboardVisibleNoteAutofit({
        delay: 240,
      });
    });

    window.addEventListener('yanta-dashboard-external-drag-start', (e) => {
      if (!dashboard.visible) return;
      if (dashboard.dragging || dashboard.resize) return;

      const detail = e.detail || {};
      const key = detail.key || '';
      const item = dashboardItemFromKey(key);
      const card = findDashboardCardByKey(key);

      if (!item || !card) return;

      startCardDrag(card, item, gesturePoint(detail.clientX, detail.clientY, {
        pointerId: detail.pointerId,
        pointerType: detail.pointerType || 'mouse',
      }));
    });

    window.addEventListener('yanta-dashboard-external-drag-move', (e) => {
      const d = dashboard.dragging;
      const detail = e.detail || {};

      if (!d) return;
      if (d.pointerId != null && detail.pointerId !== d.pointerId) return;

      moveCardDrag(gesturePoint(detail.clientX, detail.clientY, {
        pointerId: detail.pointerId,
        pointerType: detail.pointerType || d.pointerType || 'mouse',
      }));
    });

    window.addEventListener('yanta-dashboard-external-drag-end', async (e) => {
      const d = dashboard.dragging;
      const detail = e.detail || {};

      if (!d) return;
      if (d.pointerId != null && detail.pointerId !== d.pointerId) return;

      moveCardDrag(gesturePoint(detail.clientX, detail.clientY, {
        pointerId: detail.pointerId,
        pointerType: detail.pointerType || d.pointerType || 'mouse',
      }));

      await finishCardDrag();
    });

    window.addEventListener('yanta-dashboard-external-drag-cancel', (e) => {
      const d = dashboard.dragging;
      const detail = e.detail || {};

      if (!d) return;
      if (d.pointerId != null && detail.pointerId !== d.pointerId) return;

      forceCancelDashboardDrag('external-dashboard-drag-cancel');
    });

    let pendingBlankTap = null;

    document.addEventListener('pointerdown', (e) => {
      if (!dashboard.visible) return;
      if (e.button != null && e.button !== 0) return;
    
      /*
        Modifier nicht anfassen:
        Ctrl/Cmd/Shift gehören Selection/Rectangle-Workflows.
      */
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    
      if (!isDashboardBlankAreaTarget(e.target)) return;
    
      pendingBlankTap = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
      };
    }, true);
    
    document.addEventListener('pointermove', (e) => {
      if (!pendingBlankTap) return;
      if (e.pointerId !== pendingBlankTap.pointerId) return;
    
      const moved = Math.hypot(
        e.clientX - pendingBlankTap.startX,
        e.clientY - pendingBlankTap.startY
      );
    
      /*
        Bewegung => kein Tap.
        Rectangle Select darf weiterlaufen.
      */
      if (moved > 5) {
        pendingBlankTap = null;
      }
    }, true);
    
    document.addEventListener('pointerup', (e) => {
      if (!pendingBlankTap) return;
      if (e.pointerId !== pendingBlankTap.pointerId) return;
    
      const moved = Math.hypot(
        e.clientX - pendingBlankTap.startX,
        e.clientY - pendingBlankTap.startY
      );
    
      pendingBlankTap = null;
    
      if (moved > 5) return;
    
      /*
        Jetzt erst ist es wirklich ein gezielter Tap ins Leere.
      */
      clearDashboardItemSelectionFromBlankTap();
    }, true);
    
    document.addEventListener('pointercancel', (e) => {
      if (!pendingBlankTap) return;
      if (e.pointerId !== pendingBlankTap.pointerId) return;
    
      pendingBlankTap = null;
    }, true);
      
    window.addEventListener('yanta-note-updated', (e) => {
      const noteId = e.detail?.noteId;
      const reason = e.detail?.reason || '';
      const source = e.detail?.source || '';

      invalidateDashboardChildIndex();

      if (shouldIgnoreInvisibleSyncEvent(e.detail)) {
        return;
      }

      /*
        Layout-Änderungen dürfen keine Preview-Invalidierung auslösen.
        Content-/Title-/Task-Änderungen weiterhin schon.
      */
      if (noteId && reason !== 'layout-change') {
        previewCache.delete(noteId);
      }

      /*
        Dashboard-eigene Layout-Änderungen sind bereits im DOM umgesetzt
        oder werden explizit durch die jeweilige Aktion gerendert.
        Kein Full-Render, keine Preview-Rehydration.
      */
      if (reason === 'layout-change' && source === 'dashboard') {
        return;
      }

      if (
        dashboard.visible &&
        reason === 'task-toggle' &&
        source === 'dashboard'
      ) {
        return;
      }

      if (dashboard.visible) {
        renderDashboard({
          animate: source !== 'sync',
        });
      }
    });
  
      window.addEventListener('yanta-dashboard-rename-folder', (e) => {
        if (!dashboard.visible) return;
      
        const folderId = e.detail?.folderId;
      
        if (!folderId || !state.folders.has(folderId)) return;
      
        requestAnimationFrame(() => {
          const card = findDashboardFolderCard(folderId);
      
          if (card) {
            renameDashboardFolder(folderId, card);
            return;
          }
      
          // Fallback: falls der Folder-Titel der aktuellen Dashboard-Route gemeint ist.
          if (dashboard.folderId === folderId) {
            const title = root?.querySelector('.yanta-dashboard-title');
            if (title) renameDashboardCurrentFolderTitle(title);
          }
        });
      });

      window.addEventListener('yanta-dashboard-rename-note', (e) => {
        if (!dashboard.visible) return;
      
        const noteId = e.detail?.noteId;
      
        if (!noteId || !state.notes.has(noteId)) return;
      
        requestAnimationFrame(() => {
          const card = findDashboardNoteCard(noteId);
      
          if (card) {
            renameDashboardNote(noteId, card);
          }
        });
      });

      window.addEventListener('yanta-dashboard-refresh', (e) => {
        if (!dashboard.visible) return;

        if (e.detail?.source === 'sync' && e.detail?.changed === false) {
          return;
        }

        renderDashboard({
          animate: e.detail?.source !== 'sync',

          /*
            Warum: Widget-Sichtbarkeit (z.B. RSS-Widget an/aus) ändert die
            Struktur-Signatur nicht — ohne force würde der Cache den
            Re-Render verschlucken.
          */
          force: e.detail?.force === true,
        });
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
    window.addEventListener('yanta-calendar-updated', (e) => {
      if (!dashboard.visible) return;
      if (e.detail?.source === 'sync' && e.detail?.changed === false) {
        return;
      }
      /*
        Kalender-Änderungen ändern die Card-Struktur nicht — nur die
        Event-Header in den Note-Previews. Gezielt Previews auffrischen
        statt Full-Rerender.
      */
      refreshAllDashboardNotePreviews();
    });

    window.addEventListener('yanta-vault-hydrated', (e) => {
      if (!dashboard.visible) return;

      /*
        Hintergrund-Sync ohne echte Metadata-Änderung darf Dashboard nicht neu
        rendern. Sonst flackern Cards wegen root.replaceChildren().
      */
      if (e.detail?.source === 'sync' && e.detail?.changed === false) {
        return;
      }

      renderDashboard({
        animate: e.detail?.source !== 'sync',
      });
    });
    
    window.addEventListener('blur', () => {
      if (dashboard.dragging) {
        forceCancelDashboardDrag('window-blur');
      }
    });

    window.addEventListener('pagehide', () => {
      if (dashboard.dragging) {
        forceCancelDashboardDrag('pagehide');
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' && dashboard.dragging) {
        forceCancelDashboardDrag('visibilitychange');
      }
    });

    document.addEventListener('pointerdown', () => {
      repairDashboardDragInvariants();
    }, true);

    document.addEventListener('touchstart', () => {
      repairDashboardDragInvariants();
    }, {
      capture: true,
      passive: true,
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

  if (dashboard.dragging) {
    forceCancelDashboardDrag('hide-dashboard');
  }

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

  if (!noteId || !document.startViewTransition || prefersReducedMotion()) {
    showDashboard({ folderId, replace });
    return;
  }

  const transitionName = transitionNameFor('note', noteId);
  const source = $('panes');

  let targetCard = null;
  let targetPage = null;

  if (source) {
    source.style.viewTransitionName = transitionName;
    source.style.contain = 'layout paint';
    source.classList.add('is-note-transition-source');
  }

  dashboard.suppressStagger = true;

  const vt = document.startViewTransition(() => {
    showDashboard({ folderId, replace: false, push: false });

    targetCard = root?.querySelector(
      `.yanta-dash-card[data-note-id="${CSS.escape(noteId)}"]`
    );

    if (targetCard) {
      targetCard.style.viewTransitionName = transitionName;
      targetCard.style.contain = 'layout paint';
      targetCard.classList.add('is-note-transition-target');
      return;
    }

    /*
      Fallback:
      If the note card is not visible in the target dashboard route
      (e.g. note opened from tree, note lives elsewhere), still animate
      panes -> dashboard page instead of doing no transition.
    */
    targetPage = dashboardPage();

    if (targetPage) {
      targetPage.style.viewTransitionName = transitionName;
      targetPage.style.contain = 'layout paint';
      targetPage.classList.add('is-note-transition-target');
    }
  });

  await vt.finished.catch(() => {});

  dashboard.suppressStagger = false;

  if (source) {
    source.style.viewTransitionName = '';
    source.style.contain = '';
    source.classList.remove('is-note-transition-source');
  }

  if (targetCard) {
    targetCard.style.viewTransitionName = '';
    targetCard.style.contain = '';
    targetCard.classList.remove('is-note-transition-target');
  }

  if (targetPage) {
    targetPage.style.viewTransitionName = '';
    targetPage.style.contain = '';
    targetPage.classList.remove('is-note-transition-target');
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

function dashboardStructureSignature(items) {
  const { pinnedNotes, normalItems } = items;
  const parts = [
    'sig-v1',
    dashboard.folderId || 'root',
    JSON.stringify(dashboardCardDisplay),
  ];
  for (const item of [...pinnedNotes, ...normalItems]) {
    if (item.kind === 'note') {
      const n = item.note;
      parts.push([
        'n',
        n.id,
        n.title || '',
        n.icon || '',
        n.color || '',
        n.pinned ? 1 : 0,
        item.mirrored ? 1 : 0,
        n.dashboardHeightPx ?? n.dashboardHeight ?? '',
        isPublicShareActive(publicShareStateForNote(n.id)) ? 1 : 0,
      ].join('\u0001'));
      continue;
    }
    const f = item.folder;
    /*
      Folder-Cards rendern Mini-Previews ihrer Kinder.
      Kinder-STRUKTUR (Keys, Titel, Icons, Farben) gehört deshalb in die
      Signatur. Kinder-INHALT (note.updated) bewusst nicht — der wird
      über refreshChangedDashboardCards() gezielt nachgezogen.
    */
    const children = folderPreviewItems(f.id)
      .map((c) => `${c.kind}:${c.id}:${c.title}:${c.icon}:${c.color}`)
      .join(',');
    parts.push([
      'f',
      f.id,
      f.name || '',
      f.icon || '',
      f.color || '',
      f.dashboardHeightPx ?? f.dashboardHeight ?? '',
      children,
    ].join('\u0001'));
  }
  return parts.join('\n');
}

/*
  Gezielter Refresh statt Full-Render:
  Nur Cards/Mini-Zellen, deren note.updated sich seit dem letzten Render
  geändert hat, werden neu hydriert. Alles andere bleibt unangetastet
  (Scroll, Fokus, Animationszustand, bereits geladene Thumbnails).
*/
function refreshChangedDashboardCards() {
  if (!root) return;
  root
    .querySelectorAll('.yanta-dash-card.note-card[data-note-id]')
    .forEach((card) => {
      const note = state.notes.get(card.dataset.noteId);
      if (!note) return;
      const stamp = String(note.updated || 0);
      if (card.dataset.updatedStamp === stamp) return;
      card.dataset.updatedStamp = stamp;
      previewCache.delete(note.id);
      previewObserver?.unobserve(card);
      hydrateCardPreview(card, note.id).catch(() => {});
    });
  root
    .querySelectorAll('[data-mini-note-preview]')
    .forEach((host) => {
      const id = host.dataset.miniNotePreview;
      const note = state.notes.get(id);
      if (!note) return;
      const stamp = String(note.updated || 0);
      if (host.dataset.updatedStamp === stamp) return;
      previewCache.delete(id);
      hydrateFolderNotePreviewCell(host, id).catch(() => {});
    });
}

/*
  Für Kalender-Änderungen: Event-Header hängen nicht an note.updated,
  deshalb hier alle sichtbaren Note-Previews auffrischen — ohne die
  Card-Struktur anzufassen.
*/
function refreshAllDashboardNotePreviews() {
  if (!root) return;
  root
    .querySelectorAll('.yanta-dash-card.note-card[data-note-id]')
    .forEach((card) => {
      const id = card.dataset.noteId;
      previewCache.delete(id);
      previewObserver?.unobserve(card);
      hydrateCardPreview(card, id).catch(() => {});
    });
}

/*
  Nach Drag-Reorder: persistGridOrder() ändert dashboardOrder + updated
  im State, aber der DOM ist bereits korrekt. Baseline synchronisieren,
  damit der nächste renderDashboard()-Aufruf kein unnötiges Full-Render
  und keine Preview-Rehydration auslöst.
*/
function syncDashboardRenderBaseline() {
  invalidateDashboardChildIndex();
  dashboard.lastStructureSig = dashboardStructureSignature(getDashboardItems());
  root
    ?.querySelectorAll('.yanta-dash-card.note-card[data-note-id]')
    ?.forEach((card) => {
      const note = state.notes.get(card.dataset.noteId);
      if (note) {
        card.dataset.updatedStamp = String(note.updated || 0);
      }
    });
}

/*
  LCP-Fix: die ersten sichtbaren Note-Cards sofort hydrieren,
  ohne auf den IntersectionObserver zu warten.
*/
function hydrateAboveTheFoldPreviews() {
  if (!root) return;
  const limit = window.innerHeight + 200;
  let eager = 0;
  for (const card of root.querySelectorAll('.yanta-dash-card.note-card[data-note-id]')) {
    if (eager >= EAGER_PREVIEW_COUNT) break;
    const r = card.getBoundingClientRect();
    if (r.top > limit) break;
    previewObserver?.unobserve(card);
    hydrateCardPreview(card, card.dataset.noteId, { eager: true }).catch(() => {});
    eager++;
  }
}
  
function renderDashboard({ animate = true, force = false } = {}) {
  if (dashboard.dragging) {
    forceCancelDashboardDrag('render-dashboard');
  }
  ensureDashboardRoot();

  if (dashboard.layoutCommitInProgress && !force) {
    return;
  }

  /*
    Der Child-Index wurde bisher praktisch nie invalidiert (Bug):
    Folder-Previews konnten veralten. Jetzt: pro Render frisch.
  */
  invalidateDashboardChildIndex();
  const items = getDashboardItems();
  const structureSig = dashboardStructureSignature(items);
  const hasPage = !!root.querySelector('.yanta-dashboard-page');
  if (!force && hasPage && structureSig === dashboard.lastStructureSig) {
    /*
      Struktur unverändert => KEIN replaceChildren().
      Scroll, Fokus, geladene Thumbnails und Animationszustand bleiben.
      Nur inhaltlich geänderte Cards werden gezielt neu hydriert.
      Das ist der Fix für den störenden Full-Rerender beim Zurückkommen
      aus einer Note.
    */
    refreshChangedDashboardCards();
    scheduleDashboardVisibleNoteAutofit({
      delay: 220,
    });
    return;
  }
  dashboard.lastStructureSig = structureSig;
  setupPreviewObserver();
  if (!animate) {
    suppressDashboardAnimationsFor(1200);
  }
  dashboardStaggerIndex = 0;
  root.replaceChildren();
  const page = el('div', { class: 'yanta-dashboard-page' });
  page.dataset.notesHeader = dashboardCardDisplay.notesShowHeader ? '1' : '0';
  page.dataset.foldersHeader = dashboardCardDisplay.foldersShowHeader ? '1' : '0';
  page.append(renderDashboardHeader());

  // Widgets live on the dashboard root only, never inside folders.
  // They fill in asynchronously and keep themselves fresh afterwards.
  if (!dashboard.folderId) {
    const widgetsHost = el('div', { class: 'yanta-dashboard-widgets' });
    page.append(widgetsHost);
    renderDashboardWidgetsInto(widgetsHost).catch(() => {});
  }

  const { pinnedNotes, normalItems } = items;
  const body = el('div', { class: 'yanta-dashboard-body' });
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
  hydrateAboveTheFoldPreviews();
  scheduleDashboardVisibleNoteAutofit({
    delay: 220,
  });
}

function renderDashboardHeader() {
  const header = el('header', { class: 'yanta-dashboard-head' });

  const menuBtn = el('button', {
    class: 'icon-btn yanta-dashboard-icon-btn yanta-dashboard-menu-btn',
    title: 'Open sidebar',
    onclick: () => {
      window.dispatchEvent(new CustomEvent('yanta-open-mobile-sidebar'));
    },
  });

  menuBtn.innerHTML = lucide('menu', 21);

  const titleWrap = el('div', { class: 'yanta-dashboard-title-wrap' });

  const path = currentFolderPath();

  const title = el('div', {
    class:
      'yanta-dashboard-title' +
      (dashboard.folderId ? ' can-rename' : ''),
    role: dashboard.folderId ? 'button' : null,
    tabindex: dashboard.folderId ? '0' : null,
    title: dashboard.folderId
      ? 'Tap to rename folder'
      : 'Notes',
  
    onclick: (e) => {
      if (!dashboard.folderId) return;
  
      e.preventDefault();
      e.stopPropagation();
  
      renameDashboardCurrentFolderTitle(e.currentTarget);
    },
  
    onkeydown: (e) => {
      if (!dashboard.folderId) return;
  
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
  
        renameDashboardCurrentFolderTitle(e.currentTarget);
      }
    },
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
      'data-dashboard-folder-crumb': f.id,
      onclick: () => navigateDashboardFolder(f.id),
    }, f.name || 'Folder'));
  }

  titleWrap.append(title, crumb);

  const searchBtn = el('button', {
    class: 'icon-btn yanta-dashboard-icon-btn',
    title: 'Search',
    onclick: () => {
      window.dispatchEvent(new CustomEvent('yanta-expand-sidebar-search'));
    },
  });

  searchBtn.innerHTML = lucide('search', 21);

  const newBtn = el('button', {
    class: 'btn primary yanta-dashboard-new-btn',
    title: 'Create',
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();

      openCreateMenu(e.currentTarget, {
        folderId: dashboard.folderId || null,
        source: 'dashboard',
        align: 'end',
        onAfterAction: (result) => {
          if (result?.type === 'note') {
            hideDashboard({
              push: false,
            });
          }
        },
      });
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

  applyDashboardStagger(card);

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

  if (item.kind === 'note') {
    card.dataset.updatedStamp = String(item.note.updated || 0);
  }

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

    previewHost.replaceChildren(
      renderDashboardPreviewSkeleton(item.note, {
        media: dashboardPreviewMayContainMedia(item.note),
      })
    );

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

    if (isPublicShareActive(publicShareStateForNote(note.id))) {
      const pub = el('span', {
        class: 'yanta-dash-note-corner-public',
        title: 'Public link active',
      });

      pub.innerHTML = lucide('share-2', 14);
      wrap.append(pub);
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

    if (item.folder.parentId) {
      actions.append(
        iconActionButton({
          icon: 'folder-up',
          title: 'Move folder up one level',
          onClick: () => moveDashboardFolderOutOfFolder(item.folder.id),
        })
      );
    }

    actions.append(
      iconActionButton({
        icon: 'trash',
        title: 'Delete folder',
        danger: true,
        onClick: () => deleteDashboardFolder(item.folder.id),
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

    const t = Date.now();

    note.pinned = !note.pinned;
    note.layoutUpdated = t;

    if (note.pinned && note.dashboardPinnedOrder == null) {
      note.dashboardPinnedOrder = t;
    }

    await store.notes.put(note);

    emit(EVT.NOTE_UPDATED, {
      noteId,
      reason: 'layout-change',
      source: 'dashboard',
    });

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
  
    emit(EVT.NOTE_UPDATED, {
      noteId: id,
      reason: 'note-created',
      source: 'dashboard',
    });
  
    toast('Note duplicated', 'success');
    renderDashboard();
  }
  
  async function deleteDashboardNote(noteId) {
    const note = state.notes.get(noteId);
    if (!note) return;

    await moveNoteToTrash(noteId, {
      source: 'dashboard',
      toastMessage: 'Moved note to Trash',
    });

    previewCache.delete(noteId);

    renderDashboard({
      animate: false,
    });
  }
    

  function collectDashboardFolderIdsRecursive(folderId) {
    const out = new Set();
    const stack = [folderId];

    while (stack.length) {
      const id = stack.pop();

      if (!id || out.has(id)) continue;

      out.add(id);

      for (const folder of state.folders.values()) {
        if (folder.parentId === id) {
          stack.push(folder.id);
        }
      }
    }

    return out;
  }

  function collectDashboardNoteIdsInsideFolders(folderIds) {
    const out = new Set();

    for (const note of state.notes.values()) {
      if (note.folderId && folderIds.has(note.folderId)) {
        out.add(note.id);
      }
    }

    return out;
  }

  async function deleteDashboardFolder(folderId) {
    const folder = state.folders.get(folderId);
    if (!folder) return;

    await moveFolderToTrash(folderId, {
      source: 'dashboard',
      toastMessage: 'Moved folder to Trash',
    });

    if (dashboard.folderId === folderId || dashboardFolderIsAncestor(folderId, dashboard.folderId)) {
      dashboard.folderId = null;
      state.dashboardFolderId = null;
    }

    renderDashboard({
      animate: false,
    });
  }

  async function moveDashboardNoteOutOfFolder(noteId) {
    const note = state.notes.get(noteId);
    if (!note || !note.folderId) return;
  
    note.folderId = null;
    note.updated = Date.now();
  
    await store.notes.put(note);
  
    previewCache.delete(noteId);
  
    emit(EVT.NOTE_UPDATED, {
      noteId,
      reason: 'metadata-save',
      source: 'dashboard',
    });
  
    toast('Moved to root', 'success');
    renderDashboard();
  }

async function moveDashboardFolderOutOfFolder(folderId) {
  const folder = state.folders.get(folderId);
  if (!folder || !folder.parentId) return;

  const parent = state.folders.get(folder.parentId);
  const nextParentId = parent?.parentId || null;

  /*
    Defensive cycle guard.
    Normalerweise kann das beim "eine Ebene hoch" nicht passieren,
    aber bei inkonsistenten Daten ist es besser, es abzufangen.
  */
  if (nextParentId && dashboardFolderIsAncestor(folder.id, nextParentId)) {
    toast('Cannot move folder into itself', 'error');
    return;
  }

  folder.parentId = nextParentId;
  folder.updated = Date.now();

  await store.folders.put(folder);

  if (nextParentId) {
    state.expandedFolders.add(nextParentId);
  }

  window.dispatchEvent(new CustomEvent('yanta-folder-updated', {
    detail: {
      folderId,
      moved: true,
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));

  toast(nextParentId ? 'Folder moved up one level' : 'Folder moved to root', 'success');

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
      const result = await renameFolderById(folderId, value, {
        refreshDashboard: false,
      });

      setTimeout(() => {
        endDashboardRename(card);
      }, 120);

      return result;
    },
  });
}

function renameDashboardCurrentFolderTitle(anchor) {
  const folder = currentFolder();

  if (!folder || !anchor) return;

  dashboard.suppressOpenUntil = performance.now() + 1200;

  inlineTextEdit(anchor, {
    initial: folder.name || 'Folder',
    placeholder: 'Folder name',
    emptyFallback: 'Folder',

    onCommit: async (value) => {
      return await renameFolderById(folder.id, value, {
        refreshDashboard: false,
      });
    },
  });
}
function syncDashboardFolderLabels(folderId) {
  if (!root || !folderId) return;

  const folder = state.folders.get(folderId);
  if (!folder) return;

  const name = folder.name || 'Folder';

  if (dashboard.folderId === folderId) {
    const title = root.querySelector('.yanta-dashboard-title');

    if (title && title.dataset.inlineEditing !== '1') {
      title.textContent = name;
      title.title = 'Tap to rename folder';
    }
  }

  root
    .querySelectorAll(
      `.yanta-dash-card[data-kind="folder"][data-folder-id="${CSS.escape(folderId)}"] .yanta-dash-card-title`
    )
    .forEach((node) => {
      if (node.dataset.inlineEditing === '1') return;

      node.textContent = name;
      node.title = name;
    });

  root
    .querySelectorAll(
      `[data-dashboard-folder-crumb="${CSS.escape(folderId)}"]`
    )
    .forEach((node) => {
      node.textContent = name;
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
  const { foldersByParent, notesByFolder } = dashboardChildren();
  const folders = (foldersByParent.get(folderId) || []).map((folder) => ({
    kind: 'folder',
    id: folder.id,
    folder,
    title: folder.name || 'Folder',
    icon: defaultIconForFolder(folder),
    color: safeCssColor(folder.color) || '',
    order: fallbackOrderForFolder(folder),
  }));
  const notes = (notesByFolder.get(folderId) || []).map((note) => ({
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
  const { foldersByParent, notesByFolder } = dashboardChildren();
  const folders = (foldersByParent.get(folderId) || []).length;
  const notes = (notesByFolder.get(folderId) || []).length;
  return { folders, notes, total: folders + notes };
}

function folderDirectCount(folderId) {
  return folderDirectBreakdown(folderId).total;
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

  previewHost.replaceChildren(renderDashboardFolderMiniSkeleton());

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
  host.dataset.updatedStamp = String(note.updated || 0);

  /*
    Nicht vor dem await auf isConnected abbrechen:
    Beim ersten Render hängt host ggf. noch nicht im DOM.
    Nach dem Laden prüfen wir aber wieder, damit alte Render nicht schreiben.
  */
  const preview = await getDashboardPreview(note);

  if (!host.isConnected) return;

  host.replaceChildren();

  if (!preview.blocks.length && !preview.badges.length) {
    if (dashboardNoteLooksTemporarilyEmpty(note, {
      preview,
      eventHeader: null,
    })) {
      host.append(renderDashboardFolderMiniSkeleton());
    } else {
      host.append(el('div', {
        class: 'yanta-dash-folder-mini-empty',
      }, 'Empty note'));
    }

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

  media.innerHTML = `${lucide('line-squiggle', 12)} <span>Drawing</span>`;

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
  
  // ============================================================
  // Preview extraction
  // ============================================================
  
async function hydrateCardPreview(card, noteId, { eager = false } = {}) {
    const note = state.notes.get(noteId);
    if (!note || !card.isConnected) return;

    card.dataset.updatedStamp = String(note.updated || 0);

    const host = card.querySelector('[data-preview-host]');
    if (!host) return;

    const [preview, eventHeader] = await Promise.all([
      getDashboardPreview(note),
      dashboardLinkedEventHeader(note.id),
    ]);
    if (!card.isConnected || !host.isConnected) return;
    host.classList.toggle('is-media-only', !!preview.mediaOnly && !eventHeader);
    host.replaceChildren();
    if (eventHeader) {
      host.append(eventHeader);
    }
    if (!preview.blocks.length && !preview.badges.length && !eventHeader) {
      if (dashboardNoteLooksTemporarilyEmpty(note, {
        preview,
        eventHeader,
      })) {
        host.append(
          renderDashboardPreviewSkeleton(note, {
            media: dashboardPreviewMayContainMedia(note),
          })
        );
      } else {
        host.append(el('div', {
          class: 'yanta-dash-empty-preview',
        }, 'Empty note'));
      }
      fitDashboardNoteCardToRenderedPreview(card, note, host);
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
        host.append(await renderDashboardImage(block, { eager }));
        continue;
      }

      if (block.type === 'video') {
        host.append(renderDashboardVideo(block));
        continue;
      }

      if (block.type === 'drawing') {
        host.append(renderDashboardDrawing(noteId, block, { eager }));
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
    fitDashboardNoteCardToRenderedPreview(card, note, host);
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
        
      await toggleTaskLineInNote(noteId, task.line, cb.checked, {
        source: 'dashboard',
      });
      
      previewCache.delete(noteId);
  
      const card = root?.querySelector(`.yanta-dash-card[data-note-id="${CSS.escape(noteId)}"]`);
  
      if (card) {
        await hydrateCardPreview(card, noteId);
      }
    });
  
    row.append(cb, el('span', {}, task.text || 'Task'));
  
    return row;
  }
  
async function renderDashboardImage(block, { eager = false } = {}) {
    const wrap = el('div', { class: 'yanta-dash-media yanta-dash-image' });

    const img = el('img', {
      alt: block.alt || '',
      loading: eager ? 'eager' : 'lazy',
      fetchpriority: eager ? 'high' : 'auto',
      decoding: 'async',
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

function reserveDashboardDrawingPreviewSpace(wrap) {
  if (!wrap) return;

  wrap.style.aspectRatio = `${DASHBOARD_DRAWING_THUMB_W} / ${DASHBOARD_DRAWING_THUMB_H}`;
  wrap.style.minHeight = '118px';
  wrap.style.overflow = 'hidden';

  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
}

async function replaceWithFadeInImage(wrap, img) {
  if (!wrap || !img) return;
  if (!wrap.isConnected) return;

  /*
    Wichtig:
    Wenn das Bild noch nicht dekodiert ist, läuft die Opacity-Transition
    sonst oft ins Leere und das Bild ploppt danach abrupt auf.
  */
  try {
    if (typeof img.decode === 'function') {
      await img.decode();
    }
  } catch {
    /*
      decode() kann bei SVG/Data-URLs je nach Browser fehlschlagen.
      Dann trotzdem weiter.
    */
  }

  if (!wrap.isConnected) return;

  img.style.opacity = '0';
  img.style.transition = 'opacity 180ms ease';
  img.style.willChange = 'opacity';

  wrap.replaceChildren(img);
  wrap.classList.remove('is-loading');

  /*
    Layout-Flush: Browser muss opacity:0 wirklich gesehen haben,
    bevor wir auf opacity:1 wechseln.
  */
  img.getBoundingClientRect();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!img.isConnected) return;

      img.style.opacity = '1';

      window.setTimeout(() => {
        if (!img.isConnected) return;

        img.style.willChange = '';
      }, 220);
    });
  });
}

function renderDashboardDrawing(noteId, block, { eager = false } = {}) {
  const wrap = el('div', {
    class: 'yanta-dash-media yanta-dash-drawing-thumb is-loading',
  });
  reserveDashboardDrawingPreviewSpace(wrap);
  wrap.append(el('div', {
    class: 'yanta-dash-drawing-placeholder',
    'aria-hidden': 'true',
  }));
  import('./draw.js')
    .then(async ({ drawingThumbnailUrl }) => {
      const hit = findDrawing(block.id, noteId);
      if (!hit || !wrap.isConnected) return;
      const url = await drawingThumbnailUrl(hit.noteId, block.id);
      if (!url || !wrap.isConnected) return;
      const img = el('img', {
        src: url,
        alt: 'Drawing',
        loading: 'eager',
        fetchpriority: eager ? 'high' : 'auto',
        decoding: 'async',
        draggable: 'false',
        class: 'yanta-dash-drawing-img',
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          border: '0',
        },
      });
      await replaceWithFadeInImage(wrap, img);
    })
    .catch((err) => {
      console.warn('[YANTA Dashboard] Drawing thumbnail failed', err);
      if (!wrap.isConnected) return;
      wrap.classList.remove('is-loading');
      wrap.replaceChildren(
        el('div', {
          class: 'yanta-dash-drawing-placeholder is-error',
        }, 'Drawing')
      );
    });
  return wrap;
}
  
async function resolveDashboardImageUrl(url) {
  const raw = String(url || '');

  if (!raw.startsWith('yanta-img://')) {
    return raw;
  }

  const id = raw.slice('yanta-img://'.length);

  const cached = getImageObjectUrl(id);
  if (cached) return cached;

  try {
    const rec = await store.images.get(id);

    if (rec?.blob) {
      return putImageObjectUrl(id, rec.blob);
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
      if (blocks.length < DASHBOARD_PREVIEW_MAX_BLOCKS) {
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

async function openDashboardCalendarEventFromHeader(header) {
  const eventId = header?.dataset?.calendarEventId || '';

  if (!eventId) return false;

  try {
    dashboard.suppressOpenUntil = performance.now() + 800;

    const calendar = await calendarModule();

    calendar.openCalendarEvent?.(eventId, {
      push: true,
    });

    return true;
  } catch (err) {
    console.warn('[YANTA Dashboard] Could not open calendar event', err);
    toast('Could not open calendar event', 'error');
    return false;
  }
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

  dashboard.suppressStagger = true;

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

  dashboard.suppressStagger = false;
  dashboard.suppressOpenUntil = performance.now() + 350;
}

  async function openItem(item, card, {
    ignoreSuppress = false,
  } = {}) {
    if (!ignoreSuppress && performance.now() < (dashboard.suppressOpenUntil || 0)) return;
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

  export async function openNoteFromDashboardHistory(noteId) {
    ensureDashboardRoot();

    if (!noteId || !state.notes.has(noteId)) return;

    const card = findDashboardNoteCard(noteId);

    if (!dashboard.visible || !document.startViewTransition || prefersReducedMotion()) {
      hideDashboard({ push: false });
      await openNote(noteId);
      return;
    }

    /*
      Best case:
      visible dashboard card -> note panes.
    */
    if (card) {
      await openNoteFromDashboard(noteId, card);
      return;
    }

    /*
      Fallback:
      dashboard page -> note panes.
      This covers history forward/back routes where the note is not visible
      as a card in the current dashboard folder.
    */
    dashboard.internalOpeningNote = true;

    const transitionName = transitionNameFor('note', noteId);
    const sourcePage = dashboardPage();
    let target = null;

    try {
      if (sourcePage) {
        sourcePage.style.viewTransitionName = transitionName;
        sourcePage.style.contain = 'layout paint';
        sourcePage.classList.add('is-note-transition-source');
      }

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
    } finally {
      dashboard.internalOpeningNote = false;

      if (sourcePage) {
        sourcePage.style.viewTransitionName = '';
        sourcePage.style.contain = '';
        sourcePage.classList.remove('is-note-transition-source');
      }

      if (target) {
        target.style.viewTransitionName = '';
        target.style.contain = '';
        target.classList.remove('is-note-transition-target');
      }
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
// Long press, robust live-displacement drag reorder, resize
// ============================================================

function preventIfCancelable(e) {
  if (e?.cancelable) {
    e.preventDefault();
  }
}

function isTouchPointerType(pointerType) {
  return pointerType === 'touch';
}

function gesturePoint(clientX, clientY, {
  pointerId = null,
  pointerType = '',
} = {}) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType,
  };
}

function primaryChangedTouch(e) {
  return e.changedTouches?.[0] || null;
}

function findTouchById(list, id) {
  if (!list) return null;

  for (const touch of list) {
    if (touch.identifier === id) {
      return touch;
    }
  }

  return null;
}

function dashboardGestureTargetIsControl(target, eventHeader = null) {
  if (eventHeader) return false;

  return !!target?.closest?.(
    'input, button, a, textarea, select, iframe, .yanta-dash-resize-handle'
  );
}

function cleanupDashboardDragDom(d = dashboard.dragging) {
  endAiContextDashboardDragHover();

  if (d) {
    if (d.raf) {
      cancelAnimationFrame(d.raf);
      d.raf = 0;
    }

    if (d.scrollRaf) {
      cancelAnimationFrame(d.scrollRaf);
      d.scrollRaf = 0;
    }

    if (d.scaleRaf) {
      cancelAnimationFrame(d.scaleRaf);
      d.scaleRaf = 0;
    }

    d.crumple?.destroy?.();
    d.clone?.remove();

    d.source?.classList.remove('drag-source');
    if (d.source) {
      d.source.style.viewTransitionName = '';
    }
  }

  clearDragVisuals();
  hideTrashDropTarget();
  setTrashDropTargetHot(false);

  root?.classList.remove('is-card-dragging');

  document
    .querySelectorAll('.yanta-dash-card.drag-clone')
    .forEach((node) => node.remove());

  root
    ?.querySelectorAll('.yanta-dash-card.drag-source')
    ?.forEach((node) => {
      node.classList.remove('drag-source');
      node.style.viewTransitionName = '';
    });
}

function forceCancelDashboardDrag(reason = 'unknown') {
  if (!dashboard.dragging) {
    cleanupDashboardDragDom(null);
    return;
  }

  const d = dashboard.dragging;
  dashboard.dragging = null;

  cleanupDashboardDragDom(d);

  dashboard.suppressOpenUntil = performance.now() + 650;

  if (reason !== 'silent') {
    console.warn('[YANTA Dashboard] Drag force-cancelled:', reason);
  }
}

function repairDashboardDragInvariants() {
  if (dashboard.dragging) return;

  cleanupDashboardDragDom(null);
}

function shouldIgnoreSyntheticMouseAfterTouch() {
  return performance.now() < (dashboard.suppressOpenUntil || 0);
}

function bindCardPointerInteractions(card, item) {
  let pressTimer = 0;
  let mouseGesture = null;
  let touchGesture = null;

  const key = itemKey(item);

  const clearPressTimer = () => {
    clearTimeout(pressTimer);
    pressTimer = 0;
  };

  const selectInPlace = ({
    syncMultiSelect = false,
  } = {}) => {
    dashboard.selectedKey = key;

    root
      ?.querySelectorAll('.yanta-dash-card.selected')
      ?.forEach((node) => {
        if (node !== card) node.classList.remove('selected');
      });

    card.classList.add('selected');

    try {
      card.focus({ preventScroll: true });
    } catch {
      card.focus();
    }

    if (syncMultiSelect) {
      window.dispatchEvent(new CustomEvent('yanta-dashboard-select-key', {
        detail: {
          key,
          mode: 'only',
          source: 'dashboard-longpress',
        },
      }));
    }
  };

  const startLongPressTimer = ({
    pointerId,
    pointerType,
    isTouch,
  }) => {
    clearPressTimer();

    pressTimer = window.setTimeout(() => {
      const gesture = isTouch ? touchGesture : mouseGesture;

      if (!gesture) return;
      if (gesture.pointerId !== pointerId) return;
      if (gesture.dragStarted) return;
      if (gesture.scrolledAway) return;

      gesture.longPressed = true;

      selectInPlace({
        syncMultiSelect:
          pointerType === 'mouse' &&
          !isMobile(),
      });

      dashboard.suppressOpenUntil = performance.now() + 600;

      try {
        navigator.vibrate?.(10);
      } catch {}
    }, LONG_PRESS_MS);
  };

  const cleanupMouseGesture = () => {
    clearPressTimer();

    document.removeEventListener('pointermove', onMouseMove, true);
    document.removeEventListener('pointerup', onMouseUp, true);
    document.removeEventListener('pointercancel', onMouseCancel, true);

    mouseGesture = null;
  };

  const cleanupTouchGesture = () => {
    clearPressTimer();

    document.removeEventListener('touchmove', onTouchMove, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchCancel, true);

    touchGesture = null;
  };

  card.addEventListener('contextmenu', (e) => {
    if (!dashboard.visible) return;

    e.preventDefault();
    e.stopPropagation();
  }, true);

  /*
    Desktop / Mouse / non-touch pointer.
    Touch wird bewusst NICHT hier behandelt, sondern über Touch Events.
  */
  card.addEventListener('pointerdown', (e) => {
    if (!dashboard.visible) return;
    if (e.button != null && e.button !== 0) return;
    if (dashboard.resize || dashboard.dragging) return;
    if (isTouchPointerType(e.pointerType)) return;
    if (shouldIgnoreSyntheticMouseAfterTouch()) return;

    const eventHeader = e.target.closest?.(
      '.yanta-dash-event-header[data-calendar-event-id]'
    );

    if (dashboardGestureTargetIsControl(e.target, eventHeader)) {
      return;
    }

    preventIfCancelable(e);
    e.stopPropagation();

    mouseGesture = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'mouse',
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
      longPressed: false,
      dragStarted: false,
      scrolledAway: false,
      eventHeader,
    };

    startLongPressTimer({
      pointerId: e.pointerId,
      pointerType: mouseGesture.pointerType,
      isTouch: false,
    });

    document.addEventListener('pointermove', onMouseMove, true);
    document.addEventListener('pointerup', onMouseUp, true);
    document.addEventListener('pointercancel', onMouseCancel, true);
  }, { passive: false });

  function onMouseMove(e) {
    const g = mouseGesture;
    if (!g || e.pointerId !== g.pointerId) return;

    const dx = e.clientX - g.downX;
    const dy = e.clientY - g.downY;
    const dist = Math.hypot(dx, dy);

    if (dashboard.dragging?.key === key) {
      preventIfCancelable(e);
      e.stopPropagation();

      moveCardDrag(e);
      return;
    }

    if (dist <= MOVE_TOLERANCE) {
      return;
    }

    g.moved = true;

    preventIfCancelable(e);
    e.stopPropagation();

    clearPressTimer();

    if (!g.longPressed) {
      g.longPressed = true;
      selectInPlace();
    }

    if (!g.dragStarted) {
      g.dragStarted = true;
      dashboard.suppressOpenUntil = performance.now() + 900;

      startCardDrag(card, item, gesturePoint(e.clientX, e.clientY, {
        pointerId: e.pointerId,
        pointerType: g.pointerType,
      }));
    }
  }

  async function onMouseUp(e) {
    const g = mouseGesture;
    if (!g || e.pointerId !== g.pointerId) return;

    const wasDragging = dashboard.dragging?.key === key;
    const snapshot = { ...g };

    if (wasDragging) {
      preventIfCancelable(e);
      e.stopPropagation();
    }

    cleanupMouseGesture();

    if (wasDragging) {
      await finishCardDrag();
      dashboard.suppressOpenUntil = performance.now() + 750;
      return;
    }

    if (snapshot.longPressed && !snapshot.dragStarted) {
      selectInPlace();
      dashboard.suppressOpenUntil = performance.now() + 350;
      return;
    }

    if (!snapshot.moved && !snapshot.longPressed) {
      if (snapshot.eventHeader?.isConnected) {
        await openDashboardCalendarEventFromHeader(snapshot.eventHeader);
        return;
      }

      await openItem(item, card);
    }
  }

  function onMouseCancel(e) {
    const g = mouseGesture;
    if (!g || e.pointerId !== g.pointerId) return;

    const wasDragging = dashboard.dragging?.key === key;

    cleanupMouseGesture();

    if (wasDragging) {
      forceCancelDashboardDrag('mouse-pointercancel');
    }
  }

  /*
    Mobile Touch.
    Native Scroll bleibt vor Longpress vollständig beim Browser.
    Nach Longpress wird die nächste Bewegung als intentionaler Drag behandelt.
  */
  card.addEventListener('touchstart', (e) => {
    if (!dashboard.visible) return;
    if (dashboard.resize || dashboard.dragging) return;
    if (e.touches.length !== 1) return;

    const touch = e.changedTouches?.[0];
    if (!touch) return;

    const target =
      document.elementFromPoint(touch.clientX, touch.clientY) ||
      e.target;

    const eventHeader = target.closest?.(
      '.yanta-dash-event-header[data-calendar-event-id]'
    );

    if (dashboardGestureTargetIsControl(target, eventHeader)) {
      return;
    }

    /*
      Kein preventDefault:
      Vor Longpress soll Scrollen 100% nativ und flüssig bleiben.
    */
    e.stopPropagation();

    touchGesture = {
      pointerId: touch.identifier,
      pointerType: 'touch',
      downX: touch.clientX,
      downY: touch.clientY,
      moved: false,
      longPressed: false,
      dragStarted: false,
      scrolledAway: false,
      eventHeader,
    };

    startLongPressTimer({
      pointerId: touch.identifier,
      pointerType: 'touch',
      isTouch: true,
    });

    document.addEventListener('touchmove', onTouchMove, {
      capture: true,
      passive: false,
    });

    document.addEventListener('touchend', onTouchEnd, {
      capture: true,
      passive: false,
    });

    document.addEventListener('touchcancel', onTouchCancel, {
      capture: true,
      passive: false,
    });
  }, { passive: true });

  function onTouchMove(e) {
    const g = touchGesture;
    if (!g) return;

    const touch =
      findTouchById(e.touches, g.pointerId) ||
      findTouchById(e.changedTouches, g.pointerId);

    if (!touch) return;

    const dx = touch.clientX - g.downX;
    const dy = touch.clientY - g.downY;
    const dist = Math.hypot(dx, dy);

    if (dashboard.dragging?.key === key) {
      if (!e.cancelable) {
        forceCancelDashboardDrag('touchmove-not-cancelable-during-drag');
        cleanupTouchGesture();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      moveCardDrag(gesturePoint(touch.clientX, touch.clientY, {
        pointerId: g.pointerId,
        pointerType: 'touch',
      }));

      return;
    }

    if (dist <= MOVE_TOLERANCE) {
      /*
        Nach Longpress kleine Bewegungen blocken, damit der Browser nicht
        verspätet noch eine Scroll-Geste übernimmt.
      */
      if (g.longPressed) {
        if (!e.cancelable) {
          g.scrolledAway = true;
          cleanupTouchGesture();
          return;
        }

        e.preventDefault();
        e.stopPropagation();
      }

      return;
    }

    g.moved = true;

    /*
      Bewegung VOR Longpress = native Scroll.
      Wir geben die Geste komplett frei.
    */
    if (!g.longPressed) {
      g.scrolledAway = true;
      dashboard.suppressOpenUntil = performance.now() + 250;
      cleanupTouchGesture();
      return;
    }

    /*
      Bewegung NACH Longpress = intentionaler Drag.
      Wenn der Browser sie nicht mehr cancelbar macht, starten wir keinen Drag.
    */
    if (!e.cancelable) {
      g.scrolledAway = true;
      dashboard.suppressOpenUntil = performance.now() + 250;
      cleanupTouchGesture();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    clearPressTimer();

    if (!g.dragStarted) {
      g.dragStarted = true;
      dashboard.suppressOpenUntil = performance.now() + 900;

      const started = startCardDrag(card, item, gesturePoint(touch.clientX, touch.clientY, {
        pointerId: g.pointerId,
        pointerType: 'touch',
      }));

      if (!started) {
        g.dragStarted = false;
        cleanupTouchGesture();
      }
    }
  }

  async function onTouchEnd(e) {
    const g = touchGesture;
    if (!g) return;

    const touch = findTouchById(e.changedTouches, g.pointerId);
    if (!touch) return;

    const wasDragging = dashboard.dragging?.key === key;
    const snapshot = { ...g };

    if (wasDragging) {
      preventIfCancelable(e);
      e.stopPropagation();

      moveCardDrag(gesturePoint(touch.clientX, touch.clientY, {
        pointerId: g.pointerId,
        pointerType: 'touch',
      }));
    }

    cleanupTouchGesture();

    /*
      Suppress synthetic mouse/click after touch.
    */
    dashboard.suppressOpenUntil = Math.max(
      dashboard.suppressOpenUntil || 0,
      performance.now() + 450
    );

    if (wasDragging) {
      await finishCardDrag();
      dashboard.suppressOpenUntil = performance.now() + 750;
      return;
    }

    if (snapshot.scrolledAway) {
      return;
    }

    if (snapshot.longPressed && !snapshot.dragStarted) {
      selectInPlace();
      dashboard.suppressOpenUntil = performance.now() + 350;
      return;
    }

    if (!snapshot.moved && !snapshot.longPressed) {
      if (snapshot.eventHeader?.isConnected) {
        await openDashboardCalendarEventFromHeader(snapshot.eventHeader);
        return;
      }

      await openItem(item, card, {
        ignoreSuppress: true,
      });
    }
  }

  function onTouchCancel(e) {
    const g = touchGesture;
    if (!g) return;

    const touch =
      findTouchById(e.changedTouches, g.pointerId) ||
      primaryChangedTouch(e);

    if (!touch) return;

    const wasDragging = dashboard.dragging?.key === key;

    cleanupTouchGesture();

    if (wasDragging) {
      forceCancelDashboardDrag('touchcancel');
    }
  }

  card.addEventListener('keydown', async (e) => {
    if (isEditableDashboardKeyTarget(e.target)) {
      return;
    }

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

function dragCloneScale(d) {
  const n = Number(d?.currentScale);

  if (Number.isFinite(n) && n > 0) {
    return n;
  }

  if (d?.trashCrumplePreview) {
    return DRAG_TRASH_PREVIEW_SCALE;
  }

  if (d?.folderInsertPreview) {
    return DRAG_FOLDER_INSERT_PREVIEW_SCALE;
  }

  return 1;
}

function dragScaleEase(t) {
  /*
    Smooth ease-out. Wir animieren bewusst in JS, weil CSS transition auf
    transform auch die Pointer-Position verzögern würde.
  */
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

function positionDragClone(d) {
  if (!d?.clone) return;

  const scale = dragCloneScale(d);

  /*
    Wichtig:
    Bei scale < 1 muss der gegriffene Punkt mit dem AKTUELLEN Scale
    mitgerechnet werden. Dadurch bleibt der Grabpunkt auch während der
    Shrink-Animation exakt unter dem Cursor.
  */
  const left = d.lastX - d.offsetX * scale;
  const top = d.lastY - d.offsetY * scale;

  d.clone.style.setProperty(
    'transform',
    `translate3d(${left - d.startLeft}px, ${top - d.startTop}px, 0) scale(${scale})`,
    'important'
  );
}

function animateDragCloneScale(d, toScale) {
  if (!d?.clone) return;

  if (d.scaleRaf) {
    cancelAnimationFrame(d.scaleRaf);
    d.scaleRaf = 0;
  }

  const fromScale = dragCloneScale(d);
  const targetScale = Number(toScale) || 1;

  d.targetScale = targetScale;

  if (Math.abs(fromScale - targetScale) < 0.001) {
    d.currentScale = targetScale;
    positionDragClone(d);
    return;
  }

  const start = performance.now();
  const duration = 170;

  const tick = () => {
    /*
      Drag wurde beendet/abgebrochen.
      Dann keine Scale-Animation mehr weiterlaufen lassen.
    */
    if (dashboard.dragging !== d) {
      d.scaleRaf = 0;
      return;
    }

    const t = clamp((performance.now() - start) / duration, 0, 1);
    const eased = dragScaleEase(t);

    d.currentScale = fromScale + (targetScale - fromScale) * eased;

    positionDragClone(d);

    if (t < 1) {
      d.scaleRaf = requestAnimationFrame(tick);
      return;
    }

    d.currentScale = targetScale;
    d.targetScale = targetScale;
    d.scaleRaf = 0;

    positionDragClone(d);
  };

  d.scaleRaf = requestAnimationFrame(tick);
}

function setDragFolderInsertPreview(active) {
  const d = dashboard.dragging;
  if (!d?.clone) return;

  const next = !!active;

  if (d.folderInsertPreview === next) {
    return;
  }

  d.folderInsertPreview = next;
  d.clone.classList.toggle('folder-insert-preview', next);

  animateDragCloneScale(
    d,
    next ? DRAG_FOLDER_INSERT_PREVIEW_SCALE : 1
  );
}

function ensureDragCrumpleController(d) {
  if (!d?.clone) return null;

  if (d.crumple) {
    return d.crumple;
  }

  d.crumple = createDashboardCrumpleController(d.clone, {
    maxProgress: 0.42,
  });

  return d.crumple;
}

function destroyDragCrumpleController(d) {
  if (!d) return;

  d.crumple?.destroy?.();
  d.crumple = null;
}

function setDragTrashCrumplePreview(active, {
  immediate = false,
} = {}) {
  const d = dashboard.dragging;
  if (!d?.clone) return;

  const next = !!active;

  if (d.trashCrumplePreview === next && !immediate && (!next || d.crumple)) {
    return;
  }

  d.trashCrumplePreview = next;

  if (next) {
    ensureDragCrumpleController(d);
    d.clone.classList.add('is-trash-crumple-preview');
  }

  d.crumple?.setActive?.(next, {
    immediate,
  });

  animateDragCloneScale(
    d,
    next ? DRAG_TRASH_PREVIEW_SCALE : 1
  );

  if (!next) {
    window.setTimeout(() => {
      if (dashboard.dragging !== d) return;
      if (d.trashCrumplePreview) return;

      destroyDragCrumpleController(d);
      d.clone?.classList.remove('is-trash-crumple-preview');
    }, 180);
  }
}

async function animateTrashDropCrumple(d) {
  if (!d?.clone || prefersReducedMotion()) return;

  const clone = d.clone;

  ensureDragCrumpleController(d);

  d.crumple?.setActive?.(true, {
    immediate: true,
  });

  clone.classList.add('is-trash-crumple-preview');

  const rect = clone.getBoundingClientRect();

  clone.style.setProperty('transform', 'none', 'important');
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.transformOrigin = 'center center';

  const anim = clone.animate(
    [
      {
        transform: 'scale(1) translate3d(0, 0, 0)',
        opacity: '0.96',
        filter: 'saturate(.96) brightness(.98) blur(0)',
      },
      {
        transform: 'scale(.72) translate3d(0, 12px, 0)',
        opacity: '0',
        filter: 'saturate(.72) brightness(.82) blur(1.2px)',
      },
    ],
    {
      duration: 170,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'forwards',
    }
  );

  await Promise.race([
    anim.finished.catch(() => {}),
    delay(230),
  ]);
}

function dashboardFolderIsAncestor(ancestorId, descendantId) {
  if (!ancestorId || !descendantId) return false;

  let cur = state.folders.get(descendantId);
  const seen = new Set();

  while (cur && !seen.has(cur.id)) {
    if (cur.id === ancestorId) return true;

    seen.add(cur.id);
    cur = cur.parentId ? state.folders.get(cur.parentId) : null;
  }

  return false;
}

function dragAnimElements(grid) {
  return [...grid.children].filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.classList.contains('drag-clone')) return false;

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

function prepareDashboardGridForDragAnimation(grid) {
  if (!grid) return;

  const cards = [...grid.querySelectorAll('.yanta-dash-card')];

  for (const card of cards) {
    /*
      Wichtig:
      Nach Reload kann die progressive Dashboard-Stagger-Animation noch
      als CSS Animation mit fill-mode "both" auf transform wirken.
      Das blockiert/überlagert beim ersten Drag die FLIP-Animation.
    */
    card.classList.remove('yanta-stagger-item');

    try {
      card.getAnimations?.().forEach((anim) => {
        try {
          anim.cancel();
        } catch {}
      });
    } catch {}

    card.style.animation = 'none';
    card.style.transform = '';
    card.style.filter = '';
    card.style.opacity = '';
    card.style.willChange = 'transform';
  }

  /*
    Layout einmal synchron messen, damit Browser/Style-Engine vor der ersten
    FLIP-Mutation einen stabilen Ausgangszustand hat.
  */
  try {
    grid.getBoundingClientRect();
  } catch {}

  requestAnimationFrame(() => {
    for (const card of cards) {
      if (!card.isConnected) continue;

      card.style.animation = '';
      card.style.willChange = '';
    }
  });
}

function startCardDrag(card, item, point) {
  if (dashboard.dragging) {
    forceCancelDashboardDrag('new-drag-start');
  }

  window.dispatchEvent(new CustomEvent('yanta-close-dashboard-context-menu'));

  document
    .querySelectorAll('.yanta-dash-card.drag-clone')
    .forEach((node) => node.remove());

  hideTrashDropTarget();
  setTrashDropTargetHot(false);

  const grid = card.closest('.yanta-dashboard-grid');
  if (!grid) return false;

  prepareDashboardGridForDragAnimation(grid);

  const key = itemKey(item);
  const rect = card.getBoundingClientRect();

  const grabX = clamp(point.clientX - rect.left, 0, rect.width);
  const grabY = clamp(point.clientY - rect.top, 0, rect.height);

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
    transformOrigin: 'top left',
  });

  clone.style.setProperty(
    'transform',
    'translate3d(0,0,0) scale(1)',
    'important'
  );

  document.body.append(clone);

  card.classList.add('drag-source');
  card.classList.remove('selected');
  card.style.viewTransitionName = 'none';

  root?.classList.add('is-card-dragging');
  showTrashDropTarget();

  dashboard.suppressOpenUntil = performance.now() + 900;
  suppressDashboardStaggerFor(1400);

  dashboard.dragging = {
    key,
    pointerId: point.pointerId,
    pointerType: point.pointerType || '',
    section: card.dataset.section || '',
    grid,
    source: card,
    clone,

    sourceKind: item.kind,
    sourceId: item.id,

    originalParentId:
      item.kind === 'note'
        ? (item.note.folderId || null)
        : (item.folder.parentId || null),

    width: rect.width,
    height: rect.height,

    startLeft: rect.left,
    startTop: rect.top,

    offsetX: grabX,
    offsetY: grabY,

    lastX: point.clientX,
    lastY: point.clientY,

    raf: 0,
    scrollRaf: 0,

    dropFolderId: null,
    folderInsertPreview: false,
    dropToTrash: false,
    crumple: null,
    trashCrumplePreview: false,

    currentScale: 1,
    targetScale: 1,
    scaleRaf: 0,

    lastInsertSignature: '',
    lastCandidateSignature: '',
    candidateSince: 0,

    lastAcceptedIndex: visualIndexOfSource(grid, card),

    lastReorderAt: 0,
    lastReorderX: point.clientX,
    lastReorderY: point.clientY,

    reorderLockUntil: 0,
    reorderLockRect: null,
  };

  moveCardDrag(point);
  return true;
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

    /*
      Position + Scale müssen in EINEM transform sitzen.
      CSS scale separat führt zu dem Links/Rechts-Versatz.
    */
    positionDragClone(cur);

    updateLiveDragPlacement(cur.lastX, cur.lastY);
  });
}

function updateLiveDragPlacement(clientX, clientY) {
  const d = dashboard.dragging;
  if (!d) return;
  emitAiContextDashboardDragHover(d, clientX, clientY);

  clearDragVisuals();
  d.dropFolderId = null;

  const overTrash = isPointOverTrashDropTarget(clientX, clientY);

  setTrashDropTargetHot(overTrash);

  if (overTrash) {
    d.dropToTrash = true;

    /*
      Trash hat Priorität:
      - kein Folder-Preview
      - Crumple aktiv
      - gleiche Scale wie Folder-Drop
    */
    setDragFolderInsertPreview(false);
    setDragTrashCrumplePreview(true);

    d.clone.classList.add('is-over-trash');

    return;
  }

  d.dropToTrash = false;
  setDragTrashCrumplePreview(false);

  d.clone.classList.remove('is-over-trash');

  /*
    Folder-Drop bleibt pointerbasiert:
    Man will in den sichtbaren Folder droppen, nicht anhand des Clone-Zentrums.
  */
  if (updateFolderDropTarget(clientX, clientY)) {
    setDragFolderInsertPreview(true);

    d.lastInsertSignature = 'folder:' + d.dropFolderId;
    return;
  }

  /*
    Sobald kein Folder-Drop aktiv ist, den Clone wieder normal groß machen.
  */
  setDragFolderInsertPreview(false);

  /*
    Reorder bleibt clone-center-basiert.
  */
  updateSourcePosition(clientX, clientY);
}

function updateFolderDropTarget(clientX, clientY) {
  const d = dashboard.dragging;
  if (!d) return false;

  const below = document.elementFromPoint(clientX, clientY);
  const folderTarget = below?.closest?.('.yanta-dash-card[data-kind="folder"]');

  if (!folderTarget) return false;
  if (!folderTarget.isConnected) return false;
  if (folderTarget.classList.contains('drag-source')) return false;

  const folderId = folderTarget.dataset.folderId;
  if (!folderId) return false;

  /*
    Folder in Folder:
    - erlaubt für Notes und Folder
    - blockiert self-drop und Zyklusbildung
  */
  if (d.sourceKind === 'folder') {
    if (folderId === d.sourceId) return false;
    if (dashboardFolderIsAncestor(d.sourceId, folderId)) return false;
  }

  const r = folderTarget.getBoundingClientRect();
  const yRatio = (clientY - r.top) / Math.max(1, r.height);
  const xRatio = (clientX - r.left) / Math.max(1, r.width);

  /*
    Google-Keep-artige Zonen:
    Mitte = in Ordner droppen.
    Randbereiche = normale Reorder-Zonen.
  */
  if (
    yRatio < 0.34 ||
    yRatio > 0.66 ||
    xRatio < 0.20 ||
    xRatio > 0.80
  ) {
    return false;
  }

  folderTarget.classList.add('folder-drop-target');
  d.dropFolderId = folderId;

  return true;
}

function updateSourcePosition(clientX, clientY) {
  const d = dashboard.dragging;
  if (!d) return;

  const pointerGrid = document
    .elementFromPoint(clientX, clientY)
    ?.closest?.('.yanta-dashboard-grid');

  /*
    Keine Cross-Section-Sprünge.
    Pinned / Normal bleiben getrennte Grid-Listen.
  */
  if (pointerGrid && pointerGrid !== d.grid) {
    return;
  }

  const center = dragCloneCenter(d, clientX, clientY);
  const target = findBestInsertionTarget(d.grid, center.x, center.y);

  if (!target) return;

  if (target.markerCard) {
    target.markerCard.classList.add(
      target.markerPlace === 'before'
        ? 'insert-before'
        : 'insert-after'
    );
  }

  /*
    Der Index entspricht bereits der visuellen 2D-Insertion-Position.
    Wenn sich der Index nicht ändert, nichts tun.
  */
  if (target.index === target.currentIndex) {
    d.lastInsertSignature = `idx:${target.index}`;
    return;
  }

  const signature = `idx:${target.index}`;

  if (!shouldAcceptDragReorder(d, signature, center.x, center.y, {
    soft: target.soft,
  })) {
    return;
  }

  acceptDragReorder(d, signature, center.x, center.y, target.index);

  animateGridMutation(d.grid, () => {
    if (target.refCard) {
      d.grid.insertBefore(d.source, target.refCard);
    } else {
      d.grid.append(d.source);
    }
  });

  /*
    Nach dem Layout-Commit den neuen unsichtbaren Source-Slot kurz locken.
    Dadurch kann der nächste Frame nicht sofort denselben Move rückgängig machen.
  */
  requestAnimationFrame(() => {
    if (!dashboard.dragging || dashboard.dragging !== d) return;

    const r = d.source.getBoundingClientRect();

    d.reorderLockRect = {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    };

    d.reorderLockUntil = performance.now() + DRAG_REORDER_LOCK_MS;
    d.lastAcceptedIndex = visualIndexOfSource(d.grid, d.source);
  });
}

function dragCloneCenter(d, clientX, clientY) {
  /*
    Wichtig:
    Nicht den Pointer selbst als Sortierpunkt verwenden.
    Bei Cards, die nicht exakt am Mittelpunkt gegriffen wurden, erzeugt das
    sonst falsche 2D-Zielzonen.
  */
  const left = clientX - d.offsetX;
  const top = clientY - d.offsetY;

  return {
    x: left + d.width / 2,
    y: top + d.height / 2,
  };
}

function pointInsideRectWithMargin(x, y, rect, margin = 0) {
  if (!rect) return false;

  return (
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin
  );
}

function shouldAcceptDragReorder(d, signature, centerX, centerY, {
  soft = false,
} = {}) {
  const now = performance.now();

  if (signature === d.lastInsertSignature) {
    return false;
  }

  /*
    Direkt nach einem Reorder liegt das Drag-Center oft noch über dem neuen
    Source-Slot. Ohne Lock kippt CSS Grid gerne sofort zurück.
  */
  if (
    d.reorderLockRect &&
    now < (d.reorderLockUntil || 0) &&
    pointInsideRectWithMargin(
      centerX,
      centerY,
      d.reorderLockRect,
      DRAG_REORDER_LOCK_MARGIN_PX
    )
  ) {
    return false;
  }

  /*
    Soft Candidate = Zentrum / unsichere Zone.
    Muss kurz stabil bleiben.
  */
  if (soft) {
    if (d.lastCandidateSignature !== signature) {
      d.lastCandidateSignature = signature;
      d.candidateSince = now;
      return false;
    }

    if (now - (d.candidateSince || 0) < DRAG_REORDER_CANDIDATE_STABLE_MS) {
      return false;
    }
  } else {
    d.lastCandidateSignature = signature;
    d.candidateSince = now;
  }

  const movedSinceLastReorder = Math.hypot(
    centerX - (d.lastReorderX ?? centerX),
    centerY - (d.lastReorderY ?? centerY)
  );

  if (
    now - (d.lastReorderAt || 0) < DRAG_REORDER_COOLDOWN_MS &&
    movedSinceLastReorder < DRAG_REORDER_MIN_MOVE_PX
  ) {
    return false;
  }

  return true;
}

function acceptDragReorder(d, signature, centerX, centerY, targetIndex) {
  d.lastInsertSignature = signature;
  d.lastAcceptedIndex = targetIndex;

  d.lastReorderAt = performance.now();
  d.lastReorderX = centerX;
  d.lastReorderY = centerY;

  d.reorderLockRect = null;
  d.reorderLockUntil = 0;
}

function visualIndexOfSource(grid, source) {
  const layout = buildDashboardVisualLayout(grid, {
    includeSource: true,
  });

  return Math.max(0, layout.flat.indexOf(source));
}

function buildDashboardVisualLayout(grid, {
  includeSource = true,
} = {}) {
  const d = dashboard.dragging;

  const cards = [...grid.querySelectorAll('.yanta-dash-card[data-key]')]
    .filter((card) => {
      if (!(card instanceof HTMLElement)) return false;
      if (card.classList.contains('drag-clone')) return false;
      if (!includeSource && d?.source === card) return false;
      if (card.offsetParent === null) return false;
      return true;
    })
    .map((card) => {
      const rect = card.getBoundingClientRect();

      return {
        card,
        rect,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      };
    })
    .filter((item) => item.width > 0 && item.height > 0)
    .sort((a, b) => {
      /*
        Primär nach top, danach left.
        Die spätere Row-Bildung korrigiert kleine top-Differenzen
        durch unterschiedliche Card-Höhen.
      */
      return a.top - b.top || a.left - b.left;
    });

  const rows = [];

  for (const item of cards) {
    let bestRow = null;
    let bestDistance = Infinity;

    for (const row of rows) {
      const overlap =
        Math.min(item.bottom, row.bottom) -
        Math.max(item.top, row.top);

      const overlapRatio =
        overlap > 0
          ? overlap / Math.min(item.height, row.height || item.height)
          : 0;

      const centerDistance = Math.abs(item.cy - row.cy);

      const sameRow =
        overlapRatio >= 0.28 ||
        centerDistance <= Math.max(
          DRAG_SPATIAL_ROW_TOLERANCE_PX,
          Math.min(item.height, row.height || item.height) * 0.38
        );

      if (!sameRow) continue;

      if (centerDistance < bestDistance) {
        bestDistance = centerDistance;
        bestRow = row;
      }
    }

    if (!bestRow) {
      rows.push({
        top: item.top,
        bottom: item.bottom,
        cy: item.cy,
        height: item.height,
        items: [item],
      });

      continue;
    }

    bestRow.items.push(item);

    bestRow.top = Math.min(bestRow.top, item.top);
    bestRow.bottom = Math.max(bestRow.bottom, item.bottom);
    bestRow.height = Math.max(1, bestRow.bottom - bestRow.top);
    bestRow.cy =
      bestRow.items.reduce((sum, x) => sum + x.cy, 0) /
      bestRow.items.length;
  }

  rows.sort((a, b) => a.cy - b.cy);

  for (const row of rows) {
    row.items.sort((a, b) => a.cx - b.cx);
  }

  return {
    rows,
    flat: rows.flatMap((row) => row.items.map((item) => item.card)),
  };
}

function findBestInsertionTarget(grid, centerX, centerY) {
  const d = dashboard.dragging;
  if (!d) return null;

  const withSource = buildDashboardVisualLayout(grid, {
    includeSource: true,
  });

  const withoutSource = buildDashboardVisualLayout(grid, {
    includeSource: false,
  });

  const currentIndex = Math.max(0, withSource.flat.indexOf(d.source));

  if (!withoutSource.rows.length) {
    return {
      index: 0,
      currentIndex,
      refCard: null,
      markerCard: null,
      markerPlace: 'after',
      soft: false,
    };
  }

  const rows = withoutSource.rows;
  const flat = withoutSource.flat;

  let rowIndex = -1;
  let bestRowDistance = Infinity;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const inBand =
      centerY >= row.top - DRAG_SPATIAL_ROW_TOLERANCE_PX &&
      centerY <= row.bottom + DRAG_SPATIAL_ROW_TOLERANCE_PX;

    const dist = Math.abs(centerY - row.cy);

    if (inBand && dist < bestRowDistance) {
      bestRowDistance = dist;
      rowIndex = i;
    }
  }

  if (rowIndex < 0) {
    /*
      Oberhalb aller Reihen -> ganz vorne.
      Unterhalb aller Reihen -> ganz hinten.
      Sonst nächste Reihe.
    */
    if (centerY < rows[0].top) {
      rowIndex = 0;
    } else if (centerY > rows[rows.length - 1].bottom) {
      const last = flat[flat.length - 1] || null;

      return {
        index: flat.length,
        currentIndex,
        refCard: null,
        markerCard: last,
        markerPlace: 'after',
        soft: false,
      };
    } else {
      let nearest = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < rows.length; i++) {
        const dist = Math.abs(centerY - rows[i].cy);

        if (dist < nearestDist) {
          nearest = i;
          nearestDist = dist;
        }
      }

      rowIndex = nearest;
    }
  }

  const row = rows[rowIndex];
  const items = row.items;

  let localIndex = items.length;
  let soft = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const deadzone = Math.max(
      DRAG_REORDER_CENTER_DEADZONE_PX,
      Math.min(26, item.width * 0.10)
    );

    if (centerX < item.cx - deadzone) {
      localIndex = i;
      soft = false;
      break;
    }

    if (Math.abs(centerX - item.cx) <= deadzone) {
      localIndex = centerX < item.cx ? i : i + 1;
      soft = true;
      break;
    }
  }

  let index = 0;

  for (let i = 0; i < rowIndex; i++) {
    index += rows[i].items.length;
  }

  index += localIndex;
  index = Math.max(0, Math.min(flat.length, index));

  const refCard = flat[index] || null;

  let markerCard = refCard;
  let markerPlace = 'before';

  if (!markerCard && flat.length) {
    markerCard = flat[flat.length - 1];
    markerPlace = 'after';
  }

  /*
    Wenn der Marker rechnerisch vor einer Card steht, die visuell direkt
    hinter der Source liegt, ist das okay. Die eigentliche No-op-Prüfung
    läuft über currentIndex === index.
  */
  return {
    index,
    currentIndex,
    refCard,
    markerCard,
    markerPlace,
    soft,
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  await Promise.race([
    anim.finished.catch(() => {}),
    delay(DRAG_DROP_ANIM_MS + 90),
  ]);
}

function addDashboardDragKeysToAiContext(keys = []) {
  const refs = keys
    .map(dashboardKeyToAiRef)
    .filter(Boolean);

  if (!refs.length) return false;

  window.dispatchEvent(new CustomEvent('yanta-ai-add-context-refs', {
    detail: {
      refs,
      source: 'dashboard-drag',
    },
  }));

  return true;
}

async function finishCardDrag() {
  const d = dashboard.dragging;
  if (!d) return;

  dashboard.dragging = null;
  dashboard.suppressOpenUntil = performance.now() + 850;
  suppressDashboardStaggerFor(1400);

  if (d.raf) {
    cancelAnimationFrame(d.raf);
    d.raf = 0;
  }

  if (d.scaleRaf) {
    cancelAnimationFrame(d.scaleRaf);
    d.scaleRaf = 0;
  }

  stopDragAutoScroll(d);
  clearDragVisuals();

  const {
    source,
    clone,
    grid,
    dropFolderId,
  } = d;

  const dragKeys = dashboardSelectedDragKeys(d.key);

  try {
    /*
      Wichtig:
      AI-Drop muss innerhalb dieses try/finally liegen.
      Sonst läuft cleanupDashboardDragDom(d) nicht und Clone/Trash/Drop-Zone
      bleiben sichtbar hängen.
    */
    if (aiContextDropTargetAtPoint(d.lastX, d.lastY)) {
      const added = addDashboardDragKeysToAiContext(dragKeys);

      if (!added) {
        toast('Could not add item to AI context', 'error');
      }

      return;
    }

    const shouldDropToTrash =
      d.dropToTrash ||
      isPointOverTrashDropTarget(d.lastX, d.lastY);

      if (shouldDropToTrash) {
        await animateTrashDropCrumple(d);

        await moveDashboardKeysToTrash(dragKeys);

        renderDashboard({
          animate: false,
        });

        return;
      }

    if (dropFolderId) {
      const moved = await moveDashboardKeysToFolder(dragKeys, dropFolderId);

      if (moved) {
        toast(
          moved === 1
            ? 'Moved into folder'
            : `Moved ${moved} items into folder`,
          'success'
        );
      }

      renderDashboard({
        animate: false,
      });

      return;
    }

    const finalRect = source.getBoundingClientRect();

    await animateCloneToRect(clone, finalRect);

    dashboard.layoutCommitInProgress = true;

    try {
      await persistGridOrder(grid, grid.dataset.section || d.section);
      syncDashboardRenderBaseline();
    } finally {
      dashboard.layoutCommitInProgress = false;
    }

    dashboard.selectedKey = source.dataset.key || d.key;
    source.classList.add('selected');

  } catch (err) {
    console.error('[YANTA Dashboard] Could not finish drag', err);
    toast('Could not complete drag', 'error');

    renderDashboard({
      animate: false,
    });
  } finally {
    cleanupDashboardDragDom(d);
  }
}

async function cancelCardDrag() {
  const d = dashboard.dragging;
  if (!d) return;

  dashboard.dragging = null;
  dashboard.suppressOpenUntil = performance.now() + 700;
  suppressDashboardStaggerFor(900);

  if (d.raf) {
    cancelAnimationFrame(d.raf);
    d.raf = 0;
  }

  if (d.scaleRaf) {
    cancelAnimationFrame(d.scaleRaf);
    d.scaleRaf = 0;
  }

  stopDragAutoScroll(d);
  clearDragVisuals();

  try {
    const sourceRect = d.source?.getBoundingClientRect?.();

    if (sourceRect) {
      await animateCloneToRect(d.clone, sourceRect);
    }
  } catch (err) {
    console.warn('[YANTA Dashboard] Drag cancel animation failed', err);
  } finally {
    cleanupDashboardDragDom(d);

    renderDashboard({
      animate: false,
    });
  }
}

async function persistGridOrder(grid, section) {
  const cards = [...grid.querySelectorAll('.yanta-dash-card[data-key]')]
    .filter((card) => !card.classList.contains('drag-clone'));

  const writes = [];
  const changedNotes = [];
  const changedFolders = [];

  const t = Date.now();
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

      note.layoutUpdated = t;

      writes.push(store.notes.put(note));
      changedNotes.push(id);
    } else if (kind === 'folder') {
      const folder = state.folders.get(id);
      if (!folder) continue;

      folder.dashboardOrder = order;
      folder.layoutUpdated = t;

      writes.push(store.folders.put(folder));
      changedFolders.push(id);
    }

    order += DASH_ORDER_STEP;
  }

  await Promise.all(writes);

  /*
    Absichtlich kein yanta-dashboard-refresh:
    DOM-Reihenfolge ist nach dem Drag bereits korrekt.
    Events sind aber wichtig für Sync/Index-Bridge.
  */
  for (const noteId of changedNotes) {
    emit(EVT.NOTE_UPDATED, {
      noteId,
      reason: 'layout-change',
      source: 'dashboard',
    });
  }

  for (const folderId of changedFolders) {
    emit(EVT.FOLDER_UPDATED, {
      folderId,
      reason: 'layout-change',
      source: 'dashboard',
      refreshDashboard: false,
    });
  }
}

function bindResizeHandle(handle, key) {
  let handleLongPressTimer = 0;
  let handleLongPressFired = false;

  /*
    Mobile Safari/Chrome feuern bei Long-Press oft ein contextmenu.
    Auf dem Resize-Handle ist das nie erwünscht:
    - Long-Press soll Reset auslösen
    - Drag soll Resize auslösen
    - kein Dashboard-/Browser-Kontextmenü
  */
    handle.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    }, true);

  const clearHandleLongPressTimer = () => {
    clearTimeout(handleLongPressTimer);
    handleLongPressTimer = 0;
  };

  const reset = async () => {
    dashboard.suppressOpenUntil = performance.now() + 700;
    suppressDashboardStaggerFor(1400);

    const card = handle.closest('.yanta-dash-card');

    if (!card) {
      await setItemHeightPx(key, null);
      return;
    }

    cancelDashboardCardStagger(card);

    await setItemHeightPx(key, null);

    dashboard.selectedKey = key;
    card.classList.add('selected');

    const { kind, id } = parseItemKey(key);

    if (kind === 'note') {
      const note = state.notes.get(id);
      const host = card.querySelector('[data-preview-host]');

      if (note && host) {
        /*
          Kein renderDashboard().
          Nur diese eine Card wieder auf natürliche Preview-Höhe fitten.
        */
        fitDashboardNoteCardToRenderedPreview(card, note, host);
      }

      return;
    }

    if (kind === 'folder') {
      /*
        Folder haben keine Preview-Hydration wie Notes.
        Reset bedeutet hier: zurück auf Default-Folder-Höhe.
      */
      applyDashboardCardHeight(card, DEFAULT_FOLDER_HEIGHT);
      card.dataset.contentMaxHeight = String(DEFAULT_FOLDER_HEIGHT);
    }
  };

  handle.addEventListener('dblclick', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await reset();
  });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    clearHandleLongPressTimer();
    handleLongPressFired = false;

    const card = handle.closest('.yanta-dash-card');
    if (!card) return;

    /*
      Wichtig:
      Falls die Card noch eine Entry-Stagger-Animation/Füllzustand hat,
      beim Resize sofort entfernen. Sonst kann Grid-Row-Änderung optisch
      wie ein erneutes Fade-In wirken.
    */
    cancelDashboardCardStagger(card);
    suppressDashboardStaggerFor(1400);

    const rect = card.getBoundingClientRect();

    dashboard.resize = {
      key,
      card,
      pointerId: e.pointerId,
      pointerType: e.pointerType || '',
      startX: e.clientX,
      startY: e.clientY,
      startHeight: rect.height,
      nextHeight: rect.height,
      active: false,
    };

    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {}

    /*
      Mobile / Pen:
      Long-Press auf Resize-Handle macht dasselbe wie Doppelklick:
      gespeicherte Höhe löschen und Auto-Fit wieder aktivieren.

      Bewegung > MOVE_TOLERANCE bricht den Long-Press ab und startet Resize.
    */
    const canLongPressReset =
      e.pointerType === 'touch' ||
      e.pointerType === 'pen' ||
      isMobile();

    if (canLongPressReset) {
      handleLongPressTimer = window.setTimeout(async () => {
        const r = dashboard.resize;

        if (!r || r.key !== key) return;
        if (r.pointerId !== e.pointerId) return;
        if (r.active) return;

        handleLongPressFired = true;

        cleanupResizeListeners();

        try {
          handle.releasePointerCapture?.(e.pointerId);
        } catch {}

        dashboard.resize = null;
        dashboard.suppressOpenUntil = performance.now() + 900;

        try {
          navigator.vibrate?.(12);
        } catch {}

        await reset();
      }, HANDLE_LONG_PRESS_MS);
    }

    document.addEventListener('pointermove', onDocumentResizeMove, true);
    document.addEventListener('pointerup', onDocumentResizeUp, true);
    document.addEventListener('pointercancel', onDocumentResizeCancel, true);
  }, { passive: false });

  function cleanupResizeListeners() {
    document.removeEventListener('pointermove', onDocumentResizeMove, true);
    document.removeEventListener('pointerup', onDocumentResizeUp, true);
    document.removeEventListener('pointercancel', onDocumentResizeCancel, true);

    clearHandleLongPressTimer();
  }

  function onDocumentResizeMove(e) {
    const r = dashboard.resize;
    if (!r || r.key !== key) return;
    if (r.pointerId != null && e.pointerId !== r.pointerId) return;

    if (handleLongPressFired) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const dx = e.clientX - (r.startX ?? e.clientX);
    const dy = e.clientY - r.startY;
    const moved = Math.hypot(dx, dy);

    /*
      Bewegung bricht den Long-Press-Reset ab.
    */
    if (moved > MOVE_TOLERANCE) {
      clearHandleLongPressTimer();
    }

    if (Math.abs(dy) > MOVE_TOLERANCE) {
      r.active = true;
    }

    if (!r.active) return;

    e.preventDefault();
    e.stopPropagation();

    cancelDashboardCardStagger(r.card);
    suppressDashboardStaggerFor(1400);

    const maxHeight = maxResizeHeightForCard(r.card, key);

    const nextHeight = Math.max(
      MIN_CARD_HEIGHT,
      Math.min(maxHeight, r.startHeight + dy)
    );

    r.nextHeight = nextHeight;

    r.card.style.setProperty(
      '--dash-row-span',
      String(heightToGridSpan(nextHeight, r.card))
    );

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

    /*
      Wenn der Long-Press bereits den Reset ausgeführt hat,
      darf pointerup nichts mehr speichern.
    */
    if (handleLongPressFired) {
      handleLongPressFired = false;
      dashboard.resize = null;
      return;
    }

    dashboard.suppressOpenUntil = performance.now() + 900;
    suppressDashboardStaggerFor(1400);

    if (r.active) {
      cancelDashboardCardStagger(r.card);

      await setItemHeightPx(key, r.nextHeight);

      dashboard.selectedKey = key;

      /*
        Kein komplettes renderDashboard() hier:
        Das verhindert sichtbares Flackern nach Resize.
      */
      r.card.classList.add('selected');
    } else {
      dashboard.selectedKey = key;
      r.card.classList.add('selected');
    }

    r.card?.classList.remove('resizing');
    cancelDashboardCardStagger(r.card);

    dashboard.resize = null;
  }

  function onDocumentResizeCancel(e) {
    const r = dashboard.resize;
    if (!r || r.key !== key) return;

    cleanupResizeListeners();

    try {
      handle.releasePointerCapture?.(e.pointerId);
    } catch {}

    if (handleLongPressFired) {
      handleLongPressFired = false;
      dashboard.resize = null;
      return;
    }

    suppressDashboardStaggerFor(900);

    /*
      Visuelle Änderung zurücksetzen, falls Resize abgebrochen wurde.
    */
    r.card.style.setProperty(
      '--dash-row-span',
      String(heightToGridSpan(r.startHeight, r.card))
    );

    r.card.dataset.effectiveHeight = String(Math.round(r.startHeight));
    r.card?.classList.remove('resizing');

    cancelDashboardCardStagger(r.card);

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

  const t = Date.now();

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

    note.layoutUpdated = t;

    await store.notes.put(note);

    emit(EVT.NOTE_UPDATED, {
      noteId: id,
      reason: 'layout-change',
      source: 'dashboard',
    });

    return;
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

    folder.layoutUpdated = t;

    await store.folders.put(folder);

    emit(EVT.FOLDER_UPDATED, {
      folderId: id,
      reason: 'layout-change',
      source: 'dashboard',
      refreshDashboard: false,
    });
  }
}