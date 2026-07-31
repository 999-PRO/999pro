import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import argon2 from 'argon2'
import crypto from 'node:crypto'
import { LRUCache } from 'lru-cache'
import type { Response, NextFunction, Request } from 'express'
import { prisma } from './prisma.js'

// ============================================================================
// Environment validation — fail fast at boot if required secrets are missing
// ============================================================================
const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET
  if (!s) {
    throw new Error(
      'FATAL: JWT_SECRET environment variable is required. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    )
  }
  if (s.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters long')
  }
  // Refuse to start with any of the well-known leaked demo secrets — in ANY environment.
  // The previous dev secret `999pro-dev-secret-key-change-in-production` was committed
  // to the public repo and is therefore compromised. Running with it lets anyone who
  // read the repo forge JWTs for any user.
  const KNOWN_LEAKED_SECRETS = [
    '999pro-dev-secret-key-change-in-production',
    '999pro_super_secret_change_me',
  ]
  if (KNOWN_LEAKED_SECRETS.includes(s)) {
    throw new Error(
      'FATAL: JWT_SECRET is a known leaked demo value. ' +
      'Generate a fresh one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    )
  }
  return s
})()
// H2 fix: access token TTL. По умолчанию 7d для обратной совместимости с
// существующим frontend (который не реализует refresh-цикл). Для новых
// деплоев с обновлённым frontend установите JWT_EXPIRES_IN=15m и включите
// refresh-цикл через POST /api/auth/refresh (endpoint уже реализован ниже).
// Функции signRefreshToken / verifyRefreshToken / persistRefreshToken /
// revokeRefreshToken уже готовы к использованию.
const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '7d'
const JWT_REFRESH_EXPIRES_IN: string = process.env.JWT_REFRESH_EXPIRES_IN || '7d'

// ============================================================================
// Types
// ============================================================================
export type UserRole = 'user' | 'admin' | 'manager'

export interface JwtPayload {
  sub: string
  username: string
  role: UserRole
  // tokenVersion mirrors User.tokenVersion. Incrementing the user's
  // tokenVersion (e.g. on password change) immediately invalidates all
  // previously-issued tokens, because verifyAuth below rejects any mismatch.
  v: number
  /**
   * TOTP setup pending flag.
   *
   * When `true`, this JWT is a SHORT-LIVED (15-min) token issued by
   * `/api/auth/login` when an admin logs in with correct password but TOTP
   * is not yet enrolled. It is accepted ONLY by endpoints that use
   * `requireAuth` without `requireAdmin` — i.e. `/api/auth/me`,
   * `/api/auth/totp/setup`, `/api/auth/totp/verify`, `/api/auth/totp/disable`.
   *
   * `requireAdmin` rejects any token with `totpPending === true`, so the
   * setup token CANNOT be used to access any admin endpoint (products,
   * leads, users, banners, …) until the admin completes TOTP enrollment
   * and receives a fresh regular JWT from `/totp/verify`.
   */
  totpPending?: boolean
}

// ============================================================================
// Password hashing — S-HIGH-001 fix: argon2id (OWASP 2024 preferred).
// Argon2id is memory-hard, defeating GPU/ASIC attacks. Falls back to bcrypt
// for verifying legacy hashes (so existing users can still log in). New
// hashes are always argon2id.
// ============================================================================
// B-LOW-007: clamp bcrypt rounds (used only for legacy hash compat + DUMMY_HASH).
const BCRYPT_ROUNDS = Math.max(10, Math.min(14, Number(process.env.BCRYPT_ROUNDS) || 12))

// Argon2id parameters — OWASP 2024 recommendations:
//   t=3 (iterations), m=65536 (64 MB memory), p=4 (parallelism)
const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,  // 64 MB
  timeCost: 3,
  parallelism: 4,
}

export async function hashPassword(password: string): Promise<string> {
  // S-HIGH-001: use argon2id for all new hashes (memory-hard, GPU-resistant)
  return argon2.hash(password, ARGON2_OPTS)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  // Support both argon2 (new) and bcrypt (legacy) hashes for migration.
  // Argon2 hashes start with '$argon2', bcrypt with '$2a$' / '$2b$' / '$2y$'.
  if (hash.startsWith('$argon2')) {
    return argon2.verify(hash, password)
  }
  return bcrypt.compare(password, hash)
}

// Fixed-hash used to mitigate login timing oracle when user is not found.
// Computed once at boot — never recomputed.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS)

// ============================================================================
// JWT
// ============================================================================
export function signToken(payload: Omit<JwtPayload, 'v'> & { v?: number }): string {
  return jwt.sign({ ...payload, v: payload.v ?? 0 }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: 'HS256',
  } as jwt.SignOptions)
}

/**
 * H2 fix: sign a long-lived refresh token (7d). The token carries:
 *   - sub, username, role, v (same as access token)
 *   - jti (unique token ID — used as key in AppSetting for revocation)
 *   - type: 'refresh' (so /api/auth/refresh can reject access tokens used
 *     as refresh tokens, and vice versa)
 *
 * The refresh token is stored server-side in AppSetting with id=`refresh:<jti>`
 * and a 7d expiry. When the user logs out, the entry is deleted → the refresh
 * token becomes invalid even though the JWT itself hasn't expired.
 */
export function signRefreshToken(payload: Omit<JwtPayload, 'v'> & { v?: number }): { token: string; jti: string } {
  const jti = crypto.randomUUID()
  const token = jwt.sign(
    { ...payload, v: payload.v ?? 0, jti, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN, algorithm: 'HS256' } as jwt.SignOptions,
  )
  return { token, jti }
}

/**
 * H2 fix: verify a refresh token. Returns the JWT payload if the token is
 * valid AND still present in AppSetting (i.e. not revoked).
 *
 * Throws if:
 *   - Token signature is invalid / expired
 *   - Token type is not 'refresh' (prevents access tokens from being used)
 *   - Token has been revoked (deleted from AppSetting)
 */
export async function verifyRefreshToken(token: string): Promise<JwtPayload & { jti: string }> {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload & {
    jti?: string
    type?: string
  }
  if (payload.type !== 'refresh' || !payload.jti) {
    throw new Error('Not a refresh token')
  }
  // Check server-side revocation list.
  const stored = await prisma.appSetting.findUnique({ where: { id: `refresh:${payload.jti}` } })
  if (!stored) {
    throw new Error('Refresh token revoked')
  }
  return payload as JwtPayload & { jti: string }
}

/**
 * H2 fix: persist a refresh token's jti in AppSetting for later revocation
 * checks. Called after login/register.
 *
 * v19.1 fix: TTL now reads from SecuritySettings.refreshTokenTTLDays (DB-configurable
 * via Studio → Безопасность). Falls back to JWT_REFRESH_EXPIRES_IN env var,
 * then to 7 days default. Cached for 60s to avoid a DB lookup on every login.
 */
let cachedRefreshTtlMs: number | null = null
let cachedRefreshTtlAt = 0
async function getRefreshTtlMs(): Promise<number> {
  // Cache for 60s — settings change rarely
  if (cachedRefreshTtlMs !== null && Date.now() - cachedRefreshTtlAt < 60_000) {
    return cachedRefreshTtlMs
  }
  let days: number | null = null
  try {
    const s = await prisma.securitySettings.findUnique({ where: { id: 'default' }, select: { refreshTokenTTLDays: true } })
    if (s) days = s.refreshTokenTTLDays
  } catch { /* DB not ready yet — fall through */ }
  if (!days) {
    // Fall back to env var, then default 7 days
    const envTtl = process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    const m = /^(\d+)([dh])?$/.exec(envTtl)
    days = m ? parseInt(m[1], 10) * (m[2] === 'h' ? (1 / 24) : 1) : 7
  }
  cachedRefreshTtlMs = days * 24 * 60 * 60 * 1000
  cachedRefreshTtlAt = Date.now()
  return cachedRefreshTtlMs
}

export async function persistRefreshToken(jti: string, userId: string): Promise<void> {
  const ttlMs = await getRefreshTtlMs()
  const expires = new Date(Date.now() + ttlMs)
  await prisma.appSetting.upsert({
    where: { id: `refresh:${jti}` },
    update: { value: JSON.stringify({ userId, expires: expires.toISOString() }) },
    create: {
      id: `refresh:${jti}`,
      value: JSON.stringify({ userId, expires: expires.toISOString() }),
    },
  })
}

/**
 * H2 fix: revoke a refresh token (delete from AppSetting). Called on logout
 * and on password change (tokenVersion bump also revokes, but explicit
 * delete makes the refresh token immediately unusable).
 */
export async function revokeRefreshToken(jti: string): Promise<void> {
  try {
    await prisma.appSetting.delete({ where: { id: `refresh:${jti}` } })
  } catch {
    // Already revoked — non-fatal.
  }
}

/**
 * Sign a SHORT-LIVED TOTP-setup token.
 *
 * Issued by `/api/auth/login` when an admin authenticates with correct
 * password but TOTP is not yet enrolled. The token:
 *   - Carries `totpPending: true` so `requireAdmin` rejects it.
 *   - Expires in 15 minutes (TOTP_SETUP_TOKEN_TTL_SEC env, default 900).
 *   - Inherits `v` (tokenVersion) so password change / admin demotion
 *     still revokes it.
 *
 * It is accepted by `requireAuth` (used alone for `/api/auth/totp/setup`,
 * `/totp/verify`, `/totp/disable`, `/api/auth/me`) but REJECTED by
 * `requireAdmin` (chained for all admin endpoints).
 */
const TOTP_SETUP_TOKEN_TTL_SEC = Math.max(
  60,
  Math.min(3600, Number(process.env.TOTP_SETUP_TOKEN_TTL_SEC) || 900),
)

export function signTotpSetupToken(
  payload: Omit<JwtPayload, 'v' | 'totpPending'> & { v?: number },
): string {
  return jwt.sign(
    { ...payload, v: payload.v ?? 0, totpPending: true },
    JWT_SECRET,
    { expiresIn: TOTP_SETUP_TOKEN_TTL_SEC, algorithm: 'HS256' } as jwt.SignOptions,
  )
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload
}

// ============================================================================
// Express middleware
// ============================================================================
export interface AuthedRequest extends Request {
  user?: JwtPayload & { id: string; role: UserRole; totpPending: boolean }
}

// Constant-time-ish password check to mitigate user enumeration via response timing
export async function safeComparePassword(
  password: string,
  user: { password: string } | null,
): Promise<boolean> {
  if (!user) {
    // Run a dummy compare to keep timing similar
    await bcrypt.compare(password, DUMMY_HASH).catch(() => false)
    return false
  }
  return comparePassword(password, user.password)
}

/**
 * requireAuth — verifies the Bearer JWT AND re-checks tokenVersion against DB.
 *
 * Why the DB check: JWTs are stateless, so changing a user's password or
 * demoting an admin does NOT invalidate previously-issued tokens. We embed
 * `v` (tokenVersion) in the token and bump it on the user record whenever
 * credentials change. A single indexed SELECT keeps the cost negligible.
 *
 * To avoid hitting the DB on every request, we cache `(userId -> {v, role})`
 * for 60 seconds in a Map. Invalidation happens implicitly when the user's
 * tokenVersion is bumped (the next request will see a stale cache entry,
 * mismatch, and re-fetch).
 */
interface CachedAuth { v: number; role: UserRole; expires: number }
// B-HIGH-002: bounded LRU cache (was: unbounded Map — grew forever, leaking
// memory one entry per user-id per token-version bump; under sustained traffic
// with rotating users this caused OOM over days of uptime).
const AUTH_CACHE = new LRUCache<string, CachedAuth>({ max: 50_000, ttl: 60_000 })
const AUTH_CACHE_TTL_MS = 60_000

/**
 * Public accessor for socket layer (B-HIGH-008): lets tryAuth() short-circuit
 * the DB lookup when the user's auth entry is already cached by a recent
 * REST request. Cache hit semantics match `requireAuth`/`optionalAuth`:
 *   - entry expired → undefined (caller falls through to DB)
 *   - tokenVersion mismatch → undefined (caller falls through to DB)
 *   - account soft-deleted → undefined + cache eviction
 */
export function getCachedAuth(userId: string, tokenVersion?: number): CachedAuth | undefined {
  const cached = AUTH_CACHE.get(userId)
  if (!cached) return undefined
  // lru-cache with ttl already evicts stale entries on .get(), but our entry
  // also carries a redundant `expires` field for backward compat with the
  // previous Map-based code path — keep the check for safety.
  if (cached.expires < Date.now()) {
    AUTH_CACHE.delete(userId)
    return undefined
  }
  if (tokenVersion !== undefined && cached.v !== tokenVersion) {
    AUTH_CACHE.delete(userId)
    return undefined
  }
  return cached
}

/**
 * Populate / refresh the auth cache after a DB lookup. Used by socket layer
 * (B-HIGH-008) so that subsequent socket-auth on the same user hits cache.
 */
export function setCachedAuth(userId: string, entry: CachedAuth): void {
  AUTH_CACHE.set(userId, entry)
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  void requireAuthAsync(req, res, next).catch(next)
}

async function requireAuthAsync(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing' })
  }
  const token = header.slice('Bearer '.length).trim()
  let decoded: JwtPayload
  try {
    decoded = verifyToken(token)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Re-verify tokenVersion against DB (with short-lived cache).
  // B-HIGH-002: AUTH_CACHE is now a bounded LRU; manual TTL checks below are
  // belt-and-suspenders — lru-cache evicts on its own.
  const now = Date.now()
  let cached = AUTH_CACHE.get(decoded.sub)
  if (!cached || cached.expires < now) {
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { tokenVersion: true, role: true, deletedAt: true, emailVerified: true, lockedUntil: true },
    })
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists' })
    }
    // Phase 8.1: reject soft-deleted users — their tokens are invalid.
    if (user.deletedAt) {
      AUTH_CACHE.delete(decoded.sub)
      return res.status(401).json({ error: 'Account has been deleted' })
    }
    // v22 audit: reject blocked users (lockedUntil in the future).
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      AUTH_CACHE.delete(decoded.sub)
      return res.status(403).json({ error: 'Аккаунт заблокирован администратором' })
    }
    // v9-audit-fix: S-CRIT-007 — env-gated email verification check.
    // v19.0: now reads from SecuritySettings table (DB-configurable from Studio).
    // Falls back to env var for backward compat.
    if (!user.emailVerified) {
      const securitySettings = await prisma.securitySettings.findUnique({ where: { id: 'default' } })
      const emailVerificationRequired =
        securitySettings?.emailVerificationRequired ??
        process.env.EMAIL_VERIFICATION_REQUIRED === 'true'
      if (emailVerificationRequired) {
        return res.status(403).json({ error: 'Email not verified. Please verify your email to continue.', emailVerificationRequired: true })
      }
    }
    cached = { v: user.tokenVersion, role: user.role as UserRole, expires: now + AUTH_CACHE_TTL_MS }
    AUTH_CACHE.set(decoded.sub, cached)
  }

  // If the user's tokenVersion has been bumped, the token is stale.
  if (cached.v !== decoded.v) {
    AUTH_CACHE.delete(decoded.sub)
    return res.status(401).json({ error: 'Token revoked' })
  }

  // Use the fresh role from cache — protects against role-change-without-relogin.
  req.user = {
    ...decoded,
    id: decoded.sub,
    role: cached.role,
    totpPending: decoded.totpPending === true,
  }
  next()
}

// Optional auth: attaches user if token is valid, but does not fail otherwise.
//
// SECURITY FIX (was): `optionalAuth` previously called `verifyToken` and
// trusted the decoded payload verbatim — it did NOT re-check `tokenVersion`
// against the DB and did NOT refresh `role` from the DB. That meant:
//   - A revoked token (tokenVersion bumped after password change) was still
//     accepted as a valid identity by every optionalAuth endpoint:
//     POST /api/products/:id/view, GET /api/products/smart/blocks,
//     GET /api/posts/:id/liked-by-me, and now POST /api/leads.
//   - A demoted admin's token (role bumped admin→user) was still treated
//     as `admin` because `decoded.role` was trusted verbatim.
//
// Now we run the SAME tokenVersion + role-refresh logic as `requireAuth`,
// but on failure (invalid token, revoked, mismatched version) we silently
// set `req.user = undefined` instead of returning 401. This keeps the
// "optional" semantics for callers that legitimately want anonymous access
// (e.g. POST /api/leads) while still rejecting revoked tokens.
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  void optionalAuthAsync(req, next).catch(next)
}

/**
 * Async implementation of optionalAuth.
 *
 * SECURITY FIX: previously this used `void (async () => { ... })()` inside a
 * synchronous middleware, which meant `next()` could be called twice (once
 * by the outer function's `return next()` on the catch path, and again by
 * the async IIFE) OR not at all if the IIFE threw before reaching `next()`.
 * This is a race condition that Express cannot detect.
 *
 * Now: a single async function. Every code path calls `next()` exactly once.
 * On any error, we silently treat the request as anonymous (no `req.user`).
 */
async function optionalAuthAsync(req: AuthedRequest, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return next()
  }
  const token = header.slice('Bearer '.length).trim()

  let decoded: JwtPayload
  try {
    decoded = verifyToken(token)
  } catch {
    // Invalid signature / expired — silently treat as anonymous.
    return next()
  }

  try {
    const now = Date.now()
    let cached = AUTH_CACHE.get(decoded.sub)
    if (!cached || cached.expires < now) {
      const user = await prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { tokenVersion: true, role: true, deletedAt: true, emailVerified: true, lockedUntil: true },
      })
      if (!user) {
        // Account deleted — silently anonymous.
        return next()
      }
      // v8-audit-fix: reject soft-deleted users (same as requireAuth)
      if (user.deletedAt) {
        AUTH_CACHE.delete(decoded.sub)
        return next()
      }
      // v22 audit: reject blocked users (lockedUntil in the future).
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        AUTH_CACHE.delete(decoded.sub)
        return next()
      }
      // v9-audit-fix (S-HIGH-NEW-4): when EMAIL_VERIFICATION_REQUIRED=true,
      // unverified users should be treated as anonymous on optionalAuth
      // endpoints too — otherwise the email-verification gate is bypassable
      // via any optionalAuth route (POST /api/leads, GET /api/posts/:id/liked-by-me, etc.).
      // v19.0: reads from SecuritySettings table (DB-configurable).
      if (!user.emailVerified) {
        const securitySettings = await prisma.securitySettings.findUnique({ where: { id: 'default' } })
        const emailVerificationRequired =
          securitySettings?.emailVerificationRequired ??
          process.env.EMAIL_VERIFICATION_REQUIRED === 'true'
        if (emailVerificationRequired) {
          AUTH_CACHE.delete(decoded.sub)
          return next()
        }
      }
      cached = { v: user.tokenVersion, role: user.role as UserRole, expires: now + AUTH_CACHE_TTL_MS }
      AUTH_CACHE.set(decoded.sub, cached)
    }

    // If tokenVersion mismatch → revoked token, treat as anonymous.
    if (cached.v !== decoded.v) {
      AUTH_CACHE.delete(decoded.sub)
      return next()
    }

    // Use the fresh role from cache (protects against role-change-without-relogin).
    req.user = {
      ...decoded,
      id: decoded.sub,
      role: cached.role,
      totpPending: decoded.totpPending === true,
    }
  } catch {
    // DB error / unexpected — fail safe as anonymous.
  }
  return next()
}

/**
 * Invalidate the cached auth entry for a user. Call this after bumping
 * tokenVersion, changing the role, or deleting the account.
 */
export function invalidateAuthCache(userId: string) {
  AUTH_CACHE.delete(userId)
}

// Require admin role — must be used AFTER requireAuth (which sets req.user
// with a DB-fresh role).
//
// SECURITY: also rejects `totpPending` tokens. A totpPending token is a
// short-lived setup token issued by `/api/auth/login` when an admin logs in
// with correct password but TOTP is not yet enrolled. Such tokens may ONLY
// be used to complete TOTP enrollment (`/api/auth/totp/setup`, `/totp/verify`,
// `/totp/disable`) and `/api/auth/me` — never for admin operations. This
// prevents an admin who has authenticated via password but skipped TOTP
// enrollment from accessing any admin endpoint.
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  if (req.user.totpPending) {
    return res.status(403).json({
      error: 'Требуется настройка 2FA. Завершите настройку двухфакторной аутентификации перед доступом к админ-панели.',
      totpSetupRequired: true,
    })
  }
  // v22: Accept both 'admin' and 'manager' roles for admin-level endpoints.
  // Managers have limited permissions (configurable per-manager in the future).
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

// v24.6-audit (S-HIGH-4 / C-AI-3 fix): requireAdminOnly — STRICT admin-only
// middleware for endpoints where managers must NOT have access. Use this
// (instead of requireAdmin) for:
//   - AI provider CRUD (managers could otherwise swap the active provider to
//     their own endpoint and intercept all subsequent AI calls)
//   - User role changes (managers could promote themselves to admin)
//   - Security settings changes (password policy, TOTP policy, session TTL)
//   - Audit log deletion / chain reset
//   - First-run admin wizard / reset-admin endpoints
//
// Like requireAdmin, this rejects `totpPending` tokens.
export function requireAdminOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  if (req.user.totpPending) {
    return res.status(403).json({
      error: 'Требуется настройка 2FA. Завершите настройку двухфакторной аутентификации перед доступом к админ-панели.',
      totpSetupRequired: true,
    })
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуется права администратора (manager недостаточно)' })
  }
  next()
}

// v19.1 cleanup: removed unused `requireAdminAuth` export — every route uses
// `requireAuth, requireAdmin` as separate middleware args. The convenience
// constant was never imported anywhere (verified by grep).
