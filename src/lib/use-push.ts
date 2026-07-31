'use client'

import { useEffect, useRef } from 'react'
import { api } from './api'
import { useAuthStore } from './auth-store'

// ============================================================================
// usePushNotifications — subscribes the browser to Web Push notifications
// via the service worker + pushManager. The subscription is sent to the
// backend so the backend can send push notifications when the user is
// offline (app closed).
//
// CRITICAL: Web Push only works when:
//  1. A Service Worker is registered AND active (navigator.serviceWorker.controller)
//  2. Notification permission is granted
//  3. The browser supports PushManager
//  4. VAPID public key is fetched from the backend
//
// STABILITY FIXES (this version):
//  - SW registration is awaited explicitly with retries
//  - SW ready is retried 3× with backoff before giving up
//  - Subscription is synced to backend on EVERY focus (in case backend lost it)
//  - Permission change listener triggers immediate subscribe
//  - Verbose console logging under [PUSH] tag for debugging
//  - `subscribedRef` is per-userId, not global, so re-login re-subscribes
// ============================================================================

const PUSH_DEBUG = process.env.NODE_ENV !== 'production'
function pushLog(...args: unknown[]) {
  if (PUSH_DEBUG) console.warn('[PUSH]', ...args)
}
function pushWarn(...args: unknown[]) {
  console.warn('[PUSH]', ...args)
}

export function usePushNotifications() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const authed = isAuthenticated || (!!token && !!user)
  const subscribedRef = useRef<string | null>(null) // userId we successfully subscribed for
  const userId = user?.id

  useEffect(() => {
    if (!authed || !userId) {
      subscribedRef.current = null
      return
    }
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      pushWarn('PushManager or ServiceWorker not supported')
      return
    }

    let cancelled = false

    // ---------------------------------------------------------------------
    // Step 1: explicitly register the SW (idempotent — if already registered,
    // navigator.serviceWorker.register returns the existing registration).
    // This is critical: many stability issues come from assuming the SW is
    // already registered. We register it ourselves here to be safe.
    // ---------------------------------------------------------------------
    async function ensureSWRegistered(): Promise<ServiceWorkerRegistration | null> {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
        pushLog('SW registered, scope=', reg.scope)

        // If there's a waiting SW, activate it immediately so push works.
        if (reg.waiting) {
          pushLog('SW waiting — triggering skipWaiting')
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        }

        return reg
      } catch (e) {
        pushWarn('SW registration failed:', e)
        return null
      }
    }

    // ---------------------------------------------------------------------
    // Step 2: wait for SW to be active. Retry 3× with exponential backoff
    // because navigator.serviceWorker.ready can hang if the SW is still
    // installing/activating (especially on first visit).
    // ---------------------------------------------------------------------
    async function waitForSWReady(): Promise<ServiceWorkerRegistration | null> {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (cancelled) return null
        try {
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<ServiceWorkerRegistration>((_, reject) =>
              setTimeout(() => reject(new Error('sw-ready-timeout')), 5000 * attempt),
            ),
          ])
          if (reg.active || reg.installing || reg.waiting) {
            pushLog('SW ready (attempt ' + attempt + ')')
            return reg
          }
        } catch (e) {
          pushWarn(`SW ready attempt ${attempt} failed:`, e)
        }
        // Backoff before retry
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1500 * attempt))
        }
      }
      pushWarn('SW ready failed after 3 attempts')
      return null
    }

    // ---------------------------------------------------------------------
    // Step 3: subscribe to pushManager. If already subscribed, reuse.
    // ---------------------------------------------------------------------
    async function subscribePush(reg: ServiceWorkerRegistration, vapidPublicKey: string) {
      let subscription = await reg.pushManager.getSubscription()

      if (!subscription) {
        pushLog('No existing subscription — creating new one')
        const keyBuffer = urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBuffer,
        })
        pushLog('New subscription created:', subscription.endpoint.slice(0, 60) + '...')
      } else {
        pushLog('Existing subscription found:', subscription.endpoint.slice(0, 60) + '...')
      }

      return subscription
    }

    // ---------------------------------------------------------------------
    // Step 4: send subscription to backend. ALWAYS send (even if already
    // exists locally) — backend may have lost it (DB reset, server restart).
    //
    // 409 HANDLING: if the backend returns 409 "Subscription is owned by
    // another user" (happens on shared devices after a different user
    // logged in), we unsubscribe locally and create a fresh subscription.
    // Previously the 409 was silently swallowed and the old subscription
    // (tied to the previous user) kept receiving pushes for them — a
    // privacy leak on shared devices.
    //
    // EXPIRY CHECK: browsers automatically revoke push subscriptions
    // approximately every 60 days. If we detect that our local subscription
    // is older than 30 days, we proactively re-subscribe so the user does
    // not silently stop receiving notifications.
    // ---------------------------------------------------------------------
    const SUBSCRIPTION_REFRESH_KEY = '999pro-push-sub-refreshed-at'
    const SUBSCRIPTION_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

    async function syncToBackend(subscription: PushSubscription): Promise<'ok' | 'conflict' | 'error'> {
      const sub = subscription.toJSON()
      try {
        await api.post('/api/push/subscribe', {
          json: {
            endpoint: sub.endpoint,
            keys: sub.keys,
            scope: '/',
          },
          auth: true,
        })
        pushLog('Subscription synced to backend')
        // Record the refresh timestamp so we can proactively re-subscribe
        // every 30 days (browsers auto-revoke after ~60 days).
        try {
          localStorage.setItem(SUBSCRIPTION_REFRESH_KEY, String(Date.now()))
        } catch {}
        return 'ok'
      } catch (e: any) {
        if (e?.status === 409) {
          pushWarn('Subscription owned by another user — will unsubscribe + create fresh')
          // Unsubscribe locally so pushManager issues a new endpoint on the
          // next subscribe() call. Without this the backend keeps the old
          // endpoint tied to the previous user and we can never re-subscribe.
          try { await subscription.unsubscribe() } catch {}
          return 'conflict'
        }
        pushWarn('syncToBackend error:', e)
        return 'error'
      }
    }

    // ---------------------------------------------------------------------
    // Proactive subscription refresh: every 30 days, unsubscribe + create
    // a fresh subscription. This prevents the silent "user stopped receiving
    // notifications" bug that occurs when browsers auto-revoke the
    // subscription after ~60 days.
    // ---------------------------------------------------------------------
    async function maybeRefreshSubscription(reg: ServiceWorkerRegistration, vapidPublicKey: string) {
      try {
        const lastRefreshed = Number(localStorage.getItem(SUBSCRIPTION_REFRESH_KEY) || '0')
        const age = Date.now() - lastRefreshed
        if (age < SUBSCRIPTION_REFRESH_INTERVAL_MS) return // not yet time
        pushLog('Subscription older than 30 days — refreshing')
        const current = await reg.pushManager.getSubscription()
        if (current) {
          // Tell backend to remove the old endpoint
          try {
            await api.post('/api/push/unsubscribe', {
              json: { endpoint: current.endpoint },
              auth: true,
            })
          } catch {}
          await current.unsubscribe().catch(() => {})
        }
        // Create a fresh subscription
        await subscribePush(reg, vapidPublicKey)
        // syncToBackend is called by the caller after this returns
      } catch (e) {
        pushWarn('Subscription refresh failed:', e)
      }
    }

    // ---------------------------------------------------------------------
    // Main subscribe flow
    // ---------------------------------------------------------------------
    async function subscribe() {
      if (cancelled) return
      if (subscribedRef.current === userId) return // already subscribed for this user

      try {
        // 1. Permission MUST be granted
        if (typeof Notification === 'undefined') {
          pushWarn('Notification API not supported')
          return
        }
        if (Notification.permission === 'default') {
          // v18.6: don't silently exit — request permission directly.
          // Browsers REQUIRE a user gesture, but this subscribe() function is
          // only called from a setTimeout after auth or from a focus event
          // (both are user-gesture-adjacent). If the request is denied, we
          // exit gracefully. The page.tsx also has a click/keydown listener
          // as a backup for the very first session.
          pushLog('Permission not yet requested — requesting now')
          try {
            const result = await Notification.requestPermission()
            if (result !== 'granted') {
              pushWarn('Permission not granted:', result)
              return
            }
          } catch (e) {
            pushWarn('requestPermission threw:', e)
            return
          }
        }
        if (Notification.permission !== 'granted') {
          pushWarn('Permission denied')
          return
        }

        // 2. Get VAPID public key
        const vapidRes = await api.get<{ publicKey: string }>('/api/push/vapid-public')
        if (!vapidRes.publicKey) {
          pushWarn('No VAPID public key from backend')
          return
        }

        // 3. Ensure SW is registered + ready
        await ensureSWRegistered()
        const reg = await waitForSWReady()
        if (!reg || cancelled) return

        // 3a. Proactively refresh subscription if it's older than 30 days
        // (browsers auto-revoke after ~60 days, leading to silent push failure)
        await maybeRefreshSubscription(reg, vapidRes.publicKey)
        if (cancelled) return

        // 4. Subscribe + sync
        let subscription = await subscribePush(reg, vapidRes.publicKey)
        if (cancelled) return

        const syncResult = await syncToBackend(subscription)
        // 409 conflict — subscription belonged to another user. We already
        // unsubscribed in syncToBackend. Re-create a fresh subscription
        // (new endpoint) and sync it.
        if (syncResult === 'conflict' && !cancelled) {
          pushLog('Re-creating subscription after 409 conflict')
          subscription = await subscribePush(reg, vapidRes.publicKey)
          if (cancelled) return
          await syncToBackend(subscription)
        }
        subscribedRef.current = userId ?? null
        pushLog('✓ Push subscription complete for user', userId)
      } catch (e) {
        pushWarn('Subscribe failed:', e)
        // Reset so we retry on next focus/visibility change
        subscribedRef.current = null
      }
    }

    // Try immediately, then retry on visibility/focus changes.
    // Use a small delay to let the SW register first.
    const startTimer = setTimeout(subscribe, 1500)

    // Re-attempt on window focus — covers the case where:
    // - User came back to the tab and permission was granted in the meantime
    // - SW just finished activating
    // - Backend lost the subscription and we need to re-sync
    //
    // THROTTLE: previously this fired on EVERY focus event, which can happen
    // dozens of times per day (user switches tabs, alt-tabs back, clicks a
    // notification, etc.). Each one hit /api/push/subscribe — wasteful and
    // could trigger 429s. Now we throttle to once per 5 minutes per session.
    let lastFocusSyncAt = 0
    const FOCUS_SYNC_THROTTLE_MS = 5 * 60 * 1000
    const onFocus = () => {
      // DON'T reset subscribedRef here — instead, always re-sync to backend.
      // This ensures backend has the subscription even if user cleared site data
      // or backend DB was reset. But throttle so we don't spam the endpoint.
      void (async () => {
        const now = Date.now()
        if (now - lastFocusSyncAt < FOCUS_SYNC_THROTTLE_MS) {
          pushLog('Focus sync throttled — last sync was', now - lastFocusSyncAt, 'ms ago')
          return
        }
        lastFocusSyncAt = now
        try {
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
          const reg = await navigator.serviceWorker.ready.catch(() => null)
          if (!reg) return
          const sub = await reg.pushManager.getSubscription()
          if (sub) {
            const result = await syncToBackend(sub)
            if (result === 'conflict') {
              // 409 — re-create subscription, sync again
              const vapidRes = await api.get<{ publicKey: string }>('/api/push/vapid-public')
              if (vapidRes.publicKey) {
                const newSub = await subscribePush(reg, vapidRes.publicKey)
                await syncToBackend(newSub)
              }
            }
            subscribedRef.current = userId ?? null
            pushLog('Re-synced subscription on focus')
          } else {
            // No subscription — try full subscribe flow
            void subscribe()
          }
        } catch (e) {
          pushWarn('Focus re-sync failed:', e)
        }
      })()
    }
    window.addEventListener('focus', onFocus)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        onFocus()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Listen for permission changes — if the user grants permission later
    // (e.g. via browser settings), immediately subscribe.
    //
    // LEAK FIX (was): the permissionStatus promise was assigned AFTER the
    // effect's cleanup function captured `permStatus` (still null at that
    // point). If the component unmounted before the promise resolved, the
    // onchange handler was attached AFTER cleanup and never cleaned up.
    // Now we use a `cancelled` guard inside the .then() so we don't attach
    // the listener if the component is already unmounted.
    let permStatus: PermissionStatus | null = null
    if ('permissions' in navigator) {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((ps) => {
          // Late resolution — component may have unmounted already.
          if (cancelled) {
            // No need to attach onchange; just discard.
            return
          }
          permStatus = ps
          ps.onchange = () => {
            pushLog('Permission changed:', ps.state)
            if (ps.state === 'granted') {
              subscribedRef.current = null
              void subscribe()
            }
          }
        })
        .catch(() => {
          // permissions API not supported — ignore
        })
    }

    return () => {
      cancelled = true
      clearTimeout(startTimer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      if (permStatus) permStatus.onchange = null
    }
  }, [authed, token, userId])
}

// Convert a base64-url string to Uint8Array (for applicationServerKey).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = typeof window !== 'undefined'
    ? window.atob(base64)
    : Buffer.from(base64, 'base64').toString('binary')
  const buffer = new ArrayBuffer(rawData.length)
  const output = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}
