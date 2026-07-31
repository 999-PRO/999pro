'use client'

/**
 * DeliveryManager — Studio admin panel for the delivery system.
 *
 * Two tabs:
 *   1. Настройки — toggles (delivery/pickup enabled), store address + coords,
 *      phone, working hours, default cost, delivery/pickup terms.
 *   2. Зоны — CRUD for delivery zones + reorder.
 *
 * All settings persist to /api/delivery/* — no code changes needed to
 * manage the delivery system after launch.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Truck, Store, MapPin, Phone, Clock, DollarSign, FileText,
  Plus, Trash2, Loader2, Check, X, Navigation,
  ArrowUp, ArrowDown,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatPrice } from '@/lib/utils'
import type { DeliverySettings, DeliveryZone } from '@/lib/types'
import { MapPicker, type MapPickerResult } from './map-picker'
import { toast } from '@/lib/notifications'
// P1-5 fix: replace native confirm() with accessible StudioConfirmDialog
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'

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

export function DeliveryManager() {
const [tab, setTab] = useState<'settings' | 'zones'>('settings')
  // P1-5 fix: useConfirmDialog instead of native confirm()
  const { dialog: confirmDialog, confirm, close: closeConfirm } = useConfirmDialog()

  // Settings state
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_SETTINGS)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [mapPickerOpen, setMapPickerOpen] = useState(false)

  // Zones state
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [zonesLoading, setZonesLoading] = useState(true)
  const [editingZone, setEditingZone] = useState<Partial<DeliveryZone> | null>(null)
  const [zoneSaving, setZoneSaving] = useState(false)

  // Load both on mount
  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    try {
      const res = await api.get<{ settings: DeliverySettings }>('/api/delivery/settings')
      setSettings({ ...DEFAULT_SETTINGS, ...res.settings })
    } catch (e: any) {
      toast.error('Ошибка загрузки настроек', { description: e?.message })
    } finally {
      setSettingsLoading(false)
    }
  }, [toast])

  const loadZones = useCallback(async () => {
    setZonesLoading(true)
    try {
      const res = await api.get<{ items: DeliveryZone[] }>('/api/delivery/zones?all=true')
      setZones(res.items)
    } catch (e: any) {
      toast.error('Ошибка загрузки зон', { description: e?.message })
    } finally {
      setZonesLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadSettings()
    loadZones()
  }, [loadSettings, loadZones])

  // Save settings
  const saveSettings = async () => {
    setSettingsSaving(true)
    try {
      const res = await api.put<{ settings: DeliverySettings }>('/api/delivery/settings', {
        json: settings,
        auth: true,
      })
      setSettings(res.settings)
      toast.success('Настройки сохранены')
    } catch (e: any) {
      toast.error('Ошибка сохранения', { description: e?.message })
    } finally {
      setSettingsSaving(false)
    }
  }

  // Zone CRUD
  const saveZone = async () => {
    if (!editingZone?.name?.trim()) {
      toast.error('Введите название зоны')
      return
    }
    setZoneSaving(true)
    try {
      const payload = {
        name: editingZone.name!.trim(),
        description: editingZone.description || null,
        cost: Number(editingZone.cost) || 0,
        isActive: editingZone.isActive ?? true,
      }
      if (editingZone.id) {
        await api.put(`/api/delivery/zones/${editingZone.id}`, { json: payload, auth: true })
        toast.success('Зона обновлена')
      } else {
        await api.post('/api/delivery/zones', { json: payload, auth: true })
        toast.success('Зона создана')
      }
      setEditingZone(null)
      loadZones()
    } catch (e: any) {
      toast.error('Ошибка', { description: e?.message })
    } finally {
      setZoneSaving(false)
    }
  }

  const deleteZone = async (id: string) => {
    confirm({
      title: 'Удалить зону доставки?',
      message: 'Существующие заказы сохранят ссылку, но она обнулится.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm()
        try {
          await api.delete(`/api/delivery/zones/${id}`, { auth: true })
          toast.success('Зона удалена')
          loadZones()
        } catch (e: any) {
          toast.error('Ошибка', { description: e?.message })
        }
      },
    })
  }

  const moveZone = async (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= zones.length) return
    const reordered = [...zones]
    ;[reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]]
    setZones(reordered)
    try {
      await api.patch('/api/delivery/zones/reorder', {
        json: { ids: reordered.map((z) => z.id) },
        auth: true,
      })
    } catch {
      // revert on failure
      loadZones()
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl grid place-items-center bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg">
          <Truck className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Доставка</h1>
          <p className="text-sm text-muted-foreground">Управление доставкой и самовывозом</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-2xl bg-foreground/5 w-fit">
        <button
          onClick={() => setTab('settings')}
          className={cn(
            'px-4 py-2 rounded-xl text-sm font-medium transition-all',
            tab === 'settings' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Настройки
        </button>
        <button
          onClick={() => setTab('zones')}
          className={cn(
            'px-4 py-2 rounded-xl text-sm font-medium transition-all',
            tab === 'zones' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Зоны доставки
        </button>
      </div>

      {/* Settings tab */}
      {tab === 'settings' && (
        settingsLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Toggles */}
            <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Доступность</h3>
              <ToggleRow
                icon={<Truck className="h-4 w-4" />}
                label="Доставка"
                description="Разрешить клиентам выбирать доставку при оформлении заказа"
                checked={settings.deliveryEnabled}
                onChange={(v) => setSettings({ ...settings, deliveryEnabled: v })}
              />
              <ToggleRow
                icon={<Store className="h-4 w-4" />}
                label="Самовывоз"
                description="Разрешить клиентам выбирать самовывоз"
                checked={settings.pickupEnabled}
                onChange={(v) => setSettings({ ...settings, pickupEnabled: v })}
              />
            </div>

            {/* Store location */}
            <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Магазин</h3>
              <Field icon={<MapPin className="h-4 w-4" />} label="Адрес магазина">
                <input
                  type="text"
                  value={settings.storeAddress || ''}
                  onChange={(e) => setSettings({ ...settings, storeAddress: e.target.value || null })}
                  placeholder="г. Москва, ул. Пример, д. 1"
                  className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                />
              </Field>
              <Field icon={<Navigation className="h-4 w-4" />} label="Координаты магазина">
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="any"
                    value={settings.storeLat ?? ''}
                    onChange={(e) => setSettings({ ...settings, storeLat: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="Широта (55.751)"
                    className="flex-1 h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                  />
                  <input
                    type="number"
                    step="any"
                    value={settings.storeLng ?? ''}
                    onChange={(e) => setSettings({ ...settings, storeLng: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="Долгота (37.618)"
                    className="flex-1 h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                  />
                  <button
                    onClick={() => setMapPickerOpen(true)}
                    className="h-10 px-3 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary text-sm font-medium flex items-center gap-1.5 shrink-0 transition-colors"
                  >
                    <MapPin className="h-4 w-4" /> На карте
                  </button>
                </div>
              </Field>
              <Field icon={<Phone className="h-4 w-4" />} label="Телефон магазина">
                <input
                  type="tel"
                  value={settings.storePhone || ''}
                  onChange={(e) => setSettings({ ...settings, storePhone: e.target.value || null })}
                  placeholder="+7 (999) 123-45-67"
                  className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                />
              </Field>
              <Field icon={<Clock className="h-4 w-4" />} label="Время работы">
                <input
                  type="text"
                  value={settings.workingHours || ''}
                  onChange={(e) => setSettings({ ...settings, workingHours: e.target.value || null })}
                  placeholder="Ежедневно 10:00–22:00"
                  className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                />
              </Field>
            </div>

            {/* Cost + terms */}
            <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Стоимость и условия</h3>
              <Field icon={<DollarSign className="h-4 w-4" />} label="Стоимость доставки по умолчанию (₽)">
                <input
                  type="number"
                  min="0"
                  value={settings.defaultDeliveryCost}
                  onChange={(e) => setSettings({ ...settings, defaultDeliveryCost: Number(e.target.value) || 0 })}
                  className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Используется как запасная стоимость, если у зоны не задана своя цена.
                </p>
              </Field>
              <Field icon={<FileText className="h-4 w-4" />} label="Условия доставки">
                <textarea
                  value={settings.deliveryTerms || ''}
                  onChange={(e) => setSettings({ ...settings, deliveryTerms: e.target.value || null })}
                  placeholder="Доставка осуществляется в течение 1–3 рабочих дней…"
                  rows={3}
                  className="w-full rounded-xl bg-foreground/5 border border-border/40 px-3 py-2 text-sm resize-none"
                />
              </Field>
              <Field icon={<FileText className="h-4 w-4" />} label="Условия самовывоза">
                <textarea
                  value={settings.pickupTerms || ''}
                  onChange={(e) => setSettings({ ...settings, pickupTerms: e.target.value || null })}
                  placeholder="Самовывоз доступен по предварительной договорённости…"
                  rows={3}
                  className="w-full rounded-xl bg-foreground/5 border border-border/40 px-3 py-2 text-sm resize-none"
                />
              </Field>
            </div>

            {/* Save button */}
            <div className="sticky bottom-4 z-10">
              <button
                onClick={saveSettings}
                disabled={settingsSaving}
                className="w-full h-12 rounded-full font-bold text-sm gradient-brand text-white shadow-glow hover:scale-[1.01] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {settingsSaving ? 'Сохранение…' : 'Сохранить настройки'}
              </button>
            </div>
          </div>
        )
      )}

      {/* Zones tab */}
      {tab === 'zones' && (
        zonesLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {zones.length} {zones.length === 1 ? 'зона' : 'зон'} доставки
              </p>
              <button
                onClick={() => setEditingZone({ name: '', description: '', cost: 0, isActive: true })}
                className="h-10 px-4 rounded-xl gradient-brand text-white text-sm font-medium flex items-center gap-1.5 hover:scale-[1.02] active:scale-95 transition-all"
              >
                <Plus className="h-4 w-4" /> Добавить зону
              </button>
            </div>

            {zones.length === 0 && !editingZone && (
              <div className="rounded-2xl border border-dashed border-border/40 p-8 text-center text-muted-foreground">
                <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Зон доставки пока нет.</p>
                <p className="text-xs mt-1">Создайте зоны «По городу», «По республике», «По России» и т.д.</p>
              </div>
            )}

            {/* Zone list */}
            <div className="space-y-2">
              {zones.map((zone, idx) => (
                <div
                  key={zone.id}
                  className="rounded-2xl border border-border/40 bg-card p-4 flex items-center gap-3"
                >
                  <div className="flex flex-col">
                    <button
                      onClick={() => moveZone(idx, -1)}
                      disabled={idx === 0}
                      className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => moveZone(idx, 1)}
                      disabled={idx === zones.length - 1}
                      className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('font-semibold', !zone.isActive && 'text-muted-foreground line-through')}>
                        {zone.name}
                      </span>
                      {!zone.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-muted-foreground">скрыта</span>
                      )}
                    </div>
                    {zone.description && (
                      <p className="text-xs text-muted-foreground truncate">{zone.description}</p>
                    )}
                    <p className="text-xs font-medium text-primary mt-0.5">
                      {zone.cost > 0 ? `+${formatPrice(zone.cost)}` : 'Бесплатно'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditingZone({ ...zone })}
                      className="h-9 px-3 rounded-lg bg-foreground/5 hover:bg-foreground/10 text-sm font-medium transition-colors"
                    >
                      Изменить
                    </button>
                    <button
                      onClick={() => deleteZone(zone.id)}
                      className="h-9 w-9 rounded-lg bg-destructive/10 hover:bg-destructive/15 text-destructive grid place-items-center transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Zone editor modal */}
            {editingZone && (
              <div
                className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={() => setEditingZone(null)}
              >
                <div
                  className="bg-background w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">
                      {editingZone.id ? 'Редактировать зону' : 'Новая зона'}
                    </h3>
                    <button onClick={() => setEditingZone(null)} className="p-1 rounded-full hover:bg-foreground/10">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Название *</label>
                      <input
                        type="text"
                        value={editingZone.name || ''}
                        onChange={(e) => setEditingZone({ ...editingZone, name: e.target.value })}
                        placeholder="По городу / По республике / По России"
                        className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Описание</label>
                      <input
                        type="text"
                        value={editingZone.description || ''}
                        onChange={(e) => setEditingZone({ ...editingZone, description: e.target.value || null })}
                        placeholder="Доставка в пределах города"
                        className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Стоимость (₽)</label>
                      <input
                        type="number"
                        min="0"
                        value={editingZone.cost ?? 0}
                        onChange={(e) => setEditingZone({ ...editingZone, cost: Number(e.target.value) || 0 })}
                        className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                      />
                    </div>
                    <ToggleRow
                      icon={<Check className="h-4 w-4" />}
                      label="Активна"
                      description="Показывать клиентам при оформлении заказа"
                      checked={editingZone.isActive ?? true}
                      onChange={(v) => setEditingZone({ ...editingZone, isActive: v })}
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => setEditingZone(null)}
                      className="flex-1 h-11 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-sm font-medium transition-colors"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={saveZone}
                      disabled={zoneSaving}
                      className="flex-1 h-11 rounded-xl gradient-brand text-white text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {zoneSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Сохранить
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* Map picker for store location */}
      <MapPicker
        open={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        onPick={(r: MapPickerResult) => {
          setSettings({
            ...settings,
            storeLat: r.lat,
            storeLng: r.lng,
            storeAddress: r.address || settings.storeAddress,
          })
        }}
        initialLat={settings.storeLat ?? undefined}
        initialLng={settings.storeLng ?? undefined}
      />

      {/* P1-5 fix: accessible confirm dialog */}
      <StudioConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
    </div>
  )
}

// ============================================================================
//  Helper subcomponents
// ============================================================================

function ToggleRow({
  icon, label, description, checked, onChange,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-9 w-9 rounded-xl bg-foreground/5 grid place-items-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-12 h-7 rounded-full transition-colors shrink-0',
          checked ? 'bg-primary' : 'bg-foreground/15',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  )
}

function Field({
  icon, label, children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
        {icon} {label}
      </label>
      {children}
    </div>
  )
}
