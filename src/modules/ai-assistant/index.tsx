'use client'

// ============================================================================
//  AI Assistant — простой текстовый помощник TRI999.
// ----------------------------------------------------------------------------
//  v25.8 (TRI999 launch): полностью переработан в простой текстовый интерфейс.
//  Пользователь видит поле ввода с плейсхолдером "Напишите, что вам нужно"
//  и кнопки с примерами запросов. Никаких огромных экранов с маркетингом.
//
//  Backend: POST /api/ai/chat { message, context, history }
//           GET  /api/ai/status
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X, Send, Loader2, Trash2, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { AIResponseRenderer } from './response-renderer'

interface AIResponse {
  id: string
  text: string
  calculation?: any
  actions?: Array<{ type: string; param?: string; label: string }>
  cards?: Array<{ kind: string; data: any }>
  ts: number
}

interface AIStatus {
  configured: boolean
  assistantName: string
  greeting: string
  voiceEnabled: boolean
}

interface AssistantProps {
  context?: string
  onNavigate?: (view: string) => void
  onOpenProduct?: (productId: string) => void
  onOpenCart?: () => void
}

const EXAMPLE_PROMPTS = [
  'Мне нужен баннер 3×2',
  'Помоги подобрать товар',
  'Где мой заказ?',
  'Напиши текст для рекламы',
  'Помоги оформить заказ',
]

export function AIAssistant({ context, onNavigate, onOpenCart }: AssistantProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string; response?: AIResponse }>>([])
  const [status, setStatus] = useState<AIStatus | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useScrollLock(open)

  // Listen for the global "open-ai-assistant" event (from sidebar button).
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-ai-assistant', handler)
    return () => window.removeEventListener('open-ai-assistant', handler)
  }, [])

  // Fetch AI status when opening for the first time.
  useEffect(() => {
    if (open && !status) {
      api.get<AIStatus>('/api/ai/status').then(setStatus).catch(() => {})
    }
  }, [open, status])

  // Focus input when opening.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history, loading])

  const handleSend = useCallback(async (messageText?: string) => {
    const text = (messageText ?? input).trim()
    if (!text || loading) return

    setInput('')
    setError(null)
    setHistory((h) => [...h, { role: 'user', content: text }])
    setLoading(true)

    try {
      const r = await api.post<{
        reply: string
        calculation?: any
        actions?: Array<{ type: string; param?: string; label: string }>
        cards?: Array<{ kind: string; data: any }>
      }>('/api/ai/chat', {
        json: {
          message: text,
          context,
          history: history.slice(-10).map((h) => ({
            role: h.role,
            content: h.role === 'assistant' && h.response ? h.response.text : h.content,
          })),
        },
      })
      const response: AIResponse = {
        id: `ai-${Date.now()}`,
        text: r.reply,
        calculation: r.calculation,
        actions: r.actions,
        cards: r.cards,
        ts: Date.now(),
      }
      setHistory((h) => [
        ...h,
        { role: 'assistant', content: r.reply, response },
      ])
    } catch (e: any) {
      setError(e?.message || 'Не удалось получить ответ. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }, [input, loading, history, context])

  const handleClear = () => {
    setHistory([])
    setError(null)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-2xl h-[90vh] sm:h-[80vh] sm:rounded-3xl bg-background border border-border/60 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 glass">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shadow-glow shrink-0">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-base leading-tight">Помощник TRI999</h2>
                  <p className="text-xs text-muted-foreground leading-tight">
                    {status?.configured ? 'Готов помочь' : 'Загрузка...'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {history.length > 0 && (
                  <button
                    onClick={handleClear}
                    className="h-9 w-9 grid place-items-center rounded-full hover:bg-accent text-muted-foreground transition-colors"
                    title="Очистить"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="h-9 w-9 grid place-items-center rounded-full hover:bg-accent text-muted-foreground transition-colors"
                  title="Закрыть"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {history.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shadow-glow mb-4">
                    <Sparkles className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-lg font-bold mb-1">Чем могу помочь?</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    Напишите, что вам нужно — я подберу товар, отвечу на вопрос или помогу оформить заказ.
                  </p>
                  <div className="grid gap-2 w-full max-w-md">
                    {EXAMPLE_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSend(prompt)}
                        className="text-left px-4 py-3 rounded-xl bg-muted/50 hover:bg-accent border border-border/40 text-sm transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {history.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted/60 rounded-bl-md'
                    )}
                  >
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    ) : msg.response ? (
                      <AIResponseRenderer text={msg.response.text} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted/60 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Думаю...</span>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex justify-center">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive/10 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-border/60 glass">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSend()
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Напишите, что вам нужно"
                  disabled={loading}
                  className="flex-1 h-11 px-4 rounded-full bg-background border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="h-11 w-11 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Отправить"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
