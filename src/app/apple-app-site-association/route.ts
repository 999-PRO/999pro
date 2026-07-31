// ============================================================================
//  /apple-app-site-association — iOS Universal Links config.
//  ----------------------------------------------------------------------------
//  iOS requires this file to be served from the domain ROOT (not under
//  /.well-known/) with Content-Type: application/json.
//
//  v9-audit-fix: generates JSON dynamically from env vars so operators can
//  configure their real Apple Team ID without rebuilding. The static file in
//  /public/.well-known/ is kept as a reference template.
//
//  Env vars:
//    APPLE_TEAM_ID    — 10-character Apple Developer Team ID (REQUIRED for prod)
//    APPLE_BUNDLE_ID  — iOS app bundle ID (default: "pro.ninehundred.app")
//
//  Reference: https://developer.apple.com/documentation/safariservices/
//             supporting_associated_domains
// ============================================================================

import { NextResponse } from 'next/server'

export const dynamic = 'force-static'
export const revalidate = false

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID || 'TEAMID'
  const bundleId = process.env.APPLE_BUNDLE_ID || 'pro.ninehundred.app'
  const appId = `${teamId}.${bundleId}`

  // v24.7 (final-release audit): fail-fast in production when APPLE_TEAM_ID
  // is unset. Previously the route silently served a placeholder Team ID,
  // which makes iOS Universal Links fail in a way that's hard to debug
  // (iOS caches the AASA for 24h, so the operator sees nothing wrong until
  // users report "tapping the link doesn't open the app"). In dev/preview
  // we keep the lenient placeholder behaviour so the route doesn't 500
  // during local testing.
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

  // Warn once at startup if using placeholder (dev only)
  if (teamId === 'TEAMID' && !((global as any)._aasaWarned)) {
    ;(global as any)._aasaWarned = true
    console.warn('[AASA] APPLE_TEAM_ID env var not set — using placeholder "TEAMID". Universal Links will NOT work on iOS until a real Team ID is configured.')
  }

  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [appId],
          components: [
            {
              '/': '/p/*',
              exclude: false,
              comment: 'Smart Share — public product share page (Universal Link opens app at this product)',
            },
            {
              '/': '/dl/*',
              exclude: false,
              comment: 'Smart Share — deep link handler (Universal Link opens app at this product)',
            },
            // v9-audit-fix: exclude /studio/, /api/, /og/ from Universal Links
            // so admins tapping Studio links in Messages don't get bounced to the app.
            { '/': '/studio/*', exclude: true, comment: 'Studio admin panel — keep in browser' },
            { '/': '/api/*', exclude: true, comment: 'API endpoints — keep in browser' },
            { '/': '/og/*', exclude: true, comment: 'OG image proxy — keep in browser' },
            {
              '/': '/*',
              exclude: false,
              comment: 'Catch-all — opens the app for any other path on this domain',
            },
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
