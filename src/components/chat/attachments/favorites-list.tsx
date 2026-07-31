'use client'

// ============================================================================
// FavoritesList — раздел избранного.
// ----------------------------------------------------------------------------
// Показывает:
//   • Любимые треки (из AudioPlayerManager.favorites)
//   • Любимые фото / видео / документы (localStorage favorites)
//
// Для аудио — переиспользует MusicItem-like карточки.
// Для других типов — простые превью.
// ============================================================================

import { useState, useEffect } from 'react'
import { Star, Play, Pause, Music2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { assetUrl } from '@/lib/api'
import { formatDuration, formatTime } from '@/lib/format'
import { useAudioPlayer, type AudioTrack } from '@/lib/audio-player-manager'
import type { ChatAttachments } from '../hooks/use-chat-attachments'

const STORAGE_KEY = '999pro:favorites'

interface StoredFavorite {
  id: string
  type: 'photo' | 'video' | 'document' | 'link' | 'product'
  url?: string
  name?: string
  createdAt: string
}

function loadFavorites(): StoredFavorite[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredFavorite[]) : []
  } catch {
    return []
  }
}

function saveFavorites(items: StoredFavorite[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

interface FavoritesListProps {
  attachments: ChatAttachments
  onOpenProduct?: (productId: string) => void
  onScrollToMessage?: (id: string) => void
}

export function FavoritesList({ attachments }: FavoritesListProps) {
  const favorites = useAudioPlayer((s) => s.favorites)
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const playAction = useAudioPlayer((s) => s.play)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)

  const [storedFavorites, setStoredFavorites] = useState<StoredFavorite[]>([])

  useEffect(() => {
    setStoredFavorites(loadFavorites())
  }, [])

  // Favorite tracks from this chat's music.
  const favMusic = attachments.music.filter((m) => favorites.has(m.id))

  const handlePlayFav = (track: typeof attachments.music[number]) => {
    if (currentTrack?.id === track.id) {
      togglePlay()
      return
    }
    const audioTrack: AudioTrack = {
      id: track.id,
      url: assetUrl(track.url),
      kind: 'music',
      title: track.title,
      subtitle: track.artist,
      coverUrl: track.coverUrl,
      duration: track.duration,
      senderName: track.senderName,
      senderAvatar: track.senderAvatar,
      createdAt: track.createdAt,
    }
    const queue = favMusic.map((m) => ({
      id: m.id,
      url: assetUrl(m.url),
      kind: 'music' as const,
      title: m.title,
      subtitle: m.artist,
      coverUrl: m.coverUrl,
      duration: m.duration,
      senderName: m.senderName,
      senderAvatar: m.senderAvatar,
      createdAt: m.createdAt,
    }))
    playAction(audioTrack, queue)
  }

  const totalFavCount = favMusic.length + storedFavorites.length

  if (totalFavCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4 bg-foreground/5">
          <Star className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold mb-1">В избранном пока пусто</div>
        <div className="text-sm text-muted-foreground">
          Нажимайте ❤ на треках, чтобы сохранить их здесь
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 py-3 space-y-4">
      {/* Favorite music */}
      {favMusic.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 mb-2 px-1">
            Любимая музыка
          </div>
          <div className="space-y-1">
            {favMusic.map((track) => {
              const isCurrent = currentTrack?.id === track.id
              const playing = isCurrent && isPlaying
              return (
                <button
                  key={track.id}
                  onClick={() => handlePlayFav(track)}
                  className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-foreground/5 transition-colors text-left"
                >
                  <div className="relative h-10 w-10 shrink-0 rounded-lg overflow-hidden grid place-items-center">
                    {track.coverUrl ? (
                       
                      <img src={assetUrl(track.coverUrl)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                        <Music2 className="h-4 w-4 text-white/70" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 grid place-items-center">
                      {playing ? (
                        <Pause className="h-4 w-4 text-white" fill="currentColor" />
                      ) : (
                        <Play className="h-4 w-4 ml-0.5 text-white" fill="currentColor" />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{track.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{track.senderName}</div>
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

      {/* Stored favorites (photos, videos, etc.) */}
      {storedFavorites.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 mb-2 px-1">
            Сохранённые элементы
          </div>
          <div className="grid grid-cols-3 gap-1">
            {storedFavorites.map((fav) => (
              <div
                key={fav.id}
                className="relative aspect-square rounded-lg overflow-hidden bg-foreground/5"
              >
                {fav.type === 'photo' && fav.url && (
                   
                  <img src={assetUrl(fav.url)} alt="" className="h-full w-full object-cover" loading="lazy" />
                )}
                {(fav.type === 'video' || fav.type === 'document') && (
                  <div className="h-full w-full grid place-items-center text-muted-foreground">
                    <Star className="h-5 w-5 fill-current text-yellow-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
