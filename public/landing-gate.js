/*
  Landing gate.

  `/` serves both the landing page and the app. This script decides which
  one, before the boot loader paints, and picks the A/B variant.

  It lives in public/ rather than inline because the CSP pins script-src to
  'self' plus four fixed sha256 hashes for the existing inline blocks — a new
  inline script would need its hash added to vercel.json to run at all.

  The landing markup is static in index.html, so a crawler (and a visitor on a
  slow connection) gets real content without executing anything. All this file
  does is decide visibility and wire the CTAs.
*/
(() => {
  const VARIANT_KEY = 'yanta.landing.variant.v1';
  const SEEN_KEY = 'yanta.landing.seen.v1';
  const CONVERTED_KEY = 'yanta.landing.converted.v1';

  const readStore = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const writeStore = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };

  /*
    Anyone who has ever booted the app has yanta.* keys in localStorage
    (appearance, locale, settings). That is the returning-visitor signal —
    no extra marker needed, and it works for users who predate this file.

    The landing's own keys are excluded: they are written on the first visit
    and would otherwise make every second visit look like a returning user.
  */
  const hasAppState = () => {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = String(localStorage.key(i) || '');
        if (key.startsWith('yanta.') && !key.startsWith('yanta.landing.')) {
          return true;
        }
      }
    } catch {}
    return false;
  };

  const shouldShowLanding = () => {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/') return false;

    const params = new URLSearchParams(location.search);

    // Explicit app entry: the landing CTA, the manifest start_url, share target.
    if (params.has('app') || params.has('share-target')) return false;

    // Deep links carry their payload in the fragment (#chat-dm, #addLibrary,
    // share keys, slides-remote). Those are always app entries.
    if (location.hash && location.hash !== '#') return false;

    // Installed PWA / Android TWA never sees marketing.
    try {
      if (
        window.matchMedia?.('(display-mode: standalone)')?.matches ||
        window.matchMedia?.('(display-mode: minimal-ui)')?.matches ||
        window.navigator.standalone === true
      ) {
        return false;
      }
    } catch {}

    return !hasAppState();
  };

  const pickVariant = () => {
    const forced = new URLSearchParams(location.search).get('v');
    const normalize = (v) => {
      const s = String(v || '').toLowerCase();
      return s === 'a' || s === 'b' ? s : '';
    };

    const variant =
      normalize(forced) ||
      normalize(readStore(VARIANT_KEY)) ||
      (Math.random() < 0.5 ? 'a' : 'b');

    writeStore(VARIANT_KEY, variant);
    return variant;
  };

  if (!shouldShowLanding()) return;

  const variant = pickVariant();

  // Consumed by index.html's CSS (which panel is visible) and by main.js
  // (which skips the whole app boot).
  document.documentElement.dataset.yantaLanding = variant;
  window.__yantaLanding = variant;

  writeStore(SEEN_KEY, String(Number(readStore(SEEN_KEY) || 0) + 1));

  /*
    The CTA does a full navigation to /?app=1 instead of booting in place.
    One reload buys a clean funnel boundary — the app always starts from the
    same known state, and "reached the app" stays countable server-side once
    the funnel endpoint exists.
  */
  const enterApp = (source) => {
    writeStore(CONVERTED_KEY, JSON.stringify({
      variant,
      source,
      at: Date.now(),
    }));

    location.href = `/?app=1&v=${encodeURIComponent(variant)}`;
  };

  const wire = () => {
    const root = document.getElementById('yanta-landing');
    if (!root) return;

    root.querySelectorAll('[data-landing-cta]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        enterApp(btn.dataset.landingCta || 'unknown');
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
})();
