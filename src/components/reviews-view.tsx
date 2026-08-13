'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { api, assetUrl } from '@/lib/api'
import type { Review, Product } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatPrice, timeAgo, initials } from '@/lib/format'
import { toast } from '@/lib/notifications'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/lib/auth-store'
import {
  Star, StarHalf, ThumbsUp, Camera, X, ChevronLeft, ChevronRight,
  Search, MessageSquarePlus, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// ReviewsView — full "Reviews" page.
//
// Shows a browseable list of all products with reviews. User can:
// - Search products by name
// - Tap a product to see its reviews (rating distribution + individual reviews)
// - Add their own review (rating 1-5 + text + optional photos)
// - Edit/delete their own review
// - Sort reviews by newest / highest / lowest
// ============================================================================

type SortMode = 'newest' | 'highest' | 'lowest'

export function ReviewsView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  // Load products that have at least 1 review (or all if no reviews yet).
  useEffect(() => {
    setLoading(true)
    api
      .get<{ items: Product[] }>('/api/products', { query: { limit: 48 } })
      .then((d) => setProducts(d.items))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    )
  }, [products, search])

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId],
  )

  if (selectedProduct) {
    return (
      <ProductReviews
        product={selectedProduct}
        isAuthenticated={isAuthenticated}
        currentUserId={user?.id}
        currentUserAvatar={user?.avatar}
        currentUserName={user?.displayName || user?.username}
        onBack={() => setSelectedProductId(null)}
      />
    )
  }

  return (
    <div className="page-top-padding pb-28 md:pb-6">
      <div className="px-4 md:px-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="h-11 w-11 rounded-2xl gradient-brand grid place-items-center shadow-glow shrink-0">
            <Star className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Отзывы</h1>
            <p className="text-sm text-muted-foreground">
              Реальные отзывы покупателей на товары
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск товара для отзыва…"
            className="rounded-full pl-10 pr-4 bg-accent/30"
          />
        </div>

        {/* Products grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden glass">
                <div className="aspect-[3/4] skeleton" />
                <div className="p-3 space-y-2">
                  <div className="h-3 w-3/4 rounded skeleton" />
                  <div className="h-3 w-1/2 rounded skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="h-20 w-20 rounded-full gradient-soft mx-auto mb-4 grid place-items-center">
              <Star className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">Ничего не найдено</h3>
            <p className="text-sm text-muted-foreground">Попробуйте изменить запрос</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProductId(p.id)}
                className="text-left rounded-xl overflow-hidden glass hover:shadow-glow transition-all hover:-translate-y-0.5 group"
              >
                <div className="aspect-[3/4] relative overflow-hidden bg-accent/20">
                  {p.images[0] && (
                    <img
                      src={assetUrl(p.images[0])}
                      alt={p.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  )}
                  {p.rating > 0 && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-white text-xs font-semibold">
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      {p.rating.toFixed(1)}
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="text-sm font-semibold line-clamp-2 mb-1">{p.title}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {p.reviewsCount > 0 ? `${p.reviewsCount} отз.` : 'Нет отзывов'}
                    </span>
                    <span className="text-sm font-bold">{formatPrice(p.price)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// ProductReviews — reviews list + add-review form for a single product.
// ============================================================================

function ProductReviews({
  product,
  isAuthenticated,
  currentUserId,
  currentUserAvatar,
  currentUserName,
  onBack,
}: {
  product: Product
  isAuthenticated: boolean
  currentUserId?: string
  currentUserAvatar?: string | null
  currentUserName?: string | null
  onBack: () => void
}) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortMode>('newest')
  const [distribution, setDistribution] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  const [avgRating, setAvgRating] = useState(0)
  const [totalReviews, setTotalReviews] = useState(0)
  const [myReview, setMyReview] = useState<Review | null>(null)
  // Phase 10: custom confirm dialog state
  const [deleteReviewId, setDeleteReviewId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get<{
        items: Review[]
        distribution: Record<number, number>
        avgRating: number
        total: number
      }>('/api/reviews', { query: { productId: product.id, sort, limit: 50 } }),
      isAuthenticated
        ? api.get<{ review: Review | null }>('/api/reviews/mine', { query: { productId: product.id }, auth: true })
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось удалить отзыв'
      toast.error(msg)
    }
  }

  const totalRatings = Object.values(distribution).reduce((a, b) => a + b, 0)

  return (
    <div className="page-top-padding pb-28 md:pb-6">
      <div className="px-4 md:px-6 max-w-3xl mx-auto">
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ChevronLeft className="h-4 w-4" /> Все товары
        </button>

        {/* Product header */}
        <div className="glass rounded-3xl p-4 mb-5 flex gap-3">
          <div className="h-20 w-20 rounded-2xl overflow-hidden bg-accent/20 shrink-0">
            {product.images[0] && (
              <img src={assetUrl(product.images[0])} alt={product.title} className="w-full h-full object-cover" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold line-clamp-2">{product.title}</h2>
            <div className="text-sm font-bold mt-1">{formatPrice(product.price)}</div>
            <div className="flex items-center gap-1 mt-1">
              <StarRating value={avgRating} size="sm" />
              <span className="text-xs text-muted-foreground">
                {totalReviews > 0 ? `${avgRating.toFixed(1)} · ${totalReviews} отз.` : 'Нет отзывов'}
              </span>
            </div>
          </div>
        </div>

        {/* Rating distribution */}
        {totalReviews > 0 && (
          <div className="glass rounded-3xl p-4 mb-5">
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <div className="text-4xl font-extrabold">{avgRating.toFixed(1)}</div>
                <StarRating value={avgRating} size="sm" />
                <div className="text-xs text-muted-foreground mt-1">{totalReviews} отз.</div>
              </div>
              <div className="flex-1 space-y-1">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = distribution[star] || 0
                  const pct = totalRatings > 0 ? (count / totalRatings) * 100 : 0
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-3 text-muted-foreground">{star}</span>
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      <div className="flex-1 h-2 rounded-full bg-accent/30 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.4 }}
                          className="h-full bg-yellow-400"
                        />
                      </div>
                      <span className="w-8 text-right text-muted-foreground">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Sort + Add review */}
        <div className="flex items-center gap-2 mb-4">
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {(['newest', 'highest', 'lowest'] as SortMode[]).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={cn(
                  'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                  sort === s ? 'gradient-brand text-white shadow-glow' : 'glass text-muted-foreground',
                )}
              >
                {s === 'newest' ? 'Новые' : s === 'highest' ? 'Высокий' : 'Низкий'}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {isAuthenticated && !myReview && (
            <Button
              onClick={() => setShowForm(true)}
              size="sm"
              className="rounded-full gradient-brand text-white font-semibold h-9 px-4"
            >
              <MessageSquarePlus className="h-4 w-4 mr-1" /> Отзыв
            </Button>
          )}
        </div>

        {/* My review (highlighted) */}
        {myReview && (
          <div className="glass rounded-3xl p-4 mb-3 border-2 border-primary/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-primary">ВАШ ОТЗЫВ</span>
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

        {/* Reviews list — horizontal scroll carousel.
            Each card has a fixed width (min 280px / max 320px) so a peek of
            the next card is always visible, signalling scrollability.
            `snap-edge` (globals.css) gives native swipe-to-card snap on mobile. */}
        {loading ? (
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="glass rounded-3xl p-4 shrink-0 min-w-[280px] max-w-[320px]"
              >
                <div className="flex gap-3">
                  <div className="h-10 w-10 rounded-full skeleton" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 rounded skeleton" />
                    <div className="h-3 w-full rounded skeleton" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="py-12 text-center">
            <div className="h-16 w-16 rounded-full gradient-soft mx-auto mb-3 grid place-items-center">
              <Star className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">Отзывов пока нет</h3>
            <p className="text-sm text-muted-foreground mb-4">Будьте первым, кто оставит отзыв</p>
            {isAuthenticated ? (
              <Button
                onClick={() => setShowForm(true)}
                className="rounded-full gradient-brand text-white font-semibold h-11 px-6"
              >
                <MessageSquarePlus className="h-4 w-4 mr-1.5" /> Оставить отзыв
              </Button>
            ) : (
              <button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('999pro:open-auth'))
                  }
                }}
                className="rounded-full gradient-brand text-white font-semibold h-11 px-6 inline-flex items-center gap-2"
              >
                Войти, чтобы оставить отзыв
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-edge pb-2">
            <AnimatePresence mode="popLayout">
              {reviews.map((r) => (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="shrink-0 min-w-[280px] max-w-[320px]"
                >
                  <ReviewCard review={r} isOwn={r.userId === currentUserId} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Add/Edit review form */}
      <AnimatePresence>
        {showForm && (
          <ReviewForm
            product={product}
            existingReview={myReview}
            onClose={() => setShowForm(false)}
            onSaved={(review) => {
              setMyReview(review)
              setShowForm(false)
              refresh()
              toast.success(myReview ? 'Отзыв обновлён' : 'Отзыв опубликован')
            }}
          />
        )}
      </AnimatePresence>

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
// StarRating — display-only star row (supports half-stars via StarHalf icon).
// ============================================================================

function StarRating({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5'
  const stars = []
  for (let i = 1; i <= 5; i++) {
    if (value >= i) {
      stars.push(<Star key={i} className={cn(dims, 'fill-yellow-400 text-yellow-400')} />)
    } else if (value >= i - 0.5) {
      stars.push(<StarHalf key={i} className={cn(dims, 'fill-yellow-400 text-yellow-400')} />)
    } else {
      stars.push(<Star key={i} className={cn(dims, 'text-muted-foreground/40')} />)
    }
  }
  return <div className="flex items-center gap-0.5">{stars}</div>
}

// ============================================================================
// ReviewCard — single review display.
// ============================================================================

function ReviewCard({ review, isOwn }: { review: Review; isOwn?: boolean }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  return (
    <div className="glass rounded-3xl p-4">
      <div className="flex items-start gap-3 mb-2">
        <Avatar className="h-10 w-10 shrink-0">
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
      </div>

      {review.title && (
        <div className="font-semibold text-sm mb-1">{review.title}</div>
      )}
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
// PhotoLightbox — full-screen image viewer for review photos.
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur grid place-items-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
        aria-label="Закрыть"
      >
        <X className="h-5 w-5" />
      </button>
      {photos.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i - 1 + photos.length) % photos.length) }}
            className="absolute left-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
            aria-label="Предыдущее"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i + 1) % photos.length) }}
            className="absolute right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
            aria-label="Следующее"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
      <img
        src={assetUrl(photos[index])}
        alt={`Фото ${index + 1}`}
        className="max-w-[90vw] max-h-[85vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </motion.div>
  )
}

// ============================================================================
// ReviewForm — modal form to create/edit a review.
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
      toast.error('Поставьте оценку')
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur grid place-items-end md:place-items-center"
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
          <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-accent grid place-items-center">
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

        <form onSubmit={submit} className="space-y-4">
          {/* Rating */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Оценка</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1"
                  aria-label={`${star} звёзд`}
                >
                  <Star
                    className={cn(
                      'h-8 w-8 transition-transform',
                      (hoverRating || rating) >= star
                        ? 'fill-yellow-400 text-yellow-400 scale-110'
                        : 'text-muted-foreground/40',
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Заголовок (необязательно)</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Короткое описание"
              maxLength={200}
              className="rounded-2xl"
            />
          </div>

          {/* Content */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Отзыв</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Поделитесь впечатлениями о товаре…"
              rows={4}
              maxLength={5000}
              className="rounded-2xl resize-none"
            />
          </div>

          {/* Photos */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Фотографии (до 5)</Label>
            <div className="flex gap-2 flex-wrap">
              {photos.map((url, i) => (
                <div key={i} className="relative h-20 w-20 rounded-xl overflow-hidden">
                  <img src={assetUrl(url)} alt={`Фото ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white grid place-items-center hover:bg-black/80"
                    aria-label="Удалить фото"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {photos.length < 5 && (
                <label className="h-20 w-20 rounded-xl border-2 border-dashed border-border hover:border-primary grid place-items-center cursor-pointer transition-colors">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Camera className="h-5 w-5 text-muted-foreground" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-full h-11"
              onClick={onClose}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              className="flex-1 rounded-full gradient-brand text-white font-semibold h-11"
              disabled={saving || rating === 0}
            >
              {saving ? 'Сохранение…' : existingReview ? 'Сохранить' : 'Опубликовать'}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

// Local Label import to avoid pulling from ui/label for this single use.

