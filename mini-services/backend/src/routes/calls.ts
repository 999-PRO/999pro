import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'

const router: Router = Router()

// ============================================================================
// GET /api/calls/ice-servers
// ----------------------------------------------------------------------------
// Returns the WebRTC ICE configuration for the client.
// The client uses this to configure RTCPeerConnection.iceServers.
// We return:
//   - STUN servers (always — Google public STUN)
//   - TURN servers (only if TURN_URL is configured in env)
//
// TURN credentials: this endpoint returns static long-term credentials
// (TURN_URL + TURN_USERNAME + TURN_CREDENTIAL from env). For production at
// scale, switch to time-limited credentials:
//   1. coturn `use-auth-secret` + `static-auth-secret` mode
//   2. Backend signs a short-lived HMAC token per request
//   3. Return { username: "<expiry>:<userid>", credential: "<hmac>" }
// For now, static creds are fine — coturn should be behind a firewall that
// only allows WebRTC UDP ports.
// ============================================================================

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

router.get(
  '/ice-servers',
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const iceServers: Array<{ urls: string; username?: string; credential?: string }> = [
      ...STUN_SERVERS,
    ]

    const turnUrl = process.env.TURN_URL
    const turnUsername = process.env.TURN_USERNAME
    const turnCredential = process.env.TURN_CREDENTIAL

    if (turnUrl && turnUsername && turnCredential) {
      // Support multiple TURN URLs (comma-separated in env) for HA.
      const turnUrls = turnUrl.split(',').map((s) => s.trim()).filter(Boolean)
      iceServers.push({
        urls: turnUrls.join(','),
        username: turnUsername,
        credential: turnCredential,
      })
    }

    res.set('Cache-Control', 'private, max-age=300')
    res.json({ iceServers, ttl: 300 })
  }),
)

// ============================================================================
// GET /api/calls/history — list recent calls for the authenticated user.
// ----------------------------------------------------------------------------
// Returns calls where the user is either caller or recipient, sorted by
// createdAt desc. Used by the chat UI to show a "Recent calls" section
// (like WhatsApp/Telegram).
//
// Query params:
//   ?limit=50    — max 200
//   ?offset=0    — pagination
//   ?conversationId=... — filter by conversation (optional)
//
// Response shape per call:
//   {
//     id, type, status, duration, startedAt, endedAt, createdAt,
//     direction: 'incoming' | 'outgoing',
//     peer: { id, username, displayName, avatar }
//   }
// ============================================================================
router.get(
  '/history',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    const meId = req.user!.id

    const where: any = {
      OR: [{ callerId: meId }, { recipientId: meId }],
    }
    if (req.query.conversationId) {
      where.conversationId = String(req.query.conversationId)
    }

    const [items, total] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          caller: {
            select: { id: true, username: true, displayName: true, avatar: true },
          },
          recipient: {
            select: { id: true, username: true, displayName: true, avatar: true },
          },
        },
      }),
      prisma.call.count({ where }),
    ])

    res.json({
      items: items.map((c) => {
        const isCaller = c.callerId === meId
        const peer = isCaller ? c.recipient : c.caller
        return {
          id: c.id,
          conversationId: c.conversationId,
          type: c.type, // 'audio' | 'video'
          status: c.status, // ringing | accepted | rejected | missed | ended | cancelled
          duration: c.duration,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          createdAt: c.createdAt,
          direction: isCaller ? 'outgoing' : 'incoming',
          peer: {
            id: peer.id,
            username: peer.username,
            displayName: peer.displayName,
            avatar: peer.avatar,
          },
        }
      }),
      total,
      limit,
      offset,
    })
  }),
)

export default router
