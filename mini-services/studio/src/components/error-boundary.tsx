'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * StudioErrorBoundary — catches render errors in Studio managers.
 *
 * Phase 31: Without this, any render error in a Studio manager (e.g.
 * undefined product.images[0]) crashes the entire admin panel with a
 * white screen. This boundary catches the error and shows a recovery
 * UI with a "reload" button instead.
 */
export class StudioErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[Studio Error]', error, errorInfo)
    }
    // Wave 3 (S-BUG-009): report errors to backend even in production so
    // the team has visibility into Studio crashes. Previously errors were
    // silently swallowed in prod. Fire-and-forget — don't block recovery.
    //
    // v13.0 (audit P0-3 fix): the previous version used `fetch('/api/...')`
    // with `credentials: 'include'`. Two bugs:
    //   1. URL was wrong: Next.js basePath `/studio` means the rewrite
    //      only matches `/studio/api/*`, not `/api/*`. The request 404'd.
    //   2. `credentials: 'include'` only sends cookies, but Studio stores
    //      JWT in localStorage — so even if the URL resolved, the backend
    //      received no Authorization header and rejected with 401.
    // Fixed by reading the token from localStorage and sending as Bearer.
    if (typeof window !== 'undefined') {
      try {
        const payload = {
          name: error.name,
          message: error.message,
          stack: error.stack?.slice(0, 4000),
          componentStack: errorInfo.componentStack?.slice(0, 4000),
          url: window.location.href,
          view: window.location.hash || window.location.search,
          ts: new Date().toISOString(),
          userAgent: navigator.userAgent,
        }
        // Read JWT directly from localStorage to avoid importing the api
        // module (circular dependency risk if api.ts itself crashed).
        let token: string | null = null
        try {
          const raw = localStorage.getItem('999pro-studio-auth')
          if (raw) {
            const parsed = JSON.parse(raw)
            token = parsed?.state?.token ?? null
          }
        } catch {
          /* localStorage may be unavailable */
        }
        // Build URL: in sandbox/preview, append ?XTransformPort=4000 so the
        // public gateway routes to the backend port. Locally, point directly.
        const isLocal =
          window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        const isPrivateLan = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(
          window.location.hostname,
        )
        const url = isLocal
          ? 'http://localhost:4000/api/audit/client-error'
          : isPrivateLan
            ? `http://${window.location.hostname}:4000/api/audit/client-error`
            : '/api/audit/client-error?XTransformPort=4000'
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers.Authorization = `Bearer ${token}`
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        }).catch(() => {
          /* swallow — don't compound the error */
        })
      } catch {
        /* swallow — error reporting must never throw */
      }
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center py-20 px-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4 bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-bold mb-2">Ошибка загрузки</h2>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
            Не удалось загрузить этот раздел. Попробуйте обновить страницу.
          </p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="text-xs text-left bg-muted p-3 rounded-lg mb-4 overflow-auto max-h-32 font-mono w-full max-w-md">
              <span className="text-destructive font-bold">{this.state.error.name}: </span>
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.handleRetry}
              className="rounded-full gradient-brand text-white font-semibold h-10 px-5 text-sm"
            >
              <RefreshCw className="h-4 w-4 mr-1.5 inline" />
              Повторить
            </button>
            <button
              onClick={this.handleReload}
              className="rounded-full glass hover:bg-accent transition-colors h-10 px-5 text-sm font-medium"
            >
              Перезагрузить
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
