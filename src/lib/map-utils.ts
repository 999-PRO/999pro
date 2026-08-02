// Map utilities — generate universal map URLs that work on every platform.
//
// v25.3 (TZ task #5): switched from Google Maps to Yandex Maps URLs.
// Google Maps URLs were broken in the deployment region (Yandex Browser /
// Russian locale / slow DNS) — the in-app Yandex Maps picker worked, but
// the external "Open in maps" button pointed at maps.google.com which
// either timed out or opened an empty page. Now every "open in maps"
// link uses Yandex Maps, matching the working in-app picker.
//
// Strategy: use a single https://yandex.ru/maps/?... link. On desktop
// it opens Yandex Maps in the browser; on Android it opens the Yandex Maps
// app if installed, otherwise the browser version; on iOS it opens the
// Yandex Maps app if installed, otherwise the browser version. Yandex
// Maps has full Russian street/POI coverage and works reliably in the
// deployment region.

export interface GeoPoint {
  lat: number
  lng: number
  label?: string
}

/**
 * Build a universal https maps URL that opens the right app per platform.
 * v25.3: uses Yandex Maps (was Google Maps — see file header for rationale).
 *
 * The `pt` parameter accepts `lat,lng` and an optional `style` suffix.
 * Yandex Maps URL format:
 *   https://yandex.ru/maps/?pt=LAT,LNG&z=16&l=map
 *
 * For a labelled point we use Yandex's `text` parameter, which performs a
 * search and centres the map on the result. When only coordinates are
 * available we use `pt` to drop a pin.
 */
export function buildMapUrl(lat: number, lng: number, label?: string): string {
  // v25.3: Yandex Maps URL — works reliably in the deployment region.
  // pt = point (lat,lng), z = zoom level, l = layer (map = standard).
  // The `text` parameter is used when we have a label, which makes Yandex
  // search for the label text and show it as a named pin.
  if (label) {
    return `https://yandex.ru/maps/?text=${encodeURIComponent(label)}&pt=${lat},${lng}&z=16&l=map`
  }
  return `https://yandex.ru/maps/?pt=${lat},${lng}&z=16&l=map`
}

/**
 * Build a geo: URI (RFC 5870). On mobile, opening this URL triggers the
 * native maps-app chooser. On desktop browsers it usually does nothing —
 * so only use this for the "native app" path, not as the primary link.
 *
 * v25.3: still uses raw geo: URI (universal standard, not vendor-specific).
 * The user's device shows its native maps-app chooser, which on Android
 * includes Yandex Maps if installed. On iOS the chooser shows Apple Maps
 * (Yandex Maps iOS app can register for geo: URIs too if installed).
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
 *
 * v25.3: Yandex Maps route URL — `rtext=from~to` accepts coordinates or
 * addresses separated by `~`. The `rtt` parameter controls route mode
 * (auto / mt / pd = mass transit / pedestrian).
 */
export function buildRouteUrl(from: GeoPoint | null, to: GeoPoint, label?: string): string {
  const dest = label ? `${encodeURIComponent(label)}` : `${to.lat},${to.lng}`
  if (from) {
    return `https://yandex.ru/maps/?rtext=${from.lat},${from.lng}~${to.lat},${to.lng}&rtt=auto&z=12&l=map`
  }
  return `https://yandex.ru/maps/?text=${dest}&pt=${to.lat},${to.lng}&z=16&l=map`
}

/**
 * Build an OpenStreetMap embed iframe src for in-app map preview (no API
 * key required). Used by the map picker to show a preview after the user
 * selects a point.
 *
 * v25.3: OSM embed retained as a fallback for the in-app preview (the
 * Yandex Maps JS API is used for the actual map picker — see
 * components/map-picker.tsx). This OSM URL is only used for the static
 * preview iframe, not for the "open in maps" external link.
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
