'use client'
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}
interface State {
  hasError: boolean
  error: Error | null
}

/**
 * F-HIGH-008 fix: Per-view ErrorBoundary with retry button.
 * When a lazy-loaded chunk fails to load (network drop, deploy between
 * page-load and chunk-fetch, ad-blocker), this boundary catches the error
 * and shows a "Retry" button that re-imports the chunk. Without this,
 * the entire app crashes to the root error.tsx — losing in-memory state
 * (chat drafts, scroll position, optimistic messages).
 */
export class RetryableErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleRetry = () => {
    // Clear error state — React will re-render children, which re-attempts
    // the dynamic import. If the network is back, the chunk loads.
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Не удалось загрузить раздел</p>
            <p className="text-xs text-muted-foreground/70 mb-4">
              {this.state.error?.message || 'Сеть недоступна'}
            </p>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Повторить
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
