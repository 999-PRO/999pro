// ============================================================================
//  Deep link handler — /dl/[shortId]
//  ----------------------------------------------------------------------------
//  This route is the link used in QR codes and Web Share API payloads.
//  It tries to open the installed PWA / native app at the specific product,
//  and falls back to the public share page (/p/[shortId]) if the app isn't
//  installed.
//
//  Strategy:
//    1. (Native app only) Try the app's URL scheme (e.g. 999pro://p/<id>).
//       On iOS this requires Universal Links configuration; on Android,
//       App Links. Both fall back to the URL automatically if the app
//       isn't installed.
//    2. (PWA) Try opening /?product=<id> on the same origin — if the PWA
//       is installed as standalone, this opens the installed app. Otherwise
//       it just navigates within the browser.
//    3. Fallback: redirect to /p/<shortId> (the public share page).
//
//  This page does an instant client-side redirect. We use a meta refresh
//  as a fallback for crawlers without JS.
//
//  ----------------------------------------------------------------------------
//  P-MED-011: This route is INTENTIONALLY a no-op redirect to /p/[shortId].
//
//  Historically this route was planned to attempt a custom URL-scheme launch
//  (e.g. window.location = '999pro://p/<id>') before falling back. We no
//  longer do this because:
//    1. Universal Links (iOS) and App Links (Android) are configured to
//       intercept the public https://.../p/<shortId> URL directly. When
//       the app is installed, the OS opens the app at the right screen
//       without us doing anything — no custom-scheme hack needed.
//    2. When the app is NOT installed, the same https://.../p/<shortId>
//       URL loads the public share page in the browser, which has an
//       "Open in App" button that triggers the deep-link flow with the
//       correct product ID (fetched server-side from the shortId).
//
//  So /dl/[shortId] exists only as a stable, short, shareable URL for QR
//  codes and the Web Share API. Universal Links work directly on /p/, so
//  we simply forward to it. Do NOT add JS-based scheme-launch logic here —
//  it would be redundant with Universal Links and can cause redirect loops
//  on some browsers (Safari) that treat custom-scheme failures as errors.
//  ============================================================================

import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

export const dynamic = 'force-static'

// v25.7 (TZ ЭТАП 2.9): /dl/[shortId] is a redirect-only route (it forwards to
// /p/<shortId> for Universal Links). It has no content of its own and would
// otherwise be indexed as a duplicate of /p/<shortId>. Marking it noindex /
// nofollow keeps Google from wasting crawl budget on these redirects and
// avoids duplicate-content signals on the canonical share page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function DeepLinkPage({
  params,
}: {
  params: Promise<{ shortId: string }>
}) {
  const { shortId } = await params
  if (!shortId || !/^[A-Za-z0-9]{4,32}$/.test(shortId)) {
    redirect('/?view=home')
  }

  // Intentional no-op: Universal Links work directly on /p/<shortId>, so
  // we just forward. See the header comment above (P-MED-011) for rationale.
  redirect(`/p/${shortId}`)
}
