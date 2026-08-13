'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ArrowLeft, Heart } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { useFavoritesStore } from '@/lib/cart-store'
import { formatPrice } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { InteractiveSheet } from '@/components/ui/interactive-sheet'
import type { Product } from '@/lib/types'

export function FavoritesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // v10-perf: subscribe ONLY to `ids` instead of the whole store. The
  // previous `useFavoritesStore()` (no selector) re-rendered this component
  // on EVERY store update (including unrelated `toggle` calls from other
  // components), and returned a new object reference each time. Now we
  // subscribe to the `ids` array (stable reference unless it actually
  // changes) and call the `toggle`/`has` actions separately.
  const ids = useFavoritesStore((s) => s.ids)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const idsKey = ids.join(',')

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    if (ids.length === 0) {
      setProducts([])
      setLoading(false)
      return
    }
    // Single batch request — fixes N+1 (one request per favorite) and
    // keeps the order stable so the UI doesn't shuffle on every reopen.
    api
      .get<{ items: Product[] }>('/api/products/batch', {
        query: { ids: ids.join(',') },
      })
      .then((res) => {
        if (!alive) return
        // Preserve the user's favorites order
        const byId = new Map(res.items.map((p) => [p.id, p]))
        setProducts(ids.map((id) => byId.get(id)).filter(Boolean) as Product[])
      })
      .catch(() => {
        if (!alive) return
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey])

  if (!open) return null

  return (
    <InteractiveSheet
      open={open}
      onClose={onClose}
      side="bottom"
      ariaLabel="Избранное"
      desktopWidth={520}
      panelClassName="bg-background border-border/40 max-h-[100vh] md:max-h-full"
      renderDragHandle={() => (
        <div
          className="flex items-center gap-3 px-4 py-3 border-b border-border/40 glass-strong sticky top-0 z-10"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <button
            onClick={onClose}
            aria-label="Закрыть избранное"
            className="h-11 w-11 -ml-1 rounded-full hover:bg-accent transition-colors shrink-0 grid place-items-center"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-bold flex-1">Избранное</h2>
          <span className="text-sm text-muted-foreground">{ids.length}</span>
        </div>
      )}
    >
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-4 md:px-6 pt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden glass">
              <div className="aspect-[3/4] skeleton" />
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <div className="h-20 w-20 rounded-full glass grid place-items-center mb-4">
            <Heart className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-bold mb-1">У вас пока нет избранных товаров</h3>
          <p className="text-sm text-muted-foreground mb-5">Нажмите ♥ на товаре, чтобы добавить его сюда</p>
          <Button
            onClick={() => {
              const url = new URL(window.location.href)
              url.searchParams.set('view', 'catalog')
              window.history.pushState({}, '', url.toString())
              window.dispatchEvent(new PopStateEvent('popstate'))
              onClose()
            }}
            className="rounded-full gradient-brand text-white font-semibold shadow-glow h-11 px-6"
          >
            Открыть каталог
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 p-4 md:px-6 pt-4 pb-8">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.set('product', p.id)
                  window.history.pushState({}, '', url.toString())
                  window.dispatchEvent(new PopStateEvent('popstate'))
                  onClose()
                }}
                className="text-left rounded-xl overflow-hidden glass hover:shadow-glow transition-all hover:-translate-y-0.5"
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-muted/40">
                  {p.images?.[0] && (
                    // F-CRIT-001: next/image fill. Parent div promoted to
                    // `relative` so the absolutely-positioned <Image> snaps
                    // to the square cell. `sizes` matches the responsive
                    // grid (2-5 cols).
                    <Image
                      src={assetUrl(p.images[0])}
                      alt={p.title}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1280px) 25vw, 20vw"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-semibold truncate">{p.title}</div>
                  {/* QW6 (F-BUG-008): use formatPrice for currency-aware formatting */}
                  <div className="text-sm font-bold text-primary">{formatPrice(p.price, p.currency)}</div>
                </div>
              </button>
            ))}
        </div>
      )}
    </InteractiveSheet>
  )
}
