'use client'

// ============================================================================
// Audio Hub Cache — IndexedDB layer for offline audio playback.
// ----------------------------------------------------------------------------
// v16.12: CRITICAL PERFORMANCE FIX — was downloading the entire track into a
// Blob before playback could start. For a 5-10MB track this meant 3-10 seconds
// of "loading" before the user heard anything. Now we ALWAYS stream directly
// through the backend proxy (which serves audio with HTTP Range support),
// and only cache in IndexedDB in the BACKGROUND after playback starts.
//
// The cache key is the track id (e.g. "archive-MLKDream", "audius-XYZ").
// The cache stores: { blob, url, trackId, cachedAt, mimeType }.
//
// Why IndexedDB (not localStorage)?
//   • localStorage has a 5-10MB limit — too small for audio files.
//   • IndexedDB can store hundreds of MB of Blob data.
//
// Why not Cache API?
//   • Cache API requires a Service Worker for full offline support.
//   • IndexedDB works directly from the page, simpler.
// ============================================================================

const DB_NAME = '999pro-audio-hub-cache'
const DB_VERSION = 1
const STORE_NAME = 'audio-blobs'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available during SSR'))
  }
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'trackId' })
      }
    }
  })

  return dbPromise
}

interface CachedAudio {
  trackId: string
  blob: Blob
  url: string
  cachedAt: number
  mimeType: string
}

// ---- In-memory cache of Blob URLs (avoid recreating URLs on every play) ----
const urlCache = new Map<string, string>()

// ---- Track background-cache in-flight requests to avoid duplicates ----
const backgroundCachingInFlight = new Set<string>()

/**
 * Try to get a cached Blob URL for a track.
 * Returns a usable URL string if cached, or null if not in cache.
 *
 * v16.12: This is ONLY used for instant offline replay — never blocks the
 * initial play. The initial play goes through resolveStreamUrl() which
 * returns immediately with the backend proxy URL (no waiting for download).
 */
export async function getCachedAudioUrl(trackId: string): Promise<string | null> {
  // Check in-memory URL cache first.
  const memUrl = urlCache.get(trackId)
  if (memUrl) return memUrl

  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(trackId)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const result = req.result as CachedAudio | undefined
        if (!result) {
          resolve(null)
          return
        }
        // Recreate the Blob URL (it may have been revoked on page reload).
        const url = URL.createObjectURL(result.blob)
        urlCache.set(trackId, url)
        resolve(url)
      }
    })
  } catch {
    return null
  }
}

/**
 * v16.12: Get the IMMEDIATE playable URL for a track — no waiting.
 *
 * Strategy (in priority order):
 *   1. If track is already in IndexedDB cache → return the cached blob URL
 *      (instant, no network request).
 *   2. Otherwise → return the backend proxy URL `/api/audio-hub/stream?url=...`
 *      The <audio> element will start streaming from it immediately using
 *      HTTP Range requests. Playback starts within 200-500ms.
 *   3. In parallel (background, non-blocking) → fetch the full track and
 *      store in IndexedDB so the NEXT play is instant/offline.
 *
 * This replaces the old `fetchAndCacheAudio` which downloaded the entire
 * track into a Blob before playback could start (3-10 second delay).
 */
export async function resolveStreamUrl(
  trackId: string,
  audioUrl: string,
): Promise<string> {
  // 1. Check if already cached — return the blob URL instantly.
  const cached = await getCachedAudioUrl(trackId)
  if (cached) return cached

  // 2. Build the backend proxy URL (adds CORS headers + supports HTTP Range).
  const proxyUrl = `/api/audio-hub/stream?url=${encodeURIComponent(audioUrl)}`

  // 3. Kick off background caching (non-blocking, fire-and-forget).
  //    This makes the NEXT play of this track instant + works offline.
  //    We DO NOT await this — playback starts immediately via the proxy URL.
  void backgroundCacheTrack(trackId, proxyUrl)

  return proxyUrl
}

/**
 * v16.12: Background cache a track in IndexedDB.
 *
 * Runs in the background (fire-and-forget). If the cache write fails (quota
 * exceeded, network error, etc.), we silently skip — the track still plays
 * via the proxy URL, just won't be available offline.
 *
 * De-duplicates: if a track is already being cached, skips the request.
 */
async function backgroundCacheTrack(trackId: string, proxyUrl: string): Promise<void> {
  // Skip if already cached or being cached.
  if (backgroundCachingInFlight.has(trackId)) return
  backgroundCachingInFlight.add(trackId)

  try {
    const response = await fetch(proxyUrl)
    if (!response.ok) return
    const blob = await response.blob()
    const mimeType = blob.type || 'audio/mpeg'

    // Skip very large files (>50MB) to avoid filling IndexedDB.
    if (blob.size > 50 * 1024 * 1024) return

    const url = URL.createObjectURL(blob)
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const entry: CachedAudio = {
        trackId,
        blob,
        url,
        cachedAt: Date.now(),
        mimeType,
      }
      store.put(entry)
      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => resolve()
    })
    urlCache.set(trackId, url)
  } catch {
    // Best-effort — silently ignore.
  } finally {
    backgroundCachingInFlight.delete(trackId)
  }
}

/**
 * Check if a track is cached (without creating a Blob URL).
 */
export async function isAudioCached(trackId: string): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.count(trackId)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(req.result > 0)
    })
  } catch {
    return false
  }
}

/**
 * Clear the entire audio cache (for settings/debug).
 */
export async function clearAudioCache(): Promise<void> {
  urlCache.clear()
  backgroundCachingInFlight.clear()
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.clear()
      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => resolve()
    })
  } catch {
    // Ignore — cache clearing is best-effort.
  }
}

// ============================================================================
// Backwards compatibility — old `fetchAndCacheAudio` is replaced by
// `resolveStreamUrl`. We keep the export for any code that still imports it,
// but it now delegates to resolveStreamUrl (so the old behavior is removed).
// ============================================================================
export const fetchAndCacheAudio = resolveStreamUrl
