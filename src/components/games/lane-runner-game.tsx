'use client'

// ============================================================================
// v25.25 — «НОЧНОЙ ЗАБЕГ» (lane-runner): неоновый ночной город, 3 полосы.
//   • Вид: плоский вид сбоку — дорога идёт горизонтально, 3 дорожки —
//     3 горизонтальные «полосы тротуара», препятствия едут навстречу.
//     AABB-коллизии, гарантированно проходимые волны (макс. 2 полосы).
//   • Управление: свайп ←/→ — смена полосы (плавный lerp), свайп ↑/тап —
//     прыжок, свайп ↓ — подкат (в воздухе — резкое падение). Клавиатура:
//     ←/→ полоса, ↑/Space прыжок, ↓ подкат. Свайпы: порог 30px, доминирующая
//     ось, только на канвасе (touch-action: none).
//   • Препятствия: барьер (прыжок), ящик/конус (прыжок или объезд),
//     светофор-арка (подкат). Монеты: линии 3-5 и дуги над барьерами.
//   • Скорость 250→620 px/с. Фон: 3 слоя параллакса небоскрёбов с окнами,
//     луна, звёзды, фонари с конусами света, мокрый асфальт с отражениями
//     неона (розовый #EC4899 / циан #22D3EE / фиолетовый #A855F7).
//   • Смерть: sfx.boom + взрыв частиц + вспышка + шейк → game over.
//     Score = дистанция/10 + монеты×50. Рекорд useBest('lanes').
//   • 60fps: пул частиц (без аллокаций), градиенты кэшируются, звёзды/фон
//     без пересоздания объектов, dpr≤2, ResizeObserver, dt clamp ≤0.05.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, MoveHorizontal, Play, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

// ───────────────────────────── типы ─────────────────────────────

type Phase = 'idle' | 'play' | 'over'
type ObsType = 'barrier' | 'crate' | 'arch'

interface Obs { x: number; lane: number; type: ObsType }
interface Coin { x: number; lane: number; dy: number; taken: boolean; t: number }
interface Bld { x: number; w: number; h: number; seed: number; neon: string }
interface Layer { fac: number; arr: Bld[]; total: number; win: boolean }
interface Star { x: number; y: number; r: number; ph: number; sp: number }
interface Streak { wx: number; lane: number; col: string; ph: number }
interface SpeedLine { off: number; fy: number; len: number }
interface Part {
  x: number; y: number; vx: number; vy: number
  life: number; max: number; size: number; g: number
  col: string; active: boolean
}
interface Bounds {
  w: number; h: number
  roadTop: number; laneH: number
  base: number[] // baseline (линия ног) для полос 0..2
  px: number     // x героя
}

interface GState {
  phase: Phase
  dist: number; speed: number; t: number; score: number
  lanePos: number; laneTarget: number
  jy: number; jvy: number; airT: number
  slideT: number; slideQueued: boolean
  obs: Obs[]; coins: Coin[]; coinsCount: number
  laneFree: number[]; spawnIn: number; coinIn: number
  stepT: number
  flash: number; shake: number; deathAt: number
  b: Bounds
  stars: Star[]; layers: Layer[]; streaks: Streak[]; slines: SpeedLine[]
  pool: Part[]; pi: number
}

// ─────────────────────────── константы ───────────────────────────

const SPEED0 = 250
const SPEED_MAX = 620
const GRAV = 1500
const JUMP_V = 420 // апекс ≈ 59px, полёт ≈ 0.56с
const SLIDE_TIME = 0.55
const LANE_LERP = 12 // скорость перестроения
const HIT_W = 22     // хитбокс героя (ширина)
const H_STAND = 30   // хитбокс стоя (визуал 36)
const H_SLIDE = 15   // хитбокс в подкате (визуал 20)
const SWIPE_PX = 30  // порог свайпа
const POOL_SIZE = 140

const SPARK: readonly string[] = ['#FDE68A', '#FCD34D', '#22D3EE']
const DUST: readonly string[] = ['rgba(148,163,184,0.75)', 'rgba(196,181,253,0.65)']
const BURST: readonly string[] = ['#EC4899', '#22D3EE', '#A855F7', '#FDE68A', '#F8FAFC']
const NEONS: readonly string[] = ['#EC4899', '#22D3EE', '#A855F7']

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

function laneBase(b: Bounds, l: number): number {
  return b.roadTop + b.laneH * l + b.laneH * 0.78
}

function initState(): GState {
  return {
    phase: 'idle',
    dist: 0, speed: 60, t: 0, score: 0,
    lanePos: 1, laneTarget: 1,
    jy: 0, jvy: 0, airT: 0,
    slideT: 0, slideQueued: false,
    obs: [], coins: [], coinsCount: 0,
    laneFree: [0, 0, 0], spawnIn: 520, coinIn: 300,
    stepT: 0,
    flash: 0, shake: 0, deathAt: 0,
    b: { w: 360, h: 420, roadTop: 180, laneH: 77, base: [240, 317, 394], px: 86 },
    stars: [], layers: [], streaks: [], slines: [],
    pool: Array.from({ length: POOL_SIZE }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, g: 0, col: '#fff', active: false,
    })),
    pi: 0,
  }
}

/** частицы из пула (кольцевой индекс — ноль аллокаций) */
function emit(
  s: GState, x: number, y: number, n: number, cols: readonly string[],
  spd: number, ang: number, spread: number, g: number, life: number, size: number,
) {
  for (let i = 0; i < n; i++) {
    const p = s.pool[s.pi]
    s.pi = (s.pi + 1) % s.pool.length
    const a = ang + (Math.random() - 0.5) * spread
    const v = spd * (0.4 + Math.random() * 0.9)
    p.active = true
    p.x = x; p.y = y
    p.vx = Math.cos(a) * v
    p.vy = Math.sin(a) * v
    p.life = life * (0.6 + Math.random() * 0.7); p.max = p.life
    p.size = size * (0.6 + Math.random() * 0.8)
    p.col = cols[(Math.random() * cols.length) | 0]
    p.g = g
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

// ─────────────────────────── компонент ───────────────────────────

export function LaneRunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const gradRef = useRef<{ key: string; sky: CanvasGradient; road: CanvasGradient; vig: CanvasGradient } | null>(null)
  const pushT = useRef(0)
  const loseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const st = useRef<GState>(initState())

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [coinsC, setCoinsC] = useState(0)
  const [newBest, setNewBest] = useState(false)
  const [best, submitBest] = useBest('lanes')
  const scoredRef = useRef(false)

  // ── размер / ресайз (dpr ≤ 2, границы полос пересчитываются) ──
  const resize = useCallback(() => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const w = Math.max(280, Math.round(rect.width))
    const h = Math.max(300, Math.round(rect.height))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctxRef.current = ctx

    // границы: верх дороги ~42% высоты, 3 полосы, снизу бордюр
    const roadTop = Math.max(120, Math.round(h * 0.42))
    const laneH = (h - roadTop - 8) / 3
    const b: Bounds = {
      w, h, roadTop, laneH,
      base: [0, 0, 0],
      px: Math.round(clamp(w * 0.24, 64, 150)),
    }
    for (let l = 0; l < 3; l++) b.base[l] = laneBase(b, l)
    st.current.b = b

    // кэш градиентов (пересоздаём только при смене размера)
    gradRef.current = {
      key: `${w}x${h}`,
      sky: (() => {
        const g = ctx.createLinearGradient(0, 0, 0, roadTop + laneH * 0.5)
        g.addColorStop(0, '#040613')
        g.addColorStop(0.45, '#101636')
        g.addColorStop(0.75, '#2A1A5E')
        g.addColorStop(1, '#5B21B6')
        return g
      })(),
      road: (() => {
        const g = ctx.createLinearGradient(0, roadTop, 0, h)
        g.addColorStop(0, '#161C3C')
        g.addColorStop(0.5, '#0E132B')
        g.addColorStop(1, '#0A0E22')
        return g
      })(),
      vig: (() => {
        const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.42, w / 2, h * 0.45, Math.hypot(w, h) * 0.62)
        g.addColorStop(0, 'rgba(3,7,18,0)')
        g.addColorStop(1, 'rgba(3,7,18,0.55)')
        return g
      })(),
    }

    // ── статичный фон: звёзды, 3 слоя застройки, отражения, линии скорости ──
    const s = st.current
    s.stars = Array.from({ length: 56 }, () => ({
      x: Math.random() * w,
      y: Math.random() * roadTop * 0.85,
      r: Math.random() < 0.25 ? 1.6 : 1,
      ph: Math.random() * 6.28,
      sp: 0.6 + Math.random() * 1.6,
    }))

    const mkLayer = (fac: number, hMin: number, hMax: number, wMin: number, wMax: number, win: boolean): Layer => {
      const arr: Bld[] = []
      let x = 0
      let total = 0
      while (x < w + 340) {
        const bw = wMin + Math.random() * (wMax - wMin)
        const bh = hMin + Math.random() * (hMax - hMin)
        arr.push({
          x, w: bw, h: bh,
          seed: Math.floor(Math.random() * 1000),
          neon: NEONS[Math.floor(Math.random() * NEONS.length)],
        })
        x += bw + 3 + Math.random() * 12
        total = x
      }
      return { fac, arr, total, win }
    }
    s.layers = [
      mkLayer(0.12, h * 0.10, h * 0.22, 40, 88, false),
      mkLayer(0.24, h * 0.12, h * 0.26, 44, 96, true),
      mkLayer(0.44, h * 0.09, h * 0.21, 46, 108, true),
    ]

    s.streaks = Array.from({ length: 11 }, (_, i) => ({
      wx: Math.random() * (w + 260),
      lane: i % 3,
      col: NEONS[i % 3],
      ph: Math.random() * 6.28,
    }))

    s.slines = Array.from({ length: 8 }, () => ({
      off: Math.random() * (w + 240),
      fy: Math.random(),
      len: 50 + Math.random() * 90,
    }))
  }, [])

  useEffect(() => {
    resize()
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [resize])

  // ── действия ──
  const startGame = useCallback(() => {
    const s = st.current
    s.phase = 'play'
    s.dist = 0; s.speed = SPEED0; s.t = 0; s.score = 0
    s.lanePos = 1; s.laneTarget = 1
    s.jy = 0; s.jvy = 0; s.airT = 0
    s.slideT = 0; s.slideQueued = false
    s.obs.length = 0; s.coins.length = 0; s.coinsCount = 0
    s.laneFree = [0, 0, 0]; s.spawnIn = 520; s.coinIn = 300
    s.stepT = 0; s.flash = 0; s.shake = 0
    for (const p of s.pool) p.active = false
    scoredRef.current = false
    if (loseTimer.current) { clearTimeout(loseTimer.current); loseTimer.current = null }
    setNewBest(false)
    setScore(0); setCoinsC(0); setPhase('play')
    sfx.whoosh(1)
  }, [])

  const die = useCallback(() => {
    const s = st.current
    if (s.phase !== 'play') return
    s.phase = 'over'
    s.flash = 1; s.shake = 0.6; s.deathAt = performance.now()
    const b = s.b
    emit(s, b.px, laneBase(b, s.lanePos) - s.jy - 16, 30, BURST, 260, -Math.PI / 2, Math.PI * 2, 420, 0.9, 3.2)
    sfx.boom()
    if (loseTimer.current) clearTimeout(loseTimer.current)
    loseTimer.current = setTimeout(() => sfx.lose(), 330)
    if (!scoredRef.current) {
      scoredRef.current = true
      setNewBest(submitBest(s.score))
    }
    setScore(s.score)
    setPhase('over')
  }, [submitBest])

  const moveLane = useCallback((dir: number) => {
    const s = st.current
    if (s.phase !== 'play') return
    const next = clamp(s.laneTarget + dir, 0, 2)
    if (next !== s.laneTarget) {
      s.laneTarget = next
      sfx.tap()
    }
  }, [])

  const doJump = useCallback(() => {
    const s = st.current
    if (s.phase !== 'play') return
    if (s.jy <= 0.5) {
      s.jvy = JUMP_V
      s.jy = 0.6
      s.slideT = 0
      s.slideQueued = false
      sfx.jump()
    }
  }, [])

  const doSlide = useCallback(() => {
    const s = st.current
    if (s.phase !== 'play') return
    if (s.jy > 2) {
      // в воздухе — резкое падение, затем подкат
      s.jvy = Math.max(s.jvy, 780)
      s.slideQueued = true
    } else if (s.slideT <= 0) {
      s.slideT = SLIDE_TIME
      emit(s, s.b.px - 6, laneBase(s.b, s.lanePos) - 2, 6, DUST, 90, Math.PI, 1.6, 90, 0.4, 2.6)
      sfx.whoosh(-1)
    }
  }, [])

  // ── спавн: волны по 1-2 полосы (одна всегда свободна), межполосный зазор 430px ──
  const spawnWave = (s: GState) => {
    const x = s.dist + s.b.w + 90
    const avail: number[] = []
    for (let l = 0; l < 3; l++) if (s.laneFree[l] < x - 40) avail.push(l)
    if (avail.length === 0) { s.spawnIn = 90; return }

    const lanes: number[] = [avail[(Math.random() * avail.length) | 0]]
    if (avail.length >= 2 && Math.random() < 0.42) {
      let l2 = (Math.random() * 3) | 0
      while (l2 === lanes[0] || !avail.includes(l2)) l2 = (l2 + 1) % 3
      lanes.push(l2)
    }

    for (const l of lanes) {
      const roll = Math.random()
      const type: ObsType = roll < 0.36 ? 'barrier' : roll < 0.7 ? 'crate' : 'arch'
      s.obs.push({ x: x + (lanes.length > 1 ? Math.random() * 36 : 0), lane: l, type })
      s.laneFree[l] = x + 430
      // дуга монет над низким препятствием — награда за прыжок
      if (type !== 'arch' && Math.random() < 0.5) {
        const arc = [0, 24, 38, 24, 0]
        for (let i = 0; i < 5; i++) {
          s.coins.push({ x: x - 52 + i * 26, lane: l, dy: arc[i], taken: false, t: Math.random() * 6 })
        }
      }
    }
    s.spawnIn = 300 + s.speed * 0.45 + Math.random() * 240
  }

  const spawnCoins = (s: GState) => {
    const x = s.dist + s.b.w + 60
    const n = 3 + ((Math.random() * 3) | 0) // 3-5
    const len = (n - 1) * 32
    const ok: number[] = []
    for (let l = 0; l < 3; l++) {
      if (s.laneFree[l] > x - 60) continue
      let blocked = false
      for (const o of s.obs) {
        if (o.lane === l && Math.abs(o.x - (x + len / 2)) < len / 2 + 150) { blocked = true; break }
      }
      if (!blocked) ok.push(l)
    }
    if (ok.length === 0) { s.coinIn = 140; return }
    const lane = ok[(Math.random() * ok.length) | 0]
    for (let i = 0; i < n; i++) {
      s.coins.push({ x: x + i * 32, lane, dy: 0, taken: false, t: Math.random() * 6 })
    }
    s.coinIn = 520 + Math.random() * 420
  }

  // ── update ──
  const update = (s: GState, dt: number) => {
    s.t += dt
    const b = s.b

    if (s.phase === 'play') {
      s.speed = Math.min(SPEED_MAX, SPEED0 + s.dist * 0.014)
      s.dist += s.speed * dt
      s.score = Math.floor(s.dist / 10) + s.coinsCount * 50
      const now = performance.now()
      if (now - pushT.current > 120) { pushT.current = now; setScore(s.score) }

      // перестроение полосы (плавный lerp)
      s.lanePos += (s.laneTarget - s.lanePos) * Math.min(1, dt * LANE_LERP)
      if (Math.abs(s.laneTarget - s.lanePos) < 0.003) s.lanePos = s.laneTarget

      // прыжок
      if (s.jy > 0 || s.jvy > 0) {
        s.airT += dt
        s.jvy -= GRAV * dt
        s.jy += s.jvy * dt
        if (s.jy <= 0) {
          if (s.airT > 0.16) emit(s, b.px, laneBase(b, s.lanePos) - 2, 8, DUST, 110, Math.PI / 2, 2.6, 140, 0.45, 2.8)
          s.jy = 0; s.jvy = 0; s.airT = 0
          if (s.slideQueued) { s.slideQueued = false; s.slideT = SLIDE_TIME; sfx.whoosh(-1) }
        }
      }
      if (s.slideT > 0) s.slideT -= dt

      // искры из-под ног
      if (s.jy <= 0.5 && s.slideT <= 0) {
        s.stepT -= dt
        if (s.stepT <= 0) {
          s.stepT = 0.09
          emit(s, b.px - 8, laneBase(b, s.lanePos) - 1, 1, SPARK, 130, Math.PI, 0.9, 320, 0.3, 2)
        }
      } else s.stepT = 0.05

      // спавн
      s.spawnIn -= s.speed * dt
      if (s.spawnIn <= 0) spawnWave(s)
      s.coinIn -= s.speed * dt
      if (s.coinIn <= 0) spawnCoins(s)

      // движение объектов навстречу + компактизация на месте
      const d = s.speed * dt
      let wj = 0
      for (let i = 0; i < s.obs.length; i++) {
        const o = s.obs[i]
        o.x -= d
        if (o.x > -90) s.obs[wj++] = o
      }
      s.obs.length = wj
      let cj = 0
      for (let i = 0; i < s.coins.length; i++) {
        const c = s.coins[i]
        c.x -= d
        if (c.x > -60 && !c.taken) s.coins[cj++] = c
      }
      s.coins.length = cj

      // коллизии (AABB, хитбокс чуть меньше визуала)
      const base = laneBase(b, s.lanePos)
      const hh = s.slideT > 0 ? H_SLIDE : H_STAND
      const pl = { x: b.px - HIT_W / 2, y: base - s.jy - hh, w: HIT_W, h: hh }
      for (const o of s.obs) {
        if (Math.abs(o.x - b.px) > 90) continue
        const obase = laneBase(b, o.lane)
        let ox = 0, oy = 0, ow = 0, oh = 0
        if (o.type === 'barrier') { ox = o.x; oy = obase - 26; ow = 26; oh = 26 }
        else if (o.type === 'crate') { ox = o.x; oy = obase - 24; ow = 26; oh = 24 }
        else { ox = o.x; oy = obase - 74; ow = 64; oh = 48 } // арка: балка+короб, низ на -26
        if (pl.x < ox + ow && pl.x + pl.w > ox && pl.y < oy + oh && pl.y + pl.h > oy) {
          die()
          break
        }
      }
      // монеты
      const pcx = b.px
      const pcy = base - s.jy - hh / 2
      for (const c of s.coins) {
        if (c.taken) continue
        const cy = laneBase(b, c.lane) - 20 - c.dy
        if (Math.abs(c.x - pcx) < 20 && Math.abs(cy - pcy) < hh / 2 + 9) {
          c.taken = true
          s.coinsCount++
          setCoinsC(s.coinsCount)
          emit(s, c.x, cy, 5, SPARK, 120, -Math.PI / 2, 2.4, 200, 0.35, 2)
          sfx.coin()
        }
      }
    } else if (s.phase === 'over') {
      // мир плавно останавливается, вспышка гаснет
      s.speed = Math.max(0, s.speed - 1500 * dt)
      s.dist += s.speed * dt
      const d = s.speed * dt
      for (const o of s.obs) o.x -= d
      for (const c of s.coins) c.x -= d
      s.flash = Math.max(0, s.flash - dt * 1.05)
      s.shake = Math.max(0, s.shake - dt * 1.3)
    } else {
      // заставка: город живёт
      s.dist += 40 * dt
      s.speed = 60
    }

    // частицы
    for (const p of s.pool) {
      if (!p.active) continue
      p.life -= dt
      if (p.life <= 0) { p.active = false; continue }
      p.vy += p.g * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
  }

  // ── отрисовка ──
  const draw = (ctx: CanvasRenderingContext2D, s: GState) => {
    const b = s.b
    const { w, h, roadTop, laneH } = b
    const g = gradRef.current

    ctx.save()
    if (s.shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * s.shake * 7, (Math.random() * 2 - 1) * s.shake * 5)
    }

    // небо (с запасом по краям — на случай шейка)
    ctx.fillStyle = g ? g.sky : '#0A0E22'
    ctx.fillRect(-12, -12, w + 24, h + 24)

    // звёзды
    ctx.fillStyle = '#E2E8F0'
    for (let i = 0; i < s.stars.length; i++) {
      const st2 = s.stars[i]
      ctx.globalAlpha = 0.18 + 0.6 * Math.abs(Math.sin(s.t * st2.sp + st2.ph))
      ctx.fillRect(st2.x, st2.y, st2.r, st2.r)
    }
    ctx.globalAlpha = 1

    // луна
    const mx = w * 0.79, my = Math.max(34, h * 0.13), mr = Math.min(w, h) * 0.055
    ctx.fillStyle = 'rgba(226,232,240,0.09)'
    ctx.beginPath(); ctx.arc(mx, my, mr * 3.1, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#EEF2FF'
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(203,213,225,0.65)'
    ctx.beginPath(); ctx.arc(mx - mr * 0.3, my + mr * 0.15, mr * 0.22, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(mx + mr * 0.28, my - mr * 0.3, mr * 0.15, 0, Math.PI * 2); ctx.fill()

    // небоскрёбы (3 слоя параллакса)
    for (const L of s.layers) {
      const off = (s.dist * L.fac) % L.total
      for (let i = 0; i < L.arr.length; i++) {
        const bd = L.arr[i]
        let sx = bd.x - off
        if (sx + bd.w < 0) sx += L.total
        if (sx > w) continue
        ctx.fillStyle = L.win ? (i % 2 ? '#131030' : '#161236') : '#191638'
        ctx.fillRect(sx, roadTop - bd.h, bd.w, bd.h)

        // окна
        if (L.win) {
          const cols = Math.floor((bd.w - 8) / 10)
          const rows = Math.floor((bd.h - 12) / 13)
          for (let iy = 0; iy < rows; iy++) {
            for (let ix = 0; ix < cols; ix++) {
              const k = (bd.seed + ix * 3 + iy * 11) % 10
              if (k >= 4) continue
              ctx.fillStyle = k === 0 ? 'rgba(103,232,249,0.5)' : k === 1 ? 'rgba(252,211,77,0.55)' : 'rgba(252,211,77,0.3)'
              ctx.fillRect(sx + 5 + ix * 10, roadTop - bd.h + 8 + iy * 13, 3.5, 5)
            }
          }
        }

        // антенна с мигающим огоньком
        if (bd.seed % 3 === 0 && bd.h > h * 0.12) {
          ctx.fillStyle = '#312E81'
          ctx.fillRect(sx + bd.w / 2 - 1, roadTop - bd.h - 12, 2, 12)
          if (Math.sin(s.t * 2.2 + bd.seed) > 0) {
            ctx.fillStyle = '#F87171'
            ctx.beginPath(); ctx.arc(sx + bd.w / 2, roadTop - bd.h - 13, 1.8, 0, Math.PI * 2); ctx.fill()
          }
        }

        // неон: светящаяся кромка крыши + вывеска (только ближний слой)
        if (L.fac > 0.3) {
          ctx.save()
          ctx.strokeStyle = bd.neon
          ctx.lineWidth = 1.5
          ctx.globalAlpha = 0.75
          ctx.shadowColor = bd.neon
          ctx.shadowBlur = 6
          ctx.beginPath()
          ctx.moveTo(sx, roadTop - bd.h)
          ctx.lineTo(sx + bd.w, roadTop - bd.h)
          ctx.stroke()
          if (bd.seed % 2 === 0) {
            const blink = 0.45 + 0.5 * Math.abs(Math.sin(s.t * 2.4 + bd.seed))
            ctx.globalAlpha = blink
            ctx.fillStyle = bd.neon
            ctx.fillRect(sx + 6, roadTop - bd.h + 10, 5, 16 + (bd.seed % 3) * 6)
          }
          ctx.restore()
        }
      }
    }

    // ── дорога ──
    ctx.fillStyle = g ? g.road : '#0E132B'
    ctx.fillRect(-12, roadTop, w + 24, h - roadTop + 12)

    // тротуар за дорогой + циановый бордюр
    ctx.fillStyle = '#0B0F24'
    ctx.fillRect(-12, roadTop - 12, w + 24, 12)
    ctx.save()
    ctx.strokeStyle = '#22D3EE'
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1.5
    ctx.shadowColor = '#22D3EE'
    ctx.shadowBlur = 5
    ctx.beginPath(); ctx.moveTo(0, roadTop - 0.5); ctx.lineTo(w, roadTop - 0.5); ctx.stroke()
    // розовый бордюр снизу
    ctx.strokeStyle = '#EC4899'
    ctx.shadowColor = '#EC4899'
    ctx.beginPath(); ctx.moveTo(0, h - 1); ctx.lineTo(w, h - 1); ctx.stroke()
    ctx.restore()

    // подсветка целевой полосы
    ctx.fillStyle = 'rgba(34,211,238,0.045)'
    ctx.fillRect(0, roadTop + s.laneTarget * laneH, w, laneH)

    // фиолетовые осевые пунктиры между полосами
    ctx.fillStyle = 'rgba(168,85,247,0.38)'
    const dashOff = s.dist % 44
    for (let l = 1; l <= 2; l++) {
      const y = roadTop + l * laneH - 1.5
      for (let x = -44; x < w + 44; x += 44) ctx.fillRect(x - dashOff, y, 24, 3)
    }

    // мокрый асфальт: неоновые отражения
    for (let i = 0; i < s.streaks.length; i++) {
      const sk = s.streaks[i]
      const span = w + 260
      const sx = (((sk.wx - s.dist) % span) + span) % span - 60
      ctx.globalAlpha = 0.05 + 0.035 * Math.abs(Math.sin(s.t * 1.8 + sk.ph))
      ctx.fillStyle = sk.col
      ctx.fillRect(sx, roadTop + sk.lane * laneH + 6, 2.5, laneH * 0.7)
    }
    ctx.globalAlpha = 1

    // фонари (чередуют циан/розовый), конусы света и лужи света
    const lampOff = s.dist % 235
    for (let k = 0; k * 235 - lampOff < w + 30; k++) {
      const lx = k * 235 - lampOff
      const col = k % 2 ? '#EC4899' : '#22D3EE'
      ctx.fillStyle = '#1E293B'
      ctx.fillRect(lx, roadTop - 52, 3, 40)
      ctx.fillRect(lx - 1, roadTop - 52, 17, 3)
      ctx.save()
      ctx.globalAlpha = 0.05
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.moveTo(lx + 14, roadTop - 49)
      ctx.lineTo(lx - 8, roadTop + 8)
      ctx.lineTo(lx + 36, roadTop + 8)
      ctx.closePath(); ctx.fill()
      ctx.globalAlpha = 0.08
      ctx.beginPath()
      ctx.ellipse(lx + 14, roadTop + 6, 26, 5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.shadowColor = col
      ctx.shadowBlur = 8
      ctx.fillStyle = col
      ctx.beginPath(); ctx.arc(lx + 14, roadTop - 49, 3, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }

    // линии скорости на высокой скорости
    if (s.speed > 430 && s.phase === 'play') {
      const a = Math.min(0.16, ((s.speed - 430) / 190) * 0.16)
      ctx.fillStyle = `rgba(165,243,252,${a})`
      for (let i = 0; i < s.slines.length; i++) {
        const sl = s.slines[i]
        const span = w + sl.len + 60
        const sx = w + 30 - (((s.dist * 1.7 + sl.off) % span + span) % span)
        ctx.fillRect(sx, roadTop + sl.fy * (h - roadTop), sl.len, 1.5)
      }
    }

    // ── монеты ──
    for (let i = 0; i < s.coins.length; i++) {
      const c = s.coins[i]
      if (c.taken) continue
      const cy = laneBase(b, c.lane) - 20 - c.dy
      const spin = Math.cos(s.t * 5 + c.t * 2)
      const rx = 6.5 * Math.abs(spin)
      ctx.fillStyle = 'rgba(250,204,21,0.2)'
      ctx.beginPath(); ctx.arc(c.x, cy, 10, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#FBBF24'
      ctx.strokeStyle = '#B45309'
      ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.ellipse(c.x, cy, Math.max(1.4, rx), 6.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      if (rx > 3) {
        ctx.fillStyle = 'rgba(254,243,199,0.9)'
        ctx.beginPath(); ctx.arc(c.x - rx * 0.3, cy - 2, 1.7, 0, Math.PI * 2); ctx.fill()
      }
    }

    // ── препятствия ──
    for (let i = 0; i < s.obs.length; i++) {
      const o = s.obs[i]
      if (o.x < -90 || o.x > w + 120) continue
      const ob = laneBase(b, o.lane)
      if (o.type === 'barrier') {
        ctx.fillStyle = '#155E75'
        ctx.fillRect(o.x + 2, ob - 14, 3, 14)
        ctx.fillRect(o.x + 21, ob - 14, 3, 14)
        ctx.save()
        ctx.shadowColor = '#EC4899'
        ctx.shadowBlur = 5
        ctx.fillStyle = '#312E81'
        roundRectPath(ctx, o.x, ob - 26, 26, 12, 2)
        ctx.fill()
        ctx.strokeStyle = '#EC4899'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(o.x + 4, ob - 15); ctx.lineTo(o.x + 9, ob - 25)
        ctx.moveTo(o.x + 12, ob - 15); ctx.lineTo(o.x + 17, ob - 25)
        ctx.moveTo(o.x + 20, ob - 15); ctx.lineTo(o.x + 24, ob - 24)
        ctx.stroke()
        ctx.restore()
      } else if (o.type === 'crate') {
        ctx.save()
        ctx.shadowColor = '#22D3EE'
        ctx.shadowBlur = 4
        ctx.fillStyle = '#4C1D95'
        roundRectPath(ctx, o.x, ob - 24, 26, 24, 3)
        ctx.fill()
        ctx.strokeStyle = 'rgba(34,211,238,0.8)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.globalAlpha = 0.35
        ctx.beginPath()
        ctx.moveTo(o.x + 3, ob - 21); ctx.lineTo(o.x + 23, ob - 3)
        ctx.moveTo(o.x + 23, ob - 21); ctx.lineTo(o.x + 3, ob - 3)
        ctx.stroke()
        ctx.restore()
      } else {
        // светофор-арка: балка + висящий светофор (подкат)
        ctx.fillStyle = '#1E1B4B'
        roundRectPath(ctx, o.x, ob - 74, 64, 9, 2)
        ctx.fill()
        ctx.save()
        ctx.shadowColor = '#A855F7'
        ctx.shadowBlur = 5
        ctx.strokeStyle = 'rgba(168,85,247,0.75)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()
        ctx.fillStyle = '#1E1B4B'
        ctx.beginPath()
        ctx.moveTo(o.x + 27, ob - 74); ctx.lineTo(o.x + 32, ob - 82); ctx.lineTo(o.x + 37, ob - 74)
        ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#0F172A'
        ctx.strokeStyle = '#334155'
        ctx.lineWidth = 1.5
        roundRectPath(ctx, o.x + 18, ob - 62, 26, 32, 4)
        ctx.fill(); ctx.stroke()
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(s.t * 4 + o.x * 0.01))
        ctx.save()
        ctx.shadowColor = '#EF4444'
        ctx.shadowBlur = 8
        ctx.globalAlpha = pulse
        ctx.fillStyle = '#EF4444'
        ctx.beginPath(); ctx.arc(o.x + 31, ob - 52, 3.5, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
        ctx.globalAlpha = 0.25
        ctx.fillStyle = '#FBBF24'
        ctx.beginPath(); ctx.arc(o.x + 31, ob - 42, 3, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#4ADE80'
        ctx.beginPath(); ctx.arc(o.x + 31, ob - 36, 3, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    // ── герой ──
    drawRunner(ctx, s)

    // ── частицы ──
    for (let i = 0; i < s.pool.length; i++) {
      const p = s.pool[i]
      if (!p.active) continue
      ctx.globalAlpha = Math.max(0, p.life / p.max)
      ctx.fillStyle = p.col
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
    }
    ctx.globalAlpha = 1

    // виньетка
    if (g) { ctx.fillStyle = g.vig; ctx.fillRect(-12, -12, w + 24, h + 24) }

    // вспышка столкновения
    if (s.flash > 0) {
      ctx.fillStyle = `rgba(248,250,252,${s.flash * 0.5})`
      ctx.fillRect(-12, -12, w + 24, h + 24)
      ctx.fillStyle = `rgba(236,72,153,${s.flash * 0.3})`
      ctx.fillRect(-12, -12, w + 24, h + 24)
    }

    ctx.restore()
  }

  // герой: стилизованный бегун с неоновым визором, шарфом и анимацией ног
  const drawRunner = (ctx: CanvasRenderingContext2D, s: GState) => {
    const b = s.b
    const base = laneBase(b, s.lanePos)
    const fy = base - s.jy
    const px = b.px
    const dead = s.phase === 'over'
    const sliding = s.slideT > 0
    const air = s.jy > 2
    const run = s.phase === 'play' ? Math.sin(s.dist * 0.05) : Math.sin(s.t * 4)

    // тень
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.ellipse(px, base + 3, 13 * Math.max(0.45, 1 - s.jy / 150), 3.6, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.translate(px, fy)
    if (dead) ctx.rotate(1.25)
    else if (sliding) ctx.rotate(0)
    else ctx.rotate(clamp(s.speed / SPEED_MAX * 0.12, 0, 0.12) + (air ? -0.05 : 0))
    ctx.lineCap = 'round'

    if (sliding || dead) {
      // подкат: корпус горизонтально, неоновая искра впереди
      ctx.fillStyle = '#1E1B4B'
      roundRectPath(ctx, -17, -19, 30, 14, 7)
      ctx.fill()
      ctx.strokeStyle = '#EC4899'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(-14, -13); ctx.lineTo(8, -13); ctx.stroke()
      // ноги вытянуты
      ctx.strokeStyle = '#312E81'
      ctx.lineWidth = 4.5
      ctx.beginPath(); ctx.moveTo(-15, -12); ctx.lineTo(-24, -6); ctx.stroke()
      ctx.fillStyle = '#22D3EE'
      ctx.fillRect(-27, -8, 5, 3)
      // голова
      ctx.fillStyle = '#0F0D2E'
      ctx.beginPath(); ctx.arc(15, -13, 7, 0, Math.PI * 2); ctx.fill()
      ctx.save()
      ctx.shadowColor = dead ? '#64748B' : '#22D3EE'
      ctx.shadowBlur = 6
      ctx.fillStyle = dead ? '#64748B' : '#22D3EE'
      roundRectPath(ctx, 14, -16, 8, 4.5, 2)
      ctx.fill()
      ctx.restore()
    } else {
      // ноги (2-фазный бег / группировка в прыжке)
      ctx.strokeStyle = '#312E81'
      ctx.lineWidth = 4.5
      if (air) {
        ctx.beginPath(); ctx.moveTo(-1, -15); ctx.lineTo(-9, -8); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(2, -14); ctx.lineTo(6, -5); ctx.stroke()
        ctx.fillStyle = '#22D3EE'
        ctx.fillRect(-13, -10, 5, 3)
        ctx.fillRect(4, -7, 5, 3)
      } else {
        ctx.beginPath(); ctx.moveTo(-1, -15); ctx.lineTo(-6 - run * 6, -1); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(2, -15); ctx.lineTo(6 + run * 6, -1); ctx.stroke()
        ctx.fillStyle = '#22D3EE'
        ctx.fillRect(-9 - run * 6, -3, 5, 3)
        ctx.fillRect(4 + run * 6, -3, 5, 3)
      }
      // шарф (неоновый след)
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.85 - i * 0.25
        ctx.fillStyle = '#EC4899'
        ctx.beginPath()
        ctx.arc(-11 - i * 5, -27 - i * 0.8 + Math.sin(s.t * 9 + i * 1.4) * 2.2, 4 - i, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      // корпус (куртка с неоновым швом)
      ctx.fillStyle = '#1E1B4B'
      roundRectPath(ctx, -9, -32, 17, 19, 6)
      ctx.fill()
      ctx.strokeStyle = '#EC4899'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(-5, -29); ctx.lineTo(-5, -15); ctx.stroke()
      // рука
      ctx.strokeStyle = '#312E81'
      ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(4, -27); ctx.lineTo(9 - run * 5, -19); ctx.stroke()
      // голова + визор
      ctx.fillStyle = '#0F0D2E'
      ctx.beginPath(); ctx.arc(2, -38, 7, 0, Math.PI * 2); ctx.fill()
      ctx.save()
      ctx.shadowColor = '#22D3EE'
      ctx.shadowBlur = 7
      ctx.fillStyle = '#22D3EE'
      roundRectPath(ctx, 2, -40.5, 8.5, 5, 2.5)
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  }

  // ── главный цикл ──
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (ts - last) / 1000)
      last = ts
      const ctx = ctxRef.current
      if (!ctx) return
      const s = st.current
      update(s, dt)
      draw(ctx, s)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [die])

  // ── свайпы/тап — только на канвасе (touch-action: none) ──
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let sx = 0, sy = 0, t0 = 0, fired = false, active = false

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      active = true; fired = false
      sx = e.clientX; sy = e.clientY; t0 = performance.now()
      try { cv.setPointerCapture(e.pointerId) } catch {}
      e.preventDefault()
    }
    const move = (e: PointerEvent) => {
      if (!active || fired) return
      const dx = e.clientX - sx
      const dy = e.clientY - sy
      if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) return
      fired = true
      if (Math.abs(dx) >= Math.abs(dy)) moveLane(dx > 0 ? 1 : -1)
      else if (dy < 0) doJump()
      else doSlide()
    }
    const up = (e: PointerEvent) => {
      if (!active) return
      active = false
      if (fired) return
      const dx = e.clientX - sx
      const dy = e.clientY - sy
      // тап (без смещения, быстро) = прыжок / старт / рестарт после паузы
      if (performance.now() - t0 < 350 && Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) {
        const s = st.current
        if (s.phase === 'play') doJump()
        else if (s.phase === 'idle') startGame()
        else if (performance.now() - s.deathAt > 700) startGame()
      }
    }
    const ctxm = (e: Event) => e.preventDefault()

    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('contextmenu', ctxm)
    return () => {
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointercancel', up)
      cv.removeEventListener('contextmenu', ctxm)
    }
  }, [moveLane, doJump, doSlide, startGame])

  // ── клавиатура ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const s = st.current
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA':
          e.preventDefault(); moveLane(-1); break
        case 'ArrowRight': case 'KeyD':
          e.preventDefault(); moveLane(1); break
        case 'ArrowUp': case 'KeyW': case 'Space':
          e.preventDefault()
          if (s.phase === 'play') doJump()
          else if (s.phase === 'idle') startGame()
          else if (performance.now() - s.deathAt > 700) startGame()
          break
        case 'ArrowDown': case 'KeyS':
          e.preventDefault(); doSlide(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moveLane, doJump, doSlide, startGame])

  useEffect(() => () => {
    if (loseTimer.current) clearTimeout(loseTimer.current)
  }, [])

  // ── UI ──
  return (
    <div className="h-full flex flex-col items-center px-3 py-3 gap-3">
      {/* статистика */}
      <div className="w-full max-w-xl flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>Счёт</div>
            <div className="text-base font-extrabold tabular-nums" style={{ color: '#EC4899' }}>
              {score.toLocaleString('ru-RU')}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>Монеты</div>
            <div className="text-base font-extrabold tabular-nums text-amber-300">🪙 {coinsC}</div>
          </div>
        </div>
        <div className="text-xs font-bold" style={{ color: 'var(--g-fg-soft)' }}>
          Рекорд: {Math.max(best, score).toLocaleString('ru-RU')}
        </div>
      </div>

      {/* сцена */}
      <div
        ref={wrapRef}
        className="relative w-full max-w-xl rounded-3xl overflow-hidden border"
        style={{
          height: 'min(62vh, 560px)',
          minHeight: 340,
          borderColor: 'var(--g-border)',
          boxShadow: '0 30px 70px -30px rgba(168,85,247,0.45), 0 0 0 1px rgba(236,72,153,0.06)',
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: 'none' }}
          aria-label="Игровое поле: ночной забег"
        />

        {phase !== 'play' && (
          <div
            className="absolute inset-0 grid place-items-center px-5"
            style={{ background: 'rgba(4,6,19,0.55)', backdropFilter: 'blur(3px)' }}
            onClick={(e) => {
              if (e.target !== e.currentTarget) return
              if (phase === 'idle') startGame()
              else if (performance.now() - st.current.deathAt > 700) startGame()
            }}
          >
            <div className="text-center">
              {phase === 'idle' ? (
                <>
                  <div className="text-6xl mb-2 select-none" style={{ filter: 'drop-shadow(0 0 22px rgba(168,85,247,0.8))' }}>🌆</div>
                  <div className="text-2xl font-extrabold tracking-tight text-white mb-1">Ночной забег</div>
                  <p className="text-xs mb-4 leading-relaxed max-w-[300px] mx-auto" style={{ color: 'rgba(246,247,255,0.72)' }}>
                    Неоновый город не ждёт. Уворачивайся, прыгай, скользи — и собирай монеты на бегу.
                  </p>
                  <div className="flex flex-col items-center gap-1.5 mb-5 text-[11px] font-semibold" style={{ color: 'rgba(246,247,255,0.85)' }}>
                    <span className="inline-flex items-center gap-2">
                      <MoveHorizontal className="h-3.5 w-3.5" style={{ color: '#A855F7' }} />
                      Свайп ← → — смена полосы
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <ArrowUp className="h-3.5 w-3.5" style={{ color: '#22D3EE' }} />
                      Свайп ↑ или тап — прыжок
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <ArrowDown className="h-3.5 w-3.5" style={{ color: '#EC4899' }} />
                      Свайп ↓ — подкат под стрелой
                    </span>
                  </div>
                  <button
                    onClick={startGame}
                    className="h-12 px-8 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95 transition-transform"
                    style={{
                      background: 'linear-gradient(135deg,#EC4899,#A855F7)',
                      boxShadow: '0 16px 38px -12px rgba(236,72,153,0.75)',
                    }}
                  >
                    <Play className="h-5 w-5 fill-current" />
                    Побежали!
                  </button>
                </>
              ) : (
                <>
                  <div className="text-6xl mb-2 select-none" style={{ filter: 'drop-shadow(0 0 20px rgba(236,72,153,0.8))' }}>💥</div>
                  <div className="text-2xl font-extrabold tracking-tight text-white mb-1">Столкновение!</div>
                  {newBest && (
                    <div className="inline-block mb-2 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider text-white"
                      style={{ background: 'linear-gradient(135deg,#EC4899,#A855F7)', boxShadow: '0 8px 22px -8px rgba(236,72,153,0.8)' }}>
                      ★ Новый рекорд!
                    </div>
                  )}
                  <p className="text-xs mb-1" style={{ color: 'rgba(246,247,255,0.72)' }}>
                    Счёт: <b className="text-white tabular-nums">{score.toLocaleString('ru-RU')}</b>
                    {' · '}🪙 <b className="text-amber-300 tabular-nums">{coinsC}</b>
                  </p>
                  <p className="text-[11px] mb-5" style={{ color: 'rgba(246,247,255,0.5)' }}>
                    Рекорд: {Math.max(best, score).toLocaleString('ru-RU')}
                  </p>
                  <button
                    onClick={startGame}
                    className="h-12 px-8 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95 transition-transform"
                    style={{
                      background: 'linear-gradient(135deg,#22D3EE,#A855F7)',
                      boxShadow: '0 16px 38px -12px rgba(34,211,238,0.6)',
                    }}
                  >
                    <RotateCcw className="h-[18px] w-[18px]" />
                    Ещё раз
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-center" style={{ color: 'var(--g-fg-mute)' }}>
        ← → полоса · ↑/Space прыжок · ↓ подкат · на телефоне — свайпы
      </p>
    </div>
  )
}
