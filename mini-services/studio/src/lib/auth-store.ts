'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, registerTokenGetter, registerSetupTokenGetter, ApiError } from '@/lib/api'
import type { User } from '@/lib/types'

interface AuthState {
  user: User | null
  /** Regular JWT — full access (7-day expiry). Present only when fully authenticated. */
  token: string | null
  /**
   * Short-lived TOTP-setup JWT (15-min expiry). Issued by /api/auth/login
   * when an admin logs in with correct password but TOTP is not yet enrolled.
   * Carries `totpPending: true`; accepted ONLY by /api/auth/totp/setup,
   * /totp/verify, /totp/disable. Rejected by every admin endpoint.
   *
   * When `setupToken` is set but `token` is null, the session is "mid-setup":
   * the user is NOT authenticated (isAuthenticated=false) but CAN call the
   * three TOTP endpoints via `auth: 'totp-setup'`.
   */
  setupToken: string | null
  isAuthenticated: boolean
  isInitialized: boolean
  /** True when user is an admin (role === 'admin'). Set by fetchMe/login. */
  isAdmin: boolean
  /**
   * Wave 3 (S-PROD-001): login now returns either a User (success) or an
   * object with totpRequired/totpSetupRequired (2FA flow). Caller (AuthDialog)
   * must check the return shape.
   */
  login: (login: string, password: string, totpCode?: string) => Promise<User | {
    user: User
    totpRequired?: boolean
    totpSetupRequired?: boolean
    message?: string
  }>
  register: (params: {
    username: string
    email: string
    password: string
    phone?: string
    displayName?: string
    gender?: 'male' | 'female' | 'other'
  }) => Promise<User>
  logout: () => void
  fetchMe: () => Promise<void>
  /** Replace the auth token in-store. Used after /change-password, which
   *  bumps tokenVersion and issues a fresh token — the OLD token would be
   *  rejected with 401 on the next authenticated request. */
  setToken: (token: string) => void
  /**
   * Complete the TOTP-setup flow: replace the setupToken with a fresh regular
   * JWT (issued by /totp/verify after successful enrollment) and mark the
   * session as fully authenticated.
   */
  completeTotpSetup: (token: string, user: User) => void
  /**
   * v19.1 fix: complete the admin-reset flow. Called by reset-admin-dialog
   * after a successful /api/auth/reset-admin call. Sets the token, user,
   * isAuthenticated, isAdmin AND the auth cookie (so Next.js middleware
   * gates /studio/* correctly on the next hard page load).
   */
  completeReset: (token: string, user: User) => void
}

// v16.8 production lockdown: mirror the auth token into a cookie so the
// Next.js middleware (src/middleware.ts) can server-side gate access to
// /studio/* — direct URL access without any token returns 403. The cookie
// is NOT httpOnly (client-side JS needs to clear it on logout) and carries
// NO sensitive payload beyond the JWT (which is already in localStorage).
// Real authorization (token validation + admin role check) is still done
// by the backend on every /api/* request via requireAuth/requireAdmin.
const AUTH_COOKIE_NAME = 'studio-auth-token'
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days (matches JWT expiry)

function setAuthCookie(token: string | null) {
  if (typeof document === 'undefined') return // SSR guard
  if (token) {
    document.cookie = `${AUTH_COOKIE_NAME}=${token}; path=/studio; max-age=${AUTH_COOKIE_MAX_AGE}; SameSite=Lax`
  } else {
    document.cookie = `${AUTH_COOKIE_NAME}=; path=/studio; max-age=0; SameSite=Lax`
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setupToken: null,
      isAuthenticated: false,
      isInitialized: false,
      isAdmin: false,
      async login(loginField, password, totpCode) {
        // Wave 3 (S-PROD-001): login flow now handles 3 possible responses:
        //   1. { token, user }               → success, store token
        //   2. { totpRequired, user }        → password OK, need TOTP code (already enrolled)
        //   3. { totpSetupRequired, user, token: setupToken, message }
        //                                    → password OK, admin must enroll TOTP first.
        //                                      The backend issues a short-lived
        //                                      `totpPending: true` setup token so the
        //                                      client can call /totp/setup and /totp/verify.
        const data = await api.post<{
          token?: string
          user: User
          totpRequired?: boolean
          totpSetupRequired?: boolean
          message?: string
        }>('/api/auth/login', {
          json: { login: loginField, password, totpCode },
        })

        // Case 2: password OK, TOTP already enrolled — need a 6-digit code.
        // No token of either kind is stored. The user re-submits with the code.
        if (data.totpRequired) {
          return data
        }

        // Case 3: password OK, admin must enroll TOTP. Store the setupToken
        // (NOT the regular token) so the session is NOT marked authenticated,
        // but /totp/setup and /totp/verify can be called via `auth: 'totp-setup'`.
        if (data.totpSetupRequired) {
          if (!data.token) {
            // Backend contract violation — should never happen. Surface as a
            // hard error so the bug is visible immediately, not silently swallowed.
            throw new Error(
              'Backend returned totpSetupRequired without a setup token. ' +
              'Check /api/auth/login implementation.',
            )
          }
          const isAdmin = data.user.role === 'admin'
          set({
            user: data.user,
            token: null,
            setupToken: data.token,
            isAuthenticated: false,
            isInitialized: true,
            isAdmin,
          })
          return data
        }

        // Case 1: success — regular JWT issued, full access.
        const isAdmin = data.user.role === 'admin'
        setAuthCookie(data.token!)
        set({
          user: data.user,
          token: data.token!,
          setupToken: null,
          isAuthenticated: true,
          isInitialized: true,
          isAdmin,
        })
        return data.user
      },

      async register({ username, email, password, phone, displayName, gender }) {
        // Calls the same /api/auth/register endpoint as the main app.
        // Sends the same fields (including phone + gender) so a Studio-registered
        // user is indistinguishable from a main-app-registered user.
        //
        // Backend auto-promotes the FIRST registered user to admin when
        // no admins exist (first-run scenario). Subsequent registrations
        // create role='user' accounts — those will see "Доступ запрещён"
        // in Studio unless an admin promotes them.
        const data = await api.post<{ token: string; user: User }>('/api/auth/register', {
          json: {
            username: username.trim().toLowerCase(),
            email: email.trim().toLowerCase(),
            password,
            ...(phone ? { phone: phone.trim() } : {}),
            ...(displayName ? { displayName: displayName.trim() } : {}),
            ...(gender ? { gender } : {}),
          },
        })
        const isAdmin = data.user.role === 'admin'
        setAuthCookie(data.token)
        set({
          user: data.user,
          token: data.token,
          setupToken: null,
          isAuthenticated: true,
          isInitialized: true,
          isAdmin,
        })
        return data.user
      },

      logout() {
        setAuthCookie(null)
        set({
          user: null,
          token: null,
          setupToken: null,
          isAuthenticated: false,
          isAdmin: false,
        })
      },

      setToken(token) {
        setAuthCookie(token)
        set({ token })
      },

      completeTotpSetup(token, user) {
        // Swap the setup token for a regular JWT — full admin access restored.
        const isAdmin = user.role === 'admin'
        setAuthCookie(token)
        set({
          token,
          setupToken: null,
          user,
          isAuthenticated: true,
          isInitialized: true,
          isAdmin,
        })
      },

      // v19.1 fix: same pattern as completeTotpSetup — ensures the auth
      // cookie is set after a successful admin reset.
      completeReset(token, user) {
        const isAdmin = user.role === 'admin'
        setAuthCookie(token)
        set({
          token,
          setupToken: null,
          user,
          isAuthenticated: true,
          isInitialized: true,
          isAdmin,
        })
      },

      async fetchMe() {
        try {
          const data = await api.get<{ user: User }>('/api/auth/me', { auth: true })
          const isAdmin = data.user.role === 'admin'
          set({ user: data.user, isAuthenticated: true, isInitialized: true, isAdmin })
        } catch (e) {
          // Only log out on auth errors (401/403). Transient network errors
          // keep the session intact.
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            setAuthCookie(null)
            set({
              user: null,
              token: null,
              setupToken: null,
              isAuthenticated: false,
              isInitialized: true,
              isAdmin: false,
            })
          } else {
            set({ isInitialized: true })
          }
        }
      },
    }),
    {
      name: '999pro-studio-auth',
      partialize: (s) => ({
        user: s.user,
        token: s.token,
        setupToken: s.setupToken,
        isAuthenticated: s.isAuthenticated,
        isAdmin: s.isAdmin,
      }) as Pick<AuthState, 'user' | 'token' | 'setupToken' | 'isAuthenticated' | 'isAdmin'>,
    },
  ),
)

// Single source of truth — register both token getters with the api client
registerTokenGetter(() => useAuthStore.getState().token)
registerSetupTokenGetter(() => useAuthStore.getState().setupToken)
