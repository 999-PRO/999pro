'use client'

// ============================================================================
// ContactsView — full-page "Контакты" view (v25.6, Task #2 + Task #7).
// ----------------------------------------------------------------------------
// Replaces the legacy "Чат с поддержкой" (SupportView) entry points in
// Settings and MoreSheet. Renders a clean contacts page that pulls all
// contact fields dynamically from Studio → Настройки → Контакты:
//   • WhatsApp
//   • Телефон
//   • Telegram
//   • Email
//   • Адрес
//   • Время работы
//
// Only filled-in fields are shown — empty fields are hidden.
// Auto-refreshes instantly when an admin updates contacts in Studio
// (via the `settings:changed` socket event → `999pro:settings-changed`
// window event → useContacts() hook refetch).
// ============================================================================

import {
  ChevronLeft, Phone, Mail, MessageCircle, Send, MapPin, Clock,
  Headphones, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useContacts,
  buildWhatsAppUrl,
  buildTelUrl,
  buildTelegramUrl,
  buildMailtoUrl,
} from '@/lib/use-contacts'
import { haptic } from '@/lib/haptic'

interface ContactsViewProps {
  onNavigate: (v: string) => void
}

export function ContactsView({ onNavigate }: ContactsViewProps) {
  const { whatsapp, telegram, email, phone, address, workingHours, loading } = useContacts()

  // Build normalised URLs (return null if the field is empty/invalid)
  const waUrl = buildWhatsAppUrl(whatsapp)
  const telUrl = buildTelUrl(phone)
  const tgUrl = buildTelegramUrl(telegram)
  const mailUrl = buildMailtoUrl(email)

  // Count configured contact methods (URL-based only — address/workingHours
  // are display-only and don't count as "clickable" methods)
  const configuredMethods = [waUrl, telUrl, tgUrl, mailUrl].filter(Boolean).length
  const hasAny =
    configuredMethods > 0 || Boolean(address?.trim()) || Boolean(workingHours?.trim())

  return (
    <div className="page-top-padding pb-28 md:pb-6">
      <div className="px-4 md:px-6 max-w-2xl mx-auto">
        {/* Back button */}
        <button
          onClick={() => onNavigate('settings')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ChevronLeft className="h-4 w-4" /> Назад
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl gradient-brand grid place-items-center shadow-glow shrink-0">
            <Headphones className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Контакты</h1>
            <p className="text-sm text-muted-foreground">
              Свяжитесь с нами удобным способом
            </p>
          </div>
        </div>

        {loading ? (
          <div className="glass rounded-3xl p-5 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-2xl skeleton" />
            ))}
          </div>
        ) : !hasAny ? (
          // Empty state — admin hasn't filled in any contacts yet
          <div className="glass rounded-3xl p-8 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-xl font-bold mb-2">Контакты ещё не настроены</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Администратор может добавить контакты в Studio → Контакты.
            </p>
            <Button
              onClick={() => onNavigate('home')}
              className="rounded-full gradient-brand text-white font-semibold shadow-glow h-11 px-6"
            >
              На главную
            </Button>
          </div>
        ) : (
          <>
            {/* Clickable contact methods — only filled-in ones are shown */}
            <div className="space-y-3">
              {telUrl && (
                <ContactCard
                  icon={<Phone className="h-5 w-5" />}
                  label="Позвонить"
                  value={phone!}
                  href={telUrl}
                  color="bg-violet-500"
                />
              )}
              {waUrl && (
                <ContactCard
                  icon={<MessageCircle className="h-5 w-5" />}
                  label="WhatsApp"
                  value={whatsapp!}
                  href={waUrl}
                  external
                  color="bg-green-500"
                />
              )}
              {tgUrl && (
                <ContactCard
                  icon={<Send className="h-5 w-5" />}
                  label="Telegram"
                  value={telegram!}
                  href={tgUrl}
                  external
                  color="bg-sky-500"
                />
              )}
              {mailUrl && (
                <ContactCard
                  icon={<Mail className="h-5 w-5" />}
                  label="Email"
                  value={email!}
                  href={mailUrl}
                  color="bg-orange-500"
                />
              )}
            </div>

            {/* Display-only fields: address + working hours */}
            {(address?.trim() || workingHours?.trim()) && (
              <div className="glass rounded-3xl p-5 mt-4 space-y-4">
                {address?.trim() && (
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-rose-500/15 grid place-items-center shrink-0">
                      <MapPin className="h-5 w-5 text-rose-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground">Адрес</div>
                      <div className="text-sm font-semibold whitespace-pre-line">
                        {address}
                      </div>
                    </div>
                  </div>
                )}
                {workingHours?.trim() && (
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-blue-500/15 grid place-items-center shrink-0">
                      <Clock className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground">Время работы</div>
                      <div className="text-sm font-semibold whitespace-pre-line">
                        {workingHours}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================================
//  ContactCard — single clickable contact row.
// ============================================================================

function ContactCard({
  icon,
  label,
  value,
  href,
  external,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  href: string
  external?: boolean
  color: string
}) {
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={() => haptic.tap()}
      className="glass rounded-2xl p-4 flex items-center gap-3 hover:bg-accent/40 active:bg-accent/60 transition-colors"
    >
      <div className={`h-10 w-10 rounded-2xl ${color} grid place-items-center text-white shrink-0`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold truncate">{value}</div>
      </div>
    </a>
  )
}
