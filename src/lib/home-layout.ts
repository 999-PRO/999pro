// Home page layout config — loaded from /api/settings/homeLayout.
// v25.12: restructured to match IMG_3191 design:
//   hero, categories, deals (with timer), ai-assistant, recently-viewed,
//   stories, banner, popular, new

import { useEffect, useState, useCallback } from 'react'
import { api } from './api'

export interface HomeBlockConfig {
  id: string
  visible: boolean
  pinned: boolean
  order: number
}

export const DEFAULT_HOME_LAYOUT: HomeBlockConfig[] = [
  { id: 'hero', visible: true, pinned: true, order: 0 },
  { id: 'categories', visible: true, pinned: false, order: 1 },
  { id: 'deals', visible: true, pinned: false, order: 2 },
  { id: 'ai-assistant', visible: true, pinned: false, order: 3 },
  { id: 'recently-viewed', visible: true, pinned: false, order: 4 },
  { id: 'stories', visible: true, pinned: false, order: 5 },
  { id: 'banner', visible: true, pinned: false, order: 6 },
  { id: 'popular', visible: true, pinned: false, order: 7 },
  { id: 'new', visible: true, pinned: false, order: 8 },
]

export function useHomeLayout() {
  const [layout, setLayout] = useState<HomeBlockConfig[]>(DEFAULT_HOME_LAYOUT)
  const [loading, setLoading] = useState(true)

  const fetchLayout = useCallback(async () => {
    try {
      const res = await api.get<{ value: HomeBlockConfig[] | null }>('/api/settings/homeLayout')
      if (res.value && Array.isArray(res.value) && res.value.length > 0) {
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

  useEffect(() => { fetchLayout() }, [fetchLayout])

  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined
      if (detail?.key === 'homeLayout') fetchLayout()
    }
    window.addEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
    return () => window.removeEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
  }, [fetchLayout])

  const isVisible = useCallback((id: string) => {
    const block = layout.find((b) => b.id === id)
    return block ? block.visible : true
  }, [layout])

  return { layout, loading, isVisible, fetchLayout }
}
