'use client'

import { create } from 'zustand'
import { useEffect, useRef, useCallback } from 'react'
import { useSocket } from './use-socket'
import { useAuthStore } from './auth-store'
import { api } from './api'
// v13.3 (audit Cluster F): use shared AudioContext singleton.
import { getSharedAudioContext } from './audio-context'
import type { Message, Conversation } from './types'

// ============================================================================
// Global notification store — tracks unread counts AND in-app toast queue.
//
// Three orthogonal pieces of state:
//   1. unread.{total, byConversation}  → drives the badges (chat list card
//      + bottom nav "Chat" tab). Cleared when the user opens the conversation.
//   2. inAppToast                      → currently visible in-app notification
//      card (only one at a time). Auto-dismissed after 5s or on tap.
//   3. conversationsRef                → cached list of conversations so we
//      can resolve sender name + avatar without an extra API call when a
//      message arrives.
//
// Notification policy (per requirements):
//   - App CLOSED or in BACKGROUND  → system Push via Service Worker.
//     Plays the OS-level notification sound + vibration.
//   - App OPEN but user is in a DIFFERENT view  → in-app toast (top card,
//     smooth slide-in), soft brand sound via Web Audio API. NO system push.
//   - User is INSIDE the active conversation  → silent. Just append the
//     message to the chat (handled by chat.tsx). No badge, no sound,
//     no toast, no push.
// ============================================================================

interface InAppToast {
  id: string
  conversationId: string
  senderName: string
  senderAvatar?: string | null
  body: string
  createdAt: number
}

interface NotificationState {
  unread: {
    total: number
    byConversation: Record<string, number>
  }
  inAppToast: InAppToast | null
  incrementUnread: (conversationId: string) => void
  clearUnread: (conversationId: string) => void
  clearAll: () => void
  setUnread: (total: number, byConversation: Record<string, number>) => void
  showInAppToast: (toast: InAppToast) => void
  dismissInAppToast: () => void
}

export const useNotificationsStore = create<NotificationState>((set) => ({
  unread: { total: 0, byConversation: {} },
  inAppToast: null,
  incrementUnread: (conversationId) =>
    set((s) => ({
      unread: {
        total: s.unread.total + 1,
        byConversation: {
          ...s.unread.byConversation,
          [conversationId]: (s.unread.byConversation[conversationId] || 0) + 1,
        },
      },
    })),
  clearUnread: (conversationId) =>
    set((s) => {
      const convCount = s.unread.byConversation[conversationId] || 0
      const newByConv = { ...s.unread.byConversation }
      delete newByConv[conversationId]
      return {
        unread: {
          total: Math.max(0, s.unread.total - convCount),
          byConversation: newByConv,
        },
      }
    }),
  clearAll: () => set({ unread: { total: 0, byConversation: {} } }),
  setUnread: (total, byConversation) => set({ unread: { total, byConversation } }),
  showInAppToast: (toast) => set({ inAppToast: toast }),
  dismissInAppToast: () => set({ inAppToast: null }),
}))

// ============================================================================
// Brand notification sound — Web Audio API, no external files.
// A soft two-tone "ding" with a gentle attack + exponential decay.
// Resumed on first user interaction (browsers require a user gesture
// before allowing AudioContext to start).
// ============================================================================
// v13.3 (audit Cluster F): use the shared singleton AudioContext.
let audioContext: AudioContext | null = null

function ensureAudioContext(): AudioContext | null {
  audioContext = getSharedAudioContext()
  return audioContext
}

function playNotificationSound() {
  // FIX (Phase 5): respect the user's "soundsEnabled" setting from settings-view.
  // Previously this flag was stored in localStorage but never checked — the
  // sound played regardless of the user's preference.
  if (typeof window !== 'undefined' && localStorage.getItem('999pro-sounds-enabled') === 'false') {
    return
  }
  const ctx = ensureAudioContext()
  if (!ctx) return
  try {
    const now = ctx.currentTime

    // Tone 1 — soft mid-high (E6, ~1318 Hz) with quick attack + exponential decay.
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.frequency.value = 1318
    osc1.type = 'sine'
    gain1.gain.setValueAtTime(0, now)
    gain1.gain.linearRampToValueAtTime(0.22, now + 0.015)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.4)

    // Tone 2 — higher harmonic (A6, ~1760 Hz) — arrives ~120ms later for a
    // pleasant "ding-dong" feel rather than a single beep.
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.frequency.value = 1760
    osc2.type = 'sine'
    gain2.gain.setValueAtTime(0, now + 0.12)
    gain2.gain.linearRampToValueAtTime(0.18, now + 0.135)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.12)
    osc2.stop(now + 0.55)
  } catch {
    // AudioContext unavailable — silent fallback
  }
}

// v11-fix: export so providers.tsx can play the sound when handling
// PUSH_SUPPRESSED_IN_APP messages from the SW (fallback when socket
// was briefly disconnected but the app is still visible).
export { playNotificationSound }

// Unlock AudioContext on first user gesture (mobile browsers require this).
//
// F-HIGH-009 fix: previously these listeners were registered at MODULE LOAD
// time (top-level side effect). That meant:
//   - Listeners were attached even for anonymous visitors who never log in
//     (waste of memory + prevents the page from being eligible for bfcache
//     restoration in some browsers).
//   - The cleanup `removeEventListener` calls inside `unlock` only ran AFTER
//     the first gesture fired — so for the entire session before the first
//     tap, three listeners sat on `window` forever.
//   - There was no path to release the AudioContext on logout.
//
// Now the listeners are registered inside `useNotifications` via useEffect,
// gated on `authed`. On logout the effect cleans up both the listeners AND
// closes the AudioContext (freeing its OS audio resources).
// ============================================================================

// ============================================================================
// Helper: build a human-readable preview of the message body.
// ============================================================================
function buildBody(m: Message): string {
  if (m.content) return m.content
  if (m.mediaType === 'image') return '📷 Фото'
  if (m.mediaType === 'video') return '🎥 Видео'
  if (m.mediaType === 'audio') return '🎤 Голосовое сообщение'
  if (m.mediaType === 'file') return '📎 Файл'
  if (m.mediaType === 'product') return '🛍 Товар'
  return 'Новое сообщение'
}

// ============================================================================
// Helper: resolve an absolute URL for the sender avatar so it can be used
// as the notification icon.
// ============================================================================
function resolveAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null
  if (avatar.startsWith('http')) return avatar
  if (avatar.startsWith('/uploads/')) {
    if (typeof window !== 'undefined' && window.location.hostname.endsWith('.space-z.ai')) {
      return `${avatar}?XTransformPort=4000`
    }
    return `${process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000'}${avatar}`
  }
  return null
}

interface UseNotificationsOptions {
  activeConversationId?: string | null
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { activeConversationId } = options
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const authed = isAuthenticated || (!!token && !!user)
  const conversationsRef = useRef<Conversation[]>([])
  const activeConvRef = useRef<string | null>(activeConversationId || null)
  const incrementUnread = useNotificationsStore((s) => s.incrementUnread)
  const showInAppToast = useNotificationsStore((s) => s.showInAppToast)

  useEffect(() => {
    activeConvRef.current = activeConversationId || null
  }, [activeConversationId])

  // F-HIGH-009: Register AudioContext-unlock listeners INSIDE the hook
  // (gated on `authed`) instead of at module load. This means anonymous
  // visitors don't pay the listener cost, and we can clean up on logout.
  // The effect re-runs whenever `authed` changes:
  //   - false → true (login): attach listeners, AudioContext is created on
  //     first user gesture.
  //   - true → false (logout): close + null-out the AudioContext so the
  //     browser can release the underlying OS audio resources. The next
  //     login will create a fresh context lazily.
  useEffect(() => {
    if (!authed) return

    const unlock = () => {
      ensureAudioContext()
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('click', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('touchstart', unlock, { once: true, passive: true })
    window.addEventListener('click', unlock, { once: true, passive: true })
    window.addEventListener('keydown', unlock, { once: true, passive: true })

    return () => {
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('click', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [authed])

  // F-HIGH-009: Release the AudioContext when the user logs out. Without
  // this the context lives for the lifetime of the page even though no
  // notifications will play until the next login. On Safari iOS each
  // suspended-but-not-closed context keeps a hardware audio graph alive.
  useEffect(() => {
    if (authed) return
    if (audioContext) {
      try {
        void audioContext.close()
      } catch {
        // Already closed — ignore
      }
      audioContext = null
    }
  }, [authed])

  // Load conversations for notification sender info
  useEffect(() => {
    if (!authed) return
    api
      .get<{ items: Conversation[] }>('/api/chat/conversations', { auth: true })
      .then((d) => {
        conversationsRef.current = d.items
      })
      .catch(() => {})
  }, [authed, token])

  // Handle incoming message — implements the 3-state notification policy.
  // Async because CASE 2 (background) may need to await navigator.serviceWorker.ready
  // for the iOS Safari fallback path.
  const handleIncomingMessage = useCallback(
    async (m: Message) => {
      // Skip own messages — we don't notify ourselves.
      if (m.senderId === user?.id) return

      const isActiveConv = activeConvRef.current === m.conversationId
      // Page visible = the tab is the active tab AND the document is visible.
      // When false → the app is in the background (tab switched or minimized).
      const isPageVisible =
        typeof document !== 'undefined' && document.visibilityState === 'visible'

      // Find conversation + sender info
      const conv = conversationsRef.current.find((c) => c.id === m.conversationId)
      const senderName =
        m.sender?.displayName ||
        m.sender?.username ||
        conv?.participant?.displayName ||
        conv?.participant?.username ||
        'Пользователь'
      const senderAvatar = resolveAvatarUrl(
        m.sender?.avatar || conv?.participant?.avatar || null,
      )
      const body = buildBody(m)

      // -------- CASE 1: user is actively reading this conversation --------
      // Silent: just append the message to the chat (chat.tsx handles that
      // via its own socket listener). No badge, no sound, no toast, no push.
      if (isActiveConv && isPageVisible) {
        return
      }

      // For ALL other cases we increment the unread badge so the chat list
      // card + bottom nav reflect the new message immediately.
      incrementUnread(m.conversationId)

      // -------- CASE 2: app is in the background (tab hidden / minimized) --------
      // Send a system Push via the Service Worker. The OS will play its own
      // notification sound + vibrate. We do NOT play our Web Audio sound here
      // because the user is not looking at the screen anyway, and the system
      // notification is more reliable for background delivery.
      //
      // STABILITY FIX: we use BOTH the SW postMessage path AND the page-side
      // Notification API as a fallback. The SW path is more reliable but only
      // works if the SW is active. The page-side path works as long as the
      // tab is alive (even if throttled). Belt + suspenders.
      //
      // iOS SAFARI: page-side `new Notification()` is silently ignored — iOS
      // requires SW-displayed notifications. So on iOS we MUST wait for SW
      // ready before falling back. We race a 3s timeout so we don't hang.
      if (!isPageVisible) {
        let swDelivered = false
        if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
          try {
            // UNIQUE TAG PER MESSAGE — was `msg-${m.conversationId}` which
            // caused the OS to replace previous notifications from the same
            // conversation. A user receiving 5 rapid messages only saw the
            // last one. Now each message has its own tag and renotify:true
            // so each one re-alerts the user.
            const uniqueTag = `msg-${m.conversationId}-${m.id}`
            navigator.serviceWorker.controller.postMessage({
              type: 'SHOW_NOTIFICATION',
              title: senderName,
              body,
              icon: senderAvatar || '/icons/icon-192.png',
              tag: uniqueTag,
              data: { url: '/?view=chat', conversationId: m.conversationId, messageId: m.id },
              renotify: true,
            })
            swDelivered = true
          } catch {
            // SW postMessage failed — fall back below
          }
        }
        // Always also try page-side Notification as fallback:
        // - If SW path failed
        // - If tab is alive but throttled (SW might not fire immediately)
        // - On iOS: skip the fallback (it's a no-op there) and instead wait
        //   for SW.ready (with timeout) so we don't silently drop the notif.
        if (!swDelivered) {
          const isIOS = typeof navigator !== 'undefined' &&
            /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.userAgent.includes('Macintosh') && 'ontouchend' in document)
          if (isIOS && 'serviceWorker' in navigator) {
            // iOS — wait for SW to be ready, then postMessage. The 3s timeout
            // ensures we don't hang if the SW is broken.
            try {
              const reg = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise<null>((_, reject) =>
                  setTimeout(() => reject(new Error('sw-ready-timeout')), 3000),
                ),
              ])
              if (reg) {
                const uniqueTag = `msg-${m.conversationId}-${m.id}`
                reg.active?.postMessage({
                  type: 'SHOW_NOTIFICATION',
                  title: senderName,
                  body,
                  icon: senderAvatar || '/icons/icon-192.png',
                  tag: uniqueTag,
                  data: { url: '/?view=chat', conversationId: m.conversationId, messageId: m.id },
                  renotify: true,
                })
              }
            } catch {
              // SW not ready — silent. The backend's Web Push (if subscribed)
              // will still fire the OS-level notification via the `push` event.
            }
          } else {
            showPageNotification(senderName, body, senderAvatar, m.conversationId, m.id)
          }
        }
        return
      }

      // -------- CASE 3: app is open, but user is in a DIFFERENT view --------
      // Show an in-app toast (top card).
      // NO system push (the user can already see the screen).
      // Sound is played by the unified notification system via the
      // `sound: 'message'` option when the toast is forwarded.
      showInAppToast({
        id: `toast-${m.id}-${Date.now()}`,
        conversationId: m.conversationId,
        senderName,
        senderAvatar: senderAvatar || null,
        body,
        createdAt: Date.now(),
      })
    },
    [user?.id, incrementUnread, showInAppToast],
  )

  // Connect to socket for notifications (reuses the shared singleton)
  useSocket({
    enabled: authed,
    onMessage: handleIncomingMessage,
  })

  // Request notification permission on first user interaction.
  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return false
    if (Notification.permission === 'granted') return true
    try {
      const result = await Notification.requestPermission()
      return result === 'granted'
    } catch {
      return false
    }
  }, [])

  return {
    requestPermission,
    notificationPermission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  }
}

// ============================================================================
// Page-side Notification fallback (used when no SW controller is available).
// SW notifications are preferred because they work even when the tab is
// throttled / backgrounded; this is the safety net.
// ============================================================================
function showPageNotification(
  title: string,
  body: string,
  icon: string | null,
  conversationId: string,
  messageId?: string,
) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    // Unique tag per message — same fix as the SW path. Was `msg-${conversationId}`
    // which caused the OS to replace previous notifications from the same
    // conversation. Now each message gets its own tag + renotify:true.
    const tag = `msg-${conversationId}-${messageId || Date.now()}`
    const notification = new Notification(title, {
      body,
      icon: icon || '/icons/icon-192.png',
      badge: '/icons/icon-192-maskable.png',
      tag,
      data: { conversationId, messageId, url: '/?view=chat' },
      vibrate: [120, 60, 120],
      requireInteraction: false,
      renotify: true,
      silent: false,
    } as NotificationOptions & { vibrate?: number[]; renotify?: boolean })

    notification.onclick = () => {
      window.focus()
      notification.close()
      window.dispatchEvent(
        new CustomEvent('notification:click', {
          detail: { conversationId },
        }),
      )
      try {
        const url = new URL(window.location.href)
        url.searchParams.set('view', 'chat')
        window.history.pushState({}, '', url.toString())
      } catch {
        // history API unavailable — ignore
      }
    }

    // Auto-close after 6 seconds.
    setTimeout(() => {
      try { notification.close() } catch { /* already closed */ }
    }, 6000)
  } catch {
    // Notification construction failed — silent fallback
  }
}
