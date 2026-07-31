// API client for Studio «Три девятки».
// Talks to the SAME backend as the main 999 — Три девятки app (default port 4000).
//
// IMPORTANT: This is a near-verbatim copy of the frontend's lib/api.ts.
// Bugs fixed here (sandbox XTransformPort routing) must be kept in sync
// between both apps. Long-term: extract to a shared @999pro/shared package.

const SANDBOX_BACKEND_PORT = 4000
const AUTH_STORAGE_KEY = '999pro-studio-auth'

// Allowed sandbox hostnames. Match either the apex domain `space-z.ai` OR any
// direct subdomain `*.space-z.ai` (e.g. `preview-z1.space-z.ai`,
// `preview.space-z.ai`, `app.space-z.ai`).
//
// The pattern is anchored to `.space-z.ai` so attacker subdomains like
// `space-z.ai.evil.com` are NOT matched (the check uses `endsWith('.space-z.ai')`
// + exact apex match, not a substring test).
const SANDBOX_HOST_APEX = 'space-z.ai'

function isSandboxHost(host: string): boolean {
  if (host === SANDBOX_HOST_APEX) return true
  // Direct subdomain only (one or more labels before .space-z.ai)
  return host.endsWith('.' + SANDBOX_HOST_APEX)
}

function computeApiBase(): string {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000'
  }
  const configured = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000'
  const pageHost = window.location.hostname

  const isPrivateIp =
    /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(pageHost)
  const isLocal = pageHost === 'localhost' || pageHost === '127.0.0.1' || isPrivateIp || pageHost.endsWith('.local')
  const sandboxHost = !isLocal && isSandboxHost(pageHost)

  if (sandboxHost) return ''

  try {
    const url = new URL(configured)
    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
      url.hostname = pageHost
      return url.toString().replace(/\/$/, '')
    }
    return configured
  } catch {
    return configured
  }
}

const LOCAL_API_BASE = computeApiBase()
const isSandbox = LOCAL_API_BASE === ''

// QW11 (S-DEAD-002): removed unused `export const API_BASE_URL`

// ============================================================================
// Auth tokens — single source of truth is the Zustand auth store.
//
// Two distinct tokens exist:
//   1. `token`         — regular JWT (full access, 7-day expiry).
//   2. `setupToken`    — short-lived JWT (15-min expiry) issued by /api/auth/login
//                       when an admin logs in with correct password but TOTP
//                       is not yet enrolled. Carries `totpPending: true` and
//                       is accepted ONLY by /api/auth/totp/setup, /totp/verify,
//                       /totp/disable (and /api/auth/me, which rejects it with
//                       403 totpSetupRequired). It is REJECTED by every admin
//                       endpoint via `requireAdmin`.
//
// ARCHITECTURAL CONTRACT: if `auth: true` is requested but no regular token is
// available, `apiFetch` THROWS — the request is NEVER sent. This enforces the
// rule: "If the user is not logged in, protected requests must not be sent at
// all."
// ============================================================================
let authTokenGetter: (() => string | null) | null = null
let authSetupTokenGetter: (() => string | null) | null = null

/** Called once by the auth store to register the regular-token getter. */
export function registerTokenGetter(fn: () => string | null) {
  authTokenGetter = fn
}

/** Called once by the auth store to register the setup-token getter. */
export function registerSetupTokenGetter(fn: () => string | null) {
  authSetupTokenGetter = fn
}

/** Returns the regular JWT (full-access token), or null if not authenticated. */
export function getToken(): string | null {
  if (authTokenGetter) return authTokenGetter()
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        const t = parsed?.state?.token
        if (typeof t === 'string' && t.length > 0) return t
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Returns the short-lived TOTP-setup JWT, or null if not in setup flow. */
export function getSetupToken(): string | null {
  if (authSetupTokenGetter) return authSetupTokenGetter()
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        const t = parsed?.state?.setupToken
        if (typeof t === 'string' && t.length > 0) return t
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Build a URL that hits the backend via the sandbox gateway when applicable. */
function buildUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  if (isSandbox) {
    const sep = cleanPath.includes('?') ? '&' : '?'
    return `${cleanPath}${sep}XTransformPort=${SANDBOX_BACKEND_PORT}`
  }
  return `${LOCAL_API_BASE}${cleanPath}`
}

/**
 * Build a relative URL for <img>/fetch.
 * v9-image-fix: /uploads/* is proxied by next.config.ts rewrites — always
 * use the relative path so next/image works on all devices (mobile Safari,
 * Android, desktop). Previously returned `?XTransformPort=4000` which broke
 * the next/image optimiser on relative URLs.
 */
export function assetUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('data:')) return path
  return path
}

export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

interface RequestOptions extends RequestInit {
  /**
   * Auth mode for the request:
   *   - `false` (default) — no Authorization header.
   *   - `true`            — regular JWT. If no regular token is in the store,
   *                         the request is NOT sent and `ApiError(401)` is
   *                         thrown. This enforces the architectural rule:
   *                         "protected requests must not be sent if the user
   *                         is not logged in."
   *   - `'totp-setup'`    — short-lived TOTP-setup JWT. Used ONLY by
   *                         `/api/auth/totp/setup`, `/totp/verify`,
   *                         `/totp/disable` during the mandatory admin 2FA
   *                         enrollment flow. If no setup token is in the
   *                         store, the request is NOT sent and `ApiError(401)`
   *                         is thrown.
   */
  auth?: boolean | 'totp-setup'
  query?: Record<string, string | number | boolean | undefined>
  json?: unknown
  form?: FormData
}

export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = false, query, json, form, headers, ...rest } = options

  let url = buildUrl(path)
  if (query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.append(k, String(v))
    }
    const qs = params.toString()
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  }

  const finalHeaders: Record<string, string> = { ...(headers as Record<string, string>) }
  if (auth === true) {
    // Regular auth: throw BEFORE fetch if no token — protected requests
    // must NEVER be sent when the user is not authenticated.
    const token = getToken()
    if (!token) {
      throw new ApiError(
        'Not authenticated — no token in store. Login first, then retry.',
        401,
      )
    }
    finalHeaders.Authorization = `Bearer ${token}`
  } else if (auth === 'totp-setup') {
    // TOTP-setup auth: throw BEFORE fetch if no setup token. The setup flow
    // must have been initiated by /api/auth/login returning a setupToken.
    const setupToken = getSetupToken()
    if (!setupToken) {
      throw new ApiError(
        'No TOTP-setup token in store. Login first to initiate 2FA enrollment.',
        401,
      )
    }
    finalHeaders.Authorization = `Bearer ${setupToken}`
  }

  let body: BodyInit | undefined
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  } else if (form) {
    body = form
  }

  const res = await fetch(url, { ...rest, headers: finalHeaders, body })
  const contentType = res.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const payload = isJson ? await res.json().catch(() => null) : await res.text()

  if (!res.ok) {
    // v13.0 (audit P1-2 fix): global 401 handler. Previously only fetchMe()
    // caught 401 — every other manager threw ApiError(401) and showed a
    // generic toast, while the auth store kept the now-invalid token.
    // The user stayed "logged in" but every action failed. Now any 401
    // triggers a forced logout via the registered handler (if any).
    if (res.status === 401 && auth === true && typeof window !== 'undefined') {
      // Use a dynamic import to avoid circular dependency: auth-store imports
      // from api.ts at module-load time. We defer the import to call time.
      import('./auth-store')
        .then((m) => {
          // Force-logout: clears token from store, redirects to login dialog.
          if (typeof m.useAuthStore !== 'undefined') {
            const store = m.useAuthStore.getState()
            // Avoid double-logout if already in progress
            if (store.isAuthenticated) {
              m.useAuthStore.setState({
                isAuthenticated: false,
                isAdmin: false,
                user: null,
                token: null,
                setupToken: null,
              })
            }
          }
        })
        .catch(() => {
          /* auth-store unavailable — ignore */
        })
    }
    const message =
      (isJson && payload && (payload.error || payload.message)) ||
      (typeof payload === 'string' && payload.length > 200 ? payload.slice(0, 200) + '…' : (typeof payload === 'string' ? payload : '')) ||
      `HTTP ${res.status}`
    throw new ApiError(message, res.status, isJson ? payload : undefined)
  }

  return payload as T
}

export const api = {
  get: <T = unknown>(path: string, opts: RequestOptions = {}) => apiFetch<T>(path, { ...opts, method: 'GET' }),
  post: <T = unknown>(path: string, opts: RequestOptions = {}) => apiFetch<T>(path, { ...opts, method: 'POST' }),
  patch: <T = unknown>(path: string, opts: RequestOptions = {}) => apiFetch<T>(path, { ...opts, method: 'PATCH' }),
  put: <T = unknown>(path: string, opts: RequestOptions = {}) => apiFetch<T>(path, { ...opts, method: 'PUT' }),
  delete: <T = unknown>(path: string, opts: RequestOptions = {}) => apiFetch<T>(path, { ...opts, method: 'DELETE' }),
}

// QW11 (S-DEAD-001): removed unused `socketUrl()` export.
// The actual socket setup is inlined in use-studio-socket.ts.
