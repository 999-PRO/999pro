'use client'

/**
 * useStudioPush — minimal push subscription hook for Studio admin panel.
 *
 * Subscribes the admin to Web Push so they receive notifications about:
 *   - New orders (🛒)
 *   - New leads (🔔)
 *   - New chat messages
 *
 * The subscription is sent to the SAME backend `/api/push/subscribe`
 * endpoint as the main app — the admin's `userId` is the key.
 *
 * v22 final: gracefully no-ops when push notifications are not configured
 * (VAPID keys missing on the backend). Previously the hook threw errors
 * that polluted the Studio console on every page load.
 */

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { api } from '@/lib/api'

// Cache the "push configured?" check so we don't hit /api/push/vapid-public
// on every Studio page transition. null = unknown, true = configured, false = not configured.
let pushConfiguredCache: boolean | null = null

export function useStudioPush() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const isInitialized = useAuthStore((s) => s.isInitialized)

  useEffect(() => {
    if (!isInitialized || !isAuthenticated || !isAdmin) return
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    if (!('PushManager' in window)) return

    let cancelled = false

    const subscribe = async () => {
      try {
        // v22 final: check if push is configured on the backend before
        // requesting notification permission. If VAPID keys are missing,
        // /api/push/vapid-public returns 503 and we silently skip — no
        // permission prompt, no error in console.
        if (pushConfiguredCache === false) return

        // Get VAPID public key from backend
        let publicKey: string
        try {
          const vapidRes = await api.get<{ publicKey: string }>('/api/push/vapid-public')
          publicKey = vapidRes.publicKey
          pushConfiguredCache = true
        } catch (e: any) {
          // 503 = push not configured — silently disable, don't log as error.
          if (e?.status === 503 || e?.message?.includes('not configured')) {
            pushConfiguredCache = false
            return
          }
          // Other errors (network, 500, etc.) — log once but don't spam.
          console.warn('[Studio Push] Backend unreachable, skipping subscription')
          pushConfiguredCache = false
          return
        }

        // Request permission only AFTER we know push is configured.
        if (Notification.permission === 'default') {
          await Notification.requestPermission()
        }
        if (Notification.permission !== 'granted') return

        // Register SW (scope = /studio/)
        // v22 final: wrap in try/catch — if /studio/sw.js doesn't exist,
        // the registration throws "ServiceWorker registration failed" which
        // is non-fatal (push just doesn't work).
        let reg: ServiceWorkerRegistration
        try {
          reg = await navigator.serviceWorker.register('/studio/sw.js', { scope: '/studio/' })
          await navigator.serviceWorker.ready
        } catch (swErr) {
          console.warn('[Studio Push] SW registration skipped (non-fatal):', swErr)
          return
        }

        // Check existing subscription
        let sub = await reg.pushManager.getSubscription()
        if (!sub) {
          // Convert VAPID key to Uint8Array
          const key = urlBase64ToUint8Array(publicKey)
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          })
        }

        if (cancelled) return

        // Send subscription to backend.
        const subJson = sub.toJSON()
        await api.post('/api/push/subscribe', {
          json: {
            endpoint: subJson.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh,
              auth: subJson.keys?.auth,
            },
            scope: '/studio/',
          },
          auth: true,
        })
        console.log('[Studio Push] Subscribed successfully')
      } catch (e) {
        // Silently swallow — push is a nice-to-have, not a critical feature.
        // Don't pollute the console with full error stacktraces.
        console.warn('[Studio Push] Subscription skipped:', e instanceof Error ? e.message : String(e))
      }
    }

    // Delay slightly to let auth settle
    const timer = setTimeout(subscribe, 2000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isInitialized, isAuthenticated, isAdmin])
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('binary')
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i)
  }
  return output.buffer as ArrayBuffer
}
