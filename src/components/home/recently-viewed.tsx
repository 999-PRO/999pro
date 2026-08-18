'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { ProductCard } from '../product-card'
import { useAuthStore } from '@/lib/auth-store'
import { History } from 'lucide-react'

// v25.11: RecentlyViewed — horizontal carousel of recently viewed products.
//
// Two-tier strategy:
//  1. For authenticated users: fetches /api/products/recently-viewed (server-side
//     ProductView records, last 30 days, deduped).
//  2. For anonymous users: uses localStorage '999pro-recently-viewed' (max 20
//     product IDs), then batch-fetches their full data via /api/products/batch.
//
// Hidden when empty (no recent views yet).
//
// Mounted on the home page below the hero + categories strip.

const LOCALSTORAGE_KEY = '999pro-recently-viewed'
const MAX_LOCAL = 20
const MAX_DISPLAY = 12

interface RecentlyViewedProps {
  onOpenProduct: (id: string) => void
  /** Optional: exclude a product (e.g. when on the product page) */
  excludeId?: string
}

export function RecentlyViewed({ onOpenProduct, excludeId }: RecentlyViewedProps) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const authed = useAuthStore((s) => s.isAuthenticated)

  const loadFromServer = useCallback(async () => {
    try {
      const d = await api.get<{ items: any[] }>(
        '/api/products/recently-viewed',
        { query: { limit: MAX_DISPLAY, exclude: excludeId }, auth: true },
      )
      return d.items || []
    } catch {
      return []
    }
  }, [excludeId])

  const loadFromLocalStorage = useCallback(async () => {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem(LOCALSTORAGE_KEY)
      if (!raw) return []
      let ids: string[] = JSON.parse(raw)
      if (!Array.isArray(ids)) return []
      if (excludeId) ids = ids.filter((id) => id !== excludeId)
      ids = ids.slice(0, MAX_DISPLAY)
      if (ids.length === 0) return []
      const d = await api.get<{ items: any[] }>('/api/products/batch', {
        query: { ids: ids.join(',') },
      })
      // Preserve order from localStorage
      const byId = new Map((d.items || []).map((p) => [p.id, p]))
      return ids.map((id) => byId.get(id)).filter(Boolean)
    } catch {
      return []
    }
  }, [excludeId])

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = authed ? await loadFromServer() : await loadFromLocalStorage()
    setItems(result)
    setLoading(false)
  }, [authed, loadFromServer, loadFromLocalStorage])

  useEffect(() => { refresh() }, [refresh])

  // Refresh when user logs in/out
  useEffect(() => {
    const onAuthChanged = () => refresh()
    window.addEventListener('999pro:auth-changed', onAuthChanged as EventListener)
    return () => window.removeEventListener('999pro:auth-changed', onAuthChanged as EventListener)
  }, [refresh])

  // Refresh when returning to the page (user might have viewed a product on another tab)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  if (loading || items.length === 0) return null

  return (
    <section className="px-4 md:px-6 py-1 md:py-2">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-base md:text-lg font-bold tracking-tight">Вы недавно смотрели</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 pb-2">
        {items.map((p) => (
          <div key={p.id} className="w-[160px] md:w-[200px] shrink-0">
            <ProductCard product={p} onOpen={onOpenProduct} />
          </div>
        ))}
      </div>
    </section>
  )
}

// Helper: call this from the product page to record a view in localStorage.
export function recordLocalView(productId: string) {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY)
    let ids: string[] = raw ? JSON.parse(raw) : []
    if (!Array.isArray(ids)) ids = []
    // Move to front if already present
    ids = ids.filter((id) => id !== productId)
    ids.unshift(productId)
    ids = ids.slice(0, MAX_LOCAL)
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(ids))
    // Notify other tabs / components
    window.dispatchEvent(new CustomEvent('999pro:recently-viewed-changed'))
  } catch {
    // ignore parse errors
  }
}
