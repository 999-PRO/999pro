'use client'

import { useEffect, useState } from 'react'
import { Truck, Bot, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// v25.12: PromoTopBar — верхний фиолетовый промо-баннер.
// Слева: бесплатная доставка + текст. Справа: ИИ-агент + текст.
// Закрываемый. Высота ~36px.

interface PromoTopBarProps {
  className?: string
}

export function PromoTopBar({ className }: PromoTopBarProps) {
  const [closed, setClosed] = useState(false)
  const [leftText, setLeftText] = useState('Бесплатная доставка по Москве')
  const [rightText, setRightText] = useState('ИИ-агент Зои')

  // Load from settings (optional — admin can override)
  useEffect(() => {
    api.get<{ value: { left?: string; right?: string } | null }>('/api/settings/promoTopBar')
      .then((d) => {
        if (d.value) {
          if (d.value.left) setLeftText(d.value.left)
          if (d.value.right) setRightText(d.value.right)
        }
      })
      .catch(() => {})
  }, [])

  if (closed) return null

  return (
    <div
      className={cn(
        'relative w-full bg-gradient-to-r from-[#9B2D9B] via-[#A02070] to-[#9333EA]',
        'text-white text-xs font-medium px-4 py-2 flex items-center justify-between gap-3',
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Truck className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{leftText}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Bot className="h-3.5 w-3.5" />
        <span className="hidden sm:inline truncate">{rightText}</span>
        <button
          onClick={() => setClosed(true)}
          className="ml-1 h-5 w-5 rounded-full hover:bg-white/20 grid place-items-center"
          aria-label="Закрыть"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
