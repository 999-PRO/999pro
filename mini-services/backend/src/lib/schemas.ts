import { z } from 'zod'

// Reusable Zod schemas for request body validation.
// Using Zod keeps validation declarative and TypeScript-friendly.

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(24)
    // v24.5: ONLY latin letters, digits, underscore — no Cyrillic.
    // Usernames are technical identifiers used in URLs, mentions, and
    // referral codes, so they must be ASCII-safe.
    .regex(/^[a-zA-Z0-9_]+$/, 'Имя пользователя: только латинские буквы, цифры и подчёркивание'),
  email: z.string().email().max(256),
  // v25.7 (TZ ЭТАП 2.6): phone is now MANDATORY for regular users. The
  // frontend form has a `required` attribute on the phone input and a
  // pattern hint, but the backend is the source of truth — curl callers
  // cannot bypass this. The regex accepts +, digits, spaces, dashes, and
  // parentheses; the transform normalises to a canonical digits-only /
  // +prefix form for storage.
  phone: z
    .string()
    .trim()
    .min(7, 'Телефон: минимум 7 символов')
    .max(20, 'Телефон: максимум 20 символов')
    .regex(/^\+?[\d\s\-()]{7,20}$/, 'Телефон: только цифры, пробелы, +, -, скобки'),
  password: z.string().min(8).max(128),
  // v19.0: password confirmation — must match password
  confirmPassword: z.string().min(8).max(128).optional(),
  // v25.2 FIX: displayName now allows Cyrillic (а-яА-ЯёЁ) in addition to
  // Latin. This is a Russian-language app — users should be able to enter
  // their real name in Cyrillic (e.g. "Иван Иванов"). Previously the
  // regex only allowed Latin, which silently rejected every Cyrillic
  // name with a confusing 400 error. The frontend placeholder "Иван
  // Иванов" was actively misleading users into entering rejected input.
  displayName: z.string().max(64).regex(/^[a-zA-Zа-яА-ЯёЁ0-9_\s.-]+$/, 'Отображаемое имя: буквы, цифры, пробелы, точки и дефисы').optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  // v12.6: optional referral code — if present, the new user is linked
  // to the referrer and the referrer earns points.
  referralCode: z.string().max(20).optional(),
}).refine(
  (data) => !data.confirmPassword || data.password === data.confirmPassword,
  { message: 'Пароли не совпадают', path: ['confirmPassword'] },
)

/**
 * v19.0 — Validate password against the DB-configured SecuritySettings.
 * Returns an array of error messages (empty = valid).
 */
export async function validatePasswordAgainstSettings(
  password: string,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  // Read settings from DB
  const { prisma } = await import('./prisma.js')
  const settings = await prisma.securitySettings.findUnique({ where: { id: 'default' } })
  const minLength = settings?.passwordMinLength ?? 8
  const maxLength = settings?.passwordMaxLength ?? 128
  if (password.length < minLength) {
    errors.push(`Пароль должен содержать минимум ${minLength} символов`)
  }
  if (password.length > maxLength) {
    errors.push(`Пароль должен содержать не более ${maxLength} символов`)
  }
  if (settings?.passwordRequireUppercase && !/[A-ZА-Я]/.test(password)) {
    errors.push('Пароль должен содержать хотя бы одну заглавную букву')
  }
  if (settings?.passwordRequireLowercase && !/[a-zа-я]/.test(password)) {
    errors.push('Пароль должен содержать хотя бы одну строчную букву')
  }
  if (settings?.passwordRequireDigit && !/\d/.test(password)) {
    errors.push('Пароль должен содержать хотя бы одну цифру')
  }
  if (settings?.passwordRequireSymbol && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    errors.push('Пароль должен содержать хотя бы один спецсимвол')
  }
  return { ok: errors.length === 0, errors }
}

export const loginSchema = z.object({
  login: z.string().min(1).max(256), // email, username or phone
  password: z.string().min(1).max(128),
})

export const createProductSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  price: z.number().min(0).max(1_000_000_000),
  oldPrice: z.number().min(0).max(1_000_000_000).optional(),
  currency: z.string().max(8).optional(),
  category: z.string().max(64).optional(),
  images: z.array(z.string().max(2048)).min(1).max(20),
  inStock: z.boolean().optional(),
  // v11: physical stock quantity. 0 = out of stock, >0 = available.
  // Used by the frontend to show "В наличии" / "Заканчивается" / "Нет в наличии".
  quantity: z.number().int().min(0).max(1_000_000_000).optional(),
  isPopular: z.boolean().optional(),
  isAction: z.boolean().optional(),
  isNew: z.boolean().optional(),
  isRecommended: z.boolean().optional(),
  // B-LOW-006 fix: added isTrending and isPremium to schema (were accessed
  // via (data as any).isTrending in routes/products.ts, bypassing validation).
  isTrending: z.boolean().optional(),
  isPremium: z.boolean().optional(),
  // v24.5: department link for contacts by direction
  departmentId: z.string().nullable().optional(),
  // v25.8 (TRI999 launch): product colors with per-color image.
  // Each entry: { name: string, image: string }.
  // Empty array = no color variants (the regular image gallery is used).
  colors: z.array(
    z.object({
      name: z.string().min(1).max(64),
      image: z.string().min(1).max(2048),
    })
  ).max(50).optional(),
  // v25.10 (Task #6): vertical (3:4) product video — short clip (10-60s).
  // NULL = no video (image gallery only). The video URL is a relative path
  // (/uploads/...) pointing at the FFmpeg-compressed MP4.
  videoUrl: z.string().max(2048).nullable().optional(),
  // v25.10: poster image (first frame extracted by FFmpeg).
  videoPoster: z.string().max(2048).nullable().optional(),
  // v25.14 FIX: the create route reads `data.videoPosition` but the field
  // was missing from this schema (only updateProductSchema had it) — a
  // hidden TypeError for any client that posted videos on creation.
  videoPosition: z.number().int().min(0).max(50).nullable().optional(),
  // v25.20 (owner, «как в Инстаграме»): фоновая музыка товара — трек из
  // Audio Hub. null = убрано. Играет при просмотре ФОТО (не видео).
  music: z.object({
    id: z.string().min(1).max(160),
    title: z.string().min(1).max(300),
    artist: z.string().max(300).nullable().optional(),
    url: z.string().min(1).max(2048),
  }).nullable().optional(),
})

export const createStorySchema = z.object({
  // media accepts either a single URL (legacy) or an array of URLs (multi-image story).
  // We normalise to an array on the server.
  media: z.union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).min(1).max(20)]),
  mediaType: z.enum(['image', 'video']).default('image'),
  caption: z.string().max(500).optional(),
  category: z.string().max(64).optional(),
  durationHours: z.number().min(1).max(168).default(24),
  // v25.17 (owner: «выделяю несколько фотографий… сделай так, чтобы он в
  // одном сторисе все картинки были»): по умолчанию ВСЕ загруженные URL
  // попадают в ОДНУ сторис (media-массив) и листаются внутри просмотра.
  // grouped:false возвращает старое поведение «каждый URL = отдельная сторис».
  grouped: z.boolean().optional().default(true),
}).transform((d) => ({
  ...d,
  media: Array.isArray(d.media) ? d.media : [d.media],
}))

export const createPostSchema = z.object({
  caption: z.string().max(4000).optional(),
  media: z.array(z.string().min(1).max(2048)).min(1).max(20),
  mediaType: z.enum(['image', 'video']).default('image'),
  // Display format: "16:9" (horizontal/landscape) or "9:16" (vertical/portrait).
  // Default "16:9" for backward compatibility with posts created before this field existed.
  mediaFormat: z.enum(['16:9', '9:16']).default('16:9'),
  // Optional: list of product IDs to attach to this post (shown as
  // "Linked products" under the post in the feed).
  linkedProductIds: z.array(z.string().min(1).max(64)).max(20).optional(),
})

export const createCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  // Optional: ID of the parent comment this is replying to. Must reference
  // a top-level comment (parentId === null on the parent) — replies to
  // replies are rejected by the route handler to keep threads one level deep.
  parentId: z.string().min(1).max(64).optional(),
})

export const startConversationSchema = z.object({
  participantId: z.string().min(1).max(64),
})

export const sendMessageSchema = z
  .object({
    content: z.string().max(4000).optional(),
    // v9-audit-fix (extended for product messages):
    //   • For mediaType in {image, video, audio, file} — mediaUrl MUST be a
    //     relative /uploads/ path. This prevents the "image tracking" attack
    //     where a malicious user sends mediaUrl="https://evil.com/tracker.png"
    //     and the recipient's browser loads it, leaking their IP/UA.
    //   • For mediaType='product' — mediaUrl carries the productId (NOT an
    //     /uploads/ path). The product card lazy-fetches the live product
    //     data via /api/products/batch on the recipient side, so we only
    //     store the id. The route handler doesn't need to verify the product
    //     exists at send time — if the product is later deleted, the
    //     recipient's card gracefully shows "no longer available".
    //   • Product ids in this system can be cuid (24 chars latin/digits) OR
    //     slug-style strings set by the seed script (may contain Cyrillic,
    //     digits, dashes, dots, commas, ×, etc.). We don't enforce a strict
    //     charset here — instead we only reject `..` (path traversal) and
    //     require length 1-200 (matching the existing /:id validation in
    //     routes/products.ts:796). The object-level refine below ensures
    //     that product mediaType uses a non-/uploads/ string.
    mediaUrl: z
      .string()
      .max(4096)
      .optional()
      .refine(
        (url) => {
          if (!url) return true
          if (url.startsWith('/uploads/')) return true
          // Product-id or audio-hub JSON path: reject `..` (path traversal).
          // v16.19: audio-hub mediaUrl can be a JSON string up to 4096 chars.
          // We don't enforce a strict charset because real product ids include
          // Cyrillic, ×, commas, etc., and audio-hub JSON has {, ", :, etc.
          if (!url.includes('..') && url.length >= 1 && url.length <= 4096) return true
          return false
        },
        'mediaUrl must be a relative /uploads/ path or a non-traversal id/json (1-4096 chars, no "..")',
      ),
    // mediaType 'product' — special interactive product card message.
    // mediaType 'audio-hub' — v16.9.2: Audio Hub track card (mediaUrl = track id).
    // mediaType 'film' — v17: Video Hub film card (mediaUrl = FilmChatCardData JSON).
    // mediaType 'game' — v25.24: приглашение в онлайн-дуэль (mediaUrl = duelId).
    mediaType: z.enum(['text', 'image', 'video', 'audio', 'file', 'product', 'audio-hub', 'film', 'game']).optional(),
    duration: z.number().min(0).max(86400).optional(),
    // v12: attachments — array of file metadata for multi-file messages.
    // Each attachment: { url, type, name, size, duration? }.
    // When attachments is present, mediaUrl/mediaType are ignored (the
    // message is a group of files). Max 30 files per message.
    attachments: z
      .array(
        z.object({
          url: z.string().min(1).max(2048).refine(
            (u) => u.startsWith('/uploads/'),
            'attachment url must be a relative /uploads/ path',
          ),
          type: z.enum(['image', 'video', 'audio', 'file']),
          name: z.string().min(1).max(256).optional(),
          size: z.number().int().min(0).max(2_000_000_000).optional(),
          duration: z.number().min(0).max(86400).optional(),
        }),
      )
      .max(30)
      .optional(),
    replyToId: z.string().max(64).optional(),
    forwardedFromId: z.string().max(64).optional(),
    // v16.8-final: optional self-destruct timer for voice messages.
    // Sender chooses one of: 60, 720, 1440, 10080 minutes (1h, 12h, 24h, 7d).
    // 0 / undefined = no auto-delete. The schema validates the value against
    // the allowed set so a malicious client can't set arbitrary timers.
    selfDestructMinutes: z
      .number()
      .int()
      .refine(
        (n) => n === 0 || n === 60 || n === 720 || n === 1440 || n === 10080,
        'selfDestructMinutes must be one of: 0, 60, 720, 1440, 10080',
      )
      .optional(),
  })
  .refine((d) => d.content || d.mediaUrl || (d.attachments && d.attachments.length > 0), {
    message: 'Either content, mediaUrl, or attachments is required',
  })
  .refine(
    // Object-level: enforce that mediaUrl's shape matches the declared mediaType.
    //   • mediaType='product' → mediaUrl must NOT start with /uploads/ (it's a productId)
    //   • mediaType='audio-hub' → v16.19: mediaUrl stores a JSON-encoded full track
    //     object (up to 4096 chars). Must NOT be /uploads/, no `..`.
    //   • any other mediaType with mediaUrl → mediaUrl MUST start with /uploads/
    // (the original S-HIGH-005 rule, kept intact for non-product messages).
    (d) => {
      if (!d.mediaUrl) return true
      if (d.mediaType === 'product') {
        // Product id: 1-200 chars, no /uploads/, no `..`
        return (
          !d.mediaUrl.startsWith('/uploads/') &&
          d.mediaUrl.length >= 1 &&
          d.mediaUrl.length <= 200 &&
          !d.mediaUrl.includes('..')
        )
      }
      if (d.mediaType === 'audio-hub') {
        // v16.19: Audio Hub track — JSON-encoded full track object.
        // Allow up to 4096 chars (track JSON is ~300-500 bytes typically).
        // Must NOT be /uploads/, no `..`.
        return (
          !d.mediaUrl.startsWith('/uploads/') &&
          d.mediaUrl.length >= 1 &&
          d.mediaUrl.length <= 4096 &&
          !d.mediaUrl.includes('..')
        )
      }
      if (d.mediaType === 'film') {
        // v17: Video Hub film — JSON-encoded FilmChatCardData object.
        // Same rules as audio-hub: JSON string, not /uploads/, no `..`.
        return (
          !d.mediaUrl.startsWith('/uploads/') &&
          d.mediaUrl.length >= 1 &&
          d.mediaUrl.length <= 4096 &&
          !d.mediaUrl.includes('..')
        )
      }
      if (d.mediaType === 'game') {
        // v25.24: game duel invite — mediaUrl stores the duel id (cuid, ≤64).
        return (
          !d.mediaUrl.startsWith('/uploads/') &&
          d.mediaUrl.length >= 1 &&
          d.mediaUrl.length <= 64 &&
          !d.mediaUrl.includes('..')
        )
      }
      return d.mediaUrl.startsWith('/uploads/')
    },
    {
      message:
        "mediaUrl must be a relative /uploads/ path, or — for mediaType='product'/'audio-hub' — a non-traversal id",
    },
  )

export const forwardMessageSchema = z.object({
  targetConversationIds: z.array(z.string().min(1).max(64)).min(1).max(20),
  sourceMessageId: z.string().min(1).max(64),
})

export const createAdminSchema = z.object({
  // v24.5: latin-only displayName + username for admins/managers
  displayName: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_\s.-]+$/, 'Имя: только латинские буквы, цифры, пробелы, точки и дефисы'),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'Имя пользователя: только латинские буквы, цифры и подчёркивание'),
  email: z.string().email().max(256),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
})

export const resetAdminSchema = z.object({
  // v24.5: latin-only displayName + username for admins/managers
  displayName: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_\s.-]+$/, 'Имя: только латинские буквы, цифры, пробелы, точки и дефисы'),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'Имя пользователя: только латинские буквы, цифры и подчёркивание'),
  email: z.string().email().max(256),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
})
