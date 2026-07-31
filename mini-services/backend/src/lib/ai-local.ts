// 999 — Три девятки — AI local command router (v22: full voice agent)
// ----------------------------------------------------------------------------
// Lightweight pattern matching for commands that DON'T need DeepSeek.
// Handles: navigation, greetings, help, music playback, cart operations,
// order queries, analytics queries — all via real backend actions.
//
// Returns null when the message doesn't match any local pattern — the chat
// endpoint will then route to DeepSeek.
// ----------------------------------------------------------------------------
export interface LocalCommandResult {
  handled: true
  reply: string
  // v22: expanded action types for full app control via voice
  action?: {
    type: 'navigate' | 'open_cart' | 'open_checkout' | 'play_music' | 'search_product' | 'search_query'
    view?: string
    query?: string
  }
  kind: 'navigate' | 'help' | 'greeting' | 'action'
}

// All views the assistant can navigate to.
const VIEW_TRIGGERS: Record<string, string[]> = {
  home: ['главн', 'домой', 'на главную', 'home', 'main'],
  catalog: ['каталог', 'товары', 'catalog', 'products', 'shop'],
  chat: ['чат', 'сообщения', 'messages', 'chat', 'переписка'],
  audio: ['аудио', 'музык', 'audio', 'music', 'sound'],
  video: ['видео', 'фильм', 'video', 'films', 'movie'],
  media: ['медиа', 'media', 'контент'],
  studio: ['студио', 'студия', 'админ', 'studio', 'admin'],
  profile: ['профиль', 'profile', 'аккаунт', 'личный кабинет'],
  settings: ['настрой', 'settings', 'config'],
  orders: ['заказы', 'orders', 'мои заказы'],
  reviews: ['отзыв', 'reviews', 'рейтинг'],
  support: ['поддержк', 'support', 'помощь'],
  favorites: ['избранн', 'favorites', 'избранное'],
  club: ['клуб', 'club', '999 club', 'бонус'],
  analytics: ['аналитик', 'статистик', 'analytics', 'stats', 'продажи', 'dashboard'],
}

const HELP_REPLIES = [
  'Я могу помочь вам с выбором товара, расчётом стоимости, поиском музыки и видео, навигацией по приложению и управлением заказами. Просто скажите, что вас интересует — например, «открой каталог» или «поставь музыку».',
  'Я — ваш голосовой ассистент. Могу открывать разделы, искать товары, оформлять заказы, включать музыку и видео. Что хотите сделать?',
]

const GREETING_REPLIES = [
  'Здравствуйте! Я Агент 999. Чем могу помочь?',
  'Привет! Готов помочь с товарами, навигацией или музыкой. Что вас интересует?',
]

export function tryLocalCommand(message: string): LocalCommandResult | null {
  const m = message.toLowerCase().trim()

  // Greeting
  if (/^(привет|здравствуй|здравствуйте|hi|hello|hey|добрый\s+день|доброе\s+утро|добрый\s+вечер)([!\s.,?]|$)/i.test(m)) {
    return { handled: true, reply: GREETING_REPLIES[Math.floor(Math.random() * GREETING_REPLIES.length)], kind: 'greeting' }
  }

  // Help / capabilities
  if (/^(что ты умеешь|помощь|help|что ты можешь|как тебя использовать|твои возможности)/.test(m)) {
    return { handled: true, reply: HELP_REPLIES[Math.floor(Math.random() * HELP_REPLIES.length)], kind: 'help' }
  }

  // v22: Cart operations — "открой корзину", "покажи корзину"
  if (/(корзин|cart|checkout)/.test(m) && /(открой|покажи|перейди|open|show)/.test(m)) {
    return { handled: true, reply: 'Открываю корзину.', action: { type: 'open_cart' }, kind: 'action' }
  }
  if (/^(оформи|checkout|оплати)/.test(m)) {
    return { handled: true, reply: 'Открываю оформление заказа.', action: { type: 'open_checkout' }, kind: 'action' }
  }

  // v22 final: Music playback — REMOVED local regex match for "включи музыку X"
  // and "найди музыку X". Now the LLM handles these via the play_audio and
  // search_audio tools (defined in lib/ai-tools.ts). This lets the AI:
  //   1. Actually search the audio catalog (not just open the Hub)
  //   2. Autoplay the first matching track
  //   3. Report what it found ("Включаю «Крошка моя» группы Руки Вверх")
  // Previously the local regex returned "Открываю Audio Hub. Выбирайте музыку!"
  // — generic, no actual search, no autoplay.
  //
  // The ONLY music-related case handled locally is bare "музыка" / "аудио"
  // (no song name) — opens the Hub for browsing.
  if (/^(музык|аудио|music|audio)$/i.test(m)) {
    return { handled: true, reply: 'Открываю Audio Hub. Выбирайте музыку!', action: { type: 'play_music' }, kind: 'action' }
  }

  // v22: Media hub — "открой медиа"
  if (/(открой|включи|поставь|open)\s*(медиа|media)/.test(m)) {
    return { handled: true, reply: 'Открываю Media Hub.', action: { type: 'navigate', view: 'media' }, kind: 'navigate' }
  }

  // v22: Search product — "найди товар X", "поищи X"
  // v22 final: only handle "найди ТОВАР X" explicitly — bare "найди X" goes
  // to the LLM so it can pick search_products vs search_audio intelligently.
  const searchMatch = m.match(/(?:найди|поищи|искать|search|find)\s+товар\s+(.+)/i)
  if (searchMatch && searchMatch[1] && searchMatch[1].length > 1) {
    const query = searchMatch[1].trim()
    return {
      handled: true,
      reply: `Ищу товар «${query}» в каталоге...`,
      action: { type: 'search_product', query },
      kind: 'action',
    }
  }

  // v22: Navigation: "открой каталог", "перейди в профиль", "go to chat"
  const navMatch = m.match(/(?:открой|перейди|перейти|go to|open|показать|show)\s+([a-zа-яё\s]+)/i)
  if (navMatch) {
    const target = navMatch[1].trim()
    for (const [view, triggers] of Object.entries(VIEW_TRIGGERS)) {
      if (triggers.some((t) => target.includes(t))) {
        return { handled: true, reply: `Открываю «${viewLabel(view)}».`, action: { type: 'navigate', view }, kind: 'navigate' }
      }
    }
  }

  // v22: Bare view name — "каталог", "чат", "аналитика"
  for (const [view, triggers] of Object.entries(VIEW_TRIGGERS)) {
    if (triggers.some((t) => m === t || m === `${t} открой`)) {
      if (m.length < 25) {
        return { handled: true, reply: `Открываю «${viewLabel(view)}».`, action: { type: 'navigate', view }, kind: 'navigate' }
      }
    }
  }

  // v22: "покажи заказы" / "мои заказы" → navigate to orders
  if (/^(покажи\s+)?(заказы|мои\s+заказы|orders)$/i.test(m)) {
    return { handled: true, reply: 'Открываю ваши заказы.', action: { type: 'navigate', view: 'orders' }, kind: 'navigate' }
  }

  // v22: "покажи аналитику" / "статистика продаж" → navigate to analytics (admin)
  if (/(аналитик|статистик|продажи|analytics|stats)/.test(m) && /(покажи|открой|show|open)/.test(m)) {
    return { handled: true, reply: 'Открываю аналитику.', action: { type: 'navigate', view: 'analytics' }, kind: 'navigate' }
  }

  return null
}

function viewLabel(view: string): string {
  const labels: Record<string, string> = {
    home: 'Главная', catalog: 'Каталог', chat: 'Чат', audio: 'Audio Hub',
    video: 'Video Hub', media: 'Media Hub', studio: 'Studio',
    profile: 'Профиль', settings: 'Настройки', orders: 'Заказы',
    reviews: 'Отзывы', support: 'Поддержка', favorites: 'Избранное',
    club: '999 CLUB', analytics: 'Аналитика',
  }
  return labels[view] ?? view
}
