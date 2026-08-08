'use client'

// ============================================================================
// BrandLogo — компонент логотипа бренда TRI999.
// ----------------------------------------------------------------------------
// v25.8 (TRI999 launch): одна строка "TRI999" (gradient optional).
// Поддерживает размеры (sm/md/lg) и адаптацию под тёмную/светлую тему.
// ============================================================================

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { BRAND_NUMBER } from '@/lib/brand'

export type BrandLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type BrandLogoVariant = 'default' | 'gradient' | 'plain' | 'compact'

interface BrandLogoProps {
  size?: BrandLogoSize
  variant?: BrandLogoVariant
  /** Показывать ли иконку/точку-индикатор перед лого */
  showDot?: boolean
  className?: string
  /** Анимация появления */
  animate?: boolean
  onClick?: () => void
}

const sizeMap: Record<BrandLogoSize, { num: string }> = {
  xs: { num: 'text-base' },
  sm: { num: 'text-lg' },
  md: { num: 'text-2xl' },
  lg: { num: 'text-4xl' },
  xl: { num: 'text-5xl sm:text-6xl' },
}

export function BrandLogo({
  size = 'md',
  variant = 'default',
  showDot = false,
  className,
  animate = false,
  onClick,
}: BrandLogoProps) {
  const s = sizeMap[size]
  const numGradient = variant === 'gradient'
    ? 'text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 via-violet-500 to-fuchsia-500'
    : 'text-foreground'

  const content = (
    <div className={cn('flex items-center gap-1.5 leading-none', className)}>
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

// Версия для HTML (используется в server-side строках, где нельзя
// использовать React-компонент — например, в dangerouslySetInnerHTML
// сплеш-скрина layout.tsx).
export function brandHtml(opts?: { numSize?: string; color?: string }): string {
  const numSize = opts?.numSize ?? '32px'
  const color = opts?.color ?? '#ffffff'
  return (
    `<div style="display:flex;align-items:center;line-height:1;">` +
    `<div style="font-size:${numSize};font-weight:800;letter-spacing:-0.02em;color:${color};">TRI999</div>` +
    `</div>`
  )
}
