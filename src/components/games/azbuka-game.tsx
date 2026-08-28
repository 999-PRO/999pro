'use client'

// ============================================================================
// v25.24 — АЗБУКА: учим русские буквы со звуком (малышам 4–7 лет).
//   • 33 буквы: карточка «буква + слово + эмодзи», для Ъ/Ы/Ь — слова, где
//     буква есть внутри (подъезд, сыр, соль) с подсветкой.
//   • Режим «Учим»: огромная градиентная карточка, 🔊 произносит
//     «Буква М! Мышь» через speechSynthesis (ru-RU; нет API — кнопки нет),
//     стрелки ←/→ (и с клавиатуры), внизу лента-прокрутка всех букв.
//   • Режим «Игра»: «Найди букву М» — 4 карточки с непохожими буквами,
//     верно → sfx.correct + подпрыгивание + мини-конфетти, мимо → sfx.wrong
//     + тряска. 10 раундов, лучшая серия — рекорд useBest('azbuka').
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, ChevronLeft, ChevronRight, Gamepad2, RotateCcw, Volume2 } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

/* ------------------------------- данные ------------------------------- */

interface LetterInfo {
  ch: string
  word: string
  emoji: string
  /** подсказка для букв-знаков и «спрятавшихся» букв */
  note?: string
}

const VOWELS = new Set(['А', 'Е', 'Ё', 'И', 'О', 'У', 'Ы', 'Э', 'Ю', 'Я'])

const ALPHABET: LetterInfo[] = [
  { ch: 'А', word: 'Арбуз', emoji: '🍉' },
  { ch: 'Б', word: 'Банан', emoji: '🍌' },
  { ch: 'В', word: 'Волк', emoji: '🐺' },
  { ch: 'Г', word: 'Гриб', emoji: '🍄' },
  { ch: 'Д', word: 'Дом', emoji: '🏠' },
  { ch: 'Е', word: 'Ель', emoji: '🌲' },
  { ch: 'Ё', word: 'Ёжик', emoji: '🦔' },
  { ch: 'Ж', word: 'Жираф', emoji: '🦒' },
  { ch: 'З', word: 'Зебра', emoji: '🦓' },
  { ch: 'И', word: 'Индюк', emoji: '🦃' },
  { ch: 'Й', word: 'Йогурт', emoji: '🥛' },
  { ch: 'К', word: 'Кот', emoji: '🐱' },
  { ch: 'Л', word: 'Лиса', emoji: '🦊' },
  { ch: 'М', word: 'Мышь', emoji: '🐭' },
  { ch: 'Н', word: 'Носорог', emoji: '🦏' },
  { ch: 'О', word: 'Облако', emoji: '☁️' },
  { ch: 'П', word: 'Пингвин', emoji: '🐧' },
  { ch: 'Р', word: 'Ракета', emoji: '🚀' },
  { ch: 'С', word: 'Слон', emoji: '🐘' },
  { ch: 'Т', word: 'Тигр', emoji: '🐯' },
  { ch: 'У', word: 'Утка', emoji: '🦆' },
  { ch: 'Ф', word: 'Флаг', emoji: '🚩' },
  { ch: 'Х', word: 'Хлеб', emoji: '🍞' },
  { ch: 'Ц', word: 'Цветок', emoji: '🌺' },
  { ch: 'Ч', word: 'Часы', emoji: '⏰' },
  { ch: 'Ш', word: 'Шар', emoji: '🎈' },
  { ch: 'Щ', word: 'Щётка', emoji: '🧹' },
  { ch: 'Ъ', word: 'Подъезд', emoji: '🚪', note: 'твёрдый знак' },
  { ch: 'Ы', word: 'Сыр', emoji: '🧀', note: 'в середине слова' },
  { ch: 'Ь', word: 'Соль', emoji: '🧂', note: 'мягкий знак' },
  { ch: 'Э', word: 'Экскаватор', emoji: '🚜' },
  { ch: 'Ю', word: 'Юла', emoji: '🪀' },
  { ch: 'Я', word: 'Яблоко', emoji: '🍎' },
]

/** пары/группы визуально похожих букв — в игре их не смешиваем */
const SIMILAR: string[][] = [
  ['А', 'Д', 'Л'],
  ['Б', 'В'],
  ['В', 'З'],
  ['Е', 'Ё', 'З'],
  ['Ж', 'К', 'Х'],
  ['И', 'Н', 'П'],
  ['О', 'С', 'Э'],
  ['Р', 'Ь'],
  ['Т', 'Г'],
  ['У', 'Ч'],
  ['Ш', 'Щ'],
  ['Ь', 'Ъ', 'Ы'],
  ['Ц', 'Щ'],
  ['Я', 'А'],
]

const isSimilar = (a: string, b: string): boolean => SIMILAR.some((g) => g.includes(a) && g.includes(b))

const isSign = (ch: string): boolean => ch === 'Ь' || ch === 'Ъ'

const letterKind = (ch: string): string => (isSign(ch) ? 'знак' : VOWELS.has(ch) ? 'гласная' : 'согласная')

/** градиент карточки: гласные — тёплые, согласные — холодные, знаки — сирень */
const letterGrad = (ch: string): string =>
  isSign(ch)
    ? 'linear-gradient(150deg,#A78BFA,#7C3AED)'
    : VOWELS.has(ch)
      ? 'linear-gradient(150deg,#FB7185,#F59E0B)'
      : 'linear-gradient(150deg,#38BDF8,#6366F1)'

const AZ_GRADS = [
  'linear-gradient(140deg,#F9A8D4,#EC4899)',
  'linear-gradient(140deg,#7DD3FC,#0EA5E9)',
  'linear-gradient(140deg,#6EE7B7,#10B981)',
  'linear-gradient(140deg,#FCD34D,#F59E0B)',
]

const ROUNDS = 10

/* ----------------------------- речь (TTS) ----------------------------- */

function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Произносит текст по-русски. Если API нет — тихо ничего не делает. */
function speakText(text: string): void {
  try {
    if (!canSpeak()) return
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ru-RU'
    u.rate = 0.85
    u.pitch = 1.05
    const voices = synth.getVoices()
    const ru = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ru'))
    if (ru) u.voice = ru
    synth.speak(u)
  } catch {}
}

/* ------------------------------ утилиты ------------------------------ */

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

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

const makeConfetti = (count: number): ConfettiPiece[] =>
  Array.from({ length: count }, () => ({
    left: 3 + Math.random() * 94,
    delay: Math.random() * 0.7,
    dur: 1.5 + Math.random() * 1.5,
    drift: (Math.random() * 2 - 1) * 100,
    size: 6 + Math.random() * 7,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rot: Math.random() * 360,
  }))

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

/* ============================== игра ============================== */

export function AzbukaGame() {
  const [mode, setMode] = useState<'learn' | 'play'>('learn')
  const [speechOk, setSpeechOk] = useState(false)

  // ---- «Учим» ----
  const [idx, setIdx] = useState(0)
  const [dir, setDir] = useState(1)
  const tapeRef = useRef<HTMLDivElement>(null)

  // ---- «Игра» ----
  const [playPhase, setPlayPhase] = useState<'run' | 'end'>('run')
  const [roundIdx, setRoundIdx] = useState(0)
  const [target, setTarget] = useState<LetterInfo>(ALPHABET[0])
  const [options, setOptions] = useState<LetterInfo[]>([])
  const [wrongCh, setWrongCh] = useState<string | null>(null)
  const [wrongPicks, setWrongPicks] = useState<string[]>([])
  const [solvedCh, setSolvedCh] = useState<string | null>(null)
  const [streak, setStreak] = useState(0)
  const [dots, setDots] = useState<boolean[]>([])
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([])
  const [newRecord, setNewRecord] = useState(false)

  const [best, submitBest] = useBest('azbuka')

  const deckRef = useRef<string[]>([])
  const maxStreakRef = useRef(0)
  const mistakeRef = useRef(false)
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

  useEffect(() => setSpeechOk(canSpeak()), [])

  /* ------------------------- режим «Учим» ------------------------- */

  const goLetter = useCallback((next: number, d: number) => {
    setDir(d)
    setIdx(((next % ALPHABET.length) + ALPHABET.length) % ALPHABET.length)
  }, [])

  // авто-озвучка карточки
  useEffect(() => {
    if (mode !== 'learn') return
    const l = ALPHABET[idx]
    speakText(`Буква ${l.ch}! ${l.word}.`)
  }, [mode, idx])

  // стрелки клавиатуры на десктопе
  useEffect(() => {
    if (mode !== 'learn') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goLetter(idx + 1, 1)
      if (e.key === 'ArrowLeft') goLetter(idx - 1, -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, idx, goLetter])

  // лента: держим активную букву по центру
  useEffect(() => {
    const cont = tapeRef.current
    if (!cont || mode !== 'learn') return
    const el = cont.querySelector<HTMLElement>(`[data-i="${idx}"]`)
    if (!el) return
    cont.scrollTo({ left: el.offsetLeft - cont.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [idx, mode])

  /* ------------------------- режим «Игра» ------------------------- */

  const takeTarget = useCallback((avoid?: string): LetterInfo => {
    if (deckRef.current.length === 0) deckRef.current = shuffle(ALPHABET.map((l) => l.ch))
    let ch = deckRef.current.pop()
    if (ch && avoid && ch === avoid && deckRef.current.length > 0) {
      deckRef.current.unshift(avoid)
      ch = deckRef.current.pop()
    }
    return ALPHABET.find((l) => l.ch === ch) ?? ALPHABET[0]
  }, [])

  const dealRound = useCallback(
    (avoid?: string) => {
      const t = takeTarget(avoid)
      const others = shuffle(ALPHABET.filter((l) => l.ch !== t.ch && !isSimilar(l.ch, t.ch))).slice(0, 3)
      setTarget(t)
      setOptions(shuffle([t, ...others]))
      setWrongCh(null)
      setWrongPicks([])
      setSolvedCh(null)
      mistakeRef.current = false
    },
    [takeTarget],
  )

  const startPlay = useCallback(() => {
    deckRef.current = []
    maxStreakRef.current = 0
    setStreak(0)
    setRoundIdx(0)
    setDots(Array.from({ length: ROUNDS }, () => false))
    setConfetti([])
    setNewRecord(false)
    setPlayPhase('run')
    dealRound()
    sfx.whoosh(1)
  }, [dealRound])

  const switchMode = useCallback(
    (m: 'learn' | 'play') => {
      if (m === mode) return
      sfx.tap()
      setMode(m)
      if (m === 'play') startPlay()
    },
    [mode, startPlay],
  )

  const advance = useCallback(() => {
    if (roundIdx + 1 >= ROUNDS) {
      const rec = submitBest(maxStreakRef.current)
      setNewRecord(rec)
      setConfetti(makeConfetti(32))
      sfx.win()
      setPlayPhase('end')
      return
    }
    const next = roundIdx + 1
    setRoundIdx(next)
    dealRound(target.ch)
  }, [roundIdx, dealRound, submitBest, target.ch])

  // озвучка цели раунда
  useEffect(() => {
    if (mode === 'play' && playPhase === 'run') speakText(`Найди букву ${target.ch}`)
  }, [mode, playPhase, target])

  const pick = useCallback(
    (l: LetterInfo) => {
      if (solvedCh || wrongCh) return
      if (l.ch === target.ch) {
        sfx.correct()
        setSolvedCh(l.ch)
        setDots((d) => {
          const next = [...d]
          next[roundIdx] = true
          return next
        })
        if (!mistakeRef.current) {
          const nextStreak = streak + 1
          setStreak(nextStreak)
          if (nextStreak > maxStreakRef.current) maxStreakRef.current = nextStreak
        } else {
          setStreak(0)
        }
        setConfetti(makeConfetti(14))
        later(() => setConfetti([]), 2400)
        later(advance, 1000)
      } else {
        sfx.wrong()
        mistakeRef.current = true
        setStreak(0)
        setWrongCh(l.ch)
        setWrongPicks((w) => (w.includes(l.ch) ? w : [...w, l.ch]))
        later(() => setWrongCh(null), 500)
      }
    },
    [solvedCh, wrongCh, target.ch, roundIdx, streak, advance, later],
  )

  const sayLetter = useCallback(() => {
    const l = ALPHABET[idx]
    sfx.tap()
    speakText(`Буква ${l.ch}! ${l.word}.`)
  }, [idx])

  /* ------------------------------ экраны ------------------------------ */

  const tabs = (
    <div
      className="flex gap-1 p-1 rounded-full mx-auto w-max"
      style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)' }}
    >
      {(
        [
          { id: 'learn', label: 'Учим', Icon: BookOpen },
          { id: 'play', label: 'Игра', Icon: Gamepad2 },
        ] as const
      ).map(({ id, label, Icon }) => {
        const active = mode === id
        return (
          <button
            key={id}
            onClick={() => switchMode(id)}
            className="h-11 px-5 rounded-full text-sm font-extrabold inline-flex items-center gap-1.5 transition-all active:scale-95"
            style={
              active
                ? { background: 'linear-gradient(135deg,#FBBF24,#F59E0B)', color: '#fff', boxShadow: '0 10px 24px -10px rgba(245,158,11,0.75)' }
                : { color: 'var(--g-fg-soft)' }
            }
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        )
      })}
    </div>
  )

  /* ---- «Учим» ---- */

  if (mode === 'learn') {
    const l = ALPHABET[idx]
    const hi = Math.max(0, l.word.toLowerCase().indexOf(l.ch.toLowerCase()))
    return (
      <div className="h-full w-full max-w-lg mx-auto flex flex-col px-3 md:px-6 pt-2 pb-2">
        {tabs}

        <div className="flex-1 min-h-0 flex flex-col justify-center py-2">
          <motion.div
            key={l.ch}
            initial={{ opacity: 0, x: dir * 56, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="w-full rounded-[30px] px-4 pt-5 pb-4 flex flex-col items-center text-center relative overflow-hidden"
            style={{ background: letterGrad(l.ch), boxShadow: '0 24px 50px -20px rgba(15,23,42,0.55)' }}
          >
            <span aria-hidden className="absolute -top-8 -right-8 h-28 w-28 rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }} />
            <span aria-hidden className="absolute -bottom-10 -left-6 h-24 w-24 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
            {l.note && (
              <span className="text-[11px] font-extrabold uppercase tracking-wide px-3 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
                {l.note}
              </span>
            )}
            <div className="text-[92px] md:text-[112px] leading-none font-black text-white" style={{ textShadow: '0 10px 30px rgba(15,23,42,0.35)' }}>
              {l.ch}
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <span className="text-[46px] leading-none">{l.emoji}</span>
              <span className="text-[26px] md:text-3xl font-extrabold text-white">
                {l.word.slice(0, hi)}
                <span className="px-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.26)' }}>
                  {l.word.slice(hi, hi + 1)}
                </span>
                {l.word.slice(hi + 1)}
              </span>
            </div>
            <div className="text-[12px] font-bold mt-2" style={{ color: 'rgba(255,255,255,0.82)' }}>
              {letterKind(l.ch)} · {idx + 1} из {ALPHABET.length}
            </div>
          </motion.div>

          {/* навигация: ← 🔊 → */}
          <div className="flex items-center justify-center gap-4 mt-4">
            <button
              onClick={() => {
                sfx.tap()
                goLetter(idx - 1, -1)
              }}
              aria-label="Предыдущая буква"
              className="h-14 w-14 rounded-full grid place-items-center border border-[var(--g-border)] bg-[var(--g-card)] hover:bg-[var(--g-btn-hover)] active:scale-90 transition-all"
              style={{ color: 'var(--g-fg)' }}
            >
              <ChevronLeft className="h-7 w-7" strokeWidth={2.5} />
            </button>
            {speechOk && (
              <button
                onClick={sayLetter}
                aria-label="Произнести букву и слово"
                className="h-14 w-14 rounded-full grid place-items-center text-white active:scale-90 transition-transform"
                style={{ background: 'linear-gradient(140deg,#FBBF24,#F59E0B)', boxShadow: '0 14px 30px -12px rgba(245,158,11,0.7)' }}
              >
                <Volume2 className="h-6 w-6" />
              </button>
            )}
            <button
              onClick={() => {
                sfx.tap()
                goLetter(idx + 1, 1)
              }}
              aria-label="Следующая буква"
              className="h-14 w-14 rounded-full grid place-items-center border border-[var(--g-border)] bg-[var(--g-card)] hover:bg-[var(--g-btn-hover)] active:scale-90 transition-all"
              style={{ color: 'var(--g-fg)' }}
            >
              <ChevronRight className="h-7 w-7" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* лента всех букв */}
        <div ref={tapeRef} className="relative w-full overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          <div className="flex gap-1.5 w-max mx-auto">
            {ALPHABET.map((al, i) => {
              const active = i === idx
              return (
                <button
                  key={al.ch}
                  data-i={i}
                  onClick={() => {
                    sfx.tap()
                    setDir(i > idx ? 1 : -1)
                    setIdx(i)
                  }}
                  className="h-11 w-9 rounded-xl text-lg font-extrabold shrink-0 transition-all active:scale-90"
                  style={
                    active
                      ? { background: 'linear-gradient(140deg,#FBBF24,#F59E0B)', color: '#fff', boxShadow: '0 8px 18px -6px rgba(245,158,11,0.7)' }
                      : { background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg-soft)' }
                  }
                  aria-label={`Буква ${al.ch}`}
                >
                  {al.ch}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  /* ---- «Игра»: финал ---- */

  if (playPhase === 'end') {
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
          Ты нашёл все {ROUNDS} букв!
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
            onClick={startPlay}
            className="h-12 rounded-2xl text-white text-base font-extrabold inline-flex items-center justify-center gap-2 active:scale-95"
            style={{ background: 'linear-gradient(135deg,#FBBF24,#F59E0B)', boxShadow: '0 16px 36px -14px rgba(245,158,11,0.65)' }}
          >
            <RotateCcw className="h-[18px] w-[18px]" /> Ещё раз
          </button>
          <button
            onClick={() => {
              sfx.tap()
              setMode('learn')
            }}
            className="h-12 rounded-2xl font-extrabold border border-[var(--g-border)] bg-[var(--g-btn)] hover:bg-[var(--g-btn-hover)] active:scale-95"
            style={{ color: 'var(--g-fg)' }}
          >
            <BookOpen className="inline h-[18px] w-[18px] mr-1.5 -mt-0.5" /> Учить буквы
          </button>
        </div>
      </div>
    )
  }

  /* ---- «Игра»: раунд ---- */

  return (
    <div className="h-full w-full max-w-lg mx-auto flex flex-col px-3 md:px-6 pt-2 pb-2">
      {tabs}

      {/* прогресс */}
      <div className="flex items-center justify-between mt-3 px-1">
        <div className="text-[12.5px] font-extrabold" style={{ color: 'var(--g-fg-soft)' }}>
          Раунд {roundIdx + 1} из {ROUNDS}
        </div>
        <div
          className="text-[12.5px] font-extrabold px-3 h-7 rounded-full inline-flex items-center gap-1"
          style={{
            background: streak > 0 ? 'var(--g-accent-soft)' : 'var(--g-chip)',
            border: '1px solid var(--g-chip-border)',
            color: streak > 0 ? 'var(--g-fg)' : 'var(--g-fg-mute)',
          }}
        >
          🔥 Серия: {streak}
        </div>
      </div>
      <div className="flex justify-center gap-1.5 mt-2">
        {dots.map((done, i) => (
          <motion.span
            key={i}
            animate={done ? { scale: [1.6, 1] } : { scale: 1 }}
            transition={{ duration: 0.3 }}
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: done ? 'linear-gradient(140deg,#FBBF24,#F59E0B)' : 'var(--g-chip-border)',
            }}
          />
        ))}
      </div>

      {/* задание */}
      <div className="flex items-center justify-center gap-3 mt-3">
        <span className="text-[17px] font-extrabold" style={{ color: 'var(--g-fg)' }}>
          Найди букву
        </span>
        <button
          onClick={() => speakText(`Найди букву ${target.ch}`)}
          className="h-[60px] px-5 rounded-2xl inline-flex items-center gap-2 text-white active:scale-95 transition-transform"
          style={{ background: letterGrad(target.ch), boxShadow: '0 16px 34px -14px rgba(15,23,42,0.6)' }}
          aria-label={`Найди букву ${target.ch}`}
        >
          <span className="text-[32px] font-black leading-none">{target.ch}</span>
          {speechOk && <Volume2 className="h-5 w-5 opacity-85" />}
        </button>
      </div>

      {/* карточки-буквы */}
      <div className="flex-1 min-h-0 relative grid grid-cols-2 gap-3 content-center py-3">
        <ConfettiLayer pieces={confetti} />
        {options.map((l, i) => {
          const isSolved = solvedCh === l.ch
          const isMissed = wrongPicks.includes(l.ch)
          return (
            <motion.button
              key={`${roundIdx}-${l.ch}`}
              initial={{ opacity: 0, y: 16, scale: 0.9 }}
              animate={{
                opacity: isMissed ? 0.3 : 1,
                scale: isSolved ? [1, 1.22, 1] : 1,
                x: wrongCh === l.ch ? [0, -9, 9, -7, 7, -3, 0] : 0,
              }}
              transition={
                wrongCh === l.ch
                  ? { duration: 0.45 }
                  : isSolved
                    ? { duration: 0.5 }
                    : isMissed
                      ? { duration: 0.25 }
                      : { duration: 0.35, delay: i * 0.06 }
              }
              onClick={() => pick(l)}
              disabled={!!solvedCh || isMissed}
              className={`h-[104px] md:h-[118px] rounded-[26px] text-[54px] md:text-[62px] font-black text-white ${
                isMissed ? 'saturate-50' : 'active:scale-95'
              }`}
              style={{
                background: AZ_GRADS[i % AZ_GRADS.length],
                boxShadow: isSolved
                  ? '0 0 0 3px rgba(52,211,153,0.8), 0 18px 40px -16px rgba(52,211,153,0.6), inset 0 1px 0 rgba(255,255,255,0.3)'
                  : '0 14px 30px -14px rgba(15,23,42,0.5), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
              aria-label={`Буква ${l.ch}`}
            >
              {l.ch}
            </motion.button>
          )
        })}
      </div>

      <p className="text-center text-[10.5px] pb-1" style={{ color: 'var(--g-fg-mute)' }}>
        Тапни по правильной букве — серия без ошибок даёт рекорд!
      </p>
    </div>
  )
}
