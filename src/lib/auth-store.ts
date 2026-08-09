'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, registerTokenGetter, registerSetupTokenGetter, registerUnauthorizedHandler, ApiError } from '@/lib/api'
import type { User } from '@/lib/types'

interface AuthState {
  user: User | null
  token: string | null
  /**
   * v25.3 (TZ task #1): short-lived TOTP-setup JWT (15-min expiry).
   * Issued by /api/auth/login when an admin logs in with correct password
   * but TOTP is not yet enrolled. Carries `totpPending: true`; accepted
   * ONLY by /api/auth/totp/setup, /totp/verify, /totp/disable. Rejected
   * by every admin endpoint.
   *
   * When `setupToken` is set but `token` is null, the session is
   * "mid-setup": the user is NOT authenticated (isAuthenticated=false)
   * but CAN call the three TOTP endpoints via `auth: 'totp-setup'`.
   * AdminLoginView reads `setupToken` to show the QR-code enrollment UI.
   */
  setupToken: string | null
  isAuthenticated: boolean
  isInitialized: boolean
  login: (
    login: string,
    password: string,
    totpCode?: string,
  ) => Promise<
    | User
    | {
        user: User
        totpRequired?: boolean
        totpSetupRequired?: boolean
        message?: string
      }
  >
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
  /**
   * v25.3 (TZ task #1): Complete the admin TOTP-setup flow. Called by
   * AdminLoginView after /api/auth/totp/verify succeeds. Swaps the
   * setup token for a fresh regular JWT (no totpPending) issued by the
   * backend, marks the session as authenticated, and clears setupToken.
   */
  completeTotpSetup: (token: string, user: User) => void
  /** v25.3: clear the setup token (cancel 2FA enrollment). */
  clearSetupToken: () => void
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
      // v25.3: stashed TOTP-setup token (admin first-time 2FA enrollment).
      setupToken: null,
      // v20: stashed registration token — used to activate the session after
      // the user confirms their email without requiring a second login.
      pendingVerificationToken: null,

      async login(loginField, password, totpCode) {
        // The backend may return several shapes from /api/auth/login:
        //   1. { token, user }                  → success, store regular JWT.
        //   2. { totpRequired, user }           → password OK, TOTP already
        //                                          enrolled; backend needs a
        //                                          6-digit code. v25.4: main app
        //                                          now has a TOTP input UI
        //                                          (AdminLoginView 'totp' state)
        //                                          — return the result object
        //                                          instead of throwing so the
        //                                          caller can branch.
        //   3. { totpSetupRequired, user, token: <setup-jwt>, message }
        //                                       → admin must enroll TOTP.
        //                                          Backend issues a short-lived
        //                                          `totpPending` setup token.
        //                                          v25.3: main app now handles
        //                                          this case inline via
        //                                          AdminLoginView (QR + verify).
        //                                          We stash the setup token so
        //                                          `auth: 'totp-setup'`
        //                                          requests work, and surface
        //                                          the result to the caller.
        const data = await api.post<{
          token?: string
          user: User
          totpRequired?: boolean
          totpSetupRequired?: boolean
          message?: string
        }>('/api/auth/login', {
          json: { login: loginField, password, totpCode },
        })

        // v25.3 (TZ task #1): admin must enroll TOTP. Stash the setup token
        // (NOT the regular token) so the session is NOT marked authenticated,
        // but /totp/setup and /totp/verify can be called via `auth: 'totp-setup'`.
        // The caller (AdminLoginView) reads `setupToken` from the store to
        // know it should show the QR-code enrollment UI.
        if (data.totpSetupRequired) {
          if (!data.token) {
            // Backend contract violation — should never happen.
            throw new Error(
              data.message ||
                'Сервер вернул totpSetupRequired без setup-токена. Обратитесь к администратору.',
            )
          }
          set({
            user: data.user,
            token: null,
            setupToken: data.token,
            isAuthenticated: false,
            isInitialized: true,
          })
          // Return the data object so the caller can branch on the shape
          // (mirrors Studio's auth-store.login return type).
          return data
        }

        // v25.4: TOTP already enrolled — return the result object so the
        // caller (AdminLoginView) can switch to the 'totp' code-input state.
        // Previously this threw an error, which made it impossible for an
        // admin with 2FA enabled to log into the main app.
        if (data.totpRequired) {
          // Remember the user object so the caller can render the user's
          // name/avatar in the TOTP input screen, but do NOT activate the
          // session — the admin is not yet authenticated.
          set({
            user: data.user,
            token: null,
            setupToken: null,
            isAuthenticated: false,
            isInitialized: true,
          })
          return data
        }

        if (!data.token) {
          throw new Error('Не удалось войти: сервер не вернул токен авторизации.')
        }

        set({
          user: data.user,
          token: data.token,
          setupToken: null,
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

      // v25.3 (TZ task #1): swap the setup token for a regular JWT.
      // Called by AdminLoginView after /api/auth/totp/verify succeeds —
      // the backend issues a fresh regular token (no totpPending), giving
      // the admin full access. Clears the setup token so subsequent
      // `auth: 'totp-setup'` requests fail loudly if mistakenly used.
      completeTotpSetup(token, user) {
        set({
          token,
          user,
          setupToken: null,
          isAuthenticated: true,
          isInitialized: true,
        })
      },

      // v25.3: cancel the 2FA enrollment flow (user pressed "Назад").
      // Clears the setup token without affecting any existing session.
      clearSetupToken() {
        set({ setupToken: null })
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
        set({ user: null, token: null, setupToken: null, isAuthenticated: false })
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
          // v25.3: a 403 with `totpSetupRequired: true` from /me means the
          // session is mid-TOTP-setup (setup token was used by mistake).
          // Don't logout — keep the setupToken so AdminLoginView can retry.
          if (e instanceof ApiError && e.status === 403 && e.details &&
              typeof e.details === 'object' && 'totpSetupRequired' in e.details) {
            set({ isInitialized: true })
            return
          }
          // v25.6 (auth fix): a 403 with `emailVerificationRequired: true` means
          // the user's email is not yet verified but the account is valid.
          // Don't logout — keep the token + user so the EmailVerificationModal
          // can continue polling. Logging out here was causing admins (whose
          // emailVerified was null) to be kicked to the login screen immediately
          // after login when EMAIL_VERIFICATION_REQUIRED=true.
          if (e instanceof ApiError && e.status === 403 && e.details &&
              typeof e.details === 'object' && 'emailVerificationRequired' in e.details) {
            set({ isInitialized: true })
            return
          }
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            set({ user: null, token: null, setupToken: null, isAuthenticated: false, isInitialized: true })
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
      //
      // v25.9.1 (admin chat/reviews fix): the previous `partialize` dropped
      // `isAuthenticated` on hydration in some edge cases (Zustand persist
      // merges shallowly, so nested updates could lose the flag). The
      // companion `merge` function below forces `isAuthenticated` to be
      // re-derived from `(token && user)` on every hydration — this is the
      // single source of truth. The persisted `isAuthenticated` is kept as
      // a hint but the merge overrides it.
      partialize: (s) => ({
        user: s.user,
        token: s.token,
        isAuthenticated: s.isAuthenticated,
        // v25.3: persist setupToken so a page refresh during the 2FA enrollment
        // flow doesn't lose the setup token (the admin would have to re-login).
        setupToken: s.setupToken,
        // v20: persist pendingVerificationToken so a page refresh during the
        // verification modal doesn't lose the stashed token.
        pendingVerificationToken: s.pendingVerificationToken,
      }) as Pick<AuthState, 'user' | 'token' | 'isAuthenticated' | 'setupToken' | 'pendingVerificationToken'>,
      // v25.9.1: custom merge — re-derive `isAuthenticated` from token+user
      // so the flag is always consistent with the actual session state.
      // This fixes the "admin logged in but chat/reviews say 'register'"
      // bug where `isAuthenticated` was false even though token+user were
      // present in the store after a page reload.
      merge: (persistedState, currentState) => {
        const ps = (persistedState || {}) as Partial<AuthState>
        const token = ps.token ?? currentState.token
        const user = ps.user ?? currentState.user
        const setupToken = ps.setupToken ?? currentState.setupToken
        // Authenticated = has a real JWT (not just setupToken). setupToken
        // alone means mid-TOTP-setup — admin can call TOTP endpoints but
        // NOT chat/reviews endpoints.
        const derived = !!token && !!user
        return {
          ...currentState,
          ...ps,
          // Override the persisted flag with the derived value. If fetchMe
          // later fails with 401, the store will logout (set false).
          isAuthenticated: derived,
          isInitialized: currentState.isInitialized,
        }
      },
    },
  ),
)

// Register the token getter with the api client so it always reads from the
// store (single source of truth). No more module-level variable, no more
// legacy localStorage keys.
registerTokenGetter(() => useAuthStore.getState().token)
// v25.3: register the setup-token getter too, so AdminLoginView's
// `auth: 'totp-setup'` requests can read it from the same store.
registerSetupTokenGetter(() => useAuthStore.getState().setupToken)

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
