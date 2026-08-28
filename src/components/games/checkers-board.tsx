'use client'

// ============================================================================
// v25.25 — ДЕРЕВЯННАЯ ДОСКА РУССКИХ ШАШЕК (общая для оффлайн-игры и дуэлей).
//   • Тёплый орех, рамка, крупные векторные шашки с бликом.
//   • Дамка — с золотой короной. Подсветка: выбор, ходы, взятия, последний ход.
//   • Флип для игры чёрными (дуэль).
// ============================================================================

import { memo } from 'react'
import { motion } from 'framer-motion'
import { ckIdxToRC, type CkSide, type CkState, type CkStep } from '@/lib/games/checkers-core'

export interface CheckersBoardProps {
  st: CkState
  selected: number | null
  /** легальные шаги (от выбранной шашки или все) */
  targets: CkStep[]
  /** сторона игрока — если 'b', доска переворачивается */
  me: CkSide
  disabled?: boolean
  /** шашки, обязанные бить (подсветка пульсирующим кольцом) */
  mustCapture?: number[]
  onTap: (idx: number) => void
  /** css-размер доски, напр. 'min(94vw, 58vh, 520px)' */
  size?: string
}

function Piece({ cell, dim }: { cell: number; dim?: boolean }) {
  const white = cell <= 2
  const king = cell === 2 || cell === 4
  return (
    <motion.svg
      viewBox="0 0 40 40"
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: dim ? 0.35 : 1 }}
      transition={{ duration: 0.15 }}
      className="h-full w-full drop-shadow-[0_3px_3px_rgba(0,0,0,0.35)]"
    >
      <defs>
        <radialGradient id={white ? 'ckw' : 'ckb'} cx="35%" cy="30%">
          <stop offset="0%" stopColor={white ? '#FFFDF6' : '#5A5751'} />
          <stop offset="70%" stopColor={white ? '#E8DCC3' : '#332F2B'} />
          <stop offset="100%" stopColor={white ? '#C9B990' : '#1E1B18'} />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="17" fill={white ? '#B8A67E' : '#0F0D0B'} />
      <circle cx="20" cy="19" r="16" fill={`url(#${white ? 'ckw' : 'ckb'})`} stroke={white ? '#9C8A5F' : '#000'} strokeWidth="1" />
      <circle cx="20" cy="19" r="11.5" fill="none" stroke={white ? 'rgba(140,115,70,0.55)' : 'rgba(255,255,255,0.16)'} strokeWidth="1.4" />
      <circle cx="20" cy="19" r="8" fill="none" stroke={white ? 'rgba(140,115,70,0.4)' : 'rgba(255,255,255,0.1)'} strokeWidth="1.2" />
      {king && (
        <g transform="translate(20,19)">
          <path
            d="M-8 4 L-8 -2 L-4.5 1 L0 -6 L4.5 1 L8 -2 L8 4 Z"
            fill={white ? '#D9A93B' : '#F2C94C'}
            stroke={white ? '#8F6A1E' : '#8F6A1E'}
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </g>
      )}
      {/* блик */}
      <ellipse cx="14.5" cy="12.5" rx="6.5" ry="4" fill="rgba(255,255,255,0.35)" transform="rotate(-24 14.5 12.5)" />
    </motion.svg>
  )
}

export const CheckersBoard = memo(function CheckersBoard({
  st,
  selected,
  targets,
  me,
  disabled,
  mustCapture,
  onTap,
  size = 'min(94vw, 58vh, 520px)',
}: CheckersBoardProps) {
  const flip = me === 'b'
  const rows: number[][] = []
  for (let vr = 0; vr < 8; vr++) {
    const row: number[] = []
    for (let vc = 0; vc < 8; vc++) {
      const r = flip ? 7 - vr : vr
      const c = flip ? 7 - vc : vc
      // тёмные клетки (r+c)%2===1 → индекс
      if ((r + c) % 2 === 1) {
        row.push(r * 4 + (c >> 1))
      } else {
        row.push(-1) // светлая
      }
    }
    rows.push(row)
  }

  const targetTos = new Map<number, CkStep>()
  for (const t of targets) targetTos.set(t.to, t)
  const lastSet = new Set(st.lastPath ?? [])

  return (
    <div
      className="relative rounded-[14px] p-[10px] shrink-0"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(145deg,#7A5230 0%,#5D3D22 55%,#4E321C 100%)',
        boxShadow: '0 26px 60px -24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -2px 6px rgba(0,0,0,0.35)',
      }}
    >
      <div
        className="grid grid-cols-8 grid-rows-8 rounded-[6px] overflow-hidden w-full h-full"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(60,38,20,0.8), 0 2px 10px rgba(0,0,0,0.35)' }}
      >
        {rows.map((row, vr) =>
          row.map((idx, vc) => {
            const dark = idx >= 0
            const cell = dark ? st.cells[idx] : 0
            const isSel = dark && selected === idx
            const step = dark ? targetTos.get(idx) : undefined
            const isCap = step?.cap != null
            const isLast = dark && lastSet.has(idx)
            const must = dark && mustCapture?.includes(idx)
            const lightSq = !dark || (ckIdxToRC(idx)[0] + ckIdxToRC(idx)[1]) % 2 === 0
            return (
              <button
                key={`${vr}-${vc}`}
                onClick={() => dark && !disabled && onTap(idx)}
                className="relative grid place-items-center"
                style={{
                  background: !dark
                    ? 'linear-gradient(135deg,#F3E3C6 0%,#E7D0AB 100%)'
                    : 'linear-gradient(135deg,#B27A45 0%,#9C6534 100%)',
                  boxShadow: isLast
                    ? 'inset 0 0 0 100px rgba(255,196,88,0.35)'
                    : isSel
                      ? 'inset 0 0 0 100px rgba(255,199,0,0.45)'
                      : undefined,
                }}
                aria-label={dark ? `клетка ${idx}` : undefined}
                tabIndex={dark && !disabled ? 0 : -1}
              >
                {/* координаты по краям */}
                {dark && vc === (flip ? 7 : 0) && (
                  <span className="absolute left-[3px] top-[2px] text-[8px] md:text-[10px] font-bold pointer-events-none" style={{ color: lightSq ? '#9C6534' : '#EFDDBD', opacity: 0.85 }}>
                    {8 - ckIdxToRC(idx)[0]}
                  </span>
                )}
                {dark && vr === (flip ? 7 : 7) && (
                  <span className="absolute right-[3px] bottom-[1px] text-[8px] md:text-[10px] font-bold pointer-events-none" style={{ color: lightSq ? '#9C6534' : '#EFDDBD', opacity: 0.85 }}>
                    {'abcdefgh'[ckIdxToRC(idx)[1]]}
                  </span>
                )}

                {must && !disabled && (
                  <span className="absolute inset-[6%] rounded-full border-[3px] border-amber-400/80 pointer-events-none" style={{ boxShadow: '0 0 10px rgba(251,191,36,0.55)', animation: 'ckPulse 1.2s ease-in-out infinite' }} />
                )}

                {cell !== 0 && <Piece cell={cell} />}

                {step && !isCap && (
                  <span className="absolute h-[26%] w-[26%] rounded-full pointer-events-none" style={{ background: 'rgba(58,90,50,0.55)', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
                )}
                {step && isCap && (
                  <span className="absolute inset-[7%] rounded-full border-[3.5px] pointer-events-none" style={{ borderColor: 'rgba(180,40,40,0.65)' }} />
                )}
              </button>
            )
          }),
        )}
      </div>
      <style jsx>{`
        @keyframes ckPulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(0.97); }
        }
      `}</style>
    </div>
  )
})
