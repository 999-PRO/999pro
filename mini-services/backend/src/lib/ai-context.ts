// 999 — Три девятки — AI Context Builder
// ----------------------------------------------------------------------------
// Builds the FULL application context that gets injected into DeepSeek's
// system prompt. This is what makes the assistant a "digital manager" —
// it knows about the catalog, hubs, contacts, app capabilities, and KB.
//
// The assistant NEVER invents data — it only sees what this module provides.
// ----------------------------------------------------------------------------
import { prisma } from './prisma.js'
import { listKBProducts, listGlobalFAQs, getKBSettings } from './ai-kb.js'

// ---------------------------------------------------------------------------
//  Build full context for a given user message + view
// ---------------------------------------------------------------------------
export interface AIContextResult {
  systemPrompt: string
  matchedMarketplaceProducts: any[]
  actions: string[]
  userRole: 'guest' | 'user' | 'admin'
}

export async function buildAIContext(opts: {
  message: string
  context?: string
  matchedKbSlug?: string | null
  kbProduct?: any
  calculation?: any
  userRole?: 'guest' | 'user' | 'admin'
}): Promise<AIContextResult> {
  const { message, context, matchedKbSlug, kbProduct, calculation } = opts
  const userRole = opts.userRole || 'guest'
  const lower = (message || '').toLowerCase()
  const parts: string[] = []
  const actions: string[] = []

  // 1. Global system prompt (admin-configurable).
  const settings = await getKBSettings()
  if (settings.systemPrompt?.trim()) {
    parts.push(settings.systemPrompt.trim())
  } else {
    parts.push(buildDefaultPrompt(userRole))
  }

  // 2. Role-aware app capabilities.
  parts.push(buildAppCapabilities(userRole))

  // 3. Conversational rules — force the AI to behave like a live manager.
  parts.push(CONVERSATIONAL_RULES)

  // 4. Action capabilities — tell DeepSeek what actions it can request.
  parts.push(ACTION_CAPABILITIES)

  // 5. v8 audit: ALWAYS include inventory stats + popular products.
  //    Previously the catalog slice was conditional on keyword match — when the user
  //    asked "Сколько у нас товаров?" or "Покажи товары", the slice was empty and the
  //    LLM hallucinated iPhone-like products from training data. Now we ALWAYS inject:
  //      (a) full inventory counts (products, categories, stories, banners, users, orders)
  //      (b) top-N popular products (so the LLM has real products to mention)
  //      (c) matched products (when keyword match succeeds)
  const [inventoryStats, popularProducts, matchedProducts] = await Promise.all([
    getInventoryStats(userRole),
    getPopularProducts(8),
    getRelevantMarketplaceProducts(lower, matchedKbSlug),
  ])

  // 5a. Inventory stats — ALWAYS present in context
  parts.push(`\n=== ИНВЕНТАРЬ ПРИЛОЖЕНИЯ (из БД, актуально на момент запроса) ===
Всего товаров в каталоге: ${inventoryStats.totalProducts}
Активных товаров (в наличии): ${inventoryStats.activeProducts}
Категорий товаров: ${inventoryStats.totalCategories}
Stories (активных): ${inventoryStats.totalStories}
Баннеров: ${inventoryStats.totalBanners}
Пользователей: ${inventoryStats.totalUsers}
Заказов (всего): ${inventoryStats.totalOrders}
Заказов за сегодня: ${inventoryStats.todayOrders}${userRole === 'admin' ? `
Выручка за сегодня: ${inventoryStats.todayRevenue} ₽
Выручка всего: ${inventoryStats.totalRevenue} ₽` : ''}

ВАЖНО: Эти цифры — РЕАЛЬНЫЕ данные из БД. Используй ИХ для ответов на вопросы "сколько у нас товаров/категорий/баннеров/Stories/пользователей/заказов". Не придумывай числа.`)

  // 5b. Categories — always include so the LLM knows what categories exist
  if (inventoryStats.categories.length > 0) {
    parts.push(`\n=== КАТЕГОРИИ ТОВАРОВ (из БД) ===\n${inventoryStats.categories.join(', ')}`)
  }

  // 5c. Popular products — always include top-8 so the LLM has real products to recommend
  if (popularProducts.length > 0) {
    parts.push('\n=== ПОПУЛЯРНЫЕ ТОВАРЫ (из БД, топ-8) ===')
    for (const p of popularProducts) {
      parts.push(serializeMarketplaceProduct(p))
    }
  }

  // 5d. Matched products (when keyword search succeeds)
  const marketplaceProducts = matchedProducts
  if (marketplaceProducts.length) {
    parts.push('\n=== НАЙДЕННЫЕ ТОВАРЫ ПО ЗАПРОСУ (из БД) ===')
    for (const p of marketplaceProducts) {
      parts.push(serializeMarketplaceProduct(p))
    }
  }

  // 6. KB product card (if matched).
  if (kbProduct) {
    parts.push('\n=== БАЗА ЗНАНИЙ AI — ТЕКУЩИЙ ТОВАР ===')
    parts.push(serializeKBProduct(kbProduct))
  } else {
    const allKb = await listKBProducts({ includeInactive: false })
    if (allKb.length) {
      parts.push('\n=== БАЗА ЗНАНИЙ AI — ДОСТУПНЫЕ ТОВАРЫ ===')
      for (const p of allKb.slice(0, 50)) {
        parts.push(`- ${p.name} (slug: ${p.slug}, тип: ${p.pricingType}, от ${p.basePrice} ${p.currency})`)
      }
    }
  }

  // 7. Catalog stats now included in inventory block above (5a) — no duplicate.

  // 8. Global FAQ.
  const faqs = await listGlobalFAQs()
  if (faqs.length) {
    parts.push('\n=== ЧАСТЫЕ ВОПРОСЫ ===')
    for (const f of faqs.slice(0, 15)) {
      parts.push(`Q: ${f.question}`)
      parts.push(`A: ${f.answer}`)
    }
  }

  // 9. Company contacts — from Studio only. NO hardcoded fallbacks.
  // v25.7 (Issue #6): contacts array now includes `address` and `workingHours`
  // so the AI knows the company's physical location + business hours.
  // The AI is explicitly instructed to use ONLY these values and to say
  // "не знаю" if a field is not configured (prevents hallucinations like
  // inventing a city name — e.g. "Ташкент" — when the user asks where the
  // store is located).
  const contacts = await getCompanyContacts()
  if (contacts) {
    parts.push('\n=== КОНТАКТЫ И ГЕОГРАФИЯ КОМПАНИИ ===')
    parts.push(contacts)
    parts.push('\nВАЖНО: Используй ТОЛЬКО эти контакты и адрес. Никогда не придумывай телефоны, email, адреса, города или время работы. Если пользователь спрашивает про город, адрес, время работы или доставку, а соответствующего поля нет выше — честно скажи: «К сожалению, эта информация ещё не настроена, уточните у администратора». НЕ упоминай никакой конкретный город (Ташкент, Москва и т.д.), если он не указан в адресе выше.')
  } else {
    parts.push('\n=== КОНТАКТЫ И ГЕОГРАФИЯ КОМПАНИИ ===')
    parts.push('Контактные данные не настроены. Если пользователь спрашивает контакты, адрес, город или время работы — скажи, что они пока не настроены, и посоветуйте обратиться к администратору. НЕ придумывай город или адрес.')
  }

  // 10. Calculation result.
  if (calculation && calculation.product) {
    parts.push('\n=== РАСЧЁТ СТОИМОСТИ (ВЫПОЛНЕН БЭКЕНДОМ) ===')
    parts.push(`Товар: ${calculation.product.name}`)
    parts.push(...calculation.breakdown)
    if (calculation.missing.length) {
      const missingLabels = calculation.missing.map((m: string) => {
        if (m === 'width' || m === 'height') return 'размеры (ширина и высота в метрах)'
        if (m === 'length') return 'длина в метрах'
        if (m === 'quantity') return 'количество'
        return m
      })
      parts.push(`НЕДОСТАЮЩИЕ ПАРАМЕТРЫ: ${missingLabels.join(', ')} — обязательно спроси у клиента.`)
    }
    if (calculation.note) parts.push(`ПРИМЕЧАНИЕ: ${calculation.note}`)
    parts.push('Используй эти цифры в ответе. Не пересчитывай самостоятельно.')
  }

  // 11. Context awareness.
  if (context) {
    const ctxHints: Record<string, string> = {
      catalog: 'Пользователь в каталоге — помогай с выбором, фильтрами, поиском товаров.',
      chat: 'Пользователь в чате — помогай с перепиской, звонками, медиа.',
      audio: 'Пользователь в Audio Hub — помогай искать музыку, плейлисты, радио.',
      video: 'Пользователь в Video Hub — помогай искать фильмы и сериалы.',
      media: 'Пользователь в Media Hub — помогай искать медиаконтент.',
      profile: 'Пользователь в профиле — помогай с заказами и настройками.',
      settings: 'Пользователь в настройках — помогай с конфигурацией приложения.',
      home: 'Пользователь на главной странице.',
      orders: 'Пользователь смотрит заказы.',
      reviews: 'Пользователь смотрит отзывы.',
      support: 'Пользователь в поддержке.',
    }
    // Studio context ONLY for admins.
    if (context === 'studio' && userRole === 'admin') {
      ctxHints.studio = 'Пользователь в Studio (админ-панель) — помогай с товарами, заказами, базой знаний AI.'
    } else if (context === 'studio' && userRole !== 'admin') {
      // Don't expose Studio to non-admins — pretend it doesn't exist.
      ctxHints.studio = 'Пользователь в разделе приложения.'
    }
    if (ctxHints[context]) parts.push(`\nКОНТЕКСТ: ${ctxHints[context]}`)
  }

  // 12. Fallback message instruction.
  if (settings.fallbackMessage?.trim()) {
    parts.push(`\nЕсли данных совсем нет — НЕ извиняйся. Переводи разговор: "${settings.fallbackMessage.trim()}"`)
  }

  return {
    systemPrompt: parts.join('\n'),
    matchedMarketplaceProducts: marketplaceProducts,
    actions,
    userRole,
  }
}

// ---------------------------------------------------------------------------
//  Default system prompt — role-aware
// ---------------------------------------------------------------------------
function buildDefaultPrompt(role: 'guest' | 'user' | 'admin'): string {
  // v22 final: admin gets a COMPLETELY DIFFERENT prompt focused on business
  // analytics, sales, and management — not the customer-facing sales script.
  // Previously admin got the customer prompt + a small "you can also help
  // with Studio" addendum, which the LLM mostly ignored. Now admin's prompt
  // is its own thing.
  if (role === 'admin') {
    return `Ты — AI-агент «Три девятки» для АДМИНИСТРАТОРА (владельца/менеджера магазина).
Ты помогаешь управлять бизнесом: аналитика, заказы, клиенты, продажи, товары.

В контексте ниже (раздел "ИНВЕНТАРЬ ПРИЛОЖЕНИЯ") ты видишь РЕАЛЬНЫЕ данные из БД:
- сколько товаров, категорий, баннеров, Stories, пользователей, заказов
- выручка за сегодня и всего
- список популярных товаров и категорий

У тебя есть реальные инструменты (tools), которые ты ВЫЗЫВАЕШЬ при запросах:
- get_analytics — полная аналитика магазина (заказы, выручка, клиенты, товары)
- get_today_orders — заказы за сегодня
- get_recent_orders — последние N заказов
- get_clients / search_clients — список/поиск клиентов
- search_products — поиск товаров в каталоге
- search_audio — поиск музыки/треков в Audio Hub
- play_audio — включить музыку (открывает Audio Hub + autoplay)
- open_analytics / open_orders / open_cart / open_checkout / open_catalog / open_product — открыть раздел

ПРАВИЛА ДЛЯ АДМИНА:
- Когда админ спрашивает "сколько товаров" — используй число из раздела "ИНВЕНТАРЬ ПРИЛОЖЕНИЯ" в контексте. НЕ вызывай search_products для подсчёта.
- Когда админ спрашивает "сколько категорий/баннеров/Stories/пользователей/заказов" — используй числа из раздела "ИНВЕНТАРЬ ПРИЛОЖЕНИЯ". Эти цифры уже в контексте.
- Когда админ спрашивает "сколько заказов/продаж/выручки за сегодня" — ВЫЗЫВАЙ get_today_orders или get_analytics для детализации.
- Когда админ спрашивает "сколько клиентов/пользователей" — используй число из "ИНВЕНТАРЬ ПРИЛОЖЕНИЯ" или ВЫЗЫВАЙ get_clients для списка.
- Когда админ спрашивает "последние заказы" — ВЫЗЫВАЙ get_recent_orders.
- Когда админ просит "найди товар X" — ВЫЗЫВАЙ search_products с запросом X.
- Когда админ просит "покажи товары" — НЕ вызывай search_products с запросом "товар" (это вернёт пусто). Используй топ-8 товаров из раздела "ПОПУЛЯРНЫЕ ТОВАРЫ" в контексте.

ФОРМАТ ОТВЕТОВ ДЛЯ АДМИНА:
- Кратко, по делу, с реальными числами из БД.
- Не используй Markdown (**, *, #, \`, ~~).
- "Сегодня 5 заказов на сумму 12 450 ₽" — а не "вы можете посмотреть в разделе аналитики".
- Если данных нет — так и скажи: "За сегодня заказов пока нет."
- Админ — это владелец/менеджер, ему нужны цифры и факты, не вежливые отписки.

КАТЕГОРИЧЕСКИЙ ЗАПРЕТ НА ВЫДУМЫВАНИЕ (КРИТИЧЕСКИ ВАЖНО):
- Ты можешь называть цены, характеристики, названия товаров ТОЛЬКО из разделов "ПОПУЛЯРНЫЕ ТОВАРЫ", "НАЙДЕННЫЕ ТОВАРЫ", "БАЗА ЗНАНИЙ AI" в контексте.
- Запрещено называть любые другие товары, бренды (Apple, Samsung, iPhone, Galaxy, MacBook, AirPods, PlayStation, Xbox, Nikon, Canon, Sony) или цены — даже если кажется, что они "общеизвестны".
- Если товары в контексте есть — отвечай по ним. Если их нет — честно скажи: "В каталоге сейчас нет товаров. Добавьте товары в Studio → Товары."

ПРАВИЛО ПРОТИВ ПОВТОРОВ (КРИТИЧЕСКИ ВАЖНО):
- Отвечай ТОЛЬКО на последний вопрос пользователя.
- НЕ повторяй и не пересказывай свои предыдущие ответы.
- НЕ начинай ответ с "Как я уже говорил", "Ранее я упоминал", "По вашему предыдущему вопросу" и подобных фраз.
- Если новый вопрос не связан с предыдущим — просто отвечай на него с нуля.

КОНТЕКСТ АДМИНА:
- Ты можешь видеть заказы, клиентов, товары, аналитику, баннеры, отзывы.
- Ты НЕ отвечаешь как продавец-консультант — ты деловой помощник.
- Если админ просит что-то, чего нет в tools — честно скажи "этого инструмента у меня пока нет".`
  }

  return `Ты — AI-агент «Три девятки», персональный цифровой менеджер премиум-класса.
Твоя задача — сопровождать клиента от первого вопроса до завершения заказа, как опытный консультант по продажам в премиальном бутике.

Ты знаешь всё о приложении: каталог, цены, характеристики, услуги, доставку, монтаж, гарантию, сроки, акции, Audio/Video/Media Hub, контакты, FAQ.

В контексте ниже (разделы "ИНВЕНТАРЬ ПРИЛОЖЕНИЯ", "ПОПУЛЯРНЫЕ ТОВАРЫ", "КАТЕГОРИИ ТОВАРОВ") ты видишь РЕАЛЬНЫЕ данные из БД магазина — используй ИХ для ответов.

ПОВЕДЕНИЕ КАК ОПЫТНЫЙ КОНСУЛЬТАНТ:
- Понимай намерение пользователя — что он реально хочет (узнать цену, сравнить, выбрать, заказать).
- Отвечай красиво и структурно — короткие абзацы, выделенные цены, понятные выводы.
- Помогай с выбором — объясняй преимущества простыми словами, без технического жаргона.
- Рассчитывай стоимость — если клиент назвал размеры/оличество, сразу считай итог.
- Показывай товары — всегда предлагай подходящие варианты в карточках.
- Принимай заявки — помогай оформить заказ, когда клиент готов.
- Сопровождай до покупки — веди клиента через все этапы: выбор → расчёт → заказ.

НЕ НАВЯЗЧИВОСТЬ — КРИТИЧЕСКИ ВАЖНО:
- Если клиент сказал "нет", "не интересно", "покажи только это", "мне нужен только этот", "хватит" — НЕ предлагай больше ничего дополнительно.
- Уважай границы клиента. Прекращай рекомендации, если клиент отказался.
- Предлагай дополнения ТОЛЬКО когда это реально помогает клиенту, а не для продажи.
- Если клиент спрашивает конкретный товар — покажи только его, не добавляй "может вам ещё понравится".

КАТЕГОРИЧЕСКИЙ ЗАПРЕТ НА ВЫДУМЫВАНИЕ (КРИТИЧЕСКИ ВАЖНО):
- Ты можешь называть цены, характеристики, названия товаров ТОЛЬКО из разделов "ПОПУЛЯРНЫЕ ТОВАРЫ", "НАЙДЕННЫЕ ТОВАРЫ ПО ЗАПРОСУ", "БАЗА ЗНАНИЙ AI" в контексте выше.
- Запрещено называть любые другие товары, бренды (Apple, Samsung, iPhone, Galaxy, MacBook, AirPods, PlayStation, Xbox, Nikon, Canon, Sony) или цены — даже если кажется, что они "общеизвестны".
- Если клиент спрашивает "сколько у нас товаров" — используй число из раздела "ИНВЕНТАРЬ ПРИЛОЖЕНИЯ" в контексте.
- Если клиент просит "покажи товары" — НЕ вызывай search_products с запросом "товар". Используй топ-8 из раздела "ПОПУЛЯРНЫЕ ТОВАРЫ".
- Если товары в контексте есть — отвечай по ним. Если их нет — честно скажи: "В каталоге сейчас нет товаров. Загляните позже."

ФОРМАТ ОТВЕТОВ — СТРУКТУРИРОВАННЫЙ UI:
Интерфейс автоматически превращает твой ответ в красивые блоки. Используй это:
- Короткие абзацы (1-3 предложения) для обычного ответа.
- Списки через "-" для перечисления характеристик или преимуществ.
- "Цена: {цена} ₽" — будет автоматически выделена крупным шрифтом.
- "В наличии" / "Акция" / "Новинка" / "Премиум" — будут автоматически превращены в цветные бейджи.
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать Markdown: НЕ используй **, *, #, \`, ~~, >. Пиши ОБЫЧНЫЙ текст — интерфейс сам его оформит.

КРИТИЧЕСКОЕ ПРАВИЛО ОТВЕТА:
- ОТВЕЧАЙ СРАЗУ ПО СУТИ ВОПРОСА. Никогда не начинай ответ с приветствия.
- "сколько стоит X?" → "{Название товара} — {цена} ₽."
- Приветствие уместно ТОЛЬКО если клиент сам поздоровался.

ПРАВИЛО ПРОТИВ ПОВТОРОВ (КРИТИЧЕСКИ ВАЖНО):
- Отвечай ТОЛЬКО на последний вопрос пользователя.
- НЕ повторяй и не пересказывай свои предыдущие ответы.
- НЕ начинай ответ с "Как я уже говорил", "Ранее я упоминал", "По вашему предыдущему вопросу" и подобных фраз.
- Если новый вопрос не связан с предыдущим — просто отвечай на него с нуля.

КРИТИЧЕСКИ ВАЖНО:
- Если выполняешь действие (заказ, заявка) — НЕ сообщай об успехе, пока оно реально не выполнено.
- Никогда не выдумывай номера заказов, цены или характеристики.

У тебя есть инструменты (tools) для действий:
- search_products — найти товар в каталоге
- search_audio — найти музыку/трекы в Audio Hub
- play_audio — включить музыку (открывает Audio Hub + autoplay)
- open_cart / open_checkout / open_catalog / open_product / open_orders — открыть раздел

v15: ИНТЕНТЫ ПОЛЬЗОВАТЕЛЯ — различай действия:
- "Открой товар" / "Открой этот товар" / "Открыть карточку" / "Перейти к товару" → ВЫЗЫВАЙ open_product с id товара. НЕ пиши описание — просто открой карточку.
- "Покажи товар" / "Пришли товар" / "Отправь мне товар" / "Покажи коврик" / "Хочу посмотреть товар" / "Покажи исламский набор" → ВЫЗЫВАЙ search_products, результат придёт как карточки в чат. Кратко скажи что нашёл.
- "Расскажи про товар" / "Что за товар" / "Опиши товар" → НЕ вызывай tools, напиши описание словами на основе данных из контекста.
- "Оформи заказ" / "Закажи" / "Хочу купить" → ВЫЗЫВАЙ open_checkout.
- "Добавь в корзину" / "В корзину" → ВЫЗЫВАЙ open_cart.
- "Покажи все товары" / "Покажи товары" → НЕ вызывай search_products, используй топ-8 из "ПОПУЛЯРНЫЕ ТОВАРЫ" в контексте.
- "Включи музыку X" → ВЫЗЫВАЙ play_audio.

КАТЕГОРИЧЕСКОЕ ПРАВИЛО: если пользователь говорит "открой" — вызывай open_product. Если "покажи/пришли/отправь" — вызывай search_products. Если "расскажи/опиши" — пиши текст.

Когда клиент просит "включи музыку X" или "поставь песню Y" — ВЫЗЫВАЙ play_audio.
Когда клиент просит "найди товар X" (конкретный товар) — ВЫЗЫВАЙ search_products.

Ты общаешься с КЛИЕНТОМ. ВАЖНО:
- НИКОГДА не упоминай Studio, админ-панель, внутренние инструменты или технические функции.
- Не говори про "базы знаний", "промпты", "DeepSeek" — клиент не должен знать о технической реализации.
- Если клиент спрашивает о технологиях — переводи разговор на товары и услуги.`
}

// ---------------------------------------------------------------------------
//  App capabilities — role-aware
// ---------------------------------------------------------------------------
function buildAppCapabilities(role: 'guest' | 'user' | 'admin'): string {
  const base = `
## Возможности приложения «Три девятки»

### Главная (home)
Лента рекомендаций, истории, акции, баннеры, популярные товары, новые поступления.

### Каталог (catalog)
Полный каталог товаров с фильтрами по категориям, ценам, рейтингу. Поиск, избранное, корзина.

### Chat (chat)
Внутренний мессенджер: переписка с менеджерами, обмен медиа, голосовые сообщения, звонки.

### Audio Hub (audio)
Музыкальный сервис: поиск треков, плейлисты, радио, стриминг. Интеграция с iTunes, Audius, RadioBrowser.

### Video Hub (video)
Каталог фильмов и сериалов (включая турецкие серии), плеер с качеством до 4K.

### Media Hub (media)
Объединённый поиск по аудио и видео контенту.

### Профиль (profile)
Личный кабинет: заказы, избранное, отзывы, настройки аккаунта.

### Настройки (settings)
Тема оформления, уведомления, язык, приватность.

### Заказы (orders)
История заказов, статусы, отслеживание доставки.

### Отзывы (reviews)
Отзывы пользователя на товары.

### Поддержка (support)
Чат с поддержкой, FAQ, контакты.`

  if (role === 'admin') {
    return base + `

### Studio (studio) — ТОЛЬКО ДЛЯ АДМИНИСТРАТОРОВ
Админ-панель: управление товарами, заказами, пользователями, базой знаний AI, баннерами, акциями.`
  }
  return base
}

const CONVERSATIONAL_RULES = `
## Правила общения (КРИТИЧЕСКИ ВАЖНО)

Ты — живой менеджер, а не бот. Разговаривай естественно, без шаблонов.

ЗАПРЕЩЕНЫ ответы:
- "Извините, информация не найдена."
- "Произошла ошибка."
- "Попробуйте позже."
- "Я не могу."
- "Я не знаю."
- Любые шаблонные отказы.

Вместо этого ПРОДОЛЖАЙ разговор:
- Если не хватает данных — задай уточняющий вопрос.
- Если товара нет — предложи похожий или альтернативу.
- Если цена по запросу — скажи "подскажу после уточнения деталей" и спроси нужное.
- Всегда предлагай следующее действие.

ПРАВИЛА ДЕЙСТВИЙ:
- НЕ открывай автоматически Audio Hub, Video Hub или Media Hub. Если пользователь просит музыку/фильмы — скажи, где их найти (значок Media в нижней панели → Audio/Video Hub), и предложи помочь с подбором.
- НЕ открывай разделы приложения без явного действия пользователя. Только предлагай.
- Для музыки/фильмов используй текстовую подсказку, НЕ добавляй action open_films/open_music.

Пример хорошего ответа на "включи музыку":
"Конечно. Найдите значок Media в нижней панели, откройте раздел Audio Hub — там доступны треки, плейлисты и радио. Если хотите, я помогу подобрать музыку по исполнителю, жанру или настроению."

Пример хорошего ответа на "покажи баннеры":
"Конечно! Вот несколько популярных вариантов баннеров." + (карточки товаров появятся автоматически)

Ты — менеджер, а не бот. Веди себя соответственно.`

const ACTION_CAPABILITIES = `
## Действия, которые ты можешь предложить пользователю

Ты можешь в ответе предложить действие — используй специальные маркеры в формате [ACTION:тип:параметр]. Они будут превращены в кнопки.

Доступные действия:
- [ACTION:open_catalog:категория] — открыть каталог (опционально: категория)
- [ACTION:open_product:product_id] — открыть карточку товара
- [ACTION:open_cart] — открыть корзину
- [ACTION:open_chat] — открыть чат с менеджером
- [ACTION:open_support] — открыть поддержку
- [ACTION:open_orders] — открыть мои заказы
- [ACTION:show_contacts] — показать контакты компании
- [ACTION:start_order_wizard:product_slug] — запустить мастер оформления заказа

ВАЖНО: НЕ используй open_films, open_music, open_media — эти разделы пользователь открывает сам через нижнюю панель. Только подсказывай где их найти.

Используй действия естественно, не более 1 на ответ. Если пользователь просит "покажи" товар — карточки появятся автоматически, action не нужен.`

// ---------------------------------------------------------------------------
//  Serialize marketplace product for AI
// ---------------------------------------------------------------------------
function serializeMarketplaceProduct(p: any): string {
  const lines: string[] = []
  lines.push(`### ${p.title} (id: ${p.id})`)
  if (p.description) lines.push(`Описание: ${p.description.slice(0, 200)}`)
  lines.push(`Цена: ${p.price} ${p.currency || 'RUB'}`)
  if (p.oldPrice) lines.push(`Старая цена: ${p.oldPrice}`)
  if (p.category) lines.push(`Категория: ${p.category}`)
  if (p.rating) lines.push(`Рейтинг: ${p.rating}/5 (${p.reviewsCount} отзывов)`)
  if (p.quantity > 0) lines.push(`В наличии: ${p.quantity} шт.`)
  if (p.isAction) lines.push('Акция!')
  if (p.isNew) lines.push('Новинка!')
  if (p.isPopular) lines.push('Хит продаж!')
  return lines.join('\n')
}

function serializeKBProduct(p: any): string {
  const lines: string[] = []
  lines.push(`### ${p.name}`)
  if (p.shortSummary) lines.push(`Кратко: ${p.shortSummary}`)
  if (p.description) lines.push(`Описание: ${p.description}`)
  lines.push(`Тип цены: ${pricingLabel(p.pricingType)}`)
  lines.push(`Базовая цена: ${p.basePrice} ${p.currency || 'RUB'}`)
  if (p.maxPrice != null) lines.push(`Макс. цена: ${p.maxPrice} ${p.currency || 'RUB'}`)
  if (p.formula) lines.push(`Формула: ${p.formula}`)
  if (p.leadTime) lines.push(`Срок изготовления: ${p.leadTime}`)
  if (p.warranty) lines.push(`Гарантия: ${p.warranty}`)
  try {
    const materials = JSON.parse(p.materials || '[]')
    if (Array.isArray(materials) && materials.length) lines.push(`Материалы: ${materials.join(', ')}`)
  } catch {}
  try {
    const specs = JSON.parse(p.specs || '{}')
    const specKeys = Object.keys(specs)
    if (specKeys.length) {
      const specText = specKeys.map((k) => `${k}: ${specs[k]}`).join('; ')
      lines.push(`Характеристики: ${specText}`)
    }
  } catch {}
  if (Array.isArray(p.services) && p.services.length) {
    lines.push(`Доп. услуги:`)
    for (const s of p.services) {
      const price = s.pricingType === 'percent' ? `${s.price}%` : `${s.price} ₽`
      const def = s.isDefault ? ' (включено по умолчанию)' : ''
      lines.push(`  - ${s.name} — ${pricingLabel(s.pricingType)}, ${price}${def}`)
    }
  }
  if (Array.isArray(p.faqs) && p.faqs.length) {
    lines.push(`Частые вопросы:`)
    for (const f of p.faqs) {
      lines.push(`  Q: ${f.question}`)
      lines.push(`  A: ${f.answer}`)
    }
  }
  if (p.aiInstruction) lines.push(`ИНСТРУКЦИЯ ДЛЯ AI: ${p.aiInstruction}`)
  return lines.join('\n')
}

function pricingLabel(t: string): string {
  const map: Record<string, string> = {
    fixed: 'Фиксированная',
    per_unit: 'За штуку',
    per_sq_meter: 'За м²',
    per_linear_meter: 'За погонный метр',
    per_set: 'За комплект',
    range: 'Диапазон',
    quote: 'По запросу',
    percent: 'Процент',
  }
  return map[t] || t
}

// ---------------------------------------------------------------------------
//  v8 audit: getInventoryStats — pulls REAL counts from DB for AI context.
//  This is the cure for "AI doesn't see application data" issue.
//  Queries: products (total + active), categories (distinct), stories, banners,
//  users, orders (total + today), revenue (today + total).
//  Categories are returned as a string array so the LLM can enumerate them.
// ---------------------------------------------------------------------------
export interface InventoryStats {
  totalProducts: number
  activeProducts: number
  totalCategories: number
  categories: string[]
  totalStories: number
  totalBanners: number
  totalUsers: number
  totalOrders: number
  todayOrders: number
  todayRevenue: number
  totalRevenue: number
}

async function getInventoryStats(userRole: 'guest' | 'user' | 'admin'): Promise<InventoryStats> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

  const [
    totalProducts,
    activeProducts,
    allProducts,
    totalStories,
    totalBanners,
    totalUsers,
    totalOrders,
    todayOrdersAgg,
    totalRevenueAgg,
  ] = await Promise.all([
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.product.count({ where: { deletedAt: null, inStock: true } }),
    prisma.product.findMany({ where: { deletedAt: null }, select: { category: true } }),
    prisma.story.count({ where: { expiresAt: { gt: now } } }).catch(() => 0),
    prisma.banner.count().catch(() => 0),
    prisma.user.count().catch(() => 0),
    prisma.order.count().catch(() => 0),
    prisma.order.aggregate({
      where: { createdAt: { gte: todayStart, lt: todayEnd } },
      _sum: { total: true },
      _count: true,
    }).catch(() => ({ _sum: { total: 0 }, _count: 0 })),
    prisma.order.aggregate({
      _sum: { total: true },
    }).catch(() => ({ _sum: { total: 0 } })),
  ])

  // Distinct categories (non-empty)
  const categorySet = new Set<string>()
  for (const p of allProducts) {
    if (p.category && p.category.trim()) categorySet.add(p.category.trim())
  }

  return {
    totalProducts,
    activeProducts,
    totalCategories: categorySet.size,
    categories: Array.from(categorySet).sort(),
    totalStories,
    totalBanners,
    totalUsers,
    totalOrders,
    todayOrders: (todayOrdersAgg as any)._count || 0,
    todayRevenue: (todayOrdersAgg as any)._sum?.total || 0,
    totalRevenue: (totalRevenueAgg as any)._sum?.total || 0,
  }
}

// ---------------------------------------------------------------------------
//  v8 audit: getPopularProducts — top-N products for AI context.
//  Returns popular products (isPopular=true) or by rating, falling back to
//  recently created products. This ensures the LLM ALWAYS has real products
//  to reference, eliminating iPhone-like hallucinations.
// ---------------------------------------------------------------------------
async function getPopularProducts(limit = 8): Promise<any[]> {
  // First try: popular products (isPopular=true)
  let products = await prisma.product.findMany({
    where: { deletedAt: null, isPopular: true, inStock: true },
    orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  })

  // Fallback 1: by rating (any product)
  if (products.length < limit) {
    const more = await prisma.product.findMany({
      where: { deletedAt: null, inStock: true, id: { notIn: products.map(p => p.id) } },
      orderBy: [{ rating: 'desc' }, { reviewsCount: 'desc' }],
      take: limit - products.length,
    })
    products = [...products, ...more]
  }

  // Fallback 2: by creation date (newest)
  if (products.length < limit) {
    const more = await prisma.product.findMany({
      where: { deletedAt: null, id: { notIn: products.map(p => p.id) } },
      orderBy: { createdAt: 'desc' },
      take: limit - products.length,
    })
    products = [...products, ...more]
  }

  return products.slice(0, limit)
}

// ---------------------------------------------------------------------------
//  Get relevant marketplace products
// ---------------------------------------------------------------------------
//  v18.7: STRICT MATCHING ALGORITHM.
//  Previously the function returned "similar products" / "popular products"
//  as fallbacks, which meant a query for "визитки" returned banners and
//  lightboxes because they're in the same "Полиграфия" category. Users
//  complained: "if I ask for banners, show banners, not random stuff".
//
//  NEW BEHAVIOR:
//  - Extract keywords from the message (with stemming).
//  - Score EVERY product by how well it matches:
//      + title contains keyword → +5 points (highest priority)
//      + description contains keyword → +2 points
//      + category contains keyword → +1 point (lowest — same category is
//        not enough by itself to qualify)
//  - Return ONLY products with score > 0, sorted by score DESC then rating DESC.
//  - If no products match → return [] (caller can decide to show "nothing found").
//  - NO "similar products" / "popular products" fallbacks.
//  - NO "siblings in same category" — only products that actually contain
//    the keyword in their title or description.
// ---------------------------------------------------------------------------
async function getRelevantMarketplaceProducts(message: string, kbSlug?: string | null): Promise<any[]> {
  // If KB product matched, try to find linked marketplace products.
  // NO siblings — only the exact linked product.
  if (kbSlug) {
    const kbProduct = await prisma.aIKB_Product.findUnique({
      where: { slug: kbSlug },
      include: { services: true, faqs: true },
    })
    if (kbProduct?.marketplaceProductId) {
      const linked = await prisma.product.findUnique({
        where: { id: kbProduct.marketplaceProductId, deletedAt: null },
      })
      if (linked) return [linked]
    }
  }

  // Otherwise, search by keywords in the message.
  const keywords = extractKeywords(message)
  if (!keywords.length) {
    // v18.7: no keywords = no products. Return empty so AI tells the user
    // to be more specific. Previously returned popular products which made
    // users think "I asked for X but got random stuff".
    return []
  }

  const safeKeywords = keywords.filter((kw) => kw.length >= 3)
  if (safeKeywords.length === 0) return []

  // v18.7: load ALL non-deleted products and score them in JS.
  // SQLite's LIKE is case-insensitive only for ASCII; Cyrillic needs JS-side
  // lowercasing. Loading all products is fine — typical catalog has <1000.
  const candidates = await prisma.product.findMany({
    where: { deletedAt: null },
    orderBy: [{ isPopular: 'desc' }, { rating: 'desc' }],
  })

  const lowerKeywords = safeKeywords.map((kw) => kw.toLowerCase())

  // Score each product by how well it matches.
  const scored = candidates
    .map((p) => {
      const titleLower = (p.title || '').toLowerCase()
      const descLower = (p.description || '').toLowerCase()
      const catLower = (p.category || '').toLowerCase()
      const titleWords = titleLower.split(/\s+/)
      const catWords = catLower.split(/\s+/)

      let score = 0
      let matchedKeywords = 0
      for (const kw of lowerKeywords) {
        let kwMatched = false
        // Title match (highest priority) — exact substring OR stem-prefix.
        if (titleLower.includes(kw)) {
          score += 5
          kwMatched = true
        } else if (titleWords.some((word) => word.length >= 4 && (word.startsWith(kw) || kw.startsWith(word)))) {
          // v18.7: stem-prefix match (e.g. "мебел" matches "мебель", "баннер"
          // matches "баннерная"). IMPORTANT: require word.length >= 4 to avoid
          // false positives like "визитк".startsWith("в") matching the word "в"
          // in "Рекламная кампания в Instagram". Short words (1-3 chars) are
          // too generic to be reliable stem prefixes.
          score += 4
          kwMatched = true
        }
        // Description match (medium priority).
        if (descLower.includes(kw)) {
          score += 2
          kwMatched = true
        }
        // Category match (LOWEST priority — only counts if title/desc also matched,
        // otherwise a query for "баннер" would match ALL "Наружная реклама" products).
        if (catLower.includes(kw) || catWords.some((word) => word.length >= 4 && (word.startsWith(kw) || kw.startsWith(word)))) {
          score += 1
          // Do NOT set kwMatched=true here — category-only match is NOT enough
          // to qualify a product. We want strict title/desc matching.
        }
        if (kwMatched) matchedKeywords++
      }
      return { product: p, score, matchedKeywords }
    })
    // v18.7: STRICT FILTER — only keep products where at least one keyword
    // matched in the TITLE or DESCRIPTION (not just category). This prevents
    // "баннер" from returning all "Наружная реклама" products.
    .filter((s) => s.score >= 4)  // 4 = title-stem match minimum

  // Sort by score DESC, then rating DESC.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.product.rating || 0) - (a.product.rating || 0)
  })

  // v18.7: cap at 4 results (was 6) — UI is more compact now, 4 is enough.
  return scored.slice(0, 4).map((s) => s.product)
}

function extractKeywords(message: string): string[] {
  // Simple keyword extraction — split by whitespace, filter stop words, min length.
  // v18.6: removed "сколько", "стоит", "нужно", "хочу" from stop-words — these
  // are intent signals, but they were being stripped, which meant a query like
  // "сколько стоит баннер?" only extracted "баннер" (good) but a query like
  // "что посоветуете из футболок?" extracted only "футболок" because "что" was
  // also filtered. Now we keep more keywords to maximize match coverage.
  const stopWords = new Set([
    'и', 'в', 'на', 'с', 'по', 'для', 'это', 'как', 'что', 'мой', 'мне',
    'открой', 'дай', 'посмотри', 'покажи', 'покаж', 'найди',
    'a', 'an', 'the', 'is', 'are', 'of', 'to', 'in', 'on',
    'я', 'мы', 'вы', 'он', 'она', 'они', 'есть', 'быть', 'был', 'будет',
  ])
  // v18.6: very basic Russian stemmer — strip common inflectional suffixes
  // so "мебели" → "мебел", "мебель" → "мебел" (matches), "футболок" → "футболок",
  // "футболки" → "футболк", "футболка" → "футболк". This is NOT a proper
  // stemmer but covers the most common Russian noun declensions.
  const stemRussian = (w: string): string => {
    // Only stem words longer than 5 chars to avoid mangling short words.
    if (w.length < 5) return w
    // Strip common Russian suffixes: ами, ями, ов, ев, ах, ях, ам, ям, ы, и, а, я, у, ю, ой, ей, ь
    return w.replace(/(ами|ями|ов|ев|ах|ях|ам|ям|ый|ий|ой|ей|ого|его|ому|ему|ыми|ими|ы|и|а|я|у|ю|ь)$/, '')
  }
  return message
    .toLowerCase()
    .split(/[\s,.;!?()]+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .map(stemRussian)
    .filter((w) => w.length >= 3)  // re-filter after stemming
    .slice(0, 10)
}

// ---------------------------------------------------------------------------
//  Company contacts — fetched from AppSetting (Studio-managed)
// ---------------------------------------------------------------------------
let contactsCache: { value: string | null; ts: number } | null = null

/** v25.7 (Issue #6): Read the 6 Studio contact keys (was 4). Added `address`
 *  and `workingHours` so the AI knows the company's physical location and
 *  business hours — previously the AI had ZERO geography context, which
 *  caused it to either hallucinate a city (Tashkent, Moscow, etc.) or give
 *  generic non-answers when asked about location/delivery/working hours.
 *
 *  NO hardcoded fallbacks — if a field is empty, it's simply omitted from
 *  the prompt, and the AI is instructed to say "не знаю" instead of making
 *  something up. */
export async function getContactsArray(): Promise<Array<{ label: string; type: string; value: string }>> {
  try {
    const keys = ['phone', 'whatsapp', 'telegram', 'email', 'address', 'workingHours']
    const settings = await prisma.appSetting.findMany({ where: { id: { in: keys } } })
    const map = new Map<string, string>()
    for (const s of settings) {
      try { map.set(s.id, typeof JSON.parse(s.value) === 'string' ? JSON.parse(s.value) : s.value) } catch { map.set(s.id, s.value) }
    }
    const result: Array<{ label: string; type: string; value: string }> = []
    const phone = map.get('phone')?.trim()
    const whatsapp = map.get('whatsapp')?.trim()
    const telegram = map.get('telegram')?.trim()
    const email = map.get('email')?.trim()
    const address = map.get('address')?.trim()
    const workingHours = map.get('workingHours')?.trim()
    if (phone) result.push({ label: 'Телефон', type: 'phone', value: phone })
    if (whatsapp) result.push({ label: 'WhatsApp', type: 'whatsapp', value: whatsapp })
    if (telegram) result.push({ label: 'Telegram', type: 'telegram', value: telegram })
    if (email) result.push({ label: 'Email', type: 'email', value: email })
    if (address) result.push({ label: 'Адрес', type: 'address', value: address })
    if (workingHours) result.push({ label: 'Время работы', type: 'workingHours', value: workingHours })
    return result
  } catch { return [] }
}

async function getCompanyContacts(): Promise<string | null> {
  if (contactsCache && Date.now() - contactsCache.ts < 60_000) return contactsCache.value
  const contacts = await getContactsArray()
  const value = contacts.length > 0 ? contacts.map((c) => `- ${c.label}: ${c.value}`).join('\n') : null
  contactsCache = { value, ts: Date.now() }
  return value
}

// ---------------------------------------------------------------------------
//  Extract [ACTION:type:param] markers from AI reply
// ---------------------------------------------------------------------------
export interface AIAction {
  type: string
  param?: string
  raw: string
}

export function extractActions(text: string): { cleaned: string; actions: AIAction[] } {
  const actions: AIAction[] = []
  const regex = /\[ACTION:([a-z_]+)(?::([^\]]+))?\]/gi
  const cleaned = text.replace(regex, (match, type, param) => {
    actions.push({ type: type.toLowerCase(), param: param || undefined, raw: match })
    return ''
  }).replace(/\s{2,}/g, ' ').trim()
  return { cleaned, actions }
}

// ---------------------------------------------------------------------------
//  Find similar products (for "покажи похожие")
// ---------------------------------------------------------------------------
export async function findSimilarProducts(productId: string, limit = 4): Promise<any[]> {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) return []
  const similar = await prisma.product.findMany({
    where: {
      deletedAt: null,
      id: { not: productId },
      OR: [
        { category: product.category },
        { title: { contains: product.title.split(' ')[0] } },
      ],
    },
    take: limit,
    orderBy: { rating: 'desc' },
  })
  return similar
}
