'use client'

// ============================================================================
// VideosList — список видео из чата.
// ----------------------------------------------------------------------------
// Возможности:
//   • Карточки с превью + длительность
//   • Click открывает полноэкранный видеоплеер
//   • Контролы: play/pause, seek, volume, fullscreen, speed
// ============================================================================

import { useState, useRef, memo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Video as VideoIcon, X, Play, Maximize2, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatDuration, formatTime } from '@/lib/format'
import type { VideoItem } from '../hooks/use-chat-attachments'

interface VideosListProps {
  videos: VideoItem[]
  onScrollToMessage?: (id: string) => void
}

const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2]

export function VideosList({ videos, onScrollToMessage }: VideosListProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4 bg-foreground/5">
          <VideoIcon className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold mb-1">Видео пока нет</div>
        <div className="text-sm text-muted-foreground">
          Отправленные видеоролики появятся здесь
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="px-3 py-3 grid grid-cols-2 gap-2">
        {videos.map((video, idx) => (
          <VideoThumb
            key={video.id}
            video={video}
            onClick={() => setActiveIdx(idx)}
          />
        ))}
      </div>

      <AnimatePresence>
        {activeIdx !== null && (
          <VideoPlayer
            video={videos[activeIdx]}
            onClose={() => setActiveIdx(null)}
            onScrollToMessage={onScrollToMessage}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ---- Thumbnail ----

interface VideoThumbProps {
  video: VideoItem
  onClick: () => void
}

const VideoThumb = memo(function VideoThumb({ video, onClick }: VideoThumbProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  return (
    <button
      onClick={onClick}
      className="relative aspect-video rounded-xl overflow-hidden bg-black group active:scale-95 transition-transform"
    >
      <video
        ref={videoRef}
        src={assetUrl(video.url)}
        preload="metadata"
        muted
        playsInline
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-0 grid place-items-center bg-black/20 group-hover:bg-black/30 transition-colors">
        <div
          className="h-10 w-10 rounded-full grid place-items-center"
          style={{ background: 'var(--gradient-brand)', border: '1px solid rgba(255,255,255,0.18)' }}
        >
          <Play className="h-4 w-4 ml-0.5 text-white" fill="currentColor" />
        </div>
      </div>
      {video.duration && (
        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-mono tabular-nums">
          {formatDuration(video.duration)}
        </div>
      )}
      <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] truncate max-w-[80%]">
        {video.senderName}
      </div>
    </button>
  )
})

// ---- Full video player ----

interface VideoPlayerProps {
  video: VideoItem
  onClose: () => void
  onScrollToMessage?: (id: string) => void
}

function VideoPlayer({ video, onClose, onScrollToMessage }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [speed, setSpeed] = useState(1)
  const [showSpeed, setShowSpeed] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleFullscreen = () => {
    const el = videoRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen?.()
    }
  }

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(speed)
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]
    setSpeed(next)
    if (videoRef.current) videoRef.current.playbackRate = next
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] bg-black grid place-items-center"
    >
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-3" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-white text-sm">
          <div className="font-medium">{video.senderName}</div>
          <div className="text-xs text-white/60">{formatTime(video.createdAt)}</div>
        </div>
        {onScrollToMessage && (
          <button
            onClick={() => { onScrollToMessage(video.messageId); onClose() }}
            className="px-3 py-1.5 rounded-full text-[12px] font-medium bg-white/10 hover:bg-white/20 text-white"
          >
            К сообщению
          </button>
        )}
      </div>

      <video
        ref={videoRef}
        src={assetUrl(video.url)}
        controls
        autoPlay
        playsInline
        className="max-w-[95vw] max-h-[85vh] rounded-lg"
        style={{ background: 'black' }}
      />

      {/* Custom controls overlay (speed + fullscreen) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setShowSpeed((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full glass border border-white/20 text-white text-[12px] font-medium"
            aria-label="Скорость воспроизведения"
          >
            <Gauge className="h-4 w-4" />
            {speed}×
          </button>
          <AnimatePresence>
            {showSpeed && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSpeed(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 rounded-xl glass-strong border border-white/20 shadow-xl py-1 min-w-[100px]"
                >
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setSpeed(s)
                        if (videoRef.current) videoRef.current.playbackRate = s
                        setShowSpeed(false)
                      }}
                      className={cn(
                        'w-full text-center px-3 py-1.5 text-sm transition-colors hover:bg-white/10',
                        s === speed ? 'text-primary font-medium' : 'text-white',
                      )}
                    >
                      {s}×
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
        <button
          onClick={toggleFullscreen}
          className="h-10 w-10 rounded-full grid place-items-center glass border border-white/20 text-white"
          aria-label="Полный экран"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  )
}
