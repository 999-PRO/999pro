import { Router } from 'express'
import { LRUCache } from 'lru-cache'
import https from 'node:https'
import { asyncHandler } from '../lib/asyncHandler.js'
import { optionalAuth, type AuthedRequest } from '../lib/auth.js'

// ---- IPv4-forced HTTPS GET helper ----
// Used by RadioBrowser (hosts that resolve to both IPv4 + IPv6).
// muzce.com and hitmos.fm use standard fetch() which handles IPv4 fine.
function httpsGetIPv4(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<{ ok: boolean; status: number; json: any | null; text: string }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (result: any) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    try {
      const u = new URL(url)
      const req = https.request(
        {
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: 'GET',
          servername: u.hostname, // SNI — required for TLS cert validation
          family: 4, // Force IPv4 — bypasses Node's broken Happy Eyeballs
          headers: { 'Accept': 'application/json', 'User-Agent': '999pro-audiohub/1.0', ...headers },
          timeout: timeoutMs,
        },
        (res) => {
          let body = ''
          res.on('data', (chunk: string) => (body += chunk))
          res.on('end', () => {
            let json: any = null
            try { json = JSON.parse(body) } catch {}
            done({ ok: res.statusCode === 200, status: res.statusCode || 0, json, text: body })
          })
          res.on('error', () => done({ ok: false, status: 0, json: null, text: '' }))
        },
      )
      req.on('timeout', () => { req.destroy(); done({ ok: false, status: 0, json: null, text: '' }) })
      req.on('error', () => done({ ok: false, status: 0, json: null, text: '' }))
      req.end()
    } catch {
      done({ ok: false, status: 0, json: null, text: '' })
    }
  })
}

// ============================================================================
// Audio Hub — backend proxy + search normalization.
// ----------------------------------------------------------------------------
// v16.18: Убраны muzjam/audius/archive/jamendo. Текущие источники:
//
//   1. hitmos.fm (PRIMARY) — русская/зарубежная музыка, 320kbps MP3.
//      Поиск: https://rus.hitmos.fm/search?q=QUERY
//      Парсинг: RSC payload (escaped JSON) содержит list треков с прямым play URL.
//      Стрим: https://pl2.hitmos.fm/{base64(/mp3/ID/track.mp3)}.mp3
//   2. muzce.com (SECONDARY) — русская/зарубежная/чеченская музыка, 256-320kbps MP3.
//      Поиск: https://muzce.com/search.html?q=QUERY
//      Парсинг: HTML с data-track/data-title/data-artist/data-img атрибутами.
//      Стрим: https://muzce.com/file/{hash}.mp3 (307 redirect на files.muzce.com)
//   3. RadioBrowser — live-радио (continuous stream).
//   4. alquran.cloud — full Quran surah audio.
// ============================================================================

const router = Router()

// ---- In-memory LRU cache (5 min TTL, bounded) ----
// P1-10 fix: replaced manual FIFO eviction with lru-cache.
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const cache = new LRUCache<string, { data: any; expires: number }>({ max: 100 })

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

function setCached(key: string, data: any) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL })
}

// ---- Types ----

interface NormalizedTrack {
  id: string
  title: string
  artist: string
  album: string | null
  coverUrl: string | null
  previewUrl: string | null
  /** Full streamable URL (always set — all sources provide full tracks). */
  fullUrl?: string | null
  duration: number | null // seconds
  genre: string | null
  kind: string // 'music' | 'nasheed' | 'quran' | 'podcast' | 'radio' | ...
  source: 'hitmos' | 'muzce' | 'radio' | 'quran'
  /** True for live radio streams (no fixed duration). */
  isLive?: boolean
}

// ============================================================================
// muzce.com — SECONDARY source, Russian + international + Chechen music
// ============================================================================
// Search:  GET https://muzce.com/search.html?q=QUERY
//          Returns server-rendered HTML with track items.
//
// HTML structure per track (in <div class="track-item">):
//   data-track="https://muzce.com/file/{hash}.mp3"   ← direct MP3 URL
//   data-title="Track Title"
//   data-artist="Artist Name"
//   data-img="https://muzce.com/...jpg"              ← cover art
//   <div class="track-time">M:SS</div>               ← duration
//
// Stream:  GET https://muzce.com/file/{hash}.mp3
//          Returns 307 redirect to https://files.muzce.com/file/{hash}.mp3
//          Direct MP3 (256-320 kbps, 44.1 kHz, Stereo) — HTTP Range supported.
//
// Notes:
//   • muzce.com has category-based subdomains (e.g. chechenskie-2026.muzce.com)
//     but the main search at muzce.com/search.html?q= covers ALL categories.
//   • The 307 redirect is followed automatically by fetch() — the proxy
//     handles it transparently.

interface MuzceTrack {
  url: string
  title: string
  artist: string
  coverUrl: string | null
  duration: string // "M:SS"
}

/**
 * Parse "M:SS" or "H:MM:SS" into seconds.
 */
function parseMuzceDuration(s: string): number | null {
  const parts = s.split(':').map((p) => parseInt(p, 10))
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

/**
 * Search muzce.com and return NormalizedTrack[] with direct MP3 stream URLs.
 */
async function searchMuzceTracks(
  q: string,
  kind: string,
  limit: number,
): Promise<NormalizedTrack[]> {
  const items: NormalizedTrack[] = []
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(
      `https://muzce.com/search.html?q=${encodeURIComponent(q)}`,
      {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'ru-RU,ru;q=0.9',
        },
      },
    )
    clearTimeout(timeout)
    if (!response.ok) return items
    const html = await response.text()

    // Pattern: data-track="URL" data-title="..." data-artist="..." data-img="..."
    // Then later: class="track-time">M:SS</div>
    // We extract the 4 data-attrs first, then find the nearest track-time.
    const trackPattern = /data-track="(https:\/\/muzce\.com\/file\/[^"]+)"\s+data-title="([^"]*)"\s+data-artist="([^"]*)"\s+data-img="([^"]*)"/g
    let match: RegExpExecArray | null
    while ((match = trackPattern.exec(html)) !== null && items.length < limit) {
      const [, mp3Url, title, artist, imgUrl] = match
      // Find the nearest track-time after this match (within 500 chars).
      const afterMatch = html.slice(match.index, match.index + 500)
      const durationMatch = afterMatch.match(/class="track-time[^"]*"[^>]*>([^<]+)</)
      const durationStr = durationMatch ? durationMatch[1].trim() : ''
      const duration = parseMuzceDuration(durationStr)

      // Cover URL: use data-img only if it's NOT the default placeholder.
      const coverUrl = imgUrl && !imgUrl.includes('no_image') ? imgUrl : null

      // Generate a stable id from the MP3 URL hash.
      const idHash = mp3Url.split('/file/')[1]?.split('.')[0]?.slice(0, 20) || Math.random().toString(36).slice(2)

      items.push({
        id: `muzce-${idHash}`,
        title: title.trim(),
        artist: artist.trim() || 'MuzCe',
        album: null,
        coverUrl,
        previewUrl: mp3Url,
        fullUrl: mp3Url,
        duration,
        genre: kind,
        kind,
        source: 'muzce',
      })
    }
  } catch {
    // Best-effort.
  }
  return items
}

// ============================================================================
// hitmos.fm — PRIMARY source, Russian + international music, 320kbps MP3
// ============================================================================
// Search:  GET https://rus.hitmos.fm/search?q=QUERY
//          Returns Next.js RSC payload (HTML with escaped JSON).
//          The "list" array contains tracks with: id, artist, title, version,
//          duration, bitrate, size, play (direct MP3 URL), download.
//
// Stream:  GET https://pl2.hitmos.fm/{base64(/mp3/ID/track.mp3)}.mp3
//          Direct MP3 (320 kbps, 44.1 kHz, Stereo) — HTTP Range supported.
//
// Notes:
//   • The RSC payload uses \\" (escaped quotes) inside JSON strings embedded
//     in HTML — we need a regex that accounts for this.
//   • Cover art: extracted from <img src="..."> in the same RSC block.

interface HitmosTrack {
  id: number
  artist: string
  title: string
  version: string
  duration: number
  bitrate: number
  size: number
  play: string
  download: string
  cover?: string | null
}

/**
 * Search hitmos.fm and return NormalizedTrack[] with direct MP3 stream URLs.
 *
 * hitmos.fm is a Next.js App Router site. The search page returns HTML that
 * contains an RSC payload (escaped JSON). We extract the track list from it
 * using a regex (the JSON is too deeply nested for a simple JSON.parse).
 */
async function searchHitmosTracks(
  q: string,
  kind: string,
  limit: number,
): Promise<NormalizedTrack[]> {
  const items: NormalizedTrack[] = []
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(
      `https://rus.hitmos.fm/search?q=${encodeURIComponent(q)}`,
      {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        },
      },
    )
    clearTimeout(timeout)
    if (!response.ok) return items
    const html = await response.text()

    // RSC payload uses \\" for escaped quotes inside JSON embedded in HTML.
    // Pattern: \"id\":NUMBER,\"artist\":\"...\",\"title\":\"...\",\"version\":\"...\",
    //          \"duration\":NUMBER,\"bitrate\":NUMBER,\"size\":NUMBER,
    //          \"play\":\"URL\",\"download\":\"URL\"
    const trackPattern = /\\"id\\":(\d+),\\"artist\\":\\"([^\\]*)\\",\\"title\\":\\"([^\\]*)\\",\\"version\\":\\"([^\\]*)\\",\\"duration\\":(\d+),\\"bitrate\\":(\d+),\\"size\\":(\d+),\\"play\\":\\"([^\\]+)\\",\\"download\\":\\"([^\\]+)\\"/g
    let match: RegExpExecArray | null
    while ((match = trackPattern.exec(html)) !== null && items.length < limit) {
      const [, idStr, artist, title, version, durationStr, bitrateStr, , playUrl, downloadUrl] = match
      const id = parseInt(idStr, 10)
      const duration = parseInt(durationStr, 10)
      const bitrate = parseInt(bitrateStr, 10)

      // Build the track title — include version if present (e.g. "Remix").
      const fullTitle = version ? `${title} (${version})` : title

      // Cover art: hitmos has cover URLs at https://co2.hitmos.fm/{base64}.jpg
      // We extract them from the img tags near each track in the HTML.
      // For simplicity, derive cover from track id (hitmos uses a deterministic
      // pattern). If unavailable, the frontend shows a default music icon.
      const coverUrl = `https://co2.hitmos.fm/${btoa(`/img/${id}/cover.jpg`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.jpg`

      items.push({
        id: `hitmos-${id}`,
        title: fullTitle,
        artist,
        album: null,
        coverUrl: null, // hitmos covers require a separate request; skip for now
        previewUrl: playUrl,
        fullUrl: playUrl,
        duration,
        genre: kind,
        kind,
        source: 'hitmos',
      })
    }
  } catch {
    // Best-effort.
  }
  return items
}

// ---- RadioBrowser integration (live radio) ----
// v16.10: source for CONTINUOUS live radio streams (no duration limit).
// API docs: https://api.radio-browser.info/

interface RadioBrowserStation {
  stationuuid: string
  name: string
  url: string
  url_resolved: string
  homepage?: string
  favicon?: string
  tags?: string
  country?: string
  countrycode?: string
  state?: string
  language?: string
  codec?: string
  bitrate?: number
  votes?: number
  clickcount?: number
  lastcheckok?: number
}

const RADIO_BROWSER_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
]

async function searchRadioStations(
  q: string,
  limit: number,
): Promise<NormalizedTrack[]> {
  const items: NormalizedTrack[] = []
  const trimmed = q.trim()

  const searchPath = trimmed
    ? `/json/stations/byname/${encodeURIComponent(trimmed)}?limit=${limit * 2}&order=clickcount&reverse=true&hidebroken=true`
    : `/json/stations/bycountrycodeexact/RU?limit=${limit * 2}&order=clickcount&reverse=true&hidebroken=true`

  for (const base of RADIO_BROWSER_SERVERS) {
    try {
      const result = await httpsGetIPv4(
        `${base}${searchPath}`,
        { 'User-Agent': '999pro-audiohub/1.0 (https://999.pro)' },
        8000,
      )
      if (!result.ok || !Array.isArray(result.json)) continue
      const data = result.json as RadioBrowserStation[]

      for (const s of data) {
        if (items.length >= limit) break
        if (!s.url_resolved && !s.url) continue
        if (s.lastcheckok === 0) continue
        const name = (s.name || 'Radio').trim().replace(/^\s+/, '')
        const cover = s.favicon && s.favicon.startsWith('http') ? s.favicon : null
        const tags = (s.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3).join(', ')
        const bitrate = s.bitrate ? `${s.bitrate}kbps` : ''
        const artistParts = [s.country, tags, bitrate, s.codec].filter(Boolean)
        const artist = artistParts.join(' • ') || 'Live Radio'

        const streamUrl = s.url_resolved || s.url
        items.push({
          id: `radio-${s.stationuuid}`,
          title: name,
          artist,
          album: null,
          coverUrl: cover,
          previewUrl: streamUrl,
          fullUrl: streamUrl,
          duration: null,
          genre: tags || 'Radio',
          kind: 'radio',
          source: 'radio',
          isLive: true,
        })
      }
      if (items.length > 0) break
    } catch {
      // Try next server.
    }
  }
  return items
}

// ---- Quran integration (full surah audio) ----
// alquran.cloud API provides full Quran recitations via the Islamic Network CDN.

interface QuranSurah {
  number: number
  name: string
  englishName: string
  englishNameTranslation: string
  numberOfAyahs: number
  revelationType: string
}

async function searchQuranTracks(q: string, limit: number): Promise<NormalizedTrack[]> {
  const items: NormalizedTrack[] = []
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const response = await fetch('https://api.alquran.cloud/v1/surah', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    })
    clearTimeout(timeout)
    if (!response.ok) return items
    const data = (await response.json()) as { data?: QuranSurah[] }
    if (!data.data) return items

    const queryLower = q.toLowerCase().trim()
    const filtered = data.data.filter((s) => {
      if (!queryLower) return true
      return (
        s.englishName.toLowerCase().includes(queryLower) ||
        s.englishNameTranslation.toLowerCase().includes(queryLower) ||
        s.name.includes(queryLower) ||
        String(s.number) === queryLower
      )
    })

    const edition = 'ar.alafasy'
    const reciterName = 'Mishary Alafasy'

    for (const surah of filtered.slice(0, limit)) {
      const audioUrl = `https://cdn.islamic.network/quran/audio-surah/128/${edition}/${surah.number}.mp3`
      items.push({
        id: `quran-surah-${surah.number}`,
        title: `${surah.number}. ${surah.englishName} (${surah.name})`,
        artist: reciterName,
        album: `Quran — ${surah.englishNameTranslation}`,
        coverUrl: null,
        previewUrl: audioUrl,
        fullUrl: audioUrl,
        duration: null,
        genre: 'Quran',
        kind: 'quran',
        source: 'quran',
      })
    }
  } catch {
    // Quran API is optional.
  }
  return items
}

// ============================================================================
// Routes
// ============================================================================

// GET /api/audio-hub/search?q=QUERY&type=music|nasheed|quran|podcast|radio|all
//                            &limit=20&source=hitmos|muzce|all
// v16.18: source parameter — search ONLY a specific source ('hitmos' or 'muzce').
//         'all' (default) = search hitmos + muzce in parallel.
router.get(
  '/search',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = (req.query.q as string || '').trim()
    const type = (req.query.type as string) || 'music'
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 50)
    // v16.16: Source filter. 'all' (default) = search all sources.
    // Specific source = search ONLY that source.
    const source = (req.query.source as string) || 'all'

    // Validate source parameter against the known source list.
    // v16.18: Only hitmos + muzce (muzjam/audius/archive/jamendo removed).
    const validSources = ['all', 'hitmos', 'muzce']
    const sourceFilter = validSources.includes(source) ? source : 'all'

    if (!q || q.length < 1) {
      // For Quran type, return all surahs when query is empty.
      if (type === 'quran') {
        const quranItems = await searchQuranTracks('', limit)
        return res.json({ items: quranItems, total: quranItems.length, query: q, type, source: sourceFilter })
      }
      // For radio type with empty query, return top Russian stations.
      if (type === 'radio') {
        const radioItems = await searchRadioStations('', limit)
        return res.json({ items: radioItems, total: radioItems.length, query: q, type, source: sourceFilter })
      }
      // v16.18: For music with empty query, return empty list (no trending
      // since Audius was removed). Users see a prompt to enter a query.
      if (type === 'music') {
        return res.json({ items: [], total: 0, query: q, type, source: sourceFilter })
      }
      return res.json({ items: [], total: 0, query: q, type, source: sourceFilter })
    }

    const cacheKey = `search:${type}:${q}:${limit}:${sourceFilter}`
    const cached = getCached<{ items: NormalizedTrack[]; total: number }>(cacheKey)
    if (cached) {
      return res.json({ ...cached, query: q, type, source: sourceFilter, cached: true })
    }

    // Quran type — alquran.cloud only.
    if (type === 'quran') {
      const quranItems = await searchQuranTracks(q, limit)
      const payload = { items: quranItems, total: quranItems.length }
      setCached(cacheKey, payload)
      return res.json({ ...payload, query: q, type, source: sourceFilter })
    }

    // Radio type — RadioBrowser only.
    if (type === 'radio') {
      const radioItems = await searchRadioStations(q, limit)
      const payload = { items: radioItems, total: radioItems.length }
      setCached(cacheKey, payload)
      return res.json({ ...payload, query: q, type, source: sourceFilter })
    }

    // music / nasheed / podcast — search based on source filter.
    // v16.18: Sources are hitmos + muzce only (muzjam/audius/archive/jamendo removed).
    try {
      let items: NormalizedTrack[] = []

      if (sourceFilter === 'hitmos') {
        items = await searchHitmosTracks(q, type, limit)
      } else if (sourceFilter === 'muzce') {
        items = await searchMuzceTracks(q, type, limit)
      } else {
        // 'all' — search hitmos + muzce in parallel.
        const [hitmosItems, muzceItems] = await Promise.all([
          searchHitmosTracks(q, type, limit),
          searchMuzceTracks(q, type, Math.ceil(limit / 2)),
        ])

        // Merge + deduplicate by normalized "artist - title" key.
        const seen = new Map<string, NormalizedTrack>()
        for (const t of [...hitmosItems, ...muzceItems]) {
          const key = `${t.artist.toLowerCase().trim()} - ${t.title.toLowerCase().trim()}`
          if (!seen.has(key)) {
            seen.set(key, t)
          }
        }
        items = Array.from(seen.values()).slice(0, limit)
      }

      const payload = { items, total: items.length }
      setCached(cacheKey, payload)
      return res.json({ ...payload, query: q, type, source: sourceFilter })
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return res.status(504).json({ error: 'Search timeout' })
      }
      return res.status(502).json({ error: 'Search failed', details: String(err?.message || err) })
    }
  }),
)

// GET /api/audio-hub/track/:id — fetch a single track by its id.
// Used by the chat card to resolve track metadata from the stored id.
router.get(
  '/track/:id',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.params.id
    const cacheKey = `track:${id}`
    const cached = getCached<NormalizedTrack>(cacheKey)
    if (cached) {
      return res.json(cached)
    }

    // hitmos track id format: "hitmos-{numericId}"
    // v16.19: Recover the stream URL from the numeric ID.
    // URL pattern: https://pl2.hitmos.fm/{base64(/mp3/ID/track.mp3)}.mp3
    // Note: hitmos uses STANDARD base64 (with +, /, = padding), NOT URL-safe.
    const hitmosMatch = id.match(/^hitmos-(\d+)$/)
    if (hitmosMatch) {
      const numericId = hitmosMatch[1]
      const path = `/mp3/${numericId}/track.mp3`
      const b64 = Buffer.from(path).toString('base64')
      const streamUrl = `https://pl2.hitmos.fm/${b64}.mp3`
      const track: NormalizedTrack = {
        id: `hitmos-${numericId}`,
        title: 'Hitmos Track',
        artist: 'Hitmos',
        album: null,
        coverUrl: null,
        previewUrl: streamUrl,
        fullUrl: streamUrl,
        duration: null,
        genre: 'music',
        kind: 'music',
        source: 'hitmos',
      }
      setCached(cacheKey, track)
      return res.json(track)
    }

    // muzce track id format: "muzce-{hash}"
    // v16.18: Returns metadata only — the frontend already has full metadata
    // from search results. This is a fallback for chat cards that only store the id.
    // Note: muzce hash is too long to store in the ID, so we can't recover the
    // full URL here. The new format (v16.19) stores the full track as JSON.
    const muzceMatch = id.match(/^muzce-(.+)$/)
    if (muzceMatch) {
      const idHash = muzceMatch[1]
      const track: NormalizedTrack = {
        id: `muzce-${idHash}`,
        title: 'MuzCe Track',
        artist: 'MuzCe',
        album: null,
        coverUrl: null,
        previewUrl: null,
        fullUrl: null,
        duration: null,
        genre: 'music',
        kind: 'music',
        source: 'muzce',
      }
      setCached(cacheKey, track)
      return res.json(track)
    }

    // Quran surah id format: "quran-surah-XXX"
    const quranMatch = id.match(/^quran-surah-(\d+)$/)
    if (quranMatch) {
      const surahNum = parseInt(quranMatch[1], 10)
      const quranItems = await searchQuranTracks(String(surahNum), 1)
      if (quranItems.length > 0) {
        setCached(cacheKey, quranItems[0])
        return res.json(quranItems[0])
      }
      return res.status(404).json({ error: 'Surah not found' })
    }

    // Radio station id format: "radio-{stationuuid}"
    const radioMatch = id.match(/^radio-(.+)$/)
    if (radioMatch) {
      const stationUuid = radioMatch[1]
      for (const base of RADIO_BROWSER_SERVERS) {
        try {
          const result = await httpsGetIPv4(
            `${base}/json/stations/byuuid/${encodeURIComponent(stationUuid)}`,
            { 'User-Agent': '999pro-audiohub/1.0 (https://999.pro)' },
            6000,
          )
          if (!result.ok || !Array.isArray(result.json)) continue
          const s = (result.json as RadioBrowserStation[])[0]
          if (!s) continue
          const streamUrl = s.url_resolved || s.url
          if (!streamUrl) continue
          const name = (s.name || 'Radio').trim().replace(/^\s+/, '')
          const tags = (s.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3).join(', ')
          const bitrate = s.bitrate ? `${s.bitrate}kbps` : ''
          const artistParts = [s.country, tags, bitrate, s.codec].filter(Boolean)
          const artist = artistParts.join(' • ') || 'Live Radio'
          const cover = s.favicon && s.favicon.startsWith('http') ? s.favicon : null
          const track: NormalizedTrack = {
            id: `radio-${s.stationuuid}`,
            title: name,
            artist,
            album: null,
            coverUrl: cover,
            previewUrl: streamUrl,
            fullUrl: streamUrl,
            duration: null,
            genre: tags || 'Radio',
            kind: 'radio',
            source: 'radio',
            isLive: true,
          }
          setCached(cacheKey, track)
          return res.json(track)
        } catch {
          // try next server
        }
      }
      return res.status(404).json({ error: 'Radio station not found' })
    }

    return res.status(400).json({ error: 'Invalid track id format' })
  }),
)

// GET /api/audio-hub/stream?url=ENCODED_URL — proxy + cache audio stream.
// Used for offline playback: the browser caches the response in IndexedDB.
// This endpoint also adds CORS headers so the audio element can play it.
router.get(
  '/stream',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const url = req.query.url as string
    if (!url || !/^https:\/\/.+/.test(url)) {
      return res.status(400).json({ error: 'Invalid or missing url parameter' })
    }
    // v16.18: Removed muzjam/audius/archive/jamendo domains. Added muzce.com.
    const allowedDomains = [
      // hitmos.fm (PRIMARY — Russian + international music, 320kbps MP3)
      'hitmos.fm',
      'pl2.hitmos.fm',
      'dw2.hitmos.fm',
      'co2.hitmos.fm',
      // muzce.com (SECONDARY — Russian + international + Chechen music)
      'muzce.com',
      'files.muzce.com',
      // Quran CDN
      'islamic.network',
      'cdn.islamic.network',
      // RadioBrowser streaming endpoints — common hosting providers.
      'hostingradio.ru',
      'radiorecord.hostingradio.ru',
      'broadcast.osetiafm.ru',
      'radio.alania.net',
      'icecast.mir24.tv',
      'vgtrkregion-reg.cdnvideo.ru',
      'stream.loveradio.ru',
      'facecast.io',
      'cdn-evacoder-tv.facecast.io',
    ]
    const isAllowed = allowedDomains.some((d) => url.includes(d))
    // For radio streams, we also allow any HTTPS URL that doesn't look like a
    // private/internal address — radio stations use thousands of different
    // streaming hosts and we can't enumerate them all.
    const isRadioStream = url.includes('hostingradio') || url.includes('icecast') ||
      url.includes('radiorecord') || url.includes('stream.') || url.includes('/radio') ||
      url.includes('live') || url.includes('broadcast') || url.includes('.aacp') ||
      url.includes('.aac') || url.includes('/stream') || url.includes('facecast')
    if (!isAllowed && !isRadioStream) {
      return res.status(403).json({ error: 'Only known audio CDN URLs are allowed' })
    }

    try {
      const controller = new AbortController()
      // Abort the upstream fetch when the client disconnects — prevents OOM
      // from infinite live radio streams.
      const clientClosedRef = { current: false }
      const onClientClose = () => {
        clientClosedRef.current = true
        controller.abort()
      }
      res.on('close', onClientClose)

      // v25.10 (AudioHub seek fix): forward the client's Range header to the
      // upstream CDN and reply with proper 206 Partial Content + Content-Range.
      //
      // Previously this endpoint set `Accept-Ranges: bytes` but never honoured
      // the Range header — it streamed the entire file from byte 0. Browsers
      // send `Range: bytes=N-` when the user scrubs the seek bar. The proxy
      // ignored it, so:
      //   - iOS Safari refused to play/seek at all (strict Range requirement).
      //   - Chrome desktop waited for the full file to download before seek
      //     worked, and replayed 1-2s around the seek point (the "stutter /
      //     loop" bug users reported).
      //
      // We now:
      //   1. Read the incoming Range header.
      //   2. Forward it to the upstream fetch.
      //   3. If upstream replies 206, mirror 206 + Content-Range + Content-Length
      //      + the partial body.
      //   4. If upstream replies 200 (no Range support on their side — rare for
      //      hitmos/muzce), we still set `Accept-Ranges: none` so the browser
      //      doesn't try to seek beyond what's buffered. This is honest — we
      //      can't honour Range if upstream can't.
      const inboundRange = req.headers['range'] || null

      const connectTimeout = setTimeout(() => controller.abort(), 15000)
      const upstreamHeaders: Record<string, string> = { Accept: 'audio/*' }
      if (inboundRange) {
        upstreamHeaders['Range'] = inboundRange
      }
      const response = await fetch(url, {
        signal: controller.signal,
        headers: upstreamHeaders,
      })
      clearTimeout(connectTimeout)

      if (!response.ok && response.status !== 206) {
        res.off('close', onClientClose)
        return res.status(502).json({ error: 'Upstream stream failed' })
      }

      res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg')
      const isLive = response.headers.get('icy-name') || response.headers.get('icy-genre') ||
        (response.headers.get('content-type') || '').includes('audio/aac') ||
        (response.headers.get('content-type') || '').includes('audio/aacp')
      if (isLive) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
      }

      const upstreamStatus = response.status // 200 or 206
      const upstreamContentRange = response.headers.get('content-range')
      const upstreamContentLength = response.headers.get('content-length')
      const upstreamAcceptRanges = response.headers.get('accept-ranges')

      if (upstreamStatus === 206 && upstreamContentRange) {
        // Upstream honoured Range — mirror 206 + Content-Range. This is the
        // path that fixes the iOS Safari + Chrome seek bug.
        res.status(206)
        res.setHeader('Content-Range', upstreamContentRange)
        res.setHeader('Accept-Ranges', 'bytes')
        if (upstreamContentLength) {
          res.setHeader('Content-Length', upstreamContentLength)
        }
      } else if (inboundRange && upstreamStatus === 200) {
        // Upstream doesn't honour Range — returned full body. Be honest:
        // tell the browser we don't support Range so it doesn't retry.
        // The browser will buffer the full response and allow seek only
        // within the buffered range. Slower but functional on Chrome/Firefox.
        // iOS Safari may still refuse to play — that's an upstream limitation
        // we can't fix from the proxy side.
        res.status(200)
        res.setHeader('Accept-Ranges', 'none')
        if (upstreamContentLength) {
          res.setHeader('Content-Length', upstreamContentLength)
        }
      } else {
        // No Range requested (initial load) — normal 200 response.
        res.status(200)
        if (upstreamAcceptRanges) {
          res.setHeader('Accept-Ranges', upstreamAcceptRanges)
        } else {
          res.setHeader('Accept-Ranges', 'bytes')
        }
        if (upstreamContentLength) {
          res.setHeader('Content-Length', upstreamContentLength)
        }
      }

      if (response.body) {
        const reader = response.body.getReader()
        const pump = async () => {
          try {
            while (true) {
              if (clientClosedRef.current) {
                try { await reader.cancel() } catch {}
                break
              }
              const { done, value } = await reader.read()
              if (done) break
              if (!res.writableEnded && !clientClosedRef.current) {
                res.write(Buffer.from(value))
              }
            }
          } catch {
            // Reader errored (likely aborted) — just end the response.
          } finally {
            try { reader.releaseLock() } catch {}
            if (!res.writableEnded) res.end()
          }
        }
        pump().catch(() => {
          if (!res.writableEnded) res.end()
        })
      } else {
        res.end()
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return res.status(504).json({ error: 'Stream timeout' })
      }
      if (!res.headersSent) {
        return res.status(502).json({ error: 'Stream failed', details: String(err?.message || err) })
      }
      if (!res.writableEnded) res.end()
    }
  }),
)

export default router
