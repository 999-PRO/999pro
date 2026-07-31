// Map utilities — generate universal map URLs that work on every platform.
//
// Strategy: use a single https://maps.google.com/?q=... link. On desktop
// it opens Google Maps in the browser; on Android it opens the Google Maps
// app; on iOS it opens Google Maps app if installed, otherwise Apple Maps
// via the maps:// protocol fallback. We also provide a geo: URI for direct
// native-app invocation on mobile.
//
// For the "Open in maps" button we use the https Google Maps URL because
// it's the most universally compatible. For the geo: URI (used only in
// <a href> on mobile) the OS shows the native app chooser.

export interface GeoPoint {
  lat: number
  lng: number
  label?: string
}

/**
 * Build a universal https maps URL that opens the right app per platform.
 * Uses Google Maps — on iOS it opens Apple Maps as a fallback via the
 * platform's URL handler.
 */
export function buildMapUrl(lat: number, lng: number, label?: string): string {
  const q = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

/**
 * Build a geo: URI (RFC 5870). On mobile, opening this URL triggers the
 * native maps-app chooser. On desktop browsers it usually does nothing —
 * so only use this for the "native app" path, not as the primary link.
 */
export function buildGeoUri(lat: number, lng: number, label?: string): string {
  return label
    ? `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`
    : `geo:${lat},${lng}`
}

/**
 * Open a point in the device's default maps app. Tries the universal
 * https URL first (works everywhere), which on mobile opens the native
 * maps app via the browser's URL handler.
 */
export function openInMaps(lat: number, lng: number, label?: string): void {
  const url = buildMapUrl(lat, lng, label)
  // Use _blank + noopener so iOS Safari opens the native app instead of
  // navigating the current tab.
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Build a maps URL for a route from one point to another (future: route
 * to store). Kept here so the "company card → show on map" feature has a
 * ready helper.
 */
export function buildRouteUrl(from: GeoPoint | null, to: GeoPoint, label?: string): string {
  const dest = label ? `${to.lat},${to.lng}(${encodeURIComponent(label)})` : `${to.lat},${to.lng}`
  if (from) {
    return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${dest}`
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`
}

/**
 * Build an OpenStreetMap embed iframe src for in-app map preview (no API
 * key required). Used by the map picker to show a preview after the user
 * selects a point.
 */
export function buildOsmEmbedUrl(lat: number, lng: number, _zoom = 16): string {
  const delta = 0.005
  const bbox = `${lng - delta}%2C${lat - delta}%2C${lng + delta}%2C${lat + delta}`
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`
}

/**
 * Build an OSM Nominatim search URL (for the address-search input in the
 * map picker). Returns a fetch-able endpoint URL.
 */
export function buildOsmSearchUrl(query: string): string {
  return `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
}

export interface OsmSearchResult {
  lat: string
  lon: string
  display_name: string
  address?: Record<string, string>
}

/**
 * Search an address via OSM Nominatim. Free, no API key, but rate-limited
 * (1 req/sec) — adequate for the manual address search use case.
 */
export async function searchAddress(query: string): Promise<OsmSearchResult[]> {
  if (!query.trim()) return []
  try {
    const res = await fetch(buildOsmSearchUrl(query), {
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) return []
    return (await res.json()) as OsmSearchResult[]
  } catch {
    return []
  }
}
