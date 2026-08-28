'use client'

// ============================================================================
// v25.24 — «РАСКРАСКА» (детская, для девочек): красивые векторные картинки.
//   • 6 сцен: бабочка, цветочек, котик, радуга, домик, рыбка.
//   • 14 сочных цветов, тап по области — заливка.
//   • «Начать заново» + выбор картинки. Без проигрыша — чистое творчество.
// ============================================================================

import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'

const PALETTE = [
  '#F43F5E', '#FB923C', '#FBBF24', '#A3E635', '#34D399', '#2DD4BF',
  '#38BDF8', '#6366F1', '#A855F7', '#EC4899', '#F9A8D4', '#FDE68A',
  '#78716C', '#1E293B',
]

interface Region { d?: string; cx?: number; cy?: number; r?: number; x?: number; y?: number; w?: number; h?: number; rx?: number; el: 'path' | 'circle' | 'rect' }

interface Scene {
  id: string
  name: string
  emoji: string
  gradient: string
  regions: Region[]
}

const BUTTERFLY: Region[] = [
  { el: 'path', d: 'M100 150 C40 60 20 90 45 150 C20 210 40 240 100 150 Z' },       // левое крыло верх/низ объединять нельзя — разделим
  { el: 'path', d: 'M100 145 C45 55 15 80 42 145 C15 210 45 245 100 155 Z' },
  { el: 'path', d: 'M100 145 C155 55 185 80 158 145 C185 210 155 245 100 155 Z' },
  { el: 'path', d: 'M100 150 C70 100 60 110 78 150 C60 190 70 200 100 150 Z' },
  { el: 'path', d: 'M100 150 C130 100 140 110 122 150 C140 190 130 200 100 150 Z' },
  { el: 'rect', x: 93, y: 96, w: 14, h: 108, rx: 7 },
  { el: 'circle', cx: 100, cy: 88, r: 13 },
  { el: 'path', d: 'M94 78 C88 62 80 54 70 50 M106 78 C112 62 120 54 130 50' },
  { el: 'circle', cx: 62, cy: 108, r: 9 },
  { el: 'circle', cx: 138, cy: 108, r: 9 },
  { el: 'circle', cx: 66, cy: 190, r: 8 },
  { el: 'circle', cx: 134, cy: 190, r: 8 },
]

const FLOWER: Region[] = [
  { el: 'circle', cx: 100, cy: 90, r: 22 },
  { el: 'circle', cx: 100, cy: 52, r: 20 },
  { el: 'circle', cx: 138, cy: 90, r: 20 },
  { el: 'circle', cx: 100, cy: 128, r: 20 },
  { el: 'circle', cx: 62, cy: 90, r: 20 },
  { el: 'circle', cx: 126, cy: 64, r: 19 },
  { el: 'circle', cx: 126, cy: 116, r: 19 },
  { el: 'circle', cx: 74, cy: 64, r: 19 },
  { el: 'circle', cx: 74, cy: 116, r: 19 },
  { el: 'path', d: 'M96 148 C94 180 96 200 100 225 L106 225 C104 200 106 180 104 148 Z' },
  { el: 'path', d: 'M100 190 C80 185 68 172 64 156 C82 158 96 170 100 186 Z' },
  { el: 'path', d: 'M101 175 C120 170 132 158 136 142 C118 144 105 156 101 172 Z' },
]

const CAT: Region[] = [
  { el: 'path', d: 'M62 78 L54 40 L88 62 Z' },
  { el: 'path', d: 'M138 78 L146 40 L112 62 Z' },
  { el: 'circle', cx: 100, cy: 118, r: 52 },
  { el: 'circle', cx: 82, cy: 112, r: 10 },
  { el: 'circle', cx: 118, cy: 112, r: 10 },
  { el: 'path', d: 'M92 140 C96 136 104 136 108 140 C104 146 96 146 92 140 Z' },
  { el: 'path', d: 'M100 148 L100 156 M100 156 C94 162 86 160 82 156 M100 156 C106 162 114 160 118 156' },
  { el: 'path', d: 'M40 116 L62 120 M42 132 L62 128 M160 116 L138 120 M158 132 L138 128' },
]

const RAINBOW: Region[] = [
  { el: 'path', d: 'M25 150 A75 75 0 0 1 175 150 L155 150 A55 55 0 0 0 45 150 Z' },
  { el: 'path', d: 'M45 150 A55 55 0 0 1 155 150 L138 150 A38 38 0 0 0 62 150 Z' },
  { el: 'path', d: 'M62 150 A38 38 0 0 1 138 150 L122 150 A22 22 0 0 0 78 150 Z' },
  { el: 'path', d: 'M78 150 A22 22 0 0 1 122 150 L25 150 Z M25 150 L175 150 L175 160 L25 160 Z' },
  { el: 'circle', cx: 42, cy: 62, r: 16 },
  { el: 'circle', cx: 60, cy: 58, r: 13 },
  { el: 'circle', cx: 152, cy: 178, r: 15 },
  { el: 'circle', cx: 136, cy: 182, r: 11 },
]

const HOUSE: Region[] = [
  { el: 'rect', x: 52, y: 118, w: 96, h: 78, rx: 4 },
  { el: 'path', d: 'M40 122 L100 62 L160 122 Z' },
  { el: 'rect', x: 66, y: 138, w: 26, h: 24, rx: 3 },
  { el: 'rect', x: 110, y: 138, w: 26, h: 24, rx: 3 },
  { el: 'rect', x: 90, y: 156, w: 20, h: 40, rx: 2 },
  { el: 'rect', x: 128, y: 76, w: 12, h: 26, rx: 2 },
  { el: 'circle', cx: 62, cy: 210, r: 12 },
  { el: 'path', d: 'M62 198 L62 176 M62 182 C54 182 48 176 46 168 C56 168 60 174 62 178 Z' },
]

const FISH: Region[] = [
  { el: 'path', d: 'M60 150 C74 106 128 96 156 128 C168 142 168 158 156 172 C128 204 74 194 60 150 Z' },
  { el: 'path', d: 'M62 150 C44 128 34 118 24 116 C30 138 30 162 24 184 C34 182 44 172 62 150 Z' },
  { el: 'path', d: 'M104 106 C100 92 104 82 114 74 C118 88 116 98 110 106 Z' },
  { el: 'circle', cx: 136, cy: 140, r: 9 },
  { el: 'path', d: 'M92 130 C100 138 100 162 92 170 M112 122 C122 132 122 168 112 178' },
]

const SCENES: Scene[] = [
  { id: 'butterfly', name: 'Бабочка', emoji: '🦋', gradient: 'linear-gradient(140deg,#F472B6,#A855F7)', regions: BUTTERFLY },
  { id: 'flower', name: 'Цветочек', emoji: '🌸', gradient: 'linear-gradient(140deg,#FB7185,#F59E0B)', regions: FLOWER },
  { id: 'cat', name: 'Котик', emoji: '🐱', gradient: 'linear-gradient(140deg,#FBBF24,#FB923C)', regions: CAT },
  { id: 'rainbow', name: 'Радуга', emoji: '🌈', gradient: 'linear-gradient(140deg,#38BDF8,#A855F7)', regions: RAINBOW },
  { id: 'house', name: 'Домик', emoji: '🏡', gradient: 'linear-gradient(140deg,#34D399,#2DD4BF)', regions: HOUSE },
  { id: 'fish', name: 'Рыбка', emoji: '🐠', gradient: 'linear-gradient(140deg,#22D3EE,#6366F1)', regions: FISH },
]

function regionKey(sceneIdx: number, i: number) {
  return `${sceneIdx}:${i}`
}

export function ColoringGame() {
  const [started, setStarted] = useState(false)
  const [sceneIdx, setSceneIdx] = useState(0)
  const [color, setColor] = useState(PALETTE[0])
  const [fills, setFills] = useState<Record<string, string>>({})

  const scene = SCENES[sceneIdx]

  const pickScene = (idx: number) => {
    setSceneIdx(idx)
    setFills({})
    sfx.whoosh(1)
  }

  const tapRegion = useCallback(
    (key: string) => {
      setFills((f) => ({ ...f, [key]: color }))
      sfx.reveal()
    },
    [color],
  )

  if (!started) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-5 px-6">
        <div className="h-24 w-24 rounded-[28px] grid place-items-center text-5xl" style={{ background: 'linear-gradient(140deg,#F472B6,#A855F7)', boxShadow: '0 20px 50px -18px rgba(244,114,182,0.6)' }}>
          🎨
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--g-fg)' }}>Раскраска</h2>
          <p className="text-sm mt-2 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--g-fg-soft)' }}>
            Шесть волшебных картинок: бабочка, цветочек, котик, радуга, домик и рыбка. Выбирай цвет и раскрашуй пальчиком!
          </p>
        </div>
        <button
          onClick={() => { setStarted(true); sfx.whoosh(1) }}
          className="h-14 px-10 rounded-2xl text-white text-lg font-extrabold transition-transform active:scale-95 hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg,#F472B6,#DB2777)', boxShadow: '0 18px 40px -14px rgba(244,114,182,0.65)' }}
        >
          <span className="inline-flex items-center gap-2"><Play className="h-5 w-5 fill-current" /> Раскрашивать</span>
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center px-2 md:px-6 pt-2 pb-3 max-w-2xl mx-auto w-full gap-2.5">
      {/* выбор сцены */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar w-full justify-start md:justify-center py-0.5">
        {SCENES.map((sc, i) => (
          <button
            key={sc.id}
            onClick={() => pickScene(i)}
            className="shrink-0 h-9 px-3 rounded-full text-[12px] font-extrabold inline-flex items-center gap-1.5 border transition-all active:scale-95"
            style={{
              background: i === sceneIdx ? sc.gradient : 'var(--g-card)',
              color: i === sceneIdx ? '#fff' : 'var(--g-fg-soft)',
              borderColor: i === sceneIdx ? 'transparent' : 'var(--g-border)',
              boxShadow: i === sceneIdx ? '0 8px 20px -8px rgba(0,0,0,0.4)' : 'none',
            }}
          >
            <span>{sc.emoji}</span> {sc.name}
          </button>
        ))}
      </div>

      {/* холст */}
      <div
        className="relative rounded-[20px] w-full flex-1 min-h-0"
        style={{ background: 'linear-gradient(160deg,#FFFFFF,#F6F1E7)', boxShadow: 'var(--g-shadow)', border: '1px solid var(--g-border)', maxHeight: 420 }}
      >
        <svg viewBox="0 0 200 240" className="w-full h-full touch-manipulation">
          {scene.regions.map((rg, i) => {
            const key = regionKey(sceneIdx, i)
            const fill = fills[key] || '#FFFFFF'
            const common = {
              fill,
              stroke: '#4B4038',
              strokeWidth: 2.4,
              strokeLinejoin: 'round' as const,
              onClick: () => tapRegion(key),
              style: { cursor: 'pointer', transition: 'fill 0.15s ease' },
            }
            if (rg.el === 'circle' && rg.cx != null) return <circle key={i} cx={rg.cx} cy={rg.cy ?? 0} r={rg.r ?? 1} {...common} />
            if (rg.el === 'rect' && rg.x != null) return <rect key={i} x={rg.x} y={rg.y ?? 0} width={rg.w ?? 10} height={rg.h ?? 10} rx={rg.rx ?? 0} {...common} />
            return <path key={i} d={rg.d} {...common} />
          })}
        </svg>
      </div>

      {/* палитра */}
      <div className="w-full rounded-2xl px-3 py-2.5 bg-[var(--g-card)] border border-[var(--g-border)]">
        <div className="flex flex-wrap justify-center gap-1.5">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); sfx.tap() }}
              className="h-8 w-8 rounded-full transition-all active:scale-90"
              style={{
                background: c,
                border: color === c ? '3px solid var(--g-fg)' : '2px solid rgba(0,0,0,0.12)',
                boxShadow: color === c ? `0 4px 14px -4px ${c}` : 'none',
                transform: color === c ? 'scale(1.12)' : 'scale(1)',
              }}
              aria-label={`Цвет ${c}`}
            />
          ))}
          <button
            onClick={() => { setFills({}); sfx.whoosh(-1) }}
            className="h-8 px-3 rounded-full text-[11px] font-extrabold inline-flex items-center gap-1 border border-[var(--g-border)] bg-[var(--g-btn)] hover:bg-[var(--g-btn-hover)] active:scale-95"
            style={{ color: 'var(--g-fg-soft)' }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Заново
          </button>
        </div>
      </div>
    </div>
  )
}
