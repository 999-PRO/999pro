'use client'

// ============================================================================
// v25.24 — NardiBoard: визуальная доска для нард. Общая для одиночной игры
// (nardi-game.tsx) и онлайн-дуэли (duel-host.tsx). Только рендер + тапы.
// ============================================================================

import type { NardiState, NardiMove, Side } from '@/lib/games/nardi-engine'

// Геометрия: индекс поля → координаты (колонка 0..13 с баром, верх/низ)
// верхний ряд слева-направо: 12..17 | бар | 18..23
// нижний ряд слева-направо: 11..6  | бар | 5..0
export function nardiPointPos(i: number): { row: 'top' | 'bottom'; col: number } {
  if (i <= 11) return { row: 'bottom', col: 11 - i } // 0 — правый нижний угол
  return { row: 'top', col: i - 12 } // 23 — правый верхний угол
}

export function NardiChecker({ side, small }: { side: Side; small?: boolean }) {
  return (
    <span
      className="block"
      style={{
        width: small ? '68%' : '76%',
        aspectRatio: '1',
        borderRadius: '50%',
        background:
          side === 'w'
            ? 'radial-gradient(circle at 34% 30%, #FFFDF7 0%, #EFE2C8 55%, #C9B48A 100%)'
            : 'radial-gradient(circle at 34% 30%, #6B6560 0%, #3A3532 55%, #201C1A 100%)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.45), inset 0 1.5px 2px rgba(255,255,255,0.35)',
        border: '1px solid rgba(0,0,0,0.25)',
      }}
    />
  )
}

export function NardiDice({ die, used }: { die: number; used: boolean }) {
  const P: Record<number, number[][]> = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[28, 28], [50, 50], [72, 72]],
    4: [[30, 30], [70, 30], [30, 70], [70, 70]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[30, 24], [30, 50], [30, 76], [70, 24], [70, 50], [70, 76]],
  }
  const pts = P[die] || []
  return (
    <div
      className="rounded-[9px] transition-all duration-300 shrink-0"
      style={{
        width: 34,
        height: 34,
        background: used ? 'rgba(120,110,95,0.25)' : 'linear-gradient(145deg,#FFFDF6,#EFE3C8)',
        boxShadow: used ? 'none' : '0 4px 10px -3px rgba(0,0,0,0.45), inset 0 1px 0 #fff',
        opacity: used ? 0.45 : 1,
        transform: used ? 'scale(0.9)' : 'scale(1)',
      }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {pts.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="10" fill={used ? '#8a8172' : '#4A3A22'} />
        ))}
      </svg>
    </div>
  )
}

export interface NardiBoardProps {
  st: NardiState
  selected: number | null // -1 = бар
  targets: NardiMove[]
  /** сторона, играющая «снизу» (всегда w в наших режимах) */
  me: Side
  disabled?: boolean
  onPointTap: (i: number) => void
  onBarTap: () => void
}

export function NardiBoard({ st, selected, targets, me, disabled, onPointTap, onBarTap }: NardiBoardProps) {
  const boardW = 'min(96vw, 56vh, 560px)'

  const renderPoint = (i: number) => {
    const { row } = nardiPointPos(i)
    const count = Math.abs(st.points[i])
    const side: Side = st.points[i] > 0 ? 'w' : 'b'
    const lightTri = i % 2 === 0
    const isTarget = targets.some((m) => m.to === i)
    const isCapture = isTarget && ((me === 'w' && st.points[i] === -1) || (me === 'b' && st.points[i] === 1))
    const isSelSrc = selected === i
    return (
      <button
        key={i}
        onClick={() => !disabled && onPointTap(i)}
        className="relative w-full h-full"
        aria-label={`Поле ${i + 1}`}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          {row === 'top' ? (
            <polygon
              points="0,0 100,0 50,88"
              fill={lightTri ? '#C89A5F' : '#8A5A28'}
              opacity={isTarget ? 1 : 0.92}
              style={isTarget ? { filter: 'drop-shadow(0 0 6px rgba(255,208,102,0.9))' } : undefined}
            />
          ) : (
            <polygon
              points="0,100 100,100 50,12"
              fill={lightTri ? '#C89A5F' : '#8A5A28'}
              opacity={isTarget ? 1 : 0.92}
              style={isTarget ? { filter: 'drop-shadow(0 0 6px rgba(255,208,102,0.9))' } : undefined}
            />
          )}
        </svg>
        {isTarget && isCapture && (
          <span className="absolute inset-[12%] rounded-full border-[3px] pointer-events-none" style={{ borderColor: 'rgba(255,224,130,0.9)' }} />
        )}
        <div className={`absolute inset-x-0 flex flex-col items-center ${row === 'top' ? 'top-[4%]' : 'bottom-[4%] flex-col-reverse'} gap-0`}>
          {count > 0 &&
            Array.from({ length: Math.min(count, 5) }).map((_, k) => (
              <span key={k} className="flex justify-center w-full -my-[7%] first:mt-0 last:mb-0" style={{ zIndex: count - k }}>
                <NardiChecker side={side} />
              </span>
            ))}
          {count > 5 && (
            <>
              <span className="absolute top-1/2 -translate-y-1/2 px-1 rounded-full text-[9px] font-extrabold text-white" style={{ background: 'rgba(0,0,0,0.55)', zIndex: 20 }}>
                {count}
              </span>
              <NardiChecker side={side} small />
            </>
          )}
        </div>
        {isSelSrc && <span className="absolute inset-0 rounded-sm pointer-events-none" style={{ boxShadow: 'inset 0 0 0 3px rgba(255,208,102,0.95)', zIndex: 10 }} />}
      </button>
    )
  }

  return (
    <div
      className="relative rounded-[16px] grid gap-0"
      style={{
        width: boardW,
        height: `calc(${boardW} * 0.78)`,
        gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr 22px 1fr 1fr 1fr 1fr 1fr 1fr 30px',
        gridTemplateRows: '1fr 26px 1fr',
        background: 'linear-gradient(145deg,#6E4726 0%,#55341B 55%,#452915 100%)',
        boxShadow: '0 26px 60px -24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.14)',
        padding: 8,
      }}
    >
      {/* верхний ряд: 12..17 | бар | 18..23 */}
      {Array.from({ length: 6 }).map((_, k) => (
        <div key={`t${k}`} style={{ gridColumn: k + 1, gridRow: 1 }}>{renderPoint(12 + k)}</div>
      ))}
      {Array.from({ length: 6 }).map((_, k) => (
        <div key={`t2${k}`} style={{ gridColumn: k + 8, gridRow: 1 }}>{renderPoint(18 + k)}</div>
      ))}
      {/* нижний ряд: 11..6 | бар | 5..0 */}
      {Array.from({ length: 6 }).map((_, k) => (
        <div key={`b${k}`} style={{ gridColumn: k + 1, gridRow: 3 }}>{renderPoint(11 - k)}</div>
      ))}
      {Array.from({ length: 6 }).map((_, k) => (
        <div key={`b2${k}`} style={{ gridColumn: k + 8, gridRow: 3 }}>{renderPoint(5 - k)}</div>
      ))}

      {/* бар */}
      <button
        onClick={() => !disabled && onBarTap()}
        className="relative rounded-md"
        style={{ gridColumn: 7, gridRow: '1 / 4', background: 'linear-gradient(180deg,#5D3A1E,#4A2D15)', boxShadow: 'inset 0 0 8px rgba(0,0,0,0.5)' }}
        aria-label="Бар"
      >
        {st.bar.b > 0 && (
          <div className="absolute top-[4%] inset-x-0 flex flex-col items-center gap-0.5">
            {Array.from({ length: Math.min(st.bar.b, 4) }).map((_, k) => (
              <NardiChecker key={k} side="b" small />
            ))}
            {st.bar.b > 4 && <span className="text-[9px] font-extrabold text-white px-1 rounded-full" style={{ background: 'rgba(0,0,0,0.55)' }}>{st.bar.b}</span>}
          </div>
        )}
        {st.bar.w > 0 && (
          <div className="absolute bottom-[4%] inset-x-0 flex flex-col-reverse items-center gap-0.5">
            {Array.from({ length: Math.min(st.bar.w, 4) }).map((_, k) => (
              <NardiChecker key={k} side="w" small />
            ))}
            {st.bar.w > 4 && <span className="text-[9px] font-extrabold text-white px-1 rounded-full" style={{ background: 'rgba(0,0,0,0.55)' }}>{st.bar.w}</span>}
          </div>
        )}
        {selected === -1 && <span className="absolute inset-0 rounded-md" style={{ boxShadow: 'inset 0 0 0 3px rgba(255,208,102,0.95)' }} />}
      </button>

      {/* лотки выброшенных */}
      <div
        className="rounded-md flex flex-col items-center justify-start py-1 gap-0.5"
        style={{ gridColumn: 14, gridRow: '1 / 2', background: 'rgba(30,18,8,0.5)', boxShadow: 'inset 0 0 8px rgba(0,0,0,0.45)' }}
      >
        {st.off.b > 0 && Array.from({ length: Math.min(st.off.b, 8) }).map((_, k) => <NardiChecker key={k} side="b" small />)}
        {st.off.b > 8 && <span className="text-[9px] font-extrabold text-white">{st.off.b}</span>}
      </div>
      <div
        className="rounded-md flex flex-col items-center justify-end py-1 gap-0.5"
        style={{ gridColumn: 14, gridRow: '3 / 4', background: 'rgba(30,18,8,0.5)', boxShadow: 'inset 0 0 8px rgba(0,0,0,0.45)' }}
      >
        {st.off.w > 8 && <span className="text-[9px] font-extrabold text-white">{st.off.w}</span>}
        {st.off.w > 0 && Array.from({ length: Math.min(st.off.w, 8) }).map((_, k) => <NardiChecker key={k} side="w" small />)}
      </div>

      {/* кубики в центре */}
      <div className="flex items-center justify-center gap-2" style={{ gridColumn: '8 / 14', gridRow: 2 }}>
        {st.lastDice.map((d, i) => (
          <NardiDice key={i} die={d} used={!st.dice.includes(d)} />
        ))}
      </div>
    </div>
  )
}
