'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { ReactNode, useEffect } from 'react'
import { useStudioPush } from '@/hooks/use-studio-push'

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
