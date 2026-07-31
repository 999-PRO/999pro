// Delivery settings + zones client store.
// Fetches from /api/delivery/* and caches in memory. Lightweight — no
// persistence needed (settings change rarely, zones even less).

import { create } from 'zustand'
import { api } from './api'

export interface DeliverySettings {
  deliveryEnabled: boolean
  pickupEnabled: boolean
  storeAddress: string | null
  storeLat: number | null
  storeLng: number | null
  storePhone: string | null
  workingHours: string | null
  defaultDeliveryCost: number
  deliveryTerms: string | null
  pickupTerms: string | null
}

export interface DeliveryZone {
  id: string
  name: string
  description: string | null
  cost: number
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface DeliveryState {
  settings: DeliverySettings | null
  zones: DeliveryZone[]
  loading: boolean
  loaded: boolean
  error: string | null
  fetch: () => Promise<void>
  reset: () => void
}

const DEFAULT_SETTINGS: DeliverySettings = {
  deliveryEnabled: true,
  pickupEnabled: true,
  storeAddress: null,
  storeLat: null,
  storeLng: null,
  storePhone: null,
  workingHours: null,
  defaultDeliveryCost: 0,
  deliveryTerms: null,
  pickupTerms: null,
}

export const useDeliveryStore = create<DeliveryState>((set, get) => ({
  settings: null,
  zones: [],
  loading: false,
  loaded: false,
  error: null,

  fetch: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const [settingsRes, zonesRes] = await Promise.all([
        api.get<{ settings: DeliverySettings }>('/api/delivery/settings'),
        api.get<{ items: DeliveryZone[] }>('/api/delivery/zones'),
      ])
      set({
        settings: { ...DEFAULT_SETTINGS, ...settingsRes.settings },
        zones: zonesRes.items,
        loading: false,
        loaded: true,
        error: null,
      })
    } catch (e: any) {
      set({
        loading: false,
        loaded: true,
        error: e?.message || 'Failed to load delivery info',
        settings: DEFAULT_SETTINGS, // safe fallback so checkout never blocks
        zones: [],
      })
    }
  },

  reset: () => set({ settings: null, zones: [], loaded: false, loading: false, error: null }),
}))
