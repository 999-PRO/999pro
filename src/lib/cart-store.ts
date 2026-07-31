'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CartItem {
  productId: string
  title: string
  price: number
  image: string
  quantity: number
}

interface CartState {
  items: CartItem[]
  add: (item: Omit<CartItem, 'quantity'>, qty?: number) => void
  remove: (productId: string) => void
  setQty: (productId: string, qty: number) => void
  increment: (productId: string) => void
  decrement: (productId: string) => void
  clear: () => void
  count: () => number
  total: () => number
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item, qty = 1) =>
        set((s) => {
          const existing = s.items.find((i) => i.productId === item.productId)
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.productId === item.productId
                  ? { ...i, quantity: i.quantity + qty }
                  : i,
              ),
            }
          }
          return { items: [...s.items, { ...item, quantity: qty }] }
        }),
      remove: (productId) =>
        set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
      setQty: (productId, qty) =>
        set((s) => ({
          items: s.items
            .map((i) => (i.productId === productId ? { ...i, quantity: Math.max(1, qty) } : i))
            .filter((i) => i.quantity > 0),
        })),
      increment: (productId) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i,
          ),
        })),
      decrement: (productId) =>
        set((s) => ({
          items: s.items
            .map((i) =>
              i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i,
            )
            .filter((i) => i.quantity > 0),
        })),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((n, i) => n + i.quantity, 0),
      total: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),
    }),
    { name: '999pro-cart' },
  ),
)

interface FavoritesState {
  ids: string[]
  toggle: (id: string) => void
  has: (id: string) => boolean
  setMany: (ids: string[]) => void
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (id) =>
        set((s) => ({
          ids: s.ids.includes(id)
            ? s.ids.filter((x) => x !== id)
            : [...s.ids, id],
        })),
      has: (id) => get().ids.includes(id),
      setMany: (ids) => set({ ids }),
    }),
    { name: '999pro-favorites' },
  ),
)
