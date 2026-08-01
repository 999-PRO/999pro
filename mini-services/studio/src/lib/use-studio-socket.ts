'use client'

import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '@/lib/auth-store'

// Phase 20: inline socket URL logic (same as api.ts but avoids import cycle
// issues with Turbopack hot-reload during development).
const SANDBOX_BACKEND_PORT = 4000

// v25.2-CORS-FIX: same logic as api.ts — browser ALWAYS uses relative URL
// so the WebSocket connects to the same origin (no CORS). Next.js rewrites()
// in next.config.ts proxies /socket.io/* to the backend server-side.
// Only sandbox (*.space-z.ai) needs the XTransformPort query param.
//
// IMPORTANT: Studio has basePath: '/studio'. The socket.io path must be
// '/studio/socket.io/' so Next.js rewrites match it.
function getSocketUrl(): { url: string; query: Record<string, string> } {
  if (typeof window === 'undefined') {
    // Server-side: connect directly to backend (no CORS for server-to-server).
    return { url: 'http://localhost:4000', query: {} }
  }
  const pageHost = window.location.hostname
  const isSandboxHost = pageHost === 'space-z.ai' || pageHost.endsWith('.space-z.ai')

  if (isSandboxHost) {
    // Sandbox/preview gateway: connect via the same origin and let the
    // gateway route to the backend port via XTransformPort query.
    return { url: '/', query: { XTransformPort: String(SANDBOX_BACKEND_PORT) } }
  }

  // All other cases (localhost, LAN IP, public IP, domain): relative URL.
  // Use '/studio/' as the socket URL so the path becomes /studio/socket.io/
  // which matches the Next.js rewrite (auto-prefixed with basePath).
  return { url: '/studio/', query: {} }
}

type EventType = 'lead:status-changed' | 'lead:deleted' | 'leads:bulk-deleted' | 'order:status-changed'

// v13.1 (audit P1-3 fix): removed the unused `channel` parameter. It was
// documented as filtering events by channel name but the implementation
// subscribed to a hardcoded list of 4 events regardless of channel. Calling
// useStudioSocket('leads', cb) and useStudioSocket('orders', cb) received
// the same events — misleading API. Now the parameter is gone; callers
// just pass the callback.
export function useStudioSocket(onEvent?: (type: EventType, data: unknown) => void) {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const token = useAuthStore((s) => s.token)

  // v8-audit-fix: store onEvent in a ref so the socket doesn't reconnect
  // on every parent re-render (which happens when filter/search changes).
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!token) return

    const { url, query } = getSocketUrl()
    const socket = io(url, {
      path: '/socket.io/',
      // v13.1: only add XTransformPort when actually needed (sandbox mode).
      // Previously it was always injected even on localhost/LAN, polluting
      // the query string and confusing future debugging.
      query,
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    socket.on('connect_error', () => {
      setConnected(false)
    })

    // Listen for real-time events — use ref so callback is always current
    const events: EventType[] = ['lead:status-changed', 'lead:deleted', 'leads:bulk-deleted', 'order:status-changed']
    events.forEach((evt) => {
      socket.on(evt, (data: unknown) => {
        onEventRef.current?.(evt, data)
      })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [token]) // v8-audit-fix: onEvent removed from deps (stored in ref)

  return { connected }
}
