// ============================================================================
// v25.26 — Web Worker ИИ шашек. Поиск minimax α-β выполняется ВНЕ главного
// потока — интерфейс (доска, кнопки, счётчик шашек) больше не замирает на
// время расчёта (жалоба владельца: «игра останавливается/подлагивает»).
// ============================================================================

import { ckBestMove } from './checkers-ai'
import type { CkState, CkFullMove } from './checkers-core'

export interface CkAiRequest {
  id: number
  state: CkState
  level: 1 | 2 | 3
}

self.onmessage = (e: MessageEvent) => {
  const req = e.data as CkAiRequest
  try {
    const result = ckBestMove(req.state, req.level)
    // CkFullMove содержит state — он несериализуемо большой не нужен,
    // передаём только шаги (from/to/cap), восстановление не требуется.
    const move = result.move
      ? { steps: result.move.steps, score: result.score }
      : null
    ;(self as unknown as Worker).postMessage({ ok: true, move })
  } catch {
    ;(self as unknown as Worker).postMessage({ ok: false, move: null })
  }
}

// Экспорт типа только для клиента (в рантайме воркера не используется).
export type { CkFullMove }
