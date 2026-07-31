'use client'

import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '@/lib/auth-store'

// Phase 20: inline socket URL logic (same as api.ts but avoids import cycle
// issues with Turbopack hot-reload during development).
const SANDBOX_BACKEND_PORT = 4000

// v13.1 (audit P1-4 fix): handle private-IP LAN hosts (192.168.x.x, 10.x.x.x,
// 172.16-31.x.x, 169.254.x.x) and .local mDNS — same logic as api.ts.
// Previously only localhost/127.0.0.1 were detected. If an admin opened the
// studio from a phone at http://192.168.1.10:3001/studio, the socket tried
// to connect to http://localhost:4000 ON THE PHONE — which doesn't exist.
function getSocketUrl(): { url: string; query: Record<string, string> } {
  if (typeof window === 'undefined') {
    return { url: 'http://localhost:4000', query: {} }
  }
  const pageHost = window.location.hostname
  const isSandboxHost = pageHost === 'space-z.ai' || pageHost.endsWith('.space-z.ai')
  const isLocal = pageHost === 'localhost' || pageHost === '127.0.0.1'
  const isPrivateLan =
    /^192\.168\./.test(pageHost) ||
    /^10\./.test(pageHost) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(pageHost) ||
    /^169\.254\./.test(pageHost)
  const isMdns = pageHost.endsWith('.local')

  if (isSandboxHost && !isLocal) {
    // Sandbox/preview gateway: connect via the same origin and let the
    // gateway route to the backend port via XTransformPort query.
    return { url: '/', query: { XTransformPort: String(SANDBOX_BACKEND_PORT) } }
  }
  if (isLocal) {
    return { url: 'http://localhost:4000', query: {} }
  }
  if (isPrivateLan || isMdns) {
    // v13.1: LAN/mobile dev — connect to the same host as the page but on
    // port 4000. This lets admins test the studio from their phone.
    return { url: `http://${pageHost}:4000`, query: {} }
  }
  // Fallback: assume same host with explicit backend port.
  return { url: `http://${pageHost}:4000`, query: {} }
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
