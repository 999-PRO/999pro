// ============================================================================
//  /.well-known/assetlinks.json — Android App Links config.
//  ----------------------------------------------------------------------------
//  v9-audit-fix (C-1): Android's verifier fetches this file at the
//  /.well-known/ path (NOT just /). The static file in /public/.well-known/
//  contained a placeholder SHA-256 fingerprint, so App Links verification
//  silently failed in production. This dynamic route reads from env vars so
//  operators can configure their real signing key without rebuilding.
//
//  Env vars:
//    ANDROID_PACKAGE_NAME     — Android package name (default: "pro.ninehundred.app")
//    ANDROID_SHA256_FINGERPRINT — SHA-256 fingerprint of app signing key (REQUIRED for prod)
// ============================================================================

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'pro.ninehundred.app'
  const sha256Fingerprint =
    process.env.ANDROID_SHA256_FINGERPRINT ||
    'PLACEHOLDER_REPLACE_WITH_YOUR_SIGNING_KEY_SHA256_FINGERPRINT'

  // v24.7 (final-release audit): fail-fast in production when
  // ANDROID_SHA256_FINGERPRINT is unset. See /assetlinks.json/route.ts for rationale.
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

  if (sha256Fingerprint.startsWith('PLACEHOLDER')) {
    console.warn(
      '[ASSETLINKS] ANDROID_SHA256_FINGERPRINT env var not set — using placeholder. ' +
        'App Links will NOT work on Android until a real SHA-256 fingerprint is configured.',
    )
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
