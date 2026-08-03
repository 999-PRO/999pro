// Shared contacts hook — fetches whatsapp/telegram/email/phone/address/workingHours
// from Studio settings and auto-refreshes when admin changes them.
//
// v16.7: Previously privacy-view.tsx had HARDCODED contact values. Now all
// contact buttons use dynamic values from /api/settings/*, and the hook
// listens to the `settings:changed` socket event so changes in Studio
// appear instantly in the app — no refresh needed.
//
// v25.6 (Task #2): added `address` and `workingHours` fields so the
// "Контакты" section in the app can show all 6 fields configured in Studio.

import { useEffect, useState, useCallback } from 'react'
import { api } from './api'

export interface Contacts {
  whatsapp: string | null
  telegram: string | null
  email: string | null
  phone: string | null
  address: string | null
  workingHours: string | null
}

const EMPTY: Contacts = {
  whatsapp: null,
  telegram: null,
  email: null,
  phone: null,
  address: null,
  workingHours: null,
}

const CONTACT_KEYS = ['whatsapp', 'telegram', 'email', 'phone', 'address', 'workingHours'] as const

export function useContacts() {
  const [contacts, setContacts] = useState<Contacts>(EMPTY)
  const [loading, setLoading] = useState(true)

  const fetchContacts = useCallback(async () => {
    try {
      const [wa, tg, em, ph, addr, hours] = await Promise.all([
        api.get<{ value: string | null }>('/api/settings/whatsapp'),
        api.get<{ value: string | null }>('/api/settings/telegram'),
        api.get<{ value: string | null }>('/api/settings/email'),
        api.get<{ value: string | null }>('/api/settings/phone'),
        api.get<{ value: string | null }>('/api/settings/address'),
        api.get<{ value: string | null }>('/api/settings/workingHours'),
      ])
      setContacts({
        whatsapp: wa.value ?? null,
        telegram: tg.value ?? null,
        email: em.value ?? null,
        phone: ph.value ?? null,
        address: addr.value ?? null,
        workingHours: hours.value ?? null,
      })
    } catch {
      setContacts(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  // v16.7: instant refresh when Studio saves any contact setting
  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined
      if (detail?.key && (CONTACT_KEYS as readonly string[]).includes(detail.key)) {
        fetchContacts()
      }
    }
    window.addEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
    return () => window.removeEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
  }, [fetchContacts])

  return { ...contacts, loading, refresh: fetchContacts }
}

// ============================================================================
//  URL builders — normalize raw user input into valid href values.
// ============================================================================

/**
 * WhatsApp URL: https://wa.me/<digits-only>
 * Strips +, spaces, dashes, parens. Returns null if input is empty.
 * On mobile this opens the WhatsApp app directly; on desktop it opens
 * web.whatsapp.com with a "open in app" prompt.
 */
export function buildWhatsAppUrl(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return null
  return `https://wa.me/${digits}`
}

/**
 * Phone URL: tel:<number>
 * Keeps the + (if present) and digits. Spaces/dashes are tolerated by tel:
 * but we strip them for a cleaner URL. Returns null if input is empty.
 * Opens the system dialer with the number pre-filled.
 */
export function buildTelUrl(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null
  // Keep + and digits only. tel: tolerates other chars but canonical is cleaner.
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (!cleaned) return null
  return `tel:${cleaned}`
}

/**
 * Telegram URL: https://t.me/<username>
 * Strips leading @, strips t.me/ prefix if admin pasted a full URL.
 * Returns null if input is empty. Opens the Telegram app on mobile,
 * web.telegram.org on desktop.
 */
export function buildTelegramUrl(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null
  let username = raw.trim()
  // Strip @ prefix
  if (username.startsWith('@')) username = username.slice(1)
  // Strip https://t.me/ prefix if admin pasted a full URL
  username = username.replace(/^https?:\/\/t\.me\//i, '')
  // Strip trailing slashes
  username = username.replace(/\/+$/, '')
  if (!username) return null
  return `https://t.me/${username}`
}

/**
 * Email URL: mailto:<email>
 * Returns null if input is empty. Opens the default mail client.
 */
export function buildMailtoUrl(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null
  return `mailto:${raw.trim()}`
}
