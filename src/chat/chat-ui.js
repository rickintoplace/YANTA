// ============================================================
// YANTA Chat — Chat surface: room list + TimelineWindow timeline
// ============================================================

import {
  ensureMatrixLoaded,
} from './matrix-session.js';
/*
  Warum kein statischer matrix-js-sdk-Import:
  Das SDK ist mehrere MB groß und wird über ensureMatrixLoaded() lazy
  geladen. Ein statischer Import hier würde es in das Haupt-Bundle ziehen.
*/
let EventTimeline = null;
let TimelineWindow = null;
async function ensureMatrixSdkClasses() {
  if (TimelineWindow && EventTimeline) return;
  const { sdk } = await ensureMatrixLoaded();
  EventTimeline = sdk.EventTimeline;
  TimelineWindow = sdk.TimelineWindow;
}

import {
  el,
  escapeHtml,
  fmtDate,
  lucide,
  state,
  toast,
  debounce,
} from '../core.js';

import {
  showMenu,
} from '../tree.js';

import {
  pushChatHistory,
  replaceChatHistory,
} from '../navigation.js';

import {
  registerOverlayRoute,
  pushOverlayState,
  replaceOverlayState,
  closeTopOverlay,
  overlayIdFromState,
} from '../overlay-history.js';

import {
  createDm,
  leaveRoom,
  resolveMatrixClient,
  toggleRoomMute,
} from './chat-actions.js';

import {
  mxcToBlobUrl,
  revokeAllChatMediaObjectUrls,
  sendFileMessage,
  sendImageFileWithPreview,
} from './chat-media.js';

import {
  compactTime,
  lastReadableEvent,
  messagePreview,
  renderTimelineEvents,
} from './chat-message-render.js';

import {
  setupChatComposer,
} from './chat-composer.js';

import {
  backfillRoomSearchIndex,
  indexTimelineEventsForSearch,
  openGlobalChatSearch,
  openRoomChatSearch,
} from './chat-search.js';

import {
  openChatExportSheet,
} from './chat-export.js';

import {
  listImportedChatArchives,
  openImportedChatArchive,
} from './chat-archive.js';

import {
  getChatSession,
  scheduleChatAutoResume,
  startChatSession,
} from './matrix-session.js';

import {
  hasEncryptedChatCredentials,
} from './chat-store.js';

import {
  hasVaultChatAccount,
} from './matrix-crypto.js';

import {
  openChatGallery,
} from './chat-gallery.js';

import {
  openChatSettings,
} from './chat-settings.js';

import {
  indexTimelineEventsMedia,
} from './chat-media-index.js';

import {
  decorateTimelineWithYantaEmbeds,
} from './yanta-embeds.js';

import {
  getChatPreferences,
} from './chat-preferences.js';

import {
  chatSettings,
} from './chat-store.js';

import {
  installChatMessageActions,
} from './chat-message-actions.js';

import './chat.css';


const PAGE_SIZE = 30;
const TYPING_THROTTLE_MS = 3500;
const READ_RECEIPT_DEBOUNCE_MS = 650;
const ROOM_LIST_DEFAULT_WIDTH = 320;
const ROOM_LIST_MIN_WIDTH = 72;
const ROOM_LIST_MAX_WIDTH = 460;

const MOBILE_MQ = window.matchMedia('(max-width: 760px)');

const CHAT_FLOATING_OVERLAY_ID = 'chat-floating';

const CHAT_CRYPTO_BANNER_DISMISS_KEY = 'chat.cryptoBanner.dismissed.v1';

let chatOverlayRegistered = false;
let chatMode = 'surface'; // surface | floating
let roomListWidth = ROOM_LIST_DEFAULT_WIDTH;

let initialized = false;
let root = null;
let client = null;

let activeRoomId = '';
let timelineWindow = null;
let timelineLoading = false;
let timelineInitializedFor = '';

let topObserver = null;
let bottomObserver = null;

let roomSearchInput = null;
let roomListEl = null;
let timelineEl = null;
let composerEl = null;
let typingEl = null;

let listenersBoundClient = null;
let sendTypingTimer = 0;
let typingActive = false;

let chatComposer = null;

// Onboarding automatisch öffnen, wenn kein Account existiert.
let onboardingAutoOpenedAt = 0;

let replyTargetEvent = null;
let replyBarEl = null;

async function openChatOnboardingAutomatically() {
  /*
    Ein User ohne Chat-Account soll beim Öffnen von Chat direkt das
    Onboarding sehen.
    Der Zeit-Guard verhindert Modal-Loops, falls ensureClient() durch
    Retry-Aktionen mehrfach läuft.
  */
  if (Date.now() - onboardingAutoOpenedAt < 5000) return;
  onboardingAutoOpenedAt = Date.now();
  try {
    await openChatOnboardingFromUi();
  } catch (err) {
    console.warn('[YANTA Chat] Could not auto-open Chat onboarding', err);
    toast('Could not open Chat setup.', 'error');
  }
}

function isMobile() {
  return MOBILE_MQ.matches;
}

function chatIsOpen() {
  return root && root.hidden === false;
}

function chatFloatingIsOpen() {
  return chatIsOpen() && chatMode === 'floating';
}

function registerChatOverlayRoute() {
  if (chatOverlayRegistered) return;

  chatOverlayRegistered = true;

  registerOverlayRoute(CHAT_FLOATING_OVERLAY_ID, {
    open: async ({ state: overlayState } = {}) => {
      await openChatFloating({
        roomId: overlayState?.roomId || activeRoomId || '',
        fromHistory: true,
      });
    },

    close: () => {
      closeChat({
        fromHistory: true,
      });
    },

    isOpen: chatFloatingIsOpen,
  });
}

function closeChatFromButton() {
  if (chatMode === 'floating') {
    closeChat();
    return;
  }

  if (history.state?.surface === 'chat') {
    history.back();
    return;
  }

  closeChat();
}

function renderChatSetupState({
  title = 'Setting up Chat…',
  message = 'YANTA is waiting for your encrypted Chat account to sync to this device.',
  actionLabel = '',
  action = null,
} = {}) {
  const node = ensureRoot();
  const empty = node.querySelector('[data-chat-empty]');
  const roomShell = node.querySelector('[data-chat-room]');
  if (roomShell) roomShell.hidden = true;
  /*
    Warum:
    Mobile zeigt ohne aktiven Raum nur die Listen-Pane. Der Setup-Zustand
    muss deshalb auch dort sichtbar sein, sonst wirkt Chat leer/kaputt.
  */
  if (roomListEl && !client) {
    roomListEl.replaceChildren();
    roomListEl.insertAdjacentHTML('afterbegin', `
      <div class="yanta-chat-room-empty yanta-chat-room-setup">
        ${lucide('sparkles', 16)}
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(message)}</small>
        ${
          actionLabel
            ? `<button class="btn primary compact" data-chat-setup-action-list>
                 ${escapeHtml(actionLabel)}
               </button>`
            : ''
        }
      </div>
    `);
    const listBtn = roomListEl.querySelector('[data-chat-setup-action-list]');
    if (listBtn && action) {
      listBtn.addEventListener('click', () => {
        action().catch((err) => {
          console.warn('[YANTA Chat] setup action failed', err);
          toast('Could not continue Chat setup.', 'error');
        });
      });
    }
  }
  if (!empty) return;
  empty.hidden = false;
  empty.innerHTML = `
    <div>${lucide('messages-square', 28)}</div>
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(message)}</p>
    ${
      actionLabel
        ? `<button class="btn primary" data-chat-setup-action>
             ${lucide('sparkles', 14)} ${escapeHtml(actionLabel)}
           </button>`
        : ''
    }
  `;
  const btn = empty.querySelector('[data-chat-setup-action]');
  if (btn && action) {
    btn.addEventListener('click', () => {
      action().catch((err) => {
        console.warn('[YANTA Chat] setup action failed', err);
        toast('Could not continue Chat setup.', 'error');
      });
    });
  }
}

async function openChatOnboardingFromUi() {
  const mod = await import('./chat-onboarding-ui.js');

  await mod.ensureChatAccountAndOpen({
    source: 'chat-ui-setup-action',
  });
}

function setChatMode(nextMode = 'surface') {
  chatMode = nextMode === 'floating' ? 'floating' : 'surface';

  if (!root) return;

  root.classList.toggle('is-floating', chatMode === 'floating');
  root.classList.toggle('is-surface', chatMode === 'surface');

  if (chatMode === 'floating') {
    /*
      Keep a floating position only if the user already moved the window.
      Do not force top-left on every room switch.
    */
    if (!root.style.left || root.style.left === '0px') {
      root.style.left = 'calc(100vw - 760px)';
    }

    if (!root.style.top || root.style.top === '0px') {
      root.style.top = '76px';
    }

    root.style.right = 'auto';
    root.style.bottom = 'auto';
  } else {
    /*
      Warum:
      Browser resize on a resizable fixed element writes inline width/height.
      Fullscreen surface must remove those inline dimensions, otherwise it
      keeps the small window size after docking.
    */
    for (const prop of [
      'left',
      'top',
      'right',
      'bottom',
      'width',
      'height',
      'minWidth',
      'minHeight',
      'maxWidth',
      'maxHeight',
    ]) {
      root.style[prop] = '';
    }
  }

  updateFloatingButtons();
}

function roomById(roomId) {
  return client?.getRoom?.(roomId) || null;
}

function visibleRooms() {
  try {
    return client?.getVisibleRooms?.() || client?.getRooms?.() || [];
  } catch (err) {
    console.warn('[YANTA Chat] Could not read rooms', err);
    toast('Could not load chats.', 'error');
    return [];
  }
}

function lastActive(room) {
  try {
    return Number(room.getLastActiveTimestamp?.() || room.getLastModifiedTime?.() || 0);
  } catch {
    return 0;
  }
}

function directAccountData() {
  try {
    return client?.getAccountData?.('m.direct')?.getContent?.() || {};
  } catch {
    return {};
  }
}

function userIdForDirectRoom(roomId) {
  const direct = directAccountData();

  for (const [userId, roomIds] of Object.entries(direct)) {
    if (Array.isArray(roomIds) && roomIds.includes(roomId)) {
      return userId;
    }
  }

  return '';
}

function roomDisplayName(room) {
  if (!room) return 'Chat';

  const directUserId = userIdForDirectRoom(room.roomId);

  if (directUserId) {
    const member = room.getMember?.(directUserId);

    return (
      member?.name ||
      member?.rawDisplayName ||
      member?.displayName ||
      directUserId
    );
  }

  return room.name || room.getDefaultRoomName?.(client?.getUserId?.()) || 'Chat';
}

function roomInitials(room) {
  const name = roomDisplayName(room);

  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'C';
}

function roomAvatarMxc(room) {
  try {
    return room.getMxcAvatarUrl?.() || room.getAvatarUrl?.(client?.baseUrl, 96, 96, 'scale', false, false) || '';
  } catch {
    return '';
  }
}

function isRoomMuted(roomId) {
  try {
    const rule = client?.getRoomPushRule?.('global', roomId);

    return !!rule?.actions?.some?.((action) => action === 'dont_notify');
  } catch {
    return false;
  }
}

function latestEvent(room) {
  try {
    const events = room.getLiveTimeline?.()?.getEvents?.() || [];

    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      const type = event?.getType?.();

      if (type === 'm.room.message' || type === 'm.sticker') {
        return event;
      }
    }
  } catch {}

  return null;
}

function hydrateAvatar(node, room) {
  const mxc = roomAvatarMxc(room);

  if (!mxc || !String(mxc).startsWith('mxc://')) return;

  mxcToBlobUrl(client, mxc, {
    thumbnail: true,
    w: 96,
    h: 96,
  })
    .then((url) => {
      if (!node.isConnected) return;

      node.replaceChildren();

      const img = el('img', {
        alt: roomDisplayName(room),
        loading: 'lazy',
      });

      img.src = url;
      node.append(img);
      node.classList.add('has-image');
    })
    .catch((err) => {
      console.warn('[YANTA Chat] Could not load room avatar', err);
      toast('Could not load chat avatar.', 'error');
    });
}

function ensureRoot() {
  if (root) return root;

  root = el('section', {
    id: 'chatSurface',
    class: 'yanta-chat-surface',
    hidden: true,
    role: 'region',
    'aria-label': 'Chat',
  });

  root.innerHTML = `
    <aside class="yanta-chat-list-pane" data-chat-list-pane>
      <header class="yanta-chat-list-head" data-chat-drag-handle>
        <div class="yanta-chat-title">
          ${lucide('messages-square', 18)}
          <strong>Chat</strong>
        </div>

        <button class="icon-btn" data-chat-new title="New chat" aria-label="New chat">
          ${lucide('message-circle-plus', 17)}
        </button>

        <button class="icon-btn" data-chat-float title="Open as window" aria-label="Open as window">
          ${lucide('picture-in-picture-2', 17)}
        </button>

        <button class="icon-btn" data-chat-close title="Close Chat" aria-label="Close Chat">
          ${lucide('x', 17)}
        </button>
      </header>

      <div class="yanta-chat-search">
        ${lucide('search', 15)}
        <input
          type="search"
          placeholder="Search chats…"
          autocomplete="off"
          spellcheck="false"
          data-chat-search>
      </div>

      <div class="yanta-chat-room-list" data-chat-room-list></div>
    </aside>

    <div class="yanta-chat-list-resizer" data-chat-list-resizer title="Resize chat list"></div>

    <main class="yanta-chat-main-pane" data-chat-main-pane>
      <section class="yanta-chat-empty" data-chat-empty>
        <div>${lucide('message-circle', 28)}</div>
        <strong>Select a chat</strong>
        <p>Your encrypted Matrix conversations appear here.</p>
      </section>

      <section class="yanta-chat-room" data-chat-room hidden>
        <header class="yanta-chat-room-head" data-chat-drag-handle>
          <button class="icon-btn yanta-chat-back" data-chat-back title="Back" aria-label="Back">
            ${lucide('arrow-left', 18)}
          </button>

          <button class="yanta-chat-room-profile" data-chat-profile title="Open chat details">
            <span class="yanta-chat-avatar" data-chat-room-avatar></span>
            <span class="yanta-chat-room-title-wrap">
              <strong data-chat-room-title>Chat</strong>
              <small data-chat-typing hidden></small>
            </span>
          </button>

          <span class="grow"></span>

          <button class="icon-btn" data-chat-search-room title="Search messages" aria-label="Search messages">
            ${lucide('search', 17)}
          </button>

          <button class="icon-btn" data-chat-gallery title="Gallery" aria-label="Gallery">
            ${lucide('images', 17)}
          </button>

          <button class="icon-btn" data-chat-menu title="Chat menu" aria-label="Chat menu">
            ${lucide('ellipsis-vertical', 17)}
          </button>

          <button class="icon-btn" data-chat-float title="Open as window" aria-label="Open as window">
            ${lucide('picture-in-picture-2', 17)}
          </button>

          <button class="icon-btn" data-chat-close title="Close Chat" aria-label="Close Chat">
            ${lucide('x', 17)}
          </button>
        </header>

        <div class="yanta-chat-timeline" data-chat-timeline>
          <div class="yanta-chat-top-sentinel" data-chat-top-sentinel></div>
          <div class="yanta-chat-loading-row" data-chat-loading-row hidden>
            <span class="yanta-chat-spinner"></span>
            <span>Loading older messages…</span>
          </div>
          <div class="yanta-chat-events" data-chat-events></div>
          <div class="yanta-chat-bottom-sentinel" data-chat-bottom-sentinel></div>
        </div>

        <footer class="yanta-chat-composer-wrap">
          <form class="yanta-chat-composer" data-chat-composer>
            <textarea
              rows="1"
              placeholder="Message…"
              enterkeyhint="send"
              data-chat-input></textarea>

            <button class="yanta-chat-send" type="submit" disabled title="Send" aria-label="Send">
              ${lucide('send-horizontal', 18)}
            </button>
          </form>
        </footer>
      </section>
    </main>

    <div class="yanta-chat-connection-banner" data-chat-connection-banner hidden>
      ${lucide('wifi-off', 14)}
      <span data-chat-connection-banner-text>Connection lost.</span>
      <button class="btn compact" data-chat-reconnect-now>
        ${lucide('refresh-cw', 13)}
        Reconnect
      </button>
    </div>

    <div class="yanta-chat-crypto-banner" data-chat-crypto-banner hidden>
      ${lucide('shield-alert', 14)}
      <span data-chat-crypto-banner-text>Chat encryption is being set up…</span>
      <button class="icon-btn" data-chat-crypto-banner-close title="Dismiss" aria-label="Dismiss">
        ${lucide('x', 14)}
      </button>
    </div>
  `;

  document.body.append(root);

  if (!document.getElementById('yanta-chat-jump-highlight-css')) {
    const style = document.createElement('style');
    style.id = 'yanta-chat-jump-highlight-css';
    style.textContent = `
      .yanta-chat-jump-highlight .yanta-chat-bubble,
      .yanta-chat-event.yanta-chat-jump-highlight {
        animation: yanta-chat-jump-pulse 1.8s ease both;
      }

      @keyframes yanta-chat-jump-pulse {
        0%, 100% { box-shadow: none; }
        18%, 70% {
          box-shadow:
            0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent),
            0 12px 36px rgba(0,0,0,.22);
        }
      }
    `;
    document.head.append(style);
  }

  roomSearchInput = root.querySelector('[data-chat-search]');
  roomListEl = root.querySelector('[data-chat-room-list]');
  timelineEl = root.querySelector('[data-chat-timeline]');
  composerEl = root.querySelector('[data-chat-composer]');
  typingEl = root.querySelector('[data-chat-typing]');

  root.style.setProperty('--chat-list-width', `${roomListWidth}px`);

  bindRootEvents();

  installChatMessageActions({
    root,
    getClient: () => client,
    getRoomId: () => activeRoomId,
    getEvents: () => timelineWindow?.getEvents?.() || [],
    onReply: (event) => {
      setReplyTarget(event);
      chatComposer?.focus?.();
    },
    onReload: async () => {
      await reloadActiveTimeline({
        keepBottom: isTimelineNearBottom(),
        scrollBottom: isTimelineNearBottom(),
      });
    },
  });

  bindListPaneResize();
  bindFloatingDrag();

  updateRoomListDensity();

  return root;
}

async function askText({
  title,
  message,
  placeholder,
  confirmLabel,
} = {}) {
  const modules = await Promise.allSettled([
    import('../dialogs.js'),
    import('../inline-ui.js'),
  ]);

  const exportsList = modules
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value);

  const fn = exportsList.find((mod) => typeof mod.yantaPrompt === 'function')?.yantaPrompt;

  if (!fn) {
    toast('Text input is not available.', 'error');
    throw new Error('yantaPrompt is not available.');
  }

  const result = await fn({
    title,
    message,
    placeholder,
    confirmLabel,
  });

  if (result == null) return '';

  if (typeof result === 'object') {
    return String(result.value || result.text || '');
  }

  return String(result || '');
}

async function askConfirm({
  title,
  message,
  confirmLabel = 'Continue',
  danger = false,
} = {}) {
  const modules = await Promise.allSettled([
    import('../dialogs.js'),
    import('../inline-ui.js'),
  ]);

  const exportsList = modules
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value);

  const fn = exportsList.find((mod) => typeof mod.yantaConfirm === 'function')?.yantaConfirm;

  if (!fn) {
    toast('Confirmation dialog is not available.', 'error');
    throw new Error('yantaConfirm is not available.');
  }

  return !!(await fn({
    title,
    message,
    confirmLabel,
    danger,
  }));
}

function bindRootEvents() {
  root.querySelector('[data-chat-new]')?.addEventListener('click', () => {
    openNewChatDialog().catch((err) => {
      console.warn('[YANTA Chat] New chat failed', err);
      toast('Could not start chat.', 'error');
    });
  });

  root.querySelectorAll('[data-chat-close]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeChatFromButton();
    });
  });

  root.querySelectorAll('[data-chat-float]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (chatMode === 'floating') {
        openChat({
          roomId: activeRoomId || '',
          mode: 'surface',
          push: true,
        }).catch((err) => {
          console.warn('[YANTA Chat] Could not dock Chat', err);
          toast('Could not dock Chat.', 'error');
        });

        return;
      }

      openChatFloating({
        roomId: activeRoomId || '',
      }).catch((err) => {
        console.warn('[YANTA Chat] Could not open floating Chat', err);
        toast('Could not open Chat window.', 'error');
      });
    });
  });

  roomSearchInput?.addEventListener('input', () => {
    renderRoomList();
  });

  root.querySelector('[data-chat-back]')?.addEventListener('click', () => {
    if (history.state?.surface === 'chat' && history.state?.roomId) {
      history.back();
      return;
    }

    openChat({
      roomId: '',
      replace: true,
    }).catch((err) => {
      console.warn('[YANTA Chat] Could not go back to chat list', err);
      toast('Could not open chat list.', 'error');
    });
  });

  root.querySelector('[data-chat-profile]')?.addEventListener('click', () => {
    const room = roomById(activeRoomId);

    openChatSettings({
      client,
      roomId: activeRoomId,
      roomName: room ? roomDisplayName(room) : 'Chat',
    }).catch((err) => {
      console.warn('[YANTA Chat] Could not open chat settings', err);
      toast('Could not open chat settings.', 'error');
    });
  });

  root.querySelector('[data-chat-search-room]')?.addEventListener('click', () => {
    const room = roomById(activeRoomId);

    openRoomChatSearch({
      container: root.querySelector('[data-chat-room]'),
      client,
      roomId: activeRoomId,
      roomName: room ? roomDisplayName(room) : 'Chat',
      onJump: jumpToMessageFromSearch,
    });
  });

  root.querySelector('[data-chat-gallery]')?.addEventListener('click', () => {
    const room = roomById(activeRoomId);

    openChatGallery({
      client,
      roomId: activeRoomId,
      roomName: room ? roomDisplayName(room) : 'Chat',
    }).catch((err) => {
      console.warn('[YANTA Chat] Could not open gallery', err);
      toast('Could not open gallery.', 'error');
    });
  });

  root.querySelector('[data-chat-menu]')?.addEventListener('click', (e) => {
    openRoomMenu(e.currentTarget);
  });

  root.querySelector('[data-chat-reconnect-now]')?.addEventListener('click', async () => {
    try {
      const {
        stopChatSession,
        startChatSession,
      } = await import('./matrix-session.js');

      await stopChatSession({
        silent: true,
      });

      await startChatSession({
        forceLogin: true,
        reason: 'manual-reconnect-banner',
      });

      setChatConnectionBanner('');
      toast('Chat reconnected', 'success');
    } catch (err) {
      console.warn('[YANTA Chat] Reconnect failed', err);
      toast('Could not reconnect Chat.', 'error');
    }
  });

  root.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;

    if (!meta) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();

      if (!replyTargetEvent) {
        const target = lastReplyCandidate();

        if (target) setReplyTarget(target);
        return;
      }

      moveReplyTarget(-1);
      return;
    }

    if (e.key === 'ArrowDown' && replyTargetEvent) {
      e.preventDefault();
      moveReplyTarget(1);
    }
  }, true);

  chatComposer = setupChatComposer({
    form: composerEl,
    getClient: () => client,
    getRoomId: () => activeRoomId,

    onSendText: async (text) => {
      await sendCurrentMessage(text);
    },

    onSendImage: async (file) => {
      if (!client || !activeRoomId) {
        toast('Chat is not connected.', 'error');
        throw new Error('Matrix client or active room missing.');
      }

      await sendImageFileWithPreview(client, activeRoomId, file);
      await reloadActiveTimeline({
        keepBottom: true,
        scrollBottom: true,
      });
    },

    onSendFile: async (file) => {
      await sendFileWithOptimisticBubble(file);
    },

    onSent: () => {
      renderRoomListSoon();
      reloadActiveTimelineSoon({
        keepBottom: true,
        scrollBottom: true,
      });
    },
  });

  chatComposer?.input()?.addEventListener('input', () => {
    sendTypingThrottled();
  });

  MOBILE_MQ.addEventListener?.('change', () => {
    updateMobileState();
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-chat-crypto-banner-close]');
    if (!btn) return;

    const banner = root.querySelector('[data-chat-crypto-banner]');
    const text = root.querySelector('[data-chat-crypto-banner-text]')?.textContent || '';

    writeCryptoBannerDismiss(text);

    if (banner) banner.hidden = true;

    e.preventDefault();
    e.stopPropagation();
  }, true);

}

function bindFloatingDrag() {
  if (!root || root.dataset.chatDragBound === '1') return;

  root.dataset.chatDragBound = '1';

  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  function clampPosition(left, top) {
    const r = root.getBoundingClientRect();
    const margin = 8;

    return {
      left: Math.max(margin, Math.min(window.innerWidth - r.width - margin, left)),
      top: Math.max(margin, Math.min(window.innerHeight - r.height - margin, top)),
    };
  }

  function onMove(e) {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    e.preventDefault();

    const next = clampPosition(
      startLeft + e.clientX - startX,
      startTop + e.clientY - startY
    );

    root.style.left = `${next.left}px`;
    root.style.top = `${next.top}px`;
  }

  function onUp(e) {
    if (pointerId != null && e.pointerId !== pointerId) return;

    dragging = false;
    pointerId = null;

    root.classList.remove('is-dragging');

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  }

  root.addEventListener('pointerdown', (e) => {
    if (chatMode !== 'floating') return;

    const handle = e.target.closest?.('[data-chat-drag-handle]');
    if (!handle) return;

    if (e.target.closest?.('button, input, textarea, select, a')) return;
    if (e.button != null && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const r = root.getBoundingClientRect();

    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = r.left;
    startTop = r.top;

    root.classList.add('is-dragging');

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }, true);
}

function updateRoomListDensity() {
  if (!root) return;

  root.style.setProperty('--chat-list-width', `${roomListWidth}px`);

  root.classList.toggle('is-list-collapsed', roomListWidth <= 112);
  root.classList.toggle('is-list-compact', roomListWidth > 112 && roomListWidth < 260);
}

function clampRoomListWidth(value) {
  return Math.max(
    ROOM_LIST_MIN_WIDTH,
    Math.min(ROOM_LIST_MAX_WIDTH, Number(value || ROOM_LIST_DEFAULT_WIDTH))
  );
}

function bindListPaneResize() {
  if (!root || root.dataset.chatListResizeBound === '1') return;

  root.dataset.chatListResizeBound = '1';

  const handle = root.querySelector('[data-chat-list-resizer]');

  if (!handle) return;

  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startWidth = roomListWidth;

  function onMove(e) {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    e.preventDefault();

    roomListWidth = clampRoomListWidth(startWidth + e.clientX - startX);
    updateRoomListDensity();
  }

  function onUp(e) {
    if (pointerId != null && e.pointerId !== pointerId) return;

    dragging = false;
    pointerId = null;

    root.classList.remove('is-resizing-list');

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  }

  handle.addEventListener('pointerdown', (e) => {
    if (isMobile()) return;
    if (e.button != null && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startWidth = roomListWidth;

    root.classList.add('is-resizing-list');

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  });
}

async function openNewChatDialog() {
  const target = await askText({
    title: 'New chat',
    message: 'Enter a Matrix user id or YANTA handle.',
    placeholder: '@alice:matrix.org',
    confirmLabel: 'Start chat',
  });

  const clean = String(target || '').trim();

  if (!clean) return;

  const roomId = await createDm(clean);

  await openChat({
    roomId,
    push: true,
  });
}

function bindClientEvents(nextClient) {
  if (!nextClient || listenersBoundClient === nextClient) return;

  if (listenersBoundClient) {
    try {
      listenersBoundClient.removeListener?.('Room.timeline', onRoomTimeline);
      listenersBoundClient.removeListener?.('Room.receipt', onRoomReceipt);
      listenersBoundClient.removeListener?.('Room.name', onRoomListChange);
      listenersBoundClient.removeListener?.('Room.accountData', onRoomListChange);
      listenersBoundClient.removeListener?.('RoomMember.typing', onTypingChange);
      listenersBoundClient.removeListener?.('sync', onSync);
    } catch (err) {
      console.warn('[YANTA Chat] Could not unbind Matrix listeners', err);
    }
  }

  listenersBoundClient = nextClient;

  nextClient.on?.('Room.timeline', onRoomTimeline);
  nextClient.on?.('Room.receipt', onRoomReceipt);
  nextClient.on?.('Room.name', onRoomListChange);
  nextClient.on?.('Room.accountData', onRoomListChange);
  nextClient.on?.('RoomMember.typing', onTypingChange);
  nextClient.on?.('sync', onSync);
}

function onSync(state, prevState, data = {}) {
  const s = String(state || '').toUpperCase();

  if (
    s === 'ERROR' ||
    s === 'RECONNECTING' ||
    data?.error
  ) {
    setChatConnectionBanner('Connection lost — reconnect');
  } else if (
    s === 'PREPARED' ||
    s === 'SYNCING' ||
    s === 'STARTED'
  ) {
    setChatConnectionBanner('');
  }

  renderRoomListSoon();
  renderTimelineSoon();
}

function onRoomListChange() {
  renderRoomListSoon();
}

function onRoomReceipt() {
  renderTimelineSoon();
}

function onTypingChange() {
  renderTyping();
}

function onRoomTimeline(event, room) {
  renderRoomListSoon();

  const roomId = room?.roomId || event?.getRoomId?.() || '';

  if (roomId === activeRoomId) {
    handleLiveTimelineUpdate({
      roomId,
      eventId: event?.getId?.() || '',
    });
  }
}

const renderRoomListSoon = debounce(() => {
  if (chatIsOpen()) renderRoomList();
}, 120);

const renderTimelineSoon = debounce((options = {}) => {
  if (chatIsOpen() && activeRoomId) {
    renderTimeline(options);
  }
}, 80);

const reloadActiveTimelineSoon = debounce((options = {}) => {
  reloadActiveTimeline(options).catch((err) => {
    console.warn('[YANTA Chat] Could not refresh live timeline', err);
    toast('Could not refresh chat messages.', 'error');
  });
}, 80);

function timelineHasEvent(eventId) {
  if (!eventId || !timelineWindow) return false;

  return timelineWindow
    .getEvents()
    .some((event) => event?.getId?.() === eventId);
}

function currentTimelineReloadLimit() {
  const current = timelineWindow?.getEvents?.()?.length || 0;

  return Math.max(
    PAGE_SIZE,
    Math.min(500, current + PAGE_SIZE)
  );
}

async function reloadActiveTimeline({
  keepBottom = false,
  scrollBottom = false,
} = {}) {
  if (!client || !activeRoomId) return;
  await ensureMatrixSdkClasses();

  const room = roomById(activeRoomId);

  if (!room) return;

  const limit = currentTimelineReloadLimit();

  const nextWindow = new TimelineWindow(client, room, {
    windowLimit: 500,
  });

  await nextWindow.load(undefined, limit);

  await indexTimelineEventsMedia(nextWindow.getEvents(), {
    roomId: activeRoomId,
  });

  await indexTimelineEventsForSearch(nextWindow.getEvents(), {
    roomId: activeRoomId,
  });

  timelineWindow = nextWindow;
  timelineInitializedFor = activeRoomId;

  renderTimeline({
    keepBottom,
    scrollBottom,
  });
}

export async function jumpToMessageFromSearch(result) {
  if (!client || !result?.roomId || !result?.eventId) {
    toast('Search result is incomplete.', 'error');
    console.warn('[YANTA Chat] Invalid search jump result', result);
    return;
  }

  try {
    if (chatMode === 'floating') {
      await openChatFloating({
        roomId: result.roomId,
      });
    } else {
      await openChat({
        roomId: result.roomId,
        push: true,
        mode: 'surface',
      });
    }

    await ensureMatrixSdkClasses();

    const room = roomById(result.roomId);

    if (!room) {
      throw new Error('Room not found for search result.');
    }

    /*
      Preferred Matrix path: load a timeline around the target event.
      Fallback reloads the active timeline and highlights if already present.
    */
    if (typeof client.getEventTimeline === 'function') {
      const timelineSet = room.getUnfilteredTimelineSet?.() || room.getLiveTimeline?.()?.getTimelineSet?.();

      if (timelineSet) {
        const eventTimeline = await client.getEventTimeline(timelineSet, result.eventId);

        const nextWindow = new TimelineWindow(client, room, {
          windowLimit: 500,
        });

        await nextWindow.load(eventTimeline, 80);

        timelineWindow = nextWindow;
        timelineInitializedFor = result.roomId;

        await indexTimelineEventsForSearch(nextWindow.getEvents(), {
          roomId: result.roomId,
        });

        renderTimeline();
      }
    }

    requestAnimationFrame(() => {
      const selector = `[data-event-id="${CSS.escape(result.eventId)}"]`;
      const bubble = root?.querySelector(selector);

      if (!bubble) {
        toast('Message loaded. Scroll position may differ on this device.', 'success');
        return;
      }

      bubble.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

      bubble.classList.add('yanta-chat-jump-highlight');

      setTimeout(() => {
        bubble.classList.remove('yanta-chat-jump-highlight');
      }, 1800);
    });
  } catch (err) {
    console.warn('[YANTA Chat] Could not jump to message', err);
    toast('Could not jump to message.', 'error');
  }
}

function handleLiveTimelineUpdate({
  roomId,
  eventId,
} = {}) {
  if (!roomId || roomId !== activeRoomId) return;

  const keepBottom = isTimelineNearBottom();

  /*
    Warum:
    TimelineWindow does not reliably expose freshly appended live events in all
    SDK versions until the window is reloaded/paginated. We first let the SDK
    settle for one frame, then reload from live if the event is still missing.
  */
  requestAnimationFrame(() => {
    if (eventId && timelineHasEvent(eventId)) {
      renderTimeline({
        keepBottom,
      });

      return;
    }

    reloadActiveTimelineSoon({
      keepBottom,
      scrollBottom: keepBottom,
    });
  });
}

async function ensureClient() {
  if (client) return client;

  const existingSession = getChatSession();
  const existingClient =
    existingSession?.client ||
    await resolveMatrixClient();

  if (existingClient) {
    client = existingClient;
    bindClientEvents(client);
    return client;
  }

  scheduleChatAutoResume({
    delay: 200,
  });

  let hasLocalCredentials = false;
  let hasVaultAccount = false;

  try {
    hasLocalCredentials = await hasEncryptedChatCredentials();
    hasVaultAccount = hasVaultChatAccount();
  } catch (err) {
    console.warn('[YANTA Chat] could not inspect Chat readiness', err);
    toast('Could not inspect Chat readiness.', 'error');
  }

  if (!hasLocalCredentials && !hasVaultAccount) {
    renderChatSetupState({
      title: 'Activate Chat',
      message:
        'Choose your permanent Chat handle to activate encrypted messaging. ' +
        'If you already activated Chat on another device, keep YANTA open until Cloud Sync arrives.',
      actionLabel: 'Activate Chat',
      action: openChatOnboardingFromUi,
    });
    // Onboarding direkt öffnen, nicht auf einen zweiten Klick warten.
    openChatOnboardingAutomatically();
    return null;
  }

  renderChatSetupState({
    title: 'Connecting Chat…',
    message: 'YANTA is unlocking your encrypted Matrix session for this device.',
  });

  try {
    const session = await startChatSession({
      reason: 'chat-ui-open',
    });

    client = session?.client || await resolveMatrixClient();

    if (!client) {
      throw new Error('Matrix client is not available after Chat startup.');
    }

    bindClientEvents(client);

    return client;
  } catch (err) {
    if (err?.code === 'ECHAT_NOT_READY') {
      renderChatSetupState({
        title: 'Chat is syncing…',
        message:
          'Your Chat account exists, but the encrypted login key has not reached this device yet. Wait for Cloud Sync to finish and try again.',
      });

      return null;
    }

    console.warn('[YANTA Chat] Could not start Chat session', err);
    toast('Could not connect Chat.', 'error');

    renderChatSetupState({
      title: 'Chat could not connect',
      message: err?.message || 'YANTA could not start the encrypted Chat session.',
      actionLabel: 'Try again',
      action: async () => {
        client = null;

        await ensureClient();

        if (client) {
          renderRoomList();
          await openActiveRoomIfNeeded();
        }
      },
    });

    return null;
  }
}

const CHAT_CRYPTO_BANNER_DISMISS_LS_KEY = 'yanta.chat.cryptoBanner.dismissed.v1';

function readCryptoBannerDismiss() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_CRYPTO_BANNER_DISMISS_LS_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeCryptoBannerDismiss(message) {
  try {
    localStorage.setItem(CHAT_CRYPTO_BANNER_DISMISS_LS_KEY, JSON.stringify({
      message: String(message || ''),
      dismissedAt: Date.now(),
    }));
  } catch {}
}

function setChatCryptoBanner(message = '') {
  const banner = root?.querySelector('[data-chat-crypto-banner]');
  if (!banner) return;

  const clean = String(message || '').trim();

  if (!clean) {
    banner.hidden = true;
    return;
  }

  const dismissed = readCryptoBannerDismiss();

  if (
    dismissed &&
    Number(dismissed.dismissedAt || 0) > Date.now() - 7 * 24 * 60 * 60 * 1000
  ) {
    banner.hidden = true;
    return;
  }

  const text = banner.querySelector('[data-chat-crypto-banner-text]');
  if (text) text.textContent = clean;

  banner.hidden = false;
}

function setChatConnectionBanner(message = '') {
  const banner = root?.querySelector('[data-chat-connection-banner]');
  if (!banner) return;

  if (!message) {
    banner.hidden = true;
    return;
  }

  const text = banner.querySelector('[data-chat-connection-banner-text]');
  if (text) text.textContent = message;

  banner.hidden = false;
}

function bindAppLevelChatEvents() {

  window.addEventListener('yanta-chat-crypto-degraded', (e) => {
    setChatCryptoBanner(e.detail?.message || 'Chat encryption is being set up…');
  });

  window.addEventListener('yanta-chat-jump-to-message', (e) => {
    const detail = e.detail || {};

    jumpToMessageFromSearch({
      roomId: detail.roomId,
      eventId: detail.eventId,
    }).catch((err) => {
      console.warn('[YANTA Chat] Could not jump to gallery message', err);
      toast('Could not jump to message.', 'error');
    });
  });

  window.addEventListener('yanta-chat-key-backup-ready', (e) => {
    if (e.detail?.ok) setChatCryptoBanner('');
  });

  window.addEventListener('yanta-chat-message', (e) => {
    const detail = e.detail || {};

    if (detail.roomId === activeRoomId) {
      handleLiveTimelineUpdate({
        roomId: detail.roomId,
        eventId: detail.eventId || '',
      });
    }

    renderRoomListSoon();
  });

  window.addEventListener('yanta-chat-key-backup-ready', () => {
    if (!chatIsOpen()) return;

    renderRoomListSoon();

    if (activeRoomId) {
      reloadActiveTimelineSoon({
        keepBottom: isTimelineNearBottom(),
        scrollBottom: isTimelineNearBottom(),
      });
    }
  });

  window.addEventListener('yanta-chat-room-updated', (e) => {
    const detail = e.detail || {};

    renderRoomListSoon();

    if (detail.roomId === activeRoomId) {
      renderTimelineSoon({
        keepBottom: isTimelineNearBottom(),
      });
    }
  });

  window.addEventListener('yanta-chat-ready', () => {
    client = window.yantaChatSession?.client || window.yantaMatrixClient || client;

    if (client) {
      bindClientEvents(client);
      renderRoomListSoon();

      if (activeRoomId) {
        reloadActiveTimelineSoon({
          scrollBottom: true,
        });
      }
    }
  });

  window.addEventListener('yanta-chat-archives-changed', () => {
    renderRoomListSoon();
  });

}

/**
 * Initialize Chat UI.
 */
export function setupChat() {
  if (initialized) return;

  initialized = true;
  ensureRoot();
  registerChatOverlayRoute();
  bindAppLevelChatEvents();
}

/**
 * Open the Chat surface.
 */
export async function openChat({
  roomId = '',
  push = false,
  replace = false,
  fromHistory = false,
  mode = 'surface',
} = {}) {
  setupChat();

  setChatMode(mode);
  root.hidden = false;

  renderChatSetupState({
    title: 'Opening Chat…',
    message: 'Preparing your encrypted Chat session.',
  });

  const readyClient = await ensureClient();

  if (!readyClient) {
    updateMobileState();
    updateFloatingButtons();
    return;
  }

  root.style.setProperty('--chat-list-width', `${roomListWidth}px`);
  updateRoomListDensity();

  const surfaceMode = chatMode === 'surface';

  if (surfaceMode) {
    state.surface = 'chat';

    const app = document.getElementById('app');

    if (app) {
      app.dataset.surface = 'chat';
    }
  }

  const nextRoomId = String(roomId || '').trim();

  activeRoomId = nextRoomId;

  if (surfaceMode && !fromHistory) {
    if (replace) {
      replaceChatHistory(activeRoomId || null);
    } else if (push) {
      pushChatHistory(activeRoomId || null);
    }
  }

  renderRoomList();
  await openActiveRoomIfNeeded();
  updateMobileState();
  updateFloatingButtons();

  window.dispatchEvent(new CustomEvent('yanta-chat-opened', {
    detail: {
      roomId: activeRoomId || null,
      mode: chatMode,
    },
  }));
}

/**
 * Open Chat as a movable/resizable transient window.
 */
export async function openChatFloating({
  roomId = '',
  fromHistory = false,
} = {}) {
  setupChat();

  const wasClosed = !chatFloatingIsOpen();

  await openChat({
    roomId,
    mode: 'floating',
    fromHistory: true,
  });

  if (overlayIdFromState() === CHAT_FLOATING_OVERLAY_ID) {
    replaceOverlayState(CHAT_FLOATING_OVERLAY_ID, {
      roomId: activeRoomId || null,
    });
  } else if (!fromHistory && wasClosed) {
    pushOverlayState(CHAT_FLOATING_OVERLAY_ID, {
      roomId: activeRoomId || null,
    });
  }
}

function updateFloatingButtons() {
  if (!root) return;

  root.querySelectorAll('[data-chat-float]').forEach((btn) => {
    btn.innerHTML = lucide(chatMode === 'floating' ? 'panel-right' : 'picture-in-picture-2', 17);
    btn.title = chatMode === 'floating' ? 'Dock Chat' : 'Open as window';
    btn.setAttribute('aria-label', btn.title);
  });
}

/**
 * Close the Chat surface/window and cleanup transient object URLs.
 */
export function closeChat({
  fromHistory = false,
} = {}) {
  if (!root) return;

  if (
    !fromHistory &&
    chatMode === 'floating' &&
    overlayIdFromState() === CHAT_FLOATING_OVERLAY_ID
  ) {
    closeTopOverlay(() => {
      closeChat({
        fromHistory: true,
      });
    });

    return;
  }

  root.hidden = true;
  activeRoomId = '';
  timelineWindow = null;
  timelineInitializedFor = '';

  topObserver?.disconnect();
  bottomObserver?.disconnect();

  revokeAllChatMediaObjectUrls();

  if (chatMode === 'surface' && state.surface === 'chat') {
    state.surface = 'dashboard';
  }

  setChatMode('surface');

  window.dispatchEvent(new CustomEvent('yanta-chat-closed'));
}

function updateMobileState() {
  if (!root) return;

  root.classList.toggle('has-active-room', !!activeRoomId);
  root.classList.toggle('is-mobile', isMobile());
}

function renderRoomList() {
  if (!roomListEl || !client) return;

  const query = String(roomSearchInput?.value || '').trim().toLowerCase();

  const rooms = visibleRooms()
    .filter((room) => !query || roomDisplayName(room).toLowerCase().includes(query))
    .sort((a, b) => lastActive(b) - lastActive(a));

  roomListEl.replaceChildren();

  const globalSearchBtn = el('button', {
    type: 'button',
    class: 'yanta-chat-room-row',
    onclick: () => {
      openGlobalChatSearch({
        client,
        onJump: jumpToMessageFromSearch,
      });
    },
  });

  globalSearchBtn.innerHTML = `
    <span class="yanta-chat-avatar">${lucide('search', 16)}</span>
    <span class="yanta-chat-room-row-main">
      <span class="yanta-chat-room-row-title">
        <strong>Search all messages</strong>
        <small>Local</small>
      </span>
      <span class="yanta-chat-room-row-subtitle">
        <span>Search decrypted messages on this device</span>
      </span>
    </span>
  `;

  roomListEl.append(globalSearchBtn);

  if (!rooms.length) {
    roomListEl.append(el('div', {
      class: 'yanta-chat-room-empty',
    }, query ? 'No chats found.' : 'No chats yet.'));
  } else {
    for (const room of rooms) {
      roomListEl.append(renderRoomRow(room));
    }
  }
  
  renderImportedArchiveSectionSoon();
}

const renderImportedArchiveSectionSoon = debounce(() => {
  renderImportedArchiveSection().catch((err) => {
    console.warn('[YANTA Chat] Could not render imported archives', err);
    toast('Could not render imported chats.', 'error');
  });
}, 120);

async function renderImportedArchiveSection() {
  if (!roomListEl) return;

  const archives = await listImportedChatArchives();

  if (!archives.length) return;

  const title = el('div', {
    class: 'yanta-chat-room-empty',
    style: {
      minHeight: 'auto',
      padding: '10px 12px 4px',
      textAlign: 'left',
      color: 'var(--text-faint)',
      fontSize: '11px',
      fontWeight: '850',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
    },
  }, 'Archiviert/Importiert');

  roomListEl.append(title);

  for (const archive of archives) {
    const btn = el('button', {
      type: 'button',
      class: 'yanta-chat-room-row',
      onclick: () => openImportedChatArchive(archive.id),
    });

    btn.innerHTML = `
      <span class="yanta-chat-avatar">${lucide('archive', 16)}</span>
      <span class="yanta-chat-room-row-main">
        <span class="yanta-chat-room-row-title">
          <strong>${escapeHtml(archive.title || 'Imported Chat')}</strong>
          <small>${escapeHtml(archive.importedAt ? compactTime(archive.importedAt) : '')}</small>
        </span>
        <span class="yanta-chat-room-row-subtitle">
          <span>Read-only local archive</span>
        </span>
      </span>
    `;

    roomListEl.append(btn);
  }
}

async function openRoomFromList(roomId) {
  const id = String(roomId || '').trim();

  if (!id) return;

  /*
    Warum:
    A room switch inside the floating window must not accidentally dock the
    Chat surface or reset the window position. Surface routing is only for
    fullscreen Chat.
  */
  if (chatMode === 'floating') {
    await openChatFloating({
      roomId: id,
    });

    return;
  }

  await openChat({
    roomId: id,
    push: true,
    mode: 'surface',
  });
}

function renderRoomRow(room) {
  const lastEvent = latestEvent(room);
  const preview = lastEvent ? messagePreview(lastEvent) : 'No messages yet';
  const unread = Number(room.getUnreadNotificationCount?.() || 0);
  const ts = lastEvent?.getTs?.() || lastActive(room);

  const btn = el('button', {
    type: 'button',
    class: `yanta-chat-room-row ${room.roomId === activeRoomId ? 'active' : ''}`,
    onclick: () => {
      openRoomFromList(room.roomId).catch((err) => {
        console.warn('[YANTA Chat] Could not open room', err);
        toast('Could not open chat.', 'error');
      });
    },
  });

  const avatar = el('span', {
    class: 'yanta-chat-avatar',
  }, roomInitials(room));

  hydrateAvatar(avatar, room);

  const main = el('span', {
    class: 'yanta-chat-room-row-main',
  });

  const title = el('span', {
    class: 'yanta-chat-room-row-title',
  });

  title.innerHTML = `
    <strong>${escapeHtml(roomDisplayName(room))}</strong>
    <small>${escapeHtml(ts ? compactTime(ts) : '')}</small>
  `;

  const subtitle = el('span', {
    class: 'yanta-chat-room-row-subtitle',
  });

  subtitle.innerHTML = `
    <span>${escapeHtml(preview || '')}</span>
    ${
      isRoomMuted(room.roomId)
        ? `<span class="yanta-chat-muted-icon" title="Muted">${lucide('bell-off', 13)}</span>`
        : ''
    }
    ${
      unread > 0
        ? `<span class="yanta-chat-unread">${unread > 99 ? '99+' : unread}</span>`
        : ''
    }
  `;

  main.append(title, subtitle);
  btn.append(avatar, main);

  return btn;
}

async function openActiveRoomIfNeeded() {
  const empty = root.querySelector('[data-chat-empty]');
  const roomShell = root.querySelector('[data-chat-room]');

  if (!activeRoomId) {
    if (empty) empty.hidden = false;
    if (roomShell) roomShell.hidden = true;
    return;
  }

  if (empty) empty.hidden = true;
  if (roomShell) roomShell.hidden = false;

  const room = roomById(activeRoomId);

  if (!room) {
    toast('Chat room not found.', 'error');
    console.warn('[YANTA Chat] Room not found', activeRoomId);
    return;
  }

  renderRoomHeader(room);

  await chatComposer?.setRoom(activeRoomId);

  if (timelineInitializedFor !== activeRoomId) {
    timelineInitializedFor = activeRoomId;
    timelineWindow = null;
    await initTimeline(room);
  } else {
    renderTimeline();
  }

  renderTyping();

  window.setTimeout(() => {
    scheduleReadReceipt();
    renderRoomListSoon();
  }, 250);

  requestAnimationFrame(() => {
    chatComposer?.focus();
  });
}

function renderRoomHeader(room) {
  const title = root.querySelector('[data-chat-room-title]');
  const avatar = root.querySelector('[data-chat-room-avatar]');

  if (title) {
    title.textContent = roomDisplayName(room);
  }

  if (avatar) {
    avatar.className = 'yanta-chat-avatar';
    avatar.textContent = roomInitials(room);
    hydrateAvatar(avatar, room);
  }
}

async function initTimeline(room) {
  await ensureMatrixSdkClasses();
  setOlderLoadingVisible(true);

  try {
    timelineWindow = new TimelineWindow(client, room, {
      windowLimit: 500,
    });

    await timelineWindow.load(undefined, PAGE_SIZE);

    await indexTimelineEventsMedia(timelineWindow.getEvents(), {
      roomId: room.roomId,
    });

    await indexTimelineEventsForSearch(timelineWindow.getEvents(), {
      roomId: activeRoomId,
    });

    renderTimeline({
      scrollBottom: true,
    });
  } catch (err) {
    console.warn('[YANTA Chat] Could not initialize timeline', err);
    toast('Could not load chat timeline.', 'error');
  } finally {
    setOlderLoadingVisible(false);
  }
}

function isTimelineNearBottom() {
  if (!timelineEl) return false;

  return timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight < 180;
}

async function paginateBackwards() {
  if (!timelineWindow || timelineLoading || !timelineEl) return;

  if (
    typeof timelineWindow.canPaginate === 'function' &&
    !timelineWindow.canPaginate(EventTimeline.BACKWARDS)
  ) {
    setOlderLoadingVisible(false);
    return;
  }

  timelineLoading = true;

  const before = timelineEl.scrollHeight;

  setOlderLoadingVisible(true);

  try {
    await timelineWindow.paginate(EventTimeline.BACKWARDS, PAGE_SIZE);

    await indexTimelineEventsMedia(timelineWindow.getEvents(), {
      roomId: activeRoomId,
    });

    await indexTimelineEventsForSearch(timelineWindow.getEvents(), {
      roomId: activeRoomId,
    });

    renderTimeline({
      preserveTopDeltaFrom: before,
    });
  } catch (err) {
    console.warn('[YANTA Chat] Could not paginate timeline', err);
    toast('Could not load older messages.', 'error');
  } finally {
    timelineLoading = false;
    setOlderLoadingVisible(false);
  }
}

function setOlderLoadingVisible(visible) {
  const loading = root?.querySelector('[data-chat-loading-row]');

  if (loading) {
    loading.hidden = !visible;
  }
}

function stampRenderedEventIds(eventsHost, events = []) {
  if (!eventsHost) return;

  const rows = [...eventsHost.querySelectorAll('.yanta-chat-event')];

  if (!rows.length) return;

  for (let i = 0; i < Math.min(rows.length, events.length); i++) {
    const id = events[i]?.getId?.() || events[i]?.event?.event_id || '';

    if (id && !rows[i].dataset.eventId) {
      rows[i].dataset.eventId = id;
    }
  }
}

function renderTimeline({
  scrollBottom = false,
  keepBottom = false,
  preserveTopDeltaFrom = null,
} = {}) {
  if (!timelineWindow || !activeRoomId) return;

  const eventsHost = root.querySelector('[data-chat-events]');
  const room = roomById(activeRoomId);

  if (!eventsHost || !room) return;

  const events = timelineWindow.getEvents();

  eventsHost.replaceChildren(renderTimelineEvents(events, {
    client,
    room,
  }));

  stampRenderedEventIds(eventsHost, events);

  decorateTimelineWithYantaEmbeds(eventsHost, events, {
    client,
    room,
  });

  setupTimelineObservers();

  if (preserveTopDeltaFrom != null) {
    requestAnimationFrame(() => {
      const delta = timelineEl.scrollHeight - preserveTopDeltaFrom;
      timelineEl.scrollTop += delta;
    });
  } else if (scrollBottom || keepBottom) {
    requestAnimationFrame(() => {
      timelineEl.scrollTop = timelineEl.scrollHeight;
    });
  }

  window.setTimeout(() => {
    scheduleReadReceipt();
  }, 120);
}

function setupTimelineObservers() {
  topObserver?.disconnect();
  bottomObserver?.disconnect();

  const top = root.querySelector('[data-chat-top-sentinel]');
  const bottom = root.querySelector('[data-chat-bottom-sentinel]');

  if (top && timelineEl) {
    topObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        paginateBackwards();
      }
    }, {
      root: timelineEl,
      threshold: 0.01,
    });

    topObserver.observe(top);
  }

  if (bottom && timelineEl) {
    bottomObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        scheduleReadReceipt();
      }
    }, {
      root: timelineEl,
      threshold: 0.2,
    });

    bottomObserver.observe(bottom);
  }
}

const scheduleReadReceipt = debounce(() => {
  sendReadReceiptIfVisible().catch((err) => {
    console.warn('[YANTA Chat] Could not send read receipt', err);
    toast('Could not update read receipt.', 'error');
  });
}, READ_RECEIPT_DEBOUNCE_MS);

async function sendReadReceiptIfVisible() {
  const prefs = await getChatPreferences();

  if (prefs.sendReadReceipts === false) return;
  if (!document.hasFocus()) return;
  if (!timelineWindow || !client || !activeRoomId) return;
  if (!isTimelineNearBottom()) return;

  const event = lastReadableEvent(timelineWindow.getEvents());

  if (!event) return;

  await client.sendReadReceipt(event);

  const eventId = event.getId?.();

  if (eventId && typeof client.setRoomReadMarkers === 'function') {
    await client.setRoomReadMarkers(activeRoomId, eventId, event);
  }

  /*
    The SDK updates room notification counts asynchronously. Re-render after
    the receipt/marker write so the "1" badge disappears without reopening.
  */
  renderRoomListSoon();
}

async function sendFileWithOptimisticBubble(file) {
  if (!client || !activeRoomId) {
    toast('Chat is not connected.', 'error');
    throw new Error('Matrix client or active room missing.');
  }

  const eventsHost = root.querySelector('[data-chat-events]');
  const abortController = new AbortController();

  const row = el('div', {
    class: 'yanta-chat-event own yanta-chat-upload-event',
  });

  row.innerHTML = `
    <div class="yanta-chat-bubble">
      <div class="yanta-chat-file-card">
        <span class="yanta-chat-file-icon">${lucide('paperclip', 22)}</span>
        <span class="yanta-chat-file-main">
          <strong>${escapeHtml(file.name || 'File')}</strong>
          <small>${fmtDate(Date.now())} · uploading · ${escapeHtml(file.size ? `${Math.round(file.size / 1024)} KB` : '')}</small>
        </span>
        <button class="icon-btn danger" data-cancel title="Cancel upload" aria-label="Cancel upload">
          ${lucide('x', 17)}
        </button>
      </div>
      <div class="yanta-chat-upload-progress">
        <span data-progress></span>
      </div>
    </div>
  `;

  eventsHost?.append(row);

  requestAnimationFrame(() => {
    if (timelineEl) {
      timelineEl.scrollTop = timelineEl.scrollHeight;
    }
  });

  row.querySelector('[data-cancel]')?.addEventListener('click', () => {
    abortController.abort();
    row.remove();
    toast('Upload cancelled', 'success');
  });

  try {
    await sendFileMessage(client, activeRoomId, file, {
      abortController,
      onProgress: ({ percent }) => {
        const bar = row.querySelector('[data-progress]');
        if (bar) {
          bar.style.width = `${Math.max(0, Math.min(1, percent || 0)) * 100}%`;
        }
      },
    });

    row.remove();

    await reloadActiveTimeline({
      keepBottom: true,
      scrollBottom: true,
    });
  } catch (err) {
    row.remove();

    if (abortController.signal.aborted) {
      console.warn('[YANTA Chat] File upload cancelled', err);
      return;
    }

    console.warn('[YANTA Chat] Could not send file with optimistic bubble', err);
    toast('Could not send file.', 'error');
    throw err;
  }
}

function clearReplyTarget() {
  replyTargetEvent = null;
  renderReplyBar();
}

function setReplyTarget(event) {
  replyTargetEvent = event || null;
  renderReplyBar();
}

function renderReplyBar() {
  const footer = root?.querySelector('.yanta-chat-composer-wrap');

  if (!footer) return;

  replyBarEl?.remove();
  replyBarEl = null;

  if (!replyTargetEvent) return;

  const sender = replyTargetEvent.getSender?.() || '';
  const preview = messagePreview(replyTargetEvent) || 'Message';

  replyBarEl = el('div', {
    class: 'yanta-chat-reply-target-bar',
  });

  replyBarEl.innerHTML = `
    <span>${lucide('reply', 14)}</span>
    <span class="yanta-chat-reply-target-main">
      <strong>${escapeHtml(sender)}</strong>
      <small>${escapeHtml(preview)}</small>
    </span>
    <button class="icon-btn" type="button" data-clear-reply title="Cancel reply" aria-label="Cancel reply">
      ${lucide('x', 14)}
    </button>
  `;

  replyBarEl.querySelector('[data-clear-reply]')?.addEventListener('click', clearReplyTarget);

  footer.prepend(replyBarEl);
}

function lastReplyCandidate() {
  const own = client?.getUserId?.() || '';
  const events = timelineWindow?.getEvents?.() || [];

  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const type = ev?.getType?.();

    if (type !== 'm.room.message' && type !== 'm.sticker') continue;
    if (ev?.isRedacted?.()) continue;
    if (ev?.getSender?.() === own) continue;

    return ev;
  }

  return null;
}

function moveReplyTarget(delta) {
  const events = (timelineWindow?.getEvents?.() || [])
    .filter((ev) => {
      const type = ev?.getType?.();
      return (type === 'm.room.message' || type === 'm.sticker') && !ev?.isRedacted?.();
    });

  if (!events.length) return;

  const currentId = replyTargetEvent?.getId?.() || '';
  let idx = currentId
    ? events.findIndex((ev) => ev.getId?.() === currentId)
    : events.length - 1;

  if (idx < 0) idx = events.length - 1;

  idx = Math.max(0, Math.min(events.length - 1, idx + delta));

  setReplyTarget(events[idx]);
}

async function sendCurrentMessage(textOverride = '') {
  const text = String(textOverride || '').trim();

  if (!text || !activeRoomId) return;

  try {
    if (typingActive) {
      typingActive = false;
      await client.sendTyping(activeRoomId, false, 0);
    }

    const replyId = replyTargetEvent?.getId?.() || '';

    if (replyId) {
      await client.sendMessage(activeRoomId, {
        msgtype: 'm.text',
        body: text,
        'm.relates_to': {
          'm.in_reply_to': {
            event_id: replyId,
          },
        },
      });

      clearReplyTarget();
      return;
    }

    await client.sendTextMessage(activeRoomId, text);
  } catch (err) {
    console.warn('[YANTA Chat] Could not send message', err);
    toast('Could not send message.', 'error');
    throw err;
  }
}

function sendTypingThrottled() {
  if (!client || !activeRoomId) return;

  const now = Date.now();

  if (sendTypingTimer && now - sendTypingTimer < TYPING_THROTTLE_MS) {
    return;
  }

  sendTypingTimer = now;
  typingActive = true;

  client.sendTyping(activeRoomId, true, 6000).catch((err) => {
    console.warn('[YANTA Chat] Could not send typing notification', err);
    toast('Could not send typing status.', 'error');
  });

  window.clearTimeout(sendTypingThrottled._stopTimer);

  sendTypingThrottled._stopTimer = window.setTimeout(() => {
    typingActive = false;

    client?.sendTyping?.(activeRoomId, false, 0).catch((err) => {
      console.warn('[YANTA Chat] Could not stop typing notification', err);
      toast('Could not update typing status.', 'error');
    });
  }, 6500);
}

function renderTyping() {
  if (!typingEl || !activeRoomId) return;

  const room = roomById(activeRoomId);
  const ownUserId = client?.getUserId?.() || '';

  if (!room) {
    typingEl.hidden = true;
    typingEl.textContent = '';
    return;
  }

  let members = [];

  try {
    members = room.getJoinedMembers?.() || [];
  } catch {
    members = [];
  }

  const typing = members
    .filter((member) => member.userId !== ownUserId && member.typing)
    .map((member) => member.name || member.rawDisplayName || member.userId)
    .slice(0, 3);

  if (!typing.length) {
    typingEl.hidden = true;
    typingEl.textContent = '';
    return;
  }

  typingEl.hidden = false;
  typingEl.textContent =
    typing.length === 1
      ? `${typing[0]} is typing…`
      : `${typing.join(', ')} are typing…`;
}

function openRoomMenu(anchor) {
  const roomId = activeRoomId;
  const room = roomById(roomId);

  if (!anchor || !room) return;

  const r = anchor.getBoundingClientRect();

  showMenu(r.right, r.bottom + 4, [
    {
      label: chatMode === 'floating' ? 'Dock Chat' : 'Open as window',
      icon: chatMode === 'floating' ? 'panel-right' : 'picture-in-picture-2',
      action: async () => {
        if (chatMode === 'floating') {
          await openChat({
            roomId: activeRoomId || '',
            mode: 'surface',
            push: true,
          });
        } else {
          await openChatFloating({
            roomId: activeRoomId || '',
          });
        }
      },
    },
    {
      label: 'Gallery',
      icon: 'images',
      action: async () => {
        await openChatGallery({
          client,
          roomId,
          roomName: roomDisplayName(room),
        });
      },
    },
    {
      label: 'Chat Settings',
      icon: 'settings',
      action: async () => {
        await openChatSettings({
          client,
          roomId,
          roomName: roomDisplayName(room),
        });
      },
    },
    {
      label: 'My Chat Profile',
      icon: 'user-round',
      action: async () => {
        await openChatSettings({
          client,
          roomId,
          roomName: roomDisplayName(room),
          tab: 'profile',
        });
      },
    },
    {
      label: 'Search Messages',
      icon: 'search',
      action: async () => {
        openRoomChatSearch({
          container: root.querySelector('[data-chat-room]'),
          client,
          roomId,
          roomName: roomDisplayName(room),
          onJump: jumpToMessageFromSearch,
        });
      },
    },
    {
      label: 'Index older Messages of this Chat',
      icon: 'scan-search',
      action: async () => {
        let lastToastAt = 0;

        await backfillRoomSearchIndex(client, roomId, {
          onProgress: ({ scanned, indexed, done }) => {
            const now = Date.now();

            if (done || now - lastToastAt > 1600) {
              lastToastAt = now;
              toast(
                done
                  ? `Index complete: ${indexed}/${scanned} messages`
                  : `Indexing older messages… ${indexed}/${scanned}`,
                'success'
              );
            }
          },
        });
      },
    },
    {
      label: 'Export / Import…',
      icon: 'download',
      action: async () => {
        openChatExportSheet(client, roomId, {
          roomName: roomDisplayName(room),
        });
      },
    },
    {
      label: isRoomMuted(roomId) ? 'Unmute chat' : 'Mute chat',
      icon: isRoomMuted(roomId) ? 'bell' : 'bell-off',
      action: async () => {
        await toggleRoomMute(roomId);
        renderRoomList();
      },
    },
    {
      label: 'Repair encryption keys',
      icon: 'shield-check',
      action: async () => {
        try {
          const {
            repairChatEncryptionBackupNow,
          } = await import('./matrix-session.js');

          await repairChatEncryptionBackupNow({
            reason: 'room-menu',
          });

          await reloadActiveTimeline({
            keepBottom: true,
            scrollBottom: true,
          });
        } catch (err) {
          console.warn('[YANTA Chat] Could not repair encryption keys', err);
          toast('Could not repair encryption keys.', 'error');
        }
      },
    },
    'hr',
    {
      label: 'Leave chat',
      icon: 'log-out',
      danger: true,
      action: async () => {
        const ok = await askConfirm({
          title: 'Leave chat',
          message: `Leave "${roomDisplayName(room)}"?`,
          confirmLabel: 'Leave chat',
          danger: true,
        });

        if (!ok) return;

        await leaveRoom(roomId);

        await openChat({
          roomId: '',
          replace: true,
        });
      },
    },
  ], {
    align: 'end',
  });
}

function exportVisibleTimeline() {
  if (!timelineWindow || !activeRoomId) return;

  try {
    const data = timelineWindow.getEvents().map((event) => ({
      id: event.getId?.(),
      type: event.getType?.(),
      sender: event.getSender?.(),
      ts: event.getTs?.(),
      content: event.getClearContent?.() || event.getContent?.() || {},
    }));

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `yanta-chat-${activeRoomId.replace(/[^a-z0-9_-]+/gi, '_')}.json`;
    a.click();

    URL.revokeObjectURL(url);

    toast('Chat export created', 'success');
  } catch (err) {
    console.warn('[YANTA Chat] Could not export timeline', err);
    toast('Could not export chat.', 'error');
  }
}