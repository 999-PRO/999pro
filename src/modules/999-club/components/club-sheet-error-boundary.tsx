'use client'

/**
 * ClubSheetErrorBoundary — isolates sheet rendering errors so a crash
 * in one sheet (e.g. malformed data) doesn't take down the whole page.
 *
 * If a sheet throws, this boundary shows a friendly error message with
 * a "close" button instead of a white screen.
 */

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onClose: () => void
}

interface State {
  hasError: boolean
  error?: Error
}

export class ClubSheetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[CLUB Sheet Error]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }} onClick={this.props.onClose}>
          <div className="w-full md:max-w-md rounded-t-[32px] md:rounded-[32px] glass-strong border border-border/40 p-8 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-3">😵</div>
            <h3 className="font-bold text-lg mb-1">Что-то пошло не так</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Раздел временно недоступен. Попробуйте позже.
            </p>
            <button
              onClick={this.props.onClose}
              className="px-6 py-2.5 rounded-full gradient-brand text-white font-semibold text-sm shadow-glow"
            >
              Закрыть
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
