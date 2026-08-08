'use client'

// ============================================================================
//  ManagersManager — admin panel for managing staff (admins + managers).
//  v25.8 (TRI999 launch): now supports creating BOTH admins and managers,
//  editing staff profile fields (displayName, username, email, phone, password),
//  and the existing block/unblock/role-change/delete operations.
//
//  Backend endpoints (all admin-only):
//    POST   /api/users/managers      — create staff (role: admin|manager)
//    GET    /api/users/managers      — list staff (admins + managers)
//    PATCH  /api/users/:id           — update profile fields (v25.8)
//    PATCH  /api/users/:id/role      — change role
//    POST   /api/users/:id/block     — block user
//    POST   /api/users/:id/unblock   — unblock user
//    DELETE /api/users/:id           — soft-delete user
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import {
  UserPlus, Shield, ShieldCheck, Lock, Unlock, X, Loader2, AlertTriangle,
  Trash2, Pencil,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'
import { Button } from '@/components/ui/button'
import { timeAgo } from '@/lib/utils'

interface StaffUser {
  id: string
  username: string
  email: string
  displayName: string | null
  role: string
  isOnline: boolean
  lastSeen: string
  createdAt: string
  lockedUntil: string | null
  failedLoginCount: number
  phone?: string
}

interface CreateDialogState {
  open: boolean
  loading: boolean
  username: string
  email: string
  password: string
  displayName: string
  role: 'admin' | 'manager'
}

interface EditDialogState {
  open: boolean
  loading: boolean
  user: StaffUser | null
  displayName: string
  username: string
  email: string
  phone: string
  password: string // empty = no change
}

const emptyCreate = (): CreateDialogState => ({
  open: false,
  loading: false,
  username: '',
  email: '',
  password: '',
  displayName: '',
  role: 'manager',
})

const emptyEdit = (): EditDialogState => ({
  open: false,
  loading: false,
  user: null,
  displayName: '',
  username: '',
  email: '',
  phone: '',
  password: '',
})

export function ManagersManager() {
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createDialog, setCreateDialog] = useState<CreateDialogState>(emptyCreate)
  const [editDialog, setEditDialog] = useState<EditDialogState>(emptyEdit)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const me = useAuthStore((s) => s.user)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api.get<{ managers: StaffUser[] }>('/api/users/managers', { auth: true })
      setStaff(d.managers || [])
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить персонал')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setCreateDialog((s) => ({ ...s, loading: true }))
    try {
      await api.post('/api/users/managers', {
        json: {
          username: createDialog.username,
          email: createDialog.email,
          password: createDialog.password,
          displayName: createDialog.displayName || undefined,
          role: createDialog.role,
        },
        auth: true,
      })
      const roleLabel = createDialog.role === 'admin' ? 'Администратор' : 'Менеджер'
      toast.success(`${roleLabel} создан`, {
        description: `${createDialog.username} (${createDialog.email})`,
      })
      setCreateDialog(emptyCreate())
      await load()
    } catch (e: any) {
      const errBody = e?.body || e?.message || String(e)
      toast.error('Ошибка создания', {
        description: typeof errBody === 'string' ? errBody : JSON.stringify(errBody),
      })
    } finally {
      setCreateDialog((s) => ({ ...s, loading: false }))
    }
  }

  const handleEdit = (user: StaffUser) => {
    setEditDialog({
      open: true,
      loading: false,
      user,
      displayName: user.displayName || '',
      username: user.username,
      email: user.email,
      phone: user.phone || '',
      password: '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editDialog.user) return
    setEditDialog((s) => ({ ...s, loading: true }))
    try {
      const body: any = {
        displayName: editDialog.displayName,
        username: editDialog.username,
        email: editDialog.email,
      }
      if (editDialog.phone) body.phone = editDialog.phone
      if (editDialog.password) body.password = editDialog.password
      await api.patch(`/api/users/${editDialog.user.id}`, { json: body, auth: true })
      toast.success('Профиль обновлён', {
        description: editDialog.password ? 'Пароль изменён — пользователь должен войти заново.' : undefined,
      })
      setEditDialog(emptyEdit())
      await load()
    } catch (e: any) {
      const errBody = e?.body || e?.message || String(e)
      toast.error('Ошибка обновления', {
        description: typeof errBody === 'string' ? errBody : JSON.stringify(errBody),
      })
    } finally {
      setEditDialog((s) => ({ ...s, loading: false }))
    }
  }

  const handleBlock = async (user: StaffUser) => {
    if (!confirm(`Заблокировать ${user.displayName || user.username}? Вход будет невозможен.`)) return
    setActionLoading(user.id)
    try {
      await api.post(`/api/users/${user.id}/block`, { auth: true })
      toast.success('Пользователь заблокирован', { description: user.username })
      await load()
    } catch (e: any) {
      toast.error('Ошибка блокировки', { description: e?.message || String(e) })
    } finally {
      setActionLoading(null)
    }
  }

  const handleUnblock = async (user: StaffUser) => {
    setActionLoading(user.id)
    try {
      await api.post(`/api/users/${user.id}/unblock`, { auth: true })
      toast.success('Пользователь разблокирован', { description: user.username })
      await load()
    } catch (e: any) {
      toast.error('Ошибка', { description: e?.message || String(e) })
    } finally {
      setActionLoading(null)
    }
  }

  const handleRoleChange = async (user: StaffUser, newRole: 'user' | 'manager' | 'admin') => {
    if (user.role === newRole) return
    if (!confirm(`Изменить роль ${user.displayName || user.username} с "${user.role}" на "${newRole}"?`)) return
    setActionLoading(user.id)
    try {
      await api.patch(`/api/users/${user.id}/role`, { json: { role: newRole }, auth: true })
      toast.success('Роль изменена', { description: `${user.username} → ${newRole}` })
      await load()
    } catch (e: any) {
      toast.error('Ошибка', { description: e?.message || String(e) })
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (user: StaffUser) => {
    if (!confirm(`Удалить аккаунт ${user.displayName || user.username}? Это необратимо.`)) return
    setActionLoading(user.id)
    try {
      await api.delete(`/api/users/${user.id}`, { auth: true })
      toast.success('Аккаунт удалён', { description: user.username })
      await load()
    } catch (e: any) {
      toast.error('Ошибка удаления', { description: e?.message || String(e) })
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Админы и менеджеры</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Создание администраторов и менеджеров, управление профилем, ролями и доступом.
          </p>
        </div>
        <Button onClick={() => setCreateDialog({ ...emptyCreate(), open: true })} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Создать
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-center mb-4">
          <p className="text-destructive font-semibold">{error}</p>
          <button onClick={load} className="mt-2 text-sm text-primary font-semibold hover:underline">
            Повторить
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl skeleton" />
          ))}
        </div>
      ) : staff.length === 0 ? (
        <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">
          Персонала пока нет. Создайте первого администратора или менеджера.
        </div>
      ) : (
        <div className="space-y-2">
          {staff.map((u) => {
            const isBlocked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()
            const isMe = u.id === me?.id
            const isAdmin = u.role === 'admin'
            return (
              <div
                key={u.id}
                className="flex items-center gap-3 p-3 md:p-4 rounded-2xl glass hover:bg-accent/30 transition-colors"
              >
                {/* Avatar */}
                <div className={`h-11 w-11 rounded-full grid place-items-center text-white font-semibold shrink-0 ${
                  isAdmin ? 'bg-gradient-to-br from-amber-500 to-orange-500'
                  : 'bg-gradient-to-br from-blue-500 to-indigo-500'
                }`}>
                  {(u.displayName || u.username).slice(0, 1).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{u.displayName || u.username}</span>
                    {isAdmin ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 border border-amber-500/30 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> Admin
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-600 border border-blue-500/30 flex items-center gap-1">
                        <Shield className="h-3 w-3" /> Manager
                      </span>
                    )}
                    {isBlocked && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-600 border border-red-500/30 flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Заблокирован
                      </span>
                    )}
                    {isMe && (
                      <span className="text-xs text-muted-foreground">(вы)</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    @{u.username} · {u.email}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {u.isOnline ? '● онлайн' : `Был в сети ${timeAgo(new Date(u.lastSeen))}`}
                  </div>
                </div>

                {/* Actions */}
                {!isMe && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleEdit(u)}
                      disabled={actionLoading === u.id}
                      title="Редактировать профиль"
                      className="h-9 w-9 grid place-items-center rounded-xl hover:bg-primary/10 text-primary transition-colors disabled:opacity-50"
                    >
                      {actionLoading === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                    </button>
                    {isBlocked ? (
                      <button
                        onClick={() => handleUnblock(u)}
                        disabled={actionLoading === u.id}
                        title="Разблокировать"
                        className="h-9 w-9 grid place-items-center rounded-xl hover:bg-emerald-500/10 text-emerald-600 transition-colors disabled:opacity-50"
                      >
                        <Unlock className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleBlock(u)}
                        disabled={actionLoading === u.id}
                        title="Заблокировать"
                        className="h-9 w-9 grid place-items-center rounded-xl hover:bg-amber-500/10 text-amber-600 transition-colors disabled:opacity-50"
                      >
                        <Lock className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(u)}
                      disabled={actionLoading === u.id}
                      title="Удалить аккаунт"
                      className="h-9 w-9 grid place-items-center rounded-xl hover:bg-destructive/10 text-destructive transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u, e.target.value as 'user' | 'manager' | 'admin')}
                      disabled={actionLoading === u.id}
                      className="h-9 px-2 rounded-xl bg-background border border-border/60 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                      title="Изменить роль"
                    >
                      <option value="manager">Manager</option>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                )}
                {isMe && (
                  <div className="text-xs text-muted-foreground px-2 shrink-0">(это вы)</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create staff dialog */}
      {createDialog.open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-background border border-border/60 shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border/60">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Новый сотрудник
              </h2>
              <button
                onClick={() => setCreateDialog(emptyCreate())}
                className="h-8 w-8 grid place-items-center rounded-full hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {/* Role selector */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">Роль *</label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setCreateDialog((s) => ({ ...s, role: 'manager' }))}
                    className={`flex-1 h-11 rounded-xl border text-sm font-medium transition-colors ${
                      createDialog.role === 'manager'
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-background border-border/60 hover:bg-accent'
                    }`}
                  >
                    <Shield className="h-4 w-4 inline mr-1" />
                    Менеджер
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateDialog((s) => ({ ...s, role: 'admin' }))}
                    className={`flex-1 h-11 rounded-xl border text-sm font-medium transition-colors ${
                      createDialog.role === 'admin'
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-background border-border/60 hover:bg-accent'
                    }`}
                  >
                    <ShieldCheck className="h-4 w-4 inline mr-1" />
                    Администратор
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {createDialog.role === 'admin'
                    ? 'Полный доступ ко всем функциям Studio. Обязательная 2FA при первом входе.'
                    : 'Доступ к операционным функциям Studio (заказы, чаты, товары). Без 2FA.'}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Имя пользователя *</label>
                <input
                  type="text"
                  value={createDialog.username}
                  onChange={(e) => setCreateDialog((s) => ({ ...s, username: e.target.value }))}
                  placeholder="manager_anna"
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email *</label>
                <input
                  type="email"
                  value={createDialog.email}
                  onChange={(e) => setCreateDialog((s) => ({ ...s, email: e.target.value }))}
                  placeholder="anna@tri999.com"
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Отображаемое имя</label>
                <input
                  type="text"
                  value={createDialog.displayName}
                  onChange={(e) => setCreateDialog((s) => ({ ...s, displayName: e.target.value }))}
                  placeholder="Анна Петрова"
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Пароль * (мин. 8 символов)</label>
                <input
                  type="password"
                  value={createDialog.password}
                  onChange={(e) => setCreateDialog((s) => ({ ...s, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              {createDialog.role === 'admin' && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    Администратор должен будет настроить 2FA (TOTP) при первом входе —
                    покажется QR-код для сканирования в приложении Google Authenticator
                    или аналогичном.
                  </div>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-border/60 flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setCreateDialog(emptyCreate())}>
                Отмена
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createDialog.loading || !createDialog.username || !createDialog.email || createDialog.password.length < 8}
                className="gap-2"
              >
                {createDialog.loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Создать
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit staff dialog */}
      {editDialog.open && editDialog.user && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-background border border-border/60 shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border/60">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Pencil className="h-5 w-5" />
                Редактировать профиль
              </h2>
              <button
                onClick={() => setEditDialog(emptyEdit())}
                className="h-8 w-8 grid place-items-center rounded-full hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Отображаемое имя</label>
                <input
                  type="text"
                  value={editDialog.displayName}
                  onChange={(e) => setEditDialog((s) => ({ ...s, displayName: e.target.value }))}
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Имя пользователя</label>
                <input
                  type="text"
                  value={editDialog.username}
                  onChange={(e) => setEditDialog((s) => ({ ...s, username: e.target.value }))}
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <input
                  type="email"
                  value={editDialog.email}
                  onChange={(e) => setEditDialog((s) => ({ ...s, email: e.target.value }))}
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Телефон</label>
                <input
                  type="text"
                  value={editDialog.phone}
                  onChange={(e) => setEditDialog((s) => ({ ...s, phone: e.target.value }))}
                  placeholder="+7..."
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Новый пароль (оставьте пустым, чтобы не менять)
                </label>
                <input
                  type="password"
                  value={editDialog.password}
                  onChange={(e) => setEditDialog((s) => ({ ...s, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full h-11 mt-1 px-3 rounded-xl bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {editDialog.password && editDialog.password.length < 8 && (
                  <p className="text-xs text-destructive mt-1">Минимум 8 символов</p>
                )}
                {editDialog.password && editDialog.password.length >= 8 && (
                  <p className="text-xs text-amber-600 mt-1">
                    При смене пароля все текущие сессии пользователя будут завершены.
                  </p>
                )}
              </div>
            </div>
            <div className="p-5 border-t border-border/60 flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setEditDialog(emptyEdit())}>
                Отмена
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={editDialog.loading || (editDialog.password.length > 0 && editDialog.password.length < 8)}
                className="gap-2"
              >
                {editDialog.loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
