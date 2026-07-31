'use client'

/**
 * FloatingChatButton — мягкая стеклянная кнопка с фазовой анимацией.
 *
 * Каждый цикл (10 секунд):
 *   0–4с   → фаза "button": видна только иконка в круглом стеклянном пузыре
 *   4–5с   → плавный crossfade: иконка исчезает (fade + scale), появляется текст
 *   5–9с   → фаза "text": видна только надпись ("Общайтесь" / "Пишите нам" / ...)
 *   9–10с  → плавный crossfade: текст исчезает, появляется иконка
 *
 * Каждый полный цикл (10с) фон пузыря плавно меняется на новую пастельную
 * палитру через crossfade слоёв. Сами палитры — мягкие, полупрозрачные,
 * с сильным blur для эффекта frosted glass.
 *
 * Постоянное мягкое дыхание (scale + glow) идёт поверх фазовой анимации.
 */

import { useEffect, useState, useRef } from 'react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'
import { MessageCircle } from 'lucide-react'
import { useTheme } from 'next-themes'
import { haptic } from '@/lib/haptic'
import { useNotificationsStore } from '@/lib/use-notifications'
import { CountBadge } from '@/components/ui/count-badge'

interface FloatingChatButtonProps {
  active: boolean
  onClick: () => void
}

// Мягкие тонкие стеклянные градиенты. Прозрачность ~0.32-0.38 — краска
// едва заметна, сквозь неё явно виден размытый фон. Эффект "лёгкого
// тонированного стекла" — как цветная витражная плёнка.
//
// 9 цветов: синий, голубой, зелёный, малиновый, розовый, красный,
// жёлтый, оранжевый, золотой. Все нежные, пастельные.
const PALETTES = [
  {
    // 1. Синий (blue)
    gradient: 'linear-gradient(135deg, rgba(59,130,246,0.38) 0%, rgba(37,99,235,0.32) 100%)',
    glow: 'rgba(59, 130, 246, 0.3)',
  },
  {
    // 2. Голубой (sky)
    gradient: 'linear-gradient(135deg, rgba(14,165,233,0.38) 0%, rgba(2,132,199,0.32) 100%)',
    glow: 'rgba(14, 165, 233, 0.3)',
  },
  {
    // 3. Зелёный (emerald)
    gradient: 'linear-gradient(135deg, rgba(16,185,129,0.38) 0%, rgba(5,150,105,0.32) 100%)',
    glow: 'rgba(16, 185, 129, 0.3)',
  },
  {
    // 4. Малиновый (fuchsia)
    gradient: 'linear-gradient(135deg, rgba(217,70,239,0.38) 0%, rgba(190,24,93,0.32) 100%)',
    glow: 'rgba(217, 70, 239, 0.3)',
  },
  {
    // 5. Розовый (pink)
    gradient: 'linear-gradient(135deg, rgba(236,72,153,0.38) 0%, rgba(219,39,119,0.32) 100%)',
    glow: 'rgba(236, 72, 153, 0.3)',
  },
  {
    // 6. Красный (red)
    gradient: 'linear-gradient(135deg, rgba(239,68,68,0.38) 0%, rgba(220,38,38,0.32) 100%)',
    glow: 'rgba(239, 68, 68, 0.3)',
  },
  {
    // 7. Жёлтый (yellow)
    gradient: 'linear-gradient(135deg, rgba(234,179,8,0.38) 0%, rgba(202,138,4,0.32) 100%)',
    glow: 'rgba(234, 179, 8, 0.3)',
  },
  {
    // 8. Оранжевый (orange)
    gradient: 'linear-gradient(135deg, rgba(249,115,22,0.38) 0%, rgba(234,88,12,0.32) 100%)',
    glow: 'rgba(249, 115, 22, 0.3)',
  },
  {
    // 9. Золотой (amber)
    gradient: 'linear-gradient(135deg, rgba(245,158,11,0.38) 0%, rgba(217,119,6,0.32) 100%)',
    glow: 'rgba(245, 158, 11, 0.3)',
  },
] as const

// Мягкие дружелюбные фразы — меняются каждый цикл (когда показывается фаза text).
const PHRASES = ['Общайтесь', 'Пишите нам', 'Будьте на связи', 'На связи', 'Напишите нам'] as const

// Neon тема — единая фиолетово-синяя палитра (без радужных переливов)
const NEON_PALETTE = {
  gradient: 'linear-gradient(135deg, rgba(99,102,241,0.35) 0%, rgba(139,92,246,0.3) 50%, rgba(236,72,153,0.2) 100%)',
  glow: 'rgba(139, 92, 246, 0.35)',
}

const PHASE_DURATION_MS = 5000 // 5 секунд на фазу (итого цикл 10с)

export function FloatingChatButton({ active, onClick }: FloatingChatButtonProps) {
  const unreadTotal = useNotificationsStore((s) => s.unread.total)
  const reduceMotion = useReducedMotion()
  const { theme } = useTheme()
  const isNeon = theme === 'neon'
  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState<'button' | 'text'>('button')
  const [paletteIdx, setPaletteIdx] = useState(0)
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const cycleCount = useRef(0)

  useEffect(() => setMounted(true), [])

  // v13.3: detect when a full-screen overlay (stories viewer, product page,
  // sheets, lightbox) is open so we can hide the floating chat button.
  // We use a MutationObserver with subtree:true so we catch overlays that
  // mount deep inside React's tree (e.g. StoriesViewer renders inside a
  // <section>, not directly under body).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const check = () => {
      // Selector matches: stories viewer, product page overlay, image lightbox,
      // any full-screen modal marked with [data-floating-chat-hide].
      const found = document.querySelector(
        '[data-floating-chat-hide], .fixed.inset-0.z-50, .fixed.inset-0.z-\\[80\\]',
      )
      setOverlayOpen(!!found)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: false })
    return () => observer.disconnect()
  }, [])

  // Фазовая анимация: каждые 5с переключаем button ↔ text.
  // Когда возвращаемся к 'button' — полный цикл завершён, меняем палитру и фразу.
  useEffect(() => {
    if (!mounted) return
    const id = setInterval(() => {
      setPhase((cur) => {
        if (cur === 'button') {
          // button → text: ничего не меняем кроме фазы
          return 'text'
        }
        // text → button: полный цикл завершён
        cycleCount.current += 1
        setPaletteIdx((c) => (c + 1) % PALETTES.length)
        setPhraseIdx((c) => (c + 1) % PHRASES.length)
        return 'button'
      })
    }, PHASE_DURATION_MS)
    return () => clearInterval(id)
  }, [mounted])

  // Hide when chat is active OR a full-screen overlay (stories, product page,
  // lightbox) is open — avoids the button floating over the overlay.
  if (active || !mounted || overlayOpen) return null

  // Размеры пузыря для каждой фазы
  const bubbleSize = phase === 'button' ? 56 : 140

  return (
    <motion.button
      type="button"
      aria-label={`Чат${unreadTotal > 0 ? `, непрочитанных: ${unreadTotal}` : ''}`}
      onClick={() => {
        haptic.tap()
        onClick()
      }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          haptic.tap()
          onClick()
        }
      }}
      // Animations: width morph + breathing (scale). Они объединяются
      // framer-motion'ом — width анимируется своим transition, scale своим.
      animate={
        reduceMotion
          ? { width: bubbleSize }
          : { width: bubbleSize, scale: [1, 1.025, 1] }
      }
      transition={
        reduceMotion
          ? { duration: 0.3 }
          : {
              width: { type: 'spring', stiffness: 180, damping: 24, mass: 1.1 },
              scale: { duration: 3.5, repeat: Infinity, ease: 'easeInOut' },
            }
      }
      whileHover={reduceMotion ? undefined : { scale: 1.04 }}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
      className="md:hidden fixed right-4 z-50 grid place-items-center overflow-visible select-none cursor-pointer"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 84px)',
        height: 56,
        borderRadius: 999,
        position: 'fixed',
      }}
    >
      {/* === СЛОИ ЦВЕТА ===
          Neon: единая фиолетово-синяя палитра (без радужных переливов)
          Другие темы: crossfade палитр как раньше */}
      <div className="absolute inset-0 rounded-[inherit] overflow-hidden">
        {isNeon ? (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ backgroundImage: NEON_PALETTE.gradient }}
          />
        ) : (
          PALETTES.map((p, i) => (
            <motion.div
              key={i}
              aria-hidden
              className="absolute inset-0"
              animate={{ opacity: paletteIdx === i ? 1 : 0 }}
              transition={{ duration: 2.5, ease: [0.4, 0, 0.2, 1] }}
              style={{ backgroundImage: p.gradient }}
            />
          ))
        )}
      </div>

      {/* === Мягкое тонкое стекло ===
          Neon: фиолетовая окантовка + neon glow
          Другие темы: белые акценты как раньше */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-[inherit] pointer-events-none"
        style={isNeon ? {
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          boxShadow:
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.15), ' +
            'inset 0 -0.5px 0 0 rgba(139, 92, 246, 0.1), ' +
            '0 4px 20px -4px rgba(139, 92, 246, 0.3)',
        } : {
          backdropFilter: 'blur(14px) saturate(160%)',
          WebkitBackdropFilter: 'blur(14px) saturate(160%)',
          border: '1px solid rgba(255, 255, 255, 0.22)',
          boxShadow:
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.3), ' +
            'inset 0 -0.5px 0 0 rgba(255, 255, 255, 0.1)',
        }}
      />

      {/* === Верхний блик — совсем тонкий ===
          Едва заметный белый градиент сверху. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1/2 rounded-t-[inherit] pointer-events-none z-10"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 60%, transparent 100%)',
        }}
      />

      {/* === КОНТЕНТ: иконка ↔ текст (crossfade через AnimatePresence) ===
          Переход 0.8с с blur и мягким easing — dreamy, как облако.
          Иконка и текст — белые с лёгкой тёмной тенью (text-shadow) для
          читаемости на любом цветном стекле. */}
      <span className="relative z-20 grid place-items-center w-full h-full">
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'button' ? (
            <motion.span
              key="icon"
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, scale: 0.3, rotate: -120, filter: 'blur(8px)' }
              }
              animate={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: 1, scale: 1, rotate: 0, filter: 'blur(0px)' }
              }
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, scale: 0.3, rotate: 120, filter: 'blur(8px)' }
              }
              transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
              className="grid place-items-center text-white"
            >
              <MessageCircle
                className="h-[24px] w-[24px]"
                strokeWidth={2.3}
                fill="rgba(255,255,255,0.3)"
              />
            </motion.span>
          ) : (
            <motion.span
              key="text"
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, scale: 0.6, y: 10, filter: 'blur(6px)' }
              }
              animate={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }
              }
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, scale: 0.6, y: -10, filter: 'blur(6px)' }
              }
              transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
              className="text-white text-[14px] font-semibold tracking-tight whitespace-nowrap px-3"
            >
              {PHRASES[phraseIdx]}
            </motion.span>
          )}
        </AnimatePresence>
      </span>

      {/* === Бейдж непрочитанных ===
          Якорь: правый верхний угол ИКОНКИ чата.

          Контекст: motion.button анимирует `width` от 56px (фаза "button")
          до 140px (фаза "text"). Если бейдж виден во время фазы "text",
          он визуально "уезжает" от иконки к правому краю широкой плашки.

          Решение:
          • Бейдж показываем ТОЛЬКО в фазе "button" (когда видна иконка).
          • Позиция — `absolute`, отсчитывается от правого верхнего угла
            motion.button (56×56 в этой фазе). Смещение -top-1 -right-1
            ставит бейдж ровно в угол круглой кнопки.
          • z-30 — выше слоёв цвета и стекла.
          • CountBadge принимает className последним в cn() (tailwind-merge),
            так что позиционные классы применяются поверх базовых. */}
      {unreadTotal > 0 && phase === 'button' && (
        <CountBadge
          count={unreadTotal}
          size="sm"
          className="-top-1 -right-1 z-30"
        />
      )}

      {/* === Hover indicator — мягкое усиление glow при hover (без обводки) === */}
    </motion.button>
  )
}
