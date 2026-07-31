'use client'

// ============================================================================
// InAppNotificationToast — bridge between the chat-message notification
// pipeline (useNotificationsStore.inAppToast) and the unified NotificationContainer.
//
// HISTORY: this component used to render its own glass card with avatar +
// sender name + message body. That created a SECOND concurrent toast surface
// alongside Sonner — two toasts could appear at once (one from Sonner, one
// from this component) and visually overlap.
//
// v16.8 (unified notifications refactor): this component no longer renders
// anything. It subscribes to useNotificationsStore.inAppToast and forwards
// each new chat-message toast to the unified `toast.show()` API with a
// `media: { type: 'avatar', ... }` payload. The unified NotificationContainer
// renders the avatar card with the same glassmorphism styling as all other
// toasts — guaranteeing "only one toast on screen at a time".
//
// This component is still mounted at AppShell level so existing call sites
// (useNotificationsStore.showInAppToast) don't need to change.
// ============================================================================

import { useEffect, useRef } from 'react'
import { useNotificationsStore } from '@/lib/use-notifications'
import { toast } from '@/lib/notifications'

export function InAppNotificationToast() {
  const inAppToast = useNotificationsStore((s) => s.inAppToast)
  const dismissInAppToast = useNotificationsStore((s) => s.dismissInAppToast)
  // Track the last toast id we forwarded, so we don't re-fire on store re-renders.
  const lastForwardedId = useRef<string | null>(null)

  useEffect(() => {
    if (!inAppToast) return
    if (lastForwardedId.current === inAppToast.id) return
    lastForwardedId.current = inAppToast.id

    // Forward to the unified notification system.
    // Use a stable key so rapid messages from the same conversation update
    // the existing toast instead of stacking.
    toast.show('info', inAppToast.senderName, {
      description: inAppToast.body,
      key: `chat-msg-${inAppToast.conversationId}`,
      duration: 5000,
      sound: 'message',
      media: {
        type: 'avatar',
        src: inAppToast.senderAvatar,
        fallbackName: inAppToast.senderName,
      },
      onClick: () => {
        // Navigate to chat + open the right conversation
        window.dispatchEvent(
          new CustomEvent('notification:click', {
            detail: { conversationId: inAppToast.conversationId },
          }),
        )
        try {
          const url = new URL(window.location.href)
          url.searchParams.set('view', 'chat')
          window.history.pushState({}, '', url.toString())
        } catch {
          // history API unavailable — ignore
        }
        dismissInAppToast()
      },
    })
  }, [inAppToast, dismissInAppToast])

  // No rendering — the unified NotificationContainer handles the visual.
  return null
}
