// ============================================================================
// v25.26 — Клиент ИИ шашек: Web Worker + синхронный фолбэк.
//   • getCheckersAiMove(state, level) → Promise<CkStep[] | null>
//   • Worker создаётся один раз (ленивый синглтон) — расчёт minimax не
//     блокирует главный поток, UI не «подлагивает».
//   • Если Worker недоступен — синхронный фолбэк (движок с потолком узлов).
// ============================================================================

import { ckApplyStep, type CkState, type CkStep } from './checkers-core'
import { ckBestMove } from './checkers-ai'
import type { CkAiRequest } from './checkers-ai.worker'

export type CkAiMoveSteps = CkStep[]

let worker: Worker | null = null
let workerBroken = false
let seq = 0
const pending = new Map<number, { resolve: (steps: CkAiMoveSteps | null) => void; timer: number }>()

function ensureWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    workerBroken = true
    return null
  }
  try {
    worker = new Worker(new URL('./checkers-ai.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const { id, move } = e.data || {}
      const p = pending.get(id)
      if (!p) return
      window.clearTimeout(p.timer)
      pending.delete(id)
      p.resolve((move as { steps: CkAiMoveSteps } | null)?.steps ?? null)
    }
    worker.onerror = () => {
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

/** Ход ИИ шашек: асинхронно, не блокируя UI. null — нет ходов/ошибка. */
export function getCheckersAiMove(s: CkState, level: 1 | 2 | 3): Promise<CkAiMoveSteps | null> {
  const w = ensureWorker()
  if (!w) {
    // синхронный фолбэк (потолок узлов внутри движка ограничивает время)
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(ckBestMove(s, level).move?.steps ?? null), 30)
    })
  }
  const id = ++seq
  return new Promise<CkAiMoveSteps | null>((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, 6000)
    pending.set(id, { resolve, timer })
    const req: CkAiRequest & { id: number } = { id, state: s, level }
    w.postMessage(req)
  })
}

/** Применить список шагов к состоянию (для результата из воркера). */
export function applyCkSteps(start: CkState, steps: CkStep[]): CkState | null {
  let cur = start
  for (const step of steps) {
    const applied = ckApplyStep(cur, step)
    if (!applied) return null
    cur = applied
  }
  return cur
}
