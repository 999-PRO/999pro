'use client'

// ============================================================================
//  v8 STUDIO AI ASSISTANT
//  Встроенный AI-помощник для редакторов контента (товары, Stories).
//  Принимает контекст редактируемой карточки и позволяет:
//    • Задавать вопросы про текущий контент
//    • Получать предложения по улучшению полей
//    • Применять предложения одной кнопкой ("✓ Применить")
//
//  Props:
//    • type: 'product' | 'story'
//    • getData: () => any — функция для получения текущих данных карточки
//    • onApply: (field, value) => void — колбэк применения suggestion
//    • title: string — что редактируем (для шапки)
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, X, Send, Loader2, Check, Wand2, MessageSquare,
  Type, FileText, Tag, Settings, Search, Mic, MousePointerClick,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type StudioContextType = 'product' | 'story' | 'banner' | 'hero' | 'club' | 'registration' | 'user' | 'bonus' | 'audit' | 'communication' | 'security' | 'delivery' | 'promo' | 'info-page' | 'moderation'

interface StudioSuggestion {
  field: string
  value: string
  label: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  suggestions?: StudioSuggestion[]
  applied?: Set<string> // Какие suggestions уже применены (по field)
  ts: number
}

interface StudioAIAssistantProps {
  type: StudioContextType
  getData: () => any
  onApply: (field: string, value: string) => void
  title?: string
}

// ---- Quick prompts (presets) — типовые вопросы для каждой карточки -----------
const PRESETS: Record<StudioContextType, Array<{ label: string; prompt: string; icon: any }>> = {
  product: [
    { label: 'Продающее название',  prompt: 'Предложи более продающее и SEO-оптимизированное название для этого товара. Учти ключевые слова.',                 icon: Type },
    { label: 'Описание',            prompt: 'Напиши продающее описание для этого товара — подчеркни выгоды, ключевые характеристики и призыв к действию.',     icon: FileText },
    { label: 'SEO',                 prompt: 'Сделай SEO: подбери мета-заголовок (≤60 символов), мета-описание (≤160 символов) и ключевые слова для этого товара.', icon: Search },
    { label: 'Характеристики',      prompt: 'Подбери ключевые характеристики для этого товара в виде списка через запятую.',                                    icon: Settings },
    { label: 'Что улучшить?',       prompt: 'Проанализируй текущее наполнение товара и скажи, что можно улучшить. Дай конкретные предложения по полям.',        icon: Wand2 },
  ],
  story: [
    { label: 'Привлекающее название', prompt: 'Предложи привлекающее внимание название для этой Story.',                                                                  icon: Type },
    { label: 'Описание',              prompt: 'Напиши краткое и цепляющее описание для этой Story.',                                                                       icon: FileText },
    { label: 'Что улучшить?',         prompt: 'Что можно улучшить в этой Story? Дай конкретные предложения по названию и описанию.',                                       icon: Wand2 },
  ],
  // v24.3: banner presets
  banner: [
    { label: 'Продающий заголовок',  prompt: 'Предложи цепляющий заголовок для этого баннера — короткий, яркий, привлекающий внимание.',                                icon: Type },
    { label: 'Подзаголовок',         prompt: 'Напиши подзаголовок для этого баннера — дополни заголовок и объясни выгоду или предложение.',                              icon: FileText },
    { label: 'Текст кнопки (CTA)',   prompt: 'Предложи короткий и побуждающий текст для кнопки баннера (2-4 слова).',                                                   icon: MousePointerClick },
    { label: 'Что улучшить?',        prompt: 'Проанализируй текущий баннер и скажи, что можно улучшить в заголовке, подзаголовке и кнопке.',                              icon: Wand2 },
  ],
  // v24.3: hero block presets
  hero: [
    { label: 'Заголовок',            prompt: 'Предложи мощный заголовок для главного блока страницы — короткий, впечатляющий, передающий главную ценность.',            icon: Type },
    { label: 'Описание',             prompt: 'Напиши описание для hero-блока — 1-2 предложения, которые раскрывают заголовок и подталкивают к действию.',                 icon: FileText },
    { label: 'Бейдж',                prompt: 'Предложи короткий бейдж (1-3 слова) для hero-блока — например “Новинка”, “Хит”, “Скидка 50%”.',                            icon: Tag },
    { label: 'Тексты кнопок',        prompt: 'Предложи тексты для обеих кнопок hero-блока — главная (действие) и вторая (дополнительно).',                                icon: MousePointerClick },
    { label: 'Что улучшить?',        prompt: 'Проанализируй текущий hero-блок и скажи, что можно улучшить.',                                                              icon: Wand2 },
  ],
  // v24.5: AI presets for ALL studio sections
  club: [
    { label: 'Описание клуба',     prompt: 'Напиши привлекательное описание программы лояльности — какие выгоды получает участник.', icon: FileText },
    { label: 'Условия',            prompt: 'Сформулируй понятные условия участия в клубе — как заработать баллы, как потратить.', icon: FileText },
    { label: 'Что улучшить?',      prompt: 'Проанализируй текущие настройки клуба и предложи улучшения.', icon: Wand2 },
  ],
  registration: [
    { label: 'Описание',           prompt: 'Напиши понятное описание процесса регистрации для новых пользователей.', icon: FileText },
    { label: 'Что улучшить?',      prompt: 'Проанализируй настройки регистрации и предложи улучшения.', icon: Wand2 },
  ],
  user: [
    { label: 'Заметка о пользователе', prompt: 'Предложи заметку об этом пользователе для внутреннего использования.', icon: FileText },
    { label: 'Анализ',             prompt: 'Проанализируй данные пользователя и дай рекомендации по работе с ним.', icon: Wand2 },
  ],
  bonus: [
    { label: 'Название акции',     prompt: 'Предложи цепляющее название для бонусной акции.', icon: Type },
    { label: 'Описание',           prompt: 'Напиши продающее описание бонусной акции.', icon: FileText },
    { label: 'Что улучшить?',      prompt: 'Проанализируй текущую акцию и предложи улучшения.', icon: Wand2 },
  ],
  audit: [
    { label: 'Анализ журнала',     prompt: 'Проанализируй последние записи журнала и выдели подозрительные действия.', icon: Wand2 },
    { label: 'Сводка',             prompt: 'Дай сводку активности администраторов за последнее время.', icon: FileText },
  ],
  communication: [
    { label: 'Описание',           prompt: 'Напиши понятное описание настроек общения.', icon: FileText },
    { label: 'Что улучшить?',      prompt: 'Проанализируй настройки общения и предложи улучшения.', icon: Wand2 },
  ],
  security: [
    { label: 'Анализ безопасности', prompt: 'Проанализируй текущие настройки безопасности и предложи усиления.', icon: Wand2 },
    { label: 'Рекомендации',        prompt: 'Дай рекомендации по повышению безопасности приложения.', icon: FileText },
  ],
  delivery: [
    { label: 'Описание зон',       prompt: 'Напиши понятное описание зон доставки.', icon: FileText },
    { label: 'Что улучшить?',      prompt: 'Проанализируй настройки доставки и предложи улучшения.', icon: Wand2 },
  ],
  promo: [
    { label: 'Название',           prompt: 'Предложи цепляющее название для промокода.', icon: Type },
    { label: 'Описание',           prompt: 'Напиши продающее описание промокода.', icon: FileText },
    { label: 'Код',                prompt: 'Предложи короткий запоминающийся промокод (латиница, цифры).', icon: Tag },
  ],
  'info-page': [
    { label: 'Заголовок',          prompt: 'Предложи заголовок для инфо-страницы.', icon: Type },
    { label: 'Контент',            prompt: 'Напиши структурированный контент для инфо-страницы.', icon: FileText },
    { label: 'Что улучшить?',      prompt: 'Проанализируй текущий контент и предложи улучшения.', icon: Wand2 },
  ],
  moderation: [
    { label: 'Анализ контента',    prompt: 'Проанализируй контент на модерации и дай рекомендации.', icon: Wand2 },
    { label: 'Правила',            prompt: 'Сформулируй правила модерации для администраторов.', icon: FileText },
  ],
}

const FIELD_ICONS: Record<string, any> = {
  title:          Type,
  description:    FileText,
  category:       Tag,
  specs:          Settings,
  seoTitle:       Search,
  seoDescription: Search,
  seoKeywords:    Search,
  // v24.3: banner + hero field icons
  subtitle:            FileText,
  cta:                 MousePointerClick,
  badge:               Tag,
  primaryButtonText:   MousePointerClick,
  secondaryButtonText: MousePointerClick,
}

export function StudioAIAssistant({ type, getData, onApply, title }: StudioAIAssistantProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  // v9: динамический статус AI
  const [dynamicStatus, setDynamicStatus] = useState<string>('')
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // v13: голосовой ввод (Web Speech API) — тот же паттерн что в main app
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)

  // v14: голосовой ввод — исправлено дублирование текста.
  // Раньше interim results накапливались в input через `prev + interimText`,
  // что приводило к дублированию (interim приходит многократно с одним текстом).
  // Теперь: baseTextRef хранит текст ДО начала записи, interim показывается
  // как baseText + interim (без накопления), final — добавляется к baseText.
  const baseTextRef = useRef('')

  const stopListening = useCallback(() => {
    if (recRef.current) {
      try {
        recRef.current.onresult = null
        recRef.current.onerror = null
        recRef.current.onend = null
        recRef.current.stop?.()
      } catch {}
      recRef.current = null
    }
    setListening(false)
  }, [])

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return
    if (listening) {
      stopListening()
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      alert('Голосовой ввод не поддерживается. Используйте Chrome, Edge или Safari.')
      return
    }
    const rec = new SR()
    rec.lang = 'ru-RU'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    // Сохраняем текст который уже в поле — будем дополнять его
    baseTextRef.current = input
    rec.onstart = () => setListening(true)
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    rec.onresult = (e: any) => {
      // v24.5: SIMPLIFIED — rebuild the ENTIRE text from ALL results every time.
      // Previous approach used e.resultIndex + interimRef accumulation which
      // caused text duplication (interim text was not cleared properly when
      // a new final result arrived). Now: loop from 0, collect all final +
      // all interim, concatenate with baseTextRef. This is O(n) per event but
      // n is tiny (<20 segments) and guarantees no duplication.
      let finalText = ''
      let interimText = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const t = r[0].transcript.trim()
          if (t) finalText += t + ' '
        } else {
          interimText += r[0].transcript
        }
      }
      // Display = text before recording started + all finalized segments + current interim
      const base = baseTextRef.current
      const separator = base && !base.endsWith(' ') ? ' ' : ''
      const display = (base + separator + finalText + interimText).trim()
      setInput(display)
    }
    recRef.current = rec
    try { rec.start() } catch {}
  }, [listening, stopListening, input])

  // Cleanup при размонтировании
  useEffect(() => {
    return () => stopListening()
  }, [stopListening])

  // Сохраняем историю в localStorage чтобы не терялась между открытиями
  const STORAGE_KEY = `999pro-studio-ai-${type}`

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[]
        // Восстанавливаем Set (он сериализуется как [])
        setMessages(parsed.map(m => ({ ...m, applied: new Set(m.applied || []) })))
      }
    } catch {}
  }, [STORAGE_KEY])

  useEffect(() => {
    if (messages.length === 0) return
    try {
      // Сохраняем без applied (Set не сериализуется) — добавим пустым
      const toSave = messages.map(m => ({ ...m, applied: Array.from(m.applied || []) }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    } catch {}
  }, [messages, STORAGE_KEY])

  // v15: Auto-scroll to bottom on new message — улучшено.
  // Добавлен двойной RAF для надёжности + повтор через 100мс (на случай
  // если контент ещё рендерится). Также скроллим при изменении dynamicStatus.
  useEffect(() => {
    if (!scrollRef.current) return
    const scrollToBottom = () => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    }
    requestAnimationFrame(() => {
      scrollToBottom()
      // Повтор через 100мс — на случай если контент ещё рендерится
      setTimeout(scrollToBottom, 100)
    })
  }, [messages, sending, dynamicStatus])

  // v9: запуск/остановка динамического статуса
  const startDynamicStatus = useCallback((message: string) => {
    const m = (message || '').toLowerCase()
    let pool: string[]
    if (/цен|стоим|seo|ключев|описан|назван/.test(m)) {
      pool = ['Готовлю SEO...', 'Подбираю ключевые слова...', 'Анализирую карточку...']
    } else if (/улучш|анализ|проверь|посоветуй/.test(m)) {
      pool = ['Анализирую карточку...', 'Готовлю рекомендации...', 'Проверяю поля...']
    } else {
      pool = ['Думаю...', 'Анализирую...', 'Готовлю ответ...']
    }
    setDynamicStatus(pool[0])
    let idx = 0
    if (statusTimerRef.current) clearInterval(statusTimerRef.current)
    statusTimerRef.current = setInterval(() => {
      idx = (idx + 1) % pool.length
      setDynamicStatus(pool[idx])
    }, 1800)
  }, [])

  const stopDynamicStatus = useCallback(() => {
    if (statusTimerRef.current) {
      clearInterval(statusTimerRef.current)
      statusTimerRef.current = null
    }
    setDynamicStatus('')
  }, [])

  // v9: cleanup при размонтировании
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearInterval(statusTimerRef.current)
    }
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return
    // v13: останавливаем прослушивание при отправке
    stopListening()
    const userMsg: ChatMessage = { role: 'user', content: text, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSending(true)
    // v9: запускаем динамический статус
    startDynamicStatus(text)

    try {
      // Получаем свежие данные карточки на момент отправки
      const data = getData()
      // История для AI — последние 4 сообщения (v8 audit: -8 → -4 anti-duplication)
      const history = messages.slice(-4).map(m => ({ role: m.role, content: m.content }))

      const res = await api.post<{
        reply: string
        suggestions: StudioSuggestion[]
        provider: string
        model: string
        handled: boolean
      }>('/api/ai/studio/chat', {
        json: { message: text, type, data, history },
        auth: true,
      })

      const aiMsg: ChatMessage = {
        role: 'assistant',
        content: res.reply || (res.handled ? 'Готово.' : 'AI не настроен. Добавьте провайдер в Studio → AI API или задайте DEEPSEEK_API_KEY в .env.'),
        suggestions: res.suggestions || [],
        applied: new Set(),
        ts: Date.now(),
      }
      setMessages(prev => [...prev, aiMsg])
    } catch (err: any) {
      // v9: понятные сообщения об ошибках
      let errorText = err?.message || 'не удалось связаться с сервером'
      if (err?.status === 401) {
        errorText = 'Агент 999 доступен только администраторам. Войдите в Studio с правами admin/manager.'
      } else if (err?.status === 429) {
        errorText = 'Слишком много запросов к AI. Подождите минуту и попробуйте снова.'
      } else if (err?.status === 503 || /network|fetch|Failed to fetch/i.test(errorText)) {
        errorText = 'Сервис AI временно недоступен. Проверьте подключение к интернету и попробуйте позже.'
      }
      const aiMsg: ChatMessage = {
        role: 'assistant',
        content: `Ошибка: ${errorText}`,
        applied: new Set(),
        ts: Date.now(),
      }
      setMessages(prev => [...prev, aiMsg])
    } finally {
      setSending(false)
      // v9: останавливаем динамический статус
      stopDynamicStatus()
    }
  }, [sending, messages, getData, type, startDynamicStatus, stopDynamicStatus])

  const handleApply = useCallback((msgIndex: number, suggestion: StudioSuggestion) => {
    onApply(suggestion.field, suggestion.value)
    // Помечаем suggestion как применённый
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIndex) return m
      const newApplied = new Set(m.applied || [])
      newApplied.add(suggestion.field)
      return { ...m, applied: newApplied }
    }))
  }, [onApply])

  const handleClear = useCallback(() => {
    if (!confirm('Очистить историю диалога с AI?')) return
    setMessages([])
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }, [STORAGE_KEY])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const presets = PRESETS[type] || []
  // v24.5: labels for ALL studio section types
  const TYPE_LABELS: Record<StudioContextType, string> = {
    product: 'Товар',
    story: 'Story',
    banner: 'Баннер',
    hero: 'Hero блок',
    club: 'CLUB',
    registration: 'Регистрация',
    user: 'Пользователь',
    bonus: 'Бонусы',
    audit: 'Журнал',
    communication: 'Общение',
    security: 'Безопасность',
    delivery: 'Доставка',
    promo: 'Промокоды',
    'info-page': 'Инфо-страница',
    moderation: 'Модерация',
  }
  const headerLabel = title || TYPE_LABELS[type] || type

  // v11: Portal — рендерим FAB и drawer в document.body, а НЕ внутри Dialog.
  // Раньше StudioAIAssistant монтировался внутри <Dialog> как сиблинг DialogContent.
  // Когда пользователь кликал на FAB, клик "всплывал" к Dialog root, который
  // видел клик вне DialogContent и закрывал карточку товара.
  // Portal выносит DOM-узел наружу — Dialog больше не перехватывает клики.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // v16: авто-фокус на input при открытии drawer
  useEffect(() => {
    if (open && inputRef.current) {
      // Небольшая задержка чтобы DOM успел отрисоваться
      const t = setTimeout(() => {
        inputRef.current?.focus()
      }, 300)
      return () => clearTimeout(t)
    }
  }, [open])

  if (!mounted || typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* v12: КРИТИЧЕСКИ ВАЖНО — FAB должен работать поверх Radix Dialog.
          Radix Dialog overlay имеет pointer-events: auto и z-[50].
          FAB рендерится в document.body через Portal, но Dialog overlay
          всё равно перехватывает pointer events если z-index FAB ниже.

          Решение:
          1. z-[9999] — выше любого Dialog overlay
          2. pointerEvents: 'auto' явно — не наследует none от родителя
          3. stopPropagation на pointerdown/mousedown/click — чтобы Dialog
             не получил событие и не закрылся
          4. position: fixed — не зависит от layout родителя
          */}
      <motion.button
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.5, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 320, damping: 18 }}
        aria-label="✨ Агент 999"
        title="✨ Агент 999"
        className="fixed z-[9999] right-4 grid place-items-center overflow-visible select-none cursor-pointer"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom) + 24px)',
          height: 58,
          width: 58,
          borderRadius: 999,
          pointerEvents: 'auto',
          isolation: 'isolate',
        }}
      >
        {/* Glow — мягкое свечение вокруг кнопки */}
        <motion.span
          className="absolute inset-0 rounded-full blur-xl pointer-events-none"
          animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.1, 1] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background: 'radial-gradient(circle, rgba(139,92,246,0.45) 0%, rgba(99,102,241,0.25) 40%, transparent 70%)',
          }}
        />
        {/* Light mode glass body */}
        <span
          className="absolute inset-0 rounded-full backdrop-blur-2xl border border-white/30 dark:border-white/20"
          style={{
            background: 'rgba(255, 255, 255, 0.12)',
            boxShadow:
              'inset 0 2px 4px rgba(255,255,255,0.3), ' +
              'inset 0 -2px 6px rgba(0,0,0,0.15), ' +
              '0 8px 24px -6px rgba(99,102,241,0.4)',
          }}
        />
        {/* Dark mode glass body */}
        <span
          className="hidden dark:block absolute inset-0 rounded-full backdrop-blur-2xl border border-white/20"
          style={{
            background: 'rgba(30, 41, 59, 0.5)',
            boxShadow:
              'inset 0 2px 4px rgba(255,255,255,0.15), ' +
              'inset 0 -2px 6px rgba(0,0,0,0.4), ' +
              '0 8px 24px -6px rgba(139,92,246,0.5)',
          }}
        />
        {/* Highlight — верхний блик */}
        <span
          className="absolute top-1.5 left-2.5 w-5 h-2.5 rounded-full opacity-70 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.95), transparent)' }}
        />
        {/* Animated Sparkles icon — идентично main app */}
        <motion.div
          animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          className="relative"
          style={{ filter: 'drop-shadow(0 0 8px rgba(139,92,246,0.6))' }}
        >
          <Sparkles className="h-6 w-6" strokeWidth={2.3} style={{ color: '#a78bfa' }} />
        </motion.div>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop — z-[10000] выше FAB (z-9999) и выше Dialog overlay.
                v24.3 BUGFIX: added onPointerDown + onTouchStart stopPropagation.
                With modal={false} on the parent Dialog (products-manager),
                Radix's DismissableLayer listens for pointerdown on document
                and closes the dialog when the pointer lands outside
                DialogContent. The AI drawer and backdrop are rendered via
                Portal in document.body, so they're "outside" DialogContent —
                meaning ANY pointerdown on them (including clicks on the input,
                scroll area, send button) was closing the product dialog,
                unmounting the AI assistant. Adding stopPropagation on
                pointerdown (not just click) prevents the event from reaching
                Radix's outside-click listener. This does NOT break focus —
                focus is acquired during pointerdown BEFORE the event bubbles,
                so the input still receives focus normally. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
              }}
              className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-sm"
              style={{ pointerEvents: 'auto' }}
            />
            {/* Drawer — z-[10001] ещё выше, справа на desktop, снизу на mobile.
                v24.3 BUGFIX: same onPointerDown + onTouchStart stopPropagation
                as the backdrop above. Without this, pointerdown on the drawer
                (scroll, input click, button tap) bubbled to document and
                triggered Radix's onPointerDownOutside → dialog closed. */}
            <motion.div
              initial={{ x: '100%', opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0.5 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="fixed z-[10001] inset-y-0 right-0 w-full sm:max-w-md md:max-w-lg lg:max-w-xl bg-background border-l border-border shadow-2xl flex flex-col"
              style={{ pointerEvents: 'auto' }}
            >
              {/* Header */}
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shrink-0">
                    <Sparkles className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">Агент 999</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      Редактируется: {headerLabel}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {messages.length > 0 && (
                    <button
                      onClick={handleClear}
                      className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      title="Очистить историю"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Закрыть"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* v16: Messages scroll area — ИСПРАВЛЕН скролл.
                  flex-1 + min-h-0 + overflow-y-auto — стандартный паттерн.
                  Добавлен height: 0 для надёжности (flexbox scroll hack).
                  touchAction: pan-y для мобильных. */}
              {/* v24.2 BUGFIX: removed inline `height: 0` (it broke flexbox scroll
                  detection — the empty-state's h-full resolved to 0 and the
                  scroll container never detected overflow). The standard
                  flex-1 + min-h-0 + overflow-y-auto pattern is sufficient.
                  Also changed the empty-state wrapper from h-full to min-h-full
                  so it can grow to fit its content and trigger overflow. */}
              <div
                ref={scrollRef}
                className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 overscroll-contain"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y',
                  overflowY: 'auto',
                }}
              >
                {/* Empty state — v11: показывает context summary чтобы пользователь
                    видел что AI уже видит текущую карточку */}
                {messages.length === 0 && !sending && (
                  <div className="flex flex-col items-center justify-center min-h-full text-center gap-4 py-8">
                    <div className="h-16 w-16 rounded-full bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 grid place-items-center">
                      <Sparkles className="h-8 w-8 text-violet-500" />
                    </div>
                    <div>
                      <div className="text-base font-semibold mb-1">Агент 999 для {headerLabel}</div>
                      <div className="text-sm text-muted-foreground max-w-xs">
                        AI уже видит текущую карточку. Задайте вопрос или выберите быстрое действие ниже.
                      </div>
                    </div>
                    {/* v11: Context summary — показывает что именно видит AI */}
                    <ContextSummary type={type} getData={getData} />
                    {/* Quick presets */}
                    <div className="flex flex-col gap-2 w-full max-w-sm mt-2">
                      {presets.map((p, i) => {
                        const Icon = p.icon
                        return (
                          <button
                            key={i}
                            onClick={() => sendMessage(p.prompt)}
                            disabled={sending}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-accent hover:bg-accent/80 border border-border text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <div className="h-8 w-8 rounded-lg bg-violet-500/10 grid place-items-center shrink-0">
                              <Icon className="h-4 w-4 text-violet-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium">{p.label}</div>
                              <div className="text-[11px] text-muted-foreground line-clamp-1">{p.prompt}</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Chat messages */}
                {messages.map((msg, i) => (
                  <MessageBubble
                    key={i}
                    message={msg}
                    onApply={(s) => handleApply(i, s)}
                  />
                ))}

                {/* Loading indicator — v9: динамический статус */}
                {sending && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-tl-md bg-accent border border-border">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                      <span className="text-sm text-muted-foreground">
                        {dynamicStatus || 'AI думает…'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* v16: Input row — ИСПРАВЛЕНА кликабельность.
                  Проблема: Radix Dialog focus trap перехватывает фокус.
                  Решение: 1) input рендерится через Portal в document.body
                          2) stopPropagation на pointer events (НЕ на focus!)
                          3) autoFocus при открытии drawer
                          4) inputMode="text" для мобильных
                          5) tabIndex={0} чтобы input был в tab order */}
              {/* v24.2 BUGFIX: removed onPointerDown/onMouseDown/onTouchStop
                  stopPropagation handlers — the developer's own comments
                  (lines 459-463) admitted these break focus on the input.
                  With modal={false} on the parent Dialog (see products-manager),
                  the focus trap is disabled and we no longer need these
                  defensive stopPropagation calls. The input now accepts text. */}
              <div className="shrink-0 border-t border-border p-3 flex items-center gap-2 bg-background">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={listening ? "Слушаю…" : "Спросите AI о карточке…"}
                  className="flex-1 h-11 px-4 rounded-full bg-accent border border-border text-sm outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20 transition-all cursor-text"
                  disabled={sending}
                  style={{ pointerEvents: 'auto', WebkitUserSelect: 'text', userSelect: 'text' }}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode="text"
                  tabIndex={0}
                />
                {/* v13: Кнопка справа — микрофон ИЛИ отправка, в зависимости от наличия текста */}
                {input.trim() ? (
                  // Есть текст → кнопка отправки
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={sending}
                    className="shrink-0 h-11 w-11 rounded-full grid place-items-center bg-gradient-to-br from-indigo-500 to-violet-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 transition-all shadow-md"
                    aria-label="Отправить"
                  >
                    {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  </button>
                ) : (
                  // Нет текста → кнопка микрофона (тот же дизайн что в main app)
                  <button
                    onClick={startListening}
                    disabled={sending}
                    className={cn(
                      'shrink-0 h-11 w-11 rounded-full grid place-items-center transition-all shadow-md relative overflow-hidden',
                      listening
                        ? 'bg-gradient-to-br from-rose-500 to-red-600 text-white'
                        : 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:scale-105'
                    )}
                    aria-label={listening ? 'Остановить запись' : 'Голосовой ввод'}
                    title={listening ? 'Остановить запись' : 'Голосовой ввод'}
                  >
                    {sending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                    {/* Pulse ring когда слушает */}
                    {listening && (
                      <motion.span
                        className="absolute inset-0 rounded-full pointer-events-none"
                        animate={{ boxShadow: ['0 0 0 0 rgba(244,63,94,0.5)', '0 0 0 10px rgba(244,63,94,0)'] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
                      />
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body
  )
}

// ============================================================================
//  MessageBubble — рендер одного сообщения (user / assistant)
// ============================================================================
function MessageBubble({
  message,
  onApply,
}: {
  message: ChatMessage
  onApply: (suggestion: StudioSuggestion) => void
}) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-br-md text-sm leading-relaxed text-white shadow-sm"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] flex flex-col gap-2 w-full">
        {/* AI avatar row */}
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shrink-0">
            <Sparkles className="h-3 w-3 text-white" />
          </div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">AI</span>
        </div>
        {/* Bubble */}
        <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-accent border border-border text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
        {/* Suggestions — карточки с кнопкой "Применить" */}
        {message.suggestions && message.suggestions.length > 0 && (
          <div className="flex flex-col gap-2 pl-1">
            {message.suggestions.map((s, si) => {
              const Icon = FIELD_ICONS[s.field] || Tag
              const applied = message.applied?.has(s.field)
              return (
                <div
                  key={si}
                  className={cn(
                    'rounded-xl border overflow-hidden transition-all',
                    applied
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-violet-500/30 bg-violet-500/5 hover:border-violet-500/50'
                  )}
                >
                  {/* Field header */}
                  <div className="flex items-center justify-between px-3 py-2 bg-violet-500/10 border-b border-violet-500/20">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="h-3.5 w-3.5 text-violet-600 shrink-0" />
                      <span className="text-xs font-semibold truncate">{s.label}</span>
                    </div>
                    <button
                      onClick={() => !applied && onApply(s)}
                      disabled={applied}
                      className={cn(
                        'shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-all',
                        applied
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 cursor-default'
                          : 'bg-violet-600 text-white hover:bg-violet-700 active:scale-95'
                      )}
                    >
                      {applied ? (
                        <>
                          <Check className="h-3 w-3" />
                          Применено
                        </>
                      ) : (
                        <>
                          <Check className="h-3 w-3" />
                          Применить
                        </>
                      )}
                    </button>
                  </div>
                  {/* Value */}
                  <div className="px-3 py-2.5 text-sm leading-relaxed">
                    {s.value}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
//  v11: ContextSummary — показывает пользователю что именно видит AI.
//  Это даёт уверенность что AI работает с правильной карточкой.
// ============================================================================
function ContextSummary({ type, getData }: { type: StudioContextType; getData: () => any }) {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    try {
      setData(getData())
    } catch {}
  }, [getData])

  if (!data) return null

  const fields: Array<{ label: string; value: string; filled: boolean }> = []
  if (type === 'product') {
    fields.push(
      { label: 'Название', value: data.title || '(пусто)', filled: !!data.title },
      { label: 'Описание', value: data.description ? `${data.description.length} симв.` : '(пусто)', filled: !!data.description },
      { label: 'Категория', value: data.category || '(не указана)', filled: !!data.category },
      { label: 'Цена', value: data.price ? `${data.price} ₽` : '(не указана)', filled: !!data.price },
      { label: 'Изображения', value: `${(data.images || []).length} шт.`, filled: (data.images || []).length > 0 },
    )
  } else if (type === 'banner') {
    // v24.3: banner context summary
    fields.push(
      { label: 'Заголовок', value: data.title || '(пусто)', filled: !!data.title },
      { label: 'Подзаголовок', value: data.subtitle || '(пусто)', filled: !!data.subtitle },
      { label: 'Кнопка', value: data.cta || '(пусто)', filled: !!data.cta },
      { label: 'Ссылка', value: data.link || '(не указана)', filled: !!data.link },
      { label: 'Изображение', value: data.image ? 'есть' : 'нет', filled: !!data.image },
    )
  } else if (type === 'hero') {
    // v24.3: hero block context summary
    fields.push(
      { label: 'Бейдж', value: data.badge || '(пусто)', filled: !!data.badge },
      { label: 'Заголовок', value: data.title || '(пусто)', filled: !!data.title },
      { label: 'Описание', value: data.description ? `${data.description.length} симв.` : '(пусто)', filled: !!data.description },
      { label: 'Кнопка 1', value: data.primaryButton?.text || data.primaryButtonText || '(пусто)', filled: !!(data.primaryButton?.text || data.primaryButtonText) },
      { label: 'Кнопка 2', value: data.secondaryButton?.text || data.secondaryButtonText || '(пусто)', filled: !!(data.secondaryButton?.text || data.secondaryButtonText) },
    )
  } else {
    fields.push(
      { label: 'Подпись', value: data.title || '(пусто)', filled: !!data.title },
      { label: 'Категория', value: data.category || '(не указана)', filled: !!data.category },
      { label: 'Изображения', value: `${(data.images || []).length} шт.`, filled: (data.images || []).length > 0 },
    )
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Check className="h-3.5 w-3.5 text-violet-600" />
        <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-400 uppercase tracking-wide">
          AI видит контекст
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {fields.map((f, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{f.label}</span>
            <span className={cn('font-medium truncate', f.filled ? 'text-foreground' : 'text-muted-foreground/60')}>
              {f.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
