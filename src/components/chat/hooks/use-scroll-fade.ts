'use client'

// ============================================================================
// useScrollFade — хук для плавного растворения карточек сообщений у краёв.
// ----------------------------------------------------------------------------
// v16.8.5: Заменяет CSS mask-image (которая создавала эффект "белого glow"
// на всём контейнере). Вместо этого хук применяет opacity к КОНКРЕТНОЙ
// карточке на основе её позиции относительно scroll-контейнера.
//
// Принцип:
//   • Когда карточка приближается к верхнему или нижнему краю scroll-контейнера,
//     её opacity плавно уменьшается от 1 до 0.
//   • Fade-зона — только последние ~40px перед краём. Карточка почти доходит
//     до Header/панели ввода, и только последние пиксели растворяются.
//   • Фон приложения НЕ меняется — исчезает только сама карточка.
//
// Использование:
//   const ref = useRef<HTMLDivElement>(null)
//   const opacity = useScrollFade(ref, scrollContainerRef)
//   <div ref={ref} style={{ opacity }}>...</div>
//
// Производительность:
//   • Использует requestAnimationFrame для throttle.
//   • Читает только getBoundingClientRect() (layout-throttle safe).
//   • Если карточка далеко от краёв — opacity = 1, ре-рендер не нужен.
// ============================================================================

import { useEffect, useState, type RefObject } from 'react'

const FADE_ZONE = 40 // px — fade только в последних 40px перед краем

export function useScrollFade(
  elRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
): number {
  const [opacity, setOpacity] = useState(1)

  useEffect(() => {
    const el = elRef.current
    const scroll = scrollRef.current
    if (!el || !scroll) return

    let rafId: number | null = null

    const compute = () => {
      rafId = null
      const elRect = el.getBoundingClientRect()
      const scrollRect = scroll.getBoundingClientRect()

      // Top edge: how far the element's top is above the scroll container's top
      // (negative = above the visible area, fading out)
      const distFromTop = elRect.top - scrollRect.top
      // Bottom edge: how far the element's bottom is below the scroll container's bottom
      const distFromBottom = scrollRect.bottom - elRect.bottom

      let newOpacity = 1

      // Fade out near top (messages scrolling under header)
      if (distFromTop < FADE_ZONE) {
        const fade = Math.max(0, distFromTop) / FADE_ZONE
        newOpacity = Math.min(newOpacity, fade)
      }

      // Fade out near bottom (messages scrolling under input panel)
      if (distFromBottom < FADE_ZONE) {
        const fade = Math.max(0, distFromBottom) / FADE_ZONE
        newOpacity = Math.min(newOpacity, fade)
      }

      // Clamp 0..1
      newOpacity = Math.max(0, Math.min(1, newOpacity))

      setOpacity((prev) => (prev !== newOpacity ? newOpacity : prev))
    }

    // Initial compute
    compute()

    // Listen to scroll on the scroll container
    const onScroll = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(compute)
      }
    }
    scroll.addEventListener('scroll', onScroll, { passive: true })

    // Also recompute on resize (container size may change)
    const onResize = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(compute)
      }
    }
    window.addEventListener('resize', onResize)

    return () => {
      scroll.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [elRef, scrollRef])

  return opacity
}
