'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '@/lib/api'
import { toast } from '@/lib/notifications'
import type { Message, User } from '@/lib/types'

// ============================================================================
// useVoiceRecorder — extracted from chat.tsx (stage 12 refactor).
// ----------------------------------------------------------------------------
// Encapsulates all MediaRecorder logic for recording voice messages:
//   - start / stop / cancel
//   - 1-second timer for duration display
//   - mime-type negotiation (mp4 > webm > ogg)
//   - upload to /api/upload on stop
//   - discard on cancel (no upload)
//   - cleanup on unmount
//
// Returns the recording state + controls. The caller is responsible for
// rendering the UI (mic button, timer, cancel/send buttons).
//
// The `onSend` callback is invoked after a successful upload with the
// mediaUrl, duration, and a tempId — the caller adds the optimistic
// message to the list and emits the socket message:send event.
// ============================================================================

interface UseVoiceRecorderOptions {
  conversationId: string | null
  user: User | null
  replyToId: string | null
  // v16.8-final: optional self-destruct timer (voice messages).
  // When > 0, the message will be auto-deleted after the given number of
  // minutes. 0 = no auto-delete. Stored on the recorder so the value chosen
  // in the panel at record time is preserved through the stop→upload→send
  // async chain.
  selfDestructMinutes?: number
  onSend: (payload: {
    tempId: string
    mediaUrl: string
    duration: number
    selfDestructMinutes: number
    optimisticMessage: Message
  }) => void
  // v18.6: called when the background upload finishes. The chat component
  // uses this to swap the local blob URL for the real CDN URL and then emit
  // the socket `message:send` event so the recipient actually gets it.
  onUploaded?: (tempId: string, realUrl: string) => void
  // v18.6: called when the background upload fails. The chat component
  // removes the optimistic message (or marks it as failed).
  onUploadError?: (tempId: string) => void
  onScrollToBottom?: () => void
}

export function useVoiceRecorder({
  conversationId,
  user,
  replyToId,
  selfDestructMinutes = 0,
  onSend,
  onUploaded,
  onUploadError,
  onScrollToBottom,
}: UseVoiceRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  // v9-voice: expose the active MediaStream so consumers can attach an
  // AnalyserNode for real-time amplitude visualization (organic waveform,
  // ambient glow). The stream is cleared on stop/cancel.
  const [stream, setStream] = useState<MediaStream | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Mirror of recordSeconds for use inside the onstop closure — otherwise
  // the closure captures the initial 0 value and the uploaded voice message
  // gets duration=0.
  const recordSecondsRef = useRef(0)
  // Set to true by cancel() so recorder.onstop knows to discard the audio
  // instead of uploading it. Without this flag, clicking "Отмена" would
  // still upload and send the voice message.
  const cancelledRef = useRef(false)
  // The active stream ref — used by cleanup to release the mic if the
  // component unmounts mid-recording.
  const streamRef = useRef<MediaStream | null>(null)
  // Refs for stable callbacks — avoid re-creating start/stop on every render
  const convIdRef = useRef(conversationId)
  convIdRef.current = conversationId
  const userRef = useRef(user)
  userRef.current = user
  const replyToIdRef = useRef(replyToId)
  replyToIdRef.current = replyToId
  // v16.8-final: mirror selfDestructMinutes into a ref so the onstop closure
  // (which fires async after recorder.stop()) reads the value that was
  // current when the user pressed STOP — not the value at the next render.
  const selfDestructRef = useRef(selfDestructMinutes)
  selfDestructRef.current = selfDestructMinutes
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend
  // v18.6: refs for the upload lifecycle callbacks.
  const onUploadedRef = useRef(onUploaded)
  onUploadedRef.current = onUploaded
  const onUploadErrorRef = useRef(onUploadError)
  onUploadErrorRef.current = onUploadError
  const onScrollRef = useRef(onScrollToBottom)
  onScrollRef.current = onScrollToBottom

  const start = useCallback(async () => {
    if (!convIdRef.current) return
    if (typeof MediaRecorder === 'undefined') {
      toast.error('Ваш браузер не поддерживает запись аудио')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Pick the best supported audio format (mp4 > webm > ogg).
      const candidateTypes = [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ]
      const mimeType =
        candidateTypes.find(
          (t) =>
            typeof MediaRecorder.isTypeSupported === 'function' &&
            MediaRecorder.isTypeSupported(t),
        ) || ''
      const recorder = mimeType
        ? new MediaRecorder(stream, {
            mimeType,
            // v25.24 (owner): «голосовые очень долго грузятся». Режем битрейт:
            // Opus 32k (webm/ogg) и AAC 48k (mp4) — речь остаётся чистой,
            // файл и загрузка примерно вдвое меньше, чем на 64k. Просмотр
            // на слабых сетях начинается заметно быстрее.
            audioBitsPerSecond: mimeType.startsWith('audio/mp4') ? 48_000 : 32_000,
          })
        : new MediaRecorder(stream, { audioBitsPerSecond: 32_000 })
      // File extension derived from the chosen mime type for upload.
      const ext = mimeType.startsWith('audio/mp4')
        ? 'mp4'
        : mimeType.startsWith('audio/ogg')
          ? 'ogg'
          : 'webm'
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        // Always release the mic promptly
        stream.getTracks().forEach((t) => t.stop())
        // If the user pressed "Отмена", discard the recording — do NOT upload.
        if (cancelledRef.current) {
          cancelledRef.current = false
          chunksRef.current = []
          return
        }
        const blobType = mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: blobType })
        // Guard against empty recordings (user tapped mic + stop instantly)
        if (blob.size === 0) {
          return
        }
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blobType })
        const formData = new FormData()
        formData.append('file', file)
        // v18.6: optimistically notify the UI BEFORE the upload starts so the
        // user sees their voice message immediately with a "uploading…"
        // badge. The actual media URL is backfilled once the upload completes.
        // Previously the user waited 3-10 seconds with NO visual feedback
        // before the message appeared in the chat list.
        const tempId = `tmp_${Date.now()}`
        const duration = recordSecondsRef.current
        const u = userRef.current
        const convId = convIdRef.current
        const selfDestruct = selfDestructRef.current
        if (!u || !convId) return
        // Generate a local object URL so the audio can play immediately
        // while the real upload is in flight.
        const localUrl = URL.createObjectURL(blob)
        const optimisticMessage: Message = {
          id: tempId,
          conversationId: convId,
          senderId: u.id,
          content: null,
          mediaUrl: localUrl,
          mediaType: 'audio',
          duration,
          isRead: false,
          createdAt: new Date().toISOString(),
          tempId,
          // Marker so the UI can show an "uploading" spinner badge.
          isUploading: true as any,
          selfDestructAt:
            selfDestruct > 0
              ? new Date(Date.now() + selfDestruct * 60 * 1000).toISOString()
              : null,
          sender: {
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            avatar: u.avatar,
          },
        }
        // Emit the optimistic message FIRST so UI updates instantly.
        onSendRef.current({
          tempId,
          mediaUrl: localUrl,
          duration,
          selfDestructMinutes: selfDestruct,
          optimisticMessage,
        })
        onScrollRef.current?.()
        // Now upload in the background. On success, swap the local URL for
        // the real one via the onUploaded callback (if provided).
        try {
          const data = await api.post<{ url: string }>('/api/upload', {
            form: formData,
            auth: true,
          })
          // Backfill the real URL by emitting an `onUploaded` event.
          // The chat component listens for this and replaces the local
          // object URL with the real CDN URL, then sends the message via
          // socket (so the recipient actually receives it).
          onUploadedRef.current?.(tempId, data.url)
        } catch {
          toast.error('Не удалось загрузить голосовое')
          onUploadErrorRef.current?.(tempId)
        }
      }
      // Start recording with a 1-second timeslice so ondataavailable fires
      // every second (more reliable than relying on stop alone — some
      // mobile browsers don't fire dataavailable on stop).
      try {
        recorder.start(1000)
      } catch (startErr) {
        // v10-stability: if recorder.start() throws (e.g. InvalidStateError
        // if the recorder was already started, or UnknownError from the
        // platform), release the mic stream IMMEDIATELY. Without this, the
        // mic indicator stays lit forever and the user has to reload the page.
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setStream(null)
        mediaRecorderRef.current = null
        chunksRef.current = []
        toast.error('Не удалось начать запись')
        return
      }
      setIsRecording(true)
      setRecordSeconds(0)
      recordSecondsRef.current = 0
      // v9-voice: expose stream so consumers can attach an AnalyserNode.
      streamRef.current = stream
      setStream(stream)
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          const next = s + 1
          recordSecondsRef.current = next
          return next
        })
      }, 1000)
    } catch {
      // v10-stability: getUserMedia failed — no stream to release.
      toast.error('Нет доступа к микрофону')
    }
  }, [])

  const stop = useCallback(() => {
    // Send path — make sure the cancel flag is cleared so onstop uploads.
    cancelledRef.current = false
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    setIsRecording(false)
    // v9-voice: clear the stream — the AnalyserNode in useMicAmplitude will
    // tear down via its own useEffect cleanup. The actual track release
    // happens in recorder.onstop above.
    streamRef.current = null
    setStream(null)
  }, [])

  // Cancel path — set the flag BEFORE stopping so the onstop handler knows
  // to discard the recorded audio instead of uploading + sending it.
  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    setIsRecording(false)
    streamRef.current = null
    setStream(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop()
        } catch {}
      }
      // v9-voice: release the mic if unmounted mid-recording.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  return {
    isRecording,
    recordSeconds,
    stream,
    start,
    stop,
    cancel,
  }
}
