'use client'

// ============================================================================
//  AdminLoginView — separate admin login page in the main app
// ----------------------------------------------------------------------------
//  Allows administrators to log in and access Studio directly from the app.
//  Test credentials are shown for convenience.
// ============================================================================

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Shield, Loader2, ArrowLeft, KeyRound, User, Lock, ExternalLink } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'

export function AdminLoginView({ onBack, onNavigate }: { onBack: () => void; onNavigate: (v: string) => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const authLogin = useAuthStore((s) => s.login)
  const user = useAuthStore((s) => s.user)

  // If already logged in as admin, show the admin dashboard shortcut.
  if (user?.role === 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-950">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-3xl border border-border/40 bg-background/80 backdrop-blur-xl p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 grid place-items-center shadow-lg shadow-blue-500/30">
              <Shield className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold">Вы вошли как администратор</h1>
            <p className="text-sm text-muted-foreground">Привет, {user.displayName || user.username}!</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => onNavigate('studio')}
              className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold hover:scale-[1.02] transition-transform shadow-lg shadow-blue-500/30"
            >
              <Shield className="h-5 w-5" />
              Открыть Studio
            </button>
            <button
              onClick={onBack}
              className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-accent hover:bg-accent/80 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              На главную
            </button>
          </div>

          <div className="mt-6 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">💡 Подсказка</div>
            <div className="text-xs text-muted-foreground">
              Studio — это административная панель для управления товарами, заказами, пользователями и базой знаний AI.
            </div>
          </div>
        </motion.div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!login.trim() || !password.trim()) return
    setLoading(true)
    try {
      const u = await authLogin(login, password)
      if (u.role !== 'admin') {
        toast.error('Этот аккаунт не является администратором')
        return
      }
      toast.success('Добро пожаловать, администратор!')
      onNavigate('studio')
    } catch (e: any) {
      toast.error('Ошибка входа', { description: e?.message || 'Проверьте данные' })
    } finally {
      setLoading(false)
    }
  }

  // v24.6-audit (S-CRIT-2 / C-FE-2 fix): gate default-credential hint behind explicit
  // NEXT_PUBLIC_DEV_HINTS=1 env var (same gate as Studio uses). In any production /
  // staging deploy this hint is suppressed so attackers don't see default creds.
  // v24.7 (final-release audit): removed the hardcoded 'admin12345' default
  // password from the hint — operators must use the credentials they actually
  // set via `ADMIN_PASSWORD=... bunx tsx scripts/create-admin.ts`. The hint
  // now points to that script instead of leaking a default password.
  const SHOW_DEV_HINTS = process.env.NEXT_PUBLIC_DEV_HINTS === '1'

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-950">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl border border-border/40 bg-background/80 backdrop-blur-xl p-8 shadow-2xl"
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-3 mb-6">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 grid place-items-center shadow-lg shadow-blue-500/30">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Вход для администратора</h1>
          <p className="text-sm text-muted-foreground">Доступ к Studio и управлению приложением</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" /> Логин или Email
            </label>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="admin"
              className="w-full h-12 px-4 rounded-xl bg-background border border-border/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" /> Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-12 px-4 rounded-xl bg-background border border-border/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !login.trim() || !password.trim()}
            className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] transition-transform shadow-lg shadow-blue-500/30"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
            Войти
          </button>
        </form>

        {/* Test credentials hint — only shown when NEXT_PUBLIC_DEV_HINTS=1 */}
        {SHOW_DEV_HINTS && (
          <div className="mt-5 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> Учётные данные администратора (DEV)
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Используйте логин и пароль, заданные через:</div>
              <pre className="text-[10px] bg-amber-100/50 dark:bg-amber-900/30 rounded p-2 overflow-x-auto">{`ADMIN_PASSWORD='...' \
  bunx tsx scripts/create-admin.ts`}</pre>
            </div>
          </div>
        )}

        {/* Back link */}
        <button
          onClick={onBack}
          className="w-full mt-5 flex items-center justify-center gap-1.5 h-10 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Вернуться на главную
        </button>

        {/* External Studio link */}
        <div className="mt-4 pt-4 border-t border-border/40 text-center">
          <a
            href="/studio"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Или открыть Studio напрямую <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </motion.div>
    </div>
  )
}
