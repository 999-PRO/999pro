/**
 * v19.0 — AI Providers CRUD route.
 *
 * Endpoints:
 *   GET    /api/ai/providers            — list all providers (admin only)
 *   GET    /api/ai/providers/active     — public, returns sanitized active provider info
 *   POST   /api/ai/providers            — create provider (admin)
 *   PATCH  /api/ai/providers/:id        — update provider (admin)
 *   DELETE /api/ai/providers/:id        — delete provider (admin)
 *   POST   /api/ai/providers/:id/test   — test provider (admin)
 *
 * API keys are stored encrypted (lib/crypto.ts) and never returned to clients.
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, requireAdminOnly, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { encryptSecret, decryptSecret, maskSecret } from '../lib/crypto.js'
import { callAI, type DeepSeekMessage } from '../lib/ai-provider.js'
import { logger } from '../lib/logger.js'

const router = Router()

const PROVIDER_TYPES = [
  'deepseek', 'openai', 'gemini', 'claude', 'grok', 'openrouter', 'ollama', 'custom',
] as const

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(PROVIDER_TYPES),
  apiKey: z.string().max(512).optional(), // plain text from form, will be encrypted
  baseUrl: z.string().max(512).optional().default(''),
  model: z.string().max(100).optional().default(''),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  params: z.record(z.any()).optional().default({}),
})

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(PROVIDER_TYPES).optional(),
  apiKey: z.string().max(512).optional(), // when provided, replaces existing key
  baseUrl: z.string().max(512).optional(),
  model: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  params: z.record(z.any()).optional(),
})

/** Sanitize a provider for API output — never expose apiKeyEnc. */
function sanitize(p: {
  id: string; name: string; type: string; apiKeyEnc: string;
  baseUrl: string; model: string; enabled: boolean; isDefault: boolean;
  params: string; createdAt: Date; updatedAt: Date;
}, includeMaskedKey = true) {
  let apiKeyPlain = ''
  try {
    apiKeyPlain = p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : ''
  } catch {
    apiKeyPlain = ''
  }
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    hasApiKey: !!apiKeyPlain,
    apiKeyMasked: includeMaskedKey ? maskSecret(apiKeyPlain) : '',
    baseUrl: p.baseUrl,
    model: p.model,
    enabled: p.enabled,
    isDefault: p.isDefault,
    params: (() => { try { return JSON.parse(p.params || '{}') } catch { return {} } })(),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

// GET /api/ai/providers/active — public. Returns whether AI is configured +
// sanitized provider name (no key). Used by frontend to show AI status.
// v24.2 BUGFIX: falls back to any enabled provider (not just isDefault ones)
// — matches getActiveProvider() behavior in lib/ai-provider.ts.
router.get(
  '/active',
  asyncHandler(async (_req, res) => {
    let provider = await prisma.aIProvider.findFirst({
      where: { enabled: true, isDefault: true },
    })
    // v24.2 BUGFIX: fall back to any enabled provider so the status endpoint
    // agrees with getActiveProvider() — fixes "AI не настроен" false negatives.
    if (!provider) {
      provider = await prisma.aIProvider.findFirst({
        where: { enabled: true },
        orderBy: { updatedAt: 'desc' },
      })
    }
    if (!provider) {
      // Check env fallback
      const envKey = process.env.DEEPSEEK_API_KEY || ''
      return res.json({
        configured: !!envKey,
        providerName: envKey ? 'DeepSeek (env)' : null,
        providerType: envKey ? 'deepseek' : null,
        model: envKey ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat') : null,
      })
    }
    res.json({
      configured: true,
      providerName: provider.name,
      providerType: provider.type,
      model: provider.model,
    })
  }),
)

// GET /api/ai/providers — list all providers (admin only)
router.get(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const providers = await prisma.aIProvider.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })
    res.json({ providers: providers.map((p) => sanitize(p)) })
  }),
)

// POST /api/ai/providers — create new provider
// v24.6-audit (S-HIGH-4 fix): admin-only — managers must NOT be able to add
// AI providers (they could point at their own endpoint and intercept all AI calls).
router.post(
  '/',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createSchema.parse(req.body)
    // If isDefault=true, unset other defaults
    if (parsed.isDefault) {
      await prisma.aIProvider.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      })
    }
    const apiKeyEnc = parsed.apiKey ? encryptSecret(parsed.apiKey) : ''
    const provider = await prisma.aIProvider.create({
      data: {
        name: parsed.name,
        type: parsed.type,
        apiKeyEnc,
        baseUrl: parsed.baseUrl,
        model: parsed.model,
        enabled: parsed.enabled,
        isDefault: parsed.isDefault,
        params: JSON.stringify(parsed.params || {}),
      },
    })
    await auditLog(req, 'ai-provider', provider.id, 'create', {
      name: provider.name, type: provider.type, model: provider.model,
    })
    logger.info('AI provider created', { module: 'ai-providers', id: provider.id, name: provider.name, type: provider.type })
    res.json({ provider: sanitize(provider) })
  }),
)

// PATCH /api/ai/providers/:id — update provider
// v24.6-audit (S-HIGH-4 fix): admin-only
router.patch(
  '/:id',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.params.id
    const parsed = updateSchema.parse(req.body)
    const existing = await prisma.aIProvider.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Provider not found' })
    // If marking as default, unset other defaults
    if (parsed.isDefault) {
      await prisma.aIProvider.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      })
    }
    // Build update data — only update apiKey if a new one is provided
    const update: Record<string, unknown> = {}
    if (parsed.name !== undefined) update.name = parsed.name
    if (parsed.type !== undefined) update.type = parsed.type
    if (parsed.baseUrl !== undefined) update.baseUrl = parsed.baseUrl
    if (parsed.model !== undefined) update.model = parsed.model
    if (parsed.enabled !== undefined) update.enabled = parsed.enabled
    if (parsed.isDefault !== undefined) update.isDefault = parsed.isDefault
    if (parsed.params !== undefined) update.params = JSON.stringify(parsed.params)
    if (parsed.apiKey !== undefined && parsed.apiKey !== '') {
      update.apiKeyEnc = encryptSecret(parsed.apiKey)
    }
    const provider = await prisma.aIProvider.update({ where: { id }, data: update })
    await auditLog(req, 'ai-provider', id, 'update', { changes: parsed })
    res.json({ provider: sanitize(provider) })
  }),
)

// DELETE /api/ai/providers/:id — delete provider
// v24.6-audit (S-HIGH-4 fix): admin-only
router.delete(
  '/:id',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.params.id
    const existing = await prisma.aIProvider.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Provider not found' })
    await prisma.aIProvider.delete({ where: { id } })
    await auditLog(req, 'ai-provider', id, 'delete', { name: existing.name, type: existing.type })
    res.json({ ok: true })
  }),
)

// POST /api/ai/providers/:id/test — test the provider with a "ping" message.
// v22 final: rewritten to call the provider DIRECTLY via callAI() with a
// temporarily-constructed config — NO DB mutation. The previous code
// flipped `isDefault` on the DB row, which caused a 500 error in the
// `finally` block when the row didn't exist anymore (race condition).
// v24.6-audit (S-HIGH-4 fix): admin-only — testing a provider sends a real
// request to its endpoint with the configured API key. A manager could use
// this to validate their own malicious endpoint before swapping it in.
router.post(
  '/:id/test',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.params.id
    const existing = await prisma.aIProvider.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Provider not found' })

    // Decrypt key
    let apiKey = ''
    try { apiKey = existing.apiKeyEnc ? decryptSecret(existing.apiKeyEnc) : '' } catch { apiKey = '' }
    if (!apiKey && existing.type !== 'ollama') {
      return res.status(200).json({ ok: false, error: 'No API key set for this provider' })
    }

    // Resolve baseUrl + model with fallback to defaults
    const DEFAULTS_BASE: Record<string, string> = {
      deepseek: 'https://api.deepseek.com',
      openai: 'https://api.openai.com',
      gemini: 'https://generativelanguage.googleapis.com',
      claude: 'https://api.anthropic.com',
      grok: 'https://api.x.ai',
      openrouter: 'https://openrouter.ai/api',
      ollama: 'http://localhost:11434',
      custom: '',
    }
    const DEFAULTS_MODEL: Record<string, string> = {
      deepseek: 'deepseek-chat',
      openai: 'gpt-4o-mini',
      gemini: 'gemini-1.5-flash',
      claude: 'claude-3-5-sonnet-20241022',
      grok: 'grok-2-1212',
      openrouter: 'openai/gpt-4o-mini',
      ollama: 'llama3.1',
      custom: '',
    }
    const baseUrl = existing.baseUrl || DEFAULTS_BASE[existing.type] || ''
    const model = existing.model || DEFAULTS_MODEL[existing.type] || ''
    let params: Record<string, any> = {}
    try { params = JSON.parse(existing.params || '{}') } catch { params = {} }

    // Build a temporary provider config — DO NOT touch the DB.
    const testProvider = {
      id: existing.id,
      name: existing.name,
      type: existing.type as any,
      apiKey,
      baseUrl,
      model,
      params,
    }

    try {
      // Directly call the provider's dispatch function (bypass getActiveProvider).
      const { dispatchByProvider } = await import('../lib/ai-provider.js')
      const messages = [
        { role: 'system' as const, content: 'You are a test ping. Reply with exactly: OK' },
        { role: 'user' as const, content: 'ping' },
      ]
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      const reply = await dispatchByProvider(testProvider, messages as any, controller.signal, {})
      clearTimeout(timeout)
      const replyText = typeof reply === 'string' ? reply : (reply as any)?.content || ''
      res.json({
        ok: !!replyText,
        reply: replyText.slice(0, 200),
        provider: existing.type,
        model,
        baseUrl,
      })
    } catch (e: any) {
      res.status(200).json({
        ok: false,
        error: String(e?.message || e).slice(0, 300),
        provider: existing.type,
        model,
        baseUrl,
      })
    }
  }),
)

export default router
