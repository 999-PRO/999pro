'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { X, Share2, Download, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react'
import { assetUrl } from '@/lib/api'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { haptic } from '@/lib/haptic'
import { useIsDesktop } from '@/lib/use-media-query'

interface ImageLightboxProps {
  images: string[]
  initialIndex: number
  open: boolean
  onClose: () => void
}

/**
 * Full-screen image viewer — v12.2 redesign.
 *
 * v12.2 changes (multi-photo gallery + glassmorphism panels):
 *   • Top bar (glassmorphism): ✕ Close (left) | "X / Y" counter (center) |
 *     Share, Download, More (right).
 *   • Bottom bar (glassmorphism): horizontal thumbnail strip — always
 *     visible (replaces dot indicators). Click any thumbnail to jump.
 *     Active thumbnail has a 2px brand-color ring.
 *   • Auto-hide: top + bottom panels fade out after 3s of inactivity.
 *     Any touch / click / mousemove brings them back. They also stay
 *     hidden while the image is zoomed (scale > 1) or during an active
 *     gesture (pinch / pan / swipe / close).
 *   • Android back button: pushes a history entry on open, listens for
 *     popstate to close (matches native Android viewer UX).
 *   • Haptic feedback on prev/next/thumbnail navigation.
 *   • lucide-react icons (was inline SVG).
 *
 * Preserved from v12.1:
 *   • Pinch-to-zoom (1× → 5×).
 *   • Double-tap zoom (1× ↔ 2.5×).
 *   • Pan when zoomed (drag to move).
 *   • Swipe left/right for gallery navigation.
 *   • Swipe down to close (Instagram-style spring fade).
 *   • Bidirectional navigation (no "one-way" bug).
 *   • Keyboard: Escape (close), ArrowLeft (prev), ArrowRight (next).
 *   • Theme-aware backdrop (dark / light).
 *   • `data-zoom-allowed` attribute on the <img> (required to bypass the
 *     global pinch-zoom blocker in layout.tsx). v12.2.1: moved from the
 *     root div to the <img> so the thumbnail strip can scroll.
 *   • useScrollLock + useFocusTrap (unchanged).
 *   • Preloading of adjacent images.
 *
 * Bug fixes:
 *   • Pan-accumulation: the previous code committed `panX + (curX - startX)`
 *     in onTouchEnd AFTER onTouchMove had already set `panX = curX - startX`,
 *     doubling the delta. Now pan uses a `panBaseX/panBaseY` captured at
 *     gesture start so each gesture is independent.
 *
 * Performance:
 *   • Adjacent images preloaded via `new Image()` for instant swipe.
 *   • Thumbnails use `loading="lazy"` (only the visible ones load).
 *   • `will-change: transform` on the main image only.
 */
export function ImageLightbox({ images, initialIndex, open, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex)
  // Zoom state — per-photo so switching photos resets zoom
  const [scale, setScale] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [isClosing, setIsClosing] = useState(false)
  const [swipeDownY, setSwipeDownY] = useState(0)
  // v12.2: auto-hide UI panels (top bar + bottom thumbnail strip).
  // Panels are visible by default; they fade out after 3s of inactivity.
  // They are FORCED hidden while the image is zoomed (scale > 1) or during
  // an active gesture (so they don't distract from the photo).
  const [uiVisible, setUiVisible] = useState(true)
  // v12.2: small "more" dropdown menu (Open in new tab / Copy link).
  const [moreOpen, setMoreOpen] = useState(false)
  // v12.2: optional toast-style status line (e.g. "Ссылка скопирована").
  const [toast, setToast] = useState<string | null>(null)

  const { resolvedTheme } = useTheme()
  // v20: support 3 themes — light, dark, neon. Neon uses brand gradients
  // with soft glow; light uses clean white glass; dark uses slate glass.
  const isDark = resolvedTheme === 'dark'
  const isNeon = resolvedTheme === 'neon'
  const isLight = !isDark && !isNeon
  // v12.2.1: navigation arrows are desktop-only. On mobile, users navigate
  // via swipe gestures + the bottom thumbnail strip — on-screen arrows would
  // cover the photo unnecessarily on small touch screens.
  const isDesktop = useIsDesktop()

  // Touch tracking refs (avoid re-renders during gesture)
  const touchRef = useRef<{
    mode: 'none' | 'swipe' | 'pinch' | 'pan' | 'close'
    startX: number
    startY: number
    startTime: number
    curX: number
    curY: number
    initialDistance: number
    initialScale: number
    lastTapTime: number
    moved: boolean
    // v12.2-fix: pan base captured at gesture start so each pan gesture
    // is independent (no double-accumulate bug from previous version).
    panBaseX: number
    panBaseY: number
  }>({
    mode: 'none',
    startX: 0, startY: 0, startTime: 0,
    curX: 0, curY: 0,
    initialDistance: 0, initialScale: 1,
    lastTapTime: 0,
    moved: false,
    panBaseX: 0,
    panBaseY: 0,
  })

  // v12.2: auto-hide timer ref. Reset on any user activity.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v12.2: thumbnail strip ref — used to scroll the active thumbnail into view.
  const stripRef = useRef<HTMLDivElement>(null)
  // v12.2: per-thumbnail ref array for scroll-into-view.
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (open) {
      setIndex(initialIndex)
      setScale(1)
      setPanX(0)
      setPanY(0)
      setSwipeDownY(0)
      setIsClosing(false)
      setUiVisible(true)
      setMoreOpen(false)
      setToast(null)
    }
  }, [open, initialIndex])

  // Reset zoom when switching photos
  const goToIndex = useCallback((newIndex: number) => {
    if (images.length === 0) return
    if (newIndex < 0 || newIndex >= images.length) return
    if (newIndex === index) return
    haptic.select()
    setIndex(newIndex)
    setScale(1)
    setPanX(0)
    setPanY(0)
    setSwipeDownY(0)
    setMoreOpen(false)
  }, [images.length, index])

  const next = useCallback(() => {
    if (index < images.length - 1) goToIndex(index + 1)
  }, [index, images.length, goToIndex])

  const prev = useCallback(() => {
    if (index > 0) goToIndex(index - 1)
  }, [index, goToIndex])

  // Esc + arrow keys (existing behaviour preserved)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, prev, next, onClose])

  // v12.2: Android back button — push a history entry on open so the
  // hardware/software back button closes the lightbox instead of navigating
  // away from the page. Restores the entry on close.
  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined' || typeof history === 'undefined') return
    // Only push if we're not already on our marker (avoids stacking)
    if (history.state?.lightboxOpen) return
    history.pushState({ lightboxOpen: true }, '')
    const onPop = () => {
      // Back button pressed while lightbox is open → close.
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // If the lightbox is closing for any reason (Esc, backdrop, swipe-down),
      // pop our marker so the next back-button press doesn't double-fire.
      if (history.state?.lightboxOpen) {
        history.back()
      }
    }
  }, [open, onClose])

  // v12.2.1: `preserveTouchAction: true` tells useScrollLock NOT to set
  // `body.style.touchAction = 'none'`. That CSS property, when set on body,
  // intersects with the thumbnail strip's `touch-action: pan-x` down to
  // `none` (per CSS Touch Action spec — intersection walks all ancestors),
  // which is why the strip wasn't scrollable on mobile. Background scroll
  // is still blocked by `overflow: hidden` (desktop) + the `touchmove`
  // preventDefault listener (iOS rubber-band) inside useScrollLock.
  useScrollLock(open, { preserveTouchAction: true })
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, open)

  // Preload adjacent images for instant swipe navigation.
  useEffect(() => {
    if (!open || images.length === 0) return
    const preload = (i: number) => {
      if (i < 0 || i >= images.length) return
      const url = images[i]
      if (!url) return
      const img = new window.Image()
      img.src = assetUrl(url)
    }
    preload(index + 1)
    preload(index - 1)
  }, [open, index, images])

  // v12.2: scroll the active thumbnail into view (smooth, non-aggressive).
  useEffect(() => {
    if (!open) return
    // Keep the ref array sized to the images array (avoids sparse null slots
    // if the gallery is reused with a different set of images).
    thumbRefs.current.length = images.length
    const el = thumbRefs.current[index]
    if (!el || !stripRef.current) return
    const container = stripRef.current
    const elLeft = el.offsetLeft
    const elRight = elLeft + el.offsetWidth
    const viewLeft = container.scrollLeft
    const viewRight = viewLeft + container.clientWidth
    if (elLeft < viewLeft + 8 || elRight > viewRight - 8) {
      container.scrollTo({
        left: elLeft - container.clientWidth / 2 + el.offsetWidth / 2,
        behavior: 'smooth',
      })
    }
  }, [index, open, images.length])

  // v12.2: auto-hide panels after 3s of inactivity. Cancelled during zoom
  // or active gesture. Re-armed on any user activity (touchstart / click /
  // mousemove). We rely on touchRef.current.mode to detect active gestures.
  useEffect(() => {
    if (!open) return
    if (!uiVisible) return
    if (scale > 1) return // never auto-hide timer when zoomed (forced hidden anyway)
    if (touchRef.current.mode !== 'none') return
    if (moreOpen) return // keep visible while menu is open
    hideTimerRef.current = setTimeout(() => {
      // Double-check we're still idle (user may have just touched)
      if (touchRef.current.mode === 'none' && scale === 1 && !moreOpen) {
        setUiVisible(false)
      }
    }, 3000)
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [open, uiVisible, scale, moreOpen, index])

  // v12.2: helper to (re)show the panels and re-arm the auto-hide timer.
  const revealUi = useCallback(() => {
    if (!uiVisible) setUiVisible(true)
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [uiVisible])

  // Auto-hide toast after 1.6s
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1600)
    return () => clearTimeout(t)
  }, [toast])

  // --- Touch handlers ---
  // PRESERVED from v12.1, with two fixes:
  //   1. Pan-accumulation bug (was double-applying the delta on touchend).
  //   2. Auto-hide: any touchstart reveals the panels.
  const getDistance = (t1: React.Touch, t2: React.Touch): number => {
    const dx = t1.clientX - t2.clientX
    const dy = t1.clientY - t2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches
    touchRef.current.moved = false
    // v12.2: any touch reveals the UI panels and re-arms the auto-hide timer
    revealUi()
    if (t.length === 2) {
      // Pinch start
      touchRef.current.mode = 'pinch'
      touchRef.current.initialDistance = getDistance(t[0], t[1])
      touchRef.current.initialScale = scale
      haptic.heavy()
    } else if (t.length === 1) {
      const touch = t[0]
      // Double-tap detection
      const now = Date.now()
      if (now - touchRef.current.lastTapTime < 300 && scale === 1) {
        // Double-tap → toggle zoom
        setScale(scale === 1 ? 2.5 : 1)
        setPanX(0)
        setPanY(0)
        touchRef.current.lastTapTime = 0
        return
      }
      touchRef.current.lastTapTime = now

      touchRef.current.startX = touch.clientX
      touchRef.current.startY = touch.clientY
      touchRef.current.startTime = now
      touchRef.current.curX = touch.clientX
      touchRef.current.curY = touch.clientY
      // v12.2-fix: capture pan base so each gesture is independent
      touchRef.current.panBaseX = panX
      touchRef.current.panBaseY = panY
      touchRef.current.mode = scale > 1 ? 'pan' : 'swipe'
      setSwipeDownY(0)
      setIsClosing(false)
    }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches
    touchRef.current.moved = true
    if (t.length === 2 && touchRef.current.mode === 'pinch') {
      e.preventDefault()
      const dist = getDistance(t[0], t[1])
      const newScale = Math.max(1, Math.min(5, (dist / touchRef.current.initialDistance) * touchRef.current.initialScale))
      setScale(newScale)
      if (newScale === 1) {
        setPanX(0)
        setPanY(0)
      }
    } else if (t.length === 1) {
      const touch = t[0]
      touchRef.current.curX = touch.clientX
      touchRef.current.curY = touch.clientY
      const dx = touch.clientX - touchRef.current.startX
      const dy = touch.clientY - touchRef.current.startY

      if (touchRef.current.mode === 'pan' && scale > 1) {
        // Pan when zoomed — v12.2-fix: use panBase so each gesture is independent
        e.preventDefault()
        setPanX(touchRef.current.panBaseX + dx)
        setPanY(touchRef.current.panBaseY + dy)
      } else if (touchRef.current.mode === 'swipe') {
        // if vertical movement dominates AND is downward → close gesture
        // if horizontal dominates → gallery swipe (handled on touchend)
        if (dy > 20 && Math.abs(dy) > Math.abs(dx)) {
          touchRef.current.mode = 'close'
          setSwipeDownY(Math.max(0, dy))
        } else if (Math.abs(dx) > Math.abs(dy)) {
          // Horizontal swipe — track for snap-back or navigation on release
          // (we don't move the image during swipe; we navigate on touchend)
        }
      } else if (touchRef.current.mode === 'close') {
        setSwipeDownY(Math.max(0, dy))
      }
    }
  }

  const onTouchEnd = () => {
    const t = touchRef.current
    if (t.mode === 'pinch') {
      // If zoomed back to 1, reset pan
      if (scale <= 1.1) {
        setScale(1)
        setPanX(0)
        setPanY(0)
      }
      t.mode = 'none'
      // v12.2: re-arm the auto-hide timer after pinch ends
      revealUi()
      return
    }

    if (t.mode === 'pan') {
      // v12.2-fix: NO commit here. onTouchMove already set the correct value
      // using panBase. Just reset mode for the next gesture.
      t.mode = scale > 1 ? 'pan' : 'swipe'
      revealUi()
      return
    }

    if (t.mode === 'close') {
      // If swipe-down exceeded threshold → close
      if (swipeDownY > 120) {
        setIsClosing(true)
        setTimeout(onClose, 200)
      } else {
        setSwipeDownY(0)
      }
      t.mode = 'none'
      revealUi()
      return
    }

    // Swipe mode — was it a tap or a swipe?
    const dx = t.curX - t.startX
    const threshold = 50

    if (!t.moved) {
      // Tap — toggle UI visibility (matches iOS Photos behavior:
      // tapping the photo hides/shows the chrome).
      t.mode = 'none'
      setUiVisible((v) => !v)
      return
    }

    // Bidirectional navigation — both left and right swipes work
    if (dx < -threshold) {
      next()
    } else if (dx > threshold) {
      prev()
    }
    t.mode = 'none'
    revealUi()
  }

  // v12.2: Share / Download / More handlers — mirror the existing patterns
  // from chat.tsx context-menu (lines 1936-1954).
  const handleShare = useCallback(async () => {
    const url = images[index]
    if (!url) return
    setMoreOpen(false)
    haptic.tap()
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: '999 — Три девятки',
          url: assetUrl(url),
        })
      } catch {
        // user cancelled — no-op
      }
    } else {
      // Fallback: copy link to clipboard
      try {
        await navigator.clipboard.writeText(assetUrl(url))
        setToast('Ссылка скопирована')
      } catch {
        setToast('Не удалось поделиться')
      }
    }
  }, [images, index])

  const handleDownload = useCallback(() => {
    const url = images[index]
    if (!url) return
    setMoreOpen(false)
    haptic.tap()
    const a = document.createElement('a')
    a.href = assetUrl(url)
    a.download = ''
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [images, index])

  const handleOpenInNewTab = useCallback(() => {
    const url = images[index]
    if (!url) return
    setMoreOpen(false)
    haptic.tap()
    window.open(assetUrl(url), '_blank', 'noopener,noreferrer')
  }, [images, index])

  const handleCopyLink = useCallback(async () => {
    const url = images[index]
    if (!url) return
    setMoreOpen(false)
    haptic.tap()
    try {
      await navigator.clipboard.writeText(assetUrl(url))
      setToast('Ссылка скопирована')
    } catch {
      setToast('Не удалось скопировать')
    }
  }, [images, index])

  if (!open) return null

  const current = images[index]
  if (!current) return null

  // Close gesture: opacity and scale fade as user drags down
  const closeProgress = Math.min(1, swipeDownY / 300)
  const opacity = isClosing ? 0 : 1 - closeProgress * 0.6
  const imgScale = isClosing ? 0.85 : (scale === 1 ? (1 - closeProgress * 0.15) : scale)

  // v12.2: panels are hidden when:
  //   • explicitly toggled off (uiVisible === false)
  //   • image is zoomed (scale > 1) — chrome would distract from the zoomed photo
  //   • during close animation (isClosing)
  //   • during swipe-down-to-close (swipeDownY > 0)
  const panelsVisible = uiVisible && scale === 1 && !isClosing && swipeDownY === 0

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
      className="fixed inset-0 z-[300] flex items-center justify-center"
      // v12.2.1: `data-zoom-allowed` moved OFF the root and onto the <img>
      // below. When it was on the root, the CSS rule
      // `[data-zoom-allowed] { touch-action: pinch-zoom }` applied to the
      // root, and `pinch-zoom` ∩ `pan-x` (thumbnail strip) = `none` per
      // the CSS Touch Action intersection spec — blocking the strip's
      // horizontal scroll. By scoping `data-zoom-allowed` to the <img>
      // only, the root gets default `touch-action: auto`, so the strip's
      // `pan-x` intersects with `auto` = `pan-x` (scrollable).
      style={{
        opacity,
        // v20: 3-theme aware background. Each theme gets a distinct premium feel:
        //   • Light: clean off-white (rgb(245, 246, 247)) — Apple-style minimalism
        //   • Dark:  deep slate (rgb(15, 23, 42)) — Telegram-style dark
        //   • Neon:  brand gradient with soft glow — premium cyberpunk feel
        background: isClosing
          ? 'rgba(0,0,0,0)'
          : isNeon
            ? 'radial-gradient(ellipse at center, rgba(15,15,30,0.95) 0%, rgba(10,10,25,0.98) 100%)'
            : isDark
              ? 'rgb(15, 23, 42)'
              : 'rgb(245, 246, 247)',
        // v20: neon theme gets a subtle brand-colored glow overlay
        boxShadow: isNeon && !isClosing
          ? 'inset 0 0 120px rgba(124, 58, 237, 0.15), inset 0 0 60px rgba(56, 189, 248, 0.08)'
          : 'none',
        transition: isClosing
          ? 'opacity 0.2s ease, background 0.2s ease, box-shadow 0.2s ease'
          : swipeDownY === 0
            ? 'opacity 0.15s ease, background 0.15s ease, box-shadow 0.15s ease'
            : 'none',
        // v12.2.1: removed `touchAction: 'none'` from the root. It was
        // intersecting with the thumbnail strip's `pan-x` down to `none`.
        // Pinch/pan is now handled by `touch-action: none` on the <img>
        // itself (see below) — which is the only element that needs JS
        // gesture handling.
        overscrollBehavior: 'contain',
      }}
      onClick={onClose}
      onMouseMove={() => { if (!uiVisible) revealUi() }}
    >
      {/* ===== TOP BAR — glassmorphism, auto-hide, theme-aware ===== */}
      {/* v20: 3-theme aware. Each theme gets distinct glass + button styles:
          • Light: white glass bg, dark buttons (high contrast on light photos)
          • Dark:  dark glass bg, white buttons (high contrast on dark photos)
          • Neon:  brand-tinted glass bg, white buttons with glow
          Buttons NEVER blend into the image — always readable. */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 transition-opacity duration-200"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          paddingBottom: '12px',
          // v20: 3-theme gradient backgrounds
          background: isNeon
            ? 'linear-gradient(180deg, rgba(15,15,30,0.65) 0%, rgba(15,15,30,0) 100%)'
            : isDark
              ? 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)'
              : 'linear-gradient(180deg, rgba(15,23,42,0.35) 0%, rgba(15,23,42,0) 100%)',
          // Webkit backdrop-filter for Safari iOS — slightly weaker blur to
          // keep performance smooth during pinch.
          backdropFilter: 'blur(14px) saturate(140%)',
          WebkitBackdropFilter: 'blur(14px) saturate(140%)',
          opacity: panelsVisible ? 1 : 0,
          pointerEvents: panelsVisible ? 'auto' : 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* v20: button styles per theme — always high-contrast on any image */}
        {(() => {
          // Compute button bg/text colors for current theme
          const btnBg = isLight
            ? 'rgba(255,255,255,0.85)'     // light theme: white glass
            : isNeon
              ? 'rgba(124, 58, 237, 0.35)'  // neon: brand-tinted glass
              : 'rgba(255,255,255,0.12)'    // dark: subtle white glass
          const btnHoverBg = isLight
            ? 'rgba(255,255,255,0.95)'
            : isNeon
              ? 'rgba(124, 58, 237, 0.55)'
              : 'rgba(255,255,255,0.22)'
          const btnActiveBg = isLight
            ? 'rgba(255,255,255,1)'
            : isNeon
              ? 'rgba(124, 58, 237, 0.7)'
              : 'rgba(255,255,255,0.32)'
          const btnColor = isLight ? '#0f172a' : '#ffffff'
          const btnShadow = isLight
            ? '0 4px 12px -2px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.04)'
            : isNeon
              ? '0 4px 16px -2px rgba(124, 58, 237, 0.5), 0 0 0 1px rgba(255,255,255,0.1)'
              : '0 2px 8px -2px rgba(0,0,0,0.3)'
          const counterColor = isLight ? '#0f172a' : '#ffffff'
          const counterShadow = isLight
            ? '0 1px 4px rgba(255,255,255,0.6)'
            : '0 1px 4px rgba(0,0,0,0.5)'

          const btnClass = "h-10 w-10 shrink-0 rounded-full grid place-items-center transition-colors"
          const btnStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
            background: btnBg,
            color: btnColor,
            boxShadow: btnShadow,
            ...extra,
          })

          return (
            <>
              {/* Close button (left) */}
              <button
                type="button"
                onClick={() => { haptic.tap(); onClose() }}
                aria-label="Закрыть"
                className={btnClass}
                style={btnStyle()}
                onMouseEnter={(e) => (e.currentTarget.style.background = btnHoverBg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = btnBg)}
                onMouseDown={(e) => (e.currentTarget.style.background = btnActiveBg)}
                onMouseUp={(e) => (e.currentTarget.style.background = btnHoverBg)}
              >
                <X className="h-5 w-5" />
              </button>

              {/* Counter — "3 / 12" (center, flexible) */}
              <div
                className="flex-1 text-center text-sm font-semibold tracking-wide select-none"
                style={{ color: counterColor, textShadow: counterShadow }}
              >
                {images.length > 1 ? `${index + 1} / ${images.length}` : ''}
              </div>

              {/* Right-side action buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleShare}
                  aria-label="Поделиться"
                  className={btnClass + " rounded-full"}
                  style={btnStyle()}
                  onMouseEnter={(e) => (e.currentTarget.style.background = btnHoverBg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = btnBg)}
                >
                  <Share2 className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  aria-label="Скачать"
                  className={btnClass + " rounded-full"}
                  style={btnStyle()}
                  onMouseEnter={(e) => (e.currentTarget.style.background = btnHoverBg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = btnBg)}
                >
                  <Download className="h-5 w-5" />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { haptic.tap(); setMoreOpen((v) => !v) }}
                    aria-label="Дополнительно"
                    aria-expanded={moreOpen}
                    className={btnClass + " rounded-full"}
                    style={btnStyle()}
                    onMouseEnter={(e) => (e.currentTarget.style.background = btnHoverBg)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = btnBg)}
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                  {moreOpen && (
                    <>
                      {/* Click-away catcher */}
                      <div
                        className="fixed inset-0 z-30"
                        onClick={() => setMoreOpen(false)}
                      />
                      <div
                        className="absolute right-0 top-12 z-40 min-w-[200px] rounded-2xl py-1.5 shadow-xl"
                        style={{
                          // v20: dropdown also theme-aware
                          background: isNeon
                            ? 'rgba(15,15,30,0.95)'
                            : isDark
                              ? 'rgba(15,23,42,0.92)'
                              : 'rgba(255,255,255,0.96)',
                          backdropFilter: 'blur(24px) saturate(160%)',
                          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
                          border: isLight
                            ? '1px solid rgba(15,23,42,0.08)'
                            : isNeon
                              ? '1px solid rgba(124, 58, 237, 0.3)'
                              : '1px solid rgba(255,255,255,0.10)',
                          boxShadow: isNeon
                            ? '0 8px 32px -8px rgba(124, 58, 237, 0.4)'
                            : '0 8px 32px -8px rgba(0,0,0,0.3)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={handleOpenInNewTab}
                          className="w-full text-left px-3 py-2.5 text-sm font-medium hover:bg-foreground/5 transition-colors"
                          style={{ color: isLight ? '#0f172a' : '#fff' }}
                        >
                          Открыть в новой вкладке
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyLink}
                          className="w-full text-left px-3 py-2.5 text-sm font-medium hover:bg-foreground/5 transition-colors"
                          style={{ color: isLight ? '#0f172a' : '#fff' }}
                        >
                          Скопировать ссылку
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )
        })()}
      </div>

      {/* ===== THE IMAGE ===== */}
      {/* Plain <img> (NOT next/image) — matches v12.1 for instant first paint.
          v12.2.1: `data-zoom-allowed` + `touch-action: none` live HERE (not on
          the root div). This is the only element that needs JS-controlled
          pinch/pan gestures. Scoping these to the <img> prevents the root
          from blocking the thumbnail strip's horizontal scroll via CSS
          touch-action intersection. */}
      <img
        src={assetUrl(current)}
        alt="Просмотр"
        data-zoom-allowed
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: `translate(${scale > 1 ? panX : 0}px, ${scale > 1 ? panY : swipeDownY}px) scale(${imgScale})`,
          transition: (swipeDownY === 0 && panX === 0 && panY === 0 && !isClosing && touchRef.current.mode === 'none')
            ? 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)'
            : 'none',
          maxWidth: '100vw',
          maxHeight: '100vh',
          objectFit: 'contain',
          willChange: 'transform',
          // v12.2.1: `touch-action: none` on the <img> so the browser
          // doesn't intercept pinch/pan — JS handlers above do it all.
          touchAction: 'none',
        }}
        className="select-none"
        draggable={false}
      />

      {/* ===== NAVIGATION ARROWS (desktop only) ===== */}
      {/* v12.2.1: hidden on mobile (<768px) — users navigate via swipe
          gestures + bottom thumbnail strip on touch devices. On-screen
          arrows would cover the photo unnecessarily on small screens. */}
      {isDesktop && images.length > 1 && scale === 1 && panelsVisible && (
        <>
          {index > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full grid place-items-center z-10 text-white hover:bg-white/15 active:bg-white/25 transition-colors"
              onClick={(e) => { e.stopPropagation(); prev() }}
              aria-label="Предыдущая"
              style={{
                background: 'rgba(0,0,0,0.40)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              }}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {index < images.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full grid place-items-center z-10 text-white hover:bg-white/15 active:bg-white/25 transition-colors"
              onClick={(e) => { e.stopPropagation(); next() }}
              aria-label="Следующая"
              style={{
                background: 'rgba(0,0,0,0.40)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              }}
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </>
      )}

      {/* ===== BOTTOM THUMBNAIL STRIP (replaces dots) ===== */}
      {/* Glassmorphism strip with horizontally scrollable thumbnails. Active
          thumbnail has a 2px brand-color ring. Always rendered (when there's
          more than 1 image and panels are visible) so the user can jump to
          any photo in one tap.

          v12.2.1: `data-scroll-lock-ignore` on the outer wrapper tells
          useScrollLock's touchmove listener (which calls preventDefault on
          touches outside [data-scroll-lock-ignore] to block background
          scroll) to LEAVE this strip alone — so the browser can perform
          native horizontal scrolling. Combined with `touch-action: pan-x`
          on the inner scroller and `preserveTouchAction: true` on the
          useScrollLock call (so body doesn't get `touch-action: none`),
          the strip now scrolls smoothly on mobile. */}
      {images.length > 1 && panelsVisible && (
        <div
          data-scroll-lock-ignore
          className="absolute left-0 right-0 bottom-0 z-20 transition-opacity duration-200"
          style={{
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
            paddingTop: '16px',
            background: isDark
              ? 'linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)'
              : 'linear-gradient(0deg, rgba(15,23,42,0.35) 0%, rgba(15,23,42,0) 100%)',
            backdropFilter: 'blur(14px) saturate(140%)',
            WebkitBackdropFilter: 'blur(14px) saturate(140%)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={stripRef}
            data-scroll-lock-ignore
            className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 scroll-px-4"
            style={{
              scrollBehavior: 'smooth',
              // v12.2.1: `pan-x` allows ONLY horizontal panning here. The
              // root lightbox div no longer sets `touch-action: none`
              // (moved to the <img>), and body no longer gets `none` either
              // (preserveTouchAction: true on useScrollLock), so this `pan-x`
              // is no longer intersected down to `none` — the browser
              // performs native horizontal scrolling.
              touchAction: 'pan-x',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
            }}
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.currentTarget.scrollLeft += e.deltaY
              }
            }}
          >
            {images.map((url, i) => {
              const isActive = i === index
              return (
                <button
                  key={i}
                  ref={(el) => { thumbRefs.current[i] = el }}
                  type="button"
                  onClick={() => goToIndex(i)}
                  aria-label={`Фото ${i + 1}${isActive ? ' (текущая)' : ''}`}
                  aria-current={isActive}
                  className="relative shrink-0 rounded-lg overflow-hidden transition-opacity"
                  style={{
                    width: 48,
                    height: 48,
                    // Active thumbnail gets a 2px ring in the brand color
                    // (firmennaya ramka). Inactive ones are slightly faded.
                    opacity: isActive ? 1 : 0.6,
                    boxShadow: isActive
                      ? '0 0 0 2px var(--primary), 0 2px 8px rgba(0,0,0,0.3)'
                      : 'none',
                  }}
                >
                  <img
                    src={assetUrl(url)}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== TOAST (status messages, e.g. "Ссылка скопирована") ===== */}
      {toast && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full text-sm font-medium text-white pointer-events-none"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
            background: 'rgba(15,23,42,0.85)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
