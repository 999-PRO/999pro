'use client'

// ============================================================================
// v25.25 — «Шашки» (русские): партия против компьютера.
//   • Деревянная доска, крупные векторные шашки, короны у дамок.
//   • Полные правила: обязательный бой, цепочки, дамки «на лету»,
//     превращение посреди боя, ничья по 15 тихим ходам.
//   • ИИ — minimax α-β по полным ходам (3 уровня), считает в setTimeout.
//   • Подсказка: шашки, обязанные бить, пульсируют золотым кольцом.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { getBest, useBest } from '@/lib/games/best-score'
import { CheckersBoard } from './checkers-board'
import {
  ckInitial, ckLegalSteps, ckApplyStep,
  type CkState, type CkStep, type CkSide,
} from '@/lib/games/checkers-core'
// v25.26: ИИ считает в Web Worker — главный поток свободен, UI не фризит
// (жалоба владельца: «играешь и останавливаешься»).
import { getCheckersAiMove, applyCkSteps } from '@/lib/games/checkers-ai-client'

type Level = 1 | 2 | 3
const LEVEL_META: { id: Level; name: string }[] = [
  { id: 1, name: 'Лёгкий' },
  { id: 2, name: 'Средний' },
  { id: 3, name: 'Сложный' },
]

const ME: CkSide = 'w'

export function CheckersGame() {
  const stRef = useRef<CkState>(ckInitial('w'))
  const [, forceRender] = useState(0)
  const rerender = useCallback(() => forceRender((v) => v + 1), [])

  const [level, setLevel] = useState<Level>(2)
  const [selected, setSelected] = useState<number | null>(null)
  const [thinking, setThinking] = useState(false)
  const [wins, submitWins] = useBest('checkers-wins')
  const countedRef = useRef(false)

  const st = stRef.current
  const myTurn = !st.winner && st.turn === ME
  const legal = ckLegalSteps(st)
  const targets: CkStep[] = selected !== null ? legal.filter((m) => m.from === selected) : []
  const mustPieces = legal.some((m) => m.cap !== null) ? Array.from(new Set(legal.map((m) => m.from))) : []

  const countSide = (s: CkState, side: CkSide) => s.cells.filter((c) => (side === 'w' ? c === 1 || c === 2 : c === 3 || c === 4)).length

  const syncEnd = useCallback(
    (s: CkState) => {
      if (!s.winner) return
      if (s.winner === 'w') {
        if (!countedRef.current) {
          countedRef.current = true
          submitWins(getBest('checkers-wins') + 1)
        }
        window.setTimeout(() => sfx.win(), 200)
      } else if (s.winner === 'b') {
        window.setTimeout(() => sfx.lose(), 200)
      } else {
        window.setTimeout(() => sfx.tick(), 200)
      }
    },
    [submitWins, wins],
  )

  const newGame = useCallback(() => {
    stRef.current = ckInitial('w')
    setSelected(null)
    setThinking(false)
    countedRef.current = false
    rerender()
    sfx.whoosh(1)
  }, [rerender])

  const maybeAi = useCallback(
    (s: CkState) => {
      if (s.winner || s.turn !== 'b') return
      const fenAtStart = s
      setThinking(true)
      // v25.26: расчёт в Web Worker — UI не замирает на время поиска.
      void getCheckersAiMove(s, level).then((steps) => {
        const cur = stRef.current
        // защита от «Заново» во время расчёта
        if (cur !== fenAtStart || cur.winner || cur.turn !== 'b') {
          setThinking(false)
          return
        }
        const next = steps ? applyCkSteps(cur, steps) : null
        if (next) {
          stRef.current = next
          if (steps!.some((x) => x.cap != null)) sfx.capture()
          else sfx.move()
          syncEnd(next)
        }
        setThinking(false)
        rerender()
      })
    },
    [level, rerender, syncEnd],
  )

  const tap = useCallback(
    (idx: number) => {
      if (thinking || stRef.current.winner) return
      const s = stRef.current
      if (s.turn !== ME) return
      const steps = ckLegalSteps(s)

      // тап по цели выбранной шашки
      if (selected !== null) {
        const step = steps.find((m) => m.from === selected && m.to === idx)
        if (step) {
          const applied = ckApplyStep(s, step)
          if (applied) {
            stRef.current = applied
            if (step.cap != null) sfx.capture()
            else sfx.move()
            setSelected(null)
            syncEnd(applied)
            rerender()
            // если цепочка боя продолжается — остаёмся ходить; иначе ИИ
            if (!applied.winner && applied.chainFrom === null && applied.turn === 'b') maybeAi(applied)
            return
          }
        }
      }

      // выбор своей шашки
      const sideOfCell = s.cells[idx]
      const mine = ME === 'w' ? sideOfCell === 1 || sideOfCell === 2 : sideOfCell === 3 || sideOfCell === 4
      if (mine && steps.some((m) => m.from === idx)) {
        setSelected(idx)
        sfx.tap()
        return
      }
      setSelected(null)
    },
    [selected, thinking, rerender, maybeAi, syncEnd],
  )

  useEffect(() => {
    rerender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusText = st.winner
    ? st.winner === 'w'
      ? '👑 Ты победил!'
      : st.winner === 'b'
        ? '💔 Компьютер победил'
        : '🤝 Ничья'
    : thinking
      ? '🤖 Компьютер думает…'
      : st.chainFrom !== null && st.turn === ME
        ? '⚔️ Продолжай бой той же шашкой!'
        : legal.some((m) => m.cap != null)
          ? '⚔️ Есть взятие — бить обязательно!'
          : 'Твой ход (белые)'

  const chipBtn =
    'h-8 px-3 rounded-full text-[11px] md:text-xs font-extrabold border transition-all inline-flex items-center gap-1.5 active:scale-95 disabled:opacity-40'

  return (
    <div className="h-full flex flex-col items-center px-2.5 md:px-6 pt-2 md:pt-4 pb-3 max-w-3xl mx-auto w-full gap-2">
      <div className="w-full flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {LEVEL_META.map((l) => (
            <button
              key={l.id}
              onClick={() => { setLevel(l.id); sfx.tap() }}
              disabled={thinking || st.turn !== 'w' || st.chainFrom !== null}
              className={[
                'h-7 px-2.5 rounded-full text-[10.5px] md:text-xs font-extrabold border transition-all',
                level === l.id ? 'text-white border-transparent' : 'text-[var(--g-fg-soft)] border-[var(--g-chip-border)] bg-[var(--g-btn)] hover:bg-[var(--g-btn-hover)]',
              ].join(' ')}
              style={level === l.id ? { background: 'linear-gradient(135deg,#D9A05B,#9C6B33)' } : undefined}
            >
              {l.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-[var(--g-fg-mute)] mr-0.5">🏆 {wins}</span>
          <span className="text-[11px] font-bold text-[var(--g-fg-mute)]">Шашки {countSide(st, 'w')} : {countSide(st, 'b')}</span>
          <button onClick={newGame} className={`${chipBtn} text-white border-transparent`} style={{ background: 'linear-gradient(135deg,#D9A05B,#9C6B33)' }}>
            <RotateCcw className="h-3.5 w-3.5" /> Заново
          </button>
        </div>
      </div>

      <div
        className="rounded-full px-4 py-1 text-[12.5px] font-extrabold border max-w-full truncate"
        style={{
          background: st.winner ? (st.winner === 'w' ? 'rgba(16,185,129,0.16)' : st.winner === 'b' ? 'rgba(239,68,68,0.16)' : 'rgba(245,158,11,0.14)') : 'var(--g-chip)',
          borderColor: st.winner === 'w' ? 'rgba(16,185,129,0.5)' : st.winner === 'b' ? 'rgba(239,68,68,0.5)' : 'var(--g-chip-border)',
          color: st.winner === 'w' ? '#34D399' : st.winner === 'b' ? '#F87171' : st.winner === 'draw' ? '#FBBF24' : 'var(--g-fg-soft)',
        }}
      >
        {statusText}
      </div>

      <CheckersBoard
        st={st}
        selected={selected}
        targets={targets}
        me={ME}
        disabled={!myTurn || thinking || !!st.winner}
        mustCapture={mustPieces}
        onTap={tap}
      />

      <p className="text-[10.5px] text-[var(--g-fg-mute)] text-center px-4">
        Русские шашки: бить обязательно, боевые шашки подсвечены. Дамка — с короной, ходит и бьёт на любое расстояние.
      </p>
    </div>
  )
}
