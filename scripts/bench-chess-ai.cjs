/* Benchmark chess AI pick time at each depth (like chess-game.tsx) */
const { Chess } = require('/home/z/my-project/node_modules/chess.js')

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
function evaluate(game, forColor) {
  const board = game.board()
  let score = 0
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const cell = board[r][f]
    if (!cell) continue
    score += cell.color === forColor ? VAL[cell.type] * 100 : -VAL[cell.type] * 100
  }
  return score
}
function orderMoves(moves) {
  return [...moves].sort((a, b) => (b.captured ? VAL[b.captured] * 100 : 0) - (a.captured ? VAL[a.captured] * 100 : 0))
}
function minimax(game, depth, alpha, beta, maximizing, aiColor) {
  if (game.isCheckmate()) return game.turn() === aiColor ? -99000 - depth : 99000 + depth
  if (game.isDraw() || game.isStalemate() || depth === 0) return evaluate(game, aiColor)
  const moves = orderMoves(game.moves({ verbose: true }))
  if (maximizing) {
    let bestV = -Infinity
    for (const m of moves) { game.move(m.san); const v = minimax(game, depth - 1, alpha, beta, false, aiColor); game.undo(); if (v > bestV) bestV = v; if (v > alpha) alpha = v; if (beta <= alpha) break }
    return bestV
  }
  let bestV = Infinity
  for (const m of moves) { game.move(m.san); const v = minimax(game, depth - 1, alpha, beta, true, aiColor); game.undo(); if (v < bestV) bestV = v; if (v < beta) beta = v; if (beta <= alpha) break }
  return bestV
}
function pickAiMove(game, depth) {
  const moves = orderMoves(game.moves({ verbose: true }))
  const aiColor = game.turn()
  let bestV = -Infinity, bestM = []
  for (const m of moves) {
    game.move(m.san)
    const v = minimax(game, depth - 1, -Infinity, Infinity, false, aiColor)
    game.undo()
    if (v > bestV + 1) { bestV = v; bestM = [m] } else if (Math.abs(v - bestV) <= 1) bestM.push(m)
  }
  return bestM[0]
}

// mid-game position for realistic branching (random legal playout)
const g = new Chess()
for (let i = 0; i < 32; i++) {
  const ms = g.moves()
  if (!ms.length || g.isGameOver()) break
  g.move(ms[Math.floor(Math.random() * ms.length)])
}
console.log('ply:', g.history().length)

for (const depth of [1, 2, 3]) {
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    pickAiMove(g, depth)
    console.log(`depth ${depth}: ${Date.now() - t0} ms`)
  }
}
