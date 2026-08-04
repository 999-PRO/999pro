'use client'

import { useEffect, useRef, useCallback } from 'react'
import { create } from 'zustand'
import { useSocket } from '@/lib/use-socket'
import { useCall } from '@/lib/use-call'
import { useAuthStore } from '@/lib/auth-store'
import { useRingtone } from '@/lib/use-ringtone'
import { toast } from '@/lib/notifications'
import { formatDuration } from '@/lib/format'
import { CallScreen } from './call-screen'
import type { CallState } from '@/lib/types'

// ============================================================================
// Global call store — single source of truth for the active call.
// Any view (chat, catalog, feed, profile) can read/write this. The CallManager
// component subscribes to it and renders the CallScreen overlay on top of
// everything when a call is active.
// ============================================================================

interface CallStore {
  call: CallState | null
  setCall: (c: CallState | null) => void
  patchCall: (patch: Partial<CallState>) => void
  // Refs that survive re-renders — set by the active call's WebRTC hook
  peerIdRef: { current: string | null }
  typeRef: { current: 'audio' | 'video' }
  directionRef: { current: 'incoming' | 'outgoing' }
  // PIP (picture-in-picture) mode — when true, the call screen shrinks to a
  // small floating card so the user can browse the app while on a call.
  isPip: boolean
  setPip: (v: boolean) => void
}

export const useCallStore = create<CallStore>((set) => ({
  call: null,
  setCall: (c) => set({ call: c, isPip: false }),
  patchCall: (patch) => set((s) => (s.call ? { call: { ...s.call, ...patch } } : s)),
  peerIdRef: { current: null },
  typeRef: { current: 'audio' },
  directionRef: { current: 'outgoing' },
  isPip: false,
  setPip: (v) => set({ isPip: v }),
}))

// ============================================================================
// Helper: start an outgoing call from anywhere in the app.
// Usage:  startOutgoingCall(conversation, 'video')
// ============================================================================
export function startOutgoingCall(
  // v13.2: widened the participant type to include the fields we actually
  // read (username/displayName/avatar). Previously the type only declared
  // { id: string }, so callers had to cast with `as any` — now the type
  // matches the real Conversation.participant shape.
  conversation: {
    id: string
    participant?: {
      id: string
      username?: string
      displayName?: string | null
      avatar?: string | null
    } | null
  },
  type: 'audio' | 'video',
) {
  if (!conversation?.participant) return
  const store = useCallStore.getState()
  if (store.call) {
    toast.info('У вас уже есть активный звонок')
    return
  }
  store.peerIdRef.current = conversation.participant.id
  store.typeRef.current = type
  store.directionRef.current = 'outgoing'
  store.setCall({
    callId: '', // will be filled by call:started event from server
    conversationId: conversation.id,
    type,
    peer: {
      id: conversation.participant.id,
      // v13.2 (audit P1-8 fix): removed `as any` casts — the Conversation
      // type already includes username/displayName/avatar on participant.
      username: conversation.participant.username || '',
      displayName: conversation.participant.displayName ?? null,
      avatar: conversation.participant.avatar ?? null,
    },
    status: 'ringing',
    direction: 'outgoing',
  })
  // Trigger socket emit through the CallManager's socket hook
  window.dispatchEvent(
    new CustomEvent('call:start-outgoing', {
      detail: { conversationId: conversation.id, recipientId: conversation.participant.id, type },
    }),
  )
}

// ============================================================================
// CallManager — mounts globally (in app-shell), listens for call events on
// the shared socket, manages the WebRTC peer connection, and renders the
// CallScreen overlay when a call is active. This means incoming calls are
// received no matter which view the user is on (home, catalog, feed, etc.).
// ============================================================================

export function CallManager() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const authed = isAuthenticated || (!!token && !!user)

  const call = useCallStore((s) => s.call)
  const setCall = useCallStore((s) => s.setCall)
  const patchCall = useCallStore((s) => s.patchCall)
  const peerIdRef = useCallStore((s) => s.peerIdRef)
  const typeRef = useCallStore((s) => s.typeRef)
  const directionRef = useCallStore((s) => s.directionRef)
  const isPip = useCallStore((s) => s.isPip)
  const setPip = useCallStore((s) => s.setPip)

  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)

  // Ringtone — plays for incoming calls until the user accepts/rejects.
  // Synthesized via Web Audio API (no external audio files needed).
  const ringtone = useRingtone()

  // Start ringtone when an incoming call is ringing; stop when accepted/rejected/ended.
  // ALSO play ringtone for OUTGOING calls (ringing/connecting) — the caller
  // should hear a "calling" sound while waiting for the recipient to answer.
  useEffect(() => {
    if (!call) {
      ringtone.stop()
      return
    }
    // Incoming call ringing → loud ringtone (recipient hears phone ring)
    if (call.direction === 'incoming' && call.status === 'ringing') {
      ringtone.start('incoming')
      return
    }
    // Outgoing call ringing/connecting → quiet dial tone (caller hears "calling" sound)
    if (call.direction === 'outgoing' && (call.status === 'ringing' || call.status === 'connecting')) {
      ringtone.start('outgoing')
      return
    }
    // Connected or ended → stop ringtone
    ringtone.stop()
    return () => ringtone.stop()
  }, [call?.direction, call?.status, ringtone])

  // Socket-level call API (uses the shared singleton socket)
  const {
    startCall, acceptCall, rejectCall, endCall, cancelCall, sendCallSignal,
  } = useSocket({
    enabled: authed,
    onCallIncoming: (payload) => {
      if (useCallStore.getState().call) {
        rejectCall(payload.callId)
        return
      }
      peerIdRef.current = payload.caller.id
      typeRef.current = payload.type
      directionRef.current = 'incoming'
      setCall({
        callId: payload.callId,
        conversationId: payload.conversationId,
        type: payload.type,
        peer: payload.caller,
        status: 'ringing',
        direction: 'incoming',
      })
      // Browser notification for incoming call.
      //
      // FIX (was): used `new Notification(...)` directly on the page. iOS
      // Safari silently ignores page-side Notifications (only SW-displayed
      // notifications work on iOS 16.4+), and on Android Chrome page-side
      // Notifications are unreliable when the tab is backgrounded/throttled.
      //
      // Now: prefer SW postMessage (which calls `registration.showNotification`
      // inside the SW — works in all of: foreground, background, iOS PWA,
      // Android PWA). Fall back to page-side Notification ONLY if the SW
      // is not yet active (e.g. cold launch before SW registration completes).
      const callTitle = `Входящий ${payload.type === 'video' ? 'видеозвонок' : 'аудиозвонок'}`
      const callBody = `От ${payload.caller?.displayName || payload.caller?.username || 'пользователя'}`
      const notifData = { url: '/', conversationId: payload.conversationId, callId: payload.callId }

      let swDelivered = false
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: callTitle,
            body: callBody,
            icon: '/icons/icon-192.png',
            tag: `call-${payload.callId}`,
            data: notifData,
          })
          swDelivered = true
        } catch {
          // SW postMessage failed — fall back below
        }
      }
      if (!swDelivered && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification(callTitle, {
            body: callBody,
            icon: '/icons/icon-192.png',
            tag: `call-${payload.callId}`,
            data: notifData,
            requireInteraction: true,
          })
          n.onclick = () => {
            window.focus()
            n.close()
          }
        } catch {}
      }
      // Vibrate on mobile (best-effort)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { (navigator as any).vibrate([400, 200, 400, 200, 400]) } catch {}
      }
    },
    onCallStarted: (payload) => {
      // Outgoing call registered on server — we now have the real callId
      patchCall({ callId: payload.callId })
    },
    onCallAccepted: (payload) => {
      patchCall({ status: 'connecting' })
      // Caller initiates the WebRTC offer now that the recipient accepted
      if (directionRef.current === 'outgoing' && peerIdRef.current) {
        webrtc.initiateCall(payload.callId, peerIdRef.current, typeRef.current).then(() => {
          patchCall({ status: 'connected', startedAt: Date.now() })
        }).catch((e: any) => {
          // Same error handling as handleAccept — distinguish permission
          // denied from other failures.
          const errName = e?.name || ''
          let msg = 'Не удалось установить соединение'
          if (errName === 'NotAllowedError' || errName === 'SecurityError') {
            msg = 'Доступ к камере/микрофону запрещён. Разрешите доступ в настройках браузера.'
          } else if (errName === 'NotFoundError') {
            msg = 'Камера/микрофон не найдены.'
          } else if (errName === 'NotReadableError') {
            msg = 'Камера/микрофон заняты другим приложением.'
          } else if (e?.message) {
            msg = 'Не удалось установить соединение: ' + e.message
          }
          toast.error(msg)
          endCall(payload.callId, 'webrtc-failed')
          setCall(null)
        })
      }
    },
    onCallRejected: (payload) => {
      if (call?.callId === payload.callId) {
        webrtc.hangup()
        setCall(null)
        toast.info('Звонок отклонён')
      }
    },
    onCallEnded: (payload) => {
      if (call?.callId === payload.callId) {
        webrtc.hangup()
        setCall(null)
        // v25.4 (calls audit GAP-4): differentiate the end reason so the user
        // gets meaningful feedback for missed/cancelled/disconnected calls
        // instead of a generic "Звонок завершён" for everything.
        const reason = payload.reason
        if (reason === 'missed') {
          toast.error('Пропущенный звонок')
        } else if (reason === 'cancelled') {
          toast.info('Звонок отменён')
        } else if (reason === 'peer-disconnected') {
          toast.error('Собеседник недоступен')
        } else if (reason === 'webrtc-failed') {
          toast.error('Не удалось установить соединение')
        } else if (reason === 'media-error') {
          toast.error('Ошибка доступа к камере/микрофону')
        } else if (payload.duration) {
          toast.info(`Звонок завершён · ${formatDuration(payload.duration)}`)
        } else {
          toast.info('Звонок завершён')
        }
      }
    },
    onCallCancelled: (payload) => {
      if (call?.callId === payload.callId) {
        webrtc.hangup()
        setCall(null)
        toast.info('Звонок отменён')
      }
    },
    onCallSignal: (payload) => {
      webrtc.handleSignal(payload.from, payload.data)
    },
  })

  const webrtc = useCall(
    {
      startCall, acceptCall, rejectCall, endCall, cancelCall, sendCallSignal,
    },
    {
      localVideoRef, remoteVideoRef,
      onIceConnectionStateChange: (state) => {
        // Auto-restart ICE on 'failed' — recovers from network changes
        // (WiFi → cellular, NAT rebinding) without dropping the call.
        // Only the caller initiates the restart to avoid both sides
        // restarting simultaneously (which would conflict).
        if (state === 'failed' && directionRef.current === 'outgoing') {
          toast.info('Плохое соединение, переподключение…')
          webrtc.restartIce().catch(() => {})
        }
      },
    },
  )

  // F-HIGH-002: extract stable method refs from the (per-render) `webrtc`
  // object so the useCallback deps below stay stable across renders. The
  // underlying methods (`acceptIncomingCall`, `hangup`) are themselves
  // useCallback'd inside use-call.ts, so their identity only changes when
  // their internal deps change — which won't happen mid-call.
  const webrtcAcceptIncomingCall = webrtc.acceptIncomingCall
  const webrtcHangup = webrtc.hangup

  // Listen for startOutgoingCall() events from other views
  useEffect(() => {
    const onStartOutgoing = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        conversationId: string
        recipientId: string
        type: 'audio' | 'video'
      }
      startCall(detail.conversationId, detail.recipientId, detail.type)
    }
    window.addEventListener('call:start-outgoing', onStartOutgoing as EventListener)
    return () => window.removeEventListener('call:start-outgoing', onStartOutgoing as EventListener)
  }, [startCall])

  // F-HIGH-002: handleAccept / handleReject are declared as useCallbacks
  // BEFORE the useEffect that consumes them (below). They used to be declared
  // AFTER, which caused (a) a TDZ ESLint error ("cannot access before
  // declaration") and (b) a stale-closure bug — the effect captured the
  // first-render versions and never updated. Now both handlers live above
  // the effect and are listed in its dep array, so the listeners re-bind
  // whenever they change.
  //
  // Deps are derived from the actual values read inside the body:
  //   - `call` may change (new incoming call, status updates).
  //   - `acceptCall` / `rejectCall` / `endCall` / `patchCall` / `setCall` are
  //     stable store actions (created once by Zustand's `create`).
  //   - `peerIdRef` is a stable ref object.
  //   - `webrtcAcceptIncomingCall` / `webrtcHangup` are stable method refs
  //     extracted above (they're useCallback'd inside use-call.ts).
  const handleAccept = useCallback(async () => {
    if (!call) return
    acceptCall(call.callId)
    patchCall({ status: 'connecting' })
    if (peerIdRef.current) {
      try {
        await webrtcAcceptIncomingCall(call.callId, peerIdRef.current, call.type)
        patchCall({ status: 'connected', startedAt: Date.now() })
      } catch (e: any) {
        // Distinguish between permission denied (user blocked camera/mic)
        // and other errors (device not found, HTTPS required, etc.)
        const errName = e?.name || ''
        let msg = 'Не удалось получить доступ к камере/микрофону'
        if (errName === 'NotAllowedError' || errName === 'SecurityError') {
          msg = 'Доступ к камере/микрофону запрещён. Разрешите доступ в настройках браузера.'
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          msg = 'Камера/микрофон не найдены. Проверьте подключение устройств.'
        } else if (errName === 'NotReadableError') {
          msg = 'Камера/микрофон заняты другим приложением. Закройте другие программы и попробуйте снова.'
        } else if (e?.message?.includes('HTTPS') || e?.message?.includes('mediaDevices')) {
          msg = 'Звонки требуют HTTPS. Откройте приложение по защищённому соединению.'
        }
        toast.error(msg)
        endCall(call.callId, 'media-error')
        setCall(null)
      }
    }
  }, [call, acceptCall, patchCall, peerIdRef, webrtcAcceptIncomingCall, endCall, setCall])

  const handleReject = useCallback(() => {
    if (!call) return
    rejectCall(call.callId)
    webrtcHangup()
    setCall(null)
  }, [call, rejectCall, webrtcHangup, setCall])

  // Listen for Answer/Decline from push notification action buttons.
  // When the user taps "Ответить" / "Отклонить" on a call push notif,
  // the SW posts CALL_ANSWER / CALL_DECLINE → providers.tsx re-dispatches
  // as `call:answer-from-notification` / `call:decline-from-notification`.
  // Here we accept/reject the call referenced by callId in the detail.
  useEffect(() => {
    const onAnswerFromNotif = (e: Event) => {
      const detail = (e as CustomEvent).detail as { callId?: string; conversationId?: string }
      // Only handle if there's an active incoming call with matching id.
      // Use explicit null guard so TypeScript narrows `call` to non-null
      // before accessing `call.direction`.
      if (call && call.callId === detail.callId && call.direction === 'incoming') {
        void handleAccept()
      } else if (detail.callId) {
        // Call doesn't exist locally yet (push arrived before socket event).
        // Emit call:reject via socket — backend will mark as rejected.
        rejectCall(detail.callId)
      }
    }
    const onDeclineFromNotif = (e: Event) => {
      const detail = (e as CustomEvent).detail as { callId?: string; conversationId?: string }
      if (call && call.callId === detail.callId) {
        void handleReject()
      } else if (detail.callId) {
        // No local call state — just reject via socket.
        rejectCall(detail.callId)
      }
    }
    window.addEventListener('call:answer-from-notification', onAnswerFromNotif as EventListener)
    window.addEventListener('call:decline-from-notification', onDeclineFromNotif as EventListener)
    return () => {
      window.removeEventListener('call:answer-from-notification', onAnswerFromNotif as EventListener)
      window.removeEventListener('call:decline-from-notification', onDeclineFromNotif as EventListener)
    }
  }, [call, handleAccept, handleReject, rejectCall])

  const handleEnd = () => {
    if (!call) return
    // v25.4 (calls audit GAP-5): if the caller hangs up while the call is
    // still ringing (not yet accepted), send `call:cancel` instead of
    // `call:end` so the recipient sees "Звонок отменён" and the Call record
    // gets status `cancelled` (not `ended` with null duration).
    if (call.status === 'ringing' && call.direction === 'outgoing') {
      cancelCall(call.callId)
    } else {
      endCall(call.callId, 'user-ended')
    }
    webrtc.hangup()
    setCall(null)
  }

  const handleCancel = () => {
    if (!call) return
    cancelCall(call.callId)
    webrtc.hangup()
    setCall(null)
  }

  if (!call) return null

  return (
    <CallScreen
      call={call}
      localVideoRef={localVideoRef}
      remoteVideoRef={remoteVideoRef}
      iceState={webrtc.iceState}
      isPip={isPip}
      isScreenSharing={webrtc.isScreenSharing}
      onMinimize={() => setPip(true)}
      onExpand={() => setPip(false)}
      onAccept={handleAccept}
      onReject={handleReject}
      onEnd={handleEnd}
      onToggleMic={webrtc.toggleMic}
      onToggleCamera={webrtc.toggleCamera}
      onSwitchCamera={webrtc.switchCamera}
      onToggleSpeaker={webrtc.toggleSpeaker}
      onToggleScreenShare={() => {
        // v25.4 (calls audit GAP-1): toggle screen share
        if (webrtc.isScreenSharing) {
          void webrtc.stopScreenShare()
        } else {
          void webrtc.startScreenShare()
        }
      }}
    />
  )
}
