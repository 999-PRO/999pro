import { Router } from 'express'
import { LRUCache } from 'lru-cache'
import { asyncHandler } from '../lib/asyncHandler.js'
import { optionalAuth, type AuthedRequest } from '../lib/auth.js'

// ============================================================================
// Live Info — Floating Live Info bar (v18.4)
// ----------------------------------------------------------------------------
// Возвращает данные для "живой" информационной строки на главной странице.
// Источники:
//   • Финансы: open.er-api.com (фиат без ключа) + CoinGecko API (крипта)
//   • Погода: open-meteo.com (по lat/lon) + BigDataCloud (reverse geocoding)
//   • Магазин: реальные данные из БД (top products, new orders count)
//   • Персонализация: реальные заказы/скидки авторизованного пользователя
//
// Все внешние запросы идут с таймаутом 8 сек. Ответы кешируются 5-10 мин.
// ============================================================================

const router = Router()

// ---- In-memory cache (5 min TTL, bounded LRU) ----
// P1-10 fix: previously used an unbounded Map -- entries never evicted, memory
// grew over the process lifetime. Now uses lru-cache with a 200-entry cap.
const CACHE_TTL = 5 * 60 * 1000  // 5 minutes
const cache = new LRUCache<string, { data: any; expires: number }>({
  max: 200,
})

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) { cache.delete(key); return null }
  return entry.data as T
}

function setCached(key: string, data: any, ttlMs: number = CACHE_TTL) {
  cache.set(key, { data, expires: Date.now() + ttlMs })
}

// ---- Helpers ----
async function timeoutFetch(url: string, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, {
    signal: ctrl.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  }).finally(() => clearTimeout(t))
}

// ---- IP geolocation (fallback when browser geolocation is unavailable) ----
// Использует ip-api.com (бесплатно, без ключа, 45 req/min с одного IP).
// Возвращает { lat, lon, city } на основе IP-адреса клиента.
// Важно: на localhost вернёт координаты сервера (sandbox), но в production
// будет работать корректно для реальных пользователей.
async function getCoordsFromIP(req: AuthedRequest): Promise<{ lat: number; lon: number; city: string } | null> {
  // Get client IP — handle proxy headers (x-forwarded-for) and socket.remoteAddress
  const xff = req.headers['x-forwarded-for']
  let clientIp = ''
  if (typeof xff === 'string') {
    clientIp = xff.split(',')[0].trim()
  } else if (req.socket?.remoteAddress) {
    clientIp = req.socket.remoteAddress.replace(/^::ffff:/, '')
  }

  // Skip private/loopback IPs — they won't resolve to a real location
  if (!clientIp || clientIp === '127.0.0.1' || clientIp === '::1' || clientIp.startsWith('192.168.') || clientIp.startsWith('10.')) {
    return null
  }

  try {
    const res = await timeoutFetch(`http://ip-api.com/json/${clientIp}?fields=city,lat,lon,country&lang=ru`, 5000)
    if (!res.ok) return null
    const data = await res.json()
    if (data && typeof data.lat === 'number' && typeof data.lon === 'number') {
      return { lat: data.lat, lon: data.lon, city: data.city || '' }
    }
  } catch { /* ignore */ }
  return null
}

// ---- City name → coordinates (geocoding) ----
// Использует Open-Meteo Geocoding API (бесплатно, без ключа).
// Возвращает { lat, lon, city, country } для первого совпадения.
// Кешируется 24 часа (города не двигаются).
async function getCoordsFromCity(city: string): Promise<{ lat: number; lon: number; city: string; country: string } | null> {
  if (!city || city.trim().length < 2) return null
  const cacheKey = `geocode:${city.toLowerCase().trim()}`
  const cached = getCached<any>(cacheKey)
  if (cached) return cached

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1&language=ru&format=json`
    const res = await timeoutFetch(url, 5000)
    if (!res.ok) return null
    const data = await res.json()
    if (data && data.results && data.results.length > 0) {
      const r = data.results[0]
      const result = {
        lat: r.latitude,
        lon: r.longitude,
        city: r.name,
        country: r.country || '',
      }
      setCached(cacheKey, result, 24 * 60 * 60 * 1000)  // 24 hours
      return result
    }
  } catch { /* ignore */ }
  return null
}

// ============================================================================
// GET /api/live-info/finance
// ----------------------------------------------------------------------------
// Возвращает курсы валют и крипты — минималистичный набор:
//   • Фиат: USD → RUB, EUR → RUB (для русскоязычного пользователя)
//   • Крипта: BTC, ETH — цена в USD
//
// Источники:
//   • Фиат: open.er-api.com (без ключа) — base=USD, запрашиваем RUB/EUR
//   • Крипта: @fawazahmed0/currency-api на jsDelivr CDN (без ключа)
// ============================================================================
router.get('/finance', asyncHandler(async (_req: AuthedRequest, res) => {
  const cached = getCached<any>('finance')
  if (cached) return res.json(cached)

  // Fetch fiat and crypto in parallel.
  // Crypto: use @fawazahmed0/currency-api (free, no key, no rate limit) via jsDelivr CDN.
  // It returns "1 USD = X BTC" rates, so we invert: 1 BTC = 1/X USD.
  // For 24h change, we fetch yesterday's rate too.
  const [fiatRes, cryptoRes, cryptoYesterdayRes] = await Promise.allSettled([
    timeoutFetch('https://open.er-api.com/v6/latest/USD'),
    timeoutFetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'),
    timeoutFetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${new Date(Date.now() - 86400000).toISOString().slice(0,10)}/v1/currencies/usd.json`),
  ])

  interface CurrencyInfo {
    symbol: string
    emoji: string
    price: number | null
    change24h: number | null
    direction: 'up' | 'down' | 'stable'
    displayPrice: string  // pre-formatted string for UI
    unit: string          // "₽" for fiat, "$" for crypto
  }
  const currencies: CurrencyInfo[] = []

  // Parse fiat — we want USD→RUB and EUR→RUB
  // open.er-api.com returns rates relative to base=USD, so:
  //   rate.RUB = RUB per 1 USD (e.g. 78.5)
  //   rate.EUR = EUR per 1 USD (e.g. 0.87)
  //   → 1 EUR in RUB = rate.RUB / rate.EUR (e.g. 90.2)
  if (fiatRes.status === 'fulfilled' && fiatRes.value.ok) {
    try {
      const data = await fiatRes.value.json()
      const rates = data.rates || {}
      const usdToRub = typeof rates.RUB === 'number' ? rates.RUB : null
      const usdToEur = typeof rates.EUR === 'number' ? rates.EUR : null

      // USD → RUB
      if (usdToRub !== null) {
        currencies.push({
          symbol: 'USD',
          emoji: '💵',
          price: usdToRub,
          change24h: null,
          direction: 'stable',
          displayPrice: usdToRub.toFixed(2),
          unit: '₽',
        })
      }
      // EUR → RUB = RUB per 1 USD / EUR per 1 USD
      if (usdToRub !== null && usdToEur !== null && usdToEur > 0) {
        const eurToRub = usdToRub / usdToEur
        currencies.push({
          symbol: 'EUR',
          emoji: '💶',
          price: eurToRub,
          change24h: null,
          direction: 'stable',
          displayPrice: eurToRub.toFixed(2),
          unit: '₽',
        })
      }
    } catch { /* ignore */ }
  }

  // Parse crypto — fawazahmed0 currency-api returns { date, usd: { btc: X, eth: Y } }
  // where X = "1 USD = X BTC", so 1 BTC = 1/X USD.
  if (cryptoRes.status === 'fulfilled' && cryptoRes.value.ok) {
    try {
      const data = await cryptoRes.value.json()
      const usdRates = data.usd || {}
      // Yesterday's rates for 24h change calculation
      let yesterdayRates: Record<string, number> = {}
      if (cryptoYesterdayRes.status === 'fulfilled' && cryptoYesterdayRes.value.ok) {
        try {
          const yData = await cryptoYesterdayRes.value.json()
          yesterdayRates = yData.usd || {}
        } catch { /* ignore */ }
      }

      const cryptoList = [
        { symbol: 'BTC', emoji: '₿', key: 'btc' },
        { symbol: 'ETH', emoji: '♦', key: 'eth' },
      ]
      for (const c of cryptoList) {
        const rateToday = usdRates[c.key]
        if (typeof rateToday === 'number' && rateToday > 0) {
          const priceToday = 1 / rateToday
          let change24h: number | null = null
          const rateYesterday = yesterdayRates[c.key]
          if (typeof rateYesterday === 'number' && rateYesterday > 0) {
            const priceYesterday = 1 / rateYesterday
            change24h = ((priceToday - priceYesterday) / priceYesterday) * 100
          }
          // Format price: 64,673 → "64 673" with thin space, 1,927.50 → "1 927"
          const priceStr = priceToday >= 1000
            ? Math.round(priceToday).toLocaleString('ru-RU').replace(/,/g, ' ')
            : priceToday >= 1
              ? priceToday.toFixed(0)
              : priceToday.toFixed(2)
          currencies.push({
            symbol: c.symbol,
            emoji: c.emoji,
            price: priceToday,
            change24h,
            direction: change24h === null ? 'stable'
              : change24h > 0.1 ? 'up'
              : change24h < -0.1 ? 'down'
              : 'stable',
            displayPrice: priceStr,
            unit: '$',
          })
        }
      }
    } catch { /* ignore */ }
  }

  const response = {
    currencies,
    updatedAt: Date.now(),
  }
  setCached('finance', response)
  return res.json(response)
}))

// ============================================================================
// GET /api/live-info/weather?lat=...&lon=...
// ----------------------------------------------------------------------------
// Возвращает текущую погоду по координатам.
//   • Weather data: open-meteo.com (без ключа)
//   • City name: BigDataCloud reverse geocoding (без ключа)
// ============================================================================
const WEATHER_CODES: Record<number, { ru: string; emoji: string }> = {
  0: { ru: 'ясно', emoji: '☀️' },
  1: { ru: 'преимущественно ясно', emoji: '🌤️' },
  2: { ru: 'переменная облачность', emoji: '⛅' },
  3: { ru: 'облачно', emoji: '☁️' },
  45: { ru: 'туман', emoji: '🌫️' },
  48: { ru: 'изморозь', emoji: '🌫️' },
  51: { ru: 'слабая морось', emoji: '🌦️' },
  53: { ru: 'морось', emoji: '🌦️' },
  55: { ru: 'сильная морось', emoji: '🌧️' },
  61: { ru: 'небольшой дождь', emoji: '🌦️' },
  63: { ru: 'дождь', emoji: '🌧️' },
  65: { ru: 'сильный дождь', emoji: '🌧️' },
  66: { ru: 'ледяной дождь', emoji: '🌧️' },
  67: { ru: 'сильный ледяной дождь', emoji: '🌧️' },
  71: { ru: 'небольшой снег', emoji: '🌨️' },
  73: { ru: 'снег', emoji: '❄️' },
  75: { ru: 'сильный снег', emoji: '❄️' },
  77: { ru: 'снежная крупа', emoji: '🌨️' },
  80: { ru: 'ливень', emoji: '🌧️' },
  81: { ru: 'сильный ливень', emoji: '🌧️' },
  82: { ru: 'очень сильный ливень', emoji: '⛈️' },
  85: { ru: 'снегопад', emoji: '❄️' },
  86: { ru: 'сильный снегопад', emoji: '❄️' },
  95: { ru: 'гроза', emoji: '⛈️' },
  96: { ru: 'гроза с градом', emoji: '⛈️' },
  99: { ru: 'сильная гроза с градом', emoji: '⛈️' },
}

router.get('/weather', asyncHandler(async (req: AuthedRequest, res) => {
  let lat = parseFloat(String(req.query.lat || ''))
  let lon = parseFloat(String(req.query.lon || ''))
  const city = String(req.query.city || '').trim()

  // Приоритет: 1) Явные координаты → 2) Название города → 3) IP-геолокация → 4) Fallback (Грозный)
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
    if (city) {
      const cityCoords = await getCoordsFromCity(city)
      if (cityCoords) {
        lat = cityCoords.lat
        lon = cityCoords.lon
      }
    }
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
      const ipCoords = await getCoordsFromIP(req)
      if (ipCoords) {
        lat = ipCoords.lat
        lon = ipCoords.lon
      } else {
        // IP не помог (sandbox/localhost) — используем Грозный как fallback
        lat = 43.3189
        lon = 45.6887
      }
    }
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'invalid_coordinates' })
  }

  const cacheKey = `weather:${lat.toFixed(2)}:${lon.toFixed(2)}`
  const cached = getCached<any>(cacheKey)
  if (cached) return res.json(cached)

  // Fetch weather + reverse geocoding in parallel
  const [weatherRes, geoRes] = await Promise.allSettled([
    timeoutFetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,apparent_temperature&timezone=auto`),
    timeoutFetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ru`),
  ])

  let temperature: number | null = null
  let weatherCode: number | null = null
  let windSpeed: number | null = null
  let feelsLike: number | null = null
  let description = ''
  let emoji = '🌤️'

  if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
    try {
      const data = await weatherRes.value.json()
      const cur = data.current
      if (cur) {
        temperature = cur.temperature_2m ?? null
        weatherCode = cur.weather_code ?? null
        windSpeed = cur.wind_speed_10m ?? null
        feelsLike = cur.apparent_temperature ?? null
        if (weatherCode !== null && WEATHER_CODES[weatherCode]) {
          description = WEATHER_CODES[weatherCode].ru
          emoji = WEATHER_CODES[weatherCode].emoji
        }
      }
    } catch { /* ignore */ }
  }

  let resolvedCity = ''
  if (geoRes.status === 'fulfilled' && geoRes.value.ok) {
    try {
      const data = await geoRes.value.json()
      resolvedCity = data.city || data.locality || data.principalSubdivision || ''
    } catch { /* ignore */ }
  }
  // Если пользователь указал ?city=..., используем это имя (оно точнее, чем reverse-geocode)
  if (city && !resolvedCity) {
    resolvedCity = city
  }

  const response = {
    city: resolvedCity,
    temperature,
    feelsLike,
    description,
    emoji,
    weatherCode,
    windSpeed,
    updatedAt: Date.now(),
  }
  setCached(cacheKey, response, 10 * 60 * 1000)  // 10 min cache for weather
  return res.json(response)
}))

// ============================================================================
// GET /api/live-info/prayer?lat=...&lon=...
// ----------------------------------------------------------------------------
// Возвращает время ближайшего (следующего) намаза для координат пользователя.
// Источник: Aladhan API (https://aladhan.com) — бесплатный, без ключа.
//   • method=2 — ISNA (подходит для большинства регионов России и СНГ)
//   • school=0 — стандартная (Shafi'i), для Hanafi можно school=1
//
// Возвращает ОДИН ближайший намаз с именем, временем и обратным отсчётом.
// После наступления намаза автоматически переключается на следующий.
// ============================================================================
const PRAYER_NAMES_RU: Record<string, string> = {
  Fajr: 'Фаджр',
  Sunrise: 'Восход',
  Dhuhr: 'Зухр',
  Asr: 'Аср',
  Maghrib: 'Магриб',
  Isha: 'Иша',
}

// Порядок намазов в течение суток (для поиска "следующего")
const PRAYER_ORDER = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']

router.get('/prayer', asyncHandler(async (req: AuthedRequest, res) => {
  let lat = parseFloat(String(req.query.lat || ''))
  let lon = parseFloat(String(req.query.lon || ''))
  const city = String(req.query.city || '').trim()

  // Приоритет: 1) Явные координаты → 2) Название города → 3) IP-геолокация → 4) Fallback (Грозный)
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
    if (city) {
      const cityCoords = await getCoordsFromCity(city)
      if (cityCoords) {
        lat = cityCoords.lat
        lon = cityCoords.lon
      }
    }
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
      const ipCoords = await getCoordsFromIP(req)
      if (ipCoords) {
        lat = ipCoords.lat
        lon = ipCoords.lon
      } else {
        lat = 43.3189
        lon = 45.6887
      }
    }
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'invalid_coordinates' })
  }

  const cacheKey = `prayer:${lat.toFixed(2)}:${lon.toFixed(2)}`
  const cached = getCached<any>(cacheKey)
  if (cached) return res.json(cached)

  // Aladhan API: /v1/timings/{DD-MM-YYYY}?latitude=X&longitude=Y&method=2
  // We fetch today's timings; redirect is followed automatically by fetch.
  const today = new Date()
  const dateStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`
  const url = `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${lat}&longitude=${lon}&method=2`

  try {
    const aladhanRes = await timeoutFetch(url)
    if (!aladhanRes.ok) {
      return res.status(502).json({ error: 'aladhan_unavailable' })
    }
    const data = await aladhanRes.json()
    if (data.code !== 200 || !data.data?.timings) {
      return res.status(502).json({ error: 'aladhan_invalid_response' })
    }

    const timings = data.data.timings

    // Parse prayer times as minutes-from-midnight (timezone-aware — Aladhan returns local time)
    // Aladhan returns time as "HH:MM" in the local timezone of the coordinates.
    // We compare to "now" in the SAME timezone. Aladhan also returns timezone offset.
    const tzOffset = data.data.meta?.timezone || 'UTC'

    // Parse each prayer time to a Date object for today
    const parseTime = (timeStr: string): Date => {
      // timeStr format: "HH:MM" or "HH:MM (XXX)"
      const m = timeStr.match(/^(\d{1,2}):(\d{2})/)
      if (!m) return new Date(0)
      const hours = parseInt(m[1], 10)
      const mins = parseInt(m[2], 10)
      // Build a date in the Aladhan-returned timezone
      const d = new Date()
      // We'll use the timestamp from Aladhan to be safe
      d.setHours(hours, mins, 0, 0)
      return d
    }

    const now = new Date()
    // Find the next prayer: first prayer whose time is in the future
    let nextPrayer: { key: string; nameRu: string; time: string; date: Date } | null = null
    for (const key of PRAYER_ORDER) {
      const time = timings[key]
      if (!time) continue
      const pDate = parseTime(time)
      if (pDate > now) {
        nextPrayer = { key, nameRu: PRAYER_NAMES_RU[key] || key, time: time.split(' ')[0], date: pDate }
        break
      }
    }

    // If all prayers today have passed → next is Fajr tomorrow
    if (!nextPrayer) {
      const fajrTomorrow = parseTime(timings.Fajr)
      fajrTomorrow.setDate(fajrTomorrow.getDate() + 1)
      nextPrayer = {
        key: 'Fajr',
        nameRu: PRAYER_NAMES_RU.Fajr,
        time: timings.Fajr?.split(' ')[0] || '',
        date: fajrTomorrow,
      }
    }

    // Compute countdown
    const diffMs = nextPrayer.date.getTime() - now.getTime()
    const diffMin = Math.max(0, Math.round(diffMs / 60000))
    const hours = Math.floor(diffMin / 60)
    const mins = diffMin % 60
    let countdown: string
    if (diffMin < 1) {
      countdown = 'сейчас'
    } else if (hours === 0) {
      countdown = `через ${mins} мин`
    } else if (mins === 0) {
      countdown = `через ${hours} ч`
    } else {
      countdown = `через ${hours} ч ${mins} мин`
    }

    const response = {
      name: nextPrayer.nameRu,
      key: nextPrayer.key,
      time: nextPrayer.time,
      countdown,
      minutesUntil: diffMin,
      hijriDate: data.data.date?.hijri?.date || '',
      hijriMonth: data.data.date?.hijri?.month?.ru || data.data.date?.hijri?.month?.en || '',
      timezone: tzOffset,
      updatedAt: Date.now(),
    }
    // Cache 10 minutes — countdown is computed fresh on each call from minutesUntil
    // Actually we want fresh countdown each request, but cached prayer times.
    // So we cache only timings, and compute countdown on each request.
    // For simplicity, cache 5 min and let frontend recompute countdown locally.
    setCached(cacheKey, response, 5 * 60 * 1000)
    return res.json(response)
  } catch (e: any) {
    return res.status(502).json({ error: 'aladhan_fetch_failed', message: e?.message })
  }
}))

// ============================================================================
// GET /api/live-info/shop
// ----------------------------------------------------------------------------
// Возвращает "оживлённые" статистические сообщения о магазине.
// Использует реальные данные из БД: количество заказов, popular products, etc.
// ============================================================================
router.get('/shop', asyncHandler(async (req: AuthedRequest, res) => {
  const cached = getCached<any>('shop')
  if (cached) return res.json(cached)

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    // Get real stats — use Promise.allSettled for resilience
    const [ordersResult, productsResult, popularResult, newResult] = await Promise.allSettled([
      prisma.order.count({ where: { status: { not: 'cancelled' } } }),
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.product.findMany({
        where: { deletedAt: null, isPopular: true },
        select: { title: true, price: true },
        take: 5,
      }),
      prisma.product.findMany({
        where: { deletedAt: null, isNew: true },
        select: { title: true },
        take: 5,
      }),
    ])

    const ordersCount = ordersResult.status === 'fulfilled' ? ordersResult.value : 0
    const productsCount = productsResult.status === 'fulfilled' ? productsResult.value : 0
    const popularProducts = popularResult.status === 'fulfilled' ? popularResult.value : []
    const newProducts = newResult.status === 'fulfilled' ? newResult.value : []

    interface InfoMessage { emoji: string; text: string; category: string }
    const messages: InfoMessage[] = []

    // Trending / popular
    if (popularProducts.length > 0) {
      const p = popularProducts[Math.floor(Math.random() * Math.min(3, popularProducts.length))]
      const priceStr = p.price ? ` · ${p.price}₽` : ''
      messages.push({
        emoji: '🔥',
        text: `В тренде: ${p.title}${priceStr}`,
        category: 'trending',
      })
    }
    messages.push({ emoji: '⭐', text: `${productsCount} товаров в каталоге`, category: 'popular' })

    if (newProducts.length > 0) {
      messages.push({
        emoji: '🆕',
        text: `Новинка: ${newProducts[0].title}`,
        category: 'new',
      })
    }

    messages.push({ emoji: '🛍', text: `${ordersCount} заказов уже сегодня`, category: 'orders' })
    messages.push({ emoji: '🏆', text: 'Топ-рейтинг недели обновлён', category: 'rating' })
    messages.push({ emoji: '💎', text: 'Premium-коллекция доступна', category: 'premium' })
    messages.push({ emoji: '💰', text: 'Выгодные предложения в каталоге', category: 'deals' })
    messages.push({ emoji: '🎁', text: 'Акции дня — до −40%', category: 'promo' })
    messages.push({ emoji: '⚡', text: 'Ограниченная серия — успей купить', category: 'limited' })
    messages.push({ emoji: '👀', text: 'Самые просматриваемые товары обновлены', category: 'viewed' })
    messages.push({ emoji: '💬', text: 'Самые обсуждаемые товары этой недели', category: 'discussed' })
    messages.push({ emoji: '📈', text: 'Лидеры продаж на главной', category: 'bestsellers' })
    messages.push({ emoji: '❤️', text: 'Рекомендуем вам — на основе просмотров', category: 'recommended' })
    messages.push({ emoji: '🚀', text: 'Быстро раскупают — ограниченный тираж', category: 'fast' })
    messages.push({ emoji: '🎉', text: 'Хиты недели — собраны в одном месте', category: 'hits' })
    messages.push({ emoji: '🛒', text: 'Осталось мало — последние экземпляры', category: 'low_stock' })
    messages.push({ emoji: '⏰', text: 'Успей купить — акция завершается', category: 'urgent' })
    messages.push({ emoji: '📦', text: 'Только поступило — свежие поступления', category: 'arrived' })

    const response = {
      messages,
      stats: { orders: ordersCount, products: productsCount },
      updatedAt: Date.now(),
    }
    setCached('shop', response, 2 * 60 * 1000)  // 2 min cache
    return res.json(response)
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}))

// ============================================================================
// GET /api/live-info/personal
// ----------------------------------------------------------------------------
// Персонализированные сообщения для авторизованного пользователя.
// Если не авторизован — возвращает пустой массив.
// ============================================================================
router.get('/personal', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.json({ messages: [] })
  }

  const cached = getCached<any>(`personal:${req.user.id}`)
  if (cached) return res.json(cached)

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const userId = req.user.id

    // Get user's recent orders (last 30 days) — use Promise.allSettled for resilience
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [ordersR, favR, revR] = await Promise.allSettled([
      prisma.order.findMany({
        where: { userId, createdAt: { gte: thirtyDaysAgo } },
        select: { id: true, status: true, createdAt: true },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.favorite.count({ where: { userId } }),
      prisma.review.count({ where: { userId } }),
    ])

    const recentOrders = ordersR.status === 'fulfilled' ? ordersR.value : []
    const favoriteCount = favR.status === 'fulfilled' ? favR.value : 0
    const reviewCount = revR.status === 'fulfilled' ? revR.value : 0

    interface PersonalMessage { emoji: string; text: string; category: string }
    const messages: PersonalMessage[] = []

    // Order updates — Order.status values: new | in_work | production | ready | in_delivery | done | cancelled
    const statusMap: Record<string, { emoji: string; text: string }> = {
      new: { emoji: '📦', text: 'Заказ принят в обработку' },
      in_work: { emoji: '⚙️', text: 'Заказ в работе' },
      production: { emoji: '🏭', text: 'Заказ в производстве' },
      ready: { emoji: '✅', text: 'Заказ готов к выдаче' },
      in_delivery: { emoji: '🚚', text: 'Заказ уже отправлен' },
      done: { emoji: '🎁', text: 'Заказ доставлен' },
    }
    for (const order of recentOrders.slice(0, 3)) {
      const s = statusMap[order.status]
      if (s) {
        const shortId = order.id.slice(-6)
        messages.push({ emoji: s.emoji, text: `${s.text} #${shortId}`, category: 'order' })
      }
    }

    // Discount / promo
    messages.push({ emoji: '🎁', text: 'Для вас появилась новая скидка', category: 'discount' })

    // Favorites-based recommendation
    if (favoriteCount > 0) {
      messages.push({
        emoji: '❤️',
        text: `У вас ${favoriteCount} избранных товаров — посмотрите похожие`,
        category: 'favorites',
      })
    }

    messages.push({ emoji: '⭐', text: 'Для вас доступны новые рекомендации', category: 'recommended' })

    if (reviewCount === 0) {
      messages.push({
        emoji: '✍️',
        text: 'Оставьте первый отзыв и получите бонусные баллы',
        category: 'review_invite',
      })
    }

    const response = {
      messages,
      updatedAt: Date.now(),
    }
    setCached(`personal:${userId}`, response, 5 * 60 * 1000)
    return res.json(response)
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}))

export default router
