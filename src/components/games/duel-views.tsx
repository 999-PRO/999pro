'use client'

// ============================================================================
// v25.25 — ДУЭЛЬНЫЕ ВЬЮ: ШАШКИ · ШАХМАТЫ · ВИКТОРИНЫ (сервер-авторитетные).
//   Все компоненты получают актуальный Duel и рисуют свою игру:
//     • DuelCheckers — русские шашки, шаги {from,to}, флип для чёрных,
//       продолжение цепочки боя остаётся у того же игрока.
//     • DuelChess   — шахматы (chess.js на клиенте для подсветки ходов),
//       ход {fromSq,toSq}, авто-превращение в ферзя.
//     • DuelQuiz    — викторина: оба игрока отвечают на один и тот же
//       вопрос; вопрос закрывается после двух ответов (или таймаута).
//   Мета (название/эмодзи/акцент) — duelGameMeta(), её же использует хост.
// ============================================================================

import { useMemo, useState } from 'react'
import { Flag, Trophy } from 'lucide-react'
import { Chess } from 'chess.js'
import { CheckersBoard } from './checkers-board'
import { ChessPiece, type ChessType } from './chess-pieces'
import { sfx } from '@/lib/games/sfx'
import { duelApi, type Duel, type DuelChessState, type DuelQuizState } from '@/lib/games/duel-client'
import {
  ckLegalSteps, ckApplyStep, type CkSide, type CkState, type CkStep,
} from '@/lib/games/checkers-core'

/* ---------------- мета игр ---------------- */

export function duelGameMeta(gameType: Duel['gameType']): { title: string; emoji: string; accent: string } {
  switch (gameType) {
    case 'nardi':
      return { title: 'Нарды · онлайн', emoji: '🎲', accent: '#B0722F' }
    case 'tictactoe':
      return { title: 'Крестики-нолики · онлайн', emoji: '⭕', accent: '#0EA5E9' }
    case 'checkers':
      return { title: 'Шашки · онлайн', emoji: '⚫', accent: '#B0722F' }
    case 'chess':
      return { title: 'Шахматы · онлайн', emoji: '♟️', accent: '#8B5CF6' }
    case 'quiz-flags':
      return { title: 'Флаги · онлайн', emoji: '🚩', accent: '#F43F5E' }
    case 'quiz-capitals':
      return { title: 'Столицы · онлайн', emoji: '🏙️', accent: '#0EA5E9' }
    case 'quiz-millionaire':
      return { title: 'Миллионер · онлайн', emoji: '💰', accent: '#F59E0B' }
    case 'quiz-math':
      return { title: 'Математика · онлайн', emoji: '🧮', accent: '#10B981' }
    default:
      return { title: 'Онлайн-игра', emoji: '🎮', accent: '#6366F1' }
  }
}

/* ---------------- общие элементы ---------------- */

export function ResignButton({ duelId }: { duelId: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      onClick={async () => {
        if (busy) return
        setBusy(true)
        sfx.tap()
        try {
          await duelApi.resign(duelId)
        } catch {}
        setBusy(false)
      }}
      className="h-9 px-4 rounded-full text-[12px] font-extrabold inline-flex items-center gap-1.5 border border-[var(--g-chip-border)] bg-[var(--g-btn)] hover:bg-[var(--g-btn-hover)] active:scale-95"
      style={{ color: 'var(--g-fg-soft)' }}
    >
      <Flag className="h-3.5 w-3.5" /> Сдаться
    </button>
  )
}

export function RematchHint() {
  return (
    <p className="text-[11px] text-[var(--g-fg-mute)] text-center px-6">
      Партия окончена. Попроси собеседника отправить новое приглашение в чате, чтобы сыграть ещё!
    </p>
  )
}

export function PendingScreen({ duel }: { duel: Duel }) {
  const opponent = duel.player1Id === duel.player1.id ? duel.player2 : duel.player1
  const meta = duelGameMeta(duel.gameType)
  const iAmHost = duel.player2Id === opponent.id
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-6xl">{meta.emoji}</div>
      <h2 className="text-xl font-extrabold" style={{ color: 'var(--g-fg)' }}>Приглашение отправлено</h2>
      <p className="text-sm" style={{ color: 'var(--g-fg-soft)' }}>
        Ждём, когда {(iAmHost ? duel.player2 : duel.player1).displayName || (iAmHost ? duel.player2 : duel.player1).username} примет приглашение…
      </p>
      <button
        onClick={async () => {
          await duelApi.cancel(duel.id).catch(() => {})
        }}
        className="h-10 px-5 rounded-full text-[12px] font-extrabold border border-[var(--g-chip-border)] bg-[var(--g-btn)] hover:bg-[var(--g-btn-hover)]"
        style={{ color: 'var(--g-fg-soft)' }}
      >
        Отменить приглашение
      </button>
    </div>
  )
}

function TurnChip({ myTurn, label, done }: { myTurn: boolean; label: string; done?: string | null }) {
  return (
    <div
      className="rounded-full px-4 py-1 text-[12.5px] font-extrabold border"
      style={{
        background: done ? 'rgba(16,185,129,0.14)' : myTurn ? 'rgba(16,185,129,0.15)' : 'var(--g-chip)',
        borderColor: done || myTurn ? 'rgba(16,185,129,0.5)' : 'var(--g-chip-border)',
        color: done ? '#34D399' : myTurn ? '#34D399' : 'var(--g-fg-soft)',
      }}
    >
      {done ?? (myTurn ? label : 'Ходит соперник…')}
    </div>
  )
}

/* ================== ШАШКИ (онлайн) ================== */

export function DuelCheckers({ duel, meId, setDuel }: { duel: Duel; meId?: string | null; setDuel: (d: Duel) => void }) {
  const st = duel.state as unknown as CkState
  const mySide: CkSide = st?.p1Side === 'w' ? (duel.player1Id === meId ? 'w' : 'b') : duel.player1Id === meId ? 'b' : 'w'
  const opponent = mySide === st?.p1Side ? duel.player2 : duel.player1
  const [selected, setSelected] = useState<number | null>(null)
  const myTurn = duel.status === 'active' && duel.turnUserId === meId && st?.turn === mySide

  const legal = useMemo(() => (st?.cells ? ckLegalSteps(st) : []), [st])
  const targets: CkStep[] = selected !== null && myTurn ? legal.filter((m) => m.from === selected) : []
  const mustPieces = legal.length && legal.some((m) => m.cap !== null) ? Array.from(new Set(legal.map((m) => m.from))) : []
  const chainMine = myTurn && st?.chainFrom !== null

  const tap = async (idx: number) => {
    if (!myTurn) return
    const step = targets.find((m) => m.to === idx)
    if (step && selected !== null) {
      // v25.26: ОПТИМИСТИЧНЫЙ ход — фигура двигается МГНОВЕННО, ответ сервера
      // только подтверждает (раньше ход «уезжал» 2-3 c — ждали POST/сокет/опрос).
      const applied = ckApplyStep(st, step)
      if (applied) {
        setSelected(null)
        if (step.cap != null) sfx.capture()
        else sfx.move()
        const nextTurnUserId = st.p1Side === applied.turn ? duel.player1Id : duel.player2Id
        setDuel({ ...duel, state: applied as unknown as Duel['state'], turnUserId: nextTurnUserId })
        try {
          await duelApi.move(duel.id, { from: step.from, to: step.to })
        } catch {
          sfx.wrong()
        }
      }
      return
    }
    const cell = st.cells[idx]
    const mine = mySide === 'w' ? cell === 1 || cell === 2 : cell === 3 || cell === 4
    if (mine && legal.some((m) => m.from === idx)) {
      setSelected(idx)
      sfx.tap()
      return
    }
    setSelected(null)
  }

  if (duel.status === 'pending') return <PendingScreen duel={duel} />

  const countSide = (side: CkSide) => st?.cells?.filter((c) => (side === 'w' ? c === 1 || c === 2 : c === 3 || c === 4)).length ?? 0
  const iWin = duel.status === 'finished' && duel.winnerId === meId
  const isDraw = duel.status === 'finished' && !duel.winnerId

  return (
    <div className="h-full flex flex-col items-center px-2 pt-2 pb-3 gap-2">
      <div className="flex items-center justify-between gap-2 px-1" style={{ width: 'min(96vw, 58vh, 560px)' }}>
        <div className="text-[11px] font-bold shrink-0 truncate" style={{ color: 'var(--g-fg-mute)' }}>
          {opponent.displayName || opponent.username} · {countSide(mySide === 'w' ? 'b' : 'w')} ш.
        </div>
        <TurnChip
          myTurn={myTurn}
          label={chainMine ? '⚔️ Продолжай бой!' : 'Твой ход'}
          done={duel.status === 'finished' ? (isDraw ? '🤝 Ничья' : iWin ? '👑 Ты победил!' : 'Ты проиграл') : null}
        />
        <div className="text-[11px] font-bold shrink-0" style={{ color: 'var(--g-fg-mute)' }}>Ты ({mySide === 'w' ? 'белые' : 'чёрные'}) · {countSide(mySide)} ш.</div>
      </div>

      {st?.cells ? (
        <CheckersBoard st={st} selected={selected} targets={targets} me={mySide} disabled={!myTurn} mustCapture={mustPieces} onTap={tap} />
      ) : (
        <div className="h-64 grid place-items-center text-sm" style={{ color: 'var(--g-fg-mute)' }}>Загрузка партии…</div>
      )}

      {duel.status === 'active' && <ResignButton duelId={duel.id} />}
      {duel.status === 'finished' && <RematchHint />}
    </div>
  )
}

/* ================== ШАХМАТЫ (онлайн) ================== */

const FILES = 'abcdefgh'

function sqIdx(name: string): number {
  const f = FILES.indexOf(name[0])
  const r = Number(name[1])
  return (8 - r) * 8 + f
}

export function DuelChess({ duel, meId, setDuel }: { duel: Duel; meId?: string | null; setDuel?: (d: Duel) => void }) {
  const st = duel.state as DuelChessState
  const mySide: 'w' | 'b' = st?.p1Side === 'w' ? (duel.player1Id === meId ? 'w' : 'b') : duel.player1Id === meId ? 'b' : 'w'
  const opponent = mySide === st?.p1Side ? duel.player2 : duel.player1
  const [selected, setSelected] = useState<string | null>(null)
  const [targets, setTargets] = useState<string[]>([])
  const [captures, setCaptures] = useState<Record<string, boolean>>({})
  const myTurn = duel.status === 'active' && duel.turnUserId === meId

  const game = useMemo(() => {
    try {
      return new Chess(st?.fen || undefined)
    } catch {
      return new Chess()
    }
  }, [st?.fen])

  const board = game.board()
  const flip = mySide === 'b'
  const inCheck = game.inCheck()

  const tap = async (square: string) => {
    if (!myTurn) return
    if (selected && targets.includes(square)) {
      const fromIdx = sqIdx(selected)
      const toIdx = sqIdx(square)
      // v25.26: ОПТИМИСТИЧНЫЙ ход — фигура ставится на место МГНОВЕННО.
      // Считаем ход локальным chess.js и подставляем fen/history до ответа сервера.
      let optimistic: { fen: string; history: DuelChessState['history'] } | null = null
      try {
        const g = new Chess(st?.fen || undefined)
        const mv = g.move({ from: selected, to: square, promotion: 'q' })
        if (mv) {
          optimistic = {
            fen: g.fen(),
            history: [
              ...(st?.history || []),
              { from: mv.from, to: mv.to, san: mv.san, captured: (mv.captured as unknown as string) || null },
            ],
          }
        }
      } catch {
        // локальный расчёт не удался — просто отправим на сервер как раньше
      }
      setSelected(null)
      setTargets([])
      sfx.move()
      if (optimistic && setDuel) {
        const nextTurnUserId = st.p1Side === (new Chess(optimistic.fen).turn()) ? duel.player1Id : duel.player2Id
        setDuel({
          ...duel,
          state: { ...st, fen: optimistic.fen, history: optimistic.history },
          turnUserId: nextTurnUserId,
        })
      }
      try {
        await duelApi.move(duel.id, { fromSq: fromIdx, toSq: toIdx, promo: 'q' })
      } catch {
        sfx.wrong()
      }
      return
    }
    const piece = game.get(square as never)
    if (piece && piece.color === mySide) {
      const moves = game.moves({ square: square as never, verbose: true })
      setSelected(square)
      setTargets(moves.map((m) => m.to))
      const capMap: Record<string, boolean> = {}
      for (const m of moves) if (m.captured) capMap[m.to] = true
      setCaptures(capMap)
      sfx.tap()
      return
    }
    setSelected(null)
    setTargets([])
  }

  if (duel.status === 'pending') return <PendingScreen duel={duel} />

  const lastMove = st?.history?.[st.history.length - 1]
  const lastSet = new Set(lastMove ? [lastMove.from, lastMove.to] : [])
  const iWin = duel.status === 'finished' && duel.winnerId === meId
  const isDraw = duel.status === 'finished' && !duel.winnerId

  type BoardCell = { square: string; cell: ReturnType<Chess['board']>[number][number] } | null
  const visual: BoardCell[][] = []
  for (let vr = 0; vr < 8; vr++) {
    const row: BoardCell[] = []
    for (let vc = 0; vc < 8; vc++) {
      const r = flip ? 7 - vr : vr
      const f = flip ? 7 - vc : vc
      row.push({ square: `${FILES[f]}${8 - r}`, cell: board[r][f] })
    }
    visual.push(row)
  }

  return (
    <div className="h-full flex flex-col items-center px-2 pt-2 pb-3 gap-2">
      <div className="flex items-center justify-between gap-2 px-1" style={{ width: 'min(96vw, 60vh, 560px)' }}>
        <div className="text-[11px] font-bold shrink-0 truncate" style={{ color: 'var(--g-fg-mute)' }}>
          {opponent.displayName || opponent.username} ({mySide === 'w' ? 'чёрные' : 'белые'})
        </div>
        <TurnChip
          myTurn={myTurn}
          label={inCheck ? '⚠️ Шах! Твой ход' : 'Твой ход'}
          done={duel.status === 'finished' ? (isDraw ? '🤝 Ничья' : iWin ? '👑 Мат! Ты победил!' : '💔 Мат. Ты проиграл') : null}
        />
        <div className="text-[11px] font-bold shrink-0" style={{ color: 'var(--g-fg-mute)' }}>Ты ({mySide === 'w' ? 'белые' : 'чёрные'})</div>
      </div>

      <div
        className="relative rounded-[14px] p-[10px] shrink-0"
        style={{
          width: 'min(96vw, 60vh, 560px)',
          height: 'min(96vw, 60vh, 560px)',
          background: 'linear-gradient(145deg,#6D4A8F 0%,#4C3370 55%,#3D2860 100%)',
          boxShadow: '0 26px 60px -24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -2px 6px rgba(0,0,0,0.35)',
        }}
      >
        <div className="grid grid-cols-8 grid-rows-8 rounded-[6px] overflow-hidden w-full h-full" style={{ boxShadow: 'inset 0 0 0 1px rgba(40,25,60,0.8), 0 2px 10px rgba(0,0,0,0.35)' }}>
          {visual.map((row, vr) =>
            row.map((sq, vc) => {
              if (!sq) return null
              const { square, cell } = sq
              const light = (vr + vc) % 2 === 0
              const isSel = selected === square
              const isTarget = targets.includes(square)
              const isCapture = captures[square]
              const isLast = lastSet.has(square)
              const isKingCheck = inCheck && cell?.type === 'k' && cell.color === game.turn()
              return (
                <button
                  key={square}
                  onClick={() => tap(square)}
                  className="relative grid place-items-center"
                  style={{
                    background: light
                      ? 'linear-gradient(135deg,#EFE6F5 0%,#E2D4EE 100%)'
                      : 'linear-gradient(135deg,#9D7FC0 0%,#8465A8 100%)',
                    boxShadow: isLast
                      ? 'inset 0 0 0 100px rgba(255,196,88,0.35)'
                      : isSel
                        ? 'inset 0 0 0 100px rgba(255,199,0,0.45)'
                        : undefined,
                  }}
                  aria-label={square}
                >
                  {isKingCheck && <span className="absolute inset-0" style={{ boxShadow: 'inset 0 0 14px 3px rgba(239,68,68,0.75)' }} />}
                  {isTarget && !isCapture && (
                    <span className="absolute h-[26%] w-[26%] rounded-full" style={{ background: 'rgba(50,40,80,0.5)' }} />
                  )}
                  {isTarget && isCapture && (
                    <span className="absolute inset-[7%] rounded-full border-[3.5px]" style={{ borderColor: 'rgba(150,40,60,0.6)' }} />
                  )}
                  {cell && (
                    <span className="relative z-[1] leading-none select-none p-[4%] w-full h-full grid place-items-center" style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))' }}>
                      <ChessPiece type={cell.type as ChessType} color={cell.color === 'w' ? 'w' : 'b'} />
                    </span>
                  )}
                </button>
              )
            }),
          )}
        </div>
      </div>

      {duel.status === 'active' && <ResignButton duelId={duel.id} />}
      {duel.status === 'finished' && <RematchHint />}
    </div>
  )
}

/* ================== ВИКТОРИНЫ (онлайн) ================== */

export function DuelQuiz({ duel, meId, setDuel }: { duel: Duel; meId?: string | null; setDuel: (d: Duel) => void }) {
  const st = duel.state as DuelQuizState
  const isP1 = duel.player1Id === meId
  const opponent = isP1 ? duel.player2 : duel.player1
  const myAnswers = isP1 ? st?.a1 : st?.a2
  const oppAnswers = isP1 ? st?.a2 : st?.a1
  const finished = duel.status === 'finished' || st?.finished

  const myScore = useMemo(() => {
    if (!st?.qs || !myAnswers) return 0
    let n = 0
    for (let i = 0; i < st.qs.length; i++) if (myAnswers[i] != null && myAnswers[i] === st.qs[i].correct) n++
    return n
  }, [st, myAnswers])

  const oppScore = useMemo(() => {
    if (!st?.qs || !oppAnswers) return 0
    let n = 0
    for (let i = 0; i < st.qs.length; i++) if (oppAnswers[i] != null && oppAnswers[i] === st.qs[i].correct) n++
    return n
  }, [st, oppAnswers])

  const answer = async (choice: number) => {
    if (!st || finished) return
    if (myAnswers && myAnswers.length > st.idx) return
    sfx.click()
    // оптимистично
    const mine = isP1 ? [...st.a1] : [...st.a2]
    mine[st.idx] = choice
    const nextState = isP1 ? { ...st, a1: mine } : { ...st, a2: mine }
    setDuel({ ...duel, state: nextState })
    try {
      await duelApi.move(duel.id, { qi: st.idx, choice })
    } catch {
      sfx.wrong()
    }
  }

  if (duel.status === 'pending') return <PendingScreen duel={duel} />
  if (!st?.qs) return <div className="h-full grid place-items-center text-sm" style={{ color: 'var(--g-fg-mute)' }}>Загрузка…</div>

  // финал
  if (finished) {
    const iWin = duel.winnerId === meId
    const draw = !duel.winnerId
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-7xl">{draw ? '🤝' : iWin ? '🏆' : '💔'}</div>
        <h2 className="text-2xl font-extrabold" style={{ color: 'var(--g-fg)' }}>
          {draw ? 'Ничья!' : iWin ? 'Победа!' : 'Увы, поражение'}
        </h2>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl px-5 py-3" style={{ background: 'var(--g-card)', border: '1px solid var(--g-border)' }}>
            <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>Ты</div>
            <div className="text-3xl font-black" style={{ color: '#34D399' }}>{myScore}</div>
          </div>
          <Trophy className="h-6 w-6" style={{ color: 'var(--g-fg-mute)' }} />
          <div className="rounded-2xl px-5 py-3" style={{ background: 'var(--g-card)', border: '1px solid var(--g-border)' }}>
            <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>
              {opponent.displayName || opponent.username}
            </div>
            <div className="text-3xl font-black" style={{ color: '#F87171' }}>{oppScore}</div>
          </div>
        </div>
        <RematchHint />
      </div>
    )
  }

  const q = st.qs[st.idx]
  const iAnswered = (myAnswers?.length ?? 0) > st.idx
  const myChoice = iAnswered ? myAnswers![st.idx] : null
  const oppAnswered = (oppAnswers?.length ?? 0) > st.idx
  // показать разобранный предыдущий вопрос (когда оба ответили и перешли дальше)
  const prev = st.idx > 0 ? st.qs[st.idx - 1] : null
  const prevMine = myAnswers?.[st.idx - 1] ?? null
  const prevOpp = oppAnswers?.[st.idx - 1] ?? null
  const prevOpen = prev && st.idx > 0 && (prevMine !== null || prevOpp !== null)

  return (
    <div className="h-full flex flex-col items-center px-3 pt-2 pb-4 gap-2.5 max-w-xl mx-auto w-full">
      {/* счёт */}
      <div className="w-full flex items-center justify-between gap-2">
        <div className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg-soft)' }}>
          Ты: <b style={{ color: '#34D399' }}>{myScore}</b>
        </div>
        <div className="text-[11px] font-bold" style={{ color: 'var(--g-fg-mute)' }}>
          Вопрос {Math.min(st.idx + 1, st.qs.length)} / {st.qs.length}
        </div>
        <div className="rounded-full px-3 py-1 text-[12px] font-extrabold" style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg-soft)' }}>
          {opponent.displayName || opponent.username}: <b style={{ color: '#F87171' }}>{oppScore}</b>
        </div>
      </div>

      {/* итог предыдущего вопроса */}
      {prevOpen && (
        <div className="w-full rounded-xl px-3 py-1.5 text-[11px] font-bold flex items-center justify-center gap-2" style={{ background: 'var(--g-chip)', color: 'var(--g-fg-soft)' }}>
          <span>
            {prevMine === prev!.correct ? '✅' : '❌'} у тебя
          </span>
          <span style={{ color: 'var(--g-fg-mute)' }}>·</span>
          <span>
            {prevOpp == null ? '⏳ нет ответа' : prevOpp === prev!.correct ? '✅' : '❌'} у соперника
          </span>
          <span style={{ color: 'var(--g-fg-mute)' }}>·</span>
          <span>верно: {prev!.options[prev!.correct]}</span>
        </div>
      )}

      {/* вопрос */}
      <div className="w-full rounded-2xl p-4 text-center" style={{ background: 'var(--g-card)', border: '1px solid var(--g-border)', boxShadow: 'var(--g-shadow)' }}>
        {q.flagCode && (
          <img
            src={`/flags/4x3/${q.flagCode}.svg`}
            alt="Флаг страны"
            className="h-24 md:h-28 mx-auto mb-3 rounded-lg object-contain"
            style={{ boxShadow: '0 10px 26px -10px rgba(0,0,0,0.45)', border: '1px solid var(--g-border)' }}
          />
        )}
        <div className="text-[15px] md:text-base font-extrabold leading-snug" style={{ color: 'var(--g-fg)' }}>{q.prompt}</div>
        {q.sub && <div className="text-[11px] mt-1" style={{ color: 'var(--g-fg-mute)' }}>{q.sub}</div>}
      </div>

      {/* варианты / ожидание */}
      {iAnswered ? (
        <div className="flex-1 grid place-items-center">
          <div className="text-center">
            <div className="text-5xl mb-2">{myChoice === q.correct ? '✅' : '🤔'}</div>
            <p className="text-sm font-bold" style={{ color: 'var(--g-fg-soft)' }}>
              {myChoice === q.correct ? 'Верно! Ждём ответ соперника…' : 'Принято. Ждём ответ соперника…'}
            </p>
            {oppAnswered && <p className="text-[11px] mt-1" style={{ color: 'var(--g-fg-mute)' }}>Соперник уже ответил</p>}
          </div>
        </div>
      ) : (
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2">
          {q.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => answer(i)}
              className="h-12 px-4 rounded-2xl text-[13px] font-extrabold text-left truncate transition-all active:scale-[0.97] hover:brightness-110"
              style={{ background: 'var(--g-btn)', border: '1.5px solid var(--g-chip-border)', color: 'var(--g-fg)' }}
            >
              <span className="inline-grid place-items-center h-6 w-6 rounded-lg mr-2 text-[11px]" style={{ background: 'var(--g-chip)', color: 'var(--g-fg-mute)' }}>
                {['А', 'Б', 'В', 'Г'][i]}
              </span>
              {opt}
            </button>
          ))}
        </div>
      )}

      {duel.status === 'active' && !finished && <ResignButton duelId={duel.id} />}
      {duel.status === 'finished' && !finished && <RematchHint />}
    </div>
  )
}
