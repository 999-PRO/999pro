import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, requireAdminOnly, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import webpush from 'web-push'
import { logger } from '../lib/logger.js'

const router: Router = Router()

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@localhost'

if (!process.env.VAPID_SUBJECT) {
  logger.warn('VAPID_SUBJECT not set — using fallback. Set VAPID_SUBJECT env var in production.', { module: 'push' })
}

// v25.4 (push audit): validate VAPID_SUBJECT format. iOS Safari 16.4+ PWA
// push silently fails if the subject is not a valid mailto: or https: URL.
// The fallback 'mailto:noreply@localhost' works for development but should
// be replaced with a real address in production.
if (VAPID_SUBJECT && !VAPID_SUBJECT.startsWith('mailto:') && !VAPID_SUBJECT.startsWith('https://')) {
  logger.error(
    `VAPID_SUBJECT "${VAPID_SUBJECT}" is invalid — must start with "mailto:" or "https://". iOS PWA push will silently fail.`,
    { module: 'push' },
  )
}

// P-HIGH-002: One-shot breadcrumb when VAPID keys are missing. Avoids
// spamming logs on every sendPushToUser() call but ensures the operator
// sees at least one error-level breadcrumb.
let vapidKeysWarningLogged = false

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

// GET /api/push/vapid-public — returns the public VAPID key for the client
// to use when subscribing via pushManager.subscribe()
router.get('/vapid-public', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'Push notifications not configured' })
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY })
})

// POST /api/push/subscribe — save a push subscription for the authenticated user
router.post('/subscribe', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const userId = req.user!.id
  const { endpoint, keys, scope } = req.body || {}

  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Invalid subscription: endpoint and keys required' })
  }

  // SECURITY: Do NOT rebind userId on conflict. If user A subscribed from a
  // shared device and user B later logs in on the same browser, the same
  // push endpoint will exist — previously the upsert reassigned it to user B,
  // leaking user A's notifications. Now: on conflict, only update keys +
  // userAgent, and ONLY rebind userId if the existing row has no owner
  // (defensive — shouldn't happen, but covers legacy data).
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint },
    select: { userId: true },
  })

  if (existing && existing.userId && existing.userId !== userId) {
    // Subscription belongs to another user. This happens legitimately when:
    //   - The browser revoked the old subscription and issued a new one
    //     (endpoint should differ in that case, so this branch shouldn't fire)
    //   - Or the user cleared site data and re-subscribed (endpoint differs)
    // We treat it as a conflict and tell the client to unsubscribe locally
    // and create a fresh subscription. This is safer than silently rebinding.
    return res.status(409).json({
      error: 'Subscription is owned by another user. Please unsubscribe and try again.',
    })
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId,
      endpoint,
      keys: JSON.stringify(keys),
      userAgent: req.headers['user-agent'] || null,
      scope: typeof scope === 'string' ? scope : null,
    },
    update: {
      // Only update keys + userAgent + scope — DO NOT rebind userId.
      keys: JSON.stringify(keys),
      userAgent: req.headers['user-agent'] || null,
      scope: typeof scope === 'string' ? scope : null,
    },
  })

  res.json({ ok: true })
}))

// POST /api/push/unsubscribe — remove a push subscription
router.post('/unsubscribe', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const userId = req.user!.id
  const { endpoint } = req.body || {}

  if (!endpoint) {
    return res.status(400).json({ error: 'endpoint required' })
  }

  // Only delete if it belongs to this user
  const sub = await prisma.pushSubscription.findUnique({ where: { endpoint } })
  if (sub && sub.userId === userId) {
    await prisma.pushSubscription.delete({ where: { endpoint } })
  }

  res.json({ ok: true })
}))

// ============================================================================
// v24.4: MASS PUSH — broadcast to ALL users with push subscriptions.
// Used by Studio admins to send announcements (new product, sale, etc.).
// v25.7 (TZ ЭТАП 2.6): requireAdminOnly — mass push to ALL users is a
// high-impact action. Managers should not be able to spam every user from
// a single button; a single typo or grudge could send junk to the entire
// user base. Only a true admin (not a manager) can broadcast.
// ============================================================================
router.post('/broadcast', requireAuth, requireAdminOnly, asyncHandler(async (req: AuthedRequest, res) => {
  const { title, body, url, icon } = req.body || {}

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title required' })
  }
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({ error: 'body required' })
  }

  // Get ALL distinct users with push subscriptions
  const subs = await prisma.pushSubscription.findMany({
    select: { userId: true },
    distinct: ['userId'],
  })

  const userIds = subs.map((s) => s.userId)
  logger.info('Mass push broadcast', {
    module: 'push',
    title: title.slice(0, 50),
    recipientCount: userIds.length,
    adminId: req.user!.id,
  })

  // Send push to each user (fire-and-forget, don't block the response)
  const broadcastPayload = {
    title: title.trim(),
    body: body.trim(),
    tag: `broadcast-${Date.now()}`,
    url: url || '/',
    icon: icon || '/icons/icon-192.png',
    renotify: false,
  }

  // Send in background — response returns immediately
  void (async () => {
    let sent = 0
    let failed = 0
    for (const userId of userIds) {
      try {
        await sendPushToUser(userId, broadcastPayload)
        sent++
      } catch {
        failed++
      }
    }
    logger.info('Mass push complete', {
      module: 'push',
      sent,
      failed,
      total: userIds.length,
    })
  })()

  res.json({
    ok: true,
    recipientCount: userIds.length,
    message: `Push отправляется ${userIds.length} пользователям`,
  })
}))

// ============================================================================
// v25.15: broadcastPushToAll — авто-push всем подписчикам (кроме исключённых).
// Вызывается из products.ts при СОЗДАНИИ товара (если включён переключатель
// notifyNewProduct в Студии). В отличие от /broadcast-роута — это внутренний
// helper без HTTP: fire-and-forget, с лимитом на параллелизм.
// ============================================================================
export async function broadcastPushToAll(
  payload: {
    title: string
    body: string
    url?: string
    icon?: string
    tag?: string
  },
  excludeUserIds: string[] = [],
): Promise<void> {
  try {
    const subs = await prisma.pushSubscription.findMany({
      select: { userId: true },
      distinct: ['userId'],
    })
    const excluded = new Set(excludeUserIds)
    const userIds = subs.map((s) => s.userId).filter((id) => !excluded.has(id))
    if (userIds.length === 0) return

    logger.info('Auto push (new product)', {
      module: 'push',
      title: payload.title.slice(0, 50),
      recipientCount: userIds.length,
    })

    // Последовательная отправка с троттлингом нет — web-push сам держит
    // коннекты; но чтобы не упасть на сотнях подписчиков, шлём пачками по 20.
    const BATCH = 20
    for (let i = 0; i < userIds.length; i += BATCH) {
      const batch = userIds.slice(i, i + BATCH)
      await Promise.allSettled(
        batch.map((userId) =>
          sendPushToUser(userId, {
            ...payload,
            renotify: false,
          }),
        ),
      )
    }
  } catch (e) {
    logger.error('broadcastPushToAll error:', { module: 'push', error: e })
  }
}

// ============================================================================
// Helper: send a push notification to all of a user's subscribed devices.
// Called from socket handlers when a message is received, so the user gets
// a native push notification EVEN IF the app is fully closed.
//
// PUSH TAG / DEDUP POLICY (was a bug):
//   Previously every message in a conversation used `tag: 'msg-${conversationId}'`,
//   which caused the browser/PUSH service to REPLACE previous notifications
//   from the same conversation. A user receiving 5 messages in a row only
//   saw the LAST one — the other 4 were silently discarded.
//
//   Now: each message gets a unique tag (`msg-${conversationId}-${messageId}`)
//   AND we set `renotify: true` so the device re-vibrates/re-alerts the user
//   even if a previous notification from the same conversation is still
//   visible. The OS notification shade groups them by conversation tag prefix.
//   For lead-status pushes we keep the per-lead tag (one notification per
//   lead, replacement is desired — re-alerting on the same lead is annoying).
// ============================================================================
export async function sendPushToUser(
  userId: string,
  payload: {
    title: string
    body: string
    icon?: string
    badge?: string
    tag?: string
    url?: string
    data?: Record<string, unknown>
    // Optional: notification action buttons (e.g. Answer/Decline for calls).
    // The SW `push` event passes these through to `showNotification` and
    // the `notificationclick` handler reads `event.action` to know which
    // button was tapped.
    actions?: Array<{ action: string; title: string; icon?: string }>
    // renotify: if true, device re-vibrates even when replacing an existing
    // notification with the same tag. Default true for messages (so a rapid
    // burst of 5 messages doesn't collapse into a single silent notification).
    renotify?: boolean
    // requireInteraction: if true, the notification persists until the user
    // acts on it. Used for incoming calls. Default false.
    requireInteraction?: boolean
  },
): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    // P-HIGH-002: VAPID keys not configured — push notifications are silently
    // disabled. Log once at startup (error level) so operators notice, then
    // stay quiet to avoid log spam.
    if (!vapidKeysWarningLogged) {
      logger.error('VAPID keys not configured — push notifications silently disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars.', { module: 'push' })
      vapidKeysWarningLogged = true
    }
    return
  }

  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } })
    if (subs.length === 0) return

    // DEDUP: when the same admin uses BOTH the main app (/) AND Studio
    // (/studio/) on the same browser, they have TWO service worker
    // registrations → TWO push endpoints with the SAME userAgent. Sending
    // to both produces DUPLICATE system notifications (Notification API
    // `tag` is scoped per-SW-registration, so the OS does NOT dedupe them).
    //
    // We keep only ONE subscription per (userAgent || endpoint), preferring
    // the main-app scope ("/") over "/studio/" — the main SW has a richer
    // push handler (chat suppression, prefs, etc.). If userAgent is null
    // (legacy rows), fall back to endpoint as the dedup key.
    const seenUA = new Set<string>()
    const deduped = subs
      .filter((s) => {
        const key = s.userAgent || s.endpoint
        if (seenUA.has(key)) return false
        seenUA.add(key)
        return true
      })
      .sort((a, b) => {
        // Prefer scope "/" over "/studio/" or null
        const aScore = a.scope === '/' ? 0 : 1
        const bScore = b.scope === '/' ? 0 : 1
        return aScore - bScore
      })

    if (deduped.length < subs.length) {
      logger.warn(`Push dedup: user ${userId} had ${subs.length} subs (likely main+studio on same browser), sending to ${deduped.length}`, {
        module: 'push',
        totalSubs: subs.length,
        dedupedSubs: deduped.length,
      })
    }

    const subsToSend = deduped

    // P-HIGH-008 / C-HIGH-008: truncate payload before serialising.
    // Push services (FCM, APNs, Mozilla) enforce strict size limits:
    //   - FCM: 4 KB total encrypted payload
    //   - APNs: 4 KB (HTTP/2) or 2 KB (legacy)
    //   - Mozilla: ~4 KB
    // After encryption overhead (~120 bytes) + JSON keys (~200 bytes), a
    // 3 KB body would already blow the budget. We cap body at 200 chars
    // and title at 50 — generous for any human-readable notification while
    // staying well under all limits even for multi-byte UTF-8 (Cyrillic
    // chars are 2 bytes in UTF-8, emoji are 4 bytes).
    const truncatedBody =
      payload.body && payload.body.length > 200 ? payload.body.slice(0, 197) + '...' : payload.body
    const truncatedTitle =
      payload.title && payload.title.length > 50 ? payload.title.slice(0, 47) + '...' : payload.title

    const notificationPayload = JSON.stringify({
      title: truncatedTitle,
      body: truncatedBody,
      icon: payload.icon || '/icons/icon-192.png',
      badge: payload.badge || '/icons/icon-192-maskable.png',
      tag: payload.tag || 'chat-message',
      data: { url: payload.url || '/?view=chat', ...payload.data },
      vibrate: [120, 60, 120],
      requireInteraction: payload.requireInteraction ?? false,
      renotify: payload.renotify ?? true,
      actions: payload.actions || [],
    })

    // TTL: push expires after 24 hours if device is offline.
    // Without TTL, FCM/Apns queue push for up to 4 weeks — when device
    // comes online it gets a flood of stale notifications. 24h is the
    // sweet spot: long enough for normal offline periods, short enough
    // to avoid stale-notification floods.
    //
    // For requireInteraction (calls), use shorter TTL — a missed call
    // notification that arrives 24h later is confusing.
    const TTL_SECONDS = payload.requireInteraction ? 60 : 24 * 60 * 60

    const results = await Promise.allSettled(
      subsToSend.map((sub) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: JSON.parse(sub.keys),
          },
          notificationPayload,
          {
            TTL: TTL_SECONDS,
            // urgency: 'high' for calls, 'normal' for messages.
            // 'high' wakes the device even in Doze mode (Android).
            // 'normal' is buffered to save battery.
            urgency: payload.requireInteraction ? 'high' : 'normal',
            // topic: groups notifications with the same topic on the
            // device. We use 'chat' for messages so they collapse in the
            // shade when there are too many; calls get their own topic.
            topic: payload.requireInteraction ? 'call' : 'chat',
          },
        ),
      ),
    )

    // Clean up expired/invalid subscriptions
    const toDelete: string[] = []
    // Retry-queue for transient failures (429, 5xx)
    const toRetry: Array<{ sub: typeof subsToSend[0]; attempt: number }> = []
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const err: any = r.reason
        const statusCode = err?.statusCode
        // 404 = subscription expired, 410 = gone permanently
        if (statusCode === 404 || statusCode === 410) {
          toDelete.push(subsToSend[i].endpoint)
        }
        // 429 = rate limited, 5xx = push service temporarily unavailable
        // → retry once after a short delay (best-effort, don't block the
        //   caller — fire and forget)
        else if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
          toRetry.push({ sub: subsToSend[i], attempt: 1 })
        }
        // 413 = payload too large — don't retry, log it
        else if (statusCode === 413) {
          logger.error('Payload too large for endpoint', { module: 'push', endpoint: subsToSend[i].endpoint.slice(0, 60) })
        }
      }
    })

    if (toDelete.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: toDelete } } })
    }

    // Retry once after 10 seconds for transient failures.
    // Single retry (not exponential backoff) — if it fails twice, the
    // push is lost. This is acceptable: push is best-effort by design.
    if (toRetry.length > 0) {
      setTimeout(() => {
        Promise.allSettled(
          toRetry.map(({ sub }) =>
            webpush.sendNotification(
              { endpoint: sub.endpoint, keys: JSON.parse(sub.keys) },
              notificationPayload,
              { TTL: 60, urgency: 'high' },
            ),
          ),
        ).then((retryResults) => {
          // After retry, clean up any subscriptions that are now permanently gone
          const stillDead: string[] = []
          retryResults.forEach((r, i) => {
            if (r.status === 'rejected') {
              const err: any = r.reason
              if (err?.statusCode === 404 || err?.statusCode === 410) {
                stillDead.push(toRetry[i].sub.endpoint)
              }
            }
          })
          if (stillDead.length > 0) {
            prisma.pushSubscription
              .deleteMany({ where: { endpoint: { in: stillDead } } })
              .catch(() => {})
          }
        }).catch(() => {
          // Retry batch failed entirely — silent
        })
      }, 10_000).unref?.() // unref so the timer doesn't keep Node alive
    }
  } catch (e) {
    logger.error('sendPushToUser error:', { module: 'push', error: e })
  }
}

export default router
