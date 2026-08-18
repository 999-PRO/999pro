// Home page layout config — loaded from /api/settings/homeLayout.
// v16.5: Admin configures block order/visibility/pinned via Studio → "Главная".
// Frontend fetches the config and renders blocks accordingly.

import { useEffect, useState, useCallback } from 'react'
import { api } from './api'

export interface HomeBlockConfig {
  id: string
  visible: boolean
  pinned: boolean
  order: number
}

// Default order — used when no config saved yet (first run)
export const DEFAULT_HOME_LAYOUT: HomeBlockConfig[] = [
  { id: 'hero', visible: true, pinned: true, order: 0 },
  { id: 'stories', visible: true, pinned: false, order: 1 },
  { id: 'search', visible: true, pinned: false, order: 2 },
  { id: 'banner', visible: true, pinned: false, order: 3 },
  { id: 'trending', visible: true, pinned: false, order: 4 },
  { id: 'popular', visible: true, pinned: false, order: 5 },
  { id: 'recommended', visible: true, pinned: false, order: 6 },
  { id: 'new', visible: true, pinned: false, order: 7 },
  { id: 'buying-now', visible: true, pinned: false, order: 8 },
  { id: 'best-rating', visible: true, pinned: false, order: 9 },
  { id: 'fast-selling', visible: true, pinned: false, order: 10 },
]

export function useHomeLayout() {
  const [layout, setLayout] = useState<HomeBlockConfig[]>(DEFAULT_HOME_LAYOUT)
  const [loading, setLoading] = useState(true)

  const fetchLayout = useCallback(async () => {
    try {
      const res = await api.get<{ value: HomeBlockConfig[] | null }>('/api/settings/homeLayout')
      if (res.value && Array.isArray(res.value) && res.value.length > 0) {
        // v16.6: merge saved config with defaults — only take visible/order
        // from saved, so new default blocks appear if added in future versions.
        const merged = DEFAULT_HOME_LAYOUT.map((d) => {
          const saved = res.value!.find((b) => b.id === d.id)
          return saved
            ? { ...d, visible: saved.visible, pinned: saved.pinned, order: saved.order ?? d.order }
            : d
        })
        setLayout(merged.sort((a, b) => a.order - b.order))
      }
    } catch {
      // use defaults
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLayout()
  }, [fetchLayout])

  // v16.5: instant refresh when Studio saves homeLayout
  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined
      if (detail?.key === 'homeLayout') fetchLayout()
    }
    window.addEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
    return () => window.removeEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
  }, [fetchLayout])

  // Helper: is a block visible?
  const isVisible = useCallback((id: string) => {
    const block = layout.find((b) => b.id === id)
    return block ? block.visible : true
  }, [layout])

  return { layout, loading, isVisible, fetchLayout }
}
