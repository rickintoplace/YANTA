// ============================================================
// YANTA — Install environment detection
//
// Pure, side-effect-free helpers that answer "where is YANTA
// running right now?". Everything downstream (recommendations,
// settings UI, dashboard hint) is derived from installContext().
//
// No imports from feature modules — this must stay a leaf so any
// surface can ask about the environment without pulling in the app.
// ============================================================

/*
  navigator.userAgentData is the modern, spoof-resistant source and
  avoids UA-string parsing where available (Chromium). Everything here
  falls back to the UA string so Firefox/Safari still get answers.
*/
function uaData() {
  return typeof navigator !== 'undefined' ? navigator.userAgentData : undefined;
}

function ua() {
  return typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
}

/**
 * True when running inside the native YANTA Android app (WebView with
 * the injected bridge). The bridge sets window.YantaAndroid.
 */
export function isAndroidApp() {
  return typeof window !== 'undefined' && !!window.YantaAndroid;
}

/**
 * Installed-PWA / standalone display mode (Chromium, Safari iOS, etc.).
 */
export function isStandalonePwa() {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches ||
    window.matchMedia?.('(display-mode: minimal-ui)')?.matches ||
    window.navigator.standalone === true
  );
}

/**
 * Operating system family: 'android' | 'ios' | 'windows' | 'macos'
 * | 'linux' | 'chromeos' | 'other'.
 */
export function detectOs() {
  const data = uaData();
  const platform = String(data?.platform || '').toLowerCase();
  const s = ua();

  if (platform) {
    if (platform.includes('android')) return 'android';
    if (platform.includes('windows')) return 'windows';
    if (platform.includes('macos') || platform.includes('mac os')) return 'macos';
    if (platform.includes('chrome os') || platform.includes('chromeos')) return 'chromeos';
    if (platform.includes('linux')) {
      // Android reports "Linux" as platform on some engines — the UA
      // string is the reliable tie-breaker.
      return /android/i.test(s) ? 'android' : 'linux';
    }
  }

  if (/android/i.test(s)) return 'android';

  // iPadOS 13+ masquerades as macOS Safari; touch points give it away.
  const iOSLike =
    /ip(hone|od|ad)/i.test(s) ||
    (/macintosh/i.test(s) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  if (iOSLike) return 'ios';

  if (/windows/i.test(s)) return 'windows';
  if (/cros/i.test(s)) return 'chromeos';
  if (/mac os x|macintosh/i.test(s)) return 'macos';
  if (/linux/i.test(s)) return 'linux';

  return 'other';
}

/**
 * Whether this is a phone/tablet form factor.
 */
export function isMobile() {
  const data = uaData();
  if (typeof data?.mobile === 'boolean') return data.mobile;

  const os = detectOs();
  if (os === 'android' || os === 'ios') return true;

  return /mobi|tablet/i.test(ua());
}

/**
 * Browser engine/brand, used to pick manual install instructions.
 * Returns { id, name }. Chromium forks that support beforeinstallprompt
 * (Brave, Arc, Vivaldi) resolve to 'chrome' on purpose — the direct
 * install prompt covers them and the Chrome guide is a safe fallback.
 */
export function detectBrowser() {
  const s = ua();

  // Order matters: several brands embed "Chrome"/"Safari" in their UA.
  if (/EdgA?\//.test(s)) return { id: 'edge', name: 'Edge' };
  if (/SamsungBrowser\//.test(s)) return { id: 'samsung', name: 'Samsung Internet' };
  if (/OPR\/|Opera\//.test(s)) return { id: 'opera', name: 'Opera' };
  if (/Firefox\/|FxiOS\//.test(s)) return { id: 'firefox', name: 'Firefox' };

  const isChromium =
    (uaData()?.brands || []).some((b) => /Chromium|Google Chrome/i.test(b.brand)) ||
    /Chrome\/|CriOS\//.test(s);

  if (isChromium) return { id: 'chrome', name: 'Chrome' };
  if (/Safari\//.test(s)) return { id: 'safari', name: 'Safari' };

  return { id: 'other', name: 'your browser' };
}

/**
 * The one value the rest of the feature branches on:
 *
 * - 'android-app'     native YANTA Android app — perfect setup
 * - 'android-browser' Android web/PWA — recommend the Android app
 * - 'desktop-pwa'     installed PWA on a computer — near-perfect
 * - 'desktop-browser' browser tab on a computer — recommend installing
 * - 'ios-browser'     iPhone/iPad browser — recommend Add to Home Screen
 * - 'ios-pwa'         installed iPhone/iPad PWA — near-perfect
 * - 'other'           anything we don't tailor advice for
 */
export function installContext() {
  if (isAndroidApp()) return 'android-app';

  const os = detectOs();
  const mobile = isMobile();

  if (os === 'android') return 'android-browser';
  if (os === 'ios') return isStandalonePwa() ? 'ios-pwa' : 'ios-browser';

  if (!mobile) {
    return isStandalonePwa() ? 'desktop-pwa' : 'desktop-browser';
  }

  return 'other';
}

/**
 * Snapshot of everything the recommendation logic and UI need, computed
 * once per call so consumers don't re-run detection piecemeal.
 */
export function installEnvironment() {
  return {
    context: installContext(),
    os: detectOs(),
    browser: detectBrowser(),
    mobile: isMobile(),
    standalone: isStandalonePwa(),
    androidApp: isAndroidApp(),
  };
}
