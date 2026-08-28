// ============================================================================
// v25.25 — РУССКИЕ ШАШКИ: чистый игровой движок (без зависимостей).
// Одна и та же логика копируется в backend/src/games/duel-engine.ts
// (серверная валидация ходов) — держим файлы синхронными.
//
// Правила (русские шашки):
//   • Простая ходит на 1 клетку вперёд по диагонали.
//   • Дамка ходит на любое расстояние по диагонали.
//   • ВЗЯТИЕ обязательно. Простая бьёт вперёд И назад через одну клетку.
//   • Дамка бит «на лету»: пролетает пустые клетки, перепрыгивает одну
//     шашку соперника и садится на любое пустое за ней.
//   • Бой цепочкой обязателен к продолжению той же шашкой.
//   • Побитые снимаются в конце хода; одну шашку нельзя бить дважды.
//   • Простая, дошедшая до последнего ряда, становится дамкой — в том
//     числе посреди цепочки боя, и продолжает бой уже как дамка.
//   • Проигрывает тот, у кого нет шашек или ходов. Ничья — 15 ходов
//     подряд каждой стороной без боя и без хода простой шашкой.
// ----------------------------------------------------------------------------

export type CkSide = 'w' | 'b'

// 0 — пусто; 1 — простая белая; 2 — дамка белых; 3 — простая чёрная; 4 — дамка чёрных
export type CkCell = 0 | 1 | 2 | 3 | 4

export interface CkState {
  cells: number[] // 32 клетки
  turn: CkSide
  /** если бой продолжается — индекс шашки, обязанной бить дальше */
  chainFrom: number | null
  /** индексы уже побитых в текущей цепочке (снимаются в конце хода) */
  captured: number[]
  winner: CkSide | 'draw' | null
  /** какими цветами играет player1 (белыми/чёрными) — для дуэли */
  p1Side: CkSide
  /** последний завершённый ход: [from, ...landings] — для подсветки */
  lastPath: number[] | null
  /** полуходов без боя и без хода простой шашкой (для ничьей) */
  quiet: number
}

export interface CkStep {
  from: number
  to: number
  /** индекс побитой шашки (только для шагов взятия) */
  cap: number | null
}

// ---------- геометрия ----------

/** индекс клетки 0..31 → (row, col); тёмные клетки: (r+c)%2===1 */
export function ckIdxToRC(i: number): [number, number] {
  const r = i >> 2
  const c = (i % 4) * 2 + (r % 2 === 0 ? 1 : 0)
  return [r, c]
}

export function ckRCToIdx(r: number, c: number): number {
  return r * 4 + (c >> 1)
}

export function ckOnBoard(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8
}

const DIRS: [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]

const sideOf = (cell: number): CkSide | null =>
  cell === 1 || cell === 2 ? 'w' : cell === 3 || cell === 4 ? 'b' : null
const isKing = (cell: number): boolean => cell === 2 || cell === 4
const manOf = (s: CkSide): number => (s === 'w' ? 1 : 3)
const kingOf = (s: CkSide): number => (s === 'w' ? 2 : 4)

const backRow = (s: CkSide): number => (s === 'w' ? 0 : 7)

// ---------- начальная расстановка ----------

export function ckInitial(p1Side: CkSide = 'w'): CkState {
  const cells = new Array(32).fill(0)
  // белые — нижние три ряда, чёрные — верхние
  for (let i = 0; i < 32; i++) {
    const [r] = ckIdxToRC(i)
    if (r <= 2) cells[i] = 3
    else if (r >= 5) cells[i] = 1
  }
  return {
    cells,
    turn: 'w',
    chainFrom: null,
    captured: [],
    winner: null,
    p1Side,
    lastPath: null,
    quiet: 0,
  }
}

// ---------- генерация ходов ----------

/** Шаги взятия конкретной шашки (с учётом уже побитых в цепочке). */
function captureStepsOf(s: CkState, from: number): CkStep[] {
  const cell = s.cells[from]
  const me = sideOf(cell)
  if (!me || sideOf(cell) !== s.turn) return []
  const king = isKing(cell)
  const [r, c] = ckIdxToRC(from)
  const out: CkStep[] = []

  for (const [dr, dc] of DIRS) {
    if (!king) {
      // простая: бьёт через соседнюю клетку
      const er = r + dr
      const ec = c + dc
      const lr = r + 2 * dr
      const lc = c + 2 * dc
      if (!ckOnBoard(lr, lc)) continue
      const ei = ckRCToIdx(er, ec)
      const li = ckRCToIdx(lr, lc)
      const enemy = sideOf(s.cells[ei])
      if (enemy !== me && enemy !== null && !s.captured.includes(ei) && s.cells[li] === 0) {
        out.push({ from, to: li, cap: ei })
      }
    } else {
      // дамка: летит по пустым, перепрыгивает одну шашку соперника,
      // садится на любое пустое поле за ней
      let rr = r + dr
      let cc = c + dc
      // пролог по пустым
      while (ckOnBoard(rr, cc) && s.cells[ckRCToIdx(rr, cc)] === 0) {
        rr += dr
        cc += dc
      }
      if (!ckOnBoard(rr, cc)) continue
      const ei = ckRCToIdx(rr, cc)
      const enemy = sideOf(s.cells[ei])
      if (enemy === me || enemy === null || s.captured.includes(ei)) continue
      // поля приземления за побитой
      let lr2 = rr + dr
      let lc2 = cc + dc
      while (ckOnBoard(lr2, lc2) && s.cells[ckRCToIdx(lr2, lc2)] === 0) {
        out.push({ from, to: ckRCToIdx(lr2, lc2), cap: ei })
        lr2 += dr
        lc2 += dc
      }
    }
  }
  return out
}

/** Все шаги взятия текущего игрока. */
function allCaptureSteps(s: CkState): CkStep[] {
  const out: CkStep[] = []
  for (let i = 0; i < 32; i++) {
    if (sideOf(s.cells[i]) !== s.turn) continue
    out.push(...captureStepsOf(s, i))
  }
  return out
}

/** Простые (не боевые) шаги текущего игрока. */
function simpleSteps(s: CkState): CkStep[] {
  const out: CkStep[] = []
  const dir = s.turn === 'w' ? -1 : 1
  for (let i = 0; i < 32; i++) {
    const cell = s.cells[i]
    if (sideOf(cell) !== s.turn) continue
    const [r, c] = ckIdxToRC(i)
    if (!isKing(cell)) {
      const rr = r + dir
      for (const dc of [-1, 1]) {
        const cc = c + dc
        if (ckOnBoard(rr, cc) && s.cells[ckRCToIdx(rr, cc)] === 0) {
          out.push({ from: i, to: ckRCToIdx(rr, cc), cap: null })
        }
      }
    } else {
      for (const [dr, dc] of DIRS) {
        let rr = r + dr
        let cc = c + dc
        while (ckOnBoard(rr, cc) && s.cells[ckRCToIdx(rr, cc)] === 0) {
          out.push({ from: i, to: ckRCToIdx(rr, cc), cap: null })
          rr += dr
          cc += dc
        }
      }
    }
  }
  return out
}

/**
 * Легальные ШАГИ текущего состояния.
 * Если бой продолжается (chainFrom) — только продолжения этой шашки.
 * Если бой начат, но цепочка завершилась — состояние уже финализировано в apply.
 */
export function ckLegalSteps(s: CkState): CkStep[] {
  if (s.winner) return []
  if (s.chainFrom !== null) return captureStepsOf(s, s.chainFrom)
  const caps = allCaptureSteps(s)
  if (caps.length > 0) return caps
  return simpleSteps(s)
}

// ---------- применение шага ----------

function countPieces(s: CkState, side: CkSide): number {
  let n = 0
  for (const cell of s.cells) if (sideOf(cell) === side) n++
  return n
}

/**
 * Применить ОДИН шаг. Если бой можно продолжить — вернётся промежуточное
 * состояние (turn не меняется, chainFrom = клетка приземления).
 */
export function ckApplyStep(s: CkState, step: CkStep): CkState | null {
  const legal = ckLegalSteps(s)
  const ok = legal.find((m) => m.from === step.from && m.to === step.to)
  if (!ok) return null

  const cells = [...s.cells]
  const piece = cells[step.from]
  const me = s.turn
  cells[step.from] = 0
  cells[step.to] = piece

  const wasCapture = ok.cap !== null
  const nextCaptured = wasCapture ? [...s.captured, ok.cap!] : []

  // превращение (в т.ч. посреди цепочки боя)
  let promoted = false
  if (!isKing(piece) && ckIdxToRC(step.to)[0] === backRow(me)) {
    cells[step.to] = kingOf(me)
    promoted = true
  }

  const base: CkState = {
    ...s,
    cells,
    captured: nextCaptured,
    lastPath: s.lastPath,
    quiet: s.quiet,
  }

  if (wasCapture) {
    // можно ли продолжать бой этой шашкой?
    const cont = captureStepsOf({ ...base, chainFrom: step.to }, step.to)
    if (cont.length > 0) {
      return { ...base, chainFrom: step.to, turn: me, winner: null }
    }
    // цепочка завершена: снимаем побитых, передаём ход
    const finalCells = [...cells]
    for (const ci of nextCaptured) finalCells[ci] = 0
    const nxt: CkState = {
      ...base,
      cells: finalCells,
      chainFrom: null,
      captured: [],
      turn: me === 'w' ? 'b' : 'w',
      lastPath: [step.from, step.to],
      quiet: 0,
    }
    return ckFinishCheck(nxt)
  }

  // простой ход / ход дамки
  const nxt: CkState = {
    ...base,
    chainFrom: null,
    captured: [],
    turn: me === 'w' ? 'b' : 'w',
    lastPath: [step.from, step.to],
    quiet: promoted || isKing(piece) ? s.quiet + 1 : 0,
  }
  return ckFinishCheck(nxt)
}

/** Проверить конец партии (проигрыш/ничья) после передачи хода. */
function ckFinishCheck(s: CkState): CkState {
  const opp = s.turn
  if (countPieces(s, opp) === 0) {
    return { ...s, winner: opp === 'w' ? 'b' : 'w' }
  }
  if (ckLegalSteps(s).length === 0) {
    return { ...s, winner: opp === 'w' ? 'b' : 'w' }
  }
  if (s.quiet >= 30) return { ...s, winner: 'draw' }
  return s
}

// ---------- полные ходы (для ИИ) ----------

export interface CkFullMove {
  steps: CkStep[]
  state: CkState
}

/** Перечислить все ЗАВЕРШЁННЫЕ ходы (цепочки боя целиком + простые). */
export function ckFullMoves(s: CkState): CkFullMove[] {
  const first = ckLegalSteps(s)
  const out: CkFullMove[] = []
  for (const step of first) {
    const applied = ckApplyStep(s, step)
    if (!applied) continue
    if (applied.chainFrom !== null) {
      const rest = ckFullMoves(applied)
      for (const r of rest) out.push({ steps: [step, ...r.steps], state: r.state })
    } else {
      out.push({ steps: [step], state: applied })
    }
  }
  return out
}

/** Отдельный финализатор для дуэли: сервер применяет шаги по одному. */
export function ckIsChainActive(s: CkState): boolean {
  return s.chainFrom !== null
}

export function ckSideToMoveUserId(s: CkState, p1Id: string, p2Id: string): string {
  return s.turn === s.p1Side ? p1Id : p2Id
}
