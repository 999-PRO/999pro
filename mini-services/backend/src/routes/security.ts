/**
 * v19.0 — Security settings + 2FA backup codes + session management routes.
 *
 * Security settings (admin):
 *   GET    /api/security-settings                — public, returns sanitized settings
 *   PUT    /api/security-settings                — admin, update settings
 *
 * 2FA backup codes (auth):
 *   POST   /api/security/totp/backup-codes       — generate new backup codes (returns codes ONCE)
 *
 * Session management (auth):
 *   POST   /api/security/logout-all              — invalidate all sessions (bumps tokenVersion)
 *   GET    /api/security/sessions                — list recent sessions (from audit log)
 */
import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, requireAdminOnly, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { logger } from '../lib/logger.js'

const router = Router()

// ---------- SECURITY SETTINGS ----------

const DEFAULT_SECURITY_SETTINGS = {
  emailVerificationRequired: false,
  totpRequiredForAdmins: true,
  totpRequiredForUsers: false,
  totpAllowBackupCodes: true,
  allowLoginWithoutVerification: true,
  sessionTimeoutMin: 10080,
  refreshTokenTTLDays: 30,
  maxFailedLogins: 5,
  lockoutDurationMin: 15,
  passwordMinLength: 8,
  passwordMaxLength: 128,
  passwordRequireUppercase: false,
  passwordRequireLowercase: true,
  passwordRequireDigit: false,
  passwordRequireSymbol: false,
  authRateLimitPer15Min: 10,
}

const securitySettingsSchema = z.object({
  emailVerificationRequired: z.boolean().default(false),
  totpRequiredForAdmins: z.boolean().default(true),
  totpRequiredForUsers: z.boolean().default(false),
  totpAllowBackupCodes: z.boolean().default(true),
  allowLoginWithoutVerification: z.boolean().default(true),
  sessionTimeoutMin: z.number().int().min(1).max(525600).default(10080),
  refreshTokenTTLDays: z.number().int().min(1).max(365).default(30),
  maxFailedLogins: z.number().int().min(3).max(20).default(5),
  lockoutDurationMin: z.number().int().min(1).max(1440).default(15),
  passwordMinLength: z.number().int().min(6).max(128).default(8),
  passwordMaxLength: z.number().int().min(32).max(256).default(128),
  passwordRequireUppercase: z.boolean().default(false),
  passwordRequireLowercase: z.boolean().default(true),
  passwordRequireDigit: z.boolean().default(false),
  passwordRequireSymbol: z.boolean().default(false),
  authRateLimitPer15Min: z.number().int().min(3).max(100).default(10),
})

/** Public — returns sanitized security settings (no sensitive data). */
export async function getSecuritySettings() {
  const settings = await prisma.securitySettings.findUnique({ where: { id: 'default' } })
  if (!settings) return DEFAULT_SECURITY_SETTINGS
  return {
    emailVerificationRequired: settings.emailVerificationRequired,
    totpRequiredForAdmins: settings.totpRequiredForAdmins,
    totpRequiredForUsers: settings.totpRequiredForUsers,
    totpAllowBackupCodes: settings.totpAllowBackupCodes,
    allowLoginWithoutVerification: settings.allowLoginWithoutVerification,
    sessionTimeoutMin: settings.sessionTimeoutMin,
    refreshTokenTTLDays: settings.refreshTokenTTLDays,
    maxFailedLogins: settings.maxFailedLogins,
    lockoutDurationMin: settings.lockoutDurationMin,
    passwordMinLength: settings.passwordMinLength,
    passwordMaxLength: settings.passwordMaxLength,
    passwordRequireUppercase: settings.passwordRequireUppercase,
    passwordRequireLowercase: settings.passwordRequireLowercase,
    passwordRequireDigit: settings.passwordRequireDigit,
    passwordRequireSymbol: settings.passwordRequireSymbol,
    authRateLimitPer15Min: settings.authRateLimitPer15Min,
  }
}

// GET /api/security-settings — public
router.get(
  '/security-settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getSecuritySettings() })
  }),
)

// PUT /api/security-settings — admin only (requireAdminOnly).
// v25.7 (TZ ЭТАП 2.6): managers must NOT be able to change security policy —
// they could otherwise weaken TOTP enforcement, raise rate limits, lower the
// password-strength floor, or extend session TTL to make a stolen token last
// longer. Only a true admin (not a manager) can change security policy.
router.put(
  '/security-settings',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = securitySettingsSchema.parse(req.body)
    const settings = await prisma.securitySettings.upsert({
      where: { id: 'default' },
      update: parsed,
      create: { id: 'default', ...parsed },
    })
    await auditLog(req, 'security-settings', 'default', 'update', parsed)
    logger.info('Security settings updated', { module: 'security', by: req.user!.id })
    res.json({ settings })
  }),
)

// ---------- 2FA BACKUP CODES ----------

/**
 * Generate 10 one-time-use backup codes for the user.
 * Returns the codes IN CLEARTEXT once — the DB stores only bcrypt hashes.
 * The user MUST save these codes outside the app.
 */
router.post(
  '/security/totp/backup-codes',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Verify user has TOTP enabled (backup codes only make sense with TOTP)
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { totpEnabled: true, totpBackupCodes: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.totpEnabled) {
      return res.status(400).json({ error: 'Сначала включите TOTP 2FA' })
    }
    // Generate 10 random 8-character codes (uppercase, alphanumeric without ambiguous chars)
    const codes: string[] = []
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (let i = 0; i < 10; i++) {
      let code = ''
      const bytes = crypto.randomBytes(8)
      for (let j = 0; j < 8; j++) {
        code += chars[bytes[j] % chars.length]
      }
      codes.push(code)
    }
    // Hash each code with bcrypt and store
    const hashedCodes = await Promise.all(
      codes.map((c) => bcrypt.hash(c, 10)),
    )
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        totpBackupCodes: JSON.stringify(hashedCodes),
        totpBackupCodesGeneratedAt: new Date(),
      },
    })
    await auditLog(req, 'user', req.user!.id, 'backup_codes_generate', { count: codes.length })
    res.json({
      codes,
      message: 'Сохраните эти коды в безопасном месте. Каждый код можно использовать один раз.',
    })
  }),
)

// GET /api/security/totp/backup-codes-status — auth
router.get(
  '/security/totp/backup-codes-status',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { totpBackupCodes: true, totpBackupCodesGeneratedAt: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    let count = 0
    try {
      const arr = JSON.parse(user.totpBackupCodes || '[]')
      count = Array.isArray(arr) ? arr.length : 0
    } catch { count = 0 }
    res.json({
      hasBackupCodes: count > 0,
      count,
      generatedAt: user.totpBackupCodesGeneratedAt,
    })
  }),
)

// ---------- SESSION MANAGEMENT ----------

/**
 * "Logout everywhere" — bumps tokenVersion, which invalidates all
 * previously-issued JWTs. The user must re-authenticate on every device.
 */
router.post(
  '/security/logout-all',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { tokenVersion: { increment: 1 } },
    })
    await auditLog(req, 'user', req.user!.id, 'logout_all', {})
    res.json({ ok: true, message: 'Все сессии завершены. Необходим повторный вход.' })
  }),
)

/**
 * List recent sessions (approximate — based on audit log entries
 * for 'login' events for this user).
 */
router.get(
  '/security/sessions',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const logs = await prisma.auditLog.findMany({
      where: {
        userId: req.user!.id,
        action: { in: ['login', 'logout', 'logout_all', 'token_refresh'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    const sessions = logs.map((l) => ({
      id: l.id,
      action: l.action,
      ip: l.ip,
      userAgent: l.userAgent,
      createdAt: l.createdAt,
    }))
    res.json({ sessions })
  }),
)

export default router
