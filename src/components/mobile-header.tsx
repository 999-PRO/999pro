'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, Package, Music2, Search, Menu, X, Bookmark, FileSpreadsheet,
  User, Users, Film, Crown, MessageSquare, Gamepad2,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
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
    // v25.4 (perf audit P-6): skip the interval body when the tab is hidden —
    // a backgrounded PWA on iOS burns battery + mobile data polling settings
    // that almost never change. The visibilitychange handler already refetches
    // on return.
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      fetchSettings()
    }, 300000)
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
  const user = useAuthStore((s) => s.user)
  // v25.5: module access — CLUB button is conditional on the 'club' module.
  const modules = useModuleAccess()

  // If header image is enabled, render it as the header background
  const showImage = headerImage?.enabled && headerImage?.url

  // v25.15: выпадающее меню вместо кучи круглых кнопок в шапке
  // («лучше сделать выпадающее меню из этих кнопок»). В шапке остаются
  // только Поиск и Меню — всё остальное собрано в анимированной панели.
  const [menuOpen, setMenuOpen] = useState(false)
  const cartCount = useCartStore((s) => s.items.reduce((n, i) => n + i.quantity, 0))
  const ordersUnseen = useOrdersBadgeStore((s) => s.unseenCount)

  const menuNavigate = (v: string) => {
    setMenuOpen(false)
    onNavigate(v)
  }
  const menuEvent = (event: string) => {
    setMenuOpen(false)
    window.dispatchEvent(new CustomEvent(event))
  }

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
        className="relative px-4 flex items-center gap-2"
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

        {/* v39/v25.15: Кнопка 999 CLUB переехала в выпадающее меню шапки
            (иконка короны в меню) — в самой шапке осталось только два
            аккуратных действия: Поиск и Меню. */}

        <div className="flex-1" />

        {/* v25.12: Search button — gradient style, opens Universal Search */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Поиск"
          className="relative shrink-0 h-10 w-10 rounded-full grid place-items-center transition-all active:scale-95 hover:scale-105"
          style={{
            background: 'linear-gradient(135deg, #EC4899 0%, #F97316 100%)',
            boxShadow: '0 2px 8px -2px rgba(236, 72, 153, 0.4)',
            color: '#ffffff',
          }}
        >
          <Search className="h-[18px] w-[18px]" strokeWidth={2.4} />
        </button>

        {/* ═══ v25.15: ЕДИНАЯ КНОПКА МЕНЮ + выпадающая панель ═══
            Раньше здесь висели 4 круглые кнопки (CLUB / Поиск / Заказы /
            Корзина) — теперь всё собрано в одну аккуратную панель,
            открывающуюся под шапкой. */}
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Меню"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen((v) => !v) }}
            className="relative h-10 w-10 rounded-full grid place-items-center text-white transition-all active:scale-95 hover:scale-105 backdrop-blur-md"
            style={{
              background: menuOpen
                ? 'linear-gradient(135deg, #9333EA 0%, #6D28D9 100%)'
                : 'linear-gradient(135deg, #A855F7 0%, #EC4899 100%)',
              boxShadow: '0 2px 10px -2px rgba(147, 51, 234, 0.45)',
            }}
          >
            {/* Показываем индикаторы на самой кнопке: корзина и заказы.
                v25.19 (owner): «более красивая иконка меню» — кастомный
                анимированный бургер: три полоски плавно складываются в крестик. */}
            {cartCount > 0 && !menuOpen ? (
              <ShoppingBag className="h-[18px] w-[18px]" strokeWidth={2.4} />
            ) : ordersUnseen > 0 && !menuOpen ? (
              <Package className="h-[18px] w-[18px]" strokeWidth={2.4} />
            ) : (
              <span className="relative block w-[18px] h-[14px]" aria-hidden>
                <motion.span
                  className="absolute left-0 top-0 h-[2px] w-full rounded-full bg-white"
                  animate={menuOpen ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                />
                <motion.span
                  className="absolute left-0 top-[6px] h-[2px] w-full rounded-full bg-white"
                  animate={menuOpen ? { opacity: 0, scaleX: 0.3 } : { opacity: 1, scaleX: 1 }}
                  transition={{ duration: 0.2 }}
                />
                <motion.span
                  className="absolute left-0 top-[12px] h-[2px] w-full rounded-full bg-white"
                  animate={menuOpen ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
            )}
            {(cartCount > 0 || ordersUnseen > 0) && !menuOpen && (
              <span
                key={Math.max(cartCount, ordersUnseen)}
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white grid place-items-center z-20"
                style={{ color: '#A02070', fontSize: '10px', fontWeight: 800, boxShadow: '0 2px 8px rgba(160,32,112,0.35)' }}
              >
                {cartCount > 0 ? cartCount : ordersUnseen}
              </span>
            )}
          </button>

          {/* v25.21 (owner: «меню уходит за экран вверх» — БАГФИКС).
              Причина: .mobile-header-bar имеет backdrop-filter, а по CSS-spec
              backdrop-filter создаёт CONTAINING BLOCK для position:fixed
              потомков. Шит «прикреплялся» к низу ШАПКИ и уезжал вверх за
              экран. Фикс: рендерим панель через ПОРТАЛ в document.body —
              fixed снова означает «относительно вьюпорта». */}
          {typeof document !== 'undefined' && createPortal(
          <AnimatePresence>
            {menuOpen && (
              <>
                {/* invisible tap-catcher — закрывает меню по тапу мимо панели */}
                <div className="fixed inset-0 z-[40] bg-black/45" style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} onClick={() => setMenuOpen(false)} />

                {/* v25.20 (owner): «меню сделай такое же красивое, как Общение» —
                    тёмный стеклянный bottom-sheet с плитками-действиями */}
                <motion.div
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: '100%', opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }}
                  className="fixed left-0 right-0 bottom-0 z-[50] mx-auto max-w-md"
                >
                  <div
                    className="rounded-t-[30px] overflow-hidden relative"
                    style={{
                      background: 'linear-gradient(180deg, rgba(15,15,30,0.96) 0%, rgba(10,10,20,0.98) 100%)',
                      backdropFilter: 'blur(28px) saturate(160%)',
                      WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderBottom: 'none',
                      boxShadow: '0 -24px 70px -12px rgba(0,0,0,0.65)',
                      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
                    }}
                  >
                    {/* Аурора */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[70%] h-36 z-0"
                      style={{
                        background: 'radial-gradient(ellipse at center top, rgba(139,92,246,0.22) 0%, rgba(236,72,153,0.09) 48%, transparent 75%)',
                        filter: 'blur(10px)',
                      }}
                    />
                    <div aria-hidden className="absolute top-2 left-1/2 -translate-x-1/2 h-[3px] w-16 rounded-full bg-white/25 z-10" />

                    {/* Шапка панели */}
                    <div className="relative z-10 flex items-center justify-between px-5 pt-6 pb-2">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Меню</div>
                        <div className="text-base font-extrabold text-white tracking-tight">
                          {user ? (user.displayName || user.username) : 'Быстрые действия'}
                        </div>
                      </div>
                      <button
                        onClick={() => setMenuOpen(false)}
                        aria-label="Закрыть"
                        className="h-9 w-9 rounded-full grid place-items-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Плитки 3×3 */}
                    <div className="relative z-10 grid grid-cols-3 gap-2.5 px-4 pt-2">
                      <MenuTile
                        icon={<User className="h-5 w-5 text-white" />}
                        label="Профиль"
                        color="#7C5CFC"
                        onClick={() => menuNavigate('profile')}
                      />
                      <MenuTile
                        icon={<ShoppingBag className="h-5 w-5 text-white" />}
                        label="Корзина"
                        badge={cartCount > 0 ? cartCount : undefined}
                        color="#EC4899"
                        onClick={() => menuEvent('open-cart')}
                      />
                      <MenuTile
                        icon={<Package className="h-5 w-5 text-white" />}
                        label="Заказы"
                        badge={ordersUnseen > 0 ? ordersUnseen : undefined}
                        color="#F59E0B"
                        onClick={() => menuNavigate('orders')}
                      />
                      <MenuTile
                        icon={<Bookmark className="h-5 w-5 text-white" />}
                        label="Избранное"
                        color="#F43F5E"
                        onClick={() => menuNavigate('profile')}
                      />
                      <MenuTile
                        icon={<MessageSquare className="h-5 w-5 text-white" />}
                        label="Комменты"
                        color="#14B8A6"
                        onClick={() => menuEvent('open-my-comments')}
                      />
                      <MenuTile
                        icon={<Users className="h-5 w-5 text-white" />}
                        label="Сообщества"
                        color="#6366F1"
                        onClick={() => menuNavigate('community')}
                      />
                      {isModuleEnabled(modules, 'club') && (
                        <MenuTile
                          icon={<Crown className="h-5 w-5 text-white" />}
                          label="CLUB"
                          dot={clubHasUnread}
                          color="#FBBF24"
                          onClick={() => menuNavigate('club')}
                        />
                      )}
                      <MenuTile
                        icon={<Film className="h-5 w-5 text-white" />}
                        label="Видео-лента"
                        color="#A855F7"
                        onClick={() => menuEvent('open-feed')}
                      />
                      <MenuTile
                        icon={<FileSpreadsheet className="h-5 w-5 text-white" />}
                        label="Прайсы"
                        color="#10B981"
                        onClick={() => menuNavigate('price')}
                      />
                      {/* v25.23: ИГРОВОЙ КЛУБ — раздел «Игры» */}
                      <MenuTile
                        icon={<Gamepad2 className="h-5 w-5 text-white" />}
                        label="Игры"
                        color="#8B5CF6"
                        onClick={() => menuNavigate('games')}
                      />
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
          )}
        </div>
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

// v25.22: плитка меню — ПЛОСКАЯ (владелец: «кнопки-карточки должны быть
// плоские, красивые»). Без градиентов, теней и глянца: плоский цветной
// чип-иконка + подпись на спокойной панели. Бейдж/точка сохранены.
function MenuTile({
  icon,
  label,
  onClick,
  color,
  badge,
  dot,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  color: string
  badge?: number
  dot?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => {
        hapticLite()
        onClick()
      }}
      className="group flex flex-col items-center gap-1.5 px-1 py-2.5 rounded-2xl bg-white/[0.05] active:bg-white/[0.1] active:scale-95 transition-all"
    >
      <span className="relative grid place-items-center h-11 w-11 rounded-[14px] shrink-0"
        style={{ background: color }}
      >
        {icon}
        {typeof badge === 'number' && badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-[10px] font-extrabold grid place-items-center ring-2 ring-[#14121f]"
            style={{ color: '#A02070' }}
          >
            {badge > 9 ? '9+' : badge}
          </span>
        )}
        {dot && (
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-[#14121f]" />
        )}
      </span>
      <span className="text-[11px] font-semibold text-white/85 leading-none text-center">{label}</span>
    </button>
  )
}

// Лёгкий хаптик без импорта всего модуля (меню в шапке)
function hapticLite() {
  try {
    // dynamic import не нужен: модуль крошечный и уже в бандле
    // через другие компоненты; вызываем напрямую через navigator.vibrate
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(8)
  } catch {}
}

// v16.3: Orders notification badge — shows unseen order status changes.
// Increments when the backend emits `order:status-changed` (admin changed
// status). Clears when the user opens the Orders view.
function OrdersBadge() {
  const unseenCount = useOrdersBadgeStore((s) => s.unseenCount)
  if (unseenCount === 0) return null
  return <CountBadge key={unseenCount} count={unseenCount} className="-top-1 -right-1" />
}
