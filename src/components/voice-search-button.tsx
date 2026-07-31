'use client'

// ============================================================================
// VoiceSearchButton — голосовой поиск через Web Speech API
// ----------------------------------------------------------------------------
// Переиспользуемый компонент для Audio Hub и Video Hub.
// Использует SpeechRecognition API (Chrome, Edge, Safari 14.5+, Android Chrome).
// В Firefox кнопка скрыта (API не поддерживается).
//
// UX:
//   • Клик → начинается запись
//   • Пульсирующий микрофон + анимированная волна во время записи
//   • После распознавания → текст подставляется в onResult callback
//   • Ошибка распознавания → красивое уведомление
//   • Отмена (повторный клик) → ничего не происходит
// ============================================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, X, Loader2 } from 'lucide-react'

interface VoiceSearchButtonProps {
  /** Called with the recognized text */
  onResult: (text: string) => void
  /** Language code for speech recognition (default: 'ru-RU') */
  lang?: string
  /** Size variant — 'sm' for compact search bars, 'md' for default */
  size?: 'sm' | 'md'
}

// Type declarations for Web Speech API (not in standard TS lib)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}
interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionResult {
  length: number
  isFinal: boolean
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}
interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  )
}

export function VoiceSearchButton({
  onResult,
  lang = 'ru-RU',
  size = 'sm',
}: VoiceSearchButtonProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const isSupported = !!getSpeechRecognition()

  const cleanup = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null
        recognitionRef.current.onerror = null
        recognitionRef.current.onend = null
        recognitionRef.current.onstart = null
        recognitionRef.current.abort()
      } catch {/* ignore */}
      recognitionRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  const startRecording = useCallback(() => {
    const SR = getSpeechRecognition()
    if (!SR) {
      setError('Голосовой поиск не поддерживается в этом браузере')
      setTimeout(() => setError(null), 3000)
      return
    }

    // Stop any existing recognition
    cleanup()

    const recognition = new SR()
    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setIsRecording(true)
      setInterimText('')
      setError(null)
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = ''
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }
      if (interim) setInterimText(interim)
      if (finalText) {
        const cleaned = finalText.trim()
        setInterimText(cleaned)
        setIsRecording(false)
        cleanup()
        if (cleaned) {
          onResult(cleaned)
        }
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsRecording(false)
      setInterimText('')
      cleanup()
      if (event.error === 'no-speech') {
        setError('Не удалось распознать речь. Попробуйте ещё раз.')
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Доступ к микрофону запрещён')
      } else if (event.error === 'aborted') {
        // User cancelled — do nothing
      } else {
        setError('Не удалось распознать речь. Попробуйте ещё раз.')
      }
      setTimeout(() => setError(null), 3000)
    }

    recognition.onend = () => {
      setIsRecording(false)
      // If we have interim text but no final, use it
      if (interimText) {
        const cleaned = interimText.trim()
        if (cleaned) onResult(cleaned)
      }
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch {
      setError('Не удалось запустить запись')
      setTimeout(() => setError(null), 3000)
    }
  }, [lang, onResult, cleanup, interimText])

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {/* ignore */}
    }
    setIsRecording(false)
    setInterimText('')
    cleanup()
  }, [cleanup])

  const handleClick = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  // Don't render if not supported
  if (!isSupported) return null

  const btnSize = size === 'sm' ? 'h-10 w-10' : 'h-11 w-11'
  const iconSize = size === 'sm' ? 'h-4.5 w-4.5' : 'h-5 w-5'

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.88 }}
        whileHover={{ scale: 1.06 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        onClick={handleClick}
        className={`shrink-0 ${btnSize} rounded-full grid place-items-center transition-colors relative ${
          isRecording ? 'text-white' : 'text-white/60 hover:text-white'
        }`}
        style={{
          background: isRecording
            ? 'linear-gradient(135deg, #ef4444 0%, #ec4899 100%)'
            : 'rgba(255,255,255,0.08)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          border: isRecording
            ? '1px solid rgba(255,255,255,0.3)'
            : '1px solid rgba(255,255,255,0.1)',
          boxShadow: isRecording
            ? '0 4px 20px -2px rgba(239,68,68,0.5)'
            : 'none',
        }}
        aria-label={isRecording ? 'Остановить запись' : 'Голосовой поиск'}
        title={isRecording ? 'Остановить запись' : 'Голосовой поиск'}
      >
        {isRecording ? (
          <>
            {/* Pulsing rings */}
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{ background: 'rgba(239,68,68,0.4)' }}
              animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <MicOff className={`${iconSize} relative z-10`} />
          </>
        ) : (
          <Mic className={`${iconSize}`} />
        )}
      </motion.button>

      {/* Recording overlay — full screen with animated wave */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[300] grid place-items-center"
            style={{
              background: 'rgba(5, 5, 15, 0.85)',
              backdropFilter: 'blur(20px) saturate(140%)',
              WebkitBackdropFilter: 'blur(20px) saturate(140%)',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) stopRecording()
            }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="flex flex-col items-center gap-6 p-8"
            >
              {/* Animated mic with scanning effect */}
              <div className="relative h-40 w-40 grid place-items-center">
                {/* Rotating scanning ring */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `conic-gradient(from 0deg, transparent 0%, rgba(99,102,241,0.4) 25%, rgba(139,92,246,0.6) 50%, rgba(236,72,153,0.4) 75%, transparent 100%)`,
                    filter: 'blur(2px)',
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                />
                {/* Inner rotating ring (opposite direction) */}
                <motion.div
                  className="absolute inset-3 rounded-full"
                  style={{
                    background: `conic-gradient(from 180deg, transparent 0%, rgba(236,72,153,0.3) 30%, transparent 60%)`,
                    filter: 'blur(3px)',
                  }}
                  animate={{ rotate: -360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                />
                {/* Outer pulsing glow */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)',
                  }}
                  animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0.3, 0.6] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
                {/* Pulsing rings */}
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
                {/* Floating particles */}
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute h-1.5 w-1.5 rounded-full"
                    style={{
                      background: i % 2 === 0 ? '#8b5cf6' : '#ec4899',
                      boxShadow: `0 0 6px ${i % 2 === 0 ? 'rgba(139,92,246,0.8)' : 'rgba(236,72,153,0.8)'}`,
                    }}
                    animate={{
                      x: [0, Math.cos((i * 60 * Math.PI) / 180) * 60, 0],
                      y: [0, Math.sin((i * 60 * Math.PI) / 180) * 60, 0],
                      opacity: [0, 1, 0],
                      scale: [0.5, 1, 0.5],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: i * 0.3,
                    }}
                  />
                ))}
                {/* Mic circle */}
                <motion.div
                  className="relative grid place-items-center h-24 w-24 rounded-full z-10"
                  style={{
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
                    boxShadow: '0 8px 40px -4px rgba(139,92,246,0.6)',
                    border: '2px solid rgba(255,255,255,0.25)',
                  }}
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Mic className="h-10 w-10 text-white" fill="currentColor" />
                </motion.div>
              </div>

              {/* Scanning wave — dynamic line */}
              <div className="relative w-48 h-10 overflow-hidden">
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 40" preserveAspectRatio="none">
                  <motion.path
                    d="M0,20 Q25,5 50,20 T100,20 T150,20 T200,20"
                    fill="none"
                    stroke="url(#waveGrad)"
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
                    <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
                      <stop offset="50%" stopColor="#8b5cf6" stopOpacity="1" />
                      <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              {/* Status text */}
              <div className="text-center min-h-[28px]">
                {interimText ? (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-lg font-medium text-white max-w-xs"
                  >
                    {interimText}
                  </motion.div>
                ) : (
                  <motion.div
                    className="text-sm text-white/60 flex items-center gap-2"
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
                    Анализ речи...
                  </motion.div>
                )}
              </div>

              {/* Cancel button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={stopRecording}
                className="px-5 py-2.5 rounded-full text-sm font-medium text-white/80 flex items-center gap-2"
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                <X className="h-4 w-4" />
                Отмена
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[310] px-4 py-3 rounded-2xl text-white text-sm font-medium flex items-center gap-2 max-w-[90vw]"
            style={{
              background: 'rgba(15,15,30,0.95)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(255,255,255,0.15)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            <div className="grid place-items-center h-5 w-5 rounded-full bg-red-500/20 shrink-0">
              <X className="h-3 w-3 text-red-400" />
            </div>
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
