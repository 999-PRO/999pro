'use client'

// ============================================================================
// Video Hub — Browse Catalog (v18) — каталог фильмов без поиска
// ----------------------------------------------------------------------------
// Показывает 4 категории (Новинки, Зарубежные, Турецкие, Мультсериалы).
// Каждая категория — горизонтальная лента постеров 2:3 с пагинацией по hover.
// На десктопе — grid; на мобильных — horizontal scroll snap.
// ============================================================================

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Film as FilmIcon, AlertCircle, RotateCcw } from 'lucide-react'
import type { Film, BrowseCategory } from '../types'
import { browseCatalog } from '../api'
import { FilmPosterCard } from './film-poster-card'

interface BrowseCatalogProps {
  onPlayFilm: (film: Film) => void
}

export function BrowseCatalog({ onPlayFilm }: BrowseCatalogProps) {
  const [categories, setCategories] = useState<BrowseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    browseCatalog()
      .then((res) => {
        if (cancelled) return
        if (res.categories && res.categories.length > 0) {
          setCategories(res.categories)
        } else {
          setError('Каталог недоступен')
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || 'Не удалось загрузить каталог')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="grid place-items-center py-16 px-6">
        <Loader2 className="h-8 w-8 text-white/60 animate-spin mb-3" />
        <p className="text-xs text-white/50">Загружаем каталог…</p>
        <p className="text-[10px] text-white/35 mt-1">Первый запрос может занять до 30 секунд</p>
      </div>
    )
  }

  // ---- Error state ----
  if (error) {
    return (
      <div className="text-center py-12 px-6">
        <AlertCircle className="h-8 w-8 text-white/40 mx-auto mb-2" />
        <p className="text-sm text-white/70 mb-3">{error}</p>
        <button
          onClick={() => {
            setLoading(true)
            setError(null)
            browseCatalog()
              .then((res) => { if (res.categories) setCategories(res.categories) })
              .catch((e) => setError(e?.message || 'Ошибка'))
              .finally(() => setLoading(false))
          }}
          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium inline-flex items-center gap-2"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Повторить
        </button>
      </div>
    )
  }

  // ---- Empty state ----
  if (categories.length === 0) {
    return (
      <div className="text-center py-12 px-6">
        <FilmIcon className="h-8 w-8 text-white/40 mx-auto mb-2" />
        <p className="text-sm text-white/60">Каталог пуст</p>
      </div>
    )
  }

  // ---- Catalog with categories ----
  return (
    <div className="space-y-5 pb-4">
      {categories.map((cat, catIdx) => (
        <motion.div
          key={cat.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: catIdx * 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Category header */}
          <div className="flex items-center gap-2 px-1 pb-2.5">
            <span className="text-base">{cat.emoji}</span>
            <h3 className="text-sm font-bold text-white">{cat.title}</h3>
            <span className="text-[10px] text-white/40 font-medium ml-1">
              {cat.films.length}
            </span>
          </div>

          {/* Horizontal scroll of posters (mobile-first) */}
          <div
            data-scroll-lock-ignore
            className="flex gap-2.5 px-1 pb-1 overflow-x-auto custom-scroll no-scrollbar"
            style={{
              scrollSnapType: 'x proximity',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
            }}
          >
            {cat.films.map((film) => (
              <div
                key={film.id}
                style={{ scrollSnapAlign: 'start' }}
              >
                <FilmPosterCard film={film} onPlay={onPlayFilm} compact />
              </div>
            ))}
          </div>
        </motion.div>
      ))}

      {/* Footer hint */}
      <div className="text-center pt-3 pb-2">
        <p className="text-[10px] text-white/35">
          🎬 Каталог обновляется каждые 30 минут · 4 источника
        </p>
      </div>
    </div>
  )
}
