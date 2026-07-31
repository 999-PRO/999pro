'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, FileText, Cookie, Mail, Phone, ChevronLeft, ChevronRight,
  Lock, UserCheck, AlertCircle, ExternalLink, MessageCircle, Send,
} from 'lucide-react'
import { useContacts, buildWhatsAppUrl, buildTelUrl, buildTelegramUrl, buildMailtoUrl } from '@/lib/use-contacts'

// ============================================================================
// PrivacyView — full privacy policy + terms of service section.
//
// Contains:
// - Политика конфиденциальности (data collection, storage, sharing)
// - Пользовательское соглашение (terms of use)
// - Обработка персональных данных (GDPR-style rights)
// - Использование Cookies (what cookies we set + why)
// - Права пользователя (access, rectification, erasure, portability)
// - Контакты (email, phone, address)
// ============================================================================

type Tab = 'policy' | 'terms' | 'cookies' | 'rights' | 'contacts'

const TABS: { id: Tab; label: string; icon: typeof Shield }[] = [
  { id: 'policy', label: 'Политика', icon: Shield },
  { id: 'terms', label: 'Соглашение', icon: FileText },
  { id: 'cookies', label: 'Cookies', icon: Cookie },
  { id: 'rights', label: 'Ваши права', icon: UserCheck },
  { id: 'contacts', label: 'Контакты', icon: Mail },
]

export function PrivacyView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const [tab, setTab] = useState<Tab>('policy')

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
            {tab === 'policy' && <PolicyContent />}
            {tab === 'terms' && <TermsContent />}
            {tab === 'cookies' && <CookiesContent />}
            {tab === 'rights' && <RightsContent />}
            {tab === 'contacts' && <ContactsContent />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

// ============================================================================
// Policy content — privacy policy in Russian.
// ============================================================================

function PolicyContent() {
  return (
    <div className="space-y-4 text-sm">
      <h2 className="text-xl font-bold">Политика конфиденциальности</h2>
      <p className="text-muted-foreground">
        Настоящая Политика описывает, как 999 — Три девятки («мы», «нас», «наш») собирает, использует и
        защищает персональные данные пользователей приложения. Используя приложение, вы соглашаетесь
        с условиями данной Политики.
      </p>

      <div>
        <h3 className="font-semibold mb-1.5 flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" /> 1. Какие данные мы собираем
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li><strong>Учётные данные:</strong> имя пользователя, email, телефон, пароль (в виде хеша).</li>
          <li><strong>Профиль:</strong> отображаемое имя, аватар, био, гендер (опционально).</li>
          <li><strong>Заказы:</strong> состав заказов, адрес доставки, статус.</li>
          <li><strong>Чаты:</strong> сообщения, медиафайлы (фото, документы).</li>
          <li><strong>Устройство:</strong> User-Agent, IP-адрес (для безопасности), push-подписки.</li>
          <li><strong>Аналитика:</strong> агрегированные данные о использовании приложения.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5 flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-primary" /> 2. Как мы используем данные
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Для предоставления услуг: создание заказов, общение в чате, отзывы.</li>
          <li>Для уведомлений: push-уведомления о новых сообщениях и заказах.</li>
          <li>Для безопасности: защита от спама, фрода, несанкционированного доступа.</li>
          <li>Для поддержки: обработка обращений в службу поддержки.</li>
          <li>Для улучшения продукта: анализ пользовательского поведения (агрегированно).</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-primary" /> 3. Передача данных третьим лицам
        </h3>
        <p className="text-muted-foreground">
          Мы не продаём и не передаём ваши персональные данные третьим лицам, за исключением:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground mt-2">
          <li>Платёжные провайдеры (для обработки оплат — передаются только данные заказа).</li>
          <li>Службы доставки (для отправки заказов — передаётся адрес и состав заказа).</li>
          <li>Push-сервисы (Apple APNS, Google FCM, Mozilla Push — для доставки уведомлений).</li>
          <li>Уполномоченные органы по законному требованию (полицейский запрос, суд и т.д.).</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5">4. Хранение данных</h3>
        <p className="text-muted-foreground">
          Данные хранятся на серверах, расположенных в Российской Федерации. Срок хранения:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground mt-2">
          <li>Учётная запись — до удаления пользователем.</li>
          <li>Заказы — 5 лет с момента закрытия (требование бухгалтерского учёта).</li>
          <li>Сообщения чата — до удаления пользователем.</li>
          <li>Логи безопасности — 90 дней.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5">5. Безопасность</h3>
        <p className="text-muted-foreground">
          Мы используем шифрование TLS 1.3 для передачи данных, bcrypt (12 раундов) для хеширования
          паролей, JWT с ограниченным сроком действия для аутентификации. Доступ к данным имеют
          только уполномоченные сотрудники, прошедшие проверку.
        </p>
      </div>

      <div className="text-xs text-muted-foreground border-t border-border/30 pt-3 mt-4">
        Последнее обновление: 29 июня 2026 г.
      </div>
    </div>
  )
}

// ============================================================================
// Terms content — user agreement.
// ============================================================================

function TermsContent() {
  return (
    <div className="space-y-4 text-sm">
      <h2 className="text-xl font-bold">Пользовательское соглашение</h2>
      <p className="text-muted-foreground">
        Настоящее Соглашение регулирует отношения между «Три девятки» и пользователем приложения.
        Используя приложение, вы подтверждаете, что ознакомились и согласны с условиями.
      </p>

      <div>
        <h3 className="font-semibold mb-1.5">1. Регистрация и аккаунт</h3>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Регистрация доступна лицам старше 16 лет.</li>
          <li>Пользователь несёт ответственность за сохранность пароля.</li>
          <li>Запрещено передавать аккаунт третьим лицам.</li>
          <li>Запрещено создавать несколько аккаунтов для обхода ограничений.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5">2. Контент пользователя</h3>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Пользователь несёт ответственность за размещаемый контент (сообщения, отзывы, фото).</li>
          <li>Запрещён контент: незаконный, оскорбительный, спам, нарушение авторских прав.</li>
          <li>«Три девятки» вправе удалить контент без предупреждения при нарушении правил.</li>
          <li>Размещая контент, вы предоставляете «Три девятки» лицензию на его использование в рамках приложения.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5">3. Заказы и оплата</h3>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Заказ считается оформленным после подтверждения на стороне «Три девятки».</li>
          <li>Оплата производится через доступные платёжные методы.</li>
          <li>Возврат осуществляется согласно Закону РФ «О защите прав потребителей».</li>
          <li>Срок доставки указывается при оформлении заказа и может меняться.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5">4. Ответственность</h3>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>«Три девятки» не несёт ответственности за временные сбои в работе приложения.</li>
          <li>«Три девятки» не отвечает за действия других пользователей.</li>
          <li>Пользователь возмещает ущерб, причинённый нарушением Соглашения.</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-1.5">5. Изменения Соглашения</h3>
        <p className="text-muted-foreground">
          «Три девятки» вправе изменять условия Соглашения. Новая версия вступает в силу с момента
          публикации в приложении. Продолжая использовать приложение, вы соглашаетесь с обновлёнными условиями.
        </p>
      </div>

      <div className="text-xs text-muted-foreground border-t border-border/30 pt-3 mt-4">
        Последнее обновление: 29 июня 2026 г.
      </div>
    </div>
  )
}

// ============================================================================
// Cookies content.
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

      <div className="text-xs text-muted-foreground border-t border-border/30 pt-3 mt-4">
        Последнее обновление: 29 июня 2026 г.
      </div>
    </div>
  )
}

// ============================================================================
// Rights content — user rights under GDPR-style framework.
// ============================================================================

function RightsContent() {
  // v16.7: use dynamic email from Studio settings for the "contact us" text
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
          icon={<ExternalLink className="h-5 w-5" />}
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
// Contacts content.
// ============================================================================

function ContactsContent() {
  // v16.7: contacts are loaded dynamically from Studio settings (not hardcoded).
  // Hook auto-refreshes when admin changes any contact in Studio → instant update.
  const { whatsapp, telegram, email, phone } = useContacts()

  // Build URLs with normalization (strip +, @, spaces, etc.)
  const waUrl = buildWhatsAppUrl(whatsapp)
  const telUrl = buildTelUrl(phone)
  const tgUrl = buildTelegramUrl(telegram)
  const mailUrl = buildMailtoUrl(email)

  // Count how many contacts are configured (to show empty state if none)
  const configuredCount = [waUrl, telUrl, tgUrl, mailUrl].filter(Boolean).length

  return (
    <div className="space-y-4 text-sm">
      <h2 className="text-xl font-bold">Контакты</h2>
      <p className="text-muted-foreground">
        Свяжитесь с нами любым удобным способом. Мы отвечаем в течение 24 часов в будние дни.
      </p>

      {configuredCount === 0 ? (
        <div className="p-4 rounded-2xl bg-accent/30 text-center text-muted-foreground">
          Контакты ещё не настроены. Администратор может добавить их в Studio → Контакты.
        </div>
      ) : (
        <div className="space-y-3">
          {mailUrl && (
            <ContactCard
              icon={<Mail className="h-5 w-5" />}
              label="Email"
              value={email!}
              href={mailUrl}
            />
          )}
          {telUrl && (
            <ContactCard
              icon={<Phone className="h-5 w-5" />}
              label="Телефон"
              value={phone!}
              href={telUrl}
            />
          )}
          {waUrl && (
            <ContactCard
              icon={<MessageCircle className="h-5 w-5" />}
              label="WhatsApp"
              value={whatsapp!}
              href={waUrl}
            />
          )}
          {tgUrl && (
            <ContactCard
              icon={<Send className="h-5 w-5" />}
              label="Telegram"
              value={telegram!}
              href={tgUrl}
            />
          )}
        </div>
      )}

      <div className="p-4 rounded-2xl bg-accent/30">
        <div className="font-semibold text-sm mb-1">Юридический адрес</div>
        <p className="text-xs text-muted-foreground">
          ООО «Три девятки»<br />
          123456, г. Москва, ул. Примерная, д. 1, оф. 999<br />
          ИНН 1234567890 · ОГРН 1234567890123
        </p>
      </div>

      <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
        <div className="font-semibold text-sm mb-1">Чат в приложении</div>
        <p className="text-xs text-muted-foreground mb-2">
          Самый быстрый способ получить помощь — написать в чат поддержки прямо в приложении.
        </p>
      </div>

      <div className="text-xs text-muted-foreground border-t border-border/30 pt-3 mt-4">
        Режим работы поддержки: Пн–Пт 9:00–21:00 (МСК), Сб 10:00–18:00, Вс — выходной.
      </div>
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
