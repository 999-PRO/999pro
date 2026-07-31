'use client'

// ============================================================================
// Universal Search — global overlay wrapper.
// ----------------------------------------------------------------------------
// Mount ONCE at the app shell level (next to MediaHubGlobalOverlay).
// Listens for:
//   - 'open-universal-search' window event  (custom triggers)
//   - Cmd/Ctrl+K keyboard shortcut           (desktop power-user)
// ============================================================================

import { useState, useEffect } from 'react'
import { UniversalSearchOverlay } from './universal-search-overlay'

export function UniversalSearchGlobalOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const openHandler = () => setOpen(true)
    const closeHandler = () => setOpen(false)
    window.addEventListener('open-universal-search', openHandler)
    window.addEventListener('close-universal-search', closeHandler)

    // Cmd/Ctrl+K — open the search overlay (desktop only).
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((cur) => !cur)
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('open-universal-search', openHandler)
      window.removeEventListener('close-universal-search', closeHandler)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return <UniversalSearchOverlay open={open} onClose={() => setOpen(false)} />
}
