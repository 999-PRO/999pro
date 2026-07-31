'use client'

// ============================================================================
// useRingtone — plays phone-ring sounds for calls via Web Audio API.
// ----------------------------------------------------------------------------
// Two modes:
//   - 'incoming': loud two-tone "brrring-brrring" (recipient's phone rings)
//   - 'outgoing': quiet single-tone "beep... beep..." (caller hears "calling")
//
// No external audio files needed — synthesized from oscillators.
// ============================================================================

import { useRef, useCallback } from 'react'
// v13.3 (audit Cluster F): use shared AudioContext singleton.
import { getSharedAudioContext } from '@/lib/audio-context'

export function useRingtone() {
  const ctxRef = useRef<AudioContext | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(false)

  // Incoming ring — loud two-tone, like a classic phone.
  // Pattern: 1000Hz × 2, 1250Hz × 2, then 1.5s silence. Repeats every 2s.
  const playIncomingRing = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = ctx.currentTime

    const tones = [
      { freq: 1000, start: 0, dur: 0.2 },
      { freq: 1000, start: 0.3, dur: 0.2 },
      { freq: 1250, start: 0.6, dur: 0.2 },
      { freq: 1250, start: 0.9, dur: 0.2 },
    ]
    for (const t of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = t.freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0, now + t.start)
      gain.gain.linearRampToValueAtTime(0.18, now + t.start + 0.02)
      gain.gain.linearRampToValueAtTime(0.18, now + t.start + t.dur - 0.02)
      gain.gain.linearRampToValueAtTime(0, now + t.start + t.dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + t.start)
      osc.stop(now + t.start + t.dur + 0.05)
    }
  }, [])

  // Outgoing ring — quiet single beep, like a dial tone "beep... beep...".
  // Pattern: 800Hz for 0.4s, then 1.6s silence. Repeats every 2s.
  const playOutgoingRing = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 800
    osc.type = 'sine'
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.08, now + 0.03)
    gain.gain.setValueAtTime(0.08, now + 0.37)
    gain.gain.linearRampToValueAtTime(0, now + 0.4)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.45)
  }, [])

  const start = useCallback((mode: 'incoming' | 'outgoing' = 'incoming') => {
    if (activeRef.current) return
    activeRef.current = true
    try {
      // v13.3: use shared AudioContext instead of creating a new one.
      if (!ctxRef.current) {
        ctxRef.current = getSharedAudioContext()
        if (!ctxRef.current) return
      }
      if (ctxRef.current.state === 'suspended') {
        void ctxRef.current.resume()
      }
      // Play immediately, then repeat every 2 seconds.
      if (mode === 'incoming') {
        playIncomingRing()
        intervalRef.current = setInterval(playIncomingRing, 2000)
      } else {
        playOutgoingRing()
        intervalRef.current = setInterval(playOutgoingRing, 2000)
      }
    } catch {
      // AudioContext unavailable — silent
    }
  }, [playIncomingRing, playOutgoingRing])

  const stop = useCallback(() => {
    activeRef.current = false
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  return { start, stop }
}
