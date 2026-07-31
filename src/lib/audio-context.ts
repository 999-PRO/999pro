'use client'

// v13.3 (audit Cluster F): shared singleton AudioContext.
//
// Previously 4 separate files each opened their own AudioContext:
//   - lib/sounds.ts (already had sharedCtx — this file generalises it)
//   - lib/use-notifications.ts
//   - lib/use-ringtone.ts
//   - lib/use-message-sound.ts
//
// Each AudioContext consumes ~5-10MB of memory and holds an audio device
// handle. Browsers limit the number of concurrent contexts (Chrome: 6).
// With 4 contexts just for sound effects, the app was at 2/3 of the limit
// before any third-party library tries to play audio.
//
// Now all 4 files import from here. The context is created lazily on the
// first request and resumed if suspended (autoplay policy).

let sharedCtx: AudioContext | null = null

/**
 * Get the shared AudioContext, creating it if necessary.
 * Returns null if:
 *   - running on the server (typeof window === 'undefined')
 *   - the browser doesn't support Web Audio API
 *   - context creation fails (e.g. user has disabled audio)
 *
 * The context is auto-resumed if suspended (browsers start contexts in
 * suspended state until a user gesture triggers audio).
 */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!sharedCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      sharedCtx = new Ctor()
    } catch {
      return null
    }
  }
  // Auto-resume if suspended (autoplay policy — requires user gesture,
  // but resume() is a no-op if already running).
  if (sharedCtx.state === 'suspended') {
    void sharedCtx.resume()
  }
  return sharedCtx
}
