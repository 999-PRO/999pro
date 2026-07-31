'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Trash2, Phone, User, MessageCircle, Clock, MapPin, FileText,
  Image as ImageIcon, X, CheckSquare, Square, CheckCheck,
  AlertTriangle, Loader2,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { useStudioSocket } from '@/lib/use-studio-socket'
import { cn, formatPrice } from '@/lib/utils'
import type { Lead, LeadStatus } from '@/lib/types'
import { toast } from '@/lib/notifications'

// ============================================================================
//  Lead statuses — must match the backend LEAD_STATUSES array.
//  The order here is the workflow order: new → processing → working → done / cancelled.
// ============================================================================
const STATUSES: { id: LeadStatus; label: string; color: string }[] = [
  { id: 'new', label: 'Новая', color: 'bg-blue-500' },
  { id: 'processing', label: 'В обработке', color: 'bg-yellow-500' },
  { id: 'working', label: 'В работе', color: 'bg-purple-500' },
  { id: 'done', label: 'Выполнена', color: 'bg-green-500' },
  { id: 'cancelled', label: 'Отменена', color: 'bg-rose-500' },
]

// ============================================================================
//  Bulk delete confirmation dialog — shown when the admin clicks any of
//  the bulk-delete actions. Lists exactly what will be deleted so there's
//  no accidental data loss.
// ============================================================================
interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  count: number
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

function ConfirmDialog({ open, title, message, count, confirmLabel = 'Удалить', onConfirm, onCancel, busy }: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="bg-background w-full max-w-md rounded-3xl p-6 shadow-2xl animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="h-12 w-12 rounded-2xl bg-destructive/15 grid place-items-center shrink-0">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{message}</p>
            <div className="mt-3 px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-sm font-semibold">
              Будет удалено: {count} {pluralizeLeads(count)}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-full glass border border-border/40 font-semibold h-11 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-full bg-destructive text-white font-semibold h-11 hover:bg-destructive/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {busy ? 'Удаление…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Russian pluralization for "заявка/заявки/заявок".
// Rules:
//   - 1 (except 11) → заявка
//   - 2-4 (except 12-14) → заявки
//   - 0, 5-19, 20+ → заявок
// Previously the code used `count === 1 ? 'заявка' : count < 5 ? 'заявки' : 'заявок'`
// which produced "12 заявки" instead of "12 заявок" (the 11-14 exception
// was not handled).
function pluralizeLeads(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'заявка'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'заявки'
  return 'заявок'
}

export function LeadsManager() {
  // v9-audit-fix (C-1, C-3): type the lead items properly and surface fetch
  // errors to the UI instead of silently clearing the list.
  const [items, setItems] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0) // 0-indexed page number
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [confirm, setConfirm] = useState<{
    open: boolean
    title: string
    message: string
    count: number
    action: 'delete-one' | 'delete-selected' | 'clear-status' | 'clear-all'
    status?: string
    ids?: string[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
// S-HIGH-005 fix: "ignore window" for socket events. After any local
  // mutation (status change, delete, etc.) we record the timestamp; the
  // socket handler skips refresh() for 500ms afterwards. Without this, the
  // backend's `lead:status-changed` event arrives milliseconds after our
  // optimistic setItems() call and triggers refresh(), which flips the UI
  // back to the loading state and re-fetches the same data — flicker and
  // potential clobbering if the server is slightly behind.
  const lastMutationRef = useRef(0)

  const PAGE_SIZE = 50

  // Debounce search input — without this, every keystroke triggers a
  // backend GET. 350ms is short enough to feel responsive, long enough
  // to skip the in-between queries.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0) // reset to first page on new search
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    const query: Record<string, string | number> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
    if (filter !== 'all') query.status = filter
    if (debouncedSearch) query.q = debouncedSearch
    api
      .get<{ items: Lead[]; total: number }>('/api/leads', { auth: true, query })
      .then((d) => {
        setItems(d.items)
        setTotal(d.total)
      })
      .catch((e: unknown) => {
        // v9-audit-fix (C-2): previously this was `.catch(() => { setItems([]); setTotal(0) })`
        // — a silent swallow with no logging and no error UI. The admin saw an
        // empty list and couldn't tell whether it was genuinely empty or fetch
        // had failed. Now we log + surface the error to the UI with a retry.
        console.error('[leads-manager] refresh failed:', e)
        const msg = e instanceof Error ? e.message : 'Не удалось загрузить заявки'
        setError(msg)
        setItems([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }, [filter, debouncedSearch, page])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Phase 20: real-time updates via Socket.IO — when another admin changes
  // a lead's status or deletes leads, auto-refresh the list.
  // S-HIGH-005 fix: skip refresh() for 500ms after a local mutation to
  // avoid overwriting the optimistic update with stale server data.
  // v13.1: useStudioSocket no longer takes a channel param (was unused).
  useStudioSocket(useCallback((type: string, _data: unknown) => {
    if (Date.now() - lastMutationRef.current < 500) return
    if (type === 'lead:status-changed' || type === 'lead:deleted' || type === 'leads:bulk-deleted') {
      refresh()
    }
  }, [refresh]))

  // Reset selection when filter / search / page changes
  useEffect(() => {
    setSelected(new Set())
  }, [filter, debouncedSearch, page, loading])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasNext = page + 1 < totalPages
  const hasPrev = page > 0

  const handleStatus = async (id: string, status: LeadStatus) => {
    try {
      await api.patch(`/api/leads/${id}`, { json: { status }, auth: true })
      setItems((cur) => cur.map((l) => (l.id === id ? { ...l, status } : l)))
      if (selectedLead?.id === id) setSelectedLead({ ...selectedLead, status })
      // S-HIGH-005: mark the moment of local mutation so the socket handler
      // can skip the next refresh() (which would clobber this optimistic
      // update with stale server data arriving milliseconds later).
      lastMutationRef.current = Date.now()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  // ====== Single delete (with confirmation) ======
  const handleDeleteClick = (lead: any) => {
    setConfirm({
      open: true,
      title: 'Удалить заявку?',
      message: `Заявка от ${lead.name} будет удалена безвозвратно. У клиента она также исчезнет из списка «Мои заявки».`,
      count: 1,
      action: 'delete-one',
      ids: [lead.id],
    })
  }

  // ====== Bulk delete selected ======
  const handleDeleteSelectedClick = () => {
    if (selected.size === 0) return
    setConfirm({
      open: true,
      title: 'Удалить выбранные заявки?',
      message: `Выбрано ${selected.size} ${pluralizeLeads(selected.size)}. Они будут удалены безвозвратно. У клиентов они также исчезнут из списков «Мои заявки».`,
      count: selected.size,
      action: 'delete-selected',
      ids: Array.from(selected),
    })
  }

  // ====== Clear all by status ======
  const handleClearStatusClick = (status: string) => {
    const count = items.filter((l) => l.status === status).length
    if (count === 0) return
    const statusLabel = STATUSES.find((s) => s.id === status)?.label || status
    setConfirm({
      open: true,
      title: `Очистить «${statusLabel}»?`,
      message: `Все заявки со статусом «${statusLabel}» (${count} шт.) будут удалены безвозвратно. У клиентов они также исчезнут из списков «Мои заявки».`,
      count,
      action: 'clear-status',
      status,
    })
  }

  // ====== Clear ALL leads ======
  const handleClearAllClick = () => {
    if (items.length === 0) return
    setConfirm({
      open: true,
      title: 'Удалить ВСЕ заявки?',
      message: `Это действие удалит ВСЕ ${items.length} заявок безвозвратно. У клиентов они также исчезнут из списков «Мои заявки». Действие нельзя отменить.`,
      count: items.length,
      action: 'clear-all',
    })
  }

  // ====== Execute the confirmed action ======
  const executeConfirmed = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      if (confirm.action === 'delete-one' && confirm.ids) {
        await api.delete(`/api/leads/${confirm.ids[0]}`, { auth: true })
        setItems((cur) => cur.filter((l) => l.id !== confirm.ids![0]))
        setSelectedLead(null)
        toast.success('Заявка удалена')
      } else if (confirm.action === 'delete-selected' && confirm.ids) {
        const r = await api.post<{ deleted: number }>('/api/leads/bulk-delete', {
          json: { ids: confirm.ids },
          auth: true,
        })
        setItems((cur) => cur.filter((l) => !confirm.ids!.includes(l.id)))
        setSelected(new Set())
        toast.success(`Удалено заявок: ${r.deleted}`)
      } else if (confirm.action === 'clear-status' && confirm.status) {
        const r = await api.post<{ deleted: number }>('/api/leads/bulk-delete', {
          json: { clearStatus: confirm.status },
          auth: true,
        })
        setItems((cur) => cur.filter((l) => l.status !== confirm.status))
        toast.success(`Удалено заявок: ${r.deleted}`)
      } else if (confirm.action === 'clear-all') {
        const r = await api.post<{ deleted: number }>('/api/leads/bulk-delete', {
          json: { clearAll: true },
          auth: true,
        })
        setItems([])
        setSelected(new Set())
        toast.success(`Удалено заявок: ${r.deleted}`)
      }
      // S-HIGH-005: any of the bulk/single delete branches above mutated the
      // local items array optimistically — record the timestamp so the socket
      // handler skips refresh() for 500ms (prevents the lead:deleted /
      // leads:bulk-deleted events from clobbering the optimistic UI).
      lastMutationRef.current = Date.now()
      setConfirm(null)
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  // ====== Selection helpers ======
  const toggleSelect = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAll = () => setSelected(new Set(items.map((l) => l.id)))
  const selectNone = () => setSelected(new Set())

  // ====== Counts per status for the bulk-action buttons ======
  const countsByStatus = STATUSES.reduce((acc, s) => {
    acc[s.id] = items.filter((l) => l.status === s.id).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Заявки</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} заявок · выбрано: {selected.size}
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={handleClearAllClick}
            className="shrink-0 px-3 py-2 rounded-full text-xs font-semibold border border-destructive/30 text-destructive hover:bg-destructive/5 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Очистить всё
          </button>
        )}
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
        <button
          onClick={() => { setFilter('all'); setPage(0) }}
          className={cn(
            'shrink-0 px-4 py-2 rounded-full text-sm font-medium',
            filter === 'all' ? 'gradient-brand text-white shadow-glow' : 'glass text-muted-foreground',
          )}
        >
          Все ({total})
        </button>
        {STATUSES.map((s) => (
          <button
            key={s.id}
            onClick={() => { setFilter(s.id); setPage(0) }}
            className={cn(
              'shrink-0 px-4 py-2 rounded-full text-sm font-medium flex items-center gap-1.5',
              filter === s.id ? 'gradient-brand text-white shadow-glow' : 'glass text-muted-foreground',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', s.color)} />
            {s.label} ({countsByStatus[s.id] || 0})
          </button>
        ))}
      </div>

      {/* Search input — debounced, triggers backend q filter */}
      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени, телефону, товару, комментарию…"
          className="w-full h-10 px-4 rounded-full glass border border-border/40 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Bulk action toolbar — only visible when items exist */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 p-3 glass rounded-2xl">
          {/* Select all / none */}
          <button
            onClick={selected.size === items.length ? selectNone : selectAll}
            className="px-3 py-1.5 rounded-full text-xs font-medium glass border border-border/40 hover:bg-accent/40 transition-colors flex items-center gap-1.5"
          >
            {selected.size === items.length ? (
              <>
                <Square className="h-3.5 w-3.5" /> Снять выделение
              </>
            ) : (
              <>
                <CheckSquare className="h-3.5 w-3.5" /> Выбрать все
              </>
            )}
          </button>

          {/* Delete selected */}
          {selected.size > 0 && (
            <button
              onClick={handleDeleteSelectedClick}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-destructive text-white hover:bg-destructive/90 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" /> Удалить выбранные ({selected.size})
            </button>
          )}

          {/* Clear by status — quick action buttons */}
          <div className="flex flex-wrap gap-1.5 ml-auto">
            <span className="text-xs text-muted-foreground self-center mr-1">Очистить:</span>
            {STATUSES.filter((s) => (countsByStatus[s.id] || 0) > 0).map((s) => (
              <button
                key={s.id}
                onClick={() => handleClearStatusClick(s.id)}
                className="px-2.5 py-1.5 rounded-full text-xs font-medium border border-border/40 hover:bg-accent/40 transition-colors flex items-center gap-1"
                title={`Удалить все заявки со статусом «${s.label}»`}
              >
                <CheckCheck className="h-3 w-3" />
                {s.label} ({countsByStatus[s.id]})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Leads list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl skeleton" />
          ))}
        </div>
      ) : error ? (
        // v9-audit-fix (A-1, U-2): visible error + retry card — matches
        // the pattern used in AnalyticsView and UsersManager.
        <div className="py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-destructive/15 grid place-items-center mx-auto mb-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="text-lg font-bold mb-1">Не удалось загрузить</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto break-words">{error}</p>
          <button
            onClick={refresh}
            className="rounded-full gradient-brand text-white font-semibold h-11 px-6"
          >
            Повторить
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Нет заявок</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((l) => {
            const status = STATUSES.find((s) => s.id === l.status)
            const isSelected = selected.has(l.id)
            return (
              <div
                key={l.id}
                className={cn(
                  'rounded-2xl glass p-4 space-y-2 transition-all',
                  isSelected && 'ring-2 ring-primary bg-primary/5',
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Selection checkbox */}
                  <button
                    onClick={() => toggleSelect(l.id)}
                    className="mt-0.5 shrink-0"
                    aria-label={isSelected ? 'Снять выделение' : 'Выбрать заявку'}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-5 w-5 text-primary" />
                    ) : (
                      <Square className="h-5 w-5 text-muted-foreground/60" />
                    )}
                  </button>

                  {/* Main content (clickable to open details) */}
                  <button
                    onClick={() => setSelectedLead(l)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-semibold text-sm truncate">{l.name}</span>
                      <span className={cn('h-2 w-2 rounded-full shrink-0', status?.color || 'bg-gray-400')} />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm text-primary">{l.phone}</span>
                    </div>
                    {l.productTitle && (
                      <div className="text-xs text-muted-foreground truncate mt-1">Товар: {l.productTitle}</div>
                    )}
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
                      <Clock className="h-3 w-3" />
                      {new Date(l.createdAt).toLocaleString('ru-RU')}
                    </div>
                  </button>

                  {/* Status quick-change */}
                  <select
                    value={l.status}
                    onChange={(e) => {
                      e.stopPropagation()
                      handleStatus(l.id, e.target.value as LeadStatus)
                    }}
                    className="shrink-0 text-xs rounded-full bg-accent/30 border border-border/40 px-2 py-1 outline-none focus:border-primary cursor-pointer"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteClick(l)}
                    className="shrink-0 h-8 w-8 rounded-full text-destructive hover:bg-destructive/10 transition-colors grid place-items-center"
                    aria-label="Удалить заявку"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination controls — only show when there are more than 1 page */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 mb-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={!hasPrev || loading}
            className="px-4 py-2 rounded-full glass border border-border/40 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-foreground/5 transition-colors"
          >
            ← Назад
          </button>
          <span className="text-sm text-muted-foreground">
            Страница {page + 1} из {totalPages} · {total} всего
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
            className="px-4 py-2 rounded-full glass border border-border/40 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-foreground/5 transition-colors"
          >
            Вперёд →
          </button>
        </div>
      )}

      {/* Lead detail modal */}
      {selectedLead && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setSelectedLead(null)}
        >
          <div
            className="bg-background w-full md:max-w-md rounded-t-[32px] md:rounded-[32px] max-h-[90vh] overflow-y-auto p-5 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedLead(null)}
              className="absolute top-4 right-4 h-9 w-9 rounded-full glass grid place-items-center"
            >
              <X className="h-5 w-5" />
            </button>

            {selectedLead.productImage && (
              <div className="flex items-center gap-3 mb-4">
                <div className="h-16 w-16 rounded-2xl overflow-hidden bg-muted/40 shrink-0">
                  <img src={assetUrl(selectedLead.productImage)} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{selectedLead.productTitle}</div>
                  <div className="text-lg font-bold text-primary">
                    {/* FIX (was): raw `{productPrice * quantity}₽` produced
                        "150000₽" instead of "150 000 ₽". Now uses the shared
                        formatPrice helper for proper thousands separators. */}
                    {formatPrice((selectedLead.productPrice || 0) * (selectedLead.quantity || 1), 'RUB')}
                  </div>
                  <div className="text-xs text-muted-foreground">{selectedLead.quantity} шт.</div>
                </div>
              </div>
            )}

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{selectedLead.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a href={`tel:${selectedLead.phone}`} className="text-sm text-primary hover:underline">
                  {selectedLead.phone}
                </a>
              </div>
              {selectedLead.deliveryMethod && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {selectedLead.deliveryMethod === 'delivery' ? 'Доставка' : 'Самовывоз'}
                    {selectedLead.address ? ' — ' + selectedLead.address : ''}
                  </span>
                </div>
              )}
              {selectedLead.contactMethod && (
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm capitalize">{selectedLead.contactMethod}</span>
                </div>
              )}
              {selectedLead.comment && (
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <span className="text-sm">{selectedLead.comment}</span>
                </div>
              )}
              {selectedLead.receiptUrl && (
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  <a href={assetUrl(selectedLead.receiptUrl)} target="_blank" className="text-sm text-primary hover:underline">
                    Чек
                  </a>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {new Date(selectedLead.createdAt).toLocaleString('ru-RU')}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-xs font-semibold text-muted-foreground mb-2">Статус</div>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleStatus(selectedLead.id, s.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium',
                      selectedLead.status === s.id
                        ? 'gradient-brand text-white shadow-glow'
                        : 'glass text-muted-foreground',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                setSelectedLead(null)
                handleDeleteClick(selectedLead)
              }}
              className="w-full rounded-full text-destructive border border-destructive/30 font-semibold h-10 hover:bg-destructive/5 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="h-4 w-4" /> Удалить заявку
            </button>
          </div>
        </div>
      )}

      {/* Bulk delete confirmation dialog */}
      <ConfirmDialog
        open={!!confirm?.open}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        count={confirm?.count || 0}
        confirmLabel={confirm?.action === 'clear-all' ? 'Удалить всё' : 'Удалить'}
        onConfirm={executeConfirmed}
        onCancel={() => !busy && setConfirm(null)}
        busy={busy}
      />
    </div>
  )
}
