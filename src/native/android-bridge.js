import { state, toast, } from '../core.js';

import { recordNativeNotificationAck } from '../notification-sync-status.js';
import { effectiveRemindersForEvent } from '../calendar-personal.js';
import { getCalendarPreferences } from '../calendar-preferences.js';

let installed = false;
let syncTimer = 0;
let lastCalendarWidgetPayload = '';
let lastNotificationStatus = {
  isAndroidApp: false,
  notificationsGranted: false,
  exactAlarmAllowed: false,
};

function isAndroidApp() {
  return !!window.YantaAndroid;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function callAndroid(method, ...args) {
  try {
    if (!window.YantaAndroid?.[method]) return null;
    return window.YantaAndroid[method](...args);
  } catch (err) {
    console.warn('[YANTA Android Bridge]', method, err);
    return null;
  }
}

export function androidNotificationStatus() {
  if (!isAndroidApp()) {
    return {
      isAndroidApp: false,
      notificationsGranted: false,
      exactAlarmAllowed: false,
    };
  }

  const raw = callAndroid('getNotificationStatus');
  if (!raw) return lastNotificationStatus;

  try {
    lastNotificationStatus = JSON.parse(raw);
  } catch {}

  return lastNotificationStatus;
}

export function requestAndroidNotifications() {
  callAndroid('requestNotificationPermission');
}

export function openAndroidNotificationSettings() {
  callAndroid('openNotificationSettings');
}

export function openAndroidExactAlarmSettings() {
  callAndroid('openExactAlarmSettings');
}

function reminderSafe(reminder = {}) {
  const minutesBefore = Number(reminder.minutesBefore);
  if (!Number.isFinite(minutesBefore) || minutesBefore < 0) return null;

  return {
    id: String(reminder.id || `r_${minutesBefore}`),
    label: String(reminder.label || ''),
    minutesBefore: Math.round(minutesBefore),
    enabled: reminder.enabled !== false,
  };
}

function eventForNative(ev = {}) {
  if (!ev?.id || !ev?.start) return null;

  // What actually fires for THIS user: the event's own reminders (or
  // the personal overlay for shared-calendar events) plus the personal
  // per-category default reminders, deduplicated by offset.
  const reminders = effectiveRemindersForEvent(ev)
    .map(reminderSafe)
    .filter(Boolean);

  if (!reminders.length) return null;

  return {
    id: String(ev.id),
    title: String(ev.title || 'Untitled event'),
    start: ev.start,
    end: ev.end || null,
    allDay: !!ev.allDay,
    reminders,
  };
}

async function collectCalendarEvents() {
  try {
    const calendar = await import('../calendar.js');
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 420 * 24 * 60 * 60 * 1000);

    const events = calendar.expandedCalendarRawEventsForRange(start, end, {
      includeStored: true,
      includeMarkdownDerived: false,
      includeSources: false,
    });

    return events.map(eventForNative).filter(Boolean);
  } catch (err) {
    console.warn('[YANTA Android Bridge] calendar collect failed', err);
    return [];
  }
}

function collectNotes() {
  return [...state.notes.values()]
    .filter((n) => !n.trashed)
    .sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0))
    .slice(0, 24)
    .map((n) => ({
      id: n.id,
      title: n.title || 'Untitled',
      folderId: n.folderId || null,
      icon: n.icon || 'file-text',
      color: n.color || '',
      updated: Number(n.updated || 0),
    }));
}

function collectFolders() {
  return [...state.folders.values()]
    .filter((f) => !f.trashed)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 24)
    .map((f) => ({
      id: f.id,
      title: f.name || 'Folder',
      parentId: f.parentId || null,
      icon: f.icon || 'folder',
      color: f.color || '',
      updated: Number(f.updated || f.created || 0),
    }));
}

async function collectRssItems() {
  try {
    const { listRssItems } = await import('../rss/rss-store.js');
    const items = await listRssItems({
      unreadOnly: false,
      archived: false,
      limit: 24,
    });

    return items.map((item) => ({
      id: item.id,
      title: item.title || 'Untitled',
      feedTitle: item.feedTitle || '',
      imageUrl: item.imageUrl || '',
      url: item.url || '',
      publishedAt: item.publishedAt || item.discoveredAt || 0,
      read: !!item.read,
    }));
  } catch {
    return [];
  }
}

/**
 * How many home-screen widgets of each kind are currently placed.
 *
 * Building the widget calendar payload expands recurrences over more than
 * a year, so it is worth skipping entirely when nothing renders it.
 */
function androidWidgetState() {
  const raw = callAndroid('getWidgetState');

  try {
    const parsed = JSON.parse(raw || '{}');

    return {
      calendar: Number(parsed.calendar) || 0,
      quickCreate: Number(parsed.quickCreate) || 0,
    };
  } catch {
    return { calendar: 0, quickCreate: 0 };
  }
}

/*
  Widget navigation window. Deep enough that paging months back and forth
  stays instant, bounded so the payload cannot grow without limit.
*/
const WIDGET_RANGE_DAYS_PAST = 92;
const WIDGET_RANGE_DAYS_FUTURE = 400;
const WIDGET_MAX_EVENTS = 3000;

async function collectCalendarWidgetPayload() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - WIDGET_RANGE_DAYS_PAST);

  const end = new Date(start);
  end.setDate(end.getDate() + WIDGET_RANGE_DAYS_PAST + WIDGET_RANGE_DAYS_FUTURE);

  const calendar = await import('../calendar.js');

  const events = calendar.calendarEventsForNativeSurfaces(start, end, {
    limit: WIDGET_MAX_EVENTS,
  });

  const prefs = getCalendarPreferences();

  return {
    version: 1,
    updatedAt: Date.now(),
    rangeStart: start.getTime(),
    rangeEnd: end.getTime(),
    theme: state.theme || 'auto',
    weekStart: Number(prefs.weekStart) || 0,
    timeFormat: prefs.timeFormat === '12' ? '12' : '24',
    locale: prefs.locale === 'auto' ? '' : String(prefs.locale || ''),
    events,
  };
}

/**
 * Pushes the calendar data the home-screen widgets render from.
 *
 * Kept out of the notification snapshot on purpose: that one is a small
 * reminder digest read by the alarm scheduler on every sync, while this is
 * a large display payload written to a file and only read when a widget
 * redraws.
 */
async function syncCalendarWidgetDataNow() {
  if (typeof window.YantaAndroid?.syncCalendarWidgetData !== 'function') return;
  if (!androidWidgetState().calendar) return;

  try {
    const payload = safeJson(await collectCalendarWidgetPayload());

    // Redrawing widgets is not free — skip identical payloads.
    if (payload === lastCalendarWidgetPayload) return;

    lastCalendarWidgetPayload = payload;
    callAndroid('syncCalendarWidgetData', payload);
  } catch (err) {
    console.warn('[YANTA Android Bridge] widget calendar sync failed', err);
  }
}

export async function syncNativeSnapshotNow() {
  if (!isAndroidApp()) return;

  const [calendarEvents, rssItems] = await Promise.all([
    collectCalendarEvents(),
    collectRssItems(),
  ]);

  const notificationStatus = androidNotificationStatus();

  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    notificationStatus,
    calendarEvents,
    notes: collectNotes(),
    folders: collectFolders(),
    rssItems,
  };

  callAndroid('syncNativeSnapshot', safeJson(snapshot));

  await syncCalendarWidgetDataNow();

  /*
    The native alarm scheduler now knows the current reminders —
    publish that to the synced device record so other devices can
    show whether reminders are actually covered somewhere.
  */
  try {
    recordNativeNotificationAck(notificationStatus);
  } catch (err) {
    console.warn('[YANTA Android Bridge] notification ack failed', err);
  }
}

export function scheduleNativeSnapshotSync(delay = 500) {
  if (!isAndroidApp()) return;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncNativeSnapshotNow().catch((err) => {
      console.warn('[YANTA Android Bridge] sync failed', err);
    });
  }, delay);
}

function base64ToBlob(b64, type) {
  const bin = atob(String(b64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

function openNativeShare(data) {
  const files = [];
  const img = data?.image;

  if (img?.data) {
    try {
      const type = String(img.type || 'image/*');
      const blob = base64ToBlob(img.data, type);
      files.push(new File([blob], String(img.name || 'shared-image'), { type: blob.type }));
    } catch (err) {
      console.warn('[YANTA Android Bridge] shared image decode failed', err);
    }
  }

  const payload = {
    title: String(data?.title || ''),
    text: String(data?.text || ''),
    url: String(data?.url || ''),
    files,
  };

  if (!payload.title && !payload.text && !payload.url && !files.length) return;

  // Same in-app router the Web Share Target (PWA) opens — the native app just
  // feeds it the shared content. Lazy so it stays out of the main bundle.
  import('../share-target/share-router.js')
    .then(({ openShareRouter }) => openShareRouter(payload))
    .catch((err) => console.warn('[YANTA Android Bridge] share router failed', err));
}

/**
 * Pull any shared payload the native app stashed and open the router. Called
 * once the app is booted (main.js) and again on the native "available" nudge
 * for warm launches — pulling (vs. a one-shot event) avoids losing a share
 * when the SPA hasn't finished booting.
 */
export function consumeNativeSharedPayload() {
  if (!isAndroidApp()) return;
  if (typeof window.YantaAndroid?.consumeSharedPayload !== 'function') return;

  const raw = callAndroid('consumeSharedPayload');
  if (!raw || raw === 'null') return;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  openNativeShare(data);
}

/*
  Native action ids are the app's own CREATE_ACTIONS ids, so a widget or
  launcher shortcut ends up in exactly the same code path as the in-app
  create menu. Only these older shortcut names predate that convention.
*/
const LEGACY_NATIVE_ACTIONS = {
  sources: 'rss',
  quick_note: 'note',
  quick_folder: 'folder',
  quick_event: 'event',
};

function handleNativeQuickAction(action = '', params = {}) {
  const normalized = String(action || '').trim();
  if (!normalized) return;

  // Calendar targets are the only ones carrying parameters (date, event id).
  if (normalized.startsWith('calendar')) {
    import('../calendar.js')
      .then(({ openCalendarFromNative }) => openCalendarFromNative({
        date: params.date || null,
        eventId: params.id || '',
        create: normalized === 'calendar-new',
      }))
      .catch((err) => {
        console.warn('[YANTA Android Bridge] calendar action failed', err);
        toast('Could not open the calendar.', 'error');
      });

    return;
  }

  import('../create-actions.js')
    .then(({ runCreateAction }) => runCreateAction(
      LEGACY_NATIVE_ACTIONS[normalized] || normalized,
      { source: 'android-widget' },
    ))
    .catch((err) => {
      console.warn('[YANTA Android Bridge] create action failed', err);
    });
}

export function setupAndroidBridge() {
  if (installed) return;
  installed = true;

  window.yantaAndroidBridge = {
    isAndroidApp,
    status: androidNotificationStatus,
    requestNotifications: requestAndroidNotifications,
    openNotificationSettings: openAndroidNotificationSettings,
    openExactAlarmSettings: openAndroidExactAlarmSettings,
    syncNow: syncNativeSnapshotNow,
    syncSoon: scheduleNativeSnapshotSync,
    chatMediaStatus: androidChatMediaStatus,
    showChatNotification: androidShowChatNotification,
    clearChatNotifications: androidClearChatNotifications,
    chatPushConfig: androidChatPushConfig,
    setChatUnreadCount: androidSetChatUnreadCount,
    handleDeepLink: handleAndroidDeepLink,
  };

  window.addEventListener('yanta-android-notification-status', (e) => {
    lastNotificationStatus = {
      ...lastNotificationStatus,
      ...(e.detail || {}),
    };
    window.dispatchEvent(new CustomEvent('yanta-native-notification-status-changed', {
      detail: lastNotificationStatus,
    }));

    // Permission changes alter what the device can deliver — refresh
    // the native snapshot + synced notification ack right away.
    scheduleNativeSnapshotSync(300);
  });

  window.addEventListener('yanta-android-quick-action', (e) => {
    handleNativeQuickAction(e.detail?.action || '', e.detail?.params || {});
  });

  window.addEventListener('yanta-android-share-available', () => {
    consumeNativeSharedPayload();
  });

  window.addEventListener('yanta-android-action-available', () => {
    consumeNativeQuickAction();
  });

  window.addEventListener('yanta-android-open-url', (e) => {
    handleAndroidDeepLink(e.detail?.url || e.detail?.hash || '');
  });

  window.addEventListener('yanta-android-chat-notification-open', (e) => {
    const roomId = e.detail?.roomId || '';

    handleAndroidDeepLink(
      e.detail?.url ||
      `#chat/${encodeURIComponent(roomId)}`
    );
  });

  [
    'yanta-calendar-updated',
    'yanta-vault-hydrated',
    'yanta-note-updated',
    'yanta-folder-updated',
    'yanta-rss-updated',
    // Widgets mirror the app's light/dark choice.
    'yanta-theme-change',
  ].forEach((name) => {
    window.addEventListener(name, () => scheduleNativeSnapshotSync(900));
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleNativeSnapshotSync(300);
  });

  window.setTimeout(() => scheduleNativeSnapshotSync(1500), 1500);
}

/**
 * Chat media capability status from the native Android app.
 *
 * Contract (native side, later): getChatMediaStatus() returns JSON like
 * { micGranted: bool, filePickerSupported: bool, storageGranted: bool }.
 * Missing bridge method means the installed app version cannot handle
 * chat media yet — callers must show feedback instead of failing silently.
 */
export function androidChatMediaStatus() {
  if (!isAndroidApp()) {
    return { isAndroidApp: false, supported: true };
  }
  if (typeof window.YantaAndroid?.getChatMediaStatus !== 'function') {
    return { isAndroidApp: true, supported: false, reason: 'bridge-missing' };
  }
  const raw = callAndroid('getChatMediaStatus');
  try {
    return { isAndroidApp: true, supported: true, ...JSON.parse(raw || '{}') };
  } catch (err) {
    console.warn('[YANTA Android Bridge] getChatMediaStatus parse failed', err);
    return { isAndroidApp: true, supported: false, reason: 'bridge-error' };
  }
}

/**
 * Shows a native chat notification.
 *
 * Payload:
 * { roomId, eventId, title, body, roomName, sender, url, ts }
 */
export function androidShowChatNotification(notification) {
  if (!isAndroidApp()) return false;

  if (typeof window.YantaAndroid?.showChatNotification !== 'function') {
    return false;
  }

  callAndroid('showChatNotification', safeJson({
    ...notification,
    url:
      notification?.url ||
      `${location.origin}${location.pathname}${location.search}#chat/${encodeURIComponent(notification?.roomId || '')}`,
  }));

  return true;
}

/**
 * Clears native chat notifications. Pass roomId to clear one room.
 */
export function androidClearChatNotifications(roomId = '') {
  callAndroid('clearChatNotifications', String(roomId || ''));
}

/**
 * Updates native app badge / launcher unread count if supported.
 */
export function androidSetChatUnreadCount(count = 0) {
  if (!isAndroidApp()) return false;

  const n = Math.max(0, Number(count || 0));

  if (typeof window.YantaAndroid?.setChatUnreadCount !== 'function') {
    return false;
  }

  callAndroid('setChatUnreadCount', String(n));

  return true;
}

/**
 * Native push configuration for Matrix HTTP pushers.
 *
 * Native contract:
 * getChatPushConfig() returns JSON:
 * {
 *   pushkey: '<fcm-token>',
 *   gatewayUrl: 'https://push.yanta.page/_matrix/push/v1/notify',
 *   appId: 'page.yanta.android',
 *   deviceName: 'Pixel 8'
 * }
 */
export function androidChatPushConfig() {
  if (!isAndroidApp()) return null;

  if (typeof window.YantaAndroid?.getChatPushConfig !== 'function') {
    return null;
  }

  const raw = callAndroid('getChatPushConfig');

  try {
    const config = JSON.parse(raw || 'null');

    return config?.pushkey && config?.gatewayUrl
      ? config
      : null;
  } catch (err) {
    console.warn('[YANTA Android Bridge] getChatPushConfig parse failed', err);
    toast('Could not read Android chat push configuration.', 'error');
    return null;
  }
}

/**
 * Pull any widget/shortcut action the native app stashed for a cold start.
 *
 * Same reasoning as consumeNativeSharedPayload: a one-shot event fired on
 * page load races the SPA's boot, and the calendar targets need the app
 * fully rendered. main.js pulls once the first surface is interactive, and
 * again on the native "available" nudge for warm launches.
 */
export function consumeNativeQuickAction() {
  if (!isAndroidApp()) return;
  if (typeof window.YantaAndroid?.consumePendingAction !== 'function') return;

  const raw = callAndroid('consumePendingAction');
  if (!raw || raw === 'null') return;

  try {
    const payload = JSON.parse(raw);
    handleNativeQuickAction(payload?.action || '', payload?.params || {});
  } catch (err) {
    console.warn('[YANTA Android Bridge] pending action parse failed', err);
  }
}

/**
 * Opens an app deep link from native.
 */
export function handleAndroidDeepLink(urlOrHash = '') {
  const raw = String(urlOrHash || '').trim();

  if (!raw) return false;

  try {
    const url = raw.startsWith('#')
      ? new URL(location.href.split('#')[0] + raw)
      : new URL(raw, location.href);

    if (url.hash.startsWith('#chat-dm/')) {
      const handle = decodeURIComponent(url.hash.replace(/^#chat-dm\//, ''));

      import('../chat/chat-ui.js')
        .then(({ startDmFromDeepLink }) => startDmFromDeepLink(handle))
        .catch((err) => {
          console.warn('[YANTA Android Bridge] Could not start chat from deep link', err);
          toast('Could not start chat from link.', 'error');
        });

      return true;
    }

    if (url.hash.startsWith('#chat/')) {
      const roomId = decodeURIComponent(url.hash.replace(/^#chat\//, ''));

      /*
        Kein manuelles location.hash-Setzen:
        openChat({ push: true }) schreibt URL und History-State selbst. Ein
        zusätzlicher Hash-Eintrag ohne State erzeugt doppelte Back-Schritte.
      */
      import('../chat/chat-ui.js')
        .then(({ openChat }) => openChat({
          roomId,
          push: true,
        }))
        .catch((err) => {
          console.warn('[YANTA Android Bridge] Could not open chat deep link', err);
          toast('Could not open chat.', 'error');
        });

      return true;
    }

    location.href = url.href;
    return true;
  } catch (err) {
    console.warn('[YANTA Android Bridge] Invalid deep link', err);
    toast('Could not open Android link.', 'error');
    return false;
  }
}