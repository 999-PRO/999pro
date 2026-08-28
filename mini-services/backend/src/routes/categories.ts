/**
 * v25.11 — Category routes.
 *
 * Replaces hardcoded PROJECT_CATEGORIES in 5 frontend files with a proper
 * DB-backed CRUD. Public read returns only visible categories; admin can
 * manage full CRUD via Studio.
 *
 * Endpoints:
 *   GET    /api/categories           — public list (visible only, sorted)
 *   GET    /api/categories/all       — admin list (incl. hidden)
 *   GET    /api/categories/:id       — public single
 *   POST   /api/categories           — create (admin)
 *   PATCH  /api/categories/:id       — update (admin)
 *   DELETE /api/categories/:id       — delete (admin — sets products.categoryId to null)
 *   POST   /api/categories/reorder   — bulk reorder (admin)
 *   POST   /api/categories/seed      — seed defaults from legacy PROJECT_CATEGORIES (admin, idempotent)
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { logger } from '../lib/logger.js'
import { broadcastChanged } from '../lib/broadcast.js'

const router: Router = Router()

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().max(120).optional().default(''),
  icon: z.string().max(50).optional().default('Folder'),
  description: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().default(0),
  visible: z.boolean().default(true),
  parentId: z.string().optional().nullable(),
})

const updateSchema = createSchema.partial()

// Helper: transliterate ru → lat for slug
function translitSlug(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
    з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  return name
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
}

// v25.14 (categories fix): count products for a category using BOTH stores —
// the Category relation (categoryId) AND the legacy `category` string that
// older products still carry. Legacy-only products previously showed 0 in the
// chip counters even when they existed, and custom categories looked empty.
async function countProductsForCategories(catIds: { id: string; name: string }[]) {
  if (catIds.length === 0) return new Map<string, number>()
  const [relCounts, legacyCounts] = await Promise.all([
    prisma.product.groupBy({
      by: ['categoryId'],
      where: { deletedAt: null, categoryId: { in: catIds.map((c) => c.id) } },
      _count: { _all: true },
    }),
    prisma.product.groupBy({
      by: ['category'],
      where: { deletedAt: null, category: { in: catIds.map((c) => c.name) }, categoryId: null },
      _count: { _all: true },
    }),
  ])
  const byId = new Map<string, number>()
  for (const r of relCounts) if (r.categoryId) byId.set(r.categoryId, r._count._all)
  const nameToId = new Map(catIds.map((c) => [c.name, c.id]))
  for (const l of legacyCounts) {
    if (!l.category) continue
    const id = nameToId.get(l.category)
    if (id) byId.set(id, (byId.get(id) || 0) + l._count._all)
  }
  return byId
}

// GET /api/categories — public list (visible only, sorted by sortOrder, then name)
router.get('/', asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    where: { visible: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  const counts = await countProductsForCategories(categories)
  res.json({
    items: categories.map((c) => ({
      ...c,
      productsCount: counts.get(c.id) || 0,
    })),
  })
}))

// GET /api/categories/all — admin: all categories including hidden
router.get('/all', requireAuth, requireAdmin, asyncHandler(async (_req: AuthedRequest, res) => {
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { parent: { select: { id: true, name: true } } },
  })
  const counts = await countProductsForCategories(categories)
  res.json({
    items: categories.map((c) => ({
      ...c,
      productsCount: counts.get(c.id) || 0,
    })),
  })
}))

// GET /api/categories/:id — public single
router.get('/:id', asyncHandler(async (req, res) => {
  const cat = await prisma.category.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true } } },
  })
  if (!cat) return res.status(404).json({ error: 'Category not found' })
  res.json({
    ...cat,
    productsCount: cat._count.products,
    _count: undefined,
  })
}))

// POST /api/categories — admin create
// POST /api/categories — admin create
router.post('/', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = createSchema.parse(req.body)
  const slug = parsed.slug || translitSlug(parsed.name)
  // Ensure slug uniqueness
  const existing = await prisma.category.findUnique({ where: { slug } })
  const finalSlug = existing ? `${slug}-${Date.now().toString(36)}` : slug

  // Auto-assign sortOrder if 0 and not provided
  let sortOrder = parsed.sortOrder
  if (sortOrder === 0) {
    const max = await prisma.category.aggregate({ _max: { sortOrder: true } })
    sortOrder = (max._max.sortOrder ?? -1) + 1
  }

  const cat = await prisma.category.create({
    data: {
      name: parsed.name,
      slug: finalSlug,
      icon: parsed.icon,
      description: parsed.description,
      sortOrder,
      visible: parsed.visible,
      parentId: parsed.parentId || null,
    },
  })
  // v25.14: instantly link existing products whose legacy `category` string
  // matches this category — so a freshly created category is immediately
  // populated in the catalog without re-saving each product.
  await prisma.product.updateMany({
    where: { categoryId: null, category: cat.name },
    data: { categoryId: cat.id },
  })
  logger.info('Category created', { module: 'categories', id: cat.id, name: cat.name })
  broadcastChanged('categories:changed')
  res.json(cat)
}))

// PATCH /api/categories/:id — admin update
router.patch('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = updateSchema.parse(req.body)
  const updateData: any = { ...parsed }
  if (parsed.slug === '') delete updateData.slug
  if (parsed.name && !parsed.slug) {
    // regenerate slug if name changed and slug not provided
    updateData.slug = translitSlug(parsed.name)
  }
  const before = await prisma.category.findUnique({ where: { id: req.params.id } })
  if (!before) return res.status(404).json({ error: 'Category not found' })
  const cat = await prisma.category.update({
    where: { id: req.params.id },
    data: updateData,
  })
  // v25.14: renaming a category must NOT orphan the legacy `category`
  // strings on products — migrate them to the new canonical name.
  if (parsed.name && parsed.name !== before.name) {
    await prisma.product.updateMany({
      where: { category: before.name },
      data: { category: cat.name },
    })
  }
  logger.info('Category updated', { module: 'categories', id: cat.id })
  broadcastChanged('categories:changed')
  res.json(cat)
}))

// DELETE /api/categories/:id — admin delete
// Products linked to this category get categoryId=null (SetNull),
// but their string `category` field is preserved.
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const cat = await prisma.category.delete({ where: { id: req.params.id } })
  logger.info('Category deleted', { module: 'categories', id: cat.id, name: cat.name })
  broadcastChanged('categories:changed')
  res.json({ ok: true })
}))

// POST /api/categories/reorder — admin bulk reorder
// Body: { items: [{ id, sortOrder }] }
router.post('/reorder', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const items = z
    .array(z.object({ id: z.string().min(1), sortOrder: z.number().int() }))
    .min(1)
    .max(200)
    .parse(req.body?.items)
  await prisma.$transaction(
    items.map((it) => prisma.category.update({
      where: { id: it.id },
      data: { sortOrder: it.sortOrder },
    })),
  )
  broadcastChanged('categories:changed')
  res.json({ ok: true, updated: items.length })
}))

// POST /api/categories/seed — admin seed defaults (idempotent)
// Creates the 8 legacy PROJECT_CATEGORIES if they don't exist yet.
// Safe to call multiple times — skips categories that already exist by slug.
const DEFAULT_CATEGORIES = [
  { name: 'Реклама', slug: 'reklama', icon: 'Megaphone' },
  { name: 'Подарки', slug: 'podarki', icon: 'Gift' },
  { name: 'Мебель', slug: 'mebel', icon: 'Armchair' },
  { name: 'Печать', slug: 'pechat', icon: 'Printer' },
  { name: 'Дизайн', slug: 'dizayn', icon: 'Palette' },
  { name: 'Интерьер', slug: 'interer', icon: 'Home' },
  { name: 'Наружная реклама', slug: 'naruzhnaya-reklama', icon: 'Billboard' },
  { name: 'Полиграфия', slug: 'poligrafiya', icon: 'FileText' },
]

router.post('/seed', requireAuth, requireAdmin, asyncHandler(async (_req: AuthedRequest, res) => {
  let created = 0
  let skipped = 0
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const def = DEFAULT_CATEGORIES[i]
    const existing = await prisma.category.findUnique({ where: { slug: def.slug } })
    if (existing) {
      skipped++
      continue
    }
    await prisma.category.create({
      data: {
        name: def.name,
        slug: def.slug,
        icon: def.icon,
        sortOrder: i,
        visible: true,
      },
    })
    created++
  }

  // Auto-link products: for each Product that has a string `category` matching
  // a Category.name, set categoryId (only if categoryId is null).
  const allCats = await prisma.category.findMany()
  const byName = new Map(allCats.map((c) => [c.name.toLowerCase(), c]))
  const products = await prisma.product.findMany({
    where: { categoryId: null, category: { not: null } },
    select: { id: true, category: true },
  })
  let linked = 0
  for (const p of products) {
    if (!p.category) continue
    const cat = byName.get(p.category.toLowerCase())
    if (cat) {
      await prisma.product.update({ where: { id: p.id }, data: { categoryId: cat.id } })
      linked++
    }
  }

  logger.info('Categories seeded', { module: 'categories', created, skipped, linked })
  res.json({ ok: true, created, skipped, linked, total: allCats.length })
}))

export default router
