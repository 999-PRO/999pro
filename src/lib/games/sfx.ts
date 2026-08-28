// ============================================================================
// v25.23 — ИГРОВОЙ КЛУБ TRI999: звуки на Web Audio API (синтез, без файлов).
// Один общий AudioContext, мягкие огибающие, мьют-флаг в localStorage.
// Все вызовы безопасны: если звук недоступен — тихо пропускаем.
// ============================================================================

let ctx: AudioContext | null = null
let muted = false

if (typeof window !== 'undefined') {
  try {
    muted = window.localStorage.getItem('999pro-games-muted') === '1'
  } catch {}
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

interface ToneOpts {
  freq: number
  dur?: number
  type?: OscillatorType
  vol?: number
  delay?: number
  slideTo?: number
}

function tone({ freq, dur = 0.12, type = 'sine', vol = 0.16, delay = 0, slideTo }: ToneOpts) {
  const a = ac()
  if (!a || muted) return
  try {
    const t0 = a.currentTime + delay
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain).connect(a.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  } catch {}
}

function noise(dur = 0.3, vol = 0.22, delay = 0, lowpass = 1200) {
  const a = ac()
  if (!a || muted) return
  try {
    const t0 = a.currentTime + delay
    const len = Math.floor(a.sampleRate * dur)
    const buf = a.createBuffer(1, len, a.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = a.createBufferSource()
    src.buffer = buf
    const filter = a.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = lowpass
    const gain = a.createGain()
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter).connect(gain).connect(a.destination)
    src.start(t0)
  } catch {}
}

export const sfx = {
  /** мягкий тап по UI */
  tap() {
    tone({ freq: 620, dur: 0.06, type: 'triangle', vol: 0.1 })
  },
  /** клик-выбор плитки */
  click() {
    tone({ freq: 880, dur: 0.07, type: 'triangle', vol: 0.12 })
    tone({ freq: 1320, dur: 0.05, type: 'sine', vol: 0.07, delay: 0.03 })
  },
  /** верный ответ — мажорное арпеджио */
  correct() {
    tone({ freq: 523.25, dur: 0.11, type: 'triangle', vol: 0.16 })
    tone({ freq: 659.25, dur: 0.11, type: 'triangle', vol: 0.16, delay: 0.09 })
    tone({ freq: 783.99, dur: 0.16, type: 'triangle', vol: 0.18, delay: 0.18 })
  },
  /** неверный ответ — низкий диссонанс */
  wrong() {
    tone({ freq: 220, dur: 0.22, type: 'sawtooth', vol: 0.13, slideTo: 130 })
    tone({ freq: 233, dur: 0.22, type: 'sawtooth', vol: 0.09, slideTo: 120 })
  },
  /** победа — фанфары */
  win() {
    const seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5]
    seq.forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.18, delay: i * 0.12 }))
    tone({ freq: 1318.5, dur: 0.4, type: 'sine', vol: 0.14, delay: seq.length * 0.12 })
  },
  /** проигрыш */
  lose() {
    tone({ freq: 392, dur: 0.2, type: 'triangle', vol: 0.15 })
    tone({ freq: 311, dur: 0.2, type: 'triangle', vol: 0.15, delay: 0.18 })
    tone({ freq: 233, dur: 0.4, type: 'triangle', vol: 0.16, delay: 0.36, slideTo: 180 })
  },
  /** тик таймера */
  tick() {
    tone({ freq: 990, dur: 0.04, type: 'square', vol: 0.05 })
  },
  /** прыжок (раннер) */
  jump() {
    tone({ freq: 300, dur: 0.16, type: 'square', vol: 0.09, slideTo: 640 })
  },
  /** двойной прыжок */
  jump2() {
    tone({ freq: 480, dur: 0.16, type: 'square', vol: 0.09, slideTo: 940 })
  },
  /** монетка */
  coin() {
    tone({ freq: 987.77, dur: 0.07, type: 'square', vol: 0.08 })
    tone({ freq: 1318.5, dur: 0.16, type: 'square', vol: 0.08, delay: 0.07 })
  },
  /** выстрел (шутер) */
  shoot() {
    tone({ freq: 880, dur: 0.08, type: 'sawtooth', vol: 0.07, slideTo: 220 })
  },
  /** взрыв */
  boom() {
    noise(0.35, 0.24, 0, 900)
    tone({ freq: 140, dur: 0.3, type: 'sawtooth', vol: 0.12, slideTo: 50 })
  },
  /** урон игроку */
  hurt() {
    tone({ freq: 340, dur: 0.25, type: 'sawtooth', vol: 0.14, slideTo: 110 })
  },
  /** поворот фигуры (тетрис) */
  rotate() {
    tone({ freq: 700, dur: 0.05, type: 'square', vol: 0.06 })
  },
  /** фиксация фигуры */
  lock() {
    tone({ freq: 220, dur: 0.07, type: 'square', vol: 0.09 })
  },
  /** собранная линия */
  line(clearLines = 1) {
    const base = 520 + (clearLines - 1) * 120
    tone({ freq: base, dur: 0.1, type: 'triangle', vol: 0.15 })
    tone({ freq: base * 1.5, dur: 0.14, type: 'triangle', vol: 0.15, delay: 0.08 })
    if (clearLines >= 4) tone({ freq: base * 2, dur: 0.2, type: 'triangle', vol: 0.16, delay: 0.18 })
  },
  /** ход шахмат */
  move() {
    tone({ freq: 440, dur: 0.05, type: 'sine', vol: 0.1 })
    tone({ freq: 660, dur: 0.06, type: 'sine', vol: 0.07, delay: 0.04 })
  },
  /** взятие фигуры */
  capture() {
    noise(0.12, 0.14, 0, 2400)
    tone({ freq: 330, dur: 0.09, type: 'triangle', vol: 0.11 })
  },
  /** открытие буквы / угадал букву */
  reveal() {
    tone({ freq: 740, dur: 0.09, type: 'sine', vol: 0.13 })
    tone({ freq: 1108, dur: 0.12, type: 'sine', vol: 0.1, delay: 0.07 })
  },
  /** открыть/закрыть полноэкранную игру */
  whoosh(dir: 1 | -1 = 1) {
    tone({ freq: dir === 1 ? 240 : 520, dur: 0.18, type: 'sine', vol: 0.1, slideTo: dir === 1 ? 640 : 200 })
  },

  isMuted() {
    return muted
  },
  setMuted(v: boolean) {
    muted = v
    try {
      window.localStorage.setItem('999pro-games-muted', v ? '1' : '0')
    } catch {}
  },
}
