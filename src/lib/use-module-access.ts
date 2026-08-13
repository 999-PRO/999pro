'use client'

/**
 * v19.0 — Hook for fetching and using module access settings.
 *
 * Returns the modulesEnabled map from /api/settings/modulesEnabled.
 * Falls back to all-true if the API call fails or returns null.
 */

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

export type ModulesMap = Record<string, boolean>

const DEFAULT_MODULES: ModulesMap = {
  chat: true,
  'ai-assistant': true,
  'audio-hub': true,
  'video-hub': true,
  'media-hub': true,
  catalog: true,
  // v25.10 (Task #3): fullscreen product feed (Reels-style).
  // Always enabled by default — uses existing /api/products data.
  // Studio admin can disable via module-access settings if needed.
  feed: true,
  orders: true,
  profile: true,
  favorites: true,
  news: true,
  notifications: true,
  club: true,
  stories: true,
  studio: true,
  reviews: true,
  support: true,
  settings: true,
}

let cached: ModulesMap | null = null
const listeners = new Set<(v: ModulesMap) => void>()

async function fetchModules(): Promise<ModulesMap> {
  if (cached) return cached
  try {
    const data = await api.get<{ value: ModulesMap | null }>('/api/settings/modulesEnabled')
    if (data.value && typeof data.value === 'object') {
      cached = { ...DEFAULT_MODULES, ...data.value }
    } else {
      cached = DEFAULT_MODULES
    }
  } catch {
    cached = DEFAULT_MODULES
  }
  return cached
}

export function useModuleAccess(): ModulesMap {
  const [modules, setModules] = useState<ModulesMap>(cached || DEFAULT_MODULES)
  useEffect(() => {
    let mounted = true
    fetchModules().then((m) => {
      if (!mounted) return
      setModules(m)
      listeners.add(setModules)
    })
    return () => {
      mounted = false
      listeners.delete(setModules)
    }
  }, [])
  return modules
}

export function isModuleEnabled(modules: ModulesMap, key: string): boolean {
  return modules[key] ?? true
}
