'use client'

// ============================================================================
// ScrollFadeItem — обёртка для карточки сообщения, применяющая scroll-fade.
// ----------------------------------------------------------------------------
// v16.8.5: используйте useScrollFade hook для расчёта opacity на основе
// позиции карточки относительно scroll-контейнера. Карточка растворяется
// у краёв, фон не меняется.
// ============================================================================

import { useRef, type ReactNode } from 'react'
import { useScrollFade } from './hooks/use-scroll-fade'

interface ScrollFadeItemProps {
  scrollRef: React.RefObject<HTMLElement | null>
  children: ReactNode
}

export function ScrollFadeItem({ scrollRef, children }: ScrollFadeItemProps) {
  const itemRef = useRef<HTMLDivElement>(null)
  const opacity = useScrollFade(itemRef, scrollRef)

  return (
    <div ref={itemRef} style={{ opacity, transition: 'opacity 0.1s ease-out' }}>
      {children}
    </div>
  )
}
