// ============================================================================
//  Public URL resolver — frontend single source of truth.
//  ----------------------------------------------------------------------------
//  Same logic as backend's lib/public-url.ts, but adapted for the browser
//  environment. Used by:
//    • Share page (/p/[shortId]) — for OG tags, canonical, CTAs
//    • Sitemap (sitemap.ts) — for URL generation
//    • useShareLink hook — for fallback URLs
//    • layout.tsx — for global OG/canonical
//
//  Resolution order:
//    1. NEXT_PUBLIC_APP_URL env var (set at build time, exposed to client)
//    2. APP_PUBLIC_URL env var (server-only fallback)
//    3. window.location.origin (browser runtime — works in any deployment)
//    4. req.headers.host (server runtime — for SSR)
//
//  CRITICAL: this replaces the old hardcoded "https://999.pro" which caused
//  a bug where share links pointed at a domain we don't control.
// ============================================================================

/**
 * Get the public app URL.
 *
 * On the server (SSR / API routes / sitemap): pass `req` or `headers` to
 * derive the URL from the request. Without context, falls back to env vars.
 *
 * In the browser: uses window.location.origin — always correct for the
 * current deployment (sandbox preview, customer domain, etc.).
 */
export function getPublicUrl(req?: {
  headers?: Record<string, string | string[] | undefined>
}): string {
  // 1. Browser runtime — ALWAYS checked first. window.location.origin is
  //    always correct for the current deployment (sandbox preview, customer
  //    domain, localhost dev). NEXT_PUBLIC_APP_URL is baked at BUILD time
  //    and won't reflect the actual runtime domain — so it must NOT take
  //    priority over the live origin.
  if (typeof window !== 'undefined') {
    return window.location.origin.replace(/\/$/, '')
  }

  // 2. Server-side env vars (production override — operators set
  //    APP_PUBLIC_URL to their real domain so SSR OG tags / sitemap are
  //    stable across sandbox rebuilds)
  if (typeof process !== 'undefined') {
    const envUrl = process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL
    if (envUrl && !envUrl.includes('localhost')) return envUrl.replace(/\/$/, '')
  }

  // 3. Server request context — derive from headers (most accurate for SSR)
  if (req?.headers) {
    const host = getHostFromHeaders(req.headers)
    const proto = getProtoFromHeaders(req.headers)
    if (host) return `${proto}://${host}`.replace(/\/$/, '')
  }

  // 4. Last-resort dev fallback (server-side only — browser already returned)
  return 'http://localhost:3000'
}

/**
 * Build a share URL for a product's shortId.
 */
export function buildShareUrl(shortId: string, req?: {
  headers?: Record<string, string | string[] | undefined>
}): string {
  return `${getPublicUrl(req)}/p/${shortId}`
}

// v9-audit-fix: dead code removal — buildDeepLinkUrl() and buildWebAppUrl()
// were exported but never imported anywhere. The /dl/[shortId] route exists
// but is reached via window.location redirects, not via this helper.
// Restore from git history if needed.

// ----------------------------------------------------------------------------
//  Helpers for parsing request headers
// ----------------------------------------------------------------------------

function getHostFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const xfh = pickHeader(headers, 'x-forwarded-host')
  if (xfh) return xfh.split(',')[0].trim() || null
  const host = pickHeader(headers, 'host')
  if (host) return host.trim()
  return null
}

function getProtoFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const xfp = pickHeader(headers, 'x-forwarded-proto')
  if (xfp) {
    return xfp.split(',')[0].trim() === 'https' ? 'https' : 'http'
  }
  return 'http'
}

function pickHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  // Headers may be lowercased or mixed-case depending on the runtime.
  // We check both.
  return (headers[name] as string | undefined) || (headers[name.toLowerCase()] as string | undefined)
}
