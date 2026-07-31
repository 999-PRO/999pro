// ============================================================================
//  F-MED-009: Dynamic robots.txt
//  ----------------------------------------------------------------------------
//  Replaces the static `public/robots.txt` which had the production domain
//  `https://999.pro` hardcoded in the Sitemap directive. With deployments on
//  sandbox previews / customer subdomains / staging, the hardcoded sitemap
//  URL pointed crawlers at a domain we don't always control.
//
//  Next.js App Router generates `/robots.txt` from this file at request time,
//  so the sitemap URL is always correct for the current deployment.
// ============================================================================

import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getPublicUrl } from '@/lib/public-url'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers()
  const headerMap: Record<string, string | string[] | undefined> = {}
  h.forEach((value, key) => {
    headerMap[key] = value
  })
  const url = getPublicUrl({ headers: headerMap })

  return {
    rules: [
      // Major social crawlers — full access so OG previews work.
      { userAgent: 'Googlebot', allow: '/' },
      { userAgent: 'Bingbot', allow: '/' },
      { userAgent: 'Twitterbot', allow: '/' },
      { userAgent: 'facebookexternalhit', allow: '/' },
      // Everyone else — full access to public pages, but block the studio
      // admin panel and API routes from indexing.
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/studio', '/studio/', '/api/'],
      },
    ],
    sitemap: `${url}/sitemap.xml`,
    host: url,
  }
}
