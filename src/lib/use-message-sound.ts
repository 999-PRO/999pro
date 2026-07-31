'use client'

// ============================================================================
// useMessageSound — plays a short "whoosh" sound when sending a message.
// ----------------------------------------------------------------------------
// Synthesized via Web Audio API — no external audio files needed.
// A quick frequency sweep from 600Hz → 1200Hz over 0.08s with a soft gain
// envelope. Sounds like a light "swoosh" — similar to Telegram/iMessage.
// ============================================================================

import { useRef, useCallback } from 'react'
// v13.3 (audit Cluster F): use shared AudioContext singleton.
import { getSharedAudioContext } from '@/lib/audio-context'

function getCtx(): AudioContext | null {
  return getSharedAudioContext()
}

export function useMessageSound() {
  const play = useCallback(() => {
    const ctx = getCtx()
    if (!ctx) return

    const now = ctx.currentTime

    // Frequency sweep: 600Hz → 1200Hz over 0.08s
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(600, now)
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08)

    // Soft gain envelope: quick attack, quick decay
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.12, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.13)
  }, [])

  return { play }
}
