'use client'

// ============================================================================
//  useShareLink — React hook that fetches (or creates on demand) the
//  ShareLink for a given product. Returns { shortId, shareUrl, deepLinkUrl,
//  qrPayload, stats, loading, error }.
//
//  The fetch is fire-and-forget: if it fails (network error, backend down),
//  we fall back to a per-product URL with the internal ID (still works for
//  the Web Share API, just doesn't have OG tags or analytics).
// ============================================================================

import { useEffect, useState } from 'react'
import { api } from './api'
import { getPublicUrl } from './public-url'
import type { ShareLinkInfo } from '@999pro/shared'

export function useShareLink(productId: string | null): {
  data: ShareLinkInfo | null
  loading: boolean
  error: Error | null
} {
  const [data, setData] = useState<ShareLinkInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!productId) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    api
      .get<ShareLinkInfo>(`/api/share/by-product/${encodeURIComponent(productId)}`)
      .then((d) => {
        if (!alive) return
        // Override shareUrl / deepLinkUrl with the browser's actual origin.
        // The backend derives these from request headers, but in the sandbox
        // the request goes through a proxy that may have stripped the
        // original host. Using window.location.origin guarantees the link
        // points to the actual deployment URL the user is on.
        const publicUrl = getPublicUrl()
        const corrected: ShareLinkInfo = {
          ...d,
          shareUrl: `${publicUrl}/p/${d.shortId}`,
          deepLinkUrl: `${publicUrl}/dl/${d.shortId}`,
          qrPayload: `${publicUrl}/dl/${d.shortId}`,
        }
        setData(corrected)
      })
      .catch((e: unknown) => {
        if (!alive) return
        const err = e instanceof Error ? e : new Error('Failed to load share link')
        setError(err)
        // Fallback: construct a share URL using the product ID directly.
        // Uses the browser's actual origin — never a hardcoded domain.
        const publicUrl = getPublicUrl()
        const fallbackUrl = `${publicUrl}/?product=${encodeURIComponent(productId)}`
        setData({
          shortId: productId.slice(0, 8),
          shareUrl: fallbackUrl,
          deepLinkUrl: fallbackUrl,
          qrPayload: fallbackUrl,
          stats: {
            sharesCount: 0,
            opensCount: 0,
            appOpensCount: 0,
            installsCount: 0,
            ordersCount: 0,
          },
        })
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [productId])

  return { data, loading, error }
}
