'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { AnimatePresence } from 'framer-motion'
import { useNotifications } from '@/lib/use-notifications'
import { useNotificationsStore } from '@/lib/use-notifications'
import { usePushNotifications } from '@/lib/use-push'
import { useAuthStore } from '@/lib/auth-store'
import { useIsDesktop } from '@/lib/use-media-query'
import { RetryableErrorBoundary } from '@/components/retryable-error-boundary'
// v25.11: unified HomeView for both mobile and desktop (replaces DesktopHome + old mobile HomeView)
import { HomeView } from '@/components/home/home-view'
// v25.11: new CatalogPage with server-side filters + pagination
import { CatalogPage } from '@/components/catalog/catalog-page'
// v25.12: Price lists page (public)
import { PriceListsPage } from '@/components/price-lists/price-lists-page'
// v25.14: Сообщества — публичные объявления + закрытый оптовый клуб
const CommunityView = dynamic(() => import('@/components/community/community-view').then((m) => m.CommunityView), { ssr: false })

// v12.3: the Feed module has been removed and replaced by the 999 CLUB module.
// The entire CLUB module is code-split via `next/dynamic` — if the user never
// opens CLUB, none of its code (animations, store, hooks, components) is
// downloaded.
const ClubView = dynamic(() => import('@/modules/999-club').then((m) => m.ClubView), { ssr: false })
const ChatView = dynamic(() => import('@/components/chat').then((m) => m.ChatView), { ssr: false })
const ProfileView = dynamic(() => import('@/components/profile-view').then((m) => m.ProfileView), { ssr: false })
const AuthDialog = dynamic(() => import('@/components/auth-dialog').then((m) => m.AuthDialog), { ssr: false })
const MoreSheet = dynamic(() => import('@/components/more-sheet').then((m) => m.MoreSheet), { ssr: false })
const ProductPage = dynamic(() => import('@/components/product-page').then((m) => m.ProductPage), { ssr: false })
const FilmBottomSheet = dynamic(() => import('@/modules/films/film-bottom-sheet').then((m) => m.FilmBottomSheet), { ssr: false })
const SearchPage = dynamic(() => import('@/components/search-page').then((m) => m.SearchPage), { ssr: false })
const StudioView = dynamic(() => import('@/components/studio-view').then((m) => m.StudioView), { ssr: false })

// v22 audit: Analytics view — admin/manager dashboard with real data from /api/analytics.
const AnalyticsView = dynamic(() => import('@/components/analytics-view').then((m) => m.AnalyticsView), { ssr: false })

// v18.6: Admin login view — separate page for administrators.
const AdminLoginView = dynamic(() => import('@/components/admin-login-view').then((m) => m.AdminLoginView), { ssr: false })

// Lazy-load new views added in v0.1: orders, reviews, support, settings, etc.
const OrdersView = dynamic(() => import('@/components/orders-view').then((m) => m.OrdersView), { ssr: false })
const ReviewsView = dynamic(() => import('@/components/reviews-view').then((m) => m.ReviewsView), { ssr: false })
// v25.6 (Task #2 + #7): SupportView kept for backward-compat with deep links,
// but the user-facing menu entries now route to ContactsView instead.
const SupportView = dynamic(() => import('@/components/support-view').then((m) => m.SupportView), { ssr: false })
const ContactsView = dynamic(() => import('@/components/contacts-view').then((m) => m.ContactsView), { ssr: false })
const SettingsView = dynamic(() => import('@/components/settings-view').then((m) => m.SettingsView), { ssr: false })
const PrivacyView = dynamic(() => import('@/components/privacy-view').then((m) => m.PrivacyView), { ssr: false })
const AboutView = dynamic(() => import('@/components/about-view').then((m) => m.AboutView), { ssr: false })
const InfoPageView = dynamic(() => import('@/components/info-page-view').then((m) => m.InfoPageView), { ssr: false })
// v25.24: ИГРОВОЙ КЛУБ — раздел «Игры» (15 игр, код-сплит по игре внутри хаба)
const GamesHub = dynamic(() => import('@/components/games/games-hub').then((m) => m.GamesHub), { ssr: false })

type View = 'home' | 'catalog' | 'club' | 'chat' | 'profile' | 'search' | 'studio' | 'orders' | 'reviews' | 'support' | 'contacts' | 'settings' | 'privacy' | 'about' | 'info' | 'admin-login' | 'analytics' | 'price' | 'community' | 'games'

function getInitialView(): View {
  if (typeof window === 'undefined') return 'home'
  const params = new URLSearchParams(window.location.search)
  const v = params.get('view')
  // v25.6: 'support' is kept as a valid view for backward-compat with deep
  // links, but it now resolves to ContactsView (see routing below). Old
  // bookmarks /?view=support still work — they show Contacts.
  const validViews: View[] = ['home', 'catalog', 'club', 'chat', 'profile', 'search', 'studio', 'orders', 'reviews', 'support', 'contacts', 'settings', 'privacy', 'about', 'info', 'admin-login', 'price', 'community', 'games']
  if (v && validViews.includes(v as View)) return v as View
  return 'home'
}

// Get the initial info page slug from ?page= URL param (used with ?view=info)
function getInitialInfoSlug(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const p = params.get('page')
  return p || null
}

function getInitialProductId(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const p = params.get('product')
  return p || null
}

export default function Home() {
  // Lazy initializers — first render matches the URL, no flash of 'home' (FE-014)
  const [view, setView] = useState<View>(() => getInitialView())
  const [authOpen, setAuthOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  // v25.14: category tapped on the home page is carried into the catalog.
  // (Previously discarded — clicking a category tile just opened a generic
  // catalog, which made custom categories feel "broken".)
  const [catalogCategory, setCatalogCategory] = useState<string | undefined>(undefined)
  const [activeProductId, setActiveProductId] = useState<string | null>(() => getInitialProductId())
  // v21: initial product data (from orders) — allows ProductPage to render
  // soft-deleted products that are no longer in the catalog.
  const [activeInitialProduct, setActiveInitialProduct] = useState<any | null>(null)
  const [activeFilmPayload, setActiveFilmPayload] = useState<any | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  // v16.8: info page slug — when view='info', this is the slug to display.
  const [activeInfoSlug, setActiveInfoSlug] = useState<string | null>(() => getInitialInfoSlug())

  // Gate the desktop layout on viewport — mounting DesktopHome on mobile
  // wastes 3 API calls + 5 component subtrees per mobile page load.
  const isDesktop = useIsDesktop()

  // Remove the inline splash overlay as soon as React hydrates this
  // component. The overlay is injected by the inline script in layout.tsx
  // and shows a brand-gradient + spinner so the user never sees a white
  // screen during cold launch. By the time this effect runs, hydration
  // is complete and the real UI is on screen — safe to fade out the
  // splash.
  useEffect(() => {
    const splash = document.getElementById('app-splash')
    if (!splash) return
    splash.style.opacity = '0'
    const t = setTimeout(() => splash.remove(), 350)
    return () => clearTimeout(t)
  }, [])

  // Reset the "update already applied" flag on each successful hydration.
  // The flag prevents infinite reload loops when the SW sends multiple
  // UPDATE_AVAILABLE messages in one session, but we want the NEXT
  // deployment (after this page has loaded) to still trigger a reload.
  // Waiting 3 seconds before clearing ensures the current update cycle
  // has completed (if any).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem('999pro-update-applied')
      } catch {}
    }, 3000)
    return () => clearTimeout(t)
  }, [])

  // Notifications — listen for incoming messages across ALL views. The hook
  // implements the 3-state policy:
  //   - tab hidden  → system Push via SW
  //   - tab visible, but not in this conversation → in-app toast + sound
  //   - tab visible AND in this conversation → silent (just append)
  const clearUnread = useNotificationsStore((s) => s.clearUnread)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)

  // Track which conversation the user is currently viewing inside ChatView.
  // ChatView emits `chat:active-conversation` whenever its active conv changes
  // (including null when the user leaves the chat or returns to the list).
  useEffect(() => {
    const onActive = (e: Event) => {
      const detail = (e as CustomEvent).detail as { conversationId?: string | null }
      const id = detail?.conversationId || null
      setActiveConversationId(id)
      // When the user opens a conversation, immediately clear its unread
      // badge so the badge disappears the moment the conversation is viewed
      // (not only after the server round-trip).
      if (id) clearUnread(id)
    }
    window.addEventListener('chat:active-conversation', onActive as EventListener)
    return () => window.removeEventListener('chat:active-conversation', onActive as EventListener)
  }, [clearUnread])

  useNotifications({ activeConversationId })

  // Web Push — subscribe to OS-level push notifications for background delivery
  usePushNotifications()

  // Request notification permission on first user activation.
  // Browsers REQUIRE a user gesture before allowing
  // Notification.requestPermission() — calling it on page load is silently
  // ignored.
  //
  // F-HIGH-003: previously this attached one-shot listeners for `click`,
  // `touchstart`, AND `keydown`. The click/touchstart listeners fired on the
  // very first tap/click ANYWHERE on the page — including taps on the splash
  // screen, navigation buttons, product cards, etc. — which made the
  // permission prompt appear aggressively the moment a user touched the app
  // for the first time, even before they had logged in.
  //
  // Now: only `keydown` on Enter/Space (true activation keys per WAI-ARIA),
  // AND only after the user is authenticated. Anonymous visitors browsing
  // the catalog are no longer prompted. The `authed` dep re-runs the effect
  // when the user logs in so the listener is attached at the right time.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const authed = isAuthenticated || (!!token && !!user)

  // v10.3-fix: fetch unread message counts on app boot (not just when the
  // chat view is opened). This ensures the bottom-nav badge shows the
  // correct count even if the user never opens the chat view — e.g. they
  // were offline, received messages, reopened the app, and the badge
  // should show immediately. Previously, the fetch only ran inside
  // ChatView (which is lazy-loaded), so the badge was 0 until the user
  // manually opened the chat list.
  useEffect(() => {
    if (!authed) return
    import('@/lib/api').then(({ api }) => {
      api
        .get<{ byConversation: Record<string, number>; total: number }>('/api/chat/unread-counts', { auth: true })
        .then((d) => {
          import('@/lib/use-notifications').then(({ useNotificationsStore }) => {
            useNotificationsStore.getState().setUnread(d.total, d.byConversation)
          })
        })
        .catch(() => {})
    })
  }, [authed])

  useEffect(() => {
    if (!authed) return
    let permissionRequested = false
    const requestPermission = () => {
      if (permissionRequested) return
      permissionRequested = true
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {})
      }
      // v18.6: remove ALL listeners once we've requested (no need to keep
      // listening — Notification.permission can only transition from 'default'
      // to 'granted'/'denied' once per page lifetime).
      document.removeEventListener('keydown', onKeydown)
      document.removeEventListener('click', onFirstClick)
      document.removeEventListener('touchstart', onFirstClick, { capture: true } as any)
    }
    const onKeydown = (e: KeyboardEvent) => {
      // v13.1 (audit P1-15 fix): only trigger on Enter/Space when the user
      // is NOT already typing in an input/textarea/contenteditable. The
      // previous version fired on EVERY Enter/Space — including when the
      // user pressed Enter to send a chat message or submit a form, which
      // jarringly popped up the notification permission prompt.
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return
      }
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        requestPermission()
      }
    }
    // v18.6: also request on first user click/touch anywhere on the page.
    // Browsers REQUIRE a user gesture before allowing Notification.requestPermission().
    // The previous Enter/Space-only listener was too restrictive — users never
    // discovered they had to press Enter, so push notifications never got
    // permission and the user never received any notifications at all.
    //
    // We use { capture: true } so we catch the gesture before any other handler
    // can stopPropagation it. We also remove the listener immediately after the
    // first gesture so we don't re-prompt.
    const onFirstClick = () => {
      requestPermission()
    }
    document.addEventListener('keydown', onKeydown, { passive: true })
    document.addEventListener('click', onFirstClick, { passive: true })
    document.addEventListener('touchstart', onFirstClick, { capture: true, passive: true })
    return () => {
      document.removeEventListener('keydown', onKeydown)
      document.removeEventListener('click', onFirstClick)
      document.removeEventListener('touchstart', onFirstClick, { capture: true } as any)
    }
  }, [authed])

  // Listen for notification:click events (fired by use-notifications.ts when
  // the user clicks a system notification) — navigate to chat and dispatch
  // an event the ChatView can pick up to open the right conversation.
  useEffect(() => {
    const onClick = (e: Event) => {
      const detail = (e as CustomEvent).detail as { conversationId?: string }
      setView('chat')
      // Forward to ChatView — it listens for this event and opens the conv
      window.dispatchEvent(
        new CustomEvent('chat:open-conversation', { detail }),
      )
    }
    window.addEventListener('notification:click', onClick as EventListener)
    return () => window.removeEventListener('notification:click', onClick as EventListener)
  }, [])

  // Listen for back/forward navigation
  useEffect(() => {
    const onPop = () => {
      setView(getInitialView())
      setActiveProductId(getInitialProductId())
      setActiveInfoSlug(getInitialInfoSlug())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((v: string) => {
    setView(v as View)
    setActiveProductId(null)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('view', v)
      url.searchParams.delete('product')
      window.history.pushState({}, '', url.toString())
      // v25.7 (TZ ЭТАП 2.5): notify the VisitTracker that the view changed.
      // Without this, the tracker only fires on popstate (back/forward) and
      // misses internal setView() navigations.
      window.dispatchEvent(new CustomEvent('999pro:view-changed', { detail: { view: v } }))
    }
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  // v16.8: Navigate to a DB-backed info page by slug.
  // Updates the URL to ?view=info&page=<slug> so the page is shareable + bookmarkable.
  const navigateToInfoPage = useCallback((slug: string) => {
    setView('info')
    setActiveProductId(null)
    setActiveInfoSlug(slug)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('view', 'info')
      url.searchParams.set('page', slug)
      url.searchParams.delete('product')
      window.history.pushState({}, '', url.toString())
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [])

  const openProduct = useCallback((id: string) => {
    setActiveProductId(id)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('product', id)
      window.history.pushState({}, '', url.toString())
    }
  }, [])

  // Open a product as a modal overlay WITHOUT changing the URL or the
  // current view. Used by inline product cards in chat (and any other
  // component that wants to open a product on top of the current screen
  // without triggering a navigation). The product sheet renders above
  // whatever view is active — closing it returns the user to the exact
  // same screen state (scroll position, mounted components, etc.).
  const openProductOverlay = useCallback((id: string) => {
    setActiveProductId(id)
    // Deliberately NO pushState here — we don't want to change the URL
    // (changing the URL can trigger Next.js router re-evaluation and
    // cause the app to appear to "reload"). The product opens as a pure
    // overlay; if the user reloads the page, the overlay is gone (which
    // is the expected behaviour for a transient modal).
  }, [])

  // Listen for navigate events from other parts of the app (e.g. deep links,
  // notifications, or buttons that don't have direct access to the navigate
  // callback). The event detail can carry the target view name.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { view?: string } | undefined
      if (detail?.view) navigate(detail.view)
    }
    window.addEventListener('navigate', onNavigate as EventListener)
    return () => window.removeEventListener('navigate', onNavigate as EventListener)
  }, [navigate])

  // Listen for "open-product" overlay requests — used by inline product
  // cards in chat to open the ProductPage as a modal WITHOUT navigation.
  // This is deliberately a separate event from `navigate` so that opening
  // a product from chat never switches the view or changes the URL.
  useEffect(() => {
    const onOpenProduct = (e: Event) => {
      const detail = (e as CustomEvent).detail as { productId?: string; initialProduct?: any } | undefined
      if (detail?.productId) {
        // v21: stash initialProduct (from orders) so ProductPage can render
        // soft-deleted products immediately without waiting for a fetch.
        setActiveInitialProduct(detail.initialProduct ?? null)
        openProductOverlay(detail.productId)
      }
    }
    window.addEventListener('999pro:open-product', onOpenProduct as EventListener)
    return () => window.removeEventListener('999pro:open-product', onOpenProduct as EventListener)
  }, [openProductOverlay])

  // v25.6 (Task #1): Listen for "switch-product" requests from the Similar
  // Products block inside ProductPage. Previously, the SimilarProducts click
  // handler did `pushState + dispatchEvent(popstate)` — but popstate is also
  // intercepted by ProductPage's own Back-button handler, which closed the
  // card instead of switching the product.
  // Now SimilarProducts dispatches `999pro:switch-product` and we call
  // `openProduct(id)` which:
  //   1. Sets activeProductId → ProductPage refetches the new product.
  //   2. Pushes ?product=<id> to the URL (so a reload works).
  //   3. Does NOT close the card.
  useEffect(() => {
    const onSwitchProduct = (e: Event) => {
      const detail = (e as CustomEvent).detail as { productId?: string } | undefined
      if (detail?.productId) {
        openProduct(detail.productId)
      }
    }
    window.addEventListener('999pro:switch-product', onSwitchProduct as EventListener)
    return () => window.removeEventListener('999pro:switch-product', onSwitchProduct as EventListener)
  }, [openProduct])

  // Listen for "open-film" overlay requests — same pattern as product.
  // Used by FilmChatCard in chat to open FilmBottomSheet as overlay.
  useEffect(() => {
    const onOpenFilm = (e: Event) => {
      const detail = (e as CustomEvent).detail as { payload?: any } | undefined
      if (detail?.payload) setActiveFilmPayload(detail.payload)
    }
    window.addEventListener('999pro:open-film', onOpenFilm as EventListener)
    return () => window.removeEventListener('999pro:open-film', onOpenFilm as EventListener)
  }, [])

  // v35: Listen for "app:open-info-page" requests — used by Universal Search
  // to open an info-page by slug from anywhere in the app.
  useEffect(() => {
    const onOpenInfoPage = (e: Event) => {
      const detail = (e as CustomEvent).detail as { slug?: string } | undefined
      if (detail?.slug) navigateToInfoPage(detail.slug)
    }
    window.addEventListener('app:open-info-page', onOpenInfoPage as EventListener)
    return () =>
      window.removeEventListener('app:open-info-page', onOpenInfoPage as EventListener)
  }, [navigateToInfoPage])

  // Listen for "open-auth" requests from anywhere in the app (e.g. SmartShareSheet
  // when an unauthenticated user taps "Отправить в чат"). Opens the AuthDialog
  // — same dialog that HomeView's onAuth() callback opens.
  useEffect(() => {
    const onOpenAuth = () => setAuthOpen(true)
    window.addEventListener('999pro:open-auth', onOpenAuth)
    return () => window.removeEventListener('999pro:open-auth', onOpenAuth)
  }, [])

  // v10.3-fix: deep-link from push notification cold start. When the SW
  // opens a new window with ?conv=<conversationId>, we need to navigate
  // to the chat view and dispatch chat:open-conversation so ChatView
  // opens the right conversation. This runs once on mount, after
  // ChatView has been mounted (via the view=chat param set by getInitialView).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const convId = params.get('conv')
    if (convId) {
      // Clean the URL so the param doesn't persist on refresh.
      params.delete('conv')
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname
      window.history.replaceState({}, '', newUrl)
      // Dispatch the open-conversation event. ChatView listens for this
      // and will refresh conversations if needed (handles the case where
      // the conversation isn't in the local state yet).
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('chat:open-conversation', { detail: { conversationId: convId } }),
        )
      }, 500) // delay so ChatView has time to mount
    }
  }, [])

  // v16.1: pending-product localStorage code removed — BuySheet is deleted,
  // so nothing writes that marker anymore. Clean up any stale key from old
  // clients so it doesn't linger forever.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem('999pro-pending-product') } catch { /* ignore */ }
    }
  }, [])

  const closeProduct = useCallback(() => {
    setActiveProductId(null)
    setActiveInitialProduct(null)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('product')
      window.history.pushState({}, '', url.toString())
    }
  }, [])

  // Open Universal Search overlay (v35) — dispatches a window event that
  // UniversalSearchGlobalOverlay listens for. Cmd/Ctrl+K also works.
  const openSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-universal-search'))
  }, [])

  // Start a conversation from search results
  const handleStartConversation = useCallback(
    (_userId: string) => {
      navigate('chat')
      toast.info('Найдите пользователя в чате через поиск, чтобы начать диалог')
    },
    [navigate],
  )

  return (
    <AppShell
      view={view}
      onNavigate={navigate}
      onMore={() => setMoreOpen(true)}
      onOpenSearch={openSearch}
    >
      <AnimatePresence mode="wait">
        {/* Phase 23: main-content anchor for skip-to-content link */}
        {view === 'home' && (
          <>
            {/* v25.11: unified HomeView for both mobile and desktop.
                Replaces the separate DesktopHome + mobile HomeView.
                v25.14: onOpenCategory now carries the tapped category into
                the catalog — previously the selection was discarded. */}
            <HomeView
              key="unified-home"
              onNavigate={navigate}
              onOpenProduct={openProduct}
              onOpenSearch={openSearch}
              onOpenCategory={(cat) => { setCatalogCategory(cat); navigate('catalog') }}
            />
          </>
        )}
        {view === 'catalog' && (
          <RetryableErrorBoundary key="catalog">
            <CatalogPage
              key={`catalog-${catalogCategory || 'all'}`}
              onOpenProduct={openProduct}
              initialCategory={catalogCategory}
            />
          </RetryableErrorBoundary>
        )}
        {view === 'price' && (
          <RetryableErrorBoundary key="price">
            <PriceListsPage key="price-children" onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {view === 'community' && (
          <RetryableErrorBoundary key="community">
            <CommunityView key="community-children" />
          </RetryableErrorBoundary>
        )}
        {view === 'club' && (
          <RetryableErrorBoundary key="club">
            <ClubView key="club-children" />
          </RetryableErrorBoundary>
        )}
        {view === 'games' && (
          <RetryableErrorBoundary key="games">
            <GamesHub key="games-children" />
          </RetryableErrorBoundary>
        )}
        {view === 'chat' && (
          <RetryableErrorBoundary key="chat">
            <ChatView key="chat-children" />
          </RetryableErrorBoundary>
        )}
        {view === 'profile' && (
          <RetryableErrorBoundary key="profile">
            <ProfileView key="profile-children" onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {view === 'studio' && (
          <RetryableErrorBoundary key="studio">
            {/* v16.8 production lockdown: Studio is ADMIN ONLY.
                Non-admin users who reach /?view=studio via direct URL are
                redirected to home. The iframe inside StudioView will also
                enforce auth (Studio's auth-init checks admin role + the
                backend rejects non-admin tokens on every /api/* admin route
                via requireAdmin middleware). Defense in depth. */}
            {user?.role === 'admin' ? (
              <StudioView key="studio-children" onBack={() => navigate('home')} />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                <div className="text-4xl mb-3">🔒</div>
                <h2 className="text-lg font-bold mb-1">Доступ запрещён</h2>
                <p className="text-sm text-muted-foreground">Раздел доступен только администраторам.</p>
              </div>
            )}
          </RetryableErrorBoundary>
        )}
        {view === 'search' && (
          <RetryableErrorBoundary key="search">
            <SearchPage
              key="search-children"
              onBack={() => navigate('home')}
              onOpenProduct={openProduct}
              onStartConversation={handleStartConversation}
              initialQuery={searchQuery}
            />
          </RetryableErrorBoundary>
        )}
        {view === 'orders' && (
          <RetryableErrorBoundary key="orders">
            <OrdersView key="orders-children" onNavigate={navigate} onOpenProduct={openProduct} />
          </RetryableErrorBoundary>
        )}
        {view === 'reviews' && (
          <RetryableErrorBoundary key="reviews">
            <ReviewsView key="reviews-children" onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {/* v25.6 (Task #2 + #7): 'support' view now resolves to ContactsView.
            Old SupportView (chat with support) is fully removed from the UI —
            user-facing entries route to 'contacts' instead. The 'support'
            branch is kept only so that old deep links (/?view=support from
            notifications, AI assistant actions, etc.) still land somewhere
            useful instead of showing a blank screen. */}
        {(view === 'support' || view === 'contacts') && (
          <RetryableErrorBoundary key="contacts">
            <ContactsView key="contacts-children" onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {view === 'settings' && (
          <RetryableErrorBoundary key="settings">
            <SettingsView key="settings-children" onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {view === 'privacy' && (
          <RetryableErrorBoundary key="privacy">
            <PrivacyView key="privacy-children" onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {view === 'about' && (
          <RetryableErrorBoundary key="about">
            <AboutView key="about-children" onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {view === 'info' && activeInfoSlug && (
          <RetryableErrorBoundary key="info">
            <InfoPageView key={`info-${activeInfoSlug}`} slug={activeInfoSlug} onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {view === 'admin-login' && (
          <RetryableErrorBoundary key="admin-login">
            <AdminLoginView key="admin-login-children" onBack={() => navigate('home')} onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
        {view === 'analytics' && (
          <RetryableErrorBoundary key="analytics">
            <AnalyticsView key="analytics-children" onNavigate={navigate} />
          </RetryableErrorBoundary>
        )}
      </AnimatePresence>

      <RetryableErrorBoundary key="auth-dialog">
        <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
      </RetryableErrorBoundary>
      <RetryableErrorBoundary key="more-sheet">
        <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} onNavigate={navigate} onNavigateToInfoPage={navigateToInfoPage} />
      </RetryableErrorBoundary>
      <RetryableErrorBoundary key="product-page">
        <ProductPage productId={activeProductId} onClose={closeProduct} initialProduct={activeInitialProduct} />
      </RetryableErrorBoundary>
      <RetryableErrorBoundary key="film-bottom-sheet">
        <FilmBottomSheet payload={activeFilmPayload} onClose={() => setActiveFilmPayload(null)} />
      </RetryableErrorBoundary>
    </AppShell>
  )
}

function HomeViewLegacy() {
  // v25.11: kept as a no-op placeholder — the real HomeView is imported
  // from '@/components/home/home-view'. This stub exists only to keep
  // backward-compatible references until all call sites are updated.
  return null
}
// v25.11: CatalogView moved to '@/components/catalog/catalog-page' (CatalogPage)
// — the legacy in-page CatalogView is removed.


