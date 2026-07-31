// ============================================================================
// self-destruct-scheduler.ts — v16.8-final
// ----------------------------------------------------------------------------
// Background scheduler that auto-deletes voice messages whose selfDestructAt
// deadline has passed. Runs every 60 seconds.
//
// For each due message:
//   1. Marks it as deletedForAll (nulls content/mediaUrl/mediaType/duration)
//   2. Emits 'message:deleted' via Socket.IO to the conversation room so all
//      participants' UIs update in real-time.
//   3. Removes the audio file from disk (uploads dir) to free storage.
//
// The scheduler is a single setInterval — designed to be started once at
// server boot (index.ts). Itself is idempotent: if multiple server instances
// run, the first to claim a message (via updateMany with selfDestructAt <= now
// AND deletedForAll = false) wins; the others see deletedForAll=true and skip.
//
// Safety: only deletes messages where mediaType='audio' (voice messages).
// Text/image/video/file messages don't get selfDestructAt set by the client,
// but this is defense-in-depth.
// ============================================================================

import path from 'node:path'
import fs from 'node:fs'
import { prisma } from './prisma.js'
import { logger } from './logger.js'
import type { Server as IoServer } from 'socket.io'

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
const TICK_MS = 60_000 // 60 seconds

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Start the self-destruct scheduler. Safe to call multiple times — subsequent
 * calls are no-ops if a timer is already running.
 */
export function startSelfDestructScheduler(io: IoServer): void {
  if (timer) return

  // Run once immediately on boot (catches messages whose deadline passed
  // while the server was down), then on the interval.
  void runOnce(io)
  timer = setInterval(() => void runOnce(io), TICK_MS)
  timer.unref?.() // don't keep the event loop alive on shutdown

  logger.info('Self-destruct scheduler started', {
    module: 'self-destruct',
    intervalMs: TICK_MS,
  })
}

/**
 * Stop the scheduler (used in graceful shutdown).
 */
export function stopSelfDestructScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/**
 * One pass: find all due self-destruct messages and delete them.
 *
 * Uses updateMany with a WHERE clause that includes deletedForAll=false to
 * avoid races between multiple server instances — only one updateMany will
 * match each row, the others will report count=0.
 */
async function runOnce(io: IoServer): Promise<void> {
  try {
    const now = new Date()
    // Find due messages that haven't been soft-deleted yet.
    const due = await prisma.message.findMany({
      where: {
        selfDestructAt: { not: null, lte: now },
        deletedForAll: false,
        // Defense-in-depth: only voice messages should have selfDestructAt.
        // The schema allows it on any message type, but the client only sets
        // it for audio. We double-check here.
        mediaType: 'audio',
      },
      select: { id: true, conversationId: true, mediaUrl: true },
      take: 100, // cap per tick to avoid overloading the DB
    })

    if (due.length === 0) return

    logger.info('Self-destruct: deleting due voice messages', {
      module: 'self-destruct',
      count: due.length,
    })

    for (const msg of due) {
      try {
        // 1. Mark deleted-for-everyone (nulls content/mediaUrl/mediaType/duration).
        await prisma.message.update({
          where: { id: msg.id },
          data: {
            deletedForAll: true,
            content: null,
            mediaUrl: null,
            mediaType: null,
            duration: null,
            selfDestructAt: null,
          },
        })

        // 2. Notify all participants via Socket.IO.
        io.to(`conversation:${msg.conversationId}`).emit('message:deleted', {
          messageId: msg.id,
          conversationId: msg.conversationId,
          deletedForAll: true,
        })

        // 3. Remove the audio file from disk (best-effort — never fail the
        // whole tick if a file is missing or already deleted).
        if (msg.mediaUrl) {
          const filename = path.basename(msg.mediaUrl)
          // Only delete files inside UPLOAD_DIR (prevents path traversal).
          const filepath = path.resolve(UPLOAD_DIR, filename)
          if (filepath.startsWith(UPLOAD_DIR + path.sep) || filepath === UPLOAD_DIR) {
            try {
              await fs.promises.unlink(filepath)
            } catch (e: any) {
              if (e?.code !== 'ENOENT') {
                logger.warn('Self-destruct: failed to delete audio file', {
                  module: 'self-destruct',
                  messageId: msg.id,
                  filepath,
                  error: e?.message,
                })
              }
            }
          }
        }
      } catch (e: any) {
        logger.error('Self-destruct: failed to delete message', {
          module: 'self-destruct',
          messageId: msg.id,
          error: e instanceof Error ? e : new Error(String(e)),
        })
      }
    }
  } catch (e: any) {
    logger.error('Self-destruct scheduler tick failed', {
      module: 'self-destruct',
      error: e instanceof Error ? e : new Error(String(e)),
    })
  }
}
