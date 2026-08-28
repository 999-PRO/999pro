'use client'

// ============================================================================
// v25.23 — «Супер-раннер» (детская, в духе Марио): персонаж бежит вперёд,
// препятствия едут навстречу — ТАПАЙ/клик/пробел, чтобы ПРЫГНУТЬ (можно
// двойной прыжок). Собирай монетки, скорость растёт. Рекорд сохраняется.
//   • Параллакс: облака, холмы; яркая мультяшная картинка на canvas.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

interface Obs { x: number; w: number; h: number; type: 'box' | 'spike' | 'pipe' }
interface Coin { x: number; y: number; taken: boolean; t: number }
interface Cloud { x: number; y: number; s: number }
interface Hill { x: number; w: number; h: number }

type Phase = 'idle' | 'play' | 'over'

interface RunnerState {
  phase: Phase
  x: number
  speed: number
  py: number
  vy: number
  jumps: number
  obs: Obs[]
  coins: Coin[]
  clouds: Cloud[]
  hills: Hill[]
  spawnIn: number
  coinIn: number
  coinsCount: number
  score: number
  t: number
  w: number
  h: number
  groundY: number
}

const GROUND_FRAC = 0.78 // доля высоты канваса, где земля

export function RunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const st = useRef<RunnerState>({
    phase: 'idle' as Phase,
    x: 0, // виртуальная дистанция (px мира)
    speed: 250,
    py: 0, // высота персонажа над землёй
    vy: 0,
    jumps: 0,
    obs: [] as Obs[],
    coins: [] as Coin[],
    clouds: [] as Cloud[],
    hills: [] as Hill[],
    spawnIn: 0,
    coinIn: 0,
    coinsCount: 0,
    score: 0,
    t: 0,
    w: 360,
    h: 420,
    groundY: 320,
  })

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [coins, setCoins] = useState(0)
  const [best, submitBest] = useBest('runner')
  const scoredRef = useRef(false)

  const resize = useCallback(() => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    st.current.w = rect.width
    st.current.h = rect.height
    st.current.groundY = Math.round(rect.height * GROUND_FRAC)
    cv.width = Math.round(rect.width * dpr)
    cv.height = Math.round(rect.height * dpr)
    cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (st.current.clouds.length === 0) {
      st.current.clouds = Array.from({ length: 5 }, (_, i) => ({
        x: Math.random() * rect.width,
        y: 20 + Math.random() * rect.height * 0.3,
        s: 0.6 + Math.random() * 0.8,
      }))
      st.current.hills = Array.from({ length: 4 }, () => ({
        x: Math.random() * rect.width,
        w: 90 + Math.random() * 130,
        h: 34 + Math.random() * 52,
      }))
    }
  }, [])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  const doJump = useCallback(() => {
    const s = st.current
    if (s.phase !== 'play') return
    if (s.jumps < 2) {
      s.vy = s.jumps === 0 ? 560 : 480
      s.jumps++
      if (s.jumps === 1) sfx.jump()
      else sfx.jump2()
    }
  }, [])

  const startGame = useCallback(() => {
    const s = st.current
    s.phase = 'play'
    s.x = 0
    s.speed = 250
    s.py = 0
    s.vy = 0
    s.jumps = 0
    s.obs = []
    s.coins = []
    s.spawnIn = 200
    s.coinIn = 500
    s.coinsCount = 0
    s.score = 0
    scoredRef.current = false
    setScore(0)
    setCoins(0)
    setPhase('play')
    sfx.whoosh(1)
  }, [])

  const die = useCallback(() => {
    const s = st.current
    s.phase = 'over'
    setPhase('over')
    if (!scoredRef.current) {
      scoredRef.current = true
      submitBest(s.score)
    }
    sfx.lose()
  }, [submitBest])

  // цикл
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.04, (ts - last) / 1000)
      last = ts
      const s = st.current
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return
      const { w, h, groundY } = s

      // ── UPDATE ──
      if (s.phase === 'play') {
        s.t += dt
        s.speed = Math.min(620, 250 + s.x * 0.012)
        s.x += s.speed * dt
        setScoreThrottled(Math.floor(s.x / 12) + s.coinsCount * 50, s)

        // физика прыжка (vy — ВВЕРХ положительный)
        s.vy -= 1500 * dt
        s.py += s.vy * dt
        if (s.py <= 0) {
          s.py = 0
          s.vy = 0
          s.jumps = 0
        }

        // спавн препятствий
        s.spawnIn -= s.speed * dt
        if (s.spawnIn <= 0) {
          const roll = Math.random()
          if (roll < 0.34) s.obs.push({ x: w + 40, w: 26, h: 30, type: 'box' })
          else if (roll < 0.67) s.obs.push({ x: w + 40, w: 22, h: 34, type: 'spike' })
          else s.obs.push({ x: w + 40, w: 24, h: 44, type: 'pipe' })
          s.spawnIn = 240 + Math.random() * 260
        }
        // спавн монеток (дугой)
        s.coinIn -= s.speed * dt
        if (s.coinIn <= 0) {
          const baseY = groundY - 30 - Math.random() * 60
          for (let i = 0; i < 3; i++) {
            s.coins.push({ x: w + 40 + i * 30, y: baseY - i * 12, taken: false, t: Math.random() * 6 })
          }
          s.coinIn = 420 + Math.random() * 420
        }

        // движение объектов навстречу
        const playerX = Math.max(52, Math.min(90, w * 0.18))
        for (const o of s.obs) o.x -= s.speed * dt
        for (const c of s.coins) c.x -= s.speed * dt
        s.obs = s.obs.filter((o) => o.x > -60)
        s.coins = s.coins.filter((c) => c.x > -40 && !c.taken)

        // коллизии: игрок — прямоугольник 26×34 на playerX
        const pl = { x: playerX - 13, y: groundY - s.py - 34, w: 26, h: 34 }
        for (const o of s.obs) {
          const ob = { x: o.x, y: groundY - o.h, w: o.w, h: o.h }
          if (pl.x < ob.x + ob.w && pl.x + pl.w > ob.x && pl.y < ob.y + ob.h && pl.y + pl.h > ob.y) {
            die()
            break
          }
        }
        for (const c of s.coins) {
          if (!c.taken && Math.abs(c.x - (playerX + 0)) < 20 && Math.abs(c.y - (pl.y + 17)) < 24) {
            c.taken = true
            s.coinsCount++
            setCoins(s.coinsCount)
            sfx.coin()
          }
        }
      }

      // облака/холмы двигаются всегда (даже на заставке — красиво)
      for (const cl of s.clouds) {
        cl.x -= (s.phase === 'play' ? s.speed : 40) * 0.25 * dt * cl.s
        if (cl.x < -80) { cl.x = s.w + 40; cl.y = 20 + Math.random() * s.h * 0.3 }
      }
      for (const hl of s.hills) {
        hl.x -= (s.phase === 'play' ? s.speed : 40) * 0.5 * dt
        if (hl.x < -hl.w) { hl.x = s.w + Math.random() * 100 }
      }

      // ── DRAW ──
      drawWorld(ctx, s, die)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [die])

  // тап/клик/пробел
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const onDown = (e: Event) => { e.preventDefault(); doJump() }
    cv.addEventListener('pointerdown', onDown)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); doJump() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cv.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [doJump])

  const setScoreThrottled = (v: number, s: RunnerState) => {
    // обновляем React-стейт не чаще ~10 раз/сек
    if (v - s.score >= 8 || v < s.score) {
      s.score = v
      setScore(v)
    } else {
      s.score = v
    }
  }

  return (
    <div className="h-full flex flex-col items-center px-3 py-3 gap-3">
      {/* статы */}
      <div className="w-full max-w-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Счёт</div>
            <div className="text-base font-extrabold tabular-nums text-amber-300">{score.toLocaleString('ru-RU')}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Монетки</div>
            <div className="text-base font-extrabold tabular-nums text-yellow-400">🪙 {coins}</div>
          </div>
        </div>
        <div className="text-xs font-bold text-white/50">Рекорд: {Math.max(best, score).toLocaleString('ru-RU')}</div>
      </div>

      {/* сцена */}
      <div ref={wrapRef} className="relative flex-1 w-full max-w-md rounded-2xl overflow-hidden border border-white/12" style={{ minHeight: 300, background: 'linear-gradient(180deg,#7DD3FC 0%,#BAE6FD 45%,#FEF3C7 100%)' }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

        {phase !== 'play' && (
          <div className="absolute inset-0 grid place-items-center bg-black/45 backdrop-blur-[2px]">
            <div className="text-center px-6">
              <div className="text-6xl mb-2">{phase === 'idle' ? '🍄' : '💫'}</div>
              <div className="text-xl font-extrabold text-white mb-1">
                {phase === 'idle' ? 'Супер-раннер' : 'Ой, больно!'}
              </div>
              <p className="text-xs text-white/70 mb-4 leading-relaxed max-w-[270px] mx-auto">
                {phase === 'idle'
                  ? 'Тапай по экрану (или пробел), чтобы прыгать через препятствия и собирать монетки. Двойной прыжок работает!'
                  : `Счёт: ${score.toLocaleString('ru-RU')} · Монеток: ${coins}`}
              </p>
              <button
                onClick={startGame}
                className="h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95"
                style={{ background: 'linear-gradient(135deg,#F97316,#DC2626)', boxShadow: '0 16px 38px -14px rgba(249,115,22,0.7)' }}
              >
                {phase === 'idle' ? <Play className="h-5 w-5 fill-current" /> : <RotateCcw className="h-[18px] w-[18px]" />}
                {phase === 'idle' ? 'Побежали!' : 'Ещё раз'}
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-white/35 text-center">Тап — прыжок, второй тап в воздухе — двойной прыжок</p>
    </div>
  )
}

// ── отрисовка мультяшного мира ──
function drawWorld(ctx: CanvasRenderingContext2D, s: RunnerState, die: () => void) {
  const { w, h, groundY } = s
  const playerX = Math.max(52, Math.min(90, w * 0.18))

  // ВАЖНО: очищаем канвас каждый кадр (небо даёт фон-градиент обёртки)
  ctx.clearRect(0, 0, w, h)

  // облака
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (const cl of s.clouds) {
    const r = 14 * cl.s
    ctx.beginPath()
    ctx.arc(cl.x, cl.y, r, 0, Math.PI * 2)
    ctx.arc(cl.x + r, cl.y + 3 * cl.s, r * 0.8, 0, Math.PI * 2)
    ctx.arc(cl.x - r, cl.y + 4 * cl.s, r * 0.7, 0, Math.PI * 2)
    ctx.fill()
  }

  // холмы
  ctx.fillStyle = '#86EFAC'
  for (const hl of s.hills) {
    ctx.beginPath()
    ctx.ellipse(hl.x + hl.w / 2, groundY + 6, hl.w / 2, hl.h, 0, Math.PI, 0)
    ctx.fill()
  }

  // земля
  ctx.fillStyle = '#4ADE80'
  ctx.fillRect(0, groundY, w, h - groundY)
  ctx.fillStyle = 'rgba(0,0,0,0.08)'
  const off = s.x % 40
  for (let x = -40; x < w + 40; x += 40) ctx.fillRect(x - off, groundY, 22, 5)
  ctx.fillStyle = '#A16207'
  ctx.fillRect(0, groundY + 14, w, h - groundY - 14)
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  for (let x = -40; x < w + 40; x += 40) ctx.fillRect(x - off * 1.4, groundY + 20, 16, 4)

  // препятствия
  for (const o of s.obs) {
    if (o.type === 'box') {
      ctx.fillStyle = '#D97706'
      roundRect(ctx, o.x, groundY - o.h, o.w, o.h, 4)
      ctx.fill()
      ctx.strokeStyle = '#92400E'
      ctx.lineWidth = 2
      roundRect(ctx, o.x + 3, groundY - o.h + 3, o.w - 6, o.h - 6, 3)
      ctx.stroke()
    } else if (o.type === 'spike') {
      ctx.fillStyle = '#EF4444'
      ctx.beginPath()
      ctx.moveTo(o.x, groundY)
      ctx.lineTo(o.x + o.w / 2, groundY - o.h)
      ctx.lineTo(o.x + o.w, groundY)
      ctx.closePath()
      ctx.fill()
    } else {
      // труба как у Марио
      ctx.fillStyle = '#16A34A'
      roundRect(ctx, o.x, groundY - o.h, o.w, o.h, 3)
      ctx.fill()
      ctx.fillStyle = '#22C55E'
      roundRect(ctx, o.x - 3, groundY - o.h, o.w + 6, 10, 3)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(o.x + 4, groundY - o.h + 12, 4, o.h - 16)
    }
  }

  // монетки
  for (const c of s.coins) {
    if (c.taken) continue
    c.t += 0.1
    const squash = Math.abs(Math.sin(c.t))
    ctx.fillStyle = '#FACC15'
    ctx.beginPath()
    ctx.ellipse(c.x, c.y, 7 * (0.4 + squash * 0.6), 8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#B45309'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // персонаж — весёлый человечек в кепке (в духе Марио)
  const px = playerX
  const py = groundY - s.py
  const run = s.phase === 'play' ? Math.sin(s.x * 0.08) : 0
  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(px, groundY + 4, 12 * Math.max(0.4, 1 - s.py / 200), 3.5, 0, 0, Math.PI * 2)
  ctx.fill()
  // ноги
  ctx.strokeStyle = '#1D4ED8'
  ctx.lineWidth = 4.5
  ctx.lineCap = 'round'
  if (s.py > 4) {
    ctx.beginPath(); ctx.moveTo(px - 2, py - 12); ctx.lineTo(px - 8, py - 4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(px + 3, py - 12); ctx.lineTo(px + 9, py - 6); ctx.stroke()
  } else {
    ctx.beginPath(); ctx.moveTo(px - 1, py - 12); ctx.lineTo(px - 6 - run * 5, py - 1); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(px + 1, py - 12); ctx.lineTo(px + 6 + run * 5, py - 1); ctx.stroke()
  }
  // тело (комбинезон)
  ctx.fillStyle = '#2563EB'
  roundRect(ctx, px - 9, py - 28, 18, 17, 6)
  ctx.fill()
  ctx.fillStyle = '#FACC15'
  ctx.beginPath(); ctx.arc(px - 4, py - 24, 1.6, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(px + 4, py - 24, 1.6, 0, Math.PI * 2); ctx.fill()
  // голова
  ctx.fillStyle = '#FCD9B8'
  ctx.beginPath(); ctx.arc(px, py - 34, 8.5, 0, Math.PI * 2); ctx.fill()
  // кепка
  ctx.fillStyle = '#DC2626'
  ctx.beginPath(); ctx.arc(px, py - 36, 8.5, Math.PI, 0); ctx.fill()
  ctx.fillRect(px, py - 37.5, 12, 3.5)
  // глаз
  ctx.fillStyle = '#1F2937'
  ctx.beginPath(); ctx.arc(px + 3.6, py - 33.5, 1.4, 0, Math.PI * 2); ctx.fill()
  // усы
  ctx.strokeStyle = '#5B3A1E'
  ctx.lineWidth = 1.6
  ctx.beginPath(); ctx.moveTo(px + 1, py - 30.5); ctx.lineTo(px + 7, py - 30.5); ctx.stroke()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}
