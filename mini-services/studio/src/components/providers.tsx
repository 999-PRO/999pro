'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { ReactNode, useEffect, useCallback } from 'react'
import { useStudioPush } from '@/hooks/use-studio-push'
// v25.7 (TZ ЭТАП 2.4): global Studio socket registration. Previously
// useStudioSocket was only called inside leads-manager.tsx — so admins only
// got real-time updates while looking at the Leads page. Mounting it globally
// here means admins get instant in-app toasts for reviews, reports, leads,
// and orders regardless of which Studio page they're on.
import { useStudioSocket } from '@/lib/use-studio-socket'
import { toast } from '@/lib/notifications'

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ('serviceWorker' in navigator) {
      // IMPORTANT: the studio app runs with basePath='/studio' (see
      // next.config.ts). The studio's SW file is served at /studio/sw.js,
      // NOT /sw.js. Registering '/sw.js' would install the MAIN APP's
      // service worker with scope '/' — meaning the studio gets the wrong
      // caching strategy, wrong push handlers, and wrong offline page.
      // Using a basePath-relative URL ensures the correct SW is registered.
      navigator.serviceWorker.register('/studio/sw.js').catch(() => {})
    }
  }, [])

  // v12.8: Subscribe admin to push notifications (orders, leads, chat)
  useStudioPush()

  // v25.7 (TZ ЭТАП 2.4): global admin-notification handler. Converts socket
  // events fired by the backend (review:created, moderation:report-created,
  // lead:created, order:created) into in-app toasts. The callback is stable
  // (useCallback) so the socket doesn't reconnect on every parent re-render.
  // Each toast links to the relevant Studio page so the admin can act on it
  // in one click.
  const handleStudioEvent = useCallback((type: string, data: unknown) => {
    const d = (data || {}) as Record<string, unknown>
    switch (type) {
      case 'review:created':
        toast.info('Новый отзыв', {
          description: `${String(d.authorName ?? 'Аноним')} → ${String(d.productTitle ?? '')} (${Number(d.rating ?? 0)}★)`,
          duration: 8000,
          onClick: () => {
            if (typeof window !== 'undefined') {
              window.location.assign('/studio/?view=moderation')
            }
          },
        })
        break
      case 'review:reply-created':
        // Only show toast for admins OTHER than the one who wrote the reply
        // (the author already knows — they just submitted it). Backend emits
        // to all admins including the author; the author's toast is a minor
        // annoyance but harmless, and filtering would require shipping the
        // authorId in the payload (not currently done).
        toast.info('Новый ответ на отзыв', {
          description: `${String(d.authorName ?? 'Администратор')}: ${String(d.content ?? '').slice(0, 80)}`,
          duration: 6000,
        })
        break
      case 'moderation:report-created':
        toast.warning('Новая жалоба', {
          description: `${String(d.targetType ?? '')}: ${String(d.reason ?? '')}`,
          duration: 8000,
          onClick: () => {
            if (typeof window !== 'undefined') {
              window.location.assign('/studio/?view=moderation')
            }
          },
        })
        break
      case 'lead:created':
        toast.info('Новая заявка', {
          description: `${String(d.name ?? '')}: ${String(d.productTitle ?? 'Без товара')}`,
          duration: 8000,
          onClick: () => {
            if (typeof window !== 'undefined') {
              window.location.assign('/studio/?view=leads')
            }
          },
        })
        break
      case 'order:created':
        toast.info('Новый заказ', {
          description: `#${String(d.orderId ?? '').slice(-6)} · ${String(d.userName ?? '')}`,
          duration: 8000,
          onClick: () => {
            if (typeof window !== 'undefined') {
              window.location.assign('/studio/?view=orders')
            }
          },
        })
        break
      // Other events (lead:status-changed, order:status-changed, etc.) are
      // handled by the dedicated manager pages (leads-manager.tsx, etc.) —
      // they don't need a global toast because the admin is already on that
      // page when they care about live status updates.
    }
  }, [])
  useStudioSocket(handleStudioEvent)

  return (
    // v13.0 (audit P0 dark/light): enable system theme detection so admins
    // whose OS is in dark mode see the dark Studio by default. The toggle
    // in sidebar.tsx lets them override the system preference.
    //
    // v16.8 (unified notifications): ToastProvider removed — all toasts now
    // flow through the single NotificationContainer (mounted in layout.tsx)
    // + the imperative `toast` API from @/lib/notifications.
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  )
}
