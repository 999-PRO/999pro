'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, Flag, Bot, Ban, AlertTriangle, History, ScrollText, Settings, ListFilter,
  Plus, Trash2, Pencil, Eye, EyeOff, Download, Upload, Search, RefreshCw,
  CheckCircle, XCircle, Activity,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'

// ============================================================================
// ModerationManager — Studio section with 10 sub-tabs.
//
// Tabs:
//   1. Жалобы            — user-submitted reports
//   2. AI-флаги          — AI-flagged content
//   3. Заблокированные   — banned/restricted users
//   4. Предупреждения    — warnings list
//   5. История           — user violation history
//   6. Журнал            — moderation action log
//   7. Настройки         — moderation settings
//   8. Стоп-слова        — stop-words dictionary manager
//   9. AI-модерация      — AI settings (alias of Настройки AI section)
//  10. Дашборд           — overview stats (default tab)
// ============================================================================

type Tab = 'dashboard' | 'reports' | 'ai-flags' | 'banned' | 'warnings' | 'history' | 'log' | 'settings' | 'stop-words' | 'ai'

const TABS: { id: Tab; label: string; icon: typeof Shield }[] = [
  { id: 'dashboard',  label: 'Дашборд',           icon: Shield },
  { id: 'reports',    label: 'Жалобы',            icon: Flag },
  { id: 'ai-flags',   label: 'AI-флаги',          icon: Bot },
  { id: 'banned',     label: 'Заблокированные',   icon: Ban },
  { id: 'warnings',   label: 'Предупреждения',    icon: AlertTriangle },
  { id: 'history',    label: 'История',           icon: History },
  { id: 'log',        label: 'Журнал',            icon: ScrollText },
  { id: 'stop-words', label: 'Стоп-слова',        icon: ListFilter },
  { id: 'settings',   label: 'Настройки',         icon: Settings },
  { id: 'ai',         label: 'AI-модерация',      icon: Bot },
]

export function ModerationManager() {
  const [tab, setTab] = useState<Tab>('dashboard')

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl grid place-items-center shadow-glow bg-gradient-to-br from-red-500 via-rose-500 to-pink-600">
          <Shield className="h-5 w-5 text-white" strokeWidth={2.4} />
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Модерация</h2>
          <p className="text-sm text-muted-foreground">Двухуровневая система: локальная проверка + AI</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all',
                active
                  ? 'bg-gradient-to-br from-red-500 via-rose-500 to-pink-600 text-white shadow-glow'
                  : 'glass text-muted-foreground hover:text-foreground hover:bg-foreground/5',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'dashboard'  && <DashboardTab />}
          {tab === 'reports'    && <ReportsTab />}
          {tab === 'ai-flags'   && <AIFlagsTab />}
          {tab === 'banned'     && <BannedTab />}
          {tab === 'warnings'   && <WarningsTab />}
          {tab === 'history'    && <HistoryTab />}
          {tab === 'log'        && <LogTab />}
          {tab === 'stop-words' && <StopWordsTab />}
          {tab === 'settings'   && <SettingsTab />}
          {tab === 'ai'         && <AITab />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ============================================================================
// Dashboard tab
// ============================================================================

interface Stats {
  pendingReports: number
  unreviewedAIFlags: number
  bannedUsers: number
  activeWarnings: number
  totalStopWords: number
  activeStopWords: number
  todayActions: number
}

function DashboardTab() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    api.get<Stats>('/api/moderation/stats', { auth: true })
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <div className="h-32 rounded-2xl skeleton" />
  if (!stats) return <div className="text-muted-foreground text-center py-8">Ошибка загрузки</div>

  const cards = [
    { label: 'Жалобы в очереди', value: stats.pendingReports, icon: Flag, color: 'from-amber-400 to-orange-500' },
    { label: 'AI-флаги без проверки', value: stats.unreviewedAIFlags, icon: Bot, color: 'from-violet-400 to-purple-500' },
    { label: 'Заблокированные', value: stats.bannedUsers, icon: Ban, color: 'from-red-400 to-rose-500' },
    { label: 'Активные предупреждения', value: stats.activeWarnings, icon: AlertTriangle, color: 'from-yellow-400 to-amber-500' },
    { label: 'Всего стоп-слов', value: stats.totalStopWords, icon: ListFilter, color: 'from-blue-400 to-indigo-500' },
    { label: 'Активных стоп-слов', value: stats.activeStopWords, icon: CheckCircle, color: 'from-emerald-400 to-teal-500' },
    { label: 'Действий за 24ч', value: stats.todayActions, icon: Activity, color: 'from-pink-400 to-rose-500' },
  ]

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-3 text-sm text-muted-foreground">
        <strong className="text-foreground">Система модерации активна.</strong> Все сообщения,
        отзывы, имена пользователей и описания профилей проверяются дважды: локально (стоп-слова +
        спам + ссылки) и через AI (эвристики + опционально LLM). Только flagged/reported/blocked
        контент попадает в модерацию — приватные переписки НЕ просматриваются.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <div key={c.label} className="glass rounded-2xl p-4">
              <div className={cn('h-9 w-9 rounded-xl grid place-items-center mb-2 bg-gradient-to-br', c.color)}>
                <Icon className="h-4 w-4 text-white" />
              </div>
              <div className="text-2xl font-extrabold">{c.value}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </div>
          )
        })}
      </div>
      <Button variant="outline" className="rounded-full" onClick={refresh}>
        <RefreshCw className="h-4 w-4 mr-1" /> Обновить
      </Button>
    </div>
  )
}

// ============================================================================
// Reports tab
// ============================================================================

interface Report {
  id: string
  reporterId: string
  targetType: string
  targetId: string
  reason: string
  comment: string | null
  status: string
  decision: string | null
  createdAt: string
  reporter: { id: string; username: string; displayName: string | null; avatar: string | null }
  reviewer: { id: string; username: string } | null
}

const REASON_LABELS: Record<string, string> = {
  spam: 'Спам', insult: 'Оскорбление', threat: 'Угроза',
  fraud: 'Мошенничество', forbidden: 'Запрещённый контент', other: 'Другое',
}

function ReportsTab() {
  const [items, setItems] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'actioned' | 'dismissed'>('pending')
const refresh = useCallback(() => {
    setLoading(true)
    const query = filter === 'all' ? undefined : `?status=${filter}`
    api.get<{ items: Report[] }>(`/api/moderation/reports${query || ''}`, { auth: true })
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => { refresh() }, [refresh])

  const review = async (id: string, status: 'reviewed' | 'dismissed' | 'actioned') => {
    try {
      await api.patch(`/api/moderation/reports/${id}`, { json: { status }, auth: true })
      toast.success('Жалоба обработана')
      refresh()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(['pending', 'reviewed', 'actioned', 'dismissed', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              filter === s ? 'bg-primary text-white' : 'glass text-muted-foreground hover:text-foreground',
            )}
          >
            {s === 'all' ? 'Все' : s === 'pending' ? 'В очереди' : s === 'reviewed' ? 'Просмотрено' : s === 'actioned' ? 'Действие' : 'Отклонено'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Flag className="h-10 w-10 mx-auto mb-2 opacity-50" />
          Нет жалоб
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <div key={r.id} className="glass rounded-2xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{REASON_LABELS[r.reason] || r.reason}</Badge>
                    <Badge variant={r.status === 'pending' ? 'destructive' : 'success'} className="text-[10px]">{r.status}</Badge>
                    <Badge variant="outline" className="text-[10px]">{r.targetType}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Жалоба от <strong>@{r.reporter.username}</strong> на {r.targetType}:{r.targetId.slice(0, 12)}
                  </div>
                  {r.comment && <div className="text-sm mt-1">{r.comment}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1">{new Date(r.createdAt).toLocaleString('ru-RU')}</div>
                </div>
                {r.status === 'pending' && (
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="outline" className="rounded-full h-7 text-xs" onClick={() => review(r.id, 'actioned')}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Действие
                    </Button>
                    <Button size="sm" variant="ghost" className="rounded-full h-7 text-xs" onClick={() => review(r.id, 'dismissed')}>
                      <XCircle className="h-3 w-3 mr-1" /> Отклонить
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// AI Flags tab
// ============================================================================

interface AIFlag {
  id: string
  userId: string
  targetType: string
  targetId: string | null
  content: string
  reason: string
  confidence: number
  severity: string
  action: string
  reviewed: boolean
  createdAt: string
  user: { id: string; username: string; displayName: string | null; avatar: string | null }
}

function AIFlagsTab() {
  const [items, setItems] = useState<AIFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'unreviewed' | 'reviewed' | 'all'>('unreviewed')
const refresh = useCallback(() => {
    setLoading(true)
    const q = filter === 'all' ? '' : `?reviewed=${filter === 'reviewed'}`
    api.get<{ items: AIFlag[] }>(`/api/moderation/ai-flags${q}`, { auth: true })
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => { refresh() }, [refresh])

  const review = async (id: string) => {
    try {
      await api.patch(`/api/moderation/ai-flags/${id}`, { json: { reviewed: true }, auth: true })
      toast.success('Отмечено как проверено')
      refresh()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(['unreviewed', 'reviewed', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              filter === s ? 'bg-primary text-white' : 'glass text-muted-foreground hover:text-foreground',
            )}
          >
            {s === 'unreviewed' ? 'Не проверено' : s === 'reviewed' ? 'Проверено' : 'Все'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Bot className="h-10 w-10 mx-auto mb-2 opacity-50" />
          Нет AI-флагов
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((f) => (
            <div key={f.id} className="glass rounded-2xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={f.severity === 'high' ? 'destructive' : f.severity === 'medium' ? 'outline' : 'secondary'} className="text-[10px]">{f.severity}</Badge>
                    <Badge variant="outline" className="text-[10px]">{f.action}</Badge>
                    <Badge variant="outline" className="text-[10px]">{f.targetType}</Badge>
                    <span className="text-[10px] text-muted-foreground">conf: {(f.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Пользователь: <strong>@{f.user.username}</strong>
                  </div>
                  <div className="text-sm mt-1 line-clamp-3 bg-muted/30 rounded p-2 font-mono text-xs">{f.content}</div>
                  <div className="text-xs text-muted-foreground mt-1">{f.reason}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(f.createdAt).toLocaleString('ru-RU')}</div>
                </div>
                {!f.reviewed && (
                  <Button size="sm" variant="outline" className="rounded-full h-7 text-xs" onClick={() => review(f.id)}>
                    <CheckCircle className="h-3 w-3 mr-1" /> Проверено
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Banned users tab
// ============================================================================

interface BannedUser {
  id: string
  userId: string
  isBanned: boolean
  banReason: string | null
  bannedUntil: string | null
  chatRestrictedUntil: string | null
  reviewsRestrictedUntil: string | null
  violationsCount: number
  warningsCount: number
  bansCount: number
  user: { id: string; username: string; displayName: string | null; avatar: string | null; email: string }
}

function BannedTab() {
  const [items, setItems] = useState<BannedUser[]>([])
  const [loading, setLoading] = useState(true)
const { dialog: confirmDlg, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()
  const [unbanningId, setUnbanningId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    api.get<{ items: BannedUser[] }>('/api/moderation/banned-users', { auth: true })
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const unban = (userId: string, username: string) => {
    openConfirm({
      title: 'Снять блокировку?',
      message: `Разблокировать пользователя @${username}? Все ограничения будут сняты.`,
      confirmLabel: 'Разблокировать',
      variant: 'default',
      onConfirm: async () => {
        setUnbanningId(userId)
        try {
          await api.patch(`/api/moderation/users/${userId}/unban`, { auth: true })
          toast.success('Пользователь разблокирован')
          refresh()
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        } finally {
          setUnbanningId(null)
        }
      },
    })
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Ban className="h-10 w-10 mx-auto mb-2 opacity-50" />
          Нет заблокированных пользователей
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((b) => (
            <div key={b.id} className="glass rounded-2xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong>@{b.user.username}</strong>
                    {b.isBanned && <Badge variant="destructive" className="text-[10px]">Заблокирован</Badge>}
                    {b.chatRestrictedUntil && new Date(b.chatRestrictedUntil) > new Date() && <Badge variant="outline" className="text-[10px]">Чат ограничен</Badge>}
                    {b.reviewsRestrictedUntil && new Date(b.reviewsRestrictedUntil) > new Date() && <Badge variant="outline" className="text-[10px]">Отзывы ограничены</Badge>}
                  </div>
                  {b.banReason && <div className="text-xs mt-1 text-muted-foreground">Причина: {b.banReason}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Нарушений: {b.violationsCount} · Предупреждений: {b.warningsCount} · Банов: {b.bansCount}
                    {b.bannedUntil && ` · до ${new Date(b.bannedUntil).toLocaleString('ru-RU')}`}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="rounded-full h-7 text-xs" onClick={() => unban(b.userId, b.user.username)} disabled={unbanningId === b.userId}>
                  Снять ограничения
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <StudioConfirmDialog dialog={confirmDlg} onClose={closeConfirm} />
    </div>
  )
}

// ============================================================================
// Warnings tab
// ============================================================================

interface Warning {
  id: string
  userId: string
  reason: string
  message: string | null
  severity: string
  acknowledgedAt: string | null
  createdAt: string
  user: { id: string; username: string; displayName: string | null; avatar: string | null }
}

function WarningsTab() {
  const [items, setItems] = useState<Warning[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    api.get<{ items: Warning[] }>('/api/moderation/warnings?unack=true', { auth: true })
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <div className="h-32 rounded-2xl skeleton" />

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <AlertTriangle className="h-10 w-10 mx-auto mb-2 opacity-50" />
          Нет активных предупреждений
        </div>
      ) : items.map((w) => (
        <div key={w.id} className="glass rounded-2xl p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={w.severity === 'high' ? 'destructive' : w.severity === 'medium' ? 'outline' : 'secondary'} className="text-[10px]">{w.severity}</Badge>
            <strong>@{w.user.username}</strong>
          </div>
          <div className="text-sm mt-1">{w.reason}</div>
          {w.message && <div className="text-xs text-muted-foreground mt-1">{w.message}</div>}
          <div className="text-[10px] text-muted-foreground mt-1">{new Date(w.createdAt).toLocaleString('ru-RU')}</div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// History tab (search by user)
// ============================================================================

function HistoryTab() {
  const [userId, setUserId] = useState('')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
const search = async () => {
    if (!userId.trim()) return
    setLoading(true)
    try {
      const result = await api.get<any>(`/api/moderation/users/${userId.trim()}/history`, { auth: true })
      setData(result)
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User ID (cuid)"
          className="rounded-full font-mono text-sm"
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <Button onClick={search} className="rounded-full" disabled={loading}>
          <Search className="h-4 w-4" /> Найти
        </Button>
      </div>

      {loading && <div className="h-32 rounded-2xl skeleton" />}

      {data && (
        <div className="space-y-3">
          {data.stats && (
            <div className="glass rounded-2xl p-4 grid grid-cols-3 md:grid-cols-5 gap-3 text-center">
              <div><div className="text-2xl font-bold">{data.stats.violationsCount ?? 0}</div><div className="text-[10px] text-muted-foreground">Нарушений</div></div>
              <div><div className="text-2xl font-bold">{data.stats.reportsCount ?? 0}</div><div className="text-[10px] text-muted-foreground">Жалоб</div></div>
              <div><div className="text-2xl font-bold">{data.stats.deletedMessagesCount ?? 0}</div><div className="text-[10px] text-muted-foreground">Удал. сообщений</div></div>
              <div><div className="text-2xl font-bold">{data.stats.warningsCount ?? 0}</div><div className="text-[10px] text-muted-foreground">Предупр.</div></div>
              <div><div className="text-2xl font-bold">{data.stats.bansCount ?? 0}</div><div className="text-[10px] text-muted-foreground">Банов</div></div>
            </div>
          )}
          {data.aiFlags?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">AI-флаги ({data.aiFlags.length})</h4>
              <div className="space-y-1">
                {data.aiFlags.slice(0, 10).map((f: any) => (
                  <div key={f.id} className="text-xs glass rounded p-2">
                    <div className="flex gap-2"><Badge variant="outline" className="text-[10px]">{f.severity}</Badge><span className="text-muted-foreground">{new Date(f.createdAt).toLocaleString('ru-RU')}</span></div>
                    <div className="mt-1 line-clamp-2">{f.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.warnings?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Предупреждения ({data.warnings.length})</h4>
              <div className="space-y-1">
                {data.warnings.slice(0, 10).map((w: any) => (
                  <div key={w.id} className="text-xs glass rounded p-2">
                    {w.reason} <span className="text-muted-foreground">— {new Date(w.createdAt).toLocaleString('ru-RU')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Log tab
// ============================================================================

interface LogEntry {
  id: string
  actorType: string
  actorId: string | null
  action: string
  targetType: string
  targetId: string | null
  reason: string | null
  details: string
  createdAt: string
  actor: { id: string; username: string; displayName: string | null } | null
}

function LogTab() {
  const [items, setItems] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    api.get<{ items: LogEntry[] }>('/api/moderation/log', { auth: true })
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <div className="h-32 rounded-2xl skeleton" />

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <ScrollText className="h-10 w-10 mx-auto mb-2 opacity-50" />
          Журнал пуст
        </div>
      ) : items.map((l) => (
        <div key={l.id} className="glass rounded-xl p-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={l.actorType === 'ai' ? 'outline' : l.actorType === 'system' ? 'secondary' : 'success'} className="text-[10px]">{l.actorType}</Badge>
            <Badge variant="outline" className="text-[10px]">{l.action}</Badge>
            <Badge variant="outline" className="text-[10px]">{l.targetType}</Badge>
            <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString('ru-RU')}</span>
          </div>
          {l.reason && <div className="mt-1 text-muted-foreground">{l.reason}</div>}
          {l.actor && <div className="mt-0.5 text-[10px]">→ {l.actor.username}</div>}
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Stop words tab — full CRUD + import/export
// ============================================================================

interface StopWord {
  id: string
  word: string
  category: string
  isActive: boolean
  severity: string
  createdAt: string
}

const CATEGORIES = [
  { id: 'profanity', label: 'Мат' },
  { id: 'insult', label: 'Оскорбления' },
  { id: 'extremism', label: 'Экстремизм' },
  { id: 'terrorism', label: 'Терроризм' },
  { id: 'violence', label: 'Насилие' },
  { id: 'drugs', label: 'Наркотики' },
  { id: 'fraud', label: 'Мошенничество' },
  { id: 'spam', label: 'Спам' },
  { id: 'ads', label: 'Запрещённая реклама' },
  { id: 'custom', label: 'Пользовательские' },
]

function StopWordsTab() {
  const [items, setItems] = useState<StopWord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [editing, setEditing] = useState<StopWord | null>(null)
  const [creating, setCreating] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
const { dialog: confirmDlg, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (categoryFilter !== 'all') params.set('category', categoryFilter)
    if (search) params.set('search', search)
    const q = params.toString() ? `?${params.toString()}` : ''
    api.get<{ items: StopWord[] }>(`/api/moderation/stop-words${q}`, { auth: true })
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [categoryFilter, search])

  useEffect(() => { refresh() }, [refresh])

  const toggleActive = async (sw: StopWord) => {
    try {
      await api.patch(`/api/moderation/stop-words/${sw.id}`, { json: { isActive: !sw.isActive }, auth: true })
      setItems((cur) => cur.map((x) => x.id === sw.id ? { ...x, isActive: !x.isActive } : x))
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleDelete = (id: string) => {
    openConfirm({
      title: 'Удалить стоп-слово?',
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        setDeletingId(id)
        try {
          await api.delete(`/api/moderation/stop-words/${id}`, { auth: true })
          setItems((cur) => cur.filter((x) => x.id !== id))
          toast.success('Удалено')
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        } finally {
          setDeletingId(null)
        }
      },
    })
  }

  const exportWords = (format: 'json' | 'csv' | 'txt') => {
    window.open(`/api/moderation/stop-words/export?format=${format}`, '_blank')
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск..."
          className="rounded-full flex-1 min-w-[150px]"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="glass rounded-full px-3 py-2 text-sm border-0 bg-background"
        >
          <option value="all">Все категории</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <Button onClick={() => setCreating(true)} className="rounded-full">
          <Plus className="h-4 w-4" /> Добавить
        </Button>
        <Button variant="outline" className="rounded-full" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Импорт
        </Button>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => exportWords('json')} title="Экспорт JSON">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Всего: {items.length} {items.length !== 0 && `· Активных: ${items.filter((w) => w.isActive).length}`}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 rounded-xl skeleton" />)}</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <ListFilter className="h-10 w-10 mx-auto mb-2 opacity-50" />
          Нет стоп-слов
        </div>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {items.map((sw) => (
            <div key={sw.id} className="glass rounded-xl p-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-sm">{sw.word}</span>
                  <Badge variant="outline" className="text-[10px]">{CATEGORIES.find((c) => c.id === sw.category)?.label || sw.category}</Badge>
                  <Badge variant={sw.severity === 'high' ? 'destructive' : sw.severity === 'medium' ? 'outline' : 'secondary'} className="text-[10px]">{sw.severity}</Badge>
                </div>
              </div>
              <Button size="icon" variant="ghost" className="rounded-full h-8 w-8" onClick={() => toggleActive(sw)} title={sw.isActive ? 'Выключить' : 'Включить'}>
                {sw.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 opacity-40" />}
              </Button>
              <Button size="icon" variant="ghost" className="rounded-full h-8 w-8" onClick={() => setEditing(sw)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="rounded-full h-8 w-8 text-destructive" onClick={() => handleDelete(sw.id)} disabled={deletingId === sw.id}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <StopWordEditor
          word={editing}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { setEditing(null); setCreating(false); refresh() }}
        />
      )}

      {importOpen && (
        <ImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); refresh() }} />
      )}

      <StudioConfirmDialog dialog={confirmDlg} onClose={closeConfirm} />
    </div>
  )
}

function StopWordEditor({ word, onClose, onSaved }: { word: StopWord | null; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(word?.word || '')
  const [category, setCategory] = useState(word?.category || 'custom')
  const [severity, setSeverity] = useState(word?.severity || 'medium')
  const [isActive, setIsActive] = useState(word?.isActive ?? true)
  const [saving, setSaving] = useState(false)
const save = async () => {
    if (!text.trim()) return toast.error('Введите слово')
    setSaving(true)
    try {
      const body = { word: text.trim(), category, severity, isActive }
      if (word) {
        await api.patch(`/api/moderation/stop-words/${word.id}`, { json: body, auth: true })
      } else {
        await api.post('/api/moderation/stop-words', { json: body, auth: true })
      }
      toast.success('Сохранено')
      onSaved()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{word ? 'Редактировать' : 'Новое стоп-слово'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Слово</Label>
            <Input value={text} onChange={(e) => setText(e.target.value.toLowerCase())} className="rounded-2xl font-mono" placeholder="например, спам" />
          </div>
          <div>
            <Label>Категория</Label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full glass rounded-2xl px-3 py-2 text-sm">
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Строгость</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['low', 'medium', 'high'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSeverity(s)}
                  className={cn('rounded-xl px-3 py-2 text-xs font-medium border-2', severity === s ? 'border-primary bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground')}>
                  {s === 'low' ? 'Низкая' : s === 'medium' ? 'Средняя' : 'Высокая'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} id="active" />
            <Label htmlFor="active">Активно</Label>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 rounded-full h-11" onClick={onClose}>Отмена</Button>
            <Button className="flex-1 rounded-full h-11" onClick={save} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [category, setCategory] = useState('custom')
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium')
  const [saving, setSaving] = useState(false)
const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result || '')
      // Try JSON first
      try {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          setText(parsed.map((w: any) => typeof w === 'string' ? w : w.word).join('\n'))
          return
        }
        if (parsed.items && Array.isArray(parsed.items)) {
          setText(parsed.items.map((w: any) => typeof w === 'string' ? w : w.word).join('\n'))
          return
        }
      } catch {
        // Not JSON
      }
      // CSV: parse first column
      if (content.includes(',')) {
        const lines = content.split('\n').filter((l) => l.trim())
        // Skip header if it looks like one
        if (lines[0]?.toLowerCase().startsWith('word,')) lines.shift()
        setText(lines.map((l) => l.split(',')[0].trim()).join('\n'))
        return
      }
      // TXT
      setText(content)
    }
    reader.readAsText(file)
  }

  const importWords = async () => {
    const words = text.split('\n').map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0 && w.length <= 100)
    if (words.length === 0) return toast.error('Нет слов для импорта')
    setSaving(true)
    try {
      const payload = {
        words: words.map((w) => ({ word: w, category, severity })),
        mode,
      }
      const result = await api.post<{ imported: number }>('/api/moderation/stop-words/bulk', { json: payload, auth: true })
      toast.success(`Импортировано: ${result.imported}`)
      onImported()
    } catch (e: unknown) {
      toast.error('Ошибка импорта', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg rounded-3xl">
        <DialogHeader>
          <DialogTitle>Импорт стоп-слов</DialogTitle>
          <DialogDescription>Поддерживаются TXT, CSV, JSON. По одному слову на строку.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input type="file" accept=".txt,.csv,.json" onChange={handleFile} className="block w-full text-sm" />
          <div>
            <Label>Или вставьте текст вручную</Label>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="rounded-2xl font-mono text-sm min-h-[120px]" placeholder="слово1&#10;слово2&#10;слово3" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Категория</Label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full glass rounded-2xl px-3 py-2 text-sm">
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <Label>Строгость</Label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as any)} className="w-full glass rounded-2xl px-3 py-2 text-sm">
                <option value="low">Низкая</option>
                <option value="medium">Средняя</option>
                <option value="high">Высокая</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('append')} className={cn('rounded-xl px-3 py-2 text-xs font-medium border-2', mode === 'append' ? 'border-primary bg-primary/10' : 'border-border/40')}>Добавить к существующим</button>
            <button type="button" onClick={() => setMode('replace')} className={cn('rounded-xl px-3 py-2 text-xs font-medium border-2', mode === 'replace' ? 'border-primary bg-primary/10' : 'border-border/40')}>Заменить всё</button>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 rounded-full h-11" onClick={onClose}>Отмена</Button>
            <Button className="flex-1 rounded-full h-11" onClick={importWords} disabled={saving}>{saving ? 'Импорт…' : 'Импортировать'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Settings tab
// ============================================================================

interface ModerationSettings {
  enabled: boolean
  aiEnabled: boolean
  strictness: 'low' | 'medium' | 'high' | 'very_strict'
  checkLinks: boolean
  checkImages: boolean
  checkDocuments: boolean
  whitelist: string[]
  localAction: 'block' | 'censor' | 'flag'
  aiAction: 'block' | 'flag' | 'hide'
  autoWarnThreshold: number
  autoMuteThreshold: number
  autoBanThreshold: number
}

function SettingsTab() {
  const [settings, setSettings] = useState<ModerationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [whitelistText, setWhitelistText] = useState('')
const refresh = useCallback(() => {
    setLoading(true)
    api.get<ModerationSettings>('/api/moderation/settings', { auth: true })
      .then((d) => {
        setSettings(d)
        setWhitelistText((d.whitelist || []).join('\n'))
      })
      .catch(() => setSettings(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const whitelist = whitelistText.split('\n').map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0)
      await api.put('/api/moderation/settings', { json: { ...settings, whitelist }, auth: true })
      toast.success('Настройки сохранены')
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="h-32 rounded-2xl skeleton" />
  if (!settings) return <div className="text-muted-foreground text-center py-8">Ошибка загрузки</div>

  const update = (patch: Partial<ModerationSettings>) => setSettings({ ...settings, ...patch })

  return (
    <div className="space-y-4">
      {/* Master switches */}
      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Модерация включена</div>
            <div className="text-xs text-muted-foreground">Полностью включить/выключить систему</div>
          </div>
          <Switch checked={settings.enabled} onCheckedChange={(v) => update({ enabled: v })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">AI-модерация включена</div>
            <div className="text-xs text-muted-foreground">Семантический анализ через эвристики + опционально LLM</div>
          </div>
          <Switch checked={settings.aiEnabled} onCheckedChange={(v) => update({ aiEnabled: v })} />
        </div>
      </div>

      {/* Strictness */}
      <div className="glass rounded-2xl p-4 space-y-2">
        <div className="text-sm font-semibold">Уровень строгости</div>
        <div className="grid grid-cols-4 gap-2">
          {(['low', 'medium', 'high', 'very_strict'] as const).map((s) => (
            <button key={s} type="button" onClick={() => update({ strictness: s })}
              className={cn('rounded-xl px-3 py-2 text-xs font-medium border-2', settings.strictness === s ? 'border-primary bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground')}>
              {s === 'low' ? 'Низкий' : s === 'medium' ? 'Средний' : s === 'high' ? 'Высокий' : 'Очень строгий'}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="glass rounded-2xl p-4 space-y-2">
        <div className="text-sm font-semibold">Действия системы</div>
        <div>
          <Label>При локальном нарушении</Label>
          <select value={settings.localAction} onChange={(e) => update({ localAction: e.target.value as any })} className="w-full glass rounded-2xl px-3 py-2 text-sm">
            <option value="block">Блокировать отправку</option>
            <option value="censor">Цензурировать (блокировать)</option>
            <option value="flag">Разрешить, но пометить</option>
          </select>
        </div>
        <div>
          <Label>При AI-флаге</Label>
          <select value={settings.aiAction} onChange={(e) => update({ aiAction: e.target.value as any })} className="w-full glass rounded-2xl px-3 py-2 text-sm">
            <option value="block">Блокировать</option>
            <option value="flag">Пометить для проверки</option>
            <option value="hide">Скрыть (видно только админу)</option>
          </select>
        </div>
      </div>

      {/* Checks */}
      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="text-sm font-semibold">Что проверять</div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">Проверять ссылки</div>
          <Switch checked={settings.checkLinks} onCheckedChange={(v) => update({ checkLinks: v })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">Проверять изображения</div>
          <Switch checked={settings.checkImages} onCheckedChange={(v) => update({ checkImages: v })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">Проверять документы</div>
          <Switch checked={settings.checkDocuments} onCheckedChange={(v) => update({ checkDocuments: v })} />
        </div>
      </div>

      {/* Whitelist */}
      <div className="glass rounded-2xl p-4 space-y-2">
        <div className="text-sm font-semibold">Белый список слов</div>
        <div className="text-xs text-muted-foreground">Слова из этого списка никогда не блокируются (по одному на строку).</div>
        <Textarea value={whitelistText} onChange={(e) => setWhitelistText(e.target.value)} className="rounded-2xl font-mono text-sm min-h-[100px]" placeholder="alex&#10;maria&#10;support" />
      </div>

      {/* Auto-actions */}
      <div className="glass rounded-2xl p-4 space-y-2">
        <div className="text-sm font-semibold">Автоматические действия (за 24 часа)</div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>Предупреждение</Label>
            <Input type="number" min={1} max={100} value={settings.autoWarnThreshold} onChange={(e) => update({ autoWarnThreshold: Number(e.target.value) })} className="rounded-2xl" />
          </div>
          <div>
            <Label>Мут чата</Label>
            <Input type="number" min={1} max={100} value={settings.autoMuteThreshold} onChange={(e) => update({ autoMuteThreshold: Number(e.target.value) })} className="rounded-2xl" />
          </div>
          <div>
            <Label>Бан</Label>
            <Input type="number" min={1} max={100} value={settings.autoBanThreshold} onChange={(e) => update({ autoBanThreshold: Number(e.target.value) })} className="rounded-2xl" />
          </div>
        </div>
      </div>

      <Button className="w-full rounded-full h-12" onClick={save} disabled={saving}>
        {saving ? 'Сохранение…' : 'Сохранить настройки'}
      </Button>
    </div>
  )
}

// ============================================================================
// AI tab (alias showing AI-specific settings + info)
// ============================================================================

function AITab() {
  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">AI-модерация</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Система использует двухуровневый подход: локальные эвристики + опционально LLM (OpenAI-совместимый API).
          Без LLM-ключа работают встроенные эвристики (паттерны для violence, extremism, drugs, fraud, sexual_harassment, bullying, hate_speech, illegal, phishing).
        </p>
      </div>
      <div className="glass rounded-2xl p-4 space-y-2">
        <h4 className="font-semibold text-sm">Категории, обнаруживаемые AI:</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• violence — угрозы, призывы к насилию</li>
          <li>• extremism — нацизм, фашизм, экстремизм</li>
          <li>• terrorism — терроризм, шахиды, джихад</li>
          <li>• drugs — наркотики, продажа, закладки</li>
          <li>• fraud — мошенничество, фишинг, коды из СМС</li>
          <li>• sexual_harassment — сексуальные домогательства</li>
          <li>• bullying — буллинг, оскорбления</li>
          <li>• hate_speech — язык вражды</li>
          <li>• illegal — нелегальная деятельность, CP</li>
          <li>• phishing — фишинговые ссылки</li>
          <li>• bypass_attempt — попытки обхода фильтра</li>
        </ul>
      </div>
      <div className="glass rounded-2xl p-4 space-y-2">
        <h4 className="font-semibold text-sm">Подключение LLM (опционально):</h4>
        <p className="text-xs text-muted-foreground">
          Для подключения внешней LLM (OpenAI, Anthropic, Yandex GPT и т.д.) установите переменные окружения на сервере:
        </p>
        <pre className="text-xs glass rounded p-2 overflow-x-auto">
{`MODERATION_LLM_API_KEY=sk-...
MODERATION_LLM_BASE_URL=https://api.openai.com/v1
MODERATION_LLM_MODEL=gpt-4o-mini`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Без этих переменных система работает на встроенных эвристиках (полностью автономно).
        </p>
      </div>
      <div className="glass rounded-2xl p-4 space-y-2">
        <h4 className="font-semibold text-sm">Конфиденциальность:</h4>
        <p className="text-xs text-muted-foreground">
          В таблицу AIFlag сохраняется ТОЛЬКО контент, помеченный как потенциально опасный.
          Обычные приватные переписки НЕ просматриваются и НЕ сохраняются в модерации.
          Доступ к модерации имеют только администраторы через Studio.
        </p>
      </div>
    </div>
  )
}
