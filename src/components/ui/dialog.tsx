"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { motion, useMotionValue, useTransform, animate, useDragControls, type PanInfo } from "framer-motion"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

// v9-interactive-dismiss: spring constants for the optional drag-to-dismiss
// behaviour on Dialog (centred modals). Drag is opt-in via the `draggable`
// prop because some dialogs (e.g. confirmations) feel better with just a
// button.
const DIALOG_SPRING_BACK = { type: 'spring', stiffness: 460, damping: 42, mass: 0.8 } as const
const DIALOG_SPRING_AWAY = { type: 'spring', stiffness: 320, damping: 36, mass: 0.9 } as const

function DialogContent({
  className,
  children,
  showCloseButton = true,
  draggable = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /**
   * v9-interactive-dismiss: enable iOS-style drag-to-dismiss.
   * Default: false (centred modals are usually confirmations where a
   * deliberate button click feels more appropriate than a gesture).
   * Set to true for preview-style dialogs (image lightbox, profile preview).
   */
  draggable?: boolean
}) {
  const dragY = useMotionValue(0)
  const [dragging, setDragging] = React.useState(false)
  const scale = useTransform(dragY, [0, 400], [1, 0.97])
  // dragControls lets us start drag only from the drag handle, not from
  // inside the dialog's scrollable content area.
  const dragControls = useDragControls()

  const handleDragEnd = React.useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      setDragging(false)
      const viewport = typeof window !== 'undefined' ? window.innerHeight : 800
      const pastThreshold = info.offset.y > viewport * 0.3 || info.velocity.y > 700

      if (pastThreshold) {
        const targetY = window.innerHeight
        const controls = animate(dragY, targetY, DIALOG_SPRING_AWAY)
        controls.finished
          .then(() => {
            // Trigger Radix close via Escape (Radix listens for it on the
            // dialog root). Dispatching on window lets Radix catch it.
            const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
            window.dispatchEvent(evt)
            dragY.set(0)
          })
          .catch(() => {
            dragY.set(0)
          })
      } else {
        animate(dragY, 0, DIALOG_SPRING_BACK)
      }
    },
    [dragY],
  )

  // Non-draggable path: original Radix-only DialogContent.
  if (!draggable) {
    return (
      <DialogPortal data-slot="dialog-portal">
        <DialogOverlay />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-[201] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
            className
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              aria-label="Закрыть"
              className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-3 right-3 h-10 w-10 grid place-items-center rounded-full opacity-100 transition-colors hover:bg-accent focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">Закрыть</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    )
  }

  // Draggable path: motion.div drives transforms during drag.
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content data-slot="dialog-content" asChild {...props}>
        <motion.div
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 1 }}
          onDragStart={() => setDragging(true)}
          onDragEnd={handleDragEnd}
          style={{ y: dragY, scale, willChange: 'transform' }}
          transition={DIALOG_SPRING_BACK}
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-[201] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
            dragging && "data-[state=open]:animate-none",
            "touch-none select-none",
            className
          )}
        >
          {/* Drag handle — the ONLY element that starts a drag. Renders as
              a centered pill at the top of the dialog when `draggable` is on. */}
          <div
            className="flex justify-center pt-0 pb-2 shrink-0 cursor-grab active:cursor-grabbing touch-none -mt-2"
            onPointerDown={(e) => dragControls.start(e)}
            aria-hidden
          >
            <div className="h-1.5 w-10 rounded-full bg-border/80" />
          </div>
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              aria-label="Закрыть"
              className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-3 right-3 h-10 w-10 grid place-items-center rounded-full opacity-100 transition-colors hover:bg-accent focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">Закрыть</span>
            </DialogPrimitive.Close>
          )}
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
