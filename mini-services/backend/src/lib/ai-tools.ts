/**
 * AI Tools — Tool Registry + Tool Calling infrastructure.
 *
 * v22 audit: previously the AI was a single-shot context-injected chatbot.
 * This module introduces REAL tool calling:
 *   - Each tool has a JSON schema (OpenAI/DeepSeek function-calling format)
 *   - Tools are sent to the LLM as the `tools` parameter
 *   - LLM emits `tool_calls` in its reply
 *   - Backend executes the tool (real DB query / action)
 *   - Tool result is fed back as a `tool` role message
 *   - LLM is re-queried with the tool result → final natural-language reply
 *
 * All tools that read orders/analytics/clients are admin-only.
 */

import { prisma } from './prisma.js'
import { logger } from './logger.js'

// ============================================================================
//  Types
// ============================================================================

/** A message in the multi-turn agent loop. Includes tool + tool_call roles. */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** Present on assistant messages that request tool calls. */
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  /** Present on tool-role messages — correlates to the tool_call.id above. */
  tool_call_id?: string
  /** Present on tool-role messages — the name of the tool that produced this result. */
  name?: string
}

/** JSON-schema parameter spec for a tool (OpenAI function-calling format). */
export interface ToolParameterSpec {
  type: 'object'
  properties: Record<string, {
    type: string
    description: string
    enum?: string[]
  }>
  required?: string[]
}

/** OpenAI/DeepSeek-compatible tool definition. */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolParameterSpec
  }
}

/** A tool implementation: takes args, returns a string (JSON or human-readable). */
export interface ToolImpl {
  /** OpenAI/DeepSeek function spec — sent to the LLM. */
  spec: ToolDefinition
  /** Executor. Returns string for the LLM to consume. Throws on error. */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
  /** If true, only admin-role users can invoke this tool. */
  adminOnly?: boolean
}

/** Per-request tool execution context. */
export interface ToolContext {
  userId?: string
  role: 'guest' | 'user' | 'manager' | 'admin'
}

// ============================================================================
//  Tool Registry
// ============================================================================

const registry = new Map<string, ToolImpl>()

export function registerTool(impl: ToolImpl) {
  registry.set(impl.spec.function.name, impl)
}

export function getTool(name: string): ToolImpl | undefined {
  return registry.get(name)
}

export function listTools(ctx: ToolContext): ToolDefinition[] {
  const out: ToolDefinition[] = []
  for (const impl of registry.values()) {
    if (impl.adminOnly && ctx.role !== 'admin' && ctx.role !== 'manager') continue
    out.push(impl.spec)
  }
  return out
}

// ============================================================================
//  Tool implementations
// ============================================================================

// ---- Analytics ----
registerTool({
  adminOnly: true,
  spec: {
    type: 'function',
    function: {
      name: 'get_analytics',
      description:
        'Получить сводную аналитику магазина: количество товаров, заказов (всего и за сегодня), выручка (за сегодня и всего), пользователи, сообщения, баннеры, разбивка заказов по статусам. Используйте для вопросов "какая выручка", "сколько заказов", "аналитика", "статистика".',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  async execute(_args, _ctx) {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const [
      products, activeProducts, orders, messages, users, banners,
      todayOrders, todayRevenueAgg, totalRevenueAgg, ordersByStatus,
    ] = await Promise.all([
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.product.count({ where: { deletedAt: null, inStock: true } }),
      prisma.order.count(),
      prisma.message.count(),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.banner.count(),
      prisma.order.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: todayStart, lt: todayEnd }, status: { not: 'cancelled' } },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: { status: { not: 'cancelled' } },
        _sum: { total: true },
      }),
      prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
    ])
    const statusBreakdown: Record<string, number> = {}
    for (const s of ordersByStatus) statusBreakdown[s.status] = s._count.status
    const result = {
      date: todayStart.toISOString().slice(0, 10),
      products,
      activeProducts,
      orders,
      todayOrders,
      todayRevenue: todayRevenueAgg._sum.total ? Number(todayRevenueAgg._sum.total) : 0,
      totalRevenue: totalRevenueAgg._sum.total ? Number(totalRevenueAgg._sum.total) : 0,
      messages,
      users,
      banners,
      statusBreakdown,
    }
    logger.info('AI tool executed: get_analytics', { module: 'ai-tools', tool: 'get_analytics', resultCount: Object.keys(result).length })
    return JSON.stringify(result)
  },
})

// ---- Recent orders ----
registerTool({
  adminOnly: true,
  spec: {
    type: 'function',
    function: {
      name: 'get_recent_orders',
      description:
        'Получить последние N заказов (по умолчанию 5, максимум 20). Каждый заказ содержит id, имя клиента, сумму, статус, дату, количество позиций, название первого товара. Используйте для "последние заказы", "недавние заказы", "что заказали".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Сколько заказов вернуть (1-20, по умолчанию 5)' },
        },
      },
    },
  },
  async execute(args, _ctx) {
    const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20)
    const orders = await prisma.order.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: { select: { title: true } } } } },
    })
    const result = orders.map((o) => ({
      id: o.id,
      name: o.name,
      total: Number(o.total),
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      itemsCount: o.items.length,
      firstItemTitle: o.items[0]?.product?.title || null,
    }))
    logger.info('AI tool executed: get_recent_orders', { module: 'ai-tools', tool: 'get_recent_orders', count: result.length })
    return JSON.stringify({ orders: result, count: result.length })
  },
})

// ---- Today orders ----
registerTool({
  adminOnly: true,
  spec: {
    type: 'function',
    function: {
      name: 'get_today_orders',
      description:
        'Получить все заказы за сегодня. Используйте для "заказы за сегодня", "что заказали сегодня", "сколько заказов сегодня".',
      parameters: { type: 'object', properties: {} },
    },
  },
  async execute(_args, _ctx) {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: todayStart, lt: todayEnd } },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: { select: { title: true } } } } },
    })
    const totalRevenue = orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((sum, o) => sum + Number(o.total), 0)
    const result = {
      date: todayStart.toISOString().slice(0, 10),
      count: orders.length,
      totalRevenue,
      orders: orders.map((o) => ({
        id: o.id,
        name: o.name,
        total: Number(o.total),
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        itemsCount: o.items.length,
        firstItemTitle: o.items[0]?.product?.title || null,
      })),
    }
    logger.info('AI tool executed: get_today_orders', { module: 'ai-tools', tool: 'get_today_orders', count: result.count })
    return JSON.stringify(result)
  },
})

// ---- Clients ----
registerTool({
  adminOnly: true,
  spec: {
    type: 'function',
    function: {
      name: 'get_clients',
      description:
        'Получить список последних клиентов (пользователей). Используйте для "клиенты", "пользователи", "сколько у нас клиентов", "кто зарегистрировался".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Сколько клиентов вернуть (1-50, по умолчанию 10)' },
          search: { type: 'string', description: 'Поиск по имени или email (опционально)' },
        },
      },
    },
  },
  async execute(args, _ctx) {
    const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 50)
    const search = typeof args.search === 'string' ? args.search.trim() : ''
    const where: any = { deletedAt: null }
    if (search) {
      where.OR = [
        { username: { contains: search } },
        { email: { contains: search } },
        { displayName: { contains: search } },
      ]
    }
    const users = await prisma.user.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        role: true,
        isOnline: true,
        lastSeen: true,
        createdAt: true,
      },
    })
    const result = {
      count: users.length,
      clients: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        email: u.email,
        role: u.role,
        isOnline: u.isOnline,
        lastSeen: u.lastSeen.toISOString(),
        createdAt: u.createdAt.toISOString(),
      })),
    }
    logger.info('AI tool executed: get_clients', { module: 'ai-tools', tool: 'get_clients', count: result.count })
    return JSON.stringify(result)
  },
})

// ---- Search products ----
registerTool({
  spec: {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Найти товары в каталоге по ключевому слову или категории. Возвращает список с id, названием, ценой, категорией, рейтингом, наличием. Используйте для "найди товар", "покажи товары", "что есть по запросу X".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос (название или категория)' },
          limit: { type: 'number', description: 'Сколько товаров вернуть (1-20, по умолчанию 5)' },
        },
        required: ['query'],
      },
    },
  },
  async execute(args, _ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) return JSON.stringify({ error: 'query is required', products: [], count: 0 })
    const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20)
    const products = await prisma.product.findMany({
      where: {
        deletedAt: null,
        OR: [
          { title: { contains: query } },
          { description: { contains: query } },
          { category: { contains: query } },
        ],
      },
      take: limit,
      orderBy: [{ isPopular: 'desc' }, { rating: 'desc' }],
      select: {
        id: true, title: true, price: true, oldPrice: true, currency: true,
        category: true, rating: true, reviewsCount: true, inStock: true,
        images: true, isAction: true, isNew: true, isPopular: true, quantity: true,
      },
    })
    const result = {
      query,
      count: products.length,
      products: products.map((p) => ({
        ...p,
        price: Number(p.price),
        oldPrice: p.oldPrice ? Number(p.oldPrice) : null,
        // v15: добавлено image (первое изображение) для карточки в чате
        image: (() => { try { return JSON.parse(p.images || '[]')[0] || null } catch { return null } })(),
      })),
    }
    logger.info('AI tool executed: search_products', { module: 'ai-tools', tool: 'search_products', query, count: result.count })
    return JSON.stringify(result)
  },
})

// ---- Action: open_cart (frontend navigation) ----
registerTool({
  spec: {
    type: 'function',
    function: {
      name: 'open_cart',
      description: 'Открыть корзину пользователя. Используйте когда клиент просит "открой корзину", "покажи корзину", "мои покупки".',
      parameters: { type: 'object', properties: {} },
    },
  },
  async execute(_args, _ctx) {
    return JSON.stringify({ action: 'open_cart', success: true })
  },
})

// ---- Action: open_checkout ----
registerTool({
  spec: {
    type: 'function',
    function: {
      name: 'open_checkout',
      description: 'Открыть оформление заказа. Используйте когда клиент просит "оформить заказ", "перейти к оплате", "оформить покупку".',
      parameters: { type: 'object', properties: {} },
    },
  },
  async execute(_args, _ctx) {
    return JSON.stringify({ action: 'open_checkout', success: true })
  },
})

// ---- Action: open_analytics ----
registerTool({
  adminOnly: true,
  spec: {
    type: 'function',
    function: {
      name: 'open_analytics',
      description: 'Открыть раздел аналитики. Используйте когда админ просит "открой аналитику", "покажи статистику", "открой dashboard".',
      parameters: { type: 'object', properties: {} },
    },
  },
  async execute(_args, _ctx) {
    return JSON.stringify({ action: 'open_analytics', success: true })
  },
})

// ---- Action: open_orders ----
registerTool({
  spec: {
    type: 'function',
    function: {
      name: 'open_orders',
      description: 'Открыть раздел "Мои заказы". Используйте когда клиент просит "покажи мои заказы", "где мои заказы", "мои покупки".',
      parameters: { type: 'object', properties: {} },
    },
  },
  async execute(_args, _ctx) {
    return JSON.stringify({ action: 'open_orders', success: true })
  },
})

// ---- Action: open_catalog ----
registerTool({
  spec: {
    type: 'function',
    function: {
      name: 'open_catalog',
      description: 'Открыть каталог товаров (опционально с категорией). Используйте когда клиент просит "открой каталог", "покажи товары", "категория X".',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Опциональная категория для фильтра' },
        },
      },
    },
  },
  async execute(args, _ctx) {
    const category = typeof args.category === 'string' ? args.category : null
    return JSON.stringify({ action: 'open_catalog', category, success: true })
  },
})

// ---- Action: open_product ----
registerTool({
  spec: {
    type: 'function',
    function: {
      name: 'open_product',
      description: 'Открыть карточку конкретного товара по его id. Используйте когда клиент просит "открой товар X", "покажи товар".',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'ID товара (slug)' },
        },
        required: ['product_id'],
      },
    },
  },
  async execute(args, _ctx) {
    const productId = String(args.product_id ?? '').trim()
    if (!productId) return JSON.stringify({ error: 'product_id is required' })
    return JSON.stringify({ action: 'open_product', product_id: productId, success: true })
  },
})

// ---- Action: search_audio — find music/tracks in Audio Hub ----
registerTool({
  spec: {
    type: 'function',
    function: {
      name: 'search_audio',
      description:
        'Найти музыку/трекы в Audio Hub по названию или исполнителю. Возвращает список найденных треков с id, названием, исполнителем, длительностью, previewUrl. Используйте для "найди музыку X", "ищу песню Y", "есть ли трек Z".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос (название песни или исполнитель)' },
          limit: { type: 'number', description: 'Сколько треков вернуть (1-10, по умолчанию 5)' },
        },
        required: ['query'],
      },
    },
  },
  async execute(args, _ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) return JSON.stringify({ error: 'query is required', tracks: [], count: 0 })
    const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 10)
    // Reuse the existing audio-hub search route logic via internal fetch.
    // The audio-hub search aggregates results from hitmos.fm + muzce.com.
    try {
      const baseUrl = process.env.AUDIO_HUB_BASE_URL || 'http://localhost:4000'
      const url = `${baseUrl}/api/audio-hub/search?q=${encodeURIComponent(query)}&type=all&limit=${limit}`
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!resp.ok) {
        return JSON.stringify({ error: `audio search failed: ${resp.status}`, tracks: [], count: 0 })
      }
      const data = await resp.json() as { items?: any[] }
      const tracks = (data.items || []).slice(0, limit).map((t: any) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        previewUrl: t.previewUrl,
        source: t.source,
      }))
      logger.info('AI tool executed: search_audio', { module: 'ai-tools', tool: 'search_audio', query, count: tracks.length })
      return JSON.stringify({ query, count: tracks.length, tracks })
    } catch (err) {
      logger.error('AI tool failed: search_audio', { module: 'ai-tools', tool: 'search_audio', err: String(err) })
      return JSON.stringify({ error: 'audio search failed', tracks: [], count: 0 })
    }
  },
})

// ---- Action: play_audio — open Audio Hub + autoplay a track ----
registerTool({
  spec: {
    type: 'function',
    function: {
      name: 'play_audio',
      description:
        'Открыть Audio Hub и автоматически воспроизвести найденный трек. Используйте когда клиент просит "включи музыку X", "запусти песню Y", "поставь трек Z", "играй музыку".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос (название песни или исполнитель)' },
        },
        required: ['query'],
      },
    },
  },
  async execute(args, _ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) return JSON.stringify({ error: 'query is required' })
    // Returns a frontend action hint — the client opens Audio Hub + autoplays.
    return JSON.stringify({
      action: 'play_audio_query',
      query,
      success: true,
      message: `Ищу «${query}» в Audio Hub и включаю воспроизведение...`,
    })
  },
})

// ---- Action: search_clients (admin only) ----
registerTool({
  adminOnly: true,
  spec: {
    type: 'function',
    function: {
      name: 'search_clients',
      description: 'Найти клиентов по имени или email. Используйте когда админ просит "найди клиента", "ищу пользователя", "клиент X".',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Поисковый запрос' } },
        required: ['query'],
      },
    },
  },
  async execute(args, _ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) return JSON.stringify({ error: 'query is required', clients: [], count: 0 })
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { username: { contains: query } },
          { email: { contains: query } },
          { displayName: { contains: query } },
        ],
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, username: true, displayName: true, email: true, role: true,
        isOnline: true, lastSeen: true, createdAt: true,
      },
    })
    const result = {
      query,
      count: users.length,
      clients: users.map((u) => ({
        id: u.id, username: u.username, displayName: u.displayName,
        email: u.email, role: u.role, isOnline: u.isOnline,
        lastSeen: u.lastSeen.toISOString(), createdAt: u.createdAt.toISOString(),
      })),
    }
    logger.info('AI tool executed: search_clients', { module: 'ai-tools', tool: 'search_clients', query, count: result.count })
    return JSON.stringify(result)
  },
})

// ============================================================================
//  Tool execution dispatcher
// ============================================================================

export interface ExecutedTool {
  name: string
  args: Record<string, unknown>
  result: string
  /** Frontend-readable action hint (for open_cart, open_checkout, etc.). */
  action?: { type: string; param?: string }
}

/**
 * Execute a single tool call. Returns the result string + optional frontend action.
 */
export async function executeToolCall(
  call: { id: string; function: { name: string; arguments: string } },
  ctx: ToolContext,
): Promise<{ result: string; action?: { type: string; param?: string } }> {
  const tool = getTool(call.function.name)
  if (!tool) {
    return { result: JSON.stringify({ error: `Unknown tool: ${call.function.name}` }) }
  }
  if (tool.adminOnly && ctx.role !== 'admin' && ctx.role !== 'manager') {
    return {
      result: JSON.stringify({
        error: 'Permission denied. This tool requires admin or manager role.',
      }),
    }
  }
  let args: Record<string, unknown> = {}
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
  } catch {
    args = {}
  }
  try {
    const result = await tool.execute(args, ctx)
    // Extract frontend action hint from action tools.
    let action: { type: string; param?: string } | undefined
    if (
      call.function.name === 'open_cart' ||
      call.function.name === 'open_checkout' ||
      call.function.name === 'open_analytics' ||
      call.function.name === 'open_orders' ||
      call.function.name === 'open_catalog' ||
      call.function.name === 'open_product' ||
      call.function.name === 'play_audio'
    ) {
      try {
        const parsed = JSON.parse(result)
        if (parsed.action && parsed.success) {
          action = {
            type: parsed.action,
            param: parsed.product_id || parsed.query || parsed.category || undefined,
          }
        }
      } catch {
        /* ignore */
      }
    }
    return { result, action }
  } catch (err) {
    logger.error('Tool execution failed', { module: 'ai-tools', tool: call.function.name, err: String(err) })
    return {
      result: JSON.stringify({
        error: 'Tool execution failed',
        message: err instanceof Error ? err.message : String(err),
      }),
    }
  }
}
