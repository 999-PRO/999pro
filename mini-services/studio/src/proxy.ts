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
//   - HTML requests (browser navigation) → always pass through.
//     page.tsx decides what to render: the setup wizard when no admin
//     exists, the login dialog when an admin exists but the visitor
//     isn't authenticated, or the dashboard when authenticated.
//   - Non-HTML unauthenticated requests to NON-API paths (curl probes,
//     scanners) still get a 403 JSON. This keeps the "don't leak Studio's
//     existence to automated scanners" property for non-browser traffic.
//   - In development mode the proxy is a full pass-through (unchanged).
//
// Real authorization still happens:
//   1. Client-side: studio/app/page.tsx checks isAuthenticated && isAdmin.
//   2. Server-side: every /api/* admin route is protected by requireAdmin
//      in the backend (validates JWT + role on every request).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_COOKIE_NAME = 'studio-auth-token'
const MIN_TOKEN_LENGTH = 40

export function proxy(req: NextRequest) {
  // DEV MODE BYPASS: development environments don't need the cookie
  // presence-check. Page.tsx still does real auth client-side.
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }

  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value
  const hasValidCookie = !!token && token.length >= MIN_TOKEN_LENGTH

  // Authenticated (cookie present) OR HTML browser navigation → let through.
  // The HTML case lets the first-run wizard render when no admin exists,
  // and lets the login dialog render when an admin exists but the visitor
  // isn't logged in. Page.tsx handles both cases.
  const isHtmlRequest = req.headers.get('accept')?.includes('text/html') ?? true
  if (hasValidCookie || isHtmlRequest) {
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
