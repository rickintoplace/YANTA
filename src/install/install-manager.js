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
      title: 'Add YANTA to your Home Screen',
      steps: [
        'Open YANTA in Safari.',
        'Tap the Share button (the square with an up arrow).',
        'Choose “Add to Home Screen”, then tap “Add”.',
      ],
      note: 'Open YANTA from the new Home Screen icon to receive notifications.',
    };
  }

  switch (browser.id) {
    case 'edge':
      return {
        supported: true,
        title: 'Install YANTA in Microsoft Edge',
        steps: [
          'Open the “…” menu at the top right.',
          'Choose “Apps” → “Install YANTA”.',
          'Confirm with “Install”.',
        ],
      };

    case 'samsung':
      return {
        supported: true,
        title: 'Install YANTA in Samsung Internet',
        steps: [
          'Tap the menu (≡) at the bottom right.',
          'Choose “Add page to” → “Home screen”.',
          'Confirm with “Add”.',
        ],
      };

    case 'firefox':
      return os === 'android'
        ? {
            supported: true,
            title: 'Install YANTA in Firefox',
            steps: [
              'Tap the menu (⋮) at the top right.',
              'Choose “Install” (or “Add to Home screen”).',
              'Confirm the prompt.',
            ],
          }
        : {
            supported: false,
            title: 'Firefox on the desktop can’t install web apps',
            steps: [
              'For reliable system notifications, open YANTA in Chrome, Edge, or Brave and install it there.',
              'Or install YANTA on your phone — it works everywhere.',
            ],
          };

    case 'safari':
      return {
        supported: true,
        title: 'Install YANTA in Safari',
        steps: [
          'Open the Share menu (or the File menu).',
          'Choose “Add to Dock”.',
          'Open YANTA from the Dock from now on.',
        ],
        note: 'Requires macOS Sonoma or newer.',
      };

    case 'opera':
      return {
        supported: true,
        title: 'Install YANTA in Opera',
        steps: [
          'Open the menu and look for “Install YANTA…”.',
          'Confirm with “Install”.',
        ],
      };

    case 'chrome':
      return {
        supported: true,
        title: 'Install YANTA',
        steps: [
          'Click the install icon at the right end of the address bar (a monitor with a down arrow).',
          'If it isn’t there, open the “⋮” menu → “Cast, save, and share” → “Install page as app…”.',
          'Confirm with “Install”.',
        ],
      };

    default:
      return {
        supported: true,
        title: 'Install YANTA',
        steps: [
          'Open your browser’s main menu.',
          'Look for “Install app”, “Install YANTA”, or “Add to Home screen”.',
          'Confirm the prompt.',
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
    title: 'Turn on notifications',
    body: 'Allow notifications so chat messages and event reminders arrive as system notifications.',
    cta: { label: 'Enable notifications', kind: 'enable-notifications' },
  };
}

function recAddPhone() {
  return {
    id: 'add-phone',
    kind: 'add-phone',
    tone: 'info',
    icon: 'smartphone',
    title: 'Install YANTA on your phone',
    body: 'Add the app on a smartphone so reminders and messages reach you when you’re away from your computer.',
    cta: { label: 'Get the mobile app', kind: 'open-get-app', url: getAppUrl() },
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
          title: 'Install the YANTA Android app',
          body: 'The Android app delivers event reminders and chat messages as reliable, exactly-timed system notifications — the browser can’t guarantee that.',
          cta: { label: 'Get the app', kind: 'open-get-app', url: getAppUrl() },
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
          title: 'Install YANTA as a desktop app',
          body: 'Installing YANTA lets it show system notifications for chat and reminders, even when no tab is open.',
          cta: canInstallDirectly()
            ? { label: 'Install app', kind: 'prompt-install' }
            : { label: 'How to install', kind: 'show-guide' },
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
          title: 'Add YANTA to your Home Screen',
          body: 'Installed to the Home Screen, YANTA can send you notifications for chat and reminders.',
          cta: { label: 'Show me how', kind: 'show-guide' },
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
              title: 'Install YANTA',
              body: 'Install YANTA for a faster launch and reliable system notifications.',
              cta: { label: 'Install app', kind: 'prompt-install' },
            },
          }
        : { ...base, perfect: true };
  }
}
