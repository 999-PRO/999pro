// ============================================================================
// v25.25 — ИИ для русских шашек: minimax α-β на полных ходах (цепочка боя
// считается одним ходом). Уровни: 1 — глубина 2 + ошибки, 2 — глубина 3,
// 3 — глубина 4 (с потолком узлов, чтобы игра не залипала).
// ----------------------------------------------------------------------------

import {
  ckFullMoves, ckLegalSteps, ckIdxToRC,
  type CkFullMove, type CkSide, type CkState,
} from './checkers-core'

const MAN = 100
const KING = 275

function advancement(r: number, side: CkSide): number {
  // сколько рядов осталось до превращения; чем меньше — тем ценнее
  const rows = side === 'w' ? 7 - r : r
  return (7 - rows) * 6
}

/** Оценка позиции с точки зрения rootMe (абсолютная). */
function evaluate(s: CkState, rootMe: CkSide): number {
  let score = 0
  for (let i = 0; i < 32; i++) {
    const cell = s.cells[i]
    if (!cell) continue
    const side: CkSide = cell <= 2 ? 'w' : 'b'
    const sign = side === rootMe ? 1 : -1
    let v = cell === 1 || cell === 3 ? MAN : KING
    const [r] = ckIdxToRC(i)
    if (cell === 1 || cell === 3) v += advancement(r, side)
    const c = ckIdxToRC(i)[1]
    v += (3.5 - Math.abs(3.5 - r) - Math.abs(3.5 - c)) * 4
    // своя последняя ряда — защита превращения соперником
    if (side === 'w' && r === 7) v += 8
    if (side === 'b' && r === 0) v += 8
    score += sign * v
  }
  return score
}

function minimax(s: CkState, depth: number, alpha: number, beta: number, maximizing: boolean, rootMe: CkSide): number {
  if (s.winner) {
    if (s.winner === 'draw') return 0
    return s.winner === rootMe ? 50000 + depth : -50000 - depth
  }
  const moves = ckFullMoves(s)
  if (!moves.length) return maximizing ? -50000 - depth : 50000 + depth
  if (depth <= 0) return evaluate(s, rootMe)

  // бой (длинные цепочки) смотрим первыми — лучше срезает
  const ordered = [...moves].sort((a, b) => b.steps.length - a.steps.length)
  let nodesCap = ordered.length

  if (maximizing) {
    let bestV = -Infinity
    for (const mv of ordered) {
      const v = minimax(mv.state, depth - 1, alpha, beta, false, rootMe)
      if (v > bestV) bestV = v
      if (v > alpha) alpha = v
      if (beta <= alpha) break
    }
    void nodesCap
    return bestV
  }
  let bestV = Infinity
  for (const mv of ordered) {
    const v = minimax(mv.state, depth - 1, alpha, beta, true, rootMe)
    if (v < bestV) bestV = v
    if (v < beta) beta = v
    if (beta <= alpha) break
  }
  return bestV
}

export interface CkAiResult {
  move: CkFullMove | null
  score: number
}

export function ckBestMove(s: CkState, level: 1 | 2 | 3): CkAiResult {
  const moves = ckFullMoves(s)
  if (!moves.length) return { move: null, score: 0 }
  const me = s.turn
  const depth = level === 1 ? 2 : level === 2 ? 3 : 4
  if (level === 1 && Math.random() < 0.3) {
    return { move: moves[Math.floor(Math.random() * moves.length)], score: 0 }
  }

  let nodes = 0
  const cap = level === 3 ? 90000 : level === 2 ? 30000 : 12000
  const ordered = [...moves].sort((a, b) => b.steps.length - a.steps.length)

  let best: CkFullMove[] = []
  let bestV = -Infinity
  let alpha = -Infinity

  for (const mv of ordered) {
    const v = minimax(mv.state, depth - 1, alpha, Infinity, false, me)
    nodes++
    if (v > bestV + 1) {
      bestV = v
      best = [mv]
    } else if (Math.abs(v - bestV) <= 1) {
      best.push(mv)
    }
    if (v > alpha) alpha = v
    if (nodes >= cap) break
  }
  const pick = best.length ? best[Math.floor(Math.random() * best.length)] : ordered[0]
  return { move: pick, score: bestV }
}

/** Есть ли у состояния обязательные взятия (для UI-подсказки). */
export function ckHasCaptures(s: CkState): boolean {
  return ckLegalSteps(s).some((m) => m.cap !== null)
}
