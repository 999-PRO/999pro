'use client'

// ============================================================================
// Video Hub — Film Detail Screen (v17.1)
// ----------------------------------------------------------------------------
// Полный экран фильма с постером, описанием, кнопками.
// Для сериалов — выбор сезона + серии.
// Поддержка нескольких плееров — пользователь может переключаться.
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Play, Heart, Send, Clock, Star, Calendar,
  Film as FilmIcon, Tv, Loader2, CheckCircle2, ListVideo, Layers,
  MessageCircle, X as XIcon,
} from 'lucide-react'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { api } from '@/lib/api'
import type { Film, FilmDetails, FilmEpisode, FilmPlayerOption } from '../types'
import { getFilmDetails, getEpisodePlayers } from '../api'
import { useFilmsStore } from '../store'
import { FilmPlayer } from './film-player'

interface FilmDetailScreenProps {
  film: Film
  onClose: () => void
  onSendToChat?: (film: FilmDetails) => void
}

export function FilmDetailScreen({ film, onClose, onSendToChat }: FilmDetailScreenProps) {
  const [details, setDetails] = useState<FilmDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPlayer, setShowPlayer] = useState(false)
  const [selectedEpisode, setSelectedEpisode] = useState<FilmEpisode | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number>(1)
  const [selectedTranslation, setSelectedTranslation] = useState<string>('')
  const [isFavorite, setIsFavorite] = useState(false)

  // Lock background scroll while detail screen is open (and player is NOT).
  // preserveTouchAction so horizontal-scroll chip strips work on touch.
  useScrollLock(!showPlayer, { preserveTouchAction: true })
  const [shareToast, setShareToast] = useState(false)
  const [chatPickerOpen, setChatPickerOpen] = useState(false)
  const [conversations, setConversations] = useState<any[]>([])
  const [loadingConvs, setLoadingConvs] = useState(false)
  const [sendingToConv, setSendingToConv] = useState(false)

  const store = useFilmsStore()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getFilmDetails(film.id)
      .then((d) => {
        if (cancelled) return
        setDetails(d)
        if (d.seasons && d.seasons.length > 0) setSelectedSeason(d.seasons[0])
        if (d.translations.length > 0) setSelectedTranslation(d.translations[0])
        store.addToHistory({
          id: d.id,
          sourceId: d.sourceId,
          sourceName: d.sourceName,
          title: d.title,
          year: d.year,
          description: d.description,
          posterUrl: d.posterUrl,
          url: d.url,
          isSeries: d.isSeries,
        })
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message || 'Не удалось загрузить информацию о фильме')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [film.id])

  useEffect(() => {
    setIsFavorite(store.isFavorite(film.id))
  }, [film.id, store])

  const toggleFavorite = useCallback(() => {
    const base: Film = {
      id: film.id,
      sourceId: details?.sourceId || film.sourceId,
      sourceName: details?.sourceName || film.sourceName,
      title: details?.title || film.title,
      year: details?.year ?? film.year,
      description: details?.description || film.description,
      posterUrl: details?.posterUrl || film.posterUrl,
      url: details?.url || film.url,
      isSeries: details?.isSeries ?? film.isSeries,
    }
    store.toggleFavorite(base)
    setIsFavorite(store.isFavorite(film.id))
  }, [film, details, store])

  // ---- Send to chat ----
  // If onSendToChat is provided (from chat context), send directly to current chat.
  // Otherwise, open a chat picker so the user can choose which conversation to send to.
  const handleSendToChat = useCallback(async () => {
    if (!details) return
    if (onSendToChat) {
      onSendToChat(details)
      return
    }
    // Global context — open chat picker
    setChatPickerOpen(true)
    setLoadingConvs(true)
    try {
      const data = await api.get('/api/chat/conversations', { auth: true })
      const convs = (data as any)?.conversations || (data as any) || []
      setConversations(Array.isArray(convs) ? convs : [])
    } catch {
      setConversations([])
    } finally {
      setLoadingConvs(false)
    }
  }, [details, onSendToChat])

  const sendToConversation = useCallback(async (convId: string) => {
    if (!details) return
    setSendingToConv(true)
    try {
      const cardData = {
        id: details.id,
        title: details.title,
        year: details.year,
        posterUrl: details.posterUrl,
        description: details.description,
        isSeries: details.isSeries,
        sourceId: details.sourceId,
        sourceName: details.sourceName,
      }
      await api.post(`/api/chat/conversations/${convId}/messages`, {
        json: {
          mediaUrl: JSON.stringify(cardData),
          mediaType: 'film',
        },
        auth: true,
      })
      setChatPickerOpen(false)
      setShareToast(true)
      setTimeout(() => setShareToast(false), 2500)
    } catch {
      // Fallback: try navigator.share
      try {
        if (navigator.share) {
          await navigator.share({
            title: details.title,
            text: `${details.title} (${details.year || '—'})`,
          })
        }
      } catch {/* ignore */}
    } finally {
      setSendingToConv(false)
    }
  }, [details])

  const [resolvingEpisode, setResolvingEpisode] = useState(false)

  const handlePlay = useCallback(async (episode?: FilmEpisode) => {
    if (!details) return
    if (episode) {
      // Lazy-load episode players if not already resolved
      if (episode.players.length === 0) {
        setResolvingEpisode(true)
        setSelectedEpisode(episode)  // for spinner display
        try {
          const players = await getEpisodePlayers(episode.url)
          // Mutate the episode in the details to cache the result
          episode.players = players
          // Also update translations/qualities collections
          for (const p of players) {
            if (p.translation && !details.translations.includes(p.translation)) {
              details.translations.push(p.translation)
            }
            if (p.quality && !details.qualities.includes(p.quality)) {
              details.qualities.push(p.quality)
            }
          }
        } catch {/* ignore — episode.players stays empty */}
        finally { setResolvingEpisode(false) }
      } else {
        setSelectedEpisode(episode)
      }
      // Open player only if there are players (filtered or unfiltered)
      const epPlayers = selectedTranslation
        ? episode.players.filter(p => !p.translation || p.translation === selectedTranslation)
        : episode.players
      if (epPlayers.length > 0 || episode.players.length > 0) {
        setShowPlayer(true)
      }
    } else {
      setSelectedEpisode(null)
      setShowPlayer(true)
    }
  }, [details, selectedTranslation])

  const progress = details
    ? store.getProgress(details.id, selectedEpisode?.id)
    : null

  const onPlayerProgress = useCallback((position: number, dur: number) => {
    if (!details) return
    store.upsertProgress({
      filmId: details.id,
      episodeId: selectedEpisode?.id,
      position,
      duration: dur,
      updatedAt: Date.now(),
    })
  }, [details, selectedEpisode, store])

  // Get players for current selection (episode or film)
  const playerStreams: FilmPlayerOption[] = (() => {
    if (!details) return []
    if (selectedEpisode) return selectedEpisode.players
    return details.players
  })()

  // Filter by translation if selected
  const filteredPlayers = selectedTranslation
    ? playerStreams.filter(p => !p.translation || p.translation === selectedTranslation)
    : playerStreams

  const playerTitle = details?.title || film.title
  const playerSubtitle = selectedEpisode
    ? `Сезон ${selectedEpisode.season} · Серия ${selectedEpisode.episode}`
    : details?.year ? String(details.year) : undefined

  const seasonEpisodes = details?.episodes?.filter(e => e.season === selectedSeason) || []

  const fmtDur = (sec: number | null | undefined) => {
    if (!sec) return null
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (h > 0) return `${h} ч ${m} мин`
    return `${m} мин`
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[200]"
      style={{ background: 'linear-gradient(180deg, #0a0a14 0%, #0f0f1f 50%, #050510 100%)' }}
    >
      {/* Background blur from poster */}
      {details?.posterUrl && (
        <div
          className="absolute inset-0 opacity-25 pointer-events-none"
          style={{
            backgroundImage: `url(${details.posterUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            filter: 'blur(60px) saturate(140%)',
            transform: 'scale(1.2)',
          }}
        />
      )}
      <div className="absolute inset-0 bg-black/40 pointer-events-none" />

      {/* Scrollable content — NO safe-area padding here (top bar handles it) */}
      <div
        data-scroll-lock-ignore
        className="relative h-full overflow-y-auto custom-scroll"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
      >
        {/* Top bar — floating buttons, 20px from status bar */}
        <div
          className="sticky top-0 z-20 px-3 flex items-center gap-2"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)',
            paddingBottom: '8px',
            background: 'linear-gradient(to bottom, rgba(10,10,20,0.6) 0%, rgba(10,10,20,0) 100%)',
          }}
        >
          <button
            onClick={onClose}
            className="grid place-items-center h-9 w-9 text-white active:scale-90 transition-transform"
            style={{
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))',
            }}
            aria-label="Назад"
          >
            <ArrowLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <div className="flex-1" />
        </div>

        {/* Hero block */}
        <div className="relative px-4 pt-2 pb-6 max-w-3xl mx-auto">
          {loading ? (
            <div className="grid place-items-center py-20">
              <Loader2 className="h-10 w-10 text-white/70 animate-spin" />
            </div>
          ) : error ? (
            <div className="grid place-items-center py-20 text-center px-6">
              <p className="text-white/80 text-sm mb-4">{error}</p>
              <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium">
                Закрыть
              </button>
            </div>
          ) : details ? (
            <>
              {/* Poster + meta */}
              <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                  className="shrink-0 w-44 sm:w-52 aspect-[2/3] rounded-2xl overflow-hidden"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 20px 60px -10px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
                  }}
                >
                  {details.posterUrl ? (
                    <img
                      src={details.posterUrl}
                      alt={details.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-white/30">
                      <FilmIcon className="h-12 w-12" />
                    </div>
                  )}
                </motion.div>

                <div className="flex-1 min-w-0 text-center sm:text-left">
                  {/* Source + type chips */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-2 justify-center sm:justify-start">
                    <span className="text-[10px] px-2 py-0.5 rounded-full text-white/70 font-semibold" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {details.sourceName}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-white/80"
                      style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)' }}
                    >
                      {details.isSeries ? <Tv className="h-3 w-3" /> : <FilmIcon className="h-3 w-3" />}
                      {details.isSeries ? 'Сериал' : 'Фильм'}
                    </span>
                  </div>

                  <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-2">
                    {details.title}
                  </h1>

                  <div className="flex flex-wrap items-center gap-3 text-sm text-white/70 mb-3 justify-center sm:justify-start">
                    {details.year && (
                      <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {details.year}</span>
                    )}
                    {details.players.length > 0 && (
                      <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> {details.players.length} плеер(ов)</span>
                    )}
                  </div>

                  {/* Available qualities + translations */}
                  {(details.qualities.length > 0 || details.translations.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 mb-4 justify-center sm:justify-start">
                      {details.qualities.map((q, i) => (
                        <span key={i} className="px-2.5 py-0.5 rounded-full text-[11px] font-medium text-white/80"
                          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                        >
                          {q}
                        </span>
                      ))}
                      {details.translations.slice(0, 4).map((t, i) => (
                        <span key={i} className="px-2.5 py-0.5 rounded-full text-[11px] font-medium text-white/80"
                          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-2.5 mt-6 max-w-md mx-auto sm:mx-0">
                {progress && progress.position > 5 && progress.position < (progress.duration - 30) && (
                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => handlePlay(selectedEpisode || undefined)}
                    className="relative w-full h-14 rounded-2xl text-white font-semibold text-base flex items-center justify-center gap-2 overflow-hidden"
                    style={{
                      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
                      boxShadow: '0 10px 30px -5px rgba(139,92,246,0.6)',
                    }}
                  >
                    <Play className="h-5 w-5" fill="currentColor" />
                    Продолжить с {Math.floor(progress.position / 60)}:{String(Math.floor(progress.position % 60)).padStart(2, '0')}
                  </motion.button>
                )}

                <div className="flex gap-2.5">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handlePlay()}
                    disabled={details.players.length === 0 && !details.isSeries}
                    className="flex-1 h-14 rounded-2xl text-white font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: 'rgba(255,255,255,0.12)',
                      backdropFilter: 'blur(20px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}
                  >
                    <Play className="h-5 w-5" fill="currentColor" />
                    {details.isSeries ? 'Начать просмотр' : 'Смотреть'}
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleFavorite}
                    className="grid place-items-center h-14 w-14 rounded-2xl"
                    style={{
                      background: isFavorite ? 'rgba(236,72,153,0.2)' : 'rgba(255,255,255,0.12)',
                      backdropFilter: 'blur(20px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                      border: isFavorite ? '1px solid rgba(236,72,153,0.5)' : '1px solid rgba(255,255,255,0.2)',
                    }}
                    aria-label="В избранное"
                  >
                    <Heart className={`h-5 w-5 ${isFavorite ? 'text-pink-400' : 'text-white'}`} fill={isFavorite ? 'currentColor' : 'none'} />
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSendToChat}
                    className="grid place-items-center h-14 w-14 rounded-2xl"
                    style={{
                      background: 'rgba(255,255,255,0.12)',
                      backdropFilter: 'blur(20px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}
                    aria-label="Отправить в чат"
                  >
                    <Send className="h-5 w-5 text-white" />
                  </motion.button>
                </div>
              </div>

              {/* Description */}
              {details.description && (
                <div className="mt-6 max-w-2xl">
                  <h3 className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">Описание</h3>
                  <p className="text-sm text-white/85 leading-relaxed whitespace-pre-line">{details.description}</p>
                </div>
              )}

              {/* Series: seasons + episodes + translation selector */}
              {details.isSeries && details.seasons && details.seasons.length > 0 && (
                <div className="mt-8">
                  <div className="flex items-center gap-2 mb-3">
                    <ListVideo className="h-4 w-4 text-white/70" />
                    <h3 className="text-xs uppercase tracking-wider text-white/50 font-semibold">Сезоны и серии</h3>
                  </div>

                  {/* Translation selector (if multiple) */}
                  {details.translations.length > 1 && (
                    <div className="mb-3">
                      <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1.5">Перевод</div>
                      <div data-scroll-lock-ignore className="flex gap-1.5 overflow-x-auto pb-2 custom-scroll no-scrollbar">
                        <button
                          onClick={() => setSelectedTranslation('')}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                            !selectedTranslation ? 'text-white' : 'text-white/60 hover:text-white'
                          }`}
                          style={{
                            background: !selectedTranslation ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                          }}
                        >
                          Все
                        </button>
                        {details.translations.map((t) => (
                          <button
                            key={t}
                            onClick={() => setSelectedTranslation(t)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                              t === selectedTranslation ? 'text-white' : 'text-white/60 hover:text-white'
                            }`}
                            style={{
                              background: t === selectedTranslation ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255,255,255,0.05)',
                              border: '1px solid rgba(255,255,255,0.1)',
                            }}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Season selector */}
                  <div data-scroll-lock-ignore className="flex gap-1.5 overflow-x-auto pb-2 mb-3 custom-scroll no-scrollbar">
                    {details.seasons.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSelectedSeason(s)}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${
                          s === selectedSeason ? 'text-white' : 'text-white/60 hover:text-white'
                        }`}
                        style={{
                          background: s === selectedSeason ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        Сезон {s}
                      </button>
                    ))}
                  </div>

                  {/* Episodes grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {seasonEpisodes.map((ep, i) => {
                      const epProgress = store.getProgress(details.id, ep.id)
                      const epPct = epProgress && epProgress.duration > 0
                        ? Math.min(100, (epProgress.position / epProgress.duration) * 100)
                        : 0
                      // Filter players by translation
                      const epPlayers = selectedTranslation
                        ? ep.players.filter(p => !p.translation || p.translation === selectedTranslation)
                        : ep.players
                      const epHasPlayers = ep.players.length > 0
                      return (
                        <motion.button
                          key={ep.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.02 }}
                          onClick={() => handlePlay(ep)}
                          className="group flex gap-3 p-2.5 rounded-xl text-left"
                          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                        >
                          <div className="shrink-0 h-16 w-28 rounded-lg overflow-hidden relative grid place-items-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
                            {resolvingEpisode && selectedEpisode?.id === ep.id ? (
                              <Loader2 className="h-5 w-5 text-white/70 animate-spin" />
                            ) : (
                              <Play className="h-6 w-6 text-white/50 group-hover:text-white transition-colors" fill="currentColor" />
                            )}
                            {epPct > 0 && (
                              <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: 'rgba(0,0,0,0.5)' }}>
                                <div className="h-full" style={{ width: `${epPct}%`, background: 'linear-gradient(to right, #6366f1, #ec4899)' }} />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 py-0.5">
                            <div className="text-sm font-semibold text-white truncate">Серия {ep.episode}</div>
                            <div className="text-[11px] text-white/50 mt-0.5">
                              {epHasPlayers
                                ? `${epPlayers.length || ep.players.length} плеер(ов)${epPlayers[0]?.translation ? ' · ' + epPlayers[0].translation : ''}`
                                : 'Нажмите для загрузки плееров'
                              }
                            </div>
                            {epProgress && epProgress.position > 5 && (
                              <div className="text-[10px] text-indigo-300 mt-1 inline-flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {Math.floor(epProgress.position / 60)} мин просмотрено
                              </div>
                            )}
                          </div>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* No streams fallback */}
              {!details.isSeries && details.players.length === 0 && (
                <div className="mt-6 p-4 rounded-xl text-center" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-sm text-white/70">
                    Поток недоступен для этого фильма. Попробуйте найти его на другом источнике.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
        {/* Bottom safe-area spacer so content isn't cut off by home indicator */}
        <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 32px)' }} />
      </div>

      {/* Player overlay — centered modal with blurred background */}
      <AnimatePresence>
        {showPlayer && details && filteredPlayers.length > 0 && (
          <FilmPlayer
            key={`player-${selectedEpisode?.id || 'main'}`}
            title={playerTitle}
            subtitle={playerSubtitle}
            posterUrl={details.posterUrl}
            players={filteredPlayers}
            initialTime={progress?.position || 0}
            autoPlay
            onProgress={onPlayerProgress}
            onEnded={() => {
              if (selectedEpisode && details.episodes) {
                const idx = details.episodes.findIndex((e) => e.id === selectedEpisode.id)
                const next = details.episodes[idx + 1]
                if (next && next.players.length > 0) {
                  setSelectedEpisode(next)
                  setShowPlayer(false)
                  setTimeout(() => setShowPlayer(true), 50)
                }
              }
            }}
            onClose={() => setShowPlayer(false)}
          />
        )}
      </AnimatePresence>

      {/* Share toast */}
      <AnimatePresence>
        {shareToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[220] px-4 py-2.5 rounded-xl text-white text-sm font-medium flex items-center gap-2"
            style={{
              background: 'rgba(15,23,42,0.9)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Ссылка скопирована
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat picker overlay */}
      <AnimatePresence>
        {chatPickerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[230] grid place-items-end sm:place-items-center"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setChatPickerOpen(false) }}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="w-full sm:max-w-md max-h-[70vh] overflow-y-auto custom-scroll rounded-t-3xl sm:rounded-3xl p-4"
              style={{
                background: 'linear-gradient(180deg, rgba(15,15,30,0.98) 0%, rgba(10,10,20,0.98) 100%)',
                backdropFilter: 'blur(28px) saturate(180%)',
                border: '1px solid rgba(255,255,255,0.1)',
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-white" />
                  <h3 className="text-base font-semibold text-white">Отправить в чат</h3>
                </div>
                <button onClick={() => setChatPickerOpen(false)}
                  className="grid place-items-center h-8 w-8 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Закрыть"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>

              {loadingConvs ? (
                <div className="grid place-items-center py-8">
                  <Loader2 className="h-8 w-8 text-white/60 animate-spin" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="text-center py-8 text-sm text-white/60">
                  Нет доступных чатов
                </div>
              ) : (
                <div className="space-y-1.5">
                  {conversations.map((conv) => {
                    const name = conv.displayName || conv.name || conv.otherUser?.username || 'Чат'
                    const avatar = conv.otherUser?.avatar
                    return (
                      <button
                        key={conv.id}
                        onClick={() => sendToConversation(conv.id)}
                        disabled={sendingToConv}
                        className="w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition-colors hover:bg-white/5 disabled:opacity-50"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        <div className="shrink-0 h-10 w-10 rounded-full overflow-hidden grid place-items-center"
                          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                        >
                          {avatar ? (
                            <img src={avatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-white text-sm font-bold">{name.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{name}</div>
                          {conv.lastMessage && (
                            <div className="text-xs text-white/50 truncate">{conv.lastMessage.content || 'Медиа'}</div>
                          )}
                        </div>
                        <Send className="h-4 w-4 text-white/40 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
