'use client'

// ============================================================================
// v25.24 — «Угадай слово» (редизайн: клавиатура была «ужас»).
//   • Клавиатура ЙЦУКЕН в стиле современных вордов: выпуклые клавиши,
//     мягкие тени, крупные буквы, состояния (угадано/мимо) — сразу понятны.
//   • Слоты слова — плитки с подъёмом и свечением при открытии.
//   • Логика v25.23 не тронута: 5 сердец, 225 слов, очки за скорость.
//   • Тема: все цвета через --g-* токены GameShell.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, Play, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'
import { WORDS } from '@/lib/games/quiz-words'

const ROWS = [
  'ЙЦУКЕНГШЩЗХЪ'.split(''),
  'ФЫВАПРОЛДЖЭ'.split(''),
  'ЯЧСМИТЬБЮЁ'.split(''),
]

const ALPHABET = new Set(ROWS.flat())

interface Round {
  word: string
  hint: string
  theme: string
}

const THEME_EMOJI: Record<string, string> = {
  animals: '🐾', food: '🍎', city: '🏙️', nature: '🌲', tech: '💡', sport: '⚽', home: '🏠', art: '🎨',
}

function nextRound(usedCodes: Set<string>): Round {
  const pool = WORDS.filter((w) => !usedCodes.has(w.word))
  const src = pool.length > 0 ? pool : WORDS
  const w = src[Math.floor(Math.random() * src.length)]
  usedCodes.add(w.word)
  return { word: w.word, hint: w.hint, theme: w.theme }
}

export function WordsGame() {
  const [phase, setPhase] = useState<'idle' | 'play' | 'end'>('idle')
  const [round, setRound] = useState<Round | null>(null)
  const [opened, setOpened] = useState<string[]>([])
  const [guessed, setGuessed] = useState<Set<string>>(new Set())
  const [lives, setLives] = useState(5)
  const [score, setScore] = useState(0)
  const [solved, setSolved] = useState(0)
  const [flash, setFlash] = useState<null | 'win' | 'fail'>(null)
  const [best, submitBest] = useBest('words')
  const usedRef = useRef<Set<string>>(new Set())
  const scoredRef = useRef(false)

  const dealWord = useCallback(() => {
    setRound(nextRound(usedRef.current))
    setOpened([])
    setGuessed(new Set())
  }, [])

  const start = useCallback(() => {
    usedRef.current = new Set()
    setLives(5)
    setScore(0)
    setSolved(0)
    scoredRef.current = false
    dealWord()
    setPhase('play')
    sfx.whoosh(1)
  }, [dealWord])

  const endGame = useCallback(
    (finalScore: number) => {
      if (!scoredRef.current) {
        scoredRef.current = true
        submitBest(finalScore)
      }
      setPhase('end')
      sfx.lose()
    },
    [submitBest],
  )

  useEffect(() => {
    if (phase !== 'play' || !round) return
    const done = round.word.split('').every((ch) => opened.includes(ch))
    if (done && flash === null) {
      const bonus = 10 * round.word.length + lives * 20
      setScore((s) => s + bonus)
      setSolved((n) => n + 1)
      setFlash('win')
      sfx.win()
      const t = window.setTimeout(() => {
        setFlash(null)
        dealWord()
      }, 1400)
      return () => window.clearTimeout(t)
    }
  }, [opened, round, phase, lives, flash, dealWord])

  const pressLetter = useCallback(
    (letter: string) => {
      if (phase !== 'play' || !round || flash || guessed.has(letter) || !ALPHABET.has(letter)) return
      const next = new Set(guessed)
      next.add(letter)
      setGuessed(next)

      if (round.word.includes(letter)) {
        setOpened((o) => [...o, letter])
        sfx.reveal()
      } else {
        const left = lives - 1
        setLives(left)
        sfx.wrong()
        if (left <= 0) {
          setOpened(round.word.split(''))
          window.setTimeout(() => endGame(score), 1200)
        }
      }
    },
    [phase, round, flash, guessed, lives, score, endGame],
  )

  useEffect(() => {
    if (phase !== 'play') return
    const onKey = (e: KeyboardEvent) => {
      const ch = (e.key || '').toUpperCase()
      if (ALPHABET.has(ch) && ch !== 'Ё') pressLetter(ch)
      else if (ch === 'Ё') pressLetter('Ё')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, pressLetter])

  if (phase === 'idle') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-5 px-6">
        <div
          className="h-24 w-24 rounded-[28px] grid place-items-center text-5xl"
          style={{ background: 'linear-gradient(140deg,#A855F7,#7C3AED)', boxShadow: '0 20px 50px -18px rgba(168,85,247,0.55)' }}
        >
          🔤
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>Угадай слово</h2>
          <p className="text-sm mt-2 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--g-fg-soft)' }}>
            Открывай буквы по подсказке. 5 сердец на всю партию — трать их с умом!
          </p>
        </div>
        {best > 0 && (
          <div className="rounded-full px-4 py-1.5 bg-[var(--g-chip)] border border-[var(--g-chip-border)] text-sm font-bold" style={{ color: 'var(--g-fg-soft)' }}>
            🏆 Рекорд: {best.toLocaleString('ru-RU')}
          </div>
        )}
        <button
          onClick={start}
          className="h-14 px-10 rounded-2xl text-white text-lg font-extrabold transition-transform active:scale-95 hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg,#A855F7,#7C3AED)', boxShadow: '0 18px 40px -14px rgba(168,85,247,0.6)' }}
        >
          <span className="inline-flex items-center gap-2"><Play className="h-5 w-5 fill-current" /> Играть</span>
        </button>
      </div>
    )
  }

  if (phase === 'end') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
        <div className="text-7xl">{solved >= 5 ? '🧠' : '💜'}</div>
        <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>Слова кончились!</h2>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl px-5 py-3 bg-[var(--g-card)] border border-[var(--g-border)]">
            <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>Очки</div>
            <div className="text-2xl font-extrabold tabular-nums text-purple-500 dark:text-purple-400">{score.toLocaleString('ru-RU')}</div>
          </div>
          <div className="rounded-2xl px-5 py-3 bg-[var(--g-card)] border border-[var(--g-border)]">
            <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>Отгадано</div>
            <div className="text-2xl font-extrabold tabular-nums" style={{ color: 'var(--g-fg)' }}>{solved}</div>
          </div>
        </div>
        <p className="text-xs" style={{ color: 'var(--g-fg-mute)' }}>Рекорд: {best.toLocaleString('ru-RU')}</p>
        <button
          onClick={start}
          className="h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#A855F7,#7C3AED)' }}
        >
          <RotateCcw className="h-[18px] w-[18px]" /> Ещё раз
        </button>
      </div>
    )
  }

  const wordSlots = round?.word.split('') ?? []

  return (
    <div className="h-full flex flex-col px-2 md:px-6 py-3 max-w-xl mx-auto w-full gap-2.5">
      {/* шапка: счёт + сердца */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-sm font-extrabold tabular-nums text-purple-500 dark:text-purple-400">{score.toLocaleString('ru-RU')} очков</div>
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.span key={i} animate={i >= lives ? { scale: [1, 1.35, 0.85], opacity: 0.25 } : { scale: 1 }}>
              <Heart
                className={['h-[18px] w-[18px]', i < lives ? 'fill-rose-500 text-rose-500' : 'text-[var(--g-fg-mute)]'].join(' ')}
              />
            </motion.span>
          ))}
        </div>
      </div>

      {/* слоты слова */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
        <AnimatePresence>
          {flash === 'win' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-2xl font-extrabold text-emerald-500 dark:text-emerald-400"
            >
              ✅ Верно! +{(round ? 10 * round.word.length : 0) + lives * 20}
            </motion.div>
          )}
          {flash === null && lives === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-2xl font-extrabold text-rose-500 dark:text-rose-400">
              💔 Это было «{round?.word}»
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-wrap justify-center gap-1.5">
          {wordSlots.map((ch, i) => {
            const open = opened.includes(ch)
            return (
              <motion.span
                key={`${round?.word}-${i}`}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: i * 0.04 }}
                className={[
                  'h-11 md:h-13 w-8 md:w-10 rounded-xl grid place-items-center text-xl md:text-2xl font-extrabold transition-all duration-200',
                ].join(' ')}
                style={{
                  background: open ? 'linear-gradient(160deg, rgba(168,85,247,0.24), rgba(124,58,237,0.16))' : 'var(--g-card)',
                  color: open ? 'var(--g-fg)' : 'transparent',
                  border: '1.5px solid',
                  borderColor: open ? '#A855F7' : 'var(--g-border)',
                  boxShadow: open
                    ? '0 6px 18px -6px rgba(168,85,247,0.55), inset 0 -3px 0 rgba(124,58,237,0.25)'
                    : 'inset 0 -3px 0 var(--g-border)',
                }}
              >
                {ch}
              </motion.span>
            )
          })}
        </div>

        {/* подсказка */}
        <div className="rounded-2xl px-4 py-2.5 bg-[var(--g-card)] border border-[var(--g-border)] text-center max-w-md" style={{ boxShadow: 'var(--g-shadow)' }}>
          <span className="text-base mr-1.5">{THEME_EMOJI[round?.theme ?? ''] || '✨'}</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--g-fg-soft)' }}>{round?.hint}</span>
        </div>
      </div>

      {/* клавиатура ЙЦУКЕН — Wordle-стиль */}
      <div className="flex flex-col items-center gap-[5px] pb-1.5 w-full">
        {ROWS.map((row, ri) => (
          <div key={ri} className="flex justify-center gap-[4px] w-full max-w-[430px]">
            {row.map((letter) => {
              const used = guessed.has(letter)
              const hit = used && round?.word.includes(letter)
              return (
                <button
                  key={letter}
                  onClick={() => pressLetter(letter)}
                  disabled={used}
                  className="flex-1 h-11 md:h-12 rounded-[9px] text-[13.5px] md:text-[15px] font-extrabold transition-all duration-100 active:translate-y-[1px] active:scale-[0.97] disabled:active:translate-y-0 grid place-items-center"
                  style={{
                    background: used
                      ? hit
                        ? 'linear-gradient(160deg,#34D399,#059669)'
                        : 'var(--g-chip)'
                      : 'linear-gradient(180deg, var(--g-card-solid), var(--g-card))',
                    color: used ? (hit ? '#fff' : 'var(--g-fg-mute)') : 'var(--g-fg)',
                    border: '1px solid',
                    borderColor: used ? (hit ? '#059669' : 'transparent') : 'var(--g-border)',
                    boxShadow: used
                      ? hit
                        ? '0 3px 10px -3px rgba(5,150,105,0.55)'
                        : 'none'
                      : '0 2px 0 var(--g-border), 0 4px 10px -4px rgba(0,0,0,0.28)',
                    opacity: used && !hit ? 0.55 : 1,
                  }}
                >
                  {letter}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
