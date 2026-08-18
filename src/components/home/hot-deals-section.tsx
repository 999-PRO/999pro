'use client'

import { useEffect, useState, useRef } from 'react'
import { Flame, Clock, Zap, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { ProductCard } from '../product-card'
import { haptic } from '@/lib/haptic'

// v25.12: HotDealsSection — секция "Горячие скидки" с таймером.
// Светло-розовый фон, заголовок + красный -33% бейдж, таймер обратного отсчёта,
// горизонтальный скролл товаров со скидкой.

interface Product {
  id: string
  title: string
  price: number
  oldPrice?: number | null
  currency?: string
  images: string[]
  [k: string]: any
}

interface HotDealsSectionProps {
  onOpenProduct: (id: string) => void
  onViewAll?: () => void
}

export function HotDealsSection({ onOpenProduct, onViewAll }: HotDealsSectionProps) {
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  // Таймер: 23:55:06 по умолчанию (как на скриншоте). Можно сделать dynamic позже.
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 55, s: 6 })
  const scrollRef = useRef<HTMLDivElement>(null)

  // Загрузка товаров со скидкой
  useEffect(() => {
    api.get<{ items: Product[]; total: number }>('/api/products', {
      query: { hasDiscount: 'true', sort: 'popular', limit: 12 },
    })
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  // Live-refresh when products change in Studio OR on pull-to-refresh
  useEffect(() => {
    const refresh = () => {
      api.get<{ items: Product[]; total: number }>('/api/products', {
        query: { hasDiscount: 'true', sort: 'popular', limit: 12, shuffle: 1, seed: Math.floor(Math.random() * 1000000) },
      })
        .then((d) => setItems(d.items || []))
        .catch(() => {})
    }
    window.addEventListener('999pro:products-changed', refresh as EventListener)
    window.addEventListener('999pro:refresh', refresh as EventListener)
    return () => {
      window.removeEventListener('999pro:products-changed', refresh as EventListener)
      window.removeEventListener('999pro:refresh', refresh as EventListener)
    }
  }, [])

  // Тик таймера каждую секунду
  useEffect(() => {
    const t = setInterval(() => {
      setTimeLeft((prev) => {
        let { h, m, s } = prev
        s -= 1
        if (s < 0) { s = 59; m -= 1 }
        if (m < 0) { m = 59; h -= 1 }
        if (h < 0) { h = 23; m = 59; s = 59 }
        return { h, m, s }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const pad = (n: number) => String(n).padStart(2, '0')

  if (!loading && items.length === 0) return null

  return (
    <section className="px-4 pt-1.5">
      <div className="rounded-3xl bg-gradient-to-br from-[#FFF0F3] via-[#FFE4EC] to-[#FFF5F7] p-4 md:p-5">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 md:h-11 md:w-11 rounded-2xl bg-gradient-to-br from-[#FF5722] to-[#FF3B30] grid place-items-center shadow-lg">
            <Flame className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg md:text-xl font-bold text-[#1A1A1A]">Горячие скидки</h2>
              <span className="inline-block px-2 py-0.5 rounded-full bg-[#FF3B30] text-white text-xs font-bold">
                -33%
              </span>
            </div>
            <p className="text-xs md:text-sm text-[#666666] mt-0.5">
              Только сегодня — успейте купить выгодно
            </p>
          </div>
        </div>

        {/* Timer */}
        <div className="flex items-center gap-3 mt-3">
          <Clock className="h-4 w-4 text-[#9B2D9B]" />
          <div className="flex items-center gap-1.5">
            {[
              { val: timeLeft.h, label: 'Ч' },
              { val: timeLeft.m, label: 'М' },
              { val: timeLeft.s, label: 'С' },
            ].map((t, i) => (
              <div key={t.label} className="flex items-center gap-1.5">
                <div className="flex flex-col items-center">
                  <div className="h-10 w-10 md:h-11 md:w-11 rounded-full bg-[#FFE4E6] grid place-items-center">
                    <span className="text-[#880E4F] font-bold text-base md:text-lg">{pad(t.val)}</span>
                  </div>
                  <span className="text-[10px] text-[#666666] mt-1">{t.label}</span>
                </div>
                {i < 2 && <span className="text-[#666666] font-bold">:</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Carousel */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 mt-4 pb-1"
        >
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-[160px] md:w-[180px] shrink-0">
                <div className="rounded-xl bg-white p-3 shadow-sm">
                  <div className="aspect-[3/4] rounded-lg skeleton" />
                  <div className="h-3 w-3/4 rounded skeleton mt-2" />
                  <div className="h-4 w-1/2 rounded skeleton mt-2" />
                </div>
              </div>
            ))
          ) : (
            items.map((p) => (
              <div key={p.id} className="w-[160px] md:w-[180px] shrink-0">
                <ProductCard product={p} onOpen={onOpenProduct} variant="deal" />
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#FFD0DC]/50">
          <div className="flex items-center gap-1.5 text-xs text-[#666666]">
            <Zap className="h-3.5 w-3.5 text-[#F59E0B]" />
            <span>Обновляется каждый день</span>
          </div>
          {onViewAll && (
            <button
              onClick={() => { haptic.tap(); onViewAll() }}
              className="text-xs md:text-sm font-semibold text-[#DC2626] hover:underline flex items-center gap-1"
            >
              Все скидки
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
