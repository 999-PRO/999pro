'use client'

// ============================================================================
// AudioChatCard — компактная карточка Audio Hub в чате.
// ----------------------------------------------------------------------------
// v16.9.4: ПОЛНОСТЬЮ ПЕРЕДЕЛАНА. Раньше была широкой вертикальной (280px с
// обложкой 112px). Теперь — компактная горизонтальная, ТАКАЯ ЖЕ как в списке
// результатов поиска Audio Hub. Это обеспечивает единообразный дизайн.
//
// Структура (горизонтальная):
//   [🎵] [Cover 44×44 ▶] [Title / Artist] [0:42 / 3:14] [❤]
//
// mediaUrl хранит track id (например "archive-MLKDream" или "audius-XYZ"). Метаданные
// загружаются через /api/audio-hub/track/:id с module-level кэшем.
//
// Клик по карточке открывает полноэкранный плеер.
// ============================================================================

import { memo, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, Heart, Loader2, Music2 } from 'lucide-react'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { useAudioHubStore } from '../store'
import { fetchTrackById } from '../api'
import { fetchAndCacheAudio } from '../cache'
import type { AudioHubTrack } from '../types'
import { SourceBadge } from './source-badge'

interface AudioChatCardProps {
  /** The track id stored in message.mediaUrl. */
  trackId: string
  /** Whether the message was sent by the current user (affects styling). */
  isOwn: boolean
}

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0 || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function AudioChatCardInner({ trackId, isOwn }: AudioChatCardProps) {
  const [track, setTrack] = useState<AudioHubTrack | null>(null)
  const [loadError, setLoadError] = useState(false)

  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const progress = useAudioPlayer((s) => s.progress)
  const currentTime = useAudioPlayer((s) => s.currentTime)
  const duration = useAudioPlayer((s) => s.duration)
  const play = useAudioPlayer((s) => s.play)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const isLoading = useAudioPlayer((s) => s.isLoading)

  const favorites = useAudioHubStore((s) => s.favorites)
  const toggleFavorite = useAudioHubStore((s) => s.toggleFavorite)
  const addToHistory = useAudioHubStore((s) => s.addToHistory)

  // v16.19: isCurrent compares by track.id (from parsed JSON or API), not by
  // the raw trackId string (which may be a JSON string in the new format).
  const isCurrent = track ? currentTrack?.id === track.id : currentTrack?.id === trackId
  const isThisPlaying = isCurrent && isPlaying
  const isThisLoading = isCurrent && isLoading
  const isFav = track ? favorites.some((t) => t.id === track.id) : false

  // Load track metadata on mount.
  // v16.19: mediaUrl can now be a JSON-encoded full track object (new format)
  // or just a track ID string (old format). Try JSON first, fallback to API.
  useEffect(() => {
    let mounted = true
    try {
      // Try to parse as JSON (new format — full track object).
      const parsed = JSON.parse(trackId)
      if (parsed && typeof parsed === 'object' && parsed.id && (parsed.previewUrl || parsed.fullUrl)) {
        setTrack(parsed as AudioHubTrack)
        return
      }
    } catch {
      // Not JSON — old format (track ID string), fall through to API call.
    }
    // Fallback: fetch track metadata from backend (old format).
    fetchTrackById(trackId)
      .then((t) => {
        if (mounted) {
          if (t) setTrack(t)
          else setLoadError(true)
        }
      })
      .catch(() => mounted && setLoadError(true))
    return () => {
      mounted = false
    }
  }, [trackId])

  const handlePlay = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isCurrent) {
      togglePlay()
      return
    }
    if (!track) return
    addToHistory(track)
    // v16.15: All sources provide direct MP3 stream URLs.
    const audioUrl = track.fullUrl || track.previewUrl
    if (!audioUrl) return
    const playableUrl = await fetchAndCacheAudio(track.id, audioUrl)
    play({
      id: track.id,
      url: playableUrl,
      kind: 'music',
      title: track.title,
      subtitle: track.artist,
      coverUrl: track.coverUrl || undefined,
      duration: track.duration || undefined,
      source: track.source,
    })
  }

  // Click on the card body opens the full player.
  const handleOpenPlayer = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-music-player'))
    }
  }

  // Loading skeleton.
  if (!track && !loadError) {
    return (
      <div
        className="flex items-center gap-2.5 p-2 rounded-2xl animate-pulse"
        style={{
          background: 'color-mix(in oklch, var(--card) 80%, transparent)',
          border: '1px solid color-mix(in oklch, var(--border) 40%, transparent)',
          minWidth: 240,
          maxWidth: 320,
        }}
      >
        <div className="h-11 w-11 rounded-lg bg-foreground/10" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-3/4 bg-foreground/10 rounded" />
          <div className="h-2 w-1/2 bg-foreground/10 rounded" />
        </div>
      </div>
    )
  }

  // Error state.
  if (loadError) {
    return (
      <div
        className="flex items-center gap-2 p-2.5 rounded-2xl text-xs text-muted-foreground"
        style={{
          background: 'color-mix(in oklch, var(--card) 80%, transparent)',
          border: '1px solid color-mix(in oklch, var(--border) 40%, transparent)',
          minWidth: 200,
        }}
      >
        <Music2 className="h-4 w-4 opacity-50" />
        Аудио недоступно
      </div>
    )
  }

  const displayDuration = isCurrent && duration ? duration : track?.duration || 0
  const displayCurrentTime = isCurrent ? currentTime : 0
  const displayProgress = isCurrent ? progress : 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      onClick={handleOpenPlayer}
      className="flex items-center gap-2.5 p-2 rounded-2xl cursor-pointer"
      style={{
        background: 'color-mix(in oklch, var(--card) 82%, transparent)',
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
        border: `1px solid color-mix(in oklch, ${
          isCurrent ? 'var(--primary)' : 'var(--border)'
        } ${isCurrent ? '45%' : '40%'}, transparent)`,
        boxShadow: isCurrent
          ? '0 2px 16px -4px rgba(99,102,241,0.3)'
          : '0 1px 8px -3px rgba(15,23,42,0.1)',
        minWidth: 260,
        maxWidth: 340,
      }}
    >
      {/* Audio Hub badge icon */}
      <div
        className="shrink-0 h-7 w-7 rounded-lg grid place-items-center"
        style={{ background: 'var(--gradient-brand)' }}
      >
        <Music2 className="h-3.5 w-3.5 text-white" />
      </div>

      {/* Cover + Play overlay */}
      <button
        onClick={handlePlay}
        className="relative shrink-0 h-11 w-11 rounded-lg overflow-hidden active:scale-95 transition-transform"
        aria-label={isThisPlaying ? 'Пауза' : 'Слушать'}
      >
        {track?.coverUrl ? (
           
          <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
            <Music2 className="h-4 w-4 text-white" />
          </div>
        )}
        <div
          className="absolute inset-0 grid place-items-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
        >
          {isThisLoading ? (
            <Loader2 className="h-4 w-4 text-white animate-spin" />
          ) : isThisPlaying ? (
            <Pause className="h-4 w-4 text-white" fill="white" />
          ) : (
            <Play className="h-4 w-4 text-white ml-0.5" fill="white" />
          )}
        </div>
      </button>

      {/* Title + artist + source badge + progress bar */}
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-medium truncate"
          style={{ color: isCurrent ? 'var(--primary)' : 'inherit' }}
        >
          {track?.title || 'Аудио'}
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-xs text-muted-foreground truncate flex-1">
            {track?.artist || ''}
          </div>
          {/* v16.14: Source badge */}
          {track && (
            <div className="shrink-0">
              <SourceBadge source={track.source} size="sm" />
            </div>
          )}
        </div>
        {/* Mini progress bar */}
        <div
          className="mt-1 h-0.5 rounded-full overflow-hidden"
          style={{ background: 'color-mix(in oklch, var(--border) 50%, transparent)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${displayProgress * 100}%`,
              background: 'var(--gradient-brand)',
            }}
          />
        </div>
      </div>

      {/* Time */}
      <div className="shrink-0 text-[10px] text-muted-foreground tabular-nums text-right">
        {isCurrent ? formatTime(displayCurrentTime) : '0:00'}
        <br />
        {formatTime(displayDuration)}
      </div>

      {/* Favorite */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (track) toggleFavorite(track)
        }}
        className="shrink-0 h-7 w-7 rounded-full grid place-items-center hover:bg-foreground/5 active:scale-90 transition-all"
        aria-label={isFav ? 'Убрать из избранного' : 'В избранное'}
      >
        <Heart
          className={`h-3.5 w-3.5 transition-all ${
            isFav ? 'fill-red-500 text-red-500 scale-110' : 'text-muted-foreground'
          }`}
        />
      </button>
    </motion.div>
  )
}

export const AudioChatCard = memo(AudioChatCardInner)
