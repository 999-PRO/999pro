'use client'

// ============================================================================
// useDragScroll — v25.27 (owner): «на десктопе в ленте категории не
// перелистываются мышкой». Хук добавляет горизонтальную прокрутку мышью
// (grab-and-drag) для overflow-x контейнеров (чипы категорий ленты/каталога).
//
// Как работает:
//   • Только pointerType === 'mouse' (тачскрин/пад используют нативный
//     скролл — поведение на телефонах не меняется).
//   • Захват pointer capture — драг продолжается за пределами контейнера.
//   • Порог 6px: обычный клик по чипу работает как раньше; после реального
//     перетаскивания первый click-event подавляется (capture-phase), чтобы
//     не «случайно» выбрать категорию при отпускании мыши.
//   • canLeft/canRight — видимость стрелок на десктопе (мобильный CSS их
//     скрывает), scrollBy() — плавная прокрутка кнопками.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const state = useRef({ dragging: false, moved: false, startX: 0, startScroll: 0 })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < max - 4)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      state.current.dragging = true
      state.current.moved = false
      state.current.startX = e.clientX
      state.current.startScroll = el.scrollLeft
    }
    const onMove = (e: PointerEvent) => {
      if (!state.current.dragging) return
      const dx = e.clientX - state.current.startX
      if (!state.current.moved && Math.abs(dx) > 6) {
        state.current.moved = true
        try { el.setPointerCapture(e.pointerId) } catch {}
      }
      if (state.current.moved) {
        el.scrollLeft = state.current.startScroll - dx
        e.preventDefault()
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!state.current.dragging) return
      state.current.dragging = false
      try { el.releasePointerCapture(e.pointerId) } catch {}
      if (state.current.moved) {
        // Подавить синтетический click после реального драга.
        const kill = (ev: Event) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        el.addEventListener('click', kill, { capture: true, once: true })
        setTimeout(() => el.removeEventListener('click', kill, { capture: true }), 80)
      }
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('scroll', update, { passive: true })
    update()

    // Следим за изменением размеров (чипы добавились/удалились — стрелки).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    if (el.firstElementChild) ro?.observe(el.firstElementChild)

    // v25.27 fix: чипы часто подгружаются асинхронно (fetch категорий) —
    // ResizeObserver на контейнер не срабатывает, т.к. ширина контейнера не
    // меняется. MutationObserver ловит добавление чипов и пересчитывает
    // видимость стрелок.
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null
    mo?.observe(el, { childList: true, subtree: true })

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('scroll', update)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [update])

  const scrollByAmount = useCallback((dx: number) => {
    ref.current?.scrollBy({ left: dx, behavior: 'smooth' })
  }, [])

  return { ref, canLeft, canRight, scrollBy: scrollByAmount, update }
}
