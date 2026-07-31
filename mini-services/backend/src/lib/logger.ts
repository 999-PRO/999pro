// ============================================================================
// Structured logger — single source of truth for all backend logging.
// ----------------------------------------------------------------------------
// Replaces ad-hoc console.log/error calls with a structured format that's
// easy to ship to log aggregators (Datadog, Loki, CloudWatch, etc.):
//
//   {
//     "level": "info",
//     "time": "2026-07-01T08:30:00.000Z",
//     "msg": "Backend started",
//     "port": 4000,
//     "env": "production",
//     "module": "index"
//   }
//
// Levels: debug | info | warn | error
// In production, debug is suppressed. In development, all levels are logged.
//
// SENTRY INTEGRATION: if SENTRY_DSN is set, error-level logs are also sent
// to Sentry (with the same context). This gives us error tracking + alerting
// without sprinkling Sentry.* calls throughout the codebase.
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const isProd = process.env.NODE_ENV === 'production'
const MIN_LEVEL: LogLevel = isProd ? 'info' : 'debug'

// Sentry is loaded lazily so the dependency is optional.
let sentryInitialized = false
let sentryCaptureException: ((err: Error, ctx?: Record<string, unknown>) => void) | null = null

async function initSentry(): Promise<void> {
  if (sentryInitialized) return
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  try {
    // Dynamic import — @sentry/node is an optional peer dependency.
    // If not installed, we silently skip Sentry integration.
    // The `as any` cast bypasses TypeScript's module resolution so the build
    // does not require @sentry/node to be installed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const moduleLoader: any = await (Function('return import("@sentry/node")') as () => Promise<any>)().catch(() => null)
    const Sentry: any = moduleLoader
    if (!Sentry || typeof Sentry.init !== 'function') return
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1, // 10% of transactions traced (perf monitoring)
      profilesSampleRate: 0.1,
      // AUDIT-3 S-HIGH-004 fix (v16.8): do not send default PII.
      sendDefaultPii: false,
      beforeSend(event: any) {
        // Strip IP + UA + URL query strings from every event.
        if (event.request) {
          delete event.request.ip
          if (event.request.headers) {
            delete event.request.headers['x-forwarded-for']
            delete event.request.headers['x-real-ip']
            delete event.request.headers['forwarded']
            delete event.request.headers['User-Agent']
          }
          if (event.request.url) {
            try {
              const u = new URL(event.request.url)
              u.search = ''
              event.request.url = u.toString()
            } catch { /* not a URL */ }
          }
        }
        if (event.user) {
          delete event.user.ip_address
          delete event.user.userAgent
        }
        return event
      },
    })
    sentryCaptureException = (err: Error, ctx?: Record<string, unknown>) => {
      Sentry.captureException(err, { extra: ctx })
    }
    sentryInitialized = true
    log('info', 'Sentry initialized', { module: 'logger' })
  } catch (e) {
    log('warn', 'Sentry init failed — continuing without error tracking', {
      module: 'logger',
      error: (e as Error).message,
    })
  }
}

// Auto-init on first import (lazy, non-blocking)
void initSentry()

function formatLine(level: LogLevel, msg: string, ctx?: LogContext): string {
  const line: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg,
    module: ctx?.module || 'app',
  }
  // Merge remaining context (excluding module which is already top-level)
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) {
      if (k !== 'module') line[k] = v
    }
  }
  return JSON.stringify(line)
}

export function log(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return

  const line = formatLine(level, msg, ctx)

  if (level === 'error') {
    console.error(line)
    // Forward to Sentry if initialized
    if (sentryCaptureException && ctx?.error instanceof Error) {
      sentryCaptureException(ctx.error, ctx as Record<string, unknown>)
    }
  } else if (level === 'warn') {
    console.warn(line)
  } else if (level === 'debug') {
    console.debug(line)
  } else {
    console.log(line)
  }
}

// Convenience helpers
export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
}

// Express middleware: logs every request with method, url, status, duration, ip.
// In production, samples 10% of requests to avoid log volume explosion.
// v13.2 (audit P1-9 fix): wrap log call in try/finally so the response is
// always sent even if logging throws. Previously, if the structured log
// call threw (e.g. circular reference in ctx), the wrapped res.end would
// re-throw and the client would hang waiting for a response.
// v13.2 (audit P2-4 fix): also sample by status code — log ALL 4xx/5xx,
// sample 1% of 2xx. 90% of production requests had no log; if an attacker
// probed an endpoint 100 times, only ~10 were logged — a forensic gap.
export function requestLogger(req: any, res: any, next: any): void {
  const start = Date.now()
  const origEnd = res.end
  res.end = function (...args: unknown[]) {
    const status = res.statusCode
    // Sample: log all 4xx/5xx, sample 1% of 2xx in prod, log all in dev.
    const shouldLog = !isProd || status >= 400 || Math.random() < 0.01
    if (shouldLog) {
      try {
        const duration = Date.now() - start
        log(status >= 400 ? 'warn' : 'info', 'request', {
          module: 'http',
          method: req.method,
          url: req.originalUrl || req.url,
          status,
          durationMs: duration,
          ip: req.ip || req.socket?.remoteAddress,
          ua: (req.headers['user-agent'] || '').slice(0, 80),
        })
      } catch {
        // logging must never break the response
      }
    }
    return origEnd.apply(this, args as any)
  }
  next()
}
