'use client'

import { useEffect, useState } from 'react'

/**
 * SSR-safe media query hook.
 * Returns `false` during SSR and the first client render, then updates
 * after mount — so components gated on this hook can be excluded from
 * the initial render tree on mismatched viewports.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])

  return matches
}

/** Convenience: matches Tailwind's `md:` breakpoint (768px). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)')
}
