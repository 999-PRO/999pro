'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
// v13.2 (audit P1-12 fix): subscribe to auth store instead of reading
// localStorage only on mount. Previously the effect ran once on mount —
// if the user logged in later (without a hard reload), onboarding never
// appeared. Now we reactively subscribe to isAuthenticated.
import { useAuthStore } from '@/lib/auth-store'
import {
  ShoppingBag, MessageCircle, Heart, Phone, X,
  ChevronRight, ChevronLeft, Sparkles,
} from 'lucide-react'

// ============================================================================
// OnboardingOverlay — first-time user onboarding.
// ----------------------------------------------------------------------------
// Shows a 4-slide carousel explaining the app's key features when the user
// first logs in. Dismissed state is persisted in localStorage so it never
// shows again (unless the user clears site data).
//
// Slides:
//   1. Welcome — brand intro
//   2. Catalog — browse products, add to favorites & cart
//   3. Chat — find any user by nickname, start conversations
//   4. Support — pinned support chat with the team
//
// Triggers:
//   - Shows on first login (after registration or first login of existing user)
//   - The parent component decides when to show (e.g. after fetchMe succeeds)
//   - Once dismissed, the localStorage flag prevents re-showing
// ============================================================================

const ONBOARDING_KEY = '999pro-onboarding-completed-v1'

interface Slide {
  icon: typeof ShoppingBag
  emoji: string
  title: string
  description: string
  gradient: string
}

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    emoji: '✨',
    title: 'Добро пожаловать в «Три девятки»',
    description:
      'Современный маркетплейс с каталогом товаров, историями, живым чатом с аудио- и видеозвонками, и эксклюзивным клубом привилегий 999 CLUB. Всё, что нужно — в одном приложении.',
    gradient: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 50%, #7c3aed 100%)',
  },
  {
    icon: ShoppingBag,
    emoji: '🛍️',
    title: 'Каталог и покупки',
    description:
      'Откройте каталог, чтобы увидеть сотни товаров. Нажмите ♥, чтобы добавить в избранное. Добавьте в корзину и оформите заказ с доставкой и купонами на скидку.',
    gradient: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)',
  },
  {
    icon: MessageCircle,
    emoji: '💬',
    title: 'Чат с продавцами',
    description:
      'Найдите любого пользователя по нику в чате. Отправляйте текст, фото, видео и голосовые сообщения. Аудио- и видеозвонки прямо из чата.',
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  },
  {
    icon: Sparkles,
    emoji: '💎',
    title: '999 CLUB — привилегии для вас',
    description:
      'Зарабатывайте баллы за покупки и задания. Получайте подарки, участвуйте в бесплатных розыгрышах, активируйте купоны на скидки и приглашайте друзей за бонусы.',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #8b5cf6 100%)',
  },
]

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false)
  const [slide, setSlide] = useState(0)
  // v13.2: reactive auth subscription — re-evaluates when login state changes.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    // Only show onboarding if:
    //   1. The user has never completed it before (localStorage flag)
    //   2. The user is authenticated (we don't want to onboard logged-out visitors)
    if (!isAuthenticated) return
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY)
      if (completed) return

      // User is authenticated AND has not seen onboarding → show it.
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
    if (slide < SLIDES.length - 1) {
      setSlide(slide + 1)
    } else {
      complete()
    }
  }

  const prev = () => {
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
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)' }}
        >
          {/* Skip button — top right */}
          <button
            onClick={skip}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-sm font-medium transition-colors z-10"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
          >
            Пропустить
          </button>

          <motion.div
            key={slide}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.3 }}
            className="relative w-full max-w-md"
          >
            <div
              className="rounded-3xl overflow-hidden shadow-2xl"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
              }}
            >
              {/* Hero header with gradient + emoji */}
              <div
                className="relative h-48 grid place-items-center overflow-hidden"
                style={{ background: current.gradient }}
              >
                <div className="absolute inset-0 opacity-30" style={{
                  backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(255,255,255,0.2) 0%, transparent 50%)',
                }} />
                <div className="relative z-10 text-center">
                  <div className="text-6xl mb-2">{current.emoji}</div>
                  <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-sm grid place-items-center mx-auto">
                    <Icon className="h-6 w-6 text-white" strokeWidth={2.2} />
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 text-center">
                <h2 className="text-xl font-bold mb-2 text-foreground">{current.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {current.description}
                </p>
              </div>

              {/* Progress dots */}
              <div className="flex justify-center gap-1.5 pb-4">
                {SLIDES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSlide(i)}
                    className="rounded-full transition-all"
                    style={{
                      width: i === slide ? 24 : 6,
                      height: 6,
                      background: i === slide ? 'var(--primary)' : 'var(--muted-foreground)',
                      opacity: i === slide ? 1 : 0.4,
                    }}
                    aria-label={`Слайд ${i + 1}`}
                  />
                ))}
              </div>

              {/* Footer with prev/next */}
              <div className="flex items-center justify-between p-4 pt-0 gap-2">
                {slide > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={prev}
                    className="rounded-full h-10 px-4"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Назад
                  </Button>
                ) : (
                  <div className="w-20" />
                )}

                <Button
                  onClick={next}
                  size="sm"
                  className="rounded-full gradient-brand text-white font-semibold h-10 px-6 shadow-glow flex-1 max-w-[200px]"
                >
                  {isLast ? (
                    <>
                      Начать
                      <Sparkles className="h-4 w-4 ml-1.5" />
                    </>
                  ) : (
                    <>
                      Далее
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
