'use client'

// ============================================================================
// useAudioHubSearch — debounced real-time search hook with persistence.
// ----------------------------------------------------------------------------
// Returns { query, setQuery, results, loading, touched, source, setSource }.
// Triggers a search 280ms after the user stops typing.
//
// v16.16: Added source filter — user can pick a specific source (hitmos,
//         muzjam, audius, archive, jamendo) or 'all' (default).
// v16.9.3: On mount, restores the last search from the persisted store so
// reopening Audio Hub shows the previous query + results without re-typing.
// After each successful search, saves the query + results to the store.
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { searchAudioTracks } from './api'
import { useAudioHubStore } from './store'
import type { AudioHubTrack, AudioHubKind } from './types'

const DEBOUNCE_MS = 280

// v16.18: Sources — hitmos + muzce only (muzjam/audius/archive/jamendo removed).
export type AudioHubSource = 'all' | 'hitmos' | 'muzce'

export function useAudioHubSearch(type: AudioHubKind = 'music') {
  // Restore last search from the persisted store on init.
  const lastSearch = useAudioHubStore((s) => s.lastSearch)
  const setLastSearch = useAudioHubStore((s) => s.setLastSearch)

  const [query, setQuery] = useState(() => {
    if (lastSearch && lastSearch.type === type) return lastSearch.query
    return ''
  })
  const [results, setResults] = useState<AudioHubTrack[]>(() => {
    if (lastSearch && lastSearch.type === type) return lastSearch.results
    return []
  })
  const [loading, setLoading] = useState(false)
  const [touched, setTouched] = useState(() => {
    if (lastSearch && lastSearch.type === type && lastSearch.results.length > 0) return true
    return false
  })
  // v16.16: Source filter state. Persisted in memory (not in store — changing
  // source should trigger a fresh search, not restore the old one).
  const [source, setSource] = useState<AudioHubSource>('all')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasRestoredRef = useRef(false)

  // Mark as restored on first mount to avoid re-triggering search for restored query.
  useEffect(() => {
    hasRestoredRef.current = true
  }, [])

  const search = useCallback(
    async (q: string, src: AudioHubSource = source) => {
      const trimmed = q.trim()
      // v16.9.4: For Quran type, allow empty query — the backend returns
      // all surahs. For other types, require at least 1 character.
      // v16.10: Same for radio — empty query returns top RU stations.
      if (trimmed.length < 1 && type !== 'quran' && type !== 'radio') {
        setResults([])
        setTouched(false)
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const data = await searchAudioTracks(trimmed, type, 20, src)
        const items = data.items || []
        setResults(items)
        // Persist the last search so it's restored on reopen.
        setLastSearch({
          query: trimmed,
          type,
          results: items,
          timestamp: Date.now(),
        })
      } catch {
        setResults([])
      } finally {
        setLoading(false)
        setTouched(true)
      }
    },
    [type, setLastSearch, source],
  )

  // v16.16: Re-search when source changes (if there's a query).
  const handleSetSource = useCallback((newSource: AudioHubSource) => {
    setSource(newSource)
    // If there's a query, trigger a fresh search with the new source.
    if (query.trim()) {
      setTouched(false)
      search(query, newSource)
    }
  }, [query, search])

  useEffect(() => {
    // Skip the initial debounce if we've restored a previous search
    // (the results are already loaded — no need to re-fetch).
    if (!hasRestoredRef.current && query && results.length > 0) {
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, search, results.length])

  return { query, setQuery, results, loading, touched, source, setSource: handleSetSource }
}
