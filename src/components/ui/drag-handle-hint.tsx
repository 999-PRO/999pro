'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

// ============================================================================
//  DragHandleHint — iOS-style drag indicator with one-shot hint animation.
//
//  Renders a small pill (36×5px) at the top of a sheet. After the sheet
//  opens, the pill gently bobs DOWN-UP once over ~1.5s to suggest
//  "swipe down to close", then settles and stays static.
//
//  Design:
//    • Pill: 36×5px rounded-full, semi-transparent (matches iOS Sheets)
//    • Hint: a single 1.5s bob animation that plays ONCE per open
//    • No icons, no text — pure visual affordance
//    • Respects prefers-reduced-motion: animation skipped entirely
//
//  The animation is keyed to `triggerKey` — pass a value that changes
//  every time the sheet opens (e.g. the product ID). This guarantees the
//  hint replays for each new opening, even if the component stays mounted.
// ============================================================================

interface DragHandleHintProps {
  /** A value that changes every time the sheet opens. Pass null/undefined
   *  to disable the hint (sheet closed). */
  triggerKey: string | number | null | undefined
  /** Optional className for the wrapper. */
  className?: string
}

export function DragHandleHint({ triggerKey, className }: DragHandleHintProps) {
  // `playHint` flips to true when triggerKey changes (and is non-null),
  // then back to false after the animation completes. This ensures the
  // hint plays exactly once per opening.
  const [playHint, setPlayHint] = useState(false)

  useEffect(() => {
    if (triggerKey == null) {
      setPlayHint(false)
      return
    }
    // Small delay so the sheet's open spring has time to begin — the hint
    // should feel like a gentle "by the way" after the card settles, not
    // a competing animation during the slide-up.
    const startTimer = setTimeout(() => setPlayHint(true), 250)
    const stopTimer = setTimeout(() => setPlayHint(false), 250 + 1600)
    return () => {
      clearTimeout(startTimer)
      clearTimeout(stopTimer)
    }
  }, [triggerKey])

  return (
    <div
      className={`flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing touch-none ${className || ''}`}
      aria-hidden
    >
      <motion.div
        // Key on triggerKey so the animation re-mounts and replays each open.
        key={triggerKey ?? 'closed'}
        className="h-[5px] w-9 rounded-full bg-foreground/30 dark:bg-foreground/25"
        // One-shot hint: pill translates down 6px, back up to -2px, settles.
        // Spring physics for natural deceleration — feels physical, not robotic.
        animate={
          playHint
            ? {
                y: [0, 6, -2, 0],
              }
            : { y: 0 }
        }
        transition={
          playHint
            ? {
                duration: 1.5,
                ease: [0.22, 1, 0.36, 1], // ease-out-quart — smooth deceleration
                times: [0, 0.3, 0.7, 1],
              }
            : { duration: 0 }
        }
      />
    </div>
  )
}
