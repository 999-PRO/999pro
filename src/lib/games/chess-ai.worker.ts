// ============================================================================
// v25.26 — Web Worker шахматного ИИ. Поиск minimax выполняется ВНЕ главного
// потока — интерфейс (доска, кнопки, индикатор «Компьютер думает…») больше
// не замирает на время расчёта.
// ============================================================================

import { pickBestMove, type ChessAiMove, type ChessAiRequest } from './chess-engine'

self.onmessage = (e: MessageEvent) => {
  const req = e.data as ChessAiRequest
  try {
    const move: ChessAiMove | null = pickBestMove(req.fen, req.level)
    ;(self as unknown as Worker).postMessage({ ok: true, move })
  } catch {
    ;(self as unknown as Worker).postMessage({ ok: false, move: null })
  }
}
