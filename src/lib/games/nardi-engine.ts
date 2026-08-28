// ============================================================================
// v25.24 — ОБЩИЙ ИГРОВОЙ ДВИЖОК ДУЭЛЕЙ (нарды + крестики-нолики).
// Чистые функции без зависимостей — используется бэкендом для валидации ходов
// и фронтом (копия в src/lib/games/nardi-engine.ts) для одиночной игры и UI.
// ----------------------------------------------------------------------------

export type Side = 'w' | 'b'

export interface NardiState {
  points: number[] // 24 поля; + = белые, − = чёрные (модуль = количество)
  bar: { w: number; b: number } // «бар» — срубленные шашки
  off: { w: number; b: number } // выведенные шашки
  turn: Side
  dice: number[] // неиспользованные кубики текущего хода (1–4)
  lastDice: number[] // что выпало в этом ходу (для UI)
  winner: Side | null
}

// Белые идут 23 → 0 (дом 0..5), чёрные 0 → 23 (дом 18..23).
export function nardiInitial(first: Side): NardiState {
  const points = new Array(24).fill(0)
  // Стартовая расстановка (короткие нарды): 24п-2, 13п-5, 8п-3, 6п-5
  points[23] = 2 // белые, 24-пункт
  points[11] = 5 // белые, 13-пункт
  points[7] = 3 // белые, 8-пункт
  points[5] = 5 // белые, 6-пункт
  points[0] = -2 // чёрные
  points[12] = -5 // чёрные
  points[16] = -3 // чёрные
  points[18] = -5 // чёрные
  return { points, bar: { w: 0, b: 0 }, off: { w: 0, b: 0 }, turn: first, dice: [], lastDice: [], winner: null }
}

export function rollDice(): number[] {
  const a = 1 + Math.floor(Math.random() * 6)
  const b = 1 + Math.floor(Math.random() * 6)
  return a === b ? [a, a, a, a] : [a, b]
}

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')

// «Пипсы» — дистанция до полного вывода
export function pipCount(s: NardiState, side: Side): number {
  let pip = 0
  for (let i = 0; i < 24; i++) {
    const c = s.points[i]
    if (side === 'w' && c > 0) pip += c * (i + 1)
    if (side === 'b' && c < 0) pip += -c * (24 - i)
  }
  if (side === 'w') pip += s.bar.w * 25
  else pip += s.bar.b * 25
  return pip
}

function allHome(s: NardiState, side: Side): boolean {
  if (s.bar[side] > 0) return false
  if (side === 'w') {
    for (let i = 6; i < 24; i++) if (s.points[i] > 0) return false
  } else {
    for (let i = 0; i < 18; i++) if (s.points[i] < 0) return false
  }
  return true
}

export interface NardiMove {
  from: number // 0..23 или -1 (бар)
  to: number // 0..23 или 24 = «сброс» (off)
  die: number
}

// Все одиночные ходы текущего игрока (по одному кубику)
export function nardiLegalMoves(s: NardiState): NardiMove[] {
  if (s.winner) return []
  const me = s.turn
  const sign = me === 'w' ? 1 : -1
  const moves: NardiMove[] = []

  const canLand = (idx: number): boolean => {
    const v = s.points[idx]
    if (me === 'w') return v >= -1
    return v <= 1
  }

  if (s.bar[me] > 0) {
    // С бара — только вход
    for (const d of new Set(s.dice)) {
      const to = me === 'w' ? 24 - d : d - 1
      if (to >= 0 && to < 24 && canLand(to)) moves.push({ from: -1, to, die: d })
    }
    return moves
  }

  const bearing = allHome(s, me)

  for (let i = 0; i < 24; i++) {
    if (s.points[i] * sign <= 0) continue
    for (const d of new Set(s.dice)) {
      const to = me === 'w' ? i - d : i + d
      if (to >= 0 && to < 24) {
        if (canLand(to)) moves.push({ from: i, to, die: d })
      } else if (bearing) {
        // Точный сброс: белые с поля i требуют кубик i+1; чёрные — 24-i
        const exact = me === 'w' ? d === i + 1 : d === 24 - i
        if (exact) {
          moves.push({ from: i, to: 24, die: d })
          continue
        }
        // Перебор: только с самой дальней шашки
        if (me === 'w') {
          let higher = false
          for (let j = i + 1; j < 6; j++) if (s.points[j] > 0) higher = true
          if (!higher && d > i + 1) moves.push({ from: i, to: 24, die: d })
        } else {
          let higher = false
          for (let j = 18; j < i; j++) if (s.points[j] < 0) higher = true
          if (!higher && d > 24 - i) moves.push({ from: i, to: 24, die: d })
        }
      }
    }
  }
  return moves
}

export function nardiApply(s: NardiState, m: NardiMove): NardiState {
  // убрать ОДИН экземпляр m.die
  const di = s.dice.indexOf(m.die)
  const dice = [...s.dice]
  if (di >= 0) dice.splice(di, 1)

  const n: NardiState = {
    points: [...s.points],
    bar: { ...s.bar },
    off: { ...s.off },
    turn: s.turn,
    dice,
    lastDice: s.lastDice,
    winner: s.winner,
  }

  const me = s.turn
  const sign = me === 'w' ? 1 : -1

  if (m.from === -1) n.bar[me] -= 1
  else n.points[m.from] -= sign

  if (m.to === 24) {
    n.off[me] += 1
  } else {
    // рубим блот
    if (me === 'w' && n.points[m.to] === -1) {
      n.points[m.to] = 0
      n.bar.b += 1
    } else if (me === 'b' && n.points[m.to] === 1) {
      n.points[m.to] = 0
      n.bar.w += 1
    }
    n.points[m.to] += sign
  }

  if (n.off[me] >= 15) n.winner = me
  return n
}

// Переключить ход и бросить кубики новому игроку
export function nardiNextTurn(s: NardiState): NardiState {
  const rolled = rollDice()
  return { ...s, turn: other(s.turn), dice: [...rolled], lastDice: [...rolled], winner: s.winner }
}

export function nardiHasAnyMove(s: NardiState): boolean {
  return nardiLegalMoves(s).length > 0
}

// ----------------------------------------------------------------------------
// ИИ (одиночная игра): перебор последовательностей хода + эвристика
// ----------------------------------------------------------------------------

function evaluate(s: NardiState, me: Side): number {
  const opp = other(me)
  let score = 0
  score += (s.off[me] - s.off[opp]) * 32
  score += pipCount(s, opp) - pipCount(s, me)
  score += (s.bar[opp] - s.bar[me]) * 18
  const sign = me === 'w' ? 1 : -1
  for (let i = 0; i < 24; i++) {
    const c = s.points[i]
    if (c * sign <= 0) continue
    if (c * sign >= 2) {
      score += 5
      if (me === 'w' ? i < 6 : i > 17) score += 4
      if (me === 'w' ? i > 17 : i < 6) score += 2
    } else {
      let danger = false
      for (let d = 1; d <= 6 && !danger; d++) {
        const from = me === 'w' ? i + d : i - d
        if (from >= 0 && from < 24 && s.points[from] * -sign >= 1) danger = true
      }
      const oppBar = me === 'w' ? s.bar.b : s.bar.w
      if (danger || oppBar > 0) score -= 14
    }
  }
  return score
}

function hashState(s: NardiState, me: Side): string {
  return `${me}:${s.points.join(',')}:${s.bar.w}${s.bar.b}:${s.off.w}${s.off.b}:${[...s.dice].sort().join('')}`
}

// Лучший полный ход (все кубики). Возвращает последовательность ходов.
export function nardiBestMove(s: NardiState, cap = 6000): { moves: NardiMove[]; score: number } {
  const me = s.turn
  let nodes = 0
  const seen = new Set<string>()
  let best: { moves: NardiMove[]; score: number } = { moves: [], score: -Infinity }

  const rec = (st: NardiState, acc: NardiMove[]) => {
    if (nodes >= cap) return
    if (st.dice.length === 0) {
      nodes++
      const sc = evaluate(st, me)
      if (sc > best.score) best = { moves: [...acc], score: sc }
      return
    }
    const key = hashState(st, me)
    if (seen.has(key)) return
    seen.add(key)
    const moves = nardiLegalMoves(st)
    if (!moves.length) {
      nodes++
      const sc = evaluate(st, me) - 6 // кубики не смогли разыграть
      if (sc > best.score) best = { moves: [...acc], score: sc }
      return
    }
    for (const m of moves) {
      acc.push(m)
      rec(nardiApply(st, m), acc)
      acc.pop()
      if (nodes >= cap) return
    }
  }
  rec(s, [])
  return best
}

// ----------------------------------------------------------------------------
// Крестики-нолики
// ----------------------------------------------------------------------------

export interface TttState {
  board: Array<'x' | 'o' | null> // 9
  turn: 'x' | 'o'
  winner: 'x' | 'o' | 'draw' | null
  line: number[] | null
}

export function tttInitial(): TttState {
  return { board: new Array(9).fill(null), turn: 'x', winner: null, line: null }
}

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

export function tttApply(s: TttState, idx: number): TttState | null {
  if (s.winner || idx < 0 || idx > 8 || s.board[idx]) return null
  const board = [...s.board]
  board[idx] = s.turn
  let winner: TttState['winner'] = null
  let line: number[] | null = null
  for (const l of LINES) {
    const [a, b, c] = l
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      winner = board[a]
      line = l
      break
    }
  }
  if (!winner && board.every((v) => v)) winner = 'draw'
  return { board, turn: s.turn === 'x' ? 'o' : 'x', winner, line }
}
