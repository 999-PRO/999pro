// ============================================================================
// Video Hub — client API wrapper (v17.1)
// ============================================================================
import type { Film, FilmDetails, FilmSource, BrowseResponse } from './types'

const API_BASE = '/api/films'

export async function getFilmSources(): Promise<FilmSource[]> {
  const res = await fetch(`${API_BASE}/sources`)
  if (!res.ok) return []
  const data = await res.json()
  return data.sources || []
}

/**
 * Получить каталог фильмов без поиска — для красивой галереи на пустом экране.
 * Возвращает 4 категории по 16 фильмов с постерами, чередующихся по источникам.
 * Кеш на бэкенде — 30 минут.
 */
export async function browseCatalog(): Promise<BrowseResponse> {
  const res = await fetch(`${API_BASE}/browse`)
  if (!res.ok) return { categories: [] }
  return await res.json()
}

export async function searchFilms(
  query: string,
  source: string = 'all'
): Promise<Film[]> {
  const params = new URLSearchParams({ q: query, source })
  const res = await fetch(`${API_BASE}/search?${params}`)
  if (!res.ok) throw new Error(`search_failed: ${res.status}`)
  const data = await res.json()
  return data.results || []
}

export async function getFilmDetails(id: string): Promise<FilmDetails> {
  const params = new URLSearchParams({ id })
  const res = await fetch(`${API_BASE}/details?${params}`)
  if (!res.ok) throw new Error(`details_failed: ${res.status}`)
  return await res.json()
}

/** On-demand resolution of a direct stream URL for a single player iframe.
 *  Used when user switches to a player whose streamUrl was not pre-resolved. */
export async function resolvePlayerStream(
  iframeUrl: string
): Promise<{ streamUrl: string | null; type: 'hls' | 'mp4' | 'iframe' }> {
  const params = new URLSearchParams({ url: iframeUrl })
  const res = await fetch(`${API_BASE}/resolve?${params}`)
  if (!res.ok) return { streamUrl: null, type: 'iframe' }
  const data = await res.json()
  return {
    streamUrl: data.streamUrl || null,
    type: data.type || 'iframe',
  }
}

/** On-demand resolution of all players for a single series episode.
 *  Called when user opens an episode in the series detail screen. */
export async function getEpisodePlayers(
  episodeUrl: string
): Promise<import('./types').FilmPlayerOption[]> {
  const params = new URLSearchParams({ url: episodeUrl })
  const res = await fetch(`${API_BASE}/episode?${params}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.players || []
}
