// ============================================================
// YANTA Present — small device helpers shared by every role
// ============================================================

import { t } from '../i18n/index.js';
import { randomId } from './present-crypto.js';

/** A name a person recognizes in the device list ("iPhone", "Windows PC"). */
export function deviceName() {
  const ua = navigator.userAgent || '';

  if (/SmartTV|SMART-TV|Tizen|Web0S|webOS|BRAVIA|AFT[A-Z]|GoogleTV|Android TV/i.test(ua)) return t('present.device.tv');
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? t('present.device.androidPhone') : t('present.device.androidTablet');
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return t('present.device.windows');
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return t('present.device.linux');

  return t('present.device.generic');
}

export function isHandheld() {
  try {
    return !!window.matchMedia?.('(pointer: coarse)')?.matches && Math.min(screen.width, screen.height) < 820;
  } catch {
    return false;
  }
}

/** One id per browser tab, stable across reloads of that tab. */
export function tabDeviceId() {
  try {
    let id = sessionStorage.getItem('yanta.present.device');

    if (!id) {
      id = randomId();
      sessionStorage.setItem('yanta.present.device', id);
    }

    return id;
  } catch {
    return randomId();
  }
}

/*
  Keeps the screen on while a device presents, shows or controls slides —
  a remote whose phone locks itself mid-talk is a remote that failed.
  Browsers drop the lock when the page is hidden, so it is taken again
  whenever the page comes back.
*/
export function holdScreenAwake() {
  let lock = null;
  let released = false;

  const acquire = async () => {
    if (released || document.visibilityState !== 'visible' || !navigator.wakeLock) return;

    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {}
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') acquire();
  };

  document.addEventListener('visibilitychange', onVisible);
  acquire();

  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);

    try {
      lock?.release?.();
    } catch {}

    lock = null;
  };
}
