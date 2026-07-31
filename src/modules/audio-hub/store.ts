'use client'

// ============================================================================
// Audio Hub Store — persisted favorites + history + last search.
// ----------------------------------------------------------------------------
// Favorites, history, and last search are stored in localStorage via Zustand
// persist. The actual playback state (currentTrack, isPlaying, queue, etc.)
// lives in the global useAudioPlayer store (src/lib/audio-player-manager.ts) —
// that one is intentionally NOT persisted (it's ephemeral, resets on reload).
//
// This store persists:
//   • favorites: AudioHubTrack[] (so the user keeps them across sessions)
//   • history: AudioHubTrack[] (last 50 played tracks, most-recent-first)
//   • volume: number (0..1, persisted so the user doesn't reset it)
//   • lastSearch: { query, type, results } (so reopening Audio Hub shows the
//     previous search without re-typing — v16.9.3 enhancement)
// ============================================================================

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AudioHubTrack, AudioHubKind } from './types'

interface LastSearch {
  query: string
  type: AudioHubKind
  results: AudioHubTrack[]
  timestamp: number
}

interface AudioHubState {
  // ---- Persisted data ----
  favorites: AudioHubTrack[]
  history: AudioHubTrack[]
  volume: number
  lastSearch: LastSearch | null

  // ---- Actions ----
  toggleFavorite: (track: AudioHubTrack) => void
  isFavorite: (trackId: string) => boolean
  addToHistory: (track: AudioHubTrack) => void
  clearHistory: () => void
  setVolume: (v: number) => void
  setLastSearch: (search: LastSearch) => void
  clearLastSearch: () => void
}

const HISTORY_MAX = 50

export const useAudioHubStore = create<AudioHubState>()(
  persist(
    (set, get) => ({
      favorites: [],
      history: [],
      volume: 1,
      lastSearch: null,

      toggleFavorite: (track) => {
        set((s) => {
          const exists = s.favorites.some((t) => t.id === track.id)
          if (exists) {
            return { favorites: s.favorites.filter((t) => t.id !== track.id) }
          }
          return { favorites: [track, ...s.favorites] }
        })
      },

      isFavorite: (trackId) => get().favorites.some((t) => t.id === trackId),

      addToHistory: (track) => {
        set((s) => {
          // Remove existing entry (if any) to move it to the top.
          const filtered = s.history.filter((t) => t.id !== track.id)
          return { history: [track, ...filtered].slice(0, HISTORY_MAX) }
        })
      },

      clearHistory: () => set({ history: [] }),

      setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),

      setLastSearch: (search) => set({ lastSearch: search }),

      clearLastSearch: () => set({ lastSearch: null }),
    }),
    {
      name: '999pro-audio-hub',
      partialize: (s) => ({
        favorites: s.favorites,
        history: s.history,
        volume: s.volume,
        lastSearch: s.lastSearch,
      }) as Pick<AudioHubState, 'favorites' | 'history' | 'volume' | 'lastSearch'>,
    },
  ),
)
