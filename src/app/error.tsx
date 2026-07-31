'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw, MessageCircle } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Phase 30: only log errors in development — production console
    // can leak internal paths and stack traces to anyone with DevTools.
    if (process.env.NODE_ENV === 'development') {
      console.error('[App Error]', error)
    }
  }, [error])

  const isDev = process.env.NODE_ENV === 'development'

  const handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  const handleSupport = () => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('view', 'support')
      window.history.pushState({}, '', url.toString())
      window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'support' } }))
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 bg-background"
      role="alert"
      aria-live="assertive"
    >
      <div className="text-center max-w-md">
        <div
          className="h-20 w-20 rounded-3xl grid place-items-center mx-auto mb-4"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.20)',
          }}
        >
          <AlertTriangle className="h-10 w-10 text-destructive" strokeWidth={1.5} />
        </div>
        <h2 className="text-2xl font-bold mb-2">Что-то пошло не так</h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Произошла ошибка при загрузке страницы. Попробуйте обновить — если
          ошибка повторяется, перезагрузите приложение или обратитесь в поддержку.
        </p>

        {isDev && (
          <pre className="text-xs text-left bg-muted p-3 rounded-lg mb-4 overflow-auto max-h-40 font-mono">
            <span className="text-destructive font-bold">{error.name}: </span>
            {error.message}
            {error.digest && (
              <div className="mt-2 text-muted-foreground">digest: {error.digest}</div>
            )}
            {error.stack && (
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground">Stack trace</summary>
                <div className="mt-1 whitespace-pre-wrap">{error.stack}</div>
              </details>
            )}
          </pre>
        )}

        {!isDev && error.digest && (
          <p className="text-xs text-muted-foreground mb-4 font-mono">
            Код ошибки: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button
            onClick={reset}
            className="rounded-full gradient-brand text-white font-semibold shadow-glow h-11 px-6"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Попробовать снова
          </Button>
          {/* Phase 30: added full page reload button — reset() only retries
              the error boundary, but a full reload clears stale state. */}
          <Button
            onClick={handleReload}
            variant="outline"
            className="rounded-full h-11 px-6"
          >
            Перезагрузить
          </Button>
          <Button
            onClick={handleSupport}
            variant="outline"
            className="rounded-full h-11 px-6"
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            Поддержка
          </Button>
        </div>
      </div>
    </div>
  )
}
