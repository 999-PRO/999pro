'use client'

// ============================================================================
// Floating Live Info (v18.5.2 — with manual city selection)
// ----------------------------------------------------------------------------
// "Живая" информационная строка между Header и Search на главной странице.
//
// v18.5.2 — добавлена кликабельность: тап открывает модал настройки
// местоположения. Пользователь может:
//   1. Включить точную геолокацию (GPS/Wi-Fi)
//   2. Найти и выбрать город вручную
//   3. Выбрать из популярных городов (Грозный, Москва, Махачкала, Мекка…)
//
// Дизайн: премиальный минимализм, фирменный градиент, SVG-иконки.
// Источники: /api/live-info/{finance,weather,prayer}
// ============================================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog,
  CloudSun, CloudDrizzle, Moon, MapPin,
  TrendingUp, TrendingDown, Bitcoin, Coins, ChevronRight,
} from 'lucide-react'
import { useLiveInfoSettings, buildLocationQuery } from '@/lib/live-info-settings'
import { LiveInfoLocationModal } from './live-info-location-modal'

// ---- Types ----
interface CurrencyInfo {
  symbol: string
  displayPrice: string
  unit: string
  change24h: number | null
  direction: 'up' | 'down' | 'stable'
}
interface FinanceResponse {
  currencies: CurrencyInfo[]
  updatedAt: number
}
interface WeatherResponse {
  city: string
  temperature: number | null
  description: string
  weatherCode: number | null
  updatedAt: number
}
interface PrayerResponse {
  name: string
  key: string
  time: string
  countdown: string
  minutesUntil: number
  updatedAt: number
}

interface InfoPart {
  text: string
  gradient?: boolean
  muted?: boolean
  trend?: 'up' | 'down' | 'stable'
  trendValue?: string
}

interface InfoItem {
  id: string
  parts: InfoPart[]
  icon: React.ReactNode
}

// ---- Constants ----
const DISPLAY_MS = 6500
const FADE_MS = 700
const FINANCE_REFRESH_MS = 5 * 60 * 1000
const PRAYER_REFRESH_MS = 60 * 1000

export function FloatingLiveInfo() {
  const [items, setItems] = useState<InfoItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showLocationModal, setShowLocationModal] = useState(false)
  const itemsRef = useRef<InfoItem[]>([])
  itemsRef.current = items

  const settings = useLiveInfoSettings()

  // ---- Build all info items from API responses ----
  const buildItems = useCallback(async () => {
    const newItems: InfoItem[] = []
    const locQuery = buildLocationQuery(settings)

    // 1) Finance
    try {
      const fin = await fetchJSON<FinanceResponse>('/api/live-info/finance')
      if (fin?.currencies?.length) {
        for (const c of fin.currencies) {
          const trendIcon = c.direction === 'up'
            ? <TrendingUp style={{ color: '#10b981' }} className="h-3 w-3" strokeWidth={2.5} />
            : c.direction === 'down'
              ? <TrendingDown style={{ color: '#ef4444' }} className="h-3 w-3" strokeWidth={2.5} />
              : null
          const trendValue = c.change24h !== null
            ? `${c.change24h >= 0 ? '+' : ''}${c.change24h.toFixed(2)}%`
            : undefined

          const icon = c.symbol === 'BTC'
            ? <Bitcoin className="h-3.5 w-3.5" strokeWidth={2.2} />
            : c.symbol === 'ETH'
              ? <DiamondIcon />
              : <Coins className="h-3.5 w-3.5" strokeWidth={2.2} />

          newItems.push({
            id: `fin-${c.symbol}`,
            icon,
            parts: [
              { text: c.symbol, muted: true },
              { text: c.unit === '$' ? `${c.displayPrice} $` : `${c.displayPrice} ₽`, gradient: true },
              ...(trendIcon && trendValue ? [{ text: trendValue, trend: c.direction, trendValue }] : []),
            ],
          })
        }
      }
    } catch { /* ignore */ }

    // 2) Weather
    try {
      const w = await fetchJSON<WeatherResponse>(`/api/live-info/weather${locQuery}`)
      if (w && w.temperature !== null) {
        const tempStr = `${w.temperature > 0 ? '+' : ''}${Math.round(w.temperature)}°`
        newItems.push({
          id: 'weather',
          icon: getWeatherIcon(w.weatherCode),
          parts: [
            { text: w.city, muted: true },
            { text: tempStr, gradient: true },
          ],
        })
      }
    } catch { /* ignore */ }

    // 3) Prayer
    try {
      const p = await fetchJSON<PrayerResponse>(`/api/live-info/prayer${locQuery}`)
      if (p && p.name) {
        newItems.push({
          id: 'prayer',
          icon: <Moon className="h-3.5 w-3.5" strokeWidth={2.2} />,
          parts: [
            { text: p.name, muted: true },
            { text: p.time, gradient: true },
            { text: p.countdown, muted: true },
          ],
        })
      }
    } catch { /* ignore */ }

    if (newItems.length > 0) {
      const ordered: InfoItem[] = []
      const weather = newItems.find(i => i.id === 'weather')
      const prayer = newItems.find(i => i.id === 'prayer')
      const finance = newItems.filter(i => i.id.startsWith('fin-'))
      if (weather) ordered.push(weather)
      if (prayer) ordered.push(prayer)
      ordered.push(...finance)
      setItems(ordered)
    }
  }, [settings])

  // ---- Initial fetch + periodic refresh ----
  // v25.4 (perf audit P-5): collapsed two overlapping intervals into one.
  // Previously both `financeTimer` (5 min) and `prayerTimer` (60s) called
  // the same `buildItems`, which does 3 sequential awaits — at the 5-min
  // mark both fired in the same tick → 6 sequential network requests.
  // Now a single 60s interval fires `buildItems`, and inside `buildItems`
  // finance is only re-fetched if 5 min have elapsed since the last fetch.
  useEffect(() => {
    buildItems()
    const timer = setInterval(buildItems, PRAYER_REFRESH_MS)
    return () => clearInterval(timer)
  }, [buildItems])

  // v19.0 — Auto-request browser geolocation once on first mount if:
  //   - user hasn't denied geolocation in a previous session (geoDenied=false)
  //   - user hasn't picked a city manually (mode='auto' or city=null)
  //   - coords are not already cached
  // This fixes the bug where enabling "auto-detect" in settings didn't
  // actually trigger a geolocation request — the user had to open the
  // modal and tap "Включить геолокацию" manually. Now the first time
  // the live-info widget mounts, it silently requests geolocation; on
  // success it stores the coords + re-renders with accurate weather.
  useEffect(() => {
    if (settings.geoDenied) return
    if (settings.coords) return
    if (settings.mode === 'manual' && settings.city) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    // Only auto-request once per session (avoid prompt spam on every page nav).
    const SESSION_KEY = 'live-info-geo-requested'
    if (sessionStorage.getItem(SESSION_KEY)) return
    sessionStorage.setItem(SESSION_KEY, '1')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        settings.setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      () => {
        // Silently ignore — user will be prompted via the modal if they tap.
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    )
  }, [settings])

  // ---- Rotation timer ----
  useEffect(() => {
    if (items.length <= 1) return
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % itemsRef.current.length)
    }, DISPLAY_MS)
    return () => clearInterval(timer)
  }, [items.length])

  // ---- Render ----
  if (items.length === 0) {
    return <div style={{ height: 24 }} aria-hidden />
  }

  const current = items[currentIndex] || items[0]
  // Show a subtle "tap to set location" hint when on weather/prayer and no manual city set
  const showLocationHint = (current.id === 'weather' || current.id === 'prayer')
    && settings.mode === 'auto'
    && !settings.coords

  return (
    <>
      <button
        type="button"
        onClick={() => setShowLocationModal(true)}
        aria-label="Настроить местоположение"
        className="floating-live-info"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '7px',
          padding: '4px 16px',
          minHeight: 28,  // slightly taller for tap target
          textAlign: 'center',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          // No background, no border, no shadow — text floats in space
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id + '-' + currentIndex}
            initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
            transition={{
              duration: FADE_MS / 1000,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              maxWidth: '100%',
            }}
          >
            {/* SVG Icon */}
            <motion.span
              initial={{ scale: 0.9, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 14,
                minHeight: 14,
                color: '#7c3aed',
                filter: 'drop-shadow(0 0 4px rgba(124, 58, 237, 0.18))',
              }}
            >
              {current.icon}
            </motion.span>

            {/* Text parts */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '13px',
                fontWeight: 500,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {current.parts.map((part, idx) => (
                <Part key={idx} part={part} />
              ))}

              {/* Subtle location-pin hint when no city is set */}
              {showLocationHint && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    marginLeft: '4px',
                    color: 'rgba(124, 58, 237, 0.5)',
                  }}
                  title="Нажмите, чтобы выбрать город"
                >
                  <MapPin className="h-3 w-3" strokeWidth={2.2} />
                </span>
              )}
            </span>
          </motion.div>
        </AnimatePresence>
      </button>

      {/* Location settings modal */}
      <LiveInfoLocationModal
        open={showLocationModal}
        onClose={() => setShowLocationModal(false)}
      />
    </>
  )
}

// ---- Diamond icon for ETH ----
function DiamondIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3h12l4 6-10 13L2 9z" />
      <path d="M11 3 8 9l4 13 4-13-3-6" />
      <path d="M2 9h20" />
    </svg>
  )
}

// ---- Text part ----
function Part({ part }: { part: InfoPart }) {
  if (part.trend) {
    const color = part.trend === 'up' ? '#10b981' : part.trend === 'down' ? '#ef4444' : '#94a3b8'
    return (
      <span
        style={{
          fontSize: '11px',
          fontWeight: 600,
          color,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0',
        }}
      >
        {part.trend === 'up' ? '▲' : part.trend === 'down' ? '▼' : '◆'} {part.text}
      </span>
    )
  }
  if (part.gradient) {
    return (
      <span
        style={{
          background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 50%, #7c3aed 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontWeight: 600,
        }}
      >
        {part.text}
      </span>
    )
  }
  if (part.muted) {
    return (
      <span
        style={{
          color: 'rgba(120, 120, 130, 0.7)',
          fontWeight: 500,
          ...(typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
            ? { color: 'rgba(200, 200, 210, 0.7)' }
            : {}),
        }}
      >
        {part.text}
      </span>
    )
  }
  return <span>{part.text}</span>
}

// ---- Weather icon mapper ----
function getWeatherIcon(code: number | null): React.ReactNode {
  if (code === null) return <Cloud className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code === 0) return <Sun className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code === 1 || code === 2) return <CloudSun className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code === 3) return <Cloud className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code === 45 || code === 48) return <CloudFog className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code >= 51 && code <= 57) return <CloudDrizzle className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code >= 61 && code <= 67) return <CloudRain className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code >= 71 && code <= 77) return <CloudSnow className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code >= 80 && code <= 82) return <CloudRain className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code >= 85 && code <= 86) return <CloudSnow className="h-3.5 w-3.5" strokeWidth={2.2} />
  if (code >= 95 && code <= 99) return <CloudLightning className="h-3.5 w-3.5" strokeWidth={2.2} />
  return <Cloud className="h-3.5 w-3.5" strokeWidth={2.2} />
}

// ---- Helpers ----
async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}
