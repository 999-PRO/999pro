// ============================================================================
// Video Hub — frontend types (v17.1)
// ----------------------------------------------------------------------------
// Полностью переработано под новые источники (5 DLE-сайтов) с поддержкой
// нескольких плееров на один фильм/серию.
// ============================================================================

export interface FilmSource {
  id: string
  name: string
  emoji: string
}

export interface Film {
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
  id: string
  name: string               // "Kodik" | "Tuser" | etc.
  quality: string            // "720p" | "1080p" | "auto"
  translation: string        // "Дубляж" | "LostFilm" | "" etc.
  streamUrl: string | null   // direct m3u8/MP4 URL (null if extraction failed)
  iframeUrl: string          // original iframe URL (kept for diagnostics)
  extractorType: 'hls' | 'mp4' | 'iframe'
}

export interface FilmEpisode {
  id: string
  season: number
  episode: number
  title: string
  url: string
  players: FilmPlayerOption[]
}

export interface FilmDetails extends Film {
  players: FilmPlayerOption[]
  episodes: FilmEpisode[]
  seasons: number[]
  translations: string[]
  qualities: string[]
}

export type FilmSearchState = {
  query: string
  results: Film[]
  timestamp: number
} | null

// ---- Browse catalog (v18) ----
// Категория каталога для отображения на пустом экране поиска.
// Каждая категория содержит до 16 фильмов с постерами, чередующихся по источникам.
export interface BrowseCategory {
  id: string          // 'news' | 'foreign' | 'turkish' | 'cartoons'
  title: string       // 'Новинки' | 'Зарубежные сериалы' | ...
  emoji: string       // '🆕' | '🌍' | '🇹🇷' | '📺'
  films: Film[]
}

export interface BrowseResponse {
  categories: BrowseCategory[]
}

export interface FilmProgress {
  filmId: string
  episodeId?: string
  position: number   // seconds
  duration: number   // seconds
  updatedAt: number  // epoch ms
}

// Chat-card film payload (what gets JSON-serialised into message.mediaUrl)
export interface FilmChatCardData {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  duration: number | null
  description: string
  isSeries: boolean
  sourceId?: string
  sourceName?: string
}
