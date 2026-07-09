// ============================================================
// YANTA Chat — AP8 incoming message notifications
//
// Sources:
// - yanta-chat-message from matrix-session.js
//
// Sinks:
// 1. Native Android notification bridge.
// 2. Web Notification API when permission is already granted.
//
// Wichtig:
// JavaScript läuft nicht, wenn Browser/PWA komplett geschlossen ist.
// Echte Background-Notifications brauchen den nativen Android Push-Pfad:
// ensureNativeChatPusher() registriert einen Matrix HTTP Pusher, wenn die
// Android-App pushkey + gatewayUrl bereitstellt.
// ============================================================

import {
    toast,
  } from '../core.js';
  
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
  
  const CHAT_PUSHER_APP_ID = 'page.yanta.android';
  const LOCAL_MUTED_ROOMS_KEY = 'chat.mutedRooms.v1';
  const DECRYPT_WAIT_MS = 2500;
  
  let installed = false;
  let chatSurfaceOpen = false;
  let visibleRoomId = '';
  let webNotificationsByRoom = new Map();
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
      return room.findEventById?.(eventId) || null;
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
  
  async function localMutedRooms() {
    try {
      const ids = await chatSettings.get(LOCAL_MUTED_ROOMS_KEY, []);
      return new Set(Array.isArray(ids) ? ids.map(String) : []);
    } catch (err) {
      console.warn('[YANTA Chat Notifications] Could not read local mute list', err);
      toast('Could not read chat notification settings.', 'error');
      return new Set();
    }
  }
  
  async function isRoomMuted(client, roomId) {
    try {
      const room = roomById(client, roomId);
  
      /*
        Matrix SDK variants differ. Prefer room.getPushRuleActions when present,
        otherwise client-level room push rule.
      */
      const roomActions = room?.getPushRuleActions?.();
  
      if (Array.isArray(roomActions)) {
        if (roomActions.includes('dont_notify')) return true;
      }
  
      const rule = client?.getRoomPushRule?.('global', roomId);
  
      if (rule?.actions?.some?.((action) => action === 'dont_notify')) {
        return true;
      }
  
      const muted = await localMutedRooms();
      return muted.has(roomId);
    } catch (err) {
      console.warn('[YANTA Chat Notifications] Could not inspect room mute state', err);
      toast('Could not check chat notification settings.', 'error');
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
    return room?.name || room?.getDefaultRoomName?.(matrixClient()?.getUserId?.()) || roomId || 'Chat';
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
  
  async function notificationPayload(client, roomId, eventId) {
    const room = roomById(client, roomId);
  
    if (!room) return null;
  
    const event = findRoomEvent(room, eventId);
  
    if (!event) return null;
  
    const own = ownUserId(client);
  
    if (own && eventSender(event) === own) {
      return null;
    }
  
    await ensureEventDecrypted(client, event);
  
    const preview = event.isDecryptionFailure?.()
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
      url: `${location.origin}${location.pathname}${location.search}#chat/${encodeURIComponent(roomId)}`,
      ts: Number(event.getTs?.() || Date.now()),
    };
  }
  
  function showWebNotification(payload) {
    if (!('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
  
    try {
      const old = webNotificationsByRoom.get(payload.roomId);
  
      try {
        old?.close?.();
      } catch {}
  
      const n = new Notification(payload.title, {
        body: payload.body,
        tag: `yanta-chat-${payload.roomId}`,
        renotify: true,
        badge: '/icons/icon-192.png',
        icon: '/icons/icon-192.png',
        data: {
          roomId: payload.roomId,
          eventId: payload.eventId,
          url: payload.url,
        },
      });
  
      n.onclick = () => {
        try {
          window.focus();
        } catch {}
  
        location.hash = `#chat/${encodeURIComponent(payload.roomId)}`;
  
        import('./chat-ui.js')
          .then(({ openChat }) => openChat({
            roomId: payload.roomId,
            push: true,
          }))
          .catch((err) => {
            console.warn('[YANTA Chat Notifications] Could not open chat from notification', err);
            toast('Could not open chat.', 'error');
          });
  
        n.close();
      };
  
      webNotificationsByRoom.set(payload.roomId, n);
  
      return true;
    } catch (err) {
      console.warn('[YANTA Chat Notifications] Web notification failed', err);
      toast('Could not show chat notification.', 'error');
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
  }
  
  function visibleRooms(client) {
    try {
      return client?.getVisibleRooms?.() || client?.getRooms?.() || [];
    } catch (err) {
      console.warn('[YANTA Chat Notifications] Could not read visible rooms', err);
      toast('Could not update chat badge.', 'error');
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
  
    if (isRoomVisibleAndFocused(roomId)) {
      return;
    }
  
    if (await isRoomMuted(client, roomId)) {
      return;
    }
  
    const payload = await notificationPayload(client, roomId, eventId);
  
    if (!payload) return;
  
    const nativeShown = androidShowChatNotification(payload);
  
    if (!nativeShown) {
      showWebNotification(payload);
    }
  }
  
  /**
   * Registers Matrix HTTP push for native Android background notifications.
   */
  export async function ensureNativeChatPusher() {
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
  
      if (already) return true;
  
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
            Keine Message-Inhalte im Push-Gateway.
            Android erhält nur Event-IDs und lässt Matrix/YANTA entschlüsseln.
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
   * Requests Web Notification permission from an explicit user action.
   */
  export async function requestChatWebNotificationPermission() {
    if (!('Notification' in window)) {
      toast('Notifications are not supported in this browser.', 'error');
      return 'denied';
    }
  
    try {
      return await Notification.requestPermission();
    } catch (err) {
      console.warn('[YANTA Chat Notifications] Permission request failed', err);
      toast('Could not request notification permission.', 'error');
      return 'denied';
    }
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
        toast('Could not handle chat notification.', 'error');
      });
    });
  
    window.addEventListener('yanta-chat-room-updated', () => {
      refreshChatUnreadBadge();
    });
  
    window.addEventListener('yanta-chat-opened', (e) => {
      chatSurfaceOpen = true;
      visibleRoomId = e.detail?.roomId || '';
  
      if (visibleRoomId) {
        clearNotificationsForRoom(visibleRoomId);
      }
  
      refreshChatUnreadBadge();
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
        toast('Could not set up chat push notifications.', 'error');
      });
    });
  
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshChatUnreadBadge();
      }
    });
  
    window.addEventListener('focus', () => {
      refreshChatUnreadBadge();
    });
  }