'use client'

import { useEffect, useState, useRef } from 'react'
import { api } from '@/lib/api'
import type { Product, User } from '@/lib/types'

export interface SearchResults {
  products: Product[]
  users: User[]
}

/**
 * Search hook that queries both products and users.
 * Used by the global search across all sections.
 *
 * Behavior:
 * - Empty/short query (< 2 chars): show recently active users (discovery mode),
 *   no products. Lets the user find people to chat with without typing.
 * - Query >= 2 chars: search products + users by name/username/email/phone.
 *
 * F-CRIT-005 fix: added race-condition guard. Previously, two failure modes:
 *   (1) Unmount mid-fetch: setResults fires on unmounted component.
 *   (2) Out-of-order resolution: user types "apple" then "apple j" — if the
 *       second fetch resolves BEFORE the first, the first overwrites with
 *       stale "apple" results.
 * Now: `alive` flag prevents post-unmount updates, and `fetchIdRef` ensures
 * only the latest fetch's results are applied.
 */
export function useSearch(query: string, isAuthenticated: boolean): SearchResults & { loading: boolean } {
  const [results, setResults] = useState<SearchResults>({ products: [], users: [] })
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  useEffect(() => {
    const q = query.trim()
    let alive = true
    const myFetchId = ++fetchIdRef.current

    setLoading(true)
    const t = setTimeout(() => {
      if (!alive) return // component unmounted before timeout fired

      const queries: Promise<void>[] = []

      if (q.length >= 2) {
        // Products search — public
        queries.push(
          api
            .get<{ items: Product[] }>('/api/products', { query: { q, limit: 20 } })
            .then((d) => {
              // F-CRIT-005: only apply if this is still the latest fetch
              if (alive && myFetchId === fetchIdRef.current) {
                setResults((r) => ({ ...r, products: d.items }))
              }
            })
            .catch(() => {
              if (alive && myFetchId === fetchIdRef.current) {
                setResults((r) => ({ ...r, products: [] }))
              }
            }),
        )
      } else {
        setResults((r) => ({ ...r, products: [] }))
      }

      // Users search — requires auth. Backend returns recently active users
      // when query is empty/short, so the user can discover people to chat with.
      if (isAuthenticated) {
        queries.push(
          api
            .get<{ users: User[] }>('/api/users/search', {
              query: q.length >= 2 ? { q } : {},
              auth: true,
            })
            .then((d) => {
              if (alive && myFetchId === fetchIdRef.current) {
                setResults((r) => ({ ...r, users: d.users }))
              }
            })
            .catch(() => {
              if (alive && myFetchId === fetchIdRef.current) {
                setResults((r) => ({ ...r, users: [] }))
              }
            }),
        )
      } else {
        setResults((r) => ({ ...r, users: [] }))
      }
      Promise.all(queries).finally(() => {
        if (alive && myFetchId === fetchIdRef.current) {
          setLoading(false)
        }
      })
    }, 250)

    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, isAuthenticated])

  return { ...results, loading }
}
