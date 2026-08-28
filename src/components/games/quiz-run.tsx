'use client'

// ============================================================================
// v25.23 — ИГРОВОЙ КЛУБ: универсальный движок викторин.
// Один флоу на три игры: «Угадай флаг», «Угадай столицу», «Спорт-викторина».
//   Старт-экран (опц. дополнительные контролы — чипы категорий) →
//   N вопросов с таймером → мгновенная проверка → экран результата.
// Вопросы генерирует колбэк makeQuestions() на каждый забег.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Play, RotateCcw, Timer, Trophy } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

export interface QuizQ {
  prompt: string
  sub?: string
  options: [string, string, string, string]
  correct: number
  /** показать SVG-флаг страны вместо текстового промпта */
  flagCode?: string
}

export interface QuizRunProps {
  id: string
  title: string
  emoji: string
  accent: string
  desc: string
  questionsPerRun: number
  timePerQuestion: number
  makeQuestions: () => QuizQ[]
  /** дополнительный блок на старт-экране (например, выбор категории) */
  extraStart?: (start: () => void) => ReactNode
}

export function QuizRun({
  id,
  title,
  emoji,
  accent,
  desc,
  questionsPerRun,
  timePerQuestion,
  makeQuestions,
  extraStart,
}: QuizRunProps) {
  const [phase, setPhase] = useState<'start' | 'play' | 'result'>('start')
  const [questions, setQuestions] = useState<QuizQ[]>([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [maxStreak, setMaxStreak] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const [timeLeft, setTimeLeft] = useState(timePerQuestion)
  const [best, submitBest] = useBest(id)
  const scoredRef = useRef(false)

  const start = useCallback(() => {
    const qs = makeQuestions()
    if (!qs.length) return
    setQuestions(qs)
    setIdx(0)
    setPicked(null)
    setScore(0)
    setStreak(0)
    setMaxStreak(0)
    setCorrectCount(0)
    setTimeLeft(timePerQuestion)
    scoredRef.current = false
    setPhase('play')
    sfx.whoosh(1)
  }, [makeQuestions, timePerQuestion])

  const answer = useCallback(
    (i: number | null) => {
      if (picked !== null || phase !== 'play') return
      const q = questions[idx]
      if (!q) return
      setPicked(i ?? -1)
      if (i === q.correct) {
        const timeBonus = Math.round(timeLeft * 5)
        const streakBonus = streak >= 2 ? 50 : 0
        setScore((s) => s + 100 + timeBonus + streakBonus)
        setStreak((s) => {
          const n = s + 1
          setMaxStreak((m) => Math.max(m, n))
          return n
        })
        setCorrectCount((c) => c + 1)
        sfx.correct()
      } else {
        setStreak(0)
        sfx.wrong()
      }
      // пауза на просмотр результата ответа → следующий вопрос
      window.setTimeout(() => {
        if (idx + 1 >= questions.length) {
          setPhase('result')
        } else {
          setIdx((v) => v + 1)
          setPicked(null)
          setTimeLeft(timePerQuestion)
          scoredRef.current = false
        }
      }, 1150)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, phase, questions, idx, streak, timePerQuestion],
  )

  // таймер вопроса
  useEffect(() => {
    if (phase !== 'play' || picked !== null) return
    const started = Date.now()
    const total = timePerQuestion * 1000
    const iv = window.setInterval(() => {
      const left = Math.max(0, total - (Date.now() - started))
      setTimeLeft(left / 1000)
      const sec = Math.ceil(left / 1000)
      if (sec <= 5 && sec > 0) sfx.tick()
      if (left <= 0) {
        window.clearInterval(iv)
        answer(null)
      }
    }, 100)
    return () => window.clearInterval(iv)
  }, [phase, picked, idx, timePerQuestion, answer])

  useEffect(() => {
    if (phase === 'result' && !scoredRef.current) {
      scoredRef.current = true
      if (score > 0) {
        const isRecord = submitBest(score)
        if (isRecord) window.setTimeout(() => sfx.win(), 350)
      }
    }
  }, [phase, score, submitBest])

  const q = questions[idx]
  const timeFrac = Math.max(0, Math.min(1, timeLeft / timePerQuestion))

  return (
    <div className="h-full flex flex-col px-4 py-4 md:py-6 max-w-2xl mx-auto w-full">
      <AnimatePresence mode="wait">
        {/* ─────────── СТАРТ ─────────── */}
        {phase === 'start' && (
          <motion.div
            key="start"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            className="flex-1 flex flex-col items-center justify-center text-center gap-5"
          >
            <div
              className="h-24 w-24 rounded-[28px] grid place-items-center text-5xl shadow-2xl"
              style={{ background: `linear-gradient(140deg, ${accent} 0%, ${accent}88 100%)`, boxShadow: `0 20px 50px -18px ${accent}66` }}
            >
              {emoji}
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-[var(--g-fg)] tracking-tight">{title}</h2>
              <p className="text-sm md:text-[15px] text-[var(--g-fg-soft)] mt-2 max-w-sm mx-auto leading-relaxed">{desc}</p>
            </div>

            {best > 0 && (
              <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 bg-[var(--g-btn)] border border-[var(--g-chip-border)] text-[var(--g-fg-soft)] text-sm font-bold">
                <Trophy className="h-4 w-4" style={{ color: accent }} />
                Рекорд: {best.toLocaleString('ru-RU')}
              </div>
            )}

            {extraStart?.(start)}

            <button
              onClick={start}
              className="group relative h-14 px-10 rounded-2xl text-white text-lg font-extrabold tracking-tight transition-transform active:scale-95 hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, boxShadow: `0 18px 40px -14px ${accent}80` }}
            >
              <span className="inline-flex items-center gap-2">
                <Play className="h-5 w-5 fill-current" /> Играть
              </span>
            </button>
            <p className="text-[11px] text-white/35">{questionsPerRun} вопросов · {timePerQuestion} сек на ответ</p>
          </motion.div>
        )}

        {/* ─────────── ИГРА ─────────── */}
        {phase === 'play' && q && (
          <motion.div
            key={`play-${idx}`}
            initial={{ opacity: 0, x: 26 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -26 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex-1 flex flex-col gap-4 min-h-0"
          >
            {/* верхняя строка: прогресс + счёт */}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-[var(--g-fg-mute)] tracking-wide uppercase">
                Вопрос {idx + 1} / {questions.length}
              </div>
              <div className="flex items-center gap-2">
                {streak >= 2 && (
                  <motion.span
                    key={streak}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="inline-flex items-center gap-1 text-xs font-extrabold rounded-full px-2.5 py-1 text-white"
                    style={{ background: 'linear-gradient(135deg,#F97316,#EF4444)' }}
                  >
                    <Flame className="h-3.5 w-3.5" /> {streak} подряд
                  </motion.span>
                )}
                <span className="text-sm font-extrabold tabular-nums" style={{ color: accent }}>
                  {score.toLocaleString('ru-RU')}
                </span>
              </div>
            </div>

            {/* таймер */}
            <div className="h-1.5 rounded-full bg-[var(--g-btn)] overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-100 ease-linear"
                style={{
                  width: `${timeFrac * 100}%`,
                  background: timeFrac > 0.3 ? `linear-gradient(90deg, ${accent}, ${accent}99)` : 'linear-gradient(90deg,#F97316,#EF4444)',
                  boxShadow: `0 0 12px ${timeFrac > 0.3 ? accent : '#EF4444'}55`,
                }}
              />
            </div>

            {/* промпт */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center">
              {q.flagCode && (
                <motion.img
                  key={q.flagCode}
                  initial={{ opacity: 0, scale: 0.9, rotate: -1.5 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  src={`/flags/4x3/${q.flagCode}.svg`}
                  alt=""
                  draggable={false}
                  className="h-24 md:h-32 w-auto rounded-xl shadow-2xl ring-1 ring-white/15"
                  style={{ boxShadow: '0 24px 50px -20px rgba(0,0,0,0.7)' }}
                />
              )}
              <h3 className="text-lg md:text-2xl font-extrabold text-[var(--g-fg)] tracking-tight leading-snug">{q.prompt}</h3>
              {q.sub && <p className="text-xs md:text-sm text-[var(--g-fg-mute)]">{q.sub}</p>}
            </div>

            {/* варианты */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pb-2">
              {q.options.map((opt, i) => {
                const isCorrect = i === q.correct
                const isPicked = picked === i
                const revealed = picked !== null
                return (
                  <motion.button
                    key={`${idx}-${i}`}
                    onClick={() => answer(i)}
                    disabled={revealed}
                    whileTap={revealed ? undefined : { scale: 0.97 }}
                    className={[
                      'min-h-[52px] px-4 rounded-2xl text-left text-[15px] md:text-base font-bold tracking-tight',
                      'border transition-all duration-200 grid place-items-center text-center',
                      revealed && isCorrect
                        ? 'text-white'
                        : revealed && isPicked
                          ? 'text-white'
                          : revealed
                            ? 'text-white/35'
                            : 'text-[var(--g-fg-soft)] hover:bg-[var(--g-btn)] active:scale-[0.98]',
                    ].join(' ')}
                    style={{
                      background: revealed && isCorrect
                        ? 'linear-gradient(135deg,#059669,#10B981)'
                        : revealed && isPicked
                          ? 'linear-gradient(135deg,#DC2626,#EF4444)'
                          : 'rgba(255,255,255,0.055)',
                      borderColor: revealed && isCorrect ? 'rgba(16,185,129,0.6)' : revealed && isPicked ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.09)',
                      boxShadow: revealed && isCorrect ? '0 12px 30px -12px rgba(16,185,129,0.55)' : 'none',
                      animation: revealed && isPicked ? 'shake 0.4s ease' : undefined,
                    }}
                  >
                    {opt}
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        )}

        {/* ─────────── РЕЗУЛЬТАТ ─────────── */}
        {phase === 'result' && (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center text-center gap-4"
          >
            <div className="text-6xl">{correctCount >= questions.length * 0.8 ? '🏆' : correctCount >= questions.length * 0.5 ? '🎉' : '😅'}</div>
            <h2 className="text-2xl font-extrabold text-[var(--g-fg)] tracking-tight">
              {correctCount} из {questions.length} верно
            </h2>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl px-5 py-3 bg-[var(--g-btn)] border border-[var(--g-chip-border)]">
                <div className="text-[10px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold">Очки</div>
                <div className="text-2xl font-extrabold tabular-nums" style={{ color: accent }}>{score.toLocaleString('ru-RU')}</div>
              </div>
              <div className="rounded-2xl px-5 py-3 bg-[var(--g-btn)] border border-[var(--g-chip-border)]">
                <div className="text-[10px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold">Рекорд</div>
                <div className="text-2xl font-extrabold tabular-nums text-[var(--g-fg)]">{best.toLocaleString('ru-RU')}</div>
              </div>
            </div>
            <p className="text-xs text-[var(--g-fg-mute)] inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" /> Макс. серия: {maxStreak}
            </p>
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={start}
                className="h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 transition-transform active:scale-95"
                style={{ background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, boxShadow: `0 14px 34px -12px ${accent}70` }}
              >
                <RotateCcw className="h-[18px] w-[18px]" /> Ещё раз
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          50% { transform: translateX(5px); }
          75% { transform: translateX(-3px); }
        }
      `}</style>
    </div>
  )
}
