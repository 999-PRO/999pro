'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { CallState } from '@/lib/types'

// v13.3 (audit P1-21 fix): use a WeakMap to associate metadata with
// RTCPeerConnection instances instead of polluting the object via
// `(pc as any)._meta`. WeakMap is GC-friendly (entries are collected
// when the pc is garbage-collected), doesn't require `as any` casts,
// and won't conflict with future WebRTC type changes.
const pcMeta = new WeakMap<RTCPeerConnection, { callId: string; peerId: string }>()

interface UseCallOptions {
  onCallIncoming?: (payload: any) => void
  onCallAccepted?: (payload: { callId: string }) => void
  onCallRejected?: (payload: { callId: string }) => void
  onCallEnded?: (payload: { callId: string; reason?: string; duration?: number }) => void
  onCallCancelled?: (payload: { callId: string }) => void
  onCallSignal?: (payload: { callId: string; from: string; data: any }) => void
}

interface UseCallApi extends UseCallOptions {
  startCall: (conversationId: string, recipientId: string, type: 'audio' | 'video') => void
  acceptCall: (callId: string) => void
  rejectCall: (callId: string) => void
  endCall: (callId: string, reason?: string) => void
  cancelCall: (callId: string) => void
  sendCallSignal: (callId: string, to: string, data: any) => void
}

export interface UseCallHookOptions {
  localVideoRef: React.RefObject<HTMLVideoElement | null>
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>
  onLocalStreamReady?: (stream: MediaStream) => void
  onRemoteStreamReady?: (stream: MediaStream) => void
  onIceConnectionStateChange?: (state: RTCIceConnectionState) => void
}

// ============================================================================
// ICE server configuration — fetched once from /api/calls/ice-servers.
// Returns STUN + (optional) TURN servers. TURN is required for calls
// behind strict NAT (symmetric NAT, carrier-grade NAT, corporate firewalls).
// Without TURN, ~30% of calls between mobile users fail to connect.
//
// We cache the result in a module-level promise so all RTCPeerConnection
// instances in the app share it. Refreshed every 5 minutes (the endpoint
// also returns Cache-Control: max-age=300, but we add a JS-side TTL for
// when the SW serves a stale response).
// ============================================================================

interface IceServersResponse {
  iceServers: Array<{ urls: string; username?: string; credential?: string }>
  ttl: number
}

let iceServersPromise: Promise<IceServersResponse> | null = null
let iceServersExpiry = 0

async function getIceServers(): Promise<IceServersResponse> {
  const now = Date.now()
  if (iceServersPromise && now < iceServersExpiry) {
    return iceServersPromise
  }
  iceServersPromise = api
    .get<IceServersResponse>('/api/calls/ice-servers')
    .then((data) => {
      iceServersExpiry = now + (data.ttl || 300) * 1000
      return data
    })
    .catch(() => {
      // Fallback to Google STUN only (no TURN — calls behind NAT will fail)
      return {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ],
        ttl: 60,
      }
    })
  return iceServersPromise
}

/**
 * WebRTC peer connection manager for 999 — Три девятки audio/video calls.
 *
 * Lifecycle:
 *  1. Caller emits `call:start` via socket → server creates Call record and
 *     notifies recipient with `call:incoming`.
 *  2. Recipient accepts → server emits `call:accepted` to caller.
 *  3. Caller creates RTCPeerConnection, getUserMedia, creates offer, sends
 *     via `call:signal` → recipient receives, creates answer, sends back.
 *  4. ICE candidates exchanged via `call:signal`.
 *  5. On `call:end` / `call:rejected` / disconnect: close peer connection,
 *     stop media tracks.
 *
 * Socket.IO is used ONLY for signaling. Audio/video flows P2P.
 *
 * TURN support: ICE servers are fetched from /api/calls/ice-servers which
 * returns STUN + TURN (if configured). Without TURN, calls between peers
 * behind symmetric NAT fail — this affects ~30% of mobile-to-mobile calls.
 *
 * Stability note: `options` is captured via a ref that is updated on every
 * render. This means the ref's identity is stable across renders, so all
 * memoized callbacks below can safely use `[]` deps. Without this pattern,
 * `options` would be a new object literal on every render of CallManager,
 * and `useCallback(..., [options])` would invalidate every callback —
 * including `hangup`, whose cleanup effect `useEffect(() => () => hangup(),
 * [hangup])` would then re-run on every render and tear down the call.
 */
export function useCall(socketApi: UseCallApi, options: UseCallHookOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([])
  // v25.4 (calls audit GAP-6): buffer early signals that arrive before the
  // RTCPeerConnection is ready (race condition: caller's offer reaches
  // recipient before `pcRef.current = pc` runs in `acceptIncomingCall`).
  // Without this buffer, the offer is silently dropped and the call hangs in
  // "connecting" forever. The buffer is drained at the end of
  // `acceptIncomingCall` and `initiateCall` by replaying each entry.
  const pendingSignalsRef = useRef<Array<{ from: string; data: any }>>([])
  const [iceState, setIceState] = useState<RTCIceConnectionState>('new')
  // v25.4 (calls audit GAP-1): screen-share state. When active, the original
  // camera video track is stored here so it can be restored when screen share
  // is stopped.
  const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null)
  const [isScreenSharing, setIsScreenSharing] = useState(false)

  // Keep a stable ref to options so callbacks can use empty dep arrays.
  // The ref's `.current` is updated synchronously on every render — this
  // is safe because the callbacks only read it inside event handlers /
  // async work, never during render.
  const optionsRef = useRef(options)
  optionsRef.current = options
  const socketApiRef = useRef(socketApi)
  socketApiRef.current = socketApi

  // Build the RTCPeerConnection with ICE servers from the backend.
  // Now includes TURN servers (when configured) — fixes the "calls behind
  // strict NAT fail" issue that affected ~30% of mobile-to-mobile calls.
  const createPeerConnection = useCallback(async (): Promise<RTCPeerConnection> => {
    const opts = optionsRef.current
    const api = socketApiRef.current
    const { iceServers } = await getIceServers()
    const config: RTCConfiguration = {
      iceServers,
      // Prefer UDP for low latency; fall back to TCP/TLS if blocked.
      iceTransportPolicy: 'all',
      // Bundle media on a single ICE transport (more efficient, fewer ports).
      bundlePolicy: 'max-bundle',
      // Use the full ICE candidate pool (helps with NAT traversal).
      iceCandidatePoolSize: 4,
    }
    const pc = new RTCPeerConnection(config)

    // Wire up remote stream
    pc.ontrack = (event) => {
      const [stream] = event.streams
      remoteStreamRef.current = stream
      if (opts.remoteVideoRef.current) {
        opts.remoteVideoRef.current.srcObject = stream
      }
      opts.onRemoteStreamReady?.(stream)
    }

    // ICE candidate → send to peer via socket signaling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const meta = pcMeta.get(pc)
        if (meta) {
          api.sendCallSignal(meta.callId, meta.peerId, {
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
          })
        }
      }
    }

    pc.oniceconnectionstatechange = () => {
      setIceState(pc.iceConnectionState)
      opts.onIceConnectionStateChange?.(pc.iceConnectionState)
    }

    return pc
  }, [])

  // Acquire local media (camera + mic, or mic only for audio calls)
  // FALLBACK STRATEGY: try with enhanced constraints first, fall back to
  // basic constraints, then to bare minimum. This handles:
  //   - Safari iOS (strict constraint rejection)
  //   - Older Android browsers (no noiseSuppression support)
  //   - Desktop without camera (video call → audio fallback)
  //   - Permission denied (re-thrown for UI to handle)
  const acquireLocalStream = useCallback(async (type: 'audio' | 'video'): Promise<MediaStream> => {
    const opts = optionsRef.current

    // Check if mediaDevices is available (requires HTTPS or localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('mediaDevices unavailable — requires HTTPS or localhost')
    }

    // Try 1: Enhanced constraints (echo cancellation + noise suppression)
    // Try 2: Basic audio constraints (just audio: true)
    // Try 3: Video with facingMode only (no resolution constraints)
    // Try 4: Video bare minimum (video: true)
    const attempts: MediaStreamConstraints[] = type === 'video'
      ? [
          // Video call — try with full constraints first
          {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          },
          // Fallback: simpler video constraints
          {
            audio: { echoCancellation: true },
            video: { facingMode: 'user' },
          },
          // Fallback: bare video
          {
            audio: true,
            video: true,
          },
        ]
      : [
          // Audio call — try with enhanced audio first
          {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false,
          },
          // Fallback: basic audio
          {
            audio: true,
            video: false,
          },
        ]

    let stream: MediaStream | null = null
    let lastError: unknown = null
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (e) {
        lastError = e
        // If permission denied, no point retrying
        if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
          throw e
        }
        // Otherwise try next set of constraints
      }
    }
    if (!stream) {
      throw lastError || new Error('Failed to acquire media stream')
    }

    localStreamRef.current = stream
    if (opts.localVideoRef.current && type === 'video') {
      opts.localVideoRef.current.srcObject = stream
    }
    opts.onLocalStreamReady?.(stream)
    return stream
  }, [])

  // v25.4 (calls audit GAP-6): Handle an incoming signaling message.
  // Defined BEFORE initiateCall/acceptIncomingCall so they can call
  // drainPendingSignals() at the end of their setup. Previously this was
  // declared after, causing "used before declaration" errors.
  const handleSignal = useCallback(
    async (from: string, data: any) => {
      const pc = pcRef.current
      // v25.4 (calls audit GAP-6): if the PC isn't ready yet (recipient is
      // still in `acceptIncomingCall` awaiting getUserMedia), buffer the
      // signal so it can be replayed once the PC is set up. Without this,
      // the caller's offer is silently dropped and the call hangs forever.
      if (!pc) {
        pendingSignalsRef.current.push({ from, data })
        return
      }

      if (data.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        for (const c of pendingCandidatesRef.current) {
          try { await pc.addIceCandidate(c) } catch {}
        }
        pendingCandidatesRef.current = []
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        const meta = pcMeta.get(pc)
        if (meta) {
          socketApiRef.current.sendCallSignal(meta.callId, meta.peerId, { type: 'answer', sdp: answer })
        }
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        for (const c of pendingCandidatesRef.current) {
          try { await pc.addIceCandidate(c) } catch {}
        }
        pendingCandidatesRef.current = []
      } else if (data.type === 'ice-candidate') {
        const candidate = new RTCIceCandidate(data.candidate)
        if (pc.remoteDescription) {
          try { await pc.addIceCandidate(candidate) } catch {}
        } else {
          pendingCandidatesRef.current.push(candidate)
        }
      }
    },
    [],
  )

  // v25.4 (calls audit GAP-6): drain any buffered signals that arrived before
  // the PC was ready. Called at the end of `acceptIncomingCall` and `initiateCall`.
  const drainPendingSignals = useCallback(async () => {
    const buffered = pendingSignalsRef.current
    pendingSignalsRef.current = []
    for (const { from, data } of buffered) {
      try {
        await handleSignal(from, data)
      } catch {
        // Best-effort — a failed signal shouldn't block the rest.
      }
    }
  }, [handleSignal])

  // Initiate a call as the CALLER (after the server confirmed call:started)
  const initiateCall = useCallback(
    async (callId: string, peerId: string, type: 'audio' | 'video') => {
      const pc = await createPeerConnection()
      pcMeta.set(pc, { callId, peerId })
      pcRef.current = pc

      const stream = await acquireLocalStream(type)

      // Use transceivers instead of offerToReceiveAudio/Video (deprecated).
      // Modern WebRTC API: addTransceiver with direction 'sendrecv' tells
      // the browser to both send and receive media of that kind.
      // This avoids "bad configuration parameters" errors on Safari iOS
      // and other browsers that rejected the legacy offerToReceive* options.
      pc.addTransceiver(stream.getAudioTracks()[0] || 'audio', {
        direction: 'sendrecv',
      })
      if (type === 'video') {
        const videoTrack = stream.getVideoTracks()[0]
        if (videoTrack) {
          pc.addTransceiver(videoTrack, { direction: 'sendrecv' })
        } else {
          // No video track (camera unavailable) — still receive remote video
          pc.addTransceiver('video', { direction: 'recvonly' })
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socketApiRef.current.sendCallSignal(callId, peerId, { type: 'offer', sdp: offer })
      // v25.4 (GAP-6): drain any signals that arrived while we were setting up.
      await drainPendingSignals()
    },
    [createPeerConnection, acquireLocalStream, drainPendingSignals],
  )

  // Accept an incoming call as the RECIPIENT (after sending call:accept)
  const acceptIncomingCall = useCallback(
    async (callId: string, peerId: string, type: 'audio' | 'video') => {
      const pc = await createPeerConnection()
      pcMeta.set(pc, { callId, peerId })
      pcRef.current = pc

      const stream = await acquireLocalStream(type)

      // Same transceiver approach as initiateCall — see comment there.
      pc.addTransceiver(stream.getAudioTracks()[0] || 'audio', {
        direction: 'sendrecv',
      })
      if (type === 'video') {
        const videoTrack = stream.getVideoTracks()[0]
        if (videoTrack) {
          pc.addTransceiver(videoTrack, { direction: 'sendrecv' })
        } else {
          pc.addTransceiver('video', { direction: 'recvonly' })
        }
      }
      // v25.4 (GAP-6): drain any signals that arrived while we were setting up
      // (the caller's offer often reaches us before getUserMedia finishes).
      await drainPendingSignals()
    },
    [createPeerConnection, acquireLocalStream, drainPendingSignals],
  )

  // Toggle camera on/off
  const toggleCamera = useCallback((enabled: boolean) => {
    const stream = localStreamRef.current
    if (!stream) return
    for (const track of stream.getVideoTracks()) {
      track.enabled = enabled
    }
  }, [])

  // Toggle microphone on/off
  const toggleMic = useCallback((enabled: boolean) => {
    const stream = localStreamRef.current
    if (!stream) return
    for (const track of stream.getAudioTracks()) {
      track.enabled = enabled
    }
  }, [])

  // Switch between front/back camera (mobile)
  const switchCamera = useCallback(async () => {
    const stream = localStreamRef.current
    if (!stream) return
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) return

    const devices = await navigator.mediaDevices.enumerateDevices()
    const videoInputs = devices.filter((d) => d.kind === 'videoinput')
    const currentLabel = videoTrack.label
    const other = videoInputs.find((d) => d.label !== currentLabel)
    if (!other) return

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: other.deviceId } },
      audio: false,
    })
    const newTrack = newStream.getVideoTracks()[0]
    if (!newTrack) return

    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video')
    if (sender) {
      await sender.replaceTrack(newTrack)
    }
    videoTrack.stop()
    stream.removeTrack(videoTrack)
    stream.addTrack(newTrack)
    if (optionsRef.current.localVideoRef.current) {
      optionsRef.current.localVideoRef.current.srcObject = stream
    }
  }, [])

  // Hang up — stop all tracks and close the peer connection.
  // Note: deps=[] is intentional — options/socketApi are read from refs.
  const hangup = useCallback(() => {
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop()
      localStreamRef.current = null
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current = null
    }
    if (pcRef.current) {
      try { pcRef.current.close() } catch {}
      pcRef.current = null
    }
    const opts = optionsRef.current
    if (opts.localVideoRef.current) {
      opts.localVideoRef.current.srcObject = null
    }
    if (opts.remoteVideoRef.current) {
      opts.remoteVideoRef.current.srcObject = null
    }
    pendingCandidatesRef.current = []
  }, [])

  // ====== SPEAKER TOGGLE ======
  // Toggles audio output between the default device (earpiece on mobile,
  // default speakers on desktop) and the loudspeaker.
  //
  // Implementation: uses HTMLMediaElement.setSinkId() — a non-standard but
  // widely-supported API (Chrome 17+, Edge, Opera; NOT Safari iOS as of 2024).
  // On iOS, the only way to route audio to the loudspeaker is to play through
  // a <video> element instead of <audio> — we already use <video> for video
  // calls, so speaker toggle works there. For audio-only calls on iOS, the
  // user must use the hardware speaker button (we can't control it from JS).
  //
  // For Android Chrome and desktop, this works correctly.
  const toggleSpeaker = useCallback(async (enabled: boolean) => {
    const opts = optionsRef.current
    const videoEl = opts.remoteVideoRef.current
    if (!videoEl) return
    // setSinkId is only available in Chromium-based browsers.
    const anyVideo = videoEl as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }
    if (typeof anyVideo.setSinkId !== 'function') {
      // Safari/Firefox — can't control output device from JS.
      // The user must use the OS-level speaker toggle.
      return
    }
    try {
      if (enabled) {
        // Find the loudspeaker (audiooutput device that's not the default).
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioOutputs = devices.filter((d) => d.kind === 'audiooutput')
        // Heuristic: pick the device whose label contains 'speaker' or
        // 'loudspeaker'. If none, pick the last one (usually the speaker).
        const speaker = audioOutputs.find((d) =>
          /speaker|loudspeaker|громкоговоритель/i.test(d.label),
        ) || audioOutputs[audioOutputs.length - 1]
        if (speaker && speaker.deviceId) {
          await anyVideo.setSinkId(speaker.deviceId)
        }
      } else {
        // Back to default (earpiece on mobile)
        await anyVideo.setSinkId('default')
      }
    } catch {
      // Permission denied or device not found — silent
    }
  }, [])

  // ====== ICE RESTART ======
  // If the ICE connection state transitions to 'failed', attempt to restart
  // ICE by creating a new offer with iceRestart: true. This recovers from
  // network changes (WiFi → cellular, NAT rebinding) without dropping the
  // call.
  //
  // The caller initiates the restart; the recipient just receives a new
  // offer and responds with a new answer. Both sides re-negotiate ICE
  // candidates over the existing peer connection.
  const restartIce = useCallback(async () => {
    const pc = pcRef.current
    const api = socketApiRef.current
    if (!pc) return
    const meta = pcMeta.get(pc)
    if (!meta) return
    try {
      const offer = await pc.createOffer({ iceRestart: true })
      await pc.setLocalDescription(offer)
      api.sendCallSignal(meta.callId, meta.peerId, { type: 'offer', sdp: offer })
    } catch {
      // Restart failed — caller should hang up
    }
  }, [])

  // v25.4 (calls audit GAP-1): Screen share via getDisplayMedia + replaceTrack.
  // Replaces the camera video track on the existing RTCRtpSender — no SDP
  // renegotiation needed (replaceTrack is a lightweight operation that just
  // swaps the media source without changing codecs/params).
  const startScreenShare = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return
    const pc = pcRef.current
    if (!pc) return
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false, // screen audio is finicky — skip for now
      })
      const screenTrack = screenStream.getVideoTracks()[0]
      if (!screenTrack) return
      // Find the video sender on the PC.
      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video')
      if (!videoSender) return
      // Save the original camera track so we can restore it later.
      const localStream = localStreamRef.current
      if (localStream) {
        originalVideoTrackRef.current = localStream.getVideoTracks()[0] || null
      }
      await videoSender.replaceTrack(screenTrack)
      // Update localStreamRef so the local preview shows the screen too.
      if (localStream && originalVideoTrackRef.current) {
        localStream.removeTrack(originalVideoTrackRef.current)
        localStream.addTrack(screenTrack)
        optionsRef.current.onLocalStreamReady?.(localStream)
      }
      // When the user stops sharing via browser UI, restore the camera.
      screenTrack.addEventListener('ended', () => {
        void stopScreenShare()
      })
      setIsScreenSharing(true)
    } catch {
      // User cancelled or permission denied — no-op.
    }
  }, [])

  // v25.4 (calls audit GAP-1): restore the camera track after screen share.
  const stopScreenShare = useCallback(async () => {
    const pc = pcRef.current
    if (!pc) return
    const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video')
    if (!videoSender) return
    const original = originalVideoTrackRef.current
    if (original) {
      try { await videoSender.replaceTrack(original) } catch {}
      const localStream = localStreamRef.current
      if (localStream) {
        // Remove the screen track and re-add the camera track.
        for (const t of localStream.getVideoTracks()) {
          if (t !== original) localStream.removeTrack(t)
        }
        if (!localStream.getVideoTracks().includes(original)) {
          localStream.addTrack(original)
        }
        optionsRef.current.onLocalStreamReady?.(localStream)
      }
    }
    originalVideoTrackRef.current = null
    setIsScreenSharing(false)
  }, [])

  // Cleanup on unmount — stable because hangup is stable.
  useEffect(() => {
    return () => {
      hangup()
    }
  }, [hangup])

  return {
    iceState,
    initiateCall,
    acceptIncomingCall,
    handleSignal,
    toggleCamera,
    toggleMic,
    switchCamera,
    toggleSpeaker,
    restartIce,
    hangup,
    // v25.4 (calls audit GAP-1): screen share
    startScreenShare,
    stopScreenShare,
    isScreenSharing,
    _pc: pcRef,
    _localStream: localStreamRef,
    _remoteStream: remoteStreamRef,
  }
}
