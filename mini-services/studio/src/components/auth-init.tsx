'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/auth-store'

/**
 * Initializes the auth store on mount.
 *
 * - On cold load with a stored token, we DO NOT optimistically mark the store
 *   as authenticated. Instead we show a loading gate until `fetchMe()` either
 *   confirms the session (sets isAuthenticated=true) or rejects with 401
 *   (logs out). This prevents the "flash of admin UI then kicked to login"
 *   race when the token has expired.
 * - If no token is stored, we mark the store as initialized immediately so
 *   the UI shows the login dialog.
 */
export function AuthInit({ children }: { children: React.ReactNode }) {
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (isInitialized) return
    if (token) {
      void fetchMe()
    } else {
      useAuthStore.setState({ isInitialized: true })
    }
  }, [token, isInitialized, fetchMe])

  return <>{children}</>
}
