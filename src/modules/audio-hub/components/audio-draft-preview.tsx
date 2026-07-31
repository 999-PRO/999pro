'use client'

// ============================================================================
// AudioDraftPreview — карточка черновика Audio Hub над полем ввода чата.
// ----------------------------------------------------------------------------
// v16.9.5: Клик по карточке открывает полноэкранный плеер.
//          Кнопка X (закрыть) ОСТАНАВЛИВАЕТ музыку и убирает черновик.
//
// Когда пользователь нажимает "Воспроизвести" в Audio Hub overlay, трек НЕ
// отправляется автоматически. Вместо этого эта карточка появляется над полем
// ввода (как ReplyPreview). Пользователь может:
//   • кликнуть на карточку → откроется полноэкранный плеер
//   • слушать трек (Play/Pause на обложке)
//   • отправить в чат (кнопка Send)
//   • закрыть карточку (кнопка X) → музыка ОСТАНАВЛИВАЕТСЯ
// ============================================================================

import { motion } from 'framer-motion'
import { Play, Pause, Send, X, Loader2, Music2 } from 'lucide-react'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { fetchAndCacheAudio } from '../cache'
import type { AudioHubTrack } from '../types'

interface AudioDraftPreviewProps {
  track: AudioHubTrack
  onSend: () => void
  /** Called when the user clicks X — should stop music AND clear the draft. */
  onClose: () => void
}

export function AudioDraftPreview({ track, onSend, onClose }: AudioDraftPreviewProps) {
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const play = useAudioPlayer((s) => s.play)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const stop = useAudioPlayer((s) => s.stop)
  const isLoading = useAudioPlayer((s) => s.isLoading)

  const isCurrent = currentTrack?.id === track.id
  const isThisPlaying = isCurrent && isPlaying
  const isThisLoading = isCurrent && isLoading

  const handlePlay = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isCurrent) {
      togglePlay()
      return
    }
    // v16.10: Use fullUrl (Audius/radio/quran) or previewUrl (iTunes 30s).
    const audioUrl = track.fullUrl || track.previewUrl
    if (!audioUrl) return
    let playableUrl = audioUrl
    playableUrl = await fetchAndCacheAudio(track.id, audioUrl)
    if (!playableUrl) return
    play({
      id: track.id,
      url: playableUrl,
      kind: 'music',
      title: track.title,
      subtitle: track.artist,
      coverUrl: track.coverUrl || undefined,
      duration: track.duration || undefined,
    })
  }

  // v16.9.5: Click on the card body opens the full player.
  const handleOpenPlayer = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-music-player'))
    }
  }

  // v16.9.5: Close button STOPS the music and removes the draft.
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Stop playback if this track is currently playing.
    if (isCurrent) {
      stop()
    }
    onClose()
  }

  // v16.9.5: Send button — send to chat, but keep playing (don't stop).
  const handleSend = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSend()
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div
        onClick={handleOpenPlayer}
        className="flex items-center gap-2.5 px-3 py-2 mx-1 mb-1 rounded-2xl cursor-pointer"
        style={{
          background: 'color-mix(in oklch, var(--card) 75%, transparent)',
          backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          border: '1px solid color-mix(in oklch, var(--primary) 30%, transparent)',
          boxShadow: '0 2px 12px -4px rgba(99,102,241,0.2)',
        }}
      >
        {/* Music icon */}
        <div className="shrink-0 h-7 w-7 rounded-lg grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
          <Music2 className="h-3.5 w-3.5 text-white" />
        </div>

        {/* Cover + Play */}
        <button
          onClick={handlePlay}
          className="relative shrink-0 h-10 w-10 rounded-lg overflow-hidden active:scale-95 transition-transform"
          aria-label={isThisPlaying ? 'Пауза' : 'Слушать'}
        >
          {track.coverUrl ? (
             
            <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
              <Music2 className="h-4 w-4 text-white" />
            </div>
          )}
          <div
            className="absolute inset-0 grid place-items-center transition-opacity"
            style={{
              background: 'rgba(0,0,0,0.5)',
              opacity: 1,
            }}
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

        {/* Title + artist */}
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-medium truncate"
            style={{ color: isCurrent ? 'var(--primary)' : 'inherit' }}
          >
            {track.title}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {track.artist}
          </div>
        </div>

        {/* Send button */}
        <motion.button
          whileTap={{ scale: 0.88 }}
          whileHover={{ scale: 1.06 }}
          onClick={handleSend}
          className="shrink-0 h-8 w-8 rounded-full grid place-items-center text-white"
          style={{
            background: 'var(--gradient-brand)',
            boxShadow: '0 2px 8px -2px rgba(37,99,235,0.4)',
          }}
          aria-label="Отправить в чат"
        >
          <Send className="h-3.5 w-3.5" />
        </motion.button>

        {/* Close — STOPS music and removes draft */}
        <button
          onClick={handleClose}
          className="shrink-0 h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:bg-foreground/5 active:scale-90 transition-all"
          aria-label="Закрыть и остановить"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  )
}
