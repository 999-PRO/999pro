// Генератор банка вопросов для СЕРВЕРНЫХ дуэлей-викторин.
// Импортирует данные из фронтенда и пишет backend/src/games/quiz-banks.ts,
// чтобы сервер сам генерировал вопросы (оба игрока видят одинаковые).
// Запуск: npx tsx scripts/gen-quiz-banks.ts (из корня проекта)
import { writeFileSync } from 'node:fs'
import { COUNTRIES } from '../src/lib/games/countries'
import { MILLIONAIRE_QUESTIONS } from '../src/lib/games/quiz-millionaire'

const header = `// ============================================================================
// v25.25 — БАНКИ ВОПРОСОВ ДЛЯ ОНЛАЙН-ДУЭЛЕЙ-ВИКТОРИН (сервер-авторитетные).
// СГЕНЕРИРОВАНО скриптом scripts/gen-quiz-banks.ts из данных фронтенда
// (src/lib/games/countries.ts и src/lib/games/quiz-millionaire.ts).
// НЕ редактировать вручную — перегенерировать скриптом.
// ============================================================================

export interface BankCountry { code: string; name: string; capital: string }
export interface BankMillionaire { q: string; a: [string, string, string, string]; c: number; d: 1 | 2 | 3 }

export const BANK_COUNTRIES: BankCountry[] = ${JSON.stringify(COUNTRIES)}

export const BANK_MILLIONAIRE: BankMillionaire[] = ${JSON.stringify(MILLIONAIRE_QUESTIONS)}
`

writeFileSync(new URL('../mini-services/backend/src/games/quiz-banks.ts', import.meta.url), header)
console.log('quiz-banks.ts written:', COUNTRIES.length, 'countries,', MILLIONAIRE_QUESTIONS.length, 'millionaire questions')
