'use client'

// ============================================================================
// v25.24 — GameInviteCard: карточка приглашения в онлайн-игру в чате.
//   mediaUrl сообщения = duelId. Карточка подтягивает состояние партии и
//   даёт действия: Принять/Отклонить (получатель), Отмена (отправитель),
//   «Открыть игру» (активная партия), результат (завершённая).
// ============================================================================

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { useAuthStore } from '@/lib/auth-store'
import { duelApi, openDuel, type Duel } from '@/lib/games/duel-client'

// v25.25 — мета карточек приглашений (вкл. легаси-нарды)
const INVITE_META: Record<string, { title: string; emoji: string; gradient: string; legacy?: boolean }> = {
  nardi: { title: 'Нарды', emoji: '🎲', gradient: 'linear-gradient(135deg,#B0722F,#7C4A1D)', legacy: true },
  tictactoe: { title: 'Крестики-нолики', emoji: '⭕', gradient: 'linear-gradient(135deg,#0EA5E9,#6366F1)' },
  checkers: { title: 'Шашки', emoji: '⚫', gradient: 'linear-gradient(135deg,#B0722F,#7C4A1D)' },
  chess: { title: 'Шахматы', emoji: '♟️', gradient: 'linear-gradient(135deg,#8B5CF6,#5B21B6)' },
  'quiz-flags': { title: 'Угадай флаг · дуэль', emoji: '🚩', gradient: 'linear-gradient(135deg,#F43F5E,#BE123C)' },
  'quiz-capitals': { title: 'Угадай столицу · дуэль', emoji: '🏙️', gradient: 'linear-gradient(135deg,#0EA5E9,#0369A1)' },
  'quiz-millionaire': { title: 'Миллионер · дуэль', emoji: '💰', gradient: 'linear-gradient(135deg,#F59E0B,#B45309)' },
  'quiz-math': { title: 'Математика · дуэль', emoji: '🧮', gradient: 'linear-gradient(135deg,#10B981,#047857)' },
}

export function GameInviteCard({ duelId, isOwn }: { duelId: string; isOwn?: boolean }) {
  const meId = useAuthStore((s) => s.user?.id)
  const [duel, setDuel] = useState<Duel | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    duelApi
      .get(duelId)
      .then((d) => alive && setDuel(d.duel))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [duelId])

  // живое обновление по сокету
  useEffect(() => {
    const onUpd = (e: MessageEvent | CustomEvent) => {
      // пусто — подписка через getSharedSocket ниже
    }
    let off: (() => void) | null = null
    ;(async () => {
      const { getSharedSocket } = await import('@/lib/use-socket')
      const socket = getSharedSocket()
      if (!socket) return
      const handler = (payload: Duel) => {
        if (payload?.id === duelId) setDuel(payload)
      }
      socket.on('duel:updated', handler)
      off = () => socket.off('duel:updated', handler)
    })()
    return () => {
      off?.()
      void onUpd
    }
  }, [duelId])

  if (failed) {
    return (
      <div className="rounded-2xl px-4 py-3 text-[13px] text-muted-foreground bg-accent/40" style={{ minWidth: 220 }}>
        🎮 Приглашение в игру недоступно
      </div>
    )
  }

  if (!duel) {
    return (
      <div className="rounded-2xl px-4 py-4 bg-accent/40 flex items-center gap-2 text-[13px] text-muted-foreground" style={{ minWidth: 220 }}>
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка приглашения…
      </div>
    )
  }

  const meta = INVITE_META[duel.gameType] ?? { title: 'Онлайн-игра', emoji: '🎮', gradient: 'linear-gradient(135deg,#6366F1,#8B5CF6)' }
  const opponent = duel.player1Id === meId ? duel.player2 : duel.player1
  const iAmHost = duel.player1Id === meId
  const iCanAccept = duel.status === 'pending' && !iAmHost && !meta.legacy
  const title = meta.title
  const emoji = meta.emoji
  const gradient = meta.gradient

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    if (busy) return
    setBusy(true)
    haptic.tap()
    try {
      await fn()
      if (okMsg) toast.success(okMsg)
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось выполнить')
    } finally {
      setBusy(false)
    }
  }

  const statusLine =
    duel.status === 'pending'
      ? iAmHost
        ? 'Ожидаем ответа…'
        : 'Вас приглашают сыграть!'
      : duel.status === 'active'
        ? duel.turnUserId === meId
          ? 'Твой ход!'
          : 'Ходит соперник…'
        : duel.status === 'finished'
          ? duel.winnerId === meId
            ? '🏆 Ты победил!'
            : duel.winnerId
              ? 'Ты проиграл'
              : '🤝 Ничья'
          : duel.status === 'declined'
            ? 'Отклонено'
            : 'Отменено'

  return (
    <div className="overflow-hidden rounded-[20px] ring-1 ring-black/10 dark:ring-white/10" style={{ width: 250, maxWidth: '80vw' }}>
      {/* шапка-арт */}
      <div className="relative h-[86px] grid place-items-center" style={{ background: gradient }}>
        <div aria-hidden className="absolute -top-6 -right-6 h-20 w-20 rounded-full bg-white/15 blur-xl" />
        <span className="text-4xl drop-shadow-lg">{emoji}</span>
        <span className="absolute top-2 left-3 text-[10px] font-extrabold uppercase tracking-wider text-white/85">
          TRI999 · онлайн
        </span>
      </div>

      <div className="p-3 space-y-2" style={{ background: 'color-mix(in oklch, var(--card) 88%, transparent)' }}>
        <div className="text-sm font-extrabold leading-tight">{title}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {meta.legacy ? 'Игра убрана — пригласи на шашки или шахматы!' : isOwn || iAmHost ? opponent.displayName || opponent.username : 'От друга'}
        </div>
        <div className="text-[11.5px] font-bold" style={{ color: duel.status === 'finished' && duel.winnerId === meId ? '#10B981' : 'var(--muted-foreground)' }}>
          {statusLine}
        </div>

        {iCanAccept && (
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={() => act(async () => {
                await duelApi.accept(duel.id)
                openDuel(duel.id)
              }, 'Игра началась!')}
              disabled={busy}
              className="flex-1 h-9 rounded-xl text-white text-[12.5px] font-extrabold active:scale-95 disabled:opacity-50"
              style={{ background: gradient }}
            >
              {busy ? '…' : 'Играть'}
            </button>
            <button
              onClick={() => act(() => duelApi.decline(duel.id), 'Приглашение отклонено')}
              disabled={busy}
              className="flex-1 h-9 rounded-xl text-[12.5px] font-extrabold bg-foreground/[0.06] text-foreground/70 active:scale-95 disabled:opacity-50"
            >
              Позже
            </button>
          </div>
        )}

        {duel.status === 'pending' && iAmHost && (
          <button
            onClick={() => act(() => duelApi.cancel(duel.id))}
            disabled={busy}
            className="w-full h-9 rounded-xl text-[12.5px] font-extrabold bg-foreground/[0.06] text-foreground/70 active:scale-95 disabled:opacity-50"
          >
            Отменить приглашение
          </button>
        )}

        {duel.status === 'active' && (
          <button
            onClick={() => { haptic.tap(); openDuel(duel.id) }}
            className="w-full h-9 rounded-xl text-white text-[12.5px] font-extrabold active:scale-95"
            style={{ background: gradient }}
          >
            Открыть игру
          </button>
        )}
      </div>
    </div>
  )
}
