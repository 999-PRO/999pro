'use client'

// ============================================================================
// Unified Notification Manager — single source of truth for ALL toasts
// across the entire 999 — Три девятки app (frontend + studio).
//
// DESIGN PRINCIPLES:
//   1. ONE toast at a time. A new toast REPLACES the current one — never
//      stacks, never overlaps, never queues. The previous toast exits with
//      a 150ms exit animation while the new one enters.
//   2. DEDUPLICATION. Call `toast.success('Saved', { key: 'save-product' })`
//      twice → the existing toast's content is updated and its timer is
//      restarted, instead of creating a duplicate.
//   3. IMPERATIVE API. The `toast` export is a module-level object with
//      `success/error/info/warning/restriction/dismiss` methods. It can be
//      called from React components, socket handlers, SW postMessage bridges,
//      setTimeout callbacks, etc. — no React context required.
//   4. UNIFIED DESIGN. One React component (<NotificationContainer />)
//      renders the toast with glassmorphism, dark/light theme support,
//      framer-motion enter/exit animations, and consistent spacing.
//   5. CONSISTENT TIMING. Default duration: 4000ms (success/info/warning),
//      6000ms (error/restriction). User can always dismiss manually.
//   6. NO PERFORMACE IMPACT. The store holds a single toast object. Only
//      one re-render per show/dismiss — no array diffs, no lists.
//
// USAGE:
//   import { toast } from '@/lib/notifications'
//   toast.success('Product saved')
//   toast.error('Failed to save', { description: 'Network error' })
//   toast.warning('Almost out of stock')
//   toast.info('New version available')
//   toast.restriction('Premium required', { description: 'Upgrade to Pro' })
//
//   // Deduplicate by key (e.g., user clicks "Save" 5x rapidly):
//   toast.success('Saved', { key: 'save-action' })
//
//   // Dismiss manually:
//   toast.dismiss()
// ============================================================================

import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning' | 'restriction'

export interface ToastOptions {
  /** Optional description shown below the title. */
  description?: string
  /** Optional deduplication key. If a toast with the same key is currently
   *  visible, its content is updated and its timer is restarted — no new
   *  toast is created. */
  key?: string
  /** Auto-dismiss duration in ms. Default: 4000 (info/success/warning),
   *  6000 (error/restriction). Pass `Infinity` to disable auto-dismiss. */
  duration?: number
  /** Optional callback when user taps the toast body. */
  onClick?: () => void
  /** Optional action button label + callback. */
  action?: {
    label: string
    onClick: () => void
  }
  /** Optional media (avatar) shown on the left instead of the variant icon.
   *  Used by chat-message notifications to display the sender's avatar. */
  media?: {
    type: 'avatar'
    src?: string | null
    fallbackName: string
  }
  /** Sound to play when the toast is shown. Defaults to a sound matching
   *  the variant: success → sounds.success, error → sounds.error,
   *  warning → sounds.warning, info → sounds.notify, restriction → sounds.warning.
   *  Pass a custom sound key (e.g. 'cart', 'order', 'club', 'adminReply',
   *  'message', 'notify') to override. Pass `null` to silence. */
  sound?: SoundKey | null
}

/** Sound keys mapped to the sounds library. */
export type SoundKey =
  | 'tap'
  | 'send'
  | 'message'
  | 'like'
  | 'cart'
  | 'success'
  | 'order'
  | 'club'
  | 'warning'
  | 'error'
  | 'notify'
  | 'adminReply'

interface ToastData {
  id: string
  variant: ToastVariant
  title: string
  description?: string
  key?: string
  duration: number
  onClick?: () => void
  action?: { label: string; onClick: () => void }
  media?: {
    type: 'avatar'
    src?: string | null
    fallbackName: string
  }
  sound?: SoundKey | null
  // Internal: timestamp when shown, used for the progress bar
  shownAt: number
}

interface NotificationStore {
  // The single currently-visible toast. null when no toast is shown.
  // During transition (replace), this becomes the NEW toast immediately —
  // the old one is gone before the new one fades in.
  current: ToastData | null
  // Internal: monotonically increasing counter for animation key. Bumps
  // every time a new toast is shown, even if `current` is replaced with
  // identical content — so framer-motion always plays the enter animation.
  cycle: number
  // Show a new toast. If `key` matches the current toast's key, update
  // in place and restart the timer. Otherwise, replace the current toast.
  show: (variant: ToastVariant, title: string, opts?: ToastOptions) => void
  // Dismiss the current toast immediately.
  dismiss: () => void
}

// Default durations (ms). Errors get more time to read.
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
  restriction: 6000,
}

// Default sound for each variant (when `sound` option is not provided).
const DEFAULT_SOUND: Record<ToastVariant, SoundKey> = {
  success: 'success',
  info: 'notify',
  warning: 'warning',
  error: 'error',
  restriction: 'warning',
}

// Lazy-loaded sounds module to avoid circular dependency at module-init time.
// (sounds.ts → audio-context.ts → no reverse dep, but lazy is safer.)
let soundsModule: typeof import('@/lib/sounds')['sounds'] | null = null
async function playSoundForKey(key: SoundKey): Promise<void> {
  try {
    if (!soundsModule) {
      const mod = await import('@/lib/sounds')
      soundsModule = mod.sounds
    }
    const fn = (soundsModule as Record<string, () => void>)[key]
    if (typeof fn === 'function') fn()
  } catch {
    // Sounds are non-critical — ignore failures (e.g., SSR, no AudioContext).
  }
}

let idCounter = 0
function nextId() {
  idCounter += 1
  return `toast-${Date.now()}-${idCounter}`
}

// Holder for the active auto-dismiss timer. Kept outside the store so the
// store stays serialisable and re-renders only on show/dismiss — not on
// every tick.
let dismissTimer: ReturnType<typeof setTimeout> | null = null

function clearDismissTimer() {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
}

function scheduleDismiss(store: NotificationStore, duration: number) {
  clearDismissTimer()
  if (duration === Infinity || duration <= 0) return
  dismissTimer = setTimeout(() => {
    store.dismiss()
  }, duration)
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  current: null,
  cycle: 0,
  show: (variant, title, opts = {}) => {
    const duration = opts.duration ?? DEFAULT_DURATION[variant]
    const id = nextId()
    // Resolve sound: explicit option > null (silence) > variant default
    const soundKey: SoundKey | null =
      opts.sound === undefined ? DEFAULT_SOUND[variant] : opts.sound
    const newToast: ToastData = {
      id,
      variant,
      title,
      description: opts.description,
      key: opts.key,
      duration,
      onClick: opts.onClick,
      action: opts.action,
      media: opts.media,
      sound: soundKey,
      shownAt: Date.now(),
    }
    const store = get()
    // Dedup: if same key, just update content + restart timer (no new animation cycle)
    if (
      store.current &&
      opts.key &&
      store.current.key === opts.key
    ) {
      set({
        current: { ...newToast, id: store.current.id }, // preserve id
        // Do NOT bump cycle on dedup — UI updates content in place
      })
    } else {
      // Replace: new toast, bump cycle for enter animation
      set({ current: newToast, cycle: store.cycle + 1 })
    }
    scheduleDismiss(get(), duration)
    // Play the corresponding sound (non-blocking, fire-and-forget).
    if (soundKey) {
      void playSoundForKey(soundKey)
    }
  },
  dismiss: () => {
    clearDismissTimer()
    set({ current: null })
  },
}))

// ============================================================================
// Imperative API — use this everywhere in the app.
// ============================================================================
export const toast = {
  success: (title: string, opts?: ToastOptions) =>
    useNotificationStore.getState().show('success', title, opts),
  error: (title: string, opts?: ToastOptions) =>
    useNotificationStore.getState().show('error', title, opts),
  info: (title: string, opts?: ToastOptions) =>
    useNotificationStore.getState().show('info', title, opts),
  warning: (title: string, opts?: ToastOptions) =>
    useNotificationStore.getState().show('warning', title, opts),
  restriction: (title: string, opts?: ToastOptions) =>
    useNotificationStore.getState().show('restriction', title, opts),
  /** Generic info toast (no variant). Equivalent to `toast.info()`. */
  message: (title: string, opts?: ToastOptions) =>
    useNotificationStore.getState().show('info', title, opts),
  /** Dismiss the current toast immediately. */
  dismiss: () => useNotificationStore.getState().dismiss(),
  /** Generic toast with explicit variant. Useful for dynamic dispatch. */
  show: (variant: ToastVariant, title: string, opts?: ToastOptions) =>
    useNotificationStore.getState().show(variant, title, opts),
}

// Type-only re-export for consumers that need the variant type
export type { ToastData }
