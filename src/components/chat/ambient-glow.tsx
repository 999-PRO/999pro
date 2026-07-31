'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================================
// AmbientGlow — VISIBLE neon breathing glow around the screen edges.
//
// v9-voice-v2: completely rewritten for visibility. The previous version was
// too subtle (opacity 0.15-0.35) — invisible in light theme, barely visible
// in dark. Now uses a STRONG multi-layer gradient that's clearly visible in
// BOTH themes, matching the reference design's electric blue neon aesthetic.
//
// Three layers:
//   1. Edge glow — bright neon strip along all 4 edges (box-shadow inset)
//   2. Corner glow — radial gradients at each corner for depth
//   3. Pulse overlay — amplitude-driven brightness modulation
//
// The glow is ALWAYS visible while active — not a subtle hint. It's the
// "screen is alive" effect from the reference image.
// ============================================================================

interface AmbientGlowProps {
  active: boolean
  amplitudeRef: React.MutableRefObject<number>
  variant?: 'record' | 'peer'
}

export function AmbientGlow({ active, amplitudeRef, variant = 'record' }: AmbientGlowProps) {
  const edgeRef = useRef<HTMLDivElement | null>(null)
  const cornerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!active) return

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      if (edgeRef.current) edgeRef.current.style.opacity = '0.8'
      if (cornerRef.current) cornerRef.current.style.opacity = '0.6'
      return
    }

    let last = performance.now()
    let basePulse = 0
    const tick = (now: number) => {
      const dt = Math.min(50, now - last) / 1000
      last = now
      // Slow base pulse (0.4Hz) — heartbeat
      basePulse = (Math.sin(now / 2500) + 1) / 2 // 0..1

      const amp = amplitudeRef.current
      // Combine: 30% base pulse + 70% voice amplitude — STRONG response
      const intensity = 0.45 + basePulse * 0.25 + amp * 0.30

      if (edgeRef.current) {
        edgeRef.current.style.opacity = String(Math.min(1, intensity))
      }
      if (cornerRef.current) {
        cornerRef.current.style.opacity = String(Math.min(1, intensity * 0.85))
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [active, amplitudeRef])

  // Variant colors — electric blue for record, softer blue for peer
  const isRecord = variant === 'record'

  // Edge glow: bright neon strip. Uses box-shadow inset so the glow comes
  // FROM the edges inward — visible in both light and dark themes.
  const edgeShadow = isRecord
    ? 'inset 0 0 80px 8px rgba(59,130,246,0.45), inset 0 0 40px 4px rgba(124,58,237,0.30)'
    : 'inset 0 0 60px 6px rgba(96,165,250,0.35), inset 0 0 30px 3px rgba(186,230,253,0.25)'

  // Corner radial gradients — add depth at each corner
  const cornerBg = isRecord
    ? `radial-gradient(circle at 0% 0%, rgba(56,189,248,0.35) 0%, transparent 40%),
       radial-gradient(circle at 100% 0%, rgba(124,58,237,0.30) 0%, transparent 40%),
       radial-gradient(circle at 0% 100%, rgba(124,58,237,0.30) 0%, transparent 40%),
       radial-gradient(circle at 100% 100%, rgba(56,189,248,0.35) 0%, transparent 40%)`
    : `radial-gradient(circle at 0% 0%, rgba(186,230,253,0.30) 0%, transparent 40%),
       radial-gradient(circle at 100% 0%, rgba(226,232,240,0.25) 0%, transparent 40%),
       radial-gradient(circle at 0% 100%, rgba(226,232,240,0.25) 0%, transparent 40%),
       radial-gradient(circle at 100% 100%, rgba(186,230,253,0.30) 0%, transparent 40%)`

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed inset-0 z-[55] pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden
        >
          {/* Layer 1: Edge glow — bright neon strip along all 4 edges.
              box-shadow inset is visible in BOTH light and dark themes. */}
          <div
            ref={edgeRef}
            className="absolute inset-0"
            style={{ boxShadow: edgeShadow }}
          />
          {/* Layer 2: Corner glow — radial gradients at each corner */}
          <div
            ref={cornerRef}
            className="absolute inset-0"
            style={{ background: cornerBg }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
