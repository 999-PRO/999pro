/**
 * v19.0 — Multi-provider AI abstraction.
 *
 * Replaces ai-deepseek.ts as the single entry point for LLM calls.
 * Reads the active provider from DB (AIProvider table). Falls back to
 * DEEPSEEK_API_KEY env var if no provider is configured (backward compat).
 *
 * v8 audit: built-in `zai` provider (z-ai-web-dev-sdk / GLM-4.6) REMOVED.
 * All AI requests now go exclusively through the admin-configured DB
 * provider OR the DEEPSEEK_API_KEY env var fallback. If neither is set,
 * AI is considered unconfigured and chat endpoints return a clear error.
 */

import { prisma } from './prisma.js'
import { decryptSecret } from './crypto.js'
import { logger } from './logger.js'

export type ProviderType =
  | 'deepseek'
  | 'openai'
  | 'gemini'
  | 'claude'
  | 'grok'
  | 'openrouter'
  | 'ollama'
  | 'custom'

export interface AIProviderConfig {
  id: string
  name: string
  type: ProviderType
  apiKey: string // decrypted
  baseUrl: string
  model: string
  params: {
    temperature?: number
    maxTokens?: number
    systemPrompt?: string
  }
}

export interface DeepSeekMessage {
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

/** OpenAI/DeepSeek-compatible tool definition sent in the `tools` request field. */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, {
        type: string
        description: string
        enum?: string[]
      }>
      required?: string[]
    }
  }
}

export interface AIChatResult {
  reply: string
  provider: string
  model: string
  handled: boolean
  /** v22: if LLM emitted tool_calls, they are returned here for the agent loop. */
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** Default base URLs for known provider types. */
const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  claude: 'https://api.anthropic.com',
  grok: 'https://api.x.ai',
  openrouter: 'https://openrouter.ai/api',
  ollama: 'http://localhost:11434',
  custom: '',
}

/** Get default model for provider type (if admin didn't specify). */
const DEFAULT_MODELS: Record<ProviderType, string> = {
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  claude: 'claude-3-5-sonnet-20241022',
  grok: 'grok-2-1212',
  openrouter: 'openai/gpt-4o-mini',
  ollama: 'llama3.1',
  custom: '',
}

/**
 * Get the active AI provider configuration from DB.
 * Falls back to env var (DEEPSEEK_API_KEY) if no provider is configured.
 * v8 audit: ZAI/SDK fallback REMOVED — returns null when nothing is configured.
 *
 * v24.2 BUGFIX: previously required BOTH `enabled: true` AND `isDefault: true`.
 * If the admin created a provider in Studio but forgot to tick "Use by default"
 * (the checkbox defaults to OFF), getActiveProvider() returned null and the AI
 * assistant told users "AI не настроен" — even though a working provider
 * existed in the DB. Now we fall back to ANY enabled provider (most recently
 * updated first) when no isDefault one is found.
 */
export async function getActiveProvider(): Promise<AIProviderConfig | null> {
  // 1) Try DB-configured default provider first
  let provider = await prisma.aIProvider.findFirst({
    where: { enabled: true, isDefault: true },
  })
  // 2) v24.2 BUGFIX: fall back to any enabled provider (most recent first)
  //    so admins don't have to manually tick "use by default" on a single provider.
  if (!provider) {
    provider = await prisma.aIProvider.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
    })
  }
  if (provider) {
    let apiKey = ''
    try {
      apiKey = provider.apiKeyEnc ? decryptSecret(provider.apiKeyEnc) : ''
    } catch {
      apiKey = ''
    }
    const baseUrl = provider.baseUrl || DEFAULT_BASE_URLS[provider.type as ProviderType] || ''
    const model = provider.model || DEFAULT_MODELS[provider.type as ProviderType] || ''
    let params: AIProviderConfig['params'] = {}
    try {
      params = JSON.parse(provider.params || '{}')
    } catch {
      params = {}
    }
    return {
      id: provider.id,
      name: provider.name,
      type: provider.type as ProviderType,
      apiKey,
      baseUrl,
      model,
      params,
    }
  }

  // Fallback: env-var DeepSeek (backward compat for existing deployments)
  const envKey = process.env.DEEPSEEK_API_KEY || ''
  if (envKey) {
    return {
      id: 'env-deepseek',
      name: 'DeepSeek (env)',
      type: 'deepseek',
      apiKey: envKey,
      baseUrl: process.env.DEEPSEEK_API_BASE || DEFAULT_BASE_URLS.deepseek,
      model: process.env.DEEPSEEK_MODEL || DEFAULT_MODELS.deepseek,
      params: {},
    }
  }

  // v8 audit: ZAI/SDK fallback REMOVED — return null when nothing is configured.
  // Admin MUST set up a provider in Studio → AI API OR set DEEPSEEK_API_KEY env.
  return null
}

/** Check whether any AI provider is configured (DB or env). */
export async function isAIConfigured(): Promise<boolean> {
  const provider = await getActiveProvider()
  return !!provider && !!provider.apiKey
}

/** Result of a single LLM call — may include tool_calls for the agent loop. */
export interface LLMResponse {
  content: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/**
 * Call the active AI provider with a chat-completion-style request.
 * v22: supports tool calling — if `tools` is provided, the LLM may return
 * `tool_calls` in its reply, which the caller executes and feeds back.
 */
export async function callAI(
  messages: DeepSeekMessage[],
  options: {
    timeoutMs?: number
    signal?: AbortSignal
    tools?: ToolDefinition[]
    temperature?: number
    maxTokens?: number
  } = {},
): Promise<AIChatResult> {
  const provider = await getActiveProvider()
  if (!provider) {
    return {
      reply: '',
      provider: 'none',
      model: '',
      handled: false,
    }
  }
  const timeoutMs = options.timeoutMs ?? 30_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  try {
    const resp = await dispatchByProvider(provider, messages, controller.signal, {
      tools: options.tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    })
    return {
      reply: resp.content,
      provider: provider.type,
      model: provider.model,
      handled: true,
      tool_calls: resp.tool_calls,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** Dispatch the chat request to the appropriate provider API. */
export async function dispatchByProvider(
  provider: AIProviderConfig,
  messages: DeepSeekMessage[],
  signal: AbortSignal,
  opts: { tools?: ToolDefinition[]; temperature?: number; maxTokens?: number } = {},
): Promise<LLMResponse> {
  switch (provider.type) {
    case 'deepseek':
    case 'openai':
    case 'openrouter':
    case 'grok':
      return callOpenAICompatible(provider, messages, signal, opts)
    case 'claude':
      return callClaude(provider, messages, signal, opts)
    case 'gemini':
      return callGemini(provider, messages, signal, opts)
    case 'ollama':
      return callOllama(provider, messages, signal, opts)
    case 'custom':
      return callOpenAICompatible(provider, messages, signal, opts)
    default:
      return callOpenAICompatible(provider, messages, signal, opts)
  }
}

/** OpenAI-compatible chat completions API (DeepSeek, OpenAI, Grok, OpenRouter, custom). */
async function callOpenAICompatible(
  provider: AIProviderConfig,
  messages: DeepSeekMessage[],
  signal: AbortSignal,
  opts: { tools?: ToolDefinition[]; temperature?: number; maxTokens?: number } = {},
): Promise<LLMResponse> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/v1/chat/completions`
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    stream: false,
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    body.tool_choice = 'auto'
  }
  const temp = opts.temperature ?? provider.params.temperature
  if (temp !== undefined) body.temperature = temp
  const maxTok = opts.maxTokens ?? provider.params.maxTokens
  if (maxTok !== undefined) body.max_tokens = maxTok
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI provider ${provider.type} returned ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const msg = data?.choices?.[0]?.message
  return {
    content: msg?.content || '',
    tool_calls: Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0
      ? msg.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments || '{}' },
        }))
      : undefined,
  }
}

/** Anthropic Claude Messages API. */
async function callClaude(
  provider: AIProviderConfig,
  messages: DeepSeekMessage[],
  signal: AbortSignal,
  opts: { tools?: ToolDefinition[]; temperature?: number; maxTokens?: number } = {},
): Promise<LLMResponse> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/v1/messages`
  // Claude requires system message to be top-level, not in messages array
  const systemMsg = messages.find((m) => m.role === 'system')?.content || ''
  const userMessages = messages.filter((m) => m.role !== 'system')
  const body: Record<string, unknown> = {
    model: provider.model,
    max_tokens: opts.maxTokens ?? provider.params.maxTokens ?? 4096,
    messages: userMessages,
  }
  if (systemMsg) body.system = systemMsg
  const temp = opts.temperature ?? provider.params.temperature
  if (temp !== undefined) body.temperature = temp
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Claude API returned ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  // Claude returns content blocks: text + tool_use blocks
  let text = ''
  const tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []
  if (Array.isArray(data?.content)) {
    for (const block of data.content) {
      if (block.type === 'text') text += block.text
      else if (block.type === 'tool_use') {
        tool_calls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
        })
      }
    }
  }
  return { content: text, tool_calls: tool_calls.length > 0 ? tool_calls : undefined }
}

/** Google Gemini API. */
async function callGemini(
  provider: AIProviderConfig,
  messages: DeepSeekMessage[],
  signal: AbortSignal,
  opts: { tools?: ToolDefinition[]; temperature?: number; maxTokens?: number } = {},
): Promise<LLMResponse> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`
  // Gemini uses "contents" with "parts" array; system message becomes "systemInstruction"
  const systemMsg = messages.find((m) => m.role === 'system')?.content
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content ?? '' }],
    }))
  const body: Record<string, unknown> = { contents }
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg }] }
  }
  const genConfig: Record<string, unknown> = {}
  const temp = opts.temperature ?? provider.params.temperature
  if (temp !== undefined) genConfig.temperature = temp
  if (opts.maxTokens !== undefined) genConfig.maxOutputTokens = opts.maxTokens
  if (opts.tools && opts.tools.length > 0) {
    // Gemini function declarations format
    genConfig.tools = [{
      functionDeclarations: opts.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    }]
  }
  if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gemini API returned ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts || []
  let text = ''
  const tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []
  for (const p of parts) {
    if (typeof p.text === 'string') text += p.text
    if (p.functionCall) {
      tool_calls.push({
        id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
      })
    }
  }
  return { content: text, tool_calls: tool_calls.length > 0 ? tool_calls : undefined }
}

/** Ollama local API (no API key needed). */
async function callOllama(
  provider: AIProviderConfig,
  messages: DeepSeekMessage[],
  signal: AbortSignal,
  opts: { tools?: ToolDefinition[]; temperature?: number; maxTokens?: number } = {},
): Promise<LLMResponse> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/api/chat`
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    stream: false,
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }))
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama API returned ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const msg = data?.message
  return {
    content: msg?.content || '',
    tool_calls: Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0
      ? msg.tool_calls.map((tc: any) => ({
          id: tc.id || `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments || '{}' },
        }))
      : undefined,
  }
}
