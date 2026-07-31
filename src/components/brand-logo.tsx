'use client'

// ============================================================================
// BrandLogo — компонент логотипа бренда «999 / Три девятки».
// ----------------------------------------------------------------------------
// Две строки:
//   • Первая: «999» (крупный, bold)
//   • Вторая: «Три девятки» (мельче, lighter)
// Поддерживает размеры (sm/md/lg) и адаптацию под тёмную/светлую тему.
// Используется во ВСЕХ местах приложения, где раньше стоял текст «Три девятки».
// ============================================================================

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { BRAND_NUMBER, BRAND_WORD, BRAND_WORD_EN } from '@/lib/brand'

export type BrandLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type BrandLogoVariant = 'default' | 'gradient' | 'plain' | 'compact'

interface BrandLogoProps {
  size?: BrandLogoSize
  variant?: BrandLogoVariant
  /** Язык второй строки: ru = «Три девятки», en = «Three Nines» */
  lang?: 'ru' | 'en'
  /** Показывать ли иконку/точку-индикатор перед лого */
  showDot?: boolean
  className?: string
  /** Анимация появления */
  animate?: boolean
  onClick?: () => void
}

const sizeMap: Record<BrandLogoSize, { num: string; word: string; gap: string }> = {
  xs: { num: 'text-base', word: 'text-[9px]', gap: 'gap-0' },
  sm: { num: 'text-lg', word: 'text-[10px]', gap: 'gap-0' },
  md: { num: 'text-2xl', word: 'text-xs', gap: 'gap-0.5' },
  lg: { num: 'text-4xl', word: 'text-sm', gap: 'gap-1' },
  xl: { num: 'text-5xl sm:text-6xl', word: 'text-base sm:text-lg', gap: 'gap-1.5' },
}

export function BrandLogo({
  size = 'md',
  variant = 'default',
  lang = 'ru',
  showDot = false,
  className,
  animate = false,
  onClick,
}: BrandLogoProps) {
  const s = sizeMap[size]
  const word = lang === 'en' ? BRAND_WORD_EN : BRAND_WORD
  const isCompact = variant === 'compact'
  const numGradient = variant === 'gradient'
    ? 'text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 via-violet-500 to-fuchsia-500'
    : 'text-foreground'

  // Если compact — рендерим в одну строку: «999 / Три девятки»
  if (isCompact) {
    const content = (
      <div className={cn('flex items-baseline gap-1.5', className)}>
        {showDot && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500"
            aria-hidden
          />
        )}
        <span
          className={cn(
            'font-extrabold tracking-tight leading-none',
            s.num,
            numGradient,
          )}
        >
          {BRAND_NUMBER}
        </span>
        <span
          className={cn(
            'font-light tracking-wide leading-none opacity-70',
            s.word,
            'text-foreground',
          )}
        >
          {word}
        </span>
      </div>
    )
    if (animate) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          onClick={onClick}
          role={onClick ? 'button' : undefined}
        >
          {content}
        </motion.div>
      )
    }
    return <div onClick={onClick} role={onClick ? 'button' : undefined}>{content}</div>
  }

  // Две строки (основной вариант)
  const content = (
    <div className={cn('flex flex-col items-center leading-none', s.gap, className)}>
      <div className="flex items-center gap-1.5">
        {showDot && (
          <motion.span
            className="inline-block h-2 w-2 rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-500"
            animate={animate ? { scale: [1, 1.15, 1], opacity: [0.8, 1, 0.8] } : undefined}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          />
        )}
        <span
          className={cn(
            'font-extrabold tracking-tight leading-none',
            s.num,
            numGradient,
          )}
        >
          {BRAND_NUMBER}
        </span>
      </div>
      <span
        className={cn(
          'font-light tracking-[0.2em] uppercase leading-none opacity-65',
          s.word,
          'text-foreground',
        )}
      >
        {word}
      </span>
    </div>
  )

  if (animate) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
      >
        {content}
      </motion.div>
    )
  }

  return (
    <div onClick={onClick} role={onClick ? 'button' : undefined}>
      {content}
    </div>
  )
}

// Версия для HTML (используется в server-side строках, где нельзя
// использовать React-компонент — например, в dangerouslySetInnerHTML
// сплеш-скрина layout.tsx).
export function brandHtml(opts?: { lang?: 'ru' | 'en'; numSize?: string; wordSize?: string; color?: string }): string {
  const lang = opts?.lang ?? 'ru'
  const numSize = opts?.numSize ?? '32px'
  const wordSize = opts?.wordSize ?? '12px'
  const color = opts?.color ?? '#ffffff'
  const word = lang === 'en' ? BRAND_WORD_EN : BRAND_WORD
  return (
    `<div style="display:flex;flex-direction:column;align-items:center;line-height:1;gap:4px;">` +
    `<div style="font-size:${numSize};font-weight:800;letter-spacing:-0.02em;color:${color};">999</div>` +
    `<div style="font-size:${wordSize};font-weight:300;letter-spacing:0.2em;text-transform:uppercase;color:${color};opacity:0.65;">${word}</div>` +
    `</div>`
  )
}
