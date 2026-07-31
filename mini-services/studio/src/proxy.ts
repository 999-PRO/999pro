// v16.8 production lockdown: Studio is ADMIN ONLY.
//
// This middleware runs on EVERY request to /studio/* (including direct URL
// access). It checks for the presence of the `studio-auth-token` cookie
// (set by auth-store.ts on login). If no cookie is present, the request is
// rejected with 403 Forbidden — the user sees a "Доступ запрещён" page
// instead of the Studio login screen.
//
// IMPORTANT: this is a PRESENCE-ONLY check. The cookie value is NOT validated
// here (middleware runs on edge runtime without access to JWT_SECRET). The
// real authorization happens:
//   1. Client-side: studio/app/page.tsx checks isAuthenticated && isAdmin
//      (set by fetchMe → /api/auth/me which validates the JWT + role).
//   2. Server-side: every /api/* admin route is protected by requireAdmin
//      middleware in the backend (validates JWT + role on every request).
//
// This middleware adds a third layer: it prevents direct URL access to
// /studio/* from users who have NEVER logged in (no cookie at all). Without
// it, a user navigating to /studio would see the Studio login screen —
// leaking the existence of the admin panel. With it, they see 403.
//
// Users who logged in as non-admins WILL have the cookie (login succeeds,
// cookie is set before fetchMe rejects them). They'll see the Studio's own
// "Доступ запрещён" UI (rendered by app/page.tsx when !isAdmin). This is
// correct behavior — they authenticated but lack the admin role.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_COOKIE_NAME = 'studio-auth-token'

// Minimum length of a valid JWT token (header.payload.signature, each
// base64-encoded). Shorter values are rejected as obvious garbage.
const MIN_TOKEN_LENGTH = 40

export function proxy(req: NextRequest) {
  // DEV MODE BYPASS: only honour the bypass when NODE_ENV === 'development'
  // explicitly. Previously this was `NODE_ENV !== 'production'`, which meant
  // staging/preview environments with NODE_ENV unset or set to 'staging'/
  // 'test' would silently skip the cookie presence-check — leaking the
  // Studio login screen to anyone hitting /studio/* on those environments.
  // The backend's requireAdmin middleware still enforces real auth either
  // way; this is just the third layer (block direct URL access).
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }

  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value

  // No cookie at all → user never logged in to Studio → 403.
  // The 403 page is a simple HTML response (no React, no Studio UI leak).
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    const isHtmlRequest = req.headers.get('accept')?.includes('text/html') ?? true

    if (isHtmlRequest) {
      // Return an HTML 403 page for browser navigation.
      return new NextResponse(
        `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>403 — Доступ запрещён</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 440px;
      width: 100%;
      text-align: center;
    }
    .lock {
      width: 80px;
      height: 80px;
      margin: 0 auto 20px;
      border-radius: 20px;
      background: linear-gradient(135deg, #ef4444, #b91c1c);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40px;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 10px; }
    p { font-size: 15px; color: #a1a1aa; line-height: 1.5; margin-bottom: 6px; }
    .home {
      display: inline-block;
      margin-top: 24px;
      padding: 12px 24px;
      background: #796d47;
      color: #fff;
      text-decoration: none;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 14px;
    }
    .home:hover { background: #8d7f55; }
  </style>
</head>
<body>
  <div class="card">
    <div class="lock">🔒</div>
    <h1>Доступ запрещён</h1>
    <p>Раздел Studio доступен только администраторам.</p>
    <p>Если вы администратор — войдите в систему через основное приложение.</p>
    <a href="/" class="home">На главную</a>
  </div>
</body>
</html>`,
        {
          status: 403,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      )
    }

    // For non-HTML requests (API, static assets) return JSON 403.
    return NextResponse.json(
      { error: 'Доступ запрещён. Требуется авторизация администратора.' },
      { status: 403 },
    )
  }

  // Cookie present — let the request through. Client-side + backend will
  // do the real JWT validation + admin role check.
  return NextResponse.next()
}

// Match all routes under the Studio basePath.
// In Next.js, when `basePath` is set (e.g. /studio), matcher paths are
// expressed RELATIVE to the basePath — so '/' matches '/studio', and
// '/:path*' matches '/studio/anything'.
// We exclude _next/* (static + chunks) and common static files.
export const config = {
  matcher: [
    '/',
    '/((?!_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot)$).*)',
  ],
}
