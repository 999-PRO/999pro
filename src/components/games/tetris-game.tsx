'use client'

// ============================================================================
// v25.23 — «Тетрис»: canvas 10×20, 7 фигур, честная гравитация с уровнями,
// софт/хард дроп, следующая фигура, рекорд. Управление:
//   мобайл — кнопки внизу (←, ↻, →, ↓, ⤓); десктоп — стрелки + пробел.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

const COLS = 10
const ROWS = 20

const COLORS: Record<string, string> = {
  I: '#22D3EE',
  J: '#6366F1',
  L: '#F97316',
  O: '#FACC15',
  S: '#22C55E',
  T: '#A855F7',
  Z: '#EF4444',
}

const SHAPES: Record<string, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
}

type Piece = { type: string; m: number[][]; x: number; y: number }

function spawn(type?: string): Piece {
  const types = Object.keys(SHAPES)
  const t = type || types[Math.floor(Math.random() * types.length)]
  const m = SHAPES[t].map((r) => [...r])
  return { type: t, m, x: Math.floor((COLS - m[0].length) / 2), y: 0 }
}

function rotateMatrix(m: number[][]): number[][] {
  const N = m.length
  const r = Array.from({ length: N }, () => Array(N).fill(0))
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) r[x][N - 1 - y] = m[y][x]
  return r
}

function collides(m: number[][], px: number, py: number, field: (string | null)[][]): boolean {
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m[y].length; x++) {
      if (!m[y][x]) continue
      const fx = px + x
      const fy = py + y
      if (fx < 0 || fx >= COLS || fy >= ROWS) return true
      if (fy >= 0 && field[fy][fx]) return true
    }
  }
  return false
}

const LINE_SCORES = [0, 100, 300, 500, 800]

export function TetrisGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nextRef = useRef<HTMLCanvasElement>(null)
  const fieldRef = useRef<(string | null)[][]>(Array.from({ length: ROWS }, () => Array(COLS).fill(null)))
  const pieceRef = useRef<Piece>(spawn())
  const nextTypeRef = useRef<string>(Object.keys(SHAPES)[Math.floor(Math.random() * 7)])
  const dropTimer = useRef(0)
  const rafRef = useRef(0)
  const runningRef = useRef(false)
  const overRef = useRef(false)

  const [score, setScore] = useState(0)
  const [lines, setLines] = useState(0)
  const [level, setLevel] = useState(1)
  const [paused, setPaused] = useState(false)
  const [over, setOver] = useState(false)
  const [started, setStarted] = useState(false)
  const [best, submitBest] = useBest('tetris')
  const statsRef = useRef({ score: 0, lines: 0, level: 1 })

  const cell = () => {
    // адаптивный размер клетки: canvas всегда COLS×ROWS клеток
    const cv = canvasRef.current
    if (!cv) return 24
    return cv.width / COLS
  }

  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const c = cell()
    ctx.clearRect(0, 0, cv.width, cv.height)

    // фон-сетка
    ctx.fillStyle = 'rgba(255,255,255,0.028)'
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * c, y * c, c, c)

    const drawCellRect = (x: number, y: number, color: string, ghost = false) => {
      ctx.globalAlpha = ghost ? 0.22 : 1
      ctx.fillStyle = color
      const pad = Math.max(1, c * 0.06)
      const r = Math.max(2, c * 0.16)
      const rx = x * c + pad
      const ry = y * c + pad
      const rw = c - pad * 2
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(rx, ry, rw, rw, r)
      else ctx.rect(rx, ry, rw, rw)
      ctx.fill()
      if (!ghost) {
        ctx.globalAlpha = 0.35
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fillRect(rx, ry, rw, rw * 0.18)
      }
      ctx.globalAlpha = 1
    }

    // стакан
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const v = fieldRef.current[y][x]
      if (v) drawCellRect(x, y, COLORS[v])
    }

    const p = pieceRef.current
    if (p && runningRef.current) {
      // призрак места падения
      let gy = p.y
      while (!collides(p.m, p.x, gy + 1, fieldRef.current)) gy++
      for (let y = 0; y < p.m.length; y++) for (let x = 0; x < p.m[y].length; x++) {
        if (p.m[y][x] && gy + y >= 0) drawCellRect(p.x + x, gy + y, COLORS[p.type], true)
      }
      // активная фигура
      for (let y = 0; y < p.m.length; y++) for (let x = 0; x < p.m[y].length; x++) {
        if (p.m[y][x] && p.y + y >= 0) drawCellRect(p.x + x, p.y + y, COLORS[p.type])
      }
    }
  }, [])

  const drawNext = useCallback(() => {
    const cv = nextRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    const m = SHAPES[nextTypeRef.current]
    const c = cv.width / 4.6
    const ox = (cv.width - m[0].length * c) / 2
    const oy = (cv.height - m.length * c) / 2
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) {
      if (!m[y][x]) continue
      ctx.fillStyle = COLORS[nextTypeRef.current]
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(ox + x * c + 1, oy + y * c + 1, c - 2, c - 2, 3); ctx.fill() }
      else ctx.fillRect(ox + x * c + 1, oy + y * c + 1, c - 2, c - 2)
    }
  }, [])

  const finish = useCallback(() => {
    overRef.current = true
    runningRef.current = false
    setOver(true)
    submitBest(statsRef.current.score)
    sfx.lose()
  }, [submitBest])

  const lockPiece = useCallback(() => {
    const p = pieceRef.current
    for (let y = 0; y < p.m.length; y++) for (let x = 0; x < p.m[y].length; x++) {
      if (p.m[y][x]) {
        const fy = p.y + y
        const fx = p.x + x
        if (fy < 0) { finish(); return }
        fieldRef.current[fy][fx] = p.type
      }
    }
    sfx.lock()

    // собираем линии
    let cleared = 0
    for (let y = ROWS - 1; y >= 0; y--) {
      if (fieldRef.current[y].every((v) => v)) {
        fieldRef.current.splice(y, 1)
        fieldRef.current.unshift(Array(COLS).fill(null))
        cleared++
        y++
      }
    }
    if (cleared > 0) {
      const s = statsRef.current
      s.lines += cleared
      s.score += LINE_SCORES[cleared] * s.level
      s.level = 1 + Math.floor(s.lines / 10)
      setLines(s.lines)
      setScore(s.score)
      setLevel(s.level)
      sfx.line(cleared)
    }

    // следующая фигура
    pieceRef.current = spawn(nextTypeRef.current)
    nextTypeRef.current = Object.keys(SHAPES)[Math.floor(Math.random() * 7)]
    drawNext()

    if (collides(pieceRef.current.m, pieceRef.current.x, pieceRef.current.y, fieldRef.current)) {
      finish()
    }
  }, [drawNext, finish])

  const shift = useCallback((dx: number) => {
    if (!runningRef.current) return
    const p = pieceRef.current
    if (!collides(p.m, p.x + dx, p.y, fieldRef.current)) {
      p.x += dx
      sfx.tap()
      draw()
    }
  }, [draw])

  const rotate = useCallback(() => {
    if (!runningRef.current) return
    const p = pieceRef.current
    const r = rotateMatrix(p.m)
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(r, p.x + kick, p.y, fieldRef.current)) {
        p.m = r
        p.x += kick
        sfx.rotate()
        draw()
        return
      }
    }
  }, [draw])

  const softDrop = useCallback(() => {
    if (!runningRef.current) return
    const p = pieceRef.current
    if (!collides(p.m, p.x, p.y + 1, fieldRef.current)) {
      p.y++
      statsRef.current.score += 1
      setScore(statsRef.current.score)
      dropTimer.current = 0
      draw()
    } else {
      lockPiece()
      draw()
    }
  }, [draw, lockPiece])

  const hardDrop = useCallback(() => {
    if (!runningRef.current) return
    const p = pieceRef.current
    let d = 0
    while (!collides(p.m, p.x, p.y + 1, fieldRef.current)) { p.y++; d++ }
    statsRef.current.score += d * 2
    setScore(statsRef.current.score)
    sfx.boom()
    lockPiece()
    draw()
  }, [draw, lockPiece])

  // игровой цикл
  useEffect(() => {
    const loop = (ts: number) => {
      rafRef.current = requestAnimationFrame(loop)
      if (!runningRef.current || overRef.current) { draw(); return }
      const speed = Math.max(90, 720 - (statsRef.current.level - 1) * 62)
      if (!dropTimer.current) dropTimer.current = ts
      if (ts - dropTimer.current > speed) {
        dropTimer.current = ts
        const p = pieceRef.current
        if (!collides(p.m, p.x, p.y + 1, fieldRef.current)) p.y++
        else { lockPiece() }
      }
      draw()
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw, lockPiece])

  // размер canvas по контейнеру
  useEffect(() => {
    const fit = () => {
      const cv = canvasRef.current
      if (!cv) return
      const wrap = cv.parentElement
      if (!wrap) return
      const size = Math.min(wrap.clientWidth, wrap.clientHeight, 560)
      cv.style.width = `${size}px`
      cv.style.height = `${size * 2}px`
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(size * dpr)
      cv.height = Math.round(size * 2 * dpr)
      draw()
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [draw])

  // клавиатура
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); shift(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); shift(1) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); softDrop() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); rotate() }
      else if (e.key === ' ') { e.preventDefault(); hardDrop() }
      else if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') togglePause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, rotate, softDrop, hardDrop])

  const startNew = () => {
    fieldRef.current = Array.from({ length: ROWS }, () => Array(COLS).fill(null))
    pieceRef.current = spawn()
    nextTypeRef.current = Object.keys(SHAPES)[Math.floor(Math.random() * 7)]
    statsRef.current = { score: 0, lines: 0, level: 1 }
    setScore(0); setLines(0); setLevel(1)
    setOver(false)
    overRef.current = false
    runningRef.current = true
    setPaused(false)
    setStarted(true)
    drawNext()
    sfx.whoosh(1)
    draw()
  }

  const togglePause = () => {
    if (overRef.current || !started) return
    runningRef.current = !runningRef.current
    setPaused(!runningRef.current)
    sfx.tap()
  }

  return (
    <div className="h-full flex flex-col items-center px-3 md:px-6 py-3 md:py-5 gap-3">
      {/* статы */}
      <div className="w-full max-w-md flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Stat label="Очки" value={score.toLocaleString('ru-RU')} color="#22D3EE" />
          <Stat label="Линии" value={String(lines)} />
          <Stat label="Уровень" value={String(level)} />
        </div>
        <div className="flex items-center gap-2">
          <div className="text-center">
            <div className="text-[9px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold">Далее</div>
            <canvas ref={nextRef} width={64} height={48} className="rounded-lg bg-[var(--g-btn)] border border-[var(--g-chip-border)]" />
          </div>
          <button
            onClick={togglePause}
            disabled={over}
            className="h-10 w-10 rounded-full grid place-items-center text-[var(--g-fg)] bg-[var(--g-btn)] border border-[var(--g-chip-border)] active:scale-90 disabled:opacity-35"
            aria-label={paused ? 'Продолжить' : 'Пауза'}
          >
            {paused ? <Play className="h-[18px] w-[18px] fill-current" /> : <Pause className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>

      {/* стакан */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <div className="relative h-full max-h-[56vh] md:max-h-[60vh] aspect-[1/2] rounded-2xl overflow-hidden border border-[var(--g-chip-border)]" style={{ background: 'linear-gradient(180deg,#101527,#0a0d1a)' }}>
          <canvas ref={canvasRef} className="block h-full w-full" />
          {(paused || over || !started) && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-[3px]">
              <div className="text-center">
                <div className="text-3xl mb-1">{over ? '🏁' : paused ? '⏸️' : '🧱'}</div>
                <div className="text-white font-extrabold text-lg">{over ? 'Игра окончена' : paused ? 'Пауза' : 'Тетрис'}</div>
                {over && (
                  <>
                    <div className="text-sm text-[var(--g-fg-soft)] mt-1 tabular-nums">Очки: {score.toLocaleString('ru-RU')} · Рекорд: {Math.max(best, score).toLocaleString('ru-RU')}</div>
                    <button
                      onClick={startNew}
                      className="mt-4 h-11 px-6 rounded-xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95"
                      style={{ background: 'linear-gradient(135deg,#22D3EE,#0891B2)' }}
                    >
                      <RotateCcw className="h-4 w-4" /> Ещё раз
                    </button>
                  </>
                )}
                {!over && !started && (
                  <>
                    <div className="text-sm text-[var(--g-fg-mute)] mt-1">Стрелки или кнопки внизу. Пробел — сброс.</div>
                    <button
                      onClick={startNew}
                      className="mt-4 h-11 px-7 rounded-xl text-white font-extrabold active:scale-95"
                      style={{ background: 'linear-gradient(135deg,#22D3EE,#0891B2)' }}
                    >
                      Играть
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* кнопки управления (мобайл+десктоп) */}
      <div className="w-full max-w-xs grid grid-cols-5 gap-1.5 pb-1">
        <PadBtn label="←" onPress={() => shift(-1)} />
        <PadBtn label="↻" onPress={rotate} />
        <PadBtn label="→" onPress={() => shift(1)} />
        <PadBtn label="↓" onPress={softDrop} />
        <PadBtn label="⤓" onPress={hardDrop} accent />
      </div>
      <p className="hidden md:block text-[11px] text-white/35">Стрелки — движение, ↑ — поворот, пробел — сброс, P — пауза</p>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold">{label}</div>
      <div className="text-base font-extrabold tabular-nums leading-tight" style={{ color: color || 'rgba(255,255,255,0.85)' }}>{value}</div>
    </div>
  )
}

function PadBtn({ label, onPress, accent }: { label: string; onPress: () => void; accent?: boolean }) {
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); onPress() }}
      className="h-14 rounded-2xl text-xl font-extrabold border transition-transform active:scale-90 select-none touch-none"
      style={{
        // v25.28: неакцентная пад-кнопка — тематическое стекло (в светлой теме
        // была белая подложка с белым текстом — «сливалась»)
        background: accent ? 'linear-gradient(135deg,#22D3EE,#0E7490)' : 'var(--g-btn)',
        borderColor: accent ? 'rgba(34,211,238,0.5)' : 'var(--g-chip-border)',
        color: accent ? '#fff' : 'var(--g-fg)',
      }}
    >
      {label}
    </button>
  )
}
