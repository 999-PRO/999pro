'use client'

// v25.23 — «Угадай флаг»: показываем SVG-флаг (public/flags/4x3), 4 варианта.
// Банк: 197 стран (src/lib/games/countries.ts) — вопросов практически бесконечно.

import { useCallback } from 'react'
import { QuizRun, type QuizQ } from './quiz-run'
import { COUNTRIES } from '@/lib/games/countries'

function sample<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

const RUN = 12

function makeRound(): QuizQ[] {
  const picked = sample(COUNTRIES, RUN)
  return picked.map((answer) => {
    // 3 дистрактора из оставшихся стран
    const distract = sample(
      COUNTRIES.filter((c) => c.code !== answer.code),
      3,
    )
    const four = [...distract, answer]
    // перемешиваем позиции
    for (let i = four.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[four[i], four[j]] = [four[j], four[i]]
    }
    return {
      prompt: 'Какой стране принадлежит этот флаг?',
      options: four.map((c) => c.name) as [string, string, string, string],
      correct: four.findIndex((c) => c.code === answer.code),
      flagCode: answer.code,
    }
  })
}

export function FlagsGame() {
  const make = useCallback(() => makeRound(), [])
  return (
    <QuizRun
      id="flags"
      title="Угадай флаг"
      emoji="🚩"
      accent="#F43F5E"
      desc="197 флагов мира. Смотри на флаг — выбирай страну. Бонус за быстрый ответ и серии!"
      questionsPerRun={RUN}
      timePerQuestion={15}
      makeQuestions={make}
    />
  )
}
