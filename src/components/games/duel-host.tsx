'use client'

// ============================================================================
// v25.24/v25.25 — DuelHost: глобальный хост ОНЛАЙН-ДУЭЛЕЙ из чата.
//   • Монтируется в AppShell. Слушает событие 'open-duel' {duelId} и
//     socket 'duel:updated' — партия открывается в полноэкранном GameShell.
//   • Ходы: оптимистично локально → POST /move → сервер присылает
//     'duel:updated' (авторитетное состояние). Фолбэк — опрос раз в 3с.
//   • Игры: шашки · шахматы · викторины (флаги/столицы/миллионер/математика)
//     + крестики-нолики. Нарды (легаси) — «игра недоступна».
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { GameShell } from './game-shell'
import { sfx } from '@/lib/games/sfx'
import { useAuthStore } from '@/lib/auth-store'
import { getSharedSocket } from '@/lib/use-socket'
import { duelApi, type Duel, type DuelTttState } from '@/lib/games/duel-client'
import {
  DuelCheckers,
  DuelChess,
  DuelQuiz,
  RematchHint,
  ResignButton,
  duelGameMeta,
} from './duel-views'
import { motion } from 'framer-motion'

export function DuelHost() {
  const [open, setOpen] = useState(false)
  const [duel, setDuel] = useState<Duel | null>(null)
  const meId = useAuthStore((s) => s.user?.id)
  const duelIdRef = useRef<string | null>(null)

  const load = useCallback(async (id: string, silent = true) => {
    try {
      const d = await duelApi.get(id)
      setDuel(d.duel)
      if (d.duel.status === 'pending' && !silent) setOpen(true)
    } catch {
      /* дуэль недоступна */
    }
  }, [])

  // событие 'open-duel' — открыть/обновить партию
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent).detail?.duelId as string
      if (!id) return
      duelIdRef.current = id
      setOpen(true)
      load(id, false)
    }
    window.addEventListener('open-duel', onOpen as EventListener)
    return () => window.removeEventListener('open-duel', onOpen as EventListener)
  }, [load])

  // socket 'duel:updated' — живое обновление (и приглашения не в фокусе чата)
  useEffect(() => {
    const socket = getSharedSocket()
    if (!socket) return
    const onUpdate = (payload: Duel) => {
      if (!payload?.id) return
      if (duelIdRef.current && payload.id !== duelIdRef.current) return
      setDuel(payload)
    }
    socket.on('duel:updated', onUpdate)
    return () => {
      socket.off('duel:updated', onUpdate)
    }
  }, [])

  // фолбэк-опрос, пока оверлей открыт
  useEffect(() => {
    if (!open || !duel?.id || duel.status === 'finished') return
    const t = window.setInterval(() => duel?.id && load(duel.id), 3000)
    return () => window.clearInterval(t)
  }, [open, duel?.id, duel?.status, load])

  const exit = () => {
    setOpen(false)
    setDuel(null)
    duelIdRef.current = null
  }

  if (!open || !duel) return null

  // легаси: нарды убраны из v25.25 — вежливая заглушка
  if (duel.gameType === 'nardi') {
    return (
      <AnimatePresence>
        <GameShell title="Нарды · онлайн" emoji="🎲" accent="#B0722F" onExit={exit}>
          <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="text-6xl">🎲</div>
            <h2 className="text-xl font-extrabold" style={{ color: 'var(--g-fg)' }}>Нарды больше недоступны</h2>
            <p className="text-sm max-w-xs" style={{ color: 'var(--g-fg-soft)' }}>
              Эту игру заменили шашки. Пригласи друга в чате на партию в шашки, шахматы или викторину!
            </p>
          </div>
        </GameShell>
      </AnimatePresence>
    )
  }

  const meta = duelGameMeta(duel.gameType)
  const isQuiz = duel.gameType.startsWith('quiz-')

  return (
    <AnimatePresence>
      <GameShell title={meta.title} emoji={meta.emoji} accent={meta.accent} onExit={exit}>
        {duel.gameType === 'tictactoe' && <DuelTictactoe duel={duel} meId={meId} setDuel={setDuel} />}
        {duel.gameType === 'checkers' && <DuelCheckers duel={duel} meId={meId} setDuel={setDuel} />}
        {duel.gameType === 'chess' && <DuelChess duel={duel} meId={meId} setDuel={setDuel} />}
        {isQuiz && <DuelQuiz duel={duel} meId={meId} setDuel={setDuel} />}
      </GameShell>
    </AnimatePresence>
  )
}

/* ================== КРЕСТИКИ-НОЛИКИ (онлайн) ================== */

function DuelTictactoe({ duel, meId, setDuel }: { duel: Duel; meId?: string | null; setDuel: (d: Duel) => void }) {
  const st = duel.state as DuelTttState
  const iAmX = duel.player1Id === meId
  const myMark: 'x' | 'o' = iAmX ? 'x' : 'o'
  const opponent = iAmX ? duel.player2 : duel.player1
  const myTurn = duel.status === 'active' && duel.turnUserId === meId && st?.turn === myMark

  const tap = async (i: number) => {
    if (!myTurn || st.board[i]) return
    // оптимистично
    const board = [...st.board]
    board[i] = myMark
    setDuel({ ...duel, state: { ...st, board, turn: myMark === 'x' ? 'o' : 'x' } })
    sfx.move()
    try {
      await duelApi.move(duel.id, { cell: i })
    } catch {
      sfx.wrong()
    }
  }

  const winnerName =
    st?.winner === 'draw' ? 'Ничья' : st?.winner === 'x' ? duel.player1.displayName || duel.player1.username : st?.winner === 'o' ? duel.player2.displayName || duel.player2.username : null

  return (
    <div className="h-full flex flex-col items-center justify-center px-4 gap-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full px-3 py-1 text-xs font-extrabold" style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg-soft)' }}>
          {duel.player1.displayName || duel.player1.username} — X
        </span>
        <span className="text-xs font-bold" style={{ color: 'var(--g-fg-mute)' }}>против</span>
        <span className="rounded-full px-3 py-1 text-xs font-extrabold" style={{ background: 'var(--g-chip)', border: '1px solid var(--g-chip-border)', color: 'var(--g-fg-soft)' }}>
          {duel.player2.displayName || duel.player2.username} — O
        </span>
      </div>

      <div
        className="rounded-full px-4 py-1.5 text-sm font-extrabold border"
        style={{
          background: st?.winner ? (st.winner === myMark ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.14)') : myTurn ? 'rgba(16,185,129,0.15)' : 'var(--g-chip)',
          borderColor: st?.winner ? 'transparent' : myTurn ? 'rgba(16,185,129,0.5)' : 'var(--g-chip-border)',
          color: st?.winner ? (st.winner === myMark ? '#34D399' : st.winner === 'draw' ? 'var(--g-fg-soft)' : '#F87171') : myTurn ? '#34D399' : 'var(--g-fg-soft)',
        }}
      >
        {st?.winner
          ? st.winner === 'draw'
            ? '🤝 Ничья!'
            : `👑 Победил ${winnerName}`
          : duel.status === 'active'
            ? myTurn
              ? 'Твой ход!'
              : `Ходит ${opponent.displayName || opponent.username}…`
            : 'Ожидание…'}
      </div>

      <div className="grid grid-cols-3 gap-2" style={{ width: 'min(88vw, 46vh, 420px)' }}>
        {st?.board?.map((cell, i) => {
          const inLine = st.line?.includes(i)
          return (
            <motion.button
              key={i}
              whileTap={{ scale: 0.94 }}
              onClick={() => tap(i)}
              className="aspect-square rounded-2xl grid place-items-center"
              style={{
                background: 'var(--g-card)',
                border: '1.5px solid',
                borderColor: inLine ? '#34D399' : 'var(--g-border)',
                boxShadow: inLine ? '0 0 18px -4px rgba(52,211,153,0.7)' : 'var(--g-shadow)',
              }}
              aria-label={`Клетка ${i + 1}`}
            >
              {cell && (
                <motion.span
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="leading-none font-black"
                  style={{ fontSize: 'min(15vw, 7.5vh, 64px)', color: cell === 'x' ? '#38BDF8' : '#F472B6' }}
                >
                  {cell === 'x' ? '✕' : '○'}
                </motion.span>
              )}
            </motion.button>
          )
        })}
      </div>

      {duel.status === 'active' && <ResignButton duelId={duel.id} />}
      {duel.status === 'finished' && <RematchHint />}
    </div>
  )
}
