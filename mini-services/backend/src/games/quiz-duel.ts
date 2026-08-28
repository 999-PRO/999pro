// ============================================================================
// v25.25 — СЕРВЕРНЫЕ ДУЭЛИ-ВИКТОРИНЫ: генераторы вопросов.
// Банки — в quiz-banks.ts (сгенерированы из данных фронтенда).
// Оба игрока получают ОДИНАКОВЫЙ набор вопросов, ответы хранит сервер.
// ----------------------------------------------------------------------------

import { BANK_COUNTRIES, BANK_MILLIONAIRE } from './quiz-banks.js'

export type QuizDuelType = 'quiz-flags' | 'quiz-capitals' | 'quiz-millionaire' | 'quiz-math'

export const QUIZ_DUEL_TYPES: QuizDuelType[] = ['quiz-flags', 'quiz-capitals', 'quiz-millionaire', 'quiz-math']

export const QUIZ_DUEL_META: Record<QuizDuelType, { title: string; emoji: string; accent: string; questions: number }> = {
  'quiz-flags': { title: 'Флаги · онлайн', emoji: '🚩', accent: '#F43F5E', questions: 7 },
  'quiz-capitals': { title: 'Столицы · онлайн', emoji: '🏙️', accent: '#0EA5E9', questions: 7 },
  'quiz-millionaire': { title: 'Миллионер · онлайн', emoji: '💰', accent: '#F59E0B', questions: 7 },
  'quiz-math': { title: 'Математика · онлайн', emoji: '🧮', accent: '#10B981', questions: 7 },
}

export interface QuizDuelQuestion {
  prompt: string
  sub?: string
  options: [string, string, string, string]
  correct: number
  flagCode?: string
}

export interface QuizDuelState {
  qs: QuizDuelQuestion[]
  /** сколько вопросов отработано */
  idx: number
  /** ответы player1/player2 по индексу вопроса (null = просрочено/неверно) */
  a1: (number | null)[]
  a2: (number | null)[]
  finished: boolean
}

function shuffle<T>(arr: readonly T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function fourOptions(correct: string, pool: string[]): [string, string, string, string] {
  const distract = shuffle(pool.filter((v) => v !== correct)).slice(0, 3)
  const four = shuffle([...distract, correct])
  return four as [string, string, string, string]
}

function pos(four: [string, string, string, string], value: string): number {
  return four.indexOf(value)
}

function genFlags(n: number): QuizDuelQuestion[] {
  const picked = shuffle(BANK_COUNTRIES).slice(0, n)
  const names = BANK_COUNTRIES.map((c) => c.name)
  return picked.map((c) => {
    const four = fourOptions(c.name, names)
    return { prompt: 'Какой стране принадлежит этот флаг?', options: four, correct: pos(four, c.name), flagCode: c.code }
  })
}

function genCapitals(n: number): QuizDuelQuestion[] {
  const picked = shuffle(BANK_COUNTRIES).slice(0, n)
  const names = BANK_COUNTRIES.map((c) => c.name)
  const capitals = BANK_COUNTRIES.map((c) => c.capital)
  return picked.map((c, i) => {
    if (i % 2 === 0) {
      const four = fourOptions(c.capital, capitals)
      return { prompt: `Какая столица у страны «${c.name}»?`, options: four, correct: pos(four, c.capital) }
    }
    const four = fourOptions(c.name, names)
    return { prompt: `Какая страна со столицей ${c.capital}?`, sub: 'Выберите страну', options: four, correct: pos(four, c.name) }
  })
}

function genMillionaire(n: number): QuizDuelQuestion[] {
  const d1 = shuffle(BANK_MILLIONAIRE.filter((q) => q.d === 1)).slice(0, 2)
  const d2 = shuffle(BANK_MILLIONAIRE.filter((q) => q.d === 2)).slice(0, 2)
  const d3 = shuffle(BANK_MILLIONAIRE.filter((q) => q.d === 3)).slice(0, n)
  const picked = [...d1, ...d2, ...d3].slice(0, n)
  return picked.map((q) => ({
    prompt: q.q,
    options: [...q.a] as [string, string, string, string],
    correct: q.c,
  }))
}

const MATH_EMOJI = ['🍎', '🎈', '⭐', '🍓', '🐥', '🚗', '🌸', '🐟']

function countOut(n: number, emoji: string): string {
  return emoji.repeat(Math.max(1, Math.min(10, n)))
}

function genMath(n: number): QuizDuelQuestion[] {
  const out: QuizDuelQuestion[] = []
  for (let i = 0; i < n; i++) {
    const kind = i % 3
    if (kind === 0) {
      // считать предметы
      const emoji = MATH_EMOJI[Math.floor(Math.random() * MATH_EMOJI.length)]
      const a = 2 + Math.floor(Math.random() * 7)
      const b = 1 + Math.floor(Math.random() * 4)
      const total = a + b
      const wrong1 = Math.max(1, total + (Math.random() < 0.5 ? 1 : -1))
      const wrong2 = Math.max(1, total + (Math.random() < 0.5 ? 2 : -2))
      const four = fourOptions(String(total), [String(wrong1), String(wrong2), String(total + 3)])
      out.push({
        prompt: `Сколько всего?  ${countOut(a, emoji)} и ${countOut(b, emoji)}`,
        sub: 'Сложи предметы',
        options: four,
        correct: pos(four, String(total)),
      })
    } else if (kind === 1) {
      // сложение или вычитание до 20
      const plus = Math.random() < 0.6
      const a = 6 + Math.floor(Math.random() * 13)
      const b = 1 + Math.floor(Math.random() * 8)
      const res = plus ? a + b : Math.max(a, b) - Math.min(a, b)
      const big = Math.max(a, b)
      const small = Math.min(a, b)
      const four = fourOptions(String(res), [String(res + 1), String(res - 1 >= 0 ? res - 1 : res + 2), String(res + 3)])
      out.push({
        prompt: plus ? `${a} + ${b} = ?` : `${big} − ${small} = ?`,
        options: four,
        correct: pos(four, String(res)),
      })
    } else {
      // умножение таблицы (лёгкое) для школьников
      const a = 2 + Math.floor(Math.random() * 8)
      const b = 2 + Math.floor(Math.random() * 8)
      const res = a * b
      const four = fourOptions(String(res), [String(res + a), String(res - b >= 0 ? res - b : res + b), String(a + b)])
      out.push({ prompt: `${a} × ${b} = ?`, options: four, correct: pos(four, String(res)) })
    }
  }
  return out
}

export function genQuizQuestions(type: QuizDuelType): QuizDuelState {
  const n = QUIZ_DUEL_META[type].questions
  const qs =
    type === 'quiz-flags' ? genFlags(n)
    : type === 'quiz-capitals' ? genCapitals(n)
    : type === 'quiz-millionaire' ? genMillionaire(n)
    : genMath(n)
  return { qs, idx: 0, a1: [], a2: [], finished: false }
}

/** Сколько правильных ответов у игрока. */
export function quizScore(st: QuizDuelState, who: 'a1' | 'a2'): number {
  const arr = st[who]
  let n = 0
  for (let i = 0; i < st.qs.length; i++) if (arr[i] != null && arr[i] === st.qs[i].correct) n++
  return n
}

export function quizIsFinished(st: QuizDuelState): boolean {
  return st.idx >= st.qs.length
}
