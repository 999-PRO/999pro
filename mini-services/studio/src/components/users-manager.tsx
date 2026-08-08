'use client'

// ============================================================================
//  UsersManager — admin panel for viewing and deleting users.
//  ----------------------------------------------------------------------------
//  Features:
//    • Search users by username, displayName, email
//    • List all users (with role + online status + last seen)
//    • Soft-delete any user (admin-only) via DELETE /api/users/:id
//    • Confirm dialog before deletion
//    • Admin cannot delete themselves (backend enforces, UI hides button)
// ============================================================================

import { useEffect, useState, useCallback, useDeferredValue } from 'react'
import { Search, Trash2, ShieldCheck, X, AlertTriangle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { timeAgo } from '@/lib/utils'
import { toast } from '@/lib/notifications'
interface UserRow {
  id: string
  username: string
  displayName: string | null
  email: string
  avatar: string | null
  role: string
  isOnline: boolean
  lastSeen: string
  createdAt: string
}

interface DeleteDialogState {
  open: boolean
  user: UserRow | null
  loading: boolean
}

export function UsersManager() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // v13.1 (audit P1-14 fix): useDeferredValue + pagination, mirroring
  // products-manager.tsx. Previously a single network request fired per
  // keystroke AND the limit was hardcoded to 100 — users beyond 100 were
  // invisible. Now: search debounces via useDeferredValue, and pagination
  // allows scrolling through all users.
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 50
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    open: false,
    user: null,
    loading: false,
  })
  const me = useAuthStore((s) => s.user)
const fetchUsers = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .get<{ users: UserRow[]; items?: UserRow[]; total: number }>('/api/users/search', {
        auth: true,
        query: { q: deferredSearch || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      })
      .then((d) => {
        // v25.8: backend returns { users, total }, but older versions returned
        // { items, total }. Support both for forward/backward compat.
        const list = d.users || d.items || []
        setUsers(list)
        setTotal(d.total ?? list.length)
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : 'Не удалось загрузить пользователей'
        setError(msg)
      })
      .finally(() => setLoading(false))
  }, [deferredSearch, page])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // Reset to page 0 when search changes
  useEffect(() => {
    setPage(0)
  }, [deferredSearch])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleDelete = (user: UserRow) => {
    setDeleteDialog({ open: true, user, loading: false })
  }

  const confirmDelete = async () => {
    if (!deleteDialog.user) return
    setDeleteDialog((s) => ({ ...s, loading: true }))
    try {
      await api.delete(`/api/users/${deleteDialog.user.id}`, { auth: true })
      setUsers((cur) => cur.filter((u) => u.id !== deleteDialog.user!.id))
      setDeleteDialog({ open: false, user: null, loading: false })
      toast.success('Пользователь удалён', { description: `${deleteDialog.user.displayName || deleteDialog.user.username} — аккаунт деактивирован.` })
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)) || 'Не удалось удалить пользователя'
      setDeleteDialog((s) => ({ ...s, loading: false }))
      toast.error('Ошибка', { description: msg })
    }
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Пользователи</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Просмотр и удаление пользователей. Удаление — soft-delete (PII анонимизируется, аккаунт деактивируется).
        </p>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени, email, нику…"
          className="w-full h-11 pl-10 pr-4 rounded-2xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-center mb-4">
          <p className="text-destructive font-semibold">{error}</p>
          <button
            onClick={fetchUsers}
            className="mt-2 text-sm text-primary font-semibold hover:underline"
          >
            Повторить
          </button>
        </div>
      )}

      {/* Users list */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl skeleton" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">
          {search ? 'Ничего не найдено' : 'Нет пользователей'}
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 p-3 rounded-2xl glass hover:bg-accent/30 transition-colors"
            >
              {/* Avatar */}
              <div className="h-11 w-11 rounded-full overflow-hidden bg-muted shrink-0 grid place-items-center">
                {u.avatar ? (
                  <img src={u.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-muted-foreground">
                    {(u.displayName || u.username || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate">
                    {u.displayName || u.username}
                  </span>
                  {u.role === 'admin' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                      <ShieldCheck className="h-3 w-3" />
                      ADMIN
                    </span>
                  )}
                  {u.isOnline ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 text-[10px] font-bold">
                      ● онлайн
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {u.lastSeen ? timeAgo(u.lastSeen) : 'офлайн'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  @{u.username} · {u.email}
                </div>
              </div>

              {/* Delete button — hidden for self (admin can't delete themselves here) */}
              {u.id !== me?.id && (
                <button
                  onClick={() => handleDelete(u)}
                  className="shrink-0 h-9 w-9 rounded-full grid place-items-center text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Удалить пользователя"
                  title="Удалить пользователя"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}

          {/* v13.1 (audit P1-14 fix): pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-border/60">
              <div className="text-xs text-muted-foreground">
                Страница {page + 1} из {totalPages} · всего {total}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                  className="px-3 py-1.5 rounded-full text-xs font-medium glass hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Назад
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || loading}
                  className="px-3 py-1.5 rounded-full text-xs font-medium glass hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Вперёд →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteDialog.open && deleteDialog.user && (
        <div className="fixed inset-0 z-[100] grid place-items-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !deleteDialog.loading && setDeleteDialog({ open: false, user: null, loading: false })}
          />
          <div className="relative bg-background rounded-3xl shadow-2xl max-w-sm w-full p-6">
            <button
              onClick={() => !deleteDialog.loading && setDeleteDialog({ open: false, user: null, loading: false })}
              className="absolute top-3 right-3 h-8 w-8 rounded-full grid place-items-center hover:bg-accent"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-3 mb-4">
              <div className="h-11 w-11 rounded-full bg-destructive/15 grid place-items-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Удалить пользователя?</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Это действие необратимо. Аккаунт будет деактивирован, PII анонимизирован.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-muted/50 p-3 mb-4">
              <div className="text-sm font-semibold">
                {deleteDialog.user.displayName || deleteDialog.user.username}
              </div>
              <div className="text-xs text-muted-foreground">
                @{deleteDialog.user.username} · {deleteDialog.user.email}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteDialog({ open: false, user: null, loading: false })}
                disabled={deleteDialog.loading}
                className="flex-1 h-11 rounded-2xl bg-muted text-sm font-semibold hover:bg-accent transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteDialog.loading}
                className="flex-1 h-11 rounded-2xl bg-destructive text-white text-sm font-bold hover:bg-destructive/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleteDialog.loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Удаление…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
