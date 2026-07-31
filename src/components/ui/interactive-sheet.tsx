'use client'

import { useEffect, useRef, useState, useCallback, type ReactNode, type RefObject } from 'react'
import { motion, useMotionValue, useTransform, animate, useDragControls, type PanInfo } from 'framer-motion'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { cn } from '@/lib/utils'

// ============================================================================
//  InteractiveSheet — universal iOS-style drag-to-dismiss modal/sheet.
//
//  One reusable primitive that gives every modal, bottom sheet, drawer,
//  preview, and pop-up in 999 — Три девятки the same physics:
//
//    • Card tracks finger 1:1 (GPU-accelerated `transform: translateY`).
//    • Backdrop blur + opacity ramp down as the card is dragged away.
//    • Card subtly scales (down to ~0.98) under the finger.
//    • On release:
//        - drag < 25% of viewport height + low velocity → spring back to 0.
//        - drag > 25% OR velocity > 700 px/s → fly off-screen, then onClose.
//    • Optional drag handle (visual affordance) shown at the top on mobile.
//    • Escape-to-close, focus trap, scroll lock — all handled internally.
//    • Per-axis drag: 'y' (default), 'x' (side drawers), or 'both'.
//    • Configurable side: 'bottom' (default), 'right', 'left', 'top'.
//    • Internal scrollable content stays scrollable (data-scroll-lock-ignore).
//
//  This component is the single source of truth for interactive dismiss UX.
//  BuySheet, CartSheet, FavoritesSheet, ProductPage, ImageLightbox, future
//  modals — all delegate to <InteractiveSheet>.
//
//  Why framer-motion?
//    - `useMotionValue` avoids React re-renders on every drag pixel (60 FPS).
//    - Spring physics is built-in (Apple-like easing).
//    - `drag` + `dragConstraints` + `onDragEnd` gives us velocity + threshold
//      for free.
//    - Already a dependency — no new bundles.
// ============================================================================

export type InteractiveSheetSide = 'bottom' | 'right' | 'left' | 'top'
export type InteractiveSheetDragAxis = 'y' | 'x' | 'both'

export interface InteractiveSheetProps {
  open: boolean
  onClose: () => void

  /** Which edge the sheet attaches to. Default: 'bottom'. */
  side?: InteractiveSheetSide

  /**
   * Drag axis. Default: 'y' for bottom/top sheets, 'x' for left/right.
   * Set explicitly to override.
   */
  dragAxis?: InteractiveSheetDragAxis

  /**
   * Threshold as a fraction of viewport (0–1) past which the sheet closes
   * on release. Default: 0.3 (30%).
   */
  dismissThreshold?: number

  /**
   * Velocity in px/s above which the sheet closes regardless of distance.
   * Default: 700 (a flick).
   */
  dismissVelocity?: number

  /** Backdrop opacity at rest. Default: 0.5. */
  backdropOpacity?: number

  /** Backdrop blur in px at rest. Default: 8. */
  backdropBlur?: number

  /** Show the pill-shaped drag handle at the top of bottom sheets. Default: true on mobile. */
  showDragHandle?: boolean

  /** ARIA label for the dialog. */
  ariaLabel?: string

  /** Close on Escape key. Default: true. */
  closeOnEscape?: boolean

  /** Lock body scroll while open. Default: true. */
  lockScroll?: boolean

  /** Trap focus inside the sheet while open. Default: true. */
  trapFocus?: boolean

  /** Outer container className (positions the sheet). */
  className?: string

  /** Inner panel className (visual style). */
  panelClassName?: string

  /** Inline style for the panel (e.g. paddingBottom safe-area). */
  panelStyle?: React.CSSProperties

  /** Panel width on desktop. Default: 440px. */
  desktopWidth?: number

  /** Ref forwarded to the inner panel (for focus-trap etc). */
  panelRef?: RefObject<HTMLDivElement | null>

  children: ReactNode

  /** Optional renderer for a custom drag handle (replaces default pill). */
  renderDragHandle?: () => ReactNode

  /**
   * If true, the sheet will NOT render a backdrop (useful for sheets that
   * should be transparent over the page, e.g. inline previews).
   * Default: false.
   */
  noBackdrop?: boolean
}

const SPRING_BACK = { type: 'spring', stiffness: 460, damping: 42, mass: 0.8 } as const
const SPRING_AWAY = { type: 'spring', stiffness: 320, damping: 36, mass: 0.9 } as const

export function InteractiveSheet({
  open,
  onClose,
  side = 'bottom',
  dragAxis,
  dismissThreshold = 0.3,
  dismissVelocity = 700,
  backdropOpacity = 0.5,
  backdropBlur = 8,
  showDragHandle,
  ariaLabel,
  closeOnEscape = true,
  lockScroll = true,
  trapFocus = true,
  className,
  panelClassName,
  panelStyle,
  desktopWidth = 440,
  panelRef,
  children,
  renderDragHandle,
  noBackdrop = false,
}: InteractiveSheetProps) {
  // Determine drag axis from side if not explicitly set.
  const axis: InteractiveSheetDragAxis = dragAxis ?? (side === 'left' || side === 'right' ? 'x' : 'y')

  // Motion values — these update WITHOUT triggering React re-renders.
  // The drag distance (0 = rest) drives backdrop opacity, blur, and scale.
  const dragX = useMotionValue(0)
  const dragY = useMotionValue(0)
  const [isDismissing, setIsDismissing] = useState(false)
  const [shouldRender, setShouldRender] = useState(open)
  // dragControls lets us start drag ONLY from the drag handle / header —
  // not from inside the scrollable content area. Without this, drag would
  // compete with inner scroll and the user couldn't scroll a long list.
  const dragControls = useDragControls()

  // Internal ref for the panel — we forward to external panelRef too.
  const internalRef = useRef<HTMLDivElement | null>(null)
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalRef.current = node
      if (panelRef) panelRef.current = node
    },
    [panelRef],
  )

  useFocusTrap(internalRef, open && trapFocus)
  useScrollLock(open && lockScroll)

  // Keep `shouldRender` in sync with `open` — but delay unmount until the
  // fly-away spring finishes (~400ms) so the user sees the dismiss animation.
  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setIsDismissing(false)
    }
  }, [open])

  // When dismissed, hold the rendering for the duration of the fly-away
  // animation so the spring completes visibly. Then call onClose.
  const triggerDismiss = useCallback(() => {
    if (isDismissing) return
    setIsDismissing(true)

    // Animate off-screen. Direction depends on side.
    const targetX = side === 'left' ? -window.innerWidth : side === 'right' ? window.innerWidth : 0
    const targetY = side === 'top' ? -window.innerHeight : side === 'bottom' ? window.innerHeight : 0

    const controlsX = animate(dragX, targetX, SPRING_AWAY)
    const controlsY = animate(dragY, targetY, SPRING_AWAY)

    Promise.all([controlsX.finished, controlsY.finished])
      .then(() => {
        onClose()
        // Brief delay so onClose can flip `open=false` before we unmount.
        setTimeout(() => {
          setShouldRender(false)
          setIsDismissing(false)
          dragX.set(0)
          dragY.set(0)
        }, 16)
      })
      .catch(() => {
        // Animation cancelled — fall back to immediate close.
        onClose()
        setShouldRender(false)
        setIsDismissing(false)
        dragX.set(0)
        dragY.set(0)
      })
  }, [isDismissing, side, dragX, dragY, onClose])

  // Escape to close.
  useEffect(() => {
    if (!open || !closeOnEscape) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Animate out instead of vanishing.
        triggerDismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeOnEscape, triggerDismiss])

  // Cleanup motion values on unmount.
  useEffect(() => {
    return () => {
      dragX.set(0)
      dragY.set(0)
    }
  }, [dragX, dragY])

  // v10-fix: when `open` flips to false externally (e.g. X button click,
  // parent setState), trigger the dismiss animation so the sheet slides
  // off-screen gracefully. Previously, only motion values were reset,
  // which left the sheet visually stuck open — the X button appeared
  // "broken" because shouldRender stayed true.
  useEffect(() => {
    if (!open && shouldRender && !isDismissing) {
      triggerDismiss()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // --- Drag distance → backdrop + scale transforms ----------------------
  // IMPORTANT: these useTransform hooks MUST be called unconditionally
  // (before any early return) to comply with the Rules of Hooks. The
  // previous code had `if (!shouldRender) return null` ABOVE these hooks,
  // which caused "Rendered more hooks than during the previous render"
  // errors when shouldRender flipped from false → true. All hooks are now
  // declared first; the early return is moved below.
  const viewportSize = typeof window !== 'undefined' ? window.innerHeight : 800
  const progressMax = viewportSize * 0.6 // 60% of viewport = full fade-out
  const dragProgress = useTransform(
    [dragX, dragY],
    ([x, y]: number[]) => {
      const dist = Math.max(Math.abs(x), Math.abs(y))
      return Math.min(1, dist / progressMax)
    },
  )

  const currentBackdropOpacity = useTransform(dragProgress, [0, 1], [backdropOpacity, 0])
  const currentBackdropBlur = useTransform(dragProgress, [0, 1], [backdropBlur, 0])
  const scale = useTransform(dragProgress, [0, 1], [1, 0.98])
  // Backdrop blur string transform — MUST be declared at the top level (not
  // inside JSX) because useTransform is a hook and must be called
  // unconditionally. Previously this was inlined in the style={{}} prop of
  // the conditional {!noBackdrop && ...} block, which violated the Rules of
  // Hooks when noBackdrop was true.
  const backdropBlurString = useTransform(currentBackdropBlur, (b) => `blur(${b}px)`)

  // --- Drag handlers ----------------------------------------------------
  const onDragEnd = useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { offset, velocity } = info
      const distance =
        axis === 'x'
          ? Math.abs(offset.x)
          : axis === 'y'
            ? Math.abs(offset.y)
            : Math.max(Math.abs(offset.x), Math.abs(offset.y))
      const speed =
        axis === 'x'
          ? Math.abs(velocity.x)
          : axis === 'y'
            ? Math.abs(velocity.y)
            : Math.max(Math.abs(velocity.x), Math.abs(velocity.y))

      const viewport = axis === 'x' ? window.innerWidth : window.innerHeight
      const pastThreshold = distance / viewport >= dismissThreshold
      const flicked = speed >= dismissVelocity

      if (pastThreshold || flicked) {
        triggerDismiss()
      } else {
        // Spring back to rest.
        animate(dragX, 0, SPRING_BACK)
        animate(dragY, 0, SPRING_BACK)
      }
    },
    [axis, dismissThreshold, dismissVelocity, dragX, dragY, triggerDismiss],
  )

  // Early return — MUST be after ALL hooks (useTransform, useCallback above)
  // to comply with the Rules of Hooks. Returning null here when the sheet
  // is unmounted prevents the motion.div from rendering, but the hooks still
  // run every render so React's hook ordering stays stable.
  if (!shouldRender) return null

  // --- Positioning classes per side -------------------------------------
  const positionClasses: Record<InteractiveSheetSide, string> = {
    bottom: 'items-end justify-stretch',
    top: 'items-start justify-stretch',
    left: 'items-stretch justify-start',
    right: 'items-stretch justify-end',
  }

  const panelPositionClasses: Record<InteractiveSheetSide, string> = {
    bottom: 'w-full rounded-t-[32px] md:rounded-none md:rounded-l-[28px] md:w-[var(--sheet-w)] md:h-full',
    top: 'w-full rounded-b-[32px] md:rounded-none md:rounded-b-[28px] md:w-full',
    left: 'h-full w-full md:w-[var(--sheet-w)] rounded-r-[32px] md:rounded-r-[28px]',
    right: 'h-full w-full md:w-[var(--sheet-w)] rounded-l-[32px] md:rounded-l-[28px]',
  }

  const dragHandleVisible = showDragHandle ?? (side === 'bottom' || side === 'top')

  return (
    <motion.div
      className={cn(
        'fixed inset-0 z-[90] flex',
        // On desktop, side sheets attach to an edge with a gap for premium feel;
        // bottom sheets still take full width on mobile.
        positionClasses[side],
        className,
      )}
      style={
        {
          '--sheet-w': `${desktopWidth}px`,
        } as React.CSSProperties
      }
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* Backdrop — ramps opacity + blur down with drag distance.
          Pointer-events: auto so taps on backdrop close the sheet. */}
      {!noBackdrop && (
        <motion.div
          className="absolute inset-0 bg-black/40 md:bg-black/30"
          style={{
            opacity: currentBackdropOpacity,
            backdropFilter: backdropBlurString,
            WebkitBackdropFilter: backdropBlurString,
          }}
          onClick={() => triggerDismiss()}
          aria-hidden
        />
      )}

      {/* Sheet panel — the draggable surface.
          We use motion.div so framer-motion can drive transforms without
          React state updates. `drag` enables pointer tracking; `dragConstraints`
          is set to false (no hard limits) so the panel follows the finger
          freely in the dismiss direction; `dragElastic={1}` makes it 1:1. */}
      <motion.div
        ref={setRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        drag={axis === 'both' ? true : axis}
        dragControls={dragControls}
        // Disable auto-drag-listener so drag only starts from the handle.
        // Without this, dragging inside the scrollable content area would
        // hijack touch events and break scrolling.
        dragListener={false}
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        // Allow free drag in the dismiss direction. We achieve this with
        // dragElastic=1 + a high dragConstraints box; framer-motion then lets
        // the user pull past constraints with elastic resistance.
        dragElastic={{ top: side === 'top' ? 1 : 0, bottom: side === 'bottom' ? 1 : 0, left: side === 'left' ? 1 : 0, right: side === 'right' ? 1 : 0 }}
        onDragEnd={onDragEnd}
        style={{
          x: dragX,
          y: dragY,
          scale,
          willChange: 'transform',
          ...(panelStyle || {}),
        }}
        // Spring physics for any drag overshoot that snaps back.
        transition={SPRING_BACK}
        className={cn(
          'relative flex flex-col glass-strong border border-border/40 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.4)]',
          // Side-specific positioning
          panelPositionClasses[side],
          // On touch devices, prevent long-press context menu / text selection during drag.
          'touch-none select-none',
          panelClassName,
        )}
      >
        {/* Drag handle — visible pill at the top of bottom/top sheets.
            Acts as both a visual affordance and the ONLY drag initiator.
            onPointerDown starts the drag via dragControls so the rest of
            the sheet tracks the finger 1:1 until release. */}
        {dragHandleVisible && !renderDragHandle && (side === 'bottom' || side === 'top') && (
          <div
            className="flex justify-center pt-2.5 pb-1 shrink-0 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={(e) => dragControls.start(e)}
            aria-hidden
          >
            <div className="h-1.5 w-12 rounded-full bg-border/80" />
          </div>
        )}
        {/* Custom drag handle — if the consumer provides `renderDragHandle`,
            we render it even when `showDragHandle={false}` (because the
            custom handle may serve as a non-draggable header, e.g. cart-sheet).
            In that case we don't attach dragControls (no pull-down effect). */}
        {renderDragHandle && (dragHandleVisible ? (
          <div
            className="shrink-0 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={(e) => dragControls.start(e)}
          >
            {renderDragHandle()}
          </div>
        ) : (
          <div className="shrink-0">
            {renderDragHandle()}
          </div>
        ))}

        {/* Content area — opt-in to scroll-lock-ignore so internal scroll works.
            We re-enable touch-action + user-select here because the parent
            disabled them for clean drag tracking. */}
        <div
          data-scroll-lock-ignore
          className={cn('flex-1 min-h-0 overflow-y-auto touch-auto select-auto')}
        >
          {children}
        </div>
      </motion.div>
    </motion.div>
  )
}
