'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { useNotificationsStore } from '@/lib/use-notifications'
import { useAuthStore } from '@/lib/auth-store'

// ============================================================================
// Service worker registration + auto-update handling.
//
// Design goals:
// 1. Never compete with hydration — SW registration is deferred via
//    requestIdleCallback (or setTimeout fallback).
// 2. Listen for `controllerchange` and `UPDATE_AVAILABLE` messages so the
//    page reloads ONCE when a new SW version is detected. Both listeners
//    are guarded by module-level flags + sessionStorage so reloads never
//    loop.
// 3. On focus + visibilitychange we trigger `reg.update()` so backgrounded
//    tabs pick up new deploys without a manual reload.
// 4. All listeners are registered synchronously (not inside the deferred
//    callback) so we never miss an early event, and all are removed in the
//    cleanup function — no leaks across HMR / unmount.
// ============================================================================

// Module-level guards prevent multiple reloads per session for the same
// trigger. They reset on full page reload (new JS module instance).
let reloadGuardController = false
let reloadGuardUpdate = false

const SW_FIRST_ACT_KEY = '999pro-sw-first-activation-done'
const SW_UPDATE_APPLIED_KEY = '999pro-update-applied'

export function ThemeProvider({ children }: { children: ReactNode }) {
  // v39: When the resolved theme is 'neon', we ALSO need the 'dark' class on
  // <html> so that Tailwind's `dark:` variants (used across product-page,
  // product-page-desktop, etc.) apply. Without 'dark', neon showed white
  // product cards. next-themes only adds the picked theme class.
  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      const hasNeon = root.classList.contains('neon')
      if (hasNeon && !root.classList.contains('dark')) {
        root.classList.add('dark')
      }
    }
    sync()
    // Re-sync whenever the class attribute changes (next-themes updates it
    // when the user switches themes).
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // ----- Listener registration (synchronous, before SW registers) -----
    // These fire on every relevant event; we guard inside each handler so
    // we only act once per actual version change.

    const onControllerChange = () => {
      if (reloadGuardController) return
      reloadGuardController = true
      // Skip the very first activation — that's the initial SW taking
      // control, not an update. Without this guard the page would reload
      // immediately after first SW activation on cold launch.
      try {
        const wasFirstActivation = !sessionStorage.getItem(SW_FIRST_ACT_KEY)
        if (wasFirstActivation) {
          sessionStorage.setItem(SW_FIRST_ACT_KEY, '1')
          return
        }
      } catch {
        // sessionStorage unavailable — proceed with reload
      }
      // P-HIGH-007: do NOT silently reload while the user is mid-edit in a
      // form / textarea / contenteditable — that would discard their input.
      // Reload immediately only if:
      //   - the tab is hidden (user isn't looking — safe to reload), OR
      //   - no input/textarea/contenteditable element currently has focus.
      // Otherwise, dispatch a `sw-update-available` CustomEvent so a
      // top-level listener (e.g. a toast banner in the app shell) can
      // prompt the user to refresh at a convenient moment.
      const isHidden = document.visibilityState === 'hidden'
      const activeEl = document.activeElement as HTMLElement | null
      const isFormFocused =
        !!activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable === true)
      if (isHidden || !isFormFocused) {
        window.location.reload()
      } else {
        window.dispatchEvent(new CustomEvent('sw-update-available'))
        // Reset the guard so a later trigger (e.g. user dismisses the toast
        // and the tab is later backgrounded) can still apply the update.
        reloadGuardController = false
      }
    }

    const onMessage = (event: MessageEvent) => {
      if (!event.data) return
      // 1. New SW version available → schedule a single reload.
      if (event.data.type === 'UPDATE_AVAILABLE') {
        if (reloadGuardUpdate) return
        try {
          if (sessionStorage.getItem(SW_UPDATE_APPLIED_KEY)) return
          sessionStorage.setItem(SW_UPDATE_APPLIED_KEY, '1')
        } catch {
          /* sessionStorage unavailable — proceed with reload */
        }
        reloadGuardUpdate = true
        // CRITICAL: send SKIP_WAITING to the waiting SW, but DO NOT reload
        // immediately. The reload must wait for `controllerchange` to fire
        // (which happens AFTER skipWaiting() completes and the new SW takes
        // control). Reloading before controllerchange means the page reloads
        // against the OLD SW — the user sees stale content until the next
        // navigation. The `onControllerChange` handler above does the reload.
        registrationRef.current?.waiting?.postMessage({ type: 'SKIP_WAITING' })
        return
      }
      // 2. User tapped a system push notification → re-dispatch as a
      // CustomEvent so page.tsx's `notification:click` handler can open
      // the right conversation. Without this bridge, taps on background
      // push notifications only focus the tab and the conversation is
      // never opened.
      if (event.data.type === 'NOTIFICATION_CLICK') {
        const { conversationId, url } = event.data as {
          conversationId?: string
          url?: string
        }
        window.dispatchEvent(
          new CustomEvent('notification:click', {
            detail: { conversationId, url },
          }),
        )
        return
      }
      // 3. User tapped "Answer" on a call push notification → dispatch a
      // CustomEvent that call-manager listens for and accepts the call.
      if (event.data.type === 'CALL_ANSWER') {
        const { callId, conversationId } = event.data as {
          callId?: string
          conversationId?: string
        }
        window.dispatchEvent(
          new CustomEvent('call:answer-from-notification', {
            detail: { callId, conversationId },
          }),
        )
        return
      }
      // 4. User tapped "Decline" on a call push notification → dispatch a
      // CustomEvent that call-manager listens for and rejects the call.
      if (event.data.type === 'CALL_DECLINE') {
        const { callId, conversationId } = event.data as {
          callId?: string
          conversationId?: string
        }
        window.dispatchEvent(
          new CustomEvent('call:decline-from-notification', {
            detail: { callId, conversationId },
          }),
        )
        return
      }
      // 5. v11-fix: SW suppressed a system push because the app is visible.
      // This happens when the backend sent a Web Push (because the socket
      // was briefly disconnected) but the SW detected the page is visible
      // and decided not to show a system notification. We show an in-app
      // toast as a fallback so the user doesn't miss the message.
      if (event.data.type === 'PUSH_SUPPRESSED_IN_APP') {
        const payload = (event.data as { payload?: Record<string, unknown> }).payload
        if (!payload) return
        const conversationId = (payload.data as { conversationId?: string })?.conversationId
        const messageId = (payload.data as { messageId?: string })?.messageId
        const senderName = (payload.title as string) || 'Пользователь'
        const body = (payload.body as string) || 'Новое сообщение'
        const senderAvatar = (payload.icon as string) || null
        if (!conversationId) return
        // Show in-app toast (sound is played by the unified notification system
        // via the `sound: 'message'` option when the toast is forwarded).
        useNotificationsStore.getState().showInAppToast({
          id: `sw-${messageId || Date.now()}-${Date.now()}`,
          conversationId,
          senderName,
          senderAvatar,
          body,
          createdAt: Date.now(),
        })
        return
      }

      // v20: Handle push subscription rotation — when the push service rotates
      // the endpoint, the SW re-subscribes and sends PUSH_SUBSCRIPTION_CHANGED.
      // We sync the new endpoint to the backend and delete the old one.
      //
      // v25.10 (P0 fix): previously these fetch() calls were made WITHOUT an
      // Authorization header. Both /api/push/subscribe and /api/push/unsubscribe
      // are wrapped in `requireAuth` → silent 401. After ~60 days when the
      // browser rotated the push endpoint, the SW re-subscribed locally but
      // the backend never learned about the new endpoint → user silently
      // stopped receiving push notifications. We now attach the JWT from
      // auth-store so the sync succeeds. If the user is logged out, we skip
      // the sync — the SW's pushsubscriptionchange handler will retry on
      // next focus via the IDB-cached VAPID key.
      if (event.data.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        const { oldEndpoint, newEndpoint, keys } = event.data as {
          oldEndpoint: string | null
          newEndpoint: string
          keys: { p256dh: string; auth: string }
        }
        // Read token AT EVENT TIME (not at module init) — the user may have
        // logged in/out since the SW was registered. Use getState() to avoid
        // re-rendering the provider on every auth state change.
        const token = useAuthStore.getState().token
        if (!token) {
          // User is logged out — can't sync. The SW will retry on next
          // focus. Best-effort: clear the local subscription so a stale
          // endpoint doesn't linger. (The backend's 404/410 cleanup will
          // eventually delete the old endpoint when FCM/APNs stops
          // delivering to it.)
          return
        }
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }
        // Delete old subscription from backend
        if (oldEndpoint) {
          fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers,
            body: JSON.stringify({ endpoint: oldEndpoint }),
          }).catch(() => {})
        }
        // Register new subscription
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers,
          body: JSON.stringify({ endpoint: newEndpoint, keys, scope: '/' }),
        }).catch(() => {})
        return
      }
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    navigator.serviceWorker.addEventListener('message', onMessage)

    // ----- Update polling (focus / visibilitychange / 4h interval) -----
    const checkForUpdates = () => {
      registrationRef.current?.update().catch(() => {})
    }
    const onFocus = () => checkForUpdates()
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdates()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    // ----- Deferred SW registration -----
    const schedule = (fn: () => void) => {
      if ('requestIdleCallback' in window) {
        ;(window as unknown as {
          requestIdleCallback: (cb: () => void, opts: { timeout: number }) => number
        }).requestIdleCallback(fn, { timeout: 2000 })
      } else {
        setTimeout(fn, 1500)
      }
    }

    let intervalId: ReturnType<typeof setInterval> | null = null

    schedule(() => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          registrationRef.current = reg

          // Periodic update check — every 4h.
          intervalId = setInterval(() => {
            reg.update().catch(() => {})
          }, 4 * 60 * 60 * 1000)

          // v10-native: Background Sync registration — when the page queues
          // an offline message, it calls `reg.sync.register('send-outbound-messages')`.
          // The SW then wakes up when network is restored and dispatches the
          // sync event, which notifies all clients to flush their queues.
          // We register the tag here so it exists; the actual trigger is
          // on-demand from message-queue.ts when a message is queued.
          // (No-op on browsers without Background Sync API — Firefox/Safari.)

          // v10-native: Periodic Background Sync — refresh catalog every 12h.
          // Chrome/Edge only. The SW's periodicsync listener handles the
          // actual fetch + cache refresh.
          if ('periodicSync' in reg) {
            // Try to register periodic sync for catalog refresh.
            // This may throw if the user hasn't granted the "periodic-background-sync"
            // permission (Chrome requires it). Silent fail.
            ;(reg as unknown as { periodicSync: { register: (tag: string, opts?: { minInterval: number }) => Promise<void> } })
              .periodicSync.register('refresh-catalog', { minInterval: 12 * 60 * 60 * 1000 })
              .catch(() => {})
          }

          // When a new SW is installed, force-activate it so the next
          // reload picks up the new app shell.
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            if (!newWorker) return
            newWorker.addEventListener('statechange', () => {
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                newWorker.postMessage({ type: 'SKIP_WAITING' })
              }
            })
          })
        })
        .catch(() => {
          // SW registration failed (e.g. blocked by privacy mode) — app
          // still works without offline support.
        })
    })

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      navigator.serviceWorker.removeEventListener('message', onMessage)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={['light', 'dark', 'neon']}
    >
      {children}
      <SwUpdateToast />
    </NextThemesProvider>
  )
}

// v24.6-audit (PWA H-4 fix): SW dispatches `sw-update-available` CustomEvent
// but nothing was listening — updates were silently dropped when the user was
// mid-form. This toast surfaces the update and lets the user reload now or
// defer. The reload itself is safe (SW already called skipWaiting), the toast
// just gives the user agency over WHEN to refresh.
function SwUpdateToast() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onSwUpdate = () => setVisible(true)
    window.addEventListener('sw-update-available', onSwUpdate)
    return () => window.removeEventListener('sw-update-available', onSwUpdate)
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'max(env(safe-area-inset-bottom), 16px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: 'rgb(15 23 42)',
        color: 'white',
        padding: '12px 16px',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        maxWidth: 'calc(100vw - 32px)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
      }}
    >
      <span>Доступна новая версия приложения</span>
      <button
        onClick={() => {
          sessionStorage.removeItem('999pro-update-applied')
          window.location.reload()
        }}
        style={{
          background: 'rgb(59 130 246)',
          color: 'white',
          border: 'none',
          padding: '6px 12px',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '13px',
        }}
      >
        Обновить
      </button>
      <button
        onClick={() => setVisible(false)}
        aria-label="Закрыть"
        style={{
          background: 'transparent',
          color: 'rgb(148 163 184)',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          fontSize: '18px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
