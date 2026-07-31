'use client'

// ============================================================================
//  MessageContextMenu — premium bottom-sheet context menu for chat messages.
//
//  v16.8 final: полный редизайн. Раньше это было `position: fixed; top:y; left:x`
//  меню со списком кнопок — неудобно на мобильных (кнопки маленькие, далеко от
//  пальца, нет grouping). Теперь это красивый bottom sheet в стиле iOS/Telegram:
//
//    1. Backdrop с blur
//    2. Sheet выезжает снизу с spring-анимацией
//    3. Handle bar сверху (визуальный индикатор sheet)
//    4. Группировка действий в карточки:
//       — Основные действия (Ответить, Переслать, Копировать) — горизонтальный
//         ряд крупных icon-кнопок в glass-карточке
//       — Второстепенные (Избранное, Закрепить, Изменить, Скачать, Поделиться)
//         — продолжение горизонтального ряда если есть место, иначе вертикальный
//       — Опасные (Удалить у себя, Удалить у всех) — отдельная красная карточка
//       — Информация — отдельная карточка внизу
//
//  Все карточки: glass effect, rounded-2xl, hover/tap state, haptic feedback.
//  На desktop — центрируется по x:y координатам сообщения (если влезает).
//  На mobile — всегда bottom sheet (больше места, удобнее тапать).
// ============================================================================

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Reply, Forward, Copy, Star, Trash2, Info, Pin, Edit, Download, Share2, X, Flag,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { haptic } from '@/lib/haptic'

export interface MessageContextMenuProps {
  open: boolean
  x: number
  y: number
  isOwn: boolean
  hasMedia?: boolean
  hasText?: boolean
  mediaType?: 'image' | 'video' | 'audio' | 'file' | null
  onReply: () => void
  onForward: () => void
  onCopy: () => void
  onFavorite?: () => void
  /** v16.8.3: текущее состояние избранного для отображения активной иконки. */
  isFavorite?: boolean
  onPin?: () => void
  onEdit?: () => void
  onDownload?: () => void
  onShare?: () => void
  onDeleteForMe: () => void
  onDeleteForEveryone: () => void
  onInfo: () => void
  onClose: () => void
  /** v16.9: Report message for moderation. Hidden for own messages. */
  onReport?: () => void
}

interface MenuItem {
  icon: LucideIcon
  label: string
  onClick: () => void
  show: boolean
  danger?: boolean
  variant: 'primary' | 'default' | 'danger'
}

export function MessageContextMenu(props: MessageContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768

  // Phase 9: focus trap for keyboard accessibility
  useFocusTrap(ref, props.open)

  useEffect(() => {
    if (!props.open) return
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('mousedown', onClickAway)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClickAway)
      document.removeEventListener('keydown', onEsc)
    }
  }, [props.open, props.onClose])

  // Build menu items based on message type
  const allItems: MenuItem[] = ([
    { icon: Reply, label: 'Ответить', onClick: props.onReply, show: true, variant: 'primary' as const },
    { icon: Forward, label: 'Переслать', onClick: props.onForward, show: true, variant: 'primary' as const },
    { icon: Copy, label: 'Копировать', onClick: props.onCopy, show: props.hasText ?? true, variant: 'primary' as const },
    { icon: Star, label: props.isFavorite ? 'Убрать из избранного' : 'В избранное', onClick: props.onFavorite ?? (() => {}), show: !!props.onFavorite, variant: 'default' as const },
    { icon: Pin, label: 'Закрепить', onClick: props.onPin ?? (() => {}), show: !!props.onPin, variant: 'default' as const },
    { icon: Edit, label: 'Изменить', onClick: props.onEdit ?? (() => {}), show: props.isOwn && !!props.onEdit && !props.hasMedia, variant: 'default' as const },
    { icon: Download, label: 'Скачать', onClick: props.onDownload ?? (() => {}), show: !!props.onDownload && !!props.hasMedia, variant: 'default' as const },
    { icon: Share2, label: 'Поделиться', onClick: props.onShare ?? (() => {}), show: !!props.onShare && props.mediaType === 'image', variant: 'default' as const },
    // v16.9: "Пожаловаться" — moderation report. Only for others' messages.
    { icon: Flag, label: 'Пожаловаться', onClick: props.onReport ?? (() => {}), show: !props.isOwn && !!props.onReport, variant: 'default' as const },
    { icon: Trash2, label: 'Удалить у себя', onClick: props.onDeleteForMe, show: true, danger: true, variant: 'danger' as const },
    { icon: Trash2, label: 'Удалить у всех', onClick: props.onDeleteForEveryone, show: props.isOwn, danger: true, variant: 'danger' as const },
    { icon: Info, label: 'Информация', onClick: props.onInfo, show: true, variant: 'default' as const },
  ] as MenuItem[]).filter((i) => i.show)

  // Группировка для красивого отображения
  const primaryItems = allItems.filter((i) => i.variant === 'primary')
  const defaultItems = allItems.filter((i) => i.variant === 'default' && !i.danger)
  const dangerItems = allItems.filter((i) => i.danger)
  const infoItem = allItems.find((i) => i.label === 'Информация')

  const handleItemClick = (item: MenuItem) => {
    haptic.select()
    item.onClick()
    props.onClose()
  }

  // Desktop: позиционируем по x:y, но с clamp чтобы не выходило за экран.
  // Mobile: всегда bottom sheet.
  const menuWidth = 320
  const desktopX = Math.min(props.x, window.innerWidth - menuWidth - 16)
  const desktopY = Math.min(props.y, window.innerHeight - 480 - 16)

  return (
    <AnimatePresence>
      {props.open && (
        <>
          {/* Backdrop — blur + затемнение */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99,
              background: 'rgba(0,0,0,0.35)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            }}
            onClick={props.onClose}
          />

          {/* Mobile: bottom sheet. Desktop: floating panel near message. */}
          {isDesktop ? (
            <motion.div
              ref={ref}
              role="menu"
              aria-modal="true"
              aria-label="Меню сообщения"
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 10 }}
              transition={{ type: 'spring', stiffness: 600, damping: 35, mass: 0.5 }}
              style={{
                position: 'fixed',
                left: desktopX,
                top: desktopY,
                zIndex: 100,
                width: menuWidth,
              }}
              className="premium-context-menu"
              onClick={(e) => e.stopPropagation()}
            >
              <PremiumContent
                primaryItems={primaryItems}
                defaultItems={defaultItems}
                dangerItems={dangerItems}
                infoItem={infoItem}
                onItemClick={handleItemClick}
                onClose={props.onClose}
                layout="desktop"
              />
            </motion.div>
          ) : (
            <motion.div
              ref={ref}
              role="menu"
              aria-modal="true"
              aria-label="Меню сообщения"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 500, damping: 38, mass: 0.7 }}
              style={{
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 100,
                maxWidth: '32rem',
                margin: '0 auto',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
              className="premium-context-sheet"
              onClick={(e) => e.stopPropagation()}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_e, info) => {
                // Закрытие по свайпу вниз >100px
                if (info.offset.y > 100) props.onClose()
              }}
            >
              {/* Handle bar — индикатор sheet */}
              <div className="flex justify-center pt-3 pb-1.5">
                <div className="h-1.5 w-10 rounded-full bg-foreground/20" />
              </div>

              <PremiumContent
                primaryItems={primaryItems}
                defaultItems={defaultItems}
                dangerItems={dangerItems}
                infoItem={infoItem}
                onItemClick={handleItemClick}
                onClose={props.onClose}
                layout="mobile"
              />

              {/* Закрывающая кнопка внизу для удобства на mobile */}
              <div className="px-3 pb-3">
                <button
                  onClick={() => {
                    haptic.select()
                    props.onClose()
                  }}
                  className="w-full h-12 rounded-2xl bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/15 transition-colors text-foreground font-semibold text-sm flex items-center justify-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Отмена
                </button>
              </div>
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
//  PremiumContent — общая разметка для desktop и mobile layouts.
//  Состоит из секций:
//    1. Primary actions — горизонтальный ряд крупных icon-tiles (3-4 шт)
//    2. Secondary actions — вертикальный список с иконками + текстом
//    3. Danger actions — отдельная красная секция
//    4. Info — отдельная секция с информацией о сообщении
// ============================================================================

interface PremiumContentProps {
  primaryItems: MenuItem[]
  defaultItems: MenuItem[]
  dangerItems: MenuItem[]
  infoItem?: MenuItem
  onItemClick: (item: MenuItem) => void
  onClose: () => void
  layout: 'desktop' | 'mobile'
}

function PremiumContent({
  primaryItems,
  defaultItems,
  dangerItems,
  infoItem,
  onItemClick,
  layout,
}: PremiumContentProps) {
  const isMobile = layout === 'mobile'

  return (
    <div className={cn('flex flex-col gap-2', isMobile ? 'p-3' : 'p-2.5')}>
      {/* Section 1: Primary actions — горизонтальный ряд крупных плиток */}
      {primaryItems.length > 0 && (
        <div
          className={cn(
            'premium-context-card grid gap-1.5',
            primaryItems.length <= 3 ? 'grid-cols-3' : 'grid-cols-4',
          )}
        >
          {primaryItems.map((item, i) => (
            <PrimaryTile key={i} item={item} onClick={() => onItemClick(item)} />
          ))}
        </div>
      )}

      {/* Section 2: Secondary actions — вертикальный список */}
      {defaultItems.length > 0 && (
        <div className="premium-context-card overflow-hidden">
          {defaultItems.map((item, i) => (
            <SecondaryRow
              key={i}
              item={item}
              onClick={() => onItemClick(item)}
              isLast={i === defaultItems.length - 1}
            />
          ))}
        </div>
      )}

      {/* Section 3: Danger actions — отдельная красная карточка */}
      {dangerItems.length > 0 && (
        <div className="premium-context-card premium-context-danger overflow-hidden">
          {dangerItems.map((item, i) => (
            <DangerRow
              key={i}
              item={item}
              onClick={() => onItemClick(item)}
              isLast={i === dangerItems.length - 1}
            />
          ))}
        </div>
      )}

      {/* Section 4: Info — отдельная карточка внизу */}
      {infoItem && (
        <div className="premium-context-card overflow-hidden">
          <SecondaryRow item={infoItem} onClick={() => onItemClick(infoItem)} isLast />
        </div>
      )}
    </div>
  )
}

// ============================================================================
//  PrimaryTile — крупная квадратная плитка с иконкой + подписью.
//  Используется для Ответить / Переслать / Копировать.
// ============================================================================
function PrimaryTile({ item, onClick }: { item: MenuItem; onClick: () => void }) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-2xl',
        'transition-all duration-150',
        'hover:bg-primary/10 active:bg-primary/20 active:scale-95',
      )}
    >
      <div className="h-10 w-10 rounded-2xl bg-primary/15 grid place-items-center text-primary">
        <Icon className="h-5 w-5" strokeWidth={2.2} />
      </div>
      <span className="text-[11px] font-medium text-foreground/80 leading-tight text-center">
        {item.label}
      </span>
    </button>
  )
}

// ============================================================================
//  SecondaryRow — строка с иконкой слева + текстом.
//  Используется для Избранное / Закрепить / Изменить / Скачать / Информация.
// ============================================================================
function SecondaryRow({
  item,
  onClick,
  isLast,
}: {
  item: MenuItem
  onClick: () => void
  isLast: boolean
}) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-3 text-left',
        'transition-colors duration-100',
        'hover:bg-foreground/5 active:bg-foreground/10',
        !isLast && 'border-b border-border/40',
      )}
    >
      <div className="h-8 w-8 rounded-xl bg-foreground/5 grid place-items-center text-foreground/70 shrink-0">
        <Icon className="h-4 w-4" strokeWidth={2.2} />
      </div>
      <span className="text-sm font-medium text-foreground flex-1">{item.label}</span>
    </button>
  )
}

// ============================================================================
//  DangerRow — строка с красной иконкой (удаление).
// ============================================================================
function DangerRow({
  item,
  onClick,
  isLast,
}: {
  item: MenuItem
  onClick: () => void
  isLast: boolean
}) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-3 text-left',
        'transition-colors duration-100',
        'hover:bg-red-500/10 active:bg-red-500/20',
        !isLast && 'border-b border-red-500/15',
      )}
    >
      <div className="h-8 w-8 rounded-xl bg-red-500/15 grid place-items-center text-red-500 shrink-0">
        <Icon className="h-4 w-4" strokeWidth={2.2} />
      </div>
      <span className="text-sm font-semibold text-red-500 flex-1">{item.label}</span>
    </button>
  )
}
