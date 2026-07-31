'use client'

// ============================================================================
// AudioWaveVisualizer — уникальная анимация воспроизведения для Audio Hub.
// ----------------------------------------------------------------------------
// ВНИМАНИЕ: это НЕ VoiceWaveVisualizer. У Audio Hub собственная анимация.
//
// Визуальный стиль: вертикальные частотные полосы (frequency bars), которые
// плавно пульсируют в такт воспроизведения. Использует Web Audio API
// AnalyserNode для анализа реального аудиосигнала (если доступно) или
// математическую симуляцию (если AnalyserNode недоступен).
//
// Отличия от VoiceWaveVisualizer:
//   • Voice: горизонтальная органическая волна с clipPath (волнистая линия).
//   • Audio Hub: вертикальные бары частот (equalizer-стиль), сэмметричные.
//
// Параметры:
//   • isPlaying — запущена ли анимация.
//   • progress — 0..1, для подсветки "сыгранных" баров.
//   • barCount — количество баров (по умолчанию 32).
//   • height — высота в пикселях.
//   • variant — 'card' (для карточки в чате, маленький) | 'player' (для плеера, большой).
// ============================================================================

import { useEffect, useRef } from 'react'

interface AudioWaveVisualizerProps {
  isPlaying: boolean
  progress?: number
  barCount?: number
  height?: number
  variant?: 'card' | 'player'
  className?: string
}

export function AudioWaveVisualizer({
  isPlaying,
  progress = 0,
  barCount = 32,
  height = 40,
  variant = 'card',
  className = '',
}: AudioWaveVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const phaseRef = useRef(0)
  // Persist amplitudes across frames for smooth decay.
  const ampsRef = useRef<number[]>(new Array(barCount).fill(0))
  // v16.17: Refs for isPlaying and progress so the RAF loop reads the latest
  // values WITHOUT re-creating the effect on every progress change (which
  // was killing the animation — the canvas was re-initialized every frame).
  const isPlayingRef = useRef(isPlaying)
  const progressRef = useRef(progress)
  isPlayingRef.current = isPlaying
  progressRef.current = progress

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Handle high-DPI displays.
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // Try to attach to the global audio element's AnalyserNode.
    // We use the same singleton audio element as audio-player-manager.
    let analyser: AnalyserNode | null = null
    let freqData: Uint8Array<ArrayBuffer> | null = null
    try {
      const audioEl = (window as any).__audioHubAnalyserSource as HTMLAudioElement | undefined
      if (audioEl) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        if (AudioCtx) {
          const ctx2 = new AudioCtx()
          const source = ctx2.createMediaElementSource(audioEl)
          analyser = ctx2.createAnalyser()
          analyser.fftSize = 128
          source.connect(analyser)
          analyser.connect(ctx2.destination)
          freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
        }
      }
    } catch {
      // AnalyserNode already attached or unavailable — fall back to simulation.
    }

    const render = () => {
      // v16.17: Read latest values from refs (not from closure).
      const playing = isPlayingRef.current
      const prog = progressRef.current

      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      ctx.clearRect(0, 0, w, h)

      const barWidth = w / barCount
      const gap = variant === 'card' ? 2 : 3
      const drawWidth = barWidth - gap
      const midY = h / 2

      phaseRef.current += playing ? 0.06 : 0.015
      const amps = ampsRef.current

      for (let i = 0; i < barCount; i++) {
        let targetAmp: number

        if (analyser && freqData && playing) {
          // Use real frequency data.
          analyser.getByteFrequencyData(freqData)
          const idx = Math.floor((i / barCount) * freqData.length)
          targetAmp = (freqData[idx] / 255) * (h * 0.45)
        } else {
          // Mathematical simulation: sum of sines for organic movement.
          const phase = phaseRef.current
          const t = i / barCount
          const base = playing ? 1 : 0.15
          const wave1 = Math.sin(phase + t * 8) * 0.5 + 0.5
          const wave2 = Math.sin(phase * 1.3 + t * 12 + 1) * 0.3 + 0.3
          const wave3 = Math.sin(phase * 0.7 + t * 5 + 2) * 0.2 + 0.2
          targetAmp = (wave1 + wave2 + wave3) * base * (h * 0.4)
        }

        // Smooth approach to target (lerp).
        amps[i] = amps[i] + (targetAmp - amps[i]) * 0.25
        const amp = Math.max(2, amps[i])

        // Color: played bars use brand gradient, unplayed are muted.
        const barProgress = i / barCount
        const isPlayed = barProgress <= prog
        const isNearPlayhead = Math.abs(barProgress - prog) < 0.05

        if (variant === 'card') {
          // Card variant: subtle, two-tone.
          ctx.fillStyle = isPlayed
            ? isNearPlayhead
              ? 'rgba(124, 58, 237, 0.95)'
              : 'rgba(99, 102, 241, 0.7)'
            : 'rgba(148, 163, 184, 0.3)'
        } else {
          // Player variant: gradient bars.
          const gradient = ctx.createLinearGradient(0, midY - amp, 0, midY + amp)
          if (isPlayed) {
            gradient.addColorStop(0, 'rgba(56, 189, 248, 0.9)')
            gradient.addColorStop(0.5, 'rgba(99, 102, 241, 0.95)')
            gradient.addColorStop(1, 'rgba(124, 58, 237, 0.9)')
          } else {
            gradient.addColorStop(0, 'rgba(148, 163, 184, 0.35)')
            gradient.addColorStop(0.5, 'rgba(148, 163, 184, 0.5)')
            gradient.addColorStop(1, 'rgba(148, 163, 184, 0.35)')
          }
          ctx.fillStyle = gradient
        }

        // Draw symmetrical bar (from center, going up and down).
        const x = i * barWidth + gap / 2
        const halfAmp = amp / 2
        // Rounded rect. v16.9.7: Guard against negative radius.
        const r = Math.max(0, Math.min(drawWidth / 2, 2))
        if (r > 0 && typeof ctx.roundRect === 'function') {
          ctx.beginPath()
          ctx.roundRect(x, midY - halfAmp, drawWidth, amp, r)
          ctx.fill()
        } else {
          ctx.fillRect(x, midY - halfAmp, drawWidth, amp)
        }
      }

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)

    return () => {
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // v16.17: Removed `progress` and `isPlaying` from deps — they're read from
    // refs inside the render loop. This prevents the effect from re-running
    // on every progress update (which was killing the animation).
  }, [barCount, variant])

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${className}`}
      style={{ height: `${height}px` }}
      aria-hidden="true"
    />
  )
}
