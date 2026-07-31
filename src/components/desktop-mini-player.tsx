'use client'

// ============================================================================
// DesktopMiniPlayer — плавающая мини-карточка плеера для десктопа.
// ----------------------------------------------------------------------------
// v16.17: На десктопе нет шапки с плеером (только сайдбар). Эта карточка
// появляется внизу справа когда играет трек — как mini-player в Spotify/Apple Music.
// Содержит:
//   • Обложка (вращается когда играет)
//   • Название + исполнитель
//   • Волнистый эквалайзер (4 полоски)
//   • Play/Pause + Close
//   • Прогресс-бар снизу
// Клик открывает полный плеер.
//
// Показывается только на десктопе (md+) и только когда есть currentTrack.
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, X, Music2, Loader2 } from 'lucide-react'
import { useAudioPlayer } from '@/lib/audio-player-manager'

export function DesktopMiniPlayer() {
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const progress = useAudioPlayer((s) => s.progress)
  const currentTime = useAudioPlayer((s) => s.currentTime)
  const duration = useAudioPlayer((s) => s.duration)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const stop = useAudioPlayer((s) => s.stop)
  const isLoading = useAudioPlayer((s) => s.isLoading)

  const openFullPlayer = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-music-player'))
    }
  }

  const formatTime = (s: number) => {
    if (!s || s < 0 || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          initial={{ y: 100, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 100, opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28, mass: 0.9 }}
          // v16.17: Desktop-only floating card, bottom-right. Positioned to
          // avoid the sidebar (left: 76-88px) and bottom-nav (mobile).
          className="hidden md:block fixed z-40 right-4 bottom-4"
          style={{ width: 320 }}
        >
          <div
            className="relative overflow-hidden rounded-2xl cursor-pointer"
            onClick={openFullPlayer}
            style={{
              background: 'color-mix(in oklch, var(--card) 88%, transparent)',
              backdropFilter: 'blur(24px) saturate(160%)',
              WebkitBackdropFilter: 'blur(24px) saturate(160%)',
              border: '1px solid color-mix(in oklch, var(--border) 70%, transparent)',
              boxShadow:
                '0 12px 40px -8px rgba(15,23,42,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset',
            }}
          >
            {/* Progress bar — thin line at the top. */}
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-foreground/10">
              <div
                className="h-full transition-[width] duration-100 ease-linear"
                style={{
                  width: `${progress * 100}%`,
                  background: 'var(--gradient-brand)',
                }}
              />
            </div>

            <div className="flex items-center gap-3 p-3">
              {/* Cover — rotates when playing (vinyl effect). */}
              <motion.div
                className="relative h-12 w-12 shrink-0 rounded-lg overflow-hidden grid place-items-center"
                animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
                transition={isPlaying ? { duration: 8, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
              >
                {currentTrack.coverUrl ? (
                   
                  <img
                    src={currentTrack.coverUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="h-full w-full grid place-items-center"
                    style={{ background: 'var(--gradient-brand)' }}
                  >
                    <Music2 className="h-5 w-5 text-white/90" />
                  </div>
                )}
              </motion.div>

              {/* Title + artist + equalizer. */}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate text-foreground">
                  {currentTrack.title}
                </div>
                {currentTrack.subtitle && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    {currentTrack.subtitle}
                  </div>
                )}
                {/* v16.17: Waveform equalizer — 4 animated bars.
                    Shows when playing, hidden when paused/loading. */}
                <div className="flex items-end gap-[2px] h-3 mt-1">
                  {isLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  ) : isPlaying ? (
                    [0, 1, 2, 3].map((i) => (
                      <motion.span
                        key={i}
                        className="w-[2px] rounded-full"
                        style={{
                          background: 'linear-gradient(to top, #a855f7, #ec4899)',
                          height: '100%',
                          transformOrigin: 'bottom',
                        }}
                        animate={{ scaleY: [0.3, 1, 0.5, 0.8, 0.3] }}
                        transition={{
                          duration: 0.7 + i * 0.12,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: i * 0.08,
                        }}
                      />
                    ))
                  ) : (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  )}
                </div>
              </div>

              {/* Play/Pause — stops propagation to not open full player. */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  togglePlay()
                }}
                className="shrink-0 h-9 w-9 rounded-full grid place-items-center transition-all active:scale-90"
                style={{
                  background: 'var(--gradient-brand)',
                  border: '1px solid rgba(255,255,255,0.18)',
                }}
                aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 text-white animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-4 w-4 text-white" fill="currentColor" />
                ) : (
                  <Play className="h-4 w-4 ml-0.5 text-white" fill="currentColor" />
                )}
              </button>

              {/* Close — stops and hides the mini-player. */}
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
