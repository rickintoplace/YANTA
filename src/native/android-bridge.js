import { state } from '../core.js';

let installed = false;
let syncTimer = 0;
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

  const reminders = Array.isArray(ev.reminders)
    ? ev.reminders.map(reminderSafe).filter(Boolean)
    : [];

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

export async function syncNativeSnapshotNow() {
  if (!isAndroidApp()) return;

  const [calendarEvents, rssItems] = await Promise.all([
    collectCalendarEvents(),
    collectRssItems(),
  ]);

  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    notificationStatus: androidNotificationStatus(),
    calendarEvents,
    notes: collectNotes(),
    folders: collectFolders(),
    rssItems,
  };

  callAndroid('syncNativeSnapshot', safeJson(snapshot));
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

function handleNativeQuickAction(action = '') {
  const normalized = String(action || '');

  import('../create-actions.js').then(({ runCreateAction }) => {
    if (normalized === 'quick_note') {
      runCreateAction('note', { source: 'android-widget' });
    } else if (normalized === 'quick_folder') {
      runCreateAction('folder', { source: 'android-widget' });
    } else if (normalized === 'quick_event') {
      runCreateAction('event', { source: 'android-widget' });
    } else if (normalized === 'sources') {
      runCreateAction('rss', { source: 'android-widget' });
    } else if (normalized === 'ai') {
      window.dispatchEvent(new CustomEvent('yanta-open-ai-assistant'));
    }
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
  };

  window.addEventListener('yanta-android-notification-status', (e) => {
    lastNotificationStatus = {
      ...lastNotificationStatus,
      ...(e.detail || {}),
    };
    window.dispatchEvent(new CustomEvent('yanta-native-notification-status-changed', {
      detail: lastNotificationStatus,
    }));
  });

  window.addEventListener('yanta-android-quick-action', (e) => {
    handleNativeQuickAction(e.detail?.action || '');
  });

  [
    'yanta-calendar-updated',
    'yanta-vault-hydrated',
    'yanta-note-updated',
    'yanta-folder-updated',
    'yanta-rss-updated',
  ].forEach((name) => {
    window.addEventListener(name, () => scheduleNativeSnapshotSync(900));
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleNativeSnapshotSync(300);
  });

  window.setTimeout(() => scheduleNativeSnapshotSync(1500), 1500);
}