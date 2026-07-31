"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { motion, useMotionValue, useTransform, animate, useDragControls, type PanInfo } from "framer-motion"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

// v9-interactive-dismiss: spring constants shared by the drag-to-dismiss
// behaviour added to SheetContent (bottom sheets only).
const SHEET_SPRING_BACK = { type: 'spring', stiffness: 460, damping: 42, mass: 0.8 } as const
const SHEET_SPRING_AWAY = { type: 'spring', stiffness: 320, damping: 36, mass: 0.9 } as const

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  showDragHandle = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  /**
   * v9-final-fix: when false, the X close button is NOT rendered. Use this
   * for sheets that close via swipe-down only (e.g. MoreSheet).
   * Default: true (backwards compatible).
   */
  showCloseButton?: boolean
  /**
   * v9-final-fix: when false, the default drag handle pill is NOT rendered.
   * Use this when the consumer provides a custom handle (e.g. CartSheet,
   * FavoritesSheet). Default: true for bottom/top sheets.
   */
  showDragHandle?: boolean
}) {
  // Interactive drag-to-dismiss for bottom sheets. Side panels keep Radix's
  // built-in slide animation (drag is ambiguous on side drawers — X-axis
  // pan competes with horizontal scroll inside content).
  const isBottomSheet = side === "bottom"
  const isTopSheet = side === "top"

  // Motion values stay at 0 when not dragging — no re-renders.
  const dragY = useMotionValue(0)
  const [dragging, setDragging] = React.useState(false)
  // dragControls lets us start drag ONLY from the handle, not from inside
  // the scrollable content area — otherwise the inner scroll would break.
  const dragControls = useDragControls()
  // v10.3-fix: ref to a hidden Radix Close button. Clicking it is the ONLY
  // reliable way to trigger Radix's close flow (onOpenChange(false) +
  // unmount + overlay removal). Previously we dispatched a synthetic
  // KeyboardEvent('Escape') on window, which Radix's DismissableLayer
  // often ignored — leaving the overlay (blur) stuck after swipe-dismiss.
  const closeRef = React.useRef<HTMLButtonElement>(null)
  // v11-fix: ref to the motion.div panel element. Used to set
  // visibility:hidden during close, preventing the panel from flashing
  // at position 0 when we reset dragY (which removes the inline transform
  // that was conflicting with Radix's CSS exit animation).
  const panelRef = React.useRef<HTMLDivElement>(null)

  // Backdrop opacity + scale ramp with drag distance.
  // (For Radix Sheet we don't own the overlay, so we can't fade it directly
  // from here — but the panel scale + translateY still gives the 1:1 feel.)
  const scale = useTransform(dragY, [0, 400], [1, 0.98])

  const handleDragEnd = React.useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      setDragging(false)
      const viewport = typeof window !== 'undefined' ? window.innerHeight : 800
      // Threshold: 30% of viewport OR a flick above 700px/s.
      const pastThreshold =
        (side === 'top' ? info.offset.y < -viewport * 0.3 : info.offset.y > viewport * 0.3) ||
        (side === 'top' ? info.velocity.y < -700 : info.velocity.y > 700)

      if (pastThreshold) {
        // Animate off-screen, then close via Radix Close button click.
        const targetY = side === 'top' ? -window.innerHeight : window.innerHeight
        const controls = animate(dragY, targetY, SHEET_SPRING_AWAY)

        // v11-fix: ROBUST close sequence.
        //
        // Root cause of the "blur stays after swipe-down" bug:
        // After the framer-motion animation, the panel's inline transform
        // is translateY(targetY). This inline style OVERRIDES Radix's CSS
        // exit animation (data-[state=closed]:slide-out-to-bottom). When
        // the CSS animation doesn't run, Radix's Presence component never
        // detects onAnimationEnd → never unmounts the content → the overlay
        // (bg-black/50 backdrop-blur-sm) stays in the DOM forever.
        // Additionally, on next open, the panel is at translateY(targetY)
        // (off-screen) so it appears invisible.
        //
        // Fix: (1) hide the panel via visibility:hidden so the user doesn't
        // see it flash at position 0 when we reset dragY. (2) reset dragY
        // to 0 — this removes the inline transform so Radix's CSS exit
        // animation can run. (3) click the hidden Close button to trigger
        // Radix's onOpenChange(false). (4) timeout fallback in case the
        // animation promise stalls.
        let didClose = false
        const doClose = () => {
          if (didClose) return
          didClose = true
          // Hide panel to prevent visual flash when dragY resets to 0
          if (panelRef.current) {
            panelRef.current.style.visibility = 'hidden'
          }
          // Remove inline transform so Radix CSS exit animation can run
          dragY.set(0)
          // Trigger Radix close → onOpenChange(false) → exit animation →
          // Presence detects onAnimationEnd → content unmounted → overlay removed
          closeRef.current?.click()
        }

        controls.finished.then(doClose).catch(doClose)
        // Fallback: force close after 800ms if the animation promise stalls
        // (e.g., if another animation cancels it, or if the component
        // re-renders during the animation).
        setTimeout(doClose, 800)
      } else {
        // Spring back to rest.
        animate(dragY, 0, SHEET_SPRING_BACK)
      }
    },
    [dragY, side],
  )

  // For non-draggable sides, render the original Radix-only SheetContent.
  if (!isBottomSheet && !isTopSheet) {
    return (
      <SheetPortal>
        <SheetOverlay />
        <SheetPrimitive.Content
          data-slot="sheet-content"
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
            side === "right" &&
              "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
            side === "left" &&
              "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
            className
          )}
          {...props}
        >
          {children}
          <SheetPrimitive.Close
            aria-label="Закрыть"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-3 right-3 h-10 w-10 grid place-items-center rounded-full opacity-100 transition-colors hover:bg-accent focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Закрыть</span>
          </SheetPrimitive.Close>
        </SheetPrimitive.Content>
      </SheetPortal>
    )
  }

  // Bottom / top sheets get the interactive drag wrapper.
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        asChild
        {...props}
      >
        {/* motion.div is the actual draggable surface. `asChild` on the
            Radix Content lets us pass our own element while keeping
            Radix's focus trap + escape handler.
            dragListener={false} + dragControls means drag only starts from
            the handle — not from inside the scrollable content. */}
        <motion.div
          ref={panelRef}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          // Allow drag only in the dismiss direction; the other direction
          // is locked so internal scroll works.
          dragElastic={{ top: isTopSheet ? 1 : 0, bottom: isBottomSheet ? 1 : 0 }}
          onDragStart={() => {
            setDragging(true)
            // v11-fix: reset visibility in case it was hidden by a previous
            // swipe-close attempt that was interrupted.
            if (panelRef.current) panelRef.current.style.visibility = ''
          }}
          onDragEnd={handleDragEnd}
          style={{ y: dragY, scale, willChange: 'transform' }}
          transition={SHEET_SPRING_BACK}
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg",
            // Disable Radix's slide animation while dragging (we drive via motion).
            dragging && "data-[state=open]:animate-none",
            side === "top"
              ? "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b rounded-b-[32px]"
              : "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t rounded-t-[32px]",
            // v9-final-fix: removed `touch-none` from the panel — it was blocking
            // ALL touch scrolling inside the sheet. dragListener={false} already
            // ensures drag only starts from the handle, so we don't need
            // touch-none on the panel. select-none stays to prevent text
            // selection during drag.
            "select-none",
            className
          )}
        >
          {/* Drag handle — the ONLY element that starts a drag.
              onPointerDown initiates the drag via dragControls.
              v9-final-fix: showDragHandle prop controls whether the default
              pill is rendered. Set to false when the consumer provides a
              custom header that acts as the handle (e.g. CartSheet,
              FavoritesSheet). */}
          {showDragHandle && (
            <div
              className="flex justify-center pt-2.5 pb-1 shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={(e) => dragControls.start(e)}
              aria-hidden
            >
              {/* v18.12: drag handle uses an explicit light color (white/40)
                  instead of bg-border/80 — in neon theme --border is too dark
                  and the handle was invisible. White/40 is visible on all
                  backgrounds (dark sheet, light sheet, neon sheet). */}
              <div className="h-1.5 w-12 rounded-full bg-white/40 dark:bg-white/30 [.neon_&]:bg-violet-300/50" />
            </div>
          )}
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              aria-label="Закрыть"
              className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-3 right-3 h-10 w-10 grid place-items-center rounded-full opacity-100 transition-colors hover:bg-accent focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
            >
              <XIcon className="size-4" />
              <span className="sr-only">Закрыть</span>
            </SheetPrimitive.Close>
          )}
          {/* v10.3-fix: ALWAYS render a hidden Close button (even when
              showCloseButton=false) so drag-to-dismiss can click it
              programmatically. This is the reliable Radix close mechanism —
              no synthetic events. Visually hidden but functionally present. */}
          <SheetPrimitive.Close
            ref={closeRef}
            aria-hidden="true"
            tabIndex={-1}
            className="sr-only"
          >
            <span className="sr-only">Закрыть</span>
          </SheetPrimitive.Close>
        </motion.div>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
