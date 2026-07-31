'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, registerTokenGetter, registerUnauthorizedHandler, ApiError } from '@/lib/api'
import type { User } from '@/lib/types'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isInitialized: boolean
  login: (login: string, password: string) => Promise<User>
  /**
   * v20: Register no longer auto-logs-in when email verification is required.
   * Returns a result object describing what to do next:
   *   - { kind: 'verified', user } → account is active, user is logged in
   *   - { kind: 'verification_required', user, email } → show verification modal,
   *     user is NOT logged in yet (backend still issued a token, but we stash
   *     it in `pendingVerificationToken` instead of activating the session).
   */
  register: (data: {
    username: string
    email: string
    password: string
    confirmPassword?: string
    phone?: string
    displayName?: string
    gender?: 'male' | 'female' | 'other'
    referralCode?: string
  }) => Promise<
    | { kind: 'verified'; user: User }
    | { kind: 'verification_required'; user: User; email: string }
  >
  /**
   * v20: Complete the email-verification flow after the user enters the code
   * or clicks the verification link. Activates the session using the stashed
   * pending token (issued at registration time) — no second login required.
   */
  completeEmailVerification: () => void
  /** v20: stash the registration-time token until email is verified. */
  pendingVerificationToken: string | null
  /** v20: login with a stashed token (used after verification completes). */
  activateWithToken: (token: string, user: User) => void
  logout: () => Promise<void>
  updateUser: (patch: Partial<User>) => void
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isInitialized: false,
      // v20: stashed registration token — used to activate the session after
      // the user confirms their email without requiring a second login.
      pendingVerificationToken: null,

      async login(loginField, password) {
        // The backend may return several shapes from /api/auth/login:
        //   1. { token, user }                  → success, store regular JWT.
        //   2. { totpRequired, user }           → password OK, TOTP already
        //                                          enrolled; backend needs a
        //                                          6-digit code. Main app does
        //                                          NOT have a TOTP input UI —
        //                                          surface a clear error.
        //   3. { totpSetupRequired, user, token: <setup-jwt>, message }
        //                                       → admin must enroll TOTP.
        //                                          Backend issues a short-lived
        //                                          `totpPending` setup token.
        //                                          Main app does NOT have a
        //                                          TOTP setup UI — surface a
        //                                          clear error directing the
        //                                          admin to Studio. NEVER store
        //                                          the setup token as a regular
        //                                          token: it would be rejected
        //                                          by /api/auth/me (403) and
        //                                          cause an immediate logout
        //                                          loop via fetchMe().
        const data = await api.post<{
          token?: string
          user: User
          totpRequired?: boolean
          totpSetupRequired?: boolean
          message?: string
        }>('/api/auth/login', {
          json: { login: loginField, password },
        })

        if (data.totpSetupRequired) {
          throw new Error(
            data.message ||
              'Для аккаунта администратора обязательно включение 2FA. Войдите через Studio (админ-панель), чтобы настроить двухфакторную аутентификацию.',
          )
        }

        if (data.totpRequired) {
          throw new Error(
            'Требуется код 2FA. Войдите через Studio (админ-панель) или обратитесь к администратору.',
          )
        }

        if (!data.token) {
          throw new Error('Не удалось войти: сервер не вернул токен авторизации.')
        }

        set({
          user: data.user,
          token: data.token,
          isAuthenticated: true,
          isInitialized: true,
        })
        return data.user
      },

      async register(payload) {
        const data = await api.post<{ token: string; user: User }>('/api/auth/register', {
          json: payload,
        })
        // v20: Check SecuritySettings.emailVerificationRequired to decide
        // whether to auto-login or stash the token pending verification.
        let emailVerificationRequired = false
        try {
          const s = await api.get<{ settings: { emailVerificationRequired: boolean } }>('/api/security-settings')
          emailVerificationRequired = !!s.settings?.emailVerificationRequired
        } catch {
          // If we can't read settings, default to NOT requiring verification
          // (back-compat with deployments that haven't configured security).
          emailVerificationRequired = false
        }
        if (emailVerificationRequired && !data.user.emailVerified) {
          // Stash the token — the user is registered but not yet activated.
          // The auth-dialog will show the verification modal; once the user
          // confirms via link or code, completeEmailVerification() activates
          // the session with this stashed token.
          set({
            user: data.user,
            pendingVerificationToken: data.token,
            // NOT setting token / isAuthenticated — session stays inactive.
            isInitialized: true,
          })
          return { kind: 'verification_required', user: data.user, email: data.user.email || '' }
        }
        // Either verification not required, or email already verified
        // (e.g. admin auto-promotion skips verification) → auto-login.
        set({
          user: data.user,
          token: data.token,
          isAuthenticated: true,
          isInitialized: true,
          pendingVerificationToken: null,
        })
        return { kind: 'verified', user: data.user }
      },

      // v20: Activate the session with the stashed pending-verification token.
      // Called after the user successfully verifies their email (via link or
      // code). No second login required.
      activateWithToken(token, user) {
        set({
          token,
          user,
          isAuthenticated: true,
          isInitialized: true,
          pendingVerificationToken: null,
        })
      },

      // v20: Convenience wrapper — activates the session using the stashed
      // pending token, then refreshes the user from the backend to pick up
      // the updated `emailVerified` timestamp.
      completeEmailVerification() {
        const pending = get().pendingVerificationToken
        if (!pending) return
        set({
          token: pending,
          isAuthenticated: true,
          pendingVerificationToken: null,
        })
        // Best-effort refresh — non-blocking.
        get().fetchMe().catch(() => {})
      },

      async logout() {
        // Unsubscribe from Web Push BEFORE clearing the token — otherwise
        // the backend keeps sending push notifications to a logged-out
        // user's device, which is a privacy leak on shared devices.
        //
        // We fetch the current push subscription from the SW, send
        // /api/push/unsubscribe with the old (still-valid) token, and
        // THEN clear local state. If anything fails we still log out —
        // the subscription will eventually expire on its own when the
        // push service detects the user is no longer responding.
        try {
          if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready.catch(() => null)
            if (reg) {
              const sub = await reg.pushManager.getSubscription()
              if (sub) {
                // Best-effort: fire-and-forget, but use the OLD token
                // (still in `get().token` at this point) so the backend
                // accepts the unsubscribe request.
                await sub.unsubscribe().catch(() => {})
                await api
                  .post('/api/push/unsubscribe', {
                    json: { endpoint: sub.endpoint },
                    auth: true,
                  })
                  .catch(() => {})
              }
            }
          }
        } catch {
          // Non-critical — proceed with logout regardless.
        }
        set({ user: null, token: null, isAuthenticated: false })
      },

      updateUser(patch) {
        const cur = get().user
        if (cur) set({ user: { ...cur, ...patch } })
      },

      async fetchMe() {
        try {
          const data = await api.get<{ user: User }>('/api/auth/me', { auth: true })
          set({ user: data.user, isAuthenticated: true, isInitialized: true })
        } catch (e) {
          // Only log the user out on auth failures (401/403).
          // Network errors (5xx, timeouts, offline) should NOT log the user out.
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            set({ user: null, token: null, isAuthenticated: false, isInitialized: true })
          } else {
            // Transient error — keep the user logged in but mark as initialized
            // so the UI doesn't hang on a loading state forever.
            set({ isInitialized: true })
          }
        }
      },
    }),
    {
      name: '999pro-auth',
      // Persist user + token + isAuthenticated. Previously isAuthenticated
      // was NOT persisted, which caused a bug where after reload the user
      // appeared logged in (user object present) but components checking
      // `isAuthenticated` (e.g. CommentSection) would reject the action
      // with "Войдите, чтобы оставлять комментарии" — even though the user
      // WAS logged in and the token was valid.
      //
      // The original concern was "flash of authenticated UI then kicked to
      // login on 401". That is a much smaller problem than broken comments.
      // The fix: persist isAuthenticated, and AuthInit still calls fetchMe()
      // to validate the token — if fetchMe returns 401, the store logs out
      // (sets isAuthenticated=false). So the worst case is a 200ms window
      // where the UI shows the authenticated state before being logged out
      // — acceptable trade-off for working comments.
      partialize: (s) => ({
        user: s.user,
        token: s.token,
        isAuthenticated: s.isAuthenticated,
        // v20: persist pendingVerificationToken so a page refresh during the
        // verification modal doesn't lose the stashed token.
        pendingVerificationToken: s.pendingVerificationToken,
      }) as Pick<AuthState, 'user' | 'token' | 'isAuthenticated' | 'pendingVerificationToken'>,
    },
  ),
)

// Register the token getter with the api client so it always reads from the
// store (single source of truth). No more module-level variable, no more
// legacy localStorage keys.
registerTokenGetter(() => useAuthStore.getState().token)

// v9-audit-fix: register global 401 handler. When any authenticated API
// request returns 401 (expired/revoked token), trigger a fetchMe to verify.
// If fetchMe also fails, the store's fetchMe handler will logout automatically.
// This prevents the "stuck UI" problem where the user appears logged in but
// every request silently fails.
registerUnauthorizedHandler(() => {
  const store = useAuthStore.getState()
  // Only attempt recovery if we think we're authenticated — avoids infinite
  // loop where logout itself triggers API calls that 401.
  if (store.isAuthenticated && store.token) {
    // v13.2 (audit P1-4 fix): guard against the logout loop. Previously,
    // when fetchMe failed, logout() was called which calls /api/push/unsubscribe
    // with auth: true — that 401'd too, re-firing this handler. The 5s
    // debounce prevented immediate loops but the next 401 within 5s was
    // silently swallowed, leaving the user in a broken state. Now we set
    // a flag during logout so the handler bails out entirely.
    if ((global as any)._isLoggingOut) return
    // Debounce: only call fetchMe once per 5 seconds to avoid spamming
    // the backend if multiple requests 401 simultaneously.
    if (!(global as any)._last401Recovery || Date.now() - (global as any)._last401Recovery > 5000) {
      ;(global as any)._last401Recovery = Date.now()
      store.fetchMe().catch(() => {
        // fetchMe failed — logout. Set the flag so any 401 from the
        // logout sequence (push unsubscribe etc.) doesn't re-trigger.
        ;(global as any)._isLoggingOut = true
        store.logout().finally(() => {
          ;(global as any)._isLoggingOut = false
        })
      })
    }
  }
})
