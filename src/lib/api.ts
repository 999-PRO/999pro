// API client for the 999 — Три девятки backend.
//
// All requests go through the sandbox gateway. To reach the backend
// (port 4000) we add `?XTransformPort=4000` to every URL — the gateway
// strips the query param and forwards the request to the right service.
//
// Outside the sandbox (local dev), the same code falls back to a direct
// request to `NEXT_PUBLIC_API_BASE` (default `http://localhost:4000`).

const SANDBOX_BACKEND_PORT = 4000
const AUTH_STORAGE_KEY = '999pro-auth'

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
  // Server-side (SSR/SSG): use NEXT_PUBLIC_API_BASE or default to backend directly.
  // Next.js server-side fetch() doesn't enforce CORS, so this is safe.
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000'
  }

  // Browser-side: ALWAYS use relative paths (empty string).
  //
  // v25.2-CORS-FIX: Previously this swapped `localhost` → page host (e.g.
  // 45.11.92.23) and returned an absolute URL like `http://45.11.92.23:4000`.
  // That made the browser send cross-origin requests to port 4000, which
  // triggered CORS preflight (OPTIONS) on every POST. If the backend's
  // CLIENT_ORIGIN allowlist didn't perfectly match the Origin header
  // (e.g. due to systemd quoting, missing entry, or trailing slash), the
  // preflight failed with "No 'Access-Control-Allow-Origin' header" and
  // registration broke.
  //
  // Now: the browser ALWAYS uses relative `/api/*` paths. Next.js's
  // `rewrites()` in next.config.ts proxies these to the backend
  // server-side (localhost:4000). Server-to-server requests have no CORS
  // restrictions, so the browser never sees a cross-origin request and
  // never sends a preflight. This eliminates the entire class of CORS
  // issues regardless of how the deployment is configured.
  //
  // The only exception is the sandbox preview gateway (*.space-z.ai),
  // which still needs the XTransformPort query param — but that's also
  // a relative-path request, just with an extra query string.
  const pageHost = window.location.hostname
  const isPrivateIp =
    /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(pageHost)
  const isLocal = pageHost === 'localhost' || pageHost === '127.0.0.1' || isPrivateIp || pageHost.endsWith('.local')
  const isSandbox = !isLocal && isSandboxHost(pageHost)

  // Both sandbox and non-sandbox return '' (relative paths).
  // The only difference is buildUrl() adds XTransformPort for sandbox.
  void isSandbox // kept for clarity; both branches now return ''
  return ''
}

const LOCAL_API_BASE = computeApiBase()
const isSandbox = LOCAL_API_BASE === ''

// ============================================================================
// Auth token — single source of truth is the Zustand auth store.
// api.ts reads it lazily on each request via a getter registered by the store.
// This eliminates the triple-source desync bug (localStorage vs module var
// vs legacy 999pro_token key).
// ============================================================================
let authTokenGetter: (() => string | null) | null = null

/** Called once by the auth store to register the token getter. */
export function registerTokenGetter(fn: () => string | null) {
  authTokenGetter = fn
}

// v9-audit-fix: global 401 handler. When an authenticated request returns 401,
// the auth store registers a callback to handle it (logout + redirect to login).
// This prevents the "stuck UI" problem where the user appears logged in but
// every request silently fails.
let unauthorizedHandler: (() => void) | null = null

/** Called once by the auth store to register the 401 handler. */
export function registerUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn
}

export function getToken(): string | null {
  if (authTokenGetter) return authTokenGetter()
  // Fallback: read from the same localStorage key the auth store uses.
  // This is only used during cold boot before the store has registered.
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

/** Build a URL that hits the backend via the sandbox gateway when applicable. */
function buildUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  // v25.2-CORS-FIX: Browser always uses relative paths (LOCAL_API_BASE === '').
  // Only sandbox (*.space-z.ai) needs the XTransformPort query param so the
  // public gateway knows which internal port to forward to.
  if (isSandbox && typeof window !== 'undefined' && isSandboxHost(window.location.hostname)) {
    const sep = cleanPath.includes('?') ? '&' : '?'
    return `${cleanPath}${sep}XTransformPort=${SANDBOX_BACKEND_PORT}`
  }
  // All other cases (localhost, LAN IP, public IP, domain): relative path.
  // Next.js rewrites() in next.config.ts proxies /api/* → backend:4000
  // server-side, so no CORS preflight from the browser.
  return `${LOCAL_API_BASE}${cleanPath}`
}

/**
 * Build a relative URL for <img>/fetch that works inside and outside sandbox.
 *
 * v9-image-fix: previously this returned `?XTransformPort=4000` for /uploads/*
 * in sandbox mode. That worked for fetch() (api.ts → buildUrl) but BROKE
 * next/image on mobile Safari — `/_next/image?url=/uploads/x.jpg?XTransformPort=4000`
 * confuses the optimiser and produces "error image with src /uploads".
 *
 * Now: /uploads/* is served via next.config.ts rewrites (which already
 * route `/uploads/:path*` to the backend). Both sandbox and local-dev just
 * use the relative path. The rewrite respects `BACKEND_URL` env, so in
 * preview the gateway handles port translation automatically.
 */
export function assetUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('data:')) return path
  // /uploads/* and /api/* are proxied by next.config.ts rewrites —
  // always use the relative path so next/image and <img> both work.
  if (path.startsWith('/uploads/') || path.startsWith('/api/')) {
    return path
  }
  return path
}

/** Build a socket.io connection URL for the backend. */
export function socketUrl(): { url: string; query: Record<string, string> } {
  // v25.2-CORS-FIX: same logic as buildUrl — browser always uses relative
  // path so the WebSocket connects to the same origin (no CORS). Only
  // sandbox needs the XTransformPort query param.
  const isBrowserSandbox =
    typeof window !== 'undefined' && isSandboxHost(window.location.hostname)
  if (isBrowserSandbox) {
    return {
      url: '/',
      query: { XTransformPort: String(SANDBOX_BACKEND_PORT) },
    }
  }
  // Browser (non-sandbox) → relative '/' (proxied by Next.js rewrites).
  // Server-side → LOCAL_API_BASE (http://localhost:4000).
  return { url: LOCAL_API_BASE || '/', query: {} }
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
  auth?: boolean
  query?: Record<string, string | number | boolean | undefined>
  json?: unknown
  form?: FormData
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
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
  if (auth) {
    // ARCHITECTURAL CONTRACT: if `auth: true` is requested but no token is
    // available, the request is NOT sent. This enforces the rule:
    // "If the user is not logged in, protected requests must not be sent
    // at all." Previously this silently sent the request without an
    // Authorization header, causing backend 401 "Authorization header
    // missing" errors that were impossible to distinguish from a real
    // auth failure. Now the caller gets an immediate, local 401 ApiError
    // and the backend never sees the request.
    const token = getToken()
    if (!token) {
      throw new ApiError(
        'Not authenticated — no token in store. Login first, then retry.',
        401,
      )
    }
    finalHeaders.Authorization = `Bearer ${token}`
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
    // v9-audit-fix: global 401 handler — if an authenticated request returns
    // 401, trigger the unauthorized callback (registered by auth store) to
    // logout and redirect to login. Prevents "stuck UI" where user appears
    // logged in but every request silently fails.
    if (res.status === 401 && auth && unauthorizedHandler) {
      unauthorizedHandler()
    }
    const message =
      (isJson && payload && (payload.error || payload.message)) ||
      (typeof payload === 'string' && payload.length > 200 ? payload.slice(0, 200) + '…' : (typeof payload === 'string' ? payload : '')) ||
      `HTTP ${res.status}`
    throw new ApiError(message, res.status, isJson ? payload : undefined)
  }

  return payload as T
}

// Convenience helpers
export const api = {
  get: <T = unknown>(path: string, opts: RequestOptions = {}) =>
    apiFetch<T>(path, { ...opts, method: 'GET' }),
  post: <T = unknown>(path: string, opts: RequestOptions = {}) =>
    apiFetch<T>(path, { ...opts, method: 'POST' }),
  patch: <T = unknown>(path: string, opts: RequestOptions = {}) =>
    apiFetch<T>(path, { ...opts, method: 'PATCH' }),
  put: <T = unknown>(path: string, opts: RequestOptions = {}) =>
    apiFetch<T>(path, { ...opts, method: 'PUT' }),
  delete: <T = unknown>(path: string, opts: RequestOptions = {}) =>
    apiFetch<T>(path, { ...opts, method: 'DELETE' }),
}
