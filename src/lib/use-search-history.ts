'use client'

import { useCallback, useEffect, useState } from 'react'

// ============================================================================
//  useSearchHistory — client-side search history stored in localStorage.
//
//  Used by both the SearchPage and the SearchOverlay to show recent queries
//  in the empty state (no query typed). The history is shared across both
//  entry points — a query the user typed in the overlay will appear in the
//  SearchPage's history (and vice versa).
//
//  Storage format: JSON array of strings, max 8 entries, most-recent-first.
//  Key: `999pro-search-history`.
//
//  Deduplication: re-searching the same query moves it to the front (does
//  not add a duplicate).
// ============================================================================

const STORAGE_KEY = '999pro-search-history'
const MAX_ENTRIES = 6
const MIN_QUERY_LENGTH = 2

function readHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((q) => typeof q === 'string' && q.length >= MIN_QUERY_LENGTH).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function writeHistory(entries: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    /* localStorage may be unavailable (private mode, quota) — silent fail */
  }
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>([])

  // Load on mount + when tab becomes visible (so changes from another tab
  // are reflected — rare but possible).
  useEffect(() => {
    setHistory(readHistory())
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setHistory(readHistory())
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  /** Add a query to history (deduped, most-recent-first). */
  const addQuery = useCallback((query: string) => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) return
    setHistory((prev) => {
      // Dedupe: remove existing occurrence, then prepend.
      const filtered = prev.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())
      const next = [trimmed, ...filtered].slice(0, MAX_ENTRIES)
      writeHistory(next)
      return next
    })
  }, [])

  /** Remove a specific query from history. */
  const removeQuery = useCallback((query: string) => {
    setHistory((prev) => {
      const next = prev.filter((q) => q !== query)
      writeHistory(next)
      return next
    })
  }, [])

  /** Clear all history. */
  const clearHistory = useCallback(() => {
    setHistory([])
    writeHistory([])
  }, [])

  return { history, addQuery, removeQuery, clearHistory }
}
