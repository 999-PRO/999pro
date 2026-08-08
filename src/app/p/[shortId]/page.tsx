// ============================================================================
//  Smart Share — public product share page
//  ----------------------------------------------------------------------------
//  Route: /p/[shortId]
//
//  This is a SERVER-RENDERED page that:
//    1. Fetches the product + reviews + related from /api/share/s/:shortId
//    2. Generates proper Open Graph, Twitter Card, Schema.org JSON-LD meta
//       tags so WhatsApp/Telegram/Facebook/X show a rich card preview.
//    3. Renders a beautiful product page with gallery, price, reviews, and
//       CTAs (Buy / Open App / Install App / Share).
//    4. Records an `open` event via the backend (the backend also records
//       one, but the client-side call captures referrer/UTM info).
//
//  IMPORTANT: this route is PUBLIC (no auth). It must NOT expose internal
//  Product.id, user email/phone, or any other sensitive data. The backend
//  already returns a sanitised payload.
// ============================================================================

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { SharePageClient } from './share-page-client'
import { getPublicUrl, buildShareUrl } from '@/lib/public-url'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000'

// ----------------------------------------------------------------------------
//  GenerateMetadata — fetches product data and emits OG / Twitter / canonical
//  meta tags. This is what makes the share card look beautiful in WhatsApp /
//  Telegram / Facebook / X / iMessage.
// ----------------------------------------------------------------------------
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shortId: string }>
}): Promise<Metadata> {
  const { shortId } = await params
  if (!shortId || !/^[A-Za-z0-9]{4,32}$/.test(shortId)) {
    return { title: 'Товар не найден — 999 — Три девятки' }
  }

  // Resolve the public URL from the request headers — this ensures OG tags
  // point to the ACTUAL deployment URL (sandbox preview, customer domain)
  // instead of a hardcoded "https://999.pro" that we don't control.
  const h = await headers()
  const headerMap: Record<string, string | string[] | undefined> = {}
  h.forEach((value, key) => { headerMap[key] = value })
  const publicUrl = getPublicUrl({ headers: headerMap })

  const data = await fetchShareData(shortId)
  if (!data) {
    return { title: 'Товар не найден — 999 — Три девятки' }
  }

  const { product } = data
  // Use the request-resolved shareUrl — overrides whatever the backend sent
  // (which may have used a different host if the request came through a proxy).
  const shareUrl = `${publicUrl}/p/${shortId}`
  const title = `${product.title} — ${formatPrice(product.price, product.currency)} | 999 — Три девятки`
  const description =
    (product.description ? product.description.slice(0, 160) : null) ||
    `${product.title} за ${formatPrice(product.price, product.currency)}. Маркетплейс нового поколения — 999 — Три девятки.`

  // ─── OG Image — use OUR proxy endpoint, not the raw Unsplash URL ───
  // WhatsApp / Facebook / Telegram crawlers don't reliably fetch OG images
  // from third-party domains (Unsplash, etc.). They prefer images served
  // from the SAME domain as the share page.
  //
  // We point og:image to /api/og-image/<shortId> — our proxy that:
  //   1. Fetches the product's first image (from Unsplash or /uploads/)
  //   2. Re-encodes it as 1200×1200 JPEG q85 using Sharp
  //   3. Returns it with long-lived cache headers
  //
  // This ensures crawlers ALWAYS see an image from our domain, with correct
  // dimensions and Content-Type — reliable preview in WhatsApp/Telegram/FB.
  const ogImageUrl = `${publicUrl}/og/${shortId}`

  return {
    title,
    description,
    alternates: {
      canonical: shareUrl,
    },
    openGraph: {
      title,
      description,
      // v25.4 (OG audit): 'website' → 'product' so Facebook renders a richer
      // product card with price. Combined with the product:price:* tags below
      // (emitted via the `other` field), WhatsApp/FB show the price inline.
      // Cast to satisfy Next.js's strict OpenGraph type (it only models
      // 'website'/'article'/'video.other' etc. — 'product' is valid per the
      // OG spec but not in Next's type definitions).
      type: 'product' as any,
      locale: 'ru_RU',
      siteName: '999 — Три девятки',
      url: shareUrl,
      // Single OG image (not multiple) — WhatsApp prefers ONE og:image
      // and may ignore the rest. Pointing to our proxy ensures it's
      // always fetchable from the same domain.
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 1200,
          alt: `${product.title} — 999 — Три девятки`,
          type: 'image/jpeg',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
    // v25.4 (OG audit): product:price:* tags power Facebook's product card
    // and Twitter's "Price" label1/data1 extra fields. Emitted as raw meta
    // tags via the `other` field (Next.js doesn't have a typed product slot).
    other: {
      'product:price:amount': String(product.price),
      'product:price:currency': product.currency || 'RUB',
      'product:availability': 'instock',
      'product:condition': 'new',
      'twitter:label1': 'Цена',
      'twitter:data1': formatPrice(product.price, product.currency),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  }
}

/**
 * Upgrade an image URL — kept for JSON-LD image array (Schema.org Product).
 * The OG meta tags now use the proxy endpoint instead, but JSON-LD still
 * benefits from upgraded Unsplash URLs for Google Image Search.
 */
function upgradeImageUrl(img: string, publicUrl: string): string {
  // Unsplash — upgrade to 1200px square
  if (img.startsWith('https://images.unsplash.com/')) {
    const baseUrl = img.split('?')[0]
    return `${baseUrl}?w=1200&h=1200&fit=crop&q=80&auto=format`
  }
  // Absolute URL (other CDN) — return as-is
  if (img.startsWith('http://') || img.startsWith('https://')) {
    return img
  }
  // Relative path (/uploads/... or /icons/...) — prefix with public URL
  return `${publicUrl}${img}`
}

// ----------------------------------------------------------------------------
//  Page — server component that fetches data and renders the share page.
// ----------------------------------------------------------------------------
export default async function SharePage({
  params,
}: {
  params: Promise<{ shortId: string }>
}) {
  const { shortId } = await params
  if (!shortId || !/^[A-Za-z0-9]{4,32}$/.test(shortId)) {
    notFound()
  }

  // Resolve the public URL from the request headers — same as in
  // generateMetadata. We need it for JSON-LD absolute image URLs and for
  // passing to the client component (so it can build deep links).
  const h = await headers()
  const headerMap: Record<string, string | string[] | undefined> = {}
  h.forEach((value, key) => { headerMap[key] = value })
  const publicUrl = getPublicUrl({ headers: headerMap })

  const data = await fetchShareData(shortId)
  if (!data) {
    notFound()
  }

  // Override the shareUrl / deepLinkUrl with the request-resolved versions
  // so they always point to the actual deployment URL.
  data.shareUrl = `${publicUrl}/p/${shortId}`
  data.deepLinkUrl = `${publicUrl}/dl/${shortId}`

  // Build JSON-LD structured data (Schema.org Product) for SEO.
  // Google rich results use this to display price/rating/availability in SERP.
  // v25.4 (OG audit): include the /og/<shortId> proxy as the first image so
  // Google Images indexes the branded card, not just the raw Unsplash photo.
  const ogImageUrl = `${publicUrl}/og/${shortId}`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: data.product.title,
    description: data.product.description || undefined,
    image: [ogImageUrl, ...data.product.images.map((img: string) => upgradeImageUrl(img, publicUrl))],
    sku: data.shortId,
    brand: {
      '@type': 'Brand',
      name: '999 — Три девятки',
    },
    offers: {
      '@type': 'Offer',
      url: data.shareUrl,
      priceCurrency: data.product.currency || 'RUB',
      price: data.product.price,
      availability: data.product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
    ...(data.product.rating > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: data.product.rating,
            reviewCount: data.product.reviewsCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  }

  return (
    <>
      <script
        type="application/ld+json"
        // Escape `<` → `\u003c` to prevent `</script>` payload in product
        // titles from breaking out of the JSON-LD script block. JSON.stringify
        // alone does NOT escape `<` (it's a valid character inside strings),
        // so a malicious title like `</script><script>alert(1)</script>`
        // would terminate the LD block and inject arbitrary script.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      {/* v25.7 (TZ ЭТАП 2.9): BreadcrumbList JSON-LD. Google uses this to show
          a breadcrumb trail in SERP instead of the bare URL — improves CTR.
          Mirrors the visual breadcrumb (Home → Catalog → Product). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Главная', item: publicUrl },
              { '@type': 'ListItem', position: 2, name: 'Каталог', item: `${publicUrl}/?view=catalog` },
              { '@type': 'ListItem', position: 3, name: data.product.title, item: data.shareUrl },
            ],
          }).replace(/</g, '\\u003c'),
        }}
      />
      <SharePageClient data={data} appPublicUrl={publicUrl} />
    </>
  )
}

// ----------------------------------------------------------------------------
//  Helpers
// ----------------------------------------------------------------------------

async function fetchShareData(shortId: string) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/share/s/${shortId}`, {
      // Cache for 60s — share pages change rarely (product title/price don't
      // update often). Revalidate keeps the OG tags fresh enough for SEO.
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function formatPrice(value: number, currency = 'RUB'): string {
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}
