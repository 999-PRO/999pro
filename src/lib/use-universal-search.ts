'use client'

// ============================================================================
// Universal Search hook — streaming results from 3 parallel sources.
// ----------------------------------------------------------------------------
// Each source updates INDEPENDENTLY as soon as it responds. The UI can render
// partial results immediately — no need to wait for the slowest source
// (Audio Hub's external hitmos API can take 5-10s on a cold cache).
//
// Sources:
//   1. /api/search/universal  → products, users (auth), chats (auth), pages
//   2. /api/audio-hub/search   → audio tracks (external, slow on cold cache)
//   3. /api/films/search       → films (3 DLE sites in parallel)
//
// Each source has its own `loading` flag so the UI can show per-category
// spinners instead of one global blocker.
// ============================================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import type { AudioHubTrack } from '@/modules/audio-hub/types'
import type { Film } from '@/modules/films/types'

// ---- Backend response types (mirror of universal-search.ts) ----
export interface UniversalProductHit {
  id: string
  title: string
  price: number
  oldPrice: number | null
  currency: string
  category: string | null
  image: string | null
  inStock: boolean
  rating: number
  reviewsCount: number
}

export interface UniversalUserHit {
  id: string
  username: string
  displayName: string | null
  avatar: string | null
  isOnline: boolean
}

export interface UniversalChatHit {
  id: string
  type: string
  name: string
  avatar: string | null
  isOnline: boolean
  lastMessagePreview: string | null
  lastMessageAt: string | null
  unreadCount: number
}

export interface UniversalPageHit {
  id: string
  slug: string
  title: string
  subtitle: string | null
  icon: string
}

export interface UniversalSearchResults {
  products: UniversalProductHit[]
  users: UniversalUserHit[]
  chats: UniversalChatHit[]
  pages: UniversalPageHit[]
  audio: AudioHubTrack[]
  films: Film[]
}

export interface UniversalSearchState extends UniversalSearchResults {
  // Per-source loading flags — UI shows a spinner only for sources still pending.
  loadingUniversal: boolean
  loadingAudio: boolean
  loadingFilms: boolean
  // Aggregate loading — true while ANY source is still pending.
  loading: boolean
}

const EMPTY: UniversalSearchState = {
  products: [],
  users: [],
  chats: [],
  pages: [],
  audio: [],
  films: [],
  loadingUniversal: false,
  loadingAudio: false,
  loadingFilms: false,
  loading: false,
}

export type CategoryKey = 'products' | 'users' | 'chats' | 'pages' | 'audio' | 'films'

// Search scope — restricts which sources are queried. When scope != 'all',
// only the relevant sources fire; the others stay empty (no wasted requests,
// no waiting for slow audio/films if the user only wants products).
export type SearchScope = 'all' | CategoryKey

// Map scope → which sources to fire
const SCOPE_FIRES_UNIVERSAL = (s: SearchScope) =>
  s === 'all' || s === 'products' || s === 'users' || s === 'chats' || s === 'pages'
const SCOPE_FIRES_AUDIO = (s: SearchScope) => s === 'all' || s === 'audio'
const SCOPE_FIRES_FILMS = (s: SearchScope) => s === 'all' || s === 'films'

export function useUniversalSearch(
  query: string,
  isAuthenticated: boolean,
  scope: SearchScope = 'all',
): UniversalSearchState {
  const [state, setState] = useState<UniversalSearchState>(EMPTY)
  const fetchIdRef = useRef(0)

  // Stable setters for each source — each updates only its slice + its loading flag.
  const setUniversal = useCallback((data: Partial<UniversalSearchResults>) => {
    setState((s) => ({
      ...s,
      ...data,
      loadingUniversal: false,
      loading: s.loadingAudio || s.loadingFilms,
    }))
  }, [])

  const setAudio = useCallback((audio: AudioHubTrack[]) => {
    setState((s) => ({
      ...s,
      audio,
      loadingAudio: false,
      loading: s.loadingUniversal || s.loadingFilms,
    }))
  }, [])

  const setFilms = useCallback((films: Film[]) => {
    setState((s) => ({
      ...s,
      films,
      loadingFilms: false,
      loading: s.loadingUniversal || s.loadingAudio,
    }))
  }, [])

  useEffect(() => {
    const q = query.trim()
    let alive = true
    const myFetchId = ++fetchIdRef.current

    if (q.length < 2) {
      setState(EMPTY)
      return
    }

    // Determine which sources to fire based on scope.
    const fireUniversal = SCOPE_FIRES_UNIVERSAL(scope)
    const fireAudio = SCOPE_FIRES_AUDIO(scope)
    const fireFilms = SCOPE_FIRES_FILMS(scope)

    setState({
      ...EMPTY,
      loadingUniversal: fireUniversal,
      loadingAudio: fireAudio,
      loadingFilms: fireFilms,
      loading: fireUniversal || fireAudio || fireFilms,
    })

    const t = setTimeout(() => {
      if (!alive) return

      // ---- Source 1: backend universal (products + users + chats + pages) ----
      if (fireUniversal) {
        api
          .get<{
            products: UniversalProductHit[]
            users: UniversalUserHit[]
            chats: UniversalChatHit[]
            pages: UniversalPageHit[]
          }>('/api/search/universal', {
            query: { q },
            auth: isAuthenticated ? true : undefined,
          })
          .then((d) => {
            if (!alive || myFetchId !== fetchIdRef.current) return
            // If scope narrows to a single universal sub-category, filter
            // the response to just that category (e.g. scope='products'
            // returns only products, not users/chats/pages).
            if (scope === 'products') {
              setUniversal({ products: d.products || [], users: [], chats: [], pages: [] })
            } else if (scope === 'users') {
              setUniversal({ products: [], users: d.users || [], chats: [], pages: [] })
            } else if (scope === 'chats') {
              setUniversal({ products: [], users: [], chats: d.chats || [], pages: [] })
            } else if (scope === 'pages') {
              setUniversal({ products: [], users: [], chats: [], pages: d.pages || [] })
            } else {
              setUniversal({
                products: d.products || [],
                users: d.users || [],
                chats: d.chats || [],
                pages: d.pages || [],
              })
            }
          })
          .catch(() => {
            if (!alive || myFetchId !== fetchIdRef.current) return
            setUniversal({ products: [], users: [], chats: [], pages: [] })
          })
      }

      // ---- Source 2: audio hub (external, can be slow on cold cache) ----
      if (fireAudio) {
        const audioCtrl = new AbortController()
        const audioTimeout = setTimeout(() => audioCtrl.abort(), 8000)
        fetch(`/api/audio-hub/search?q=${encodeURIComponent(q)}&type=music&limit=6`, {
          signal: audioCtrl.signal,
        })
          .then((r) => (r.ok ? r.json() : { items: [] }))
          .then((d) => {
            if (!alive || myFetchId !== fetchIdRef.current) return
            setAudio((d.items || []) as AudioHubTrack[])
          })
          .catch(() => {
            if (!alive || myFetchId !== fetchIdRef.current) return
            setAudio([])
          })
          .finally(() => clearTimeout(audioTimeout))
      }

      // ---- Source 3: films (3 DLE sites in parallel) ----
      if (fireFilms) {
        const filmsCtrl = new AbortController()
        const filmsTimeout = setTimeout(() => filmsCtrl.abort(), 6000)
        fetch(`/api/films/search?q=${encodeURIComponent(q)}&source=all`, {
          signal: filmsCtrl.signal,
        })
          .then((r) => (r.ok ? r.json() : { results: [] }))
          .then((d) => {
            if (!alive || myFetchId !== fetchIdRef.current) return
            setFilms((d.results || []).slice(0, 6) as Film[])
          })
          .catch(() => {
            if (!alive || myFetchId !== fetchIdRef.current) return
            setFilms([])
          })
          .finally(() => clearTimeout(filmsTimeout))
      }
    }, 250)

    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isAuthenticated, scope])

  return state
}

// ---- Helper: total count across all categories ----
export function totalHits(r: UniversalSearchResults): number {
  return (
    r.products.length +
    r.users.length +
    r.chats.length +
    r.pages.length +
    r.audio.length +
    r.films.length
  )
}

// ---- Helper: which categories have results ----
export function categoriesWithResults(r: UniversalSearchResults): CategoryKey[] {
  const out: CategoryKey[] = []
  if (r.products.length) out.push('products')
  if (r.users.length) out.push('users')
  if (r.chats.length) out.push('chats')
  if (r.pages.length) out.push('pages')
  if (r.audio.length) out.push('audio')
  if (r.films.length) out.push('films')
  return out
}
