'use client'

// ============================================================================
// Video Hub — Film Poster Card (v18) — вертикальная карточка для каталога
// ----------------------------------------------------------------------------
// Соотношение сторон 2:3 (как киноафиша). Постер занимает всю карточку,
// снизу градиент с названием. Сверху — бейджи источника и "Сериал".
// ============================================================================

import { motion } from 'framer-motion'
import { Play, Tv, Film as FilmIcon } from 'lucide-react'
import type { Film } from '../types'

interface FilmPosterCardProps {
  film: Film
  onPlay: (film: Film) => void
  /** Compact = ~110px wide (для горизонтальной ленты на мобильных).
   *  Default = ~140px wide (для grid на десктопе). */
  compact?: boolean
}

const SOURCE_BADGES: Record<string, { bg: string; label: string }> = {
  lordser:  { bg: 'linear-gradient(135deg, #6366f1, #8b5cf6)', label: 'A' },
  lordbz:   { bg: 'linear-gradient(135deg, #ec4899, #f43f5e)', label: 'B' },
  turkru:   { bg: 'linear-gradient(135deg, #14b8a6, #06b6d4)', label: '🇹🇷' },
  tvturkru: { bg: 'linear-gradient(135deg, #f59e0b, #ef4444)', label: '🇹🇷2' },
}

export function FilmPosterCard({ film, onPlay, compact }: FilmPosterCardProps) {
  const badge = SOURCE_BADGES[film.sourceId] || null
  const width = compact ? 'w-[110px]' : 'w-[140px]'

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -2 }}
      onClick={() => onPlay(film)}
      className={`group ${width} shrink-0 text-left`}
    >
      {/* Poster 2:3 */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{
          aspectRatio: '2 / 3',
          background: 'rgba(0,0,0,0.5)',
          boxShadow: '0 4px 16px -4px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
        }}
      >
        {film.posterUrl ? (
          <img
            src={film.posterUrl}
            alt={film.title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              const img = e.target as HTMLImageElement
              img.style.opacity = '0'
              const parent = img.parentElement
              if (parent && !parent.querySelector('.poster-fallback')) {
                const fb = document.createElement('div')
                fb.className = 'poster-fallback absolute inset-0 grid place-items-center'
                fb.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>'
                parent.appendChild(fb)
              }
            }}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <FilmIcon className="h-8 w-8 text-white/30" />
          </div>
        )}

        {/* Gradient overlay with title */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.85) 100%)',
          }}
        />

        {/* Top-left: source badge */}
        {badge && (
          <div
            className="absolute top-1.5 left-1.5 grid place-items-center h-5 min-w-5 px-1.5 rounded-md text-[10px] font-bold text-white"
            style={{ background: badge.bg, boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }}
          >
            {badge.label}
          </div>
        )}

        {/* Top-right: series badge */}
        {film.isSeries && (
          <div
            className="absolute top-1.5 right-1.5 grid place-items-center h-5 px-1.5 rounded-md text-[9px] font-bold uppercase text-white"
            style={{ background: 'rgba(139,92,246,0.85)', backdropFilter: 'blur(6px)' }}
          >
            <Tv className="h-2.5 w-2.5 inline -mt-0.5 mr-0.5" />
            Сериал
          </div>
        )}

        {/* Hover play button */}
        <div
          className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          <div
            className="grid place-items-center h-10 w-10 rounded-full"
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              boxShadow: '0 4px 18px rgba(99,102,241,0.6)',
            }}
          >
            <Play className="h-4 w-4 text-white ml-0.5" fill="currentColor" />
          </div>
        </div>

        {/* Bottom: title + year */}
        <div className="absolute left-0 right-0 bottom-0 p-2 pointer-events-none">
          <div
            className="text-white font-semibold leading-tight line-clamp-2"
            style={{ fontSize: compact ? '11px' : '12px' }}
          >
            {film.title}
          </div>
          {film.year && (
            <div className="text-white/60 text-[10px] mt-0.5">{film.year}</div>
          )}
        </div>
      </div>
    </motion.button>
  )
}
