'use client'

// ============================================================================
// v25.25 — «ТАНЧИКИ» (Battle City style) — аркада на выживание с волнами.
//   • Поле 13×13 клеток, процедурная СИММЕТРИЧНАЯ карта: кирпич (разрушается
//     пулями) + сталь (неразрушима); проходимость гарантируется BFS-карвом
//     путей от спавна игрока к трём верхним точкам спавна врагов.
//   • Игрок: танк в центре снизу, 3 жизни (до 4 аптечкой); скольжение по сетке
//     с привязкой к полуклетке на повороте (как в оригинале).
//   • Враги волнами (4+wave/2, одновременно ≤5): обычный (100 очков, 1hp),
//     быстрый (200, 1hp), тяжёлый (400, 3hp — темнеет с уроном). ИИ: на
//     перекрёстках идёт к игроку, в тупике разворачивается, стреляет с
//     кулдауном 1–2с в сторону игрока. Пули врагов и игрока аннигилируют.
//   • Бонусы (15% с подбитого танка): ⭐ апгрейд до 2 ур., ✚ +1 жизнь, 🛡 щит 6с.
//   • Управление: WASD/стрелки + пробел; на мобиле D-pad (56px) + «ОГОНЬ».
//   • Нео-ретро: градиентные танки с анимированными гусеницами, частицы,
//     вспышка + ударная волна + тряска канваса. Рекорд useBest('tanks').
// ============================================================================

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Play, RotateCcw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Heart } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'

// ── константы поля ──────────────────────────────────────────────────────────
const N = 13             // клеток по стороне
const CELL = 30          // логических px на клетку
const FIELD = N * CELL   // 390 — логический размер поля
const TANK = 26          // размер танка
const TANK_HALF = TANK / 2
const MAX_LIVES = 4
const INVULN_TIME = 2.2
const SHIELD_TIME = 6
const POWER_CHANCE = 0.15
const MAX_ENEMIES_ON_FIELD = 5
const PLAYER_COOLDOWN = [0.35, 0.26, 0.19] // по уровню звезды
const PLAYER_SPEED = [78, 92, 106]          // по уровню звезды
const PLAYER_BULLET_SPEED = 220

// направления: 0 вверх, 1 вправо, 2 вниз, 3 влево
type Dir = 0 | 1 | 2 | 3
const DIRV: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]]
const OPP: ReadonlyArray<Dir> = [2, 3, 0, 1]

// тайлы: 0 пусто, 1 кирпич, 2 сталь
type Tile = 0 | 1 | 2
type Phase = 'idle' | 'play' | 'over'
type Kind = 'player' | 'basic' | 'fast' | 'heavy'
type PowerKind = 'star' | 'med' | 'shield'

interface EnemyStat { speed: number; hp: number; score: number }
const STATS: Record<'basic' | 'fast' | 'heavy', EnemyStat> = {
  basic: { speed: 52, hp: 1, score: 100 },
  fast: { speed: 92, hp: 1, score: 200 },
  heavy: { speed: 38, hp: 3, score: 400 },
}

interface Tank {
  kind: Kind
  id: number
  x: number
  y: number
  dir: Dir
  tread: number
  hp: number
  maxHp: number
  speed: number
  shootT: number
  spawnT: number
  flash: number
  blockT: number
  alive: boolean
}

interface Bullet { x: number; y: number; dir: Dir; speed: number; owner: 0 | 1; tankId: number; dead: boolean }
interface Power { x: number; y: number; kind: PowerKind; t: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number }
interface Ring { x: number; y: number; r: number; vr: number; life: number; max: number; color: string; lw: number }
interface Pop { x: number; y: number; text: string; life: number; color: string }

interface GS {
  phase: Phase
  wave: number
  score: number
  lives: number
  grid: Tile[][]
  player: Tank
  starLevel: number
  shieldT: number
  invulnT: number
  cooldown: number
  enemies: Tank[]
  bullets: Bullet[]
  powers: Power[]
  particles: Particle[]
  rings: Ring[]
  pops: Pop[]
  queue: Kind[]
  spawnT: number
  enemyShootBase: number
  enemySpeedMul: number
  bannerT: number
  bannerText: string
  shakeT: number
  shakeDur: number
  shakeMag: number
  flashT: number
  flashColor: string
  uid: number
  t: number
  hudT: number
  size: number
  dpr: number
  // ввод
  dirs: Dir[]
  fireBtn: boolean
  fireKey: boolean
}

// ── утилиты ─────────────────────────────────────────────────────────────────
const cx = (i: number) => i * CELL + CELL / 2 // центр клетки i
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const centerOf = (v: number) => Math.round((v - CELL / 2) / CELL) * CELL + CELL / 2

function shadeHex(hex: string, mul: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(r * mul)},${Math.round(g * mul)},${Math.round(b * mul)})`
}

// ── генерация карты (симметричная, с гарантией проходимости через BFS) ──────
const SPAWN_CELLS_X = [0, 6, 12]
const PLAYER_CELL = { x: 6, y: 12 }

function genMap(): Tile[][] {
  const g: Tile[][] = []
  for (let y = 0; y < N; y++) g.push(new Array<Tile>(N).fill(0))

  // зоны спавнов всегда свободны (3×3 вокруг игрока и каждой точки врагов)
  const keep = new Set<string>()
  const addKeep = (cxp: number, cyp: number) => {
    for (let y = cyp - 1; y <= cyp + 1; y++)
      for (let x = cxp - 1; x <= cxp + 1; x++)
        if (x >= 0 && x < N && y >= 0 && y < N) keep.add(x + ',' + y)
  }
  addKeep(PLAYER_CELL.x, PLAYER_CELL.y)
  for (const sx of SPAWN_CELLS_X) addKeep(sx, 0)

  // заполняем левую половину, зеркалим вправо — симметричный нео-ретро узор
  for (let y = 0; y < N; y++) {
    for (let x = 0; x <= 6; x++) {
      if (keep.has(x + ',' + y)) continue
      const r = Math.random()
      let t: Tile = 0
      if (r < 0.3) t = 1          // кирпич
      else if (r < 0.375) t = 2   // сталь
      g[y][x] = t
      g[y][N - 1 - x] = t
    }
  }

  // BFS от игрока; если верхний спавн недостижим — прокапываем путь
  const solid = (x: number, y: number) => g[y][x] !== 0
  const bfs = (): boolean[][] => {
    const vis: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false))
    const q: Array<[number, number]> = [[PLAYER_CELL.x, PLAYER_CELL.y]]
    vis[PLAYER_CELL.y][PLAYER_CELL.x] = true
    while (q.length) {
      const cur = q.shift() as [number, number]
      for (const d of DIRV) {
        const nx = cur[0] + d[0], ny = cur[1] + d[1]
        if (nx < 0 || nx >= N || ny < 0 || ny >= N || vis[ny][nx] || solid(nx, ny)) continue
        vis[ny][nx] = true
        q.push([nx, ny])
      }
    }
    return vis
  }

  let vis = bfs()
  for (const sx of SPAWN_CELLS_X) {
    if (vis[0][sx]) continue
    let x = PLAYER_CELL.x, y = PLAYER_CELL.y
    const carve = () => { g[y][x] = 0 }
    carve()
    const xFirst = Math.random() < 0.5
    const goX = () => { while (x !== sx) { x += sx > x ? 1 : -1; carve() } }
    const goY = () => { while (y !== 0) { y -= 1; carve() } }
    if (xFirst) { goX(); goY() } else { goY(); goX() }
    vis = bfs()
  }
  return g
}

// ── схемы отрисовки танков ──────────────────────────────────────────────────
interface Scheme { bodyA: string; bodyB: string; turret: string; barrel: string; tread: string; glow: string }
const SCHEMES: Record<Kind, Scheme> = {
  player: { bodyA: '#FDE047', bodyB: '#CA8A04', turret: '#A16207', barrel: '#3F3F46', tread: '#222B3A', glow: '#A3E635' },
  basic:  { bodyA: '#E2E8F0', bodyB: '#64748B', turret: '#475569', barrel: '#334155', tread: '#1E2633', glow: '#94A3B8' },
  fast:   { bodyA: '#67E8F9', bodyB: '#0E7490', turret: '#155E75', barrel: '#164E63', tread: '#12303B', glow: '#22D3EE' },
  heavy:  { bodyA: '#FCA5A5', bodyB: '#B91C1C', turret: '#7F1D1D', barrel: '#450A0A', tread: '#2A1214', glow: '#F87171' },
}
const POWER_STYLE: Record<PowerKind, { color: string; label: string }> = {
  star: { color: '#FACC15', label: '⭐' },
  med: { color: '#F87171', label: '✚' },
  shield: { color: '#38BDF8', label: '🛡' },
}

// ── состояние ───────────────────────────────────────────────────────────────
function makeTank(kind: Kind, x: number, y: number, id: number): Tank {
  const st = kind === 'player' ? { speed: PLAYER_SPEED[0], hp: 1, score: 0 } : STATS[kind]
  return { kind, id, x, y, dir: kind === 'player' ? 0 : 2, tread: 0, hp: st.hp, maxHp: st.hp, speed: st.speed, shootT: 1.5, spawnT: 0.4, flash: 0, blockT: 0, alive: true }
}

function makeState(): GS {
  return {
    phase: 'idle', wave: 1, score: 0, lives: 3,
    grid: genMap(),
    player: makeTank('player', cx(PLAYER_CELL.x), cx(PLAYER_CELL.y), 0),
    starLevel: 0, shieldT: 0, invulnT: 0, cooldown: 0,
    enemies: [], bullets: [], powers: [], particles: [], rings: [], pops: [],
    queue: [], spawnT: 0, enemyShootBase: 2.1, enemySpeedMul: 1,
    bannerT: 0, bannerText: '',
    shakeT: 0, shakeDur: 1, shakeMag: 0,
    flashT: 0, flashColor: 'rgba(255,200,120,0.16)',
    uid: 1, t: 0, hudT: 0, size: 390, dpr: 1,
    dirs: [], fireBtn: false, fireKey: false,
  }
}

function buildQueue(w: number): Kind[] {
  const count = 4 + Math.floor(w / 2)
  const q: Kind[] = []
  const pHeavy = Math.min(0.35, 0.06 + w * 0.05)
  const pFast = Math.min(0.45, 0.08 + w * 0.055)
  for (let i = 0; i < count; i++) {
    const r = Math.random()
    q.push(r < pHeavy ? 'heavy' : r < pHeavy + pFast ? 'fast' : 'basic')
  }
  return q
}

function startWave(s: GS, w: number) {
  s.wave = w
  s.grid = genMap()
  s.bullets = []
  s.powers = []
  s.enemies = []
  const p = s.player
  p.x = cx(PLAYER_CELL.x); p.y = cx(PLAYER_CELL.y); p.dir = 0
  p.alive = true; p.spawnT = 0.45; p.tread = 0; p.flash = 0; p.blockT = 0
  s.invulnT = Math.max(s.invulnT, 1.5)
  s.queue = buildQueue(w)
  s.spawnT = 1.0
  s.enemyShootBase = Math.max(1.0, 2.2 - w * 0.12)
  s.enemySpeedMul = Math.min(1.6, 1 + (w - 1) * 0.06)
}

// ── эффекты ─────────────────────────────────────────────────────────────────
function addParticles(s: GS, x: number, y: number, n: number, colors: string[], spd: number, life: number, size: number, grav = 0) {
  for (let i = 0; i < n; i++) {
    if (s.particles.length > 300) s.particles.shift()
    const a = Math.random() * Math.PI * 2
    const v = spd * (0.25 + Math.random() * 0.95)
    s.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: life * (0.5 + Math.random() * 0.7), max: life,
      size: size * (0.6 + Math.random() * 0.8),
      color: colors[(Math.random() * colors.length) | 0], grav,
    })
  }
}

function explode(s: GS, x: number, y: number, big: boolean, glow: string) {
  addParticles(s, x, y, big ? 28 : 13, [glow, '#FDE68A', '#FFFFFF', '#F97316'], big ? 175 : 115, big ? 0.7 : 0.45, big ? 3.6 : 2.6, 70)
  s.rings.push({ x, y, r: big ? 6 : 4, vr: big ? 270 : 180, life: big ? 0.45 : 0.3, max: big ? 0.45 : 0.3, color: 'rgba(255,176,80,0.9)', lw: big ? 3 : 2 })
  s.flashT = Math.max(s.flashT, big ? 0.12 : 0.06)
  s.flashColor = 'rgba(255,200,120,0.16)'
  s.shakeT = big ? 0.4 : 0.18
  s.shakeDur = s.shakeT
  s.shakeMag = big ? 6 : 2.6
}

function addPop(s: GS, x: number, y: number, text: string, color: string) {
  s.pops.push({ x, y, text, life: 0.9, color })
  if (s.pops.length > 12) s.pops.shift()
}

// ── коллизии ────────────────────────────────────────────────────────────────
function rectHitsTile(s: GS, x0: number, y0: number, x1: number, y1: number): boolean {
  const gx0 = Math.floor(x0 / CELL), gx1 = Math.floor((x1 - 0.01) / CELL)
  const gy0 = Math.floor(y0 / CELL), gy1 = Math.floor((y1 - 0.01) / CELL)
  for (let gy = gy0; gy <= gy1; gy++) {
    if (gy < 0 || gy >= N) continue
    for (let gx = gx0; gx <= gx1; gx++) {
      if (gx < 0 || gx >= N) continue
      if (s.grid[gy][gx] !== 0) return true
    }
  }
  return false
}

function tankBlocked(s: GS, self: Tank | null, x: number, y: number): boolean {
  // страховка от софтлока: если танк УЖЕ пересекается с другим (игрок возродился
  // поверх врага) — разрешаем движение, чтобы они могли разъехаться
  if (self) {
    const p0 = s.player
    if (self !== p0 && p0.alive && Math.abs(p0.x - self.x) < TANK && Math.abs(p0.y - self.y) < TANK) return false
    for (const e of s.enemies) {
      if (e === self || !e.alive) continue
      if (Math.abs(e.x - self.x) < TANK && Math.abs(e.y - self.y) < TANK) return false
    }
  }
  const p = s.player
  if (self !== p && p.alive && p.spawnT <= 0 && Math.abs(p.x - x) < TANK && Math.abs(p.y - y) < TANK) return true
  for (const e of s.enemies) {
    if (e === self || !e.alive || e.spawnT > 0) continue
    if (Math.abs(e.x - x) < TANK && Math.abs(e.y - y) < TANK) return true
  }
  return false
}

function canPlace(s: GS, self: Tank | null, x: number, y: number): boolean {
  if (x - TANK_HALF < 0 || y - TANK_HALF < 0 || x + TANK_HALF > FIELD || y + TANK_HALF > FIELD) return false
  if (rectHitsTile(s, x - TANK_HALF, y - TANK_HALF, x + TANK_HALF, y + TANK_HALF)) return false
  if (tankBlocked(s, self, x, y)) return false
  return true
}

function tryMove(s: GS, t: Tank, dir: Dir, dist: number): boolean {
  const d = DIRV[dir]
  const nx = t.x + d[0] * dist, ny = t.y + d[1] * dist
  if (!canPlace(s, t, nx, ny)) return false
  t.x = nx; t.y = ny
  t.tread += dist
  return true
}

// привязка к ближайшей полуклеточной оси (центру клетки) — «скольжение по сетке»
function snapAxis(s: GS, t: Tank, axis: 0 | 1): boolean {
  if (axis === 0) { // вертикальное движение → выравниваем x
    const sx = clamp(centerOf(t.x), TANK_HALF, FIELD - TANK_HALF)
    if (sx !== t.x && canPlace(s, t, sx, t.y)) { t.x = sx; return true }
  } else {
    const sy = clamp(centerOf(t.y), TANK_HALF, FIELD - TANK_HALF)
    if (sy !== t.y && canPlace(s, t, t.x, sy)) { t.y = sy; return true }
  }
  return false
}

// ── ИИ врагов ───────────────────────────────────────────────────────────────
function dirFreeCell(s: GS, cxp: number, cyp: number, d: Dir): boolean {
  const d2 = DIRV[d]
  const nx = cxp + d2[0], ny = cyp + d2[1]
  if (nx < 0 || nx >= N || ny < 0 || ny >= N) return false
  return s.grid[ny][nx] === 0
}

function enemyDecide(s: GS, e: Tank) {
  const gx = Math.round((e.x - CELL / 2) / CELL)
  const gy = Math.round((e.y - CELL / 2) / CELL)
  const opts: Dir[] = []
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    if (d === OPP[e.dir]) continue
    if (dirFreeCell(s, gx, gy, d)) opts.push(d)
  }
  if (opts.length === 0) { e.dir = OPP[e.dir]; return } // тупик — разворот
  const p = s.player
  const dxp = p.x - e.x, dyp = p.y - e.y
  const toward: Dir = Math.abs(dxp) > Math.abs(dyp) ? (dxp > 0 ? 1 : 3) : (dyp > 0 ? 2 : 0)
  if (Math.random() < 0.72 && opts.indexOf(toward) !== -1) e.dir = toward
  else e.dir = opts[(Math.random() * opts.length) | 0]
}

function enemyUpdate(s: GS, e: Tank, dt: number) {
  if (e.spawnT > 0) { e.spawnT -= dt; return }
  e.flash = Math.max(0, e.flash - dt)

  // выстрел с кулдауном 1–2с в сторону игрока
  e.shootT -= dt
  if (e.shootT <= 0) {
    e.shootT = s.enemyShootBase * rnd(0.55, 1.15)
    const hasBullet = s.bullets.some((b) => !b.dead && b.owner === 1 && b.tankId === e.id)
    if (!hasBullet) {
      const p = s.player
      const dxp = p.x - e.x, dyp = p.y - e.y
      const aligned = Math.abs(dxp) < CELL * 0.6 || Math.abs(dyp) < CELL * 0.6
      if (aligned || Math.random() < 0.35) {
        const aim: Dir = Math.abs(dxp) > Math.abs(dyp) ? (dxp > 0 ? 1 : 3) : (dyp > 0 ? 2 : 0)
        e.dir = aim
      }
      const d = DIRV[e.dir]
      s.bullets.push({
        x: e.x + d[0] * (TANK_HALF + 3), y: e.y + d[1] * (TANK_HALF + 3),
        dir: e.dir, speed: Math.min(175, 118 + s.wave * 6), owner: 1, tankId: e.id, dead: false,
      })
    }
  }

  // движение: решаем на пересечениях центров клеток, при блоке — выбираем заново
  const moving = e.dir
  const before = moving % 2 === 0 ? e.y : e.x
  if (!tryMove(s, e, e.dir, e.speed * dt)) {
    e.blockT += dt
    if (e.blockT > 0.18) {
      e.blockT = 0
      enemyDecide(s, e)
    }
  } else {
    e.blockT = 0
    const after = moving % 2 === 0 ? e.y : e.x
    if (centerOf(before) !== centerOf(after)) enemyDecide(s, e)
  }
}

// ── спавн врагов ────────────────────────────────────────────────────────────
function spotFree(s: GS, x: number, y: number): boolean {
  const gx = Math.round((x - CELL / 2) / CELL), gy = Math.round((y - CELL / 2) / CELL)
  if (gx < 0 || gx >= N || gy < 0 || gy >= N || s.grid[gy][gx] !== 0) return false
  const p = s.player
  if (p.alive && Math.abs(p.x - x) < TANK + 6 && Math.abs(p.y - y) < TANK + 6) return false
  for (const e of s.enemies) {
    if (e.alive && Math.abs(e.x - x) < TANK + 6 && Math.abs(e.y - y) < TANK + 6) return false
  }
  return true
}

function spawnEnemy(s: GS): boolean {
  const order = [0, 1, 2].sort(() => Math.random() - 0.5)
  for (const i of order) {
    const x = cx(SPAWN_CELLS_X[i]), y = cx(0)
    if (!spotFree(s, x, y)) continue
    const kind = s.queue.shift()
    if (!kind) return false
    const e = makeTank(kind, x, y, ++s.uid)
    e.speed = STATS[kind].speed * s.enemySpeedMul
    e.spawnT = 1.0
    e.shootT = s.enemyShootBase * rnd(0.6, 1.2)
    s.enemies.push(e)
    return true
  }
  return false
}

// ── смерть / попадания ──────────────────────────────────────────────────────
function killEnemy(s: GS, e: Tank) {
  e.alive = false
  const stat = STATS[e.kind]
  s.score += stat.score
  explode(s, e.x, e.y, true, SCHEMES[e.kind].glow)
  addPop(s, e.x, e.y - 10, '+' + stat.score, '#FDE68A')
  sfx.boom()
  if (Math.random() < POWER_CHANCE) {
    const r = Math.random()
    const kind: PowerKind = r < 0.4 ? 'star' : r < 0.7 ? 'med' : 'shield'
    s.powers.push({ x: e.x, y: e.y, kind, t: 0 })
  }
}

function hitPlayer(s: GS, onOver: () => void) {
  const p = s.player
  if (s.phase !== 'play' || s.invulnT > 0) return
  if (s.shieldT > 0) {
    s.rings.push({ x: p.x, y: p.y, r: 10, vr: 190, life: 0.3, max: 0.3, color: 'rgba(56,189,248,0.85)', lw: 2.5 })
    sfx.tick()
    return
  }
  p.alive = false
  explode(s, p.x, p.y, true, SCHEMES.player.glow)
  sfx.boom()
  s.lives--
  if (s.lives <= 0) {
    onOver()
    return
  }
  // респавн с неуязвимостью
  p.x = cx(PLAYER_CELL.x); p.y = cx(PLAYER_CELL.y); p.dir = 0
  p.alive = true; p.spawnT = 0.45
  s.invulnT = INVULN_TIME
}

function applyPower(s: GS, pw: Power) {
  sfx.coin()
  if (pw.kind === 'star') {
    if (s.starLevel < 2) { s.starLevel++; s.player.speed = PLAYER_SPEED[s.starLevel]; addPop(s, pw.x, pw.y - 8, '⭐ УСКОРЕНИЕ!', '#FACC15') }
    else addPop(s, pw.x, pw.y - 8, '⭐ МАКСИМУМ', '#FACC15')
  } else if (pw.kind === 'med') {
    if (s.lives < MAX_LIVES) { s.lives++; addPop(s, pw.x, pw.y - 8, '✚ +1 ЖИЗНЬ', '#F87171') }
    else addPop(s, pw.x, pw.y - 8, '✚ МАКСИМУМ', '#F87171')
  } else {
    s.shieldT = SHIELD_TIME
    addPop(s, pw.x, pw.y - 8, '🛡 ЩИТ 6с', '#38BDF8')
  }
}

function waveClear(s: GS) {
  s.bannerText = `Волна ${s.wave} пройдена! +250`
  s.bannerT = 2.4
  s.score += 250
  sfx.win()
  startWave(s, s.wave + 1)
}

// ── главный update ──────────────────────────────────────────────────────────
function update(s: GS, dt: number, onOver: () => void) {
  s.t += dt
  s.shakeT = Math.max(0, s.shakeT - dt)
  s.flashT = Math.max(0, s.flashT - dt)
  if (s.bannerT > 0) s.bannerT = Math.max(0, s.bannerT - dt)
  s.invulnT = Math.max(0, s.invulnT - dt)
  s.shieldT = Math.max(0, s.shieldT - dt)

  const p = s.player

  // ── игрок: движение со скольжением по сетке ──
  if (p.alive && p.spawnT <= 0) {
    p.flash = Math.max(0, p.flash - dt)
    const d = s.dirs.length ? s.dirs[s.dirs.length - 1] : null
    if (d !== null) {
      if (d !== p.dir) {
        const perp = d % 2 !== p.dir % 2
        if (perp) snapAxis(s, p, d % 2 === 0 ? 0 : 1)
        p.dir = d
      }
      if (!tryMove(s, p, d, PLAYER_SPEED[s.starLevel] * dt)) {
        // упёрлись — возможно, танк чуть съехал с оси: подтягиваемся к центру клетки,
        // чтобы проскользнуть в проход (защита от застревания у углов стен)
        snapAxis(s, p, d % 2 === 0 ? 0 : 1)
      }
    }

    // ── стрельба: кулдаун + максимум 2 свои пули ──
    s.cooldown -= dt
    if ((s.fireBtn || s.fireKey) && s.cooldown <= 0) {
      const mine = s.bullets.filter((b) => !b.dead && b.owner === 0).length
      if (mine < 2) {
        const d2 = DIRV[p.dir]
        s.bullets.push({
          x: p.x + d2[0] * (TANK_HALF + 3), y: p.y + d2[1] * (TANK_HALF + 3),
          dir: p.dir, speed: PLAYER_BULLET_SPEED + s.starLevel * 15, owner: 0, tankId: 0, dead: false,
        })
        s.cooldown = PLAYER_COOLDOWN[s.starLevel]
        p.flash = 0.06
        sfx.shoot()
      }
    }
  }
  p.spawnT = Math.max(0, p.spawnT - dt)

  // ── спавн врагов волнами ──
  if (s.bannerT <= 0) {
    s.spawnT -= dt
    const onField = s.enemies.reduce((acc, e) => acc + (e.alive ? 1 : 0), 0)
    if (s.queue.length > 0 && onField < MAX_ENEMIES_ON_FIELD && s.spawnT <= 0) {
      if (spawnEnemy(s)) s.spawnT = Math.max(1.0, 2.4 - s.wave * 0.15) * rnd(0.85, 1.1)
      else s.spawnT = 0.5
    }
  }

  // ── враги ──
  for (const e of s.enemies) if (e.alive) enemyUpdate(s, e, dt)

  // ── пули ──
  for (const b of s.bullets) {
    if (b.dead) continue
    const d = DIRV[b.dir]
    b.x += d[0] * b.speed * dt
    b.y += d[1] * b.speed * dt

    // границы поля
    if (b.x < 2 || b.x > FIELD - 2 || b.y < 2 || b.y > FIELD - 2) {
      b.dead = true
      addParticles(s, b.x, b.y, 4, ['#CBD5E1', '#94A3B8'], 60, 0.25, 1.8)
      continue
    }

    // тайлы: кирпич разрушается, сталь отражает
    const gx = Math.floor(b.x / CELL), gy = Math.floor(b.y / CELL)
    const tile = s.grid[gy]?.[gx] ?? 0
    if (tile !== 0) {
      b.dead = true
      const wx = gx * CELL + CELL / 2, wy = gy * CELL + CELL / 2
      if (tile === 1) {
        s.grid[gy][gx] = 0
        addParticles(s, wx, wy, 12, ['#C2540A', '#7C2D12', '#FDBA74'], 105, 0.5, 2.6, 130)
        sfx.capture()
      } else {
        addParticles(s, b.x, b.y, 6, ['#E2E8F0', '#94A3B8', '#FFFFFF'], 90, 0.3, 1.9)
        sfx.tick()
      }
      continue
    }

    // пуля-танк
    if (b.owner === 0) {
      for (const e of s.enemies) {
        if (!e.alive || e.spawnT > 0) continue
        if (Math.abs(e.x - b.x) < TANK_HALF + 2 && Math.abs(e.y - b.y) < TANK_HALF + 2) {
          b.dead = true
          e.hp--
          e.flash = 0.12
          if (e.hp <= 0) killEnemy(s, e)
          else {
            addParticles(s, b.x, b.y, 7, [SCHEMES[e.kind].glow, '#FDE68A'], 100, 0.35, 2.2)
            sfx.capture()
          }
          break
        }
      }
    } else {
      if (p.alive && p.spawnT <= 0 && Math.abs(p.x - b.x) < TANK_HALF + 2 && Math.abs(p.y - b.y) < TANK_HALF + 2) {
        b.dead = true
        hitPlayer(s, onOver)
        continue
      }
    }
  }

  // пули игрока и врагов взаимно аннигилируют
  for (let i = 0; i < s.bullets.length; i++) {
    const a = s.bullets[i]
    if (a.dead) continue
    for (let j = i + 1; j < s.bullets.length; j++) {
      const b2 = s.bullets[j]
      if (b2.dead || a.owner === b2.owner) continue
      if (Math.abs(a.x - b2.x) < 7 && Math.abs(a.y - b2.y) < 7) {
        a.dead = true; b2.dead = true
        addParticles(s, (a.x + b2.x) / 2, (a.y + b2.y) / 2, 8, ['#FDE68A', '#FFFFFF', '#A3E635'], 110, 0.3, 2)
        sfx.tick()
        break
      }
    }
  }
  s.bullets = s.bullets.filter((b) => !b.dead)

  // ── бонусы ──
  for (const pw of s.powers) {
    pw.t += dt
    if (p.alive && p.spawnT <= 0 && Math.abs(p.x - pw.x) < TANK_HALF + 12 && Math.abs(p.y - pw.y) < TANK_HALF + 12) {
      pw.t = -999
      applyPower(s, pw)
    }
  }
  s.powers = s.powers.filter((pw) => pw.t > -900)

  // ── частицы / кольца / попапы ──
  for (const pt of s.particles) {
    pt.life -= dt
    pt.x += pt.vx * dt
    pt.y += pt.vy * dt
    pt.vy += pt.grav * dt
    pt.vx *= 1 - 1.6 * dt
  }
  s.particles = s.particles.filter((pt) => pt.life > 0)
  for (const r of s.rings) { r.life -= dt; r.r += r.vr * dt }
  s.rings = s.rings.filter((r) => r.life > 0)
  for (const pp of s.pops) { pp.life -= dt; pp.y -= 20 * dt }
  s.pops = s.pops.filter((pp) => pp.life > 0)

  s.enemies = s.enemies.filter((e) => e.alive)

  // ── волна зачищена (только пока игра идёт: после onOver новую волну не открываем) ──
  if (s.phase === 'play' && s.bannerT <= 0 && s.queue.length === 0 && s.enemies.length === 0) waveClear(s)
}

// ============================================================================
// ОТРИСОВКА
// ============================================================================

function drawBrick(ctx: CanvasRenderingContext2D, px: number, py: number, gx: number, gy: number) {
  ctx.fillStyle = '#A03D14'
  ctx.fillRect(px, py, CELL, CELL)
  ctx.fillStyle = '#7C2D12'
  ctx.fillRect(px, py + 9, CELL, 2)
  ctx.fillRect(px, py + 19, CELL, 2)
  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  const off = (gx + gy) % 2 === 0 ? 0 : 7
  for (let i = 0; i < 3; i++) ctx.fillRect(px + ((off + i * 14) % CELL), py, 2, 9)
  for (let i = 0; i < 3; i++) ctx.fillRect(px + ((off + 7 + i * 14) % CELL), py + 11, 2, 8)
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  ctx.fillRect(px, py, CELL, 2)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(px, py + CELL - 2, CELL, 2)
}

function drawSteel(ctx: CanvasRenderingContext2D, px: number, py: number) {
  const grad = ctx.createLinearGradient(px, py, px, py + CELL)
  grad.addColorStop(0, '#B9C4D2')
  grad.addColorStop(1, '#6B7787')
  ctx.fillStyle = grad
  ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2)
  ctx.strokeStyle = '#39404D'
  ctx.lineWidth = 2
  ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(px + 5, py + 5, CELL - 10, 3)
  ctx.fillStyle = '#2B3240'
  for (const [rx, ry] of [[6, 6], [CELL - 9, 6], [6, CELL - 9], [CELL - 9, CELL - 9]]) {
    ctx.fillRect(px + rx, py + ry, 3, 3)
  }
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(px + 8, py + 12, CELL - 16, 6)
}

function drawTreads(ctx: CanvasRenderingContext2D, scheme: Scheme, off: number) {
  ctx.fillStyle = scheme.tread
  ctx.fillRect(-TANK_HALF, -TANK_HALF, 6, TANK)
  ctx.fillRect(TANK_HALF - 6, -TANK_HALF, 6, TANK)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  const step = 6
  const start = -(off % step)
  for (let y = start; y < TANK_HALF; y += step) {
    if (y + 2 > -TANK_HALF) {
      ctx.fillRect(-TANK_HALF + 1, y, 4, 2)
      ctx.fillRect(TANK_HALF - 5, y, 4, 2)
    }
  }
}

function drawTank(ctx: CanvasRenderingContext2D, s: GS, t: Tank) {
  const scheme = SCHEMES[t.kind]
  let bodyA = scheme.bodyA, bodyB = scheme.bodyB, turret = scheme.turret, glow = scheme.glow
  if (t.kind === 'heavy' && t.maxHp > 1) {
    const mul = 0.45 + 0.55 * (t.hp / t.maxHp) // темнеет с уроном
    bodyA = shadeHex(bodyA, mul); bodyB = shadeHex(bodyB, mul)
    turret = shadeHex(turret, mul); glow = shadeHex(glow, mul)
  }

  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(t.x, t.y + 2.5, TANK_HALF + 0.5, TANK_HALF - 0.5, 0, 0, Math.PI * 2)
  ctx.fill()

  // подсветка игрока / спавн-звезда
  if (t.kind === 'player') {
    ctx.strokeStyle = glow
    ctx.globalAlpha = 0.3
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(t.x, t.y, TANK_HALF + 3.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (t.spawnT > 0) {
    const a = 0.35 + 0.65 * Math.abs(Math.sin(s.t * 12))
    const r = 5 + t.spawnT * 13
    ctx.strokeStyle = glow
    ctx.globalAlpha = a
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(t.x - r, t.y); ctx.lineTo(t.x + r, t.y)
    ctx.moveTo(t.x, t.y - r); ctx.lineTo(t.x, t.y + r)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(t.x, t.y, r * 0.55, s.t * 4, s.t * 4 + Math.PI * 1.2)
    ctx.stroke()
    ctx.globalAlpha = 1
    return
  }

  // мигание при неуязвимости
  if (t.kind === 'player' && s.invulnT > 0 && Math.sin(s.t * 24) > 0) ctx.globalAlpha = 0.3

  ctx.save()
  ctx.translate(t.x, t.y)
  ctx.rotate((t.dir * Math.PI) / 2)
  drawTreads(ctx, scheme, t.tread)

  // корпус с градиентом
  const grad = ctx.createLinearGradient(0, -TANK_HALF + 3, 0, TANK_HALF - 3)
  grad.addColorStop(0, bodyA)
  grad.addColorStop(1, bodyB)
  ctx.fillStyle = grad
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(-TANK_HALF + 5, -TANK_HALF + 3, TANK - 10, TANK - 6, 4)
  else ctx.rect(-TANK_HALF + 5, -TANK_HALF + 3, TANK - 10, TANK - 6)
  ctx.fill()
  // блик на корпусе
  ctx.fillStyle = 'rgba(255,255,255,0.30)'
  ctx.fillRect(-TANK_HALF + 6, -TANK_HALF + 4, TANK - 12, 2.5)

  // ствол
  ctx.fillStyle = scheme.barrel
  ctx.fillRect(-2.2, -TANK_HALF - 3, 4.4, TANK_HALF + 2)
  ctx.fillStyle = 'rgba(255,255,255,0.30)'
  ctx.fillRect(-2.2, -TANK_HALF - 3, 4.4, 2)

  // башня с бликом
  ctx.fillStyle = turret
  ctx.beginPath()
  ctx.arc(0, 1.5, 6.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.30)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(0, 1.5, 4.5, Math.PI * 1.05, Math.PI * 1.75)
  ctx.stroke()

  // вспышка выстрела
  if (t.flash > 0) {
    ctx.fillStyle = 'rgba(255,240,180,0.9)'
    ctx.beginPath()
    ctx.arc(0, -TANK_HALF - 4, 4.5 * (t.flash / 0.06), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  ctx.globalAlpha = 1

  // щит
  if (t.kind === 'player' && s.shieldT > 0) {
    const a = 0.45 + 0.3 * Math.sin(s.t * 7)
    ctx.strokeStyle = `rgba(56,189,248,${a.toFixed(3)})`
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(t.x, t.y, TANK_HALF + 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = `rgba(56,189,248,${(a * 0.18).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(t.x, t.y, TANK_HALF + 5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Bullet) {
  const isP = b.owner === 0
  ctx.fillStyle = isP ? 'rgba(163,230,53,0.25)' : 'rgba(248,113,113,0.25)'
  ctx.beginPath()
  ctx.arc(b.x, b.y, 5.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = isP ? '#D9F99D' : '#FCA5A5'
  ctx.beginPath()
  ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2)
  ctx.fill()
}

function drawPower(ctx: CanvasRenderingContext2D, pw: Power, t: number) {
  const st = POWER_STYLE[pw.kind]
  const pulse = 1 + 0.08 * Math.sin(t * 5 + pw.t * 3)
  const w = 26 * pulse
  ctx.fillStyle = 'rgba(17,24,39,0.94)'
  ctx.strokeStyle = st.color
  ctx.lineWidth = 2
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(pw.x - w / 2, pw.y - w / 2, w, w, 7 * pulse)
  else ctx.rect(pw.x - w / 2, pw.y - w / 2, w, w)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = st.color
  ctx.globalAlpha = 0.3
  ctx.lineWidth = 5
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(pw.x - w / 2 - 3, pw.y - w / 2 - 3, w + 6, w + 6, 9)
  else ctx.rect(pw.x - w / 2 - 3, pw.y - w / 2 - 3, w + 6, w + 6)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.font = '13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(st.label, pw.x, pw.y + 1)
}

function drawWorld(ctx: CanvasRenderingContext2D, s: GS) {
  const size = s.size
  const k = size / FIELD
  const dpr = s.dpr
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0)

  // тряска канваса
  if (s.shakeT > 0) {
    const m = s.shakeMag * (s.shakeT / s.shakeDur)
    ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m)
  }

  // фон: тёмное поле + виньетка
  const bg = ctx.createLinearGradient(0, 0, 0, FIELD)
  bg.addColorStop(0, '#111624')
  bg.addColorStop(1, '#0A0D15')
  ctx.fillStyle = bg
  ctx.fillRect(-8, -8, FIELD + 16, FIELD + 16)
  const vg = ctx.createRadialGradient(FIELD / 2, FIELD / 2, FIELD * 0.35, FIELD / 2, FIELD / 2, FIELD * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.4)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, FIELD, FIELD)

  // сетка
  ctx.strokeStyle = 'rgba(148,163,184,0.05)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < N; i++) {
    ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, FIELD)
    ctx.moveTo(0, i * CELL); ctx.lineTo(FIELD, i * CELL)
  }
  ctx.stroke()

  // тайлы
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const t = s.grid[gy][gx]
      if (t === 1) drawBrick(ctx, gx * CELL, gy * CELL, gx, gy)
      else if (t === 2) drawSteel(ctx, gx * CELL, gy * CELL)
    }
  }

  // бонусы
  for (const pw of s.powers) drawPower(ctx, pw, s.t)

  // танки (враги, затем игрок)
  for (const e of s.enemies) if (e.alive) drawTank(ctx, s, e)
  if (s.player.alive) drawTank(ctx, s, s.player)

  // пули
  for (const b of s.bullets) drawBullet(ctx, b)

  // частицы
  for (const pt of s.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.max)
    ctx.fillStyle = pt.color
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size)
  }
  ctx.globalAlpha = 1

  // ударные волны
  for (const r of s.rings) {
    ctx.globalAlpha = Math.max(0, r.life / r.max)
    ctx.strokeStyle = r.color
    ctx.lineWidth = r.lw
    ctx.beginPath()
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // всплывающие очки
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const pp of s.pops) {
    ctx.globalAlpha = Math.min(1, pp.life / 0.5)
    ctx.font = 'bold 12px system-ui, sans-serif'
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'
    ctx.lineWidth = 3
    ctx.strokeText(pp.text, pp.x, pp.y)
    ctx.fillStyle = pp.color
    ctx.fillText(pp.text, pp.x, pp.y)
  }
  ctx.globalAlpha = 1

  // вспышка
  if (s.flashT > 0) {
    ctx.fillStyle = s.flashColor
    ctx.globalAlpha = Math.min(1, s.flashT / 0.1)
    ctx.fillRect(0, 0, FIELD, FIELD)
    ctx.globalAlpha = 1
  }

  // баннер «Волна пройдена»
  if (s.bannerT > 0) {
    const a = Math.min(1, s.bannerT / 0.4, (2.4 - s.bannerT) / 0.3)
    ctx.fillStyle = `rgba(8,10,18,${(0.6 * a).toFixed(3)})`
    ctx.fillRect(0, FIELD / 2 - 46, FIELD, 92)
    ctx.fillStyle = `rgba(163,230,53,${a.toFixed(3)})`
    ctx.font = '900 23px system-ui, sans-serif'
    ctx.fillText(s.bannerText, FIELD / 2, FIELD / 2 - 10)
    ctx.fillStyle = `rgba(255,255,255,${(0.75 * a).toFixed(3)})`
    ctx.font = 'bold 13px system-ui, sans-serif'
    ctx.fillText(`Волна ${s.wave} · врагов: ${s.queue.length}`, FIELD / 2, FIELD / 2 + 16)
  }
}

// ============================================================================
// КОМПОНЕНТ
// ============================================================================

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-2 py-1.5 text-center border" style={{ background: 'var(--g-chip)', borderColor: 'var(--g-chip-border)' }}>
      <div className="text-[8px] uppercase tracking-widest font-bold" style={{ color: 'var(--g-fg-mute)' }}>{label}</div>
      <div className="text-sm font-extrabold tabular-nums leading-tight" style={{ color: 'var(--g-fg)' }}>{children}</div>
    </div>
  )
}

function PadBtn({ dir, onPress, onRelease, children, label }: {
  dir: Dir
  onPress: (d: Dir) => void
  onRelease: (d: Dir) => void
  children: React.ReactNode
  label: string
}) {
  return (
    <button
      aria-label={label}
      className="h-[56px] w-[56px] rounded-xl grid place-items-center border transition-all active:scale-90 select-none"
      style={{ background: 'var(--g-card)', borderColor: 'var(--g-border)', color: 'var(--g-fg)', touchAction: 'none' }}
      onPointerDown={(e) => { e.preventDefault(); onPress(dir) }}
      onPointerUp={(e) => { e.preventDefault(); onRelease(dir) }}
      onPointerCancel={() => onRelease(dir)}
      onPointerLeave={() => onRelease(dir)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

export function TanksGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // ленивая инициализация: makeState() (genMap+BFS) не должен пересоздавать карту на каждый рендер
  const stRef = useRef<GS | null>(null)
  if (stRef.current === null) stRef.current = makeState()
  const st = stRef as RefObject<GS>

  const [phase, setPhase] = useState<Phase>('idle')
  const [score, setScore] = useState(0)
  const [wave, setWave] = useState(1)
  const [lives, setLives] = useState(3)
  const [enemiesLeft, setEnemiesLeft] = useState(0)
  const [isRecord, setIsRecord] = useState(false)
  const [best, submitBest] = useBest('tanks')

  // ── HUD-синк ──
  const syncHud = useCallback((s: GS) => {
    setScore(s.score)
    setWave(s.wave)
    setLives(Math.max(0, s.lives))
    setEnemiesLeft(s.queue.length + s.enemies.reduce((a, e) => a + (e.alive ? 1 : 0), 0))
  }, [])

  const gameOverRef = useRef<() => void>(() => {})
  gameOverRef.current = () => {
    const s = st.current
    if (s.phase !== 'play') return // защита от двойного срабатывания (2 пули в кадре)
    s.phase = 'over'
    s.dirs = []
    s.fireBtn = false
    s.fireKey = false
    setPhase('over')
    setIsRecord(submitBest(s.score))
    syncHud(s)
    sfx.lose()
  }

  // ── ресайз: dpr≤2, ResizeObserver ──
  const resize = useCallback(() => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const size = Math.max(220, Math.min(560, Math.floor(rect.width) || 390))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    st.current.size = size
    st.current.dpr = dpr
    cv.width = Math.round(size * dpr)
    cv.height = Math.round(size * dpr)
  }, [])

  useEffect(() => {
    resize()
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    window.addEventListener('resize', resize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [resize])

  // ── старт / рестарт ──
  const startGame = useCallback(() => {
    const s = st.current
    const size = s.size, dpr = s.dpr
    const fresh = makeState()
    fresh.size = size
    fresh.dpr = dpr
    fresh.phase = 'play'
    st.current = fresh
    startWave(fresh, 1)
    setIsRecord(false)
    setScore(0)
    setWave(1)
    setLives(3)
    setEnemiesLeft(fresh.queue.length)
    setPhase('play')
    sfx.whoosh(1)
  }, [])

  // ── игровой цикл ──
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (ts - last) / 1000) // clamp dt
      last = ts
      const s = st.current
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return
      if (s.phase === 'play') update(s, dt, () => gameOverRef.current())
      if (s.phase === 'play') {
        s.hudT -= dt
        if (s.hudT <= 0) { s.hudT = 0.12; syncHud(s) }
      }
      drawWorld(ctx, s)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [syncHud])

  // ── ввод: клавиатура (десктоп) ──
  useEffect(() => {
    const keyDir = (code: string): Dir | -1 => {
      if (code === 'KeyW' || code === 'ArrowUp') return 0
      if (code === 'KeyD' || code === 'ArrowRight') return 1
      if (code === 'KeyS' || code === 'ArrowDown') return 2
      if (code === 'KeyA' || code === 'ArrowLeft') return 3
      return -1
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const s = st.current
      const d = keyDir(e.code)
      if (d !== -1) {
        e.preventDefault()
        if (!e.repeat) {
          const i = s.dirs.indexOf(d)
          if (i !== -1) s.dirs.splice(i, 1)
          s.dirs.push(d)
        }
        return
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        if (s.phase === 'play') { if (e.code === 'Space' && !e.repeat) s.fireKey = true }
        else if (!e.repeat) startGame()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const s = st.current
      const d = keyDir(e.code)
      if (d !== -1) {
        const i = s.dirs.indexOf(d)
        if (i !== -1) s.dirs.splice(i, 1)
        return
      }
      if (e.code === 'Space') s.fireKey = false
    }
    const clearInput = () => {
      const s = st.current
      s.dirs = []
      s.fireBtn = false
      s.fireKey = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInput)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearInput)
    }
  }, [startGame])

  // ── ввод: D-pad / ОГОНЬ (мобильное) ──
  const pressDir = useCallback((d: Dir) => {
    const s = st.current
    const i = s.dirs.indexOf(d)
    if (i !== -1) s.dirs.splice(i, 1)
    s.dirs.push(d)
  }, [])
  const releaseDir = useCallback((d: Dir) => {
    const s = st.current
    const i = s.dirs.indexOf(d)
    if (i !== -1) s.dirs.splice(i, 1)
  }, [])
  const setFireBtn = useCallback((v: boolean) => {
    st.current.fireBtn = v
  }, [])

  return (
    <div className="h-full w-full flex flex-col items-center gap-2.5 px-3 py-2">
      {/* статус сверху: счёт · волна · враги · жизни */}
      <div className="w-full max-w-[430px] grid grid-cols-4 gap-2">
        <Stat label="Счёт">{score.toLocaleString('ru-RU')}</Stat>
        <Stat label="Волна">{wave}</Stat>
        <Stat label="Враги">{enemiesLeft}</Stat>
        <Stat label="Жизни">
          <span className="inline-flex items-center gap-0.5 justify-center">
            {Array.from({ length: Math.max(0, lives) }).map((_, i) => (
              <Heart key={i} className="h-3.5 w-3.5" style={{ color: 'var(--g-fg)' }} fill="currentColor" strokeWidth={0} />
            ))}
            {lives <= 0 && <span>0</span>}
          </span>
        </Stat>
      </div>

      {/* сцена */}
      <div className="w-full flex-1 min-h-0 grid place-items-center">
        <div
          ref={wrapRef}
          className="relative w-full max-w-[430px] aspect-square rounded-2xl overflow-hidden border"
          style={{ borderColor: 'var(--g-border)', background: '#0B0E16', boxShadow: 'var(--g-shadow)' }}
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full touch-none select-none"
            style={{ touchAction: 'none' }}
          />

          {/* экран старта */}
          {phase === 'idle' && (
            <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[2px]">
              <div className="text-center px-6">
                <div className="text-6xl mb-2">🛡️</div>
                <div className="text-2xl font-extrabold mb-1" style={{ color: 'var(--g-fg)' }}>Танчики</div>
                <p className="text-xs leading-relaxed max-w-[280px] mx-auto mb-1" style={{ color: 'var(--g-fg-soft)' }}>
                  Выживание волнами: разноси кирпич, прячься за сталью, собирай ⭐ ✚ 🛡
                </p>
                <p className="text-[11px] leading-relaxed max-w-[280px] mx-auto mb-4" style={{ color: 'var(--g-fg-mute)' }}>
                  Тяжёлый танк краснеет и темнеет с уроном · пули гасят друг друга
                </p>
                <button
                  onClick={startGame}
                  className="h-12 px-8 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95 transition-transform"
                  style={{ background: 'linear-gradient(135deg,#A3E635,#65A30D)', boxShadow: '0 16px 38px -14px rgba(132,204,22,0.7)' }}
                >
                  <Play className="h-5 w-5 fill-current" />
                  В бой!
                </button>
              </div>
            </div>
          )}

          {/* game over */}
          {phase === 'over' && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-[2px]">
              <div className="text-center px-6">
                <div className="text-6xl mb-2">💥</div>
                <div className="text-2xl font-extrabold mb-1" style={{ color: 'var(--g-fg)' }}>Игра окончена</div>
                {isRecord && (
                  <div
                    className="inline-block text-[10px] uppercase tracking-widest font-extrabold rounded-full px-3 py-1 mb-2 border"
                    style={{ background: 'var(--g-accent-soft)', borderColor: 'var(--g-chip-border)', color: 'var(--g-fg)' }}
                  >
                    Новый рекорд!
                  </div>
                )}
                <p className="text-sm font-bold mb-0.5" style={{ color: 'var(--g-fg-soft)' }}>
                  Счёт: <span className="tabular-nums">{score.toLocaleString('ru-RU')}</span> · Волна {wave}
                </p>
                <p className="text-xs mb-4" style={{ color: 'var(--g-fg-mute)' }}>
                  Рекорд: {Math.max(best, score).toLocaleString('ru-RU')}
                </p>
                <button
                  onClick={startGame}
                  className="h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 active:scale-95 transition-transform"
                  style={{ background: 'linear-gradient(135deg,#A3E635,#65A30D)', boxShadow: '0 16px 38px -14px rgba(132,204,22,0.7)' }}
                >
                  <RotateCcw className="h-[18px] w-[18px]" />
                  Ещё раз
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* подсказка для десктопа */}
      <p className="hidden md:block text-[11px] text-center" style={{ color: 'var(--g-fg-mute)' }}>
        WASD / стрелки — движение · Пробел — огонь · максимум 2 пули в воздухе
      </p>

      {/* мобильное управление: D-pad слева + ОГОНЬ справа */}
      <div className="w-full max-w-[430px] flex items-end justify-between gap-4 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5">
          <div />
          <PadBtn dir={0} label="Вверх" onPress={pressDir} onRelease={releaseDir}><ChevronUp className="h-6 w-6" strokeWidth={2.6} /></PadBtn>
          <div />
          <PadBtn dir={3} label="Влево" onPress={pressDir} onRelease={releaseDir}><ChevronLeft className="h-6 w-6" strokeWidth={2.6} /></PadBtn>
          <div />
          <PadBtn dir={1} label="Вправо" onPress={pressDir} onRelease={releaseDir}><ChevronRight className="h-6 w-6" strokeWidth={2.6} /></PadBtn>
          <div />
          <PadBtn dir={2} label="Вниз" onPress={pressDir} onRelease={releaseDir}><ChevronDown className="h-6 w-6" strokeWidth={2.6} /></PadBtn>
          <div />
        </div>
        <button
          aria-label="Огонь"
          className="h-[84px] w-[84px] rounded-full font-extrabold text-[13px] tracking-wide text-white select-none active:scale-90 transition-transform shrink-0 border border-white/25"
          style={{
            background: 'radial-gradient(circle at 32% 28%, #BEF264, #65A30D 70%)',
            boxShadow: '0 14px 30px -10px rgba(132,204,22,0.65), inset 0 -4px 10px rgba(0,0,0,0.25)',
            touchAction: 'none',
          }}
          onPointerDown={(e) => { e.preventDefault(); setFireBtn(true) }}
          onPointerUp={(e) => { e.preventDefault(); setFireBtn(false) }}
          onPointerCancel={() => setFireBtn(false)}
          onPointerLeave={() => setFireBtn(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          ОГОНЬ
        </button>
      </div>
    </div>
  )
}
