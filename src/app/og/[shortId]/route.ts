// ============================================================================
//  OG Image proxy — /api/og-image/[shortId]
//  ----------------------------------------------------------------------------
//  WhatsApp / Facebook / Telegram crawlers don't reliably fetch OG images
//  from third-party domains (Unsplash, etc.). They prefer images served from
//  the SAME domain as the share page.
//
//  This endpoint:
//    1. Receives a request for /api/og-image/<shortId>
//    2. Looks up the ShareLink → Product → first image URL
//    3. Fetches the image (from Unsplash, /uploads/, or any CDN)
//    4. Re-encodes it as JPEG (1200×1200, quality 85) using Sharp
//    5. Returns it with long-lived cache headers
//
//  The share page's og:image meta tag points to this endpoint, so crawlers
//  always see an image from OUR domain — reliable preview in WhatsApp.
//
//  Performance: response is cached with Cache-Control: public, max-age=86400
//  (24h). Next.js also caches the fetch result with revalidate: 3600.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

// ============================================================================
// P-HIGH-006: SSRF guard for the OG image proxy.
// ----------------------------------------------------------------------------
// Without this guard, anyone who can create a share page (i.e. any logged-in
// seller) could set their product's `images[0]` to `http://169.254.169.254/...`
// (AWS / GCP metadata endpoint) or `http://10.0.0.1/admin` and use the OG
// proxy as an oracle to read internal-network responses. The proxy then
// returns the bytes as a JPEG — an attacker can't read text directly, but
// timing + size side-channels leak information.
//
// `isPublicUrl` rejects:
//   - non-http(s) schemes (file://, data:, gopher:, etc.)
//   - localhost / 127.0.0.1 / 0.0.0.0 hostnames
//   - RFC1918 private ranges (10.x, 192.168.x, 172.16-31.x)
//   - link-local 169.254.x
//   - hostnames that resolve to any of the above
// It accepts raw IPs only if they're public v4/v6.
// ============================================================================
async function isPublicUrl(urlStr: string): Promise<boolean> {
  try {
    const u = new URL(urlStr)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const hostname = u.hostname
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return false
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(hostname)) return false
    // If the hostname is already a literal IP, validate it directly.
    // node:net.isIP returns 0 (invalid) | 4 (IPv4) | 6 (IPv6).
    const ipVersion = isIP(hostname)
    if (ipVersion !== 0) return ipVersion === 4 || ipVersion === 6
    // Otherwise resolve via DNS and check the resolved address.
    const addr = await lookup(hostname)
    const ip = addr.address
    if (ip === '127.0.0.1' || ip === '::1') return false
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(ip)) return false
    return true
  } catch {
    return false
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shortId: string }> },
) {
  const { shortId } = await params

  // Validate shortId format (same as share page)
  if (!shortId || !/^[A-Za-z0-9]{4,32}$/.test(shortId)) {
    return new NextResponse('Invalid shortId', { status: 400 })
  }

  try {
    // Fetch product data from backend
    const res = await fetch(`${BACKEND_URL}/api/share/s/${shortId}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) {
      return new NextResponse('Product not found', { status: 404 })
    }
    const data = await res.json()
    const imageUrl = data?.product?.images?.[0]
    if (!imageUrl) {
      return new NextResponse('No image', { status: 404 })
    }

    // P-HIGH-006: SSRF guard. Reject private/loopback URLs before fetching.
    if (!(await isPublicUrl(imageUrl))) {
      return new NextResponse('Invalid image URL', { status: 400 })
    }

    // Fetch the actual image bytes
    const imgRes = await fetch(imageUrl, {
      // Some CDNs (Unsplash) require a User-Agent, else they 403.
      headers: {
        'User-Agent': '999-OGImageBot/1.0',
        Accept: 'image/*',
      },
    })
    if (!imgRes.ok) {
      return new NextResponse('Image fetch failed', { status: 502 })
    }
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer())

    // Re-encode with Sharp: resize to 1200×1200 cover, JPEG q85.
    // 1200×1200 is the recommended minimum for OG images (WhatsApp/Facebook).
    // JPEG keeps file size small (~100-200 KB) for fast crawler fetch.
    // Note: withoutEnlargement is FALSE — we DO want to upscale smaller
    // source images (e.g. 800×533 Unsplash previews) to 1200×1200, because
    // WhatsApp rejects OG images smaller than 1200px.
    const processed = await sharp(imgBuffer)
      .resize(1200, 1200, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: false,
      })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer()

    // Return with long-lived cache. Crawlers respect Cache-Control and
    // won't re-fetch the same URL for 24h, reducing server load.
    return new NextResponse(processed, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(processed.length),
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
        // Allow cross-origin read so the share page's <img> can display it
        // (for the user-visible preview in the share page gallery).
        'Access-Control-Allow-Origin': '*',
        // Don't allow MIME sniffing
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    console.error('[OG image proxy] Error:', err)
    return new NextResponse('Internal error', { status: 500 })
  }
}
