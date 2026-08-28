// v25.23 — рекорды игр в localStorage (общий namespace «999pro-game-best:<id>»).

import { useCallback, useEffect, useState } from 'react'

const key = (id: string) => `999pro-game-best:${id}`

export function getBest(id: string): number {
  if (typeof window === 'undefined') return 0
  try {
    return Number(window.localStorage.getItem(key(id)) || '0') || 0
  } catch {
    return 0
  }
}

/** Сохраняет результат. Возвращает true, если это новый рекорд. */
export function saveBest(id: string, score: number): boolean {
  if (score <= 0) return false
  try {
    const prev = getBest(id)
    if (score > prev) {
      window.localStorage.setItem(key(id), String(score))
      window.dispatchEvent(new CustomEvent('999pro:game-best', { detail: { id, score } }))
      return true
    }
  } catch {}
  return false
}

/** React-хук: лучший результат + функция сохранения. */
export function useBest(id: string): [number, (score: number) => boolean] {
  const [best, setBest] = useState(0)

  useEffect(() => {
    setBest(getBest(id))
    const onBest = (e: Event) => {
      const d = (e as CustomEvent).detail as { id?: string; score?: number }
      if (d?.id === id) setBest(d.score || 0)
    }
    window.addEventListener('999pro:game-best', onBest as EventListener)
    return () => window.removeEventListener('999pro:game-best', onBest as EventListener)
  }, [id])

  const submit = useCallback(
    (score: number) => {
      const isRecord = saveBest(id, score)
      if (isRecord) setBest(score)
      return isRecord
    },
    [id],
  )

  return [best, submit]
}
