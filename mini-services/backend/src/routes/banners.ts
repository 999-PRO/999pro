import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog, auditLogBulk } from '../lib/audit.js'
import { broadcastChanged } from '../lib/broadcast.js'

const router = Router()

// v13.0 — full fix for the banner creation bug.
//
// Root cause (audit task 1-D): the Studio UI sends `null` for empty text
// fields (`title`, `subtitle`, `cta`, `link`) but the previous schema only
// accepted `string | undefined`. Zod's `.optional()` allows `undefined`
// but rejects `null`, so every request with at least one empty field
// failed with `ZodError: "Expected string, received null"`.
//
// Fix: accept `null` everywhere via `.nullable()`, and provide defaults
// via `.transform()` (Zod `.default()` only fires for `undefined`, not
// for `null`). Also completes the v12.6.4 image-only feature by adding
// `mode` and `objectFit` to the schema (previously silently stripped).
const bannerSchema = z.object({
  title: z
    .string()
    .max(200)
    .nullable()
    // empty/null → '' (image-only banners may have no title)
    .transform((v) => (v == null || v.trim() === '' ? '' : v.trim())),
  subtitle: z
    .string()
    .max(500)
    .nullable()
    .transform((v) => (v == null || v.trim() === '' ? null : v.trim()))
    .optional(),
  cta: z
    .string()
    .max(50)
    .nullable()
    .transform((v) => {
      const s = v == null ? '' : v.trim()
      return s === '' ? 'Смотреть' : s
    }),
  image: z.string().min(1).max(2048),
  gradient: z.string().max(200).default('from-sky-400 via-blue-500 to-indigo-600'),
  useGradient: z.boolean().default(true),
  link: z
    .string()
    .max(2048)
    .nullable()
    .transform((v) => (v == null || v.trim() === '' ? null : v.trim()))
    .optional(),
  order: z.number().int().default(0),
  isActive: z.boolean().default(true),
  // v12.6.4 (now actually implemented):
  //   mode       — 'image-text' (default, classic banner with overlay)
  //              | 'image-only' (raw image, no text, no overlay)
  //   objectFit  — 'cover'   (default, fills the banner box, may crop)
  //              | 'contain' (full image visible, may letterbox)
  mode: z.enum(['image-text', 'image-only']).default('image-text'),
  objectFit: z.enum(['cover', 'contain']).default('cover'),
})

const updateBannerSchema = bannerSchema.partial()

// GET /api/banners — public, returns active banners ordered by `order`
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const banners = await prisma.banner.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
    res.json({ items: banners })
  }),
)

// GET /api/banners/all — admin only, returns ALL banners (incl. inactive)
router.get(
  '/all',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const banners = await prisma.banner.findMany({
      orderBy: { order: 'asc' },
    })
    res.json({ items: banners })
  }),
)

// POST /api/banners — admin only, create
router.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = bannerSchema.parse(req.body)
    // If order not provided (default 0 + no explicit value), put at the end
    if (data.order === 0 && req.body?.order === undefined) {
      const count = await prisma.banner.count()
      data.order = count
    }
    const banner = await prisma.banner.create({
      data: {
        title: data.title,
        subtitle: data.subtitle ?? null,
        cta: data.cta,
        image: data.image,
        gradient: data.gradient,
        useGradient: data.useGradient,
        link: data.link ?? null,
        order: data.order,
        isActive: data.isActive,
        mode: data.mode,
        objectFit: data.objectFit,
      },
    })
    await auditLog(req, 'banner', banner.id, 'create', {
      before: null,
      after: {
        title: banner.title,
        isActive: banner.isActive,
        order: banner.order,
        mode: banner.mode,
        objectFit: banner.objectFit,
      },
    })
    res.status(201).json(banner)
    broadcastChanged('banners:changed')
  }),
)

// PATCH /api/banners/:id — admin only, update
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.banner.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Banner not found' })
    const data = updateBannerSchema.parse(req.body ?? {})

    // Build the patch object — only include keys that were explicitly provided
    // (Zod `.partial()` makes them all optional; `undefined` means "skip").
    const patch: Record<string, unknown> = {}
    if (data.title !== undefined) patch.title = data.title
    if (data.subtitle !== undefined) patch.subtitle = data.subtitle ?? null
    if (data.cta !== undefined) patch.cta = data.cta
    if (data.image !== undefined) patch.image = data.image
    if (data.gradient !== undefined) patch.gradient = data.gradient
    if (data.useGradient !== undefined) patch.useGradient = data.useGradient
    if (data.link !== undefined) patch.link = data.link ?? null
    if (data.order !== undefined) patch.order = data.order
    if (data.isActive !== undefined) patch.isActive = data.isActive
    if (data.mode !== undefined) patch.mode = data.mode
    if (data.objectFit !== undefined) patch.objectFit = data.objectFit

    const updated = await prisma.banner.update({
      where: { id: req.params.id },
      data: patch,
    })
    await auditLog(req, 'banner', updated.id, 'update', {
      before: {
        title: existing.title,
        isActive: existing.isActive,
        order: existing.order,
        mode: existing.mode,
        objectFit: existing.objectFit,
      },
      after: {
        title: updated.title,
        isActive: updated.isActive,
        order: updated.order,
        mode: updated.mode,
        objectFit: updated.objectFit,
      },
    })
    res.json(updated)
    broadcastChanged('banners:changed')
  }),
)

// POST /api/banners/reorder — admin only, bulk update order
router.post(
  '/reorder',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const items = z
      .array(z.object({ id: z.string().min(1), order: z.number().int().min(0) }))
      .min(1)
      .parse(req.body)
    await prisma.$transaction(
      items.map((it) => prisma.banner.update({ where: { id: it.id }, data: { order: it.order } })),
    )
    await auditLogBulk(req, 'banner', 'reorder', {
      count: items.length,
      ids: items.map((it) => it.id),
    })
    res.json({ ok: true })
    broadcastChanged('banners:changed')
  }),
)

// DELETE /api/banners/:id — admin only
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    try {
      const existing = await prisma.banner.findUnique({
        where: { id: req.params.id },
        select: { id: true, title: true },
      })
      if (!existing) return res.status(404).json({ error: 'Banner not found' })
      await prisma.banner.delete({ where: { id: req.params.id } })
      await auditLog(req, 'banner', existing.id, 'delete', {
        before: { title: existing.title },
        after: null,
      })
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2025') {
        return res.status(404).json({ error: 'Banner not found' })
      }
      throw e
    }
    res.json({ ok: true })
    broadcastChanged('banners:changed')
  }),
)

export default router
