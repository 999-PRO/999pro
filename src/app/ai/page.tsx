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

  return (
    <ThemeProvider>
      <AuthInit>
        <NotificationContainer />
        <div className="min-h-screen flex flex-col bg-background">
          {/* Top bar — minimal, with a back button */}
          <header className="flex items-center gap-3 px-4 py-3 border-b border-border/60 glass safe-top">
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
              <h1 className="font-bold text-base">AI Агент 999</h1>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {user ? (user.role === 'admin' || user.role === 'manager' ? 'Режим администратора' : 'Режим клиента') : 'Гость'}
            </div>
          </header>

          {/* Main: AI Assistant in inline (full-page) mode */}
          <main className="flex-1 flex overflow-hidden">
            <AIAssistant
              inline
              context="ai-page"
              onNavigate={(view) => {
                // Navigate back to the main app at the requested view.
                router.push(`/?view=${encodeURIComponent(view)}`)
              }}
            />
          </main>
        </div>
      </AuthInit>
    </ThemeProvider>
  )
}
