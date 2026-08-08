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
  /*
    This script writes NOTHING to the device. That is deliberate and worth
    protecting.

    § 25 TDDDG hangs the consent duty on storing or reading information on the
    terminal equipment, not on processing personal data. A remembered A/B
    bucket is stored for the operator's benefit, not to deliver the service the
    visitor asked for — exactly the constellation that needs a banner. So the
    variant is drawn per page view instead of remembered.

    The measurement survives that: view and click are both tagged with the
    variant actually shown on that view, so the per-variant conversion rate
    stays unbiased. The only cost is that a returning visitor may see the other
    headline — cheap for a page most people open once, and it buys an
    unqualified "we store nothing you did not ask for".
  */

  /*
    Anyone who has ever booted the app has yanta.* keys in localStorage
    (appearance, locale, settings). That is the returning-visitor signal —
    no extra marker needed, and it works for users who predate this file.

    This is a READ, and reads of terminal equipment are covered by § 25 too —
    but this one decides whether the visitor is served the app they already
    use or a page describing it, which is part of delivering the requested
    service. It also only ever looks at storage the app itself needs.
  */
  const hasAppState = () => {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        if (String(localStorage.key(i) || '').startsWith('yanta.')) return true;
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

    // Installed PWA / Android TWA never sees the landing page.
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

  // Per page view, never remembered. `?v=a|b` forces one for testing.
  const pickVariant = () => {
    const forced = String(
      new URLSearchParams(location.search).get('v') || ''
    ).toLowerCase();

    if (forced === 'a' || forced === 'b') return forced;

    return Math.random() < 0.5 ? 'a' : 'b';
  };

  if (!shouldShowLanding()) return;

  const variant = pickVariant();

  // Consumed by index.html's CSS (which panel is visible) and by main.js
  // (which skips the whole app boot).
  document.documentElement.dataset.yantaLanding = variant;
  window.__yantaLanding = variant;

  /*
    Funnel beacon.

    Sends two numbers and nothing else: which event, which variant, and the
    HOSTNAME of the referrer. No id, no session, no cookie, no timestamp beyond
    the day the server tallies it under — the server stores a counter, not an
    event. That is why this needs no consent banner and no opt-out: there is
    nothing here that could be traced back to a visitor.

    sendBeacon so a click never waits on the network, with a keepalive fetch as
    the fallback for browsers without it.
  */
  const referrerHost = () => {
    try {
      const ref = String(document.referrer || '');
      if (!ref) return 'direct';

      const host = new URL(ref).hostname;
      if (!host || host === location.hostname) return 'direct';

      return host;
    } catch {
      return 'direct';
    }
  };

  const countEvent = (name) => {
    const payload = JSON.stringify({ name, variant, source: referrerHost() });
    const url = '/cloud-api/api/metrics/event';

    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon?.(url, blob)) return;
    } catch {}

    try {
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive: true,
        credentials: 'omit',
      }).catch(() => {});
    } catch {}
  };

  /*
    A full navigation to /?app=1 rather than booting in place: one reload buys
    a clean funnel boundary, so the app always starts from the same state and
    "reached the app" stays countable server-side.
  */
  const enterApp = () => {
    countEvent('landing_cta');

    location.href = `/?app=1&v=${encodeURIComponent(variant)}`;
  };

  countEvent('landing_view');

  const wire = () => {
    const root = document.getElementById('yanta-landing');
    if (!root) return;

    root.querySelectorAll('[data-landing-cta]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        enterApp();
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
})();
