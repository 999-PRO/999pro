// 999 — Три девятки — AI Assistant chat endpoint v2
// ----------------------------------------------------------------------------
// Full digital manager: context-aware, action-capable, voice-ready.
// ----------------------------------------------------------------------------
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, optionalAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
// P1-3 + P1-8 fix: broadcast AI KB changes so the main app refetches
import { broadcastChanged } from '../lib/broadcast.js'
import {
  listKBProducts,
  getKBProductById,
  getKBProductBySlug,
  listKBCategories,
  listGlobalFAQs,
  listAllFAQs,
  getKBSettings,
  updateKBSettings,
  logConversation,
} from '../lib/ai-kb.js'
import { calculatePrice } from '../lib/ai-calc.js'
import { callDeepSeek, isDeepSeekConfigured, isAIConfiguredAsync } from '../lib/ai-deepseek.js'
import { tryLocalCommand } from '../lib/ai-local.js'
import { buildAIContext, extractActions, findSimilarProducts, getContactsArray } from '../lib/ai-context.js'
import { listTools, executeToolCall, type ToolContext, type AgentMessage } from '../lib/ai-tools.js'
import { logger } from '../lib/logger.js'

const router = Router()

// P0-2 fix: dedicated rate limiter for AI chat / order endpoints to prevent
// DeepSeek token-burn DoS. Without this, anonymous users could rotate IPs
// and burn ~$260/day of DeepSeek tokens at the global 120/min/IP API limit.
// Authenticated users get a higher limit because their identity is known.
const aiChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  // 10/min for anonymous, 30/min for authenticated (keyed on req.user?.id if present)
  keyGenerator: (req: any) => req.user?.id || req.ip || 'unknown',
  limit: (req: any) => (req.user ? 30 : 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов к AI. Попробуйте позже.' },
})

// ============================================================================
//  PUBLIC: /api/ai/status
// ============================================================================
router.get('/status', asyncHandler(async (_req, res) => {
  const settings = await getKBSettings()
  // v8 audit: ZAI/SDK fallback removed — `configured` is true ONLY when an
  // admin-configured DB provider OR DEEPSEEK_API_KEY env var exists.
  // If neither is set, AI endpoints will return a clear "not configured" error.
  const configured = isDeepSeekConfigured() || (await isAIConfiguredAsync())
  res.json({
    configured,
    assistantName: settings.assistantName,
    greeting: settings.greeting,
    voiceEnabled: true,  // client-side Web Speech API
  })
}))

// ============================================================================
//  CHAT ENDPOINT v2 — with actions, rich context, conversation memory
// ============================================================================
const ChatSchema = z.object({
  message: z.string().min(1).max(2000),
  context: z.string().max(100).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(20).optional(),
  // v25.9: optional conversationId — when supplied, the user's message + the
  // assistant's reply are persisted as AIMessage rows on AIConversation.
  // Enables persistent history across reloads, devices, and sessions.
  conversationId: z.string().max(100).optional(),
  // v25.9: optional images — array of CDN URLs (uploaded via /api/upload).
  // When supplied, the AI is told that the user attached images and the
  // image URLs are passed to vision-capable providers. For non-vision
  // providers, the AI is still told "user attached N image(s)" so it can
  // ask the user to describe them, but the URLs are not embedded in the
  // prompt (avoids leaking CDN URLs into the LLM context unnecessarily).
  images: z.array(z.string().url().max(2000)).max(4).optional(),
})

interface ChatResponse {
  reply: string
  // v22: expanded action type to support voice commands (navigate, open_cart, play_music, etc.)
  action: { type: string; view?: string; query?: string } | null
  actions: Array<{ type: string; param?: string; label: string }>
  calculation: any
  local: boolean
  usedDeepSeek: boolean
  voiceHint?: string
  // v25.9: echo the conversationId back to the client so it can store it.
  conversationId?: string | null
  cards?: Array<{
    kind: 'product' | 'contacts' | 'order_wizard' | 'similar_products' | 'media'
    data: any
  }>
  /** v22: tool calls executed by the agent loop. Each entry includes
   *  the tool name, args, and (for action tools) a frontend action hint. */
  toolActions?: Array<{ type: string; param?: string }>
  /** v22: number of LLM round-trips in the agent loop (1 = single-shot, >1 = multi-turn). */
  agentSteps?: number
}

router.post('/chat', aiChatLimiter, optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = ChatSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  }
  const { message, context, history, conversationId, images } = parsed.data

  // v25.9: persist the user's message to AIConversation (if supplied).
  // We do this BEFORE running the LLM so the message is saved even if the
  // LLM call fails. The assistant's reply is persisted AFTER the call.
  let convRow: any = null
  if (conversationId && req.user?.id) {
    try {
      convRow = await prisma.aIConversation.findUnique({
        where: { id: conversationId },
        select: { userId: true, title: true },
      })
      // Only persist if the conversation belongs to this user.
      if (convRow && convRow.userId === req.user.id) {
        await prisma.aIMessage.create({
          data: {
            conversationId,
            role: 'user',
            content: message,
            images: images && images.length ? JSON.stringify(images) : null,
          },
        })
        // Auto-title the conversation from the first user message.
        if (convRow.title === 'Новый диалог') {
          const title = message.slice(0, 60) + (message.length > 60 ? '…' : '')
          await prisma.aIConversation.update({
            where: { id: conversationId },
            data: { title },
          })
        }
      } else {
        convRow = null
      }
    } catch (e) {
      // Non-critical — chat should still work even if persistence fails.
      logger.warn('AI conversation persistence failed (user msg)', e as any)
    }
  }

  // 1) Local command router — saves a DeepSeek call for nav / greetings.
  const localCmd = tryLocalCommand(message)
  if (localCmd) {
    await logConversation({
      userId: req.user?.id,
      context,
      userMessage: message,
      assistantReply: localCmd.reply,
      parameters: localCmd.action ? { action: localCmd.action } : null,
      localHandled: true,
    })
    const resp: ChatResponse = {
      reply: localCmd.reply,
      action: localCmd.action ?? null,
      // v22: build UI actions from local command result
      actions: localCmd.action
        ? localCmd.action.type === 'navigate'
          ? [{ type: 'navigate', param: localCmd.action.view, label: `Открыть ${localCmd.action.view}` }]
          : localCmd.action.type === 'search_product' || localCmd.action.type === 'search_query'
            ? [{ type: localCmd.action.type, param: localCmd.action.query, label: 'Найти' }]
            : [{ type: localCmd.action.type, label: 'Выполнить' }]
        : [],
      calculation: null,
      local: true,
      usedDeepSeek: false,
    }
    // v25.9: persist assistant reply
    if (convRow) {
      try {
        await prisma.aIMessage.create({
          data: {
            conversationId: convRow.id || conversationId,
            role: 'assistant',
            content: resp.reply,
            actions: resp.actions?.length ? JSON.stringify(resp.actions) : null,
          },
        })
      } catch { /* non-critical */ }
    }
    return res.json(resp)
  }

  // 2) v8 audit: explicit AI-configured check — return clear error if no provider.
  //    Previously the chat endpoint silently fell back to ZAI/GLM-4.6 (now removed),
  //    which produced off-topic answers. Now we fail fast with an actionable message.
  //    v24.7 (final-release audit): the user-facing reply MUST NOT mention technical
  //    internals (.env, API KEY, DeepSeek, Provider, Studio path). The admin-only
  //    diagnostic is logged separately so the operator can act on it.
  const aiReady = isDeepSeekConfigured() || (await isAIConfiguredAsync())
  if (!aiReady) {
    logger.warn('AI chat requested but no provider is configured — admin must add one in Studio → AI API or set DEEPSEEK_API_KEY in backend .env')
    const resp: ChatResponse = {
      reply: 'Извините, ассистент временно недоступен. Наши менеджеры помогут вам — напишите в чат или закажите обратный звонок.',
      action: null,
      actions: [],
      calculation: null,
      local: true,
      usedDeepSeek: false,
    }
    return res.json(resp)
  }

  // 3) Match KB product (by name / root / slug).
  const allProducts = await listKBProducts({ includeInactive: false })
  const lower = message.toLowerCase()
  let matchedSlug: string | null = null
  let matchedScore = 0
  for (const p of allProducts) {
    const name = p.name.toLowerCase()
    if (lower.includes(name) && name.length > matchedScore) {
      matchedSlug = p.slug
      matchedScore = name.length
      continue
    }
    const firstWord = name.split(/\s+/)[0]
    if (firstWord.length >= 4) {
      for (let len = firstWord.length; len >= 4; len--) {
        const root = firstWord.slice(0, len)
        if (lower.includes(root) && len > matchedScore) {
          matchedSlug = p.slug
          matchedScore = len
          break
        }
      }
    }
  }

  // 4) Extract parameters (dimensions, quantity, services).
  const dimMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:x|х|\*|на|×)\s*(\d+(?:[.,]\d+)?)/)
  let width: number | undefined
  let height: number | undefined
  if (dimMatch) {
    width = parseFloat(dimMatch[1].replace(',', '.'))
    height = parseFloat(dimMatch[2].replace(',', '.'))
  }
  const serviceHints = ['дизайн', 'монтаж', 'доставка', 'установк', 'срочн', 'макет', 'печать', 'ламин', 'упаков']
  const services: string[] = []
  for (const hint of serviceHints) {
    if (lower.includes(hint)) services.push(hint)
  }
  const qtyMatch = lower.match(/(\d+)\s*(?:шт|штуки|штук|штуку|кружек|баннер|фотокам|вывеск)/)
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : undefined

  // 5) Run calculation engine if product matched.
  let calculation: any = null
  let kbProduct: any = null
  if (matchedSlug) {
    kbProduct = await getKBProductBySlug(matchedSlug)
    if (kbProduct) {
      calculation = await calculatePrice({
        productSlug: matchedSlug,
        width, height, quantity, services,
      })
    }
  }

  // 6) Build rich system prompt with full app context.
  const userRole: 'guest' | 'user' | 'admin' = (req.user?.role === 'admin' || req.user?.role === 'manager') ? 'admin' : req.user ? 'user' : 'guest'
  const ctx = await buildAIContext({
    message,
    context,
    matchedKbSlug: matchedSlug,
    kbProduct,
    calculation,
    userRole,
  })

  // 7) v8 audit: dead `messages` array REMOVED — only `agentMessages` below is sent to LLM.
  //    Previously this array was built but never used, which caused confusion about
  //    whether the system prompt was injected twice.
  //    The LLM is given a tool registry (DB-backed functions). If it emits
  //    tool_calls, we execute them, feed results back as `tool` role messages,
  //    and re-query the LLM. Capped at 4 iterations to prevent infinite loops.
  let reply = ''
  let localHandled = false
  let usedDeepSeek = false
  let agentSteps = 0
  const toolActions: Array<{ type: string; param?: string }> = []
  // v15: продукты собранные из search_products tool — для карточек в чат
  const toolProducts: any[] = []

  // Build the agent context: tool registry (admin-only tools filtered out for non-admins).
  const toolCtx: ToolContext = {
    userId: req.user?.id,
    role: userRole,
  }
  const tools = listTools(toolCtx)

  // Convert history + new message to AgentMessage format (with tool role support).
  // v8 audit: reduced history window from slice(-10) to slice(-4) — long histories
  // cause the LLM to recap previous answers, producing duplicated text in replies.
  const agentMessages: AgentMessage[] = [
    { role: 'system', content: ctx.systemPrompt },
    ...(history || []).slice(-4).map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user', content: message },
  ]

  // Agent loop — up to 4 round-trips.
  const MAX_STEPS = 4
  for (let step = 0; step < MAX_STEPS; step++) {
    agentSteps++
    const ds = await callDeepSeek({
      messages: agentMessages,
      temperature: 0.6,
      maxTokens: 1000,
      tools: tools.length > 0 ? tools : undefined,
    })

    if (!ds.ok) {
      // LLM failed — fall back to local template (only on first step).
      if (step === 0) {
        localHandled = true
        if (calculation && calculation.product) {
          if (calculation.missing.length) {
            const missingLabels = calculation.missing.map((m: string) => {
              if (m === 'width' || m === 'height') return 'укажите ширину и высоту в метрах'
              if (m === 'length') return 'укажите длину в метрах'
              if (m === 'quantity') return 'укажите количество'
              return m
            })
            reply = `Я нашёл товар «${calculation.product.name}» в базе знаний. Для точного расчёта ${missingLabels.join(', ')}, и я сразу посчитаю полную стоимость с учётом всех услуг. [ACTION:start_order_wizard:${calculation.product.slug}]`
          } else if (calculation.range) {
            reply = `Стоимость «${calculation.product.name}» составит от ${calculation.range[0]} до ${calculation.range[1]} ₽. В расчёт включено: ${calculation.breakdown.slice(0, -1).join('; ')}. Подскажите детали — и я подготовлю точный расчёт. [ACTION:start_order_wizard:${calculation.product.slug}]`
          } else if (calculation.total > 0) {
            reply = `Стоимость «${calculation.product.name}» составит ${calculation.total} ₽. В расчёт включено: ${calculation.breakdown.slice(0, -1).join('; ')}. Оформить заказ? [ACTION:start_order_wizard:${calculation.product.slug}]`
          } else if (calculation.note) {
            reply = `Стоимость «${calculation.product.name}» рассчитывается индивидуально. ${calculation.note} Подскажите детали — и я подготовлю расчёт. [ACTION:start_order_wizard:${calculation.product.slug}]`
          } else {
            reply = `Я нашёл товар «${calculation.product.name}» в базе знаний. Уточните детали заказа — и я помогу с расчётом. [ACTION:start_order_wizard:${calculation.product.slug}]`
          }
        } else {
          const settings = await getKBSettings()
          reply = `${settings.fallbackMessage} Подскажите, какой товар или услуга вас интересует — я подберу подходящий вариант из каталога. [ACTION:open_catalog]`
        }
        logger.info('DeepSeek fallback used', { reason: ds.error, hasCalc: !!calculation })
      } else {
        // Mid-loop LLM failure — use whatever reply we have so far.
        if (!reply) reply = 'Произошла ошибка при обработке запроса. Попробуйте ещё раз.'
      }
      break
    }

    usedDeepSeek = true

    // No tool_calls → final natural-language reply. End the loop.
    if (!ds.tool_calls || ds.tool_calls.length === 0) {
      reply = ds.content.trim()
      break
    }

    // Tool calls present → execute them, append results, re-query LLM.
    // First, append the assistant's tool_call message to the conversation.
    agentMessages.push({
      role: 'assistant',
      content: ds.content || '',
      tool_calls: ds.tool_calls,
    })

    for (const call of ds.tool_calls) {
      const { result, action } = await executeToolCall(call, toolCtx)
      // Collect frontend action hints (open_cart, open_checkout, etc.) —
      // these will be sent to the client alongside the final reply.
      if (action) {
        toolActions.push(action)
      }
      // v15: если tool был search_products — собираем products для карточек в чат
      if (call.function.name === 'search_products') {
        try {
          const parsed = JSON.parse(result)
          if (parsed.products && Array.isArray(parsed.products) && parsed.products.length > 0) {
            toolProducts.push(...parsed.products)
          }
        } catch {}
      }
      // Append the tool result as a `tool` role message.
      agentMessages.push({
        role: 'tool',
        content: result,
        tool_call_id: call.id,
        name: call.function.name,
      })
    }

    // Loop continues → next iteration will re-query the LLM with tool results.
    // On the last allowed step, force a final reply (no more tool_calls).
    if (step === MAX_STEPS - 1) {
      // Force a text-only reply by re-querying without tools.
      const finalDs = await callDeepSeek({
        messages: agentMessages,
        temperature: 0.6,
        maxTokens: 1000,
        // No tools — forces text reply.
      })
      reply = finalDs.ok ? finalDs.content.trim() : 'Я выполнил все необходимые действия. Чем ещё могу помочь?'
      break
    }
  }

  if (!reply) {
    reply = 'Я не смог обработать запрос. Попробуйте переформулировать.'
    localHandled = true
  }

  // v8 audit: anti-duplication guard.
  // If the new reply starts with the last assistant message in history (≥40 chars overlap),
  // strip that prefix — the LLM is recapping the previous answer before answering the new question.
  if (history && history.length > 0) {
    const lastAssistant = [...history].reverse().find(h => h.role === 'assistant')
    if (lastAssistant && lastAssistant.content && lastAssistant.content.length >= 40) {
      const prev = lastAssistant.content.trim()
      // Check if reply starts with the previous answer (first 80 chars)
      const prefixLen = Math.min(80, prev.length)
      const prevPrefix = prev.slice(0, prefixLen).toLowerCase()
      const replyPrefix = reply.slice(0, prefixLen).toLowerCase()
      if (prevPrefix === replyPrefix && reply.length > prev.length) {
        // Strip the recapped previous answer from the new reply
        const stripped = reply.slice(prev.length).trim()
        if (stripped.length > 0) {
          reply = stripped
        }
      }
      // Also strip common recap phrases at the start
      const recapPhrases = [
        /^(по вашему предыдущему вопросу|как я уже говорил|ранее я упоминал|как упоминалось ранее|как было сказано)[,:]?\s*/i,
        /^(по предыдущему вопросу|в предыдущем ответе)[,:]?\s*/i,
      ]
      for (const re of recapPhrases) {
        reply = reply.replace(re, '')
      }
    }
  }

  // 8) Extract [ACTION:...] markers from reply.
  const { cleaned, actions: extractedActions } = extractActions(reply)
  reply = cleaned

  // 9) Convert actions to UI-friendly format with labels.
  const uiActions = extractedActions.map((a) => ({
    type: a.type,
    param: a.param,
    label: actionLabel(a.type, a.param),
  }))

  // 10) Build rich cards based on intent.
  const cards: ChatResponse['cards'] = []

  // v25.9.2: IMAGE-BASED PRODUCT SEARCH. When the user uploads an image,
  // they're typically looking for "find me something like this". We can't
  // do real image similarity without a vision model, but we CAN:
  //   (a) show recently-added products as "inspired by your image"
  //   (b) if the user's text mentions a category, filter by that category
  // This gives a useful response even without vision capability. The AI
  // text explains what we did.
  if (images && images.length > 0) {
    try {
      // Try to extract a category hint from the message text.
      const categoryHints: Record<string, string[]> = {
        'баннер': ['баннер', 'банер', 'растяжк'],
        'вывеска': ['вывеск', 'табличк'],
        'футболка': ['футболк', 'майка', 'одежд'],
        'кружка': ['кружк', 'кухн'],
        'печать': ['печать', 'полиграф', 'визитк', 'буклет'],
        'дизайн': ['дизайн', 'логотип', 'логотип'],
        'наружная реклама': ['наружн', 'реклам'],
        'подарки': ['подарк', 'сувенир'],
      }
      let matchedCategory: string | null = null
      for (const [cat, hints] of Object.entries(categoryHints)) {
        if (hints.some((h) => lower.includes(h))) {
          matchedCategory = cat
          break
        }
      }
      // Fetch products — filter by category if we matched one.
      const productWhere: any = { deletedAt: null }
      if (matchedCategory) {
        productWhere.OR = [
          { category: { contains: matchedCategory, mode: 'insensitive' } },
          { title: { contains: matchedCategory, mode: 'insensitive' } },
        ]
      }
      const imageProducts = await prisma.product.findMany({
        where: productWhere,
        select: {
          id: true, title: true, price: true, currency: true, category: true,
          images: true, rating: true, inStock: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      })
      if (imageProducts.length > 0) {
        cards.push({
          kind: 'similar_products',
          data: imageProducts.map((p) => ({
            id: p.id,
            title: p.title,
            price: Number(p.price),
            currency: p.currency || 'RUB',
            image: (() => { try { return JSON.parse(p.images || '[]')[0] || null } catch { return null } })(),
            category: matchedCategory || 'Похожие товары',
            rating: p.rating,
            inStock: p.inStock,
          })),
        })
      }
    } catch (e) {
      // Non-critical — image search is a bonus, not a requirement.
      logger.warn('Image-based product search failed', e as any)
    }
  }

  // v18.6: ALWAYS show product cards when the user asks about a product —
  // not just when an explicit "покажи/найди" verb is used. The previous
  // logic only showed cards for /(покаж|найд|ищу|хочу|нужен|есть ли)/ which
  // missed queries like "сколько стоит баннер?", "какие у вас есть футболки?",
  // "есть в наличии вывеска?". Now we show cards if EITHER:
  //   (a) the user used a product-related verb (покажи, найди, ищу, хочу, нужен,
  //       есть ли, сколько стоит, какие, что есть, посоветуй, выбрать, подбери,
  //       заказать, купить, оформить), OR
  //   (b) we matched a marketplace product by keyword (matchedSlug set or
  //       ctx.matchedMarketplaceProducts non-empty) — meaning the message
  //       actually names or describes a product we sell.
  const productIntentRegex = /(покаж|найд|ищу|хочу|нужен|есть ли|сколько стоит|какие|что есть|посоветуй|выбрать|подбери|заказать|купить|оформить|сколько|стоит|цен|прайс|каталог|ассортимент)/i
  const hasProductMatch = ctx.matchedMarketplaceProducts.length > 0
  const isProductIntent = productIntentRegex.test(message) || hasProductMatch

  if (isProductIntent && hasProductMatch) {
    cards.push({
      kind: 'product',
      // v8: увеличен лимит с 4 до 8 — чтобы при запросе нескольких категорий
      // ("покажи подарки и баннеры") пользователь видел достаточно товаров
      // в каждой категории. Frontend сгруппирует их по полю `category`.
      data: ctx.matchedMarketplaceProducts.slice(0, 8).map((p) => ({
        id: p.id,
        title: p.title,
        price: Number(p.price),
        oldPrice: p.oldPrice ? Number(p.oldPrice) : null,
        currency: p.currency || 'RUB',
        image: (() => { try { return JSON.parse(p.images || '[]')[0] || null } catch { return null } })(),
        category: p.category,
        rating: p.rating,
        inStock: p.inStock,
        quantity: p.quantity,
        isAction: p.isAction,
        isNew: p.isNew,
        isPopular: p.isPopular,
      })),
    })
  }

  // v15: если AI вызвал search_products и получил результаты — добавляем cards
  // Это для интента "покажи товар / пришли товар / отправь мне товар"
  if (toolProducts.length > 0 && cards.length === 0) {
    cards.push({
      kind: 'product',
      data: toolProducts.slice(0, 8),
    })
  }
  // v18.7: NO automatic "similar products" suggestion.
  // User feedback: "if I ask for banners, show banners — not random similar stuff".
  // Similar products are now ONLY shown when the user explicitly asks
  // ("покажи похожие", "есть альтернативы?") — see the similar_products block below.
  // v18.7: similar_products card is shown ONLY when the user EXPLICITLY asks
  // for alternatives ("покажи похожие", "есть альтернативы", "другие варианты").
  // This respects the user's intent — don't suggest things they didn't ask for.
  if (/(похож|альтернатив|другие варианты|ещё варианты|еще варианты)/i.test(message) && ctx.matchedMarketplaceProducts[0]?.id) {
    try {
      const similar = await findSimilarProducts(ctx.matchedMarketplaceProducts[0].id, 8)
      const shownIds = new Set(ctx.matchedMarketplaceProducts.slice(0, 8).map((p: any) => p.id))
      const filteredSimilar = similar.filter((p) => !shownIds.has(p.id))
      if (filteredSimilar.length > 0) {
        cards.push({
          kind: 'similar_products',
          data: filteredSimilar.map((p) => ({
            id: p.id,
            title: p.title,
            price: Number(p.price),
            currency: p.currency || 'RUB',
            image: (() => { try { return JSON.parse(p.images || '[]')[0] || null } catch { return null } })(),
            // v8: добавлен category — для корректной группировки на frontend
            category: 'Похожие товары',
            rating: p.rating,
            inStock: p.inStock,
          })),
        })
      }
    } catch {
      // findSimilarProducts failed — non-critical, just skip.
    }
  }
  // If user asked for contacts — load from Studio (single source of truth).
  // v21: NO hardcoded fallbacks. If Studio contacts are empty, cards is empty.
  if (/(контакт|телефон|email|почт|адрес|связаться|whatsapp|вацап|вотсап|telegram|телеграм)/i.test(message)) {
    const contacts = await getContactsArray()
    if (contacts.length > 0) {
      cards.push({ kind: 'contacts', data: contacts })
    }
  }
  // If user wants to order — start the wizard.
  if (/(оформить|заказать|хочу заказать|оформи|купить)/i.test(message) && matchedSlug) {
    cards.push({
      kind: 'order_wizard',
      data: {
        productSlug: matchedSlug,
        productName: kbProduct?.name || '',
        step: 'confirm',
        calculation: calculation ? {
          total: calculation.total,
          range: calculation.range,
          breakdown: calculation.breakdown,
          matchedServices: calculation.matchedServices,
        } : null,
      },
    })
  }
  // NOTE: We intentionally do NOT auto-open Audio/Video/Media Hub.
  // The AI instructs the user where to find them (bottom panel → Media icon).
  // This respects the user's explicit-action requirement.

  // 11) Log the conversation.
  await logConversation({
    userId: req.user?.id,
    context,
    userMessage: message,
    assistantReply: reply,
    parameters: {
      matchedSlug,
      width, height, quantity, services,
      actions: uiActions,
      cards: cards?.length || 0,
      calculation: calculation ? {
        product: calculation.product?.name,
        total: calculation.total,
        range: calculation.range,
        missing: calculation.missing,
      } : null,
    },
    totalPrice: calculation?.total ?? null,
    localHandled,
  })

  // 12) v22: If the agent emitted frontend action hints via tool calls
  //     (open_cart, open_checkout, open_analytics, open_orders, etc.),
  //     surface them to the client as auto-executable actions.
  //     - If only ONE tool action and no [ACTION:] markers in reply → set as
  //       the primary `action` so the client auto-triggers it.
  //     - Otherwise append to `actions` array as clickable buttons.
  let primaryAction: ChatResponse['action'] = null
  const toolUiActions: ChatResponse['actions'] = []
  for (const ta of toolActions) {
    const label = actionLabel(ta.type, ta.param)
    toolUiActions.push({ type: ta.type, param: ta.param, label })
  }
  // Auto-execute the first tool action if there are no text-extracted actions.
  if (toolActions.length > 0 && uiActions.length === 0) {
    const first = toolActions[0]
    primaryAction = {
      type: first.type,
      view: first.type === 'navigate' ? first.param : first.type.replace('open_', ''),
      query: first.param,
    }
  }

  const allActions = [...uiActions, ...toolUiActions]

  // v25.9.2: when the user uploaded an image AND we found similar products,
  // prefix the reply with a note so the user knows the cards are "inspired
  // by" the uploaded image. This makes the image-upload feature discoverable.
  if (images && images.length > 0 && cards.some((c) => c.kind === 'similar_products')) {
    const imgNote = images.length === 1
      ? '📸 Я получил ваше изображение и подобрал товары из каталога, которые могут подойти. '
      : `📸 Я получил ${images.length} изображения и подобрал товары из каталога, которые могут подойти. `
    reply = imgNote + reply
  }

  // v25.9: persist the assistant's reply to AIConversation.
  if (convRow) {
    try {
      const calcJson = calculation && calculation.product ? JSON.stringify({
        product: calculation.product,
        total: calculation.total,
        range: calculation.range,
        breakdown: calculation.breakdown,
        missing: calculation.missing,
        matchedServices: calculation.matchedServices,
        note: calculation.note,
      }) : null
      const cardsJson = cards?.length ? JSON.stringify(cards) : null
      const actionsJson = allActions.length ? JSON.stringify(allActions) : null
      await prisma.aIMessage.create({
        data: {
          conversationId: convRow.id || conversationId,
          role: 'assistant',
          content: reply,
          calculation: calcJson,
          cards: cardsJson,
          actions: actionsJson,
        },
      })
      // Bump the conversation's updatedAt so it sorts to the top.
      await prisma.aIConversation.update({
        where: { id: convRow.id || conversationId },
        data: { updatedAt: new Date() },
      })
    } catch (e) {
      logger.warn('AI conversation persistence failed (assistant msg)', e as any)
    }
  }

  return res.json({
    reply,
    action: primaryAction,
    actions: allActions,
    calculation: calculation && calculation.product ? {
      product: calculation.product,
      total: calculation.total,
      range: calculation.range,
      breakdown: calculation.breakdown,
      missing: calculation.missing,
      matchedServices: calculation.matchedServices,
      note: calculation.note,
    } : null,
    local: localHandled,
    usedDeepSeek,
    voiceHint: 'auto',
    cards: cards?.length ? cards : undefined,
    toolActions: toolActions.length > 0 ? toolActions : undefined,
    agentSteps,
    // v25.9: echo back the conversationId so the client can store it.
    conversationId: convRow?.id || conversationId || null,
  } satisfies ChatResponse)
}))

function actionLabel(type: string, param?: string): string {
  const labels: Record<string, (p?: string) => string> = {
    open_catalog: (p) => p ? `Открыть: ${p}` : 'Открыть каталог',
    open_product: () => 'Открыть товар',
    open_cart: () => 'Открыть корзину',
    open_checkout: () => 'Оформить заказ',
    open_films: () => 'Открыть Video Hub',
    open_music: () => 'Открыть Audio Hub',
    open_media: () => 'Открыть Media Hub',
    open_chat: () => 'Открыть чат',
    open_support: () => 'Поддержка',
    open_orders: () => 'Мои заказы',
    show_contacts: () => 'Контакты',
    start_order_wizard: () => 'Оформить заказ',
    navigate: (p) => `Перейти: ${p || ''}`,
  }
  return (labels[type] || (() => 'Действие'))(param)
}

// ============================================================================
//  v25.9 — AI CONVERSATIONS (persistent history)
//  Endpoints for listing, creating, fetching, renaming, deleting past
//  conversations. Each conversation has many AIMessage rows. Messages are
//  created automatically by POST /api/ai/chat when a conversationId is
//  supplied — see the chat endpoint below.
// ============================================================================

// GET /api/ai/conversations — list current user's conversations (newest first)
router.get('/conversations', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const meId = req.user!.id
  const convs = await prisma.aIConversation.findMany({
    where: { userId: meId },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      context: true,
      role: true,
      pinned: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, createdAt: true } },
    },
  })
  res.json({
    conversations: convs.map((c) => ({
      id: c.id,
      title: c.title,
      context: c.context,
      role: c.role,
      pinned: c.pinned,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
      preview: c.messages[0]?.content?.slice(0, 120) || null,
    })),
  })
}))

// POST /api/ai/conversations — create a new conversation
router.post('/conversations', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const meId = req.user!.id
  const role = req.user!.role === 'admin' ? 'admin' : 'user'
  const title = (typeof req.body?.title === 'string' && req.body.title.trim())
    ? req.body.title.trim().slice(0, 200)
    : 'Новый диалог'
  const ctx = typeof req.body?.context === 'string' ? req.body.context.slice(0, 100) : null
  const conv = await prisma.aIConversation.create({
    data: { userId: meId, title, context: ctx, role },
  })
  res.json({ conversation: conv })
}))

// GET /api/ai/conversations/:id — get conversation + all messages
router.get('/conversations/:id', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const meId = req.user!.id
  const conv = await prisma.aIConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
  })
  if (!conv) return res.status(404).json({ error: 'Conversation not found' })
  if (conv.userId !== meId) return res.status(403).json({ error: 'Forbidden' })
  res.json({ conversation: conv })
}))

// PATCH /api/ai/conversations/:id — rename / pin / update context
router.patch('/conversations/:id', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const meId = req.user!.id
  const conv = await prisma.aIConversation.findUnique({ where: { id: req.params.id }, select: { userId: true } })
  if (!conv) return res.status(404).json({ error: 'Conversation not found' })
  if (conv.userId !== meId) return res.status(403).json({ error: 'Forbidden' })
  const data: any = {}
  if (typeof req.body?.title === 'string' && req.body.title.trim()) {
    data.title = req.body.title.trim().slice(0, 200)
  }
  if (typeof req.body?.pinned === 'boolean') data.pinned = req.body.pinned
  if (typeof req.body?.context === 'string') data.context = req.body.context.slice(0, 100)
  const updated = await prisma.aIConversation.update({ where: { id: req.params.id }, data })
  res.json({ conversation: updated })
}))

// DELETE /api/ai/conversations/:id — delete conversation + all messages
router.delete('/conversations/:id', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const meId = req.user!.id
  const conv = await prisma.aIConversation.findUnique({ where: { id: req.params.id }, select: { userId: true } })
  if (!conv) return res.status(404).json({ error: 'Conversation not found' })
  if (conv.userId !== meId) return res.status(403).json({ error: 'Forbidden' })
  await prisma.aIConversation.delete({ where: { id: req.params.id } })
  res.json({ ok: true })
}))

// ============================================================================
//  PRODUCTS — admin CRUD (unchanged from v1)
// ============================================================================
const ProductSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  shortSummary: z.string().max(500).optional().nullable(),
  materials: z.string().default('[]'),
  specs: z.string().default('{}'),
  leadTime: z.string().max(200).optional().nullable(),
  warranty: z.string().max(200).optional().nullable(),
  pricingType: z.enum(['fixed', 'per_unit', 'per_sq_meter', 'per_linear_meter', 'per_set', 'range', 'quote']).default('fixed'),
  basePrice: z.number().min(0).default(0),
  maxPrice: z.number().min(0).optional().nullable(),
  currency: z.string().default('RUB'),
  minOrderValue: z.number().min(0).optional().nullable(),
  formula: z.string().max(2000).optional().nullable(),
  formulaSpec: z.string().default('{}'),
  aiInstruction: z.string().max(5000).optional().nullable(),
  images: z.string().default('[]'),
  isActive: z.boolean().default(true),
  sortOrder: z.number().default(0),
  categoryId: z.string().optional().nullable(),
  marketplaceProductId: z.string().optional().nullable(),
})

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || `p-${Date.now().toString(36)}`
}

router.get('/products', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const items = await prisma.aIKB_Product.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      category: { select: { id: true, name: true } },
      _count: { select: { services: true, faqs: true } },
    },
  })
  res.json({ items })
}))

router.get('/products/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const item = await getKBProductById(req.params.id)
  if (!item) return res.status(404).json({ error: 'not_found' })
  res.json(item)
}))

router.post('/products', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = ProductSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  const data = parsed.data
  const slug = data.slug ? slugify(data.slug) : slugify(data.name)
  const product = await prisma.aIKB_Product.create({
    data: {
      name: data.name, slug,
      description: data.description ?? null,
      shortSummary: data.shortSummary ?? null,
      materials: data.materials, specs: data.specs,
      leadTime: data.leadTime ?? null, warranty: data.warranty ?? null,
      pricingType: data.pricingType,
      basePrice: data.basePrice, maxPrice: data.maxPrice ?? null,
      currency: data.currency, minOrderValue: data.minOrderValue ?? null,
      formula: data.formula ?? null, formulaSpec: data.formulaSpec,
      aiInstruction: data.aiInstruction ?? null,
      images: data.images, isActive: data.isActive, sortOrder: data.sortOrder,
      categoryId: data.categoryId ?? null,
      marketplaceProductId: data.marketplaceProductId ?? null,
    },
  })
  await auditLog(req as AuthedRequest, 'ai_kb_product', product.id, 'create', { after: { name: product.name } })
  res.status(201).json(product)
}))

router.put('/products/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = ProductSchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  const data: any = { ...parsed.data }
  if (data.slug) data.slug = slugify(data.slug)
  if (data.maxPrice === null) data.maxPrice = null
  if (data.minOrderValue === null) data.minOrderValue = null
  if (data.categoryId === null) data.categoryId = null
  if (data.marketplaceProductId === null) data.marketplaceProductId = null
  const product = await prisma.aIKB_Product.update({ where: { id: req.params.id }, data })
  await auditLog(req as AuthedRequest, 'ai_kb_product', product.id, 'update', { after: { name: product.name } })
  res.json(product)
}))

router.delete('/products/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const product = await prisma.aIKB_Product.delete({ where: { id: req.params.id } })
  await auditLog(req as AuthedRequest, 'ai_kb_product', product.id, 'delete', { after: { name: product.name } })
  res.json({ ok: true })
}))

// ============================================================================
//  PRODUCT SERVICES — admin CRUD
// ============================================================================
const ServiceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  pricingType: z.enum(['fixed', 'percent', 'per_unit', 'per_sq_meter', 'per_linear_meter']).default('fixed'),
  price: z.number().min(0).default(0),
  isDefault: z.boolean().default(false),
  condition: z.string().max(1000).optional().nullable(),
  sortOrder: z.number().default(0),
})

router.post('/products/:id/services', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = ServiceSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  const svc = await prisma.aIKB_Service.create({ data: { ...parsed.data, productId: req.params.id } })
  // P1-3 fix: audit log on AI KB Service mutations
  await auditLog(req, 'ai_kb_service', svc.id, 'create', { after: { name: svc.name, productId: svc.productId } })
  broadcastChanged('ai-kb:changed')
  res.status(201).json(svc)
}))

router.put('/products/:id/services/:svcId', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = ServiceSchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  const before = await prisma.aIKB_Service.findUnique({ where: { id: req.params.svcId } }).catch(() => null)
  const svc = await prisma.aIKB_Service.update({ where: { id: req.params.svcId }, data: parsed.data as any })
  await auditLog(req, 'ai_kb_service', svc.id, 'update', { before: before ? { name: before.name } : null, after: { name: svc.name } })
  broadcastChanged('ai-kb:changed')
  res.json(svc)
}))

router.delete('/products/:id/services/:svcId', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const before = await prisma.aIKB_Service.findUnique({ where: { id: req.params.svcId } }).catch(() => null)
  await prisma.aIKB_Service.delete({ where: { id: req.params.svcId } })
  await auditLog(req, 'ai_kb_service', req.params.svcId, 'delete', { before: before ? { name: before.name } : null })
  broadcastChanged('ai-kb:changed')
  res.json({ ok: true })
}))

// ============================================================================
//  CATEGORIES — admin CRUD
// ============================================================================
const CategorySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  sortOrder: z.number().default(0),
})

router.get('/categories', asyncHandler(async (_req, res) => {
  res.json({ items: await listKBCategories() })
}))

router.post('/categories', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = CategorySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  const data = parsed.data
  const slug = data.slug ? slugify(data.slug) : slugify(data.name)
  const cat = await prisma.aIKB_Category.create({ data: { name: data.name, slug, description: data.description ?? null, sortOrder: data.sortOrder } })
  await auditLog(req as AuthedRequest, 'ai_kb_category', cat.id, 'create', { after: { name: cat.name } })
  res.status(201).json(cat)
}))

router.put('/categories/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = CategorySchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  const data: any = { ...parsed.data }
  if (data.slug) data.slug = slugify(data.slug)
  if (data.description === null) data.description = null
  const before = await prisma.aIKB_Category.findUnique({ where: { id: req.params.id } }).catch(() => null)
  const cat = await prisma.aIKB_Category.update({ where: { id: req.params.id }, data })
  await auditLog(req, 'ai_kb_category', cat.id, 'update', { before: before ? { name: before.name } : null, after: { name: cat.name } })
  broadcastChanged('ai-kb:changed')
  res.json(cat)
}))

router.delete('/categories/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const before = await prisma.aIKB_Category.findUnique({ where: { id: req.params.id } }).catch(() => null)
  await prisma.aIKB_Category.delete({ where: { id: req.params.id } })
  await auditLog(req, 'ai_kb_category', req.params.id, 'delete', { before: before ? { name: before.name } : null })
  broadcastChanged('ai-kb:changed')
  res.json({ ok: true })
}))

// ============================================================================
//  FAQ — admin CRUD
// ============================================================================
const FAQSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(5000),
  productId: z.string().optional().nullable(),
  sortOrder: z.number().default(0),
  isActive: z.boolean().default(true),
})

router.get('/faqs', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  res.json({ items: await listAllFAQs() })
}))

router.post('/faqs', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = FAQSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  const faq = await prisma.aIKB_FAQ.create({ data: { ...parsed.data, productId: parsed.data.productId ?? null } as any })
  // P1-3 fix: audit log on AI KB FAQ mutations
  await auditLog(req, 'ai_kb_faq', faq.id, 'create', { after: { question: faq.question } })
  broadcastChanged('ai-kb:changed')
  res.status(201).json(faq)
}))

router.put('/faqs/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = FAQSchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  const data: any = { ...parsed.data }
  if (data.productId === null) data.productId = null
  const before = await prisma.aIKB_FAQ.findUnique({ where: { id: req.params.id } }).catch(() => null)
  const faq = await prisma.aIKB_FAQ.update({ where: { id: req.params.id }, data })
  await auditLog(req, 'ai_kb_faq', faq.id, 'update', { before: before ? { question: before.question } : null, after: { question: faq.question } })
  broadcastChanged('ai-kb:changed')
  res.json(faq)
}))

router.delete('/faqs/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const before = await prisma.aIKB_FAQ.findUnique({ where: { id: req.params.id } }).catch(() => null)
  await prisma.aIKB_FAQ.delete({ where: { id: req.params.id } })
  await auditLog(req, 'ai_kb_faq', req.params.id, 'delete', { before: before ? { question: before.question } : null })
  broadcastChanged('ai-kb:changed')
  res.json({ ok: true })
}))

// ============================================================================
//  SETTINGS
// ============================================================================
router.get('/settings', asyncHandler(async (_req, res) => {
  res.json(await getKBSettings())
}))

router.put('/settings', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const data = req.body || {}
  const allowed: any = {}
  for (const k of ['systemPrompt', 'fallbackMessage', 'greeting', 'assistantName']) {
    if (typeof data[k] === 'string') allowed[k] = data[k].slice(0, 10000)
  }
  const updated = await updateKBSettings(allowed)
  await auditLog(req as AuthedRequest, 'ai_kb_settings', 'default', 'update', { after: allowed as unknown })
  res.json(updated)
}))

// ============================================================================
//  ORDER WIZARD — submit final order from the chat
// ============================================================================
const OrderWizardSchema = z.object({
  productSlug: z.string(),
  productName: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  length: z.number().optional(),
  quantity: z.number().optional(),
  services: z.array(z.string()).default([]),
  deliveryAddress: z.string().optional(),
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(1).max(50),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerComment: z.string().max(2000).optional(),
  totalQuote: z.number().optional(),
})

router.post('/order', aiChatLimiter, optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = OrderWizardSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
  }
  const data = parsed.data

  // Re-calculate to confirm price (don't trust client).
  const calc = await calculatePrice({
    productSlug: data.productSlug,
    width: data.width,
    height: data.height,
    length: data.length,
    quantity: data.quantity,
    services: data.services,
  })

  const finalTotal = calc.total || data.totalQuote || 0

  // Try to find the marketplace product to link the order item.
  let marketplaceProduct: any = null
  const kbProduct = await getKBProductBySlug(data.productSlug)
  if (kbProduct?.marketplaceProductId) {
    marketplaceProduct = await prisma.product.findUnique({
      where: { id: kbProduct.marketplaceProductId, deletedAt: null },
    })
  }
  if (!marketplaceProduct) {
    // Try by name match.
    marketplaceProduct = await prisma.product.findFirst({
      where: { title: { contains: data.productName }, deletedAt: null },
    })
  }

  // If user is authenticated → create a REAL Order with OrderItem.
  if (req.user?.id && marketplaceProduct) {
    try {
      const requestedQty = data.quantity || 1

      // v24.6-audit (C-AI-1 fix): Atomic stock check + decrement inside a transaction.
      // Previously this endpoint created the order WITHOUT checking stock — users could
      // order out-of-stock products via AI that regular checkout would refuse.
      // Now we mirror the same logic as POST /api/orders:
      //   - If product has `quantity` field and it's < requested → reject
      //   - If product has `quantity` field and `inStock` flag → atomically decrement,
      //     flipping `inStock=false` when stock hits 0.
      //   - Services (KB products without `quantity`) bypass stock check.
      const order = await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: marketplaceProduct.id },
          select: { id: true, quantity: true, inStock: true, title: true, deletedAt: true },
        })
        if (!product || product.deletedAt) {
          throw new Error('product_not_found')
        }

        // Stock check: only enforced when `quantity` field is a non-null finite number.
        // Products with `quantity: null` are made-to-order / digital / services — no stock.
        if (product.quantity !== null && product.quantity !== undefined) {
          if (product.quantity < requestedQty) {
            throw new Error('insufficient_stock')
          }
          // Atomic decrement; flip inStock when stock reaches 0.
          const updated = await tx.product.updateMany({
            where: { id: product.id, quantity: { gte: requestedQty } },
            data: {
              quantity: { decrement: requestedQty },
              inStock: product.quantity - requestedQty > 0,
            },
          })
          // If affected rows = 0, concurrent order depleted stock between our read and write.
          if (updated.count === 0) {
            throw new Error('insufficient_stock')
          }
        }

        return tx.order.create({
          data: {
            userId: req.user!.id,
            total: finalTotal,
            status: 'new',
            name: data.customerName,
            phone: data.customerPhone,
            address: data.deliveryAddress || null,
            deliveryMethod: data.deliveryAddress ? 'delivery' : 'pickup',
            contactMethod: data.customerEmail ? 'email' : 'phone',
            comment: `AI Заказ: ${data.productName}${data.width ? `, ш=${data.width}м` : ''}${data.height ? `, в=${data.height}м` : ''}${data.quantity ? `, кол-во=${data.quantity}` : ''}${data.services.length ? `, услуги: ${data.services.join(', ')}` : ''}. ${data.customerComment || ''}`.slice(0, 2000),
            category: marketplaceProduct.category || null,
            items: {
              create: [{
                productId: marketplaceProduct.id,
                quantity: requestedQty,
                price: finalTotal,
              }],
            },
          },
          include: { items: true },
        })
      })

      // Increment product purchases counter (outside tx — non-critical).
      await prisma.product.update({
        where: { id: marketplaceProduct.id },
        data: { purchases: { increment: 1 } },
      }).catch(() => {})

      // Add initial status history entry.
      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: 'new',
          toStatus: 'new',
          changedById: req.user.id,
          note: 'Заказ создан через AI-ассистента',
        },
      }).catch(() => {})

      await auditLog(req as AuthedRequest, 'order', order.id, 'ai.order.created', { after: { product: data.productName, total: finalTotal, orderId: order.id } })

      return res.status(201).json({
        ok: true,
        orderId: order.id,
        orderNumber: order.id.slice(-8).toUpperCase(),
        total: finalTotal,
        breakdown: calc.breakdown,
        status: order.status,
        message: `Заказ №${order.id.slice(-8).toUpperCase()} успешно создан и сохранён в базе. Сумма: ${finalTotal.toLocaleString('ru-RU')} ₽. Менеджер свяжется с вами в течение 30 минут для подтверждения.`,
      })
    } catch (e: any) {
      const errMsg = String(e?.message || e)
      // v24.6-audit: surface stock errors to the client with a 409 (not 500)
      if (errMsg === 'insufficient_stock') {
        return res.status(409).json({
          ok: false,
          error: 'insufficient_stock',
          message: 'Недостаточно товара на складе. Уменьшите количество или выберите другой товар.',
        })
      }
      if (errMsg === 'product_not_found') {
        return res.status(404).json({
          ok: false,
          error: 'product_not_found',
          message: 'Товар больше недоступен. Попробуйте обновить каталог.',
        })
      }
      logger.error('AI order creation failed', { error: errMsg })
      return res.status(500).json({
        ok: false,
        error: 'order_creation_failed',
        message: 'Не удалось создать заказ. Попробуйте ещё раз или свяжитесь с поддержкой.',
      })
    }
  }

  // Fallback for guests (no account) — create a Lead.
  try {
    const lead = await prisma.lead.create({
      data: {
        name: data.customerName,
        phone: data.customerPhone,
        comment: `AI Заявка: ${data.productName}${data.width ? `, ш=${data.width}м` : ''}${data.height ? `, в=${data.height}м` : ''}${data.quantity ? `, кол-во=${data.quantity}` : ''}${data.services.length ? `, услуги: ${data.services.join(', ')}` : ''}. Расчётная стоимость: ${finalTotal} ₽. Email: ${data.customerEmail || '—'}. Адрес: ${data.deliveryAddress || '—'}. Комментарий: ${data.customerComment || '—'}`.slice(0, 2000),
        productTitle: data.productName,
        productPrice: finalTotal,
        quantity: data.quantity || 1,
        deliveryMethod: data.deliveryAddress ? 'delivery' : 'pickup',
        address: data.deliveryAddress || null,
        contactMethod: data.customerEmail ? 'email' : 'phone',
        status: 'new',
        userId: req.user?.id || null,
      },
    })

    await auditLog(req as AuthedRequest, 'lead', lead.id, 'ai.lead.created', { after: { product: data.productName, total: finalTotal } })

    return res.status(201).json({
      ok: true,
      leadId: lead.id,
      orderNumber: lead.id.slice(-8).toUpperCase(),
      total: finalTotal,
      breakdown: calc.breakdown,
      message: `Заявка №${lead.id.slice(-8).toUpperCase()} успешно создана и сохранена в базе. Менеджер перезвонит вам в течение 30 минут для подтверждения заказа на сумму ${finalTotal.toLocaleString('ru-RU')} ₽.`,
    })
  } catch (e: any) {
    logger.error('AI lead creation failed', { error: String(e?.message || e) })
    return res.status(500).json({
      ok: false,
      error: 'lead_creation_failed',
      message: 'Не удалось создать заявку. Попробуйте ещё раз.',
    })
  }
}))

export default router
