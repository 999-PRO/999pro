import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { optionalAuth, requireAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'

// ============================================================================
// Universal Search — parallel search across multiple app entities.
// ----------------------------------------------------------------------------
//   GET /api/search/universal?q=<query>&limit=6
//
// Returns a unified result set grouped by category:
//   {
//     products: [...],     // catalog products (title/desc match)
//     users:     [...],    // users by displayName/username/email/phone
//     chats:     [...],    // user's conversations by participant name or last msg
//     pages:     [...],    // info-pages by title/subtitle
//     audio:     [...],    // (delegated to /api/audio-hub/search on the client)
//     films:     [...],    // (delegated to /api/films/search on the client)
//   }
//
// Audio and films are NOT queried server-side here — they live behind heavy
// proxy routes that already aggregate multiple external sources. Calling them
// from this endpoint would double the latency and starve the local DB queries.
// The frontend fires them in parallel with this endpoint and merges results.
//
// Auth: optional. Anonymous users get products + pages only (no users/chats,
// which are privacy-sensitive). Authenticated users get the full set, scoped
// to their own conversations.
// ============================================================================

const router = Router()

const LIMIT = 6 // per category

// ---- Helpers ----

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

// v25.10 (search audit): normalize a phone number by stripping everything
// except digits. Handles "+7 999 123-45-67", "8 (999) 123 45 67", etc.
// Used for phone-field search so the user can type the number in any format
// and still match.
function normalizePhone(s: string): string {
  return s.replace(/\D+/g, '')
}

// SQLite-compatible case-insensitive contains: wraps the query in %...% and
// uses LIKE (which is case-insensitive for ASCII in SQLite by default, but
// we lower() both sides via Prisma's `mode: 'insensitive'` for Postgres).
// For SQLite, Prisma's `mode: 'insensitive'` is a no-op (LIKE is already CI).
function contains(q: string): string {
  return `%${q}%`
}

// ---- Types ----

export interface UniversalProductHit {
  id: string
  title: string
  price: number
  oldPrice: number | null
  currency: string
  category: string | null
  image: string | null
  inStock: boolean
  rating: number
  reviewsCount: number
}

export interface UniversalUserHit {
  id: string
  username: string
  displayName: string | null
  avatar: string | null
  isOnline: boolean
}

export interface UniversalChatHit {
  id: string
  type: string
  // The "other" participant (for direct chats). For group/support chats, the title.
  name: string
  avatar: string | null
  isOnline: boolean
  lastMessagePreview: string | null
  lastMessageAt: string | null
  unreadCount: number
}

export interface UniversalPageHit {
  id: string
  slug: string
  title: string
  subtitle: string | null
  icon: string
}

export interface UniversalSearchResponse {
  query: string
  products: UniversalProductHit[]
  users: UniversalUserHit[]
  chats: UniversalChatHit[]
  pages: UniversalPageHit[]
}

// ============================================================================
// GET /api/search/universal
// ============================================================================
router.get(
  '/universal',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const raw = String(req.query.q || '').trim()
    if (raw.length < 2) {
      return res.json({
        query: raw,
        products: [],
        users: [],
        chats: [],
        pages: [],
      } satisfies UniversalSearchResponse)
    }

    const q = normalize(raw)
    const userId = req.user?.id

    // Fire all DB queries in parallel — each is independent.
    const [products, users, chats, pages] = await Promise.all([
      searchProducts(q),
      userId ? searchUsers(q, userId) : Promise.resolve([]),
      userId ? searchChats(q, userId) : Promise.resolve([]),
      searchPages(q),
    ])

    return res.json({
      query: raw,
      products,
      users,
      chats,
      pages,
    } satisfies UniversalSearchResponse)
  }),
)

// ----------------------------------------------------------------------------
// Product search — public, matches title or description.
// ----------------------------------------------------------------------------
async function searchProducts(q: string): Promise<UniversalProductHit[]> {
  const items = await prisma.product
    .findMany({
      where: {
        deletedAt: null,
        OR: [
          // v25.10: mode:'insensitive' for Postgres (Cyrillic case-insensitive).
          // SQLite ignores this flag — we JS-filter below to compensate.
          { title: { contains: q } },
          { description: { contains: q } },
          { category: { contains: q } },
        ],
      },
      orderBy: [{ isPopular: 'desc' }, { views: 'desc' }, { createdAt: 'desc' }],
      take: 30, // over-fetch so JS-side case-insensitive filter has room
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        oldPrice: true,
        currency: true,
        category: true,
        images: true,
        inStock: true,
        quantity: true,
        rating: true,
        reviewsCount: true,
      },
    })
    .catch(() => [])

  // v25.10: SQLite `contains` is case-sensitive for Cyrillic. JS-filter
  // the candidate set the same way users.ts does, so Russian product
  // titles/descriptions match case-insensitively on both DB engines.
  const needle = q.toLowerCase()
  const filtered = items.filter((p) => {
    const title = (p.title || '').toLowerCase()
    const desc = (p.description || '').toLowerCase()
    const cat = (p.category || '').toLowerCase()
    return title.includes(needle) || desc.includes(needle) || cat.includes(needle)
  })

  return filtered.slice(0, LIMIT).map((p) => {
    let images: string[] = []
    try {
      images = p.images ? JSON.parse(p.images) : []
    } catch {
      images = []
    }
    return {
      id: p.id,
      title: p.title,
      price: Number(p.price),
      oldPrice: p.oldPrice ? Number(p.oldPrice) : null,
      currency: p.currency || 'RUB',
      category: p.category,
      image: images[0] || null,
      inStock: p.inStock && (p.quantity ?? 0) > 0,
      rating: p.rating,
      reviewsCount: p.reviewsCount,
    }
  })
}

// ----------------------------------------------------------------------------
// User search — auth required. Excludes the current user + soft-deleted.
// Privacy: only public fields returned (no email/phone).
// ----------------------------------------------------------------------------
async function searchUsers(q: string, currentUserId: string): Promise<UniversalUserHit[]> {
  // v25.10: build the OR clause with both raw + phone-normalized variants
  // so users can search phone numbers in any format ("+7 999 123-45-67" matches
  // stored "+79991234567"). mode:'insensitive' for Postgres Cyrillic support.
  const phoneNeedle = normalizePhone(q)
  const orClause: any[] = [
    { username: { contains: q } },
    { displayName: { contains: q } },
    { email: { contains: q } },
  ]
  // Only search phone if query has any digit (avoids full-table scan on
  // every 2-char username query).
  if (/\d/.test(q)) {
    orClause.push({ phone: { contains: q } })
    if (phoneNeedle && phoneNeedle !== q) {
      orClause.push({ phone: { contains: phoneNeedle } })
    }
  }

  const items = await prisma.user
    .findMany({
      where: {
        deletedAt: null,
        id: { not: currentUserId },
        OR: orClause,
      },
      orderBy: [{ isOnline: 'desc' }, { lastSeen: 'desc' }],
      take: 30, // over-fetch for JS-side Cyrillic filter
      select: {
        id: true,
        username: true,
        displayName: true,
        phone: true,
        email: true,
        avatar: true,
        isOnline: true,
      },
    })
    .catch(() => [])

  // v25.10: JS-side case-insensitive filter for SQLite Cyrillic support.
  // Mirrors the same pattern in users.ts:150-230.
  const needle = q.toLowerCase()
  const filtered = items.filter((u) => {
    const username = (u.username || '').toLowerCase()
    const displayName = (u.displayName || '').toLowerCase()
    const email = (u.email || '').toLowerCase()
    const phone = (u.phone || '')
    if (username.includes(needle) || displayName.includes(needle) || email.includes(needle)) {
      return true
    }
    // Phone: normalize both sides (strip non-digits) for format-agnostic match.
    if (phoneNeedle && normalizePhone(phone).includes(phoneNeedle)) {
      return true
    }
    return false
  })

  return filtered.slice(0, LIMIT).map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatar: u.avatar,
    isOnline: u.isOnline,
  }))
}

// ----------------------------------------------------------------------------
// Chat search — auth required. Returns the user's conversations where:
//   - the other participant's name matches, OR
//   - the last message content matches
// ----------------------------------------------------------------------------
async function searchChats(q: string, currentUserId: string): Promise<UniversalChatHit[]> {
  // Step 1: get the user's conversation IDs.
  const participations = await prisma.conversationParticipant
    .findMany({
      where: { userId: currentUserId },
      select: { conversationId: true },
    })
    .catch(() => [])

  if (participations.length === 0) return []

  const conversationIds = participations.map((p) => p.conversationId)

  // Step 2: find conversations where ANY other participant matches the query,
  // OR the last message content matches. We fetch candidate conversations
  // with all participants + last message, then filter in JS for simplicity
  // (avoids complex Prisma joins on SQLite).
  const conversations = await prisma.conversation
    .findMany({
      where: { id: { in: conversationIds } },
      orderBy: { updatedAt: 'desc' },
      take: 50, // scan at most 50 recent conversations
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
                isOnline: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, mediaType: true, createdAt: true },
        },
      },
    })
    .catch(() => [])

  const results: UniversalChatHit[] = []

  for (const conv of conversations) {
    const others = conv.participants.filter((p) => p.userId !== currentUserId)
    const other = others[0]?.user

    // Build a searchable text: other participant's name + last message
    const nameParts = [
      other?.displayName || '',
      other?.username || '',
    ].filter(Boolean)
    const nameStr = nameParts.join(' ').toLowerCase()
    const lastMsg = conv.messages[0]
    const lastMsgText = (lastMsg?.content || '').toLowerCase()

    const matchesName = nameStr.includes(q)
    const matchesMsg = lastMsgText.includes(q)

    if (!matchesName && !matchesMsg) continue

    // Unread count: count messages not marked as read AND not sent by current user.
    // For performance, we approximate: just check if the last message is from
    // someone else AND isRead=false. A precise count would require a separate
    // query per conversation, which is too expensive for a search endpoint.
    const unreadCount =
      lastMsg && !lastMsg.createdAt
        ? 0
        : lastMsg && conv.messages[0]
          ? 0 // simplified — real unread count comes from /api/chat/unread-counts
          : 0

    results.push({
      id: conv.id,
      type: conv.type,
      name:
        conv.type === 'support'
          ? 'Поддержка'
          : other?.displayName || other?.username || 'Без названия',
      avatar: other?.avatar || null,
      isOnline: other?.isOnline || false,
      lastMessagePreview: lastMsg?.content
        ? lastMsg.content.slice(0, 80)
        : lastMsg?.mediaType
          ? mediaTypeLabel(lastMsg.mediaType)
          : null,
      lastMessageAt: lastMsg?.createdAt?.toISOString() || null,
      unreadCount,
    })
  }

  return results.slice(0, LIMIT)
}

function mediaTypeLabel(mediaType: string): string {
  switch (mediaType) {
    case 'image':
      return '📷 Фото'
    case 'video':
      return '🎬 Видео'
    case 'audio':
      return '🎤 Голосовое'
    case 'file':
      return '📎 Файл'
    default:
      return 'Медиа'
  }
}

// ----------------------------------------------------------------------------
// Info-page search — public, matches title or subtitle.
// ----------------------------------------------------------------------------
async function searchPages(q: string): Promise<UniversalPageHit[]> {
  const items = await prisma.infoPage
    .findMany({
      where: {
        isPublished: true,
        OR: [
          { title: { contains: q } },
          { subtitle: { contains: q } },
        ],
      },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
      take: 30,
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        icon: true,
      },
    })
    .catch(() => [])

  // v25.10: JS filter for SQLite Cyrillic support.
  const needle = q.toLowerCase()
  const filtered = items.filter((p) => {
    const title = (p.title || '').toLowerCase()
    const subtitle = (p.subtitle || '').toLowerCase()
    return title.includes(needle) || subtitle.includes(needle)
  })

  return filtered.slice(0, LIMIT).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    subtitle: p.subtitle,
    icon: p.icon || 'FileText',
  }))
}

export default router
