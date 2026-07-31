'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================================
// i18n store — minimal translation system.
//
// Architecture:
// - Each language is a flat key→string map (e.g. { 'home.title': '...' }).
// - The current language is persisted in localStorage via zustand persist.
// - Adding a new language = adding a new entry to the `translations` map
//   below + a new option in the language picker UI. NO code changes needed.
// - The `t(key, fallback?)` function returns the translation for the
//   current language, or the fallback, or the key itself.
//
// This is intentionally NOT a heavy i18n library (next-intl, react-i18next).
// The app is small enough that a flat map is sufficient and keeps the
// bundle tiny. Migrating to a full library later is a drop-in replacement
// of this file.
// ============================================================================

export type Language = 'ru' | 'en'

type TranslationMap = Record<string, string>

const ru: TranslationMap = {
  // Navigation
  'nav.home': 'Главная',
  'nav.catalog': 'Каталог',
  // v12.3: 'nav.feed' removed — Feed module deleted, replaced by 999 CLUB.
  'nav.chat': 'Чат',
  'nav.profile': 'Профиль',
  'nav.more': 'Ещё',
  'nav.search': 'Поиск',

  // Home
  'home.title': '999 — Три девятки. Маркетплейс нового поколения',
  'home.subtitle': 'Покупайте, делитесь моментами и общайтесь в одном современном приложении.',
  'home.cta.catalog': 'В каталог',
  // v12.3: 'home.cta.feed' removed — Feed module deleted.

  // Orders
  'orders.title': 'Мои заказы',
  'orders.subtitle': 'История и статусы ваших заказов',
  'orders.tab.all': 'Все',
  'orders.tab.active': 'Активные',
  'orders.tab.delivered': 'Завершённые',
  'orders.tab.cancelled': 'Отменённые',
  'orders.empty': 'Заказов пока нет',
  'orders.empty.cta': 'Откройте каталог и сделайте первый заказ',
  'orders.status.pending': 'Ожидает оплаты',
  'orders.status.paid': 'Оплачен',
  'orders.status.shipped': 'Отправлен',
  'orders.status.delivered': 'Доставлен',
  'orders.status.cancelled': 'Отменён',
  'orders.cancel': 'Отменить заказ',
  'orders.cancel.confirm': 'Отменить заказ? Это действие нельзя отменить.',

  // Reviews
  'reviews.title': 'Отзывы',
  'reviews.subtitle': 'Реальные отзывы покупателей на товары',
  'reviews.search': 'Поиск товара для отзыва…',
  'reviews.empty': 'Отзывов пока нет',
  'reviews.empty.cta': 'Будьте первым, кто оставит отзыв',
  'reviews.add': 'Оставить отзыв',
  'reviews.edit': 'Изменить',
  'reviews.delete': 'Удалить',
  'reviews.sort.newest': 'Новые',
  'reviews.sort.highest': 'Высокий',
  'reviews.sort.lowest': 'Низкий',

  // Support
  'support.title': 'Поддержка «Три девятки»',
  'support.online': 'Онлайн · отвечает в течение часа',
  'support.placeholder': 'Напишите сообщение…',
  'support.welcome': 'Здравствуйте! Я из команды поддержки «Три девятки». Чем могу помочь?',
  'support.disclaimer': 'Чат с поддержкой · ответы в течение 1 часа',

  // Settings
  'settings.title': 'Настройки',
  'settings.section.appearance': 'Внешний вид',
  'settings.section.notifications': 'Уведомления',
  'settings.section.language': 'Язык',
  'settings.section.privacy': 'Конфиденциальность',
  'settings.darkTheme': 'Тёмная тема',
  'settings.darkTheme.desc': 'Переключить оформление',
  'settings.pushNotifs': 'Push-уведомления',
  'settings.pushNotifs.desc': 'Уведомления о новых сообщениях и заказах',
  'settings.inAppSounds': 'Звуки в приложении',
  'settings.inAppSounds.desc': 'Звуковой сигнал при получении сообщения',
  'settings.language': 'Язык интерфейса',
  'settings.language.desc': 'Выберите язык приложения',
  'settings.privacy': 'Политика конфиденциальности',
  'settings.privacy.desc': 'Как мы обрабатываем ваши данные',
  'settings.about': 'О приложении',
  'settings.about.desc': 'Версия, сборка, лицензия',
  'settings.share': 'Поделиться приложением',
  'settings.share.desc': 'Рассказать друзьям о «Три девятки»',

  // Common
  'common.cancel': 'Отмена',
  'common.save': 'Сохранить',
  'common.delete': 'Удалить',
  'common.back': 'Назад',
  'common.loading': 'Загрузка…',
  'common.error': 'Ошибка',
  'common.retry': 'Попробовать снова',
  'common.logout': 'Выйти из аккаунта',
  // v12.9: CLUB + checkout + cart keys
  'club.title': '999 CLUB',
  'club.tagline': 'VIP-зона привилегий, подарков и акций',
  'club.points': 'баллов',
  'club.referrals': 'рефералов',
  'club.streak': 'дней подряд',
  'club.opportunities': 'Возможности',
  'cart.title': 'Корзина',
  'cart.checkout': 'Оформить заказ',
  'cart.total': 'Итого',
  'cart.coupon': 'Промокод',
  'cart.apply': 'Применить',
  'cart.empty': 'Корзина пуста',
  'checkout.title': 'Оформление заказа',
  'checkout.name': 'Имя',
  'checkout.phone': 'Телефон',
  'checkout.address': 'Адрес доставки',
  'checkout.delivery': 'Доставка',
  'checkout.pickup': 'Самовывоз',
  'checkout.comment': 'Комментарий к заказу',
  'checkout.submit': 'Оформить заказ',
  'checkout.success': 'Заказ оформлен!',
  'search.placeholder': 'Поиск товаров…',
  'search.sort.newest': 'Новинки',
  'search.sort.cheapest': 'Сначала дешевле',
  'search.sort.most_expensive': 'Сначала дороже',
  'search.sort.popular': 'Популярные',
}

// English translations — used when the user switches language.
// Keys must match the `ru` map exactly. Missing keys fall back to ru,
// then to the key itself.
const en: TranslationMap = {
  'nav.home': 'Home',
  'nav.catalog': 'Catalog',
  // v12.3: 'nav.feed' removed — Feed module deleted, replaced by 999 CLUB.
  'nav.chat': 'Chat',
  'nav.profile': 'Profile',
  'nav.more': 'More',
  'nav.search': 'Search',

  'home.title': '999 — Three Nines. Next-gen marketplace',
  'home.subtitle': 'Shop, share moments, and chat in one modern app.',
  'home.cta.catalog': 'Browse catalog',
  // v12.3: 'home.cta.feed' removed — Feed module deleted.

  'orders.title': 'My Orders',
  'orders.subtitle': 'History and status of your orders',
  'orders.tab.all': 'All',
  'orders.tab.active': 'Active',
  'orders.tab.delivered': 'Delivered',
  'orders.tab.cancelled': 'Cancelled',
  'orders.empty': 'No orders yet',
  'orders.empty.cta': 'Browse the catalog and place your first order',
  'orders.status.pending': 'Awaiting payment',
  'orders.status.paid': 'Paid',
  'orders.status.shipped': 'Shipped',
  'orders.status.delivered': 'Delivered',
  'orders.status.cancelled': 'Cancelled',
  'orders.cancel': 'Cancel order',
  'orders.cancel.confirm': 'Cancel this order? This action cannot be undone.',

  'reviews.title': 'Reviews',
  'reviews.subtitle': 'Real buyer reviews on products',
  'reviews.search': 'Search product to review…',
  'reviews.empty': 'No reviews yet',
  'reviews.empty.cta': 'Be the first to leave a review',
  'reviews.add': 'Leave a review',
  'reviews.edit': 'Edit',
  'reviews.delete': 'Delete',
  'reviews.sort.newest': 'Newest',
  'reviews.sort.highest': 'Highest',
  'reviews.sort.lowest': 'Lowest',

  'support.title': 'Three Nines Support',
  'support.online': 'Online · replies within 1 hour',
  'support.placeholder': 'Type a message…',
  'support.welcome': 'Hello! I am from the Three Nines support team. How can I help?',
  'support.disclaimer': 'Support chat · replies within 1 hour',

  'settings.title': 'Settings',
  'settings.section.appearance': 'Appearance',
  'settings.section.notifications': 'Notifications',
  'settings.section.language': 'Language',
  'settings.section.privacy': 'Privacy',
  'settings.darkTheme': 'Dark theme',
  'settings.darkTheme.desc': 'Toggle the visual theme',
  'settings.pushNotifs': 'Push notifications',
  'settings.pushNotifs.desc': 'Notifications about new messages and orders',
  'settings.inAppSounds': 'In-app sounds',
  'settings.inAppSounds.desc': 'Sound alert on new message',
  'settings.language': 'Interface language',
  'settings.language.desc': 'Choose the app language',
  'settings.privacy': 'Privacy Policy',
  'settings.privacy.desc': 'How we handle your data',
  'settings.about': 'About',
  'settings.about.desc': 'Version, build, license',
  'settings.share': 'Share app',
  'settings.share.desc': 'Tell friends about Three Nines',

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.back': 'Back',
  'common.loading': 'Loading…',
  'common.error': 'Error',
  'common.retry': 'Try again',
  'common.logout': 'Log out',
  // v12.9: CLUB + checkout + cart keys
  'club.title': '999 CLUB',
  'club.tagline': 'VIP zone of privileges, gifts and promos',
  'club.points': 'points',
  'club.referrals': 'referrals',
  'club.streak': 'day streak',
  'club.opportunities': 'Opportunities',
  'cart.title': 'Cart',
  'cart.checkout': 'Checkout',
  'cart.total': 'Total',
  'cart.coupon': 'Promo code',
  'cart.apply': 'Apply',
  'cart.empty': 'Cart is empty',
  'checkout.title': 'Checkout',
  'checkout.name': 'Name',
  'checkout.phone': 'Phone',
  'checkout.address': 'Delivery address',
  'checkout.delivery': 'Delivery',
  'checkout.pickup': 'Pickup',
  'checkout.comment': 'Order comment',
  'checkout.submit': 'Place order',
  'checkout.success': 'Order placed!',
  'search.placeholder': 'Search products…',
  'search.sort.newest': 'Newest',
  'search.sort.cheapest': 'Cheapest first',
  'search.sort.most_expensive': 'Most expensive first',
  'search.sort.popular': 'Popular',
}

const translations: Record<Language, TranslationMap> = { ru, en }

interface I18nState {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string, fallback?: string) => string
}

export const useI18n = create<I18nState>()(
  persist(
    (set, get) => ({
      language: 'ru',
      setLanguage: (lang) => set({ language: lang }),
      t: (key, fallback) => {
        const lang = get().language
        return translations[lang]?.[key] || translations.ru[key] || fallback || key
      },
    }),
    {
      name: '999pro-i18n',
      partialize: (s) => ({ language: s.language }),
    },
  ),
)

// List of available languages — used by the language picker UI.
export const AVAILABLE_LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
]
