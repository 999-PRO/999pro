'use client'

// ============================================================================
// Audio Hub API client.
// ----------------------------------------------------------------------------
// Wraps calls to /api/audio-hub/* with proper auth + sandbox routing.
// ============================================================================

import { api } from '@/lib/api'
import type { AudioHubSearchResponse, AudioHubTrack } from './types'

/**
 * Search for audio tracks.
 * Uses the backend proxy which calls hitmos.fm + muzce.com (for music/nasheed/podcast),
 * alquran.cloud (Quran), RadioBrowser (radio).
 * v16.18: Sources — hitmos + muzce only (muzjam/audius/archive/jamendo removed).
 * v16.16: source parameter — search ONLY a specific source ('hitmos', 'muzce').
 *         'all' (default) = search all sources.
 * v16.9.4: For Quran type, empty query is allowed (returns all surahs).
 * v16.10: For radio type, empty query returns top RU stations.
 */
export async function searchAudioTracks(
  q: string,
  type: string = 'music',
  limit: number = 20,
  source: string = 'all',
): Promise<AudioHubSearchResponse> {
  const trimmed = q.trim()
  // v16.9.4: For Quran type, allow empty query — the backend returns all surahs.
  // v16.10: Same for radio — empty query returns top RU stations.
  if (!trimmed && type !== 'quran' && type !== 'radio') {
    return { items: [], total: 0, query: '', type, source }
  }
  let url = `/api/audio-hub/search?q=${encodeURIComponent(trimmed)}&type=${encodeURIComponent(type)}&limit=${limit}`
  if (source && source !== 'all') {
    url += `&source=${encodeURIComponent(source)}`
  }
  return api.get<AudioHubSearchResponse>(url, { auth: false })
}

/**
 * Fetch a single track by id (used by the chat card to resolve metadata).
 * Module-level cache to avoid refetching on chat scroll.
 */
const trackCache = new Map<string, AudioHubTrack>()

export async function fetchTrackById(id: string): Promise<AudioHubTrack | null> {
  if (trackCache.has(id)) return trackCache.get(id)!
  try {
    const track = await api.get<AudioHubTrack>(`/api/audio-hub/track/${encodeURIComponent(id)}`, { auth: false })
    trackCache.set(id, track)
    return track
  } catch {
    return null
  }
}
