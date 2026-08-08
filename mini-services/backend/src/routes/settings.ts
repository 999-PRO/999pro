import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, requireAdminOnly, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { logger } from '../lib/logger.js'
// P0-1 fix: server-side HTML sanitiser to prevent stored XSS in hero block
import { sanitiseInlineHtml } from '../lib/sanitise.js'

const router = Router()

// App settings stored as key/value pairs (value is JSON-encoded string).
// Known keys:
//   - headerImage: { url: string, position: 'center' | 'top' | 'bottom', enabled: boolean }
//   - heroBlock:   { enabled, useGradient, image, badge, title, description,
//                    primaryButton: {text, view, link}, secondaryButton: {...}, gradient }

// Whitelist of settings readable without auth (public)
const PUBLIC_SETTING_KEYS = new Set(['headerImage', 'headerEnabled', 'whatsapp', 'telegram', 'email', 'phone', 'address', 'workingHours', 'heroBlock', 'appTitle', 'homeLayout', 'modulesEnabled', 'bonusPointsSettings', 'communicationSettings', 'splashScreen'])

// Whitelist of all known setting keys (so attackers can't fill the DB with junk)
const KNOWN_SETTING_KEYS = new Set(['headerImage', 'headerEnabled', 'whatsapp', 'telegram', 'email', 'phone', 'address', 'workingHours', 'heroBlock', 'appTitle', 'homeLayout', 'modulesEnabled', 'bonusPointsSettings', 'communicationSettings', 'splashScreen'])

// Zod schema for the headerImage setting value
const headerImageValueSchema = z.object({
  url: z.string().max(2048).nullable(),
  position: z.enum(['center', 'top', 'bottom']).default('center'),
  enabled: z.boolean().default(false),
})

// Zod schema for the heroBlock setting value (desktop hero on home page).
// All fields are optional in the sense that the admin can clear them, but
// when present they must match the expected shape.
const heroButtonSchema = z.object({
  text: z.string().max(80),
  // Internal view to navigate to (e.g. 'catalog', 'feed'). Mutually exclusive
  // with `link` (external URL). If both are set, `view` takes precedence on
  // the client.
  view: z.string().max(40).nullable().optional(),
  // External URL (e.g. https://example.com/promo). Used when `view` is null.
  link: z.string().max(2048).nullable().optional(),
}).nullable()

const heroBlockValueSchema = z.object({
  enabled: z.boolean().default(true),
  // When true: render the gradient over the image (legacy style). When false:
  // show the image as-is with no overlay (raw image).
  useGradient: z.boolean().default(true),
  // Background image URL (optional — if null, only the gradient renders).
  image: z.string().max(2048).nullable(),
  // Gradient ID — must match one of the GRADIENTS in the frontend map.
  gradient: z.string().max(200).default('from-sky-400 via-blue-500 to-indigo-600'),
  // Small badge text above the title (e.g. "Новый дроп уже здесь").
  badge: z.string().max(120).nullable(),
  // v16.2: title + description are nullable — Studio sends null when the
  // admin clears these fields (image-only hero mode). Previously the schema
  // rejected null → "Invalid payload" error on every save with empty fields.
  title: z.string().max(200).nullable(),
  description: z.string().max(800).nullable(),
  // Primary CTA button (gradient background).
  primaryButton: heroButtonSchema,
  // Secondary CTA button (outline / glass).
  secondaryButton: heroButtonSchema,
  // v16.2: image-fit + display-mode (frontend sends these; backend now
  // persists them instead of silently stripping via Zod default)
  objectFit: z.enum(['cover', 'contain']).default('cover').optional(),
  mode: z.enum(['image-text', 'image-only']).default('image-text').optional(),
})

// String-valued settings (whatsapp, telegram, email, phone, address, workingHours).
// Stored as JSON-encoded strings. Validation rejects objects (which would corrupt
// the value on round-trip — see audit finding H1).
const STRING_SETTING_KEYS = new Set(['whatsapp', 'telegram', 'email', 'phone', 'address', 'workingHours', 'appTitle'])
const stringValueSchema = z.union([
  z.string().max(512),
  z.null(),
])

// v16.5: Home page layout — visual constructor config. Array of block
// definitions with id, visible, pinned, order. Admin edits via Studio.
const homeLayoutSchema = z.array(z.object({
  id: z.string().min(1).max(50),          // hero, stories, search, banner, trending, popular, etc.
  visible: z.boolean().default(true),
  pinned: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
})).max(30)

// v19.0: Module access control — toggles for each top-level module.
// Admin can enable/disable modules in Studio → Настройки → Доступ к модулям.
// Disabled modules are hidden from nav + blocked at route level.
const MODULE_KEYS = [
  'chat', 'ai-assistant', 'audio-hub', 'video-hub', 'media-hub',
  'catalog', 'orders', 'profile', 'favorites', 'news', 'notifications',
  'club', 'stories', 'studio', 'reviews', 'support', 'settings',
] as const
const modulesEnabledSchema = z.object({
  // Default all to true if undefined — backward compat.
  chat: z.boolean().default(true),
  'ai-assistant': z.boolean().default(true),
  'audio-hub': z.boolean().default(true),
  'video-hub': z.boolean().default(true),
  'media-hub': z.boolean().default(true),
  catalog: z.boolean().default(true),
  orders: z.boolean().default(true),
  profile: z.boolean().default(true),
  favorites: z.boolean().default(true),
  news: z.boolean().default(true),
  notifications: z.boolean().default(true),
  club: z.boolean().default(true),
  stories: z.boolean().default(true),
  studio: z.boolean().default(true),
  reviews: z.boolean().default(true),
  support: z.boolean().default(true),
  settings: z.boolean().default(true),
}).passthrough()

// v20: Communication features — toggles read by chat UI to hide/disable buttons.
// Stored as AppSetting.communicationSettings (JSON). All keys default to true
// for backward compat with deployments that haven't configured this yet.
const communicationSettingsSchema = z.object({
  calls: z.boolean().default(true),               // audio calls
  videoCalls: z.boolean().default(true),          // video calls
  photoUpload: z.boolean().default(true),         // photo upload in chat
  documentUpload: z.boolean().default(true),      // document upload in chat
  videoUpload: z.boolean().default(false),        // video upload (OFF by default per product decision)
  voiceMessages: z.boolean().default(true),       // voice messages
  screenShare: z.boolean().default(false),        // screen share (not yet implemented)
  videoConferences: z.boolean().default(false),   // video conferences (future)
}).passthrough()

// GET /api/settings/:key — public for whitelisted keys, auth-required otherwise
router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const key = req.params.key
    if (!PUBLIC_SETTING_KEYS.has(key)) {
      // For non-public keys, require auth
      // (We can't easily attach requireAuth here without restructuring — so we
      // simply require the caller to send a Bearer token manually, OR we just
      // return 404 to avoid leaking existence. We choose 404 to hide existence.)
      return res.status(404).json({ error: 'Setting not found' })
    }
    const setting = await prisma.appSetting.findUnique({ where: { id: key } })
    if (!setting) return res.json({ value: null })
    try {
      res.json({ value: JSON.parse(setting.value) })
    } catch {
      res.json({ value: setting.value })
    }
  }),
)

// GET /api/settings — admin only, list all
router.get(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const settings = await prisma.appSetting.findMany()
    const out: Record<string, any> = {}
    for (const s of settings) {
      try {
        out[s.id] = JSON.parse(s.value)
      } catch {
        out[s.id] = s.value
      }
    }
    res.json({ settings: out })
  }),
)

// PUT /api/settings/:key — admin only (requireAdminOnly), upsert.
// v25.7 (TZ ЭТАП 2.6): system-wide settings include feature flags
// (modulesEnabled), splash screen, home layout, branding. Managers must
// not be able to disable modules or change branding — they could break
// the storefront, hide evidence of activity, or impersonate the brand.
// Only a true admin (not a manager) can change system-wide settings.
router.put(
  '/:key',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const key = req.params.key
    if (!KNOWN_SETTING_KEYS.has(key)) {
      return res.status(400).json({ error: 'Unknown setting key' })
    }

    // Validate the value shape for known keys
    let valueToStore = req.body
    if (key === 'headerImage') {
      valueToStore = headerImageValueSchema.parse(req.body)
    } else if (key === 'heroBlock') {
      valueToStore = heroBlockValueSchema.parse(req.body)
      // P0-1 fix: sanitise text fields in hero block to prevent stored XSS
      const hero = valueToStore as Record<string, unknown>
      if (typeof hero.badge === 'string') hero.badge = sanitiseInlineHtml(hero.badge)
      if (typeof hero.title === 'string') hero.title = sanitiseInlineHtml(hero.title)
      if (typeof hero.description === 'string') hero.description = sanitiseInlineHtml(hero.description)
    } else if (key === 'homeLayout') {
      valueToStore = homeLayoutSchema.parse(req.body)
    } else if (key === 'modulesEnabled') {
      valueToStore = modulesEnabledSchema.parse(req.body)
    } else if (key === 'communicationSettings') {
      valueToStore = communicationSettingsSchema.parse(req.body)
    } else if (key === 'splashScreen') {
      // v20: splash screen settings — passthrough (admin-controlled shape)
      valueToStore = req.body
    } else if (STRING_SETTING_KEYS.has(key)) {
      // Reject wrapped objects (e.g. `{ value: "+7999..." }`) — only accept
      // a raw string or null. This prevents the triple-wrapping bug that
      // corrupted contact settings on every save.
      valueToStore = stringValueSchema.parse(req.body)
    }

    const value = JSON.stringify(valueToStore)
    // Capture the BEFORE value for the audit log so we have a proper
    // before/after snapshot. Best-effort — if the findUnique fails we
    // still proceed with the upsert and log `before: null`.
    let beforeValue: unknown = null
    try {
      const existing = await prisma.appSetting.findUnique({ where: { id: key } })
      if (existing) {
        try {
          beforeValue = JSON.parse(existing.value)
        } catch {
          beforeValue = existing.value
        }
      }
    } catch (e) {
      logger.error('findUnique before upsert failed:', { module: 'settings', error: e })
    }

    await prisma.appSetting.upsert({
      where: { id: key },
      update: { value },
      create: { id: key, value },
    })

    // S-HIGH-001: audit-log every settings change so admin actions are
    // traceable. Previously this handler mutated settings with zero trail.
    await auditLog(req, 'settings', key, 'update', {
      before: beforeValue,
      after: valueToStore,
    })

    // v16.5: broadcast settings change to ALL connected clients so the main
    // app refetches instantly (no manual refresh needed). Mirrors the
    // lead/order status-change socket pattern.
    try {
      const { getIo } = await import('../socket/handlers.js')
      const io = getIo()
      if (io) io.emit('settings:changed', { key })
    } catch { /* non-critical */ }

    res.json({ ok: true, value: valueToStore })
  }),
)

// DELETE /api/settings/:key — admin only (requireAdminOnly).
// v25.7 (TZ ЭТАП 2.6): same rationale as PUT /:key above — system-wide
// settings include feature flags, branding, splash screen. Managers must
// not be able to delete (reset) these. Only a true admin can.
router.delete(
  '/:key',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const key = req.params.key
    if (!KNOWN_SETTING_KEYS.has(key)) {
      return res.status(400).json({ error: 'Unknown setting key' })
    }
    try {
      await prisma.appSetting.delete({ where: { id: key } })
    } catch {
      /* ignore if missing */
    }
    res.json({ ok: true })
  }),
)

export default router
