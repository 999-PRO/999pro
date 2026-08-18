import type { NextConfig } from "next";
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";
// v25.10 (TV/Smart-TV audit): the /studio/* rewrite was previously hardcoded
// to http://localhost:3001 — fine when frontend + studio run on the same
// host, but BROKEN on Smart TV / any client that loads the frontend from a
// different origin (e.g. https://tri-999.online) because the rewrite target
// `localhost:3001` is unreachable from the TV. We now read STUDIO_URL from
// env so the operator can point it at the studio's public URL.
// Default keeps the old behaviour for local dev / single-host prod.
const STUDIO_URL = process.env.STUDIO_URL || "http://localhost:3001";

// Sandbox preview gateways may proxy pages via iframe from a different origin.
// In dev / preview mode we omit X-Frame-Options and frame-ancestors so the
// preview embedding works. In production set ALLOW_IFRAME=false (or omit
// entirely) to enable strict framing (clickjacking protection).
const isProd = process.env.NODE_ENV === 'production';
const allowIframe = process.env.ALLOW_IFRAME === 'true' || !isProd;

const nextConfig: NextConfig = {
  output: "standalone",
  // v25.0: silence "multiple lockfiles" warning + ensure standalone output
  // lands at .next/standalone/server.js (flat structure). Without this,
  // Next.js may pick a parent directory as the workspace root and nest the
  // standalone output under .next/standalone/path/to/project/.
  turbopack: { root: __dirname },
  typescript: { ignoreBuildErrors: false },
  reactStrictMode: true,
  // v10-dev-origins: allow sandbox preview gateway origins in dev mode so
  // the preview iframe can hot-reload without "Cross-origin access blocked".
  // In production this is a no-op (the field is dev-only).
  allowedDevOrigins: ['*.space-z.ai'],
  // v10-image-optimization: Re-enable next/image optimizer for AVIF/WebP
  // conversion + responsive srcset. The previous "unoptimized: true" was a
  // workaround for sandbox preview issues — but it meant ALL product images
  // (catalog grid: 48 cards) were served as full-size JPEGs (10-20MB on
  // first paint on mobile).
  //
  // Configuration:
  //   • `formats: ['image/avif', 'image/webp']` — AVIF for modern browsers
  //     (~50% smaller than JPEG), WebP fallback for older ones.
  //   • `deviceSizes` — responsive breakpoints for `sizes` attribute.
  //   • `remotePatterns` — allow /uploads/* (proxied to backend via rewrites)
  //     and external CDN origins (Unsplash for seed data, etc.).
  //   • `dangerouslyAllowSVG: false` — block SVG (XSS vector; the upload
  //     route already blocks SVG, this is defense-in-depth).
  //   • `minimumCacheTTL: 3600` — 1h server-side cache for optimized images.
  //
  // In sandbox preview (preview-*.space-z.ai), the optimizer fetches
  // /uploads/* via the rewrite to localhost:4000 — same as before, but now
  // Next.js transcodes to AVIF/WebP on the fly. The first request is slower
  // (transcoding), subsequent requests are cached.
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 3600,
    dangerouslyAllowSVG: false,
    remotePatterns: [
      // v13.0 (audit P0-1 fix): previously allowed ANY hostname with
      // protocol http/https — making /_next/image an open proxy + SSRF
      // vector. An attacker could fetch+transcode arbitrary URLs through
      // your domain (private IPs, internal services). Now restricted to:
      //   - 'localhost' / '127.0.0.1' — backend dev uploads
      //   - 'images.unsplash.com' — seed data
      //   - '*.space-z.ai' — sandbox preview backend
      //   - 'commondatastorage.googleapis.com' — v25.12: test sample videos
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "*.space-z.ai" },
      { protocol: "https", hostname: "commondatastorage.googleapis.com" },
    ],
  },
  // v8-audit-fix: CSP headers for XSS defense-in-depth
  async headers() {
    const baseHeaders: { key: string; value: string }[] = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // v16.8 (Y9) AUDIT-3 A05 fix: Permissions-Policy restricts which browser
      // features the page is allowed to use. We deny everything the app doesn't
      // need, and allow only: camera + microphone (for WebRTC calls),
      // geolocation (for delivery map picker), fullscreen (for media lightbox).
      // This prevents malicious scripts (if XSS slips through CSP) from
      // accessing accelerometer, payment, USB, MIDI, etc.
      {
        key: 'Permissions-Policy',
        value: [
          'camera=(self)',
          'microphone=(self)',
          'geolocation=(self)',
          'fullscreen=(self)',
          'accelerometer=()',
          'autoplay=(self)',
          'clipboard-write=(self)',
          'encrypted-media=(self)',
          'gyroscope=()',
          'magnetometer=()',
          'midi=()',
          'payment=()',
          'picture-in-picture=(self)',
          'publickey-credentials-get=()',
          'screen-wake-lock=(self)',
          'sync-xhr=(self)',
          'usb=()',
          'web-share=(self)',
        ].join(', '),
      },
    ]
    if (isProd) {
      baseHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      })
    }
    if (!allowIframe) {
      baseHeaders.push({ key: 'X-Frame-Options', value: 'SAMEORIGIN' })
    }
    const cspDirectives = [
      "default-src 'self'",
      // v16.8 final: добавлен https://api-maps.yandex.ru для загрузки
      // Яндекс.Карт JS API. 'unsafe-inline' нужен для splash bootstrap
      // и inline-скриптов Yandex Maps (они инжектят стили/скрипты).
      // v16.15: YouTube удалён — больше не нужен в script-src.
      "script-src 'self' 'unsafe-inline' https://api-maps.yandex.ru https://yastatic.net"
        + (isProd ? "" : " 'unsafe-eval'"),  // v18.5: dev-only — React DevTools + Fast Refresh need eval()
      // style-src: Yandex Maps инжектит inline стили для контролов
      "style-src 'self' 'unsafe-inline' https://api-maps.yandex.ru",
      // img-src: тайлы Яндекс.Карт + обложки hitmos/muzjam/Audius/RadioBrowser
      "img-src 'self' data: blob: https: http:",
      // v16.15: media-src — blob: (IndexedDB cache) + https: (hitmos/muzjam/Audius/archive/radio streams)
      "media-src 'self' blob: https:",
      // v9-audit-fix (H-5): tighten CSP connect-src in production to forbid
      // plain-HTTP and plain-WS (downgradable to plaintext). In dev we still
      // allow http:/ws: for localhost + sandbox preview gateway.
      // v16.8 final: добавлены Яндекс-домены для geocode API + tile loading
      isProd
        ? "connect-src 'self' wss: https: https://api-maps.yandex.ru https://geocode-maps.yandex.ru https://*.maps.yandex.net"
        : "connect-src 'self' ws: wss: https: http: https://api-maps.yandex.ru https://geocode-maps.yandex.ru https://*.maps.yandex.net",
      "font-src 'self' data:",
      "object-src 'none'",
      // v34: Films Hub uses native HTML5 <video> for direct streams.
      // For Turkish series (turkru source) some players (Kodik, NewPlay, Militorys)
      // are SPA-only and require iframe fallback — list their domains here.
      "frame-src 'self' https://kodikplayer.com https://*.kodikplayer.com https://kodikapi.com https://*.kodikapi.com https://tuser.online https://*.tuser.online https://*.newplayjj.com https://newplayjj.com https://militorys.net https://*.militorys.net https://videoapi.myvi.ru https://*.myvi.ru https://hdgo.cc https://*.hdgo.cc https://hdvb.online https://*.hdvb.online https://voidboost.cc https://*.voidboost.cc https://alloha.tv https://*.alloha.tv https://videocdn.tv https://*.videocdn.tv https://ortified.ws https://*.ortified.ws https://cdnvideohub.com https://*.cdnvideohub.com https://interkh.com https://*.interkh.com https://vibio.tv https://*.vibio.tv",
      "base-uri 'self'",
    ]
    if (!allowIframe) {
      // v9-audit-fix: S-LOW-028 — use 'none' instead of 'self' for maximum
      // clickjacking protection. The app doesn't iframe itself, so 'self'
      // was unnecessarily permissive.
      cspDirectives.push("frame-ancestors 'none'")
    }
    baseHeaders.push({
      key: 'Content-Security-Policy',
      value: cspDirectives.join('; '),
    })
    return [
      {
        source: '/(.*)',
        headers: baseHeaders,
      },
      // v22 final: Service Worker must NEVER be cached by the browser —
      // otherwise users on the installed PWA never see updates. The browser
      // checks sw.js for byte-differences on every navigation; if the HTTP
      // cache returns a stale copy, the update is silently skipped.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ]
  },
  async rewrites() {
    return [
      // Route all /api/* and /uploads/* and /socket.io/* requests to the backend.
      // This is a SAFETY NET: the frontend's api.ts already adds ?XTransformPort=4000
      // in sandbox mode so the public gateway routes to the backend. But if for any
      // reason the sandbox detection fails (e.g. hostname mismatch, stale build,
      // NEXT_PUBLIC_API_BASE override), this rewrite ensures API calls still reach
      // the backend instead of hitting Next.js with a 404.
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
      { source: '/uploads/:path*', destination: `${BACKEND_URL}/uploads/:path*` },
      { source: '/socket.io/:path*', destination: `${BACKEND_URL}/socket.io/:path*` },
      // v8-audit-fix: socket.io initial handshake is /socket.io/ (no path after).
      // Without this, the WebSocket/polling connection fails and chat doesn't work.
      { source: '/socket.io', destination: `${BACKEND_URL}/socket.io/` },
      { source: '/studio', destination: `${STUDIO_URL}/studio/` },
      { source: '/studio/:path*', destination: `${STUDIO_URL}/studio/:path*` },
    ]
  },
};

export default withBundleAnalyzer(nextConfig);
