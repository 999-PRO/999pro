import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'

const router = Router()

// ============================================================================
//  POST /api/search/track
//  Record a search query submitted by an authenticated user. Used for
//  personalization — the home page "Recommended for you" block considers the
//  user's recent search terms to infer interest in categories.
//
//  Body: { query: string }
//  Auth: required (anonymous searches aren't tracked — no value in
//        personalization without a stable user identity).
//
//  Rate-limited client-side: the search page debounces and only sends
//  queries >= 2 chars, and the client skips sending the same query twice
//  in a row. The endpoint itself is idempotent — duplicate queries are
//  fine; we just store them all (cheap inserts).
// ============================================================================
router.post(
  '/track',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = String(req.body?.query || '').trim()
    if (query.length < 2 || query.length > 200) {
      return res.json({ ok: false, reason: 'invalid_query' })
    }

    await prisma.searchHistory
      .create({ data: { userId: req.user!.id, query } })
      .catch(() => {/* ignore FK / DB errors — search tracking is best-effort */})

    res.json({ ok: true })
  }),
)

export default router
