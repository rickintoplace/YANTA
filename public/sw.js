// ============================================================
// YANTA Service Worker
//
// Conservative app-shell caching.
// User data is in IndexedDB/Yjs, not in this cache.
// ============================================================

const CACHE_VERSION = 'yanta-app-v17';
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
  '/android-chrome-512x512.png',
  // '/boot-appearance.js',
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
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/share/') ||
      url.pathname.startsWith('/present')
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

  /*
    Same-origin navigation: app-shell strategy (cache first, revalidate in
    the background). Why: on app reopen (Android kills the WebView freely)
    a network-first shell used to block first paint for as long as a weak
    connection needed — tens of seconds on mobile. The cached shell paints
    instantly; a fresh copy is fetched alongside and used on the NEXT boot.
    Hashed asset URLs referenced by a stale shell stay valid via the
    stale-while-revalidate asset cache below.
  */
  if (req.mode === 'navigate' && url.origin === location.origin) {
    event.respondWith(
      caches.match('/index.html').then((cached) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((cache) => {
                cache.put('/index.html', copy).catch(() => {});
              });
            }
            return res;
          })
          .catch(() => cached);

        return cached || fresh;
      })
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification?.data || {};
  const url = data.url || '/';
  const roomId = data.roomId || '';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    // Reuse a running app window: focus + in-app navigation via message.
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({
          type: 'yanta-notification-click',
          roomId,
          url,
        });
        return;
      }
    }

    // No window open: cold start with the deep link.
    if (clients.openWindow) {
      await clients.openWindow(url);
    }
  })());
});

// ============================================================
// Web Push (background delivery)
//
// Chat pushes are content-free ("New message"). Calendar reminder pushes
// carry a client-encrypted payload we decrypt with a device key stored in
// IndexedDB (written by src/push/web-push-client.js) — the server never
// sees event titles.
// ============================================================

const PUSH_DB = 'yanta-push';
const PUSH_STORE = 'keys';

function openPushDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PUSH_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PUSH_STORE)) {
        req.result.createObjectStore(PUSH_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function pushDbGet(key) {
  return openPushDb().then((db) => new Promise((resolve, reject) => {
    const r = db.transaction(PUSH_STORE, 'readonly').objectStore(PUSH_STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  }));
}

function b64urlToBytes(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decryptReminder(enc) {
  const [ivB64, ctB64] = String(enc || '').split('.');
  if (!ivB64 || !ctB64) return null;

  const raw = await pushDbGet('calendarKey');
  if (!raw) return null;

  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlToBytes(ivB64) },
    key,
    b64urlToBytes(ctB64),
  ));

  return JSON.parse(new TextDecoder().decode(pt));
}

async function hasVisibleClient() {
  const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.some((c) => c.visibilityState === 'visible' || c.focused);
}

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {}

  const iconOpts = {
    icon: '/android-chrome-192x192.png',
    badge: '/android-chrome-192x192.png',
    renotify: true,
  };

  if (payload.kind === 'chat') {
    const roomId = payload.roomId || '';

    // A visible window already surfaces messages via the in-app path —
    // skip the push notification to avoid noise/duplication.
    if (await hasVisibleClient()) return;

    await self.registration.showNotification('YANTA', {
      ...iconOpts,
      body: 'New message',
      // Same tag as the in-app path → collapses instead of duplicating.
      tag: roomId ? `yanta-chat-${roomId}` : 'yanta-chat',
      data: { url: payload.url || '/#chat', roomId },
    });
    return;
  }

  if (payload.kind === 'calendar-reminder') {
    let info = null;
    try {
      info = await decryptReminder(payload.enc);
    } catch {}

    await self.registration.showNotification(info?.title || 'Event reminder', {
      ...iconOpts,
      body: info?.body || 'Upcoming event',
      tag: info?.id ? `yanta-reminder-${info.id}` : 'yanta-reminder',
      requireInteraction: true,
      data: { url: info?.url || '/#calendar', kind: 'calendar-reminder' },
    });
    return;
  }

  // Unknown payload — Chrome's userVisibleOnly rule still requires a UI.
  await self.registration.showNotification('YANTA', {
    ...iconOpts,
    body: 'You have a new notification',
    tag: 'yanta-generic',
  });
}

// The push service can rotate the subscription without the app running.
// Re-subscribe from stored meta so background delivery self-heals.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribePush());
});

async function resubscribePush() {
  try {
    const meta = await pushDbGet('meta');
    if (!meta?.vapidKey) return;

    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(meta.vapidKey),
    });

    const base = meta.apiBase || (self.location.origin + '/cloud-api');
    await fetch(base + '/api/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: meta.deviceId,
        pushkey: meta.pushkey,
        subscription: sub.toJSON(),
      }),
    });
  } catch {
    // The app re-subscribes on next open (refreshPushActiveState).
  }
}