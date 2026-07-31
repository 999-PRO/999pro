'use client'

// ============================================================================
// Live Info Location Modal (v18.5.2)
// ----------------------------------------------------------------------------
// Модал для настройки местоположения пользователя:
//   1. Использовать геолокацию (запросить разрешение браузера)
//   2. Выбрать город вручную (поиск через Open-Meteo geocoding)
//   3. Популярные города (быстрый выбор)
// ============================================================================

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, MapPin, Search, Navigation, Check, Loader2 } from 'lucide-react'
import { useLiveInfoSettings } from '@/lib/live-info-settings'
import { useScrollLock } from '@/lib/use-scroll-lock'

interface LiveInfoLocationModalProps {
  open: boolean
  onClose: () => void
}

interface CitySearchResult {
  name: string
  country: string
  admin1?: string
  latitude: number
  longitude: number
}

const POPULAR_CITIES = [
  { name: 'Грозный', country: 'Россия' },
  { name: 'Москва', country: 'Россия' },
  { name: 'Санкт-Петербург', country: 'Россия' },
  { name: 'Махачкала', country: 'Россия' },
  { name: 'Казань', country: 'Россия' },
  { name: 'Сочи', country: 'Россия' },
  { name: 'Новосибирск', country: 'Россия' },
  { name: 'Екатеринбург', country: 'Россия' },
  { name: 'Мекка', country: 'Саудовская Аравия' },
  { name: 'Медина', country: 'Саудовская Аравия' },
  { name: 'Стамбул', country: 'Турция' },
  { name: 'Дубай', country: 'ОАЭ' },
]

export function LiveInfoLocationModal({ open, onClose }: LiveInfoLocationModalProps) {
  const settings = useLiveInfoSettings()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CitySearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [requestingGeo, setRequestingGeo] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)

  useScrollLock(open)

  // ---- City search via Open-Meteo geocoding API (called from frontend) ----
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchQuery.trim())}&count=8&language=ru&format=json`,
        )
        if (!res.ok) { setSearchResults([]); return }
        const data = await res.json()
        if (data.results) {
          setSearchResults(data.results.map((r: any) => ({
            name: r.name,
            country: r.country || '',
            admin1: r.admin1,
            latitude: r.latitude,
            longitude: r.longitude,
          })))
        } else {
          setSearchResults([])
        }
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // ---- Request browser geolocation ----
  const requestGeolocation = useCallback(async () => {
    setRequestingGeo(true)
    setGeoError(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Геолокация не поддерживается этим браузером')
      setRequestingGeo(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        settings.setCoords(coords)
        settings.setMode('auto')
        settings.setGeoDenied(false)
        setRequestingGeo(false)
        onClose()
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError('Доступ к геолокации запрещён. Выберите город вручную ниже.')
          settings.setGeoDenied(true)
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoError('Местоположение недоступно. Выберите город вручную.')
        } else if (err.code === err.TIMEOUT) {
          setGeoError('Превышено время ожидания. Попробуйте ещё раз.')
        } else {
          setGeoError('Не удалось получить местоположение')
        }
        setRequestingGeo(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    )
  }, [settings, onClose])

  // ---- Select city manually ----
  const selectCity = useCallback((city: string) => {
    settings.setCity(city)
    setSearchQuery('')
    setSearchResults([])
    onClose()
  }, [settings, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black/40"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36, mass: 0.9 }}
            className="fixed left-0 right-0 bottom-0 z-[201] mx-auto max-w-md"
            style={{ maxHeight: '85vh' }}
          >
            <div
              className="rounded-t-[28px] overflow-hidden flex flex-col h-full"
              style={{
                background: 'linear-gradient(180deg, rgba(15,15,30,0.96) 0%, rgba(10,10,20,0.98) 100%)',
                backdropFilter: 'blur(28px) saturate(160%)',
                WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderBottom: 'none',
                boxShadow: '0 -10px 40px -10px rgba(0,0,0,0.5)',
              }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="h-1 w-10 rounded-full bg-white/20" />
              </div>

              {/* Header */}
              <div className="flex items-center gap-2 px-5 py-2">
                <div
                  className="grid place-items-center h-8 w-8 rounded-xl shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 50%, #7c3aed 100%)',
                    boxShadow: '0 4px 14px -2px rgba(124,58,237,0.5)',
                  }}
                >
                  <MapPin className="h-4 w-4 text-white" />
                </div>
                <div className="text-base font-semibold text-white flex-1">Местоположение</div>
                <button
                  onClick={onClose}
                  className="grid place-items-center h-8 w-8 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Закрыть"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-5"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {/* Current status */}
                <div
                  className="rounded-2xl p-3.5"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="text-[11px] text-white/50 uppercase tracking-wider font-semibold mb-1">Сейчас</div>
                  <div className="text-sm text-white font-medium">
                    {settings.mode === 'manual' && settings.city
                      ? `📍 ${settings.city}`
                      : settings.coords
                        ? `📍 Геолокация браузера (точные координаты)`
                        : '🌐 Авто-определение по IP'}
                  </div>
                </div>

                {/* Geolocation button */}
                <div>
                  <div className="text-[11px] text-white/50 uppercase tracking-wider font-semibold mb-2">
                    Определить автоматически
                  </div>
                  <button
                    onClick={requestGeolocation}
                    disabled={requestingGeo}
                    className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all active:scale-[0.98]"
                    style={{
                      background: 'linear-gradient(135deg, rgba(56,189,248,0.15) 0%, rgba(124,58,237,0.15) 100%)',
                      border: '1px solid rgba(124,58,237,0.3)',
                    }}
                  >
                    {requestingGeo
                      ? <Loader2 className="h-5 w-5 text-white animate-spin" />
                      : <Navigation className="h-5 w-5 text-white" />}
                    <div className="flex-1 text-left">
                      <div className="text-sm font-semibold text-white">
                        {requestingGeo ? 'Запрос геолокации…' : 'Включить геолокацию'}
                      </div>
                      <div className="text-[11px] text-white/60">
                        Самый точный способ — использует GPS/Wi-Fi
                      </div>
                    </div>
                  </button>
                  {geoError && (
                    <div className="mt-2 p-2.5 rounded-xl text-[11px] text-red-300"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      {geoError}
                    </div>
                  )}
                  {settings.coords && settings.mode === 'auto' && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-300">
                      <Check className="h-3 w-3" /> Геолокация активна
                    </div>
                  )}
                </div>

                {/* Search city */}
                <div>
                  <div className="text-[11px] text-white/50 uppercase tracking-wider font-semibold mb-2">
                    Найти город
                  </div>
                  <div
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    <Search className="h-4 w-4 text-white/50 shrink-0" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Например: Грозный, Москва, Мекка…"
                      className="flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none min-w-0"
                      autoFocus
                    />
                    {searching && <Loader2 className="h-3.5 w-3.5 text-white/50 animate-spin shrink-0" />}
                  </div>

                  {/* Search results */}
                  {searchResults.length > 0 && (
                    <div className="mt-2 space-y-1 max-h-60 overflow-y-auto custom-scroll">
                      {searchResults.map((r, i) => (
                        <button
                          key={`${r.name}-${r.country}-${i}`}
                          onClick={() => selectCity(r.name)}
                          className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/10 transition-colors text-left"
                        >
                          <MapPin className="h-4 w-4 text-white/50 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-white font-medium truncate">{r.name}</div>
                            <div className="text-[11px] text-white/50 truncate">
                              {r.admin1 ? `${r.admin1}, ` : ''}{r.country}
                            </div>
                          </div>
                          {settings.city === r.name && settings.mode === 'manual' && (
                            <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Popular cities */}
                {!searchQuery && (
                  <div>
                    <div className="text-[11px] text-white/50 uppercase tracking-wider font-semibold mb-2">
                      Популярные города
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {POPULAR_CITIES.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => selectCity(c.name)}
                          className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
                          style={{
                            background: settings.city === c.name && settings.mode === 'manual'
                              ? 'linear-gradient(135deg, #38bdf8 0%, #2563eb 50%, #7c3aed 100%)'
                              : 'rgba(255,255,255,0.06)',
                            color: settings.city === c.name && settings.mode === 'manual' ? 'white' : 'rgba(255,255,255,0.8)',
                            border: settings.city === c.name && settings.mode === 'manual'
                              ? '1px solid rgba(124,58,237,0.4)'
                              : '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reset to auto */}
                {(settings.mode === 'manual' || settings.coords) && (
                  <button
                    onClick={() => {
                      settings.setCity(null)
                      settings.setCoords(null)
                      settings.setMode('auto')
                      setGeoError(null)
                    }}
                    className="w-full p-2.5 rounded-xl text-xs text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Сбросить → использовать авто-определение по IP
                  </button>
                )}
              </div>

              <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
