// ============================================================================
//  v8 STUDIO AI ASSISTANT — routes/ai-studio.ts
//  Endpoint'ы для встроенного AI-ассистента в редакторах Studio
//  (товары, Stories). Принимает контекст редактируемой карточки и
//  возвращает reply + suggestions по полям с кнопкой "Применить".
// ============================================================================
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { callStudioAI, type StudioContextType } from '../lib/ai-studio.js'
import { logger } from '../lib/logger.js'

const router = Router()

// Rate limiter — более мягкий, чем у клиентского AI (это админы)
const studioChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  keyGenerator: (req: any) => req.user?.id || req.ip || 'unknown',
  limit: 60, // 60/min — админам можно больше
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов к Studio AI. Попробуйте позже.' },
})

// ----------------------------------------------------------------------------
//  POST /api/ai/studio/chat
//  Body: { message, type, data, history? }
//  Auth: requireAuth + requireAdmin
// ----------------------------------------------------------------------------
const StudioChatSchema = z.object({
  message: z.string().min(1).max(4000),
  // v24.5: AI for ALL studio sections
  type: z.enum(['product', 'story', 'banner', 'hero', 'club', 'registration', 'user', 'bonus', 'audit', 'communication', 'security', 'delivery', 'promo', 'info-page', 'moderation']),
  data: z.record(z.any()), // данные редактируемой карточки
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(8000),
  })).max(20).optional(),
})

router.post('/chat',
  requireAuth,
  requireAdmin,
  studioChatLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = StudioChatSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.issues,
      })
      return
    }

    const { message, type, data, history } = parsed.data
    const userId = req.user!.id

    // v24.6-audit fix: logger.info signature is (msg: string, ctx?: LogContext)
    // — was passing an object as first arg, which type-checks as an error.
    logger.info('Studio AI chat request', {
      module: 'ai-studio',
      userId,
      type,
      messageLen: message.length,
      historyLen: history?.length || 0,
    })

    try {
      const result = await callStudioAI(
        message,
        type as StudioContextType,
        data,
        history || [],
      )

      res.json({
        reply: result.reply,
        suggestions: result.suggestions,
        provider: result.provider,
        model: result.model,
        handled: result.handled,
      })
    } catch (err: any) {
      logger.error('Studio AI chat failed', {
        module: 'ai-studio',
        error: err?.message || String(err),
        userId,
      })
      res.status(500).json({
        error: 'AI request failed',
        message: err?.message || 'Не удалось связаться с AI',
      })
    }
  }),
)

// ----------------------------------------------------------------------------
//  GET /api/ai/studio/status
//  Возвращает доступность Studio AI и список поддерживаемых полей
// ----------------------------------------------------------------------------
router.get('/status',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    res.json({
      available: true,
      fields: {
        product: ['title', 'description', 'category', 'specs', 'seoTitle', 'seoDescription', 'seoKeywords'],
        story: ['title', 'description'],
      },
    })
  }),
)

export default router
