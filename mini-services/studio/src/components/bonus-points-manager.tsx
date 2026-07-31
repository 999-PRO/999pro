'use client'

import { useState, useEffect, useCallback } from 'react'
import { Save, Loader2, Coins } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'

interface BonusSettings {
  earnRate: number
  earnPerCurrencyUnit: number
  pointValue: number
  minOrderTotalToSpend: number
  maxPercentOfOrder: number
  maxPointsBalance: number | null
  expiryDays: number | null
  welcomeBonus: number
  enabled: boolean
}

export function BonusPointsManager() {
  const [settings, setSettings] = useState<BonusSettings>({
    earnRate: 1, earnPerCurrencyUnit: 100, pointValue: 1,
    minOrderTotalToSpend: 0, maxPercentOfOrder: 50,
    maxPointsBalance: null, expiryDays: null,
    welcomeBonus: 0, enabled: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ settings: BonusSettings }>('/api/promo-codes/bonus-settings')
      setSettings(data.settings)
    } catch (e) {
      toast.error('Ошибка загрузки', { description: String(e) })
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/promo-codes/bonus-settings', { json: settings, auth: true })
      toast.success('Настройки баллов сохранены')
    } catch (e) {
      toast.error('Ошибка', { description: String(e) })
    }
    setSaving(false)
  }

  if (loading) {
    return <div className="p-6"><div className="h-20 rounded-2xl skeleton" /></div>
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <div className="flex items-center gap-2 mb-4">
        <Coins className="h-7 w-7 text-amber-500" />
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Бонусные баллы</h1>
          <p className="text-sm text-muted-foreground">
            Настройка начисления и списания баллов за покупки.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-6 space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          />
          Бонусная система включена
        </label>

        <div className="border-t border-border/40 pt-4">
          <h3 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wider">Начисление</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Сколько баллов начислять</Label>
              <Input
                type="number"
                step="0.1"
                value={settings.earnRate}
                onChange={(e) => setSettings({ ...settings, earnRate: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">баллов за каждую указанную сумму</p>
            </div>
            <div className="space-y-1.5">
              <Label>За каждые (₽)</Label>
              <Input
                type="number"
                value={settings.earnPerCurrencyUnit}
                onChange={(e) => setSettings({ ...settings, earnPerCurrencyUnit: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">рублей в заказе</p>
            </div>
            <div className="space-y-1.5">
              <Label>Приветственный бонус</Label>
              <Input
                type="number"
                value={settings.welcomeBonus}
                onChange={(e) => setSettings({ ...settings, welcomeBonus: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">баллов новому пользователю</p>
            </div>
            <div className="space-y-1.5">
              <Label>Срок действия баллов (дней)</Label>
              <Input
                type="number"
                value={settings.expiryDays ?? ''}
                onChange={(e) => setSettings({ ...settings, expiryDays: e.target.value ? Number(e.target.value) : null })}
                placeholder="Без ограничения"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-border/40 pt-4">
          <h3 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wider">Списание</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Курс баллов (₽ за 1 балл)</Label>
              <Input
                type="number"
                step="0.1"
                value={settings.pointValue}
                onChange={(e) => setSettings({ ...settings, pointValue: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">сколько рублей скидки даёт 1 балл</p>
            </div>
            <div className="space-y-1.5">
              <Label>Мин. сумма заказа для списания (₽)</Label>
              <Input
                type="number"
                value={settings.minOrderTotalToSpend}
                onChange={(e) => setSettings({ ...settings, minOrderTotalToSpend: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Макс. % заказа можно оплатить баллами</Label>
              <Input
                type="number"
                min="0" max="100"
                value={settings.maxPercentOfOrder}
                onChange={(e) => setSettings({ ...settings, maxPercentOfOrder: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Макс. баланс на счету</Label>
              <Input
                type="number"
                value={settings.maxPointsBalance ?? ''}
                onChange={(e) => setSettings({ ...settings, maxPointsBalance: e.target.value ? Number(e.target.value) : null })}
                placeholder="Без ограничения"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-border/40">
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  )
}
