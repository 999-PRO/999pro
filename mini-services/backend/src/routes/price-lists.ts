/**
 * v25.12 — PriceList routes.
 *
 * Endpoints:
 *   GET    /api/price-lists           — public list (visible only, sorted)
 *   GET    /api/price-lists/all       — admin list (incl. hidden)
 *   GET    /api/price-lists/:id       — public single
 *   POST   /api/price-lists           — create (admin)
 *   PATCH  /api/price-lists/:id       — update (admin)
 *   DELETE /api/price-lists/:id       — delete (admin)
 *   POST   /api/price-lists/reorder   — bulk reorder (admin)
 *   POST   /api/price-lists/upload    — upload file (admin, returns fileUrl)
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { logger } from '../lib/logger.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const router: Router = Router()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BACKEND_ROOT = path.resolve(__dirname, '../..')
const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads', 'price-lists')

// Ensure uploads dir exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  fileUrl: z.string().min(1).max(2048),
  fileType: z.enum(['pdf', 'word', 'image', 'excel', 'other']).default('pdf'),
  thumbnail: z.string().max(2048).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  fileSize: z.number().int().optional().nullable(),
  visible: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  expiresAt: z.string().datetime().optional().nullable(),
})

const updateSchema = createSchema.partial()

// Detect file type from filename extension
function detectFileType(filename: string): 'pdf' | 'word' | 'image' | 'excel' | 'other' {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.doc' || ext === '.docx') return 'word'
  if (ext === '.xls' || ext === '.xlsx' || ext === '.csv') return 'excel'
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image'
  return 'other'
}

// GET /api/price-lists — public list (visible only)
router.get('/', asyncHandler(async (_req, res) => {
  const items = await prisma.priceList.findMany({
    where: {
      visible: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  })
  res.json({ items })
}))

// GET /api/price-lists/all — admin: all items
router.get('/all', requireAuth, requireAdmin, asyncHandler(async (_req: AuthedRequest, res) => {
  const items = await prisma.priceList.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  })
  res.json({ items })
}))

// GET /api/price-lists/:id — public single
router.get('/:id', asyncHandler(async (req, res) => {
  const item = await prisma.priceList.findUnique({ where: { id: req.params.id } })
  if (!item) return res.status(404).json({ error: 'Price list not found' })
  res.json(item)
}))

// POST /api/price-lists/upload — admin: upload file (multipart/form-data)
// Body: { file: <binary> }
// Returns: { fileUrl, fileType, fileSize, fileName }
router.post('/upload', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  // Use busboy for multipart parsing (same as upload.ts)
  const Busboy = (await import('busboy')).default
  const bb = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } }) // 50 MB max

  let savedFile: { url: string; type: string; size: number; name: string } | null = null

  bb.on('file', (_fieldname, file, info) => {
    const safeName = info.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const ext = path.extname(safeName)
    const baseName = path.basename(safeName, ext)
    const finalName = `${Date.now()}-${baseName}${ext}`
    const filePath = path.join(UPLOADS_DIR, finalName)
    const writeStream = fs.createWriteStream(filePath)
    let size = 0

    file.on('data', (chunk: Buffer) => { size += chunk.length })
    file.pipe(writeStream)

    writeStream.on('close', () => {
      savedFile = {
        url: `/uploads/price-lists/${finalName}`,
        type: detectFileType(info.filename),
        size,
        name: info.filename,
      }
    })
    writeStream.on('error', (err) => {
      logger.error('Price list upload failed', { module: 'price-lists', error: err })
      res.status(500).json({ error: 'Upload failed' })
    })
  })

  bb.on('finish', () => {
    if (!savedFile) {
      return res.status(400).json({ error: 'No file uploaded' })
    }
    res.json(savedFile)
  })

  bb.on('error', (err) => {
    logger.error('Busboy error', { module: 'price-lists', error: err })
    res.status(500).json({ error: 'Upload parsing failed' })
  })

  req.pipe(bb)
}))

// POST /api/price-lists — admin create
router.post('/', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = createSchema.parse(req.body)
  // Auto-assign sortOrder if 0
  let sortOrder = parsed.sortOrder
  if (sortOrder === 0) {
    const max = await prisma.priceList.aggregate({ _max: { sortOrder: true } })
    sortOrder = (max._max.sortOrder ?? -1) + 1
  }
  const item = await prisma.priceList.create({
    data: {
      ...parsed,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
    },
  })
  logger.info('Price list created', { module: 'price-lists', id: item.id, title: item.title })
  res.json(item)
}))

// PATCH /api/price-lists/:id — admin update
router.patch('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = updateSchema.parse(req.body)
  const updateData: any = { ...parsed }
  if (parsed.expiresAt) updateData.expiresAt = new Date(parsed.expiresAt)
  if (parsed.expiresAt === null) updateData.expiresAt = null
  const item = await prisma.priceList.update({
    where: { id: req.params.id },
    data: updateData,
  })
  logger.info('Price list updated', { module: 'price-lists', id: item.id })
  res.json(item)
}))

// DELETE /api/price-lists/:id — admin delete
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const item = await prisma.priceList.findUnique({ where: { id: req.params.id } })
  if (!item) return res.status(404).json({ error: 'Not found' })

  // Delete file from disk if it's a local upload
  if (item.fileUrl && item.fileUrl.startsWith('/uploads/price-lists/')) {
    const fileName = path.basename(item.fileUrl)
    const filePath = path.join(UPLOADS_DIR, fileName)
    try { fs.unlinkSync(filePath) } catch { /* ignore */ }
  }
  // Also delete thumbnail if it's a local upload
  if (item.thumbnail && item.thumbnail.startsWith('/uploads/price-lists/')) {
    const fileName = path.basename(item.thumbnail)
    const filePath = path.join(UPLOADS_DIR, fileName)
    try { fs.unlinkSync(filePath) } catch { /* ignore */ }
  }

  await prisma.priceList.delete({ where: { id: req.params.id } })
  logger.info('Price list deleted', { module: 'price-lists', id: req.params.id })
  res.json({ ok: true })
}))

// POST /api/price-lists/reorder — admin bulk reorder
router.post('/reorder', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const items = z
    .array(z.object({ id: z.string().min(1), sortOrder: z.number().int() }))
    .min(1)
    .max(200)
    .parse(req.body?.items)

  await prisma.$transaction(
    items.map((it) => prisma.priceList.update({
      where: { id: it.id },
      data: { sortOrder: it.sortOrder },
    })),
  )
  res.json({ ok: true, updated: items.length })
}))

export default router
