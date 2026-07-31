'use client'

// ============================================================================
// AudioFullPlayer — полноэкранный плеер Audio Hub.
// ----------------------------------------------------------------------------
// v16.9.3: Добавлены:
//   • Поле поиска прямо в плеере (поиск не останавливает текущее воспроизведение)
//   • Кнопка "Очередь" — показывает все треки текущего поиска/очереди
//   • Плавные spring-анимации переходов между экранами (плеер / поиск / очередь)
//   • Полная синхронизация с useAudioPlayer (progress, time, play/pause)
//
// Открывается по клику на MiniPlayer (событие 'open-music-player') или по
// клику на AudioChatCard в чате.
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle,
  Volume2, Volume1, VolumeX, Loader2, Heart, ListMusic, Search as SearchIcon,
  Power,
} from 'lucide-react'
import { useAudioPlayer, type RepeatMode, type AudioTrack } from '@/lib/audio-player-manager'
import { useAudioHubStore } from '../store'
import { useAudioHubSearch } from '../use-audio-hub-search'
import { searchAudioTracks } from '../api'
import { fetchAndCacheAudio } from '../cache'
import { AudioWaveVisualizer } from './audio-wave-visualizer'
import { AudioCard } from './audio-card'
import { SourceBadge } from './source-badge'
import type { AudioHubTrack, AudioHubKind } from '../types'

type Panel = 'player' | 'queue' | 'search'

export function AudioFullPlayer() {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>('player')

  // Listen for the 'open-music-player' event dispatched by MiniPlayer + chat cards.
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-music-player', handler)
    return () => window.removeEventListener('open-music-player', handler)
  }, [])

  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const progress = useAudioPlayer((s) => s.progress)
  const currentTime = useAudioPlayer((s) => s.currentTime)
  const duration = useAudioPlayer((s) => s.duration)
  const isLoading = useAudioPlayer((s) => s.isLoading)
  const repeat = useAudioPlayer((s) => s.repeat)
  const shuffle = useAudioPlayer((s) => s.shuffle)
  const queue = useAudioPlayer((s) => s.queue)
  const queueIndex = useAudioPlayer((s) => s.queueIndex)
  const stopPlayback = useAudioPlayer((s) => s.stop)

  // Full stop + close: clears currentTrack so HeaderAudioPlayer hides too.
  const handleStopAndClose = useCallback(() => {
    stopPlayback()
    setOpen(false)
  }, [stopPlayback])
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const next = useAudioPlayer((s) => s.next)
  const prev = useAudioPlayer((s) => s.prev)
  const seek = useAudioPlayer((s) => s.seek)
  const setRepeat = useAudioPlayer((s) => s.setRepeat)
  const toggleShuffle = useAudioPlayer((s) => s.toggleShuffle)
  const play = useAudioPlayer((s) => s.play)

  const volume = useAudioHubStore((s) => s.volume)
  const setVolume = useAudioHubStore((s) => s.setVolume)
  const favorites = useAudioHubStore((s) => s.favorites)
  const toggleFavorite = useAudioHubStore((s) => s.toggleFavorite)
  const addToHistory = useAudioHubStore((s) => s.addToHistory)
  const lastSearch = useAudioHubStore((s) => s.lastSearch)
  const setLastSearch = useAudioHubStore((s) => s.setLastSearch)
  const isFav = currentTrack ? favorites.some((t) => t.id === currentTrack.id) : false

  // Search state (used when panel === 'search').
  // The search does NOT stop playback — it only populates the search results.
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AudioHubTrack[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchType, setSearchType] = useState<AudioHubKind>(lastSearch?.type || 'music')
  // v16.16: Source filter — 'all' (default) or a specific source.
  const [searchSource, setSearchSource] = useState<string>('all')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-close if track is cleared.
  useEffect(() => {
    if (!currentTrack) setOpen(false)
  }, [currentTrack])

  // Apply volume to the audio element.
  useEffect(() => {
    const audioEl = (useAudioPlayer as any)._getAudioEl?.() as HTMLAudioElement | null
    if (audioEl) audioEl.volume = volume
  }, [volume])

  // Reset panel to 'player' when opening.
  useEffect(() => {
    if (open) setPanel('player')
  }, [open])

  // Debounced search inside the player.
  // v16.9.4-fix: Removed `lastSearch` from deps — it caused an infinite loop
  // (search → setLastSearch → lastSearch changes → effect re-runs → search again).
  // We use a ref to read lastSearch for the empty-query restore case.
  const lastSearchRef = useRef(lastSearch)
  lastSearchRef.current = lastSearch

  useEffect(() => {
    if (panel !== 'search') return
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    const trimmed = searchQuery.trim()
    if (trimmed.length < 1) {
      // If we have a last search, show it; otherwise clear.
      const ls = lastSearchRef.current
      if (ls && ls.type === searchType) {
        setSearchResults(ls.results)
      } else {
        setSearchResults([])
      }
      return
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        // v16.16: Pass searchSource to filter by specific source.
        const data = await searchAudioTracks(trimmed, searchType, 20, searchSource)
        const items = data.items || []
        setSearchResults(items)
        setLastSearch({ query: trimmed, type: searchType, results: items, timestamp: Date.now() })
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 280)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery, searchType, searchSource, panel, setLastSearch])

  // v16.9.3: Play a track from search results — does NOT stop current playback
  // until the new track is ready. The play() call in AudioCard handles the
  // transition. We just need to make sure the search panel stays open so the
  // user can pick another track.
  // v16.15: YouTube removed — all tracks use the same direct-MP3 path.
  const handlePlayFromSearch = useCallback(async (track: AudioHubTrack) => {
    addToHistory(track)
    // Standard track — resolve URL through backend proxy + cache.
    const audioUrl = track.fullUrl || track.previewUrl
    if (!audioUrl) return
    const playableUrl = await fetchAndCacheAudio(track.id, audioUrl)
    const audioTrack: AudioTrack = {
      id: track.id,
      url: playableUrl,
      kind: 'music',
      title: track.title,
      subtitle: track.artist,
      coverUrl: track.coverUrl || undefined,
      duration: track.duration || undefined,
      source: track.source,
    }
    // Build queue from search results so Next/Prev work.
    const audioQueue: AudioTrack[] = searchResults.map((t) => ({
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
    // Switch to player panel to show the now-playing track.
    setPanel('player')
  }, [addToHistory, play, searchResults])

  const cycleRepeat = () => {
    const modes: RepeatMode[] = ['off', 'all', 'one']
    const idx = modes.indexOf(repeat)
    setRepeat(modes[(idx + 1) % modes.length])
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    seek(Math.max(0, Math.min(1, frac)))
  }

  const formatTime = (s: number) => {
    if (!s || s < 0 || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  // Convert queue (AudioTrack[]) to AudioHubTrack[] for display in the queue panel.
  // v16.14: Pass through the source field so SourceBadge shows the correct origin.
  const queueDisplay: AudioHubTrack[] = queue.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.subtitle || '',
    album: null,
    coverUrl: t.coverUrl || null,
    previewUrl: t.url,
    duration: t.duration || null,
    genre: null,
    kind: 'music',
    source: (t.source as AudioHubTrack['source']) || 'hitmos',
  }))

  return (
    <AnimatePresence>
      {open && currentTrack && (
        <>
          {/* Backdrop with blurred cover */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[200]"
            onClick={() => setOpen(false)}
            style={{
              background: currentTrack.coverUrl
                ? `linear-gradient(to bottom, rgba(15,23,42,0.85), rgba(15,23,42,0.95)), url(${currentTrack.coverUrl}) center/cover`
                : 'rgba(15,23,42,0.9)',
              backdropFilter: 'blur(40px) saturate(120%)',
              WebkitBackdropFilter: 'blur(40px) saturate(120%)',
            }}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34, mass: 0.9 }}
            className="fixed inset-x-0 bottom-0 top-0 z-[201] flex flex-col max-w-md mx-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
              <button
                onClick={() => setOpen(false)}
                className="h-9 w-9 rounded-full grid place-items-center text-white/80 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
                aria-label="Свернуть"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="text-xs text-white/60 font-medium uppercase tracking-wider">
                Audio Hub
              </div>
              <div className="flex items-center gap-1">
                {/* Full stop button — stops playback AND clears state so the
                    header mini-player disappears too. */}
                <button
                  onClick={handleStopAndClose}
                  className="h-9 w-9 rounded-full grid place-items-center text-white/80 hover:text-red-300 hover:bg-white/10 active:scale-90 transition-all"
                  aria-label="Остановить и закрыть"
                  title="Остановить и закрыть"
                >
                  <Power className="h-5 w-5" />
                </button>
                {/* Search button */}
                <button
                  onClick={() => setPanel('search')}
                  className="h-9 w-9 rounded-full grid place-items-center text-white/80 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
                  aria-label="Поиск"
                >
                  <SearchIcon className="h-5 w-5" style={{ fill: panel === 'search' ? 'currentColor' : 'none' }} />
                </button>
              </div>
            </div>

            {/* Panel content with AnimatePresence for smooth transitions.
                v16.9.4-fix: min-h-0 + overflow-hidden on the wrapper so child
                panels can scroll properly. */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <AnimatePresence mode="wait">
              {panel === 'player' && (
                <motion.div
                  key="player"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="flex-1 flex flex-col"
                >
                    {/* Cover */}
                    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-4">
                      <motion.div
                        layout
                        className="relative w-full max-w-[260px] aspect-square rounded-3xl overflow-hidden shadow-2xl"
                        animate={isPlaying ? { scale: 1 } : { scale: 0.92 }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
                            <ListMusic className="h-16 w-16 text-white/80" />
                          </div>
                        )}
                        {/* Glow ring while playing */}
                        {isPlaying && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0.3, 0.6, 0.3] }}
                            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                            className="absolute inset-0 rounded-3xl"
                            style={{
                              boxShadow: '0 0 60px 8px rgba(124,58,237,0.5) inset',
                            }}
                          />
                        )}
                      </motion.div>

                      {/* Title + artist + source badge */}
                      <div className="mt-6 text-center w-full">
                        <div className="text-white text-xl font-bold truncate">
                          {currentTrack.title}
                        </div>
                        {currentTrack.subtitle && (
                          <div className="text-white/60 text-sm mt-1 truncate">
                            {currentTrack.subtitle}
                          </div>
                        )}
                        {/* v16.14: Source badge — shows where the track comes from */}
                        <div className="mt-2 flex justify-center">
                          {/* v24.6-audit fix: type mismatch — AudioHubTrack['source'] doesn't
                              include 'audius', so the fallback `|| 'audius'` failed type check.
                              Cast to the source type and use a valid fallback ('radio') instead. */}
                          <SourceBadge source={(currentTrack.source as AudioHubTrack['source']) || 'radio'} size="md" />
                        </div>
                      </div>

                      {/* Unique animated wave */}
                      <div className="mt-6 w-full">
                        <AudioWaveVisualizer
                          isPlaying={isPlaying}
                          progress={progress}
                          barCount={40}
                          height={48}
                          variant="player"
                        />
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="px-8 pb-4">
                      <div
                        onClick={handleSeek}
                        className="relative h-1.5 rounded-full cursor-pointer group"
                        style={{ background: 'rgba(255,255,255,0.15)' }}
                      >
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${progress * 100}%`,
                            background: 'var(--gradient-brand)',
                          }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ left: `calc(${progress * 100}% - 7px)` }}
                        />
                      </div>
                      <div className="flex justify-between mt-2 text-xs text-white/60 tabular-nums">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="px-8 pb-6">
                      <div className="flex items-center justify-between">
                        {/* Shuffle */}
                        <button
                          onClick={toggleShuffle}
                          className="h-10 w-10 rounded-full grid place-items-center transition-all active:scale-90"
                          style={{
                            color: shuffle ? '#fff' : 'rgba(255,255,255,0.5)',
                            background: shuffle ? 'rgba(124,58,237,0.3)' : 'transparent',
                          }}
                          aria-label="Случайное воспроизведение"
                        >
                          <Shuffle className="h-4 w-4" />
                        </button>

                        {/* Previous */}
                        <button
                          onClick={prev}
                          className="h-12 w-12 rounded-full grid place-items-center text-white hover:bg-white/10 active:scale-90 transition-all"
                          aria-label="Предыдущий"
                        >
                          <SkipBack className="h-5 w-5" fill="white" />
                        </button>

                        {/* Play/Pause */}
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          whileHover={{ scale: 1.05 }}
                          onClick={togglePlay}
                          className="h-16 w-16 rounded-full grid place-items-center text-white"
                          style={{
                            background: 'var(--gradient-brand)',
                            boxShadow: '0 8px 32px -4px rgba(124,58,237,0.6)',
                            border: '2px solid rgba(255,255,255,0.2)',
                          }}
                          aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
                        >
                          {isLoading ? (
                            <Loader2 className="h-7 w-7 animate-spin" />
                          ) : isPlaying ? (
                            <Pause className="h-7 w-7" fill="white" />
                          ) : (
                            <Play className="h-7 w-7 ml-1" fill="white" />
                          )}
                        </motion.button>

                        {/* Next */}
                        <button
                          onClick={next}
                          className="h-12 w-12 rounded-full grid place-items-center text-white hover:bg-white/10 active:scale-90 transition-all"
                          aria-label="Следующий"
                        >
                          <SkipForward className="h-5 w-5" fill="white" />
                        </button>

                        {/* Repeat */}
                        <button
                          onClick={cycleRepeat}
                          className="h-10 w-10 rounded-full grid place-items-center transition-all active:scale-90"
                          style={{
                            color: repeat !== 'off' ? '#fff' : 'rgba(255,255,255,0.5)',
                            background: repeat !== 'off' ? 'rgba(124,58,237,0.3)' : 'transparent',
                          }}
                          aria-label="Повтор"
                        >
                          {repeat === 'one' ? (
                            <Repeat1 className="h-4 w-4" />
                          ) : (
                            <Repeat className="h-4 w-4" />
                          )}
                        </button>
                      </div>

                      {/* Bottom row: Favorite + Volume + Queue button */}
                      <div className="flex items-center gap-3 mt-6">
                        {/* Favorite */}
                        <button
                          onClick={() => {
                            if (!currentTrack) return
                            toggleFavorite({
                              id: currentTrack.id,
                              title: currentTrack.title,
                              artist: currentTrack.subtitle || '',
                              album: null,
                              coverUrl: currentTrack.coverUrl || null,
                              previewUrl: currentTrack.url,
                              duration: currentTrack.duration || null,
                              genre: null,
                              kind: 'music',
                              source: (currentTrack.source as AudioHubTrack['source']) || 'hitmos',
                            })
                          }}
                          className="h-9 w-9 rounded-full grid place-items-center text-white/80 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
                          aria-label={isFav ? 'Убрать из избранного' : 'В избранное'}
                        >
                          <Heart
                            className={`h-4 w-4 transition-all ${
                              isFav ? 'fill-red-500 text-red-500 scale-110' : ''
                            }`}
                          />
                        </button>

                        {/* Volume */}
                        <div className="flex-1 flex items-center gap-2">
                          <VolumeIcon className="h-4 w-4 text-white/60 shrink-0" />
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={volume}
                            onChange={(e) => setVolume(Number(e.target.value))}
                            className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                            style={{
                              background: `linear-gradient(to right, var(--gradient-brand) ${volume * 100}%, rgba(255,255,255,0.15) ${volume * 100}%)`,
                            }}
                            aria-label="Громкость"
                          />
                        </div>

                        {/* Queue button */}
                        <button
                          onClick={() => setPanel('queue')}
                          className="h-9 w-9 rounded-full grid place-items-center text-white/80 hover:text-white hover:bg-white/10 active:scale-90 transition-all relative"
                          aria-label="Очередь"
                        >
                          <ListMusic className="h-4 w-4" />
                          {queue.length > 1 && (
                            <span className="absolute -top-1 -right-1 text-[9px] bg-primary text-white rounded-full h-4 min-w-4 px-1 grid place-items-center">
                              {queue.length}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                </motion.div>
              )}

              {panel === 'queue' && (
                <motion.div
                  key="queue"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="flex-1 min-h-0 flex flex-col px-4 pb-6"
                >
                  <div className="flex items-center gap-2 mb-3 px-2">
                    <ListMusic className="h-5 w-5 text-white/80" />
                    <div className="text-white font-semibold">Очередь</div>
                    <div className="text-xs text-white/50 ml-auto">
                      {queue.length} треков
                    </div>
                  </div>
                  <div
                    data-scroll-lock-ignore
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-2xl"
                    style={{
                      WebkitOverflowScrolling: 'touch',
                      background: 'rgba(255,255,255,0.05)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                    }}
                  >
                    {queueDisplay.length === 0 ? (
                      <div className="text-center py-12 text-sm text-white/50">
                        Очередь пуста
                      </div>
                    ) : (
                      <div className="p-2 space-y-0.5">
                        {queueDisplay.map((track, idx) => (
                          <AudioCard
                            key={track.id}
                            track={track}
                            queue={queueDisplay}
                            compact
                            variant="onDark"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {panel === 'search' && (
                <motion.div
                  key="search"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="flex-1 min-h-0 flex flex-col px-4 pb-6"
                >
                  {/* Search bar */}
                  <div className="mb-3 px-2">
                    <div className="relative">
                      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Поиск музыки…"
                        autoFocus
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-white/10 border border-white/20 outline-none focus:border-white/40 text-white placeholder:text-white/50 transition-colors"
                      />
                    </div>
                  </div>

                  {/* v37: Categories (Музыка/Радио/Нашиды/Коран/Подкасты) removed.
                      Player searches 'music' across all sources automatically.
                      Source selector also removed — both hitmos + muzce are
                      always queried in parallel. */}

                  {/* Search results */}
                  <div
                    data-scroll-lock-ignore
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-2xl"
                    style={{
                      WebkitOverflowScrolling: 'touch',
                      background: 'rgba(255,255,255,0.05)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                    }}
                  >
                    {searchLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-white/60" />
                      </div>
                    )}
                    {!searchLoading && searchResults.length === 0 && (
                      <div className="text-center py-12 text-sm text-white/50">
                        <div className="text-3xl mb-2 opacity-50">🎧</div>
                        {searchQuery.trim() ? 'Ничего не найдено' : 'Введите запрос для поиска'}
                      </div>
                    )}
                    {!searchLoading && searchResults.length > 0 && (
                      <div className="p-2 space-y-0.5">
                        {searchResults.map((track) => (
                          <AudioCard
                            key={track.id}
                            track={track}
                            onPlay={handlePlayFromSearch}
                            queue={searchResults}
                            compact
                            variant="onDark"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
