'use client'

// ============================================================================
//  AI Assistant v5 — «Три девятки» Voice Agent
// ----------------------------------------------------------------------------
//  Полностью переработанный голосовой AI на основе дизайна voice search:
//    • Центральное неоновое ядро (как в voice-search-button.tsx)
//    • Те же цвета: indigo → violet → pink градиент
//    • Те же плавные волны, частицы, glow
//    • Состояния AI: Слушаю → Анализ речи → Думаю → Выполняю → Формирую ответ
//    • Логика «Вы закончили?»: после паузы 3-5 сек AI спрашивает подтверждение
//    • Прерывание ответа пользователем — AI немедленно возвращается к слушанию
//    • Полная вертикальная прокрутка длинных ответов
//    • Кнопка «Новый вопрос» скрыта во время разговора (только mic + End)
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, X, Send, Mic, MicOff, Keyboard, Loader2,
  Phone, Mail, MessageCircle, Package, Film, Music, ShoppingBag,
  HelpCircle, CheckCircle2, Plus, Star, Eye, Calculator, ChevronDown,
  AlertCircle, Volume2, VolumeX, ArrowRight,
  BrainCircuit, Wand2, MessageSquareText, AudioLines,
  Trash2,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AIResponseRenderer } from './response-renderer'
import { useScrollLock } from '@/lib/use-scroll-lock'

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------
interface ChatAction {
  type: string
  param?: string
  label: string
}
interface ChatCard {
  kind: 'product' | 'contacts' | 'order_wizard' | 'similar_products' | 'media' | 'order_result'
  data: any
}
interface AIResponse {
  id: string
  text: string
  calculation?: any
  actions?: ChatAction[]
  cards?: ChatCard[]
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

// ---------------------------------------------------------------------------
//  AI states — каждое состояние имеет свою анимацию и текст
// ---------------------------------------------------------------------------
type AIPhase =
  | 'idle'           // ожидание
  | 'listening'      // слушаю пользователя
  | 'analyzing'      // анализ речи (распознавание)
  | 'confirming'     // спрашиваю «Вы закончили?»
  | 'thinking'       // думаю (LLM обрабатывает)
  | 'acting'         // выполняю действия (tool calls)
  | 'responding'     // формирую ответ (typing animation)
  | 'asking_pause'   // задаю уточняющий вопрос голосом

const PHASE_META: Record<AIPhase, { icon: any; label: string; emoji: string; color: string }> = {
  idle:         { icon: Mic,               label: 'Нажмите и говорите',     emoji: '🎤', color: '#6366f1' },
  listening:    { icon: Mic,               label: 'Слушаю вас',             emoji: '🎤', color: '#3b82f6' },
  analyzing:    { icon: AudioLines,        label: 'Анализирую речь',        emoji: '📝', color: '#8b5cf6' },
  confirming:   { icon: MessageSquareText, label: 'Уточняю',                emoji: '💬', color: '#a855f7' },
  thinking:     { icon: BrainCircuit,      label: 'Думаю',                  emoji: '🧠', color: '#8b5cf6' },
  acting:       { icon: Wand2,             label: 'Выполняю действие',      emoji: '⚡', color: '#ec4899' },
  responding:   { icon: MessageSquareText, label: 'Отвечаю',                emoji: '💬', color: '#a78bfa' },
  asking_pause: { icon: MessageSquareText, label: 'Спрашиваю',              emoji: '💬', color: '#a855f7' },
}

// ---------------------------------------------------------------------------
//  v9: Умный индикатор состояния AI — динамические статусы
//  Вместо постоянного "Думаю..." статусы ротируются в зависимости от контекста.
//  Если AI использует tools (поиск товаров/категорий) — показываем "Проверяю товары..."
//  Если AI выполняет расчёты — "Выполняю расчёт..."
//  Если AI просто генерирует ответ — "Думаю..." → "Анализирую..." → "Готовлю ответ..."
// ---------------------------------------------------------------------------
const DYNAMIC_STATUSES_THINKING = [
  'Думаю...',
  'Анализирую вопрос...',
  'Готовлю ответ...',
]
const DYNAMIC_STATUSES_DB = [
  'Проверяю товары...',
  'Проверяю категории...',
  'Проверяю Stories...',
  'Проверяю базу данных...',
  'Получаю информацию...',
]
const DYNAMIC_STATUSES_CALC = [
  'Выполняю расчёт...',
  'Считаю стоимость...',
  'Подбираю варианты...',
]

function pickStatusGroup(message: string): 'db' | 'calc' | 'thinking' {
  const m = (message || '').toLowerCase()
  // Калькуляция — цены, стоимость, расчёт
  if (/цен|стоим|расчёт|расчет|сколько стоит|подсчитай|считай|во сколько|за сколько/.test(m)) {
    return 'calc'
  }
  // БД — товары, категории, stories, баннеры, заказы, пользователи
  if (/товар|катег|stor|баннер|заказ|польз|клиент|сколько у нас|покажи|найди/.test(m)) {
    return 'db'
  }
  return 'thinking'
}

// ---------------------------------------------------------------------------
//  Voice input — Web Speech API с поддержкой continuous mode
// ---------------------------------------------------------------------------
function useVoiceInput(opts: {
  onResult: (text: string) => void
  onInterim?: (text: string) => void
  onStart?: () => void
  onEnd?: () => void
  lang?: string
  continuous?: boolean
}) {
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)
  const startingRef = useRef(false)
  // v5: фиксируем onEnd, чтобы вызывать его когда recognition завершился сам
  // (например, по таймауту браузера). Это нужно для логики «Вы закончили?».
  const onEndRef = useRef<() => void>(() => {})
  onEndRef.current = opts.onEnd || (() => {})

  const stop = useCallback(() => {
    startingRef.current = false
    if (recRef.current) {
      try {
        recRef.current.onresult = null
        recRef.current.onerror = null
        recRef.current.onend = null
        recRef.current.onstart = null
        recRef.current.abort?.()
        recRef.current.stop?.()
      } catch {}
      recRef.current = null
    }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    if (typeof window === 'undefined') return
    if (listening || startingRef.current) return
    if (recRef.current) return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      alert('Голосовой ввод не поддерживается. Используйте Chrome, Edge или Safari.')
      return
    }
    startingRef.current = true
    const rec = new SR()
    rec.lang = opts.lang || 'ru-RU'
    // v5: continuous = true — чтобы recognition не закрывался после каждой фразы.
    // Это позволяет нам самим управлять моментом «пользователь замолчал».
    rec.continuous = opts.continuous !== false
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onstart = () => {
      startingRef.current = false
      setListening(true)
      opts.onStart?.()
    }
    rec.onerror = (e: any) => {
      startingRef.current = false
      setListening(false)
      console.warn('[VoiceInput] error:', e?.error)
    }
    rec.onend = () => {
      startingRef.current = false
      setListening(false)
      // v24.3 BUGFIX: clear recRef.current so subsequent start() calls can
      // instantiate a fresh SpeechRecognition. Previously, on desktop Chrome,
      // recognition.onend fired after each utterance/silence but recRef.current
      // was never cleared — so the guard `if (recRef.current) return` in
      // start() blocked the next start() call, and follow-up questions were
      // never captured. Mobile Chrome with continuous=true keeps recognition
      // alive across utterances (onend doesn't fire mid-conversation), which
      // is why mobile worked but desktop didn't.
      recRef.current = null
      // v5: браузер сам завершил recognition (timeout или no-speech).
      // Уведомляем caller, чтобы он мог решить, перезапускать или нет.
      onEndRef.current?.()
    }
    rec.onresult = (e: any) => {
      let finalText = ''
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      if (interimText) opts.onInterim?.(interimText)
      if (finalText) {
        const cleaned = finalText.trim()
        if (cleaned) opts.onResult(cleaned)
      }
    }
    recRef.current = rec
    try {
      rec.start()
    } catch (err) {
      startingRef.current = false
      console.warn('[VoiceInput] start() threw:', err)
    }
  }, [opts, listening, stop])

  useEffect(() => () => stop(), [stop])
  return { listening, start, stop }
}

// ---------------------------------------------------------------------------
//  Voice output — speechSynthesis TTS (по умолчанию выключен, но доступен)
// ---------------------------------------------------------------------------
function useVoiceOutput() {
  const [enabled, setEnabled] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try { window.speechSynthesis.cancel() } catch {}
    return () => {
      try { window.speechSynthesis.cancel() } catch {}
    }
  }, [])

  const speak = useCallback((_text: string, onEnd?: () => void) => {
    // v5: TTS по умолчанию выключен (как в v22). Сразу вызываем onEnd,
    // чтобы цикл продолжался без роботизированного голоса.
    onEnd?.()
  }, [])

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try { window.speechSynthesis.cancel() } catch {}
    setSpeaking(false)
  }, [])

  return { enabled, setEnabled, speak, stop, speaking }
}

// ---------------------------------------------------------------------------
//  Floating AI Button — premium glass + neon glow
// ---------------------------------------------------------------------------
// v14: FloatingAIButton — использует NeonCore (тот же анимированный микрофон
// что в стартовой анимации). phase='idle' для спокойного состояния.
// size='compact' для разумного размера FAB (88-96px).
function FloatingAIButton({ onClick, hidden }: { onClick: () => void; hidden: boolean }) {
  if (hidden) return null
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
      className="fixed right-4 z-50 select-none cursor-pointer"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 84px)',
      }}
    >
      <NeonCore phase="idle" onClick={onClick} size="compact" />
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
//  PREMIUM Neon Core — центральное светящееся ядро в стиле голосового поиска.
//  v6: добавлен проп `size` — 'full' (большое, центр экрана) и 'compact'
//  (уменьшенное, индикатор в верхней части во время ответа).
//  Использует ТЕ ЖЕ цвета и ТУ ЖЕ анимацию, что и voice-search-button.tsx.
// ---------------------------------------------------------------------------
function NeonCore({
  phase,
  onClick,
  size = 'full',
}: {
  phase: AIPhase
  onClick?: () => void
  size?: 'full' | 'compact'
}) {
  const meta = PHASE_META[phase]
  const color = meta.color

  // v6: размеры для full и compact режимов.
  const isCompact = size === 'compact'
  // full: 176-192px, compact: 88-96px (ровно вдвое меньше)
  const containerSize = isCompact ? 'h-22 w-22 sm:h-24 sm:w-24' : 'h-44 w-44 sm:h-48 sm:w-48'
  const coreSize = isCompact ? 'h-14 w-14' : 'h-28 w-28'
  const iconSize = isCompact ? 'h-6 w-6' : 'h-12 w-12'
  const particleRadius = isCompact ? 38 : 75
  const ringInset = isCompact ? 'inset-1.5' : 'inset-3'
  const coreInset = isCompact ? 'inset-4' : 'inset-8 sm:inset-10'

  const isListening = phase === 'listening'
  const isWorking = phase === 'thinking' || phase === 'acting' || phase === 'responding' || phase === 'analyzing'

  return (
    <motion.button
      onClick={onClick}
      className={cn('relative grid place-items-center cursor-pointer', containerSize)}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      aria-label="Микрофон"
    >
      {/* Внешний пульсирующий glow — дышит */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${color}55 0%, ${color}22 40%, transparent 70%)`,
          filter: 'blur(24px)',
        }}
        animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* ВРАЩАЮЩИЙСЯ конусный градиент — основной неоновый элемент */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, transparent 0%, rgba(99,102,241,0.4) 25%, rgba(139,92,246,0.6) 50%, rgba(236,72,153,0.4) 75%, transparent 100%)`,
          filter: 'blur(2px)',
        }}
        animate={{ rotate: 360 }}
        transition={{
          duration: phase === 'acting' ? 1.5 : phase === 'thinking' ? 2 : 3,
          repeat: Infinity,
          ease: 'linear',
        }}
      />

      {/* Внутреннее кольцо — вращается в обратную сторону */}
      <motion.div
        className={cn('absolute rounded-full', ringInset)}
        style={{
          background: `conic-gradient(from 180deg, transparent 0%, rgba(236,72,153,0.3) 30%, transparent 60%)`,
          filter: 'blur(3px)',
        }}
        animate={{ rotate: -360 }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
      />

      {/* Внешний пульсирующий glow (radar) */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
        }}
        animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0.3, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* РАСХОДЯЩИЕСЯ ВОЛНЫ — когда слушаю */}
      {isListening && [0, 1, 2].map((i) => (
        <motion.div
          key={`wave-out-${i}`}
          className="absolute inset-0 rounded-full border-2"
          style={{ borderColor: 'rgba(59,130,246,0.5)' }}
          animate={{ scale: [1, 1.7], opacity: [0.7, 0] }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: i * 0.7,
            ease: 'easeOut',
          }}
        />
      ))}

      {/* СХОДЯЩИЕСЯ ВОЛНЫ (радар) — когда анализирую речь */}
      {phase === 'analyzing' && [0, 1, 2].map((i) => (
        <motion.div
          key={`wave-in-${i}`}
          className="absolute inset-0 rounded-full border-2"
          style={{ borderColor: 'rgba(139,92,246,0.4)' }}
          animate={{ scale: [1.7, 1], opacity: [0, 0.7, 0] }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            delay: i * 0.5,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Пульсирующие кольца (как в voice-search) */}
      <motion.div
        className="absolute inset-0 rounded-full border-2"
        style={{ borderColor: 'rgba(139,92,246,0.4)' }}
        animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute inset-0 rounded-full border-2"
        style={{ borderColor: 'rgba(236,72,153,0.3)' }}
        animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      />

      {/* 6 ЧАСТИЦ — орбитируют вокруг ядра (как в voice-search) */}
      {isWorking && [0, 1, 2, 3, 4, 5].map((i) => (
        <motion.div
          key={`particle-${i}`}
          className={cn('absolute rounded-full', isCompact ? 'h-1 w-1' : 'h-1.5 w-1.5')}
          style={{
            background: i % 2 === 0 ? '#8b5cf6' : '#ec4899',
            boxShadow: `0 0 6px ${i % 2 === 0 ? 'rgba(139,92,246,0.8)' : 'rgba(236,72,153,0.8)'}`,
          }}
          animate={{
            x: [0, Math.cos((i * 60 * Math.PI) / 180) * particleRadius, 0],
            y: [0, Math.sin((i * 60 * Math.PI) / 180) * particleRadius, 0],
            opacity: [0, 1, 0],
            scale: [0.5, 1, 0.5],
          }}
          transition={{
            duration: phase === 'acting' ? 1.5 : 2,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.3,
          }}
        />
      ))}

      {/* ЦЕНТРАЛЬНОЕ СТЕКЛЯННОЕ ЯДРО — как в voice-search */}
      <motion.div
        className={cn('relative grid place-items-center rounded-full z-10', coreSize)}
        style={{
          background: `linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)`,
          boxShadow: '0 8px 40px -4px rgba(139,92,246,0.6)',
          border: '2px solid rgba(255,255,255,0.25)',
        }}
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Иконка меняется в зависимости от состояния */}
        {phase === 'listening' ? (
          <Mic className={cn('text-white', iconSize)} fill="currentColor" />
        ) : phase === 'analyzing' ? (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
            <AudioLines className={cn('text-white', iconSize)} />
          </motion.div>
        ) : phase === 'thinking' ? (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
            <BrainCircuit className={cn('text-white', iconSize)} />
          </motion.div>
        ) : phase === 'acting' ? (
          <motion.div animate={{ scale: [1, 0.9, 1.1, 1] }} transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}>
            <Wand2 className={cn('text-white', iconSize)} />
          </motion.div>
        ) : phase === 'responding' ? (
          <motion.div animate={{ scale: [1, 0.95, 1.05, 1] }} transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}>
            <MessageSquareText className={cn('text-white', iconSize)} />
          </motion.div>
        ) : phase === 'confirming' || phase === 'asking_pause' ? (
          <motion.div animate={{ scale: [1, 0.95, 1] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}>
            <Sparkles className={cn('text-white', iconSize)} />
          </motion.div>
        ) : (
          <Mic className={cn('text-white', iconSize)} />
        )}
      </motion.div>
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
//  Скан-волна (как в voice-search) — анимированная SVG-линия
// ---------------------------------------------------------------------------
function ScanWave({ active, color = '#8b5cf6' }: { active: boolean; color?: string }) {
  if (!active) return null
  return (
    <div className="relative w-56 h-10 overflow-hidden">
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 40" preserveAspectRatio="none">
        <motion.path
          d="M0,20 Q25,5 50,20 T100,20 T150,20 T200,20"
          fill="none"
          stroke="url(#scanWaveGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          animate={{
            d: [
              'M0,20 Q25,5 50,20 T100,20 T150,20 T200,20',
              'M0,20 Q25,35 50,20 T100,20 T150,20 T200,20',
              'M0,20 Q25,10 50,20 T100,20 T150,20 T200,20',
              'M0,20 Q25,5 50,20 T100,20 T150,20 T200,20',
            ],
          }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <defs>
          <linearGradient id="scanWaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
            <stop offset="50%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
//  PREMIUM Product Card (взято из v4 без изменений)
// ---------------------------------------------------------------------------
function PremiumProductCard({ product, index, onOpen }: { product: any; index: number; onOpen?: (id: string) => void }) {
  let image: string | null = null
  if (product.image) {
    image = typeof product.image === 'string' ? product.image : assetUrl(product.image)
  } else if (Array.isArray(product.images)) {
    image = product.images[0] || null
  } else if (typeof product.images === 'string') {
    try { image = JSON.parse(product.images)[0] || null } catch { image = product.images }
  }
  const price = Number(product.price) || 0
  const oldPrice = product.oldPrice ? Number(product.oldPrice) : null
  const discount = oldPrice && oldPrice > price ? Math.round(100 - (price / oldPrice) * 100) : 0
  const isAction = !!product.isAction
  const isNew = !!product.isNew
  const isPremium = !!product.isPremium || !!product.isTrending
  const inStock = product.inStock !== false

  return (
    <motion.button
      key={product.id}
      onClick={() => onOpen?.(product.id)}
      initial={{ opacity: 0, scale: 0.85, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: index * 0.12, type: 'spring', stiffness: 260, damping: 20 }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="group relative shrink-0 w-[200px] text-left rounded-3xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 8px 32px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
      }}
    >
      <div className="relative w-full aspect-[4/3] bg-black/20 overflow-hidden">
        {image ? (
          <img src={image} alt={product.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full grid place-items-center">
            <Package className="h-8 w-8 text-white/30" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {discount > 0 && <span className="px-2 py-0.5 rounded-lg bg-rose-500 text-white text-[10px] font-bold leading-none shadow-lg">−{discount}%</span>}
          {isAction && <span className="px-2 py-0.5 rounded-lg bg-red-500 text-white text-[10px] font-bold leading-none shadow-lg">АКЦИЯ</span>}
          {isNew && <span className="px-2 py-0.5 rounded-lg bg-violet-500 text-white text-[10px] font-bold leading-none shadow-lg">НОВИНКА</span>}
          {isPremium && (
            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold leading-none shadow-lg" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 50%, #f59e0b 100%)', color: '#78350f' }}>
              PREMIUM
            </span>
          )}
        </div>
        <div className="absolute top-2 right-2">
          {inStock ? (
            <span className="px-2 py-0.5 rounded-lg bg-emerald-500/90 text-white text-[10px] font-bold leading-none backdrop-blur shadow-lg">В НАЛИЧИИ</span>
          ) : (
            <span className="px-2 py-0.5 rounded-lg bg-slate-600/90 text-white text-[10px] font-bold leading-none backdrop-blur shadow-lg">НЕТ В НАЛИЧИИ</span>
          )}
        </div>
      </div>
      <div className="p-3 space-y-2">
        <h4 className="text-sm font-semibold leading-tight line-clamp-2 text-white group-hover:text-violet-300 transition-colors">
          {product.title}
        </h4>
        <div className="flex items-baseline gap-2">
          <span
            className="text-xl font-extrabold"
            style={{
              background: 'linear-gradient(135deg, #818cf8 0%, #c4b5fd 50%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {price.toLocaleString('ru-RU')} ₽
          </span>
          {oldPrice && oldPrice > price && (
            <span className="text-xs text-white/40 line-through">{oldPrice.toLocaleString('ru-RU')} ₽</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-white/50 group-hover:text-violet-300 transition-colors pt-1">
          <span>Подробнее</span>
          <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </motion.button>
  )
}

function ProductCardGrid({ products, onOpenProduct, title }: { products: any[]; onOpenProduct?: (id: string) => void; title?: string }) {
  if (!products || products.length === 0) return null
  const isCarousel = products.length >= 3
  const isSingle = products.length === 1
  return (
    <div className="w-full">
      {title && (
        <div className="flex items-center gap-1.5 mb-2 px-0.5">
          <Sparkles className="h-3 w-3 text-violet-400" />
          <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wide">{title}</span>
        </div>
      )}
      {isCarousel ? (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory no-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {products.map((p, i) => (
            <div key={p.id} className="snap-start shrink-0">
              <PremiumProductCard product={p} index={i} onOpen={onOpenProduct} />
            </div>
          ))}
        </div>
      ) : isSingle ? (
        <div className="flex justify-center">
          <PremiumProductCard product={products[0]} index={0} onOpen={onOpenProduct} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {products.map((p, i) => <PremiumProductCard key={p.id} product={p} index={i} onOpen={onOpenProduct} />)}
        </div>
      )}
    </div>
  )
}

function ContactsCard({ contacts }: { contacts: any[] }) {
  const iconConfig: Record<string, { Icon: any; bg: string; color: string }> = {
    phone: { Icon: Phone, bg: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
    whatsapp: { Icon: MessageCircle, bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
    telegram: { Icon: Send, bg: 'rgba(56,189,248,0.15)', color: '#38bdf8' },
    email: { Icon: Mail, bg: 'rgba(168,85,247,0.15)', color: '#a855f7' },
  }
  return (
    <div className="w-full rounded-2xl overflow-hidden border border-border/40 bg-background/80 backdrop-blur-xl p-3 space-y-2">
      {contacts.map((c, i) => {
        const cfg = iconConfig[c.type] || iconConfig.phone
        const Icon = cfg.Icon
        const value = c.value || c.phone || c.email || ''
        let href = ''
        let linkLabel = 'Открыть'
        if (c.type === 'phone') { href = `tel:${value.replace(/\s/g, '')}`; linkLabel = 'Позвонить' }
        else if (c.type === 'email') { href = `mailto:${value}`; linkLabel = 'Написать' }
        else if (c.type === 'telegram') { href = `https://t.me/${value.replace('@', '')}`; linkLabel = 'Открыть' }
        else if (c.type === 'whatsapp') { const digits = value.replace(/[^\d]/g, ''); href = `https://wa.me/${digits}`; linkLabel = 'Написать' }
        return (
          <motion.a
            key={i}
            href={href}
            target={c.type === 'telegram' || c.type === 'whatsapp' ? '_blank' : undefined}
            rel={c.type === 'telegram' || c.type === 'whatsapp' ? 'noopener noreferrer' : undefined}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-accent/40 transition-all active:scale-[0.98]"
          >
            <div className="h-10 w-10 rounded-full grid place-items-center shrink-0" style={{ background: cfg.bg }}>
              <Icon className="h-5 w-5" style={{ color: cfg.color }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">{c.label || c.type}</div>
              <div className="text-sm font-medium truncate">{value}</div>
            </div>
            <div className="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0" style={{ background: cfg.bg, color: cfg.color }}>{linkLabel}</div>
          </motion.a>
        )
      })}
    </div>
  )
}

function CalculationCard({ calculation }: { calculation: any }) {
  const [open, setOpen] = useState(true)
  if (!calculation) return null
  return (
    <div className="w-full rounded-2xl overflow-hidden border border-blue-400/30 bg-gradient-to-br from-blue-50/80 to-indigo-50/60 dark:from-blue-950/30 dark:to-indigo-950/20 backdrop-blur-xl">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        <Calculator className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <span className="text-sm font-semibold flex-1">
          {calculation.product?.name ? `Расчёт: ${calculation.product.name}` : 'Расчёт стоимости'}
        </span>
        {calculation.total > 0 && (
          <span className="text-base font-bold text-blue-700 dark:text-blue-300">{calculation.total.toLocaleString('ru-RU')} ₽</span>
        )}
        {calculation.range && (
          <span className="text-base font-bold text-blue-700 dark:text-blue-300">
            {calculation.range[0].toLocaleString('ru-RU')}–{calculation.range[1].toLocaleString('ru-RU')} ₽
          </span>
        )}
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-3 pb-3 space-y-1">
              {calculation.breakdown?.map((line: string, i: number) => (
                <div key={i} className="text-xs text-foreground/70 font-mono">{line}</div>
              ))}
              {calculation.missing?.length > 0 && (
                <div className="mt-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Нужно уточнить: {calculation.missing.join(', ')}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function OrderWizard({ data, onSubmitted }: { data: any; onSubmitted: (orderId: string, total: number, message: string) => void }) {
  const [step, setStep] = useState<'confirm' | 'form' | 'submitting' | 'done' | 'error'>('confirm')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [comment, setComment] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim()) return
    setStep('submitting')
    setError('')
    try {
      const r = await api.post<{ ok: boolean; orderId?: string; orderNumber?: string; total: number; message: string; error?: string }>('/api/ai/order', {
        json: {
          productSlug: data.productSlug,
          productName: data.productName,
          customerName: name,
          customerPhone: phone,
          customerEmail: email,
          deliveryAddress: address,
          customerComment: comment,
          totalQuote: data.calculation?.total,
        },
      })
      if (r.ok === true && (r.orderId || r.orderNumber)) {
        setResult(r)
        setStep('done')
        onSubmitted(r.orderId || r.orderNumber || '', r.total, r.message)
      } else {
        setError(r.error || r.message || 'Не удалось создать заказ')
        setStep('error')
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось связаться с сервером')
      setStep('error')
    }
  }

  if (step === 'done' && result) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full rounded-2xl overflow-hidden border border-emerald-400/40 bg-gradient-to-br from-emerald-50/90 to-teal-50/70 dark:from-emerald-950/30 dark:to-teal-950/20 backdrop-blur-xl p-4">
        <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-300 mb-3">
          <div className="h-10 w-10 rounded-full bg-emerald-500 grid place-items-center">
            <CheckCircle2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="font-bold text-base">Заявка успешно создана</div>
            <div className="text-xs opacity-80">Номер: <span className="font-mono font-bold">{result.orderNumber || result.orderId?.slice(-8).toUpperCase()}</span></div>
          </div>
        </div>
        {result.total > 0 && <div className="text-sm mb-2">Сумма: <span className="font-bold text-lg">{result.total.toLocaleString('ru-RU')} ₽</span></div>}
        <div className="text-xs text-muted-foreground">{result.message}</div>
      </motion.div>
    )
  }

  if (step === 'error') {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full rounded-2xl overflow-hidden border border-red-400/40 bg-red-50/80 dark:bg-red-950/30 backdrop-blur-xl p-4">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300 mb-2">
          <AlertCircle className="h-5 w-5" />
          <span className="font-semibold">Не удалось создать заявку</span>
        </div>
        <div className="text-xs text-muted-foreground mb-3">{error}</div>
        <button onClick={() => setStep('form')} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm hover:bg-red-600">Попробовать снова</button>
      </motion.div>
    )
  }

  if (step === 'submitting') {
    return (
      <div className="w-full rounded-2xl overflow-hidden border border-primary/30 bg-primary/5 backdrop-blur-xl p-6 flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <div className="text-sm font-medium">Создаём заявку…</div>
        <div className="text-xs text-muted-foreground">Пожалуйста, подождите</div>
      </div>
    )
  }

  if (step === 'confirm') {
    return (
      <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="w-full rounded-2xl overflow-hidden border border-primary/30 bg-gradient-to-br from-primary/5 to-blue-50/40 dark:from-primary/10 dark:to-blue-950/20 backdrop-blur-xl p-4">
        <div className="text-sm font-semibold mb-2 flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-primary" />
          Оформить «{data.productName}»?
        </div>
        {data.calculation && (
          <div className="text-xs text-foreground/80 space-y-0.5 mb-3 bg-background/60 rounded-lg p-2">
            {data.calculation.breakdown?.map((line: string, i: number) => (
              <div key={i} className="font-mono">{line}</div>
            ))}
            {data.calculation.total > 0 && (
              <div className="text-sm font-bold text-primary mt-1">Итого: {data.calculation.total.toLocaleString('ru-RU')} ₽</div>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => setStep('form')} className="flex-1 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
            Оформить
          </button>
          <button onClick={() => setStep('done')} className="px-3 py-2.5 rounded-xl bg-accent text-sm hover:bg-accent/80 transition-colors">
            Позже
          </button>
        </div>
      </motion.div>
    )
  }

  // step === 'form'
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-2xl overflow-hidden border border-primary/30 bg-background/95 backdrop-blur-xl p-4 space-y-2">
      <div className="text-sm font-semibold mb-1">Контактные данные</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя *" className="w-full h-11 px-3 rounded-xl bg-background border border-border/60 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон *" type="tel" className="w-full h-11 px-3 rounded-xl bg-background border border-border/60 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (опционально)" type="email" className="w-full h-11 px-3 rounded-xl bg-background border border-border/60 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20" />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Адрес доставки" className="w-full h-11 px-3 rounded-xl bg-background border border-border/60 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20" />
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий к заказу" rows={2} className="w-full px-3 py-2 rounded-xl bg-background border border-border/60 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 resize-none" />
      <div className="flex gap-2 pt-1">
        <button onClick={handleSubmit} disabled={!name.trim() || !phone.trim()} className="flex-1 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Отправить заявку
        </button>
        <button onClick={() => setStep('confirm')} className="px-3 py-2.5 rounded-xl bg-accent text-sm hover:bg-accent/80 transition-colors">Назад</button>
      </div>
    </motion.div>
  )
}

function ActionButton({ action, onAction }: { action: ChatAction; onAction: (a: ChatAction) => void }) {
  const icons: Record<string, any> = {
    open_catalog: Package, open_product: Package, open_cart: ShoppingBag, open_checkout: ShoppingBag,
    open_films: Film, open_music: Music, open_media: Film, open_chat: MessageCircle,
    open_support: HelpCircle, open_orders: ShoppingBag, show_contacts: Phone,
    start_order_wizard: ShoppingBag, navigate: Sparkles,
  }
  const Icon = icons[action.type] || Sparkles
  return (
    <button onClick={() => onAction(action)}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-all">
      <Icon className="h-3.5 w-3.5" />
      {action.label}
    </button>
  )
}

// ===========================================================================
//  v8: ChatBubble — рендер одного сообщения в истории диалога
//  Поддерживает:
//    • role='user' — правая сторона, indigo gradient
//    • role='assistant' — левая сторона, glass-фон
//    • isTyping=true — показываем displayedText с мигающим курсором
//    • response.cards / response.actions / response.calculation
// ===========================================================================
function ChatBubble({
  role,
  text,
  response,
  isTyping,
  displayedText,
  onAction,
  onOpenProduct,
}: {
  role: 'user' | 'assistant'
  text?: string
  response?: AIResponse
  isTyping?: boolean
  displayedText?: string
  onAction?: (a: ChatAction) => void
  onOpenProduct?: (id: string) => void
}) {
  const isUser = role === 'user'
  const content = isTyping ? (displayedText || '') : (text ?? response?.text ?? '')

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md text-white text-sm leading-relaxed shadow-lg"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            boxShadow: '0 4px 16px -4px rgba(99,102,241,0.4)',
          }}
        >
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      {/* v11: max-w-[95%] (было 92%) — больше места для длинных ответов AI.
          w-full чтобы контент мог растягиваться по ширине. */}
      <div className="max-w-[95%] w-full flex flex-col gap-2">
        {/* AI avatar row */}
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shrink-0">
            <Sparkles className="h-3 w-3 text-white" />
          </div>
          <span className="text-[10px] text-white/40 uppercase tracking-wide">AI</span>
        </div>
        {/* Bubble — v11: без max-height, без overflow. Текст растёт автоматически. */}
        <div
          className="px-4 py-2.5 rounded-2xl rounded-tl-md text-white text-sm leading-relaxed bg-white/5 border border-white/10 backdrop-blur-sm"
          style={{ boxShadow: '0 2px 8px -2px rgba(0,0,0,0.3)' }}
        >
          {isTyping ? (
            <div className="whitespace-pre-wrap">
              {content}
              <span
                className="inline-block w-[2px] h-[1.1em] ml-0.5 align-text-bottom bg-violet-400 animate-pulse"
                aria-hidden="true"
              />
            </div>
          ) : (
            <AIResponseRenderer text={content} />
          )}
        </div>

        {/* Calculation card */}
        {!isTyping && response?.calculation && <CalculationCard calculation={response.calculation} />}

        {/* Rich cards (grouped by category if available) */}
        {!isTyping && response?.cards && response.cards.length > 0 && (
          <ResponseCards cards={response.cards} onOpenProduct={onOpenProduct} />
        )}

        {/* Action buttons */}
        {!isTyping && response?.actions && response.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-1">
            {response.actions.map((a, i) => (
              <ActionButton key={i} action={a} onAction={onAction!} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
//  v8: ResponseCards — рендер карточек с группировкой по категориям
//  Поддерживает:
//    • Категория с заголовком → горизонтальная прокрутка
//    • Несколько категорий → разделители
//    • Компактные карточки товаров
// ===========================================================================
function ResponseCards({
  cards,
  onOpenProduct,
}: {
  cards: ChatCard[]
  onOpenProduct?: (id: string) => void
}) {
  // Группируем product/similar_products карточки по category
  // Если у карточки есть data.category — берём его; иначе — общий "Товары"
  type Group = { title: string; emoji: string; products: any[] }
  const productCards = cards.filter(c => c.kind === 'product' || c.kind === 'similar_products')
  const otherCards = cards.filter(c => c.kind !== 'product' && c.kind !== 'similar_products')

  const groups: Group[] = []
  for (const card of productCards) {
    const items = Array.isArray(card.data) ? card.data : [card.data]
    for (const item of items) {
      const cat = item?.category || item?.categoryName || (card.kind === 'similar_products' ? 'Похожие товары' : 'Товары')
      let g = groups.find(x => x.title === cat)
      if (!g) {
        const emoji = categoryEmoji(cat)
        g = { title: cat, emoji, products: [] }
        groups.push(g)
      }
      g.products.push(item)
    }
  }

  return (
    <div className="flex flex-col gap-3 pl-1">
      {groups.map((g, gi) => (
        <div key={gi} className="flex flex-col gap-2">
          {gi > 0 && <div className="h-px bg-white/10 my-1" />}
          <div className="flex items-center gap-1.5 text-xs text-white/70 font-medium">
            <span>{g.emoji}</span>
            <span>{g.title}</span>
            <span className="text-white/30">·</span>
            <span className="text-white/40">{g.products.length}</span>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory no-scrollbar">
            {g.products.map((p, i) => (
              <CompactProductCard
                key={i}
                product={p}
                onClick={onOpenProduct ? () => onOpenProduct(p.id || p.productId) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
      {otherCards.map((card, i) => {
        if (card.kind === 'contacts') return <ContactsCard key={i} contacts={card.data} />
        if (card.kind === 'order_wizard') return <OrderWizard key={i} data={card.data} onSubmitted={() => {}} />
        return null
      })}
    </div>
  )
}

function categoryEmoji(cat: string): string {
  const c = (cat || '').toLowerCase()
  if (c.includes('подар')) return '🎁'
  if (c.includes('баннер') || c.includes('banner')) return '🖨'
  if (c.includes('печат') || c.includes('print')) return '🖨'
  if (c.includes('визитк')) return '💳'
  if (c.includes('футбол') || c.includes('одежд')) return '👕'
  if (c.includes('кружк')) return '☕'
  if (c.includes('плакат') || c.includes('постер')) return '🖼'
  if (c.includes('буклет') || c.includes('листовк')) return '📄'
  if (c.includes('наклейк') || c.includes('стикер')) return '✨'
  if (c.includes('книг') || c.includes('журнал')) return '📚'
  if (c.includes('упаков')) return '📦'
  if (c.includes('сувенир')) return '🎀'
  return '🛍'
}

// ===========================================================================
//  v8: CompactProductCard — компактная карточка товара для чата
//  Размеры: ~160px ширина, миниатюрное изображение 16:9, минимум текста
// ===========================================================================
function CompactProductCard({ product, onClick }: { product: any; onClick?: () => void }) {
  if (!product) return null
  const name = product.name || product.title || 'Товар'
  const price = product.price != null ? product.price : product.basePrice
  const oldPrice = product.oldPrice
  const image = product.image || product.imageUrl || product.coverImage || (Array.isArray(product.images) ? product.images[0] : null)
  const currencySymbol = (() => {
    const c = (product.currency || 'RUB').toString().toUpperCase()
    if (c === 'RUB' || c === 'РУБ') return '₽'
    if (c === 'USD') return '$'
    if (c === 'EUR') return '€'
    if (c === 'KZT') return '₸'
    if (c === 'UAH') return '₴'
    if (c === 'BYN') return 'Br'
    return c
  })()
  const isAction = product.isAction || product.discount
  const isNew = product.isNew
  const isPopular = product.isPopular
  const inStock = product.inStock !== false && product.stockStatus !== 'out_of_stock' && product.quantity !== 0
  const discountPct = oldPrice && price != null && oldPrice > price
    ? Math.round((1 - price / oldPrice) * 100)
    : null

  return (
    <button
      onClick={onClick}
      className="snap-start shrink-0 text-left w-[160px] rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-violet-400/40 hover:bg-white/10 transition-all group"
    >
      {/* Image — compact 16:9 */}
      <div className="relative aspect-[16/9] bg-black/30 overflow-hidden">
        {image ? (
          <img
            src={typeof image === 'string' ? image : image.url}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <Package className="h-5 w-5 text-white/30" />
          </div>
        )}
        {/* Discount / Action badge */}
        {discountPct ? (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-rose-500/90 text-white text-[9px] font-bold leading-none">
            -{discountPct}%
          </div>
        ) : isAction ? (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-rose-500/90 text-white text-[9px] font-bold leading-none uppercase">
            Акция
          </div>
        ) : isNew ? (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-emerald-500/90 text-white text-[9px] font-bold leading-none uppercase">
            Новинка
          </div>
        ) : isPopular ? (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-amber-500/90 text-white text-[9px] font-bold leading-none uppercase">
            Хит
          </div>
        ) : null}
        {/* Stock indicator */}
        <div
          className={cn(
            'absolute top-1 right-1 h-1.5 w-1.5 rounded-full',
            inStock ? 'bg-emerald-400' : 'bg-rose-400'
          )}
          title={inStock ? 'В наличии' : 'Нет в наличии'}
        />
      </div>
      {/* Content — compact */}
      <div className="p-2 flex flex-col gap-0.5">
        <div className="text-[11px] text-white/90 font-medium line-clamp-2 leading-tight min-h-[26px]">
          {name}
        </div>
        <div className="flex items-baseline gap-1">
          {price != null && (
            <div className="text-xs font-bold text-violet-300">
              {Number(price).toLocaleString('ru-RU')} {currencySymbol}
            </div>
          )}
          {oldPrice && (
            <div className="text-[10px] text-white/40 line-through">
              {Number(oldPrice).toLocaleString('ru-RU')}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

// ===========================================================================
//  MAIN AI Assistant — Voice-First Full Screen (v5)
// ===========================================================================
export function AIAssistant({ context, onNavigate, onOpenProduct, onOpenCart }: AssistantProps) {
  const [open, setOpen] = useState(false)
  // v6: minimized — AI сворачивается в маленькую плавающую кнопку
  // когда AI открывает раздел (каталог, чат и т.д.). Пользователь видит
  // открытый раздел, а AI доступен одним тапом по плавающей кнопке.
  const [minimized, setMinimized] = useState(false)
  const [inputMode, setInputMode] = useState<'voice' | 'keyboard'>('voice')
  const [hasUserSentMessage, setHasUserSentMessage] = useState(false)
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [interim, setInterim] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [response, setResponse] = useState<AIResponse | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  // v5: новая система состояний
  const [phase, setPhase] = useState<AIPhase>('idle')
  // v24.3: ref-зеркало phase для использования в колбэках (onEnd, handleVoiceEnd),
  // чтобы всегда видеть актуальное значение без пересоздания колбэков.
  const phaseRef = useRef<AIPhase>('idle')
  const setPhaseSafe = useCallback((p: AIPhase) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  // v9: Умный индикатор состояния — динамическая ротация статусов
  const [dynamicStatus, setDynamicStatus] = useState<string>('')
  const dynamicStatusRef = useRef<string>('')
  dynamicStatusRef.current = dynamicStatus
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusGroupRef = useRef<'db' | 'calc' | 'thinking'>('thinking')

  // v10: scroll-based fade-out для верхней анимации
  // При прокрутке вверх — sticky-блок плавно исчезает (opacity 1 → 0)
  // Никаких чёрных полос, никаких резких переходов.
  const [stickyOpacity, setStickyOpacity] = useState(1)
  const stickyOpacityRef = useRef(1)

  // v9: Запуск/остановка ротации статусов
  const startDynamicStatus = useCallback((message: string) => {
    const group = pickStatusGroup(message)
    statusGroupRef.current = group
    const pool = group === 'db' ? DYNAMIC_STATUSES_DB : group === 'calc' ? DYNAMIC_STATUSES_CALC : DYNAMIC_STATUSES_THINKING
    setDynamicStatus(pool[0])
    let idx = 0
    if (statusTimerRef.current) clearInterval(statusTimerRef.current)
    statusTimerRef.current = setInterval(() => {
      idx = (idx + 1) % pool.length
      setDynamicStatus(pool[idx])
    }, 1800) // 1.8 сек на статус
  }, [])

  const stopDynamicStatus = useCallback(() => {
    if (statusTimerRef.current) {
      clearInterval(statusTimerRef.current)
      statusTimerRef.current = null
    }
    setDynamicStatus('')
  }, [])

  // v5: непрерывный голосовой режим
  const [continuousVoice, setContinuousVoice] = useState(false)
  const continuousVoiceRef = useRef(false)

  // v5: накопленный текст пользователя (для логики «Вы закончили?»)
  const accumulatedTextRef = useRef('')
  const [accumulatedText, setAccumulatedText] = useState('')

  // v7: Авто-определение конца речи.
  // Таймер запускается ПОСЛЕ каждого финального результата распознавания.
  // Если за SILENCE_TIMEOUT_MS не было новых результатов — пользователь закончил говорить,
  // отправляем накопленный текст в LLM автоматически. Никаких подтверждений.
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const SILENCE_TIMEOUT_MS = 1500  // 1.5 сек тишины → авто-отправка

  // v5: таймер подтверждения — если пользователь не отвечает 10 сек после вопроса,
  // считаем что подтверждено и отправляем запрос. (v7: больше не используется)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const CONFIRM_TIMEOUT_MS = 10000

  // v5: флаг — находится ли AI в режиме «спрашиваю подтверждение» (v7: больше не используется)
  const [waitingForConfirmation, setWaitingForConfirmation] = useState(false)
  const waitingForConfirmationRef = useRef(false)

  // v5/v7: флаг — пользователь прервал ответ (начал говорить во время подготовки)
  const userInterruptedRef = useRef(false)

  // v5: история разговора для контекста LLM
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [conversationLog, setConversationLog] = useState<Array<{ userQuery: string; response: AIResponse }>>([])
  const [showHistoryPrompt, setShowHistoryPrompt] = useState(false)

  // v5: typing animation state
  const [displayedText, setDisplayedText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // v6: keyboard height — высота мобильной клавиатуры (для адаптации UI).
  // Когда клавиатура открыта, bottom-controls поднимаются ровно на высоту
  // клавиатуры, не больше. Использует VisualViewport API.
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  // v5: флаг — был ли ответ уже показан (чтобы не прерывать typing повторно)
  const responseShownRef = useRef(false)

  // v5: ref на скролл-контейнер — для автоскролла вниз при typing
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // v7: Логика непрерывного разговора:
  //   1. Пользователь нажимает микрофон один раз → начинается прослушивание.
  //   2. Пользователь говорит → распознанный текст копится в accumulatedText.
  //   3. После каждого финального результата запускается silence-таймер (1.5 сек).
  //      Если за это время не было новых результатов → пользователь закончил →
  //      авто-отправка в LLM.
  //   4. AI думает → отвечает (typing animation).
  //   5. После завершения typing → автоматически возвращается в режим прослушивания.
  //   6. Если пользователь начинает говорить ВО ВРЕМЯ ответа AI — ПРЕРЫВАНИЕ:
  //      AI немедленно останавливается и слушает дальше.

  // v7: обработчик финального результата распознавания
  const handleVoiceResult = useCallback((text: string) => {
    // v7: ПРЕРЫВАНИЕ — если AI отвечает/думает и пользователь начал говорить,
    // немедленно останавливаем ответ и слушаем дальше. Никаких кнопок.
    if (phase === 'responding' || phase === 'thinking' || phase === 'acting') {
      userInterruptedRef.current = true
      // Останавливаем typing animation
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
      setIsTyping(false)
      // v8: НЕ сбрасываем response — оставляем предыдущий ответ видимым
      // в истории диалога. Старый ответ уже добавлен в conversationLog.
      setDisplayedText('')
      // Останавливаем TTS (если было)
      voiceOutRef.current.stop()
      // Начинаем новую фразу
      accumulatedTextRef.current = text
      setAccumulatedText(text)
      setInterim('')
      setPhase('listening')
      // Перезапускаем listening (browser SpeechRecognition мог остановиться)
      setTimeout(() => voiceInRef.current.start(), 200)
      return
    }

    // Обычный режим — копим текст и запускаем silence-таймер для авто-отправки
    accumulatedTextRef.current = (accumulatedTextRef.current + ' ' + text).trim()
    setAccumulatedText(accumulatedTextRef.current)
    setInterim('')

    // v7: Сбрасываем предыдущий silence-таймер
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    // Запускаем новый — если за 1.5 сек не было новых результатов, отправляем
    silenceTimerRef.current = setTimeout(() => {
      if (!continuousVoiceRef.current) return
      const finalText = accumulatedTextRef.current.trim()
      if (!finalText) return
      // Авто-отправка без подтверждений
      silenceTimerRef.current = null
      setInterim('')
      setUserQuery(finalText)
      accumulatedTextRef.current = ''
      setAccumulatedText('')
      processMessageRef.current(finalText)
    }, SILENCE_TIMEOUT_MS)
  }, [phase])

  // v7: обработчик interim (промежуточных результатов)
  // Сбрасываем silence-таймер — пользователь ещё говорит
  const handleVoiceInterim = useCallback((text: string) => {
    setInterim(text)
    // Если есть interim — пользователь ещё говорит, сбрасываем авто-отправку
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  // v7: recognition завершился сам (timeout браузера или no-speech).
  // Если мы в режиме listening и continuous — перезапускаем recognition,
  // чтобы пользователь мог продолжить разговор без нажатий.
  // v24.3: используем phaseRef.current вместо phase, чтобы всегда видеть
  // актуальную фазу. Раньше handleVoiceEnd пересоздавался при каждом
  // изменении phase (useCallback [phase]), но onEndRef в useVoiceInput
  // мог ссылаться на устаревшую версию — из-за этого после первого ответа
  // AI (phase: responding → listening) handleVoiceEnd видел старую фазу
  // 'responding' и возвращался раньше времени, не перезапуская recognition.
  const handleVoiceEnd = useCallback(() => {
    if (!continuousVoiceRef.current) return
    const currentPhase = phaseRef.current
    // AI отвечает/думает — не перезапускаем (прерывание обработано в handleVoiceResult)
    if (currentPhase === 'thinking' || currentPhase === 'acting' || currentPhase === 'responding') return
    // Если есть накопленный текст и silence-таймер ещё работает — ждём авто-отправку
    if (currentPhase === 'listening' && accumulatedTextRef.current.trim() && silenceTimerRef.current) {
      // Не перезапускаем recognition — ждём таймер
      return
    }
    // Перезапускаем recognition для продолжения разговора
    if (currentPhase === 'listening') {
      setTimeout(() => {
        if (continuousVoiceRef.current && phaseRef.current === 'listening' && !silenceTimerRef.current) {
          voiceInRef.current.start()
        }
      }, 200)
    }
  }, [])

  const voiceIn = useVoiceInput({
    onResult: handleVoiceResult,
    onInterim: handleVoiceInterim,
    onEnd: handleVoiceEnd,
    continuous: true,
  })
  const voiceOut = useVoiceOutput()

  // Stable refs
  const voiceOutRef = useRef(voiceOut)
  voiceOutRef.current = voiceOut
  const voiceInRef = useRef(voiceIn)
  voiceInRef.current = voiceIn

  // v5: ref на processMessage, чтобы handleVoiceResult не пересоздавался
  const processMessageRef = useRef<(text: string) => void>(() => {})

  useEffect(() => {
    api.get<AIStatus>('/api/ai/status').then(setStatus).catch(() => {})
  }, [])

  // v15: Автоскролл вниз при typing — УЛУЧШЕНО.
  // Раньше скроллил только при изменении displayedText, но если текст
  // длинный и render занимает время — скролл не успевал.
  // Теперь: 1) immediate scroll 2) RAF scroll 3) повтор через 50мс
  // v24.2 BUGFIX: removed `!isTyping` guard. Previously when typing ENDED
  // (isTyping flipped to false), this effect re-ran but the guard returned
  // early — so the final fully-rendered response (which is taller than the
  // partial-typing one due to cards/actions/images rendered by
  // AIResponseRenderer) never triggered a scroll. The bottom of the response
  // overflowed below the visible area.
  // Also added `response` and `conversationLog` to deps so async growth of
  // the response bubble (cards loading after main text) triggers a re-scroll.
  useEffect(() => {
    if (!scrollContainerRef.current) return
    const el = scrollContainerRef.current
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight
    }
    scrollToBottom()
    requestAnimationFrame(scrollToBottom)
    const t = setTimeout(scrollToBottom, 50)
    // v24.2: second delayed scroll catches late-rendering cards/images
    const t2 = setTimeout(scrollToBottom, 250)
    return () => {
      clearTimeout(t)
      clearTimeout(t2)
    }
  }, [displayedText, isTyping, response, conversationLog, sending])

  // v10: Scroll listener — плавный fade-out верхней анимации при прокрутке вверх.
  // - scrollTop = 0 → opacity 1 (полностью видна)
  // - scrollTop > 120px → opacity 0 (полностью скрыта)
  // - Между 0 и 120 → линейная интерполяция (плавный fade)
  // Это убирает чёрную полосу и делает переход красивым.
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const top = el.scrollTop
      // Fade range: 0px → 1.0 opacity, 120px → 0.0 opacity
      const opacity = Math.max(0, Math.min(1, 1 - top / 120))
      if (Math.abs(opacity - stickyOpacityRef.current) > 0.01) {
        stickyOpacityRef.current = opacity
        setStickyOpacity(opacity)
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // v8: Автоскролл вниз при появлении нового сообщения в истории
  useEffect(() => {
    if (!scrollContainerRef.current) return
    const el = scrollContainerRef.current
    // Небольшая задержка чтобы React успел отрисовать новые пузыри
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [conversationLog.length, sending])

  // v8: Автоскролл при отправке сообщения пользователем (текстовый ввод)
  useEffect(() => {
    if (!scrollContainerRef.current) return
    const el = scrollContainerRef.current
    el.scrollTop = el.scrollHeight
  }, [userQuery])

  // v24.2 BUGFIX: ResizeObserver auto-scroll — when the content inside the
  // scroll container changes height (e.g. AIResponseRenderer asynchronously
  // loads product cards, images, calculation results AFTER the typing
  // animation finishes), the container's scrollHeight grows but no
  // `displayedText`/`response` change fires. Without this observer, the
  // bottom of the response stays below the visible area. The observer only
  // auto-scrolls if the user is already near the bottom (within 120px) —
  // otherwise it assumes the user has scrolled up to read history and we
  // shouldn't yank them down.
  useEffect(() => {
    if (!open) return
    const el = scrollContainerRef.current
    if (!el) return
    let wasNearBottom = true
    const ro = new ResizeObserver(() => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const isNearBottom = distanceFromBottom < 120
      // Only auto-scroll if user is already near bottom OR just sent a message
      if (isNearBottom || (wasNearBottom && sending)) {
        el.scrollTop = el.scrollHeight
      }
      wasNearBottom = isNearBottom
    })
    // Observe the scroll container AND all its descendants (cards/images grow)
    ro.observe(el)
    const observeDescendants = () => {
      el.querySelectorAll('*').forEach((child) => ro.observe(child))
    }
    observeDescendants()
    // Re-observe when messages change (new bubbles added)
    const interval = setInterval(observeDescendants, 1000)
    return () => {
      ro.disconnect()
      clearInterval(interval)
    }
  }, [open, conversationLog.length, sending, response])

  // v5: typing animation — анимация набора ответа
  useEffect(() => {
    if (!response?.text) {
      setDisplayedText('')
      setIsTyping(false)
      return
    }
    if (response.text.startsWith('Произошла ошибка')) {
      setDisplayedText(response.text)
      setIsTyping(false)
      return
    }
    const fullText = response.text
    setDisplayedText('')
    setIsTyping(true)
    setPhase('responding')
    responseShownRef.current = false

    if (typingTimerRef.current) clearInterval(typingTimerRef.current)

    const charsPerTick = fullText.length > 500 ? 4 : fullText.length > 200 ? 3 : 2
    const tickMs = 28
    let i = 0
    typingTimerRef.current = setInterval(() => {
      // Если пользователь прервал — останавливаем typing
      if (userInterruptedRef.current) {
        userInterruptedRef.current = false
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current)
          typingTimerRef.current = null
        }
        return
      }
      i += charsPerTick
      if (i >= fullText.length) {
        setDisplayedText(fullText)
        setIsTyping(false)
        responseShownRef.current = true
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current)
          typingTimerRef.current = null
        }
        // v5: после завершения typing — продолжаем голосовой цикл
        if (continuousVoiceRef.current) {
          voiceOutRef.current.speak(fullText, () => {
            if (continuousVoiceRef.current) {
              setTimeout(() => {
                if (continuousVoiceRef.current && !waitingForConfirmationRef.current) {
                  setPhase('listening')
                  // v24.3: start listening for the next question.
                  // The recRef.current=null fix in onend (useVoiceInput)
                  // ensures start() can create a fresh SpeechRecognition
                  // instance even if the previous one ended via browser
                  // timeout. We do NOT call stop() here because stop()
                  // removes the onend/onresult handlers, which would break
                  // the auto-restart logic in handleVoiceEnd when the
                  // browser times out the new recognition instance.
                  voiceInRef.current.start()
                } else {
                  setPhase('idle')
                }
              }, 600)
            } else {
              setPhase('idle')
            }
          })
        } else {
          setPhase('idle')
        }
      } else {
        let next = i
        while (next < fullText.length && !/\s/.test(fullText[next])) next++
        setDisplayedText(fullText.slice(0, next))
      }
    }, tickMs)

    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
  }, [response])

  useScrollLock(open)

  // v9: cleanup таймера динамического статуса при размонтировании
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current)
        statusTimerRef.current = null
      }
    }
  }, [])

  // v6: VisualViewport API — отслеживаем появление мобильной клавиатуры.
  // Когда клавиатура открывается, visualViewport.height уменьшается.
  // Мы вычисляем keyboardHeight и используем его для bottom-controls,
  // чтобы они поднимались ровно на высоту клавиатуры, не больше.
  // v16: также используем visualViewport.height для высоты overlay —
  // это исправляет баг "поле уходит наверх". Overlay всегда равен
  // видимой области (с учётом клавиатуры), а не полному viewport.
  const [viewportHeight, setViewportHeight] = useState(0)
  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined' || !window.visualViewport) return
    const vv = window.visualViewport
    const update = () => {
      const h = window.innerHeight - vv.height
      setKeyboardHeight(h > 0 ? h : 0)
      // v16: высота overlay = видимая область (без клавиатуры)
      setViewportHeight(vv.height)
      // Также учитываем offsetTop — если клавиатура сдвигает viewport
      if (vv.offsetTop > 0) {
        // viewport сдвинут вниз — клавиатура сверху (редко)
      }
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [open])

  // v24.3: REMOVED pre-request mic permission effect.
  // Previously this effect called getUserMedia() when permission state was
  // 'prompt', which triggered the FIRST browser permission dialog. Then when
  // useVoiceInput.start() created a SpeechRecognition and called rec.start(),
  // the browser triggered a SECOND permission dialog (because SpeechRecognition
  // also needs mic permission). Now we let SpeechRecognition handle the
  // permission request itself — only ONE dialog appears, and if permission
  // was already granted, no dialog appears at all.

  // Load conversation history
  useEffect(() => {
    if (!open) return
    try {
      const saved = localStorage.getItem('999pro-ai-conversation')
      const savedHistory = localStorage.getItem('999pro-ai-history')
      if (saved && savedHistory) {
        const parsedLog = JSON.parse(saved)
        const parsedHistory = JSON.parse(savedHistory)
        if (parsedLog.length > 0 && parsedHistory.length > 0) {
          setConversationLog(parsedLog)
          setHistory(parsedHistory)
          // v8: больше НЕ показываем showHistoryPrompt — история видна напрямую
          // в чат-режиме. Пользователь может прокрутить вверх или очистить.
          setShowHistoryPrompt(false)
          setPhase('idle')
          return
        }
      }
    } catch {}
    setInterim('')
    setUserQuery('')
    setResponse(null)
    setInput('')
    setPhase('idle')
    setInputMode('voice')
  }, [open])

  const continueConversation = () => {
    setShowHistoryPrompt(false)
    if (conversationLog.length > 0) {
      const last = conversationLog[conversationLog.length - 1]
      setResponse(last.response)
      setDisplayedText(last.response.text)
      setIsTyping(false)
    }
    setPhase('idle')
    setInputMode('voice')
  }

  const startNewConversation = () => {
    setShowHistoryPrompt(false)
    setConversationLog([])
    setHistory([])
    setResponse(null)
    setDisplayedText('')
    setIsTyping(false)
    try {
      localStorage.removeItem('999pro-ai-conversation')
      localStorage.removeItem('999pro-ai-history')
    } catch {}
    setPhase('idle')
    setInputMode('voice')
    setTimeout(() => {
      continuousVoiceRef.current = true
      setContinuousVoice(true)
      setPhase('listening')
      voiceIn.start()
    }, 500)
  }

  // v8: clearHistory — очищает историю диалога без перезапуска голоса
  // Используется когда пользователь хочет начать заново из чат-режима
  const clearHistory = useCallback(() => {
    setConversationLog([])
    setHistory([])
    setResponse(null)
    setDisplayedText('')
    setIsTyping(false)
    setUserQuery('')
    try {
      localStorage.removeItem('999pro-ai-conversation')
      localStorage.removeItem('999pro-ai-history')
    } catch {}
    setPhase('idle')
  }, [])

  useEffect(() => {
    if (!response || !userQuery) return
    setConversationLog((prev) => {
      const next = [...prev, { userQuery, response }]
      const trimmed = next.slice(-20)
      try {
        localStorage.setItem('999pro-ai-conversation', JSON.stringify(trimmed))
      } catch {}
      return trimmed
    })
  }, [response, userQuery])

  useEffect(() => {
    if (history.length === 0) return
    try {
      localStorage.setItem('999pro-ai-history', JSON.stringify(history.slice(-20)))
    } catch {}
  }, [history])

  // v6: minimize — AI сворачивается в маленькую плавающую кнопку.
  // Используется когда AI открывает раздел приложения (каталог, чат, и т.д.).
  // Пользователь видит открытый раздел, а AI доступен одним тапом.
  const minimize = useCallback(() => {
    voiceIn.stop()
    continuousVoiceRef.current = false
    setContinuousVoice(false)
    waitingForConfirmationRef.current = false
    setWaitingForConfirmation(false)
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    setMinimized(true)
    setPhase('idle')
  }, [voiceIn])

  // v6: restore — восстановить AI из минимизированного состояния
  const restore = useCallback(() => {
    setMinimized(false)
    continuousVoiceRef.current = true
    setContinuousVoice(true)
    setTimeout(() => {
      setInputMode('voice')
      setPhase('listening')
      voiceIn.start()
    }, 300)
  }, [voiceIn])

  const openAssistant = useCallback(() => {
    // v14: при повторном открытии — если истории нет, показываем стартовую анимацию.
    // Сбрасываем userQuery чтобы анимация появилась снова (closeAssistant уже
    // сбросил hasUserSentMessage). Если история есть — не трогаем (продолжаем диалог).
    if (conversationLog.length === 0) {
      setUserQuery('')
      setResponse(null)
      setDisplayedText('')
      setHasUserSentMessage(false)
    }
    setOpen(true)
    setMinimized(false)
    continuousVoiceRef.current = true
    setContinuousVoice(true)
    setTimeout(() => {
      setInputMode('voice')
      setPhase('listening')
      voiceIn.start()
    }, 500)
  }, [voiceIn, conversationLog.length])

  useEffect(() => {
    const onOpen = () => {
      // v24.3: Voice-only mode on ALL platforms (desktop + mobile).
      // Previously desktop defaulted to keyboard mode which broke the
      // continuous voice loop. Now everyone gets voice — the user can
      // speak to the AI on desktop too (Chrome/Edge/Safari all support
      // SpeechRecognition on desktop).
      setOpen(true)
      continuousVoiceRef.current = true
      setContinuousVoice(true)
      setTimeout(() => {
        setPhase('listening')
        voiceIn.start()
      }, 500)
    }
    window.addEventListener('open-ai-assistant', onOpen)
    return () => window.removeEventListener('open-ai-assistant', onOpen)
  }, [voiceIn])

  const closeAssistant = useCallback(() => {
    voiceIn.stop()
    voiceOut.stop()
    continuousVoiceRef.current = false
    setContinuousVoice(false)
    waitingForConfirmationRef.current = false
    setWaitingForConfirmation(false)
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current)
      typingTimerRef.current = null
    }
    accumulatedTextRef.current = ''
    setAccumulatedText('')
    setOpen(false)
    setMinimized(false)
    setHasUserSentMessage(false)
  }, [voiceIn, voiceOut])

  // v7: toggleMic — простая логика для непрерывного разговора.
  //   • idle → начинаем слушать (continuous mode включается)
  //   • listening → останавливаем разговор (continuous mode выключается, idle)
  //   • responding/thinking/acting → ПРЕРЫВАЕМ ответ и начинаем слушать новый вопрос
  // Пользователю не нужно отправлять запрос вручную — AI сам определяет конец речи
  // по silence-таймеру и авто-отправляет.
  const toggleMic = useCallback(() => {
    if (phase === 'responding' || phase === 'thinking' || phase === 'acting') {
      // v7: Прерывание ответа — начинаем слушать новый вопрос
      userInterruptedRef.current = true
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
      setIsTyping(false)
      setResponse(null)
      setDisplayedText('')
      accumulatedTextRef.current = ''
      setAccumulatedText('')
      setInterim('')
      voiceOutRef.current.stop()
      continuousVoiceRef.current = true
      setContinuousVoice(true)
      setPhase('listening')
      setTimeout(() => voiceIn.start(), 200)
      return
    }
    if (voiceIn.listening || phase === 'listening') {
      // Уже слушаем → останавливаем разговор (переход в idle)
      voiceIn.stop()
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      continuousVoiceRef.current = false
      setContinuousVoice(false)
      accumulatedTextRef.current = ''
      setAccumulatedText('')
      setInterim('')
      setPhase('idle')
      return
    }
    // idle → начинаем слушать
    continuousVoiceRef.current = true
    setContinuousVoice(true)
    setInterim('')
    accumulatedTextRef.current = ''
    setAccumulatedText('')
    // v8: НЕ сбрасываем response — история диалога должна оставаться видимой.
    // Прежний ответ уже сохранён в conversationLog, останется на экране
    // как часть чат-истории, пока не придёт новый.
    setDisplayedText('')
    setPhase('listening')
    voiceIn.start()
  }, [voiceIn, phase])

  // v5: end conversation — полностью останавливает голосовой цикл
  const endConversation = useCallback(() => {
    continuousVoiceRef.current = false
    setContinuousVoice(false)
    waitingForConfirmationRef.current = false
    setWaitingForConfirmation(false)
    voiceIn.stop()
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    accumulatedTextRef.current = ''
    setAccumulatedText('')
    setInterim('')
    setPhase('idle')
  }, [voiceIn])

  const switchToKeyboard = useCallback(() => {
    voiceIn.stop()
    voiceOut.stop()
    setPhase('idle')
    setInputMode('keyboard')
  }, [voiceIn, voiceOut])

  const switchToVoice = useCallback(() => {
    setInputMode('voice')
    setTimeout(() => {
      continuousVoiceRef.current = true
      setContinuousVoice(true)
      setPhase('listening')
      voiceIn.start()
    }, 200)
  }, [voiceIn])

  // v5: processMessage — отправляет запрос в LLM с правильной анимацией состояний
  const processMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return
    setSending(true)
    setPhase('thinking')
    // v9: запускаем умный индикатор состояния — динамические статусы
    startDynamicStatus(text)
    setUserQuery(text)
    setHasUserSentMessage(true)
    setInterim('')
    accumulatedTextRef.current = ''
    setAccumulatedText('')
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    // v8 audit: clear previous response IMMEDIATELY so the UI does not show
    // the old answer while waiting for the new one — this was the main cause
    // of perceived "answer duplication" on the client side.
    setResponse(null)
    setDisplayedText('')

    try {
      const res = await api.post<{
        reply: string
        action: { type: string; view?: string; query?: string } | null
        actions: ChatAction[]
        calculation: any
        local: boolean
        usedDeepSeek: boolean
        cards?: ChatCard[]
        toolActions?: Array<{ type: string; param?: string }>
        agentSteps?: number
      }>('/api/ai/chat', { json: { message: text, context, history } })

      // v5: если есть toolActions — сначала показываем «Выполняю действия»
      if (res.toolActions && res.toolActions.length > 0 && !res.action) {
        setPhase('acting')
        // Короткая анимация выполнения
        await new Promise(resolve => setTimeout(resolve, 1200))
        // Выполняем action
        const firstToolAction = res.toolActions[0]
        handleAction({
          type: firstToolAction.type,
          param: firstToolAction.param,
          label: '',
        })
      }

      const resp: AIResponse = {
        id: `r-${Date.now()}`,
        text: res.reply,
        calculation: res.calculation,
        actions: res.actions,
        cards: res.cards,
        ts: Date.now(),
      }
      setResponse(resp)
      setHistory((h) => [...h, { role: 'user', content: text }, { role: 'assistant', content: res.reply }])

      if (res.action?.type === 'navigate' && onNavigate) {
        setTimeout(() => {
          onNavigate(res.action!.view!)
          // v6: AI сворачивается после открытия раздела
          minimize()
        }, 2000)
      }
    } catch (e: any) {
      // v9: гостевой доступ — понятные сообщения вместо технических ошибок.
      // v24.7 (final-release audit): never expose raw e.message to the user —
      // backend may leak stack traces / API key names / provider identifiers
      // in unforeseen edge cases. Always show one of three safe Russian
      // messages based on the HTTP status code; the technical detail goes to
      // console.warn for developer debugging only.
      let errorText = 'произошла непредвиденная ошибка'
      if (e?.status === 401) {
        errorText = 'Для доступа к вашим данным необходимо войти в аккаунт. Общие вопросы о товарах и каталоге я могу помочь и без авторизации.'
      } else if (e?.status === 429) {
        errorText = 'Слишком много запросов к AI. Подождите минуту и попробуйте снова.'
      } else if (e?.status === 503 || /network|fetch|Failed to fetch/i.test(String(e?.message || ''))) {
        errorText = 'Сервис AI временно недоступен. Проверьте подключение к интернету и попробуйте позже.'
      } else if (e?.status >= 500) {
        errorText = 'Сервис AI временно недоступен. Мы уже знаем о проблеме — попробуйте позже.'
      } else if (e?.status >= 400 && e?.status < 500) {
        errorText = 'Не удалось обработать запрос. Попробуйте переформулировать вопрос.'
      }
      // Dev-only: log the raw error so developers can debug
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[AI assistant] chat error:', e)
      }
      const resp: AIResponse = {
        id: `r-${Date.now()}`,
        text: `${errorText}. Попробуйте ещё раз.`,
        ts: Date.now(),
      }
      setResponse(resp)
      setPhase('idle')
    } finally {
      setSending(false)
      // v9: останавливаем умный индикатор — ответ получен
      stopDynamicStatus()
    }
  }, [sending, context, history, voiceOut, onNavigate, minimize, startDynamicStatus, stopDynamicStatus])

  // Сохраняем processMessage в ref, чтобы handleVoiceResult был актуален
  processMessageRef.current = processMessage

  // v6: handleAction — действия AI (navigate, open_cart, и т.д.)
  // Когда AI открывает раздел приложения — автоматически сворачиваем AI
  // в плавающую кнопку, чтобы пользователь сразу видел открытый экран.
  const handleAction = useCallback((action: ChatAction) => {
    const nav = action.type === 'navigate' ? action.param
      : action.type === 'open_catalog' ? 'catalog'
      : action.type === 'open_chat' ? 'chat'
      : action.type === 'open_orders' ? 'orders'
      : action.type === 'open_support' ? 'support'
      : action.type === 'open_analytics' ? 'analytics'
      : action.type === 'open_films' ? 'video'
      : action.type === 'open_music' ? 'audio'
      : action.type === 'open_media' ? 'media'
      : null
    if (nav && onNavigate) {
      onNavigate(nav)
      // v6: AI сворачивается — пользователь видит открытый раздел
      minimize()
    } else if (action.type === 'open_cart' && onOpenCart) {
      onOpenCart()
      minimize()
    } else if (action.type === 'open_checkout') {
      window.dispatchEvent(new CustomEvent('open-checkout'))
      minimize()
    } else if (action.type === 'play_music') {
      if (onNavigate) onNavigate('audio')
      minimize()
    } else if (action.type === 'search_product' && action.param) {
      if (onNavigate) {
        onNavigate('catalog')
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('999pro:search', { detail: { query: action.param } }))
        }, 300)
      }
      minimize()
    } else if (action.type === 'search_query' && action.param) {
      if (onNavigate) {
        onNavigate('audio')
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open-audio-hub', { detail: { query: action.param, autoplay: true } }))
        }, 300)
      }
      minimize()
    } else if (action.type === 'play_audio_query' && action.param) {
      if (onNavigate) {
        onNavigate('audio')
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open-audio-hub', { detail: { query: action.param, autoplay: true } }))
        }, 300)
      }
      minimize()
    } else if (action.type === 'open_product') {
      const productId = action.param!
      if (onOpenProduct) onOpenProduct(productId)
      else window.dispatchEvent(new CustomEvent('999pro:open-product', { detail: { productId } }))
      minimize()
    } else if (action.type === 'show_contacts') {
      processMessage('Покажи контакты')
    }
  }, [onNavigate, onOpenProduct, onOpenCart, processMessage, minimize])

  const handleOpenProduct = useCallback((productId: string) => {
    if (onOpenProduct) onOpenProduct(productId)
    else window.dispatchEvent(new CustomEvent('999pro:open-product', { detail: { productId } }))
  }, [onOpenProduct])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAssistant()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeAssistant])

  const handleKeyboardSubmit = useCallback(() => {
    const text = input.trim()
    if (!text) return
    setInput('')
    processMessage(text)
  }, [input, processMessage])

  // v6: Текущий статус-текст для отображения
  const meta = PHASE_META[phase]
  const statusText = phase === 'listening' && (interim || accumulatedText)
    ? (interim || accumulatedText)
    : meta.label

  return (
    <>
      {/* v6: Главная плавающая кнопка AI (когда overlay закрыт).
          v24.4: скрыта в чате — там она перекрывает кнопку записи
          голосового сообщения. В чате используется только голосовой
          рекордер, AI Agent доступен из других разделов. */}
      <FloatingAIButton onClick={openAssistant} hidden={open || context === 'chat'} />

      {/* v6: Минимизированная плавающая кнопка AI — показывается когда AI
          свёрнут после открытия раздела приложения. Пользователь может
          одним тапом вернуть AI в полный режим. */}
      <AnimatePresence>
        {minimized && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            onClick={restore}
            className="md:hidden fixed right-4 z-[290] grid place-items-center overflow-visible select-none cursor-pointer"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 84px)',
              height: 56,
              width: 56,
              borderRadius: 999,
            }}
            aria-label="Вернуться к AI"
          >
            {/* Pulse glow — мягкое свечение */}
            <motion.span
              className="absolute inset-0 rounded-full blur-lg pointer-events-none"
              animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.1, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                background: 'radial-gradient(circle, rgba(139,92,246,0.45) 0%, rgba(99,102,241,0.25) 40%, transparent 70%)',
              }}
            />
            {/* Glass body */}
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
            {/* Indigo dot indicator (AI active) */}
            <span
              className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full z-20"
              style={{
                background: '#10b981',
                boxShadow: '0 0 6px rgba(16,185,129,0.8)',
                border: '1.5px solid rgba(255,255,255,0.6)',
              }}
            />
            <motion.div
              animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              className="relative"
              style={{ filter: 'drop-shadow(0 0 8px rgba(139,92,246,0.6))' }}
            >
              <Sparkles className="h-6 w-6" strokeWidth={2.3} style={{ color: '#a78bfa' }} />
            </motion.div>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && !minimized && (
          <motion.div
            // v24.3: Keyboard fix — use 100dvh (dynamic viewport height) which
            // automatically resizes when the mobile keyboard opens/closes.
            // This is the modern CSS standard (Safari 15.4+, Chrome 108+) and
            // provides smooth, native keyboard handling WITHOUT manual
            // visualViewport tracking. The overlay stays pinned to the visible
            // area (above the keyboard), the input field sits at the bottom
            // right above the keyboard, and no content shifts below.
            // Fallback: if dvh is somehow not supported, 100vh is used (the
            // browser will handle keyboard overlap as best it can).
            className="fixed inset-0 z-[300] flex flex-col"
            style={{
              height: '100dvh',
              top: '0px',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Premium фон — глубокий blur + объёмный градиент + световые пятна */}
            <div
              className="absolute inset-0 backdrop-blur-3xl"
              style={{
                background: 'radial-gradient(circle at 50% 20%, rgba(99,102,241,0.18) 0%, rgba(15,23,42,0.7) 40%, rgba(0,0,0,0.92) 100%)',
              }}
            />
            {/* Световые пятна — анимированные */}
            <motion.div
              className="absolute top-0 left-0 h-[400px] w-[400px] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.25) 0%, transparent 70%)', filter: 'blur(40px)' }}
              animate={{ x: [0, 60, 0], y: [0, 40, 0], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.22) 0%, transparent 70%)', filter: 'blur(50px)' }}
              animate={{ x: [0, -80, 0], y: [0, -50, 0], opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute top-1/3 left-1/2 h-[300px] w-[300px] rounded-full pointer-events-none -translate-x-1/2"
              style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)', filter: 'blur(30px)' }}
              animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Header */}
            <div className="relative shrink-0 px-5 pt-5 pb-3 flex items-center justify-between" style={{ paddingTop: 'max(env(safe-area-inset-top), 20px)' }}>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shadow-lg shadow-violet-500/30">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-1.5">
                    {status?.assistantName || 'Агент 999'}
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  {/* v7: показываем эмодзи + лейбл текущей фазы */}
                  <div className="text-[10px] text-white/50 tracking-wide flex items-center gap-1">
                    <span>{meta.emoji}</span>
                    <span style={{ color: meta.color }}>{meta.label}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* v24.3: Voice-only mode — текстовый ввод полностью удалён.
                    Главный AI Agent работает ТОЛЬКО голосом. Кнопка клавиатуры
                    и переключатель режимов убраны. Остаются только:
                    очистка истории (если есть) и закрыть. */}
                {conversationLog.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="p-2 rounded-full bg-white/10 text-white hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                    aria-label="Очистить историю"
                    title="Очистить историю"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button onClick={closeAssistant} className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors" aria-label="Закрыть">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* v8: ГЛАВНАЯ ОБЛАСТЬ КОНТЕНТА
                Единый чат-режим:
                  • Если есть история — показываем compact NeonCore + чат-пузыри + текущий ответ
                  • Если истории нет — полноэкранный NeonCore (idle)
                Прокрутка всегда включена — пользователь может прокрутить вверх по истории.
                v11: добавлен min-h-0 — критично для flexbox + overflow-y-auto.
                Без min-h-0 flex-1 дочерний элемент может не скроллиться правильно
                на некоторых браузерах, и длинные сообщения обрезаются снизу. */}
            <div
              ref={scrollContainerRef}
              className="relative flex-1 min-h-0 flex flex-col overscroll-contain px-5 overflow-y-auto"
              style={{
                touchAction: 'pan-y',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'thin',
                overscrollBehavior: 'contain',
              }}
              data-scroll-lock-ignore
            >
              {/* v16: СТАРТОВАЯ АНИМАЦИЯ — только до начала диалога.
                  Условие: нет истории И нет ответа И нет текущего запроса И
                  пользователь ещё не отправлял сообщения И не отправляет сейчас
                  И нет распознаваемого текста.
                  Как только любое из условий нарушено — анимация исчезает НАВСЕГДА
                  (до повторного открытия AI). */}
              {conversationLog.length === 0 && !response && !userQuery && !hasUserSentMessage && !sending && !(phase === 'listening' && (interim || accumulatedText)) && (
                <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto gap-10 py-6">
                  <NeonCore phase={phase} onClick={toggleMic} />

                  {/* v10: увеличен верхний отступ (mt-4) — текст опущен ниже микрофона */}
                  <div className="text-center min-h-[80px] flex flex-col items-center justify-center w-full mt-4">
                    {phase === 'listening' && (interim || accumulatedText) ? (
                      <motion.p
                        key={interim || accumulatedText}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-white text-lg font-medium max-w-md leading-relaxed"
                      >
                        {interim || accumulatedText}
                      </motion.p>
                    ) : phase === 'listening' ? (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-white/90 text-base font-medium">Слушаю вас…</p>
                        <p className="text-white/40 text-xs">Говорите — я отвечу, когда вы закончите</p>
                      </div>
                    ) : phase === 'idle' ? (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-white/90 text-base font-medium">Нажмите и говорите</p>
                        <p className="text-white/40 text-xs">Разговор пойдёт автоматически — можно перебивать</p>
                      </div>
                    ) : (
                      <p className="text-white/90 text-base font-medium">{statusText}</p>
                    )}
                  </div>

                  <ScanWave active={phase !== 'idle'} color={meta.color} />

                  {continuousVoice && (phase === 'listening' || phase === 'idle') && (
                    <motion.button
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={endConversation}
                      whileTap={{ scale: 0.95 }}
                      className="mt-2 px-5 py-2.5 rounded-full text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors flex items-center gap-2"
                    >
                      <span className="h-2 w-2 rounded-full bg-red-400" />
                      Завершить разговор
                    </motion.button>
                  )}
                </div>
              )}

              {/* v14: ЧАТ-РЕЖИМ — compact NeonCore + чат-история + текущий ответ.
                  Также показывается когда пользователь начинает говорить (interim/accumulatedText)
                  даже если истории ещё нет — распознаваемый текст появится как новое сообщение. */}
              {(conversationLog.length > 0 || response || (phase === 'listening' && (interim || accumulatedText)) || sending) && (
                <div className="flex flex-col w-full max-w-2xl mx-auto py-3 gap-3">
                  {/* v11: Sticky-блок для NeonCore + phase label.
                      • Плавный fade-out при прокрутке (opacity 1 → 0 в диапазоне 0–120px)
                      • Без чёрной подложки — фон прозрачный
                      • pointer-events: none ВСЕГДА — индикатор не интерактивный,
                        клики проходят сквозь него к сообщениям под ним
                      • Сообщения визуально "заезжают под" анимацию (z-index: sticky=10, messages=0)
                      • Не уезжает за пределы экрана — всегда sticky top-0 */}
              {/* v24.3: REMOVED the sticky phase-label pill + compact NeonCore
                  from the chat feed entirely.
                  User requested: status should only appear (1) in the header
                  subtitle at the top, and (2) as a loading indicator at the
                  bottom (the "Думаю…" bubble below). The sticky pill that
                  showed "Проверяю товары…" / "Думаю…" / etc. inside the chat
                  area was redundant and cluttered the message feed.
                  The scroll fade effect (stickyOpacity) is no longer needed
                  but the state is harmless — left as-is to minimize changes. */}

                  {/* Отступ после sticky — компенсируем высоту */}
                  <div className="h-1 shrink-0" />

                  {/* Чат-история — все прошлые вопросы/ответы */}
                  {conversationLog.map((entry, i) => {
                    const isLast = i === conversationLog.length - 1
                    const showTypingForThis = isLast && isTyping && response?.id === entry.response.id
                    return (
                      <div key={i} className="flex flex-col gap-3">
                        {/* User bubble */}
                        <ChatBubble role="user" text={entry.userQuery} />
                        {/* AI bubble — для последнего с typing animation */}
                        <ChatBubble
                          role="assistant"
                          response={entry.response}
                          isTyping={showTypingForThis}
                          displayedText={showTypingForThis ? displayedText : undefined}
                          onAction={handleAction}
                          onOpenProduct={handleOpenProduct}
                        />
                      </div>
                    )
                  })}

                  {/* v14: Voice transcription — распознаваемый текст как новое сообщение
                      пользователя ВНИЗУ чата (после истории), а не сверху.
                      Постепенно заполняется по мере распознавания речи.
                      После завершения — сообщение отправляется AI (auto-send).
                      v24.3: removed inputMode check — voice-only mode now. */}
                  {phase === 'listening' && (interim || accumulatedText) && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-end"
                    >
                      <div
                        className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md text-white text-sm leading-relaxed shadow-lg"
                        style={{
                          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                          boxShadow: '0 4px 16px -4px rgba(99,102,241,0.4)',
                        }}
                      >
                        {/* Показываем accumulated (накопленный final) + interim (текущий) */}
                        {accumulatedText && <span>{accumulatedText} </span>}
                        {interim && <span className="opacity-80">{interim}</span>}
                        {/* Мигающий курсор — показывает что запись идёт */}
                        <span className="inline-block w-[2px] h-[1.1em] ml-0.5 align-text-bottom bg-white/80 animate-pulse" />
                      </div>
                    </motion.div>
                  )}

                  {/* "Думаю..." — индикатор загрузки когда AI обрабатывает запрос.
                      v9: показываем ДИНАМИЧЕСКИЙ статус (Проверяю товары... / Считаю... / Думаю...) */}
                  {sending && !isTyping && (
                    <div className="flex justify-start">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center shrink-0">
                            <Sparkles className="h-3 w-3 text-white" />
                          </div>
                          <span className="text-[10px] text-white/40 uppercase tracking-wide">AI</span>
                        </div>
                        <div className="px-4 py-2.5 rounded-2xl rounded-tl-md bg-white/5 border border-white/10 backdrop-blur-sm flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                          <span className="text-sm text-white/70">
                            {dynamicStatus || `${meta.label}…`}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bottom spacing */}
                  <div className="h-4 shrink-0" />
                </div>
              )}

              {/* v24.3: REMOVED keyboard-mode empty state and bottom input bar.
                  Главный AI Agent теперь работает ТОЛЬКО голосом.
                  Текстовое поле ввода, кнопка отправки, кнопка переключения
                  на клавиатуру — всё удалено. Чат занимает всю высоту до
                  низа экрана. Голосовой режим управляется через NeonCore
                  (центральная кнопка микрофона) и кнопку "Завершить разговор". */}
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
