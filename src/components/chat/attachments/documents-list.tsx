'use client'

// ============================================================================
// DocumentsList — список документов из чата.
// ----------------------------------------------------------------------------
// Возможности:
//   • Сортировка: по дате / имени / размеру
//   • Быстрый поиск
//   • Фильтрация по типу файла (PDF, DOCX, etc.)
//   • Клик открывает файл
// ============================================================================

import { useState, useMemo } from 'react'
import { FileText, Search, Download, ArrowUpDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatTime } from '@/lib/format'
import type { DocumentItem } from '../hooks/use-chat-attachments'

type SortMode = 'date' | 'name' | 'size'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'date', label: 'По дате' },
  { value: 'name', label: 'По имени' },
  { value: 'size', label: 'По размеру' },
]

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileExt(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop()!.toUpperCase() : 'FILE'
}

interface DocumentsListProps {
  documents: DocumentItem[]
  onScrollToMessage?: (id: string) => void
}

export function DocumentsList({ documents, onScrollToMessage }: DocumentsListProps) {
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('date')
  const [sortOpen, setSortOpen] = useState(false)

  const filtered = useMemo(() => {
    let arr = documents
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter((d) => d.name.toLowerCase().includes(q) || d.senderName.toLowerCase().includes(q))
    }
    const sorted = [...arr]
    switch (sortMode) {
      case 'date':
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        break
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        break
      case 'size':
        sorted.sort((a, b) => (b.size || 0) - (a.size || 0))
        break
    }
    return sorted
  }, [documents, search, sortMode])

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4 bg-foreground/5">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold mb-1">Документов пока нет</div>
        <div className="text-sm text-muted-foreground">
          Отправленные файлы появятся здесь
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 py-3">
      {/* Search + sort */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск документов..."
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-card/60 border border-border/40 outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setSortOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm glass border border-border/40 active:scale-95"
            aria-label="Сортировка"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
          <AnimatePresence>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute right-0 top-full mt-1 z-20 rounded-xl glass-strong border border-border/40 shadow-xl py-1 min-w-[160px]"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSortMode(opt.value)
                        setSortOpen(false)
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm hover:bg-foreground/5',
                        sortMode === opt.value ? 'text-primary font-medium' : 'text-foreground',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* List */}
      <div className="space-y-1">
        {filtered.map((doc) => {
          const ext = getFileExt(doc.name)
          return (
            <div
              key={doc.id}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-card/50 border border-border/30 hover:bg-card/80 transition-colors"
            >
              <div className="relative shrink-0 h-11 w-11 rounded-xl grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                <FileText className="h-5 w-5 text-white" />
                <span className="absolute -bottom-1 -right-1 px-1 py-0.5 rounded text-[8px] font-bold bg-background text-foreground border border-border/40">
                  {ext}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{doc.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{doc.senderName}</span>
                  <span>·</span>
                  <span>{formatTime(doc.createdAt)}</span>
                  {doc.size && (
                    <>
                      <span>·</span>
                      <span>{formatSize(doc.size)}</span>
                    </>
                  )}
                </div>
              </div>
              <a
                href={assetUrl(doc.url)}
                download={doc.name}
                className="shrink-0 h-9 w-9 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
                aria-label="Скачать"
              >
                <Download className="h-4 w-4" />
              </a>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          Ничего не найдено
        </div>
      )}
    </div>
  )
}
