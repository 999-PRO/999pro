'use client'

// ============================================================================
// v25.24 — «ПУЗЫРИ» (детская реакционная): лопай воздушные шарики!
//   • Шарики поднимаются снизу; тап — хлопок с брызгами и звуком.
//   • Золотые шарики = +5, обычные = +1. 45 секунд. Рекорд сохраняется.
//   • Очень простая — для самых маленьких (и «для мальчиков» тоже заходит).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

interface Bubble {
  id: number
  x: number // %
  size: number // px
  color: string
  gold: boolean
  speed: number // сек подъёма
}

const COLORS = [
  ['#F87171', '#DC2626'],
  ['#FB923C', '#EA580C'],
  ['#FBBF24', '#D97706'],
  ['#34D399', '#059669'],
  ['#38BDF8', '#2563EB'],
  ['#A78BFA', '#7C3AED'],
  ['#F472B6', '#DB2777'],
]

const DURATION = 45

export function BubblesGame() {
  const [phase, setPhase] = useState<'idle' | 'play' | 'end'>('idle')
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [score, setScore] = useState(0)
  const [time, setTime] = useState(DURATION)
  const [pops, setPops] = useState<{ id: number; x: number; y: number; color: string }[]>([])
  const [best, submitBest] = useBest('bubbles')
  const idRef = useRef(0)
  const scoreRef = useRef(0)
  // v25.24 fix: framer не умеет анимировать calc()→px — меряем высоту поля
  // и гоняем пузыри в пикселях
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxH, setBoxH] = useState(600)
  useEffect(() => {
    const measure = () => setBoxH(boxRef.current?.offsetHeight || 600)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const start = useCallback(() => {
    setScore(0)
    scoreRef.current = 0
    setTime(DURATION)
    setBubbles([])
    setPops([])
    setPhase('play')
    sfx.whoosh(1)
  }, [])

  // таймер
  useEffect(() => {
    if (phase !== 'play') return
    const t = window.setInterval(() => {
      setTime((v) => {
        if (v <= 1) {
          window.clearInterval(t)
          submitBest(scoreRef.current)
          setPhase('end')
          sfx.win()
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [phase, submitBest])

  // спавн пузырей
  useEffect(() => {
    if (phase !== 'play') return
    const t = window.setInterval(() => {
      setBubbles((cur) => {
        if (cur.length > 12) return cur
        const gold = Math.random() < 0.14
        const [c1] = COLORS[Math.floor(Math.random() * COLORS.length)]
        const size = gold ? 58 : 46 + Math.random() * 30
        idRef.current += 1
        const b: Bubble = {
          id: idRef.current,
          x: 6 + Math.random() * 84,
          size,
          color: gold ? '#FCD34D' : c1,
          gold,
          speed: 6.5 + Math.random() * 5,
        }
        // удалить шарик, когда анимация подъёма закончилась
        window.setTimeout(() => {
          setBubbles((cur) => cur.filter((x) => x.id !== b.id))
        }, b.speed * 1000 + 200)
        return [...cur, b]
      })
    }, 620)
    return () => window.clearInterval(t)
  }, [phase])

  const pop = (b: Bubble, e: React.MouseEvent) => {
    e.stopPropagation()
    setBubbles((cur) => cur.filter((x) => x.id !== b.id))
    const add = b.gold ? 5 : 1
    scoreRef.current += add
    setScore(scoreRef.current)
    sfx.click()
    if (b.gold) sfx.coin()
    const pid = idRef.current++
    setPops((p) => [...p, { id: pid, x: b.x, y: 70, color: b.color }])
    window.setTimeout(() => setPops((p) => p.filter((q) => q.id !== pid)), 600)
  }

  if (phase === 'idle') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-5 px-6">
        <div className="h-24 w-24 rounded-[28px] grid place-items-center text-5xl" style={{ background: 'linear-gradient(140deg,#38BDF8,#2563EB)', boxShadow: '0 20px 50px -18px rgba(56,189,248,0.6)' }}>
          🫧
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>Пузыри</h2>
          <p className="text-sm mt-2 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--g-fg-soft)' }}>
            Лопай шарики пальчиком! Золотые дают +5. 45 секунд веселья — для больших и маленьких.
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
          style={{ background: 'linear-gradient(135deg,#38BDF8,#2563EB)', boxShadow: '0 18px 40px -14px rgba(56,189,248,0.65)' }}
        >
          <span className="inline-flex items-center gap-2"><Play className="h-5 w-5 fill-current" /> Лопать!</span>
        </button>
      </div>
    )
  }

  if (phase === 'end') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
        <div className="text-7xl">🫧</div>
        <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>Время вышло!</h2>
        <div className="rounded-2xl px-6 py-3 bg-[var(--g-card)] border border-[var(--g-border)]">
          <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>Лопнуто</div>
          <div className="text-3xl font-extrabold tabular-nums text-sky-500 dark:text-sky-400">{score.toLocaleString('ru-RU')}</div>
        </div>
        <p className="text-xs" style={{ color: 'var(--g-fg-mute)' }}>Рекорд: {best.toLocaleString('ru-RU')}</p>
        <button
          onClick={start}
          className="h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#38BDF8,#2563EB)' }}
        >
          <RotateCcw className="h-[18px] w-[18px]" /> Ещё раз
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col px-2.5 pt-2 pb-3 max-w-2xl mx-auto w-full gap-2">
      <div className="flex items-center justify-between px-1">
        <div className="rounded-full px-3.5 py-1 text-[13px] font-extrabold tabular-nums" style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg)' }}>
          🫧 {score}
        </div>
        <div className="text-[13px] font-extrabold tabular-nums" style={{ color: 'var(--g-fg-soft)' }}>⏱ {time} с</div>
      </div>

      <div
        ref={boxRef}
        className="relative flex-1 min-h-0 rounded-[20px] overflow-hidden touch-none"
        style={{ background: 'linear-gradient(180deg,rgba(56,189,248,0.10),rgba(56,189,248,0.02))', border: '1px solid var(--g-border)' }}
        onClick={() => sfx.tap()}
      >
        <AnimatePresence>
          {bubbles.map((b) => (
            <button
              key={b.id}
              onClick={(e) => pop(b, e)}
              className="absolute rounded-full grid place-items-center"
              style={{
                left: `${b.x}%`,
                bottom: -b.size - 20,
                width: b.size,
                height: b.size,
                background: b.gold
                  ? 'radial-gradient(circle at 32% 28%, #FEF9C3 0%, #FCD34D 45%, #F59E0B 100%)'
                  : `radial-gradient(circle at 32% 28%, ${b.color}F2 0%, ${b.color}C8 45%, ${b.color}88 100%)`,
                boxShadow: b.gold ? '0 6px 20px -6px rgba(245,158,11,0.75)' : `0 6px 20px -6px ${b.color}AA`,
                border: '1.5px solid rgba(255,255,255,0.5)',
                animation: `bubble-rise ${b.speed}s linear forwards`,
              }}
              aria-label="Пузырь"
            >
              {b.gold && <span className="text-xl">⭐</span>}
            </button>
          ))}
        </AnimatePresence>

        {/* брызги */}
        {pops.map((p) => (
          <motion.div
            key={p.id}
            initial={{ scale: 0.4, opacity: 0.9 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute rounded-full pointer-events-none"
            style={{ left: `${p.x}%`, bottom: '55%', width: 56, height: 56, marginLeft: -28, border: `4px solid ${p.color}` }}
          />
        ))}
      </div>

      <p className="text-[10.5px] text-[var(--g-fg-mute)] text-center">Лопай шарики! ⭐ золотые = +5</p>
    </div>
  )
}
