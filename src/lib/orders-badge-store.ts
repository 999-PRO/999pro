// Orders notification badge store — counts unseen order status changes.
//
// v16.3: When the admin changes an order's status (pending→paid→shipped→
// delivered→cancelled), the backend emits `order:status-changed` socket
// event. orders-view.tsx listens for it and calls incrementOrdersBadge().
// When the user opens the Orders view, clearOrdersBadge() resets the count.
//
// Persisted to localStorage so the count survives reloads (the user might
// get a push notification, close the app, and reopen later — they should
// still see the badge).

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface OrdersBadgeState {
  unseenCount: number
  /** Increment when an order status changes while the user is NOT viewing orders */
  increment: () => void
  /** Reset to 0 — call when the user opens the Orders view */
  clear: () => void
}

export const useOrdersBadgeStore = create<OrdersBadgeState>()(
  persist(
    (set) => ({
      unseenCount: 0,
      increment: () => set((s) => ({ unseenCount: s.unseenCount + 1 })),
      clear: () => set({ unseenCount: 0 }),
    }),
    { name: '999pro-orders-badge' },
  ),
)
