// ============================================================================
// TOTP (Time-based One-Time Password) — RFC 6238 implementation.
//
// v9-audit-fix: S-CRIT-008 — 2FA/TOTP for admin accounts.
// Uses only Node.js built-in crypto module — no external dependencies.
//
// The TOTP algorithm is:
//   1. Compute counter = floor(unix_time / 30)
//   2. HMAC-SHA1(secret, counter) → 20-byte digest
//   3. Dynamic truncation: take 4 bytes starting at offset = digest[19] & 0x0f
//   4. Code = (truncated & 0x7fffffff) % 10^6 → 6-digit code
//
// Verification allows ±1 time step (30s) for clock drift.
// ============================================================================

import crypto from 'node:crypto'

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const PERIOD = 30 // seconds
const DIGITS = 6

/**
 * Generate a random TOTP secret in Base32 encoding.
 * 20 bytes = 160 bits (recommended by RFC 4226 §4).
 */
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20)
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31]
  }
  return output
}

/**
 * Decode a Base32 string to a Buffer.
 */
function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char)
    if (idx === -1) throw new Error(`Invalid Base32 character: ${char}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/**
 * Generate a TOTP code for the given secret and time step offset.
 * @param secret Base32-encoded secret
 * @param timeOffset Offset in 30-second steps (default 0 = current time)
 */
function generateTotp(secret: string, timeOffset = 0): string {
  const counter = Math.floor(Date.now() / 1000 / PERIOD) + timeOffset
  const buffer = Buffer.alloc(8)
  // Write counter as big-endian 64-bit integer
  buffer.writeBigInt64BE(BigInt(counter))

  const hmac = crypto.createHmac('sha1', base32Decode(secret))
  hmac.update(buffer)
  const digest = hmac.digest()

  // Dynamic truncation (RFC 4226 §5.4)
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)

  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

/**
 * Verify a TOTP code against the secret.
 * Allows ±1 time step (±30 seconds) for clock drift.
 * @returns true if the code is valid within the time window
 */
export function verifyTotp(token: string, secret: string): boolean {
  // Sanitize input: remove spaces, pad with zeros
  const sanitized = token.replace(/\s/g, '').padStart(DIGITS, '0')
  if (sanitized.length !== DIGITS || !/^\d+$/.test(sanitized)) {
    return false
  }

  // Check current step + ±1 step for clock drift
  for (let offset = -1; offset <= 1; offset++) {
    const expected = generateTotp(secret, offset)
    // Constant-time comparison to prevent timing attacks
    if (constantTimeCompare(sanitized, expected)) {
      return true
    }
  }
  return false
}

/**
 * Generate a otpauth:// URL for QR code scanning (Google Authenticator compatible).
 * Format: otpauth://totp/LABEL?secret=SECRET&issuer=ISSUER&digits=6&period=30
 */
export function generateTotpUrl(secret: string, email: string, issuer = '«Три девятки»'): string {
  const label = encodeURIComponent(`${issuer}:${email}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    digits: String(DIGITS),
    period: String(PERIOD),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
