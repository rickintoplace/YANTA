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
import { t } from './i18n/index.js';

import {
  notificationSyncReport,
  observeNotificationSyncStatus,
} from './notification-sync-status.js';

import {
  computeInstallRecommendation,
  onInstallStateChange,
} from './install/install-manager.js';

import { openInstallModal } from './install/install-ui.js';
import { workspaceHasContent } from './first-contact.js';

import { pausedByPlanRoutines, openPulseOverview } from './pulse/pulse-overview.js';

const INSTALL_HINT_DISMISSED_KEY = 'yanta.install.hint.dismissed.v1';

function dismissedInstallHints() {
  try {
    const raw = localStorage.getItem(INSTALL_HINT_DISMISSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function dismissInstallHint(id) {
  try {
    const set = dismissedInstallHints();
    set.add(id);
    localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, JSON.stringify([...set]));
  } catch {}
}

/*
  Plan-paused routines, resolved asynchronously and cached for the
  synchronous collector.

  Deliberately shown here rather than pushed: a routine the plan paused
  is not urgent enough to interrupt someone's evening, but it is exactly
  the kind of thing you should not have to go looking for. The dashboard
  is where you find out — which is what this panel is for.
*/
let pulsePaused = [];

async function refreshPulsePaused() {
  try {
    const paused = await pausedByPlanRoutines();
    const changed = paused.length !== pulsePaused.length;

    pulsePaused = paused;

    return changed;
  } catch {
    pulsePaused = [];
    return false;
  }
}

function collectPulseItems() {
  if (!pulsePaused.length) return [];

  return [{
    id: 'pulse-paused-by-plan',
    tone: 'warn',
    icon: 'pause',
    title: t('infoPanel.pulsePausedTitle', { count: pulsePaused.length }),
    text: t('infoPanel.pulsePausedText', {
      names: pulsePaused.map((routine) => routine.name).join(', '),
    }),
    action: {
      label: t('infoPanel.pulsePausedCta'),
      onClick: () => openPulseOverview(),
    },
  }];
}

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

.yanta-dash-info-action {
  align-self: flex-start;

  margin-top: 6px;
  padding: 6px 12px;

  border: 0;
  border-radius: 8px;
  background: var(--accent);

  color: var(--accent-contrast, #fff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.yanta-dash-info-action:hover {
  filter: brightness(1.05);
}

.yanta-dash-info-dismiss {
  flex: 0 0 auto;
  margin: -2px -4px 0 0;
  padding: 4px;

  border: 0;
  background: transparent;

  color: var(--text-dim);
  cursor: pointer;
  border-radius: 6px;
  line-height: 0;
}

.yanta-dash-info-dismiss:hover {
  background: var(--bg);
  color: var(--text);
}
`;

  document.head.append(style);
}

function isAndroidApp() {
  return !!window.yantaAndroidBridge?.isAndroidApp?.();
}

function formatDeviceNames(devices) {
  const names = devices.map((d) => d.name).filter(Boolean);

  if (!names.length) return t('infoPanel.yourAndroidDevice');
  if (names.length === 1) return `“${names[0]}”`;

  const quoted = names.map((n) => `“${n}”`);
  const last = quoted.pop();

  return `${quoted.join(', ')} ${t('infoPanel.deviceAnd')} ${last}`;
}

/**
 * The single most important install/notification recommendation for the
 * current device, as a dismissible info item. Returns [] when there is
 * nothing to suggest or the user dismissed it.
 */
function collectInstallItems() {
  /*
    Not on an empty workspace. "Install this app" as the first thing a
    newcomer reads asks for a commitment to something they have not used yet;
    the same hint after they have written something is an offer.
  */
  if (!workspaceHasContent()) return [];

  let rec;

  try {
    rec = computeInstallRecommendation();
  } catch {
    return [];
  }

  const primary = rec.primary;
  if (!primary) return [];

  const hintId = `install-${primary.id}`;
  if (dismissedInstallHints().has(hintId)) return [];

  return [{
    id: hintId,
    tone: 'info',
    icon: primary.icon || 'download',
    title: primary.title,
    text: primary.body,
    action: {
      label: primary.cta?.label || t('infoPanel.setUp'),
      onClick: () => openInstallModal(),
    },
    dismissible: hintId,
  }];
}

/**
 * Collect the items worth showing. Returns [] on a healthy setup —
 * the widget stays invisible then.
 */
function collectInfoItems() {
  const items = [];

  // Context-aware install nudge — quiet, dismissible, and only the single
  // most important recommendation so the panel never feels naggy. Kept
  // independent of the reminder report so it shows before the vault loads.
  items.push(...collectInstallItems());
  items.push(...collectPulseItems());

  let report;

  try {
    report = notificationSyncReport();
  } catch {
    return items;
  }

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
      title: t('infoPanel.pendingTitle', { count: n }),
      text: t('infoPanel.pendingText', { names: formatDeviceNames(stale.length ? stale : report.devices) }),
      details: t('infoPanel.pendingDetails'),
    });
  }

  if (report.pendingEvents.length && !report.hasNotificationDevices && !inApp) {
    const n = report.pendingEvents.length;

    items.push({
      id: 'notifications-no-device',
      tone: 'warn',
      icon: 'bell-off',
      title: t('infoPanel.noDeviceTitle', { count: n }),
      text: t('infoPanel.noDeviceText'),
      details: t('infoPanel.noDeviceDetails'),
    });
  }

  for (const device of report.permissionIssueDevices) {
    items.push({
      id: `notifications-permissions-${device.id}`,
      tone: 'warn',
      icon: 'bell-off',
      title: t('infoPanel.permsTitle', { name: device.name }),
      text: device.current
        ? t('infoPanel.permsTextCurrent')
        : t('infoPanel.permsTextOther', { name: device.name }),
      details: t('infoPanel.permsDetails'),
    });
  }

  return items;
}

function renderItems(body, onChange) {
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
          item.action
            ? `<button type="button" class="yanta-dash-info-action" data-info-action>${escapeHtml(item.action.label)}</button>`
            : ''
        }
        ${
          item.details
            ? `
              <button type="button" class="yanta-dash-info-fix" data-info-fix>${escapeHtml(t('infoPanel.howDoesThisWork'))}</button>
              <div class="yanta-dash-info-details" hidden>${escapeHtml(item.details)}</div>
            `
            : ''
        }
      </div>
      ${
        item.dismissible
          ? `<button type="button" class="yanta-dash-info-dismiss" data-info-dismiss title="${escapeHtml(t('infoPanel.dismiss'))}" aria-label="${escapeHtml(t('infoPanel.dismiss'))}">${lucide('x', 14)}</button>`
          : ''
      }
    `;

    const fixBtn = row.querySelector('[data-info-fix]');
    const details = row.querySelector('.yanta-dash-info-details');

    fixBtn?.addEventListener('click', () => {
      const show = details.hidden;
      details.hidden = !show;
      fixBtn.textContent = show ? t('infoPanel.hide') : t('infoPanel.howDoesThisWork');
    });

    row.querySelector('[data-info-action]')?.addEventListener('click', () => {
      try {
        item.action.onClick();
      } catch (err) {
        console.warn('[YANTA Dashboard Info] action failed', err);
      }
    });

    row.querySelector('[data-info-dismiss]')?.addEventListener('click', () => {
      dismissInstallHint(item.dismissible);
      // Re-render so the widget hides itself if this was the last item.
      onChange?.();
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
    <span class="yanta-dash-widget-title">${t('dashWidgets.titles.infoPanel')}</span>
  `;

  const body = el('div', { class: 'yanta-dash-info-body-host' });
  section.append(head, body);

  const refresh = () => {
    const count = renderItems(body, refresh);

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

  const onPulseChanged = () => {
    if (!alive()) {
      window.removeEventListener('yanta-pulse-routines-changed', onPulseChanged);
      window.removeEventListener('yanta-pulse-settings-changed', onPulseChanged);
      return;
    }

    refreshPulsePaused().then(refresh).catch(() => {});
  };

  window.addEventListener('yanta-pulse-routines-changed', onPulseChanged);
  window.addEventListener('yanta-pulse-settings-changed', onPulseChanged);

  refreshPulsePaused().then((changed) => {
    if (changed && alive()) refresh();
  }).catch(() => {});

  // Install availability / notification permission can change mid-session
  // (e.g. the browser offers a prompt, or the user installs) — reflect it.
  const stopInstallWatch = onInstallStateChange(() => {
    if (!alive()) {
      stopInstallWatch();
      return;
    }
    refresh();
  });

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
  titleKey: 'dashWidgets.titles.infoPanel',
  icon: 'info',
  order: 5,
  render: renderInfoPanel,
});
