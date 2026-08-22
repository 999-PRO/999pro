import { NextResponse } from 'next/server'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

// v25.7 (TZ ЭТАП 2.9): branded home-page OG image. Previously the home page
// used a static phone screenshot (1080x1920 portrait) which crawlers crop
// unpredictably. This endpoint generates a proper 1200x630 landscape card
// with the brand name + tagline, cached for 1 hour.
export async function GET() {
  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#1e3a8a"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <text x="600" y="320" font-family="Arial, sans-serif" font-size="180" font-weight="800"
          fill="#ffffff" text-anchor="middle">999PRO</text>
  </svg>`

  try {
    const buffer = await sharp(Buffer.from(svg))
      .jpeg({ quality: 85, progressive: true })
      .toBuffer()

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    // Sharp may fail in some environments — return a 500 with a clear message.
    return new NextResponse('OG image generation failed', { status: 500 })
  }
}
