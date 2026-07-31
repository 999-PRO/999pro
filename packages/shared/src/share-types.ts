// Smart Share — public types used by the frontend share page and components.

export type SharePlatform =
  | 'whatsapp'
  | 'telegram'
  | 'instagram'
  | 'facebook'
  | 'vk'
  | 'messenger'
  | 'x'
  | 'email'
  | 'copy'
  | 'qrcode'
  | 'web'
  | 'in-app'
  | 'unknown'

export type ShareEventType = 'share' | 'open' | 'app_open' | 'install' | 'order'

/** Response from GET /api/share/by-product/:productId */
export interface ShareLinkInfo {
  shortId: string
  shareUrl: string
  deepLinkUrl: string
  qrPayload: string
  stats: {
    sharesCount: number
    opensCount: number
    appOpensCount: number
    installsCount: number
    ordersCount: number
  }
}

/** Response from GET /api/share/s/:shortId — full share page payload */
export interface SharePageData {
  shortId: string
  shareUrl: string
  deepLinkUrl: string
  product: {
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
    isPopular: boolean
    isAction: boolean
    isNew: boolean
    isRecommended: boolean
  }
  reviews: Array<{
    id: string
    rating: number
    title?: string | null
    content?: string | null
    photos: string[]
    createdAt: string
    user: {
      id: string
      username: string
      displayName?: string | null
      avatar?: string | null
    } | null
  }>
  related: Array<{
    id: string
    title: string
    price: number
    oldPrice?: number | null
    currency?: string
    category?: string | null
    images: string[]
    rating: number
    reviewsCount: number
    inStock: boolean
  }>
  stats: {
    shares: number
    opens: number
    appOpens: number
    installs: number
    orders: number
  }
}

/** Response from GET /api/share/analytics (admin) */
export interface ShareAnalytics {
  totals: {
    shares: number
    opens: number
    appOpens: number
    installs: number
    orders: number
  }
  topProducts: Array<{
    productId: string
    shortId: string
    title: string
    image: string | null
    price: number
    currency: string
    shares: number
    opens: number
    appOpens: number
    installs: number
    orders: number
  }>
  byPlatform: Array<{
    platform: string
    shares: number
  }>
  recentEvents: Array<{
    id: string
    eventType: string
    platform: string
    createdAt: string
    productTitle: string | null
  }>
}
