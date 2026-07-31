'use client'

// ============================================================================
//  Haptic feedback utility — wraps navigator.vibrate with safe fallbacks.
//
//  Patterns are tuned to feel "native" — short for taps, longer for
//  success/warning/error, and a double-pulse for selection changes.
//
//  Usage:
//    import { haptic } from '@/lib/haptic'
//    haptic.tap()         // 10ms — button taps, link clicks
//    haptic.select()      // 20ms — selecting an item from a list
//    haptic.success()     // [10,40,30] — add to cart, send message
//    haptic.warning()     // [20,30,20] — destructive confirm dialog
//    haptic.error()       // [50,30,50,30,50] — error toast, login failure
//    haptic.heavy()       // 30ms — long-press, context menu open
//
//  Respects user preference:
//    • No-op on desktop browsers (no vibration API)
//    • No-op if the user has disabled haptics in Settings
//    • Graceful degrade on iOS Safari (Vibration API not supported on iOS —
//      the calls are silently ignored, no error thrown)
// ============================================================================

const HAPTICS_ENABLED_KEY = '999pro-haptics-enabled'

function hapticsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
  try {
    const raw = window.localStorage.getItem(HAPTICS_ENABLED_KEY)
    // Default: enabled (null = first-time user → enabled)
    if (raw === 'false') return false
    return true
  } catch {
    return false
  }
}

function vibrate(pattern: number | number[]): void {
  if (!hapticsEnabled()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Some browsers throw on certain patterns — silently ignore.
  }
}

export const haptic = {
  /** Light tap — button presses, link clicks, icon taps. 10ms. */
  tap() {
    vibrate(10)
  },
  /** Medium — selecting an item from a list, tab change. 20ms. */
  select() {
    vibrate(20)
  },
  /** Heavier — long-press, context menu open, drag start. 30ms. */
  heavy() {
    vibrate(30)
  },
  /** Success pattern — add to cart, send message, login OK. [10,40,30] */
  success() {
    vibrate([10, 40, 30])
  },
  /** Warning — destructive confirm dialog, undo toast. [20,30,20] */
  warning() {
    vibrate([20, 30, 20])
  },
  /** Error — login failure, network error, validation error. [50,30,50,30,50] */
  error() {
    vibrate([50, 30, 50, 30, 50])
  },
}

/** Toggle haptics on/off. Persists in localStorage. */
export function setHapticsEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HAPTICS_ENABLED_KEY, enabled ? 'true' : 'false')
  } catch {}
  // Test pulse when enabling so the user feels it work.
  if (enabled) haptic.success()
}

/** Check if haptics are currently enabled (for Settings UI). */
export function isHapticsEnabled(): boolean {
  return hapticsEnabled()
}
