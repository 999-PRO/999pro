'use client'

// ============================================================================
// CommunicationChooser — v25.19 (owner):
// «пусть будет одна кнопка: нажимаешь — появляется выбор между чатом и
// сообществом». Плавающая кнопка «Общение» в bottom-nav диспетчит событие
// 'open-communication-chooser', этот глобальный оверлей рисует красивый
// bottom-sheet с двумя крупными карточками-вариантами.
//
// Дизайн: стеклянный лист с ручкой, две большие карточки с градиентными
// орбами (Сообщества — фиолет, Чат — изумруд), spring-вход, stagger,
// закрытие по фону/Esc/свайпу-ручке не делаем (просто тап по фону/крестику).
// ============================================================================

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, MessageSquare, X } from 'lucide-react'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { haptic } from '@/lib/haptic'

export function CommunicationChooser({
  onNavigate,
}: {
  onNavigate: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  useScrollLock(open)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('open-communication-chooser', onOpen as EventListener)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('open-communication-chooser', onOpen as EventListener)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const go = (view: 'chat' | 'community') => {
    haptic.select()
    setOpen(false)
    // Небольшая задержка — пусть лист красиво уйдёт, потом навигация.
    setTimeout(() => onNavigate(view), 180)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Фон */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[96] bg-black/50"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={() => setOpen(false)}
          />

          {/* Лист */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }}
            className="fixed left-0 right-0 bottom-0 z-[97] mx-auto max-w-md"
          >
            <div
              className="rounded-t-[30px] overflow-hidden relative"
              style={{
                background: 'linear-gradient(180deg, rgba(15,15,30,0.96) 0%, rgba(10,10,20,0.98) 100%)',
                backdropFilter: 'blur(28px) saturate(160%)',
                WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderBottom: 'none',
                boxShadow: '0 -24px 70px -12px rgba(0,0,0,0.65)',
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
              }}
            >
              {/* Аурора-свечение */}
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[70%] h-36"
                style={{
                  background: 'radial-gradient(ellipse at center top, rgba(139,92,246,0.22) 0%, rgba(16,185,129,0.08) 48%, transparent 75%)',
                  filter: 'blur(10px)',
                }}
              />
              <div aria-hidden className="absolute top-2 left-1/2 -translate-x-1/2 h-[3px] w-20 rounded-full bg-white/25 z-10" />

              {/* Шапка */}
              <div className="relative z-10 flex items-center justify-between px-5 pt-6 pb-1">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Общение</div>
                  <div className="text-lg font-extrabold text-white tracking-tight mt-0.5">Что выбираете?</div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Закрыть"
                  className="h-9 w-9 rounded-full grid place-items-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
                </button>
              </div>

              {/* Две карточки */}
              <div className="relative z-10 grid grid-cols-2 gap-3 px-4 pt-3">
                {/* Сообщества */}
                <motion.button
                  initial={{ opacity: 0, y: 26, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.06, type: 'spring', stiffness: 300, damping: 22 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => go('community')}
                  className="group relative overflow-hidden rounded-3xl p-4 text-left"
                  style={{
                    background: 'linear-gradient(150deg, rgba(124,58,237,0.28) 0%, rgba(139,92,246,0.10) 60%, rgba(255,255,255,0.04) 100%)',
                    border: '1px solid rgba(139,92,246,0.35)',
                    boxShadow: '0 16px 40px -18px rgba(124,58,237,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
                  }}
                >
                  <span
                    aria-hidden
                    className="absolute -top-8 -right-8 h-24 w-24 rounded-full pointer-events-none transition-transform duration-500 group-hover:scale-125"
                    style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.4) 0%, transparent 70%)' }}
                  />
                  <span
                    className="relative grid place-items-center h-12 w-12 rounded-2xl mb-6"
                    style={{
                      background: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
                      boxShadow: '0 10px 24px -8px rgba(124,58,237,0.7), inset 0 1px 0 rgba(255,255,255,0.3)',
                    }}
                  >
                    <Users className="h-6 w-6 text-white" strokeWidth={2.2} />
                  </span>
                  <div className="text-white font-extrabold text-[15px] tracking-tight">Сообщества</div>
                  <div className="text-white/60 text-[11px] mt-0.5 leading-snug">
                    Объявления,<br />барахолка, опт-клуб
                  </div>
                </motion.button>

                {/* Чат */}
                <motion.button
                  initial={{ opacity: 0, y: 26, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.12, type: 'spring', stiffness: 300, damping: 22 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => go('chat')}
                  className="group relative overflow-hidden rounded-3xl p-4 text-left"
                  style={{
                    background: 'linear-gradient(150deg, rgba(16,185,129,0.26) 0%, rgba(5,150,105,0.10) 60%, rgba(255,255,255,0.04) 100%)',
                    border: '1px solid rgba(16,185,129,0.35)',
                    boxShadow: '0 16px 40px -18px rgba(5,150,105,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
                  }}
                >
                  <span
                    aria-hidden
                    className="absolute -top-8 -right-8 h-24 w-24 rounded-full pointer-events-none transition-transform duration-500 group-hover:scale-125"
                    style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.4) 0%, transparent 70%)' }}
                  />
                  <span
                    className="relative grid place-items-center h-12 w-12 rounded-2xl mb-6"
                    style={{
                      background: 'linear-gradient(135deg, #34D399 0%, #059669 100%)',
                      boxShadow: '0 10px 24px -8px rgba(5,150,105,0.65), inset 0 1px 0 rgba(255,255,255,0.3)',
                    }}
                  >
                    <MessageSquare className="h-6 w-6 text-white" strokeWidth={2.2} />
                  </span>
                  <div className="text-white font-extrabold text-[15px] tracking-tight">Чат</div>
                  <div className="text-white/60 text-[11px] mt-0.5 leading-snug">
                    Диалоги, звонки,<br />фото и файлы
                  </div>
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
