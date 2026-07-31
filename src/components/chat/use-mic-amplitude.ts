'use client'

import { useEffect, useRef, useState } from 'react'

// ============================================================================
// useMicAmplitude — real-time microphone amplitude (0..1).
//
// Wraps an AnalyserNode connected to a MediaStream. Returns a ref-backed
// amplitude value updated via requestAnimationFrame, plus a React state
// (throttled to ~30fps) for components that need to re-render on level
// changes.
//
// Used by:
//   • VoiceRecordPanel — organic waveform that reacts to the user's voice
//   • AmbientGlow — screen-edge glow that "breathes" with the voice
//
// The hook is intentionally lightweight: no React re-renders on every frame
// (the canvas/SVG reads `amplitudeRef.current` directly inside its own RAF
// loop). The `level` state is updated at most every ~33ms so React-driven
// children don't drown the main thread.
// ============================================================================

export interface MicAmplitude {
  /** Live amplitude 0..1 — read from a ref (no re-render). Updated per RAF. */
  ref: React.MutableRefObject<number>
  /** Throttled amplitude 0..1 — re-renders ~30fps. Use for non-critical UI. */
  level: number
  /** True while the analyser is running. */
  active: boolean
}

export function useMicAmplitude(stream: MediaStream | null): MicAmplitude {
  const amplitudeRef = useRef(0)
  const [level, setLevel] = useState(0)
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!stream) {
      amplitudeRef.current = 0
      setLevel(0)
      setActive(false)
      return
    }

    let audioCtx: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let rafId = 0
    let lastStateUpdate = 0
    let cancelled = false

    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      audioCtx = new Ctor()
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8 // smooth out per-frame jitter
      source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)
      setActive(true)

      const data = new Uint8Array(analyser.frequencyBinCount)

      const tick = (ts: number) => {
        if (cancelled || !analyser) return
        analyser.getByteFrequencyData(data)
        // Average of low-mid frequencies (voice band ≈ 80–3000 Hz).
        // We take the first ~32 bins of a 256-fft (which covers 0–~5.4kHz
        // at 44.1kHz sample rate) — that's where voice energy lives.
        let sum = 0
        const end = Math.min(data.length, 32)
        for (let i = 0; i < end; i++) sum += data[i]
        const avg = sum / end / 255 // 0..1
        // Perceptual curve: small values (background hum) → ~0, loud voice → ~1.
        // Power curve 1.8 makes quiet speech more visible while keeping
        // silence near zero.
        const shaped = Math.pow(Math.min(1, avg * 1.4), 1.8)
        amplitudeRef.current = shaped

        // Throttle state updates to ~30fps (every 33ms).
        if (ts - lastStateUpdate >= 33) {
          lastStateUpdate = ts
          setLevel(shaped)
        }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    } catch {
      // AudioContext may fail (sandbox, permissions) — fall back to 0.
      setActive(false)
    }

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      try {
        source?.disconnect()
        analyser?.disconnect()
        audioCtx?.close()
      } catch {
        // ignore
      }
      amplitudeRef.current = 0
      setLevel(0)
      setActive(false)
    }
  }, [stream])

  return { ref: amplitudeRef, level, active }
}
