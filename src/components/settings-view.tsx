'use client'

import { useState } from 'react'
import { useTheme } from 'next-themes'
import { Switch } from '@/components/ui/switch'
import { useI18n, AVAILABLE_LANGUAGES, type Language } from '@/lib/i18n'
import { setHapticsEnabled } from '@/lib/haptic'
import { toast } from '@/lib/notifications'
import { motion } from 'framer-motion'
import {
  Settings as SettingsIcon, Palette, Bell, Volume2, Globe, Shield,
  Info, Share2, ChevronRight, Check, Headphones, Vibrate,
  MessageCircle, ShoppingBag, Crown, Sparkles, Sun, Moon, Sparkle,
  MapPin, Search, Navigation, Loader2, X, KeyRound, LogOut,
} from 'lucide-react'
import { useLiveInfoSettings } from '@/lib/live-info-settings'
// v19.0: 2FA + logout-all
import { useAuthStore } from '@/lib/auth-store'
import { api } from '@/lib/api'
import { TOTPManagerDialog } from './totp-manager-dialog'

// ============================================================================
// SettingsView — full settings page.
//
// All toggles actually work and persist their state:
// - Dark theme → next-themes (persisted via next-themes localStorage)
// - Push notifications → asks for Notification.permission + persists preference
// - In-app sounds → persisted in localStorage, read by use-notifications.ts
// - Language → persisted via i18n zustand store
// ============================================================================

interface SettingsViewProps {
  onNavigate: (v: string) => void
}

export function SettingsView({ onNavigate }: SettingsViewProps) {
  const { theme, setTheme } = useTheme()
  const { language, setLanguage, t } = useI18n()
  const [pushEnabled, setPushEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return Notification?.permission === 'granted'
  })
  const [soundsEnabled, setSoundsEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('999pro-sounds-enabled') !== 'false'
  })
  const [hapticsEnabled, setHapticsEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('999pro-haptics-enabled') !== 'false'
  })
  const [changingPush, setChangingPush] = useState(false)
  // v12.9 / Wave 2 (C-PWA-003): Granular notification preferences.
  // Stored in BOTH localStorage (for page-side UI) AND SW's IndexedDB
  // (for SW push handler — localStorage is NOT available in SW context).
  // Helper to update both at once:
  const setNotifPref = (category: 'chat' | 'orders' | 'club' | 'marketing', enabled: boolean) => {
    const key = `999pro-notif-${category}`
    localStorage.setItem(key, enabled ? 'true' : 'false')
    // Push to SW so its IndexedDB-backed prefs cache stays in sync.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker?.controller?.postMessage({
        type: 'SET_NOTIF_PREF',
        category,
        enabled,
      })
    }
  }
  const [notifChat, setNotifChat] = useState<boolean>(() => localStorage.getItem('999pro-notif-chat') !== 'false')
  const [notifOrders, setNotifOrders] = useState<boolean>(() => localStorage.getItem('999pro-notif-orders') !== 'false')
  const [notifClub, setNotifClub] = useState<boolean>(() => localStorage.getItem('999pro-notif-club') !== 'false')
  const [notifMarketing, setNotifMarketing] = useState<boolean>(() => localStorage.getItem('999pro-notif-marketing') !== 'false')

  // v19.0: 2FA + user
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const [totpOpen, setTotpOpen] = useState(false)

  const handlePushToggle = async (enabled: boolean) => {
    setChangingPush(true)
    try {
      if (enabled) {
        // Request permission if not already granted.
        if (typeof Notification === 'undefined') {
          toast.error('Браузер не поддерживает push-уведомления')
          return
        }
        if (Notification.permission === 'default') {
          const result = await Notification.requestPermission()
          if (result !== 'granted') {
            toast.error('Разрешение не предоставлено. Включите уведомления в настройках браузера.')
            return
          }
        } else if (Notification.permission === 'denied') {
          toast.error('Уведомления заблокированы. Разрешите их в настройках браузера.')
          return
        }
        setPushEnabled(true)
        toast.success('Push-уведомления включены')
      } else {
        // We can't programmatically revoke permission, but we can unsubscribe
        // the push subscription so the backend stops sending pushes.
        try {
          const reg = await navigator.serviceWorker?.ready
          const sub = await reg?.pushManager.getSubscription()
          if (sub) {
            await sub.unsubscribe()
            // Also tell the backend to delete the subscription.
            const { api } = await import('@/lib/api')
            await api.post('/api/push/unsubscribe', {
              json: { endpoint: sub.endpoint },
              auth: true,
            }).catch(() => {})
          }
        } catch {
          // Non-critical
        }
        setPushEnabled(false)
        toast.success('Push-уведомления отключены')
      }
    } finally {
      setChangingPush(false)
    }
  }

  const handleSoundsToggle = (enabled: boolean) => {
    setSoundsEnabled(enabled)
    localStorage.setItem('999pro-sounds-enabled', enabled ? 'true' : 'false')
    toast.success(enabled ? 'Звуки включены' : 'Звуки отключены')
  }

  const handleHapticsToggle = (enabled: boolean) => {
    setHapticsEnabledState(enabled)
    setHapticsEnabled(enabled) // persists + fires test pulse when enabling
    toast.success(enabled ? 'Вибрация включена' : 'Вибрация отключена')
  }

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang)
    toast.success(lang === 'ru' ? 'Язык изменён на Русский' : 'Language changed to English')
  }

  const handleShare = async () => {
    // v25.6 (Task #4): Web Share API with proper clipboard fallback.
    // The "Ссылка скопирована" toast is shown ONLY after a successful copy —
    // not when Web Share API is cancelled (AbortError) or fails.
    const shareData = {
      title: 'TRI999',
      text: language === 'ru'
        ? 'Современный маркетплейс нового поколения'
        : 'A modern next-gen marketplace',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://999pro.app',
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // User cancelled — non-critical, no toast.
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareData.url)
        toast.success(language === 'ru' ? 'Ссылка скопирована' : 'Link copied')
      } catch {
        toast.error(language === 'ru' ? 'Не удалось скопировать' : 'Failed to copy')
      }
    } else {
      // Legacy fallback: execCommand on hidden textarea.
      try {
        const ta = document.createElement('textarea')
        ta.value = shareData.url
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        if (ok) toast.success(language === 'ru' ? 'Ссылка скопирована' : 'Link copied')
        else toast.error(language === 'ru' ? 'Не удалось скопировать' : 'Failed to copy')
      } catch {
        toast.error(language === 'ru' ? 'Не удалось скопировать' : 'Failed to copy')
      }
    }
  }

  return (
    <div className="page-top-padding pb-28 md:pb-6">
      <div className="px-4 md:px-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl gradient-brand grid place-items-center shadow-glow shrink-0">
            <SettingsIcon className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{t('settings.title')}</h1>
            <p className="text-sm text-muted-foreground">TRI999</p>
          </div>
        </div>

        {/* Appearance */}
        <Section title={t('settings.section.appearance')}>
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center">
                <Palette className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold">Тема оформления</div>
                <div className="text-xs text-muted-foreground">Выберите стиль приложения</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ThemeOption
                icon={<Sun className="h-5 w-5" />}
                label="Светлая"
                active={theme === 'light'}
                onClick={() => setTheme('light')}
              />
              <ThemeOption
                icon={<Moon className="h-5 w-5" />}
                label="Тёмная"
                active={theme === 'dark'}
                onClick={() => setTheme('dark')}
              />
              <ThemeOption
                icon={<Sparkle className="h-5 w-5" />}
                label="Neon"
                active={theme === 'neon'}
                onClick={() => setTheme('neon')}
              />
            </div>
          </div>
        </Section>

        {/* Notifications */}
        <Section title={t('settings.section.notifications')}>
          <ToggleRow
            icon={<Bell className="h-5 w-5 text-primary" />}
            title={t('settings.pushNotifs')}
            desc={t('settings.pushNotifs.desc')}
            checked={pushEnabled}
            onChange={handlePushToggle}
            disabled={changingPush}
          />
          {/* v12.9: Granular notification categories */}
          {pushEnabled && (
            <>
              <ToggleRow
                icon={<MessageCircle className="h-5 w-5 text-emerald-500" />}
                title="Сообщения и звонки"
                desc="Уведомления о новых сообщениях в чате"
                checked={notifChat}
                onChange={(v) => { setNotifChat(v); setNotifPref('chat', v) }}
              />
              <ToggleRow
                icon={<ShoppingBag className="h-5 w-5 text-sky-500" />}
                title="Заказы и заявки"
                desc="Статусы заказов и обновления заявок"
                checked={notifOrders}
                onChange={(v) => { setNotifOrders(v); setNotifPref('orders', v) }}
              />
              <ToggleRow
                icon={<Crown className="h-5 w-5 text-amber-500" />}
                title="999 CLUB"
                desc="Подарки, бонусы, розыгрыши, события"
                checked={notifClub}
                onChange={(v) => { setNotifClub(v); setNotifPref('club', v) }}
              />
              <ToggleRow
                icon={<Sparkles className="h-5 w-5 text-violet-500" />}
                title="Акции и предложения"
                desc="Промо-акции, скидки и специальные предложения"
                checked={notifMarketing}
                onChange={(v) => { setNotifMarketing(v); setNotifPref('marketing', v) }}
              />
            </>
          )}
          <ToggleRow
            icon={<Volume2 className="h-5 w-5 text-primary" />}
            title={t('settings.inAppSounds')}
            desc={t('settings.inAppSounds.desc')}
            checked={soundsEnabled}
            onChange={handleSoundsToggle}
          />
          {/* v25.6 (Task #9): explicit notice that the app uses built-in
              notification sounds. Browsers (especially iOS Safari + PWA)
              do not allow apps to pick a custom notification sound — the
              sound played for incoming push notifications is controlled by
              the OS / browser, not the app. The toggle above only controls
              IN-APP sounds (button taps, send message, etc.), not push
              notification sounds. */}
          <div className="px-4 py-3 text-xs text-muted-foreground bg-amber-500/5 border-t border-amber-500/15">
            <strong className="text-amber-700 dark:text-amber-400">
              ℹ️ О звуках push-уведомлений
            </strong>
            <p className="mt-1 leading-relaxed">
              Звук входящих push-уведомлений определяется операционной системой
              и браузером (iOS Safari, Android Chrome, Яндекс.Браузер) —
              приложение не может его изменить. Этот переключатель управляет
              только звуками внутри приложения (нажатия, отправка сообщений,
              добавление в корзину).
            </p>
          </div>
          <ToggleRow
            icon={<Vibrate className="h-5 w-5 text-primary" />}
            title="Вибрация"
            desc="Тактильная отдача при нажатиях и действиях"
            checked={hapticsEnabled}
            onChange={handleHapticsToggle}
          />
        </Section>

        {/* Language */}
        <Section title={t('settings.section.language')}>
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold">{t('settings.language')}</div>
                <div className="text-xs text-muted-foreground">{t('settings.language.desc')}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageChange(lang.code)}
                  className={`flex items-center gap-2 p-3 rounded-2xl transition-all border-2 ${
                    language === lang.code
                      ? 'gradient-brand text-white border-transparent shadow-glow'
                      : 'glass border-transparent hover:border-primary/30'
                  }`}
                >
                  <span className="text-xl">{lang.flag}</span>
                  <span className="text-sm font-semibold flex-1 text-left">{lang.label}</span>
                  {language === lang.code && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Location — v18.5.3: location settings for weather & prayer times */}
        <Section title="Местоположение">
          <LocationSection />
        </Section>

        {/* v19.0: Security — 2FA, sessions */}
        <Section title="Безопасность">
          <NavRow
            icon={<KeyRound className="h-5 w-5 text-primary" />}
            title="Двухфакторная аутентификация"
            desc={user?.totpEnabled ? 'Включена — нажмите для управления' : 'Защитите аккаунт кодом из приложения'}
            onClick={() => setTotpOpen(true)}
          />
          <NavRow
            icon={<LogOut className="h-5 w-5 text-primary" />}
            title="Завершить все сессии"
            desc="Выйти со всех устройств, кроме текущего"
            onClick={async () => {
              if (!confirm('Завершить все активные сессии? Вам нужно будет войти заново на всех устройствах.')) return
              try {
                await api.post('/api/security/logout-all', { json: {}, auth: true })
                toast.success('Все сессии завершены')
                setTimeout(() => window.location.reload(), 1500)
              } catch (e: any) {
                toast.error(e?.message || 'Не удалось завершить сессии')
              }
            }}
          />
        </Section>

        {/* Privacy & About */}
        <Section title={t('settings.section.privacy')}>
          <NavRow
            icon={<Shield className="h-5 w-5 text-primary" />}
            title={t('settings.privacy')}
            desc={t('settings.privacy.desc')}
            onClick={() => onNavigate('privacy')}
          />
          <NavRow
            icon={<Info className="h-5 w-5 text-primary" />}
            title={t('settings.about')}
            desc={t('settings.about.desc')}
            onClick={() => onNavigate('about')}
          />
          <NavRow
            icon={<Share2 className="h-5 w-5 text-primary" />}
            title={t('settings.share')}
            desc={t('settings.share.desc')}
            onClick={handleShare}
          />
        </Section>

        {/* v25.6 (Task #2 + #7): Contacts section — replaces the old
            "Чат с поддержкой". Routes to the new ContactsView which pulls
            all 6 contact fields dynamically from Studio → Контакты. */}
        <Section title="Контакты">
          <NavRow
            icon={<Headphones className="h-5 w-5 text-primary" />}
            title="Контакты"
            desc="Телефон, WhatsApp, Telegram, Email, адрес, время работы"
            onClick={() => onNavigate('contacts')}
          />
        </Section>

        <div className="text-center text-xs text-muted-foreground pt-2 pb-4">
          TRI999 · версия 1.0.0
        </div>
      </div>

      {/* v19.0: 2FA / TOTP management dialog */}
      <TOTPManagerDialog
        open={totpOpen}
        onOpenChange={setTotpOpen}
        totpEnabled={!!user?.totpEnabled}
        onUpdated={fetchMe}
      />
    </div>
  )
}

// ============================================================================
// Section — labelled group of settings rows.
// ============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
        {title}
      </h2>
      <div className="glass rounded-3xl overflow-hidden divide-y divide-border/30">
        {children}
      </div>
    </div>
  )
}

// ============================================================================
// ToggleRow — a settings row with a switch on the right.
// ============================================================================

function ToggleRow({
  icon, title, desc, checked, onChange, disabled,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  )
}

// ============================================================================
// NavRow — a settings row that navigates to another view on click.
// ============================================================================

function NavRow({
  icon, title, desc, onClick,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 hover:bg-accent/40 transition-colors text-left"
    >
      <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
    </motion.button>
  )
}

// ============================================================================
// ThemeOption — a selectable theme card (Light / Dark / Neon).
// ============================================================================
function ThemeOption({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all border-2 ${
        active ? 'gradient-brand text-white border-transparent shadow-glow' : 'glass border-transparent hover:border-primary/30'
      }`}
    >
      <div className={active ? 'text-white' : 'text-muted-foreground'}>
        {icon}
      </div>
      <span className="text-xs font-semibold">{label}</span>
      {active && <Check className="h-3.5 w-3.5" />}
    </motion.button>
  )
}

// ============================================================================
// LocationSection — v18.5.3
// ----------------------------------------------------------------------------
// Полная настройка местоположения для погоды и времени намаза в настройках.
// Включает: вкл геолокации, поиск города, популярные города, сброс.
// ============================================================================
const POPULAR_CITIES = [
  'Грозный', 'Москва', 'Санкт-Петербург', 'Махачкала',
  'Казань', 'Сочи', 'Новосибирск', 'Екатеринбург',
  'Мекка', 'Медина', 'Стамбул', 'Дубай',
]

interface CitySearchResult {
  name: string
  country: string
  admin1?: string
}

function LocationSection() {
  const settings = useLiveInfoSettings()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CitySearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [requestingGeo, setRequestingGeo] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)

  // ---- City search via Open-Meteo geocoding API ----
  const handleSearchChange = (q: string) => {
    setSearchQuery(q)
    setGeoError(null)
    if (q.trim().length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    setTimeout(async () => {
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=8&language=ru&format=json`,
        )
        if (!res.ok) { setSearchResults([]); return }
        const data = await res.json()
        if (data.results) {
          setSearchResults(data.results.map((r: any) => ({
            name: r.name,
            country: r.country || '',
            admin1: r.admin1,
          })))
        } else {
          setSearchResults([])
        }
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  // ---- Request browser geolocation ----
  const requestGeolocation = () => {
    setRequestingGeo(true)
    setGeoError(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Геолокация не поддерживается этим браузером')
      setRequestingGeo(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        settings.setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        settings.setMode('auto')
        settings.setGeoDenied(false)
        setRequestingGeo(false)
        toast.success('Геолокация включена')
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError('Доступ к геолокации запрещён. Разрешите в настройках браузера или выберите город вручную ниже.')
          settings.setGeoDenied(true)
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoError('Местоположение недоступно. Выберите город вручную.')
        } else if (err.code === err.TIMEOUT) {
          setGeoError('Превышено время ожидания. Попробуйте ещё раз.')
        } else {
          setGeoError('Не удалось получить местоположение')
        }
        setRequestingGeo(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    )
  }

  const selectCity = (city: string) => {
    settings.setCity(city)
    setSearchQuery('')
    setSearchResults([])
    toast.success(`Город: ${city}`)
  }

  const reset = () => {
    settings.setCity(null)
    settings.setCoords(null)
    settings.setMode('auto')
    setGeoError(null)
    toast.success('Сброшено — авто-определение по IP')
  }

  // Current status text
  const currentStatus = settings.mode === 'manual' && settings.city
    ? `📍 ${settings.city}`
    : settings.coords
      ? '📍 Геолокация браузера'
      : '🌐 Авто-определение по IP'

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center">
          <MapPin className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">Город для погоды и намаза</div>
          <div className="text-xs text-muted-foreground">{currentStatus}</div>
        </div>
      </div>

      {/* Enable geolocation button */}
      <button
        onClick={requestGeolocation}
        disabled={requestingGeo}
        className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all active:scale-[0.98] gradient-brand text-white shadow-glow disabled:opacity-60"
      >
        {requestingGeo
          ? <Loader2 className="h-5 w-5 animate-spin" />
          : <Navigation className="h-5 w-5" />}
        <div className="flex-1 text-left">
          <div className="text-sm font-semibold">
            {requestingGeo ? 'Запрос геолокации…' : 'Включить геолокацию'}
          </div>
          <div className="text-[11px] opacity-80">
            Самый точный способ — использует GPS/Wi-Fi
          </div>
        </div>
        {settings.coords && settings.mode === 'auto' && !requestingGeo && (
          <Check className="h-5 w-5" />
        )}
      </button>
      {geoError && (
        <div className="p-2.5 rounded-xl text-[11px] text-red-500 dark:text-red-400"
          style={{ background: 'rgba(239,68,68,0.08)' }}>
          {geoError}
        </div>
      )}

      {/* Search city */}
      <div>
        <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
          Найти город
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl glass border-border/40">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Например: Грозный, Москва, Мекка…"
            className="flex-1 bg-transparent text-sm outline-none min-w-0"
          />
          {searching && <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />}
          {searchQuery && !searching && (
            <button onClick={() => { setSearchQuery(''); setSearchResults([]) }} className="text-muted-foreground hover:text-foreground shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="mt-2 space-y-1 max-h-60 overflow-y-auto custom-scroll">
            {searchResults.map((r, i) => (
              <button
                key={`${r.name}-${r.country}-${i}`}
                onClick={() => selectCity(r.name)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-accent/40 transition-colors text-left"
              >
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {r.admin1 ? `${r.admin1}, ` : ''}{r.country}
                  </div>
                </div>
                {settings.city === r.name && settings.mode === 'manual' && (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Popular cities */}
      {!searchQuery && (
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
            Популярные города
          </div>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_CITIES.map((c) => {
              const active = settings.city === c && settings.mode === 'manual'
              return (
                <button
                  key={c}
                  onClick={() => selectCity(c)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all active:scale-95 border ${
                    active
                      ? 'gradient-brand text-white border-transparent shadow-glow'
                      : 'glass border-border/40 hover:border-primary/30'
                  }`}
                >
                  {c}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Reset */}
      {(settings.mode === 'manual' || settings.coords) && (
        <button
          onClick={reset}
          className="w-full p-2.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
        >
          Сбросить → авто-определение по IP
        </button>
      )}
    </div>
  )
}
