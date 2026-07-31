'use client'

// ============================================================================
//  SwipeToReply — wraps a chat message bubble and adds swipe-to-reply gesture.
//
//  v16.8.5: ПОЛНАЯ ПЕРЕПИСКА возвратной логики.
//  Проблема: `animate={{ x: 0 }}` + `style={{ x }}` (MotionValue) конфликтовали
//  в framer-motion — карточка "зависала" в смещённом положении после свайпа.
//
//  Решение: используем `dragSnapToOrigin={true}` — встроенный prop framer-motion,
//  который ГАРАНТИРОВАННО возвращает карточку на место после drag с spring-
//  анимацией. Никаких ручных animate/isAnimatingBack — всё нативно.
//
//  Behaviour:
//    • Swipe right (incoming) / left (own) reveals reply icon.
//    • Release past 80px threshold → onReply fires.
//    • Карточка ВСЕГДА возвращается на x=0 (dragSnapToOrigin).
//    • Reply icon fades in via useTransform on x.
// ============================================================================

import React, { useRef } from 'react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { CornerUpLeft } from 'lucide-react'
import { haptic } from '@/lib/haptic'

interface Props {
  /** Direction the bubble can be swiped to reveal reply.
   *  - 'left'  → bubble swipes LEFT (for own/outgoing messages, aligned right)
   *  - 'right' → bubble swipes RIGHT (for incoming messages, aligned left)
   */
  direction: 'left' | 'right'
  /** Called when the user swipes past the threshold and releases. */
  onReply: () => void
  /** Max-width classes for the bubble. */
  maxWidthClass?: string
  children: React.ReactNode
}

const THRESHOLD = 80 // px — past this, release triggers onReply
const MAX_DRAG = 100 // px — drag is clamped to this distance

export function SwipeToReply({ direction, onReply, maxWidthClass, children }: Props) {
  const x = useMotionValue(0)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  // Icon opacity ramps from 0 → 1 as drag distance approaches THRESHOLD
  const iconOpacity = useTransform(x, (val) => {
    const dist = Math.abs(val)
    return Math.min(1, dist / THRESHOLD)
  })

  // Icon scale ramps from 0.5 → 1 as drag distance approaches THRESHOLD
  const iconScale = useTransform(x, (val) => {
    const dist = Math.abs(val)
    return 0.5 + Math.min(1, dist / THRESHOLD) * 0.5
  })

  const handleDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const dist = direction === 'left' ? -info.offset.x : info.offset.x
    if (dist > THRESHOLD) {
      haptic.select()
      onReply()
    }
    // v16.8.5: dragSnapToOrigin={true} САМ возвращает карточку на x=0.
    // Ничего вручную делать не нужно — framer-motion анимирует возврат.
  }

  // Filter out vertical scrolls on touch start
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    }
  }

  return (
    <div
      className={cn('relative w-full flex', direction === 'left' ? 'justify-end' : 'justify-start')}
      onTouchStart={onTouchStart}
    >
      {/* Reply icon — positioned on the side the bubble swipes toward */}
      <motion.div
        className={cn(
          'absolute top-1/2 -translate-y-1/2 z-0 pointer-events-none',
          direction === 'left' ? 'right-0' : 'left-0',
        )}
        style={{ opacity: iconOpacity, scale: iconScale }}
      >
        <div className="h-9 w-9 rounded-full bg-primary/15 grid place-items-center text-primary">
          <CornerUpLeft className="h-4 w-4" />
        </div>
      </motion.div>

      {/* Draggable bubble.
          v16.8.5: dragSnapToOrigin={true} — framer-motion САМ возвращает
          карточку на x=0 после drag с spring-анимацией. Это нативный,
          гарантированный возврат. Никаких animate/isAnimatingBack конфликтов. */}
      <motion.div
        drag="x"
        dragConstraints={{ left: direction === 'left' ? -MAX_DRAG : 0, right: direction === 'right' ? MAX_DRAG : 0 }}
        dragElastic={{ left: direction === 'left' ? 0.6 : 0, right: direction === 'right' ? 0.6 : 0 }}
        dragMomentum={false}
        dragSnapToOrigin={true}
        onDragEnd={handleDragEnd}
        className={maxWidthClass}
        style={{ x, position: 'relative', zIndex: 1 }}
      >
        {children}
      </motion.div>
    </div>
  )
}

// Inline cn to avoid importing the whole utils file.
function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}
