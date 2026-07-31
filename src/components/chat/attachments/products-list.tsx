'use client'

// ============================================================================
// ProductsList — список товаров из чата.
// ----------------------------------------------------------------------------
// Карточки товаров, отправленных в чате (mediaType='product').
// Клик открывает товар (через onOpenProduct).
// ============================================================================

import { useState, useEffect } from 'react'
import { ShoppingBag } from 'lucide-react'
import { assetUrl, api } from '@/lib/api'
import { formatTime } from '@/lib/format'
import type { ProductItem } from '../hooks/use-chat-attachments'
import type { Product } from '@/lib/types'

interface ProductsListProps {
  products: ProductItem[]
  onOpenProduct?: (productId: string) => void
  onScrollToMessage?: (id: string) => void
}

export function ProductsList({ products, onOpenProduct, onScrollToMessage }: ProductsListProps) {
  const [productData, setProductData] = useState<Record<string, Product | null>>({})

  // Batch fetch product data.
  useEffect(() => {
    if (products.length === 0) return
    const ids = products.map((p) => p.productId).filter((id) => !(id in productData))
    if (ids.length === 0) return

    let cancelled = false
    void api
      .get<{ items: Product[] }>(`/api/products/batch?ids=${ids.join(',')}`, { auth: false })
      .then((data) => {
        if (cancelled) return
        const map: Record<string, Product | null> = {}
        for (const id of ids) {
          const found = data.items?.find((p) => p.id === id)
          map[id] = found || null
        }
        setProductData((prev) => ({ ...prev, ...map }))
      })
      .catch(() => {
        if (cancelled) return
        const map: Record<string, Product | null> = {}
        for (const id of ids) map[id] = null
        setProductData((prev) => ({ ...prev, ...map }))
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products])

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4 bg-foreground/5">
          <ShoppingBag className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold mb-1">Товаров пока нет</div>
        <div className="text-sm text-muted-foreground">
          Карточки товаров из чата появятся здесь
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 py-3 grid grid-cols-2 gap-2">
      {products.map((item) => {
        const product = productData[item.productId]
        return (
          <button
            key={item.id}
            onClick={() => onOpenProduct?.(item.productId)}
            className="flex flex-col rounded-2xl overflow-hidden bg-card/50 border border-border/30 hover:border-primary/30 transition-all active:scale-95 text-left"
          >
            <div className="aspect-square bg-foreground/5 grid place-items-center">
              {product?.images?.[0] ? (
                 
                <img src={assetUrl(product.images[0])} alt="" className="h-full w-full object-cover" />
              ) : (
                <ShoppingBag className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="p-2.5 flex-1">
              <div className="text-sm font-medium line-clamp-2 mb-1">
                {product?.title || 'Загрузка...'}
              </div>
              {product?.price != null && (
                <div className="text-base font-bold text-primary flex items-center">
                  {product.price} ₽
                </div>
              )}
              <div className="text-[10px] text-muted-foreground mt-1">
                {item.senderName} · {formatTime(item.createdAt)}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
