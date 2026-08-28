'use client'

// ============================================================================
// v25.24 — ИГРОВОЙ КЛУБ TRI999 2.0: хаб раздела «Игры» (редизайн).
//   • Секции: Онлайн · Аркада · Викторины · Логика · Детские — 15 игр.
//   • Яркие авторские SVG-обложки у каждой игры (вместо «чёрных карточек»).
//   • Фиксы макета: контент не уезжает под шапку (page-top-padding) и под
//     нижнюю навигацию (safe-area padding снизу).
//   • Каждая игра — полноэкранный GameShell (тема: светлая и тёмная).
//   • Онлайн-дуэли создаются из чата (кнопка 🎮 в чате).
// ============================================================================

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { Gamepad2, Sparkles, X, MessagesSquare } from 'lucide-react'
import { GameShell } from './game-shell'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

const MillionaireGame = dynamic(() => import('./millionaire-game').then((m) => m.MillionaireGame), { ssr: false })
const FlagsGame = dynamic(() => import('./flags-game').then((m) => m.FlagsGame), { ssr: false })
const CapitalsGame = dynamic(() => import('./capitals-game').then((m) => m.CapitalsGame), { ssr: false })
const SportGame = dynamic(() => import('./sport-game').then((m) => m.SportGame), { ssr: false })
const WordsGame = dynamic(() => import('./words-game').then((m) => m.WordsGame), { ssr: false })
const ChessGame = dynamic(() => import('./chess-game').then((m) => m.ChessGame), { ssr: false })
const TetrisGame = dynamic(() => import('./tetris-game').then((m) => m.TetrisGame), { ssr: false })
const RunnerGame = dynamic(() => import('./runner-game').then((m) => m.RunnerGame), { ssr: false })
const CheckersGame = dynamic(() => import('./checkers-game').then((m) => m.CheckersGame), { ssr: false })
const ColoringGame = dynamic(() => import('./coloring-game').then((m) => m.ColoringGame), { ssr: false })
const MemoryGame = dynamic(() => import('./memory-game').then((m) => m.MemoryGame), { ssr: false })
const BubblesGame = dynamic(() => import('./bubbles-game').then((m) => m.BubblesGame), { ssr: false })
const FieldWondersGame = dynamic(() => import('./field-wonders-game').then((m) => m.FieldWondersGame), { ssr: false })
const TanksGame = dynamic(() => import('./tanks-game').then((m) => m.TanksGame), { ssr: false })
const DoodleGame = dynamic(() => import('./doodle-game').then((m) => m.DoodleGame), { ssr: false })
const LaneRunnerGame = dynamic(() => import('./lane-runner-game').then((m) => m.LaneRunnerGame), { ssr: false })
const KidsMathGame = dynamic(() => import('./kids-math-game').then((m) => m.KidsMathGame), { ssr: false })
const AzbukaGame = dynamic(() => import('./azbuka-game').then((m) => m.AzbukaGame), { ssr: false })

type SectionId = 'online' | 'arcade' | 'quiz' | 'logic' | 'kids'

interface GameDef {
  id: string
  title: string
  desc: string
  emoji: string
  accent: string
  section: SectionId
  Component?: React.ComponentType
}

const GAMES: GameDef[] = [
  // ---- ОНЛАЙН (из чата) ----
  { id: 'duel-checkers', title: 'Шашки онлайн', desc: 'Русские · партия с другом', emoji: '⚫', accent: '#B0722F', section: 'online' },
  { id: 'duel-chess', title: 'Шахматы онлайн', desc: 'До мата · из чата', emoji: '♟️', accent: '#8B5CF6', section: 'online' },
  { id: 'duel-tictactoe', title: 'Крестики-нолики', desc: 'Быстрая дуэль в чате', emoji: '⭕', accent: '#0EA5E9', section: 'online' },
  { id: 'duel-flags', title: 'Флаги онлайн', desc: 'Кто знает больше стран', emoji: '🚩', accent: '#F43F5E', section: 'online' },
  { id: 'duel-capitals', title: 'Столицы онлайн', desc: 'Географическая дуэль', emoji: '🏙️', accent: '#0EA5E9', section: 'online' },
  { id: 'duel-millionaire', title: 'Миллионер онлайн', desc: '7 вопросов · кто умнее', emoji: '💰', accent: '#F59E0B', section: 'online' },
  { id: 'duel-math', title: 'Математика онлайн', desc: 'Дуэль для школьников', emoji: '🧮', accent: '#10B981', section: 'online' },
  // ---- АРКАДА ----
  { id: 'runner', title: 'Супер-раннер', desc: 'Прыгай! Двойной прыжок', emoji: '🍄', accent: '#F97316', section: 'arcade', Component: RunnerGame },
  { id: 'doodle', title: 'Дудл-прыг', desc: 'Прыгай выше · платформы', emoji: '🎈', accent: '#A855F7', section: 'arcade', Component: DoodleGame },
  { id: 'lanes', title: 'Ночной забег', desc: '3 полосы · свайпы · монеты', emoji: '🌆', accent: '#22C55E', section: 'arcade', Component: LaneRunnerGame },
  { id: 'tanks', title: 'Танчики', desc: 'Волны врагов · взрывы', emoji: '🛡️', accent: '#84CC16', section: 'arcade', Component: TanksGame },
  { id: 'tetris', title: 'Тетрис', desc: 'Классика: собирай линии', emoji: '🧱', accent: '#22D3EE', section: 'arcade', Component: TetrisGame },
  // ---- ВИКТОРИНЫ ----
  { id: 'millionaire', title: 'Миллионер', desc: '15 вопросов · подсказки · миллион', emoji: '💰', accent: '#F59E0B', section: 'quiz', Component: MillionaireGame },
  { id: 'flags', title: 'Угадай флаг', desc: '197 флагов мира', emoji: '🚩', accent: '#F43F5E', section: 'quiz', Component: FlagsGame },
  { id: 'capitals', title: 'Угадай столицу', desc: 'География: страны и столицы', emoji: '🏙️', accent: '#0EA5E9', section: 'quiz', Component: CapitalsGame },
  { id: 'sport', title: 'Спорт-викторина', desc: 'Футбол · MMA · Олимпиада', emoji: '🏆', accent: '#22C55E', section: 'quiz', Component: SportGame },
  { id: 'words', title: 'Угадай слово', desc: '225 слов с подсказками', emoji: '🔤', accent: '#A855F7', section: 'quiz', Component: WordsGame },
  { id: 'field', title: 'Поле чудес', desc: 'Крути барабан · угадывай буквы', emoji: '🎡', accent: '#EC4899', section: 'quiz', Component: FieldWondersGame },
  // ---- ЛОГИКА ----
  { id: 'chess', title: 'Шахматы', desc: 'Партия против компьютера', emoji: '♟️', accent: '#8B5CF6', section: 'logic', Component: ChessGame },
  { id: 'checkers', title: 'Шашки', desc: 'Русские · против ИИ', emoji: '⚫', accent: '#B0722F', section: 'logic', Component: CheckersGame },
  // ---- ДЕТСКИЕ ----
  { id: 'coloring', title: 'Раскраска', desc: '12 картинок для девочек и мальчиков', emoji: '🎨', accent: '#EC4899', section: 'kids', Component: ColoringGame },
  { id: 'memory', title: 'Найди пару', desc: 'Зверята · для мальчиков и девочек', emoji: '🐣', accent: '#10B981', section: 'kids', Component: MemoryGame },
  { id: 'bubbles', title: 'Пузыри', desc: 'Лопай шарики!', emoji: '🫧', accent: '#38BDF8', section: 'kids', Component: BubblesGame },
  { id: 'kids-math', title: 'Детская математика', desc: 'Считай ягодки и звёздочки', emoji: '🍓', accent: '#FB7185', section: 'kids', Component: KidsMathGame },
  { id: 'azbuka', title: 'Азбука', desc: 'Учим буквы со звуком', emoji: '🔤', accent: '#F59E0B', section: 'kids', Component: AzbukaGame },
]

const SECTIONS: { id: SectionId; name: string; emoji: string; hint: string }[] = [
  { id: 'online', name: 'Онлайн', emoji: '🌐', hint: '7 игр с друзьями прямо из чата' },
  { id: 'arcade', name: 'Аркада', emoji: '🕹️', hint: 'Динамичные игры на реакцию' },
  { id: 'quiz', name: 'Викторины', emoji: '🧠', hint: 'Проверь свои знания' },
  { id: 'logic', name: 'Логика', emoji: '♟️', hint: 'Для терпеливых стратегов' },
  { id: 'kids', name: 'Детские', emoji: '🧸', hint: 'Для девочек и мальчиков' },
]

/* ---------------- Авторские SVG-обложки ---------------- */

function GameArt({ id, accent }: { id: string; accent: string }) {
  const common = 'absolute inset-0 h-full w-full'
  switch (id) {
    case 'duel-checkers':
    case 'checkers':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#5D3A1E" />
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              {Array.from({ length: 6 }).map((_, j) => {
                const dark = (i + j) % 2 === 1
                return <rect key={j} x={i * 24 + (j % 2 ? 0 : 0)} y={j * 13} width="24" height="13" fill={dark ? '#8A5A28' : '#C89A5F'} />
              })}
            </g>
          ))}
          <circle cx="42" cy="52" r="9" fill="#F3E3C6" stroke="#3d2611" strokeWidth="1.5" />
          <circle cx="42" cy="51" r="5.5" fill="none" stroke="#B8A67E" strokeWidth="1.2" />
          <path d="M36 52 L36 48.5 L38.5 51 L42 46.5 L45.5 51 L48 48.5 L48 52 Z" fill="#D9A93B" />
          <circle cx="78" cy="26" r="9" fill="#2E2B27" stroke="#111" strokeWidth="1.5" />
          <circle cx="78" cy="25" r="5.5" fill="none" stroke="#555" strokeWidth="1.2" />
        </svg>
      )
    case 'duel-tictactoe':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#0C4A6E" />
          {[1, 2].map((i) => (
            <g key={i}>
              <line x1={i * 40} y1="8" x2={i * 40} y2="70" stroke="#7DD3FC" strokeWidth="3" strokeLinecap="round" />
              <line x1="20" y1={i * 24} x2="100" y2={i * 24} stroke="#7DD3FC" strokeWidth="3" strokeLinecap="round" />
            </g>
          ))}
          <path d="M26 14 L34 22 M34 14 L26 22" stroke="#38BDF8" strokeWidth="5" strokeLinecap="round" />
          <circle cx="60" cy="34" r="7" fill="none" stroke="#F472B6" strokeWidth="5" />
          <path d="M86 58 L94 66 M94 58 L86 66" stroke="#38BDF8" strokeWidth="5" strokeLinecap="round" />
        </svg>
      )
    case 'runner':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#7DD3FC" />
          <circle cx="98" cy="14" r="8" fill="#FEF08A" />
          <rect y="56" width="120" height="22" fill="#65A30D" />
          <ellipse cx="30" cy="60" rx="26" ry="10" fill="#84CC16" />
          <circle cx="52" cy="34" r="7" fill="#F97316" />
          <circle cx="52" cy="26" r="4.5" fill="#FDE68A" />
          <rect x="46" y="38" width="12" height="12" rx="2" fill="#DC2626" />
          <circle cx="50" cy="44" r="1.6" fill="#fff" />
          <circle cx="55" cy="44" r="1.6" fill="#fff" />
          <circle cx="80" cy="62" r="4" fill="#FACC15" stroke="#CA8A04" />
          <rect x="79" y="58" width="2" height="3" fill="#CA8A04" />
        </svg>
      )
    case 'tetris':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#164E63" />
          {[
            [8, 54, '#22D3EE'], [26, 54, '#22D3EE'], [44, 54, '#22D3EE'], [26, 36, '#22D3EE'],
            [62, 54, '#F472B6'], [62, 36, '#F472B6'], [80, 54, '#F472B6'],
            [98, 54, '#FACC15'], [98, 36, '#FACC15'], [98, 18, '#FACC15'], [80, 36, '#A78BFA'],
          ].map(([x, y, c], i) => (
            <rect key={i} x={x as number} y={y as number} width="16" height="16" rx="3" fill={c as string} stroke="rgba(255,255,255,0.35)" />
          ))}
        </svg>
      )
    case 'duel-millionaire':
    case 'millionaire':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#1E1B4B" />
          <path d="M40 34 C28 44 26 62 38 68 C46 72 66 72 74 68 C86 62 84 44 72 34 C64 40 48 40 40 34 Z" fill="#F59E0B" />
          <path d="M46 34 L66 34 L60 24 L52 24 Z" fill="#FCD34D" />
          <path d="M48 46 L52 58 L60 58 L64 46" stroke="#92400E" strokeWidth="3" fill="none" strokeLinecap="round" />
          <text x="56" y="66" textAnchor="middle" fontSize="10" fontWeight="900" fill="#78350F">$</text>
          <rect x="86" y="30" width="20" height="20" rx="4" transform="rotate(45 96 40)" fill="#67E8F9" />
          <rect x="89" y="33" width="14" height="14" rx="3" transform="rotate(45 96 40)" fill="#CFFAFE" />
        </svg>
      )
    case 'duel-flags':
    case 'flags':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#881337" />
          <path d="M24 14 L24 70 M24 14 C34 10 44 18 54 14 L54 32 C44 36 34 28 24 32 Z" fill="none" />
          <line x1="24" y1="12" x2="24" y2="70" stroke="#FECDD3" strokeWidth="3" strokeLinecap="round" />
          <path d="M26 14 C36 10 46 18 56 14 L56 32 C46 36 36 28 26 32 Z" fill="#38BDF8" />
          <line x1="60" y1="12" x2="60" y2="70" stroke="#FECDD3" strokeWidth="3" strokeLinecap="round" />
          <path d="M62 14 C72 10 82 18 92 14 L92 32 C82 36 72 28 62 32 Z" fill="#FACC15" />
          <circle cx="77" cy="23" r="5" fill="#16A34A" />
          <line x1="96" y1="12" x2="96" y2="70" stroke="#FECDD3" strokeWidth="3" strokeLinecap="round" />
          <path d="M98 14 C106 10 112 16 118 14 L118 32 C112 34 106 28 98 32 Z" fill="#F8FAFC" />
          <circle cx="108" cy="23" r="5" fill="#DC2626" />
        </svg>
      )
    case 'duel-capitals':
    case 'capitals':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#0C4A6E" />
          <circle cx="20" cy="16" r="7" fill="#FEF08A" />
          {[
            [10, 40, 14, 38, '#0369A1'], [28, 30, 12, 48, '#0284C7'], [44, 44, 10, 34, '#0369A1'],
            [58, 22, 14, 56, '#0EA5E9'], [76, 36, 12, 42, '#0284C7'], [92, 46, 12, 32, '#0369A1'], [106, 28, 10, 50, '#0284C7'],
          ].map(([x, y, w, h, c], i) => (
            <g key={i}>
              <rect x={x as number} y={y as number} width={w as number} height={h as number} rx="1.5" fill={c as string} />
              {(Array.from({ length: Math.floor((h as number) / 10) }).map((_, r) => (
                <rect key={r} x={(x as number) + 3} y={(y as number) + 4 + r * 10} width={Math.max((w as number) - 6, 3)} height="4" fill="#BAE6FD" opacity="0.8" />
              )))}
            </g>
          ))}
        </svg>
      )
    case 'sport':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#14532D" />
          <circle cx="60" cy="39" r="22" fill="#F8FAFC" />
          <polygon points="60,26 66,31 64,39 56,39 54,31" fill="#111" />
          <path d="M54 39 L44 35 M54 39 L46 46 M66 39 L76 35 M66 39 L74 46 M60 41 L60 51" stroke="#111" strokeWidth="2.5" />
          <path d="M96 14 L96 40 L106 40 L104 52 L88 52 L86 40 L96 40 M84 52 L108 52" stroke="#FACC15" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="24" cy="56" r="9" fill="#EA580C" />
          <path d="M15 56 L33 56 M24 47 L24 65" stroke="#FFF7ED" strokeWidth="2.5" />
        </svg>
      )
    case 'duel-math':
    case 'kids-math':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#065F46" />
          {[...Array(7)].map((_, i) => (
            <circle key={i} cx={20 + i * 13} cy={30 + (i % 2) * 6} r="5" fill={i % 2 ? '#FB7185' : '#F87171'} stroke="#881337" strokeWidth="0.8" />
          ))}
          <text x="60" y="64" textAnchor="middle" fontSize="19" fontWeight="900" fill="#FFF">2 + 3 = ?</text>
        </svg>
      )
    case 'azbuka':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#B45309" />
          {['А', 'Б', 'В'].map((ch, i) => (
            <g key={ch}>
              <rect x={16 + i * 32} y="22" width="26" height="30" rx="7" fill="#FFF7ED" transform={`rotate(${i % 2 ? 4 : -4} ${29 + i * 32} 37)`} />
              <text x={29 + i * 32} y="45" textAnchor="middle" fontSize="21" fontWeight="900" fill={['#EA580C', '#2563EB', '#16A34A'][i]} transform={`rotate(${i % 2 ? 4 : -4} ${29 + i * 32} 37)`}>{ch}</text>
            </g>
          ))}
          <circle cx="98" cy="20" r="4" fill="#FDE68A" />
        </svg>
      )
    case 'tanks':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#1A2E05" />
          <rect y="60" width="120" height="18" fill="#3F6212" />
          <rect x="70" y="26" width="34" height="9" rx="2" fill="#4D7C0F" />
          <rect x="78" y="35" width="18" height="12" rx="3" fill="#65A30D" />
          <rect x="84" y="30" width="26" height="3.5" rx="1.5" fill="#365314" />
          <circle cx="82" cy="50" r="5" fill="#1A2E05" />
          <circle cx="92" cy="50" r="5" fill="#1A2E05" />
          <circle cx="30" cy="52" r="11" fill="#84CC16" />
          <path d="M30 41 L30 26" stroke="#4D7C0F" strokeWidth="4" strokeLinecap="round" />
          <circle cx="30" cy="52" r="5" fill="#A3E635" />
          <circle cx="102" cy="14" r="5" fill="#FDE047" />
          <path d="M102 4 L102 9 M110 14 L105 14 M102 24 L102 19 M94 14 L99 14" stroke="#FDE047" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'field':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#831843" />
          <circle cx="60" cy="40" r="30" fill="#FDF2F8" stroke="#F472B6" strokeWidth="3" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const a = (i * Math.PI) / 4
            return <path key={i} d={`M60 40 L${60 + 28 * Math.cos(a)} ${40 + 28 * Math.sin(a)} A28 28 0 0 1 ${60 + 28 * Math.cos(a + Math.PI / 4)} ${40 + 28 * Math.sin(a + Math.PI / 4)} Z`} fill={['#F472B6', '#FBBF24', '#34D399', '#38BDF8', '#A78BFA', '#FB923C', '#F87171', '#2DD4BF'][i]} opacity="0.85" />
          })}
          <circle cx="60" cy="40" r="9" fill="#500724" stroke="#F9A8D4" strokeWidth="2" />
          <text x="60" y="71" textAnchor="middle" fontSize="8" fontWeight="900" fill="#F9A8D4">100 · 500 · ПРИЗ</text>
        </svg>
      )
    case 'doodle':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#4C1D95" />
          {[[14, 58, 26], [70, 46, 30], [30, 30, 24], [86, 18, 26]].map(([x, y, w], i) => (
            <g key={i}>
              <rect x={x as number} y={y as number} width={w as number} height="6" rx="3" fill={i % 2 ? '#34D399' : '#A78BFA'} />
            </g>
          ))}
          <circle cx="60" cy="36" r="9" fill="#FDE047" stroke="#CA8A04" strokeWidth="1.5" />
          <circle cx="57" cy="34" r="1.4" fill="#713F12" />
          <circle cx="63" cy="34" r="1.4" fill="#713F12" />
          <path d="M56 40 Q60 43 64 40" stroke="#713F12" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M54 28 Q60 20 66 28" stroke="rgba(255,255,255,0.5)" strokeWidth="2" fill="none" />
          <circle cx="100" cy="62" r="6" fill="#F87171" />
          <path d="M94 62 L92 60 M94 62 L92 64 M106 62 L108 60 M106 62 L108 64" stroke="#7F1D1D" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'lanes':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#0F172A" />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={i * 40} y="0" width="40" height="78" fill={i === 1 ? '#1E293B' : '#0F172A'} />
          ))}
          {[14, 42, 70].map((y) => (
            <line key={y} x1="0" y1={y} x2="120" y2={y} stroke="#FACC15" strokeWidth="2" strokeDasharray="10 12" opacity="0.75" />
          ))}
          <rect x="46" y="40" width="28" height="20" rx="6" fill="#22C55E" />
          <rect x="50" y="43" width="20" height="8" rx="3" fill="#BBF7D0" opacity="0.9" />
          <rect x="10" y="8" width="20" height="14" rx="3" fill="#F43F5E" opacity="0.95" />
          <rect x="86" y="24" width="20" height="14" rx="3" fill="#38BDF8" opacity="0.95" />
          <circle cx="60" cy="66" r="4.5" fill="#FDE047" stroke="#CA8A04" />
          <circle cx="30" cy="70" r="3.5" fill="#FDE047" stroke="#CA8A04" />
        </svg>
      )
    case 'words':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#4C1D95" />
          {[
            [14, 22, 'А', '#22D3EE'], [40, 22, 'Р', '#34D399'], [66, 22, 'Б', '#FACC15'], [92, 22, 'У', '#F472B6'],
            [27, 44, 'З', '#FB923C'], [53, 44, 'А', '#A78BFA'], [79, 44, '!', '#F87171'],
          ].map(([x, y, ch, c], i) => (
            <g key={i}>
              <rect x={x as number} y={y as number} width="22" height="18" rx="4" fill="#FFFFFF" />
              <text x={(x as number) + 11} y={(y as number) + 14} textAnchor="middle" fontSize="13" fontWeight="900" fill={c as string}>{ch as string}</text>
            </g>
          ))}
        </svg>
      )
    case 'duel-chess':
    case 'chess':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#3B0764" />
          {Array.from({ length: 6 }).map((_, r) =>
            Array.from({ length: 9 }).map((_, c) => (
              <rect key={`${r}${c}`} x={c * 14 - 3} y={r * 14 - 3} width="14" height="14" fill={(r + c) % 2 ? '#A9713F' : '#EFDDBD'} />
            )),
          )}
          <g transform="translate(38 6) scale(0.62)">
            <path d="M35 84 C33 66 36 54 46 45 C41 43 36 45 31 51 C28 44 32 34 41 29 C45 21 54 15 62 18 L66 12 C69 17 71 22 70 28 C79 36 83 50 82 66 C81 74 78 80 74 84 Z" fill="#FBF7EF" stroke="#4A4038" strokeWidth="4" strokeLinejoin="round" />
            <circle cx="55" cy="30" r="2.6" fill="#4A4038" />
            <path d="M30 84 L74 84 L74 90 L30 90 Z" fill="#FBF7EF" stroke="#4A4038" strokeWidth="4" strokeLinejoin="round" />
          </g>
          <g transform="translate(72 22) scale(0.55)">
            <circle cx="50" cy="30" r="12.5" fill="#37322F" stroke="#141210" strokeWidth="4" />
            <path d="M50 41 C42 48 38 55 38 62 C38 68 42 72 46 74 L34 79 L34 84 L66 84 L66 79 L54 74 C58 72 62 68 62 62 C62 55 58 48 50 41 Z" fill="#37322F" stroke="#141210" strokeWidth="4" strokeLinejoin="round" />
          </g>
        </svg>
      )
    case 'coloring':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#FCE7F3" />
          <g transform="translate(8 6)">
            <path d="M42 34 C22 8 10 16 20 34 C10 52 22 60 42 34 Z" fill="#F9A8D4" stroke="#BE185D" strokeWidth="2.5" />
            <path d="M42 34 C62 8 74 16 64 34 C74 52 62 60 42 34 Z" fill="#C4B5FD" stroke="#6D28D9" strokeWidth="2.5" />
            <rect x="39" y="22" width="6" height="26" rx="3" fill="#7C3AED" />
            <circle cx="42" cy="18" r="5" fill="#FB7185" stroke="#BE185D" strokeWidth="2" />
          </g>
          {['#F43F5E', '#FB923C', '#FACC15', '#34D399', '#38BDF8', '#A855F7'].map((c, i) => (
            <circle key={i} cx={22 + i * 14} cy="66" r="5" fill={c} stroke="rgba(0,0,0,0.15)" />
          ))}
        </svg>
      )
    case 'memory':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#065F46" />
          <g transform="rotate(-8 40 40)">
            <rect x="22" y="12" width="30" height="40" rx="6" fill="#F472B6" stroke="#fff" strokeWidth="2" />
            <text x="37" y="40" textAnchor="middle" fontSize="18">🐾</text>
          </g>
          <g transform="rotate(8 80 40)">
            <rect x="66" y="12" width="30" height="40" rx="6" fill="#38BDF8" stroke="#fff" strokeWidth="2" />
            <text x="81" y="40" textAnchor="middle" fontSize="18">🐾</text>
          </g>
          <path d="M56 64 L60 54 L64 64" stroke="#FDE68A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="60" cy="68" r="2.5" fill="#FDE68A" />
        </svg>
      )
    case 'bubbles':
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill="#0C4A6E" />
          {[
            [30, 30, 16, '#F87171'], [66, 44, 20, '#38BDF8'], [96, 22, 12, '#34D399'], [50, 60, 10, '#FACC15'],
          ].map(([cx, cy, r, c], i) => (
            <g key={i}>
              <circle cx={cx as number} cy={cy as number} r={r as number} fill={`${c}CC`} stroke="#fff" strokeOpacity="0.6" />
              <ellipse cx={(cx as number) - (r as number) * 0.35} cy={(cy as number) - (r as number) * 0.4} rx={(r as number) * 0.25} ry={(r as number) * 0.16} fill="#fff" opacity="0.85" />
            </g>
          ))}
          <circle cx="88" cy="58" r="8" fill="#FCD34D" stroke="#fff" strokeOpacity="0.6" />
          <text x="88" y="62" textAnchor="middle" fontSize="9">⭐</text>
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 120 78" className={common} preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="78" fill={accent} opacity="0.9" />
          <circle cx="60" cy="39" r="18" fill="#fff" opacity="0.3" />
        </svg>
      )
  }
}

/* ---------------- карточка игры ---------------- */

function BestChip({ id, accent }: { id: string; accent: string }) {
  const [best] = useBest(id)
  if (best <= 0) return null
  return (
    <span
      className="mt-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold w-fit"
      style={{ background: 'rgba(0,0,0,0.45)', color: '#fff', border: `1px solid ${accent}66` }}
    >
      🏆 {best.toLocaleString('ru-RU')}
    </span>
  )
}

function GameCard({ g, i, onOpen }: { g: GameDef; i: number; onOpen: (id: string) => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.32, delay: (i % 4) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.96 }}
      onClick={() => onOpen(g.id)}
      className="group relative overflow-hidden rounded-[20px] md:rounded-[22px] text-left flex flex-col aspect-[5/4] md:aspect-[4/3] border border-white/15 dark:border-white/10 transition-shadow hover:shadow-2xl"
      style={{ boxShadow: `0 18px 40px -22px ${g.accent}99` }}
      aria-label={g.title}
    >
      {/* обложка-арт */}
      <span className="absolute inset-0">
        <GameArt id={g.id} accent={g.accent} />
      </span>
      {/* затемнение снизу для читаемости */}
      <span aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(3,6,18,0.72) 78%, rgba(3,6,18,0.9) 100%)' }} />
      {/* блик */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1/2 -left-1/3 h-[200%] w-1/2 rotate-12 opacity-0 group-hover:opacity-100 transition-all duration-700 group-hover:translate-x-[280%]"
        style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.14),transparent)' }}
      />
      {/* play-чип */}
      <span className="absolute top-2 right-2 h-7 w-7 rounded-full grid place-items-center backdrop-blur-md" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.25)' }}>
        <span className="w-0 h-0 ml-0.5" style={{ borderLeft: '9px solid #fff', borderTop: '5.5px solid transparent', borderBottom: '5.5px solid transparent' }} />
      </span>

      <span className="relative z-10 mt-auto p-3 md:p-3.5">
        <span className="block text-[14.5px] md:text-[16px] font-extrabold text-white tracking-tight leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {g.title}
        </span>
        <span className="block text-[10.5px] md:text-[12px] text-white/75 mt-0.5 leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {g.desc}
        </span>
        <BestChip id={g.id} accent={g.accent} />
      </span>
    </motion.button>
  )
}

/* ---------------- хаб ---------------- */

export function GamesHub() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [onlineHint, setOnlineHint] = useState(false)
  const openGame = GAMES.find((g) => g.id === openId) || null

  const open = useCallback((id: string) => {
    const g = GAMES.find((x) => x.id === id)
    if (!g) return
    // онлайн-игры создаются в чате — показываем подсказку
    if (g.section === 'online') {
      setOnlineHint(true)
      sfx.tap()
      return
    }
    sfx.whoosh(1)
    setOpenId(id)
    try {
      const el = document.documentElement
      if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
    } catch {}
  }, [])

  const close = useCallback(() => {
    setOpenId(null)
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    } catch {}
  }, [])

  return (
    <div className="page-top-padding w-full">
      <div className="px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+5.75rem)] md:pb-10 max-w-6xl mx-auto w-full">
        {/* шапка раздела */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[26px] p-5 md:p-7 mb-6"
          style={{
            background: 'linear-gradient(135deg,#4338CA 0%,#7C3AED 45%,#DB2777 100%)',
            boxShadow: '0 30px 70px -30px rgba(124,58,237,0.65)',
          }}
        >
          <div aria-hidden className="absolute -top-10 -right-8 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden className="absolute -bottom-14 left-10 h-36 w-36 rounded-full bg-fuchsia-400/20 blur-2xl" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="h-14 w-14 md:h-16 md:w-16 shrink-0 rounded-2xl grid place-items-center bg-white/15 border border-white/25 backdrop-blur">
              <Gamepad2 className="h-7 w-7 md:h-8 md:w-8 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">Игровой клуб</h1>
              <p className="text-[13px] md:text-sm text-white/75 mt-0.5 inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                26 игр · онлайн и для одного · для всей семьи
              </p>
            </div>
          </div>
        </motion.div>

        {/* секции */}
        {SECTIONS.map((sec) => {
          const games = GAMES.filter((g) => g.section === sec.id)
          if (!games.length) return null
          return (
            <section key={sec.id} className="mb-7">
              <div className="mb-3 flex items-end justify-between gap-2">
                <div>
                  <h2 className="text-lg md:text-xl font-bold tracking-tight text-foreground inline-flex items-center gap-2">
                    <span>{sec.emoji}</span> {sec.name}
                  </h2>
                  <p className="text-xs md:text-sm text-muted-foreground mt-0.5">{sec.hint}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                {games.map((g, i) => (
                  <GameCard key={g.id} g={g} i={i} onOpen={open} />
                ))}
              </div>
            </section>
          )
        })}

        {/* активная игра — полноэкранный оверлей */}
        <AnimatePresence>
          {openGame && openGame.Component && (
            <GameShell
              key={openGame.id}
              title={openGame.title}
              emoji={openGame.emoji}
              accent={openGame.accent}
              onExit={close}
            >
              <openGame.Component />
            </GameShell>
          )}
        </AnimatePresence>

        {/* подсказка про онлайн-игры */}
        <AnimatePresence>
          {onlineHint && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[680] grid place-items-center px-6"
              style={{ background: 'rgba(5,8,20,0.6)', backdropFilter: 'blur(10px)' }}
              onClick={() => setOnlineHint(false)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                className="rounded-[26px] p-6 w-full max-w-sm text-center relative"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.5)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setOnlineHint(false)}
                  className="absolute top-3 right-3 h-8 w-8 rounded-full grid place-items-center bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                  aria-label="Закрыть"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="h-16 w-16 mx-auto rounded-2xl grid place-items-center mb-3" style={{ background: 'linear-gradient(140deg,#0EA5E9,#6366F1)' }}>
                  <MessagesSquare className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-lg font-extrabold tracking-tight">Онлайн-игры — из чата</h3>
                <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
                  Открой чат с другом, нажми кнопку <b>🎮 Играть</b> рядом с полем ввода и выбери шашки, шахматы или викторину (флаги, столицы, миллионер, математика). Приглашение придёт собеседнику мгновенно!
                </p>
                <button
                  onClick={() => {
                    setOnlineHint(false)
                    window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'chat' } }))
                  }}
                  className="mt-4 h-11 px-6 rounded-2xl text-white font-extrabold text-sm active:scale-95 w-full"
                  style={{ background: 'linear-gradient(135deg,#0EA5E9,#6366F1)' }}
                >
                  Открыть чат
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
