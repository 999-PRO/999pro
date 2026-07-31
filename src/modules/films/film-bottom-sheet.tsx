'use client'

// ============================================================================
// FilmBottomSheet — Bottom Sheet для фильма (точно как ProductPage для товара)
// ----------------------------------------------------------------------------
// Монтируется в page.tsx (как ProductPage), слушает событие '999pro:open-film'.
// Открывается как overlay поверх чата — чат остаётся на фоне.
// ============================================================================

import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Heart, Send, X, Calendar, Tv, Film as FilmIcon,
  Loader2, Clock,
} from 'lucide-react'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'
import type { Film, FilmDetails, FilmChatCardData } from './types'
import { getFilmDetails } from './api'
import { useFilmsStore } from './store'

const FilmPlayer = lazy(() =>
  import('./components/film-player').then((m) => ({ default: m.FilmPlayer }))
)

interface FilmBottomSheetProps {
  /** Payload of the film to show. When null, sheet is closed. */
  payload: FilmChatCardData | null
  onClose: () => void
}

function fmtDur(sec: number | null | undefined) {
  if (!sec) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h} ч ${m} мин`
  return `${m} мин`
}

export function FilmBottomSheet({ payload, onClose }: FilmBottomSheetProps) {
  const open = !!payload
  useScrollLock(open)
  // v18.12: Video Hub is admin-only. If a non-admin somehow triggers
  // '999pro:open-film' (e.g. via a film card in chat sent before the
  // restriction, or a deep link), show a toast and close immediately.
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'admin'
  useEffect(() => {
    if (open && !isAdmin) {
      toast.info('Video Hub скоро будет доступен. Раздел в разработке.')
      onClose()
    }
  }, [open, isAdmin, onClose])
  const [details, setDetails] = useState<FilmDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPlayer, setShowPlayer] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)

  const store = useFilmsStore()

  // Auto-select first episode when season changes or details load
  useEffect(() => {
    if (!details || !details.isSeries) return
    const eps = details.episodes?.filter(e => e.season === selectedSeason) || []
    if (eps.length > 0 && !eps.some(e => e.id === selectedEpisodeId)) {
      setSelectedEpisodeId(eps[0].id)
    }
  }, [details, selectedSeason, selectedEpisodeId])

  // Reset state when payload changes
  useEffect(() => {
    if (!payload) {
      setDetails(null)
      setShowPlayer(false)
      setError(null)
      setSelectedSeason(1)
      setSelectedEpisodeId(null)
      return
    }
    setLoading(true)
    setError(null)
    setDetails(null)
    setShowPlayer(false)
    setSelectedSeason(1)
    setSelectedEpisodeId(null)
    getFilmDetails(payload.id)
      .then((d) => {
        setDetails(d)
        setIsFavorite(store.isFavorite(payload.id))
        if (d.seasons && d.seasons.length > 0) {
          setSelectedSeason(d.seasons[0])
        }
        // Add to history
        const baseFilm: Film = {
          id: d.id,
          sourceId: d.sourceId,
          sourceName: d.sourceName,
          title: d.title,
          year: d.year,
          description: d.description,
          posterUrl: d.posterUrl,
          url: d.url,
          isSeries: d.isSeries,
        }
        store.addToHistory(baseFilm)
      })
      .catch((e) => setError(e.message || 'Не удалось загрузить'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.id])

  const toggleFavorite = useCallback(() => {
    if (!details) return
    const base: Film = {
      id: details.id,
      sourceId: details.sourceId,
      sourceName: details.sourceName,
      title: details.title,
      year: details.year,
      description: details.description,
      posterUrl: details.posterUrl,
      url: details.url,
      isSeries: details.isSeries,
    }
    store.toggleFavorite(base)
    setIsFavorite(store.isFavorite(details.id))
  }, [details, store])

  const handlePlay = useCallback(() => {
    setShowPlayer(true)
  }, [])

  const handleClose = useCallback(() => {
    setShowPlayer(false)
    onClose()
  }, [onClose])

  // Get progress — for selected episode or main film
  const progress = details
    ? store.getProgress(details.id, selectedEpisodeId || undefined)
    : null

  // Episodes for selected season
  const seasonEpisodes = details?.episodes?.filter(e => e.season === selectedSeason) || []

  // Selected episode object
  const selectedEpisode = details?.episodes?.find(e => e.id === selectedEpisodeId) || null

  // Get players for the player — from selected episode or main players
  const playerPlayers = details
    ? (() => {
        // If a specific episode is selected, use its players
        if (selectedEpisodeId) {
          const ep = details.episodes?.find(e => e.id === selectedEpisodeId)
          if (ep?.players && ep.players.length > 0) return ep.players
        }
        // For series without selected episode — use first episode of selected season
        if (details.isSeries && seasonEpisodes.length > 0) {
          const firstEp = seasonEpisodes[0]
          if (firstEp?.players && firstEp.players.length > 0) return firstEp.players
        }
        // Fallback to main players
        if (details.players.length > 0) return details.players
        return details.episodes?.[0]?.players || []
      })()
    : []

  // Player subtitle
  const playerSubtitle = selectedEpisode
    ? `Сезон ${selectedEpisode.season} · Серия ${selectedEpisode.episode}`
    : (details?.year ? String(details.year) : undefined)

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
            className="fixed inset-0 z-[195] bg-black/50"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={handleClose}
          />

          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36, mass: 0.9 }}
            className="fixed left-0 right-0 bottom-0 z-[196] mx-auto max-w-md"
            style={{ maxHeight: '85vh' }}
          >
            <div
              className="rounded-t-[28px] overflow-hidden flex flex-col film-bottom-sheet"
              style={{
                background: 'var(--card)',
                backdropFilter: 'blur(28px) saturate(180%)',
                WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                border: '1px solid var(--border)',
                borderBottom: 'none',
                boxShadow: '0 -10px 40px -10px rgba(0,0,0,0.3)',
              }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-2.5 pb-1 shrink-0">
                <div className="h-1 w-10 rounded-full bg-foreground/20" />
              </div>

              {/* Close button */}
              <button
                onClick={handleClose}
                className="absolute top-3 right-3 z-10 grid place-items-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>

              {/* Content */}
              <div className="overflow-y-auto custom-scroll px-4 pb-4">
                {loading ? (
                  <div className="grid place-items-center py-16">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  </div>
                ) : error ? (
                  <div className="text-center py-12 px-4">
                    <p className="text-sm text-muted-foreground mb-3">{error}</p>
                    <button onClick={handleClose} className="px-4 py-2 rounded-xl bg-primary/10 text-primary text-sm font-medium">
                      Закрыть
                    </button>
                  </div>
                ) : details ? (
                  <>
                    {/* Poster + info */}
                    <div className="flex gap-4 pt-2">
                      <div className="shrink-0 w-24 sm:w-28 aspect-[2/3] rounded-2xl overflow-hidden"
                        style={{ background: 'var(--muted)', boxShadow: '0 8px 24px -4px rgba(0,0,0,0.2)' }}
                      >
                        {details.posterUrl ? (
                          <img src={details.posterUrl} alt={details.title} className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-muted-foreground">
                            <FilmIcon className="h-8 w-8" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                            style={{ background: 'var(--gradient-soft)', color: 'var(--primary)' }}
                          >
                            {details.isSeries ? <Tv className="h-2.5 w-2.5" /> : <FilmIcon className="h-2.5 w-2.5" />}
                            {details.isSeries ? 'Сериал' : 'Фильм'}
                          </span>
                          {details.year && (
                            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5">
                              <Calendar className="h-2.5 w-2.5" /> {details.year}
                            </span>
                          )}
                        </div>
                        <h2 className="text-lg font-bold leading-tight mb-1">{details.title}</h2>
                        {details.sourceName && (
                          <div className="text-[10px] text-muted-foreground mb-1">{details.sourceName}</div>
                        )}
                        {details.seasons && details.seasons.length > 0 && (
                          <div className="text-xs text-muted-foreground mb-1">
                            {details.seasons.length > 1
                              ? `${details.seasons.length} сезонов · ${details.episodes.length} серий`
                              : `${details.episodes.length} серий`
                            }
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    {details.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed mt-3 line-clamp-2">
                        {details.description}
                      </p>
                    )}

                    {/* Continue watching */}
                    {progress && progress.position > 5 && progress.position < (progress.duration - 30) && (
                      <div className="mt-3 p-2.5 rounded-xl" style={{ background: 'var(--muted)' }}>
                        <div className="flex items-center gap-2 text-xs font-medium mb-1.5">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                          Продолжить с {Math.floor(progress.position / 60)}:{String(Math.floor(progress.position % 60)).padStart(2, '0')}
                        </div>
                        <div className="h-1 rounded-full bg-foreground/10 overflow-hidden">
                          <div className="h-full"
                            style={{
                              width: `${Math.min(100, (progress.position / progress.duration) * 100)}%`,
                              background: 'var(--gradient-brand)',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Season & Episode selector (only for series) */}
                    {details.isSeries && details.seasons && details.seasons.length > 0 && (
                      <div className="mt-3">
                        {/* Season selector — horizontal glass buttons */}
                        {details.seasons.length > 1 && (
                          <div className="flex gap-1.5 overflow-x-auto custom-scroll no-scrollbar pb-2">
                            {details.seasons.map((s) => (
                              <button
                                key={s}
                                onClick={() => { setSelectedSeason(s); setSelectedEpisodeId(null) }}
                                className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                                  s === selectedSeason ? 'text-white' : 'text-muted-foreground'
                                }`}
                                style={{
                                  background: s === selectedSeason
                                    ? 'var(--gradient-brand)'
                                    : 'var(--muted)',
                                }}
                              >
                                Сезон {s}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Episode grid — small glass number buttons */}
                        {seasonEpisodes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {seasonEpisodes.map((ep) => {
                              const epProgress = store.getProgress(details.id, ep.id)
                              const hasProgress = epProgress && epProgress.position > 5
                              const isSelected = ep.id === selectedEpisodeId
                              return (
                                <button
                                  key={ep.id}
                                  onClick={() => setSelectedEpisodeId(ep.id)}
                                  className={`relative h-8 w-8 rounded-lg text-xs font-semibold transition-all ${
                                    isSelected ? 'text-white scale-110' : 'text-muted-foreground'
                                  }`}
                                  style={{
                                    background: isSelected
                                      ? 'var(--gradient-brand)'
                                      : hasProgress
                                        ? 'color-mix(in oklch, var(--primary) 15%, var(--muted))'
                                        : 'var(--muted)',
                                  }}
                                  title={`Серия ${ep.episode}`}
                                >
                                  {ep.episode}
                                  {hasProgress && !isSelected && (
                                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full bg-primary" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {/* Selected episode info */}
                        {selectedEpisode && (
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            Сезон {selectedEpisode.season} · Серия {selectedEpisode.episode}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-4">
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={handlePlay}
                        disabled={playerPlayers.length === 0}
                        className="flex-1 h-12 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                        style={{ background: 'var(--gradient-brand)', boxShadow: '0 4px 16px -4px var(--primary)' }}
                      >
                        <Play className="h-4 w-4" fill="currentColor" />
                        {progress && progress.position > 5 ? 'Продолжить' : 'Смотреть'}
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={toggleFavorite}
                        className="grid place-items-center h-12 w-12 rounded-2xl transition-colors"
                        style={{
                          background: isFavorite ? 'rgba(236,72,153,0.15)' : 'var(--muted)',
                          border: isFavorite ? '1px solid rgba(236,72,153,0.3)' : 'none',
                        }}
                        aria-label="В избранное"
                      >
                        <Heart className={`h-5 w-5 ${isFavorite ? 'text-pink-500' : 'text-muted-foreground'}`}
                          fill={isFavorite ? 'currentColor' : 'none'} />
                      </motion.button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </motion.div>

          {/* Player overlay — opens directly when "Смотреть" is clicked */}
          {showPlayer && details && playerPlayers.length > 0 && (
            <Suspense fallback={
              <div className="fixed inset-0 z-[210] grid place-items-center bg-black/80">
                <Loader2 className="h-8 w-8 text-white animate-spin" />
              </div>
            }>
              <FilmPlayer
                key={`sheet-${details.id}-${selectedEpisodeId || 'main'}`}
                title={details.title}
                subtitle={playerSubtitle}
                posterUrl={details.posterUrl}
                players={playerPlayers}
                initialTime={progress?.position || 0}
                autoPlay
                onClose={() => setShowPlayer(false)}
              />
            </Suspense>
          )}
        </>
      )}
    </AnimatePresence>
  )
}
