// ============================================================================
// Live Info Settings store (v18.5.2)
// ----------------------------------------------------------------------------
// Хранит настройки геолокации пользователя:
//   • mode: 'auto' | 'manual'  — auto = IP/browser geolocation, manual = выбранный город
//   • city: string | null      — выбранный город (когда mode = 'manual')
//   • coords: {lat, lon} | null — кешированные браузерные координаты
// ============================================================================

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type GeoMode = 'auto' | 'manual'

export interface LiveInfoSettings {
  mode: GeoMode
  city: string | null
  coords: { lat: number; lon: number } | null
  geoDenied: boolean  // пользователь отказал в геолокации

  setMode: (mode: GeoMode) => void
  setCity: (city: string | null) => void
  setCoords: (coords: { lat: number; lon: number } | null) => void
  setGeoDenied: (denied: boolean) => void
}

const STORAGE_KEY = 'live-info-settings-v2'

export const useLiveInfoSettings = create<LiveInfoSettings>()(
  persist(
    (set) => ({
      mode: 'auto',
      city: null,
      coords: null,
      geoDenied: false,

      setMode: (mode) => set({ mode }),
      setCity: (city) => set({ city, mode: city ? 'manual' : 'auto', coords: city ? null : undefined }),
      // v19.0: when coords are set (geolocation enabled), clear the city
      // and force mode='auto' so buildLocationQuery uses the coords.
      // Previous bug: setCoords left `mode='manual'` from a prior city
      // selection → buildLocationQuery fell through to the city branch
      // and ignored the live coords → wrong weather + currency shown.
      setCoords: (coords) => set({
        coords,
        mode: 'auto',
        city: coords ? null : undefined,
      }),
      setGeoDenied: (denied) => set({ geoDenied: denied }),
    }),
    {
      name: STORAGE_KEY,
      version: 2,
    },
  ),
)

// Build query string for weather/prayer endpoints based on settings
export function buildLocationQuery(settings: LiveInfoSettings): string {
  // v19.0: coords take priority over city (they're more accurate).
  if (settings.coords) {
    return `?lat=${settings.coords.lat.toFixed(4)}&lon=${settings.coords.lon.toFixed(4)}`
  }
  if (settings.mode === 'manual' && settings.city) {
    return `?city=${encodeURIComponent(settings.city)}`
  }
  return ''  // backend will use IP geolocation
}
