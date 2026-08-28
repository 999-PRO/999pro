/* Benchmark: SAN-notation vs object-notation moves in minimax */
const { Chess } = require('/home/z/my-project/node_modules/chess.js')

function bench(useObjectNotation) {
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
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
  function orderMoves(moves) {
    return [...moves].sort((a, b) => (b.captured ? VAL[b.captured] * 100 : 0) - (a.captured ? VAL[a.captured] * 100 : 0))
  }
  function minimax(game, depth, alpha, beta, maximizing, aiColor) {
    if (game.isCheckmate()) return game.turn() === aiColor ? -99000 - depth : 99000 + depth
    if (game.isDraw() || game.isStalemate() || depth === 0) return evaluate(game, aiColor)
    const moves = orderMoves(game.moves({ verbose: true }))
    if (maximizing) {
      let bestV = -Infinity
      for (const m of moves) {
        game.move(useObjectNotation ? { from: m.from, to: m.to, promotion: m.promotion } : m.san)
        const v = minimax(game, depth - 1, alpha, beta, false, aiColor)
        game.undo()
        if (v > bestV) bestV = v
        if (v > alpha) alpha = v
        if (beta <= alpha) break
      }
      return bestV
    }
    let bestV = Infinity
    for (const m of moves) {
      game.move(useObjectNotation ? { from: m.from, to: m.to, promotion: m.promotion } : m.san)
      const v = minimax(game, depth - 1, alpha, beta, true, aiColor)
      game.undo()
      if (v < bestV) bestV = v
      if (v < beta) beta = v
      if (beta <= alpha) break
    }
    return bestV
  }

  const g = new Chess()
  for (let i = 0; i < 32; i++) {
    const ms = g.moves()
    if (!ms.length || g.isGameOver()) break
    g.move(ms[Math.floor(Math.random() * ms.length)])
  }
  // skip if game over-ish
  if (g.isGameOver()) return bench(useObjectNotation)

  const t0 = Date.now()
  const moves = orderMoves(g.moves({ verbose: true }))
  const aiColor = g.turn()
  for (const m of moves) {
    g.move(useObjectNotation ? { from: m.from, to: m.to, promotion: m.promotion } : m.san)
    minimax(g, 2, -Infinity, Infinity, false, aiColor)
    g.undo()
  }
  return Date.now() - t0
}

for (let i = 0; i < 2; i++) {
  console.log('SAN   depth3 total:', bench(false), 'ms')
  console.log('OBJ   depth3 total:', bench(true), 'ms')
}
