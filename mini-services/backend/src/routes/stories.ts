import { Router } from 'express'
import { z } from 'zod'
import { LRUCache } from 'lru-cache'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { createStorySchema } from '../lib/schemas.js'
import { broadcastChanged } from '../lib/broadcast.js'

const router = Router()

// v13.1 (audit P1-3 fix): per-user-per-story view dedup, 60s window.
// Same pattern as POST /api/products/:id/view. Without this, an attacker
// could inflate any story's view count by repeatedly hitting the endpoint.
const STORY_VIEW_DEDUP = new LRUCache<string, number>({ max: 100_000, ttl: 60_000 })

// GET /api/stories — public, active stories (not expired)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const now = new Date()
    const stories = await prisma.story.findMany({
      where: { expiresAt: { gt: now } },
      // Use select to avoid fetching password hash via user
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({
      items: stories.map((s) => ({
        id: s.id,
        // media is now a JSON array — but we keep backwards-compat by
        // detecting a single-URL string (old rows) and returning [media].
        media: parseMediaArray(s.media),
        mediaType: s.mediaType,
        caption: s.caption,
        category: s.category,
        views: s.views,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        user: s.user,
      })),
    })
  }),
)

// v13.2 (audit dedup P3-3): use shared safeParseJsonArray from lib/serialisers
// instead of duplicating the JSON-array-parse logic. The shared helper already
// handles single-string wrapping (returns [String(parsed)]) and parse failures
// (returns []). We add a filter for non-empty strings on top.
import { safeParseJsonArray } from '../lib/serialisers.js'
function parseMediaArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  const arr = safeParseJsonArray(raw)
  // Filter out empty strings and non-strings (defensive — safeParseJsonArray
  // already strings everything, but we want to drop empties).
  return arr.filter((x) => typeof x === 'string' && x.length > 0)
}

// GET /api/stories/categories — distinct categories used by active stories
router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const now = new Date()
    const rows = await prisma.story.findMany({
      where: { expiresAt: { gt: now }, category: { not: null } },
      distinct: ['category'],
      select: { category: true },
    })
    const items = rows
      .map((r) => r.category)
      .filter((c): c is string => Boolean(c))
      .sort((a, b) => a.localeCompare(b, 'ru'))
    res.json({ items })
  }),
)

// POST /api/stories — admin only.
// v25.17 (owner: «я сразу выделяю несколько фотографий и добавляю в сторисы…
// сделай так, чтобы он в одном сторисе все картинки были»): по умолчанию все
// URL из `media` попадают в ОДНУ Story (media — JSON-массив) и листаются
// свайпом внутри просмотра, как в Instagram. Старое поведение (каждый URL =
// отдельная сторис) доступно через grouped:false. Legacy multi-URL строки из
// старых версий и так отображаются как многослайдовые (mediaIndex во вьювере).
router.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = createStorySchema.parse(req.body)
    const expiresAt = new Date(Date.now() + data.durationHours * 3600 * 1000)

    let created
    if (data.grouped === false) {
      // Legacy split mode: one Story per URL (all share caption/category/expiresAt),
      // mediaType detected per URL so a mixed batch still gets correct types.
      created = await prisma.$transaction(
        data.media.map((url) =>
          prisma.story.create({
            data: {
              userId: req.user!.id,
              media: JSON.stringify([url]),
              mediaType: /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : (data.mediaType || 'image'),
              caption: data.caption,
              category: data.category,
              expiresAt,
            },
            include: {
              user: { select: { id: true, username: true, displayName: true, avatar: true } },
            },
          }),
        ),
      )
    } else {
      // v25.17 grouped mode (default): ONE story with every media inside.
      // mediaType = 'video' только если ВСЕ URLs — видео; иначе 'image'
      // (вьювер сам рендерит <video> по расширению конкретного URL).
      const allVideo = data.media.every((u) => /\.(mp4|webm|mov)(\?|$)/i.test(u))
      const row = await prisma.story.create({
        data: {
          userId: req.user!.id,
          media: JSON.stringify(data.media),
          mediaType: allVideo ? 'video' : (data.mediaType || 'image'),
          caption: data.caption,
          category: data.category,
          expiresAt,
        },
        include: {
          user: { select: { id: true, username: true, displayName: true, avatar: true } },
        },
      })
      created = [row] // единый shape ответа ниже
    }

    // Audit one entry per created story (best-effort, non-critical).
    for (const s of created) {
      await auditLog(req, 'story', s.id, 'create', {
        before: null,
        after: { mediaType: s.mediaType, category: s.category, caption: s.caption?.slice(0, 100) ?? null, mediaCount: parseMediaArray(s.media).length },
      }).catch(() => {/* audit failure is non-critical */})
    }

    // New response shape: { items: [...] } (was a single object).
    // The studio's save() handler ignores the response and just calls
    // refresh(), so this is a safe change. Old single-URL callers
    // (if any exist outside studio) get items: [oneStory].
    res.status(201).json({
      items: created.map((s) => ({
        id: s.id,
        media: parseMediaArray(s.media),
        mediaType: s.mediaType,
        caption: s.caption,
        category: s.category,
        views: s.views,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        user: s.user,
      })),
    })
    broadcastChanged('stories:changed')
  }),
)

// POST /api/stories/:id/view — increment views (idempotent, no throw on missing)
// v13.1 (audit P1-3 fix): per-user dedup, 60s window — same pattern as products.
router.post(
  '/:id/view',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const storyId = req.params.id
    const dedupKey = `${userId}|${storyId}`
    if (STORY_VIEW_DEDUP.has(dedupKey)) {
      // Already counted in the last 60s — return current count without incrementing
      const current = await prisma.story.findUnique({
        where: { id: storyId },
        select: { views: true },
      })
      return res.json({ views: current?.views ?? 0, deduplicated: true })
    }
    STORY_VIEW_DEDUP.set(dedupKey, Date.now())

    // updateMany returns count and does NOT throw P2025 if not found
    const result = await prisma.story.updateMany({
      where: { id: storyId },
      data: { views: { increment: 1 } },
    })
    if (result.count === 0) return res.status(404).json({ error: 'Story not found' })

    // Fetch the updated count for the response
    const updated = await prisma.story.findUnique({
      where: { id: storyId },
      select: { views: true },
    })
    res.json({ views: updated?.views ?? 0 })
  }),
)

// DELETE /api/stories/bulk — admin only. Body: { ids: string[] }.
// Deletes multiple stories atomically. Stories use cuid() IDs (no slashes),
// so we don't need the wildcard workaround that products need.
router.delete(
  '/bulk',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const ids = z.array(z.string().min(1).max(64)).min(1).max(500).parse(req.body?.ids)
    const existing = await prisma.story.findMany({
      where: { id: { in: ids } },
      select: { id: true, mediaType: true, category: true },
    })
    const existingIds = new Set(existing.map((s) => s.id))
    const notFound = ids.filter((id) => !existingIds.has(id))
    try {
      await prisma.$transaction(
        existing.map((s) => prisma.story.delete({ where: { id: s.id } })),
      )
      for (const s of existing) {
        await auditLog(req, 'story', s.id, 'delete', {
          before: { mediaType: s.mediaType, category: s.category },
          after: null,
        }).catch(() => {/* audit failure is non-critical */})
      }
    } catch (e: any) {
      if (e?.code === 'P2025') {
        return res.status(404).json({ error: 'Some stories were already deleted. Refresh and try again.' })
      }
      throw e
    }
    res.json({ ok: true, deleted: existing.length, notFound })
    broadcastChanged('stories:changed')
  }),
)

// DELETE /api/stories/all — admin only. Wipes ALL stories.
router.delete(
  '/all',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await prisma.story.deleteMany({})
    await auditLog(req, 'story', 'all', 'delete_all', {
      before: { count: result.count },
      after: null,
    }).catch(() => {/* audit failure is non-critical */})
    res.json({ ok: true, deleted: result.count })
    broadcastChanged('stories:changed')
  }),
)

// DELETE /api/stories/:id — admin only (or owner)
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const story = await prisma.story.findUnique({ where: { id: req.params.id } })
    if (!story) return res.status(404).json({ error: 'Story not found' })

    const isOwner = story.userId === req.user!.id
    const isAdmin = req.user!.role === 'admin'
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    await prisma.story.delete({ where: { id: req.params.id } })
    await auditLog(req, 'story', story.id, 'delete', {
      before: { mediaType: story.mediaType, category: story.category },
      after: null,
    })
    res.json({ ok: true })
    broadcastChanged('stories:changed')
  }),
)

export default router
