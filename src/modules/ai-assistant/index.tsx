'use client'

// ============================================================================
//  AI Agent 999PRO — v25.9.2 premium full-screen rebuild
// ----------------------------------------------------------------------------
//  Design priorities (per user feedback):
//   1. FULL-SCREEN — not a small popup. Inline mode fills the viewport.
//   2. READABLE in both light AND dark themes — uses text-foreground / bg-card.
//   3. Product FEED — AI responses show product cards as a horizontal feed,
//      not as tiny chat bubbles. Cards open the real product page on click.
//   4. DELETE conversations — history panel has a trash button per row.
//   5. IMAGE UPLOAD with similar-products search — user uploads a photo, AI
//      searches the catalog and shows matching products.
//   6. SCROLL — chat area is a proper scrollable container with custom scrollbar.
//   7. Voice + text modes preserved.
//   8. Persistent across navigation (Zustand store).
// ============================================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, X, Send, Loader2, Trash2, AlertCircle,
  Mic, MicOff, Volume2, VolumeX, ImageIcon, Plus,
  MessageSquare, History, ChevronLeft, Pin, PinOff, Power, Keyboard,
  ArrowUp,} from 'lucide-react'
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
  /** When true, renders inline as a full page (used by /ai route).
   *  When false (default), renders as a popup overlay. */
  inline?: boolean
}

// Premium rotating showcase for the landing state. Pulls from /api/products/smart/blocks
// so it always shows real catalog items.
const FALLBACK_SHOWCASE = [
  { id: '1', title: 'Баннер 3×6', image: null, price: 'от 2 500 ₽' },
  { id: '2', title: 'Вывеска с подсветкой', image: null, price: 'от 8 900 ₽' },
  { id: '3', title: 'Печать на футболках', image: null, price: 'от 990 ₽' },
  { id: '4', title: 'Дизайн логотипа', image: null, price: 'от 3 500 ₽' },
]

export function AIAssistant({ context, onNavigate, onOpenCart, onOpenProduct: onOpenProductProp, inline = false }: AssistantProps) {
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
  const [uploading, setUploading] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [showcase, setShowcase] = useState(FALLBACK_SHOWCASE)
  const [showcaseIdx, setShowcaseIdx] = useState(0)
  const [interimText, setInterimText] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const speechSupported = useMemo(
    () => typeof window !== 'undefined' && (typeof (window as any).webkitSpeechRecognition !== 'undefined' || typeof (window as any).SpeechRecognition !== 'undefined'),
    [],
  )
  useScrollLock(session.open && !inline)

  // ----- 1. Subscribe to "open-ai-assistant" + "close-ai-assistant" events -----
  useEffect(() => {
    const openHandler = () => {
      if (useAISession.getState().enabled) {
        session.setOpen(true)
        if (context) session.setLastContext(context)
      }
    }
    const closeHandler = () => session.setOpen(false)
    window.addEventListener('open-ai-assistant', openHandler)
    window.addEventListener('close-ai-assistant', closeHandler)
    return () => {
      window.removeEventListener('open-ai-assistant', openHandler)
      window.removeEventListener('close-ai-assistant', closeHandler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context])

  // ----- 2. Fetch AI status when opening for the first time -----
  useEffect(() => {
    if (session.open && !status) {
      api.get<AIStatus>('/api/ai/status').then(setStatus).catch(() => {})
    }
  }, [session.open, status])

  // ----- 3. Load showcase from /api/products/smart/blocks (rotating) -----
  useEffect(() => {
    if (!session.open) return
    api
      .get<{ blocks: Array<{ id: string; items: any[] }> }>('/api/products/smart/blocks', {
        query: { limit: 8, seed: Math.floor(Math.random() * 1000000) },
      })
      .then((data) => {
        const items = data.blocks.flatMap((b) => b.items).slice(0, 8)
        if (items.length > 0) {
          setShowcase(
            items.map((p) => ({
              id: p.id,
              title: p.title || 'Товар',
              image: p.image || p.images?.[0] || null,
              price: p.price ? `от ${p.price.toLocaleString('ru-RU')} ₽` : 'Цена по запросу',
            })),
          )
        }
      })
      .catch(() => {/* keep fallback */})
  }, [session.open])

  // ----- 4. Rotate showcase every 3.5s -----
  useEffect(() => {
    if (!session.open || session.messages.length > 0) return
    const t = setInterval(() => {
      setShowcaseIdx((i) => (i + 1) % Math.max(1, showcase.length))
    }, 3500)
    return () => clearInterval(t)
  }, [session.open, session.messages.length, showcase.length])

  // ----- 5. Focus input when opening -----
  useEffect(() => {
    if (session.open && session.mode === 'text') {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [session.open, session.mode])

  // ----- 6. Auto-scroll on new message -----
  useEffect(() => {
    if (scrollRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated before scrolling.
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
        }
      })
    }
  }, [session.messages, loading])

  // ----- 7. Stop TTS when panel closes -----
  useEffect(() => {
    if (!session.open && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [session.open])

  // ----- 8. Stop STT when panel closes -----
  useEffect(() => {
    if (!session.open && recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
      setListening(false)
    }
  }, [session.open])

  // ----- 9. Proactive greeting -----
  useEffect(() => {
    if (!session.open || !status) return
    if (session.messages.length > 0 || session.greetingShown) return
    const hour = new Date().getHours()
    const timeOfDay = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'
    const roleGreeting = isAdmin
      ? `${timeOfDay}! Я Агент 999 — ваш деловой помощник. Могу показать аналитику, помочь с контентом, найти заказы или клиентов.`
      : `${timeOfDay}! Я Агент 999 — помогу подобрать товар, оформить заказ или отвечу на вопросы. Что вас интересует?`
    const ctxHint = context === 'catalog'
      ? ' Вижу, вы в каталоге — могу показать популярные товары или подобрать по бюджету.'
      : context === 'cart'
        ? ' У вас есть товары в корзине — могу помочь оформить заказ.'
        : context === 'orders'
          ? ' Могу проверить статус вашего заказа.'
          : ''
    const greeting = (status.greeting || roleGreeting) + ctxHint
    session.addMessage({
      id: `greeting-${Date.now()}`,
      role: 'assistant',
      content: greeting,
      ts: Date.now(),
    })
    session.setGreetingShown(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.open, status, context, isAdmin])

  // ----- 10. Handle send -----
  const handleSend = useCallback(async (messageText?: string) => {
    const text = (messageText ?? input).trim()
    if (!text || loading) return
    setInput('')
    setError(null)
    setInterimText('')

    const userMsg: AIMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      images: pendingImages.length ? pendingImages : undefined,
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
    const imagesToSend = pendingImages
    setPendingImages([])

    try {
      let convId = session.conversationId
      if (!convId && user) {
        try {
          const r = await api.post<{ conversation: { id: string } }>('/api/ai/conversations', {
            json: { title: 'Новый диалог', context: context || undefined },
            auth: true,
          })
          convId = r.conversation.id
          session.setConversationId(convId)
        } catch { /* non-critical */ }
      }

      const r = await api.post<ChatResponse>('/api/ai/chat', {
        json: {
          message: text,
          context,
          images: imagesToSend.length ? imagesToSend : undefined,
          conversationId: convId || undefined,
          history: session.messages
            .slice(-10)
            .filter((m) => m.id !== placeholderId && m.id !== userMsg.id)
            .map((m) => ({
              role: m.role,
              content: m.content,
            })),
        },
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
      if (session.mode === 'voice' && session.autoSpeak && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        speak(r.reply)
      }
    } catch (e: any) {
      session.updateLastAssistantMessage({
        id: placeholderId,
        content: 'Извините, не удалось получить ответ. Попробуйте ещё раз.',
      })
      setError(e?.message || 'Не удалось получить ответ. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }, [input, loading, context, session, pendingImages, user])

  // ----- 11. Image upload -----
  const handleUploadImage = useCallback(async (file: File) => {
    if (uploading || pendingImages.length >= 4) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const token = useAuthStore.getState().token
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!resp.ok) throw new Error('Upload failed')
      const data = await resp.json()
      if (data?.url) {
        setPendingImages((arr) => [...arr, data.url])
      }
    } catch (e: any) {
      setError('Не удалось загрузить изображение')
    } finally {
      setUploading(false)
    }
  }, [uploading, pendingImages.length])

  // ----- 12. Voice input (STT) -----
  const startListening = useCallback(() => {
    if (!speechSupported) {
      setError('Голосовой ввод не поддерживается этим браузером')
      return
    }
    if (listening) {
      try { recognitionRef.current?.stop() } catch {}
      recognitionRef.current = null
      setListening(false)
      return
    }
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
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
        setInput((prev) => (prev ? prev + ' ' : '') + final.trim())
        setInterimText('')
      }
    }
    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        setError('Нет доступа к микрофону. Разрешите доступ в настройках браузера.')
      } else if (e?.error !== 'no-speech' && e?.error !== 'aborted') {
        setError('Ошибка распознавания речи: ' + (e?.error || 'unknown'))
      }
      setListening(false)
      recognitionRef.current = null
    }
    rec.onend = () => {
      setListening(false)
      recognitionRef.current = null
      setInterimText('')
    }
    rec.start()
    recognitionRef.current = rec
    setListening(true)
    setError(null)
  }, [speechSupported, listening])

  // ----- 13. Voice output (TTS via Web Speech API) -----
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
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
    utter.onend = () => setSpeaking(false)
    utter.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utter)
  }, [])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [])

  // ----- 14. Load conversation history from server -----
  const loadConversations = useCallback(async () => {
    if (!user) return
    try {
      const r = await api.get<{ conversations: Conversation[] }>('/api/ai/conversations', { auth: true })
      setConversations(r.conversations || [])
    } catch {/* non-critical */}
  }, [user])

  const openConversation = useCallback(async (convId: string) => {
    try {
      const r = await api.get<{ conversation: { messages: any[] } }>(`/api/ai/conversations/${convId}`, { auth: true })
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
    } catch (e: any) {
      setError('Не удалось загрузить разговор')
    }
  }, [session, user])

  const deleteConversation = useCallback(async (convId: string) => {
    try {
      await api.delete(`/api/ai/conversations/${convId}`, { auth: true })
      setConversations((arr) => arr.filter((c) => c.id !== convId))
      if (session.conversationId === convId) {
        session.clearMessages()
      }
    } catch {}
  }, [session])

  const togglePin = useCallback(async (convId: string, pinned: boolean) => {
    try {
      await api.patch(`/api/ai/conversations/${convId}`, { json: { pinned: !pinned }, auth: true })
      setConversations((arr) => arr.map((c) => (c.id === convId ? { ...c, pinned: !pinned } : c)))
    } catch {}
  }, [])

  // ----- 15. Render -----
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
    <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border/60 bg-card/80 backdrop-blur-xl shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative h-9 w-9 shrink-0">
          <div className={cn(
            'absolute inset-0 rounded-xl grid place-items-center shadow-glow transition-all',
            listening
              ? 'bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 animate-pulse'
              : speaking
                ? 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500'
                : 'bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500',
          )}>
            <Sparkles className="h-4 w-4 text-white" />
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-base leading-tight truncate text-foreground">
            {status?.assistantName || 'Агент 999'}
          </h2>
          <p className="text-xs text-muted-foreground leading-tight truncate">
            {listening ? 'Слушаю…' : speaking ? 'Говорю…' : loading ? 'Думаю…' : status?.configured ? 'Готов помочь' : 'Загрузка…'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => session.setMode(isVoiceMode ? 'text' : 'voice')}
          className={cn(
            'h-9 w-9 grid place-items-center rounded-full transition-colors',
            isVoiceMode
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent text-muted-foreground',
          )}
          title={isVoiceMode ? 'Текстовый режим' : 'Голосовой режим'}
        >
          {isVoiceMode ? <Keyboard className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          onClick={() => { setShowHistory((v) => !v); if (!showHistory) loadConversations() }}
          className={cn(
            'h-9 w-9 grid place-items-center rounded-full transition-colors',
            showHistory ? 'bg-accent text-foreground' : 'hover:bg-accent text-muted-foreground',
          )}
          title="История"
        >
          <History className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            const next = !session.enabled
            session.setEnabled(next)
            if (!next) {
              session.setOpen(false)
              stopSpeaking()
              try { recognitionRef.current?.stop() } catch {}
            }
          }}
          className={cn(
            'h-9 w-9 grid place-items-center rounded-full transition-colors',
            session.enabled
              ? 'text-emerald-500 hover:bg-accent'
              : 'text-muted-foreground bg-muted hover:bg-accent',
          )}
          title={session.enabled ? 'AI включен' : 'AI выключен'}
        >
          <Power className="h-4 w-4" />
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

  const renderLanding = () => (
    <div className="flex flex-col items-center justify-center min-h-full text-center px-4 sm:px-6 py-8 overflow-y-auto">
      <div className="relative w-full max-w-md mb-6">
        <div className="aspect-[4/3] rounded-3xl overflow-hidden bg-gradient-to-br from-violet-500/10 via-fuchsia-500/10 to-indigo-500/10 border border-border/40 bg-card relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={showcaseIdx}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="absolute inset-0 flex flex-col items-center justify-center p-6"
            >
              {showcase[showcaseIdx]?.image ? (
                <img
                  src={showcase[showcaseIdx].image}
                  alt={showcase[showcaseIdx].title}
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 via-violet-500/20 to-fuchsia-500/20" />
              )}
              <div className="relative z-10 mt-auto w-full">
                <div className="text-sm text-white/90 mb-1 drop-shadow-lg">{showcase[showcaseIdx]?.price}</div>
                <div className="text-lg font-bold text-white drop-shadow-lg">{showcase[showcaseIdx]?.title}</div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="absolute -top-6 left-1/2 -translate-x-1/2">
          <div className={cn(
            'h-12 w-12 rounded-full grid place-items-center shadow-glow border-2 border-background',
            listening
              ? 'bg-gradient-to-br from-rose-500 to-pink-500 animate-pulse'
              : speaking
                ? 'bg-gradient-to-br from-amber-500 to-orange-500'
                : 'bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500',
          )}>
            <Sparkles className="h-5 w-5 text-white" />
          </div>
        </div>
        <div className="flex justify-center gap-1.5 mt-3">
          {showcase.slice(0, 6).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === showcaseIdx ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/40',
              )}
            />
          ))}
        </div>
      </div>

      <h3 className="text-xl font-bold mb-1 text-foreground">
        {status?.assistantName || 'Агент 999'}
      </h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        {isAdmin
          ? 'Ваш деловой помощник — аналитика, заказы, клиенты и контент.'
          : 'Помогу подобрать товар, оформить заказ или ответить на вопросы.'}
      </p>

      <div className="grid gap-2 w-full max-w-md">
        {examplePrompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => handleSend(prompt)}
            className="text-left px-4 py-3 rounded-xl bg-muted/40 hover:bg-accent border border-border/40 text-sm text-foreground transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )

  // v25.9.2: render a PRODUCT FEED card — horizontal scroll of product cards
  // for assistant messages that contain product/similar_products cards.
  // Clicking a card opens the real product page via onOpenProduct.
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
        <div className="flex gap-3 overflow-x-auto pb-2 px-1 snap-x snap-mandatory scroll-smooth" style={{ scrollbarWidth: 'thin' }}>
          {items.map((p: any, idx: number) => (
            <button
              key={p.id || idx}
              onClick={() => {
                // v25.9.2: dispatch a global event so the main app opens the
                // product as an overlay (works from both popup and /ai route).
                // The main app's page.tsx listens for '999pro:open-product'
                // and calls openProductOverlay(id). This avoids the need to
                // pass onOpenProduct through every layer.
                if (p.id && typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('999pro:open-product', {
                    detail: { productId: p.id },
                  }))
                }
                // Also call the prop if provided (for AppShell-mounted mode).
                if (p.id && onOpenProductProp) {
                  onOpenProductProp(p.id)
                }
              }}
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

  const renderMessage = (msg: AIMessage, i: number) => {
    if (msg.role === 'user') {
      return (
        <div key={msg.id || i} className="flex justify-end">
          <div className="max-w-[85%] space-y-1">
            {msg.images && msg.images.length > 0 && (
              <div className="flex gap-1.5 justify-end">
                {msg.images.map((url, idx) => (
                  <img key={idx} src={url} alt="" className="h-20 w-20 rounded-xl object-cover border border-border/60" />
                ))}
              </div>
            )}
            <div className="rounded-2xl rounded-br-md px-4 py-2.5 text-sm bg-primary text-primary-foreground">
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          </div>
        </div>
      )
    }
    const isPlaceholder = !msg.content && loading
    return (
      <div key={msg.id || i} className="flex justify-start group">
        <div className="max-w-[92%] rounded-2xl rounded-bl-md px-4 py-3 text-sm bg-card border border-border/60 space-y-2 shadow-sm">
          {isPlaceholder ? (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Думаю…</span>
            </div>
          ) : (
            <>
              {/* v25.9.2: AI text uses text-foreground so it's readable in BOTH
                  light and dark themes. Previously used text-white which was
                  invisible on the light theme. */}
              <div className="text-foreground">
                <AIResponseRenderer text={msg.content} />
              </div>
              {/* v25.9.2: PRODUCT FEED — horizontal scroll of product cards.
                  Replaces the old 2-col grid. Cards are tappable and open
                  the real product page via onOpenProduct. */}
              {msg.cards && msg.cards.length > 0 && renderProductFeed(msg.cards)}
              {msg.actions && msg.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {msg.actions.map((a, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        if (a.type === 'navigate' || a.type === 'open_catalog' || a.type === 'open_cart' || a.type === 'open_checkout' || a.type === 'open_orders' || a.type === 'open_chat' || a.type === 'open_support') {
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
                  onClick={() => speaking ? stopSpeaking() : speak(msg.content)}
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
      className={cn(
        'flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-4 space-y-4',
        'ai-chat-scroll',
      )}
      style={{
        // Ensure the container itself is scrollable — fixes "no scroll" bug.
        minHeight: 0,
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {!hasMessages ? renderLanding() : (
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
                <button onClick={() => setError(null)} className="ml-1 hover:underline text-xs">OK</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  const renderComposer = () => (
    <div className="px-3 sm:px-4 py-3 border-t border-border/60 bg-card/80 backdrop-blur-xl shrink-0">
      {pendingImages.length > 0 && (
        <div className="flex gap-1.5 mb-2">
          {pendingImages.map((url, i) => (
            <div key={i} className="relative">
              <img src={url} alt="" className="h-14 w-14 rounded-lg object-cover border border-border/60" />
              <button
                onClick={() => setPendingImages((arr) => arr.filter((_, idx) => idx !== i))}
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground grid place-items-center text-xs"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
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
            <span className="text-xs text-muted-foreground">Нажмите 🎤 чтобы говорить</span>
          )}
        </div>
      )}
      {interimText && (
        <div className="mb-2 text-xs text-muted-foreground italic px-2">{interimText}</div>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSend() }}
        className="flex items-center gap-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files
            if (!files) return
            for (const f of Array.from(files).slice(0, 4 - pendingImages.length)) {
              handleUploadImage(f)
            }
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || pendingImages.length >= 4}
          className="h-11 w-11 shrink-0 rounded-full grid place-items-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors bg-card border border-border/60"
          title="Загрузить изображение — найти похожие товары"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        </button>
        {isVoiceMode && (
          <button
            type="button"
            onClick={startListening}
            disabled={!speechSupported}
            className={cn(
              'h-11 w-11 shrink-0 rounded-full grid place-items-center transition-colors',
              listening
                ? 'bg-rose-500 text-white animate-pulse'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
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
          className="flex-1 h-11 px-4 rounded-full bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || (!input.trim() && pendingImages.length === 0)}
          className="h-11 w-11 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card/80 backdrop-blur-xl">
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
                      const r = await api.post<{ conversation: { id: string } }>('/api/ai/conversations', {
                        json: { title: 'Новый диалог', context: context || undefined },
                        auth: true,
                      })
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
          <div className="flex-1 overflow-y-auto py-2 ai-chat-scroll">
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
                      {new Date(c.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      {' · '}
                      {c.messageCount} сообщ.
                    </div>
                  </div>
                  {/* v25.9.2: DELETE + PIN buttons — visible on hover. The user
                      explicitly asked for the ability to delete conversations. */}
                  <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(c.id, c.pinned) }}
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
                      <Trash2 className="h-3 w-3" />
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

  return (
    <AnimatePresence>
      {session.open && session.enabled && (
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
            // v25.9.2: full-screen on mobile, near-full-screen on desktop.
            // Previously was h-[90vh] sm:h-[80vh] which felt cramped.
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
    </AnimatePresence>
  )
}

// ============================================================================
//  Helpers
// ============================================================================
function safeParse(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}
