'use client'

// ============================================================================
// MiniPlayer — v25.19: плавающая пилюля-плеер (мобайл), как в Spotify.
// ----------------------------------------------------------------------------
// Раньше этот компонент был display:none (заменён «волны в шапке»), и
// владелец во время прослушивания НЕ ВИДЕЛ никакого плеера — отсюда
// «плеер всё ещё старый, там нечего нового». Теперь это заметная, но
// компактная стеклянная пилюля НАД нижней навигацией (слева, чтобы не
// спорить с плавающей кнопкой ИИ-агента справа):
//   • обложка с мягким свечением при воспроизведении;
//   • название + исполнитель;
//   • play/pause (градиентная кнопка) и закрытие;
//   • тонкая градиентная линия прогресса снизу.
// Тап по пилюле открывает полный экран-плеер (open-music-player).
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, X, Music2 } from 'lucide-react'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { assetUrl } from '@/lib/api'
import { cn } from '@/lib/utils'

export function MiniPlayer() {
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const progress = useAudioPlayer((s) => s.progress)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const stop = useAudioPlayer((s) => s.stop)

  const openFullPlayer = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-music-player'))
    }
  }

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          initial={{ y: 80, opacity: 0, scale: 0.92 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 80, opacity: 0, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30, mass: 0.85 }}
          className="md:hidden fixed z-40 left-3 right-[74px]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 86px)' }}
        >
          <div
            className="relative overflow-hidden rounded-2xl cursor-pointer"
            onClick={openFullPlayer}
            style={{
              background: 'color-mix(in oklch, var(--card) 88%, transparent)',
              backdropFilter: 'blur(24px) saturate(170%)',
              WebkitBackdropFilter: 'blur(24px) saturate(170%)',
              border: '1px solid color-mix(in oklch, var(--border) 70%, transparent)',
              boxShadow: '0 14px 40px -10px rgba(15,23,42,0.45), 0 0 0 1px rgba(255,255,255,0.05) inset',
            }}
          >
            {/* Обложка с мягким глоу при воспроизведении */}
            <div className="flex items-center gap-2.5 p-2 pr-2.5">
              <div className="relative shrink-0">
                {isPlaying && (
                  <motion.span
                    aria-hidden
                    className="absolute -inset-1 rounded-xl"
                    style={{ background: 'var(--gradient-brand)', opacity: 0.35, filter: 'blur(8px)' }}
                    animate={{ opacity: [0.2, 0.45, 0.2] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <div className="relative h-11 w-11 rounded-xl overflow-hidden grid place-items-center">
                  {currentTrack.coverUrl ? (
                    <img
                      src={assetUrl(currentTrack.coverUrl)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      className="h-full w-full grid place-items-center"
                      style={{ background: 'var(--gradient-brand)' }}
                    >
                      <Music2 className="h-4.5 w-4.5 text-white" style={{ width: 18, height: 18 }} />
                    </div>
                  )}
                </div>
              </div>

              {/* Название + исполнитель */}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate text-foreground">
                  {currentTrack.title}
                </div>
                {currentTrack.subtitle && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    {currentTrack.subtitle}
                  </div>
                )}
              </div>

              {/* Play/Pause */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  togglePlay()
                }}
                className={cn(
                  'shrink-0 h-9 w-9 rounded-full grid place-items-center transition-all active:scale-90 text-white',
                )}
                style={{
                  background: 'linear-gradient(135deg, #EC4899 0%, #A855F7 100%)',
                  boxShadow: '0 6px 18px -6px rgba(160,32,112,0.65)',
                }}
                aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" fill="currentColor" />
                ) : (
                  <Play className="h-4 w-4 ml-0.5" fill="currentColor" />
                )}
              </button>

              {/* Стоп */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  stop()
                }}
                className="shrink-0 h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
                aria-label="Закрыть плеер"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Градиентная линия прогресса снизу */}
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-foreground/10">
              <div
                className="h-full transition-[width] duration-150 ease-linear"
                style={{
                  width: `${progress * 100}%`,
                  background: 'linear-gradient(90deg, #EC4899, #A855F7)',
                  boxShadow: isPlaying ? '0 0 10px rgba(168,85,247,0.8)' : 'none',
                }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
