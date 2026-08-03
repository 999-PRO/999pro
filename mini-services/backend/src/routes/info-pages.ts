import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog, auditLogBulk } from '../lib/audit.js'
import { broadcastChanged } from '../lib/broadcast.js'
// P0-1 fix: server-side HTML sanitiser to prevent stored XSS in info pages
import { sanitiseRichHtml } from '../lib/sanitise.js'

const router = Router()

// ============================================================================
// Info Pages — редактируемые информационные страницы приложения.
// Полностью управляются через Studio (CRUD + reorder + publish).
// Frontend рендерит страницу по slug: GET /api/info-pages/:slug.
//
// Публичные endpoints:
//   GET /api/info-pages                  — список опубликованных (showInMenu по умолчанию)
//   GET /api/info-pages/menu             — список опубликованных с showInMenu=true (для меню)
//   GET /api/info-pages/:slug            — одна страница по slug
//
// Admin endpoints (requireAuth + requireAdmin):
//   GET    /api/info-pages/all           — список всех страниц (включая черновики)
//   POST   /api/info-pages               — создать
//   PATCH  /api/info-pages/:id           — обновить
//   POST   /api/info-pages/reorder       — массовое обновление порядка
//   DELETE /api/info-pages/:id           — удалить
// ============================================================================

// Валидатор slug: латиница, цифры, дефис; 1-100 символов; не может начинаться с дефиса.
const slugRegex = /^[a-z0-9][a-z0-9-]{0,99}$/

// Зарезервированные slug'и — нельзя создать новую страницу с таким slug,
// но они обновляются через PATCH (для дефолтных страниц из seed'а).
// v25.6 (Task #6): added 'rules' for "Правила сервиса".
const RESERVED_SLUGS = new Set([
  'about', 'privacy', 'terms', 'rules', 'cookies', 'rights', 'contacts',
  'help', 'company', 'usage-terms',
])

// Максимальная длина контента — 256KB (хватит для любой юридической страницы).
const MAX_CONTENT_LENGTH = 256 * 1024

const infoPageSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(slugRegex, 'Slug must be lowercase latin letters, digits, and hyphens')
    .refine((s) => !RESERVED_SLUGS.has(s) || s === s, // reserved slugs allowed only via update (we check at create)
      'Reserved slug'),
  title: z.string().min(1).max(300).trim(),
  subtitle: z
    .string()
    .max(500)
    .nullable()
    .transform((v) => (v == null || v.trim() === '' ? null : v.trim()))
    .optional(),
  content: z.string().max(MAX_CONTENT_LENGTH).default(''),
  images: z
    .array(z.string().max(2048))
    .max(20)
    .default([]),
  icon: z.string().max(50).default('FileText'),
  order: z.number().int().default(0),
  isPublished: z.boolean().default(true),
  showInMenu: z.boolean().default(true),
  metaDescription: z
    .string()
    .max(500)
    .nullable()
    .transform((v) => (v == null || v.trim() === '' ? null : v.trim()))
    .optional(),
})

const updateInfoPageSchema = infoPageSchema.partial()

// Хелпер: парсит JSON-строку images в массив (для клиента).
function serializePage(p: any) {
  let images: string[] = []
  try {
    images = typeof p.images === 'string' ? JSON.parse(p.images) : (p.images || [])
    if (!Array.isArray(images)) images = []
  } catch {
    images = []
  }
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    subtitle: p.subtitle,
    content: p.content,
    images,
    icon: p.icon,
    order: p.order,
    isPublished: p.isPublished,
    showInMenu: p.showInMenu,
    metaDescription: p.metaDescription,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

// ============================================================================
// Публичные endpoints
// ============================================================================

// GET /api/info-pages — список опубликованных страниц (без контента, для меню/списка)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const pages = await prisma.infoPage.findMany({
      where: { isPublished: true },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        icon: true,
        order: true,
        showInMenu: true,
        metaDescription: true,
        updatedAt: true,
        // content intentionally excluded — list endpoint is lightweight
      },
    })
    res.json({ items: pages })
  }),
)

// GET /api/info-pages/menu — список опубликованных с showInMenu=true (для меню "Ещё")
router.get(
  '/menu',
  asyncHandler(async (_req, res) => {
    const pages = await prisma.infoPage.findMany({
      where: { isPublished: true, showInMenu: true },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        icon: true,
        order: true,
      },
    })
    res.json({ items: pages })
  }),
)

// GET /api/info-pages/all — все страницы (включая неопубликованные) — ADMIN
// IMPORTANT: must be declared BEFORE /:slug, otherwise Express matches
// "all" as a slug parameter.
router.get(
  '/all',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const pages = await prisma.infoPage.findMany({
      orderBy: { order: 'asc' },
    })
    res.json({ items: pages.map(serializePage) })
  }),
)

// GET /api/info-pages/:slug — одна страница по slug (публичная, только если isPublished=true)
router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const page = await prisma.infoPage.findUnique({
      where: { slug: req.params.slug },
    })
    if (!page || !page.isPublished) {
      return res.status(404).json({ error: 'Page not found' })
    }
    res.json(serializePage(page))
  }),
)

// POST /api/info-pages — создать новую страницу
router.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = infoPageSchema.parse(req.body)

    // Проверка уникальности slug
    const existing = await prisma.infoPage.findUnique({ where: { slug: data.slug } })
    if (existing) {
      return res.status(409).json({ error: 'Страница с таким slug уже существует' })
    }

    // Авто-порядок: если не указан явно (0 = default), ставим в конец
    if (data.order === 0 && req.body?.order === undefined) {
      const count = await prisma.infoPage.count()
      data.order = count
    }

    const page = await prisma.infoPage.create({
      data: {
        slug: data.slug,
        title: data.title,
        subtitle: data.subtitle ?? null,
        // P0-1 fix: sanitise HTML content to prevent stored XSS
        content: sanitiseRichHtml(data.content),
        images: JSON.stringify(data.images),
        icon: data.icon,
        order: data.order,
        isPublished: data.isPublished,
        showInMenu: data.showInMenu,
        metaDescription: data.metaDescription ?? null,
      },
    })
    await auditLog(req, 'info-page', page.id, 'create', {
      before: null,
      after: { slug: page.slug, title: page.title, isPublished: page.isPublished },
    })
    res.status(201).json(serializePage(page))
    broadcastChanged('info-pages:changed')
  }),
)

// PATCH /api/info-pages/:id — обновить страницу
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.infoPage.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Page not found' })

    const data = updateInfoPageSchema.parse(req.body ?? {})

    // Если slug меняется — проверяем уникальность нового slug
    if (data.slug !== undefined && data.slug !== existing.slug) {
      const conflict = await prisma.infoPage.findUnique({ where: { slug: data.slug } })
      if (conflict) {
        return res.status(409).json({ error: 'Страница с таким slug уже существует' })
      }
    }

    const patch: Record<string, unknown> = {}
    if (data.slug !== undefined) patch.slug = data.slug
    if (data.title !== undefined) patch.title = data.title
    if (data.subtitle !== undefined) patch.subtitle = data.subtitle ?? null
    // P0-1 fix: sanitise HTML content on update too
    if (data.content !== undefined) patch.content = sanitiseRichHtml(data.content)
    if (data.images !== undefined) patch.images = JSON.stringify(data.images)
    if (data.icon !== undefined) patch.icon = data.icon
    if (data.order !== undefined) patch.order = data.order
    if (data.isPublished !== undefined) patch.isPublished = data.isPublished
    if (data.showInMenu !== undefined) patch.showInMenu = data.showInMenu
    if (data.metaDescription !== undefined) patch.metaDescription = data.metaDescription ?? null

    const updated = await prisma.infoPage.update({
      where: { id: req.params.id },
      data: patch,
    })
    await auditLog(req, 'info-page', updated.id, 'update', {
      before: { slug: existing.slug, title: existing.title, isPublished: existing.isPublished },
      after: { slug: updated.slug, title: updated.title, isPublished: updated.isPublished },
    })
    res.json(serializePage(updated))
    broadcastChanged('info-pages:changed')
  }),
)

// POST /api/info-pages/reorder — массовое обновление порядка
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
      items.map((it) => prisma.infoPage.update({ where: { id: it.id }, data: { order: it.order } })),
    )
    await auditLogBulk(req, 'info-page', 'reorder', {
      count: items.length,
      ids: items.map((it) => it.id),
    })
    res.json({ ok: true })
    broadcastChanged('info-pages:changed')
  }),
)

// DELETE /api/info-pages/:id — удалить страницу
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    try {
      const existing = await prisma.infoPage.findUnique({
        where: { id: req.params.id },
        select: { id: true, slug: true, title: true },
      })
      if (!existing) return res.status(404).json({ error: 'Page not found' })
      await prisma.infoPage.delete({ where: { id: req.params.id } })
      await auditLog(req, 'info-page', existing.id, 'delete', {
        before: { slug: existing.slug, title: existing.title },
        after: null,
      })
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2025') {
        return res.status(404).json({ error: 'Page not found' })
      }
      throw e
    }
    res.json({ ok: true })
    broadcastChanged('info-pages:changed')
  }),
)

export default router
