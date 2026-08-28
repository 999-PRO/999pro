'use client'

// ============================================================================
//  CommunitiesManager — v25.14. Управление сообществами из Студии:
//    • создание публичных сообществ (барахолка) и ЗАКРЫТЫХ (оптовый клуб);
//    • добавление участников закрытого клуба по username / email / телефону;
//    • удаление участников, редактирование описания, обложки;
//    • удаление/скрытие объявлений внутри сообществ.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import {
  Plus, Trash2, Users, Lock, Globe, Loader2, UserPlus,
  Crown, Image as ImageIcon, MessageSquareOff,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { toast } from '@/lib/notifications'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ImageUploader } from './image-uploader'
import { cn } from '@/lib/utils'

interface CommunityRow {
  id: string
  name: string
  description?: string | null
  cover?: string | null
  type: 'public' | 'private'
  membersCount: number
  postsCount: number
}

interface MemberRow {
  userId: string
  username: string
  displayName?: string | null
  role: string
}

interface PostRow {
  id: string
  content: string
  author?: { displayName?: string | null; username?: string | null }
}

export function CommunitiesManager() {
  const [items, setItems] = useState<CommunityRow[]>([])
  const [loading, setLoading] = useState(true)

  // create form
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [cover, setCover] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  // selected community members panel
  const [selected, setSelected] = useState<CommunityRow | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [posts, setPosts] = useState<PostRow[]>([])
  const [addQuery, setAddQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: CommunityRow[] }>('/api/communities', { auth: true })
      .then((d) => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const loadSelected = useCallback(async (c: CommunityRow) => {
    setSelected(c)
    try {
      const [mem, pos] = await Promise.all([
        api.get<{ items: MemberRow[] }>(`/api/communities/${c.id}/members`, { auth: true }),
        api.get<{ items: PostRow[] }>(`/api/communities/${c.id}/posts`, { auth: true }),
      ])
      setMembers(mem.items || [])
      setPosts(pos.items || [])
    } catch { /* ignore */ }
  }, [])

  const create = async () => {
    if (!name.trim()) return toast.error('Введите название')
    setCreating(true)
    try {
      await api.post('/api/communities', {
        json: {
          name: name.trim(),
          description: description.trim() || undefined,
          type: isPrivate ? 'private' : 'public',
          cover: cover[0] || undefined,
        },
        auth: true,
      })
      toast.success('Сообщество создано')
      setName(''); setDescription(''); setCover([]); setIsPrivate(false)
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка создания')
    } finally { setCreating(false) }
  }

  const remove = async (id: string) => {
    if (!confirm('Удалить сообщество вместе с объявлениями?')) return
    try {
      await api.delete(`/api/communities/${id}`, { auth: true })
      if (selected?.id === id) setSelected(null)
      toast.success('Удалено')
      load()
    } catch (e: any) { toast.error(e?.message || 'Ошибка') }
  }

  const patch = async (id: string, data: any) => {
    try {
      await api.patch(`/api/communities/${id}`, { json: data, auth: true })
      toast.success('Сохранено')
      load()
    } catch (e: any) { toast.error(e?.message || 'Ошибка') }
  }

  const addMember = async () => {
    if (!selected || addQuery.trim().length < 3) return
    setBusy(true)
    try {
      await api.post(`/api/communities/${selected.id}/members`, { json: { query: addQuery.trim() }, auth: true })
      toast.success('Участник добавлен')
      setAddQuery('')
      await loadSelected(selected)
      load()
    } catch (e: any) { toast.error(e?.message || 'Не найден') } finally { setBusy(false) }
  }

  const removeMember = async (userId: string) => {
    if (!selected) return
    try {
      await api.delete(`/api/communities/${selected.id}/members/${userId}`, { auth: true })
      await loadSelected(selected)
      load()
      toast.success('Исключён')
    } catch (e: any) { toast.error(e?.message || 'Ошибка') }
  }

  const deletePost = async (postId: string) => {
    try {
      await api.delete(`/api/communities/posts/${postId}`, { auth: true })
      if (selected) await loadSelected(selected)
      load()
      toast.success('Объявление удалено')
    } catch (e: any) { toast.error(e?.message || 'Ошибка') }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" /> Сообщества
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Публичные доски объявлений и закрытые клубы (например, оптовые цены). Владелец сам приглашает оптовиков в закрытый клуб.
        </p>
      </div>

      {/* Create form */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <Label className="text-base font-semibold">Новое сообщество</Label>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Название</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Оптовый клуб / Барахолка" maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label>Тип</Label>
            <div className={cn(
              'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
              isPrivate ? 'border-violet-500/50 bg-violet-500/5' : 'border-emerald-500/40 bg-emerald-500/5',
            )}>
              <span className="text-sm inline-flex items-center gap-2 font-medium">
                {isPrivate ? (<><Lock className="h-4 w-4 text-violet-500" /> Закрытый (по приглашениям)</>) : (<><Globe className="h-4 w-4 text-emerald-500" /> Открытый</>)}
              </span>
              <Switch checked={isPrivate} onCheckedChange={(v) => setIsPrivate(v)} aria-label="Закрытое сообщество" />
            </div>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="c-desc">Описание</Label>
            <Input id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Для кого сообщество и что здесь публикуют" maxLength={600} />
          </div>
          <div className="md:col-span-2">
            <ImageUploader value={cover} onChange={setCover} aspect="banner" label="Обложка (опционально)" />
          </div>
        </div>
        <Button onClick={create} disabled={creating || !name.trim()} className="gap-2">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Создать сообщество
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">Пока нет ни одного сообщества</div>
      ) : (
        <div className="space-y-2.5">
          {items.map((c) => (
            <div key={c.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start gap-3">
                {c.cover ? (
                  <img src={assetUrl(c.cover)} alt="" className="h-12 w-20 rounded-lg object-cover shrink-0" />
                ) : (
                  <span className={cn('h-12 w-20 rounded-lg grid place-items-center shrink-0 text-white', c.type === 'private' ? 'bg-gradient-to-br from-[#312E81] to-[#6D28D9]' : 'bg-gradient-to-br from-[#065F46] to-[#10B981]')}>
                    <ImageIcon className="h-4 w-4 opacity-70" />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.description || '—'}</div>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => loadSelected(c)}>
                  <Users className="h-3.5 w-3.5" /> Открыть ({c.membersCount})
                </Button>
                <button
                  onClick={() => remove(c.id)}
                  className="h-9 w-9 rounded-full grid place-items-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Удалить сообщество"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Inline quick actions */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold',
                  c.type === 'private' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                )}>
                  {c.type === 'private' ? <><Lock className="h-3 w-3" /> Закрытый · опт</> : <><Globe className="h-3 w-3" /> Публичный</>}
                </span>
                <button
                  onClick={() => patch(c.id, { type: c.type === 'private' ? 'public' : 'private' })}
                  className="text-xs text-primary hover:underline"
                >
                  переключить тип
                </button>
                <span className="text-xs text-muted-foreground">· {c.postsCount} объявлений</span>
              </div>

              {/* Selected community detail */}
              {selected?.id === c.id && (
                <div className="rounded-xl border border-dashed border-border p-3.5 space-y-4 bg-background/40">
                  {/* Members */}
                  <div>
                    <Label className="mb-2">Участники ({members.length})</Label>
                    <div className="flex gap-2 mb-2">
                      <Input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="username / email / телефон участника" className="h-9 text-sm" onKeyDown={(e) => e.key === 'Enter' && addMember()} />
                      <Button size="sm" className="h-9 gap-1.5 whitespace-nowrap" onClick={addMember} disabled={busy}>
                        <UserPlus className="h-3.5 w-3.5" /> Добавить
                      </Button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-1.5">
                      {members.map((m) => (
                        <div key={m.userId} className="flex items-center gap-2 rounded-xl border border-border/60 px-2.5 py-1.5">
                          <span className="text-sm font-medium truncate flex-1">
                            {m.displayName || m.username}
                            {m.role === 'owner' && <Crown className="inline h-3.5 w-3.5 ml-1 text-amber-500" />}
                          </span>
                          {m.role !== 'owner' && (
                            <button onClick={() => removeMember(m.userId)} className="text-xs text-destructive hover:underline shrink-0">
                              исключить
                            </button>
                          )}
                        </div>
                      ))}
                      {members.length === 0 && <div className="text-xs text-muted-foreground">Нет участников</div>}
                    </div>
                  </div>

                  {/* Posts */}
                  <div>
                    <Label className="mb-2 flex items-center gap-1.5"><MessageSquareOff className="h-3.5 w-3.5" /> Объявления ({posts.length})</Label>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {posts.map((p) => (
                        <div key={p.id} className="flex items-start gap-2 rounded-xl border border-border/60 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm line-clamp-2">{p.content}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">{p.author?.displayName || p.author?.username}</div>
                          </div>
                          <button onClick={() => deletePost(p.id)} className="h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0" aria-label="Удалить объявление">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      {posts.length === 0 && <div className="text-xs text-muted-foreground">Объявлений пока нет</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
