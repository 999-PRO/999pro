'use client'

// ============================================================================
// EmojiPicker — стеклянная панель эмодзи для чата.
//
// Появляется над полем ввода (НЕ Bottom Sheet, НЕ отдельная страница).
// Использует тот же "glass capsule" язык, что и остальные элементы нижней
// панели: backdrop-blur, color-mix card, мягкая тень, фирменный градиент.
//
// Вставляет выбранный эмодзи в текстовое поле через onPick(emoji).
// Закрывается по клику вне панели (обрабатывается родителем через ref).
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useRef, useEffect } from 'react'
import { haptic } from '@/lib/haptic'

// ============================================================================
// Кураторская подборка эмодзи — 6 категорий, ~150 глифов.
// Намеренно БЕЗ библиотек (emoji-mart и т.п.) — меньше зависимостей,
// мгновенная загрузка, нулевой runtime. Глифы берутся напрямую из системного
// шрифта (Apple Color Emoji / Noto Color Emoji / Segoe UI Emoji).
// ============================================================================

const CATEGORIES = [
  {
    id: 'smileys',
    label: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
      '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩',
      '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖',
      '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯',
      '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔',
      '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦',
      '😴', '🤤', '😪', '🥱', '🤐', '🤢', '🤮', '🤧', '😷', '🤒',
    ],
  },
  {
    id: 'gestures',
    label: '👍',
    emojis: [
      '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🫞', '🤟', '🤘',
      '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋',
      '🖖', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳',
      '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷',
      '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸', '👶', '🧒', '👦',
    ],
  },
  {
    id: 'hearts',
    label: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌',
      '💍', '💎', '🔥', '✨', '⭐', '🌟', '💫', '⚡', '💥', '🌈',
      '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '❄️',
      '⛄', '🌊', '💧', '💦', '💨', '🎯', '🏆', '🥇', '🎁', '🎈',
    ],
  },
  {
    id: 'animals',
    label: '🐶',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆',
      '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🦋', '🐌',
      '🐞', '🐜', '🐢', '🐍', '🦎', '🦖', '🐙', '🦑', '🦐', '🦞',
      '🦀', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆',
    ],
  },
  {
    id: 'food',
    label: '🍔',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐',
      '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑',
      '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔',
      '🍠', '🥐', '🥯', '🍞', '🥖', '🧀', '🥚', '🍳', '🥞', '🧇',
      '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙',
      '🌮', '🌯', '🥗', '🥘', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱',
    ],
  },
  {
    id: 'activity',
    label: '⚽',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸',
      '🥅', '⛳', '🏹', '🎣', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️',
      '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤺', '🤾',
      '🏌️', '🏄', '🏊', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈',
      '🥉', '🏅', '🎬', '🎭', '🎨', '🎵', '🎲', '🧩', '🎯', '🎮',
      '🕹️', '🎰', '🚗', '🚕', '🚙', '🏃', '🕺', '💃', '🎉', '🎊',
    ],
  },
] as const

interface EmojiPickerProps {
  open: boolean
  onClose: () => void
  onPick: (emoji: string) => void
}

export function EmojiPicker({ open, onClose, onPick }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  // Закрытие по клику вне панели
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // pointerdown срабатывает раньше click, не давая кнопкам-эмодзи "прокликнуться" сквозь закрытие
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, onClose])

  const handlePick = (emoji: string) => {
    haptic.tap()
    onPick(emoji)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="mb-2 rounded-3xl overflow-hidden"
          style={{
            background: 'color-mix(in oklch, var(--card) 78%, transparent)',
            backdropFilter: 'blur(24px) saturate(160%)',
            WebkitBackdropFilter: 'blur(24px) saturate(160%)',
            border: '1px solid color-mix(in oklch, var(--border) 55%, transparent)',
            boxShadow:
              '0 8px 32px -8px rgba(15,23,42,0.18), 0 0 0 1px color-mix(in oklch, var(--primary) 4%, transparent) inset',
          }}
        >
          {/* Категории — компактный горизонтальный таб-бар */}
          <div
            className="flex items-center gap-1 px-2 pt-2 pb-1.5 overflow-x-auto no-scrollbar"
            style={{
              borderBottom:
                '1px solid color-mix(in oklch, var(--border) 35%, transparent)',
            }}
          >
            {CATEGORIES.map((cat, idx) => (
              <button
                key={cat.id}
                onClick={() => {
                  haptic.tap()
                  setActiveCategory(idx)
                }}
                className="shrink-0 h-8 w-8 rounded-full grid place-items-center text-base transition-all active:scale-90"
                style={{
                  background:
                    activeCategory === idx
                      ? 'var(--gradient-brand)'
                      : 'transparent',
                  opacity: activeCategory === idx ? 1 : 0.55,
                  boxShadow:
                    activeCategory === idx
                      ? '0 2px 8px -2px rgba(37,99,235,0.4)'
                      : 'none',
                }}
                aria-label={cat.id}
              >
                <span className="leading-none">{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Сетка эмодзи */}
          <div className="grid grid-cols-8 gap-0.5 p-2 max-h-[200px] overflow-y-auto no-scrollbar">
            {CATEGORIES[activeCategory].emojis.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                onClick={() => handlePick(emoji)}
                className="h-9 w-9 grid place-items-center text-xl leading-none rounded-xl transition-all hover:bg-foreground/5 active:scale-90 active:bg-foreground/10"
              >
                {emoji}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
