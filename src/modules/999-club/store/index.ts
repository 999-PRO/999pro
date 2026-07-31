/**
 * 999 CLUB — Zustand store.
 *
 * Phase 2: holds badge state + cached points balance + optimistic action
 * helpers. Persisted to localStorage so the badge survives reloads.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ClubState {
  /** Whether there are unread CLUB events (drives the bottom-nav badge). */
  hasUnread: boolean
  /** Last time the user opened the CLUB page (ISO string). */
  lastOpenedAt: string | null
  /** Cached points balance (updated by the landing + after claims). */
  points: number
  /** Mark all CLUB events as read (called when the page opens). */
  markRead: () => void
  /** Simulate a new CLUB event (placeholder for future push integration). */
  notifyNewEvent: () => void
  /** Update the cached points balance (after a claim/complete action). */
  setPoints: (points: number) => void
}

export const useClubStore = create<ClubState>()(
  persist(
    (set) => ({
      hasUnread: false,
      lastOpenedAt: null,
      points: 0,
      markRead: () =>
        set({ hasUnread: false, lastOpenedAt: new Date().toISOString() }),
      notifyNewEvent: () => set({ hasUnread: true }),
      setPoints: (points) => set({ points }),
    }),
    { name: '999pro-club' },
  ),
)
