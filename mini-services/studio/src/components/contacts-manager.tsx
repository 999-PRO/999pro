'use client'
import { useState, useEffect, useCallback } from 'react'
import { Save, Phone, Mail, MessageCircle, Send, MapPin, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'

// ============================================================================
// ContactsManager — Studio section for editing the app's global contacts.
// v25.6 (Task #2): now edits 6 fields (was 4):
//   • WhatsApp
//   • Telegram
//   • Email
//   • Телефон (Phone)
//   • Адрес (Address)        ← NEW
//   • Время работы (WorkingHours)  ← NEW
//
// Each field is stored as a separate AppSetting key on the backend
// (`/api/settings/<key>`), all in the PUBLIC_SETTING_KEYS whitelist so the
// app's `useContacts()` hook can fetch them without auth.
//
// All 6 fields are optional — empty fields are hidden in the app.
// ============================================================================

export function ContactsManager() {
  const [whatsapp, setWhatsapp] = useState('')
  const [telegram, setTelegram] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [workingHours, setWorkingHours] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wa, tg, em, ph, addr, hours] = await Promise.all([
        api.get<{ value: string | null }>('/api/settings/whatsapp', { auth: true }).catch(() => null),
        api.get<{ value: string | null }>('/api/settings/telegram', { auth: true }).catch(() => null),
        api.get<{ value: string | null }>('/api/settings/email', { auth: true }).catch(() => null),
        api.get<{ value: string | null }>('/api/settings/phone', { auth: true }).catch(() => null),
        api.get<{ value: string | null }>('/api/settings/address', { auth: true }).catch(() => null),
        api.get<{ value: string | null }>('/api/settings/workingHours', { auth: true }).catch(() => null),
      ])
      // Backend stores values as JSON-encoded strings. The GET response
      // shape is `{ value: string | null }`. We send raw strings on PUT
      // (NOT wrapped in `{ value: ... }`) to avoid the triple-wrapping bug.
      const unwrap = (v: unknown): string => {
        if (typeof v === 'string') return v
        if (v && typeof v === 'object' && 'value' in v) {
          const inner = (v as { value: unknown }).value
          return typeof inner === 'string' ? inner : ''
        }
        return ''
      }
      setWhatsapp(unwrap(wa?.value))
      setTelegram(unwrap(tg?.value))
      setEmail(unwrap(em?.value))
      setPhone(unwrap(ph?.value))
      setAddress(unwrap(addr?.value))
      setWorkingHours(unwrap(hours?.value))
    } catch (e) {
      // S-LOW-008: previously `catch { /* ignore */ }` — silent failure.
      // Now we log the error so we can diagnose network/backend issues.
      console.error('[contacts-manager] load failed:', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      // Send the raw string as the body. Backend validates with `stringValueSchema`
      // and stores `JSON.stringify(value)` — round-trip-safe.
      await Promise.all([
        api.put('/api/settings/whatsapp', { json: whatsapp, auth: true }),
        api.put('/api/settings/telegram', { json: telegram, auth: true }),
        api.put('/api/settings/email', { json: email, auth: true }),
        api.put('/api/settings/phone', { json: phone, auth: true }),
        api.put('/api/settings/address', { json: address, auth: true }),
        api.put('/api/settings/workingHours', { json: workingHours, auth: true }),
      ])
      toast.success('Контакты сохранены')
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-20 rounded-2xl skeleton" />
      </div>
    )
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Контакты</h1>
      <p className="text-sm text-muted-foreground mb-5">
        Эти данные автоматически отображаются в приложении в разделе «Контакты».
        Заполняйте только нужные поля — пустые скрываются.
      </p>
      <div className="space-y-4">
        {/* WhatsApp */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-green-500 grid place-items-center text-white shrink-0">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">WhatsApp</Label>
            <Input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="rounded-2xl mt-1"
              placeholder="+79991234567"
            />
          </div>
        </div>

        {/* Phone */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500 grid place-items-center text-white shrink-0">
            <Phone className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Телефон</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-2xl mt-1"
              placeholder="+79991234567"
            />
          </div>
        </div>

        {/* Telegram */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500 grid place-items-center text-white shrink-0">
            <Send className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Telegram</Label>
            <Input
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              className="rounded-2xl mt-1"
              placeholder="@username"
            />
          </div>
        </div>

        {/* Email */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-orange-500 grid place-items-center text-white shrink-0">
            <Mail className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-2xl mt-1"
              placeholder="info@example.com"
            />
          </div>
        </div>

        {/* Address — v25.6 NEW */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-rose-500 grid place-items-center text-white shrink-0">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Адрес</Label>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="rounded-2xl mt-1 min-h-[60px] resize-y"
              placeholder={'г. Москва, ул. Примерная, д. 1, оф. 999\nИНН 1234567890 · ОГРН 1234567890123'}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Можно указать несколько строк (адрес, ИНН, ОГРН).
            </p>
          </div>
        </div>

        {/* Working Hours — v25.6 NEW */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500 grid place-items-center text-white shrink-0">
            <Clock className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Время работы</Label>
            <Textarea
              value={workingHours}
              onChange={(e) => setWorkingHours(e.target.value)}
              className="rounded-2xl mt-1 min-h-[60px] resize-y"
              placeholder={'Пн–Пт: 9:00–21:00 (МСК)\nСб: 10:00–18:00\nВс: выходной'}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Можно указать несколько строк (расписание по дням).
            </p>
          </div>
        </div>

        <Button
          onClick={save}
          disabled={saving}
          className="w-full rounded-full gradient-brand text-white font-semibold h-11 shadow-glow mt-4"
        >
          {saving ? 'Сохранение…' : (
            <>
              <Save className="h-4 w-4 mr-2" /> Сохранить
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
