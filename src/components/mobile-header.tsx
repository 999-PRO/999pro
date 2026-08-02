'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingBag, Package, Music2 } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { useCartStore } from '@/lib/cart-store'
import { useOrdersBadgeStore } from '@/lib/orders-badge-store'
import { useClubStore } from '@/modules/999-club'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { CountBadge } from '@/components/ui/count-badge'
import type { HeaderImageSetting } from '@/lib/types'
// v25.5 (TZ-3 task #10): module access filtering — CLUB button conditional.
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'

export function MobileHeader({
  view,
  onNavigate,
  onOpenSearch,
}: {
  // v12.8: `view` prop — kept for potential future conditional rendering,
  // but v12.6.2 removed the Search button from ALL pages (search is now
  // always visible in normal flow on the Home page, and other pages don't
  // need a header search button). The Orders button is shown on all pages.
  view: string
  onNavigate: (v: string) => void
  onOpenSearch: () => void
}) {
  const [headerImage, setHeaderImage] = useState<HeaderImageSetting | null>(null)
  const [appTitle, setAppTitle] = useState('')

  // Fetch header image + app title settings from /api/settings/*
  // v8-audit-fix: refetch when page becomes visible (so Studio changes appear immediately)
  const fetchSettings = useCallback(() => {
    let alive = true
    Promise.all([
      api.get<{ value: HeaderImageSetting | null }>('/api/settings/headerImage'),
      api.get<{ value: string | null }>('/api/settings/appTitle'),
    ])
      .then(([hd, td]) => {
        if (!alive) return
        if (hd.value && typeof hd.value === 'object') {
          setHeaderImage(hd.value as HeaderImageSetting)
        } else {
          setHeaderImage(null)
        }
        if (typeof td.value === 'string') {
          setAppTitle(td.value)
        } else {
          setAppTitle('')
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const cleanup = fetchSettings()
    // Refetch when tab becomes visible again (user returned from Studio)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchSettings()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    // v13.1 (audit P3-8 fix): refetch every 5 minutes instead of 30 seconds.
    // Settings rarely change — 30s polling was wasteful (6× more requests
    // than needed). 5min is still fast enough that PWA picks up Studio
    // changes within a reasonable window. visibilitychange handler above
    // covers the "user returns to the app" case with an immediate refresh.
    const interval = setInterval(fetchSettings, 300000)
    return () => {
      cleanup()
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [fetchSettings])

  // v16.5: Instant refresh — when Studio saves headerImage or appTitle,
  // refetch immediately instead of waiting up to 5 minutes.
  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined
      if (detail?.key === 'headerImage' || detail?.key === 'appTitle' || detail?.key === 'headerEnabled') {
        fetchSettings()
      }
    }
    window.addEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
    return () => window.removeEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
  }, [fetchSettings])

  // v25: Audio playing state for header glow animation
  const isAudioPlaying = useAudioPlayer((s) => s.isPlaying)
  const hasAudioTrack = useAudioPlayer((s) => !!s.currentTrack)
  const currentTrack = useAudioPlayer((s) => s.currentTrack)

  // v39: CLUB unread state for the header badge
  const clubHasUnread = useClubStore((s) => s.hasUnread)
  // v25.5: module access — CLUB button is conditional on the 'club' module.
  const modules = useModuleAccess()

  // If header image is enabled, render it as the header background
  const showImage = headerImage?.enabled && headerImage?.url

  return (
    <header
      className="md:hidden fixed top-0 left-0 right-0 z-30 mobile-header-bar"
      style={{
        // v8-audit-fix: flat header — no rounded corners, no shadow (native app feel)
        borderTopLeftRadius: '0',
        borderTopRightRadius: '0',
        borderBottomLeftRadius: '28px',
        borderBottomRightRadius: '28px',
        boxShadow: 'none',
        // Deeper, more saturated gradient (alpha 0.92 instead of 0.55) so
        // the header reads as a solid native app bar on Android rather than
        // a translucent "web page" overlay.
        backgroundImage: showImage
          ? `url(${JSON.stringify(assetUrl(headerImage!.url))}), var(--mobile-header-bg)`
          : 'var(--mobile-header-bg)',
        backgroundSize: showImage ? 'cover' : undefined,
        backgroundPosition: showImage
          ? headerImage!.position === 'top'
            ? 'top'
            : headerImage!.position === 'bottom'
              ? 'bottom'
              : 'center'
          : undefined,
        backgroundRepeat: 'no-repeat',
        // Strong backdrop blur for the glassy frosted effect
        overflow: 'visible',
      }}
    >
      {/* v25: Neon glow overlay when audio is playing — soft breathing light */}
      {hasAudioTrack && isAudioPlaying && (
        <motion.div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(99,102,241,0.08) 20%, rgba(139,92,246,0.12) 50%, rgba(99,102,241,0.08) 80%, transparent 100%)',
            filter: 'blur(12px)',
          }}
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {hasAudioTrack && !isAudioPlaying && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(99,102,241,0.04) 50%, transparent 100%)',
            filter: 'blur(12px)',
          }}
        />
      )}

      {/* v28: Blur the header BACKGROUND (image/gradient) when music plays */}
      <AnimatePresence>
        {hasAudioTrack && isAudioPlaying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 pointer-events-none"
            style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          />
        )}
      </AnimatePresence>

      {/* Content row — NOT blurred, buttons stay interactive */}
      <div
        className="relative px-4 flex items-center gap-2 overflow-hidden"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.65rem)',
          paddingBottom: '0.85rem',
          minHeight: 'calc(env(safe-area-inset-top) + 3.25rem)',
        }}
      >
        {/* Wordmark — left side.
            v23: Бренд «999 / Три девятки» убран из шапки главной страницы.
            Шапка остаётся чистой — название используется только там, где оно
            действительно нужно (экран загрузки, профиль, о приложении).
            Если администатор задал кастомный appTitle в Studio — показываем его. */}
        {appTitle ? (
          <button
            onClick={() => onNavigate('home')}
            className="shrink-0"
            aria-label="На главную"
          >
            <span className="font-extrabold text-xl tracking-tight text-white drop-shadow-sm">
              {appTitle}
            </span>
          </button>
        ) : null}

        {/* v39: 999 CLUB button — moved here from the bottom-nav center slot.
            Media Hub moved to the bottom-nav center (replaces CLUB there).
            Club uses the same round glass style + amber gradient to match
            the desktop sidebar treatment.
            v25.5: conditional on module access (club). */}
        {isModuleEnabled(modules, 'club') && (
        <motion.button
          type="button"
          aria-label="999 CLUB"
          whileTap={{ scale: 0.85 }}
          whileHover={{ scale: 1.1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          onClick={() => onNavigate('club')}
          className="shrink-0 h-10 w-10 rounded-full grid place-items-center relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)',
            border: '1px solid rgba(255,255,255,0.25)',
            boxShadow: '0 2px 12px -2px rgba(245,158,11,0.5)',
          }}
        >
          {/* Crown icon (lucide Crown) — amber-tinted */}
          <svg
            className="h-[18px] w-[18px] relative z-10 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" />
            <path d="M5 20h14" />
          </svg>
          {/* CLUB unread badge — amber pulsing dot */}
          {clubHasUnread && (
            <span
              className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full animate-pulse z-20"
              style={{
                background: '#fff',
                boxShadow: '0 0 8px rgba(255, 255, 255, 0.9)',
              }}
            />
          )}
        </motion.button>
        )}

        <div className="flex-1" />

        {/* v12.6.2: "Мои заявки" (Orders) button — replaces the Search button
            on ALL pages. The Search button has been removed entirely because
            the search bar is now always visible in normal flow on the Home
            page (no header button needed). Same round glass style as the
            other header buttons. Opens the orders view. */}
        <button
          type="button"
          onClick={() => onNavigate('orders')}
          aria-label="Мои заказы"
          className="relative shrink-0 h-10 w-10 rounded-full grid place-items-center transition-all active:scale-95 hover:scale-105"
          style={{
            background: 'rgba(15,23,42,0.35)',
            backdropFilter: 'blur(12px) saturate(160%)',
            WebkitBackdropFilter: 'blur(12px) saturate(160%)',
            border: '1px solid rgba(255,255,255,0.25)',
            color: '#ffffff',
          }}
        >
          <Package className="h-[18px] w-[18px]" strokeWidth={2.4} />
          <OrdersBadge />
        </button>

        {/* Cart icon — round glass card with badge */}
        <button
          type="button"
          aria-label="Корзина"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('open-cart'))
            }
          }}
          className="relative shrink-0 h-10 w-10 rounded-full grid place-items-center transition-all active:scale-95 hover:scale-105"
          style={{
            // v8-audit-fix: dark glass so buttons are visible on light/white headers too
            background: 'rgba(15,23,42,0.35)',
            backdropFilter: 'blur(12px) saturate(160%)',
            WebkitBackdropFilter: 'blur(12px) saturate(160%)',
            border: '1px solid rgba(255,255,255,0.25)',
            color: '#ffffff',
          }}
        >
          <ShoppingBag className="h-[18px] w-[18px]" strokeWidth={2.4} />
          <CartBadge />
        </button>
      </div>

      {/* v31: Music block — NO square, real frequency analysis, centered */}
      <AnimatePresence>
        {hasAudioTrack && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 360, damping: 25 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.65rem)', paddingBottom: '0.85rem' }}
          >
            {/* Track title */}
            {currentTrack?.title && (
              <div className="absolute top-[calc(env(safe-area-inset-top)+1px)] left-1/2 -translate-x-1/2 w-[50%] max-w-[180px] overflow-hidden">
                <motion.div
                  key={currentTrack.title}
                  initial={{ opacity: 0 }}
                  animate={{
                    x: currentTrack.title.length > 18 ? ['0%', '-50%'] : '0%',
                  }}
                  transition={{
                    x: currentTrack.title.length > 18
                      ? { duration: 6, repeat: Infinity, ease: 'linear', repeatType: 'loop' }
                      : { duration: 0.3 },
                    opacity: { duration: 0.3 },
                  }}
                  className="whitespace-nowrap text-center"
                  style={{
                    color: 'rgba(255,255,255,0.8)',
                    fontSize: '9px',
                    fontWeight: 400,
                    letterSpacing: '0.02em',
                    textShadow: '0 0 8px rgba(139,92,246,0.5)',
                  }}
                >
                  {currentTrack.title}
                </motion.div>
              </div>
            )}

            {/* Left wave — smooth framer-motion bars */}
            <div className="flex items-center gap-[2px] mr-2 pointer-events-none" style={{ height: '28px' }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <motion.span
                  key={`l${i}`}
                  style={{
                    width: '2px',
                    borderRadius: '2px',
                    background: 'linear-gradient(to top, #6366f1, #8b5cf6)',
                    height: '100%',
                    transformOrigin: 'center',
                    filter: 'drop-shadow(0 0 2px rgba(139,92,246,0.5))',
                  }}
                  animate={isAudioPlaying
                    ? { scaleY: [0.15, 0.9, 0.3, 0.7, 0.2, 0.85, 0.15] }
                    : { scaleY: 0.1 }
                  }
                  transition={isAudioPlaying
                    ? { duration: 0.8 + i * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.06 }
                    : { duration: 0.5, ease: 'easeOut' }
                  }
                />
              ))}
            </div>

            {/* Central circle — ZERO square, pure circle */}
            <div
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('open-music-player'))
                }
              }}
              style={{
                position: 'relative',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                pointerEvents: 'auto',
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              {/* Conic gradient ring */}
              <motion.div
                style={{
                  position: 'absolute',
                  inset: '0',
                  borderRadius: '50%',
                  background: 'conic-gradient(from 0deg, transparent 0%, rgba(99,102,241,0.4) 25%, rgba(139,92,246,0.6) 50%, rgba(236,72,153,0.4) 75%, transparent 100%)',
                  filter: 'blur(2px)',
                }}
                animate={isAudioPlaying ? { rotate: 360 } : { rotate: 0 }}
                transition={isAudioPlaying ? { duration: 3, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
              />
              {/* Radial glow */}
              <motion.div
                style={{
                  position: 'absolute',
                  inset: '0',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)',
                }}
                animate={isAudioPlaying ? { scale: [1, 1.3, 1], opacity: [0.6, 0.3, 0.6] } : { scale: 1, opacity: 0.2 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* Pulsing ring */}
              <motion.div
                style={{
                  position: 'absolute',
                  inset: '0',
                  borderRadius: '50%',
                  border: '1.5px solid rgba(139,92,246,0.4)',
                }}
                animate={isAudioPlaying ? { scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] } : { scale: 1, opacity: 0 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* Cover — pure circle via CSS, no overflow-hidden, no square */}
              <motion.div
                style={{
                  position: 'relative',
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  zIndex: 10,
                  filter: 'drop-shadow(0 0 6px rgba(139,92,246,0.5))',
                }}
                animate={isAudioPlaying ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                {currentTrack?.coverUrl ? (
                  <motion.img
                    src={currentTrack.coverUrl}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                    animate={isAudioPlaying ? { rotate: 360 } : { rotate: 0 }}
                    transition={isAudioPlaying ? { duration: 8, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
                  />
                ) : (
                  <div style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
                    display: 'grid',
                    placeItems: 'center',
                  }}>
                    <Music2 className="h-3 w-3 text-white" />
                  </div>
                )}
              </motion.div>
            </div>

            {/* Right wave — smooth framer-motion bars, mirrored */}
            <div className="flex items-center gap-[2px] ml-2 pointer-events-none" style={{ height: '28px' }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <motion.span
                  key={`r${i}`}
                  style={{
                    width: '2px',
                    borderRadius: '2px',
                    background: 'linear-gradient(to top, #8b5cf6, #ec4899)',
                    height: '100%',
                    transformOrigin: 'center',
                    filter: 'drop-shadow(0 0 2px rgba(236,72,153,0.5))',
                  }}
                  animate={isAudioPlaying
                    ? { scaleY: [0.85, 0.2, 0.7, 0.15, 0.9, 0.3, 0.85] }
                    : { scaleY: 0.1 }
                  }
                  transition={isAudioPlaying
                    ? { duration: 0.8 + i * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.06 }
                    : { duration: 0.5, ease: 'easeOut' }
                  }
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

function CartBadge() {
  const count = useCartStore((s) => s.items.reduce((n, i) => n + i.quantity, 0))
  if (count === 0) return null
  return <CountBadge key={count} count={count} className="-top-1 -right-1" />
}

// v16.3: Orders notification badge — shows unseen order status changes.
// Increments when the backend emits `order:status-changed` (admin changed
// status). Clears when the user opens the Orders view.
function OrdersBadge() {
  const unseenCount = useOrdersBadgeStore((s) => s.unseenCount)
  if (unseenCount === 0) return null
  return <CountBadge key={unseenCount} count={unseenCount} className="-top-1 -right-1" />
}
