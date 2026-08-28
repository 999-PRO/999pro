'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Phone, PhoneOff, Mic, MicOff, Video, VideoOff,
  Camera, Volume2, VolumeX, ChevronRight,
  Minimize2, Maximize2, Monitor, MonitorOff,
} from 'lucide-react'
import type { CallState } from '@/lib/types'
import { assetUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { requestWakeLock, releaseWakeLock, handleVisibilityChange } from '@/lib/wake-lock'

interface CallScreenProps {
  call: CallState
  localVideoRef: React.RefObject<HTMLVideoElement | null>
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>
  iceState: RTCIceConnectionState
  isPip?: boolean
  isScreenSharing?: boolean
  onMinimize?: () => void
  onExpand?: () => void
  onAccept: () => void
  onReject: () => void
  onEnd: () => void
  onToggleMic: (enabled: boolean) => void
  onToggleCamera: (enabled: boolean) => void
  onSwitchCamera: () => void
  onToggleSpeaker: (enabled: boolean) => void
  // v25.4 (calls audit GAP-1): screen share callbacks
  onToggleScreenShare?: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function getQualityLabel(state: RTCIceConnectionState): { label: string; color: string } {
  switch (state) {
    case 'connected':
      return { label: 'Отлично', color: '#10b981' }
    case 'completed':
      return { label: 'Отлично', color: '#10b981' }
    case 'checking':
      return { label: 'Соединение…', color: '#3b82f6' }
    case 'disconnected':
      return { label: 'Слабый сигнал', color: '#f59e0b' }
    case 'failed':
      return { label: 'Ошибка соединения', color: '#ef4444' }
    default:
      return { label: '—', color: '#94a3b8' }
  }
}

export function CallScreen(props: CallScreenProps) {
  const { call, localVideoRef, remoteVideoRef, iceState, isPip } = props
  const isIncoming = call.direction === 'incoming' && call.status === 'ringing'
  const isVideo = call.type === 'video'
  const [seconds, setSeconds] = useState(0)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [speakerOn, setSpeakerOn] = useState(true)
  // F-CRIT-004 fix: track local stream attachment via state, not ref-during-render.
  // Previously: {isVideo && localVideoRef.current?.srcObject ? (<video/>) : (<img/>)}
  // Reading ref.current during render is unsafe — refs are mutated by effects,
  // not by render. The condition was false on first render (ref is null), then
  // never re-evaluated because ref mutation does NOT trigger a re-render.
  // The PIP thumbnail permanently showed the avatar fallback even after the
  // local camera stream was attached.
  const [hasLocalStream, setHasLocalStream] = useState(false)
  useEffect(() => {
    // Check if local stream is already attached (e.g. component mounted after
    // stream was set). Re-check on call.status changes (connecting → connected).
    if (localVideoRef.current?.srcObject) {
      setHasLocalStream(true)
    }
  }, [call.status, localVideoRef])

  useEffect(() => {
    if (call.status === 'connected' && call.startedAt) {
      const interval = setInterval(() => {
        setSeconds(Math.floor((Date.now() - (call.startedAt || Date.now())) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [call.status, call.startedAt])

  // v10-native: Wake Lock — keep the screen on while a call is active
  // (ringing, connecting, or connected). Released when the call ends.
  // Also re-acquire on visibilitychange (the lock is released when the
  // page is hidden). Like native phone apps that keep the screen on
  // during calls.
  useEffect(() => {
    const isActive = call.status === 'ringing' || call.status === 'connecting' || call.status === 'connected'
    if (isActive) {
      requestWakeLock()
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
    return () => {
      if (isActive) {
        releaseWakeLock()
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [call.status])

  // v25.6 (call UI): Proximity sensor — turn off the screen when the phone
  // is held to the ear during an audio call. This is the standard phone-app
  // behaviour: when the proximity sensor detects the phone is near the face,
  // the screen turns off to prevent accidental taps and save battery.
  // When the phone moves away, the screen turns back on.
  //
  // Browser support: 'ondeviceproximity' (older) and 'onuserproximity' (newer).
  // iOS Safari doesn't expose these events to web pages, so this is primarily
  // for Android Chrome. iOS handles proximity at the OS level for PWA calls
  // when the audio is routed to the earpiece (which it is by default).
  //
  // We also use the Page Visibility API as a fallback: if the page becomes
  // hidden during a call, we treat it as "phone to ear".
  const [isNearProximity, setIsNearProximity] = useState(false)
  useEffect(() => {
    if (call.status !== 'connected') {
      setIsNearProximity(false)
      return
    }
    // Only enable proximity screen-off for AUDIO calls (video calls need the screen).
    if (call.type === 'video') return

    const onDeviceProximity = (e: any) => {
      // e.value is the distance in centimeters; e.min/e.max are the sensor range.
      // When e.value < e.max (or e.value === 0), the phone is near the ear.
      const isNear = e.value !== undefined && (e.value === 0 || (e.max && e.value < e.max))
      setIsNearProximity(!!isNear)
    }
    const onUserProximity = (e: any) => {
      // userproximity event: e.near is a boolean (true when near).
      setIsNearProximity(!!e.near)
    }
    // Some browsers fire 'deviceproximity', others 'userproximity'. Register both.
    if (typeof window !== 'undefined') {
      window.addEventListener('deviceproximity', onDeviceProximity as EventListener)
      window.addEventListener('userproximity', onUserProximity as EventListener)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceproximity', onDeviceProximity as EventListener)
        window.removeEventListener('userproximity', onUserProximity as EventListener)
      }
      setIsNearProximity(false)
    }
  }, [call.status, call.type])

  const peer = call.peer
  const peerName = peer?.displayName || peer?.username || 'Пользователь'
  const peerInitials = peerName.slice(0, 2).toUpperCase()
  const quality = getQualityLabel(iceState)

  // ====== PIP (picture-in-picture) MODE ======
  // Small floating card — user can browse the app while on a call.
  // Tap to expand back to full screen.
  if (isPip && !isIncoming) {
    return (
      <button
        onClick={props.onExpand}
        className="fixed bottom-20 right-3 z-[150] flex items-center gap-2.5 rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.95) 50%, rgba(37,99,235,0.95) 100%)',
          border: '1px solid rgba(255,255,255,0.18)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          padding: '8px 12px',
        }}
        aria-label="Развернуть звонок"
      >
        {/* Avatar or local video thumbnail */}
        <div className="h-9 w-9 rounded-full overflow-hidden bg-black shrink-0">
          {isVideo && hasLocalStream ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
          ) : peer?.avatar ? (
            <img src={assetUrl(peer.avatar)} alt={peer?.displayName || peer?.username || 'User avatar'} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full gradient-brand grid place-items-center text-white text-xs font-bold">
              {peerInitials}
            </div>
          )}
        </div>
        <div className="flex flex-col items-start min-w-0">
          <div className="text-xs font-semibold text-white truncate max-w-[120px]">
            {peerName}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/70">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: quality.color }}
            />
            {call.status === 'connected' ? formatDuration(seconds) : call.status}
          </div>
        </div>
        <Maximize2 className="h-4 w-4 text-white/70 shrink-0" />
      </button>
    )
  }

  // ====== INCOMING CALL SCREEN ======
  // v25.18: премиум-редизайн — размытый фон из аватара + аурора-орбы,
  // расходящиеся кольца вокруг аватара, стеклянные кнопки.
  if (isIncoming) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-between p-8 overflow-hidden"
        style={{ background: '#0b0714' }}
      >
        {/* Размытый фон из аватара собеседника */}
        {peer?.avatar && (
          <div
            aria-hidden
            className="absolute inset-[-12%]"
            style={{
              backgroundImage: `url(${assetUrl(peer.avatar)})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(70px) saturate(160%) brightness(0.55)',
              transform: 'scale(1.25)',
            }}
          />
        )}
        <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(90% 70% at 50% 30%, rgba(124,58,237,0.18) 0%, rgba(8,6,20,0.82) 70%)' }} />
        <div aria-hidden className="absolute -top-[18%] -right-[20%] w-[70vmax] h-[70vmax] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.16) 0%, transparent 65%)', filter: 'blur(30px)' }} />

        {/* Top: caller info */}
        <div className="relative flex flex-col items-center gap-5 pt-10">
          <div
            className="px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-[0.22em] text-white/85"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          >
            {isVideo ? 'Видеозвонок' : 'Аудиозвонок'}
          </div>
          <div className="relative grid place-items-center">
            {/* Расходящиеся кольца */}
            <span aria-hidden className="absolute h-40 w-40 rounded-full border border-white/25" style={{ animation: 'call-ring 2.6s ease-out infinite' }} />
            <span aria-hidden className="absolute h-40 w-40 rounded-full border border-white/20" style={{ animation: 'call-ring 2.6s ease-out 1.3s infinite' }} />
            <div className="absolute inset-0 rounded-full bg-white/20 blur-2xl animate-pulse" />
            <div className="relative h-36 w-36 rounded-full overflow-hidden ring-1 ring-white/35"
              style={{ boxShadow: '0 24px 60px -18px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.25)' }}
            >
              {peer?.avatar ? (
                <img
                  src={assetUrl(peer.avatar)}
                  alt={peerName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full gradient-brand grid place-items-center text-white text-4xl font-bold">
                  {peerInitials}
                </div>
              )}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[26px] font-extrabold text-white tracking-tight">{peerName}</div>
            <div className="text-sm text-white/65 mt-1">Входящий звонок…</div>
          </div>
        </div>

        {/* Bottom: accept / reject buttons */}
        <div className="relative flex items-center gap-20 pb-10">
          <button
            onClick={() => {
              setMicOn(true)
              setCamOn(true)
              props.onReject()
            }}
            className="flex flex-col items-center gap-2.5 group"
            aria-label="Отклонить"
          >
            <div
              className="rounded-full grid place-items-center group-hover:scale-105 group-active:scale-95 transition-transform"
              style={{
                height: 74,
                width: 74,
                background: 'linear-gradient(135deg, #F43F5E 0%, #E11D48 100%)',
                boxShadow: '0 16px 44px -10px rgba(225,29,72,0.6), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              <PhoneOff className="h-8 w-8 text-white" />
            </div>
            <span className="text-xs text-white/75 font-medium">Отклонить</span>
          </button>

          <button
            onClick={() => {
              setMicOn(true)
              setCamOn(true)
              props.onAccept()
            }}
            className="flex flex-col items-center gap-2.5 group"
            aria-label="Принять"
          >
            <div
              className="rounded-full grid place-items-center group-hover:scale-105 group-active:scale-95 transition-transform relative"
              style={{
                height: 74,
                width: 74,
                background: 'linear-gradient(135deg, #34D399 0%, #059669 100%)',
                boxShadow: '0 16px 44px -10px rgba(5,150,105,0.6), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: 'rgba(16,185,129,0.5)', animation: 'call-ring-fill 1.8s ease-out infinite' }} />
              <Phone className="relative h-8 w-8 text-white" />
            </div>
            <span className="text-xs text-white/75 font-medium">Принять</span>
          </button>
        </div>
      </div>
    )
  }

  // ====== ACTIVE CALL SCREEN ======
  // v25.6 (call UI): when the proximity sensor detects the phone is near the
  // ear (audio calls only), we turn the screen black to save battery and
  // prevent accidental taps. The wake lock is released so the OS can turn
  // off the display. When the phone moves away, the screen returns.
  const proximityScreenOff = isNearProximity && call.type === 'audio' && call.status === 'connected'
  return (
    <div className="fixed inset-0 z-[200] flex flex-col transition-opacity duration-300 overflow-hidden"
      style={{
        background: proximityScreenOff
          ? '#000'
          : isVideo
            ? '#000'
            : '#0b0714',
        opacity: proximityScreenOff ? 0 : 1,
        pointerEvents: proximityScreenOff ? 'none' : 'auto',
      }}
    >
      {/* v25.18: для аудиозвонков — размытый фон из аватара + аурора */}
      {!isVideo && !proximityScreenOff && (
        <>
          {peer?.avatar && (
            <div
              aria-hidden
              className="absolute inset-[-12%]"
              style={{
                backgroundImage: `url(${assetUrl(peer.avatar)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(80px) saturate(150%) brightness(0.5)',
                transform: 'scale(1.25)',
              }}
            />
          )}
          <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(90% 70% at 50% 25%, rgba(124,58,237,0.16) 0%, rgba(8,6,20,0.85) 72%)' }} />
          <div aria-hidden className="absolute -bottom-[20%] -left-[20%] w-[70vmax] h-[70vmax] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.14) 0%, transparent 65%)', filter: 'blur(30px)' }} />
        </>
      )}
      {/* ═══════════════════════════════════════════════════════════════
          CRITICAL: Hidden audio element for audio-only calls.
          Without this, the remote stream's audio tracks have nowhere to
          play — the <video> below only renders for video calls, so
          audio-only calls would have NO sound. This hidden <video> (which
          also plays audio) is ALWAYS mounted so ontrack can set srcObject.
          ═══════════════════════════════════════════════════════════════ */}
      {!isVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute opacity-0 pointer-events-none h-0 w-0"
          aria-hidden
        />
      )}

      {/* Remote video (full screen for video calls) — blurred background
          behind peer avatar when camera is off. */}
      {isVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }} // mirror for natural feel
        />
      )}

      {/* Local video (picture-in-picture) — positioned below the status bar
          using safe-area-inset-top so it doesn't go under the notch / status
          bar on iPhone and Android PWA. */}
      {isVideo && (
        <div
          className="absolute right-4 z-10 h-32 w-24 sm:h-44 sm:w-32 rounded-2xl overflow-hidden border-2 border-white/30 shadow-2xl bg-black"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
        >
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
        </div>
      )}

      {/* Top bar: peer info + timer + quality + minimize button */}
      <div className="relative z-10 flex flex-col items-center gap-2 pt-12 pb-6">
        {/* Minimize button — top right, lets user browse the app while on call */}
        {call.status === 'connected' && (
          <button
            onClick={props.onMinimize}
            className="absolute top-4 left-4 p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            aria-label="Свернуть"
            title="Свернуть в окошко"
            style={{ marginTop: 'calc(env(safe-area-inset-top, 0px) - 8px)' }}
          >
            <Minimize2 className="h-5 w-5 text-white" />
          </button>
        )}

        {!isVideo && (
          <div className="relative grid place-items-center mb-2">
            {/* v25.18: мягкие расходящиеся кольца, когда идёт соединение/вызов */}
            {call.status !== 'connected' && (
              <>
                <span aria-hidden className="absolute h-32 w-32 rounded-full border border-white/25" style={{ animation: 'call-ring 2.6s ease-out infinite' }} />
                <span aria-hidden className="absolute h-32 w-32 rounded-full border border-white/20" style={{ animation: 'call-ring 2.6s ease-out 1.3s infinite' }} />
              </>
            )}
            <div className="absolute inset-0 rounded-full bg-white/20 blur-2xl" />
            <div
              className="relative h-28 w-28 rounded-full overflow-hidden ring-1 ring-white/30"
              style={{ boxShadow: '0 22px 54px -16px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.22)' }}
            >
              {peer?.avatar ? (
                <img
                  src={assetUrl(peer.avatar)}
                  alt={peerName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full gradient-brand grid place-items-center text-white text-2xl font-bold">
                  {peerInitials}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="text-[22px] font-extrabold text-white tracking-tight drop-shadow-md">{peerName}</div>

        {/* v25.18: статус-таймер и качество — стеклянные чипы */}
        <div className="flex items-center gap-2 mt-1.5">
          <span
            className="text-xs font-semibold tabular-nums px-3 py-1 rounded-full text-white/90"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
          >
            {call.status === 'connected' ? formatDuration(seconds) : call.status === 'ringing' ? 'Вызов…' : call.status === 'connecting' ? 'Соединение…' : call.status}
          </span>
          <span
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full text-white/85"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: quality.color, boxShadow: `0 0 8px ${quality.color}` }}
            />
            {quality.label}
          </span>
        </div>
      </div>

      <div className="flex-1" />

      {/* Bottom: controls */}
      <div className="relative z-10 pb-12 px-6 flex flex-col items-center gap-6">
        {/* Primary controls */}
        <div className="flex items-center gap-4 sm:gap-6">
          <CallControlButton
            active={micOn}
            onClick={() => {
              const next = !micOn
              setMicOn(next)
              props.onToggleMic(next)
            }}
            activeIcon={<Mic className="h-6 w-6" />}
            inactiveIcon={<MicOff className="h-6 w-6" />}
            label={micOn ? 'Микр' : 'Выкл'}
          />

          {isVideo && (
            <CallControlButton
              active={camOn}
              onClick={() => {
                const next = !camOn
                setCamOn(next)
                props.onToggleCamera(next)
              }}
              activeIcon={<Video className="h-6 w-6" />}
              inactiveIcon={<VideoOff className="h-6 w-6" />}
              label={camOn ? 'Камера' : 'Выкл'}
            />
          )}

          {isVideo && (
            <CallControlButton
              active={true}
              onClick={() => props.onSwitchCamera()}
              activeIcon={<Camera className="h-6 w-6" />}
              inactiveIcon={<Camera className="h-6 w-6" />}
              label="Сменить"
              compact
            />
          )}

          <CallControlButton
            active={speakerOn}
            onClick={() => {
              const next = !speakerOn
              setSpeakerOn(next)
              props.onToggleSpeaker(next)
            }}
            activeIcon={<Volume2 className="h-6 w-6" />}
            inactiveIcon={<VolumeX className="h-6 w-6" />}
            label={speakerOn ? 'Динамик' : 'Выкл'}
          />

          {/* v25.4 (calls audit GAP-1): Screen share toggle. Only shown for
              video calls on desktop (getDisplayMedia is not available on
              mobile browsers, especially iOS Safari). */}
          {isVideo && props.onToggleScreenShare && (
            <CallControlButton
              active={!props.isScreenSharing}
              onClick={() => props.onToggleScreenShare?.()}
              activeIcon={<Monitor className="h-6 w-6" />}
              inactiveIcon={<MonitorOff className="h-6 w-6" />}
              label={props.isScreenSharing ? 'Экран' : 'Экран'}
              compact
            />
          )}
        </div>

        {/* End call button */}
        <button
          onClick={props.onEnd}
          className="flex flex-col items-center gap-2 group relative"
          aria-label="Завершить"
        >
          <span
            aria-hidden
            className="absolute top-0 left-1/2 -translate-x-1/2 h-16 w-16 rounded-full"
            style={{ background: 'rgba(244,63,94,0.45)', animation: 'call-ring-fill 1.8s ease-out infinite' }}
          />
          <div
            className="relative h-16 w-16 rounded-full grid place-items-center group-hover:scale-105 group-active:scale-95 transition-transform"
            style={{
              background: 'linear-gradient(135deg, #F43F5E 0%, #E11D48 100%)',
              boxShadow: '0 14px 38px -8px rgba(225,29,72,0.6), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
          >
            <PhoneOff className="h-7 w-7 text-white" />
          </div>
        </button>
      </div>
    </div>
  )
}

interface CallControlButtonProps {
  active: boolean
  onClick: () => void
  activeIcon: React.ReactNode
  inactiveIcon: React.ReactNode
  label: string
  compact?: boolean
}

function CallControlButton({ active, onClick, activeIcon, inactiveIcon, label, compact }: CallControlButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 group"
      aria-label={label}
    >
      <div
        className={cn(
          'rounded-full grid place-items-center backdrop-blur-md transition-all group-hover:scale-105 group-active:scale-95',
          compact ? 'h-12 w-12' : 'h-14 w-14',
          active
            ? 'text-white'
            : 'text-red-400',
        )}
        style={
          active
            ? { background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)' }
            : { background: 'rgba(255,255,255,0.92)', border: '1.5px solid rgba(244,63,94,0.65)', boxShadow: '0 10px 28px -10px rgba(244,63,94,0.5)' }
        }
      >
        {active ? activeIcon : inactiveIcon}
      </div>
      <span className="text-[10px] text-white/70 font-medium">{label}</span>
    </button>
  )
}
