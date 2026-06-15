// ============================================================
// YANTA Service Worker
//
// Conservative app-shell caching.
// User data is in IndexedDB/Yjs, not in this cache.
// ============================================================

const CACHE_VERSION = 'yanta-app-v5';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/dashboard.css',
  '/calendar.css',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache YANTA Cloud API / backend endpoints.
  // Important when /cloud-api is same-origin via Vercel/Cloudflare rewrite.
  if (
    url.origin === location.origin &&
    (
      url.pathname.startsWith('/cloud-api/') ||
      url.pathname.startsWith('/api/')
    )
  ) {
    return;
  }

  // Never cache Google OAuth / Drive API / remote APIs.
  if (
    url.hostname.includes('google.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return;
  }

  // Same-origin navigation: network first, fallback to cached shell.
  if (req.mode === 'navigate' && url.origin === location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put('/index.html', copy).catch(() => {});
          });
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );

    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((cache) => {
                cache.put(req, copy).catch(() => {});
              });
            }

            return res;
          })
          .catch(() => cached);

        return cached || fresh;
      })
    );
  }
});