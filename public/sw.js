// ============================================================
// YANTA Service Worker
//
// Conservative app-shell caching.
// User data is in IndexedDB/Yjs, not in this cache.
// ============================================================

const CACHE_VERSION = 'yanta-app-v25';
// Only files that actually exist at these paths in the build. CSS/JS are
// hashed into /assets by Vite and cached at runtime by the fetch handler —
// they must NOT be listed here (a 404 here would fail the whole install).
const APP_SHELL = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);

    // Cache entries individually: one missing/blocked asset must never fail
    // the whole install. A failed install leaves the worker inactive, so
    // navigator.serviceWorker.ready hangs forever — which breaks Web Push
    // (pushManager needs an active registration) and SW notifications.
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));

    await self.skipWaiting();
  })());
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

// ============================================================
// Web Share Target inbox
//
// The manifest declares `share_target` as a POST to /share-target. The OS
// share sheet posts the shared title/text/url (+ optional image) here. We
// stash it locally (structured-cloneable File objects go straight into IDB),
// then 303-redirect into the app, which consumes the payload on boot and
// opens the share router. Fully local — nothing touches the network, so a
// share made offline still lands.
// ============================================================

const SHARE_DB = 'yanta-share';
const SHARE_STORE = 'inbox';
const SHARE_KEY = 'pending';

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) {
        req.result.createObjectStore(SHARE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function shareDbPut(value) {
  return openShareDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    tx.objectStore(SHARE_STORE).put(value, SHARE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

async function handleShareTargetPost(req) {
  try {
    const form = await req.formData();
    const files = form
      .getAll('media')
      .filter((f) => f && typeof f.arrayBuffer === 'function' && f.size > 0);

    await shareDbPut({
      title: String(form.get('title') || ''),
      text: String(form.get('text') || ''),
      url: String(form.get('url') || ''),
      files,
      ts: Date.now(),
    });
  } catch {
    // Even a failed parse should still open the app rather than error out.
  }

  // 303 turns the POST into a plain GET navigation the app shell can serve.
  // Response.redirect needs an absolute URL — resolve against our origin.
  return Response.redirect(new URL('/?share-target=1', self.location.origin).href, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Web Share Target: intercept the POST before the GET-only bail below.
  if (
    req.method === 'POST' &&
    url.origin === location.origin &&
    url.pathname === '/share-target'
  ) {
    event.respondWith(handleShareTargetPost(req));
    return;
  }

  if (req.method !== 'GET') return;

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
    Same-origin navigation: network-first with a short timeout, falling back
    to the cached app shell.

    Why network-first: the shell (/index.html, no-store, tiny) names the hashed
    JS/CSS bundle. A pure cache-first shell meant a fresh deploy did not reach
    an installed client until a LATER boot — users kept running the previous
    bundle after every deploy. Network-first serves the just-deployed shell
    immediately.

    Why the timeout: on app reopen (Android kills the WebView freely) a slow
    or offline network must never block first paint. If the network has not
    answered within TIMEOUT_MS we paint the cached shell instantly; the network
    copy still lands in the cache for the next boot. Hashed asset URLs stay
    valid across shells via the stale-while-revalidate asset cache below.
  */
  if (req.mode === 'navigate' && url.origin === location.origin) {
    const SHELL_NETWORK_TIMEOUT_MS = 2500;

    event.respondWith((async () => {
      const cached = await caches.match('/index.html');

      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put('/index.html', copy).catch(() => {});
          });
        }
        return res;
      });

      // First-ever load (nothing cached): the network is the only option.
      if (!cached) return network;

      const timeout = new Promise((resolve) => {
        setTimeout(() => resolve(cached), SHELL_NETWORK_TIMEOUT_MS);
      });

      return Promise.race([
        network.catch(() => cached),
        timeout,
      ]);
    })());
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

  if (payload.kind === 'test') {
    // Diagnostic push — always show, even with the app open.
    await self.registration.showNotification(payload.title || 'YANTA', {
      ...iconOpts,
      body: payload.body || 'Background delivery works.',
      tag: 'yanta-bg-test',
      data: { url: '/' },
    });
    return;
  }

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
    // The Worker labels every scheduled push the same way; the real kind
    // lives inside the ciphertext, which only this device can read.
    let info = null;
    try {
      info = await decryptReminder(payload.enc);
    } catch {}

    if (info?.kind === 'pulse-wake') {
      // A routine came due while YANTA was closed. Nothing can run out
      // here — the vault is encrypted and the reasoning happens in the
      // app — so this invites the user back in, and the boot pass runs
      // the routine the moment they arrive.
      if (await hasVisibleClient()) return;

      await self.registration.showNotification(info.title || 'YANTA Pulse', {
        ...iconOpts,
        body: info.body || 'A routine is ready to run.',
        tag: 'yanta-pulse-wake',
        data: { url: info.url || '/#dashboard', kind: 'pulse-wake' },
      });
      return;
    }

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