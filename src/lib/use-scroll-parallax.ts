'use client'

import { useEffect, useRef, useState } from 'react'

// ============================================================================
// v25.22: ПАРАЛЛАКС НА МОБИЛЕ — медиа-слой мягко смещается по мере скролла
// страницы (классический scroll-parallax, как в лентах Pinterest/Avito).
//
// Владелец: «не вижу, чтобы параллакс эффект был». Раньше параллакс был
// только на десктопе (tilt от мыши). Теперь любой блок с медиа на телефоне
// получает живой сдвиг фона при прокрутке.
//
// Использование:
//   const { ref, style } = useScrollParallax(enabled)
//   <div ref={ref} className="absolute inset-0 overflow-hidden">
//     <div className="absolute inset-0" style={style}>{media}</div>
//   </div>
//
// ВАЖНО: ref вешается на ВНЕШНИЙ (не трансформируемый) контейнер —
// getBoundingClientRect остаётся честным. style — на ВНУТРЕННИЙ слой,
// scale(1.14) прячет края при смещении до ±34px.
// ============================================================================

export function useScrollParallax(enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<React.CSSProperties>(
    enabled ? { transform: 'scale(1.14)', willChange: 'transform' } : {},
  )

  useEffect(() => {
    if (!enabled) return
    let raf = 0
    const update = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight || 1
      // −1 (блок у нижнего края вьюпорта) … 0 (в центре) … +1 (у верхнего)
      const progress = Math.max(-1, Math.min(1, (rect.top + rect.height / 2 - vh / 2) / vh))
      const shift = progress * -34 // до ±34px — заметно, но элегантно
      setStyle({
        transform: `translate3d(0, ${shift.toFixed(1)}px, 0) scale(1.14)`,
        willChange: 'transform',
      })
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [enabled])

  return { ref, style }
}
