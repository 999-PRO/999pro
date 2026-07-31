'use client'

// ============================================================================
// Video Hub — Film Player (v18.2) — на базе модульного PlayerEngine
// ----------------------------------------------------------------------------
// Плеер использует PlayerEngine, который автоматически:
//   • определяет тип потока (HLS/DASH/MP4/iframe)
//   • выбирает подходящий адаптер
//   • перебирает источники при ошибках
//   • скрывает технические ошибки от пользователя
//
// UI полностью собственный — никаких интерфейсов сторонних сайтов.
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Settings, PictureInPicture2,
  Loader2, AlertCircle, X, Layers, Link2, CheckCircle2,
} from 'lucide-react'
import type { FilmPlayerOption } from '../types'
import type { StreamSource, QualityLevel, AdapterState } from '../player'
import { PlayerEngine, detectStreamType } from '../player'
import { resolvePlayerStream } from '../api'
import { useVideoPipStore } from '../video-pip-store'

export interface FilmPlayerProps {
  title: string
  subtitle?: string
  posterUrl?: string | null
  players: FilmPlayerOption[]
  initialTime?: number
  onProgress?: (position: number, duration: number) => void
  onEnded?: () => void
  onClose?: () => void
  autoPlay?: boolean
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Преобразует FilmPlayerOption в StreamSource для engine */
function playerOptionToStreams(opt: FilmPlayerOption): StreamSource[] {
  const streams: StreamSource[] = []
  // If we already have a direct stream URL, add it first
  if (opt.streamUrl) {
    const type = detectStreamType(opt.streamUrl)
    streams.push({
      url: opt.streamUrl,
      type,
      quality: opt.quality,
      translation: opt.translation,
      label: opt.name,
    })
  }
  // Also add the iframe URL as fallback
  if (opt.iframeUrl && opt.iframeUrl !== opt.streamUrl) {
    streams.push({
      url: opt.iframeUrl,
      type: 'iframe',
      quality: opt.quality,
      translation: opt.translation,
      label: opt.name,
    })
  }
  return streams
}

export function FilmPlayer({
  title,
  subtitle,
  posterUrl,
  players,
  initialTime = 0,
  onProgress,
  onEnded,
  onClose,
  autoPlay = true,
}: FilmPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<PlayerEngine | null>(null)
  const controlsTimerRef = useRef<number | null>(null)
  const lastProgressEmitRef = useRef<number>(0)

  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [levels, setLevels] = useState<QualityLevel[]>([])
  const [currentLevel, setCurrentLevel] = useState(-1)
  const [showLevels, setShowLevels] = useState(false)
  const [showSpeed, setShowSpeed] = useState(false)
  const [showSelector, setShowSelector] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activePlayerIndex, setActivePlayerIndex] = useState(0)
  const [manualMode, setManualMode] = useState(false)
  const [manualUrl, setManualUrl] = useState('')
  const [manualUrlInput, setManualUrlInput] = useState('')
  const [resolving, setResolving] = useState(false)
  const [activeAdapter, setActiveAdapter] = useState<string>('none')

  // ---- Initialize engine ----
  useEffect(() => {
    if (!videoRef.current || !iframeRef.current) return

    // Build sources array: each player → array of streams
    // First, resolve all players' direct streams in parallel (best effort)
    const buildSources = async (): Promise<StreamSource[][]> => {
      const sources: StreamSource[][] = []
      for (const player of players) {
        // If player already has streamUrl, use it
        if (player.streamUrl) {
          sources.push(playerOptionToStreams(player))
        } else {
          // Try to resolve on-the-fly
          try {
            const resolved = await resolvePlayerStream(player.iframeUrl)
            if (resolved.streamUrl) {
              // Treat props as immutable — build a new player object locally.
              const enhanced: typeof player = {
                ...player,
                streamUrl: resolved.streamUrl,
                extractorType: resolved.type,
              }
              sources.push(playerOptionToStreams(enhanced))
            } else {
              // Just use iframe
              sources.push([{
                url: player.iframeUrl,
                type: 'iframe',
                quality: player.quality,
                translation: player.translation,
                label: player.name,
              }])
            }
          } catch {
            sources.push([{
              url: player.iframeUrl,
              type: 'iframe',
              quality: player.quality,
              translation: player.translation,
              label: player.name,
            }])
          }
        }
      }
      return sources
    }

    const engine = new PlayerEngine({
      initTimeout: 12000,
      resumeFrom: initialTime,
      autoPlay,
      onLog: (msg) => { if (process.env.NODE_ENV !== 'production') console.debug(msg) },
    })
    engineRef.current = engine

    engine.onEvent((event) => {
      switch (event.type) {
        case 'stateChange':
          if (event.state === 'playing') {
            setIsPlaying(true)
            setIsLoading(false)
            setError(null)
          } else if (event.state === 'paused') {
            setIsPlaying(false)
            setIsLoading(false)
          } else if (event.state === 'loading') {
            setIsLoading(true)
          } else if (event.state === 'ready') {
            setIsLoading(false)
          } else if (event.state === 'error') {
            setIsLoading(false)
          } else if (event.state === 'ended') {
            setIsPlaying(false)
            onEnded?.()
          }
          setActiveAdapter(engine.getActiveAdapterName())
          break
        case 'timeUpdate':
          setCurrentTime(event.currentTime)
          setDuration(event.duration)
          // Emit progress every 5s
          const now = Date.now()
          if (onProgress && now - lastProgressEmitRef.current > 5000) {
            lastProgressEmitRef.current = now
            onProgress(event.currentTime, event.duration)
          }
          break
        case 'progress':
          setBuffered(event.buffered)
          break
        case 'durationChange':
          setDuration(event.duration)
          break
        case 'levelsChange':
          setLevels(event.levels)
          setCurrentLevel(event.currentLevel)
          break
        case 'error':
          if (!event.recoverable) {
            setError(event.message)
          }
          // recoverable errors are handled by engine internally
          break
        case 'ended':
          setIsPlaying(false)
          onEnded?.()
          break
      }
    })

    setResolving(true)
    buildSources().then((sources) => {
      setResolving(false)
      engine.setSources(sources)
      engine.start(videoRef.current!, iframeRef.current!)
    })

    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players])

  // ---- Manual URL mode ----
  useEffect(() => {
    if (!manualMode || !manualUrl || !videoRef.current || !iframeRef.current) return
    if (!engineRef.current) return

    const streamType = detectStreamType(manualUrl)
    const source: StreamSource = {
      url: manualUrl,
      type: streamType,
      label: 'Своя ссылка',
    }
    engineRef.current.setSources([[source]])
    engineRef.current.start(videoRef.current, iframeRef.current)
     
  }, [manualMode, manualUrl])

  // ---- Fullscreen detection ----
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ---- Auto-hide controls ----
  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = window.setTimeout(() => {
      if (isPlaying && !showSpeed && !showLevels && !showSelector) setShowControls(false)
    }, 3500)
  }, [isPlaying, showSpeed, showLevels, showSelector])

  const showControlsTemp = useCallback(() => {
    setShowControls(true)
    scheduleHideControls()
  }, [scheduleHideControls])

  useEffect(() => {
    if (isPlaying && activeAdapter !== 'iframe') scheduleHideControls()
    else setShowControls(true)
  }, [isPlaying, scheduleHideControls, activeAdapter])

  // ---- Actions ----
  const togglePlay = () => engineRef.current?.play()
  const pause = () => engineRef.current?.pause()
  const seekBy = (delta: number) => {
    const t = engineRef.current?.getCurrentTime() || 0
    engineRef.current?.seek(Math.max(0, t + delta))
  }
  const seekTo = (t: number) => engineRef.current?.seek(t)
  const toggleMute = () => {
    const newVol = volume > 0 ? 0 : 1
    setVolume(newVol)
    engineRef.current?.setVolume(newVol)
  }
  const onVolumeChange = (val: number) => {
    setVolume(val)
    engineRef.current?.setVolume(val)
  }
  const changeSpeed = (s: number) => {
    setSpeed(s)
    engineRef.current?.setRate(s)
    setShowSpeed(false)
  }
  const changeLevel = (idx: number) => {
    setCurrentLevel(idx)
    engineRef.current?.setLevel(idx)
    setShowLevels(false)
  }

  const toggleFullscreen = async () => {
    const el = containerRef.current
    const v = videoRef.current
    if (!el && !v) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {})
      return
    }
    if (el?.requestFullscreen) {
      try { await el.requestFullscreen(); return } catch {}
    }
    if (v) {
      try {
        if ((v as any).webkitEnterFullscreen) (v as any).webkitEnterFullscreen()
        else if (v.requestFullscreen) await v.requestFullscreen()
      } catch {}
    }
  }

  const togglePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch {}
  }

  // ---- Minimize to PiP on close (if video is playing) ----
  // BUT: if skipPipOnClose is true (expanded from PiP), don't create new PiP
  const handleClose = useCallback(() => {
    if (!onClose) return
    const pipState = useVideoPipStore.getState()
    // If we were expanded FROM PiP, just collapse — don't create new PiP
    if (pipState.skipPipOnClose) {
      pipState.setSkipPipOnClose(false)
      pipState.setExpanded(false)
      onClose()
      return
    }
    // Normal close — if video is playing, minimize to PiP
    const currentPlayer = players[activePlayerIndex]
    const currentStreamUrl = currentPlayer?.streamUrl || currentPlayer?.iframeUrl || null
    if (isPlaying && currentStreamUrl && activeAdapter !== 'iframe') {
      const pos = engineRef.current?.getCurrentTime() || 0
      const dur = engineRef.current?.getDuration() || 0
      pipState.setPip({
        title,
        subtitle,
        posterUrl,
        streamUrl: currentStreamUrl,
        streamType: (currentPlayer?.extractorType || 'mp4') as any,
        position: pos,
        duration: dur,
        players,
      })
    }
    onClose()
  }, [onClose, isPlaying, activeAdapter, activePlayerIndex, title, subtitle, posterUrl, players, engineRef])

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect || !duration) return
    seekTo(((e.clientX - rect.left) / rect.width) * duration)
  }

  const switchToPlayer = (idx: number) => {
    setActivePlayerIndex(idx)
    setManualMode(false)
    setManualUrl('')
    setShowSelector(false)
    setError(null)
    setIsLoading(true)
    engineRef.current?.switchToSource(idx)
  }

  const applyManualUrl = () => {
    const url = manualUrlInput.trim()
    if (!url || !/^https?:\/\//.test(url)) return
    setManualUrl(url)
    setManualMode(true)
    setShowSelector(false)
    setError(null)
    setIsLoading(true)
  }

  // ---- Render ----
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0
  const isIframeMode = activeAdapter === 'iframe'
  const hasMultiplePlayers = players.length > 1

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[210] grid place-items-center p-2 sm:p-6"
      style={{
        background: 'rgba(5, 5, 15, 0.92)',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && handleClose) handleClose() }}
    >
      {/* Close button */}
      {onClose && (
        <button
          onClick={handleClose}
          className="absolute right-3 z-20 grid place-items-center h-10 w-10 rounded-full text-white active:scale-90 transition-transform"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.2)',
          }}
          aria-label="Закрыть плеер"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      {/* Player window */}
      <motion.div
        ref={containerRef}
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.9 }}
        className="relative w-full max-w-5xl rounded-2xl overflow-hidden bg-black"
        onMouseMove={showControlsTemp}
        onMouseLeave={() => isPlaying && !isIframeMode && !showSpeed && !showLevels && !showSelector && setShowControls(false)}
        style={{
          aspectRatio: '16 / 9',
          maxHeight: '85vh',
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)',
          cursor: isIframeMode ? 'default' : (showControls ? 'default' : 'none'),
        }}
      >
        {/* Video element (hidden when iframe mode is active) */}
        <video
          ref={videoRef}
          poster={posterUrl || undefined}
          className="absolute inset-0 w-full h-full object-contain"
          playsInline
          preload="metadata"
          onClick={() => { if (!isIframeMode) isPlaying ? pause() : togglePlay() }}
          style={{ display: isIframeMode ? 'none' : 'block' }}
        />

        {/* Iframe element (hidden when video mode is active) */}
        <iframe
          ref={iframeRef}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          frameBorder={0}
          style={{ display: isIframeMode ? 'block' : 'none' }}
        />

        {/* Loading overlay */}
        <AnimatePresence>
          {(isLoading || resolving) && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 grid place-items-center bg-black/60 pointer-events-none z-10"
            >
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-12 w-12 text-white/80 animate-spin" />
                <p className="text-xs text-white/60">
                  {resolving ? 'Подбираем поток…' : 'Загрузка видео…'}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fatal error — only shown if ALL sources failed */}
        <AnimatePresence>
          {error && !isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 grid place-items-center bg-black/85 z-20"
            >
              <div className="text-white flex flex-col items-center gap-3 p-8 text-center max-w-sm">
                <AlertCircle className="h-10 w-10 text-red-400" />
                <p className="text-sm">{error}</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <button
                    onClick={() => {
                      setError(null)
                      setIsLoading(true)
                      // Restart engine with same sources
                      if (engineRef.current && videoRef.current && iframeRef.current) {
                        engineRef.current.switchToSource(0)
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium flex items-center gap-2"
                  >
                    <Loader2 className="h-4 w-4" />
                    Повторить
                  </button>
                  <button
                    onClick={() => setShowSelector(true)}
                    className="px-4 py-2 rounded-xl text-sm font-medium"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white' }}
                  >
                    Выбрать источник
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top gradient + title (always shown when controls visible) */}
        <AnimatePresence>
          {showControls && !error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
              style={{
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
                padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 60px 12px 16px',
              }}
            >
              <div className="text-white font-semibold text-sm truncate">{title}</div>
              {subtitle && <div className="text-white/60 text-xs truncate mt-0.5">{subtitle}</div>}
              <div className="flex items-center gap-1.5 mt-1">
                {manualMode ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md text-white"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    Своя ссылка
                  </span>
                ) : (
                  <>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md text-white/80" style={{ background: 'rgba(255,255,255,0.1)' }}>
                      {players[activePlayerIndex]?.name || 'Плеер'}
                    </span>
                    {players[activePlayerIndex]?.translation && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md text-white/80" style={{ background: 'rgba(255,255,255,0.1)' }}>
                        {players[activePlayerIndex].translation}
                      </span>
                    )}
                  </>
                )}
                {isIframeMode && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md text-amber-300" style={{ background: 'rgba(245,158,11,0.15)' }}>
                    Встроенный плеер
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center play button when paused (video mode only) */}
        <AnimatePresence>
          {!isIframeMode && !isPlaying && !isLoading && !error && showControls && (
            <motion.button
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: 'spring', stiffness: 360, damping: 22 }}
              onClick={togglePlay}
              className="absolute inset-0 m-auto h-20 w-20 grid place-items-center pointer-events-auto z-10"
              style={{
                background: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '9999px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
              aria-label="Воспроизвести"
            >
              <Play className="h-9 w-9 text-white ml-1" fill="currentColor" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Bottom controls (video mode only) */}
        {!isIframeMode && (
          <AnimatePresence>
            {showControls && !error && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.2 }}
                className="absolute bottom-0 left-0 right-0 z-10"
                style={{
                  background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%)',
                  padding: '20px 12px 10px',
                }}
              >
                {/* Progress bar */}
                <div
                  ref={progressRef}
                  className="group relative h-1.5 rounded-full bg-white/20 cursor-pointer mb-3 hover:h-2 transition-all"
                  onClick={handleProgressClick}
                >
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${progressPct}%`, background: 'linear-gradient(to right, #6366f1, #8b5cf6, #ec4899)' }}
                  />
                  <div className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                    style={{ left: `calc(${progressPct}% - 7px)` }}
                  />
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-1 text-white">
                  <button onClick={() => isPlaying ? pause() : togglePlay()} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 transition-colors" aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}>
                    {isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5 ml-0.5" fill="currentColor" />}
                  </button>
                  <button onClick={() => seekBy(-10)} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 transition-colors" aria-label="Назад 10с">
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button onClick={() => seekBy(10)} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 transition-colors" aria-label="Вперёд 10с">
                    <SkipForward className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-1 group/vol">
                    <button onClick={toggleMute} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 transition-colors" aria-label={volume === 0 ? 'Включить звук' : 'Выключить звук'}>
                      {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                    <input type="range" min={0} max={1} step={0.05} value={volume}
                      onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                      className="w-0 group-hover/vol:w-16 transition-all duration-200 accent-white opacity-0 group-hover/vol:opacity-100"
                      style={{ height: '4px' }} aria-label="Громкость"
                    />
                  </div>
                  <div className="text-xs font-medium tabular-nums ml-1">
                    <span className="text-white">{formatTime(currentTime)}</span>
                    <span className="text-white/50 mx-1">/</span>
                    <span className="text-white/70">{formatTime(duration)}</span>
                  </div>
                  <div className="flex-1" />
                  {/* Player selector */}
                  {hasMultiplePlayers && (
                    <button onClick={() => { setShowSelector(v => !v); setShowSpeed(false); setShowLevels(false) }}
                      className="px-2.5 h-8 rounded-full hover:bg-white/15 transition-colors text-[11px] font-semibold flex items-center gap-1"
                      aria-label="Сменить источник"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{players[activePlayerIndex]?.name || 'Источник'}</span>
                    </button>
                  )}
                  {/* Quality selector */}
                  {levels.length > 1 && (
                    <div className="relative">
                      <button onClick={() => { setShowLevels(v => !v); setShowSpeed(false); setShowSelector(false) }}
                        className="px-2.5 h-8 rounded-full hover:bg-white/15 transition-colors text-[11px] font-semibold flex items-center gap-1"
                        aria-label="Качество"
                      >
                        <Settings className="h-3.5 w-3.5" />
                        <span>{currentLevel === -1 ? 'Авто' : levels[currentLevel]?.label || 'Авто'}</span>
                      </button>
                      <AnimatePresence>
                        {showLevels && (
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="absolute bottom-full right-0 mb-2 rounded-xl overflow-hidden min-w-[130px]"
                            style={{ background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.15)' }}
                          >
                            <button onClick={() => changeLevel(-1)}
                              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/15 transition-colors ${currentLevel === -1 ? 'text-white font-bold bg-white/5' : 'text-white/80'}`}>
                              Авто
                            </button>
                            {levels.map((l, i) => (
                              <button key={i} onClick={() => changeLevel(i)}
                                className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/15 transition-colors ${i === currentLevel ? 'text-white font-bold bg-white/5' : 'text-white/80'}`}>
                                {l.label}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                  {/* Speed */}
                  <div className="relative">
                    <button onClick={() => { setShowSpeed(v => !v); setShowLevels(false); setShowSelector(false) }}
                      className="px-2.5 h-8 rounded-full hover:bg-white/15 transition-colors text-[11px] font-semibold tabular-nums"
                      aria-label="Скорость"
                    >
                      {speed}×
                    </button>
                    <AnimatePresence>
                      {showSpeed && (
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute bottom-full right-0 mb-2 rounded-xl overflow-hidden min-w-[130px]"
                          style={{ background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.15)' }}
                        >
                          {SPEED_OPTIONS.map((s) => (
                            <button key={s} onClick={() => changeSpeed(s)}
                              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/15 transition-colors ${s === speed ? 'text-white font-bold bg-white/5' : 'text-white/80'}`}>
                              {s}× {s === 1 && '(норм.)'}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <button onClick={togglePip} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 transition-colors" aria-label="Картинка в картинке">
                    <PictureInPicture2 className="h-4 w-4" />
                  </button>
                  <button onClick={toggleFullscreen} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 transition-colors" aria-label={isFullscreen ? 'Выйти' : 'Полный экран'}>
                    {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* Iframe mode minimal controls */}
        {isIframeMode && !error && (
          <>
            <button
              onClick={() => setShowSelector(true)}
              className="absolute top-3 left-3 z-10 px-3 h-8 rounded-full text-[11px] font-semibold text-white flex items-center gap-1.5 active:scale-95 transition-transform"
              style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{manualMode ? 'Ссылка' : players[activePlayerIndex]?.name || 'Источник'}</span>
            </button>
          </>
        )}
      </motion.div>

      {/* Source selector panel */}
      <AnimatePresence>
        {showSelector && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 grid place-items-end sm:place-items-center"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowSelector(false) }}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="w-full sm:max-w-2xl max-h-[80vh] overflow-y-auto custom-scroll rounded-t-3xl sm:rounded-3xl p-4"
              style={{
                background: 'linear-gradient(180deg, rgba(15,15,30,0.98) 0%, rgba(10,10,20,0.98) 100%)',
                backdropFilter: 'blur(28px) saturate(180%)',
                border: '1px solid rgba(255,255,255,0.1)',
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-white" />
                  <h3 className="text-base font-semibold text-white">Источник воспроизведения</h3>
                </div>
                <button onClick={() => setShowSelector(false)}
                  className="grid place-items-center h-8 w-8 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Закрыть"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Player cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                {players.map((p, i) => {
                  const isActive = !manualMode && i === activePlayerIndex
                  const isKodik = p.name === 'Kodik'
                  return (
                    <button key={p.id} onClick={() => switchToPlayer(i)}
                      className="p-3 rounded-2xl text-left transition-all active:scale-95 relative"
                      style={{
                        background: isActive
                          ? 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))'
                          : isKodik
                            ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(34,197,94,0.04))'
                            : 'rgba(255,255,255,0.05)',
                        border: isActive
                          ? '1px solid rgba(139,92,246,0.5)'
                          : isKodik
                            ? '1px solid rgba(16,185,129,0.3)'
                            : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {isKodik && !isActive && (
                        <div
                          className="absolute top-1.5 right-1.5 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded text-emerald-300"
                          style={{ background: 'rgba(16,185,129,0.15)' }}
                        >
                          ★ Rec
                        </div>
                      )}
                      <div className="text-sm font-bold text-white truncate mb-1 flex items-center gap-1.5">
                        {isKodik && <span className="text-emerald-400">🎬</span>}
                        {p.name}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {p.quality && p.quality !== 'auto' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded text-white/70" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            {p.quality}
                          </span>
                        )}
                        {p.translation && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded text-white/70 truncate max-w-[80px]" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            {p.translation}
                          </span>
                        )}
                      </div>
                      {isActive && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-indigo-300">
                          <CheckCircle2 className="h-3 w-3" /> Активен
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Manual URL */}
              <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Link2 className="h-4 w-4 text-indigo-400" />
                  <span className="text-xs font-semibold text-white">Своя ссылка на видео</span>
                </div>
                <p className="text-[10px] text-white/50 mb-2">
                  Поддерживаются: m3u8 (HLS), mpd (DASH), mp4, webm и страницы плееров
                </p>
                <div className="flex gap-2">
                  <input type="url" value={manualUrlInput}
                    onChange={(e) => setManualUrlInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyManualUrl() }}
                    placeholder="https://example.com/video.m3u8"
                    className="flex-1 px-3 py-2 rounded-xl text-xs text-white placeholder-white/40 outline-none"
                    style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                  <button onClick={applyManualUrl}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white active:scale-95 transition-transform"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    Запустить
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
