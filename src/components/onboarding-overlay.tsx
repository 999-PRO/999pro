'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
// v13.2 (audit P1-12 fix): subscribe to auth store instead of reading
// localStorage only on mount.
import { useAuthStore } from '@/lib/auth-store'
import {
  ShoppingBag, MessageCircle, Crown, ChevronRight, ChevronLeft,
  Sparkles, LayoutGrid, Star,
} from 'lucide-react'

// ============================================================================
// OnboardingOverlay — first-time user onboarding.
//
// v25.16 PREMIUM REDESIGN (owner: «окна с подсказками… сделай красивыми»):
//   • Полноэкранный сценовый фон: мягкое анимированное mesh-свечение
//     под цвет слайда + плавающие орбы — как в дорогих финтех-приложениях.
//   • Гигантская иконка в многослойном стеклянном медальоне с тормозящей
//     пружиной и параллаксом при смене слайда (вместо плоского блока).
//   • Верхний ПРОГРЕСС-БАР сегментами (как в сторис) вместо точек снизу.
//   • Мягкие карточные формы (rounded-[32px]), типографика крупнее,
//     буллеты-плюсы (что получит пользователь), аккуратный футер.
//   • Функционально всё то же: показ на первом входе, флаг completed в
//     localStorage, 4 слайда, кнопки Назад/Далее/Начать/Пропустить.
// ============================================================================

const ONBOARDING_KEY = '999pro-onboarding-completed-v1'

interface Slide {
  icon: typeof ShoppingBag
  emoji: string
  title: string
  description: string
  bullets: string[]
  gradient: [string, string]
}

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    emoji: '✨',
    title: 'Добро пожаловать в TRI999',
    description:
      'Современный маркетплейс, где всё главное — в одном приложении.',
    bullets: ['Каталог и живая лента товаров', 'Чат с аудио- и видеозвонками', 'Эксклюзивный клуб привилегий'],
    gradient: ['#38BDF8', '#8B5CF6'],
  },
  {
    icon: ShoppingBag,
    emoji: '🛍️',
    title: 'Покупайте в пару касаний',
    description:
      'Находите нужное в каталоге, добавляйте в избранное и отправляйте заявку за секунды.',
    bullets: ['♥ — избранное на любой карточке', 'Корзина и купоны на скидку', 'Доставка и статусы заказа'],
    gradient: ['#FB923C', '#EF4444'],
  },
  {
    icon: MessageCircle,
    emoji: '💬',
    title: 'Живое общение',
    description:
      'Общайтесь голосом: текст, фото, видео и голосовые сообщения в одном чате.',
    bullets: ['Аудио- и видеозвонки', 'Фото, видео, музыка в диалогах', 'Мгновенные push-уведомления'],
    gradient: ['#10B981', '#0D9488'],
  },
  {
    icon: Crown,
    emoji: '💎',
    title: '999 CLUB — привилегии для вас',
    description:
      'Зарабатывайте баллы и открывайте бонусы, подарки и розыгрыши.',
    bullets: ['Баллы за покупки и задания', 'Купоны и бесплатные розыгрыши', 'Приглашайте друзей за бонусы'],
    gradient: ['#F59E0B', '#EC4899'],
  },
]

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false)
  const [slide, setSlide] = useState(0)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated) return
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY)
      if (completed) return
      // Small delay so it doesn't conflict with the splash overlay fade-out.
      const t = setTimeout(() => setVisible(true), 800)
      return () => clearTimeout(t)
    } catch {
      // localStorage unavailable — skip onboarding
    }
  }, [isAuthenticated])

  const complete = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1')
    } catch {}
    setVisible(false)
  }

  const next = () => {
    hapticLite()
    if (slide < SLIDES.length - 1) setSlide(slide + 1)
    else complete()
  }

  const prev = () => {
    hapticLite()
    if (slide > 0) setSlide(slide - 1)
  }

  const skip = complete

  const current = SLIDES[slide]
  const Icon = current.icon
  const isLast = slide === SLIDES.length - 1

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden"
          style={{ background: 'rgba(2, 6, 23, 0.92)', backdropFilter: 'blur(16px)' }}
        >
          {/* ═══ Сценовый фон: mesh-свечение в цветах слайда + орбы ═══ */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`bg-${slide}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7 }}
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  `radial-gradient(60% 50% at 25% 20%, ${current.gradient[0]}30 0%, transparent 60%),` +
                  `radial-gradient(55% 45% at 80% 80%, ${current.gradient[1]}38 0%, transparent 65%)`,
              }}
            />
          </AnimatePresence>
          {/* Плавающие орбы */}
          {[0, 1, 2].map((i) => (
            <motion.span
              key={`orb-${i}`}
              aria-hidden
              className="absolute rounded-full pointer-events-none"
              style={{
                width: 180 + i * 90,
                height: 180 + i * 90,
                left: `${[8, 62, 34][i]}%`,
                top: `${[12, 55, 74][i]}%`,
                background: `radial-gradient(circle at 30% 30%, ${current.gradient[i % 2]}22, transparent 70%)`,
                filter: 'blur(28px)',
              }}
              animate={{ y: [0, -18, 0], scale: [1, 1.06, 1] }}
              transition={{ duration: 9 + i * 2.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}

          {/* Пропустить — стеклянная пилюля сверху справа */}
          <button
            onClick={skip}
            className="absolute top-5 right-5 z-10 h-9 px-4 rounded-full text-white/85 hover:text-white text-sm font-medium transition-colors border border-white/15 bg-white/5 hover:bg-white/10 backdrop-blur-md active:scale-95"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
            }}
          >
            Пропустить
          </button>

          <motion.div
            key={slide}
            initial={{ opacity: 0, x: 44, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -44, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            className="relative w-full max-w-md z-[1]"
          >
            {/* ═══ КАРТОЧКА ═══ */}
            <div className="rounded-[32px] overflow-hidden shadow-[0_40px_120px_-32px_rgba(0,0,0,0.75)] bg-card ring-1 ring-white/10">
              {/* Прогресс-сегменты поверх хедера (в стиле сторис) */}
              <div className="flex gap-1.5 px-5 pt-5" role="progressbar" aria-valuenow={slide + 1} aria-valuemin={1} aria-valuemax={SLIDES.length}>
                {SLIDES.map((_, i) => (
                  <span key={i} className="h-1 flex-1 rounded-full overflow-hidden bg-black/10 dark:bg-white/10">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: i <= slide ? `linear-gradient(90deg, ${current.gradient[0]}, ${current.gradient[1]})` : 'transparent' }}
                      initial={false}
                      animate={{ scaleX: i <= slide ? 1 : 0 }}
                      transition={{ duration: 0.35 }}
                    />
                  </span>
                ))}
              </div>

              {/* МЕДАЛЬОН: гигантская иконка в многослойном стекле */}
              <div className="relative grid place-items-center py-8">
                {/* мягкая цветная подложка */}
                <div
                  className="absolute h-52 w-52 rounded-full blur-3xl opacity-40"
                  style={{ background: `linear-gradient(135deg, ${current.gradient[0]}, ${current.gradient[1]})` }}
                />
                <motion.div
                  initial={{ scale: 0.6, rotate: -8 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.05 }}
                  className="relative grid place-items-center"
                >
                  {/* внешнее пульсирующее кольцо */}
                  <motion.span
                    aria-hidden
                    className="absolute -inset-5 rounded-full border"
                    style={{ borderColor: `${current.gradient[0]}40` }}
                    animate={{ scale: [1, 1.09, 1], opacity: [0.5, 0.15, 0.5] }}
                    transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  {/* стеклянный диск */}
                  <span className="h-36 w-36 rounded-full grid place-items-center relative overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${current.gradient[0]} 0%, ${current.gradient[1]} 100%)`,
                      boxShadow: `inset 0 2px 0 rgba(255,255,255,.45), inset 0 -10px 24px rgba(0,0,0,.18), 0 22px 48px -16px ${current.gradient[1]}66`,
                    }}>
                    {/* блик стекла */}
                    <span aria-hidden className="absolute inset-x-2 top-1 h-1/2 rounded-full pointer-events-none"
                      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.04))' }} />
                    <Icon className="relative z-[1] h-16 w-16 text-white drop-shadow-lg" strokeWidth={1.7} />
                  </span>
                  {/* мини-эмодзи бейдж */}
                  <motion.span
                    initial={{ scale: 0, rotate: 10 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.22 }}
                    className="absolute -bottom-1 -right-1 h-11 w-11 rounded-2xl bg-background ring-1 ring-border grid place-items-center text-xl shadow-lg"
                  >
                    {current.emoji}
                  </motion.span>
                </motion.div>
              </div>

              {/* Текстовая часть */}
              <div className="px-7 pb-1 text-center">
                <h2 className="text-[22px] leading-snug font-extrabold tracking-tight text-foreground mb-2">
                  {current.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  {current.description}
                </p>
              </div>

              {/* Буллеты-бонусы */}
              <div className="px-7 pt-4 space-y-2">
                {current.bullets.map((b, bi) => (
                  <motion.div
                    key={b}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.18 + bi * 0.08, duration: 0.3 }}
                    className="flex items-center gap-2.5"
                  >
                    <span
                      className="h-5 w-5 rounded-full grid place-items-center shrink-0"
                      style={{ background: `linear-gradient(135deg, ${current.gradient[0]}26, ${current.gradient[1]}26)` }}
                    >
                      <Star className="h-2.5 w-2.5" style={{ color: current.gradient[1] }} fill="currentColor" />
                    </span>
                    <span className="text-[13px] font-medium text-foreground/90">{b}</span>
                  </motion.div>
                ))}
              </div>

              {/* Футер: назад · далее · шаги */}
              <div className="flex items-center justify-between gap-2 p-5 pt-4">
                {slide > 0 ? (
                  <Button variant="ghost" size="sm" onClick={prev} className="rounded-full h-11 px-4 text-sm shrink-0">
                    <ChevronLeft className="h-4 w-4 mr-0.5" />
                    Назад
                  </Button>
                ) : (
                  <div className="w-2 shrink-0" />
                )}

                <Button
                  onClick={next}
                  size="lg"
                  className="rounded-full text-white font-bold h-11 px-7 flex-1 max-w-[220px] text-sm shadow-glow hover:brightness-110 active:scale-[0.98] transition-all"
                  style={{ background: `linear-gradient(135deg, ${current.gradient[0]}, ${current.gradient[1]})` }}
                >
                  {isLast ? (
                    <>
                      Начать пользоваться
                      <Sparkles className="h-4 w-4 ml-1.5" />
                    </>
                  ) : (
                    <>
                      Далее
                      <ChevronRight className="h-4 w-4 ml-0.5" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Подпись бренда под картой */}
            <div className="mt-4 flex items-center justify-center gap-1.5 text-white/50 text-xs font-semibold tracking-wide">
              <LayoutGrid className="h-3.5 w-3.5" />
              TRI999
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function hapticLite() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(8)
  } catch {}
}
