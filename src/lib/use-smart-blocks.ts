'use client'

// F-CRIT-002 fix: shared cache for /api/products/smart/blocks.
// Previously, desktop home mounted 3 <SmartSection> components + mobile
// <SmartBlocks> (hidden via md:hidden but still mounted) = 4 parallel
// identical fetches per home page load. At 1M users × 4 sessions/day =
// 12M extra DB-backed requests/day that achieved nothing.
//
// This module-level cache deduplicates: the first caller fires the fetch,
// all subsequent callers (within the 60s TTL) get the cached result.
// The cache is consumed via useSmartBlocks() hook which subscribes to
// state changes.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Product } from '@/lib/types'

interface SmartBlocksData {
  blocks: Array<{ id: string; items: Product[] }>
}

interface CacheState {
  data: SmartBlocksData | null
  loading: boolean
  error: Error | null
  promise: Promise<SmartBlocksData> | null
  fetchedAt: number
}

const CACHE_TTL = 60_000 // 60 seconds
const cache: CacheState = { data: null, loading: false, error: null, promise: null, fetchedAt: 0 }
const subscribers = new Set<() => void>()

function notify() {
  for (const sub of subscribers) sub()
}

function fetchBlocks(): Promise<SmartBlocksData> {
  // If we have fresh data, return it immediately.
  const now = Date.now()
  if (cache.data && now - cache.fetchedAt < CACHE_TTL) {
    return Promise.resolve(cache.data)
  }
  // If a fetch is already in-flight, attach to its promise.
  if (cache.promise) return cache.promise

  cache.loading = true
  cache.error = null
  notify()

  cache.promise = api
    .get<SmartBlocksData>('/api/products/smart/blocks', {
      query: { limit: 12, seed: Math.floor(Math.random() * 1000000) },
    })
    .then((data) => {
      cache.data = data
      cache.fetchedAt = Date.now()
      cache.loading = false
      cache.promise = null
      notify()
      return data
    })
    .catch((err) => {
      cache.error = err instanceof Error ? err : new Error(String(err))
      cache.loading = false
      cache.promise = null
      notify()
      throw err
    })

  return cache.promise
}

/** Subscribe to the shared smart-blocks cache. Returns { data, loading, error }. */
export function useSmartBlocks() {
  const [state, setState] = useState({
    data: cache.data,
    loading: cache.loading,
    error: cache.error,
  })

  useEffect(() => {
    // Subscribe to cache changes
    const sub = () => {
      setState({ data: cache.data, loading: cache.loading, error: cache.error })
    }
    subscribers.add(sub)

    // If no data and not loading, kick off the fetch
    if (!cache.data && !cache.loading && !cache.promise) {
      fetchBlocks().catch(() => {/* error already in cache */})
    } else {
      // Sync immediately
      sub()
    }

    return () => {
      subscribers.delete(sub)
    }
  }, [])

  return state
}

/** Get items for a specific block id from the shared cache. */
export function useSmartBlock(blockId: string, limit = 8) {
  const { data, loading, error } = useSmartBlocks()
  const block = data?.blocks.find((b) => b.id === blockId)
  const items = (block?.items || []).slice(0, limit)
  return { items, loading, error }
}
