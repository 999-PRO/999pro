// ============================================================================
//  Public URL resolver — single source of truth for share link generation.
//  ----------------------------------------------------------------------------
//  Why this exists:
//  Previously the backend hardcoded `https://999.pro` as the public URL for
//  share links. This caused a critical bug: when the app ran on a different
//  domain (sandbox preview, staging, customer's real domain like
//  999pro.ru, etc.), share links still pointed at `999.pro` — a domain we
//  don't control. WhatsApp / Telegram / Facebook crawlers fetched OG tags
//  from `999.pro` (not us), so users saw either a broken preview or a
//  wrong third-party site.
//
//  Resolution order (highest priority first):
//    1. APP_PUBLIC_URL env var (operator sets it in production)
//    2. The request's own Host header (so links always match the domain
//       the user is currently visiting — works in sandbox, staging, etc.)
//    3. Fallback: http://localhost:3000 (dev only — never used in prod)
//
//  The X-Forwarded-Host header (set by reverse proxies like Caddy / nginx)
//  takes precedence over Host, because behind a proxy Host is the internal
//  hostname (e.g. localhost:3000) not the public one.
// ============================================================================

import type { Request } from 'express'

/** Env-configured public URL (without trailing slash). Null if not set. */
const ENV_PUBLIC_URL = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '') || null

/**
 * Resolve the public app URL for the given request.
 *
 * Returns a string like "https://999pro.ru" or "https://preview-z1.space-z.ai"
 * — NEVER includes a trailing slash.
 *
 * Strategy:
 *   1. APP_PUBLIC_URL env var (production operator override)
 *   2. Forwarded-Host header (when behind a trusted reverse proxy)
 *   3. Host header (the actual domain the user is visiting)
 *   4. http://localhost:3000 (last-resort dev fallback)
 */
export function resolvePublicUrl(req?: Request): string {
  // 1. Env override — always wins. Operators set this to their production
  // domain (e.g. https://999pro.ru) so share links are stable across
  // sandbox / staging / prod environments.
  if (ENV_PUBLIC_URL) return ENV_PUBLIC_URL

  // 2. Derive from the request itself. This makes share links work
  // correctly in any environment without configuration — sandbox preview,
  // staging, customer's domain, etc.
  if (req) {
    const proto = getRequestProtocol(req)
    const host = getRequestHost(req)
    if (host) {
      return `${proto}://${host}`.replace(/\/$/, '')
    }
  }

  // 3. Last-resort fallback — only reached when no env var AND no request
  // context (e.g. background job, cron, CLI script).
  return 'http://localhost:3000'
}

/**
 * Resolve the request's protocol (http or https).
 *
 * v13.1 (audit P2-1 fix): use `req.protocol` instead of reading the
 * X-Forwarded-Proto header directly. `req.protocol` respects the Express
 * `trust proxy` setting (configured in index.ts based on TRUST_PROXY env).
 * Previously this read the header directly — bypassing trust proxy — so an
 * attacker on a non-proxied connection could send X-Forwarded-Proto: https
 * to make share links use https://localhost:3000 even when the actual
 * connection was HTTP.
 */
function getRequestProtocol(req: Request): string {
  // req.protocol respects trust proxy config — only honours X-Forwarded-*
  // headers when the Express app explicitly trusts the proxy.
  return (req as any).protocol || 'http'
}

/**
 * Resolve the request's public host.
 *
 * Behind a reverse proxy, X-Forwarded-Host is the original host the user
 * typed (e.g. preview-z1.space-z.ai). The Host header alone would be
 * the internal hostname (localhost:3000).
 */
function getRequestHost(req: Request): string | null {
  const xfh = req.headers['x-forwarded-host'] as string | undefined
  if (xfh) {
    // Can be a comma list — take the first.
    return xfh.split(',')[0].trim() || null
  }
  const host = req.headers['host'] as string | undefined
  if (host) return host.trim()
  return null
}

/**
 * Build a share URL for a product's shortId.
 *
 * Used by the share routes to construct /p/<shortId> links. The URL
 * points to the frontend (Next.js), NOT the backend API.
 */
export function buildShareUrl(shortId: string, req?: Request): string {
  return `${resolvePublicUrl(req)}/p/${shortId}`
}

/**
 * Build a deep link URL for a product's shortId.
 *
 * Deep links are used in QR codes and "Open in app" buttons. The /dl/
 * route tries to open the installed app via Universal Links / App Links,
 * and falls back to the share page (/p/<shortId>) if the app isn't
 * installed.
 */
export function buildDeepLinkUrl(shortId: string, req?: Request): string {
  return `${resolvePublicUrl(req)}/dl/${shortId}`
}

/**
 * Build a "open product in web app" URL.
 *
 * Used by the share page's "Открыть в браузере" button — opens the
 * main app at /?product=<productId> so the SPA routes to the product
 * page directly.
 */
export function buildWebAppUrl(productId: string, req?: Request): string {
  return `${resolvePublicUrl(req)}/?product=${encodeURIComponent(productId)}`
}
