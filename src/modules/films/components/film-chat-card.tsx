'use client'

// ============================================================================
// Video Hub — Film Chat Card (v22)
// ----------------------------------------------------------------------------
// Inline карточка фильма в чате.
// При клике диспатчит событие '999pro:open-film' (точно как товар
// диспатчит '999pro:open-product'). page.tsx слушает событие и
// открывает FilmBottomSheet как overlay поверх чата.
// v18.12: admin-only — non-admins see a toast on click instead of the player.
// ============================================================================

import { motion } from 'framer-motion'
import { Play, Calendar, Star, Clock, Tv, Film as FilmIcon, Lock } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'
import type { FilmChatCardData } from '../types'

interface FilmChatCardProps {
  payload: FilmChatCardData
  isOwn?: boolean
}

function fmtDur(sec: number | null | undefined) {
  if (!sec) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h} ч ${m} мин`
  return `${m} мин`
}

export function FilmChatCard({ payload, isOwn }: FilmChatCardProps) {
  // v18.12: Video Hub is admin-only. Non-admins see a toast on click.
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'admin'
  const handleClick = () => {
    if (!isAdmin) {
      toast.info('Video Hub скоро будет доступен. Раздел в разработке.')
      return
    }
    // Dispatch event — page.tsx catches it and opens FilmBottomSheet as overlay.
    // Same mechanic as product cards (999pro:open-product).
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('999pro:open-film', { detail: { payload } })
      )
    }
  }

  return (
    <motion.div
      whileTap={{ scale: 0.985 }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      className="cursor-pointer rounded-2xl overflow-hidden w-[290px] max-w-full transition-transform hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      style={{
        background: 'rgba(15,15,30,0.9)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 6px 24px -4px rgba(0,0,0,0.5)',
      }}
    >
      {/* Poster area */}
      <div className="relative h-[150px] overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}
      >
        {payload.posterUrl ? (
          <img
            src={payload.posterUrl}
            alt={payload.title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-white/30">
            <FilmIcon className="h-10 w-10" />
          </div>
        )}
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.3) 50%, rgba(15,15,30,0.98) 100%)' }}
        />
        {/* Video Hub brand icon — top left */}
        <div className="absolute top-2 left-2 grid place-items-center h-6 w-6 rounded-lg"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
            boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
          }}
        >
          <FilmIcon className="h-3.5 w-3.5 text-white" />
        </div>
        {/* Type chip — top right */}
        <div className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider text-white"
          style={{ background: payload.isSeries ? 'rgba(139,92,246,0.85)' : 'rgba(99,102,241,0.85)' }}
        >
          {payload.isSeries ? <Tv className="h-2.5 w-2.5" /> : <FilmIcon className="h-2.5 w-2.5" />}
          {payload.isSeries ? 'Сериал' : 'Фильм'}
        </div>
        {/* Play button — center */}
        <motion.div
          whileHover={{ scale: 1.1 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center h-12 w-12 rounded-full"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
            boxShadow: '0 6px 24px rgba(99,102,241,0.6)',
            border: '2px solid rgba(255,255,255,0.25)',
          }}
        >
          <Play className="h-5 w-5 text-white ml-0.5" fill="currentColor" />
        </motion.div>
        {/* Title at bottom */}
        <div className="absolute bottom-2 left-3 right-3">
          <div className="text-sm font-bold text-white truncate leading-tight">{payload.title}</div>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Meta row: year, rating, duration */}
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/60">
          {payload.year && (
            <span className="inline-flex items-center gap-0.5">
              <Calendar className="h-2.5 w-2.5" /> {payload.year}
            </span>
          )}
          {payload.duration && (
            <span className="inline-flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" /> {fmtDur(payload.duration)}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <Star className="h-2.5 w-2.5 text-amber-400" /> TRI999
          </span>
        </div>

        {payload.description && (
          <p className="text-[11px] text-white/55 leading-snug line-clamp-2">{payload.description}</p>
        )}

        {/* CTA button */}
        <div
          className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
        >
          <Play className="h-3 w-3" fill="currentColor" />
          Смотреть в Video Hub
        </div>
      </div>
    </motion.div>
  )
}
