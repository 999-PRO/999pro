// ============================================================================
//  OG Image proxy — /og/[shortId]
//  ----------------------------------------------------------------------------
//  WhatsApp / Facebook / Telegram crawlers don't reliably fetch OG images
//  from third-party domains (Unsplash, etc.). They prefer images served from
//  the SAME domain as the share page.
//
//  This endpoint:
//    1. Receives a request for /og/<shortId>
//    2. Looks up the ShareLink → Product → first image URL
//    3. Fetches the image (from Unsplash, /uploads/, or any CDN)
//    4. Re-encodes it as JPEG (1200×1200, quality 88) using Sharp
//
//  v25.10 (3:4 no-crop rewrite):
//  Previously this endpoint cover-cropped the source to a 1200×1200 square —
//  vertical (3:4) product photos lost their top edge (slogan, brand,
//  composition). Now we use a "letterbox with blurred background" layout:
//
//    1. Background layer: the source image, resized to COVER 1200×1200,
//       heavily blurred + darkened — fills the entire canvas so there's no
//       ugly white border.
//    2. Foreground layer: the SAME source image, resized to CONTAIN within
//       1200×1200 (no crop) — the original 3:4 photo is shown in full.
//    3. Composite foreground on top of background.
//
//  Result: a 1200×1200 canvas (WhatsApp/Twitter/FB compatible) where the
//  original 3:4 product photo is fully visible (no content lost), on a
//  branded-blurred background. Modern marketplaces (Instagram, YouTube,
//  Spotify) use the same technique for share cards.
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

    // v25.10 (3:4 no-crop rewrite):
    // 1. BACKGROUND — source resized to COVER 1200×1200, blurred, darkened.
    //    This fills the entire canvas with a branded-looking backdrop so
    //    there's no ugly white letterbox border.
    // 2. FOREGROUND — source resized to CONTAIN 1200×1200 (no crop). The
    //    original 3:4 product photo is shown in full — nothing is lost.
    // 3. Composite foreground on top of background.
    //
    // Canvas stays 1200×1200 (1:1) — recommended minimum for WhatsApp/FB OG
    // images, and the aspect ratio WhatsApp displays natively in chat
    // previews (no additional cropping by the crawler).
    const CANVAS = 1200

    // Background: cover + blur + darken
    const bg = await sharp(imgBuffer)
      .resize(CANVAS, CANVAS, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: false,
      })
      .blur(28) // heavy gaussian blur — turns any image into a soft gradient
      .modulate({ brightness: 0.55, saturation: 1.1 }) // darken + slight saturate
      .jpeg({ quality: 80 })
      .toBuffer()

    // Foreground: contain (no crop) — original 3:4 photo fully visible.
    // PNG preserves alpha so transparent padding stays transparent — JPEG
    // would fill transparency with white, creating an ugly rectangle that
    // hides the blurred background. We composite this PNG onto the JPEG
    // background below, then re-encode the final composite as JPEG.
    const fg = await sharp(imgBuffer)
      .resize(CANVAS, CANVAS, {
        fit: 'contain',
        position: 'center',
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent padding
        withoutEnlargement: false,
      })
      .png({ quality: 90, compressionLevel: 6 })
      .toBuffer()

    // Composite foreground (PNG with alpha) on top of background (JPEG).
    // Sharp handles the alpha blending correctly when the top layer has
    // an alpha channel and the bottom doesn't.
    const processed = await sharp(bg)
      .composite([
        {
          input: fg,
          gravity: 'center',
          blend: 'over',
        },
      ])
      .jpeg({ quality: 88, progressive: true })
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
