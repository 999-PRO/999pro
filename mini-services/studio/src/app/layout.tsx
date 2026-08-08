import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { NotificationContainer } from '@/components/notification-container'
import { ThemeProvider } from '@/components/providers'
import { AuthInit } from '@/components/auth-init'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
})

export const metadata: Metadata = {
  title: 'Studio TRI999 — Панель управления',
  description: 'Административная панель для управления контентом приложения TRI999.',
  applicationName: 'Studio TRI999',
  // Phase 18: paths must include /studio/ basePath — otherwise they 404
  manifest: '/studio/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Studio TRI999',
  },
  icons: {
    icon: [
      // Phase 29: PNG icons for iOS (SVG not supported for PWA install on iOS)
      { url: '/studio/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/studio/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/studio/icon-192.svg', type: 'image/svg+xml' },
      { url: '/studio/icon-512.svg', type: 'image/svg+xml' },
    ],
    apple: '/studio/apple-touch-icon.png',
  },
  // Phase 18: prevent /studio from being indexed by search engines
  robots: {
    index: false,
    follow: false,
  },
}

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  // S-MED-006 fix (WCAG 1.4.4): removed maximumScale:1 / minimumScale:1 —
  // these blocked pinch-zoom for low-vision users on mobile. Studio is an
  // admin tool; native-app feel is not worth failing WCAG.
  userScalable: true,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${geistSans.variable} antialiased`}>
        <ThemeProvider>
          <AuthInit>{children}</AuthInit>
          <NotificationContainer />
        </ThemeProvider>
      </body>
    </html>
  )
}
