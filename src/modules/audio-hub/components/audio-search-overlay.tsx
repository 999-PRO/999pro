'use client'

// ============================================================================
// AudioSearchOverlay — стеклянное окно Media Hub · Музыка (v25.16 polish)
// ----------------------------------------------------------------------------
//   • Премиальный хедер: брендовый орб-логотип + подзаголовок + верхняя
//     радужная линия — единый облик с остальными шапками приложения
//   • Живой аурора-фон в цветах бренда за списком (как у Apple Music)
//   • Мини-плеер «Сейчас играет» получил прогресс-полосу внизу карточки
//   • Остальное поведение (табы Поиск/Избранное/История) сохранено
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, Loader2, Heart, Clock, Music2, Trash2, Play, Pause } from 'lucide-react'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { VoiceSearchButton } from '@/components/voice-search-button'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { useAudioHubSearch } from '../use-audio-hub-search'
import { useAudioHubStore } from '../store'
import { AudioCard } from './audio-card'
import type { AudioHubTrack, AudioHubKind } from '../types'

interface AudioSearchOverlayProps {
  open: boolean
  onClose: () => void
  onSelect: (track: AudioHubTrack) => void
  /** Called when the user plays a track (for auto-sending card to chat). */
  onPlay?: (track: AudioHubTrack) => void
  /** Whether to show the "Send" button on cards (false for global overlay). */
  showSendButton?: boolean
  /** v22: initial search query (used by AI Assistant autoplay flow). */
  initialQuery?: string
  /** v22: if true, auto-trigger search on open using initialQuery. */
  autoSearch?: boolean
  /** v22: callback fired when search results arrive — used for autoplay. */
  onResults?: (tracks: AudioHubTrack[]) => void
}

type Tab = 'search' | 'favorites' | 'history'

export function AudioSearchOverlay({
  open,
  onClose,
  onSelect,
  onPlay,
  showSendButton = true,
  initialQuery = '',
  autoSearch = false,
  onResults,
}: AudioSearchOverlayProps) {
  useScrollLock(open)

  // v17: always search 'music' kind across all sources. The user no longer
  // picks a kind — search hits all sources at once and returns mixed results.
  const { query, setQuery, results, loading, touched } = useAudioHubSearch('music' as AudioHubKind)
  const [tab, setTab] = useState<Tab>('search')
  const inputRef = useRef<HTMLInputElement>(null)
  const hasAutoSearchedRef = useRef(false)
  const resultsFiredRef = useRef(false)

  const favorites = useAudioHubStore((s) => s.favorites)
  const history = useAudioHubStore((s) => s.history)
  const clearHistory = useAudioHubStore((s) => s.clearHistory)

  // v25: Audio player state for "now playing" card
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  // v25.16: прогресс для волосинки мини-плеера
  const npProgress = useAudioPlayer((s) => s.progress)

  const openFullPlayer = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-music-player'))
    }
  }

  useEffect(() => {
    if (open) {
      setTab('search')
      // v22: AI Assistant autoplay flow — set initialQuery + auto-trigger search.
      if (autoSearch && initialQuery && !hasAutoSearchedRef.current) {
        hasAutoSearchedRef.current = true
        resultsFiredRef.current = false
        setQuery(initialQuery)
      } else if (!autoSearch && !query) {
        setTimeout(() => inputRef.current?.focus(), 300)
      }
    } else {
      // Reset on close so a subsequent open with new query re-triggers.
      hasAutoSearchedRef.current = false
      resultsFiredRef.current = false
    }
  }, [open, query, autoSearch, initialQuery])

  // v22: Fire onResults callback when search results arrive (for autoplay).
  useEffect(() => {
    if (onResults && results.length > 0 && !resultsFiredRef.current && autoSearch) {
      resultsFiredRef.current = true
      onResults(results)
    }
  }, [results, onResults, autoSearch])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[97] bg-black/40"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36, mass: 0.9 }}
            className="fixed left-0 right-0 bottom-0 z-[98] mx-auto max-w-md"
            style={{ height: '85vh' }}
          >
            <div
              className="rounded-t-[32px] overflow-hidden flex flex-col h-full relative"
              style={{
                background: 'linear-gradient(180deg, rgba(15,15,30,0.92) 0%, rgba(10,10,20,0.96) 100%)',
                backdropFilter: 'blur(28px) saturate(160%)',
                WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderBottom: 'none',
                boxShadow: '0 -10px 40px -10px rgba(0,0,0,0.5)',
              }}
            >
              {/* v25.16: верхняя градиентная линия бренда */}
              <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] pointer-events-none"
                style={{ background: 'linear-gradient(90deg,#F59E0B,#8B5CF6 45%,#6366F1 75%,#EC4899)' }} />
              {/* v25.16: мягкая аурора в фоне списка */}
              <motion.span aria-hidden className="absolute -top-24 -right-20 h-72 w-72 rounded-full pointer-events-none"
                style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.18), transparent 70%)', filter: 'blur(24px)' }}
                animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
              <motion.span aria-hidden className="absolute bottom-10 -left-24 h-80 w-80 rounded-full pointer-events-none"
                style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.14), transparent 70%)', filter: 'blur(28px)' }}
                animate={{ scale: [1.1, 1, 1.1] }}
                transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
              {/* Handle bar */}
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="h-1 w-10 rounded-full bg-white/20" />
              </div>

              {/* Header — v25.16: брендовый облик Media Hub */}
              <div className="flex items-center gap-3 px-5 py-2.5">
                <div className="relative grid place-items-center h-11 w-11 rounded-2xl shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, #F59E0B 0%, #EC4899 55%, #8B5CF6 120%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35), 0 8px 22px -6px rgba(236,72,153,0.5)',
                  }}>
                  <Music2 className="h-5 w-5 text-white" fill="currentColor" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold text-white leading-none">Медиахаб</div>
                  <div className="text-[11px] text-white/50 mt-1">Музыка · поиск по всем источникам</div>
                </div>
                <button
                  onClick={onClose}
                  className="grid place-items-center h-9 w-9 rounded-full text-white/60 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
                  aria-label="Закрыть"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Tab switcher: Search / Favorites / History — same style as Video Hub */}
              <div data-scroll-lock-ignore className="flex gap-1 px-3 py-2 overflow-x-auto no-scrollbar">
                <TabButton active={tab === 'search'} onClick={() => setTab('search')} icon={<Search className="h-3.5 w-3.5" />} label="Поиск" />
                <TabButton active={tab === 'favorites'} onClick={() => setTab('favorites')} icon={<Heart className="h-3.5 w-3.5" />} label="Избранное" badge={favorites.length} />
                <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={<Clock className="h-3.5 w-3.5" />} label="История" badge={history.length} />
              </div>

              {/* Search bar (only on search tab) */}
              {tab === 'search' && (
                <div data-scroll-lock-ignore className="px-4 pb-2">
                  <div
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    <Search className="h-4 w-4 text-white/50 shrink-0" />
                    <input
                      ref={inputRef}
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Поиск музыки…"
                      className="flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none min-w-0"
                    />
                    {query && (
                      <button
                        onClick={() => { setQuery(''); inputRef.current?.focus() }}
                        className="grid place-items-center h-5 w-5 rounded-full text-white/50 hover:text-white hover:bg-white/10"
                        aria-label="Очистить"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <VoiceSearchButton onResult={(text) => { setQuery(text); inputRef.current?.focus() }} />
                  </div>
                </div>
              )}

              {/* v25: "Now Playing" card — shown if a track is loaded */}
              {currentTrack && (
                <div className="px-3 pb-2">
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={openFullPlayer}
                    className="relative overflow-hidden flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer"
                    style={{
                      background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.1) 100%)',
                      border: '1px solid rgba(139,92,246,0.2)',
                    }}
                  >
                    {/* Cover */}
                    <div className="shrink-0 h-10 w-10 rounded-xl overflow-hidden grid place-items-center"
                      style={{ background: 'var(--gradient-brand)' }}>
                      {currentTrack.coverUrl ? (
                        <img src={currentTrack.coverUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Music2 className="h-4 w-4 text-white" />
                      )}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] uppercase tracking-wider text-white/40 font-semibold">Сейчас играет</div>
                      <div className="text-xs font-semibold text-white truncate">{currentTrack.title}</div>
                      <div className="text-[10px] text-white/50 truncate">{currentTrack.subtitle}</div>
                    </div>
                    {/* Play/Pause */}
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePlay() }}
                      className="grid place-items-center h-9 w-9 rounded-full shrink-0 shadow-lg"
                      style={{
                        background: isPlaying ? 'var(--gradient-brand)' : 'rgba(255,255,255,0.14)',
                        border: '1px solid rgba(255,255,255,0.2)',
                      }}
                      aria-label={isPlaying ? 'Пауза' : 'Играть'}
                    >
                      {isPlaying
                        ? <Pause className="h-4 w-4 text-white" fill="currentColor" />
                        : <Play className="h-4 w-4 text-white ml-0.5" fill="currentColor" />}
                    </button>
                    {/* v25.16: прогресс-волосинка внизу мини-плеера */}
                    {typeof npProgress === 'number' && npProgress >= 0 && (
                      <span
                        aria-hidden
                        className="absolute left-0 bottom-0 h-[2px] rounded-full"
                        style={{ width: `${Math.min(npProgress, 1) * 100}%`, background: 'var(--gradient-brand)' }}
                      />
                    )}
                  </motion.div>
                </div>
              )}

              {/* Content area */}
              <div
                data-scroll-lock-ignore
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+16px)]"
                style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}
              >
                {/* Search tab */}
                {tab === 'search' && (
                  <>
                    {loading && (
                      <div className="grid place-items-center py-12">
                        <Loader2 className="h-8 w-8 text-white/60 animate-spin" />
                      </div>
                    )}
                    {!loading && touched && results.length === 0 && query.trim() && (
                      <div className="text-center py-12 px-6">
                        <div className="text-3xl mb-2 opacity-50">🎵</div>
                        <p className="text-sm text-white/60">Ничего не найдено</p>
                        <p className="text-xs text-white/40 mt-1">Попробуйте другой запрос</p>
                      </div>
                    )}
                    {!loading && !touched && !query.trim() && (
                      <div className="text-center py-12 px-6">
                        <div className="text-3xl mb-2 opacity-50">🎧</div>
                        <p className="text-sm text-white/60">Введите запрос для поиска</p>
                        <p className="text-xs text-white/40 mt-1">Поиск по hitmos + muzce</p>
                      </div>
                    )}
                    {!loading && results.length > 0 && (
                      <div className="space-y-0.5 py-1">
                        {results.map((track) => (
                          <AudioCard
                            key={track.id}
                            track={track}
                            showSendButton={showSendButton}
                            onSend={onSelect}
                            onPlay={onPlay}
                            queue={results}
                            compact
                            variant="onDark"
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Favorites tab */}
                {tab === 'favorites' && (
                  <>
                    {favorites.length === 0 ? (
                      <div className="text-center py-12 px-6">
                        <div className="text-3xl mb-2 opacity-50">❤️</div>
                        <p className="text-sm text-white/60">Избранное пусто</p>
                        <p className="text-xs text-white/40 mt-1">Найдите трек и нажмите ❤ чтобы добавить</p>
                      </div>
                    ) : (
                      <div className="space-y-0.5 py-1">
                        {favorites.map((track) => (
                          <AudioCard
                            key={track.id}
                            track={track}
                            showSendButton={showSendButton}
                            onSend={onSelect}
                            onPlay={onPlay}
                            queue={favorites}
                            compact
                            variant="onDark"
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* History tab */}
                {tab === 'history' && (
                  <>
                    {history.length === 0 ? (
                      <div className="text-center py-12 px-6">
                        <div className="text-3xl mb-2 opacity-50">🕐</div>
                        <p className="text-sm text-white/60">История пуста</p>
                        <p className="text-xs text-white/40 mt-1">Прослушанные треки появятся здесь</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-end pb-1">
                          <button
                            onClick={clearHistory}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                            Очистить
                          </button>
                        </div>
                        <div className="space-y-0.5 py-1">
                          {history.map((track) => (
                            <AudioCard
                              key={track.id}
                              track={track}
                              showSendButton={showSendButton}
                              onSend={onSelect}
                              onPlay={onPlay}
                              queue={history}
                              compact
                              variant="onDark"
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ---- Sub-components (shared with Video Hub) ----

function TabButton({ active, onClick, icon, label, badge }: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
        active ? 'text-white' : 'text-white/60 hover:text-white'
      }`}
      style={{
        background: active
          ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
          : 'rgba(255,255,255,0.05)',
        border: active ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className="ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
          style={{
            background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
            color: active ? '#fff' : 'rgba(255,255,255,0.7)',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
