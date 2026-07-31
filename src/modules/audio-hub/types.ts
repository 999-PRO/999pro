// ============================================================================
// Audio Hub — shared types.
// ----------------------------------------------------------------------------
// AudioHubTrack is the normalized shape returned by /api/audio-hub/search.
// It is converted to an AudioTrack (from audio-player-manager) when played.
//
// v16.18: Убраны muzjam/audius/archive/jamendo. Источники:
//   • hitmos — hitmos.fm (русская/зарубежная музыка, 320kbps MP3)
//   • muzce  — muzce.com (русская/зарубежная/чеченская музыка, 256-320kbps MP3)
//   • radio  — live radio stations (RadioBrowser, continuous stream)
//   • quran  — full surah recitations (alquran.cloud)
// ============================================================================

export type AudioHubKind = 'music' | 'nasheed' | 'quran' | 'podcast' | 'radio' | 'all'

export interface AudioHubTrack {
  /** Unique id (e.g. "hitmos-12345", "muzce-HASH", "quran-surah-XXX", "radio-UUID"). */
  id: string
  title: string
  artist: string
  album: string | null
  coverUrl: string | null
  /** Direct streamable URL (full track — all sources in v16.18). */
  previewUrl: string | null
  /** Full streamable URL (same as previewUrl — all sources are full). */
  fullUrl?: string | null
  /** Duration in seconds (may be null if unknown — e.g. live radio). */
  duration: number | null
  genre: string | null
  /** Content type requested by the user. */
  kind: string
  source: 'hitmos' | 'muzce' | 'radio' | 'quran'
  /** True for live radio streams (no fixed duration). */
  isLive?: boolean
}

/** Search response from /api/audio-hub/search. */
export interface AudioHubSearchResponse {
  items: AudioHubTrack[]
  total: number
  query: string
  type: string
  source?: string
  cached?: boolean
}
