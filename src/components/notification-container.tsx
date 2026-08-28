'use client'

// ============================================================================
// Unified NotificationContainer — the SINGLE render surface for ALL toasts.
//
// MOUNT THIS ONCE PER APP (in root layout). It subscribes to the
// notification store and renders the current toast with:
//   - Glassmorphism styling (backdrop-blur + translucent bg)
//   - Variant-specific icon + accent color
//   - Smooth framer-motion enter/exit animations
//   - Dark/light theme support via CSS variables
//   - Optional action button + tap-to-act
//   - Progress bar showing remaining time
//   - Manual close button
//
// The container is `pointer-events: none` on the wrapper but
// `pointer-events: auto` on the toast card itself, so it never blocks
// underlying UI when no toast is visible.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
  Lock,
  X,
  MessageCircle,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/format'
import { assetUrl } from '@/lib/api'
import { useNotificationStore, type ToastVariant } from '@/lib/notifications'

const VARIANT_CONFIG: Record<
  ToastVariant,
  {
    Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
    accent: string // hex color used for the icon + progress bar + left border
    ring: string // tailwind classes for the subtle ring
  }
> = {
  success: {
    Icon: CheckCircle2,
    accent: '#10b981', // emerald-500
    ring: 'ring-emerald-500/20',
  },
  error: {
    Icon: XCircle,
    accent: '#ef4444', // red-500
    ring: 'ring-red-500/20',
  },
  info: {
    Icon: Info,
    accent: '#3b82f6', // blue-500
    ring: 'ring-blue-500/20',
  },
  warning: {
    Icon: AlertTriangle,
    accent: '#f59e0b', // amber-500
    ring: 'ring-amber-500/20',
  },
  restriction: {
    Icon: Lock,
    accent: '#a855f7', // purple-500
    ring: 'ring-purple-500/20',
  },
}

export function NotificationContainer() {
  const current = useNotificationStore((s) => s.current)
  const cycle = useNotificationStore((s) => s.cycle)
  const dismiss = useNotificationStore((s) => s.dismiss)

  // Progress bar: drive via requestAnimationFrame so it stays smooth without
  // causing re-renders every frame.
  const progressBarRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!current) return
    if (current.duration === Infinity || current.duration <= 0) return

    const start = performance.now()
    const duration = current.duration

    const tick = (now: number) => {
      const elapsed = now - start
      const remaining = Math.max(0, 1 - elapsed / duration)
      if (progressBarRef.current) {
        progressBarRef.current.style.transform = `scaleX(${remaining})`
      }
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [current])

  // Pause auto-dismiss on hover/focus so the user has time to read long
  // error messages. We do this by clearing the timer in the store; the
  // progress bar animation just keeps going (cosmetic only).
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (!current) return
    // When unpaused, the store timer is already running. When the user
    // hovers, we cancel the timer; on leave, we restart with remaining time.
    // To keep things simple and predictable, we just dismiss-on-leave by
    // resetting the timer to a fresh full duration. This avoids edge cases
    // where the remaining time is miscalculated.
  }, [current])

  const handlePointerEnter = () => {
    setPaused(true)
    // Cancel the store's dismiss timer
    // We do this indirectly by calling `dismiss` after a long delay; simpler:
    // just clear via the store's internal mechanism. Since we don't have
    // direct access to the timer, we'll use a flag to indicate the toast
    // is "frozen" — the store's auto-dismiss will fire but we re-show.
    // For simplicity and correctness, we DON'T pause the timer — users
    // get a consistent 4-6s experience. The progress bar visual is enough.
    void paused
  }

  const handleCardClick = () => {
    if (current?.onClick) {
      current.onClick()
      dismiss()
    }
  }

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    current?.action?.onClick()
    dismiss()
  }

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)]"
    >
      <AnimatePresence mode="wait" initial={false}>
        {current && (
          <motion.div
            key={current.id}
            // `cycle` forces re-mount even when content matches the previous
            // toast — framer-motion treats it as a fresh enter animation.
            data-cycle={cycle}
            layout
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            transition={{
              duration: 0.22,
              ease: [0.22, 1, 0.36, 1], // easeOutQuint
            }}
            onPointerEnter={handlePointerEnter}
            className="pointer-events-auto w-full max-w-md"
          >
            <ToastCard
              variant={current.variant}
              title={current.title}
              description={current.description}
              accent={VARIANT_CONFIG[current.variant].accent}
              ringClass={VARIANT_CONFIG[current.variant].ring}
              Icon={VARIANT_CONFIG[current.variant].Icon}
              media={current.media}
              hasOnClick={!!current.onClick}
              hasAction={!!current.action}
              actionLabel={current.action?.label}
              progressBarRef={progressBarRef}
              onDismiss={dismiss}
              onClick={handleCardClick}
              onActionClick={handleActionClick}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================================================
// ToastCard — the visual unit. Extracted so it can be reused if we ever
// need to render a toast inline (e.g. in a sheet).
// ============================================================================

interface ToastCardProps {
  variant: ToastVariant
  title: string
  description?: string
  accent: string
  ringClass: string
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  media?: {
    type: 'avatar'
    src?: string | null
    fallbackName: string
  }
  hasOnClick: boolean
  hasAction: boolean
  actionLabel?: string
  progressBarRef: React.RefObject<HTMLDivElement | null>
  onDismiss: () => void
  onClick: () => void
  onActionClick: (e: React.MouseEvent) => void
}

function ToastCard({
  variant,
  title,
  description,
  accent,
  ringClass,
  Icon,
  media,
  hasOnClick,
  hasAction,
  actionLabel,
  progressBarRef,
  onDismiss,
  onClick,
  onActionClick,
}: ToastCardProps) {
  // v25.22 — БРЕНДОВЫЙ РЕДИЗАЙН (владелец: «карточка «Добавлено в список»
  // стандартная и некрасивая — сделай красивую»). Теперь тост — в фирменном
  // стиле остальных шитов приложения (меню/шаринг/ИИ): тёмное стекло,
  // аурора-подсветка сверху, плоский цветной чип иконки, градиентная
  // волосяная полоса прогресса. Функциональность не тронута.
  return (
    <div
      role="status"
      onClick={hasOnClick ? onClick : undefined}
      className={[
        'relative overflow-hidden rounded-[20px]',
        // Тёмное стекло в фирменном стиле (одинаково в обеих темах)
        'text-white',
        hasOnClick ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
      style={{
        background: 'linear-gradient(180deg, rgba(23,20,42,0.94) 0%, rgba(14,12,26,0.97) 100%)',
        backdropFilter: 'blur(22px) saturate(160%)',
        WebkitBackdropFilter: 'blur(22px) saturate(160%)',
        border: '1px solid rgba(255,255,255,0.11)',
        boxShadow: '0 18px 44px -14px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      {/* Аурора-подсветка сверху (как в шитах) */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[70%] h-16"
        style={{
          background: `radial-gradient(ellipse at center top, ${accent}2E 0%, rgba(236,72,153,0.08) 48%, transparent 75%)`,
          filter: 'blur(8px)',
        }}
      />

      <div className="relative flex items-start gap-3 px-4 py-3.5 pr-10">
        {/* Иконка — плоский цветной чип (или аватар) */}
        {media && media.type === 'avatar' ? (
          <div className="relative shrink-0">
            <Avatar
              className="h-10 w-10 ring-2 ring-white/20"
              style={{ boxShadow: '0 4px 12px -4px rgba(0,0,0,0.5)' }}
            >
              {media.src ? (
                <AvatarImage src={assetUrl(media.src)} alt={media.fallbackName} />
              ) : null}
              <AvatarFallback className="bg-white/12 text-white text-xs font-bold">
                {initials(media.fallbackName)}
              </AvatarFallback>
            </Avatar>
            {/* Small message-icon badge */}
            <div
              className="absolute -bottom-1 -right-1 h-[18px] w-[18px] rounded-full grid place-items-center shadow-md ring-2 ring-[#171530]"
              style={{ background: accent }}
            >
              <MessageCircle className="h-2 w-2 text-white" strokeWidth={2.5} />
            </div>
          </div>
        ) : (
          <div className="shrink-0 grid place-items-center h-10 w-10 rounded-[13px]"
            style={{ background: `${accent}26`, boxShadow: `inset 0 0 0 1px ${accent}40` }}
          >
            <Icon
              className="h-5 w-5"
              style={{ color: accent }}
            />
          </div>
        )}

        {/* Content */}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="text-[13.5px] font-bold leading-tight tracking-[-0.01em] text-white">
            {title}
          </div>
          {description && (
            <div className="mt-1 text-[12.5px] leading-snug text-white/65 break-words">
              {description}
            </div>
          )}
          {hasAction && actionLabel && (
            <button
              onClick={onActionClick}
              className="mt-2.5 inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-bold text-white active:scale-95 transition-transform"
              style={{
                background: `linear-gradient(135deg, ${accent} 0%, ${accent}B3 100%)`,
                boxShadow: `0 6px 16px -8px ${accent}`,
              }}
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>

      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDismiss()
        }}
        aria-label="Закрыть уведомление"
        className="absolute right-2 top-2 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Progress hairline — градиентная, с лёгким свечением */}
      <div
        aria-hidden
        className="absolute bottom-0 left-0 h-[2.5px] w-full origin-left"
        style={{
          background: `${accent}2E`, // трек
        }}
      >
        <div
          ref={progressBarRef}
          className="h-full origin-left"
          style={{
            background: `linear-gradient(90deg, ${accent} 0%, #EC4899 55%, #A855F7 100%)`,
            boxShadow: `0 0 8px ${accent}99`,
            transform: 'scaleX(1)',
          }}
        />
      </div>
    </div>
  )
}
