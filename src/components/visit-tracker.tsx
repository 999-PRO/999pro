'use client'

// ============================================================================
//  VisitTracker — invisible component that records a page view on every
//  client-side route change. v25.7 (TZ ЭТАП 2.5).
// ----------------------------------------------------------------------------
//  Mounts globally in app/layout.tsx. Listens to `popstate` + a custom
//  `999pro:view-changed` window event (dispatched by app/page.tsx when the
//  user switches views like home → catalog → chat). Each event fires a
//  POST /api/analytics/visits with the current path.
//
//  The backend rate-limits to 1 request / 10s / IP, so rapid view-switching
//  doesn't flood the Visit table.
//
//  Privacy: anonymous visits ARE recorded (userId=null) — this is intentional
//  and required for the "today's visits" stat to be meaningful. The IP is
//  stored for rate-limiting + fraud detection; admins can purge old visits
//  via a Studio script (not yet implemented).
// ============================================================================

import { useEffect } from 'react'
import { api } from '@/lib/api'

export function VisitTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const recordVisit = () => {
      const path = window.location.pathname + window.location.search
      // Don't record /studio visits — those are admin navigations and would
      // skew the public-traffic stats. The Studio app has its own analytics.
      if (path.startsWith('/studio')) return

      // Fire-and-forget — the backend responds 204 when rate-limited, 201 on
      // success. We don't surface errors because visit tracking is
      // non-critical and shouldn't disrupt the user.
      api
        .post('/api/analytics/visits', {
          json: {
            path,
            referrer: document.referrer || undefined,
            sessionId: getSessionId(),
          },
        })
        .catch(() => {})
    }

    // Record the initial visit immediately on mount.
    recordVisit()

    // Listen for client-side route changes. Next.js App Router uses
    // history.pushState/replaceState, so popstate fires for back/forward.
    // For internal setView() navigations, app/page.tsx dispatches a custom
    // event — listen for it too.
    const onViewChanged = () => recordVisit()
    window.addEventListener('popstate', onViewChanged)
    window.addEventListener('999pro:view-changed', onViewChanged as EventListener)

    return () => {
      window.removeEventListener('popstate', onViewChanged)
      window.removeEventListener('999pro:view-changed', onViewChanged as EventListener)
    }
  }, [])

  return null
}

// getSessionId — generate or retrieve a per-browser session ID stored in
// sessionStorage. Resets when the tab closes (sessionStorage scope).
// Used by the backend to group page-views into sessions for future
// "session duration" / "pages per session" analytics.
function getSessionId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const key = '999pro-session-id'
    let sid = window.sessionStorage.getItem(key)
    if (!sid) {
      // Generate a random session ID (crypto.randomUUID is available in all
      // modern browsers + secure contexts).
      sid = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`
      window.sessionStorage.setItem(key, sid)
    }
    return sid
  } catch {
    return undefined
  }
}
