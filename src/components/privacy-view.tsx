'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, FileText, Cookie, ChevronLeft, ChevronRight,
  Lock, UserCheck, AlertCircle, Mail, Phone, MessageCircle, Send,
  RefreshCw,
} from 'lucide-react'
import { useContacts, buildWhatsAppUrl, buildTelUrl, buildTelegramUrl, buildMailtoUrl } from '@/lib/use-contacts'
import { api } from '@/lib/api'
import DOMPurify from 'dompurify'

// ============================================================================
// PrivacyView — full privacy policy + terms of service section.
//
// v25.6 (Task #6): rewritten to pull all legal documents from the DB
// (Studio → Инфо-страницы) instead of using hardcoded Russian text.
// Three documents are loaded by slug:
//   • privacy  — Политика конфиденциальности
//   • terms    — Пользовательское соглашение
//   • rules    — Правила сервиса (NEW slug, seeded by seed-info-pages.ts)
// All three are fully editable in Studio and changes appear instantly in
// the app via the `999pro:info-pages-changed` live-refresh event.
//
// Two additional tabs remain mostly hardcoded (Cookies + Your Rights + Contacts)
// for backward compat, but the Contacts tab now uses the same dynamic
// `useContacts()` hook as the new ContactsView.
// ============================================================================

type Tab = 'policy' | 'terms' | 'rules' | 'cookies' | 'rights' | 'contacts'

const TABS: { id: Tab; label: string; icon: typeof Shield; slug?: string }[] = [
  { id: 'policy',  label: 'Политика',  icon: Shield,    slug: 'privacy' },
  { id: 'terms',   label: 'Соглашение', icon: FileText, slug: 'terms' },
  { id: 'rules',   label: 'Правила',   icon: FileText, slug: 'rules' },
  { id: 'cookies', label: 'Cookies',   icon: Cookie },
  { id: 'rights',  label: 'Ваши права', icon: UserCheck },
  { id: 'contacts',label: 'Контакты',  icon: Mail },
]

// Fetch a DB-backed info page by slug. Returns sanitised HTML or null.
function useInfoPage(slug: string | undefined) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!slug) { setHtml(null); return }
    let alive = true
    setLoading(true)
    api.get<{ content: string }>(`/api/info-pages/${slug}`)
      .then((data) => { if (alive) setHtml(data.content || '') })
      .catch(() => { if (alive) setHtml(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [slug, refreshKey])

  // Live-refresh: refetch when Studio saves any info page change.
  useEffect(() => {
    const onInfoPagesChanged = () => setRefreshKey((k) => k + 1)
    window.addEventListener('999pro:info-pages-changed', onInfoPagesChanged as EventListener)
    return () => window.removeEventListener('999pro:info-pages-changed', onInfoPagesChanged as EventListener)
  }, [])

  return { html, loading, refresh: () => setRefreshKey((k) => k + 1) }
}

function sanitiseHtml(html: string): string {
  if (typeof window === 'undefined') return html
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'script', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseenter', 'onmouseleave', 'onsubmit', 'onchange', 'oninput', 'onfocus', 'onblur', 'style'],
    ALLOW_DATA_ATTR: false,
  })
}

export function PrivacyView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const [tab, setTab] = useState<Tab>('policy')

  // Look up the slug for the active tab; tabs without a slug use a hardcoded fallback.
  const activeTab = TABS.find((t) => t.id === tab)
  const { html, loading, refresh } = useInfoPage(activeTab?.slug)

  return (
    <div className="page-top-padding pb-28 md:pb-6">
      <div className="px-4 md:px-6 max-w-3xl mx-auto">
        {/* Back + Header */}
        <button
          onClick={() => onNavigate('settings')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ChevronLeft className="h-4 w-4" /> Настройки
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="h-11 w-11 rounded-2xl gradient-brand grid place-items-center shadow-glow shrink-0">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Конфиденциальность</h1>
            <p className="text-sm text-muted-foreground">Как мы обрабатываем ваши данные</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 sticky z-10 bg-background/80 backdrop-blur" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)' }}>
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all ${
                  tab === t.id
                    ? 'gradient-brand text-white shadow-glow'
                    : 'glass text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="glass rounded-3xl p-5 md:p-6 prose prose-sm dark:prose-invert max-w-none"
          >
            {tab === 'cookies' && <CookiesContent />}
            {tab === 'rights' && <RightsContent />}
            {tab === 'contacts' && <ContactsContent />}
            {/* v25.6 (Task #6): the three legal documents are loaded from
                the DB. If the admin has not yet edited them, the seed
                defaults are shown (seed-info-pages.ts seeds privacy + terms;
                rules is new and is seeded with a sensible default). */}
            {(tab === 'policy' || tab === 'terms' || tab === 'rules') && (
              <DbDocumentContent
                html={html}
                loading={loading}
                onRetry={refresh}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

// ============================================================================
// DbDocumentContent — renders a DB-backed legal document (privacy/terms/rules).
// ============================================================================

function DbDocumentContent({
  html,
  loading,
  onRetry,
}: {
  html: string | null
  loading: boolean
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 rounded-full skeleton" style={{ width: `${60 + Math.random() * 35}%` }} />
        ))}
      </div>
    )
  }

  if (!html || !html.trim()) {
    // Empty state — admin hasn't filled the document yet.
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h2 className="text-xl font-bold mb-2">Документ пока не заполнен</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Администратор может добавить текст в Studio → Информационные страницы.
        </p>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-sm text-primary font-semibold hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Повторить
        </button>
      </div>
    )
  }

  return (
    <div dangerouslySetInnerHTML={{ __html: sanitiseHtml(html) }} />
  )
}

// ============================================================================
// Cookies content — kept hardcoded (not a legal document, just a help page).
// ============================================================================

function CookiesContent() {
  return (
    <div className="space-y-4 text-sm">
      <h2 className="text-xl font-bold">Использование Cookies</h2>
      <p className="text-muted-foreground">
        «Три девятки» использует cookies и локальное хранилище (localStorage) для обеспечения
        работоспособности приложения и улучшения пользовательского опыта.
      </p>

      <div>
        <h3 className="font-semibold mb-1.5">Типы cookies и localStorage, которые мы используем:</h3>
        <div className="space-y-3 mt-2">
          <div className="p-3 rounded-2xl bg-accent/30">
            <div className="font-semibold text-sm mb-1">🔒 Необходимые (обязательные)</div>
            <p className="text-xs text-muted-foreground">
              Без них приложение не работает: аутентификация (токен), настройки темы, выбранный язык.
              Отключить нельзя.
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-accent/30">
            <div className="font-semibold text-sm mb-1">📊 Функциональные</div>
            <p className="text-xs text-muted-foreground">
              Запоминают ваши предпочтения: избранные товары, корзина, история чатов, push-подписки.
              Можно очистить через выход из аккаунта.
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-accent/30">
            <div className="font-semibold text-sm mb-1">📱 Service Worker кэш</div>
            <p className="text-xs text-muted-foreground">
              Кэширует статику (CSS, JS, иконки) для работы офлайн и быстрого запуска.
              Очищается автоматически при обновлении приложения.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5">Как управлять cookies</h3>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Браузер → Настройки → Конфиденциальность → Удалить данные сайта.</li>
          <li>В приложении: Настройки → Выйти из аккаунта (очищает токен).</li>
          <li>Запретить все cookies в браузере — приложение перестанет работать.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5">Сторонние сервисы</h3>
        <p className="text-muted-foreground">
          Push-уведомления доставляются через Apple APNS, Google FCM или Mozilla Push. Эти сервисы
          могут получать обезличенный идентификатор устройства для доставки уведомления. Мы не
          передаём им содержимое ваших сообщений.
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// Rights content — GDPR-style user rights. Uses dynamic email.
// ============================================================================

function RightsContent() {
  const { email } = useContacts()
  const supportEmail = email || 'support@999.pro'

  return (
    <div className="space-y-4 text-sm">
      <h2 className="text-xl font-bold">Ваши права</h2>
      <p className="text-muted-foreground">
        В соответствии с Федеральным законом № 152-ФЗ «О персональных данных» и GDPR (для
        пользователей из ЕС), вы имеете следующие права:
      </p>

      <div className="space-y-3">
        <RightCard
          icon={<UserCheck className="h-5 w-5" />}
          title="Право доступа"
          desc={`Вы можете запросить копию всех ваших персональных данных, которые у нас хранятся. Запрос отправляется на ${supportEmail} — мы ответим в течение 30 дней.`}
        />
        <RightCard
          icon={<FileText className="h-5 w-5" />}
          title="Право на исправление"
          desc="Вы можете исправить неточные данные в профиле самостоятельно (Настройки профиля) или обратившись в поддержку."
        />
        <RightCard
          icon={<AlertCircle className="h-5 w-5" />}
          title="Право на удаление"
          desc="Вы можете удалить аккаунт через Настройки → Удалить аккаунт. Все ваши данные будут стёрты в течение 30 дней, кроме данных, обязательных к хранению по закону (заказы, бухгалтерия)."
        />
        <RightCard
          icon={<Mail className="h-5 w-5" />}
          title="Право на переносимость"
          desc={`Вы можете запросить экспорт ваших данных в машиночитаемом формате (JSON). Запрос на ${supportEmail}.`}
        />
        <RightCard
          icon={<Lock className="h-5 w-5" />}
          title="Право на ограничение обработки"
          desc="Вы можете ограничить обработку данных для определённых целей (например, отключить push-уведомления или аналитику) через Настройки."
        />
        <RightCard
          icon={<Shield className="h-5 w-5" />}
          title="Право на отзыв согласия"
          desc="Вы можете отозвать ранее данное согласие на обработку данных в любой момент. Отзыв не влияет на законность обработки до момента отзыва."
        />
      </div>

      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
        <div className="font-semibold text-sm mb-1">Как подать жалобу</div>
        <p className="text-xs">
          Если вы считаете, что мы нарушили ваши права, сначала обратитесь к нам на {supportEmail}.
          Если проблема не решена, вы имеете право подать жалобу в Роскомнадзор (для РФ) или в
          надзорный орган вашей страны (для ЕС).
        </p>
      </div>
    </div>
  )
}

function RightCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="p-3 rounded-2xl bg-accent/30 flex gap-3">
      <div className="h-9 w-9 rounded-xl gradient-soft grid place-items-center shrink-0 text-primary">
        {icon}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-sm mb-1">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  )
}

// ============================================================================
// Contacts content — pulls all 6 contact fields dynamically from Studio.
// ============================================================================

function ContactsContent() {
  const { whatsapp, telegram, email, phone, address, workingHours } = useContacts()

  const waUrl = buildWhatsAppUrl(whatsapp)
  const telUrl = buildTelUrl(phone)
  const tgUrl = buildTelegramUrl(telegram)
  const mailUrl = buildMailtoUrl(email)

  const configuredCount = [waUrl, telUrl, tgUrl, mailUrl].filter(Boolean).length
  const hasAny = configuredCount > 0 || Boolean(address?.trim()) || Boolean(workingHours?.trim())

  return (
    <div className="space-y-4 text-sm">
      <h2 className="text-xl font-bold">Контакты</h2>
      <p className="text-muted-foreground">
        Свяжитесь с нами любым удобным способом. Мы отвечаем в течение 24 часов в будние дни.
      </p>

      {!hasAny ? (
        <div className="p-4 rounded-2xl bg-accent/30 text-center text-muted-foreground">
          Контакты ещё не настроены. Администратор может добавить их в Studio → Контакты.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {mailUrl && (
              <ContactCard icon={<Mail className="h-5 w-5" />} label="Email" value={email!} href={mailUrl} />
            )}
            {telUrl && (
              <ContactCard icon={<Phone className="h-5 w-5" />} label="Телефон" value={phone!} href={telUrl} />
            )}
            {waUrl && (
              <ContactCard icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp" value={whatsapp!} href={waUrl} />
            )}
            {tgUrl && (
              <ContactCard icon={<Send className="h-5 w-5" />} label="Telegram" value={telegram!} href={tgUrl} />
            )}
          </div>

          {(address?.trim() || workingHours?.trim()) && (
            <div className="space-y-3 mt-3">
              {address?.trim() && (
                <div className="p-3 rounded-2xl bg-accent/30">
                  <div className="font-semibold text-sm mb-1">Адрес</div>
                  <p className="text-xs text-muted-foreground whitespace-pre-line">{address}</p>
                </div>
              )}
              {workingHours?.trim() && (
                <div className="p-3 rounded-2xl bg-accent/30">
                  <div className="font-semibold text-sm mb-1">Время работы</div>
                  <p className="text-xs text-muted-foreground whitespace-pre-line">{workingHours}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ContactCard({ icon, label, value, href }: {
  icon: React.ReactNode
  label: string
  value: string
  href: string
}) {
  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
      className="flex items-center gap-3 p-3 rounded-2xl bg-accent/30 hover:bg-accent/50 transition-colors"
    >
      <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center shrink-0 text-primary">
        {icon}
      </div>
      <div className="flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </a>
  )
}
