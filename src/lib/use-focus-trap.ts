'use client'

import { useEffect, type RefObject } from 'react'

/**
 * useFocusTrap — traps keyboard focus within a container for accessibility.
 *
 * Phase 9: Modal overlays (cart-sheet, favorites-sheet, product-page,
 * image-lightbox, message-context-menu, stories-viewer, call-screen,
 * buy-sheet) had no focus trap — keyboard users tabbing through them
 * escaped into the page behind. This hook implements the WAI-ARIA dialog
 * pattern: focus moves into the container on mount, Tab/Shift+Tab cycles
 * within, focus returns to the trigger on unmount.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null)
 *   useFocusTrap(ref, isOpen)
 *   return <div ref={ref} role="dialog" aria-modal="true">...</div>
 *
 * @param containerRef  Ref to the container element
 * @param active        Whether the trap is active (modal is open)
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    // Remember the element that had focus before the modal opened
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Get all focusable elements within the container
    const getFocusable = (): HTMLElement[] => {
      const selector = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ')
      return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
    }

    // Move focus into the container on mount
    const focusable = getFocusable()
    if (focusable.length > 0) {
      focusable[0].focus()
    } else {
      // No focusable children — focus the container itself
      container.setAttribute('tabindex', '-1')
      container.focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const currentFocusable = getFocusable()
      if (currentFocusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = currentFocusable[0]
      const last = currentFocusable[currentFocusable.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    // v8-audit-fix: ESC key must NOT be stopPropagation'd — it blocks
    // the caller's window-level keydown listener (e.g. product-page.tsx
    // listens on window for Escape to close). Previously the focus trap
    // called e.stopPropagation() which prevented ESC from reaching window.

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      // Restore focus to the element that had it before the modal opened
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [containerRef, active])
}
