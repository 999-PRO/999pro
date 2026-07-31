'use client'

// ============================================================================
// useFavorites — хук для системы избранного в чате.
// ----------------------------------------------------------------------------
// Хранит favorite message IDs в localStorage (per-user не нужно — чат один).
// Возвращает:
//   • favoriteIds: Set<string> — для O(1) проверки
//   • toggleFavorite(messageId): toggle
//   • isFavorite(messageId): boolean
//   • count: number
//
// Синхронизируется между вкладками через storage event.
// ============================================================================

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = '999pro:chat-favorites'

function loadFavorites(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(arr)
  } catch {
    return new Set()
  }
}

function saveFavorites(ids: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {}
}

export function useFavorites() {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())

  // Load on mount
  useEffect(() => {
    setFavoriteIds(loadFavorites())
  }, [])

  // Sync between tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setFavoriteIds(loadFavorites())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggleFavorite = useCallback((messageId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      saveFavorites(next)
      return next
    })
  }, [])

  const isFavorite = useCallback((messageId: string) => favoriteIds.has(messageId), [favoriteIds])

  return {
    favoriteIds,
    toggleFavorite,
    isFavorite,
    count: favoriteIds.size,
  }
}
