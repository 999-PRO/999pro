// ============================================================================
// Next.js instrumentation hook — runs once on server startup.
// Wave 3 (C-MON-001): initialize Sentry for both server and client.
//
// AUDIT-3 S-HIGH-004 fix (v16.8): added sendDefaultPii:false + beforeSend
// PII scrubber. Default @sentry/nextjs captures IPs, User-Agents, URLs (which
// may contain query-string PII), and request bodies. Under GDPR Art. 15/17
// this is personal data — must be explicitly opted-out unless the operator
// has a lawful basis. We default to strict (no PII) and let operators opt
// back in by setting SENTRY_SEND_PII=true.
// ============================================================================
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Server-side Sentry init
    const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
    if (SENTRY_DSN) {
      const Sentry = await import('@sentry/nextjs')
      const sendPii = process.env.SENTRY_SEND_PII === 'true'

      // PII scrubber — runs on every event before it's sent to Sentry.
      // Removes IPs, User-Agents, and query strings from URLs even when
      // SENTRY_SEND_PII=true (we never want to leak those without explicit
      // review of what tags/contexts are attached).
      const beforeSend = (event: any) => {
        // Strip IP addresses
        if (event.request) {
          delete event.request.ip
          if (event.request.headers) {
            delete event.request.headers['x-forwarded-for']
            delete event.request.headers['x-real-ip']
            delete event.request.headers['forwarded']
            // Strip User-Agent unless explicitly opted in
            if (!sendPii) delete event.request.headers['User-Agent']
          }
          // Strip query string from URLs (may contain reset tokens, etc.)
          if (event.request.url) {
            try {
              const u = new URL(event.request.url)
              u.search = ''
              event.request.url = u.toString()
            } catch { /* not a URL — leave as-is */ }
          }
        }
        // Strip user IP / user-agent at the event level
        if (event.user) {
          delete event.user.ip_address
          if (!sendPii) delete event.user.userAgent
        }
        return event
      }

      Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.NODE_ENV,
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        // CRITICAL: do not send default PII (IP, UA, cookies, query params)
        sendDefaultPii: false,
        beforeSend,
      })
    }
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime (rarely used in this app)
    const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN
    if (SENTRY_DSN) {
      const Sentry = await import('@sentry/nextjs')
      const beforeSend = (event: any) => {
        if (event.request) {
          delete event.request.ip
          if (event.request.headers) {
            delete event.request.headers['x-forwarded-for']
            delete event.request.headers['x-real-ip']
          }
          if (event.request.url) {
            try {
              const u = new URL(event.request.url)
              u.search = ''
              event.request.url = u.toString()
            } catch { /* not a URL — leave as-is */ }
          }
        }
        if (event.user) {
          delete event.user.ip_address
          delete event.user.userAgent
        }
        return event
      }
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.NODE_ENV,
        tracesSampleRate: 0.1,
        sendDefaultPii: false,
        beforeSend,
      })
    }
  }
}
