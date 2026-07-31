'use client'

// C-HIGH-007 fix: offline message queue.
// When socket is disconnected AND REST fails, messages are stored in
// localStorage. On next app load (or socket reconnect — handled by the
// caller), the queue is flushed: each entry is retried via REST, and the
// backend's C-CRIT-002 clientMessageId idempotency key ensures a duplicate
// retry (e.g. from a slow previous attempt that did succeed) does not
// create a second message.
//
// NOTE: This is a minimal localStorage-based queue. localStorage has a
// ~5 MB per-origin cap — fine for ~1000 queued messages, but it's
// synchronous + blocking. For production at scale, migrate to IndexedDB
// (idb-keyval) for larger storage and structured/async access.

const QUEUE_KEY = '999pro-outbound-message-queue'

export interface QueuedMessage {
  tempId: string
  conversationId: string
  content?: string
  mediaUrl?: string
  mediaType?: 'text' | 'image' | 'video' | 'audio' | 'file' | 'product' | 'audio-hub' | 'film'
  duration?: number
  replyToId?: string
  // v13.0 (audit P1-9 fix): include attachments so offline multi-file
  // messages preserve their attachment metadata on retry. Previously the
  // queue dropped attachments, causing messages to be resent as text-only.
  attachments?: Array<{ url: string; type: string; name?: string; size?: number }>
  timestamp: number
}

export function getQueuedMessages(): QueuedMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as QueuedMessage[] : []
  } catch {
    return []
  }
}

export function queueMessage(msg: QueuedMessage): void {
  if (typeof window === 'undefined') return
  const queue = getQueuedMessages()
  // Avoid duplicates by tempId (the same key the backend uses for
  // clientMessageId idempotency — see C-CRIT-002).
  if (queue.some((q) => q.tempId === msg.tempId)) return
  queue.push(msg)
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // Storage full / disabled — silently drop. The message will be lost,
    // but the user's optimistic UI is still visible (with a failed
    // indicator) so they can manually re-send.
  }
  // v10-native: register Background Sync so the SW wakes up when network
  // is restored and notifies the page to flush the queue. No-op on
  // browsers without Background Sync API (Firefox/Safari) — the queue is
  // still flushed on next app load via the use-socket.ts mount effect.
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg) => {
        // Cast to access the `sync` property (not in the default TS lib).
        const syncReg = reg as unknown as { sync?: { register: (tag: string) => Promise<void> } }
        syncReg.sync?.register('send-outbound-messages').catch(() => {})
      })
      .catch(() => {})
  }
}

export function removeQueuedMessage(tempId: string): void {
  if (typeof window === 'undefined') return
  const queue = getQueuedMessages().filter((q) => q.tempId !== tempId)
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {}
}

export function clearQueue(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(QUEUE_KEY)
  } catch {}
}
