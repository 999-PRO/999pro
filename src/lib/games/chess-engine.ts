// ============================================================================
// v25.26 — ШАХМАТНЫЙ ДВИЖОК ИИ (чистая функция, без DOM).
// Используется и в Web Worker (chess-ai.worker.ts), и в синхронном фолбэке.
//
// v25.26 FIX (owner): «сделал ход — компьютер отвечает через 2-3 секунды,
// приложение подвисает». Причина: minimax α-β на 3 полухода выполнялся на
// главном потоке (chess.js очень медленный: ~5 c на глубину 3 в мидгейме).
//
// Что сделано:
//   • Iterative deepening 1 → 2 → 3 с ЖЁСТКИМ дедлайном: уровень 3 не дольше
//     ~1.4 c, уровень 2 ~0.6 c, уровень 1 мгновенно. Если глубина не успела —
//     берём лучший ход предыдущей завершённой глубины (он всегда валиден).
//   • Поиск уехал в Web Worker — интерфейс не замирает («думает» = индикатор,
//     а не фриз страницы).
// ============================================================================

import { Chess, type Move } from 'chess.js'

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const CENTER_BONUS: Record<string, number> = { p: 6, n: 14, b: 8, r: 2, q: 2, k: 0 }

function evaluate(game: Chess, forColor: 'w' | 'b'): number {
  const board = game.board()
  let score = 0
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f]
      if (!cell) continue
      let v = (VAL[cell.type] ?? 0) * 100
      const rankIdx = 8 - r
      const distToCenter = Math.abs(3.5 - f) + Math.abs(3.5 - (rankIdx - 1))
      v += (CENTER_BONUS[cell.type] ?? 0) * (4 - distToCenter) * 0.5
      score += cell.color === forColor ? v : -v
    }
  }
  return score
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    const capA = a.captured ? VAL[a.captured] * 100 : 0
    const capB = b.captured ? VAL[b.captured] * 100 : 0
    return capB - capA
  })
}

function minimax(game: Chess, depth: number, alpha: number, beta: number, maximizing: boolean, aiColor: 'w' | 'b'): number {
  if (game.isCheckmate()) {
    return game.turn() === aiColor ? -99000 - depth : 99000 + depth
  }
  if (game.isDraw() || game.isStalemate() || depth === 0) {
    return evaluate(game, aiColor)
  }
  const moves = orderMoves(game.moves({ verbose: true }) as Move[])
  if (maximizing) {
    let bestV = -Infinity
    for (const m of moves) {
      game.move(m.san)
      const v = minimax(game, depth - 1, alpha, beta, false, aiColor)
      game.undo()
      bestV = Math.max(bestV, v)
      alpha = Math.max(alpha, v)
      if (beta <= alpha) break
    }
    return bestV
  }
  let bestV = Infinity
  for (const m of moves) {
    game.move(m.san)
    const v = minimax(game, depth - 1, alpha, beta, true, aiColor)
    game.undo()
    bestV = Math.min(bestV, v)
    beta = Math.min(beta, v)
    if (beta <= alpha) break
  }
  return bestV
}

export interface ChessAiMove {
  from: string
  to: string
  san: string
  promotion?: string
  captured: string | null
}

export interface ChessAiRequest {
  fen: string
  level: 1 | 2 | 3
}

/** Бюджет времени на весь поиск (мс) — не даст «залипнуть» на слабых устройствах. */
export function aiBudget(level: 1 | 2 | 3): number {
  return level === 1 ? 120 : level === 2 ? 900 : 1800
}

/** Выбор хода ИИ: iterative deepening c дедлайном. */
export function pickBestMove(fen: string, level: 1 | 2 | 3): ChessAiMove | null {
  const game = new Chess(fen)
  const moves = orderMoves(game.moves({ verbose: true }) as Move[])
  if (!moves.length) return null
  const aiColor = game.turn()
  if (level === 1 && Math.random() < 0.25) {
    const m = moves[Math.floor(Math.random() * moves.length)]
    return toResult(m)
  }

  const maxDepth = level === 1 ? 1 : level === 2 ? 2 : 3
  const deadline = Date.now() + aiBudget(level)

  let bestResult = toResult(moves[0])
  for (let depth = 1; depth <= maxDepth; depth++) {
    let bestV = -Infinity
    let bestM: Move[] = []
    let completed = true
    let alpha = -Infinity
    for (const m of moves) {
      game.move(m.san)
      const v = minimax(game, depth - 1, alpha, Infinity, false, aiColor)
      game.undo()
      if (Date.now() > deadline) { completed = false; break }
      if (v > bestV + 1) {
        bestV = v
        bestM = [m]
      } else if (Math.abs(v - bestV) <= 1) {
        bestM.push(m)
      }
      if (v > alpha) alpha = v
    }
    // Обновляем лучший ход ТОЛЬКО если глубина завершилась полностью —
    // частичные результаты глубины могут пропустить сильнейший ход.
    if (completed && bestM.length) bestResult = toResult(bestM[Math.floor(Math.random() * bestM.length)])
    if (!completed) break
    if (Date.now() > deadline) break
  }
  return bestResult
}

function toResult(m: Move): ChessAiMove {
  return { from: m.from, to: m.to, san: m.san, promotion: m.promotion, captured: m.captured ?? null }
}
