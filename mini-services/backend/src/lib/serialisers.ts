// ============================================================================
// Shared serialisation helpers — used by REST routes AND socket handlers
// so they never drift apart. All helpers are pure (no side effects, safe
// to call from any context).
// ============================================================================

/**
 * Parse a JSON-encoded string field from the DB into an array.
 *
 * SQLite has no native array type, so the schema stores arrays as JSON
 * strings (e.g. `Product.images`, `Post.media`). If a row has a malformed
 * value (legacy data, manual edit, migration), `JSON.parse` would throw
 * and the entire endpoint would return 500. This helper always returns a
 * valid array — `[]` on any parse failure.
 *
 * Also normalises non-array JSON values (e.g. a single string accidentally
 * stored without array wrapping) by wrapping them in an array.
 */
export function safeParseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[]
  if (typeof value !== 'string' || value.length === 0) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed as string[]
    if (parsed == null) return []
    // Single value (string/number) — wrap.
    return [String(parsed)]
  } catch {
    return []
  }
}

/**
 * Public-safe user shape — NEVER include email/phone/password.
 *
 * Used by `auth.ts` (login/register/me) and `users.ts` (search/profile).
 * The auth version includes email+phone (because the user is viewing their
 * own profile); the users version omits them (other users shouldn't see
 * contact info). Pass `includeContact` to control this.
 */
export function publicUser<T extends Record<string, unknown>>(
  u: T,
  opts: { includeContact?: boolean } = {},
) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName ?? null,
    email: opts.includeContact ? u.email : undefined,
    phone: opts.includeContact ? u.phone : undefined,
    avatar: u.avatar ?? null,
    bio: u.bio ?? null,
    gender: u.gender ?? null,
    role: u.role,
    isOnline: u.isOnline ?? false,
    lastSeen: u.lastSeen,
    createdAt: u.createdAt,
    // v16.8 final: expose emailVerified so the frontend can show the
    // "verify your email" banner + resend button in the profile screen.
    // Always included (even for the public non-contact shape) because
    // emailVerified is not sensitive PII — it's a boolean flag.
    emailVerified: u.emailVerified ?? null,
    // v19.0: expose totpEnabled so the frontend can show 2FA status in settings.
    totpEnabled: (u as any).totpEnabled ?? false,
  }
}

/**
 * v13.3 (audit dedup): shared Prisma select clause for the public user shape.
 * Used by chat.ts, reviews.ts, socket/handlers.ts — previously each had its
 * own copy. Keeping these in sync is critical: if one file adds a field,
 * the others silently omit it from their responses.
 */
export const USER_PUBLIC_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  gender: true,
  isOnline: true,
  lastSeen: true,
} as const

/**
 * Build a short human-readable preview of a message body.
 *
 * Used by:
 *   - notification payloads (push + in-app toast)
 *   - chat list "last message" preview
 *   - forward dialog preview
 *   - reply preview
 *
 * Centralising here prevents drift between the four call sites that
 * previously each had their own copy of the emoji logic.
 */
export function buildMessagePreview(m: {
  content?: string | null
  mediaType?: string | null
  attachments?: Attachment[] | null
}): string {
  if (m.content) return m.content
  // v12: attachments group preview
  if (m.attachments && m.attachments.length > 0) {
    const counts: Record<string, number> = {}
    m.attachments.forEach((a) => {
      counts[a.type] = (counts[a.type] || 0) + 1
    })
    const parts: string[] = []
    if (counts.image) parts.push(`📷 Фото (${counts.image})`)
    if (counts.video) parts.push(`🎥 Видео (${counts.video})`)
    if (counts.file) parts.push(`📄 Документы (${counts.file})`)
    if (counts.audio) parts.push(`🎤 Голосовые (${counts.audio})`)
    return parts.join(' · ') || 'Вложения'
  }
  if (m.mediaType === 'image') return '📷 Фото'
  if (m.mediaType === 'video') return '🎥 Видео'
  if (m.mediaType === 'audio') return '🎤 Голосовое сообщение'
  if (m.mediaType === 'file') return '📎 Файл'
  if (m.mediaType === 'product') return '🛍 Товар'
  return 'Новое сообщение'
}

// v12: Attachment type — matches the Zod schema in schemas.ts
interface Attachment {
  url: string
  type: 'image' | 'video' | 'audio' | 'file'
  name?: string
  size?: number
  duration?: number
}

/**
 * Parse a JSON-encoded attachments field from the DB into an array.
 * Returns null if the field is absent or empty (so the frontend can
 * distinguish "no attachments" from "empty array").
 */
function parseAttachments(value: unknown): Attachment[] | null {
  if (!value) return null
  if (Array.isArray(value)) return value as Attachment[]
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Attachment[]
    return null
  } catch {
    return null
  }
}

/**
 * Serialise a Prisma Message row (with relations) into the public API shape.
 *
 * DE DUPLICATION: previously this lived as a private function in BOTH
 * `routes/chat.ts` and `socket/handlers.ts` — identical 60-line copies
 * that could drift apart when one was updated and the other wasn't.
 * Now there's a single source of truth here.
 *
 * Handles:
 *   - soft-delete (deletedFor: JSON array of userIds, deletedForAll: boolean)
 *   - reply context (replyTo relation)
 *   - forward context (forwardedFrom relation)
 *   - sender public shape (no email/phone/password)
 *
 * `viewerId` is used to determine if the message is hidden for this viewer
 * (deletedFor includes their userId). The `deletedForMe` field is true when
 * the viewer is in the deletedFor array but deletedForAll is false.
 *
 * When `deletedForAll` is true, content/mediaUrl/mediaType/duration are
 * nulled out — the message is shown as "Сообщение удалено".
 */
export function serialiseMessage(m: any, viewerId: string) {
  const deletedFor: string[] = (() => {
    try {
      return JSON.parse(m.deletedFor || '[]')
    } catch {
      return []
    }
  })()
  const hiddenForMe = deletedFor.includes(viewerId)
  // v12: parse attachments JSON → array (or null if absent)
  const attachments = m.deletedForAll ? null : parseAttachments(m.attachments)
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    content: m.deletedForAll ? null : m.content,
    mediaUrl: m.deletedForAll ? null : m.mediaUrl,
    mediaType: m.deletedForAll ? null : m.mediaType,
    // v12: attachments array (for multi-file messages)
    attachments,
    duration: m.deletedForAll ? null : m.duration,
    isRead: m.isRead,
    deletedForAll: m.deletedForAll,
    deletedForMe: hiddenForMe,
    // v16.8-final: self-destruct timer (voice messages). When the message is
    // deleted-for-everyone the timer is moot — return null so the client
    // doesn't show a stale "deletes in X" badge on a deleted bubble.
    selfDestructAt: m.deletedForAll ? null : (m.selfDestructAt ?? null),
    createdAt: m.createdAt,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          content: m.replyTo.deletedForAll ? null : m.replyTo.content,
          mediaUrl: m.replyTo.deletedForAll ? null : m.replyTo.mediaUrl,
          mediaType: m.replyTo.deletedForAll ? null : m.replyTo.mediaType,
          senderId: m.replyTo.senderId,
          sender: m.replyTo.sender
            ? {
                id: m.replyTo.sender.id,
                username: m.replyTo.sender.username,
                displayName: m.replyTo.sender.displayName,
                avatar: m.replyTo.sender.avatar,
              }
            : null,
        }
      : null,
    forwardedFrom: m.forwardedFrom
      ? {
          id: m.forwardedFrom.id,
          content: m.forwardedFrom.deletedForAll ? null : m.forwardedFrom.content,
          senderId: m.forwardedFrom.senderId,
          sender: m.forwardedFrom.sender
            ? {
                id: m.forwardedFrom.sender.id,
                username: m.forwardedFrom.sender.username,
                displayName: m.forwardedFrom.sender.displayName,
                avatar: m.forwardedFrom.sender.avatar,
              }
            : null,
        }
      : null,
    sender: m.sender
      ? {
          id: m.sender.id,
          username: m.sender.username,
          displayName: m.sender.displayName,
          avatar: m.sender.avatar,
        }
      : null,
  }
}
