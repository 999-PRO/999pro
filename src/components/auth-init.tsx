'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/lib/auth-store'

/**
 * Initializes the auth store on mount.
 *
 * - On cold load with a stored token, we DO NOT optimistically mark the store
 *   as authenticated. Instead we show a loading gate until `fetchMe()` either
 *   confirms the session (sets isAuthenticated=true) or rejects with 401
 *   (logs out). This prevents the "flash of authenticated UI then kicked to
 *   login" race when the token has expired.
 * - If no token is stored, we mark the store as initialized immediately so
 *   the UI shows the unauthenticated state.
 *
 * BUGFIX: previously, if persist restored `isInitialized: true` from a prior
 * session (it doesn't anymore, but defensive), `fetchMe` would NOT be called
 * and `isAuthenticated` would stay at whatever persist restored. Now we
 * ALWAYS call fetchMe when there's a token + we haven't fetched yet this
 * boot, regardless of isInitialized.
 */
export function AuthInit({ children }: { children: React.ReactNode }) {
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const token = useAuthStore((s) => s.token)
  // Module-level guard: ensure fetchMe runs at most once per page load.
  // Persisted state may hydrate multiple times during React strict mode
  // (double-mount in dev), but we only want to validate the token once.
  // The guard resets on full page reload (new JS module instance).
  const fetchedThisSession = useRef(false)

  useEffect(() => {
    if (fetchedThisSession.current) return
    if (token) {
      fetchedThisSession.current = true
      // Refresh profile — fetchMe sets isAuthenticated based on the response.
      // If the token is invalid (401), fetchMe logs the user out.
      void fetchMe()
    } else if (!isInitialized) {
      // No token — mark initialized so the UI can render the logged-out state
      useAuthStore.setState({ isInitialized: true })
    }
  }, [token, isInitialized, fetchMe])

  return <>{children}</>
}
