// ============================================================
// YANTA — Main entry point. Wires DOM events, hotkeys, drop overlay,
// pane divider, history navigation, view modes.
// ============================================================

import { $, state, store, openDB, toast, cssColorToHex, safeCssColor, lucide } from './core.js';
import {
  loadAppearance,
  watchSystemTheme,
  openSettings,
  cycleAppearanceMode,
} from './settings.js';
import {
  openNote,
  newNote,
  newFolder,
  saveCurrentNote,
  deleteCurrentNote,
  togglePin,
  createWelcomeNote,
  rebuildWikilinkIndex,
  setNavSuppress,
  addTag,
  createNoteWithTitle,
  toggleTaskLineInNote,
} from './notes.js';
import { renderTree, renderTagCloud, showMenu, closeMenu, currentFolderForNew } from './tree.js';
import { renderBacklinks, renderOutline, setupWikilinkHover, handleWikilinkClick, openPalette, closePalette, buildCommandList, paletteMove, paletteAccept, paletteFilter } from './features.js';
import { openImageModal, closeImageModal, setupImage, pickImageFile, cleanupUnusedImages, insertImageAsRef } from './image.js';
import { openIconInsertPicker, openIconPicker } from './icon-picker.js';
import { focusEditorEnd, getView } from './editor.js';
import { setupFormatToolbar } from './format-menu.js';
import { exportAsZip, exportNoteAsMd, exportBundle, exportEveryNoteMd, openExportMenu, importFiles, importItems, walkEntry } from './io.js';
import { syncRestore, syncConnect, syncDisconnect, syncFull, openSyncSetup, closeSyncSetup, syncMenu } from './sync.js';
import { openGraph, closeGraph, setupGraphInteractions, openGraphPane } from './graph.js';
import { wikilinkIndex } from './features-state.js';
import { getNoteDoc, noteMarkdown, drawingsTextForNote, citationsTextForNote } from './yjs.js';
import { openShareModal, closeShareModal, stopSharing, restoreSharedNotes, handleShareUrl } from './sharing.js';
import { setupDraw, createDrawingAndInsert, importExcalidrawFileIntoCurrent } from './draw.js';
import { setupCitations, openCitationManager } from './citations.js';
import {
  installVaultStoreBridge,
  seedVaultFromLocalState,
} from './sync2/store-bridge.js';
import {
  setupDashboard,
  showDashboard,
  showDashboardPane,
  showDashboardFromNote,
  hideDashboard,
  isDashboardVisible,
  showDashboardFolderFromHistory,
  openNoteFromDashboardHistory,
} from './dashboard.js';

import {
  setupFloatingCreate,
} from './floating-create.js';

import {
  vaultJsonSnapshot,
  getVaultDoc,
} from './sync2/vault-doc.js';
import {
  createSync2DebugAppRuntime,
  createSync2BrokerAppRuntime,
} from './sync2/app-engine.js';
import {
  exportSyncCapsule,
  pickAndImportSyncCapsule,
  copySyncCapsuleRecoveryKey,
  capsuleDebugSnapshot,
} from './sync2/capsule.js';
import {
  parseAppHash,
  pushNoteHistory,
  replaceNoteHistory,
} from './navigation.js';
import {
  openCalendar,
  openCalendarFromHistory,
  openCalendarPane,
  closeCalendar,
  closeCalendarPane,
} from './calendar.js';
import {
  loadCalendarPreferences,
} from './calendar-preferences.js';
import {
  closeSidePane,
} from './side-pane.js';
import {
  setupMobileSidebarController,
  closeMobileSidebar,
} from './mobile-sidebar.js';

let sharePreviewLocked = false;

const MOBILE_MQ = window.matchMedia('(max-width: 880px)');
const DESKTOP_SIDEBAR_MQ = window.matchMedia('(min-width: 881px)');
let sidebarCollapsedPref = false;

function isMobileViewport() {
  return MOBILE_MQ.matches;
}

function searchHaystack(note, body = '') {
  return [
    note?.title || '',
    (note?.tags || []).join(' '),
    body || '',
    note?.id ? drawingsTextForNote(note.id) : '',
    note?.id ? citationsTextForNote(note.id) : '',
  ].join(' ').toLowerCase();
}

async function buildSearchIndex() {
  for (const note of state.notes.values()) {
    try {
      const entry = getNoteDoc(note.id);
      await entry.ready;
      state.searchIndex.set(note.id, searchHaystack(note, noteMarkdown(note.id)));
    } catch {
      state.searchIndex.set(note.id, searchHaystack(note, ''));
    }
  }
}

async function init() {
  await openDB();

  await installVaultStoreBridge();

  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {}
    
  const [notes, folders, images, expanded, view, mobileView, sidebarCollapsed] = await Promise.all([
    store.notes.all(),
    store.folders.all(),
    store.images.allMeta(),
    store.settings.get('expandedFolders', []),
    store.settings.get('view', 'split'),
    store.settings.get('viewMobile', null),
    store.settings.get('sidebarCollapsed', false),
  ]);

  for (const n of notes) state.notes.set(n.id, n);
  for (const f of folders) state.folders.set(f.id, f);
  for (const im of images) state.imagesMeta.set(im.id, im);

  await seedVaultFromLocalState();

  // Debug helper. Remove later if desired.
  window.yantaVaultDebug = {
    getVaultDoc,
    vaultJsonSnapshot,
  };

  // Sync2 debug runtime: provider-independent encrypted sync against
  // a persistent IndexedDB fake remote.
  try {
    window.yantaSync2 = await createSync2DebugAppRuntime();

    console.info('[YANTA Sync2] debug runtime ready', {
      deviceId: window.yantaSync2.deviceId,
      syncKey: window.yantaSync2.syncKey,
    });
  } catch (err) {
    console.warn('[YANTA Sync2] debug runtime failed to start', err);
  }

  window.yantaConnectSync2Broker = async ({
    baseUrl = 'http://localhost:8787',
    token = 'dev',
    makeDefault = false,
  } = {}) => {
    const runtime = await createSync2BrokerAppRuntime({
      baseUrl,
      token,
    });

    window.yantaSync2Broker = runtime;

    if (makeDefault) {
      try {
        window.yantaSync2?.engine?.stop?.();
      } catch {}

      window.yantaSync2 = runtime;
    }

    console.info('[YANTA Sync2] broker runtime ready', {
      baseUrl,
      deviceId: runtime.deviceId,
      makeDefault,
    });

    return runtime;
  };

  window.yantaCapsule = {
    exportSyncCapsule,
    pickAndImportSyncCapsule,
    copySyncCapsuleRecoveryKey,
    capsuleDebugSnapshot,
  };

  await loadAppearance();
  await loadCalendarPreferences();

  watchSystemTheme();

  state.expandedFolders = new Set(expanded);

  sidebarCollapsedPref = !!sidebarCollapsed;
  applySidebarCollapsed(sidebarCollapsedPref, { persist: false });

  const initialView = isMobileViewport()
    ? (mobileView || (view === 'split' ? 'edit' : view))
    : view;

  setView(initialView, { persist: false });

  rebuildWikilinkIndex();
  await buildSearchIndex();

  buildCommandList({
    openImageModal,
    openIconInsertPicker,
    openDraw: createDrawingAndInsert,
    openGraph,
    openDashboard: () => showDashboard({ push: true }),
    openDashboardPane: () => showDashboardPane({
      folderId: state.dashboardFolderId || null,
    }),
    openCalendar,
    openCalendarPane,
    openCitationManager,
    exportAsZip,
    exportNoteAsMd,
    exportBundle,
    exportEveryNoteMd,
    openSyncSetup,
    syncFull,
    syncDisconnect,
    cleanupUnusedImages,
    openShareModal,
    stopSharing: () => stopSharing(state.currentNoteId),
    importFiles,
    importFolder: () => $('importFolder').click(),
  });
  setupGraphInteractions();
  setupWikilinkHover();
  setupImage();
  setupDraw();
  setupCitations();
  setupFormatToolbar();
  setupDashboard();
  setupFloatingCreate();

  // setupCalendar();
  await syncRestore();
  let sharedOpen = null;

  if (window.location.hash.startsWith('#share=') || window.location.hash.startsWith('#share2=')) {
    sharedOpen = await handleShareUrl();

    if (sharedOpen?.noteId) {
      if (sharedOpen.previewOnly) {
        sharePreviewLocked = true;
        $('app').dataset.shareMode = 'preview';
      }

      await openNote(sharedOpen.noteId);
      setView(sharedOpen.view || 'preview');
    }
  } else {
    await restoreSharedNotes();
  }

  renderTree();

// Open initial route.
// Dashboard is Home for normal app entry.
// But direct note/share deep-links must respect browser Back:
// Back should return to the previous website/history entry, not force Dashboard.
if (!sharedOpen?.noteId) {
  const route = parseAppHash();

  if (route.surface === 'calendar') {
    openCalendar({
      push: false,
      replace: true,
    });

    history.replaceState(
      { surface: 'calendar' },
      '',
      '#calendar'
    );

    return;
  }

  const explicitNoteId =
    route.surface === 'note' &&
    route.noteId &&
    state.notes.has(route.noteId)
      ? route.noteId
      : null;

  if (explicitNoteId) {
    /*
      Direct note deep-link.
      Wichtig:
      Kein künstlicher Dashboard-Eintrag darunter.
      Sonst wirkt YANTA wie ein "Back-Trap".
    */
    setNavSuppress(true);

    try {
      await openNote(explicitNoteId);
    } finally {
      setNavSuppress(false);
    }

    replaceNoteHistory(explicitNoteId);
    hideDashboard({ push: false });
  } else {
    // Normal app entry => Dashboard/Home.
    if (!state.notes.size) {
      setNavSuppress(true);

      try {
        await createWelcomeNote();
      } finally {
        setNavSuppress(false);
      }
    }

    const folderId =
      route.surface === 'dashboard' &&
      route.folderId &&
      state.folders.has(route.folderId)
        ? route.folderId
        : null;

    showDashboard({
      folderId,
      replace: true,
    });
  }
}

  if (state.notes.size && state.currentNoteId) {
    // Trigger initial sync pull (if linked) — fire-and-forget.
    // (Pull happens in syncRestore already if handle exists, but kick it
    // again so we pick up changes since the page was last open.)
    syncFull(false).catch(() => {});
  }

window.addEventListener('popstate', async (e) => {
  const st = e.state || {};
  const route = parseAppHash();

  if (st.surface === 'calendar' || route.surface === 'calendar') {
    closeGraph();
    closeCalendarPane({ silent: true });
    hideDashboard({ push: false });

    openCalendarFromHistory();

    return;
  }

  /*
    Dashboard-History inklusive Folder-Zurücknavigation.

    - Dashboard sichtbar + Folder zurück:
      showDashboardFolderFromHistory() nutzt intern navigateDashboardFolder()
      und erhält die Folder-Zoom-Transition.

    - Note offen + Back:
      Note -> Dashboard via showDashboardFromNote()
      und erhält die Note-Zoom-Back-Transition.
  */
  if (st.surface === 'dashboard' || route.surface === 'dashboard') {
    // Important:
    // If we navigate back from #calendar to #dashboard, the URL changes first.
    // We must explicitly close the fullscreen calendar surface here.
    closeCalendar({ surface: 'dashboard' });
    closeCalendarPane({ silent: true });

    const folderId =
      st.folderId !== undefined
        ? st.folderId
        : route.folderId;

    await showDashboardFolderFromHistory(
      folderId && state.folders.has(folderId) ? folderId : null
    );

    return;
  }

  const id =
    st.noteId ||
    route.noteId ||
    null;

  if (id && state.notes.has(id)) {
    setNavSuppress(true);

    try {
      /*
        Browser Back/Forward must use the same visual navigation path
        as direct Dashboard card navigation.

        - Dashboard -> Note via history forward:
          dashboard card/page -> panes transition.

        - Already in note surface:
          normal note swap/open.

        Wichtig:
        setNavSuppress(true) prevents openNote() from pushing a fresh
        history entry while we are handling popstate.
      */
      if (isDashboardVisible()) {
        await openNoteFromDashboardHistory(id);
      } else {
        if (id !== state.currentNoteId) {
          await openNote(id);
        }

        hideDashboard({ push: false });
      }
    } finally {
      setNavSuppress(false);
    }

    return;
  }

  // Defensive fallback: invalid route -> Home instead of blank state.
  showDashboard({
    folderId: null,
    replace: true,
  });
});

  bindEvents();
}

function setView(v, { persist = true } = {}) {
  if (sharePreviewLocked && v !== 'preview') {
    v = 'preview';
  }

  // Auf Smartphones kein echtes Split-View.
  if (isMobileViewport() && v === 'split') {
    v = 'edit';
  }

  state.view = v;

  const app = $('app');
  if (app) app.dataset.view = v;

  $('btn-view-edit')?.classList.toggle('active', v === 'edit');
  $('btn-view-split')?.classList.toggle('active', v === 'split');
  $('btn-view-preview')?.classList.toggle('active', v === 'preview');

  if (persist) {
    store.settings.set(isMobileViewport() ? 'viewMobile' : 'view', v);
  }
}

function applySidebarCollapsed(collapsed, { persist = true } = {}) {
  const app = $('app');
  const btn = $('btn-sidebar-collapse');

  if (!app) return;

  const effectiveCollapsed = !!collapsed && DESKTOP_SIDEBAR_MQ.matches;

  app.classList.toggle('sidebar-collapsed', effectiveCollapsed);
  app.dataset.sidebarCollapsed = effectiveCollapsed ? 'true' : 'false';

  if (btn) {
    btn.setAttribute('aria-expanded', effectiveCollapsed ? 'false' : 'true');
    btn.setAttribute(
      'aria-label',
      effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
    );
    btn.title = effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar';

    btn.innerHTML = lucide(
      effectiveCollapsed ? 'panel-left-open' : 'panel-left-close',
      16
    );
  }

  if (persist) {
    store.settings.set('sidebarCollapsed', !!collapsed);
  }

  // CodeMirror, Graph, Drawings etc. sollen nach Layoutwechsel sauber messen.
  // Wichtig: Tree-Floater nach der Sidebar-Transition neu setzen.
  const refreshLayout = () => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('yanta-sidebar-resized', {
      detail: { collapsed: effectiveCollapsed },
    }));

    // Active-Tree-Floater wird in renderTree() neu berechnet.
    renderTree();
  };

  requestAnimationFrame(() => {
    refreshLayout();

    // Sidebar/Grid transition läuft 180ms; danach finale Breite messen.
    window.setTimeout(refreshLayout, 220);
  });
}

function setupDesktopSidebarCollapse() {
  const app = $('app');
  const sidebar = $('sidebar');
  const btn = $('btn-sidebar-collapse');

  if (!app || !sidebar || !btn) return;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    sidebarCollapsedPref = !sidebarCollapsedPref;
    applySidebarCollapsed(sidebarCollapsedPref);
  });

  // Tooltips für Icon-only Tree Items: Label bleibt im DOM, wird aber visuell versteckt.
  sidebar.addEventListener('mouseover', (e) => {
    if (!app.classList.contains('sidebar-collapsed')) return;

    const row = e.target.closest?.('.tree-row');
    if (!row || !sidebar.contains(row)) return;

    const label = row.querySelector('.label')?.textContent?.trim();

    if (label) {
      row.title = label;
    }
  });

  DESKTOP_SIDEBAR_MQ.addEventListener?.('change', () => {
    applySidebarCollapsed(sidebarCollapsedPref, { persist: false });
  });
}

function switchRightPane(kind) {
  if (kind === 'preview') {
    closeSidePane();
    setView('split');

    requestAnimationFrame(() => {
      ensurePreviewPaneSwitcher();
      window.dispatchEvent(new Event('resize'));
    });

    return;
  }

  if (kind === 'dashboard') {
    showDashboardPane({
      folderId: state.dashboardFolderId || null,
    });
    return;
  }

  if (kind === 'graph') {
    openGraphPane();
    return;
  }

  if (kind === 'calendar') {
    openCalendarPane();
  }
}

function ensurePreviewPaneSwitcher() {
  const pane = $('panePreview');
  if (!pane || pane.querySelector('[data-preview-pane-switcher]')) return;

  const switcher = document.createElement('div');
  switcher.className = 'yanta-preview-pane-switcher';
  switcher.setAttribute('data-preview-pane-switcher', '');

  switcher.innerHTML = `
    <button class="icon-btn active" data-pane-kind="preview" title="Markdown preview">${lucide('eye', 15)}</button>
    <button class="icon-btn" data-pane-kind="dashboard" title="Dashboard">${lucide('layout-dashboard', 15)}</button>
    <button class="icon-btn" data-pane-kind="graph" title="Graph">${lucide('network', 15)}</button>
    <button class="icon-btn" data-pane-kind="calendar" title="Calendar">${lucide('calendar-days', 15)}</button>

    <span class="yanta-preview-pane-switcher-sep"></span>

    <button class="icon-btn" data-pane-expand="preview" title="Expand preview">${lucide('maximize-2', 15)}</button>
    <button class="icon-btn" data-pane-close="preview" title="Close right pane">${lucide('x', 15)}</button>
  `;

  for (const btn of switcher.querySelectorAll('[data-pane-kind]')) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      switchRightPane(btn.dataset.paneKind);
    });
  }

  switcher.querySelector('[data-pane-expand]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    expandRightPane('preview');
  });

  switcher.querySelector('[data-pane-close]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    closeRightPane('preview');
  });

  pane.append(switcher);
}

function expandRightPane(kind = 'preview') {
  if (kind === 'preview') {
    closeSidePane({ silent: true });
    setView('preview');
    return;
  }

  if (kind === 'calendar') {
    closeSidePane({ silent: true });
    openCalendar({ push: true });
    return;
  }

  if (kind === 'dashboard') {
    closeSidePane({ silent: true });
    showDashboard({
      folderId: state.dashboardFolderId || null,
      push: true,
    });
    return;
  }

  if (kind === 'graph') {
    closeSidePane({ silent: true });
    openGraph();
  }
}

function closeRightPane(kind = 'preview') {
  if (kind !== 'preview') {
    closeSidePane();
  }

  setView('edit');
}

function bindEvents() {
  // title + tags
  $('noteTitle').addEventListener('input', () => { saveCurrentNote(); });
  $('noteTitle').addEventListener('blur', () => saveCurrentNote().then(() => renderTree()));
  $('tagInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { addTag(e.target.value); e.target.value = ''; } });

  // sidebar
  $('btn-new-note').addEventListener('click', async () => {
    await newNote(currentFolderForNew());
    closeMobileSidebar();
  });
  $('btn-new-folder').addEventListener('click', () => newFolder(null));
  $('btn-theme').addEventListener('click', cycleAppearanceMode);
  $('btn-export').addEventListener('click', (e) => { e.stopPropagation(); openExportMenu(e.currentTarget, showMenu); });
  $('btn-import').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'Restore / import files (.yanta / .md / .json / .zip)…', action: () => $('importFile').click() },
    { label: 'Import folder (with sub-folders)…', action: () => $('importFolder').click() },
      'hr',
      { label: 'Or drop files/folders anywhere on the window', action: () => toast('Drop files or a folder onto YANTA') },
    ]);
  });
  $('importFile').addEventListener('change', (e) => { if (e.target.files.length) importFiles([...e.target.files]); e.target.value = ''; });
  $('importFolder').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) { e.target.value = ''; return; }
    const items = files.map((f) => {
      const parts = (f.webkitRelativePath || f.name).split('/');
      parts.pop();
      return { file: f, pathArr: parts };
    });
    await importItems(items);
    e.target.value = '';
  });
  $('btn-export-note').addEventListener('click', () => {
    const n = state.notes.get(state.currentNoteId);
    if (n) exportNoteAsMd(n);
  });
  // $('btn-images').addEventListener('click', () => { openImageModal(); });

  document.querySelector('.brand')?.addEventListener('click', (e) => {
    e.preventDefault();

    showDashboard({
      folderId: null,
      push: true,
    });

    closeMobileSidebar();
  });

  // Sync
  $('vaultIndicator').addEventListener('click', (e) => { e.stopPropagation(); syncMenu(e.currentTarget, showMenu); });
  $('syncSetupPick')?.addEventListener('click', async () => { closeSyncSetup(); await syncConnect(); });
  document.querySelectorAll('[data-sync-close]').forEach((b) => b.addEventListener('click', closeSyncSetup));
  document.querySelectorAll('[data-conflict-close]').forEach((b) => b.addEventListener('click', () => { $('conflictModal').hidden = true; }));
  window.addEventListener('focus', () => { syncFull(false).catch(() => {}); });

  // Settings (placeholder)
  $('btn-settings').addEventListener('click', openSettings);

  // Search
  $('search').addEventListener('input', (e) => { state.searchQuery = e.target.value; renderTree(); });

  // View toggles
  $('btn-view-edit').addEventListener('click', () => {
    hideDashboard({ push: false });
    setView('edit');
  });

  $('btn-view-split').addEventListener('click', () => {
    hideDashboard({ push: false });

    setView('split');

    // Split View means: left note/editor, right Markdown preview by default.
    // If a companion app is open in the right pane, return to preview.
    closeSidePane();

    requestAnimationFrame(() => {
      ensurePreviewPaneSwitcher();
      window.dispatchEvent(new Event('resize'));
    });
  });

  $('btn-view-preview').addEventListener('click', () => {
    hideDashboard({ push: false });
    setView('preview');
  });

  setupMobileSidebarController({
    onMobileLayoutChange: () => {
      if (state.view === 'split') {
        setView('edit', { persist: false });
      }
    },
  });
  setupDesktopSidebarCollapse();

  // Head actions
  $('btn-pin').addEventListener('click', togglePin);
  $('btn-delete').addEventListener('click', deleteCurrentNote);
  $('btn-insert-image').addEventListener('click', openImageModal);
  $('btn-cite')?.addEventListener('click', () => openCitationManager());
  $('btn-share').addEventListener('click', openShareModal);

  // Share modal
  $('btn-share-copy').addEventListener('click', async () => {
    const v = $('shareLink').value;
    try { await navigator.clipboard.writeText(v); toast('Link copied', 'success'); } catch { toast('Copy failed', 'error'); }
  });
  $('btn-share-stop').addEventListener('click', async () => { await stopSharing(state.currentNoteId); closeShareModal(); });
  document.querySelectorAll('[data-share-close]').forEach((b) => b.addEventListener('click', closeShareModal));

  // Divider
  setupDivider();
  setupPaneScrollSync();

  ensurePreviewPaneSwitcher();

  window.addEventListener('yanta-side-pane-expand', (e) => {
    expandRightPane(e.detail?.kind || 'preview');
  });

  window.addEventListener('yanta-side-pane-close-request', (e) => {
    closeRightPane(e.detail?.kind || 'preview');
  });

  window.addEventListener('yanta-side-pane-switch', (e) => {
    switchRightPane(e.detail?.kind || 'preview');
  });

  // Preview interactions
  $('preview').addEventListener('click', (e) => {
    if (e.target.closest('a.wiki-link')) {
      handleWikilinkClick(e);
      return;
    }

    const tag = e.target.closest('.tag-ref');
    if (tag) {
      state.activeTagFilter = tag.dataset.tag;
      renderTree();
      return;
    }

    const task = e.target.closest('.task[data-line]');
    if (!task) return;

    // Normale Links in Tasks sollen weiterhin Links bleiben, nicht toggeln.
    if (e.target.closest('a, button')) return;

    const line = parseInt(task.dataset.line, 10);
    if (Number.isNaN(line)) return;

    const cb = task.querySelector('input[type=checkbox]');
    if (!cb) return;

    const checked = e.target.matches('input[type=checkbox]')
      ? e.target.checked
      : !cb.checked;

    toggleTaskLineInNote(state.currentNoteId, line, checked);
  });

  // Global keyboard
  window.addEventListener('keydown', handleGlobalKey);

  // Drop import
  setupGlobalDropImport();

  // Click anywhere in the editor pane that is BELOW the last line of
  // text (or in the gutter) → focus the end of the document. CM6 only
  // catches clicks inside .cm-content; the empty area below it is
  // .cm-scroller (or paneEdit padding), which we route here.
  $('paneEdit').addEventListener('mousedown', (e) => {
    const v = getView();

    // Alles, was innerhalb von CodeMirror passiert, soll CodeMirror selbst behandeln:
    // Textauswahl, Klicks in Padding, Selection-Layer, Widgets, Scroller usw.
    if (v?.dom?.contains(e.target)) return;

    if (e.target.closest?.('.format-toolbar')) return;
    if (e.target.closest?.('.cm-tooltip')) return;

    e.preventDefault();
    focusEditorEnd();
  });

  // Paste image inside editor → open the image insert modal with the file.
  window.addEventListener('yanta-paste-image', async (e) => {
    openImageModal();
    await pickImageFile(e.detail.file);
  });


  window.addEventListener('yanta-editor-drop-files', async (e) => {
    const { files } = e.detail;

    for (const f of files) {
      const lower = f.name.toLowerCase();

      if (lower.endsWith('.excalidraw') || lower.endsWith('.excalidraw.json')) {
        await importExcalidrawFileIntoCurrent(f);
      } else if (lower.endsWith('.svg') || f.type === 'image/svg+xml') {
        const { importSvgFileAsDrawing } = await import('./draw.js');
        await importSvgFileAsDrawing(f);
      } else if (f.type.startsWith('image/')) {
        await insertImageAsRef(f);
      } else if (/\.(yanta|md|markdown|txt|json|zip)$/i.test(f.name)) {
        await importFiles([f]);
      }
    }
  });

  // Slash → image insert event from editor
  window.addEventListener('yanta-open-image-modal', () => openImageModal());
  // Ctrl/Cmd+click wikilink from editor
  window.addEventListener('yanta-follow-wiki', async (e) => {
    const target = e.detail.target;
    const id = wikilinkIndex.get(target.toLowerCase());

    if (id) {
      openNote(id);
      return;
    }

    // Kein Browser-Confirm mehr.
    // In Editor/Drawing gibt es keinen sinnvollen lokalen Anchor.
    // Daher: bewusst direkte Aktion + Toast.
    await createNoteWithTitle(target);
    toast(`Created "${target}"`, 'success');
  });
  // Cycle view from command palette
  window.addEventListener('yanta-cycle-view', () => {
    if (isMobileViewport()) {
      setView(state.view === 'preview' ? 'edit' : 'preview');
      return;
    }

    setView(state.view === 'split' ? 'preview' : state.view === 'preview' ? 'edit' : 'split');
  });

  // Palette
  $('btn-palette').addEventListener('click', () => openPalette('commands'));

  $('btn-graph').addEventListener('click', () => {
    openGraph();
    closeMobileSidebar();
  });

  $('btn-calendar')?.addEventListener('click', () => {
    openCalendar({ push: true });
    closeMobileSidebar();
  });

  $('btn-calendar-close')?.addEventListener('click', () => {
    if (history.state?.surface === 'calendar') {
      history.back();
      return;
    }

    closeCalendar({ surface: 'dashboard' });

    showDashboard({
      folderId: state.dashboardFolderId || null,
      push: true,
    });
  });
  const palEl = $('palette');
  palEl.addEventListener('click', (e) => { if (e.target === palEl) closePalette(); });
  $('paletteInput').addEventListener('input', (e) => paletteFilter(e.target.value));
  $('paletteInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); paletteAccept(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });

  window.addEventListener('yanta-open-citation-manager', () => {
    openCitationManager();
  });

  window.addEventListener('yanta-note-opened', () => {
    // Fullscreen calendar should close when opening a note.
    // Calendar side pane should stay open.
    closeCalendar({ surface: 'note' });
  });

  window.addEventListener('yanta-open-icon-insert', () => openIconInsertPicker());

  window.addEventListener('yanta-edit-inline-icon', (e) => {
    const d = e.detail || {};
    if (d.tokenFrom == null || d.tokenTo == null) return;

    openIconPicker({
      title: 'Edit Lucide icon',
      initialIcon: d.icon || 'square',
      initialColor: d.color || '#6ea8fe',
      allowReset: false,
      applyLabel: 'Update',
      onApply: ({ icon, color }) => {
        if (!icon) return;

        const safeColor = safeCssColor(color);
        const insert = `:lucide[${icon}]${safeColor ? `{${safeColor}}` : ''}:`;

        replaceEditorRange(d.tokenFrom, d.tokenTo, insert);
        toast('Icon updated', 'success');
      },
    });
  });

  window.addEventListener('yanta-edit-inline-icon-color', (e) => {
    const d = e.detail || {};
    if (d.colorFrom == null || d.colorTo == null) return;

    openNativeColorPickerForRange({
      from: d.colorFrom,
      to: d.colorTo,
      color: d.color || '#000000',
    });
  });

  // Persist expanded folders
  setInterval(() => store.settings.set('expandedFolders', [...state.expandedFolders]), 5000);

  // Unload
  window.addEventListener('beforeunload', () => { if (state.dirty) saveCurrentNote(); });
}

function replaceEditorRange(from, to, insert) {
  const v = getView();
  if (!v) return;

  v.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  });

  v.focus();
}

let inlineColorInput = null;

function openNativeColorPickerForRange({ from, to, color }) {
  const v = getView();
  if (!v) return;

  if (!inlineColorInput) {
    inlineColorInput = document.createElement('input');
    inlineColorInput.type = 'color';
    inlineColorInput.style.position = 'fixed';
    inlineColorInput.style.left = '-1000px';
    inlineColorInput.style.top = '-1000px';
    inlineColorInput.style.width = '1px';
    inlineColorInput.style.height = '1px';
    inlineColorInput.style.opacity = '0';
    inlineColorInput.tabIndex = -1;
    document.body.append(inlineColorInput);
  }

  inlineColorInput.value = cssColorToHex(color) || '#000000';

  inlineColorInput.onchange = () => {
    const next = inlineColorInput.value;
    replaceEditorRange(from, to, next);
    toast('Color updated', 'success');
  };

  try {
    inlineColorInput.showPicker?.();
  } catch {
    inlineColorInput.click();
  }

  if (!inlineColorInput.showPicker) {
    inlineColorInput.click();
  }
}

function handleGlobalKey(e) {
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key === 'n') { e.preventDefault(); newNote(currentFolderForNew()); }
  else if (meta && e.key === 'k') { e.preventDefault(); $('search').focus(); }
  else if (meta && e.key === 's') { e.preventDefault(); saveCurrentNote(); toast('Saved', 'success'); }
  else if (meta && e.key === 'i') { e.preventDefault(); openImageModal(); }
  else if (meta && e.key === 'o') { e.preventDefault(); openPalette('notes'); }
  else if (meta && e.key === 'p') { e.preventDefault(); openPalette('commands'); }
  else if (meta && e.key === 'g') { e.preventDefault(); openGraph(); }
  else if (meta && e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    openCalendar();
  }
  else if (meta && e.key.toLowerCase() === 'h') {
    e.preventDefault();
    showDashboard({ push: true });
  }
  else if (meta && e.key === 'e') {
    e.preventDefault();
    const n = state.notes.get(state.currentNoteId);
    if (n) exportNoteAsMd(n);
  }
  else if (!meta && e.key.toLowerCase() === 't') {
    const tag = document.activeElement?.tagName?.toLowerCase();

    if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) {
      return;
    }

    e.preventDefault();
    cycleAppearanceMode();
  }
  else if (meta && e.key === '/') {
    e.preventDefault();

    if (isMobileViewport()) {
      setView(state.view === 'preview' ? 'edit' : 'preview');
    } else {
      setView(state.view === 'split' ? 'preview' : 'split');
    }
  }
  else if (e.key === 'Escape') {
    closeImageModal();
    closeShareModal();
    closeMenu();
    closePalette();

    if (state.surface === 'calendar') {
      if (history.state?.surface === 'calendar') {
        history.back();
      } else {
        closeCalendar({ surface: 'dashboard' });
        showDashboard({
          folderId: state.dashboardFolderId || null,
          push: true,
        });
      }

      return;
    }

    if (!$('graphOverlay').hidden) closeGraph();

    $('dropOverlay').hidden = true;
  }
}

function setupGlobalDropImport() {
  const overlay = $('dropOverlay');
  let hideTimer = null;
  const isFileDrag = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    overlay.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { overlay.hidden = true; }, 120);
  });
  window.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    clearTimeout(hideTimer);
    overlay.hidden = true;
    const items = e.dataTransfer.items ? [...e.dataTransfer.items] : [];
    const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    const hasDir = entries.some((en) => en && en.isDirectory);
    if (hasDir) {
      const collected = [];
      for (const en of entries) try { collected.push(...(await walkEntry(en, []))); } catch {}
      if (collected.length) await importItems(collected);
      else toast('Folder was empty', 'error');
      return;
    }
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (files.length === 1 && files[0].type.startsWith('image/')) {
      openImageModal();
      await pickImageFile(files[0]);
      return;
    }
    const importable = files.filter((f) =>
      /\.(yanta|md|markdown|txt|json|zip|excalidraw|svg)$/i.test(f.name) ||
      /\.excalidraw\.json$/i.test(f.name) ||
      f.type === 'application/json' || f.type === 'application/zip' ||
      f.type === 'text/markdown' || f.type === 'text/plain' ||
      f.type === 'image/svg+xml'
    );
    if (importable.length) await importFiles(importable);
    else toast('Drop .yanta, .md, .markdown, .txt, .zip, or YANTA .json files', 'error');
  });
}

function setupDivider() {
  const div = $('divider');
  let dragging = false;
  div.addEventListener('mousedown', (e) => { dragging = true; div.classList.add('dragging'); document.body.style.cursor = 'col-resize'; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const panes = $('panes').getBoundingClientRect();
    const pct = Math.min(85, Math.max(15, ((e.clientX - panes.left) / panes.width) * 100));
    document.documentElement.style.setProperty('--split', pct + '%');
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    div.classList.remove('dragging');
    document.body.style.cursor = '';
  });
}

function setupPaneScrollSync() {
  const pvPane = $('panePreview');
  const preview = $('preview');
  if (!pvPane || !preview) return;

  const sync = {
    raf: 0,

    // Smooth follower
    followRaf: 0,
    followEl: null,
    followTarget: 0,
    followMax: 0,

    // Nur Scroll-Events dieses Elements werden als programmatic ignoriert.
    programmaticEl: null,
    programmaticUntil: 0,
    releaseTimer: 0,

    // User möchte gerade selbst in einem Pane scrollen.
    manualEl: null,
    manualUntil: 0,

    measureTimer: 0,
    measuring: false,
    measureAgain: false,

    editorTops: [],
    previewTops: [],
    maxEditor: 1,
    maxPreview: 1,
  };

  function editorScroller() {
    return getView()?.scrollDOM || null;
  }

  function paneForTarget(target) {
    const scroller = editorScroller();

    if (scroller && (target === scroller || scroller.contains(target))) {
      return scroller;
    }

    if (target === pvPane || pvPane.contains(target)) {
      return pvPane;
    }

    return null;
  }

  function markProgrammatic(el) {
    sync.programmaticEl = el;
    sync.programmaticUntil = performance.now() + 120;

    clearTimeout(sync.releaseTimer);
    sync.releaseTimer = setTimeout(() => {
      if (performance.now() >= sync.programmaticUntil) {
        sync.programmaticEl = null;
      }
    }, 140);
  }

  function stopFollower() {
    if (sync.followRaf) {
      cancelAnimationFrame(sync.followRaf);
      sync.followRaf = 0;
    }

    sync.followEl = null;
    sync.programmaticEl = null;
    sync.programmaticUntil = 0;
  }

  function noteManualIntent(el) {
    if (!el) return;

    sync.manualEl = el;
    sync.manualUntil = performance.now() + 300;

    // Wenn der User genau das Pane anfassen will, das gerade automatisch
    // bewegt wird, muss die Automatik sofort loslassen.
    if (el === sync.followEl) {
      stopFollower();
    }
  }

  document.addEventListener('wheel', (e) => {
    noteManualIntent(paneForTarget(e.target));
  }, { capture: true, passive: true });

  document.addEventListener('touchstart', (e) => {
    noteManualIntent(paneForTarget(e.target));
  }, { capture: true, passive: true });

  document.addEventListener('mousedown', (e) => {
    noteManualIntent(paneForTarget(e.target));
  }, { capture: true, passive: true });

  const setProgrammaticScrollTop = (el, top, max) => {
    if (!el) return;

    const target = Math.max(0, Math.min(max || 0, top || 0));

    sync.followEl = el;
    sync.followTarget = target;
    sync.followMax = max || 0;

    if (!sync.followRaf) {
      sync.followRaf = requestAnimationFrame(animateFollower);
    }
  };

  function animateFollower() {
    sync.followRaf = 0;

    const el = sync.followEl;
    if (!el) return;

    if (state.view !== 'split') {
      stopFollower();
      return;
    }

    // Wenn der User gerade im Ziel-Pane selbst scrollen will: loslassen.
    if (el === sync.manualEl && performance.now() < sync.manualUntil) {
      stopFollower();
      return;
    }

    const target = Math.max(0, Math.min(sync.followMax || 0, sync.followTarget || 0));
    const current = el.scrollTop;
    const diff = target - current;

    if (Math.abs(diff) < 0.6) {
      markProgrammatic(el);
      el.scrollTop = target;
      sync.followEl = null;
      return;
    }

    // Höher = direkter, niedriger = weicher/träger.
    const factor = 0.32;

    markProgrammatic(el);
    el.scrollTop = current + diff * factor;

    sync.followRaf = requestAnimationFrame(animateFollower);
  }

  const scheduleMeasure = () => {
    if (sync.measuring) {
      sync.measureAgain = true;
      return;
    }

    clearTimeout(sync.measureTimer);
    sync.measureTimer = setTimeout(() => {
      requestAnimationFrame(() => measureAndAlign(sync));
    }, 120);
  };

  function mapScroll(sourceTop, sourceTops, targetTops, fallbackRatio, sourceMax, targetMax) {
    if (!sourceTops.length || !targetTops.length) {
      return fallbackRatio * targetMax;
    }

    let lo = 0;
    let hi = sourceTops.length - 1;

    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (sourceTops[mid] <= sourceTop) lo = mid;
      else hi = mid - 1;
    }

    const i = lo;

    const a0 = sourceTops[i] ?? 0;
    const a1 = sourceTops[i + 1] ?? sourceMax;
    const b0 = targetTops[i] ?? 0;
    const b1 = targetTops[i + 1] ?? targetMax;

    const spanA = Math.max(1, a1 - a0);
    const t = Math.max(0, Math.min(1, (sourceTop - a0) / spanA));

    return b0 + t * (b1 - b0);
  }

  function editorToPreview() {
    if (state.view !== 'split') return;

    const v = getView();
    if (!v) return;

    const scroller = v.scrollDOM;
    if (!scroller) return;

    cancelAnimationFrame(sync.raf);
    sync.raf = requestAnimationFrame(() => {
      const ratio = scroller.scrollTop / Math.max(1, sync.maxEditor);

      const target = mapScroll(
        scroller.scrollTop,
        sync.editorTops,
        sync.previewTops,
        ratio,
        sync.maxEditor,
        sync.maxPreview
      );

      setProgrammaticScrollTop(pvPane, target, sync.maxPreview);
    });
  }

  function previewToEditor() {
    if (state.view !== 'split') return;

    const v = getView();
    if (!v) return;

    const scroller = v.scrollDOM;
    if (!scroller) return;

    cancelAnimationFrame(sync.raf);
    sync.raf = requestAnimationFrame(() => {
      const ratio = pvPane.scrollTop / Math.max(1, sync.maxPreview);

      const target = mapScroll(
        pvPane.scrollTop,
        sync.previewTops,
        sync.editorTops,
        ratio,
        sync.maxPreview,
        sync.maxEditor
      );

      setProgrammaticScrollTop(scroller, target, sync.maxEditor);
    });
  }

  document.addEventListener('scroll', (e) => {
    const v = getView();
    if (!v) return;

    const scroller = v.scrollDOM;
    const target = e.target;
    const now = performance.now();

    // Nur Scroll-Events des automatisch bewegten Elements ignorieren.
    // Scroll-Events des aktiven User-Panes müssen weiterhin durchkommen.
    if (
      target === sync.programmaticEl &&
      now < sync.programmaticUntil &&
      !(target === sync.manualEl && now < sync.manualUntil)
    ) {
      return;
    }

    if (target === scroller) {
      editorToPreview();
    } else if (target === pvPane) {
      previewToEditor();
    }
  }, { capture: true, passive: true });

  window.addEventListener('resize', scheduleMeasure);
  window.addEventListener('yanta-preview-rendered', scheduleMeasure);

  window.addEventListener('yanta-editor-geometry-change', () => {
    if (sync.measuring) {
      sync.measureAgain = true;
      return;
    }

    scheduleMeasure();
  });

  preview.addEventListener('load', scheduleMeasure, true);

  scheduleMeasure();
}

function measureAndAlign(sync) {
  const v = getView();
  const pvPane = $('panePreview');
  const preview = $('preview');

  if (!v || !pvPane || !preview) return;

  if (sync.measuring) {
    sync.measureAgain = true;
    return;
  }

  sync.measuring = true;

  requestAnimationFrame(() => {
    rebuildScrollMaps(sync);

    sync.measuring = false;

    if (sync.measureAgain) {
      sync.measureAgain = false;
      clearTimeout(sync.measureTimer);
      sync.measureTimer = setTimeout(() => {
        requestAnimationFrame(() => measureAndAlign(sync));
      }, 160);
    }
  });
}

function rebuildScrollMaps(sync) {
  const v = getView();
  const pvPane = $('panePreview');
  const preview = $('preview');

  if (!v || !pvPane || !preview) return;

  const scroller = v.scrollDOM;
  const doc = v.state.doc;
  const lineCount = doc.lines;

  const editorTops = new Array(lineCount).fill(0);
  const previewTops = new Array(lineCount).fill(0);

  for (let i = 1; i <= lineCount; i++) {
    const line = doc.line(i);
    const block = v.lineBlockAt(line.from);
    editorTops[i - 1] = Math.round(block.top || 0);
  }

  const paneRect = pvPane.getBoundingClientRect();

  for (const el of preview.querySelectorAll('.pv-line[data-line]')) {
    const i = parseInt(el.dataset.line, 10);
    if (Number.isNaN(i) || i < 0 || i >= lineCount) continue;

    const r = el.getBoundingClientRect();
    previewTops[i] = Math.round(r.top - paneRect.top + pvPane.scrollTop);
  }

  sync.editorTops = editorTops;
  sync.previewTops = previewTops;
  sync.maxEditor = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
  sync.maxPreview = Math.max(1, pvPane.scrollHeight - pvPane.clientHeight);
}

init().catch((e) => {
  console.error(e);
  toast('Failed to start: ' + e.message, 'error');
});
