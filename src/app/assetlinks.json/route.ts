// ============================================================================
//  /assetlinks.json — Android App Links config.
//  ----------------------------------------------------------------------------
//  Android requires this file to be served from the domain ROOT (not under
//  /.well-known/) with Content-Type: application/json.
//
//  v9-audit-fix: generates JSON dynamically from env vars so operators can
//  configure their real signing key fingerprint without rebuilding. The static
//  file in /public/.well-known/ is kept as a reference template.
//
//  Env vars:
//    ANDROID_PACKAGE_NAME     — Android package name (default: "pro.ninehundred.app")
//    ANDROID_SHA256_FINGERPRINT — SHA-256 fingerprint of app signing key (REQUIRED for prod)
//
//  Reference: https://developer.android.com/training/app-links/verify-site-
//             associations
// ============================================================================

import { NextResponse } from 'next/server'

export const dynamic = 'force-static'
export const revalidate = false

export async function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'pro.ninehundred.app'
  const sha256Fingerprint = process.env.ANDROID_SHA256_FINGERPRINT || 'PLACEHOLDER_REPLACE_WITH_YOUR_SIGNING_KEY_SHA256_FINGERPRINT'

  // v24.7 (final-release audit): fail-fast in production when
  // ANDROID_SHA256_FINGERPRINT is unset. Previously the route silently
  // served a placeholder fingerprint, which causes Android App Links
  // verification to fail silently (Play Console reports "Asset Statement
  // failure" but the operator may not notice until users report deep
  // links don't open the app). In dev/preview we keep the lenient
  // placeholder behaviour so the route doesn't 500 during local testing.
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd && (sha256Fingerprint.startsWith('PLACEHOLDER') || !sha256Fingerprint)) {
    return new NextResponse(
      JSON.stringify({
        error: 'ANDROID_SHA256_FINGERPRINT env var not set — Android App Links cannot be configured.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // Warn once at startup if using placeholder (dev only)
  if (sha256Fingerprint.startsWith('PLACEHOLDER') && !((global as any)._assetlinksWarned)) {
    ;(global as any)._assetlinksWarned = true
    console.warn('[ASSETLINKS] ANDROID_SHA256_FINGERPRINT env var not set — using placeholder. App Links will NOT work on Android until a real SHA-256 fingerprint is configured.')
  }

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: [sha256Fingerprint],
      },
    },
  ]

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
