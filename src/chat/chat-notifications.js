// ============================================================
// YANTA Chat — AP8 incoming message notifications
//
// Sources:
// - yanta-chat-message from matrix-session.js
// - yanta-android-push-token-changed from MainActivity (FCM token rotation)
// - Service Worker 'yanta-notification-click' messages
//
// Sinks:
// 1. Native Android notification bridge.
// 2. Web Notification API when permission is already granted.
//
// Background path (app closed):
// JavaScript does not run when the browser/PWA is fully closed. Real
// background notifications use the native Android push path:
// ensureNativeChatPusher() registers a Matrix HTTP pusher against the
// Sygnal gateway using the FCM token provided by the Android bridge.
// The pusher uses format 'event_id_only', so no message content ever
// reaches the push gateway or FCM.
// ============================================================
import {
  toast,
  swRegistrationReady,
} from '../core.js';

import {
  chatNotificationsEnabled,
} from '../notification-preferences.js';

import {
  androidShowChatNotification,
  androidClearChatNotifications,
  androidChatPushConfig,
  androidSetChatUnreadCount,
} from '../native/android-bridge.js';

import {
  chatSettings,
} from './chat-store.js';

import {
  messagePreview,
} from './chat-message-render.js';

import {
  isPushActive,
  pushKey,
  getPushGatewayUrl,
} from '../push/web-push-client.js';

const CHAT_PUSHER_APP_ID = 'page.yanta.android';
const CHAT_WEB_PUSHER_APP_ID = 'page.yanta.web';
const LOCAL_MUTED_ROOMS_KEY = 'chat.mutedRooms.v1';
const DECRYPT_WAIT_MS = 2500;

let installed = false;
let chatSurfaceOpen = false;
let visibleRoomId = '';
let webPermissionRequestedThisSession = false;
const webNotificationsByRoom = new Map();
let lastUnreadCount = 0;

function matrixClient() {
  return window.yantaChatSession?.client || window.yantaMatrixClient || null;
}

function roomById(client, roomId) {
  try {
    return client?.getRoom?.(roomId) || null;
  } catch {
    return null;
  }
}

function ownUserId(client) {
  try {
    return client?.getUserId?.() || '';
  } catch {
    return '';
  }
}

function eventSender(event) {
  return event?.getSender?.() || event?.event?.sender || '';
}

function eventIdOf(event) {
  return event?.getId?.() || event?.event?.event_id || '';
}

function findRoomEvent(room, eventId) {
  if (!room || !eventId) return null;

  try {
    const direct = room.findEventById?.(eventId);
    if (direct) return direct;
  } catch {}

  try {
    const timelines = room.getUnfilteredTimelineSet?.()?.getTimelines?.() || [];
    for (const tl of timelines) {
      const hit = (tl.getEvents?.() || []).find((ev) => eventIdOf(ev) === eventId);
      if (hit) return hit;
    }
  } catch {}

  try {
    return (room.getLiveTimeline?.()?.getEvents?.() || [])
      .find((ev) => eventIdOf(ev) === eventId) || null;
  } catch {}

  return null;
}

/*
  Hot-path helpers deliberately never toast.
  These run on every incoming message; a transient SDK hiccup must not
  spam the user with error toasts.
*/
async function localMutedRooms() {
  try {
    const ids = await chatSettings.get(LOCAL_MUTED_ROOMS_KEY, []);
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not read local mute list', err);
    return new Set();
  }
}

async function isRoomMuted(client, roomId) {
  try {
    const room = roomById(client, roomId);

    // Matrix SDK variants differ. Prefer room-level, fall back to client-level rule.
    const roomActions = room?.getPushRuleActions?.();
    if (Array.isArray(roomActions) && roomActions.includes('dont_notify')) {
      return true;
    }

    const rule = client?.getRoomPushRule?.('global', roomId);
    if (rule?.actions?.some?.((action) => action === 'dont_notify')) {
      return true;
    }

    const muted = await localMutedRooms();
    return muted.has(roomId);
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not inspect room mute state', err);
    return false;
  }
}

function isRoomVisibleAndFocused(roomId) {
  return (
    chatSurfaceOpen &&
    visibleRoomId === roomId &&
    document.visibilityState === 'visible' &&
    document.hasFocus()
  );
}

function senderLabel(room, event) {
  const userId = eventSender(event);
  const member = room?.getMember?.(userId);

  return (
    member?.name ||
    member?.rawDisplayName ||
    member?.displayName ||
    userId ||
    'New message'
  );
}

function roomLabel(room, roomId) {
  return (
    room?.name ||
    room?.getDefaultRoomName?.(matrixClient()?.getUserId?.()) ||
    roomId ||
    'Chat'
  );
}

function waitForEventDecrypted(event, {
  timeoutMs = DECRYPT_WAIT_MS,
} = {}) {
  if (!event) return Promise.resolve(false);

  if (!event.isEncrypted?.() || !event.isDecryptionFailure?.()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let done = false;
    let timer = 0;

    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        event.removeListener?.('Event.decrypted', onDecrypted);
        event.removeListener?.('decrypted', onDecrypted);
      } catch {}
      resolve(!!ok);
    };

    const onDecrypted = () => finish(true);

    try {
      event.on?.('Event.decrypted', onDecrypted);
      event.on?.('decrypted', onDecrypted);
    } catch (err) {
      console.warn('[YANTA Chat Notifications] Could not attach decrypt listener', err);
      finish(false);
      return;
    }

    timer = window.setTimeout(() => {
      finish(false);
    }, Math.max(250, Number(timeoutMs || DECRYPT_WAIT_MS)));
  });
}

async function ensureEventDecrypted(client, event) {
  if (!event) return false;

  try {
    await client?.decryptEventIfNeeded?.(event);
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not decrypt event for preview', err);
  }

  if (!event.isDecryptionFailure?.()) return true;
  return waitForEventDecrypted(event);
}

function chatDeepLinkUrl(roomId) {
  return `${location.origin}${location.pathname}${location.search}#chat/${encodeURIComponent(roomId)}`;
}

async function notificationPayload(client, roomId, eventId) {
  const room = roomById(client, roomId);
  if (!room) return null;

  const event = findRoomEvent(room, eventId);
  if (!event) return null;

  const own = ownUserId(client);
  if (own && eventSender(event) === own) return null;

  await ensureEventDecrypted(client, event);

  const decryptionFailed = !!event.isDecryptionFailure?.();

  /*
    Nach der Entschlüsselung kann sich ein m.room.encrypted-Event als Edit,
    Reaction oder Redaction entpuppen. Ohne Text-Preview gäbe das eine leere
    "New message"-Notification — solche Events nie melden.
  */
  if (!decryptionFailed) {
    if (event.isRedacted?.()) return null;

    const relates = event.getContent?.()?.['m.relates_to'] || {};
    if (relates.rel_type === 'm.replace' || relates.rel_type === 'm.annotation') {
      return null;
    }

    if (!messagePreview(event)) return null;
  }

  /*
    Placeholder "New encrypted message" nur, wenn die App wirklich im
    Hintergrund ist. Im Vordergrund holen Key-Import/Backup die Entschlüsselung
    meist Sekunden später nach — die Placeholder-Notification bliebe dann als
    leere/stale Notification stehen (Bug: leere Notification beim App-Start).
  */
  if (decryptionFailed && document.visibilityState === 'visible') {
    return null;
  }

  const preview = decryptionFailed
    ? 'New encrypted message'
    : (messagePreview(event) || 'New message');

  const sender = senderLabel(room, event);
  const roomName = roomLabel(room, roomId);

  return {
    roomId,
    eventId,
    title: roomName && roomName !== sender
      ? `${sender} · ${roomName}`
      : sender,
    body: preview,
    roomName,
    sender,
    url: chatDeepLinkUrl(roomId),
    ts: Number(event.getTs?.() || Date.now()),
  };
}

function openChatFromNotification(roomId) {
  try {
    window.focus();
  } catch {}
  /*
    Kein manuelles location.hash-Setzen:
    openChat({ push: true }) schreibt URL und History-State selbst. Ein
    zusätzlicher Hash-Eintrag ohne State erzeugt doppelte Back-Schritte.
  */
  import('./chat-ui.js')
    .then(({ openChat }) => openChat({
      roomId,
      push: true,
    }))
    .catch((err) => {
      console.warn('[YANTA Chat Notifications] Could not open chat from notification', err);
      toast('Could not open chat.', 'error');
    });
}

async function showWebNotification(payload) {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const options = {
    body: payload.body,
    tag: `yanta-chat-${payload.roomId}`,
    renotify: true,
    badge: '/android-chrome-192x192.png',
    icon: '/android-chrome-192x192.png',
    data: {
      roomId: payload.roomId,
      eventId: payload.eventId,
      url: payload.url,
    },
  };

  // Preferred: Service Worker notification (survives tab focus changes,
  // click handling routes through the SW message channel below). Guarded by
  // a timeout — a never-activating SW must not block the page fallback.
  try {
    const reg = await swRegistrationReady();
    if (reg?.showNotification) {
      await reg.showNotification(payload.title, options);
      return true;
    }
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Service Worker notification failed', err);
  }

  // Fallback: page-scoped Notification.
  try {
    try {
      webNotificationsByRoom.get(payload.roomId)?.close?.();
    } catch {}

    const n = new Notification(payload.title, options);
    n.onclick = () => {
      openChatFromNotification(payload.roomId);
      n.close();
    };
    webNotificationsByRoom.set(payload.roomId, n);
    return true;
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Web notification failed', err);
    return false;
  }
}

function clearNotificationsForRoom(roomId) {
  try {
    androidClearChatNotifications(roomId);
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not clear native notifications', err);
  }

  try {
    webNotificationsByRoom.get(roomId)?.close?.();
  } catch {}
  webNotificationsByRoom.delete(roomId);

  // Also clear SW-managed notifications for this room.
  navigator.serviceWorker?.ready
    ?.then((reg) => reg.getNotifications?.({ tag: `yanta-chat-${roomId}` }))
    .then((list) => list?.forEach((n) => n.close()))
    .catch(() => {});
}

function visibleRooms(client) {
  try {
    return client?.getVisibleRooms?.() || client?.getRooms?.() || [];
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not read visible rooms', err);
    return [];
  }
}

function unreadCountForRoom(room) {
  try {
    const total =
      Number(room.getUnreadNotificationCount?.('total') || 0) ||
      Number(room.getUnreadNotificationCount?.() || 0);
    const highlight =
      Number(room.getUnreadNotificationCount?.('highlight') || 0);
    return Math.max(total, highlight, 0);
  } catch {
    return 0;
  }
}

function computeTotalUnread(client) {
  return visibleRooms(client).reduce((sum, room) => sum + unreadCountForRoom(room), 0);
}

/*
  Read on ANY device means: never notify again. The own read receipt for a
  room syncs to every device, so hasUserReadEvent() covers cross-device reads.
*/
function isEventAlreadyRead(client, roomId, eventId) {
  try {
    const own = ownUserId(client);
    const room = roomById(client, roomId);

    return !!(
      own &&
      room &&
      typeof room.hasUserReadEvent === 'function' &&
      room.hasUserReadEvent(own, eventId)
    );
  } catch {
    return false;
  }
}

/*
  Dismiss visible notifications once the room has no unread messages left —
  e.g. after the message was read on another device (receipt arrives via sync).
*/
function clearNotificationsIfRoomRead(roomId) {
  if (!roomId) return;

  const client = matrixClient();
  const room = roomById(client, roomId);

  if (room && unreadCountForRoom(room) === 0) {
    clearNotificationsForRoom(roomId);
  }
}

function emitUnreadChanged(count) {
  const safeCount = Math.max(0, Number(count || 0));
  if (safeCount === lastUnreadCount) return;
  lastUnreadCount = safeCount;

  try {
    androidSetChatUnreadCount(safeCount);
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not update Android badge', err);
  }

  window.dispatchEvent(new CustomEvent('yanta-chat-unread-changed', {
    detail: {
      count: safeCount,
      ts: Date.now(),
    },
  }));
}

export function refreshChatUnreadBadge() {
  const client = matrixClient();
  if (!client) {
    emitUnreadChanged(0);
    return 0;
  }
  const count = computeTotalUnread(client);
  emitUnreadChanged(count);
  return count;
}

async function onIncomingMessage(detail = {}) {
  const client = matrixClient();
  const roomId = detail.roomId || '';
  const eventId = detail.eventId || '';

  if (!client || !roomId || !eventId) return;

  refreshChatUnreadBadge();

  if (isRoomVisibleAndFocused(roomId)) return;
  if (isEventAlreadyRead(client, roomId, eventId)) return;
  if (await isRoomMuted(client, roomId)) return;

  const payload = await notificationPayload(client, roomId, eventId);
  if (!payload) return;

  /*
    notificationPayload wartet auf Entschlüsselung (bis zu DECRYPT_WAIT_MS).
    In der Zwischenzeit kann der Nutzer genau diesen Chat geöffnet oder die
    Nachricht auf einem anderen Gerät gelesen haben — direkt vor dem Anzeigen
    erneut prüfen.
  */
  if (isRoomVisibleAndFocused(roomId)) return;
  if (isEventAlreadyRead(client, roomId, eventId)) return;

  const nativeShown = androidShowChatNotification(payload);
  if (!nativeShown && chatNotificationsEnabled()) {
    await showWebNotification(payload);
  }
}

/**
 * Registers the Matrix HTTP pusher for native Android background pushes.
 *
 * Idempotent. With { force: true } (FCM token rotation) it also removes
 * stale pushers of the same app_id that carry an outdated pushkey, so the
 * homeserver never pushes to dead tokens.
 */
export async function ensureNativeChatPusher({
  force = false,
} = {}) {
  const client = matrixClient();
  const config = androidChatPushConfig();

  if (!client || !config) return false;

  try {
    const appId = config.appId || CHAT_PUSHER_APP_ID;
    const existing = await client.getPushers?.();
    const pushers = existing?.pushers || existing || [];

    const already = pushers.some((p) =>
      p?.kind === 'http' &&
      p?.app_id === appId &&
      p?.pushkey === config.pushkey
    );

    // Remove pushers with rotated/dead FCM tokens for this app.
    const stale = pushers.filter((p) =>
      p?.kind === 'http' &&
      p?.app_id === appId &&
      p?.pushkey &&
      p.pushkey !== config.pushkey
    );
    for (const p of stale) {
      try {
        // Matrix spec: kind null deletes the pusher (app_id + pushkey key).
        await client.setPusher({
          ...p,
          kind: null,
        });
      } catch (err) {
        console.warn('[YANTA Chat Notifications] Could not remove stale pusher', err);
      }
    }

    if (already && !force) return true;

    await client.setPusher({
      kind: 'http',
      app_id: appId,
      pushkey: config.pushkey,
      app_display_name: 'YANTA',
      device_display_name: config.deviceName || 'YANTA Android',
      lang: navigator.language || 'en',
      data: {
        url: config.gatewayUrl,
        /*
          No message content through the push gateway.
          Android receives only event/room ids; decryption stays in the app.
        */
        format: 'event_id_only',
      },
      append: false,
    });

    return true;
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not register Matrix pusher', err);
    toast('Could not enable chat push notifications.', 'error');
    return false;
  }
}

/**
 * Registers a Matrix HTTP pusher for WEB background push, pointing at the
 * YANTA Cloud Worker's push gateway. Coexists with the Android pusher
 * (append: true). event_id_only → no message content reaches the gateway.
 * No-op unless the browser has an active Web Push subscription.
 */
export async function ensureWebChatPusher() {
  const client = matrixClient();
  if (!client || !isPushActive()) return false;

  const gatewayUrl = await getPushGatewayUrl().catch(() => '');
  if (!gatewayUrl) return false;

  const key = pushKey();

  try {
    const existing = await client.getPushers?.();
    const pushers = existing?.pushers || existing || [];

    const already = pushers.some((p) =>
      p?.kind === 'http' &&
      p?.app_id === CHAT_WEB_PUSHER_APP_ID &&
      p?.pushkey === key
    );

    // Drop web pushers with a rotated pushkey for this app.
    const stale = pushers.filter((p) =>
      p?.kind === 'http' &&
      p?.app_id === CHAT_WEB_PUSHER_APP_ID &&
      p?.pushkey &&
      p.pushkey !== key
    );
    for (const p of stale) {
      try {
        await client.setPusher({ ...p, kind: null });
      } catch {}
    }

    if (already) return true;

    await client.setPusher({
      kind: 'http',
      app_id: CHAT_WEB_PUSHER_APP_ID,
      pushkey: key,
      app_display_name: 'YANTA',
      device_display_name: 'YANTA Web',
      lang: navigator.language || 'en',
      data: {
        url: gatewayUrl,
        format: 'event_id_only',
      },
      append: true,
    });

    return true;
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not register web pusher', err);
    return false;
  }
}

/**
 * Removes this device's web chat pusher (called when the user turns off
 * background delivery).
 */
export async function removeWebChatPusher() {
  const client = matrixClient();
  if (!client) return;

  const key = pushKey();

  try {
    const existing = await client.getPushers?.();
    const pushers = existing?.pushers || existing || [];

    for (const p of pushers) {
      if (p?.kind === 'http' && p?.app_id === CHAT_WEB_PUSHER_APP_ID && p?.pushkey === key) {
        try {
          await client.setPusher({ ...p, kind: null });
        } catch {}
      }
    }
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Could not remove web pusher', err);
  }
}

/**
 * Requests Web Notification permission. Call only from a user-initiated
 * flow (e.g. opening Chat) — unsolicited prompts get auto-blocked by
 * browsers and feel hostile.
 */
export async function requestChatWebNotificationPermission() {
  if (!('Notification' in window)) return 'denied';

  try {
    return await Notification.requestPermission();
  } catch (err) {
    console.warn('[YANTA Chat Notifications] Permission request failed', err);
    return 'denied';
  }
}

function maybeRequestWebPermissionOnce() {
  if (webPermissionRequestedThisSession) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  // Native Android handles notifications itself; no web prompt needed there.
  if (androidChatPushConfig() !== null || window.YantaAndroid) return;

  webPermissionRequestedThisSession = true;
  requestChatWebNotificationPermission().catch(() => {});
}

function installServiceWorkerClickListener() {
  if (!navigator.serviceWorker?.addEventListener) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    const data = e.data || {};
    if (data.type !== 'yanta-notification-click') return;
    const roomId = data.roomId || '';
    if (roomId) {
      openChatFromNotification(roomId);
    }
  });
}

/**
 * Installs chat notification listeners.
 */
export function setupChatNotifications() {
  if (installed) return;
  installed = true;

  window.addEventListener('yanta-chat-message', (e) => {
    onIncomingMessage(e.detail || {}).catch((err) => {
      console.warn('[YANTA Chat Notifications] Handling failed', err);
    });
  });

  window.addEventListener('yanta-chat-room-updated', (e) => {
    refreshChatUnreadBadge();
    clearNotificationsIfRoomRead(e.detail?.roomId || '');
  });

  window.addEventListener('yanta-chat-opened', (e) => {
    chatSurfaceOpen = true;
    visibleRoomId = e.detail?.roomId || '';

    if (visibleRoomId) {
      clearNotificationsForRoom(visibleRoomId);
    }
    refreshChatUnreadBadge();

    /*
      Permission prompt only here: the user just opened Chat, which is a
      real interaction context. Prompting on background 'ready' events is
      penalized by Chrome (quieter UI / auto-block).
    */
    maybeRequestWebPermissionOnce();
  });

  window.addEventListener('yanta-chat-closed', () => {
    chatSurfaceOpen = false;
    visibleRoomId = '';
    refreshChatUnreadBadge();
  });

  window.addEventListener('yanta-chat-ready', () => {
    refreshChatUnreadBadge();
    ensureNativeChatPusher().catch((err) => {
      console.warn('[YANTA Chat Notifications] Pusher setup failed', err);
    });
    ensureWebChatPusher().catch((err) => {
      console.warn('[YANTA Chat Notifications] Web pusher setup failed', err);
    });
  });

  // Background delivery toggled on/off — (de)register the web pusher.
  window.addEventListener('yanta-push-state-changed', () => {
    if (isPushActive()) {
      ensureWebChatPusher().catch(() => {});
    } else {
      removeWebChatPusher().catch(() => {});
    }
  });

  /*
    FCM token rotation (dispatched by MainActivity). Force re-registration
    so the homeserver pushes to the new token and stale pushers are removed.
  */
  window.addEventListener('yanta-android-push-token-changed', () => {
    ensureNativeChatPusher({
      force: true,
    }).catch((err) => {
      console.warn('[YANTA Chat Notifications] Pusher rotation failed', err);
    });
  });

  /*
    App zurück im Vordergrund mit offenem Chat: dessen Notifications sind
    ab jetzt sichtbarer Inhalt und müssen aus der Leiste verschwinden.
  */
  const clearVisibleRoomNotifications = () => {
    if (
      chatSurfaceOpen &&
      visibleRoomId &&
      document.visibilityState === 'visible'
    ) {
      clearNotificationsForRoom(visibleRoomId);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshChatUnreadBadge();
      clearVisibleRoomNotifications();
    }
  });

  window.addEventListener('focus', () => {
    refreshChatUnreadBadge();
    clearVisibleRoomNotifications();
  });

  installServiceWorkerClickListener();
}
