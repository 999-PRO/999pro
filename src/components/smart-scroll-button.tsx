'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
//  SmartScrollButton — a floating ↑/↓ button that remembers scroll position.
//
//  v12.6.6 changes:
//    • Threshold lowered from 2 viewports to 0.8 — button appears after
//      a single swipe (one normal scroll gesture).
//    • Now supports custom scroll containers (e.g. chat message list).
//    • Supports inverted scroll containers (flex-col-reverse, like chat)
//      via the `reverse` prop.
//
//  Behavior:
//    1. Hidden when near the "home" position (top for normal, bottom for reverse).
//    2. After scrolling ~0.8 viewports away from home, the button appears (↑).
//    3. Tap ↑:
//       - Save the current scroll position.
//       - Smoothly scroll to the "beginning" (top for normal, max for reverse).
//       - Button flips to ↓.
//    4. Tap ↓:
//       - Smoothly scroll back to the SAVED position (exactly).
//       - Button flips back to ↑.
//    5. If the user scrolls further away (after returning), the saved
//       position updates automatically.
//    6. Single button, icon toggles between ↑ and ↓.
//
//  Two modes:
//    • Window mode (default): listens to window scroll. "Beginning" = top (y=0).
//    • Container mode (pass scrollContainerRef): listens to the container's
//      scroll. If `reverse` is true (chat's flex-col-reverse), "beginning"
//      = max scrollTop (oldest messages).
// ============================================================================

// Show the button after scrolling this many viewport heights away from home.
const SHOW_THRESHOLD_VH = 0.8
// Scroll animation duration in ms.
const SCROLL_DURATION_MS = 400
// Distance (px) from the saved position that counts as "still there".
const POSITION_UPDATE_THRESHOLD_PX = 100

type Direction = 'up' | 'down'

interface SmartScrollButtonProps {
  /** Optional: a ref to a scrollable container. If omitted, uses window. */
  scrollContainerRef?: React.RefObject<HTMLElement | null>
  /** For inverted containers (flex-col-reverse like chat). "Beginning" = max scrollTop. */
  reverse?: boolean
  // v25.7 (TZ ЭТАП 2.8): allow callers to override the z-index (and any
  // other utility classes). The product page sits at z-[350], so the
  // SmartScrollButton rendered for it must be at z-[360] to appear above.
  className?: string
}

export function SmartScrollButton({
  scrollContainerRef,
  reverse = false,
  className,
}: SmartScrollButtonProps = {}) {
  const [visible, setVisible] = useState(false)
  const [direction, setDirection] = useState<Direction>('up')
  const savedScrollRef = useRef<number>(0)
  const animatingRef = useRef(false)
  const lastScrollRef = useRef(0)
  const directionRef = useRef<Direction>('up')

  useEffect(() => { directionRef.current = direction }, [direction])

  // ── Get current scroll position and viewport height ─────────────────────
  const getScrollY = useCallback(() => {
    if (scrollContainerRef?.current) {
      return scrollContainerRef.current.scrollTop
    }
    return document.documentElement.scrollTop || document.body.scrollTop || 0
  }, [scrollContainerRef])

  const getViewportH = useCallback(() => {
    if (scrollContainerRef?.current) {
      return scrollContainerRef.current.clientHeight
    }
    return window.innerHeight || 800
  }, [scrollContainerRef])

  const getMaxScroll = useCallback(() => {
    if (scrollContainerRef?.current) {
      const el = scrollContainerRef.current
      return el.scrollHeight - el.clientHeight
    }
    return document.documentElement.scrollHeight - window.innerHeight
  }, [scrollContainerRef])

  // ── Scroll listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return

    const onScroll = () => {
      if (animatingRef.current) return
      const y = getScrollY()
      const vh = getViewportH()

      // v12.6.7 FIX: when direction is 'down' (we just scrolled to the
      // beginning and are waiting for the user to tap ↓ to go back), we
      // must NOT hide the button even though we're near the home position.
      // The button stays visible as ↓ until:
      //   - the user taps ↓ (goes back to saved position), OR
      //   - the user manually scrolls away from the beginning (flips to ↑)
      if (directionRef.current === 'down') {
        // If the user manually scrolled away from the beginning (not via
        // the ↓ button), flip back to ↑ so they can go to the beginning
        // again. Update the saved position to the current spot.
        if (y > vh * SHOW_THRESHOLD_VH) {
          setDirection('up')
          directionRef.current = 'up'
          savedScrollRef.current = y
          lastScrollRef.current = y
        }
        // Otherwise: stay visible as ↓. Do NOT hide, do NOT reset direction.
        return
      }

      // direction === 'up' — normal show/hide logic.
      if (y > vh * SHOW_THRESHOLD_VH) {
        setVisible(true)
      } else {
        // Near home — hide the button and reset direction to 'up'.
        setVisible(false)
        setDirection('up')
        directionRef.current = 'up'
      }

      // If the user is scrolling further away from home (scrollTop increasing),
      // update the saved position so the next ↑→↓ returns to the latest spot.
      // Only update when direction is 'up' (we haven't just jumped to home/beginning).
      if (y > lastScrollRef.current + POSITION_UPDATE_THRESHOLD_PX) {
        savedScrollRef.current = y
      }
      lastScrollRef.current = y
    }

    // Initialize
    lastScrollRef.current = getScrollY()
    onScroll()

    // Listen to the right scroll target.
    const target = scrollContainerRef?.current
    if (target) {
      target.addEventListener('scroll', onScroll, { passive: true })
      return () => target.removeEventListener('scroll', onScroll)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [getScrollY, getViewportH, getMaxScroll, scrollContainerRef])

  // ── Smooth scroll helper ─────────────────────────────────────────────────
  const smoothScrollTo = useCallback((targetY: number) => {
    const target = scrollContainerRef?.current
    const startY = target ? target.scrollTop : (document.documentElement.scrollTop || document.body.scrollTop || 0)
    const diff = targetY - startY
    if (Math.abs(diff) < 2) return
    const startTime = performance.now()

    animatingRef.current = true

    const step = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / SCROLL_DURATION_MS)
      // easeInOutCubic — smooth, no jerk at start or end.
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const y = startY + diff * eased
      if (target) {
        target.scrollTop = y
      } else {
        window.scrollTo(0, y)
      }
      if (t < 1) {
        requestAnimationFrame(step)
      } else {
        animatingRef.current = false
        lastScrollRef.current = targetY
      }
    }
    requestAnimationFrame(step)
  }, [scrollContainerRef])

  // ── Button click handler ─────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    const currentY = getScrollY()
    const maxScroll = getMaxScroll()

    if (direction === 'up') {
      // Going to "beginning":
      //   normal mode → scroll to 0 (top of page)
      //   reverse mode → scroll to max (oldest messages, beginning of history)
      savedScrollRef.current = currentY
      const target = reverse ? maxScroll : 0
      smoothScrollTo(target)
      setDirection('down')
      directionRef.current = 'down'
      // Ensure the button stays visible during + after the scroll to the
      // beginning. Without this, the scroll listener might briefly hide it
      // when scrollTop passes through the "near home" zone during animation.
      setVisible(true)
    } else {
      // Going back to saved position.
      smoothScrollTo(savedScrollRef.current)
      setDirection('up')
      directionRef.current = 'up'
    }
  }, [direction, reverse, getScrollY, getMaxScroll, smoothScrollTo])

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.6, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onClick={handleClick}
          aria-label={direction === 'up' ? 'К началу' : 'Вернуться к месту чтения'}
          // v13.3: centered horizontally (was right-4). x: '-50%' in style
          // keeps it centered; framer-motion composes x with the animated
          // y/scale into a single transform — no conflict.
          // v25.7 (TZ ЭТАП 2.8): merge caller-provided className so the
          // product page can bump z-index above its z-[350] layer.
          className={cn(
            'fixed left-1/2 z-40 h-11 w-11 rounded-full grid place-items-center glass-strong shadow-lg border border-border/60 active:scale-90 transition-transform',
            className,
          )}
          style={{
            // Centered: left 50% + translateX(-50%). framer-motion's `x`
            // motion value composes with `y` and `scale` from animate().
            x: '-50%',
            // Sit above the Bottom Navigation on mobile. For chat (which
            // has its own layout), the caller can override via className.
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.25rem)',
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {direction === 'up' ? (
              <motion.span
                key="up"
                initial={{ opacity: 0, rotate: -90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 90 }}
                transition={{ duration: 0.15 }}
              >
                <ChevronUp className="h-5 w-5 text-primary" strokeWidth={2.4} />
              </motion.span>
            ) : (
              <motion.span
                key="down"
                initial={{ opacity: 0, rotate: 90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: -90 }}
                transition={{ duration: 0.15 }}
              >
                <ChevronDown className="h-5 w-5 text-primary" strokeWidth={2.4} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
