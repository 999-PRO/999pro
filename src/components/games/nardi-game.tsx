'use client'

// ============================================================================
// v25.24 — «НАРДЫ» (короткие): партия против компьютера.
//   • Полные правила коротких нард: бар, вход с бара, сруб блота, выброс
//     (точный кубик / перебор с дальней), дубль = 4 хода, «нет хода — передай».
//   • ИИ — перебор последовательностей + эвристика (nardi-engine).
//   • Доска — общий компонент NardiBoard (он же в онлайн-дуэли).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, RotateCcw, SkipForward, Trophy } from 'lucide-react'
import {
  nardiInitial,
  nardiLegalMoves,
  nardiApply,
  nardiNextTurn,
  nardiHasAnyMove,
  nardiBestMove,
  pipCount,
  type NardiState,
  type NardiMove,
  type Side,
} from '@/lib/games/nardi-engine'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'
import { NardiBoard } from './nardi-board'

const ME: Side = 'w'
const AI: Side = 'b'

export function NardiGame() {
  const [phase, setPhase] = useState<'idle' | 'play' | 'end'>('idle')
  const [st, setSt] = useState<NardiState>(() => nardiInitial('w'))
  const [selected, setSelected] = useState<number | null>(null) // -1 = бар
  const [win, setWin] = useState<null | 'win' | 'lose'>(null)
  const [best, submitBest] = useBest('nardi')
  const [wins, submitWins] = useBest('nardi-wins')
  const busyRef = useRef(false)
  const timersRef = useRef<number[]>([])

  const cleanupTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t))
    timersRef.current = []
  }
  useEffect(() => () => cleanupTimers(), [])

  const startGame = useCallback(() => {
    cleanupTimers()
    busyRef.current = false
    const first: Side = Math.random() < 0.5 ? ME : AI
    const fresh = nardiNextTurn(nardiInitial(first))
    setSt(fresh)
    setSelected(null)
    setWin(null)
    setPhase('play')
    sfx.whoosh(1)
  }, [])

  const finish = useCallback(
    (winner: Side) => {
      setPhase('end')
      setWin(winner === ME ? 'win' : 'lose')
      if (winner === ME) {
        submitWins(wins + 1)
        submitBest(best + 100)
        sfx.win()
      } else {
        sfx.lose()
      }
    },
    [best, submitBest, submitWins, wins],
  )

  const applyAndContinue = useCallback(
    (next: NardiState) => {
      if (next.winner) {
        setSt(next)
        finish(next.winner)
        return
      }
      setSt(next)
      setSelected(null)
    },
    [finish],
  )

  // ---- Ход ИИ ----
  const stRef = useRef(st)
  stRef.current = st
  const finishRef = useRef(finish)
  finishRef.current = finish
  const applyRef = useRef(applyAndContinue)
  applyRef.current = applyAndContinue

  useEffect(() => {
    if (phase !== 'play' || st.turn !== AI || st.winner) return
    busyRef.current = true
    const t0 = window.setTimeout(() => {
      const cur0 = stRef.current
      if (!nardiHasAnyMove(cur0)) {
        const t = window.setTimeout(() => {
          busyRef.current = false
          applyRef.current(nardiNextTurn(cur0))
        }, 550)
        timersRef.current.push(t)
        return
      }
      const { moves } = nardiBestMove(cur0)
      let cur = cur0
      moves.forEach((m, idx) => {
        const t = window.setTimeout(() => {
          const hitBlot = m.to < 24 && ((cur.turn === 'w' && cur.points[m.to] === -1) || (cur.turn === 'b' && cur.points[m.to] === 1))
          cur = nardiApply(cur, m)
          if (m.to === 24 || m.to === 0) sfx.coin()
          else if (hitBlot) sfx.capture()
          else sfx.move()
          setSt({ ...cur })
          if (idx === moves.length - 1) {
            const t2 = window.setTimeout(() => {
              busyRef.current = false
              if (cur.winner) finishRef.current(cur.winner)
              else applyRef.current(nardiNextTurn(cur))
            }, 480)
            timersRef.current.push(t2)
          }
        }, 480 + idx * 480)
        timersRef.current.push(t)
      })
    }, 620)
    timersRef.current.push(t0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, st.turn, st.winner])

  // Доступные ходы для выбранной шашки
  const legalAny = nardiLegalMoves(st)
  const myTargets = selected !== null ? legalAny.filter((m) => m.from === selected) : []
  const mustPass = phase === 'play' && st.turn === ME && !busyRef.current && legalAny.length === 0

  const onPointTap = (i: number) => {
    if (phase !== 'play' || busyRef.current || st.turn !== ME) return
    // цель?
    const options = myTargets.filter((m) => m.to === i)
    if (options.length && selected !== null) {
      const mv = options[0]
      const next = nardiApply(st, mv)
      if (mv.to === 24) sfx.coin()
      else sfx.move()
      applyAndContinue(next)
      return
    }
    // выбор своей шашки
    const sign = ME === 'w' ? 1 : -1
    if (st.points[i] * sign > 0 && legalAny.some((m) => m.from === i)) {
      setSelected(i)
      sfx.tap()
      return
    }
    setSelected(null)
  }

  const onBarTap = () => {
    if (phase !== 'play' || busyRef.current || st.turn !== ME) return
    if (st.bar[ME] > 0 && legalAny.some((m) => m.from === -1)) {
      setSelected(-1)
      sfx.tap()
    }
  }

  const passTurn = () => {
    sfx.whoosh(-1)
    applyAndContinue(nardiNextTurn(st))
  }

  if (phase === 'idle') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-5 px-6">
        <div
          className="h-24 w-24 rounded-[28px] grid place-items-center text-5xl"
          style={{ background: 'linear-gradient(140deg,#B0722F,#7C4A1D)', boxShadow: '0 20px 50px -18px rgba(176,114,47,0.6)' }}
        >
          🎲
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>Нарды</h2>
          <p className="text-sm mt-2 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--g-fg-soft)' }}>
            Классические короткие нарды против компьютера. Сруби шашки, занимай пункты и первым выбрось все 15!
          </p>
        </div>
        {wins > 0 && (
          <div className="rounded-full px-4 py-1.5 bg-[var(--g-chip)] border border-[var(--g-chip-border)] text-sm font-bold" style={{ color: 'var(--g-fg-soft)' }}>
            🏆 Побед: {wins}
          </div>
        )}
        <button
          onClick={startGame}
          className="h-14 px-10 rounded-2xl text-white text-lg font-extrabold transition-transform active:scale-95 hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg,#C98A3D,#8F5A22)', boxShadow: '0 18px 40px -14px rgba(176,114,47,0.65)' }}
        >
          <span className="inline-flex items-center gap-2"><Play className="h-5 w-5 fill-current" /> Играть</span>
        </button>
      </div>
    )
  }

  const myPips = pipCount(st, ME)
  const aiPips = pipCount(st, AI)

  return (
    <div className="h-full flex flex-col items-center px-2 md:px-6 pt-2 pb-3 max-w-3xl mx-auto w-full gap-2">
      {/* статус-полоса: пипсы + ход */}
      <div className="w-full flex items-center justify-between gap-2 px-1" style={{ width: 'min(96vw, 56vh, 560px)' }}>
        <div className="text-[11px] font-bold shrink-0" style={{ color: 'var(--g-fg-mute)' }}>
          🤖 {aiPips}
        </div>
        <div
          className="rounded-full px-3.5 py-1 text-[12px] font-extrabold border"
          style={{
            background: st.turn === ME ? 'rgba(16,185,129,0.15)' : 'var(--g-chip)',
            borderColor: st.turn === ME ? 'rgba(16,185,129,0.5)' : 'var(--g-chip-border)',
            color: st.turn === ME ? '#34D399' : 'var(--g-fg-soft)',
          }}
        >
          {st.turn === ME ? '🎲 Твой ход' : '🤖 Ходит ИИ…'}
        </div>
        <div className="text-[11px] font-bold shrink-0" style={{ color: 'var(--g-fg-mute)' }}>
          Ты {myPips}
        </div>
      </div>

      <div className="relative">
        <NardiBoard st={st} selected={selected} targets={myTargets} me={ME} disabled={st.turn !== ME || busyRef.current} onPointTap={onPointTap} onBarTap={onBarTap} />
        {mustPass && (
          <button
            onClick={passTurn}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 h-10 px-4 rounded-full text-[12px] font-extrabold text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg,#C98A3D,#8F5A22)', boxShadow: '0 10px 26px -8px rgba(0,0,0,0.6)' }}
          >
            <SkipForward className="h-4 w-4" /> Нет хода — передать
          </button>
        )}
      </div>

      <p className="text-[10.5px] text-[var(--g-fg-mute)] text-center px-4">
        Тапни по своей шашке → по подсвеченному пункту. Дубль даёт 4 хода. Сруби шашку соперника — она уйдёт на бар.
      </p>

      {/* оверлей победы */}
      <AnimatePresence>
        {phase === 'end' && win && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 grid place-items-center"
            style={{ background: 'rgba(10,8,5,0.62)', backdropFilter: 'blur(10px)' }}
          >
            <motion.div
              initial={{ scale: 0.85, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="rounded-[26px] px-8 py-7 text-center flex flex-col items-center gap-3"
              style={{ background: 'var(--g-card-solid)', boxShadow: 'var(--g-shadow)', border: '1px solid var(--g-border)', minWidth: 260 }}
            >
              <div className="text-6xl">{win === 'win' ? '🏆' : '🎲'}</div>
              <div className="text-xl font-extrabold" style={{ color: 'var(--g-fg)' }}>
                {win === 'win' ? 'Победа!' : 'ИИ выиграл партию'}
              </div>
              <div className="text-xs" style={{ color: 'var(--g-fg-mute)' }}>Побед: {win === 'win' ? wins + 1 : wins}</div>
              <button
                onClick={startGame}
                className="mt-1 h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95"
                style={{ background: 'linear-gradient(135deg,#C98A3D,#8F5A22)' }}
              >
                <RotateCcw className="h-[18px] w-[18px]" /> Ещё партию
              </button>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--g-fg-mute)' }}>
                <Trophy className="h-3.5 w-3.5" /> короткие нарды · 1 партия
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
