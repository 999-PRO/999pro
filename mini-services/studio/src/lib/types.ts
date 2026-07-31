export type UserRole = 'user' | 'admin'

export interface User {
  id: string
  username: string
  displayName?: string | null
  email?: string
  phone?: string | null
  avatar?: string | null
  role?: UserRole
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
  // v11: physical stock quantity
  quantity?: number
  isPopular: boolean
  isAction: boolean
  isNew: boolean
  isRecommended: boolean
  // v24.4: optional link to a Department (contacts group)
  departmentId?: string | null
  createdAt?: string
  updatedAt?: string
}

// v12.3.1: Story interface RESTORED (was incorrectly removed with Feed).
// Stories is a standalone module — it does NOT depend on Feed.
export interface Story {
  id: string
  media: string[] // backend returns an array of URLs (multi-image story)
  mediaType: 'image' | 'video'
  caption?: string | null
  category?: string | null
  views: number
  createdAt: string
  expiresAt: string
  user: { id: string; username: string; displayName?: string | null; avatar?: string | null }
}

// v12.3: The `Post` interface remains removed with the Feed module.

export interface Banner {
  id: string
  // v12.6.4: all text fields are now optional (nullable). A banner can be
  // image-only (no title, no subtitle, no cta, no link).
  title: string | null
  subtitle?: string | null
  cta: string | null
  image: string
  gradient: string
  // When true, the banner renders with the gradient overlay (legacy style).
  // When false, the image is shown as-is with no overlay.
  useGradient: boolean
  link?: string | null
  order: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  // v12.6.4: object-fit mode for the image.
  objectFit?: 'cover' | 'contain'
  // v12.6.4: banner mode — 'image-only' hides all text/buttons in the editor.
  mode?: 'image-text' | 'image-only'
}

// v16.8: InfoPage — редактируемые информационные страницы приложения.
// Полностью управляются через Studio. Frontend рендерит страницу по slug.
export interface InfoPage {
  id: string
  slug: string
  title: string
  subtitle?: string | null
  content: string
  images: string[]
  icon: string
  order: number
  isPublished: boolean
  showInMenu: boolean
  metaDescription?: string | null
  createdAt: string
  updatedAt: string
}

export interface Analytics {
  products: number
  // v12.3.1: stories + storyViews RESTORED (Stories is a standalone module).
  // v12.3: posts / likes / comments remain removed with Feed.
  stories: number
  storyViews: number
  orders: number
  messages: number
  users: number
  banners: number
}

export interface HeaderImageSetting {
  url: string | null
  position: 'center' | 'top' | 'bottom'
  enabled: boolean
}

// ============================================================================
//  Hero block — the main desktop hero on the home page.
//  Managed via Studio → "Hero". Stored as the `heroBlock` AppSetting.
// ============================================================================
export interface HeroButton {
  text: string
  // Internal view to navigate to (e.g. 'catalog', 'feed'). Mutually exclusive
  // with `link`. When `view` is set, the client navigates internally; when
  // only `link` is set, the client opens the URL externally.
  view?: string | null
  // External URL (https://...). Used when `view` is null/empty.
  link?: string | null
}

export interface HeroBlockSetting {
  enabled: boolean
  // When true: render the gradient over the image. When false: show the
  // image as-is with no overlay (raw image).
  useGradient: boolean
  // Background image URL (optional — if null, only the gradient renders).
  image: string | null
  // Gradient ID — must match one of the GRADIENTS in the frontend map.
  gradient: string
  // v12.6.4: all text fields are now optional (nullable). A hero can be
  // image-only (no badge, no title, no description, no buttons).
  badge: string | null
  title: string | null
  description: string | null
  // Primary CTA button (gradient background).
  primaryButton: HeroButton | null
  // Secondary CTA button (outline / glass).
  secondaryButton: HeroButton | null
  // v12.6.4: object-fit mode for the image.
  objectFit?: 'cover' | 'contain'
  // v12.6.4: hero mode — 'image-only' hides all text/buttons in the editor.
  mode?: 'image-text' | 'image-only'
}

// ============================================================================
//  Lead — customer order request submitted via the BuySheet on the
//  frontend. Managed via Studio → "Заявки".
//  v9-audit-fix (C-3): proper Lead type instead of `any[]` in leads-manager.
// ============================================================================
export type LeadStatus = 'new' | 'processing' | 'working' | 'done' | 'cancelled'
export type DeliveryMethod = 'pickup' | 'delivery'
export type ContactMethod = 'whatsapp' | 'telegram' | 'phone' | 'email'

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
  deliveryMethod?: DeliveryMethod | null
  address?: string | null
  contactMethod?: ContactMethod | null
  receiptUrl?: string | null
  status: LeadStatus
  createdAt: string
  updatedAt?: string
}

// ============================================================================
//  Order — checkout order. Managed via Studio → "Заказы".
//  v16: added delivery system fields (lat, lng, mapUrl, deliveryZoneId, deliveryFee).
// ============================================================================
export type OrderStatus = 'new' | 'in_work' | 'production' | 'ready' | 'in_delivery' | 'done' | 'cancelled'

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  quantity: number
  price: number
  product: { id: string; title: string; images: string[]; price: number; category?: string | null; article?: string | null } | null
}

export interface Order {
  id: string
  userId: string
  total: number
  status: OrderStatus
  createdAt: string
  items: OrderItem[]
  name?: string | null
  phone?: string | null
  address?: string | null
  deliveryMethod?: DeliveryMethod | null
  contactMethod?: ContactMethod | null
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
//  Delivery system — v16
// ============================================================================
export interface DeliverySettings {
  deliveryEnabled: boolean
  pickupEnabled: boolean
  storeAddress: string | null
  storeLat: number | null
  storeLng: number | null
  storePhone: string | null
  workingHours: string | null
  defaultDeliveryCost: number
  deliveryTerms: string | null
  pickupTerms: string | null
}

export interface DeliveryZone {
  id: string
  name: string
  description: string | null
  cost: number
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}
