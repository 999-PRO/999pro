'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, X, Package, User as UserIcon, Star, ArrowLeft, Clock, Trash2, TrendingUp } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSearch } from '@/lib/use-search'
import { useSearchHistory } from '@/lib/use-search-history'
import { useAuthStore } from '@/lib/auth-store'
import { assetUrl, api } from '@/lib/api'
import { initials, formatPrice } from '@/lib/format'
import type { Product, User } from '@/lib/types'
import { PROJECT_CATEGORIES } from '@/components/products-grid'

// ============================================================================
//  SearchContent — the shared inner UI of the search experience.
//
//  Used by BOTH:
//    • SearchPage (navigation-based search, opened via header search icon)
//    • SearchOverlay (overlay-based search, opened via swipe-up gesture)
//
//  This ensures a SINGLE source of truth for search UX: search bar, results,
//  empty/loading/no-results states, history, popular queries, categories.
//  No duplicate search logic anywhere.
//
//  Props:
//    • onBack — called when the user taps the back button or presses Esc.
//    • onOpenProduct — called with a product id when the user taps a result.
//    • onStartConversation — called with a user id when the user taps a user
//      result (only for authenticated users).
//    • initialQuery — optional initial query (e.g. from a deep link).
//    • showBackButton — whether to show the back arrow (true in SearchPage,
//      false in the overlay where the backdrop tap closes instead).
//    • autoFocus — whether to focus the input on mount (default true).
// ============================================================================

interface SearchContentProps {
  onBack: () => void
  onOpenProduct: (id: string) => void
  onStartConversation?: (userId: string) => void
  initialQuery?: string
  showBackButton?: boolean
  autoFocus?: boolean
}

export const POPULAR_QUERIES = ['Реклама', 'Подарки', 'Мебель', 'Дизайн', 'Печать'] as const

export function SearchContent({
  onBack,
  onOpenProduct,
  onStartConversation,
  initialQuery = '',
  showBackButton = true,
  autoFocus = true,
}: SearchContentProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const authed = isAuthenticated || (!!token && !!user)
  const [query, setQuery] = useState(initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const { products, users, loading } = useSearch(query, authed)
  const { history, addQuery, removeQuery, clearHistory } = useSearchHistory()

  // Auto-focus the input on mount (unless caller disables it).
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Esc to go back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const hasResults = products.length > 0 || users.length > 0
  const hasQuery = query.trim().length >= 2

  // Track search queries server-side (debounced, authed only) — feeds the
  // home page "Recommended for you" block. Fire-and-forget; silent failures.
  // Also records to client-side history.
  const lastTrackedRef = useRef('')
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) return

    // Record to client-side history after a short debounce (so we don't
    // record every keystroke, only "settled" queries).
    const t = setTimeout(() => {
      if (trimmed !== lastTrackedRef.current) {
        lastTrackedRef.current = trimmed
        addQuery(trimmed)
        if (authed) {
          api.post('/api/search/track', { json: { query: trimmed }, auth: true }).catch(() => {})
        }
      }
    }, 800)
    return () => clearTimeout(t)
  }, [query, authed, addQuery])

  const pickQuery = (q: string) => {
    setQuery(q)
    inputRef.current?.focus()
  }

  return (
    <>
      {/* Search bar — sticky at top of the search surface */}
      <div className="sticky top-0 z-20 px-4 py-3 glass-strong border-b border-border/40">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          {showBackButton && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full shrink-0"
              onClick={onBack}
              aria-label="Назад"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск товаров, брендов, людей…"
              className="pl-10 pr-10 h-11 rounded-2xl bg-accent/40 border-border/40 focus-visible:ring-2 focus-visible:ring-primary"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Очистить"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full grid place-items-center hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results / discovery */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-4 pb-28">
        {loading ? (
          <LoadingState />
        ) : !hasQuery ? (
          <DiscoveryState
            history={history}
            onPickHistory={pickQuery}
            onRemoveHistory={removeQuery}
            onClearHistory={clearHistory}
            recentUsers={users}
            onStartConversation={onStartConversation}
          />
        ) : !hasResults ? (
          <NoResults query={query} onPickQuery={pickQuery} />
        ) : (
          <div className="space-y-6">
            {products.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" /> Товары · {products.length}
                </h3>
                <div className="space-y-1">
                  {products.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      onClick={() => onOpenProduct(p.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {users.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                  <UserIcon className="h-3.5 w-3.5" /> Пользователи · {users.length}
                </h3>
                <div className="space-y-1">
                  {users.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      onClick={() => onStartConversation?.(u.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ============================================================================
//  DiscoveryState — shown when no query is typed.
//  Contains: search history, popular queries, categories, recent users.
//  v12.6.1: exported so HomeSearchBar can reuse it in the inline panel.
// ============================================================================

export function DiscoveryState({
  history,
  onPickHistory,
  onRemoveHistory,
  onClearHistory,
  recentUsers,
  onStartConversation,
}: {
  history: string[]
  onPickHistory: (q: string) => void
  onRemoveHistory: (q: string) => void
  onClearHistory: () => void
  recentUsers: User[]
  onStartConversation?: (userId: string) => void
}) {
  return (
    <div className="space-y-6">
      {/* Search history */}
      {history.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 px-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> История
            </h3>
            <button
              onClick={onClearHistory}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              aria-label="Очистить историю"
            >
              <Trash2 className="h-3 w-3" /> Очистить
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {history.map((q) => (
              <div
                key={q}
                className="group flex items-center gap-1 pl-3 pr-1 py-1.5 rounded-full glass text-sm hover:bg-accent/60 transition-colors shrink-0 whitespace-nowrap"
              >
                <button
                  onClick={() => onPickHistory(q)}
                  className="text-foreground"
                >
                  {q}
                </button>
                <button
                  onClick={() => onRemoveHistory(q)}
                  className="h-5 w-5 rounded-full grid place-items-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label={`Удалить «${q}» из истории`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Popular queries */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> Популярные запросы
        </h3>
        <div className="flex flex-wrap gap-2">
          {POPULAR_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => onPickHistory(q)}
              className="px-3 py-1.5 rounded-full gradient-brand text-white text-sm font-medium shadow-glow hover:opacity-90 transition-opacity"
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      {/* Categories */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
          Категории
        </h3>
        <div className="flex flex-wrap gap-2">
          {PROJECT_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => onPickHistory(c)}
              className="px-3 py-1.5 rounded-full glass text-sm hover:bg-accent transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      {/* Recent users (discovery mode — only when authed) */}
      {recentUsers.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
            Недавние пользователи — начните диалог
          </h3>
          <div className="space-y-1">
            {recentUsers.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onClick={() => onStartConversation?.(u.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* First-time hint when no history and no recent users */}
      {history.length === 0 && recentUsers.length === 0 && (
        <div className="py-8 text-center">
          <div className="text-5xl mb-3">🔍</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Поиск работает по названиям товаров, категориям, описаниям, а также
            по никнеймам, email и телефонам пользователей.
          </p>
        </div>
      )}
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2">
          <div className="h-12 w-12 rounded-xl skeleton" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 rounded skeleton" />
            <div className="h-2 w-1/3 rounded skeleton" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function NoResults({ query, onPickQuery }: { query: string; onPickQuery: (q: string) => void }) {
  return (
    <div className="py-16 text-center">
      <div className="text-5xl mb-4">🤔</div>
      <h3 className="font-semibold text-lg mb-1">Ничего не найдено</h3>
      <p className="text-sm text-muted-foreground mb-6">
        По запросу «{query}» нет товаров или пользователей
      </p>
      <div className="text-xs text-muted-foreground mb-2">Попробуйте:</div>
      <div className="flex flex-wrap gap-2 justify-center max-w-sm mx-auto">
        {POPULAR_QUERIES.map((s) => (
          <button
            key={s}
            onClick={() => onPickQuery(s)}
            className="px-3 py-1.5 rounded-full glass text-xs hover:bg-accent transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ProductRow({ product, onClick }: { product: Product; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-accent/40 active:bg-accent/60 transition-colors text-left"
    >
      <div className="h-14 w-14 rounded-xl overflow-hidden bg-muted/40 shrink-0">
        <img
          src={assetUrl(product.images[0])}
          alt={product.title}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{product.title}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          {product.category && <span>{product.category}</span>}
          {product.rating > 0 && (
            <span className="flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {product.rating.toFixed(1)}
            </span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold text-sm">{formatPrice(product.price, product.currency)}</div>
        {product.oldPrice && product.oldPrice > product.price && (
          <div className="text-xs text-muted-foreground line-through">
            {formatPrice(product.oldPrice, product.currency)}
          </div>
        )}
      </div>
    </button>
  )
}

export function UserRow({ user, onClick }: { user: User; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-accent/40 active:bg-accent/60 transition-colors text-left"
    >
      <Avatar className="h-12 w-12 shrink-0">
        <AvatarImage src={user.avatar || undefined} alt={user.username} />
        <AvatarFallback className="gradient-brand text-white">
          {initials(user.displayName || user.username)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{user.displayName || user.username}</div>
        <div className="text-xs text-muted-foreground truncate">
          @{user.username}
          {user.phone ? ` · ${user.phone}` : ''}
        </div>
      </div>
      <div className="text-xs text-primary font-semibold shrink-0">Написать</div>
    </button>
  )
}
