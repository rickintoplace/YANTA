// Capture the PWA install prompt as early as possible: the browser fires
// `beforeinstallprompt` once, often before app modules finish loading. We
// stash it so the install UI can offer a one-click install on a user gesture
// later. Loaded as an external script so it satisfies `script-src 'self'`
// (the page CSP uses hashes, not 'unsafe-inline'). See src/install/install-manager.js.
(() => {
  const bucket = (window.__yantaInstall = window.__yantaInstall || {
    deferred: null,
    installed: false,
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    bucket.deferred = e;
    window.dispatchEvent(new CustomEvent('yanta-install-availability-changed'));
  });

  window.addEventListener('appinstalled', () => {
    bucket.installed = true;
    bucket.deferred = null;
    window.dispatchEvent(new CustomEvent('yanta-app-installed'));
  });
})();
