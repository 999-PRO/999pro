'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, Loader2, Eye, EyeOff, Check, Sparkles, Lock, Mail, AtSign, KeyRound, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiError } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'
import type { User } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * FirstRunSetup — мастер первого запуска.
 *
 * Показывается ТОЛЬКО когда бэкенд сообщает { hasAdmin: false } через
 * GET /api/auth/admin-exists. После успешного создания первого
 * администратора:
 *   1. Сохраняем токен + пользователя в auth store (как при логине).
 *   2. AuthInit / page.tsx видят isAuthenticated=true, isAdmin=true и
 *      открывают дашборд автоматически.
 *   3. Этот компонент больше никогда не показывается — страница делает
 *      повторный запрос /admin-exists при следующей загрузке и получает
 *      hasAdmin:true, поэтому открывается обычная форма входа.
 *
 * Безопасность:
 *   - Форма дублирует серверную валидацию (длина пароля, формат email,
 *     совпадение паролей), но сервер всё равно перепроверяет всё.
 *   - Endpoint /api/auth/setup-admin работает только когда adminCount===0.
 *     После создания первого админа он автоматически возвращает 403/409 —
 *     форма покажет ошибку и предложит перейти к обычному входу.
 */
export function FirstRunSetup() {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Мгновенная клиентская оценка силы пароля (только для UI-индикатора;
  // сервер всё равно применяет SecuritySettings из БД).
  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: '', color: '' }
    let score = 0
    if (password.length >= 8) score++
    if (password.length >= 12) score++
    if (/[A-ZА-Я]/.test(password) && /[a-zа-я]/.test(password)) score++
    if (/\d/.test(password)) score++
    if (/[^A-Za-zА-Яа-я0-9]/.test(password)) score++
    const labels = ['', 'Слабый', 'Средний', 'Хороший', 'Сильный', 'Очень сильный']
    const colors = [
      '',
      'bg-red-500',
      'bg-orange-500',
      'bg-yellow-500',
      'bg-emerald-500',
      'bg-emerald-600',
    ]
    return { score, label: labels[score], color: colors[score] }
  }, [password])

  const passwordsMatch = !confirmPassword || password === confirmPassword
  const usernameValid = !username || /^[a-zA-Z0-9_]{3,24}$/.test(username)
  const emailValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const formValid =
    username.trim().length >= 3 &&
    usernameValid &&
    emailValid &&
    password.length >= 8 &&
    passwordsMatch &&
    displayName.trim().length >= 1

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValid || loading) return
    if (!passwordsMatch) {
      toast.error('Пароли не совпадают')
      return
    }
    setLoading(true)
    try {
      const data = await api.post<{ token: string; user: User }>('/api/auth/setup-admin', {
        json: {
          displayName: displayName.trim(),
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          password,
          confirmPassword,
        },
      })
      // Показываем экран успеха ДО того, как переключим auth store.
      // Иначе page.tsx сразу увидит isAuthenticated=true и размонтирует
      // визард — пользователь не увидит "Готово!".
      setDone(true)
      toast.success('Администратор создан!', {
        description: 'Вы автоматически вошли в Studio как администратор.',
      })
      // Небольшая пауза, чтобы пользователь увидел анимацию успеха,
      // затем сохраняем токен → page.tsx реагирует и открывает дашборд.
      setTimeout(() => {
        const isAdmin = data.user.role === 'admin'
        useAuthStore.setState({
          user: data.user,
          token: data.token,
          setupToken: null,
          isAuthenticated: true,
          isInitialized: true,
          isAdmin,
        })
        // Дублируем токен в cookie, чтобы proxy на server-side пускал
        // пользователя на /studio/* при следующей загрузке страницы.
        const AUTH_COOKIE_NAME = 'studio-auth-token'
        const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
        if (typeof document !== 'undefined') {
          document.cookie = `${AUTH_COOKIE_NAME}=${data.token}; path=/studio; max-age=${AUTH_COOKIE_MAX_AGE}; SameSite=Lax`
        }
      }, 1100)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось создать администратора'
      // Если setup уже завершён (параллельный запрос или администратор
      // уже существует) — предлагаем перейти к обычному входу.
      if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
        toast.error('Установка уже завершена', {
          description: 'Администратор уже существует. Обновите страницу, чтобы войти.',
        })
      } else {
        toast.error('Ошибка', { description: msg })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Декоративный фон — мягкие градиентные пятна + сетка */}
      <BackgroundDecor />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-8 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          {/* Логотип и заголовок */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-center mb-8"
          >
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-3xl gradient-brand shadow-glow-lg mb-4 relative">
              <ShieldCheck className="h-8 w-8 text-white" />
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-emerald-400 border-2 border-background grid place-items-center"
              >
                <Sparkles className="h-2.5 w-2.5 text-white" />
              </motion.div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              <span className="text-gradient">999PRO</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Мастер первого запуска
            </p>
          </motion.div>

          {/* Карточка с формой — Glassmorphism */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="glass-strong rounded-3xl p-6 sm:p-8 shadow-glow-lg relative overflow-hidden"
          >
            {/* Внутреннее мягкое свечение */}
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{
                background:
                  'radial-gradient(circle at 50% 0%, color-mix(in oklch, var(--primary) 18%, transparent), transparent 60%)',
              }}
            />

            <div className="relative">
              <AnimatePresence mode="wait">
                {done ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="py-12 text-center"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                      className="inline-flex h-20 w-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 items-center justify-center mb-4"
                    >
                      <Check className="h-10 w-10 text-emerald-500" />
                    </motion.div>
                    <h2 className="text-xl font-bold mb-2">Готово!</h2>
                    <p className="text-sm text-muted-foreground">
                      Администратор создан. Открываем панель управления…
                    </p>
                    <div className="mt-6 flex justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <h2 className="text-xl font-bold mb-1.5">Добро пожаловать!</h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Для завершения установки создайте первого администратора.
                    </p>

                    <form onSubmit={submit} className="space-y-4">
                      {/* Display name */}
                      <Field
                        id="displayName"
                        label="Имя администратора"
                        icon={<ShieldCheck className="h-4 w-4" />}
                      >
                        <Input
                          id="displayName"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Administrator"
                          className="rounded-2xl h-11"
                          required
                          maxLength={64}
                          autoComplete="name"
                          disabled={loading}
                        />
                      </Field>

                      {/* Username + Email */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field
                          id="username"
                          label="Имя пользователя"
                          icon={<AtSign className="h-4 w-4" />}
                          error={!usernameValid ? 'Только латиница, цифры и _' : undefined}
                        >
                          <Input
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="admin"
                            className={cn(
                              'rounded-2xl h-11',
                              !usernameValid && 'border-destructive focus-visible:ring-destructive',
                            )}
                            required
                            minLength={3}
                            maxLength={24}
                            pattern="[a-zA-Z0-9_]+"
                            autoComplete="username"
                            disabled={loading}
                          />
                        </Field>
                        <Field
                          id="email"
                          label="Email"
                          icon={<Mail className="h-4 w-4" />}
                          error={!emailValid ? 'Некорректный email' : undefined}
                        >
                          <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="admin@example.com"
                            className={cn(
                              'rounded-2xl h-11',
                              !emailValid && 'border-destructive focus-visible:ring-destructive',
                            )}
                            required
                            maxLength={256}
                            autoComplete="email"
                            disabled={loading}
                          />
                        </Field>
                      </div>

                      {/* Password */}
                      <Field
                        id="password"
                        label="Пароль"
                        icon={<KeyRound className="h-4 w-4" />}
                      >
                        <div className="relative">
                          <Input
                            id="password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Минимум 8 символов"
                            className="rounded-2xl h-11 pr-10"
                            required
                            minLength={8}
                            maxLength={128}
                            autoComplete="new-password"
                            disabled={loading}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        {/* Индикатор силы пароля */}
                        {password && (
                          <div className="mt-2 space-y-1">
                            <div className="flex gap-1 h-1">
                              {[1, 2, 3, 4, 5].map((i) => (
                                <div
                                  key={i}
                                  className={cn(
                                    'flex-1 rounded-full transition-all duration-300',
                                    i <= passwordStrength.score
                                      ? passwordStrength.color
                                      : 'bg-muted',
                                  )}
                                />
                              ))}
                            </div>
                            {passwordStrength.label && (
                              <p className="text-[11px] text-muted-foreground">
                                Сила пароля: {passwordStrength.label}
                              </p>
                            )}
                          </div>
                        )}
                      </Field>

                      {/* Confirm password */}
                      <Field
                        id="confirmPassword"
                        label="Подтвердите пароль"
                        icon={<Lock className="h-4 w-4" />}
                        error={!passwordsMatch ? 'Пароли не совпадают' : undefined}
                      >
                        <div className="relative">
                          <Input
                            id="confirmPassword"
                            type={showConfirm ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Повторите пароль"
                            className={cn(
                              'rounded-2xl h-11 pr-10',
                              !passwordsMatch && 'border-destructive focus-visible:ring-destructive',
                            )}
                            required
                            minLength={8}
                            maxLength={128}
                            autoComplete="new-password"
                            disabled={loading}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirm((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </Field>

                      {/* Submit */}
                      <motion.button
                        type="submit"
                        disabled={!formValid || loading}
                        whileTap={{ scale: 0.98 }}
                        whileHover={formValid && !loading ? { scale: 1.01 } : undefined}
                        className={cn(
                          'w-full h-12 rounded-2xl font-semibold text-white transition-all duration-300',
                          'gradient-brand shadow-glow',
                          'flex items-center justify-center gap-2',
                          'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
                        )}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Создание…
                          </>
                        ) : (
                          <>
                            Создать администратора
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </motion.button>

                      {/* Подсказка о безопасности */}
                      <p className="text-xs text-center text-muted-foreground pt-2">
                        После создания администратора эта страница больше никогда
                        не откроется. Все последующие действия — через панель
                        управления.
                      </p>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Нижний колонтитул */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="text-center text-xs text-muted-foreground mt-6"
          >
            999PRO Studio · Первоначальная настройка
          </motion.p>
        </motion.div>
      </div>
    </div>
  )
}

// ---------- Helper components ----------

function Field({
  id,
  label,
  icon,
  error,
  children,
}: {
  id: string
  label: string
  icon?: React.ReactNode
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {label}
      </Label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-destructive"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function BackgroundDecor() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Сетка */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          color: 'var(--foreground)',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        }}
      />
      {/* Мягкие цветные пятна */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2 }}
        className="absolute -top-32 -left-32 h-96 w-96 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklch, var(--primary) 30%, transparent), transparent 70%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, delay: 0.2 }}
        className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklch, #7c3aed 25%, transparent), transparent 70%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, delay: 0.4 }}
        className="absolute top-1/3 right-1/4 h-72 w-72 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklch, #38bdf8 20%, transparent), transparent 70%)',
        }}
      />
    </div>
  )
}
