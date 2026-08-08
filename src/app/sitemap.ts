// ============================================================================
//  Dynamic sitemap for share pages.
//  ----------------------------------------------------------------------------
//  Next.js App Router supports `sitemap.ts` as a built-in convention. This
//  file generates a sitemap that includes:
//    • The main app pages (home, catalog, etc.)
//    • All public share pages /p/<shortId> (one per product with a ShareLink)
//
//  The sitemap is fetched by Google/Bing on a schedule and helps them
//  discover product pages even if no internal link points to them.
//
//  P-CRIT-004 fix: now uses the public /api/share/list endpoint (cursor
//  paginated, no auth required). Previously called /api/share/analytics
//  (admin-only) → 401 → empty sitemap → zero share-page SEO.
// ============================================================================

import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getPublicUrl } from '@/lib/public-url'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000'

// Cache the share link list for 1 hour to avoid hammering the backend.
let cachedLinks: { shortId: string; updatedAt: string }[] | null = null
let cacheTime = 0
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

async function fetchAllShareLinks(): Promise<{ shortId: string; updatedAt: string }[]> {
  // Return cached if fresh.
  if (cachedLinks && Date.now() - cacheTime < CACHE_TTL) {
    return cachedLinks
  }
  try {
    // P-CRIT-004 fix: use the new public /api/share/list endpoint (paginated,
    // no auth). Cursor through all pages.
    const allLinks: { shortId: string; updatedAt: string }[] = []
    let cursor: string | null = null
    const MAX_PAGES = 50 // safety cap (50 × 5000 = 250k share pages max)
    let pageCount = 0

    while (pageCount < MAX_PAGES) {
      pageCount++
      const url: string = cursor
        ? `${BACKEND_URL}/api/share/list?limit=5000&cursor=${encodeURIComponent(cursor)}`
        : `${BACKEND_URL}/api/share/list?limit=5000`
      const res: Response = await fetch(url, {
        next: { revalidate: 3600 },
      })
      if (!res.ok) break
      const data: { items?: Array<{ shortId: string; updatedAt: string }>; nextCursor?: string | null } = await res.json()
      if (!data?.items || !Array.isArray(data.items) || data.items.length === 0) break
      for (const item of data.items) {
        allLinks.push({
          shortId: item.shortId,
          updatedAt: item.updatedAt,
        })
      }
      if (!data.nextCursor) break
      cursor = data.nextCursor
    }

    cachedLinks = allLinks
    cacheTime = Date.now()
    return allLinks
  } catch {
    return []
  }
}

// Build-time constant for the main app pages (P-MED-003 fix: was `new Date()`
// on every sitemap fetch, which made search engines think pages change
// constantly and downgrade crawl priority).
const BUILD_TIME = new Date()

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Resolve the public URL from request headers — ensures sitemap entries
  // point to the actual deployment URL, not a hardcoded domain.
  const h = await headers()
  const headerMap: Record<string, string | string[] | undefined> = {}
  h.forEach((value, key) => { headerMap[key] = value })
  const publicUrl = getPublicUrl({ headers: headerMap })

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${publicUrl}/`,
      lastModified: BUILD_TIME,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${publicUrl}/?view=catalog`,
      lastModified: BUILD_TIME,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    // v12.3: feed sitemap entry removed — module deleted. The 999 CLUB module
    // is private (requires login) so it's intentionally NOT in the sitemap.
  ]

  // Add share pages — /p/<shortId>
  // v25.4 (OG audit): include the OG image URL in the `images` field so
  // Google Images indexes the branded product card alongside the page.
  const shareLinks = await fetchAllShareLinks()
  for (const link of shareLinks) {
    entries.push({
      url: `${publicUrl}/p/${link.shortId}`,
      lastModified: new Date(link.updatedAt),
      changeFrequency: 'weekly',
      priority: 0.7,
      images: [`${publicUrl}/og/${link.shortId}`],
    })
  }

  // v25.7 (TZ ЭТАП 2.9): include DB-backed info pages (privacy, terms, delivery
  // info, etc.) — these are the most SEO-valuable pages (long-form content).
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000'
    const infoRes = await fetch(`${backendUrl}/api/info-pages/menu`, {
      next: { revalidate: 3600 },
    })
    if (infoRes.ok) {
      const infoData: { items?: Array<{ slug: string; updatedAt?: string }> } = await infoRes.json()
      for (const item of infoData.items ?? []) {
        entries.push({
          url: `${publicUrl}/?view=info&page=${encodeURIComponent(item.slug)}`,
          lastModified: item.updatedAt ? new Date(item.updatedAt) : BUILD_TIME,
          changeFrequency: 'monthly',
          priority: 0.5,
        })
      }
    }
  } catch {
    // Info pages are non-critical for sitemap — skip on error.
  }

  // v25.7: static app pages (about, contacts, reviews).
  const staticPages = [
    { path: '/?view=about', priority: 0.4 },
    { path: '/?view=contacts', priority: 0.6 },
    { path: '/?view=reviews', priority: 0.5 },
  ]
  for (const p of staticPages) {
    entries.push({
      url: `${publicUrl}${p.path}`,
      lastModified: BUILD_TIME,
      changeFrequency: 'monthly',
      priority: p.priority,
    })
  }

  return entries
}
