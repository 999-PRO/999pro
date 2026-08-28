'use client'

// ============================================================================
//  SharePageClient — /p/[shortId]
//  ----------------------------------------------------------------------------
//  v25.10 (Deep-link architecture rewrite):
//
//  This file used to render a STANDALONE product share page (gallery, price,
//  3 CTAs, related, reviews, share stats). That violated the deep-link
//  architecture: users clicking a shared link landed on a DIFFERENT UI than
//  the in-app Product Viewer, breaking the "link → app → existing viewer"
//  contract.
//
//  NEW behaviour:
//    1. Server (page.tsx) still renders full OG/Twitter/JSON-LD meta tags —
//       crawlers (WhatsApp, Telegram, FB, X, iMessage) read these WITHOUT
//       executing JS, so the rich link preview still works.
//    2. This client component renders a minimal branded splash
//       ("Открываем товар в TRI999…") and IMMEDIATELY redirects to
//       /?product=<id> — the SPA opens the SAME Product Viewer that users
//       see when they tap a product card inside the app.
//    3. PWA installed: the OS-level Universal Link (iOS) / App Link (Android)
//       intercepts the click on the shared URL and opens the installed app
//       directly — the SPA receives ?product=<id> and opens the viewer.
//    4. PWA not installed: the browser loads /p/<shortId>, JS redirects to
//       /?product=<id>, the SPA opens the Product Viewer in the browser.
//    5. <noscript> fallback link for users with JS disabled (very rare, but
//       preserves accessibility).
//
//  IMPORTANT: do NOT add visible product UI here. The visible product UI is
//  the SPA's ProductPage / ProductPageDesktop component, opened via the
//  deep link. This page is a redirect shim with crawler-friendly OG meta.
// ============================================================================

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ExternalLink } from 'lucide-react'
import type { SharePageData } from '@999pro/shared'
import { formatPrice } from '@/lib/format'
import { api } from '@/lib/api'

interface Props {
  data: SharePageData
  appPublicUrl: string
}

export function SharePageClient({ data, appPublicUrl }: Props) {
  const { product, shortId } = data
  const [redirecting, setRedirecting] = useState(true)

  // ---------------------------------------------------------------------------
  // Auto-redirect to the SPA deep link on mount.
  // We use a short delay (300ms) so the splash is visible — the user sees a
  // branded transition instead of a blank flash — and so the `app_open`
  // tracking call has time to fire before we navigate away.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Track the app_open attempt — the backend records this even if the
    // app isn't installed (we can't know if it opened).
    const urlParams = new URLSearchParams(window.location.search)
    const ref = urlParams.get('ref') || undefined
    const utmSource = urlParams.get('utm_source') || undefined
    const utmMedium = urlParams.get('utm_medium') || undefined
    const utmCampaign = urlParams.get('utm_campaign') || undefined
    api
      .post('/api/share/track', {
        json: { shortId, eventType: 'app_open', platform: 'in-app', ref, utmSource, utmMedium, utmCampaign },
      })
      .catch(() => {})

    // Build the deep link URL using the CURRENT origin (window.location.origin).
    // Universal Links / App Links only fire when the URL host matches the
    // domain in the AASA / assetlinks.json files. Using a hardcoded domain
    // would break OS-level interception.
    const targetUrl = `${window.location.origin}/?product=${encodeURIComponent(product.id)}`

    // v25.12: use window.location.replace — replaces the current history entry
    // (no back-button loop), navigates to the SPA which opens the product.
    // We use replace instead of pushState because /p/[shortId] is a server-rendered
    // page — pushState+popstate doesn't work across server/client boundary.
    const timer = setTimeout(() => {
      window.location.replace(targetUrl)
    }, 500)

    return () => clearTimeout(timer)
  }, [product.id, shortId])

  // ---------------------------------------------------------------------------
  // Manual fallback — if the auto-redirect is blocked (e.g. browser kills the
  // timer when the tab is backgrounded mid-redirect), the user can tap the
  // button to navigate manually.
  // ---------------------------------------------------------------------------
  const handleManualOpen = () => {
    if (typeof window === 'undefined') return
    const targetUrl = `${window.location.origin}/?product=${encodeURIComponent(product.id)}`
    window.location.replace(targetUrl)
  }

  return (
    <main
      className="min-h-[100dvh] flex items-center justify-center p-6"
      style={{
        background: 'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #9333EA 100%)',
        // Prevent body scroll while splash is visible.
        overscrollBehavior: 'none',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md text-center"
      >
        {/* v25.12: TRI999 — plain white text */}
        <div className="mb-6">
          <span className="text-3xl font-extrabold tracking-tight text-white">
            TRI999
          </span>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold mb-2 text-white">Открываем товар</h1>

        {/* Product hint */}
        <p className="text-sm line-clamp-2 mb-1 text-white/80">{product.title}</p>
        {product.price > 0 && (
          <p className="text-base font-semibold mb-6 text-white">
            {formatPrice(product.price, product.currency)}
          </p>
        )}

        {/* Animated redirect indicator */}
        {redirecting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-center gap-2 text-sm text-white/80 mb-6"
          >
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
              className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
            />
            Перенаправляем в приложение…
          </motion.div>
        )}

        {/* Manual fallback button (tappable if auto-redirect fails) */}
        <button
          onClick={handleManualOpen}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-[#A02070] font-semibold text-sm shadow-lg hover:scale-[1.02] active:scale-95 transition-transform"
        >
          Открыть в приложении
          <ArrowRight className="h-4 w-4" />
        </button>

        {/* noscript fallback — only visible if JS is disabled.
            Crawlers don't execute JS, so they see OG meta (in <head>) and
            ignore this body content. */}
        <noscript>
          <div className="mt-8 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
            <p className="mb-3 text-amber-800 dark:text-amber-200">
              JavaScript отключён. Нажмите кнопку ниже, чтобы открыть товар в TRI999:
            </p>
            <a
              href={`/?product=${encodeURIComponent(product.id)}`}
              className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold underline"
            >
              Открыть товар <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </noscript>
      </motion.div>
    </main>
  )
}
