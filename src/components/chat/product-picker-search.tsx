'use client'

// ============================================================================
// ProductPickerSearch — компактное окно поиска товаров для отправки в чат.
// ----------------------------------------------------------------------------
// v16.9-final: Открывается постоянной кнопкой 🛍 в нижней панели чата
// (ранее — через пункт «Товар» в AttachmentsBottomSheet, который удалён).
// НЕ открывает полный каталог — только компактный поиск:
//   • Строка поиска (real-time)
//   • Список товаров (с ленивой загрузкой)
//   • Клик по товару → отправка карточки в чат + закрытие
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, ShoppingBag, Loader2 } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

interface ProductPickerSearchProps {
  open: boolean
  onClose: () => void
  onSelect: (product: Product) => void
}

export function ProductPickerSearch({ open, onClose, onSelect }: ProductPickerSearchProps) {
  useScrollLock(open)
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setProducts([])
      setTouched(false)
      setTimeout(() => inputRef.current?.focus(), 250)
    }
  }, [open])

  // Debounced search.
  // v16.9.1-fix: backend ожидает параметр `q` (а не `search`), иначе фильтр
  // не применяется и возвращается весь каталог.
  const search = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (trimmed.length < 1) {
      setProducts([])
      setTouched(false)
      return
    }
    setLoading(true)
    try {
      const data = await api.get<{ items: Product[] }>(
        `/api/products?q=${encodeURIComponent(trimmed)}&limit=20`,
        { auth: false },
      )
      setProducts(data.items || [])
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
      setTouched(true)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 280)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, search])

  const handleSelect = (product: Product) => {
    onSelect(product)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[97] bg-black/40"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36, mass: 0.9 }}
            className="fixed left-0 right-0 bottom-0 z-[98] mx-auto max-w-md"
            style={{ maxHeight: '80vh' }}
          >
            <div
              className="rounded-t-[28px] overflow-hidden flex flex-col"
              style={{
                background: 'color-mix(in oklch, var(--card) 92%, transparent)',
                backdropFilter: 'blur(28px) saturate(160%)',
                WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                border: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
                borderBottom: 'none',
                boxShadow: '0 -10px 40px -10px rgba(15,23,42,0.3)',
                maxHeight: '80vh',
              }}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="h-1 w-10 rounded-full bg-foreground/20" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-2">
                <div className="flex items-center gap-2">
                  <div className="grid place-items-center h-7 w-7 rounded-lg" style={{ background: 'var(--gradient-brand)' }}>
                    <ShoppingBag className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="text-base font-semibold">Отправить товар</div>
                </div>
                <button
                  onClick={onClose}
                  className="h-8 w-8 rounded-full grid place-items-center hover:bg-foreground/5 active:scale-90 transition-all"
                  aria-label="Закрыть"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Search bar */}
              <div className="px-4 pb-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Поиск товаров..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-background/60 border border-border/40 outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>

              {/* Results.
                  v16.9.1-fix: `min-h-0` обязателен для flex-child чтобы он
                  мог сжиматься внутри flex-col родителя и `overflow-y-auto`
                  реально работал. Без min-h-0 внутренний контент растягивает
                  родителя и скролл ломается (особенно на iOS Safari).
                  `-webkit-overflow-scrolling: touch` включает нативную
                  инерционную прокрутку на iOS. `overscroll-contain` не даёт
                  скроллу "протекать" в фоновой странице. */}
              <div
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  scrollBehavior: 'smooth',
                }}
              >
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}

                {!loading && touched && products.length === 0 && query.trim() && (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    <div className="text-3xl mb-2 opacity-50">🔍</div>
                    Товар не найден
                  </div>
                )}

                {!loading && !touched && !query.trim() && (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    <div className="text-3xl mb-2 opacity-50">🛍</div>
                    Начните вводить название товара
                  </div>
                )}

                {!loading && products.length > 0 && (
                  <div className="space-y-1.5 py-1">
                    {products.map((product) => (
                      <button
                        key={product.id}
                        onClick={() => handleSelect(product)}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-foreground/5 active:scale-[0.98] transition-all text-left"
                      >
                        <div className="shrink-0 h-12 w-12 rounded-lg overflow-hidden bg-foreground/5 grid place-items-center">
                          {product.images?.[0] ? (
                             
                            <img src={assetUrl(product.images[0])} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{product.title}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {product.category}
                          </div>
                        </div>
                        {product.price != null && (
                          <div className="text-sm font-bold text-primary shrink-0">
                            {product.price} ₽
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
