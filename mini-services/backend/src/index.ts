import 'dotenv/config'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
// v16.10: Force IPv4-first DNS resolution. The sandbox has no IPv6 routing
// (ENETUNREACH for all IPv6 destinations), and Node's "Happy Eyeballs"
// implementation gives up too quickly when the IPv6 attempt fails — causing
// ETIMEDOUT for hosts that resolve to both IPv4 + IPv6 (e.g. RadioBrowser's
// Iranian mirror de1.api.radio-browser.info). Setting ipv4first globally
// fixes this for all outbound fetch() calls (iTunes, Audius, RadioBrowser,
// alquran.cloud, Cobalt).
import dns from 'node:dns'
dns.setDefaultResultOrder('ipv4first')
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import { Server as IoServer } from 'socket.io'

import { prisma } from './lib/prisma.js'
import { requireAuth, requireAdmin } from './lib/auth.js'
// Wave 3 (B-DEAD-001 + B-PROD-002): wire the structured logger — replaces
// ad-hoc console.log/error calls with JSON-formatted structured logs that
// can be shipped to log aggregators. Also auto-inits Sentry if SENTRY_DSN is set.
import { logger, requestLogger, log } from './lib/logger.js'
import { registerChatHandlers } from './socket/handlers.js'
// v16.8-final: voice message self-destruct scheduler.
import { startSelfDestructScheduler, stopSelfDestructScheduler } from './lib/self-destruct-scheduler.js'
import authRoutes from './routes/auth.js'
import usersRoutes from './routes/users.js'
import productsRoutes from './routes/products.js'
// v12.3.1: storiesRoutes RESTORED (Stories is a standalone module — not Feed).
// v12.3: postsRoutes / commentsRoutes / likesRoutes remain removed with Feed.
import storiesRoutes from './routes/stories.js'
import chatRoutes from './routes/chat.js'
import uploadRoutes from './routes/upload.js'
import bannersRoutes from './routes/banners.js'
import departmentsRoutes from './routes/departments.js'
import infoPagesRoutes from './routes/info-pages.js'
import moderationRoutes from './routes/moderation.js'
import settingsRoutes from './routes/settings.js'
import analyticsRoutes from './routes/analytics.js'
import pushRoutes from './routes/push.js'
import leadsRoutes from './routes/leads.js'
import ordersRoutes from './routes/orders.js'
import deliveryRoutes from './routes/delivery.js'
import reviewsRoutes from './routes/reviews.js'
import searchRoutes from './routes/search.js'
import universalSearchRoutes from './routes/universal-search.js'
import callsRoutes from './routes/calls.js'
import auditRoutes from './routes/audit.js'
import shareRoutes from './routes/share.js'
// v12.4: 999 CLUB Phase 2 — full backend with CRUD + points + referrals.
import clubRoutes from './routes/club.js'
// v16.9.2: Audio Hub — search proxy (iTunes API) + stream proxy for offline cache.
import audioHubRoutes from './routes/audio-hub.js'
import filmsRoutes from './routes/films.js'
import liveInfoRoutes from './routes/live-info.js'
// v18.5: AI Assistant — DeepSeek-powered chat + Knowledge Base CRUD.
import aiRoutes from './routes/ai.js'
// v18.5: AI TTS (placeholder for future cloud TTS — currently client-side Web Speech API).
import aiTtsRoutes from './routes/ai-tts.js'
// v19.0: Multi-provider AI configuration + promo codes + security + 2FA backup codes
import aiProvidersRoutes from './routes/ai-providers.js'
// v8: Studio AI Assistant — встроенный AI в редакторах товаров и Stories
import aiStudioRoutes from './routes/ai-studio.js'
import promoCodesRoutes from './routes/promo-codes.js'
import securityRoutes from './routes/security.js'

// ============================================================================
// Environment
// ============================================================================
const PORT = Number(process.env.PORT ?? 4000)
const NODE_ENV = process.env.NODE_ENV || 'development'
const isProd = NODE_ENV === 'production'

// Allow both the main app (3000) and Studio (3001) to call the API.
// In dev, also allow any LAN IP origin so phones/tablets can reach the API.
const CLIENT_ORIGIN_RAW = process.env.CLIENT_ORIGIN || 'http://localhost:3000,http://localhost:3001'
const CLIENT_ORIGIN = CLIENT_ORIGIN_RAW.split(',').map((s) => s.trim()).filter(Boolean)

/**
 * CORS origin checker.
 *
 * In development: allow any origin on localhost or LAN IPs (so the app works
 * when opened from a phone at http://192.168.x.x:3000), plus any *.space-z.ai
 * subdomain (the sandbox/preview gateway) and the wildcard `*` if configured.
 *
 * In production: only allow the configured CLIENT_ORIGIN allowlist
 * (or everything if CLIENT_ORIGIN contains `*`).
 */
function corsOrigin(origin: string | undefined, callback: (err: Error | null, ok?: boolean) => void) {
  // Allow same-origin requests (no Origin header, e.g. curl, server-to-server)
  if (!origin) return callback(null, true)

  // Wildcard shortcut: if CLIENT_ORIGIN contains `*`, allow every origin.
  // In production this is REJECTED — wildcards are dev-only.
  if (CLIENT_ORIGIN.includes('*')) {
    if (isProd) {
      logger.warn('CORS CLIENT_ORIGIN=* forbidden in production', { module: 'cors', origin })
      return callback(null, false)
    }
    return callback(null, true)
  }

  // Production: strict allowlist
  if (isProd) {
    if (CLIENT_ORIGIN.includes(origin)) return callback(null, true)
    // Also allow any *.space-z.ai preview subdomain in prod (sandbox gateway)
    try {
      const url = new URL(origin)
      if (url.hostname === 'space-z.ai' || url.hostname.endsWith('.space-z.ai')) {
        return callback(null, true)
      }
    } catch {}
    return callback(null, false)
  }

  // Development: allow localhost + LAN IPs on any port
  try {
    const url = new URL(origin)
    const host = url.hostname
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(host) ||
      host.endsWith('.local')
    ) {
      return callback(null, true)
    }
    // Sandbox preview gateway: any *.space-z.ai subdomain (e.g. preview-<bot-id>.space-z.ai)
    if (host === 'space-z.ai' || host.endsWith('.space-z.ai')) {
      return callback(null, true)
    }
  } catch {}
  // Fallback: allow configured origins
  if (CLIENT_ORIGIN.includes(origin)) return callback(null, true)
  callback(null, false)
}

// ============================================================================
// Express app
// ============================================================================
const app = express()
const httpServer = http.createServer(app)

// Trust proxy — B-CRIT-003 fix: only trust proxy when explicitly configured.
// Previously: app.set('trust proxy', 1) unconditionally → attackers could spoof
// X-Forwarded-For to bypass ALL rate limiters (auth, upload, admin-reset).
// Now: in dev, do NOT trust any proxy (req.ip = socket.remoteAddress).
//      in prod, trust only explicit CIDR allowlist (loopback + private nets).
if (process.env.TRUST_PROXY === 'true') {
  // Explicit opt-in: trust loopback + linklocal + uniquelocal (RFC1918) as proxies.
  // For multi-hop prod (Cloudflare → Caddy → backend), set TRUST_PROXY=true and
  // ensure Caddy sets X-Forwarded-For correctly (Cloudflare's IP is public, so
  // it won't be trusted — that's OK because Caddy forwards the real IP).
  app.set('trust proxy', 'loopback, linklocal, uniquelocal')
}
// else: no trust proxy — req.ip = socket.remoteAddress (no spoofing possible)

// ============================================================================
// Request logging — minimal, dev-only.
// Wave 3 (B-PROD-002): use the structured requestLogger from lib/logger.ts
// instead of dev-only console.log. The structured logger:
//   - logs in prod (samples 10% to control volume)
//   - emits JSON with method/url/status/durationMs/ip/ua
//   - can be shipped to log aggregators (Loki/CloudWatch/Datadog)
//   - integrates with Sentry for error-level events
app.use(requestLogger)

// --- Socket.IO ---
const io = new IoServer(httpServer, {
  path: '/socket.io/',
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
  // Cap event payload at 100 KB — a single chat message or signaling event
  // is well under 1 KB. The default 1 MB is DoS surface for no benefit.
  maxHttpBufferSize: 100 * 1024,
})
registerChatHandlers(io)
// v16.8-final: start the voice-message self-destruct scheduler.
startSelfDestructScheduler(io)

// --- Security middleware ---
// --- Security middleware ---
// B-HIGH-006 fix: Helmet CSP enabled in ALL environments (was dev:false).
// Fail-strict: if NODE_ENV unset, default to stricter prod policy.
// Frame-ancestors 'none' prevents clickjacking (S-LOW-028).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:', 'https:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      reportOnly: false,
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow uploads from frontend
    crossOriginEmbedderPolicy: false,
    hsts: isProd
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false, // HSTS only in prod (HTTP in dev)
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
)

app.use(
  cors({
    origin: corsOrigin,
    // S-HIGH-005 fix: credentials:true unnecessary for Bearer auth. Creates
    // CSRF surface if cookies are added later. Removed.
    credentials: false,
  }),
)

// --- Body parsers ---
// B-HIGH-005 fix: kept strict:false because PUT /api/settings/:key accepts
// raw JSON strings (e.g. whatsapp phone number). Instead of strict:true,
// we add explicit type guards in routes that destructure req.body
// (orders.ts, users.ts, reviews.ts) to handle the type-confusion case
// where body could be null/true/42/"hello".
app.use(express.json({ limit: '1mb', strict: false }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// --- Rate limiting ---
// Generic API limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 120, // 120 req/min per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
})
app.use('/api', apiLimiter)

// Strict limiter for auth endpoints (brute-force mitigation)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // 20 attempts per 15 min per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, try again later' },
})

// Upload limiter — prevents disk-fill attacks
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20, // 20 uploads/min per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many uploads, please slow down' },
})

// Stricter limiter for the first-run admin probe — prevents recon spam.
// Mounted only on /api/auth/admin-exists (5 req/min/IP is plenty for the
// wizard to do its single check on Studio load).
const adminProbeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many admin-probe requests, slow down' },
})

// Very strict limiter for /reset-admin — blocks brute-force on the reset token.
// 3 attempts per hour per IP is enough for legitimate use (operator forgot
// password) and makes token-guessing impractical (2^192 keyspace / 3/h).
const adminResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reset attempts, try again later' },
})

// v24.7 (final-release audit): dedicated limiter for /forgot-password and
// /reset-password. Previously both fell under the generic authLimiter
// (20 / 15 min / IP), which is fine for login brute-force but too lenient
// for password-reset flows where the goal is also email-enumeration
// prevention and reset-token brute-force. 5/h/IP is plenty for a user who
// genuinely forgot their password, while making automated abuse impractical.
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password-reset requests, try again later' },
})

// REMOVED (Phase 1.3): leadsLimiter — dead code. Was defined here but never
// mounted. The actual leads rate limiting is done by publicLeadLimiter inside
// routes/leads.ts:17-23 (5/min/IP on POST /api/leads). This duplicate
// definition was misleading during code review.

// --- Static: uploaded files ---
const uploadsDir = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
app.use(
  '/uploads',
  express.static(uploadsDir, {
    maxAge: '7d',
    // Explicit MIME map for audio types produced by MediaRecorder.
    // Without this, express.static falls back to application/octet-stream
    // for `.weba` (non-standard ext) and the <audio> element may refuse
    // to play voice messages — especially in Safari.
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      // P-HIGH-010 fix: set Access-Control-Allow-Origin on /uploads/* so
      // canvas.drawImage() from /uploads doesn't taint the canvas. Without
      // this, SmartStoryGenerator's toBlob() throws SecurityError when
      // compositing product-uploaded images (only Unsplash images worked
      // because Unsplash sends CORS headers).
      // We use '*' because uploads are public assets served with
      // Content-Disposition: attachment (non-audio) — no sensitive data leaks.
      res.setHeader('Access-Control-Allow-Origin', '*')
      const ext = path.extname(filePath).toLowerCase()
      const AUDIO_EXT_TO_MIME: Record<string, string> = {
        '.webm': 'audio/webm',
        '.weba': 'audio/webm',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4',
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
      }
      // Force the correct Content-Type for audio files — voice messages
      // MUST be served with an audio/* MIME so the <audio> element can play
      // them inline. We do NOT set Content-Disposition: attachment for audio
      // (the global attachment rule below is for non-audio uploads only).
      if (AUDIO_EXT_TO_MIME[ext]) {
        res.setHeader('Content-Type', AUDIO_EXT_TO_MIME[ext])
        // Inline disposition so the browser plays it in the <audio> element
        // instead of forcing a download dialog.
        res.setHeader('Content-Disposition', 'inline')
        return
      }
      // For all other uploads — prevent MIME-sniffing and force a download
      // (avoids rendering uploaded HTML/SVG payloads inline).
      res.setHeader('Content-Disposition', 'attachment')
    },
  }),
)

// ============================================================================
// Cache-Control middleware for API responses
// ----------------------------------------------------------------------------
// Without explicit Cache-Control, browsers apply HTTP/1.1 heuristic caching
// (10% of time since Last-Modified) — which can cache sensitive data like
// user profiles or chat conversations for hours.
//
// Rules:
//   - /api/auth/*            → no-store (tokens, user data — never cache)
//   - /api/chat/*            → no-store (real-time data, must be fresh)
//   - /api/products*         → public, max-age=60 (catalog changes rarely)
//   - /api/products/smart/*  → public, max-age=30 (smart blocks)
//   - /api/stories           → public, max-age=60
//   - /api/banners           → public, max-age=300 (admin-managed, slow)
//   - /api/settings/*        → public, max-age=300
//   - /api/push/*            → no-store (subscription endpoints are sensitive)
//   - /api/calls/*           → no-store (TURN credentials per-user)
//   - everything else        → no-store (default: secure)
// ============================================================================
app.use('/api', (req, res, next) => {
  const url = req.originalUrl || req.url
  // Order matters: more specific paths first
  if (url.startsWith('/api/auth/') ||
      url.startsWith('/api/chat/') ||
      url.startsWith('/api/push/') ||
      url.startsWith('/api/calls/') ||
      url.startsWith('/api/leads') ||
      url.startsWith('/api/orders') ||
      url.startsWith('/api/upload') ||
      url.startsWith('/api/favorites') ||
      url.startsWith('/api/cart')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.set('Pragma', 'no-cache')
    res.set('Expires', '0')
  } else if (url.startsWith('/api/products/smart/')) {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  } else if (url.startsWith('/api/products')) {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  // v12.3.1: /api/stories cache rule RESTORED (Stories module is back).
  } else if (url.startsWith('/api/stories')) {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  } else if (url.startsWith('/api/banners')) {
    // v24.3: no-cache so banner changes in Studio appear immediately.
    // Previously this was max-age=300 (5 min browser cache) which meant
    // banner updates took up to 5 minutes to show in the app. Studio-driven
    // content should never be aggressively cached.
    res.set('Cache-Control', 'no-cache, must-revalidate')
  } else if (url.startsWith('/api/info-pages')) {
    // Public info pages — cache for 5 min, but allow stale-while-revalidate
    // so updates in Studio appear quickly without forcing a full refetch.
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  } else if (url.startsWith('/api/settings/')) {
    // v8-audit-fix: no-cache so changes in Studio appear immediately in the app
    res.set('Cache-Control', 'no-cache, must-revalidate')
  } else if (url.startsWith('/api/health') || url.startsWith('/api/ready')) {
    res.set('Cache-Control', 'no-store')
  } else {
    // Default: secure (no-store). Override per-route if needed.
    res.set('Cache-Control', 'no-store, private')
  }
  next()
})

// --- API routes ---
// Auth routes: authLimiter (20/15min/IP) covers register/login/change-password.
// /admin-exists and /reset-admin get stricter dedicated limiters mounted
// BEFORE authRoutes so they take precedence for those specific paths.
// /forgot-password and /reset-password get passwordResetLimiter (5/h/IP)
// to defend against email enumeration and reset-token brute-force.
app.use('/api/auth/admin-exists', adminProbeLimiter)
app.use('/api/auth/reset-admin', adminResetLimiter)
app.use('/api/auth/forgot-password', passwordResetLimiter)
app.use('/api/auth/reset-password', passwordResetLimiter)
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/products', productsRoutes)
// v12.3.1: /api/stories mount RESTORED (Stories is a standalone module).
// v12.3: /api/posts, /api/comments mounts remain removed with Feed.
app.use('/api/stories', storiesRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/banners', bannersRoutes)
app.use('/api/departments', departmentsRoutes)
app.use('/api/info-pages', infoPagesRoutes)
app.use('/api/moderation', moderationRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/push', pushRoutes)
app.use('/api/leads', leadsRoutes)
app.use('/api/orders', ordersRoutes)
app.use('/api/delivery', deliveryRoutes)
app.use('/api/reviews', reviewsRoutes)
app.use('/api/search', searchRoutes) // /api/search/track — records user searches for personalization
app.use('/api/search', universalSearchRoutes) // /api/search/universal — parallel entity search
app.use('/api/calls', callsRoutes) // /api/calls/ice-servers — WebRTC ICE config
app.use('/api/audit', auditRoutes) // /api/audit — admin audit log (admin-only)
app.use('/api/share', shareRoutes) // Smart Share — public share links + tracking + analytics
app.use('/api/club', clubRoutes) // v12.4: 999 CLUB Phase 2 — gifts, promos, giveaways, bonuses, tasks, coupons, events, points, referrals
app.use('/api/audio-hub', audioHubRoutes) // v16.9.2: Audio Hub — search proxy + stream proxy
app.use('/api/films', filmsRoutes) // v16.20: Films Hub — Turkish series search + episode player
app.use('/api/live-info', liveInfoRoutes) // v18.4: Floating Live Info — finance/weather/shop/personal
app.use('/api/ai', aiRoutes) // v18.5: AI Assistant — DeepSeek chat + Knowledge Base CRUD
app.use('/api/ai/tts', aiTtsRoutes) // v18.5: AI TTS metadata (client-side Web Speech API)
app.use('/api/ai/providers', aiProvidersRoutes) // v19.0: AI provider CRUD (multi-provider config)
app.use('/api/ai/studio', aiStudioRoutes) // v8: Studio AI Assistant (товары + Stories)
app.use('/api/promo-codes', promoCodesRoutes) // v19.0: Promo codes + bonus points settings
app.use('/api', securityRoutes) // v19.0: Security settings + 2FA backup codes + session mgmt
// Upload limiter — apply ONLY to /api/upload/* (file uploads), NOT to all /api/*
// Favorites and cart are lightweight JSON ops; they don't need the 20/min limiter.
// Previous bug: app.use('/api', uploadLimiter, uploadRoutes) mounted the limiter
// on EVERY /api/* request, effectively rate-limiting the entire API to 20/min.
app.use('/api/upload', uploadLimiter)
app.use('/api', uploadRoutes) // /api/upload, /api/favorites, /api/cart

// --- Health checks ---
// Liveness — process is up
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

// Readiness — process can serve requests (DB reachable)
app.get('/api/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true, ts: new Date().toISOString() })
  } catch (e) {
      logger.error('Ready check DB failed', { module: 'health', error: e instanceof Error ? e : new Error(String(e)) })
    res.status(503).json({ ok: false, error: 'Database unavailable' })
  }
})

// Detailed health — used by monitoring systems (uptime, memory, DB, versions)
// SECURITY (Phase 0.4): protected with requireAuth + requireAdmin to prevent
// information disclosure (memory usage, Node version, env name, socket count,
// DB latency — all useful for an attacker planning DoS or exploit selection).
app.get('/api/health/detailed', requireAuth, requireAdmin, async (_req, res) => {
  const started = new Date(Date.now() - process.uptime() * 1000)
  const mem = process.memoryUsage()
  let dbOk = false
  let dbLatencyMs = 0
  try {
    const t0 = Date.now()
    await prisma.$queryRaw`SELECT 1`
    dbLatencyMs = Date.now() - t0
    dbOk = true
  } catch {
    dbOk = false
  }
  res.json({
    ok: dbOk,
    ts: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(process.uptime()),
      startedAt: started.toISOString(),
      humanReadable: formatUptime(process.uptime()),
    },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    database: {
      ok: dbOk,
      latencyMs: dbLatencyMs,
    },
    versions: {
      node: process.version,
      bun: process.versions.bun || null,
      env: process.env.NODE_ENV || 'development',
    },
    socket: {
      connected: (io as any)?.sockets?.sockets?.size || 0,
    },
  })
})

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

// 404
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

// Centralized error handler — never leak internal details on 5xx
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || (err?.name === 'ZodError' ? 400 : 500)
  if (status >= 500) logger.error('Unhandled 5xx error', { module: 'error', status, message: err.message, path: req.path, method: req.method })
  const body: any = {
    error:
      status >= 500
        ? 'Internal server error'
        : err?.message || 'Request failed',
  }
  if (status < 500 && err?.issues) body.details = err.issues
  res.status(status).json(body)
})

// --- Start ---
httpServer.listen(PORT, async () => {
  // Reset stale online flags — any user marked isOnline:true from a previous
  // run (which crashed or was killed) is now offline. Without this, the
  // /api/users/online/list endpoint returns ghost users after a server restart.
  try {
    const result = await prisma.user.updateMany({
      where: { isOnline: true },
      data: { isOnline: false, lastSeen: new Date() },
    })
    if (result.count > 0) {
        logger.info('Startup: reset isOnline flag for stale users', { module: 'startup', count: result.count })
    }
  } catch (e) {
    logger.error('Startup: failed to reset stale isOnline flags', { module: 'startup', error: e instanceof Error ? e : new Error(String(e)) })
  }

  // Wave 3 (B-PROD-002): startup banner via structured logger
  log('info', '«Три девятки» backend started', {
    module: 'index',
    env: NODE_ENV,
    port: PORT,
    http: `http://localhost:${PORT}`,
    restApi: `http://localhost:${PORT}/api`,
    socketIo: `ws://localhost:${PORT}`,
    uploads: `http://localhost:${PORT}/uploads`,
    cors: CLIENT_ORIGIN.join(', ') || '*',
    health: `http://localhost:${PORT}/api/health | /api/ready`,
  })

  // H1 fix: boot-warning if BYPASS_ADMIN_TOTP is set. In production the flag
  // is silently ignored by routes/auth.ts (it checks NODE_ENV!=='production'
  // before honouring the flag), but a dev operator should still see a loud
  // warning if they accidentally enable it. This makes the surface explicit.
  if (process.env.BYPASS_ADMIN_TOTP === 'true') {
    if (isProd) {
      logger.warn('BYPASS_ADMIN_TOTP=true ignored in production — admin 2FA is mandatory', { module: 'startup' })
    } else {
      logger.warn('⚠ BYPASS_ADMIN_TOTP=true is set — admin 2FA is DISABLED. Remove this for any deployment that is not a local laptop.', { module: 'startup' })
    }
  }
})

// --- Graceful shutdown — close all resources in order ---
const shutdown = async (signal: string) => {
  logger.info(`Shutdown: ${signal} received`, { module: 'shutdown' })

  // v16.8-final: stop the self-destruct scheduler (cancel its interval).
  stopSelfDestructScheduler()

  // Stop accepting new connections
  httpServer.close((err) => {
    if (err) logger.error('Shutdown: HTTP close error', { module: 'shutdown', error: err })
  })

  // Close Socket.IO
  io.close(() => {
    logger.info('Shutdown: Socket.IO closed', { module: 'shutdown' })
  })

  // Disconnect Prisma
  try {
    await prisma.$disconnect()
    logger.info('Shutdown: Prisma disconnected', { module: 'shutdown' })
  } catch (e) {
    logger.error('Shutdown: Prisma disconnect error', { module: 'shutdown', error: e instanceof Error ? e : new Error(String(e)) })
  }

  setTimeout(() => process.exit(0), 1000).unref()
  // Hard exit if something hangs
  setTimeout(() => process.exit(1), 8000).unref()
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

// Catch unhandled rejections — log but keep running
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { module: 'process', error: reason instanceof Error ? reason : new Error(String(reason)) })
})
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { module: 'process', error: err instanceof Error ? err : new Error(String(err)) })
  // In production, exit and let the supervisor restart
  if (isProd) process.exit(1)
})
