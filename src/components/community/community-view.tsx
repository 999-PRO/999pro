'use client'

// ============================================================================
//  CommunityView v25.15 — ПОЛНОЦЕННАЯ ПЛОЩАДКА ОБЪЯВЛЕНИЙ (Avito-стиль).
//
//  Что нового по просьбе владельца («как Avito — красивый, чёткий»):
//    • Объявления показываются КАРТОЧКАМИ с большой обложкой, заголовком,
//      ценой и описанием — в сетке 2 колонки на десктопе.
//    • Заголовок объявления теперь отдельное поле в композере (первая
//      строка контента в БД — обратная совместимость со старыми постами).
//    • Кли tap по карточке открывает ПОЛНУЮ карточку объявления:
//      свайп-карусель фото (инерционный translateX-трек + стрелки),
//      полное описание, цена крупно, кнопки Позвонить / WhatsApp / Telegram.
//    • Поиск по объявлениям внутри сообщества (заголовок/описание/цена).
//    • Счётчик фото на обложке, бейдж «опт от тиража» у ценовых постов.
//  Закрытый оптовый клуб работает как раньше: только участники видят посты,
//  владелец добавляет людей через «Участники» (или из Студии).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Users, Lock, Globe, UserPlus, LogOut, Trash2,
  Send, ImagePlus, X, Phone, Search, Crown, ChevronLeft, ChevronRight, Camera,
  MessageCircle, CornerDownRight, Pencil,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { useAuthStore } from '@/lib/auth-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
// v25.24: длинный текст — «Показать ещё / Свернуть»
import { CollapsibleText } from '@/components/collapsible-text'

interface CommunitySummary {
  id: string
  name: string
  description?: string | null
  cover?: string | null
  type: 'public' | 'private'
  membersCount: number
  postsCount: number
  isMember: boolean
  isOwner: boolean
}

interface CommunityPost {
  id: string
  content: string
  images: string[]
  price: number | null
  contactPhone?: string | null
  // v25.16: дополнительные контакты автора объявления
  contactWhatsApp?: string | null
  contactTelegram?: string | null
  commentsCount?: number
  createdAt: string
  author: { id: string; username: string; displayName?: string | null; avatar?: string | null; role?: string }
}

// v25.16: комментарий к объявлению (+ вложенные ответы)
interface AdComment {
  id: string
  parentId?: string | null
  content: string
  createdAt: string
  edited?: boolean
  author: { id: string; username: string; displayName?: string | null; avatar?: string | null; role?: string } | null
  replies?: AdComment[]
}

interface MemberRow {
  userId: string
  username: string
  displayName?: string | null
  avatar?: string | null
  role: string
}

// ----------------------------------------------------------------------------
// Разбор содержимого поста: первая строка = ЗАГОЛОВОК объявления (композер
// v25.15 пишет title первой строкой, затем пустая строка, затем описание).
// Старые посты рендерятся мягко: если одна строка — это описание без хедера.
// ----------------------------------------------------------------------------
function splitAd(content: string): { title: string | null; body: string } {
  const lines = (content || '').split('\n')
  const first = (lines[0] || '').trim()
  const rest = lines.slice(1).join('\n').trim()
  if (first && first.length <= 90) {
    return { title: first, body: rest }
  }
  return { title: null, body: (content || '').trim() }
}

function telHref(raw: string): string {
  return `tel:${raw.replace(/[^0-9+]/g, '')}`
}

function waHref(raw: string | null | undefined, title: string | null): string | null {
  if (!raw) return null
  if (raw.startsWith('http')) return raw
  const digits = raw.replace(/[^0-9]/g, '')
  const text = encodeURIComponent(`Здравствуйте! Пишу по объявлению${title ? ` «${title}»` : ''}.`)
  return `https://wa.me/${digits}?text=${text}`
}

function tgHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (raw.startsWith('http')) return raw
  const handle = raw.startsWith('@') ? raw.slice(1) : raw
  return `https://t.me/${handle}`
}

export function CommunityView() {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [communities, setCommunities] = useState<CommunitySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // v25.19: фильтр списка сообществ (Все/Открытые/Закрытые/Мои)
  const [communityFilter, setCommunityFilter] = useState<'all' | 'public' | 'private' | 'mine'>('all')
  const filteredCommunities = useMemo(() => {
    const meId = user?.id
    switch (communityFilter) {
      case 'public': return communities.filter((c) => c.type === 'public')
      case 'private': return communities.filter((c) => c.type === 'private')
      case 'mine': return communities.filter((c) => c.isOwner || c.isMember)
      default: return communities
    }
  }, [communities, communityFilter, user])

  const fetchCommunities = useCallback(() => {
    setLoading(true)
    // v25.15 FIX: раньше запрос шёл с auth:true даже у гостя — а api-клиент
    // в этом случае ВООБЩЕ не отправляет запрос (нет токена → локальный 401)
    // и гость видел «Сообществ пока нет». Список публичный (optionalAuth):
    // авторизация добавляется только когда пользователь реально залогинен.
    const authed = useAuthStore.getState().isAuthenticated
    api.get<{ items: CommunitySummary[] }>('/api/communities', { auth: authed })
      .then((d) => setCommunities(d.items || []))
      .catch(() => setCommunities([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchCommunities() }, [fetchCommunities])
  useEffect(() => { if (!selectedId) fetchCommunities() }, [refreshKey, selectedId, fetchCommunities])

  // v25.16: ДИП-ЛИНК из push-уведомления (?view=community&community=…&post=…).
  const [deepLinkPostId, setDeepLinkPostId] = useState<string | null>(null)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const cid = params.get('community')
      const pid = params.get('post')
      if (cid && pid) {
        setSelectedId(cid)
        setDeepLinkPostId(pid)
        params.delete('community')
        params.delete('post')
        const next = params.toString()
        window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`)
      } else if (cid) {
        setSelectedId(cid)
        params.delete('community')
        const next = params.toString()
        window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`)
      }
    } catch { /* noop */ }
  }, [])

  const openAuth = () => window.dispatchEvent(new CustomEvent('999pro:open-auth'))

  if (selectedId) {
    return (
      <CommunityDetail
        id={selectedId}
        authed={isAuthenticated}
        isAdmin={user?.role === 'admin'}
        deepLinkPostId={deepLinkPostId}
        onBack={() => { haptic.tap(); setSelectedId(null); setRefreshKey((k) => k + 1); setDeepLinkPostId(null) }}
        onRequireAuth={openAuth}
      />
    )
  }

  return (
    <div className="px-4 md:px-6 lg:px-8 max-w-5xl mx-auto pb-28 md:pb-16 page-top-padding">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <span className="h-9 w-9 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9] grid place-items-center shadow-lg shadow-violet-500/25">
            <Users className="h-5 w-5 text-white" />
          </span>
          Сообщества
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Живая площадка объявлений покупателей и закрытый оптовый клуб
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-40 rounded-3xl skeleton" />)}
        </div>
      ) : communities.length === 0 ? (
        <div className="glass rounded-3xl p-10 text-center">
          <Users className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="font-semibold mb-1">Сообществ пока нет</p>
          <p className="text-sm text-muted-foreground">Создайте первое в Студии</p>
        </div>
      ) : (
        <>
          {/* v25.19 (owner): фильтры сообществ — Все / Открытые / Закрытые / Мои */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1">
            {([
              { id: 'all', label: 'Все' },
              { id: 'public', label: 'Открытые' },
              { id: 'private', label: 'Закрытые' },
              { id: 'mine', label: 'Мои' },
            ] as const).map((f) => (
              <button
                key={f.id}
                onClick={() => { haptic.select(); setCommunityFilter(f.id) }}
                className={cn(
                  'shrink-0 h-8 px-3.5 rounded-full text-xs font-semibold transition-all active:scale-95',
                  communityFilter === f.id
                    ? 'gradient-brand text-white shadow-[0_6px_18px_-6px_rgba(124,58,237,0.6)]'
                    : 'bg-card ring-1 ring-black/[0.05] dark:ring-white/[0.08] text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
          <AnimatePresence>
            {filteredCommunities.map((c, i) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              >
                <button
                  onClick={() => { haptic.tap(); setSelectedId(c.id) }}
                  className="group w-full text-left rounded-[26px] overflow-hidden bg-card ring-1 ring-black/[0.04] dark:ring-white/[0.07] hover:-translate-y-0.5 transition-all duration-300"
                  style={{ boxShadow: '0 12px 34px -24px rgba(15,23,42,0.35)' }}
                >
                  {/* Cover */}
                  <div className="relative h-28 overflow-hidden"
                    style={{ background: c.type === 'private' ? 'linear-gradient(135deg,#312E81,#6D28D9)' : 'linear-gradient(135deg,#065F46,#10B981)' }}>
                    {c.cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={assetUrl(c.cover)} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    )}
                    <span aria-hidden className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/15 blur-xl" />
                    <div className="absolute inset-x-4 bottom-2.5 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white backdrop-blur-md"
                        style={{ background: c.type === 'private' ? 'rgba(139,92,246,0.85)' : 'rgba(16,185,129,0.85)' }}>
                        {c.type === 'private' ? <><Lock className="h-3 w-3" /> Закрытый клуб</> : <><Globe className="h-3 w-3" /> Открытое</>}
                      </span>
                      {c.isOwner && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-100 backdrop-blur-md bg-amber-500/80">
                          <Crown className="h-3 w-3" /> Вы владелец
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Body */}
                  <div className="p-4 pt-3">
                    <h3 className="font-bold text-base leading-tight">{c.name}</h3>
                    {c.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>}
                    <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.membersCount}</span>
                      <span>{c.postsCount} объявл.</span>
                      <span className="ml-auto text-primary font-semibold inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                        Открыть <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                      </span>
                    </div>
                  </div>
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          </div>
        </>
      )}

      {!isAuthenticated && (
        <p className="text-center text-xs text-muted-foreground mt-6">
          Чтобы вступать и публиковать —{' '}
          <button onClick={openAuth} className="text-primary font-semibold underline underline-offset-2">
            войдите или зарегистрируйтесь
          </button>
        </p>
      )}
    </div>
  )
}

/* ========================================================================== */
/*  Detail — доска объявлений                                                  */
/* ========================================================================== */

function CommunityDetail({
  id, authed, isAdmin, deepLinkPostId, onBack, onRequireAuth,
}: {
  id: string
  authed: boolean
  isAdmin: boolean
  deepLinkPostId?: string | null
  onBack: () => void
  onRequireAuth: () => void
}) {
  const me = useAuthStore((s) => s.user)
  const [community, setCommunity] = useState<CommunitySummary | null>(null)
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [loading, setLoading] = useState(true)
  const [showComposer, setShowComposer] = useState(false)
  // v25.18: объявление в режиме редактирования (передаётся в Composer)
  const [editingAd, setEditingAd] = useState<CommunityPost | null>(null)
  const [showMembers, setShowMembers] = useState(false)
  // v25.19: модерация сообщества владельцем/админом прямо из приложения
  // («даже чужие сообщества» — безопасность): переименование/описание/тип + удаление.
  const [editCommunityOpen, setEditCommunityOpen] = useState(false)
  // Поиск по объявлениям + открытое объявление (полная карточка)
  const [adQuery, setAdQuery] = useState('')

  const refreshAll = useCallback(() => {
    setLoading(true)
    // v25.15: как в списке — гостю без токена запросы идут без Authorization.
    const authed = useAuthStore.getState().isAuthenticated
    Promise.all([
      api.get<{ items: CommunitySummary[] }>('/api/communities', { auth: authed }),
      // Посты закрытого клуба требуют Authorization — гостю вернётся пусто.
      api.get<{ items: CommunityPost[] }>(`/api/communities/${id}/posts`, { auth: authed }).catch(() => ({ items: [] as CommunityPost[] })),
    ])
      .then(([cs, ps]) => {
        setCommunity(cs.items.find((c) => c.id === id) || null)
        setPosts(ps.items || [])
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { refreshAll() }, [refreshAll])

  // v25.16: авто-открытие объявления из пуша (?post=<id> уже прочитан в
  // CommunityView и пришёл через deepLinkPostId).
  const [openAd, setOpenAd] = useState<CommunityPost | null>(null)
  // Заглушка-флаг: после успешного открытия линк больше не нужен.
  const [deepLinkConsumed, setDeepLinkConsumed] = useState(false)
  useEffect(() => {
    if (!deepLinkPostId || deepLinkConsumed || loading || posts.length === 0) return
    const target = posts.find((p) => p.id === deepLinkPostId)
    if (target) {
      setOpenAd(target)
      setDeepLinkConsumed(true)
    }
  }, [deepLinkPostId, deepLinkConsumed, loading, posts])

  const toggleMembership = async () => {
    if (!authed) return onRequireAuth()
    if (!community) return
    haptic.tap()
    try {
      if (community.isMember && !community.isOwner) {
        await api.post(`/api/communities/${id}/leave`, { auth: true })
        toast.success('Вы вышли из сообщества')
      } else if (!community.isMember) {
        await api.post(`/api/communities/${id}/join`, { auth: true })
        toast.success('Добро пожаловать!')
      } else return
      refreshAll()
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось выполнить')
    }
  }

  const canPost = !!community?.isMember || (isAdmin && !!community)

  // Фильтр объявлений по поисковому запросу
  const visiblePosts = (() => {
    const q = adQuery.trim().toLowerCase()
    if (!q) return posts
    return posts.filter((p) => {
      const { title, body } = splitAd(p.content)
      return (
        (title || '').toLowerCase().includes(q) ||
        body.toLowerCase().includes(q) ||
        String(p.price ?? '').includes(q) ||
        (p.contactPhone || '').replace(/[^0-9]/g, '').includes(q.replace(/[^0-9]/g, '') || '\u0000')
      )
    })
  })()

  return (
    <div className="px-4 md:px-6 lg:px-8 max-w-4xl mx-auto pb-28 md:pb-16 page-top-padding">
      {/* Top bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={onBack} aria-label="Назад" className="h-10 w-10 rounded-full grid place-items-center bg-foreground/5 hover:bg-foreground/10 active:scale-95 transition-all shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate">{community?.name || '…'}</div>
          <div className="text-[11px] text-muted-foreground">
            {community ? `${community.membersCount} участников · ${visiblePosts.length} объявлений · ${community.type === 'private' ? 'закрытое' : 'открытое'}` : ''}
          </div>
        </div>
        {!isAdmin && !community?.isOwner && community && (
          <button
            onClick={toggleMembership}
            className={cn(
              'h-10 px-4 rounded-full text-xs font-semibold text-white active:scale-95 transition-all',
              community.isMember ? 'bg-gradient-to-r from-slate-500 to-slate-600' : 'gradient-brand',
            )}
          >
            {community.isMember ? (<><LogOut className="h-3.5 w-3.5 inline mr-1 rotate-180" /> Выйти</>) : (<><UserPlus className="h-3.5 w-3.5 inline mr-1" />Вступить</>)}
          </button>
        )}
        {(community?.isOwner || isAdmin) && (
          <>
            {/* v25.19: редактировать сообщество (владелец или админ — ЛЮБОЕ,
                «чтобы я мог следить за безопасностью») */}
            <button
              onClick={() => { haptic.tap(); setEditCommunityOpen(true) }}
              aria-label="Редактировать сообщество"
              title="Редактировать сообщество"
              className="h-10 w-10 rounded-full grid place-items-center bg-foreground/5 hover:bg-primary/10 hover:text-primary text-muted-foreground active:scale-95 transition-all shrink-0"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => { haptic.tap(); setShowMembers(true) }}
              className="h-10 px-4 rounded-full text-xs font-semibold gradient-brand text-white active:scale-95 transition-all shrink-0"
            >
              <UserPlus className="h-3.5 w-3.5 inline mr-1" /> Участники
            </button>
            {isAdmin && (
              <button
                onClick={async () => {
                  if (!community) return
                  if (!confirm(`Удалить сообщество «${community.name}» вместе со всеми объявлениями?`)) return
                  try {
                    await api.delete(`/api/communities/${id}`, { auth: true })
                    toast.success('Сообщество удалено')
                    onBack()
                  } catch (e: any) {
                    toast.error(e?.message || 'Не удалось удалить')
                  }
                }}
                aria-label="Удалить сообщество"
                title="Удалить сообщество (админ)"
                className="h-10 w-10 rounded-full grid place-items-center bg-foreground/5 hover:bg-destructive/10 hover:text-destructive text-muted-foreground active:scale-95 transition-all shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* v25.19: диалог редактирования сообщества */}
      <AnimatePresence>
        {editCommunityOpen && community && (
          <EditCommunityDialog
            community={community}
            onClose={() => setEditCommunityOpen(false)}
            onSaved={() => { setEditCommunityOpen(false); refreshAll() }}
          />
        )}
      </AnimatePresence>

      {/* Description */}
      {community?.description && (
        <div className="glass rounded-3xl p-4 mb-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{community.description}</p>
        </div>
      )}

      {community?.type === 'private' && !community.isMember && !isAdmin ? (
        /* Locked */
        <div className="glass rounded-3xl p-10 text-center">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
          <p className="font-semibold mb-1">Закрытый клуб</p>
          <p className="text-sm text-muted-foreground">Оптовые цены и объявления видят только приглашённые участники. Владелец добавляет людей вручную.</p>
        </div>
      ) : (
        <>
          {/* Композер — триггер в стиле Avito «Разместить объявление» */}
          {authed && canPost && !showComposer && (
            <button
              onClick={() => { haptic.tap(); setShowComposer(true) }}
              className="w-full rounded-[22px] p-4 mb-4 flex items-center gap-3 text-left bg-card ring-1 ring-black/[0.04] dark:ring-white/[0.07] hover:ring-primary/40 transition-all group"
            >
              <Avatar className="h-9 w-9"><AvatarFallback>{(me?.displayName || '?').charAt(0)}</AvatarFallback></Avatar>
              <span className="flex-1 text-sm text-muted-foreground">Что продаёте? Добавьте объявление…</span>
              <span className="hidden sm:inline-flex h-9 px-4 rounded-full gradient-brand text-white text-xs font-bold items-center gap-1.5 group-active:scale-95 transition-transform">
                <ImagePlus className="h-3.5 w-3.5" /> Разместить
              </span>
            </button>
          )}

          <AnimatePresence>
            {showComposer && (
              <Composer
                communityId={id!}
                initial={editingAd}
                onClose={() => { setShowComposer(false); setEditingAd(null) }}
                onPosted={() => {
                  const wasEdit = !!editingAd
                  setShowComposer(false)
                  setEditingAd(null)
                  refreshAll()
                  toast.success(wasEdit ? 'Объявление обновлено!' : 'Объявление опубликовано!')
                }}
              />
            )}
          </AnimatePresence>

          {/* Поиск по объявлениям */}
          {posts.length > 3 && (
            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                value={adQuery}
                onChange={(e) => setAdQuery(e.target.value)}
                placeholder="Искать в объявлениях…"
                className="w-full h-11 pl-10 pr-9 rounded-full bg-card ring-1 ring-black/[0.05] dark:ring-white/[0.08] outline-none focus:ring-2 focus:ring-primary/40 transition-all text-sm"
              />
              {adQuery && (
                <button onClick={() => setAdQuery('')} aria-label="Очистить" className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:bg-accent">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Лента объявлений */}
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-64 rounded-[26px] skeleton" />)}
            </div>
          ) : visiblePosts.length === 0 ? (
            <div className="text-center py-14">
              <Camera className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium">
                {adQuery ? 'Ничего не найдено' : 'Пока нет объявлений'}
              </p>
              <p className="text-xs text-muted-foreground">
                {adQuery ? 'Попробуйте другой запрос' : 'Будьте первым — разместите объявление!'}
              </p>
            </div>
          ) : (
            /* Avito-сетка карточек */
            <div className="grid gap-4 sm:grid-cols-2">
              {visiblePosts.map((p, i) => (
                <AdCard
                  key={p.id}
                  post={p}
                  idx={i}
                  onOpen={() => { haptic.tap(); setOpenAd(p) }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Полная карточка объявления */}
      <AnimatePresence>
        {openAd && (
          <AdDetailModal
            post={openAd}
            authed={authed}
            isAdmin={isAdmin}
            meId={me?.id}
            onClose={() => setOpenAd(null)}
            onRequireAuth={onRequireAuth}
            onDelete={async () => {
              try {
                await api.delete(`/api/communities/posts/${openAd.id}`, { auth: true })
                toast.success('Объявление удалено')
                setOpenAd(null)
                refreshAll()
              } catch (e: any) { toast.error(e?.message || 'Ошибка') }
            }}
            onEdit={() => {
              // v25.18: редактирование своего объявления — открываем композер
              // с предзаполненными полями
              setEditingAd(openAd)
              setOpenAd(null)
              setShowComposer(true)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        )}
      </AnimatePresence>

      {/* Members manager drawer (owner/admin) */}
      {showMembers && (
        <MembersManager communityId={id} isPrivate={community?.type === 'private'} onClose={() => { setShowMembers(false); refreshAll() }} />
      )}
    </div>
  )
}

// v25.14: цены могут быть дробными (2.5 ₽ за шт для опта) — не округляем.
function formatPostPrice(v: number): string {
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v)} ₽`
}

/* ========================================================================== */
/*  AdCard — карточка объявления в стиле Avito                                 */
/* ========================================================================== */

function AdCard({ post, idx, onOpen }: { post: CommunityPost; idx: number; onOpen: () => void }) {
  const { title, body } = splitAd(post.content)
  const cover = post.images[0] ? assetUrl(post.images[0]) : null

  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(idx * 0.05, 0.35), ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.985 }}
      onClick={onOpen}
      className="group text-left rounded-[26px] overflow-hidden bg-card ring-1 ring-black/[0.04] dark:ring-white/[0.07] hover:-translate-y-0.5 transition-all duration-300 flex flex-col"
      style={{ boxShadow: '0 14px 38px -26px rgba(15,23,42,0.35)' }}
    >
      {/* Cover — v25.18: формат 3:4 (Avito-стиль) */}
      <div className="relative aspect-[3/4] bg-muted overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="h-full w-full grid place-items-center bg-gradient-to-br from-pink-500/8 via-violet-500/8 to-orange-400/10">
            <Camera className="h-9 w-9 text-muted-foreground/30" />
          </div>
        )}

        {/* Кол-во фото */}
        {post.images.length > 1 && (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/55 backdrop-blur text-white text-[10px] font-bold">
            <Camera className="h-3 w-3" /> {post.images.length}
          </span>
        )}

        {/* v25.16: счётчик комментариев на карточке — видно «есть обсуждение» */}
        {(post.commentsCount ?? 0) > 0 && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/55 backdrop-blur text-white text-[10px] font-bold">
            <MessageCircle className="h-3 w-3" /> {post.commentsCount}
          </span>
        )}

        {/* Цена поверх обложки — как на классических досках */}
        {post.price != null && (
          <span className="absolute left-2.5 bottom-2.5 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-md text-white font-extrabold text-base tracking-tight">
            {formatPostPrice(post.price)}
            <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide text-white/70">опт от тиража</span>
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col p-4 pt-3">
        {title && <h3 className="font-bold text-[15px] leading-snug line-clamp-1">{title}</h3>}
        <p className={cn('text-xs text-muted-foreground leading-relaxed line-clamp-2', title ? 'mt-1' : '')}>
          {body || 'Смотрите фото и звоните'}
        </p>

        {/* Автор + время */}
        <div className="mt-auto pt-3 flex items-center gap-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src={assetUrl(post.author.avatar)} />
            <AvatarFallback className="text-[10px] gradient-brand text-white">{(post.author.displayName || post.author.username || '?').charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-[11px] font-semibold truncate max-w-[120px]">{post.author.displayName || post.author.username}</span>
          <span className="text-[11px] text-muted-foreground">· {timeAgo(post.createdAt)}</span>

          {post.author.role === 'admin' && (
            <span className="ml-auto text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full gradient-brand text-white shrink-0">
              Продавец
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}

/* ========================================================================== */
/*  AdDetailModal — полная карточка объявления со свайп-каруселью фото         */
/* ========================================================================== */

function AdDetailModal({
  post,
  authed,
  isAdmin,
  meId,
  onClose,
  onRequireAuth,
  onDelete,
  onEdit,
}: {
  post: CommunityPost
  authed: boolean
  isAdmin: boolean
  meId?: string
  onClose: () => void
  onRequireAuth: () => void
  onDelete: () => void
  // v25.18: редактирование своего объявления
  onEdit?: () => void
}) {
  const { title, body } = splitAd(post.content)
  const imgs = post.images
  const hasMulti = imgs.length > 1

  // Карусель со свайпом (touch) + стрелки (desktop)
  const [idx, setIdx] = useState(0)
  const startX = useRef<number | null>(null)

  // Esc закрывает модалку
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canDelete = isAdmin || post.author.id === meId

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[540] bg-background overflow-y-auto overscroll-contain"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div className="max-w-lg md:max-w-2xl mx-auto min-h-full pb-24">
        {/* Верхняя панель */}
        <div
          className="sticky top-0 z-20 flex items-center gap-2 px-4 py-2.5 backdrop-blur-xl bg-background/85 border-b border-border/40"
          style={{ paddingTop: 'max(env(safe-area-inset-top,0px),0.65rem)' }}
        >
          <button onClick={() => { haptic.tap(); onClose() }} aria-label="Назад" className="h-9 w-9 rounded-full grid place-items-center bg-foreground/5 hover:bg-foreground/10 active:scale-95 transition-all">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
          <span className="text-sm font-bold truncate flex-1">{title || 'Объявление'}</span>
          {/* v25.18: редактирование своего объявления (админ — любого) */}
          {(post.author.id === meId || isAdmin) && onEdit && (
            <button onClick={() => { haptic.tap(); onEdit() }} aria-label="Редактировать объявление" title="Редактировать" className="h-9 w-9 rounded-full grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button onClick={() => { haptic.tap(); onDelete() }} aria-label="Удалить объявление" className="h-9 w-9 rounded-full grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* КАРУСЕЛЬ ФОТО — свайпы как в товаре */}
        <div
          className="relative select-none"
          onTouchStart={(e) => { startX.current = e.touches[0].clientX }}
          onTouchEnd={(e) => {
            if (!hasMulti || startX.current === null) return
            const dx = e.changedTouches[0].clientX - startX.current
            if (Math.abs(dx) > 40) {
              if (dx < 0 && idx < imgs.length - 1) { setIdx((i) => i + 1); haptic.select() }
              else if (dx > 0 && idx > 0) { setIdx((i) => i - 1); haptic.select() }
            }
            startX.current = null
          }}
        >
          {/* v25.18 (owner): фото объявлений — формат 3:4 (Avito-стиль) */}
          <div className="aspect-[3/4] overflow-hidden bg-muted relative">
            <div
              className="flex h-full transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${idx * 100}%)` }}
            >
              {imgs.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={assetUrl(src)}
                  alt={`${title || 'Объявление'} — фото ${i + 1}`}
                  className="h-full w-full object-cover shrink-0"
                  draggable={false}
                  loading={i <= 1 ? 'eager' : 'lazy'}
                />
              ))}
            </div>
          </div>

          {/* Стрелки (desktop) */}
          {hasMulti && (
            <>
              <button
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
                aria-label="Предыдущее фото"
                className="hidden md:grid absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/85 backdrop-blur place-items-center disabled:opacity-0 shadow-md"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setIdx((i) => Math.min(imgs.length - 1, i + 1))}
                disabled={idx === imgs.length - 1}
                aria-label="Следующее фото"
                className="hidden md:grid absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/85 backdrop-blur place-items-center disabled:opacity-0 shadow-md"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}

          {/* Точки */}
          {hasMulti && (
            <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {imgs.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  aria-label={`Фото ${i + 1}`}
                  className={cn('h-1.5 rounded-full transition-all', i === idx ? 'w-5 bg-white' : 'w-1.5 bg-white/50')}
                />
              ))}
            </div>
          )}
        </div>

        {/* Контент */}
        <div className="px-4 pt-4 space-y-4">
          {/* Цена + бейдж */}
          {post.price != null && (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span
                className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg,#EC4899 0%,#A855F7 60%,#FB923C 120%)' }}
              >
                {formatPostPrice(post.price)}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-400">
                опт от тиража
              </span>
            </div>
          )}

          {/* Автор */}
          <div className="flex items-center gap-2.5">
            <Avatar className="h-10 w-10">
              <AvatarImage src={assetUrl(post.author.avatar)} />
              <AvatarFallback className="gradient-brand text-white text-sm">{(post.author.displayName || post.author.username || '?').charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-sm font-bold truncate flex items-center gap-1.5">
                {post.author.displayName || post.author.username}
                {post.author.role === 'admin' && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full gradient-brand text-white">Продавец</span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">{timeAgo(post.createdAt)}</div>
            </div>
          </div>

          {/* Описание */}
          {body && (
            <div>
              <h2 className="text-sm font-extrabold mb-1.5">Описание</h2>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{body}</p>
            </div>
          )}

          {/* Контакты — все способы связи автора объявления (v25.16) */}
          {hasAnyContact(post) && <ContactButtons post={post} title={title} />}

          {/* ═══ v25.16: КОММЕНТАРИИ К ОБЪЯВЛЕНИЮ — обсуждение с ответами.
              Автор объявления и авторы комментов получают push при ответах. */}
          <AdComments postId={post.id} authed={authed} isAdmin={isAdmin} meId={meId} onRequireAuth={onRequireAuth} />
        </div>
      </div>
    </motion.div>
  )
}

// v25.16: есть ли хоть один контакт для связи в объявлении?
function hasAnyContact(post: CommunityPost): boolean {
  return !!(post.contactPhone || post.contactWhatsApp || post.contactTelegram)
}

/* ---------- контактные кнопки объявления ---------- */

function ContactButtons({ post, title }: { post: CommunityPost; title: string | null }) {
  // v25.16: Три канала — Позвонить / WhatsApp / Telegram. Ссылки берём из
  // полей самого объявления (человек сам решает, какой контакт указать).
  const wa = waHref(post.contactWhatsApp, title)
  const tg = tgHref(post.contactTelegram)
  if (!post.contactPhone && !wa && !tg) return null
  const btnCls = 'flex items-center justify-center gap-2 h-11 rounded-2xl text-white text-xs font-bold active:scale-95 transition-transform'
  return (
    <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
      <h2 className="text-sm font-bold mb-3">Связаться по объявлению</h2>
      <div className="grid grid-cols-2 gap-2">
        {post.contactPhone && (
          <a
            href={telHref(post.contactPhone)}
            onClick={() => haptic.tap()}
            className={`${btnCls} bg-emerald-500`}
          >
            <Phone className="h-4 w-4" /> Позвонить
          </a>
        )}
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => haptic.tap()}
            className={`${btnCls} bg-[#25D366] ${!post.contactPhone ? 'col-span-2' : ''}`}
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        )}
        {tg && (
          <a
            href={tg}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => haptic.tap()}
            className={`${btnCls} bg-[#229ED9] col-span-2`}
          >
            <Send className="h-4 w-4" /> Telegram
          </a>
        )}
      </div>
    </div>
  )
}

/* ========================================================================== */
/*  AdComments — комментарии к объявлению с ответами (v25.16)                  */
/*  · Любой участник пишет комментарий / отвечает («Ответить»).                */
/*  · Автор объявления и авторы комментов получают push (бэкенд).              */
/*  · Гость при попытке написать → открывается окно входа.                     */
/* ========================================================================== */

function AdComments({
  postId,
  authed,
  isAdmin,
  meId,
  onRequireAuth,
}: {
  postId: string
  authed: boolean
  isAdmin?: boolean
  meId?: string
  onRequireAuth: () => void
}) {
  const [items, setItems] = useState<AdComment[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null)

  const load = useCallback(() => {
    // v25.15-pattern: гостю запрос идёт без Authorization.
    const isAuthed = useAuthStore.getState().isAuthenticated
    api.get<{ items: AdComment[] }>(`/api/communities/posts/${postId}/comments`, { auth: isAuthed })
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [postId])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!text.trim()) return
    if (!authed) {
      onRequireAuth()
      toast.info('Войдите, чтобы прокомментировать')
      return
    }
    setBusy(true)
    haptic.tap()
    try {
      await api.post(`/api/communities/posts/${postId}/comments`, {
        json: { content: text.trim(), parentId: replyTo?.id ?? undefined },
        auth: true,
      })
      haptic.success()
      setText('')
      setReplyTo(null)
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось отправить комментарий')
    } finally {
      setBusy(false)
    }
  }

  const deleteComment = async (id: string) => {
    try {
      await api.delete(`/api/communities/comments/${id}`, { auth: true })
      load()
      toast.success('Комментарий удалён')
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка')
    }
  }

  // v25.17: редактирование СВОЕГО комментария (и админом — любого).
  const saveEdit = async (id: string, content: string) => {
    try {
      await api.patch(`/api/communities/comments/${id}`, { json: { content }, auth: true })
      load()
      toast.success('Комментарий обновлён')
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось сохранить')
    }
  }

  return (
    <div>
      <h2 className="text-sm font-extrabold flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        Комментарии
        {!loading && items.length > 0 && (
          <span className="text-xs font-semibold text-muted-foreground">{items.length}</span>
        )}
      </h2>

      {/* Список */}
      {loading ? (
        <div className="space-y-2 mt-3">
          <div className="h-12 rounded-2xl skeleton" />
          <div className="h-12 rounded-2xl skeleton" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-2.5">
          Пока никто не оставил комментарий — начните обсуждение.
        </p>
      ) : (
        <div className="mt-3 space-y-3.5">
          {items.map((c) => (
            <div key={c.id}>
              <CommentRow
                comment={c}
                meId={meId}
                isAdmin={isAdmin}
                onReply={() => setReplyTo({ id: c.id, author: c.author?.displayName || c.author?.username || 'автора' })}
                onDelete={c.author?.id === meId || isAdmin ? () => deleteComment(c.id) : undefined}
                onEditSave={c.author?.id === meId || isAdmin ? (content) => saveEdit(c.id, content) : undefined}
              />
              {!!c.replies?.length && (
                <div className="mt-2 ml-8 space-y-2">
                  {c.replies.map((rep) => (
                    <CommentRow
                      key={rep.id}
                      comment={rep}
                      meId={meId}
                      compact
                      // v25.24: ответить можно на ЛЮБОЙ ответ (вложенность без ограничений)
                      onReply={() => setReplyTo({ id: rep.id, author: rep.author?.displayName || rep.author?.username || 'автора' })}
                      onDelete={rep.author?.id === meId || isAdmin ? () => deleteComment(rep.id) : undefined}
                      onEditSave={rep.author?.id === meId || isAdmin ? (content) => saveEdit(rep.id, content) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Поле ввода */}
      <div className="mt-3.5 rounded-[20px] bg-card ring-1 ring-black/[0.05] dark:ring-white/[0.08] p-2.5">
        {replyTo && (
          <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
            <CornerDownRight className="h-3 w-3 text-primary shrink-0" />
            <span className="text-[11px] text-muted-foreground truncate">
              Ответ для <b className="text-foreground">{replyTo.author}</b>
            </span>
            <button onClick={() => setReplyTo(null)} aria-label="Отменить" className="ml-auto h-5 w-5 rounded-full grid place-items-center hover:bg-accent">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            onFocus={() => { if (!authed) { onRequireAuth(); toast.info('Войдите, чтобы прокомментировать') } }}
            readOnly={!authed}
            placeholder={authed ? (replyTo ? `Ответить ${replyTo.author}…` : 'Задать вопрос по объявлению…') : 'Войдите, чтобы комментировать'}
            rows={1}
            maxLength={2000}
            className="flex-1 resize-none bg-transparent outline-none text-sm min-h-[36px] max-h-24 placeholder:text-muted-foreground/70"
          />
          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            aria-label="Отправить"
            className="h-9 w-9 rounded-full grid place-items-center gradient-brand text-white disabled:opacity-40 active:scale-95 transition-all shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function CommentRow({
  comment,
  meId,
  compact,
  isAdmin,
  onReply,
  onDelete,
  onEditSave,
}: {
  comment: AdComment
  meId?: string
  compact?: boolean
  isAdmin?: boolean
  onReply?: () => void
  onDelete?: () => void
  // v25.17: если задан — комментарий можно отредактировать (инлайн-режим).
  onEditSave?: (content: string) => Promise<void> | void
}) {
  const name = comment.author?.displayName || comment.author?.username || 'Участник'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.content)
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setDraft(comment.content)
    setEditing(true)
  }

  const submitEdit = async () => {
    const content = draft.trim()
    if (!content || !onEditSave) return
    setSaving(true)
    try {
      await onEditSave(content)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex gap-2.5">
      <Avatar className={compact ? 'h-6 w-6' : 'h-7 w-7'}>
        <AvatarImage src={assetUrl(comment.author?.avatar)} />
        <AvatarFallback className="gradient-brand text-white text-[9px]">{name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md bg-accent/40 px-3 py-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-xs truncate">{name}</span>
            {/* v25.24: признак «ответ X» для вложенных ответов (глубина ≥ 2) */}
            {(comment as any).replyToName && (comment as any).replyToId && (comment as any).parentId !== (comment as any).replyToId && (
              <span className="text-[9.5px] text-muted-foreground truncate max-w-[110px]">↩ {(comment as any).replyToName}</span>
            )}
            {comment.author?.role === 'admin' && (
              <span className="text-[8px] font-bold uppercase tracking-wide px-1 py-px rounded-full gradient-brand text-white">Продавец</span>
            )}
            {comment.edited && (
              <span className="text-[9px] italic text-muted-foreground/80">изменён</span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(comment.createdAt)}</span>
          </div>
          {editing ? (
            <div className="mt-1.5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit() }
                  if (e.key === 'Escape') setEditing(false)
                }}
                rows={2}
                maxLength={2000}
                autoFocus
                className="w-full resize-none rounded-xl bg-background ring-1 ring-primary/30 outline-none text-[13px] leading-snug p-2 min-h-[56px] max-h-32"
              />
              <div className="flex items-center justify-end gap-2 mt-1.5">
                <button
                  onClick={() => setEditing(false)}
                  className="text-[11px] font-semibold text-muted-foreground hover:text-foreground px-2 py-1"
                >
                  Отмена
                </button>
                <button
                  onClick={submitEdit}
                  disabled={saving || !draft.trim()}
                  className="text-[11px] font-bold text-white gradient-brand rounded-full px-3 py-1 disabled:opacity-40"
                >
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </div>
          ) : (
            <CollapsibleText
              text={comment.content}
              maxLines={5}
              className="text-[13px] leading-snug mt-0.5 whitespace-pre-line text-foreground/90"
            />
          )}
        </div>
        {(onReply || onDelete || onEditSave) && !editing && (
          <div className="flex items-center gap-3 mt-1 pl-1">
            {onReply && (
              <button onClick={onReply} className="text-[11px] font-semibold text-muted-foreground hover:text-primary transition-colors">
                Ответить
              </button>
            )}
            {onEditSave && (
              <button onClick={startEdit} className="text-[11px] font-semibold text-muted-foreground hover:text-primary transition-colors">
                Изменить
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} className="text-[11px] text-muted-foreground hover:text-destructive transition-colors">
                Удалить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Composer — форма объявления ---------- */

// v25.19: редактирование сообщества (название / описание / тип).
// Доступно владельцу и АДМИНУ (модерация «чужих» сообществ — безопасность).
function EditCommunityDialog({
  community,
  onClose,
  onSaved,
}: {
  community: CommunitySummary
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(community.name)
  const [description, setDescription] = useState(community.description || '')
  const [type, setType] = useState<'public' | 'private'>(community.type)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) { toast.error('Введите название'); return }
    setSaving(true)
    try {
      await api.patch(`/api/communities/${community.id}`, {
        json: { name: name.trim(), description: description.trim() || null, type },
        auth: true,
      })
      toast.success('Сообщество обновлено')
      onSaved()
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[530] bg-black/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-card p-5 pb-8 sm:pb-5 space-y-3"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Редактировать сообщество</h3>
          <button onClick={onClose} aria-label="Закрыть" className="h-8 w-8 rounded-full grid place-items-center hover:bg-accent/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Название</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="w-full h-11 rounded-2xl bg-background/70 border border-border/60 focus:border-primary/50 outline-none px-3.5 text-sm font-semibold"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Описание</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={400}
            className="w-full rounded-2xl bg-background/70 border border-border/60 focus:border-primary/50 outline-none resize-none px-3.5 py-3 text-sm min-h-[76px]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Тип</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setType('public')}
              className={cn(
                'h-11 rounded-2xl text-xs font-semibold border transition-all flex items-center justify-center gap-1.5',
                type === 'public' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-border/60 text-muted-foreground',
              )}
            >
              <Globe className="h-4 w-4" /> Открытое
            </button>
            <button
              onClick={() => setType('private')}
              className={cn(
                'h-11 rounded-2xl text-xs font-semibold border transition-all flex items-center justify-center gap-1.5',
                type === 'private' ? 'border-violet-500/60 bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'border-border/60 text-muted-foreground',
              )}
            >
              <Lock className="h-4 w-4" /> Закрытое
            </button>
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full h-11 rounded-2xl gradient-brand text-white text-sm font-bold active:scale-[0.98] disabled:opacity-50 transition-all"
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </motion.div>
    </motion.div>
  )
}

function Composer({ communityId, initial, onClose, onPosted }: {
  communityId: string
  // v25.18: режим редактирования — если передано существующее объявление,
  // форма предзаполняется и сохранение идёт через PATCH.
  initial?: CommunityPost | null
  onClose: () => void
  onPosted: () => void
}) {
  // v25.15: Название теперь отдельное поле (первая строка content в БД).
  const parsedInitial = initial ? splitAd(initial.content) : null
  const [title, setTitle] = useState(parsedInitial?.title || '')
  const [content, setContent] = useState(parsedInitial?.body || '')
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : '')
  const [phone, setPhone] = useState(initial?.contactPhone || '')
  // v25.16: контакты для обратной связи в объявлении (Avito-стиль)
  const [whatsapp, setWhatsapp] = useState(initial?.contactWhatsApp || '')
  const [telegram, setTelegram] = useState(initial?.contactTelegram || '')
  const [images, setImages] = useState<string[]>(initial?.images || [])
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const uploadImages = async (files: FileList) => {
    const max = 8 - images.length
    const list = Array.from(files).slice(0, Math.max(max, 0))
    for (const f of list) {
      const fd = new FormData()
      fd.append('file', f)
      try {
        const d = await api.post<{ url: string }>('/api/upload', { form: fd, auth: true })
        setImages((cur) => [...cur, d.url].slice(0, 8))
      } catch (e: any) {
        toast.error(e?.message || 'Не удалось загрузить фото')
      }
    }
  }

  const submit = async () => {
    if (!title.trim()) { toast.error('Дайте объявлению название'); return }
    if (!content.trim()) { toast.error('Добавьте описание'); return }
    setSubmitting(true)
    haptic.tap()
    try {
      // Первая строка = заголовок (parseable обратно через splitAd)
      const composed = `${title.trim()}\n${content.trim()}`
      const payload = {
        content: composed,
        images,
        price: price ? Number(price.replace(',', '.')) : undefined,
        contactPhone: phone.trim() || undefined,
        // v25.16: обратная связь — чтобы по объявлению можно было связаться
        contactWhatsApp: whatsapp.trim() || undefined,
        contactTelegram: telegram.trim().replace(/^@/, '') || undefined,
      }
      if (initial) {
        // v25.18: редактирование СВОЕГО объявления
        await api.patch(`/api/communities/posts/${initial.id}`, { json: payload, auth: true })
        haptic.success()
        onPosted()
      } else {
        await api.post(`/api/communities/${communityId}/posts`, { json: payload, auth: true })
        haptic.success()
        onPosted()
      }
    } catch (e: any) {
      toast.error(e?.message || (initial ? 'Не удалось сохранить' : 'Не удалось опубликовать'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
      <div className="glass rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{initial ? 'Редактировать объявление' : 'Новое объявление'}</h3>
          <button onClick={onClose} aria-label="Закрыть" className="h-8 w-8 rounded-full grid place-items-center hover:bg-accent/60"><X className="h-4 w-4" /></button>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название — например: Брелоки с логотипом, от 100 шт"
          maxLength={90}
          className="w-full h-11 rounded-2xl bg-background/70 border border-border/60 focus:border-primary/50 outline-none px-3.5 text-sm font-semibold"
        />

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Описание: что внутри, материал, сроки, условия опта…"
          rows={4}
          maxLength={5000}
          className="w-full rounded-2xl bg-background/70 border border-border/60 focus:border-primary/50 outline-none resize-none px-3.5 py-3 text-sm min-h-[92px]"
        />

        {/* Previews */}
        {images.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {images.map((src, i) => (
              <div key={i} className="relative h-16 w-16 rounded-xl overflow-hidden group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetUrl(src)} alt="" className="h-full w-full object-cover" />
                <button
                  onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
                  className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white grid place-items-center"
                  aria-label="Убрать фото"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => e.target.files && uploadImages(e.target.files)}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => fileRef.current?.click()} className="h-10 px-3.5 rounded-2xl bg-accent/50 hover:bg-accent text-xs font-semibold inline-flex items-center gap-1.5 transition-colors">
            <ImagePlus className="h-4 w-4" /> Фото ({images.length}/8)
          </button>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d,.]/g, ''))}
            inputMode="decimal"
            placeholder="Цена ₽ (необяз.)"
            className="h-10 w-28 rounded-2xl bg-background/70 border border-border/60 outline-none focus:border-primary/50 px-3 text-xs"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="Телефон для связи"
            className="h-10 flex-1 min-w-[140px] rounded-2xl bg-background/70 border border-border/60 outline-none focus:border-primary/50 px-3 text-xs"
          />
        </div>

        {/* v25.16: обратная связь — контакты автора объявления.
            Достаточно одного из способов — покупатель свяжется как удобно. */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            inputMode="tel"
            placeholder="WhatsApp · номер или ссылка (необяз.)"
            className="h-10 flex-1 min-w-[140px] rounded-2xl bg-background/70 border border-border/60 outline-none focus:border-emerald-500/60 px-3 text-xs"
          />
          <input
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="Telegram · @ник (необяз.)"
            className="h-10 flex-1 min-w-[120px] rounded-2xl bg-background/70 border border-border/60 outline-none focus:border-sky-500/60 px-3 text-xs"
          />
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={submit}
            disabled={submitting}
            className="h-10 px-4 rounded-2xl gradient-brand text-white text-xs font-bold active:scale-95 disabled:opacity-50 transition-all inline-flex items-center gap-1.5"
          >
            <Send className="h-3.5 w-3.5" /> {initial ? 'Сохранить' : 'Опубликовать'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

/* ---------- Members manager (owner / admin) ---------- */

function MembersManager({ communityId, isPrivate, onClose }: { communityId: string; isPrivate?: boolean; onClose: () => void }) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    api.get<{ items: MemberRow[] }>(`/api/communities/${communityId}/members`, { auth: true })
      .then((d) => setMembers(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [communityId])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (query.trim().length < 3) { toast.error('Логин, email или телефон участника'); return }
    setBusy(true)
    try {
      await api.post(`/api/communities/${communityId}/members`, { json: { query: query.trim() }, auth: true })
      toast.success('Участник добавлен')
      setQuery('')
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось добавить')
    } finally { setBusy(false) }
  }

  const remove = async (userId: string) => {
    try {
      await api.delete(`/api/communities/${communityId}/members/${userId}`, { auth: true })
      toast.success('Исключён')
      load()
    } catch (e: any) { toast.error(e?.message || 'Ошибка') }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[520] bg-background overflow-y-auto">
      <div className="max-w-md mx-auto px-4 pb-20" style={{ paddingTop: 'max(env(safe-area-inset-top,0px),24px)' }}>
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => { onClose() }} aria-label="Назад" className="h-10 w-10 rounded-full grid place-items-center bg-foreground/5 hover:bg-foreground/10"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <div className="font-bold">Участники ({members.length})</div>
            {isPrivate && <div className="text-[11px] text-muted-foreground">Добавляйте оптовиков по логину / email / телефону</div>}
          </div>
        </div>

        {/* Add form */}
        <div className="glass rounded-2xl p-3 mb-4 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0 ml-1" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="username / email / +7…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button onClick={add} disabled={busy} className="h-9 px-3.5 rounded-xl gradient-brand text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1">
            <UserPlus className="h-3.5 w-3.5" /> Добавить
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 rounded-2xl skeleton" />)}</div>
        ) : (
          <div className="space-y-1.5">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 p-2.5 rounded-2xl bg-card ring-1 ring-border/50">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={assetUrl(m.avatar)} />
                  <AvatarFallback>{(m.displayName || m.username || '?').charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                    {m.displayName || m.username}
                    {m.role === 'owner' && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground">@{m.username}</div>
                </div>
                {m.role !== 'owner' && (
                  <button onClick={() => remove(m.userId)} aria-label="Исключить" className="h-8 w-8 rounded-full grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
