'use client'

import { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'

export function AppShell({
  view,
  onNavigate,
  onOpenSearch,
  onLogout,
  children,
}: {
  view: string
  onNavigate: (v: string) => void
  onOpenSearch: () => void
  onLogout: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar view={view} onNavigate={onNavigate} onOpenSearch={onOpenSearch} onLogout={onLogout} />

      <div className="flex-1 flex flex-col min-w-0">
        <main className="app-main flex-1 w-full min-w-0">{children}</main>

        {/* S-HIGH-007: onMore prop removed — BottomNav's "Ещё" button now
            only opens the sheet; navigation happens via handlePick. */}
        <BottomNav view={view} onNavigate={onNavigate} />
      </div>
    </div>
  )
}
