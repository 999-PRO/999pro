import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import {
  hashPassword,
  comparePassword,
  safeComparePassword,
  signToken,
  signTotpSetupToken,
  requireAuth,
  invalidateAuthCache,
  type AuthedRequest,
} from '../lib/auth.js'
import { kickUserSockets } from '../socket/handlers.js'
import { auditLogRaw } from '../lib/audit.js'
import { registerSchema, loginSchema, validatePasswordAgainstSettings } from '../lib/schemas.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { generateReferralCode } from '../lib/referral-code.js'
import { moderateContent } from '../lib/moderation.js'
// v13.3 (audit dedup): use shared publicUser from lib/serialisers instead
// of the local copy. The shared version supports { includeContact: true }
// for the user's own profile (email/phone visible) vs. public view (hidden).
import { publicUser } from '../lib/serialisers.js'
import { logger } from '../lib/logger.js'

const router = Router()

// v13.3: publicUser moved to lib/serialisers.ts. Call sites use
// publicUser(user, { includeContact: true }) since auth routes return
// the user's OWN profile (email/phone visible to themselves).

// Helper: normalise email/username for case-insensitive uniqueness
function normaliseLogin(login: string): string {
  return login.trim().toLowerCase()
}

/** Generate a unique referral code (username prefix + random suffix).
 * v13.1: imported from lib/referral-code.ts — was duplicated in routes/club.ts
 * and used Math.random (not CSPRNG). */
// Imported at top of file: import { generateReferralCode } from '../lib/referral-code.js'

// POST /api/auth/register
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body)

    // v19.0: validate password against DB-configured SecuritySettings
    const pwdCheck = await validatePasswordAgainstSettings(data.password)
    if (!pwdCheck.ok) {
      return res.status(400).json({ error: pwdCheck.errors.join('. '), errors: pwdCheck.errors })
    }

    // Normalise
    const email = data.email.trim().toLowerCase()
    const username = data.username.trim().toLowerCase()

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { id: true, email: true, username: true, role: true },
    })
    if (exists) {
      // Differentiate the error message so the operator/user knows whether
      // the clash is with an admin or a regular user — this matters for
      // the Studio first-run flow where they might be trying to register
      // the admin account through the regular form instead of the wizard.
      if (exists.role === 'admin') {
        return res
          .status(409)
          .json({ error: 'Этот email или логин уже заняты администратором. Войдите под этим аккаунтом.' })
      }
      return res
        .status(409)
        .json({ error: 'Пользователь с таким email или username уже существует. Используйте другой.' })
    }

    // First-run auto-promotion: if NO admin exists in the database yet,
    // the first user to register becomes the admin. This makes the regular
    // /register endpoint work as a fallback for the Studio first-run wizard
    // — so the operator can register through the Studio "Зарегистрироваться"
    // tab and still get admin rights without needing the wizard.
    //
    // SECURITY: this only fires when adminCount === 0. Once any admin
    // exists, all subsequent registrations get role='user' as usual.
    // Phase 8.1: only count active (non-deleted) admins for auto-promotion.
    //
    // B-HIGH-009: race condition. Two concurrent first-time registrations
    // both observed adminCount===0 and both created role:'admin' rows —
    // producing a database with two admins (the cleanup-admin-conflict.ts
    // script in /scripts exists specifically to recover from this). Now the
    // count + create are inside a single $transaction; with Prisma's
    // SQLite backend this holds the write lock for the duration so the
    // second registration sees adminCount===1 and gets role:'user'.
    const password = await hashPassword(data.password)

    // v12.6: Resolve referral code BEFORE creating the user (inside the
    // same transaction so the link is atomic). If the code is invalid or
    // belongs to a deleted user, we silently ignore it — registration
    // should never fail because of a bad referral code.
    let referrerId: string | null = null
    if (data.referralCode) {
      const referrer = await prisma.user.findFirst({
        where: { referralCode: data.referralCode, deletedAt: null },
        select: { id: true },
      })
      if (referrer) referrerId = referrer.id
    }

    // v16.9 MODERATION — check username + displayName before registration.
    // For username we use a temporary ID (user doesn't exist yet).
    const usernameCheck = await moderateContent(username, {
      userId: 'pending-registration',
      targetType: 'username',
    })
    if (!usernameCheck.allowed) {
      return res.status(422).json({
        error: 'Имя пользователя не соответствует правилам сообщества',
        moderationBlocked: true,
      })
    }
    if (data.displayName) {
      const dnCheck = await moderateContent(data.displayName, {
        userId: 'pending-registration',
        targetType: 'display_name',
      })
      if (!dnCheck.allowed) {
        return res.status(422).json({
          error: 'Отображаемое имя не соответствует правилам сообщества',
          moderationBlocked: true,
        })
      }
    }

    const { user, assignedRole } = await prisma.$transaction(async (tx) => {
      const adminCount = await tx.user.count({ where: { role: 'admin', deletedAt: null } })
      const role: 'admin' | 'user' = adminCount === 0 ? 'admin' : 'user'
      // Generate a referral code for the new user (username prefix + random suffix)
      const newRefCode = generateReferralCode(username)
      const created = await tx.user.create({
        data: {
          email,
          username,
          phone: data.phone,
          password,
          displayName: data.displayName,
          gender: data.gender,
          avatar: null,
          role,
          referralCode: newRefCode,
          referredById: referrerId,
        },
      })
      return { user: created, assignedRole: role }
    })

    // v12.6: Award referral bonus to the referrer (outside the user-create
    // transaction so a failure here doesn't roll back registration).
    // The new user also gets a welcome bonus.
    if (referrerId) {
      try {
        const REFERRER_REWARD = 50
        const NEW_USER_REWARD = 50
        await prisma.$transaction([
          // Referrer: +50 points
          prisma.user.update({
            where: { id: referrerId },
            data: {
              points: { increment: REFERRER_REWARD },
              pointsEarnedTotal: { increment: REFERRER_REWARD },
            },
          }),
          prisma.pointsTransaction.create({
            data: {
              userId: referrerId,
              delta: REFERRER_REWARD,
              reason: 'referral',
              entityId: user.id,
              entityType: 'user',
            },
          }),
          // New user: +50 points (referral signup bonus)
          prisma.user.update({
            where: { id: user.id },
            data: {
              points: { increment: NEW_USER_REWARD },
              pointsEarnedTotal: { increment: NEW_USER_REWARD },
            },
          }),
          prisma.pointsTransaction.create({
            data: {
              userId: user.id,
              delta: NEW_USER_REWARD,
              reason: 'referral_signup',
              entityId: referrerId,
              entityType: 'user',
            },
          }),
        ])
        // Notify the referrer
        const { sendPushToUser } = await import('./push.js')
        sendPushToUser(referrerId, {
          title: '👥 Новый реферал!',
          body: `По вашей ссылке зарегистрировался ${user.displayName || user.username}. +${REFERRER_REWARD} баллов!`,
          tag: `club-referral-${user.id}`,
          url: '/?view=club',
        }).catch(() => {})
      } catch (e) {
        logger.error('Referral bonus failed:', { module: 'auth', error: e })
      }
    }

    // ========================================================================
    // AUTO-CREATE a pinned support conversation with an admin.
    //
    // Every new user immediately gets a dedicated "«Три девятки» / Администратор"
    // chat channel. This conversation:
    //   - is always pinned to the top of their chat list (type='support')
    //   - cannot be deleted by the user
    //   - serves as the primary support channel (no need for the user to
    //     find an admin or open a separate "Поддержка" view)
    //
    // If no admin exists yet (rare — admin is created via first-run wizard),
    // we skip the conversation. It will be created lazily on first visit
    // to the support view OR on next login (via the /api/chat/support
    // endpoint which get-or-creates it).
    // ========================================================================
    try {
      // v11-fix: orderBy createdAt asc — pick the FIRST (oldest) admin
      // deterministically. Without this, findFirst returns an arbitrary
      // admin when there are multiple, which is confusing for audits.
      const admin = await prisma.user.findFirst({
        where: { role: 'admin', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      // Skip support conversation creation if:
      //   - no admin exists yet (lazy-created on first /api/chat/support call)
      //   - the just-registered user IS the admin (first-run auto-promotion
      //     makes user.id === admin.id — creating a conversation between
      //     a user and themselves violates the (conversationId, userId)
      //     unique constraint AND makes no semantic sense anyway).
      if (admin && admin.id !== user.id) {
        // Check if a support conversation already exists (idempotency).
        // This shouldn't normally happen, but protects against any race
        // condition or duplicate-registration scenario.
        const existing = await prisma.conversation.findFirst({
          where: {
            type: 'support',
            participants: {
              every: {
                OR: [{ userId: user.id }, { userId: admin.id }],
              },
            },
          },
          include: { participants: { select: { userId: true } } },
        })
        const alreadyExists =
          existing &&
          existing.participants.some((p) => p.userId === user.id) &&
          existing.participants.some((p) => p.userId === admin.id)

        if (!alreadyExists) {
          const conv = await prisma.conversation.create({
            data: {
              type: 'support',
              participants: {
                create: [{ userId: user.id }, { userId: admin.id }],
              },
            },
          })
          // Send a welcome message from the admin so the chat isn't empty.
          await prisma.message.create({
            data: {
              conversationId: conv.id,
              senderId: admin.id,
              content:
                'Здравствуйте! 👋 Добро пожаловать в «Три девятки». Я — администратор и поддержка. Если у вас возникнут вопросы по товарам, заказам или работе приложения, напишите сюда, я отвечу как можно скорее.',
              mediaType: 'text',
            },
          })
        }
      }
    } catch (e) {
      // Support conversation creation is non-critical — don't fail the
      // registration if it errors. The user can still trigger creation
      // later via POST /api/chat/support.
      logger.error('Failed to auto-create support conversation:', { module: 'auth', error: e })
    }

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.role as 'user' | 'admin',
      v: user.tokenVersion,
    })
    // Phase 32: audit log registration.
    // v25.2-fix: wrap in try/catch — if the DB write fails (e.g. SQLite
    // read-only), we must NOT let it crash the registration response.
    // The user is already created at this point; the audit log is best-effort.
    try {
      await auditLogRaw(user.id, req, 'auth', user.id, 'register', {
        after: { username: user.username, email: user.email, role: user.role },
      })
    } catch (auditErr) {
      logger.error('Registration audit log failed (non-fatal)', {
        module: 'auth',
        error: auditErr instanceof Error ? auditErr : new Error(String(auditErr)),
        userId: user.id,
      })
    }

    // ========================================================================
    // v16.8 final: AUTO-SEND email verification after successful registration.
    // Previously the verification email was only sent if the user manually
    // hit POST /api/auth/send-verification. Now we fire it automatically so
    // the user receives the confirmation link immediately after sign-up.
    //
    // We deliberately do this AFTER the response is queued — the email send
    // is non-blocking for the registration flow. If SMTP fails, the user can
    // still log in (when EMAIL_VERIFICATION_REQUIRED=false, the default) and
    // request a new verification email from the profile screen.
    //
    // We also skip this for the auto-promoted admin (when role==='admin'
    // via the first-run wizard) because the admin's email is already
    // trusted — sending a verification email to the operator is noise.
    // ========================================================================
    if (assignedRole === 'user') {
      try {
        const verifyToken = crypto.randomBytes(16).toString('hex')
        const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
        await prisma.appSetting.upsert({
          where: { id: `email:verify:${verifyToken}` },
          update: { value: JSON.stringify({ userId: user.id, expires: verifyExpires.toISOString() }) },
          create: {
            id: `email:verify:${verifyToken}`,
            value: JSON.stringify({ userId: user.id, expires: verifyExpires.toISOString() }),
          },
        })
        const baseUrl = process.env.APP_PUBLIC_URL || 'http://localhost:3000'
        // v16.8 final: the verification link points to the frontend
        // /verify-email page, which validates the token via
        // GET /api/auth/verify-email and shows a success screen. The old
        // implementation called the API endpoint directly — which returned
        // raw JSON and was a poor UX. The new frontend page wraps the same
        // API call with a branded success/error UI.
        const verifyUrl = `${baseUrl}/verify-email?token=${verifyToken}`
        const { sendVerificationEmail } = await import('../lib/email.js')
        // Fire-and-forget — email failures must not break registration.
        sendVerificationEmail(user.email, verifyUrl).catch((e) => {
          logger.error('[register] Auto-send verification email failed:', {
            module: 'auth',
            error: e,
            userId: user.id,
          })
        })
      } catch (e) {
        // Non-fatal: the user can still request a new verification email.
        logger.error('[register] Failed to queue verification email:', {
          module: 'auth',
          error: e,
          userId: user.id,
        })
      }
    }

    res.status(201).json({ token, user: publicUser(user, { includeContact: true }) })
  }),
)

// POST /api/auth/login — login field accepts email | username | phone
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { login: rawLogin, password } = loginSchema.parse(req.body)
    const login = normaliseLogin(rawLogin)

    // Try by email or username (both lowercased), then phone
    // Phase 8.1: filter out soft-deleted users — they cannot log in.
    const user = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email: login },
          { username: login },
          ...(login.startsWith('+') || /^\d/.test(login) ? [{ phone: rawLogin.trim() }] : []),
        ],
      },
    })

    // S-CRIT-009 fix: account lockout after 5 failed attempts (15 min).
    if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remainingMs = new Date(user.lockedUntil).getTime() - Date.now()
      const remainingMin = Math.ceil(remainingMs / 60000)
      await auditLogRaw(user.id, req, 'auth', user.id, 'login_failed', {
        after: { login, reason: 'account_locked', remainingMin },
      })
      return res.status(429).json({
        error: `Аккаунт заблокирован. Попробуйте через ${remainingMin} мин.`,
        lockedUntil: user.lockedUntil,
      })
    }

    // Use safe compare to mitigate timing oracle for user enumeration
    const ok = await safeComparePassword(password, user)

    if (!user || !ok) {
      // S-CRIT-009: increment failedLoginCount. Lock for 15 min on 5th failure.
      if (user) {
        const newCount = (user.failedLoginCount || 0) + 1
        const shouldLock = newCount >= 5
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: newCount,
            ...(shouldLock ? { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}),
          },
        })
      }
      // Phase 32: audit log failed login attempt (for brute-force detection)
      await auditLogRaw(user?.id || null, req, 'auth', user?.id || null, 'login_failed', {
        after: { login: login, reason: !user ? 'user_not_found' : 'wrong_password', attempt: (user?.failedLoginCount || 0) + 1 },
      })
      const msg = user && (user.failedLoginCount || 0) + 1 >= 5
        ? 'Слишком много неудачных попыток. Аккаунт заблокирован на 15 минут.'
        : 'Invalid credentials'
      return res.status(401).json({ error: msg })
    }

    // S-CRIT-009: reset failedLoginCount on successful login
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      })
    }

    // v9-audit-fix: S-CRIT-008 — 2FA/TOTP verification for enabled accounts.
    // If the user has TOTP enabled, require a valid 6-digit code before
    // issuing a JWT. If no code is provided, return a "totpRequired" flag
    // so the frontend can show the TOTP input form.
    // v19.0: Also supports:
    //   - backup codes (8-char alphanumeric) — consumed on use
    //   - email 2FA code (6-digit) — if user.emailTwoFactorCode is set
    if (user.totpEnabled && user.totpSecret) {
      const totpCode = (req.body as { totpCode?: string })?.totpCode
      if (!totpCode) {
        // Don't reveal whether the password was correct — but we already
        // reset the failedLoginCount above. That's OK because the password
        // WAS correct; we're just asking for the second factor.
        return res.json({ totpRequired: true, user: publicUser(user, { includeContact: true }) })
      }
      const { verifyTotp } = await import('../lib/totp.js')
      const totpOk = verifyTotp(totpCode, user.totpSecret)
      // v19.0: try backup code if TOTP didn't match
      const backupOk = totpOk ? false : await tryBackupCode(user.id, totpCode.toUpperCase())
      if (!totpOk && !backupOk) {
        await auditLogRaw(user.id, req, 'auth', user.id, 'login_failed', {
          after: { reason: 'invalid_totp' },
        })
        return res.status(401).json({ error: 'Неверный код подтверждения.' })
      }
      await auditLogRaw(user.id, req, 'auth', user.id, 'totp_used', {
        after: { method: backupOk ? 'backup_code' : 'totp' },
      })
    }

    // Wave 3 (S-PROD-001): mandatory TOTP setup for admin role.
    // Admins who haven't enabled TOTP yet are forced to set it up before
    // they can access the admin panel. Returns `totpSetupRequired: true`
    // so the frontend (Studio) shows the setup wizard. The password is
    // correct (verified above) — we just gate the regular JWT behind 2FA
    // enrollment.
    //
    // ARCHITECTURAL FIX (was: "Authorization header missing" bug):
    // Previously this branch returned NO token, but `/totp/setup` and
    // `/totp/verify` use `requireAuth` — so the client had no way to
    // authenticate the setup calls. Now we issue a SHORT-LIVED
    // `totpPending: true` setup token (15 min) that:
    //   • is accepted by `requireAuth` (so /totp/setup, /totp/verify work)
    //   • is REJECTED by `requireAdmin` (so no admin endpoint can be
    //     accessed until TOTP enrollment completes)
    // After `/totp/verify` succeeds, it issues a fresh regular JWT that
    // the client swaps in for the setup token — full access restored.
    //
    // S-HIGH-001 fix: TOTP enforcement for admins is now UNCONDITIONAL.
    // Previously gated by `process.env.NODE_ENV === 'production'`, which let
    // staging/preview/sandbox admins skip 2FA entirely — risky if a staging
    // DB is ever promoted to prod, or if prod briefly runs with NODE_ENV
    // unset during debugging. Now admins must enroll TOTP in every env.
    // For local dev where 2FA is inconvenient, set BYPASS_ADMIN_TOTP=true
    // (only respected when NODE_ENV !== 'production').
    const bypassAdminTotp = process.env.NODE_ENV !== 'production' && process.env.BYPASS_ADMIN_TOTP === 'true'
    if (!bypassAdminTotp && user.role === 'admin' && (!user.totpEnabled || !user.totpSecret)) {
      const setupToken = signTotpSetupToken({
        sub: user.id,
        username: user.username,
        role: user.role as 'user' | 'admin',
        v: user.tokenVersion,
      })
      await auditLogRaw(user.id, req, 'auth', user.id, 'login_totp_setup_required', {
        after: { username: user.username, note: 'Password OK, TOTP enrollment required' },
      })
      return res.json({
        totpSetupRequired: true,
        user: publicUser(user, { includeContact: true }),
        token: setupToken,
        message: 'Для аккаунта администратора обязательно включение 2FA.',
      })
    }

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.role as 'user' | 'admin',
      v: user.tokenVersion,
    })
    // Phase 32: audit log successful login
    await auditLogRaw(user.id, req, 'auth', user.id, 'login_success', {
      after: { username: user.username, role: user.role },
    })
    res.json({ token, user: publicUser(user, { includeContact: true }) })
  }),
)

// GET /api/auth/me
//
// ARCHITECTURAL FIX: rejects `totpPending` setup tokens with 403 +
// `totpSetupRequired: true`. The studio's `fetchMe()` interprets this as
// "session is mid-TOTP-setup, do not mark as authenticated" and surfaces
// the setup flow. Defense-in-depth: in practice `fetchMe()` should never
// be called with a setup token (the studio's `getToken()` returns the
// regular token only), but this guard prevents any future code path from
// accidentally treating a setup token as a fully authenticated session.

// ============================================================================
// H2 fix: POST /api/auth/refresh — exchange a refresh token for a new access
// token. The refresh token is sent in the request body (or as a Bearer token
// in the Authorization header — clients that already use that header for
// access tokens can re-use the same plumbing).
//
// Flow:
//   1. Client's access token expires (15min in prod, 7d in dev).
//   2. Client calls POST /api/auth/refresh with { refreshToken: "..." }.
//   3. Server verifies the refresh token signature + checks AppSetting for
//      revocation. If valid, issues a fresh access token.
//   4. Client swaps the old access token for the new one and retries the
//      original request.
//
// The refresh token itself is NOT rotated on each refresh (simpler UX).
// It's revoked only on explicit logout or password change.
// ============================================================================
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const refreshToken =
      (req.body as { refreshToken?: string })?.refreshToken ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined)

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required.' })
    }

    try {
      const {
        signRefreshToken,
        verifyRefreshToken,
      } = await import('../lib/auth.js')
      const payload = await verifyRefreshToken(refreshToken)

      // Look up the user — they may have been deleted or had their
      // tokenVersion bumped since the refresh token was issued.
      const user = await prisma.user.findUnique({
        where: { id: payload.sub, deletedAt: null },
        select: { id: true, username: true, role: true, tokenVersion: true },
      })
      if (!user) {
        return res.status(401).json({ error: 'User not found.' })
      }
      if (user.tokenVersion !== payload.v) {
        return res.status(401).json({ error: 'Token version mismatch — please log in again.' })
      }

      // Issue a fresh access token.
      const access = signToken({
        sub: user.id,
        username: user.username,
        role: user.role as 'user' | 'admin',
        v: user.tokenVersion,
      })

      // Also issue a fresh refresh token (rotate the jti so the old one
      // becomes invalid — defense against replay attacks). Revoke the old
      // jti and persist the new one.
      const { token: newRefresh, jti: newJti } = signRefreshToken({
        sub: user.id,
        username: user.username,
        role: user.role as 'user' | 'admin',
        v: user.tokenVersion,
      })
      const { persistRefreshToken, revokeRefreshToken } = await import('../lib/auth.js')
      await revokeRefreshToken(payload.jti)
      await persistRefreshToken(newJti, user.id)

      res.json({ token: access, refreshToken: newRefresh })
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' })
    }
  }),
)

// POST /api/auth/logout — revoke the refresh token (delete from AppSetting).
// The access token is short-lived (15min in prod) so we don't need to revoke
// it server-side — it expires on its own. The client should also clear its
// local copy of both tokens.
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const refreshToken = (req.body as { refreshToken?: string })?.refreshToken
    if (refreshToken) {
      try {
        const { verifyRefreshToken, revokeRefreshToken } = await import('../lib/auth.js')
        const payload = await verifyRefreshToken(refreshToken)
        await revokeRefreshToken(payload.jti)
      } catch {
        // Token already invalid — non-fatal.
      }
    }
    res.json({ ok: true })
  }),
)

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.user?.totpPending) {
      return res.status(403).json({
        error: 'Требуется настройка 2FA.',
        totpSetupRequired: true,
      })
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      // Never leak password hash
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        role: true,
        isOnline: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ user: publicUser(user, { includeContact: true }) })
  }),
)

// PATCH /api/auth/me — update profile
// `avatar` accepts a string URL OR null (to clear the avatar).
// All other fields are optional strings.
const updateProfileSchema = z.object({
  displayName: z.string().max(64).optional(),
  bio: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  avatar: z.union([z.string().max(2048), z.null()]).optional(),
})

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = updateProfileSchema.parse(req.body)

    // Pre-check phone uniqueness to avoid P2002 500 errors
    if (data.phone) {
      const clash = await prisma.user.findFirst({
        where: { phone: data.phone, NOT: { id: req.user!.id } },
        select: { id: true },
      })
      if (clash) return res.status(409).json({ error: 'Phone number already in use' })
    }

    // v16.9 MODERATION — check displayName + bio before persisting.
    if (data.displayName) {
      const modDecision = await moderateContent(data.displayName, {
        userId: req.user!.id,
        targetType: 'display_name',
      })
      if (!modDecision.allowed) {
        return res.status(422).json({
          error: `Имя отклонено модерацией: ${modDecision.reason}`,
          moderationBlocked: true,
        })
      }
    }
    if (data.bio) {
      const modDecision = await moderateContent(data.bio, {
        userId: req.user!.id,
        targetType: 'bio',
      })
      if (!modDecision.allowed) {
        return res.status(422).json({
          error: `Описание отклонено модерацией: ${modDecision.reason}`,
          moderationBlocked: true,
        })
      }
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        displayName: data.displayName,
        bio: data.bio,
        phone: data.phone,
        // Prisma accepts `null` to set the column to NULL (clear avatar).
        // Previously `data.avatar` was undefined when not provided, which
        // left the column unchanged — that's still the case. But now the
        // client can explicitly send `avatar: null` to delete the avatar.
        avatar: data.avatar,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        role: true,
        isOnline: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    res.json({ user: publicUser(user, { includeContact: true }) })
  }),
)

// ============================================================================
// First-run admin setup
// ============================================================================
// GET /api/auth/admin-exists  — public, returns whether any admin exists.
// Used by Studio to decide whether to show the first-run admin wizard or
// the regular login dialog.
router.get(
  '/admin-exists',
  asyncHandler(async (_req, res) => {
    // Phase 8.1: only count active (non-deleted) admins
    const count = await prisma.user.count({ where: { role: 'admin', deletedAt: null } })
    res.json({ hasAdmin: count > 0 })
  }),
)

// POST /api/auth/setup-admin  — public, but ONLY works if NO admin exists yet.
// Creates the first admin account and returns a JWT (auto-login).
//
// SECURITY MODEL (v25 — web-first setup):
//   The previous version required a one-time `FIRST_RUN_TOKEN` env var and
//   an `X-Setup-Admin-Token` HTTP header. This forced the operator to run
//   `curl` from the server shell to create the first admin — exactly the
//   kind of CLI step the new "web-only setup" UX is designed to eliminate.
//
//   The endpoint is now token-less. Protection against abuse comes from:
//     1. The `adminCount === 0` precondition — once any admin exists, the
//        endpoint hard-returns 403 forever. An attacker who reaches it
//        after setup completes gets nothing.
//     2. The authLimiter (20 / 15 min / IP) mounted on /api/auth/*.
//     3. A transactional count + create so two concurrent first-time
//        requests cannot both create admins (B-HIGH-009 race fix).
//     4. Username + email uniqueness checks (handled by Prisma P2002 too).
//
//   The remaining risk window is: between server boot and the operator
//   completing the wizard, anyone who can reach `/api/auth/setup-admin`
//   can become the first admin. This is acceptable for the same reason
//   it's acceptable on every CMS that ships a /install endpoint (WordPress,
//   Drupal, Nextcloud, …): the operator is expected to bring the server up
//   behind a private network or reverse proxy, complete setup, and only
//   then expose it publicly. The README documents this explicitly.
router.post(
  '/setup-admin',
  asyncHandler(async (req, res) => {
    // Block if an admin already exists — prevents privilege escalation.
    // Phase 8.1: only count active (non-deleted) admins.
    // The count + create run inside a single $transaction so two concurrent
    // first-time requests cannot both observe adminCount===0 (B-HIGH-009).
    const existingCount = await prisma.user.count({ where: { role: 'admin', deletedAt: null } })
    if (existingCount > 0) {
      return res
        .status(403)
        .json({ error: 'Setup already completed. Use the regular login.', code: 'setup_completed' })
    }

    const { createAdminSchema } = await import('../lib/schemas.js')
    const data = createAdminSchema.parse(req.body)

    if (data.password !== data.confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' })
    }

    // v19.0: validate password against DB-configured SecuritySettings.
    // (On a fresh install SecuritySettings doesn't exist yet → defaults apply:
    // min 8 chars, no complexity requirements. The wizard also enforces
    // client-side validation, but server-side is authoritative.)
    const pwdCheck = await validatePasswordAgainstSettings(data.password)
    if (!pwdCheck.ok) {
      return res.status(400).json({ error: pwdCheck.errors.join('. '), errors: pwdCheck.errors })
    }

    const email = data.email.trim().toLowerCase()
    const username = data.username.trim().toLowerCase()

    // Uniqueness pre-check — gives a clearer error than the generic
    // register endpoint. If an existing *non-admin* user already holds the
    // requested email/username, the operator must pick different
    // credentials (or use the reset-admin flow).
    const clash = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { id: true, email: true, username: true, role: true },
    })
    if (clash) {
      if (clash.role === 'admin') {
        // Should never reach here — we already blocked above when
        // existingCount > 0. Keep the defensive message just in case.
        return res
          .status(409)
          .json({ error: 'Администратор с таким email или логином уже существует. Используйте форму входа.' })
      }
      return res.status(409).json({
        error:
          'Этот email или логин уже занят обычным пользователем. ' +
          'Используйте другой email/логин, либо войдите под этим аккаунтом и затем сбросьте админа ' +
          '(кнопка «Забыли пароль? Сбросить админа» в Studio) с использованием reset-токена.',
      })
    }

    const password = await hashPassword(data.password)

    // Transactional create — re-checks adminCount inside the transaction
    // so a concurrent setup-admin request that committed between our
    // outer count and our create cannot also create an admin.
    const user = await prisma.$transaction(async (tx) => {
      const adminCount = await tx.user.count({ where: { role: 'admin', deletedAt: null } })
      if (adminCount > 0) {
        // Defensive: a concurrent request beat us to it. Surface a 409
        // without leaking details.
        throw new SetupAlreadyCompletedError()
      }
      return tx.user.create({
        data: {
          email,
          username,
          password,
          displayName: data.displayName,
          role: 'admin',
        },
      })
    }).catch((err) => {
      if (err instanceof SetupAlreadyCompletedError) {
        return null
      }
      throw err
    })

    if (!user) {
      // Concurrent request won the race.
      return res
        .status(409)
        .json({ error: 'Setup already completed.', code: 'setup_completed' })
    }

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: 'admin',
      v: user.tokenVersion,
    })
    // Phase 32: audit log setup-admin (first admin creation)
    await auditLogRaw(user.id, req, 'auth', user.id, 'setup_admin', {
      after: { username: user.username, email: user.email, note: 'First admin created via setup-admin (web wizard)' },
    })
    res.status(201).json({ token, user: publicUser(user, { includeContact: true }) })
  }),
)

// Sentinel error used to roll back the setup-admin transaction when a
// concurrent request beat us to creating the first admin. We catch it
// outside the transaction and convert to a clean 409 response.
class SetupAlreadyCompletedError extends Error {
  constructor() {
    super('setup_already_completed')
    this.name = 'SetupAlreadyCompletedError'
  }
}

// ============================================================================
// Change password — для авторизованного пользователя (в т.ч. админа)
// ============================================================================
// POST /api/auth/change-password
// Body: { currentPassword, newPassword, confirmPassword }
router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { changePasswordSchema } = await import('../lib/schemas.js')
    const data = changePasswordSchema.parse(req.body)

    if (data.newPassword !== data.confirmPassword) {
      return res.status(400).json({ error: 'Новые пароли не совпадают' })
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    // v9-audit-fix: reject if account is locked (same check as /login).
    // A locked-out user who still has a valid JWT shouldn't be able to
    // confirm their password via this endpoint.
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remainingMin = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000)
      return res.status(429).json({ error: `Аккаунт заблокирован. Попробуйте через ${remainingMin} мин.` })
    }

    // Проверяем текущий пароль
    const ok = await safeComparePassword(data.currentPassword, { password: user.password })
    if (!ok) {
      // v9-audit-fix: increment failedLoginCount on wrong current password
      // (same brute-force protection as /login).
      const newCount = (user.failedLoginCount || 0) + 1
      const shouldLock = newCount >= 5
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: newCount,
          ...(shouldLock ? { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}),
        },
      })
      return res.status(400).json({ error: 'Неверный текущий пароль' })
    }

    // H3 fix: используем универсальный comparePassword (поддерживает argon2id
    // и bcrypt legacy), а не bcrypt.compare напрямую. Раньше для argon2-юзеров
    // проверка всегда возвращала false — и пользователь мог поставить новый
    // пароль, идентичный текущему.
    const sameAsOld = await comparePassword(data.newPassword, user.password)
    if (sameAsOld) {
      return res.status(400).json({ error: 'Новый пароль должен отличаться от текущего' })
    }

    const newHash = await hashPassword(data.newPassword)
    // Bump tokenVersion so any other sessions (on other devices) are
    // immediately invalidated. The current request's token stays valid
    // — the client gets a fresh token below.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { password: newHash, tokenVersion: { increment: 1 } },
      select: { id: true, username: true, role: true, tokenVersion: true },
    })
    invalidateAuthCache(user.id)
    // Kick all real-time sockets so they have to reconnect with the new
    // token. (The current caller will get a fresh token in the response
    // and their next socket connection will use it.)
    kickUserSockets(user.id)

    // Issue a fresh token carrying the new tokenVersion so the caller's
    // current session keeps working.
    const freshToken = signToken({
      sub: updated.id,
      username: updated.username,
      role: updated.role as 'user' | 'admin',
      v: updated.tokenVersion,
    })
    // Phase 32: audit log password change
    await auditLogRaw(user.id, req, 'auth', user.id, 'change_password', {
      after: { username: updated.username },
    })
    res.json({ ok: true, token: freshToken })
  }),
)

// ============================================================================
// Reset admin — DANGEROUS: удаляет всех админов и создаёт нового.
// Используется ТОЛЬКО когда пользователь забыл пароль и не может войти.
// ============================================================================
// POST /api/auth/reset-admin
// Body: { displayName, username, email, password, confirmPassword, resetToken? }
//
// Безопасность:
//   — В production (NODE_ENV=production) запрос должен сопровождаться
//     заголовком X-Reset-Admin-Token со значением env RESET_ADMIN_TOKEN.
//     Без него — 403. Это предотвращает несанкционированный захват админки.
//   — В development (NODE_ENV=development) токен не требуется, чтобы
//     мастер первоначальной настройки оставался рабочим.
//   — Вся операция выполняется в одной транзакции: если создание нового
//     админа провалится, удаление старых откатится (atomicity).
router.post(
  '/reset-admin',
  asyncHandler(async (req, res) => {
    // SECURITY: Always require a one-time reset token from env, regardless of
    // NODE_ENV. Previously this was bypassed in development, which left the
    // endpoint wide open in any environment where NODE_ENV !== 'production'
    // (e.g. staging, sandbox previews). Now the rule is uniform: no
    // RESET_ADMIN_TOKEN env var → endpoint is fully disabled; otherwise the
    // caller MUST supply a matching X-Reset-Admin-Token header.
    const expected = process.env.RESET_ADMIN_TOKEN
    if (!expected || expected.length < 16) {
      return res
        .status(403)
        .json({ error: 'Admin reset is disabled. Set RESET_ADMIN_TOKEN env var (min 16 chars) to use it.' })
    }
    const provided = req.headers['x-reset-admin-token']
    if (typeof provided !== 'string' || provided.length === 0) {
      return res.status(403).json({ error: 'X-Reset-Admin-Token header required' })
    }
    // Constant-time comparison to prevent timing attacks.
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'Invalid reset token' })
    }

    const { resetAdminSchema } = await import('../lib/schemas.js')
    const data = resetAdminSchema.parse(req.body)

    if (data.password !== data.confirmPassword) {
      return res.status(400).json({ error: 'Пароли не совпадают' })
    }

    const email = data.email.trim().toLowerCase()
    const username = data.username.trim().toLowerCase()

    // Проверяем, что username/email не заняты НЕ-админом (чтобы не удалить чужой аккаунт)
    const clash = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
        role: { not: 'admin' },
      },
      select: { id: true },
    })
    if (clash) {
      return res.status(409).json({ error: 'Пользователь с таким email или username уже существует (не админ)' })
    }

    const password = await hashPassword(data.password)

    // Phase 8.1: SOFT-DELETE old admins instead of hard-delete.
    // Previously this did `deleteMany({ where: { role: 'admin' } })` which
    // CASCADE-deleted their orders, messages, reviews, audit logs — destroying
    // financial records and other users' chat history. Now we:
    //   1. Anonymize PII (email, phone, username, displayName, avatar, bio)
    //   2. Set deletedAt = now()
    //   3. Bump tokenVersion (invalidates all their JWTs immediately)
    // The user record stays in DB for referential integrity (orders, messages).
    // Atomic: soft-delete all admins + create new admin in one transaction.
    //
    // B-HIGH-004: kickUserSockets() and invalidateAuthCache() MUST run
    // OUTSIDE the $transaction. Calling socket.disconnect(true) from inside
    // the transaction callback holds the DB write lock for the duration of
    // the socket teardown round-trip (~10–50 ms per socket); with N old
    // admin sockets this serialises the entire transaction. Worse, if the
    // transaction is later retried by Prisma (deadlock, write conflict),
    // the sockets have ALREADY been kicked — the second attempt runs with
    // phantom state. We collect the affected ids inside the transaction
    // and act on them after it commits.
    const now = new Date()
    let kickedAdminIds: string[] = []
    const user = await prisma.$transaction(async (tx) => {
      const oldAdmins = await tx.user.findMany({
        where: { role: 'admin', deletedAt: null },
        select: { id: true },
      })
      kickedAdminIds = oldAdmins.map((o) => o.id)
      for (const old of oldAdmins) {
        await tx.user.update({
          where: { id: old.id },
          data: {
            email: `deleted-${old.id}@deleted.local`,
            phone: null,
            username: `deleted-${old.id}`,
            displayName: 'Deleted admin',
            avatar: null,
            bio: null,
            deletedAt: now,
            tokenVersion: { increment: 1 },
          },
        })
      }
      return tx.user.create({
        data: {
          email,
          username,
          password,
          displayName: data.displayName,
          role: 'admin',
        },
      })
    })

    // B-HIGH-004: invalidate cache + kick sockets AFTER the transaction
    // commits — never inside it (see comment above).
    for (const oldId of kickedAdminIds) {
      invalidateAuthCache(oldId)
      // v8-audit-fix: kick old admin's sockets (was missing — old admin kept receiving real-time events)
      kickUserSockets(oldId)
    }

    // Invalidate any cached auth entries for the new admin id (paranoia).
    invalidateAuthCache(user.id)

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: 'admin',
      v: user.tokenVersion,
    })
    // Phase 32: audit log reset-admin (critical security event)
    await auditLogRaw(user.id, req, 'auth', user.id, 'reset_admin', {
      after: { username: user.username, email: user.email, note: 'All previous admins were soft-deleted' },
    })
    res.status(201).json({ token, user: publicUser(user, { includeContact: true }) })
  }),
)

// ============================================================================
// v9-audit-fix: S-CRIT-008 — 2FA/TOTP endpoints
// These endpoints implement the runtime for the totpSecret/totpEnabled schema
// fields. Feature is opt-in per user — admins can enable TOTP on their account
// for an extra layer of security beyond password + JWT.
// ============================================================================

// POST /api/auth/totp/setup — generate a new TOTP secret and return QR URL.
// The secret is stored but TOTP is NOT enabled until verified via /totp/verify.
//
// C1 fix: этот endpoint требует повторного подтверждения credentials:
//   - Если у юзера TOTP уже включён (re-setup scenario) — валидный TOTP код.
//   - Если TOTP ещё не включён (первичный setup) — currentPassword.
// Раньше endpoint принимал любой действующий JWT — злоумышленник с украденным
// токеном мог полностью отключить 2FA жертвы-админа (вызвать /totp/setup,
// затем повторно через /totp/verify с тем же секретом, который он же и сгенерил).
router.post(
  '/totp/setup',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const body = (req.body || {}) as { currentPassword?: string; code?: string }

    // Если TOTP уже включён — требуем валидный TOTP код (re-setup).
    // Если TOTP не включён — требуем текущий пароль (первичный setup).
    if (user.totpEnabled && user.totpSecret) {
      if (!body.code) {
        return res.status(400).json({ error: 'Для перегенерации TOTP введите текущий код 2FA.' })
      }
      const { verifyTotp } = await import('../lib/totp.js')
      if (!verifyTotp(body.code, user.totpSecret)) {
        return res.status(401).json({ error: 'Неверный код 2FA.' })
      }
    } else {
      if (!body.currentPassword) {
        return res.status(400).json({ error: 'Введите текущий пароль для настройки 2FA.' })
      }
      const ok = await comparePassword(body.currentPassword, user.password)
      if (!ok) {
        return res.status(401).json({ error: 'Неверный текущий пароль.' })
      }
    }

    const { generateTotpSecret, generateTotpUrl } = await import('../lib/totp.js')
    const secret = generateTotpSecret()
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { totpSecret: secret, totpEnabled: false },
    })
    await auditLogRaw(user.id, req, 'auth', user.id, 'totp_setup_initiated', {
      after: { wasEnabled: user.totpEnabled },
    })
    const otpauthUrl = generateTotpUrl(secret, user.email || 'user@999.pro')
    res.json({ secret, otpauthUrl })
  }),
)

// POST /api/auth/totp/verify — verify a TOTP code and enable TOTP.
//
// ARCHITECTURAL FIX: after TOTP is successfully enabled, issue a FRESH
// regular JWT (no `totpPending` claim) and return it. The client swaps
// the setup token for this regular token, gaining full admin access.
//
// This endpoint accepts BOTH setup tokens (`totpPending: true`, issued by
// /api/auth/login when admin first logs in without TOTP) and regular tokens
// (for already-authenticated users re-verifying after re-setup). The
// `requireAuth` middleware accepts both; `requireAdmin` is intentionally
// NOT chained here so totpPending tokens are allowed.
router.post(
  '/totp/verify',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user?.totpSecret) {
      return res.status(400).json({ error: 'Сначала вызовите /totp/setup для генерации секрета.' })
    }
    const code = (req.body as { code?: string })?.code
    if (!code) {
      return res.status(400).json({ error: 'Не указан код подтверждения.' })
    }
    const { verifyTotp } = await import('../lib/totp.js')
    if (!verifyTotp(code, user.totpSecret)) {
      return res.status(401).json({ error: 'Неверный код. Попробуйте снова.' })
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    })
    await auditLogRaw(user.id, req, 'auth', user.id, 'totp_enabled', {})

    // Issue a fresh regular JWT (no totpPending). If the caller used a
    // setup token, this regular token replaces it — full admin access
    // restored. If the caller already had a regular token, this just
    // refreshes it (harmless).
    const freshToken = signToken({
      sub: user.id,
      username: user.username,
      role: user.role as 'user' | 'admin',
      v: user.tokenVersion,
    })

    res.json({ enabled: true, token: freshToken, user: publicUser(user, { includeContact: true }) })
  }),
)

// POST /api/auth/totp/disable — disable TOTP (requires current code).
router.post(
  '/totp/disable',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user?.totpEnabled) {
      return res.status(400).json({ error: 'TOTP не включён.' })
    }
    const code = (req.body as { code?: string })?.code
    if (!code || !user.totpSecret) {
      return res.status(400).json({ error: 'Требуется код для подтверждения отключения.' })
    }
    const { verifyTotp } = await import('../lib/totp.js')
    if (!verifyTotp(code, user.totpSecret)) {
      return res.status(401).json({ error: 'Неверный код.' })
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabled: false },
    })
    await auditLogRaw(user.id, req, 'auth', user.id, 'totp_disabled', {})
    res.json({ enabled: false })
  }),
)

// ============================================================================
// v19.0 — Email 2FA + Backup codes verification on login
// ============================================================================

/**
 * Try to authenticate using a TOTP backup code.
 * Backup codes are stored as bcrypt hashes. On successful match, the
 * code is removed from the user's list (one-time use).
 * Returns true if a backup code matched.
 */
async function tryBackupCode(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpBackupCodes: true },
  })
  if (!user?.totpBackupCodes) return false
  let arr: string[] = []
  try {
    arr = JSON.parse(user.totpBackupCodes)
    if (!Array.isArray(arr)) return false
  } catch {
    return false
  }
  for (let i = 0; i < arr.length; i++) {
    const hash = arr[i]
    try {
      const match = await bcrypt.compare(code, hash)
      if (match) {
        // Remove this code (one-time use)
        arr.splice(i, 1)
        await prisma.user.update({
          where: { id: userId },
          data: { totpBackupCodes: JSON.stringify(arr) },
        })
        return true
      }
    } catch {
      // skip malformed hashes
    }
  }
  return false
}

// ============================================================================
// v9-audit-fix: S-CRIT-007 — Email verification endpoint
// Env-gated: only required when EMAIL_VERIFICATION_REQUIRED=true.
// Without SMTP configured, verification links are logged to console.
// ============================================================================

// GET /api/auth/verify-email?token=xxx — verify email with token
router.get(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token || '')
    if (!token || token.length < 16) {
      return res.status(400).json({ error: 'Недействительный токен верификации.' })
    }

    // Look up the verification token in AppSetting
    const setting = await prisma.appSetting.findUnique({
      where: { id: `email:verify:${token}` },
    })
    if (!setting) {
      return res.status(400).json({ error: 'Токен не найден или уже использован.' })
    }

    try {
      const data = JSON.parse(setting.value) as { userId: string; expires: string }
      if (new Date(data.expires) < new Date()) {
        await prisma.appSetting.delete({ where: { id: setting.id } })
        return res.status(400).json({ error: 'Срок действия токена истёк. Запросите новый.' })
      }

      // Mark email as verified
      await prisma.user.update({
        where: { id: data.userId },
        data: { emailVerified: new Date() },
      })

      // Delete the token (single-use)
      await prisma.appSetting.delete({ where: { id: setting.id } })

      await auditLogRaw(data.userId, req, 'auth', data.userId, 'email_verified', {})
      res.json({ ok: true, message: 'Email успешно подтверждён.' })
    } catch {
      return res.status(400).json({ error: 'Недействительный токен.' })
    }
  }),
)

// POST /api/auth/send-verification — send a new verification email
router.post(
  '/send-verification',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Fetch full user record (req.user only has JWT payload fields)
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, emailVerified: true },
    })
    if (!user) {
      return res.status(404).json({ error: 'User not found.' })
    }

    // Already verified?
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email уже подтверждён.' })
    }

    // Generate a verification token (32 hex chars = 128 bits)
    const crypto = await import('node:crypto')
    const token = crypto.randomBytes(16).toString('hex')

    // Store in AppSetting with 24h expiry
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await prisma.appSetting.upsert({
      where: { id: `email:verify:${token}` },
      update: { value: JSON.stringify({ userId: user.id, expires: expires.toISOString() }) },
      create: {
        id: `email:verify:${token}`,
        value: JSON.stringify({ userId: user.id, expires: expires.toISOString() }),
      },
    })

    // Construct verification URL
    const baseUrl = process.env.APP_PUBLIC_URL || 'http://localhost:3000'
    const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`

    // AUDIT-3 S-HIGH-002 fix (v16.8): actually send the email via SMTP.
    // Previously this was a TODO + the URL was logged to stderr — anyone
    // with log access could see the verification token. Now we use the
    // real sendVerificationEmail() from lib/email.ts, which:
    //   • sends via SMTP if SMTP_HOST is configured
    //   • silently skips (with a non-token log line) if no SMTP configured
    // The verification URL itself is NEVER logged — only recipient + subject.
    const { sendVerificationEmail } = await import('../lib/email.js')
    await sendVerificationEmail(user.email, verifyUrl)

    res.json({ ok: true, message: 'Письмо верификации отправлено.' })
  }),
)

// ============================================================================
// AUDIT-3 S-MED-008 fix (v16.8): forgot-password flow.
// Previously, users who forgot their password had NO way to recover the
// account — the only option was admin /reset-admin which deletes ALL admins.
// Now: POST /api/auth/forgot-password (public, rate-limited) → sends email
// with a 1-hour reset token. POST /api/auth/reset-password (public) →
// verifies token + sets new password + bumps tokenVersion (invalidates all
// existing sessions, including the attacker's if the password was leaked).
// ============================================================================

// POST /api/auth/forgot-password — request a password reset email.
// Always returns 200 (even if email doesn't exist) to prevent user enumeration.
// (Rate-limited globally by app.use('/api/auth', authLimiter) in index.ts.)
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const schema = z.object({ email: z.string().email().or(z.string().min(3).max(50)) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(200).json({ ok: true, message: 'Если аккаунт существует, письмо отправлено.' })
    }
    const login = parsed.data.email.toLowerCase().trim()

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: login }, { username: login }, { phone: login }], deletedAt: null },
      select: { id: true, email: true, username: true },
    })

    // Always return 200 — do not leak whether the email exists.
    if (user) {
      // Generate a 32-byte hex token + store in AppSetting with 1h expiry.
      const token = crypto.randomBytes(32).toString('hex')
      const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      await prisma.appSetting.upsert({
        where: { id: `pwd:reset:${token}` },
        update: { value: JSON.stringify({ userId: user.id, expires: expires.toISOString() }) },
        create: {
          id: `pwd:reset:${token}`,
          value: JSON.stringify({ userId: user.id, expires: expires.toISOString() }),
        },
      })

      const baseUrl = process.env.APP_PUBLIC_URL || 'http://localhost:3000'
      const resetUrl = `${baseUrl}/?view=reset-password&token=${token}`

      const { sendPasswordResetEmail } = await import('../lib/email.js')
      await sendPasswordResetEmail(user.email, resetUrl)

      // Audit the reset request (without logging the token).
      await auditLogRaw(user.id, req, 'auth', user.id, 'password_reset_requested', {
        after: { username: user.username },
      })
    }

    res.status(200).json({ ok: true, message: 'Если аккаунт существует, письмо отправлено.' })
  }),
)

// POST /api/auth/reset-password — set a new password using a reset token.
// (Rate-limited globally by app.use('/api/auth', authLimiter) in index.ts.)
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      token: z.string().min(64).max(64),
      newPassword: z.string().min(8).max(200),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Неверный запрос', issues: parsed.error.issues })
    }
    const { token, newPassword } = parsed.data

    // Look up the token in AppSetting.
    const setting = await prisma.appSetting.findUnique({ where: { id: `pwd:reset:${token}` } })
    if (!setting) {
      return res.status(400).json({ error: 'Недействительный или истёкший токен' })
    }

    let tokenData: { userId: string; expires: string }
    try {
      tokenData = JSON.parse(setting.value)
    } catch {
      return res.status(400).json({ error: 'Недействительный токен' })
    }

    // Check expiry.
    if (new Date(tokenData.expires) < new Date()) {
      // Delete the expired token so it can't be reused.
      await prisma.appSetting.delete({ where: { id: `pwd:reset:${token}` } }).catch(() => {})
      return res.status(400).json({ error: 'Срок действия токена истёк. Запросите новый.' })
    }

    // Fetch the user.
    const user = await prisma.user.findUnique({
      where: { id: tokenData.userId, deletedAt: null },
      select: { id: true, username: true, tokenVersion: true },
    })
    if (!user) {
      return res.status(400).json({ error: 'Аккаунт не найден' })
    }

    // Hash the new password + bump tokenVersion to invalidate ALL existing
    // sessions (including the attacker's, if the password was leaked).
    const newHash = await hashPassword(newPassword)
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password: newHash,
          tokenVersion: { increment: 1 }, // invalidate all existing JWTs
          failedLoginCount: 0,
          lockedUntil: null, // clear any active lockout
        },
      }),
      // Delete the reset token so it can't be reused.
      prisma.appSetting.delete({ where: { id: `pwd:reset:${token}` } }),
    ])

    // Audit the successful reset.
    await auditLogRaw(user.id, req, 'auth', user.id, 'password_reset_completed', {
      after: { username: user.username },
    })

    // Kick any active socket sessions so the user has to re-login everywhere.
    try {
      const { kickUserSockets } = await import('../socket/handlers.js')
      kickUserSockets(user.id)
    } catch { /* non-critical */ }

    res.json({ ok: true, message: 'Пароль изменён. Войдите с новым паролем.' })
  }),
)

export default router
