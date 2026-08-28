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

  // v25.17 (owner: «мне показалось что не работает плеер»): клик-сик работал,
  // но перетаскивание ползунка — нет. Добавляем полноценный drag-seek через
  // Pointer Events: зажал — тянешь — отпустил. Плюс подсветка активного трека.
  const seekBarRef = useRef<HTMLDivElement>(null)
  const isDraggingSeekRef = useRef(false)

  const seekFromClientX = (clientX: number) => {
    const el = seekBarRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const frac = (clientX - rect.left) / rect.width
    seek(Math.max(0, Math.min(1, frac)))
  }

  const onSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingSeekRef.current = true
    seekFromClientX(e.clientX)
  }
  const onSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSeekRef.current) return
    seekFromClientX(e.clientX)
  }
  const onSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingSeekRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
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
          {/* Backdrop with blurred cover — v25.18: + аурора-орбы для глубины */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[200] overflow-hidden"
            onClick={() => setOpen(false)}
            style={{
              background: currentTrack.coverUrl
                ? `linear-gradient(to bottom, rgba(12,10,26,0.88), rgba(8,6,20,0.96)), url(${currentTrack.coverUrl}) center/cover`
                : 'radial-gradient(120% 90% at 80% 0%, #241035 0%, #140b24 55%, #0a0616 100%)',
              backdropFilter: 'blur(40px) saturate(120%)',
              WebkitBackdropFilter: 'blur(40px) saturate(120%)',
            }}
          >
            <div
              aria-hidden
              className="absolute -top-[18%] -left-[22%] w-[75vmax] h-[75vmax] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.20) 0%, transparent 65%)', filter: 'blur(30px)' }}
            />
            <div
              aria-hidden
              className="absolute -bottom-[22%] -right-[25%] w-[80vmax] h-[80vmax] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 65%)', filter: 'blur(30px)' }}
            />
          </motion.div>

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
                Медиахаб · плеер
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
                    {/* Cover — v25.18: крупнее, вращающийся conic-гало при
                        воспроизведении, стеклянное кольцо, глубокая тень */}
                    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-4">
                      <div className="relative w-full max-w-[300px] aspect-square grid place-items-center">
                        {/* Вращающееся гало (только когда играет) */}
                        {isPlaying && (
                          <motion.div
                            aria-hidden
                            className="absolute inset-[-7%] rounded-full pointer-events-none"
                            style={{
                              background: 'conic-gradient(from 0deg, rgba(236,72,153,0.55), rgba(168,85,247,0.15), rgba(124,58,237,0.55), rgba(236,72,153,0.55))',
                              filter: 'blur(26px)',
                              opacity: 0.55,
                            }}
                            animate={{ rotate: 360 }}
                            transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
                          />
                        )}
                        <motion.div
                          layout
                          className="relative w-full aspect-square rounded-[34px] overflow-hidden"
                          animate={isPlaying ? { scale: 1 } : { scale: 0.93 }}
                          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                          style={{
                            boxShadow: '0 34px 80px -24px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.18)',
                          }}
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
                          {/* Лёгкий стеклянный отблеск сверху */}
                          <div
                            aria-hidden
                            className="absolute inset-0 pointer-events-none"
                            style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.14) 0%, transparent 32%)' }}
                          />
                        </motion.div>
                      </div>

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

                    {/* Progress bar — v25.18: толще, стеклянные чипы времени,
                        glow при воспроизведении, drag-seek (Pointer Events) */}
                    <div className="px-8 pb-4">
                      <div
                        ref={seekBarRef}
                        onPointerDown={onSeekPointerDown}
                        onPointerMove={onSeekPointerMove}
                        onPointerUp={onSeekPointerUp}
                        onPointerCancel={onSeekPointerUp}
                        className="relative h-2 rounded-full cursor-pointer group touch-none"
                        style={{ background: 'rgba(255,255,255,0.14)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)' }}
                      >
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${progress * 100}%`,
                            background: 'linear-gradient(90deg, #EC4899, #A855F7)',
                            boxShadow: isPlaying ? '0 0 14px -2px rgba(168,85,247,0.8)' : 'none',
                          }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-4.5 w-4.5 rounded-full transition-transform group-hover:scale-125"
                          style={{
                            left: `calc(${progress * 100}% - 9px)`,
                            width: 18,
                            height: 18,
                            background: '#fff',
                            boxShadow: '0 2px 10px rgba(0,0,0,0.45), 0 0 0 4px rgba(255,255,255,0.12)',
                          }}
                        />
                      </div>
                      <div className="flex justify-between mt-2.5">
                        <span
                          className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' }}
                        >
                          {formatTime(currentTime)}
                        </span>
                        <span
                          className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' }}
                        >
                          -{formatTime(Math.max(0, (duration || 0) - currentTime))}
                        </span>
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
                          className="h-12 w-12 rounded-full grid place-items-center text-white active:scale-90 transition-all"
                          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                          aria-label="Предыдущий"
                        >
                          <SkipBack className="h-5 w-5" fill="white" />
                        </button>

                        {/* Play/Pause — v25.18: крупнее + дышащее гало */}
                        <div className="relative">
                          {isPlaying && (
                            <motion.span
                              aria-hidden
                              className="absolute inset-0 rounded-full pointer-events-none"
                              style={{ background: 'rgba(168,85,247,0.45)' }}
                              animate={{ scale: [1, 1.55], opacity: [0.5, 0] }}
                              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                            />
                          )}
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            whileHover={{ scale: 1.05 }}
                            onClick={togglePlay}
                            className="relative h-[72px] w-[72px] rounded-full grid place-items-center text-white"
                            style={{
                              background: 'linear-gradient(135deg, #EC4899 0%, #A855F7 55%, #7C3AED 100%)',
                              boxShadow: '0 14px 40px -8px rgba(124,58,237,0.7), inset 0 1px 0 rgba(255,255,255,0.35), 0 0 0 1.5px rgba(255,255,255,0.16)',
                            }}
                            aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
                          >
                            {isLoading ? (
                              <Loader2 className="h-8 w-8 animate-spin" />
                            ) : isPlaying ? (
                              <Pause className="h-8 w-8" fill="white" />
                            ) : (
                              <Play className="h-8 w-8 ml-1" fill="white" />
                            )}
                          </motion.button>
                        </div>

                        {/* Next */}
                        <button
                          onClick={next}
                          className="h-12 w-12 rounded-full grid place-items-center text-white active:scale-90 transition-all"
                          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
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
