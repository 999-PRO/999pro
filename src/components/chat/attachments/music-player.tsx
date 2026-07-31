'use client'

// ============================================================================
// MusicPlayer — полноценный музыкальный плеер для чата.
// ----------------------------------------------------------------------------
// Возможности:
//   • Крупная обложка (или градиент-плейсхолдер)
//   • Название трека + исполнитель
//   • Длительность + прогресс
//   • Красивый эквалайзер (анимированный, реагирует на воспроизведение)
//   • Стеклянные кнопки: Play/Pause, Prev, Next, Repeat, Shuffle, Favorite
//   • Сортировка: по дате / названию / длительности / отправителю
//   • Плейлист (очередь) — клик по треку запускает его
//   • Интеграция с AudioPlayerManager (единое воспроизведение)
// ============================================================================

import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle, Heart,
  Music2, ListMusic, ChevronDown, ArrowUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import {
  useAudioPlayer,
  type AudioTrack,
  type RepeatMode,
} from '@/lib/audio-player-manager'
import type { MusicItem } from '../hooks/use-chat-attachments'

type SortMode = 'date' | 'title' | 'duration' | 'sender'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'date', label: 'По дате' },
  { value: 'title', label: 'По названию' },
  { value: 'duration', label: 'По длительности' },
  { value: 'sender', label: 'По отправителю' },
]

// ---- Convert MusicItem → AudioTrack ----
function toTrack(item: MusicItem): AudioTrack {
  return {
    id: item.id,
    url: assetUrl(item.url),
    kind: 'music',
    title: item.title,
    subtitle: item.artist,
    coverUrl: item.coverUrl,
    duration: item.duration,
    conversationId: item.messageId,
    senderName: item.senderName,
    senderAvatar: item.senderAvatar,
    createdAt: item.createdAt,
  }
}

// ---- Sort ----
function sortTracks(items: MusicItem[], mode: SortMode): MusicItem[] {
  const arr = [...items]
  switch (mode) {
    case 'date':
      return arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    case 'duration':
      return arr.sort((a, b) => (a.duration || 0) - (b.duration || 0))
    case 'sender':
      return arr.sort((a, b) => a.senderName.localeCompare(b.senderName, 'ru'))
  }
}

interface MusicPlayerProps {
  tracks: MusicItem[]
}

export function MusicPlayer({ tracks }: MusicPlayerProps) {
  const [sortMode, setSortMode] = useState<SortMode>('date')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [showPlaylist, setShowPlaylist] = useState(false)

  // AudioPlayerManager state
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const progress = useAudioPlayer((s) => s.progress)
  const currentTime = useAudioPlayer((s) => s.currentTime)
  const duration = useAudioPlayer((s) => s.duration)
  const repeat = useAudioPlayer((s) => s.repeat)
  const shuffle = useAudioPlayer((s) => s.shuffle)
  const favorites = useAudioPlayer((s) => s.favorites)
  const playAction = useAudioPlayer((s) => s.play)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const next = useAudioPlayer((s) => s.next)
  const prev = useAudioPlayer((s) => s.prev)
  const setRepeat = useAudioPlayer((s) => s.setRepeat)
  const toggleShuffle = useAudioPlayer((s) => s.toggleShuffle)
  const toggleFavorite = useAudioPlayer((s) => s.toggleFavorite)
  const seek = useAudioPlayer((s) => s.seek)

  const sortedTracks = useMemo(() => sortTracks(tracks, sortMode), [tracks, sortMode])

  // When sortedTracks changes, update the queue in manager (without disrupting
  // current playback if same track).
  useEffect(() => {
    if (sortedTracks.length === 0) return
    const queue = sortedTracks.map(toTrack)
    // Only update queue if the current track is in the new queue (preserves playback).
    const state = useAudioPlayer.getState()
    if (state.currentTrack && queue.some((t) => t.id === state.currentTrack!.id)) {
      useAudioPlayer.setState({ queue, queueIndex: queue.findIndex((t) => t.id === state.currentTrack!.id) })
    }
  }, [sortedTracks])

  const handlePlayTrack = (item: MusicItem) => {
    const queue = sortedTracks.map(toTrack)
    playAction(toTrack(item), queue)
  }

  const cycleRepeat = () => {
    const modes: RepeatMode[] = ['off', 'all', 'one']
    const idx = modes.indexOf(repeat)
    setRepeat(modes[(idx + 1) % modes.length])
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(frac)
  }

  const isFavorite = currentTrack ? favorites.has(currentTrack.id) : false
  const totalDuration = sortedTracks.reduce((sum, t) => sum + (t.duration || 0), 0)

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4" style={{ background: 'var(--gradient-brand)' }}>
          <Music2 className="h-8 w-8 text-white/80" />
        </div>
        <div className="text-lg font-semibold mb-1">Музыки пока нет</div>
        <div className="text-sm text-muted-foreground">
          Аудиофайлы длиннее 60 секунд появятся здесь
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* === Full Player === */}
      <div className="px-5 pt-6 pb-4">
        {/* Sort button */}
        <div className="flex items-center justify-between mb-5">
          <div className="text-sm text-muted-foreground">
            {sortedTracks.length} треков · {formatDuration(totalDuration)}
          </div>
          <div className="relative">
            <button
              onClick={() => setSortMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium glass border border-border/40 active:scale-95 transition-all"
              aria-label="Сортировка"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {SORT_OPTIONS.find((o) => o.value === sortMode)?.label}
            </button>
            <AnimatePresence>
              {sortMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSortMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute right-0 top-full mt-1 z-20 rounded-xl glass-strong border border-border/40 shadow-xl py-1 min-w-[180px]"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setSortMode(opt.value)
                          setSortMenuOpen(false)
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm transition-colors hover:bg-foreground/5',
                          sortMode === opt.value ? 'text-primary font-medium' : 'text-foreground',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Cover art */}
        <div className="relative mx-auto mb-5" style={{ width: 'min(280px, 70vw)', aspectRatio: '1 / 1' }}>
          <motion.div
            className="absolute inset-0 rounded-3xl overflow-hidden"
            animate={isPlaying ? { scale: [1, 1.02, 1] } : { scale: 1 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              boxShadow: '0 20px 60px -15px rgba(37,99,235,0.4), 0 0 0 1px rgba(255,255,255,0.06) inset',
            }}
          >
            {currentTrack?.coverUrl ? (
               
              <img
                src={assetUrl(currentTrack.coverUrl)}
                alt={currentTrack.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                <Music2 className="h-20 w-20 text-white/40" />
              </div>
            )}
          </motion.div>
          {/* Glow */}
          {isPlaying && (
            <motion.div
              className="absolute -inset-2 rounded-3xl pointer-events-none -z-10"
              style={{ background: 'var(--gradient-brand)', filter: 'blur(40px)', opacity: 0.3 }}
              animate={{ opacity: [0.2, 0.4, 0.2] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        {/* Title + artist */}
        <div className="text-center mb-4">
          <div className="text-xl font-bold truncate">
            {currentTrack?.title || 'Выберите трек'}
          </div>
          <div className="text-sm text-muted-foreground truncate mt-0.5">
            {currentTrack?.subtitle || `${sortedTracks.length} треков в очереди`}
          </div>
        </div>

        {/* Equalizer */}
        <div className="flex items-end justify-center gap-1 h-8 mb-4">
          {isPlaying ? (
            Array.from({ length: 24 }).map((_, i) => (
              <motion.div
                key={i}
                className="w-1 rounded-full"
                style={{ background: 'var(--gradient-brand)' }}
                animate={{
                  height: [
                    `${20 + Math.random() * 30}%`,
                    `${50 + Math.random() * 50}%`,
                    `${20 + Math.random() * 30}%`,
                  ],
                }}
                transition={{
                  duration: 0.6 + Math.random() * 0.4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.03,
                }}
              />
            ))
          ) : (
            Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-foreground/20"
                style={{ height: '20%' }}
              />
            ))
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-2">
          <div
            onClick={handleSeek}
            className="relative h-1.5 rounded-full bg-foreground/10 cursor-pointer group"
            role="slider"
            aria-label="Прогресс воспроизведения"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${progress * 100}%`,
                background: 'var(--gradient-brand)',
              }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `${progress * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[11px] font-mono tabular-nums text-muted-foreground">
            <span>{formatDuration(Math.floor(currentTime))}</span>
            <span>{formatDuration(Math.floor(duration || currentTrack?.duration || 0))}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3 mb-2">
          {/* Shuffle */}
          <button
            onClick={toggleShuffle}
            className={cn(
              'h-10 w-10 rounded-full grid place-items-center transition-all active:scale-90',
              shuffle ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="Перемешивание"
          >
            <Shuffle className="h-4 w-4" />
          </button>

          {/* Prev */}
          <button
            onClick={prev}
            className="h-12 w-12 rounded-full grid place-items-center text-foreground hover:bg-foreground/5 active:scale-90 transition-all"
            aria-label="Предыдущий"
          >
            <SkipBack className="h-5 w-5" fill="currentColor" />
          </button>

          {/* Play/Pause — big */}
          <button
            onClick={togglePlay}
            className="h-16 w-16 rounded-full grid place-items-center transition-all active:scale-90 shadow-[0_8px_24px_-6px_rgba(37,99,235,0.5)]"
            style={{
              background: 'var(--gradient-brand)',
              border: '1px solid rgba(255,255,255,0.18)',
            }}
            aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {isPlaying ? (
              <Pause className="h-7 w-7 text-white" fill="currentColor" />
            ) : (
              <Play className="h-7 w-7 ml-1 text-white" fill="currentColor" />
            )}
          </button>

          {/* Next */}
          <button
            onClick={next}
            className="h-12 w-12 rounded-full grid place-items-center text-foreground hover:bg-foreground/5 active:scale-90 transition-all"
            aria-label="Следующий"
          >
            <SkipForward className="h-5 w-5" fill="currentColor" />
          </button>

          {/* Repeat */}
          <button
            onClick={cycleRepeat}
            className={cn(
              'h-10 w-10 rounded-full grid place-items-center transition-all active:scale-90',
              repeat !== 'off' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="Повтор"
          >
            {repeat === 'one' ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
          </button>
        </div>

        {/* Favorite + Playlist toggle */}
        <div className="flex items-center justify-center gap-4 mt-2">
          <button
            onClick={() => currentTrack && toggleFavorite(currentTrack.id)}
            className={cn(
              'h-9 w-9 rounded-full grid place-items-center transition-all active:scale-90',
              isFavorite ? 'text-red-500 bg-red-500/10' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="Избранное"
            disabled={!currentTrack}
          >
            <Heart className={cn('h-4 w-4', isFavorite && 'fill-current')} />
          </button>
          <button
            onClick={() => setShowPlaylist((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all active:scale-95',
              showPlaylist ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground glass border border-border/40',
            )}
            aria-label="Очередь"
          >
            <ListMusic className="h-3.5 w-3.5" />
            Очередь
          </button>
        </div>
      </div>

      {/* === Playlist === */}
      <AnimatePresence>
        {showPlaylist && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border/30"
          >
            <div className="px-3 py-3 max-h-[40vh] overflow-y-auto">
              {sortedTracks.map((track, idx) => {
                const isCurrent = currentTrack?.id === track.id
                return (
                  <button
                    key={track.id}
                    onClick={() => handlePlayTrack(track)}
                    className={cn(
                      'w-full flex items-center gap-3 px-2 py-2 rounded-xl transition-colors text-left',
                      isCurrent ? 'bg-primary/10' : 'hover:bg-foreground/5',
                    )}
                  >
                    <div className="relative h-10 w-10 shrink-0 rounded-lg overflow-hidden grid place-items-center">
                      {track.coverUrl ? (
                         
                        <img src={assetUrl(track.coverUrl)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                          <Music2 className="h-4 w-4 text-white/70" />
                        </div>
                      )}
                      {isCurrent && isPlaying && (
                        <div className="absolute inset-0 bg-black/40 grid place-items-center">
                          <div className="flex items-end gap-0.5 h-3">
                            {[0, 1, 2].map((i) => (
                              <motion.div
                                key={i}
                                className="w-0.5 bg-white rounded-full"
                                animate={{ height: ['30%', '100%', '30%'] }}
                                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn('text-sm font-medium truncate', isCurrent && 'text-primary')}>
                        {track.title}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {track.senderName}
                      </div>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                      {formatDuration(track.duration || 0)}
                    </div>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* === Track list (always visible below) === */}
      {!showPlaylist && (
        <div className="px-3 py-3 border-t border-border/30">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 mb-2 px-2">
            Все треки
          </div>
          <div className="space-y-1">
            {sortedTracks.map((track) => {
              const isCurrent = currentTrack?.id === track.id
              return (
                <button
                  key={track.id}
                  onClick={() => handlePlayTrack(track)}
                  className={cn(
                    'w-full flex items-center gap-3 px-2 py-2 rounded-xl transition-colors text-left',
                    isCurrent ? 'bg-primary/10' : 'hover:bg-foreground/5',
                  )}
                >
                  <div className="relative h-10 w-10 shrink-0 rounded-lg overflow-hidden grid place-items-center">
                    {track.coverUrl ? (
                       
                      <img src={assetUrl(track.coverUrl)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                        <Music2 className="h-4 w-4 text-white/70" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn('text-sm font-medium truncate', isCurrent && 'text-primary')}>
                      {track.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {track.senderName}
                    </div>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                    {formatDuration(track.duration || 0)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
