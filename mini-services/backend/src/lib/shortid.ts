// ============================================================================
//  Short ID generator — cryptographically secure base62 short links.
//
//  Used by Smart Share: each product gets an 8-char base62 ID like "aZ3Kp9Qm".
//  62^8 ≈ 218 trillion combinations — far beyond brute-force feasibility.
//
//  We never expose the internal Product.id (cuid, 24 chars) in public URLs.
//  The shortId is opaque, unguessable, and tied 1:1 to a product.
// ============================================================================

import { randomBytes } from 'node:crypto'

// base62 alphabet — avoids ambiguous characters (0/O, 1/l/I) and is URL-safe.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ALPHA_LEN = ALPHABET.length // 62

/**
 * Generate a short, unguessable base62 ID of the given length.
 *
 * Uses crypto.randomBytes (CSPRNG) — NOT Math.random — so the result is
 * suitable for use as a security-sensitive identifier.
 *
 * Default length 8 gives 62^8 ≈ 2.18 × 10^14 combinations.
 *
 * P-MED-001: Uses rejection sampling to eliminate modulo bias. The naive
 * `byte % ALPHA_LEN` mapping is biased because 256 % 62 = 8, so alphabet
 * positions 0-7 are slightly more likely than 8-61. We reject bytes in the
 * top "remainder" of the 256-range and resample until we get one in the
 * unbiased range [0, 256 - (256 % ALPHA_LEN)). Worst-case extra draws per
 * byte: ~3% probability of resample, so expected cost is negligible.
 */
export function generateShortId(length = 8): string {
  // Maximum byte value that produces an unbiased modulo result. Bytes in
  // [LIMIT, 255] are rejected and resampled.
  const LIMIT = 256 - (256 % ALPHA_LEN) // = 254 for ALPHA_LEN=62
  let out = ''
  for (let i = 0; i < length; i++) {
    let idx = randomBytes(1)[0]
    while (idx >= LIMIT) {
      // Reject bytes that would introduce modulo bias
      idx = randomBytes(1)[0]
    }
    out += ALPHABET[idx % ALPHA_LEN]
  }
  return out
}

/**
 * Validate that a string looks like a short ID.
 * Used for input validation on /api/share/:shortId routes.
 */
export function isValidShortId(s: string): boolean {
  if (!s || typeof s !== 'string') return false
  if (s.length < 4 || s.length > 32) return false
  return /^[A-Za-z0-9]+$/.test(s)
}
