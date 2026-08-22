// v16.8 production lockdown: Studio is ADMIN ONLY.
//
// v25 CHANGE: Previously this proxy returned a hard 403 for ANY
// unauthenticated request (HTML or non-HTML) in production. That blocked
// the first-run setup wizard — the operator couldn't reach /studio at all
// until they had a valid auth cookie, but they couldn't get a cookie
// without completing setup. The chicken-and-egg forced the old flow
// (curl + X-Setup-Admin-Token) which we're explicitly removing.
//
// v25.2-CORS-FIX: The proxy was ALSO blocking /api/* requests that the
// browser's fetch() sends as part of normal app operation (register, login,
// admin-exists check). Those requests are non-HTML (Content-Type: application/json)
// and don't carry the auth cookie (the user isn't logged in yet). The proxy
// returned 403 for them, which the browser interpreted as a CORS failure
// because the 403 response had no Access-Control-Allow-Origin header.
// This broke registration completely.
//
// Now: /api/* requests are EXCLUDED from the proxy matcher. They flow
// through to next.config.ts rewrites() which proxies them to the backend
// server-side (no CORS, no cookie check). The backend's own auth middleware
// (requireAuth, requireAdmin) handles authorization per-route.
//
// New behaviour:
//   - /api/* requests → always pass through (backend handles auth).
//   - HTML requests (browser navigation) → check the `studio-access` cookie
//     (v25.13 — see below). If STUDIO_ACCESS_TOKEN env is NOT set, behave
//     as before (always pass through HTML — page.tsx decides what to render).
//     If STUDIO_ACCESS_TOKEN IS set, HTML requests WITHOUT a valid
//     `studio-access` cookie get a 404 (looks like /studio doesn't exist —
//     hides Studio from random visitors).
//   - Non-HTML unauthenticated requests to NON-API paths (curl probes,
//     scanners) still get a 403 JSON. This keeps the "don't leak Studio's
//     existence to automated scanners" property for non-browser traffic.
//   - In development mode the proxy is a full pass-through (unchanged).
//
// v25.13 (hidden Studio access):
//   Operators who want /studio to be INVISIBLE to non-admin visitors can set
//   STUDIO_ACCESS_TOKEN env var in the Studio environment. When set:
//     1. Backend `routes/auth.ts` sets an httpOnly cookie `studio-access`
//        on every successful admin login (and clears it on logout).
//     2. This middleware checks that cookie on every HTML navigation to
//        /studio. If the cookie is missing or doesn't match the env var,
//        the middleware returns 404 (so the URL looks uninteresting to
//        anyone scanning the domain).
//   If STUDIO_ACCESS_TOKEN is NOT set, this middleware behaves as before
//   (HTML requests always pass through — Studio is publicly reachable at
//   /studio by anyone who knows the URL).
//
// Real authorization still happens:
//   1. Client-side: studio/app/page.tsx checks isAuthenticated && isAdmin.
//   2. Server-side: every /api/* admin route is protected by requireAdmin
//      in the backend (validates JWT + role on every request).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_COOKIE_NAME = 'studio-auth-token'
const STUDIO_ACCESS_COOKIE_NAME = 'studio-access'
const MIN_TOKEN_LENGTH = 40

export function proxy(req: NextRequest) {
  // DEV MODE BYPASS: development environments don't need the cookie
  // presence-check. Page.tsx still does real auth client-side.
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }

  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value
  const hasValidCookie = !!token && token.length >= MIN_TOKEN_LENGTH

  // Authenticated (cookie present) OR HTML browser navigation → consider
  // passing through. We still need to check the studio-access cookie below
  // if STUDIO_ACCESS_TOKEN env is set.
  const isHtmlRequest = req.headers.get('accept')?.includes('text/html') ?? true
  if (hasValidCookie || isHtmlRequest) {
    // v25.13 (hidden Studio access): if STUDIO_ACCESS_TOKEN env is set,
    // check the `studio-access` cookie on HTML navigations. If it's missing
    // or doesn't match, return 404 (NOT 403 — 404 makes the URL look like
    // it doesn't exist, which is what we want for hidden-Studio mode).
    //
    // Authenticated users (with `studio-auth-token` JWT cookie) are NOT
    // exempt — they STILL need the `studio-access` cookie. In practice
    // the backend sets both cookies at the same time on admin login, so
    // a legit admin will always have both. This is defense-in-depth:
    // someone who steals a JWT can't use it to access /studio directly
    // because they don't have the `studio-access` cookie.
    const studioAccessToken = process.env.STUDIO_ACCESS_TOKEN
    if (studioAccessToken && isHtmlRequest) {
      const accessCookie = req.cookies.get(STUDIO_ACCESS_COOKIE_NAME)?.value
      if (accessCookie !== studioAccessToken) {
        // Return 404 with a generic HTML page so /studio looks like a
        // non-existent route to anyone without the access cookie. Don't
        // leak Studio's existence — no admin-panel chrome, no login form,
        // no hint that /studio exists at all.
        //
        // We use a hand-written HTML response (not NextResponse.rewrite to
        // /404) because:
        //   1. With basePath=/studio, rewriting to '/404' may resolve to
        //      '/studio/404' which doesn't exist either.
        //   2. We want the URL in the browser to STAY as /studio (so the
        //      visitor doesn't see a redirect), but the response to be 404.
        //   3. A plain HTML 404 page is universally understood and doesn't
        //      leak any app-specific chrome.
        const html404 = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>404 Not Found</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #333; text-align: center; padding: 4rem 1rem; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  p { color: #666; font-size: 1rem; }
</style>
</head>
<body>
  <h1>404</h1>
  <p>The page you are looking for does not exist.</p>
</body>
</html>`
        return new NextResponse(html404, {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
    }
    return NextResponse.next()
  }

  // Non-HTML unauthenticated request (curl, API probe, etc.) → 403 JSON.
  // This preserves the "don't leak Studio to scanners" property without
  // blocking the browser-based first-run wizard.
  // NOTE: /api/* requests are EXCLUDED from the matcher (see config below),
  // so they never reach this point — they flow through to the backend via
  // next.config.ts rewrites().
  return NextResponse.json(
    { error: 'Доступ запрещён. Требуется авторизация администратора.' },
    { status: 403 },
  )
}

// Match all routes under the Studio basePath EXCEPT /api/* and /uploads/*
// and /socket.io/* — those are proxied to the backend by next.config.ts
// rewrites() and must NOT be intercepted by this middleware (otherwise
// the 403 response breaks browser fetch() calls with a CORS-like error).
//
// In Next.js, when `basePath` is set (e.g. /studio), matcher paths are
// expressed RELATIVE to the basePath — so '/' matches '/studio', and
// '/:path*' matches '/studio/anything'. The negative lookahead `(?!api/)`
// excludes /studio/api/* from the matcher.
export const config = {
  matcher: [
    '/',
    '/((?!api/|uploads/|socket\\.io/|_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot)$).*)',
  ],
}
