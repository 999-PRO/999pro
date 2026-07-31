'use client'

// ============================================================================
//  Wake Lock — prevents the screen from turning off during video calls or
//  product viewing. Like native apps that keep the screen on during playback.
//
//  Support: Chrome/Edge Android, Safari iOS 16.4+, desktop browsers.
//
//  Usage:
//    import { requestWakeLock, releaseWakeLock } from '@/lib/wake-lock'
//    await requestWakeLock()  // screen stays on
//    releaseWakeLock()        // allow screen to sleep again
// ============================================================================

let wakeLockSentinel: { release: () => Promise<void> } | null = null

/** Request a screen wake lock. Returns true if acquired. */
export async function requestWakeLock(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false
  // Cast to access wakeLock (not in the default TS lib).
  const nav = navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }
  if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') return false
  try {
    wakeLockSentinel = await nav.wakeLock.request('screen')
    return true
  } catch {
    return false
  }
}

/** Release the wake lock (allow screen to sleep). */
export async function releaseWakeLock(): Promise<void> {
  if (!wakeLockSentinel) return
  try {
    await wakeLockSentinel.release()
  } catch {
    // Silent fail.
  }
  wakeLockSentinel = null
}

/** Re-acquire the wake lock if the page becomes visible again (the lock
 *  is automatically released when the page is hidden / screen locks). */
export async function handleVisibilityChange(): Promise<void> {
  if (typeof document === 'undefined') return
  if (document.visibilityState === 'visible' && !wakeLockSentinel) {
    await requestWakeLock()
  }
}
