'use client'

// ============================================================================
// Sentry client-side initialization
// Wave 3 (C-MON-001): error tracking for browser errors + React error boundary
// ----------------------------------------------------------------------------
// This component is mounted once in the root layout. It initializes Sentry
// on the client side when NEXT_PUBLIC_SENTRY_DSN is set.
// ============================================================================

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
    if (!dsn) return  // no-op in dev without DSN

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: false,
          blockAllMedia: false,
        }),
      ],
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Network request failed',
        'Failed to fetch',
      ],
      denyUrls: [
        /chrome-extension:/,
        /moz-extension:/,
        /safari-extension:/,
      ],
    })
  }, [])

  return null
}

/**
 * Capture an exception manually (for caught errors that should still be reported).
 * Usage: captureError(new Error('something failed'), { extra: { userId } })
 */
export function captureError(error: Error, context?: Record<string, unknown>) {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(error, { extra: context })
  } else {
    // Fallback: console.error in dev
    console.error('[captureError]', error, context)
  }
}
