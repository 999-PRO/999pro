// ============================================================================
// v25.24/v25.25 — ОНЛАЙН-ДУЭЛИ ИЗ ЧАТА («сыграть с собеседником»).
//
// Endpoints (все requireAuth):
//   POST /api/game-duels                      — создать приглашение {gameType, opponentId, conversationId?}
//   POST /api/game-duels/:id/accept           — принять (игрок 2) → партия начинается
//   POST /api/game-duels/:id/decline          — отклонить (игрок 2)
//   POST /api/game-duels/:id/cancel           — отменить приглашение (игрок 1, до принятия)
//   GET  /api/game-duels/:id                  — состояние партии (для обоих игроков)
//   POST /api/game-duels/:id/move             — ход (формат зависит от игры)
//   POST /api/game-duels/:id/resign           — сдаться
//
// Типы игр:
//   tictactoe        — крестики-нолики (ход {cell})
//   nardi            — нарды (ЛЕГАСИ: тип убран из UI v25.25, активные партии доигрываются)
//   checkers         — русские шашки (шаги {from,to} 0..31, цепочка боя — несколько запросов)
//   chess            — шахматы (ход {fromSq,toSq 0..63, promo?}, движок chess.js)
//   quiz-flags / quiz-capitals / quiz-quiz-millionaire / quiz-math
//                    — викторины (ответ {qi, choice}; оба игрока отвечают на вопрос)
//
// Каждый мутатор валидирует ход движком и рассылает `duel:updated`
// в комнаты user:<p1>/user:<p2> через Socket.IO.
// ============================================================================
import { Router } from 'express'
import { z } from 'zod'
import { Chess } from 'chess.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { getIo } from '../socket/handlers.js'
import {
  nardiInitial,
  nardiLegalMoves,
  nardiApply,
  nardiNextTurn,
  nardiHasAnyMove,
  tttInitial,
  tttApply,
  type NardiState,
  type NardiMove,
  type TttState,
  type Side,
} from '../games/duel-engine.js'
import {
  ckInitial,
  ckLegalSteps,
  ckApplyStep,
  type CkState,
  type CkSide,
  type CkStep,
} from '../games/checkers-core.js'
import {
  QUIZ_DUEL_TYPES,
  genQuizQuestions,
  quizScore,
  quizIsFinished,
  type QuizDuelState,
  type QuizDuelType,
} from '../games/quiz-duel.js'

const router: Router = Router()

const DUEL_INCLUDE = {
  player1: { select: { id: true, username: true, displayName: true, avatar: true } },
  player2: { select: { id: true, username: true, displayName: true, avatar: true } },
}

type DuelRow = {
  id: string
  gameType: string
  state: string
  turnUserId: string | null
  status: string
  winnerId: string | null
  player1Id: string
  player2Id: string
  conversationId: string | null
  lastMoveAt: Date
  createdAt: Date
  updatedAt: Date
  player1: { id: string; username: string; displayName: string; avatar: string | null }
  player2: { id: string; username: string; displayName: string; avatar: string | null }
}

function serialiseDuel(d: DuelRow) {
  let state: unknown = {}
  try {
    state = JSON.parse(d.state)
  } catch {}
  return {
    id: d.id,
    gameType: d.gameType,
    status: d.status,
    state,
    turnUserId: d.turnUserId,
    winnerId: d.winnerId,
    player1Id: d.player1Id,
    player2Id: d.player2Id,
    player1: d.player1,
    player2: d.player2,
    conversationId: d.conversationId,
    lastMoveAt: d.lastMoveAt,
    createdAt: d.createdAt,
  }
}

function emitDuel(duelId: string) {
  try {
    const io = getIo()
    if (!io) return
    prisma.gameDuel
      .findUnique({ where: { id: duelId }, include: DUEL_INCLUDE })
      .then((d) => {
        if (!d) return
        const payload = serialiseDuel(d as unknown as DuelRow)
        io.to(`user:${d.player1Id}`).emit('duel:updated', payload)
        io.to(`user:${d.player2Id}`).emit('duel:updated', payload)
      })
      .catch(() => {})
  } catch {}
}

async function loadDuelFor(req: AuthedRequest, id: string): Promise<DuelRow | null> {
  const duel = (await prisma.gameDuel.findUnique({ where: { id }, include: DUEL_INCLUDE })) as unknown as DuelRow | null
  if (!duel) return null
  if (duel.player1Id !== req.user!.id && duel.player2Id !== req.user!.id) return null
  return duel
}

const GAME_TYPES = ['tictactoe', 'nardi', 'checkers', 'chess', ...QUIZ_DUEL_TYPES] as const

const createSchema = z.object({
  gameType: z.enum(GAME_TYPES as unknown as [string, ...string[]]),
  opponentId: z.string().min(1).max(64),
  conversationId: z.string().max(64).optional().nullable(),
})

const randomSide = (): CkSide => (Math.random() < 0.5 ? 'w' : 'b')
const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')

// POST / — создать приглашение
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' })
    const { gameType, opponentId, conversationId } = parsed.data
    if (opponentId === req.user!.id) return res.status(400).json({ error: 'Нельзя играть с собой' })

    const opponent = await prisma.user.findUnique({ where: { id: opponentId }, select: { id: true, deletedAt: true } })
    if (!opponent || opponent.deletedAt) return res.status(404).json({ error: 'Собеседник не найден' })

    const duel = (await prisma.gameDuel.create({
      data: {
        gameType,
        status: 'pending',
        state: '{}',
        player1Id: req.user!.id,
        player2Id: opponentId,
        conversationId: conversationId || null,
      },
      include: DUEL_INCLUDE,
    })) as unknown as DuelRow

    res.status(201).json({ duel: serialiseDuel(duel) })
  }),
)

// POST /:id/accept — принять приглашение (только игрок 2)
router.post(
  '/:id/accept',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const duel = await loadDuelFor(req, req.params.id)
    if (!duel) return res.status(404).json({ error: 'Партия не найдена' })
    if (duel.status !== 'pending') return res.status(400).json({ error: 'Приглашение уже не активно' })
    if (req.user!.id !== duel.player2Id) return res.status(403).json({ error: 'Только получатель приглашения может принять' })

    let state: unknown = {}
    let turnUserId: string | null = null

    switch (duel.gameType) {
      case 'nardi': {
        // ЛЕГАСИ: нарды убраны из UI в v25.25, активные партии доигрываются.
        const first: Side = Math.random() < 0.5 ? 'w' : 'b'
        const st = nardiNextTurn(nardiInitial(first))
        state = st
        turnUserId = st.turn === 'w' ? duel.player1Id : duel.player2Id
        break
      }
      case 'tictactoe': {
        const firstX = Math.random() < 0.5
        const st = tttInitial()
        if (!firstX) st.turn = 'o'
        state = st
        turnUserId = firstX ? duel.player1Id : duel.player2Id
        break
      }
      case 'checkers': {
        // Белые всегда начинают; случайный жребий — кто играет белыми.
        const p1Side = randomSide()
        const st = ckInitial(p1Side)
        state = st
        turnUserId = st.turn === p1Side ? duel.player1Id : duel.player2Id
        break
      }
      case 'chess': {
        const p1Side = randomSide()
        const game = new Chess()
        state = { fen: game.fen(), p1Side, history: [] as unknown[] }
        turnUserId = game.turn() === p1Side ? duel.player1Id : duel.player2Id
        break
      }
      default: {
        if (QUIZ_DUEL_TYPES.includes(duel.gameType as QuizDuelType)) {
          state = genQuizQuestions(duel.gameType as QuizDuelType)
          turnUserId = null // на викторинах отвечают оба
        }
        break
      }
    }

    const updated = (await prisma.gameDuel.update({
      where: { id: duel.id },
      data: { status: 'active', state: JSON.stringify(state), turnUserId, lastMoveAt: new Date() },
      include: DUEL_INCLUDE,
    })) as unknown as DuelRow

    emitDuel(duel.id)
    res.json({ duel: serialiseDuel(updated) })
  }),
)

// POST /:id/decline — отклонить (игрок 2)
router.post(
  '/:id/decline',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const duel = await loadDuelFor(req, req.params.id)
    if (!duel) return res.status(404).json({ error: 'Партия не найдена' })
    if (duel.status !== 'pending') return res.status(400).json({ error: 'Приглашение уже не активно' })
    if (req.user!.id !== duel.player2Id) return res.status(403).json({ error: 'Недоступно' })
    await prisma.gameDuel.update({ where: { id: duel.id }, data: { status: 'declined' } })
    emitDuel(duel.id)
    res.json({ ok: true })
  }),
)

// POST /:id/cancel — отменить приглашение (игрок 1, до принятия)
router.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const duel = await loadDuelFor(req, req.params.id)
    if (!duel) return res.status(404).json({ error: 'Партия не найдена' })
    if (duel.status !== 'pending') return res.status(400).json({ error: 'Приглашение уже не активно' })
    if (req.user!.id !== duel.player1Id) return res.status(403).json({ error: 'Недоступно' })
    await prisma.gameDuel.update({ where: { id: duel.id }, data: { status: 'cancelled' } })
    emitDuel(duel.id)
    res.json({ ok: true })
  }),
)

// ----------------------------------------------------------------------------
// Викторины: «ленивый» таймаут — если игрок не отвечает на текущий вопрос
// дольше QUIZ_ANSWER_MS, при любом обращении к партии ему засчитывается
// пропуск (null) и вопрос переходит дальше. Таймеров на сервере нет.
// ----------------------------------------------------------------------------
const QUIZ_ANSWER_MS = 75_000

function quizSweep(duel: DuelRow): { st: QuizDuelState; changed: boolean } {
  const st = JSON.parse(duel.state) as QuizDuelState
  if (quizIsFinished(st)) return { st, changed: false }
  const waitingP1 = st.a1.length <= st.idx
  const waitingP2 = st.a2.length <= st.idx
  if (!(waitingP1 || waitingP2)) return { st, changed: false }
  const elapsed = Date.now() - new Date(duel.lastMoveAt).getTime()
  if (elapsed < QUIZ_ANSWER_MS) return { st, changed: false }
  // просрочка: отсутствующим ставим null и вопрос закрывается
  while (st.a1.length <= st.idx) st.a1.push(null)
  while (st.a2.length <= st.idx) st.a2.push(null)
  st.idx += 1
  st.finished = quizIsFinished(st)
  return { st, changed: true }
}

async function persistQuiz(
  duel: DuelRow,
  st: QuizDuelState,
): Promise<{ status: string; winnerId: string | null; turnUserId: string | null }> {
  let status = 'active'
  let winnerId: string | null = null
  if (st.finished) {
    status = 'finished'
    const s1 = quizScore(st, 'a1')
    const s2 = quizScore(st, 'a2')
    winnerId = s1 > s2 ? duel.player1Id : s2 > s1 ? duel.player2Id : null // ничья → null
  }
  await prisma.gameDuel.update({
    where: { id: duel.id },
    data: { state: JSON.stringify(st), status, winnerId, turnUserId: null, lastMoveAt: new Date() },
  })
  emitDuel(duel.id)
  return { status, winnerId, turnUserId: null }
}

// GET /:id — состояние
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    let duel = await loadDuelFor(req, req.params.id)
    if (!duel) return res.status(404).json({ error: 'Партия не найдена' })

    // ленивый таймаут викторин
    if (duel.status === 'active' && QUIZ_DUEL_TYPES.includes(duel.gameType as QuizDuelType)) {
      const { st, changed } = quizSweep(duel)
      if (changed) {
        const { status, winnerId } = await persistQuiz(duel, st)
        duel = { ...duel, state: JSON.stringify(st), status, winnerId } as DuelRow
      }
    }

    res.json({ duel: serialiseDuel(duel) })
  }),
)

const moveSchema = z.object({
  // нарды/крестики
  from: z.number().int().min(-1).max(31).optional(),
  to: z.number().int().min(0).max(31).optional(),
  die: z.number().int().min(1).max(6).optional(),
  cell: z.number().int().min(0).max(8).optional(),
  pass: z.boolean().optional(),
  // шахматы
  fromSq: z.number().int().min(0).max(63).optional(),
  toSq: z.number().int().min(0).max(63).optional(),
  promo: z.enum(['q', 'r', 'b', 'n']).optional(),
  // викторины
  qi: z.number().int().min(0).max(50).optional(),
  choice: z.number().int().min(0).max(3).optional(),
})

const squareName = (i: number): string => {
  const file = 'abcdefgh'[i % 8]
  const rank = String(8 - Math.floor(i / 8))
  return `${file}${rank}`
}

// POST /:id/move — ход
router.post(
  '/:id/move',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const duel = await loadDuelFor(req, req.params.id)
    if (!duel) return res.status(404).json({ error: 'Партия не найдена' })
    if (duel.status !== 'active') return res.status(400).json({ error: 'Партия не активна' })

    const parsed = moveSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' })
    const mv = parsed.data

    const isQuiz = QUIZ_DUEL_TYPES.includes(duel.gameType as QuizDuelType)

    // В викторинах отвечает любой из двух игроков (turnUserId не используется);
    // в остальных играх — строго по очереди.
    if (!isQuiz && duel.turnUserId !== req.user!.id) return res.status(403).json({ error: 'Сейчас не твой ход' })

    // ---------------- ВИКТОРИНЫ ----------------
    if (isQuiz) {
      const sweep = quizSweep(duel)
      let st = sweep.st
      if (sweep.changed) await persistQuiz(duel, st)
      if (st.finished) return res.status(400).json({ error: 'Викторина завершена' })
      if (typeof mv.qi !== 'number' || typeof mv.choice !== 'number') return res.status(400).json({ error: 'Нужны qi и choice' })
      if (mv.qi !== st.idx) return res.status(400).json({ error: 'Сейчас не этот вопрос' })

      const isP1 = req.user!.id === duel.player1Id
      const answered = isP1 ? st.a1 : st.a2
      if (answered.length !== st.idx) return res.status(400).json({ error: 'Ответ уже принят или вопрос закрыт' })

      answered.push(mv.choice)
      // вопрос закрывается только когда ответили ОБА
      if (st.a1.length > st.idx && st.a2.length > st.idx) {
        st.idx += 1
        st.finished = quizIsFinished(st)
      }
      await persistQuiz(duel, st)
      return res.json({ ok: true })
    }

    // ---------------- КРЕСТИКИ-НОЛИКИ ----------------
    if (duel.gameType === 'tictactoe') {
      const st = (JSON.parse(duel.state) as TttState) || tttInitial()
      if (typeof mv.cell !== 'number') return res.status(400).json({ error: 'Нужен cell' })
      const next = tttApply(st, mv.cell)
      if (!next) return res.status(400).json({ error: 'Недопустимый ход' })
      const done = !!next.winner
      const winnerId =
        next.winner === 'x' ? duel.player1Id : next.winner === 'o' ? duel.player2Id : next.winner === 'draw' ? null : undefined
      await prisma.gameDuel.update({
        where: { id: duel.id },
        data: {
          state: JSON.stringify(next),
          turnUserId: done ? null : duel.turnUserId === duel.player1Id ? duel.player2Id : duel.player1Id,
          status: done ? 'finished' : 'active',
          ...(winnerId !== undefined ? { winnerId } : {}),
          lastMoveAt: new Date(),
        },
      })
      emitDuel(duel.id)
      return res.json({ ok: true })
    }

    // ---------------- ШАХМАТЫ ----------------
    if (duel.gameType === 'chess') {
      const st = JSON.parse(duel.state) as { fen: string; p1Side: Side; history: unknown[] }
      const game = new Chess(st.fen)
      if (typeof mv.fromSq !== 'number' || typeof mv.toSq !== 'number') return res.status(400).json({ error: 'Нужны fromSq и toSq' })
      const from = squareName(mv.fromSq)
      const to = squareName(mv.toSq)
      const legal = game
        .moves({ verbose: true })
        .find((m) => m.from === from && m.to === to && (!m.promotion || m.promotion === (mv.promo ?? 'q')))
      if (!legal) return res.status(400).json({ error: 'Недопустимый ход' })
      game.move({ from, to, promotion: mv.promo ?? 'q' })

      const done = game.isGameOver()
      let winnerId: string | null | undefined
      if (game.isCheckmate()) {
        // мат поставил тот, кто ходил (req.user)
        winnerId = req.user!.id
      } else if (done) {
        winnerId = null // ничья
      }
      const mySide: Side = st.p1Side
      const turnUserId = done ? null : game.turn() === mySide ? duel.player1Id : duel.player2Id
      const nextState = { fen: game.fen(), p1Side: st.p1Side, history: [...st.history, { from, to, san: legal.san, captured: legal.captured ?? null }] }
      await prisma.gameDuel.update({
        where: { id: duel.id },
        data: {
          state: JSON.stringify(nextState),
          turnUserId,
          status: done ? 'finished' : 'active',
          ...(winnerId !== undefined ? { winnerId } : {}),
          lastMoveAt: new Date(),
        },
      })
      emitDuel(duel.id)
      return res.json({ ok: true })
    }

    // ---------------- НАРДЫ (легаси) ----------------
    if (duel.gameType === 'nardi') {
      const st = JSON.parse(duel.state) as NardiState
      if (mv.pass) {
        if (nardiHasAnyMove(st)) return res.status(400).json({ error: 'Есть доступные ходы' })
        const next = nardiNextTurn(st)
        await prisma.gameDuel.update({
          where: { id: duel.id },
          data: {
            state: JSON.stringify(next),
            turnUserId: next.turn === 'w' ? duel.player1Id : duel.player2Id,
            lastMoveAt: new Date(),
          },
        })
        emitDuel(duel.id)
        return res.json({ ok: true })
      }
      const { from, to, die } = mv as Partial<NardiMove>
      if (typeof from !== 'number' || typeof to !== 'number' || typeof die !== 'number')
        return res.status(400).json({ error: 'Нужны from/to/die' })
      const legal = nardiLegalMoves(st).find((m) => m.from === from && m.to === to && m.die === die)
      if (!legal) return res.status(400).json({ error: 'Недопустимый ход' })
      const applied = nardiApply(st, legal)
      if (applied.winner) {
        await prisma.gameDuel.update({
          where: { id: duel.id },
          data: {
            state: JSON.stringify(applied),
            turnUserId: null,
            status: 'finished',
            winnerId: applied.winner === 'w' ? duel.player1Id : duel.player2Id,
            lastMoveAt: new Date(),
          },
        })
        emitDuel(duel.id)
        return res.json({ ok: true })
      }
      let next = applied
      if (applied.dice.length === 0) next = nardiNextTurn(applied)
      await prisma.gameDuel.update({
        where: { id: duel.id },
        data: {
          state: JSON.stringify(next),
          turnUserId: next.turn === 'w' ? duel.player1Id : duel.player2Id,
          lastMoveAt: new Date(),
        },
      })
      emitDuel(duel.id)
      return res.json({ ok: true })
    }

    // ---------------- ШАШКИ ----------------
    if (duel.gameType === 'checkers') {
      const st = JSON.parse(duel.state) as CkState
      if (typeof mv.from !== 'number' || typeof mv.to !== 'number') return res.status(400).json({ error: 'Нужны from и to' })
      const step: CkStep = { from: mv.from, to: mv.to, cap: null }
      const applied = ckApplyStep(st, step)
      if (!applied) return res.status(400).json({ error: 'Недопустимый ход' })

      // Если бой продолжается — ход остаётся у того же игрока.
      const chainActive = applied.chainFrom !== null
      const nextTurnUserId = chainActive
        ? duel.turnUserId
        : applied.turn === (applied.p1Side as CkSide)
          ? duel.player1Id
          : duel.player2Id

      const done = !!applied.winner
      const winnerId =
        applied.winner === 'draw' || applied.winner == null
          ? applied.winner === 'draw'
            ? null
            : undefined
          : applied.winner === (applied.p1Side as CkSide)
            ? duel.player1Id
            : duel.player2Id

      await prisma.gameDuel.update({
        where: { id: duel.id },
        data: {
          state: JSON.stringify(applied),
          turnUserId: done ? null : nextTurnUserId,
          status: done ? 'finished' : 'active',
          ...(winnerId !== undefined ? { winnerId } : {}),
          lastMoveAt: new Date(),
        },
      })
      emitDuel(duel.id)
      return res.json({ ok: true })
    }

    return res.status(400).json({ error: 'Неизвестный тип игры' })
  }),
)

// POST /:id/resign — сдаться
router.post(
  '/:id/resign',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const duel = await loadDuelFor(req, req.params.id)
    if (!duel) return res.status(404).json({ error: 'Партия не найдена' })
    if (duel.status !== 'active') return res.status(400).json({ error: 'Партия не активна' })
    const winnerId = req.user!.id === duel.player1Id ? duel.player2Id : duel.player1Id
    await prisma.gameDuel.update({
      where: { id: duel.id },
      data: { status: 'finished', winnerId, turnUserId: null, lastMoveAt: new Date() },
    })
    emitDuel(duel.id)
    res.json({ ok: true })
  }),
)

export default router
