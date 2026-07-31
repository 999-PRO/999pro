// ============================================================================
// @999pro/shared — общие типы пользователей.
// H11 fix: ранее UserRole дублировался между src/lib/types.ts (frontend) и
// mini-services/studio/src/lib/types.ts (studio). Теперь единый источник.
// ============================================================================

export type UserRole = 'user' | 'admin' | 'manager'

/**
 * Базовый интерфейс пользователя — поля, которые возвращаются публичным API
 * (publicUser() в backend/src/lib/serialisers.ts). Используется и frontend,
 * и studio для типизации auth-store.
 *
 * ВАЖНО: email/phone включены только когда backend вызывается с
 * includeContact:true (т.е. для собственного профиля пользователя).
 * Для других пользователей эти поля — undefined.
 */
export interface User {
  id: string
  username: string
  displayName?: string | null
  email?: string
  phone?: string | null
  avatar?: string | null
  bio?: string | null
  gender?: 'male' | 'female' | 'other' | null
  role?: UserRole
  isOnline?: boolean
  lastSeen?: string
  createdAt?: string
  // v16.8 final: email verification status (Date string | null).
  // The backend stores this as a DateTime in the User table and serialises
  // it through publicUser(). The frontend uses it to show the "verify your
  // email" banner in the profile screen.
  emailVerified?: string | null
  // v19.0: TOTP/2FA status (returned by publicUser when authenticated).
  totpEnabled?: boolean
}

/**
 * Chat user — a registered user as returned by GET /api/chat/users.
 * Distinct from the general `User` interface because the chat endpoint
 * guarantees non-optional `displayName` and `avatar` (always returned as
 * string-or-null, never undefined) and adds the `isSupport` flag for
 * admin/support accounts.
 */
export interface ChatUser {
  id: string
  username: string
  displayName: string | null
  email?: string
  phone?: string | null
  avatar: string | null
  isOnline: boolean
  lastSeen: string
  isSupport?: boolean
  role?: string
}
