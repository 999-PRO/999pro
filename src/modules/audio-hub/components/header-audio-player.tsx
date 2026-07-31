'use client'

// ============================================================================
// HeaderAudioPlayer — парящие светящиеся аудио-волны (v25)
// ----------------------------------------------------------------------------
// Нет контейнера. Нет фона. Нет карточки.
// Просто светящиеся столбики, парящие поверх шапки.
// Glass glow + neon glow + полупрозрачность.
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import { useAudioPlayer } from '@/lib/audio-player-manager'

const BAR_COUNT = 28

export function HeaderAudioPlayer() {
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)

  const openFullPlayer = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-music-player'))
    }
  }

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          onClick={openFullPlayer}
          className="absolute bottom-0 left-0 right-0 flex items-end justify-center gap-[1.5px] px-[6%] pb-[2px] cursor-pointer"
          style={{
            height: '40px',
            pointerEvents: 'auto',
          }}
        >
          {Array.from({ length: BAR_COUNT }).map((_, i) => {
            // Stable pseudo-random pattern per bar index
            const seed = (i * 37 + 13) % 100
            const baseH = 25 + (seed % 50)
            return (
              <motion.div
                key={i}
                className="flex-1 rounded-full"
                style={{
                  background: 'var(--gradient-brand)',
                  transformOrigin: 'bottom',
                  opacity: isPlaying ? 0.7 : 0.2,
                  filter: isPlaying
                    ? 'blur(0.5px) drop-shadow(0 0 4px color-mix(in oklch, var(--primary) 50%, transparent))'
                    : 'none',
                  minHeight: '3px',
                  maxWidth: '6px',
                }}
                animate={
                  isPlaying
                    ? {
                        height: [
                          `${baseH * 0.2}%`,
                          `${baseH * 0.9}%`,
                          `${baseH * 0.4}%`,
                          `${baseH * 0.75}%`,
                          `${baseH * 0.3}%`,
                          `${baseH * 0.85}%`,
                          `${baseH * 0.2}%`,
                        ],
                      }
                    : { height: `${baseH * 0.12}%` }
                }
                transition={
                  isPlaying
                    ? {
                        duration: 0.5 + (i % 5) * 0.1,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: i * 0.025,
                      }
                    : { duration: 0.5 }
                }
              />
            )
          })}

          {/* Soft neon glow overlay — no container, just light */}
          {isPlaying && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent 5%, color-mix(in oklch, var(--primary) 8%, transparent) 50%, transparent 95%)',
                filter: 'blur(8px)',
              }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
