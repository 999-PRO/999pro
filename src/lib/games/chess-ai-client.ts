// ============================================================================
// v25.26 — Клиент шахматного ИИ: Web Worker + синхронный фолбэк.
//   • getAiMove(fen, level) → Promise<ChessAiMove | null>
//   • Worker создаётся один раз (ленивый синглтон). Если конструкция
//     недоступна (старый браузер/СSR-особенность) — считаем синхронно на
//     главном потоке (движок тот же, с дедлайном).
// ============================================================================

import { pickBestMove, type ChessAiMove, type ChessAiRequest } from './chess-engine'

let worker: Worker | null = null
let workerBroken = false
let seq = 0
const pending = new Map<number, { resolve: (m: ChessAiMove | null) => void; timer: number }>()

function ensureWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    workerBroken = true
    return null
  }
  try {
    worker = new Worker(new URL('./chess-ai.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const { id, move } = e.data || {}
      const p = pending.get(id)
      if (!p) return
      window.clearTimeout(p.timer)
      pending.delete(id)
      p.resolve((move as ChessAiMove | null) ?? null)
    }
    worker.onerror = () => {
      // Деградация: все ожидающие запросы резолвим null → вызывающий код
      // пересчитает синхронно; новые запросы пойдут в sync-ветку.
      workerBroken = true
      for (const [id, p] of pending) {
        window.clearTimeout(p.timer)
        p.resolve(null)
      }
      pending.clear()
      try { worker?.terminate() } catch {}
      worker = null
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

/** Ход ИИ: асинхронно, не блокируя UI. null — нет ходов/ошибка. */
export function getAiMove(fen: string, level: 1 | 2 | 3, budgetMs?: number): Promise<ChessAiMove | null> {
  const w = ensureWorker()
  if (!w) {
    // синхронный фолбэк (движок сам соблюдает дедлайн)
    return new Promise((resolve) => {
      // микро-задержка, чтобы React успел отрисовать индикатор «думает»
      window.setTimeout(() => resolve(pickBestMove(fen, level)), 30)
    })
  }
  const id = ++seq
  return new Promise<ChessAiMove | null>((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      // Worker не ответил в срок — резолвим null, вызывающий сделает sync-фолбэк
      resolve(null)
    }, (budgetMs ?? 4000) + 1500)
    pending.set(id, { resolve, timer })
    const req: ChessAiRequest & { id: number } = { fen, level, id }
    w.postMessage(req)
  })
}
