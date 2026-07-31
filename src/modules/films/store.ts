// ============================================================================
// Video Hub — Zustand store with localStorage persistence (v17.1)
// ----------------------------------------------------------------------------
// Persists: favorites, history (50), continueWatching (30), lastSearch
// ============================================================================

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Film, FilmSearchState, FilmProgress } from './types'

const HISTORY_MAX = 50
const CONTINUE_MAX = 30
const FAVORITES_MAX = 200

export interface FilmsStore {
  favorites: Film[]
  history: Film[]
  continueWatching: FilmProgress[]
  lastSearch: FilmSearchState

  toggleFavorite: (film: Film) => void
  isFavorite: (id: string) => boolean
  addToHistory: (film: Film) => void
  clearHistory: () => void
  setLastSearch: (s: FilmSearchState) => void

  upsertProgress: (p: FilmProgress) => void
  getProgress: (filmId: string, episodeId?: string) => FilmProgress | null
  clearProgress: (filmId: string, episodeId?: string) => void
  clearAllProgress: () => void
}

function dedupeFilms(arr: Film[]): Film[] {
  const seen = new Set<string>()
  const out: Film[] = []
  for (const f of arr) {
    if (!seen.has(f.id)) { seen.add(f.id); out.push(f) }
  }
  return out
}

export const useFilmsStore = create<FilmsStore>()(
  persist(
    (set, get) => ({
      favorites: [],
      history: [],
      continueWatching: [],
      lastSearch: null,

      toggleFavorite: (film) => {
        set((s) => {
          const exists = s.favorites.some((f) => f.id === film.id)
          const next = exists
            ? s.favorites.filter((f) => f.id !== film.id)
            : [film, ...s.favorites].slice(0, FAVORITES_MAX)
          return { favorites: next }
        })
      },
      isFavorite: (id) => get().favorites.some((f) => f.id === id),
      addToHistory: (film) => {
        set((s) => {
          const filtered = s.history.filter((f) => f.id !== film.id)
          return { history: dedupeFilms([film, ...filtered]).slice(0, HISTORY_MAX) }
        })
      },
      clearHistory: () => set({ history: [] }),
      setLastSearch: (s) => set({ lastSearch: s }),
      upsertProgress: (p) => {
        set((s) => {
          const filtered = s.continueWatching.filter(
            (x) => !(x.filmId === p.filmId && x.episodeId === p.episodeId)
          )
          return { continueWatching: [p, ...filtered].slice(0, CONTINUE_MAX) }
        })
      },
      getProgress: (filmId, episodeId) => {
        const list = get().continueWatching
        return list.find((x) => x.filmId === filmId && x.episodeId === episodeId) || null
      },
      clearProgress: (filmId, episodeId) => {
        set((s) => ({
          continueWatching: s.continueWatching.filter(
            (x) => !(x.filmId === filmId && x.episodeId === episodeId)
          ),
        }))
      },
      clearAllProgress: () => set({ continueWatching: [] }),
    }),
    {
      name: '999pro-films-store',
      version: 3,
      partialize: (s) => ({
        favorites: s.favorites,
        history: s.history,
        continueWatching: s.continueWatching,
        lastSearch: s.lastSearch,
      }),
      // v3 migration: structure changed (added sourceId/sourceName, removed
      // downloads/genres/duration since they came from archive.org).
      migrate: () => ({
        favorites: [],
        history: [],
        continueWatching: [],
        lastSearch: null,
      }),
    }
  )
)
