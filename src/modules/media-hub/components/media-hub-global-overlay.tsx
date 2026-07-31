'use client'

import { useState, useEffect } from 'react'
import { MediaHubOverlay } from './media-hub-overlay'
import { useAudioHubStore } from '@/modules/audio-hub/store'
import { fetchAndCacheAudio } from '@/modules/audio-hub/cache'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import type { AudioHubTrack } from '@/modules/audio-hub/types'

export function MediaHubGlobalOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => {
      setOpen(true)
      // Close the old audio-hub overlay if it's open (prevent double overlay).
      window.dispatchEvent(new CustomEvent('close-audio-hub'))
    }
    const closeHandler = () => setOpen(false)
    window.addEventListener('open-media-hub', handler)
    window.addEventListener('close-media-hub', closeHandler)
    return () => {
      window.removeEventListener('open-media-hub', handler)
      window.removeEventListener('close-media-hub', closeHandler)
    }
  }, [])

  const addToHistory = useAudioHubStore((s) => s.addToHistory)
  const play = useAudioPlayer((s) => s.play)

  const handlePlay = async (track: AudioHubTrack) => {
    addToHistory(track)
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

  return (
    <MediaHubOverlay
      open={open}
      onClose={() => setOpen(false)}
      onPlayAudio={handlePlay}
      showSendButton={false}
    />
  )
}
