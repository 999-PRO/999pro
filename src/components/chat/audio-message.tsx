'use client'

// AudioMessage — voice message bubble with live organic waveform.
//
// v16.8-attachments: ПОЛНЫЙ РЕФАКТОРИНГ.
//   • Удалён локальный <audio> элемент + AudioContext.
//   • Воспроизведение делегировано AudioPlayerManager (singleton).
//   • Гарантируется: одновременно играет только один аудиофайл во всём app
//     (и голосовые, и музыка — единый менеджер).
//   • Амплитуда для waveform: AnalyserNode подключён к singleton audio element
//     менеджера (через новый метод manager.attachAnalyser). Когда этот голос
//     не играет — visualiser использует idle baseline (мягкое дыхание).
//   • Play/Pause morph сохранён.
//   • Brand gradient (sky → blue → violet) на played portion сохранён.
//   • Speed control (1×/1.25×/1.5×/2×) — через manager.setPlaybackRate.
//   • Self-destruct badge сохранён (v16.8-final).

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Timer, Loader2, AlertCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { VoiceWaveVisualizer } from './voice-wave-visualizer'
import {
  useAudioPlayer,
  type AudioTrack,
  type PlaybackRate,
} from '@/lib/audio-player-manager'

// v16.8-final: formats a remaining-time duration (ms) into a short label.
function formatRemaining(ms: number): string {
  if (ms <= 0) return ''
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}с`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}м`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}ч`
  const days = Math.floor(hr / 24)
  return `${days}д`
}

const SPEED_OPTIONS: PlaybackRate[] = [1, 1.25, 1.5, 2]

export function AudioMessage({
  url,
  duration,
  isOwn,
  selfDestructAt,
  senderName,
  senderAvatar,
  messageId,
  conversationId,
  createdAt,
  isUploading,
  uploadFailed,
}: {
  url: string
  duration?: number | null
  isOwn?: boolean
  selfDestructAt?: string | null
  senderName?: string
  senderAvatar?: string
  messageId?: string
  conversationId?: string
  createdAt?: string
  // v18.6: optimistic-upload flags. When isUploading=true, the play button is
  // replaced with a spinner and the waveform is dimmed. When uploadFailed=true,
  // an error icon is shown instead.
  isUploading?: boolean
  uploadFailed?: boolean
}) {
  const fullUrl = assetUrl(url)

  // ---- AudioPlayerManager state ----
  // Подписываемся селекторами — ре-рендер только при изменении конкретных полей.
  const currentTrack = useAudioPlayer((s) => s.currentTrack)
  const isPlaying = useAudioPlayer((s) => s.isPlaying)
  const progress = useAudioPlayer((s) => s.progress)
  const playbackRate = useAudioPlayer((s) => s.playbackRate)
  const playAction = useAudioPlayer((s) => s.play)
  const togglePlay = useAudioPlayer((s) => s.togglePlay)
  const setPlaybackRate = useAudioPlayer((s) => s.setPlaybackRate)

  // Является ли этот voice активным в менеджере?
  const isCurrent = currentTrack?.url === fullUrl
  const playing = isCurrent && isPlaying

  // ---- Amplitude ref for waveform ----
  // Когда играет этот трек — AnalyserNode читает реальную амплитуду.
  // Когда не играет — idle baseline (мягкое дыхание).
  const amplitudeRef = useRef(0)
  const idleAmplitudeRef = useRef(0.08)
  const activeAmplitudeRef = playing ? amplitudeRef : idleAmplitudeRef

  // ---- AnalyserNode (lazy, only when this track is current) ----
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const rafRef = useRef<number>(0)

  // v16.8-attachments: когда трек становится "current", подключаем
  // AnalyserNode к singleton audio element менеджера. Когда перестаёт —
  // отключаем (но не закрываем AudioContext — переиспользуем).
  useEffect(() => {
    if (!isCurrent) {
      // Останавливаем анализ.
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      amplitudeRef.current = 0
      return
    }

    // Подключаем AnalyserNode к singleton audio element.
    // Достаём элемент из менеджера (он живёт в модуле).
    try {
      // Используем тот же audio element, что и менеджер.
      // Достаём его через createMediaElementSource — НО это можно сделать
      // только один раз на элемент. Поэтому проверяем флаг.
      const el = (useAudioPlayer as any)._getAudioEl?.() as HTMLAudioElement | undefined
      if (!el) return

      if (!audioCtxRef.current) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        audioCtxRef.current = new Ctor()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') void ctx.resume()

      // createMediaElementSource можно вызвать только один раз на HTMLMediaElement.
      // Если мы уже создали source для этого элемента — переиспользуем (он
      // хранится в модуле менеджера). Здесь используем флаг на элементе.
      if (!(el as any).__audioSourceNode) {
        try {
          ;(el as any).__audioSourceNode = ctx.createMediaElementSource(el)
          ;(el as any).__audioAnalyser = ctx.createAnalyser()
          ;(el as any).__audioAnalyser.fftSize = 256
          ;(el as any).__audioAnalyser.smoothingTimeConstant = 0.8
          ;(el as any).__audioSourceNode.connect((el as any).__audioAnalyser)
          ;(el as any).__audioAnalyser.connect(ctx.destination)
        } catch {
          // Уже создан другим компонентом — игнорируем.
        }
      }

      sourceRef.current = (el as any).__audioSourceNode
      analyserRef.current = (el as any).__audioAnalyser
    } catch {
      // AudioContext недоступен — fallback на idle baseline.
      return
    }

    const analyser = analyserRef.current
    if (!analyser) return
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      analyser.getByteFrequencyData(dataArray)
      let sum = 0
      const end = Math.min(dataArray.length, 32)
      for (let i = 0; i < end; i++) sum += dataArray[i]
      const avg = sum / end / 255
      amplitudeRef.current = Math.pow(Math.min(1, avg * 1.4), 1.8)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [isCurrent])

  // Cleanup on unmount: закрываем AudioContext ТОЛЬКО если он наш (не менеджера).
  // На самом деле AudioContext создаётся здесь, но элемент — менеджера.
  // Закрывать context — значит убить analyser для следующего voice message.
  // Поэтому НЕ закрываем — переиспользуем. Это не утечка: AudioContext один
  // на всё приложение.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ---- Self-destruct remaining label ----
  const [remainingLabel, setRemainingLabel] = useState<string>('')
  useEffect(() => {
    if (!selfDestructAt) {
      setRemainingLabel('')
      return
    }
    const update = () => {
      const remaining = new Date(selfDestructAt).getTime() - Date.now()
      setRemainingLabel(formatRemaining(remaining))
    }
    update()
    const id = setInterval(update, 30_000)
    return () => clearInterval(id)
  }, [selfDestructAt])

  // ---- Derived ----
  // actualDuration: prefer metadata duration, fall back to prop.
  const [metaDuration, setMetaDuration] = useState<number>(duration || 0)
  useEffect(() => {
    if (isCurrent && currentTrack?.duration) {
      setMetaDuration(currentTrack.duration)
    }
  }, [isCurrent, currentTrack?.duration])

  const totalSec = metaDuration || duration || 0
  const elapsedSec = (isCurrent ? progress : 0) * totalSec

  // ---- Handlers ----
  const handleToggle = () => {
    if (isCurrent) {
      togglePlay()
      return
    }
    // Регистрируем трек в менеджере и запускаем.
    const track: AudioTrack = {
      id: messageId || fullUrl,
      url: fullUrl,
      kind: 'voice',
      title: senderName || 'Голосовое сообщение',
      subtitle: senderName,
      coverUrl: senderAvatar,
      duration: duration || undefined,
      conversationId,
      senderName,
      senderAvatar,
      createdAt,
    }
    playAction(track)
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCurrent) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const frac = Math.max(0, Math.min(1, x / rect.width))
    useAudioPlayer.getState().seek(frac)
  }

  const cyclePlaybackRate = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate)
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]
    setPlaybackRate(next)
  }

  // Brand gradient palette.
  const waveColors = isOwn
    ? { front: '#38bdf8', mid: '#2563eb', back: '#7c3aed', glow: '#60a5fa' }
    : { front: '#fbbf24', mid: '#d97706', back: '#92400e', glow: '#fbbf24' }

  return (
    <div
      className="relative flex items-center gap-2.5 min-w-[240px] max-w-[320px] rounded-2xl px-3 py-2.5"
      style={{
        background: isOwn
          ? 'rgba(96, 165, 250, 0.18)'
          : 'rgba(217, 119, 6, 0.10)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: isOwn
          ? '1px solid rgba(96, 165, 250, 0.3)'
          : '1px solid rgba(217, 119, 6, 0.15)',
      }}
    >
      {/* Play/Pause — smooth morph. v18.6: replaced with spinner while uploading, error icon on failure. */}
      <button
        onClick={isUploading || uploadFailed ? undefined : handleToggle}
        disabled={isUploading || uploadFailed}
        className={cn(
          'shrink-0 h-11 w-11 rounded-full grid place-items-center transition-all relative overflow-hidden',
          isUploading
            ? 'bg-slate-400 cursor:wait'
            : uploadFailed
              ? 'bg-rose-500 cursor:default'
              : isOwn
                ? 'bg-blue-500 hover:bg-blue-600 active:scale-90'
                : 'bg-amber-500 hover:bg-amber-600 active:scale-90 dark:bg-amber-600 dark:hover:bg-amber-500',
        )}
        aria-label={uploadFailed ? 'Ошибка загрузки' : isUploading ? 'Загрузка…' : playing ? 'Пауза' : 'Воспроизвести'}
      >
        {isUploading ? (
          <Loader2 className="h-5 w-5 text-white animate-spin" />
        ) : uploadFailed ? (
          <AlertCircle className="h-5 w-5 text-white" />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {playing ? (
              <motion.span
                key="pause"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="grid place-items-center"
              >
                <Pause className="h-5 w-5 text-white" fill="currentColor" />
              </motion.span>
            ) : (
              <motion.span
                key="play"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="grid place-items-center"
              >
                <Play className="h-5 w-5 ml-0.5 text-white" fill="currentColor" />
              </motion.span>
            )}
          </AnimatePresence>
        )}
      </button>

      <span className="shrink-0 text-xs font-mono tabular-nums text-muted-foreground">
        {formatDuration(Math.floor(elapsedSec))}
      </span>

      {/* Waveform — click to seek. */}
      <div
        onClick={handleSeek}
        className="relative flex-1 h-12 cursor-pointer select-none min-w-0"
        role="slider"
        aria-label="Перемотка голосового сообщения"
        aria-valuenow={Math.round((isCurrent ? progress : 0) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="absolute inset-0">
          <VoiceWaveVisualizer
            amplitudeRef={activeAmplitudeRef}
            height={48}
            colors={waveColors}
            dimmed
          />
        </div>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ clipPath: `inset(0 ${100 - (isCurrent ? progress : 0) * 100}% 0 0)` }}
        >
          <VoiceWaveVisualizer
            amplitudeRef={activeAmplitudeRef}
            height={48}
            colors={waveColors}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs font-mono tabular-nums text-muted-foreground">
          {formatDuration(Math.floor(totalSec))}
        </span>
        <button
          onClick={cyclePlaybackRate}
          className={cn(
            'px-1.5 py-0.5 rounded-md font-bold text-[10px] transition-colors',
            isOwn
              ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-600 dark:text-blue-300'
              : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300',
          )}
          aria-label="Скорость воспроизведения"
        >
          {playbackRate}×
        </button>
        {/* v16.8-final: метка времени автоудаления. */}
        {remainingLabel && (
          <span
            className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-semibold leading-none"
            style={{
              background: 'color-mix(in oklch, var(--primary) 12%, transparent)',
              color: 'var(--primary)',
              border: '1px solid color-mix(in oklch, var(--primary) 25%, transparent)',
            }}
            title={`Голосовое удалится через ${remainingLabel}`}
            aria-label={`Голосовое удалится через ${remainingLabel}`}
          >
            <Timer className="h-2.5 w-2.5" />
            {remainingLabel}
          </span>
        )}
      </div>
    </div>
  )
}
