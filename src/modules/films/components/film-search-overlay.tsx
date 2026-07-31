'use client'

// ============================================================================
// Video Hub — Search Overlay (v17.1)
// ----------------------------------------------------------------------------
// Полностью переработано под 5 новых источников. Стиль — точно как у Audio Hub
// после редизайна: тёмный glass + brand-градиент + spring-анимации.
// ============================================================================

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, X, Heart, Clock, History, Film as FilmIcon,
  Loader2, RotateCcw, Trash2, Play, Tv,
} from 'lucide-react'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { VoiceSearchButton } from '@/components/voice-search-button'
import type { Film, FilmDetails, FilmSource } from '../types'
import { searchFilms, getFilmSources } from '../api'
import { useFilmsStore } from '../store'
import { FilmCard } from './film-card'
import { FilmDetailScreen } from './film-detail-screen'
import { BrowseCatalog } from './browse-catalog'

type Tab = 'search' | 'favorites' | 'continue' | 'history'

interface FilmSearchOverlayProps {
  open: boolean
  onClose: () => void
  onSendToChat?: (film: FilmDetails) => void
  initialFilmId?: string | null
}

export function FilmSearchOverlay({ open, onClose, onSendToChat, initialFilmId }: FilmSearchOverlayProps) {
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Film[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFilm, setSelectedFilm] = useState<Film | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [sources, setSources] = useState<FilmSource[]>([])
  const [selectedSource, setSelectedSource] = useState<string>('all')

  // Lock background scroll while overlay is open. preserveTouchAction lets
  // horizontal-scroll chip strips (sources / tabs) work on touch devices.
  useScrollLock(open && !showDetail, { preserveTouchAction: true })

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)
  const store = useFilmsStore()

  // ---- Load sources on open ----
  // IMPORTANT: only depend on `open`, NOT on `store`. Otherwise every
  // store change (including setLastSearch inside doSearch) re-triggers
  // this effect and overwrites the user's current query with the trimmed
  // lastSearch value — causing the "deleted text reappears / space gets
  // deleted" bug.
  useEffect(() => {
    if (!open) return
    if (sources.length === 0) {
      getFilmSources().then(setSources).catch(() => {})
    }
    // Restore last search ONLY on open — use getState() to read once
    // without subscribing to store changes.
    const last = useFilmsStore.getState().lastSearch
    if (last) {
      setQuery(last.query)
      setResults(last.results)
    }
    setTimeout(() => inputRef.current?.focus(), 350)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ---- Initial film from chat card ----
  useEffect(() => {
    if (!open || !initialFilmId) return
    const baseFilm: Film = {
      id: initialFilmId,
      sourceId: '', sourceName: '',
      title: 'Загрузка…',
      year: null, description: '', posterUrl: null, url: '',
      isSeries: false,
    }
    setSelectedFilm(baseFilm)
    setShowDetail(true)
  }, [open, initialFilmId])

  // ---- Debounced search ----
  const doSearch = useCallback(async (q: string, source: string) => {
    if (q.trim().length < 2) {
      setResults([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await searchFilms(q.trim(), source)
      setResults(res)
      store.setLastSearch({ query: q.trim(), results: res, timestamp: Date.now() })
    } catch (e: any) {
      setError(e.message || 'Не удалось выполнить поиск')
    } finally {
      setLoading(false)
    }
  }, [store])

  const onQueryChange = useCallback((val: string) => {
    setQuery(val)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => doSearch(val, selectedSource), 400)
  }, [doSearch, selectedSource])

  const onSourceChange = useCallback((source: string) => {
    setSelectedSource(source)
    if (query.trim().length >= 2) {
      doSearch(query, source)
    }
  }, [query, doSearch])

  const handleOpenFilm = useCallback((film: Film) => {
    setSelectedFilm(film)
    setShowDetail(true)
  }, [])

  const handleSendFilm = useCallback(async (details: FilmDetails) => {
    if (onSendToChat) {
      onSendToChat(details)
      setShowDetail(false)
      onClose()
    }
  }, [onSendToChat, onClose])

  return (
    <>
      <AnimatePresence>
        {open && !showDetail && (
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
                className="rounded-t-[28px] overflow-hidden flex flex-col h-full"
                style={{
                  background: 'linear-gradient(180deg, rgba(15,15,30,0.92) 0%, rgba(10,10,20,0.95) 100%)',
                  backdropFilter: 'blur(28px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderBottom: 'none',
                  boxShadow: '0 -10px 40px -10px rgba(0,0,0,0.5)',
                }}
              >
                {/* Handle */}
                <div className="flex justify-center pt-2.5 pb-1">
                  <div className="h-1 w-10 rounded-full bg-white/20" />
                </div>

                {/* Header */}
                <div className="flex items-center gap-2 px-5 py-2">
                  <div
                    className="grid place-items-center h-8 w-8 rounded-xl shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
                      boxShadow: '0 4px 14px -2px rgba(139,92,246,0.5)',
                    }}
                  >
                    <FilmIcon className="h-4 w-4 text-white" />
                  </div>
                  <div className="text-base font-semibold text-white flex-1">Video Hub</div>
                  <button
                    onClick={onClose}
                    className="grid place-items-center h-8 w-8 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    aria-label="Закрыть"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Tabs */}
                <div data-scroll-lock-ignore className="flex gap-1 px-3 py-2 overflow-x-auto custom-scroll no-scrollbar">
                  <TabButton active={tab === 'search'} onClick={() => setTab('search')} icon={<Search className="h-3.5 w-3.5" />} label="Поиск" />
                  <TabButton active={tab === 'favorites'} onClick={() => setTab('favorites')} icon={<Heart className="h-3.5 w-3.5" />} label="Избранное" badge={store.favorites.length} />
                  <TabButton active={tab === 'continue'} onClick={() => setTab('continue')} icon={<Play className="h-3.5 w-3.5" />} label="Продолжить" badge={store.continueWatching.length} />
                  <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={<History className="h-3.5 w-3.5" />} label="История" badge={store.history.length} />
                </div>

                {/* Search input + source selector (only on search tab) */}
                {tab === 'search' && (
                  <>
                    <div data-scroll-lock-ignore className="px-4 pb-2">
                      <div
                        className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        <Search className="h-4 w-4 text-white/50 shrink-0" />
                        <input
                          ref={inputRef}
                          type="text"
                          value={query}
                          onChange={(e) => onQueryChange(e.target.value)}
                          placeholder="Поиск… или выберите из каталога ниже"
                          className="flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none min-w-0"
                        />
                        {query && (
                          <button
                            onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}
                            className="grid place-items-center h-5 w-5 rounded-full text-white/50 hover:text-white hover:bg-white/10"
                            aria-label="Очистить"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                        <VoiceSearchButton onResult={(text) => { onQueryChange(text); inputRef.current?.focus() }} />
                      </div>
                    </div>

                    {/* Source selector — horizontal scroll of source chips */}
                    {sources.length > 0 && (
                      <div data-scroll-lock-ignore className="flex gap-1.5 px-4 pb-2 overflow-x-auto custom-scroll no-scrollbar">
                        <SourceChip
                          active={selectedSource === 'all'}
                          onClick={() => onSourceChange('all')}
                          label="Все источники"
                        />
                        {sources.map((s) => (
                          <SourceChip
                            key={s.id}
                            active={selectedSource === s.id}
                            onClick={() => onSourceChange(s.id)}
                            label={`${s.emoji} ${s.name}`}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Content area */}
                <div
                  data-scroll-lock-ignore
                  className="flex-1 overflow-y-auto custom-scroll px-3"
                  style={{
                    WebkitOverflowScrolling: 'touch',
                    overscrollBehavior: 'contain',
                    paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                  }}
                >
                  {tab === 'search' && (
                    <>
                      {loading && (
                        <div className="grid place-items-center py-12">
                          <Loader2 className="h-8 w-8 text-white/60 animate-spin" />
                        </div>
                      )}
                      {error && !loading && (
                        <div className="text-center py-12 px-6">
                          <p className="text-sm text-white/70 mb-3">{error}</p>
                          <button
                            onClick={() => doSearch(query, selectedSource)}
                            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium inline-flex items-center gap-2"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Повторить
                          </button>
                        </div>
                      )}
                      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
                        <div className="text-center py-12 px-6">
                          <p className="text-sm text-white/60">Ничего не найдено по запросу «{query}»</p>
                          <p className="text-xs text-white/40 mt-2">Попробуйте другой источник или другой запрос</p>
                        </div>
                      )}
                      {!loading && !error && results.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold px-1 pt-1 pb-1.5">
                            Найдено: {results.length}
                          </div>
                          {results.map((film) => (
                            <FilmCard key={film.id} film={film} onPlay={handleOpenFilm} />
                          ))}
                        </div>
                      )}
                      {!loading && !error && query.trim().length < 2 && (
                        <BrowseCatalog onPlayFilm={handleOpenFilm} />
                      )}
                    </>
                  )}

                  {tab === 'favorites' && (
                    <ListView
                      empty={store.favorites.length === 0}
                      emptyText="Пока нет избранных фильмов"
                      emptyHint="Найдите фильм и нажмите ❤ чтобы добавить его сюда"
                    >
                      {store.favorites.map((film) => (
                        <FilmCard key={film.id} film={film} onPlay={handleOpenFilm} />
                      ))}
                    </ListView>
                  )}

                  {tab === 'continue' && (
                    <ListView
                      empty={store.continueWatching.length === 0}
                      emptyText="Нет начатых фильмов"
                      emptyHint="Воспроизведите любой фильм — здесь появится прогресс"
                    >
                      {store.continueWatching.map((p) => {
                        const film = store.history.find((f) => f.id === p.filmId) ||
                                     store.favorites.find((f) => f.id === p.filmId)
                        if (!film) return null
                        const pct = p.duration > 0 ? Math.min(100, (p.position / p.duration) * 100) : 0
                        return (
                          <div key={`${p.filmId}-${p.episodeId || ''}`} className="space-y-0.5">
                            <FilmCard film={film} onPlay={handleOpenFilm} />
                            <div className="ml-24 mr-2 h-1 rounded-full bg-white/10 overflow-hidden">
                              <div className="h-full" style={{ width: `${pct}%`, background: 'linear-gradient(to right, #6366f1, #ec4899)' }} />
                            </div>
                          </div>
                        )
                      })}
                    </ListView>
                  )}

                  {tab === 'history' && (
                    <ListView
                      empty={store.history.length === 0}
                      emptyText="История просмотров пуста"
                      emptyHint="Открытые фильмы появятся здесь"
                      onClear={store.history.length > 0 ? () => store.clearHistory() : undefined}
                      clearLabel="Очистить историю"
                    >
                      {store.history.map((film) => (
                        <FilmCard key={film.id} film={film} onPlay={handleOpenFilm} compact />
                      ))}
                    </ListView>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Detail screen overlay */}
      <AnimatePresence>
        {showDetail && selectedFilm && (
          <FilmDetailScreen
            film={selectedFilm}
            onClose={() => setShowDetail(false)}
            onSendToChat={onSendToChat ? handleSendFilm : undefined}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ---- Sub-components ----

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
        background: active ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : 'rgba(255,255,255,0.05)',
        border: active ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
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

function SourceChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
        active ? 'text-white' : 'text-white/60 hover:text-white'
      }`}
      style={{
        background: active ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : 'rgba(255,255,255,0.05)',
        border: active ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {label}
    </button>
  )
}

function ListView({ children, empty, emptyText, emptyHint, onClear, clearLabel }: {
  children: React.ReactNode
  empty: boolean
  emptyText: string
  emptyHint: string
  onClear?: () => void
  clearLabel?: string
}) {
  if (empty) {
    return (
      <div className="text-center py-12 px-6">
        <p className="text-sm text-white/60">{emptyText}</p>
        <p className="text-xs text-white/40 mt-1">{emptyHint}</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {onClear && (
        <div className="flex justify-end pb-1">
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            {clearLabel || 'Очистить'}
          </button>
        </div>
      )}
      {children}
    </div>
  )
}
