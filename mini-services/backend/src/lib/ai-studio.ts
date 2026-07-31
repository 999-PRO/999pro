/**
 * v8 STUDIO AI ASSISTANT — lib/ai-studio.ts
 *
 * Помощник для редакторов контента в Studio (товары, Stories).
 * Принимает message + context (тип карточки + данные) и возвращает:
 *   • reply — текстовый ответ AI
 *   • suggestions — массив предложений по полям с новыми значениями
 *
 * Формат ответа AI (парсится):
 *   Обычный текст-объяснение...
 *
 *   [suggest:FIELD]
 *   новое значение поля
 *   [/suggest]
 *
 *   FIELD — одно из: title | description | category | specs | seoTitle |
 *   seoDescription | seoKeywords (для product) или title | description (для story).
 */

import { callAI, type DeepSeekMessage } from './ai-provider.js'

export type StudioContextType = 'product' | 'story' | 'banner' | 'hero' | 'club' | 'registration' | 'user' | 'bonus' | 'audit' | 'communication' | 'security' | 'delivery' | 'promo' | 'info-page' | 'moderation'

export interface StudioSuggestion {
  field: string
  value: string
  label: string
}

export interface StudioAIResult {
  reply: string
  suggestions: StudioSuggestion[]
  provider: string
  model: string
  handled: boolean
}

// ---------------------------------------------------------------------------
//  Field metadata — какие поля можно предлагать для каждого типа контента
// ---------------------------------------------------------------------------
const FIELD_META: Record<string, { label: string; description: string }> = {
  title:               { label: 'Название',         description: 'заголовок товара, story, баннера или hero-блока' },
  description:         { label: 'Описание',         description: 'описание (текст, markdown)' },
  category:            { label: 'Категория',        description: 'категория товара' },
  specs:               { label: 'Характеристики',   description: 'список характеристик (через запятую)' },
  seoTitle:            { label: 'SEO-заголовок',    description: 'мета-заголовок для поисковиков (≤60 символов)' },
  seoDescription:      { label: 'SEO-описание',     description: 'мета-описание (≤160 символов)' },
  seoKeywords:         { label: 'SEO-ключевые слова', description: 'ключевые слова через запятую' },
  // v24.3: banner fields
  subtitle:            { label: 'Подзаголовок',     description: 'подзаголовок баннера (короткий текст под заголовком)' },
  cta:                 { label: 'Текст кнопки',      description: 'текст call-to-action кнопки баннера' },
  // v24.3: hero fields
  badge:               { label: 'Бейдж',            description: 'маленький бейдж/метка над заголовком hero-блока' },
  primaryButtonText:   { label: 'Текст главной кнопки',  description: 'текст на главной кнопке hero-блока' },
  secondaryButtonText: { label: 'Текст второй кнопки',   description: 'текст на второй кнопке hero-блока' },
}

const ALLOWED_FIELDS: Record<StudioContextType, string[]> = {
  product: ['title', 'description', 'category', 'specs', 'seoTitle', 'seoDescription', 'seoKeywords'],
  story:   ['title', 'description'],
  // v24.3: banner + hero support
  banner:  ['title', 'subtitle', 'cta', 'description'],
  hero:    ['badge', 'title', 'description', 'primaryButtonText', 'secondaryButtonText'],
  // v24.5: AI for ALL studio sections
  club:       ['title', 'description', 'terms'],
  registration: ['title', 'description'],
  user:       ['note'],
  bonus:      ['title', 'description'],
  audit:      [],
  communication: ['title', 'description'],
  security:   [],
  delivery:   ['title', 'description'],
  promo:      ['title', 'description', 'code'],
  'info-page': ['title', 'content'],
  moderation: [],
}

// ---------------------------------------------------------------------------
//  Build system prompt — даёт AI контекст редактируемой карточки
// ---------------------------------------------------------------------------
function buildSystemPrompt(type: StudioContextType, data: any): string {
  const fields = ALLOWED_FIELDS[type]
  const fieldsList = fields.map(f => `- ${f} (${FIELD_META[f]?.label || f})`).join('\n')

  let dataDescription = ''
  if (type === 'product') {
    dataDescription = `РЕДАКТИРУЕМЫЙ ТОВАР:
- Название: ${data?.title || '(пусто)'}
- Описание: ${data?.description || '(пусто)'}
- Категория: ${data?.category || '(не указана)'}
- Цена: ${data?.price || '(не указана)'} ${data?.currency || ''}
- Характеристики: ${typeof data?.specs === 'string' ? data.specs : JSON.stringify(data?.specs || [])}
- Изображения: ${Array.isArray(data?.images) ? data.images.length : 0} шт.
- SEO-заголовок: ${data?.seoTitle || '(пусто)'}
- SEO-описание: ${data?.seoDescription || '(пусто)'}
- SEO-ключевые слова: ${data?.seoKeywords || '(пусто)'}`
  } else if (type === 'story') {
    dataDescription = `РЕДАКТИРУЕМАЯ STORY:
- Название: ${data?.title || '(пусто)'}
- Описание: ${data?.description || '(пусто)'}
- Категория: ${data?.category || '(не указана)'}
- Изображения: ${Array.isArray(data?.images) ? data.images.length : 0} шт.`
  } else if (type === 'banner') {
    // v24.3: banner context
    dataDescription = `РЕДАКТИРУЕМЫЙ БАННЕР:
- Заголовок: ${data?.title || '(пусто)'}
- Подзаголовок: ${data?.subtitle || '(пусто)'}
- Текст кнопки (CTA): ${data?.cta || '(пусто)'}
- Описание/доп. текст: ${data?.description || '(пусто)'}
- Ссылка: ${data?.link || '(не указана)'}
- Режим: ${data?.mode || 'image-text'}
- Изображение: ${data?.image ? 'есть' : 'нет'}`
  } else if (type === 'hero') {
    // v24.3: hero block context
    dataDescription = `РЕДАКТИРУЕМЫЙ HERO БЛОК (главный блок на главной странице):
- Бейдж: ${data?.badge || '(пусто)'}
- Заголовок: ${data?.title || '(пусто)'}
- Описание: ${data?.description || '(пусто)'}
- Текст главной кнопки: ${data?.primaryButton?.text || data?.primaryButtonText || '(пусто)'}
- Текст второй кнопки: ${data?.secondaryButton?.text || data?.secondaryButtonText || '(пусто)'}
- Изображение: ${data?.image ? 'есть' : 'нет'}`
  } else if (type === 'club') {
    dataDescription = `РЕДАКТИРУЕМЫЙ КЛУБ (программа лояльности):
- Название: ${data?.title || '(пусто)'}
- Описание: ${data?.description || '(пусто)'}
- Условия: ${data?.terms || '(пусто)'}
- Данные: ${JSON.stringify(data).slice(0, 500)}`
  } else if (type === 'registration') {
    dataDescription = `РЕДАКТИРУЕМЫЕ НАСТРОЙКИ РЕГИСТРАЦИИ:
- Данные: ${JSON.stringify(data).slice(0, 500)}`
  } else if (type === 'user') {
    dataDescription = `РЕДАКТИРУЕМЫЙ ПОЛЬЗОВАТЕЛЬ:
- Имя: ${data?.displayName || data?.username || '(пусто)'}
- Email: ${data?.email || '(пусто)'}
- Роль: ${data?.role || 'user'}
- Данные: ${JSON.stringify(data).slice(0, 500)}`
  } else if (type === 'bonus') {
    dataDescription = `РЕДАКТИРУЕМЫЙ БОНУС / АКЦИЯ:
- Название: ${data?.title || '(пусто)'}
- Описание: ${data?.description || '(пусто)'}
- Данные: ${JSON.stringify(data).slice(0, 500)}`
  } else if (type === 'audit') {
    dataDescription = `ЖУРНАЛ АУДИТА (просмотр + аналитика):
- Данные: ${JSON.stringify(data).slice(0, 800)}`
  } else if (type === 'communication') {
    dataDescription = `РЕДАКТИРУЕМЫЕ НАСТРОЙКИ ОБЩЕНИЯ:
- Название: ${data?.title || '(пусто)'}
- Описание: ${data?.description || '(пусто)'}
- Данные: ${JSON.stringify(data).slice(0, 500)}`
  } else if (type === 'security') {
    dataDescription = `НАСТРОЙКИ БЕЗОПАСНОСТИ:
- Данные: ${JSON.stringify(data).slice(0, 800)}`
  } else if (type === 'delivery') {
    dataDescription = `РЕДАКТИРУЕМЫЕ НАСТРОЙКИ ДОСТАВКИ:
- Название: ${data?.title || '(пусто)'}
- Описание: ${data?.description || '(пусто)'}
- Данные: ${JSON.stringify(data).slice(0, 500)}`
  } else if (type === 'promo') {
    dataDescription = `РЕДАКТИРУЕМЫЙ ПРОМОКОД:
- Название: ${data?.title || '(пусто)'}
- Описание: ${data?.description || '(пусто)'}
- Код: ${data?.code || '(пусто)'}
- Данные: ${JSON.stringify(data).slice(0, 500)}`
  } else if (type === 'info-page') {
    dataDescription = `РЕДАКТИРУЕМАЯ ИНФО-СТРАНИЦА:
- Заголовок: ${data?.title || '(пусто)'}
- Контент: ${data?.content ? data.content.slice(0, 500) : '(пусто)'}`
  } else if (type === 'moderation') {
    dataDescription = `МОДЕРАЦИЯ КОНТЕНТА:
- Данные: ${JSON.stringify(data).slice(0, 800)}`
  }

  return `Ты — AI-ассистент для администратора студии «Три девятки». Помогаешь редактировать контент.

${dataDescription}

Твоя задача — помочь улучшить контент: написать продающее описание, подобрать SEO, предложить название, добавить характеристики и т.д.

ВАЖНО — формат ответа:

1. Сначала напиши обычный текст-объяснение (1-3 абзаца): что предлагаешь и почему.

2. Если предлагаешь конкретное значение для поля, выведи его в формате:

[suggest:ИМЯ_ПОЛЯ]
новое значение поля
[/suggest]

Где ИМЯ_ПОЛЯ — одно из разрешённых:
${fieldsList}

Пример ответа:

Предлагаю переписать название — текущее слишком общее. Новое название включает ключевые слова и точно описывает товар.

[suggest:title]
Печать баннеров 3х6 м с люверсами — печать на баннерной ткани
[/suggest]

Также добавлю SEO-описание с ключевой фразой:

[suggest:seoDescription]
Закажите печать баннеров 3х6 м с люверсами. Баннерная ткань 440 г/м², полноцветная печать UV-стойкими чернилами. Срок изготовления 1-2 дня.
[/suggest]

Правила:
- Пиши на русском языке.
- Будь конкретным — не общие фразы, а готовые значения.
- Один блок [suggest:FIELD] = одно поле. Можно несколько блоков в одном ответе.
- Не выдумывай поля — только из списка выше.
- Цены, размеры, характеристики — только если они есть в контексте или пользователь их назвал.
- Если предложение не требует изменения поля (просто совет) — не используй [suggest:...], только текст.

ПРАВИЛО ПРОТИВ ПОВТОРОВ (КРИТИЧЕСКИ ВАЖНО):
- Отвечай ТОЛЬКО на последний вопрос пользователя.
- НЕ повторяй и не пересказывай свои предыдущие ответы.
- НЕ начинай ответ с "Как я уже говорил", "Ранее я упоминал" и подобных фраз.
- Если новый вопрос не связан с предыдущим — просто отвечай на него с нуля.

КАТЕГОРИЧЕСКИЙ ЗАПРЕТ НА ВЫДУМЫВАНИЕ (КРИТИЧЕСКИ ВАЖНО):
- Ты можешь предлагать значения полей ТОЛЬКО на основе данных карточки в контексте выше.
- Запрещено упоминать бренды (Apple, Samsung, iPhone и т.д.) или иные товары, не относящиеся к редактируемой карточке.
- Если данных недостаточно для предложения — так и скажи: "Уточните, какое направление оптимизации вам нужно."`
}

// ---------------------------------------------------------------------------
//  Parse AI reply — извлекаем блоки [suggest:FIELD]...[/suggest]
// ---------------------------------------------------------------------------
function parseSuggestions(reply: string, allowedFields: string[]): {
  cleanReply: string
  suggestions: StudioSuggestion[]
} {
  const suggestions: StudioSuggestion[] = []
  // Регэксп с захватом field + value. Поддерживает многострочное значение.
  const re = /\[suggest:(\w+)\]\s*([\s\S]*?)\[\/suggest\]/g
  const cleanReply = reply.replace(re, (_match, field, value) => {
    const f = String(field).trim()
    if (!allowedFields.includes(f)) return '' // пропускаем неизвестные поля
    const v = String(value).trim()
    if (!v) return ''
    suggestions.push({
      field: f,
      value: v,
      label: FIELD_META[f]?.label || f,
    })
    return '' // вырезаем блок из чистого ответа
  })
  // Убираем двойные пустые строки после вырезания блоков
  const finalReply = cleanReply.replace(/\n{3,}/g, '\n\n').trim()
  return { cleanReply: finalReply, suggestions }
}

// ---------------------------------------------------------------------------
//  Main entry — call AI with studio context
// ---------------------------------------------------------------------------
export async function callStudioAI(
  message: string,
  type: StudioContextType,
  data: any,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<StudioAIResult> {
  const systemPrompt = buildSystemPrompt(type, data)
  const allowedFields = ALLOWED_FIELDS[type]

  const messages: DeepSeekMessage[] = [
    { role: 'system', content: systemPrompt },
    // v8 audit: reduced history window from -8 to -4 (anti-duplication)
    ...history.slice(-4).map(m => ({ role: m.role, content: m.content } as DeepSeekMessage)),
    { role: 'user', content: message },
  ]

  const result = await callAI(messages, {
    timeoutMs: 30_000,
    temperature: 0.7,
    maxTokens: 1500,
  })

  if (!result.handled) {
    return {
      reply: 'AI не настроен. Добавьте провайдер в Studio → AI API или задайте DEEPSEEK_API_KEY в .env',
      suggestions: [],
      provider: 'none',
      model: '',
      handled: false,
    }
  }

  const { cleanReply, suggestions } = parseSuggestions(result.reply, allowedFields)

  return {
    reply: cleanReply,
    suggestions,
    provider: result.provider,
    model: result.model,
    handled: true,
  }
}
