'use client'

// ============================================================================
// v25.26 — «Шахматы» (полный редизайн по отзыву владельца: доска/клетки/
// фигуры были «ужас», фигуры мелкие).
//   • Деревянная доска: тёплый орех, рамка, гравированные координаты a–h/1–8.
//   • КРУПНЫЕ векторные фигуры (chess-pieces.tsx) вместо юникод-глифов.
//   • Подсветка: выбор, ходы, взятия, последний ход, шах.
//   • Лотки съеденных фигур + материальный перевес.
//   • ИИ — minimax α-β (итеративное углубление 1/2/3 с дедлайном) в Web
//     Worker (v25.26 fix: раньше считал на главном потоке — ход появлялся
//     через 2-3 c, страница замирала; теперь мгновенная реакция UI).
//   • Тема: панель через --g-* токены GameShell, доска физически деревянная.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { RotateCcw, Undo2 } from 'lucide-react'
import { Chess, type Move, type Square } from 'chess.js'
import { sfx } from '@/lib/games/sfx'
import { getBest, useBest } from '@/lib/games/best-score'
import { getAiMove } from '@/lib/games/chess-ai-client'
import { pickBestMove, type ChessAiMove } from '@/lib/games/chess-engine'
import { ChessPiece, CapturedPiece, type ChessSide, type ChessType } from './chess-pieces'

type Level = 1 | 2 | 3

const FILES = 'abcdefgh'.split('')

const LEVEL_META: { id: Level; name: string }[] = [
  { id: 1, name: 'Лёгкий' },
  { id: 2, name: 'Средний' },
  { id: 3, name: 'Сложный' },
]

const ORDER: ChessType[] = ['q', 'r', 'b', 'n', 'p']

// v25.26 fix: VAL отсутствовал после редизайна — ReferenceError на каждом
// рендере ломал запуск игры («игра не запускается вообще»). Классические
// стоимости фигур для материального перевеса.
const PIECE_VALUE: Record<ChessType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function ChessGame() {
  const gameRef = useRef<Chess>(new Chess())
  const [, forceRender] = useState(0)
  const rerender = useCallback(() => forceRender((v) => v + 1), [])

  const [level, setLevel] = useState<Level>(2)
  const [selected, setSelected] = useState<string | null>(null)
  const [targets, setTargets] = useState<Move[]>([])
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [status, setStatus] = useState<'play' | 'win' | 'lose' | 'draw'>('play')
  const [wins, submitWins] = useBest('chess-wins')
  const startedAtRef = useRef(0)

  const syncStatus = useCallback(() => {
    const g = gameRef.current
    if (g.isCheckmate()) {
      const playerLost = g.turn() === 'w'
      setStatus(playerLost ? 'lose' : 'win')
      setThinking(false)
      window.setTimeout(() => (playerLost ? sfx.lose() : sfx.win()), 250)
      if (!playerLost) submitWins(getBest('chess-wins') + 1)
    } else if (g.isDraw() || g.isStalemate() || g.isInsufficientMaterial()) {
      setStatus('draw')
      setThinking(false)
    }
  }, [submitWins, wins])

  const newGame = useCallback(() => {
    gameRef.current = new Chess()
    setSelected(null)
    setTargets([])
    setLastMove(null)
    setThinking(false)
    setStatus('play')
    startedAtRef.current = Date.now()
    rerender()
    sfx.whoosh(1)
  }, [rerender])

  const undoMove = useCallback(() => {
    if (thinking) return
    const g = gameRef.current
    g.undo()
    g.undo()
    setSelected(null)
    setTargets([])
    if (status !== 'play') setStatus('play')
    rerender()
    sfx.tap()
  }, [thinking, status, rerender])

  const maybeAiMove = useCallback(() => {
    const g = gameRef.current
    if (g.isGameOver() || g.turn() !== 'b') return
    const fen = g.fen()
    const lvl = level
    setThinking(true)
    // v25.26: расчёт в Web Worker — UI не замирает. Пауза 120мс только чтобы
    // индикатор «думает» успел отрисоваться; сам ход приходит мгновенно после.
    window.setTimeout(() => {
      // защита от «Заново»/Undo во время расчёта: позиция уже не та
      if (gameRef.current.fen() !== fen) return
      void getAiMove(fen, lvl).then((raw) => {
        const cur = gameRef.current
        // партия началась заново / ход отменили — просроченный ответ игнорируем
        if (cur.fen() !== fen) return
        // v25.26: worker недоступен — синхронный фолбэк (движок с дедлайном,
        // максимум ~1.8 c, но это единственный редкий путь без worker)
        const m: ChessAiMove | null = raw ?? pickBestMove(fen, lvl)
        if (!m) {
          setThinking(false)
          rerender()
          return
        }
        const applied = cur.move({ from: m.from, to: m.to, promotion: 'q' })
        if (applied) {
          setLastMove({ from: applied.from, to: applied.to })
          if (applied.captured) sfx.capture()
          else sfx.move()
        }
        setThinking(false)
        rerender()
        syncStatus()
      })
    }, 120)
  }, [level, rerender, syncStatus])

  const tapSquare = useCallback(
    (square: string) => {
      if (thinking || status !== 'play') return
      const g = gameRef.current
      if (g.turn() !== 'w') return

      const piece = g.get(square as never)

      if (selected === square) {
        setSelected(null)
        setTargets([])
        return
      }

      if (selected && targets.some((m) => m.to === square)) {
        const mv = g.move({ from: selected, to: square, promotion: 'q' })
        setSelected(null)
        setTargets([])
        setLastMove({ from: mv.from, to: mv.to })
        if (mv.captured) sfx.capture()
        else sfx.move()
        rerender()
        syncStatus()
        if (!g.isGameOver()) maybeAiMove()
        return
      }

      if (piece && piece.color === 'w') {
        const moves = g.moves({ square: square as Square, verbose: true }) as Move[]
        setSelected(square)
        setTargets(moves)
        sfx.tap()
        return
      }

      setSelected(null)
      setTargets([])
    },
    [selected, targets, thinking, status, rerender, maybeAiMove, syncStatus],
  )

  useEffect(() => {
    startedAtRef.current = Date.now()
  }, [])

  const g = gameRef.current
  const board = g.board()
  const inCheck = g.inCheck()

  // Лотки съеденных фигур
  const history = g.history({ verbose: true }) as Move[]
  const capturedByWhite: ChessType[] = []
  const capturedByBlack: ChessType[] = []
  for (const m of history) {
    if (!m.captured) continue
    if (m.color === 'w') capturedByWhite.push(m.captured as ChessType)
    else capturedByBlack.push(m.captured as ChessType)
  }
  const sum = (arr: ChessType[]) => arr.reduce((acc, t) => acc + (PIECE_VALUE[t] ?? 0), 0)
  const materialDiff = sum(capturedByWhite) - sum(capturedByBlack)

  const squareOf = (r: number, f: number) => `${FILES[f]}${8 - r}`

  const chipBtn =
    'h-8 px-3 rounded-full text-[11px] md:text-xs font-extrabold border transition-all inline-flex items-center gap-1.5 active:scale-95 disabled:opacity-40'

  return (
    <div className="h-full flex flex-col items-center px-2.5 md:px-6 pt-2 md:pt-4 pb-3 max-w-3xl mx-auto w-full gap-2">
      {/* уровень + управление */}
      <div className="w-full flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {LEVEL_META.map((l) => (
            <button
              key={l.id}
              onClick={() => { setLevel(l.id); sfx.tap() }}
              disabled={thinking || status !== 'play'}
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
          <button onClick={undoMove} disabled={thinking || status !== 'play'} className={`${chipBtn} text-[var(--g-fg-soft)] bg-[var(--g-btn)] border-[var(--g-chip-border)] hover:bg-[var(--g-btn-hover)]`}>
            <Undo2 className="h-3.5 w-3.5" /> <span className="hidden xs:inline md:inline">Отменить</span>
          </button>
          <button onClick={newGame} className={`${chipBtn} text-white border-transparent`} style={{ background: 'linear-gradient(135deg,#D9A05B,#9C6B33)' }}>
            <RotateCcw className="h-3.5 w-3.5" /> Заново
          </button>
        </div>
      </div>

      {/* статус */}
      <div
        className="rounded-full px-4 py-1 text-[12.5px] font-extrabold border max-w-full truncate"
        style={{
          background: status === 'play' ? 'var(--g-chip)' : status === 'win' ? 'rgba(16,185,129,0.16)' : status === 'lose' ? 'rgba(239,68,68,0.16)' : 'rgba(245,158,11,0.14)',
          borderColor: status === 'play' ? 'var(--g-chip-border)' : status === 'win' ? 'rgba(16,185,129,0.5)' : status === 'lose' ? 'rgba(239,68,68,0.5)' : 'rgba(245,158,11,0.4)',
          color: status === 'play' ? 'var(--g-fg-soft)' : status === 'win' ? '#34D399' : status === 'lose' ? '#F87171' : '#FBBF24',
        }}
      >
        {status === 'play'
          ? thinking
            ? '🤖 Компьютер думает…'
            : inCheck
              ? '⚠️ Шах! Твой ход (белые)'
              : 'Твой ход (белые)'
          : status === 'win'
            ? '👑 Мат! Ты победил!'
            : status === 'lose'
              ? '💔 Мат. Компьютер победил'
              : '🤝 Ничья'}
      </div>

      {/* съеденные чёрными (сверху, у соперника) */}
      <div className="w-full flex justify-start items-center" style={{ width: 'min(94vw, 62vh, 620px)' }}>
        <div className="flex items-center">
          {ORDER.flatMap((t) => capturedByBlack.filter((c) => c === t).map((c, i) => <CapturedPiece key={`b${t}${i}`} type={c} color="w" />))}
          {materialDiff < 0 && <span className="ml-1.5 text-[11px] font-extrabold text-[var(--g-fg-mute)]">+{-materialDiff}</span>}
        </div>
      </div>

      {/* деревянная доска */}
      <div
        className="relative rounded-[14px] p-[10px]"
        style={{
          width: 'min(94vw, 62vh, 620px)',
          height: 'min(94vw, 62vh, 620px)',
          background: 'linear-gradient(145deg,#7A5230 0%,#5D3D22 55%,#4E321C 100%)',
          boxShadow: '0 26px 60px -24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -2px 6px rgba(0,0,0,0.35)',
        }}
      >
        <div className="grid grid-cols-8 grid-rows-8 rounded-[6px] overflow-hidden w-full h-full" style={{ boxShadow: 'inset 0 0 0 1px rgba(60,38,20,0.8), 0 2px 10px rgba(0,0,0,0.35)' }}>
          {board.map((row, r) =>
            row.map((cell, f) => {
              const square = squareOf(r, f)
              const light = (r + f) % 2 === 0
              const isSel = selected === square
              const isTarget = targets.some((m) => m.to === square)
              const isCapture = targets.some((m) => m.to === square && m.captured)
              const isLast = lastMove && (lastMove.from === square || lastMove.to === square)
              const isWhite = cell?.color === 'w'
              // шах — подсветим короля
              const isKingInCheck = inCheck && cell?.type === 'k' && cell.color === g.turn() && status === 'play'
              return (
                <button
                  key={square}
                  onClick={() => tapSquare(square)}
                  className="relative grid place-items-center transition-shadow"
                  style={{
                    background: light ? '#EFDDBD' : '#A9713F',
                    backgroundImage: light
                      ? 'linear-gradient(135deg,#F3E3C6 0%,#E7D0AB 100%)'
                      : 'linear-gradient(135deg,#B27A45 0%,#9C6534 100%)',
                    boxShadow: isLast
                      ? 'inset 0 0 0 100px rgba(255,196,88,0.35)'
                      : isSel
                        ? 'inset 0 0 0 100px rgba(255,199,0,0.45)'
                        : undefined,
                  }}
                  aria-label={square}
                >
                  {/* координаты по краям доски */}
                  {f === 0 && (
                    <span className="absolute left-[3px] top-[2px] text-[8px] md:text-[10px] font-bold pointer-events-none" style={{ color: light ? '#9C6534' : '#EFDDBD', opacity: 0.85 }}>
                      {8 - r}
                    </span>
                  )}
                  {r === 7 && (
                    <span className="absolute right-[3px] bottom-[1px] text-[8px] md:text-[10px] font-bold pointer-events-none" style={{ color: light ? '#9C6534' : '#EFDDBD', opacity: 0.85 }}>
                      {FILES[f]}
                    </span>
                  )}

                  {isKingInCheck && <span className="absolute inset-0" style={{ boxShadow: 'inset 0 0 14px 3px rgba(239,68,68,0.75)' }} />}

                  {isTarget && !isCapture && (
                    <span className="absolute h-[26%] w-[26%] rounded-full" style={{ background: 'rgba(58,90,50,0.55)', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
                  )}
                  {isTarget && isCapture && (
                    <span className="absolute inset-[7%] rounded-full border-[3.5px]" style={{ borderColor: 'rgba(58,90,50,0.6)' }} />
                  )}

                  {cell && (
                    <motion.span
                      key={`${square}-${cell.type}-${cell.color}`}
                      initial={{ scale: 0.86, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.14 }}
                      className="relative z-[1] leading-none select-none p-[4%] w-full h-full grid place-items-center"
                      style={{ filter: isSel ? 'drop-shadow(0 0 7px rgba(255,193,7,0.95))' : 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))' }}
                    >
                      <ChessPiece type={cell.type as ChessType} color={isWhite ? 'w' : 'b'} />
                    </motion.span>
                  )}
                </button>
              )
            }),
          )}
        </div>
      </div>

      {/* съеденные белыми (снизу, у игрока) */}
      <div className="flex justify-start items-center" style={{ width: 'min(94vw, 62vh, 620px)' }}>
        <div className="flex items-center">
          {ORDER.flatMap((t) => capturedByWhite.filter((c) => c === t).map((c, i) => <CapturedPiece key={`w${t}${i}`} type={c} color="b" />))}
          {materialDiff > 0 && <span className="ml-1.5 text-[11px] font-extrabold text-[var(--g-fg-mute)]">+{materialDiff}</span>}
        </div>
      </div>

      <p className="text-[10.5px] text-[var(--g-fg-mute)] text-center px-4">
        Тапни по белой фигуре, затем по подсвеченной клетке. Превращение — автоматически в ферзя.
      </p>
    </div>
  )
}
