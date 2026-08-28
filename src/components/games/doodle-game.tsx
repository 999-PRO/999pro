'use client'

// ============================================================================
// v25.25 — «Дудл-прыг»: бесконечный вертикальный прыгун.
//   • Управление: веди пальцем/мышью ГОРИЗОНТАЛЬНО в любом месте канваса —
//     персонаж движется к пальцу. Десктоп: стрелки ←/→ (удерживать).
//   • Платформы: обычные (зелёные), пружины (подброс сильнее), ломкие
//     (коричневые — ломаются после прыжка), движущиеся (голубые, с высоты 400).
//   • Враги (фиолетовые «жучки») с высоты 600: столкновение сбоку/сверху
//     убивает, прыжок НА голову — враг лопается +150 очков.
//   • Экран телепортирует влево/вправо по краям. Падение ниже экрана = конец.
//   • Очки = набранная высота + бонусы. Рекорд — useBest('doodle').
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

interface Plat {
  x: number
  y: number // верх платформы (мировая координата, y растёт вниз)
  w: number
  type: 'norm' | 'move' | 'break'
  vx: number
  spring: boolean
  broken: boolean
  t: number
}

interface Bug {
  x: number
  y: number
  vx: number
  r: number
  dead: boolean
}

interface Star { x: number; y: number; z: number }
interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number }

type Phase = 'idle' | 'play' | 'over'

interface DoodleState {
  phase: Phase
  x: number // центр персонажа (мировая координата)
  y: number // центр персонажа (мировая, y вниз)
  vy: number // +вниз
  r: number
  targetX: number
  squash: number // анимация сжатия при отскоке
  plats: Plat[]
  bugs: Bug[]
  stars: Star[]
  parts: Part[]
  camY: number // мировая координата верхнего края экрана
  topY: number // самая высокая сгенерированная платформа
  baseY: number // стартовый y персонажа (отсчёт «высоты»)
  climb: number // суммарный подъём, px
  bonus: number
  score: number
  t: number
  w: number
  h: number
  keys: Set<string>
}

const G = 1500 // гравитация, px/s²
const JUMP_V = -640
const SPRING_V = -1000
const KEY_SPEED = 340 // скорость стрелок, px/s
const PLAT_H = 11

export function DoodleGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const st = useRef<DoodleState>({
    phase: 'idle' as Phase,
    x: 180,
    y: 0,
    vy: 0,
    r: 14,
    targetX: 180,
    squash: 0,
    plats: [] as Plat[],
    bugs: [] as Bug[],
    stars: [] as Star[],
    parts: [] as Part[],
    camY: 0,
    topY: 0,
    baseY: 0,
    climb: 0,
    bonus: 0,
    score: 0,
    t: 0,
    w: 360,
    h: 560,
    keys: new Set<string>(),
  })

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [best, submitBest] = useBest('doodle')
  const scoredRef = useRef(false)
  const shownRef = useRef(0)

  const resize = useCallback(() => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    st.current.w = rect.width
    st.current.h = rect.height
    cv.width = Math.round(rect.width * dpr)
    cv.height = Math.round(rect.height * dpr)
    cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (st.current.stars.length === 0) {
      st.current.stars = Array.from({ length: 30 }, () => ({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        z: 0.25 + Math.random() * 0.55,
      }))
    }
    // первое открытие: собрать стартовый мир для заставки
    if (st.current.plats.length === 0) initWorld(st.current)
  }, [])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  const startGame = useCallback(() => {
    const s = st.current
    s.phase = 'play'
    initWorld(s)
    s.vy = JUMP_V // стартовый прыжок с базы
    scoredRef.current = false
    shownRef.current = 0
    setScore(0)
    setPhase('play')
    sfx.whoosh(1)
  }, [])

  const die = useCallback(() => {
    const s = st.current
    if (s.phase !== 'play') return
    s.phase = 'over'
    sfx.hurt()
    setPhase('over')
    setScore(s.score)
    if (!scoredRef.current) {
      scoredRef.current = true
      submitBest(s.score)
    }
    sfx.lose()
  }, [submitBest])

  // ── игровой цикл ──
  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const pushScore = (v: number) => {
      // React-стейт не чаще ~8 очков разницы (≈10 раз/сек)
      if (Math.abs(v - shownRef.current) >= 8) {
        shownRef.current = v
        setScore(v)
      }
    }

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.04, (ts - last) / 1000)
      last = ts
      const s = st.current
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return

      s.t += dt

      // ── UPDATE ──
      if (s.phase === 'play') {
        // горизонталь: стрелки двигают цель, персонаж плавно догоняет
        if (s.keys.has('ArrowLeft')) s.targetX -= KEY_SPEED * dt
        if (s.keys.has('ArrowRight')) s.targetX += KEY_SPEED * dt
        s.targetX = ((s.targetX % s.w) + s.w) % s.w
        s.x += (s.targetX - s.x) * Math.min(1, dt * 10)
        // телепорт через края экрана
        if (s.x < 0) s.x += s.w
        else if (s.x > s.w) s.x -= s.w

        // физика
        const prevFeet = s.y + s.r
        s.vy += G * dt
        s.y += s.vy * dt
        const feet = s.y + s.r
        if (s.squash > 0) s.squash = Math.max(0, s.squash - dt * 4)

        // платформы: движущиеся и ломкие
        for (const p of s.plats) {
          if (p.type === 'move') {
            p.x += p.vx * dt
            if (p.x < 4) { p.x = 4; p.vx = Math.abs(p.vx) }
            if (p.x > s.w - p.w - 4) { p.x = s.w - p.w - 4; p.vx = -Math.abs(p.vx) }
          }
          if (p.broken) { p.t += dt; p.y += 300 * dt }
        }
        // жучки патрулируют
        for (const b of s.bugs) {
          b.x += b.vx * dt
          if (b.x < b.r + 2) { b.x = b.r + 2; b.vx = Math.abs(b.vx) }
          if (b.x > s.w - b.r - 2) { b.x = s.w - b.r - 2; b.vx = -Math.abs(b.vx) }
        }

        // столкновение с платформой: только падая (vy>0), ноги пересекают верх
        if (s.vy > 0) {
          for (const p of s.plats) {
            if (p.broken) continue
            if (prevFeet <= p.y + 2 && feet >= p.y && s.x + s.r * 0.75 > p.x && s.x - s.r * 0.75 < p.x + p.w) {
              s.y = p.y - s.r
              if (p.spring) { s.vy = SPRING_V; sfx.jump2() }
              else { s.vy = JUMP_V; sfx.jump() }
              s.squash = 1
              if (p.type === 'break') { p.broken = true; p.t = 0 } // сломалась после прыжка
              break
            }
          }
        }

        // жучки: падение на голову лопает (+150), иначе — столкновение смертельно
        for (const b of s.bugs) {
          if (b.dead) continue
          const dx = s.x - b.x
          const dy = s.y - b.y
          const rr = (s.r + b.r) * 0.9
          if (dx * dx + dy * dy < rr * rr) {
            if (s.vy > 0 && prevFeet <= b.y - b.r * 0.4) {
              b.dead = true
              s.bonus += 150
              s.vy = JUMP_V
              s.squash = 1
              sfx.boom()
              popParticles(s, b.x, b.y)
            } else {
              die()
              break
            }
          }
        }

        // частицы
        for (const pt of s.parts) {
          pt.life -= dt
          pt.x += pt.vx * dt
          pt.y += pt.vy * dt
          pt.vy += 500 * dt
        }
        s.parts = s.parts.filter((pt) => pt.life > 0)

        // камера: выше 45% экрана — сдвигаем мир вниз и копим высоту
        const screenY = s.y - s.camY
        if (screenY < s.h * 0.45) {
          const shift = s.h * 0.45 - screenY
          s.camY -= shift
          s.climb += shift
        }
        s.score = Math.max(0, Math.round(s.climb / 10)) + s.bonus
        pushScore(s.score)

        // генерация выше и уборка ниже
        fillPlats(s)
        s.plats = s.plats.filter((p) => p.y < s.camY + s.h + 80)
        s.bugs = s.bugs.filter((b) => !b.dead && b.y < s.camY + s.h + 80)

        // падение ниже экрана — конец
        if (s.y - s.camY > s.h + 60) die()
      }

      // ── DRAW ──
      drawWorld(ctx, s)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [die])

  // ── управление: палец/мышь + стрелки ──
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const moveTo = (clientX: number) => {
      const rect = cv.getBoundingClientRect()
      st.current.targetX = clientX - rect.left
    }
    const onMove = (e: PointerEvent) => { moveTo(e.clientX) }
    const onDown = (e: PointerEvent) => { cv.setPointerCapture?.(e.pointerId); moveTo(e.clientX) }
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerdown', onDown)
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        st.current.keys.add(e.key)
      }
    }
    const ku = (e: KeyboardEvent) => { st.current.keys.delete(e.key) }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  return (
    <div className="h-full flex flex-col items-center px-3 py-3 gap-3">
      {/* статы */}
      <div className="w-full max-w-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[9px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold">Очки</div>
            <div className="text-base font-extrabold tabular-nums text-yellow-300">{score.toLocaleString('ru-RU')}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold">Высота</div>
            <div className="text-base font-extrabold tabular-nums text-fuchsia-300">{Math.round(st.current.climb)} м</div>
          </div>
        </div>
        <div className="text-xs font-bold text-[var(--g-fg-mute)]">Рекорд: {Math.max(best, score).toLocaleString('ru-RU')}</div>
      </div>

      {/* сцена */}
      <div ref={wrapRef} className="relative flex-1 w-full max-w-md rounded-2xl overflow-hidden border border-[var(--g-chip-border)]" style={{ background: '#1E1B4B', minHeight: 320 }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

        {phase !== 'play' && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[2px]">
            <div className="text-center px-6">
              <div className="text-6xl mb-2">{phase === 'idle' ? '🟡' : '😵'}</div>
              <div className="text-xl font-extrabold text-white mb-1">
                {phase === 'idle' ? 'Дудл-прыг' : 'Дудл упал!'}
              </div>
              <p className="text-xs text-[var(--g-fg-mute)] mb-4 leading-relaxed max-w-[270px] mx-auto">
                {phase === 'idle'
                  ? 'Веди пальцем влево-вправо — дудл сам прыгает по платформам. Пружина подбрасывает выше, ломкая трескается, а жучка лопни прыжком на голову (+150)!'
                  : `Очки: ${score.toLocaleString('ru-RU')} · Рекорд: ${Math.max(best, score).toLocaleString('ru-RU')}`}
              </p>
              <button
                onClick={startGame}
                className="h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95"
                style={{ background: 'linear-gradient(135deg,#A855F7,#6D28D9)', boxShadow: '0 16px 38px -14px rgba(168,85,247,0.7)' }}
              >
                {phase === 'idle' ? <Play className="h-5 w-5 fill-current" /> : <RotateCcw className="h-[18px] w-[18px]" />}
                {phase === 'idle' ? 'Играть' : 'Ещё раз'}
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-white/35 text-center">Веди пальцем по экрану (или ←/→) — прыгай выше и не падай!</p>
    </div>
  )
}

// ── мир: стартовая расстановка ──
function initWorld(s: DoodleState) {
  s.plats = []
  s.bugs = []
  s.parts = []
  s.camY = 0
  s.climb = 0
  s.bonus = 0
  s.score = 0
  s.x = s.w / 2
  s.targetX = s.w / 2
  s.y = s.h - 70
  s.vy = 0
  s.squash = 0
  s.baseY = s.y
  // стартовая платформа прямо под персонажем
  s.plats.push({ x: s.w / 2 - 36, y: s.h - 56, w: 72, type: 'norm', vx: 0, spring: false, broken: false, t: 0 })
  s.topY = s.h - 56
  fillPlats(s)
}

// ── генерация платформ выше topY (зазор 60–95px) ──
function fillPlats(s: DoodleState) {
  let guard = 0
  while (s.topY > s.camY - 80 && guard++ < 40) {
    const gap = 60 + Math.random() * 35
    const y = s.topY - gap
    const pw = 56 + Math.random() * 20
    const x = 6 + Math.random() * Math.max(10, s.w - pw - 12)
    const height = s.baseY - y // набранная высота в этом месте
    let type: Plat['type'] = 'norm'
    if (height > 400 && Math.random() < 0.18) type = 'move'
    else if (Math.random() < 0.14) type = 'break'
    s.plats.push({
      x,
      y,
      w: pw,
      type,
      vx: type === 'move' ? (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 60) : 0,
      spring: type === 'norm' && Math.random() < 0.11,
      broken: false,
      t: 0,
    })
    // жучки с высоты 600
    if (height > 600 && Math.random() < 0.12) {
      s.bugs.push({
        x: 30 + Math.random() * Math.max(20, s.w - 60),
        y: y - 110 - Math.random() * 50,
        vx: (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 50),
        r: 15,
        dead: false,
      })
    }
    s.topY = y
  }
}

function popParticles(s: DoodleState, x: number, y: number) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = 60 + Math.random() * 160
    s.parts.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 60,
      life: 0.4 + Math.random() * 0.3,
      max: 0.7,
    })
  }
}

// ── отрисовка ──
function drawWorld(ctx: CanvasRenderingContext2D, s: DoodleState) {
  const { w, h } = s

  // фон-градиент (зафиксирован)
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#2E1065')
  g.addColorStop(1, '#1E1B4B')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // звёзды-точки с параллаксом
  for (const star of s.stars) {
    const sy = (((star.y - s.camY * star.z) % h) + h) % h
    const tw = 0.3 + 0.5 * Math.abs(Math.sin(s.t * 1.6 + star.x * 0.7))
    ctx.fillStyle = `rgba(224,231,255,${(tw * (0.25 + star.z * 0.55)).toFixed(2)})`
    ctx.beginPath()
    ctx.arc(star.x, sy, 0.8 + star.z * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }

  // платформы
  for (const p of s.plats) drawPlat(ctx, p)

  // жучки
  for (const b of s.bugs) drawBug(ctx, b, s.t)

  // частицы лопнувших жучков
  for (const pt of s.parts) {
    ctx.fillStyle = `rgba(192,132,252,${Math.max(0, pt.life / pt.max).toFixed(2)})`
    ctx.beginPath()
    ctx.arc(pt.x, pt.y - s.camY, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }

  drawPlayer(ctx, s)
}

function drawPlat(ctx: CanvasRenderingContext2D, p: Plat) {
  if (p.broken) {
    // ломкая разваливается и падает
    ctx.save()
    ctx.globalAlpha = Math.max(0, 1 - p.t * 1.4)
    ctx.translate(p.x + p.w / 2, p.y + PLAT_H / 2)
    ctx.rotate(p.t * 1.4)
    ctx.fillStyle = '#92400E'
    roundRect(ctx, -p.w / 2, -PLAT_H / 2, p.w, PLAT_H, 5)
    ctx.fill()
    ctx.restore()
    return
  }
  const cols =
    p.type === 'move' ? ['#38BDF8', '#7DD3FC', '#0284C7']
    : p.type === 'break' ? ['#B45309', '#D97706', '#7C2D12']
    : ['#22C55E', '#4ADE80', '#15803D']
  ctx.fillStyle = cols[0]
  roundRect(ctx, p.x, p.y, p.w, PLAT_H, 5)
  ctx.fill()
  ctx.fillStyle = cols[1]
  roundRect(ctx, p.x + 3, p.y + 1.5, p.w - 6, 3, 1.5)
  ctx.fill()
  // трещина на ломкой
  if (p.type === 'break') {
    ctx.strokeStyle = 'rgba(56,26,6,0.75)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(p.x + p.w * 0.32, p.y + 2)
    ctx.lineTo(p.x + p.w * 0.46, p.y + 6)
    ctx.lineTo(p.x + p.w * 0.36, p.y + 9.5)
    ctx.stroke()
  }
  // пружина-зигзаг
  if (p.spring) {
    const sx = p.x + p.w - 13
    ctx.strokeStyle = '#CBD5E1'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(sx - 5, p.y - 1)
    ctx.lineTo(sx + 5, p.y - 4)
    ctx.lineTo(sx - 5, p.y - 7)
    ctx.lineTo(sx + 5, p.y - 10)
    ctx.stroke()
    ctx.fillStyle = '#E2E8F0'
    roundRect(ctx, sx - 8, p.y - 14, 16, 4, 2)
    ctx.fill()
  }
}

function drawBug(ctx: CanvasRenderingContext2D, b: Bug, t: number) {
  const y = b.y + Math.sin(t * 5 + b.x * 0.1) * 2 // покачивание
  // шипы
  ctx.fillStyle = '#6D28D9'
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + t * 0.7
    ctx.beginPath()
    ctx.moveTo(b.x + Math.cos(a - 0.24) * (b.r - 1), y + Math.sin(a - 0.24) * (b.r - 1))
    ctx.lineTo(b.x + Math.cos(a) * (b.r + 5), y + Math.sin(a) * (b.r + 5))
    ctx.lineTo(b.x + Math.cos(a + 0.24) * (b.r - 1), y + Math.sin(a + 0.24) * (b.r - 1))
    ctx.closePath()
    ctx.fill()
  }
  // тело
  ctx.fillStyle = '#A855F7'
  ctx.beginPath()
  ctx.arc(b.x, y, b.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#7E22CE'
  ctx.lineWidth = 2
  ctx.stroke()
  // глаза
  const look = Math.sign(b.vx) * 1.4
  ctx.fillStyle = '#FFFFFF'
  ctx.beginPath(); ctx.arc(b.x - 5, y - 2, 3.6, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(b.x + 5, y - 2, 3.6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#1F2937'
  ctx.beginPath(); ctx.arc(b.x - 5 + look, y - 2, 1.7, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(b.x + 5 + look, y - 2, 1.7, 0, Math.PI * 2); ctx.fill()
  // злые брови
  ctx.strokeStyle = '#4C1D95'
  ctx.lineWidth = 1.8
  ctx.beginPath(); ctx.moveTo(b.x - 8.5, y - 7.5); ctx.lineTo(b.x - 2.5, y - 5); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(b.x + 8.5, y - 7.5); ctx.lineTo(b.x + 2.5, y - 5); ctx.stroke()
}

function drawPlayer(ctx: CanvasRenderingContext2D, s: DoodleState) {
  const px = s.x
  const py = s.y - s.camY
  const sq = s.squash * 0.16 // сжатие при отскоке
  ctx.save()
  ctx.translate(px, py)
  ctx.scale(1 + sq, 1 - sq)
  // ножки
  const legSwing = Math.max(-4, Math.min(4, -s.vy * 0.006))
  ctx.strokeStyle = '#B45309'
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(-5, 11); ctx.lineTo(-8, 16 + legSwing); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(5, 11); ctx.lineTo(8, 16 - legSwing); ctx.stroke()
  // тело — жёлтый кружок
  ctx.fillStyle = '#FACC15'
  ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#B45309'
  ctx.lineWidth = 2
  ctx.stroke()
  // румянец
  ctx.fillStyle = 'rgba(251,113,133,0.5)'
  ctx.beginPath(); ctx.arc(-8.5, 3.5, 2.6, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(8.5, 3.5, 2.6, 0, Math.PI * 2); ctx.fill()
  // глаза (смотрят по движению)
  const look = Math.max(-2.2, Math.min(2.2, (s.targetX - s.x) * 0.05))
  ctx.fillStyle = '#FFFFFF'
  ctx.beginPath(); ctx.arc(-5 + look * 0.4, -3, 3.6, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(5 + look * 0.4, -3, 3.6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#1F2937'
  ctx.beginPath(); ctx.arc(-5 + look, -2.6, 1.8, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(5 + look, -2.6, 1.8, 0, Math.PI * 2); ctx.fill()
  // улыбка
  ctx.strokeStyle = '#92400E'
  ctx.lineWidth = 1.8
  ctx.lineCap = 'round'
  ctx.beginPath(); ctx.arc(0, 3.5, 5, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke()
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}
