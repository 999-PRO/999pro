'use client'

// ============================================================================
// Video Hub — Film Card (v17.1) — search result list item
// ============================================================================

import { motion } from 'framer-motion'
import { Play, Calendar, Star, Tv, Film as FilmIcon, Heart } from 'lucide-react'
import type { Film } from '../types'
import { useFilmsStore } from '../store'

interface FilmCardProps {
  film: Film
  onPlay: (film: Film) => void
  compact?: boolean
}

export function FilmCard({ film, onPlay, compact }: FilmCardProps) {
  const isFavorite = useFilmsStore((s) => s.favorites.some((f) => f.id === film.id))

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.985 }}
      onClick={() => onPlay(film)}
      className="group flex gap-3 p-2.5 w-full text-left rounded-2xl transition-colors"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Poster */}
      <div
        className={`shrink-0 ${compact ? 'w-16 h-24' : 'w-20 h-28'} rounded-lg overflow-hidden relative grid place-items-center`}
        style={{ background: 'rgba(0,0,0,0.4)' }}
      >
        {film.posterUrl ? (
          <img
            src={film.posterUrl}
            alt={film.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <FilmIcon className="h-6 w-6 text-white/30" />
        )}
        <div
          className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.4)' }}
        >
          <div className="grid place-items-center h-9 w-9 rounded-full"
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              boxShadow: '0 4px 16px rgba(99,102,241,0.5)',
            }}
          >
            <Play className="h-4 w-4 text-white ml-0.5" fill="currentColor" />
          </div>
        </div>
        {film.isSeries && (
          <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded-md text-[8px] font-bold uppercase text-white"
            style={{ background: 'rgba(139,92,246,0.85)' }}
          >
            <Tv className="h-2.5 w-2.5 inline -mt-0.5" /> Сериал
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 py-0.5 flex flex-col">
        <div className="text-sm font-semibold text-white truncate leading-tight">{film.title}</div>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-white/60">
          {film.year && (
            <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" /> {film.year}</span>
          )}
          {film.sourceName && (
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {film.sourceName}
            </span>
          )}
        </div>
        {film.description && !compact && (
          <div className="text-xs text-white/55 mt-1.5 line-clamp-2 leading-snug">{film.description}</div>
        )}
        <div className="flex-1" />
        {isFavorite && (
          <div className="inline-flex items-center gap-1 text-[10px] text-pink-400 mt-1">
            <Heart className="h-2.5 w-2.5" fill="currentColor" /> В избранном
          </div>
        )}
      </div>
    </motion.button>
  )
}
