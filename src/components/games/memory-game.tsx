'use client'

// ============================================================================
// v25.24 — «НАЙДИ ПАРУ» (детская мемори-игра): цветные карточки-животные.
//   • 2 уровня: лёгкий 4×3 (6 пар), сложный 4×4 (8 пар).
//   • Переворот с 3D-анимацией, сочные градиентные рубашки, звёзды за победу.
//   • Счёт по числу ходов — меньше ходов, тем лучше (рекорд сохраняется).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Baby, Play, RotateCcw, Sparkles } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

const ANIMALS = ['🐶', '🐱', '🦊', '🐼', '🐨', '🦁', '🐸', '🐵', '🦄', '🐝', '🦋', '🐢']
const BACKS = [
  'linear-gradient(140deg,#F472B6,#DB2777)',
  'linear-gradient(140deg,#38BDF8,#4F46E5)',
  'linear-gradient(140deg,#34D399,#059669)',
  'linear-gradient(140deg,#FBBF24,#F97316)',
]

interface Card {
  id: number
  emoji: string
  flipped: boolean
  done: boolean
}

function buildDeck(pairs: number): Card[] {
  const chosen = [...ANIMALS.slice(0, 6), '🦄', '🐝'].slice(0, pairs)
  const deck = [...chosen, ...chosen].map((emoji, i) => ({ id: i, emoji, flipped: false, done: false }))
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck.map((c, i) => ({ ...c, id: i }))
}

export function MemoryGame() {
  const [phase, setPhase] = useState<'idle' | 'play' | 'end'>('idle')
  const [pairs, setPairs] = useState(6)
  const [cards, setCards] = useState<Card[]>([])
  const [openIds, setOpenIds] = useState<number[]>([])
  const [moves, setMoves] = useState(0)
  const [best, submitBest] = useBest('memory')
  const lockRef = useRef(false)

  const start = useCallback(
    (p: number) => {
      setPairs(p)
      setCards(buildDeck(p))
      setOpenIds([])
      setMoves(0)
      lockRef.current = false
      setPhase('play')
      sfx.whoosh(1)
    },
    [],
  )

  // победа
  useEffect(() => {
    if (phase !== 'play' || !cards.length) return
    if (cards.every((c) => c.done)) {
      const t = window.setTimeout(() => {
        setPhase('end')
        sfx.win()
        submitBest(best === 0 ? moves : Math.min(best, moves))
      }, 650)
      return () => window.clearTimeout(t)
    }
  }, [cards, phase, best, moves, submitBest])

  const flip = (id: number) => {
    if (lockRef.current) return
    const card = cards.find((c) => c.id === id)
    if (!card || card.flipped || card.done) return
    sfx.tap()
    const nextOpen = [...openIds, id]
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, flipped: true } : c)))
    setOpenIds(nextOpen)

    if (nextOpen.length === 2) {
      setMoves((m) => m + 1)
      const [a, b] = nextOpen
      const ca = cards.find((c) => c.id === a)!
      const cb = card
      if (ca.emoji === cb.emoji) {
        sfx.reveal()
        window.setTimeout(() => {
          setCards((cs) => cs.map((c) => (c.id === a || c.id === b ? { ...c, done: true, flipped: true } : c)))
          setOpenIds([])
        }, 420)
      } else {
        lockRef.current = true
        sfx.wrong()
        window.setTimeout(() => {
          setCards((cs) => cs.map((c) => (c.id === a || c.id === b ? { ...c, flipped: false } : c)))
          setOpenIds([])
          lockRef.current = false
        }, 820)
      }
    }
  }

  const cols = 'grid-cols-4'

  if (phase === 'idle') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-5 px-6">
        <div className="h-24 w-24 rounded-[28px] grid place-items-center text-5xl" style={{ background: 'linear-gradient(140deg,#34D399,#0D9488)', boxShadow: '0 20px 50px -18px rgba(52,211,153,0.6)' }}>
          🐣
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>Найди пару</h2>
          <p className="text-sm mt-2 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--g-fg-soft)' }}>
            Переворачивай карточки и находи одинаковых зверят. Играй вместе с малышом — кто найдёт больше пар за меньше ходов?
          </p>
        </div>
        {best > 0 && (
          <div className="rounded-full px-4 py-1.5 bg-[var(--g-chip)] border border-[var(--g-chip-border)] text-sm font-bold" style={{ color: 'var(--g-fg-soft)' }}>
            🏆 Лучший результат: {best} ходов
          </div>
        )}
        <div className="flex flex-col gap-2.5 w-full max-w-[260px]">
          <button onClick={() => start(6)} className="py-3.5 rounded-2xl text-white text-base font-extrabold active:scale-95" style={{ background: 'linear-gradient(135deg,#34D399,#059669)', boxShadow: '0 16px 36px -14px rgba(16,185,129,0.65)' }}>
            <span className="inline-flex items-center gap-2"><Play className="h-5 w-5 fill-current" /> Лёгкий · 6 пар</span>
          </button>
          <button onClick={() => start(8)} className="h-12 py-3 rounded-2xl font-extrabold active:scale-95 border border-[var(--g-border)] bg-[var(--g-card)]" style={{ color: 'var(--g-fg)' }}>
            Сложный · 8 пар
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'end') {
    const stars = moves <= pairs + 3 ? 3 : moves <= pairs + 8 ? 2 : 1
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
        <motion.div initial={{ scale: 0.5, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} className="text-7xl">🌟</motion.div>
        <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>Все пары найдены!</h2>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <Sparkles key={i} className={`h-8 w-8 ${i < stars ? 'text-amber-400 fill-amber-400' : 'text-[var(--g-fg-mute)]'}`} />
          ))}
        </div>
        <div className="text-sm font-bold" style={{ color: 'var(--g-fg-soft)' }}>Ходов: {moves}</div>
        <button
          onClick={() => setPhase('idle')}
          className="h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#34D399,#059669)' }}
        >
          <RotateCcw className="h-[18px] w-[18px]" /> Играть снова
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center px-2.5 md:px-6 pt-2 pb-3 max-w-lg mx-auto w-full gap-2.5">
      <div className="w-full flex items-center justify-between px-1">
        <div className="text-sm font-extrabold" style={{ color: 'var(--g-fg-soft)' }}>
          <Baby className="inline h-4 w-4 mr-1 -mt-0.5" /> Ходов: {moves}
        </div>
        <button
          onClick={() => start(pairs)}
          className="h-8 px-3 rounded-full text-[11px] font-extrabold inline-flex items-center gap-1.5 border border-[var(--g-border)] bg-[var(--g-btn)] hover:bg-[var(--g-btn-hover)] active:scale-95"
          style={{ color: 'var(--g-fg-soft)' }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Заново
        </button>
      </div>

      <div className={`grid ${cols} gap-2 w-full flex-1 min-h-0 content-center`} style={{ perspective: 900 }}>
        {cards.map((c) => {
          const shown = c.flipped || c.done
          return (
            <button
              key={c.id}
              onClick={() => flip(c.id)}
              className="relative w-full rounded-2xl transition-transform duration-150 active:scale-95"
              style={{ aspectRatio: '3/4', transformStyle: 'preserve-3d' }}
              aria-label="Карточка"
            >
              {/* рубашка */}
              <span
                className="absolute inset-0 rounded-2xl grid place-items-center transition-opacity duration-200"
                style={{
                  background: BACKS[c.id % BACKS.length],
                  opacity: shown ? 0 : 1,
                  boxShadow: '0 8px 18px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.35)',
                }}
              >
                <span className="text-2xl opacity-60">❓</span>
              </span>
              {/* лицо */}
              <span
                className="absolute inset-0 rounded-2xl grid place-items-center text-[34px] md:text-4xl transition-opacity duration-200"
                style={{
                  background: 'var(--g-card-solid)',
                  border: '1px solid var(--g-border)',
                  opacity: shown ? 1 : 0,
                  boxShadow: c.done ? '0 0 0 2.5px rgba(52,211,153,0.7), 0 8px 18px -8px rgba(16,185,129,0.5)' : '0 8px 18px -8px rgba(0,0,0,0.35)',
                }}
              >
                {c.emoji}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-[10.5px] text-[var(--g-fg-mute)] text-center">Найди двух одинаковых зверят!</p>
    </div>
  )
}
