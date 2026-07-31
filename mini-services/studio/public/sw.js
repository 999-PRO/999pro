// «Три девятки» Studio — Service Worker
//
// FIX (was): the previous version precached '/' (the MAIN APP home page, not
// Studio) and cached /api/* responses. Both bugs caused offline Studio to
// show stale main-app HTML and stale admin data — dangerous because admins
// act on the data shown (delete leads, change statuses etc.).
//
// Now: precache /studio/ + /studio/manifest.webmanifest + studio icons.
// Bypass /api/* and /uploads/* entirely (network-only with offline fallback).
// Cache /studio/_next/static/* long-term (immutable build assets).

const CACHE_NAME = '999pro-studio-v4-push-2026-07-07';
const APP_SHELL = [
  '/studio/',
  '/studio/manifest.webmanifest',
  '/studio/icon-192.svg',
  '/studio/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // NEVER cache API or uploads — admins must always see fresh data.
  // Without this, a stale /api/leads response could show leads that were
  // already processed, leading to double-action.
  if (url.pathname.startsWith('/api/') || url.search.includes('XTransformPort')) {
    event.respondWith(
      fetch(req).catch(
        () => new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    return;
  }
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  // Navigations — network-first, fallback to cached /studio/ then to
  // cached exact URL. Previously fell back to '/' which served the MAIN
  // app's HTML at the /studio/ URL — completely wrong app.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkRes = await fetch(req);
          if (networkRes.ok) {
            cache.put(req, networkRes.clone()).catch(() => {});
          }
          return networkRes;
        } catch {
          const exact = await cache.match(req);
          if (exact) return exact;
          const shell = await cache.match('/studio/');
          if (shell) return shell;
          return Response.error();
        }
      })(),
    );
    return;
  }

  // Static /studio/_next/static/* — cache-first (immutable build assets).
  if (url.pathname.startsWith('/studio/_next/static/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        } catch {
          return Response.error();
        }
      }),
    );
    return;
  }

  // Default — stale-while-revalidate, but only for same-origin basic
  // responses (no third-party).
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network || Response.error();
    }),
  );
});

// ============================================================================
// v12.8: PUSH NOTIFICATIONS for Studio (admin notifications)
// Previously Studio had NO push handler — admin push went into the void.
// Now: push events are handled here, notifications shown even when Studio
// is closed. notificationclick opens/focuses the Studio tab.
// ============================================================================

self.addEventListener('push', (event) => {
  let payload
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    try {
      payload = { body: event.data ? event.data.text() : 'Новое уведомление' }
    } catch {
      payload = { body: 'Новое уведомление' }
    }
  }

  // Studio notifications ALWAYS show (no suppression — admins need to see them)
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Studio «Три девятки»', {
      body: payload.body || '',
      icon: '/studio/icon-192.png',
      badge: '/studio/icon-192-maskable.png',
      tag: payload.tag || 'studio-notification',
      data: payload.data || { url: '/studio/' },
      vibrate: [120, 60, 120],
      requireInteraction: payload.requireInteraction || false,
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/studio/'

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Find a Studio tab
      const studioClient = clientList.find((c) => c.url.includes('/studio'))
      if (studioClient) {
        if (targetUrl !== '/studio/') {
          studioClient.postMessage({ type: 'NAVIGATE', url: targetUrl })
        }
        return studioClient.focus()
      }
      return self.clients.openWindow(targetUrl)
    })(),
  )
})
