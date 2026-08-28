'use client'

// ============================================================================
// v25.24 — CollapsibleText: длинный текст сворачивается/разворачивается
// («Показать ещё» / «Свернуть») — как просил владелец, для комментариев,
// описаний и постов. Определяет переполнение сам (scrollHeight).
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function CollapsibleText({
  text,
  maxLines = 6,
  className,
  buttonClassName,
}: {
  text: string
  maxLines?: number
  className?: string
  buttonClassName?: string
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 2)
    check()
    // пересчитать после загрузки шрифтов/картинок
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  return (
    <div>
      <p
        ref={ref}
        className={cn(!expanded && overflowing && 'overflow-hidden', className)}
        style={
          !expanded && overflowing
            ? {
                display: '-webkit-box',
                WebkitLineClamp: maxLines,
                WebkitBoxOrient: 'vertical',
              }
            : undefined
        }
      >
        {text}
      </p>
      {overflowing && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'mt-1 inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80 transition-colors',
            buttonClassName,
          )}
        >
          {expanded ? 'Свернуть' : 'Показать ещё'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}
