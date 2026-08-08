'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/app-shell'
import { StudioErrorBoundary } from '@/components/error-boundary'
import { AuthDialog } from '@/components/auth-dialog'
// v25: First-run admin wizard — shown when /api/auth/admin-exists reports
// { hasAdmin: false }. Replaces ALL manual setup (curl, tokens, README
// instructions). The wizard calls POST /api/auth/setup-admin (no token
// needed — the endpoint only works while no admin exists).
import { FirstRunSetup } from '@/components/first-run-setup'
import { ResetAdminDialog } from '@/components/reset-admin-dialog'
import { useAuthStore } from '@/lib/auth-store'
import { api } from '@/lib/api'
import { AnimatePresence } from 'framer-motion'
import { LogOut, ShieldAlert, KeyRound } from 'lucide-react'
import { toast } from '@/lib/notifications'

// Phase 22: Code-splitting — lazy load all managers so the initial bundle
// only includes AppShell + AuthDialog. Each manager loads on-demand when
// the admin navigates to that view. This reduces the initial JS payload
// by ~400KB (10 managers × ~40KB each) and improves First Contentful Paint.
const loadingFallback = () => (
  <div className="flex items-center justify-center py-20">
    <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
  </div>
)
const AnalyticsView = dynamic(() => import('@/components/analytics-view').then(m => ({ default: m.AnalyticsView })), { ssr: false, loading: loadingFallback })
const ProductsManager = dynamic(() => import('@/components/products-manager').then(m => ({ default: m.ProductsManager })), { ssr: false, loading: loadingFallback })
const LeadsManager = dynamic(() => import('@/components/leads-manager').then(m => ({ default: m.LeadsManager })), { ssr: false, loading: loadingFallback })
const ContactsManager = dynamic(() => import('@/components/contacts-manager').then(m => ({ default: m.ContactsManager })), { ssr: false, loading: loadingFallback })
// v24.4: Mass push + departments
const MassPushManager = dynamic(() => import('@/components/mass-push-manager').then(m => ({ default: m.MassPushManager })), { ssr: false, loading: loadingFallback })
const DepartmentsManager = dynamic(() => import('@/components/departments-manager').then(m => ({ default: m.DepartmentsManager })), { ssr: false, loading: loadingFallback })
// v24.5: Global AI Assistant for ALL studio sections
const GlobalStudioAI = dynamic(() => import('@/components/global-studio-ai').then(m => ({ default: m.GlobalStudioAI })), { ssr: false })
// v12.3.1: StoriesManager RESTORED (Stories is a standalone module — not Feed).
// v12.3: FeedManager remains removed with Feed.
const StoriesManager = dynamic(() => import('@/components/stories-manager').then(m => ({ default: m.StoriesManager })), { ssr: false, loading: loadingFallback })
const ClubManager = dynamic(() => import('@/components/club-manager').then(m => ({ default: m.ClubManager })), { ssr: false, loading: loadingFallback })
const BannersManager = dynamic(() => import('@/components/banners-manager').then(m => ({ default: m.BannersManager })), { ssr: false, loading: loadingFallback })
const HeaderManager = dynamic(() => import('@/components/header-manager').then(m => ({ default: m.HeaderManager })), { ssr: false, loading: loadingFallback })
const HeroManager = dynamic(() => import('@/components/hero-manager').then(m => ({ default: m.HeroManager })), { ssr: false, loading: loadingFallback })
const AuditView = dynamic(() => import('@/components/audit-view').then(m => ({ default: m.AuditView })), { ssr: false, loading: loadingFallback })
const ShareAnalyticsView = dynamic(() => import('@/components/share-analytics-view').then(m => ({ default: m.ShareAnalyticsView })), { ssr: false, loading: loadingFallback })
const UsersManager = dynamic(() => import('@/components/users-manager').then(m => ({ default: m.UsersManager })), { ssr: false, loading: loadingFallback })
const OrdersManager = dynamic(() => import('@/components/orders-manager').then(m => ({ default: m.OrdersManager })), { ssr: false, loading: loadingFallback })
const DeliveryManager = dynamic(() => import('@/components/delivery-manager').then(m => ({ default: m.DeliveryManager })), { ssr: false, loading: loadingFallback })
const HomeManager = dynamic(() => import('@/components/home-manager').then(m => ({ default: m.HomeManager })), { ssr: false, loading: loadingFallback })
const InfoPagesManager = dynamic(() => import('@/components/info-pages-manager').then(m => ({ default: m.InfoPagesManager })), { ssr: false, loading: loadingFallback })
const ModerationManager = dynamic(() => import('@/components/moderation-manager').then(m => ({ default: m.ModerationManager })), { ssr: false, loading: loadingFallback })
// v18.5: AI Knowledge Base Manager — admin CRUD for AI Assistant data source.
const AIKnowledgeBaseManager = dynamic(() => import('@/components/aikb-manager').then(m => ({ default: m.AIKnowledgeBaseManager })), { ssr: false, loading: loadingFallback })
// v19.0: New admin sections — AI providers, promo codes, bonus points, module access, security
const AIProvidersManager = dynamic(() => import('@/components/ai-providers-manager').then(m => ({ default: m.AIProvidersManager })), { ssr: false, loading: loadingFallback })
const PromoCodesManager = dynamic(() => import('@/components/promo-codes-manager').then(m => ({ default: m.PromoCodesManager })), { ssr: false, loading: loadingFallback })
const BonusPointsManager = dynamic(() => import('@/components/bonus-points-manager').then(m => ({ default: m.BonusPointsManager })), { ssr: false, loading: loadingFallback })
const ModuleAccessManager = dynamic(() => import('@/components/module-access-manager').then(m => ({ default: m.ModuleAccessManager })), { ssr: false, loading: loadingFallback })
const SecurityManager = dynamic(() => import('@/components/security-manager').then(m => ({ default: m.SecurityManager })), { ssr: false, loading: loadingFallback })
// v20: New registration + communication settings
const RegistrationSettingsManager = dynamic(() => import('@/components/registration-settings-manager').then(m => ({ default: m.RegistrationSettingsManager })), { ssr: false, loading: loadingFallback })
const CommunicationManager = dynamic(() => import('@/components/communication-manager').then(m => ({ default: m.CommunicationManager })), { ssr: false, loading: loadingFallback })
const SplashScreenManager = dynamic(() => import('@/components/splash-screen-manager').then(m => ({ default: m.SplashScreenManager })), { ssr: false, loading: loadingFallback })
// v22 audit: Manager management — create / block / role change.
const ManagersManager = dynamic(() => import('@/components/managers-manager').then(m => ({ default: m.ManagersManager })), { ssr: false, loading: loadingFallback })
// v25.8 (TRI999 launch): Chat settings — visibility + test-data cleanup
const ChatSettingsManager = dynamic(() => import('@/components/chat-settings-manager').then(m => ({ default: m.ChatSettingsManager })), { ssr: false, loading: loadingFallback })

type View = 'analytics' | 'share' | 'products' | 'users' | 'managers' | 'leads' | 'contacts' | 'stories' | 'club' | 'banners' | 'hero' | 'header' | 'audit' | 'orders' | 'delivery' | 'home' | 'info-pages' | 'moderation' | 'aikb' | 'ai-providers' | 'promo-codes' | 'bonus-points' | 'module-access' | 'security' | 'registration-settings' | 'communication' | 'splash-screen' | 'mass-push' | 'departments' | 'chat-settings'

const VALID_VIEWS = ['analytics', 'share', 'products', 'users', 'managers', 'leads', 'contacts', 'stories', 'club', 'banners', 'hero', 'header', 'audit', 'orders', 'delivery', 'home', 'info-pages', 'moderation', 'aikb', 'ai-providers', 'promo-codes', 'bonus-points', 'module-access', 'security', 'registration-settings', 'communication', 'splash-screen', 'mass-push', 'departments', 'chat-settings']

function getInitialView(): View {
  if (typeof window === 'undefined') return 'analytics'
  const hash = window.location.hash.replace('#', '')
  if (hash && VALID_VIEWS.includes(hash)) return hash as View
  const params = new URLSearchParams(window.location.search)
  const v = params.get('view')
  if (v && VALID_VIEWS.includes(v)) return v as View
  return 'analytics'
}

export default function StudioPage() {
  const [view, setView] = useState<View>(() => getInitialView())
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [resetOpen, setResetOpen] = useState(false)
  // firstRunCheck: 'checking' | 'needed' | 'not-needed'
  const [firstRunCheck, setFirstRunCheck] = useState<'checking' | 'needed' | 'not-needed'>('checking')
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const authed = isAuthenticated && isAdmin
  const logout = useAuthStore((s) => s.logout)
useEffect(() => {
    const onPop = () => setView(getInitialView())
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
  }, [])

  // ====== First-run admin check ======
  // v25: При инициализации делаем запрос /api/auth/admin-exists.
  //   - { hasAdmin: false } → показываем мастер первого запуска (FirstRunSetup).
  //     Мастер вызывает POST /api/auth/setup-admin (без токена), после
  //     успешного создания администратора автоматически входит в систему
  //     и открывает дашборд.
  //   - { hasAdmin: true } → показываем обычный auth-dialog (форма входа).
  //   - Сетевая ошибка     → показываем auth-dialog как fallback (если
  //     бэкенд поднимется — пользователь сможет войти).
  useEffect(() => {
    if (!isInitialized) return
    if (authed) {
      setFirstRunCheck('not-needed')
      return
    }
    setFirstRunCheck('checking')
    api
      .get<{ hasAdmin: boolean }>('/api/auth/admin-exists')
      .then((data) => {
        if (data.hasAdmin === false) {
          // Администраторов нет — показываем мастер первого запуска.
          setFirstRunCheck('needed')
          setAuthOpen(false)
        } else {
          // Администратор существует — показываем обычную форму входа.
          setFirstRunCheck('not-needed')
          setAuthOpen(true)
        }
      })
      .catch(() => {
        // Backend недоступен — показываем auth-dialog, пусть пользователь
        // попытается войти (если backend поднимется — войдёт)
        setFirstRunCheck('not-needed')
        setAuthOpen(true)
      })
  }, [isInitialized, authed])

  const navigate = useCallback((v: string) => {
    setView(v as View)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('view', v)
      url.hash = v
      window.history.pushState({}, '', url.toString())
    }
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  const handleLogout = useCallback(() => {
    logout()
    setAuthOpen(true)
    toast.success('Вы вышли')
  }, [logout])

  // Loading gate
  if (!isInitialized || firstRunCheck === 'checking') {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Загрузка Studio…</p>
        </div>
      </div>
    )
  }

  // v25: First-run setup wizard — shown when no admin exists yet.
  // This is a full-screen page (no AppShell chrome) so the operator
  // can't navigate anywhere until they create the first admin.
  // After successful creation, the wizard sets isAuthenticated=true in
  // the auth store, this effect re-runs, and we fall through to the
  // normal authed dashboard.
  if (firstRunCheck === 'needed' && !authed) {
    return <FirstRunSetup />
  }

  return (
    <>
      <AppShell
        view={view}
        onNavigate={navigate}
        onOpenSearch={() => navigate('products')}
        onLogout={handleLogout}
      >
        <AnimatePresence mode="wait">
          {!authed ? (
            token && user && !isAdmin ? (
              <div key="denied" className="min-h-[60vh] grid place-items-center px-4">
                <div className="text-center max-w-md">
                  <div className="h-20 w-20 rounded-3xl bg-destructive/10 mx-auto mb-4 grid place-items-center">
                    <ShieldAlert className="h-10 w-10 text-destructive" />
                  </div>
                  <h2 className="text-2xl font-bold mb-2">Доступ запрещён</h2>
                  <p className="text-muted-foreground mb-2">
                    Вы вошли как <code className="font-mono">{user.email || user.username}</code> —
                    это аккаунт обычного пользователя, а Studio доступна только администраторам.
                  </p>
                  <p className="text-muted-foreground mb-6">
                    Выйдите и войдите под аккаунтом администратора.
                  </p>

                  {/* Default admin credentials hint — shown ONLY when the
                      operator has explicitly opted in via
                      NEXT_PUBLIC_DEV_HINTS=1 in the studio env. Previously
                      this gate was `NODE_ENV === 'development'`, but that
                      leaks credentials whenever someone runs a `next build`
                      + `next start` pipeline in dev mode on a misconfigured
                      host (S-MED-007). The opt-in flag is empty by default. */}
                  {process.env.NEXT_PUBLIC_DEV_HINTS === '1' && (
                    <div className="text-xs text-left bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 mb-6">
                      <div className="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                        Учётные данные администратора (заданы через веб-мастер первого запуска):
                      </div>
                      <div className="font-mono">
                        email и пароль заданы вами при первом запуске Studio.
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-3 items-center">
                    <button
                      onClick={handleLogout}
                      className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full gradient-brand text-white font-semibold shadow-glow hover:opacity-90 transition-opacity"
                    >
                      Выйти и войти под админом
                    </button>
                    <button
                      onClick={() => setAuthOpen(true)}
                      className="text-sm text-primary font-semibold hover:underline"
                    >
                      Открыть форму входа без выхода
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div key="login" className="min-h-[60vh] grid place-items-center px-4">
                <div className="text-center max-w-md">
                  <div className="h-20 w-20 rounded-3xl gradient-brand mx-auto mb-4 grid place-items-center shadow-glow">
                    <LogOut className="h-10 w-10 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold mb-2">Добро пожаловать в Studio</h2>
                  <p className="text-muted-foreground mb-6">
                    Войдите или зарегистрируйтесь. Доступ к Studio имеют только
                    администраторы.
                  </p>

                  {/* Two equal buttons — "Войти" and "Зарегистрироваться".
                      Symmetric, identical to the main app's auth dialog switcher.
                      Each opens the dialog in the corresponding mode. */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button
                      onClick={() => {
                        setAuthMode('login')
                        setAuthOpen(true)
                      }}
                      className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full gradient-brand text-white font-semibold shadow-glow hover:opacity-90 transition-opacity"
                    >
                      Войти
                    </button>
                    <button
                      onClick={() => {
                        setAuthMode('register')
                        setAuthOpen(true)
                      }}
                      className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full border-2 border-primary text-primary font-semibold hover:bg-primary/5 transition-colors"
                    >
                      Зарегистрироваться
                    </button>
                  </div>

                  {/* Default admin credentials hint — opt-in only via
                      NEXT_PUBLIC_DEV_HINTS=1 (S-MED-007). */}
                  {process.env.NEXT_PUBLIC_DEV_HINTS === '1' && (
                    <div className="text-xs text-left bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 mb-6">
                      <div className="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                        Учётные данные администратора (заданы через веб-мастер первого запуска):
                      </div>
                      <div className="font-mono">
                        email и пароль заданы вами при первом запуске Studio.
                      </div>
                    </div>
                  )}

                  {/* Кнопка "забыли пароль" — показывает reset dialog */}
                  <div>
                    <button
                      onClick={() => {
                        setAuthOpen(false)
                        setResetOpen(true)
                      }}
                      className="inline-flex items-center gap-1.5 text-sm text-primary font-semibold hover:underline"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Забыли пароль? Сбросить админа
                    </button>
                  </div>
                </div>
              </div>
            )
          ) : (
            <StudioErrorBoundary key={view}>
              {view === 'analytics' && <AnalyticsView key="analytics" />}
              {view === 'share' && <ShareAnalyticsView key="share" />}
              {view === 'products' && <ProductsManager key="products" />}
              {view === 'users' && <UsersManager key="users" />}
              {view === 'managers' && <ManagersManager key="managers" />}
              {view === 'chat-settings' && <ChatSettingsManager key="chat-settings" />}
              {view === 'leads' && <LeadsManager key="leads" />}
              {view === 'contacts' && <ContactsManager key="contacts" />}
              {view === 'mass-push' && <MassPushManager key="mass-push" />}
              {view === 'departments' && <DepartmentsManager key="departments" />}
              {/* v12.3.1: Stories render block RESTORED. */}
              {view === 'stories' && <StoriesManager key="stories" />}
              {view === 'club' && <ClubManager key="club" />}
              {view === 'banners' && <BannersManager key="banners" />}
              {view === 'hero' && <HeroManager key="hero" />}
              {view === 'header' && <HeaderManager key="header" />}
              {view === 'audit' && <AuditView key="audit" />}
              {view === 'orders' && <OrdersManager key="orders" />}
              {view === 'delivery' && <DeliveryManager key="delivery" />}
              {view === 'home' && <HomeManager key="home" />}
              {view === 'info-pages' && <InfoPagesManager key="info-pages" />}
              {view === 'moderation' && <ModerationManager key="moderation" />}
              {view === 'aikb' && <AIKnowledgeBaseManager key="aikb" />}
              {/* v19.0: New admin sections */}
              {view === 'ai-providers' && <AIProvidersManager key="ai-providers" />}
              {view === 'promo-codes' && <PromoCodesManager key="promo-codes" />}
              {view === 'bonus-points' && <BonusPointsManager key="bonus-points" />}
              {view === 'module-access' && <ModuleAccessManager key="module-access" />}
              {/* v20: New registration + communication settings */}
              {view === 'registration-settings' && <RegistrationSettingsManager key="registration-settings" />}
              {view === 'communication' && <CommunicationManager key="communication" />}
              {view === 'splash-screen' && <SplashScreenManager key="splash-screen" />}
              {view === 'security' && <SecurityManager key="security" />}
            </StudioErrorBoundary>
          )}

          {/* v24.5: Global AI Assistant for ALL studio sections.
              Maps the current view to an AI context type so the AI knows
              what the admin is editing. getData collects form data from
              the active section via a simple DOM scrape (inputs/textareas). */}
          {authed && <GlobalStudioAI view={view} />}
        </AnimatePresence>

        {/* Auth dialog — показываем ТОЛЬКО когда wizard НЕ нужен.
            defaultMode управляется кнопками "Войти" / "Зарегистрироваться". */}
        {firstRunCheck === 'not-needed' && (
          <AuthDialog
            open={authOpen}
            onOpenChange={setAuthOpen}
            defaultMode={authMode}
            key={authMode /* re-mount on mode change so internal state resets */}
          />
        )}
      </AppShell>

      {/* Reset dialog — для случая "забыли пароль" */}
      <ResetAdminDialog
        open={resetOpen}
        onComplete={() => {
          setResetOpen(false)
          setFirstRunCheck('not-needed')
          setAuthOpen(false)
        }}
        onClose={() => setResetOpen(false)}
      />
    </>
  )
}
