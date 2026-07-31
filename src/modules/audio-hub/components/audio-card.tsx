'use client'

// ============================================================================
// AudioCard — карточка результата поиска Audio Hub.
// ----------------------------------------------------------------------------
// Используется в:
//   • AudioSearchOverlay (compact glass overlay в чате)
//   • AudioHubView (полноэкранный вид)
//
// Содержит: обложку, название, исполнителя, длительность, кнопку Play,
// кнопку "Отправить" (опционально), кнопку Избранное.
// ============================================================================

import { memo } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, Send, Heart, Loader2 } from 'lucide-react'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { useAudioHubStore } from '../store'
import { fetchAndCacheAudio } from '../cache'
import type { AudioHubTrack } from '../types'
import { SourceBadge } from './source-badge'

interface AudioCardProps {
  track: AudioHubTrack
  /** Show the "Send" button (for chat integration). */
  showSendButton?: boolean
  /** Called when the user clicks "Send". */
  onSend?: (track: AudioHubTrack) => void
  /** Called when the user plays a track (for auto-sending card to chat). */
  onPlay?: (track: AudioHubTrack) => void
  /** Compact variant for the chat overlay. */
  compact?: boolean
  /** Queue of all tracks in the current search results (for next/prev). */
  queue?: AudioHubTrack[]
  /** v16.17: Color variant — 'default' uses theme colors, 'onDark' forces
   *  white text (for dark backgrounds like the full-player search panel). */
  variant?: 'default' | 'onDark'
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 1) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function AudioCardInner({ track, showSendButton, onSend, onPlay, compact, queue, variant = 'default' }: AudioCardProps) {
  const onDark = variant === 'onDark'
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const play = useAudioPlayer((s) => s.play)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const isLoading = useAudioPlayer((s) => s.isLoading)

  const isCurrent = currentTrack?.id === track.id
  const isThisPlaying = isCurrent && isPlaying
  const isThisLoading = isCurrent && isLoading

  const favorites = useAudioHubStore((s) => s.favorites)
  const toggleFavorite = useAudioHubStore((s) => s.toggleFavorite)
  const addToHistory = useAudioHubStore((s) => s.addToHistory)
  const isFav = favorites.some((t) => t.id === track.id)

  const handlePlay = async () => {
    if (isCurrent) {
      togglePlay()
      return
    }
    // Add to history when first played.
    addToHistory(track)
    // v16.15: All sources provide direct MP3 stream URLs.
    const audioUrl = track.fullUrl || track.previewUrl
    if (!audioUrl) return
    // All tracks go through the backend stream proxy + IndexedDB cache.
    const playableUrl = await fetchAndCacheAudio(track.id, audioUrl)
    if (!playableUrl) return
    // v16.9.3: Build the AudioTrack for the player.
    const audioTrack = {
      id: track.id,
      url: playableUrl,
      kind: 'music' as const,
      title: track.title,
      subtitle: track.artist,
      coverUrl: track.coverUrl || undefined,
      duration: track.duration || undefined,
      source: track.source, // v16.14: for SourceBadge UI
    }
    // v16.9.3: If a queue is provided, pass it so Next/Prev work in the player.
    if (queue && queue.length > 1) {
      const audioQueue = queue.map((t) => ({
        id: t.id,
        url: t.fullUrl || t.previewUrl || '',
        kind: 'music' as const,
        title: t.title,
        subtitle: t.artist,
        coverUrl: t.coverUrl || undefined,
        duration: t.duration || undefined,
        source: t.source,
      }))
      const idx = audioQueue.findIndex((t) => t.id === track.id)
      if (idx >= 0) audioQueue[idx] = audioTrack
      play(audioTrack, audioQueue)
    } else {
      play(audioTrack)
    }
    // v16.9.4: Call onPlay BEFORE play() to ensure it's called even if play()
    // throws or the component unmounts during the async operation.
    onPlay?.(track)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative flex items-center gap-3 p-2.5 rounded-2xl transition-all ${
        compact ? '' : 'hover:bg-foreground/5'
      }`}
      style={{
        background: isCurrent
          ? 'color-mix(in oklch, var(--primary) 8%, transparent)'
          : 'transparent',
      }}
    >
      {/* Cover + Play overlay */}
      <button
        onClick={handlePlay}
        className="relative shrink-0 rounded-xl overflow-hidden active:scale-95 transition-transform"
        style={{ width: compact ? 48 : 56, height: compact ? 48 : 56 }}
        aria-label={isThisPlaying ? 'Пауза' : 'Слушать'}
      >
        {track.coverUrl ? (
           
          <img
            src={track.coverUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="h-full w-full grid place-items-center"
            style={{ background: 'var(--gradient-brand)' }}
          >
            <span className="text-white text-lg">🎵</span>
          </div>
        )}
        {/* Play/Pause overlay */}
        <div
          className="absolute inset-0 grid place-items-center transition-opacity"
          style={{
            background: 'rgba(0,0,0,0.45)',
            opacity: isThisPlaying || isThisLoading ? 1 : 0,
          }}
        >
          {isThisLoading ? (
            <Loader2 className="h-5 w-5 text-white animate-spin" />
          ) : isThisPlaying ? (
            <Pause className="h-5 w-5 text-white" fill="white" />
          ) : (
            <Play className="h-5 w-5 text-white" fill="white" />
          )}
        </div>
        {/* Hover play icon (when not playing) */}
        {!isThisPlaying && !isThisLoading && (
          <div
            className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >
            <Play className="h-5 w-5 text-white" fill="white" />
          </div>
        )}
      </button>

      {/* Title + artist + source badge.
          v16.9.5: If this track is currently playing, click opens the full
          player. Otherwise, click plays the track. */}
      <button
        onClick={(e) => {
          if (isCurrent) {
            // v16.9.5: Open the full player when clicking the title of the
            // currently-playing track.
            e.stopPropagation()
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('open-music-player'))
            }
          } else {
            handlePlay()
          }
        }}
        className="flex-1 min-w-0 text-left"
      >
        <div
          className={`font-medium truncate ${compact ? 'text-sm' : 'text-sm'}`}
          style={{
            color: isCurrent ? 'var(--primary)' : (onDark ? '#ffffff' : 'inherit'),
          }}
        >
          {track.title}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="text-xs truncate flex-1"
            style={{ color: onDark ? 'rgba(255,255,255,0.7)' : undefined }}
          >
            {track.artist}
          </div>
          {/* v16.14: Source badge — shows where the track comes from */}
          <div className="shrink-0">
            <SourceBadge source={track.source} size={compact ? 'sm' : 'md'} />
          </div>
        </div>
      </button>

      {/* Duration */}
      <div
        className="text-xs tabular-nums shrink-0"
        style={{ color: onDark ? 'rgba(255,255,255,0.6)' : undefined }}
      >
        {formatDuration(track.duration)}
      </div>

      {/* Favorite */}
      <button
        onClick={() => toggleFavorite(track)}
        className={`shrink-0 h-8 w-8 rounded-full grid place-items-center hover:bg-foreground/5 active:scale-90 transition-all`}
        aria-label={isFav ? 'Убрать из избранного' : 'В избранное'}
      >
        <Heart
          className={`h-4 w-4 transition-all ${
            isFav ? 'fill-red-500 text-red-500 scale-110' : (onDark ? 'text-white/50' : 'text-muted-foreground')
          }`}
        />
      </button>

      {/* Send button (for chat integration) */}
      {showSendButton && onSend && (
        <motion.button
          whileTap={{ scale: 0.88 }}
          whileHover={{ scale: 1.06 }}
          onClick={() => onSend(track)}
          className="shrink-0 h-8 w-8 rounded-full grid place-items-center text-white"
          style={{
            background: 'var(--gradient-brand)',
            boxShadow: '0 2px 8px -2px rgba(37,99,235,0.4)',
          }}
          aria-label="Отправить в чат"
        >
          <Send className="h-3.5 w-3.5" />
        </motion.button>
      )}
    </motion.div>
  )
}

export const AudioCard = memo(AudioCardInner)
