import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { NotificationContainer } from '@/components/notification-container'
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

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
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

export const metadata: Metadata = {
  // v9-audit-fix: metadataBase ensures all relative OG/Twitter image URLs are
  // resolved to absolute URLs. Without this, WhatsApp/Facebook/Telegram/X
  // crawlers can't resolve relative image URLs and show no preview image.
  metadataBase: new URL(APP_PUBLIC_URL),
  // v12.6: minimal title "999 Store" per Phase 6 spec. Description kept short
  // and on-brand for SEO/social cards.
  title: '999 — Три девятки',
  description: '999 — Три девятки. Современный маркетплейс товаров и услуг с голосовым AI-агентом.',
  applicationName: '999 — Три девятки',
  authors: [{ name: 'Три девятки Team' }],
  keywords: ['999', 'Три девятки', 'маркетплейс', 'магазин', 'каталог', 'чат', 'AI'],
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    // 'black-translucent' makes the iOS status bar transparent so the page
    // background (html/body blue) shows through it — no white strip above
    // the header when the app runs as a PWA. Requires viewport-fit=cover.
    statusBarStyle: 'black-translucent',
    title: '999 — Три девятки',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon-192.svg', type: 'image/svg+xml' },
    ],
    apple: '/icons/apple-touch-icon.png',
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
    title: '999 — Три девятки',
    description: '999 — Три девятки. Современный маркетплейс товаров и услуг с голосовым AI-агентом.',
    type: 'website',
    locale: 'ru_RU',
    siteName: '999 — Три девятки',
    url: APP_PUBLIC_URL,
    images: [
      {
        url: '/icons/screenshot-phone-1.png',
        width: 1080,
        height: 1920,
        alt: '999 — Три девятки. Маркетплейс нового поколения.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '999 — Три девятки',
    description: 'Современный маркетплейс товаров и услуг с голосовым AI-агентом.',
    images: ['/icons/screenshot-phone-1.png'],
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

    // Splash overlay is created on DOMContentLoaded using the resolved isDark.
    document.addEventListener('DOMContentLoaded', function() {
      if (document.getElementById('app-splash')) return;
      var stored2 = null;
      try { stored2 = localStorage.getItem('theme'); } catch (e) {}
      var isNeon = stored2 === 'neon';
      var bg = isNeon ? '#08060f' : (isDark ? '#0f172a' : '#f5f6f7');
      var fg = isDark ? '#ffffff' : '#0f172a';
      var sub = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.85)';
      var spinnerTrack = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.15)';
      var spinnerTop = isNeon ? '#8b5cf6' : '#3b82f6';

      var s = document.createElement('div');
      s.id = 'app-splash';
      s.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:' + bg + ';z-index:9999;transition:opacity .3s ease;';
      // Splash logo: «999» крупно + «Три девятки» под ним.
      var logo = document.createElement('div');
      logo.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;line-height:1;color:' + fg + ';font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
      var logoNum = document.createElement('div');
      logoNum.style.cssText = 'font-size:48px;font-weight:800;letter-spacing:-0.02em;';
      logoNum.textContent = '999';
      var logoWord = document.createElement('div');
      logoWord.style.cssText = 'font-size:12px;font-weight:300;letter-spacing:0.2em;text-transform:uppercase;opacity:0.65;';
      logoWord.textContent = 'Три девятки';
      logo.appendChild(logoNum);
      logo.appendChild(logoWord);
      s.appendChild(logo);
      var sp = document.createElement('div');
      sp.style.cssText = 'position:absolute;bottom:25%;width:36px;height:36px;border:3px solid ' + spinnerTrack + ';border-top-color:' + spinnerTop + ';border-radius:50%;animation:app-splash-spin .8s linear infinite;';
      s.appendChild(sp);
      var st = document.createElement('style');
      st.textContent = '@keyframes app-splash-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(st);
      document.body.appendChild(s);
      // v11-fix: reduced splash timeout from 8000ms to 3000ms.
      // The 8s timeout was a fallback for when React failed to hydrate,
      // but it caused users to see the splash for too long on slow 3G.
      // 3s is enough — if React hasn't mounted by then, something is wrong.
      //
      // v13.1 (audit P0-2 fix): also remove the splash on window.load so
      // non-Home routes (/p/[shortId], /dl/[shortId], /og/...) don't show
      // the splash for the full 3s when their React tree already mounted.
      // Previously the splash was only removed by Home's mount effect; on
      // share pages users saw a spinner over a fully rendered page.
      setTimeout(function() {
        if (document.getElementById('app-splash')) {
          s.style.opacity = '0';
          setTimeout(function() { s.remove(); }, 300);
        }
      }, 3000);
      // window.load fires after all resources finish loading — by then
      // React has definitely hydrated on any route. Remove splash immediately.
      window.addEventListener('load', function() {
        var splash = document.getElementById('app-splash');
        if (splash) {
          splash.style.opacity = '0';
          setTimeout(function() { splash.remove(); }, 300);
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
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
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
        </ThemeProvider>
      </body>
    </html>
  )
}
