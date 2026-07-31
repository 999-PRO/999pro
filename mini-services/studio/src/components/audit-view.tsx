'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
// v13.1 (audit P2-13 fix): use shared timeAgo instead of duplicating it locally.
import { timeAgo } from '@/lib/utils'
import {
  Activity, Eye, FileEdit, Settings, ShoppingBag,
  Trash2, UserPlus, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'

// Inline Skeleton — Studio doesn't have a shared skeleton component yet.
function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className || ''}`} aria-hidden />
}
function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// AuditView — Studio admin view that shows recent admin actions.
// Reads from /api/audit (admin-only).
// ============================================================================

interface AuditEntry {
  id: string
  userId: string | null
  user: { id: string; username: string; displayName: string | null; role: string } | null
  entity: string
  entityId: string | null
  action: string
  snapshot: { before?: unknown; after?: unknown; count?: number; ids?: string[] }
  ip: string | null
  userAgent: string | null
  createdAt: string
}

interface AuditStats {
  byEntity: { entity: string; count: number }[]
  byAction: { action: string; count: number }[]
  last24h: number
  total: number
}

const ENTITY_ICONS: Record<string, typeof Activity> = {
  product: ShoppingBag,
  banner: Activity,
  story: Eye,
  lead: FileEdit,
  order: ShoppingBag,
  user: UserPlus,
  review: FileEdit,
  post: FileEdit,
  settings: Settings,
  audit: Activity,
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  status_change: 'Смена статуса',
  bulk_delete: 'Массовое удаление',
}

const ENTITY_LABELS: Record<string, string> = {
  product: 'Товар',
  banner: 'Баннер',
  story: 'Сторис',
  lead: 'Заявка',
  order: 'Заказ',
  user: 'Пользователь',
  review: 'Отзыв',
  post: 'Публикация',
  settings: 'Настройки',
  audit: 'Аудит',
}

export function AuditView() {
  const token = useAuthStore((s) => s.token)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterEntity, setFilterEntity] = useState<string | undefined>(undefined)
  const [filterAction, setFilterAction] = useState<string | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const limit = 50

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const query: Record<string, string | number | undefined> = { limit, offset }
      if (filterEntity) query.entity = filterEntity
      if (filterAction) query.action = filterAction
      const data = await api.get<{ items: AuditEntry[]; total: number }>('/api/audit', {
        auth: true,
        query,
      })
      setEntries(data.items)
      setTotal(data.total)
    } catch (e) {
      // S-LOW-008: was `catch { setEntries([]) }` — silent failure.
      // Log the error so we can diagnose backend/network issues.
      console.error('[audit-view] fetchEntries failed:', e)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [filterEntity, filterAction, offset, token])

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<AuditStats>('/api/audit/stats', { auth: true })
      setStats(data)
    } catch (e) {
      // S-LOW-008: was `catch { setStats(null) }` — silent failure.
      // Log the error so we can diagnose backend/network issues.
      console.error('[audit-view] fetchStats failed:', e)
      setStats(null)
    }
  }, [token])

  useEffect(() => {
    void fetchEntries()
    void fetchStats()
  }, [fetchEntries, fetchStats])

  // v13.1 (audit P2-13 fix): use shared timeAgo from utils.ts instead of
  // the local formatTime duplicate. For older entries (>7 days), timeAgo
  // returns just the date — we wrap it to add time for those cases.
  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffHrs = (now.getTime() - d.getTime()) / 3600000
    if (diffHrs < 24) return timeAgo(iso)
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Журнал действий</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Все действия администраторов записываются для аудита и отладки.
        </p>
      </div>

      {/* Stats cards — compact row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div className="rounded-2xl glass p-3.5">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Всего</div>
            <div className="text-xl font-extrabold">{stats.total.toLocaleString('ru-RU')}</div>
          </div>
          <div className="rounded-2xl glass p-3.5">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">За 24 ч</div>
            <div className="text-xl font-extrabold text-primary">{stats.last24h.toLocaleString('ru-RU')}</div>
          </div>
          <div className="rounded-2xl glass p-3.5">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Сущностей</div>
            <div className="text-xl font-extrabold">{stats.byEntity.length}</div>
          </div>
          <div className="rounded-2xl glass p-3.5">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Действий</div>
            <div className="text-xl font-extrabold">{stats.byAction.length}</div>
          </div>
        </div>
      )}

      {/* Filters — clean chip row */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => { setFilterEntity(undefined); setOffset(0) }}
          className={`h-8 px-3 rounded-full text-xs font-semibold transition-all ${
            !filterEntity ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
          type="button"
        >
          Все
        </button>
        {stats?.byEntity.map((e) => (
          <button
            key={e.entity}
            onClick={() => { setFilterEntity(e.entity); setOffset(0) }}
            className={`h-8 px-3 rounded-full text-xs font-semibold transition-all ${
              filterEntity === e.entity ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
            type="button"
          >
            {ENTITY_LABELS[e.entity] || e.entity} ({e.count})
          </button>
        ))}
        <div className="w-px bg-border mx-1" />
        {stats?.byAction.map((a) => (
          <button
            key={a.action}
            onClick={() => { setFilterAction(a.action); setOffset(0) }}
            className={`h-8 px-3 rounded-full text-xs font-semibold transition-all ${
              filterAction === a.action
                ? a.action === 'delete' || a.action === 'bulk_delete'
                  ? 'bg-destructive text-white'
                  : 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
            type="button"
          >
            {ACTION_LABELS[a.action] || a.action}
          </button>
        ))}
      </div>

      {/* Entries list — clean timeline */}
      <div className="rounded-2xl glass overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Записи</span>
          </div>
          <span className="text-xs text-muted-foreground">{total} всего</span>
        </div>

        {loading ? (
          <div className="p-4"><SkeletonRows count={6} /></div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center">
            <div className="h-16 w-16 rounded-2xl bg-amber-500/10 mx-auto mb-3 grid place-items-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" strokeWidth={1.5} />
            </div>
            <h3 className="font-semibold text-sm mb-1">Записей нет</h3>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Действия администраторов появятся здесь после выполнения.
            </p>
          </div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            <div className="divide-y divide-border/20">
              {entries.map((entry) => {
                const Icon = ENTITY_ICONS[entry.entity] || Activity
                const isDelete = entry.action === 'delete' || entry.action === 'bulk_delete'
                const isCreate = entry.action === 'create'
                const isUpdate = entry.action === 'update'
                return (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-3 hover:bg-accent/20 transition-colors">
                    {/* Icon — color-coded by action type */}
                    <div className={`h-9 w-9 rounded-xl grid place-items-center shrink-0 ${
                      isDelete
                        ? 'bg-destructive/10 text-destructive'
                        : isCreate
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : isUpdate
                            ? 'bg-sky-500/10 text-sky-500'
                            : 'bg-primary/10 text-primary'
                    }`}>
                      {isDelete ? <Trash2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">
                          {ACTION_LABELS[entry.action] || entry.action}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ENTITY_LABELS[entry.entity] || entry.entity}
                        </span>
                        {entry.entityId && (
                          <code className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                            {entry.entityId.slice(0, 8)}
                          </code>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {entry.user?.displayName || entry.user?.username || 'Система'}
                        {entry.ip && ` · ${entry.ip}`}
                      </div>
                      {/* Status change indicator */}
                      {entry.action === 'status_change' && !!entry.snapshot.before && !!entry.snapshot.after && (
                        <div className="text-xs mt-1 flex items-center gap-1.5">
                          <code className="px-1.5 py-0.5 rounded bg-muted">{String((entry.snapshot.before as Record<string, unknown>)?.status || '')}</code>
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          <code className="px-1.5 py-0.5 rounded bg-primary/10 text-primary">{String((entry.snapshot.after as Record<string, unknown>)?.status || '')}</code>
                        </div>
                      )}
                      {/* Bulk delete count */}
                      {entry.action === 'bulk_delete' && typeof entry.snapshot.count === 'number' && (
                        <div className="text-xs mt-1 text-destructive font-semibold">
                          Удалено: {entry.snapshot.count}
                        </div>
                      )}
                    </div>
                    {/* Timestamp */}
                    <div className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                      {formatTime(entry.createdAt)}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border/30">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="h-8 px-3 rounded-full bg-muted text-xs font-semibold hover:bg-accent transition-colors disabled:opacity-40"
                  type="button"
                >
                  ← Назад
                </button>
                <span className="text-xs text-muted-foreground">
                  {offset + 1}–{Math.min(offset + limit, total)} из {total}
                </span>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="h-8 px-3 rounded-full bg-muted text-xs font-semibold hover:bg-accent transition-colors disabled:opacity-40"
                  type="button"
                >
                  Вперёд →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
