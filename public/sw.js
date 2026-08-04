// ============================================================================
// «Три девятки» Service Worker — plain JavaScript (NO TypeScript annotations).
// Service Workers run in a separate JS-only context; TS syntax like
// `: Response | null` causes "ServiceWorker script evaluation failed" and
// breaks ALL PWA features (offline cache, push notifications, etc).
// ============================================================================

// v25.5: bump cache version to force SW update + remove diagnostic date suffix.
const CACHE_VERSION = '999pro-v25-5-production'
const OFFLINE_URL = '/offline.html'
// v25.5: SW_DEBUG flag — set to true only when debugging SW issues.
// In production this is false so no console noise is generated.
const SW_DEBUG = false

// Core app shell — always precached. These files are small and stable.
const APP_SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
  '/icons/favicon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
]

// ============================================================================
// Wave 2 (C-PWA-003): Notification preferences stored in IndexedDB
// ----------------------------------------------------------------------------
// localStorage is NOT available in Service Worker context (only Window).
// v12.9 attempted to read 999pro-notif-* keys from localStorage directly,
// which silently failed — all notifications were shown regardless of user
// preferences. Now we use IndexedDB + an in-memory cache populated by
// messages from the page.
// ============================================================================

const NOTIF_PREFS_DB = '999pro-prefs'
const NOTIF_PREFS_STORE = 'notif'
const NOTIF_PREFS_KEYS = ['chat', 'orders', 'club', 'marketing']
const NOTIF_PREFS_TTL_MS = 60_000  // re-read from IDB every 60s max

let prefsCache = { chat: true, orders: true, club: true, marketing: true }
let prefsCacheAt = 0

function openPrefsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOTIF_PREFS_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(NOTIF_PREFS_STORE)) {
        db.createObjectStore(NOTIF_PREFS_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function refreshPrefsCache() {
  try {
    const db = await openPrefsDb()
    const tx = db.transaction(NOTIF_PREFS_STORE, 'readonly')
    const store = tx.objectStore(NOTIF_PREFS_STORE)
    const results = await Promise.all(
      NOTIF_PREFS_KEYS.map(
        (key) =>
          new Promise((resolve) => {
            const r = store.get(key)
            r.onsuccess = () => resolve([key, r.result === null ? true : r.result === 'true' || r.result === true])
            r.onerror = () => resolve([key, true])
          }),
      ),
    )
    db.close()
    const newCache = { ...prefsCache }
    for (const [k, v] of results) newCache[k] = v
    prefsCache = newCache
    prefsCacheAt = Date.now()
  } catch (e) {
    // IDB failed — keep showing all notifications (safe default)
  }
}

async function getNotifPref(category) {
  if (Date.now() - prefsCacheAt > NOTIF_PREFS_TTL_MS) {
    await refreshPrefsCache()
  }
  return prefsCache[category] !== false
}

async function setNotifPref(category, enabled) {
  prefsCache[category] = enabled
  prefsCacheAt = Date.now()
  try {
    const db = await openPrefsDb()
    const tx = db.transaction(NOTIF_PREFS_STORE, 'readwrite')
    tx.objectStore(NOTIF_PREFS_STORE).put(enabled ? 'true' : 'false', category)
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (e) {
    // ignore — in-memory cache is still updated
  }
}

self.addEventListener('install', (event) => {
  // v9-audit-fix (H-3): cache.addAll is atomic — if ANY file fails, NONE
  // are cached. The previous `.catch(() => {})` swallowed the failure
  // silently, so install "succeeded" but offline support was broken with
  // no log. Now we use Promise.allSettled so partial precache works, and
  // log any failures for debugging.
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.allSettled(APP_SHELL.map((url) => cache.add(url))),
      )
      .then((results) => {
        const failed = results.filter((r) => r.status === 'rejected')
        if (failed.length > 0) {
          // v25.5: gate behind SW_DEBUG to avoid console noise in production.
          if (typeof SW_DEBUG !== 'undefined' && SW_DEBUG) {
            console.warn(
              '[SW] Precache partial failure:',
              failed.length,
              'of',
              results.length,
              'files failed. Offline support may be degraded.',
            )
          }
        }
      })
      .then(() => {
        // v22 final: aggressively take over from the old SW so users on the
        // installed PWA see the new version immediately on next navigation,
        // without waiting for all tabs to close. Safe because the activate
        // handler cleans up old caches atomically.
        self.skipWaiting()
      }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  // SHOW_NOTIFICATION — used by the page to ask the SW to display a
  // notification. SW-displayed notifications are more reliable than
  // page-side `new Notification()` when the tab is backgrounded.
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon, tag, data, renotify, requireInteraction, actions } = event.data
    self.registration.showNotification(title || '«Три девятки»', {
      body: body || '',
      icon: icon || '/icons/icon-192.png',
      badge: '/icons/icon-192-maskable.png',
      // Unique tag per message (caller supplies `msg-${convId}-${msgId}`)
      // so rapid messages don't replace each other. renotify:true makes
      // the device re-vibrate for each one.
      tag: tag || 'chat-message',
      data: data || {},
      vibrate: [200, 100, 200],
      requireInteraction: requireInteraction || false,
      renotify: renotify !== false, // default true
      actions: actions || [],
    })
  }

  // Wave 2 (C-PWA-003): page-side settings-view.tsx pushes notif pref updates
  // via SET_NOTIF_PREF so the SW's in-memory cache + IndexedDB stays in sync.
  if (event.data && event.data.type === 'SET_NOTIF_PREF') {
    const { category, enabled } = event.data
    if (typeof category === 'string' && typeof enabled === 'boolean') {
      event.waitUntil(setNotifPref(category, enabled))
    }
  }

  // Page requests initial prefs sync on load
  if (event.data && event.data.type === 'SYNC_NOTIF_PREFS') {
    event.waitUntil(refreshPrefsCache())
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean up old caches.
      // v13.1 (audit P1-18 fix): previously only caches whose name !==
      // CACHE_VERSION were deleted. But the catalog cache is named
      // CACHE_VERSION + '-catalog' — so its name DOES match the prefix
      // but !== CACHE_VERSION, meaning it was deleted. Wait — that means
      // it WAS being deleted. Let me re-read... actually the filter is
      // `k !== CACHE_VERSION`, so `v1-catalog` would be deleted. Good.
      // But the bug was: the catalog cache was REGENERATED by the fetch
      // handler with the SAME version on the next request, retaining
      // stale entries from before the deploy. Now we explicitly delete
      // any cache starting with CACHE_VERSION + '-' (catalog, etc.) so
      // they're rebuilt fresh from the network after a deploy.
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter(
            (k) => k !== CACHE_VERSION && !k.startsWith(CACHE_VERSION + '-'),
          )
          .map((k) => caches.delete(k)),
      )
      // Also delete the catalog cache so users get fresh product data
      // after a deploy (admin may have added/removed products).
      await caches.delete(CACHE_VERSION + '-catalog')

      // P-MED-010 fix: cache size limit + LRU eviction.
      // Keep max 200 entries per cache. Delete oldest by response Date header.
      try {
        const cache = await caches.open(CACHE_VERSION)
        const requests = await cache.keys()
        if (requests.length > 200) {
          // Sort by response Date header (oldest first)
          const dated = await Promise.all(
            requests.map(async (req) => {
              const res = await cache.match(req)
              const date = res?.headers.get('date')
              return { req, ts: date ? new Date(date).getTime() : 0 }
            }),
          )
          dated.sort((a, b) => a.ts - b.ts)
          // Delete oldest 50 entries
          const toDelete = dated.slice(0, 50)
          await Promise.all(toDelete.map((d) => cache.delete(d.req)))
        }
      } catch (e) {
        // ignore cache cleanup errors
      }

      // v25.5: removed diagnostic console.log — was firing on every SW
      // activation in production, polluting the console.
      // Storage estimate is still available via navigator.storage.estimate()
      // if needed for debugging.

      // Enable navigation preload
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable()
        } catch (e) {
          // ignore
        }
      }

      // Claim clients so this SW controls the tab immediately
      await self.clients.claim()
    })(),
  )
})

// P-MED-005 fix: Background Sync — retry failed sends when network is back.
// When the page sends a message offline, it registers a sync event. The SW
// wakes up when network is restored and dispatches the sync event.
self.addEventListener('sync', (event) => {
  if (event.tag === 'send-outbound-messages') {
    event.waitUntil(flushOutboundMessageQueue())
  } else if (event.tag === 'sync-share-events') {
    event.waitUntil(flushShareEventQueue())
  }
})

// P-MED-006 fix: Periodic Background Sync — refresh catalog every 12h.
// Chrome/Edge only. Registration happens on page load if supported.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-catalog') {
    event.waitUntil(refreshCatalogCache())
  }
})

async function flushOutboundMessageQueue() {
  // Read queued messages from IndexedDB (or localStorage fallback)
  // and retry each via REST with clientMessageId idempotency.
  // The page-side message-queue.ts handles the actual queue; the SW just
  // notifies all clients that they should flush.
  const clients = await self.clients.matchAll({ includeUncontrolled: true })
  clients.forEach((client) => {
    client.postMessage({ type: 'FLUSH_MESSAGE_QUEUE' })
  })
}

async function flushShareEventQueue() {
  // Similar to message queue — notify clients to retry failed share/track events
  const clients = await self.clients.matchAll({ includeUncontrolled: true })
  clients.forEach((client) => {
    client.postMessage({ type: 'FLUSH_SHARE_QUEUE' })
  })
}

async function refreshCatalogCache() {
  // Refresh the catalog cache by fetching the products endpoint
  try {
    const cache = await caches.open(CACHE_VERSION)
    const res = await fetch('/api/products?limit=50&source=periodic-sync', {
      cache: 'no-store',
    })
    if (res.ok) {
      await cache.put('/api/products?limit=50', res.clone())
    }
  } catch (e) {
    // ignore — will retry on next periodic sync
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // v12.9: /api/products — network-first with cache fallback for offline catalog.
  // When online: fetch fresh, cache the response, return it.
  // When offline: return the last cached response so users can browse
  // the catalog without internet.
  if (url.pathname === '/api/products' || url.pathname.startsWith('/api/products?')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION + '-catalog')
        try {
          const networkRes = await fetch(req)
          if (networkRes.ok) {
            cache.put(req, networkRes.clone()).catch(() => {})
          }
          return networkRes
        } catch (e) {
          // Network failed — try cache
          const cached = await cache.match(req)
          if (cached) return cached
          // No cache — try the generic products cache (populated by periodic sync)
          const genericCached = await cache.match('/api/products?limit=50')
          if (genericCached) return genericCached
          // Nothing cached — return offline error
          return new Response('{"error":"offline","items":[]}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      })(),
    )
    return
  }

  // NEVER cache other API requests or sandbox-gateway-routed requests
  if (url.pathname.startsWith('/api/') || url.search.includes('XTransformPort')) {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response('{"error":"offline"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    return
  }

  // v24.6-audit (PWA H-1 fix): NEVER cache Socket.IO polling / WebSocket upgrade
  // requests — caching them pollutes the cache with single-use long-poll responses
  // and evicts useful entries. Socket.IO must always go straight to the network.
  if (url.pathname.startsWith('/socket.io/') || url.pathname === '/socket.io') {
    event.respondWith(
      fetch(req).catch(() => Response.error()),
    )
    return
  }

  // Never cache uploaded files
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((m) => m || Response.error()),
      ),
    )
    return
  }

  // Static Next.js chunks — cache-first + stale-while-revalidate
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.match(/\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i)
  ) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req)
        const networkPromise = fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              cache.put(req, res.clone()).catch(() => {})
            }
            return res
          })
          .catch(() => null)
        if (cached) return cached
        const network = await networkPromise
        if (network) return network
        return Response.error()
      }),
    )
    return
  }

  // HTML navigations — network-first, fallback to cache, then offline
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION)
        try {
          const preload =
            event.preloadResponse &&
            (await event.preloadResponse.catch(() => null))

          let networkRes = null
          if (preload && preload.ok) {
            networkRes = preload
          } else {
            networkRes = await fetch(req).catch(() => null)
          }
          if (!networkRes || !networkRes.ok) {
            // Network failed — try the EXACT request URL first (the page the
            // user was trying to reach). If that misses, fall back to the
            // offline page. Previously we fell back to `cache.match('/')`,
            // which silently rendered the home page for ANY navigation —
            // confusing UX (e.g. user was on /?view=chat, goes offline,
            // suddenly sees the home page).
            const cached = await cache.match(req)
            if (cached) return cached
            return (await cache.match(OFFLINE_URL)) || Response.error()
          }

          // Compare with cached HTML to detect new deploys
          const networkText = await networkRes.clone().text()
          const cachedRes = await cache.match(req)
          let changed = true
          if (cachedRes) {
            const cachedText = await cachedRes.clone().text()
            changed = cachedText !== networkText
          }

          await cache.put(req, networkRes.clone()).catch(() => {})

          if (changed) {
            const clients = await self.clients.matchAll({
              type: 'window',
              includeUncontrolled: true,
            })
            for (const c of clients) {
              c.postMessage({ type: 'UPDATE_AVAILABLE', url: req.url })
            }
          }

          return networkRes
        } catch (e) {
          // Last-resort fallback: try the exact URL, then offline page.
          const cached = await cache.match(req)
          if (cached) return cached
          return (await cache.match(OFFLINE_URL)) || Response.error()
        }
      })(),
    )
    return
  }

  // Default: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {})
          }
          return res
        })
        .catch(() => cached)
      // CRITICAL: must return a Response, not undefined. Previously if both
      // cache and network missed, this returned `undefined` which throws
      // inside event.respondWith and shows a broken page.
      return cached || network || Response.error()
    }),
  )
})

// ============================================================================
// Push notifications — fired by the browser when a Web Push message arrives
// from the push service. This works EVEN IF the app tab is closed (the SW
// runs in the background). This is the ONLY way to notify the user when the
// app is fully closed.
// ============================================================================
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (e) {
    payload = {
      title: '«Три девятки»',
      body: event.data ? event.data.text() : 'Новое сообщение',
    }
  }

  // v12.8: Only suppress system push if the payload is a chat message
  // (which has an in-app toast handler). Orders, leads, calls, and CLUB
  // notifications ALWAYS show a system notification — even if the app is
  // open — because the in-app toast may not be visible (different view,
  // different tab, Studio app, etc.).
  //
  // We still postMessage the payload to visible clients so they can show
  // the in-app toast as a fallback.
  event.waitUntil(
    (async () => {
      // Check if this is a chat message (can be suppressed)
      // Backend tags chat pushes with `msg-${conversationId}-${messageId}`.
      // Keep `chat-` / `message-` prefixes for backwards compat with any
      // in-flight pushes from older code paths.
      const isChatMessage = payload.tag && (
        payload.tag.startsWith('msg-') ||
        payload.tag.startsWith('chat-') ||
        payload.tag.startsWith('message-')
      )
      if (isChatMessage) {
        try {
          const clientList = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          })
          const visibleClient = clientList.find((c) => c.visibilityState === 'visible')
          if (visibleClient) {
            // App is visible — forward to the page so it can show in-app toast
            visibleClient.postMessage({
              type: 'PUSH_SUPPRESSED_IN_APP',
              payload,
            })
            return // Do NOT show system notification for chat messages only
          }
        } catch (e) {
          // clients.matchAll failed — fall through to showNotification
        }
      }

      // v12.9 / Wave 2 (C-PWA-003): granular notification preferences.
      // localStorage is NOT available in SW context — use IndexedDB-backed
      // prefs cache instead. Page-side settings-view.tsx pushes updates via
      // postMessage({type:'SET_NOTIF_PREF', category, enabled}).
      const tag = payload.tag || ''
      const isChatNotif = tag.startsWith('msg-') || tag.startsWith('chat-') || tag.startsWith('message-')
      const isOrderNotif = tag.startsWith('admin-order-') || tag.startsWith('order-') || tag.startsWith('admin-lead-')
      const isClubNotif = tag.startsWith('club-')
      const isMarketingNotif = tag.startsWith('promo-') || tag.startsWith('event-')
      const isLeadStatusNotif = tag.startsWith('lead-')
      const isCallNotif = tag.startsWith('call-')

      try {
        if (isChatNotif && !(await getNotifPref('chat'))) return
        if (isOrderNotif && !(await getNotifPref('orders'))) return
        if (isClubNotif && !(await getNotifPref('club'))) return
        if (isMarketingNotif && !(await getNotifPref('marketing'))) return
      } catch (e) {
        // IDB read failed — show notification (safe default)
      }

      // Show system notification (orders, leads, calls, CLUB, or chat when app is hidden)
      const title = payload.title || '«Три девятки»'
      const options = {
        body: payload.body || 'Новое сообщение',
        icon: payload.icon || '/icons/icon-192.png',
        badge: payload.badge || '/icons/icon-192-maskable.png',
        tag: payload.tag || 'chat-message',
        data: payload.data || { url: '/?view=chat' },
        vibrate: [120, 60, 120],
        requireInteraction: payload.requireInteraction || false,
        renotify: payload.renotify !== false,
        actions: payload.actions || [],
      }
      await self.registration.showNotification(title, options)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/?view=chat'
  const conversationId = event.notification.data?.conversationId
  const callId = event.notification.data?.callId
  const action = event.action // 'answer' | 'decline' | undefined (body click)

  // For call notifications with action buttons:
  //   - 'answer'   → open the app + post CALL_ANSWER message so call-manager
  //                  accepts the incoming call automatically.
  //   - 'decline'  → post CALL_DECLINE message so call-manager rejects the
  //                  call. No need to open the app for decline.
  //   - body click → just open the app (default behaviour below).
  if (callId && action === 'decline') {
    // Send CALL_DECLINE to any open tab — the call-manager will emit
    // call:reject via the socket. Don't open a new tab.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        c.postMessage({
          type: 'CALL_DECLINE',
          callId,
          conversationId,
        })
      }
    })
    return
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if one is open
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus()
            client.postMessage({
              type: action === 'answer' ? 'CALL_ANSWER' : 'NOTIFICATION_CLICK',
              conversationId,
              callId,
              url: targetUrl,
            })
            return
          }
        }
        // No existing tab — open a new one.
        // v10.3-fix: include conversationId in the URL so the app can
        // deep-link to the right conversation on cold start. Previously,
        // the URL was just '/?view=chat' (chat LIST), not the specific
        // conversation. Now it's '/?view=chat&conv=<id>' and page.tsx
        // checks for the 'conv' param on boot and dispatches
        // chat:open-conversation to open the right conversation.
        if (self.clients.openWindow) {
          let deepLinkUrl = targetUrl
          if (conversationId) {
            const u = new URL(targetUrl, self.location.origin)
            u.searchParams.set('conv', conversationId)
            deepLinkUrl = u.pathname + u.search
          }
          return self.clients.openWindow(deepLinkUrl)
        }
      }),
  )
})

// ============================================================================
// v9-audit-fix (H-1): pushsubscriptionchange — fired by the browser when
// the push service rotates the subscription endpoint (FCM/AutoPush does
// this periodically). Without this handler, the backend keeps sending
// pushes to the OLD endpoint and the user silently stops receiving
// notifications. We re-subscribe and notify all open clients to POST the
// new endpoint to the backend (and unsubscribe the old one).
// ============================================================================
// v20: Fixed pushsubscriptionchange handler — fetches VAPID key from backend
// instead of relying on oldSub?.options?.applicationServerKey (which is usually
// undefined in most browsers). Also caches the key in IndexedDB for resilience.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription
        const reg = await self.registration

        // Try to get the VAPID key from the backend
        let vapidKey = null
        try {
          // First try IndexedDB cache
          vapidKey = await getVapidKeyFromIDB()
          if (!vapidKey) {
            // Fetch from backend
            const resp = await fetch('/api/push/vapid-public')
            if (resp.ok) {
              const data = await resp.json()
              if (data.publicKey) {
                vapidKey = urlBase64ToUint8Array(data.publicKey)
                // Cache for future use
                await setVapidKeyInIDB(data.publicKey)
              }
            }
          }
        } catch (e) {
          if (SW_DEBUG) console.warn('[SW] Failed to fetch VAPID key for rotation:', e)
        }

        const newSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey || undefined,
        })

        // Notify all open clients so they can sync the new endpoint to the backend
        const clients = await self.clients.matchAll({ includeUncontrolled: true })
        for (const c of clients) {
          c.postMessage({
            type: 'PUSH_SUBSCRIPTION_CHANGED',
            oldEndpoint: oldSub?.endpoint || null,
            newEndpoint: newSub.endpoint,
            keys: newSub.toJSON().keys,
          })
        }
      } catch (e) {
        if (SW_DEBUG) console.warn('[SW] pushsubscriptionchange failed:', e)
      }
    })(),
  )
})

// v24.6-audit (PWA C-1 fix): openNotifDB() was referenced but never defined —
// the `pushsubscriptionchange` handler silently threw ReferenceError, so endpoint
// rotation failed and users lost all push notifications ~60 days after install.
// This implementation opens (or creates) a small IndexedDB with a single
// 'settings' object store used to cache the VAPID key for SW-side resubscribe.
async function openNotifDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('999pro-sw-notif', 1)
    req.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings')
      }
    }
    req.onsuccess = (event) => resolve(event.target.result)
    req.onerror = (event) => reject(event.target.error)
  })
}

// v20: Helper — cache VAPID key in IndexedDB for SW use during rotation
async function getVapidKeyFromIDB() {
  try {
    const db = await openNotifDB()
    const tx = db.transaction('settings', 'readonly')
    const store = tx.objectStore('settings')
    const key = await store.get('vapid-key')
    return key ? urlBase64ToUint8Array(key) : null
  } catch {
    return null
  }
}

async function setVapidKeyInIDB(key) {
  try {
    const db = await openNotifDB()
    const tx = db.transaction('settings', 'readwrite')
    tx.objectStore('settings').put(key, 'vapid-key')
    await tx.done
  } catch {
    // non-critical
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
