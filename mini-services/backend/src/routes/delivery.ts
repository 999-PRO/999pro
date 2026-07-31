import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'

const router: Router = Router()

// ============================================================
//  DELIVERY SETTINGS — stored as JSON in AppSetting(key='deliverySettings').
//  Foundation for future: auto-calc, distance, courier, tracking, branches.
// ============================================================

const DELIVERY_SETTINGS_KEY = 'deliverySettings'

const deliverySettingsSchema = z.object({
  deliveryEnabled: z.boolean().default(true),
  pickupEnabled: z.boolean().default(true),
  storeAddress: z.string().max(500).nullable().default(null),
  storeLat: z.number().min(-90).max(90).nullable().default(null),
  storeLng: z.number().min(-180).max(180).nullable().default(null),
  storePhone: z.string().max(100).nullable().default(null),
  workingHours: z.string().max(500).nullable().default(null),
  defaultDeliveryCost: z.number().min(0).max(1_000_000).default(0),
  deliveryTerms: z.string().max(5000).nullable().default(null),
  pickupTerms: z.string().max(5000).nullable().default(null),
})

type DeliverySettings = z.infer<typeof deliverySettingsSchema>

const DEFAULT_SETTINGS: DeliverySettings = {
  deliveryEnabled: true,
  pickupEnabled: true,
  storeAddress: null,
  storeLat: null,
  storeLng: null,
  storePhone: null,
  workingHours: null,
  defaultDeliveryCost: 0,
  deliveryTerms: null,
  pickupTerms: null,
}

async function getDeliverySettings(): Promise<DeliverySettings> {
  const row = await prisma.appSetting.findUnique({ where: { id: DELIVERY_SETTINGS_KEY } })
  if (!row) return DEFAULT_SETTINGS
  try {
    const parsed = JSON.parse(row.value)
    return deliverySettingsSchema.parse({ ...DEFAULT_SETTINGS, ...parsed })
  } catch {
    return DEFAULT_SETTINGS
  }
}

// GET /api/delivery/settings — public
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await getDeliverySettings()
    res.json({ settings })
  }),
)

// PUT /api/delivery/settings — admin only
router.put(
  '/settings',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const before = await getDeliverySettings()
    const next = deliverySettingsSchema.parse({ ...DEFAULT_SETTINGS, ...req.body })
    await prisma.appSetting.upsert({
      where: { id: DELIVERY_SETTINGS_KEY },
      update: { value: JSON.stringify(next) },
      create: { id: DELIVERY_SETTINGS_KEY, value: JSON.stringify(next) },
    })
    await auditLog(req, 'settings', DELIVERY_SETTINGS_KEY, 'update', {
      before,
      after: next,
    }).catch(() => {/* audit failure is non-critical */})
    res.json({ settings: next })
  }),
)

// ============================================================
//  DELIVERY ZONES — admin-defined (CRUD + reorder).
// ============================================================

const createZoneSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  cost: z.number().min(0).max(1_000_000).default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).optional(),
})

const updateZoneSchema = createZoneSchema.partial()

function serialiseZone(z: any) {
  return {
    id: z.id,
    name: z.name,
    description: z.description,
    cost: typeof z.cost?.toNumber === 'function' ? z.cost.toNumber() : Number(z.cost ?? 0),
    isActive: z.isActive,
    sortOrder: z.sortOrder,
    createdAt: z.createdAt,
    updatedAt: z.updatedAt,
  }
}

// GET /api/delivery/zones — public returns active only; admin can pass ?all=true
router.get(
  '/zones',
  asyncHandler(async (req, res) => {
    const isAdmin = (req as AuthedRequest).user?.role === 'admin'
    const all = req.query.all === 'true' && isAdmin
    const zones = await prisma.deliveryZone.findMany({
      where: all ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    res.json({ items: zones.map(serialiseZone) })
  }),
)

// POST /api/delivery/zones — admin only
router.post(
  '/zones',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = createZoneSchema.parse(req.body)
    // If sortOrder not provided, append to the end
    if (data.sortOrder === undefined) {
      const last = await prisma.deliveryZone.aggregate({ _max: { sortOrder: true } })
      data.sortOrder = (last._max.sortOrder ?? -1) + 1
    }
    const zone = await prisma.deliveryZone.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        cost: data.cost,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      },
    })
    await auditLog(req, 'deliveryZone', zone.id, 'create', {
      before: null,
      after: serialiseZone(zone),
    }).catch(() => {})
    res.status(201).json(serialiseZone(zone))
  }),
)

// PUT /api/delivery/zones/:id — admin only
router.put(
  '/zones/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.params.id
    const data = updateZoneSchema.parse(req.body)
    const existing = await prisma.deliveryZone.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Zone not found' })
    const updated = await prisma.deliveryZone.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.cost !== undefined && { cost: data.cost }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    })
    await auditLog(req, 'deliveryZone', id, 'update', {
      before: serialiseZone(existing),
      after: serialiseZone(updated),
    }).catch(() => {})
    res.json(serialiseZone(updated))
  }),
)

// DELETE /api/delivery/zones/:id — admin only
router.delete(
  '/zones/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.params.id
    const existing = await prisma.deliveryZone.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Zone not found' })
    // Orders reference the zone via onDelete: SetNull, so deletion is safe.
    await prisma.deliveryZone.delete({ where: { id } })
    await auditLog(req, 'deliveryZone', id, 'delete', {
      before: serialiseZone(existing),
      after: null,
    }).catch(() => {})
    res.json({ ok: true })
  }),
)

// PATCH /api/delivery/zones/reorder — admin only. Body: { ids: string[] }
// Sets sortOrder = index for each id.
router.patch(
  '/zones/reorder',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const ids = z.array(z.string().min(1).max(64)).min(1).max(100).parse(req.body?.ids)
    await prisma.$transaction(
      ids.map((id, idx) =>
        prisma.deliveryZone.update({ where: { id }, data: { sortOrder: idx } }),
      ),
    )
    res.json({ ok: true })
  }),
)

export default router
export { getDeliverySettings, deliverySettingsSchema, type DeliverySettings }
