// ============================================================
// YANTA — Install manager
//
// One source of truth for "should we suggest installing something,
// and how do we do it here?". Wraps three moving parts:
//
//   1. The browser's captured `beforeinstallprompt` event (Chromium),
//      captured early in index.html into window.__yantaInstall so it
//      is never lost to module-load timing.
//   2. Web Notification permission state (desktop/PWA reliability).
//   3. Per-browser manual install instructions for engines without a
//      programmatic prompt (Firefox, Safari).
//
// computeInstallRecommendation() is consumed by both the Settings
// section and the dashboard hint, so the advice stays consistent.
// ============================================================

import { swRegistrationReady } from '../core.js';
import { t } from '../i18n/index.js';

import {
  installEnvironment,
} from './install-environment.js';

import {
  notificationCapableDevices,
} from '../notification-sync-status.js';

/*
  Where "get the mobile app" sends people. Own landing page by default
  (store options in the foreground, per product decision), overridable
  for self-hosters via VITE_GET_APP_URL.
*/
const APP_ORIGIN =
  (import.meta.env.VITE_APP_ORIGIN || (typeof location !== 'undefined' ? location.origin : 'https://yanta.page'))
    .replace(/\/+$/, '');

export function getAppUrl() {
  const configured = import.meta.env.VITE_GET_APP_URL;
  if (configured) return String(configured).replace(/\/+$/, '');
  return `${APP_ORIGIN}/get-app`;
}

/*
  Store / download targets used by the /get-app page. Play Store first,
  because sideloading is increasingly restricted. Package id matches
  android/app/build.gradle.kts and public/.well-known/assetlinks.json.
*/
export const ANDROID_PACKAGE_ID = 'page.yanta.app';

export function appStoreTargets() {
  return {
    play:
      import.meta.env.VITE_PLAY_STORE_URL ||
      `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_ID}`,
    apk: import.meta.env.VITE_ANDROID_APK_URL || '',
  };
}

// ---- beforeinstallprompt bridge -------------------------------------------

function installBucket() {
  if (typeof window === 'undefined') return null;
  return window.__yantaInstall || null;
}

/**
 * True when the browser has offered a programmatic install prompt we can
 * fire on a user gesture (Chromium desktop + Android).
 */
export function canInstallDirectly() {
  return !!installBucket()?.deferred;
}

/**
 * True once the app has been installed during this session (or is running
 * standalone). Lets the UI collapse the "install" call to action.
 */
export function isAppInstalled() {
  const env = installEnvironment();
  return env.standalone || env.androidApp || !!installBucket()?.installed;
}

/**
 * Fires the captured prompt. Must be called from a user gesture.
 * Resolves to 'accepted' | 'dismissed' | 'unavailable'.
 */
export async function promptInstall() {
  const bucket = installBucket();
  const evt = bucket?.deferred;
  if (!evt) return 'unavailable';

  try {
    evt.prompt();
    const choice = await evt.userChoice;

    // A prompt is single-use — drop it so the UI can fall back to a guide.
    bucket.deferred = null;
    dispatchStateChange();

    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch (err) {
    console.warn('[YANTA Install] prompt failed', err);
    return 'unavailable';
  }
}

function dispatchStateChange() {
  window.dispatchEvent(new CustomEvent('yanta-install-state-changed'));
}

/**
 * Subscribe to install-availability / installed changes. Returns an
 * unsubscribe function.
 */
export function onInstallStateChange(handler) {
  const events = [
    'yanta-install-state-changed',
    'yanta-install-availability-changed',
    'yanta-app-installed',
  ];

  events.forEach((name) => window.addEventListener(name, handler));

  return () => events.forEach((name) => window.removeEventListener(name, handler));
}

// ---- Web notifications ----------------------------------------------------

/**
 * Web Notification capability + current permission. Native Android
 * delivers notifications itself, so it reports as "not applicable".
 */
export function webNotificationState() {
  const env = installEnvironment();

  if (env.androidApp) {
    return { applicable: false, supported: false, permission: 'granted' };
  }

  const supported = typeof window !== 'undefined' && 'Notification' in window;

  return {
    applicable: true,
    supported,
    permission: supported ? Notification.permission : 'denied',
  };
}

/**
 * Requests Web Notification permission. Call only from a user gesture —
 * unsolicited prompts get auto-blocked and feel hostile.
 * Resolves to the resulting permission string.
 */
export async function requestWebNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';

  try {
    const result = await Notification.requestPermission();
    dispatchStateChange();
    return result;
  } catch (err) {
    console.warn('[YANTA Install] notification permission request failed', err);
    return 'denied';
  }
}

/**
 * Fires a real notification through the same path chat/reminders use
 * (Service Worker first, page-scoped Notification as fallback). This is
 * the fastest way to tell an OS/daemon problem apart from app logic:
 * if this shows nothing while permission is granted, the browser or
 * desktop notification server is the culprit, not YANTA.
 *
 * Resolves to { ok, via?, reason? }.
 */
export async function sendTestNotification() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (Notification.permission !== 'granted') {
    return { ok: false, reason: 'permission' };
  }

  const title = t('install.test.title');
  const options = {
    body: t('install.test.body'),
    icon: '/android-chrome-192x192.png',
    badge: '/android-chrome-192x192.png',
    tag: 'yanta-test',
    renotify: true,
  };

  // Try the Service Worker path first (same one chat uses), but never hang
  // on it — a never-activating SW would otherwise swallow the whole test.
  try {
    const reg = await swRegistrationReady();
    if (reg?.showNotification) {
      await reg.showNotification(title, options);
      return { ok: true, via: 'sw' };
    }
  } catch (err) {
    console.warn('[YANTA Install] SW test notification failed', err);
  }

  // Fallback: page-scoped Notification (works whenever bennish-style tests do).
  try {
    new Notification(title, options);
    return { ok: true, via: 'page' };
  } catch (err) {
    console.warn('[YANTA Install] page test notification failed', err);
    return { ok: false, reason: 'error' };
  }
}

/**
 * OS-specific tips for "I allowed notifications but see nothing", which on
 * Linux especially is almost always a desktop-side setting, not the app.
 */
export function notificationTroubleshooting(os) {
  const common = t('install.trouble.common');

  switch (os) {
    case 'linux':
      return [
        t('install.trouble.linuxDaemon'),
        t('install.trouble.linuxChromium'),
        common,
      ];
    case 'windows':
      return [
        t('install.trouble.windowsSettings'),
        t('install.trouble.windowsFocus'),
        common,
      ];
    case 'macos':
      return [
        t('install.trouble.macosSettings'),
        t('install.trouble.macosFocus'),
        common,
      ];
    default:
      return [
        t('install.trouble.generic'),
        common,
      ];
  }
}

// ---- Synced notification-capable phones -----------------------------------

/**
 * True when at least one synced device is a YANTA Android app that can
 * deliver reminders — i.e. the user already has "a phone set up".
 */
export function hasNotificationPhone() {
  try {
    return notificationCapableDevices().some((d) => !d.current || d.notificationsGranted);
  } catch {
    return false;
  }
}

// ---- Manual install guides ------------------------------------------------

/**
 * Step-by-step manual install instructions for the current browser/OS,
 * used when there is no programmatic prompt. Returns:
 *   { supported, title, steps: string[], note?: string }
 * `supported: false` means this browser can't install a PWA at all.
 */
export function browserInstallGuide(env = installEnvironment()) {
  const { browser, os } = env;

  if (os === 'ios') {
    return {
      supported: true,
      title: t('install.guide.ios.title'),
      steps: [
        t('install.guide.ios.step1'),
        t('install.guide.ios.step2'),
        t('install.guide.ios.step3'),
      ],
      note: t('install.guide.ios.note'),
    };
  }

  switch (browser.id) {
    case 'edge':
      return {
        supported: true,
        title: t('install.guide.edge.title'),
        steps: [
          t('install.guide.edge.step1'),
          t('install.guide.edge.step2'),
          t('install.guide.confirmInstall'),
        ],
      };

    case 'samsung':
      return {
        supported: true,
        title: t('install.guide.samsung.title'),
        steps: [
          t('install.guide.samsung.step1'),
          t('install.guide.samsung.step2'),
          t('install.guide.samsung.step3'),
        ],
      };

    case 'firefox':
      return os === 'android'
        ? {
            supported: true,
            title: t('install.guide.firefox.title'),
            steps: [
              t('install.guide.firefox.step1'),
              t('install.guide.firefox.step2'),
              t('install.guide.confirmPrompt'),
            ],
          }
        : {
            supported: false,
            title: t('install.guide.firefoxDesktop.title'),
            steps: [
              t('install.guide.firefoxDesktop.step1'),
              t('install.guide.firefoxDesktop.step2'),
            ],
          };

    case 'safari':
      return {
        supported: true,
        title: t('install.guide.safari.title'),
        steps: [
          t('install.guide.safari.step1'),
          t('install.guide.safari.step2'),
          t('install.guide.safari.step3'),
        ],
        note: t('install.guide.safari.note'),
      };

    case 'opera':
      return {
        supported: true,
        title: t('install.guide.opera.title'),
        steps: [
          t('install.guide.opera.step1'),
          t('install.guide.confirmInstall'),
        ],
      };

    case 'chrome':
      return {
        supported: true,
        title: t('install.title'),
        steps: [
          t('install.guide.chrome.step1'),
          t('install.guide.chrome.step2'),
          t('install.guide.confirmInstall'),
        ],
      };

    default:
      return {
        supported: true,
        title: t('install.title'),
        steps: [
          t('install.guide.generic.step1'),
          t('install.guide.generic.step2'),
          t('install.guide.confirmPrompt'),
        ],
      };
  }
}

// ---- Recommendation -------------------------------------------------------

/*
  CTA kinds the UI knows how to wire:
  - 'prompt-install'      fire promptInstall(); fall back to the guide
  - 'show-guide'          reveal the manual install steps
  - 'open-get-app'        navigate to the /get-app landing page
  - 'enable-notifications' request Web Notification permission
*/

function recEnableNotifications() {
  return {
    id: 'enable-notifications',
    kind: 'enable-notifications',
    tone: 'info',
    icon: 'bell',
    title: t('install.rec.notifications.title'),
    body: t('install.rec.notifications.body'),
    cta: { label: t('install.cta.enableNotifications'), kind: 'enable-notifications' },
  };
}

function recAddPhone() {
  return {
    id: 'add-phone',
    kind: 'add-phone',
    tone: 'info',
    icon: 'smartphone',
    title: t('install.rec.phone.title'),
    body: t('install.rec.phone.body'),
    cta: { label: t('install.cta.getMobileApp'), kind: 'open-get-app', url: getAppUrl() },
  };
}

/**
 * The context-aware advice for the current environment. Shape:
 *   {
 *     context, perfect,
 *     notifications: { applicable, supported, permission },
 *     hasPhone,
 *     primary:   Recommendation | null,
 *     secondary: Recommendation | null,
 *   }
 *
 * A Recommendation is a plain, render-agnostic object (see rec* helpers).
 */
export function computeInstallRecommendation() {
  const env = installEnvironment();
  const notifications = webNotificationState();
  const hasPhone = hasNotificationPhone();

  const base = {
    context: env.context,
    env,
    notifications,
    hasPhone,
    perfect: false,
    primary: null,
    secondary: null,
  };

  const notificationsGranted =
    !notifications.applicable || notifications.permission === 'granted';

  switch (env.context) {
    case 'android-app':
      // Native app: notifications and exact alarms are handled natively.
      return { ...base, perfect: true };

    case 'android-browser':
      return {
        ...base,
        primary: {
          id: 'get-android-app',
          kind: 'get-android-app',
          tone: 'info',
          icon: 'download',
          title: t('install.rec.android.title'),
          body: t('install.rec.android.body'),
          cta: { label: t('install.cta.getApp'), kind: 'open-get-app', url: getAppUrl() },
        },
      };

    case 'desktop-browser':
      return {
        ...base,
        primary: {
          id: 'install-desktop-pwa',
          kind: 'install-desktop-pwa',
          tone: 'info',
          icon: 'monitor-down',
          title: t('install.rec.desktop.title'),
          body: t('install.rec.desktop.body'),
          cta: canInstallDirectly()
            ? { label: t('install.cta.installApp'), kind: 'prompt-install' }
            : { label: t('install.cta.howToInstall'), kind: 'show-guide' },
        },
        secondary: hasPhone ? null : recAddPhone(),
      };

    case 'desktop-pwa': {
      const primary = notificationsGranted ? null : recEnableNotifications();
      const secondary = hasPhone ? null : recAddPhone();
      return {
        ...base,
        primary,
        secondary,
        perfect: !primary && !secondary,
      };
    }

    case 'ios-browser':
      return {
        ...base,
        primary: {
          id: 'ios-add-home',
          kind: 'ios-add-home',
          tone: 'info',
          icon: 'smartphone',
          title: t('install.guide.ios.title'),
          body: t('install.rec.ios.body'),
          cta: { label: t('install.cta.showMeHow'), kind: 'show-guide' },
        },
      };

    case 'ios-pwa':
      return {
        ...base,
        primary: notificationsGranted ? null : recEnableNotifications(),
        perfect: notificationsGranted,
      };

    default:
      // Unknown surface: only nudge if a direct install is on offer.
      return canInstallDirectly()
        ? {
            ...base,
            primary: {
              id: 'install-generic',
              kind: 'install-generic',
              tone: 'info',
              icon: 'download',
              title: t('install.title'),
              body: t('install.rec.generic.body'),
              cta: { label: t('install.cta.installApp'), kind: 'prompt-install' },
            },
          }
        : { ...base, perfect: true };
  }
}
