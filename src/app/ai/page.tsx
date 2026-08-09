'use client'

// ============================================================================
//  /ai — Standalone AI Agent page (v25.9)
//  The AI Agent is also accessible as a popup from anywhere in the app (via
//  the Sparkles button in the sidebar/bottom-nav). This dedicated page gives
//  it a permanent home with deep-linkable URL, browser back-button support,
//  and a full-screen premium layout.
// ============================================================================

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { useAISession } from '@/modules/ai-assistant/ai-session-store'
import { ThemeProvider } from '@/components/providers'
import { AuthInit } from '@/components/auth-init'
import { NotificationContainer } from '@/components/notification-container'

const AIAssistant = dynamic(
  () => import('@/modules/ai-assistant').then((m) => m.AIAssistant),
  { ssr: false },
)

export default function AIPage() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const setSessionOpen = useAISession((s) => s.setOpen)

  // When the page loads, force the AI session to "open" so the inline
  // assistant renders its content (the inline mode ignores the `open` flag
  // for layout, but internal effects key off it for fetching status /
  // showcase / greeting).
  useEffect(() => {
    setSessionOpen(true)
    return () => setSessionOpen(false)
  }, [setSessionOpen])

  // v25.9.2: when the user clicks a product card in the AI feed, dispatch
  // `999pro:open-product`. The main app (page.tsx) listens for this event,
  // but we're on /ai — a separate route — so we need to navigate back to
  // the main app with the product id so it can open the product overlay.
  useEffect(() => {
    const onOpenProduct = (e: Event) => {
      const detail = (e as CustomEvent).detail as { productId?: string } | undefined
      if (detail?.productId) {
        // Navigate to main app with product param — page.tsx reads
        // ?product= on mount and opens the overlay.
        router.push(`/?product=${encodeURIComponent(detail.productId)}`)
      }
    }
    window.addEventListener('999pro:open-product', onOpenProduct as EventListener)
    return () => window.removeEventListener('999pro:open-product', onOpenProduct as EventListener)
  }, [router])

  return (
    <ThemeProvider>
      <AuthInit>
        <NotificationContainer />
        <div className="h-screen flex flex-col bg-background overflow-hidden">
          {/* Top bar — minimal, with a back button */}
          <header className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-card/80 backdrop-blur-xl safe-top shrink-0">
            <button
              onClick={() => router.back()}
              className="h-9 w-9 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"
              title="Назад"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shadow-glow">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <h1 className="font-bold text-base text-foreground">AI Агент 999</h1>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {user ? (user.role === 'admin' || user.role === 'manager' ? 'Режим администратора' : 'Режим клиента') : 'Гость'}
            </div>
          </header>

          {/* Main: AI Assistant in inline (full-page) mode — fills remaining viewport */}
          <main className="flex-1 flex overflow-hidden min-h-0">
            <AIAssistant
              inline
              context="ai-page"
              onNavigate={(view) => {
                router.push(`/?view=${encodeURIComponent(view)}`)
              }}
            />
          </main>
        </div>
      </AuthInit>
    </ThemeProvider>
  )
}
