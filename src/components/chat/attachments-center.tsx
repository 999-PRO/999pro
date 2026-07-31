'use client'

// ============================================================================
// AttachmentsCenter — горизонтальная панель категорий-фильтров чата.
// ----------------------------------------------------------------------------
// v16.8.3: ПОЛНАЯ ПЕРЕДЕЛКА.
//   • Категории больше не открывают отдельные экраны.
//   • Каждая категория — отдельная стеклянная кнопка (без общего контейнера).
//   • При выборе категории сообщения в чате ФИЛЬТРУЮТСЯ — остаются только
//     подходящие. Никаких переходов, никаких "Назад".
//   • "Все" — показывает весь чат.
//   • Плавная анимация появления/исчезновения сообщений.
//
// Категории:
//   💬 Все | 🖼 Фото | 🎥 Видео | 🎵 Музыка | 🎤 Голосовые | 📄 Документы |
//   🔗 Ссылки | ⭐ Избранное | 🛍 Товары
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutGrid, Image, Video, Music, Mic, FileText, Link2, ShoppingBag, Star, Music2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatAttachments, type ChatAttachments } from './hooks/use-chat-attachments'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { useEffect, useState } from 'react'
import type { Message } from '@/lib/types'

export type CategoryId =
  | 'all'
  | 'photos'
  | 'videos'
  | 'music'
  | 'voices'
  | 'documents'
  | 'links'
  | 'products'
  | 'audio-hub'
  | 'favorites'

interface CategoryDef {
  id: CategoryId
  label: string
  icon: typeof LayoutGrid
}

const CATEGORIES: CategoryDef[] = [
  { id: 'all', label: 'Все', icon: LayoutGrid },
  { id: 'photos', label: 'Фото', icon: Image },
  { id: 'videos', label: 'Видео', icon: Video },
  { id: 'music', label: 'Музыка', icon: Music },
  { id: 'voices', label: 'Голосовые', icon: Mic },
  { id: 'documents', label: 'Документы', icon: FileText },
  { id: 'links', label: 'Ссылки', icon: Link2 },
  { id: 'products', label: 'Товары', icon: ShoppingBag },
  { id: 'audio-hub', label: 'Audio Hub', icon: Music2 },
  { id: 'favorites', label: 'Избранное', icon: Star },
]

function getCategoryCount(id: CategoryId, att: ChatAttachments, favCount: number): number {
  switch (id) {
    case 'all': return att.totalCount
    case 'photos': return att.photos.length
    case 'videos': return att.videos.length
    case 'music': return att.music.length
    case 'voices': return att.voices.length
    case 'documents': return att.documents.length
    case 'links': return att.links.length
    case 'products': return att.products.length
    case 'audio-hub': return att.audioHub.length
    case 'favorites': return favCount
  }
}

interface AttachmentsCenterProps {
  messages: Message[]
  activeCategory: CategoryId
  onCategoryChange: (cat: CategoryId) => void
  favoriteIds: Set<string>
}

export function AttachmentsCenter({
  messages,
  activeCategory,
  onCategoryChange,
  favoriteIds,
}: AttachmentsCenterProps) {
  const attachments = useChatAttachments(messages)

  // Don't render the bar if there are no attachments at all AND no favorites.
  if (attachments.totalCount === 0 && favoriteIds.size === 0) return null

  return (
    <div className="shrink-0 relative z-30">
      <div
        // v16.8.7: data-scroll-lock-ignore — КРИТИЧНО для горизонтального
        // скролла. useScrollLock (активен когда чат открыт) вешает touchmove
        // listener на document, который preventDefault'ит все touchmove,
        // КРОМЕ тех, что внутри [data-scroll-lock-ignore]. Без этого атрибута
        // горизонтальный свайп по категориям блокируется.
        data-scroll-lock-ignore
        className="flex items-center gap-2 px-3 py-2 overflow-x-auto no-scrollbar"
        style={{
          // v16.8.7: полностью рабочий горизонтальный скролл.
          // -webkit-overflow-scrolling: touch — нативная инерция на iOS.
          // overscroll-behavior-x: contain — блокирует chain scrolling.
          // touch-action: pan-x pan-y — разрешает ОБА направления.
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorX: 'contain',
          touchAction: 'pan-x pan-y',
        }}
      >
        {CATEGORIES.map((cat) => {
          const count = getCategoryCount(cat.id, attachments, favoriteIds.size)
          // Hide empty categories (except "all" and "favorites").
          if (count === 0 && cat.id !== 'all' && cat.id !== 'favorites') return null
          const Icon = cat.icon
          const active = activeCategory === cat.id
          return (
            <motion.button
              key={cat.id}
              onClick={() => onCategoryChange(cat.id)}
              whileTap={{ scale: 0.94 }}
              className={cn(
                'relative shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium transition-colors',
                active
                  ? 'text-white'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              style={
                active
                  ? {
                      background: 'var(--gradient-brand)',
                      boxShadow: '0 4px 16px -4px rgba(37,99,235,0.45)',
                    }
                  : {
                      background: 'color-mix(in oklch, var(--card) 60%, transparent)',
                      backdropFilter: 'blur(16px) saturate(140%)',
                      WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                      border: '1px solid color-mix(in oklch, var(--border) 50%, transparent)',
                    }
              }
              aria-label={cat.label}
              aria-pressed={active}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{cat.label}</span>
              <AnimatePresence>
                {count > 0 && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      'ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-none tabular-nums',
                      active
                        ? 'bg-white/25 text-white'
                        : 'bg-foreground/10 text-muted-foreground',
                    )}
                  >
                    {count > 99 ? '99+' : count}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
