'use client'

// ============================================================================
// Sound effects utility — synthesized via Web Audio API (no audio files).
//
// All sounds are short (<300ms), subtle, modern, and respect the user's
// "999pro-sounds-enabled" localStorage setting (same key as the message
// sound in use-notifications.ts).
//
// Sound design philosophy:
//   • Light, glassy, premium — no harsh or annoying tones
//   • Two-note arpeggios / soft sweeps for positive events
//   • Soft low tones for warnings/errors (never harsh buzzers)
//   • Distinct timbres so users can identify the event by sound
//
// Sound catalog:
//   tap        — 800Hz sine, 30ms, very soft click
//   send       — 600→1200Hz sweep, 80ms "whoosh" (sending message)
//   message    — two-note arpeggio (C5→E5), 150ms (incoming chat message)
//   like       — 880→1320Hz sweep, 60ms bright pop
//   cart       — C5→G5 sweep, 100ms happy ding
//   success    — E5→B5 sweep, 120ms bright success
//   order      — three-note arpeggio (C5-E5-G5), 220ms (order placed)
//   club       — two-note rising (A4→E5), 180ms (CLUB points received)
//   warning    — soft low two-note (A3→A3), 220ms
//   error      — soft low descending (220→165Hz), 240ms
//   notify     — soft bell (C6 + E6 harmonic), 180ms (generic notification)
//   adminReply — bright three-note (G5-B5-D6), 240ms (admin response received)
//
// Usage:
//   import { sounds } from '@/lib/sounds'
//   sounds.cart()
//   sounds.order()
//   sounds.club()
// ============================================================================

import { getSharedAudioContext } from '@/lib/audio-context'

function getCtx(): AudioContext | null {
  return getSharedAudioContext()
}

function soundsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem('999pro-sounds-enabled') !== 'false'
  } catch {
    return false
  }
}

/** Play a single oscillator tone with a gain envelope. */
function playTone(
  freqStart: number,
  freqEnd: number,
  duration: number,
  type: OscillatorType = 'sine',
  peakGain: number = 0.1,
  startDelay: number = 0,
): void {
  if (!soundsEnabled()) return
  const ctx = getCtx()
  if (!ctx) return

  const now = ctx.currentTime + startDelay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freqStart, now)
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), now + duration)
  }

  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peakGain, now + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

/** Play a two-note arpeggio (note1 then note2, slight overlap). */
function playArpeggio2(
  freq1: number,
  freq2: number,
  noteDuration: number = 0.08,
  gap: number = 0.05,
  type: OscillatorType = 'sine',
  peakGain: number = 0.1,
): void {
  playTone(freq1, freq1, noteDuration, type, peakGain, 0)
  playTone(freq2, freq2, noteDuration, type, peakGain * 0.9, gap)
}

/** Play a three-note arpeggio. */
function playArpeggio3(
  freq1: number,
  freq2: number,
  freq3: number,
  noteDuration: number = 0.08,
  gap: number = 0.06,
  type: OscillatorType = 'sine',
  peakGain: number = 0.1,
): void {
  playTone(freq1, freq1, noteDuration, type, peakGain, 0)
  playTone(freq2, freq2, noteDuration, type, peakGain * 0.9, gap)
  playTone(freq3, freq3, noteDuration, type, peakGain * 0.85, gap * 2)
}

/** Play a soft bell — two frequencies at once (root + perfect fifth harmonic). */
function playBell(
  freq: number,
  duration: number = 0.18,
  peakGain: number = 0.08,
): void {
  // Triangle for the root note (softer than sine)
  playTone(freq, freq, duration, 'triangle', peakGain, 0)
  // Perfect fifth harmonic, slightly quieter, slightly delayed
  playTone(freq * 1.5, freq * 1.5, duration * 0.8, 'sine', peakGain * 0.6, 0.01)
}

export const sounds = {
  /** Soft click — button taps, tab switches. */
  tap() {
    playTone(800, 800, 0.03, 'sine', 0.05)
  },
  /** "Whoosh" — sending a message. */
  send() {
    playTone(600, 1200, 0.08, 'sine', 0.12)
  },
  /** Incoming chat message — soft two-note arpeggio (C5 → E5). */
  message() {
    playArpeggio2(523.25, 659.25, 0.1, 0.05, 'sine', 0.1)
  },
  /** Bright "pop" — adding to favorites. */
  like() {
    playTone(880, 1320, 0.06, 'sine', 0.1)
  },
  /** Happy "ding" — adding to cart (C5 → G5 sweep). */
  cart() {
    playTone(523.25, 783.99, 0.1, 'sine', 0.12)
  },
  /** Bright success — login OK, registration, share sent. */
  success() {
    playTone(659.25, 987.77, 0.12, 'sine', 0.12)
  },
  /** Order placed — three-note rising arpeggio (C5 → E5 → G5). */
  order() {
    playArpeggio3(523.25, 659.25, 783.99, 0.1, 0.07, 'sine', 0.12)
  },
  /** CLUB points received — two-note rising (A4 → E5). */
  club() {
    playArpeggio2(440, 659.25, 0.12, 0.07, 'sine', 0.11)
  },
  /** Soft warning — low two-note (A3 → A3 sustained, slight detune). */
  warning() {
    playTone(220, 220, 0.18, 'triangle', 0.09, 0)
    playTone(233.08, 233.08, 0.18, 'sine', 0.05, 0.02) // slight harmonic
  },
  /** Soft error — descending low tone (220 → 165Hz), never harsh. */
  error() {
    playTone(220, 164.81, 0.22, 'triangle', 0.09)
  },
  /** Generic notification — soft bell (C6 + G6 harmonic). */
  notify() {
    playBell(1046.5, 0.18, 0.08)
  },
  /** Admin reply received — bright three-note arpeggio (G5 → B5 → D6). */
  adminReply() {
    playArpeggio3(783.99, 987.77, 1174.66, 0.1, 0.07, 'sine', 0.1)
  },
}
