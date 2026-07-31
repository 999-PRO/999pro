/**
 * v24.4 — Department routes (contacts by direction).
 *
 * Endpoints:
 *   GET    /api/departments           — list all (public)
 *   GET    /api/departments/:id       — get one (public)
 *   POST   /api/departments           — create (admin)
 *   PATCH  /api/departments/:id       — update (admin)
 *   DELETE /api/departments/:id       — delete (admin)
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { logger } from '../lib/logger.js'

const router: Router = Router()

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().max(100).optional().default(''),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  phone: z.string().max(100).optional().nullable(),
  whatsapp: z.string().max(200).optional().nullable(),
  telegram: z.string().max(200).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  managerName: z.string().max(200).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
})

const updateSchema = createSchema.partial()

// GET /api/departments — public, returns active departments sorted by sortOrder
router.get('/', asyncHandler(async (_req, res) => {
  const departments = await prisma.department.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  res.json({ items: departments })
}))

// GET /api/departments/all — admin, returns ALL departments (including inactive)
router.get('/all', requireAuth, requireAdmin, asyncHandler(async (_req: AuthedRequest, res) => {
  const departments = await prisma.department.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } } },
  })
  res.json({ items: departments })
}))

// GET /api/departments/:id — public
router.get('/:id', asyncHandler(async (req, res) => {
  const dept = await prisma.department.findUnique({ where: { id: req.params.id } })
  if (!dept) return res.status(404).json({ error: 'Department not found' })
  res.json(dept)
}))

// POST /api/departments — admin
router.post('/', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = createSchema.parse(req.body)
  const dept = await prisma.department.create({
    data: {
      ...parsed,
      slug: parsed.slug || parsed.name.toLowerCase().replace(/[^a-z0-9а-я]+/gi, '-'),
    },
  })
  logger.info('Department created', { module: 'departments', id: dept.id, name: dept.name })
  res.json(dept)
}))

// PATCH /api/departments/:id — admin
router.patch('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = updateSchema.parse(req.body)
  const dept = await prisma.department.update({
    where: { id: req.params.id },
    data: parsed,
  })
  res.json(dept)
}))

// DELETE /api/departments/:id — admin
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  await prisma.department.delete({ where: { id: req.params.id } })
  res.json({ ok: true })
}))

export default router
