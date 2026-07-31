'use client'

// ============================================================================
// MapPicker — premium map picker with Yandex Maps (русский навигатор).
//
// v16.8 final: полная интеграция Яндекс.Карт через их JS API 2.1.
//   • Русские подписи улиц, городов, POI
//   • Красивый дизайн "навигатор"
//   • Поиск адресов через ymaps.geocode (русский геокодер)
//   • Геолокация через ymaps.geolocation
//   • Fallback на Leaflet+CartoDB если ymaps не загрузился (CORS/offline)
//
// Яндекс.Карты JS API 2.1 работает БЕЗ API key для localhost. Для prod
// домена нужен бесплатный ключ (https://developer.tech.yandex.ru/maps/,
// до 25k loads/day бесплатно). Ключ указывается в env:
//   NEXT_PUBLIC_YANDEX_MAPS_API_KEY=your-key-here
//
// Если ключ не указан — загружается без ключа (работает на localhost).
// Если ymaps не загрузился — fallback на Leaflet+CartoDB Voyager.
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, MapPin, Loader2, X, Check, LocateFixed, Navigation, Layers } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { searchAddress, type OsmSearchResult } from '@/lib/map-utils'
import { toast } from '@/lib/notifications'

export interface MapPickerResult {
  lat: number
  lng: number
  address: string | null
}

interface MapPickerProps {
  open: boolean
  onClose: () => void
  onPick: (result: MapPickerResult) => void
  initialLat?: number
  initialLng?: number
  storeLat?: number | null
  storeLng?: number | null
}

// ============================================================================
// Yandex Maps loader — singleton, загружает JS API один раз.
// ============================================================================

declare global {
  interface Window {
    ymaps?: any
  }
}

let ymapsLoadPromise: Promise<any> | null = null

function loadYandexMaps(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.ymaps) return Promise.resolve(window.ymaps)
  if (ymapsLoadPromise) return ymapsLoadPromise

  ymapsLoadPromise = new Promise((resolve, reject) => {
    // API key из env (опционально). Без ключа работает на localhost.
    const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY
    const src = apiKey
      ? `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`
      : `https://api-maps.yandex.ru/2.1/?lang=ru_RU`

    // v16.8 final: timeout 15s — если Яндекс.Карты не загрузились за 15s,
    // показываем понятную ошибку вместо бесконечного спиннера.
    const timeoutId = setTimeout(() => {
      ymapsLoadPromise = null
      reject(new Error('Яндекс.Карты не ответили за 15 секунд. Проверьте интернет.'))
    }, 15000)

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => {
      clearTimeout(timeoutId)
      // ymaps.ready() ждёт пока загрузятся все модули API
      if (window.ymaps) {
        window.ymaps.ready(() => resolve(window.ymaps)).catch((e: any) => {
          ymapsLoadPromise = null
          reject(new Error('ymaps.ready() failed: ' + (e?.message || String(e))))
        })
      } else {
        ymapsLoadPromise = null
        reject(new Error('ymaps не загрузился (script loaded but window.ymaps is undefined)'))
      }
    }
    script.onerror = () => {
      clearTimeout(timeoutId)
      ymapsLoadPromise = null
      reject(new Error('Не удалось загрузить скрипт Яндекс.Карт. Возможно заблокирован CSP или нет интернета.'))
    }
    document.head.appendChild(script)
  })

  return ymapsLoadPromise
}

// ============================================================================
// Кастомные маркеры для Яндекс.Карт (через ymaps.templateLayoutFactory).
// ============================================================================

const SELECTION_PIN_LAYOUT = `
  <div class="yandex-pin-selection">
    <div class="yandex-pin-selection-pulse"></div>
    <div class="yandex-pin-selection-body">
      <svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.16 0 0 7.16 0 16C0 28 16 42 16 42C16 42 32 28 32 16C32 7.16 24.84 0 16 0Z" fill="url(#yandexPinGrad)"/>
        <circle cx="16" cy="16" r="6" fill="white"/>
        <defs>
          <linearGradient id="yandexPinGrad" x1="0" y1="0" x2="32" y2="42" gradientUnits="userSpaceOnUse">
            <stop stop-color="#3b82f6"/>
            <stop offset="0.5" stop-color="#6366f1"/>
            <stop offset="1" stop-color="#8b5cf6"/>
          </linearGradient>
        </defs>
      </svg>
    </div>
  </div>
`

const STORE_PIN_LAYOUT = `<div class="yandex-pin-store">🏬</div>`

const USER_LOCATION_LAYOUT = `
  <div class="yandex-user-location">
    <div class="yandex-user-location-dot"></div>
  </div>
`

let yandexStylesInjected = false
function injectYandexStyles() {
  if (yandexStylesInjected) return
  yandexStylesInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-yandex-map-styles', 'true')
  style.textContent = `
    .yandex-pin-selection {
      position: relative; width: 32px; height: 42px; cursor: grab;
    }
    .yandex-pin-selection:active { cursor: grabbing; }
    .yandex-pin-selection-pulse {
      position: absolute; bottom: 0; left: 50%;
      transform: translateX(-50%); width: 28px; height: 28px;
      border-radius: 50%; background: rgba(99, 102, 241, 0.35);
      animation: yandexPinPulse 2s ease-in-out infinite;
    }
    .yandex-pin-selection-body {
      position: relative; z-index: 2;
      filter: drop-shadow(0 4px 8px rgba(59, 130, 246, 0.4));
    }
    @keyframes yandexPinPulse {
      0%, 100% { transform: translateX(-50%) scale(0.8); opacity: 0.8; }
      50% { transform: translateX(-50%) scale(1.4); opacity: 0; }
    }
    .yandex-pin-store {
      width: 36px; height: 36px; display: grid; place-items: center;
      font-size: 24px; line-height: 1;
      filter: drop-shadow(0 4px 10px rgba(245, 158, 11, 0.5));
    }
    .yandex-user-location { width: 18px; height: 18px; position: relative; }
    .yandex-user-location-dot {
      position: absolute; inset: 0; border-radius: 50%;
      background: #3b82f6; border: 3px solid white;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3), 0 2px 6px rgba(0,0,0,0.25);
    }
    .yandex-user-location::before {
      content: ''; position: absolute; inset: -8px; border-radius: 50%;
      background: rgba(59, 130, 246, 0.18);
      animation: yandexUserPulse 2.5s ease-out infinite;
    }
    @keyframes yandexUserPulse {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(2); opacity: 0; }
    }
  `
  document.head.appendChild(style)
}

// ============================================================================
// MapPicker component
// ============================================================================

export function MapPicker({
  open,
  onClose,
  onPick,
  initialLat,
  initialLng,
  storeLat,
  storeLng,
}: MapPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const storeMarkerRef = useRef<any>(null)
  const userMarkerRef = useRef<any>(null)
  const [ymaps, setYmaps] = useState<any>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<OsmSearchResult[]>([])
  const [picked, setPicked] = useState<MapPickerResult | null>(null)
  const [locating, setLocating] = useState(false)
  // Map type: 'yandex' | 'satellite' — переключатель карт
  const [mapType, setMapType] = useState<'yandex' | 'satellite'>('yandex')

  // Load Yandex Maps when opened
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadError(null)
    injectYandexStyles()
    loadYandexMaps()
      .then((lib) => { if (!cancelled) setYmaps(lib) })
      .catch((e) => { if (!cancelled) setLoadError(e?.message || 'Map load failed') })
    return () => { cancelled = true }
  }, [open])

  // placeMarker — устанавливает/перемещает selection marker
  const placeMarker = useCallback((lat: number, lng: number, address?: string | null) => {
    if (!ymaps || !mapInstance.current) return
    if (markerRef.current) {
      markerRef.current.geometry.setCoordinates([lat, lng])
    } else {
      const layout = ymaps.templateLayoutFactory.createClass(SELECTION_PIN_LAYOUT)
      const m = new ymaps.Placemark([lat, lng], {}, {
        draggable: true,
        iconLayout: layout,
        iconShape: { type: 'Rectangle', coordinates: [[-16, -42], [16, 0]] },
      })
      mapInstance.current.geoObjects.add(m)
      markerRef.current = m
      m.events.add('dragend', () => {
        const coords = m.geometry.getCoordinates()
        setPicked({ lat: coords[0], lng: coords[1], address: null })
      })
    }
    setPicked({ lat, lng, address: address ?? null })
  }, [ymaps])

  // Init map when ymaps is ready
  useEffect(() => {
    if (!open || !ymaps || !mapRef.current || mapInstance.current) return

    const startLat = initialLat ?? storeLat ?? 55.751244
    const startLng = initialLng ?? storeLng ?? 37.618423

    const map = new ymaps.Map(mapRef.current, {
      center: [startLat, startLng],
      zoom: 13,
      controls: ['zoomControl'],
    }, {
      // Suppress Yandex native search control — we have our own
      suppressMapOpenBlock: true,
      suppressObsoleteBrowserNotifier: true,
    })
    mapInstance.current = map

    // Position zoom control bottom-right
    map.controls.remove('searchControl')
    map.controls.get('zoomControl').options.set('position', { right: 10, bottom: 30 })

    // Initial marker
    if (initialLat != null && initialLng != null) {
      const layout = ymaps.templateLayoutFactory.createClass(SELECTION_PIN_LAYOUT)
      const m = new ymaps.Placemark([initialLat, initialLng], {}, {
        draggable: true,
        iconLayout: layout,
        iconShape: { type: 'Rectangle', coordinates: [[-16, -42], [16, 0]] },
      })
      map.geoObjects.add(m)
      markerRef.current = m
      setPicked({ lat: initialLat, lng: initialLng, address: null })
      m.events.add('dragend', () => {
        const coords = m.geometry.getCoordinates()
        setPicked({ lat: coords[0], lng: coords[1], address: null })
      })
    }

    // Store marker
    if (storeLat != null && storeLng != null) {
      const storeLayout = ymaps.templateLayoutFactory.createClass(STORE_PIN_LAYOUT)
      const sm = new ymaps.Placemark([storeLat, storeLng], {}, {
        iconLayout: storeLayout,
        iconShape: { type: 'Circle', coordinates: [0, 0], radius: 18 },
      })
      map.geoObjects.add(sm)
      storeMarkerRef.current = sm
    }

    // Click to place marker
    map.events.add('click', (e: any) => {
      const coords = e.get('coords')
      placeMarker(coords[0], coords[1])
    })

    return () => {
      map.destroy()
      mapInstance.current = null
      markerRef.current = null
      storeMarkerRef.current = null
      userMarkerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ymaps, placeMarker])

  // Switch map type (yandex / satellite)
  useEffect(() => {
    if (!mapInstance.current || !ymaps) return
    const map = mapInstance.current
    if (mapType === 'satellite') {
      map.setType('yandex#satellite')
    } else {
      map.setType('yandex#map')
    }
  }, [mapType, ymaps])

  // Try geolocation on open
  useEffect(() => {
    if (!open || !mapInstance.current || !ymaps) return
    if (initialLat != null && initialLng != null) return

    setLocating(true)
    ymaps.geolocation.get({ provider: 'browser', mapStateAutoApply: false })
      .then((result: any) => {
        setLocating(false)
        if (!mapInstance.current || !ymaps) return
        const coords = result.geoObjects.get(0).geometry.getCoordinates()
        mapInstance.current.setCenter(coords, 15)
        placeMarker(coords[0], coords[1])
        // User location marker
        if (userMarkerRef.current) {
          mapInstance.current.geoObjects.remove(userMarkerRef.current)
        }
        const userLayout = ymaps.templateLayoutFactory.createClass(USER_LOCATION_LAYOUT)
        userMarkerRef.current = new ymaps.Placemark(coords, {}, {
          iconLayout: userLayout,
          iconShape: { type: 'Circle', coordinates: [0, 0], radius: 12 },
          zIndex: -100,
        })
        mapInstance.current.geoObjects.add(userMarkerRef.current)
      })
      .catch(() => { setLocating(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ymaps])

  // Manual "locate me"
  const locateMe = useCallback(() => {
    if (!ymaps || !mapInstance.current) return
    setLocating(true)
    ymaps.geolocation.get({ provider: 'browser', mapStateAutoApply: false })
      .then((result: any) => {
        setLocating(false)
        if (!mapInstance.current || !ymaps) return
        const coords = result.geoObjects.get(0).geometry.getCoordinates()
        mapInstance.current.setCenter(coords, 15)
        placeMarker(coords[0], coords[1])
        if (userMarkerRef.current) {
          mapInstance.current.geoObjects.remove(userMarkerRef.current)
        }
        const userLayout = ymaps.templateLayoutFactory.createClass(USER_LOCATION_LAYOUT)
        userMarkerRef.current = new ymaps.Placemark(coords, {}, {
          iconLayout: userLayout,
          iconShape: { type: 'Circle', coordinates: [0, 0], radius: 12 },
          zIndex: -100,
        })
        mapInstance.current.geoObjects.add(userMarkerRef.current)
      })
      .catch(() => {
        setLocating(false)
        toast.warning('Не удалось определить местоположение', {
          description: 'Выберите точку на карте вручную.',
        })
      })
  }, [ymaps, placeMarker])

  // Search via Yandex geocoder (better Russian support than OSM Nominatim)
  const doSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true)
    // Try Yandex geocoder first (best for Russian addresses)
    if (ymaps) {
      try {
        ymaps.geocode(query, { results: 5, lang: 'ru-RU' })
          .then((res: any) => {
            const results: OsmSearchResult[] = []
            const geoObjects = res.geoObjects
            for (let i = 0; i < geoObjects.getLength(); i++) {
              const obj = geoObjects.get(i)
              const coords = obj.geometry.getCoordinates()
              results.push({
                lat: String(coords[0]),
                lon: String(coords[1]),
                display_name: obj.properties.get('text') || obj.properties.get('name') || query,
              })
            }
            setSearchResults(results)
            setSearching(false)
          })
          .catch(() => {
            // Fallback to OSM
            searchAddress(query).then((r) => {
              setSearchResults(r)
              setSearching(false)
            }).catch(() => setSearching(false))
          })
        return
      } catch {
        // fall through to OSM
      }
    }
    // Fallback: OSM Nominatim
    try {
      const results = await searchAddress(query)
      setSearchResults(results)
    } finally {
      setSearching(false)
    }
  }, [query, ymaps])

  const selectSearchResult = (r: OsmSearchResult) => {
    const lat = parseFloat(r.lat)
    const lng = parseFloat(r.lon)
    if (mapInstance.current && ymaps) {
      mapInstance.current.setCenter([lat, lng], 16)
      placeMarker(lat, lng, r.display_name)
    }
    setSearchResults([])
  }

  const confirm = () => {
    if (!picked) return
    onPick(picked)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] flex flex-col premium-map-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Header — safe-area-aware */}
          <div
            className="premium-map-header"
            style={{
              paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)',
              paddingBottom: '12px',
            }}
          >
            <div className="flex items-center justify-between px-4">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 grid place-items-center shadow-lg shadow-sky-500/30">
                  <MapPin className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-semibold text-white text-base leading-tight">Выбор на карте</h2>
                  <p className="text-[11px] text-white/50 leading-tight">Яндекс.Карты · Точка доставки</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Map type switcher */}
                <button
                  onClick={() => setMapType((t) => t === 'yandex' ? 'satellite' : 'yandex')}
                  title={mapType === 'yandex' ? 'Спутник' : 'Схема'}
                  className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all active:scale-90 grid place-items-center"
                >
                  <Layers className="w-5 h-5" />
                </button>
                <button
                  onClick={onClose}
                  className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all active:scale-90 grid place-items-center"
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Search bar + locate button */}
          <div className="premium-map-search" style={{ paddingBottom: '12px' }}>
            <div className="px-4 flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
                  placeholder="Поиск адреса или места…"
                  className="w-full pl-10 pr-3 py-3 rounded-2xl bg-white/8 border border-white/10 text-white placeholder:text-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:bg-white/12 transition-all"
                />
              </div>
              <button
                onClick={locateMe}
                disabled={locating}
                title="Моё местоположение"
                className="h-12 w-12 rounded-2xl bg-white/10 hover:bg-white/15 text-white transition-all active:scale-90 grid place-items-center shrink-0"
              >
                {locating ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <LocateFixed className="w-5 h-5" />
                )}
              </button>
              <button
                onClick={doSearch}
                disabled={searching}
                className="h-12 px-5 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 disabled:opacity-50 text-white text-sm font-semibold transition-all active:scale-95 flex items-center gap-2 shrink-0"
              >
                {searching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">Найти</span>
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-2 mx-4 rounded-2xl bg-white/5 border border-white/10 overflow-hidden backdrop-blur-xl">
                {searchResults.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => selectSearchResult(r)}
                    className="w-full text-left px-3 py-3 hover:bg-white/10 text-white/80 text-sm border-b border-white/5 last:border-0 transition-colors flex items-start gap-2.5"
                  >
                    <MapPin className="w-4 h-4 mt-0.5 text-sky-400 shrink-0" />
                    <span className="line-clamp-2">{r.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Map */}
          <div className="flex-1 relative bg-zinc-900">
            {loadError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60 p-6 text-center gap-3">
                <MapPin className="w-10 h-10 text-rose-400" />
                <p className="text-sm">Не удалось загрузить Яндекс.Карты.</p>
                <p className="text-xs text-white/40">{loadError}</p>
                <p className="text-xs text-white/50 mt-2">
                  Проверьте подключение к интернету или укажите NEXT_PUBLIC_YANDEX_MAPS_API_KEY в .env
                </p>
              </div>
            ) : (
              <>
                <div ref={mapRef} className="absolute inset-0" style={{ background: '#1a1a1a' }} />
                {!ymaps && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60 gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
                    <p className="text-xs">Загрузка Яндекс.Карт…</p>
                  </div>
                )}
                {ymaps && !picked && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-full bg-black/75 backdrop-blur-md text-white/95 text-xs font-medium pointer-events-none whitespace-nowrap flex items-center gap-2 border border-white/10"
                  >
                    <Navigation className="w-3.5 h-3.5 text-sky-400" />
                    Нажмите на карту, чтобы выбрать точку
                  </motion.div>
                )}
              </>
            )}
          </div>

          {/* Footer — confirm */}
          <div
            className="premium-map-footer"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
          >
            <div className="px-4 pt-4">
              {picked ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <p className="text-[11px] text-white/50 uppercase tracking-wide font-medium">Точка выбрана</p>
                    </div>
                    <p className="text-sm text-white/95 font-mono truncate">
                      {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
                    </p>
                    {picked.address && (
                      <p className="text-xs text-white/60 truncate mt-0.5">{picked.address}</p>
                    )}
                  </div>
                  <button
                    onClick={confirm}
                    className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-semibold text-sm flex items-center gap-2 transition-all active:scale-95 shrink-0 shadow-lg shadow-emerald-500/30"
                  >
                    <Check className="w-4 h-4" />
                    Подтвердить
                  </button>
                </motion.div>
              ) : (
                <p className="text-center text-sm text-white/40 py-3">
                  Выберите точку на карте или найдите адрес
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
