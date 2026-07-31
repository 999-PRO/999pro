'use client'

import { Search, X, Mic } from 'lucide-react'
import { useSearchHistory } from '@/lib/use-search-history'

// ============================================================================
//  InlineSearch — inline search bar that lives directly under the mobile
//  header on the Home page. Used as the primary entry point to Universal
//  Search on mobile.
//
//  v37 redesign: the bar is now READ-ONLY — tapping it (or focusing it)
//  opens the Universal Search overlay instead of running its own inline
//  search. This avoids having two parallel search UX flows and keeps the
//  Home page clean (no inline result list pushing content down).
//
//  History chips below the bar still come from useSearchHistory so they
//  stay in sync with the old behavior (tapping a recent query opens
//  Universal Search pre-filled with that query).
// ============================================================================

interface InlineSearchProps {
  /** Kept for backwards compatibility — no longer used (Universal Search
   *  handles product opening via window events). */
  onOpenProduct?: (id: string) => void
  onStartConversation?: (userId: string) => void
  onQueryChange?: (query: string, hasResults: boolean) => void
}

export function InlineSearch({
   
  onOpenProduct: _onOpenProduct,
   
  onStartConversation: _onStartConversation,
   
  onQueryChange: _onQueryChange,
}: InlineSearchProps) {
  const { history, removeQuery, clearHistory } = useSearchHistory()

  const openUniversalSearch = (initialQuery?: string) => {
    if (initialQuery) {
      // Stash the initial query so UniversalSearchOverlay can pick it up
      // when it opens. Using a window variable avoids prop-drilling through
      // multiple layers (page.tsx → AppShell → UniversalSearchGlobalOverlay).
      ;(window as unknown as { __universalSearchInitialQuery?: string }).__universalSearchInitialQuery =
        initialQuery
    }
    window.dispatchEvent(new CustomEvent('open-universal-search'))
  }

  return (
    <div className="md:hidden">
      {/* Search bar — tapping or focusing opens Universal Search overlay */}
      <div className="px-4 pt-2 pb-3">
        <button
          type="button"
          onClick={() => openUniversalSearch()}
          aria-label="Открыть поиск"
          className="w-full flex items-center gap-2.5 h-12 px-4 rounded-2xl glass-strong shadow-lg border border-border/60 text-left active:scale-[0.99] transition-transform"
        >
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="flex-1 text-sm text-muted-foreground truncate">
            Поиск товаров, брендов, людей…
          </span>
          {/* Voice search hint icon — Universal Search overlay has the real
              mic button. This is just a visual hint that voice search exists. */}
          <span className="shrink-0 grid place-items-center h-7 w-7 rounded-full bg-primary/15 text-primary">
            <Mic className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>

      {/* Recent searches — chip strip below the bar.
          Tapping a chip opens Universal Search pre-filled with that query. */}
      {history.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-2 px-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Недавние
            </h3>
            <button
              onClick={clearHistory}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Очистить историю"
            >
              Очистить
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {history.map((q) => (
              <div
                key={q}
                className="flex items-center gap-1 pl-3 pr-1 py-1.5 rounded-full glass text-sm hover:bg-accent/60 transition-colors shrink-0 whitespace-nowrap"
              >
                <button onClick={() => openUniversalSearch(q)} className="text-foreground">
                  {q}
                </button>
                <button
                  onClick={() => removeQuery(q)}
                  className="h-5 w-5 rounded-full grid place-items-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label={`Удалить «${q}» из истории`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
