// Home page layout config — loaded from /api/settings/homeLayout.
// v25.12: restructured to match IMG_3191 design:
//   hero, categories, deals (with timer), ai-assistant, recently-viewed,
//   stories, banner, popular, new
// v25.17 (owner): «Сторисы должны быть под хедер-блок» — stories теперь
// идут СРАЗУ после hero (order 1), categories сдвинута на 2 и т.д.

import { useEffect, useState, useCallback } from 'react'
import { api } from './api'

export interface HomeBlockConfig {
  id: string
  visible: boolean
  pinned: boolean
  order: number
}

// v25.26: ключ кэша поднят до v2 — у давно установленных PWA мог остаться
// закэшированный layout от старых версий (со скрытой/несуществующей
// «Категории»), из-за чего владелец не видел свои карточки категорий на
// главной. Новый ключ игнорирует старый кэш целиком.
const LAYOUT_CACHE_KEY = '999pro-home-layout-cache-v2'

export function sortHomeLayout<T extends { pinned?: boolean; order: number }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || a.order - b.order,
  )
}

// v25.20 (owner): блок «ИИ-агент» на главной удалён — агент живёт на
// плавающей кнопке. Из дефолтов убран; home-view дополнительно фильтрует
// старый id из сохранённых layout'ов.
export const DEFAULT_HOME_LAYOUT: HomeBlockConfig[] = [
  { id: 'hero', visible: true, pinned: true, order: 0 },
  { id: 'stories', visible: true, pinned: false, order: 1 },
  { id: 'categories', visible: true, pinned: false, order: 2 },
  { id: 'deals', visible: true, pinned: false, order: 3 },
  { id: 'recently-viewed', visible: true, pinned: false, order: 4 },
  { id: 'banner', visible: true, pinned: false, order: 5 },
  { id: 'popular', visible: true, pinned: false, order: 6 },
  { id: 'new', visible: true, pinned: false, order: 7 },
]

// v25.13 (FOUC fix): localStorage cache key for the home layout.
// Without this cache, on every page load the hook starts with
// DEFAULT_HOME_LAYOUT (where EVERY block is `visible: true`) and then
// `fetchLayout()` overwrites it with the actual server-side config.
// If the admin has hidden some blocks via Studio, those blocks flash
// briefly before disappearing — a classic FOUC (Flash Of Unstyled Content).
//
// Fix: hydrate the initial state from localStorage so the FIRST paint
// matches the LAST known server-side config. Then fetch the fresh config
// in the background; if it changed, the hook re-renders with the new layout.
// v25.16: единая сортировка «закреплённые — первыми, затем по order».
// Используется и здесь, и в home-view.tsx, и в Студии (home-manager.tsx) —
// чтобы то, что видит владелец при перетаскивании блоков, совпадало с тем,
// что рендерится клиентам. Раньше порядок из Студии игнорировался фронтендом
// полностью (баг: «переставляю блоки местами — ничего не меняется»).

function loadCachedLayout(): HomeBlockConfig[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LAYOUT_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as HomeBlockConfig[]
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function saveCachedLayout(layout: HomeBlockConfig[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(layout))
  } catch {
    // ignore quota / serialization errors
  }
}

export function useHomeLayout() {
  // v25.13 (FOUC fix): start from the cached layout (or DEFAULT if no cache).
  // The first paint will use the cached config, so hidden blocks DON'T flash.
  const [layout, setLayout] = useState<HomeBlockConfig[]>(
    () => loadCachedLayout() || DEFAULT_HOME_LAYOUT,
  )
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
        const sorted = sortHomeLayout(merged)
        setLayout(sorted)
        // v25.13: persist to localStorage so the NEXT page load uses this
        // layout as the initial state — no FOUC.
        saveCachedLayout(sorted)
      } else {
        // v25.26 (owner: «куда пропали мои категории?»): сервер НЕ имеет
        // сохранённого layout — значит, правильное состояние = дефолт со ВСЕМИ
        // блоками видимыми. Раньше мы оставляли закэшированный layout, и если
        // он был испорчен (categories.visible=false из старой сессии Студии),
        // категории навсегда пропадали с главной. Теперь дефолт побеждает.
        setLayout(sortHomeLayout(DEFAULT_HOME_LAYOUT))
        saveCachedLayout(sortHomeLayout(DEFAULT_HOME_LAYOUT))
      }
    } catch {
      // use defaults (or cached)
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
    // v25.13 (FOUC fix): if we're still loading the fresh config AND we
    // have a cached layout, use the cached layout's visibility. This prevents
    // a flash of "everything visible" while the API is being fetched.
    // If we have NO cache (first-ever visit), we fall back to the DEFAULT
    // layout — which is "everything visible" — but that's the only honest
    // initial state when we don't know any better.
    const block = layout.find((b) => b.id === id)
    return block ? block.visible : true
  }, [layout])

  return { layout, loading, isVisible, fetchLayout }
}
