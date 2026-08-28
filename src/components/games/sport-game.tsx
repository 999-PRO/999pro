'use client'

// v25.23 — «Спорт-викторина»: 210 вопросов по 4 подкатегориям
// (футбол / бои MMA и бокс / олимпиада / легенды спорта) — выбор на старт-экране.

import { useCallback, useState } from 'react'
import { QuizRun, type QuizQ } from './quiz-run'
import { SPORT_QUESTIONS, SPORT_CATEGORY_META, type SportCategory } from '@/lib/games/quiz-sport'

function shuffle<T>(arr: readonly T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const RUN = 12

export function SportGame() {
  const [cat, setCat] = useState<SportCategory | 'all'>('all')

  const make = useCallback((): QuizQ[] => {
    const pool = shuffle(cat === 'all' ? SPORT_QUESTIONS : SPORT_QUESTIONS.filter((q) => q.cat === cat)).slice(0, RUN)
    return pool.map((q) => {
      // перемешиваем варианты (правильный ответ не всегда на одном месте)
      const order = shuffle([0, 1, 2, 3])
      return {
        prompt: q.q,
        options: order.map((i) => q.a[i]) as [string, string, string, string],
        correct: order.indexOf(q.c),
      }
    })
  }, [cat])

  return (
    <QuizRun
      id="sport"
      title="Спорт-викторина"
      emoji="🏆"
      accent="#22C55E"
      desc="Футбол, MMA и бокс, Олимпиада, легенды спорта — выбирай тему и проверяй знания!"
      questionsPerRun={RUN}
      timePerQuestion={15}
      makeQuestions={make}
      extraStart={(start) => (
        <div className="flex flex-wrap justify-center gap-2 max-w-md">
          {SPORT_CATEGORY_META.map((m) => {
            const active = cat === m.id
            return (
              <button
                key={m.id}
                onClick={() => setCat(m.id)}
                className={[
                  'h-10 px-4 rounded-full text-sm font-bold border transition-all active:scale-95 inline-flex items-center gap-1.5',
                  active ? 'text-white' : 'text-[var(--g-fg-soft)] border-[var(--g-chip-border)] bg-[var(--g-btn)] hover:bg-white/[0.1]',
                ].join(' ')}
                style={
                  active
                    ? { background: 'linear-gradient(135deg,#22C55E,#16A34A)', borderColor: 'rgba(34,197,94,0.6)', boxShadow: '0 10px 24px -10px rgba(34,197,94,0.6)' }
                    : undefined
                }
              >
                <span>{m.emoji}</span> {m.name}
              </button>
            )
          })}
          <span className="sr-only">Выбранная тема влияет на следующий забег</span>
          {/* старт доступен основной кнопкой; enter-хинт для десктопа */}
          <button onClick={start} className="sr-only">Начать</button>
        </div>
      )}
    />
  )
}
