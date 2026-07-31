'use client'

import { useEffect, useRef, useState } from 'react'

// ============================================================================
// VoiceWaveVisualizer — organic, living waveform driven by mic amplitude.
//
// NOT an equaliser. NOT bars. NOT sticks. An organic wave — like energy
// flowing through the air, breathing with the user's voice.
//
// Implementation:
//   • SVG <path> morphs every frame via a requestAnimationFrame loop.
//   • The path is built from 64 control points along the X axis. Each point's
//     Y position is a sum of three sine waves at different frequencies +
//     amplitudes, with the mic amplitude (0..1) driving the overall scale.
//   • Three layered paths (back / mid / front) at different opacities +
//     colors create depth — feels like a 3D wave, not a flat line.
//   • The brand gradient (sky → blue → violet) is applied via SVG linearGradient.
//   • A soft glow filter (feGaussianBlur) gives the inner luminosity.
//
// Performance:
//   • Reads `amplitudeRef.current` directly inside the RAF loop — no React
//     re-renders on each frame.
//   • The path `d` attribute is mutated via setAttribute — no React state.
//   • 64 control points × 3 paths = 192 point updates per frame. At 60fps
//     that's 11.5k ops/sec — trivial for modern devices.
//   • `prefers-reduced-motion` → render a static gentle wave (no RAF).
// ============================================================================

interface VoiceWaveVisualizerProps {
  /** Ref to a 0..1 amplitude value. Updated externally (e.g. by useMicAmplitude). */
  amplitudeRef: React.MutableRefObject<number>
  /** Width of the SVG viewBox. Default 320. */
  width?: number
  /** Height of the SVG viewBox. Default 120. */
  height?: number
  /** Color palette — defaults to brand (sky → blue → violet). */
  colors?: {
    front: string
    mid: string
    back: string
    glow: string
  }
  /** When true, renders at lower opacity (used for the unplayed portion
   *  of a voice message). Default: false. */
  dimmed?: boolean
  /** className for the wrapper. */
  className?: string
}

const DEFAULT_COLORS = {
  front: '#38bdf8', // sky-400
  mid: '#2563eb', // blue-600
  back: '#7c3aed', // violet-600
  glow: '#60a5fa', // blue-400
}

export function VoiceWaveVisualizer({
  amplitudeRef,
  width = 320,
  height = 120,
  colors = DEFAULT_COLORS,
  dimmed = false,
  className,
}: VoiceWaveVisualizerProps) {
  const frontRef = useRef<SVGPathElement | null>(null)
  const midRef = useRef<SVGPathElement | null>(null)
  const backRef = useRef<SVGPathElement | null>(null)
  const rafRef = useRef<number>(0)
  // Phase offsets for the three layers — they drift at different speeds so
  // the wave never repeats the same shape.
  const phaseRef = useRef({ front: 0, mid: 0, back: 0 })

  useEffect(() => {
    // Respect reduced-motion: render a single static frame and bail.
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      drawWave(frontRef.current, midRef.current, backRef.current, 0.15, phaseRef.current, width, height)
      return
    }

    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(50, now - last) / 1000 // clamp to 50ms (avoids jumps on tab-switch)
      last = now

      // Drift phases at different speeds — gives organic, non-repeating motion.
      phaseRef.current.front += dt * 1.8
      phaseRef.current.mid += dt * 1.3
      phaseRef.current.back += dt * 0.9

      // Target amplitude: ref value + a tiny idle baseline so the wave is
      // never fully flat (alive even in silence).
      const amp = amplitudeRef.current
      const target = 0.08 + amp * 0.92
      // Smooth: ease towards target (low-pass filter — removes jitter).
      smoothAmp.current += (target - smoothAmp.current) * 0.18

      drawWave(frontRef.current, midRef.current, backRef.current, smoothAmp.current, phaseRef.current, width, height)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [amplitudeRef, width, height])

  // Smoothed amplitude — low-pass filtered inside the RAF loop.
  const smoothAmp = useRef(0.08)

  // Unique gradient IDs to avoid collisions when multiple visualisers mount.
  // useState (not useRef) so the value is stable across renders without
  // triggering the "ref access during render" lint warning.
  const [gid] = useState(() => `vwg-${Math.random().toString(36).slice(2, 9)}`)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        overflow: 'visible',
        // dimmed: lower opacity for the unplayed portion of a voice message.
        // Uses opacity (GPU-composited) — no re-paint.
        opacity: dimmed ? 0.35 : 1,
        transition: 'opacity 0.2s ease',
      }}
      aria-hidden
    >
      <defs>
        {/* Brand gradient: sky → blue → violet, horizontal flow. */}
        <linearGradient id={`${gid}-front`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colors.front} />
          <stop offset="50%" stopColor={colors.mid} />
          <stop offset="100%" stopColor={colors.back} />
        </linearGradient>
        <linearGradient id={`${gid}-mid`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colors.front} stopOpacity="0.55" />
          <stop offset="50%" stopColor={colors.mid} stopOpacity="0.55" />
          <stop offset="100%" stopColor={colors.back} stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${gid}-back`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colors.front} stopOpacity="0.25" />
          <stop offset="50%" stopColor={colors.mid} stopOpacity="0.25" />
          <stop offset="100%" stopColor={colors.back} stopOpacity="0.25" />
        </linearGradient>
        {/* Soft glow filter — gives the inner luminosity. */}
        <filter id={`${gid}-glow`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Three layered paths — back is widest/softest, front is sharpest.
          Each is a closed shape from baseline → wave → baseline so we can
          fill it with the gradient. */}
      <path ref={backRef} fill={`url(#${gid}-back)`} filter={`url(#${gid}-glow)`} />
      <path ref={midRef} fill={`url(#${gid}-mid)`} filter={`url(#${gid}-glow)`} />
      <path ref={frontRef} fill={`url(#${gid}-front)`} filter={`url(#${gid}-glow)`} />
    </svg>
  )
}

// ----------------------------------------------------------------------------
//  drawWave — build the SVG path `d` attribute for a single frame.
//
//  64 control points along the X axis. Each Y position is the sum of three
//  sine waves at different frequencies. The amplitude scales the overall
//  height. The path is closed (baseline → wave → baseline) so the gradient
//  fill renders as a solid organic shape.
// ----------------------------------------------------------------------------

function drawWave(
  frontEl: SVGPathElement | null,
  midEl: SVGPathElement | null,
  backEl: SVGPathElement | null,
  amp: number, // 0..1
  phase: { front: number; mid: number; back: number },
  width: number,
  height: number,
) {
  const cy = height / 2
  // v9-voice-final: 44% of SVG height (was 42%) — slightly more expressive.
  // Combined with the 40% taller container (h-12 vs h-7), the wave is now
  // ~2x more visually prominent than before.
  const maxAmp = height * 0.44

  // Back layer: slowest phase, widest blur, lowest opacity.
  if (backEl) {
    backEl.setAttribute('d', buildPath(width, cy, maxAmp * amp * 0.7, phase.back, 1.0, 2.4, 0.6))
  }
  // Mid layer: medium phase, medium opacity.
  if (midEl) {
    midEl.setAttribute('d', buildPath(width, cy, maxAmp * amp * 0.88, phase.mid, 1.4, 3.1, 0.9))
  }
  // Front layer: fastest phase, sharpest, highest opacity.
  if (frontEl) {
    frontEl.setAttribute('d', buildPath(width, cy, maxAmp * amp, phase.front, 1.8, 3.8, 1.2))
  }
}

// ----------------------------------------------------------------------------
//  Windowed amplitude envelope.
//
//  Applies a smooth fade-in at the start (first `fadeFrac` of the width) and a
//  smooth fade-out at the end (last `fadeFrac`). The envelope is a raised-cosine
//  (Hann) window — gives a perfectly smooth, derivative-continuous fade with no
//  sharp corners. amp(0)=0, amp(0.5*fadeFrac)=0.5, amp(fadeFrac)=1, then 1 across
//  the middle, then mirrored at the end.
//
//  This eliminates the "cut-off" look at the start and end of the wave — the
//  bars gently rise from zero at the left edge and gently fall back to zero at
//  the right edge.
// ----------------------------------------------------------------------------
function fadeEnvelope(progress: number, fadeFrac = 0.18): number {
  // progress is 0..1 along the X axis.
  if (progress <= 0 || progress >= 1) return 0
  if (progress < fadeFrac) {
    // Fade-in: raised cosine from 0 to 1 over [0, fadeFrac].
    const t = progress / fadeFrac
    return 0.5 * (1 - Math.cos(Math.PI * t))
  }
  if (progress > 1 - fadeFrac) {
    // Fade-out: raised cosine from 1 to 0 over [1-fadeFrac, 1].
    const t = (1 - progress) / fadeFrac
    return 0.5 * (1 - Math.cos(Math.PI * t))
  }
  return 1
}

// ----------------------------------------------------------------------------
//  buildPath — build the SVG path `d` attribute for a single frame.
//
//  64 control points along the X axis. Each Y position is the sum of three
//  sine waves at different frequencies. The amplitude scales the overall
//  height. The path is closed (baseline → wave → baseline) so the gradient
//  fill renders as a solid organic shape.
//
//  v16.8-final: smooth Catmull-Rom → cubic Bézier interpolation between
//  control points. This eliminates the polygonal " sharp edge" look of the
//  previous `L` (line-to) commands and gives a flowing, organic curve with
//  no visible corners. Combined with the fade envelope at the ends, the wave
//  now starts and ends smoothly with no abrupt cutoff.
// ----------------------------------------------------------------------------

function buildPath(
  width: number,
  cy: number,
  amp: number,
  phase: number,
  f1: number,
  f2: number,
  f3: number,
): string {
  const N = 64
  // Pre-compute the control points (x, yTop, yBottom) — we need them all
  // available for Catmull-Rom tangent calculation.
  const xs: number[] = []
  const ysTop: number[] = []
  const ysBot: number[] = []
  for (let i = 0; i <= N; i++) {
    const progress = i / N
    const x = progress * width
    const t = progress * Math.PI * 2
    // Fade envelope — smooth fade-in / fade-out at the ends.
    const fade = fadeEnvelope(progress, 0.18)
    // Sum of three sines → organic, non-repeating shape.
    const top =
      cy -
      amp *
        fade *
        (Math.sin(t * f1 + phase) * 0.55 +
          Math.sin(t * f2 + phase * 1.3) * 0.3 +
          Math.sin(t * f3 + phase * 0.7) * 0.15)
    const bot =
      cy +
      amp *
        fade *
        (Math.sin(t * f1 + phase + 0.4) * 0.5 +
          Math.sin(t * f2 + phase * 1.3 + 0.2) * 0.32 +
          Math.sin(t * f3 + phase * 0.7 + 0.6) * 0.18)
    xs.push(x)
    ysTop.push(top)
    ysBot.push(bot)
  }

  // Catmull-Rom spline through the top edge (left → right).
  // For each segment between points P[i] and P[i+1], we compute a cubic
  // Bézier with control points derived from P[i-1] and P[i+2]. This gives
  // C¹ continuity across segments (smooth tangents, no corners).
  const parts: string[] = []
  parts.push(`M${xs[0].toFixed(2)},${ysTop[0].toFixed(2)}`)
  for (let i = 0; i < N; i++) {
    const p0y = ysTop[i - 1] ?? ysTop[i]
    const p1y = ysTop[i]
    const p2y = ysTop[i + 1]
    const p3y = ysTop[i + 2] ?? ysTop[i + 1]
    const x1 = xs[i]
    const x2 = xs[i + 1]
    // Catmull-Rom → Bézier control points (tension = 1, standard formula).
    const c1x = x1 + (x2 - x0(xs, i - 1)) / 6
    const c1y = p1y + (p2y - p0y) / 6
    const c2x = x2 - (x3(xs, i + 2) - x1) / 6
    const c2y = p2y - (p3y - p1y) / 6
    parts.push(`C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${x2.toFixed(2)},${p2y.toFixed(2)}`)
  }
  // Bottom edge (right → left) — same spline, mirrored.
  for (let i = N; i > 0; i--) {
    const p0y = ysBot[i + 1] ?? ysBot[i]
    const p1y = ysBot[i]
    const p2y = ysBot[i - 1]
    const p3y = ysBot[i - 2] ?? ysBot[i - 1]
    const x1 = xs[i]
    const x2 = xs[i - 1]
    const c1x = x1 + (x2 - x3(xs, i + 1)) / 6
    const c1y = p1y + (p2y - p0y) / 6
    const c2x = x2 - (x0(xs, i - 2) - x1) / 6
    const c2y = p2y - (p3y - p1y) / 6
    parts.push(`C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${x2.toFixed(2)},${p2y.toFixed(2)}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

// Helpers — safe array access for Catmull-Rom tangent calculation.
function x0(xs: number[], i: number): number {
  return xs[i] ?? xs[0]
}
function x3(xs: number[], i: number): number {
  return xs[i] ?? xs[xs.length - 1]
}
