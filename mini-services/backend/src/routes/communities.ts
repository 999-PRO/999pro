/**
 * v25.14 — Community routes.
 *
 * Сообщества: публичные (объявления от всех участников) и закрытые
 * (например, оптовый клуб — владельцы добавляют оптовиков вручную).
 *
 * Endpoints:
 *   GET    /api/communities                     — мои + публичные (auth optional)
 *   POST   /api/communities                     — создать (admin)
 *   PATCH  /api/communities/:id                 — обновить (admin / owner)
 *   DELETE /api/communities/:id                 — удалить (admin)
 *   POST   /api/communities/:id/join            — вступить (public only)
 *   POST   /api/communities/:id/leave           — выйти
 *   GET    /api/communities/:id/members         — список участников (member/admin)
 *   POST   /api/communities/:id/members         — добавить участника по логину/email/телефону (admin/owner)
 *   DELETE /api/communities/:id/members/:userId — исключить участника (admin/owner)
 *   GET    /api/communities/:id/posts           — лента объявлений сообщества
 *   POST   /api/communities/:id/posts           — опубликовать объявление (участники)
 *   DELETE /api/communities/posts/:postId       — удалить пост (автор/admin)
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, optionalAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { logger } from '../lib/logger.js'
import { moderateContent } from '../lib/moderation.js'

const router: Router = Router()

// ---------- schemas ----------
const createCommunitySchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(600).optional().nullable(),
  type: z.enum(['public', 'private']).default('public'),
  cover: z.string().max(2048).optional().nullable(),
})

const updateCommunitySchema = createCommunitySchema.partial()

const addMemberSchema = z.object({
  // username | email | phone of the user to add
  query: z.string().min(3).max(120),
})

const createPostSchema = z.object({
  content: z.string().min(1, 'Текст объявления обязателен').max(5000),
  images: z.array(z.string().max(2048)).max(8).optional(),
  price: z.number().min(0).max(999_999_999).optional().nullable(),
  contactPhone: z.string().max(32).optional().nullable(),
  // v25.16: дополнительные контакты автора объявления (Avito-стиль)
  contactWhatsApp: z.string().max(64).optional().nullable(),
  contactTelegram: z.string().max(64).optional().nullable(),
})

// v25.16: комментарий к объявлению (поддерживает ответы через parentId)
const createCommentSchema = z.object({
  content: z.string().min(1, 'Текст комментария обязателен').max(2000),
  parentId: z.string().optional().nullable(),
})

// ---------- helpers ----------
function serialisePost(p: any) {
  let images: string[] = []
  try {
    const parsed = JSON.parse(p.images || '[]')
    images = Array.isArray(parsed) ? parsed : []
  } catch { images = [] }
  return {
    ...p,
    images,
    price: p.price != null ? Number(p.price) : null,
  }
}

// v25.16: сериализация комментария к объявлению (+ вложенные ответы).
function serialiseComment(c: any) {
  const s = (x: any): any => ({
    id: x.id,
    postId: x.postId,
    parentId: x.parentId ?? null,
    content: x.content,
    isHidden: x.isHidden,
    createdAt: x.createdAt,
    // v25.24: flatten-поля для ответов на ответы
    replyToId: x.replyToId ?? null,
    replyToName: x.replyToName ?? null,
    // v25.17: признак «комментарий редактировался» — updatedAt больше createdAt.
    edited: x.updatedAt ? new Date(x.updatedAt).getTime() - new Date(x.createdAt).getTime() > 1000 : false,
    author: x.author
      ? { id: x.author.id, username: x.author.username, displayName: x.author.displayName ?? null, avatar: x.author.avatar ?? null, role: x.author.role }
      : null,
    ...(Array.isArray(x.replies) ? { replies: x.replies.map(s) } : {}),
  })
  return s(c)
}

async function getMembership(communityId: string, userId?: string | null) {
  if (!userId) return null
  return prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } },
  })
}

async function requireAccess(req: AuthedRequest, res: any, communityId: string): Promise<any> {
  const community = await prisma.community.findUnique({ where: { id: communityId } })
  if (!community) {
    res.status(404).json({ error: 'Сообщество не найдено' })
    return null
  }
  const meId = req.user!.id
  const isAdmin = req.user!.role === 'admin'
  const membership = await getMembership(communityId, meId)
  return { community, membership, isAdmin, isOwner: membership?.role === 'owner' || community.createdById === meId }
}

// ---------- routes ----------

// GET /api/communities — public list for the guest/user: all public
// communities + private ones where I am a member. Admins see everything.
router.get('/', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const meId = req.user?.id || null
  const isAdmin = req.user?.role === 'admin'

  const communities = await prisma.community.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { members: true, posts: true } },
    },
  })

  const myMemberships = meId
    ? await prisma.communityMember.findMany({ where: { userId: meId } })
    : []
  const myByCommunity = new Map(myMemberships.map((m) => [m.communityId, m]))

  const items = communities
    .filter((c) => c.type === 'public' || isAdmin || myByCommunity.has(c.id))
    .map((c) => {
      const mine = myByCommunity.get(c.id)
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        cover: c.cover,
        type: c.type,
        membersCount: c._count.members,
        postsCount: c._count.posts,
        createdAt: c.createdAt,
        isMember: !!mine,
        isOwner: mine?.role === 'owner' || c.createdById === meId,
      }
    })

  res.json({ items })
}))

// POST /api/communities — admin creates a community and becomes owner-member.
router.post('/', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const data = createCommunitySchema.parse(req.body)
  const community = await prisma.community.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      type: data.type,
      cover: data.cover ?? null,
      createdById: req.user!.id,
      members: { create: { userId: req.user!.id, role: 'owner' } },
    },
  })
  logger.info('Community created', { module: 'communities', id: community.id, name: community.name, type: community.type })
  res.status(201).json(community)
}))

// PATCH /api/communities/:id — admin or owner updates name/desc/cover/type.
router.patch('/:id', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const access = await requireAccess(req, res, req.params.id)
  if (!access) return
  const { community, isAdmin, isOwner } = access
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Только владелец или админ' })
  void community

  const data = updateCommunitySchema.parse(req.body)
  const updated = await prisma.community.update({
    where: { id: req.params.id },
    data,
  })
  res.json(updated)
}))

// DELETE /api/communities/:id — admin only.
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  await prisma.community.delete({ where: { id: req.params.id } })
  logger.info('Community deleted', { module: 'communities', id: req.params.id })
  res.json({ ok: true })
}))

// POST /:id/join — self-join (public communities only).
router.post('/:id/join', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } })
  if (!community) return res.status(404).json({ error: 'Сообщество не найдено' })
  if (community.type !== 'public') {
    return res.status(403).json({ error: 'Вступить в закрытое сообщество можно только по приглашению владельца' })
  }
  const existing = await getMembership(community.id, req.user!.id)
  if (!existing) {
    await prisma.communityMember.create({
      data: { communityId: community.id, userId: req.user!.id, role: 'member' },
    })
  }
  res.json({ ok: true })
}))

// POST /:id/leave — leave community (owner cannot leave).
router.post('/:id/leave', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const membership = await getMembership(req.params.id, req.user!.id)
  if (!membership) return res.status(404).json({ error: 'Вы не участник этого сообщества' })
  if (membership.role === 'owner') {
    return res.status(400).json({ error: 'Владелец не может покинуть своё сообщество' })
  }
  await prisma.communityMember.delete({ where: { id: membership.id } })
  res.json({ ok: true })
}))

// GET /:id/members — participants list (members + admins).
router.get('/:id/members', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const access = await requireAccess(req, res, req.params.id)
  if (!access) return
  const { community, membership, isAdmin } = access
  const canSee = isAdmin || community.type === 'public' || !!membership
  if (!canSee) return res.status(403).json({ error: 'Нет доступа' })

  const rows = await prisma.communityMember.findMany({
    where: { communityId: req.params.id },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatar: true, role: true, isOnline: true } },
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  })
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.user.username,
      displayName: r.user.displayName,
      avatar: r.user.avatar,
      role: r.role,
      isOnline: r.user.isOnline,
      joinedAt: r.createdAt,
    })),
  })
}))

// POST /:id/members — owner/admin adds a user by username/email/phone.
// This is how the WHOLESALE club works: the store owner adds wholesalers.
router.post('/:id/members', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const access = await requireAccess(req, res, req.params.id)
  if (!access) return
  const { isAdmin, isOwner } = access
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Только владелец или админ может добавлять участников' })

  const { query } = addMemberSchema.parse(req.body)
  const q = query.trim()
  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { username: { equals: q } },
        { email: { equals: q.toLowerCase() } },
        { phone: { contains: q } },
      ],
    },
    select: { id: true, username: true, displayName: true, avatar: true },
  })
  if (!user) return res.status(404).json({ error: 'Пользователь не найден. Проверьте логин, email или телефон.' })

  const existing = await getMembership(req.params.id, user.id)
  if (existing) return res.status(409).json({ error: 'Этот пользователь уже в сообществе' })

  await prisma.communityMember.create({
    data: { communityId: req.params.id, userId: user.id, role: 'member', addedById: req.user!.id },
  })
  res.status(201).json({ ok: true, member: { ...user, role: 'member' } })
}))

// DELETE /:id/members/:userId — remove participant (not the owner).
router.delete('/:id/members/:userId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const access = await requireAccess(req, res, req.params.id)
  if (!access) return
  const { isAdmin, isOwner } = access
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Только владелец или админ может удалять участников' })

  const membership = await getMembership(req.params.id, req.params.userId)
  if (!membership) return res.status(404).json({ error: 'Участник не найден' })
  if (membership.role === 'owner') return res.status(400).json({ error: 'Нельзя исключить владельца' })

  await prisma.communityMember.delete({ where: { id: membership.id } })
  res.json({ ok: true })
}))

// GET /:id/posts — announcement feed.
// Private communities: members + admins only. Public: everyone who can see
// the community page (guests included — it's an ad board).
router.get('/:id/posts', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 100)
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

  const community = await prisma.community.findUnique({ where: { id: req.params.id } })
  if (!community) return res.status(404).json({ error: 'Сообщество не найдено' })

  if (community.type === 'private') {
    const membership = await getMembership(community.id, req.user?.id)
    const isAdmin = req.user?.role === 'admin'
    if (!membership && !isAdmin) return res.status(403).json({ error: 'Это закрытое сообщество — доступ только у участников' })
  }

  const posts = await prisma.communityPost.findMany({
    where: { communityId: community.id, deletedAt: null, isHidden: false },
    include: {
      author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } },
      // v25.16: счётчик комментариев для бейджа на карточке объявления
      _count: { select: { comments: { where: { isHidden: false, deletedAt: null } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  })
  const total = await prisma.communityPost.count({
    where: { communityId: community.id, deletedAt: null, isHidden: false },
  })
  res.json({
    items: posts.map((p: any) => {
      const { _count, ...rest } = serialisePost(p)
      void _count
      return { ...rest, commentsCount: p._count?.comments ?? 0 }
    }),
    total,
  })
}))

// POST /:id/posts — publish an announcement (participants only).
router.post('/:id/posts', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const access = await requireAccess(req, res, req.params.id)
  if (!access) return
  const { community, membership, isAdmin } = access

  // Every community requires membership to post (private by invitation,
  // public via join button).
  if (!membership && !isAdmin) {
    return res.status(403).json({ error: 'Сначала вступите в сообщество' })
  }

  const data = createPostSchema.parse(req.body)

  // Moderation (stop-words etc.)
  const modDecision = await moderateContent(data.content, {
    userId: req.user!.id,
    targetType: 'community_post',
  })
  if (!modDecision.allowed) {
    return res.status(422).json({ error: modDecision.reason, moderationBlocked: true })
  }

  const post = await prisma.communityPost.create({
    data: {
      communityId: community.id,
      authorId: req.user!.id,
      content: data.content,
      images: JSON.stringify(data.images || []),
      price: data.price ?? null,
      contactPhone: data.contactPhone ?? null,
      // v25.16: WhatsApp / Telegram для связи по объявлению
      contactWhatsApp: data.contactWhatsApp ?? null,
      contactTelegram: data.contactTelegram ?? null,
    },
    include: {
      author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } },
    },
  })
  res.status(201).json(serialisePost(post))
}))

// DELETE /posts/:postId — author or admin removes their post (soft delete).
router.delete('/posts/:postId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.postId } })
  if (!post || post.deletedAt) return res.status(404).json({ error: 'Объявление не найдено' })
  if (post.authorId !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Можно удалять только свои объявления' })
  }
  await prisma.communityPost.update({ where: { id: post.id }, data: { deletedAt: new Date() } })
  res.json({ ok: true })
}))

// PATCH /posts/:postId — v25.18 (owner: «в сообществе человек должен иметь
// возможность редактировать своё объявление»). Редактировать может только
// автор (админ — любое). Обновляются: content (название+описание), images,
// price, контакты (phone/whatsapp/telegram). Проходит ту же модерацию.
router.patch('/posts/:postId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.postId } })
  if (!post || post.deletedAt) return res.status(404).json({ error: 'Объявление не найдено' })
  if (post.authorId !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Можно редактировать только свои объявления' })
  }

  const data = createPostSchema.partial().parse(req.body)

  if (data.content !== undefined) {
    const modDecision = await moderateContent(data.content, {
      userId: req.user!.id,
      targetType: 'community_post',
    })
    if (!modDecision.allowed) {
      return res.status(422).json({ error: modDecision.reason, moderationBlocked: true })
    }
  }

  const updateData: Record<string, unknown> = {}
  if (data.content !== undefined) updateData.content = data.content
  if (data.images !== undefined) updateData.images = JSON.stringify(data.images)
  if (data.price !== undefined) updateData.price = data.price
  if (data.contactPhone !== undefined) updateData.contactPhone = data.contactPhone
  if (data.contactWhatsApp !== undefined) updateData.contactWhatsApp = data.contactWhatsApp
  if (data.contactTelegram !== undefined) updateData.contactTelegram = data.contactTelegram

  const updated = await prisma.communityPost.update({
    where: { id: post.id },
    data: updateData,
    include: {
      author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } },
    },
  })
  res.json(serialisePost(updated))
}))

// ============================================================================
// v25.16 — КОММЕНТАРИИ К ОБЪЯВЛЕНИЯМ
// Avito-стиль: под каждым объявлением можно оставить комментарий и ОТВЕТИТЬ
// на чужой комментарий (parentId). Автор объявления / родительского
// комментария получает socket-событие и push-уведомление.
// ============================================================================

async function canSeePost(post: { id: string; communityId: string }, userId?: string | null, role?: string) {
  const community = await prisma.community.findUnique({ where: { id: post.communityId } })
  if (!community) return null
  if (community.type === 'private') {
    const membership = await getMembership(community.id, userId)
    if (!membership && role !== 'admin') return null
  }
  return community
}

// GET /posts/:postId/comments — список комментариев с ответами (1 уровень).
router.get('/posts/:postId/comments', optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.postId } })
  if (!post || post.deletedAt || post.isHidden) return res.status(404).json({ error: 'Объявление не найдено' })
  const ok = await canSeePost(post, req.user?.id, req.user?.role)
  if (!ok) return res.status(403).json({ error: 'Нет доступа' })

  const [items, total] = await Promise.all([
    prisma.communityComment.findMany({
      where: { postId: post.id, parentId: null, isHidden: false, deletedAt: null },
      include: {
        author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } },
        replies: {
          include: { author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } } },
          orderBy: { createdAt: 'asc' },
          where: { isHidden: false, deletedAt: null },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.communityComment.count({
      where: { postId: post.id, isHidden: false, deletedAt: null },
    }),
  ])

  // v25.24: ответы на ответы — добираем ВСЕХ потомков любого комментария и
  // подмешиваем ПЛОСКО в replies с полями replyToId/replyToName (как в
  // отзывах товаров). Фронт показывает «Ответ X: …».
  if (items.length > 0) {
    const all = await prisma.communityComment.findMany({
      where: { postId: post.id, parentId: { not: null }, isHidden: false, deletedAt: null },
      include: { author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const byParent = new Map<string, typeof all>()
    for (const c of all) {
      const pid = c.parentId as string
      if (!byParent.has(pid)) byParent.set(pid, [] as unknown as typeof all)
      ;(byParent.get(pid) as unknown as any[]).push(c)
    }
    const nameOf = (u: any) => u?.displayName || u?.username || 'Участник'
    for (const root of items) {
      const flat: any[] = [...((root as any).replies ?? [])]
      const nameById = new Map<string, string>()
      nameById.set(root.id, nameOf((root as any).author))
      for (const c of flat) nameById.set(c.id, nameOf((c as any).author))
      const queue = flat.map((c) => c.id)
      while (queue.length) {
        const pid = queue.shift() as string
        for (const child of (byParent.get(pid) ?? []) as unknown as any[]) {
          if (flat.some((c) => c.id === child.id)) continue
          ;(child as any).replyToId = pid
          ;(child as any).replyToName = nameById.get(pid) ?? null
          flat.push(child)
          nameById.set(child.id, nameOf(child.author))
          queue.push(child.id)
        }
      }
      ;(root as any).replies = flat
    }
  }

  res.json({ items: items.map(serialiseComment), total })
}))

// POST /posts/:postId/comments — новый комментарий или ответ (auth required).
router.post('/posts/:postId/comments', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.postId } })
  if (!post || post.deletedAt || post.isHidden) return res.status(404).json({ error: 'Объявление не найдено' })
  const ok = await canSeePost(post, req.user!.id, req.user!.role)
  if (!ok) return res.status(403).json({ error: 'Нет доступа' })

  const data = createCommentSchema.parse(req.body)

  // Модерация (стоп-слова, КАПС и т.д.) — как у отзывов товаров.
  const modDecision = await moderateContent(data.content, {
    userId: req.user!.id,
    targetType: 'community_post',
  })
  if (!modDecision.allowed) {
    return res.status(422).json({ error: modDecision.reason, moderationBlocked: true })
  }

  // Если это ответ — проверяем родительский комментарий того же поста.
  let parent: { id: string; authorId: string } | null = null
  if (data.parentId) {
    const p = await prisma.communityComment.findUnique({ where: { id: data.parentId } })
    if (!p || p.postId !== post.id || p.deletedAt) {
      return res.status(404).json({ error: 'Родительский комментарий не найден' })
    }
    parent = { id: p.id, authorId: p.authorId }
  }

  const comment = await prisma.communityComment.create({
    data: {
      postId: post.id,
      authorId: req.user!.id,
      parentId: parent?.id ?? null,
      content: data.content,
    },
    include: {
      author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } },
    },
  })

  // Socket + push автору объявления и автору ответа (без самоуведомлений).
  try {
    const { getIo } = await import('../socket/handlers.js')
    const { sendPushToUser } = await import('./push.js')
    const io = getIo()
    const myName = comment.author?.displayName || comment.author?.username || 'Участник'
    const preview = data.content.slice(0, 140)
    const targets = new Set<string>()
    if (post.authorId !== req.user!.id) targets.add(post.authorId)
    if (parent && parent.authorId !== req.user!.id && parent.authorId !== post.authorId) targets.add(parent.authorId)

    for (const uid of targets) {
      const isReplyToComment = !!parent && uid === parent.authorId
      const title = isReplyToComment ? '↩ Ответ на ваш комментарий' : '💬 Новый комментарий к объявлению'
      if (io) {
        io.to(`user:${uid}`).emit('community:comment', {
          commentId: comment.id,
          postId: post.id,
          parentId: comment.parentId,
          authorName: myName,
          content: preview,
          createdAt: comment.createdAt,
        })
      }
      void sendPushToUser(uid, {
        title,
        body: `${myName}: ${preview}`,
        tag: `ad-comment-${comment.id}`,
        url: `/?view=community&community=${post.communityId}&post=${post.id}`,
      })
    }
  } catch {
    // Уведомления не критичны — комментарий уже сохранён.
  }

  res.status(201).json(serialiseComment(comment))
}))

// GET /my-comments — «Мои комментарии»: всё, что я написал в объявлениях
// (и ответы других на них) — чтобы человек мог в любой момент найти свой
// комментарий. Тоже требование v25.16.
router.get('/my-comments', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const items = await prisma.communityComment.findMany({
    where: { authorId: req.user!.id, deletedAt: null },
    include: {
      replies: {
        include: { author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } } },
        orderBy: { createdAt: 'asc' },
        where: { isHidden: false, deletedAt: null },
      },
      post: {
        select: {
          id: true,
          content: true,
          images: true,
          createdAt: true,
          communityId: true,
          community: { select: { id: true, name: true, type: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const serialised = items.map((c) => ({
    id: c.id,
    content: c.content,
    createdAt: c.createdAt,
    parentId: c.parentId ?? null,
    post: {
      id: c.post.id,
      title: ((c.post.content || '').split('\n')[0] || '').slice(0, 90),
      images: (() => { try { const arr = JSON.parse(c.post.images || '[]'); return Array.isArray(arr) ? arr.slice(0, 1) : [] } catch { return [] } })(),
      createdAt: c.post.createdAt,
      communityId: c.post.communityId,
      communityName: c.post.community?.name || '',
    },
    replies: c.replies.map((r) => serialiseComment(r)),
  }))
  res.json({ items: serialised })
}))

// DELETE /comments/:commentId — удалить свой комментарий (или админ любой).
router.delete('/comments/:commentId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const c = await prisma.communityComment.findUnique({ where: { id: req.params.commentId } })
  if (!c || c.deletedAt) return res.status(404).json({ error: 'Комментарий не найден' })
  if (c.authorId !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Можно удалять только свои комментарии' })
  }
  await prisma.communityComment.update({ where: { id: c.id }, data: { deletedAt: new Date(), content: '' } })
  res.json({ ok: true })
}))

// PATCH /comments/:commentId — v25.17 (owner: «любой клиент… должен иметь
// возможность редактировать свой комментарий… неважно где»). Править можно
// только СВОЙ комментарий (админ — любой), только контент, 1..2000 символов.
router.patch('/comments/:commentId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
  if (!content) return res.status(400).json({ error: 'Текст комментария не может быть пустым' })
  if (content.length > 2000) return res.status(400).json({ error: 'Максимум 2000 символов' })

  const c = await prisma.communityComment.findUnique({ where: { id: req.params.commentId } })
  if (!c || c.deletedAt) return res.status(404).json({ error: 'Комментарий не найден' })
  if (c.authorId !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Можно редактировать только свои комментарии' })
  }

  const updated = await prisma.communityComment.update({
    where: { id: c.id },
    data: { content }, // updatedAt обновится автоматически (@updatedAt) —
    // фронт покажет «изменён» по updatedAt > createdAt
    include: {
      author: { select: { id: true, username: true, displayName: true, avatar: true, role: true } },
    },
  })
  res.json(serialiseComment(updated))
}))

export default router
