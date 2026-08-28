'use client'

/**
 * HomeManager — Studio visual constructor for the home page layout.
 * v25.12: redesigned to match IMG_3191 — 9 blocks.
 */

import { useEffect, useState, useCallback } from 'react'
import { Home, ArrowUp, ArrowDown, Loader2, Eye, EyeOff, Pin, PinOff } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'

// v25.16: ТА ЖЕ сортировка, что на клиенте (src/lib/home-layout.ts,
// sortHomeLayout): пиновые блоки первыми, внутри групп — по order.
// Дублируем функцию вместо кросс-импорта — у Студии свой api-клиент и свой
// бандл; тянуть модуль из фронтенда нельзя.
function sortHomeLayout<T extends { pinned?: boolean; order: number }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || a.order - b.order,
  )
}

interface HomeBlock {
  id: string
  label: string
  emoji: string
  type: string
  visible: boolean
  pinned: boolean
  order: number
}

// v25.17: синхронизировано с src/lib/home-layout.ts — Stories сразу под
// Hero-блоком. v25.20 (owner): блок «ИИ-агент» убран с главной — агент
// живёт на плавающей кнопке справа над навигацией.
const DEFAULT_BLOCKS: HomeBlock[] = [
  { id: 'hero', label: 'Hero блок', emoji: '🏠', type: 'Главный баннер', visible: true, pinned: true, order: 0 },
  { id: 'stories', label: 'Stories', emoji: '📖', type: 'Истории — сразу под Hero', visible: true, pinned: false, order: 1 },
  { id: 'categories', label: 'Категории', emoji: '🏷️', type: 'Цветные карточки', visible: true, pinned: false, order: 2 },
  { id: 'deals', label: 'Горячие скидки', emoji: '🔥', type: 'Товары со скидкой', visible: true, pinned: false, order: 3 },
  { id: 'recently-viewed', label: 'Недавно просмотренные', emoji: '👁️', type: 'Карусель просмотренных', visible: true, pinned: false, order: 4 },
  { id: 'banner', label: 'Баннер', emoji: '🎯', type: 'Промо-баннер', visible: true, pinned: false, order: 5 },
  { id: 'popular', label: 'Популярные товары', emoji: '⭐', type: 'Лучшие предложения', visible: true, pinned: false, order: 6 },
  { id: 'new', label: 'Новинки', emoji: '🆕', type: 'Свежее поступление', visible: true, pinned: false, order: 7 },
]

export function HomeManager() {
  const [blocks, setBlocks] = useState<HomeBlock[]>(DEFAULT_BLOCKS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<{ value: HomeBlock[] | null }>('/api/settings/homeLayout')
      if (res.value && Array.isArray(res.value) && res.value.length > 0) {
        const merged = DEFAULT_BLOCKS.map((d) => {
          const saved = res.value!.find((b) => b.id === d.id)
          return saved
            ? { ...d, visible: saved.visible, pinned: saved.pinned, order: saved.order ?? d.order }
            : d
        })
        // v25.16: та же сортировка, что на клиенте — то, что владелец видит
        // здесь, совпадает с реальным порядком секций на главной странице.
        setBlocks(sortHomeLayout(merged))
      }
    } catch {
      // use defaults
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (newBlocks: HomeBlock[]) => {
    setSaving(true)
    try {
      const normalized = newBlocks.map((b, i) => ({ ...b, order: i }))
      await api.put('/api/settings/homeLayout', { json: normalized, auth: true })
      setBlocks(normalized)
      toast.success('Главная страница сохранена')
    } catch (e: any) {
      toast.error('Ошибка сохранения', { description: e?.message })
    } finally {
      setSaving(false)
    }
  }

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= blocks.length) return
    const reordered = [...blocks]
    ;[reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]]
    // Нормализуем order по новой позиции ДО сохранения, иначе между
    // перезагрузками могли оставаться дублирующиеся порядковые номера
    // (вторая половина бага «перестановка не работает»).
    const normalized = reordered.map((b, i) => ({ ...b, order: i }))
    setBlocks(normalized)
    save(normalized)
  }

  const toggleVisible = (id: string) => {
    const newBlocks = blocks.map((b) => b.id === id ? { ...b, visible: !b.visible } : b)
    setBlocks(newBlocks)
    save(newBlocks)
  }

  const togglePinned = (id: string) => {
    const newBlocks = blocks.map((b) => b.id === id ? { ...b, pinned: !b.pinned } : b)
    setBlocks(newBlocks)
    save(newBlocks)
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl grid place-items-center bg-gradient-to-br from-[#EC4899] to-[#9333EA] text-white shadow-lg">
          <Home className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Главная страница</h1>
          <p className="text-sm text-muted-foreground">Управление порядком и видимостью блоков</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/40 bg-card p-4 text-xs text-muted-foreground space-y-1">
        <p>📌 <b>Закреплённые</b> блоки всегда отображаются первыми.</p>
        <p>👁 <b>Скрытые</b> блоки не показываются клиентам.</p>
        <p>⬆⬇ <b>Порядок</b> меняется кнопками вверх/вниз и применяется к главной странице сразу после сохранения (v25.16: порядок теперь реально применяется к приложению). Изменения сохраняются автоматически.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map((block, idx) => (
            <div
              key={block.id}
              className={cn(
                'rounded-2xl border bg-card p-3 flex items-center gap-2 transition-all',
                block.pinned ? 'border-primary/40 bg-primary/5' : 'border-border/40',
                !block.visible && 'opacity-50',
              )}
            >
              <div className="flex flex-col shrink-0">
                <button onClick={() => moveBlock(idx, -1)} disabled={idx === 0 || saving} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => moveBlock(idx, 1)} disabled={idx === blocks.length - 1 || saving} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="h-9 w-9 rounded-lg bg-foreground/5 grid place-items-center text-xs font-bold text-muted-foreground shrink-0">{idx + 1}</div>
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-foreground/5 to-foreground/10 grid place-items-center text-xl shrink-0">{block.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                  {block.label}
                  {block.pinned && <Pin className="h-3 w-3 text-primary" fill="currentColor" />}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{block.type}</div>
                <div className={cn('text-[10px] font-medium mt-0.5', block.visible ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                  {block.visible ? '● Видим' : '○ Скрыт'}{block.pinned ? ' · 📌 Закреплён' : ''}
                </div>
              </div>
              <button
                onClick={() => togglePinned(block.id)}
                disabled={saving}
                title={block.pinned ? 'Открепить' : 'Закрепить'}
                className={cn('h-9 w-9 rounded-lg grid place-items-center transition-colors', block.pinned ? 'bg-primary/15 text-primary' : 'bg-foreground/5 text-muted-foreground hover:bg-foreground/10')}
              >
                {block.pinned ? <Pin className="h-4 w-4" fill="currentColor" /> : <PinOff className="h-4 w-4" />}
              </button>
              <button
                onClick={() => toggleVisible(block.id)}
                disabled={saving}
                title={block.visible ? 'Скрыть' : 'Показать'}
                className={cn('h-9 w-9 rounded-lg grid place-items-center transition-colors', block.visible ? 'bg-emerald-500/15 text-emerald-600' : 'bg-foreground/5 text-muted-foreground hover:bg-foreground/10')}
              >
                {block.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}

      {saving && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-background/90 backdrop-blur-md border border-border/40 shadow-lg text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Сохранение…
        </div>
      )}
    </div>
  )
}
