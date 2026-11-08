// ============================================================
// YANTA — Notifications settings section
//
// One clear place to answer "what notifies me, and where?":
//   1. This device — permission + a test, plus per-category switches
//      (chat, calendar) that decide what THIS device shows.
//   2. Your devices — a read-only overview of every connected device and
//      what it delivers (this browser/PWA + synced Android phones).
//
// Self-updating: permission changes, preference toggles, and device acks
// arriving over sync all re-render it live.
// ============================================================

import {
  el,
  lucide,
  escapeHtml,
  toast,
} from '../core.js';
import { t } from '../i18n/index.js';

import {
  installEnvironment,
} from './install-environment.js';

import {
  webNotificationState,
  requestWebNotificationPermission,
  sendTestNotification,
  notificationTroubleshooting,
  onInstallStateChange,
} from './install-manager.js';

import {
  notificationCapableDevices,
  observeNotificationSyncStatus,
} from '../notification-sync-status.js';

import {
  chatNotificationsEnabled,
  calendarNotificationsEnabled,
  setChatNotificationsEnabled,
  setCalendarNotificationsEnabled,
  onNotificationPrefsChange,
} from '../notification-preferences.js';

import {
  isPushSupported,
  isPushActive,
  subscribeWebPush,
  unsubscribeWebPush,
  refreshPushActiveState,
  onPushStateChange,
  sendBackgroundTest,
} from '../push/web-push-client.js';

function injectCss() {
  if (document.getElementById('yanta-notif-settings-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-notif-settings-css';
  style.textContent = `
.yanta-notif { display: flex; flex-direction: column; gap: 20px; }

.yanta-notif-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev);
}

.yanta-notif-perm {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
}
.yanta-notif-perm.warn { color: var(--text); }
.yanta-notif-perm > svg { flex: 0 0 auto; color: var(--accent); }
.yanta-notif-perm.warn > svg { color: var(--yellow, #eab308); }
.yanta-notif-perm > span { flex: 1; }

.yanta-notif-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.yanta-notif-toggles { display: flex; flex-direction: column; gap: 4px; }

.yanta-notif-note { margin: 0; font-size: 12px; color: var(--text-dim); line-height: 1.5; }

.yanta-notif-section-title {
  font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: var(--text-dim); margin: 4px 0 2px;
}

.yanta-notif-device {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev);
}
.yanta-notif-device + .yanta-notif-device { margin-top: 8px; }
.yanta-notif-device > svg { flex: 0 0 auto; margin-top: 1px; color: var(--accent); }

.yanta-notif-device-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.yanta-notif-device-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.yanta-notif-device-head strong { font-size: 13.5px; color: var(--text); }
.yanta-notif-badge {
  font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
  padding: 2px 7px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.yanta-notif-badge.muted { background: var(--bg); color: var(--text-dim); }
.yanta-notif-badge.warn { background: color-mix(in srgb, var(--yellow, #eab308) 20%, transparent); color: var(--yellow, #b8860b); }

.yanta-notif-device-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.yanta-notif-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: var(--text-dim);
  padding: 3px 8px; border-radius: 8px; background: var(--bg);
}
.yanta-notif-chip.on { color: var(--text); }
.yanta-notif-chip.off { opacity: .55; text-decoration: line-through; }
.yanta-notif-chip > svg { flex: 0 0 auto; }

.yanta-notif-troubleshoot { margin: 0; padding: 10px 12px 10px 28px; border-radius: 10px; border: 1px dashed var(--border); background: var(--bg); color: var(--text-dim); font-size: 12px; line-height: 1.6; }
.yanta-notif-troubleshoot[hidden] { display: none; }
`;

  document.head.append(style);
}

function toggleRow({ checked, disabled, label, hint, onChange }) {
  const row = el('label', { class: 'yanta-settings-toggle' });

  const cb = el('input', { type: 'checkbox' });
  cb.checked = !!checked;
  cb.disabled = !!disabled;
  cb.addEventListener('change', () => onChange?.(cb.checked));

  row.append(
    cb,
    el('div', { class: 'yanta-settings-toggle-meta' },
      el('div', { class: 'yanta-settings-toggle-label' }, label),
      el('div', { class: 'yanta-settings-toggle-hint' }, hint)),
  );

  return row;
}

function chip(iconName, label, on) {
  const c = el('span', { class: `yanta-notif-chip ${on ? 'on' : 'off'}` });
  c.innerHTML = `${lucide(iconName, 12)} <span>${label}</span>`;
  return c;
}

function currentDeviceRow(env, notifications) {
  const kind = env.androidApp
    ? t('install.notifications.kind.androidApp')
    : env.standalone ? t('install.notifications.kind.installedApp') : t('install.notifications.kind.browser');
  const name = t('install.notifications.thisDevice', { browser: env.browser.name, os: osLabel(env.os) });

  const granted = !notifications.applicable || notifications.permission === 'granted';

  const row = el('div', { class: 'yanta-notif-device' });
  row.append(iconEl(env.mobile ? 'smartphone' : 'monitor', 18));

  const body = el('div', { class: 'yanta-notif-device-body' });

  const head = el('div', { class: 'yanta-notif-device-head' });
  head.append(el('strong', {}, name));
  head.append(badge(kind, 'muted'));
  head.append(granted ? badge(t('install.notifications.badge.on')) : badge(t('install.notifications.badge.off'), 'warn'));
  if (!env.androidApp && isPushActive()) head.append(badge(t('install.notifications.badge.background')));

  const chips = el('div', { class: 'yanta-notif-device-chips' });
  chips.append(chip('message-circle', t('install.notifications.chip.chat'), granted && chatNotificationsEnabled()));
  if (env.androidApp) {
    chips.append(chip('calendar-clock', t('install.notifications.chip.reminders'), true));
  } else {
    chips.append(chip('calendar-clock', t('install.notifications.chip.remindersWhileOpen'), granted && calendarNotificationsEnabled()));
  }

  body.append(head, chips);
  row.append(body);
  return row;
}

function androidDeviceRow(device) {
  const canNotify = device.notificationsGranted && device.exactAlarmAllowed;

  const row = el('div', { class: 'yanta-notif-device' });
  row.append(iconEl('smartphone', 18));

  const body = el('div', { class: 'yanta-notif-device-body' });

  const head = el('div', { class: 'yanta-notif-device-head' });
  head.append(el('strong', {}, device.name || t('install.notifications.androidDevice')));
  head.append(badge(t('install.notifications.kind.androidApp'), 'muted'));
  head.append(canNotify ? badge(t('install.notifications.badge.on')) : badge(t('install.notifications.badge.needsPermission'), 'warn'));

  const chips = el('div', { class: 'yanta-notif-device-chips' });
  chips.append(chip('message-circle', t('install.notifications.chip.chat'), canNotify));
  chips.append(chip('calendar-clock', t('install.notifications.chip.reminders'), canNotify));

  body.append(head, chips);

  if (!canNotify) {
    body.append(el('p', { class: 'yanta-notif-note' },
      t('install.notifications.phoneNeedsPermission')));
  }

  row.append(body);
  return row;
}

function badge(text, variant = '') {
  return el('span', { class: `yanta-notif-badge ${variant}` }, text);
}

function iconEl(name, size = 18) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = lucide(name, size);
  return span.firstElementChild || span;
}

function osLabel(os) {
  return {
    windows: 'Windows', macos: 'macOS', linux: 'Linux',
    android: 'Android', ios: 'iOS', chromeos: 'ChromeOS',
  }[os] || t('install.notifications.thisDeviceOs');
}

/**
 * The dedicated Notifications settings element. Self-updating.
 */
export function notificationsSettingsElement() {
  injectCss();

  const root = el('div', { class: 'yanta-notif' });

  const render = () => {
    const env = installEnvironment();
    const notifications = webNotificationState();
    root.replaceChildren();

    // ---- This device ----
    const card = el('div', { class: 'yanta-notif-card' });

    if (notifications.applicable) {
      const granted = notifications.permission === 'granted';
      const blocked = notifications.permission === 'denied';

      const perm = el('div', { class: `yanta-notif-perm ${granted ? '' : 'warn'}` });
      perm.append(iconEl(granted ? 'bell-ring' : 'bell-off', 18));
      perm.append(el('span', {},
        !notifications.supported
          ? t('install.notifications.perm.unsupported')
          : granted ? t('install.status.enabled')
            : blocked ? t('install.status.blocked')
              : t('install.notifications.perm.notYet')));
      card.append(perm);

      const actions = el('div', { class: 'yanta-notif-actions' });

      if (notifications.supported && !granted && !blocked) {
        const enableBtn = el('button', { class: 'btn primary', type: 'button' });
        enableBtn.innerHTML = `${lucide('bell', 14)} ${escapeHtml(t('install.cta.enableNotifications'))}`;
        enableBtn.addEventListener('click', async () => {
          const result = await requestWebNotificationPermission();
          if (result === 'granted') toast(t('install.toast.enabled'), 'success');
          else if (result === 'denied') toast(t('install.toast.blocked'), 'error');
        });
        actions.append(enableBtn);
      }

      const troubleshoot = el('ul', { class: 'yanta-notif-troubleshoot', hidden: true });
      for (const tip of notificationTroubleshooting(env.os)) {
        troubleshoot.append(el('li', {}, tip));
      }

      if (granted) {
        const testBtn = el('button', { class: 'btn', type: 'button' });
        testBtn.innerHTML = `${lucide('send', 14)} ${escapeHtml(t('install.notifications.test.button'))}`;
        testBtn.addEventListener('click', async () => {
          const result = await sendTestNotification();
          if (result.ok) toast(t('install.notifications.test.sent', { via: result.via }), 'success');
          else if (result.reason === 'permission') toast(t('install.notifications.test.allowFirst'), 'error');
          else { toast(t('install.notifications.test.failed'), 'error'); troubleshoot.hidden = false; }
        });
        actions.append(testBtn);

        const troubleBtn = el('button', { class: 'btn', type: 'button' }, t('install.notifications.test.notSeeing'));
        troubleBtn.addEventListener('click', () => { troubleshoot.hidden = !troubleshoot.hidden; });
        actions.append(troubleBtn);
      }

      if (actions.childElementCount) card.append(actions);

      // ---- What this device shows ----
      const disabled = !granted;
      const toggles = el('div', { class: 'yanta-notif-toggles' });
      toggles.append(toggleRow({
        checked: chatNotificationsEnabled(),
        disabled,
        label: t('install.notifications.toggle.chat'),
        hint: t('install.notifications.toggle.chatHint'),
        onChange: (v) => setChatNotificationsEnabled(v),
      }));
      toggles.append(toggleRow({
        checked: calendarNotificationsEnabled(),
        disabled: disabled || env.androidApp,
        label: t('install.notifications.toggle.calendar'),
        hint: env.androidApp
          ? t('install.notifications.toggle.calendarNative')
          : t('install.notifications.toggle.calendarHint'),
        onChange: (v) => setCalendarNotificationsEnabled(v),
      }));
      card.append(toggles);

      card.append(troubleshoot);

      // ---- Background delivery (Web Push) ----
      if (!env.androidApp && isPushSupported()) {
        const bg = toggleRow({
          checked: isPushActive(),
          disabled,
          label: t('install.notifications.bg.label'),
          hint: t('install.notifications.bg.hint'),
          onChange: async (wantOn) => {
            try {
              if (wantOn) await subscribeWebPush();
              else await unsubscribeWebPush();
            } catch (err) {
              if (err?.status === 401) {
                toast(t('install.notifications.bg.signIn'), 'error');
              } else {
                toast(err?.message || t('install.notifications.bg.failed'), 'error');
              }
              render(); // revert the toggle to the real state
            }
          },
        });
        card.append(bg);

        if (isPushActive()) {
          const testActions = el('div', { class: 'yanta-notif-actions' });
          const testBtn = el('button', { class: 'btn', type: 'button' });
          testBtn.innerHTML = `${lucide('send', 13)} ${escapeHtml(t('install.notifications.bg.test'))}`;
          testBtn.addEventListener('click', async () => {
            try {
              const res = await sendBackgroundTest();
              if (!res?.count) {
                toast(t('install.notifications.bg.noSubscription'), 'error');
              } else {
                const ok = (res.results || []).some((r) => r.ok);
                const detail = (res.results || [])
                  .map((r) => (r.ok ? `ok ${r.status || ''}`.trim() : (r.reason || `status ${r.status}`)))
                  .join(', ');
                toast(t('install.notifications.bg.testResult', { count: res.count, detail }), ok ? 'success' : 'error');
              }
            } catch (err) {
              toast(err?.status === 401 ? t('install.notifications.bg.signInFirst') : (err?.message || t('install.notifications.bg.testFailed')), 'error');
            }
          });
          testActions.append(testBtn);
          card.append(testActions);
        }
      }

      if (!env.androidApp) {
        card.append(el('p', { class: 'yanta-notif-note' },
          isPushActive()
            ? t('install.notifications.bg.on')
            : t('install.notifications.bg.off')));
      }
    } else {
      card.append(el('p', { class: 'yanta-notif-note' },
        t('install.notifications.native')));
    }

    root.append(card);

    // ---- Your devices ----
    let androidDevices = [];
    try {
      androidDevices = notificationCapableDevices().filter((d) => !d.current);
    } catch {}

    root.append(el('div', { class: 'yanta-notif-section-title' }, t('install.notifications.yourDevices')));

    const list = el('div', {});
    list.append(currentDeviceRow(env, notifications));
    for (const device of androidDevices) {
      list.append(androidDeviceRow(device));
    }
    root.append(list);
  };

  render();

  const alive = () => root.isConnected;

  const stopInstall = onInstallStateChange(() => { if (alive()) render(); else stopInstall(); });
  const stopPrefs = onNotificationPrefsChange(() => { if (alive()) render(); else stopPrefs(); });
  const stopPush = onPushStateChange(() => { if (alive()) render(); else stopPush(); });
  observeNotificationSyncStatus(() => { if (alive()) render(); }, alive);

  // Reconcile the toggle with the real subscription state on open.
  refreshPushActiveState().catch(() => {});

  return root;
}
