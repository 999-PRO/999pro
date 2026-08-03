'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, StarHalf, X, Camera, Loader2, PenLine, Trash2, MessageSquare, ChevronLeft, ChevronRight, ChevronRight as ChevronRightIcon } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Product, Review } from '@/lib/types'
import { useAuthStore } from '@/lib/auth-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCompactNumber, timeAgo, initials } from '@/lib/format'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { AllReviewsSheet } from './all-reviews-sheet'

// ============================================================================
//  ProductReviewsInline — compact reviews section embedded directly in the
//  product page (not a separate view). Shows:
//    1. Rating summary: average stars + total count + distribution bars
//    2. "Leave a review" CTA (if not authenticated → prompt to login)
//    3. The current user's existing review (with edit/delete)
//    4. Up to 3 latest reviews as compact preview cards
//    5. "Показать все отзывы (N)" button → opens AllReviewsSheet modal
//    6. Inline review form (modal) for creating/editing
//
//  Design rationale: the product card must stay compact. Instead of listing
//  all 50+ reviews inline (which makes the card endlessly long), we show a
//  2-3 card preview and delegate the full list to a dedicated Bottom Sheet.
//  This mirrors how modern marketplaces (Ozon, Wildberries, Яндекс Маркет)
//  handle reviews.
//
//  All data is fetched from /api/reviews and posted to /api/reviews — the
//  backend already keeps Product.rating + Product.reviewsCount in sync, so
//  the product card's star display updates automatically after the user
//  submits a review (the parent component refetches the product).
// ============================================================================

interface Props {
  product: Product
  /** Called after a review is created/edited/deleted so the parent can
   *  refetch the product and update its rating display. */
  onReviewChanged?: () => void
  /** v9-premium: compact mode for Desktop 3-column layout. When true, hides
   *  the duplicate rating block (since the parent card already shows it)
   *  and reduces preview count. Does NOT change mobile behaviour. */
  compact?: boolean
}

type SortMode = 'newest' | 'highest' | 'lowest'

// How many preview reviews to show inline. 3 fits comfortably on most
// phone widths (each card ~110px tall) and gives the user enough signal
// to decide whether to open the full reviews sheet.
const PREVIEW_COUNT = 3

export function ProductReviewsInline({ product, onReviewChanged, compact = false }: Props) {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortMode>('newest')
  const [distribution, setDistribution] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  const [avgRating, setAvgRating] = useState(0)
  const [totalReviews, setTotalReviews] = useState(0)
  const [myReview, setMyReview] = useState<Review | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showAllSheet, setShowAllSheet] = useState(false)
  // Phase 10: custom confirm dialog state
  const [deleteReviewId, setDeleteReviewId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    Promise.all([
      // Fetch only the PREVIEW_COUNT most recent reviews — the full list
      // is fetched lazily by AllReviewsSheet when the user opens it.
      // This keeps the product card payload small and fast.
      api.get<{
        items: Review[]
        distribution: Record<number, number>
        avgRating: number
        total: number
      }>('/api/reviews', { query: { productId: product.id, sort, limit: PREVIEW_COUNT } }),
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
        setTotalReviews(d.total || 0)
        setMyReview(mine.review)
      })
      .catch(() => {
        setReviews([])
        setTotalReviews(0)
      })
      .finally(() => setLoading(false))
  }, [product.id, sort, isAuthenticated])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleDelete = async (reviewId: string) => {
    // Phase 10: use custom confirm dialog
    setDeleteReviewId(reviewId)
  }

  const confirmDeleteReview = async () => {
    const reviewId = deleteReviewId
    if (!reviewId) return
    setDeleteReviewId(null)
    try {
      await api.delete(`/api/reviews/${reviewId}`, { auth: true })
      setMyReview(null)
      setReviews((cur) => cur.filter((r) => r.id !== reviewId))
      toast.success('Отзыв удалён')
      refresh()
      onReviewChanged?.()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось удалить отзыв'
      toast.error(msg)
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

  return (
    <div className="pt-2">
      <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        Отзывы и оценки
        {totalReviews > 0 && (
          <span className="text-xs font-normal text-muted-foreground">
            ({formatCompactNumber(totalReviews)})
          </span>
        )}
      </h2>

      {/* Rating summary — hidden in compact mode (parent card shows its own rating) */}
      {!compact && (
        <div className="glass rounded-2xl p-4 mb-3">
          <div className="flex items-center gap-4">
            {/* Average */}
            <div className="text-center shrink-0">
              <div className="text-3xl font-extrabold leading-none">
                {avgRating > 0 ? avgRating.toFixed(1) : '—'}
              </div>
              <div className="mt-1">
                <StarRating value={avgRating} size="sm" />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {totalRatings} {totalRatings === 1 ? 'оценка' : totalRatings < 5 ? 'оценки' : 'оценок'}
              </div>
            </div>

            {/* Distribution bars */}
            <div className="flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = distribution[star] || 0
                const pct = totalRatings > 0 ? (count / totalRatings) * 100 : 0
                return (
                  <div key={star} className="flex items-center gap-2 text-xs">
                    <span className="w-3 text-muted-foreground">{star}</span>
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                    <div className="flex-1 h-1.5 rounded-full bg-accent/40 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-muted-foreground tabular-nums">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* CTA: leave a review */}
      {isAuthenticated ? (
        !myReview && (
          <Button
            onClick={() => setShowForm(true)}
            className="w-full rounded-2xl h-11 mb-3 gradient-brand text-white font-semibold"
          >
            <PenLine className="h-4 w-4 mr-1.5" /> Оставить отзыв
          </Button>
        )
      ) : (
        <div className="glass rounded-2xl p-3 mb-3 text-center text-xs text-muted-foreground">
          Войдите, чтобы оставить отзыв и оценить товар
        </div>
      )}

      {/* Sort tabs — only shown when there are reviews. This controls the
          preview order. The full sort + filter UI lives in AllReviewsSheet. */}
      {totalReviews > 0 && (
        <div className="flex gap-1.5 mb-3">
          {([
            { id: 'newest', label: 'Новые' },
            { id: 'highest', label: 'Высокий' },
            { id: 'lowest', label: 'Низкий' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setSort(t.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                sort === t.id
                  ? 'gradient-brand text-white shadow-glow'
                  : 'glass text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* My review (highlighted) */}
      {myReview && (
        <div className="mb-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1.5 px-1">
            Ваш отзыв
          </div>
          <ReviewCard
            review={myReview}
            isOwn
            onEdit={() => setShowForm(true)}
            onDelete={() => handleDelete(myReview.id)}
          />
        </div>
      )}

      {/* Preview: up to 3 latest reviews (compact cards stacked vertically).
          The full list lives in AllReviewsSheet — opened by the button below. */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="glass rounded-2xl p-4 h-24 skeleton" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="glass rounded-2xl p-6 text-center">
          <div className="text-3xl mb-2">⭐</div>
          <p className="text-sm text-muted-foreground">
            {isAuthenticated
              ? 'Будьте первым, кто оставит отзыв на этот товар'
              : 'Пока нет отзывов. Войдите, чтобы оставить первый.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {reviews
                .filter((r) => r.id !== myReview?.id) // Don't show my review twice
                .slice(0, PREVIEW_COUNT)
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
          </div>

          {/* "Show all reviews" button — full-width CTA that opens the sheet.
              Shows the total count so the user knows how many reviews are
              available before tapping. Hidden when there are no more reviews
              than what we already show as preview. */}
          {totalReviews > reviews.filter((r) => r.id !== myReview?.id).length && (
            <button
              onClick={() => setShowAllSheet(true)}
              className="w-full mt-3 h-11 rounded-2xl glass hover:bg-accent/60 transition-colors flex items-center justify-center gap-1.5 text-sm font-semibold text-foreground"
            >
              <span>Показать все отзывы</span>
              {totalReviews > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  ({formatCompactNumber(totalReviews)})
                </span>
              )}
              <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </>
      )}

      {/* All-reviews sheet — search, sort, star filter, pagination */}
      <AllReviewsSheet
        product={product}
        open={showAllSheet}
        onClose={() => setShowAllSheet(false)}
        onReviewChanged={onReviewChanged}
      />

      {/* Review form modal.
          v25.6 (Task #8): rendered via portal to document.body so it always
          covers the full viewport, regardless of any `backdrop-filter` /
          `transform` ancestors that would otherwise create a containing block
          for `position: fixed` children. On desktop, the ProductPageDesktop
          layout uses GlassCard with `backdrop-blur-2xl` for both the reviews
          card AND the similar-products card — without a portal, the form's
          `fixed inset-0 z-50` was constrained to the reviews card's bounds,
          causing the submit button to be clipped/overlapped by the
          similar-products card below. */}
      {showForm && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          <ReviewForm
            product={product}
            existingReview={myReview}
            onClose={() => setShowForm(false)}
            onSaved={handleSaved}
          />
        </AnimatePresence>,
        document.body,
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
    </div>
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
        {/* Edit / delete buttons for own review */}
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

      {/* Beautiful lightbox — full-screen photo viewer with:
          - Smooth fade-in/scale animation
          - Left/right navigation arrows (desktop)
          - Swipe left/right (mobile)
          - Photo counter "2 / 5"
          - Keyboard navigation (← → Esc)
          - Tap backdrop to close
          - Tap image to toggle UI (arrows + counter) */}
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
//  PhotoLightbox — beautiful full-screen photo viewer.
//  Features:
//    - Framer-motion fade + scale entrance animation
//    - Prev/next navigation (arrows on desktop, swipe on mobile)
//    - Photo counter "2 / 5"
//    - Keyboard: ← → for nav, Esc to close
//    - Tap image toggles the UI (arrows + counter) — like iOS Photos
//    - Pinch-to-zoom would be nice but is complex; we skip it for now
//      and rely on the browser's built-in zoom on long-press
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
  const [uiVisible, setUiVisible] = useState(true)
  const touchStartX = useRef(0)

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + photos.length) % photos.length)
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % photos.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photos.length, onClose])

  const prev = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setIndex((i) => (i - 1 + photos.length) % photos.length)
  }
  const next = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setIndex((i) => (i + 1) % photos.length)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[10005] bg-black/95 backdrop-blur-md grid place-items-center"
      onClick={onClose}
    >
      {/* Close button */}
      <AnimatePresence>
        {uiVisible && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="absolute top-4 right-4 h-11 w-11 rounded-full bg-white/10 hover:bg-white/25 grid place-items-center text-white transition-colors z-10"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Photo counter */}
      <AnimatePresence>
        {uiVisible && photos.length > 1 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-5 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-medium backdrop-blur-sm z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {index + 1} / {photos.length}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image — animated transition between photos */}
      <motion.img
        key={index}
        src={assetUrl(photos[index])}
        alt={`Фото ${index + 1}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-2xl shadow-2xl"
        onClick={(e) => {
          e.stopPropagation()
          setUiVisible((v) => !v)
        }}
        draggable={false}
      />

      {/* Navigation arrows (desktop + touch) */}
      {photos.length > 1 && (
        <>
          <AnimatePresence>
            {uiVisible && (
              <>
                <motion.button
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onClick={prev}
                  className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/25 grid place-items-center text-white transition-colors z-10"
                  aria-label="Предыдущее фото"
                >
                  <ChevronLeft className="h-6 w-6" />
                </motion.button>
                <motion.button
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onClick={next}
                  className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/25 grid place-items-center text-white transition-colors z-10"
                  aria-label="Следующее фото"
                >
                  <ChevronRight className="h-6 w-6" />
                </motion.button>
              </>
            )}
          </AnimatePresence>

          {/* Touch swipe area — invisible, covers the whole screen so the
              user can swipe left/right anywhere to navigate on mobile */}
          <div
            className="absolute inset-0 z-0"
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0].clientX - touchStartX.current
              if (dx < -50) setIndex((i) => (i + 1) % photos.length)
              else if (dx > 50) setIndex((i) => (i - 1 + photos.length) % photos.length)
            }}
          />
        </>
      )}
    </motion.div>
  )
}

// ============================================================================
//  ReviewForm — modal form for creating/editing a review.
//  Interactive star picker: hover to preview, click to select.
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
  const [photos, setPhotos] = useState<string[]>(existingReview?.photos || [])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    if (photos.length + files.length > 5) {
      toast.error('Максимум 5 фотографий')
      return
    }
    setUploading(true)
    try {
      const uploaded: string[] = []
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        const data = await api.post<{ url: string }>('/api/upload', { form: formData, auth: true })
        uploaded.push(data.url)
      }
      setPhotos((cur) => [...cur, ...uploaded])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось загрузить фото'
      toast.error(msg)
    } finally {
      setUploading(false)
    }
  }

  const removePhoto = (idx: number) => {
    setPhotos((cur) => cur.filter((_, i) => i !== idx))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rating === 0) {
      toast.error('Поставьте оценку звёздочками')
      return
    }
    setSaving(true)
    try {
      const payload = {
        productId: product.id,
        rating,
        title: title.trim() || undefined,
        content: content.trim() || undefined,
        photos,
      }
      if (existingReview) {
        const updated = await api.patch<Review>(`/api/reviews/${existingReview.id}`, {
          json: payload,
          auth: true,
        })
        onSaved(updated)
      } else {
        const created = await api.post<Review>('/api/reviews', {
          json: payload,
          auth: true,
        })
        onSaved(created)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось сохранить отзыв'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const ratingLabels = ['', 'Ужасно', 'Плохо', 'Нормально', 'Хорошо', 'Отлично']
  const displayRating = hoverRating || rating

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // v25.6 (Task #8): z-[10000] — above ProductPageDesktop (z-80) and
      // above SmartShareSheet (z-9999) so the form is always on top.
      // Rendered via portal to document.body (see ProductReviewsInline).
      className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur grid place-items-end md:place-items-center p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="bg-background w-full md:max-w-lg rounded-t-3xl md:rounded-3xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">
            {existingReview ? 'Изменить отзыв' : 'Новый отзыв'}
          </h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-accent grid place-items-center"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Product reference */}
        <div className="flex items-center gap-2 mb-4 p-2 rounded-2xl bg-accent/20">
          <div className="h-10 w-10 rounded-lg overflow-hidden bg-accent/30 shrink-0">
            {product.images[0] && (
              <img src={assetUrl(product.images[0])} alt={product.title} className="w-full h-full object-cover" />
            )}
          </div>
          <div className="text-sm font-medium line-clamp-1">{product.title}</div>
        </div>

        {/* Interactive star picker */}
        <div className="mb-4">
          <Label className="block mb-2">Оценка *</Label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 transition-transform hover:scale-110 active:scale-95"
                  aria-label={`${star} звёзд`}
                >
                  <Star
                    className={cn(
                      'h-8 w-8 transition-colors',
                      star <= displayRating
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground/40',
                    )}
                  />
                </button>
              ))}
            </div>
            <span className="text-sm font-medium text-muted-foreground ml-2">
              {ratingLabels[displayRating] || 'Нажмите на звезду'}
            </span>
          </div>
        </div>

        {/* Title (optional) */}
        <div className="mb-3">
          <Label htmlFor="review-title" className="block mb-1.5">
            Заголовок (необязательно)
          </Label>
          <Input
            id="review-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Короткий заголовок отзыва"
            className="rounded-2xl"
            maxLength={200}
          />
        </div>

        {/* Content */}
        <div className="mb-3">
          <Label htmlFor="review-content" className="block mb-1.5">
            Текст отзыва
          </Label>
          <Textarea
            id="review-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Расскажите о своих впечатлениях — качество, доставка, соответствует ли описанию..."
            rows={4}
            className="rounded-2xl resize-none"
            maxLength={5000}
          />
        </div>

        {/* Photos */}
        <div className="mb-4">
          <Label className="block mb-1.5">Фотографии (до 5 шт.)</Label>
          <div className="flex flex-wrap gap-2">
            {photos.map((url, i) => (
              <div key={i} className="relative h-20 w-20 rounded-xl overflow-hidden bg-accent/20 shrink-0">
                <img src={assetUrl(url)} alt={`Фото ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute top-0.5 right-0.5 h-6 w-6 rounded-full bg-black/60 hover:bg-black/80 grid place-items-center text-white"
                  aria-label="Удалить фото"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {photos.length < 5 && (
              <label className="h-20 w-20 rounded-xl border-2 border-dashed border-border/60 hover:border-primary hover:bg-accent/20 grid place-items-center cursor-pointer transition-colors shrink-0">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoUpload}
                  disabled={uploading}
                />
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <Camera className="h-5 w-5 text-muted-foreground" />
                )}
              </label>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="flex-1 rounded-full h-11"
            disabled={saving}
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={saving || rating === 0}
            className="flex-1 rounded-full h-11 gradient-brand text-white font-semibold shadow-glow disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Сохранение…
              </>
            ) : existingReview ? (
              'Сохранить'
            ) : (
              'Опубликовать'
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
