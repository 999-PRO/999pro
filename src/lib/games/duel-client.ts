'use client'

// ============================================================================
// v25.24/v25.25 — клиент онлайн-дуэлей (создание из чата, ходы, состояние).
// ============================================================================

import { api } from '@/lib/api'

export interface DuelPlayer {
  id: string
  username: string
  displayName: string
  avatar: string | null
}

export type DuelGameType =
  | 'tictactoe'
  | 'nardi'
  | 'checkers'
  | 'chess'
  | 'quiz-flags'
  | 'quiz-capitals'
  | 'quiz-millionaire'
  | 'quiz-math'

export interface DuelTttState {
  board: Array<'x' | 'o' | null>
  turn: 'x' | 'o'
  winner: 'x' | 'o' | 'draw' | null
  line: number[] | null
}

export interface DuelNardiState {
  points: number[]
  bar: { w: number; b: number }
  off: { w: number; b: number }
  turn: 'w' | 'b'
  dice: number[]
  lastDice: number[]
  winner: 'w' | 'b' | null
}

export interface DuelQuizState {
  qs: Array<{
    prompt: string
    sub?: string
    options: [string, string, string, string]
    correct: number
    flagCode?: string
  }>
  idx: number
  a1: (number | null)[]
  a2: (number | null)[]
  finished: boolean
}

export interface DuelChessState {
  fen: string
  p1Side: 'w' | 'b'
  history: Array<{ from: string; to: string; san: string; captured: string | null }>
}

export type DuelState = DuelTttState | DuelNardiState | DuelQuizState | DuelChessState | Record<string, never>

export interface Duel {
  id: string
  gameType: DuelGameType
  status: 'pending' | 'active' | 'finished' | 'declined' | 'cancelled'
  state: DuelState
  turnUserId: string | null
  winnerId: string | null
  player1Id: string
  player2Id: string
  player1: DuelPlayer
  player2: DuelPlayer
  conversationId: string | null
  lastMoveAt: string
  createdAt: string
}

export interface DuelMovePayload {
  // крестики / нарды / шашки
  cell?: number
  from?: number
  to?: number
  die?: number
  pass?: boolean
  // шахматы
  fromSq?: number
  toSq?: number
  promo?: 'q' | 'r' | 'b' | 'n'
  // викторины
  qi?: number
  choice?: number
}

export const duelApi = {
  create: (gameType: DuelGameType, opponentId: string, conversationId?: string | null) =>
    api.post<{ duel: Duel }>('/api/game-duels', { json: { gameType, opponentId, conversationId }, auth: true }),

  get: (id: string) => api.get<{ duel: Duel }>(`/api/game-duels/${id}`, { auth: true }),

  accept: (id: string) => api.post<{ duel: Duel }>(`/api/game-duels/${id}/accept`, { auth: true }),

  decline: (id: string) => api.post<{ ok: boolean }>(`/api/game-duels/${id}/decline`, { auth: true }),

  cancel: (id: string) => api.post<{ ok: boolean }>(`/api/game-duels/${id}/cancel`, { auth: true }),

  move: (id: string, move: DuelMovePayload) => api.post<{ ok: boolean }>(`/api/game-duels/${id}/move`, { json: move, auth: true }),

  resign: (id: string) => api.post<{ ok: boolean }>(`/api/game-duels/${id}/resign`, { auth: true }),
}

/** Открыть онлайн-дуэль из любого места приложения. */
export function openDuel(duelId: string) {
  window.dispatchEvent(new CustomEvent('open-duel', { detail: { duelId } }))
}
