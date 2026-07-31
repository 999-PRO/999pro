'use client'

// ============================================================================
//  Badge API — set/clear the app icon badge (unread count) like Telegram/WhatsApp.
//
//  Support:
//    • Chrome/Edge on Android (fully supported)
//    • Safari on iOS 16.4+ (when installed as PWA)
//    • Desktop browsers (no-op, no crash)
//
//  Usage:
//    import { setAppBadge, clearAppBadge } from '@/lib/badge'
//    setAppBadge(unreadCount)   // shows "5" on the app icon
//    clearAppBadge()            // removes the badge
// ============================================================================

/** Set the app badge to a number. Pass 0 to clear. */
export async function setAppBadge(count: number): Promise<void> {
  if (typeof navigator === 'undefined') return
  // Cast to access setAppBadge (not in the default TS lib).
  const nav = navigator as unknown as { setAppBadge?: (n?: number) => Promise<void> }
  if (typeof nav.setAppBadge !== 'function') return
  try {
    if (count <= 0) {
      await nav.setAppBadge()
    } else {
      await nav.setAppBadge(count)
    }
  } catch {
    // Some browsers throw if the permission wasn't granted — silent fail.
  }
}

/** Clear the app badge. */
export async function clearAppBadge(): Promise<void> {
  if (typeof navigator === 'undefined') return
  const nav = navigator as unknown as { clearAppBadge?: () => Promise<void> }
  if (typeof nav.clearAppBadge !== 'function') return
  try {
    await nav.clearAppBadge()
  } catch {
    // Silent fail.
  }
}
