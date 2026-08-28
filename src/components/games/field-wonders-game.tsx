'use client'

// ============================================================================
// v25.25 — «ПОЛЕ ЧУДЕС» — соло-игра в стиле телеигры.
//   • Барабан: 8 секторов (100…1500, БАНКРОТ, ×2) — conic-gradient, золотой
//     обод, 12 мерцающих лампочек, стрелка-указатель. Вращение framer-motion
//     (easeOutCubic, 2.6–3.4 с) + 13–18 тиков sfx.tick с замедлением.
//     Диск и подписи вращаются вместе; стрелка реально указывает на сектор.
//   • Раунды из FIELD_ROUNDS: перемешанная колода, без повторов за сессию.
//   • Слово — «плитки-клетки» с 3D-переворотом (backface) при открытии;
//     пробелы между словами видны сразу.
//   • Банк раунда: сектор × число позиций буквы. БАНКРОТ сжигает банк
//     (тряска, sfx.wrong); «×2» — множитель на следующий ход (сектор очков).
//   • Клавиатура ЙЦУКЕН как в words-game: попадание — золото (sfx.reveal),
//     мимо — −1 жизнь (всего 3, сердца, sfx.wrong). Подсказка — 500 из банка.
//   • Победа в раунде: sfx.win, конфетти, бонус +1000, «Следующее слово».
//     Поражение — экран со счётом и рекордом, «Ещё раз». Рекорд: useBest('field').
//   • Все цвета через CSS-токены --g-* (светлая/тёмная тема), золото #F59E0B.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Heart, Lightbulb, Play, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'
import { FIELD_ROUNDS, type FieldRound } from '@/lib/games/field-words'

/* ----------------------------- барабан ----------------------------- */

interface WheelSector {
  label: string
  /** >0 — очки · 0 — БАНКРОТ · -1 — ×2 */
  value: number
  color: string
}

const WHEEL: WheelSector[] = [
  { label: '500', value: 500, color: '#0E7490' },
  { label: 'БАНКРОТ', value: 0, color: '#111827' },
  { label: '250', value: 250, color: '#7C3AED' },
  { label: '1000', value: 1000, color: '#1D4ED8' },
  { label: '×2', value: -1, color: '#DB2777' },
  { label: '100', value: 100, color: '#047857' },
  { label: '1500', value: 1500, color: '#DC2626' },
  { label: '750', value: 750, color: '#B45309' },
]

const SECTORS = WHEEL.length
const SECTOR_ANGLE = 360 / SECTORS

// диск: сектор i занимает [i·45°, (i+1)·45°) по часовой от 12 часов
const CONIC = `conic-gradient(from 0deg, ${WHEEL.map(
  (s, i) => `${s.color} ${i * SECTOR_ANGLE}deg ${(i + 1) * SECTOR_ANGLE}deg`,
).join(', ')})`

const GOLD = '#F59E0B'
const WIN_BONUS = 1000

/* ---------------------------- клавиатура ---------------------------- */

const ROWS = ['ЙЦУКЕНГШЩЗХЪ'.split(''), 'ФЫВАПРОЛДЖЭ'.split(''), 'ЯЧСМИТЬБЮЁ'.split('')]
const ALPHABET = new Set(ROWS.flat())

/* ----------------------------- конфетти ----------------------------- */

interface ConfettiPiece {
  left: number
  delay: number
  dur: number
  drift: number
  size: number
  color: string
  rot: number
}

const CONFETTI_COLORS = ['#F59E0B', '#FBBF24', '#EC4899', '#38BDF8', '#34D399', '#A855F7']

const makeConfetti = (): ConfettiPiece[] =>
  Array.from({ length: 34 }, () => ({
    left: 3 + Math.random() * 94,
    delay: Math.random() * 0.7,
    dur: 1.8 + Math.random() * 1.4,
    drift: (Math.random() * 2 - 1) * 110,
    size: 6 + Math.random() * 7,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rot: Math.random() * 360,
  }))

/* ----------------------------- сообщения ----------------------------- */

interface Flash {
  text: string
  tone: 'good' | 'bad' | 'info'
}

/* ============================== игра ============================== */

export function FieldWondersGame() {
  const [phase, setPhase] = useState<'idle' | 'play' | 'won' | 'end'>('idle')
  const [round, setRound] = useState<FieldRound | null>(null)
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [guessed, setGuessed] = useState<Set<string>>(new Set())
  const [lives, setLives] = useState(3)
  const [score, setScore] = useState(0) // общий счёт за сессию
  const [pot, setPot] = useState(0) // банк текущего раунда
  const [sector, setSector] = useState(0) // активный сектор (0 = крути барабан)
  const [mult, setMult] = useState(1) // «×2» ждёт следующего сектора очков
  const [turnMult, setTurnMult] = useState(1) // множитель текущей букво-фазы
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [spinDur, setSpinDur] = useState(3)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [solved, setSolved] = useState(0)
  const [wonInfo, setWonInfo] = useState<{ pot: number; total: number } | null>(null)
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([])
  const [newRecord, setNewRecord] = useState(false)

  const [best, submitBest] = useBest('field')

  const deckRef = useRef<FieldRound[]>([])
  const rotationRef = useRef(0)
  const spinningRef = useRef(false)
  const timersRef = useRef<number[]>([])
  const scoreRef = useRef(0)
  const losingRef = useRef(false)
  const scoredRef = useRef(false)
  const shake = useAnimationControls()

  /** setTimeout с автозачисткой при размонтировании */
  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timersRef.current.push(id)
  }, [])

  useEffect(() => () => timersRef.current.forEach((id) => window.clearTimeout(id)), [])
  useEffect(() => {
    scoreRef.current = score
  }, [score])

  // всплывающие сообщения гаснут сами
  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 1900)
    return () => window.clearTimeout(t)
  }, [flash])

  /* ------------------------- раунды ------------------------- */

  const dealNewRound = useCallback(() => {
    losingRef.current = false
    // колода без повторов: перемешали — тянем по одной; кончилась — заново
    if (deckRef.current.length === 0) {
      const deck = [...FIELD_ROUNDS]
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      deckRef.current = deck
    }
    setRound(deckRef.current.pop() ?? null)
    setOpened(new Set())
    setGuessed(new Set())
    setPot(0)
    setSector(0)
    setMult(1)
    setTurnMult(1)
    setWonInfo(null)
    setConfetti([])
    setFlash(null)
  }, [])

  const startGame = useCallback(() => {
    losingRef.current = false
    scoredRef.current = false
    setScore(0)
    setLives(3)
    setSolved(0)
    setNewRecord(false)
    dealNewRound()
    setPhase('play')
    sfx.whoosh(1)
  }, [dealNewRound])

  const nextWord = useCallback(() => {
    dealNewRound()
    setPhase('play')
    sfx.whoosh(1)
  }, [dealNewRound])

  const endGame = useCallback(() => {
    if (!scoredRef.current) {
      scoredRef.current = true
      setNewRecord(submitBest(scoreRef.current))
    }
    setPhase('end')
    sfx.lose()
  }, [submitBest])

  /* ------------------------- барабан ------------------------- */

  /** применяет выпавший сектор; mult — «×2», ожидающий с прошлого хода */
  const applySector = useCallback(
    (idx: number) => {
      const s = WHEEL[idx]
      if (!s) return
      if (s.value === -1) {
        // ×2 — множитель на следующий ход (следующий сектор очков)
        setMult(2)
        setTurnMult(1)
        setSector(0)
        setFlash({ text: '×2! Следующий сектор — двойные очки', tone: 'good' })
        sfx.correct()
      } else if (s.value === 0) {
        // БАНКРОТ — банк раунда сгорает
        setPot(0)
        setSector(0)
        setMult(1)
        setTurnMult(1)
        setFlash({ text: 'БАНКРОТ! Банк раунда сгорел', tone: 'bad' })
        sfx.wrong()
        shake.start({ x: [0, -14, 14, -9, 9, -5, 5, 0], transition: { duration: 0.55, ease: 'easeOut' } })
      } else {
        const doubled = mult === 2
        setSector(s.value)
        setTurnMult(doubled ? 2 : 1)
        setMult(1)
        setFlash({
          text: `Сектор ${s.value.toLocaleString('ru-RU')}${doubled ? ' ×2 — очки удвоены!' : '!'}`,
          tone: 'good',
        })
        sfx.coin()
      }
    },
    [mult, shake],
  )

  const spinWheel = useCallback(() => {
    if (spinningRef.current || phase !== 'play' || losingRef.current) return
    spinningRef.current = true
    setSpinning(true)
    setFlash(null)
    sfx.click()

    // заранее выбираем сектор и смещение внутри него (не на границе)
    const idx = Math.floor(Math.random() * SECTORS)
    const jitter = (Math.random() * 2 - 1) * (SECTOR_ANGLE * 0.32) // ±14.4°
    // сектор под стрелкой (12 часов) после поворота R: (−R) mod 360
    const landingMod = (((360 - (idx * SECTOR_ANGLE + SECTOR_ANGLE / 2 + jitter)) % 360) + 360) % 360
    const currentMod = (((rotationRef.current % 360) + 360) % 360)
    let delta = landingMod - currentMod
    if (delta <= 0) delta += 360 // барабан крутится только вперёд
    const spins = 4 + Math.floor(Math.random() * 3) // 4–6 полных оборотов
    const target = rotationRef.current + spins * 360 + delta
    const dur = 2.6 + Math.random() * 0.8 // 2.6–3.4 с

    rotationRef.current = target
    setSpinDur(dur)
    setRotation(target)

    // тики секторов: часто в начале, реже к остановке (обратная easeOutCubic)
    const ticks = 13 + Math.floor(Math.random() * 6) // 13–18
    for (let k = 1; k <= ticks; k++) {
      const t = dur * (1 - Math.cbrt(1 - k / ticks))
      later(() => sfx.tick(), t * 1000)
    }

    later(
      () => {
        spinningRef.current = false
        setSpinning(false)
        applySector(idx)
      },
      dur * 1000 + 60,
    )
  }, [phase, later, applySector])

  /* ------------------------- буквы ------------------------- */

  const pressLetter = useCallback(
    (letter: string) => {
      if (phase !== 'play' || !round || spinningRef.current || sector === 0 || losingRef.current) return
      if (guessed.has(letter) || !ALPHABET.has(letter)) return
      const nextGuessed = new Set(guessed)
      nextGuessed.add(letter)
      setGuessed(nextGuessed)

      const count = [...round.answer].filter((ch) => ch === letter).length
      if (count > 0) {
        const gain = sector * count * turnMult
        setOpened((o) => {
          const n = new Set(o)
          n.add(letter)
          return n
        })
        setPot((p) => p + gain)
        setFlash({ text: `+${gain.toLocaleString('ru-RU')} в банк${turnMult === 2 ? ' (×2)' : ''}!`, tone: 'good' })
        sfx.reveal()
      } else {
        const left = lives - 1
        setLives(left)
        setFlash({ text: 'Мимо! −1 жизнь', tone: 'bad' })
        sfx.wrong()
        shake.start({ x: [0, -6, 6, -3, 3, 0], transition: { duration: 0.32 } })
        if (left <= 0) {
          losingRef.current = true
          // показать слово целиком и завершить партию
          setOpened((o) => {
            const n = new Set(o)
            for (const ch of round.answer) if (ch !== ' ') n.add(ch)
            return n
          })
          later(endGame, 1700)
        }
      }
    },
    [phase, round, sector, turnMult, guessed, lives, later, shake, endGame],
  )

  /* ------------------------- подсказка ------------------------- */

  const openHint = useCallback(() => {
    if (phase !== 'play' || !round || spinningRef.current || losingRef.current || pot < 500) return
    const remaining = [...new Set([...round.answer].filter((ch) => ch !== ' '))].filter((ch) => !opened.has(ch))
    if (remaining.length === 0) return
    const letter = remaining[Math.floor(Math.random() * remaining.length)]
    setPot((p) => p - 500)
    setOpened((o) => {
      const n = new Set(o)
      n.add(letter)
      return n
    })
    setGuessed((g) => {
      const n = new Set(g)
      n.add(letter)
      return n
    })
    setFlash({ text: `Подсказка: буква «${letter}» (−500)`, tone: 'info' })
    sfx.reveal()
  }, [phase, round, pot, opened])

  /* --------------------- победа в раунде --------------------- */

  useEffect(() => {
    if (phase !== 'play' || !round || losingRef.current) return
    const letters = [...round.answer].filter((ch) => ch !== ' ')
    if (letters.length > 0 && letters.every((ch) => opened.has(ch))) {
      const total = pot + WIN_BONUS
      setScore((s) => s + total)
      setSolved((n) => n + 1)
      setWonInfo({ pot, total })
      setConfetti(makeConfetti())
      setPhase('won')
      sfx.win()
    }
  }, [phase, round, opened, pot])

  /* ------------------ физическая клавиатура ------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const ch = (e.key || '').toUpperCase()
      const isEnter = e.key === 'Enter'
      const isSpace = e.code === 'Space' || e.key === ' '
      if (phase === 'play') {
        if (ALPHABET.has(ch)) {
          pressLetter(ch)
          return
        }
        // Space/Enter крутят барабан только когда он обязателен (сектора ещё нет)
        if ((isSpace || isEnter) && sector === 0) {
          e.preventDefault()
          spinWheel()
        }
      } else if (phase === 'won' && (isEnter || isSpace)) {
        e.preventDefault()
        sfx.click()
        nextWord()
      } else if (phase === 'end' && (isEnter || isSpace)) {
        e.preventDefault()
        sfx.click()
        startGame()
      } else if (phase === 'idle' && isEnter) {
        e.preventDefault()
        startGame()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, pressLetter, spinWheel, nextWord, startGame, sector])

  /* --------------------------- экраны --------------------------- */

  if (phase === 'idle') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
        <motion.div
          initial={{ rotate: -14, scale: 0.8, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="h-24 w-24 rounded-[28px] grid place-items-center text-5xl"
          style={{ background: 'linear-gradient(140deg,#FBBF24,#D97706)', boxShadow: '0 20px 50px -18px rgba(245,158,11,0.6)' }}
        >
          🎡
        </motion.div>
        <div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>
            Поле чудес
          </h2>
          <p className="text-sm mt-2 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--g-fg-soft)' }}>
            Крути барабан, открывай буквы и копи банк. 3 жизни на всю партию!
          </p>
        </div>
        <div className="flex flex-col gap-1.5 w-full max-w-[300px]">
          {[
            ['🎯', 'Сектор — от 100 до 1500 очков'],
            ['💀', 'БАНКРОТ сжигает банк раунда'],
            ['✖️', '«×2» удваивает следующий сектор'],
            ['💡', 'Подсказка — 500 из банка'],
          ].map(([emoji, text]) => (
            <div
              key={text}
              className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-left"
              style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg-soft)' }}
            >
              <span className="shrink-0">{emoji}</span> {text}
            </div>
          ))}
        </div>
        {best > 0 && (
          <div
            className="rounded-full px-4 py-1.5 text-sm font-bold"
            style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg-soft)' }}
          >
            🏆 Рекорд: {best.toLocaleString('ru-RU')}
          </div>
        )}
        <button
          onClick={startGame}
          className="h-14 px-10 rounded-2xl text-white text-lg font-extrabold transition-transform active:scale-95 hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg,#FBBF24,#D97706)', boxShadow: '0 18px 40px -14px rgba(245,158,11,0.65)' }}
        >
          <span className="inline-flex items-center gap-2">
            <Play className="h-5 w-5 fill-current" /> Играть
          </span>
        </button>
      </div>
    )
  }

  const words = round ? round.answer.split(' ') : []
  const x2Active = mult === 2 || turnMult === 2
  const statusText = spinning
    ? 'Барабан крутится…'
    : sector === 0
      ? mult === 2
        ? '×2 на кону — крутите барабан!'
        : 'Крутите барабан!'
      : `Сектор ${sector.toLocaleString('ru-RU')}${turnMult === 2 ? ' ×2' : ''} — открывайте буквы!`

  return (
    <motion.div animate={shake} className="relative min-h-full flex flex-col max-w-md mx-auto w-full px-2.5 md:px-4 py-2.5 gap-2">
      {/* ---- шапка: счёт · банк · жизни ---- */}
      <div className="flex items-center justify-between gap-1.5">
        <span
          className="rounded-full px-2.5 py-1 text-[12.5px] font-extrabold tabular-nums whitespace-nowrap"
          style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg-soft)' }}
        >
          🏆 {score.toLocaleString('ru-RU')}
        </span>
        <span
          className="rounded-full px-2.5 py-1 text-[12.5px] font-extrabold tabular-nums whitespace-nowrap inline-flex items-center gap-1.5"
          style={{ background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(245,158,11,0.4)', color: GOLD }}
        >
          💰 {pot.toLocaleString('ru-RU')}
          {x2Active && (
            <span className="rounded-full px-1.5 text-[10px] font-black leading-4" style={{ background: '#DB2777', color: '#fff' }}>
              ×2
            </span>
          )}
        </span>
        <span className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span key={i} animate={i >= lives ? { scale: [1, 1.3, 0.85], opacity: 0.25 } : { scale: 1 }}>
              <Heart className={['h-4 w-4', i < lives ? 'fill-rose-500 text-rose-500' : 'text-[var(--g-fg-mute)]'].join(' ')} />
            </motion.span>
          ))}
        </span>
      </div>

      {/* ---- вопрос ---- */}
      <div
        className="relative overflow-hidden rounded-2xl px-3.5 py-2"
        style={{ background: 'var(--g-card)', border: '1px solid var(--g-border)', boxShadow: 'var(--g-shadow)' }}
      >
        <div aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: `linear-gradient(180deg,#FBBF24,${GOLD})` }} />
        <div className="text-[9.5px] uppercase tracking-[0.2em] font-black mb-0.5" style={{ color: GOLD }}>
          Вопрос
        </div>
        <p className="text-[13.5px] md:text-[15px] font-semibold leading-snug" style={{ color: 'var(--g-fg)' }}>
          {round?.q}
        </p>
      </div>

      {/* ---- слово + статус ---- */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 py-1">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {words.map((word, wi) => (
            <motion.div
              key={`${round?.answer}-${wi}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: wi * 0.08 }}
              className="flex gap-[3px] md:gap-1"
            >
              {[...word].map((ch, ci) => {
                const isOpen = opened.has(ch)
                return (
                  <span key={`${wi}-${ci}`} className="relative block h-[36px] w-[25px] md:h-[46px] md:w-[32px]" style={{ perspective: 480 }}>
                    <motion.span
                      className="absolute inset-0 block rounded-[9px] [transform-style:preserve-3d]"
                      initial={false}
                      animate={{ rotateY: isOpen ? 180 : 0 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                    >
                      {/* рубашка (закрыто) */}
                      <span
                        className="absolute inset-0 grid place-items-center rounded-[9px] [backface-visibility:hidden]"
                        style={{
                          background: 'var(--g-card)',
                          border: '1.5px solid var(--g-border)',
                          boxShadow: 'inset 0 -3px 0 var(--g-border)',
                        }}
                      >
                        <span className="h-1 w-1 rounded-full" style={{ background: 'var(--g-fg-mute)', opacity: 0.6 }} />
                      </span>
                      {/* буква (открыто) */}
                      <span
                        className="absolute inset-0 grid place-items-center rounded-[9px] text-[16px] md:text-[21px] font-black text-white [backface-visibility:hidden]"
                        style={{
                          transform: 'rotateY(180deg)',
                          background: 'linear-gradient(160deg,#FBBF24,#D97706)',
                          border: '1.5px solid #B45309',
                          boxShadow: '0 5px 14px -4px rgba(245,158,11,0.65), inset 0 -3px 0 rgba(146,64,14,0.55)',
                        }}
                      >
                        {ch}
                      </span>
                    </motion.span>
                  </span>
                )
              })}
            </motion.div>
          ))}
        </div>

        <div className="h-5 flex items-center justify-center px-2">
          {flash ? (
            <motion.span
              key={flash.text}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[13px] font-extrabold text-center"
              style={{ color: flash.tone === 'good' ? GOLD : flash.tone === 'bad' ? '#F87171' : 'var(--g-fg-soft)' }}
            >
              {flash.text}
            </motion.span>
          ) : (
            <span className="text-[12.5px] font-semibold text-center" style={{ color: 'var(--g-fg-mute)' }}>
              {statusText}
            </span>
          )}
        </div>
      </div>

      {/* ---- барабан ---- */}
      <div className="flex flex-col items-center gap-2">
        <div className="relative mt-4 mb-0.5 h-[min(50vw,192px)] w-[min(50vw,192px)] md:h-[224px] md:w-[224px]">
          {/* сияние */}
          <motion.div
            aria-hidden
            className="absolute -inset-5 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.28) 0%, transparent 65%)' }}
            animate={{ opacity: spinning ? [0.75, 1, 0.75] : [0.4, 0.7, 0.4] }}
            transition={{ duration: spinning ? 0.5 : 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* стрелка-указатель (12 часов) */}
          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 -top-[13px] z-20"
            style={{
              width: 0,
              height: 0,
              borderLeft: '10px solid transparent',
              borderRight: '10px solid transparent',
              borderTop: `18px solid ${GOLD}`,
              filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))',
            }}
          />
          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 -top-[21px] z-20 h-3 w-3 rounded-full"
            style={{ background: 'radial-gradient(circle at 35% 30%, #FDE68A, #B45309)', boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
          />

          {/* вращающийся барабан: диск + подписи вместе */}
          <motion.div
            className="absolute inset-0"
            animate={{ rotate: rotation }}
            transition={{ duration: spinDur, ease: [0.215, 0.61, 0.355, 1] }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: CONIC,
                border: `4px solid ${GOLD}`,
                boxShadow: '0 0 0 2.5px rgba(180,83,9,0.55), 0 16px 36px -12px rgba(245,158,11,0.5), inset 0 0 26px rgba(0,0,0,0.35)',
              }}
            />
            {WHEEL.map((s, i) => (
              <div
                key={s.label + i}
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{ transform: `rotate(${i * SECTOR_ANGLE + SECTOR_ANGLE / 2}deg)` }}
              >
                <span
                  className="absolute left-1/2 top-[5%] -translate-x-1/2 text-white font-black whitespace-nowrap"
                  style={
                    s.label === 'БАНКРОТ'
                      ? { fontSize: 8, letterSpacing: '0.04em', textShadow: '0 1px 1px rgba(0,0,0,0.8)' }
                      : { fontSize: 13, textShadow: '0 1px 1px rgba(0,0,0,0.55)' }
                  }
                >
                  {s.label}
                </span>
              </div>
            ))}
          </motion.div>

          {/* блик + виньетка */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                'linear-gradient(200deg, rgba(255,255,255,0.2) 0%, transparent 34%), radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.3) 100%)',
            }}
          />

          {/* лампочки по ободу */}
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} aria-hidden className="absolute inset-0 pointer-events-none" style={{ transform: `rotate(${i * 30}deg)` }}>
              <motion.span
                className="absolute left-1/2 -top-[2px] -translate-x-1/2 h-[6px] w-[6px] rounded-full"
                style={{ background: '#FEF3C7', boxShadow: '0 0 7px 2px rgba(252,211,77,0.8)' }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.125, ease: 'easeInOut' }}
              />
            </div>
          ))}

          {/* втулка */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 h-[27%] w-[27%] rounded-full grid place-items-center"
            style={{
              background: 'radial-gradient(circle at 35% 30%, #FDE68A, #F59E0B 55%, #92400E)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.45), inset 0 -3px 6px rgba(120,53,15,0.55), 0 0 0 2px rgba(180,83,9,0.6)',
            }}
          >
            <span className="text-xl md:text-[22px] leading-none">🎡</span>
          </div>
        </div>

        {/* кнопки: крутить + подсказка */}
        <div className="flex items-stretch gap-2 w-full max-w-[430px]">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={spinWheel}
            disabled={spinning || phase !== 'play'}
            className="flex-[1.5] h-12 rounded-2xl text-white text-[15px] font-extrabold tracking-wide transition-opacity disabled:opacity-50 disabled:active:scale-100"
            style={{
              background: 'linear-gradient(135deg,#FBBF24,#D97706)',
              boxShadow: '0 12px 26px -10px rgba(245,158,11,0.6), inset 0 1px 0 rgba(255,255,255,0.35)',
            }}
          >
            {spinning ? 'Крутится…' : '🎯 Крутить!'}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={openHint}
            disabled={spinning || phase !== 'play' || pot < 500}
            className="flex-1 h-12 rounded-2xl text-[12.5px] font-extrabold transition-opacity disabled:opacity-40 disabled:active:scale-100 grid place-items-center"
            style={{ background: 'var(--g-btn)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg)' }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Lightbulb className="h-4 w-4" style={{ color: GOLD }} /> Подсказка · 500
            </span>
          </motion.button>
        </div>
      </div>

      {/* ---- клавиатура ЙЦУКЕН ---- */}
      <div className="flex flex-col items-center gap-[4px] pt-0.5 pb-1 w-full">
        {ROWS.map((row, ri) => (
          <div key={ri} className="flex justify-center gap-[3px] w-full max-w-[430px]">
            {row.map((letter) => {
              const used = guessed.has(letter)
              const hit = used && !!round && round.answer.includes(letter)
              const disabled = used || spinning || sector === 0 || phase !== 'play'
              return (
                <button
                  key={letter}
                  onClick={() => pressLetter(letter)}
                  disabled={disabled}
                  aria-label={`Буква ${letter}`}
                  className="flex-1 h-[37px] md:h-11 rounded-[9px] text-[12.5px] md:text-[14.5px] font-extrabold grid place-items-center transition-all duration-100 active:translate-y-[1px] active:scale-[0.97] disabled:active:translate-y-0"
                  style={{
                    background: used
                      ? hit
                        ? 'linear-gradient(160deg,#FBBF24,#D97706)'
                        : 'var(--g-chip)'
                      : 'linear-gradient(180deg, var(--g-card-solid), var(--g-card))',
                    color: used ? (hit ? '#fff' : 'var(--g-fg-mute)') : 'var(--g-fg)',
                    border: '1px solid',
                    borderColor: used ? (hit ? '#B45309' : 'transparent') : 'var(--g-border)',
                    boxShadow: used
                      ? hit
                        ? '0 3px 10px -3px rgba(245,158,11,0.6)'
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

      {/* ---- оверлеи: победа в раунде / конец игры ---- */}
      <AnimatePresence>
        {phase === 'won' && (
          <motion.div
            key="won"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 overflow-hidden flex flex-col items-center justify-center text-center px-6 gap-3"
            style={{ background: 'rgba(8,10,22,0.62)', backdropFilter: 'blur(8px)' }}
          >
            {confetti.map((c, i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute rounded-[2px]"
                style={{ left: `${c.left}%`, top: 0, width: c.size, height: c.size * 0.55, background: c.color }}
                initial={{ y: -24, x: 0, opacity: 1, rotate: c.rot }}
                animate={{ y: '80vh', x: c.drift, opacity: [1, 1, 0.85, 0], rotate: c.rot + 560 }}
                transition={{ duration: c.dur, delay: c.delay, ease: 'easeIn' }}
              />
            ))}
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              className="text-6xl"
            >
              🎉
            </motion.div>
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>
              Слово разгадано!
            </h2>
            <div className="text-lg md:text-xl font-black tracking-[0.2em]" style={{ color: GOLD }}>
              {round?.answer}
            </div>
            <div className="rounded-2xl px-5 py-2.5" style={{ background: 'var(--g-card)', border: '1px solid var(--g-border)' }}>
              <span className="text-[12.5px] font-semibold" style={{ color: 'var(--g-fg-soft)' }}>
                Банк {(wonInfo?.pot ?? 0).toLocaleString('ru-RU')} + бонус {WIN_BONUS.toLocaleString('ru-RU')} ={' '}
              </span>
              <span className="text-lg font-extrabold tabular-nums" style={{ color: GOLD }}>
                +{(wonInfo?.total ?? 0).toLocaleString('ru-RU')}
              </span>
            </div>
            <button
              onClick={() => {
                sfx.click()
                nextWord()
              }}
              className="mt-1 h-12 px-8 rounded-2xl text-white font-extrabold active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg,#FBBF24,#D97706)', boxShadow: '0 14px 30px -12px rgba(245,158,11,0.65)' }}
            >
              Следующее слово →
            </button>
          </motion.div>
        )}

        {phase === 'end' && (
          <motion.div
            key="end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center px-6 gap-3"
            style={{ background: 'rgba(8,10,22,0.66)', backdropFilter: 'blur(8px)' }}
          >
            <div className="text-6xl">🎬</div>
            <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>
              Игра окончена
            </h2>
            <p className="text-sm" style={{ color: 'var(--g-fg-soft)' }}>
              Не разгадано: <b style={{ color: GOLD }}>{round?.answer}</b>
            </p>
            <div className="flex items-center gap-2.5">
              <div className="rounded-2xl px-5 py-3" style={{ background: 'var(--g-card)', border: '1px solid var(--g-border)' }}>
                <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>
                  Очки
                </div>
                <div className="text-2xl font-extrabold tabular-nums" style={{ color: GOLD }}>
                  {score.toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="rounded-2xl px-5 py-3" style={{ background: 'var(--g-card)', border: '1px solid var(--g-border)' }}>
                <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>
                  Разгадано
                </div>
                <div className="text-2xl font-extrabold tabular-nums" style={{ color: 'var(--g-fg)' }}>
                  {solved}
                </div>
              </div>
            </div>
            {newRecord && (
              <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="rounded-full px-3.5 py-1 text-[12px] font-black"
                style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.45)', color: GOLD }}
              >
                🎉 Новый рекорд!
              </motion.div>
            )}
            <div className="text-xs" style={{ color: 'var(--g-fg-mute)' }}>
              🏆 Рекорд: {best.toLocaleString('ru-RU')}
            </div>
            <button
              onClick={() => {
                sfx.click()
                startGame()
              }}
              className="h-12 px-8 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95 transition-transform"
              style={{ background: 'linear-gradient(135deg,#FBBF24,#D97706)', boxShadow: '0 14px 30px -12px rgba(245,158,11,0.65)' }}
            >
              <RotateCcw className="h-[18px] w-[18px]" /> Ещё раз
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
