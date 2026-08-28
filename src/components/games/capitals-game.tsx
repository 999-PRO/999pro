'use client'

// v25.23 — «Угадай столицу»: два типа вопросов — страна → столица и
// столица → страна. Банк: 197 стран (src/lib/games/countries.ts).

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

function optionsFor(answerIdx: number, pool: string[]): [string, string, string, string] {
  const answer = pool[answerIdx]
  const distract = sample(pool.filter((v) => v !== answer), 3)
  const four = [...distract, answer]
  for (let i = four.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[four[i], four[j]] = [four[j], four[i]]
  }
  return four as [string, string, string, string]
}

function makeRound(): QuizQ[] {
  const picked = sample(COUNTRIES, RUN)
  return picked.map((c, i) => {
    const reverse = i % 2 === 1 // каждый второй — наоборот
    if (reverse) {
      const opts = optionsFor(COUNTRIES.findIndex((x) => x.code === c.code), COUNTRIES.map((x) => x.name))
      return {
        prompt: `Какая страна со столицей ${c.capital}?`,
        sub: 'Выберите страну',
        options: opts,
        correct: opts.indexOf(c.name),
        flagCode: c.code,
      }
    }
    const opts = optionsFor(i, picked.map((x) => x.capital))
    // indexOf может быть неточным при дублях — используем честный поиск
    const correct = opts.indexOf(c.capital)
    return {
      prompt: `Какой город — столица ${c.name}?`,
      sub: 'Выберите столицу',
      options: opts,
      correct: correct === -1 ? 0 : correct,
      flagCode: c.code,
    }
  })
}

export function CapitalsGame() {
  const make = useCallback(() => makeRound(), [])
  return (
    <QuizRun
      id="capitals"
      title="Угадай столицу"
      emoji="🏙️"
      accent="#0EA5E9"
      desc="197 стран: то спрашиваем столицу, то страну по столице. Проверь свои знания географии!"
      questionsPerRun={RUN}
      timePerQuestion={15}
      makeQuestions={make}
    />
  )
}
