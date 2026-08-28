'use client'

// ============================================================================
//  AI Agent TRI999 — v25.9.4
//  Full rewrite — fixes all reported issues:
//   1. Greeting doesn't hide product cards — they render below it.
//   2. Vertical scroll works on long conversations.
//   3. Product cards open the product overlay (closes AI first).
//   4. Close button visible (safe-area aware).
//   5. Continuous voice mode — AI keeps listening after each reply.
//   6. Readable in light AND dark themes.
// ============================================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, X, Send, Loader2, AlertCircle,
  Mic, MicOff, Volume2, VolumeX, ImageIcon, Plus,
  MessageSquare, History, ChevronLeft, Pin, PinOff, Keyboard,
  ArrowUp, Trash2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { useAuthStore } from '@/lib/auth-store'
import { AIResponseRenderer } from './response-renderer'
import { useAISession, type AIMessage } from './ai-session-store'

interface AIStatus {
  configured: boolean
  assistantName: string
  greeting: string
  voiceEnabled: boolean
}

interface ChatResponse {
  reply: string
  action?: { type: string; view?: string; query?: string } | null
  actions?: Array<{ type: string; param?: string; label: string }>
  calculation?: any
  cards?: Array<{ kind: string; data: any }>
  conversationId?: string | null
  local?: boolean
}

interface Conversation {
  id: string
  title: string
  context?: string | null
  role: string
  pinned: boolean
  createdAt: string
  updatedAt: string
  messageCount: number
  preview?: string | null
}

interface AssistantProps {
  context?: string
  onNavigate?: (view: string) => void
  onOpenProduct?: (productId: string) => void
  onOpenCart?: () => void
  inline?: boolean
}

export function AIAssistant({
  context,
  onNavigate,
  onOpenCart,
  onOpenProduct: onOpenProductProp,
  inline = false,
}: AssistantProps) {
  const session = useAISession()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'manager'
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [interimText, setInterimText] = useState('')
  // v25.9.8: animated product gallery for the empty state. Real products are
  // fetched from /api/products/smart/blocks when the AI panel opens. The
  // gallery auto-rotates every 3.5s. Cards are clickable (opens product).
  const [galleryProducts, setGalleryProducts] = useState<any[]>([])
  const [galleryIdx, setGalleryIdx] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  // v25.9.4: continuous voice mode flag — when true, after AI replies the
  // mic auto-restarts so the user can speak again without tapping. This is
  // the "continuous voice agent" the user asked for.
  const continuousVoiceRef = useRef(false)

  const speechSupported = useMemo(
    () =>
      typeof window !== 'undefined' &&
      (typeof (window as any).webkitSpeechRecognition !== 'undefined' ||
        typeof (window as any).SpeechRecognition !== 'undefined'),
    [],
  )
  useScrollLock(session.open && !inline)

  // ----- 1. Open/close events -----
  useEffect(() => {
    const openHandler = () => {
      // v25.9.10: REMOVED the `enabled` gate — the AI should ALWAYS open when
      // the user clicks the button.
      session.setOpen(true)
      if (context) session.setLastContext(context)

      // v25.16 (owner): «когда мы заходим в агента — чтобы для начала был
      // именно голосовой бот. Если человеку нужна клавиатура — он сам
      // выберет». Пока пользователь ни разу не переключал режим вручную
      // (флага нет в localStorage) — каждый заход стартует в voice-режиме.
      // Первый ручной выбор сохраняет предпочтение.
      let modeExplicit = false
      try { modeExplicit = localStorage.getItem('999pro-ai-mode-explicit') === '1' } catch {}
      if (!modeExplicit && session.mode !== 'voice') {
        session.setMode('voice')
        session.setAutoSpeak(true)
      }
    }
    const closeHandler = () => session.setOpen(false)
    // v25.9.6: when a product is opened (from anywhere — AI card click, chat,
    // orders, etc.), close the AI overlay so the product is visible. The AI
    // session state (messages, conversationId) is preserved in the Zustand
    // store, so the user can return to AI and continue the conversation.
    const productOpenHandler = () => {
      if (!inline) {
        session.setOpen(false)
        stopSpeaking()
        continuousVoiceRef.current = false
        if (recognitionRef.current) {
          try { recognitionRef.current.stop() } catch {}
        }
      }
    }
    window.addEventListener('open-ai-assistant', openHandler)
    window.addEventListener('close-ai-assistant', closeHandler)
    window.addEventListener('999pro:open-product', productOpenHandler)
    return () => {
      window.removeEventListener('open-ai-assistant', openHandler)
      window.removeEventListener('close-ai-assistant', closeHandler)
      window.removeEventListener('999pro:open-product', productOpenHandler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, inline])

  // ----- 2. Fetch AI status -----
  useEffect(() => {
    if (session.open && !status) {
      api.get<AIStatus>('/api/ai/status').then(setStatus).catch(() => {})
    }
  }, [session.open, status])

  // v25.9.8: fetch real products for the animated gallery in the empty state.
  // Uses /api/products/smart/blocks (same as home page) so cards are real.
  useEffect(() => {
    if (!session.open || galleryProducts.length > 0) return
    api
      .get<{ blocks: Array<{ id: string; items: any[] }> }>('/api/products/smart/blocks', {
        query: { limit: 8, seed: Math.floor(Math.random() * 1000000) },
      })
      .then((data) => {
        const items = data.blocks.flatMap((b) => b.items).slice(0, 8)
        if (items.length > 0) setGalleryProducts(items)
      })
      .catch(() => {/* non-critical — gallery just stays empty */})
  }, [session.open, galleryProducts.length])

  // v25.9.8: auto-rotate the gallery every 3.5s (only in empty state).
  useEffect(() => {
    const hasMsgs = session.messages.length > 0
    if (!session.open || hasMsgs || galleryProducts.length === 0) return
    const t = setInterval(() => {
      setGalleryIdx((i) => (i + 1) % Math.max(1, galleryProducts.length))
    }, 3500)
    return () => clearInterval(t)
  }, [session.open, session.messages.length, galleryProducts.length])

  // ----- 3. Auto-scroll to bottom on new message (works for long convos) -----
  useEffect(() => {
    if (scrollRef.current) {
      // Use scrollTo with behavior smooth for better UX. requestAnimationFrame
      // ensures the new message is in the DOM before we scroll.
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth',
          })
        }
      })
    }
  }, [session.messages, loading])

  // ----- 4. Focus input when opening in text mode -----
  useEffect(() => {
    if (session.open && session.mode === 'text') {
      const t = setTimeout(() => inputRef.current?.focus(), 150)
      return () => clearTimeout(t)
    }
  }, [session.open, session.mode])

  // ----- 4b. v25.16: автозапуск микрофона при открытии в голосовом режиме.
  // Голосовой агент должен СНЯЧАЛА слушать — микрофон стартует автоматически
  // через полсекунды после открытия (переключатель клавиатуры отключает).
  useEffect(() => {
    if (!session.open || session.mode !== 'voice') return
    if (!speechSupported || listening || loading || speaking) return
    const t = setTimeout(() => {
      startListening()
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.open, session.mode])

  // ----- 5. Stop TTS/STT when panel closes -----
  useEffect(() => {
    if (!session.open) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
      setSpeaking(false)
      continuousVoiceRef.current = false
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch {}
        recognitionRef.current = null
      }
      setListening(false)
    }
  }, [session.open])

  // ----- 6. Proactive greeting (shown ONLY in empty state, NOT as a message) -----
  // v25.9.8: previously the greeting was added as an assistant message to
  // session.messages. This caused two problems:
  //   1. The empty state (with example prompts + product gallery) disappeared
  //      the moment the greeting was added — "на секунду показывает быстрые
  //      команды" then they vanish.
  //   2. The greeting persisted in history forever, cluttering the conversation.
  // Now the greeting is computed but NOT added to messages. It's rendered
  // directly in the empty state (renderEmptyState) so the user sees:
  //   - greeting text
  //   - animated product gallery
  //   - example prompts
  // ...all together, persistently, until they send their first message.
  const greetingText = useMemo(() => {
    if (!status) return ''
    const hour = new Date().getHours()
    const timeOfDay =
      hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'
    const roleGreeting = isAdmin
      ? `${timeOfDay}! Я Агент 999 — ваш деловой помощник.`
      : `${timeOfDay}! Я Агент 999 — помогу подобрать товар, оформить заказ или ответить на вопросы.`
    const ctxHint =
      context === 'catalog'
        ? ' Вижу, вы в каталоге — могу показать популярные товары.'
        : context === 'cart'
          ? ' У вас есть товары в корзине — могу помочь оформить заказ.'
          : context === 'orders'
            ? ' Могу проверить статус вашего заказа.'
            : ''
    return (status.greeting || roleGreeting) + ctxHint
  }, [status, context, isAdmin])

  // ----- 7. Handle send -----
  const handleSend = useCallback(
    async (messageText?: string) => {
      const text = (messageText ?? input).trim()
      if (!text || loading) return
      setInput('')
      setError(null)
      setInterimText('')

      const userMsg: AIMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        ts: Date.now(),
      }
      session.addMessage(userMsg)

      const placeholderId = `a-${Date.now()}`
      session.addMessage({
        id: placeholderId,
        role: 'assistant',
        content: '',
        ts: Date.now(),
      })
      setLoading(true)

      try {
        let convId = session.conversationId
        if (!convId && user) {
          try {
            const r = await api.post<{ conversation: { id: string } }>(
              '/api/ai/conversations',
              { json: { title: 'Новый диалог', context: context || undefined }, auth: true },
            )
            convId = r.conversation.id
            session.setConversationId(convId)
          } catch {
            /* non-critical */
          }
        }

        const r = await api.post<ChatResponse>('/api/ai/chat', {
          json: {
            message: text,
            context,
            conversationId: convId || undefined,
            history: session.messages
              .slice(-10)
              .filter((m) => m.id !== placeholderId && m.id !== userMsg.id)
              .map((m) => ({ role: m.role, content: m.content })),
          },
          auth: true,
        })
        session.updateLastAssistantMessage({
          id: placeholderId,
          content: r.reply,
          cards: r.cards,
          actions: r.actions,
          calculation: r.calculation,
        })
        if (r.conversationId && r.conversationId !== session.conversationId) {
          session.setConversationId(r.conversationId)
        }
        // v25.9.12: CONTINUOUS VOICE — always auto-speak the reply when in
        // voice mode, then restart listening after speech ends. This creates
        // a seamless conversation loop: user speaks → AI replies → AI speaks
        // → mic auto-restarts → user speaks again. No manual tapping needed.
        if (
          session.mode === 'voice' &&
          typeof window !== 'undefined' &&
          'speechSynthesis' in window
        ) {
          speak(r.reply, () => {
            // onend callback — restart listening if continuous mode is active
            if (continuousVoiceRef.current && session.open) {
              setTimeout(() => {
                // Only restart if not already listening (avoids double-start)
                if (continuousVoiceRef.current && session.open && !listening) {
                  startListening()
                }
              }, 300)
            }
          })
        } else if (continuousVoiceRef.current && session.open) {
          // v25.9.12: even in text mode, if continuous voice is active (user
          // started voice but switched to text), restart listening after reply.
          setTimeout(() => {
            if (continuousVoiceRef.current && session.open && !listening) {
              startListening()
            }
          }, 500)
        }
      } catch (e: any) {
        session.updateLastAssistantMessage({
          id: placeholderId,
          content: 'Извините, не удалось получить ответ. Попробуйте ещё раз.',
        })
        setError(e?.message || 'Не удалось получить ответ.')
      } finally {
        setLoading(false)
      }
    },
    [input, loading, context, session, user],
  )

  // ----- 9. Voice input (STT) with continuous mode support -----
  const startListening = useCallback(() => {
    if (!speechSupported) {
      setError('Голосовой ввод не поддерживается этим браузером')
      return
    }
    if (listening) {
      // v25.9.12: Manual stop — user explicitly tapped the mic to stop.
      // Disable continuous mode so auto-restart doesn't fire.
      continuousVoiceRef.current = false
      try { recognitionRef.current?.stop() } catch {}
      recognitionRef.current = null
      setListening(false)
      return
    }
    // v25.9.12: Start listening — continuous mode is ALWAYS enabled when the
    // user starts voice input. The mic will auto-restart after each AI reply
    // (via speak onend callback) and after silence (via rec.onend fallback).
    // The only way to stop is to tap the mic button again.
    continuousVoiceRef.current = true
    const SR =
      (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    const rec = new SR()
    rec.lang = 'ru-RU'
    rec.continuous = false
    rec.interimResults = true
    rec.onresult = (e: any) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      if (interim) setInterimText(interim)
      if (final) {
        const finalText = final.trim()
        setInterimText('')
        // v25.9.12: auto-send immediately in continuous mode — don't wait.
        if (continuousVoiceRef.current && finalText) {
          setInput('')
          handleSend(finalText)
        } else {
          setInput((prev) => (prev ? prev + ' ' : '') + finalText)
        }
      }
    }
    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        setError('Нет доступа к микрофону. Разрешите доступ в настройках браузера.')
        continuousVoiceRef.current = false
      } else if (e?.error === 'no-speech') {
        // v25.9.12: "no-speech" is normal in continuous mode — the user just
        // paused. Don't show an error; the onend handler will restart listening.
      } else if (e?.error !== 'aborted') {
        setError('Ошибка распознавания речи: ' + (e?.error || 'unknown'))
      }
      setListening(false)
      recognitionRef.current = null
    }
    rec.onend = () => {
      setListening(false)
      recognitionRef.current = null
      setInterimText('')
      // v25.9.12: CONTINUOUS MODE — auto-restart listening after a brief
      // pause unless the user manually stopped (continuousVoiceRef = false)
      // or the AI is currently loading/speaking. The speak() onend callback
      // also restarts listening, but this fallback handles the case where
      // there was no AI reply (e.g. user paused without speaking).
      if (continuousVoiceRef.current && session.open && !loading && !speaking) {
        setTimeout(() => {
          if (continuousVoiceRef.current && session.open && !loading && !speaking) {
            // Restart recognition — create a fresh SR instance because the
            // old one cannot be reused after onend.
            try {
              const SR2 =
                (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
              const rec2 = new SR2()
              rec2.lang = 'ru-RU'
              rec2.continuous = false
              rec2.interimResults = true
              rec2.onresult = rec.onresult
              rec2.onerror = rec.onerror
              rec2.onend = rec.onend
              rec2.start()
              recognitionRef.current = rec2
              setListening(true)
            } catch {}
          }
        }, 300)
      }
    }
    rec.start()
    recognitionRef.current = rec
    setListening(true)
    setError(null)
  }, [speechSupported, listening, session.open, loading, speaking, handleSend])

  // ----- 10. Voice output (TTS) with onend callback for continuous mode -----
  const speak = useCallback((text: string, onend?: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onend?.()
      return
    }
    window.speechSynthesis.cancel()
    const clean = text
      .replace(/[#*_>`~-]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n+/g, '. ')
      .slice(0, 1000)
    const utter = new SpeechSynthesisUtterance(clean)
    utter.lang = 'ru-RU'
    utter.rate = 1.0
    utter.pitch = 1.0
    const voices = window.speechSynthesis.getVoices()
    const ru = voices.find((v) => v.lang?.toLowerCase().startsWith('ru'))
    if (ru) utter.voice = ru
    utter.onstart = () => setSpeaking(true)
    utter.onend = () => {
      setSpeaking(false)
      onend?.()
    }
    utter.onerror = () => {
      setSpeaking(false)
      onend?.()
    }
    window.speechSynthesis.speak(utter)
  }, [])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [])

  // ----- 11. Conversation history -----
  const loadConversations = useCallback(async () => {
    if (!user) return
    try {
      const r = await api.get<{ conversations: Conversation[] }>('/api/ai/conversations', {
        auth: true,
      })
      setConversations(r.conversations || [])
    } catch {
      /* non-critical */
    }
  }, [user])

  const openConversation = useCallback(
    async (convId: string) => {
      try {
        const r = await api.get<{ conversation: { messages: any[] } }>(
          `/api/ai/conversations/${convId}`,
          { auth: true },
        )
        const msgs: AIMessage[] = (r.conversation.messages || []).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          cards: m.cards ? safeParse(m.cards) : undefined,
          actions: m.actions ? safeParse(m.actions) : undefined,
          calculation: m.calculation ? safeParse(m.calculation) : undefined,
          images: m.images ? safeParse(m.images) : undefined,
          ts: new Date(m.createdAt).getTime(),
        }))
        session.setMessages(msgs)
        session.setConversationId(convId)
        session.setGreetingShown(true)
        setShowHistory(false)
      } catch {
        setError('Не удалось загрузить разговор')
      }
    },
    [session, user],
  )

  const deleteConversation = useCallback(
    async (convId: string) => {
      try {
        await api.delete(`/api/ai/conversations/${convId}`, { auth: true })
        setConversations((arr) => arr.filter((c) => c.id !== convId))
        if (session.conversationId === convId) {
          session.clearMessages()
        }
      } catch {}
    },
    [session],
  )

  const togglePin = useCallback(async (convId: string, pinned: boolean) => {
    try {
      await api.patch(`/api/ai/conversations/${convId}`, {
        json: { pinned: !pinned },
        auth: true,
      })
      setConversations((arr) => arr.map((c) => (c.id === convId ? { ...c, pinned: !pinned } : c)))
    } catch {}
  }, [])

  // ----- 12. Open product — closes AI overlay first, then dispatches event -----
  const openProduct = useCallback((productId: string) => {
    if (!productId) return
    // v25.9.9: Stop any ongoing speech/listening FIRST.
    stopSpeaking()
    continuousVoiceRef.current = false
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
    // v25.9.9: dispatch the open-product event IMMEDIATELY (before closing AI).
    // The main app's page.tsx listens for this event and opens the product
    // overlay (z-350) which is ABOVE the AI overlay (z-200). This way the
    // product appears on top instantly — no white screen, no race condition.
    // The AI overlay is then closed AFTER the event so it doesn't interfere.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('999pro:open-product', { detail: { productId } }),
      )
    }
    // Also call the prop for AppShell-mounted mode
    onOpenProductProp?.(productId)
    // Now close the AI overlay (after the product event has been dispatched).
    // The product overlay (z-350) will be rendered on top of the AI overlay
    // during the AI's exit animation, then the AI overlay disappears.
    if (!inline) {
      // Use setTimeout(0) to ensure the event is processed by page.tsx first.
      setTimeout(() => session.setOpen(false), 0)
    }
  }, [inline, session, stopSpeaking, onOpenProductProp])

  // ----- Render -----
  const hasMessages = session.messages.length > 0
  const isVoiceMode = session.mode === 'voice'

  const examplePrompts = useMemo(() => {
    if (isAdmin) {
      return [
        'Покажи последние заказы',
        'Сколько клиентов за сегодня?',
        'Помоги написать текст для баннера',
        'Какая аналитика по продажам?',
      ]
    }
    return [
      'Мне нужен баннер 3×2',
      'Помоги подобрать товар',
      'Где мой заказ?',
      'Напиши текст для рекламы',
    ]
  }, [isAdmin])

  const renderHeader = () => (
    <div
      className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border/60 bg-card/95 backdrop-blur-xl shrink-0"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative h-9 w-9 shrink-0">
          <div
            className={cn(
              'absolute inset-0 rounded-xl grid place-items-center shadow-glow transition-all',
              listening
                ? 'bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 animate-pulse'
                : speaking
                  ? 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500'
                  : 'bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500',
            )}
          >
            <Sparkles className="h-4 w-4 text-white" />
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-base leading-tight truncate text-foreground">
            {status?.assistantName || 'Агент 999'}
          </h2>
          <p className="text-xs text-muted-foreground leading-tight truncate">
            {listening
              ? 'Слушаю…'
              : speaking
                ? 'Говорю…'
                : loading
                  ? 'Думаю…'
                  : isVoiceMode && continuousVoiceRef.current
                    ? 'Непрерывный режим — говорите'
                    : status?.configured
                      ? 'Готов помочь'
                      : 'Загрузка…'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => {
            // v25.16: ручное переключение режима запоминаем — после этого
            // агент больше не принудительно открывает голосовой режим.
            try { localStorage.setItem('999pro-ai-mode-explicit', '1') } catch {}
            session.setMode(isVoiceMode ? 'text' : 'voice')
          }}
          className={cn(
            'h-9 w-9 grid place-items-center rounded-full transition-colors',
            isVoiceMode ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground',
          )}
          title={isVoiceMode ? 'Текстовый режим' : 'Голосовой режим'}
        >
          {isVoiceMode ? <Keyboard className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          onClick={() => {
            setShowHistory((v) => !v)
            if (!showHistory) loadConversations()
          }}
          className={cn(
            'h-9 w-9 grid place-items-center rounded-full transition-colors',
            showHistory ? 'bg-accent text-foreground' : 'hover:bg-accent text-muted-foreground',
          )}
          title="История"
        >
          <History className="h-4 w-4" />
        </button>
        {/* v25.9.8: "Очистить диалог" button — clears the current conversation's
            messages from the local session (keeps the conversationId so the
            server-side history is preserved). Only shown when there are messages. */}
        {hasMessages && (
          <button
            onClick={() => {
              if (confirm('Очистить текущий диалог? Сообщения будут удалены из текущей сессии.')) {
                session.clearMessages()
                setError(null)
                stopSpeaking()
                continuousVoiceRef.current = false
                if (recognitionRef.current) {
                  try { recognitionRef.current.stop() } catch {}
                }
              }
            }}
            className="h-9 w-9 grid place-items-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Очистить диалог"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {/* v25.9.10: "Новый чат" button — creates a fresh AI conversation.
            Clears the current messages and conversationId so the next message
            starts a new thread. The old conversation is preserved in the DB
            (if the user was authenticated) and can be accessed via History. */}
        <button
          onClick={() => {
            session.clearMessages()
            session.setConversationId(null)
            session.setGreetingShown(false)
            setError(null)
            stopSpeaking()
            continuousVoiceRef.current = false
            if (recognitionRef.current) {
              try { recognitionRef.current.stop() } catch {}
            }
          }}
          className="h-9 px-3 grid place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-semibold gap-1.5 flex"
          title="Новый чат"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Новый чат</span>
        </button>
        {!inline && (
          <button
            onClick={() => session.setOpen(false)}
            className="h-9 w-9 grid place-items-center rounded-full hover:bg-accent text-muted-foreground transition-colors"
            title="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )

  // v25.9.8: Animated product gallery — horizontal marquee of real products.
  // Auto-rotates every 3.5s. Cards are clickable (opens product overlay).
  const renderProductGallery = () => {
    if (galleryProducts.length === 0) return null
    // Show 3 cards at a time on desktop, 2 on mobile, offset by galleryIdx.
    const visibleCount = typeof window !== 'undefined' && window.innerWidth >= 640 ? 3 : 2
    const cards = []
    for (let i = 0; i < visibleCount; i++) {
      const idx = (galleryIdx + i) % galleryProducts.length
      cards.push(galleryProducts[idx])
    }
    return (
      <div className="w-full max-w-2xl mb-6">
        <div className="flex gap-3 justify-center">
          <AnimatePresence mode="wait">
            {cards.map((p, i) => (
              <motion.button
                key={`${p.id}-${galleryIdx}-${i}`}
                initial={{ opacity: 0, x: 40, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -40, scale: 0.95 }}
                transition={{ duration: 0.4, ease: 'easeOut', delay: i * 0.05 }}
                onClick={() => p.id && openProduct(p.id)}
                className="flex-1 max-w-[180px] text-left rounded-2xl overflow-hidden bg-card/80 backdrop-blur-md border border-border/50 hover:border-primary/40 hover:shadow-glow transition-all group"
                style={{ minHeight: '200px' }}
              >
                <div className="aspect-square bg-muted overflow-hidden">
                  {p.image || p.images?.[0] ? (
                    <img
                      src={p.image || p.images?.[0]}
                      alt={p.title}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center bg-gradient-to-br from-indigo-500/10 via-violet-500/10 to-fuchsia-500/10">
                      <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-semibold text-foreground line-clamp-2 leading-tight min-h-[2rem]">
                    {p.title}
                  </div>
                  {p.price != null && (
                    <div className="text-sm font-bold text-primary mt-1">
                      от {Number(p.price).toLocaleString('ru-RU')} ₽
                    </div>
                  )}
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
        {/* Indicator dots */}
        <div className="flex justify-center gap-1.5 mt-3">
          {galleryProducts.slice(0, 6).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === galleryIdx % 6 ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
              )}
            />
          ))}
        </div>
      </div>
    )
  }

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center min-h-full text-center px-4 py-8">
      {/* Premium AI orb with breathing animation */}
      <motion.div
        animate={{
          scale: [1, 1.08, 1],
          boxShadow: [
            '0 0 20px 0px rgba(99, 102, 241, 0.3)',
            '0 0 40px 8px rgba(139, 92, 246, 0.5)',
            '0 0 20px 0px rgba(99, 102, 241, 0.3)',
          ],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="h-20 w-20 rounded-3xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shadow-glow mb-5"
      >
        <Sparkles className="h-9 w-9 text-white" />
      </motion.div>

      <h3 className="text-2xl font-bold mb-2 text-foreground">
        {status?.assistantName || 'Агент 999'}
      </h3>
      {/* v25.9.8: greeting shown here (NOT as a message) — stays until first user message */}
      <p className="text-sm text-muted-foreground mb-6 max-w-md leading-relaxed">
        {greetingText || (isAdmin
          ? 'Ваш деловой помощник — аналитика, заказы, клиенты и контент.'
          : 'Помогу подобрать товар, оформить заказ или ответить на вопросы.')}
      </p>

      {/* v25.9.8: Animated product gallery — real products from catalog */}
      {renderProductGallery()}

      {/* Quick prompts — stay visible until the user sends a message */}
      <div className="grid gap-2 w-full max-w-md">
        {examplePrompts.map((prompt, i) => (
          <motion.button
            key={prompt}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.08, duration: 0.3 }}
            onClick={() => handleSend(prompt)}
            className="text-left px-4 py-2.5 rounded-2xl bg-card/70 backdrop-blur-md hover:bg-accent border border-border/40 hover:border-primary/40 text-sm text-foreground transition-all hover:translate-x-0.5"
          >
            {prompt}
          </motion.button>
        ))}
      </div>
    </div>
  )

  // v25.9.4: Product feed — horizontal scroll of product cards.
  // Clicking a card calls openProduct() which closes the AI overlay and
  // dispatches the open-product event.
  const renderProductFeed = (cards: any[]) => {
    const productCards = cards.filter((c) => c.kind === 'product' || c.kind === 'similar_products')
    if (productCards.length === 0) return null
    const items = productCards.flatMap((c) => {
      const data = c.data
      if (Array.isArray(data)) return data
      if (data?.items) return data.items
      return [data]
    })
    if (!items.length) return null
    return (
      <div className="mt-3 -mx-1">
        <div
          className="flex gap-3 overflow-x-auto pb-2 px-1 snap-x"
          style={{ scrollbarWidth: 'thin', WebkitOverflowScrolling: 'touch' }}
        >
          {items.map((p: any, idx: number) => (
            <button
              key={p.id || idx}
              onClick={() => p.id && openProduct(p.id)}
              className="snap-start shrink-0 w-40 sm:w-44 text-left rounded-2xl overflow-hidden bg-card border border-border/60 hover:border-primary/50 hover:shadow-glow transition-all group"
            >
              <div className="aspect-square bg-muted overflow-hidden">
                {p.image || p.images?.[0] ? (
                  <img
                    src={p.image || p.images?.[0]}
                    alt={p.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center bg-gradient-to-br from-muted to-muted/50">
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <div className="text-xs font-semibold text-foreground line-clamp-2 leading-tight min-h-[2rem]">
                  {p.title}
                </div>
                {p.price != null && (
                  <div className="text-sm font-bold text-primary mt-1">
                    от {Number(p.price).toLocaleString('ru-RU')} ₽
                  </div>
                )}
                {p.category && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{p.category}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // v25.9.12: Contact cards — beautiful clickable cards for phone, WhatsApp,
  // Telegram, email. Clicking opens the appropriate app (tel:, https://wa.me,
  // https://t.me, mailto:). Uses real contact data from Studio settings.
  const renderContactsCard = (cards: any[]) => {
    const contactCards = cards.filter((c) => c.kind === 'contacts')
    if (contactCards.length === 0) return null
    const contacts: Array<{ label: string; type: string; value: string }> = contactCards[0].data
    if (!Array.isArray(contacts) || contacts.length === 0) return null

    const getHref = (c: { type: string; value: string }) => {
      const v = c.value.trim()
      switch (c.type) {
        case 'phone':
          return `tel:${v.replace(/[^\d+]/g, '')}`
        case 'whatsapp': {
          // WhatsApp: accept phone numbers or wa.me links
          const digits = v.replace(/[^\d]/g, '')
          if (digits.length >= 10) return `https://wa.me/${digits}`
          return v.startsWith('http') ? v : `https://${v}`
        }
        case 'telegram': {
          // Telegram: accept @username or t.me links
          const username = v.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '')
          return `https://t.me/${username}`
        }
        case 'email':
          return `mailto:${v}`
        default:
          return v
      }
    }

    const getIcon = (type: string) => {
      switch (type) {
        case 'phone': return '📞'
        case 'whatsapp': return '💬'
        case 'telegram': return '✈️'
        case 'email': return '✉️'
        default: return '📋'
      }
    }

    const getColor = (type: string) => {
      switch (type) {
        case 'phone': return 'from-emerald-500 to-teal-600'
        case 'whatsapp': return 'from-green-500 to-emerald-600'
        case 'telegram': return 'from-sky-500 to-blue-600'
        case 'email': return 'from-indigo-500 to-violet-600'
        default: return 'from-slate-500 to-slate-600'
      }
    }

    return (
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {contacts.map((c, idx) => (
          <a
            key={idx}
            href={getHref(c)}
            target={c.type === 'whatsapp' || c.type === 'telegram' ? '_blank' : undefined}
            rel={c.type === 'whatsapp' || c.type === 'telegram' ? 'noopener noreferrer' : undefined}
            className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border/60 hover:border-primary/40 hover:shadow-glow transition-all group no-underline"
          >
            <div
              className={cn(
                'h-10 w-10 rounded-xl grid place-items-center text-white shrink-0 shadow-md bg-gradient-to-br',
                getColor(c.type),
              )}
            >
              <span className="text-lg">{getIcon(c.type)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">{c.label}</div>
              <div className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                {c.value}
              </div>
            </div>
            <ArrowUp className="h-4 w-4 text-muted-foreground group-hover:text-primary rotate-45 transition-transform shrink-0" />
          </a>
        ))}
      </div>
    )
  }

  const renderMessage = (msg: AIMessage, i: number) => {
    if (msg.role === 'user') {
      return (
        <div key={msg.id || i} className="flex justify-end">
          <div className="max-w-[85%] space-y-1">
            {msg.images && msg.images.length > 0 && (
              <div className="flex gap-1.5 justify-end">
                {msg.images.map((url, idx) => (
                  <img
                    key={idx}
                    src={url}
                    alt=""
                    className="h-20 w-20 rounded-xl object-cover border border-border/60"
                  />
                ))}
              </div>
            )}
            {/* v25.17: брендовый градиент вместо плоского bg-primary */}
            <div className="rounded-2xl rounded-br-md px-4 py-2.5 text-sm gradient-brand text-white shadow-[0_8px_22px_-10px_rgba(160,32,112,0.55)]">
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          </div>
        </div>
      )
    }
    const isPlaceholder = !msg.content && loading
    return (
      <div key={msg.id || i} className="flex justify-start group gap-2">
        {/* v25.17: мини-орб агента слева от каждого ответа — живой бренд */}
        <div
          className={cn(
            'hidden sm:grid place-items-center h-7 w-7 rounded-lg shrink-0 mt-1 bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 transition-all',
            (speaking || listening) && 'animate-pulse',
          )}
        >
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="max-w-[92%] rounded-2xl rounded-bl-md px-4 py-3 text-sm bg-card/85 backdrop-blur-md border border-border/50 space-y-2 shadow-[0_6px_20px_-12px_rgba(15,23,42,0.35)]">
          {isPlaceholder ? (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Думаю…</span>
            </div>
          ) : (
            <>
              <div className="text-foreground">
                <AIResponseRenderer text={msg.content} />
              </div>
              {msg.cards && msg.cards.length > 0 && renderProductFeed(msg.cards)}
              {msg.cards && msg.cards.length > 0 && renderContactsCard(msg.cards)}
              {msg.actions && msg.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {msg.actions.map((a, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        if (
                          a.type === 'navigate' ||
                          a.type === 'open_catalog' ||
                          a.type === 'open_cart' ||
                          a.type === 'open_checkout' ||
                          a.type === 'open_orders' ||
                          a.type === 'open_chat' ||
                          a.type === 'open_support'
                        ) {
                          onNavigate?.(a.param || a.view || a.type.replace('open_', ''))
                        }
                      }}
                      className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => (speaking ? stopSpeaking() : speak(msg.content))}
                  className="h-7 w-7 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"
                  title={speaking ? 'Остановить' : 'Озвучить'}
                >
                  {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  const renderChatArea = () => (
    <div
      ref={scrollRef}
      // v25.9.11: CRITICAL — data-scroll-lock-ignore tells use-scroll-lock.ts
      // NOT to preventDefault on wheel/touchmove events inside this container.
      // Without this attribute, the scroll-lock hook (active when AI overlay is
      // open) blocks ALL wheel and touch scrolling — this was the root cause of
      // "AI chat doesn't scroll on desktop wheel or mobile touch".
      data-scroll-lock-ignore
      className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-4 space-y-4 ai-chat-scroll"
      style={{
        minHeight: 0,
        // v25.9.9: critical for mobile scroll — without these, iOS Safari
        // and some Android browsers don't allow vertical drag-scrolling inside
        // a flex container. `WebkitOverflowScrolling: 'touch'` enables momentum
        // scrolling on iOS. `touchAction: 'pan-y'` tells the browser to handle
        // vertical pans as scroll (not as page-level gestures). `overscrollBehavior:
        // 'contain'` prevents scroll chaining to the parent when the chat area
        // reaches its scroll boundary.
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
        overscrollBehavior: 'contain',
        // `flex: 1` + `minHeight: 0` is the standard recipe for a scrollable
        // flex child — without minHeight:0 the flex item grows to fit content
        // and never overflows, so overflow-y:auto has nothing to scroll.
        flex: '1 1 0%',
        // v25.17: мягкая аурора-подложка (индиго сверху-справа, розовый
        // снизу-слева) — «сделать ИИ-агента красивее» без ломки логики.
        backgroundImage:
          'radial-gradient(640px 320px at 88% -5%, rgba(139,92,246,0.12), transparent 62%), radial-gradient(520px 280px at -2% 104%, rgba(236,72,153,0.10), transparent 62%)',
      }}
    >
      {!hasMessages ? renderEmptyState() : (
        <>
          {session.messages.map((msg, i) => renderMessage(msg, i))}
          {loading && !session.messages.some((m) => !m.content && m.role === 'assistant') && (
            <div className="flex justify-start">
              <div className="bg-card border border-border/60 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Думаю…</span>
              </div>
            </div>
          )}
          {error && (
            <div className="flex justify-center">
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
                <button onClick={() => setError(null)} className="ml-1 hover:underline text-xs">
                  OK
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  const renderComposer = () => (
    <div
      className="px-3 sm:px-4 py-3 border-t border-border/60 bg-card/95 backdrop-blur-xl shrink-0"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      {isVoiceMode && (
        <div className="mb-2 flex items-center justify-center gap-1 h-8">
          {listening ? (
            Array.from({ length: 5 }).map((_, i) => (
              <motion.div
                key={i}
                animate={{ height: [4, 16, 4] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                className="w-1 rounded-full bg-primary"
              />
            ))
          ) : speaking ? (
            Array.from({ length: 5 }).map((_, i) => (
              <motion.div
                key={i}
                animate={{ height: [4, 12, 4] }}
                transition={{ duration: 0.4, repeat: Infinity, delay: i * 0.05 }}
                className="w-1 rounded-full bg-amber-500"
              />
            ))
          ) : (
            <span className="text-xs text-muted-foreground">
              {continuousVoiceRef.current ? 'Непрерывный режим — говорите свободно. Нажмите 🎤 чтобы остановить.' : 'Нажмите 🎤 чтобы начать голосовой диалог'}
            </span>
          )}
        </div>
      )}
      {interimText && (
        <div className="mb-2 text-xs text-muted-foreground italic px-2">{interimText}</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSend()
        }}
        className="flex items-center gap-2 rounded-full bg-muted/40 backdrop-blur-md p-1.5 ring-1 ring-border/60 focus-within:ring-2 focus-within:ring-primary/40 transition-all"
      >
        {isVoiceMode && (
          <button
            type="button"
            onClick={startListening}
            disabled={!speechSupported}
            className={cn(
              'h-10 w-10 shrink-0 rounded-full grid place-items-center transition-all active:scale-90',
              listening
                ? 'bg-rose-500 text-white shadow-[0_0_0_6px_rgba(244,63,94,0.15)] animate-pulse'
                : 'gradient-brand text-white shadow-[0_6px_18px_-6px_rgba(160,32,112,0.6)] hover:brightness-110',
            )}
            title={listening ? 'Остановить запись' : 'Начать запись'}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isVoiceMode ? 'Говорите или напишите…' : 'Напишите, что вам нужно'}
          disabled={loading}
          className="flex-1 h-10 px-3 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50 min-w-0"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="h-10 w-10 shrink-0 rounded-full gradient-brand text-white grid place-items-center shadow-[0_6px_18px_-6px_rgba(160,32,112,0.6)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none active:scale-90 transition-all"
          title="Отправить"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </form>
    </div>
  )

  const renderHistoryPanel = () => (
    <AnimatePresence>
      {showHistory && (
        <motion.div
          initial={{ x: '-100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '-100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="absolute inset-y-0 left-0 w-72 sm:w-80 bg-background border-r border-border/60 z-10 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card/95 backdrop-blur-xl">
            <h3 className="font-semibold text-sm flex items-center gap-2 text-foreground">
              <History className="h-4 w-4" />
              История
            </h3>
            <div className="flex items-center gap-1">
              <button
                onClick={async () => {
                  session.clearMessages()
                  if (user) {
                    try {
                      const r = await api.post<{ conversation: { id: string } }>(
                        '/api/ai/conversations',
                        { json: { title: 'Новый диалог', context: context || undefined }, auth: true },
                      )
                      session.setConversationId(r.conversation.id)
                    } catch {}
                  }
                  setShowHistory(false)
                }}
                className="h-8 w-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"
                title="Новый диалог"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowHistory(false)}
                className="h-8 w-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"
                title="Закрыть"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-2 ai-chat-scroll" data-scroll-lock-ignore>
            {!user ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Войдите, чтобы сохранять историю разговоров
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Пока нет сохранённых разговоров
              </div>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50',
                    session.conversationId === c.id && 'bg-accent',
                  )}
                  onClick={() => openConversation(c.id)}
                >
                  <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <div className="text-sm font-medium truncate text-foreground">{c.title}</div>
                      {c.pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
                    </div>
                    {c.preview && (
                      <div className="text-xs text-muted-foreground truncate">{c.preview}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {new Date(c.updatedAt).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                      })}
                      {' · '}
                      {c.messageCount} сообщ.
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePin(c.id, c.pinned)
                      }}
                      className="h-6 w-6 grid place-items-center rounded hover:bg-accent text-muted-foreground"
                      title={c.pinned ? 'Открепить' : 'Закрепить'}
                    >
                      {c.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('Удалить этот разговор? Это действие нельзя отменить.')) {
                          deleteConversation(c.id)
                        }
                      }}
                      className="h-6 w-6 grid place-items-center rounded hover:bg-destructive/10 text-destructive"
                      title="Удалить"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  // ----- Inline (full-page) vs popup render -----
  if (inline) {
    return (
      <div className="flex-1 flex flex-col h-full relative bg-background overflow-hidden">
        {renderHeader()}
        <div className="flex-1 flex relative overflow-hidden">
          {renderHistoryPanel()}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {renderChatArea()}
            {renderComposer()}
          </div>
        </div>
      </div>
    )
  }

  // v25.9.7: render the popup overlay via a PORTAL to document.body. Previously
  // the overlay was rendered inside AppShell's layout div, which has CSS
  // properties (flex, overflow) that break `position: fixed` — the overlay
  // appeared "behind" the main content on desktop. By portaling to body, the
  // overlay escapes any parent stacking context and always renders on top.
  // v25.21 (owner): «ИИ-агент не понравился — верни, как было». Откат
  // v25.20-стайла (тёмное стекло/ручка/аурора): снова обычная панель
  // bg-background — на мобайле во весь экран, на десктопе центрированное
  // окно со скруглением. Внутренний дизайн чата (аурора, композер,
  // градиентные кнопки из v25.17) НЕ тронут — владелец просил вернуть
  // именно окно, а не «перекраску».
  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {session.open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-stretch sm:items-center justify-stretch sm:justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => session.setOpen(false)}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-3xl h-[100dvh] sm:h-[90vh] sm:rounded-3xl bg-background border border-border/60 shadow-2xl flex flex-col overflow-hidden relative"
          >

            {renderHeader()}
            <div className="flex-1 flex relative overflow-hidden">
              {renderHistoryPanel()}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {renderChatArea()}
                {renderComposer()}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
