'use client'

// ============================================================================
// VideoMiniPlayer — единственный плеер для PiP режима (v25)
// ----------------------------------------------------------------------------
// v25: Один <video> элемент. PiP = маленький размер. Expand = полный экран.
// НЕ создаёт второй плеер. НЕ пересоздаёт поток. Просто меняет размер.
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, Minimize2, Play, Pause, GripVertical, Volume2, VolumeX, SkipBack, SkipForward, Settings } from 'lucide-react'
import { useVideoPipStore } from './video-pip-store'

const PIP_WIDTH = 260
const PIP_HEIGHT = 146
const PIP_MARGIN = 12

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

export function VideoMiniPlayer() {
  const pip = useVideoPipStore((s) => s.pip)
  const isExpanded = useVideoPipStore((s) => s.isExpanded)
  const clearPip = useVideoPipStore((s) => s.clearPip)
  const setExpanded = useVideoPipStore((s) => s.setExpanded)

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [showControls, setShowControls] = useState(true)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Dragging
  const [dragPos, setDragPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 })
  const controlsTimerRef = useRef<number | null>(null)

  // ---- Initialize position ----
  useEffect(() => {
    if (!pip || hasInitialized) return
    setDragPos({
      left: window.innerWidth - PIP_WIDTH - PIP_MARGIN,
      top: window.innerHeight - PIP_HEIGHT - PIP_MARGIN - 80,
    })
    setHasInitialized(true)
  }, [pip, hasInitialized])

  useEffect(() => {
    if (!pip) {
      setHasInitialized(false)
      setIsPlaying(false)
      setCurrentTime(0)
    }
  }, [pip])

  // ---- Setup video (ONCE per streamUrl) ----
  useEffect(() => {
    if (!pip || !videoRef.current) return
    const v = videoRef.current

    const setupVideo = async () => {
      if (!pip.streamUrl) return
      const lower = pip.streamUrl.toLowerCase()
      if (lower.includes('.m3u8')) {
        if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = pip.streamUrl
        } else {
          try {
            const mod = await import('hls.js')
            const Hls = mod.default
            if (Hls.isSupported()) {
              const hls = new Hls({ enableWorker: true, xhrSetup: (xhr) => { xhr.withCredentials = false } })
              hlsRef.current = hls
              hls.loadSource(pip.streamUrl)
              hls.attachMedia(v)
            }
          } catch {}
        }
      } else {
        v.src = pip.streamUrl
      }
      v.addEventListener('loadedmetadata', () => {
        if (pip.position > 0 && v.duration > pip.position) v.currentTime = pip.position
        v.play().then(() => setIsPlaying(true)).catch(() => {})
      }, { once: true })
    }
    setupVideo()

    return () => {
      try { v.pause() } catch {}
      try { v.removeAttribute('src') } catch {}
      try { v.load() } catch {}
      if (hlsRef.current) { try { hlsRef.current.destroy() } catch {}; hlsRef.current = null }
    }
  }, [pip?.streamUrl])

  // ---- Video event listeners ----
  useEffect(() => {
    const v = videoRef.current
    if (!v || !pip) return
    const onTime = () => { setCurrentTime(v.currentTime); if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1)) }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onDur = () => setDuration(v.duration || 0)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('durationchange', onDur)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('durationchange', onDur)
    }
  }, [pip])

  // ---- Fullscreen detection ----
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ---- Auto-hide controls in expanded mode ----
  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = window.setTimeout(() => {
      if (isPlaying && !showSpeedMenu) setShowControls(false)
    }, 3500)
  }, [isPlaying, showSpeedMenu])

  useEffect(() => {
    if (isExpanded && isPlaying) scheduleHideControls()
    else setShowControls(true)
  }, [isExpanded, isPlaying, scheduleHideControls])

  // ---- Dragging ----
  const handleDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (isExpanded) return
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.closest('button')) return
    const touch = 'touches' in e ? e.touches[0] : e
    dragStartRef.current = { x: touch.clientX, y: touch.clientY, left: dragPos.left, top: dragPos.top }
    setIsDragging(true)
  }, [dragPos, isExpanded])

  const handleDragMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return
    e.preventDefault()
    const touch = 'touches' in e ? e.touches[0] : e
    setDragPos({
      left: Math.max(0, Math.min(window.innerWidth - PIP_WIDTH, dragStartRef.current.left + (touch.clientX - dragStartRef.current.x))),
      top: Math.max(0, Math.min(window.innerHeight - PIP_HEIGHT, dragStartRef.current.top + (touch.clientY - dragStartRef.current.y))),
    })
  }, [isDragging])

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)
    const centerX = dragPos.left + PIP_WIDTH / 2
    setDragPos((prev) => ({ ...prev, left: centerX < window.innerWidth / 2 ? PIP_MARGIN : window.innerWidth - PIP_WIDTH - PIP_MARGIN }))
  }, [isDragging, dragPos])

  // ---- Actions ----
  const togglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const v = videoRef.current; if (!v) return
    if (v.paused) v.play().then(() => setIsPlaying(true)).catch(() => {})
    else { v.pause(); setIsPlaying(false) }
    setShowControls(true); scheduleHideControls()
  }

  const seekBy = (delta: number) => {
    const v = videoRef.current; if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }

  const seekTo = (t: number) => {
    const v = videoRef.current; if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t))
  }

  const toggleMute = () => {
    const v = videoRef.current; if (!v) return
    v.muted = !v.muted; setMuted(v.muted)
  }

  const changeSpeed = (s: number) => {
    const v = videoRef.current; if (!v) return
    v.playbackRate = s; setSpeed(s); setShowSpeedMenu(false)
  }

  const handleClose = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const v = videoRef.current
    if (v) { try { v.pause() } catch {}; try { v.muted = true } catch {}; try { v.removeAttribute('src') } catch {}; try { v.load() } catch {} }
    if (hlsRef.current) { try { hlsRef.current.destroy() } catch {}; hlsRef.current = null }
    setIsPlaying(false); clearPip()
  }

  const handleExpand = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setExpanded(true)
  }

  const handleCollapse = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setExpanded(false)
  }

  const toggleFullscreen = async () => {
    const el = videoRef.current?.parentElement
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else el.requestFullscreen?.().catch(() => {})
  }

  if (!pip) return null

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0

  const fmtTime = (sec: number) => {
    if (!sec || !isFinite(sec)) return '0:00'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
  }

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{
        scale: 1, opacity: 1,
        ...(isExpanded
          ? { left: 0, top: 0, width: '100vw', height: '100vh', borderRadius: 0 }
          : { left: dragPos.left, top: dragPos.top, width: PIP_WIDTH, height: PIP_HEIGHT, borderRadius: 16 }
        ),
      }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{
        scale: { type: 'spring', stiffness: 360, damping: 30 },
        opacity: { duration: 0.2 },
        default: { type: 'spring', stiffness: 320, damping: 32 },
        ...(isDragging && !isExpanded ? { left: { duration: 0 }, top: { duration: 0 } } : {}),
      }}
      className="fixed z-[200] overflow-hidden"
      style={{
        background: '#000',
        boxShadow: isExpanded ? 'none' : '0 8px 32px -4px rgba(0,0,0,0.5), 0 0 0 1px rgba(139,92,246,0.2)',
        cursor: isExpanded ? 'default' : (isDragging ? 'grabbing' : 'grab'),
        touchAction: isExpanded ? 'auto' : 'none',
      }}
      onTouchStart={handleDragStart} onTouchMove={handleDragMove} onTouchEnd={handleDragEnd}
      onMouseDown={handleDragStart} onMouseMove={isDragging ? handleDragMove : undefined}
      onMouseUp={handleDragEnd} onMouseLeave={isDragging ? handleDragEnd : undefined}
      onMouseMoveCapture={isExpanded ? () => { setShowControls(true); scheduleHideControls() } : undefined}
    >
      {/* The SINGLE video element — never recreated */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        poster={pip.posterUrl || undefined}
        onClick={(e) => { e.stopPropagation(); if (isExpanded) togglePlay() }}
        style={{ cursor: isExpanded ? (showControls ? 'default' : 'none') : 'pointer' }}
      />

      {/* ---- MINI MODE controls ---- */}
      {!isExpanded && (
        <>
          <div className="absolute top-0 left-0 right-0 h-6 flex items-center justify-center pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}>
            <GripVertical className="h-3.5 w-3.5 text-white/50" />
          </div>
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-1.5 py-1"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }}>
            <button onClick={togglePlay} className="grid place-items-center h-7 w-7 rounded-full text-white hover:bg-white/20 transition-colors shrink-0">
              {isPlaying ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5 ml-0.5" fill="currentColor" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold text-white truncate">{pip.title}</div>
              {pip.subtitle && <div className="text-[9px] text-white/60 truncate">{pip.subtitle}</div>}
            </div>
            <button onClick={handleExpand} className="grid place-items-center h-7 w-7 rounded-full text-white hover:bg-white/20 transition-colors shrink-0">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={handleClose} className="grid place-items-center h-7 w-7 rounded-full text-white hover:bg-white/20 transition-colors shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}

      {/* ---- EXPANDED MODE controls ---- */}
      {isExpanded && (
        <AnimatePresence>
          {showControls && (
            <>
              {/* Top bar */}
              <motion.div
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)', padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 60px 12px 16px' }}
              >
                <div className="text-white font-semibold text-sm truncate">{pip.title}</div>
                {pip.subtitle && <div className="text-white/60 text-xs truncate mt-0.5">{pip.subtitle}</div>}
              </motion.div>

              {/* Close + Collapse */}
              <button onClick={handleCollapse} className="absolute right-3 z-20 grid place-items-center h-10 w-10 rounded-full text-white active:scale-90"
                style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)', background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.2)' }}>
                <Minimize2 className="h-5 w-5" />
              </button>

              {/* Center play button when paused */}
              {!isPlaying && (
                <motion.button initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                  onClick={togglePlay}
                  className="absolute inset-0 m-auto h-20 w-20 grid place-items-center pointer-events-auto z-10"
                  style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '9999px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                  <Play className="h-9 w-9 text-white ml-1" fill="currentColor" />
                </motion.button>
              )}

              {/* Bottom controls */}
              <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-0 left-0 right-0 z-10"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%)', padding: '20px 12px 10px' }}
              >
                {/* Progress bar */}
                <div className="group relative h-1.5 rounded-full bg-white/20 cursor-pointer mb-3 hover:h-2 transition-all"
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * duration) }}>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${progressPct}%`, background: 'linear-gradient(to right, #6366f1, #8b5cf6, #ec4899)' }} />
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-1 text-white">
                  <button onClick={togglePlay} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15">
                    {isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5 ml-0.5" fill="currentColor" />}
                  </button>
                  <button onClick={() => seekBy(-10)} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15"><SkipBack className="h-4 w-4" /></button>
                  <button onClick={() => seekBy(10)} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15"><SkipForward className="h-4 w-4" /></button>
                  <button onClick={toggleMute} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15">
                    {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <div className="text-xs font-medium tabular-nums ml-1">
                    <span className="text-white">{fmtTime(currentTime)}</span>
                    <span className="text-white/50 mx-1">/</span>
                    <span className="text-white/70">{fmtTime(duration)}</span>
                  </div>
                  <div className="flex-1" />
                  {/* Speed */}
                  <div className="relative">
                    <button onClick={() => setShowSpeedMenu(v => !v)} className="px-2.5 h-8 rounded-full hover:bg-white/15 text-[11px] font-semibold">{speed}×</button>
                    {showSpeedMenu && (
                      <div className="absolute bottom-full right-0 mb-2 rounded-xl overflow-hidden min-w-[130px]"
                        style={{ background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.15)' }}>
                        {SPEED_OPTIONS.map(s => (
                          <button key={s} onClick={() => changeSpeed(s)} className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/15 ${s === speed ? 'text-white font-bold bg-white/5' : 'text-white/80'}`}>{s}×{s === 1 ? ' (норм.)' : ''}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={toggleFullscreen} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15">
                    {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  )
}
