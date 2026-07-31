'use client'

// ============================================================================
// AudioHubGlobalOverlay — глобальный search overlay для Audio Hub.
// ----------------------------------------------------------------------------
// Открывается из шапки приложения (событие 'open-audio-hub').
// В отличие от overlay в чате, этот НЕ имеет кнопки "Отправить" — он только
// ищет и воспроизводит музыку. Пользователь может слушать с любой страницы.
//
// Воспроизведение использует тот же useAudioPlayer store, поэтому музыка
// продолжает играть при переходах между страницами. MiniPlayer появляется
// внизу экрана, клик по нему открывает полноэкранный плеер.
//
// v22 final: поддерживает detail.query (автопоиск) + detail.autoplay
// (автовоспроизведение первого найденного трека). Используется AI Assistant
// когда пользователь просит "включи музыку руки вверх".
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { AudioSearchOverlay } from './audio-search-overlay'
import { useAudioHubStore } from '../store'
import { fetchAndCacheAudio } from '../cache'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import type { AudioHubTrack } from '../types'

export function AudioHubGlobalOverlay() {
  const [open, setOpen] = useState(false)
  const [initialQuery, setInitialQuery] = useState<string>('')
  const [shouldAutoplay, setShouldAutoplay] = useState(false)
  const autoplayedRef = useRef(false)

  // Listen for the 'open-audio-hub' event from the header button.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { query?: string; autoplay?: boolean } | undefined
      setOpen(true)
      if (detail?.query) {
        setInitialQuery(detail.query)
        setShouldAutoplay(!!detail.autoplay)
        autoplayedRef.current = false
      } else {
        setInitialQuery('')
        setShouldAutoplay(false)
      }
    }
    // v16.9.4: Also listen for 'close-audio-hub' to close when the chat
    // overlay opens (prevents both overlays being open simultaneously).
    const closeHandler = () => setOpen(false)
    window.addEventListener('open-audio-hub', handler)
    window.addEventListener('close-audio-hub', closeHandler)
    return () => {
      window.removeEventListener('open-audio-hub', handler)
      window.removeEventListener('close-audio-hub', closeHandler)
    }
  }, [])

  const addToHistory = useAudioHubStore((s) => s.addToHistory)
  const play = useAudioPlayer((s) => s.play)

  // When a track is played in the global overlay, just play it — no draft,
  // no send. The MiniPlayer will appear at the bottom of the screen.
  const handlePlay = async (track: AudioHubTrack) => {
    addToHistory(track)
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
    autoplayedRef.current = true
  }

  // v22 final: Autoplay handler — called by AudioSearchOverlay when search
  // results arrive AND shouldAutoplay is true. Plays the first result.
  const handleAutoplay = (tracks: AudioHubTrack[]) => {
    if (!shouldAutoplay || autoplayedRef.current || tracks.length === 0) return
    handlePlay(tracks[0])
  }

  // The global overlay has no "Send" — onSelect is a no-op.
  const handleSelect = (_track: AudioHubTrack) => {
    // No-op — the global overlay is for listening only.
  }

  return (
    <AudioSearchOverlay
      open={open}
      onClose={() => {
        setOpen(false)
        setInitialQuery('')
        setShouldAutoplay(false)
      }}
      onSelect={handleSelect}
      onPlay={handlePlay}
      onResults={handleAutoplay}
      initialQuery={initialQuery}
      autoSearch={!!initialQuery}
      showSendButton={false}
    />
  )
}
