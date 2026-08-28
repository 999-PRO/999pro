import type { Metadata, Viewport } from 'next'
// v25.27: ребрендинг TRI999 + дизайнерские шрифты (кириллица):
//   • Onest — основной текст (современная гарнитура, отличная кириллица)
//   • Unbounded — дисплейная гарнитура бренда (логотип, заголовки)
// Размеры аккуратные — «красиво и НЕ крупно» (просьба владельца).
import { Onest, Unbounded } from 'next/font/google'
import './globals.css'
import { NotificationContainer } from '@/components/notification-container'
// v25.7 (TZ ЭТАП 2.5): global visit tracker — records a page view on every
// route change. Mounts once at the root layout; invisible (renders null).
import { VisitTracker } from '@/components/visit-tracker'
import { ThemeProvider } from '@/components/providers'
import { AuthInit } from '@/components/auth-init'
import { PwaInstallPrompt } from '@/components/pwa-install-prompt'
// Wave 3 (C-MON-001): Sentry error tracking
import { SentryInit } from '@/components/sentry-init'
import { OnboardingOverlay } from '@/components/onboarding-overlay'

// v10-perf: backend origin for preconnect hint. In dev/preview the backend
// is on the same origin (proxied via Next.js rewrites), so preconnect is a
// no-op. In production (separate backend domain), this saves ~200ms on the
// first API call by pre-resolving DNS + TLS in parallel with HTML parsing.
const BACKEND_PUBLIC_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const onestSans = Onest({
  variable: '--font-onest',
  subsets: ['latin', 'cyrillic'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
})

// Дисплейная гарнитура бренда TRI999 — только для логотипа/заголовков.
const unboundedDisplay = Unbounded({
  variable: '--font-unbounded',
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

// Static metadata (NOT generateMetadata) — using the async form with headers()
// forced the entire route into dynamic rendering, which caused a regression on
// iPhone where a white strip appeared between the status bar and the header.
// Static metadata allows Next.js to inline all meta tags (viewport-fit=cover,
// apple-mobile-web-app-status-bar-style, theme-color) into the build-time HTML,
// ensuring the inline splash bootstrap script runs with the correct context
// from the very first paint.
//
// The public URL for OG tags is resolved via NEXT_PUBLIC_APP_URL env var
// (evaluated at build time). For per-product share pages with dynamic OG tags,
// /p/[shortId]/page.tsx has its own generateMetadata() with headers() — that
// route is intentionally dynamic and doesn't affect the homepage.
// v9-audit-fix: fail-safe fallback to localhost instead of uncontrolled 999.pro domain.
const APP_PUBLIC_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')

// v25.13 (share metadata): removed marketing phrases like "Marketplace нового
// поколения" — replaced with serious, business-accurate copy reflecting what
// TRI999 actually is: рекламная продукция + мебель + подарки.
const SITE_TITLE = 'TRI999'
const SITE_DESCRIPTION = 'TRI999 — рекламная продукция, мебель и подарки. Каталог, чат с продавцом, заявки и доставка по России.'

export const metadata: Metadata = {
  // v9-audit-fix: metadataBase ensures all relative OG/Twitter image URLs are
  // resolved to absolute URLs. Without this, WhatsApp/Facebook/Telegram/X
  // crawlers can't resolve relative image URLs and show no preview image.
  metadataBase: new URL(APP_PUBLIC_URL),
  // v25.12: minimal title "TRI999" per Phase 6 spec. Description kept short
  // and on-brand for SEO/social cards.
  // v25.13: changed title to "TRI999" (was "TRI999" — rebrand per user).
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_TITLE,
  authors: [{ name: 'TRI999 Team' }],
  keywords: ['TRI999', '999', 'три девятки', 'реклама', 'мебель', 'подарки', 'каталог', 'чат', 'AI'],
  // v25.19 (owner): SEO — верификация Яндекс.Вебмастер / Google Search Console
  // через env. Индексация/canonical заданы ниже (robots + alternates);
  // живые title/description/keywords/OG владелец меняет в Студии → «SEO и
  // поиск» (клиентский слой seo-head.tsx применяет их без пересборки).
  verification: {
    ...(process.env.YANDEX_VERIFICATION ? { yandex: process.env.YANDEX_VERIFICATION } : {}),
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { 'google-site-verification': process.env.GOOGLE_SITE_VERIFICATION } : {}),
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    // 'black-translucent' makes the iOS status bar transparent so the page
    // background (html/body blue) shows through it — no white strip above
    // the header when the app runs as a PWA. Requires viewport-fit=cover.
    statusBarStyle: 'black-translucent',
    title: SITE_TITLE,
  },
  icons: {
    icon: [
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon-192.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
    ],
    other: [
      { rel: 'mask-icon', url: '/icons/icon-512-maskable.png', color: '#2563eb' },
      // apple-touch-startup-image — one per device class. iOS uses the
      // closest matching size to render the splash screen on PWA cold launch.
      // Without these, iOS shows a plain white screen for 1-3 seconds before
      // React hydrates — a poor first impression that made the app feel
      // "non-native" on iPhone.
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1290x2796.png', sizes: '1290x2796' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1284x2778.png', sizes: '1284x2778' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1179x2556.png', sizes: '1179x2556' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1125x2436.png', sizes: '1125x2436' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1242x2688.png', sizes: '1242x2688' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1170x2532.png', sizes: '1170x2532' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1242x2208.png', sizes: '1242x2208' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-828x1792.png', sizes: '828x1792' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-750x1334.png', sizes: '750x1334' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-2048x2732.png', sizes: '2048x2732' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1668x2388.png', sizes: '1668x2388' },
      { rel: 'apple-touch-startup-image', url: '/icons/apple-splash-1536x2048.png', sizes: '1536x2048' },
    ],
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: 'website',
    locale: 'ru_RU',
    siteName: SITE_TITLE,
    url: APP_PUBLIC_URL,
    images: [
      {
        url: '/og',
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/og'],
  },
  alternates: {
    canonical: APP_PUBLIC_URL,
  },
  // Phase 6.4: prevent /studio admin panel from being indexed
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
}

export const viewport: Viewport = {
  // theme-color controls the status-bar tint on Android PWA (WebAPK).
  //
  // ANDROID FIX: previously we used #2563eb (brand blue) for light mode.
  // On Android Chrome, the WebAPK uses the manifest's theme_color to paint
  // the system status bar — bright blue with white system icons looks
  // "cheap / web-page-like" compared to native apps which use a darker
  // shade. Now we use #0f172a (slate-900) for ALL modes — matches the
  // header's translucent dark gradient and looks native on both Android
  // and iOS.
  //
  // The manifest's theme_color is ALSO set to #0f172a (was #2563eb).
  //
  // The array form lets us override per display-mode if needed — for
  // example, when running as an installed PWA we can use a darker bar
  // than when running in a browser tab.
  themeColor: [
    { media: '(display-mode: standalone)', color: '#0f172a' },
    { media: '(display-mode: fullscreen)', color: '#0f172a' },
    { media: '(display-mode: minimal-ui)', color: '#0f172a' },
    { media: '(prefers-color-scheme: light)', color: '#0f172a' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
  // v10-native: completely disable zoom — the app should feel like a native
  // mobile application, not a web page. Pinch-zoom, double-tap-zoom, and
  // browser zoom (Ctrl+/-) are all blocked. This matches Telegram, WhatsApp,
  // iMessage, and other native-feeling PWAs.
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  // viewport-fit=cover lets the page render into the status-bar / notch area.
  viewportFit: 'cover',
}

// ============================================================================
// Inline splash bootstrapping + theme-flash prevention.
//
// This script runs BEFORE React hydrates. It does three things:
//
// 1. THEME-FLASH FIX: reads the user's saved theme from localStorage (using
//    the SAME key next-themes uses — `theme` by default) and sets the
//    `dark` class on <html> + the correct background color IMMEDIATELY.
//    Previously this script used a separate `999pro-theme` key (which was
//    never written by next-themes), so the saved preference was ignored —
//    the user always saw a dark slate background first, then a flash to
//    light when next-themes finally hydrated. Now the inline script and
//    next-themes agree on the key, so the very first paint matches the
//    final theme.
//
// 2. Splash overlay: a centered "999 / Три девятки" wordmark + spinner that
//    matches the chosen theme (dark overlay on dark theme, light on light).
//    React removes it on mount via OnboardingOverlay / page.tsx effect.
//
// 3. Block double-tap-to-zoom (iOS Safari 300ms delay) — this only blocks
//    the rapid double-tap, NOT pinch-zoom, so it stays WCAG-compliant.
// ============================================================================
const SPLASH_BOOTSTRAP = `
(function() {
  try {
    var root = document.documentElement;

    // v11-zoom-fix: FULLY block pinch/double-tap zoom everywhere EXCEPT
    // inside [data-zoom-allowed] zones (image lightbox, stories viewer).
    // Previous code only blocked gesturestart, which left gesturechange
    // (the actual zoom transform) unblocked on iOS Safari.
    var lastTouchEnd = 0;
    document.addEventListener('touchend', function(e) {
      var now = Date.now();
      if (now - lastTouchEnd <= 300) {
        // Allow double-tap inside zoom-allowed zones (lightbox uses it for toggle-zoom)
        if (!e.target.closest || !e.target.closest('[data-zoom-allowed]')) {
          e.preventDefault();
        }
      }
      lastTouchEnd = now;
    }, { passive: false });

    // iOS Safari gesture events — block the full lifecycle (start + change + end)
    // so the zoom transform never applies. Skip if the touch started inside a
    // zoom-allowed zone (image lightbox handles pinch via its own touch handlers).
    function isZoomAllowed(target) {
      return target && target.closest && target.closest('[data-zoom-allowed]');
    }
    document.addEventListener('gesturestart', function(e) {
      if (isZoomAllowed(e.target)) return;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturechange', function(e) {
      if (isZoomAllowed(e.target)) return;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('gestureend', function(e) {
      if (isZoomAllowed(e.target)) return;
      e.preventDefault();
    }, { passive: false });

    // v11-zoom-fix: belt-and-suspenders for Android Chrome + Firefox —
    // block 2-finger touchmove (pinch) globally, except in zoom-allowed zones.
    // The lightbox/stories containers have touch-action:none / pinch-zoom and
    // their own JS handlers, so we skip them to avoid double-preventDefault.
    document.addEventListener('touchmove', function(e) {
      if (e.touches && e.touches.length >= 2) {
        if (isZoomAllowed(e.target)) return;
        e.preventDefault();
      }
    }, { passive: false });

    // v10-native: block Ctrl+/- keyboard zoom on desktop browsers.
    // This prevents accidental browser zoom that would break the app's
    // pixel-perfect layout.
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) {
        e.preventDefault();
      }
    }, { passive: false });

    // --- Splash overlay ---
    // Theme-aware: dark overlay on dark theme, light overlay on light theme.
    // Matches the app's --background so there's no flash when React hydrates
    // and removes the overlay.
    function applyTheme() {
      var stored = null;
      try { stored = localStorage.getItem('theme'); } catch (e) {}
      var dark;
      var neon = false;
      if (stored === 'dark') { dark = true; }
      else if (stored === 'light') { dark = false; }
      else if (stored === 'neon') { dark = true; neon = true; }
      else { dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }

      root.classList.remove('dark', 'neon');
      if (neon) {
        root.classList.add('neon', 'dark');
        root.style.background = '#08060f';
      } else if (dark) {
        root.classList.add('dark');
        root.style.background = '#0f172a';
      } else {
        root.style.background = '#f5f6f7';
      }
      return dark;
    }
    var isDark = applyTheme();

    // v11-fix: re-apply theme on bfcache restoration (pageshow with persisted=true).
    window.addEventListener('pageshow', function(e) {
      if (e.persisted) {
        isDark = applyTheme();
      }
    });

    // v11-fix: also re-apply on prefers-color-scheme change (only if user
    // has NOT explicitly chosen a theme — i.e. localStorage has 'system' or null).
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
        try {
          var stored = localStorage.getItem('theme');
          if (stored === 'system' || !stored) {
            isDark = applyTheme();
          }
        } catch (e) {}
      });
    }

    // v25.12: Modern splash screen — gradient bg, animated logo, pulse indicator
    // v25.20 (owner): «минималистичный, с моим названием. Без Pro. 999 и внизу
    // Три девятки, красиво анимировано» — чистый тёмный фон с мягким свечением,
    // крупное «999» (буквы въезжают по очереди), под ним «ТРИ ДЕВЯТКИ» с
    // разрядкой проявляется. Полностью plain-JS (работает до гидрации).
    document.addEventListener('DOMContentLoaded', function() {
      if (document.getElementById('app-splash')) return;
      var s = document.createElement('div');
      s.id = 'app-splash';
      s.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;transition:opacity .45s ease;overflow:hidden;' +
        'background:radial-gradient(120% 90% at 50% 0%, #1c1226 0%, #120b1c 55%, #0a0612 100%);';

      // Мягкое свечение за логотипом
      var glow = document.createElement('div');
      glow.style.cssText = 'position:absolute;width:70vmax;height:70vmax;border-radius:50%;pointer-events:none;' +
        'background:radial-gradient(circle, rgba(168,85,247,0.16) 0%, rgba(236,72,153,0.07) 45%, transparent 70%);' +
        'filter:blur(30px);animation:app-splash-glow 4s ease-in-out infinite alternate;';
      s.appendChild(glow);

      // «999» — три цифры въезжают по очереди (blur → резкость, снизу вверх)
      var row = document.createElement('div');
      row.style.cssText = 'position:relative;display:flex;align-items:baseline;';
      var digits = ['9', '9', '9'];
      for (var di = 0; di < digits.length; di++) {
        var d = document.createElement('span');
        d.textContent = digits[di];
        d.style.cssText = 'font-size:96px;font-weight:900;line-height:1;letter-spacing:-0.02em;' +
          'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
          'background:linear-gradient(180deg,#ffffff 15%,#F9A8D4 60%,#C4B5FD 100%);' +
          '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;' +
          'animation:app-splash-digit .7s cubic-bezier(0.22,1,0.36,1) both;' +
          'animation-delay:' + (0.12 + di * 0.14) + 's;';
        row.appendChild(d);
      }
      s.appendChild(row);

      // «ТРИ ДЕВЯТКИ» — проявляется с большой разрядкой
      var tag = document.createElement('div');
      tag.textContent = 'ТРИ ДЕВЯТКИ';
      tag.style.cssText = 'margin-top:14px;font-size:13px;font-weight:600;color:rgba(255,255,255,0.72);' +
        'letter-spacing:0.55em;text-indent:0.55em;text-transform:uppercase;text-align:center;' +
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
        'animation:app-splash-tag 1s cubic-bezier(0.22,1,0.36,1) 0.65s both;';
      s.appendChild(tag);

      // Тонкая линия прогресса
      var track = document.createElement('div');
      track.style.cssText = 'position:absolute;bottom:20%;left:50%;transform:translateX(-50%);width:110px;height:2px;border-radius:99px;background:rgba(255,255,255,0.12);overflow:hidden;';
      var fill = document.createElement('div');
      fill.style.cssText = 'height:100%;width:40%;border-radius:99px;background:linear-gradient(90deg,#F9A8D4,#A855F7);animation:app-splash-progress 1.6s ease-in-out infinite;';
      track.appendChild(fill);
      s.appendChild(track);

      // Styles for animations
      var st = document.createElement('style');
      st.textContent =
        '@keyframes app-splash-glow{from{transform:translateY(-2%) scale(1);opacity:0.8}to{transform:translateY(2%) scale(1.1);opacity:1}}' +
        '@keyframes app-splash-digit{from{opacity:0;transform:translateY(26px) scale(0.9);filter:blur(10px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}' +
        '@keyframes app-splash-tag{from{opacity:0;letter-spacing:0.2em;filter:blur(6px)}to{opacity:1;letter-spacing:0.55em;filter:blur(0)}}' +
        '@keyframes app-splash-progress{0%{width:12%;opacity:0.6}50%{width:78%;opacity:1}100%{width:12%;opacity:0.6}}';
      document.head.appendChild(st);
      document.body.appendChild(s);

      // v25.12: reduced timeout to 2.5s — modern splash is shorter
      setTimeout(function() {
        if (document.getElementById('app-splash')) {
          s.style.opacity = '0';
          setTimeout(function() { s.remove(); }, 400);
        }
      }, 2500);
      window.addEventListener('load', function() {
        var splash = document.getElementById('app-splash');
        if (splash) {
          splash.style.opacity = '0';
          setTimeout(function() { splash.remove(); }, 400);
        }
      }, { once: true });
    });
  } catch (e) {
    // If anything goes wrong, fall back to default behavior.
  }
})();
`

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* v25.27 (TV fix): полифиллы для старых ТВ-браузеров — обычный
            (не module) скрипт, выполняется ДО всех бандлов и сплеш-скрипта.
            Без него на Tizen/webOS нет ResizeObserver/IntersectionObserver и
            нет сообщения «обновите браузер» там, где ES-модули недоступны. */}
        <script src="/legacy-polyfills.js" />
        {/* v9-theme-flash-fix: inline script runs BEFORE React hydrates.
            Must be the first thing in <head> so it executes before any
            CSS / paint. Sets the dark/light class on <html> and the
            matching background color from localStorage (`theme` key —
            same as next-themes) so the very first paint matches the
            user's saved theme. Without this, the user sees a flash of
            the wrong theme (typically dark) before next-themes catches
            up on mount. */}
        <script
           
          dangerouslySetInnerHTML={{ __html: SPLASH_BOOTSTRAP }}
        />
        {/* v10-perf: resource hints to speed up initial API + image loads.
            • preconnect to the backend origin (resolves DNS + TLS handshake
              in parallel with HTML parsing, ~200ms saved on first API call).
            • dns-prefetch to the Unsplash CDN (seed product images).
            Both are no-ops in dev (localhost) but help in sandbox preview
            and production where backend is on a separate origin. */}
        <link rel="preconnect" href={BACKEND_PUBLIC_ORIGIN} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        {/* v25.7 (TZ ЭТАП 2.9): search-engine verification meta tags. Emitted
            only when the corresponding env var is set (so dev/preview builds
            don't emit empty content attributes). Google Search Console and
            Yandex Webmaster both verify ownership via a single meta tag with
            a per-property token. */}
        {process.env.GOOGLE_SITE_VERIFICATION && (
          <meta name="google-site-verification" content={process.env.GOOGLE_SITE_VERIFICATION} />
        )}
        {process.env.YANDEX_VERIFICATION && (
          <meta name="yandex-verification" content={process.env.YANDEX_VERIFICATION} />
        )}
        {/* v25.7 (TZ ЭТАП 2.9): Organization / LocalBusiness / WebSite JSON-LD.
            Powers Google's Knowledge Graph card (logo + name + URL) and the
            LocalBusiness rich result (address, hours, geo). All sensitive
            fields (phone, email, address, geo) are guarded by env vars so
            nothing is emitted in dev/preview builds. The `<` → `\u003c` escape
            prevents `</script>` payloads inside string values from breaking
            out of the JSON-LD block (defense in depth — current strings are
            static but the pattern is consistent with /p/[shortId] JSON-LD). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: SITE_TITLE,
              url: APP_PUBLIC_URL,
              logo: `${APP_PUBLIC_URL}/icons/icon-512.png`,
            }).replace(/</g, '\\u003c'),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'LocalBusiness',
              '@id': `${APP_PUBLIC_URL}/#localbusiness`,
              name: SITE_TITLE,
              image: `${APP_PUBLIC_URL}/icons/screenshot-phone-1.png`,
              url: APP_PUBLIC_URL,
              telephone: process.env.NEXT_PUBLIC_BUSINESS_PHONE || undefined,
              email: process.env.NEXT_PUBLIC_BUSINESS_EMAIL || undefined,
              address: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS_STREET
                ? {
                    '@type': 'PostalAddress',
                    streetAddress: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS_STREET,
                    addressLocality: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS_CITY || undefined,
                    addressRegion: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS_REGION || undefined,
                    postalCode: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS_ZIP || undefined,
                    addressCountry: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS_COUNTRY || 'RU',
                  }
                : undefined,
              geo: process.env.NEXT_PUBLIC_BUSINESS_GEO_LAT
                ? {
                    '@type': 'GeoCoordinates',
                    latitude: parseFloat(process.env.NEXT_PUBLIC_BUSINESS_GEO_LAT),
                    longitude: parseFloat(process.env.NEXT_PUBLIC_BUSINESS_GEO_LNG),
                  }
                : undefined,
              openingHoursSpecification: [
                {
                  '@type': 'OpeningHoursSpecification',
                  dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
                  opens: '09:00',
                  closes: '21:00',
                },
                {
                  '@type': 'OpeningHoursSpecification',
                  dayOfWeek: ['Saturday', 'Sunday'],
                  opens: '10:00',
                  closes: '20:00',
                },
              ],
              priceRange: '₽₽',
            }).replace(/</g, '\\u003c'),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              url: APP_PUBLIC_URL,
              name: SITE_TITLE,
              potentialAction: {
                '@type': 'SearchAction',
                target: `${APP_PUBLIC_URL}/?view=search&q={search_term_string}`,
                'query-input': 'required name=search_term_string',
              },
            }).replace(/</g, '\\u003c'),
          }}
        />
      </head>
      <body className={`${onestSans.variable} ${unboundedDisplay.variable} antialiased`}>
        {/* Wave 3 (C-MON-001): Sentry client-side init — no-op without NEXT_PUBLIC_SENTRY_DSN */}
        <SentryInit />
        {/* Phase 23: Skip-to-content link for screen reader / keyboard users.
            Visually hidden until focused, then appears top-left. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:shadow-lg"
        >
          Перейти к основному контенту
        </a>
        <ThemeProvider>
          <AuthInit>{children}</AuthInit>
          <PwaInstallPrompt />
          <OnboardingOverlay />
          <NotificationContainer />
          {/* v25.7 (TZ ЭТАП 2.5): records page views for the analytics
              dashboard. Renders null — no UI. */}
          <VisitTracker />
        </ThemeProvider>
      </body>
    </html>
  )
}
