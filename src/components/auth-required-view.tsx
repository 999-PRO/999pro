'use client'

/**
 * AuthRequiredView — unified "login required" screen.
 *
 * v16.8 final: replaces the misleading "Не удалось загрузить, проверьте
 * подключение к интернету" error that appeared in CLUB (and other auth-gated
 * views) when the user was not logged in. The user should never think the
 * problem is their internet — the problem is that they haven't signed in yet.
 *
 * The screen mirrors the visual language of the existing auth prompts in
 * `chat.tsx` and `profile-view.tsx`: gradient hero icon, friendly headline,
 * short explainer, two CTAs (Войти / Зарегистрироваться).
 *
 * Usage:
 *   if (!user) return <AuthRequiredView onLogin={() => setAuthOpen(true)} />
 *
 * The `features` list is configurable per-view so e.g. CLUB can highlight
 * "CLUB" first while the orders view highlights "История заказов". Defaults
 * to the full list requested by the product brief.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AuthDialog } from './auth-dialog'
import {
  MessageCircle,
  Crown,
  ShoppingBag,
  Heart,
  MessageSquare,
  Package,
  type LucideIcon,
} from 'lucide-react'

interface Feature {
  icon: LucideIcon
  label: string
}

const DEFAULT_FEATURES: Feature[] = [
  { icon: MessageCircle, label: 'Чат' },
  { icon: Crown, label: 'CLUB' },
  { icon: ShoppingBag, label: 'Корзина' },
  { icon: Heart, label: 'Лайки' },
  { icon: MessageSquare, label: 'Комментарии' },
  { icon: Package, label: 'История заказов' },
]

interface Props {
  /** Optional headline override. Falls back to a sensible default. */
  title?: string
  /** Optional explainer override. */
  description?: string
  /** Optional feature list. Defaults to the 6 features from the brief. */
  features?: Feature[]
  /** Called when the user clicks "Войти" — usually opens AuthDialog in login mode. */
  onLogin?: () => void
  /** Called when the user clicks "Зарегистрироваться" — usually opens AuthDialog in register mode.
   *  If omitted, falls back to onLogin (legacy behaviour). */
  onRegister?: () => void
}

export function AuthRequiredView({
  title = 'Войдите в аккаунт',
  description = 'Чтобы пользоваться всеми возможностями приложения — чатом, CLUB, корзиной, лайками, комментариями и историей заказов.',
  features = DEFAULT_FEATURES,
  onLogin,
  onRegister,
}: Props) {
  // Local AuthDialog state — if the parent already manages its own dialog,
  // it can pass onLogin/onRegister to wire into that. Otherwise we render
  // our own AuthDialog here.
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')

  const openLogin = () => {
    if (onLogin) {
      onLogin()
    } else {
      setAuthMode('login')
      setAuthOpen(true)
    }
  }
  const openRegister = () => {
    // v16.8 final fix: если передан onRegister — вызываем его (родитель
    // сам управляет режимом). Иначе если передан только onLogin — fallback
    // к нему (старое поведение). Иначе открываем локальный AuthDialog
    // в режиме register.
    if (onRegister) {
      onRegister()
    } else if (onLogin) {
      onLogin()
    } else {
      setAuthMode('register')
      setAuthOpen(true)
    }
  }

  return (
    <div className="page-top-padding pb-28 md:pb-12 px-4 md:px-6 min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-md text-center">
        {/* Hero icon — gradient circle with a friendly user glyph */}
        <div className="mx-auto mb-6 h-24 w-24 rounded-full gradient-brand grid place-items-center shadow-glow">
          <Crown className="h-10 w-10 text-white" />
        </div>

        {/* Headline + explainer */}
        <h2 className="text-2xl md:text-3xl font-bold mb-3 tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm md:text-base leading-relaxed mb-7 max-w-sm mx-auto">
          {description}
        </p>

        {/* Feature chips */}
        <div className="grid grid-cols-3 gap-2.5 mb-8 max-w-sm mx-auto">
          {features.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.label}
                className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-2xl glass shadow-soft text-xs font-medium"
              >
                <Icon className="h-4 w-4 text-primary" strokeWidth={2.2} />
                <span className="text-foreground/80">{f.label}</span>
              </div>
            )
          })}
        </div>

        {/* CTAs */}
        <div className="flex flex-col gap-2.5 max-w-xs mx-auto">
          <Button
            onClick={openLogin}
            className="rounded-full gradient-brand text-white font-semibold shadow-glow h-12 text-base"
          >
            Войти
          </Button>
          <Button
            onClick={openRegister}
            variant="outline"
            className="rounded-full font-semibold h-12 text-base"
          >
            Зарегистрироваться
          </Button>
        </div>

        {/* Local AuthDialog (only used when no onLogin handler is provided) */}
        {!onLogin && (
          <AuthDialog
            open={authOpen}
            onOpenChange={setAuthOpen}
            defaultMode={authMode}
          />
        )}
      </div>
    </div>
  )
}
