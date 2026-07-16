// ============================================================
// YANTA Dashboard — information panel
//
// A quiet dashboard widget that surfaces things the user would
// otherwise only discover when they go wrong — e.g. event
// notifications that no connected device has scheduled yet.
//
// Contract: render() returns null when there is nothing to say,
// so the panel does not exist on a healthy dashboard. Once mounted
// it keeps itself fresh and hides again when issues resolve.
// ============================================================

import {
  el,
  lucide,
  escapeHtml,
} from './core.js';

import { registerDashboardWidget } from './dashboard-widgets.js';

import {
  notificationSyncReport,
  observeNotificationSyncStatus,
} from './notification-sync-status.js';

function injectCss() {
  if (document.getElementById('yanta-dash-info-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-dash-info-css';
  style.textContent = `
.yanta-dash-widget-info .yanta-dash-info-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-dash-info-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  padding: 10px 12px;

  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev);
}

.yanta-dash-info-item > svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--accent);
}

.yanta-dash-info-item.warn > svg {
  color: var(--yellow, #eab308);
}

.yanta-dash-info-body {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yanta-dash-info-body strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}

.yanta-dash-info-body small {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-dash-info-fix {
  align-self: flex-start;

  margin-top: 2px;
  padding: 0;

  border: 0;
  background: transparent;

  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.yanta-dash-info-fix:hover {
  text-decoration: underline;
}

.yanta-dash-info-details {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.yanta-dash-info-details[hidden] {
  display: none !important;
}
`;

  document.head.append(style);
}

function isAndroidApp() {
  return !!window.yantaAndroidBridge?.isAndroidApp?.();
}

function formatDeviceNames(devices) {
  const names = devices.map((d) => d.name).filter(Boolean);

  if (!names.length) return 'your Android device';
  if (names.length === 1) return `"${names[0]}"`;

  return names.slice(0, -1).map((n) => `"${n}"`).join(', ') +
    ` and "${names[names.length - 1]}"`;
}

/**
 * Collect the items worth showing. Returns [] on a healthy setup —
 * the widget stays invisible then.
 */
function collectInfoItems() {
  let report;

  try {
    report = notificationSyncReport();
  } catch {
    return [];
  }

  const items = [];
  const inApp = isAndroidApp();

  // Nothing scheduled → notifications cannot be a problem.
  if (!report.reminderEventCount) return items;

  if (report.pendingEvents.length && report.hasNotificationDevices) {
    const n = report.pendingEvents.length;
    const stale = report.staleDevices;

    items.push({
      id: 'notifications-pending',
      tone: 'warn',
      icon: 'bell-ring',
      title: n === 1
        ? '1 event notification is not on a notification device yet'
        : `${n} event notifications are not on a notification device yet`,
      text: `Open YANTA on ${formatDeviceNames(stale.length ? stale : report.devices)} to sync — reminders only fire once the app there knows them.`,
      details: 'Event notifications are delivered by the YANTA Android app. ' +
        'Each phone schedules them locally when the app is opened and syncs. ' +
        'Until then, new or changed reminders exist only on the device that created them.',
    });
  }

  if (report.pendingEvents.length && !report.hasNotificationDevices && !inApp) {
    const n = report.pendingEvents.length;

    items.push({
      id: 'notifications-no-device',
      tone: 'warn',
      icon: 'bell-off',
      title: n === 1
        ? '1 upcoming notification has no device that can deliver it'
        : `${n} upcoming notifications have no device that can deliver them`,
      text: 'No connected Android device can show event reminders yet.',
      details: 'Install the YANTA app on your Android phone, connect it to ' +
        'this vault and open it once — it registers as a notification ' +
        'device and schedules your reminders automatically from then on.',
    });
  }

  for (const device of report.permissionIssueDevices) {
    items.push({
      id: `notifications-permissions-${device.id}`,
      tone: 'warn',
      icon: 'bell-off',
      title: `Notifications are disabled on "${device.name}"`,
      text: device.current
        ? 'Allow notifications and exact alarms so reminders can fire on this device.'
        : `Open YANTA on "${device.name}" and allow notifications and exact alarms.`,
      details: 'Android requires both the notification permission and the ' +
        '"Alarms & reminders" permission for reliable, exactly-timed event ' +
        'reminders. Both can be granted from the notification section of ' +
        'any event on that device.',
    });
  }

  return items;
}

function renderItems(body) {
  const items = collectInfoItems();

  if (!items.length) {
    body.replaceChildren();
    return 0;
  }

  const list = el('div', { class: 'yanta-dash-info-list' });

  for (const item of items) {
    const row = el('div', {
      class: `yanta-dash-info-item ${item.tone || ''}`,
    });

    row.innerHTML = `
      ${lucide(item.icon || 'info', 16)}
      <div class="yanta-dash-info-body">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.text)}</small>
        ${
          item.details
            ? `
              <button type="button" class="yanta-dash-info-fix" data-info-fix>How does this work?</button>
              <div class="yanta-dash-info-details" hidden>${escapeHtml(item.details)}</div>
            `
            : ''
        }
      </div>
    `;

    const fixBtn = row.querySelector('[data-info-fix]');
    const details = row.querySelector('.yanta-dash-info-details');

    fixBtn?.addEventListener('click', () => {
      const show = details.hidden;
      details.hidden = !show;
      fixBtn.textContent = show ? 'Hide' : 'How does this work?';
    });

    list.append(row);
  }

  body.replaceChildren(list);

  return items.length;
}

async function renderInfoPanel() {
  injectCss();

  const section = el('section', {
    class: 'yanta-dash-widget yanta-dash-widget-info',
  });

  const head = el('div', { class: 'yanta-dash-widget-head' });
  head.innerHTML = `
    ${lucide('info', 15)}
    <span class="yanta-dash-widget-title">Information</span>
  `;

  const body = el('div', { class: 'yanta-dash-info-body-host' });
  section.append(head, body);

  const refresh = () => {
    const count = renderItems(body);

    /*
      Self-hide via inline style, not [hidden]: several stylesheets
      set explicit display on widget sections, which silently defeats
      the hidden attribute (long-standing YANTA pitfall).
    */
    section.style.display = count ? '' : 'none';

    return count;
  };

  const alive = () => section.isConnected;

  const onCalendarUpdated = () => {
    if (!alive()) {
      window.removeEventListener('yanta-calendar-updated', onCalendarUpdated);
      window.removeEventListener('yanta-native-notification-status-changed', onCalendarUpdated);
      return;
    }

    refresh();
  };

  window.addEventListener('yanta-calendar-updated', onCalendarUpdated);
  window.addEventListener('yanta-native-notification-status-changed', onCalendarUpdated);

  // Device acks land through vault sync — flip items live.
  observeNotificationSyncStatus(refresh, alive);

  if (!refresh()) {
    /*
      Nothing to show right now. Still return the (hidden) section:
      issues can appear later in the session, and the refresh hooks
      above will reveal it without a dashboard re-render.
    */
  }

  return section;
}

registerDashboardWidget({
  id: 'info-panel',
  title: 'Information',
  icon: 'info',
  order: 5,
  render: renderInfoPanel,
});
