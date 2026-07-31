'use client'

import { useEffect } from 'react'

// ============================================================================
// useScrollLock — fully locks background page scrolling while a modal,
// lightbox, sheet, or full-screen overlay is open.
//
// Why we need this:
//  - `body { overflow: hidden }` alone is NOT enough on iOS Safari. The
//    page underneath still scrolls when the user drags on the backdrop
//    because Safari's rubber-band scrolling bypasses overflow:hidden
//    on body when the document is taller than the viewport.
//  - `touch-action: none` on body helps, but it ALSO blocks touch
//    scrolling inside the modal itself — which we don't want (e.g. the
//    product page has its own scrollable content area).
//  - The fix: lock body overflow + add a `touchmove` listener on the
//    document that only prevents default when the touch target is OUTSIDE
//    any element marked with [data-scroll-lock-ignore]. Inside the modal,
//    scrolling works normally.
//
// Usage:
//   useScrollLock(isOpen)
//
// The hook is idempotent — multiple components can call it simultaneously
// and the body will only unlock when ALL of them have closed.
// ============================================================================

let lockCount = 0
// v12.2.1: counter for consumers that need nested horizontal touch-scrolling
// to work inside the locked modal (e.g. the lightbox's thumbnail strip).
// When > 0, we skip `body.style.touchAction = 'none'` so that the CSS
// `touch-action: pan-x` on the nested scrollable element isn't intersected
// down to `none` by the body's `none`. Background scroll is still blocked
// by `overflow: hidden` (desktop) + the `touchmove` preventDefault listener
// (iOS rubber-band).
let preserveTouchActionCount = 0
let savedOverflow = ''
let savedOverscroll = ''
let savedTouchAction = ''
let savedPosition = ''
let savedTop = ''
let savedWidth = ''
// HTML element styles — the <html> element is the actual scroller on most
// desktop browsers (body has `overflow: hidden` already via globals.css for
// overflow-x:clip, but overflow-y on the documentElement is what controls
// vertical page scroll). Without locking html.overflow too, the page behind
// a modal CAN still be scrolled via wheel/keyboard on Chrome/Firefox/Safari
// desktop (this is the root cause of the user-reported desktop scroll bug).
let savedHtmlOverflow = ''
let savedHtmlMarginRight = ''

export function useScrollLock(active: boolean, options?: { preserveTouchAction?: boolean }) {
  const preserveTouchAction = !!options?.preserveTouchAction

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!active) return

    // First locker — save original body + html styles and apply lock.
    if (lockCount === 0) {
      const body = document.body
      const html = document.documentElement
      savedOverflow = body.style.overflow
      savedOverscroll = body.style.overscrollBehavior
      savedTouchAction = body.style.touchAction
      savedPosition = body.style.position
      savedTop = body.style.top
      savedWidth = body.style.width
      savedHtmlOverflow = html.style.overflow
      savedHtmlMarginRight = html.style.marginRight
    }
    lockCount += 1
    if (preserveTouchAction) preserveTouchActionCount += 1

    const body = document.body
    const html = document.documentElement
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    // v12.2.1: only set `touch-action: none` on body if NO consumer needs
    // nested touch-scrolling. When a lightbox (or any consumer with
    // `preserveTouchAction: true`) is open, we leave `touch-action` as-is
    // so that horizontal pan-x on nested scrollable elements (the thumbnail
    // strip) isn't intersected down to `none`.
    body.style.touchAction = preserveTouchActionCount > 0 ? '' : 'none'
    // ALSO lock the html element — this is the critical fix for desktop.
    // On desktop browsers, the documentElement is the scroller, not body.
    // Setting body.overflow=hidden alone is NOT enough — wheel events on
    // the documentElement still scroll the page. Locking html.overflow too
    // fully prevents background scroll on Chrome/Firefox/Safari desktop.
    html.style.overflow = 'hidden'
    // Prevent layout shift from scrollbar disappearing on Windows/Chrome
    // (which uses overlay scrollbars on Mac, so this is a no-op there).
    // We measure the scrollbar width and apply it as right margin only if
    // the page actually had a scrollbar (otherwise we'd push content right
    // for no reason).
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarWidth > 0 && html.scrollHeight > html.clientHeight) {
      html.style.marginRight = `${scrollbarWidth}px`
    }

    // Block touchmove on the document — but only when the touch target
    // is NOT inside a [data-scroll-lock-ignore] container. This lets the
    // modal's own scrollable areas work while preventing the background
    // page from scrolling.
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 1) return // allow pinch zoom if explicitly enabled
      const target = e.target as HTMLElement | null
      if (!target) return
      // Walk up the DOM: if we hit a [data-scroll-lock-ignore] before
      // hitting body, the touch is inside the modal's scrollable area —
      // allow it. Otherwise block.
      const inside = target.closest('[data-scroll-lock-ignore]')
      if (inside) return
      // Block background scrolling.
      e.preventDefault()
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false })

    // Block wheel scrolling on the background. The modal's own scroll
    // containers handle their own wheel events via overflow:auto.
    //
    // NOTE on scroll chaining: even with `body { overflow: hidden }`, when
    // the user scrolls inside a [data-scroll-lock-ignore] div and reaches
    // the boundary, the browser MAY chain the scroll to the parent. We
    // prevent that with `overscroll-behavior: contain` on the inner div
    // (set via inline style on the scrollable element in product-page.tsx
    // and all-reviews-sheet.tsx), so this wheel listener is the second
    // line of defense.
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const inside = target.closest('[data-scroll-lock-ignore]')
      if (inside) return
      e.preventDefault()
    }
    document.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('wheel', onWheel)
      lockCount = Math.max(0, lockCount - 1)
      if (preserveTouchAction) preserveTouchActionCount = Math.max(0, preserveTouchActionCount - 1)
      if (lockCount === 0) {
        body.style.overflow = savedOverflow
        body.style.overscrollBehavior = savedOverscroll
        body.style.touchAction = savedTouchAction
        body.style.position = savedPosition
        body.style.top = savedTop
        body.style.width = savedWidth
        html.style.overflow = savedHtmlOverflow
        html.style.marginRight = savedHtmlMarginRight
      } else {
        // Still locked by another consumer — re-evaluate touch-action
        // because the remaining consumer(s) may not want preserveTouchAction.
        body.style.touchAction = preserveTouchActionCount > 0 ? '' : 'none'
      }
    }
  }, [active, preserveTouchAction])
}
