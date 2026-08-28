'use client'

// ============================================================================
// v25.23 — «Кто хочет стать миллионером»: 15 уровней, лестница приза,
// 3 подсказки (50:50, помощь зала, звонок другу), несгораемые суммы,
// возможность забрать деньги. Банк: 210 вопросов (70 лёгких / 70 средних /
// 70 сложных — 5+5+5 на партию).
// ============================================================================

import { useCallback, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, HandCoins, HelpCircle, ListOrdered, Phone, Play, RotateCcw, X } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useBest } from '@/lib/games/best-score'
import { MILLIONAIRE_QUESTIONS } from '@/lib/games/quiz-millionaire'

const LADDER = [500, 1000, 2000, 3000, 5000, 10000, 15000, 25000, 50000, 100000, 200000, 300000, 500000, 800000, 1000000]
const SAFE_LEVELS = [4, 9] // индексы несгораемых уровней (5000 и 100000 ₽)
const LETTERS = ['А', 'Б', 'В', 'Г']

interface Lifelines {
  fifty: boolean
  audience: boolean
  phone: boolean
}

function shuffle<T>(arr: readonly T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const fmt = (n: number) => n.toLocaleString('ru-RU')

function pickQuestions() {
  const d1 = shuffle(MILLIONAIRE_QUESTIONS.filter((q) => q.d === 1)).slice(0, 5)
  const d2 = shuffle(MILLIONAIRE_QUESTIONS.filter((q) => q.d === 2)).slice(0, 5)
  const d3 = shuffle(MILLIONAIRE_QUESTIONS.filter((q) => q.d === 3)).slice(0, 5)
  return [...d1, ...d2, ...d3]
}

export function MillionaireGame() {
  const [phase, setPhase] = useState<'idle' | 'play' | 'end'>('idle')
  const [questions, setQuestions] = useState(pickQuestions)
  const [level, setLevel] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [correct, setCorrect] = useState(false)
  const [lifelines, setLifelines] = useState<Lifelines>({ fifty: false, audience: false, phone: false })
  const [hidden, setHidden] = useState<number[]>([])
  const [overlay, setOverlay] = useState<null | 'ladder' | 'audience' | 'phone'>(null)
  const [audience, setAudience] = useState<number[]>([0, 0, 0, 0])
  const [friendText, setFriendText] = useState('')
  const [won, setWon] = useState(false)
  const [tookMoney, setTookMoney] = useState(false)
  const [best, submitBest] = useBest('millionaire')
  const scoredRef = useRef(false)

  const q = questions[level]
  const prize = LADDER[level] ?? 0
  const secured = useMemo(() => {
    let s = 0
    for (let i = 0; i < level; i++) if (SAFE_LEVELS.includes(i)) s = LADDER[i]
    return s
  }, [level])

  const start = useCallback(() => {
    setQuestions(pickQuestions())
    setLevel(0)
    setPicked(null)
    setRevealed(false)
    setCorrect(false)
    setLifelines({ fifty: false, audience: false, phone: false })
    setHidden([])
    setOverlay(null)
    setWon(false)
    setTookMoney(false)
    scoredRef.current = false
    setPhase('play')
    sfx.whoosh(1)
  }, [])

  const finish = useCallback(
    (amount: number, isWin: boolean) => {
      if (!scoredRef.current) {
        scoredRef.current = true
        submitBest(amount)
      }
      setWon(isWin)
      setPhase('end')
      window.setTimeout(() => (isWin ? sfx.win() : amount > 0 ? sfx.coin() : sfx.lose()), 250)
    },
    [submitBest],
  )

  const confirmAnswer = useCallback(() => {
    if (picked === null || !q) return
    const isRight = picked === q.c
    setRevealed(true)
    setCorrect(isRight)
    if (isRight) sfx.correct()
    else sfx.wrong()
    window.setTimeout(() => {
      if (isRight) {
        if (level + 1 >= LADDER.length) {
          finish(LADDER[LADDER.length - 1], true)
        } else {
          setLevel((v) => v + 1)
          setPicked(null)
          setRevealed(false)
          setHidden([])
        }
      } else {
        finish(secured, false)
      }
    }, 1500)
  }, [picked, q, level, secured, finish])

  const takeMoney = useCallback(() => {
    if (revealed || picked !== null || level === 0) return
    sfx.coin()
    finish(level > 0 ? LADDER[level - 1] : 0, false)
    setTookMoney(true)
  }, [revealed, picked, level, finish])

  // ── подсказки ──
  const useFifty = useCallback(() => {
    if (!q || lifelines.fifty || picked !== null) return
    const wrong = shuffle([0, 1, 2, 3].filter((i) => i !== q.c)).slice(0, 2)
    setHidden(wrong)
    setLifelines((s) => ({ ...s, fifty: true }))
    sfx.reveal()
  }, [q, lifelines.fifty, picked])

  const useAudience = useCallback(() => {
    if (!q || lifelines.audience || picked !== null) return
    // 55–80% у зала тянет к верному ответу, остальное раскидываем
    const main = 55 + Math.floor(Math.random() * 26)
    const rest = 100 - main
    const others = shuffle([0, 1, 2, 3].filter((i) => i !== q.c))
    const a = [0, 0, 0, 0]
    a[q.c] = main
    const parts = [Math.floor(rest * (0.4 + Math.random() * 0.4)), Math.floor(rest * (0.2 + Math.random() * 0.3))]
    a[others[0]] = parts[0]
    a[others[1]] = Math.max(0, parts[1])
    a[others[2]] = Math.max(0, rest - parts[0] - parts[1])
    setAudience(a)
    setLifelines((s) => ({ ...s, audience: true }))
    setOverlay('audience')
    sfx.reveal()
  }, [q, lifelines.audience, picked])

  const usePhone = useCallback(() => {
    if (!q || lifelines.phone || picked !== null) return
    const sure = Math.random() < 0.75
    const answerIdx = sure ? q.c : shuffle([0, 1, 2, 3].filter((i) => i !== q.c))[0]
    const confidence = sure ? 'Я почти уверен!' : 'Мм… точно не помню, но кажется…'
    setFriendText(`Друг: «Привет! ${confidence} Думаю, это ${LETTERS[answerIdx]} — ${q.a[answerIdx]}».`)
    setLifelines((s) => ({ ...s, phone: true }))
    setOverlay('phone')
    sfx.reveal()
  }, [q, lifelines.phone, picked])

  // ── экраны ──
  if (phase === 'idle') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-5 px-6">
        <div
          className="h-24 w-24 rounded-[28px] grid place-items-center text-5xl"
          style={{ background: 'linear-gradient(140deg,#F59E0B,#B45309)', boxShadow: '0 20px 50px -18px rgba(245,158,11,0.55)' }}
        >
          💰
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[var(--g-fg)] tracking-tight">Кто хочет стать миллионером?</h2>
          <p className="text-sm text-[var(--g-fg-soft)] mt-2 max-w-sm mx-auto leading-relaxed">
            15 вопросов, 3 подсказки, несгораемые суммы. Забирай деньги, пока не поздно!
          </p>
        </div>
        {best > 0 && (
          <div className="rounded-full px-4 py-1.5 bg-[var(--g-btn)] border border-[var(--g-chip-border)] text-[var(--g-fg-soft)] text-sm font-bold">
            🏆 Лучший выигрыш: {fmt(best)} ₽
          </div>
        )}
        <button
          onClick={start}
          className="h-14 px-10 rounded-2xl text-white text-lg font-extrabold transition-transform active:scale-95 hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)', boxShadow: '0 18px 40px -14px rgba(245,158,11,0.6)' }}
        >
          <span className="inline-flex items-center gap-2"><Play className="h-5 w-5 fill-current" /> Начать игру</span>
        </button>
      </div>
    )
  }

  if (phase === 'end') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
          <div className="text-7xl">{won ? '👑' : tookMoney ? '🏦' : '💫'}</div>
        </motion.div>
        <h2 className="text-2xl font-extrabold text-[var(--g-fg)] tracking-tight">
          {won ? 'МИЛЛИОНЕР!' : tookMoney ? 'Деньги забраны!' : 'Игра окончена'}
        </h2>
        <div className="rounded-2xl px-8 py-4 bg-[var(--g-btn)] border border-amber-400/30">
          <div className="text-[10px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold">Ваш выигрыш</div>
          <div className="text-3xl font-extrabold tabular-nums text-amber-400 drop-shadow-[0_0_18px_rgba(245,158,11,0.45)]">
            {fmt(won ? LADDER[14] : secured)} ₽
          </div>
        </div>
        <p className="text-xs text-[var(--g-fg-mute)]">Рекорд: {fmt(Math.max(best, won ? LADDER[14] : secured))} ₽</p>
        <button
          onClick={start}
          className="h-12 px-7 rounded-2xl text-white font-extrabold inline-flex items-center gap-2 transition-transform active:scale-95"
          style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}
        >
          <RotateCcw className="h-[18px] w-[18px]" /> Сыграть ещё
        </button>
      </div>
    )
  }

  // ── ИГРА ──
  const ladderList = (
    <div className="flex flex-col gap-[3px]">
      {LADDER.map((amount, i) => {
        const current = i === level
        const passed = i < level
        const safe = SAFE_LEVELS.includes(i)
        return (
          <div
            key={i}
            className={[
              'flex items-center justify-between rounded-lg px-3 py-[5px] text-[13px] font-bold transition-all',
              current
                ? 'text-white scale-[1.03]'
                : passed
                  ? 'text-amber-300/80'
                  : 'text-[var(--g-fg-mute)]',
            ].join(' ')}
            style={current ? { background: 'linear-gradient(90deg,#F59E0Bcc,#D97706cc)', boxShadow: '0 6px 18px -8px rgba(245,158,11,0.6)' } : undefined}
          >
            <span className="tabular-nums">{i + 1}. {fmt(amount)} ₽</span>
            {safe && <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-[var(--g-btn)]">🔒</span>}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="h-full flex flex-col md:flex-row gap-4 px-3 md:px-6 py-3 md:py-6 max-w-5xl mx-auto w-full">
      {/* основная колонка */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* прогресс + подсказки */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => { sfx.tap(); setOverlay('ladder') }}
            className="md:hidden h-9 pl-2.5 pr-3.5 rounded-full bg-[var(--g-btn)] border border-[var(--g-chip-border)] inline-flex items-center gap-1.5 text-[var(--g-fg-soft)] text-xs font-extrabold active:scale-95"
          >
            <ListOrdered className="h-4 w-4" /> {fmt(prize)} ₽
          </button>
          <div className="hidden md:block text-xs font-extrabold uppercase tracking-widest text-[var(--g-fg-mute)]">
            Вопрос {level + 1} / 15
          </div>
          <div className="flex items-center gap-1.5">
            <LifelineBtn icon={<HalfIcon />} used={lifelines.fifty} label="50:50" onClick={useFifty} />
            <LifelineBtn icon={<HelpCircle className="h-[18px] w-[18px]" />} used={lifelines.audience} label="Зал" onClick={useAudience} />
            <LifelineBtn icon={<Phone className="h-[18px] w-[18px]" />} used={lifelines.phone} label="Друг" onClick={usePhone} />
          </div>
        </div>

        {/* вопрос */}
        <motion.div
          key={level}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl px-4 py-4 md:py-6 text-center border"
          style={{
            background: 'linear-gradient(160deg,#232957,#12162e)', // v25.28: тёмная подложка в обеих темах — белый текст читаем
            borderColor: 'rgba(245,158,11,0.25)',
            boxShadow: '0 20px 50px -24px rgba(245,158,11,0.35)',
          }}
        >
          <div className="text-[10px] md:text-xs font-extrabold uppercase tracking-[0.2em] text-amber-400/80 mb-2">
            Вопрос {level + 1} · {fmt(prize)} ₽
          </div>
          <h3 className="text-[16px] md:text-xl font-extrabold text-white tracking-tight leading-snug">{q?.q}</h3>
        </motion.div>

        {/* варианты */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {q?.a.map((opt, i) => {
            const isHidden = hidden.includes(i)
            const isCorrect = revealed && i === q.c
            const isWrongPick = revealed && picked === i && !correct
            const isPicked = picked === i && !revealed
            return (
              <button
                key={`${level}-${i}`}
                disabled={isHidden || revealed}
                onClick={() => { sfx.tap(); setPicked(i) }}
                className={[
                  'min-h-[54px] px-4 py-2.5 rounded-xl border text-left text-[14px] md:text-[15px] font-bold tracking-tight transition-all duration-200',
                  'inline-flex items-center gap-2.5',
                  isHidden ? 'opacity-20 pointer-events-none' : '',
                  isPicked ? 'scale-[1.02]' : '',
                  !revealed && !isHidden ? 'text-[var(--g-fg)] hover:bg-amber-400/[0.12] active:scale-[0.98]' : isCorrect || isWrongPick || isPicked ? 'text-white' : 'text-[var(--g-fg)]',
                ].join(' ')}
                style={{
                  background: isCorrect
                    ? 'linear-gradient(135deg,#059669,#10B981)'
                    : isWrongPick
                      ? 'linear-gradient(135deg,#DC2626,#EF4444)'
                      : isPicked
                        ? 'linear-gradient(135deg,#F59E0Bcc,#D97706cc)'
                        : 'var(--g-btn)', // v25.28: стекло темы вместо белого
                  borderColor: isCorrect ? 'rgba(16,185,129,0.65)' : isWrongPick ? 'rgba(239,68,68,0.65)' : isPicked ? 'rgba(245,158,11,0.6)' : 'var(--g-chip-border)',
                  boxShadow: isPicked ? '0 10px 26px -12px rgba(245,158,11,0.6)' : 'none',
                }}
              >
                <span
                  className="h-7 w-7 shrink-0 rounded-md grid place-items-center text-[13px] font-extrabold"
                  style={{ background: 'rgba(245,158,11,0.22)', color: '#FCD34D' }}
                >
                  {LETTERS[i]}
                </span>
                <span className="leading-snug">{opt}</span>
              </button>
            )
          })}
        </div>

        {/* панель подтверждения / забрать деньги */}
        <div className="min-h-[56px] flex items-center justify-center">
          <AnimatePresence mode="wait">
            {picked !== null && !revealed ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="flex items-center gap-2.5"
              >
                <span className="text-sm text-[var(--g-fg-soft)] font-semibold">Ответ «{LETTERS[picked]}»?</span>
                <button
                  onClick={confirmAnswer}
                  className="h-11 px-5 rounded-xl text-white font-extrabold text-sm inline-flex items-center gap-1.5 active:scale-95"
                  style={{ background: 'linear-gradient(135deg,#059669,#10B981)', boxShadow: '0 12px 28px -12px rgba(16,185,129,0.7)' }}
                >
                  <Check className="h-4 w-4" /> Да, верно!
                </button>
                <button
                  onClick={() => setPicked(null)}
                  className="h-11 w-11 rounded-xl grid place-items-center text-[var(--g-fg-soft)] bg-[var(--g-btn)] border border-[var(--g-chip-border)] active:scale-95"
                  aria-label="Отменить выбор"
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            ) : picked === null && !revealed && level > 0 ? (
              <motion.button
                key="take"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={takeMoney}
                className="h-10 px-5 rounded-full text-[var(--g-fg-soft)] text-sm font-extrabold bg-[var(--g-btn)] border border-[var(--g-chip-border)] inline-flex items-center gap-2 hover:bg-[var(--g-btn-hover)] active:scale-95"
              >
                <HandCoins className="h-4 w-4 text-amber-400" /> Забрать {fmt(LADDER[level - 1])} ₽
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* лестница (десктоп сбоку) */}
      <aside className="hidden md:block w-56 shrink-0 rounded-2xl p-3 bg-black/25 border border-white/[0.08]">
        <div className="text-[10px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold mb-2 px-1">Лестница приза</div>
        {ladderList}
      </aside>

      {/* оверлеи */}
      <AnimatePresence>
        {overlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[720] bg-black/60 backdrop-blur-sm grid place-items-center p-5"
            onClick={() => setOverlay(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-sm rounded-3xl p-5 border border-[var(--g-chip-border)]"
              style={{ background: 'linear-gradient(170deg,#141628,#0b0d18)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {overlay === 'ladder' && (
                <>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--g-fg-mute)] font-bold mb-2">Лестница приза</div>
                  {ladderList}
                </>
              )}
              {overlay === 'audience' && (
                <>
                  <div className="text-sm font-extrabold text-white mb-4 text-center">🎤 Мнение зала</div>
                  <div className="flex items-end justify-center gap-4 h-40">
                    {audience.map((p, i) => (
                      <div key={i} className="flex flex-col items-center gap-1.5 w-12">
                        <span className="text-xs font-extrabold text-amber-300 tabular-nums">{p}%</span>
                        <motion.div
                          initial={{ height: 4 }}
                          animate={{ height: `${Math.max(3, p)}%` }}
                          transition={{ duration: 0.7, ease: 'easeOut' }}
                          className="w-full rounded-t-md"
                          style={{ background: 'linear-gradient(to top,#B45309,#F59E0B)', minHeight: 4 }}
                        />
                        <span className="text-xs font-extrabold text-[var(--g-fg-soft)]">{LETTERS[i]}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {overlay === 'phone' && (
                <>
                  <div className="text-sm font-extrabold text-white mb-3 text-center">📞 Звонок другу</div>
                  <p className="text-[15px] text-[var(--g-fg-soft)] leading-relaxed text-center">{friendText}</p>
                </>
              )}
              <button
                onClick={() => setOverlay(null)}
                className="mt-5 h-11 w-full rounded-xl text-white font-extrabold text-sm active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}
              >
                Понятно
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function LifelineBtn({ icon, used, label, onClick }: { icon: React.ReactNode; used: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={used}
      aria-label={`Подсказка: ${label}`}
      title={used ? 'Подсказка использована' : label}
      className={[
        'h-10 w-10 rounded-full grid place-items-center border transition-all',
        used ? 'opacity-25 pointer-events-none' : 'text-amber-300 hover:bg-amber-400/15 active:scale-90',
      ].join(' ')}
      style={{
        background: used ? 'rgba(255,255,255,0.04)' : 'rgba(245,158,11,0.12)',
        borderColor: used ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.4)',
      }}
    >
      {icon}
    </button>
  )
}

function HalfIcon() {
  return (
    <span className="text-[13px] font-extrabold tracking-tighter text-amber-300">50:50</span>
  )
}
