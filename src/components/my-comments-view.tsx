'use client'

// ============================================================================
//  MyCommentsView — «Мои комментарии» (v25.16).
//
//  Owner request: «человек написал комментарий в ленте… он должен в любое
//  время найти этот комментарий… под какой товар или в ленте он написал».
//
//  Это единая история ВСЕХ комментариев пользователя:
//    • под товарами (лента / страница товара / каталог)   → GET /api/reviews/my-comments
//    • к объявлениям в Сообществах                        → GET /api/communities/my-comments
//
//  Каждый пункт показывает КОНТЕКСТ (фото + название товара/объявления),
//  текст моего комментария, ответы других людей на него и позволяет
//  перейти прямо к месту обсуждения. Открывается из профиля, меню шапки,
//  «Ещё» и события 'open-my-comments'.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Trash2, MessageSquare, ShoppingBag, Store, ChevronRight, CornerDownRight, Camera,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { useAuthStore } from '@/lib/auth-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
// v25.24: длинный текст — «Показать ещё / Свернуть»
import { CollapsibleText } from './collapsible-text'

interface ProductCommentItem {
  id: string
  parentId?: string | null
  rating: number
  content?: string | null
  createdAt: string
  product: {
    id: string
    title: string
    cover: string | null
    price: number | null
    currency?: string | null
    category?: string | null
  } | null
  replies: Array<{ id: string; content: string; createdAt: string; user?: { displayName?: string; username?: string; role?: string } | null }>
}

interface AdCommentItem {
  id: string
  content: string
  createdAt: string
  post: {
    id: string
    title: string
    images: string[]
    createdAt: string
    communityId: string
    communityName: string
  }
  replies: Array<{ id: string; content: string; createdAt: string; author?: { displayName?: string; username?: string } | null }>
}

type Tab = 'products' | 'ads'

export function MyCommentsView() {
  // Управление: слушаем window-событие + рендерим только когда open.
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('products')
  const [loading, setLoading] = useState(true)
  const [productItems, setProductItems] = useState<ProductCommentItem[]>([])
  const [adItems, setAdItems] = useState<AdCommentItem[]>([])
  const [confirmId, setConfirmId] = useState<{ kind: Tab; id: string } | null>(null)
  const authed = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('open-my-comments', onOpen as EventListener)
    return () => window.removeEventListener('open-my-comments', onOpen as EventListener)
  }, [])

  const load = useCallback(async () => {
    if (!authed) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [pr, ad] = await Promise.all([
        api.get<{ items: ProductCommentItem[] }>('/api/reviews/my-comments', { auth: true }).catch(() => ({ items: [] })),
        api.get<{ items: AdCommentItem[] }>('/api/communities/my-comments', { auth: true }).catch(() => ({ items: [] })),
      ])
      setProductItems(pr.items || [])
      setAdItems(ad.items || [])
    } finally {
      setLoading(false)
    }
  }, [authed])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const deleteComment = async (kind: Tab, id: string) => {
    try {
      if (kind === 'products') await api.delete(`/api/reviews/${id}`, { auth: true })
      else await api.delete(`/api/communities/comments/${id}`, { auth: true })
      haptic.success()
      toast.success('Комментарий удалён')
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось удалить')
    }
  }

  const openProduct = (productId: string) => {
    haptic.tap()
    // v25.24 FIX: закрываем свой оверлей (z-540) ДО открытия товара (z-350),
    // иначе товар открывается ПОД списком и кажется, что «переход не работает».
    setOpen(false)
    window.dispatchEvent(new CustomEvent('999pro:open-product', { detail: { productId } }))
  }

  const openAd = (communityId: string, postId: string) => {
    haptic.tap()
    const url = `${window.location.pathname}?view=community&community=${communityId}&post=${postId}`
    window.history.replaceState({}, '', url)
    window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'community' } }))
    setOpen(false)
  }

  if (!open) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[540] bg-background overflow-y-auto overscroll-contain"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div className="max-w-lg mx-auto min-h-full pb-24">
        {/* Шапка */}
        <div
          className="sticky top-0 z-20 flex items-center gap-2 px-4 py-2.5 backdrop-blur-xl bg-background/85 border-b border-border/40"
          style={{ paddingTop: 'max(env(safe-area-inset-top,0px),0.65rem)' }}
        >
          <button onClick={() => { haptic.tap(); setOpen(false) }} aria-label="Назад" className="h-9 w-9 rounded-full grid place-items-center bg-foreground/5 hover:bg-foreground/10 active:scale-95 transition-all">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-bold block">Мои комментарии</span>
            <span className="text-[11px] text-muted-foreground">Вся история обсуждений в одном месте</span>
          </div>
        </div>

        {/* Переключатель */}
        <div className="px-4 pt-3">
          <div className="inline-flex rounded-full bg-muted p-1 text-xs font-semibold">
            <button
              onClick={() => { haptic.select(); setTab('products') }}
              className={cn(
                'h-8 px-3.5 rounded-full inline-flex items-center gap-1.5 transition-all',
                tab === 'products' ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              <ShoppingBag className="h-3.5 w-3.5" /> Товары
              {!loading && <span className="text-[10px] font-bold">{productItems.length}</span>}
            </button>
            <button
              onClick={() => { haptic.select(); setTab('ads') }}
              className={cn(
                'h-8 px-3.5 rounded-full inline-flex items-center gap-1.5 transition-all',
                tab === 'ads' ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              <Store className="h-3.5 w-3.5" /> Объявления
              {!loading && <span className="text-[10px] font-bold">{adItems.length}</span>}
            </button>
          </div>
        </div>

        {/* Контент */}
        <div className="px-4 pt-3 space-y-3">
          {!authed ? (
            <EmptyCard
              icon={<MessageSquare className="h-10 w-10 text-muted-foreground/40" />}
              title="Войдите в аккаунт"
              subtitle="Ваши комментарии по товарам и объявлениям появятся здесь"
            />
          ) : loading ? (
            <>
              <div className="h-28 rounded-2xl skeleton" />
              <div className="h-28 rounded-2xl skeleton" />
            </>
          ) : tab === 'products' ? (
            productItems.length === 0 ? (
              <EmptyCard
                icon={<MessageSquare className="h-10 w-10 text-muted-foreground/30" />}
                title="Комментариев к товарам пока нет"
                subtitle="Напишите комментарий в ленте или под товаром — он появится здесь"
              />
            ) : (
              productItems.map((item) => (
                <ProductCommentCard
                  key={item.id}
                  item={item}
                  onOpen={() => item.product && openProduct(item.product.id)}
                  onDelete={confirmId ? undefined : () => setConfirmId({ kind: 'products', id: item.id })}
                />
              ))
            )
          ) : adItems.length === 0 ? (
            <EmptyCard
              icon={<Camera className="h-10 w-10 text-muted-foreground/30" />}
              title="Комментариев к объявлениям пока нет"
              subtitle="Обсуждайте объявления в Сообществах — история сохранится здесь"
            />
          ) : (
            adItems.map((item) => (
              <AdCommentCard
                key={item.id}
                item={item}
                onOpen={() => openAd(item.post.communityId, item.post.id)}
                onDelete={confirmId ? undefined : () => setConfirmId({ kind: 'ads', id: item.id })}
              />
            ))
          )}
        </div>
      </div>

      {/* Подтверждение удаления */}
      <ConfirmDialog
        open={!!confirmId}
        title="Удалить комментарий?"
        message="Это действие нельзя отменить."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={() => {
          if (confirmId) deleteComment(confirmId.kind, confirmId.id)
          setConfirmId(null)
        }}
        onCancel={() => setConfirmId(null)}
      />
    </motion.div>
  )
}

/* ---------- карточка комментария под товаром ---------- */

function ProductCommentCard({
  item,
  onOpen,
  onDelete,
}: {
  item: ProductCommentItem
  onOpen: () => void
  onDelete?: () => void
}) {
  const isReplyOnly = !item.content && item.replies.length >= 0 && !!item.parentId
  return (
    <div className="rounded-3xl bg-card ring-1 ring-black/[0.04] dark:ring-white/[0.07] overflow-hidden">
      {/* Контекст: товар */}
      <button onClick={onOpen} className="w-full flex items-center gap-3 px-4 pt-3 pb-2 text-left hover:bg-accent/30 transition-colors">
        <div className="relative h-14 w-14 rounded-2xl overflow-hidden bg-muted shrink-0">
          {item.product?.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(item.product.cover)} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="h-full w-full grid place-items-center"><ShoppingBag className="h-5 w-5 text-muted-foreground/40" /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-primary mb-0.5 flex items-center gap-1">
            Товар <ChevronRight className="h-3 w-3" />
          </div>
          <div className="text-sm font-bold truncate">{item.product?.title || 'Товар недоступен'}</div>
          <div className="text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</div>
        </div>
      </button>

      {/* Мой текст */}
      {item.content && (
        <div className="px-4 pb-2">
          <CollapsibleText
            text={item.content}
            maxLines={6}
            className="text-[13px] leading-relaxed text-foreground/90 whitespace-pre-line"
          />
        </div>
      )}
      {isReplyOnly && (
        <p className="px-4 pb-2 text-xs text-muted-foreground italic">ваш ответ на комментарий</p>
      )}

      {/* Ответы других */}
      {item.replies.length > 0 && (
        <div className="mx-4 mb-3 ml-6 pl-3 border-l-2 border-primary/25 space-y-1.5">
          {item.replies.map((r) => (
            <div key={r.id} className="flex gap-2">
              <CornerDownRight className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-[12px] leading-snug text-muted-foreground">
                <b className="text-foreground">{r.user?.displayName || r.user?.username || 'Пользователь'}</b>
                {r.user?.role === 'admin' && <span className="ml-1 text-[8px] font-bold uppercase px-1 py-px rounded gradient-brand text-white align-middle">Продавец</span>}
                {': '}
                {r.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Футер карточки */}
      <div className="flex items-center justify-end gap-1 px-3 pb-2.5">
        <button onClick={onOpen} className="h-8 px-3 rounded-full text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors">
          Открыть обсуждение
        </button>
        {onDelete && (
          <button onClick={onDelete} aria-label="Удалить комментарий" className="h-8 w-8 rounded-full grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- карточка комментария к объявлению ---------- */

function AdCommentCard({
  item,
  onOpen,
  onDelete,
}: {
  item: AdCommentItem
  onOpen: () => void
  onDelete?: () => void
}) {
  return (
    <div className="rounded-3xl bg-card ring-1 ring-black/[0.04] dark:ring-white/[0.07] overflow-hidden">
      <button onClick={onOpen} className="w-full flex items-center gap-3 px-4 pt-3 pb-2 text-left hover:bg-accent/30 transition-colors">
        <div className="relative h-14 w-14 rounded-2xl overflow-hidden bg-muted shrink-0">
          {item.post.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(item.post.images[0])} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="h-full w-full grid place-items-center"><Camera className="h-5 w-5 text-muted-foreground/40" /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-violet-500 mb-0.5 flex items-center gap-1">
            Объявление · {item.post.communityName} <ChevronRight className="h-3 w-3 shrink-0" />
          </div>
          <div className="text-sm font-bold line-clamp-1">{item.post.title}</div>
          <div className="text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</div>
        </div>
      </button>

      <div className="px-4 pb-2">
        <CollapsibleText
          text={item.content}
          maxLines={6}
          className="text-[13px] leading-relaxed text-foreground/90 whitespace-pre-line"
        />
      </div>

      {item.replies.length > 0 && (
        <div className="mx-4 mb-3 ml-6 pl-3 border-l-2 border-violet-500/30 space-y-1.5">
          {item.replies.map((r) => (
            <div key={r.id} className="flex gap-2">
              <Avatar className="h-5 w-5 mt-0.5">
                <AvatarFallback className="gradient-brand text-white text-[7px]">{(r.author?.displayName || r.author?.username || '?').charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <p className="text-[12px] leading-snug text-muted-foreground">
                <b className="text-foreground">{r.author?.displayName || r.author?.username || 'Участник'}</b>
                {': '}
                {r.content}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-1 px-3 pb-2.5">
        <button onClick={onOpen} className="h-8 px-3 rounded-full text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors">
          Открыть объявление
        </button>
        {onDelete && (
          <button onClick={onDelete} aria-label="Удалить комментарий" className="h-8 w-8 rounded-full grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function EmptyCard({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="rounded-3xl glass p-8 text-center">
      <div className="grid place-items-center mb-2">{icon}</div>
      <p className="text-sm font-bold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">{subtitle}</p>
    </div>
  )
}
