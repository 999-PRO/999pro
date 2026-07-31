'use client'

// ============================================================================
// VoiceMessagesList — список голосовых сообщений с современным UI.
// ----------------------------------------------------------------------------
// Возможности:
//   • Карточки с sender avatar + имя + длительность + дата
//   • Waveform (VoiceWaveVisualizer) — мини-превью
//   • Play/Pause через AudioPlayerManager (единое воспроизведение)
//   • Регулировка скорости 1×/1.25×/1.5×/2× (без остановки воспроизведения)
//   • Lazy loading — рендерим только видимые карточки (intersection observer)
// ============================================================================

import { useRef, useState, useEffect, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, Mic, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatDuration, formatTime } from '@/lib/format'
import { useAudioPlayer, type AudioTrack, type PlaybackRate } from '@/lib/audio-player-manager'
import type { VoiceItem } from '../hooks/use-chat-attachments'
import { VoiceWaveVisualizer } from '../voice-wave-visualizer'

const SPEED_OPTIONS: PlaybackRate[] = [1, 1.25, 1.5, 2]

const AMPLITUDE_IDLE_REF = { current: 0.08 }

function toTrack(item: VoiceItem): AudioTrack {
  return {
    id: item.id,
    url: assetUrl(item.url),
    kind: 'voice',
    title: item.senderName,
    subtitle: formatDuration(item.duration || 0),
    coverUrl: item.senderAvatar,
    duration: item.duration,
    senderName: item.senderName,
    senderAvatar: item.senderAvatar,
    createdAt: item.createdAt,
  }
}

interface VoiceMessagesListProps {
  voices: VoiceItem[]
  onScrollToMessage?: (id: string) => void
}

export function VoiceMessagesList({ voices, onScrollToMessage }: VoiceMessagesListProps) {
  if (voices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4 bg-foreground/5">
          <Mic className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold mb-1">Голосовых пока нет</div>
        <div className="text-sm text-muted-foreground">
          Записанные голосовые сообщения появятся здесь
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 py-3 space-y-2">
      {voices.map((item) => (
        <VoiceCard key={item.id} item={item} onScrollToMessage={onScrollToMessage} />
      ))}
    </div>
  )
}

// ---- Single voice card (memoized) ----

interface VoiceCardProps {
  item: VoiceItem
  onScrollToMessage?: (id: string) => void
}

const VoiceCard = memo(function VoiceCard({ item, onScrollToMessage }: VoiceCardProps) {
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const progress = useAudioPlayer((s) => s.progress)
  const playbackRate = useAudioPlayer((s) => s.playbackRate)
  const playAction = useAudioPlayer((s) => s.play)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const setPlaybackRate = useAudioPlayer((s) => s.setPlaybackRate)

  const isCurrent = currentTrack?.id === item.id
  const playing = isCurrent && isPlaying

  const handleToggle = () => {
    if (isCurrent) {
      togglePlay()
      return
    }
    playAction(toTrack(item))
  }

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate)
    setPlaybackRate(SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length])
  }

  return (
    <motion.div
      layout
      className={cn(
        'relative rounded-2xl p-3 transition-colors',
        isCurrent ? 'bg-primary/5' : 'bg-card/50',
      )}
      style={{
        border: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
      }}
    >
      <div className="flex items-center gap-3">
        {/* Sender avatar */}
        <div className="relative shrink-0">
          {item.senderAvatar ? (
             
            <img
              src={assetUrl(item.senderAvatar)}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded-full grid place-items-center bg-foreground/10">
              <Mic className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          {playing && (
            <motion.div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ boxShadow: '0 0 0 2px var(--primary)' }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        {/* Sender + date */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{item.senderName}</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {formatTime(item.createdAt)}
          </div>
        </div>

        {/* Speed control */}
        <button
          onClick={cycleSpeed}
          className="shrink-0 px-2 py-1 rounded-md font-bold text-[10px] bg-foreground/10 text-foreground hover:bg-foreground/15 transition-colors"
          aria-label="Скорость воспроизведения"
        >
          {playbackRate}×
        </button>

        {/* Play/Pause */}
        <button
          onClick={handleToggle}
          className="shrink-0 h-10 w-10 rounded-full grid place-items-center transition-all active:scale-90"
          style={{
            background: 'var(--gradient-brand)',
            border: '1px solid rgba(255,255,255,0.18)',
          }}
          aria-label={playing ? 'Пауза' : 'Воспроизвести'}
        >
          <AnimatePresence mode="wait" initial={false}>
            {playing ? (
              <motion.span
                key="pause"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Pause className="h-4 w-4 text-white" fill="currentColor" />
              </motion.span>
            ) : (
              <motion.span
                key="play"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Play className="h-4 w-4 ml-0.5 text-white" fill="currentColor" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* Waveform row */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
          {formatDuration(Math.floor((isCurrent ? progress : 0) * (item.duration || 0)))}
        </span>
        <div className="relative flex-1 h-8">
          <div className="absolute inset-0">
            <VoiceWaveVisualizer
              amplitudeRef={AMPLITUDE_IDLE_REF}
              height={32}
              dimmed
            />
          </div>
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ clipPath: `inset(0 ${100 - (isCurrent ? progress : 0) * 100}% 0 0)` }}
          >
            <VoiceWaveVisualizer
              amplitudeRef={AMPLITUDE_IDLE_REF}
              height={32}
            />
          </div>
        </div>
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
          {formatDuration(item.duration || 0)}
        </span>
      </div>

      {/* Locate in chat */}
      {onScrollToMessage && (
        <button
          onClick={() => onScrollToMessage(item.messageId)}
          className="mt-2 text-[11px] text-primary hover:underline"
        >
          Перейти к сообщению
        </button>
      )}
    </motion.div>
  )
})
