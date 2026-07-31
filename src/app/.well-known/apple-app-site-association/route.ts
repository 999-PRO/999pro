// ============================================================================
//  /.well-known/apple-app-site-association — iOS Universal Links config.
//  ----------------------------------------------------------------------------
//  v9-audit-fix (C-2): iOS 13+ prefers the root path but falls back to
//  /.well-known/ on CDN misconfiguration. The static file at
//  /public/.well-known/apple-app-site-association contained the literal
//  placeholder "TEAMID.pro.ninehundred.app" and was missing the /studio/,
//  /api/, /og/ exclude rules — Universal Links would silently fail when
//  iOS fell back to this file, and Studio admin URLs would attempt to open
//  in the native app.
//
//  Env vars:
//    APPLE_TEAM_ID    — 10-character Apple Developer Team ID (REQUIRED for prod)
//    APPLE_BUNDLE_ID  — iOS app bundle ID (default: "pro.ninehundred.app")
// ============================================================================

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID || 'TEAMID'
  const bundleId = process.env.APPLE_BUNDLE_ID || 'pro.ninehundred.app'
  const appId = `${teamId}.${bundleId}`

  // v24.7 (final-release audit): fail-fast in production when APPLE_TEAM_ID
  // is unset. See /apple-app-site-association/route.ts for rationale.
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd && (teamId === 'TEAMID' || !teamId)) {
    return new NextResponse(
      JSON.stringify({
        error: 'APPLE_TEAM_ID env var not set — iOS Universal Links cannot be configured.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  if (teamId === 'TEAMID') {
    console.warn(
      '[AASA] APPLE_TEAM_ID env var not set — using placeholder "TEAMID". ' +
        'Universal Links will NOT work on iOS until a real Team ID is configured.',
    )
  }

  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [appId],
          components: [
            { '/': '/p/*', exclude: false, comment: 'Smart Share product page (Universal Link opens app)' },
            { '/': '/dl/*', exclude: false, comment: 'Smart Share deep link handler' },
            { '/': '/studio/*', exclude: true, comment: 'Studio admin panel — keep in browser' },
            { '/': '/api/*', exclude: true, comment: 'API endpoints — keep in browser' },
            { '/': '/og/*', exclude: true, comment: 'OG image proxy — keep in browser' },
            { '/': '/*', exclude: false, comment: 'Catch-all — opens the app for any other path' },
          ],
        },
      ],
    },
    webcredentials: {
      apps: [appId],
    },
    activitycontinuation: {
      apps: [appId],
    },
  }

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
