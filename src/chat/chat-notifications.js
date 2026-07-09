// ============================================================
// YANTA Chat — Incoming message notifications
//
// Sources:
// - yanta-chat-message (app-level event from matrix-session.js)
//
// Sinks (priority order):
// 1. Native Android notification via bridge (works while app runs;
//    true background push needs the native FCM/Sygnal path, see
//    ensureNativeChatPusher()).
// 2. Web Notification API (only when permission is already granted;
//    we never auto-prompt).
// ============================================================
import {
    toast,
  } from '../core.js';
  import {
    androidShowChatNotification,
    androidClearChatNotifications,
    androidChatPushConfig,
  } from '../native/android-bridge.js';
  import {
    messagePreview,
  } from './chat-message-render.js';
  
  const CHAT_PUSHER_APP_ID = 'page.yanta.android';
  
  let installed = false;
  let chatSurfaceOpen = false;
  let visibleRoomId = '';
  const webNotificationsByRoom = new Map();
  
  function client() {
    return window.yantaChatSession?.client || window.yantaMatrixClient || null;
  }
  
  function isRoomMuted(matrixClient, roomId) {
    try {
      const rule = matrixClient.getRoomPushRule?.('global', roomId);
      return !!rule?.actions?.some?.((action) => action === 'dont_notify');
    } catch {
      return false;
    }
  }
  
  function senderLabel(room, event) {
    const userId = event?.getSender?.() || '';
    const member = room?.getMember?.(userId);
    return member?.name || member?.rawDisplayName || userId || 'New message';
  }
  
  async function notificationPayload(matrixClient, roomId, eventId) {
    const room = matrixClient.getRoom?.(roomId);
    if (!room) return null;
    const event = room.findEventById?.(eventId);
    if (!event) return null;
    const ownUserId = matrixClient.getUserId?.() || '';
    if ((event.getSender?.() || '') === ownUserId) return null;
    try {
      // E2EE: Event ggf. erst entschlüsseln, sonst wäre die Preview leer.
      await matrixClient.decryptEventIfNeeded?.(event);
    } catch (err) {
      console.warn('[YANTA Chat Notifications] could not decrypt event for preview', err);
    }
    const preview = event.isDecryptionFailure?.()
      ? 'New encrypted message'
      : (messagePreview(event) || 'New message');
    return {
      roomId,
      eventId,
      title: senderLabel(room, event),
      body: preview,
      roomName: room.name || '',
      ts: Number(event.getTs?.() || Date.now()),
    };
  }
  
  function showWebNotification(payload) {
    if (!('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    try {
      const n = new Notification(payload.title, {
        body: payload.body,
        tag: `yanta-chat-${payload.roomId}`,
        renotify: true,
      });
      n.onclick = () => {
        window.focus();
        import('./chat-ui.js')
          .then(({ openChat }) => openChat({ roomId: payload.roomId, push: true }))
          .catch((err) => {
            console.warn('[YANTA Chat Notifications] could not open chat', err);
            toast('Could not open chat.', 'error');
          });
        n.close();
      };
      webNotificationsByRoom.get(payload.roomId)?.close?.();
      webNotificationsByRoom.set(payload.roomId, n);
      return true;
    } catch (err) {
      console.warn('[YANTA Chat Notifications] web notification failed', err);
      return false;
    }
  }
  
  function clearNotificationsForRoom(roomId) {
    androidClearChatNotifications(roomId);
    webNotificationsByRoom.get(roomId)?.close?.();
    webNotificationsByRoom.delete(roomId);
  }
  
  async function onIncomingMessage(detail = {}) {
    const matrixClient = client();
    const roomId = detail.roomId || '';
    const eventId = detail.eventId || '';
    if (!matrixClient || !roomId || !eventId) return;
    // Kein Alarm für den Raum, den der User gerade sichtbar offen hat.
    if (
      chatSurfaceOpen &&
      visibleRoomId === roomId &&
      document.visibilityState === 'visible'
    ) {
      return;
    }
    if (isRoomMuted(matrixClient, roomId)) return;
    const payload = await notificationPayload(matrixClient, roomId, eventId);
    if (!payload) return;
    const nativeShown = androidShowChatNotification(payload);
    if (!nativeShown) {
      showWebNotification(payload);
    }
  }
  
  /**
   * Registers a Matrix HTTP pusher when the native app provides a push
   * configuration (FCM token + Sygnal gateway). Idempotent.
   *
   * Warum:
   * Nur dieser Pfad liefert echte Background-Notifications. Ohne native
   * Push-Config bleibt es beim Foreground-Bridge/Web-Fallback.
   */
  export async function ensureNativeChatPusher() {
    const matrixClient = client();
    const config = androidChatPushConfig();
    if (!matrixClient || !config) return false;
    try {
      const existing = await matrixClient.getPushers?.();
      const pushers = existing?.pushers || existing || [];
      const appId = config.appId || CHAT_PUSHER_APP_ID;
      const already = pushers.some(
        (p) => p?.pushkey === config.pushkey && p?.app_id === appId
      );
      if (already) return true;
      await matrixClient.setPusher({
        kind: 'http',
        app_id: appId,
        pushkey: config.pushkey,
        app_display_name: 'YANTA',
        device_display_name: config.deviceName || 'YANTA Android',
        lang: navigator.language || 'en',
        data: {
          url: config.gatewayUrl,
          // event_id_only: der Push-Payload enthält keine Inhalte;
          // die native App holt/entschlüsselt die Nachricht selbst.
          format: 'event_id_only',
        },
        append: false,
      });
      return true;
    } catch (err) {
      console.warn('[YANTA Chat Notifications] could not register Matrix pusher', err);
      toast('Could not enable chat push notifications.', 'error');
      return false;
    }
  }
  
  /**
   * Requests Web Notification permission. Call this only from an explicit
   * user action (settings toggle), never automatically.
   */
  export async function requestChatWebNotificationPermission() {
    if (!('Notification' in window)) {
      toast('Notifications are not supported in this browser.', 'error');
      return 'denied';
    }
    try {
      return await Notification.requestPermission();
    } catch (err) {
      console.warn('[YANTA Chat Notifications] permission request failed', err);
      toast('Could not request notification permission.', 'error');
      return 'denied';
    }
  }
  
  /**
   * Installs chat notification listeners. Safe to call once at startup.
   */
  export function setupChatNotifications() {
    if (installed) return;
    installed = true;
    window.addEventListener('yanta-chat-message', (e) => {
      onIncomingMessage(e.detail || {}).catch((err) => {
        console.warn('[YANTA Chat Notifications] handling failed', err);
      });
    });
    window.addEventListener('yanta-chat-opened', (e) => {
      chatSurfaceOpen = true;
      visibleRoomId = e.detail?.roomId || '';
      if (visibleRoomId) clearNotificationsForRoom(visibleRoomId);
    });
    window.addEventListener('yanta-chat-closed', () => {
      chatSurfaceOpen = false;
      visibleRoomId = '';
    });
    window.addEventListener('yanta-chat-ready', () => {
      ensureNativeChatPusher().catch((err) => {
        console.warn('[YANTA Chat Notifications] pusher setup failed', err);
      });
    });
  }