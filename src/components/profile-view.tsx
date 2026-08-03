'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { useFavoritesStore, useCartStore } from '@/lib/cart-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Heart, LogOut, ShoppingBag, User, Mail, Phone, AtSign, ChevronRight, Camera, Trash2, Loader2, Crown, Star, MailCheck, MailWarning, Send, Package } from 'lucide-react'
import { initials, formatPrice } from '@/lib/format'
import { AuthDialog } from './auth-dialog'
import { AuthRequiredView } from './auth-required-view'
import { FavoritesSheet } from './favorites-sheet'
import { api, assetUrl } from '@/lib/api'
import { compressImage } from '@/lib/compress-image'
import { toast } from '@/lib/notifications'
import { useClubStore, clubApi } from '@/modules/999-club'
// v25.7 (Issue #9): useModuleAccess so we can hide the CLUB card when the
// club module is disabled in Studio → Доступ к модулям. Previously the
// card was always rendered in Profile, letting users open a disabled Club.
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'

export function ProfileView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const updateUser = useAuthStore((s) => s.updateUser)
  // Selectors instead of full-store destructure — prevents re-renders when
  // unrelated store fields (e.g. loading flags) change.
  const favoritesIds = useFavoritesStore((s) => s.ids)
  const cartItems = useCartStore((s) => s.items)
  const clubPoints = useClubStore((s) => s.points)
  // v25.7 (Issue #9): check if the club module is enabled in Studio — if
  // disabled, hide the CLUB card entirely (was always rendered before).
  const modules = useModuleAccess()
  const clubEnabled = isModuleEnabled(modules, 'club')
  const [authOpen, setAuthOpen] = useState(false)
  // v16.8 final: authMode — 'login' или 'register'. Управляет тем, в каком
  // режиме откроется AuthDialog когда пользователь кликает "Войти" или
  // "Зарегистрироваться" на AuthRequiredView. Раньше была только кнопка
  // "Войти / Регистрация" — теперь две отдельные кнопки с разными режимами.
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [favOpen, setFavOpen] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarDeleting, setAvatarDeleting] = useState(false)
  // `showAvatarMenu` toggles the small popup with "Upload / Delete" actions
  // that appears when the user clicks the camera button on their avatar.
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  // v16.8 final: email verification banner state.
  // `resendState` cycles through: 'idle' → 'sending' → 'sent' / 'error'.
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Cart is opened via global `open-cart` window event (handled by AppShell's
  // single <CartSheet> mount). Previously this view ALSO mounted its own
  // <CartSheet>, causing double subscription to the cart store + double
  // API fetches on every cart change.
  const openCart = () => window.dispatchEvent(new CustomEvent('open-cart'))

  // ----- Email verification resend -----
  // v16.8 final: triggers POST /api/auth/send-verification. The backend
  // generates a fresh 24h token, stores it in AppSetting, and emails the
  // verification link via SMTP. We update the local user object so the
  // banner disappears after a successful page reload (the backend clears
  // emailVerified=null only after the user clicks the link — the banner
  // stays visible until then, but the "sent" state replaces the button
  // with a confirmation message).
  const handleResendVerification = useCallback(async () => {
    if (resendState === 'sending') return
    setResendState('sending')
    try {
      await api.post('/api/auth/send-verification', { auth: true })
      setResendState('sent')
      toast.success('Письмо отправлено', {
        description: 'Проверьте почтовый ящик — письмо придёт в течение пары минут.',
      })
    } catch (e: any) {
      setResendState('error')
      toast.error('Не удалось отправить письмо', { description: e?.message })
      // Reset to idle after 4s so the user can try again.
      setTimeout(() => setResendState('idle'), 4000)
    }
  }, [resendState])

  // Memoize derived values to avoid recomputing on every render.
  // CartItem has `price` directly (not nested under `product`), so we
  // use `i.price` instead of the previously-broken `i.product?.price`.
  const cartCount = useMemo(() => cartItems.reduce((n, i) => n + i.quantity, 0), [cartItems])
  const cartTotal = useMemo(
    () => cartItems.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0),
    [cartItems],
  )

  // ----- Avatar upload -----
  // Compresses the picked image client-side (max 512x512, quality 0.85 —
  // avatars don't need full-res) and uploads via /api/upload. Then PATCHes
  // /api/auth/me with the returned URL. The auth store's `updateUser`
  // propagates the new avatar to every component subscribed to `user`.
  const handleAvatarPick = useCallback(async (file: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Можно загрузить только изображение')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Размер изображения не должен превышать 10 МБ')
      return
    }
    setAvatarUploading(true)
    setAvatarMenuOpen(false)
    try {
      // Compress to 512x512 max — avatars are small in the UI, no need
      // to send a 4K image and waste bandwidth.
      const compressed = await compressImage(file, 512, 0.85)
      const formData = new FormData()
      formData.append('file', compressed)
      const uploadRes = await api.post<{ url: string }>('/api/upload', { form: formData, auth: true })
      // PATCH /api/auth/me with the new avatar URL.
      const data = await api.patch<{ user: any }>('/api/auth/me', {
        json: { avatar: uploadRes.url },
        auth: true,
      })
      updateUser({ avatar: data.user.avatar })
      toast.success('Аватар обновлён')
    } catch (e: any) {
      toast.error('Не удалось загрузить аватар', { description: e?.message })
    } finally {
      setAvatarUploading(false)
      // Reset the file input so the same file can be picked again.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [updateUser])

  // ----- Avatar delete -----
  // Sends `avatar: null` to PATCH /api/auth/me — backend clears the column
  // and the UI falls back to the initials-based AvatarFallback.
  const handleAvatarDelete = useCallback(async () => {
    setAvatarDeleting(true)
    setAvatarMenuOpen(false)
    try {
      const data = await api.patch<{ user: any }>('/api/auth/me', {
        json: { avatar: null },
        auth: true,
      })
      updateUser({ avatar: data.user.avatar })
      toast.success('Аватар удалён')
    } catch (e: any) {
      toast.error('Не удалось удалить аватар', { description: e?.message })
    } finally {
      setAvatarDeleting(false)
    }
  }, [updateUser])

  if (!user) {
    // v16.8 final: unified auth-required screen. The old version had a
    // single "Войти / Регистрация" button — the new AuthRequiredView shows
    // two separate CTAs (Войти + Зарегистрироваться) plus a feature list so
    // the user understands exactly what they get by signing in.
    //
    // v16.8 final fix: onLogin открывает AuthDialog в режиме 'login',
    // onRegister — в режиме 'register'. Раньше onRegister не передавался,
    // и обе кнопки открывали диалог в режиме 'login' — кнопка
    // "Зарегистрироваться" не работала как ожидалось.
    return (
      <>
        <AuthRequiredView
          title="Войдите в аккаунт"
          description="Чтобы пользоваться чатом, лайками, комментариями и корзиной — войдите или зарегистрируйтесь."
          onLogin={() => {
            setAuthMode('login')
            setAuthOpen(true)
          }}
          onRegister={() => {
            setAuthMode('register')
            setAuthOpen(true)
          }}
        />
        <AuthDialog open={authOpen} onOpenChange={setAuthOpen} defaultMode={authMode} />
      </>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 space-y-5 page-top-padding pb-28 md:pb-6">
      {/* Hidden file input for avatar upload — opened by the camera button */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleAvatarPick(f)
        }}
      />

      {/* Profile card */}
      <Card className="p-6 rounded-3xl glass shadow-soft">
        <div className="flex items-center gap-4">
          {/* Avatar with overlay camera button — click to open menu */}
          <div className="relative shrink-0">
            <Avatar className="h-20 w-20 ring-4 ring-primary/20">
              <AvatarImage src={user.avatar ? assetUrl(user.avatar) : undefined} alt={user.username} />
              <AvatarFallback className="gradient-brand text-white text-2xl">
                {initials(user.displayName || user.username)}
              </AvatarFallback>
            </Avatar>
            {/* Loading overlay (covers avatar while uploading/deleting) */}
            {(avatarUploading || avatarDeleting) && (
              <div className="absolute inset-0 rounded-full bg-black/50 grid place-items-center backdrop-blur-sm">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
            {/* Camera button — opens the avatar menu (upload / delete) */}
            <button
              type="button"
              onClick={() => setAvatarMenuOpen((v) => !v)}
              disabled={avatarUploading || avatarDeleting}
              className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary text-white grid place-items-center shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              aria-label="Изменить аватар"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
            {/* Avatar menu popup — Upload (always) + Delete (only if avatar set) */}
            {avatarMenuOpen && !avatarUploading && !avatarDeleting && (
              <>
                {/* Click-away catcher */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setAvatarMenuOpen(false)}
                />
                <div className="absolute top-full left-0 mt-2 z-50 min-w-[180px] rounded-2xl glass border border-border/40 shadow-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-foreground/5 transition-colors"
                  >
                    <Camera className="h-4 w-4 text-primary" />
                    {user.avatar ? 'Заменить фото' : 'Загрузить фото'}
                  </button>
                  {user.avatar && (
                    <button
                      type="button"
                      onClick={() => void handleAvatarDelete()}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-destructive hover:bg-destructive/5 transition-colors border-t border-border/30"
                    >
                      <Trash2 className="h-4 w-4" />
                      Удалить фото
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{user.displayName || user.username}</h2>
            <p className="text-sm text-muted-foreground">@{user.username}</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            // v13.2 (audit P1-13 fix): await logout() before showing the
            // success toast + navigating. Previously `void logout()` ran
            // AFTER navigation — if push unsubscribe failed, the user saw
            // "Вы вышли" but the subscription lingered on the backend,
            // sending pushes to a logged-out user. Now we wait for logout
            // to complete (or fail) and surface errors.
            onClick={async () => {
              try {
                await logout()
                toast.success('Вы вышли из аккаунта')
                onNavigate('home')
              } catch {
                toast.error('Не удалось выйти — проверьте подключение')
              }
            }}
            aria-label="Выйти"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>

        {user.bio && <p className="text-sm text-muted-foreground mt-4">{user.bio}</p>}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5 text-sm">
          <InfoRow
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            value={user.email}
            verified={!!user.emailVerified}
          />
          {user.phone && (
            <InfoRow icon={<Phone className="h-4 w-4" />} label="Телефон" value={user.phone} />
          )}
          <InfoRow icon={<AtSign className="h-4 w-4" />} label="Никнейм" value={user.username} />
        </div>
      </Card>

      {/* v16.8 final: Email verification banner.
          Shown when the user's email is NOT verified (emailVerified is null).
          When email is verified, we show a small "verified" pill in the
          profile card instead (see InfoRow below). The banner uses the
          amber/warning palette to draw attention without being aggressive. */}
      {!user.emailVerified && user.email && (
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl bg-amber-500/20 grid place-items-center shrink-0">
              <MailWarning className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base mb-1">
                Подтвердите email
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Письмо с подтверждением отправлено на <strong className="text-foreground">{user.email}</strong>.
                Перейдите по ссылке в письме, чтобы разблокировать все функции.
              </p>
              {resendState === 'sent' ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <MailCheck className="h-4 w-4" />
                  <span className="font-medium">Новое письмо отправлено</span>
                </div>
              ) : (
                <button
                  onClick={handleResendVerification}
                  disabled={resendState === 'sending'}
                  className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:underline disabled:opacity-50"
                >
                  {resendState === 'sending' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {resendState === 'sending' ? 'Отправляем…' : 'Отправить письмо повторно'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setFavOpen(true)}
          className="text-left p-5 rounded-3xl glass hover:shadow-soft transition-all hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Heart className="h-4 w-4" /> Избранное
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold mt-1">{favoritesIds.length}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {favoritesIds.length > 0 ? 'Нажмите, чтобы посмотреть' : 'Пока пусто'}
          </div>
        </button>
        <button
          onClick={openCart}
          className="text-left p-5 rounded-3xl glass hover:shadow-soft transition-all hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <ShoppingBag className="h-4 w-4" /> Корзина
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold mt-1">{cartCount}</div>
          {cartCount > 0 ? (
            <div className="text-xs text-muted-foreground mt-0.5">на {formatPrice(cartTotal)}</div>
          ) : (
            <div className="text-xs text-muted-foreground mt-0.5">Пока пусто</div>
          )}
        </button>
      </div>

      {/* v24.5: My Orders card — quick access to order history */}
      <button
        onClick={() => onNavigate('orders')}
        className="w-full text-left p-4 rounded-2xl border border-border bg-card hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl grid place-items-center shrink-0 bg-blue-500/10">
            <Package className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">Мои заказы</div>
            <div className="text-xs text-muted-foreground">История и статусы заказов</div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </div>
      </button>

      {/* v12.6: My CLUB card — points balance + link to CLUB.
          v25.7 (Issue #9): hidden when the club module is disabled in
          Studio → Доступ к модулям. Previously the card always rendered,
          letting users navigate to a disabled Club view via Profile. */}
      {clubEnabled && (
        <button
          onClick={() => onNavigate('club')}
          className="w-full text-left p-5 rounded-3xl relative overflow-hidden border border-white/15 hover:shadow-glow-lg transition-all hover:-translate-y-0.5"
          style={{
            backgroundImage: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(236,72,153,0.10) 50%, rgba(139,92,246,0.12) 100%)',
          }}
        >
          <div aria-hidden className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-amber-500/20 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <div
              className="h-12 w-12 rounded-2xl grid place-items-center shrink-0 shadow-glow"
              style={{ backgroundImage: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #8b5cf6 100%)' }}
            >
              <Crown className="h-6 w-6 text-white" strokeWidth={2.4} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Star className="h-4 w-4 text-amber-500" fill="currentColor" />
                999 CLUB
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-extrabold tabular-nums">{clubPoints}</span>
                <span className="text-xs text-muted-foreground">баллов</span>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </div>
        </button>
      )}

      {/* v12.6: Achievements grid */}
      <AchievementsGrid />

      <FavoritesSheet open={favOpen} onClose={() => setFavOpen(false)} />
    </div>
  )
}

function InfoRow({
  icon,
  label,
  value,
  verified,
}: {
  icon: React.ReactNode
  label: string
  value?: string | null
  // v16.8 final: when true, shows a green checkmark next to the value
  // (used for the Email row when emailVerified is non-null).
  verified?: boolean
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-muted-foreground mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-medium truncate flex items-center gap-1">
          <span className="truncate">{value}</span>
          {verified && (
            <MailCheck
              className="h-3.5 w-3.5 text-emerald-500 shrink-0"
              strokeWidth={2.4}
              aria-label="Email подтверждён"
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// AchievementsGrid — displays computed achievement badges
// ============================================================================

function AchievementsGrid() {
  const [data, setData] = useState<{ achievements: Array<{ key: string; icon: string; title: string; desc: string; unlocked: boolean; progress?: number; total?: number }>; stats: any } | null>(null)

  useEffect(() => {
    clubApi.getAchievements().then(setData).catch(() => {})
  }, [])

  if (!data) return null

  const unlocked = data.achievements.filter((a) => a.unlocked)
  const locked = data.achievements.filter((a) => !a.unlocked)

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-base">🏅 Достижения</h3>
          <p className="text-xs text-muted-foreground">{unlocked.length} из {data.achievements.length} получено</p>
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {data.achievements.map((a) => (
          <div
            key={a.key}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl text-center ${a.unlocked ? 'bg-amber-500/10' : 'bg-foreground/5 opacity-40'}`}
            title={`${a.title} — ${a.desc}`}
          >
            <span className="text-2xl">{a.icon}</span>
            <span className="text-[9px] font-semibold leading-tight line-clamp-2">{a.title}</span>
            {!a.unlocked && a.progress != null && a.total && (
              <span className="text-[8px] text-muted-foreground">{a.progress}/{a.total}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
