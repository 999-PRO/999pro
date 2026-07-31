'use client'

// ============================================================================
// useAudioFrequency — анализ частот БЕЗ перехвата звука
// ----------------------------------------------------------------------------
// v31.1: НЕ используем createMediaElementSource (он перехватывает звук).
// Вместо этого используем CSS-анимацию с псевдо-случайными значениями,
// которые зависят от isPlaying — даёт эффект "реакции на музыку" без
// риска потерять звук.
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { useAudioPlayer } from '@/lib/audio-player-manager'

const BAR_COUNT = 16

export function useAudioFrequency() {
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const [bars, setBars] = useState<number[]>(new Array(BAR_COUNT).fill(0))
  const rafRef = useRef<number | null>(null)
  const phaseRef = useRef(0)

  useEffect(() => {
    if (!isPlaying) {
      setBars(new Array(BAR_COUNT).fill(0))
      return
    }

    const update = () => {
      phaseRef.current += 0.05
      const phase = phaseRef.current
      const newBars: number[] = []
      for (let i = 0; i < BAR_COUNT; i++) {
        // Pseudo-random based on phase + index — simulates frequency bars
        // Uses multiple sine waves at different frequencies for organic feel
        const wave1 = Math.sin(phase * 2 + i * 0.5) * 0.3 + 0.3
        const wave2 = Math.sin(phase * 3.7 + i * 0.8) * 0.2 + 0.2
        const wave3 = Math.sin(phase * 1.3 + i * 1.2) * 0.15 + 0.15
        const beat = Math.sin(phase * 0.8) * 0.15 + 0.15 // slow beat
        const val = Math.max(0.05, Math.min(1, wave1 + wave2 + wave3 + beat))
        newBars.push(val)
      }
      setBars(newBars)
      rafRef.current = requestAnimationFrame(update)
    }
    update()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying, currentTrack])

  return bars
}
