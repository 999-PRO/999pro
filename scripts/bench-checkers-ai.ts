/* Benchmark checkers AI ckBestMove at each level (tsx) */
import { ckInitial, ckApplyStep } from '../src/lib/games/checkers-core'
import { ckBestMove } from '../src/lib/games/checkers-ai'

// play some random moves to get a mid-game position
let s = ckInitial('w')
for (let i = 0; i < 14; i++) {
  const { ckFullMoves } = require('../src/lib/games/checkers-core')
  const moves = ckFullMoves(s)
  if (!moves.length) break
  const mv = moves[Math.floor(Math.random() * moves.length)]
  let next = s
  for (const step of mv.steps) {
    const applied = ckApplyStep(next, step)
    if (!applied) break
    next = applied
  }
  s = next
}

for (const level of [1, 2, 3] as const) {
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now()
    ckBestMove(s, level)
    console.log(`level ${level}: ${Date.now() - t0} ms`)
  }
}
