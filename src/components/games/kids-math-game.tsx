'use client'

// ============================================================================
// v25.24 — ДЕТСКАЯ МАТЕМАТИКА «Считай ягодки и звёздочки» (4–7 лет).
//   • 4 уровня-карточки: счёт до 5, счёт до 10, визуальное «+», визуальное «−».
//   • Крупные эмодзи-предметы с покачиванием; «минус» — вторая группа
//     зачёркивается и улетает.
//   • 3 больших пастельных варианта ответа. Правильно → предметы прыгают,
//     звёздочка летит в прогресс. Неправильно → кнопка трясётся, предметы
//     пересчитываются с подсветкой по одному (обучение, без проигрышей).
//   • 8 заданий = ряд из 8 звёздочек; рекорд useBest('kids-math') — серия.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

/* ------------------------------- данные ------------------------------- */

type LevelId = 'count5' | 'count10' | 'plus' | 'minus'

interface LevelInfo {
  id: LevelId
  title: string
  sub: string
  emoji: string
  grad: string
}

const LEVELS: LevelInfo[] = [
  { id: 'count5', title: 'Счёт до 5', sub: 'Посчитай предметики', emoji: '🍓', grad: 'linear-gradient(140deg,#FDA4AF,#F43F5E)' },
  { id: 'count10', title: 'Счёт до 10', sub: 'Больше предметов', emoji: '⭐', grad: 'linear-gradient(140deg,#FCD34D,#F59E0B)' },
  { id: 'plus', title: 'Плюс', sub: 'Сложи две группы', emoji: '➕', grad: 'linear-gradient(140deg,#6EE7B7,#0D9488)' },
  { id: 'minus', title: 'Минус', sub: 'Сколько осталось?', emoji: '➖', grad: 'linear-gradient(140deg,#C4B5FD,#7C3AED)' },
]

interface ItemInfo {
  emoji: string
  /** родительный падеж: «сколько ягодок?» */
  word: string
}

const ITEMS: ItemInfo[] = [
  { emoji: '🍓', word: 'ягодок' },
  { emoji: '🍒', word: 'вишенок' },
  { emoji: '⭐', word: 'звёздочек' },
  { emoji: '🍎', word: 'яблочек' },
  { emoji: '🐝', word: 'пчёлок' },
  { emoji: '🌈', word: 'радуг' },
  { emoji: '🌸', word: 'цветочков' },
  { emoji: '🐟', word: 'рыбок' },
]

const ROUNDS = 8

const OPTION_GRADS = [
  'linear-gradient(140deg,#F9A8D4,#EC4899)',
  'linear-gradient(140deg,#7DD3FC,#0EA5E9)',
  'linear-gradient(140deg,#6EE7B7,#10B981)',
]

/* ------------------------------- модель ------------------------------- */

interface Sprite {
  id: number
  dx: number
  dy: number
  rot: number
  swayDur: number
  swayDelay: number
}

interface Task {
  kind: 'count' | 'plus' | 'minus'
  emoji: string
  word: string
  a: number
  b: number
  answer: number
  options: number[]
  items: Sprite[]
}

type StarResult = 'gold' | 'soft'

/* ------------------------------ конфетти ------------------------------ */

interface ConfettiPiece {
  left: number
  delay: number
  dur: number
  drift: number
  size: number
  color: string
  rot: number
}

const CONFETTI_COLORS = ['#FB7185', '#FBBF24', '#38BDF8', '#34D399', '#C4B5FD', '#F472B6']

const makeConfetti = (): ConfettiPiece[] =>
  Array.from({ length: 32 }, () => ({
    left: 3 + Math.random() * 94,
    delay: Math.random() * 0.8,
    dur: 1.6 + Math.random() * 1.6,
    drift: (Math.random() * 2 - 1) * 110,
    size: 6 + Math.random() * 7,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rot: Math.random() * 360,
  }))

/* ------------------------------ утилиты ------------------------------ */

const rnd = (n: number) => Math.floor(Math.random() * n)

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const makeSprites = (n: number): Sprite[] =>
  Array.from({ length: n }, (_, id) => ({
    id,
    dx: rnd(21) - 10,
    dy: rnd(17) - 8,
    rot: rnd(11) - 5,
    swayDur: Math.random() * 1.4,
    swayDelay: Math.random() * 1.6,
  }))

function makeOptions(answer: number, lo: number, hi: number): number[] {
  const pool = shuffle(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((n) => n !== answer))
  const near = shuffle(pool.filter((n) => Math.abs(n - answer) <= 2))
  const far = shuffle(pool.filter((n) => Math.abs(n - answer) > 2))
  const extras = [...near, ...far]
  return shuffle([answer, extras[0] ?? answer + 1, extras[1] ?? answer + 2])
}

function buildTask(level: LevelId): Task {
  const it = ITEMS[rnd(ITEMS.length)]
  if (level === 'count5' || level === 'count10') {
    const max = level === 'count5' ? 5 : 10
    const a = 1 + rnd(max)
    return { kind: 'count', emoji: it.emoji, word: it.word, a, b: 0, answer: a, options: makeOptions(a, 1, max), items: makeSprites(a) }
  }
  if (level === 'plus') {
    const a = 1 + rnd(5)
    const b = 1 + rnd(10 - a)
    return { kind: 'plus', emoji: it.emoji, word: it.word, a, b, answer: a + b, options: makeOptions(a + b, 1, 10), items: makeSprites(a + b) }
  }
  const a = 2 + rnd(9)
  const b = 1 + rnd(a - 1)
  return { kind: 'minus', emoji: it.emoji, word: it.word, a, b, answer: a - b, options: makeOptions(a - b, 1, 10), items: makeSprites(a) }
}

const questionOf = (t: Task): string =>
  t.kind === 'count' ? `Сколько ${t.word}?` : t.kind === 'plus' ? `Сколько всего ${t.word}?` : `Сколько ${t.word} осталось?`

/* --------------------------- конфетти-слой --------------------------- */

function ConfettiLayer({ pieces }: { pieces: ConfettiPiece[] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden z-20">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-[3px]"
          style={{ left: `${p.left}%`, top: 0, width: p.size, height: Math.round(p.size * 0.62), background: p.color }}
          initial={{ y: -24, rotate: p.rot, opacity: 1 }}
          animate={{ y: '105vh', x: p.drift, rotate: p.rot + 240, opacity: 0.9 }}
          transition={{ duration: p.dur + 1.4, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  )
}

/* --------------------------- предмет-эмодзи --------------------------- */

function Item({
  spr,
  emoji,
  idx,
  highlight,
  celebrate,
}: {
  spr: Sprite
  emoji: string
  idx: number
  highlight: number
  celebrate: boolean
}) {
  const isCurrent = idx === highlight
  const isCounted = highlight >= 0 && idx < highlight
  return (
    // лёгкий «разброс» — статичное смещение
    <span className="relative inline-block" style={{ transform: `translate(${spr.dx}px, ${spr.dy}px)` }}>
      {/* покачивание */}
      <motion.span
        className="block"
        animate={{ y: [0, -5, 0], rotate: [spr.rot - 3, spr.rot + 3, spr.rot - 3] }}
        transition={{ duration: 2.4 + spr.swayDur, repeat: Infinity, delay: spr.swayDelay, ease: 'easeInOut' }}
      >
        {/* подсветка при пересчёте / прыжок при верном ответе */}
        <motion.span
          className="relative block leading-none"
          animate={isCurrent ? { scale: 1.35 } : celebrate ? { scale: [1, 1.32, 1], y: [0, -12, 0] } : { scale: 1, y: 0 }}
          transition={
            isCurrent
              ? { type: 'spring', stiffness: 420, damping: 11 }
              : celebrate
                ? { duration: 0.55, delay: idx * 0.055 }
                : { duration: 0.18 }
          }
          style={{
            filter: isCurrent
              ? 'drop-shadow(0 0 10px rgba(251,191,36,0.85))'
              : isCounted
                ? 'drop-shadow(0 0 6px rgba(52,211,153,0.6))'
                : undefined,
          }}
        >
          <span className="text-[38px] md:text-[46px]">{emoji}</span>
          {isCurrent && (
            <span
              className="absolute -top-2 -right-2.5 h-6 w-6 rounded-full grid place-items-center text-[12px] font-black text-white"
              style={{ background: 'linear-gradient(140deg,#FBBF24,#F59E0B)', boxShadow: '0 4px 10px -2px rgba(245,158,11,0.75)' }}
            >
              {idx + 1}
            </span>
          )}
        </motion.span>
      </motion.span>
    </span>
  )
}

/* ============================== игра ============================== */

export function KidsMathGame() {
  const [phase, setPhase] = useState<'idle' | 'play' | 'end'>('idle')
  const [level, setLevel] = useState<LevelId>('count5')
  const [task, setTask] = useState<Task | null>(null)
  const [round, setRound] = useState(0)
  const [results, setResults] = useState<(StarResult | undefined)[]>([])
  const [streak, setStreak] = useState(0)
  const [tried, setTried] = useState<number[]>([])
  const [locked, setLocked] = useState(false)
  const [wrongPick, setWrongPick] = useState<number | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [hint, setHint] = useState('')
  const [flyKey, setFlyKey] = useState(0)
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([])
  const [newRecord, setNewRecord] = useState(false)

  const [best, submitBest] = useBest('kids-math')

  const attemptsRef = useRef(0)
  const maxStreakRef = useRef(0)
  const countTimerRef = useRef<number | null>(null)
  const timersRef = useRef<number[]>([])

  /** setTimeout с автозачисткой при размонтировании */
  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((x) => x !== t)
      fn()
    }, ms)
    timersRef.current.push(t)
  }, [])

  useEffect(() => () => timersRef.current.forEach((t) => window.clearTimeout(t)), [])

  const clearCount = useCallback(() => {
    if (countTimerRef.current !== null) {
      window.clearInterval(countTimerRef.current)
      countTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearCount(), [clearCount])

  const start = useCallback(
    (lv: LevelId) => {
      clearCount()
      setLevel(lv)
      setTask(buildTask(lv))
      setRound(0)
      setResults([])
      setStreak(0)
      maxStreakRef.current = 0
      attemptsRef.current = 0
      setTried([])
      setHighlight(-1)
      setCelebrate(false)
      setHint('')
      setLocked(false)
      setFlyKey(0)
      setConfetti([])
      setNewRecord(false)
      setPhase('play')
      sfx.whoosh(1)
    },
    [clearCount],
  )

  const toLevels = useCallback(() => {
    clearCount()
    setHint('')
    sfx.tap()
    setPhase('idle')
  }, [clearCount])

  /** мягкий пересчёт предметов по одному — обучение после ошибки */
  const startRecount = useCallback(
    (t: Task) => {
      const total = t.kind === 'minus' ? t.a : t.a + t.b
      setLocked(true)
      setHint('Считаем вместе — смотри!')
      setHighlight(0)
      sfx.tick()
      let i = 0
      clearCount()
      const id = window.setInterval(() => {
        i += 1
        if (i >= total) {
          window.clearInterval(id)
          countTimerRef.current = null
          later(() => {
            setHighlight(-1)
            setLocked(false)
            setHint('Посчитай и попробуй снова!')
          }, 640)
        } else {
          setHighlight(i)
          sfx.tick()
        }
      }, 430)
      countTimerRef.current = id
    },
    [clearCount, later],
  )

  const onAnswer = useCallback(
    (n: number) => {
      if (!task || locked) return
      if (n === task.answer) {
        const firstTry = attemptsRef.current === 0
        attemptsRef.current += 1
        setLocked(true)
        setHint('')
        sfx.correct()
        setCelebrate(true)
        setFlyKey((k) => k + 1)
        setResults((r) => {
          const next = [...r]
          next[round] = firstTry ? 'gold' : 'soft'
          return next
        })
        const nextStreak = firstTry ? streak + 1 : 0
        setStreak(nextStreak)
        if (nextStreak > maxStreakRef.current) maxStreakRef.current = nextStreak
        later(() => {
          setCelebrate(false)
          if (round >= ROUNDS - 1) {
            const rec = submitBest(maxStreakRef.current)
            setNewRecord(rec)
            setConfetti(makeConfetti())
            sfx.win()
            setPhase('end')
          } else {
            setRound((r) => r + 1)
            setTask(buildTask(level))
            setTried([])
            attemptsRef.current = 0
            setLocked(false)
          }
        }, 1250)
      } else {
        attemptsRef.current += 1
        sfx.wrong()
        setTried((t) => (t.includes(n) ? t : [...t, n]))
        setWrongPick(n)
        later(() => setWrongPick(null), 520)
        startRecount(task)
      }
    },
    [task, locked, round, streak, level, later, startRecount, submitBest],
  )

  /* ------------------------------ экраны ------------------------------ */

  if (phase === 'idle') {
    return (
      <div className="h-full w-full max-w-lg mx-auto flex flex-col items-center justify-center text-center gap-4 px-5">
        <div
          className="h-24 w-24 rounded-[30px] grid place-items-center text-5xl"
          style={{ background: 'linear-gradient(140deg,#FDA4AF,#F43F5E)', boxShadow: '0 20px 50px -18px rgba(244,63,94,0.55)' }}
        >
          🍓
        </div>
        <div>
          <h2 className="text-2xl md:text-[27px] font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>
            Считай ягодки и звёздочки
          </h2>
          <p className="text-sm mt-1.5 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--g-fg-soft)' }}>
            Весёлая математика для малышей: считаем предметы, складываем и вычитаем. Выбери уровень!
          </p>
        </div>
        {best > 0 && (
          <div
            className="rounded-full px-4 py-1.5 bg-[var(--g-chip)] border border-[var(--g-chip-border)] text-sm font-bold"
            style={{ color: 'var(--g-fg-soft)' }}
          >
            🏆 Рекорд: {best} подряд
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 w-full max-w-[380px] mt-1">
          {LEVELS.map((lv, i) => (
            <button
              key={lv.id}
              onClick={() => start(lv.id)}
              className="relative h-[112px] rounded-[24px] flex flex-col items-center justify-center text-white active:scale-95 transition-transform"
              style={{ background: lv.grad, boxShadow: '0 16px 36px -14px rgba(15,23,42,0.55), inset 0 1px 0 rgba(255,255,255,0.3)' }}
              aria-label={lv.title}
            >
              <span
                className="absolute top-2 left-2 h-6 w-6 rounded-full grid place-items-center text-[12px] font-black"
                style={{ background: 'rgba(255,255,255,0.92)', color: '#334155' }}
              >
                {i + 1}
              </span>
              <span className="text-[30px] leading-none">{lv.emoji}</span>
              <span className="text-[15px] font-extrabold mt-1">{lv.title}</span>
              <span className="text-[10.5px] font-bold opacity-85">{lv.sub}</span>
            </button>
          ))}
        </div>
        <p className="text-[10.5px]" style={{ color: 'var(--g-fg-mute)' }}>
          Без таймеров и проигрышей — только тёплое обучение 💛
        </p>
      </div>
    )
  }

  if (phase === 'end') {
    const gold = results.filter((r) => r === 'gold').length
    return (
      <div className="h-full w-full max-w-lg mx-auto flex flex-col items-center justify-center text-center px-6 relative">
        <ConfettiLayer pieces={confetti} />
        <motion.div
          initial={{ scale: 0.4, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 14 }}
          className="text-7xl"
        >
          🎉
        </motion.div>
        <h2 className="text-[28px] font-extrabold mt-2" style={{ color: 'var(--g-fg)' }}>
          Молодец!
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--g-fg-soft)' }}>
          Все {ROUNDS} заданий решены
        </p>
        <div className="flex gap-1.5 mt-3">
          {results.map((r, i) => (
            <motion.span
              key={i}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15 + i * 0.06, type: 'spring', stiffness: 300, damping: 15 }}
              className="text-[22px] leading-none"
              style={{ filter: r === 'gold' ? undefined : 'grayscale(1) opacity(0.55)' }}
            >
              ⭐
            </motion.span>
          ))}
        </div>
        <p className="text-[12.5px] font-bold mt-2" style={{ color: 'var(--g-fg-soft)' }}>
          Без ошибок: {gold} из {ROUNDS}
        </p>
        <div className="flex gap-2 mt-4 flex-wrap justify-center">
          <span
            className="rounded-full px-4 py-1.5 text-sm font-bold bg-[var(--g-chip)] border border-[var(--g-chip-border)]"
            style={{ color: 'var(--g-fg-soft)' }}
          >
            🔥 Лучшая серия: {maxStreakRef.current}
          </span>
          {newRecord ? (
            <span
              className="rounded-full px-4 py-1.5 text-sm font-extrabold text-white"
              style={{ background: 'linear-gradient(135deg,#FBBF24,#F59E0B)', boxShadow: '0 10px 24px -10px rgba(245,158,11,0.7)' }}
            >
              🏆 Новый рекорд!
            </span>
          ) : (
            best > 0 && (
              <span
                className="rounded-full px-4 py-1.5 text-sm font-bold bg-[var(--g-chip)] border border-[var(--g-chip-border)]"
                style={{ color: 'var(--g-fg-soft)' }}
              >
                Рекорд: {best}
              </span>
            )
          )}
        </div>
        <div className="flex flex-col gap-2.5 w-full max-w-[260px] mt-6">
          <button
            onClick={() => start(level)}
            className="h-12 rounded-2xl text-white text-base font-extrabold inline-flex items-center justify-center gap-2 active:scale-95"
            style={{ background: 'linear-gradient(135deg,#34D399,#059669)', boxShadow: '0 16px 36px -14px rgba(16,185,129,0.65)' }}
          >
            <RotateCcw className="h-[18px] w-[18px]" /> Ещё раз
          </button>
          <button
            onClick={toLevels}
            className="h-12 rounded-2xl font-extrabold border border-[var(--g-border)] bg-[var(--g-btn)] hover:bg-[var(--g-btn-hover)] active:scale-95"
            style={{ color: 'var(--g-fg)' }}
          >
            Другой уровень
          </button>
        </div>
      </div>
    )
  }

  if (!task) return null

  /* ------------------------------ игра ------------------------------ */

  const renderGroup = (from: number, to: number) => (
    <div className="flex flex-wrap justify-center content-center gap-x-1.5 gap-y-1.5 w-[144px] md:w-[172px]">
      {task.items.slice(from, to).map((spr, i) => (
        <Item key={spr.id} spr={spr} emoji={task.emoji} idx={from + i} highlight={highlight} celebrate={celebrate} />
      ))}
    </div>
  )

  return (
    <div className="h-full w-full max-w-lg mx-auto flex flex-col px-3 md:px-6 pt-1 pb-2 relative">
      {/* шапка: назад · задание · серия */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={toLevels}
          className="h-9 pl-2 pr-3 rounded-full inline-flex items-center gap-1 text-[12.5px] font-extrabold border border-[var(--g-border)] bg-[var(--g-btn)] hover:bg-[var(--g-btn-hover)] active:scale-95"
          style={{ color: 'var(--g-fg-soft)' }}
        >
          <ArrowLeft className="h-4 w-4" /> Уровни
        </button>
        <div className="text-[12.5px] font-extrabold" style={{ color: 'var(--g-fg-soft)' }}>
          Задание {round + 1} из {ROUNDS}
        </div>
        <div
          className="h-9 min-w-[54px] px-2.5 rounded-full inline-flex items-center justify-center gap-1 text-[12.5px] font-extrabold"
          style={{
            background: 'var(--g-chip)',
            border: '1px solid var(--g-chip-border)',
            color: streak > 0 ? 'var(--g-fg)' : 'var(--g-fg-mute)',
          }}
        >
          🔥 {streak}
        </div>
      </div>

      {/* прогресс — 8 звёздочек */}
      <div className="flex justify-center gap-[3px] mt-2">
        {Array.from({ length: ROUNDS }).map((_, i) => {
          const r = results[i]
          return (
            <motion.span
              key={i}
              animate={r ? { scale: [1.5, 1] } : { scale: 1 }}
              transition={{ duration: 0.3 }}
              className="text-[19px] leading-none"
              style={{ opacity: r ? 1 : 0.25, filter: r === 'soft' ? 'grayscale(1)' : undefined }}
            >
              ⭐
            </motion.span>
          )
        })}
      </div>

      {/* вопрос */}
      <motion.div
        key={`q-${round}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center text-[19px] md:text-[21px] font-extrabold mt-2 leading-tight"
        style={{ color: 'var(--g-fg)' }}
      >
        {questionOf(task)}
      </motion.div>

      {/* предметы */}
      <div className="flex-1 min-h-0 flex items-center justify-center relative">
        <motion.div
          key={`items-${round}`}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex items-center justify-center gap-2 md:gap-3"
        >
          {task.kind === 'count' ? (
            <div className="flex flex-wrap justify-center content-center gap-x-2.5 gap-y-2 max-w-[344px]">
              {task.items.map((spr, i) => (
                <Item key={spr.id} spr={spr} emoji={task.emoji} idx={i} highlight={highlight} celebrate={celebrate} />
              ))}
            </div>
          ) : (
            <>
              {renderGroup(0, task.a)}
              <span
                className="text-[38px] md:text-[44px] font-black leading-none"
                style={{ color: task.kind === 'plus' ? '#10B981' : '#F43F5E' }}
              >
                {task.kind === 'plus' ? '+' : '−'}
              </span>
              {task.kind === 'plus' ? (
                renderGroup(task.a, task.a + task.b)
              ) : (
                /* «минус»: вторая группа зачёркивается и улетает */
                <motion.div
                  initial={{ opacity: 1, x: 0, y: 0, rotate: 0 }}
                  animate={{ opacity: 0.35, x: 16, y: -12, rotate: 10 }}
                  transition={{ delay: 0.7, duration: 0.7, ease: 'easeInOut' }}
                  className="relative"
                >
                  {renderGroup(task.a, task.a + task.b)}
                  <motion.span
                    aria-hidden
                    className="absolute rounded-full"
                    style={{
                      left: '-6%',
                      right: '-6%',
                      top: '50%',
                      marginTop: -2.5,
                      height: 5,
                      background: '#F43F5E',
                      boxShadow: '0 2px 8px rgba(244,63,94,0.5)',
                    }}
                    initial={{ scaleX: 0, rotate: -16 }}
                    animate={{ scaleX: 1, rotate: -16 }}
                    transition={{ delay: 0.35, duration: 0.35, ease: 'easeOut' }}
                  />
                </motion.div>
              )}
            </>
          )}
        </motion.div>
      </div>

      {/* подсказка (место зарезервировано — без прыжков макета) */}
      <div className="h-5 text-center text-[12.5px] font-bold" style={{ color: 'var(--g-fg-soft)' }}>
        {hint}
      </div>

      {/* варианты ответа */}
      <div className="grid grid-cols-3 gap-2.5 mt-1">
        {task.options.map((n, i) => {
          const isWrong = tried.includes(n)
          return (
            <motion.button
              key={`${round}-${n}`}
              onClick={() => onAnswer(n)}
              disabled={locked || isWrong}
              animate={wrongPick === n ? { x: [0, -9, 9, -7, 7, -3, 0] } : { x: 0 }}
              transition={{ duration: 0.45 }}
              className={`h-[78px] rounded-3xl text-[38px] font-black text-white transition-opacity ${
                isWrong ? 'opacity-30 saturate-50' : 'active:scale-95'
              }`}
              style={{
                background: OPTION_GRADS[i % OPTION_GRADS.length],
                boxShadow:
                  celebrate && n === task.answer
                    ? '0 0 0 3px rgba(251,191,36,0.85), 0 14px 30px -12px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)'
                    : '0 14px 30px -12px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)',
              }}
              aria-label={`Вариант ${n}`}
            >
              {n}
            </motion.button>
          )
        })}
      </div>

      <p className="text-center text-[10.5px] mt-1.5" style={{ color: 'var(--g-fg-mute)' }}>
        Выбери правильную цифру
      </p>

      {/* звёздочка-награда летит в прогресс */}
      {flyKey > 0 && (
        <motion.span
          key={flyKey}
          className="pointer-events-none absolute left-1/2 top-1/2 text-4xl z-20"
          initial={{ x: '-50%', y: -16, scale: 1, opacity: 1 }}
          animate={{ x: '-50%', y: -270, scale: 0.45, opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeIn' }}
        >
          ⭐
        </motion.span>
      )}
    </div>
  )
}
