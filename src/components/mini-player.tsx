'use client'

// ============================================================================
// MiniPlayer — компактный стеклянный плеер внизу приложения.
// ----------------------------------------------------------------------------
// Показывается, когда в AudioPlayerManager есть активный трек.
//    • Обложка (или градиент-плейсхолдер для voice)
//    • Название + подзаголовок
//    • Play/Pause
//    • Прогресс-бар
// При клике — открывает полный music player (dispatch 'open-music-player').
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
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.9 }}
          // v16.9.6: Hidden — the HeaderAudioPlayer now shows the playing
          // track in the header. This MiniPlayer is kept for the close
          // button (stop playback) but visually hidden via CSS.
          className="fixed left-0 right-0 z-40 mx-auto max-w-md px-3"
          style={{
            top: 'calc(env(safe-area-inset-top) + 60px)',
            // v16.9.6: Hidden — HeaderAudioPlayer replaces this.
            display: 'none',
          }}
        >
          <div
            className="relative overflow-hidden rounded-2xl cursor-pointer"
            onClick={openFullPlayer}
            style={{
              background: 'color-mix(in oklch, var(--card) 82%, transparent)',
              backdropFilter: 'blur(24px) saturate(160%)',
              WebkitBackdropFilter: 'blur(24px) saturate(160%)',
              border: '1px solid color-mix(in oklch, var(--border) 70%, transparent)',
              boxShadow:
                '0 8px 32px -8px rgba(15,23,42,0.3), 0 0 0 1px rgba(255,255,255,0.04) inset',
            }}
          >
            {/* Прогресс-бар — тонкая полоска сверху. */}
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-foreground/10">
              <div
                className="h-full transition-[width] duration-100 ease-linear"
                style={{
                  width: `${progress * 100}%`,
                  background: 'var(--gradient-brand)',
                }}
              />
            </div>

            <div className="flex items-center gap-3 p-2.5">
              {/* Обложка */}
              <div className="relative h-11 w-11 shrink-0 rounded-xl overflow-hidden grid place-items-center">
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
                    {currentTrack.kind === 'voice' ? (
                      <Music2 className="h-4 w-4 text-white/80" />
                    ) : (
                      <Music2 className="h-4 w-4 text-white/90" />
                    )}
                  </div>
                )}
                {/* Soft pulse when playing */}
                {isPlaying && (
                  <motion.div
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ boxShadow: '0 0 12px 2px var(--primary)' }}
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </div>

              {/* Title + subtitle */}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate text-foreground">
                  {currentTrack.title}
                </div>
                {currentTrack.subtitle && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    {currentTrack.subtitle}
                  </div>
                )}
              </div>

              {/* Play/Pause — стопает propagation чтобы не открыть full player. */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  togglePlay()
                }}
                className={cn(
                  'shrink-0 h-9 w-9 rounded-full grid place-items-center transition-all active:scale-90',
                )}
                style={{
                  background: 'var(--gradient-brand)',
                  border: '1px solid rgba(255,255,255,0.18)',
                }}
                aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4 text-white" fill="currentColor" />
                ) : (
                  <Play className="h-4 w-4 ml-0.5 text-white" fill="currentColor" />
                )}
              </button>

              {/* Close — останавливает и скрывает mini-player. */}
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
