'use client'

// ============================================================================
// Universal Search Overlay — single search across the entire app.
// ----------------------------------------------------------------------------
// Fires 3 parallel requests (universal backend, audio hub, films hub) and
// groups results by category. Opens via:
//   - the search button in the sidebar / mobile header
//   - the global `open-universal-search` window event
//   - the Cmd/Ctrl+K keyboard shortcut
//
// Result clicks dispatch the SAME window events that already exist for
// opening each entity, so we don't reinvent any wiring:
//   - product  → '999pro:open-product'   (page.tsx)
//   - chat     → 'chat:open-conversation' (chat.tsx) + navigate('chat')
//   - user     → POST /api/chat/conversations then 'chat:open-conversation'
//   - film     → 'open-film'              (page.tsx)
//   - audio    → plays via AudioPlayerManager (same as Audio Hub)
//   - info page → 'app:open-info-page'    (page.tsx)
// ============================================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  X,
  Music2,
  Film as FilmIcon,
  Package,
  MessageSquare,
  User as UserIcon,
  FileText,
  ChevronRight,
  Clock,
  TrendingUp,
  Command,
} from 'lucide-react'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'
import { useAudioHubStore } from '@/modules/audio-hub/store'
import { fetchAndCacheAudio } from '@/modules/audio-hub/cache'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { VoiceSearchButton } from '@/components/voice-search-button'
import { api, assetUrl } from '@/lib/api'
import { formatPrice, initials, timeAgo } from '@/lib/format'
import {
  useUniversalSearch,
  totalHits,
  categoriesWithResults,
  type CategoryKey,
  type UniversalProductHit,
  type UniversalUserHit,
  type UniversalChatHit,
  type UniversalPageHit,
} from '@/lib/use-universal-search'
import type { AudioHubTrack } from '@/modules/audio-hub/types'
import type { Film } from '@/modules/films/types'

// ---- Recent searches (localStorage) ----
const RECENTS_KEY = '999pro-universal-recents'
const RECENTS_MAX = 8

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string').slice(0, RECENTS_MAX) : []
  } catch {
    return []
  }
}

function saveRecent(q: string) {
  const trimmed = q.trim()
  if (trimmed.length < 2) return
  try {
    const cur = loadRecents()
    const next = [trimmed, ...cur.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(
      0,
      RECENTS_MAX,
    )
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota errors */
  }
}

// ---- Category meta ----
interface CategoryMeta {
  key: CategoryKey
  label: string
  icon: typeof Music2
  gradient: string
  glow: string
}

const CATEGORIES: CategoryMeta[] = [
  {
    key: 'products',
    label: 'Товары',
    icon: Package,
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    glow: 'rgba(16,185,129,0.5)',
  },
  {
    key: 'films',
    label: 'Фильмы',
    icon: FilmIcon,
    gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
    glow: 'rgba(99,102,241,0.5)',
  },
  {
    key: 'audio',
    label: 'Музыка',
    icon: Music2,
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    glow: 'rgba(245,158,11,0.5)',
  },
  {
    key: 'chats',
    label: 'Чаты',
    icon: MessageSquare,
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
    glow: 'rgba(59,130,246,0.5)',
  },
  {
    key: 'users',
    label: 'Люди',
    icon: UserIcon,
    gradient: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
    glow: 'rgba(168,85,247,0.5)',
  },
  {
    key: 'pages',
    label: 'Страницы',
    icon: FileText,
    gradient: 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
    glow: 'rgba(100,116,139,0.5)',
  },
]

// ---- Highlight match helper ----
function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text
  const q = query.trim()
  if (!q) return text
  const lower = text.toLowerCase()
  const qLower = q.toLowerCase()
  if (!lower.includes(qLower)) return text
  const parts: React.ReactNode[] = []
  let i = 0
  let key = 0
  while (i < text.length) {
    const idx = lower.indexOf(qLower, i)
    if (idx === -1) {
      parts.push(text.slice(i))
      break
    }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(
      <mark
        key={key++}
        style={{
          background: 'rgba(139,92,246,0.3)',
          color: '#fff',
          borderRadius: 3,
          padding: '0 2px',
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    i = idx + q.length
  }
  return <>{parts}</>
}

// ---- Main overlay component ----
export function UniversalSearchOverlay({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  useScrollLock(open, { preserveTouchAction: true })
  const [query, setQuery] = useState('')
  // `scope` controls which sources to query — when not 'all', only the
  // selected category's source fires. Persists across queries so the user
  // can do "voice → music → 'eminem'" without re-selecting each time.
  const [scope, setScope] = useState<'all' | CategoryKey>('all')
  const [recents, setRecents] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  // v18.12: Video Hub is admin-only. Non-admins don't see the "Фильмы"
  // category in universal search and can't open films from search results.
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'admin'
  // v18.12: filter out the 'films' category for non-admins.
  const visibleCategories = useMemo(() => CATEGORIES.filter((c) => isAdmin || c.key !== 'films'), [isAdmin])
  const {
    products,
    users,
    chats,
    pages,
    audio,
    films,
    loading,
    loadingUniversal,
    loadingAudio,
    loadingFilms,
  } = useUniversalSearch(query, isAuthenticated, scope)

  // ---- Load recents on open ----
  useEffect(() => {
    if (open) {
      setRecents(loadRecents())
      // v37: pick up initial query stashed by InlineSearch (mobile home) so
      // tapping a "recent" chip opens the overlay pre-filled with that query.
      const initial = (window as unknown as { __universalSearchInitialQuery?: string }).__universalSearchInitialQuery
      if (initial) {
        setQuery(initial)
        ;(window as unknown as { __universalSearchInitialQuery?: string }).__universalSearchInitialQuery = undefined
      } else {
        setTimeout(() => inputRef.current?.focus(), 200)
      }
    } else {
      setQuery('')
      setScope('all')
    }
  }, [open])

  // ---- Esc to close ----
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ---- Result handlers ----
  const playAudio = useAudioPlayer((s) => s.play)
  const addToHistory = useAudioHubStore((s) => s.addToHistory)

  const handlePlayAudio = useCallback(
    async (track: AudioHubTrack) => {
      addToHistory(track)
      const audioUrl = track.fullUrl || track.previewUrl
      if (!audioUrl) return
      const playableUrl = await fetchAndCacheAudio(track.id, audioUrl)
      playAudio({
        id: track.id,
        url: playableUrl,
        kind: 'music',
        title: track.title,
        subtitle: track.artist,
        coverUrl: track.coverUrl || undefined,
        duration: track.duration || undefined,
        source: track.source,
      })
      onClose()
    },
    [addToHistory, playAudio, onClose],
  )

  const handleOpenFilm = useCallback(
    (film: Film) => {
      // v18.12: Video Hub is admin-only. Non-admins can't open films
      // (the category is hidden, but this is a defense-in-depth check in
      // case a film result slips through via the "All" tab).
      if (!isAdmin) {
        toast.info('Video Hub скоро будет доступен. Раздел в разработке.')
        return
      }
      // page.tsx listens for '999pro:open-film' and opens FilmBottomSheet.
      window.dispatchEvent(
        new CustomEvent('999pro:open-film', {
          detail: {
            payload: {
              id: film.id,
              title: film.title,
              year: film.year,
              posterUrl: film.posterUrl,
              duration: null,
              description: film.description,
              isSeries: film.isSeries,
              sourceId: film.sourceId,
              sourceName: film.sourceName,
            },
          },
        }),
      )
      onClose()
    },
    [onClose, isAdmin],
  )

  const handleOpenProduct = useCallback(
    (p: UniversalProductHit) => {
      window.dispatchEvent(
        new CustomEvent('999pro:open-product', { detail: { productId: p.id } }),
      )
      onClose()
    },
    [onClose],
  )

  const handleOpenChat = useCallback(
    (c: UniversalChatHit) => {
      const url = new URL(window.location.href)
      url.searchParams.set('view', 'chat')
      window.history.replaceState({}, '', url.toString())
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('chat:open-conversation', { detail: { conversationId: c.id } }),
        )
      }, 250)
      onClose()
    },
    [onClose],
  )

  const handleOpenUser = useCallback(
    async (u: UniversalUserHit) => {
      try {
        const data = await api.post<{ conversation: { id: string } }>('/api/chat/conversations', {
          json: { participantId: u.id },
          auth: true,
        })
        const url = new URL(window.location.href)
        url.searchParams.set('view', 'chat')
        window.history.replaceState({}, '', url.toString())
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('chat:open-conversation', {
              detail: { conversationId: data.conversation.id },
            }),
          )
        }, 250)
      } catch {
        const url = new URL(window.location.href)
        url.searchParams.set('view', 'chat')
        window.history.replaceState({}, '', url.toString())
      }
      onClose()
    },
    [onClose],
  )

  const handleOpenPage = useCallback(
    (p: UniversalPageHit) => {
      window.dispatchEvent(
        new CustomEvent('app:open-info-page', { detail: { slug: p.slug } }),
      )
      onClose()
    },
    [onClose],
  )

  const handleSubmitQuery = (q: string) => {
    if (q.trim().length >= 2) {
      saveRecent(q.trim())
      setRecents(loadRecents())
    }
  }

  // ---- Filtered categories ----
  const allResults = { products, users, chats, pages, audio, films }
  const visibleCats = useMemo(() => categoriesWithResults(allResults), [allResults])
  const total = totalHits(allResults)

  // v37: scope replaces activeCategory. When scope is 'all', render every
  // category that has results. When scope narrows to one category, render
  // ONLY that category (and only if it has results).
  const catsToRender =
    scope === 'all'
      ? visibleCats
      : visibleCats.includes(scope)
        ? [scope]
        : []

  const showEmpty = query.trim().length >= 2 && !loading && total === 0

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
            className="fixed inset-0 z-[97] bg-black/50 dark:bg-black/50"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36, mass: 0.9 }}
            className="fixed left-0 right-0 bottom-0 z-[98] mx-auto max-w-2xl"
          >
            <div
              className="rounded-t-[28px] overflow-hidden flex flex-col"
              style={{
                height: '88vh',
                background:
                  'linear-gradient(180deg, rgba(15,15,30,0.94) 0%, rgba(10,10,20,0.97) 100%)',
                backdropFilter: 'blur(28px) saturate(160%)',
                WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderBottom: 'none',
                boxShadow: '0 -20px 60px -10px rgba(0,0,0,0.6)',
              }}
            >
              {/* Search input row */}
              <div className="px-4 pt-4 pb-3 shrink-0">
                <div className="flex items-center gap-3">
                  <div
                    className="grid place-items-center h-10 w-10 rounded-xl shrink-0"
                    style={{
                      background:
                        'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
                      boxShadow: '0 6px 20px -4px rgba(99,102,241,0.5)',
                    }}
                  >
                    <Search className="h-5 w-5 text-foreground" />
                  </div>
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSubmitQuery(query)
                      if (e.key === 'Escape') onClose()
                    }}
                    placeholder="Поиск по всему приложению..."
                    className="flex-1 bg-transparent text-foreground text-base placeholder:text-muted-foreground/70 outline-none min-w-0"
                  />
                  {/* Voice search button — uses Web Speech API (Chrome/Edge/Safari).
                      Hidden on browsers that don't support SpeechRecognition. */}
                  <VoiceSearchButton
                    onResult={(text) => {
                      setQuery(text)
                      handleSubmitQuery(text)
                    }}
                    size="sm"
                  />
                  {/* v24.3: REMOVED the clear-query (X) button. Previously there
                      were TWO X buttons side by side — one to clear the query
                      and one to close the search — which looked like a duplicate
                      close button. Now only the close button remains. Users can
                      clear the query by selecting all text and deleting, or by
                      closing and reopening the search. */}
                  <button
                    onClick={onClose}
                    aria-label="Закрыть"
                    className="grid place-items-center h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Category chips — appear ONLY after a query is typed.
                    These act as scope selectors: tapping "Музыка" while
                    results are showing narrows the live search to just music
                    (other sources stop firing on the next query). Tapping
                    "Все" returns to all-sources mode. */}
                {(query.trim().length >= 2 || visibleCats.length > 0) && (
                  <div
                    data-scroll-lock-ignore
                    className="flex gap-1.5 mt-3 overflow-x-auto custom-scroll no-scrollbar"
                  >
                    <CategoryChip
                      active={scope === 'all'}
                      onClick={() => setScope('all')}
                      label={`Все${total > 0 ? ` · ${total}` : ''}`}
                    />
                    {visibleCategories.filter((c) => allResults[c.key].length > 0).map((c) => {
                      const count = allResults[c.key].length
                      return (
                        <CategoryChip
                          key={c.key}
                          active={scope === c.key}
                          onClick={() => setScope(c.key)}
                          label={`${c.label} · ${count}`}
                        />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Content area */}
              <div
                data-scroll-lock-ignore
                className="flex-1 overflow-y-auto custom-scroll px-3 pb-4"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehavior: 'contain',
                  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                }}
              >
                {/* Loading state */}
                {/* Streaming loading state — show per-source spinners so the user
                    sees progress while waiting for the slowest source (Audio Hub
                    external API can take 5-10s on cold cache). */}
                {loading && total === 0 && query.trim().length >= 2 && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <div
                      className="h-8 w-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin mb-3"
                      style={{ animationDuration: '0.6s' }}
                    />
                    <div className="text-sm">Ищем «{query}»...</div>
                  </div>
                )}

                {/* Empty state — only when ALL sources are done AND nothing found */}
                {showEmpty && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Search className="h-10 w-10 mb-3 opacity-50" />
                    <div className="text-sm font-medium text-foreground/80 mb-1">
                      Ничего не найдено
                    </div>
                    <div className="text-xs">
                      Попробуйте изменить запрос или проверить категорию
                    </div>
                  </div>
                )}

                {/* Initial state (no query) — show recents + tips */}
                {query.trim().length < 2 && !loading && (
                  <InitialContent
                    recents={recents}
                    onPickRecent={(q) => setQuery(q)}
                    onClearRecents={() => {
                      localStorage.removeItem(RECENTS_KEY)
                      setRecents([])
                    }}
                    activeScope={scope}
                    onPickScope={(s) => {
                      setScope(s)
                      // Focus the input so the user can immediately start
                      // typing or press the mic button — no extra tap needed.
                      setTimeout(() => inputRef.current?.focus(), 100)
                    }}
                    isAdmin={isAdmin}
                  />
                )}

                {/* Results — grouped by category. Renders AS SOON AS any source
                    returns, even if other sources are still loading. Pending
                    sources show an inline "still searching" footer. */}
                {query.trim().length >= 2 && total > 0 && (
                  <div className="space-y-5 pt-1">
                    {catsToRender.map((catKey) => {
                      const meta = CATEGORIES.find((c) => c.key === catKey)!
                      const items = allResults[catKey]
                      if (items.length === 0) return null
                      return (
                        <CategorySection
                          key={catKey}
                          meta={meta}
                          count={items.length}
                          onShowAll={
                            scope === 'all'
                              ? () => setScope(catKey)
                              : undefined
                          }
                        >
                          {catKey === 'products' &&
                            (products as UniversalProductHit[]).map((p) => (
                              <ProductRow
                                key={p.id}
                                hit={p}
                                query={query}
                                onClick={() => handleOpenProduct(p)}
                              />
                            ))}
                          {catKey === 'films' &&
                            (films as Film[]).map((f) => (
                              <FilmRow
                                key={f.id}
                                hit={f}
                                query={query}
                                onClick={() => handleOpenFilm(f)}
                              />
                            ))}
                          {catKey === 'audio' &&
                            (audio as AudioHubTrack[]).map((t) => (
                              <AudioRow
                                key={t.id}
                                hit={t}
                                query={query}
                                onClick={() => handlePlayAudio(t)}
                              />
                            ))}
                          {catKey === 'chats' &&
                            (chats as UniversalChatHit[]).map((c) => (
                              <ChatRow
                                key={c.id}
                                hit={c}
                                query={query}
                                onClick={() => handleOpenChat(c)}
                              />
                            ))}
                          {catKey === 'users' &&
                            (users as UniversalUserHit[]).map((u) => (
                              <UserRow
                                key={u.id}
                                hit={u}
                                query={query}
                                onClick={() => handleOpenUser(u)}
                              />
                            ))}
                          {catKey === 'pages' &&
                            (pages as UniversalPageHit[]).map((p) => (
                              <PageRow
                                key={p.id}
                                hit={p}
                                query={query}
                                onClick={() => handleOpenPage(p)}
                              />
                            ))}
                        </CategorySection>
                      )
                    })}

                    {/* Per-source "still searching" indicator — shown when some
                        sources are still pending after others have already
                        returned results. Helps the user understand that more
                        results may appear. */}
                    {(loadingAudio || loadingFilms) && (
                      <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground/70">
                        <div
                          className="h-3 w-3 rounded-full border border-white/20 border-t-white/60 animate-spin"
                          style={{ animationDuration: '0.8s' }}
                        />
                        <span>
                          {loadingAudio && loadingFilms
                            ? 'Ищем музыку и фильмы…'
                            : loadingAudio
                              ? 'Ищем музыку…'
                              : 'Ищем фильмы…'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom hint (desktop only — Cmd+K) */}
              <div className="hidden md:flex items-center justify-center gap-2 px-4 py-2 border-t border-white/5 text-[11px] text-muted-foreground/70 shrink-0">
                <Command className="h-3 w-3" />
                <span>+ K — открыть поиск</span>
                <span className="mx-2">·</span>
                <span>Esc — закрыть</span>
                <span className="mx-2">·</span>
                <span>Enter — искать</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function CategoryChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground bg-foreground/5'
      }`}
      style={
        active
          ? {
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
              boxShadow: '0 4px 14px -2px rgba(139,92,246,0.5)',
            }
          : undefined
      }
    >
      {label}
    </button>
  )
}

function CategorySection({
  meta: { label, icon: Icon, gradient, glow },
  count,
  onShowAll,
  children,
}: {
  meta: CategoryMeta
  count: number
  onShowAll?: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-2 mb-2">
        <div
          className="grid place-items-center h-6 w-6 rounded-md shrink-0"
          style={{ background: gradient, boxShadow: `0 4px 12px -2px ${glow}` }}
        >
          <Icon className="h-3.5 w-3.5 text-foreground" />
        </div>
        <div className="text-xs font-semibold text-foreground/90 uppercase tracking-wide">{label}</div>
        <div className="text-[11px] text-muted-foreground/70">· {count}</div>
        {onShowAll && (
          <button
            onClick={onShowAll}
            className="ml-auto text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          >
            Все <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function ResultRow({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-colors hover:bg-foreground/5"
      style={{ background: 'rgba(255,255,255,0.025)' }}
    >
      {children}
    </motion.button>
  )
}

function ProductRow({
  hit,
  query,
  onClick,
}: {
  hit: UniversalProductHit
  query: string
  onClick: () => void
}) {
  return (
    <ResultRow onClick={onClick}>
      <div className="h-12 w-12 rounded-lg overflow-hidden shrink-0 bg-foreground/5 grid place-items-center">
        {hit.image ? (
           
          <img
            src={assetUrl(hit.image)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <Package className="h-5 w-5 text-muted-foreground/70" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground font-medium truncate">{highlight(hit.title, query)}</div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          {hit.category && <span className="truncate">{hit.category}</span>}
          <span className="shrink-0">·</span>
          <span className="text-emerald-400 font-semibold">
            {formatPrice(hit.price, hit.currency)}
          </span>
          {hit.oldPrice && (
            <span className="line-through text-muted-foreground/50 shrink-0">
              {formatPrice(hit.oldPrice, hit.currency)}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </ResultRow>
  )
}

function FilmRow({
  hit,
  query,
  onClick,
}: {
  hit: Film
  query: string
  onClick: () => void
}) {
  return (
    <ResultRow onClick={onClick}>
      <div className="h-14 w-10 rounded-md overflow-hidden shrink-0 bg-foreground/5 grid place-items-center">
        {hit.posterUrl ? (
           
          <img src={hit.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <FilmIcon className="h-4 w-4 text-muted-foreground/70" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground font-medium truncate">{highlight(hit.title, query)}</div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
          {hit.isSeries && (
            <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold">
              СЕРИАЛ
            </span>
          )}
          {hit.year && <span>{hit.year}</span>}
          {hit.sourceName && (
            <>
              <span>·</span>
              <span className="truncate">{hit.sourceName}</span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </ResultRow>
  )
}

function AudioRow({
  hit,
  query,
  onClick,
}: {
  hit: AudioHubTrack
  query: string
  onClick: () => void
}) {
  return (
    <ResultRow onClick={onClick}>
      <div className="h-12 w-12 rounded-lg overflow-hidden shrink-0 bg-foreground/5 grid place-items-center">
        {hit.coverUrl ? (
           
          <img src={hit.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Music2 className="h-5 w-5 text-muted-foreground/70" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground font-medium truncate">{highlight(hit.title, query)}</div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {highlight(hit.artist, query)}
          {hit.album && hit.album !== hit.title && <span> · {hit.album}</span>}
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground/70 shrink-0 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 uppercase">
        {hit.source}
      </div>
    </ResultRow>
  )
}

function ChatRow({
  hit,
  query,
  onClick,
}: {
  hit: UniversalChatHit
  query: string
  onClick: () => void
}) {
  return (
    <ResultRow onClick={onClick}>
      <div className="relative shrink-0">
        <Avatar src={hit.avatar} name={hit.name} />
        {hit.isOnline && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-[rgba(15,15,30,1)]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground font-medium truncate">{highlight(hit.name, query)}</div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {hit.lastMessagePreview ? highlight(hit.lastMessagePreview, query) : 'Нет сообщений'}
          {hit.lastMessageAt && <span> · {timeAgo(hit.lastMessageAt)}</span>}
        </div>
      </div>
      <MessageSquare className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </ResultRow>
  )
}

function UserRow({
  hit,
  query,
  onClick,
}: {
  hit: UniversalUserHit
  query: string
  onClick: () => void
}) {
  return (
    <ResultRow onClick={onClick}>
      <div className="relative shrink-0">
        <Avatar src={hit.avatar} name={hit.displayName || hit.username} />
        {hit.isOnline && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-[rgba(15,15,30,1)]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground font-medium truncate">
          {highlight(hit.displayName || hit.username, query)}
        </div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          @{highlight(hit.username, query)}
        </div>
      </div>
      <UserIcon className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </ResultRow>
  )
}

function PageRow({
  hit,
  query,
  onClick,
}: {
  hit: UniversalPageHit
  query: string
  onClick: () => void
}) {
  return (
    <ResultRow onClick={onClick}>
      <div className="h-10 w-10 rounded-lg shrink-0 grid place-items-center bg-foreground/5">
        <FileText className="h-4 w-4 text-muted-foreground/70" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground font-medium truncate">{highlight(hit.title, query)}</div>
        {hit.subtitle && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {highlight(hit.subtitle, query)}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </ResultRow>
  )
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const fallback = initials(name) || '?'
  if (src) {
    return (
      <div className="h-11 w-11 rounded-full overflow-hidden shrink-0 bg-foreground/5">
        { }
        <img src={assetUrl(src)} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
    )
  }
  return (
    <div
      className="h-11 w-11 rounded-full shrink-0 grid place-items-center text-foreground text-sm font-semibold"
      style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
    >
      {fallback}
    </div>
  )
}

// ---- Initial content (no query) ----
function InitialContent({
  recents,
  onPickRecent,
  onClearRecents,
  activeScope,
  onPickScope,
  isAdmin,
}: {
  recents: string[]
  onPickRecent: (q: string) => void
  onClearRecents: () => void
  /** Currently selected scope ('all' = none). Used to highlight the active card. */
  activeScope: 'all' | CategoryKey
  /** Called when the user taps one of the "Что можно искать" cards. */
  onPickScope: (scope: 'all' | CategoryKey) => void
  /** v18.12: admin flag — hides the "Фильмы" card for non-admins. */
  isAdmin: boolean
}) {
  // v18.12: filter out 'films' for non-admins.
  const cats = CATEGORIES.filter((c) => isAdmin || c.key !== 'films')
  return (
    <div className="pt-4">
      {recents.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 px-2 mb-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">
              Недавние
            </div>
            <button
              onClick={onClearRecents}
              className="ml-auto text-[11px] text-muted-foreground/70 hover:text-foreground/80"
            >
              Очистить
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 px-2">
            {recents.map((q, i) => (
              <button
                key={i}
                onClick={() => onPickRecent(q)}
                className="px-3 py-1.5 rounded-full text-xs text-foreground/80 bg-foreground/5 hover:bg-foreground/10 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 px-2 mb-3">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">
            Что можно искать
          </div>
          {activeScope !== 'all' && (
            <button
              onClick={() => onPickScope('all')}
              className="ml-auto text-[11px] text-muted-foreground/70 hover:text-foreground/80 underline underline-offset-2"
            >
              Все источники
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 px-2">
          {cats.map((c) => {
            const isActive = activeScope === c.key
            return (
              <motion.button
                key={c.key}
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => onPickScope(c.key)}
                aria-pressed={isActive}
                aria-label={`Искать только: ${c.label}`}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                style={{
                  background: isActive
                    ? 'rgba(255,255,255,0.1)'
                    : 'rgba(255,255,255,0.03)',
                  border: isActive
                    ? `1px solid ${c.glow}`
                    : '1px solid rgba(255,255,255,0.05)',
                  boxShadow: isActive ? `0 4px 18px -4px ${c.glow}` : 'none',
                }}
              >
                <div
                  className="grid place-items-center h-8 w-8 rounded-lg shrink-0"
                  style={{
                    background: c.gradient,
                    boxShadow: `0 4px 12px -2px ${c.glow}`,
                    opacity: isActive ? 1 : 0.85,
                  }}
                >
                  <c.icon className="h-4 w-4 text-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="text-xs font-medium"
                    style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.85)' }}
                  >
                    {c.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 truncate">
                    {c.key === 'products' && 'Каталог'}
                    {c.key === 'films' && 'Сериалы и кино'}
                    {c.key === 'audio' && 'Треки и радио'}
                    {c.key === 'chats' && 'Диалоги'}
                    {c.key === 'users' && 'Профили'}
                    {c.key === 'pages' && 'Информация'}
                  </div>
                </div>
                {isActive && (
                  <span
                    className="shrink-0 grid place-items-center h-5 w-5 rounded-full text-foreground text-[10px] font-bold"
                    style={{ background: c.gradient }}
                  >
                    ✓
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>

        <div className="mt-6 px-3 py-3 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            💡 Нажмите на карточку выше, чтобы искать только в этом разделе.
            Голосом — кнопка 🎤 в строке поиска.
          </div>
        </div>
      </div>
    </div>
  )
}
