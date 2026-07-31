'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ============================================================================
//  PullToRefresh — single-stage pull-down-to-refresh (v12.6.2).
//
//  v12.6.2: simplified back to single-stage. The two-stage gesture (stage 1
//  = search reveal, stage 2 = refresh) has been removed because the search
//  bar is now ALWAYS VISIBLE in normal flow (no gesture needed to reveal it).
//  PTR is now a clean, simple pull-to-refresh: pull down ≥ 80px → refresh.
//
//  Mechanics:
//    • Only activates when `scrollTop === 0` (page at very top).
//    • Rubber-band resistance (quadratic) — feels like iOS UIScrollView.
//    • Content is translated via `position: relative; top: Npx` (NOT
//      transform — transform would break position:fixed descendants like
//      ProductPage/StudioView/CallScreen, fixed in v12.6.1).
//    • The MobileHeader (z-30, fixed) stays pinned at top — content slides
//      under it. The PTR spinner (z-20) appears BELOW the header.
//    • suppress()/unsuppress() on window.__ptr lets modals (ProductPage)
//      disable PTR while they're open — prevents drag-to-close from
//      triggering a refresh.
//
//  Architecture:
//    • Mount ONCE in AppShell, wraps <main>.
//    • Touch handlers are passive — they read touch positions but never
//      preventDefault (no conflict with browser scroll or other handlers).
//    • The `refreshing` getter on `window.__ptr` lets other components
//      check PTR state.
// ============================================================================

const REFRESH_THRESHOLD = 80 // px — trigger refresh (spec: 80-100px)
const MAX_PULL = 180 // px — clamp pull distance (rubber band)
const REFRESH_HEIGHT = 64 // px — content translateY during refresh
const MIN_REFRESH_MS = 600 // ms — minimum visible refresh duration
const MAX_REFRESH_MS = 4000 // ms — hard timeout (in case subscribers hang)

interface PullState {
  /** Current pull distance in px (0 = at rest, positive = pulled down). */
  pull: number
  /** True while a refresh is in progress (logo spinning, content pinned). */
  refreshing: boolean
}

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PullState>({
    pull: 0,
    refreshing: false,
  })
  // Touch tracking refs — avoid re-renders during touchmove.
  const startYRef = useRef<number | null>(null)
  const currentPullRef = useRef(0)
  const refreshingRef = useRef(false)
  const refreshStartedAtRef = useRef(0)
  // v12.6.1: suppression flag — when true, PTR ignores ALL touch events.
  // Used by ProductPage (and any other modal/sheet) to prevent the
  // drag-to-close gesture from propagating to PTR and triggering a
  // page refresh. ProductPage calls window.__ptr.suppress() on mount
  // and window.__ptr.unsuppress() on unmount.
  const suppressedRef = useRef(false)
  // Subscriber counter — subscribers increment on refresh start, decrement
  // when done. PTR resolves when counter returns to 0.
  const subscriberCountRef = useRef(0)
  // v13.0 (audit P0-6 fix): track refresh fallback timers so we can clear
  // them on unmount. Previously the hard-timeout + min-duration fallback
  // setTimeout calls had no cleanup — if the component unmounted mid-
  // refresh, they fired `resolveRefresh()` on a detached DOM node.
  const maxTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const minTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the actual <main> element to translate. We find it by id rather
  // than wrapping children in a div — wrapping would break layout assumptions
  // in some children (e.g. AnimatePresence siblings, position: sticky).
  const mainRef = useRef<HTMLElement | null>(null)

  // Find the <main> element after mount. AppShell renders <main id="main-content">.
  useEffect(() => {
    mainRef.current = document.getElementById('main-content')
  }, [])

  const applyTranslate = useCallback((y: number) => {
    const main = mainRef.current
    if (!main) return
    // v12.6.1: CRITICAL — use `position: relative; top: Npx` instead of
    // `transform: translateY(Npx)`. transform creates a containing block for
    // position:fixed descendants, breaking ProductPage/StudioView/CallScreen.
    // `position: relative` does NOT create a containing block for fixed
    // descendants, so overlays remain anchored to the viewport.
    if (y === 0) {
      main.style.position = ''
      main.style.top = ''
    } else {
      main.style.position = 'relative'
      main.style.top = `${y}px`
    }
  }, [])

  // ── Refresh lifecycle ────────────────────────────────────────────────────
  // resolveRefresh is declared BEFORE startRefresh because startRefresh's
  // setTimeout closures reference it. (const is not hoisted.)
  const resolveRefresh = useCallback(() => {
    if (!refreshingRef.current) return
    refreshingRef.current = false
    currentPullRef.current = 0
    setState({ pull: 0, refreshing: false })
    applyTranslate(0)
  }, [applyTranslate])

  const startRefresh = useCallback(() => {
    refreshingRef.current = true
    refreshStartedAtRef.current = Date.now()
    subscriberCountRef.current = 0
    setState({ pull: REFRESH_HEIGHT, refreshing: true })
    applyTranslate(REFRESH_HEIGHT)
    // Notify subscribers. Subscribers call `usePullToRefreshSubscription()`
    // which increments the counter on start and decrements on done.
    window.dispatchEvent(new CustomEvent('999pro:refresh'))
    // Hard timeout — never hang the UI if a subscriber forgets to call done.
    if (maxTimeoutRef.current) clearTimeout(maxTimeoutRef.current)
    maxTimeoutRef.current = setTimeout(() => {
      maxTimeoutRef.current = null
      if (refreshingRef.current) {
        resolveRefresh()
      }
    }, MAX_REFRESH_MS)
    // Min-duration fallback — if no subscribers register, resolve after min.
    if (minTimeoutRef.current) clearTimeout(minTimeoutRef.current)
    minTimeoutRef.current = setTimeout(() => {
      minTimeoutRef.current = null
      if (refreshingRef.current && subscriberCountRef.current === 0) {
        resolveRefresh()
      }
    }, MIN_REFRESH_MS)
  }, [applyTranslate, resolveRefresh])

  // Expose resolveRefresh + counter via a global so subscribers can signal
  // completion. We attach to window because subscribers are spread across
  // many components and importing a shared module creates cycles.
  useEffect(() => {
    const api = {
      /** Called by a subscriber when it STARTS refreshing (counter++). */
      start: () => {
        subscriberCountRef.current += 1
      },
      /** Called by a subscriber when it FINISHES refreshing (counter--).
       *  When counter hits 0 AND min duration elapsed, PTR resolves. */
      done: () => {
        subscriberCountRef.current = Math.max(0, subscriberCountRef.current - 1)
        if (
          subscriberCountRef.current === 0 &&
          Date.now() - refreshStartedAtRef.current >= MIN_REFRESH_MS
        ) {
          resolveRefresh()
        }
      },
      /** Read-only getter — true while a refresh is in progress. */
      get refreshing() {
        return refreshingRef.current
      },
      /** v12.6.1: Suppress PTR — call when a modal/sheet (e.g. ProductPage)
       *  is open. PTR will ignore ALL touch events until unsuppress() is
       *  called. Prevents the drag-to-close gesture on the product sheet
       *  from propagating to PTR and triggering a page refresh. */
      suppress: () => {
        suppressedRef.current = true
        // If a pull was in progress, snap back immediately.
        if (currentPullRef.current !== 0) {
          currentPullRef.current = 0
          applyTranslate(0)
          setState({ pull: 0, refreshing: false })
        }
      },
      /** v12.6.1: Unsuppress PTR — call when the modal/sheet closes.
       *  PTR resumes normal gesture handling. */
      unsuppress: () => {
        suppressedRef.current = false
      },
    }
    ;(window as unknown as { __ptr?: typeof api }).__ptr = api
    return () => {
      delete (window as unknown as { __ptr?: typeof api }).__ptr
    }
  }, [resolveRefresh])

  // ── Touch handlers ──────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Skip PTR on desktop (no touch input) — but still allow it for hybrid
    // devices. We detect "pointer: coarse" via matchMedia which is true for
    // touch-only devices. Desktops with mouse/trackpad won't trigger PTR.
    const isTouchDevice =
      window.matchMedia('(pointer: coarse)').matches ||
      'ontouchstart' in window
    if (!isTouchDevice) return

    const onTouchStart = (e: TouchEvent) => {
      // v12.6.1: if suppressed (e.g. ProductPage is open), ignore ALL touches.
      if (suppressedRef.current) return
      if (refreshingRef.current) return
      // Only start tracking if the page is at the very top.
      const scrollY =
        document.documentElement.scrollTop || document.body.scrollTop || 0
      if (scrollY > 0) {
        startYRef.current = null
        return
      }
      startYRef.current = e.touches[0]?.clientY ?? null
    }

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || refreshingRef.current) return
      const currentY = e.touches[0]?.clientY ?? startYRef.current
      const delta = currentY - startYRef.current
      if (delta <= 0) {
        // User is scrolling up — reset.
        if (currentPullRef.current !== 0) {
          currentPullRef.current = 0
          applyTranslate(0)
          setState((s) => ({ ...s, pull: 0 }))
        }
        return
      }
      // Quadratic resistance — feels like iOS rubber band.
      const raw = Math.min(MAX_PULL, delta)
      const resisted = Math.round(raw * (1 - raw / (MAX_PULL * 2.5)))
      if (resisted === currentPullRef.current) return
      currentPullRef.current = resisted
      applyTranslate(resisted)
      setState((s) => ({ ...s, pull: resisted }))
    }

    const onTouchEnd = () => {
      if (startYRef.current === null) return
      startYRef.current = null
      const pull = currentPullRef.current
      if (pull >= REFRESH_THRESHOLD) {
        // Trigger refresh.
        startRefresh()
      } else {
        // Snap back — animate top → 0 via CSS transition.
        currentPullRef.current = 0
        setState((s) => ({ ...s, pull: 0 }))
        const main = mainRef.current
        if (main) {
          main.style.transition = 'top 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
          main.style.position = 'relative'
          main.style.top = '0px'
          setTimeout(() => {
            if (main && !refreshingRef.current) {
              main.style.transition = 'none'
              main.style.position = ''
              main.style.top = ''
            }
          }, 250)
        }
      }
    }

    const onTouchCancel = () => {
      if (startYRef.current === null) return
      startYRef.current = null
      if (!refreshingRef.current) {
        currentPullRef.current = 0
        setState((s) => ({ ...s, pull: 0 }))
        applyTranslate(0)
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
      // v13.0 (audit P0-6 fix): clear any pending refresh fallback timers
      // so they don't fire resolveRefresh() on a detached DOM node.
      if (maxTimeoutRef.current) { clearTimeout(maxTimeoutRef.current); maxTimeoutRef.current = null }
      if (minTimeoutRef.current) { clearTimeout(minTimeoutRef.current); minTimeoutRef.current = null }
    }
  }, [applyTranslate, startRefresh])

  // ── Render ──────────────────────────────────────────────────────────────
  const pull = state.pull
  const refreshing = state.refreshing
  // Spinner opacity: ramps up as pull approaches the threshold.
  const spinnerOpacity =
    refreshing || pull >= REFRESH_THRESHOLD
      ? Math.min(1, (pull - REFRESH_THRESHOLD) / 30 + 0.3)
      : 0
  // Spinner rotation during pull (not refreshing): proportional to pull
  // beyond the refresh threshold. During refresh: continuous spin.
  const rotation = refreshing ? 0 : Math.max(0, (pull - REFRESH_THRESHOLD) * 2)
  // Indicator translateY: sits at top of content, moves with it.
  const indicatorTop = refreshing ? 0 : Math.max(0, pull - REFRESH_HEIGHT)

  return (
    <>
      {/* PTR spinner — fixed below the mobile header. z-20 so the
          MobileHeader (z-30) stays above it. Pointer-events: none so it
          doesn't block taps on the underlying content. */}
      <div
        aria-hidden={spinnerOpacity < 0.1}
        className="md:hidden fixed left-0 right-0 z-20 grid place-items-center pointer-events-none"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 3.25rem)',
          height: `${REFRESH_HEIGHT}px`,
          transform: `translateY(${indicatorTop}px)`,
          opacity: spinnerOpacity,
          transition: refreshing ? 'opacity 0.2s ease' : 'opacity 0.1s linear',
        }}
      >
        <PullSpinner rotating={refreshing} rotation={rotation} />
      </div>
      {children}
    </>
  )
}

// ── PullSpinner — brand "999" logo + ring ────────────────────────────────
function PullSpinner({ rotating, rotation }: { rotating: boolean; rotation: number }) {
  return (
    <div className="relative grid place-items-center" style={{ width: 44, height: 44 }}>
      {/* Ring — brand blue top arc */}
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        className={rotating ? 'ptr-spin' : ''}
        style={{
          transform: rotating ? undefined : `rotate(${rotation}deg)`,
          transition: rotating ? 'none' : 'transform 0.05s linear',
        }}
      >
        {/* Track */}
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeOpacity="0.18"
          strokeWidth="3"
        />
        {/* Brand blue arc (~25% of circle) */}
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="28 113"
          transform="rotate(-90 22 22)"
        />
      </svg>
      {/* "999" wordmark — brand gradient */}
      <span
        className="absolute font-extrabold text-[11px] tracking-tight leading-none bg-clip-text text-transparent select-none"
        style={{ backgroundImage: 'var(--gradient-brand)' }}
      >
        999
      </span>
      <style jsx>{`
        @keyframes ptr-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .ptr-spin {
          animation: ptr-spin 0.8s linear infinite;
          transform-origin: center;
        }
      `}</style>
    </div>
  )
}

// ============================================================================
//  usePullToRefreshSubscription — helper for subscribers.
//
//  Subscribers (SmartBlocks, ProductsGrid, etc.) call this hook to register
//  their refresh logic. The hook:
//    1. Listens for the `999pro:refresh` window event.
//    2. On event: calls the subscriber's `onRefresh` callback.
//    3. The callback should return a Promise. The hook:
//         - calls `window.__ptr.start()` BEFORE invoking the callback
//         - calls `window.__ptr.done()` AFTER the promise settles
//    4. This lets the PTR know when ALL subscribers have finished.
// ============================================================================
export function usePullToRefreshSubscription(
  onRefresh: () => Promise<void>,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const handler = () => {
      const ptr = (window as unknown as { __ptr?: { start: () => void; done: () => void } }).__ptr
      ptr?.start()
      onRefresh().finally(() => {
        ptr?.done()
      })
    }
    window.addEventListener('999pro:refresh', handler)
    return () => window.removeEventListener('999pro:refresh', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
