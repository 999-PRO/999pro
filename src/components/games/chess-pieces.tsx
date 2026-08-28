'use client'

// ============================================================================
// v25.24 — ВЕКТОРНЫЕ ШАХМАТНЫЕ ФИГУРЫ (чистый SVG, всегда хрустящие).
// Заменяют юникод-глифы v25.23, которые выглядели мелко и «старомодно».
// Каждая фигура — компонент <ChessPiece type color />, viewBox 100×100.
// ============================================================================

export type ChessSide = 'w' | 'b'
export type ChessType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p'

const STROKE_W = 4.5

function PieceSvg({ color, children }: { color: ChessSide; children: React.ReactNode }) {
  const fill = color === 'w' ? '#FBF7EF' : '#37322F'
  const stroke = color === 'w' ? '#4A4038' : '#141210'
  const detail = color === 'w' ? '#4A4038' : '#C9BFAF'
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-sm" aria-hidden>
      <g fill={fill} stroke={stroke} strokeWidth={STROKE_W} strokeLinejoin="round" strokeLinecap="round">
        {children}
      </g>
      <circle cx="50" cy="0" r="0" fill={detail} />
    </svg>
  )
}

export function ChessPiece({ type, color }: { type: ChessType; color: ChessSide }) {
  switch (type) {
    case 'p':
      return (
        <PieceSvg color={color}>
          <circle cx="50" cy="30" r="12.5" />
          <path d="M50 41 C42 48 38 55 38 62 C38 68 42 72 46 74 L34 79 L34 84 L66 84 L66 79 L54 74 C58 72 62 68 62 62 C62 55 58 48 50 41 Z" />
        </PieceSvg>
      )
    case 'r':
      return (
        <PieceSvg color={color}>
          <path d="M28 22 L28 34 L36 38 L36 30 L45 30 L45 38 L55 38 L55 30 L64 30 L64 38 L72 34 L72 22 L64 22 L64 27 L58 27 L58 22 L42 22 L42 27 L36 27 L36 22 Z" />
          <path d="M34 38 L66 38 L64 68 L36 68 Z" />
          <path d="M30 68 L70 68 L72 76 L28 76 Z" />
          <path d="M26 76 L74 76 L74 84 L26 84 Z" />
        </PieceSvg>
      )
    case 'n':
      return (
        <PieceSvg color={color}>
          <path d="M35 84 C33 66 36 54 46 45 C41 43 36 45 31 51 C28 44 32 34 41 29 C45 21 54 15 62 18 L66 12 C69 17 71 22 70 28 C79 36 83 50 82 66 C81 74 78 80 74 84 Z" />
          <path d="M60 24 C63 22 66 22 68 24 C67 27 64 29 61 29 Z" strokeWidth={3} />
          <circle cx="55" cy="30" r="2.6" fill={color === 'w' ? '#4A4038' : '#EDE6D8'} stroke="none" />
          <path d="M30 84 L74 84 L74 90 L30 90 Z" />
        </PieceSvg>
      )
    case 'b':
      return (
        <PieceSvg color={color}>
          <circle cx="50" cy="15" r="5" />
          <path d="M50 22 C38 32 33 42 33 51 C33 60 40 66 50 66 C60 66 67 60 67 51 C67 42 62 32 50 22 Z" />
          <path d="M50 34 L50 52 M42 42 L58 42" strokeWidth={3.4} />
          <path d="M38 66 L62 66 L64 72 L36 72 Z" />
          <path d="M30 72 L70 72 L70 84 L30 84 Z" />
        </PieceSvg>
      )
    case 'q':
      return (
        <PieceSvg color={color}>
          <circle cx="24" cy="24" r="5.5" />
          <circle cx="50" cy="14" r="5.5" />
          <circle cx="76" cy="24" r="5.5" />
          <path d="M24 28 L36 52 L50 22 L64 52 L76 28 L72 62 L28 62 Z" />
          <path d="M28 62 L72 62 L70 72 L30 72 Z" />
          <path d="M26 72 L74 72 L74 84 L26 84 Z" />
        </PieceSvg>
      )
    case 'k':
      return (
        <PieceSvg color={color}>
          <path d="M50 8 L50 20 M44 14 L56 14" strokeWidth={5} />
          <path d="M34 28 C30 22 34 14 42 16 C46 17 49 20 50 24 C51 20 54 17 58 16 C66 14 70 22 66 28 C62 34 55 36 50 42 C45 36 38 34 34 28 Z" />
          <path d="M36 40 L64 40 L68 60 L32 60 Z" />
          <path d="M28 60 L72 60 L70 72 L30 72 Z" />
          <path d="M26 72 L74 72 L74 84 L26 84 Z" />
        </PieceSvg>
      )
  }
}

// Мини-версия для «съеденных» фигур (лоток)
export function CapturedPiece({ type, color }: { type: ChessType; color: ChessSide }) {
  return (
    <span className="inline-block h-[18px] w-[18px] md:h-[22px] md:w-[22px] -ml-1 first:ml-0">
      <ChessPiece type={type} color={color} />
    </span>
  )
}
