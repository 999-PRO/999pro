import { Router } from 'express'
import { LRUCache } from 'lru-cache'
import { asyncHandler } from '../lib/asyncHandler.js'
import { optionalAuth, type AuthedRequest } from '../lib/auth.js'

// ============================================================================
// Video Hub — backend proxy for searching & streaming films (v17.1)
// ----------------------------------------------------------------------------
// Полностью переработано: ранее использовались 3 DLE-сайта + iframe-плееры
// сторонних сервисов. Теперь:
//
//   • 2 источника: lordserial.fail, lord.bz — оба DLE CMS
//   • Поиск: POST / do=search&subaction=search&story=QUERY
//   • Страница фильма: парсим HTML, извлекаем ВСЕ iframe-URL плееров
//   • Для каждого плеера пытаемся извлечь прямой поток m3u8/MP4 через
//     server-side scraping плеер-страницы (kodikplayer, tuser, videocdn, etc.)
//   • Если извлечение удалось — фронтенд играет в собственном HTML5 плеере
//   • Если не удалось — возвращаем iframe URL как fallback (но фронтенд
//     НЕ показывает сайт: пытается через другой плеер или показывает ошибку)
//
// Никаких iframe в сторону пользователя. Все видео воспроизводятся в нашем
// собственном HTML5 плеере через прямые m3u8/MP4 URL.
// ============================================================================

const router = Router()

// ---- In-memory LRU cache (10 min TTL, bounded) ----
// P1-10 fix: replaced manual FIFO eviction with lru-cache for proper LRU.
const CACHE_TTL = 10 * 60 * 1000
const cache = new LRUCache<string, { data: any; expires: number }>({ max: 200 })

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
export interface FilmSource {
  id: string
  name: string
  emoji: string
}

export interface FilmSearchResult {
  id: string                 // composite: `${sourceId}:${slug}`
  sourceId: string
  sourceName: string
  title: string
  year: number | null
  description: string
  posterUrl: string | null
  url: string                // canonical URL on the source site
  isSeries: boolean
}

export interface FilmPlayerOption {
  id: string                 // hash of url
  name: string               // "Kodik" | "Tuser" | "Alloha" | etc.
  quality: string            // "720p" | "1080p" | "auto" | ""
  translation: string        // "Дубляж" | "LostFilm" | "" etc.
  streamUrl: string | null   // direct m3u8/MP4 URL (null if extraction failed)
  iframeUrl: string          // original iframe URL (kept for diagnostics)
  extractorType: 'hls' | 'mp4' | 'iframe'  // what kind of stream is streamUrl
}

export interface FilmEpisode {
  id: string
  season: number
  episode: number
  title: string
  url: string                // episode page URL on the source site
  players: FilmPlayerOption[]
}

export interface FilmDetails {
  id: string
  sourceId: string
  sourceName: string
  title: string
  year: number | null
  description: string
  posterUrl: string | null
  isSeries: boolean
  url: string
  players: FilmPlayerOption[]      // direct players (for non-series films)
  episodes: FilmEpisode[]          // for series
  seasons: number[]
  translations: string[]           // unique translations across all episodes/players
  qualities: string[]              // unique qualities
}

// ---- Sources config ----
const SOURCES: Array<{
  id: string
  name: string
  emoji: string
  baseUrl: string
  searchPath: string
  /** Internal display name (user-facing). Real site name is hidden. */
  displayName: string
}> = [
  { id: 'lordser',   name: 'lordser',   displayName: 'Источник A', emoji: '🎬', baseUrl: 'https://td3.lordserial.fail', searchPath: '/' },
  { id: 'lordbz',    name: 'lordbz',    displayName: 'Источник B', emoji: '🍿', baseUrl: 'https://lord.bz',             searchPath: '/' },
  { id: 'turkru',    name: 'turkru',    displayName: 'Турецкие сериалы', emoji: '🇹🇷', baseUrl: 'https://www.turkru-tv91.com', searchPath: '/' },
  { id: 'tvturkru',  name: 'tvturkru',  displayName: 'Турецкие сериалы 2', emoji: '🇹🇷', baseUrl: 'https://www.tv-turkru6.info', searchPath: '/' },
]

// ---- Player domain mapping (priority order) ----
const PLAYER_DOMAINS: Array<{ pattern: string; name: string }> = [
  { pattern: 'kodikplayer.com',   name: 'Kodik' },
  { pattern: 'kodikapi.com',      name: 'Kodik' },
  { pattern: 'tuser.online',      name: 'Tuser' },
  { pattern: 'videocdn.tv',       name: 'VideoCDN' },
  { pattern: 'videoapi.myvi.ru',  name: 'Myvi' },
  { pattern: 'hdgo.cc',           name: 'HDGo' },
  { pattern: 'hdvb.online',       name: 'HDVB' },
  { pattern: 'voidboost.cc',      name: 'VoidBoost' },
  { pattern: 'alloha.tv',         name: 'Alloha' },
  { pattern: 'newplayjj.com',     name: 'NewPlay' },
  { pattern: 'hdplex',            name: 'HDPlex' },
  { pattern: 'ortified.ws',       name: 'Ortified' },
  { pattern: 'cdnvideohub.com',   name: 'CDNVideoHub' },
  { pattern: 'interkh.com',       name: 'Interkh' },
  { pattern: 'stloadi.live',      name: 'Stloadi' },
  { pattern: 'radit-as',          name: 'RaditAs' },
  { pattern: 'militorys.net',     name: 'Militorys' },
  { pattern: 'vibio.tv',          name: 'Vibio' },
  { pattern: 'dlcache',           name: 'Dlcache' },
]

// ---- Helpers ----

function timeoutFetch(url: string, options: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, {
    ...options,
    signal: ctrl.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      ...(options.headers || {}),
    },
  }).finally(() => clearTimeout(t))
}

function cleanHtml(s: string): string {
  return s
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function extractYear(s: string): number | null {
  const m = s.match(/\b(19\d{2}|20[0-3]\d)\b/)
  if (m) {
    const y = parseInt(m[1], 10)
    if (y > 1880 && y < 2100) return y
  }
  return null
}

function hashUrl(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) - h) + url.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

function absolutize(url: string, base: string): string {
  if (!url) return url
  if (url.startsWith('//')) return 'https:' + url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return new URL(url, base).toString()
  try {
    return new URL(url, base).toString()
  } catch {
    return url
  }
}

function identifyPlayer(iframeUrl: string): { name: string; quality: string; translation: string } {
  const lower = iframeUrl.toLowerCase()
  let name = 'Плеер'
  for (const d of PLAYER_DOMAINS) {
    if (lower.includes(d.pattern)) {
      name = d.name
      break
    }
  }
  // Quality detection
  let quality = 'auto'
  const qm = iframeUrl.match(/(\d{3,4})p?/i)
  if (qm) {
    const h = parseInt(qm[1], 10)
    if (h >= 360 && h <= 2160) quality = `${h}p`
  }
  if (lower.includes('1080')) quality = '1080p'
  else if (lower.includes('720')) quality = '720p'
  else if (lower.includes('480')) quality = '480p'

  // Translation detection
  let translation = ''
  const trPatterns: Array<[RegExp, string]> = [
    [/lostfilm/i, 'LostFilm'],
    [/cubik|kube?/i, 'Кубик в кубе'],
    [/jaskier/i, 'Jaskier'],
    [/dub|дубляж/i, 'Дубляж'],
    [/sub|субтитр/i, 'Субтитры'],
    [/original|оригинал/i, 'Оригинал'],
    [/multi|мульти/i, 'Мульти'],
    [/ amateur|любитель/i, 'Любительский'],
  ]
  for (const [re, label] of trPatterns) {
    if (re.test(iframeUrl) || re.test(decodeURIComponent(iframeUrl))) {
      translation = label
      break
    }
  }
  return { name, quality, translation }
}

async function searchOnSource(
  source: typeof SOURCES[number],
  query: string
): Promise<FilmSearchResult[]> {

  // ---- DLE sites: POST form, parse HTML ----
  const searchUrl = source.baseUrl + source.searchPath
  const body = new URLSearchParams({
    do: 'search',
    subaction: 'search',
    story: query,
  }).toString()

  let html: string
  try {
    const res = await timeoutFetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': source.baseUrl + '/',
      },
      body,
    })
    if (!res.ok) return []
    html = await res.text()
  } catch {
    return []
  }

  // DLE sites wrap search results in <div id='dle-content'>...</div>.
  // Sidebar "Top of week", "Latest comments" etc. are OUTSIDE this block.
  // Restrict parsing to this block to avoid mixing sidebar recommendations
  // into search results (especially relevant for turkru, where an empty
  // search page still shows a "Top of the week" sidebar with 5 serials).
  const dleContentMatch = html.match(/<div[^>]*id=["']dle-content["'][^>]*>([\s\S]*?)(<\/div>\s*<div[^>]*class=["'][^"']*main|<\/main>)/i)
  const dleBlock = dleContentMatch ? dleContentMatch[1] : html

  const results: FilmSearchResult[] = []
  const seen = new Set<string>()

  // Match all internal links that look like DLE article URLs
  const linkRegex = /href=(["'])((?:https?:\/\/[^"']*)?\/(?:[\w-]+\/)?\d{1,5}-[\w-]+\.html)\1/gi
  let m: RegExpExecArray | null
  const candidates: Array<{ url: string; pos: number }> = []
  while ((m = linkRegex.exec(dleBlock)) !== null) {
    const url = absolutize(m[2], source.baseUrl)
    candidates.push({ url, pos: m.index })
  }

  for (const c of candidates) {
    if (seen.has(c.url)) continue
    seen.add(c.url)

    const start = Math.max(0, c.pos - 400)
    const end = Math.min(dleBlock.length, c.pos + 800)
    const context = dleBlock.slice(start, end)
    const escapedUrl = c.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Try to extract a tight <a ...>...</a> block — this is critical for sites where
    // search results are tightly nested (e.g. turkru: <a class="th-in" href=URL title=TITLE>...<img alt=TITLE src=POSTER>...</a>).
    // Without this, a wide context window may grab a poster from an adjacent card.
    let anchorBlock: string | null = null
    // Find the <a tag containing this href, then capture everything up to the matching </a>
    const anchorStartMatch = context.match(new RegExp(`(<a\\b[^>]*href=["'][^"']*${escapedUrl}["'][^>]*>)`, 'i'))
    if (anchorStartMatch) {
      const anchorStartIdx = context.indexOf(anchorStartMatch[1])
      const afterStart = anchorStartIdx + anchorStartMatch[1].length
      const closeIdx = context.indexOf('</a>', afterStart)
      if (closeIdx !== -1) {
        anchorBlock = context.slice(anchorStartIdx, closeIdx + 4)
      }
    }
    const block = anchorBlock || context

    // Title — try multiple patterns in priority order
    let title = ''
    // Pattern 1: <a href="URL" ... title="Title">
    const titleAttrMatch = block.match(new RegExp(`href=["'][^"']*${escapedUrl}["'][^>]*title=["']([^"']+)["']`, 'i'))
                   || context.match(new RegExp(`href=["'][^"']*${escapedUrl}["'][^>]*title=["']([^"']+)["']`, 'i'))
    if (titleAttrMatch) {
      title = titleAttrMatch[1]
    }
    // Pattern 2: <img ... alt="Title"> inside the anchor block (preferred, avoids leakage)
    if (!title) {
      const altMatch = block.match(/<img[^>]+alt=["']([^"']{2,100})["']/i)
      if (altMatch && altMatch[1] !== source.name) {
        title = altMatch[1]
      }
    }
    // Pattern 3: <a href="URL">Title</a>
    if (!title) {
      const titleTextMatch = block.match(new RegExp(`href=["'][^"']*${escapedUrl}["'][^>]*>([^<]+)<`, 'i'))
      if (titleTextMatch) {
        title = cleanHtml(titleTextMatch[1])
      }
    }
    // Pattern 4: <h2 class="th-title">Title</h2> or <div class="th-title">Title</div>
    if (!title) {
      const headingMatch = block.match(/<(?:h2|div|span)[^>]*class=["'][^"']*th-title[^"']*["'][^>]*>([^<]+)</i)
      if (headingMatch) {
        title = cleanHtml(headingMatch[1])
      }
    }
    // Pattern 5: <h2 class="title">Title</h2>
    if (!title) {
      const headingMatch = block.match(/<(?:h2|h3|div|span)[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]+)</i)
      if (headingMatch && headingMatch[1].trim().length > 2) {
        title = cleanHtml(headingMatch[1])
      }
    }
    if (!title) continue
    title = cleanHtml(title)
    if (title.length < 2 || title.length > 200) continue
    // Skip generic/site-wide titles
    if (/^(поиск|главная|поиск по сайту|поиск сериалов|сериалы онлайн|footer)/i.test(title)) continue

    // Poster — prefer img inside the anchor block; fall back to wider context
    let posterUrl: string | null = null
    const posterMatchBlock = block.match(/<img[^>]*(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i)
    if (posterMatchBlock) {
      posterUrl = absolutize(posterMatchBlock[1], source.baseUrl)
    } else {
      const posterMatch = context.match(/<img[^>]*(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i)
      if (posterMatch) {
        posterUrl = absolutize(posterMatch[1], source.baseUrl)
      }
    }

    // Description
    let description = ''
    const descMatch = block.match(/<p[^>]*>([^<]{40,300})<\/p>/i)
                   || context.match(/<p[^>]*>([^<]{40,300})<\/p>/i)
    if (descMatch) {
      description = cleanHtml(descMatch[1])
    }

    const year = extractYear(title) || extractYear(description) || extractYear(c.url)
    // turkru + tvturkru are Turkish-series-only sites — every article is a series.
    // For other sources, detect by keywords in title/url.
    const isSeries = (source.id === 'turkru' || source.id === 'tvturkru')
      ? true
      : /сезон|сери[яю]|seriya|sezon|serial|bölüm|bolum/i.test(title + ' ' + c.url)

    const slug = c.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.html$/, '')
    const id = `${source.id}:${slug}`

    results.push({
      id,
      sourceId: source.id,
      sourceName: source.displayName,
      title,
      year,
      description,
      posterUrl,
      url: c.url,
      isSeries,
    })
  }

  return results
}

// ============================================================================
// Browse (catalog without search) — v18
// ----------------------------------------------------------------------------
// Парсит главную страницу или страницу категории источника, извлекает
// карточки фильмов с постерами. Используется для показа красивого каталога
// в Video Hub без необходимости вводить поисковый запрос.
// ============================================================================

/**
 * Универсальный парсер карточек фильмов из HTML страницы источника.
 * Работает для всех 4 DLE-источников: lordser, lordbz, turkru, tvturkru.
 *
 * Ищет все ссылки вида /1234-slug.html, для каждой извлекает:
 *   - title (из <a title>, <img alt>, <div class="th-title">, текста ссылки)
 *   - posterUrl (из ближайшего <img src> или <img data-src>)
 *   - year (из текста, из <div class="th-year">(YYYY)</div>, из URL)
 *   - isSeries (по источнику или по ключевым словам в title/url)
 *
 * @param html   — полный HTML страницы
 * @param source — конфигурация источника
 * @param max    — максимальное количество результатов (по умолчанию 12)
 */
function parseFilmCardsFromHtml(
  html: string,
  source: typeof SOURCES[number],
  max: number = 12
): FilmSearchResult[] {
  const results: FilmSearchResult[] = []
  const seen = new Set<string>()

  // Тот же паттерн, что в searchOnSource — ищем все DLE-article-ссылки
  const linkRegex = /href=(["'])((?:https?:\/\/[^"']*)?\/(?:[\w-]+\/)?\d{1,5}-[\w-]+\.html)\1/gi
  let m: RegExpExecArray | null
  const candidates: Array<{ url: string; pos: number }> = []
  while ((m = linkRegex.exec(html)) !== null) {
    const url = absolutize(m[2], source.baseUrl)
    // Skip non-article URLs (e.g. /page/1-something.html that are pagination)
    candidates.push({ url, pos: m.index })
  }

  for (const c of candidates) {
    if (results.length >= max) break
    if (seen.has(c.url)) continue
    seen.add(c.url)

    // Для browse берём более широкий контекст — карточки на главной
    // часто имеют структуру <div class="th-item">...<a>...</a>...</div>
    // с постером ВНУТРИ или Вне <a>. Берём 800 символов до и 1200 после.
    const start = Math.max(0, c.pos - 800)
    const end = Math.min(html.length, c.pos + 1200)
    const context = html.slice(start, end)
    const escapedUrl = c.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Пытаемся извлечь плотный блок <a ...>...</a>
    let anchorBlock: string | null = null
    const anchorStartMatch = context.match(new RegExp(`(<a\\b[^>]*href=["'][^"']*${escapedUrl}["'][^>]*>)`, 'i'))
    if (anchorStartMatch) {
      const anchorStartIdx = context.indexOf(anchorStartMatch[1])
      const afterStart = anchorStartIdx + anchorStartMatch[1].length
      const closeIdx = context.indexOf('</a>', afterStart)
      if (closeIdx !== -1) {
        anchorBlock = context.slice(anchorStartIdx, closeIdx + 4)
      }
    }
    // Для browse пытаемся найти РОДИТЕЛЬСКИЙ item-блок, который СОДЕРЖИТ данный URL.
    // Это критично для lord.bz (постер и заголовок в разных sibling-дивах) и
    // для turkru (несколько popular-item подряд — нужно выбрать именно тот,
    // который содержит текущий URL, иначе возьмётся чужой заголовок/постер).
    let itemBlock: string | null = null
    // Шаг 1: найти позицию URL в context
    const urlPosInCtx = context.indexOf(c.url)
    if (urlPosInCtx >= 0) {
      // Шаг 2: пройти назад и найти ближайший открывающий <div class="...item...">
      // Поддерживаем: th-item (lordser), item / item expand-link (lord.bz),
      // popular-item (turkru), item__wrap (универсальный)
      const beforeUrl = context.slice(0, urlPosInCtx)
      const itemOpenRegex = /<div\b[^>]*class=["']([^"']*)["'][^>]*>/gi
      let lastItemOpen: { idx: number; fullMatch: string; cls: string } | null = null
      let im: RegExpExecArray | null
      while ((im = itemOpenRegex.exec(beforeUrl)) !== null) {
        const cls = im[1]
        // Match: th-item, popular-item, item__wrap, OR plain "item" (with space or quote boundary)
        if (/\b(th-item|popular-item|item__wrap)\b/.test(cls) ||
            /^item(\s|$)/.test(cls) ||
            /\sitem(\s|$)/.test(cls)) {
          lastItemOpen = { idx: im.index, fullMatch: im[0], cls }
        }
      }
      if (lastItemOpen) {
        // Шаг 3: от позиции lastItemOpen найти соответствующий </div> через depth-counter
        const slice = context.slice(lastItemOpen.idx, lastItemOpen.idx + 3000)
        let depth = 0
        let endIdx = -1
        const divRe = /<\/?div\b[^>]*>/gi
        let dm: RegExpExecArray | null
        while ((dm = divRe.exec(slice)) !== null) {
          if (dm[0].startsWith('</')) depth--
          else depth++
          if (depth === 0) { endIdx = dm.index + dm[0].length; break }
        }
        if (endIdx > 0) {
          const candidate = slice.slice(0, endIdx)
          // Шаг 4: проверить, что блок ДЕЙСТВИТЕЛЬНО содержит наш URL
          // (иначе мы захватили чужой item-блок)
          if (candidate.includes(c.url)) {
            itemBlock = candidate
          }
        }
      }
    }
    const block = itemBlock || anchorBlock || context

    // Title — приоритеты:
    // 1. <div class="th-title">TITLE</div> (lordserial)
    // 2. <a class="item__title" href="URL">TITLE</a> (lord.bz)
    // 3. <div class="popular-item-title">TITLE</div> (turkru)
    // 4. <a href="URL" title="TITLE">
    // 5. <img alt="TITLE">
    // 6. Текст внутри <a href="URL">TITLE</a>
    let title = ''
    const thTitleMatch = block.match(/<(?:div|span|h2|h3)[^>]*class=["'][^"']*th-title[^"']*["'][^>]*>([^<]+)</i)
    if (thTitleMatch) title = cleanHtml(thTitleMatch[1])
    if (!title) {
      const itemTitleMatch = block.match(/<a[^>]*class=["'][^"']*item__title[^"']*["'][^>]*>([^<]+)</i)
      if (itemTitleMatch) title = cleanHtml(itemTitleMatch[1])
    }
    if (!title) {
      const popularTitleMatch = block.match(/<(?:div|span)[^>]*class=["'][^"']*popular-item-title[^"']*["'][^>]*>([^<]+)</i)
      if (popularTitleMatch) title = cleanHtml(popularTitleMatch[1])
    }
    if (!title) {
      const titleAttrMatch = block.match(new RegExp(`href=["'][^"']*${escapedUrl}["'][^>]*title=["']([^"']+)["']`, 'i'))
                   || context.match(new RegExp(`href=["'][^"']*${escapedUrl}["'][^>]*title=["']([^"']+)["']`, 'i'))
      if (titleAttrMatch) title = titleAttrMatch[1]
    }
    if (!title) {
      const altMatch = block.match(/<img[^>]+alt=["']([^"']{2,100})["']/i)
      if (altMatch && altMatch[1] !== source.name) title = altMatch[1]
    }
    if (!title) {
      const titleTextMatch = block.match(new RegExp(`href=["'][^"']*${escapedUrl}["'][^>]*>([^<]+)<`, 'i'))
      if (titleTextMatch) title = cleanHtml(titleTextMatch[1])
    }
    if (!title) continue
    title = cleanHtml(title)
    if (title.length < 2 || title.length > 200) continue
    // Skip generic / nav titles
    if (/^(поиск|главная|поиск по сайту|поиск сериалов|сериалы онлайн|footer|новинки|популярное|все сериалы|зарубежные|турецкие|мультсериалы|аниме)/i.test(title)) continue

    // Poster — prefer img inside the item block
    let posterUrl: string | null = null
    const posterMatchBlock = block.match(/<img[^>]*(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i)
    if (posterMatchBlock) {
      posterUrl = absolutize(posterMatchBlock[1], source.baseUrl)
    } else {
      const posterMatch = context.match(/<img[^>]*(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i)
      if (posterMatch) {
        posterUrl = absolutize(posterMatch[1], source.baseUrl)
      }
    }

    // Year — приоритетно из <div class="th-year">(YYYY)</div>, иначе из текста/URL
    let year: number | null = null
    const thYearMatch = block.match(/class=["'][^"']*th-year[^"']*["'][^>]*>\s*\((\d{4})\)/i)
    if (thYearMatch) year = parseInt(thYearMatch[1], 10)
    if (!year || year < 1880 || year > 2100) {
      year = extractYear(title) || extractYear(c.url)
    }

    // Series detection
    const isSeries = (source.id === 'turkru' || source.id === 'tvturkru')
      ? true
      : /сезон|сери[яю]|seriya|sezon|serial|bölüm|bolum/i.test(title + ' ' + c.url)

    const slug = c.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.html$/, '')
    const id = `${source.id}:${slug}`

    results.push({
      id,
      sourceId: source.id,
      sourceName: source.displayName,
      title,
      year,
      description: '',  // No description in browse cards — keep UI clean
      posterUrl,
      url: c.url,
      isSeries,
    })
  }

  return results
}

/**
 * Загружает страницу (главную или категорию) источника и парсит карточки.
 */
async function browseSource(
  source: typeof SOURCES[number],
  pagePath: string = '/'
): Promise<FilmSearchResult[]> {
  const url = pagePath.startsWith('http') ? pagePath : (source.baseUrl + pagePath)
  let html: string
  try {
    const res = await timeoutFetch(url, {
      headers: { 'Referer': source.baseUrl + '/' },
    })
    if (!res.ok) {
      console.warn(`[browse] ${source.id} ${pagePath} → HTTP ${res.status}`)
      return []
    }
    html = await res.text()
  } catch (e: any) {
    console.warn(`[browse] ${source.id} ${pagePath} → ERROR: ${e?.message || e}`)
    return []
  }
  const films = parseFilmCardsFromHtml(html, source, 12)
  if (process.env.NODE_ENV !== 'production') console.debug(`[browse] ${source.id} ${pagePath} → ${films.length} films (html ${html.length}b)`)
  return films
}

// Конфигурация категорий каталога. Каждая категория — это набор источников
// + путей к страницам, с которых нужно собрать карточки.
interface BrowseCategoryConfig {
  id: string
  title: string
  emoji: string
  sources: Array<{ sourceId: string; path: string }>
  max: number  // максимум фильмов в категории
}

const BROWSE_CATEGORIES: BrowseCategoryConfig[] = [
  {
    id: 'news',
    title: 'Новинки',
    emoji: '🆕',
    sources: [
      { sourceId: 'lordser',  path: '/' },
      { sourceId: 'lordbz',   path: '/' },
    ],
    max: 16,
  },
  {
    id: 'foreign',
    title: 'Зарубежные сериалы',
    emoji: '🌍',
    sources: [
      { sourceId: 'lordser',  path: '/zarubezhnye-serialy/' },
      { sourceId: 'lordbz',   path: '/zarubezhnye/' },
    ],
    max: 16,
  },
  {
    id: 'turkish',
    title: 'Турецкие сериалы',
    emoji: '🇹🇷',
    sources: [
      { sourceId: 'turkru',   path: '/' },
      { sourceId: 'tvturkru', path: '/' },
      { sourceId: 'lordbz',   path: '/tureckie/' },
    ],
    max: 16,
  },
  {
    id: 'cartoons',
    title: 'Мультсериалы',
    emoji: '📺',
    sources: [
      { sourceId: 'lordser',  path: '/multserialy/' },
      { sourceId: 'lordbz',   path: '/multserialy/' },
    ],
    max: 16,
  },
]

// ---- Extract iframe URLs from a film page ----
async function extractPlayersFromPage(
  pageUrl: string,
  sourceBaseUrl: string
): Promise<Array<{ iframeUrl: string; context: string }>> {
  let html: string
  try {
    const res = await timeoutFetch(pageUrl, {
      headers: { 'Referer': sourceBaseUrl + '/' },
    })
    if (!res.ok) return []
    html = await res.text()
  } catch {
    return []
  }

  const players: Array<{ iframeUrl: string; context: string }> = []
  const seen = new Set<string>()

  // Match iframe src OR data-src attributes for known video player domains
  // v17.1: many DLE sites use lazy-loading iframes with data-src instead of src
  const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = iframeRegex.exec(html)) !== null) {
    const src = m[1]
    // Filter to known player domains OR any URL containing 'player'/'embed'/'video'/'api'
    const lower = src.toLowerCase()
    const isPlayer = PLAYER_DOMAINS.some(d => lower.includes(d.pattern)) ||
                     /player|embed|video|watch|api\.[a-z]+\.|\/movie\/|\/tv\//i.test(lower)
    if (!isPlayer) continue
    const abs = absolutize(src, sourceBaseUrl)
    if (seen.has(abs)) continue
    seen.add(abs)
    // Capture surrounding context (300 chars before)
    const ctxStart = Math.max(0, m.index - 300)
    const context = html.slice(ctxStart, m.index + 200)
    players.push({ iframeUrl: abs, context })
  }

  // v18: also detect <video-player> custom elements (cdnvideohub)
  const videoPlayerRegex = /<video-player[^>]+data-title-id=["'](\d+)["'][^>]*>/gi
  while ((m = videoPlayerRegex.exec(html)) !== null) {
    const titleId = m[1]
    const virtualUrl = `https://api.ortified.ws/embed/movie/${titleId}`
    if (seen.has(virtualUrl)) continue
    seen.add(virtualUrl)
    const ctxStart = Math.max(0, m.index - 300)
    const context = html.slice(ctxStart, m.index + 200)
    players.push({ iframeUrl: virtualUrl, context })
  }

  // Also look for video URLs in script tags (some sites embed them as JS vars)
  // e.g. var video = "https://..." or file: "https://..."
  const scriptVideoRegex = /(?:var\s+videoUrl|file|src|source|url)\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4|mkv|webm))["']/gi
  while ((m = scriptVideoRegex.exec(html)) !== null) {
    const abs = m[1]
    if (seen.has(abs)) continue
    seen.add(abs)
    players.push({ iframeUrl: abs, context: 'direct' })
  }

  // v17.1: also detect tab-style episode selectors with data-iframe-src or
  // data-player-src attributes (common on lord.bz, lordserial, etc.)
  const dataSrcRegex = /data-(?:iframe-src|player-src|video-src)=["']([^"']+)["']/gi
  while ((m = dataSrcRegex.exec(html)) !== null) {
    const src = m[1]
    const abs = absolutize(src, sourceBaseUrl)
    if (seen.has(abs)) continue
    seen.add(abs)
    const ctxStart = Math.max(0, m.index - 300)
    const context = html.slice(ctxStart, m.index + 200)
    players.push({ iframeUrl: abs, context })
  }

  return players
}

// ---- Try to extract direct stream URL from a player iframe page ----
// This is the core extraction logic. It tries multiple strategies:
// ---- Extract episodes from ortified.ws player page ----
// Ortified embeds contain a JSON structure with seasons and episodes.
// Each episode has direct `dash` (.mpd) and `hls` (.m3u8) stream URLs.
// We fetch the ortified page and parse the seasons/episodes JSON.
async function extractOrtifiedEpisodes(
  ortifiedMovieId: string,
  sourceBaseUrl: string
): Promise<FilmEpisode[]> {
  const ortifiedUrl = `https://api.ortified.ws/embed/movie/${ortifiedMovieId}`
  let html: string
  try {
    const res = await timeoutFetch(ortifiedUrl, {
      headers: { 'Referer': sourceBaseUrl + '/' },
    }, 12000)
    if (!res.ok) return []
    html = await res.text()
  } catch {
    return []
  }

  // The ortified page embeds JS data (NOT JSON) — keys may be unquoted:
  //   seasons:[{"season":1,"episodes":[{"episode":"1","hls":"...","dash":"..."},...]}, ...]
  // We need a custom parser because JSON.parse won't handle unquoted keys.
  // Strategy: find the "seasons" array, then use bracket-counting to extract
  // the complete array, then extract individual episode objects with regex.

  // Find the start of "seasons" array
  const seasonsStartMatch = html.match(/seasons?\s*:\s*(\[\s*\{)/)
  if (seasonsStartMatch) {
    const startIdx = seasonsStartMatch.index! + (seasonsStartMatch[0].length - seasonsStartMatch[1]!.length) // points to '['
    // Bracket-count to find the matching ']'.
    // We track BOTH [ ] and { } because episodes contain nested arrays
    // (e.g. audio.order:[0,1]) and nested objects. We only close when
    // the OUTER [ matches its ].
    let bracketDepth = 0
    let braceDepth = 0
    let endIdx = -1
    let inString = false
    let escape = false
    for (let i = startIdx; i < html.length; i++) {
      const ch = html[i]
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '[') bracketDepth++
      else if (ch === ']') {
        bracketDepth--
        if (bracketDepth === 0 && braceDepth === 0) { endIdx = i; break }
      }
      else if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }
    if (endIdx > startIdx) {
      const seasonsRaw = html.slice(startIdx, endIdx + 1)
      // The array looks like: [{"season":1,...,"episodes":[{ep1},{ep2},...]}, {"season":2,...}]
      // Strategy: find all "season":N occurrences, and for each, find the
      // following "episodes" array up to the next "season" occurrence.
      const episodes: Array<{season: number; episode: number; hls?: string; dash?: string}> = []

      // Find all season markers with their positions
      const seasonMarkers: Array<{num: number; pos: number}> = []
      const seasonRegex = /"season"?\s*:\s*(\d+)/g
      let sm: RegExpExecArray | null
      while ((sm = seasonRegex.exec(seasonsRaw)) !== null) {
        seasonMarkers.push({ num: parseInt(sm[1], 10), pos: sm.index })
      }

      // For each season, extract episodes between this season and the next
      for (let i = 0; i < seasonMarkers.length; i++) {
        const seasonNum = seasonMarkers[i].num
        const startPos = seasonMarkers[i].pos
        const endPos = i + 1 < seasonMarkers.length ? seasonMarkers[i + 1].pos : seasonsRaw.length
        const seasonBlock = seasonsRaw.slice(startPos, endPos)

        // Find all episode objects in this season block
        // Episode objects have "episode":"N" followed by fields like "hls", "dash"
        const epRegex = /\{"episode"?\s*:\s*"?(\d+)"?[^}]*\}/g
        let em: RegExpExecArray | null
        while ((em = epRegex.exec(seasonBlock)) !== null) {
          const epObj = em[0]
          const epNum = parseInt(em[1], 10)
          const hlsMatch = epObj.match(/"hls"?\s*:\s*"([^"]+)"/)
          const dashMatch = epObj.match(/"dash"?\s*:\s*"([^"]+)"/)
          episodes.push({
            season: seasonNum,
            episode: epNum,
            hls: hlsMatch ? hlsMatch[1] : undefined,
            dash: dashMatch ? dashMatch[1] : undefined,
          })
        }
      }

      if (episodes.length > 0) {
        const result: FilmEpisode[] = []
        for (const ep of episodes) {
          const players: FilmPlayerOption[] = []
          if (ep.hls) {
            players.push({
              id: hashUrl(ep.hls),
              name: 'Ortified HLS',
              quality: 'auto',
              translation: '',
              streamUrl: ep.hls,
              iframeUrl: ortifiedUrl,
              extractorType: 'hls',
            })
          }
          if (ep.dash) {
            players.push({
              id: hashUrl(ep.dash),
              name: 'Ortified DASH',
              quality: 'auto',
              translation: '',
              streamUrl: ep.dash,
              iframeUrl: ortifiedUrl,
              extractorType: 'dash' as any,
            })
          }
          if (players.length === 0) {
            players.push({
              id: hashUrl(ortifiedUrl + `?season=${ep.season}&episode=${ep.episode}`),
              name: 'Ortified',
              quality: 'auto',
              translation: '',
              streamUrl: null,
              iframeUrl: ortifiedUrl + `?season=${ep.season}&episode=${ep.episode}`,
              extractorType: 'iframe',
            })
          }
          result.push({
            id: `s${ep.season}e${ep.episode}`,
            season: ep.season,
            episode: ep.episode,
            title: `Сезон ${ep.season} • Серия ${ep.episode}`,
            url: ortifiedUrl,
            players,
          })
        }
        return result
      }
    }
  }

  // Fallback: no "seasons" key — look for "episodes" array directly
  const epStartMatch = html.match(/episodes?\s*:\s*(\[\s*\{)/)
  if (epStartMatch) {
    const startIdx = epStartMatch.index! + (epStartMatch[0].length - epStartMatch[1]!.length) // points to '['
    let bracketDepth = 0
    let braceDepth = 0
    let endIdx = -1
    let inString = false
    let escape = false
    for (let i = startIdx; i < html.length; i++) {
      const ch = html[i]
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '[') bracketDepth++
      else if (ch === ']') {
        bracketDepth--
        if (bracketDepth === 0 && braceDepth === 0) { endIdx = i; break }
      }
      else if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }
    if (endIdx > startIdx) {
      const epsRaw = html.slice(startIdx, endIdx + 1)
      const epObjRegex = /\{"episode"?\s*:\s*"?(\d+)"?[\s\S]*?\}/g
      const result: FilmEpisode[] = []
      let em: RegExpExecArray | null
      while ((em = epObjRegex.exec(epsRaw)) !== null) {
        const epObj = em[0]
        const epNum = parseInt(em[1], 10)
        const hlsMatch = epObj.match(/"hls"?\s*:\s*"([^"]+)"/)
        const dashMatch = epObj.match(/"dash"?\s*:\s*"([^"]+)"/)
        const players: FilmPlayerOption[] = []
        if (hlsMatch) {
          players.push({
            id: hashUrl(hlsMatch[1]),
            name: 'Ortified HLS',
            quality: 'auto',
            translation: '',
            streamUrl: hlsMatch[1],
            iframeUrl: ortifiedUrl,
            extractorType: 'hls',
          })
        }
        if (dashMatch) {
          players.push({
            id: hashUrl(dashMatch[1]),
            name: 'Ortified DASH',
            quality: 'auto',
            translation: '',
            streamUrl: dashMatch[1],
            iframeUrl: ortifiedUrl,
            extractorType: 'dash' as any,
          })
        }
        if (players.length === 0) {
          players.push({
            id: hashUrl(ortifiedUrl + `?episode=${epNum}`),
            name: 'Ortified',
            quality: 'auto',
            translation: '',
            streamUrl: null,
            iframeUrl: ortifiedUrl + `?episode=${epNum}`,
            extractorType: 'iframe',
          })
        }
        result.push({
          id: `s1e${epNum}`,
          season: 1,
          episode: epNum,
          title: `Сезон 1 • Серия ${epNum}`,
          url: ortifiedUrl,
          players,
        })
      }
      if (result.length > 0) return result
    }
  }

  return []
}

// ---- Try to extract direct stream URL from a player iframe page ----
//   1. Fetch the player iframe page HTML
//   2. Search for m3u8/mp4 URLs using multiple regex patterns
//   3. Try to decode base64-encoded URLs
//   4. Try to parse JSON blobs that may contain the stream URL
async function extractDirectStream(
  iframeUrl: string
): Promise<{ streamUrl: string; type: 'hls' | 'mp4' } | null> {
  let html: string
  try {
    const res = await timeoutFetch(iframeUrl, {
      headers: { 'Referer': iframeUrl },
    }, 10000)
    if (!res.ok) return null
    html = await res.text()
  } catch {
    return null
  }

  // ---- Strategy 1: Direct m3u8 URL in any quote/string ----
  // Matches: "https://...m3u8..." or 'https://...m3u8...'
  // Also matches URLs with query params like ?fckz2=...&ha=...
  const m3u8Patterns = [
    /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
    /["'](https?:\/\/[^"'\s]+\/index\.m3u8[^"'\s]*)["']/i,
    /["'](https?:\/\/[^"'\s]+\/master\.m3u8[^"'\s]*)["']/i,
    /["'](https?:\/\/[^"'\s]+\/playlist\.m3u8[^"'\s]*)["']/i,
  ]
  for (const re of m3u8Patterns) {
    const m = html.match(re)
    if (m) return { streamUrl: m[1], type: 'hls' }
  }

  // ---- Strategy 2: Direct mp4 URL ----
  const mp4Patterns = [
    /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i,
    /["'](https?:\/\/[^"'\s]+\.webm[^"'\s]*)["']/i,
  ]
  for (const re of mp4Patterns) {
    const m = html.match(re)
    if (m) return { streamUrl: m[1], type: 'mp4' }
  }

  // ---- Strategy 3: VideoCDN-style [360p]url[480p]url format ----
  const linksMatch = html.match(/\[(\d+p)\](https?:\/\/[^\[\]"'\s]+(?:\.mp4|\.m3u8)[^\[\]"'\s]*)/gi)
  if (linksMatch && linksMatch.length > 0) {
    let best: { quality: number; url: string; type: 'hls' | 'mp4' } | null = null
    for (const l of linksMatch) {
      const mm = l.match(/\[(\d+)p\](.+)/i)
      if (mm) {
        const q = parseInt(mm[1], 10)
        const url = mm[2].trim()
        const type: 'hls' | 'mp4' = url.includes('.m3u8') ? 'hls' : 'mp4'
        if (!best || q > best.quality) best = { quality: q, url, type }
      }
    }
    if (best) return { streamUrl: best.url, type: best.type }
  }

  // ---- Strategy 4: <video> or <source> src attributes ----
  const videoSrcMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i)
  if (videoSrcMatch) {
    const url = videoSrcMatch[1]
    if (url.includes('.m3u8')) return { streamUrl: url, type: 'hls' }
    if (url.match(/\.(mp4|webm)/i)) return { streamUrl: url, type: 'mp4' }
  }
  const sourceSrcMatch = html.match(/<source[^>]+src=["']([^"']+)["']/i)
  if (sourceSrcMatch) {
    const url = sourceSrcMatch[1]
    if (url.includes('.m3u8')) return { streamUrl: url, type: 'hls' }
    if (url.match(/\.(mp4|webm)/i)) return { streamUrl: url, type: 'mp4' }
  }

  // ---- Strategy 5: JS variable patterns ----
  // file: "url", src: "url", url: "url", video: "url", source: "url"
  const jsVarPatterns = [
    /(?:file|src|url|video|source|hls|stream)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
    /(?:file|src|url|video|source|mp4|stream)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i,
  ]
  for (const re of jsVarPatterns) {
    const m = html.match(re)
    if (m) {
      const url = m[1]
      return { streamUrl: url, type: url.includes('.m3u8') ? 'hls' : 'mp4' }
    }
  }

  // ---- Strategy 6: Base64-encoded URLs ----
  // Some players encode the URL in base64. Look for patterns like
  // atob("...") or data-*="base64string"
  const b64Match = html.match(/atob\(["']([A-Za-z0-9+/=]{50,})["']\)/)
  if (b64Match) {
    try {
      const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8')
      if (decoded.startsWith('http')) {
        if (decoded.includes('.m3u8')) return { streamUrl: decoded, type: 'hls' }
        if (decoded.match(/\.(mp4|webm)/i)) return { streamUrl: decoded, type: 'mp4' }
      }
    } catch {/* ignore */}
  }

  // ---- Strategy 7: JSON blob with "url" or "file" key ----
  // Some players embed a JSON config with the stream URL
  const jsonMatch = html.match(/\{[^}]*"(?:file|url|src|video|stream)"\s*:\s*"(https?:\/\/[^"]+)"[^}]*\}/i)
  if (jsonMatch) {
    const url = jsonMatch[1]
    if (url.includes('.m3u8')) return { streamUrl: url, type: 'hls' }
    if (url.match(/\.(mp4|webm)/i)) return { streamUrl: url, type: 'mp4' }
  }

  // ---- Strategy 8: URL with /master.m3u8 or /index.m3u8 path (no extension match) ----
  const pathMatch = html.match(/["'](https?:\/\/[^"'\s]+\/(?:master|index|playlist)\.m3u8[^"'\s]*)["']/i)
  if (pathMatch) return { streamUrl: pathMatch[1], type: 'hls' }

  // ---- Strategy 9: DASH (.mpd) streams ----
  const mpdPatterns = [
    /["'](https?:\/\/[^"'\s]+\.mpd[^"'\s]*)["']/i,
    /["'](https?:\/\/[^"'\s]+\/manifest\.mpd[^"'\s]*)["']/i,
  ]
  for (const re of mpdPatterns) {
    const m = html.match(re)
    if (m) return { streamUrl: m[1], type: 'dash' as any }
  }

  // ---- Strategy 10: Any URL with media-like path segments ----
  // Some CDNs use paths like /video/stream/abc123 without extension
  const mediaPathMatch = html.match(/["'](https?:\/\/[^"'\s]+\/(?:stream|video|media|play|watch)\/[^"'\s]{20,}["'])/i)
  if (mediaPathMatch) {
    const url = mediaPathMatch[1]
    // Try to determine type from URL heuristics
    if (url.includes('m3u8') || url.includes('hls')) return { streamUrl: url, type: 'hls' }
    if (url.includes('mpd') || url.includes('dash')) return { streamUrl: url, type: 'dash' as any }
    // Default to mp4 for generic media paths
    return { streamUrl: url, type: 'mp4' }
  }

  return null
}

// ---- Find Kodik on alternate Turkish source ----
// v40: Some series on turkru-tv91.com don't have a Kodik iframe (e.g. "Догу",
// "Ветры тоски"). When that happens, we look up the same series on the
// sibling source (tv-turkru6.info if we're on turkru, and vice-versa) and
// borrow its Kodik iframe URL. This gives the user a working Kodik option
// even when the primary source doesn't have one.
//
// Returns an array of Kodik iframe URLs found on the alternate source's
// series page (usually 1, but could be 0 if not found there either).
const TURKISH_ALT_MAP: Record<string, string> = {
  turkru: 'tvturkru',
  tvturkru: 'turkru',
}

async function findKodikOnAlternateSource(
  currentSourceId: string,
  title: string
): Promise<string[]> {
  const altSourceId = TURKISH_ALT_MAP[currentSourceId]
  if (!altSourceId) return []

  const altSource = SOURCES.find((s) => s.id === altSourceId)
  if (!altSource) return []

  // Search the alternate source for the same title
  const altResults = await searchOnSource(altSource, title)
  // Pick the first result whose cleaned title matches (case-insensitive)
  // — protects against false matches on partial substring hits.
  const cleanedTitle = cleanHtml(title).toLowerCase().trim()
  const match = altResults.find((r) => {
    const rTitle = cleanHtml(r.title).toLowerCase().trim()
    return rTitle === cleanedTitle || rTitle.includes(cleanedTitle) || cleanedTitle.includes(rTitle)
  })
  if (!match) return []

  // Fetch the alternate series page and extract Kodik iframes
  let altHtml: string
  try {
    const res = await timeoutFetch(match.url, {
      headers: { 'Referer': altSource.baseUrl + '/' },
    })
    if (!res.ok) return []
    altHtml = await res.text()
  } catch {
    return []
  }

  // Match Kodik iframe src OR data-src (lazy-loading). Pattern mirrors
  // extractPlayersFromPage but only picks Kodik URLs.
  const kodikUrls: string[] = []
  const kodikRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']*kodik(?:player|api)\.com[^"']*)["'][^>]*>/gi
  let km: RegExpExecArray | null
  while ((km = kodikRegex.exec(altHtml)) !== null) {
    const url = absolutize(km[1], altSource.baseUrl)
    if (!kodikUrls.includes(url)) kodikUrls.push(url)
  }
  return kodikUrls
}

// ============================================================================
// Universal Kodik search across ALL sources (v18.3)
// ----------------------------------------------------------------------------
// Расширение TURKISH_ALT_MAP для ВСЕХ источников. Когда на текущем источнике
// нет Kodik iframe (типичная ситуация для lordser/lordbz — они используют
// ortified/radit-as), мы ищем фильм по названию на всех остальных источниках
// и заимствуем их Kodik iframe URL.
//
// Это даёт пользователю возможность ВСЕГДА иметь опцию Kodik в плеере,
// даже если текущий источник его не предоставляет.
// ============================================================================

/**
 * Поиск Kodik iframe на всех источниках кроме текущего.
 * Возвращает массив уникальных Kodik URL-ов, найденных на любых источниках.
 *
 * Алгоритм:
 *   1. Для каждого другого источника → ищем фильм по title через DLE search
 *   2. Если найдено совпадение по названию → загружаем страницу фильма
 *   3. Извлекаем все Kodik iframe URL из страницы
 *   4. Дедуплицируем и возвращаем
 *
 * Запросы идут параллельно для скорости.
 */
async function findKodikOnAnySource(
  currentSourceId: string,
  title: string
): Promise<Array<{ url: string; sourceId: string }>> {
  // Очищаем title от типичных суффиксов DLE-сайтов:
  //   " (сериал, 1-6 сезон)", " (сериал, 2024)", " 3 сезон", " / Сезон 1-3" и т.д.
  // Иначе точный поиск по полному title ничего не найдёт.
  const cleanedTitle = cleanHtml(title)
    .replace(/\s*\(\s*сериал[^)]*\)\s*/giu, ' ')
    .replace(/\s*,\s*\d{4}\s*-\s*\d{4}\s*/g, ' ')
    .replace(/\s*,\s*\d{4}\s*$/g, '')
    .replace(/\s+\d{1,2}[-\s]?\d{0,2}\s*сезон.*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (!cleanedTitle || cleanedTitle.length < 2) return []

  const otherSources = SOURCES.filter(s => s.id !== currentSourceId)

  const results = await Promise.all(
    otherSources.map(async (altSource) => {
      try {
        // Search the alternate source for the same title
        const altResults = await searchOnSource(altSource, cleanedTitle)
        // Match by title (case-insensitive, partial match allowed)
        const match = altResults.find((r) => {
          const rTitle = cleanHtml(r.title).toLowerCase().trim()
          // Same logic as findKodikOnAlternateSource — accept partial matches
          // because DLE titles often have different suffixes ("3 сезон" vs "3 сезон (сериал)")
          return rTitle === cleanedTitle || rTitle.includes(cleanedTitle) || cleanedTitle.includes(rTitle)
        })
        if (!match) return []

        // Fetch the alternate film page
        const res = await timeoutFetch(match.url, {
          headers: { 'Referer': altSource.baseUrl + '/' },
        })
        if (!res.ok) return []
        const altHtml = await res.text()

        // Extract Kodik iframes
        const kodikUrls: string[] = []
        const kodikRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']*kodik(?:player|api)\.com[^"']*)["'][^>]*>/gi
        let km: RegExpExecArray | null
        while ((km = kodikRegex.exec(altHtml)) !== null) {
          const url = absolutize(km[1], altSource.baseUrl)
          if (!kodikUrls.includes(url)) kodikUrls.push(url)
        }
        return kodikUrls.map(url => ({ url, sourceId: altSource.id }))
      } catch {
        return []
      }
    })
  )

  // Flatten + dedupe by URL
  const all = results.flat()
  const seen = new Set<string>()
  return all.filter(({ url }) => {
    if (seen.has(url)) return false
    seen.add(url)
    return true
  })
}

// ---- Build FilmPlayerOption from extracted iframe URLs ----
async function buildPlayerOptions(
  rawPlayers: Array<{ iframeUrl: string; context: string }>,
  sourceBaseUrl: string
): Promise<FilmPlayerOption[]> {
  const options: FilmPlayerOption[] = []
  let idx = 0
  for (const p of rawPlayers) {
    const meta = identifyPlayer(p.iframeUrl)
    // Try to extract direct stream URL
    const direct = await extractDirectStream(p.iframeUrl)
    // Try to extract translation from context
    let translation = meta.translation
    if (!translation && p.context !== 'direct') {
      const trMatch = p.context.match(/(Дубляж|LostFilm|Кубик[^<]*|Jaskier|Субтитры|Оригинал|Любительский[^<]*|Мульти|ALEXFILM|BaibaKo|NewStudio|KMV)/i)
      if (trMatch) translation = trMatch[1]
    }

    options.push({
      id: hashUrl(p.iframeUrl) + `_${idx}`,
      name: meta.name,
      quality: meta.quality,
      translation,
      streamUrl: direct?.streamUrl || null,
      iframeUrl: p.iframeUrl,
      extractorType: direct?.type || 'iframe',
    })
    idx++
  }
  return options
}

// ---- Routes ----

/**
 * GET /api/films/sources
 * Returns the list of available source sites.
 */
router.get('/sources', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  return res.json({ sources: SOURCES.map(s => ({ id: s.id, name: s.displayName, emoji: s.emoji })) })
}))

/**
 * GET /api/films/browse
 * Возвращает каталог фильмов без поиска — для красивой галереи в Video Hub.
 * Группирует результаты по 4 категориям: Новинки, Зарубежные, Турецкие, Мультсериалы.
 * Кешируется на 30 минут (BROWSE_CACHE_TTL).
 */
const BROWSE_CACHE_TTL = 30 * 60 * 1000  // 30 minutes
let browseCache: { data: any; expires: number } | null = null

router.get('/browse', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  // Check cache first
  if (browseCache && Date.now() < browseCache.expires) {
    return res.json(browseCache.data)
  }

  // Fetch all categories in parallel — each category fetches its sources in parallel
  const categoryResults = await Promise.all(
    BROWSE_CATEGORIES.map(async (cat) => {
      const sourceResults = await Promise.all(
        cat.sources.map(async ({ sourceId, path }) => {
          const source = SOURCES.find(s => s.id === sourceId)
          if (!source) return []
          try {
            return await browseSource(source, path)
          } catch {
            return []
          }
        })
      )
      // Flatten + dedupe by URL
      const all = sourceResults.flat()
      const seen = new Set<string>()
      const deduped = all.filter(r => {
        const k = `${r.sourceId}:${r.url}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      // Filter out items without a poster (they look broken in the catalog grid)
      const withPosters = deduped.filter(r => r.posterUrl)
      // Interleave films from different sources so each source is represented
      // (otherwise the fastest source would dominate the first `max` slots).
      // Group by sourceId, then take one from each group in turn.
      const bySource = new Map<string, FilmSearchResult[]>()
      for (const f of withPosters) {
        if (!bySource.has(f.sourceId)) bySource.set(f.sourceId, [])
        bySource.get(f.sourceId)!.push(f)
      }
      const interleaved: FilmSearchResult[] = []
      const sourceIds = Array.from(bySource.keys())
      let idx = 0
      while (interleaved.length < cat.max) {
        let added = false
        for (const sid of sourceIds) {
          const arr = bySource.get(sid)!
          if (idx < arr.length) {
            interleaved.push(arr[idx])
            added = true
            if (interleaved.length >= cat.max) break
          }
        }
        if (!added) break  // all sources exhausted
        idx++
      }
      return {
        id: cat.id,
        title: cat.title,
        emoji: cat.emoji,
        films: interleaved,
      }
    })
  )

  const response = { categories: categoryResults }
  // Update cache
  browseCache = { data: response, expires: Date.now() + BROWSE_CACHE_TTL }
  return res.json(response)
}))

/**
 * GET /api/films/search?q=<query>&source=<sourceId|all>
 * Searches across all 5 sources in parallel.
 */
router.get('/search', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const q = String(req.query.q || '').trim()
  const sourceFilter = String(req.query.source || 'all')

  if (!q || q.length < 2) {
    return res.json({ results: [] as FilmSearchResult[] })
  }

  const cacheKey = `search:${sourceFilter}:${q}`
  const cached = getCached<FilmSearchResult[]>(cacheKey)
  if (cached) return res.json({ results: cached })

  const sourcesToSearch = sourceFilter === 'all'
    ? SOURCES
    : SOURCES.filter(s => s.id === sourceFilter)

  const settled = await Promise.allSettled(
    sourcesToSearch.map(s => searchOnSource(s, q))
  )

  const results: FilmSearchResult[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      results.push(...r.value)
    }
  }

  // Dedupe by (sourceId, url) — keep first occurrence
  const seen = new Set<string>()
  const deduped = results.filter(r => {
    const k = `${r.sourceId}:${r.url}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  // ---- Sort by relevance to the query ----
  // Priority:
  //   1. Exact title match (case-insensitive)
  //   2. Title starts with query
  //   3. Title contains query as a whole word
  //   4. Title contains query as substring
  //   5. Everything else (description match, etc.)
  const qLower = q.toLowerCase()
  const qWords = qLower.split(/\s+/).filter(w => w.length > 1)
  const scored = deduped.map(r => {
    const titleLower = r.title.toLowerCase()
    let score = 0
    if (titleLower === qLower) {
      score = 1000 // exact match
    } else if (titleLower.startsWith(qLower)) {
      score = 800 // starts with query
    } else if (titleLower.includes(qLower)) {
      score = 600 // contains full query as substring
    } else {
      // Count how many query words appear in the title
      let wordMatches = 0
      for (const w of qWords) {
        if (titleLower.includes(w)) wordMatches++
      }
      score = wordMatches * 100
      // Bonus if all words match
      if (wordMatches === qWords.length && qWords.length > 0) {
        score += 200
      }
    }
    return { result: r, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const sorted = scored.map(s => s.result)

  setCached(cacheKey, sorted)
  return res.json({ results: sorted })
}))

/**
 * GET /api/films/details?id=<sourceId>:<slug>
 * Fetches full details for one film: title, year, description, poster,
 * and ALL available players (with direct stream URLs where extractable).
 *
 * For series: parses the episode list and builds per-episode player options.
 */
router.get('/details', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const id = String(req.query.id || '').trim()
  if (!id || !id.includes(':')) {
    return res.status(400).json({ error: 'invalid_id' })
  }

  const cacheKey = `detail:${id}`
  const cached = getCached<FilmDetails>(cacheKey)
  if (cached) return res.json(cached)

  const [sourceId, ...slugParts] = id.split(':')
  const source = SOURCES.find(s => s.id === sourceId)
  if (!source) {
    return res.status(404).json({ error: 'unknown_source' })
  }

  // ---- DLE sites: HTML scraping ----
  const slug = slugParts.join(':')
  const pageUrl = `${source.baseUrl}/${slug}.html`

  // Fetch the film page
  let html: string
  try {
    const r = await timeoutFetch(pageUrl, { headers: { 'Referer': source.baseUrl + '/' } })
    if (!r.ok) return res.status(502).json({ error: 'source_unavailable' })
    html = await r.text()
  } catch (e: any) {
    return res.status(502).json({ error: 'fetch_failed', message: e.message })
  }

  // Parse title — try og:title, then <h1>, then <title>
  // For sites with verbose titles (e.g. turkru: "Чукур на русском языке смотреть онлайн бесплатно на TurkRu TV"),
  // strip the boilerplate suffixes to get just the film name.
  let title = ''
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (ogTitleMatch) title = cleanHtml(ogTitleMatch[1])
  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (h1Match) title = cleanHtml(h1Match[1])
  }
  if (!title) {
    const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i)
    if (titleTagMatch) title = cleanHtml(titleTagMatch[1]).split(' - ')[0].split(' | ')[0]
  }
  // Strip common boilerplate suffixes that appear on series detail pages.
  // Order matters: longest/most-specific patterns first.
  title = title
    .replace(/\s+турецк\w*(?:\s+сериал)?[^\u0000]*$/iu, '')
    .replace(/\s+сери[яюе]\b.*$/iu, '')
    .replace(/\s+на\s+русском\s+языке\s+(?:смотреть\s+)?онлайн?.*$/iu, '')
    .replace(/\s+смотреть\s+онлайн?.*$/iu, '')
    .replace(/\s+все\s+сери[яюи].*$/iu, '')
    .replace(/\s+бесплатно\s+на\s+\w+.*$/iu, '')
    .replace(/\s+-\s*турецк\w*.*$/iu, '')
    .replace(/\s*\|\s*турецк\w*.*$/iu, '')
    .replace(/\s+на\s+русском.*$/iu, '')
    .trim()
  if (!title) {
    // Fallback: slug-based title (e.g. "449-chukur" → "chukur" → "Chukur")
    const slugTitle = slug.replace(/^\d+-/, '').replace(/[-_]+/g, ' ').trim()
    if (slugTitle) {
      title = slugTitle.charAt(0).toUpperCase() + slugTitle.slice(1)
    }
  }

  // Parse description — og:description, then meta description, then first <p>
  let description = ''
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  if (ogDescMatch) description = cleanHtml(ogDescMatch[1])
  if (!description) {
    const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    if (metaDescMatch) description = cleanHtml(metaDescMatch[1])
  }
  if (!description) {
    const pMatch = html.match(/<div[^>]*class=["'][^"']*text[^"']*["'][^>]*>([\s\S]{200,1500}?)<\/div>/i)
    if (pMatch) description = cleanHtml(pMatch[1]).slice(0, 500)
  }

  // Parse poster — og:image
  let posterUrl: string | null = null
  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  if (ogImageMatch) {
    posterUrl = absolutize(ogImageMatch[1], source.baseUrl)
  }
  if (!posterUrl) {
    const posterImgMatch = html.match(/<img[^>]+class=["'][^"']*poster[^"']*["'][^>]+src=["']([^"']+)["']/i)
    if (posterImgMatch) {
      posterUrl = absolutize(posterImgMatch[1], source.baseUrl)
    }
  }
  if (!posterUrl) {
    // First reasonable-size image
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i)
    if (imgMatch) {
      posterUrl = absolutize(imgMatch[1], source.baseUrl)
    }
  }

  // Detect series — DLE series pages have episode lists
  // Look for patterns like "1 сезон 1 серия" or episode links like /1234-slug/1-seriya.html
  const episodeLinkRegex = new RegExp(
    `href=["']((?:https?:\\/\\/[^"']*)?\\/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/[^"']*?)["']`,
    'gi'
  )
  const episodeLinks: string[] = []
  let em: RegExpExecArray | null
  while ((em = episodeLinkRegex.exec(html)) !== null) {
    const epUrl = absolutize(em[1], source.baseUrl)
    if (!episodeLinks.includes(epUrl)) {
      episodeLinks.push(epUrl)
    }
  }

  // Also look for episode links with other patterns:
  //   /1234-slug-1-seriya.html, /1-sezon-1-seriya.html  (translit "seriya")
  //   /1234-slug/1-serija-online-na-russkom.html  (translit "serija" — turkru style)
  //   /1234-slug/1-serija.html
  const altEpRegex = /href=["']([^"']*(?:\d+-)?seri[ey]a[^"']*\.html)["']/gi
  while ((em = altEpRegex.exec(html)) !== null) {
    const epUrl = absolutize(em[1], source.baseUrl)
    if (!episodeLinks.includes(epUrl) && epUrl.includes(slug.split('/').pop() || slug)) {
      episodeLinks.push(epUrl)
    }
  }

  // Also detect "b-simple_episodes__list" pattern (turkru/tvturkru DLE template)
  // Episode links are inside <a href=".../N-serija-online-na-russkom.html"><li class="b-simple_episode__item">N серия</li></a>
  const simpleEpRegex = /class="b-simple_episode__item[^"]*"[^>]*>\s*(\d+)\s*сер/i
  // We already captured these via altEpRegex above (they match seri[ey]a pattern)

  const isSeries = episodeLinks.length > 0 ||
                   /сезон|сери[яюе]|seri[ey]a|sezon|serial|b-simple_episode|b\xc3\xb6l\xc3\xbcm|bolum/i.test(title + ' ' + description)

  // Build details
  const details: FilmDetails = {
    id,
    sourceId: source.id,
    sourceName: source.displayName,
    title,
    year: extractYear(title) || extractYear(description),
    description,
    posterUrl,
    isSeries,
    url: pageUrl,
    players: [],
    episodes: [],
    seasons: [],
    translations: [],
    qualities: [],
  }

  if (!isSeries) {
    // Single film — extract all players from this page
    const rawPlayers = await extractPlayersFromPage(pageUrl, source.baseUrl)
    details.players = await buildPlayerOptions(rawPlayers, source.baseUrl)
  } else {
    // Series — try multiple strategies to get episode list:
    //   1. Check for ortified iframe → extract episodes from ortified JSON
    //   2. If episode subpages exist (DLE /slug/N-serija.html) → use them
    //   3. Fallback: single virtual episode with main players

    // Strategy 1: find ortified iframe on the page
    const ortifiedMatch = html.match(/api\.ortified\.ws\/embed\/movie\/(\d+)/)
    if (ortifiedMatch) {
      const ortifiedId = ortifiedMatch[1]
      const ortifiedEpisodes = await extractOrtifiedEpisodes(ortifiedId, source.baseUrl)
      if (ortifiedEpisodes.length > 0) {
        details.episodes = ortifiedEpisodes
        details.episodes.sort((a, b) =>
          a.season !== b.season ? a.season - b.season : a.episode - b.episode
        )
        details.seasons = [...new Set(details.episodes.map(e => e.season))].sort((a, b) => a - b)
        // Set main players to first episode's players
        details.players = ortifiedEpisodes[0]?.players || []
      }
    }

    // Strategy 2: DLE episode subpages (fallback if ortified didn't work)
    if (details.episodes.length === 0 && episodeLinks.length > 0) {
      let counter = 0
      for (const epUrl of episodeLinks.slice(0, 100)) {
        let season = 1
        let episode = counter + 1
        const seasonMatch = epUrl.match(/(\d+)-?sezon/i)
        if (seasonMatch) season = parseInt(seasonMatch[1], 10)
        const episodeMatch = epUrl.match(/(\d+)-?seri[ey]a/i)
        if (episodeMatch) episode = parseInt(episodeMatch[1], 10)
        const slashMatch = epUrl.match(/\/(\d+)-(\d+)-seri[ey]a/i)
        if (slashMatch) {
          season = parseInt(slashMatch[1], 10)
          episode = parseInt(slashMatch[2], 10)
        }
        details.episodes.push({
          id: hashUrl(epUrl),
          season,
          episode,
          title: `Сезон ${season} • Серия ${episode}`,
          url: epUrl,
          players: [],
        })
        counter++
      }
      details.episodes.sort((a, b) =>
        a.season !== b.season ? a.season - b.season : a.episode - b.episode
      )
      details.seasons = [...new Set(details.episodes.map(e => e.season))].sort((a, b) => a - b)
      // Also extract main page players as fallback
      const rawPlayers = await extractPlayersFromPage(pageUrl, source.baseUrl)
      details.players = await buildPlayerOptions(rawPlayers, source.baseUrl)
    }

    // Strategy 3: fallback — single virtual episode with main players
    if (details.episodes.length === 0) {
      const rawPlayers = await extractPlayersFromPage(pageUrl, source.baseUrl)
      details.players = await buildPlayerOptions(rawPlayers, source.baseUrl)
      details.episodes = [{
        id: 'main',
        season: 1,
        episode: 1,
        title: 'Сезон 1 • Серия 1',
        url: pageUrl,
        players: details.players,
      }]
      details.seasons = [1]
    }
  }

  // v40: Kodik fallback — some Turkish series on turkru don't include a
  // Kodik iframe (e.g. "Догу", "Ветры тоски"). If the current source is
  // turkru or tvturkru AND no Kodik player was extracted, try to borrow one
  // from the sibling Turkish source. This adds a working Kodik option to
  // the players list so the user can switch to it in the player UI.
  if (TURKISH_ALT_MAP[source.id]) {
    const hasKodikAlready = details.players.some((p) => p.name === 'Kodik')
    if (!hasKodikAlready) {
      const altKodikUrls = await findKodikOnAlternateSource(source.id, title)
      for (const kodikUrl of altKodikUrls) {
        // Build a FilmPlayerOption without re-running extractDirectStream
        // (Kodik is SPA-only — extraction always returns null for it).
        const meta = identifyPlayer(kodikUrl)
        details.players.push({
          id: hashUrl(kodikUrl) + `_alt_${details.players.length}`,
          name: meta.name,
          quality: meta.quality,
          translation: meta.translation || 'Kodik (альт. источник)',
          streamUrl: null,
          iframeUrl: kodikUrl,
          extractorType: 'iframe',
        })
      }
      // Also inject the Kodik option into each episode's players so it's
      // available when the user opens a specific episode.
      if (details.episodes.length > 0 && altKodikUrls.length > 0) {
        const altPlayers = altKodikUrls.map((url, i) => {
          const meta = identifyPlayer(url)
          return {
            id: hashUrl(url) + `_alt_ep_${i}`,
            name: meta.name,
            quality: meta.quality,
            translation: meta.translation || 'Kodik (альт. источник)',
            streamUrl: null,
            iframeUrl: url,
            extractorType: 'iframe' as const,
          }
        })
        for (const ep of details.episodes) {
          // Only add if this episode doesn't already have a Kodik
          if (!ep.players.some((p) => p.name === 'Kodik')) {
            ep.players = [...ep.players, ...altPlayers]
          }
        }
      }
    }
  }

  // v18.3: Universal Kodik fallback — расширение v40 для ВСЕХ источников.
  // Если на текущем источнике (lordser, lordbz, etc.) нет Kodik iframe,
  // ищем фильм по названию на ВСЕХ остальных источниках и заимствуем их
  // Kodik iframe URL. Это даёт пользователю ВСЕГДА опцию Kodik в плеере,
  // даже если lordser/lordbz используют только ortified/radit-as.
  //
  // Это особенно полезно для фильмов, где ortified/radit-as не работают
  // (геоблок, удаление видео), но Kodik — работает.
  {
    const hasKodikAlready = details.players.some((p) => p.name === 'Kodik')
    if (!hasKodikAlready) {
      const kodikFromAny = await findKodikOnAnySource(source.id, title)
      if (kodikFromAny.length > 0) {
        // Source priority: turkru first (most reliable Kodik), then tvturkru, then others
        const sourcePriority: Record<string, number> = { turkru: 1, tvturkru: 2, lordbz: 3, lordser: 4 }
        kodikFromAny.sort((a, b) => (sourcePriority[a.sourceId] || 99) - (sourcePriority[b.sourceId] || 99))

        for (const { url: kodikUrl, sourceId: foundSourceId } of kodikFromAny) {
          const meta = identifyPlayer(kodikUrl)
          const foundSource = SOURCES.find(s => s.id === foundSourceId)
          details.players.push({
            id: hashUrl(kodikUrl) + `_uni_${details.players.length}`,
            name: meta.name,
            quality: meta.quality,
            translation: meta.translation || (foundSource ? `Kodik · ${foundSource.displayName}` : 'Kodik (универсальный)'),
            streamUrl: null,
            iframeUrl: kodikUrl,
            extractorType: 'iframe',
          })
        }
        // Inject into episodes too
        if (details.episodes.length > 0) {
          const uniPlayers = kodikFromAny.map(({ url, sourceId }) => {
            const meta = identifyPlayer(url)
            const foundSource = SOURCES.find(s => s.id === sourceId)
            return {
              id: hashUrl(url) + `_uni_ep_${sourceId}`,
              name: meta.name,
              quality: meta.quality,
              translation: meta.translation || (foundSource ? `Kodik · ${foundSource.displayName}` : 'Kodik (универсальный)'),
              streamUrl: null,
              iframeUrl: url,
              extractorType: 'iframe' as const,
            }
          })
          for (const ep of details.episodes) {
            if (!ep.players.some((p) => p.name === 'Kodik')) {
              ep.players = [...ep.players, ...uniPlayers]
            }
          }
        }
      }
    }
  }

  // Collect unique translations and qualities
  const translations = new Set<string>()
  const qualities = new Set<string>()
  const allPlayers = details.isSeries
    ? details.episodes.flatMap(e => e.players)
    : details.players
  for (const p of allPlayers) {
    if (p.translation) translations.add(p.translation)
    if (p.quality) qualities.add(p.quality)
  }
  details.translations = [...translations]
  details.qualities = [...qualities]

  setCached(cacheKey, details)
  return res.json(details)
}))

/**
 * GET /api/films/resolve?url=<iframeUrl>
 * On-demand extraction of a direct stream URL for a single player iframe.
 * Used by the frontend when the user switches to a player whose streamUrl
 * was not pre-resolved (extractorType === 'iframe').
 */
router.get('/resolve', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const url = String(req.query.url || '').trim()
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'invalid_url' })
  }
  const cacheKey = `resolve:${url}`
  const cached = getCached<{ streamUrl: string; type: string } | null>(cacheKey)
  if (cached !== null) {
    return res.json(cached || { streamUrl: null, type: 'iframe' })
  }
  const direct = await extractDirectStream(url)
  const result = direct
    ? { streamUrl: direct.streamUrl, type: direct.type }
    : { streamUrl: null, type: 'iframe' }
  setCached(cacheKey, result)
  return res.json(result)
}))

/**
 * GET /api/films/episode?url=<episodePageUrl>
 * On-demand resolution of all players for a single series episode.
 * Returns: { players: FilmPlayerOption[] }
 *
 * This is called by the frontend when the user opens an episode from the
 * series detail screen. Avoids pre-fetching all episodes upfront.
 */
router.get('/episode', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const url = String(req.query.url || '').trim()
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'invalid_url' })
  }

  const cacheKey = `episode:${url}`
  const cached = getCached<FilmPlayerOption[]>(cacheKey)
  if (cached) return res.json({ players: cached })

  // Determine the source base URL for absolutization
  let sourceBaseUrl = ''
  try {
    const u = new URL(url)
    sourceBaseUrl = `${u.protocol}//${u.host}`
  } catch {
    return res.status(400).json({ error: 'invalid_url' })
  }

  const rawPlayers = await extractPlayersFromPage(url, sourceBaseUrl)
  const players = await buildPlayerOptions(rawPlayers, sourceBaseUrl)
  setCached(cacheKey, players)
  return res.json({ players })
}))

export default router
