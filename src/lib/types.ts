// Shared type definitions for the 999 — Три девятки app.
// H11 fix: базовые типы (UserRole, User, ChatUser) реэкспортируются из
// @999pro/shared — единого источника правды, разделяемого между frontend
// и studio. Локальные определения остались только для типов, которые
// уникальны для frontend (Catalog, Order, Product, etc.).

// Re-export shared types from @999pro/shared (single source of truth).
export type { UserRole, User, ChatUser } from '@999pro/shared'

// ChatUser теперь импортируется из @999pro/shared (H11 fix).

export interface ProductColor {
  name: string
  image: string
}

export interface Product {
  id: string
  title: string
  description?: string | null
  price: number
  oldPrice?: number | null
  currency?: string
  category?: string | null
  images: string[]
  rating: number
  reviewsCount: number
  inStock: boolean
  // v11: physical stock quantity — 0 = out of stock, >0 = available.
  // Used to show "В наличии" / "Заканчивается" / "Нет в наличии".
  quantity?: number
  isPopular: boolean
  isAction: boolean
  isNew: boolean
  isRecommended: boolean
  // v12.7: lifetime purchase count (used for "popular" sort)
  purchases?: number
  createdAt?: string
  updatedAt?: string
  // v24.4: department link — contacts by direction
  departmentId?: string | null
  department?: {
    id: string
    name: string
    phone?: string | null
    whatsapp?: string | null
    telegram?: string | null
    email?: string | null
    address?: string | null
    managerName?: string | null
  } | null
  // v25.8 (TRI999 launch): product colors with per-color image.
  colors?: ProductColor[]
  // v25.10 (Task #6): vertical (3:4) product video — admin-only upload.
  // NULL = no video (image gallery only). When set, the Product Viewer shows
  // a <video> at the top of the gallery, and the new fullscreen feed uses
  // it instead of the static image.
  videoUrl?: string | null
  // v25.10: poster image (first frame extracted by FFmpeg).
  videoPoster?: string | null
  // v25.12: position of the video in the media carousel (0 = first,
  // 1 = after 1st image, etc.). null/0 = first slide. Admin controls this.
  videoPosition?: number | null
  // v25.20 («как в Инстаграме»): фоновая музыка товара — играет при
  // просмотре ФОТО (страница товара + лента). При видео не звучит.
  music?: { id: string; title: string; artist?: string | null; url: string } | null
}

// v11: helper — resolve stock label from quantity + inStock.
// Returns the display text + Tailwind color class.
export function getStockLabel(product: Pick<Product, 'inStock' | 'quantity'>): {
  text: string
  variant: 'in-stock' | 'low' | 'out'
} {
  if (!product.inStock || !product.quantity || product.quantity === 0) {
    return { text: 'Нет в наличии', variant: 'out' }
  }
  if (product.quantity <= 5) {
    return { text: 'Заканчивается', variant: 'low' }
  }
  return { text: 'В наличии', variant: 'in-stock' }
}

// ============================================================================
// Orders
// ============================================================================

export type OrderStatus = 'new' | 'in_work' | 'production' | 'ready' | 'in_delivery' | 'done' | 'cancelled'

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  quantity: number
  price: number
  product: Pick<Product, 'id' | 'title' | 'images' | 'price'> | null
}

export interface Order {
  id: string
  userId: string
  total: number
  status: OrderStatus
  createdAt: string
  items: OrderItem[]
  // v12.7: checkout fields
  name?: string | null
  phone?: string | null
  address?: string | null
  deliveryMethod?: 'pickup' | 'delivery' | null
  contactMethod?: 'whatsapp' | 'telegram' | 'phone' | 'email' | null
  comment?: string | null
  receiptUrl?: string | null
  couponCode?: string | null
  discount?: number
  // v16: delivery system fields
  lat?: number | null
  lng?: number | null
  mapUrl?: string | null
  deliveryZoneId?: string | null
  deliveryFee?: number
  deliveryZone?: { id: string; name: string; cost: number } | null
  // v16.5: category + updatedAt
  category?: string | null
  updatedAt?: string | null
}

// ============================================================================
// Reviews
// ============================================================================

export interface Review {
  id: string
  productId: string
  userId: string
  /** v25.7 (TZ ЭТАП 2.3): null = top-level review; non-null = reply to that review. */
  parentId?: string | null
  rating: number
  title?: string | null
  content?: string | null
  photos: string[]
  isHidden: boolean
  createdAt: string
  updatedAt: string
  user: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
    /** v25.7: backend now includes role in the review author object so the
     * frontend can render an "Администратор" badge on admin replies without
     * an extra API round-trip. */
    role?: string
  } | null
  /** v25.7: nested admin replies. Only populated when the backend was asked
   * to `include: { replies: true }` (currently GET /api/reviews does this).
   * For replies themselves this field is undefined. */
  replies?: Review[]
}

// v12.3.1: Story interface RESTORED (was incorrectly removed with Feed in v12.3).
// Stories is a standalone module — it does NOT depend on the Feed module
// (posts/comments/likes). Feed remains deleted; Stories is back.
export interface Story {
  id: string
  media: string[] // backend returns an array of URLs (multi-image story)
  mediaType: 'image' | 'video'
  caption?: string | null
  category?: string | null
  views: number
  createdAt: string
  expiresAt: string
  user: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
}

// v12.3: The `Comment` and `Post` interfaces remain removed with the Feed
// module. Product reviews use a separate `Review` interface backed by the
// `Review` Prisma model — they were never related to feed posts.

export interface Conversation {
  id: string
  // 'direct' | 'support' — support conversations are pinned to the top
  // of the chat list and cannot be deleted by the user.
  type?: 'direct' | 'support'
  participant: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
    isOnline?: boolean
    lastSeen?: string
  } | null
  lastMessage?: {
    id: string
    content?: string | null
    mediaUrl?: string | null
    mediaType?: string | null
    // v12-fix: include attachments so chat-list-item.tsx can render the
    // "📷 3 📄 2" preview for multi-file messages without a type error.
    attachments?: Attachment[] | null
    createdAt: string
    senderId: string
    deletedForAll?: boolean
  } | null
  /** Number of unread messages in this conversation (optional — backend
   * may or may not populate it). */
  unreadCount?: number | null
  // v25.24: per-user chat-list state (закрепление/архив для себя)
  isPinned?: boolean
  isArchived?: boolean
  updatedAt: string
  createdAt: string
}

export interface MessageRef {
  id: string
  content?: string | null
  mediaUrl?: string | null
  mediaType?: string | null
  senderId?: string
  deletedForAll?: boolean
  sender?: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  } | null
}

// v12: Attachment — for multi-file messages (photos, documents, mixed)
export interface Attachment {
  url: string
  type: 'image' | 'video' | 'audio' | 'file'
  name?: string
  size?: number
  duration?: number
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  content?: string | null
  mediaUrl?: string | null
  mediaType?: 'text' | 'image' | 'video' | 'audio' | 'file' | 'product' | 'audio-hub' | 'film' | 'game' | null
  // v12: attachments — array of files when the message is a group of files.
  // When present, mediaUrl/mediaType are ignored (the message is a group).
  attachments?: Attachment[] | null
  duration?: number | null
  isRead?: boolean
  createdAt: string
  tempId?: string
  deletedForAll?: boolean
  deletedForMe?: boolean
  // v16.8-final: optional self-destruct deadline (ISO string) for voice
  // messages. When set, the message will be auto-deleted for everyone at
  // this timestamp by the backend scheduler.
  selfDestructAt?: string | null
  // v25.9: editedAt — when set (ISO string), the message was edited by its
  // sender. UI shows an "изменено" indicator next to the timestamp.
  editedAt?: string | null
  // v25.27: закреплённое сообщение (Telegram-style pin). ISO-строка или null.
  pinnedAt?: string | null
  // v18.6: optimistic-upload flags. When `isUploading` is true, the message
  // is shown in the chat list immediately with a spinner badge; the mediaUrl
  // points to a local blob: URL while the real upload is in flight. Once the
  // upload finishes, the message is updated with the real CDN URL and the
  // flag is cleared. If the upload fails, `uploadFailed` is set so the UI
  // can show a retry button.
  isUploading?: boolean
  uploadFailed?: boolean
  replyTo?: MessageRef | null
  forwardedFrom?: MessageRef | null
  sender?: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
}

export interface CallState {
  callId: string
  conversationId: string
  type: 'audio' | 'video'
  // For incoming calls: the caller's info; for outgoing: the recipient's
  peer: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  } | null
  status: 'ringing' | 'connecting' | 'connected' | 'ended' | 'rejected' | 'missed' | 'cancelled'
  direction: 'incoming' | 'outgoing'
  startedAt?: number
}

export interface Banner {
  id: string
  // v12.6.4: all text fields are now optional (nullable). A banner can be
  // image-only (no title, no subtitle, no cta, no link).
  title: string | null
  subtitle?: string | null
  cta: string | null
  image: string
  gradient: string
  // When true, the banner renders with the gradient overlay over the image
  // (legacy behaviour). When false, the image is shown as-is with no overlay.
  useGradient: boolean
  link?: string | null
  order: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  // v12.6.4: object-fit mode for the image.
  // 'cover' = crop to fill (default, legacy behaviour)
  // 'contain' = show fully without distortion (may letterbox)
  objectFit?: 'cover' | 'contain'
  // v12.6.4: banner mode.
  // 'image-text' = image + optional text/buttons (default, legacy behaviour)
  // 'image-only' = just the image, no text/buttons rendered at all
  mode?: 'image-text' | 'image-only'
}

export interface HeaderImageSetting {
  url: string | null
  position: 'center' | 'top' | 'bottom'
  enabled: boolean
}

// ============================================================================
//  Hero block — the main desktop hero on the home page.
//  Loaded from /api/settings/heroBlock. Falls back to defaults if null.
// ============================================================================
export interface HeroButton {
  text: string
  // Internal view to navigate to (e.g. 'catalog', 'club'). Mutually exclusive
  // with `link`. When `view` is set, the client navigates internally.
  view?: string | null
  // External URL. Used when `view` is null/empty.
  link?: string | null
}

export interface HeroBlockSetting {
  enabled: boolean
  // When true: render the gradient over the image. When false: show the
  // image as-is with no overlay (raw image).
  useGradient: boolean
  image: string | null
  // v25.13 (multi-image hero): array of image URLs for crossfade carousel.
  // Backward-compatible: empty/undefined → fall back to single `image`.
  // 2+ images → auto-rotate every ~8-10s with cinematic fade transition.
  images?: string[]
  // v25.21 (owner): видео в hero — «добавить туда видео или GIF». GIF-файлы
  // приходят через images (это картинки), а видео — отдельным массивом.
  // Слайды = [...images, ...videos]; активное видео autoplay muted loop.
  videos?: string[]
  gradient: string
  // v12.6.4: all text fields are now optional (nullable). A hero can be
  // image-only (no badge, no title, no description, no buttons).
  badge: string | null
  title: string | null
  description: string | null
  primaryButton: HeroButton | null
  secondaryButton: HeroButton | null
  // v12.6.4: object-fit mode for the image.
  // 'cover' = crop to fill (default, legacy behaviour)
  // 'contain' = show fully without distortion (may letterbox)
  objectFit?: 'cover' | 'contain'
  // v12.6.4: hero mode.
  // 'image-text' = image + optional text/buttons (default, legacy behaviour)
  // 'image-only' = just the image, no text/buttons rendered at all
  mode?: 'image-text' | 'image-only'
}

// ============================================================================
// v25.21 — MobileHeroBlockSetting: ОТДЕЛЬНЫЙ hero для мобильных.
// Владелец: «на десктопе hero чётко, на мобильном слишком большой — сделай
// размером как баннеры, с картинками/видео и кнопками (кнопки не обязательны)».
// Когда enabled=true и media непустой → на телефоне вместо большого hero
// рендерится компактный баннер; десктоп НЕ меняется вовсе.
// ============================================================================
export interface MobileHeroBlockSetting {
  enabled: boolean
  // Изображения (вкл. GIF) И/ИЛИ видео (mp4/webm) — определяются по расширению.
  media: string[]
  badge: string | null
  title: string | null
  description: string | null
  primaryButton: HeroButton | null
  secondaryButton: HeroButton | null
}

// ============================================================================
//  Leads — заявки пользователей (lead form on product pages)
// ============================================================================
export type LeadStatus = 'new' | 'processing' | 'working' | 'done' | 'cancelled'

export interface Lead {
  id: string
  name: string
  phone: string
  comment?: string | null
  productId?: string | null
  productTitle?: string | null
  productPrice?: number | null
  productImage?: string | null
  quantity: number
  deliveryMethod?: 'pickup' | 'delivery' | null
  address?: string | null
  contactMethod?: 'whatsapp' | 'telegram' | 'phone' | 'email' | null
  receiptUrl?: string | null
  status: LeadStatus
  userId?: string | null
  createdAt: string
  updatedAt: string
}
