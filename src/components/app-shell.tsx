'use client'

import { useState, useEffect, ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'
import { MobileHeader } from './mobile-header'
import { CallManager } from './call-manager'
import { CartSheet } from './cart-sheet'
import { CheckoutSheet } from './checkout-sheet'
import { InAppNotificationToast } from './in-app-notification-toast'
import { PullToRefresh } from './pull-to-refresh'
import { SmartScrollButton } from './smart-scroll-button'
// v13.3: floating glass chat button removed — chat is now in the sidebar
// nav (NAV array in sidebar.tsx) and in the mobile bottom-nav. The floating
// button was redundant and cluttered the screen.
// import { FloatingChatButton } from './floating-chat-button'
// v16.8-attachments: глобальный мини-плеер (читает из AudioPlayerManager).
import { MiniPlayer } from './mini-player'
// v16.17: Desktop floating mini-player — appears bottom-right on desktop.
import { DesktopMiniPlayer } from './desktop-mini-player'
// v16.9.2: Audio Hub — полноэкранный плеер (открывается по клику на MiniPlayer).
import { AudioFullPlayer } from '@/modules/audio-hub/components/audio-full-player'
// v16.9.4: Audio Hub — глобальный search overlay (открывается из шапки).
import { AudioHubGlobalOverlay } from '@/modules/audio-hub/components/audio-global-overlay'
// v16.20: Media Hub — объединённый overlay с табами Audio + Films.
import { MediaHubGlobalOverlay } from '@/modules/media-hub/components/media-hub-global-overlay'
import { VideoMiniPlayer } from '@/modules/films/video-mini-player'
// v35: Universal Search — single search across products, films, audio,
// chats, users, info-pages. Opens via the sidebar/header search button
// (onOpenSearch) and via Cmd/Ctrl+K.
import { UniversalSearchGlobalOverlay } from '@/components/universal-search/universal-search-global-overlay'
// v18.5: AI Assistant — global floating button + premium overlay.
// Mounted in AppShell so it appears on every view (home, catalog, chat,
// audio hub, video hub, media hub, studio, profile, settings, …).
import { AIAssistant } from '@/modules/ai-assistant'
import type { Product } from '@/lib/types'
import { useOrdersBadgeStore } from '@/lib/orders-badge-store'
import { useAuthStore } from '@/lib/auth-store'

/** App shell: persistent sidebar on desktop, header + bottom nav on mobile. */
export function AppShell({
  view,
  onNavigate,
  onMore,
  onOpenSearch,
  children,
}: {
  view: string
  onNavigate: (v: string) => void
  onMore: () => void
  onOpenSearch: () => void
  children: ReactNode
}) {
  const [cartOpen, setCartOpen] = useState(false)

  // v16.1: CheckoutSheet is now mounted at the AppShell root (NOT inside
  // CartSheet's InteractiveSheet). Previously it was a child of CartSheet,
  // which wraps it in a framer-motion `transform`-based container — that
  // transform creates a containing block that breaks `position: fixed`,
  // so the checkout's `fixed inset-0 z-[250]` only covered the CartSheet
  // area, leaving MobileHeader (z-30) visible above it on mobile.
  //
  // Now both CartSheet and product pages dispatch `open-checkout` events:
  //   - cart flow:         window.dispatchEvent(new CustomEvent('open-checkout'))
  //   - buy-now flow:      window.dispatchEvent(new CustomEvent('open-checkout',
  //                              { detail: { items: [{productId, quantity}], products: {...} } }))
  // AppShell listens, opens CheckoutSheet as a true sibling (no transformed
  // ancestor), and `fixed inset-0 z-[250]` correctly covers the viewport.
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutItems, setCheckoutItems] = useState<{ productId: string; quantity: number }[] | undefined>(undefined)
  const [checkoutProducts, setCheckoutProducts] = useState<Record<string, Product>>({})

  // Global listener for "open-cart" events so the cart icon works from any
  // view (home, catalog, feed, chat, profile) — not just profile.
  useEffect(() => {
    const onOpenCart = () => setCartOpen(true)
    window.addEventListener('open-cart', onOpenCart)
    return () => window.removeEventListener('open-cart', onOpenCart)
  }, [])

  // Global listener for "open-checkout" events.
  useEffect(() => {
    const onOpenCheckout = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { items?: { productId: string; quantity: number }[]; products?: Record<string, Product> }
        | undefined
      if (detail?.items) {
        setCheckoutItems(detail.items)
        setCheckoutProducts(detail.products || {})
      } else {
        // Cart flow — clear override so CheckoutSheet reads from cart store
        setCheckoutItems(undefined)
        setCheckoutProducts({})
      }
      setCheckoutOpen(true)
      // v16.2: close the cart sheet so its scroll-lock doesn't interfere
      // with the checkout sheet's own scroll. Both call useScrollLock, but
      // having two overlays stacked causes visual confusion and the cart's
      // InteractiveSheet transform can still affect the checkout layer.
      setCartOpen(false)
    }
    window.addEventListener('open-checkout', onOpenCheckout)
    return () => window.removeEventListener('open-checkout', onOpenCheckout)
  }, [])

  // v16.3: Global listener for order status changes — increments the
  // "Мои заказы" notification badge when the user is NOT currently viewing
  // the orders page. When they ARE on orders, orders-view.tsx handles the
  // event directly (updates state + toast) and clears the badge on mount.
  const incrementOrdersBadge = useOrdersBadgeStore((s) => s.increment)
  const authed = useAuthStore((s) => s.isAuthenticated)
  useEffect(() => {
    if (!authed) return
    const onOrderStatus = () => {
      // Only increment if the user is NOT on the orders view — when they are,
      // orders-view.tsx already shows a toast + clears the badge on mount.
      if (view !== 'orders') incrementOrdersBadge()
    }
    window.addEventListener('order:status-changed', onOrderStatus as EventListener)
    return () => window.removeEventListener('order:status-changed', onOrderStatus as EventListener)
  }, [authed, view, incrementOrdersBadge])

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar — compact premium rail (76px / 88px on xl) */}
      <Sidebar view={view} onNavigate={onNavigate} onMore={onMore} onOpenSearch={onOpenSearch} />

      {/* Main column — offset for fixed sidebar on desktop */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-[76px] xl:ml-[88px]">
        <MobileHeader view={view} onNavigate={onNavigate} onOpenSearch={onOpenSearch} />
        {/* v20: email verification banner completely removed from app shell.
            Verification prompts now only appear contextually at order
            checkout (see EmailVerificationModal in checkout-sheet.tsx). */}

        <PullToRefresh>
          <main id="main-content" tabIndex={-1} className="app-main flex-1 w-full min-w-0 outline-none">{children}</main>
        </PullToRefresh>

        {/* Mobile fixed bottom nav — always at the bottom */}
        <BottomNav view={view} onNavigate={onNavigate} onMore={onMore} />

      {/* v16.8-attachments: глобальный мини-плеер. Показывается когда
          в AudioPlayerManager есть активный трек. Живёт в app-shell,
          поэтому переживает переходы между видами — музыка продолжает играть. */}
      <MiniPlayer />

      {/* v16.17: Desktop floating mini-player — appears bottom-right on
          desktop (md+). Hidden on mobile (mobile uses HeaderAudioPlayer
          in the mobile header + MiniPlayer). Click opens full player. */}
      <DesktopMiniPlayer />

      {/* v16.9.2: Audio Hub полноэкранный плеер. Открывается по клику на
          MiniPlayer (событие 'open-music-player'). Живёт в app-shell,
          поэтому доступен из любого вида. */}
      <AudioFullPlayer />

      {/* v16.9.4: Audio Hub глобальный search overlay. Открывается из шапки
          (событие 'open-audio-hub'). Позволяет искать и слушать музыку с
          любой страницы приложения. */}
      <AudioHubGlobalOverlay />

      {/* v16.20: Media Hub — объединённый overlay с табами Audio + Films.
          Открывается событием 'open-media-hub' из sidebar / header. */}
      <MediaHubGlobalOverlay />

      {/* v20: Video mini-player — плавающее окно PiP когда пользователь вышел из плеера */}
      <VideoMiniPlayer />

      {/* v35: Universal Search overlay — listens for 'open-universal-search'
          events and the Cmd/Ctrl+K shortcut. Triggered from sidebar / mobile
          header search buttons via onOpenSearch → window event dispatch. */}
      <UniversalSearchGlobalOverlay />

      {/* v18.5: AI Assistant — premium floating button + overlay. Available
          on every view (home, catalog, chat, audio hub, video hub, media hub,
          studio, profile, settings, …). Pass the current view as context so
          DeepSeek gets page-aware hints. */}
      <AIAssistant
        context={view}
        onNavigate={onNavigate}
        onOpenCart={() => setCartOpen(true)}
      />
      </div>

      <SmartScrollButton />

      <CallManager />

      {/* Global cart sheet — controlled by `open-cart` events so the cart
          button in the header works from any view. */}
      <CartSheet open={cartOpen} onClose={() => setCartOpen(false)} />

      {/* v16.1: Global checkout sheet — sibling of CartSheet (NOT a child).
          Mounted at AppShell root so `position: fixed` is relative to the
          viewport, not a transformed ancestor. Opens via `open-checkout`
          events from both the cart and product pages. */}
      <CheckoutSheet
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        products={checkoutProducts}
        itemsOverride={checkoutItems}
        skipCartClear={!!checkoutItems}
        onOrderCreated={() => { setCheckoutOpen(false); setCartOpen(false) }}
        onNavigate={onNavigate}
      />

      {/* In-app notification toast — floating top card shown when a message
          arrives in a conversation the user is NOT currently viewing.
          Mounted globally so it appears over any view. */}
      <InAppNotificationToast />
    </div>
  )
}
