'use client'

import { useEffect, useState } from 'react'
import { api, assetUrl } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Video, VideoOff, RefreshCw,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { initials, formatTime, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

// ============================================================================
// CallHistory — recent calls list for a conversation.
// ----------------------------------------------------------------------------
// Shown in the chat view as a collapsible panel above the messages list.
// Each entry shows: peer avatar, direction (in/out/missed), type (audio/video),
// duration (or 'missed'), timestamp. Tap to call back.
//
// Reads from GET /api/calls/history?conversationId=...
// ============================================================================

interface CallEntry {
  id: string
  conversationId: string
  type: 'audio' | 'video'
  status: 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended' | 'cancelled'
  duration: number | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  direction: 'incoming' | 'outgoing'
  peer: {
    id: string
    username: string
    displayName: string | null
    avatar: string | null
  }
}

interface CallHistoryProps {
  conversationId: string
  onCallBack: (peerId: string, type: 'audio' | 'video') => void
  onClose: () => void
}

export function CallHistory({ conversationId, onCallBack, onClose }: CallHistoryProps) {
  const [entries, setEntries] = useState<CallEntry[]>([])
  const [loading, setLoading] = useState(true)
  const token = useAuthStore((s) => s.token)

  // FIX (Phase 1.3): extract fetch into a reusable function so the
  // "Обновить" button can trigger a refresh. Previously the button had
  // no onClick handler — clicking it did nothing.
  const fetchHistory = async () => {
    setLoading(true)
    try {
      const d = await api.get<{ items: CallEntry[] }>('/api/calls/history', {
        query: { conversationId, limit: 20 },
        auth: true,
      })
      setEntries(d.items || [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const d = await api.get<{ items: CallEntry[] }>('/api/calls/history', {
          query: { conversationId, limit: 20 },
          auth: true,
        })
        if (alive) setEntries(d.items || [])
      } catch {
        if (alive) setEntries([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [conversationId, token])

  return (
    <motion.div
      // v10-perf: animate opacity + y only (no height) for 60fps.
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className="border-b border-border/40 glass overflow-hidden"
      style={{ willChange: 'transform, opacity' }}
    >
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Недавние звонки</span>
          {entries.length > 0 && (
            <span className="text-xs text-muted-foreground">({entries.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchHistory}
            disabled={loading}
            className="p-1.5 rounded-full hover:bg-accent transition-colors disabled:opacity-50"
            aria-label="Обновить"
            title="Обновить"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', loading && 'animate-spin')} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-accent transition-colors"
            aria-label="Закрыть"
            title="Закрыть"
          >
            <span className="text-muted-foreground text-lg leading-none">×</span>
          </button>
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto scrollbar-premium pb-2">
        {loading ? (
          <div className="px-4 py-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 rounded bg-muted" />
                  <div className="h-2 w-1/4 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Звонков ещё не было
          </div>
        ) : (
          <div className="space-y-0.5">
            {entries.map((c) => {
              const isMissed = c.status === 'missed'
              const isRejected = c.status === 'rejected'
              const isCancelled = c.status === 'cancelled'
              const isIncoming = c.direction === 'incoming'
              const isVideo = c.type === 'video'

              // Icon + color based on call outcome
              let Icon = isIncoming ? PhoneIncoming : PhoneOutgoing
              let color = 'text-muted-foreground'
              if (isMissed) {
                Icon = PhoneMissed
                color = 'text-red-500'
              } else if (isRejected || isCancelled) {
                color = 'text-amber-500'
              } else if (c.status === 'accepted' || c.status === 'ended') {
                color = 'text-emerald-500'
              }

              const peerName = c.peer.displayName || c.peer.username || 'Пользователь'
              const timeLabel = formatTime(c.createdAt)

              let statusLabel = ''
              if (isMissed) statusLabel = 'Пропущенный'
              else if (isRejected) statusLabel = 'Отклонён'
              else if (isCancelled) statusLabel = 'Отменён'
              else if (c.duration !== null) statusLabel = formatDuration(c.duration)
              else statusLabel = '—'

              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-accent/40 transition-colors group"
                >
                  {/* Direction + type icon */}
                  <div className="relative shrink-0">
                    <Icon className={`h-4 w-4 ${color}`} />
                    {isVideo && (
                      <Video className="absolute -bottom-1 -right-1 h-3 w-3 bg-background rounded-full p-0.5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Peer avatar */}
                  <div className="h-8 w-8 rounded-full overflow-hidden bg-muted shrink-0">
                    {c.peer.avatar ? (
                      <img
                        src={assetUrl(c.peer.avatar)}
                        alt={peerName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full gradient-brand grid place-items-center text-white text-xs font-bold">
                        {initials(peerName)}
                      </div>
                    )}
                  </div>

                  {/* Name + status */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{peerName}</div>
                    <div className={`text-xs ${isMissed ? 'text-red-500' : 'text-muted-foreground'}`}>
                      {isIncoming ? 'Входящий' : 'Исходящий'} · {statusLabel}
                    </div>
                  </div>

                  {/* Time */}
                  <div className="text-xs text-muted-foreground shrink-0">{timeLabel}</div>

                  {/* Callback button — appears on hover */}
                  <button
                    onClick={() => onCallBack(c.peer.id, c.type)}
                    className="shrink-0 h-8 w-8 rounded-full bg-primary/10 hover:bg-primary/20 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Перезвонить (${isVideo ? 'видео' : 'аудио'})`}
                    title={`Перезвонить (${isVideo ? 'видео' : 'аудио'})`}
                  >
                    {isVideo ? (
                      <Video className="h-4 w-4 text-primary" />
                    ) : (
                      <Phone className="h-4 w-4 text-primary" />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </motion.div>
  )
}
