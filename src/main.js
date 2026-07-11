// ============================================================
// YANTA — Main entry point. Wires DOM events, hotkeys, drop overlay,
// pane divider, history navigation, view modes.
// ============================================================

import { $, state, store, openDB, toast, cssColorToHex, safeCssColor, lucide, lucideCalendarDay, debounce } from './core.js';
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
  searchHaystack,
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
import { getNoteDoc, noteMarkdown } from './yjs.js';
import {
  closeShareModal,
  stopSharing,
  restoreSharedNotes,
  handleShareUrl,
  renderShareIndicator,
} from './sharing.js';

import {
  openUnifiedShareModal,
  closeUnifiedShareModal,
  openPublicSharesManager,
} from './public-share/public-share-ui.js';

import {
  setupPublicShareAutoPublisher,
} from './public-share/public-share-publisher.js';
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
  suppressDashboardAnimationsFor,
} from './dashboard.js';

import {
  setupDashboardMultiSelect,
} from './dashboard-multiselect.js';

import {
  setupDashboardContextMenu,
} from './dashboard-context-menu.js';

import {
  setupFloatingCreate,
} from './floating-create.js';

import {
  vaultJsonSnapshot,
  getVaultDoc,
  vaultNotesMap,
  vaultFoldersMap,
  vaultImagesMap,
  vaultTombstonesMap,
  safeJsonClone,
  encodeCompactVaultState,
  encodeVaultState,
} from './sync2/vault-doc.js';

import {
  createSync2DebugAppRuntime,
  createSync2BrokerAppRuntime,
  createSync2GoogleDriveAppRuntime,
  createSync2YantaCloudAppRuntime,
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
  dashboardUrl,
  dashboardState,
  noteUrl,
  noteState,
  calendarUrl,
  calendarState,
  pushCalendarHistory,
  replaceCalendarHistory,
  pushCalendarEventHistory,
  replaceCalendarEventHistory,
  chatUrl,
  chatState,
  pushChatHistory,
  replaceChatHistory,
} from './navigation.js';
import {
  openCalendar,
  openCalendarEvent,
  openCalendarFromHistory,
  openCalendarPane,
  openNewCalendarEvent,
  closeCalendar,
  closeCalendarPane,
  calendarChoiceDialog,
  setupCalendarVaultBridge,
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
  openMobileSidebar,
} from './mobile-sidebar.js';
import {
  openCreateMenu,
  runCreateAction,
} from './create-actions.js';
import {
  setupAssistant,
  openAssistantSmart,
  openAssistantPane,
  openAssistantFloating,
} from './ai/assistant-ui.js';
import {
  setupSync2ProgressUi,
} from './sync2/sync-progress-ui.js';
import {
  setupSyncReminderUi,
} from './sync2/sync-reminder-ui.js';
import {
  setupRss,
  openRssInbox,
  closeRssFullscreenUI,
  closeRssSourcesManagerUI,
} from './rss/rss-ui.js';
import {
  setupOverlayHistoryRouter,
} from './overlay-history.js';
import {
  setupNoteChrome,
} from './note-chrome.js';
import {
  createSidebarFootActions,
  renderSidebarFootActions,
  createSidebarFootOverflowMenuItems,
} from './sidebar-foot-actions.js';
import {
  ensureAiSessionsFolder,
} from './ai/ai-sessions.js';
import {
  bindMediaTimestampClicks,
} from './media/media-timestamps.js';
import {
  ensureLegalFooter,
} from './site/legal-footer.js';
import {
  mountSidebarLegalLinks,
} from './site/sidebar-legal-links.js';
import {
  setupSlides,
} from './slides/slides-ui.js';

import {
  openPresentationPairingInputModal,
} from './presentation/presentation-pairing.js';

import { revokeImageObjectUrl } from './media/object-url-cache.js';

import {
  setupAndroidBridge,
} from './native/android-bridge.js';

import {
  scheduleChatAutoResume,
  installChatAccountReadyListener,
  startChatSession,
  repairChatEncryptionBackupNow,
} from './chat/matrix-session.js';

import {
  ensureChatAccountAndOpen,
} from './chat/chat-onboarding-ui.js';

import {
  setupChat,
  openChat,
  openChatFloating,
  closeChat,
  jumpToMessageFromSearch,
} from './chat/chat-ui.js';

import {
  resolveMatrixClient,
} from './chat/chat-actions.js';

import {
  openGlobalChatSearch,
} from './chat/chat-search.js';

import {
  pickAndImportYantaChatExport,
} from './chat/chat-export.js';

import {
  setupChatNotifications,
} from './chat/chat-notifications.js';

let sharePreviewLocked = false;

let noteTitleSaveTimer = 0;

function scheduleCurrentNoteTitleSave() {
  clearTimeout(noteTitleSaveTimer);

  noteTitleSaveTimer = window.setTimeout(() => {
    saveCurrentNote().catch((err) => {
      console.warn('[YANTA] title autosave failed', err);
    });
  }, 450);
}

async function flushCurrentNoteTitleSave() {
  clearTimeout(noteTitleSaveTimer);
  noteTitleSaveTimer = 0;

  await saveCurrentNote();
}

const MOBILE_MQ = window.matchMedia('(max-width: 880px)');
const DESKTOP_SIDEBAR_MQ = window.matchMedia('(min-width: 881px)');
let sidebarCollapsedPref = false;

function isMobileViewport() {
  return MOBILE_MQ.matches;
}

function ensureSidebarBackdropVisible(visible) {
  const backdrop = $('sidebarBackdrop') || document.querySelector('.sidebar-backdrop');

  if (!backdrop) return;

  backdrop.hidden = !visible;
}

function updateDesktopOverlaySidebarOffset() {
  const sidebar = $('sidebar');

  const offset =
    DESKTOP_SIDEBAR_MQ.matches && sidebar
      ? Math.round(sidebar.getBoundingClientRect().width || 0)
      : 0;

  document.documentElement.style.setProperty(
    '--yanta-desktop-overlay-left',
    `${offset}px`
  );
}

function updateSidebarFootCalendarIcon() {
  const foot = $('sidebarFoot') || document.querySelector('.sidebar-foot');
  if (!foot) return;

  const candidates = [
    ...foot.querySelectorAll('button, a, [role="button"]'),
  ];

  const calendarButton = candidates.find((node) => {
    const hay = [
      node.getAttribute('title') || '',
      node.getAttribute('aria-label') || '',
      node.dataset?.action || '',
      node.dataset?.key || '',
      node.textContent || '',
    ].join(' ').toLowerCase();

    return hay.includes('calendar') || hay.includes('kalender');
  });

  if (!calendarButton) return;

  const iconHtml = lucideCalendarDay(15);
  const existingSvg = calendarButton.querySelector('svg');

  if (existingSvg) {
    existingSvg.outerHTML = iconHtml;
  } else {
    calendarButton.insertAdjacentHTML('afterbegin', iconHtml);
  }
}

function scheduleSidebarFootCalendarIconRefresh() {
  updateSidebarFootCalendarIcon();

  const now = new Date();
  const nextMidnight = new Date(now);

  nextMidnight.setHours(24, 0, 5, 0);

  window.setTimeout(() => {
    updateSidebarFootCalendarIcon();

    window.setInterval(() => {
      updateSidebarFootCalendarIcon();
    }, 24 * 60 * 60 * 1000);
  }, Math.max(1000, nextMidnight.getTime() - now.getTime()));
}

function ensureChatSidebarBadgeCss() {
  if (document.getElementById('yanta-chat-sidebar-badge-css')) return;

  const style = document.createElement('style');

  style.id = 'yanta-chat-sidebar-badge-css';
  style.textContent = `
.sidebar-foot button,
.sidebar-foot a,
.sidebar-foot [role="button"] {
  position: relative;
}

.has-chat-unread {
  position: relative;
}

.yanta-chat-sidebar-badge {
  position: absolute;
  top: -2px;
  right: -1px;
  min-width: 14px;
  height: 14px;
  display: inline-grid;
  place-items: center;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent, #ef4444);
  color: #fff;
  font-size: 10px;
  font-weight: 850;
  line-height: 1;
  box-shadow: 0 0 0 2px var(--bg-elev);
  pointer-events: none;
}

.yanta-chat-sidebar-badge[hidden] {
  display: none !important;
}
`;

  document.head.append(style);
}

function chatSidebarButtons() {
  const scope =
    $('sidebarFoot') ||
    document.querySelector('.sidebar-foot') ||
    null;

  if (!scope) return [];

  return [
    ...scope.querySelectorAll('button, a, [role="button"]'),
  ].filter((node) => {
    const hay = [
      node.getAttribute('title') || '',
      node.getAttribute('aria-label') || '',
      node.dataset?.action || '',
      node.dataset?.key || '',
      node.textContent || '',
    ].join(' ').toLowerCase();

    return hay.includes('chat');
  });
}

function updateChatSidebarBadge(count = 0) {
  ensureChatSidebarBadgeCss();

  const n = Math.max(0, Number(count || 0));
  const buttons = chatSidebarButtons();

  for (const node of buttons) {
    let badge = node.querySelector(':scope > .yanta-chat-sidebar-badge');

    if (!n) {
      badge?.remove();
      node.classList.remove('has-chat-unread');
      node.removeAttribute('data-chat-unread-count');
      continue;
    }

    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'yanta-chat-sidebar-badge';
      node.append(badge);
    }

    badge.textContent = n > 99 ? '99+' : String(n);
    node.classList.add('has-chat-unread');
    node.dataset.chatUnreadCount = String(n);
  }
}

function installChatSidebarBadgeListener() {
  ensureChatSidebarBadgeCss();

  window.addEventListener('yanta-chat-unread-changed', (e) => {
    updateChatSidebarBadge(e.detail?.count || 0);
  });

  /*
    Warum:
    Sidebar-Foot-Actions werden später dynamisch gerendert. Wenn der Badge
    vorher schon bekannt war, wird er nach dem Render erneut angelegt.
  */
  window.addEventListener('yanta-sidebar-resized', () => {
    const last = Number(
      document.querySelector('.has-chat-unread')?.dataset?.chatUnreadCount || 0
    );

    if (last > 0) {
      updateChatSidebarBadge(last);
    }
  });
}

function openMobileSidebarSafe() {
  if (!isMobileViewport()) return;

  try {
    openMobileSidebar();
  } catch {}
}

function closeMobileSidebarSafe() {
  try {
    /*
      Sidebar action cleanup must be UI-only.

      If this used the normal closeMobileSidebar(), it could call
      history.back() and accidentally close the overlay/route that was
      just opened from the sidebar.
    */
    closeMobileSidebar({
      fromHistory: true,
    });
  } catch {}
}

function replaceMobileSidebarOverlayWithCurrentRoute() {
  if (history.state?.yantaOverlay !== 'mobile-sidebar') return;
  const appSurface =
    state.surface ||
    $('app')?.dataset?.surface ||
    'dashboard';
  if (appSurface === 'chat') {
    /*
      Die Chat-Room-Id steckt noch im URL-Hash (#chat/<roomId>), da der
      Sidebar-Overlay-Eintrag die URL nicht verändert.
    */
    const route = parseAppHash();
    history.replaceState(
      chatState(route.roomId || null),
      '',
      chatUrl(route.roomId || null)
    );
    return;
  }
  if (
    appSurface === 'calendar' ||
    $('calendarSurface')?.hidden === false
  ) {
    history.replaceState(
      calendarState(),
      '',
      calendarUrl()
    );
    return;
  }
  if (appSurface === 'note' && state.currentNoteId) {
    history.replaceState(
      noteState(state.currentNoteId),
      '',
      noteUrl(state.currentNoteId)
    );
    return;
  }
  history.replaceState(
    dashboardState(state.dashboardFolderId || null),
    '',
    dashboardUrl(state.dashboardFolderId || null)
  );
}

function openCalendarRoute({
  replace = false,
} = {}) {
  /*
    If Calendar is launched from the mobile sidebar, remove the sidebar
    overlay entry first. Otherwise Back from Calendar would reopen the
    sidebar instead of returning to Dashboard/Note.
  */
  replaceMobileSidebarOverlayWithCurrentRoute();

  openCalendar({
    push: false,
    replace: false,
  });

  if (replace) {
    replaceCalendarHistory();
  } else {
    pushCalendarHistory();
  }
}

function openCalendarEventRoute(eventId, {
  replace = false,
} = {}) {
  const id = String(eventId || '').trim();

  if (!id) {
    openCalendarRoute({
      replace,
    });
    return;
  }

  replaceMobileSidebarOverlayWithCurrentRoute();

  openCalendarEvent(id, {
    push: false,
    replace: false,
  });

  if (replace) {
    replaceCalendarEventHistory(id);
  } else {
    pushCalendarEventHistory(id);
  }
}

async function openChatRoute(roomId = null, {
  replace = false,
} = {}) {
  replaceMobileSidebarOverlayWithCurrentRoute();

  const id = String(roomId || '').trim() || null;

  if (replace) {
    replaceChatHistory(id);
  } else {
    pushChatHistory(id);
  }

  await openChat({
    roomId: id || '',
    fromHistory: true,
    push: false,
    replace: false,
    mode: 'surface',
  });
}

async function openSourcesRoute(source = 'unknown') {
  /*
    If Sources is launched from the mobile sidebar, let the upcoming
    rss-fullscreen overlay replace the sidebar overlay entry.
    pushOverlayState() does that centrally.
    We only make sure the sidebar cleanup afterwards is UI-only.
  */
  return runCreateAction('rss', {
    source,
  });
}

function closeTransientFullscreenUiForAppRoute(route = {}) {
  const targetSurface = route.surface || null;

  /*
    Programmatic navigation via history.pushState does not emit popstate.
    Therefore fullscreen overlays/surfaces must be closed explicitly when
    an actual app route is opened.
  */

  // Graph fullscreen overlay.
  closeGraph({
    fromHistory: true,
  });

  // RSS fullscreen + source manager.
  closeRssSourcesManagerUI();
  closeRssFullscreenUI();

  // Chat fullscreen surface should only stay visible on chat routes.
  if (targetSurface !== 'chat') {
    closeChat({
      fromHistory: true,
    });
  }

  // Calendar fullscreen surface should only stay visible on calendar routes.
  if (targetSurface !== 'calendar') {
    closeCalendar({
      surface: targetSurface === 'dashboard' ? 'dashboard' : 'note',
      fromRouteChange: true,
    });
  }
}

let sync2Auto = {
  engine: null,
  timer: 0,
  running: false,
  started: false,

  catchupTimer: 0,
  catchupRunning: false,

  silentResumeTimer: 0,
  silentResumeRunning: false,
};

const SYNC2_NOTE_BODY_IDLE_MS = 4_000;
const SYNC2_NOTE_META_IDLE_MS = 1_500;
const SYNC2_CALENDAR_IDLE_MS = 3_000;
const SYNC2_FOCUS_MIN_INTERVAL_MS = 20_000;

function isRemoteOrInternalSyncEvent(detail = {}) {
  const source = String(detail.source || '');
  const reason = String(detail.reason || '');

  return (
    source === 'sync' ||
    source === 'sync2' ||
    source === 'public-share' ||
    reason.startsWith('sync2-') ||
    reason.includes('sync2') ||
    reason === 'public-share-status'
  );
}

function isHighFrequencyNoteEdit(detail = {}) {
  const reason = String(detail.reason || '');

  return (
    reason === 'body-change' ||
    reason === 'drawing-change' ||
    reason === 'task-toggle' ||
    reason === 'external-insert'
  );
}

function clearPendingSync2AutoSync() {
  clearTimeout(sync2Auto.timer);
  sync2Auto.timer = 0;
}

async function flushSync2AutoSync(reason = 'flush', {
  interactive = false,
  catchUp = false,
} = {}) {
  clearPendingSync2AutoSync();

  return runSync2Now(reason, {
    interactive,
    catchUp,
  });
}

async function tryStartYantaCloudRuntime({
  syncNow = false,
  catchUp = false,
} = {}) {
  const provider = await store.settings.get('sync2.provider', null).catch(() => null);

  if (provider !== 'yanta-cloud') {
    return null;
  }

  const vaultId = await store.settings.get('sync2.yantaCloud.vaultId', null);
  const baseUrl = await store.settings.get('sync2.yantaCloud.baseUrl', '');

  if (!vaultId) {
    return null;
  }

  const runtime = await createSync2YantaCloudAppRuntime({
    baseUrl,
    vaultId,
  });

  window.yantaSync2 = runtime;

  startSync2AutoSync(runtime.engine, {
    catchUp,
  });

  if (syncNow) {
    await runSync2Now('yanta-cloud-runtime-started', {
      interactive: false,
      catchUp,
    });
  }

  return runtime;
}

async function tryStartGoogleDriveRuntime({
  prompt = '',
  syncNow = false,
  catchUp = false,
} = {}) {
  const provider = await store.settings.get('sync2.provider', null).catch(() => null);

  if (provider !== 'google-drive') {
    return null;
  }

  const runtime = await createSync2GoogleDriveAppRuntime({
    googlePrompt: prompt,
  });

  window.yantaSync2 = runtime;

  startSync2AutoSync(runtime.engine, {
    catchUp,
  });

  if (syncNow) {
    await runSync2Now('runtime-started', {
      interactive: false,
      catchUp,
    });
  }

  return runtime;
}

async function runSync2Now(reason = 'manual', {
  interactive = false,
  catchUp = false,
} = {}) {
  if (!sync2Auto.engine) {
    const provider = await store.settings.get('sync2.provider', null).catch(() => null);

    try {
      if (provider === 'google-drive') {
        await tryStartGoogleDriveRuntime({
          prompt: interactive ? 'consent' : '',
          syncNow: false,
          catchUp: false,
        });
      }

      if (provider === 'yanta-cloud') {
        await tryStartYantaCloudRuntime({
          syncNow: false,
          catchUp: false,
        });
      }
    } catch (err) {
      if (interactive) {
        throw err;
      }

      console.info('[YANTA Sync2] runtime unavailable for sync:', reason, err?.message || err);
      return null;
    }
  }

  const engine = sync2Auto.engine;

  if (!engine) return null;

  if (navigator.onLine === false) return null;

  if (engine.uploadBlockedUntil && engine.uploadBlockedUntil > Date.now()) {
    console.info('[YANTA Sync2] upload currently rate-limited; skipping sync:', reason);

    return engine.status?.();
  }

  if (sync2Auto.running) {
    return engine.status?.();
  }

  if (engine.uploading) {
    console.info('[YANTA Sync2] upload already running; skipping sync:', reason);
    return engine.status?.();
  }

  sync2Auto.running = true;

  try {
    console.debug('[YANTA Sync2] sync start:', reason);

    await engine.observeAllKnownNotes();

    suppressDashboardAnimationsFor(2500);

    await engine.syncNow({
      verbose: false,

      /*
        Routine sync:
        - Updates prüfen reicht.
        - Snapshot-Scan pro Note ist teuer und laut.
        - Full snapshot/pullSnapshots nur bei explizitem catchUp/Repair/Erst-Pull.
      */
      pullSnapshots: catchUp === true,
    });

    if (catchUp) {
      console.debug('[YANTA Sync2] catch-up snapshot start:', reason);

      await engine.observeAllKnownNotes();

      await engine.pushFullStateNow({
        includeSnapshots: true,
        verbose: false,
      });

      await engine.syncNow({
        verbose: false,
        pullSnapshots: true,
      });

      await store.settings.set('sync2.lastCatchupSnapshotAt', Date.now());
    }

    console.debug('[YANTA Sync2] sync done:', reason);

    return engine.status();
  } catch (err) {
    console.warn('[YANTA Sync2] sync failed:', reason, err);
    throw err;
  } finally {
    sync2Auto.running = false;
  }
}

function requestSync2AutoSync(reason = 'manual', delay = 1200) {
  const blockedUntil = sync2Auto.engine?.uploadBlockedUntil || 0;

  if (blockedUntil > Date.now()) {
    delay = Math.max(delay, blockedUntil - Date.now() + 1500);
  }

  clearTimeout(sync2Auto.timer);

  sync2Auto.timer = window.setTimeout(() => {
    runSync2Now(reason, {
      interactive: false,
      catchUp: false,
    }).catch(() => {});
  }, delay);
}

function requestSync2CatchupSnapshot(reason = 'catchup', delay = 2500) {
  clearTimeout(sync2Auto.catchupTimer);

  sync2Auto.catchupTimer = window.setTimeout(() => {
    runSync2Now(reason, {
      interactive: false,
      catchUp: true,
    }).catch(() => {});
  }, delay);
}

function startSync2AutoSync(engine, {
  catchUp = true,
} = {}) {
  if (!engine) return;

  sync2Auto.engine = engine;

  if (sync2Auto.started) {
    requestSync2AutoSync('runtime-replaced', 300);

    if (catchUp) {
      requestSync2CatchupSnapshot('runtime-replaced', 2500);
    }

    return;
  }

  sync2Auto.started = true;

  requestSync2AutoSync('startup', 1000);

  if (catchUp) {
    requestSync2CatchupSnapshot('startup-catchup', 2500);
  }

  let lastFocusSyncRequestAt = 0;

  window.addEventListener('focus', () => {
    const t = Date.now();

    if (t - lastFocusSyncRequestAt > SYNC2_FOCUS_MIN_INTERVAL_MS) {
      lastFocusSyncRequestAt = t;

      requestSync2AutoSync('focus', 1200);
    }

    ensureGoogleDriveSyncSilently('focus');
  });

  window.addEventListener('online', () => {
    requestSync2AutoSync('online', 300);
    ensureGoogleDriveSyncSilently('online');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushSync2AutoSync('visibility-hidden', {
        interactive: false,
        catchUp: false,
      }).catch(() => {});

      return;
    }

    requestSync2AutoSync('visibility', 500);
    ensureGoogleDriveSyncSilently('visibility');
  });

  window.addEventListener('yanta-note-closing', () => {
    requestSync2AutoSync('note-closing', 0);
  });

  window.addEventListener('yanta-note-updated', (e) => {
    const detail = e.detail || {};

    if (isRemoteOrInternalSyncEvent(detail)) return;

    const reason = String(detail.reason || 'note-updated');

    requestSync2AutoSync(
      `note-updated:${reason}`,
      isHighFrequencyNoteEdit(detail)
        ? SYNC2_NOTE_BODY_IDLE_MS
        : SYNC2_NOTE_META_IDLE_MS
    );
  });

  window.addEventListener('yanta-folder-updated', (e) => {
    const detail = e.detail || {};

    if (isRemoteOrInternalSyncEvent(detail)) return;

    requestSync2AutoSync('folder-updated', SYNC2_NOTE_META_IDLE_MS);
  });

  /*
    Dashboard refresh is UI-only. Real data changes emit note/folder/calendar events.
  */

  window.addEventListener('yanta-calendar-updated', (e) => {
    const detail = e.detail || {};

    if (isRemoteOrInternalSyncEvent(detail)) return;

    requestSync2AutoSync('calendar-updated', SYNC2_CALENDAR_IDLE_MS);
  });

  /*
    Do not sync from yanta-vault-hydrated.
    syncNow() hydrates the vault after pull. Syncing again from that event
    can create a loop.
  */

  window.setInterval(() => {
    if (!document.hidden) {
      requestSync2AutoSync('interval', 0);
      ensureGoogleDriveSyncSilently('interval');
    }
  }, 300_000);
}

async function ensureGoogleDriveSyncSilently(reason = 'silent') {
  if (sync2Auto.engine) return;
  if (navigator.onLine === false) return;

  const provider = await store.settings.get('sync2.provider', null).catch(() => null);

  if (provider !== 'google-drive') return;
  if (sync2Auto.silentResumeRunning) return;

  clearTimeout(sync2Auto.silentResumeTimer);

  sync2Auto.silentResumeTimer = window.setTimeout(async () => {
    if (sync2Auto.engine) return;
    if (sync2Auto.silentResumeRunning) return;
    if (navigator.onLine === false) return;

    sync2Auto.silentResumeRunning = true;

    try {
      console.info('[YANTA Sync2] trying silent Google Drive resume:', reason);

      const runtime = await tryStartGoogleDriveRuntime({
        prompt: '',
        syncNow: false,
        catchUp: true,
      });

      if (runtime) {
        console.info('[YANTA Sync2] silent Google Drive resume successful', {
          deviceId: runtime.deviceId,
        });
      }
    } catch (err) {
      if (err?.code === 'EAUTH_REQUIRED') {
        console.info('[YANTA Sync2] Google sign-in required.');
        return;
      }

      console.info('[YANTA Sync2] silent Google Drive resume unavailable:', err?.message || err);
    } finally {
      sync2Auto.silentResumeRunning = false;
    }
  }, 600);
}

function registerSync2Runtime(runtime, {
  catchUp = false,
  syncNow = false,
  reason = 'runtime-registered',
} = {}) {
  if (!runtime?.engine) return null;

  window.yantaSync2 = runtime;

  startSync2AutoSync(runtime.engine, {
    catchUp,
  });

  if (syncNow) {
    requestSync2AutoSync(reason, 300);
  }

  return runtime;
}

window.yantaRegisterSync2Runtime = registerSync2Runtime;

window.addEventListener('yanta-sync2-runtime-ready', (e) => {
  const runtime = e.detail?.runtime;

  if (!runtime?.engine) return;

  registerSync2Runtime(runtime, {
    catchUp: e.detail?.catchUp === true,
    syncNow: e.detail?.syncNow !== false,
    reason: e.detail?.reason || 'runtime-event',
  });
});

window.yantaSync2Now = async (options = {}) => {
  return runSync2Now('manual-console', {
    interactive: !!options.interactive,
    catchUp: !!options.catchUp,
  });
};

window.yantaSync2CatchupNow = async (options = {}) => {
  return runSync2Now('manual-catchup-console', {
    interactive: !!options.interactive,
    catchUp: true,
  });
};

window.yantaSync2CompactNow = async (options = {}) => {
  const engine =
    sync2Auto.engine ||
    window.yantaSync2?.engine ||
    null;

  if (!engine) {
    throw new Error('YANTA Cloud Sync engine is not running.');
  }

  const {
    compactYantaCloudStorage,
  } = await import('./sync2/cloud-compaction.js');

  const result = await compactYantaCloudStorage(engine, {
    emergencyHeadroom: options.emergencyHeadroom !== false,
    minHeadroomBytes: options.minHeadroomBytes,
    keepSnapshotsPerDoc: options.keepSnapshotsPerDoc,
    dropCoveredLocalOutbox: options.dropCoveredLocalOutbox !== false,
  });

  toast(
    `Cloud storage compacted · freed ${(result.freedBytes / 1024 / 1024).toFixed(2)} MB`,
    'success'
  );

  return result;
};

window.yantaSync2Debug = async () => {
  const engine =
    sync2Auto.engine ||
    window.yantaSync2?.engine ||
    null;

  const [
    vaultDoc,
    cloudApi,
  ] = await Promise.all([
    import('./sync2/vault-doc.js'),
    import('./cloud/cloud-api.js'),
  ]);

  const compactVaultBytes = vaultDoc.encodeCompactVaultState().byteLength;

  let status = null;
  let breakdown = null;
  let index = [];

  try {
    status = await engine?.status?.();
  } catch {}

  try {
    index = await engine?.loadRemoteIndex?.({
      force: true,
    }) || [];
  } catch {}

  try {
    const vaultId =
      window.yantaSync2?.vaultId ||
      engine?.vaultId ||
      await store.settings.get('sync2.yantaCloud.vaultId', '');

    const deviceId =
      window.yantaSync2?.deviceId ||
      engine?.deviceId ||
      '';

    if (vaultId) {
      breakdown = await cloudApi.cloudStorageBreakdown(vaultId, {
        deviceId,
      });
    }
  } catch (err) {
    breakdown = {
      error: err?.message || String(err),
    };
  }

  const kindOf = (path = '') => {
    const p = String(path || '');

    if (p.includes('/vault/heads/')) return 'vault-head';
    if (p.includes('/vault/updates/')) return 'vault-update';
    if (p.includes('/vault/snapshots/')) return 'vault-snapshot';

    if (p.includes('/docs/') && p.includes('/heads/')) return 'note-head';
    if (p.includes('/docs/') && p.includes('/updates/')) return 'note-update';
    if (p.includes('/docs/') && p.includes('/snapshots/')) return 'note-snapshot';

    if (p.includes('/assets/')) return 'asset';

    return 'other';
  };

  const docGroup = (path = '') => {
    const m = String(path || '').match(/^yanta-sync-v1\/docs\/([^/]+)\//);
    return m ? m[1] : '';
  };

  const byKind = new Map();

  for (const entry of index) {
    const kind = kindOf(entry.path);
    const prev = byKind.get(kind) || {
      kind,
      count: 0,
      bytes: 0,
    };

    prev.count += 1;
    prev.bytes += Number(entry.size || 0);

    byKind.set(kind, prev);
  }

  const docs = new Map();

  for (const entry of index) {
    const group = docGroup(entry.path);
    if (!group) continue;

    const rec = docs.get(group) || {
      docGroup: group,
      heads: 0,
      headBytes: 0,
      headLatest: 0,
      snapshots: 0,
      snapshotBytes: 0,
      snapshotLatest: 0,
      updates: 0,
      updateBytes: 0,
      updateLatest: 0,
      updateOldest: Infinity,
    };

    const kind = kindOf(entry.path);
    const size = Number(entry.size || 0);
    const updated = Number(entry.updated || 0);

    if (kind === 'note-head') {
      rec.heads++;
      rec.headBytes += size;
      rec.headLatest = Math.max(rec.headLatest, updated);
    }

    if (kind === 'note-snapshot') {
      rec.snapshots++;
      rec.snapshotBytes += size;
      rec.snapshotLatest = Math.max(rec.snapshotLatest, updated);
    }

    if (kind === 'note-update') {
      rec.updates++;
      rec.updateBytes += size;
      rec.updateLatest = Math.max(rec.updateLatest, updated);
      rec.updateOldest = Math.min(rec.updateOldest, updated);
    }

    docs.set(group, rec);
  }

  const docGroups = [...docs.values()]
    .map((rec) => ({
      ...rec,
      updateOldest: Number.isFinite(rec.updateOldest) ? rec.updateOldest : 0,
      orphanUpdates: rec.updates > 0 && rec.heads === 0 && rec.snapshots === 0,
      updatesCoveredByHead:
        rec.updates > 0 &&
        rec.headLatest > 0 &&
        rec.updateLatest <= rec.headLatest,
      updatesCoveredBySnapshot:
        rec.updates > 0 &&
        rec.snapshotLatest > 0 &&
        rec.updateLatest <= rec.snapshotLatest,
    }))
    .sort((a, b) => b.updateBytes - a.updateBytes);

  const outbox = Array.isArray(engine?.outbox)
    ? engine.outbox.map((item) => ({
        kind: item.kind,
        noteId: item.noteId || null,
        bytes: Number(item.update?.byteLength || 0),
        full: item.full === true,
        compact: item.compact === true,
        reason: item.reason || '',
      }))
    : [];

  const result = {
    compactVaultBytes,
    status,
    outbox,
    breakdown,
    groups: [...byKind.values()].sort((a, b) => b.bytes - a.bytes),
    largestDocJournals: docGroups.slice(0, 20),
    orphanNoteUpdateBytes: docGroups
      .filter((x) => x.orphanUpdates)
      .reduce((sum, x) => sum + x.updateBytes, 0),
    headCoveredNoteUpdateBytes: docGroups
      .filter((x) => x.updatesCoveredByHead)
      .reduce((sum, x) => sum + x.updateBytes, 0),
    snapshotCoveredNoteUpdateBytes: docGroups
      .filter((x) => x.updatesCoveredBySnapshot)
      .reduce((sum, x) => sum + x.updateBytes, 0),
  };

  console.table(result.groups);
  console.table(result.largestDocJournals);

  return result;
};

window.yantaChatDebugUndecryptable = async (roomId = '') => {
  const mod = await import('./chat/matrix-session.js');

  return mod.debugChatUndecryptableEvents(window.yantaChatSession?.client, {
    roomId,
    limit: 200,
  });
};

window.yantaChatRetryDecryptNow = async () => {
  const mod = await import('./chat/matrix-session.js');

  return mod.retryDecryptKnownChatEvents(window.yantaChatSession?.client, {
    reason: 'manual-console',
    maxEvents: 2000,
  });
};

const SEARCH_INDEX_BATCH = 12;

function buildSearchIndexInBackground() {
  // Sofort: schneller Titel/Tags-Index, damit Suche ab Frame 1 funktioniert.
  for (const note of state.notes.values()) {
    if (!state.searchIndex.has(note.id)) {
      state.searchIndex.set(note.id, searchHaystack(note, ''));
    }
  }

  const ids = [...state.notes.keys()];
  let i = 0;

  const scheduleNext = (fn) => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(fn, { timeout: 800 });
    } else {
      setTimeout(fn, 24);
    }
  };

  return new Promise((resolve) => {
    const step = async () => {
      const slice = ids.slice(i, i + SEARCH_INDEX_BATCH);
      i += SEARCH_INDEX_BATCH;

      await Promise.all(slice.map(async (id) => {
        const note = state.notes.get(id);
        if (!note) return;
        try {
          const entry = getNoteDoc(id);
          await entry.ready;
          state.searchIndex.set(id, searchHaystack(note, noteMarkdown(id)));
        } catch {
          state.searchIndex.set(id, searchHaystack(note, ''));
        }
      }));

      if (i < ids.length) {
        scheduleNext(step);
      } else {
        resolve();
      }
    };
    scheduleNext(step);
  });
}

function cleanUndefinedForStartupHydrate(obj = {}) {
  const out = {};

  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== undefined) out[key] = value;
  }

  return out;
}

function finiteNumberOrUndefinedForStartupHydrate(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function sanitizeStartupPublicShareMeta(share) {
  if (!share || typeof share !== 'object') return undefined;

  const shareId = String(share.shareId || share.id || '').trim();
  if (!shareId) return undefined;

  return cleanUndefinedForStartupHydrate({
    enabled: share.enabled !== false,
    shareId,
    shareKey: share.shareKey ? String(share.shareKey) : undefined,
    url: share.url ? String(share.url) : undefined,

    status: share.status ? String(share.status) : undefined,
    expiresAt: share.expiresAt || share.expires_at || null,
    revokedAt: share.revokedAt || share.revoked_at || null,

    lastPublishedAt: share.lastPublishedAt || share.last_published_at || null,
    lastPayloadHash: share.lastPayloadHash || undefined,
  });
}

function sanitizeStartupNoteMeta(note) {
  if (!note || typeof note !== 'object') return null;

  return cleanUndefinedForStartupHydrate({
    id: String(note.id || ''),
    title: String(note.title || 'Untitled'),
    type: String(note.type || 'markdown'),
    folderId: note.folderId || null,
    tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
    pinned: !!note.pinned,
    icon: note.icon || undefined,
    color: note.color || undefined,
    publicShare: sanitizeStartupPublicShareMeta(note.publicShare),
    created: Number(note.created || Date.now()),
    updated: Number(note.updated || Date.now()),
    layoutUpdated: finiteNumberOrUndefinedForStartupHydrate(note.layoutUpdated),
    bodyMigrated: note.bodyMigrated === true ? true : undefined,

    dashboardOrder: finiteNumberOrUndefinedForStartupHydrate(note.dashboardOrder),
    dashboardPinnedOrder: finiteNumberOrUndefinedForStartupHydrate(note.dashboardPinnedOrder),
    dashboardHeightPx: finiteNumberOrUndefinedForStartupHydrate(note.dashboardHeightPx),
    dashboardHeight: finiteNumberOrUndefinedForStartupHydrate(note.dashboardHeight),

    hidden: note.hidden === true ? true : undefined,
    archived: note.archived === true ? true : undefined,
    system: note.system === true ? true : undefined,
    aiBrain: note.aiBrain === true ? true : undefined,
    dashboardHidden: note.dashboardHidden === true ? true : undefined,
    hiddenFromDashboard: note.hiddenFromDashboard === true ? true : undefined,

    trashed: note.trashed === true ? true : undefined,
    deletedAt: finiteNumberOrUndefinedForStartupHydrate(note.deletedAt),
    deletedBy: note.deletedBy ? String(note.deletedBy) : undefined,
    trashOriginalFolderId: note.trashOriginalFolderId || undefined,
    trashOriginalFolderPath: Array.isArray(note.trashOriginalFolderPath)
      ? note.trashOriginalFolderPath.map(String)
      : undefined,
  });
}

function sanitizeStartupFolderMeta(folder) {
  if (!folder || typeof folder !== 'object') return null;

  return cleanUndefinedForStartupHydrate({
    id: String(folder.id || ''),
    name: String(folder.name || 'Folder'),
    parentId: folder.parentId || null,
    icon: folder.icon || undefined,
    color: folder.color || undefined,
    created: Number(folder.created || Date.now()),
    updated: Number(folder.updated || folder.created || Date.now()),
    layoutUpdated: finiteNumberOrUndefinedForStartupHydrate(folder.layoutUpdated),

    dashboardOrder: finiteNumberOrUndefinedForStartupHydrate(folder.dashboardOrder),
    dashboardHeightPx: finiteNumberOrUndefinedForStartupHydrate(folder.dashboardHeightPx),
    dashboardHeight: finiteNumberOrUndefinedForStartupHydrate(folder.dashboardHeight),

    hidden: folder.hidden === true ? true : undefined,
    archived: folder.archived === true ? true : undefined,
    system: folder.system === true ? true : undefined,
    aiBrain: folder.aiBrain === true ? true : undefined,
    dashboardHidden: folder.dashboardHidden === true ? true : undefined,
    hiddenFromDashboard: folder.hiddenFromDashboard === true ? true : undefined,

    trashed: folder.trashed === true ? true : undefined,
    deletedAt: finiteNumberOrUndefinedForStartupHydrate(folder.deletedAt),
    deletedBy: folder.deletedBy ? String(folder.deletedBy) : undefined,
    trashOriginalParentId: folder.trashOriginalParentId || undefined,
    trashOriginalParentPath: Array.isArray(folder.trashOriginalParentPath)
      ? folder.trashOriginalParentPath.map(String)
      : undefined,
  });
}

function sanitizeStartupImageMeta(image) {
  if (!image || typeof image !== 'object') return null;

  const { blob, data, ...rest } = image;

  return cleanUndefinedForStartupHydrate({
    id: String(rest.id || ''),
    name: rest.name ? String(rest.name) : undefined,
    size: Number(rest.size || 0),
    type: rest.type ? String(rest.type) : undefined,
    ts: Number(rest.ts || rest.updated || Date.now()),
    updated: Number(rest.updated || rest.ts || Date.now()),

    // Asset-key architecture v2.
    encryptionVersion: Number(rest.encryptionVersion || 1),
    objectId: rest.objectId ? String(rest.objectId) : undefined,
    objectPath: rest.objectPath ? String(rest.objectPath) : undefined,
    keyVersion: Number(rest.keyVersion || 1),
    keyAlg: rest.keyAlg ? String(rest.keyAlg) : undefined,
    encryptedAssetKeyForVault: rest.encryptedAssetKeyForVault
      ? String(rest.encryptedAssetKeyForVault)
      : undefined,
  });
}

function jsonEqualForStartupHydrate(a, b) {
  try {
    return JSON.stringify(a || null) === JSON.stringify(b || null);
  } catch {
    return false;
  }
}

async function hydrateLocalMetadataFromVaultDocOnStartup() {
  /*
    Critical startup path:
    store.notes may not yet contain metadata for notes created on another device.
    VaultDoc is persisted locally by y-indexeddb and is available before cloud sync.
    Hydrate state/store from VaultDoc now, before route/dashboard render.
  */

  const tombstones = vaultTombstonesMap();

  let changed = false;

  for (const [id, t] of tombstones) {
    if (t?.type === 'note') {
      if (state.notes.has(id) || state.searchIndex.has(id)) {
        changed = true;
      }

      state.notes.delete(id);
      state.searchIndex.delete(id);

      try {
        await store.notes.del(id);
      } catch {}
    }

    if (t?.type === 'folder') {
      if (state.folders.has(id) || state.expandedFolders.has(id)) {
        changed = true;
      }

      state.folders.delete(id);
      state.expandedFolders.delete(id);

      try {
        await store.folders.del(id);
      } catch {}
    }

    if (t?.type === 'image') {
      if (state.imagesMeta.has(id) || state.imageBlobs.has(id)) {
        changed = true;
      }

      state.imagesMeta.delete(id);

      revokeImageObjectUrl(id);

      try {
        await store.images.del(id);
      } catch {}
    }
  }

  for (const [id, raw] of vaultFoldersMap()) {
    if (tombstones.has(id)) continue;

    const incoming = sanitizeStartupFolderMeta(raw);
    if (!incoming?.id) continue;

    const existing = state.folders.get(id);
    const next = safeJsonClone(incoming);

    if (!jsonEqualForStartupHydrate(existing, next)) {
      changed = true;
      state.folders.set(id, next);

      try {
        await store.folders.put(safeJsonClone(next));
      } catch {}
    }
  }

  for (const [id, raw] of vaultNotesMap()) {
    if (tombstones.has(id)) continue;

    const incoming = sanitizeStartupNoteMeta(raw);
    if (!incoming?.id) continue;

    const existing = state.notes.get(id);
    const next = safeJsonClone(incoming);

    if (!jsonEqualForStartupHydrate(existing, next)) {
      changed = true;
      state.notes.set(id, next);

      try {
        await store.notes.put(safeJsonClone(next));
      } catch {}
    }
  }

  for (const [id, raw] of vaultImagesMap()) {
    if (tombstones.has(id)) continue;

    const incoming = sanitizeStartupImageMeta(raw);
    if (!incoming?.id) continue;

    const existing = state.imagesMeta.get(id);
    const next = safeJsonClone(incoming);

    if (!jsonEqualForStartupHydrate(existing, next)) {
      changed = true;
      state.imagesMeta.set(id, next);
    }
  }

  if (changed) {
    rebuildWikilinkIndex();
  }

  return {
    changed,
    notes: state.notes.size,
    folders: state.folders.size,
    images: state.imagesMeta.size,
  };
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // In dev lieber nicht cachen, sonst debuggt man alte Bundles.
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.info('[YANTA PWA] Service worker registered', reg.scope);
      })
      .catch((err) => {
        console.warn('[YANTA PWA] Service worker registration failed', err);
      });
  });
}

const PUBLIC_SHARE_PENDING_EVENT_KEY = 'yanta.publicShare.pendingCalendarEvent.v1';

function consumePendingPublicShareCalendarEvent() {
  let raw = '';

  try {
    raw = sessionStorage.getItem(PUBLIC_SHARE_PENDING_EVENT_KEY) || '';
    sessionStorage.removeItem(PUBLIC_SHARE_PENDING_EVENT_KEY);
  } catch {}

  if (!raw) return false;

  let event = null;

  try {
    event = JSON.parse(raw);
  } catch {
    return false;
  }

  if (!event?.start) return false;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      openCalendar({
        push: false,
        replace: false,
      });

      openNewCalendarEvent({
        ...event,
        id: undefined,
        title: event.title || '',
      });
    });
  });

  return true;
}

function presentPairPayloadFromHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#/, '');

  if (!raw.startsWith('present-pair=')) return '';

  try {
    return decodeURIComponent(raw.slice('present-pair='.length));
  } catch {
    return raw.slice('present-pair='.length);
  }
}

async function handlePresentPairHashIfNeeded(hash = location.hash) {
  const payload = presentPairPayloadFromHash(hash);

  if (!payload) return false;

  history.replaceState({}, '', location.pathname + location.search);

  try {
    const {
      handlePresentationPairingPayload,
    } = await import('./presentation/presentation-pairing.js');

    await handlePresentationPairingPayload(payload);
    return true;
  } catch (err) {
    console.error('[YANTA Presentation] pairing failed', err);
    toast(err?.message || 'Could not read presentation pairing code', 'error');
    return false;
  }
}

async function init() {
  await openDB();

  installChatAccountReadyListener();

  window.yantaOpenChat = async ({
    account = null,
    source = 'manual',
  } = {}) => {
    if (account) {
      const session = await startChatSession({
        account,
        firstDevice: source === 'chat-provision',
        reason: source,
      });

      await openChatRoute(null, {
        replace: true,
      });

      return session;
    }

    return ensureChatAccountAndOpen({
      source,
    });
  };

  /**
   * Manually repairs Matrix Key Backup.
   *
   * Run this from DevTools on a device that can still decrypt old messages:
   *   await window.yantaChatRepairEncryptionNow()
   */
  window.yantaChatRepairEncryptionNow = async () => {
    return repairChatEncryptionBackupNow({
      reason: 'manual-console',
    });
  };

  window.yantaChatKeyDebug = async () => {
    const session = window.yantaChatSession;
    if (!session?.client) {
      throw new Error('Chat session is not running.');
    }

    const crypto = await import('./chat/matrix-crypto.js');

    const exported = await crypto.exportChatRoomKeysToVault(session.client, {
      reason: 'manual-debug-export',
    });

    const imported = await crypto.importChatRoomKeysFromVault(session.client, {
      reason: 'manual-debug-import',
    });

    return {
      userId: session.client.getUserId?.(),
      deviceId: session.client.getDeviceId?.(),
      exported,
      imported,
      vaultHasRoomKeys: !!(await crypto.readChatRoomKeysFromVault()),
    };
  };

  try {
    /*
      Chat auto-resume must be installed even without local Matrix credentials.
      Why:
      On a newly synced device, Matrix credentials are intentionally absent.
      The synced Vault chatAccount entry is the real cross-device signal.
    */
    scheduleChatAutoResume();
  } catch (err) {
    console.warn('[YANTA Chat] auto-resume setup failed', err);
    toast('Could not set up Chat auto-resume.', 'error');
  }

  registerServiceWorker();

  // Initialize the native browser navigation router
  setupOverlayHistoryRouter();
  setupAndroidBridge();
  installChatSidebarBadgeListener();

  window.addEventListener('yanta-app-route-change', (e) => {
    closeTransientFullscreenUiForAppRoute(e.detail || {});
  });

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

  await hydrateLocalMetadataFromVaultDocOnStartup();

  // Debug helper. Maybe remove later.
  window.yantaVaultDebug = {
    getVaultDoc,
    vaultJsonSnapshot,
  };

  try {
    const provider = await store.settings.get('sync2.provider', null);
  
    window.yantaStartGoogleDriveSync = async ({
      prompt = 'consent',
      syncNow = true,
      catchUp = true,
    } = {}) => {
      const runtime = await tryStartGoogleDriveRuntime({
        prompt,
        syncNow: false,
        catchUp,
      });
    
      if (!runtime) {
        throw new Error('Could not start Google Drive Sync runtime');
      }
    
      console.info('[YANTA Sync2] Google Drive runtime ready', {
        deviceId: runtime.deviceId,
      });
    
      if (syncNow) {
        await runSync2Now('runtime-started', {
          interactive: false,
          catchUp,
        });
      }
    
      return runtime;
    };
      
    if (provider === 'yanta-cloud') {
      console.info('[YANTA Sync2] YANTA Cloud is configured. Trying resume.');

      /*
        Wichtig:
        Für YANTA Cloud beim normalen App-Start KEIN catchUp.
        catchUp macht pushFullStateNow() und erzeugt neue Snapshots.
        Das ist nur für explizite Reparatur-/Debug-Aktionen sinnvoll.
      */
      tryStartYantaCloudRuntime({
        syncNow: false,
        catchUp: false,
      }).catch((err) => {
        console.info('[YANTA Sync2] YANTA Cloud resume unavailable:', err?.message || err);
      });
    }
    else if (provider === 'google-drive') {
      console.info('[YANTA Sync2] Google Drive is configured. Trying silent resume.');
    
      ensureGoogleDriveSyncSilently('app-start');
    } else if (import.meta.env.DEV) {
      window.yantaSync2 = await createSync2DebugAppRuntime();
    
      console.info('[YANTA Sync2] debug runtime ready', {
        deviceId: window.yantaSync2.deviceId,
        syncKey: window.yantaSync2.syncKey,
      });
    }
  } catch (err) {
    console.warn('[YANTA Sync2] runtime setup failed', err);
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

  window.yantaOpenGoogleDriveSyncSetup = async () => {
    const { openGoogleDriveSyncSetup } = await import('./sync2/sync-setup-ui.js');
    openGoogleDriveSyncSetup();
  };

  window.yantaOpenGoogleDriveSyncSetupWithPayload = async (payload) => {
    const { openGoogleDriveSyncSetupWithPayload } = await import('./sync2/sync-setup-ui.js');
    await openGoogleDriveSyncSetupWithPayload(payload);
  };
  
  window.yantaGoogleDriveSyncDebug = async () => {
    const { GoogleDriveObjectStore } = await import('./sync2/google-drive-object-store.js');
  
    const remote = new GoogleDriveObjectStore({
      clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      initialPrompt: 'consent',
    });
  
    await remote.init();
  
    const files = await remote.listAllYantaFiles();
  
    console.table(files.map((f) => ({
      id: f.id,
      name: f.name,
      path: f.path,
      size: f.size,
      updated: f.updated,
    })));
  
    return files;
  };
  
  window.yantaGoogleDriveSyncDeleteAll = async () => {
    const { GoogleDriveObjectStore } = await import('./sync2/google-drive-object-store.js');
  
    const remote = new GoogleDriveObjectStore({
      clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      initialPrompt: 'consent',
    });
  
    await remote.init();
  
    const result = await remote.deleteAllYantaFiles({
      onProgress({ deleted, total, file }) {
        console.log(`[YANTA Sync2] deleted ${deleted}/${total}`, file.path || file.name);
      },
    });
  
    console.info('[YANTA Sync2] Google Drive Sync objects deleted', result);
  
    return result;
  };

  const sync2HashPayload = (() => {
    const raw = String(location.hash || '').replace(/^#/, '');
  
    if (!raw.startsWith('sync2=')) return '';
  
    try {
      return decodeURIComponent(raw.slice('sync2='.length));
    } catch {
      return raw.slice('sync2='.length);
    }
  })();

  const presentationPairingHashPayload = (() => {
    const raw = String(location.hash || '').replace(/^#/, '');

    if (!raw.startsWith('present-pair=')) return '';

    try {
      return decodeURIComponent(raw.slice('present-pair='.length));
    } catch {
      return raw.slice('present-pair='.length);
    }
  })();
  
  if (sync2HashPayload) {
    // Remove secret from browser URL/history as soon as possible.
    history.replaceState({}, '', location.pathname + location.search);

    setTimeout(async () => {
      try {
        const {
          parseSync2PairingPayload,
        } = await import('./sync2/pairing.js');

        const parsed = parseSync2PairingPayload(sync2HashPayload);

        if (parsed.provider === 'yanta-cloud') {
          const {
            openYantaCloudSetupWithPayload,
          } = await import('./sync2/yanta-cloud-setup-ui.js');

          await openYantaCloudSetupWithPayload(sync2HashPayload);
          return;
        }

        const {
          openGoogleDriveSyncSetupWithPayload,
        } = await import('./sync2/sync-setup-ui.js');

        await openGoogleDriveSyncSetupWithPayload(sync2HashPayload);
      } catch (err) {
        console.error('[YANTA Sync2] pairing payload failed', err);
        toast(err?.message || 'Could not read pairing link', 'error');
      }
    }, 700);
  }

  handlePresentPairHashIfNeeded(location.hash).catch(() => {});

  await loadAppearance();
  await loadCalendarPreferences();

  watchSystemTheme();

  state.expandedFolders = new Set(expanded);

  sidebarCollapsedPref = !!sidebarCollapsed;
  applySidebarCollapsed(sidebarCollapsedPref, { persist: false });
  updateDesktopOverlaySidebarOffset();

  const initialView = isMobileViewport()
    ? (mobileView || (view === 'split' ? 'edit' : view))
    : view;

  setView(initialView, { persist: false });

  rebuildWikilinkIndex();
  buildSearchIndexInBackground();

  async function openChatSearchFromPalette() {
    try {
      const client = await resolveMatrixClient();
  
      if (!client) {
        toast('Chat is not connected.', 'error');
        console.warn('[YANTA Chat] Cannot open palette chat search without client');
        return;
      }
  
      openGlobalChatSearch({
        client,
        onJump: jumpToMessageFromSearch,
      });
    } catch (err) {
      console.warn('[YANTA Chat] Could not open chat search from palette', err);
      toast('Could not open chat search.', 'error');
    }
  }

  buildCommandList({
    openImageModal,
    openIconInsertPicker,
    openDraw: createDrawingAndInsert,
    openGraph,
    openDashboard: () => showDashboard({ push: true }),
    openDashboardPane: () => showDashboardPane({
      folderId: state.dashboardFolderId || null,
    }),
    openCalendar: openCalendarRoute,
    openCalendarPane,
    openChat: () => openChatFloating(),
    openAssistant: openAssistantSmart,
    openAssistantFloating,
    openSources: () => openSourcesRoute('command-palette'),
    openCitationManager,
    openPresentationPairing: openPresentationPairingInputModal,
    exportAsZip,
    exportNoteAsMd,
    exportBundle,
    exportEveryNoteMd,
    openSyncSetup,
    syncFull,
    syncDisconnect,
    cleanupUnusedImages,
    openShareModal: openUnifiedShareModal,
    stopSharing: () => stopSharing(state.currentNoteId),
    openPublicSharesManager,
    importFiles,
    importFolder: () => $('importFolder').click(),
    openChatSearch: openChatSearchFromPalette,
    importChatArchive: pickAndImportYantaChatExport,
  });
  setupGraphInteractions();
  setupWikilinkHover();
  setupImage();
  setupDraw();
  setupSlides();
  setupCalendarVaultBridge();
  setupCitations();
  setupFormatToolbar();
  setupDashboard();
  setupDashboardMultiSelect();
  setupDashboardContextMenu();
  setupAssistant();
  setupFloatingCreate();
  setupRss();
  setupChat();
  setupChatNotifications();
  await ensureAiSessionsFolder();
  window.addEventListener('yanta-public-share-changed', () => {
    renderShareIndicator();
    renderTree();
  });

  window.addEventListener('yanta-public-share-status', () => {
    renderShareIndicator();
    renderTree();
  });

  setupPublicShareAutoPublisher();
  setupSync2ProgressUi();
  setupSyncReminderUi();

  window.addEventListener('yanta-cloud-quota-blocked', async (e) => {
    try {
      const { showCloudQuotaDialog } = await import('./billing/billing-ui.js');

      showCloudQuotaDialog(e.detail || {});
    } catch (err) {
      console.error('[YANTA Billing] Could not show quota dialog', err);
    }
  });

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

  setupNoteChrome({
    openShare: openUnifiedShareModal,
    openImage: openImageModal,
    openCitation: openCitationManager,
    openIcon: openIconInsertPicker,
    createDrawing: createDrawingAndInsert,
    deleteNote: deleteCurrentNote,
    exportNote: (note) => {
      const n = note || state.notes.get(state.currentNoteId);
      if (n) exportNoteAsMd(n);
    },
  });

  renderTree();

// Open initial route.
// Dashboard is Home for normal app entry.
// But direct note/share deep-links must respect browser Back:
// Back should return to the previous website/history entry, not force Dashboard.
if (!sharedOpen?.noteId) {
  const route = parseAppHash();

  if (route.surface === 'chat') {
    await openChatRoute(route.roomId || null, {
      replace: true,
    });

    return;
  }

  if (route.surface === 'calendar') {
    if (route.eventId) {
      openCalendarEventRoute(route.eventId, {
        replace: true,
      });
    } else {
      openCalendarRoute({
        replace: true,
      });
    }

    consumePendingPublicShareCalendarEvent();

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
  // Overlay states are handled by overlay-history.js.
  // Do not let the main app router interpret them as Dashboard/Note routes.
  if (e.state?.yantaOverlay) {
    return;
  }

  const st = e.state || {};
  const route = parseAppHash();

/*
    Chat ist eine Fullscreen-Surface wie Calendar. popstate ruft aber nur die
    Ziel-Branch-Renderer auf; closeTransientFullscreenUiForAppRoute() feuert
    nur bei programmatischer Navigation (yanta-app-route-change), nicht bei
    Browser-/Geräte-Back. Ohne diesen Guard bliebe die Chat-Surface über
    Dashboard/Note/Calendar sichtbar.
  */
  if (
    state.surface === 'chat' &&
    st.surface !== 'chat' &&
    route.surface !== 'chat'
  ) {
    closeChat({
      fromHistory: true,
    });
  }

  if (st.surface === 'calendar' || route.surface === 'calendar') {
    closeGraph();
    closeCalendarPane({ silent: true });
    hideDashboard({ push: false });

    const eventId = st.eventId || route.eventId || null;

    if (eventId) {
      openCalendarEvent(eventId, {
        push: false,
        replace: false,
      });
    } else {
      openCalendarFromHistory();
    }

    return;
  }

  if (st.surface === 'chat' || route.surface === 'chat') {
    closeGraph();
    closeCalendarPane({ silent: true });
    closeCalendar({
      surface: 'dashboard',
      fromRouteChange: true,
    });
    hideDashboard({ push: false });

    await openChat({
      roomId: st.roomId || route.roomId || '',
      fromHistory: true,
      push: false,
      replace: false,
    });

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
    const folderId =
      st.folderId !== undefined
        ? st.folderId
        : route.folderId;

    const targetFolderId =
      folderId && state.folders.has(folderId)
        ? folderId
        : null;

    const calendarWasOpen =
      state.surface === 'calendar' ||
      $('calendarSurface')?.hidden === false;

    closeCalendarPane({ silent: true });

    /*
      Wichtig:
      Beim Back aus einer Note darf closeCalendar() NICHT vorher
      app.dataset.surface = 'dashboard' setzen, sonst ist .panes vor
      startViewTransition() schon display:none.
    */
    if (calendarWasOpen) {
      closeCalendar({ surface: 'dashboard' });

      showDashboard({
        folderId: targetFolderId,
        push: false,
        replace: false,
      });

      return;
    }

    await showDashboardFolderFromHistory(targetFolderId);

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
    updateDesktopOverlaySidebarOffset();

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

function expandSidebarForSearch({
  focus = true,
} = {}) {
  if (DESKTOP_SIDEBAR_MQ.matches) {
    if (sidebarCollapsedPref) {
      sidebarCollapsedPref = false;
      applySidebarCollapsed(false);
    }

    if (focus) {
      window.setTimeout(() => {
        $('search')?.focus();
        $('search')?.select?.();
      }, 240);
    }

    return;
  }

  if (isMobileViewport()) {
    openMobileSidebarSafe();

    if (focus) {
      window.setTimeout(() => {
        $('search')?.focus();
        $('search')?.select?.();
      }, 240);
    }
  }
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
    updateDesktopOverlaySidebarOffset();
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
    return;
  }

  if (kind === 'rss') {
    openRssInbox();
    return;
  }

  if (kind === 'ai') {
    openAssistantPane();
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
    <button class="icon-btn" data-pane-kind="ai" title="AI Assistant">${lucide('sparkles', 15)}</button>

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
    openCalendarRoute();
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
  $('noteTitle')?.addEventListener('input', () => {
    scheduleCurrentNoteTitleSave();
  });

  $('noteTitle')?.addEventListener('blur', () => {
    flushCurrentNoteTitleSave()
      .then(() => renderTree())
      .catch((err) => {
        console.warn('[YANTA] title blur save failed', err);
      });
  });

  $('tagInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addTag(e.target.value);
      e.target.value = '';
    }
  });
  // sidebar

  $('btn-new-note')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  
    openCreateMenu(e.currentTarget, {
      folderId: currentFolderForNew(),
      source: 'sidebar',
      closeMobile: true,
    });
  });
  $('btn-new-folder')?.addEventListener('click', () => newFolder(null));
  $('btn-theme')?.addEventListener('click', cycleAppearanceMode);

  const openImportMenuFrom = (anchor) => {
    if (!anchor) return;

    const r = anchor.getBoundingClientRect();

    showMenu(r.left, r.bottom + 4, [
      {
        label: 'Restore / import files (.yanta / .md / .json / .zip)…',
        action: () => $('importFile')?.click(),
      },
      {
        label: 'Import folder (with sub-folders)…',
        action: () => $('importFolder')?.click(),
      },
      'hr',
      {
        label: 'Or drop files/folders anywhere on the window',
        action: () => toast('Drop files or a folder onto YANTA'),
      },
    ]);
  };

  const sidebarFoot = $('sidebarFoot') || document.querySelector('.sidebar-foot');
  let sidebarFootActions = [];

  const closeMobileAfterSidebarAction = () => {
    closeMobileSidebarSafe();
  };

  const openSidebarFootMenu = (anchor) => {
    if (!anchor || !sidebarFoot) return;

    const r = anchor.getBoundingClientRect();

    const items = createSidebarFootOverflowMenuItems({
      container: sidebarFoot,
      actions: sidebarFootActions,
      menuOnlyActions: [
        {
          key: 'export',
          label: 'Export…',
          closeMobile: false,
          onClick: () => openExportMenu(anchor, showMenu),
        },
        {
          key: 'import',
          label: 'Import…',
          closeMobile: false,
          onClick: () => openImportMenuFrom(anchor),
        },
      ],
      afterAction: closeMobileAfterSidebarAction,
    });

    showMenu(r.left, r.bottom + 4, items);
  };

  sidebarFootActions = createSidebarFootActions({
    openPalette: () => openPalette('commands'),
    openGraph,
    openCalendar: openCalendarRoute,
    openChat: () => openChatRoute(),
    openSources: () => openSourcesRoute('sidebar-foot'),
    openAssistant: openAssistantSmart,
    openMore: openSidebarFootMenu,
  });

  renderSidebarFootActions(
    sidebarFoot,
    sidebarFootActions,
    {
      afterAction: closeMobileAfterSidebarAction,
    }
  );

  updateChatSidebarBadge(
    Number(document.querySelector('.has-chat-unread')?.dataset?.chatUnreadCount || 0)
  );

  // renderSidebarFootActions(
  //   $('sidebarFoot') || document.querySelector('.sidebar-foot'),
  //   createSidebarFootActions({
  //     openPalette: () => openPalette('commands'),
  //     openGraph,
  //     openCalendar: openCalendarRoute,
  //     openSources: () => openSourcesRoute('sidebar-foot'),
  //     openAssistant: openAssistantSmart,
  //     openMore: openSidebarFootMenu,
  //   }),
  //   {
  //     afterAction: () => {
  //       closeMobileSidebarSafe();
  //     },
  //   }
  // );

  mountSidebarLegalLinks({
    container: document.querySelector('.sidebar'),
    showMenu,
  });

  scheduleSidebarFootCalendarIconRefresh();

  window.addEventListener('resize', () => {
    updateDesktopOverlaySidebarOffset();
    updateSidebarFootCalendarIcon();
  });

  window.addEventListener('yanta-sidebar-resized', () => {
    updateSidebarFootCalendarIcon();
  });

  $('importFile')?.addEventListener('change', (e) => { if (e.target.files.length) importFiles([...e.target.files]); e.target.value = ''; });
  $('importFolder')?.addEventListener('change', async (e) => {
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
  $('btn-export-note')?.addEventListener('click', () => {
    const n = state.notes.get(state.currentNoteId);
    if (n) exportNoteAsMd(n);
  });
  // $('btn-images').addEventListener('click', () => { openImageModal(); });

  document.querySelector('.brand')?.addEventListener('click', (e) => {
    e.preventDefault();

    replaceMobileSidebarOverlayWithCurrentRoute();

    showDashboard({
      folderId: null,
      push: true,
    });

    closeMobileSidebarSafe();
  });

  // Sync
  $('vaultIndicator').addEventListener('click', async (e) => {
    e.stopPropagation();

    const provider = await store.settings.get('sync2.provider', null).catch(() => null);

    if (provider === 'yanta-cloud') {
      const { openYantaCloudSetup } = await import('./sync2/yanta-cloud-setup-ui.js');
      await openYantaCloudSetup();
      return;
    }

    if (provider === 'google-drive') {
      const { openGoogleDriveSyncSetup } = await import('./sync2/sync-setup-ui.js');
      openGoogleDriveSyncSetup();
      return;
    }

    /*
      SaaS UX:
      Normal click promotes YANTA Cloud Sync as the recommended path.
      Advanced legacy sync menu remains available via Shift/Alt-click.
    */
    if (e.shiftKey || e.altKey) {
      syncMenu(e.currentTarget, showMenu);
      return;
    }

    const { openYantaCloudSetup } = await import('./sync2/yanta-cloud-setup-ui.js');
    await openYantaCloudSetup();
  });
  $('syncSetupPick')?.addEventListener('click', async () => { closeSyncSetup(); await syncConnect(); });
  document.querySelectorAll('[data-sync-close]').forEach((b) => b.addEventListener('click', closeSyncSetup));
  document.querySelectorAll('[data-conflict-close]').forEach((b) => b.addEventListener('click', () => { $('conflictModal').hidden = true; }));
  window.addEventListener('focus', () => { syncFull(false).catch(() => {}); });

  // Settings
  $('btn-settings').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    /*
      On mobile this button lives inside the sidebar. Opening Settings
      should replace the sidebar overlay history entry and then close
      the sidebar visually only.
    */
    openSettings();
    closeMobileSidebarSafe();
  });

  // Search
  const renderTreeDebounced = debounce(() => renderTree(), 120);
  $('search').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderTreeDebounced();
  });

  window.addEventListener('yanta-expand-sidebar-search', () => {
    expandSidebarForSearch();
  });

  window.addEventListener('yanta-open-mobile-sidebar', () => {
    openMobileSidebarSafe();
  });

  window.addEventListener('yanta-close-mobile-sidebar', () => {
    closeMobileSidebarSafe();
  });

  $('sidebarBackdrop')?.addEventListener('click', () => {
    closeMobileSidebarSafe();
  });

  // View toggles
  $('btn-view-edit')?.addEventListener('click', () => {
    hideDashboard({ push: false });
    setView('edit');
  });

  $('btn-view-split')?.addEventListener('click', () => {
    hideDashboard({ push: false });

    setView('split');
    closeSidePane();

    requestAnimationFrame(() => {
      ensurePreviewPaneSwitcher();
      window.dispatchEvent(new Event('resize'));
    });
  });

  $('btn-view-preview')?.addEventListener('click', () => {
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

  // Share modal
  $('btn-share-copy').addEventListener('click', async () => {
    const v = $('shareLink').value;
    try { await navigator.clipboard.writeText(v); toast('Link copied', 'success'); } catch { toast('Copy failed', 'error'); }
  });
  $('btn-share-stop').addEventListener('click', async () => { await stopSharing(state.currentNoteId); closeShareModal(); });
  document.querySelectorAll('[data-share-close]').forEach((b) => {
    b.addEventListener('click', closeShareModal);
  });

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

  bindMediaTimestampClicks($('preview'), {
    onError: (message) => toast(message, 'error'),
  });

  // Preview interactions
  $('preview').addEventListener('click', (e) => {
    
    const calendarLink = e.target.closest?.('a[href^="#calendar/"]');

    if (calendarLink) {
      e.preventDefault();
      e.stopPropagation();

      const href = calendarLink.getAttribute('href') || '';
      const eventId = decodeURIComponent(href.replace(/^#calendar\//, ''));

      if (eventId) {
        openCalendarEventRoute(eventId);
      }

      return;
    }
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

    // Die eigene Titelzeile liegt jetzt außerhalb von CodeMirror.
    // Klicks dort dürfen NICHT ans Dokumentende fokussieren.
    if (e.target.closest?.('.yanta-pane-title-row')) return;

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

  window.addEventListener('yanta-calendar-event-drop-on-note', async (e) => {
    const detail = e.detail || {};
    const eventId = detail.eventId || '';
    const noteId = detail.noteId || state.currentNoteId || '';

    if (!eventId || !noteId) {
      toast('Calendar event could not be linked here', 'error');
      return;
    }

    try {
      const calendar = await import('./calendar.js');

      await calendar.linkCalendarEventToNote(eventId, noteId, {
        ask: true,
      });
    } catch (err) {
      console.error(err);
      toast('Could not link calendar event to note', 'error');
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

  window.addEventListener('yanta-set-view', (e) => {
    const view = e.detail?.view;

    if (!['edit', 'split', 'preview'].includes(view)) return;

    hideDashboard({ push: false });

    if (view === 'split') {
      closeSidePane();
    }

    setView(view);

    if (view === 'split') {
      requestAnimationFrame(() => {
        ensurePreviewPaneSwitcher();
        window.dispatchEvent(new Event('resize'));
      });
    }
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

  window.addEventListener('hashchange', () => {
    handlePresentPairHashIfNeeded(location.hash).catch(() => {});
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
  // Primary flush triggers. beforeunload is too late/unreliable for async writes.
  const flushOnPageLifecycleEnd = () => {
    flushCurrentNoteTitleSave().catch((err) => {
      console.warn('[YANTA] lifecycle title flush failed', err);
    });
  };

  window.addEventListener('pagehide', flushOnPageLifecycleEnd);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushOnPageLifecycleEnd();
    }
  });

  // Best-effort fallback only. Do not rely on async completion here.
  window.addEventListener('beforeunload', () => {
    if (!state.dirty) return;

    saveCurrentNote().catch(() => {});
  });
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
  else if (meta && e.key === 'k') {
    e.preventDefault();
    expandSidebarForSearch();
  }
  else if (meta && e.key === 's') {
    e.preventDefault();

    saveCurrentNote()
      .then(async () => {
        toast('Saved', 'success');

        try {
          await flushSync2AutoSync('manual-save', {
            interactive: true,
            catchUp: !sync2Auto.engine,
          });

          toast('Saved and synced', 'success');
        } catch (err) {
          console.warn('[YANTA Sync2] manual save sync failed', err);
          toast('Saved locally · Cloud sign-in needed for sync', 'error');
        }
      })
      .catch((err) => {
        console.error(err);
        toast('Save failed', 'error');
      });
  }
  else if (meta && e.key === 'i') { e.preventDefault(); openImageModal(); }
  else if (meta && e.key === 'o') { e.preventDefault(); openPalette('notes'); }
  else if (meta && e.key === 'p') { e.preventDefault(); openPalette('commands'); }
  else if (meta && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    openAssistantSmart();
  }
  else if (meta && e.key === 'g') { e.preventDefault(); openGraph(); }
  else if (meta && e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    openCalendarRoute();
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
    closeUnifiedShareModal();
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

    if (state.surface === 'chat') {
      if (history.state?.surface === 'chat') {
        history.back();
      } else {
        closeChat();
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

const SITE_PAGE_PATHS = new Set([
  '/pricing',
  '/terms',
  '/privacy',
  '/refund',
  '/imprint',
]);

const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';

if (SITE_PAGE_PATHS.has(normalizedPath)) {
  import('./site/site-pages.js')
    .then((m) => m.mountSitePage())
    .catch((e) => {
      console.error(e);
      document.body.innerHTML = '<main style="padding:24px;font-family:system-ui">Could not load page.</main>';
    });
} else if (location.pathname.startsWith('/share/')) {
  import('./public-share/public-share-viewer.js')
    .then(async (m) => {
      await m.mountPublicShareViewer();

      ensureLegalFooter({
        parent: document.body,
        id: 'yanta-public-share-legal-footer',
        variant: 'public',
      });
    })
    .catch((e) => {
      console.error(e);
      document.body.innerHTML = '<main style="padding:24px;font-family:system-ui">Could not load share viewer.</main>';

      ensureLegalFooter({
        parent: document.body,
        id: 'yanta-public-share-error-legal-footer',
        variant: 'public',
      });
    });
} else if (location.pathname === '/present' || location.pathname === '/present/') {
  import('./presentation/presentation-pairing-viewer.js')
    .then(async (m) => {
      await m.mountPresentationPairingViewer();

      ensureLegalFooter({
        parent: document.body,
        id: 'yanta-presentation-pairing-legal-footer',
        variant: 'public',
      });
    })
    .catch((e) => {
      console.error(e);
      document.body.innerHTML = '<main style="padding:24px;font-family:system-ui">Could not open presentation pairing.</main>';

      ensureLegalFooter({
        parent: document.body,
        id: 'yanta-presentation-pairing-error-legal-footer',
        variant: 'public',
      });
    });
} else if (location.pathname.startsWith('/present/')) {
  import('./presentation/presentation-viewer.js')
    .then(async (m) => {
      await m.mountPresentationViewer();

      ensureLegalFooter({
        parent: document.body,
        id: 'yanta-presentation-legal-footer',
        variant: 'public',
      });
    })
    .catch((e) => {
      console.error(e);
      document.body.innerHTML = '<main style="padding:24px;font-family:system-ui">Could not load presentation.</main>';

      ensureLegalFooter({
        parent: document.body,
        id: 'yanta-presentation-error-legal-footer',
        variant: 'public',
      });
    });
  } else if (String(location.hash || '').replace(/^#/, '').startsWith('slides-remote=')) {
    // The remote-control page runs standalone: init() never executes here, so
    // the theme CSS variables (--bg, --text, --accent, …) would be undefined and
    // the control UI would render invisibly. Load appearance first, then mount.
    loadAppearance()
      .catch(() => {})
      .then(() => import('./slides/slides-ui.js'))
      .then((m) => {
        if (!m.mountSlidesRemoteFromHash()) {
          document.body.innerHTML = '<main style="padding:24px;font-family:system-ui">Invalid slideshow remote link.</main>';
        }
        ensureLegalFooter({
          parent: document.body,
          id: 'yanta-slides-remote-legal-footer',
          variant: 'public',
        });
      })
      .catch((e) => {
        console.error(e);
        document.body.innerHTML = '<main style="padding:24px;font-family:system-ui">Could not open slideshow remote.</main>';
        ensureLegalFooter({
          parent: document.body,
          id: 'yanta-slides-remote-error-legal-footer',
          variant: 'public',
        });
      });
  } else {
  init().catch((e) => {
    console.error(e);
    toast('Failed to start: ' + e.message, 'error');
  });
}