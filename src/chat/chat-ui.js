// ============================================================
// YANTA Chat — Chat surface: room list + TimelineWindow timeline
// ============================================================

import {
  EventTimeline,
  TimelineWindow,
} from 'matrix-js-sdk';

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
  createDm,
  leaveRoom,
  resolveMatrixClient,
  toggleRoomMute,
} from './chat-actions.js';

import {
  mxcToBlobUrl,
  revokeAllChatMediaObjectUrls,
} from './chat-media.js';

import {
  compactTime,
  lastReadableEvent,
  messagePreview,
  renderTimelineEvents,
} from './chat-message-render.js';

import './chat.css';

const PAGE_SIZE = 30;
const TYPING_THROTTLE_MS = 3500;
const READ_RECEIPT_DEBOUNCE_MS = 650;

const MOBILE_MQ = window.matchMedia('(max-width: 760px)');

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

function isMobile() {
  return MOBILE_MQ.matches;
}

function chatIsOpen() {
  return root && root.hidden === false;
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
      <header class="yanta-chat-list-head">
        <div class="yanta-chat-title">
          ${lucide('messages-square', 18)}
          <strong>Chat</strong>
        </div>

        <button class="icon-btn" data-chat-new title="New chat" aria-label="New chat">
          ${lucide('message-circle-plus', 17)}
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

    <main class="yanta-chat-main-pane" data-chat-main-pane>
      <section class="yanta-chat-empty" data-chat-empty>
        <div>${lucide('message-circle', 28)}</div>
        <strong>Select a chat</strong>
        <p>Your encrypted Matrix conversations appear here.</p>
      </section>

      <section class="yanta-chat-room" data-chat-room hidden>
        <header class="yanta-chat-room-head">
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
  `;

  document.body.append(root);

  roomSearchInput = root.querySelector('[data-chat-search]');
  roomListEl = root.querySelector('[data-chat-room-list]');
  timelineEl = root.querySelector('[data-chat-timeline]');
  composerEl = root.querySelector('[data-chat-composer]');
  typingEl = root.querySelector('[data-chat-typing]');

  bindRootEvents();

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
    toast('Chat details will be available soon.', 'error');
  });

  root.querySelector('[data-chat-search-room]')?.addEventListener('click', () => {
    toast('Message search will be available soon.', 'error');
  });

  root.querySelector('[data-chat-gallery]')?.addEventListener('click', () => {
    toast('Gallery will be available soon.', 'error');
  });

  root.querySelector('[data-chat-menu]')?.addEventListener('click', (e) => {
    openRoomMenu(e.currentTarget);
  });

  composerEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendCurrentMessage().catch((err) => {
      console.warn('[YANTA Chat] Send failed', err);
      toast('Could not send message.', 'error');
    });
  });

  const input = root.querySelector('[data-chat-input]');

  input?.addEventListener('input', () => {
    autoResizeComposer();
    updateComposerState();
    sendTypingThrottled();
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composerEl?.requestSubmit?.();
    }
  });

  MOBILE_MQ.addEventListener?.('change', () => {
    updateMobileState();
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

function onSync() {
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

function onRoomTimeline(_event, room) {
  renderRoomListSoon();

  if (room?.roomId === activeRoomId) {
    const nearBottom = isTimelineNearBottom();

    renderTimelineSoon({
      keepBottom: nearBottom,
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

async function ensureClient() {
  if (client) return client;

  client = await resolveMatrixClient();

  if (!client && typeof window.yantaOpenChat === 'function') {
    try {
      await window.yantaOpenChat({
        source: 'chat-ui',
      });

      client = await resolveMatrixClient();
    } catch (err) {
      console.warn('[YANTA Chat] Could not start Chat session', err);
      toast('Could not start Chat.', 'error');
    }
  }

  if (!client) {
    toast('Chat is not connected.', 'error');
    throw new Error('Matrix client is not available.');
  }

  bindClientEvents(client);

  return client;
}

/**
 * Initialize Chat UI.
 */
export function setupChat() {
  if (initialized) return;

  initialized = true;
  ensureRoot();
}

/**
 * Open the Chat surface.
 */
export async function openChat({
  roomId = '',
  push = false,
  replace = false,
  fromHistory = false,
} = {}) {
  setupChat();
  await ensureClient();

  root.hidden = false;

  state.surface = 'chat';

  const app = document.getElementById('app');

  if (app) {
    app.dataset.surface = 'chat';
  }

  const nextRoomId = String(roomId || '').trim();

  activeRoomId = nextRoomId;

  if (!fromHistory) {
    if (replace) {
      replaceChatHistory(activeRoomId || null);
    } else if (push) {
      pushChatHistory(activeRoomId || null);
    }
  }

  renderRoomList();
  await openActiveRoomIfNeeded();
  updateMobileState();

  window.dispatchEvent(new CustomEvent('yanta-chat-opened', {
    detail: {
      roomId: activeRoomId || null,
    },
  }));
}

/**
 * Close the Chat surface and cleanup transient object URLs.
 */
export function closeChat() {
  if (!root) return;

  root.hidden = true;
  activeRoomId = '';
  timelineWindow = null;
  timelineInitializedFor = '';

  topObserver?.disconnect();
  bottomObserver?.disconnect();

  revokeAllChatMediaObjectUrls();

  if (state.surface === 'chat') {
    state.surface = 'dashboard';
  }

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

  if (!rooms.length) {
    roomListEl.append(el('div', {
      class: 'yanta-chat-room-empty',
    }, query ? 'No chats found.' : 'No chats yet.'));
    return;
  }

  for (const room of rooms) {
    roomListEl.append(renderRoomRow(room));
  }
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
      openChat({
        roomId: room.roomId,
        push: true,
      }).catch((err) => {
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

  if (timelineInitializedFor !== activeRoomId) {
    timelineInitializedFor = activeRoomId;
    timelineWindow = null;
    await initTimeline(room);
  } else {
    renderTimeline();
  }

  renderTyping();

  requestAnimationFrame(() => {
    const input = root.querySelector('[data-chat-input]');
    input?.focus();
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
  const loading = root.querySelector('[data-chat-loading-row]');

  if (loading) loading.hidden = false;

  try {
    timelineWindow = new TimelineWindow(client, room, {
      windowLimit: 500,
    });

    await timelineWindow.load(undefined, PAGE_SIZE);

    renderTimeline({
      scrollBottom: true,
    });
  } catch (err) {
    console.warn('[YANTA Chat] Could not initialize timeline', err);
    toast('Could not load chat timeline.', 'error');
  } finally {
    if (loading) loading.hidden = true;
  }
}

function isTimelineNearBottom() {
  if (!timelineEl) return false;

  return timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight < 180;
}

async function paginateBackwards() {
  if (!timelineWindow || timelineLoading || !timelineEl) return;

  timelineLoading = true;

  const loading = root.querySelector('[data-chat-loading-row]');
  const before = timelineEl.scrollHeight;

  if (loading) loading.hidden = false;

  try {
    await timelineWindow.paginate(EventTimeline.BACKWARDS, PAGE_SIZE);

    renderTimeline({
      preserveTopDeltaFrom: before,
    });
  } catch (err) {
    console.warn('[YANTA Chat] Could not paginate timeline', err);
    toast('Could not load older messages.', 'error');
  } finally {
    timelineLoading = false;
    if (loading) loading.hidden = true;
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

  scheduleReadReceipt();
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
  if (!document.hasFocus()) return;
  if (!timelineWindow || !client) return;
  if (!isTimelineNearBottom()) return;

  const event = lastReadableEvent(timelineWindow.getEvents());

  if (!event) return;

  await client.sendReadReceipt(event);
}

function autoResizeComposer() {
  const input = root.querySelector('[data-chat-input]');

  if (!input) return;

  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function updateComposerState() {
  const input = root.querySelector('[data-chat-input]');
  const btn = root.querySelector('.yanta-chat-send');

  if (!input || !btn) return;

  btn.disabled = !input.value.trim();
}

async function sendCurrentMessage() {
  const input = root.querySelector('[data-chat-input]');
  const text = String(input?.value || '').trim();

  if (!text || !activeRoomId) return;

  input.value = '';
  autoResizeComposer();
  updateComposerState();

  try {
    if (typingActive) {
      typingActive = false;
      await client.sendTyping(activeRoomId, false, 0);
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
      label: isRoomMuted(roomId) ? 'Unmute chat' : 'Mute chat',
      icon: isRoomMuted(roomId) ? 'bell' : 'bell-off',
      action: async () => {
        await toggleRoomMute(roomId);
        renderRoomList();
      },
    },
    {
      label: 'Export visible messages',
      icon: 'download',
      action: exportVisibleTimeline,
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