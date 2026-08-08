'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, StarHalf, X, Search, Loader2, PenLine, Trash2, MessageSquarePlus, SlidersHorizontal, ChevronLeft } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Product, Review } from '@/lib/types'
import { useAuthStore } from '@/lib/auth-store'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCompactNumber, timeAgo, initials } from '@/lib/format'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'

// ============================================================================
//  AllReviewsSheet — full-screen reviews modal opened from the product page's
//  "Показать все отзывы (N)" button. Provides:
//    • Search within reviews (title + content, server-side q param)
//    • Sort: Newest / Highest / Lowest
//    • Star filter: 1 / 2 / 3 / 4 / 5 (or "All") — uses server-side stars param
//    • Pagination via "Load more" (each page = 20 reviews)
//    • Photo lightbox per review (reused from product-reviews-inline)
//    • Edit / delete own review (delegates to parent via onReviewChanged)
//
//  Layout:
//    Mobile (default): bottom sheet, 92vh tall, slides up.
//    Desktop (md+):    centered modal, 720px wide, 85vh tall.
//
//  The inner scrollable area is marked with `data-scroll-lock-ignore` so
//  useScrollLock allows wheel/touch events inside it while blocking all
//  background scrolling.
// ============================================================================

interface Props {
  product: Product
  open: boolean
  onClose: () => void
  onReviewChanged?: () => void
}

type SortMode = 'newest' | 'highest' | 'lowest'

const PAGE_SIZE = 20

export function AllReviewsSheet({ product, open, onClose, onReviewChanged }: Props) {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sort, setSort] = useState<SortMode>('newest')
  const [starsFilter, setStarsFilter] = useState<number | null>(null) // null = all
  const [searchQ, setSearchQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [distribution, setDistribution] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  const [avgRating, setAvgRating] = useState(0)
  const [total, setTotal] = useState(0)
  const [myReview, setMyReview] = useState<Review | null>(null)
  const [showForm, setShowForm] = useState(false)
  // Phase 10: custom confirm dialog state
  const [deleteReviewId, setDeleteReviewId] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)

  useScrollLock(open)

  // Debounce search input — 300ms is the sweet spot for typing feel.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ), 300)
    return () => clearTimeout(t)
  }, [searchQ])

  const refresh = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get<{
        items: Review[]
        distribution: Record<number, number>
        avgRating: number
        total: number
      }>('/api/reviews', {
        query: {
          productId: product.id,
          sort,
          limit: PAGE_SIZE,
          offset: 0,
          ...(debouncedQ ? { q: debouncedQ } : {}),
          ...(starsFilter !== null ? { stars: starsFilter } : {}),
        },
      }),
      isAuthenticated
        ? api
            .get<{ review: Review | null }>('/api/reviews/mine', { query: { productId: product.id }, auth: true })
            .catch(() => ({ review: null }))
        : Promise.resolve({ review: null }),
    ])
      .then(([d, mine]) => {
        setReviews(d.items)
        setDistribution(d.distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
        setAvgRating(d.avgRating || 0)
        setTotal(d.total || 0)
        setMyReview(mine.review)
        setHasMore(d.items.length < (d.total || 0))
      })
      .catch(() => {
        setReviews([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }, [product.id, sort, starsFilter, debouncedQ, isAuthenticated])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  // Reset search/filter when reopening the sheet
  useEffect(() => {
    if (open) {
      setSort('newest')
      setStarsFilter(null)
      setSearchQ('')
      setDebouncedQ('')
    }
  }, [open])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const d = await api.get<{
        items: Review[]
        total: number
      }>('/api/reviews', {
        query: {
          productId: product.id,
          sort,
          limit: PAGE_SIZE,
          offset: reviews.length,
          ...(debouncedQ ? { q: debouncedQ } : {}),
          ...(starsFilter !== null ? { stars: starsFilter } : {}),
        },
      })
      setReviews((prev) => [...prev, ...d.items])
      setHasMore(reviews.length + d.items.length < (d.total || 0))
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false)
    }
  }, [product.id, sort, starsFilter, debouncedQ, reviews.length, loadingMore, hasMore])

  const handleDelete = async (id: string) => {
    // Phase 10: use custom confirm dialog
    setDeleteReviewId(id)
  }

  const confirmDeleteReview = async () => {
    const id = deleteReviewId
    if (!id) return
    setDeleteReviewId(null)
    try {
      await api.delete(`/api/reviews/${id}`, { auth: true })
      setMyReview(null)
      toast.success('Отзыв удалён')
      refresh()
      onReviewChanged?.()
    } catch {
      toast.error('Не удалось удалить отзыв')
    }
  }

  const handleSaved = (review: Review) => {
    setShowForm(false)
    setMyReview(review)
    toast.success(myReview ? 'Отзыв обновлён' : 'Спасибо за отзыв!')
    refresh()
    onReviewChanged?.()
  }

  const totalRatings = Object.values(distribution).reduce((a, b) => a + b, 0)
  // Filtered count = `total` from the server (which respects q + stars filter).
  const filteredCount = total

  // v25.6 (Task #8): render via portal to document.body so the sheet is
  // not constrained by any `backdrop-filter` / `transform` containing block
  // in the desktop ProductPageDesktop layout (GlassCard uses backdrop-blur).
  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            // v25.6 (Task #8): z-[10001] — above ProductPageDesktop (z-80)
            // and above the ReviewForm (z-10000) so the "all reviews" sheet
            // stacks correctly when opened from inside the form's parent.
            className="fixed inset-0 z-[10001] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet — bottom sheet on mobile, centered modal on desktop */}
          <motion.div
            initial={{ y: '100%', opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.5 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-0 md:inset-0 z-[10002] flex md:items-center md:justify-center pointer-events-none"
          >
            <div
              className="
                relative w-full bg-background rounded-t-[32px] md:rounded-[32px] shadow-2xl
                h-[92vh] md:h-[85vh] md:max-w-[720px]
                flex flex-col overflow-hidden pointer-events-auto
              "
            >
              {/* Drag handle (mobile only) */}
              <div className="md:hidden flex justify-center pt-3 pb-1 shrink-0">
                <div className="h-1.5 w-12 rounded-full bg-border" />
              </div>

              {/* Header — title + close + product summary */}
              <div className="shrink-0 px-4 md:px-6 pt-2 md:pt-4 pb-3 border-b border-border/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageSquarePlus className="h-5 w-5 shrink-0 text-primary" />
                    <h2 className="text-base md:text-lg font-bold truncate">
                      Все отзывы
                      {filteredCount > 0 && (
                        <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                          ({formatCompactNumber(filteredCount)})
                        </span>
                      )}
                    </h2>
                  </div>
                  <button
                    onClick={onClose}
                    className="h-9 w-9 rounded-full hover:bg-accent grid place-items-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    aria-label="Закрыть"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Product mini-card */}
                <div className="mt-2 flex items-center gap-2.5">
                  <div className="h-10 w-10 rounded-lg overflow-hidden bg-accent/20 shrink-0">
                    {product.images[0] && (
                      <img src={assetUrl(product.images[0])} alt={product.title} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{product.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StarRating value={avgRating} size="sm" />
                      <span className="text-[11px] text-muted-foreground">
                        {avgRating > 0 ? avgRating.toFixed(1) : '—'} · {totalRatings} оценок
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Toolbar — search + sort + star filter */}
              <div className="shrink-0 px-4 md:px-6 py-2.5 border-b border-border/40 space-y-2 bg-background/95">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Поиск по отзывам…"
                    className="w-full h-9 pl-9 pr-9 rounded-full bg-accent/40 text-sm outline-none focus:bg-accent/60 transition-colors placeholder:text-muted-foreground/70"
                  />
                  {searchQ && (
                    <button
                      onClick={() => setSearchQ('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full hover:bg-accent grid place-items-center text-muted-foreground"
                      aria-label="Очистить"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Sort + filter row */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {/* Sort pills */}
                  {([
                    { id: 'newest', label: 'Новые' },
                    { id: 'highest', label: 'Высокий' },
                    { id: 'lowest', label: 'Низкий' },
                  ] as const).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSort(t.id)}
                      className={cn(
                        'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                        sort === t.id
                          ? 'gradient-brand text-white shadow-glow'
                          : 'glass text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}

                  <div className="shrink-0 h-5 w-px bg-border/60 mx-1" />

                  {/* Star filter pills — "Все" + 5/4/3/2/1 */}
                  <button
                    onClick={() => setStarsFilter(null)}
                    className={cn(
                      'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1',
                      starsFilter === null
                        ? 'gradient-brand text-white shadow-glow'
                        : 'glass text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Все
                  </button>
                  {[5, 4, 3, 2, 1].map((s) => (
                    <button
                      key={s}
                      onClick={() => setStarsFilter(s === starsFilter ? null : s)}
                      className={cn(
                        'shrink-0 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1',
                        starsFilter === s
                          ? 'gradient-brand text-white shadow-glow'
                          : 'glass text-muted-foreground hover:text-foreground',
                      )}
                      disabled={distribution[s] === 0}
                    >
                      <Star className={cn('h-3 w-3', starsFilter === s ? 'fill-white' : 'fill-amber-400 text-amber-400')} />
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scrollable review list */}
              <div
                ref={scrollRef}
                data-scroll-lock-ignore
                className="flex-1 overflow-y-auto overscroll-contain px-4 md:px-6 py-3 space-y-2.5"
                style={{ overscrollBehavior: 'contain' } as any}
              >
                {/* Own review (highlighted, if exists) */}
                {myReview && (
                  <div className="glass rounded-2xl p-4 border-2 border-primary/30 mb-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary">ВАШ ОТЗЫВ</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setShowForm(true)}
                          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                        >
                          Изменить
                        </button>
                        <button
                          onClick={() => handleDelete(myReview.id)}
                          className="text-xs text-destructive hover:text-destructive px-2 py-1"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                    <ReviewCard review={myReview} isOwn />
                  </div>
                )}

                {/* CTA — leave review (if authed + no existing review) */}
                {isAuthenticated && !myReview && (
                  <Button
                    onClick={() => setShowForm(true)}
                    className="w-full rounded-2xl h-10 mb-2 gradient-brand text-white font-semibold"
                    size="sm"
                  >
                    <PenLine className="h-4 w-4 mr-1.5" /> Оставить отзыв
                  </Button>
                )}

                {/* Review list */}
                {loading ? (
                  <div className="space-y-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="glass rounded-2xl p-4 h-32 skeleton" />
                    ))}
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="text-3xl mb-2">⭐</div>
                    <p className="text-sm text-muted-foreground">
                      {debouncedQ || starsFilter !== null
                        ? 'Ничего не найдено. Попробуйте изменить фильтры.'
                        : isAuthenticated
                          ? 'Будьте первым, кто оставит отзыв на этот товар'
                          : 'Пока нет отзывов. Войдите, чтобы оставить первый.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <AnimatePresence mode="popLayout">
                      {reviews
                        .filter((r) => r.id !== myReview?.id)
                        .map((r) => (
                          <motion.div
                            key={r.id}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                          >
                            <ReviewCard review={r} />
                          </motion.div>
                        ))}
                    </AnimatePresence>

                    {/* Load more button (pagination) */}
                    {hasMore && (
                      <div className="pt-2 pb-1 flex justify-center">
                        <Button
                          onClick={loadMore}
                          disabled={loadingMore}
                          variant="outline"
                          size="sm"
                          className="rounded-full h-10 px-6"
                        >
                          {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : loadingMore ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          {loadingMore ? 'Загрузка…' : 'Показать ещё'}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Review form modal — delegates to ReviewForm from product-reviews-inline */}
              <AnimatePresence>
                {showForm && (
                  <ReviewForm
                    product={product}
                    existingReview={myReview}
                    onClose={() => setShowForm(false)}
                    onSaved={handleSaved}
                  />
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}

      {/* Phase 10: custom confirm dialog for delete */}
      <ConfirmDialog
        open={deleteReviewId !== null}
        title="Удалить ваш отзыв?"
        message="Это действие нельзя отменить."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={confirmDeleteReview}
        onCancel={() => setDeleteReviewId(null)}
      />
    </AnimatePresence>,
    document.body,
  )
}

// ============================================================================
//  StarRating — read-only star display (supports half stars).
// ============================================================================
function StarRating({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5'
  const stars = []
  for (let i = 1; i <= 5; i++) {
    if (value >= i) {
      stars.push(<Star key={i} className={cn(dims, 'fill-amber-400 text-amber-400')} />)
    } else if (value >= i - 0.5) {
      stars.push(<StarHalf key={i} className={cn(dims, 'fill-amber-400 text-amber-400')} />)
    } else {
      stars.push(<Star key={i} className={cn(dims, 'text-muted-foreground/40')} />)
    }
  }
  return <div className="flex items-center gap-0.5">{stars}</div>
}

// ============================================================================
//  ReviewCard — single review display.
//  NOTE: This is a local copy of the same component in product-reviews-inline.tsx
//  to avoid a circular import. They must be kept visually identical.
// ============================================================================
function ReviewCard({
  review,
  isOwn,
  onEdit,
  onDelete,
}: {
  review: Review
  isOwn?: boolean
  onEdit?: () => void
  onDelete?: () => void
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-start gap-3 mb-2">
        <Avatar className="h-9 w-9 shrink-0">
          {review.user?.avatar && <AvatarImage src={review.user.avatar} alt={review.user.username} />}
          <AvatarFallback className="gradient-brand text-white text-xs">
            {initials(review.user?.displayName || review.user?.username)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">
              {review.user?.displayName || review.user?.username || 'Аноним'}
            </span>
            {isOwn && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                ВЫ
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StarRating value={review.rating} size="sm" />
            <span className="text-xs text-muted-foreground">{timeAgo(new Date(review.createdAt))}</span>
          </div>
        </div>
        {isOwn && (
          <div className="flex gap-1 shrink-0">
            {onEdit && (
              <button
                onClick={onEdit}
                className="h-7 w-7 rounded-full hover:bg-accent grid place-items-center text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Изменить отзыв"
                title="Изменить отзыв"
              >
                <PenLine className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="h-7 w-7 rounded-full hover:bg-destructive/10 grid place-items-center text-muted-foreground hover:text-destructive transition-colors"
                aria-label="Удалить отзыв"
                title="Удалить отзыв"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {review.title && <div className="font-semibold text-sm mb-1">{review.title}</div>}
      {review.content && (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {review.content}
        </p>
      )}

      {review.photos.length > 0 && (
        <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
          {review.photos.map((url, i) => (
            <button
              key={i}
              onClick={() => setLightboxIndex(i)}
              className="h-20 w-20 rounded-xl overflow-hidden bg-accent/20 shrink-0 hover:opacity-80 transition-opacity"
            >
              <img src={assetUrl(url)} alt={`Фото ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={review.photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
//  PhotoLightbox — full-screen photo viewer (compact version).
// ============================================================================
function PhotoLightbox({
  photos,
  initialIndex,
  onClose,
}: {
  photos: string[]
  initialIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + photos.length) % photos.length)
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % photos.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photos.length, onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[10003] bg-black/95 backdrop-blur-md grid place-items-center"
      onClick={onClose}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute top-4 right-4 h-11 w-11 rounded-full bg-white/10 hover:bg-white/25 grid place-items-center text-white transition-colors z-10"
        aria-label="Закрыть"
      >
        <X className="h-5 w-5" />
      </button>
      {photos.length > 1 && (
        <div
          className="absolute top-5 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-medium backdrop-blur-sm z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {index + 1} / {photos.length}
        </div>
      )}
      <motion.img
        key={index}
        src={assetUrl(photos[index])}
        alt={`Фото ${index + 1}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
      {photos.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i - 1 + photos.length) % photos.length) }}
            className="absolute left-4 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/10 hover:bg-white/25 grid place-items-center text-white transition-colors z-10"
            aria-label="Предыдущее"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i + 1) % photos.length) }}
            className="absolute right-4 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/10 hover:bg-white/25 grid place-items-center text-white transition-colors z-10"
            aria-label="Следующее"
          >
            <ChevronLeft className="h-5 w-5 rotate-180" />
          </button>
        </>
      )}
    </motion.div>
  )
}

// ============================================================================
//  ReviewForm — modal form for creating/editing a review.
//  Compact version of the same form in product-reviews-inline.tsx.
// ============================================================================
function ReviewForm({
  product,
  existingReview,
  onClose,
  onSaved,
}: {
  product: Product
  existingReview: Review | null
  onClose: () => void
  onSaved: (review: Review) => void
}) {
  const [rating, setRating] = useState(existingReview?.rating || 0)
  const [hoverRating, setHoverRating] = useState(0)
  const [title, setTitle] = useState(existingReview?.title || '')
  const [content, setContent] = useState(existingReview?.content || '')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rating === 0) {
      toast.error('Поставьте оценку')
      return
    }
    setSubmitting(true)
    try {
      const body = { productId: product.id, rating, title: title.trim() || undefined, content: content.trim() || undefined }
      // v25.7 (TZ ЭТАП 2.3): the backend returns a FLAT Review object, NOT
      // `{ review: Review }`. The previous typing expected a wrapper, so
      // `result.review` was always undefined → onSaved(undefined) → the
      // user's "your review" highlight disappeared even though the save
      // succeeded. Fixed to read the flat shape (matches the other two
      // ReviewForm implementations in reviews-view.tsx and
      // product-reviews-inline.tsx).
      const result = existingReview
        ? await api.patch<Review>(`/api/reviews/${existingReview.id}`, { json: body, auth: true })
        : await api.post<Review>('/api/reviews', { json: body, auth: true })
      onSaved(result)
    } catch (e: any) {
      toast.error(e?.details?.error || 'Не удалось сохранить отзыв')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10004] bg-black/60 backdrop-blur-sm grid place-items-end md:place-items-center p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-md bg-background rounded-t-[32px] md:rounded-[32px] p-5 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-lg font-bold mb-1">{existingReview ? 'Изменить отзыв' : 'Оставить отзыв'}</h3>
        <p className="text-xs text-muted-foreground mb-4 truncate">{product.title}</p>

        <form onSubmit={submit} className="space-y-4">
          {/* Star picker */}
          <div>
            <Label className="text-xs font-semibold mb-2 block">Оценка</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRating(s)}
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1"
                >
                  <Star
                    className={cn(
                      'h-8 w-8 transition-colors',
                      (hoverRating || rating) >= s ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <Label htmlFor="rv-title" className="text-xs font-semibold mb-1.5 block">Заголовок (необязательно)</Label>
            <Input
              id="rv-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Коротко об отзыве"
            />
          </div>

          {/* Content */}
          <div>
            <Label htmlFor="rv-content" className="text-xs font-semibold mb-1.5 block">Отзыв</Label>
            <Textarea
              id="rv-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Поделитесь впечатлениями о товаре…"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-full h-11">
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={submitting || rating === 0}
              className="flex-1 rounded-full h-11 gradient-brand text-white font-semibold"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : existingReview ? 'Сохранить' : 'Опубликовать'}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
