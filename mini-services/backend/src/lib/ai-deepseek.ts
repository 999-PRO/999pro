// 999 — Три девятки — AI provider client (server-side only)
// ----------------------------------------------------------------------------
// v19.0: This module now delegates to lib/ai-provider.ts, which supports
// multiple AI providers (DeepSeek, OpenAI, Gemini, Claude, Grok, OpenRouter,
// Ollama, custom). The active provider is configured via Studio →
// Настройки → AI. For backward compatibility, falls back to DEEPSEEK_API_KEY
// env var if no provider is configured in DB.
//
// The API key is stored encrypted in DB and is NEVER exposed to the browser.
//
// v22 audit: now supports tool calling. callDeepSeek() accepts `tools` and
// returns `tool_calls` in its result for the agent loop to consume.
// ----------------------------------------------------------------------------
import { callAI, getActiveProvider, isAIConfigured, type ToolDefinition, type DeepSeekMessage as ProviderMessage } from './ai-provider.js'
import { logger } from './logger.js'

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export interface DeepSeekCallOptions {
  messages: DeepSeekMessage[]
  temperature?: number
  maxTokens?: number
  /** v22: tool definitions sent to the LLM. */
  tools?: ToolDefinition[]
}

export interface DeepSeekResult {
  ok: boolean
  content: string
  local: boolean
  error?: string
  /** v22: tool calls emitted by the LLM (if any). */
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** Synchronous check — only checks env var. For DB-configured providers,
 * use the async isAIConfigured() from ai-provider.ts. */
export function isDeepSeekConfigured(): boolean {
  return (process.env.DEEPSEEK_API_KEY || '').trim().length > 0
}

/** Async check — considers DB-configured providers too. */
export async function isAIConfiguredAsync(): Promise<boolean> {
  return await isAIConfigured()
}

export async function callDeepSeek(opts: DeepSeekCallOptions): Promise<DeepSeekResult> {
  try {
    const provider = await getActiveProvider()
    if (!provider) {
      return {
        ok: false,
        content: '',
        local: true,
        error: 'No AI provider is configured. Add one in Studio → Настройки → AI.',
      }
    }

    const messages = opts.messages as ProviderMessage[]
    const result = await callAI(messages, {
      timeoutMs: 30_000,
      tools: opts.tools,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    })

    if (!result.handled) {
      return {
        ok: false,
        content: '',
        local: !provider.apiKey,
        error: 'Empty response from AI provider',
      }
    }

    // If LLM emitted tool_calls, content may be empty — that's expected.
    if (result.tool_calls && result.tool_calls.length > 0) {
      return {
        ok: true,
        content: result.reply || '',
        local: false,
        tool_calls: result.tool_calls,
      }
    }

    if (!result.reply) {
      return {
        ok: false,
        content: '',
        local: false,
        error: 'Empty response from AI provider',
      }
    }

    return {
      ok: true,
      content: result.reply,
      local: false,
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, content: '', local: false, error: 'AI request timed out' }
    }
    logger.warn('AI provider call failed', { error: String(e?.message || e) })
    return { ok: false, content: '', local: false, error: String(e?.message || e) }
  }
}
